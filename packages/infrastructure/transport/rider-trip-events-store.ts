/**
 * الغرض: مخزنُ أحداثِ رحلةِ الراكبِ وإقراراتِه في Mini App — ADR 0287.
 *   يستدعي `list_rider_trip_events` و`ack_rider_trip_events` (الملكيةُ والإزالةُ
 *   في القاعدةِ).
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: infrastructure/transport
 */
import type {
  RiderTripEventsStore,
  RiderTripEventView,
} from "../../application/transport/rider-trip-events.ts";
import { err, ok } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function eventFrom(value: unknown): RiderTripEventView | null {
  if (!isRecord(value)) return null;
  const { id, event, seq, created_at: createdAt, acked } = value;
  if (typeof id !== "string" || typeof event !== "string" || typeof seq !== "number") return null;
  return {
    id,
    event,
    seq,
    createdAt: typeof createdAt === "string" ? createdAt : String(createdAt ?? ""),
    acked: acked === true,
  };
}

export function createRiderTripEventsStore(sql: Sql): RiderTripEventsStore {
  return {
    list: async ({ telegramUserId, orderId }) => {
      let payload: unknown;
      try {
        const rows = await sql<{ result: unknown }[]>`
          select list_rider_trip_events(${telegramUserId}::bigint, ${orderId}::uuid) as result`;
        payload = rows[0]?.result;
      } catch {
        return err("STORE_ERROR");
      }
      if (!isRecord(payload)) return err("STORE_ERROR");
      if (payload.ok !== true) {
        return err(payload.error === "ORDER_NOT_FOUND" ? "ORDER_NOT_FOUND" : "STORE_ERROR");
      }
      const events = Array.isArray(payload.events) ? payload.events : [];
      return ok(events.map(eventFrom).filter((e): e is RiderTripEventView => e !== null));
    },
    ack: async ({ telegramUserId, orderId, deliveryIds }) => {
      let payload: unknown;
      try {
        const rows = await sql<{ result: unknown }[]>`
          select ack_rider_trip_events(
            ${telegramUserId}::bigint, ${orderId}::uuid, ${deliveryIds as string[]}::uuid[]
          ) as result`;
        payload = rows[0]?.result;
      } catch {
        return err("STORE_ERROR");
      }
      if (!isRecord(payload) || payload.ok !== true) return err("STORE_ERROR");
      return ok({
        recorded: Number(payload.recorded ?? 0),
        closed: Number(payload.closed ?? 0),
      });
    },
  };
}
