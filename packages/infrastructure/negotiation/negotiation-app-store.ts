/**
 * الغرض: `ADR 0286` — مسارُ مطالباتِ القروباتِ وقرارِ الراكبِ في التفاوضِ من داخلِ
 *   التطبيقِ المصغَّرِ: قراءاتٌ على جداولِ الدورةِ، وكتاباتٌ عبرَ الدوالِّ الذرّيّةِ
 *   القائمةِ نفسِها التي كانَ البوتُ ينادِيها (`register_unsubscribed_claim` ·
 *   `withdraw_unsubscribed_claim` · `select_unsubscribed_claim` ·
 *   `settle_unsubscribed_negotiation` · `advance_unsubscribed_negotiation_at`).
 *   لا كاتبَ ثانٍ ولا مصدرَ حقيقةٍ ثانٍ — سطحٌ جديدٌ للعملِ نفسِه.
 * الحالة: منفّذ فعلياً — `ADR 0286`.
 * ينتمي إلى: infrastructure/negotiation
 * يُستخدم من: `apps/gateway/src/container.ts` عبرَ حقنِ التبعياتِ.
 *
 * ## ولِمَ القراءةُ تستعلمُ بلا دوالَّ
 *
 * لأنَّ جداولَ الدورةِ (`unsubscribed_negotiations` · `unsubscribed_claims`) جداولُ
 * تشغيلٍ لا عقودَ مُعلَنة: لو استُعمِلَت دالّةٌ لكلِّ قراءةٍ لَتضاعفَ عددُ الدوالِّ
 * بلا كاتبٍ جديد. فالقراءةُ استعلامٌ مباشرٌ بمعاملاتٍ مُمرَّرة، والكتابةُ دوالَّ
 * ذرّيّةً فقط — كما في بقيةِ مخازنِ القراءة.
 *
 * ## وما لا يفعله هذا المخزنُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يكتبُ حالةً بلا دالّةٍ ذرّيّةٍ**: كلُّ كتابةٍ عبرَ الدوالِّ القائمةِ.
 *   ــ **لا يثقُ بجسمِ الطلبِ في الهويّةِ**: الهويّةُ من الجلسةِ الموقَّعةِ فوقَ
 *      طبقةِ التطبيقِ، والاستعلامُ يُطابِقُ `telegram_id` بصاحبِ الدورةِ.
 *   ــ **لا يكشفَ هاتفَ سائقٍ ولا لوحةَ مركبةٍ**: بطاقةُ العرضِ للاسمِ الأوّلِ
 *      والتقييمِ والمركبةِ كما في بطاقةِ البوتِ نفسِها.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

/** خطأ قراءةِ المخزنِ — عطبٌ تقنيٌّ لا رفضَ أعمالٍ. */
export type NegotiationAppStoreError = "STORE_ERROR" | "MALFORMED_RESULT";

export function isNegotiationAppStoreError(value: unknown): value is NegotiationAppStoreError {
  return value === "STORE_ERROR" || value === "MALFORMED_RESULT";
}

/** دورةٌ مفتوحةٌ يراها السائقُ في مدينتِه. */
export interface DriverNegotiationCard {
  readonly negotiationId: string;
  readonly orderId: string;
  readonly service: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  /** ثوانٍ حتى إغلاقِ نافذةِ الجمعِ — صفرٌ تعنيَ انتهَت. */
  readonly collectSecondsLeft: number;
  /** موضعُ مطالبةِ هذا السائقِ إن كانَ قد طالبَ — أو `null`. */
  readonly myPosition: number | null;
}

/** تفاوضُ الراكبِ المفتوحُ لطلبِهِ الجاري. */
export interface RiderNegotiationSnapshot {
  readonly negotiationId: string;
  readonly orderId: string;
  readonly status: "collecting" | "negotiating";
  readonly collectSecondsLeft: number;
  readonly claimCount: number;
  /** موضعُ المطالبةِ النشطةِ — `null` ما دامَ الدورُ يَجمَعُ. */
  readonly activePosition: number | null;
}

