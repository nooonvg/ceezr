/**
 * الغرض: نطاقُ عروضِ السائقِ — شكلُ العرضِ ولوحِه وتفاصيلِه، **وحسابُ العدِّ
 *   التنازليِّ بفرقِ قراءتَينِ لا بساعةٍ مُطلقةٍ** (`F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/application/driver/driver-offers.ts` ·
 *   `packages/infrastructure/driver/driver-offers-store.ts` ·
 *   `apps/miniapp/src/surfaces/driver/offers/offers-view.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` (الرحلةُ النشطةُ للسائقِ) تقرأُ الطلبَ
 *   المطابَقَ بالأنواعِ نفسِها، فلا نسخةَ ثانيةً لشكلِ الطلبِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ العدُّ التنازليُّ **فرقٌ** لا مقارنةٌ بساعةِ الجهازِ
 *
 * لو حسبَ العميلُ الباقيَ `expiresAt - Date.now()` لَدخلَ في الحسابِ **انحرافُ
 * ساعةِ الهاتفِ** كلُّه: هاتفٌ متأخّرٌ دقيقةً يُظهِرُ عرضاً منتهياً «باقياً»
 * فيضغطُ السائقُ قبولاً مردوداً، وهاتفٌ متقدِّمٌ دقيقةً **يُخفي عرضاً صالحاً**
 * فيُفقَدُ عملٌ بلا سببٍ.
 *
 * والمُتَّخَذُ أنَّ الخادمَ يقولُ `secondsLeft` **ولحظتَه**، والعميلُ يقيسُ
 * **الزمنَ المنقضيَ عندَه** فرقاً بينَ قراءتَينِ من ساعتِه نفسِها — والانحرافُ
 * يسقطُ في الطرحِ لأنَّه ثابتٌ في القراءتَينِ. فالجهازُ يقيسُ مدّةً ولا يحكمُ
 * على مهلةٍ، والحكمُ على الصلاحيّةِ يبقى للقاعدةِ (`isClaimable`).
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()` — تُمرَّرُ الأرقامُ
 *      وسائطَ. والحاجزُ يُسقِطُ CI إن دخلَت ساعةٌ ههنا.
 *   ــ **لا يعرفُ أجرةً ولا وسيلةَ دفعٍ**: الطبقةُ الماليّةُ محجوبةٌ
 *      (`ADR 0039` §٤ · `م13-7` · `DEC-11`) — **ولا حقلَ فارغاً لها**.
 *   ــ **لا يُقدِّرُ مدّةَ وصولٍ**: `ADR 0024` امتناعٌ مُصنَّفٌ، ولا سرعةَ
 *      ثابتةً تُحوِّلُ مسافةً إلى دقائقَ.
 *   ــ **لا يُعيدُ قياسَ مسافةٍ**: القياسُ في القاعدةِ، وههنا نقلُه موسوماً.
 */

import type { ServiceType } from "../../shared/kernel/index.ts";
import type { TaggedDistance } from "../quote/distance-kind.ts";

/** حالاتُ العرضِ كما في نوعِ القاعدةِ المعدودِ `offer_status` — لا سادسةَ. */
export const DRIVER_OFFER_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "expired",
  "cancelled",
] as const;

export type DriverOfferStatus = (typeof DRIVER_OFFER_STATUSES)[number];

export function isDriverOfferStatus(value: unknown): value is DriverOfferStatus {
  return typeof value === "string" && (DRIVER_OFFER_STATUSES as readonly string[]).includes(value);
}

/** حالاتُ الطلبِ — تُنقَلُ كما هيَ لتقولَ الشاشةُ «سُبِقتَ» لا «عطبٌ». */
export const DRIVER_ORDER_STATUSES = [
  "scheduled",
  "searching",
  "matched",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
] as const;

export type DriverOrderStatus = (typeof DRIVER_ORDER_STATUSES)[number];

