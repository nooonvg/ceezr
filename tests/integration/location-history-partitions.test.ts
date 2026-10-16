/**
 * الغرض: `F7-03` — **أثرُ الموقعِ سجلٌّ ملحَقٌ مقسَّمٌ زمنيّاً** (`ADR-0074`،
 *   `CAP-009` ثُلُثُه الثالثُ، وشطرُ التقسيمِ من `CAP-010`). يُقاسُ ههنا أنَّ
 *   المسارَينِ كلَيهما يُلحِقانِ، وأنَّ المرفوضَ لا يُلحَقُ، وأنَّ الصفَّ يهبطُ في
 *   قِسمِ يومِه لا في شبكةِ الأمانِ، وأنَّ مُنشئَ الأقسامِ مُتماثِلٌ.
 *
 *   ## ولماذا PostgreSQL حقيقيٌّ لا مزدوجٌ
 *
 *   المقيسُ ههنا **توجيهُ المُقسِّمِ**: أيُّ جدولٍ ماديٍّ ابتلعَ الصفَّ. وهذا سلوكُ
 *   المحرّكِ نفسِه — لا شيءَ منه في شيفرتِنا كي يُحاكى. ومزدوجٌ في الذاكرةِ يُرجِعُ
 *   ما نُلقّنُه إيّاه فيَمرُّ أخضرَ ولو كانَ الجدولُ غيرَ مقسَّمٍ أصلاً.
 *
 *   ## وما لا يُدَّعى ههنا — قبلَ أن يُقرأَ الأخضرُ أكثرَ ممّا يقولُ
 *
 *   ١) **لا قياسَ أداءٍ**: لا يُدَّعى أنَّ التقسيمَ أسرعُ ولا أنَّ `CAP-009` رُفِعَ.
 *      الصفوفُ ههنا عشراتٌ، والمقيسُ **الصوابُ** لا الزمنُ (`ح-5`).
 *   ٢) **لا استبقاءَ**: لا حذفَ قِسمٍ ولا أرشفةَ — ذاكَ `F7-06`، وغيابُه يعني أنَّ
 *      `CAP-010` لم يُرفَع بهذا الملفِّ.
 *   ٣) **لا حجمَ إنتاجيٌّ**: عددُ الأقسامِ ههنا نافذةُ أيّامٍ لا نافذةُ سنةٍ، فلا
 *      يُقرأُ منه شيءٌ عن سلوكِ المُخطِّطِ حينَ تصيرُ الأقسامُ مئاتٍ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على `driver_location_history` أو على
 *   `ensure_driver_location_partitions` أو على أحدِ مسارَي الكتابةِ.
 * ملاحظات مستقبلية: يومَ يُنفَّذُ `F7-06` تُضافُ ههنا حالةُ «قِسمٌ انقضى عمرُه
 *   يُفصَلُ ولا يُفقَدُ صفٌّ حيٌّ»، ولا يُغيَّرُ ثابتٌ من ثوابتِ هذا الملفِّ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ensureLocationPartitions } from "../../packages/application/geo/ensure-location-partitions.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverLocationBatchPersistence } from "../../packages/infrastructure/geo/driver-location-batch-persistence.ts";
import { createDriverLocationPartitionMaintenance } from "../../packages/infrastructure/geo/driver-location-partition-maintenance.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** جدّة — والإزاحةُ تجعلُ كلَّ نبضةٍ موضعاً مميَّزاً يُقرأُ في الصفِّ. */
const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
const DEGREE_STEP = 0.0005;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let directory: ReturnType<typeof createDriverDirectory>;
let batch: ReturnType<typeof createDriverLocationBatchPersistence>;
let partitions: ReturnType<typeof createDriverLocationPartitionMaintenance>;

interface HistoryRow {
  readonly driver_id: string;
  readonly city_id: string;
  readonly source: string;
  readonly quality: string;
  readonly recorded_at: string;
  /** الجدولُ الماديُّ الذي ابتلعَ الصفَّ — وهوَ المقيسُ الأوّلُ في هذا الملفِّ. */
  readonly partition_name: string;
}

