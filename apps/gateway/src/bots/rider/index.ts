/**
 * الغرض: محوّل بوت العميل: تحديث تلغرام ← منطق الحوار ← رسائل مُرسَلة فعلاً.
 *   لا قرار عمل هنا: القرارات في packages/application/bots/rider-dialog.ts.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway/src/bots/rider
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts
 * ملاحظات مستقبلية: الملفّات المجاورة (request-ride, request-delivery, order-tracking,
 *   rating) معزولةٌ ومُستبدَلة لا محذوفة: طلب التوصيل منفَّذ في
 *   `packages/application/delivery/request-delivery.ts`، والتتبّع والتقييم في `rider-dialog.ts`
 *   و`rating-dialog.ts`، ولا يستورد أيًّا منها شيء. وترويسة كلٍّ منها تُحيل إلى موضع تنفيذها
 *   بالضبط، فلا يقرأ قارئٌ «غير منفَّذ» عن قدرةٍ منفَّذة.
 */

import {
  admitUpdate,
  silenceUnknownInGroup,
} from "../../../../../packages/application/bots/group-chat.ts";
import {
  handleSurfaceUpdate,
  type MiniAppSurfaceConfig,
  type SurfacePorts,
} from "../../../../../packages/application/bots/miniapp-surface.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../../../../packages/application/bots/rider-dialog.ts";
import { type BotReply, INITIAL_STATE } from "../../../../../packages/application/bots/types.ts";
import type { TelegramSender } from "../driver/index.ts";
import type { LanguageHydration } from "../shared/language-middleware.ts";
import {
  deliverReplies,
  type PreparedUpdate,
  type ReplyDeliveryResult,
} from "../shared/reply-delivery.ts";
import { SessionCasConflictError } from "../shared/session-revision.ts";
import { type RawTelegramUpdate, toIncomingUpdate } from "../shared/telegram-mapper.ts";

export interface RiderBotAdapter {
  handleUpdate(raw: RawTelegramUpdate): Promise<boolean>;
  /**
   * S5 (ADR 0288) — الأثرُ وحسابُ الردودِ بلا إرسالٍ: `handled=false` = لم يكتملِ
   * المعالجُ (يُعادُ التحديثُ)، وإلا فالردودُ نيّةٌ تُثبَّتُ قبلَ أيِّ إرسالٍ.
   */
  prepare(raw: RawTelegramUpdate): Promise<PreparedUpdate>;
  /** S5 — إرسالُ الردودِ من المؤشرِ `from`؛ يتوقّفُ عندَ أوّلِ رفضٍ. */
  deliver(replies: readonly BotReply[], from: number): Promise<ReplyDeliveryResult>;
}

/** `language` اختياري للسبب المشروح في محوّل السائق: المحوّل أوّل موضع تُعرف فيه الهوية. */
export function createRiderBot(
  deps: RiderBotDependencies,
  sender: TelegramSender,
  log: (message: string, meta: Record<string, unknown>) => void = () => {},
  language?: LanguageHydration,
  surface?: MiniAppSurfaceConfig,
): RiderBotAdapter {
  // الطبقةُ الخفيفةُ (`ADR 0213`) تقرأُ من تبعيّاتِ الحوارِ نفسِها — لا منفذَ جديدٌ.
  const ports: SurfacePorts = {
    sessions: deps.sessions,
    initialState: INITIAL_STATE,
    isRegistered: async (telegramUserId) => {
      const found = await deps.riders.findByTelegramId(telegramUserId);
      return found.ok ? found.value !== null : null;
    },
    // NEG-SELECT-01 — نصُّ من في محادثةِ تفاوضٍ مفتوحةٍ رسالةٌ للطرفِ الآخرِ: يمضي للحوارِ.
    inNegotiation: async (telegramUserId) => {
      const relay = deps.negotiation?.relay;
      if (relay === undefined) return false;
      const found = await deps.riders.findByTelegramId(telegramUserId);
      if (!found.ok) return null;
      if (found.value === null) return false;
      const parties = await relay.lookup.forRider(found.value.id);
      return parties.ok ? parties.value !== null : null;
    },
    activeOrdersOf: async (telegramUserId) => {
      const found = await deps.riders.findByTelegramId(telegramUserId);
      if (!found.ok) return null;
      if (found.value === null) return [];
      return deps.activeOrdersOf(found.value.id).catch(() => null);
    },
  };
  const prepare = async (raw: RawTelegramUpdate): Promise<PreparedUpdate> => {
    const incoming = toIncomingUpdate(raw);
    if (incoming === null) return { handled: true, replies: [] };
    // `BOT-GRP-01`: أوقِفْ مؤشّرَ التحميلِ على الزرِّ فوراً — إخفاقُه لا يمسُّ المعالجةَ.
    const callbackQueryId = raw.callback_query?.id;
    if (callbackQueryId !== undefined && sender.answerCallbackQuery !== undefined) {
      await sender.answerCallbackQuery(callbackQueryId).catch((error: unknown) => {
        log("bot.rider.answer_callback_failed", { detail: String(error) });
      });
    }
    // `BOT-GRP-01`: في القروبِ لا يمرُّ إلى الحوارِ إلا الأزرارُ والأوامرُ.
    if (!admitUpdate(incoming)) return { handled: true, replies: [] };

    // قبل الحوار لا بعده: الحوار يقرأ الجلسة في أوّل سطر. ويُعادُ كلُّه — ترطيبُ اللغة
    // ثم حسابُ الردود — عند تعارضِ مراجعةِ الجلسة (BUG-007): لا تُرسَلُ رسالةٌ قبلَ
    // أن تنجحَ الكتابةُ الشرطية. والحدُّ ثلاثٌ: من يفشلُ بعدَها عطلٌ لا تزامن.
    const MAX_CAS_RETRIES = 3;
    let replies: readonly BotReply[] = [];
    for (let attempt = 0; ; attempt++) {
      try {
        if (language !== undefined) await language.hydrate(incoming.from);
        replies =
          surface === undefined
            ? await handleRiderUpdate(incoming, deps)
            : await handleSurfaceUpdate("rider", incoming, surface, ports, () =>
                handleRiderUpdate(incoming, deps),
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
        log("bot.rider.dialog_unexpected_error", { detail: String(error) });
        return { handled: false, replies: [] };
      }
    }

    replies = silenceUnknownInGroup(incoming, replies);

    return { handled: true, replies };
  };
  const deliver: RiderBotAdapter["deliver"] = (replies, from) =>
    deliverReplies(sender, replies, from, log, false);
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
