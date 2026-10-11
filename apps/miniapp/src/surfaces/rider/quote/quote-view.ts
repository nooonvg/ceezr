/**
 * الغرض: نموذجُ عرضِ الاقتباسِ — دالّاتٌ نقيّةٌ تُحوِّلُ ردَّ الخادمِ إلى مفاتيحِ
 *   نصٍّ وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-04` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `QuoteScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-05` تعرضُ البطاقاتَ نفسَها قبلَ الإنشاءِ.
 *
 * ## لماذا `UNKNOWN` مفتاحٌ لا سقوطٌ
 *
 * رمزٌ جديدٌ من خادمٍ أحدثَ من هذا العميلِ **يقعُ** — والعميلُ في تلغرام لا
 * يُحدَّثُ لحظةَ نشرِ الخادمِ. فالمجهولُ يُعرَضُ نصّاً مهذَّباً عامّاً، ولا يُرمى
 * استثناءٌ يُبيِّضُ الشاشةَ، ولا يُعرَضُ الرمزُ الخامُ للمستخدمِ.
 *
 * ## ولماذا سببُ امتناعِ المدّةِ يُعرَضُ ولا يُوحَّدُ
 *
 * «لا محرِّكَ توجيهٍ مُهيَّأٌ» و«لا طريقَ بينَ الموضعَينِ» و«المحرِّكُ متوقّفٌ»
 * ثلاثةُ أجوبةٍ يَعقُبُها ثلاثةُ أفعالٍ مختلفةٍ من الراكبِ. وتوحيدُها في «غيرُ
 * متاحةٍ» يجعلُ الراكبَ يُعيدُ المحاولةَ أبداً في حالةٍ لن تتغيَّرَ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ سعراً ولا وسيلةَ دفعٍ ولا حقلاً مُعَدّاً لهما** (`ADR 0039` §٤
 *      · `م13-7`)، وحاجزُ `scripts/check-quote-contract.ts` يُنفِذُ ذاكَ آليّاً.
 *   ــ **لا يحسبُ مدّةً من مسافةٍ**: لا سرعةَ ثابتةً ولا معاملَ التفافٍ.
 *   ــ **لا يُخفي خدمةً غيرَ متاحةٍ**: يُعيدُ لها سببَها كي تُعرَضَ معطَّلةً.
 *   ــ **لا يُصيغُ نصّاً**: مفاتيحٌ وأعدادٌ، والنصُّ في `packages/shared/i18n`.
 */

import {
  describeDistance,
  type TaggedDistance,
} from "../../../../../../packages/domain/quote/distance-kind.ts";
import {
  isServiceKind,
  type ServiceKind,
} from "../../../../../../packages/domain/quote/service-offer.ts";
import type { ApiEtaVerdict, ApiServiceOffer, ApiTaggedDistance } from "./quote-contract.ts";

/**
 * هل التوصيلُ من الخدماتِ المتاحةِ في هذا الاقتباسِ؟ — إن حضرَ، صارَ حقلُ
 * الملاحظاتِ وصفَ طردٍ **اختياريًّا** (`WR-18`).
 */
export function hasDeliveryService(offers: readonly ApiServiceOffer[]): boolean {
  return offers.some((o) => o.service === "delivery" && o.available);
}

/**
 * نتيجةُ تحقُّقِ وصفِ الطردِ — مفتاحُ خطأٍ أو `null` إن صحَّ.
 */
export type ParcelValidationResult = { readonly errorKey: string } | null;

/**
 * يُتحقَّقُ من وصفِ الطردِ في العميلِ قبلَ الإرسالِ — نفسُ قواعدِ النطاقِ:
 * فراغٌ، أوامرُ بوتٍ، طولٌ خارجَ ٣–٢٠٠. ولا يُكرَّرُ منطقُ النطاقِ حرفاً:
 * هذه قواعدُ سلامةِ مُدخَلٍ تنعكسُ على واجهةِ المستخدمِ قبلَ أن تصلَ البوّابةَ.
 */
export function parcelValidationError(raw: string): ParcelValidationResult {
  const trimmed = raw.trim();
  // `WR-18` — قرارُ المالك: الوصفُ اختياريٌّ، فالفراغُ صالحٌ لا خطأ.
  if (trimmed === "") return null;
  if (trimmed.startsWith("/")) return { errorKey: "rider.quote.parcel.error.command" };
  if (trimmed.length < 3) return { errorKey: "rider.quote.parcel.error.too_short" };
  if (trimmed.length > 200) return { errorKey: "rider.quote.parcel.error.too_long" };
  return null;
}

/** سطرُ المسافةِ: مفتاحٌ وقيمةٌ ووسمٌ. `null` لِما لا يُقاسُ — لا صفرٌ. */
export interface DistanceLine {
  readonly key: string;
  readonly value: number;
  readonly kindKey: string;
}

