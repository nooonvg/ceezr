/**
 * الغرض: منفذُ إيداعِ إشعارِ طورِ الرحلةِ في صندوقِ الصادرِ (`WR-15` · ADR 0265).
 *   نداءٌ واحدٌ لـ`enqueue_rider_trip_notice`؛ ومفتاحُ منعِ التكرارِ في القاعدة،
 *   فالضغطةُ المكرّرةُ أو إعادةُ الطلبِ لا تُنشئُ صفّاً ثانياً.
 * الحالة: منفّذ فعلياً — 2026-10-12، البند `WR-15`.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/gateway/src/container.ts
 */
import type {
  RiderTripEvent,
  RiderTripNoticeOutbox,
} from "../../application/driver/rider-trip-notice.ts";
import type { Sql } from "../db/client.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EnqueueRow {
  readonly r: {
    readonly ok: boolean;
    readonly created?: boolean;
    readonly error?: string;
    /** 20261018150000 — معرّفُ تيليجرامِ الراكبِ نصًّا، أو `null` لحسابٍ مُجهَّل. */
    readonly rider_telegram_id?: string | null;
  };
}

export function createRiderTripNoticeOutbox(sql: Sql): RiderTripNoticeOutbox {
  return {
    enqueue: async (orderId: string, event: RiderTripEvent) => {
      if (!UUID.test(orderId)) return null;
      const rows = await sql<EnqueueRow[]>`
        select enqueue_rider_trip_notice(${orderId}::uuid, ${event}::text) as r`;
      const result = rows[0]?.r;
      if (result === undefined) throw new Error("enqueue_rider_trip_notice: no row");
      if (!result.ok) {
        if (result.error === "ORDER_NOT_FOUND") return null;
        throw new Error(`enqueue_rider_trip_notice: ${result.error ?? "unknown"}`);
      }
      const tg = result.rider_telegram_id;
      return {
        created: result.created === true,
        riderTelegramId: typeof tg === "string" && tg.length > 0 ? tg : null,
      };
    },
  };
}
