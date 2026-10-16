/**
 * الغرض: `BUG-001` — إثبات أنّ الكتابة على `drivers.last_location` صارت مشروطةً
 *   **في القاعدة**، على قاعدة PostgreSQL حقيقيّة لا على مزدوج.
 *
 *   الادّعاء المُختبَر ثلاثةٌ لا يُقاس أيٌّ منها بقراءة الكود:
 *   (١) أنّ الأقدمَ يُرفَض ولا يُرجِع الحالةَ إلى الوراءِ، وأنّ الرفضَ **جوابٌ**
 *       يصلُ الكاتبَ لا صمتٌ يُفسَّر نجاحاً.
 *   (٢) أنّ الحكمَ من القاعدةِ لا من ترتيبِ الوعودِ ولا من ساعةِ الجهازِ: كاتبانِ
 *       متزاحمانِ على اتّصالينِ مختلفَين، وأحدُهما محبوسٌ خلفَ معاملةٍ مفتوحةٍ حتّى
 *       تُثبَّت — وهو ما يُسقِط أيَّ تنفيذٍ يقرأُ ثمّ يقارنُ ثمّ يكتبُ.
 *   (٣) أنّ التساويَ مقبولٌ: `ADR 0053` §٦ يُلزِم بأن يكونَ مُسنَدُ هذا الحارسِ
 *       مُسنَدَ حارسِ الجلسةِ حرفاً (قِدَمٌ صارمٌ، والتساوي يمرُّ).
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Coordinates } from "../../packages/domain/geo/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import type { DriverId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * طوابعُ ثابتةٌ في ماضٍ بعيدٍ عن «الآنَ» عن قصدٍ: لو حكمَ الحارسُ بساعةِ الجهازِ
 * لسقطَ الملفُّ كلُّه. وهي بعدَ ٢٠٢٠ لأنّ القاعدةَ تمنعُ الطوابعَ الفاسدةَ تماماً
 * (`drivers_last_location_recorded_at_sane`) — وذلك قيدُ سلامةٍ لا حكمُ تتابعٍ.
 */
const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const T1 = T0 + 10_000;
const T2 = T0 + 20_000;
const T3 = T0 + 30_000;

const AT_A: Coordinates = { latitude: 21.5471, longitude: 39.1751 };
const AT_B: Coordinates = { latitude: 21.6, longitude: 39.2 };
const AT_C: Coordinates = { latitude: 21.7, longitude: 39.3 };

const fix = (recordedAtMs: number) =>
  ({ recordedAtMs, accuracyMeters: 10, verdict: "ACCEPT" }) as const;

let sql: Sql;
let cityId: string;
let driverId: DriverId;

interface Stored {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly recordedAtMs: number | null;
  readonly accuracy: number | null;
}

