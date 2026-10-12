/**
 * الغرض: قياسُ تجميعاتِ لوحةِ الإدارةِ على قاعدةٍ حقيقيّةٍ (`F7-08` · `CAP-011`) —
 *   وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ حاجزٌ ساكنٌ ولا قاعدةٌ مُزيَّفةٌ على قياسِه**:
 *     ــ أنَّ الشوطَ يكتبُ صفّاً **لكلِّ مدينةٍ**، وأنَّ مدينةً بلا نشاطٍ تُكتَبُ
 *        **أصفاراً مقيسةً** لا تُترَكُ بلا صفٍّ («لم تُقَسْ» ≠ «صفرٌ»).
 *     ــ أنَّ زمنَ القياسِ **من ساعةِ القاعدةِ** يُعادُ في الحمولةِ ويُقرأُ من
 *        الصفِّ نفسِه — لا يُصطَنَعُ في العاملِ ولا في البوابةِ.
 *     ــ أنَّ الشوطَ **مُعادُ التنفيذِ**: نداءٌ ثانٍ يُحدِّثُ في موضعِه فلا يذرُّ
 *        صفوفاً ولا يُخفِقُ على `admin_metric_snapshots_one_per_window`.
 *     ــ أنَّ العدَّاداتَ **تُقابَلُ بعَدٍّ مستقلٍّ** على الجداولِ الأصليّةِ، لا بما
 *        تقولُه اللقطةُ عن نفسِها.
 *     ــ أنَّ نافذةً غيرَ موجَبةٍ **تُرفَضُ في القاعدةِ** (`INVALID_WINDOW_HOURS`)
 *        لا في المُنادي وحدَه.
 *     ــ أنَّ اللوحةَ بلا لقطةٍ وبلا إذنٍ **تقولُ عدمَ الإتاحةِ** ولا تُعرَضُ
 *        أصفاراً تُقرَأُ هدوءاً.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (وظيفةُ `integration` على `postgis/postgis:17-3.5`)
 * الحاكم: docs/adr/0128-an-aggregate-without-its-age-is-a-lie.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا يُقاسُ أثرُ `RLS`**: الاتّصالُ بمالكِ القاعدةِ وهوَ يتخطّاه (سابقةُ
 *    `active-ride.test.ts`)؛ وسطحُ الصلاحياتِ مقيسٌ في
 *    `database-privilege-surface.test.ts`.
 * ــ **لا يُقاسُ عددُ الاستعلاماتِ ههنا**: يُقاسُ بقاعدةٍ مُزيَّفةٍ تُسجِّلُ نصَّ
 *    كلِّ استعلامٍ في `tests/unit/admin-overview-reading.test.ts` — وذاكَ قياسٌ
 *    أدقُّ من عَدٍّ على قاعدةٍ حقيقيّةٍ يخلطُه التجمُّعُ والتهيئةُ.
 * ــ **لا تُقاسُ الشاشةُ**: هذا ملفُّ قاعدةٍ، والعرضُ مقيسٌ في `tests/unit`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { adminOverviewReading, DAY_WINDOW_HOURS } from "../../apps/gateway/src/admin/queries.ts";
import { isMetricSnapshotRejection } from "../../packages/application/admin/metric-snapshot-ports.ts";
import { refreshMetricSnapshots } from "../../packages/application/admin/refresh-metric-snapshots.ts";
import { createMetricSnapshotRefreshPort } from "../../packages/infrastructure/admin/metric-snapshot-store.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** مُعرِّفُ تيليجرام موجبٌ عالٍ لا يُصادِفُ حساباً حقيقيّاً ولا ملفَّ اختبارٍ آخرَ. */
const RIDER_TELEGRAM = 991_708_001;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let orderId = "";

