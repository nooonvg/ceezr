/**
 * الغرض: `F7-06` / `DEC-15` — **الاستبقاءُ يُخرِجُ ثمَّ يُسقِطُ، ولا يُسقِطُ إلّا
 *   بعدَ إثباتٍ**. يُقاسُ ههنا أنَّ الحارسَ في القاعدةِ يرفضُ إسقاطَ قِسمٍ لم
 *   يُؤرشَفْ، وأنَّ بصمةً لا تُطابِقُ تمنعُ الإسقاطَ، وأنَّ يوماً داخلَ النافذةِ
 *   الساخنةِ لا يُمَسُّ، وأنَّ الشوطَ الكاملَ يُخرِجُ كلَّ صفٍّ ثمَّ يُسقِطُ.
 *
 *   ## ولماذا PostgreSQL حقيقيٌّ لا مزدوجٌ
 *
 *   المقيسُ ههنا **رفضُ الإسقاطِ**، وهوَ شرطٌ يعيشُ داخلَ دالّةِ القاعدةِ لا في
 *   شيفرتِنا. ومزدوجٌ في الذاكرةِ كانَ سيُرجِعُ ما نُلقّنُه إيّاه فيمرُّ أخضرَ
 *   ولو كانَ الشرطُ محذوفاً من الدالّةِ أصلاً — وهذا بعينِه أخطرُ ما في البندِ:
 *   حارسٌ يُظَنُّ قائماً وهوَ غيرُ قائمٍ، لا يُكتشَفُ إلّا بعدَ ضياعِ صفوفٍ.
 *
 *   ## وما لا يُدَّعى ههنا
 *
 *   ١) **لا قياسَ أداءٍ ولا حجمٍ**: الصفوفُ عشراتٌ، والمقيسُ الصوابُ لا الزمنُ
 *      ولا ما يُوفَّرُ من قرصٍ (`ح-5`).
 *   ٢) **لا مخزنَ حقيقيٌّ**: المخزنُ ههنا مزدوجٌ في الذاكرةِ. والمقيسُ **عقدُ
 *      الرفعِ والقراءةِ** لا سلوكُ مزوّدٍ بعينِه؛ ومزوّدُ الإنتاجِ مقيسٌ في
 *      اختبارِ النسخِ الاحتياطيّةِ بمنفذِه نفسِه.
 *   ٣) **لا امتثالَ**: خُضرةُ هذا الملفِّ لا تعني أنَّ `PDPL` استُوفيَ — ذاكَ
 *      `F12-10`، ومُدَدُ الأصنافِ الأخرى ما زالت غيرَ محسومةٍ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديلٍ على دالّتَي الأرشفةِ أو على السياسةِ.
 * ملاحظات مستقبلية: يومَ تُحسَمُ مُدَدُ الجداولِ الأخرى تُضافُ لها ملفّاتُها،
 *   ولا يُخلَطُ جدولانِ في ملفٍّ واحدٍ.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type ArchiveObjectStore,
  archiveDueLocationPartitions,
} from "../../packages/application/geo/archive-location-partitions.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createLocationArchiveCatalog,
  createLocationArchiveCodec,
} from "../../packages/infrastructure/geo/location-archive-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** أقدمُ من النافذةِ الساخنةِ بكثيرٍ كي لا يتأرجحَ الاختبارُ عندَ منتصفِ الليلِ. */
const OLD_DAYS_AGO = 40;
const HOT_DAYS = 14;
const PART_ROWS = 3;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let catalog: ReturnType<typeof createLocationArchiveCatalog>;

const codec = createLocationArchiveCodec();

/** مخزنٌ في الذاكرةِ. `corrupt` يُفسِدُ ما يُقرَأُ لا ما يُكتَبُ — كقرصٍ يتعفّنُ. */
function createMemoryStore(
  options: { corrupt?: boolean; failUploadsAfter?: number } = {},
): ArchiveObjectStore & {
  readonly objects: Map<string, Uint8Array>;
} {
  const objects = new Map<string, Uint8Array>();
  let uploads = 0;
  return {
    objects,
    upload: async (name, content) => {
      uploads += 1;
      if (options.failUploadsAfter !== undefined && uploads > options.failUploadsAfter) {
        return err(new PortFailureError("test.store", "المخزنُ لا يستجيبُ"));
      }
      objects.set(name, content);
      return ok({ remoteFileId: name, bytes: content.byteLength });
    },
    download: async (remoteFileId) => {
      const stored = objects.get(remoteFileId);
      if (stored === undefined) {
        return err(new PortFailureError("test.store", `لا كائنَ باسمِ ${remoteFileId}`));
      }
      return ok(options.corrupt === true ? new TextEncoder().encode("مُفسَدٌ") : stored);
    },
  };
}

