/**
 * الغرض: كنسُّ صفوفِ العروضِ المحسومةِ من طابورِ الإشعاراتِ على قاعدةٍ حقيقيّةٍ —
 * `LOAD-01 Recovery` (المرحلة 6-استكمال).
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 *
 * ولِمَ على قاعدةٍ حقيقيّةٍ: الحاجزُ يقيسُ أثرَ الدالّةِ على الصفوفِ نفسِها (موتٌ
 * بسمٍّ مسمّى وعدمُ مساسٍ بالحيِّ) — وهذا عقدٌ مع القاعدةِ لا منطقُ جافٍّ تراهُ
 * الوحدةُ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  كنسُّ العروضِ المحسومةِ مُتخطّى: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_491;
const RIDER_TELEGRAM_ID = 900_000_492;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let riderUserId = "";
let riderId = "";
let decidedOrderId = "";
let liveOrderId = "";
let decidedOfferId = "";
let liveOfferId = "";
let decidedOutboxId = "";
let liveOutboxId = "";

async function seedOrderWithOffer(offerStatus: "accepted" | "pending"): Promise<{
  orderId: string;
  offerId: string;
}> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
    values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 0)
    returning id
  `;
  if (order === undefined) throw new Error("تعذّر إنشاءُ الطلبِ");
  const [offer] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${driverId}, 1, ${offerStatus}::offer_status,
            now() + make_interval(secs => 120))
    returning id
  `;
  if (offer === undefined) throw new Error("تعذّر إنشاءُ العرضِ");
  return { orderId: order.id, offerId: offer.id };
}

async function seedOutboxOfferRow(orderId: string, offerId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into notification_outbox (city_id, kind, order_id, offer_id, driver_id, recipient_user_id, payload, dedup_key, next_attempt_at)
    values (${cityId}::uuid, 'offer', ${orderId}::uuid, ${offerId}::uuid, ${driverId}::uuid, ${driverUserId}::uuid,
            jsonb_build_object('offer_id', ${offerId}::uuid, 'order_id', ${orderId}::uuid),
            'sweep-test:' || ${offerId}::text, now())
    returning id
  `;
  if (row === undefined) throw new Error("تعذّر إنشاءُ صفِّ الصادرِ");
  return row.id;
}

describeIf("LOAD-01 — كنسُّ العروضِ المحسومةِ من طابورِ الإشعاراتِ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    // نظافةُ بقايا جولةٍ سابقةٍ لنفسِ المعرفاتِ (اختبارٌ محليٌّ معاد).
    await sql`delete from notification_outbox where dedup_key like 'sweep-test:%' or recipient_user_id in (
      select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from order_offers where order_id in (
      select o.id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id
      where u.telegram_id = ${RIDER_TELEGRAM_ID}::bigint)`;
    await sql`delete from orders where rider_id in (
      select id from riders where user_id in (
        select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)))`;
    await sql`delete from riders where user_id in (
      select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from drivers where user_id in (
      select id from users where telegram_id = ${DRIVER_TELEGRAM_ID}::bigint)`;
    await sql`delete from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)`;
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;

    const [driverUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ الكنسِ', '+966500000491')
      returning id
    `;
    if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    driverUserId = driverUser.id;
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ح ص ل 491')
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    driverId = driver.id;
    const [riderUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبُ الكنسِ', '+966500000492')
      returning id
    `;
    if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبِ");
    riderUserId = riderUser.id;
    const [rider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ في جدولِ الراكبينِ");
    riderId = rider.id;

    const decided = await seedOrderWithOffer("accepted");
    decidedOrderId = decided.orderId;
    decidedOfferId = decided.offerId;
    decidedOutboxId = await seedOutboxOfferRow(decidedOrderId, decidedOfferId);

    const live = await seedOrderWithOffer("pending");
    liveOrderId = live.orderId;
    liveOfferId = live.offerId;
    liveOutboxId = await seedOutboxOfferRow(liveOrderId, liveOfferId);
  });

  afterAll(async () => {
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  it("الكنسُ يُميتُ صفَّ العرضِ المحسومِ (المقبولِ) بسمِّ المعالجِ نفسِهِ", async () => {
    const result = await sql`select public.sweep_decided_offer_notifications() result`;
    const envelope = (result[0] as { result: { ok: boolean; swept: number } }).result;
    expect(envelope.ok).toBe(true);
    expect(envelope.swept).toBeGreaterThanOrEqual(1);
    const rows = await sql<{ status: string; reason: string | null }[]>`
      select status, dead_reason as reason from notification_outbox where id = ${decidedOutboxId}::uuid
    `;
    expect(rows[0]?.status).toBe("dead");
    expect(rows[0]?.reason).toBe("ABANDONED");
  });

  it("الكنسُ لا يمسُّ العرضَ الحيَّ القابلَ للقبولِ — الطابورُ للحيِّ", async () => {
    const rows = await sql<{ status: string }[]>`
      select status from notification_outbox where id = ${liveOutboxId}::uuid
    `;
    expect(rows[0]?.status).toBe("pending");
  });

  it("الكنسُ لا يلمسُ صفًّا في يدِ المعالجِ (`sending`) ولو كانَ عرضُهُ محسومًا", async () => {
    await sql`update notification_outbox set status='sending', claim_token=gen_random_uuid(), claimed_at=now() where id = ${decidedOutboxId}::uuid`;
    await sql`select public.sweep_decided_offer_notifications() result`;
    const rows = await sql<{ status: string }[]>`
      select status from notification_outbox where id = ${decidedOutboxId}::uuid
    `;
    expect(rows[0]?.status).toBe("sending");
  });
});
