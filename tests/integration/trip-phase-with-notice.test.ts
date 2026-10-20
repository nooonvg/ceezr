/**
 * الغرض: عقدُ `driver_mark_arrived_with_notice` و`driver_start_ride_with_notice` و
 *   `driver_complete_ride_with_notice` (LOAD-01 · الدفعةُ 21) على قاعدةٍ حقيقيّة: الطورُ نفسُه بفحوصِه
 *   بلا تغيير (والرفضُ حرفًا كدالّةِ الطورِ)، وإيداعُ الإشعارِ في معاملتِه، وفشلُ الإيداعِ معزولٌ بنقطةِ
 *   حفظ (ADR 0265 §2)، وتغيّرُ الصلاحيةِ بينَ طلبَين يُرفَضُ كما في الدالّةِ الأصل.
 * الحالة: اختبارُ تكاملٍ فعليّ — يتطلّبُ `TEST_DATABASE_URL`.
 * الحاكم: docs/adr/0265-rider-trip-notice-outbox.md
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresDriverJobStore } from "../../packages/infrastructure/driver/driver-job-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";

const DRIVER_A = 900_002_101;
const DRIVER_B = 900_002_102;
const RIDER_TG = 900_002_103;
const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

const drivers: Record<number, { userId: string; driverId: string }> = {};
let riderUserId = "";
let riderId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly rider_notice?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

type Phase = "driver_mark_arrived" | "driver_start_ride" | "driver_complete_ride";

async function call(fn: Phase, combined: boolean, tg: number, orderId: string): Promise<Payload> {
  const rows = combined
    ? fn === "driver_mark_arrived"
      ? await sql<{ result: Payload }[]>`
          select driver_mark_arrived_with_notice(${tg}::bigint, ${orderId}::uuid) as result`
      : fn === "driver_start_ride"
        ? await sql<{ result: Payload }[]>`
            select driver_start_ride_with_notice(${tg}::bigint, ${orderId}::uuid) as result`
        : await sql<{ result: Payload }[]>`
            select driver_complete_ride_with_notice(${tg}::bigint, ${orderId}::uuid) as result`
    : fn === "driver_mark_arrived"
      ? await sql<{ result: Payload }[]>`
          select driver_mark_arrived(${tg}::bigint, ${orderId}::uuid) as result`
      : fn === "driver_start_ride"
        ? await sql<{ result: Payload }[]>`
            select driver_start_ride(${tg}::bigint, ${orderId}::uuid) as result`
        : await sql<{ result: Payload }[]>`
            select driver_complete_ride(${tg}::bigint, ${orderId}::uuid) as result`;
  const row = rows[0];
  if (row === undefined) throw new Error("لا ردَّ");
  return row.result;
}

async function seedMatchedOrder(tg: number): Promise<string> {
  const d = drivers[tg];
  if (d === undefined) throw new Error("سائقٌ غيرُ مزروع");
  await sql`
    insert into driver_availability (driver_id, city_id, is_available)
    values (${d.driverId}, ${cityId}, true)
    on conflict (driver_id) do update set is_available = true`;
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label)
    values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
            st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
            'نقطةُ الانطلاق', 'نقطةُ الوصول')
    returning id`;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${d.driverId}, 1, 'pending'::offer_status, now() + interval '120 seconds')`;
  const [claim] = await sql<{ result: Payload }[]>`
    select claim_ride(${order.id}::uuid, ${d.driverId}::uuid) as result`;
  if (claim?.result.ok !== true) throw new Error(`تعذّر الإيكال: ${String(claim?.result.error)}`);
  return order.id;
}

async function noticeRows(orderId: string, event: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from notification_outbox
     where kind = 'rider_trip_notice' and dedup_key = ${`rider_trip:${orderId}:${event}`}`;
  return row?.n ?? -1;
}

async function orderRow(
  orderId: string,
): Promise<{ status: string; arrived: boolean; started: boolean }> {
  const [row] = await sql<{ status: string; arrived: boolean; started: boolean }[]>`
    select status::text as status, (arrived_at is not null) as arrived, (started_at is not null) as started
      from orders where id = ${orderId}`;
  if (row === undefined) throw new Error("الطلبُ مفقود");
  return row;
}

async function clear(): Promise<void> {
  await sql`update orders set candidate_offer_id = null where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

/** بقايا تشغيلٍ سابقٍ انقطعَ قبلَ `afterAll` — معرّفاتُ هذا الملفِّ وحدَها. */
async function purgeResidue(): Promise<void> {
  const ids = [DRIVER_A, DRIVER_B, RIDER_TG];
  const users = sql`select id from users where telegram_id in ${sql(ids)}`;
  const riders = sql`select id from riders where user_id in (${users})`;
  const driverIds = sql`select id from drivers where user_id in (${users})`;
  const orders = sql`select id from orders where rider_id in (${riders}) or assigned_driver_id in (${driverIds})`;
  await sql`update orders set candidate_offer_id = null where id in (${orders})`;
  await sql`delete from notification_outbox where order_id in (${orders}) or driver_id in (${driverIds})`;
  await sql`delete from order_offers where order_id in (${orders}) or driver_id in (${driverIds})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
  await sql`delete from orders where id in (${orders})`;
  await sql`delete from driver_availability where driver_id in (${driverIds})`;
  await sql`delete from drivers where user_id in (${users})`;
  await sql`delete from riders where user_id in (${users})`;
  await sql`delete from audit_log where actor_user_id in (${users})`;
  await sql`delete from users where telegram_id in ${sql(ids)}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL, max: 4 });
  await purgeResidue();
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  for (const tg of [DRIVER_A, DRIVER_B]) {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${tg}, 'driver', ${`سائقُ ${tg}`}, ${`+966500${tg % 1_000_000}`}) returning id`;
    if (user === undefined) throw new Error("مستخدم");
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ط و ر ${tg % 10_000}`})
      returning id`;
    if (driver === undefined) throw new Error("سائق");
    drivers[tg] = { userId: user.id, driverId: driver.id };
  }
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكبةُ الأطوار', '+966500002103', 'ar') returning id`;
  if (riderUser === undefined) throw new Error("راكبة");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id`;
  if (rider === undefined) throw new Error("راكبة");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`drop trigger if exists phase_notice_failure_probe on notification_outbox`;
  await sql`drop function if exists phase_notice_failure_probe()`;
  await purgeResidue();
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("أطوارُ الرحلةِ مع إيداعِ الإشعارِ في رحلةٍ واحدة (الدفعة 21)", () => {
  it("١) الوصولُ: الختمُ يُكتَب، وصفُّ ARRIVED واحدٌ، والردُّ = ردُّ الدالّةِ الأصلِ + rider_notice", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_A);
    const payload = await call("driver_mark_arrived", true, DRIVER_A, orderId);
    expect(payload.ok).toBe(true);
    expect(payload.order_id).toBe(orderId);
    expect(typeof payload.arrived_at).toBe("string");
    expect(payload.rider_notice?.ok).toBe(true);
    expect(payload.rider_notice?.created).toBe(true);
    expect(payload.rider_notice?.rider_telegram_id).toBe(String(RIDER_TG));
    expect(await noticeRows(orderId, "ARRIVED")).toBe(1);
    expect((await orderRow(orderId)).arrived).toBe(true);
    // الردُّ الأصلُ بالمفاتيحِ نفسِها لطلبٍ مماثل (الطورُ لم يتغيّر).
    await clear();
    const other = await seedMatchedOrder(DRIVER_A);
    const plain = await call("driver_mark_arrived", false, DRIVER_A, other);
    const { rider_notice: _ignored, ...rest } = payload;
    expect(Object.keys(rest).sort()).toEqual(Object.keys(plain).sort());
  });

  it("٢) مَهمّةُ غيرِه: الرفضُ حرفًا كالدالّةِ الأصل، بلا rider_notice ولا صفّ", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_B);
    for (const fn of [
      "driver_mark_arrived",
      "driver_start_ride",
      "driver_complete_ride",
    ] as const) {
      const combined = await call(fn, true, DRIVER_A, orderId);
      const plain = await call(fn, false, DRIVER_A, orderId);
      expect(combined).toEqual(plain);
      expect(combined.ok).toBe(false);
      expect(combined.rider_notice).toBeUndefined();
    }
    for (const event of ["ARRIVED", "STARTED", "COMPLETED"]) {
      expect(await noticeRows(orderId, event)).toBe(0);
    }
  });

  it("٣) فشلُ الإيداعِ معزول: الطورُ يُثبَّت، والصفُّ لا يُكتَب، والسببُ رمزُ حالة (ADR 0265 §2)", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_A);
    await sql.unsafe(`
      create or replace function phase_notice_failure_probe() returns trigger language plpgsql as $$
      begin
        if new.kind = 'rider_trip_notice' and new.order_id = '${orderId}'::uuid then
          raise exception 'probe: deposit refused';
        end if;
        return new;
      end $$`);
    await sql.unsafe(`
      create trigger phase_notice_failure_probe before insert on notification_outbox
      for each row execute function phase_notice_failure_probe()`);
    try {
      const payload = await call("driver_mark_arrived", true, DRIVER_A, orderId);
      expect(payload.ok).toBe(true);
      expect(payload.rider_notice).toEqual({
        ok: false,
        error: "ENQUEUE_EXCEPTION",
        sqlstate: "P0001",
      });
      expect((await orderRow(orderId)).arrived).toBe(true);
      expect(await noticeRows(orderId, "ARRIVED")).toBe(0);
    } finally {
      await sql`drop trigger if exists phase_notice_failure_probe on notification_outbox`;
      await sql`drop function if exists phase_notice_failure_probe()`;
    }
  });

  it("٤) الدورةُ كاملة: وصولٌ ثمّ بدءٌ ثمّ إنهاء — صفٌّ لكلِّ طور، والطلبُ مكتمل، والسائقُ متاحٌ", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_A);
    expect((await call("driver_mark_arrived", true, DRIVER_A, orderId)).ok).toBe(true);
    expect((await call("driver_start_ride", true, DRIVER_A, orderId)).ok).toBe(true);
    const done = await call("driver_complete_ride", true, DRIVER_A, orderId);
    expect(done.ok).toBe(true);
    expect(done.rider_notice?.ok).toBe(true);
    for (const event of ["ARRIVED", "STARTED", "COMPLETED"]) {
      expect(await noticeRows(orderId, event)).toBe(1);
    }
    expect((await orderRow(orderId)).status).toBe("completed");
    const d = drivers[DRIVER_A];
    const [avail] = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${d?.driverId ?? ""}`;
    expect(avail?.is_available).toBe(true);
  });

  it("٥) ضغطةٌ مكرّرة: الختمُ الثاني يُرفَضُ كالأصلِ ولا صفَّ ثانٍ", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_A);
    expect((await call("driver_mark_arrived", true, DRIVER_A, orderId)).ok).toBe(true);
    const again = await call("driver_mark_arrived", true, DRIVER_A, orderId);
    expect(again.ok).toBe(false);
    expect(again.error).toBe("ALREADY_ARRIVED");
    expect(again.rider_notice).toBeUndefined();
    expect(await noticeRows(orderId, "ARRIVED")).toBe(1);
  });

  it("٦) تغيّرُ الصلاحيةِ بينَ طلبَين: الطلبُ أُسنِدَ إلى سائقٍ آخرَ بعدَ الوصول ⇒ البدءُ يُرفَضُ كالأصلِ بلا إيداع", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_A);
    expect((await call("driver_mark_arrived", true, DRIVER_A, orderId)).ok).toBe(true);
    const b = drivers[DRIVER_B];
    await sql`update orders set assigned_driver_id = ${b?.driverId ?? ""} where id = ${orderId}`;
    const combined = await call("driver_start_ride", true, DRIVER_A, orderId);
    const plain = await call("driver_start_ride", false, DRIVER_A, orderId);
    expect(combined).toEqual(plain);
    expect(combined.ok).toBe(false);
    expect(combined.error).toBe("JOB_NOT_FOUND");
    expect(combined.rider_notice).toBeUndefined();
    expect(await noticeRows(orderId, "STARTED")).toBe(0);
    expect((await orderRow(orderId)).started).toBe(false);
  });

  it("٦ب) الدورُ في `users` يتغيّرُ بينَ طلبَين ⇒ الحكمُ نفسُه في المدمجِ والأصلِ على الحالِ نفسِها", async () => {
    await clear();
    const orderId = await seedMatchedOrder(DRIVER_A);
    await sql`update users set role = 'rider' where telegram_id = ${DRIVER_A}`;
    try {
      // الأصلُ داخلَ معاملةٍ تُتراجَع ⇒ الحالُ نفسُها للمدمجِ بعدَه.
      let plain: Payload | undefined;
      await sql
        .begin(async (tx) => {
          const [row] = await tx<{ result: Payload }[]>`
            select driver_mark_arrived(${DRIVER_A}::bigint, ${orderId}::uuid) as result`;
          plain = row?.result;
          throw new Error("rollback");
        })
        .catch((e: unknown) => {
          if (!(e instanceof Error && e.message === "rollback")) throw e;
        });
      const combined = await call("driver_mark_arrived", true, DRIVER_A, orderId);
      const { rider_notice: _n, arrived_at: _c, ...combinedRest } = combined;
      const { arrived_at: _p, ...plainRest } = plain ?? {};
      expect(combinedRest).toEqual(plainRest);
      expect(await noticeRows(orderId, "ARRIVED")).toBe(combined.ok === true ? 1 : 0);
    } finally {
      await sql`update users set role = 'driver' where telegram_id = ${DRIVER_A}`;
    }
  });

  it("٧) المنفذ: *WithNotice يقرأُ الطورَ بقارئِ الطريقةِ الأصلِ ويُعيدُ مآلَ الإيداع، والرفضُ متطابق", async () => {
    await clear();
    const store = new PostgresDriverJobStore(sql);
    const orderId = await seedMatchedOrder(DRIVER_A);
    const arrived = await store.markArrivedWithNotice({
      telegramUserId: String(DRIVER_A),
      orderId,
    });
    expect(arrived.ok).toBe(true);
    if (!arrived.ok) return;
    expect(arrived.value.value.orderId).toBe(orderId);
    expect(typeof arrived.value.value.arrivedAt).toBe("string");
    expect(arrived.value.notice).toEqual({
      kind: "deposited",
      created: true,
      riderTelegramId: String(RIDER_TG),
    });
    const theirs = await seedMatchedOrder(DRIVER_B);
    const refused = await store.startRideWithNotice({
      telegramUserId: String(DRIVER_A),
      orderId: theirs,
    });
    const reference = await store.startRide({ telegramUserId: String(DRIVER_A), orderId: theirs });
    expect(refused.ok).toBe(false);
    expect(reference.ok).toBe(false);
    if (refused.ok || reference.ok) return;
    expect(refused.error).toEqual(reference.error);
  });
});
