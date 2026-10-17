/**
 * الغرض: نداءاتُ عروضِ السائقِ — لوحٌ وتفاصيلُ وقبولٌ ورفضٌ وتبديلُ توفُّرٍ
 *   (البند `F3-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `OffersScreen.tsx` · `OfferDetailScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — نداءُ «رحلتي النشطةُ» يُضافُ ههنا.
 *
 * ## لِمَ لا إعادةَ محاولةٍ تلقائيّةً للقبولِ
 *
 * القبولُ **فعلٌ ذو أثرٍ**: إعادتُه تلقائيّاً بعدَ مهلةٍ قد تُصادِفُ نجاحاً
 * أُخفِيَ عن العميلِ بانقطاعِ شبكةٍ، فيرى السائقُ رفضاً وهوَ قد ظفرَ بالطلبِ —
 * أو تُقرأُ ضغطتانِ ضغطةً واحدةً. فالإعادةُ **بزرٍّ يفهمُه الإنسانُ**، والقاعدةُ
 * تردُّ `ORDER_NOT_CLAIMABLE` لمن سُبِقَ فتُقالُ لهُ كما هيَ.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا تُطوِّلُ مهلةً ولا تُقصِّرُها**: مهلةُ `apiFetch` واحدةٌ للسطحِ كلِّه.
 *   ــ **لا تُخزِّنُ لوحاً محلّيّاً**: لوحٌ مخزَّنٌ عمرُه ثوانٍ يُريكَ عرضاً مضى.
 *   ــ **لا تُقصِّرُ العدَّ**: المؤقّتُ عرضٌ لا نداءٌ.
 */

import { apiFetch } from "../../../api/client.ts";
import type {
  AcceptDriverOfferResponse,
  ClaimNegotiationResponse,
  DriverAvailabilityResponse,
  DriverNegotiationsResponse,
  DriverOfferDetailResponse,
  DriverOffersReceiptsResponse,
  DriverOffersResponse,
  LeaveNegotiationResponse,
  RejectDriverOfferResponse,
} from "./offers-contract.ts";

export type * from "./offers-contract.ts";

export function readDriverOffers(): Promise<DriverOffersResponse> {
  return apiFetch<DriverOffersResponse>("/v1/driver/offers", { method: "GET" });
}

/**
 * `LOAD-01 Recovery` — إقرارُ استلامِ اللوحِ: يُرسِلُه العميلُ **بعدَ تطبيقِ**
 * اللقطةِ (لا عندَ جلبِها)، فيفصلُ «سلّمها الخادمُ» عنِ «وصلَتْ». الإيصالُ
 * تراكميٌّ لا مُعوِّقٌ: فشلُهُ لا يُوقفُ العرضَ — التحديثُ التالي يُقرُّ بما
 * بقيَ، وشوطُ التسليمِ ينتظرُهُ دوراتٍ مسقوفةً ثمَّ بطاقةُ البوتِ.
 */
export function ackDriverOfferBoard(
  offerIds: readonly string[],
): Promise<DriverOffersReceiptsResponse> {
  return apiFetch<DriverOffersReceiptsResponse>("/v1/driver/offers/receipts", {
    method: "POST",
    body: { offer_ids: offerIds.slice(0, 50) },
  });
}

export function readDriverOfferDetail(offerId: string): Promise<DriverOfferDetailResponse> {
  return apiFetch<DriverOfferDetailResponse>(`/v1/driver/offers/${offerId}`, { method: "GET" });
}

export function acceptDriverOffer(offerId: string): Promise<AcceptDriverOfferResponse> {
  return apiFetch<AcceptDriverOfferResponse>(`/v1/driver/offers/${offerId}/accept`, {
    method: "POST",
  });
}

export function rejectDriverOffer(offerId: string): Promise<RejectDriverOfferResponse> {
  return apiFetch<RejectDriverOfferResponse>(`/v1/driver/offers/${offerId}/reject`, {
    method: "POST",
  });
}

export function setDriverAvailability(isAvailable: boolean): Promise<DriverAvailabilityResponse> {
  return apiFetch<DriverAvailabilityResponse>("/v1/driver/availability", {
    method: "POST",
    body: { is_available: isAvailable },
  });
}

/**
 * `ADR 0286` — دوراتُ القروبِ المفتوحةُ: المطالبةُ من التطبيقِ عبرَ المنفذِ الذرّيِّ
 * نفسِهِ، وثواني النافذةِ من الخادمِ لا من ساعةِ الجهازِ.
 */
export function readDriverNegotiations(): Promise<DriverNegotiationsResponse> {
  return apiFetch<DriverNegotiationsResponse>("/v1/driver/negotiations", { method: "GET" });
}

export function claimDriverNegotiation(negotiationId: string): Promise<ClaimNegotiationResponse> {
  return apiFetch<ClaimNegotiationResponse>(`/v1/driver/negotiations/${negotiationId}/claim`, {
    method: "POST",
  });
}

export function leaveDriverNegotiation(negotiationId: string): Promise<LeaveNegotiationResponse> {
  return apiFetch<LeaveNegotiationResponse>(`/v1/driver/negotiations/${negotiationId}/leave`, {
    method: "POST",
  });
}
