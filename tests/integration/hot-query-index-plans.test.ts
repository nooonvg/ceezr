/**
 * الغرض: `F7-02` / `CAP-005` — قياسُ **خطّةِ التنفيذِ قبلَ الفهرسِ وبعدَه** على
 *   PostgreSQL حقيقيّةٍ لكلِّ فهرسٍ في سجلِّ الاستعلاماتِ الساخنةِ. لكلِّ فهرسٍ:
 *   (١) يُبذَرُ حجمٌ يُري المخطِّطَ الجدوى · (٢) تُقاسُ الخطّةُ **والفهرسُ قائمٌ**
 *   فيلزمُ أن يظهرَ الفهرسُ بالاسمِ · (٣) يُسقَطُ الفهرسُ في المعاملةِ نفسِها
 *   وتُقاسُ الخطّةُ ثانيةً فيلزمُ أن تُخفِقَ إلى العُقدةِ المُتوقَّعةِ (مسحٌ كاملٌ
 *   أو فرزٌ) وأن تكونَ كلفتُها أعلى · (٤) ثمَّ تُرتَدُّ المعاملةُ كلُّها.
 *
 *   والبذرُ والإسقاطُ والقياسُ في معاملةٍ واحدةٍ تُرتَدُّ — فلا صفَّ يبقى ولا
 *   فهرسَ يُفقَدُ، والقاعدةُ بعدَ الاختبارِ كما قبلَه حرفاً.
 *
 * الحالة: اختبارُ تكاملٍ فعليٌّ — يتطلّبُ `TEST_DATABASE_URL` بها الهجراتُ
 *   مُطبَّقةً (ومنها هجراتُ `F7-02` الستُّ).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفةُ «تكامل على PostgreSQL حقيقي»)، وكلُّ فهرسٍ
 *   يُضافُ إلى السجلِّ يلزمُه قياسٌ ههنا وإلّا أسقطَ الحاجزُ البناءَ.
 * ملاحظات مستقبلية: `enable_seqscan = off` **لا يُستخدَمُ ههنا** عن قصدٍ: الحكمُ
 *   يبقى حكمَ المخطِّطِ، وإلزامُه لا يُثبِتُ جدوىً بل يُخفيها.
 * ما لا يفعله — وحدودُه مُعلَنةٌ لا مضمرةٌ:
 *   - لا يدّعي أنَّ أحجامَ البذرِ أحجامُ الإنتاجِ؛ يدّعي أنَّ الفهرسَ يُغيِّرُ
 *     الخطّةَ إلى الأفضلِ عندَ حجمٍ معقولٍ، وأنَّ نقصَه يُعيدُها إلى الأسوأِ.
 *   - لا يقيسُ زمناً بالمِلِّي (`explain analyze`)؛ الزمنُ على عتادِ CI متقلِّبٌ،
 *     والكلفةُ التقديريّةُ والعُقدةُ المختارةُ حكمانِ حتميّانِ يُقارَنانِ.
 *   - لا يقيسُ أثرَ الفهرسِ على الكتابةِ؛ ذلكَ ميزانٌ يُقرَّرُ في `F7-06`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { HOT_QUERY_INDEXES } from "../../scripts/lib/hot-query-indexes.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** كم صفّاً يُبذَرُ في الجدولِ الساخنِ — يكفي ليرى المخطِّطُ الفرقَ ولا يُثقِلُ CI. */
const VOLUME = 4000;
/**
 * عددُ السائقينَ والراكبينَ المُصطنَعينَ — **والتوزيعُ شرطُ انتقائيّةِ الترشيحِ لا
 * زينةَ بذرٍ**: بعشرينَ فاعلاً يصيرُ نصيبُ السائقِ الواحدِ من الحجمِ ١٩٠ صفّاً
 * (نحوَ ٥٪)، فيَستنتِجُ المخطِّطُ أنَّ الصفَّ المطلوبَ قريبٌ ويُنهي `limit`
 * بمسحٍ متسلسلٍ يتوقّفُ باكراً — وذلكَ **كذبٌ على الإنتاجِ** حيثُ للسائقِ الواحدِ
 * طلبٌ جارٍ أو اثنانِ في جدولٍ لا سقفَ لهُ. فالفاعلونَ أربعُ مئةٍ: نصيبُ الواحدِ
 * نحوَ تسعةِ صفوفٍ (٠٫٢٪)، وهيَ انتقائيّةُ الإنتاجِ لا انتقائيّةُ البذرِ.
 */
const ACTORS = 400;
/** الطلباتُ الباحثةُ من الحجمِ — قليلةٌ لأنَّ «الباحثَ» حالةٌ عابرةٌ. */
const SEARCHING = 200;

