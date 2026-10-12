/**
 * الغرض: محوّلاتُ الطلباتِ المجدولةِ إلى القاعدة — `WR-06` (ADR 0273).
 *
 * `release_due_scheduled_orders` و`enqueue_scheduled_reminders` تحكمانِ في القاعدةِ ذرّيًّا،
 * وهذا المِلفُّ يقرأُ حمولتَهما **بلا افتراض**: معرّفٌ ليسَ نصًّا عطبُ عقدٍ لا طلبٌ.
 */

import type { PickupReminderStateReader } from "../../application/dispatch/deliver-candidate-notices.ts";
import type {
  SearchExpiryOutcome,
  SearchingOrderExpirer,
} from "../../application/dispatch/expire-searching-orders.ts";
import type {
  ScheduledOrderReleaser,
  ScheduledReleaseOutcome,
} from "../../application/dispatch/release-scheduled-orders.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";

function idsOf(value: unknown, field: string): readonly OrderId[] {
  if (!Array.isArray(value)) throw new Error(`scheduled-orders.${field}: not an array`);
  return value.map((entry) => {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(`scheduled-orders.${field}: invalid id`);
    }
    return entry as OrderId;
  });
}

export function createScheduledOrderReleaser(sql: Sql): ScheduledOrderReleaser {
  return {
    releaseDue: (cityId: CityId, limit: number) =>
      guard("orders.releaseScheduled", async (): Promise<ScheduledReleaseOutcome> => {
        const rows = await sql<{ result: Record<string, unknown> | null }[]>`
          select release_due_scheduled_orders(${cityId}::uuid, ${limit}::integer) as result`;
        const result = rows[0]?.result;
        if (result === null || result === undefined || result.ok !== true) {
          throw new Error(`release_due_scheduled_orders: ${String(result?.error ?? "no result")}`);
        }
        return {
          released: idsOf(result.released, "released"),
          missed: idsOf(result.missed, "missed"),
        };
      }),
  };
}

/** `WR-22` (ADR 0276) — انتهاءُ البحث؛ الحكمُ في `expire_stale_searching_orders`. */
export function createSearchingOrderExpirer(sql: Sql): SearchingOrderExpirer {
  return {
    expireStale: (cityId: CityId, limit: number) =>
      guard("orders.expireSearching", async (): Promise<SearchExpiryOutcome> => {
        const rows = await sql<{ result: Record<string, unknown> | null }[]>`
          select expire_stale_searching_orders(${cityId}::uuid, ${limit}::integer) as result`;
        const result = rows[0]?.result;
        if (result === null || result === undefined || result.ok !== true) {
          throw new Error(`expire_stale_searching_orders: ${String(result?.error ?? "no result")}`);
        }
        return {
          disabled: result.disabled === true,
          expired: idsOf(result.expired, "expired"),
          held: Number(result.held ?? 0),
        };
      }),
  };
}

export interface ScheduledReminderCounts {
  readonly riderReminders: number;
  readonly driverReminders: number;
}

export async function enqueueScheduledReminders(
  sql: Sql,
  limit: number,
): Promise<ScheduledReminderCounts> {
  const rows = await sql<{ result: Record<string, unknown> | null }[]>`
    select enqueue_scheduled_reminders(${limit}::integer) as result`;
  const result = rows[0]?.result;
  if (result === null || result === undefined || result.ok !== true) {
    throw new Error("enqueue_scheduled_reminders: no result");
  }
  return {
    riderReminders: Number(result.rider_reminders ?? 0),
    driverReminders: Number(result.driver_reminders ?? 0),
  };
}

/** تذكيرُ السائقِ ما زالَ لازمًا؟ مُسنَدٌ إليه، `matched`، ولم يصل. */
export function createPickupReminderStateReader(sql: Sql): PickupReminderStateReader {
  return {
    read: async (orderId, driverId) => {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuid.test(orderId) || !uuid.test(driverId)) return null;
      const rows = await sql<{ still_due: boolean }[]>`
        select (o.status = 'matched'
                and o.assigned_driver_id = ${driverId}::uuid
                and o.arrived_at is null) as still_due
          from orders o
         where o.id = ${orderId}::uuid`;
      const row = rows[0];
      return row === undefined ? null : { stillDue: row.still_due === true };
    },
  };
}