function dayString(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  return date.toISOString().slice(0, 10);
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات استبقاءِ أثرِ الموقعِ مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدةٍ بها الهجرات مطبَّقة.",
  );
}

describeIf("F7-06 — أرشفةُ أثرِ الموقعِ وإسقاطُه على PostgreSQL حقيقيٍّ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    catalog = createLocationArchiveCatalog(sql);
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
    await sql`delete from location_archive_manifest`;
    await sql`delete from driver_location_history`;
    await sql`truncate table tracking_sessions, attendance_log, driver_availability,
                             driver_capabilities, subscriptions, drivers, users
                             restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  });

  /**
   * قِسمٌ قديمٌ يُصنَعُ بيدٍ: مُنشئُ الأقسامِ لا يُنشئُ ماضياً — نافذتُه من أمسِ
   * إلى أمامَ. وصنعُه ههنا بشكلِ القِسمِ نفسِه الذي تصنعُه الدالّةُ.
   *
   * **والسائقونَ يُبذَرونَ حقّاً**: على `driver_location_history.driver_id` مفتاحٌ
   * أجنبيٌّ إلى `drivers`، فمعرِّفٌ مُختلَقٌ يُرفَضُ بـ`23503`. وهذا الرفضُ نفسُه
   * فائدةٌ: القاعدةُ الحقيقيّةُ ردَّت ما كانَ مزدوجٌ في الذاكرةِ سيبتلعُه صامتاً.
   */
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

  async function seedOldPartition(rowsPerDriver: number, drivers: number): Promise<string> {
    const day = dayString(OLD_DAYS_AGO);
    const name = `driver_location_history_${day.replace(/-/g, "")}`;
    await sql.unsafe(
      `create table if not exists ${name} partition of driver_location_history ` +
        `for values from ('${day}') to ('${day}'::date + 1)`,
    );
    await sql.unsafe(`alter table ${name} enable row level security`);
    for (let d = 0; d < drivers; d += 1) {
      const driverId = await seedDriver(170_600 + d);
      for (let r = 0; r < rowsPerDriver; r += 1) {
        await sql`
          insert into driver_location_history
            (city_id, driver_id, position, recorded_at, accuracy_m, quality, source)
          values (
            ${cityId}::uuid,
            ${driverId}::uuid,
            st_setsrid(st_makepoint(${39.17 + r * 0.001}, ${21.54 + d * 0.001}), 4326)::geography,
            ${`${day}T0${r}:00:00Z`}::timestamptz,
            ${10 + r},
            'good',
            'batch'
          )
        `;
      }
    }
    return day;
  }

  async function partitionExists(day: string): Promise<boolean> {
    const name = `driver_location_history_${day.replace(/-/g, "")}`;
    const rows = await sql<{ present: boolean }[]>`
      select to_regclass(${`public.${name}`}) is not null as present
    `;
    return rows[0]?.present === true;
  }

  it("١) اليومُ الذي تجاوزَ النافذةَ يظهرُ مستحقّاً بعددِ صفوفِ مدينتِه", async () => {
    const day = await seedOldPartition(4, 2);

    const due = await catalog.dueDays(HOT_DAYS, 3);
    expect(due.ok).toBe(true);
    if (!due.ok) return;

    const entry = due.value.find((candidate) => candidate.day === day);
    expect(entry).toBeDefined();
    expect(entry?.cities).toEqual([{ cityId, rows: 8 }]);
  });

  it("٢) **لا إسقاطَ بلا أرشيفٍ**: الحارسُ يرفضُ ويُبقي الصفوفَ كلَّها", async () => {
    const day = await seedOldPartition(4, 2);

    const dropped = await catalog.dropDay(day, HOT_DAYS);
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.value.status).toBe("refused");
    expect(dropped.value.reason).toBe("ARCHIVE_INCOMPLETE");

    expect(await partitionExists(day)).toBe(true);
    const remaining = await sql<{ n: string }[]>`select count(*) as n from driver_location_history`;
    expect(Number(remaining[0]?.n)).toBe(8);
  });

  it("٣) يومٌ داخلَ النافذةِ الساخنةِ لا يُمَسُّ ولو نودِيَ عليه صراحةً", async () => {
    const dropped = await catalog.dropDay(dayString(1), HOT_DAYS);
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.value.status).toBe("refused");
    expect(dropped.value.reason).toBe("DAY_INSIDE_HOT_WINDOW");
  });

  it("٤) الشوطُ الكاملُ: كلُّ صفٍّ يخرجُ إلى الأرشيفِ ثمَّ يُسقَطُ القِسمُ", async () => {
    const day = await seedOldPartition(4, 2);
    const store = createMemoryStore();

    const report = await archiveDueLocationPartitions(
      { catalog, store, codec },
      { hotDays: HOT_DAYS, maxDays: 3, partRows: PART_ROWS },
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.refused).toEqual([]);
    expect(report.value.rowsArchived).toBe(8);
    expect(report.value.partitionsDropped).toBe(1);
    expect(report.value.rowsDropped).toBe(8);

    // القِسمُ ذهبَ، والصفوفُ ذهبَت معَه.
    expect(await partitionExists(day)).toBe(false);
    const remaining = await sql<{ n: string }[]>`select count(*) as n from driver_location_history`;
    expect(Number(remaining[0]?.n)).toBe(0);

    // وما خرجَ محفوظٌ كاملاً: ثمانيةُ صفوفٍ في ثلاثةِ أجزاءٍ (٣+٣+٢).
    const lines = [...store.objects.values()].flatMap((body) =>
      new TextDecoder().decode(body).trim().split("\n"),
    );
    expect(lines.length).toBe(8);
    expect(store.objects.size).toBe(3);
    for (const line of lines) {
      const row = JSON.parse(line) as { city_id: string; position: string };
      expect(row.city_id).toBe(cityId);
      expect(row.position).toContain("POINT");
    }

    // والدفترُ يشهدُ: كلُّ جزءٍ مُتحقَّقٌ منه.
    const parts = await catalog.parts(day, cityId);
    expect(parts.ok).toBe(true);
    if (!parts.ok) return;
    expect(parts.value.length).toBe(3);
    expect(parts.value.every((part) => part.verified)).toBe(true);
  });

  it("٥) بصمةٌ لا تُطابِقُ: لا تحقّقَ ولا إسقاطَ، والصفوفُ باقيةٌ", async () => {
    const day = await seedOldPartition(4, 2);
    const store = createMemoryStore({ corrupt: true });

    const report = await archiveDueLocationPartitions(
      { catalog, store, codec },
      { hotDays: HOT_DAYS, maxDays: 3, partRows: PART_ROWS },
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.refused.map((entry) => entry.reason)).toContain("DIGEST_MISMATCH");
    expect(report.value.partitionsDropped).toBe(0);
    expect(await partitionExists(day)).toBe(true);

    const remaining = await sql<{ n: string }[]>`select count(*) as n from driver_location_history`;
    expect(Number(remaining[0]?.n)).toBe(8);

    // والدفترُ يحملُ الجزءَ غيرَ مُتحقَّقٍ منه لا محذوفاً: الأثرُ يبقى ليُقرَأَ.
    const parts = await catalog.parts(day, cityId);
    expect(parts.ok).toBe(true);
    if (!parts.ok) return;
    expect(parts.value.some((part) => !part.verified)).toBe(true);
  });

  it("٦) شوطٌ انقطعَ في منتصفِه: الثاني يُكمِلُ ما بقيَ ولا يُعيدُ ما تُحقِّقَ منه", async () => {
    const day = await seedOldPartition(4, 2);

    // المخزنُ يقبلُ جزأَينِ ثمَّ يسقطُ — انقطاعٌ في منتصفِ يومٍ.
    const flaky = createMemoryStore({ failUploadsAfter: 2 });
    const first = await archiveDueLocationPartitions(
      { catalog, store: flaky, codec },
      { hotDays: HOT_DAYS, maxDays: 3, partRows: PART_ROWS },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.partsUploaded).toBe(2);
    expect(first.value.partitionsDropped).toBe(0);
    expect(await partitionExists(day)).toBe(true);

    /**
     * الشوطُ الثاني على المخزنِ نفسِه وقد عوفيَ: يرفعُ **جزءاً واحداً**
     * لا ثلاثةً — وذاكَ معنى الاستئنافِ: لا نسخةَ مكرّرةَ ولا فجوةَ.
     */
    const healed = createMemoryStore();
    for (const [name, body] of flaky.objects) healed.objects.set(name, body);
    const second = await archiveDueLocationPartitions(
      { catalog, store: healed, codec },
      { hotDays: HOT_DAYS, maxDays: 3, partRows: PART_ROWS },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.partsUploaded).toBe(1);
    expect(second.value.rowsArchived).toBe(2);
    expect(second.value.partitionsDropped).toBe(1);
    expect(await partitionExists(day)).toBe(false);
  });
});
