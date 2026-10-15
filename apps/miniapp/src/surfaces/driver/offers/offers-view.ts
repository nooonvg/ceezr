/**
 * الغرض: نموذجُ عرضِ شاشتَي العروضِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ والثوانيَ
 *   والرمزَ إلى مفاتيحِ نصٍّ وقراراتٍ، بلا JSX وبلا شبكةٍ **وبلا ساعةٍ**
 *   (البند `F3-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `OffersScreen.tsx` · `OfferDetailScreen.tsx`، ويُقاسُ مباشرةً في
 *   `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — سطرُ المسافةِ ونغمةُ المؤقّتِ عينُهما.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ **لا `Date.now()` ولا `new Date()`** في هذا الملفِّ
 *
 * لأنَّ دالّةً تقرأُ ساعةً **لا تُقاسُ**: اختبارُها يصيرُ رهنَ لحظةِ تشغيلِه،
 * فيُخفِقُ عندَ منتصفِ الليلِ أو يمرُّ صدفةً. والأهمُّ أنَّ ساعةَ الجهازِ ليست
 * حكماً على مهلةٍ (`ADR 0117`): الباقي يُمرَّرُ وسيطاً من الخادمِ، والمنقضي فرقُ
 * قراءتَينِ تُحسَبانِ في الشاشةِ. والحاجزُ الساكنُ يُسقِطُ CI إن دخلَت ساعةٌ ههنا.
 *
 * ## ولِمَ سطرُ المسافةِ يُبنى بـ`describeDistance` القائمةِ لا بتنسيقٍ محليٍّ
 *
 * سياسةُ عرضِ المسافةِ (متى مترٌ ومتى كيلومترٌ، وكيفَ تُقرَّبُ، وأنَّ الوسمَ
 * يُعرَضُ معَها) حكمُ نطاقٍ **واحدٌ** في `packages/domain/quote/distance-kind.ts`.
 * وتنسيقٌ ثانٍ ههنا كانَ سيُظهِرُ «٩٠٠ م» للراكبِ و«0.9 كم» للسائقِ عن المسافةِ
 * الواحدةِ، ولَجازَ أن يسقطَ الوسمُ في أحدِهما — وهوَ عينُ ما منعَه `ADR 0024`.
 * ولذلكَ **تُستعمَلُ مفاتيحُ الراكبِ نصّاً** (`rider.quote.distance*`)، وهذا
 * استعمالٌ عبرَ الشرائحِ **مُعلَنٌ** يفحصُه الحاجزُ في القواميسِ الثلاثةِ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُقرِّرُ صلاحيّةَ القبولِ**: `is_claimable` حكمُ الخادمِ، والصفرُ في
 *      العدِّ يُخفي زرّاً **ولا يُلغي عرضاً**.
 *   ــ **لا يعرفُ أجرةً**: محجوبةٌ إعلاناً (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يُقدِّرُ مدّةَ وصولٍ من مسافةٍ**: `ADR 0024` يمنعُها بقياسٍ.
 *   ــ **لا يُنسِّقُ تاريخاً**: التنسيقُ في الشاشةِ، والزمنُ الوحيدُ ههنا مدّةٌ.
 *   ــ **لا يُرتِّبُ العروضَ**: ترتيبُها ترتيبُ انتهائِها من القاعدةِ، وإعادةُ
 *      ترتيبٍ في العميلِ تُنزِلُ أوشكَها انتهاءً إلى أسفلِ القائمةِ.
 */

import { formatPickupClock } from "../../../../../../packages/shared/order-terms/index.ts";
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-quote.ts";
import {
  countdownParts,
  countdownSeconds,
} from "../../../../../../packages/domain/driver/driver-offers.ts";
import {
  type DistanceDisplay,
  describeDistance,
} from "../../../../../../packages/domain/quote/distance-kind.ts";
import type {
  ApiDriverOfferCard,
  ApiDriverOfferService,
  ApiTaggedDistance,
  DriverOfferDetailResponse,
  DriverOffersResponse,
} from "./offers-contract.ts";

export { countdownParts, countdownSeconds };

/** رموزُ العطبِ التي لهذه الشاشتَينِ نصٌّ لها — مُقابِلةٌ لقائمةِ الطبقةِ حرفاً. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "OFFER_STORE_NOT_AVAILABLE",
  "AVAILABILITY_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "OFFER_ID_INVALID",
  "AVAILABILITY_INVALID",
  "OFFER_NOT_FOUND",
  "OFFER_ALREADY_ANSWERED",
  "OFFER_EXPIRED",
  "OFFER_TAKEN",
  "ORDER_HELD",
  "CITY_MISMATCH",
  "CLAIM_REFUSED",
  "DRIVER_HAS_ACTIVE_ORDER",
]);

/**
 * `WR-16A` — رمزُ العميلِ وحدَه: لم يصل ردٌّ من الخادم، فهو انقطاعُ اتصالٍ لا عطلُ لوح. ليسَ في
 * `KNOWN_ERRORS` لأنَّ تلك قائمةُ الخادمِ حرفًا (`check-driver-offers-contract`).
 */
