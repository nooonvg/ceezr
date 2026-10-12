/**
 * الغرض: `WR-09` (ADR 0266) على PostgreSQL حقيقيٍّ — آلةُ حالةِ «الراكبُ يختارُ السائق»:
 *   حجزُ المرشَّحِ وموعدُه من ساعةِ القاعدة، وردُّ السائقِ الثاني بـ`ORDER_HELD` وعرضُه باقٍ،
 *   وقبولُ الراكبِ إسنادٌ ذرّيٌّ، ورفضُه يستبعدُ السائقَ ويُبقي البحث، والمهلةُ الفائتةُ
 *   تُحرَّرُ كسولاً وبالشوط، والطرفُ الثالثُ لا يرى ولا يقرّر، والنقرةُ المتأخّرةُ لا تُصيب
 *   مرشَّحاً آخر، والإعادةُ بلا أثرٍ ثانٍ، والنافذةُ صفرٌ ⇒ السلوكُ القديمُ حرفاً.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ اختيارِ الراكبِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const MARK = "wr09-rider-choice";
const RIDER_TG = 900_009_101;
const STRANGER_TG = 900_009_102;
const DRIVER_A_TG = 900_009_201;
const DRIVER_B_TG = 900_009_202;

type Json = Record<string, unknown>;

describeIf("WR-09 — الراكبُ يختارُ السائقَ خلالَ مهلةٍ يحكمُها الخادم", () => {
  let sql: Sql;
  let cityId = "";
  let previousWindow: unknown = null;
  let riderId = "";
  let driverA = "";
  let driverB = "";
  let orderId = "";
  let offerA = "";
  let offerB = "";

  /** بقايا شوطٍ سابقٍ انقطعَ قبلَ تنظيفه — بمعرّفاتِ تيليجرام الخاصّةِ بهذا الملفّ. */
  async function purge(): Promise<void> {
    const tgs = [RIDER_TG, STRANGER_TG, DRIVER_A_TG, DRIVER_B_TG];
    const users = sql`select id from users where telegram_id in ${sql(tgs)}`;
    const orders = sql`select id from orders where rider_id in (select id from riders where user_id in (${users}))`;
    await sql`delete from notification_outbox where order_id in (${orders})`;
    await sql`delete from audit_log where entity_id in (${orders})`;
    await sql`update orders set candidate_offer_id = null, candidate_driver_id = null where id in (${orders})`;
    await sql`delete from order_offers where order_id in (${orders})`;
    await sql`delete from orders where id in (${orders})`;
    await sql`delete from notification_outbox where recipient_user_id in (${users})`;
    await sql`delete from audit_log where actor_user_id in (${users})`;
    await sql`delete from drivers where user_id in (${users})`;
    await sql`delete from riders where user_id in (${users})`;
    await sql`delete from users where telegram_id in ${sql(tgs)}`;
  }

  async function user(tg: number, role: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${tg}, ${`${MARK}-${tg}`}, 'ar', ${role}) returning id`;
    return rows[0]?.id as string;
  }

  async function claim(driverId: string): Promise<Json> {
    const rows = await sql<{ r: Json }[]>`
      select claim_ride(${orderId}::uuid, ${driverId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  async function decide(tg: number, driverId: string, accept: boolean): Promise<Json> {
    const rows = await sql<{ r: Json }[]>`
      select rider_decide_candidate(${tg}, ${orderId}::uuid, ${driverId}::uuid, ${accept}) as r`;
    return rows[0]?.r as Json;
  }

  async function read(tg: number): Promise<Json> {
    const rows = await sql<{ r: Json }[]>`
      select rider_order_candidate(${tg}, ${orderId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  async function order(): Promise<Json> {
    const rows = await sql<Json[]>`
      select status::text, assigned_driver_id::text, candidate_driver_id::text,
             candidate_offer_id::text, candidate_expires_at
        from orders where id = ${orderId}::uuid`;
    return rows[0] as Json;
  }

  async function offerStatus(id: string): Promise<string> {
    const rows = await sql<
      { status: string }[]
    >`select status::text from order_offers where id = ${id}::uuid`;
    return rows[0]?.status as string;
  }

  async function setWindow(seconds: number): Promise<void> {
    await sql`
      update platform_settings set value = to_jsonb(${seconds}::int)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
  }

  async function outbox(kind: string): Promise<Json[]> {
    return sql<Json[]>`
      select payload, dedup_key from notification_outbox
       where kind = ${kind} and order_id = ${orderId}::uuid order by created_at`;
  }

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    const city = (
      await sql<{ id: string }[]>`select id from cities order by created_at limit 1`
    )[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدة");
    cityId = city.id;
    const prev = await sql<{ value: unknown }[]>`
      select value from platform_settings
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    if (prev[0] === undefined) throw new Error("الإعدادُ rider_choice_window_seconds غيرُ مبذور");
    previousWindow = prev[0].value;
    await purge();

    const riderUser = await user(RIDER_TG, "rider");
    await user(STRANGER_TG, "rider");
    riderId = (
      await sql<{ id: string }[]>`
        insert into riders (city_id, user_id) values (${cityId}::uuid, ${riderUser}::uuid) returning id`
    )[0]?.id as string;
    const a = await user(DRIVER_A_TG, "driver");
    const b = await user(DRIVER_B_TG, "driver");
    driverA = (
      await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, plate_number, vehicle_type, rating_average, rating_count)
        values (${cityId}::uuid, ${a}::uuid, 'أ ب ج 1', 'sedan', 4.8, 12) returning id`
    )[0]?.id as string;
    driverB = (
      await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, plate_number, vehicle_type)
        values (${cityId}::uuid, ${b}::uuid, 'د هـ و 2', 'suv') returning id`
    )[0]?.id as string;
  });

  beforeEach(async () => {
    await setWindow(15);
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`update orders set candidate_offer_id = null, candidate_driver_id = null where rider_id = ${riderId}::uuid`;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    orderId = (
      await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup)
        values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
                st_setsrid(st_makepoint(39.17, 21.54), 4326))
        returning id`
    )[0]?.id as string;
    const offers = await sql<{ id: string; driver_id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}::uuid, ${orderId}::uuid, ${driverA}::uuid, 1, 'pending', now() + interval '45 seconds'),
             (${cityId}::uuid, ${orderId}::uuid, ${driverB}::uuid, 1, 'pending', now() + interval '45 seconds')
      returning id, driver_id::text`;
    offerA = offers.find((o) => o.driver_id === driverA)?.id as string;
    offerB = offers.find((o) => o.driver_id === driverB)?.id as string;
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`
      update platform_settings set value = to_jsonb(${Number(previousWindow)}::int)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    await purge();
    await sql.end();
  });

  it("قبولُ السائقِ يحجزُ المرشَّحَ بموعدٍ من القاعدة ويودعُ إشعارَ الراكب، ولا يُسنِد", async () => {
    const result = await claim(driverA);
    expect(result).toMatchObject({ ok: true, pending_rider: true, duplicate: false, rider: null });
    const state = await order();
    expect(state).toMatchObject({
      status: "searching",
      assigned_driver_id: null,
      candidate_driver_id: driverA,
      candidate_offer_id: offerA,
    });
    const left = (new Date(String(state.candidate_expires_at)).getTime() - Date.now()) / 1000;
    expect(left).toBeGreaterThan(10);
    expect(left).toBeLessThanOrEqual(16);
    expect(await offerStatus(offerA)).toBe("pending");
    const notices = await outbox("rider_trip_notice");
    expect(notices).toHaveLength(1);
    expect(notices[0]?.dedup_key).toBe(`rider_trip:${orderId}:CANDIDATE:${offerA}`);
    expect(notices[0]?.payload).toMatchObject({ event: "CANDIDATE", driver_id: driverA });
  });

  it("النقرةُ المكرَّرةُ للمرشَّحِ نفسِه بلا أثرٍ ثانٍ، والسائقُ الآخرُ يُرَدُّ ORDER_HELD وعرضُه باقٍ", async () => {
    await claim(driverA);
    expect(await claim(driverA)).toMatchObject({ ok: true, pending_rider: true, duplicate: true });
    expect(await claim(driverB)).toMatchObject({ ok: false, error: "ORDER_HELD" });
    expect(await offerStatus(offerB)).toBe("pending");
    expect(await outbox("rider_trip_notice")).toHaveLength(1);
  });

  it("الراكبُ يرى المرشَّحَ بتقييمِه وموعدِه، والطرفُ الثالثُ لا يرى شيئاً", async () => {
    await claim(driverA);
    const mine = await read(RIDER_TG);
    expect(mine).toMatchObject({ ok: true, order_status: "searching" });
    expect(mine.candidate).toMatchObject({
      driver_id: driverA,
      plate: "أ ب ج 1",
      vehicle: "sedan",
      rating_count: 12,
    });
    expect(Number((mine.candidate as Json).rating_average)).toBeCloseTo(4.8);
    expect(Number((mine.candidate as Json).seconds_left)).toBeGreaterThan(10);
    expect(await read(STRANGER_TG)).toEqual({ ok: false, error: "ORDER_NOT_FOUND" });
    expect(await decide(STRANGER_TG, driverA, true)).toEqual({
      ok: false,
      error: "ORDER_NOT_FOUND",
    });
    expect((await order()).candidate_driver_id).toBe(driverA);
  });

  it("قبولُ الراكبِ إسنادٌ ذرّيٌّ: العرضُ مقبولٌ والمنافسُ ملغىً، ويُخطَرُ السائق، والإعادةُ مكرَّرة", async () => {
    await claim(driverA);
    expect(await decide(RIDER_TG, driverA, true)).toMatchObject({
      ok: true,
      decision: "accepted",
      duplicate: false,
    });
    expect(await order()).toMatchObject({
      status: "matched",
      assigned_driver_id: driverA,
      candidate_driver_id: null,
    });
    expect(await offerStatus(offerA)).toBe("accepted");
    expect(await offerStatus(offerB)).toBe("cancelled");
    const toDriver = await outbox("driver_candidate_notice");
    expect(toDriver.map((n) => (n.payload as Json).outcome)).toEqual(["ACCEPTED"]);
    expect(await decide(RIDER_TG, driverA, true)).toMatchObject({ ok: true, duplicate: true });
    // والفائزُ يضغطُ «قبول» ثانيةً بعدَ الإسناد: نجاحٌ مكرَّرٌ لا «سبقك غيرُك».
    expect(await claim(driverA)).toMatchObject({ ok: true, duplicate: true });
    expect(await outbox("driver_candidate_notice")).toHaveLength(1);
  });

  it("رفضُ الراكبِ يستبعدُ السائقَ ويُبقي البحث، والسائقُ الآخرُ يصيرُ مرشَّحاً", async () => {
    await claim(driverA);
    expect(await decide(RIDER_TG, driverA, false)).toMatchObject({
      ok: true,
      decision: "rejected",
    });
    expect(await order()).toMatchObject({ status: "searching", candidate_driver_id: null });
    expect(await offerStatus(offerA)).toBe("rejected");
    expect(
      (await outbox("driver_candidate_notice")).map((n) => (n.payload as Json).outcome),
    ).toEqual(["DECLINED"]);
    // إعادةُ الرفضِ بلا أثر، والقبولُ المتأخّرُ للمرفوضِ لا يُصيبُه.
    expect(await decide(RIDER_TG, driverA, false)).toMatchObject({ ok: true, duplicate: true });
    expect(await decide(RIDER_TG, driverA, true)).toEqual({
      ok: false,
      error: "CANDIDATE_CHANGED",
    });
    expect(await claim(driverA)).toMatchObject({ ok: false, error: "OFFER_NOT_VALID" });
    expect(await claim(driverB)).toMatchObject({ ok: true, pending_rider: true });
    // نقرةٌ متأخّرةٌ على المرشَّحِ القديمِ بعدَ تبدّلِه لا تُسنِدُ الجديد.
    expect(await decide(RIDER_TG, driverA, true)).toEqual({
      ok: false,
      error: "CANDIDATE_CHANGED",
    });
    expect((await order()).candidate_driver_id).toBe(driverB);
  });

  it("المهلةُ الفائتةُ تُحرَّرُ كسولاً: القرارُ المتأخّرُ يُرَدُّ، والسائقُ مستبعَدٌ ومُخطَر", async () => {
    await claim(driverA);
    await sql`update orders set candidate_expires_at = now() - interval '1 second' where id = ${orderId}::uuid`;
    expect((await read(RIDER_TG)).candidate).toBeNull();
    expect(await decide(RIDER_TG, driverA, true)).toEqual({
      ok: false,
      error: "CANDIDATE_EXPIRED",
    });
    expect(await order()).toMatchObject({ status: "searching", candidate_driver_id: null });
    expect(await offerStatus(offerA)).toBe("rejected");
    expect(
      (await outbox("driver_candidate_notice")).map((n) => (n.payload as Json).outcome),
    ).toEqual(["EXPIRED"]);
  });

  it("شوطُ العاملِ يحرّرُ الفائتَ، وما أُلغيَ طلبُه أثناءَ الانتظار", async () => {
    await claim(driverA);
    await sql`update orders set candidate_expires_at = now() - interval '1 second' where id = ${orderId}::uuid`;
    const first = (await sql<{ r: Json }[]>`select expire_order_candidates(50) as r`)[0]?.r;
    expect(first).toMatchObject({ ok: true });
    expect(Number(first?.expired)).toBeGreaterThanOrEqual(1);
    expect((await order()).candidate_driver_id).toBeNull();

    await claim(driverB);
    await sql`update orders set status = 'cancelled' where id = ${orderId}::uuid`;
    const second = (await sql<{ r: Json }[]>`select expire_order_candidates(50) as r`)[0]?.r;
    expect(Number(second?.cancelled)).toBeGreaterThanOrEqual(1);
    expect(
      (await outbox("driver_candidate_notice")).map((n) => (n.payload as Json).outcome),
    ).toEqual(["EXPIRED", "CANCELLED"]);
  });

  it("السائقُ الثاني بعدَ فواتِ مهلةِ الأوّلِ يحجزُ هو، والأوّلُ يُحرَّرُ في المعاملةِ نفسِها", async () => {
    await claim(driverA);
    await sql`update orders set candidate_expires_at = now() - interval '1 second' where id = ${orderId}::uuid`;
    expect(await claim(driverB)).toMatchObject({ ok: true, pending_rider: true });
    expect((await order()).candidate_driver_id).toBe(driverB);
    expect(await offerStatus(offerA)).toBe("rejected");
  });

  it("المُطالِبُ يقرأُ محادثةَ السائقِ ولغتَه لإشعارِ المآل", async () => {
    await sql`delete from notification_outbox where status in ('pending', 'sending')`;
    await claim(driverA);
    await decide(RIDER_TG, driverA, false);
    const seen: Json[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = (await sql<{ r: Json }[]>`select claim_notification_delivery() as r`)[0]?.r as Json;
      const d = r.delivery as Json | null;
      if (d === null) break;
      seen.push(d);
      await sql`
        update notification_outbox set status = 'delivered', delivered_at = now(),
               delivered_message_id = 'm', claim_token = null, claimed_at = null
         where id = ${String(d.delivery_id)}::uuid`;
    }
    const driverNotice = seen.find((d) => d.kind === "driver_candidate_notice");
    expect(driverNotice?.payload).toMatchObject({
      outcome: "DECLINED",
      chat_id: String(DRIVER_A_TG),
      language: "ar",
    });
    // إشعارُ المرشَّحِ للراكبِ سبقَه بترتيبِ الطلب.
    expect(seen[0]?.kind).toBe("rider_trip_notice");
  });

  it("النافذةُ صفرٌ ⇒ الإسنادُ الفوريُّ القديمُ حرفاً، بلا مرشَّحٍ ولا إشعارِ مرشَّح", async () => {
    await setWindow(0);
    const result = await claim(driverA);
    expect(result).toMatchObject({ ok: true, duplicate: false });
    expect(result.pending_rider).toBeUndefined();
    expect(await order()).toMatchObject({ status: "matched", assigned_driver_id: driverA });
    expect(await outbox("rider_trip_notice")).toHaveLength(0);
  });
});
