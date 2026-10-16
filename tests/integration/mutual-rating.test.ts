import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = DATABASE_URL === undefined || DATABASE_URL.length === 0;

const PICKUP = { lng: 46.6753, lat: 24.7136 };
const DROPOFF = { lng: 46.6853, lat: 24.7236 };

describe.skipIf(skip)("F12-05 — التقييمُ المتبادلُ: منظورُ السائقِ في الملخَّصِ", () => {
  let sql: Sql;
  let cityId: string;
  let cityHandle: ActiveCityHandle | undefined;

  beforeAll(async () => {
    if (DATABASE_URL === undefined) return;
    sql = createSql({ connectionString: DATABASE_URL, max: 5 });
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate ratings, audit_log, orders, drivers, riders, users cascade`;

    if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
    if (sql !== undefined) await sql.end();
  });

  beforeEach(async () => {
    await sql`truncate ratings, audit_log, orders, drivers, riders, users cascade`;
  });

  async function seedUser(telegramId: string, role: string, fullName: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, ${role}, ${fullName}, '+966500000999')
      returning id`;
    if (row === undefined) throw new Error("تعذّر زرعُ المستخدمِ");
    return row.id;
  }

  async function seedDriver(telegramId: string, fullName: string): Promise<string> {
    const userId = await seedUser(telegramId, "driver", fullName);
    const [row] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number, rating_average, rating_count)
      values (${cityId}, ${userId}, 'verified'::verification_status, 'سيدان', 'ر س ب 9712', 4.5, 10)
      returning id`;
    if (row === undefined) throw new Error("تعذّر زرعُ السائقِ");
    return row.id;
  }

  async function seedRider(telegramId: string, fullName: string): Promise<string> {
    const userId = await seedUser(telegramId, "rider", fullName);
    const [row] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id, rating_average, rating_count)
      values (${cityId}, ${userId}, null, 0)
      returning id`;
    if (row === undefined) throw new Error("تعذّر زرعُ الراكبِ");
    return row.id;
  }

  async function seedCompletedOrder(riderId: string, driverId: string): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into orders (
        city_id, rider_id, assigned_driver_id, service, status, pickup, dropoff,
        pickup_label, dropoff_label, idempotency_key,
        matched_at, started_at, completed_at
      ) values (
        ${cityId}, ${riderId}, ${driverId}, 'transport'::service_type, 'completed'::order_status,
        st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
        st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
        'البلد', 'الروضة',
        ${`mutual-rating:${crypto.randomUUID()}`},
        now() - interval '55 minutes', now() - interval '50 minutes', now() - interval '40 minutes'
      ) returning id`;
    if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
    return row.id;
  }

  async function seedRatingWindow(): Promise<void> {
    await sql`
      insert into platform_settings (city_id, key, value, value_type, description_ar)
      values (${cityId}, 'rating_prompt_window_hours', '48', 'number', 'نافذة تقييم الرحلة بالساعات')
      on conflict (city_id, key) do update set value = excluded.value`;
  }

  // ─── ١) السائقُ يرى ملخَّصَ رحلتِه ───────────────────────────────────────

  it("السائقُ يرى ملخَّصَ رحلتِه وبطاقةَ الراكبِ — لا بطاقةَ سائقٍ", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      select completed_ride_summary(${"2001"}::bigint, ${orderId}::uuid) as result`;
    if (row === undefined) throw new Error("تعذّر قراءةُ الملخَّصِ");
    const summary = row.result;

    expect(summary.ok).toBe(true);
    expect(summary.driver).toBe(null);
    expect(summary.rider).not.toBe(null);
    expect((summary.rider as Record<string, unknown>).first_name).toBe("راكب");
    expect((summary.rider as Record<string, unknown>).rating_average).toBe(null);
    expect((summary.rating as Record<string, unknown>).direction).toBe("driver_to_rider");
    expect((summary.rating as Record<string, unknown>).can_rate).toBe(true);
    expect((summary.rating as Record<string, unknown>).already_rated).toBe(false);
  });

  // ─── ٢) الراكبُ يرى ملخَّصَه كما كان ───────────────────────────────────

  it("الراكبُ يرى بطاقةَ سائقِه — عقدُ F2-07 محفوظٌ", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      select completed_ride_summary(${"1001"}::bigint, ${orderId}::uuid) as result`;
    if (row === undefined) throw new Error("تعذّر قراءةُ الملخَّصِ");
    const summary = row.result;

    expect(summary.ok).toBe(true);
    expect(summary.driver).not.toBe(null);
    expect((summary.driver as Record<string, unknown>).first_name).toBe("سائق");
    expect((summary.driver as Record<string, unknown>).vehicle_type).toBe("سيدان");
    expect((summary.driver as Record<string, unknown>).plate_number).toBe("ر س ب 9712");
    expect(summary.rider).toBe(null);
    expect((summary.rating as Record<string, unknown>).direction).toBe("rider_to_driver");
    expect((summary.rating as Record<string, unknown>).can_rate).toBe(true);
  });

  // ─── ٣) كلُّ طرفٍ يقيِّمُ باتّجاهِه ────────────────────────────────────

  it("الراكبُ يقيِّمُ السائقَ والسائقُ يقيِّمُ الراكبَ — اتّجاهانِ مستقلّانِ", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    const [riderRating] = await sql<{ result: Record<string, unknown> }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${"1001"}::bigint, 5::smallint, null::text, null::text[]) as result`;
    if (riderRating === undefined) throw new Error("تعذّر قراءةُ تقييمِ الراكبِ");
    expect(riderRating.result.ok).toBe(true);
    expect(riderRating.result.direction).toBe("rider_to_driver");

    const [driverRating] = await sql<{ result: Record<string, unknown> }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${"2001"}::bigint, 4::smallint, null::text, null::text[]) as result`;
    if (driverRating === undefined) throw new Error("تعذّر قراءةُ تقييمِ السائقِ");
    expect(driverRating.result.ok).toBe(true);
    expect(driverRating.result.direction).toBe("driver_to_rider");
  });

  // ─── ٤) منعُ التكرارِ لكلِّ اتّجاهٍ ────────────────────────────────────

  it("تقييمٌ ثانٍ بكلِّ اتّجاهٍ ممنوعٌ — الراكبُ مرّتَينِ والسائقُ مرّتَينِ", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    await sql`select submit_rating_with_tags(${orderId}::uuid, ${"1001"}::bigint, 5::smallint, null::text, null::text[])`;
    const [riderDup] = await sql<{ result: Record<string, unknown> }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${"1001"}::bigint, 4::smallint, null::text, null::text[]) as result`;
    if (riderDup === undefined) throw new Error("تعذّر قراءةُ التقييمِ المكرَّرِ");
    expect(riderDup.result.ok).toBe(false);
    expect(riderDup.result.error).toBe("ALREADY_RATED");

    await sql`select submit_rating_with_tags(${orderId}::uuid, ${"2001"}::bigint, 4::smallint, null::text, null::text[])`;
    const [driverDup] = await sql<{ result: Record<string, unknown> }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${"2001"}::bigint, 5::smallint, null::text, null::text[]) as result`;
    if (driverDup === undefined) throw new Error("تعذّر قراءةُ التقييمِ المكرَّرِ");
    expect(driverDup.result.ok).toBe(false);
    expect(driverDup.result.error).toBe("ALREADY_RATED");
  });

  // ─── ٥) غيرُ الطرفِ لا يرى ولا يقيِّمُ ────────────────────────────────

  it("غيرُ الطرفِ لا يرى الملخَّصَ ولا يقيِّمُ", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    await seedRider("9999", "غريب");
    const [summaryRow] = await sql<{ result: Record<string, unknown> }[]>`
      select completed_ride_summary(${"9999"}::bigint, ${orderId}::uuid) as result`;
    if (summaryRow === undefined) throw new Error("تعذّر قراءةُ الملخَّصِ");
    expect(summaryRow.result.ok).toBe(false);
    expect(summaryRow.result.error).toBe("ORDER_NOT_FOUND");

    const [ratingRow] = await sql<{ result: Record<string, unknown> }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${"9999"}::bigint, 5::smallint, null::text, null::text[]) as result`;
    if (ratingRow === undefined) throw new Error("تعذّر قراءةُ التقييمِ");
    expect(ratingRow.result.ok).toBe(false);
    expect(ratingRow.result.error).toBe("RATER_NOT_PARTY_TO_ORDER");
  });

  // ─── ٦) تقييمُ السائقِ للراكبِ يحدّثُ riders.rating_average ────────────

  it("تقييمُ السائقِ للراكبِ يحدّثُ riders.rating_average وrating_count", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    await sql`select submit_rating_with_tags(${orderId}::uuid, ${"2001"}::bigint, 4::smallint, null::text, null::text[])`;

    const [rider] = await sql<{ rating_average: number; rating_count: number }[]>`
      select rating_average::float8, rating_count from riders where id = ${riderId}`;
    if (rider === undefined) throw new Error("تعذّر قراءةُ الراكبِ");
    expect(rider.rating_average).toBe(4);
    expect(rider.rating_count).toBe(1);
  });

  // ─── ٧) تقييمُ الراكبِ للسائقِ يحدّثُ drivers.rating_average ────────────

  it("تقييمُ الراكبِ للسائقِ يحدّثُ drivers.rating_average — لا riders", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    await sql`select submit_rating_with_tags(${orderId}::uuid, ${"1001"}::bigint, 5::smallint, null::text, null::text[])`;

    const [driver] = await sql<{ rating_average: number; rating_count: number }[]>`
      select rating_average::float8, rating_count from drivers where id = ${driverId}`;
    if (driver === undefined) throw new Error("تعذّر قراءةُ السائقِ");
    expect(driver.rating_average).toBe(5);
    expect(driver.rating_count).toBe(1);

    const [rider] = await sql<{ rating_average: number | null; rating_count: number }[]>`
      select rating_average::float8, rating_count from riders where id = ${riderId}`;
    if (rider === undefined) throw new Error("تعذّر قراءةُ الراكبِ");
    expect(rider.rating_average).toBe(null);
    expect(rider.rating_count).toBe(0);
  });

  // ─── ٨) السائقُ يرى can_rate: false بعدَ تقييمِه ───────────────────────

  it("بعدَ تقييمِ السائقِ يرى already_rated: true وcan_rate: false", async () => {
    await seedRatingWindow();
    const riderId = await seedRider("1001", "راكب واحد");
    const driverId = await seedDriver("2001", "سائق واحد");
    const orderId = await seedCompletedOrder(riderId, driverId);

    await sql`select submit_rating_with_tags(${orderId}::uuid, ${"2001"}::bigint, 4::smallint, null::text, null::text[])`;

    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      select completed_ride_summary(${"2001"}::bigint, ${orderId}::uuid) as result`;
    if (row === undefined) throw new Error("تعذّر قراءةُ الملخَّصِ");
    const summary = row.result;
    expect((summary.rating as Record<string, unknown>).already_rated).toBe(true);
    expect((summary.rating as Record<string, unknown>).can_rate).toBe(false);
    expect((summary.rating as Record<string, unknown>).direction).toBe("driver_to_rider");
  });
});
