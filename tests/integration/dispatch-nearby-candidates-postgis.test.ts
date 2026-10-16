/**
 * الغرض: `CAP-003` — إثباتٌ على PostgreSQL/PostGIS حقيقيةٍ أنّ المسارَ السريعَ
 *   `findNearbyAvailableForDispatch` يُنفّذُ ما نصَّ عليه البند:
 *   (١) لا يُرجعُ إلا داخلَ نصف القطر (`ST_DWithin`)، ويستخدمُ فهرسَ GiST.
 *   (٢) يفلترُ غيرَ المتاحِ وغيرِ الموثَّقِ والمحجوبِ قبلَ `LIMIT`.
 *   (٣) `driverLocationMaxAgeSeconds = 0` يُعطّلُ فحصَ القِدَم (كما وثّقت المرحلة ٨).
 *   (٤) سائقٌ `last_location = NULL` لا يدخلُ النتيجة (كما يُستبعدُه `ST_DWithin`
 *       على NULL) — ولا يُرى إلا في المسارِ التشخيصيّ.
 *   (٥) الترتيبُ بالمسافةِ تصاعديّاً، والنتيجةُ محدودةٌ بـ`limit`.
 *   (٦) `LIMIT` لا يمتلئُ بمرشّحين غيرِ صالحين: البواباتُ الصلبةُ تُطبَّقُ قبلَه.
 *   (٧) خطةُ `EXPLAIN` تكشفُ استخدامَ فهرسِ `drivers_location_gix` لا المسحَ الكامل.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL بها الهجرات مطبَّقة.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة قاعدةِ البيانات).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverCandidateRepository } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let cityId: CityId;

/** نقطةُ الانطلاق: تقاطعٌ في جدة. */
const PICKUP = { latitude: 21.4858, longitude: 39.1925 };
/** ~2.2 كم شمالَ التقاطع. */
const NEAR = { latitude: 21.5058, longitude: 39.1925 };
/** ~6.7 كم شمالَ التقاطع — داخل نصف القطر ١٠ كم. */
const MID = { latitude: 21.5458, longitude: 39.1925 };
/** مكة — ~٦٠ كم، خارجُ نصفِ القطرِ بفارقٍ كبير. */
const OUTSIDE = { latitude: 21.3891, longitude: 39.8579 };

const SEARCH_RADIUS_KM = 10;

function makeGeography(c: { latitude: number; longitude: number }) {
  // يُبنى الموقعُ كمعاملاتٍ لا كـ raw SQL — فالإحداثياتُ مدخلاتٌ وإن كانت ثابتةً في الاختبار.
  return { lng: c.longitude, lat: c.latitude };
}

const PICKUP_GEO = makeGeography(PICKUP);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

async function makeDriver(
  label: string,
  index: number,
  opts: {
    location: { latitude: number; longitude: number } | null;
    verified?: boolean;
    blocked?: boolean;
    available?: boolean;
    locationAgeSeconds?: number;
  },
): Promise<DriverId> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${800000 + index}::bigint, ${label},
            ${`+96650080000${index}`}, 'driver'::user_role, 'ar')
    returning id
  `;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error(`تعذّر إنشاء مستخدم ${label}`);
  const verification = opts.verified === false ? "pending" : "verified";
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${userId}, ${verification}::verification_status)
    returning id
  `;
  const driverId = drivers[0]?.id;
  if (driverId === undefined) throw new Error(`تعذّر إنشاء السائق ${label}`);

  if (opts.blocked === true) {
    await sql`update users set is_blocked = true where id = ${userId}`;
  }

  if (opts.location !== null) {
    const geo = makeGeography(opts.location);
    const ageSeconds = opts.locationAgeSeconds ?? 0;
    const stampedAt = ageSeconds > 0 ? new Date(Date.now() - ageSeconds * 1000) : new Date();
    await sql`update drivers
                 set last_location = st_setsrid(st_makepoint(${geo.lng}, ${geo.lat}), 4326)::geography,
                     last_location_at = ${stampedAt}
               where id = ${driverId}`;
  }

  const isAvailable = opts.available !== false;
  await sql`insert into driver_availability (driver_id, city_id, is_available)
            values (${driverId}, ${cityId}, ${isAvailable})`;
  return driverId as DriverId;
}