/**
 * صفوفُ الأثرِ **مع اسمِ قِسمِها**. و`tableoid::regclass` هوَ الشاهدُ الوحيدُ
 * الذي لا يُخدَعُ: قراءةٌ من الجدولِ الأبِ تُرجِعُ الصفَّ سواءٌ أَقُسِّمَ أم لا،
 * أمّا اسمُ الجدولِ المادّيِّ فلا يُنتِجُه إلّا مُقسِّمٌ عملَ فعلاً.
 */
async function historyOf(driverId: string): Promise<readonly HistoryRow[]> {
  return sql<HistoryRow[]>`
    select driver_id,
           city_id,
           source,
           quality,
           recorded_at,
           tableoid::regclass::text as partition_name
      from driver_location_history
     where driver_id = ${driverId}::uuid
     order by recorded_at asc, written_at asc
  `;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات تقسيمِ أثرِ الموقعِ مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدةٍ بها الهجرات مطبَّقة.",
  );
}

describeIf("F7-03 — أثرُ الموقعِ المقسَّمُ على PostgreSQL حقيقيٍّ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    directory = createDriverDirectory(sql);
    batch = createDriverLocationBatchPersistence(sql);
    partitions = createDriverLocationPartitionMaintenance(sql);
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table tracking_sessions, attendance_log, driver_availability,
                             driver_capabilities, subscriptions, drivers, users
                             restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    /**
     * الأثرُ يُخلى بـ`delete` لا بـ`truncate` ولا بـ`cascade` من `drivers`: لا
     * مفتاحَ أجنبيَّ يربطُه بقصدٍ (`ADR-0074`)، فحذفُ السائقِ **لا يمحو أثرَه** —
     * وذاكَ عقدٌ مقصودٌ لا سهوٌ، وتنظيفُ الاختبارِ لا يجوزُ أن يُخفيَه.
     */
    await sql`delete from driver_location_history`;
    await sql`truncate table tracking_sessions, attendance_log, driver_availability,
                             driver_capabilities, subscriptions, drivers, users
                             restart identity cascade`;
    // والتفعيلُ معَ القروباتِ في العبارةِ نفسِها (حاجزُ `check-test-city-activation`):
    // مدينةٌ تُفعَّلُ بلا قروباتِها تجعلُ النجاحَ معلّقاً على ترتيبِ التهيئةِ.
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  });

  async function seedDriver(chat: number): Promise<string> {
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${chat}::bigint, ${`سائق ${chat}`}, ${`+9665${chat}`}, 'ar', 'driver')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${userId}::uuid, 'verified', 'sedan', ${`س ${chat}`})
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    return driverId;
  }

  it("١) المسارُ المباشرُ يُلحِقُ أثراً واحداً بمصدرِه ومدينتِه", async () => {
    const driverId = await seedDriver(170_301);
    const recordedAtMs = Date.now();

    const written = await directory.updateLocation(driverId as DriverId, JEDDAH, {
      recordedAtMs,
      accuracyMeters: 12,
      verdict: "ACCEPT",
    });

    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.kind).toBe("accepted");

    const rows = await historyOf(driverId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source).toBe("direct");
    expect(rows[0]?.quality).toBe("ACCEPT");
    /**
     * المدينةُ تُقرأُ من الصفِّ المكتوبِ لا من نيّةِ المُنادي (القاعدةُ ٠.٤):
     * `updateLocation` لا تأخذُ مدينةً أصلاً، فمساواتُها ههنا تشهدُ أنَّ الفرعَ
     * أخذَها من `written` لا من مكانٍ آخرَ.
     */
    expect(rows[0]?.city_id).toBe(cityId);
  });

  it("٢) الإصلاحةُ التي ردَّها الحارسُ **لا يُلحَقُ أثرُها**", async () => {
    const driverId = await seedDriver(170_302);
    const newerMs = Date.now();

    const first = await directory.updateLocation(driverId as DriverId, JEDDAH, {
      recordedAtMs: newerMs,
      accuracyMeters: 10,
      verdict: "ACCEPT",
    });
    expect(first.ok && first.value.kind === "accepted").toBe(true);

    /**
     * أقدمُ بدقيقةٍ: الحارسُ الشرطيُّ في القاعدةِ يردُّها (`BUG-001`). والمقيسُ
     * أنَّ الأثرَ **تابعٌ للقبولِ** لا مستقلٌّ عنه — ولو أُلحِقَ لحملَ التاريخُ
     * موضعاً لم يصرْ قطُّ موضعَ السائقِ، وذاكَ تاريخٌ يُخالِفُ مصدرَه.
     */
    const stale = await directory.updateLocation(
      driverId as DriverId,
      { latitude: JEDDAH.latitude + DEGREE_STEP, longitude: JEDDAH.longitude },
      { recordedAtMs: newerMs - 60_000, accuracyMeters: 10, verdict: "ACCEPT" },
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value.kind).toBe("stale");

    const rows = await historyOf(driverId);
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0]?.recorded_at ?? 0).getTime()).toBe(newerMs);
  });

  it("٣) مسارُ الدفعةِ يُلحِقُ كلَّ نبضةٍ، و`appended` يَعُدُّ النبضاتِ لا السائقينَ (`D-38`)", async () => {
    const driverA = await seedDriver(170_303);
    const driverB = await seedDriver(170_304);
    const nowMs = Date.now();

    const report = await batch.persistBatch(cityId as CityId, [
      {
        cityId: cityId as CityId,
        driverId: driverA as DriverId,
        latitude: JEDDAH.latitude,
        longitude: JEDDAH.longitude,
        recordedAtMs: nowMs,
        observedAtMs: nowMs + 1_500,
        accuracyMeters: 8,
        verdict: "ACCEPT",
      },
      {
        cityId: cityId as CityId,
        driverId: driverB as DriverId,
        latitude: JEDDAH.latitude + DEGREE_STEP,
        longitude: JEDDAH.longitude,
        recordedAtMs: nowMs,
        observedAtMs: nowMs + 1_500,
        accuracyMeters: 9,
        verdict: "WARNING",
      },
    ]);

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.applied).toBe(2);
    /**
     * العقدُ بعدَ `D-38` (`ADR 0209`): الإلحاقُ من الدفعةِ كلِّها فـ`appended`
     * يَعُدُّ النبضاتِ — وههنا نبضةٌ لكلِّ سائقٍ فساوى `applied` صدفةَ الحالِ لا
     * عقداً. عقدُ الدفعةِ المتراكمةِ في الأسفلِ.
     */
    expect(report.value.appended).toBe(report.value.applied);

    const rowsA = await historyOf(driverA);
    const rowsB = await historyOf(driverB);
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]?.source).toBe("batch");
    expect(rowsB[0]?.quality).toBe("WARNING");
  });

  /**
   * `D-38` (`ADR 0209`): الدفعةُ المتراكمةُ — نبضاتٌ متعددةٌ للسائقِ الواحدِ —
   * تُلحِقُ في الأثرِ **كلَّها**، وصفُّ السائقِ يبقى على الأحدثِ وحدَه. هذا هوَ
   * الادعاءُ الذي كانَ مستحيلًا قبلَ هذا القرارِ: نقطةٌ واحدةٌ لكلِّ دورةِ إفراغٍ.
   */
  it("٣-ب) الدفعةُ المتراكمةُ: الأثرُ يحملُ النبضاتِ كلَّها والصفُّ على الأحدثِ (`D-38`)", async () => {
    const driverA = await seedDriver(170_311);
    const nowMs = Date.now();
    const pulses = [0, 1, 2, 3].map((step) => ({
      cityId: cityId as CityId,
      driverId: driverA as DriverId,
      latitude: JEDDAH.latitude + step * DEGREE_STEP,
      longitude: JEDDAH.longitude,
      recordedAtMs: nowMs - (3 - step) * 1_000,
      observedAtMs: nowMs + 1_500,
      accuracyMeters: 8,
      verdict: "ACCEPT" as const,
    }));

    const report = await batch.persistBatch(cityId as CityId, pulses);

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // صفُّ السائقِ واحدٌ، والأثرُ أربعٌ — `appended` يَعُدُّ النبضاتِ لا السائقينَ.
    expect(report.value.applied).toBe(1);
    expect(report.value.appended).toBe(4);

    const trace = await historyOf(driverA);
    expect(trace).toHaveLength(4);
    // بترتيبِ الطابعِ — كلُّ نبضةٍ في الأثرِ لا الأحدثُ وحدَه.
    expect(trace.map((row) => new Date(row.recorded_at).getTime())).toEqual(
      pulses.map((pulse) => pulse.recordedAtMs),
    );
    const newest = trace.at(-1);
    expect(newest?.source).toBe("batch");

    const stored = await sql<{ recorded: Date | null }[]>`
      select last_location_recorded_at as recorded from drivers where id = ${driverA}
    `;
    // الصفُّ على الأحدثِ وحدَه — الأثرُ لا يُحرِّكُ الموضعَ الحاليَّ.
    expect(stored[0]?.recorded?.getTime()).toBe(nowMs);
  });

  it("٤) الصفُّ يهبطُ في قِسمِ **يومِه**، لا في شبكةِ الأمانِ", async () => {
    const driverId = await seedDriver(170_305);
    const recordedAt = new Date();

    await directory.updateLocation(driverId as DriverId, JEDDAH, {
      recordedAtMs: recordedAt.getTime(),
      accuracyMeters: 11,
      verdict: "ACCEPT",
    });

    const rows = await historyOf(driverId);
    expect(rows).toHaveLength(1);

    /**
     * اسمُ القِسمِ يُحسَبُ من **يومِ القاعدةِ** لا من يومِ العمليةِ: منطقةُ
     * `Asia/Riyadh` في العاملِ ومنطقةُ الخادمِ قد تختلفانِ عندَ منتصفِ الليلِ،
     * وحسابُ الاسمِ في `JS` كانَ سيجعلُ الاختبارَ يسقطُ ساعةً كلَّ يومٍ لسببٍ
     * ليسَ من البندِ في شيءٍ.
     */
    const expected = await sql<{ name: string }[]>`
      select 'driver_location_history_' || to_char(${recordedAt}::timestamptz, 'YYYYMMDD') as name
    `;
    expect(rows[0]?.partition_name).toBe(expected[0]?.name ?? "");
    expect(rows[0]?.partition_name).not.toBe("driver_location_history_default");
  });

  it("٥) مُنشئُ الأقسامِ مُتماثِلٌ: شوطٌ ثانٍ لا يُنشئُ ولا يسقطُ", async () => {
    const first = await ensureLocationPartitions({ partitions });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await ensureLocationPartitions({ partitions });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    /**
     * الشوطُ الثاني **لا يُنشئُ شيئاً**: الهجرةُ نادت الدالّةَ فالنافذةُ قائمةٌ،
     * وشوطانِ متتاليانِ في اليومِ نفسِه يجدانِها. ولو أنشأ الثاني قِسماً لكانَ
     * الشرطُ يُقرأُ خطأً وكانَ إعادةُ التشغيلِ تُراكِمُ جداولَ.
     */
    expect(second.value.created).toHaveLength(0);
    expect(second.value.existing).toBeGreaterThan(0);
    expect(second.value.existing).toBe(first.value.existing + first.value.created.length);
  });

  it("٦) القِسمُ الافتراضيُّ موجودٌ **ويبقى فارغاً** في المسارِ السويِّ", async () => {
    const driverId = await seedDriver(170_306);
    await directory.updateLocation(driverId as DriverId, JEDDAH, {
      recordedAtMs: Date.now(),
      accuracyMeters: 7,
      verdict: "ACCEPT",
    });

    /** وجودُه شرطُ ألّا تسقطَ كتابةُ الموقعِ يومَ يغيبُ قِسمُ يومٍ. */
    const exists = await sql<{ present: boolean }[]>`
      select to_regclass('public.driver_location_history_default') is not null as present
    `;
    expect(exists[0]?.present).toBe(true);

    /**
     * وفراغُه شرطُ ألّا يكونَ وجودُه ستاراً: صفٌّ فيه يعني قِسماً غائباً ابتُلِعَ
     * أثرُه صامتاً — ولذلكَ تُرجِعُ الدالّةُ عددَه والمهمّةُ تُسجِّلُه `error`.
     */
    const report = await ensureLocationPartitions({ partitions });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.defaultRows).toBe(0);
  });
});