const DISTANCE_KIND_KEYS: Readonly<Record<string, string>> = {
  STRAIGHT_LINE: "rider.quote.distance.straightLine",
};

/**
 * سطرُ المسافةِ. الوسمُ يُترجَمُ مفتاحاً، ووسمٌ مجهولٌ يُسقِطُ السطرَ كلَّه
 * (`null`) ولا يُعرَضُ رقماً بلا وسمٍ: رقمٌ بلا وسمٍ هوَ عينُ ما مُنِعَ.
 */
export function distanceLine(distance: ApiTaggedDistance): DistanceLine | null {
  const kindKey = DISTANCE_KIND_KEYS[distance.kind];
  if (kindKey === undefined) return null;
  const described = describeDistance({
    kind: "STRAIGHT_LINE",
    meters: distance.meters,
  } as TaggedDistance);
  if (described === null) return null;
  return { key: described.key, value: described.value, kindKey };
}

const ETA_REASON_KEYS: Readonly<Record<string, string>> = {
  NOT_CONFIGURED: "rider.quote.duration.notConfigured",
  PROVIDER_DOWN: "rider.quote.duration.providerDown",
  NO_ROUTE: "rider.quote.duration.noRoute",
  OFF_ROAD: "rider.quote.duration.offRoad",
  SNAP_UNKNOWN: "rider.quote.duration.snapUnknown",
  IMPLAUSIBLE: "rider.quote.duration.implausible",
  NO_INPUT: "rider.quote.duration.noInput",
};

/** سطرُ المدّةِ: دقائقُ مُوجَّهةٌ أو امتناعٌ بمفتاحِ سببٍ. */
export type DurationLine =
  | { readonly kind: "ROUTED"; readonly minutes: number }
  | { readonly kind: "UNAVAILABLE"; readonly reasonKey: string };

export function durationLine(eta: ApiEtaVerdict): DurationLine {
  if (eta.kind === "ROUTED") return { kind: "ROUTED", minutes: eta.minutes };
  return {
    kind: "UNAVAILABLE",
    reasonKey: ETA_REASON_KEYS[eta.reason] ?? "rider.quote.duration.unknown",
  };
}

export interface ServiceCardView {
  readonly service: ServiceKind;
  readonly labelKey: string;
  readonly available: boolean;
  /** `null` عندَ الإتاحةِ: لا سببَ لِما لا مانعَ له. */
  readonly reasonKey: string | null;
}

const SERVICE_UNAVAILABLE_KEYS: Readonly<Record<string, string>> = {
  NO_CAPABLE_DRIVER_IN_CITY: "rider.quote.service.noCapableDriver",
};

/**
 * بطاقاتُ الخدماتِ. خدمةٌ لا يعرفُها هذا العميلُ **تُطرَحُ** ولا تُعرَضُ برمزٍ
 * خامٍ: لا نصَّ لها في قواميسِه، وعرضُ `courier` حرفيّاً أسوأُ من عدمِ عرضِه.
 */
export function serviceCards(offers: readonly ApiServiceOffer[]): readonly ServiceCardView[] {
  const cards: ServiceCardView[] = [];
  for (const offer of offers) {
    if (!isServiceKind(offer.service)) continue;
    cards.push({
      service: offer.service,
      labelKey: `rider.quote.service.${offer.service}`,
      available: offer.available,
      reasonKey: offer.available
        ? null
        : (SERVICE_UNAVAILABLE_KEYS[offer.reason] ?? "rider.quote.service.unavailable"),
    });
  }
  return cards;
}

const REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_POINT: "rider.quote.refused.invalidPoint",
  CITY_HAS_NO_SERVICE_AREA: "rider.quote.refused.noServiceArea",
  ORIGIN_OUTSIDE_SERVICE_AREA: "rider.quote.refused.originOutside",
  DESTINATION_OUTSIDE_SERVICE_AREA: "rider.quote.refused.destinationOutside",
  DESTINATION_IS_PICKUP: "rider.quote.refused.destinationIsPickup",
};

/**
 * `RIDE-SAMESPOT-01`: أدنى مسافةٍ بينَ الالتقاطِ والوجهةِ تُقبَلُ رحلةً.
 *
 * لماذا: رُصِدَ في الإنتاجِ (2026-10-03، المدينةُ المنورة) طلبٌ التقاطُه ووجهتُه
 * **النقطةُ نفسُها** — اختارَ الراكبُ «موقعي الحاليّ» وجهةً، والالتقاطُ موقعُ الجهازِ
 * نفسُه، فنُشِرَ طلبٌ بمسافةِ صفرٍ لا يُنفَّذُ. والخادمُ لا يرفضُه اليومَ (لا حدَّ
 * مسافةٍ في `request_ride`)، فالحارسُ ههنا قبلَ السؤالِ، ورفضُ الخادمِ نفسِه قرارُ
 * هجرةٍ مُعلَّقٌ عندَ المالكِ.
 *
 * و100 مترٍ لأنَّ دقّةَ موقعِ الهاتفِ في المدينةِ عشراتُ الأمتارِ: قراءتانِ لموضعٍ
 * واحدٍ قد تفترقانِ بها، وأقصرُ مشوارٍ حقيقيٍّ أطولُ منها بكثير.
 */
