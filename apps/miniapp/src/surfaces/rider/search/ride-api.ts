/**
 * الغرض: بابُ الرحلةِ عندَ العميلِ — إنشاءٌ بمفتاحِ تكرارٍ، وقراءةُ حالةِ بحثٍ،
 *   وإلغاءٌ؛ بلا منطقِ عرضٍ وبلا حالةٍ محفوظةٍ (البند `F2-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `SearchScreen.tsx` افتراضاً، ويُستبدَلُ في الاختبارِ بحاقنٍ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ `readRide` على النسقِ نفسِه.
 *
 * ## لماذا المفتاحُ **مُعطًى** لا مُولَّدٌ ههنا
 *
 * لأنَّ إعادةَ المحاولةِ يجبُ أن تحملَ المفتاحَ **نفسَه**؛ ولو وُلِّدَ داخلَ دالّةِ
 * النداءِ لَحملَت كلُّ محاولةٍ مفتاحاً جديداً، فكانَ `ARCH-006` حرفاً بلا أثرٍ:
 * ضغطتانِ سريعتانِ ⇒ رحلتانِ. فالتوليدُ عندَ **نيّةِ** الراكبِ (شاشةُ الاقتباسِ)
 * والاستعمالُ ههنا، ويُعادُ بلا تغييرٍ في كلِّ محاولةٍ.
 *
 * ## وما لا يفعلُه
 *
 *   ــ **لا يُخزِّنُ ردّاً**: حالةُ بحثٍ محفوظةٌ محلّيّاً تُقرأُ بعدَ إسنادٍ حصلَ.
 *   ــ **لا يُعيدُ المحاولةَ من نفسِه**: الإعادةُ قرارُ شاشةٍ تعرفُ ما يراه الراكبُ.
 *   ــ **لا يبتلعُ خطأً**: يرمي كما يرمي حدُّ API (`ApiError`/`ApiNetworkError`).
 */

import { apiFetch } from "../../../api/client.ts";
import type { PlaceWire } from "../destination/destination-view.ts";
import type {
  CancelRideResponse,
  RequestRideResponse,
  RiderOfferMode,
  RideSearchResponse,
} from "./ride-contract.ts";

export type * from "./ride-contract.ts";

export interface RequestRideInput {
  readonly idempotencyKey: string;
  readonly service: string;
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
  /** ملاحظةُ السائقِ — تُطوى إن كانَت فارغةً ولا تُرسَلُ نصّاً فارغاً. */
  readonly notes?: string;
  /** `RIDE-LABEL-01` — اسما المكانَين ليراهما السائقُ؛ يُطويانِ فارغَين. */
  readonly pickupLabel?: string | null;
  readonly destinationLabel?: string | null;
  /** `ORDER-TERMS-01` — يُطوى غائباً. */
  readonly pickupAt?: string | null;
  /** `ORDER-OFFER-01` — مبلغُ الراكبِ بالريال؛ يُطوى غائباً. */
  readonly offerSar?: number | null;
  /** `WR-05` — سياسةُ المبلغ: `fixed` · `suggested` · `open`. */
  readonly offerMode?: RiderOfferMode;
  /** `LOC-TRUST-01` — مصدرُ النقطةِ ودقّتُها ووقتُها والرابطُ الأصليُّ والملاحظات. */
  readonly pickupPlace?: PlaceWire | null;
  readonly dropoffPlace?: PlaceWire | null;
}

export function requestRide(input: RequestRideInput): Promise<RequestRideResponse> {
  const {
    idempotencyKey,
    notes,
    pickupLabel,
    destinationLabel,
    pickupAt,
    offerSar,
    pickupPlace,
    dropoffPlace,
    ...rest
  } = input;
  return apiFetch<RequestRideResponse>("/v1/rides", {
    method: "POST",
    idempotencyKey,
    body: {
      ...rest,
      ...(notes === undefined || notes.length === 0 ? {} : { notes }),
      ...(pickupLabel === undefined || pickupLabel === null || pickupLabel.length === 0
        ? {}
        : { pickupLabel }),
      ...(destinationLabel === undefined ||
      destinationLabel === null ||
      destinationLabel.length === 0
        ? {}
        : { destinationLabel }),
      ...(pickupAt === undefined || pickupAt === null ? {} : { pickupAt }),
      ...(offerSar === undefined || offerSar === null ? {} : { offerSar }),
      ...(pickupPlace == null ? {} : { pickupPlace }),
      ...(dropoffPlace == null ? {} : { dropoffPlace }),
    },
  });
}

export function readRideSearch(orderId: string): Promise<RideSearchResponse> {
  return apiFetch<RideSearchResponse>(`/v1/rides/${encodeURIComponent(orderId)}/search`, {
    method: "GET",
  });
}

export function cancelRide(input: {
  readonly orderId: string;
  readonly idempotencyKey: string;
}): Promise<CancelRideResponse> {
  return apiFetch<CancelRideResponse>(`/v1/rides/${encodeURIComponent(input.orderId)}/cancel`, {
    method: "POST",
    idempotencyKey: input.idempotencyKey,
    body: {},
  });
}
