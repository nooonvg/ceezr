/**
 * الغرض: إثباتُ حلِّ الطلبِ داخلَ `trigger_sos` على PostgreSQL حقيقيّةٍ حينَ
 *   يُنادى بـ`p_order_id = null` — وهوَ ما صارَ مسارُ الاستقبالِ يُمرِّرُه دائماً
 *   بعدَ `F8-05`. الحكمُ على الحالاتِ والتّرتيبِ والدّورِ حكمُ قاعدةٍ لا حكمُ
 *   شيفرةٍ، فلا يُثبِتُه إلّا محرِّكٌ حقيقيٌّ: `is_active_order_status`،
 *   `is_driver_engaged_order_status`، و`order by created_at desc` كلُّها في القاعدةِ.
 * الحالة: مُختبَرٌ على PostgreSQL حقيقيّةٍ في شوطِ «تكامل على PostgreSQL حقيقي».
 *   ولا يُدَّعى أنَّه مَقيسٌ ولا مُثبَتٌ عندَ حمولةٍ.
 * ينتمي إلى: tests/integration
 * الحاكم: docs/adr/0077-sos-intake-resolves-its-own-order.md
 * ملاحظات مستقبلية: إن أُضيفَت حالةُ طلبٍ جديدةٌ فحرسُ `20260814140000` يُسقِطُ
 *   الهجرةَ أوّلاً؛ وهذا الملفُّ يُثبِتُ الأثرَ لا التّسميةَ.
 *
 * **زيادةٌ — `F12-03` · `ADR 0145` (`ح-8`)**: ثلاثُ حالاتٍ ههنا كانت تُوكِّدُ
 *   `NO_ACTIVE_ORDER`، وذاكَ كانَ **العقدَ القديمَ**: لا طلبَ ⇒ لا استغاثةَ. وقد
 *   نُسِخَ ذلكَ العقدُ عن قصدٍ إذ الطارئُ لا يشترطُ رحلةً. **ولم يُحذَفْ توكيدٌ
 *   ولم يُلَيَّنْ**: الدعوى التي كانت تحملُها كلُّ حالةٍ — أنَّ الاستغاثةَ **لا
 *   تُنسَبُ** إلى ذلكَ الطلبِ — بقيت مُوكَّدةً بحرفِها وصارت أقوى (`order_id is
 *   null` صريحاً + صفٌّ واحدٌ في الصندوقِ)، وزادَ عليها أنَّ النداءَ **يُقبَلُ**
 *   لا يُرَدُّ. ورمزُ `NO_ACTIVE_ORDER` يبقى في مجالِ الأسبابِ ولا يُنشَرُ.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

/** I/O قاعدةٍ حقيقيّةٍ تحتَ حملِ الحزمةِ — مهلةٌ صريحةٌ لا تغطيةَ عطلٍ. */
const slowIt = (name: string, fn: () => Promise<void> | void) => it(name, fn, 30_000);

import type { SafetyRole } from "../../packages/application/safety/ports.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createTriggerSosPort } from "../../packages/infrastructure/safety/safety-adapters.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM_ID = "884001";
const DRIVER_TELEGRAM_ID = "884002";
const STRANGER_TELEGRAM_ID = "884003";
const ESCALATION_GROUP = "-100884";
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let riderId: string;
let driverId: string;
let trigger: ReturnType<typeof createTriggerSosPort>;

async function firstId(rows: { id: string }[], what: string): Promise<string> {
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`تعذّرَ تجهيزُ ${what}`);
  return id;
}

/**
 * يُنشئُ طلباً للرّاكبِ بحالةٍ وعمرٍ محدَّدَين، ويُسنِدُه للسّائقِ إن طُلِبَ.
 *
 * **وختمُ الانتهاءِ يُكتَبُ صراحةً لا يُترَكُ لافتراضٍ (`F2-10`)**: كانَ الإدراجُ
 * يكتبُ `created_at` وحدَه، فيبقى `updated_at` عندَ `now()` مهما قيلَ
 * `minutesAgo`. فطلبٌ «مكتملٌ منذُ ساعتَينِ» كانَ في القاعدةِ **مكتملاً هذه
 * اللحظةَ** — وهوَ كذبُ تجهيزٍ لم يظهرْ ما دامَ الحكمُ لا ينظرُ إلّا إلى
 * الحالةِ. ولمّا صارَ `trigger_sos` يقيسُ `coalesce(completed_at, updated_at)`
 * لنافذةِ ما بعدَ الرحلةِ، كشفَ المحرِّكُ الحقيقيُّ كذبَ التجهيزِ في أوّلِ
 * جولةٍ. فصُدِّقَ التجهيزُ ولم يُخفَّفِ الحكمُ.
 */
