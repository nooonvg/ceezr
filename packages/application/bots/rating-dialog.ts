/**
 * الغرض: قسم دورة الرحلة والتقييم المشترك بين البوتين: بدء الرحلة، إنهاؤها بملخّص،
 *   ثم طلب تقييم من الطرفين وتسجيله. مشترك لأن سلوك التقييم واحد في الاتجاهين.
 * الحالة: منفّذ فعلياً — المرحلة 2.5.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: driver-dialog، rider-dialog، لوحة الإدارة (نفس حالات الاستخدام)
 * ملاحظات مستقبلية: عند إضافة تعليق نصّي بعد النجوم تُضاف خطوة awaiting_rating_comment.
 */

import { parseStars, starsBar } from "../../domain/reputation/index.ts";
import type { RoutingProvider } from "../../maps/core/index.ts";
import { t } from "../../shared/i18n/index.ts";
import type { OrderId } from "../../shared/kernel/index.ts";
import { noticeRiderOfTrip, type RiderTripNoticeDeps } from "../driver/rider-trip-notice.ts";
import type { RatingPort, RideLifecyclePort } from "../reputation/index.ts";
import { completeRide, startRide, submitRating } from "../reputation/index.ts";
import type { DriverTripCardReader } from "../tracking/driver-trip-card.ts";
import { driverTripCard } from "../tracking/driver-trip-card.ts";
import type { LiveTrackingPort } from "../tracking/live-tracking.ts";
import { driverTripPin, driverTripText } from "./driver-trip-reply.ts";
import type { BotReply, Keyboard, Sender, SessionStore } from "./types.ts";

/**
 * تبليغ الطرف المقابل. لازم لأن إنهاء الرحلة يقع في بوت السائق بينما العميل على بوت
 * آخر: إعادة رسالة موجَّهة إليه من مُرسِل بوت السائق تذهب إلى بوت لا يحادثه أصلاً.
 */
/** لوحة أزرار داخلية حصراً — النوع المضيَّق يجعل الاختبار يقرأ rows بلا تضييق يدوي. */
export type InlineKeyboard = Extract<Keyboard, { readonly kind: "inline" }>;

export interface CounterpartNotifier {
  notify(telegramId: string, text: string, keyboard: Keyboard | null): Promise<void>;
}

export interface RatingDialogDependencies {
  /**
   * البند 5 — إغلاق الجلسة عند التقييم.
   *
   * كان هذا المنفذ مُعلَناً هنا ومربوطاً في `container.ts` و**بلا مستدعٍ واحد** في
   * هذا الملفّ: نيّةٌ كُتبت ولم تُنفَّذ. فكانت الرحلة تنتهي ويُقيَّم الطرفان وتبقى
   * حالة الحوار كما كانت لحظةَ آخر خطوة نصّية.
   */
  readonly sessions: SessionStore;
  readonly lifecycle: RideLifecyclePort;
  readonly ratings: RatingPort;
  /** غيابه يعني أن الطرف المقابل لا يُبلَّغ، لا أن يُبلَّغ على البوت الخطأ. */
  readonly counterpart?: CounterpartNotifier;
  /**
   * `WR-15` (ADR 0265) — إخطارا البدءِ والإكمالِ للراكبِ صفّانِ في صندوقِ الصادرِ بمفتاحِ
   * `rider_trip:<order>:STARTED|COMPLETED` نفسِه الذي يودعُه مسارُ Mini App. حين يُعطى
   * يحلُّ محلَّ رسالتَي `rating.started_rider` و`rating.completed_rider` المباشرتين.
   * وطلبُ التقييمِ بالنجومِ يبقى عبرَ `counterpart`: سؤالٌ تفاعليٌّ لا إخطارُ طور.
   */
  readonly riderNotice?: RiderTripNoticeDeps;
  /**
   * المرحلة ٦ — إغلاق جلسة التتبّع وإيقاف البثّ عن العميل عند نهاية الرحلة.
   *
   * ولماذا هنا لا في `completeRide`؟ لأن حالة الاستخدام تلك تكتب في القاعدة
   * وتُعيد ملخّصاً، وليس من شأنها إيقاف ناقل. والحوار هو من يعرف أن الرحلة
   * انتهت **وأن الإنهاء استقرّ**، فلا تُوقف خريطة عميلٍ رحلته مازالت جارية
   * لأن الإنهاء رُفض في القاعدة.
   */
  readonly tracking?: LiveTrackingPort;
  /**
   * المرحلة ١٢ — بطاقة الرحلة عند بدئها. قياسٌ بمسبار تنفيذ: ردّ البدء كان
   * «🚗 بدأت الرحلة. رحلة موفّقة» بلا مقصدٍ ولا إحداثية — أي أن اللحظة التي
   * يبدأ فيها السائق القيادة إلى المقصد هي بالضبط اللحظة التي لا يُخبَر فيها به.
   *
   * والمفتاح `driverTelegramId` لا معرّف السائق: هو نفس المفتاح الذي تُصرَّح به
   * `lifecycle.start` أعلاه، فلا معيار تصريحٍ ثانٍ في نفس الدالّة.
   */
  readonly tripCards?: DriverTripCardReader;
  /** المرحلة ١٥ — مزوّد التوجيه لزمن الوصول في بطاقة بدء الرحلة. */
  readonly routing?: RoutingProvider;
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
}

