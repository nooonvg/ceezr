/**
 * الغرض: `LOAD-01 · P4` (ب24) — انحدارُ لقطةِ الطلبِ من القارئِ في شوطِ إعادةِ البثّ.
 *   الشوطُ كانَ يعيدُ قراءةَ كلِّ طلبٍ فرديّاً بعدَ قراءةِ القارئِ نفسِه (رحلةٌ لكلِّ
 *   طلبٍ على الاتصالِ التسلسليّ المخصّصِ)، والقارئُ يقرأُ الجدولَ نفسَهُ — فصارَ يمرّرُ
 *   اللقطةَ. هذا الاختبارُ يُثبتُ العقدَ الذي يجعلُ التغييرَ آمنًا لا مجرّدَ أسرعَ:
 *
 *   (١) **التكافؤ**: لقطةُ القارئِ تطابقُ قراءةَ `findById` حقلًا بحقلٍ.
 *   (٢) **حاجزُ التقادمِ (اختبارُ الحاجزِ الصريحِ)**: اقرأِ الدفعةَ، ثمَّ غيّرِ الحالةَ من
 *       اتصالٍ مستقلّ، ثمَّ استأنفِ المعالجةَ باللقطةِ القديمةِ — الكتابةَ يرفضُها
 *       `open_offer_round` ذرّيًّا (مقارنةً-وتبديلًا) فلا جولةً غيرَ جائزةٍ ولا بثًّا
 *       مزدوجًا، ويُصنّفُ الطلبُ سباقًا (`raced`) لا فشلًا.
 *   (٣) **عدمُ القراءةِ الفرديةِ**: معَ اللقطةِ لا يُنادى `orders.findById` في الشوطِ.
 *
 * الحالة: اختبار تكامل فعلي — يحتاج TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: أي تعديلٍ على تمريرِ اللقطاتِ في مسارِ البثّ.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { broadcastOffers } from "../../packages/application/dispatch/broadcast-offers.ts";
import { redispatchSearchingOrders } from "../../packages/application/dispatch/redispatch-searching-orders.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import { createOrderRepository } from "../../packages/infrastructure/transport/order-adapters.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import { systemClock } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
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
/** اتصالٌ مستقلّ للطرفِ الآخرِ من اختبارِ الحاجزِ: تغييرُ الحالةِ أثناءَ معالجةِ اللقطةِ. */
let other: Sql;
let cityId: CityId;
let city: ActiveCityHandle | undefined;
let riderId: string;
let driverRowId: string;
let driver2RowId: string;
const created: string[] = [];
const TG_RIDER = 8_824_001;
const TG_DRIVER = 8_824_002;
const TG_DRIVER2 = 8_824_003;
const PICKUP = "SRID=4326;POINT(39.1728 21.5433)";

beforeAll(async () => {
  if (DATABASE_URL === "") return;
  sql = createSql({ connectionString: DATABASE_URL });
  other = createSql({ connectionString: DATABASE_URL, applicationName: "ceezr:test-barrier" });
  city = await ensureActiveCity(sql);
  cityId = city.cityId as CityId;

  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, role, telegram_id) values (${cityId}::uuid, 'rider', ${TG_RIDER})
      on conflict (telegram_id) do update set city_id = excluded.city_id returning id`;
  if (rider === undefined) throw new Error("users: لم يُدرَج الصفُّ");
  const [riderRow] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}::uuid, ${rider.id}::uuid)
      on conflict (user_id) do update set user_id = excluded.user_id returning id`;
  if (riderRow === undefined) throw new Error("riders: لم يُدرَج الصفُّ");
  riderId = riderRow.id;
  await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from orders where rider_id = ${riderId}::uuid`;
  driverRowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_DRIVER,
    name: "سائق لقطة الطلب",
  });
  driver2RowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_DRIVER2,
    name: "سائق الحاجز الثاني",
  });
  // اشتراكٌ حيٌّ فعلًّا: isSubscriptionLive تشترطُ نهايةَ فترةٍ مستقبليةً لغيرِ التجربةِ.
  for (const d of [driverRowId, driver2RowId]) {
    await sql`
      update subscriptions set current_period_end = now() + interval '30 days'
      where driver_id = ${d}::uuid and status in ('trialing', 'active')`;
  }
});

afterAll(async () => {
  if (DATABASE_URL === "") return;
  if (created.length) {
    await sql`delete from notification_outbox where order_id = any(${created}::uuid[])`;
    await sql`delete from order_offers where order_id = any(${created}::uuid[])`;
    await sql`delete from orders where id = any(${created}::uuid[])`;
  }
  for (const d of [driverRowId, driver2RowId]) {
    await sql`delete from driver_availability where driver_id = ${d}::uuid`;
    await sql`delete from drivers where id = ${d}::uuid`;
  }
  await sql`delete from riders where id = ${riderId}::uuid`;
  await sql`delete from users where telegram_id in (${TG_RIDER}, ${TG_DRIVER}, ${TG_DRIVER2})`;
  await restoreCityBaseline(sql, city);
  await sql.end();
  await other.end();
});

async function insertSearchingOrder(broadcastRound = 0): Promise<string> {
  const at = new Date(Date.now() - 60_000);
  const [o] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, created_at, searching_since)
    values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching', ${PICKUP}::geography,
            ${broadcastRound}, ${at}, ${at})
    returning id`;
  if (o === undefined) throw new Error("orders: لم يُدرَج الطلبُ");
  created.push(o.id);
  return o.id;
}