/** عُقدةٌ يُتوقَّعُ ظهورُها في الخطّةِ عندَ غيابِ الفهرسِ. */
type FallbackNode = "Seq Scan" | "Sort" | "Index Scan" | "Bitmap Heap Scan";

type PlanCase = {
  /** اسمُ الفهرسِ في السجلِّ. */
  readonly index: string;
  /**
   * ما يُتوقَّعُ أن تنحدرَ إليهِ الخطّةُ إذا غابَ الفهرسُ — عُقدٌ مقبولةٌ لا عقدةً
   * واحدةً: اختيارُ المُخطِّطِ بينَ المسحِ التسلسليِّ ومسحِ فهرسٍ **آخرَ** بديلٍ
   * حساسٌ لإحصاءاتِ الجدولِ (تحليلُ autovacuum) لا لصحةِ الفهرسِ نفسِه، فالمقيسُ
   * هو: الفهرسُ الهدفُ في الخطّةِ حينَ يقومُ، ولا يُذكَرُ حينَ يُسقَط.
   */
  readonly fallback: readonly FallbackNode[];
  /** مُعامِلاتُ الاستعلامِ — تُحسَبُ بعدَ البذرِ. */
  readonly params: (seeded: Seeded) => (string | undefined)[];
};

type Seeded = {
  readonly riderIds: string[];
  readonly driverIds: string[];
  readonly auditAction: string;
  readonly auditEntityId: string;
};

const PLAN_CASES: readonly PlanCase[] = [
  {
    index: "orders_assigned_driver_status_idx",
    // I1 (ADR 0286): بذرُ الالتزاماتِ صارَ لكلِّ سائقٍ طلباً واحداً فتوزّعتِ
    // القيمُ، فاختيارُ البديلِ عندَ الإسقاطِ بينَ المسحِ التسلسليِّ ومسحِ
    // `orders_city_status_idx` مسألةُ إحصاءٍ لا صحةٍ.
    fallback: ["Seq Scan", "Index Scan"],
    params: (seeded) => [seeded.driverIds[0]],
  },
  {
    index: "orders_rider_status_idx",
    fallback: ["Seq Scan", "Index Scan"],
    params: (seeded) => [seeded.riderIds[0]],
  },
  {
    index: "orders_city_searching_created_idx",
    fallback: ["Sort"],
    params: () => [CITY_ID_PLACEHOLDER.value],
  },
  { index: "notification_outbox_ride_cycle_due_idx", fallback: ["Sort"], params: () => [] },
  {
    index: "audit_log_action_entity_idx",
    // `audit_log_entity_idx` بديلٌ وجيهٌ عندَ إحصاءٍ طازجٍ — والقبولُ للعقدتينِ
    // يحفظُ مقصودَ القياسِ: الفهرسُ الهدفُ لا يُذكَرُ حينَ يُسقَط.
    fallback: ["Seq Scan", "Index Scan"],
    params: (seeded) => [seeded.auditAction, seeded.auditEntityId],
  },
  {
    index: "attendance_log_changed_at_idx",
    fallback: ["Seq Scan", "Index Scan"],
    params: () => [],
  },
];

/** مدينةُ القياسِ — تُقرأُ مرّةً في `beforeAll` ويُقرأُها بانيُ المُعامِلاتِ. */
const CITY_ID_PLACEHOLDER = { value: "" };

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** كلفةُ الجذرِ وعُقدتُه من خطّةِ `explain (format json)`. */
type PlanShape = { readonly cost: number; readonly text: string };

async function explainOf(
  tx: Sql,
  query: string,
  params: readonly (string | undefined)[],
): Promise<PlanShape> {
  const bound = params.map((value) => value ?? null);
  const rows = (await tx.unsafe(`explain (format json) ${query}`, bound)) as unknown as {
    "QUERY PLAN": unknown;
  }[];
  const raw = rows[0]?.["QUERY PLAN"];
  const plan = (Array.isArray(raw) ? raw[0] : raw) as { Plan?: { "Total Cost"?: number } };
  const cost = plan.Plan?.["Total Cost"];
  if (typeof cost !== "number") throw new Error(`خطّةٌ بلا كلفةٍ: ${JSON.stringify(raw)}`);
  return { cost, text: JSON.stringify(raw) };
}