/** أوّل ثمانية أحرف تكفي للإشارة البشرية إلى الرحلة، والمعرّف الكامل في الزرّ. */
export function shortOrderId(orderId: string): string {
  return orderId.slice(0, 8);
}

/** لوحة نجوم من خمسة أزرار في صفّ واحد — الضغطة أسهل من كتابة رقم وأقلّ خطأً. */
export function starsKeyboard(orderId: string, language: string): InlineKeyboard {
  const tr = t(language);
  return {
    kind: "inline",
    rows: [
      [1, 2, 3, 4, 5].map((value) => ({
        label: tr("rating.star_button", { stars: value }),
        data: `rate:${value}:${orderId}`,
      })),
    ],
  };
}

/** زرّ بدء الرحلة — يحمل معرّف الطلب فلا يحتاج السائق أن يحفظه أو يكتبه. */
export function startRideKeyboard(orderId: string, language: string): InlineKeyboard {
  return {
    kind: "inline",
    rows: [[{ label: t(language)("rating.start_button"), data: `ride:start:${orderId}` }]],
  };
}

/** زرّ إنهاء الرحلة — يظهر بعد البدء فقط، فلا يُنهي أحد رحلة لم تبدأ. */
export function completeRideKeyboard(orderId: string, language: string): InlineKeyboard {
  return {
    kind: "inline",
    rows: [[{ label: t(language)("rating.complete_button"), data: `ride:complete:${orderId}` }]],
  };
}

/** يحوّل الثواني إلى «د دقيقة» أو «س ساعة و د دقيقة» بلا مكتبة تواريخ. */
export function formatDuration(seconds: number, language: string): string {
  const tr = t(language);
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return tr("rating.duration_minutes", { minutes });
  return tr("rating.duration_hours", {
    hours: Math.floor(minutes / 60),
    minutes: minutes % 60,
  });
}

