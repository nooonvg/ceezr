/**
 * الغرض: نموذجُ عرضِ البحثِ — دالّاتٌ نقيّةٌ تُحوِّلُ ردَّ الخادمِ إلى مفاتيحِ
 *   نصٍّ وأعدادٍ، بلا JSX وبلا شبكةٍ (البند `F2-05` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `SearchScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-06` تُعيدُ استعمالَ `rideStatusKey`
 *   و`elapsedText` حرفاً ولا تكتبُ لهما بديلاً.
 *
 * ## لماذا المدّةُ تُحسَبُ من ختمِ الميلادِ لا من فتحِ الشاشةِ
 *
 * راكبٌ أغلقَ التطبيقَ ثمَّ عادَ بعدَ سبعِ دقائقَ **يجبُ أن يرى سبعاً**. وعدّادٌ
 * يبدأُ عندَ التركيبِ يُريهِ صفراً، فيُصدِّقُ أنَّ البحثَ بدأَ الآنَ، فينتظرُ مرّتَينِ.
 * فالحسابُ ههنا `now - createdAt`، ويُصحَّحُ عندَ كلِّ قراءةٍ بـ`elapsedSeconds`
 * الذي تقيسُه القاعدةُ — لأنَّ ساعةَ الجهازِ قد تكونُ منحرفةً.
 *
 * ## ولماذا الصفرُ نصٌّ خاصٌّ لا رقمٌ في قالبٍ
 *
 * «بُلِّغَ 0 سائقينَ» يُقرأُ عطباً؛ و«لم يُبلَّغْ سائقٌ بعدُ» يُقرأُ **حقيقةً**.
 * والحقيقةُ هيَ المطلوبُ: `ADR 0023` يقولُ إنَّ الصمتَ ليسَ رفضاً، فلا يُخفى
 * الصفرُ ولا يُجمَّلُ بعبارةٍ توهِمُ حركةً لم تحدثْ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ سعراً ولا عقوبةَ إلغاءٍ**: `cancellableWithoutPenalty` رايةٌ
 *      تُقرأُ ولا تُفسَّرُ مالاً (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يخترعُ حالةً**: حالةٌ لا يعرفُها تُعرَضُ مفتاحاً عامّاً لا رمزاً خاماً.
 *   ــ **لا يقرِّرُ نهايةَ البحثِ من عدّادٍ**: النهايةُ حالةُ الرحلةِ في القاعدةِ.
 *   ــ **لا يُصيغُ نصّاً**: مفاتيحٌ وأعدادٌ، والنصُّ في `packages/shared/i18n`.
 */

import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-views.ts";
import {
  elapsedSecondsSince,
  isRideStatus,
} from "../../../../../../packages/domain/transport/ride-request.ts";

/** حالةُ الرحلةِ ⇒ مفتاحُ نصٍّ. وما لا يُعرَفُ يُقالُ عامّاً لا خاماً. */
export function rideStatusKey(status: string): string {
  return isRideStatus(status) ? `rider.search.status.${status}` : "rider.search.status.unknown";
}

const PHASE_KEYS: Readonly<Record<string, string>> = {
  silent: "rider.search.phase.silent",
  announced: "rider.search.phase.announced",
  widened: "rider.search.phase.widened",
  escalated: "rider.search.phase.escalated",
  assigned: "rider.search.phase.assigned",
  closed: "rider.search.phase.closed",
};

export function searchPhaseKey(phase: string): string {
  return PHASE_KEYS[phase] ?? "rider.search.phase.unknown";
}

/**
 * سطرُ المبلَّغينَ: مفتاحٌ وعددٌ. والصفرُ **مفتاحٌ آخرُ** لا قيمةٌ في القالبِ.
 */
export interface NotifiedLine {
  readonly key: string;
  readonly count: number;
}

export function notifiedLine(count: number): NotifiedLine {
  if (!Number.isFinite(count) || count <= 0) return { key: "rider.search.notified.zero", count: 0 };
  return { key: "rider.search.notified.count", count: Math.trunc(count) };
}

/**
 * نصُّ المدّةِ: دقائقُ وثوانٍ، ومفتاحٌ يختلفُ بينَ ما دونَ الدقيقةِ وما فوقَها كي
 * لا يُقالَ «0 دقيقة و9 ثوانٍ» في أوّلِ لحظةٍ.
 */
