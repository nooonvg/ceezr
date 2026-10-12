/**
 * الغرض: `WR-08` (ADR 0271) — منفذُ بطاقاتِ العروضِ الميّتةِ على `notification_outbox`.
 *   المآلُ يُشتقُّ حيًّا: عرضٌ `cancelled` أو طلبٌ ملغى ⇒ «أُلغي»، وطلبٌ أُسنِدَ إلى غيرِ صاحبِ
 *   البطاقة ⇒ «سبقك غيرُك»، وما سواهما ⇒ «انتهت المهلة».
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: infrastructure/dispatch
 * يُستخدم من: apps/workers/src/container.ts
 * ملاحظات مستقبلية: لا يُقرأُ رقمُ هاتفٍ ولا اسم؛ معرّفُ المحادثةِ وحدَه لأنَّه عنوانُ التعديل.
 */

import type {
  DeadOfferCard,
  DeadOfferCardPort,
  OfferCardOutcome,
} from "../../application/dispatch/close-dead-offer-cards.ts";
import { guard, type Sql } from "../db/client.ts";

interface DeadOfferCardRow {
  readonly id: string;
  readonly chat_id: string;
  readonly message_id: string;
  readonly language_code: string | null;
  readonly offer_status: string;
  readonly order_status: string;
  readonly taken_by_other: boolean;
}

export function offerCardOutcome(row: {
  readonly offer_status: string;
  readonly order_status: string;
  readonly taken_by_other: boolean;
}): OfferCardOutcome {
  if (row.offer_status === "cancelled" || row.order_status === "cancelled") return "cancelled";
  if (row.taken_by_other) return "taken";
  return "expired";
}

export function createDeadOfferCardPort(sql: Sql): DeadOfferCardPort {
  return {
    listDead: (cityId, limit, maxAttempts) =>
      guard("offers.listDeadOfferCards", async (): Promise<readonly DeadOfferCard[]> => {
        const rows = await sql<DeadOfferCardRow[]>`
          select x.id::text as id,
                 u.telegram_id::text as chat_id,
                 x.delivered_message_id as message_id,
                 u.language_code,
                 oo.status::text as offer_status,
                 o.status::text as order_status,
                 (o.assigned_driver_id is not null and o.assigned_driver_id <> oo.driver_id)
                   as taken_by_other
            from notification_outbox x
            join order_offers oo on oo.id = x.offer_id
            join orders o on o.id = oo.order_id
            join drivers d on d.id = oo.driver_id
            join users u on u.id = d.user_id
           where x.city_id = ${cityId}::uuid
             and x.kind = 'offer'
             and x.status = 'delivered'
             and x.delivered_message_id is not null
             and x.offer_card_closed_at is null
             and x.offer_card_close_attempts < ${maxAttempts}
             and oo.status in ('expired', 'cancelled')
             and u.telegram_id is not null
           order by x.delivered_at
           limit ${limit}
        `;
        return rows.map((row) => ({
          deliveryId: row.id,
          chatId: row.chat_id,
          messageId: row.message_id,
          languageCode: row.language_code ?? "ar",
          outcome: offerCardOutcome(row),
        }));
      }),
    markClosed: (deliveryId) =>
      guard("offers.markOfferCardClosed", async () => {
        await sql`
          update notification_outbox
             set offer_card_closed_at = now()
           where id = ${deliveryId}::uuid and offer_card_closed_at is null
        `;
      }),
    markAttemptFailed: (deliveryId) =>
      guard("offers.markOfferCardAttemptFailed", async () => {
        await sql`
          update notification_outbox
             set offer_card_close_attempts = offer_card_close_attempts + 1
           where id = ${deliveryId}::uuid
        `;
      }),
  };
}