export const OFFERS_NETWORK_UNREACHABLE = "NETWORK_UNREACHABLE";

export function offersErrorKey(code: string): string {
  if (code === OFFERS_NETWORK_UNREACHABLE) return "driver.offers.network.unreachable";
  return KNOWN_ERRORS.has(code) ? `driver.offers.error.${code}` : "driver.offers.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. و«سُبِقتَ إلى الطلبِ» ليسَ منها:
 * إعادةُ قبولٍ لطلبٍ أخذَه غيرُكَ تردُّ الرفضَ نفسَه فتُقرأُ عطلاً في التطبيقِ،
 * والصوابُ أن يعودَ السائقُ إلى اللوحِ.
 */
export function isRetryableOffersError(code: string): boolean {
  return (
    code === "OFFER_STORE_NOT_AVAILABLE" ||
    code === "AVAILABILITY_NOT_AVAILABLE" ||
    code === "SESSION_NOT_AVAILABLE" ||
    code === OFFERS_NETWORK_UNREACHABLE ||
    code === "UNKNOWN"
  );
}

/**
 * `WR-16A` — رمزُ العطبِ من المرميّ: خطأُ الشبكةِ (`ApiNetworkError`، بلا رمز) يُسمّى
 * `NETWORK_UNREACHABLE` فيُقالُ «لا اتصال» لا «تعثّر الطلب».
 */
export function offersCodeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (thrown instanceof Error && thrown.name === "ApiNetworkError") {
    return OFFERS_NETWORK_UNREACHABLE;
  }
  return "UNKNOWN";
}

/** `WR-16A` — حالُ زرِّ «حدّث اللوح»: جلبٌ فعليٌّ من الخادمِ له تحميلٌ وفشلٌ ونجاح. */
export type BoardRefreshState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done" }
  | { readonly kind: "failed"; readonly code: string };

/**
 * `WR-16A` — السطرُ تحتَ زرِّ التحديث. الفشلُ لا يمسحُ اللوحَ المعروض، ويُقالُ إنّه قد يكونُ
 * قديمًا؛ وانقطاعُ الاتصالِ يُقالُ بنصِّه. وتحديثٌ آنيٌّ فشلَ (`stale`) يُقالُ ولا يُكتَم.
 */
export function boardRefreshNotice(
  refresh: BoardRefreshState,
  stale: boolean,
): { readonly key: string; readonly role: "status" | "alert" } | null {
  if (refresh.kind === "busy") return { key: "driver.offers.refresh.busy", role: "status" };
  if (refresh.kind === "failed") {
    return {
      key:
        refresh.code === OFFERS_NETWORK_UNREACHABLE
          ? "driver.offers.refresh.offline"
          : "driver.offers.refresh.failed",
      role: "alert",
    };
  }
  if (stale) return { key: "driver.offers.refresh.stale", role: "alert" };
  if (refresh.kind === "done") return { key: "driver.offers.refresh.done", role: "status" };
  return null;
}

/**
 * حدُّ الإلحاحِ في المؤقّتِ. وعشرُ ثوانٍ **ليسَت سياسةَ أعمالٍ** (القاعدة 0.3):
 * مهلةُ العرضِ نفسُها تُقرأُ من `platform_settings` في القاعدةِ ولا تُكتَبُ ههنا.
 * وهذا رقمُ عرضٍ محضٌ: متى تُصبِحُ الشارةُ ملحّةً في عينِ الناظرِ.
 */
export const URGENT_SECONDS = 10;

export type CountdownTone = "calm" | "urgent" | "elapsed";

export function countdownTone(secondsRemaining: number): CountdownTone {
  if (secondsRemaining <= 0) return "elapsed";
  return secondsRemaining <= URGENT_SECONDS ? "urgent" : "calm";
}

/** «١:٠٧» — عرضٌ محضٌ، والدقائقُ لا تُختصَرُ كي لا يُقرأَ «٧» سبعَ دقائقَ. */
export function countdownLabel(secondsRemaining: number): string {
  const parts = countdownParts(secondsRemaining);
  return `${parts.minutes}:${String(parts.seconds).padStart(2, "0")}`;
}