export const MIN_TRIP_METERS = 100;

/** مسافةُ الدائرةِ العظمى بالأمتارِ (هافرساين) — تكفي للحكمِ على «أقلُّ من 100م». */
export function straightMeters(
  a: { readonly lat: number; readonly lng: number },
  b: { readonly lat: number; readonly lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** هل الوجهةُ هيَ موضعُ الالتقاطِ نفسُه (أقربُ من `MIN_TRIP_METERS`)؟ */
export function destinationIsPickup(
  pickup: { readonly lat: number; readonly lng: number },
  destination: { readonly lat: number; readonly lng: number },
): boolean {
  return straightMeters(pickup, destination) < MIN_TRIP_METERS;
}

export function quoteRefusalKey(code: string): string {
  return REFUSAL_KEYS[code] ?? "rider.quote.refused.unknown";
}

/**
 * هل يُعرَضُ للراكبِ فعلٌ يُصلِحُ به الرفضَ؟
 *
 * «انطلاقُك خارجَ الحدِّ» يُصلَحُ بإعادةِ قراءةِ الموقعِ، و«وجهتُك خارجَ الحدِّ»
 * يُصلَحُ باختيارِ وجهةٍ أخرى، و«مدينتُك بلا حدٍّ مرسومٍ» **لا يُصلِحُه الراكبُ
 * أبداً** — وزرُّ «أعِدِ المحاولةَ» فيه يُشغِلُ الناسَ بما لا يتغيَّرُ.
 */
export type RefusalRemedy = "RELOCATE" | "PICK_ANOTHER_DESTINATION" | "NONE";

export function refusalRemedy(code: string): RefusalRemedy {
  if (code === "ORIGIN_OUTSIDE_SERVICE_AREA" || code === "INVALID_POINT") return "RELOCATE";
  if (code === "DESTINATION_OUTSIDE_SERVICE_AREA" || code === "DESTINATION_IS_PICKUP") {
    return "PICK_ANOTHER_DESTINATION";
  }
  return "NONE";
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_REQUIRED: "rider.quote.error.session",
  SESSION_INVALID: "rider.quote.error.session",
  SESSION_EXPIRED: "rider.quote.error.session",
  SESSION_NOT_AVAILABLE: "rider.quote.error.unavailable",
  MALFORMED: "rider.quote.error.malformed",
  ACCOUNT_NOT_FOUND: "rider.quote.error.account",
  QUOTE_STORE_NOT_AVAILABLE: "rider.quote.error.unavailable",
};

export function quoteErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.quote.error.unavailable";
}

/** وهل تُعادُ المحاولةُ؟ لا تُعادُ لِعطبِ عقدٍ ولا لِجلسةٍ ساقطةٍ. */
export function isRetryableQuoteError(code: string): boolean {
  return code === "SESSION_NOT_AVAILABLE" || code === "QUOTE_STORE_NOT_AVAILABLE";
}

/**
 * `ORDER-TERMS-01` — «HH:MM» من حقلِ الوقتِ إلى لحظةٍ ISO: اليومَ إن لم يمضِ الوقتُ، وإلّا
 * غداً. فارغٌ أو مشوَّهٌ ⇒ `null` («الآن»). والساعةُ ساعةُ الجهازِ — ساعةُ الراكبِ نفسِه.
 */
export function pickupAtFrom(clock: string, now: Date = new Date()): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() < now.getTime() - 60_000) at.setDate(at.getDate() + 1);
  return at.toISOString();
}

/**
 * `ORDER-OFFER-01` — حقلُ «المبلغ الذي تدفعه» إلى عددٍ صحيحٍ بالريال. فارغٌ ⇒ `null` («قابلٌ
 * للتفاوض»)؛ وما كُتِبَ ولم يُقرأ عدداً من 1 إلى 10000 ⇒ خطأٌ يُعرَضُ قبلَ الإرسالِ. وتُقبَلُ
 * الأرقامُ العربيّةُ الهنديّةُ (٤٠) لأنّها ما تكتبُه لوحةُ مفاتيحِ الراكبِ العربيّةُ.
 */
export const OFFER_MAX_SAR = 10_000;

export function offerSarFrom(
  raw: string,
): { readonly ok: true; readonly value: number | null } | { readonly ok: false } {
  const western = raw
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (western === "") return { ok: true, value: null };
  if (!/^[0-9]{1,5}$/.test(western)) return { ok: false };
  const n = Number.parseInt(western, 10);
  if (n < 1 || n > OFFER_MAX_SAR) return { ok: false };
  return { ok: true, value: n };
}