describeIf("CAP-003 — findNearbyAvailableForDispatch على PostGIS", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id as CityId;
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
  });

  it("١ — لا يُرجعُ إلا داخلَ نصفِ القطرِ متاحاً موثَّقاً غيرَ محجوبٍ، مرتّباً بالمسافة", async () => {
    const eligibleNear = await makeDriver("قريب-مؤهل", 1, { location: NEAR });
    const eligibleMid = await makeDriver("متوسط-مؤهل", 2, { location: MID });
    await makeDriver("خارج-نصف-القطر", 3, { location: OUTSIDE });
    await makeDriver("غير-متاح", 4, { location: NEAR, available: false });
    await makeDriver("غير-موثق", 5, { location: NEAR, verified: false });
    await makeDriver("محجوب", 6, { location: NEAR, blocked: true });

    const repo = createDriverCandidateRepository(sql);
    const result = await repo.findNearbyAvailableForDispatch({
      cityId,
      pickup: PICKUP,
      searchRadiusKm: SEARCH_RADIUS_KM,
      driverLocationMaxAgeSeconds: 0,
      limit: 50,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((c) => String(c.driverId));
    expect(ids).toEqual([String(eligibleNear), String(eligibleMid)]);
    // الترتيبُ بالمسافةِ تصاعديّاً: الأقربُ أوّلاً.
    expect(result.value[0]?.driverId).toBe(eligibleNear);
  });

  it("٢ — driverLocationMaxAgeSeconds = 0 يُعطّلُ فحصَ القِدَم (كما وثّقت المرحلة ٨)", async () => {
    // موقعٌ عمره ساعتان، لكنّ الفحصَ معطّلٌ فيجبُ أن يدخلَ.
    await makeDriver("موقع-قديم", 7, { location: NEAR, locationAgeSeconds: 7200 });

    const repo = createDriverCandidateRepository(sql);
    const result = await repo.findNearbyAvailableForDispatch({
      cityId,
      pickup: PICKUP,
      searchRadiusKm: SEARCH_RADIUS_KM,
      driverLocationMaxAgeSeconds: 0,
      limit: 50,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });

  it("٣ — عندما يُفعّلُ فحصُ القِدَم، الموقعُ القديمُ يُستبعدُ", async () => {
    await makeDriver("حديث", 8, { location: NEAR, locationAgeSeconds: 30 });
    await makeDriver("قديم", 9, { location: NEAR, locationAgeSeconds: 7200 });

    const repo = createDriverCandidateRepository(sql);
    const result = await repo.findNearbyAvailableForDispatch({
      cityId,
      pickup: PICKUP,
      searchRadiusKm: SEARCH_RADIUS_KM,
      driverLocationMaxAgeSeconds: 3600, // ساعة
      limit: 50,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });

  it("٤ — سائقٌ بلا موقع (last_location = NULL) لا يدخلُ النتيجة", async () => {
    await makeDriver("بلا-موقع", 10, { location: null });
    await makeDriver("بموقع", 11, { location: NEAR });

    const repo = createDriverCandidateRepository(sql);
    const result = await repo.findNearbyAvailableForDispatch({
      cityId,
      pickup: PICKUP,
      searchRadiusKm: SEARCH_RADIUS_KM,
      driverLocationMaxAgeSeconds: 0,
      limit: 50,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => String(c.driverId))).toHaveLength(1);
  });

  it("٥ — LIMIT يحدُّ النتيجةَ بعدَ البواباتِ الصلبةِ، لا يمتلئُ بغيرِ الصالحين", async () => {
    // خمسةٌ مؤهَّلون قريبون، وواحدٌ مؤهَّلٌ أبعدُ قليلاً. limit = 2 يُرجعُ الأقربَينِ فقط.
    const d1 = await makeDriver("أ1", 21, { location: NEAR });
    await makeDriver("أ2", 22, { location: { latitude: 21.5068, longitude: 39.1925 } });
    await makeDriver("أ3", 23, { location: { latitude: 21.5078, longitude: 39.1925 } });
    await makeDriver("خارج-بعد-الحد", 24, { location: MID });
    // واحدٌ غيرُ صالحٍ (غيرُ متاح) أقربُ من البعض — يجبُ ألّا يحتلَّ مكاناً في النافذة.
    await makeDriver("غير-متاح-قريب", 25, {
      location: { latitude: 21.5059, longitude: 39.1925 },
      available: false,
    });

    const repo = createDriverCandidateRepository(sql);
    const result = await repo.findNearbyAvailableForDispatch({
      cityId,
      pickup: PICKUP,
      searchRadiusKm: SEARCH_RADIUS_KM,
      driverLocationMaxAgeSeconds: 0,
      limit: 2,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    // الأقربُ أوّلاً، وغيرُ المتاحِ لم يدخل.
    expect(String(result.value[0]?.driverId)).toBe(String(d1));
    expect(result.value.every((c) => c.isAvailable)).toBe(true);
  });

  it("٦ — الترتيبُ بالمسافةِ تصاعديّاً عبرَ فهرسِ GiST", async () => {
    // نُنشئُ مؤهَّلين متعدّدين على مسافاتٍ متفاوتةٍ داخلَ نصفِ القطر.
    const far = await makeDriver("أبعد", 31, { location: MID });
    const near = await makeDriver("أقرب", 32, { location: NEAR });
    const mid = await makeDriver("وسط", 33, {
      location: { latitude: 21.5258, longitude: 39.1925 },
    });

    const repo = createDriverCandidateRepository(sql);
    const result = await repo.findNearbyAvailableForDispatch({
      cityId,
      pickup: PICKUP,
      searchRadiusKm: SEARCH_RADIUS_KM,
      driverLocationMaxAgeSeconds: 0,
      limit: 50,
      now: new Date(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((c) => String(c.driverId));
    expect(ids).toEqual([String(near), String(mid), String(far)]);
  });

  it("٧ — خطةُ EXPLAIN تكشفُ استخدامَ فهرسِ drivers_location_gix", async () => {
    // نُدخِلُ عددًا كافيًا من السائقين حول نقطةِ الاستلام كي يرى المخطّطُ الفهرسَ جدوىً —
    // فمع صفٍّ واحدٍ يظلّ Seq Scan أرخصَ وإن عُطّل. ثمّ نُعطّلُ Seq Scan لإجبارِه عليه.
    for (let i = 0; i < 12; i++) {
      const jitter = (i - 6) * 0.001; // ~100 م بين كلٍّ وآخر حول نقطة الاستلام
      await makeDriver(`سائق-${i}`, 100 + i, {
        location: { latitude: PICKUP.latitude + jitter, longitude: PICKUP.longitude + jitter },
      });
    }
    // إحصاءٌ إلزاميٌّ قبلَ EXPLAIN — وهو ما كانَ يجعلُ هذا الاختبارَ غيرَ حتميٍّ.
    // الأسطرُ الاثنا عشرَ أعلاه تُدخَلُ في اللحظةِ نفسِها، و`autovacuum` لا يُحصي
    // فورًا؛ فمخطِّطُ الاستعلامِ رأى في إحدى جولاتِ CI `Plan Rows: 1`
    // فاختارَ `drivers_city_location_at_idx` (B-tree على `city_id`) مع `Filter`
    // و`Sort` بدلَ KNN على GiST — فأخفقَ التوكيدُ لإحصاءٍ بائدٍ لا لانحدارٍ.
    // و`analyze` لا يُرخي التوكيدَ ولا يُلزِمُ فهرسًا بعينِه: يُطلِعُ المخطِّطَ
    // على الحجمِ الحقيقيِّ وحدَه، والحكمُ يبقى حكمَه هو.
    await sql`analyze drivers`;
    // ضمنَ معاملةٍ واحدةٍ كي يلزمَ `enable_seqscan = off` الاتصالَ نفسَه لاستعلامِ EXPLAIN.
    const planText = await sql.begin(async (tx) => {
      await tx`set enable_seqscan = off`;
      const rows = await tx`explain (format json)
        select d.id from drivers d
         where d.city_id = ${cityId}
           and st_dwithin(
                 d.last_location,
                 st_setsrid(st_makepoint(${PICKUP_GEO.lng}, ${PICKUP_GEO.lat}), 4326)::geography,
                 10000
               )
         order by d.last_location <->
                  st_setsrid(st_makepoint(${PICKUP_GEO.lng}, ${PICKUP_GEO.lat}), 4326)::geography
         limit 50`;
      const value = Object.values(rows[0] ?? {})[0];
      return typeof value === "string" ? value : JSON.stringify(value ?? "");
    });
    // نُطابقُ اسمَ فهرسِ GiST نفسه لا أيَّ فهرسٍ — فهذا هو الإثباتُ المقصود.
    expect(planText).toMatch(/drivers_location_gix/);
  });
});
