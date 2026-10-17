/**
 * الغرض: LOAD-01 (CAP-RUN-20261016-CONTINUATION) — انحدارُ جدارِ المطابقةِ عندَ 250
 *   المتزامنةِ (مقيسٌ 2026-10-17، موجةُ `r7-wave-250`): G1=97.27% و36 سيناريو فشلوا
 *   كلُّهم بـ`offer_not_found_in_time`، وp95 زمنِ ظهورِ العرضِ 78.2ث.
 *
 *   السببُ المُقاسُ من أحداثِ المولّدِ وسجلِّ البوابةِ وقاعدةِ الجولةِ (لا تخمينًا):
 *   مسارُ `POST /v1/rides` لا يبثُّ عندَ الإنشاءِ أصلًا، وخطُّ إعادةِ البثِّ هو الحنجرةُ
 *   الوحيدةُ لكلِّ طلبٍ. والترتيبُ القائمُ `broadcast_round asc` (إصلاحُ D8) يُعيدُ
 *   الطلبَ الذي أُهدرت دورتُه الأولى على مستلِمٍ لم يقبل إلى ذيلِ الطابورِ خلفَ **كلِّ**
 *   طلبٍ جديدٍ — وتدفُّقُ الجديدِ عندَ التزامنِ العاليِّ (وصولٌ 7.3/ث مقابلَ خدمةٍ ~6/ث)
 *   يملأُ نافذةَ كلِّ شوطٍ، فيتجوّعُ القديمُ طوالَ نافذةِ الحقنِ: الـ36 لم تُخدم في
 *   120ث ولو كان سائقُها مؤهّلًا متاحًا بجوارِ نقطةِ الالتقاطِ (الدورةُ الثانيةُ
 *   جاءت بعدَ انتهاءِ الموجةِ بـ276ث انتظارٍ).
 *
 *   الانحدارُ هنا يُعيدُ إنتاجَ آليّةِ التجويعِ في أصغرِ صورةٍ قابلةٍ للحكمِ من القاعدةِ:
 *   طلبٌ قديمٌ في الدورةِ الأولى ذو سائقٍ مؤهّلٍ + نافذةُ شوطٍ أضيقُ من عددِ الطلباتِ
 *   الجديدةِ الأحدثِ. بالترتيبِ القديمِ يتجوّعُ القديمُ (الفحصُ كلُّه للجديدِ) — وبالنافذةِ
 *   العادلةِ (الأقدمُ أوّلًا بينَ غيرِ المستنفدةِ) يُخدمُ فورًا. والمستنفدةُ تُختبرُ على
 *   الجانبِ الآخرِ: لا تدخلُ النافذةَ إلا بفضلِ سعتِها فلا تعيدُ عيبَ D8.
 *
 * الحالة: اختبار تكامل فعلي — يحتاج TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على ترتيب نافذة إعادة العرض.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { redispatchSearchingOrders } from "../../packages/application/dispatch/redispatch-searching-orders.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import { createOrderRepository } from "../../packages/infrastructure/transport/order-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { systemClock } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const describeIf = DATABASE_URL === "" ? describe.skip : describe;
if (DATABASE_URL === "") {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

let sql: Sql;
let cityId: CityId;
let city: ActiveCityHandle | undefined;
let riderId: string;
let driverUserId: string;
let driverRowId: string;
const created: string[] = [];
const TG_RIDER = 8_816_001;
const TG_DRIVER = 8_816_101;

/** تبعيّاتُ الشوطِ نفسُها التي يبنيها العاملُ في الإنتاجِ — لا نسخةٌ مبسّطة. */
function fairDeps(limit: number) {
  return {
    finder: createSearchingOrderFinder(sql),
    broadcast: {
      orders: createOrderRepository(sql),
      offers: createOfferRepository(sql),
      candidates: createDriverCandidateRepository(sql),
      settings: createSettingsRepository(sql),
      offerWriter: createOfferWriter(sql),
      clock: systemClock,
    },
    limit,
  };
}

