/**
 * الغرض: ADR 0287 على PostgreSQL حقيقيٍّ — أحداثُ أطوارِ الرحلةِ في Mini App وإقرارُ
 *   العميلِ بها: الملكيةُ منَ الجلسةِ، والتكرارُ لا يُنشئُ إيصالًا ثانيًا، والصفُّ
 *   المنتظرُ يُغلقُ `miniapp_ack` فورًا، والمحمولُ عندَ العاملِ لا يُمسُّ (رمزُه
 *   لصاحبِه) ثم يُغلقُه العاملُ بالقناةِ نفسِها، والإقرارُ المتأخرُ بعدَ تيليجرامَ
 *   يُدوَّنُ إيصالًا منفصلًا دونَ محوِ قبولِ Telegram API.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createRiderTripAppDelivery } from "../../packages/infrastructure/notification/rider-trip-app-delivery.ts";
import { createRiderTripNoticeOutbox } from "../../packages/infrastructure/notification/rider-trip-notice-outbox.ts";
import { createRiderTripEventsStore } from "../../packages/infrastructure/transport/rider-trip-events-store.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ إقرارِ أحداثِ الرحلةِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const MARK = "adr0287-trip-ack";
const RIDER_TG = 900_028_701;
const OTHER_TG = 900_028_702;

describeIf("ADR 0287 — أحداثُ الرحلةِ في Mini App وإقرارُ العميلِ", () => {
  let sql: Sql;
  let cityId = "";
  const users: string[] = [];
  let riderId = "";
  let orderId = "";

  async function rows() {
    return sql<
      {
        id: string;
        event: string;
        status: string;
        delivered_channel: string | null;
        delivered_message_id: string | null;
      }[]
    >`
      select id::text, payload ->> 'event' as event, status, delivered_channel, delivered_message_id
        from notification_outbox
       where kind = 'rider_trip_notice' and order_id = ${orderId}::uuid
       order by rider_trip_event_seq(payload ->> 'event') nulls last`;
  }

  async function receipts(): Promise<number> {
    const r = await sql<{ n: string }[]>`
      select count(*)::text as n from rider_trip_event_receipts where order_id = ${orderId}::uuid`;
    return Number(r[0]?.n ?? 0);
  }

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    const city = (
      await sql<{ id: string }[]>`select id from cities order by created_at limit 1`
    )[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدة");
    cityId = city.id;
    await sql`delete from users where telegram_id in (${RIDER_TG}, ${OTHER_TG})`;
    for (const tg of [RIDER_TG, OTHER_TG]) {
      const u = await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, language_code, role)
        values (${cityId}::uuid, ${tg}, ${MARK}, 'ar', 'rider') returning id`;
      users.push(u[0]?.id as string);
    }
    await sql`insert into riders (city_id, user_id) values (${cityId}::uuid, ${users[1] as string}::uuid)`;
    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}::uuid, ${users[0] as string}::uuid) returning id`;
    riderId = rider[0]?.id as string;
  });

  beforeEach(async () => {
    await sql`delete from notification_outbox where status in ('pending', 'sending')`;
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    const order = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
              st_setsrid(st_makepoint(39.17, 21.54), 4326))
      returning id`;
    orderId = order[0]?.id as string;
    const outbox = createRiderTripNoticeOutbox(sql);
    for (const e of ["MATCHED", "ARRIVED", "STARTED", "COMPLETED"] as const) {
      await outbox.enqueue(orderId, e);
    }
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    await sql`delete from riders where user_id in ${sql(users)}`;
    await sql`delete from users where id in ${sql(users)}`;
    await sql.end();
  });

  it("القائمةُ لصاحبِها وحدَه، بتسلسلٍ ثابتٍ، والقراءةُ لا تُسجِّلُ إيصالًا", async () => {
    const store = createRiderTripEventsStore(sql);
    const mine = await store.list({ telegramUserId: String(RIDER_TG), orderId });
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.value.map((e) => [e.event, e.seq, e.acked])).toEqual([
      ["MATCHED", 1, false],
      ["ARRIVED", 2, false],
      ["STARTED", 3, false],
      ["COMPLETED", 4, false],
    ]);
    const theirs = await store.list({ telegramUserId: String(OTHER_TG), orderId });
    expect(theirs.ok ? "ok" : theirs.error).toBe("ORDER_NOT_FOUND");
    expect(await receipts()).toBe(0);
  });

  it("إقرارُ المالكِ يُغلقُ المنتظرَ `miniapp_ack` بلا معرّفِ رسالةٍ، والتكرارُ لا يُنشئُ إيصالًا ثانيًا", async () => {
    const store = createRiderTripEventsStore(sql);
    const before = await rows();
    const ids = before.slice(0, 2).map((r) => r.id);
    const first = await store.ack({ telegramUserId: String(RIDER_TG), orderId, deliveryIds: ids });
    expect(first.ok && first.value).toEqual({ recorded: 2, closed: 2 });
    const again = await store.ack({ telegramUserId: String(RIDER_TG), orderId, deliveryIds: ids });
    expect(again.ok && again.value).toEqual({ recorded: 0, closed: 0 });
    expect(await receipts()).toBe(2);
    const after = await rows();
    expect(
      after.slice(0, 2).map((r) => [r.status, r.delivered_channel, r.delivered_message_id]),
    ).toEqual([
      ["delivered", "miniapp_ack", null],
      ["delivered", "miniapp_ack", null],
    ]);
    expect(after.slice(2).every((r) => r.status === "pending")).toBe(true);
  });

  it("إقرارُ غيرِ المالكِ يُهمَلُ بصمتٍ: لا إيصالَ ولا إغلاقَ", async () => {
    const store = createRiderTripEventsStore(sql);
    const ids = (await rows()).map((r) => r.id);
    const out = await store.ack({ telegramUserId: String(OTHER_TG), orderId, deliveryIds: ids });
    expect(out.ok && out.value).toEqual({ recorded: 0, closed: 0 });
    expect(await receipts()).toBe(0);
    expect((await rows()).every((r) => r.status === "pending")).toBe(true);
  });

  it("المحمولُ عندَ العاملِ (`sending`) لا يُمسُّ؛ والعاملُ يجدُ الإيصالَ فيُغلقُه `miniapp_ack` برمزِه", async () => {
    const claimed = await sql<
      { r: { delivery: { delivery_id: string; claim_token: string } | null } }[]
    >`
      select claim_notification_delivery() as r`;
    const d = claimed[0]?.r.delivery;
    expect(d).not.toBeNull();
    if (d === null || d === undefined) return;
    const store = createRiderTripEventsStore(sql);
    const out = await store.ack({
      telegramUserId: String(RIDER_TG),
      orderId,
      deliveryIds: [d.delivery_id],
    });
    expect(out.ok && out.value).toEqual({ recorded: 1, closed: 0 });
    const app = createRiderTripAppDelivery({ sql, gatewayInternalUrl: null, secret: null });
    expect(await app.findReceipt(d.delivery_id)).toBeInstanceOf(Date);
    // الإشارةُ معطّلةٌ بلا سرٍّ: «لم تُبَثّ» لا تسليمَ.
    expect(await app.signalRider(String(RIDER_TG), orderId)).toBe(false);
    const fin = await sql<{ r: { ok: boolean } }[]>`
      select finish_notification_delivery_via_board(${d.delivery_id}::uuid, ${d.claim_token}::uuid) as r`;
    expect(fin[0]?.r.ok).toBe(true);
    const row = (await rows()).find((r) => r.id === d.delivery_id);
    expect([row?.status, row?.delivered_channel]).toEqual(["delivered", "miniapp_ack"]);
  });

  it("إقرارٌ متأخرٌ بعدَ قبولِ Telegram API: إيصالٌ منفصلٌ ولا يُمحى قبولُ تيليجرامَ", async () => {
    const [first] = await rows();
    if (first === undefined) throw new Error("no row");
    await sql`
      update notification_outbox
         set status = 'delivered', delivered_channel = 'telegram', delivered_at = now(),
             delivered_message_id = '4242'
       where id = ${first.id}::uuid`;
    const store = createRiderTripEventsStore(sql);
    const out = await store.ack({
      telegramUserId: String(RIDER_TG),
      orderId,
      deliveryIds: [first.id],
    });
    expect(out.ok && out.value).toEqual({ recorded: 1, closed: 0 });
    const row = (await rows())[0];
    expect([row?.status, row?.delivered_channel, row?.delivered_message_id]).toEqual([
      "delivered",
      "telegram",
      "4242",
    ]);
    const listed = await store.list({ telegramUserId: String(RIDER_TG), orderId });
    expect(listed.ok && listed.value[0]?.acked).toBe(true);
  });

  it("حدثٌ خارجَ أطوارِ الرحلةِ لا يُقبلُ إقرارُه في Mini App", async () => {
    await createRiderTripNoticeOutbox(sql).enqueue(orderId, "SEARCH_EXPIRED");
    const extra = (await rows()).find((r) => r.event === "SEARCH_EXPIRED");
    if (extra === undefined) throw new Error("no SEARCH_EXPIRED row");
    const out = await createRiderTripEventsStore(sql).ack({
      telegramUserId: String(RIDER_TG),
      orderId,
      deliveryIds: [extra.id],
    });
    expect(out.ok && out.value).toEqual({ recorded: 0, closed: 0 });
  });

  it("قيدُ القناةِ: `miniapp_ack` مقبولٌ بلا معرّفِ رسالةٍ، وقناةٌ مجهولةٌ مرفوضةٌ", async () => {
    const [first] = await rows();
    if (first === undefined) throw new Error("no row");
    let rejected = false;
    try {
      await sql`update notification_outbox set delivered_channel = 'sms' where id = ${first.id}::uuid`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    let pairRejected = false;
    try {
      await sql`
        update notification_outbox set status = 'delivered', delivered_at = now(),
               delivered_channel = 'telegram', delivered_message_id = null
         where id = ${first.id}::uuid`;
    } catch {
      pairRejected = true;
    }
    // تيليجرامُ بلا معرّفِ رسالةٍ ليسَ تسليمًا — القيدُ يرفضُ ادّعاءَ 2xx بلا دليلٍ.
    expect(pairRejected).toBe(true);
  });
});