function deps(limit: number) {
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
    limit,
  };
}

describeIf("LOAD-01 P4 (ب24) — لقطةُ الطلبِ من القارئ", () => {
  it("التكافؤ: لقطةُ القارئِ تطابقُ قراءةَ findById حقلًا بحقلٍ", async () => {
    const orderId = await insertSearchingOrder();
    const found = await createSearchingOrderFinder(sql).findSearching(cityId, 50);
    if (!found.ok) throw new Error(found.error.detail);
    const ref = found.value.find((o) => o.orderId === orderId);
    if (ref?.order === undefined) throw new Error("اللقطةُ غيرُ موجودةٍ في نافذةِ القارئ");
    const fresh = await createOrderRepository(sql).findById(orderId as OrderId);
    if (!fresh.ok) throw new Error(fresh.error.detail);
    expect(fresh.value).not.toBeNull();
    if (fresh.value === null) return;
    expect(ref.order).toEqual(fresh.value);
  });

  it("الشوطُ لا يقرأُ الطلبَ فرديًّا معَ اللقطةِ (عدّادُ النداءات)", async () => {
    await insertSearchingOrder();
    let findByIdCalls = 0;
    const orders = createOrderRepository(sql);
    const watched = {
      orders: {
        findById: (id: string) => {
          findByIdCalls += 1;
          return orders.findById(id as OrderId);
        },
      },
    };
    const report = await redispatchSearchingOrders(cityId, {
      ...deps(10),
      broadcast: {
        orders: { ...deps(10).broadcast.orders, ...watched.orders },
        offers: deps(10).broadcast.offers,
        candidates: deps(10).broadcast.candidates,
        settings: deps(10).broadcast.settings,
        offerWriter: deps(10).broadcast.offerWriter,
        clock: systemClock,
      },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // الطلبُ داخلَ الشوطِ (مفحوصٌ أو مستنفدٌ) واللقطةُ كافيةٌ: صفرُ قراءاتٍ فرديةٍ.
    const examined = report.value.examined;
    expect(examined).toBeGreaterThan(0);
    expect(findByIdCalls).toBe(0);
  });

  it("حاجزُ التقادم: لقطةٌ قديمةٌ يُغيَّرُ حالُها منَ الاتصالِ الآخرِ تُرفضُ ذرّيًّا لا تفتحُ جولةً غيرَ جائزةٍ", async () => {
    const orderId = await insertSearchingOrder(0);
    // (١) قراءةُ اللقطةِ — كما يفعلُ الشوطُ في رأسِهِ.
    const found = await createSearchingOrderFinder(sql).findSearching(cityId, 50);
    if (!found.ok) throw new Error(found.error.detail);
    const ref = found.value.find((o) => o.orderId === orderId);
    if (ref === undefined) throw new Error("اللقطةُ غيرُ موجودةٍ");
    expect(ref.order?.status).toBe("searching");
    expect(ref.order?.broadcastRound).toBe(0);

    // (٢) الطرفُ الآخرُ منَ الحاجزِ: جولةٌ تُفتحُ للطلبِ منَ اتصالٍ مستقلّ (سبقَ شوطُنا)،
    // والسائقُ الثاني متاحٌ بموقعٍ بجوارِ نقطةِ الالتقاطِ فيبقى مؤهّلًا للجولةِ التي
    // يحاولُ شوطُنا المتقادمُ فتحَها — فيبلغَ القرارُ الكتابةَ ويرفضُهُ الحارسُ.
    await other`
      insert into driver_availability (city_id, driver_id, is_available)
      values (${cityId}::uuid, ${driver2RowId}::uuid, true)
      on conflict (driver_id) do update set is_available = true`;
    await other`
      update drivers set last_location = ${PICKUP}::geography, last_location_at = now(),
        last_location_quality = 'ACCEPT'
      where id = ${driver2RowId}::uuid`;
    const takeover = await other<{ ok: boolean }[]>`
      select (open_offer_round(${orderId}::uuid, 1, now() + interval '45 seconds',
        jsonb_build_array(jsonb_build_object('driver_id', ${driverRowId}::uuid, 'score', 1, 'distance_km', 0.1))))->>'ok' = 'true' as ok`;
    if (takeover[0]?.ok !== true) throw new Error("فتحُ الجولةِ الحاجزةِ فشلَ");

    // (٣) استئنافُ المعالجةِ باللقطةِ القديمةِ (جولتُها 0 كما قرأها القارئُ).
    const staleFinder = {
      findSearching: async () => ok([ref]),
    };
    const report = await redispatchSearchingOrders(cityId, {
      ...deps(10),
      finder: staleFinder,
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // الحكمُ منَ القاعدةِ: لا جولةً ثانيةً فوقَ الأولى، والطلبُ صُنّفَ سباقًا لا فشلًا.
    expect(report.value.rebroadcast).not.toContain(orderId as OrderId);
    expect(report.value.raced).toContain(orderId as OrderId);
    const rounds = await sql<{ round: number }[]>`
      select distinct round from order_offers where order_id = ${orderId}::uuid`;
    expect(rounds.map((r) => r.round)).toEqual([1]);
  });

  it("حاجزُ الإلغاءِ: لقطةٌ لطلبٍ أُلغيَ منَ الاتصالِ الآخرِ لا تُبَثّ", async () => {
    const orderId = await insertSearchingOrder(0);
    const found = await createSearchingOrderFinder(sql).findSearching(cityId, 50);
    if (!found.ok) throw new Error(found.error.detail);
    const ref = found.value.find((o) => o.orderId === orderId);
    if (ref === undefined) throw new Error("اللقطةُ غيرُ موجودةٍ");
    // الطرفُ الآخرُ: إلغاءٌ صريحٌ منَ اتصالٍ مستقلّ.
    await other`update orders set status = 'cancelled' where id = ${orderId}::uuid`;
    const report = await redispatchSearchingOrders(cityId, {
      ...deps(10),
      finder: { findSearching: async () => ok([ref]) },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.rebroadcast).not.toContain(orderId as OrderId);
    const offers = await sql<{ n: number }[]>`
      select count(*)::int n from order_offers where order_id = ${orderId}::uuid`;
    expect(offers[0]?.n ?? 0).toBe(0);
  });

  it("broadcastOffers بلقطةٍ: لا قراءةً فرديةً وقرارٌ كاملٌ كالمسارِ القائم", async () => {
    // سائقٌ متاحٌ موثَّقٌ بموقعٍ حيٍّ بجوارِ نقطةِ الالتقاطِ — شرطُ المطابقةِ مُستوفى.
    await sql`
      insert into driver_availability (city_id, driver_id, is_available)
      values (${cityId}::uuid, ${driverRowId}::uuid, true)
      on conflict (driver_id) do update set is_available = true`;
    await sql`
      update drivers set last_location = ${PICKUP}::geography, last_location_at = now(),
        last_location_quality = 'ACCEPT'
      where id = ${driverRowId}::uuid`;
    const orderId = await insertSearchingOrder(0);
    const fresh = await createOrderRepository(sql).findById(orderId as OrderId);
    if (!fresh.ok || fresh.value === null) throw new Error("الطلبُ غيرُ مقروءٍ");
    let findByIdCalls = 0;
    const orders = createOrderRepository(sql);
    const result = await broadcastOffers(
      { orderId: orderId as OrderId, ...(fresh.value !== null ? { order: fresh.value } : {}) },
      {
        orders: {
          findById: (id: string) => {
            findByIdCalls += 1;
            return orders.findById(id as OrderId);
          },
        },
        offers: createOfferRepository(sql),
        candidates: createDriverCandidateRepository(sql),
        settings: createSettingsRepository(sql),
        offerWriter: createOfferWriter(sql),
        clock: systemClock,
      },
    );
    expect(findByIdCalls).toBe(0);
    // سائقٌ مؤهّلٌ بجوارِ نقطةِ الالتقاطِ: قرارُ البثِّ يصدرُ كما في المسارِ القائم.
    if (!result.ok) throw new Error(`broadcastOffers رفض: ${JSON.stringify(result.error)}`);
    expect(result.ok).toBe(true);
  });
});
