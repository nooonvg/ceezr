/**
 * الغرض: **معرضُ الرسائلِ** — كلُّ رسالةٍ يُرسِلُها النظامُ في تيليجرام لطالبِ الخدمةِ والسائقِ
 *   وقروباتِ السائقينَ والدعمِ والتصعيدِ، مُولَّدةً **بالدوالِّ الإنتاجيّةِ نفسِها** لا بنسخةٍ
 *   مكتوبةٍ باليدِ، لتُعرَضَ في اللوحةِ ويُرسَلَ أيُّها إلى المسؤولِ معاينةً (`ADM-MSG-01`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/admin-ui.ts · tests/unit/admin-message-gallery.test.ts
 *
 * ## لماذا تُستدعى الناشراتُ الحقيقيّةُ لا قوالبُ القاموسِ
 *
 * النصُّ في القاموسِ نصفُ الرسالةِ: ترتيبُ الأسطرِ، وما يُحذَفُ حينَ يغيبُ حقلٌ، والأزرارُ
 * وبياناتُها، وزرُّ «وَصْلة» الذي يُلحِقُه المُرسِلُ بالرسائلِ الخاصّةِ — كلُّها في الشيفرةِ
 * لا في القاموسِ. فكلُّ عيّنةٍ ههنا تمرُّ بالدالّةِ التي تبني الرسالةَ في الإنتاجِ، بمُرسِلٍ
 * يلتقطُ ولا يُرسِلُ، ثمَّ بغلافِ الدخولِ نفسِه (`withEntryButton`) حيثُ يمرُّ بهِ الإنتاجُ.
 * فإن تغيّرَت بطاقةٌ في الكودِ تغيّرَت هنا بلا تعديلٍ.
 *
 * ## ما ليسَ ههنا
 *
 * - **خطواتُ الحوارِ** (التسجيلُ، اللغةُ، الطوارئُ …) تبنيها حواراتٌ ذاتُ حالةٍ ومنافذَ؛
 *   نصوصُها كلُّها في «القاموسِ الكاملِ» الذي تعرضُه الصفحةُ أسفلَ العيّناتِ.
 * - **البياناتُ** نموذجيّةٌ ثابتةٌ، ومعرّفاتُ الأزرارِ وهميّةٌ: ضغطُها يصلُ الإنتاجَ بمعرّفٍ
 *   لا وجودَ له فلا يُغيِّرُ شيئاً.
 */

import {
  entryReplies,
  movedReplies,
} from "../../../../packages/application/bots/miniapp-surface.ts";
import { driverLeaveKeyboard } from "../../../../packages/application/bots/negotiation-cards.ts";
import type { Keyboard } from "../../../../packages/application/bots/types.ts";
import {
  type RiderTripEvent,
  riderTripKeyboard,
  riderTripText,
} from "../../../../packages/application/driver/rider-trip-notice.ts";
import { warnExpiringDocuments } from "../../../../packages/application/driver/warn-expiring-documents.ts";
import { noticeText } from "../../../../packages/application/subscription/deliver-notices.ts";
import { warnExpiringSubscriptions } from "../../../../packages/application/subscription/expire-subscriptions.ts";
import type { SubscriptionNoticeKind } from "../../../../packages/application/subscription/notice-ports.ts";
import { approximateArea } from "../../../../packages/domain/dispatch/negotiation.ts";
import {
  availableActions,
  type SupportTicket,
} from "../../../../packages/domain/dispute/entity.ts";
import type { SupportResolution } from "../../../../packages/domain/dispute/value-objects.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import {
  MINIAPP_ENTRY_LABEL,
  withEntryButton,
} from "../../../../packages/infrastructure/notification/miniapp-entry-sender.ts";
import { createBroadcastPublisher } from "../../../../packages/infrastructure/notification/telegram-broadcast-sender.ts";
import { createTelegramCancellationMessenger } from "../../../../packages/infrastructure/notification/telegram-cancellation-notifier.ts";
import { createOfferPublisher } from "../../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { createTelegramLostItemMessenger } from "../../../../packages/infrastructure/notification/telegram-lost-item-notifier.ts";
import { toTelegramMarkup } from "../../../../packages/infrastructure/notification/telegram-markup.ts";
import {
  createEscalationGroupPublisher,
  createTelegramNegotiationMessenger,
  createTelegramRelaySender,
  createUnsubscribedGroupPublisher,
  type IdentifyingSender,
} from "../../../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import { createSafetyCardPublisher } from "../../../../packages/infrastructure/notification/telegram-safety-notifier.ts";
import { createTelegramSafetyResolutionMessenger } from "../../../../packages/infrastructure/notification/telegram-safety-resolution-notifier.ts";
import {
  createSupportCardPublisher,
  createTicketOwnerNotifier,
  type SupportSender,
} from "../../../../packages/infrastructure/notification/telegram-support-notifier.ts";
import { createTelegramUnmatchedMessenger } from "../../../../packages/infrastructure/notification/telegram-unmatched-notifier.ts";
import { t } from "../../../../packages/shared/i18n/index.ts";
import type {
  CityId,
  DriverId,
  OfferId,
  OrderId,
} from "../../../../packages/shared/kernel/index.ts";
import { miniAppUrl as buildMiniAppUrl } from "../../../../packages/shared/miniapp-link/index.ts";
import { ok } from "../../../../packages/shared/result/index.ts";

