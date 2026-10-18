/**
 * الغرض: LOAD-01 (الدفعةُ السابعةُ، P4) — سائقٌ صارَ متاحًا ⇒ يُعرَضُ عليه الطلبُ الباحثُ
 *   **الأقربُ إليه**، لا أقدمُ طلباتِ المدينةِ وحدَها.
 *
 *   المقيسُ (`diag-r12-conc12-500`): شوطُ المدينةِ يخدمُ أقدمَ 50 باحثًا، فتحتَ 500 متزامنٍ
 *   ينتظرُ الطلبُ الذي وصلَ سائقُه للتوِّ بجوارِه حتى تبلغَه النافذةُ: P4 = 56.6ث و9 طلباتٍ
 *   استنفدت دوراتِها. وبعدَ المسارِ (`diag-r12-arrival8-500`): P4 = 5.5ث، و99% من بثوثِ
 *   الوصولِ تضمُّ السائقَ الواصلَ.
 *
 *   ما يُحكَمُ عليه من القاعدةِ: (١) الأقربُ يُختارُ لا الأقدمُ؛ (٢) طلبٌ فيه لهذا السائقِ عرضٌ
 *   حيٌّ لا يُعادُ (لا دورةَ تُهدَرُ على غيرِه)؛ (٣) المستنفدُ وما خارجَ نصفِ القطرِ لا يُمسّان؛
 *   (٤) البثُّ يمرُّ بالمطابقةِ نفسِها فيضمُّ السائقَ الواصلَ.
 *
 * الحالة: اختبار تكامل فعلي — يحتاج TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { dispatchNearestToDriver } from "../../packages/application/dispatch/redispatch-searching-orders.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import { createOrderRepository } from "../../packages/infrastructure/transport/order-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { systemClock } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const describeIf = DATABASE_URL === "" ? describe.skip : describe;
if (DATABASE_URL === "") {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

let sql: Sql;
let cityId: CityId;
let city: ActiveCityHandle | undefined;
let riderId: string;
let driverUserId: string;
let driverRowId: string;
const created: string[] = [];
const TG_RIDER = 8_817_001;
const TG_DRIVER = 8_817_101;

/** تبعيّاتُ الشوطِ نفسُها التي يبنيها العاملُ في الإنتاجِ — لا نسخةٌ مبسّطة. */
function nearDeps() {
  return {
    finder: createSearchingOrderFinder(sql),
    broadcast: {
      orders: createOrderRepository(sql),
      offers: createOfferRepository(sql),
      candidates: createDriverCandidateRepository(sql),
      settings: createSettingsRepository(sql),
      offerWriter: createOfferWriter(sql),
      clock: systemClock,
    },
  };
}

