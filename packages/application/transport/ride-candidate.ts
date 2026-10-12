/**
 * الغرض: الراكبُ يرى السائقَ الذي قبِلَ طلبَه ويختارُه أو يرفضُه خلالَ مهلةٍ يحكمُها
 *   الخادم (`WR-09` · ADR 0266).
 * الحالة: منفَّذٌ فعليّاً — 2026-10-12.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts` (`/v1/rides/:id/candidate`).
 *
 * الهويّةُ من الجلسةِ وحدَها، والقاعدةُ تحكمُ ملكيّةَ الطلبِ (`rider_order_candidate`
 * و`rider_decide_candidate`): طرفٌ ثالثٌ يُرَدُّ `ORDER_NOT_FOUND` بلا تمييزٍ عن الغائب.
 * والقرارُ يحملُ معرّفَ السائقِ المعروضِ، فنقرةٌ متأخّرةٌ بعدَ تبدّلِ المرشَّحِ تُرَدُّ
 * `CANDIDATE_CHANGED` ولا تُصيبُ سواه. والموعدُ من ساعةِ القاعدة؛ وما فاتَه يُرَدُّ
 * `CANDIDATE_EXPIRED` ولو وصلَ الطلبُ قبلَه بلحظة.
 */
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";

export interface RideCandidate {
  readonly driverId: string;
  readonly driverName: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly distanceKm: number | null;
  readonly expiresAt: string;
  readonly secondsLeft: number;
}

export interface RideCandidateRead {
  readonly orderStatus: string;
  readonly serverTime: string;
  readonly candidate: RideCandidate | null;
}

export interface RideCandidateDecision {
  readonly decision: "accepted" | "rejected";
  readonly duplicate: boolean;
  readonly matchedAt: string | null;
}

export type RideCandidateRefusal =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_SEARCHING"
  | "CANDIDATE_CHANGED"
  | "CANDIDATE_EXPIRED";

export type RideCandidateStoreError = RideCandidateRefusal | "STORE_ERROR";

export interface RideCandidateStore {
  read(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<RideCandidateRead, RideCandidateStoreError>>;
  decide(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
    readonly driverId: string;
    readonly accept: boolean;
  }): Promise<Result<RideCandidateDecision, RideCandidateStoreError>>;
}

export interface RideCandidateDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: RideCandidateStore;
  readonly now: () => Date;
}

export type RideCandidateErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "MALFORMED"
  | RideCandidateRefusal
  | "RIDE_STORE_NOT_AVAILABLE";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function viewer(
  deps: RideCandidateDeps,
  accessToken: string | undefined,
): Promise<Result<string, RideCandidateErrorCode>> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }
  return ok(session.value.telegramUserId);
}

function storeError(error: RideCandidateStoreError): RideCandidateErrorCode {
  return error === "STORE_ERROR" ? "RIDE_STORE_NOT_AVAILABLE" : error;
}

export async function readRideCandidate(
  deps: RideCandidateDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<RideCandidateRead, RideCandidateErrorCode>> {
  const who = await viewer(deps, input.accessToken);
  if (!who.ok) return who;
  if (!UUID.test(input.orderId)) return err("ORDER_NOT_FOUND");
  const read = await deps.store.read({ telegramUserId: who.value, orderId: input.orderId });
  return read.ok ? read : err(storeError(read.error));
}

export async function decideRideCandidate(
  deps: RideCandidateDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: string;
    readonly body: unknown;
  },
): Promise<Result<RideCandidateDecision, RideCandidateErrorCode>> {
  const who = await viewer(deps, input.accessToken);
  if (!who.ok) return who;
  if (!UUID.test(input.orderId)) return err("ORDER_NOT_FOUND");
  const body =
    input.body !== null && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : null;
  const driverId = body?.driverId;
  const decision = body?.decision;
  if (
    typeof driverId !== "string" ||
    !UUID.test(driverId) ||
    (decision !== "accept" && decision !== "reject")
  ) {
    return err("MALFORMED");
  }
  const decided = await deps.store.decide({
    telegramUserId: who.value,
    orderId: input.orderId,
    driverId,
    accept: decision === "accept",
  });
  return decided.ok ? decided : err(storeError(decided.error));
}