/** لمَن تصلُ الرسالةُ في الواقعِ. */
export type GalleryAudience =
  | "rider"
  | "driver"
  | "drivers_group"
  | "support_group"
  | "escalation_group";

/** البوتُ الذي يُرسِلُها في الإنتاجِ — وهو نفسُه الذي تُرسَلُ به المعاينةُ. */
export type GalleryBot = "rider" | "driver";

export interface MessageSpecimen {
  /** معرّفٌ ثابتٌ يُرسَلُ في نموذجِ «أرسلها لي». */
  readonly id: string;
  readonly audience: GalleryAudience;
  readonly bot: GalleryBot;
  readonly title: string;
  /** متى تُرسَلُ في الواقعِ — جملةٌ للمسؤولِ. */
  readonly when: string;
  /** الملفُّ الذي يبني الرسالةَ — ليُعرَفَ أينَ تُعدَّلُ. */
  readonly source: string;
  readonly text: string;
  /** لوحةُ تيليجرام كما تُرسَلُ (`reply_markup`)، أو `undefined` بلا أزرار. */
  readonly markup: unknown;
  /** الرسالةُ في الواقعِ صورةٌ والنصُّ تعليقُها (إيصالٌ مرفقٌ بتذكرةٍ مثلاً). */
  readonly photo?: true;
  /** لونُ البطاقةِ في المعرضِ (`MSG-COLOR-01`): أصفرُ للتوصيلِ، أخضرُ للمشوارِ. */
  readonly service?: "delivery" | "transport";
}

export const GALLERY_AUDIENCES: readonly {
  readonly id: GalleryAudience;
  readonly label: string;
}[] = [
  { id: "rider", label: "الراكب (بوت الراكب)" },
  { id: "driver", label: "السائق (بوت السائق)" },
  { id: "drivers_group", label: "قروب السائقين غير المشتركين" },
  { id: "support_group", label: "قروب الدعم" },
  { id: "escalation_group", label: "قروب التصعيد والسلامة" },
];

export interface GalleryOptions {
  /** `MINIAPP_URL` — بلا قيمةٍ لا تُبنى أزرارُ التطبيقِ، كما في الإنتاجِ. */
  readonly miniAppUrl: string | null;
}

/** معرّفاتٌ وهميّةٌ ثابتةٌ: لا تطابقُ صفّاً في القاعدةِ. */
const FAKE = {
  order: "00000000-0000-4000-8000-00000000a001",
  offer: "00000000-0000-4000-8000-00000000a002",
  driver: "00000000-0000-4000-8000-00000000a003",
  city: "00000000-0000-4000-8000-00000000a004",
  negotiation: "00000000-0000-4000-8000-00000000a005",
  ticket: "00000000-0000-4000-8000-00000000a006",
  incident: "00000000-0000-4000-8000-00000000a007",
} as const;

/** محادثةٌ خاصّةٌ نموذجيّةٌ (موجبٌ) وقروبٌ نموذجيٌّ (سالبٌ) — يحكمانِ غلافَ الدخولِ وحدَه. */
const PRIVATE_CHAT = "1";
const GROUP_CHAT = "-1001";
const LANG = "ar";
const SAMPLE = {
  pickup: "مطار الملك عبدالعزيز الدولي",
  dropoff: "البلد",
  pickupPoint: { latitude: 21.67956, longitude: 39.15649 },
  riderName: "عبدالله محمد",
  driverName: "سالم أحمد",
  phone: "+966500000000",
  city: "جدة",
  plate: "أ ب ج 1234",
} as const;

interface Captured {
  readonly chatId: string;
  readonly text: string;
  readonly markup: unknown;
  readonly photo?: true;
}

/** يلتقطُ ما كانَ سيُرسَلُ — لا شبكةَ. */
function recorder() {
  const sent: Captured[] = [];
  const identifying: IdentifyingSender = {
    sendReturningId: async (chatId, text, keyboard: Keyboard | null) => {
      sent.push({ chatId, text, markup: toTelegramMarkup(keyboard) });
      return "1";
    },
  };
  const support: SupportSender = {
    sendReturningId: async (chatId, text, markup) => {
      sent.push({ chatId, text, markup });
      return "1";
    },
    sendPhotoReturningId: async (chatId, _fileId, caption, markup) => {
      sent.push({ chatId, text: caption, markup, photo: true });
      return "1";
    },
  };
  const outbound = {
    send: async (chatId: string, text: string, keyboard: Keyboard | null) => {
      sent.push({ chatId, text, markup: toTelegramMarkup(keyboard) });
      return true;
    },
  };
  const raw = {
    sendMessage: async (chatId: string, text: string, markup: unknown) => {
      sent.push({ chatId, text, markup });
      return "1";
    },
  };
  /** يُفرِغُ الملتقَطَ ويُعيدُه — كلُّ عيّنةٍ تأخذُ ما أنتجَه نداؤها وحدَه. */
  const take = (): Captured[] => sent.splice(0, sent.length);
  return { identifying, support, outbound, raw, take };
}

/** خدمةُ العيّنةِ من معرّفِها — بطاقاتُ العروضِ والقروبِ وحدَها تحملُ لوناً. */
function serviceOf(id: string): "delivery" | "transport" | null {
  if (!/(offer|unsub|wider|nodriver)/.test(id)) return null;
  if (id.endsWith("delivery")) return "delivery";
  if (id.endsWith("transport")) return "transport";
  return null;
}

