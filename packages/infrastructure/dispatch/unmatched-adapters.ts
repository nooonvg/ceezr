/**
 * الغرض: قراءة الطلبات العالقة في البحث بلا عرضٍ حيّ. والإشعارُ نفسُه لم يبقَ هنا:
 *   صارَ صفّاً في صندوقِ الصادرِ الموحَّدِ يُودَعُ في معاملةِ القاعدةِ ويُرسِلُه عاملُ
 *   الصادرِ (BUG-004) — انظر infrastructure/notification/telegram-unmatched-notifier.
 * الحالة: منفّذ ومُختبَر على قاعدة حقيقية.
 * ينتمي إلى: infrastructure/dispatch
 * يستخدمه: apps/workers/src/container.ts
 * ملاحظات مستقبلية: الاستعلام يقرأ فقط، والتصعيد نفسه يمرّ بدالّة ذرّية تقفل
 *   الصفّ — فتعدّد نسخ العامل لا يُنتج تصعيدين ولا رسالتين لنفس الطلب.
 */

import type {
  UnmatchedOrder,
  UnmatchedOrderFinder,
} from "../../application/dispatch/sweep-unmatched-orders.ts";
import type { CityId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";

interface StaleRow {
  readonly order_id: string;
  readonly city_id: string;
  readonly service: string;
  readonly telegram_id: string | number;
  readonly language_code: string | null;
  readonly broadcast_round: string | number;
  readonly has_any_offer: boolean;
  readonly waiting_seconds: string | number;
}

export function createUnmatchedOrderFinder(sql: Sql): UnmatchedOrderFinder {
  return {
    findStaleSearching: (cityId: CityId, olderThanSeconds: number) =>
      guard("unmatched.findStaleSearching", async (): Promise<readonly UnmatchedOrder[]> => {
        const rows = (await sql`
          select o.id            as order_id,
                 o.city_id       as city_id,
                 o.service::text as service,
                 u.telegram_id   as telegram_id,
                 u.language_code as language_code,
                 o.broadcast_round as broadcast_round,
                 exists (select 1 from order_offers f where f.order_id = o.id) as has_any_offer,
                 extract(epoch from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds
            from orders o
            join riders r on r.id = o.rider_id
            join users  u on u.id = r.user_id
           where o.city_id = ${cityId}::uuid
             and o.status = 'searching'
             and o.assigned_driver_id is null
             -- WR-06: عمرُ البحثِ من بدئه — مجدولٌ أُطلِقَ للتوّ لا يُصعَّدُ لأنّه أُنشئَ أمس.
             and coalesce(o.searching_since, o.created_at) < now() - make_interval(secs => ${olderThanSeconds})
             -- "بلا عرض حيّ" لا "بلا أي عرض": الشرط الثاني كان يحجب عن التصعيد
             -- طلباً استنفد دوراته وله عرضٌ منتهٍ: لا يُبَّث ثانياً ولا يُصعَّد — يتيمٌ دائم.
             -- ومن لمّا يزل في مسار الدورات يُستبعد في المجال بـroundsExhausted
             -- لا هنا: الاستعلام يقرأ حالةً ولا يفتي، وحدّ الدورات من إعدادات المدينة.
             and not exists (
               select 1 from order_offers f
                where f.order_id = o.id
                  and f.status = 'pending'
                  and f.expires_at > now()
             )
           order by o.created_at asc
           limit 50
        `) as readonly StaleRow[];

        return rows.map((row) => ({
          orderId: row.order_id as OrderId,
          cityId: row.city_id as CityId,
          service: row.service as ServiceType,
          riderChatId: String(row.telegram_id),
          riderLanguage: row.language_code,
          broadcastRound: Number(row.broadcast_round),
          hasAnyOffer: row.has_any_offer,
          waitingSeconds: Number(row.waiting_seconds),
        }));
      }),
  };
}
