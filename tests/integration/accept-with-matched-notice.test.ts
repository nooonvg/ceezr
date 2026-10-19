/**
 * الغرض: عقدُ `driver_accept_offer_with_matched_notice` (LOAD-01 · الدفعةُ الخامسةَ عشرةَ) على قاعدةٍ حقيقيّة:
 *   القبولُ نفسُه بلا تغيير، وإيداعُ MATCHED في معاملتِه، وفشلُ الإيداعِ معزولٌ بنقطةِ حفظٍ فلا يرفضُ القبول
 *   (ADR 0265 §2)، والسباقاتُ (I1) كما هيَ.
 * الحالة: اختبارُ تكاملٍ فعليّ — يتطلّبُ `TEST_DATABASE_URL`.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md ·
 *   docs/adr/0265-rider-trip-notice-outbox.md
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresDriverOfferStore } from "../../packages/infrastructure/driver/driver-offers-store.ts";
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

const DRIVER_A = 900_001_521;
const DRIVER_B = 900_001_522;
const RIDER_TG = 900_001_523;
const PICKUP = { lat: 21.4858, lng: 39.1925 };

const drivers: Record<number, { userId: string; driverId: string }> = {};
let riderUserId = "";
let riderId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly rider_notice?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

async function combined(telegramId: number, offerId: string): Promise<Payload> {
  const [row] = await sql<{ result: Payload }[]>`
    select driver_accept_offer_with_matched_notice(${telegramId}::bigint, ${offerId}::uuid) as result`;
  if (row === undefined) throw new Error("لا ردَّ");
  return row.result;
}

async function plain(telegramId: number, offerId: string): Promise<Payload> {
  const [row] = await sql<{ result: Payload }[]>`
    select driver_accept_offer(${telegramId}::bigint, ${offerId}::uuid) as result`;
  if (row === undefined) throw new Error("لا ردَّ");
  return row.result;
}

async function seedOrder(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
    values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography, 'نقطةُ الاختبار')
    returning id`;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلب");
  return row.id;
}

async function seedOffer(orderId: string, telegramId: number): Promise<string> {
  const d = drivers[telegramId];
  if (d === undefined) throw new Error("سائقٌ غيرُ مزروع");
  const [row] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, distance_km, status, expires_at)
    values (${cityId}, ${orderId}, ${d.driverId}, 1, 2.5, 'pending'::offer_status, now() + interval '45 seconds')
    returning id`;
  if (row === undefined) throw new Error("تعذّر زرعُ العرض");
  return row.id;
}

async function matchedRows(orderId: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from notification_outbox
     where kind = 'rider_trip_notice' and dedup_key = ${`rider_trip:${orderId}:MATCHED`}`;
  return row?.n ?? -1;
}

async function orderState(orderId: string): Promise<{ status: string; assigned: string | null }> {
  const [row] = await sql<{ status: string; assigned: string | null }[]>`
    select status::text as status, assigned_driver_id::text as assigned from orders where id = ${orderId}`;
  if (row === undefined) throw new Error("الطلبُ مفقود");
  return row;
}

async function clear(): Promise<void> {
  // `WR-09`: الحجزُ يُشيرُ من الطلبِ إلى العرضِ (`candidate_offer_id`) — يُفَكُّ قبلَ حذفِ العروض.
  await sql`update orders set candidate_offer_id = null where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

/** بقايا تشغيلٍ سابقٍ انقطعَ قبلَ `afterAll` — معرّفاتُ هذا الملفِّ وحدَها، فلا يمسُّ زرعَ غيرِه. */
async function purgeResidue(): Promise<void> {
  const ids = [DRIVER_A, DRIVER_B, RIDER_TG];
  const users = sql`select id from users where telegram_id in ${sql(ids)}`;
  const riders = sql`select id from riders where user_id in (${users})`;
  const driverIds = sql`select id from drivers where user_id in (${users})`;
  const orders = sql`select id from orders where rider_id in (${riders}) or assigned_driver_id in (${driverIds})`;
  await sql`update orders set candidate_offer_id = null where id in (${orders})`;
  await sql`delete from notification_outbox where order_id in (${orders}) or driver_id in (${driverIds})`;
  await sql`delete from order_offers where order_id in (${orders}) or driver_id in (${driverIds})`;
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
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ق ب ل ${tg % 10_000}`})
      returning id`;
    if (driver === undefined) throw new Error("سائق");
    drivers[tg] = { userId: user.id, driverId: driver.id };
  }
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكبةُ القبول', '+966500001523', 'ar') returning id`;
  if (riderUser === undefined) throw new Error("راكبة");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id`;
  if (rider === undefined) throw new Error("راكبة");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`drop trigger if exists accept_notice_failure_probe on notification_outbox`;
  await sql`drop function if exists accept_notice_failure_probe()`;
  await sql`
    update platform_settings set value = '0'::jsonb
     where city_id = ${cityId} and key = 'rider_choice_window_seconds'`;
  if (riderId !== "") {
    await clear();
    await sql`delete from riders where id = ${riderId}`;
  }
  for (const d of Object.values(drivers)) {
    await sql`delete from notification_outbox where driver_id = ${d.driverId}`;
    await sql`delete from order_offers where driver_id = ${d.driverId}`;
    await sql`delete from driver_availability where driver_id = ${d.driverId}`;
    await sql`delete from drivers where id = ${d.driverId}`;
  }
  for (const id of [...Object.values(drivers).map((d) => d.userId), riderUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("القبولُ مع إيداعِ MATCHED في رحلةٍ واحدة", () => {
  it("١) قبولٌ ناجح: الطلبُ يُوكَل، وصفُّ MATCHED واحدٌ في المعاملةِ نفسِها، وردُّ القبولِ كما هوَ + rider_notice", async () => {
    await clear();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, DRIVER_A);
    const payload = await combined(DRIVER_A, offerId);
    expect(payload.ok).toBe(true);
    expect(payload.order_id).toBe(orderId);
    expect(payload.pending_rider).toBe(false);
    expect(Object.keys(payload).sort()).toEqual([
      "expires_at",
      "matched_at",
      "ok",
      "order_id",
      "pending_rider",
      "rider_notice",
    ]);
    expect(payload.rider_notice?.ok).toBe(true);
    expect(payload.rider_notice?.created).toBe(true);
    expect(payload.rider_notice?.rider_telegram_id).toBe(String(RIDER_TG));
    expect(await orderState(orderId)).toEqual({
      status: "matched",
      assigned: drivers[DRIVER_A]?.driverId ?? null,
    });
    expect(await matchedRows(orderId)).toBe(1);
  });

  it("٢) الرفضُ يُعادُ كما يُعيدُه driver_accept_offer حرفاً، بلا rider_notice ولا صفٍّ", async () => {
    await clear();
    const orderId = await seedOrder();
    const theirs = await seedOffer(orderId, DRIVER_B);
    expect(await combined(DRIVER_A, theirs)).toEqual(await plain(DRIVER_A, theirs));
    expect(await combined(DRIVER_A, theirs)).toEqual({ ok: false, error: "OFFER_NOT_FOUND" });
    expect(await orderState(orderId)).toEqual({ status: "searching", assigned: null });
    expect(await matchedRows(orderId)).toBe(0);
  });

  it("٣) فشلُ الإيداعِ معزول: القبولُ يُثبَّت، والصفُّ لا يُكتَب، والسببُ رمزُ حالةٍ (ADR 0265 §2)", async () => {
    await clear();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, DRIVER_A);
    await sql.unsafe(`
      create or replace function accept_notice_failure_probe() returns trigger language plpgsql as $$
      begin
        if new.kind = 'rider_trip_notice' and new.order_id = '${orderId}'::uuid then
          raise exception 'probe: deposit refused';
        end if;
        return new;
      end $$`);
    await sql.unsafe(`
      create trigger accept_notice_failure_probe before insert on notification_outbox
      for each row execute function accept_notice_failure_probe()`);
    try {
      const payload = await combined(DRIVER_A, offerId);
      expect(payload.ok).toBe(true);
      expect(payload.rider_notice).toEqual({
        ok: false,
        error: "ENQUEUE_EXCEPTION",
        sqlstate: "P0001",
      });
      expect((await orderState(orderId)).status).toBe("matched");
      expect(await matchedRows(orderId)).toBe(0);
    } finally {
      await sql`drop trigger if exists accept_notice_failure_probe on notification_outbox`;
      await sql`drop function if exists accept_notice_failure_probe()`;
    }
  });

  it("٤) صفُّ MATCHED قائمٌ سلفاً ⇒ created=false ولا صفَّ ثانٍ (مفتاحُ منعِ التكرار)", async () => {
    await clear();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, DRIVER_A);
    await sql`select enqueue_rider_trip_notice(${orderId}::uuid, 'MATCHED')`;
    const payload = await combined(DRIVER_A, offerId);
    expect(payload.ok).toBe(true);
    expect(payload.rider_notice?.created).toBe(false);
    expect(await matchedRows(orderId)).toBe(1);
  });

  it("٥) حجزٌ بانتظارِ الراكب (WR-09): لا إيداعَ لـMATCHED ولا rider_notice", async () => {
    await clear();
    await sql`
      update platform_settings set value = '30'::jsonb
       where city_id = ${cityId} and key = 'rider_choice_window_seconds'`;
    try {
      const orderId = await seedOrder();
      const offerId = await seedOffer(orderId, DRIVER_A);
      const payload = await combined(DRIVER_A, offerId);
      expect(payload.ok).toBe(true);
      expect(payload.pending_rider).toBe(true);
      expect(payload.rider_notice).toBeUndefined();
      expect(await matchedRows(orderId)).toBe(0);
    } finally {
      await sql`
        update platform_settings set value = '0'::jsonb
         where city_id = ${cityId} and key = 'rider_choice_window_seconds'`;
    }
  });

  it("٦) سباقُ سائقَين على طلبٍ واحد: فائزٌ واحد، وصفُّ MATCHED واحد", async () => {
    await clear();
    const orderId = await seedOrder();
    const a = await seedOffer(orderId, DRIVER_A);
    const b = await seedOffer(orderId, DRIVER_B);
    const results = await Promise.all([combined(DRIVER_A, a), combined(DRIVER_B, b)]);
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.filter((r) => r.ok !== true).map((r) => r.error)).toEqual([
      "ORDER_NOT_CLAIMABLE",
    ]);
    expect(await matchedRows(orderId)).toBe(1);
  });

  it("٧) I1 — سائقٌ واحدٌ يقبلُ طلبَين متزامنَين: طلبٌ نشطٌ واحدٌ وإشعارٌ واحد", async () => {
    await clear();
    const o1 = await seedOrder();
    const o2 = await seedOrder();
    const f1 = await seedOffer(o1, DRIVER_A);
    const f2 = await seedOffer(o2, DRIVER_A);
    const results = await Promise.all([combined(DRIVER_A, f1), combined(DRIVER_A, f2)]);
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.find((r) => r.ok !== true)?.error).toBe("DRIVER_HAS_ACTIVE_ORDER");
    const [active] = await sql<{ n: number }[]>`
      select count(*)::int as n from orders
       where assigned_driver_id = ${drivers[DRIVER_A]?.driverId ?? ""} and status = 'matched'`;
    expect(active?.n).toBe(1);
    expect((await matchedRows(o1)) + (await matchedRows(o2))).toBe(1);
  });

  it("٨) المنفذ: acceptWithMatchedNotice يقرأُ الردَّ بقارئِ accept حرفاً ويُعيدُ مآلَ الإيداع", async () => {
    await clear();
    const store = new PostgresDriverOfferStore(sql);
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, DRIVER_A);
    const result = await store.acceptWithMatchedNotice({
      telegramUserId: String(DRIVER_A),
      offerId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claim.orderId).toBe(orderId);
    expect(result.value.claim.pendingRider).toBe(false);
    expect(result.value.matchedNotice).toEqual({
      kind: "deposited",
      created: true,
      riderTelegramId: String(RIDER_TG),
    });
    const other = await seedOrder();
    const theirs = await seedOffer(other, DRIVER_B);
    const refused = await store.acceptWithMatchedNotice({
      telegramUserId: String(DRIVER_A),
      offerId: theirs,
    });
    const reference = await store.accept({ telegramUserId: String(DRIVER_A), offerId: theirs });
    expect(refused.ok).toBe(false);
    expect(reference.ok).toBe(false);
    if (refused.ok || reference.ok) return;
    expect(refused.error).toEqual(reference.error);
  });
});
