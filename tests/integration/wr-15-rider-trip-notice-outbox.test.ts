/**
 * الغرض: `WR-15` (ADR 0265) على PostgreSQL حقيقيٍّ — إشعارُ طورِ الرحلةِ للراكبِ صفٌّ
 *   في `notification_outbox`: صفٌّ واحدٌ لكلِّ طلبٍ وطورٍ (مفتاحُ منعِ التكرار)، والمُطالِبُ
 *   يقرأُ محادثةَ الراكبِ ولغتَه حيّتينِ، ويحفظُ ترتيبَ الطلبِ (لا يُلتقَطُ «الوصولُ» قبلَ
 *   تسليمِ «القبول»)، والراكبُ بلا محادثةٍ `undeliverable`، والطورُ المجهولُ مرفوض.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { observeQueryTimings } from "../../packages/infrastructure/db/query-deadline.ts";
import { createRiderTripNoticeOutbox } from "../../packages/infrastructure/notification/rider-trip-notice-outbox.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ صندوقِ إشعاراتِ الطورِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const MARK = "wr15-trip-notice";
const RIDER_TELEGRAM = 900_002_611;

type Claim = {
  readonly ok: boolean;
  readonly delivery: {
    readonly delivery_id: string;
    readonly kind: string;
    readonly claim_token: string;
    readonly payload: Record<string, unknown>;
  } | null;
  readonly undeliverable?: string;
  readonly reason?: string;
};

describeIf("WR-15 — إشعاراتُ الطورِ في صندوقِ الصادرِ الموحَّد", () => {
  let sql: Sql;
  let cityId = "";
  let riderUserId = "";
  let riderId = "";
  let orderId = "";

  async function claim(): Promise<Claim> {
    const rows = await sql<{ r: Claim }[]>`select claim_notification_delivery() as r`;
    return rows[0]?.r as Claim;
  }

  async function finish(id: string, token: string): Promise<void> {
    await sql`
      update notification_outbox
         set status = 'delivered', delivered_at = now(), delivered_message_id = 'm',
             claim_token = null, claimed_at = null
       where id = ${id}::uuid and claim_token = ${token}::uuid`;
  }

  /** كلُّ ما يُلتقَطُ قبلَ صفوفِنا يُربِكُ القياس — كما في حرسِ `SEC-19`. */
  async function clearPending(): Promise<void> {
    await sql`delete from notification_outbox where status in ('pending', 'sending')`;
  }

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    const city = (
      await sql<{ id: string }[]>`select id from cities order by created_at limit 1`
    )[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدة");
    cityId = city.id;
    const user = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${RIDER_TELEGRAM}, ${MARK}, 'ar', 'rider') returning id`;
    riderUserId = user[0]?.id as string;
    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}::uuid, ${riderUserId}::uuid) returning id`;
    riderId = rider[0]?.id as string;
  });

  beforeEach(async () => {
    await clearPending();
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    const order = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
              st_setsrid(st_makepoint(39.17, 21.54), 4326))
      returning id`;
    orderId = order[0]?.id as string;
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
    await sql`delete from orders where rider_id = ${riderId}::uuid`;
    await sql`delete from riders where id = ${riderId}::uuid`;
    await sql`delete from users where id = ${riderUserId}::uuid`;
    await sql.end();
  });

  it("صفٌّ واحدٌ لكلِّ طلبٍ وطور: الإيداعُ الثاني مكرَّرٌ لا صفٌّ جديد", async () => {
    const outbox = createRiderTripNoticeOutbox(sql);
    // LOAD-01 (الدفعةُ الحاديةَ عشرةَ): الردُّ يحملُ معرّفَ تيليجرامِ الراكبِ، فلا استعلامَ ثانٍ له.
    const tg = String(RIDER_TELEGRAM);
    expect(await outbox.enqueue(orderId, "MATCHED")).toEqual({
      created: true,
      riderTelegramId: tg,
    });
    expect(await outbox.enqueue(orderId, "MATCHED")).toEqual({
      created: false,
      riderTelegramId: tg,
    });
    expect(await outbox.enqueue(orderId, "ARRIVED")).toEqual({
      created: true,
      riderTelegramId: tg,
    });
    const rows = await sql<{ dedup_key: string; recipient_user_id: string; status: string }[]>`
      select dedup_key, recipient_user_id::text, status from notification_outbox
       where kind = 'rider_trip_notice' and order_id = ${orderId}::uuid order by created_at`;
    expect(rows.map((r) => r.dedup_key)).toEqual([
      `rider_trip:${orderId}:MATCHED`,
      `rider_trip:${orderId}:ARRIVED`,
    ]);
    expect(rows.every((r) => r.recipient_user_id === riderUserId && r.status === "pending")).toBe(
      true,
    );
  });

  it("المُطالِبُ يقرأُ محادثةَ الراكبِ ولغتَه، ولا يلتقطُ «الوصولَ» قبلَ تسليمِ «القبول»", async () => {
    const outbox = createRiderTripNoticeOutbox(sql);
    await outbox.enqueue(orderId, "MATCHED");
    await outbox.enqueue(orderId, "ARRIVED");
    const first = await claim();
    expect(first.delivery?.kind).toBe("rider_trip_notice");
    expect(first.delivery?.payload).toMatchObject({
      order_id: orderId,
      event: "MATCHED",
      chat_id: String(RIDER_TELEGRAM),
      language: "ar",
    });
    // الأقدمُ للطلبِ يُلتقَطُ أوّلاً، وما يليه بعدَ تسليمِه.
    if (first.delivery !== null)
      await finish(first.delivery.delivery_id, first.delivery.claim_token);
    const second = await claim();
    expect(second.delivery?.payload).toMatchObject({ event: "ARRIVED" });
  });

  it("راكبٌ بلا محادثةٍ يُعلَنُ undeliverable بسببٍ مُسمّى ولا يُعاد", async () => {
    await sql`update users set telegram_id = null where id = ${riderUserId}::uuid`;
    try {
      await createRiderTripNoticeOutbox(sql).enqueue(orderId, "STARTED");
      const result = await claim();
      expect(result.delivery).toBeNull();
      expect(result.reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
      const row = await sql<{ status: string }[]>`
        select status from notification_outbox where kind = 'rider_trip_notice' and order_id = ${orderId}::uuid`;
      expect(row[0]?.status).toBe("undeliverable");
    } finally {
      await sql`update users set telegram_id = ${RIDER_TELEGRAM} where id = ${riderUserId}::uuid`;
    }
  });

  it("الطورُ المجهولُ والطلبُ الغائبُ يُرفضانِ بلا صفّ", async () => {
    const bad = await sql<{ r: { ok: boolean; error?: string } }[]>`
      select enqueue_rider_trip_notice(${orderId}::uuid, 'TELEPORTED') as r`;
    expect(bad[0]?.r).toEqual({ ok: false, error: "EVENT_INVALID" });
    const missing = await createRiderTripNoticeOutbox(sql).enqueue(
      "00000000-0000-4000-8000-000000000015",
      "MATCHED",
    );
    expect(missing).toBeNull();
    const count = await sql<{ n: number }[]>`
      select count(*)::int as n from notification_outbox where kind = 'rider_trip_notice' and order_id = ${orderId}::uuid`;
    expect(count[0]?.n).toBe(0);
  });

  it("LOAD-01: الإيداعُ رحلةٌ واحدةٌ إلى القاعدةِ ويُعيدُ معرّفَ الراكب (كانَ استعلامًا ثانيًا لكلِّ طور)", async () => {
    const seen: string[] = [];
    observeQueryTimings((t) => seen.push(t.sig ?? "?"));
    const counted = createSql({
      connectionString: DATABASE_URL as string,
      max: 1,
      queryDeadlineMs: 10_000,
      applicationName: "wr15-count",
    });
    try {
      const result = await createRiderTripNoticeOutbox(counted).enqueue(orderId, "COMPLETED");
      expect(result).toEqual({ created: true, riderTelegramId: String(RIDER_TELEGRAM) });
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain("enqueue_rider_trip_notice");
    } finally {
      observeQueryTimings(null);
      await counted.end();
    }
  });

  it("الإيداعُ لـservice_role وحدَه", async () => {
    const rows = await sql<{ anon: boolean; auth: boolean; svc: boolean }[]>`
      select has_function_privilege('anon', 'enqueue_rider_trip_notice(uuid, text)', 'execute') as anon,
             has_function_privilege('authenticated', 'enqueue_rider_trip_notice(uuid, text)', 'execute') as auth,
             has_function_privilege('service_role', 'enqueue_rider_trip_notice(uuid, text)', 'execute') as svc`;
    expect(rows[0]).toEqual({ anon: false, auth: false, svc: true });
  });
});
