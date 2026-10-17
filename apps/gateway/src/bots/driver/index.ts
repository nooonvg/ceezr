/**
 * الغرض: محوّل بوت السائق: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً عبر grammY.
 *   لا قرار عمل هنا إطلاقاً: كل القرارات في packages/application/bots/driver-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/driver
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: الملفّات المجاورة (offers, subscription, availability, registration,
 *   rating, trip-lifecycle) معزولةٌ ومُستبدَلة لا محذوفة: أقسامها منفَّذة فعلاً داخل
 *   `packages/application/bots/driver-dialog.ts`، ولا يستوردها شيء. وترويسة كلٍّ منها
 *   تُحيل إلى موضع تنفيذها بالضبط، لأنّ ملفّاً يعلن أنّ القدرة غير منفَّذة وهي منفَّذة
 *   يقرأه المراجع فيستنتج فجوةً لا وجود لها، ويقرأه الوكيل فيبني نسخةً ثانية من المنطق.
 */

import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../../../../packages/application/bots/driver-dialog.ts";
import {
  admitUpdate,
  silenceUnknownInGroup,
} from "../../../../../packages/application/bots/group-chat.ts";
import {
  handleSurfaceUpdate,
  type MiniAppSurfaceConfig,
  type SurfacePorts,
} from "../../../../../packages/application/bots/miniapp-surface.ts";
import { type BotReply, INITIAL_STATE } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender as TelegramSenderType } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";
import { isCallbackDataValid } from "../shared/keyboards.ts";
import type { LanguageHydration } from "../shared/language-middleware.ts";
import {
  deliverReplies,
  type PreparedUpdate,
  type ReplyDeliveryResult,
} from "../shared/reply-delivery.ts";
import { SessionCasConflictError } from "../shared/session-revision.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

export type { TelegramSender } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";
export { grammyTelegramSender } from "../../../../../packages/infrastructure/notification/telegram-api-sender.ts";

export interface DriverBotAdapter {
  /** يعيد false إن تعذّرت المعالجة، فتسجّلها البوابة بلا ادّعاء نجاح. */
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
  /**
   * S5 (ADR 0288) — الأثرُ وحسابُ الردودِ بلا إرسالٍ: `handled=false` = لم يكتملِ
   * المعالجُ (يُعادُ التحديثُ)، وإلا فالردودُ نيّةٌ تُثبَّتُ قبلَ أيِّ إرسالٍ.
   */
  prepare(raw: RawTelegramUpdate): Promise<PreparedUpdate>;
  /** S5 — إرسالُ الردودِ من المؤشرِ `from`؛ يتوقّفُ عندَ أوّلِ رفضٍ. */
  deliver(replies: readonly BotReply[], from: number): Promise<ReplyDeliveryResult>;
}

/**
 * `language` اختياري: المحوّل يعمل بدونه كما كان، ومئات الاختبارات القائمة
 * لا تتغيّر. والتوجيه طلب توصيله في `server.ts`، ولا يصحّ تقنياً: `server.ts`
 * توجيه نقل محض (يركّب المسارات ويتحقّق من السرّ) ولا تعرف مُرسِلَ التحديث
 * ولا معرّفه أصلاً — فكّ التحديث يجري هنا في `toIncomingUpdate`. فوضعه في `server.ts`
 * يوجب تكرار الفكّ مرّتين، وهذا هو المفصل الصحيح: أوّل موضع تُعرف فيه الهوية.
 */