/** بطاقةُ السائقِ المعروضِ كما يقرؤها التطبيقُ. */
export interface RiderNegotiationDriverCard {
  readonly firstName: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly completedTrips: number;
  readonly vehicleType: string | null;
  readonly vehicleYear: number | null;
  readonly memberSinceYear: number | null;
}

export interface NegotiationAppStore {
  /** الدوراتُ المفتوحةُ في مدينةِ السائقِ — بلا هويّةٍ من جسمِ الطلبِ. */
  listForDriver(
    telegramId: string,
  ): Promise<Result<readonly DriverNegotiationCard[], NegotiationAppStoreError>>;
  /** دورةُ الراكبِ المفتوحةُ لطلبِهِ — أو `null` إن لم يكن لَهُ واحدةٌ. */
  findForRider(
    telegramId: string,
  ): Promise<Result<RiderNegotiationSnapshot | null, NegotiationAppStoreError>>;
  /** بطاقةُ السائقِ المعروضِ في موضعِهِ — ملكيّةُ الراكبِ قيدٌ في الاستعلامِ. */
  readRiderDriverCard(
    negotiationId: string,
    position: number,
    riderTelegramId: string,
  ): Promise<Result<RiderNegotiationDriverCard | null, NegotiationAppStoreError>>;
  /** هل يملكُ الراكبُ هذه الدورةَ؟ — حارسُ الكتابةِ قبلَ أيِّ دالّةٍ ذرّيّةٍ. */
  riderOwns(
    riderTelegramId: string,
    negotiationId: string,
  ): Promise<Result<boolean, NegotiationAppStoreError>>;
}

