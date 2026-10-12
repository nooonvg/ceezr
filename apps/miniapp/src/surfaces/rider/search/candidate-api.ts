/**
 * الغرض: نداءا «الراكبُ يختارُ السائق» (`WR-09` · ADR 0266) — قراءةُ المرشَّحِ وقرارُ الراكب.
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `RideCandidateCard.tsx`
 *
 * لا إعادةَ تلقائيّةً للقرار: القرارُ فعلٌ ذو أثرٍ، والقاعدةُ تُعيدُ القرارَ نفسَه
 * `duplicate:true` فإعادتُه بزرٍّ آمنة. والموعدُ يحكمُه الخادمُ لا ساعةُ الجهاز.
 */
import { apiFetch } from "../../../api/client.ts";

export interface ApiRideCandidate {
  readonly driver_id: string;
  readonly driver_name: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
  readonly rating_average: number | null;
  readonly rating_count: number;
  readonly distance_km: number | null;
  readonly expires_at: string;
  readonly seconds_left: number;
}

export interface RideCandidateResponse {
  readonly ok: true;
  readonly order_status: string;
  readonly candidate: ApiRideCandidate | null;
}

export interface RideCandidateDecisionResponse {
  readonly ok: true;
  readonly decision: "accepted" | "rejected";
  readonly duplicate: boolean;
  readonly matched_at: string | null;
}

export function readRideCandidate(orderId: string): Promise<RideCandidateResponse> {
  return apiFetch<RideCandidateResponse>(`/v1/rides/${orderId}/candidate`, { method: "GET" });
}

export function decideRideCandidate(
  orderId: string,
  driverId: string,
  decision: "accept" | "reject",
): Promise<RideCandidateDecisionResponse> {
  return apiFetch<RideCandidateDecisionResponse>(`/v1/rides/${orderId}/candidate`, {
    method: "POST",
    body: { driverId, decision },
  });
}