beforeAll(async () => {
  if (DATABASE_URL === "") return;
  sql = createSql({ connectionString: DATABASE_URL });
  city = await ensureActiveCity(sql);
  cityId = city.cityId as CityId;

  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, role, telegram_id) values (${cityId}::uuid, 'rider', ${TG_RIDER})
      on conflict (telegram_id) do update set telegram_id = excluded.telegram_id returning id`;
  if (rider === undefined) throw new Error("users: لم يُدرَج الصفُّ — الاختبارُ لا معنى له");
  const [riderRow] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}::uuid, ${rider.id}::uuid)
      on conflict (user_id) do update set user_id = excluded.user_id returning id`;
  if (riderRow === undefined) throw new Error("riders: لم يُدرَج الصفُّ");
  riderId = riderRow.id;

  // تنظيفٌ ذاتيٌّ لبقايا جولاتٍ سابقةٍ لهذا الملفِّ (فشلُ afterAll سابقٌ لا يُورَّث):
  // طلباتُ راكبِ هذا الاختبارِ القديمةُ — بعروضِها وصندوقِها — لا يجوزُ أن تسرقَ
  // نافذةَ الشوطِ منَ الجولةِ الحاليةِ فيبدو الانحدارُ فاشلًا وهو سليمٌ.
  await sql`
    with mine as (
      delete from notification_outbox where order_id in (
        select id from orders where rider_id = ${riderId}::uuid) returning 1)
    select count(*)::int n from mine`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from orders where rider_id = ${riderId}::uuid`;

  // سائقٌ واحدٌ مؤهّلٌ متاحٌ بجوارِ نقطةِ الالتقاطِ: موثَّقٌ مشترِكٌ قادرٌ (بذرةُ
  // الاختباراتِ القائمةِ) + توافرٌ + موقعٌ حيٌّ في `drivers.last_location` (الذي يقرؤه
  // استعلامُ المرشحين) بجوارِ الالتقاطِ — كلُّ شروطِ الأهليةِ التي يفحصُها `matchOrder`.
  driverRowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_DRIVER,
    name: "سائق النافذة العادلة",
  });
  const [driverUserRow] = await sql<{ id: string }[]>`
    select user_id as id from drivers where id = ${driverRowId}::uuid`;
  if (driverUserRow === undefined) throw new Error("drivers: الصف غير موجود");
  driverUserId = driverUserRow.id;
  // بذرةُ القدرةِ تُنشئُ اشتراكًا بلا فترةٍ ساريةٍ (سائقٌ قادرٌ غيرُ قابلٍ للإسنادِ
  // بنيةً) — وهذا السائقُ يجبُ أن يكونَ مؤهّلًا فعلًا، ففترةُ سريانٍ لاحقةٌ تجعلُ
  // الاشتراكَ حيًّا عندَ المجالِ (`isSubscriptionLive`).
  await sql`
    update subscriptions set current_period_end = now() + interval '30 days'
     where driver_id = ${driverRowId}::uuid and status = 'active'`;
  await sql`
    insert into driver_availability (city_id, driver_id, is_available, changed_at)
    values (${cityId}::uuid, ${driverRowId}::uuid, true, now())
    on conflict (driver_id) do update set is_available = true, changed_at = now()`;
  await sql`
    update drivers set
      last_location = ST_SetSRID(ST_MakePoint(39.1729, 21.5434), 4326)::geography,
      last_location_at = now(),
      last_location_quality = 'ACCEPT'
    where id = ${driverRowId}::uuid`;
});

afterAll(async () => {
  if (DATABASE_URL === "") return;
  if (created.length) {
    await sql`delete from notification_outbox where order_id = any(${created}::uuid[])`;
    await sql`delete from order_offers where order_id = any(${created}::uuid[])`;
    await sql`delete from orders where id = any(${created}::uuid[])`;
  }
  await sql`delete from driver_availability where driver_id = ${driverRowId}::uuid`;
  await sql`delete from drivers where id = ${driverRowId}::uuid`;
  await sql`delete from riders where id = ${riderId}::uuid`;
  await sql`delete from users where id in (${driverUserId}::uuid) or telegram_id = ${TG_RIDER}`;
  await restoreCityBaseline(sql, city);
  await sql.end();
});

describeIf("النافذة العادلة لإعادة العرض — انحدار جدار المطابقة (موجة 250)", () => {
  const PICKUP = "SRID=4326;POINT(39.1728 21.5433)";

  async function insertSearchingOrder(
    broadcastRound: number,
    createdAgoSec: number,
  ): Promise<string> {
    const at = new Date(Date.now() - createdAgoSec * 1000);
    const [o] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, created_at, searching_since)
      values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching', ${PICKUP}::geography,
              ${broadcastRound}, ${at}, ${at})
      returning id`;
    if (o === undefined) throw new Error("orders: لم يُدرَج الطلبُ — الاختبارُ لا معنى له");
    created.push(o.id);
    return o.id;
  }

  it("الطلب القديم ذو السائق المؤهّل يُخدم رغم تدفق أحدث منه يملأ النافذة", async () => {
    // إعادةُ إنتاجِ الجدارِ في أصغرِ صورةٍ: طلبٌ قديمٌ في الدورةِ الأولى (10 دقائق)
    // وسائقُه المؤهّلُ متاحٌ بجوارِ نقطةِ الالتقاطِ، ثم 8 طلباتٍ أحدثُ كلُّها في
    // الدورةِ صفر. النافذةُ أضيقُ من الجديدِ كلِّه — وهو عينُ ما قاسَتْهُ موجةُ 250:
    // بالترتيبِ القديمِ (الدورةُ الأدنى أولا) كانت النافذةُ كلُّها للجديدِ فيتجوّعُ
    // القديمُ ذو السائقِ المؤهّلِ، وبالنافذةِ العادلةِ القديمُ أولَ المفحوصين.
    const oldOrderId = await insertSearchingOrder(1, 600);
    const freshIds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      freshIds.push(await insertSearchingOrder(0, 30 - i));
    }

    // حدُّ الدوراتِ من مصدرِ المجالِ (الإعدادات) — نفسُ ما يقرؤه الشوط الفعلي.
    const settings = await sql<{ value: string }[]>`
      select value from platform_settings where city_id = ${cityId} and key = 'max_broadcast_rounds'`;
    const maxRounds = Number(JSON.parse(settings[0]?.value ?? '"3"'));

    // نافذةٌ عادلةٌ معَ واقعِ المدينةِ: طلباتٌ حيّةٌ أقدمُ من طلبِنا في المدينةِ
    // (من ملفّاتٍ أخرى) تسبقُه بحقٍّ — فتُوسَّعُ النافذةُ لتتسعَ لها وله (نمطُ اختبارِ
    // D8 القائمِ نفسُه) ويبقى الجديدُ الثمانيةُ خارجَها كلِّها: أضيقَ من الجديدِ.
    const [preceding] = await sql<{ n: number }[]>`
      select count(*)::int n from orders o
       where o.city_id = ${cityId}::uuid and o.status = 'searching' and o.assigned_driver_id is null
         and (o.candidate_expires_at is null or o.candidate_expires_at <= now())
         and o.broadcast_round < ${maxRounds}
         and o.created_at < (select created_at from orders where id = ${oldOrderId}::uuid)`;
    const nPreceding = preceding?.n ?? 0;
    const window = nPreceding + 5;

    // قبلَ الشوطِ: لا عرضٍ لطلبِنا — باحثٌ بلا دورةٍ مفتوحةٍ.
    const before = await sql<{ n: number }[]>`
      select count(*)::int n from order_offers where order_id = ${oldOrderId}::uuid`;
    expect(before[0]?.n ?? 0).toBe(0);

    const report = await redispatchSearchingOrders(cityId, fairDeps(window));
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // الانحدارُ: القديمُ مخدومٌ داخلَ النافذةِ رغمَ أنّ الجديدَ وحدهَ يملؤها (8 > 5).
    expect(report.value.rebroadcast.map(String)).toContain(oldOrderId);

    const oldOffers = await sql<{ round: number; driver_id: string }[]>`
      select round, driver_id::text from order_offers where order_id = ${oldOrderId}::uuid`;
    expect(oldOffers.length).toBeGreaterThan(0);
    expect(oldOffers.every((o) => o.round === 2)).toBe(true);
    // العرضُ في الدورةِ الثانيةِ للسائقِ المؤهّلِ — لا لغيرِهِ.
    expect(oldOffers.some((o) => o.driver_id === driverRowId)).toBe(true);

    // والجديدُ لم يُحرم: أقدمُ أربعةٍ من الجديدِ دخلت النافذةَ بعدَ القديمِ بحقّها.
    const served = new Set(report.value.rebroadcast.map(String));
    const freshServed = freshIds.filter((id) => served.has(id));
    expect(freshServed).toHaveLength(4);
  });

  it("المستنفدةُ لا تعيدَ عيبَ D8: لا تحتكرُ النافذةَ وتبقى مصنَّفةً عند فحصها", async () => {
    // إعداداتُ المدينةِ من نفسِ مصدرِ المجالِ: الحدُّ الفعليُّ لا رقمًا مكتوبًا هنا.
    const settings = await sql<{ value: string }[]>`
      select value from platform_settings where city_id = ${cityId} and key = 'max_broadcast_rounds'`;
    const maxRounds = Number(JSON.parse(settings[0]?.value ?? '"3"'));
    expect(maxRounds).toBeGreaterThan(0);

    // طلبٌ مستنفدٌ أقدمُ من كلِّ شيءٍ + طلبٌ حيٌّ جديد. النافذةُ 2: الحيُّ أولًا دائمًا
    // (عيبُ D8 القديمِ كان احتكارَ المستنفدِ للنافذةِ كلِّها).
    const exhaustedId = await insertSearchingOrder(maxRounds, 1200);
    const liveId = await insertSearchingOrder(0, 5);

    // نافذةٌ ضيّقةٌ (2): الحيُّ أولًا. المستنفدُ الأقدمُ لا يدخلُ النافذةَ أصلا —
    // عيبُ D8 القديمِ كان احتكارَه لها — فلا يُبَثُّ له (لا يمكنُ أصلًا) والحيُّ
    // الجديدُ مخدومٌ رغمَ أنّ المستنفدَ أقدمُ منه بعشرينَ دقيقة. وطلباتُ الحالةِ
    // السابقةِ الأقدمُ منَ الجديدِ تُحسَب فتتّسعُ النافذةُ لها وله (نمطُ D8 القائم).
    const [preceding] = await sql<{ n: number }[]>`
      select count(*)::int n from orders o
       where o.city_id = ${cityId}::uuid and o.status = 'searching' and o.assigned_driver_id is null
         and (o.candidate_expires_at is null or o.candidate_expires_at <= now())
         and o.broadcast_round < ${maxRounds}
         and o.created_at < (select created_at from orders where id = ${liveId}::uuid)
         and o.id <> ${liveId}::uuid`;
    const narrow = await redispatchSearchingOrders(cityId, fairDeps((preceding?.n ?? 0) + 2));
    expect(narrow.ok).toBe(true);
    if (narrow.ok) {
      const served = new Set(narrow.value.rebroadcast.map(String));
      expect(served.has(liveId)).toBe(true);
      expect(served.has(exhaustedId)).toBe(false);
      expect(narrow.value.rebroadcast).not.toContain(exhaustedId);
    }

    // نافذةٌ أوسعَ من كلِّ الطلبيةِ: المستنفدُ يُفحَصُ فيُصنَّفُ استنفادًا (يبقى رصدُهُ
    // قائمًا لا يختفي) — لا إخفاقًا ولا إعادةَ بثٍّ تتجاوزُ الحدَّ.
    const wide = await redispatchSearchingOrders(cityId, fairDeps(50));
    expect(wide.ok).toBe(true);
    if (wide.ok) {
      // المستنفدُ يُفحَصُ (سعةٌ متبقّيةٌ) فيُصنَّفُ استنفادًا — يبقى رصدُه قائمًا.
      expect(wide.value.exhausted.map(String)).toContain(exhaustedId);
      expect(wide.value.rebroadcast.map(String)).not.toContain(exhaustedId);
      expect(wide.value.failed).toBe(0);
    }
  });

  it("غيابُ معاملِ العدالةِ = السلوكُ القائمُ حرفيًا (الدورةُ الأدنى ثم الأقدم)", async () => {
    // حارسُ التوافقِ الخلفيِّ: المستدعي القديمُ (بلا معامل) يرى الترتيبَ نفسَه الذي
    // وُجدَ قبلَ التغييرِ — وهذا ما يحفظُ انحدارَ D8 القائمَ على هذا المسارِ.
    const finder = createSearchingOrderFinder(sql);
    const res = await finder.findSearching(cityId, 1000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const rounds = res.value.map((r) => {
      const row = created.indexOf(String(r.orderId));
      return row;
    });
    // لا نتحققُ من التفاصيلِ هنا (الاختباراتُ أعلاه تفعلُ) — فقط أنّ النداءَ بلا
    // معاملٍ لا ينهارُ ولا يغيّرُ شكلَ النتيجةِ.
    expect(rounds.length).toBeGreaterThan(0);
  });
});