async function makeOrder(options: {
  status: string;
  minutesAgo: number;
  assigned: boolean;
}): Promise<string> {
  const completed = options.status === "completed";
  const rows = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, assigned_driver_id, service, status, pickup,
      created_at, updated_at, completed_at
    )
    values (
      ${cityId}, ${riderId}::uuid,
      ${options.assigned ? driverId : null}::uuid,
      'transport', ${options.status}::order_status,
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography,
      now() - make_interval(mins => ${options.minutesAgo}),
      now() - make_interval(mins => ${options.minutesAgo}),
      ${completed ? sql`now() - make_interval(mins => ${options.minutesAgo})` : sql`null`}
    )
    returning id
  `;
  return firstId(rows, `الطلبِ (${options.status})`);
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = await firstId(city, "مدينةِ جدّة");
  // القروباتُ الثلاثةُ في عبارةِ التفعيلِ نفسِها: مدينةٌ مُفعَّلةٌ بلا قروباتِها
  // تجعلُ نجاحَ الاختبارِ مُعلَّقاً على ترتيبِ عباراتٍ — وحاجزُ `check-test-city-activation` يمنعُه.
  cityHandle = await ensureActiveCity(sql, {
    groups: { escalation: ESCALATION_GROUP },
    prior: cityHandle,
  });
  const riderUserId = await firstId(
    await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, ${RIDER_TELEGRAM_ID}::bigint, 'راكبُ الحلِّ', '+966500884001', 'rider')
      returning id`,
    "مستخدمِ الرّاكبِ",
  );
  riderId = await firstId(
    await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}::uuid) returning id`,
    "ملفِّ الرّاكبِ",
  );
  const driverUserId = await firstId(
    await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, ${DRIVER_TELEGRAM_ID}::bigint, 'سائقُ الحلِّ', '+966500884002', 'driver')
      returning id`,
    "مستخدمِ السّائقِ",
  );
  driverId = await firstId(
    await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
      values (${cityId}, ${driverUserId}::uuid, 'verified'::verification_status, 'أ ب ج 8840', 'sedan')
      returning id`,
    "ملفِّ السّائقِ",
  );
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${STRANGER_TELEGRAM_ID}::bigint, 'غريبٌ', '+966500884003', 'rider')
  `;
}

/** يقرأُ الطلبَ الذي نُسِبَ إليه الحادثُ فعلاً — لا الذي ظننّاه. */
async function incidentOrderId(incidentId: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    select order_id::text as id from safety_incidents where id = ${incidentId}::uuid
  `;
  return firstId(rows, "قراءةِ الحادثِ");
}

/**
 * يقرأُ نسبةَ الحادثِ **جائزةَ الغيابِ** (`F12-03`): `null` ههنا ليسَ إخفاقَ
 * قراءةٍ بل الحكمَ نفسَه — بلاغٌ لا يُنسَبُ إلى طلبٍ. ولذلكَ لا يُقرأُ بالدالّةِ
 * أعلاهُ: تلكَ تُسقِطُ الحالةَ عندَ الغيابِ، وههنا الغيابُ هوَ المُوكَّدُ عليه.
 */
async function incidentOrderIdOrNull(incidentId: string): Promise<string | null> {
  const rows = await sql<{ id: string | null }[]>`
    select order_id::text as id from safety_incidents where id = ${incidentId}::uuid
  `;
  if (rows.length === 0) throw new Error("تعذّرَ قراءةُ الحادثِ");
  return rows[0]?.id ?? null;
}

/** عددُ حوادثِ السلامةِ وصفوفِ تسليمِها — لقطةٌ تُقرأُ لا تُفترَضُ. */
async function safetyCounts(): Promise<{ incidents: string; queued: string }> {
  const rows = await sql<{ incidents: string; queued: string }[]>`
    select
      (select count(*)::text from safety_incidents) incidents,
      (select count(*)::text from notification_outbox where kind = 'safety_incident') queued
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("تعذّرَ العدُّ");
  return row;
}

