/**
 * الغرض: قراءةُ ما يلزمُ لإخطارِ الراكبِ بطَورِ رحلتِه (`RIDE-NOTICE-01`) —
 *   معرِّفُ تلغرامِه ولغتُه، واسمُ السائقِ ولوحتُه ونوعُ مركبتِه.
 * الحالة: منفَّذٌ فعليّاً — 2026-10-03.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/gateway/src/index.ts (مساراتُ السائقِ في التطبيقِ المصغَّرِ).
 *
 * معزولٌ عن `driver-job-store.ts` عمداً: ذاك المخزنُ **لا يقرأُ معرِّفَ تلغرامِ
 * راكبٍ** ولا يُعيدُه للسائقِ. وهذا القارئُ لا يُعيدُ شيئاً لأيِّ شاشةٍ — يُغذّي
 * رسالةً تذهبُ إلى الراكبِ نفسِه على بوتِه هو.
 */

import type {
  RiderCandidateFacts,
  RiderCandidateFactsReader,
} from "../../application/dispatch/deliver-candidate-notices.ts";
import type {
  RiderTripFacts,
  RiderTripFactsReader,
} from "../../application/driver/rider-trip-notice.ts";
import type { Sql } from "../db/client.ts";

interface FactsRow {
  readonly rider_telegram_id: string | number | bigint | null;
  readonly rider_language: string | null;
  readonly driver_name: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
  readonly status: string | null;
  readonly pickup_at: Date | string | null;
  readonly dispatch_at: Date | string | null;
}

function instant(value: Date | string | null): Date | null {
  if (value === null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRiderTripFactsReader(sql: Sql): RiderTripFactsReader {
  return {
    read: async (orderId: string): Promise<RiderTripFacts | null> => {
      if (!UUID.test(orderId)) return null;
      const rows = await sql<FactsRow[]>`
        select ru.telegram_id::text as rider_telegram_id,
               ru.language_code     as rider_language,
               du.full_name         as driver_name,
               d.plate_number       as plate,
               d.vehicle_type::text as vehicle,
               o.status::text       as status,
               o.pickup_at,
               o.dispatch_at
          from orders o
          join riders r      on r.id = o.rider_id
          join users ru      on ru.id = r.user_id
          left join drivers d on d.id = o.assigned_driver_id
          left join users du  on du.id = d.user_id
         where o.id = ${orderId}::uuid
           and ru.erased_at is null`;
      const row = rows[0];
      if (row === undefined || row.rider_telegram_id === null) return null;
      return {
        riderTelegramId: String(row.rider_telegram_id),
        language: row.rider_language ?? "ar",
        driverName: row.driver_name,
        plate: row.plate,
        vehicle: row.vehicle,
        status: row.status,
        pickupAt: instant(row.pickup_at),
        dispatchAt: instant(row.dispatch_at),
      };
    },
  };
}

/**
 * `WR-09` — حقائقُ إشعارِ المرشَّحِ لحظةَ الإرسال: هل ما زالَ هذا العرضُ مرشَّحاً حيّاً،
 * ومن السائقُ وتقييمُه، وكم بقيَ بساعةِ القاعدة.
 */
export function createRiderCandidateFactsReader(sql: Sql): RiderCandidateFactsReader {
  return {
    read: async (orderId: string, offerId: string): Promise<RiderCandidateFacts | null> => {
      if (!UUID.test(orderId) || !UUID.test(offerId)) return null;
      const rows = await sql<
        {
          rider_telegram_id: string | null;
          rider_language: string | null;
          live: boolean;
          driver_name: string | null;
          plate: string | null;
          vehicle: string | null;
          rating_average: string | number | null;
          rating_count: number | null;
          seconds_left: number | null;
        }[]
      >`
        select ru.telegram_id::text as rider_telegram_id,
               ru.language_code     as rider_language,
               (o.status = 'searching'
                 and o.candidate_offer_id = ${offerId}::uuid
                 and o.candidate_expires_at > now()) as live,
               du.full_name         as driver_name,
               d.plate_number       as plate,
               d.vehicle_type::text as vehicle,
               d.rating_average,
               d.rating_count,
               greatest(0, ceil(extract(epoch from o.candidate_expires_at - now())))::integer
                 as seconds_left
          from orders o
          join riders r       on r.id = o.rider_id
          join users ru       on ru.id = r.user_id
          join order_offers oo on oo.id = ${offerId}::uuid and oo.order_id = o.id
          join drivers d      on d.id = oo.driver_id
          join users du       on du.id = d.user_id
         where o.id = ${orderId}::uuid
           and ru.erased_at is null`;
      const row = rows[0];
      if (row === undefined || row.rider_telegram_id === null) return null;
      const rating = row.rating_average === null ? null : Number(row.rating_average);
      return {
        riderTelegramId: String(row.rider_telegram_id),
        language: row.rider_language ?? "ar",
        live: row.live === true,
        driverName: row.driver_name,
        plate: row.plate,
        vehicle: row.vehicle,
        ratingAverage: rating !== null && Number.isFinite(rating) ? rating : null,
        ratingCount: row.rating_count ?? 0,
        secondsLeft: row.seconds_left ?? 0,
      };
    },
  };
}