/** سطرُ مسافةٍ للعرضِ — مفتاحٌ وقيمةٌ **ووسمٌ لا يُفصَلُ عنهما**. */
export interface DistanceLine {
  readonly key: DistanceDisplay["key"];
  readonly value: number;
  readonly kindKey: "rider.quote.distance.straightLine";
}

/**
 * `null` لما لا يُقاسُ — **ولا صفرٌ يتظاهرُ بقياسٍ**: «٠ م» تُقرأُ «أنتَ عندَ
 * الراكبِ» فيُنتظِرُ السائقُ راكباً ليسَ أمامَه.
 */
export function distanceLine(distance: ApiTaggedDistance | null): DistanceLine | null {
  if (distance === null) return null;
  const display = describeDistance(distance);
  if (display === null) return null;
  return {
    key: display.key,
    value: display.value,
    kindKey: "rider.quote.distance.straightLine",
  };
}

/**
 * سببُ الحجبِ نصٌّ من القاعدةِ على صورةِ `CODE:doc_type` — يُقسَمُ ههنا
 * ويُوصَلُ بمفاتيحِ شريحةِ الوثائقِ (`F3-01`) **بعينِها**: نصٌّ ثانٍ لسببٍ واحدٍ
 * كانَ سيقولُ للسائقِ في شاشةٍ ما يُخالِفُ ما قالتْه الأخرى.
 */
export interface OfferBlockLine {
  readonly id: string;
  readonly messageKey: string;
  readonly labelKey: string | null;
  /** نوعُ الوثيقةِ الذي يُصلِحُ هذا السببَ — `null` للسببِ المجهولِ (`PD-081`). */
  readonly docType: string | null;
  /** مفتاحُ نصِّ الفعلِ — `null` للسببِ المجهولِ (`PD-081`). */
  readonly fixLabelKey: string | null;
}

const KNOWN_BLOCK_CODES: ReadonlySet<string> = new Set(["EXPIRED", "REJECTED"]);

const KNOWN_DOC_TYPES: ReadonlySet<string> = new Set([
  "driving_license",
  "medical_exam",
  "criminal_record",
  "vehicle_registration",
  "insurance",
  "periodic_inspection",
]);

export function toOfferBlockLines(reasons: readonly string[]): readonly OfferBlockLine[] {
  return reasons.map((reason, index) => {
    const separator = reason.indexOf(":");
    const code = separator === -1 ? reason : reason.slice(0, separator);
    const docType = separator === -1 ? "" : reason.slice(separator + 1);
    const knownCode = KNOWN_BLOCK_CODES.has(code);
    return {
      // المُعرِّفُ يحملُ الترتيبَ: سببانِ بالنصِّ نفسِه ممكنانِ نظريّاً، ومفتاحٌ
      // مُكرَّرٌ في قائمةِ عرضٍ يُخفي أحدَهما.
      id: `${index}:${reason}`,
      messageKey: knownCode ? `driver.documents.block.${code}` : "driver.documents.block.UNKNOWN",
      labelKey: KNOWN_DOC_TYPES.has(docType) ? `driver.documents.type.${docType}` : null,
      docType: KNOWN_DOC_TYPES.has(docType) ? docType : null,
      fixLabelKey: knownCode && KNOWN_DOC_TYPES.has(docType) ? "driver.documents.block.fix" : null,
    };
  });
}

export interface OfferCardModel {
  readonly offerId: string;
  readonly orderId: string;
  readonly round: number;
  readonly serviceKey: string;
  /** `MSG-COLOR-01` — الخدمةُ نفسُها: يُقرأُ منها لونُ البطاقةِ في الشاشةِ. */
  readonly service: ApiDriverOfferService;
  /** ما قالَه الخادمُ لحظةَ القراءةِ — والباقي يُحسَبُ بـ`countdownSeconds`. */
  readonly secondsLeftAtRead: number;
  readonly riderDistance: DistanceLine | null;
  readonly tripDistance: DistanceLine | null;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly pickupNotes: string | null;
  readonly dropoffNotes: string | null;
  /** `WR-05` */
  readonly offerTerms: OfferLine | null;
  /** `WR-06` — وقتُ الحضورِ ISO، و`null` = الآن. */
  readonly pickupAt: string | null;
}

export function toOfferCard(card: ApiDriverOfferCard): OfferCardModel {
  return {
    offerId: card.offer_id,
    orderId: card.order_id,
    round: card.round,
    serviceKey: `driver.offers.service.${card.service}`,
    service: card.service,
    secondsLeftAtRead: card.seconds_left,
    riderDistance: distanceLine(card.rider_distance),
    tripDistance: distanceLine(card.trip_distance),
    pickupLabel: card.pickup_label,
    dropoffLabel: card.dropoff_label,
    pickupNotes: card.pickup_notes ?? null,
    dropoffNotes: card.dropoff_notes ?? null,
    offerTerms: offerLine(card.offer_mode, card.offer_sar),
    pickupAt: card.pickup_at ?? null,
  };
}

