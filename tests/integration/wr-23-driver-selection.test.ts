/**
 * الغرض: `WR-23` (ORDER §23) على PostgreSQL/PostGIS حقيقيٍّ — اختيارُ السائقينَ بالقربِ والتقييم
 *   بإعداداتِ المدينةِ المقروءةِ من `platform_settings` كما في الإنتاج (0.7 · 0.3 · دفعة 5 · 10 كم):
 *   ١ عدّةُ سائقين مؤهَّلين يتنافسون: الترتيبُ يجمعُ القربَ والتقييمَ، وتغييرُ الوزنَين في القاعدةِ
 *     يغيّرُ الترتيبَ بلا نشر، والدفعةُ أوّلُ خمسة.
 *   ٢ الاستبعادُ الفعليُّ بسببٍ مُسمّى: غيرُ الموثَّقِ والمحجوبِ وغيرُ المتوفّرِ وغيرُ المشتركِ وغيرُ
 *     المؤهَّلِ للخدمة ومدينةٌ أخرى والمستبعَدُ في الدورة والموقعُ القديمُ والموقعُ `ALERT`.
 *   ٣ المسارُ السريعُ (`findNearbyAvailableForDispatch`) لا يملأُ نافذتَه بموقعٍ قديمٍ ولا `ALERT`.
 *   ٤ السائقُ الجديدُ يُرتَّبُ بالتقييمِ المحايدِ (4.5) لا بمتوسّطٍ مختلَق، وعددُ تقييماتِه صفرٌ كما هو.
 *   ٥ من رُفِضَ عرضُه أو انتهى لا يقبلُ الطلب.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  evaluateCandidates,
  type MatchingParameters,
  selectBroadcastBatch,
} from "../../packages/domain/dispatch/entity.ts";
import { parseCitySettings, toMatchingParameters } from "../../packages/domain/policy/entity.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverCandidateRepository } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختيارُ السائقينَ WR-23 مُتخطّى: عيّن TEST_DATABASE_URL.");
}

const MARK = "wr23-selection";
const TG_BASE = 900_023_000;
/** نقطةُ الالتقاط في الطائف، ومسافاتٌ شمالَها بالدرجات (0.009° ≈ 1 كم). */
const PICKUP = { latitude: 21.27, longitude: 40.42 };
const at = (km: number) => ({
  latitude: PICKUP.latitude + km * 0.009,
  longitude: PICKUP.longitude,
});

interface Spec {
  readonly label: string;
  readonly km: number | null;
  readonly rating?: { readonly average: number; readonly count: number };
  readonly verified?: boolean;
  readonly blocked?: boolean;
  readonly available?: boolean;
  readonly subscribed?: boolean;
  readonly service?: "transport" | "delivery";
  readonly ageSeconds?: number;
  readonly quality?: "ACCEPT" | "WARNING" | "ALERT";
  readonly otherCity?: boolean;
}