export function createDriverBot(
  deps: DriverBotDependencies,
  sender: TelegramSenderType,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
  language?: LanguageHydration,
  surface?: MiniAppSurfaceConfig,
): DriverBotAdapter {
  // الطبقةُ الخفيفةُ (`ADR 0213`) تقرأُ من تبعيّاتِ الحوارِ نفسِها — لا منفذَ جديدٌ.
  const ports: SurfacePorts = {
    sessions: deps.sessions,
    initialState: INITIAL_STATE,
    isRegistered: async (telegramUserId) => {
      const found = await deps.drivers.findByTelegramId(telegramUserId);
      return found.ok ? found.value !== null : null;
    },
    // NEG-SELECT-01 — نصُّ من في محادثةِ تفاوضٍ مفتوحةٍ رسالةٌ للطرفِ الآخرِ: يمضي للحوارِ.
    inNegotiation: async (telegramUserId) => {
      const relay = deps.negotiation?.relay;
      if (relay === undefined) return false;
      const found = await deps.drivers.findByTelegramId(telegramUserId);
      if (!found.ok) return null;
      if (found.value === null) return false;
      const parties = await relay.lookup.forDriver(found.value.id);
      return parties.ok ? parties.value !== null : null;
    },
    onStart: async (telegramUserId) => {
      // `ADR 0212`: ترقيةُ المسؤولِ الأوّلِ عند كلِّ `/start` — في وضعِ التطبيقِ كما في القديمِ،
      // وإخفاقُها لا يمنعُ الدخولَ (مسارٌ إداريٌّ لا شرطُ استخدامٍ).
      if (deps.bootstrapAdmin !== undefined && deps.bootstrapAdmin.telegramId === telegramUserId) {
        await deps.bootstrapAdmin.grant(telegramUserId).catch(() => undefined);
      }
    },
  };
  const prepare = async (raw: RawTelegramUpdate): Promise<PreparedUpdate> => {
    /**
     * `BOT-GRP-01` — ترقيةُ قروبٍ تُبطلُ معرّفَه المحفوظَ في `cities` فتتوقّفُ بطاقاتُه بصمتٍ
     * («group chat was upgraded to a supergroup chat»). لا نُعدّلُ القاعدةَ هنا تلقائياً
     * (تعديلُ معرّفاتِ القروباتِ فعلُ مسؤولٍ مُدقَّقٌ)، بل نُسجّلُ حدثاً صريحاً بالمعرّفَين.
     */
    const migratedFrom = raw.message?.migrate_from_chat_id;
    const migratedTo = raw.message?.migrate_to_chat_id;
    if (migratedFrom !== undefined || migratedTo !== undefined) {
      log("bot.group_migrated_to_supergroup", {
        oldChatId: String(migratedFrom ?? raw.message?.chat?.id ?? ""),
        newChatId: String(migratedTo ?? raw.message?.chat?.id ?? ""),
        action: "update cities group ids via admin_update_city_group_ids",
      });
    }
    const incoming = toIncomingUpdate(raw);
    if (incoming === null) return { handled: true, replies: [] }; // تحديث لا يخصّنا: نعترف بالاستلام ولا نردّ
    // `BOT-GRP-01`: أوقِفْ مؤشّرَ التحميلِ على الزرِّ فوراً — إخفاقُه لا يمسُّ المعالجةَ.
    const callbackQueryId = raw.callback_query?.id;
    if (callbackQueryId !== undefined && sender.answerCallbackQuery !== undefined) {
      await sender.answerCallbackQuery(callbackQueryId).catch((error: unknown) => {
        log("bot.driver.answer_callback_failed", { detail: String(error) });
      });
    }
    // `BOT-GRP-01`: في القروبِ لا يمرُّ إلى الحوارِ إلا الأزرارُ والأوامرُ.
    if (!admitUpdate(incoming)) return { handled: true, replies: [] };

    // قبل الحوار لا بعده: الحوار يقرأ الجلسة في أوّل سطر، فلا ينفع ترطيبٌ بعده.
    // والحوارُ كلُّه — ترطيبُ اللغة ثم حسابُ الردود — يُعادُ بأكمله عند تعارضِ
    // مراجعةِ الجلسة (BUG-007): لا تُرسَلُ رسالةٌ قبلَ أن تنجحَ الكتابةُ الشرطية،
    // فلا يرى السائقُ ردًّا لحالةٍ كُتبَ فوقَها متزامنٌ آخرُ. والحدُّ ثلاثٌ: من
    // يفشلُ بعدَها عطلٌ لا تزامن.
    const MAX_CAS_RETRIES = 3;
    let replies: readonly BotReply[] = [];
    for (let attempt = 0; ; attempt++) {
      try {
        if (language !== undefined) await language.hydrate(incoming.from);
        replies =
          surface === undefined
            ? await handleDriverUpdate(incoming, deps)
            : await handleSurfaceUpdate("driver", incoming, surface, ports, () =>
                handleDriverUpdate(incoming, deps),
              );
        break;
      } catch (error) {
        if (error instanceof SessionCasConflictError && attempt < MAX_CAS_RETRIES) {
          log("bot.session_revision_conflict", {
            attempt: attempt + 1,
            userId: error.telegramUserId,
          });
          continue;
        }
        log("bot.driver.dialog_unexpected_error", { detail: String(error) });
        return { handled: false, replies: [] };
      }
    }

    replies = silenceUnknownInGroup(incoming, replies);

    for (const reply of replies) {
      if (reply.keyboard?.kind === "inline") {
        const tooLong = reply.keyboard.rows
          .flat()
          .filter((button) => !isCallbackDataValid(button.data));
        if (tooLong.length > 0) {
          log("bot.driver.callback_data_too_long", { count: tooLong.length });
          return { handled: false, replies: [] };
        }
      }
    }
    return { handled: true, replies };
  };
  const deliver: DriverBotAdapter["deliver"] = (replies, from) =>
    deliverReplies(sender, replies, from, log, true);
  return {
    prepare,
    deliver,
    // المسارُ القديمُ (ويبهوك متزامنٌ/اختبارات): تحضيرٌ ثم إرسالٌ، ورفضُ الإرسالِ ← false.
    handleUpdate: async (raw) => {
      const prepared = await prepare(raw);
      if (!prepared.handled) return false;
      const delivered = await deliver(prepared.replies, 0);
      return delivered.error === null;
    },
  };
}