export interface ElapsedText {
  readonly key: string;
  readonly minutes: number;
  readonly seconds: number;
}

export function elapsedText(totalSeconds: number): ElapsedText {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.trunc(totalSeconds) : 0;
  const minutes = Math.trunc(safe / 60);
  const seconds = safe % 60;
  return {
    key: minutes === 0 ? "rider.search.elapsedSeconds" : "rider.search.elapsedMinutes",
    minutes,
    seconds,
  };
}

/**
 * المدّةُ المعروضةُ = **ما قاسَته القاعدةُ عندَ القراءةِ** + ما مضى من ثوانٍ على
 * الجهازِ بعدَ تلكَ القراءةِ. ولا تُحسَبُ من ختمِ الميلادِ مطروحاً من ساعةِ
 * الجهازِ مباشرةً: الساعتانِ قد تختلفانِ بدقائقَ، فيُعرَضُ للراكبِ انتظارٌ لم
 * يحدثْ (أو صفرٌ بعدَ سبعِ دقائقَ). والفارقُ المحليُّ **فرقُ لحظتَينِ من الساعةِ
 * نفسِها**، فانحرافُها يُلغي نفسَه.
 *
 * وختمُ الميلادِ يبقى حكماً احتياطيّاً لِما قبلَ أوّلِ قراءةٍ (لحظةُ الإنشاءِ).
 */
export function elapsedSecondsFor(input: {
  readonly serverElapsedSeconds: number;
  readonly measuredAtMs: number;
  readonly nowMs: number;
}): number {
  const base =
    Number.isFinite(input.serverElapsedSeconds) && input.serverElapsedSeconds > 0
      ? Math.trunc(input.serverElapsedSeconds)
      : 0;
  return base + elapsedSecondsSince(input.measuredAtMs, input.nowMs);
}

/**
 * المدّةُ قبلَ أوّلِ قراءةٍ — من ختمِ الإنشاءِ الذي أعادَه الإنشاءُ نفسُه. تُستعمَلُ
 * لحظةً واحدةً ثمَّ يحكمُ قياسُ القاعدةِ.
 */
export function elapsedSecondsFromBirth(createdAtMs: number, nowMs: number): number {
  return elapsedSecondsSince(createdAtMs, nowMs);
}

const REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_POINT: "rider.search.refused.invalidPoint",
  CITY_HAS_NO_SERVICE_AREA: "rider.search.refused.noServiceArea",
  CITY_NOT_ACTIVE: "rider.search.refused.cityNotActive",
  ORIGIN_OUTSIDE_SERVICE_AREA: "rider.search.refused.originOutside",
  DESTINATION_OUTSIDE_SERVICE_AREA: "rider.search.refused.destinationOutside",
  SERVICE_NOT_AVAILABLE_IN_CITY: "rider.search.refused.serviceUnavailable",
  IDEMPOTENCY_KEY_REQUIRED: "rider.search.refused.keyRequired",
  IDEMPOTENCY_KEY_TOO_LONG: "rider.search.refused.keyTooLong",
  NOTES_TOO_LONG: "rider.search.refused.notesTooLong",
  ACTIVE_RIDE_EXISTS: "rider.search.refused.activeRide",
};

export function rideRefusalKey(code: string): string {
  return REFUSAL_KEYS[code] ?? "rider.search.refused.unknown";
}

const SEARCH_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_ORDER_ID: "rider.search.read.invalidId",
  ORDER_NOT_FOUND: "rider.search.read.notFound",
};

export function searchRefusalKey(code: string): string {
  return SEARCH_REFUSAL_KEYS[code] ?? "rider.search.read.unknown";
}

const CANCEL_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_ORDER_ID: "rider.search.cancel.invalidId",
  ORDER_NOT_FOUND: "rider.search.cancel.notFound",
  /** «تأخَّرتَ» لا «لا تملكُها»: الفرقُ يُقرأُ فعلاً مختلفاً من الراكبِ. */
  ORDER_NOT_CANCELLABLE: "rider.search.cancel.notCancellable",
};