describeIf("WR-23 — اختيارُ السائقينَ بالقربِ والتقييمِ على PostGIS", () => {
  let sql: Sql;
  let cityId = "";
  let otherCityId = "";
  let saved: { key: string; value: unknown }[] = [];
  const ids = new Map<string, string>();
  let tg = TG_BASE;

  async function purge(): Promise<void> {
    const users = sql`select id from users where full_name like ${`${MARK}%`}`;
    const drivers = sql`select id from drivers where user_id in (${users})`;
    const riders = sql`select id from riders where user_id in (${users})`;
    const orders = sql`select id from orders where rider_id in (${riders})`;
    await sql`delete from notification_outbox where order_id in (${orders})`;
    await sql`delete from audit_log where entity_id in (${orders})`;
    await sql`delete from order_offers where order_id in (${orders})`;
    await sql`delete from orders where id in (${orders})`;
    await sql`delete from audit_log where actor_user_id in (${users})`;
    await sql`delete from subscriptions where driver_id in (${drivers})`;
    await sql`delete from driver_capabilities where driver_id in (${drivers})`;
    await sql`delete from driver_availability where driver_id in (${drivers})`;
    await sql`delete from drivers where id in (${drivers})`;
    await sql`delete from riders where id in (${riders})`;
    await sql`delete from users where full_name like ${`${MARK}%`}`;
  }

  async function driver(spec: Spec): Promise<string> {
    const city = spec.otherCity === true ? otherCityId : cityId;
    tg += 1;
    const user = (
      await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, language_code, role, is_blocked)
        values (${city}::uuid, ${tg}, ${`${MARK}-${spec.label}`}, 'ar', 'driver', ${spec.blocked === true})
        returning id`
    )[0]?.id as string;
    const id = (
      await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, verification_status, rating_average, rating_count)
        values (${city}::uuid, ${user}::uuid,
                ${spec.verified === false ? "pending" : "verified"}::verification_status,
                ${spec.rating?.average ?? null}, ${spec.rating?.count ?? 0})
        returning id`
    )[0]?.id as string;
    if (spec.km !== null) {
      const p = at(spec.km);
      await sql`
        update drivers
           set last_location = st_setsrid(st_makepoint(${p.longitude}, ${p.latitude}), 4326)::geography,
               last_location_at = now() - make_interval(secs => ${spec.ageSeconds ?? 5}),
               last_location_recorded_at = now() - make_interval(secs => ${spec.ageSeconds ?? 5}),
               last_location_accuracy_m = 12,
               last_location_quality = ${spec.quality ?? "ACCEPT"}
         where id = ${id}::uuid`;
    }
    await sql`
      insert into driver_availability (driver_id, city_id, is_available)
      values (${id}::uuid, ${city}::uuid, ${spec.available !== false})`;
    await sql`
      insert into driver_capabilities (city_id, driver_id, service)
      values (${city}::uuid, ${id}::uuid, ${spec.service ?? "transport"}::service_type)`;
    if (spec.subscribed !== false) {
      await sql`
        insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
        values (${city}::uuid, ${id}::uuid, ${spec.service ?? "transport"}::subscription_plan,
                'active', now() + interval '20 days')`;
    }
    ids.set(spec.label, id);
    return id;
  }

  async function params(): Promise<MatchingParameters> {
    const rows = await createSettingsRepository(sql).findByCity(cityId as CityId);
    if (!rows.ok) throw new Error("تعذّرت قراءة الإعدادات");
    const parsed = parseCitySettings(cityId as CityId, rows.value);
    if (!parsed.ok) throw new Error(`إعداداتٌ معطوبة: ${JSON.stringify(parsed.error)}`);
    return toMatchingParameters(parsed.value);
  }

  async function setSetting(key: string, value: number): Promise<void> {
    await sql`
      update platform_settings set value = to_jsonb(${value}::numeric)
       where city_id = ${cityId}::uuid and key = ${key}`;
  }

  /** مرشّحو المدينةِ **من هذا الملفّ وحدَه** — المسارُ الكامل. */
  async function evaluate(excluded: readonly string[] = []) {
    const repo = createDriverCandidateRepository(sql);
    const all = await repo.findAvailableInCity(cityId as CityId);
    if (!all.ok) throw new Error("تعذّرت قراءة المرشّحين");
    const mine = new Set(ids.values());
    const candidates = all.value.filter((c) => mine.has(c.driverId));
    const p = await params();
    const evaluation = evaluateCandidates(
      candidates,
      {
        cityId: cityId as CityId,
        service: "transport",
        pickup: PICKUP as never,
        excludedDriverIds: excluded as DriverId[],
      },
      p,
      new Date(),
    );
    return { evaluation, params: p, batch: selectBroadcastBatch(evaluation, p) };
  }

  const label = (id: string) => [...ids.entries()].find(([, v]) => v === id)?.[0];

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    const cities = await sql<{ id: string; code: string }[]>`
      select id, code from cities where code in ('TIF', 'MED')`;
    cityId = cities.find((c) => c.code === "TIF")?.id as string;
    otherCityId = cities.find((c) => c.code === "MED")?.id as string;
    if (cityId === undefined || otherCityId === undefined)
      throw new Error("مدينتا TIF وMED غيرُ مبذورتَين");
    saved = await sql<{ key: string; value: unknown }[]>`
      select key, value from platform_settings
       where city_id = ${cityId}::uuid
         and key in ('match_weight_proximity', 'match_weight_rating', 'driver_location_max_age_seconds',
                     'broadcast_batch_size', 'search_radius_km', 'default_rating_for_new_driver',
                     'rating_min_count_for_trust', 'match_weight_preferred_area')`;
    await purge();
  });

  beforeEach(async () => {
    await purge();
    ids.clear();
    // قيمُ الإنتاجِ المقروءةُ في 2026-10-12 (قراءة فقط من `platform_settings`).
    await setSetting("match_weight_proximity", 0.7);
    await setSetting("match_weight_rating", 0.3);
    await setSetting("match_weight_preferred_area", 0);
    await setSetting("broadcast_batch_size", 5);
    await setSetting("search_radius_km", 10);
    await setSetting("driver_location_max_age_seconds", 600);
    await setSetting("default_rating_for_new_driver", 4.5);
    await setSetting("rating_min_count_for_trust", 3);
  });

  afterAll(async () => {
    if (sql === undefined) return;
    for (const row of saved) {
      await sql`update platform_settings set value = ${sql.json(row.value as never)}
                 where city_id = ${cityId}::uuid and key = ${row.key}`;
    }
    await purge();
    await sql.end();
  });

  it("١ — سبعةُ مؤهَّلين: الترتيبُ يجمعُ القربَ والتقييم، والدفعةُ أوّلُ خمسة، والأوزانُ من القاعدة", async () => {
    await driver({ label: "near-low", km: 1, rating: { average: 2.0, count: 20 } });
    await driver({ label: "near-high", km: 1.2, rating: { average: 5.0, count: 40 } });
    await driver({ label: "mid-high", km: 4, rating: { average: 4.9, count: 30 } });
    await driver({ label: "mid-new", km: 4 });
    await driver({ label: "far-high", km: 8, rating: { average: 5.0, count: 50 } });
    await driver({ label: "far-low", km: 9, rating: { average: 1.0, count: 10 } });
    await driver({ label: "edge", km: 9.8, rating: { average: 4.0, count: 5 } });

    const { evaluation, params: p, batch } = await evaluate();
    expect(p.weightProximity).toBeCloseTo(0.7);
    expect(p.weightRating).toBeCloseTo(0.3);
    expect(p.broadcastBatchSize).toBe(5);
    expect(evaluation.rejected).toEqual([]);
    const order = evaluation.eligible.map((c) => label(c.driverId));
    expect(order).toHaveLength(7);
    // التقييمُ يتقدّمُ بالقريبِ ذي التقييمِ العالي على الأقربِ ذي التقييمِ الضعيف.
    expect(order.indexOf("near-high")).toBeLessThan(order.indexOf("near-low"));
    // والقربُ بوزنِه الأكبرِ يُبقي البعيدَ ذا الخمسِ نجومٍ خلفَ المتوسّطِ ذي التقييمِ العالي.
    expect(order.indexOf("mid-high")).toBeLessThan(order.indexOf("far-high"));
    expect(order.indexOf("mid-new")).toBeLessThan(order.indexOf("far-high"));
    // الحسابُ اليدويُّ بالمعادلةِ نفسِها (القربُ خطّيٌّ في نصفِ القطرِ، والتقييمُ على خمس):
    expect(order).toEqual([
      "near-high",
      "near-low",
      "mid-high",
      "mid-new",
      "far-high",
      "edge",
      "far-low",
    ]);
    // النقاطُ تنازليّة.
    const scores = evaluation.eligible.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(batch.map((c) => label(c.driverId))).toEqual(order.slice(0, 5));

    // تغييرُ الوزنَين في القاعدةِ يقلبُ الترتيبَ بلا نشرِ شيفرة.
    await setSetting("match_weight_proximity", 0.1);
    await setSetting("match_weight_rating", 0.9);
    const flipped = (await evaluate()).evaluation.eligible.map((c) => label(c.driverId));
    expect(flipped.indexOf("far-high")).toBeLessThan(flipped.indexOf("mid-new"));
    expect(flipped.indexOf("near-low")).toBeGreaterThan(flipped.indexOf("edge"));
  });

  it("٢ — الاستبعادُ الفعليُّ بسببٍ مُسمّى، ولا يدخلُ الدفعةَ إلّا المؤهَّل", async () => {
    await driver({ label: "ok", km: 2, rating: { average: 4.0, count: 10 } });
    await driver({ label: "pending", km: 1, verified: false });
    await driver({ label: "blocked", km: 1, blocked: true });
    await driver({ label: "off", km: 1, available: false });
    await driver({ label: "unsubscribed", km: 1, subscribed: false });
    await driver({ label: "delivery-only", km: 1, service: "delivery" });
    await driver({ label: "stale", km: 1, ageSeconds: 900 });
    await driver({ label: "alert", km: 0.5, quality: "ALERT" });
    await driver({ label: "warning", km: 3, quality: "WARNING" });
    await driver({ label: "far", km: 14 });
    await driver({ label: "no-location", km: null });
    const excluded = await driver({ label: "excluded", km: 0.8 });

    const { evaluation, batch } = await evaluate([excluded]);
    const reasons = Object.fromEntries(
      evaluation.rejected.map((r) => [label(r.driverId), r.reason]),
    );
    expect(reasons).toEqual({
      pending: "NOT_VERIFIED",
      blocked: "BLOCKED",
      off: "NOT_AVAILABLE",
      unsubscribed: "NO_LIVE_SUBSCRIPTION",
      "delivery-only": "SERVICE_NOT_ENABLED",
      stale: "STALE_LOCATION",
      alert: "UNTRUSTED_LOCATION",
      far: "OUT_OF_RADIUS",
      "no-location": "NO_LOCATION",
      excluded: "EXCLUDED_THIS_ROUND",
    });
    // `WARNING` (دقّةٌ خشنةٌ أو تأخّر) موقعٌ صحيحٌ متدهوِّرٌ يبقى مؤهَّلًا.
    expect(batch.map((c) => label(c.driverId)).sort()).toEqual(["ok", "warning"]);
  });

  it("٢ب — سائقُ مدينةٍ أخرى لا يظهرُ في مرشّحي المدينة أصلًا", async () => {
    await driver({ label: "here", km: 2 });
    const there = await driver({ label: "there", km: 1, otherCity: true });
    const all = await createDriverCandidateRepository(sql).findAvailableInCity(cityId as CityId);
    if (!all.ok) throw new Error("تعذّرت القراءة");
    expect(all.value.some((c) => c.driverId === there)).toBe(false);
  });

  it("٣ — المسارُ السريعُ لا يملأُ نافذتَه بموقعٍ قديمٍ ولا ALERT، ويرتّبُ بالمسافة", async () => {
    await driver({ label: "alert-closest", km: 0.3, quality: "ALERT" });
    await driver({ label: "stale-close", km: 0.5, ageSeconds: 900 });
    await driver({ label: "a", km: 1 });
    await driver({ label: "b", km: 2, quality: "WARNING" });
    const nearby = await createDriverCandidateRepository(sql).findNearbyAvailableForDispatch({
      cityId: cityId as CityId,
      pickup: PICKUP as never,
      searchRadiusKm: 10 as never,
      driverLocationMaxAgeSeconds: 600,
      limit: 2,
      now: new Date(),
    });
    if (!nearby.ok) throw new Error("تعذّرت القراءة");
    const mine = new Set(ids.values());
    expect(nearby.value.filter((c) => mine.has(c.driverId)).map((c) => label(c.driverId))).toEqual([
      "a",
      "b",
    ]);
    expect(nearby.value.find((c) => label(c.driverId) === "b")?.locationQuality).toBe("WARNING");
  });

  it("٤ — الجديدُ يُرتَّبُ بالمحايدِ 4.5 وعددُه صفرٌ كما هو، ومن قلّ عددُه عن ثلاثةٍ لا يُرتَّبُ بمتوسّطِه", async () => {
    await driver({ label: "new", km: 3 });
    await driver({ label: "two-fives", km: 3, rating: { average: 5.0, count: 2 } });
    await driver({ label: "proven", km: 3, rating: { average: 4.8, count: 12 } });
    const { evaluation } = await evaluate();
    const byLabel = Object.fromEntries(evaluation.eligible.map((c) => [label(c.driverId), c]));
    expect(byLabel.new?.effectiveRating).toBeCloseTo(4.5);
    expect(byLabel.new?.ratingCount).toBe(0);
    expect(byLabel["two-fives"]?.effectiveRating).toBeCloseTo(4.5);
    expect(byLabel.proven?.effectiveRating).toBeCloseTo(4.8);
    const row = (
      await sql<{ rating_average: string | null; rating_count: number }[]>`
        select rating_average::text, rating_count from drivers where id = ${ids.get("new") as string}::uuid`
    )[0];
    // لا يُكتَبُ للجديدِ متوسّطٌ مختلَق: القاعدةُ تقولُ «لا تقييم»، والمحايدُ في المعادلةِ وحدَها.
    expect(row).toEqual({ rating_average: null, rating_count: 0 });
  });

  it("٥ — من رُفِضَ عرضُه أو انتهى لا يقبلُ الطلب", async () => {
    const rejected = await driver({ label: "rejected", km: 1 });
    const expired = await driver({ label: "expired", km: 1 });
    const riderUser = (
      await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, language_code, role)
        values (${cityId}::uuid, ${TG_BASE + 999}, ${`${MARK}-rider`}, 'ar', 'rider') returning id`
    )[0]?.id as string;
    const rider = (
      await sql<{ id: string }[]>`
        insert into riders (city_id, user_id) values (${cityId}::uuid, ${riderUser}::uuid) returning id`
    )[0]?.id as string;
    const orderId = (
      await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup)
        values (${cityId}::uuid, ${rider}::uuid, 'transport', 'searching',
                st_setsrid(st_makepoint(${PICKUP.longitude}, ${PICKUP.latitude}), 4326))
        returning id`
    )[0]?.id as string;
    await sql`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}::uuid, ${orderId}::uuid, ${rejected}::uuid, 1, 'rejected', now() + interval '30 seconds'),
             (${cityId}::uuid, ${orderId}::uuid, ${expired}::uuid, 1, 'pending', now() - interval '1 second')`;
    for (const id of [rejected, expired]) {
      const r = (
        await sql<
          { r: Record<string, unknown> }[]
        >`select claim_ride(${orderId}::uuid, ${id}::uuid) as r`
      )[0]?.r;
      expect(r?.ok).toBe(false);
    }
    const order = (
      await sql<{ status: string; assigned: string | null }[]>`
        select status::text, assigned_driver_id::text as assigned from orders where id = ${orderId}::uuid`
    )[0];
    expect(order).toEqual({ status: "searching", assigned: null });
  });
});
