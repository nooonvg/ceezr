/**
 * الغرض: `WR-22` على PostgreSQL حقيقيٍّ — الإلغاءُ والحالاتُ النهائية:
 *   إلغاءُ الراكبِ أثناءَ انتظارِ قرارِه في مرشَّحٍ يحرّرُ المرشَّحَ في المعاملةِ نفسِها ويُخطِرُه
 *   مرّةً واحدة، والإلغاءُ المكرَّرُ وبعدَ البدءِ مرفوضانِ بلا أثر، والمحادثةُ تُغلَقُ للكتابة،
 *   وقرارُ الراكبِ بعدَ الإلغاءِ لا يُسنِد، والإكمالُ المكرَّرُ لا يكتبُ أثرًا ثانيًا.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ الإلغاءِ والحالاتِ النهائيّةِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const MARK = "wr22-cancel";
const RIDER_TG = 900_022_101;
const DRIVER_A_TG = 900_022_201;
const DRIVER_B_TG = 900_022_202;

type Json = Record<string, unknown>;

describeIf("WR-22 — الإلغاءُ والحالاتُ النهائيّة", () => {
  let sql: Sql;
  let cityId = "";
  let previousWindow: unknown = null;
  let riderId = "";
  let driverA = "";
  let driverB = "";
  let orderId = "";

  async function purge(): Promise<void> {
    const tgs = [RIDER_TG, DRIVER_A_TG, DRIVER_B_TG];
    const users = sql`select id from users where telegram_id in ${sql(tgs)}`;
    const orders = sql`select id from orders where rider_id in (select id from riders where user_id in (${users}))`;
    await sql`delete from notification_outbox where order_id in (${orders})`;
    await sql`delete from audit_log where entity_id in (${orders})`;
    await sql`update orders set candidate_offer_id = null, candidate_driver_id = null where id in (${orders})`;
    await sql`delete from order_offers where order_id in (${orders})`;
    await sql`delete from orders where id in (${orders})`;
    await sql`delete from notification_outbox where recipient_user_id in (${users})`;
    await sql`delete from audit_log where actor_user_id in (${users})`;
    await sql`delete from driver_availability where driver_id in (select id from drivers where user_id in (${users}))`;
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

  async function cancel(): Promise<Json> {
    const rows = await sql<{ r: Json }[]>`
      select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  async function claim(driverId: string): Promise<Json> {
    const rows = await sql<{ r: Json }[]>`
      select claim_ride(${orderId}::uuid, ${driverId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  async function order(): Promise<Json> {
    const rows = await sql<Json[]>`
      select status::text, assigned_driver_id::text, candidate_driver_id::text,
             candidate_offer_id::text
        from orders where id = ${orderId}::uuid`;
    return rows[0] as Json;
  }

  /** كلُّ ما أُودِعَ للطلبِ في صندوقِ الصادر: النوعُ والسائقُ والمآل. */
  async function outbox(): Promise<{ kind: string; driver: string; outcome: string | null }[]> {
    const rows = await sql<{ kind: string; payload: Json }[]>`
      select kind, payload from notification_outbox
       where order_id = ${orderId}::uuid and kind in ('order_cancelled', 'driver_candidate_notice')
       order by kind, payload->>'driver_id'`;
    return rows.map((r) => ({
      kind: r.kind,
      driver: String(r.payload.driver_id),
      outcome: (r.payload.outcome as string | undefined) ?? null,
    }));
  }

  async function audits(action: string): Promise<number> {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_id = ${orderId}::uuid and action = ${action}`;
    return rows[0]?.n ?? 0;
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
    riderId = (
      await sql<{ id: string }[]>`
        insert into riders (city_id, user_id) values (${cityId}::uuid, ${riderUser}::uuid) returning id`
    )[0]?.id as string;
    const a = await user(DRIVER_A_TG, "driver");
    const b = await user(DRIVER_B_TG, "driver");
    driverA = (
      await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, plate_number, vehicle_type)
        values (${cityId}::uuid, ${a}::uuid, 'أ ب ج 22', 'sedan') returning id`
    )[0]?.id as string;
    driverB = (
      await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, plate_number, vehicle_type)
        values (${cityId}::uuid, ${b}::uuid, 'د هـ و 22', 'suv') returning id`
    )[0]?.id as string;
  });

  beforeEach(async () => {
    await sql`
      update platform_settings set value = to_jsonb(15)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    const mine = sql`select id from orders where rider_id = ${riderId}::uuid`;
    await sql`delete from notification_outbox where order_id in (${mine})`;
    await sql`delete from audit_log where entity_id in (${mine})`;
    await sql`update orders set candidate_offer_id = null, candidate_driver_id = null where rider_id = ${riderId}::uuid`;
    await sql`delete from order_offers where order_id in (${mine})`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    orderId = (
      await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup)
        values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
                st_setsrid(st_makepoint(39.61, 24.47), 4326))
        returning id`
    )[0]?.id as string;
    await sql`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}::uuid, ${orderId}::uuid, ${driverA}::uuid, 1, 'pending', now() + interval '45 seconds'),
             (${cityId}::uuid, ${orderId}::uuid, ${driverB}::uuid, 1, 'pending', now() + interval '45 seconds')`;
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`
      update platform_settings set value = to_jsonb(${Number(previousWindow)}::int)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    await purge();
    await sql.end();
  });

  it("الإلغاءُ أثناءَ انتظارِ قرارِ الراكب يحرّرُ المرشَّحَ فورًا ويُخطِرُه مرّةً واحدةً بنصِّه", async () => {
    expect(await claim(driverA)).toMatchObject({ ok: true, pending_rider: true });
    const result = await cancel();
    expect(result).toMatchObject({
      ok: true,
      previous_status: "searching",
      candidate_released: true,
    });
    expect(Number(result.notifications_queued)).toBe(2);
    expect(await order()).toMatchObject({
      status: "cancelled",
      candidate_driver_id: null,
      candidate_offer_id: null,
    });
    const expected = [
      { kind: "driver_candidate_notice", driver: driverA, outcome: "CANCELLED" },
      { kind: "order_cancelled", driver: driverB, outcome: null },
    ];
    expect(await outbox()).toEqual(expected);
    expect(await audits("order.candidate_released")).toBe(1);

    // الشوطُ بعدَها لا يجدُ ما يحرّرُه فلا يُخطِرُ ثانية.
    await sql`select expire_order_candidates(50)`;
    expect(await outbox()).toEqual(expected);
    expect(await audits("order.candidate_released")).toBe(1);
  });

  it("الإلغاءُ بلا مرشَّحٍ كما كان: إخطارُ كلِّ صاحبِ عرضٍ معلَّق، ولا إشعارَ مرشَّح", async () => {
    const result = await cancel();
    expect(result).toMatchObject({ ok: true, candidate_released: false });
    expect(await outbox()).toEqual(
      [driverA, driverB]
        .sort()
        .map((driver) => ({ kind: "order_cancelled", driver, outcome: null })),
    );
  });

  it("الإلغاءُ المكرَّرُ مرفوضٌ بلا أثرٍ ثانٍ", async () => {
    await cancel();
    const before = await outbox();
    expect(await cancel()).toEqual({ ok: false, error: "ORDER_NOT_CANCELLABLE" });
    expect(await outbox()).toEqual(before);
    expect(await audits("order.cancelled")).toBe(1);
  });

  it("بعدَ بدءِ الرحلةِ لا إلغاءَ من الراكب، والحالةُ لا تتغيّر", async () => {
    await sql`
      update orders set status = 'in_progress', assigned_driver_id = ${driverA}::uuid,
                        matched_at = now(), started_at = now()
       where id = ${orderId}::uuid`;
    expect(await cancel()).toEqual({ ok: false, error: "ORDER_NOT_CANCELLABLE" });
    expect((await order()).status).toBe("in_progress");
    expect(await outbox()).toEqual([]);
  });

  it("قرارُ الراكبِ بعدَ الإلغاءِ لا يُسنِد", async () => {
    await claim(driverA);
    await cancel();
    const rows = await sql<{ r: Json }[]>`
      select rider_decide_candidate(${RIDER_TG}, ${orderId}::uuid, ${driverA}::uuid, true) as r`;
    expect(rows[0]?.r).toMatchObject({ ok: false });
    expect(await order()).toMatchObject({ status: "cancelled", assigned_driver_id: null });
  });

  it("إلغاءُ المطابَقِ يُخطِرُ السائقَ المُسنَدَ ويُغلقُ المحادثةَ للكتابة", async () => {
    await sql`
      update orders set status = 'matched', assigned_driver_id = ${driverA}::uuid, matched_at = now()
       where id = ${orderId}::uuid`;
    await sql`update order_offers set status = 'accepted' where order_id = ${orderId}::uuid and driver_id = ${driverA}::uuid`;
    const open = await sql<{ writable: boolean }[]>`
      select writable from order_chat_party(${RIDER_TG}, ${orderId}::uuid)`;
    expect(open[0]?.writable).toBe(true);

    expect(await cancel()).toMatchObject({ ok: true, previous_status: "matched" });
    const rows = await sql<{ payload: Json }[]>`
      select payload from notification_outbox
       where order_id = ${orderId}::uuid and kind = 'order_cancelled'
         and payload->>'driver_id' = ${driverA}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.was_assigned).toBe(true);
    for (const tg of [RIDER_TG, DRIVER_A_TG]) {
      const party = await sql<{ writable: boolean }[]>`
        select writable from order_chat_party(${tg}, ${orderId}::uuid)`;
      expect(party[0]?.writable).toBe(false);
    }
  });

  it("الإكمالُ المكرَّرُ مرفوضٌ ولا يكتبُ أثرًا ثانيًا", async () => {
    await sql`
      update orders set status = 'in_progress', assigned_driver_id = ${driverA}::uuid,
                        matched_at = now(), started_at = now()
       where id = ${orderId}::uuid`;
    const first = await sql<{ r: Json }[]>`
      select driver_complete_ride(${DRIVER_A_TG}, ${orderId}::uuid) as r`;
    expect(first[0]?.r).toMatchObject({ ok: true });
    const second = await sql<{ r: Json }[]>`
      select driver_complete_ride(${DRIVER_A_TG}, ${orderId}::uuid) as r`;
    expect(second[0]?.r).toEqual({ ok: false, error: "PHASE_MISMATCH" });
    expect((await order()).status).toBe("completed");
    expect(await audits("order.completed")).toBe(1);
  });
});
