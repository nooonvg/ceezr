/**
 * الغرض: منفذُ قراءةِ المرشَّحِ وقرارِ الراكبِ على القاعدة (`WR-09` · ADR 0266).
 *   لا منطقَ ههنا: الحكمُ كلُّه في `rider_order_candidate` و`rider_decide_candidate`.
 * الحالة: منفَّذٌ فعليّاً — 2026-10-12.
 * ينتمي إلى: packages/infrastructure/transport
 */
import type {
  RideCandidate,
  RideCandidateRefusal,
  RideCandidateStore,
  RideCandidateStoreError,
} from "../../application/transport/ride-candidate.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const REFUSALS: readonly RideCandidateRefusal[] = [
  "ORDER_NOT_FOUND",
  "ORDER_NOT_SEARCHING",
  "CANDIDATE_CHANGED",
  "CANDIDATE_EXPIRED",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function refusal(payload: Record<string, unknown>): RideCandidateStoreError {
  const code = payload.error;
  return REFUSALS.find((entry) => entry === code) ?? "STORE_ERROR";
}

function candidateFrom(value: unknown): RideCandidate | null {
  if (!isRecord(value)) return null;
  const driverId = text(value.driver_id);
  const expiresAt = text(value.expires_at);
  if (driverId === null || expiresAt === null) return null;
  return {
    driverId,
    driverName: text(value.driver_name),
    plate: text(value.plate),
    vehicle: text(value.vehicle),
    ratingAverage: num(value.rating_average),
    ratingCount: num(value.rating_count) ?? 0,
    distanceKm: num(value.distance_km),
    expiresAt,
    secondsLeft: Math.max(0, Math.floor(num(value.seconds_left) ?? 0)),
  };
}

export function createRideCandidateStore(sql: Sql): RideCandidateStore {
  return {
    read: async ({ telegramUserId, orderId }) => {
      let payload: unknown;
      try {
        const rows = await sql<{ result: unknown }[]>`
          select rider_order_candidate(${telegramUserId}::bigint, ${orderId}::uuid) as result`;
        payload = rows[0]?.result;
      } catch {
        return err("STORE_ERROR");
      }
      if (!isRecord(payload)) return err("STORE_ERROR");
      if (payload.ok !== true) return err(refusal(payload));
      return ok({
        orderStatus: text(payload.order_status) ?? "unknown",
        serverTime: text(payload.server_time) ?? new Date().toISOString(),
        candidate: candidateFrom(payload.candidate),
      });
    },
    decide: async ({ telegramUserId, orderId, driverId, accept }) => {
      let payload: unknown;
      try {
        const rows = await sql<{ result: unknown }[]>`
          select rider_decide_candidate(
            ${telegramUserId}::bigint, ${orderId}::uuid, ${driverId}::uuid, ${accept}
          ) as result`;
        payload = rows[0]?.result;
      } catch {
        return err("STORE_ERROR");
      }
      if (!isRecord(payload)) return err("STORE_ERROR");
      if (payload.ok !== true) return err(refusal(payload));
      return ok({
        decision: payload.decision === "accepted" ? "accepted" : "rejected",
        duplicate: payload.duplicate === true,
        matchedAt: text(payload.matched_at),
      });
    },
  };
}