describeIf("لقطةُ مقاييسِ الإدارةِ على قاعدةٍ حقيقيّةٍ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;

    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'راكبُ قياسِ اللقطةِ',
              '+966500991708', 'ar', 'rider')
      returning id
    `;
    if (user === undefined) throw new Error("تعذّرَ بذرُ الراكبِ");
    riderUserId = user.id;

    const [rider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    if (rider === undefined) throw new Error("تعذّرَ بذرُ صفِّ الراكبِ");
    riderId = rider.id;

    const [order] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
      values (${cityId}, ${riderId}, 'transport', 'searching',
              st_point(39.1751, 21.5471)::geography, 'الحرم')
      returning id
    `;
    if (order === undefined) throw new Error("تعذّرَ بذرُ الطلبِ");
    orderId = order.id;
  });

  afterAll(async () => {
    if (orderId !== "") await sql`delete from orders where id = ${orderId}`;
    if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
    if (riderUserId !== "") await sql`delete from users where id = ${riderUserId}`;
    await restoreCityBaseline(sql, cityHandle);
    await sql.end();
  });

  it("الشوطُ يكتبُ صفّاً لكلِّ مدينةٍ — والساكنةُ **أصفاراً مقيسةً** لا بلا صفٍّ", async () => {
    const port = createMetricSnapshotRefreshPort(sql);
    const result = await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [counted] = await sql<{ cities: number; rows: number }[]>`
      select
        (select count(*) from cities)::int as cities,
        (select count(*) from admin_metric_snapshots
          where window_hours = ${DAY_WINDOW_HOURS}::integer)::int as rows
    `;
    expect(result.value.citiesWritten).toBe(counted?.cities ?? -1);
    expect(counted?.rows).toBe(counted?.cities);

    // مدينةٌ بلا نشاطٍ: صفٌّ موجودٌ بأصفارٍ — لا غيابَ يُقرأُ «لم تُقَسْ».
    const [quiet] = await sql<{ searching_orders: number; open_tickets: number }[]>`
      select s.searching_orders, s.open_tickets
        from admin_metric_snapshots s
       where s.window_hours = ${DAY_WINDOW_HOURS}::integer
         and s.city_id <> ${cityId}
       limit 1
    `;
    expect(quiet).not.toBeUndefined();
    expect(quiet?.searching_orders).toBe(0);
  });

  it("زمنُ القياسِ **من ساعةِ القاعدةِ** وهوَ عينُ ما في الصفِّ", async () => {
    const port = createMetricSnapshotRefreshPort(sql);
    const result = await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // القراءةُ نصّاً مُنسَقاً في القاعدةِ لا زينةٌ: المُشغِّلُ يُرجِعُ `timestamptz`
    // كائنَ `Date`، و`String(Date)` يُسقِطُ الملّيّاتِ فيرتدُّ زمنُ القياسِ
    // مقروءاً على حدِّ الثانيةِ — فتُقارَنُ لحظةٌ مقطوعةٌ بلحظةٍ دقيقةٍ
    // فيخفِقُ القياسُ والنِّظامُ سليمٌ. وكشفَ ذاكَ **حكمُ CI** لا التشغيلُ
    // المحلّيُّ (لا قاعدةَ حقيقيّةَ في صندوقِ التنفيذِ)، والتصحيحُ **رفعٌ للدقّةِ
    // لا تخفيفٌ للشرطِ**: المُدَّعى أنَّ الزمنَ المنشورَ عَينُ المخزونِ بالملّيّةِ.
    const [row] = await sql<{ computed_at: string }[]>`
      select to_char(computed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
               as computed_at
        from admin_metric_snapshots
       where city_id = ${cityId} and window_hours = ${DAY_WINDOW_HOURS}::integer
    `;
    expect(row).not.toBeUndefined();
    expect(new Date(String(row?.computed_at)).getTime()).toBe(
      new Date(result.value.computedAt).getTime(),
    );
  });

  it("العدَّاداتُ تُقابَلُ **بعَدٍّ مستقلٍّ** على الجداولِ الأصليّةِ", async () => {
    const port = createMetricSnapshotRefreshPort(sql);
    await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });

    const [truth] = await sql<{ searching: number }[]>`
      select count(*)::int as searching
        from orders where city_id = ${cityId} and status = 'searching'
    `;
    const [snapshot] = await sql<{ searching_orders: number }[]>`
      select searching_orders from admin_metric_snapshots
       where city_id = ${cityId} and window_hours = ${DAY_WINDOW_HOURS}::integer
    `;
    expect(snapshot?.searching_orders).toBe(truth?.searching);
    expect(truth?.searching).toBeGreaterThan(0);
  });

  it("`WR-06` — زمنُ مطابقةِ المجدولِ يُقاسُ من بدءِ البحثِ لا من الإنشاءِ قبلَ يومين", async () => {
    const [scheduled] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, pickup_label,
                          created_at, searching_since, matched_at)
      values (${cityId}, ${riderId}, 'transport', 'cancelled',
              st_point(39.1751, 21.5471)::geography, 'الحرم',
              now() - interval '2 days', now() - interval '90 seconds', now() - interval '30 seconds')
      returning id
    `;
    if (scheduled === undefined) throw new Error("تعذّرَ بذرُ الطلبِ المجدول");
    try {
      const port = createMetricSnapshotRefreshPort(sql);
      await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });
      const [snapshot] = await sql<{ match_seconds_sum: string; match_seconds_count: number }[]>`
        select match_seconds_sum::text, match_seconds_count from admin_metric_snapshots
         where city_id = ${cityId} and window_hours = ${DAY_WINDOW_HOURS}::integer
      `;
      const [own] = await sql<{ seconds: number }[]>`
        select extract(epoch from (matched_at - coalesce(searching_since, created_at)))::float8 as seconds
          from orders where id = ${scheduled.id}
      `;
      expect(own?.seconds).toBeCloseTo(60, 0);
      expect(snapshot?.match_seconds_count).toBeGreaterThan(0);
      // لو قيسَ من `created_at` لزادَ المجموعُ يومين (172800 ثانية) بهذا الطلبِ وحدَه.
      expect(Number(snapshot?.match_seconds_sum)).toBeLessThan(86_400);
    } finally {
      await sql`delete from orders where id = ${scheduled.id}`;
    }
  });

  it("الشوطُ **مُعادُ التنفيذِ**: نداءٌ ثانٍ يُحدِّثُ في موضعِه ولا يذرُّ صفوفاً", async () => {
    const port = createMetricSnapshotRefreshPort(sql);
    const first = await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });
    const second = await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const [counted] = await sql<{ cities: number; rows: number }[]>`
      select
        (select count(*) from cities)::int as cities,
        (select count(*) from admin_metric_snapshots
          where window_hours = ${DAY_WINDOW_HOURS}::integer)::int as rows
    `;
    expect(counted?.rows).toBe(counted?.cities);
    expect(new Date(second.value.computedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.value.computedAt).getTime(),
    );
  });

  it("نافذةٌ غيرُ موجَبةٍ تُرفَضُ **في القاعدةِ** لا في المُنادي وحدَه", async () => {
    let message = "";
    try {
      await sql`select refresh_admin_metric_snapshots(0::integer)`;
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).toContain("INVALID_WINDOW_HOURS");
  });

  it("المحوّلُ يُصنِّفُ رفضَ القاعدةِ رفضاً لا عطبَ مخزنٍ", async () => {
    const port = createMetricSnapshotRefreshPort(sql);
    const result = await port.refresh(-3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(isMetricSnapshotRejection(result.error)).toBe(true);
  });

  it("قراءةُ اللوحةِ تُعيدُ اللقطةَ **بوَسْمِها** ومجموعُها يُطابِقُ الصفوفَ", async () => {
    const port = createMetricSnapshotRefreshPort(sql);
    await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });

    const reading = await adminOverviewReading(sql, DAY_WINDOW_HOURS, new Date());
    expect(reading.stamp.source).toBe("snapshot");
    expect(reading.stamp.computedAt).not.toBeNull();
    expect(reading.stamp.citiesMeasured).toBe(reading.stamp.citiesExpected);
    expect(reading.stamp.citiesExpected).toBeGreaterThan(0);

    const [truth] = await sql<{ searching: number }[]>`
      select coalesce(sum(searching_orders), 0)::int as searching
        from admin_metric_snapshots where window_hours = ${DAY_WINDOW_HOURS}::integer
    `;
    expect(reading.counters.searchingOrders).toBe(truth?.searching ?? -1);
  });

  it("بلا لقطةٍ وبلا إذنٍ **تُقالُ عدمُ الإتاحةِ** ولا تُعرَضُ أصفاراً هدوءاً", async () => {
    await sql`delete from admin_metric_snapshots where window_hours = ${DAY_WINDOW_HOURS}::integer`;

    const reading = await adminOverviewReading(sql, DAY_WINDOW_HOURS, new Date());
    expect(reading.stamp.computedAt).toBeNull();
    expect(reading.stamp.ageSeconds).toBeNull();
    expect(reading.stamp.isStale).toBe(true);
    expect(reading.stamp.citiesMeasured).toBe(0);
    expect(reading.stamp.source).toBe("snapshot");
    for (const city of reading.cities) {
      expect(city.liveOrders).toBeNull();
    }

    // يُعادُ الشوطُ كي لا يُورَّثَ فراغٌ لمن بعدَه في الجولةِ.
    const port = createMetricSnapshotRefreshPort(sql);
    const restored = await refreshMetricSnapshots({ port }, { windowHours: DAY_WINDOW_HOURS });
    expect(restored.ok).toBe(true);
  });

  it("إعدادا الصدقِ مبذورانِ لكلِّ مدينةٍ: عتبةُ تقادُمٍ وإذنُ سقوطٍ", async () => {
    const [settings] = await sql<{ stale: number; fallback: number; cities: number }[]>`
      select
        (select count(*) from platform_settings
          where key = 'admin_metrics_stale_after_seconds')::int as stale,
        (select count(*) from platform_settings
          where key = 'admin_overview_live_fallback_enabled')::int as fallback,
        (select count(*) from cities)::int as cities
    `;
    expect(settings?.stale).toBe(settings?.cities);
    expect(settings?.fallback).toBe(settings?.cities);

    const [flag] = await sql<{ value: boolean }[]>`
      select (value)::boolean as value from platform_settings
       where key = 'admin_overview_live_fallback_enabled' and city_id = ${cityId}
    `;
    expect(flag?.value).toBe(false);
  });
});