export interface OffersBoardModel {
  readonly headlineKey: string;
  readonly isAvailable: boolean;
  /**
   * `WR-11` — متوفّرٌ **ومؤهَّلٌ** لما يُعرَف: غيرُ محجوبٍ، وموثَّقٌ، وموضعُه حاضرٌ حديث.
   * وحدَه يُلوَّنُ أخضر؛ والمتوفّرُ غيرُ المؤهَّلِ لونٌ محايدٌ وعنوانٌ يقولُ السبب.
   */
  readonly isReady: boolean;
  readonly isBlocked: boolean;
  readonly blockLines: readonly OfferBlockLine[];
  readonly cards: readonly OfferCardModel[];
}

/**
 * عنوانُ اللوحِ — **الحجبُ أوّلاً ثمَّ التوفُّرُ ثمَّ الفراغُ**: سائقٌ محجوبٌ
 * لوثيقةٍ منتهيةٍ لو رأى «لا عروضَ الآنَ» لَظنَّ السوقَ هادئاً وانتظرَ يوماً
 * كامِلاً بلا عملٍ. والسببُ الحقيقيُّ يُقالُ أوّلَ سطرٍ.
 */
/** `WR-11` — عنوانُ المتوفّرِ غيرِ المؤهَّلِ بالسببِ الأوّل، أو `null` إن لم يُعرَف سبب. */
const ELIGIBILITY_HEADLINES: Readonly<Record<string, string>> = {
  NOT_VERIFIED: "driver.offers.headline.notVerified",
  NO_LOCATION: "driver.offers.headline.noLocation",
  STALE_LOCATION: "driver.offers.headline.staleLocation",
  UNTRUSTED_LOCATION: "driver.offers.headline.untrustedLocation",
};

function eligibilityHeadline(reasons: readonly string[] | undefined): string | null {
  for (const reason of reasons ?? []) {
    const key = ELIGIBILITY_HEADLINES[reason];
    if (key !== undefined) return key;
  }
  return null;
}

export function toOffersBoard(response: DriverOffersResponse): OffersBoardModel {
  const cards = response.offers.map(toOfferCard);
  /**
   * `WR-11` — المتوفّرُ غيرُ المؤهَّلِ لا يُقالُ له «لا عرضَ في هذه اللحظة» كأنَّ السوقَ هادئ:
   * يُقالُ له السببُ الذي يستبعدُه به التوزيع. وعرضٌ قائمٌ في يدِه يُقدَّمُ على الشرح.
   */
  const ineligible = eligibilityHeadline(response.eligibility_reasons);
  const headlineKey = response.is_blocked
    ? "driver.offers.headline.blocked"
    : !response.is_available
      ? "driver.offers.headline.unavailable"
      : cards.length > 0
        ? "driver.offers.headline.working"
        : (ineligible ?? "driver.offers.headline.waiting");
  return {
    headlineKey,
    isAvailable: response.is_available,
    isReady: response.is_available && !response.is_blocked && ineligible === null,
    isBlocked: response.is_blocked,
    blockLines: toOfferBlockLines(response.block_reasons),
    cards,
  };
}

export interface OfferDetailModel {
  readonly offerId: string;
  readonly orderId: string;
  readonly round: number;
  readonly serviceKey: string;
  /** `MSG-COLOR-01` — الخدمةُ نفسُها: يُقرأُ منها لونُ البطاقةِ في الشاشةِ. */
  readonly service: ApiDriverOfferService;
  readonly offerStatusKey: string;
  readonly orderStatusKey: string;
  readonly secondsLeftAtRead: number;
  readonly isClaimable: boolean;
  readonly pickupLabel: string | null;
  readonly pickupLatitude: number;
  readonly pickupLongitude: number;
  readonly dropoffLabel: string | null;
  readonly hasDropoff: boolean;
  readonly riderDistance: DistanceLine | null;
  readonly tripDistance: DistanceLine | null;
  readonly notes: string | null;
  /** `LOC-TRUST-01` — ما أدخلَه الراكبُ عن كلِّ مكان، ورابطُ فتحِه (الأصليُّ أو من النقطة). */
  readonly pickupNotes: string | null;
  readonly pickupLink: string | null;
  readonly pickupOpenUrl: string | null;
  readonly dropoffNotes: string | null;
  readonly dropoffLink: string | null;
  readonly dropoffOpenUrl: string | null;
  /** `WR-05` */
  readonly offerTerms: OfferLine | null;
  /** `WR-06` */
  readonly pickupAt: string | null;
}

