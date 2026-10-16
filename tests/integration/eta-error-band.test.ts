/**
 * ADR 0243 — `record_eta_and_read_band` على PostgreSQL حقيقيّ: يحفظُ أوّلَ تقديرٍ لكلِّ ساقٍ
 * ولا يستبدلُه، ويقيسُ نسبةَ (الفعليّ ÷ المقدَّر) على الساقاتِ المنتهيةِ في مدينةِ الطلب،
 * ولا يُنادى إلّا من `service_role`. يُتخطّى محلّياً بلا `TEST_DATABASE_URL`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createEtaBandStore } from "../../packages/infrastructure/tracking/eta-band-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TELEGRAM_ID = 900_002_431;
const DRIVER_TELEGRAM_ID = 900_002_432;
const POINT = { lat: 21.4858, lng: 39.1925 } as const;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverUserId = "";
let driverId = "";

interface Envelope {
  readonly ok: boolean;
  readonly error?: string;
  readonly samples?: number;
  readonly low_ratio?: number | null;
  readonly high_ratio?: number | null;
}

async function call(orderId: string, leg: string, seconds: number): Promise<Envelope> {
  const [row] = await sql<{ result: Envelope }[]>`
    select record_eta_and_read_band(${orderId}::uuid, ${leg}, ${seconds}::integer) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّة");
  return row.result;
}

async function seedOrder(status: "in_progress" | "completed"): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, pickup_label, assigned_driver_id,
      idempotency_key, matched_at, started_at
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, ${status}::order_status,
      st_setsrid(st_makepoint(${POINT.lng}, ${POINT.lat}), 4326)::geography, 'البلد',
      ${driverId}, ${`eta-band:${crypto.randomUUID()}`}, now() - interval '1 hour',
      now() - interval '1 hour'
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلب");
  return row.id;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب المدى', '+966500002431') returning id
  `;
  riderUserId = riderUser?.id ?? "";
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  riderId = rider?.id ?? "";
  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائق المدى', '+966500002432') returning id
  `;
  driverUserId = driverUser?.id ?? "";
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر س ب 2431')
    returning id
  `;
  driverId = driver?.id ?? "";
});

beforeEach(async () => {
  if (DATABASE_URL === undefined) return;
  // I1 (ADR 0286): فهرسُ الالتزامِ الواحدِ للسائقِ يرفضُ بذرَ التزامٍ ثانٍ لسائقٍ
  // لا يزالُ التزامُ اختبارٍ سابقٍ حيًّا — فتُنهى التزاماتُ هذا الملفِّ قبلَ كلِّ اختبارٍ.
  await sql`update orders set status = 'completed', completed_at = now() where idempotency_key like 'eta-band:%' and is_driver_engaged_order_status(status)`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await sql`delete from orders where rider_id = ${riderId}`;
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  for (const id of [riderUserId, driverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("ADR 0243 — مقياسُ خطأِ التقديرِ على القاعدة", () => {
  it("مدخلٌ مخالفٌ أو طلبٌ غائبٌ ⇒ رفضٌ مُصنَّفٌ بلا كتابة", async () => {
    const orderId = await seedOrder("in_progress");
    expect(await call(orderId, "midway", 600)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await call(orderId, "pickup", 0)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await call(crypto.randomUUID(), "pickup", 600)).toEqual({
      ok: false,
      error: "ORDER_NOT_FOUND",
    });
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from eta_observations where order_id = ${orderId}
    `;
    expect(count?.n).toBe(0);
  });

  it("الأوّلُ يُحفَظُ وما بعدَه لا يستبدلُه", async () => {
    const orderId = await seedOrder("in_progress");
    expect((await call(orderId, "pickup", 600)).ok).toBe(true);
    expect((await call(orderId, "pickup", 120)).ok).toBe(true);
    const rows = await sql<{ predicted_seconds: number; city_id: string }[]>`
      select predicted_seconds, city_id from eta_observations where order_id = ${orderId}
    `;
    expect(rows.map((row) => ({ predicted: row.predicted_seconds, city: row.city_id }))).toEqual([
      { predicted: 600, city: cityId },
    ]);
  });

  it("الساقاتُ المنتهيةُ تُقاسُ بنسبتِها، وغيرُ المنتهيةِ لا تُعَدّ", async () => {
    const probe = await seedOrder("in_progress");
    const before = await call(probe, "pickup", 600);
    const baseline = before.samples ?? 0;

    // 30 ساقاً منتهيةً بنسبٍ 1.00 … 1.29 بالضبط: تقديرٌ 1000 ث ووصولٌ بعدَ 1000+10i ث.
    // لحظةُ التقديرِ ثابتةٌ واحدةٌ للعبارتَين: `now()` في عبارتَين منفصلتَين (خارجَ معاملةٍ)
    // يختلفُ بأجزاءِ ميلّي ثانية فتنحرفُ النسبةُ عن 1.029 بأكثرَ من دقّةِ 6 منازل (CI 37935391806).
    const predictedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < 30; i += 1) {
      const orderId = await seedOrder("completed");
      await sql`
        insert into eta_observations (order_id, leg, city_id, predicted_seconds, predicted_at)
        values (${orderId}, 'pickup', ${cityId}, 1000, ${predictedAt})
      `;
      await sql`
        update orders set
          arrived_at = ${predictedAt}::timestamptz + make_interval(secs => ${1000 + 10 * i}),
          completed_at = now() - interval '30 minutes'
        where id = ${orderId}
      `;
    }
    const after = await call(probe, "pickup", 600);
    expect(after.ok).toBe(true);
    expect(after.samples).toBe(Math.min(500, baseline + 30));
    if (baseline === 0) {
      expect(after.low_ratio).toBeCloseTo(1.029, 6);
      expect(after.high_ratio).toBeCloseTo(1.261, 6);
    }

    // المُنفِّذُ يقرأُ الغلافَ نفسَه.
    const store = createEtaBandStore(sql);
    const read = await store.recordAndRead({
      orderId: probe,
      leg: "pickup",
      predictedSeconds: 600,
    });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.samples).toBe(after.samples ?? -1);
  });

  it("لا نداءَ من `anon` ولا `authenticated`، والجدولُ تحتَ RLS", async () => {
    const [privileges] = await sql<{ anon: boolean; authed: boolean; rls: boolean }[]>`
      select
        has_function_privilege('anon', 'record_eta_and_read_band(uuid, text, integer)', 'execute') as anon,
        has_function_privilege('authenticated', 'record_eta_and_read_band(uuid, text, integer)', 'execute') as authed,
        (select relrowsecurity from pg_class where relname = 'eta_observations') as rls
    `;
    expect(privileges).toEqual({ anon: false, authed: false, rls: true });
  });

  it("حذفُ الطلبِ يحذفُ رصدَه (`on delete cascade`)", async () => {
    const orderId = await seedOrder("in_progress");
    await call(orderId, "dropoff", 900);
    await sql`delete from orders where id = ${orderId}`;
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from eta_observations where order_id = ${orderId}
    `;
    expect(count?.n).toBe(0);
  });
});