/** يبذُرُ الفاعلينَ والحجمَ في المعاملةِ المُرتَدَّةِ، ويُرجِعُ مفاتيحَ القياسِ. */
async function seedVolume(tx: Sql, cityId: string): Promise<Seeded> {
  const driverUsers = await tx<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    select ${cityId}::uuid, 970000000 + g, 'سائقُ قياسٍ ' || g, 'ar', 'driver'
      from generate_series(1, ${ACTORS}) g
    returning id`;
  const driverRows = await tx<{ id: string }[]>`
    insert into drivers (user_id, city_id, verification_status, national_id, plate_number)
    select u.id, ${cityId}::uuid, 'verified',
           'IDF702' || row_number() over (order by u.telegram_id),
           'PLF702' || row_number() over (order by u.telegram_id)
      from users u
     where u.id = any(${driverUsers.map((row) => row.id)}::uuid[])
    returning id`;
  const riderUsers = await tx<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    select ${cityId}::uuid, 971000000 + g, 'راكبُ قياسٍ ' || g, 'ar', 'rider'
      from generate_series(1, ${ACTORS}) g
    returning id`;
  const riderRows = await tx<{ id: string }[]>`
    insert into riders (city_id, user_id)
    select ${cityId}::uuid, u.id from users u
     where u.id = any(${riderUsers.map((row) => row.id)}::uuid[])
    returning id`;

  const riderIds = riderRows.map((row) => row.id);
  const driverIds = driverRows.map((row) => row.id);
  // I1 (ADR 0286): كلُّ طلبٍ مُلزَمٍ لسائقٍ **مختلفٍ** — فهرسُ الالتامِ الواحدِ
  // يفرضُه، فلا بذرَ ٣٨٠٠ سائقٍ للـ3800 طلبٍ مُلزَمٍ: المقيسُ خطّةُ الفهرسِ
  // لا إسنادٌ حقيقيٌّ.
  const matchedDriverUsers = await tx<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    select ${cityId}::uuid, 970100000 + g, 'سائقُ قياسٍ مُلزَمٌ ' || g, 'ar', 'driver'
      from generate_series(1, ${VOLUME - SEARCHING}::int) g
    returning id`;
  const matchedDriverRows = await tx<{ id: string }[]>`
    insert into drivers (user_id, city_id, verification_status, national_id, plate_number)
    select u.id, ${cityId}::uuid, 'verified',
           'IDF703' || row_number() over (order by u.telegram_id),
           'PLF703' || row_number() over (order by u.telegram_id)
      from users u
     where u.id = any(${matchedDriverUsers.map((row) => row.id)}::uuid[])
    returning id`;
  const matchedDriverIds = matchedDriverRows.map((row) => row.id);

  await tx`
    insert into orders (city_id, rider_id, service, status, pickup,
                        assigned_driver_id, matched_at, created_at)
    select ${cityId}::uuid,
           (${riderIds}::uuid[])[1 + (g % ${ACTORS})],
           'transport',
           -- I1 (ADR 0286): السائقُ الواحدُ لا يحملُ التزامًا (matched) ثانيًا —
           -- فهرسُ القاعدةِ يرفضُه. فالمُلزَمُ (حتى 400) لكلِّ سائقٍ مرةً واحدةً،
           -- وما زادَ حجمًا يُبذرُ منتهًا (completed) — والحجمُ للخطّةِ لا للعدِّ.
           (case when g <= ${SEARCHING} then 'searching'
                 when g <= ${SEARCHING}::int + ${ACTORS}::int then 'matched'
                 else 'completed' end)::order_status,
           st_point(39.1925, 21.4858)::geography,
           case when g <= ${SEARCHING} then null
                when g <= ${SEARCHING}::int + ${matchedDriverIds.length}::int
                  then (${matchedDriverIds}::uuid[])[g - ${SEARCHING}::int]
                else (${driverIds}::uuid[])[1 + (g % ${ACTORS})] end,
           case when g <= ${SEARCHING} then null else now() end,
           now() - make_interval(mins => g)
      from generate_series(1, ${VOLUME}) g`;

  await tx`
    insert into notification_outbox (city_id, kind, status, dedup_key,
                                     next_attempt_at, created_at)
    select ${cityId}::uuid, 'no_driver_found', 'pending',
           'f7-02-قياس-' || g, now(), now() - make_interval(mins => g)
      from generate_series(1, ${VOLUME}) g`;

  const auditAction = "f7_02_قياسُ_الخطّةِ";
  const audited = await tx<{ entity_id: string }[]>`
    insert into audit_log (city_id, action, entity_type, entity_id)
    select ${cityId}::uuid,
           case when g = 1 then ${auditAction} else 'f7_02_ضجيجٌ_' || (g % 50) end,
           'order', gen_random_uuid()
      from generate_series(1, ${VOLUME}) g
    returning entity_id`;
  const auditEntityId = audited[0]?.entity_id;
  if (auditEntityId === undefined) throw new Error("تعذّرَ بذرُ سجلِّ التدقيقِ");

  await tx`
    insert into attendance_log (city_id, driver_id, is_available, changed_at)
    select ${cityId}::uuid,
           (${driverIds}::uuid[])[1 + (g % ${ACTORS})],
           (g % 2 = 0),
           now() - make_interval(hours => g % 2160)
      from generate_series(1, ${VOLUME}) g`;

  return { riderIds, driverIds, auditAction, auditEntityId };
}

describeIf("F7-02 — خطّةُ التنفيذِ قبلَ الفهرسِ وبعدَه على محرِّكٍ حقيقيٍّ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرةُ بذرِ المدنِ على قاعدةِ الاختبارِ");
    CITY_ID_PLACEHOLDER.value = id;
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("١ — سجلُّ الفهارسِ وحالاتُ القياسِ متطابقانِ اسماً باسمٍ", () => {
    expect(PLAN_CASES.map((entry) => entry.index).sort()).toEqual(
      HOT_QUERY_INDEXES.map((entry) => entry.name).sort(),
    );
  });

  for (const planCase of PLAN_CASES) {
    const entry = HOT_QUERY_INDEXES.find((candidate) => candidate.name === planCase.index);
    if (entry === undefined) throw new Error(`فهرسٌ غيرُ مُسجَّلٍ: ${planCase.index}`);

    it(`٢ — ${entry.name}: الخطّةُ تستخدمُه، وبإسقاطِه تنحدرُ إلى ${planCase.fallback}`, async () => {
      const measured = await sql
        .begin(async (tx) => {
          const seeded = await seedVolume(tx as unknown as Sql, CITY_ID_PLACEHOLDER.value);
          const params = planCase.params(seeded);
          await (tx as unknown as Sql).unsafe(`analyze ${entry.table}`);
          const after = await explainOf(tx as unknown as Sql, entry.probe, params);
          await (tx as unknown as Sql).unsafe(`drop index ${entry.name}`);
          await (tx as unknown as Sql).unsafe(`analyze ${entry.table}`);
          const before = await explainOf(tx as unknown as Sql, entry.probe, params);
          // الارتدادُ صريحٌ: الفهرسُ يعودُ والصفوفُ تزولُ، والقاعدةُ كما كانت.
          throw { rollback: true as const, after, before };
        })
        .catch((error: unknown) => {
          const thrown = error as { rollback?: true; after?: PlanShape; before?: PlanShape };
          if (
            thrown.rollback !== true ||
            thrown.after === undefined ||
            thrown.before === undefined
          ) {
            throw error;
          }
          return { after: thrown.after, before: thrown.before };
        });

      console.log(
        `[F7-02] ${entry.name}: كلفةٌ بالفهرسِ ${measured.after.cost.toFixed(2)} · ` +
          `وبإسقاطِه ${measured.before.cost.toFixed(2)}`,
      );

      // (أ) الفهرسُ يظهرُ بالاسمِ في الخطّةِ حينَ يكونُ قائماً.
      expect(measured.after.text).toContain(entry.name);
      // (ب) وبإسقاطِه تنحدرُ الخطّةُ إلى العُقدةِ المُتوقَّعةِ ولا تذكرُه.
      expect(measured.before.text).not.toContain(entry.name);
      expect(measured.before.text).toMatch(
        new RegExp(planCase.fallback.map((n) => n.replaceAll(" ", "\\s")).join("|")),
      );
      // (ج) والكلفةُ بالفهرسِ أقلُّ — الجدوى مقيسةٌ لا مُدَّعاةٌ.
      expect(measured.after.cost).toBeLessThan(measured.before.cost);
    });
  }

  it("٣ — الارتدادُ تامٌّ: الفهارسُ الستُّ قائمةٌ بعدَ القياسِ كلِّه", async () => {
    const rows = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes
       where schemaname = 'public'
         and indexname = any(${HOT_QUERY_INDEXES.map((entry) => entry.name)}::text[])`;
    expect(rows.map((row) => row.indexname).sort()).toEqual(
      HOT_QUERY_INDEXES.map((entry) => entry.name).sort(),
    );
  });

  it("٤ — ولا صفَّ بذرٍ بقيَ في الجداولِ الساخنةِ", async () => {
    const rows = await sql<{ orders: string; outbox: string; audit: string }[]>`
      select
        (select count(*) from orders o
          join riders r on r.id = o.rider_id
          join users u on u.id = r.user_id
         where u.telegram_id between 971000001 and 971000020)::text as orders,
        (select count(*) from notification_outbox
          where dedup_key like 'f7-02-قياس-%')::text as outbox,
        (select count(*) from audit_log where action like 'f7_02_%')::text as audit`;
    expect(rows[0]?.orders).toBe("0");
    expect(rows[0]?.outbox).toBe("0");
    expect(rows[0]?.audit).toBe("0");
  });
});