export function toOfferDetail(response: DriverOfferDetailResponse): OfferDetailModel {
  return {
    offerId: response.offer_id,
    orderId: response.order_id,
    round: response.round,
    serviceKey: `driver.offers.service.${response.service}`,
    service: response.service,
    offerStatusKey: `driver.offers.offerStatus.${response.offer_status}`,
    orderStatusKey: `driver.offers.orderStatus.${response.order_status}`,
    secondsLeftAtRead: response.seconds_left,
    isClaimable: response.is_claimable,
    pickupLabel: response.pickup.label,
    pickupLatitude: response.pickup.latitude,
    pickupLongitude: response.pickup.longitude,
    dropoffLabel: response.dropoff === null ? null : response.dropoff.label,
    hasDropoff: response.dropoff !== null,
    riderDistance: distanceLine(response.rider_distance),
    tripDistance: distanceLine(response.trip_distance),
    notes: response.notes,
    pickupNotes: response.pickup.notes ?? null,
    pickupLink: response.pickup.link ?? null,
    pickupOpenUrl: response.pickup.open_url ?? null,
    dropoffNotes: response.dropoff?.notes ?? null,
    dropoffLink: response.dropoff?.link ?? null,
    dropoffOpenUrl: response.dropoff?.open_url ?? null,
    offerTerms: offerLine(response.offer_mode, response.offer_sar),
    pickupAt: response.pickup_at ?? null,
  };
}

/**
 * `WR-06` — سطرُ وقتِ الحضور: «الآن» أو «الساعة بتوقيتِ الرياض» بالدالّةِ نفسِها التي تكتبُ رسالةَ
 * البوت (`formatPickupClock`)، فلا يرى السائقُ في التطبيقِ غيرَ ما يراه في تيليجرام.
 */
export function pickupAtText(t: (key: string) => string, pickupAt: string | null): string {
  if (pickupAt === null) return t("driver.offers.pickupAt.now");
  // `Date.parse` لا ساعةَ الجهاز: اللحظةُ من الخادمِ، والدالّةُ تُقاسُ في اختبار.
  const at = Date.parse(pickupAt);
  if (Number.isNaN(at)) return t("driver.offers.pickupAt.now");
  const clock = formatPickupClock(at, (key) =>
    t(key === "common.time_am" ? "driver.offers.pickupAt.am" : "driver.offers.pickupAt.pm"),
  );
  return t("driver.offers.pickupAt.at").replace("{time}", clock);
}

/**
 * هل يُعرَضُ زرُّ القبولِ — **حكمُ الخادمِ ثمَّ تقديرُ الجهازِ**: `is_claimable`
 * شرطٌ لا يُتجاوَزُ، والصفرُ في العدِّ يُخفي الزرَّ لأنَّ ضغطةً على عرضٍ انتهى
 * تُردُّ `OFFER_EXPIRED` فتُقرأُ عطلاً في التطبيقِ. والعرضُ يبقى في القائمةِ حتّى
 * تقولَ القاعدةُ كلمتَها في القراءةِ القادمةِ.
 */
export function canAcceptNow(input: {
  readonly isClaimable: boolean;
  readonly secondsRemaining: number;
}): boolean {
  return input.isClaimable && input.secondsRemaining > 0;
}

/**
 * `WR-05` — سطرُ معنى المبلغِ للسائق: مفتاحُه ومبلغُه. `null` ⇒ طلبٌ أقدمُ من السياسة
 * (أو بوّابةٌ أقدم) فلا يُخترَعُ معنىً لم يكتبْه الراكب.
 */
export interface OfferLine {
  readonly key:
    | "driver.offers.terms.fixed"
    | "driver.offers.terms.suggested"
    | "driver.offers.terms.open";
  readonly amount: number | null;
}

export function offerLine(
  mode: "fixed" | "suggested" | "open" | null | undefined,
  amount: number | null | undefined,
): OfferLine | null {
  if (mode === "open") return { key: "driver.offers.terms.open", amount: null };
  if (typeof amount !== "number") return null;
  if (mode === "fixed") return { key: "driver.offers.terms.fixed", amount };
  if (mode === "suggested") return { key: "driver.offers.terms.suggested", amount };
  return null;
}

export function offerLineText(t: (key: string) => string, line: OfferLine): string {
  return t(line.key).replace("{amount}", String(line.amount ?? ""));
}