export async function buildMessageGallery(options: GalleryOptions): Promise<MessageSpecimen[]> {
  const rec = recorder();
  const specimens: MessageSpecimen[] = [];
  const entry =
    options.miniAppUrl === null
      ? null
      : {
          text: MINIAPP_ENTRY_LABEL,
          web_app: { url: buildMiniAppUrl(options.miniAppUrl, null) },
        };

  /**
   * يضمُّ ما التُقِطَ عيّناتٍ. `wrapped` = يمرُّ في الإنتاجِ بمُرسِلٍ ملفوفٍ بزرِّ «وَصْلة»
   * (`withMiniAppEntry`)؛ والغلافُ نفسُه يتركُ القروباتِ وما فيه زرُّ تطبيقٍ أصلاً.
   */
  const add = (
    base: Omit<MessageSpecimen, "text" | "markup" | "id">,
    id: string,
    wrapped: boolean,
  ): void => {
    const captured = rec.take();
    captured.forEach((message, index) => {
      const markup =
        wrapped && entry !== null
          ? withEntryButton(message.chatId, message.markup, entry)
          : message.markup;
      specimens.push({
        ...base,
        id: captured.length > 1 ? `${id}-${index + 1}` : id,
        text: message.text,
        markup,
        ...(message.photo === true ? { photo: true as const } : {}),
        ...(serviceOf(id) === null ? {} : { service: serviceOf(id) as "delivery" | "transport" }),
      });
    });
  };

  const surface = { mode: "miniapp" as const, miniAppUrl: options.miniAppUrl };

  // ── طالبُ الخدمةِ ───────────────────────────────────────────────────────────
  if (options.miniAppUrl !== null) {
    for (const [audience, bot] of [
      ["rider", "rider"],
      ["driver", "driver"],
    ] as const) {
      for (const reply of entryReplies(
        surface,
        { audience, chatId: PRIVATE_CHAT, language: LANG, registered: true },
        "/start",
      )) {
        await rec.raw.sendMessage(reply.chatId, reply.text, toTelegramMarkup(reply.keyboard));
      }
      add(
        {
          audience,
          bot,
          title: "الترحيب عند /start",
          when: "عند الضغط على «ابدأ» أو كتابة /start",
          source: "packages/application/bots/miniapp-surface.ts",
        },
        `${audience}-start`,
        true,
      );
    }
    for (const reply of movedReplies(surface, PRIVATE_CHAT, LANG, {
      audience: "rider",
      screen: "history",
    })) {
      await rec.raw.sendMessage(reply.chatId, reply.text, toTelegramMarkup(reply.keyboard));
    }
    add(
      {
        audience: "rider",
        bot: "rider",
        title: "أمرٌ انتقل إلى التطبيق",
        when: "حين يكتب أمراً صار في التطبيق المصغّر (مثل /history)",
        source: "packages/application/bots/miniapp-surface.ts",
      },
      "rider-moved",
      true,
    );
  }

  const tripFacts = {
    riderTelegramId: PRIVATE_CHAT,
    language: LANG,
    driverName: SAMPLE.driverName,
    plate: SAMPLE.plate,
    vehicle: "sedan",
  };
  const tripTitles: Record<RiderTripEvent, string> = {
    MATCHED: "قبول السائق للمشوار",
    ARRIVED: "وصول السائق",
    STARTED: "بدء الرحلة",
    COMPLETED: "انتهاء الرحلة",
    SCHEDULED: "تأكيد الطلب المجدول",
    SCHEDULE_REMINDER: "تذكير الراكب بموعده المجدول",
    SEARCH_STARTED: "بدء البحث عن سائق للطلب المجدول",
    SCHEDULE_MISSED: "إلغاء مجدول فات موعده",
    SEARCH_EXPIRED: "انتهاء مدة البحث بلا سائق",
  };
  const galleryFacts = {
    ...tripFacts,
    pickupAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    dispatchAt: new Date(Date.now() + 100 * 60 * 1000),
  };
  for (const event of [
    "MATCHED",
    "ARRIVED",
    "STARTED",
    "COMPLETED",
    "SCHEDULED",
    "SCHEDULE_REMINDER",
    "SEARCH_STARTED",
    "SCHEDULE_MISSED",
    "SEARCH_EXPIRED",
  ] as const) {
    await rec.raw.sendMessage(
      PRIVATE_CHAT,
      riderTripText(event, FAKE.order, galleryFacts),
      toTelegramMarkup(
        riderTripKeyboard(
          options.miniAppUrl,
          FAKE.order,
          LANG,
          event === "COMPLETED" ? "summary" : "ride",
        ),
      ),
    );
    add(
      {
        audience: "rider",
        bot: "rider",
        title: tripTitles[event],
        when:
          event.startsWith("SCHEDULE") || event === "SEARCH_STARTED"
            ? "طلبٌ مجدول (WR-06): عند الحجز، وقبل الموعد، وعند بدء البحث، أو إن فات الموعد"
            : "حين يغيّر السائق حالة الرحلة من التطبيق",
        source: "packages/application/dispatch/deliver-rider-trip-notice.ts",
      },
      `rider-trip-${event.toLowerCase()}`,
      true,
    );
  }

  const unmatched = createTelegramUnmatchedMessenger(rec.identifying, {
    surface: options.miniAppUrl === null ? "chat" : "miniapp",
  });
  for (const service of ["transport", "delivery"] as const) {
    const notice = {
      orderId: FAKE.order as OrderId,
      chatId: PRIVATE_CHAT,
      language: LANG,
      service,
    };
    const label = service === "transport" ? "مشوار" : "توصيل";
    await unmatched.sendWiderCircleOpened(notice);
    add(
      {
        audience: "rider",
        bot: "rider",
        title: `توسيع دائرة البحث — ${label}`,
        when: "لم يقبل أحد من السائقين القريبين فاتّسع نطاق البحث",
        source: "packages/infrastructure/notification/telegram-unmatched-notifier.ts",
      },
      `rider-wider-${service}`,
      true,
    );
    await unmatched.sendNoDriverFound(notice);
    add(
      {
        audience: "rider",
        bot: "rider",
        title: `لم يُعثر على سائق — ${label}`,
        when: "انتهت كل جولات البحث بلا سائق",
        source: "packages/infrastructure/notification/telegram-unmatched-notifier.ts",
      },
      `rider-nodriver-${service}`,
      true,
    );
  }

  // ── التفاوضُ (غيرُ المشتركين) للطرفين ──────────────────────────────────────
  const negotiation = createTelegramNegotiationMessenger(rec.identifying, rec.identifying);
  const side = (s: "driver" | "rider") => ({
    side: s,
    chatId: PRIVATE_CHAT,
    language: LANG,
    negotiationId: FAKE.negotiation,
    position: 1,
    deadlineSeconds: 60,
  });
  const NEG_SOURCE = "packages/infrastructure/notification/telegram-negotiation-notifier.ts";
  for (const s of ["rider", "driver"] as const) {
    const bot = s;
    await negotiation.sendTurnOpened(side(s));
    add(
      {
        audience: s,
        bot,
        title: "فتح دور التفاوض",
        when: "سائق من القروب ضغط «قبول» وجاء دوره",
        source: NEG_SOURCE,
      },
      `${s}-turn-opened`,
      true,
    );
    await negotiation.sendTurnOpened({ ...side(s), phase: "selected" });
    add(
      {
        audience: s,
        bot,
        title: "اختيار السائق وفتح المحادثة",
        when: "العميل ضغط «✅ اختيار السائق» — الطلب «جاري الاتفاق»",
        source: NEG_SOURCE,
      },
      `${s}-turn-selected`,
      true,
    );
    await negotiation.sendAgreed(side(s));
    add(
      { audience: s, bot, title: "تمّ الاتفاق", when: "وافق الطرفان", source: NEG_SOURCE },
      `${s}-agreed`,
      true,
    );
  }
  await negotiation.sendTurnClosed(side("rider"), "declined");
  add(
    {
      audience: "rider",
      bot: "rider",
      title: "انتهاء دور التفاوض",
      when: "انتهى دور السائق الحالي دون اتفاق",
      source: NEG_SOURCE,
    },
    "rider-turn-closed",
    true,
  );
  for (const reason of ["expired", "declined"] as const) {
    await negotiation.sendTurnClosed(side("driver"), reason);
    add(
      {
        audience: "driver",
        bot: "driver",
        title: reason === "expired" ? "انتهاء الدور بانتهاء الوقت" : "انتهاء الدور برفض العميل",
        when: "أُغلق دور السائق في التفاوض",
        source: NEG_SOURCE,
      },
      `driver-turn-closed-${reason}`,
      true,
    );
  }
  const relay = createTelegramRelaySender(rec.outbound, rec.outbound);
  const parties = {
    negotiationId: FAKE.negotiation,
    orderId: FAKE.order as OrderId,
    driverId: FAKE.driver as DriverId,
    driverChatId: PRIVATE_CHAT,
    driverLanguage: LANG,
    riderChatId: PRIVATE_CHAT,
    riderLanguage: LANG,
    position: 1,
  };
  await relay.relay(parties, "driver", "أنا على بعد خمس دقائق");
  add(
    {
      audience: "rider",
      bot: "rider",
      title: "رسالة من السائق أثناء التفاوض",
      when: "كتب السائق رسالة فنُقلت للعميل",
      source: NEG_SOURCE,
    },
    "rider-relay",
    true,
  );
  await relay.relay(parties, "rider", "أنتظرك عند البوابة 3");
  add(
    {
      audience: "driver",
      bot: "driver",
      title: "رسالة من العميل أثناء التفاوض",
      when: "كتب العميل رسالة فنُقلت للسائق",
      source: NEG_SOURCE,
    },
    "driver-relay",
    true,
  );

  // انتظارُ الدورِ: السائقُ الثاني والثالثُ بعدَ «قبول» في القروبِ (`driver-dialog.ts`).
  for (const [key, title, id] of [
    ["negotiation.claim_registered_waiting", "تسجيل الدور والانتظار", "driver-claim-waiting"],
    ["negotiation.claim_rejected_full", "اكتمل العدد", "driver-claim-full"],
    ["negotiation.claim_rejected_closed", "انتهت مهلة الطلب", "driver-claim-closed"],
  ] as const) {
    // `NEG-SELECT-01` — بطاقةُ الانتظارِ تحملُ زرَّ «إنهاء الانتظار» كما في `driver-dialog.ts`؛
    // كانت العيّنةُ تُرسَلُ بلا لوحةٍ فلم يرَ المالكُ الزرَّ.
    await rec.raw.sendMessage(
      PRIVATE_CHAT,
      t(LANG)(key, { position: 2 }),
      key === "negotiation.claim_registered_waiting"
        ? toTelegramMarkup(driverLeaveKeyboard(t(LANG), FAKE.negotiation))
        : undefined,
    );
    add(
      {
        audience: "driver",
        bot: "driver",
        title,
        when: "بعد ضغط «قبول» على بطاقة القروب",
        source: "packages/application/bots/driver-dialog.ts",
      },
      id,
      true,
    );
  }

  // ── السائقُ ────────────────────────────────────────────────────────────────
  // `ORDER-TERMS-01`: استعلامُ الشروطِ يُجابُ بعيّنةِ المالكِ (1:30 م) وما سواه بجهةِ الاتّصالِ.
  const contactSql = (async (strings: TemplateStringsArray) =>
    strings.join("").includes("rider_offer_sar from orders")
      ? [{ pickup_at: new Date("2026-10-03T10:30:00.000Z"), rider_offer_sar: 40 }]
      : [{ telegram_id: PRIVATE_CHAT, language_code: LANG }]) as unknown as Sql;
  const offers = createOfferPublisher(
    contactSql,
    rec.identifying,
    options.miniAppUrl === null ? {} : { miniAppUrl: options.miniAppUrl },
  );
  for (const service of ["delivery", "transport"] as const) {
    await offers.publishOffer({
      orderId: FAKE.order as OrderId,
      offerId: FAKE.offer as OfferId,
      driverId: FAKE.driver as DriverId,
      distanceKm: 3.4 as never,
      expiresInSeconds: 60,
      service,
      pickupLabel: SAMPLE.pickup,
      dropoffLabel: SAMPLE.dropoff,
      notes: service === "delivery" ? "مستندات في ظرف" : null,
    });
    add(
      {
        audience: "driver",
        bot: "driver",
        title:
          service === "delivery" ? "بطاقة طلب توصيل (مشترك ديلفري)" : "بطاقة مشوار (مشترك نقل)",
        when: "طلب جديد قريب من سائق مشترك ومتاح",
        source: "packages/infrastructure/notification/telegram-driver-notifier.ts",
      },
      `driver-offer-${service}`,
      true,
    );
  }

  const cancellation = createTelegramCancellationMessenger(rec.identifying);
  for (const wasAssigned of [true, false]) {
    await cancellation.sendOrderCancelled({
      orderId: FAKE.order as OrderId,
      driverId: FAKE.driver as DriverId,
      chatId: PRIVATE_CHAT,
      language: LANG,
      wasAssigned,
    });
    add(
      {
        audience: "driver",
        bot: "driver",
        title: wasAssigned ? "إلغاء طلب مُسند إليه" : "إلغاء طلب كان معروضاً عليه",
        when: "ألغى العميل الطلب",
        source: "packages/infrastructure/notification/telegram-cancellation-notifier.ts",
      },
      `driver-cancelled-${wasAssigned ? "assigned" : "offer"}`,
      true,
    );
  }

  await createTelegramLostItemMessenger(rec.identifying).sendLostItemReport({
    orderId: FAKE.order as OrderId,
    driverId: FAKE.driver as DriverId,
    chatId: PRIVATE_CHAT,
    language: LANG,
    ticketId: FAKE.ticket,
    reference: "WSL-000123",
  });
  add(
    {
      audience: "driver",
      bot: "driver",
      title: "بلاغ مفقودات",
      when: "أبلغ العميل عن غرض نسيه في المركبة",
      source: "packages/infrastructure/notification/telegram-lost-item-notifier.ts",
    },
    "driver-lost-item",
    true,
  );

  const noticeTitles: Record<SubscriptionNoticeKind, string> = {
    activated: "تفعيل الاشتراك",
    trial_expired: "انتهاء الشهر المجاني",
    expired: "انتهاء الاشتراك",
    cancelled: "إلغاء الاشتراك",
  };
  for (const kind of ["activated", "trial_expired", "expired", "cancelled"] as const) {
    await rec.raw.sendMessage(
      PRIVATE_CHAT,
      noticeText({
        noticeId: FAKE.ticket,
        kind,
        claimToken: FAKE.ticket,
        chatId: PRIVATE_CHAT,
        languageCode: LANG,
        payload: {
          plan: "both",
          price: 99,
          currency: "SAR",
          period_end: "2026-11-03T00:00:00Z",
          ends_at: "2026-11-03T00:00:00Z",
          // `GRP-LINK-01` — الرابطُ يُقرأُ من إعدادِ المدينةِ (`unsubscribed_drivers_group_link`)
          // لحظةَ إنشاءِ الإشعارِ؛ والعيّنةُ تعرضُ ما يراه السائقُ حينَ يُضبَطُ — لا البديلَ.
          group_link: "https://t.me/your_city_drivers",
        },
        attempts: 0,
        maxAttempts: 5,
      }),
      undefined,
    );
    add(
      {
        audience: "driver",
        bot: "driver",
        title: noticeTitles[kind],
        when: "تغيّرت حالة اشتراك السائق",
        source: "packages/application/subscription/deliver-notices.ts",
      },
      `driver-notice-${kind}`,
      false,
    );
  }

  const expiring = (status: string, daysLeft: number) => ({
    subscriptionId: FAKE.ticket,
    cityId: FAKE.city as CityId,
    driverId: FAKE.driver as DriverId,
    telegramId: PRIVATE_CHAT,
    languageCode: LANG,
    plan: "both",
    status,
    endsAt: new Date("2026-11-03T00:00:00Z"),
    daysLeft,
  });
  for (const [status, days, title] of [
    ["trialing", 3, "قرب انتهاء الشهر المجاني"],
    ["trialing", 1, "الشهر المجاني ينتهي غداً"],
    ["active", 3, "قرب انتهاء الاشتراك"],
    ["active", 1, "الاشتراك ينتهي غداً"],
  ] as const) {
    await warnExpiringSubscriptions({ cityId: FAKE.city as CityId, days: 3 }, {
      rpc: {
        expireDue: async () => ok({ expired: 0 }) as never,
        expiringSoon: async () => ok([expiring(status, days)]),
        recordWarning: async () => ok(undefined),
      },
      sender: {
        send: async ({ chatId, text }: { chatId: string; text: string }) => {
          await rec.raw.sendMessage(chatId, text, undefined);
          return ok(undefined);
        },
      },
    } as never);
    add(
      {
        audience: "driver",
        bot: "driver",
        title,
        when: "مهمة دورية تنبّه قبل انتهاء الاشتراك",
        source: "packages/application/subscription/expire-subscriptions.ts",
      },
      `driver-expiring-${status}-${days}`,
      false,
    );
  }

  await warnExpiringDocuments(
    { cityId: FAKE.city as CityId, days: 30 },
    {
      rpc: {
        expiringSoon: async () =>
          ok([
            {
              documentId: FAKE.ticket,
              driverId: FAKE.driver,
              telegramId: PRIVATE_CHAT,
              languageCode: LANG,
              docType: "driving_license",
              expiresAt: "2026-11-01",
              daysLeft: 29,
            },
          ]),
        recordWarning: async () => ok(undefined),
      },
      sender: {
        send: async ({ chatId, text }) => {
          await rec.raw.sendMessage(chatId, text, undefined);
          return ok(undefined);
        },
      },
    },
  );
  add(
    {
      audience: "driver",
      bot: "driver",
      title: "قرب انتهاء وثيقة",
      when: "مهمة دورية تنبّه قبل انتهاء وثائق السائق",
      source: "packages/application/driver/warn-expiring-documents.ts",
    },
    "driver-document-expiry",
    false,
  );

  // ── ردُّ الدعمِ لصاحبِ التذكرةِ ─────────────────────────────────────────────
  const owner = createTicketOwnerNotifier(rec.support);
  const resolutionTitles: Record<SupportResolution, string> = {
    activate: "ردّ الدعم: تفعيل الاشتراك",
    terminate: "ردّ الدعم: إنهاء الاشتراك",
    reject: "ردّ الدعم: رفض الطلب",
    answer: "ردّ الدعم: إجابة مكتوبة",
  };
  for (const action of ["activate", "terminate", "reject", "answer"] as const) {
    await owner.notifyResolution({
      telegramId: PRIVATE_CHAT,
      action,
      language: LANG,
      note: action === "answer" ? "تمّت مراجعة طلبك، وسيُعاد المبلغ خلال ٣ أيام عمل." : null,
    });
    add(
      {
        audience: "driver",
        bot: "driver",
        title: resolutionTitles[action],
        when: "قرّر فريق الدعم في تذكرة السائق",
        source: "packages/infrastructure/notification/telegram-support-notifier.ts",
      },
      `driver-resolution-${action}`,
      true,
    );
  }
  await owner.notifyResolution({
    telegramId: PRIVATE_CHAT,
    action: "answer",
    language: LANG,
    note: "وجدنا الغرض المفقود وسيتواصل معك السائق.",
  });
  add(
    {
      audience: "rider",
      bot: "rider",
      title: resolutionTitles.answer,
      when: "ردّ فريق الدعم على تذكرة العميل",
      source: "packages/infrastructure/notification/telegram-support-notifier.ts",
    },
    "rider-resolution-answer",
    true,
  );

  const safetyResolution = createTelegramSafetyResolutionMessenger(rec.identifying);
  for (const decision of ["close", "block_reporter"] as const) {
    await safetyResolution.sendResolution({ chatId: PRIVATE_CHAT, language: LANG, decision });
    add(
      {
        audience: "rider",
        bot: "rider",
        title: decision === "close" ? "إغلاق بلاغ الطوارئ" : "حظر مُبلِّغ الطوارئ",
        when: "قرّر فريق السلامة في بلاغ استغاثة",
        source: "packages/infrastructure/notification/telegram-safety-resolution-notifier.ts",
      },
      `rider-safety-${decision}`,
      true,
    );
  }

  // ── البثُّ الجماعيُّ ────────────────────────────────────────────────────────
  for (const bot of ["rider", "driver"] as const) {
    await createBroadcastPublisher({
      sendMessage: async (chatId, text, opts) => {
        await rec.raw.sendMessage(chatId, text, opts.reply_markup);
        return { message_id: 1 };
      },
    }).publish({
      recipientId: FAKE.ticket,
      audience: bot === "rider" ? "riders" : "drivers",
      claimToken: FAKE.ticket,
      chatId: PRIVATE_CHAT,
      languageCode: LANG,
      attempts: 0,
      maxAttempts: 3,
      body: "نص الرسالة الجماعية كما يكتبه المسؤول في صفحة البثّ.",
      silent: false,
      // الرابطُ اختياريٌّ في البثِّ؛ يُعرَضُ برابطِ التطبيقِ لا بمضيفٍ مكتوبٍ هنا (حاجزُ الصادرِ).
      linkLabel: options.miniAppUrl === null ? null : "التفاصيل",
      linkUrl: options.miniAppUrl === null ? null : buildMiniAppUrl(options.miniAppUrl, null),
    } as never);
    add(
      {
        audience: bot,
        bot,
        title: "رسالة البثّ الجماعي",
        when: "حين يرسل المسؤول بثّاً من صفحة البثّ",
        source: "packages/infrastructure/notification/telegram-broadcast-sender.ts",
      },
      `${bot}-broadcast`,
      false,
    );
  }

  // ── قروبُ السائقين ─────────────────────────────────────────────────────────
  const unsub = createUnsubscribedGroupPublisher(rec.identifying);
  for (const service of ["delivery", "transport"] as const) {
    await unsub.publishCard({
      groupId: GROUP_CHAT,
      negotiationId: FAKE.negotiation,
      orderId: FAKE.order as OrderId,
      cityId: FAKE.city as CityId,
      service,
      cycle: 1,
      areaLabel: approximateArea(SAMPLE.pickupPoint as never),
      notes: service === "delivery" ? "مستندات في ظرف" : null,
      excludedDriverIds: [],
      pickupAt: service === "delivery" ? null : new Date("2026-10-03T10:30:00.000Z"),
      // `ORDER-OFFER-01` — عيّنةُ المالكِ: «المدفوع: 40 ريال» في المشوارِ، و«قابل للتفاوض» في التوصيلِ.
      offerSar: service === "delivery" ? null : 40,
      pickupLabel: "مطار الملك عبدالعزيز الدولي",
      dropoffLabel: "البلد",
    });
    add(
      {
        audience: "drivers_group",
        bot: "driver",
        title: service === "delivery" ? "بطاقة طلب توصيل" : "بطاقة مشوار",
        when: "لم يقبل المشتركون فنُشر الطلب في قروب المدينة",
        source: NEG_SOURCE,
      },
      `group-unsub-${service}`,
      true,
    );
  }

  // ── قروبُ الدعمِ ────────────────────────────────────────────────────────────
  const supportCards = createSupportCardPublisher(rec.support);
  const ticket = (type: SupportTicket["type"], live: boolean): SupportTicket => ({
    id: FAKE.ticket,
    type,
    status: "open",
    cityName: SAMPLE.city,
    message:
      type === "subscription"
        ? "حوّلت مبلغ الاشتراك ولم يُفعَّل بعد."
        : "السائق أخذ طريقاً أطول من المعتاد.",
    attachmentFileId: null,
    orderId: type === "subscription" ? null : FAKE.order,
    createdAt: new Date("2026-10-03T07:00:00Z"),
    owner: {
      fullName: type === "subscription" ? SAMPLE.driverName : SAMPLE.riderName,
      phone: SAMPLE.phone,
      telegramId: "123456789",
      telegramUsername: "sample_user",
      languageCode: LANG,
    },
    subscription: live
      ? {
          plan: "both" as never,
          status: "active" as never,
          currentPeriodEnd: new Date("2026-11-03T00:00:00Z"),
          trialEndsAt: null,
          isLive: true,
        }
      : null,
  });
  for (const [type, live, title] of [
    ["subscription", true, "تذكرة اشتراك سائق"],
    ["ride_dispute", false, "تذكرة نزاع على رحلة"],
  ] as const) {
    const t = ticket(type, live);
    await supportCards.publish({ groupId: GROUP_CHAT, ticket: t, actions: availableActions(t) });
    add(
      {
        audience: "support_group",
        bot: "driver",
        title,
        when: "فتح مستخدم تذكرة دعم",
        source: "packages/infrastructure/notification/telegram-support-notifier.ts",
      },
      `support-${type}`,
      true,
    );
  }

  // ── قروبُ التصعيدِ والسلامةِ ───────────────────────────────────────────────
  const escalation = createEscalationGroupPublisher(rec.identifying);
  const reasons = {
    unsubscribed_cycles_exhausted: "تصعيد: انتهت دورات القروب",
    no_driver_at_all: "تصعيد: لا سائق إطلاقاً",
    broadcast_rounds_exhausted: "تصعيد: انتهت جولات البحث",
  } as const;
  for (const reason of Object.keys(reasons) as (keyof typeof reasons)[]) {
    await escalation.publishEscalation({
      groupId: GROUP_CHAT,
      orderId: FAKE.order as OrderId,
      cityId: FAKE.city as CityId,
      service: "transport",
      reason,
      areaLabel: approximateArea(SAMPLE.pickupPoint as never),
      cyclesTried: 3,
    });
    add(
      {
        audience: "escalation_group",
        bot: "driver",
        title: reasons[reason],
        when: "طلب لم يجد سائقاً بكل الطرق",
        source: NEG_SOURCE,
      },
      `escalation-${reason}`,
      true,
    );
  }

  const safety = createSafetyCardPublisher({
    sendMessage: rec.raw.sendMessage,
    sendPhoto: async () => "1",
    sendLocation: async () => "1",
  });
  const sos = (
    orderId: string | null,
    reason: "sos" | "driver_cannot_complete",
    reporterRole: "rider" | "driver",
  ) => ({
    deliveryId: FAKE.ticket,
    incidentId: FAKE.incident,
    claimToken: FAKE.ticket,
    groupId: GROUP_CHAT,
    orderId,
    service: orderId === null ? null : "transport",
    reporterRole,
    status: "received",
    incidentReason: reason,
    locationWkt: "POINT(39.15649 21.67956)",
    maxAttempts: 5,
  });
  for (const [card, title, id] of [
    [sos(FAKE.order, "sos", "rider"), "استغاثة أثناء رحلة", "safety-sos-ride"],
    [sos(null, "sos", "driver"), "استغاثة بلا رحلة", "safety-sos-no-order"],
    [
      sos(FAKE.order, "driver_cannot_complete", "driver"),
      "السائق لا يستطيع إكمال الرحلة",
      "safety-cannot-complete",
    ],
  ] as const) {
    await safety.publish(card);
    add(
      {
        audience: "escalation_group",
        bot: "driver",
        title,
        when: "بلاغ سلامة من أحد طرفي الرحلة",
        source: "packages/infrastructure/notification/telegram-safety-notifier.ts",
      },
      id,
      true,
    );
  }

  return specimens;
}