async function stored(reader: Sql = sql): Promise<Stored> {
  const rows = await reader<
    { lat: number | null; lng: number | null; recorded: Date | null; accuracy: number | null }[]
  >`
    select st_y(last_location::geometry) as lat,
           st_x(last_location::geometry) as lng,
           last_location_recorded_at as recorded,
           last_location_accuracy_m as accuracy
      from drivers where id = ${driverId}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لم يُقرأ السائق");
  return {
    lat: row.lat,
    lng: row.lng,
    recordedAtMs: row.recorded === null ? null : row.recorded.getTime(),
    accuracy: row.accuracy,
  };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("الكتابة الشرطيّة على الموقع القانوني — BUG-001", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
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
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, 811001::bigint, 'سائق الحارس', '+966500811001', 'driver'::user_role, 'ar')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء المستخدم");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}, ${userId}, 'verified'::verification_status)
      returning id
    `;
    const created = drivers[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء السائق");
    driverId = created as DriverId;
  });

  /** أوّلُ إصلاحةٍ لا سابقةَ لها: `last_location_recorded_at is null` فتُقبَل. */
  it("١ — الأحدث يُقبل، والكاتب يعرف أنه قُبِل", async () => {
    const directory = createDriverDirectory(sql);
    const first = await directory.updateLocation(driverId, AT_A, fix(T1));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("accepted");

    const second = await directory.updateLocation(driverId, AT_B, fix(T2));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.kind).toBe("accepted");

    const row = await stored();
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
    expect(row.recordedAtMs).toBe(T2);
  });

  /**
   * وهذا هو العطلُ نفسُه بحرفِه: إصلاحةٌ أقدمُ تصلُ **بعدَ** أحدثَ. قبلَ `BUG-001`
   * كانت تكتبُ فتُرجِعُ الموضعَ القانونيَّ إلى نقطةٍ غادرَها السائقُ.
   */
  it("٢ — الأقدم الواصل بعد الأحدث يُرفَض والحالة لا تتراجع", async () => {
    const directory = createDriverDirectory(sql);
    await directory.updateLocation(driverId, AT_B, fix(T2));
    const before = await stored();

    const late = await directory.updateLocation(driverId, AT_A, fix(T1));
    expect(late.ok).toBe(true);
    if (!late.ok) return;
    expect(late.value.kind).toBe("stale");

    const after = await stored();
    expect(after).toEqual(before);
    expect(after.lat).toBeCloseTo(AT_B.latitude, 5);
    expect(after.recordedAtMs).toBe(T2);
  });

  /**
   * الرفضُ لا يمسُّ عموداً واحداً: الدقّةُ والحكمُ يُكتبان مع الموضعِ في الجملةِ
   * نفسِها (ADR-0015)، فلو نجا منها عمودٌ لصار الصفُّ خليطاً من إصلاحتَين.
   */
  it("٣ — الرفض لا يُبدّل شيئاً من الصفّ: لا موضعاً ولا دقّةً ولا طابعاً", async () => {
    const directory = createDriverDirectory(sql);
    await directory.updateLocation(driverId, AT_B, {
      recordedAtMs: T2,
      accuracyMeters: 7,
      verdict: "ACCEPT",
    });
    const rejected = await directory.updateLocation(driverId, AT_A, {
      recordedAtMs: T1,
      accuracyMeters: 3000,
      verdict: "WARNING",
    });
    expect(rejected.ok && rejected.value.kind === "stale").toBe(true);

    const row = await stored();
    expect(row.accuracy).toBe(7);
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
    const quality = await sql<{ q: string | null }[]>`
      select last_location_quality as q from drivers where id = ${driverId}
    `;
    expect(quality[0]?.q).toBe("ACCEPT");
  });

  /**
   * `ADR 0053` §٤-ج: التساوي مقبولٌ. وطابعُ تلغرام بدقّةِ الثانيةِ، فإصلاحتانِ في
   * ثانيةٍ واحدةٍ حالةٌ عاديّةٌ ورفضُهما كان سيُجمّد الخريطةَ عندَ الحركةِ السريعةِ.
   */
  it("٤ — التساوي في الطابع لا يُرفَض لمجرّد التساوي", async () => {
    const directory = createDriverDirectory(sql);
    await directory.updateLocation(driverId, AT_A, fix(T2));
    const same = await directory.updateLocation(driverId, AT_B, fix(T2));
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.value.kind).toBe("accepted");

    const row = await stored();
    expect(row.lat).toBeCloseTo(AT_B.latitude, 5);
    expect(row.recordedAtMs).toBe(T2);
  });

  /** «لا صفَّ مُحدَّثاً» جوابانِ لا جوابٌ، وخلطُهما يُمرِّر عطلاً حقيقيّاً صامتاً. */
  it("٥ — سائقٌ لا وجود له يُميَّز عن الإصلاحة الأقدم", async () => {
    const directory = createDriverDirectory(sql);
    const missing = await directory.updateLocation(
      "00000000-0000-0000-0000-0000000000ff" as DriverId,
      AT_A,
      fix(T1),
    );
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.value.kind).toBe("no_driver");
  });

  /**
   * سباقٌ حقيقيٌّ: اتّصالانِ مختلفانِ، ثلاثُ نبضاتٍ تُسلَّم مقلوبةً (كما نصَّ
   * `BUG-001`)، والحكمُ يُقاس بما استقرَّ في القاعدةِ لا بترتيبِ `Promise.all`.
   */
  it("٦ — سباق ثلاث نبضات مقلوبة على اتصالات متعدّدة: الأحدث هو الباقي", async () => {
    const connections = [
      createSql({ connectionString: DATABASE_URL ?? "", max: 1 }),
      createSql({ connectionString: DATABASE_URL ?? "", max: 1 }),
      createSql({ connectionString: DATABASE_URL ?? "", max: 1 }),
    ];
    try {
      const [newest, middle, oldest] = connections.map((c) => createDriverDirectory(c));
      if (newest === undefined || middle === undefined || oldest === undefined) return;
      const results = await Promise.all([
        newest.updateLocation(driverId, AT_C, fix(T3)),
        middle.updateLocation(driverId, AT_B, fix(T2)),
        oldest.updateLocation(driverId, AT_A, fix(T1)),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);

      const row = await stored();
      expect(row.recordedAtMs).toBe(T3);
      expect(row.lat).toBeCloseTo(AT_C.latitude, 5);

      /** ومن رُفِض عَلِمَ: عددُ المقبولينَ لا يقلُّ عن واحدٍ ولا يزيدُ على ثلاثةٍ. */
      const accepted = results.filter((r) => r.ok && r.value.kind === "accepted").length;
      const stale = results.filter((r) => r.ok && r.value.kind === "stale").length;
      expect(accepted + stale).toBe(3);
      expect(accepted).toBeGreaterThanOrEqual(1);
    } finally {
      await Promise.all(connections.map((c) => c.end({ timeout: 5 })));
    }
  });

  /**
   * وهذا الاختبارُ وحدَه يفصلُ بين تنفيذٍ شرطُه في `where` وتنفيذٍ يقرأُ ثمّ
   * يقارنُ في `JS` ثمّ يكتبُ:
   *
   * الكاتبُ الأقدمُ يبدأُ **بينما** معاملةٌ مفتوحةٌ على اتّصالٍ آخرَ قد كتبت
   * الأحدثَ ولم تُثبَّت بعدُ. فلو كان الحكمُ في التطبيقِ لقرأَ الأقدمُ لقطةً
   * قديمةً (`recorded_at` القديمَ أو `null`) فحكمَ لنفسِه بالقبولِ وكتبَ بعد
   * التثبيتِ فأرجعَ الحالةَ. أمّا الشرطُ داخلَ `update` فيُحبَس على قفلِ الصفِّ
   * حتّى التثبيتِ، ثمّ يُعيد `READ COMMITTED` تقويمَه على النسخةِ المُحدَّثةِ —
   * فيرى ما كتبَه الفائزُ ويُرفَض.
   */
  it("٧ — الحكم يُعاد تقويمه على الصفّ بعد تثبيت معاملةٍ متزامنة، لا على لقطةٍ سابقة", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const writer = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      const directory = createDriverDirectory(writer);
      await directory.updateLocation(driverId, AT_A, fix(T1));

      let late: Awaited<ReturnType<typeof directory.updateLocation>> | undefined;
      let pending: ReturnType<typeof directory.updateLocation> | undefined;

      /** معاملةٌ تكتبُ الأحدثَ وتُمسِك القفلَ حتّى يبدأَ الأقدمُ فعلاً. */
      const transaction = holder.begin(async (tx) => {
        await tx`
          update drivers
             set last_location = st_setsrid(st_makepoint(${AT_C.longitude}, ${AT_C.latitude}),
                   4326)::geography,
                 last_location_at = now(),
                 last_location_recorded_at = ${new Date(T3)},
                 last_location_accuracy_m = 9,
                 last_location_quality = 'ACCEPT',
                 updated_at = now()
           where id = ${driverId}
        `;
        /**
         * الأقدمُ ينطلقُ الآن فيُحبَس على قفلِ الصفِّ. والانتظارُ ثمّ التحقّقُ من أنّه
         * لم يُجِب بعدُ هو الدليلُ على أنّه محبوسٌ في القاعدةِ فعلاً لا مُتخيَّلاً:
         * تنفيذٌ يقرأُ ثمّ يقارنُ في `JS` كان سيُجيب هنا فوراً — بالقبولِ.
         */
        pending = directory.updateLocation(driverId, AT_B, fix(T2));
        void pending.then((r) => {
          late = r;
        });
        await Bun.sleep(300);
        expect(late).toBeUndefined();
      });

      await transaction;
      if (pending === undefined) throw new Error("لم تنطلق الكتابة الأقدم");
      const resolved = await pending;
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value.kind).toBe("stale");

      const row = await stored();
      expect(row.recordedAtMs).toBe(T3);
      expect(row.lat).toBeCloseTo(AT_C.latitude, 5);
      expect(row.accuracy).toBe(9);
    } finally {
      await holder.end({ timeout: 5 });
      await writer.end({ timeout: 5 });
    }
  });

  /**
   * كلُّ طوابعِ هذا الملفِّ في سنةِ ٢٠٢٤، وهذا الاختبارُ يقلبُها إلى المستقبلِ:
   * الحكمُ واحدٌ في الحالتَين لأنّه مقارنةٌ بين الإصلاحاتِ لا بينَها وبين `now()`.
   */
  it("٨ — الحكم مستقلٌّ عن ساعة الجهاز: طوابعُ المستقبل تُحكَم بالمنطق نفسِه", async () => {
    const directory = createDriverDirectory(sql);
    const future = Date.now() + 400 * 24 * 3600 * 1000;
    const accepted = await directory.updateLocation(driverId, AT_A, fix(future));
    expect(accepted.ok && accepted.value.kind === "accepted").toBe(true);

    /** أحدثُ من المخزَّنِ لكنّه في ماضي ساعةِ الجهازِ: مرفوضٌ، والمرجعُ المخزَّن. */
    const older = await directory.updateLocation(driverId, AT_B, fix(Date.now()));
    expect(older.ok && older.value.kind === "stale").toBe(true);

    const newer = await directory.updateLocation(driverId, AT_C, fix(future + 1000));
    expect(newer.ok && newer.value.kind === "accepted").toBe(true);

    const row = await stored();
    expect(row.recordedAtMs).toBe(future + 1000);
    expect(row.lat).toBeCloseTo(AT_C.latitude, 5);
  });
});