/** يبدأ السائق الرحلة المُسنَدة إليه. أي طلب ليس في حالة matched يُرفض في القاعدة. */
export async function handleStartRide(
  orderId: OrderId,
  sender: Sender,
  language: string,
  deps: RatingDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(language);
  const result = await startRide(
    { orderId, driverTelegramId: sender.telegramUserId },
    { lifecycle: deps.lifecycle },
  );
  if (!result.ok) return [reply(sender, tr("common.error_try_again"))];
  if (!result.value.started) return [reply(sender, tr("rating.ride_not_startable"))];

  // العميل يقف في الشارع ولا يعلم أن سائقه انطلق ما لم يُبلَّغ. النمط نفسه المستعمل
  // في الإنهاء: بوته هو، لغته هو، وفشل التبليغ لا يُبطل بدءاً وقع فعلاً في القاعدة.
  const summary = result.value.summary;
  if (deps.riderNotice !== undefined) {
    await noticeRiderOfTrip(deps.riderNotice, String(orderId), "STARTED");
  } else if (deps.counterpart !== undefined && summary !== null) {
    const riderLang = summary.rider.languageCode;
    await deps.counterpart.notify(
      summary.rider.telegramId,
      t(riderLang)("rating.started_rider", {
        driver: summary.driver.fullName,
        order: shortOrderId(String(summary.orderId)),
      }),
      null,
    );
  }

  const started = reply(
    sender,
    tr("rating.ride_started"),
    completeRideKeyboard(String(orderId), language),
  );
  if (deps.tripCards === undefined) return [started];
  /**
   * البطاقة تُقرأ **بعد** نجاح البدء لا قبله: قراءتها قبله كانت ستعرض المقصد
   * لمن رُفض بدؤه في القاعدة (طلبٌ ليس `matched`)، فيقود إلى مقصد رحلةٍ لم تبدأ.
   * والحالة الآن `in_progress` فالبطاقة تُظهر المقصد لا نقطة الانطلاق.
   */
  const cardResult = await driverTripCard(
    { driverTelegramId: sender.telegramUserId },
    { cards: deps.tripCards, routing: deps.routing ?? null },
  );
  if (cardResult === null) return [started];
  const { view, eta } = cardResult;
  const card = reply(sender, driverTripText(view, eta, tr));
  const pin = driverTripPin(view, tr);
  return [started, pin === undefined ? card : { ...card, mapPin: pin }];
}

/**
 * إنهاء الرحلة: ملخّص للسائق، وملخّص للعميل، ثم طلب تقييم من كلٍّ منهما بلغته.
 * الطلبان يخرجان معاً لا واحداً بعد الآخر: من انتظر دوره في التقييم لا يقيّم.
 */
export async function handleCompleteRide(
  orderId: OrderId,
  sender: Sender,
  language: string,
  deps: RatingDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(language);
  const result = await completeRide(
    { orderId, driverTelegramId: sender.telegramUserId },
    { lifecycle: deps.lifecycle },
  );
  if (!result.ok) return [reply(sender, tr("common.error_try_again"))];

  const summary = result.value.summary;
  if (!result.value.completed || summary === null) {
    return [reply(sender, tr("rating.ride_not_completable"))];
  }

  /**
   * المرحلة ٦ — الجلسة تُغلق قبل إرسال الملخّصات.
   *
   * الترتيب مقصود: لو أُرسلت الملخّصات أوّلاً لقرأ العميل «انتهت رحلتك»
   * وفوقها خريطةٌ مازال سائقه يتحرّك عليها — وهو تناقضٌ يراه بعينه ويفتح بلاغاً.
   * وإن فشل الإيقاف فلا يُبطِل رحلةً اكتملت: الحاجز داخل المنفذ، ومدّة البثّ
   * تنتهي بنفسها على الأسوأ.
   */
  await deps.tracking?.onTripEnded(String(summary.orderId), "TRIP_COMPLETED");

  const driverLang = summary.driver.languageCode;
  const riderLang = summary.rider.languageCode;
  const duration = (lang: string) => formatDuration(summary.durationSeconds, lang);
  const short = shortOrderId(String(summary.orderId));

  // العميل يُبلَّغ عبر بوته هو، بلغته هو. فشل تبليغه لا يُبطل رحلة اكتملت فعلاً في القاعدة.
  if (deps.riderNotice !== undefined) {
    await noticeRiderOfTrip(deps.riderNotice, String(summary.orderId), "COMPLETED");
  }
  if (deps.counterpart !== undefined) {
    if (deps.riderNotice === undefined) {
      await deps.counterpart.notify(
        summary.rider.telegramId,
        t(riderLang)("rating.completed_rider", {
          order: short,
          duration: duration(riderLang),
          driver: summary.driver.fullName,
        }),
        null,
      );
    }
    await deps.counterpart.notify(
      summary.rider.telegramId,
      t(riderLang)("rating.ask_rating_driver", { driver: summary.driver.fullName }),
      starsKeyboard(String(summary.orderId), riderLang),
    );
  }

  return [
    reply(
      sender,
      t(driverLang)("rating.completed_driver", {
        order: short,
        duration: duration(driverLang),
        rider: summary.rider.fullName,
      }),
    ),
    reply(
      sender,
      t(driverLang)("rating.ask_rating_rider", { rider: summary.rider.fullName }),
      starsKeyboard(String(summary.orderId), driverLang),
    ),
  ];
}