beforeAll(async () => {
  if (DATABASE_URL === "") return;
  sql = createSql({ connectionString: DATABASE_URL });
  city = await ensureActiveCity(sql);
  cityId = city.cityId as CityId;

  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, role, telegram_id) values (${cityId}::uuid, 'rider', ${TG_RIDER})
      on conflict (telegram_id) do update set telegram_id = excluded.telegram_id returning id`;
  if (rider === undefined) throw new Error("users: لم يُدرَج الصفُّ — الاختبارُ لا معنى له");
  const [riderRow] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}::uuid, ${rider.id}::uuid)
      on conflict (user_id) do update set user_id = excluded.user_id returning id`;
  if (riderRow === undefined) throw new Error("riders: لم يُدرَج الصفُّ");
  riderId = riderRow.id;

  // تنظيفٌ ذاتيٌّ لبقايا جولاتٍ سابقةٍ لهذا الملفِّ (فشلُ afterAll سابقٌ لا يُورَّث):
  // طلباتُ راكبِ هذا الاختبارِ القديمةُ — بعروضِها وصندوقِها — لا يجوزُ أن تسرقَ
  // نافذةَ الشوطِ منَ الجولةِ الحاليةِ فيبدو الانحدارُ فاشلًا وهو سليمٌ.
  await sql`
    with mine as (
      delete from notification_outbox where order_id in (
        select id from orders where rider_id = ${riderId}::uuid) returning 1)
    select count(*)::int n from mine`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from orders where rider_id = ${riderId}::uuid`;

  // سائقٌ واحدٌ مؤهّلٌ متاحٌ بجوارِ نقطةِ الالتقاطِ: موثَّقٌ مشترِكٌ قادرٌ (بذرةُ
  // الاختباراتِ القائمةِ) + توافرٌ + موقعٌ حيٌّ في `drivers.last_location` (الذي يقرؤه
  // استعلامُ المرشحين) بجوارِ الالتقاطِ — كلُّ شروطِ الأهليةِ التي يفحصُها `matchOrder`.
  driverRowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_DRIVER,
    name: "سائق الأقرب",
  });
  const [driverUserRow] = await sql<{ id: string }[]>`
    select user_id as id from drivers where id = ${driverRowId}::uuid`;
  if (driverUserRow === undefined) throw new Error("drivers: الصف غير موجود");
  driverUserId = driverUserRow.id;
  // بذرةُ القدرةِ تُنشئُ اشتراكًا بلا فترةٍ ساريةٍ (سائقٌ قادرٌ غيرُ قابلٍ للإسنادِ
  // بنيةً) — وهذا السائقُ يجبُ أن يكونَ مؤهّلًا فعلًا، ففترةُ سريانٍ لاحقةٌ تجعلُ
  // الاشتراكَ حيًّا عندَ المجالِ (`isSubscriptionLive`).
  await sql`
    update subscriptions set current_period_end = now() + interval '30 days'
     where driver_id = ${driverRowId}::uuid and status = 'active'`;
  await sql`
    insert into driver_availability (city_id, driver_id, is_available, changed_at)
    values (${cityId}::uuid, ${driverRowId}::uuid, true, now())
    on conflict (driver_id) do update set is_available = true, changed_at = now()`;
  await sql`
    update drivers set
      last_location = ST_SetSRID(ST_MakePoint(39.1729, 21.5434), 4326)::geography,
      last_location_at = now(),
      last_location_quality = 'ACCEPT'
    where id = ${driverRowId}::uuid`;
});

afterAll(async () => {
  if (DATABASE_URL === "") return;
  if (created.length) {
    await sql`delete from notification_outbox where order_id = any(${created}::uuid[])`;
    await sql`delete from order_offers where order_id = any(${created}::uuid[])`;
    await sql`delete from orders where id = any(${created}::uuid[])`;
  }
  await sql`delete from driver_availability where driver_id = ${driverRowId}::uuid`;
  await sql`delete from drivers where id = ${driverRowId}::uuid`;
  await sql`delete from riders where id = ${riderId}::uuid`;
  await sql`delete from users where id in (${driverUserId}::uuid) or telegram_id = ${TG_RIDER}`;
  await restoreCityBaseline(sql, city);
  await sql.end();
});

describeIf("الطلبُ الأقربُ إلى السائقِ الواصلِ — LOAD-01 P4", () => {
  const DRIVER_LNG = 39.1729;
  const DRIVER_LAT = 21.5434;

  async function insertSearchingOrder(
    lng: number,
    lat: number,
    createdAgoSec: number,
    broadcastRound = 0,
  ): Promise<string> {
    const at = new Date(Date.now() - createdAgoSec * 1000);
    const [o] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, created_at, searching_since)
      values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${broadcastRound}, ${at}, ${at})
      returning id`;
    if (o === undefined) throw new Error("orders: لم يُدرَج الطلبُ — الاختبارُ لا معنى له");
    created.push(o.id);
    return o.id;
  }

  async function settingsOf(): Promise<{ radiusKm: number; maxRounds: number }> {
    const rows = await sql<{ key: string; value: string }[]>`
      select key, value from platform_settings
       where city_id = ${cityId} and key in ('search_radius_km', 'max_broadcast_rounds')`;
    const get = (k: string) => Number(JSON.parse(rows.find((r) => r.key === k)?.value ?? "null"));
    return { radiusKm: get("search_radius_km"), maxRounds: get("max_broadcast_rounds") };
  }

  it("الأقربُ إلى السائقِ يُختارُ لا الأقدمُ، والبثُّ يضمُّ السائقَ الواصلَ", async () => {
    // طلبٌ قديمٌ أبعدُ (~1كم) وطلبٌ جديدٌ ملاصقٌ للسائقِ (~15م): شوطُ المدينةِ يبدأُ بالقديمِ،
    // والمسارُ يبدأُ بالأقربِ.
    const far = await insertSearchingOrder(DRIVER_LNG + 0.009, DRIVER_LAT, 600);
    const near = await insertSearchingOrder(DRIVER_LNG + 0.0001, DRIVER_LAT + 0.0001, 5);
    const finder = nearDeps().finder;
    const { radiusKm, maxRounds } = await settingsOf();
    const found = await finder.findSearchingNearDriver?.({
      cityId,
      driverId: driverRowId,
      latitude: DRIVER_LAT,
      longitude: DRIVER_LNG,
      radiusKm,
      maxBroadcastRounds: maxRounds,
      limit: 1,
    });
    expect(found?.ok).toBe(true);
    if (!found?.ok) return;
    expect(found.value.map((o) => o.orderId)).toEqual([near as never]);

    const logs: { event: string; meta: Record<string, unknown> }[] = [];
    const report = await dispatchNearestToDriver(
      { cityId, driverId: driverRowId, latitude: DRIVER_LAT, longitude: DRIVER_LNG },
      { ...nearDeps(), log: (event, meta) => logs.push({ event, meta }) },
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.rebroadcast).toEqual([near as never]);
    const offers = await sql<{ driver_id: string; round: number }[]>`
      select driver_id::text, round from order_offers where order_id = ${near}::uuid`;
    expect(offers.map((o) => o.driver_id)).toContain(driverRowId);
    expect(logs.find((l) => l.event === "dispatch.nearby_broadcast")?.meta.includesDriver).toBe(
      true,
    );
    // القديمُ البعيدُ لم يُمسَّ: لا دورةَ فُتحت له.
    const [farRow] = await sql<{ broadcast_round: number }[]>`
      select broadcast_round from orders where id = ${far}::uuid`;
    expect(farRow?.broadcast_round).toBe(0);
  });

  it("طلبٌ فيه لهذا السائقِ عرضٌ حيٌّ لا يُعادُ — فلا تُهدَرُ دورةٌ على غيرِه", async () => {
    // الطلبُ الأقربُ من الحالةِ السابقةِ فيه الآن عرضٌ حيٌّ لهذا السائقِ.
    const { radiusKm, maxRounds } = await settingsOf();
    const found = await nearDeps().finder.findSearchingNearDriver?.({
      cityId,
      driverId: driverRowId,
      latitude: DRIVER_LAT,
      longitude: DRIVER_LNG,
      radiusKm,
      maxBroadcastRounds: maxRounds,
      limit: 10,
    });
    expect(found?.ok).toBe(true);
    if (!found?.ok) return;
    const pendingForDriver = await sql<{ order_id: string }[]>`
      select order_id::text from order_offers
       where driver_id = ${driverRowId}::uuid and status = 'pending' and expires_at > now()`;
    const excluded = new Set(pendingForDriver.map((r) => r.order_id));
    expect(excluded.size).toBeGreaterThan(0);
    for (const o of found.value) expect(excluded.has(o.orderId)).toBe(false);
  });

  it("المستنفدُ وما خارجَ نصفِ القطرِ لا يُختاران", async () => {
    const { radiusKm, maxRounds } = await settingsOf();
    const exhausted = await insertSearchingOrder(DRIVER_LNG, DRIVER_LAT, 10, maxRounds);
    // خارجَ نصفِ القطرِ: درجةُ عرضٍ ≈ 111كم ⇒ (نصفُ القطرِ + 5كم) / 111 درجةٍ شمالًا.
    const outside = await insertSearchingOrder(DRIVER_LNG, DRIVER_LAT + (radiusKm + 5) / 111, 10);
    const found = await nearDeps().finder.findSearchingNearDriver?.({
      cityId,
      driverId: driverRowId,
      latitude: DRIVER_LAT,
      longitude: DRIVER_LNG,
      radiusKm,
      maxBroadcastRounds: maxRounds,
      limit: 50,
    });
    expect(found?.ok).toBe(true);
    if (!found?.ok) return;
    const ids = found.value.map((o) => o.orderId as string);
    expect(ids).not.toContain(exhausted);
    expect(ids).not.toContain(outside);
  });
});