describeIf("حلُّ الطلبِ داخلَ trigger_sos (F8-05 · ADR 0077)", () => {
  beforeAll(() => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, safety_incident_deliveries, safety_incidents, order_offers,
        orders, driver_availability, drivers, riders, users restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, safety_incident_deliveries, safety_incidents, order_offers,
        orders, driver_availability, drivers, riders, users restart identity cascade
    `;
    await createFixture();
    // `platform_settings` لا تُقطَعُ، فيُرَدُّ إعدادُ النافذةِ إلى ما بذَرتْه الهجرةُ قبلَ
    // كلِّ حالةٍ؛ وإلّا سرَبَ تعديلُ حالةٍ إلى تالياتِها فصارَ الترتيبُ حَكَماً.
    await sql`
      update platform_settings set value = '30'::jsonb
      where city_id = ${cityId}::uuid and key = 'sos_post_ride_window_minutes'
    `;
    trigger = createTriggerSosPort(sql);
  }, 30_000);

  /**
   * الانحصارُ الذي كانَ: الحوارُ يقرأُ الطلبَ قبلَ النّداءِ، فإخفاقُ القراءةِ
   * يُسقِطُ الاستغاثةَ. وههنا يُثبَتُ البديلُ: بلا مُعرِّفٍ أصلاً، يُنسَبُ الحادثُ
   * إلى طلبِ المُبلِّغِ القائمِ.
   */
  slowIt("راكبٌ بلا مُعرِّفٍ: يُنسَبُ الحادثُ إلى طلبِه القائمِ", async () => {
    const order = await makeOrder({ status: "matched", minutesAgo: 5, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderId(result.value.incidentId)).toBe(order);
  });

  /**
   * `searching` طلبٌ قائمٌ للرّاكبِ: هوَ في انتظارِ سائقٍ ولمّا يُلغِ، وقد يكونُ
   * في أخطرِ لحظةٍ. استثناؤه كانَ سيُصمِتُ استغاثةً كاملةً.
   */
  slowIt("راكبٌ في `searching` وحدَه: الاستغاثةُ تُقبَلُ لا تُرفَضُ", async () => {
    const order = await makeOrder({ status: "searching", minutesAgo: 3, assigned: false });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderId(result.value.incidentId)).toBe(order);
  });

  /**
   * تعدُّدُ الطلباتِ القائمةِ حالٌ قائمةٌ لا نظريّةٌ. والأحدثُ هوَ الرحلةُ التي
   * فيها الرّاكبُ الآنَ؛ والأقدمُ قد يكونُ طلباً منسيّاً في `searching`.
   */
  slowIt("طلبانِ قائمانِ: يُختارُ الأحدثُ لا الأقدمُ", async () => {
    const older = await makeOrder({ status: "searching", minutesAgo: 90, assigned: false });
    const newer = await makeOrder({ status: "matched", minutesAgo: 2, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    const attributed = await incidentOrderId(result.value.incidentId);
    expect(attributed).toBe(newer);
    expect(attributed).not.toBe(older);
  });

  /**
   * الطلبُ المنتهي منذُ ساعتَينِ خارجَ نافذةِ ما بعدَ الرحلةِ (ثلاثونَ دقيقةً
   * `sos_post_ride_window_minutes`)، **فلا تُنسَبُ إليه استغاثةُ اليومِ** — وهذه
   * هيَ الدعوى التي لا تتغيَّرُ. وكانَ النداءُ يُرَدُّ `NO_ACTIVE_ORDER`، وصارَ
   * **يُقبَلُ بلاغاً بلا طلبٍ** (`F12-03` · `ADR 0145`): الطارئُ لا يشترطُ رحلةً،
   * وغيابُ الرحلةِ معلومةٌ صادقةٌ لا فراغٌ يُملأُ بأقربِ طلبٍ.
   */
  slowIt("رحلةٌ منتهيةٌ منذُ ساعتَينِ: بلاغٌ بلا طلبٍ لا نسبةٌ إليها", async () => {
    await makeOrder({ status: "completed", minutesAgo: 120, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderIdOrNull(result.value.incidentId)).toBeNull();
    expect(await safetyCounts()).toEqual({ incidents: "1", queued: "1" });
  });

  /**
   * `F2-10` · القرارُ الأوّلُ: ما بعدَ الرحلةِ **نافذةٌ لا عدَمٌ**. وأخطرُ ما
   * يقعُ للراكبِ قد يقعُ **بعدَ** أن يُنهيَ السائقُ الرحلةَ في شاشتِه — ثمَّ
   * يُنزِلُه في مكانٍ آخرَ أو يتبعُه. فرفضُ النداءِ هنا أسوأُ من غيابِ الزرِّ.
   */
  slowIt("رحلةٌ انتهتْ داخلَ النافذةِ: الاستغاثةُ تُقبَلُ وتُنسَبُ إلى طلبِها", async () => {
    const order = await makeOrder({ status: "completed", minutesAgo: 5, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderId(result.value.incidentId)).toBe(order);
  });

  /**
   * حدُّ النافذةِ حدٌّ لا مُنحدَرٌ: ثلاثونَ دقيقةً هي الإعدادُ، فما جاوزَها **لا
   * يُنسَبُ إليه بلاغٌ** ولو بدقيقةٍ — وذلكَ ما يجعلُ النافذةَ نافذةً. وبعدَ
   * `F12-03` لا يعودُ الحدُّ بابَ رفضٍ بل بابَ **تحوُّلٍ**: البلاغُ يُقبَلُ بلا
   * طلبٍ. ولو تسامحَ الحدُّ لظهرَ ههنا `order_id` غيرَ فارغٍ فسقطَت الحالةُ.
   */
  slowIt("رحلةٌ انتهتْ بعدَ النافذةِ بدقيقةٍ: البلاغُ يُقبَلُ بلا نسبةٍ إليها", async () => {
    await makeOrder({ status: "completed", minutesAgo: 31, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderIdOrNull(result.value.incidentId)).toBeNull();
  });

  /**
   * النافذةُ **إعدادٌ بمدينةِ الطلبِ** لا ثابتٌ في الشِّفرةِ (القاعدة 0.3). ولو كانَ
   * الثلاثونَ محفوراً لمرَّ هذا الاختبارُ وسابقُه جميعاً وهوَ كاذبٌ.
   */
  slowIt("إعدادُ المدينةِ يُطَاعُ: توسيعُ النافذةِ يقلبُ الحكمَ بلا تغييرِ شِفرةٍ", async () => {
    await sql`
      update platform_settings set value = '90'::jsonb
      where city_id = ${cityId}::uuid and key = 'sos_post_ride_window_minutes'
    `;
    const order = await makeOrder({ status: "completed", minutesAgo: 60, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderId(result.value.incidentId)).toBe(order);
  });

  /** السّائقُ يُسأَلُ عن التزامٍ قائمٍ عليه: `matched`/`in_progress` لا `searching`. */
  slowIt("سائقٌ مُسنَدٌ إليه `in_progress`: يُنسَبُ الحادثُ إلى طلبِه", async () => {
    const order = await makeOrder({ status: "in_progress", minutesAgo: 4, assigned: true });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: DRIVER_TELEGRAM_ID,
      reporterRole: "driver",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderId(result.value.incidentId)).toBe(order);
  });

  /**
   * الفرقُ بينَ الدّورَين حكمٌ لا تفصيلٌ: طلبٌ في `searching` لا سائقَ فيه بعدُ،
   * **فلا يجوزُ أن يُنسَبَ إلى سائقٍ استغاثةٌ في رحلةٍ لم يلتزمْ بها** — وهذه
   * هيَ الدعوى التي لا تتغيَّرُ، وهيَ ههنا أقوى: النداءُ يُقبَلُ فلو تسامحَ حكمُ
   * الدّورِ لظهرَ `order_id` غيرَ فارغٍ وسقطَت الحالةُ. وبعدَ `F12-03` يصيرُ
   * البلاغُ بلا طلبٍ بمدينةِ **حسابِ السائقِ** لا بمدينةِ طلبٍ ليسَ له.
   */
  slowIt("`searching` لا يُعَدُّ التزاماً على سائقٍ: بلاغٌ بلا طلبٍ لا نسبةٌ إليه", async () => {
    await makeOrder({ status: "searching", minutesAgo: 6, assigned: false });
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: DRIVER_TELEGRAM_ID,
      reporterRole: "driver",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderIdOrNull(result.value.incidentId)).toBeNull();
    const incident = await sql<{ city_id: string; role: string }[]>`
      select city_id::text, reporter_role as role
      from safety_incidents where id = ${result.value.incidentId}::uuid
    `;
    expect(incident[0]).toEqual({ city_id: cityId, role: "driver" });
  });

  /** مسارُ المُعرِّفِ الصّريحِ باقٍ كما كانَ: العودةُ لا تكسرُ مُنادياً قديماً. */
  slowIt("مُعرِّفٌ صريحٌ يملكُه الرّاكبُ: يُقبَلُ كما كانَ قبلَ F8-05", async () => {
    const order = await makeOrder({ status: "matched", minutesAgo: 5, assigned: true });
    const result = await trigger.trigger({
      orderId: order,
      actorTelegramId: RIDER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.incidentId === null) throw new Error("رُفِضَ النّداءُ");
    expect(await incidentOrderId(result.value.incidentId)).toBe(order);
  });

  /** ومُعرِّفٌ صريحٌ لا يملكُه المُنادي يُرَدُّ: الملكيّةُ حكمٌ مكتوبٌ لا ضمنيٌّ. */
  slowIt("مُعرِّفٌ صريحٌ لطلبِ غيرِه: `ORDER_NOT_OWNED`", async () => {
    const order = await makeOrder({ status: "matched", minutesAgo: 5, assigned: true });
    const result = await trigger.trigger({
      orderId: order,
      actorTelegramId: STRANGER_TELEGRAM_ID,
      reporterRole: "rider",
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ incidentId: null, error: "ORDER_NOT_OWNED" });
  });

  /**
   * الدّورُ صارَ يختارُ فرعَ الحلِّ، فرُفِعَ حكمُه إلى أوّلِ الدالّةِ. وههنا
   * يُثبَتُ التّرتيبُ: دورٌ باطلٌ يُرَدُّ قبلَ أن يُسأَلَ عن وجودِ المُبلِّغِ.
   */
  slowIt("دورٌ باطلٌ يُرَدُّ قبلَ البحثِ عن المُبلِّغِ", async () => {
    const result = await trigger.trigger({
      orderId: null,
      actorTelegramId: "999999999",
      reporterRole: "admin" as unknown as SafetyRole,
      reason: "sos",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ incidentId: null, error: "INVALID_REPORTER_ROLE" });
  });

  /** ونافذةُ المنعِ باقيةٌ في مسارِ الحلِّ: ضغطتانِ = حادثٌ واحدٌ وصفٌّ واحدٌ. */
  slowIt("ضغطتانِ بلا مُعرِّفٍ: حادثٌ واحدٌ وصفُّ تسليمٍ واحدٌ", async () => {
    await makeOrder({ status: "matched", minutesAgo: 5, assigned: true });
    const results = await Promise.all([
      trigger.trigger({
        orderId: null,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      }),
      trigger.trigger({
        orderId: null,
        actorTelegramId: RIDER_TELEGRAM_ID,
        reporterRole: "rider",
        reason: "sos",
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.ok && result.value.incidentId !== null)).toHaveLength(
      2,
    );
    const persisted = await sql<{ incidents: string; queued: string }[]>`
      select
        (select count(*)::text from safety_incidents) incidents,
        (select count(*)::text from notification_outbox where kind = 'safety_incident') queued
    `;
    expect(persisted[0]).toEqual({ incidents: "1", queued: "1" });
  });
});
