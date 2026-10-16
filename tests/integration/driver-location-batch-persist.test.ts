/**
 * الغرض: `F4-02` و`CAP-009` — إثبات أنَّ **الاستمرارَ المجمَّعَ** لمواقعِ السائقينَ
 *   يُطبَّقُ في دالّةٍ ذرّيّةٍ واحدةٍ على قاعدةِ PostgreSQL حقيقيّةٍ، وأنَّ حارسَ
 *   التسلسلِ (`BUG-001`) لم يُثقَبْ بالطريقِ الجديدِ.
 *
 *   والادّعاءاتُ المُختبَرةُ أربعةٌ لا يُقاسُ واحدٌ منها بقراءةِ الشيفرةِ ولا بمزدوجٍ:
 *   (١) أنَّ **ترتيبَ الدفعةِ لا يحكمُ**: دفعةٌ فيها الأقدمُ بعدَ الأحدثِ تُطبِّقُ
 *       الأحدثَ وحدَه. ولو ضاعَت `distinct on … order by … desc` من الدالّةِ لكتبَ
 *       الأقدمُ آخراً فتراجعَ الموضعُ — وهوَ `BUG-001` بعينِه في مسارٍ ثانٍ.
 *   (٢) أنَّ الأقدمَ من الصفِّ المخزَّنِ يُرجَعُ `stale` **جواباً مُصنَّفاً** لا صمتاً،
 *       وأنَّ الصفَّ لا يتراجعُ؛ وأنَّ المتساويَ يمرُّ كما في `ADR 0053` §٦.
 *   (٣) أنَّ المدينةَ تُقيِّدُ: معرِّفٌ لا صفَّ له في المدينةِ المُمرَّرةِ يُحسَبُ
 *       `missing` ولا يُكتَبُ — ولو سقطَ `d.city_id = p_city_id` لكتبَ عاملُ مدينةٍ
 *       موقعَ سائقِ مدينةٍ أخرى.
 *   (٤) أنَّ الأصنافَ الثلاثةَ (`applied` · `stale` · `missing`) تُحصى في دفعةٍ
 *       مختلطةٍ واحدةٍ حصراً صحيحاً — فالمُشغِّلُ يقرأُ منها صحّةَ الإفراغِ.
 *   (٥) `D-38` (`ADR 0209`): الأثرُ يُلحِقُ **كلَّ نبضةٍ في الدفعةِ** لسائقٍ قائمٍ في
 *       المدينةِ — نبضاتُ السائقِ الواحدِ كلُّها تبلغُ الأثرَ، وصفُّ السائقِ على
 *       الأحدثِ، والنبضةُ الأقدمُ من الصفِّ المخزَّنِ تُلحَقُ أثراً وتُحسَبُ `stale`
 *       للموضعِ لا للأثرِ.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: حصرُ صفوفِ الأثرِ المُدرَجةِ صارَ ههنا معَ `D-38` (`ADR 0209`).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { HotLocationFix } from "../../packages/application/geo/driver-location-hot-state.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverLocationBatchPersistence } from "../../packages/infrastructure/geo/driver-location-batch-persistence.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * طوابعُ ثابتةٌ في ماضٍ بعيدٍ عن «الآنَ»: لو حكمَ الحارسُ بساعةِ الجهازِ لسقطَ
 * الملفُّ كلُّه. وهيَ بعدَ ٢٠٢٠ لأنَّ قيدَ سلامةِ العمودِ يرفضُ الطوابعَ الفاسدةَ.
 */
const T1 = Date.UTC(2024, 0, 1, 0, 0, 10);
const T2 = Date.UTC(2024, 0, 1, 0, 0, 20);
const T3 = Date.UTC(2024, 0, 1, 0, 0, 30);

const AT_A = { latitude: 21.5471, longitude: 39.1751 } as const;
const AT_B = { latitude: 21.6, longitude: 39.2 } as const;

let sql: Sql;
let cityId: CityId;
let otherCityId: CityId;
let driverId: DriverId;