// ── القاموسُ الكاملُ ────────────────────────────────────────────────────────

/** جمهورُ نصِّ القاموسِ — `shared` لما يُعرَضُ للطرفينِ أو لا يُعرَفُ له جمهورٌ من مفتاحِه. */
export type CatalogAudience = GalleryAudience | "shared";

export interface CatalogEntry {
  readonly key: string;
  readonly text: string;
}

export interface CatalogGroup {
  readonly audience: CatalogAudience;
  readonly label: string;
  readonly entries: readonly CatalogEntry[];
}

/** القواعدُ بالترتيبِ: أوّلُ بادئةٍ تطابقُ تحكمُ. */
const CATALOG_RULES: readonly (readonly [string, CatalogAudience])[] = [
  ["group.unsub_", "drivers_group"],
  ["group.escalation_", "escalation_group"],
  ["safety.group_card", "escalation_group"],
  ["safety.location_unknown", "escalation_group"],
  ["safety.reporter_", "escalation_group"],
  ["safety.service_", "escalation_group"],
  ["safety.claim_button", "escalation_group"],
  ["safety.close_button", "escalation_group"],
  ["safety.block_button", "escalation_group"],
  ["safety.claimed", "escalation_group"],
  ["safety.closed", "escalation_group"],
  ["safety.blocked", "escalation_group"],
  ["safety.reason_", "escalation_group"],
  ["safety.choose_reason", "escalation_group"],
  ["safety.already_handled", "escalation_group"],
  ["support.card", "support_group"],
  ["support.claim", "support_group"],
  ["support.activate_", "support_group"],
  ["support.terminate_button", "support_group"],
  ["support.reject_button", "support_group"],
  ["support.answer_", "support_group"],
  ["support.action_done_", "support_group"],
  ["support.already_", "support_group"],
  ["support.flag_", "support_group"],
  ["support.not_authorized", "support_group"],
  ["support.no_driver_on_ticket", "support_group"],
  ["menu.rider", "rider"],
  ["menu.driver", "driver"],
  ["rider.", "rider"],
  ["tracking.", "rider"],
  ["rating.", "rider"],
  ["waiting.", "rider"],
  ["driver.", "driver"],
  ["documents.", "driver"],
  ["subscription.", "driver"],
  ["reputation.", "driver"],
];

