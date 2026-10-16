/**
 * الغرض: نداءاتُ قرارِ الراكبِ في تفاوضِ القروبِ (`ADR 0286`): قراءةُ الدورةِ
 *   المفتوحةِ، واختيارُ السائقِ المعروضِ، والاتفاقُ، وتجاوزُ السائقِ — كلُّها عبرَ
 *   المنافذِ الذرّيّةِ القائمةِ نفسِها التي ناداها حوارُ البوتِ.
 * الحالة: منفّذ فعلياً — `ADR 0286`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `NegotiationPanel.tsx`.
 *
 * ## وما لا تفعلُه هذه النداءاتُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا تُقرِّرُ انتهاءَ النافذةِ**: ثواني الخادمِ تُنقلُ كما هي.
 *   ــ **لا تُعيدُ المحاولةَ تلقائيّاً**: القرارُ فعلٌ ذو أثرٍ، وإعادتُه تلقائيّاً
 *      قد تُكرِّرُ قراراً خفيَ. الزرُّ يفهمُه الإنسانُ.
 *   ــ **لا تُخزِّنُ شيئاً محلّيّاً**: الحالةُ من الخادمِ عندَ كلِّ قراءةٍ.
 */

import { apiFetch } from "../../../api/client.ts";

/** دورةُ الراكبِ المفتوحةُ — أو لا دورةَ (`ok: true, negotiation: null`). */
export interface ApiRiderNegotiation {
  readonly negotiationId: string;
  readonly orderId: string;
  readonly status: "collecting" | "negotiating";
  readonly collectSecondsLeft: number;
  readonly claimCount: number;
  readonly activePosition: number | null;
}

export interface RiderNegotiationResponse {
  readonly ok: true;
  readonly negotiation: ApiRiderNegotiation | null;
}

/** بطاقةُ السائقِ المعروضِ — الاسمُ الأوّلُ والتقييمُ والمركبةُ كما في بطاقةِ البوتِ. */
export interface ApiNegotiationDriverCard {
  readonly firstName: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly completedTrips: number;
  readonly vehicleType: string | null;
  readonly vehicleYear: number | null;
  readonly memberSinceYear: number | null;
}

export interface RiderDriverCardResponse {
  readonly ok: true;
  readonly card: ApiNegotiationDriverCard | null;
}

export interface SelectDriverResponse {
  readonly ok: true;
  readonly selected: boolean;
  readonly already: boolean;
  readonly reason: string | null;
}

export interface SettleResponse {
  readonly ok: true;
  readonly settled: boolean;
  readonly order_id: string | null;
  readonly reason: string | null;
}

export interface AdvanceResponse {
  readonly ok: true;
  readonly reason: string | null;
}

export function readRiderNegotiation(): Promise<RiderNegotiationResponse> {
  return apiFetch<RiderNegotiationResponse>("/v1/negotiations", { method: "GET" });
}

export function readNegotiationDriverCard(
  negotiationId: string,
  position: number,
): Promise<RiderDriverCardResponse> {
  return apiFetch<RiderDriverCardResponse>(
    `/v1/negotiations/${negotiationId}/card?position=${position}`,
    { method: "GET" },
  );
}

export function selectNegotiationDriver(
  negotiationId: string,
  position: number,
): Promise<SelectDriverResponse> {
  return apiFetch<SelectDriverResponse>(`/v1/negotiations/${negotiationId}/select`, {
    method: "POST",
    body: { position },
  });
}

export function settleNegotiation(negotiationId: string): Promise<SettleResponse> {
  return apiFetch<SettleResponse>(`/v1/negotiations/${negotiationId}/settle`, {
    method: "POST",
  });
}

export function advanceNegotiationDriver(
  negotiationId: string,
  position: number,
): Promise<AdvanceResponse> {
  return apiFetch<AdvanceResponse>(`/v1/negotiations/${negotiationId}/advance`, {
    method: "POST",
    body: { position },
  });
}
