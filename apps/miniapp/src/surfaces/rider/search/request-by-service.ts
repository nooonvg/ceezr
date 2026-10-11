/**
 * الغرض: موجِّهُ الطلبِ حسبَ الخدمةِ — حينَ يختارُ الراكبُ خدمةَ التوصيلِ
 *   يُرسَلُ الطلبُ إلى `POST /v1/deliveries` بوصفِ الطردِ الاختياريِّ (`WR-18`)،
 *   وحينَ يختارُ النقلَ يُرسَلُ إلى `POST /v1/rides` كما كان.
 * الحالة: منفَّذ — يُكمِّلُ `F2-05` لخدمةِ التوصيلِ في شاشةِ البحثِ.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `SearchScreen.tsx` كافتراضٍ لخاصّيةِ `request`.
 *
 * ## لماذا موجِّهٌ لا تعديلُ `requestRide`
 *
 * لأنَّ `requestRide` عقدُه مغلقٌ (`F2-05`) ويُرسلُ إلى `/v1/rides` وحده.
 * والتوصيلُ يُرسَلُ إلى `/v1/deliveries` بوصفِ طردٍ اختياريٍّ (`WR-18`).
 * فالموجِّهُ يَفصلُ بينَ المسارَينِ بلا تغييرٍ لعقدِ `requestRide`.
 *
 * ## ولماذا `notes` مصدرُ وصفِ الطردِ
 *
 * لأنَّ شاشةَ البحثِ تأخذُ ملاحظةً واحدةً من الراكبِ. وفي التوصيلِ، وصفُ الطردِ
 * هو الملاحظةُ — فلا حقلَ ثانٍ يُضافُ ولا شاشةٌ تُبنى. والتحقُّقُ من الطولِ
 * (٣–٢٠٠) يقعُ في البوّابةِ لا ههنا.
 */

import { apiFetch } from "../../../api/client.ts";
import type { PlaceWire } from "../destination/destination-view.ts";
import { type ApiFetchFn, type RequestDeliveryInput, requestDelivery } from "./delivery-api.ts";
import { requestRide } from "./ride-api.ts";
import type { RequestRideResponse } from "./ride-contract.ts";

/** مدخلُ الطلبِ الموحَّدُ — يُطابقُ شكلَ `SearchScreenProps.request`. */
export interface ServiceRequestInput {
  readonly idempotencyKey: string;
  readonly service: string;
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
  readonly notes?: string;
  readonly pickupLabel?: string | null;
  readonly destinationLabel?: string | null;
  readonly pickupAt?: string | null;
  /** `ORDER-OFFER-01` — يُطوى غائباً أو `null`. */
  readonly offerSar?: number | null;
  /** `LOC-TRUST-01` — مصدرُ النقطةِ ودقّتُها ووقتُها والرابطُ الأصليُّ والملاحظات. */
  readonly pickupPlace?: PlaceWire | null;
  readonly dropoffPlace?: PlaceWire | null;
}

/**
 * يُوجِّهُ الطلبَ حسبَ الخدمةِ: `delivery` → `POST /v1/deliveries`،
 * وما سواه → `POST /v1/rides` كما كان.
 *
 * في التوصيلِ، تُستعمَلُ `notes` كوصفٍ للطردِ. والتحقُّقُ من الطولِ يقعُ في البوّابة.
 *
 * `apiFetch` يُحقنُ اختياريّاً للإختبارِ — وافتراضُهُ `apiFetch` الحقيقيُّ.
 */
export function requestByService(
  input: ServiceRequestInput,
  fetchFn?: ApiFetchFn,
): Promise<RequestRideResponse> {
  if (input.service === "delivery") {
    const deliveryInput: RequestDeliveryInput = {
      idempotencyKey: input.idempotencyKey,
      originLat: input.originLat,
      originLng: input.originLng,
      destinationLat: input.destinationLat,
      destinationLng: input.destinationLng,
      // `ORDER-TERMS-01` — نوعُ الطردِ اختياريٌّ؛ والاسمانِ ووقتُ الحضورِ تصلُ السائقَ.
      parcelDescription: input.notes ?? "",
      ...(input.pickupLabel ? { pickupLabel: input.pickupLabel } : {}),
      ...(input.destinationLabel ? { destinationLabel: input.destinationLabel } : {}),
      ...(input.pickupAt == null ? {} : { pickupAt: input.pickupAt }),
      ...(input.offerSar == null ? {} : { offerSar: input.offerSar }),
      ...(input.pickupPlace == null ? {} : { pickupPlace: input.pickupPlace }),
      ...(input.dropoffPlace == null ? {} : { dropoffPlace: input.dropoffPlace }),
    };
    return requestDelivery(deliveryInput, fetchFn ?? (apiFetch as unknown as ApiFetchFn));
  }
  return requestRide(input);
}