const CATALOG_LABELS: Record<CatalogAudience, string> = {
  rider: "الراكب",
  driver: "السائق",
  drivers_group: "قروب السائقين",
  support_group: "قروب الدعم",
  escalation_group: "قروب التصعيد والسلامة",
  shared: "مشتركة بين الطرفين",
};

export function catalogAudienceOf(key: string): CatalogAudience {
  for (const [prefix, audience] of CATALOG_RULES) if (key.startsWith(prefix)) return audience;
  return "shared";
}

/** كلُّ مفاتيحِ `ar.json` مجمّعةً بالجمهورِ، بترتيبِ ورودِها في الملفِّ. */
export function buildMessageCatalog(dictionary: Readonly<Record<string, string>>): CatalogGroup[] {
  const order: CatalogAudience[] = [
    "rider",
    "driver",
    "drivers_group",
    "support_group",
    "escalation_group",
    "shared",
  ];
  const buckets = new Map<CatalogAudience, CatalogEntry[]>(order.map((a) => [a, []]));
  for (const [key, text] of Object.entries(dictionary)) {
    buckets.get(catalogAudienceOf(key))?.push({ key, text });
  }
  return order.map((audience) => ({
    audience,
    label: CATALOG_LABELS[audience],
    entries: buckets.get(audience) ?? [],
  }));
}
