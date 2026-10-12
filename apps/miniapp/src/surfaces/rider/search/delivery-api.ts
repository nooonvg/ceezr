/**
 * الغرض: بابُ التوصيلِ عندَ العميلِ — إنشاءُ طلبِ توصيلٍ بوصفِ طردٍ اختياريٍّ (`WR-18`)،
 *   عبرَ `POST /v1/deliveries` لا `/v1/rides`. يُكمِّلُ مسارَ التوصيلِ end-to-end
 *   من الواجهةِ إلى طبقةِ النطاق.
 * الحالة: منفَّذ — يُكمِّلُ `F2-05` (شاشةُ البحثِ) لخدمةِ التوصيل.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `SearchScreen.tsx` حينَ يختار الراكبُ خدمةَ التوصيل.
 * يُتوقَّع أن يستخدمه لاحقاً: شاشةُ تتبُّعِ التوصيلِ إنِ اختلفت عن مسارِ الرحلة.
 *
 * ## لماذا مسارٌ منفصلٌ لا تعديلُ `requestRide`
 *
 * لأنَّ `POST /v1/rides` عقدُه مغلقٌ (`F2-05`) ولا يحملُ `parcelDescription`.
 * ومسارُ `POST /v1/deliveries` يقبلُ الوصفَ فارغًا، ويُحقِّقُ ما كُتِبَ منه في البوّابة.
 * فالنداءُ المنفصلُ يحترمُ العقدَ المغلقَ ويُرسلُ الحقلَ الخاصَّ بالتوصيل.
 *
 * ## ولماذا الحاقنُ لا الاستيرادُ المباشرُ
 *
 * لأنَّ `apiFetch` في `api/client.ts` يستوردُ `identity/session.ts` فـ`tg/*`
 * التي تستعملُ `window` و`document` — وهي أنواعٌ غيرُ متاحةٍ في tsconfig الجذر.
 * فالحقنُ يَفصلُ الاختبارَ عن سلسلةِ الاستيرادِ تلك، ويُبقي `delivery-api.ts`
 * قابلاً للاختبارِ بلا DOM.
 *
 * ## وما لا يفعله هذا الملفُّ
 *
 *   ــ **لا يُخزِّنُ ردّاً**: حالةُ بحثٍ محفوظةٌ محلّيّاً تُقرأُ بعدَ إسنادٍ حصلَ.
 *   ــ **لا يُعيدُ المحاولةَ من نفسِه**: الإعادةُ قرارُ شاشةٍ.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API (`ApiError`/`ApiNetworkError`).
 *   ــ **لا يُسعِّرُ التوصيل**: التسعيرُ محجوبٌ بـ`DEC-11`/`F12-16`.
 */

import type { PlaceWire } from "../destination/destination-view.ts";
import type { RequestRideResponse, RiderOfferMode } from "./ride-contract.ts";

export type * from "./ride-contract.ts";

export interface RequestDeliveryInput {
  readonly idempotencyKey: string;
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
  /** نوعُ الطردِ — اختياريٌّ منذُ `ORDER-TERMS-01` (فارغٌ ⇒ «لم يُحدَّد»)؛ وما كُتِبَ ٣–٢٠٠ حرفٍ. */
  readonly parcelDescription: string;
  readonly pickupLabel?: string;
  readonly destinationLabel?: string;
  readonly pickupAt?: string;
  /** `ORDER-OFFER-01` — مبلغُ الراكبِ بالريال؛ غائبٌ ⇒ قابلٌ للتفاوض. */
  readonly offerSar?: number;
  /** `WR-05` — سياسةُ المبلغ: `fixed` · `suggested` · `open`. */
  readonly offerMode?: RiderOfferMode;
  /** ملاحظةٌ إضافيّةٌ للسائقِ — تُطوى إن كانت فارغةً. */
  readonly notes?: string;
  /** `LOC-TRUST-01` — مصدرُ النقطةِ ودقّتُها ووقتُها والرابطُ الأصليُّ والملاحظات. */
  readonly pickupPlace?: PlaceWire | null;
  readonly dropoffPlace?: PlaceWire | null;
}

/**
 * نوعُ دالّةِ النداءِ — يُحقنُ فلا يُستورَدُ فيه `api/client.ts` ولا `session.ts`.
 * يُطابقُ توقيعَ `apiFetch` دونَ الاعتمادِ عليه.
 */
export type ApiFetchFn = (path: string, init: Record<string, unknown>) => Promise<unknown>;

/**
 * يُنشئ طلبَ توصيلٍ عبرَ `POST /v1/deliveries`.
 *
 * يُرسلُ `parcelDescription` (فارغًا إن لم يُكتَب)، والوجهةَ إلزاميّاً. والردُّ هو عقدُ
 * `RequestRideResponse` نفسُه — فالطلبُ واحدٌ ولا فرقَ في شكلِ الردِّ.
 *
 * `apiFetch` يُحقنُ لا يُستورَدُ — فلا تُجَرُّ سلسلةُ `session` و`tg` في الاختبار.
 */
export function requestDelivery(
  input: RequestDeliveryInput,
  apiFetch: ApiFetchFn,
): Promise<RequestRideResponse> {
  const { idempotencyKey, ...body } = input;
  return apiFetch("/v1/deliveries", {
    method: "POST",
    idempotencyKey,
    body,
  }) as Promise<RequestRideResponse>;
}