export function isDriverOrderStatus(value: unknown): value is DriverOrderStatus {
  return typeof value === "string" && (DRIVER_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isServiceType(value: unknown): value is ServiceType {
  return value === "transport" || value === "delivery";
}

/**
 * بطاقةُ عرضٍ في اللوحِ. والمسافتانِ **موسومتانِ أو معدومتانِ**، ولا صفرَ
 * يتظاهرُ بقياسٍ (`ADR 0023`).
 */
export interface DriverOfferCard {
  readonly offerId: string;
  readonly orderId: string;
  readonly round: number;
  readonly service: ServiceType;
  /** بالثوانِ **كما قالَتها القاعدةُ لحظةَ القراءةِ** — لا تُحسَبُ ههنا. */
  readonly secondsLeft: number;
  /** المسافةُ إلى الراكبِ **كما قِيسَت لحظةَ البثِّ** لا الآنَ. */
  readonly riderDistance: TaggedDistance | null;
  /** وترُ الرحلةِ — `null` لطلبٍ بلا وجهةٍ. */
  readonly tripDistance: TaggedDistance | null;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  /** `LOC-TRUST-01` — ما أدخلَه الراكبُ زيادةً على الاسم. غائبٌ = لم يُقرَأ (قاعدةٌ أقدم). */
  readonly pickupExtras?: DriverPlaceExtras;
  readonly dropoffExtras?: DriverPlaceExtras | null;
  /** `WR-05` — معنى المبلغِ قبلَ القبول. غائبٌ = لم يُقرَأ. */
  readonly offerTerms?: DriverOfferTerms;
}

/**
 * `WR-05` — سياسةُ المبلغِ كما كتبَها الراكب: `mode` `null` لطلبٍ أقدمَ من السياسة.
 * لا تحسبُها المنصّةُ ولا تُحصّلُها؛ تنقلُها كما تنقلُ ملاحظتَه.
 */
export interface DriverOfferTerms {
  readonly mode: "fixed" | "suggested" | "open" | null;
  readonly offerSar: number | null;
  /**
   * `WR-06` — وقتُ حضورِ السائقِ كما طلبَه الراكب (ISO)، و`null` = الآن. كانَ يظهرُ في رسالةِ
   * البوتِ وبطاقةِ القروبِ ويغيبُ عن بطاقةِ التطبيق، فيقبلُ السائقُ موعدًا لاحقًا كأنّه الآن.
   */
  readonly pickupAt?: string | null;
}

/**
 * `LOC-TRUST-01` — رابطُ الراكبِ الأصليُّ وملاحظاتُ المكانِ والنقطةُ (لبناءِ رابطِ الفتحِ
 * حينَ لا رابط). يُقرأُ من `orders` بعدَ أن تحكمَ دالّةُ القاعدةِ بأنَّ العرضَ للسائق.
 */
export interface DriverPlaceExtras {
  readonly link: string | null;
  readonly notes: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface DriverOfferBoard {
  /** لحظةُ الخادمِ — تُنشَرُ كي يكونَ العدُّ فرقاً لا مقارنةً. */
  readonly serverTime: string;
  readonly isAvailable: boolean;
  readonly availabilityChangedAt: string | null;
  readonly isBlocked: boolean;
  /** أسبابُ حجبِ البثِّ (`F12-14`) — تُفسِّرُ لوحاً فارغاً ولا تُخترَعُ. */
  readonly blockReasons: readonly string[];
  /**
   * `WR-11` — لِمَ لا يصلُ سائقًا متوفّرًا عرضٌ وإن لم يكن محجوبًا: الأسبابُ نفسُها التي
   * يستبعدُه بها التوزيعُ (`rejectionReasonFor`) ممّا يُعرَفُ بلا طلب. فارغةٌ = مؤهَّلٌ لما يُعرَف.
   * اختياريّةٌ كي لا تنكسرَ المستدعياتُ القديمة.
   */
  readonly eligibilityReasons?: readonly DriverEligibilityReason[];
  readonly offers: readonly DriverOfferCard[];
}

/** أسبابُ الاستبعادِ التي تُعرَفُ بلا طلبٍ بعينِه — بأسمائِها في `RejectionReason`. */
export type DriverEligibilityReason =
  | "NOT_VERIFIED"
  | "NO_LOCATION"
  | "STALE_LOCATION"
  /** `WR-23` — آخرُ موضعٍ حكمُه `ALERT`، فلا يُرتَّبُ به التوزيع (كـ`rejectionReasonFor`). */
  | "UNTRUSTED_LOCATION";

/** موضعٌ باسمِه وإحداثيّتِه — والاسمُ قد يغيبُ فيُقالُ عَدَمُه لا فراغُه. */
export interface DriverOfferPlace {
  readonly label: string | null;
  readonly latitude: number;
  readonly longitude: number;
  /** `LOC-TRUST-01` — الرابطُ الأصليُّ كما لصقَه الراكبُ حرفاً، وملاحظاتُ المكان. */
  readonly link?: string | null;
  readonly notes?: string | null;
}

export interface DriverOfferDetail {
  readonly serverTime: string;
  readonly offerId: string;
  readonly orderId: string;
  readonly round: number;
  readonly service: ServiceType;
  readonly offerStatus: DriverOfferStatus;
  readonly orderStatus: DriverOrderStatus;
  readonly secondsLeft: number;
  /** **حكمُ الخادمِ** على القبولِ — لا تحكمُ الشاشةُ عليه بنفسِها. */
  readonly isClaimable: boolean;
  readonly pickup: DriverOfferPlace;
  readonly dropoff: DriverOfferPlace | null;
  readonly riderDistance: TaggedDistance | null;
  readonly tripDistance: TaggedDistance | null;
  /** ملاحظةُ الراكبِ كما كتبَها — نصٌّ لا يُترجَمُ ولا يُقصَّرُ ههنا. */
  readonly notes: string | null;
  /** `WR-05` — معنى المبلغِ قبلَ القبول. غائبٌ = لم يُقرَأ. */
  readonly offerTerms?: DriverOfferTerms;
}

/** أثرُ القبولِ — **بلا هويّةِ راكبٍ**: سطحُ التواصلِ بندٌ آخرُ. */
export interface DriverOfferClaim {
  readonly orderId: string;
  readonly matchedAt: string | null;
  /** `WR-09` — القبولُ حجزَ الطلبَ والراكبُ يقرّر؛ لا إسنادَ بعد. */
  readonly pendingRider?: boolean;
  /** موعدُ قرارِ الراكبِ (ISO) حينَ `pendingRider`. */
  readonly expiresAt?: string | null;
}

/**
 * دقّةُ العدِّ — ثانيةٌ واحدةٌ: بها يُقسَمُ الفارقُ المحليُّ. **وليسَت نبضةَ
 * مؤقّتٍ**: لا مؤقّتَ دوريَّ في التطبيقِ المصغَّرِ (`F1-07` · `ADR 0035` §٤)،
 * والباقي محسوبٌ لحظةَ الرسمِ.
 */
export const OFFER_COUNTDOWN_TICK_MS = 1000;

/**
 * الباقي بعدَ مُضيِّ `elapsedMs` على قراءةٍ قالَ الخادمُ فيها `secondsLeftAtRead`.
 *
 * ولا سالبَ يُعادُ: صفرٌ يعني «انتهَت المهلةُ في تقديرِ هذا الجهازِ» — وهوَ
 * تقديرٌ يُخفي زرّاً، **ولا يُلغي عرضاً**؛ الإلغاءُ حكمُ القاعدةِ.
 */
export function countdownSeconds(input: {
  readonly secondsLeftAtRead: number;
  readonly elapsedMs: number;
}): number {
  if (!Number.isFinite(input.secondsLeftAtRead) || input.secondsLeftAtRead <= 0) return 0;
  const elapsed = Number.isFinite(input.elapsedMs) && input.elapsedMs > 0 ? input.elapsedMs : 0;
  const remaining = input.secondsLeftAtRead - Math.floor(elapsed / OFFER_COUNTDOWN_TICK_MS);
  return remaining > 0 ? remaining : 0;
}

/** تقسيمُ الثوانِ دقائقَ وثوانِ للعرضِ — سياسةٌ واحدةٌ لا في كلِّ شاشةٍ. */
export interface CountdownParts {
  readonly minutes: number;
  readonly seconds: number;
}

export function countdownParts(totalSeconds: number): CountdownParts {
  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}
