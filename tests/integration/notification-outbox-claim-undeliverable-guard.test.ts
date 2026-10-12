/**
 * الغرض: قياسُ حرسِ العنوانِ الغائبِ في `claim_notification_delivery` على
 *   PostgreSQL حقيقيٍّ (`SEC-19` · الخطوةُ الثالثة): صفٌّ مُلتقَطٌ لا يُحَلُّ
 *   عنوانُهُ ⇒ يُعلَنُ `undeliverable` بـ`died_at` وسببٍ مُسمّىً، ولا يُعادُ
 *   للمُرسِلِ، ولا يُحاوَلُ إرسالُهُ.
 * الحالة: منفَّذٌ فعليّاً — 2026-09-22.
 * ينتمي إلى: tests/integration
 * الحاكم: `SEC-19` · `ADR 0122` (الاستعلامُ المُرجَّأُ ليسَ وعداً) ·
 *   `ADR 0046` (لا تجاوزَ بلا تصنيفٍ)
 *
 * ## المسألةُ التي يقيسُها هذا الملفُّ
 *
 * `claim_notification_delivery` تلتقطُ صفًّا من `notification_outbox`، تزيدُ
 * `attempts`، ثمَّ تُحَلُّ العنوانَ حيّاً من القاعدةِ. فإذا كانَ العنوانُ
 * غائبًا (المستخدمُ محذوفٌ أو بلا `telegram_id`)، فإنَّ الدالّةَ كانت تُسلِّمُ
 * الصفَّ للعاملِ كأنَّه قابلٌ للإرسالِ. والآنَ — بعدَ الحرسِ — يُعلَنُ الصفُّ
 * `undeliverable` بـ`died_at` وسببٍ مُسمّىً، ولا يُعادُ للمُرسِلِ.
 *
 * ## وما لا يُقاسُ ههنا
 *
 * لا يُقاسُ الفرعُ `offer` — عنوانُهُ لا يُحَلُّ في الدالّةِ بل في TypeScript.
 * ولا يُقاسُ مستخدمٌ بـ`telegram_id = null` — متعذِّرٌ اليومَ (`not null`).
 * والقياسُ يحاكي الغيابَ بحذفِ صفِّ المستخدمِ أو بمعرِّفٍ غيرِ موجودٍ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  قياسُ حرسِ العنوانِ الغائبِ مُتخطّىً: عيّن TEST_DATABASE_URL.");
}

const MARK = "sec19-guard";

type ClaimResult = {
  readonly ok: boolean;
  readonly delivery: {
    readonly delivery_id: string;
    readonly kind: string;
    readonly claim_token: string;
    readonly attempts: number;
    readonly payload: Record<string, unknown>;
  } | null;
  readonly undeliverable?: string;
  readonly reason?: string;
};

type OutboxRow = {
  readonly status: string;
  readonly dead_reason: string | null;
  readonly died_at: string | null;
  readonly attempts: number;
};

describeIf("حرسُ العنوانِ الغائبِ في claim_notification_delivery (SEC-19-ب-٣)", () => {
  let sql: Sql;
  let cityId: string;
  let riderUserId: string;
  let riderId: string;
  let driverUserId: string;
  let driverId: string;
  let orderId: string;
  let offerId: string;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });

    const cities = await sql<{ id: string }[]>`select id from cities order by created_at limit 1`;
    const city = cities[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدةِ.");
    cityId = city.id;

    const riderUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${String(8_100_000_000_000 + Date.now())}::bigint, ${MARK}, 'ar', 'rider')
      returning id
    `;
    riderUserId = riderUser[0]?.id as string;

    const rider = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id)
      values (${cityId}::uuid, ${riderUserId}::uuid)
      returning id
    `;
    riderId = rider[0]?.id as string;

    const order = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values (${cityId}::uuid, ${riderId}::uuid, 'delivery', 'searching',
              st_setsrid(st_makepoint(0, 0), 4326))
      returning id
    `;
    orderId = order[0]?.id as string;

    const driverUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${String(9_100_000_000_000 + Date.now())}::bigint, ${`${MARK}-driver`}, 'ar', 'driver')
      returning id
    `;
    driverUserId = driverUser[0]?.id as string;

    const driver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}::uuid, ${driverUserId}::uuid, 'verified')
      returning id
    `;
    driverId = driver[0]?.id as string;

    const offer = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, distance_km, expires_at, status)
      values (${cityId}::uuid, ${orderId}::uuid, ${driverId}::uuid, 5.0, now() + interval '5 minutes', 'pending')
      returning id
    `;
    offerId = offer[0]?.id as string;
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`delete from notification_outbox where kind = ${MARK}::text or dedup_key like ${`${MARK}%`}`;
    await sql`delete from order_offers where id = ${offerId}::uuid`;
    await sql`delete from orders where id = ${orderId}::uuid`;
    await sql`delete from drivers where id = ${driverId}::uuid`;
    await sql`delete from riders where user_id in (select id from users where full_name like ${`${MARK}%`})`;
    await sql`delete from users where full_name like ${`${MARK}%`}`;
    await sql.end();
  });

  async function claimNext(): Promise<ClaimResult> {
    const rows = await sql<{ result: ClaimResult }[]>`
      select claim_notification_delivery() as result
    `;
    return rows[0]?.result as ClaimResult;
  }

  async function outboxRow(id: string): Promise<OutboxRow | undefined> {
    const rows = await sql<OutboxRow[]>`
      select status, dead_reason, died_at::text, attempts
        from notification_outbox where id = ${id}::uuid
    `;
    return rows[0];
  }

  async function insertOutbox(kind: string, payload: Record<string, unknown>): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, order_id, driver_id, dedup_key, payload)
      values (${cityId}::uuid, ${kind}, ${orderId}::uuid, ${driverId}::uuid,
              ${`${MARK}:${kind}:${Date.now()}:${Math.random()}`}, ${sql.json(payload as unknown as Record<string, never>)})
      returning id
    `;
    return rows[0]?.id as string;
  }

  // امسحْ كلَّ صفوفِ دورةِ الرحلةِ المعلَّقةِ — فالترتيبُ السببيُّ يمنعُ التقاطَ
  // صفٍّ إذا كانَ هناكَ صفٌّ أقدمُ بنفسِ order_id، والأنواعُ ذاتُ الأولويةِ الأعلى
  // (مثل `offer`) تُلتقَطُ قبلَ صفِّنا. فالصفوفُ المعلَّقةُ المتروكةُ من اختباراتٍ
  // أخرى تُربِكُ القياسَ. والاختباراتُ اللاحقةُ تُنشِئُ صفوفَها بنفسِها.
  async function clearPending(): Promise<void> {
    await sql`delete from notification_outbox where status = 'pending' and kind in (
      'offer', 'dispute_resolution',
      'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
      'wider_circle_opened', 'no_driver_found', 'order_cancelled',
      'lost_item_report',
      'safety_resolution_closed', 'safety_resolution_blocked',
      'rider_trip_notice'
    )`;
  }

  // ──────────────────────────────────────────────────────────────────────
  // ١) صفٌّ قابلٌ للتسليمِ يُلتقَطُ طبيعياً — لا انحدارَ
  // ──────────────────────────────────────────────────────────────────────
  it("١) صفٌّ بعنوانٍ صالحٍ يُلتقَطُ ويُسلَّمُ للمُرسِلِ — لا انحدارَ", async () => {
    await clearPending();
    const id = await insertOutbox("order_cancelled", {
      driver_id: driverId,
      side: "driver",
    });

    const result = await claimNext();
    expect(result.ok).toBe(true);
    expect(result.delivery).not.toBeNull();
    expect(result.delivery?.claim_token).toBeTruthy();
    expect(result.undeliverable).toBeUndefined();

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // ٢) `order_cancelled` بمعرِّفِ سائقٍ غيرِ موجودٍ ⇒ `undeliverable`
  // ──────────────────────────────────────────────────────────────────────
  it("٢) `order_cancelled` بمعرِّفِ سائقٍ غيرِ موجودٍ ⇒ `undeliverable` بـ`TELEGRAM_DELIVERY_UNAVAILABLE`", async () => {
    await clearPending();
    const fakeDriverId = "00000000-0000-0000-0000-000000000001";
    const id = await insertOutbox("order_cancelled", { driver_id: fakeDriverId });

    const result = await claimNext();
    expect(result.ok).toBe(true);
    expect(result.delivery).toBeNull();
    expect(result.undeliverable).toBe(id);
    expect(result.reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");

    const row = await outboxRow(id);
    expect(row?.status).toBe("undeliverable");
    expect(row?.dead_reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
    expect(row?.died_at).not.toBeNull();
    expect(row?.attempts).toBeGreaterThanOrEqual(1);

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // ٣) `wider_circle_opened` بمعرِّفِ طلبٍ غيرِ موجودٍ ⇒ `undeliverable`
  //    بـ`TELEGRAM_DELIVERY_NOT_REQUIRED` (غيرُ جوهريٍّ)
  // ──────────────────────────────────────────────────────────────────────
  it("٣) `wider_circle_opened` بعنوانٍ غائبٍ ⇒ `TELEGRAM_DELIVERY_NOT_REQUIRED` (غيرُ جوهريٍّ)", async () => {
    await clearPending();
    const fakeOrderId = "00000000-0000-0000-0000-000000000002";
    const id = await insertOutbox("wider_circle_opened", { order_id: fakeOrderId });

    const result = await claimNext();
    expect(result.delivery).toBeNull();
    expect(result.reason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");

    const row = await outboxRow(id);
    expect(row?.status).toBe("undeliverable");
    expect(row?.dead_reason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // ٤) `lost_item_report` بمعرِّفِ سائقٍ غيرِ موجودٍ ⇒ `TELEGRAM_DELIVERY_NOT_REQUIRED`
  // ──────────────────────────────────────────────────────────────────────
  it("٤) `lost_item_report` بعنوانٍ غائبٍ ⇒ `TELEGRAM_DELIVERY_NOT_REQUIRED`", async () => {
    await clearPending();
    const fakeDriverId = "00000000-0000-0000-0000-000000000003";
    const id = await insertOutbox("lost_item_report", { driver_id: fakeDriverId });

    const result = await claimNext();
    expect(result.delivery).toBeNull();
    expect(result.reason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");

    const row = await outboxRow(id);
    expect(row?.status).toBe("undeliverable");

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // ٥) صفٌّ `undeliverable` لا يُلتقَطُ مرةً ثانيةً — لا محاولةَ تُعادُ
  // ──────────────────────────────────────────────────────────────────────
  it("٥) صفٌّ `undeliverable` لا يُلتقَطُ مرةً ثانيةً — لا محاولةَ تُعادُ", async () => {
    await clearPending();
    const fakeDriverId = "00000000-0000-0000-0000-000000000004";
    const id = await insertOutbox("order_cancelled", { driver_id: fakeDriverId });

    // الالتقاطُ الأوّلُ: يُعلَنُ `undeliverable`.
    const first = await claimNext();
    expect(first.undeliverable).toBe(id);

    // الالتقاطُ الثاني: لا شيءَ — الصفُّ ليسَ `pending`.
    const second = await claimNext();
    expect(second.delivery).toBeNull();
    expect(second.undeliverable).toBeUndefined();

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // ٦) `safety_resolution_closed` بعنوانٍ غائبٍ ⇒ `TELEGRAM_DELIVERY_UNAVAILABLE`
  // ──────────────────────────────────────────────────────────────────────
  it("٦) `safety_resolution_closed` بعنوانٍ غائبٍ ⇒ `TELEGRAM_DELIVERY_UNAVAILABLE`", async () => {
    await clearPending();
    const fakeIncidentId = "00000000-0000-0000-0000-000000000005";
    const id = await insertOutbox("safety_resolution_closed", { incident_id: fakeIncidentId });

    const result = await claimNext();
    expect(result.delivery).toBeNull();
    expect(result.reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");

    const row = await outboxRow(id);
    expect(row?.status).toBe("undeliverable");
    expect(row?.dead_reason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });

  // ──────────────────────────────────────────────────────────────────────
  // ٧) `claim_token` يُنزَعُ من الصفِّ `undeliverable` — لا رمزَ لميِّتٍ
  // ──────────────────────────────────────────────────────────────────────
  it("٧) `claim_token` و`claimed_at` يُنزَعانِ من الصفِّ `undeliverable`", async () => {
    await clearPending();
    const fakeDriverId = "00000000-0000-0000-0000-000000000006";
    const id = await insertOutbox("order_cancelled", { driver_id: fakeDriverId });

    await claimNext();

    const tokenRows = await sql<{ claim_token: string | null; claimed_at: string | null }[]>`
      select claim_token, claimed_at::text from notification_outbox where id = ${id}::uuid
    `;
    expect(tokenRows[0]?.claim_token).toBeNull();
    expect(tokenRows[0]?.claimed_at).toBeNull();

    await sql`delete from notification_outbox where id = ${id}::uuid`;
  });
});