export function cancelRefusalKey(code: string): string {
  return CANCEL_REFUSAL_KEYS[code] ?? "rider.search.cancel.unknown";
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_REQUIRED: "rider.search.error.session",
  SESSION_INVALID: "rider.search.error.session",
  SESSION_EXPIRED: "rider.search.error.session",
  SESSION_NOT_AVAILABLE: "rider.search.error.unavailable",
  MALFORMED: "rider.search.error.malformed",
  INVALID_JSON: "rider.search.error.malformed",
  PAYLOAD_TOO_LARGE: "rider.search.error.malformed",
  UNKNOWN_SERVICE: "rider.search.error.unknownService",
  NOTES_TOO_LONG: "rider.search.refused.notesTooLong",
  IDEMPOTENCY_KEY_REQUIRED: "rider.search.refused.keyRequired",
  IDEMPOTENCY_KEY_INVALID: "rider.search.refused.keyTooLong",
  ACCOUNT_NOT_FOUND: "rider.search.error.account",
  RIDER_NOT_REGISTERED: "rider.search.error.notRegistered",
  RIDE_STORE_NOT_AVAILABLE: "rider.search.error.unavailable",
  /**
   * `WR-06` — رفضٌ يُصلِحُه الراكبُ يُقالُ بسببِه. كانت هذه الرموزُ تسقطُ إلى «الخدمة غير متاحة»
   * فيظنُّ الراكبُ عطلًا وهوَ مبلغٌ أو وصفٌ أو مكانٌ أو وقتٌ يُصحَّح.
   */
  OFFER_MODE_INVALID: "rider.search.error.offerInvalid",
  OFFER_AMOUNT_REQUIRED: "rider.search.error.offerRequired",
  OFFER_AMOUNT_INVALID: "rider.search.error.offerInvalid",
  OFFER_AMOUNT_UNEXPECTED: "rider.search.error.offerInvalid",
  PARCEL_DESCRIPTION_INVALID: "rider.search.error.parcelInvalid",
  PLACE_INVALID: "rider.search.error.placeInvalid",
  PLACE_LINK_UNSUPPORTED: "rider.search.error.placeLink",
  PLACE_NOTES_TOO_LONG: "rider.search.error.placeNotes",
  PLACE_POINT_UNRELIABLE: "rider.search.error.placePoint",
  PICKUP_AT_INVALID: "rider.search.error.pickupAt",
};

export function rideErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.search.error.unavailable";
}

/**
 * وهل تُعادُ المحاولةُ؟ لا تُعادُ لعطبِ عقدٍ ولا لجلسةٍ ساقطةٍ ولا لحسابٍ ناقصٍ:
 * إعادةُ نداءٍ يُرفَضُ حتماً تُشغِلُ الراكبَ بما لا يتغيَّرُ.
 */
export function isRetryableRideError(code: string): boolean {
  return (
    code === "SESSION_NOT_AVAILABLE" || code === "RIDE_STORE_NOT_AVAILABLE" || code === "HTTP_ERROR"
  );
}

/**
 * مفتاحُ التكرارِ — يُولَّدُ **مرّةً لكلِّ نيّةِ طلبٍ** ويُعادُ في كلِّ محاولةٍ.
 * وشكلُه يُوافقُ ما يقبلُه النطاقُ حرفاً (`[A-Za-z0-9._:-]` وطولٌ ≥ 8)، وأصلُه
 * `crypto.randomUUID` حيثُ وُجِدَ — ولا يُشتقُّ من الوقتِ وحدَه: ضغطتانِ في
 * مِلّي ثانيةٍ واحدةٍ تُنتِجانِ المفتاحَ نفسَه فتُفقَدُ رحلةٌ قُصِدَتْ.
 */
export function newIdempotencyKey(random: () => string = defaultRandom, scope = "ride"): string {
  // **النطاقُ وسيطٌ لا نسخةٌ ثانيةٌ من الدالّةِ**: مفتاحُ اللاتكرارِ واحدٌ في
  // العميلِ كلِّه (`ADR 0043`)، وأوَّلُ مَن نسخَه لنفسِه نسخَ معه بديلَ بيئةٍ
  // بلا `crypto` — فيصيرُ في الشاشتَينِ حكمانِ للعشوائيّةِ يتفارقانِ.
  return `${scope}:${random()}`;
}

function defaultRandom(): string {
  const source = globalThis.crypto;
  if (source !== undefined && typeof source.randomUUID === "function") return source.randomUUID();
  // بديلٌ لبيئةٍ بلا `crypto`: عشوائيٌّ مضاعفٌ معَ الوقتِ، لا الوقتُ وحدَه.
  const noise = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `${Date.now().toString(36)}.${noise}`;
}