const fixOf = (
  driver: DriverId,
  recordedAtMs: number,
  at: { latitude: number; longitude: number },
  city: CityId = cityId,
): HotLocationFix => ({
  cityId: city,
  driverId: driver,
  latitude: at.latitude,
  longitude: at.longitude,
  recordedAtMs,
  // لحظةُ قبولِ الخادمِ (F4-05) مُزاحةٌ عن طابعِ الجهازِ عمداً: مساواتُهما
  // تُخفي خلطَ العمودَينِ في الدالّةِ الذرّيّةِ.
  observedAtMs: recordedAtMs + 1_500,
  accuracyMeters: 11,
  verdict: "ACCEPT",
});

interface Stored {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly recordedAtMs: number | null;
  /** `last_location_at` — زمنُ قبولِ الخادمِ «متى علِمنا» (F4-05). */
  readonly acceptedAtMs: number | null;
  readonly accuracy: number | null;
  readonly quality: string | null;
}

async function stored(driver: DriverId = driverId): Promise<Stored> {
  const rows = await sql<
    {
      lat: number | null;
      lng: number | null;
      recorded: Date | null;
      accepted: Date | null;
      accuracy: number | null;
      quality: string | null;
    }[]
  >`
    select st_y(last_location::geometry) as lat,
           st_x(last_location::geometry) as lng,
           last_location_recorded_at as recorded,
           last_location_at as accepted,
           last_location_accuracy_m as accuracy,
           last_location_quality as quality
      from drivers where id = ${driver}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لم يُقرأ السائق");
  return {
    lat: row.lat,
    lng: row.lng,
    recordedAtMs: row.recorded === null ? null : row.recorded.getTime(),
    acceptedAtMs: row.accepted === null ? null : row.accepted.getTime(),
    accuracy: row.accuracy,
    quality: row.quality,
  };
}

/** صفوفُ الأثرِ لسائقٍ — بترتيبِ الطابعِ، للتحققِ من إلحاقِ كلِّ نبضةٍ (`D-38`). */
async function historyOf(
  driver: DriverId = driverId,
): Promise<{ recordedAtMs: number; accuracy: number | null; quality: string; source: string }[]> {
  const rows = await sql<
    { recorded: Date; accuracy: number | null; quality: string; source: string }[]
  >`
    select recorded_at as recorded, accuracy_m as accuracy, quality, source
      from driver_location_history
     where driver_id = ${driver}
     order by recorded_at asc
  `;
  return rows.map((row) => ({
    recordedAtMs: row.recorded.getTime(),
    accuracy: row.accuracy,
    quality: row.quality,
    source: row.source,
  }));
}

/** سائقٌ إضافيٌّ في مدينةٍ مُعيَّنةٍ — للدفعاتِ المختلطةِ وحصرِ المدينةِ. */
async function seedDriver(telegramId: number, city: CityId = cityId): Promise<DriverId> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${city}, ${telegramId}::bigint, 'سائق الدفعة',
            ${`+96650${String(telegramId).slice(-7)}`}, 'driver'::user_role, 'ar')
    returning id
  `;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${city}, ${userId}, 'verified'::verification_status)
    returning id
  `;
  const created = drivers[0]?.id;
  if (created === undefined) throw new Error("تعذّر إنشاء السائق");
  return created as DriverId;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("الاستمرارُ المجمَّعُ لموقعِ السائقِ على قاعدةٍ حقيقيّةٍ — F4-02 · CAP-009", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string; code: string }[]>`
      select id, code from cities order by code
    `;
    const jed = cities.find((row) => row.code === "JED")?.id;
    const other = cities.find((row) => row.code !== "JED")?.id;
    if (jed === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    if (other === undefined) throw new Error("مدينةٌ ثانيةٌ مطلوبةٌ لإثباتِ حصرِ المدينةِ");
    cityId = jed as CityId;
    otherCityId = other as CityId;
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    driverId = await seedDriver(811_201);
  });

  /**
   * الحالةُ الأمُّ: الدفعةُ **مقلوبةُ الترتيبِ**. لو أُخِذَ آخرُ عنصرٍ — أو أُدرِجَ
   * العنصرانِ صفّاً صفّاً بلا تنقيةٍ — لاستقرَّ الأقدمُ فتراجعَ الموضعُ.
   */
  it("١ — الأقدمُ بعدَ الأحدثِ في الدفعةِ نفسِها: يُطبَّقُ الأحدثُ وحدَه", async () => {
    const persistence = createDriverLocationBatchPersistence(sql);

    const report = await persistence.persistBatch(cityId, [
      fixOf(driverId, T2, AT_B),
      fixOf(driverId, T1, AT_A),
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // سائقٌ واحدٌ في الدفعةِ فصفُّ السائقِ واحدٌ (`applied`) — والأثرُ يحملُ
    // النبضتَينِ كلتيهما (`D-38`): التنقيةُ للصفِّ لا للأثرِ.
    expect(report.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 2 });

    const row = await stored();
    expect(row.recordedAtMs).toBe(T2);
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
    expect(row.lng).toBeCloseTo(AT_B.longitude, 5);
    expect(row.accuracy).toBeCloseTo(11, 5);
    expect(row.quality).toBe("ACCEPT");
  });

  /** والترتيبُ الطبيعيُّ يُعطي النتيجةَ نفسَها: الحكمُ للطابعِ لا للموضعِ في المصفوفةِ. */
  it("٢ — الترتيبُ الطبيعيُّ يُعطي ما يُعطيه المقلوبُ حرفاً", async () => {
    const persistence = createDriverLocationBatchPersistence(sql);

    const report = await persistence.persistBatch(cityId, [
      fixOf(driverId, T1, AT_A),
      fixOf(driverId, T2, AT_B),
    ]);
    expect(report.ok && report.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 2 });

    const row = await stored();
    expect(row.recordedAtMs).toBe(T2);
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
    // والأثرُ لا يبالي بترتيبِ الورودِ: النبضتانِ كلتاهما فيهِ (`D-38`).
    const trace = await historyOf();
    expect(trace.map((entry) => entry.recordedAtMs)).toEqual([T1, T2]);
    expect(trace.every((entry) => entry.source === "batch")).toBe(true);
  });

  /**
   * الحارسُ نفسُه في الطريقِ الجديدِ: صفٌّ مخزَّنٌ أحدثُ من الدفعةِ لا يتراجعُ،
   * والرفضُ **جوابٌ مُصنَّفٌ** (`stale`) يقرؤه المُشغِّلُ لا صمتٌ يُقرأُ نجاحاً.
   */
  it("٣ — الأقدمُ من الصفِّ المخزَّنِ: `stale` والصفُّ لا يتراجعُ", async () => {
    const directory = createDriverDirectory(sql);
    const seeded = await directory.updateLocation(driverId, AT_B, {
      recordedAtMs: T3,
      accuracyMeters: 9,
      verdict: "ACCEPT",
    });
    expect(seeded.ok && seeded.value.kind).toBe("accepted");

    const persistence = createDriverLocationBatchPersistence(sql);
    const report = await persistence.persistBatch(cityId, [fixOf(driverId, T1, AT_A)]);
    // `stale` حكمُ **صفِّ السائقِ** لا حكمَ الأثرِ: النبضةُ قُبِلَت عندَ الاستقبالِ
    // فتُلحَقُ أثراً، والصفُّ لا يتراجعُ (`D-38` · `ADR 0209`).
    expect(report.ok && report.value).toEqual({ applied: 0, stale: 1, missing: 0, appended: 1 });

    const row = await stored();
    expect(row.recordedAtMs).toBe(T3);
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
    expect(row.accuracy).toBeCloseTo(9, 5);

    // والمتساويُ يمرُّ: تضييقُ المُسنَدِ إلى `<` كانَ سيُخالِفُ حارسَ `F4-01` حرفاً.
    const equal = await persistence.persistBatch(cityId, [fixOf(driverId, T3, AT_A)]);
    expect(equal.ok && equal.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 1 });
    expect((await stored()).lat).toBeCloseTo(AT_A.latitude, 5);
  });

  /**
   * حصرُ المدينةِ: الدالّةُ تأخذُ المدينةَ صريحةً ولا تستنبطُها من الصفِّ، فسائقُ
   * مدينةٍ أخرى **لا يُكتَبُ** ويُحسَبُ `missing` — وذلك يمنعُ عاملَ مدينةٍ من
   * الكتابةِ خارجَ نطاقِه لو وصلَته إصلاحةٌ في غيرِ مفتاحِها.
   */
  it("٤ — سائقٌ خارجَ المدينةِ المُمرَّرةِ: `missing` ولا يُكتَبُ صفُّه", async () => {
    const stranger = await seedDriver(811_202, otherCityId);
    const persistence = createDriverLocationBatchPersistence(sql);

    const report = await persistence.persistBatch(cityId, [fixOf(stranger, T2, AT_B, otherCityId)]);
    expect(report.ok && report.value).toEqual({ applied: 0, stale: 0, missing: 1, appended: 0 });

    const row = await stored(stranger);
    expect(row.recordedAtMs).toBeNull();
    expect(row.lat).toBeNull();

    // ونفسُ الإصلاحةِ بمدينتِها الصحيحةِ تُكتَبُ: الرفضُ من الحصرِ لا من عطلٍ.
    const inCity = await persistence.persistBatch(otherCityId, [
      fixOf(stranger, T2, AT_B, otherCityId),
    ]);
    expect(inCity.ok && inCity.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 1 });
    expect((await stored(stranger)).recordedAtMs).toBe(T2);
  });

  /**
   * دفعةٌ مختلطةٌ في رحلةٍ واحدةٍ: هذا هوَ شكلُ الإفراغِ الحقيقيِّ. والحصرُ
   * الثلاثيُّ يُقرأُ في السجلِّ فيُميَّزُ الإفراغُ السويُّ من المعطوبِ.
   */
  it("٥ — دفعةٌ مختلطةٌ: مُطبَّقٌ ومتأخِّرٌ ومفقودٌ يُحصَونَ في رحلةٍ واحدةٍ", async () => {
    const fresh = await seedDriver(811_203);
    const ghost = crypto.randomUUID() as DriverId;

    const directory = createDriverDirectory(sql);
    const seeded = await directory.updateLocation(driverId, AT_B, {
      recordedAtMs: T3,
      accuracyMeters: 9,
      verdict: "ACCEPT",
    });
    expect(seeded.ok).toBe(true);

    const persistence = createDriverLocationBatchPersistence(sql);
    const report = await persistence.persistBatch(cityId, [
      fixOf(fresh, T2, AT_A),
      fixOf(driverId, T1, AT_A),
      fixOf(ghost, T2, AT_B),
    ]);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value).toEqual({ applied: 1, stale: 1, missing: 1, appended: 2 });

    expect((await stored(fresh)).recordedAtMs).toBe(T2);
    // والمتأخِّرُ لم يمسَّ صفَّه: صفٌّ واحدٌ معطوبٌ في دفعةٍ لا يُسقِطُ الدفعةَ ولا يُفسِدُ غيرَه.
    expect((await stored()).recordedAtMs).toBe(T3);
  });

  /**
   * دورةُ إفراغٍ لا موقعَ فيها ليست عطلاً ولا كتابةً. والحالةُ تُقاسُ من الوجهَينِ:
   * المحوّلُ يُوجِزُ قبلَ الرحلةِ، والدالّةُ نفسُها تُجيبُ أصفاراً لو نُوديَت بمصفوفةٍ
   * فارغةٍ من مُنادٍ آخرَ.
   */
  it("٦ — دفعةٌ فارغةٌ: أصفارٌ بلا عطلٍ من المحوّلِ ومن الدالّةِ نفسِها", async () => {
    const persistence = createDriverLocationBatchPersistence(sql);
    const report = await persistence.persistBatch(cityId, []);
    expect(report.ok && report.value).toEqual({ applied: 0, stale: 0, missing: 0, appended: 0 });

    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select persist_driver_location_batch(${cityId}::uuid, '[]'::jsonb) as result
    `;
    expect(rows[0]?.result).toEqual({ ok: true, applied: 0, stale: 0, missing: 0, appended: 0 });
  });

  /**
   * وردُّ الدالّةِ على مُدخَلٍ غيرِ مصفوفةٍ عطلٌ **مُسمّىً** لا استثناءٌ غامضٌ:
   * المُنادي يُعيدُ الدفعةَ إلى قائمةِ الانتظارِ على عطلٍ، فلا بدَّ أن يكونَ العطلُ
   * مقروءاً. ولا تُختبَرُ هذه بمزدوجٍ: الصياغةُ من `plpgsql` نفسِها.
   */
  it("٧ — مُدخَلٌ ليسَ مصفوفةً: عطلٌ مُسمّىً يقرؤه المُنادي", async () => {
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select persist_driver_location_batch(${cityId}::uuid, '{"driver_id":"x"}'::jsonb) as result
    `;
    expect(rows[0]?.result).toEqual({ ok: false, error: "BATCH_MUST_BE_ARRAY" });

    const persistence = createDriverLocationBatchPersistence(sql);
    // ودفعةٌ سليمةٌ بعدَها تمرُّ: العطلُ لم يُفسِدْ حالةً في الدالّةِ.
    const report = await persistence.persistBatch(cityId, [fixOf(driverId, T2, AT_A)]);
    expect(report.ok && report.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 1 });
  });

  /**
   * ## F4-05 — `last_location_at` زمنُ **قبولٍ** محمولٌ لا `now()` لحظةَ الإفراغِ
   *
   * هذه الحالاتُ الثلاثُ هيَ الإثباتُ الوحيدُ الذي يمسُّ القاعدةَ فعلاً؛ وحاجزُ
   * `check-location-acceptance-stamp` يقرأُ النصَّ لا الأثرَ، فلا يُغني عنها.
   */
  it("٨ — `last_location_at` = الطابعُ المحمولُ، لا لحظةَ الإفراغِ", async () => {
    const persistence = createDriverLocationBatchPersistence(sql);

    // لحظةُ قبولٍ في الماضي بعشرِ دقائقَ: لو كُتِبَت `now()` لَفاتَ الفرقُ ظاهراً.
    const acceptedMs = Date.now() - 600_000;
    const before = Date.now();
    const report = await persistence.persistBatch(cityId, [
      { ...fixOf(driverId, T2, AT_A), observedAtMs: acceptedMs },
    ]);
    expect(report.ok && report.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 1 });

    const row = await stored();
    // مساواةٌ بالمِلِّي (تُقرَّبُ إلى الميكرو في `timestamptz`، فلا كسرَ يضيعُ هنا).
    expect(row.acceptedAtMs).toBe(acceptedMs);
    // وهوَ **ليسَ** طابعَ الجهازِ، و**ليسَ** لحظةَ الإفراغِ.
    expect(row.recordedAtMs).toBe(T2);
    expect(row.acceptedAtMs).toBeLessThan(before);
  });

  it("٩ — دفعةٌ بلا الحقلِ (حِمْلٌ قديمٌ): تراجُعٌ إلى `now()` لا عطلٌ", async () => {
    // الحالةُ الانتقاليّةُ الحقيقيّةُ: مدخلاتٌ ساخنةٌ كُتِبَت قبلَ هذا التغييرِ
    // فلا `oat` فيها. القبولُ الأصدقُ المتاحُ حينَئذٍ هوَ لحظةُ الإفراغِ — ويُقبَلُ
    // لأنَّ النافذةَ عمرُ TTL ساخنٍ واحدٍ لا أكثرَ، والبديلُ إسقاطُ الموقعِ كلِّه.
    const before = Date.now() - 1_000;
    /**
     * **تصحيحٌ (2026-09-11 · حكمُ CI الأوّلُ):** كانت الدفعةُ ههنا تُمرَّرُ
     * `JSON.stringify(...)` ثمَّ يُلحَقُ بها `::jsonb`. و`postgres.js` يقرأُ
     * القالبَ فيرى الحملَ jsonb فيُسلسِلُ القيمةَ بنفسِه — فالنصُّ المُسلسَلُ
     * سلفاً يُسلسَلُ ثانيةً ويصلُ الدالّةَ **نصّاً** لا مصفوفةً، فترُدُّ
     * `BATCH_MUST_BE_ARRAY`: فحالةُ «الحملِ القديمِ» لم تُختبَرْ قطُّ، وإنّما
     * أُعيدَ اختبارُ الحالةِ ٧ بلا قصدٍ. والطريقُ المُعتمَدُ `sql.json` وهوَ
     * نفسُه طريقُ المحوّلِ في الإنتاجِ. وكذلك كانَ اسمُ حقلِ الحكمِ `quality`
     * والدالّةُ تُفكِّكُ `verdict` حرفيّاً — فلوِ اجتازَ الترميزُ لسقطَ الصفُّ
     * في التنقيةِ ولَكانَ `applied = 0`.
     */
    // OPS-013: الحِمْلُ يُمرَّرُ بـ`sql.json` كما يُمرِّرُه المحوّلُ الإنتاجيُّ، لا
    // بـ`JSON.stringify` نصّاً. فالسائقُ (postgres.js) يختارُ مُسلسِلَ الوسيطِ من
    // نوعِه المُعلَنِ من الخادمِ؛ فإذا صارَ النوعُ `jsonb` معروفاً سلسلَ النصَّ مرّةً
    // أخرى، فوصلَ إلى الدالّةِ `jsonb` من صنفِ `string` لا `array`، فأجابَت
    // `BATCH_MUST_BE_ARRAY` — عطلٌ في استعمالِ السائقِ لا في الدالّةِ، وكانَ يظهرُ
    // أو يختفي بحسبِ ما إذا كانَت الجملةُ مُحضَّرةً على الوصلةِ قبلَ ذلك.
    const rows = await sql<{ result: Record<string, unknown> }[]>`
      select persist_driver_location_batch(${cityId}::uuid, ${sql.json([
        {
          driver_id: driverId,
          latitude: AT_A.latitude,
          longitude: AT_A.longitude,
          recorded_at_ms: T2,
          accuracy_m: 11,
          // OPS-013: الحقلُ الذي تقرؤه `jsonb_to_recordset` اسمُه `verdict` لا
          // `quality` (و`quality` اسمُ العمودِ المخزَّنِ لا اسمُ حقلِ الحِمْلِ). وكانَ
          // المكتوبُ `quality`، فيصلُ `verdict = null` فيُرفَضُ الصفُّ صامتاً
          // (`applied = 0`) — فالحالةُ المقصودةُ (غيابُ `observed_at_ms` وحدَه) لم
          // تكن مُقاسةً أصلاً. والغيابُ المقصودُ باقٍ: لا `observed_at_ms` هنا.
          verdict: "ACCEPT",
        },
      ] as never)}::jsonb) as result
    `;
    expect(rows[0]?.result).toMatchObject({ ok: true, applied: 1 });

    const row = await stored();
    expect(row.acceptedAtMs).not.toBeNull();
    expect(row.acceptedAtMs ?? 0).toBeGreaterThanOrEqual(before);
    expect(row.recordedAtMs).toBe(T2);
  });

  it("١٠ — لحظةُ قبولٍ في المستقبلِ تُقصَّرُ إلى `now()`", async () => {
    // ساعةُ المثيلِ قد تسبقُ ساعةَ القاعدةِ بثوانٍ. والعمودُ يُقرأُ عمراً في حاجزِ
    // `driver_location_max_age_seconds`، وعمرٌ سالبٌ يعني «أحدثُ من الآنَ» — وهوَ
    // ادّعاءٌ لا يُسمَحُ به. فالحدُّ `least(المحمولُ, now())` مقصودٌ لا احتياطيٌّ.
    const persistence = createDriverLocationBatchPersistence(sql);
    const report = await persistence.persistBatch(cityId, [
      { ...fixOf(driverId, T2, AT_A), observedAtMs: Date.now() + 3_600_000 },
    ]);
    expect(report.ok && report.value).toEqual({ applied: 1, stale: 0, missing: 0, appended: 1 });

    const row = await stored();
    expect(row.acceptedAtMs ?? 0).toBeLessThanOrEqual(Date.now() + 1_000);
  });
});