/**
 * ضغطة نجمة: `rate:<نجوم>:<معرّف الطلب>`. الاتجاه يُستنتج في القاعدة من هوية الضاغط،
 * فلا يستطيع أحد أن يقيّم نيابة عن طرف آخر ولو زوَّر بيانات الزرّ.
 */
export async function handleRatingCallback(
  data: string,
  sender: Sender,
  language: string,
  deps: RatingDialogDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(language);
  const [, rawStars, orderId] = data.split(":");
  if (rawStars === undefined || orderId === undefined || orderId.length === 0) {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const stars = parseStars(rawStars);
  if (!stars.ok) return [reply(sender, tr("rating.invalid_stars"))];

  const result = await submitRating(
    {
      orderId: orderId as OrderId,
      raterTelegramId: sender.telegramUserId,
      stars: stars.value,
      comment: null,
    },
    { ratings: deps.ratings },
  );
  if (!result.ok) return [reply(sender, tr("common.error_try_again"))];

  if (!result.value.recorded) {
    switch (result.value.reason) {
      case "ALREADY_RATED":
        return [reply(sender, tr("rating.already_rated"))];
      case "RATING_WINDOW_CLOSED":
        return [reply(sender, tr("rating.window_closed"))];
      case "ORDER_NOT_COMPLETED":
        return [reply(sender, tr("rating.ride_not_completed"))];
      case "RATER_NOT_PARTY_TO_ORDER":
        return [reply(sender, tr("rating.not_a_party"))];
      default:
        return [reply(sender, tr("common.error_try_again"))];
    }
  }

  // البند 5 — نهاية الرحلة نهايةُ جلسة.
  //
  // التقييم آخر ما يقع في دورة الطلب، فبعده لا خطوة حوارٍ معلَّقة لها معنى. وترْكُها
  // ليس حياداً: خطوةٌ قديمة باقية تخطف أول رسالة يكتبها المستخدم بعدها. الحالة
  // الواقعية: راكبٌ كان يكتب شكوى (`awaiting_support_message`) حين انتهت رحلته،
  // فضغط النجمة وصُرِف عن الشكوى — ثم كتب سؤالاً عادياً بعد أيام فذهب نصّه تذكرةَ
  // دعمٍ على طلبٍ مضى. أو سائقٌ في منتصف إعادة التوثيق يُقيّم راكباً فتُقرأ رسالته
  // التالية لوحةَ مركبة. وكلاهما يظهر للمستخدم عطباً عشوائياً لا سبب له.
  //
  // ولا يُحذف شيء من المحادثة: الجلسة حالةٌ في Redis لا رسائل في تلغرام، ورسائل
  // الرحلة وتقييمها تبقى كلّها ظاهرةً كما هي — وهي سجلّ المستخدم الوحيد.
  //
  // ولا تضيع اللغة بمحو الجلسة: `createLanguageHydration` يعيد بناء الحالة من
  // `users.language_code` قبل كل تحديث، فالقاعدة هي المرجع لا الجلسة.
  //
  // وفشل المحو لا يُبطل تقييماً كُتب في القاعدة فعلاً: الشكر يُقال على أي حال،
  // وأسوأ ما يقع أن تنقضي الجلسة بمهلتها بعد نصف ساعة كما كانت تنقضي قبل هذا البند.
  await deps.sessions.clear(sender.telegramUserId);

  return [reply(sender, tr("rating.thanks", { bar: starsBar(stars.value) }))];
}
