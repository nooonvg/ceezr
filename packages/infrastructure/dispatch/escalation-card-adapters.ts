/**
 * الغرض: `WR-22` (ADR 0278) — منفذُ بطاقاتِ الإسنادِ المنتهيةِ على PostgreSQL. البطاقةُ هي أثرُ
 *   `order.escalated` المسلَّمُ ذو `message_id`، وحالُ إغلاقِها في `escalation_card_closures`.
 * الحالة: منفّذ فعلياً — 2026-10-13.
 * ينتمي إلى: infrastructure/dispatch
 * يُستخدم من: apps/workers/src/container.ts
 */

import type {
  EscalationCardOutcome,
  StaleEscalationCard,
  StaleEscalationCardPort,
} from "../../application/dispatch/close-escalation-cards.ts";
import { guard, type Sql } from "../db/client.ts";

/** الحالاتُ التي لا رجعةَ عنها. `matched` ليست منها: السائقُ قد ينسحبُ فيعودُ البحث. */
export const ESCALATION_CARD_FINAL_STATUSES = [
  "in_progress",
  "completed",
  "cancelled",
  "failed",
] as const;

export function escalationCardOutcome(
  status: string,
  cancelledReason: string | null,
): EscalationCardOutcome {
  if (status === "in_progress" || status === "completed") return "assigned";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" && cancelledReason === "search_expired") return "search_expired";
  return "ended";
}

export function createStaleEscalationCardPort(sql: Sql): StaleEscalationCardPort {
  return {
    listStale: (cityId, limit, maxAttempts) =>
      guard("escalations.listStaleCards", async (): Promise<readonly StaleEscalationCard[]> => {
        const rows = await sql<
          {
            audit_id: string;
            order_id: string;
            group_id: string;
            message_id: string;
            status: string;
            cancelled_reason: string | null;
          }[]
        >`
          select a.id as audit_id, o.id as order_id,
                 c.telegram_escalation_group_id::text as group_id,
                 a.payload->>'message_id' as message_id,
                 o.status::text as status, o.cancelled_reason
            from audit_log a
            join orders o on o.id = a.entity_id
            join cities c on c.id = o.city_id
            left join escalation_card_closures x on x.audit_id = a.id
           where a.entity_type = 'order'
             and a.action = 'order.escalated'
             and coalesce((a.payload->>'delivered')::boolean, true) = true
             and nullif(a.payload->>'message_id', '') is not null
             and o.city_id = ${cityId}::uuid
             and o.status::text in ${sql([...ESCALATION_CARD_FINAL_STATUSES])}
             and c.telegram_escalation_group_id is not null
             and (x.audit_id is null or (x.closed_at is null and x.attempts < ${maxAttempts}))
           order by a.created_at
           limit ${limit}
        `;
        return rows.map((row) => ({
          auditId: row.audit_id,
          orderId: row.order_id,
          groupId: row.group_id,
          messageId: row.message_id,
          outcome: escalationCardOutcome(row.status, row.cancelled_reason),
        }));
      }),
    markClosed: (card, cityId) =>
      guard("escalations.markCardClosed", async () => {
        const rows = await sql<{ audit_id: string }[]>`
          insert into escalation_card_closures (audit_id, order_id, city_id, outcome, closed_at)
          values (${card.auditId}::uuid, ${card.orderId}::uuid, ${cityId}::uuid,
                  ${card.outcome}, now())
          on conflict (audit_id) do update
             set closed_at = now(), outcome = excluded.outcome, updated_at = now()
           where escalation_card_closures.closed_at is null
          returning audit_id
        `;
        return rows.length === 1;
      }),
    markAttemptFailed: (card, cityId) =>
      guard("escalations.markCardAttemptFailed", async () => {
        await sql`
          insert into escalation_card_closures (audit_id, order_id, city_id, attempts)
          values (${card.auditId}::uuid, ${card.orderId}::uuid, ${cityId}::uuid, 1)
          on conflict (audit_id) do update
             set attempts = escalation_card_closures.attempts + 1, updated_at = now()
           where escalation_card_closures.closed_at is null
        `;
      }),
  };
}