function storeError(reason: NegotiationAppStoreError): NegotiationAppStoreError {
  return reason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const TELEGRAM_ID_PATTERN = /^[0-9]{1,19}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** مخزنُ مطالباتِ القروباتِ والتفاوضِ على PostgreSQL. */
export function createNegotiationAppStore(sql: Sql): NegotiationAppStore {
  return {
    listForDriver: async (telegramId) => {
      if (!TELEGRAM_ID_PATTERN.test(telegramId)) return ok([]);
      try {
        const rows = await sql<
          {
            negotiation_id: string;
            order_id: string;
            service: string;
            pickup_label: string | null;
            dropoff_label: string | null;
            collect_seconds_left: string | number | null;
            my_position: number | null;
          }[]
        >`
          select n.id::text as negotiation_id, o.id::text as order_id,
                 o.service::text as service, o.pickup_label, o.dropoff_label,
                 greatest(0, extract(epoch from (n.collect_deadline - now()))) as collect_seconds_left,
                 c.position as my_position
            from unsubscribed_negotiations n
            join orders o on o.id = n.order_id
            join drivers d on d.city_id = n.city_id
            join users u on u.id = d.user_id
            left join unsubscribed_claims c on c.negotiation_id = n.id and c.driver_id = d.id
           where u.telegram_id = ${telegramId}::bigint
             and n.status in ('collecting', 'negotiating')
             and n.collect_deadline > now()
             and d.verification_status = 'verified'
           order by n.collect_deadline
           limit 50
        `;
        return ok(
          rows.map((row) => ({
            negotiationId: row.negotiation_id,
            orderId: row.order_id,
            service: row.service,
            pickupLabel: row.pickup_label,
            dropoffLabel: row.dropoff_label,
            collectSecondsLeft: Number(row.collect_seconds_left ?? 0),
            myPosition: row.my_position,
          })),
        );
      } catch {
        return err(storeError("STORE_ERROR"));
      }
    },

    findForRider: async (telegramId) => {
      if (!TELEGRAM_ID_PATTERN.test(telegramId)) return ok(null);
      try {
        const rows = await sql<
          {
            negotiation_id: string;
            order_id: string;
            negotiation_status: string;
            collect_seconds_left: string | number | null;
            claim_count: string | number;
            active_position: number | null;
          }[]
        >`
          select n.id::text as negotiation_id, o.id::text as order_id,
                 n.status::text as negotiation_status,
                 greatest(0, extract(epoch from (n.collect_deadline - now()))) as collect_seconds_left,
                 (select count(*) from unsubscribed_claims c
                   where c.negotiation_id = n.id) as claim_count,
                 ac.position as active_position
            from unsubscribed_negotiations n
            join orders o on o.id = n.order_id
            join riders r on r.id = o.rider_id
            join users u on u.id = r.user_id
            left join unsubscribed_claims ac on ac.id = n.active_claim_id
           where u.telegram_id = ${telegramId}::bigint
             and n.status in ('collecting', 'negotiating')
           order by n.created_at desc
           limit 1
        `;
        const row = rows[0];
        if (row === undefined) return ok(null);
        if (row.negotiation_status !== "collecting" && row.negotiation_status !== "negotiating") {
          return err(storeError("MALFORMED_RESULT"));
        }
        return ok({
          negotiationId: row.negotiation_id,
          orderId: row.order_id,
          status: row.negotiation_status,
          collectSecondsLeft: Number(row.collect_seconds_left ?? 0),
          claimCount: Number(row.claim_count ?? 0),
          activePosition: row.active_position,
        });
      } catch {
        return err(storeError("STORE_ERROR"));
      }
    },

    readRiderDriverCard: async (negotiationId, position, riderTelegramId) => {
      if (!TELEGRAM_ID_PATTERN.test(riderTelegramId) || !isUuid(negotiationId)) return ok(null);
      try {
        const rows = await sql<
          {
            full_name: string | null;
            rating_average: string | number | null;
            rating_count: number | null;
            completed_trips: string | number;
            vehicle_type: string | null;
            vehicle_year: number | null;
            member_since_year: number | null;
          }[]
        >`
          select du.full_name, d.rating_average, d.rating_count,
                 (select count(*) from orders x
                   where x.assigned_driver_id = d.id and x.status = 'completed') as completed_trips,
                 d.vehicle_type, d.vehicle_year,
                 extract(year from d.created_at)::integer as member_since_year
            from unsubscribed_negotiations n
            join unsubscribed_claims c on c.id = n.active_claim_id
            join drivers d  on d.id = c.driver_id
            join users   du on du.id = d.user_id
            join orders  o  on o.id = n.order_id
            join riders  r  on r.id = o.rider_id
            join users   ru on ru.id = r.user_id
           where n.id = ${negotiationId}::uuid
             and n.status = 'negotiating'
             and c.position = ${position}::integer
             and ru.telegram_id = ${riderTelegramId}::bigint
           limit 1
        `;
        const row = rows[0];
        if (row === undefined) return ok(null);
        const first = (row.full_name ?? "").trim().split(/\s+/)[0] ?? "";
        const average = row.rating_average === null ? null : Number(row.rating_average);
        return ok({
          firstName: first === "" ? null : first,
          ratingAverage:
            average === null || !Number.isFinite(average) || (row.rating_count ?? 0) === 0
              ? null
              : average,
          ratingCount: row.rating_count ?? 0,
          completedTrips: Number(row.completed_trips),
          vehicleType: readText(row.vehicle_type),
          vehicleYear: row.vehicle_year,
          memberSinceYear: row.member_since_year,
        });
      } catch {
        return err(storeError("STORE_ERROR"));
      }
    },

    riderOwns: async (riderTelegramId, negotiationId) => {
      if (!TELEGRAM_ID_PATTERN.test(riderTelegramId) || !isUuid(negotiationId)) return ok(false);
      try {
        const rows = await sql<{ owned: boolean }[]>`
          select exists (
            select 1
              from unsubscribed_negotiations n
              join orders o on o.id = n.order_id
              join riders r on r.id = o.rider_id
              join users u on u.id = r.user_id
             where n.id = ${negotiationId}::uuid
               and u.telegram_id = ${riderTelegramId}::bigint
          ) as owned
        `;
        const row = rows[0];
        if (row === undefined || !isRecord(row) || typeof row.owned !== "boolean") {
          return err(storeError("MALFORMED_RESULT"));
        }
        return ok(row.owned);
      } catch {
        return err(storeError("STORE_ERROR"));
      }
    },
  };
}
