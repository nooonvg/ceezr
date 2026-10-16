/**
 * الغرض: `I1` · `ADR 0286` — إثباتُ حارسِ الإسنادِ الأحاديِّ في الكاتبَينِ الباقيَينِ
 *   (`rider_decide_candidate` · `settle_unsubscribed_negotiation`)، لا في `claim_ride`
 *   وحدَهُ. فحائطُ القاعدةِ (الفهرسُ الجزئيُّ الفريدُ) يمنعُ المخالفةَ، لكنَّ الحارسَ
 *   في كلِّ كاتبٍ هو ما يجعلُ الخطأَ مقصوداً ونظيفاً (`DRIVER_HAS_ACTIVE_ORDER`)
 *   لا اصطداماً خاماً بالفهرسِ.
 *
 *   المُدَّعى أربعةٌ:
 *   (١) أنّ قرارَ الراكبِ بقبولِ مرشَّحٍ يحملُ التزاماً قائماً يُردُّ بـ
 *       `DRIVER_HAS_ACTIVE_ORDER`، ويُحرَّرُ المرشَّحُ (`release_order_candidate`)
 *       فلا يبقى الطلبُ معلَّقاً على مرشَّحٍ لن يُسنَدَ.
 *   (٢) أنّ تسويةَ تفاوضِ القروبِ لسائقٍ يحملُ التزاماً قائماً تُردُّ بنفسِ الرمزِ،
 *       ولا يُسنَدُ الطلبُ ولا يُغلقُ التفاوضُ ولا يُلغى شيءٌ — لا حالةَ نصفَ مكتملةٍ.
 *   (٣) أنّ ما استقرَّ في القاعدةِ بعدَ الرفضِ سليمٌ: الطلبُ باقٍ على حالِهِ،
 *       والتفاوضُ باقٍ مفتوحاً، والمطالبةُ باقيةً منتظرةً.
 *   (٤) صفرُ سائقينَ يظهرونَ ملتزمينَ بأكثرَ منَ التزامٍ واحدٍ في كلِّ توكيدٍ.
 *
 *   تُبذَرُ الجداولُ مباشرةً (طلباتٌ · مطالباتُ · مفاوضاتٌ) لأنَّ المُدَّعى هنا
 *   سلوكُ الدالّةِ الذرّيّةِ لا رحلةُ التأسيسِ — وما فوقَها منَ اختباراتِ التكاملِ
 *   يغطّي الرحلةَ كاملةً.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL (قاعدة PostgreSQL بها
 *   الهجراتُ مطبَّقةً بما فيها `20261016120000_i1_driver_single_engaged_order`).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة قاعدةِ البيانات) وبوابةُ `I1` في جولاتِ السعةِ.
 * ملاحظات مستقبلية: يومَ يتغيّرُ شكلُ بذرِ المفاوضاتِ أو المرشَّحِ يُراجَعُ البذرُ هنا
 *   معَ الهجرةِ لا بعدَها.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let cityId: CityId;
let riderTg: number;
let driverId: string;
let previousWindow: string | null = null;

async function engagedDuplicates(): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from (
      select assigned_driver_id
        from orders
       where assigned_driver_id is not null
         and is_driver_engaged_order_status(status)
       group by assigned_driver_id
      having count(*) > 1
    ) as duplicates
  `;
  return Number(rows[0]?.count ?? "0");
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("I1 · حارسُ الإسنادِ في قرارِ المرشَّحِ وتسويةِ القروبِ — ADR 0286", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id as CityId;
    const prev = await sql<{ value: string }[]>`
      select value::text as value from platform_settings
       where city_id = ${cityId} and key = 'rider_choice_window_seconds'
    `;
    previousWindow = prev[0]?.value ?? null;
  });

  // إعادةُ الإعدادِ بعدَ **كلِّ اختبارٍ** لا بعدَ الملفِّ كلِّهِ: إن انقطعَ ملفٌّ
  // بمهلةٍ أو فشلَ، فالنافذةُ تعودُ إلى قيمةِ البذرِ لا تُلوّثُ من بعده شيئاً.
  async function restoreWindow(): Promise<void> {
    if (previousWindow === null) return;
    await sql`
      update platform_settings set value = to_jsonb(${previousWindow}::numeric)
       where city_id = ${cityId} and key = 'rider_choice_window_seconds'
    `;
  }

  afterEach(async () => {
    await restoreWindow();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability, drivers,
                             riders, users restart identity cascade`;

    await restoreWindow();
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability, drivers,
                             riders, users restart identity cascade`;
    // نافذةُ قرارِ الراكبِ مفعَّلةٌ فتسري المطالباتُ مرشَّحاً لا إسناداً فورياً.
    await sql`
      update platform_settings set value = '15'::jsonb
       where city_id = ${cityId} and key = 'rider_choice_window_seconds'
    `;

    riderTg = 821000;
    const riderUsers = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, ${riderTg}::bigint, 'راكبةُ الحارسَين', '+966500821000', 'rider'::user_role, 'ar')
      returning id
    `;
    const riderUserId = riderUsers[0]?.id;
    if (riderUserId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    const driverUsers = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, 821001::bigint, 'سائقُ الحارسَين', '+966500821001', 'driver'::user_role, 'ar')
      returning id
    `;
    const driverUserId = driverUsers[0]?.id;
    if (driverUserId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
      values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'أ ب ج 8211', 'sedan')
      returning id
    `;
    const driver = drivers[0]?.id;
    if (driver === undefined) throw new Error("تعذّر إنشاء السائق");
    driverId = driver;

    // طلبّانِ للراكبِ: الأولُ يُسنَدُ للسائقِ فيصيرُ التزامَهُ القائمَ، والثاني
    // مسرحُ الاختبارِ.
    for (const pickup of ["39.1925, 21.4858", "39.1935, 21.4868"]) {
      const [lon, lat] = pickup.split(", ").map(Number) as [number, number];
      const orders = await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
        values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
                st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, 1)
        returning id
      `;
      const order = orders[0]?.id;
      if (order === undefined) throw new Error("تعذّر إنشاء الطلب");
      await sql`
        insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
        values (${cityId}, ${order}, ${driverId}, 1, 'pending'::offer_status,
                now() + interval '20 minutes')
      `;
    }
  });

  it("١ — قرارُ الراكبِ بقبولِ مرشَّحٍ ملتزمٍ: رفضٌ نظيفٌ وتحريرُ المرشَّحِ لا تعليقٌ", async () => {
    // التزامُ السائقِ القائمُ: إسنادٌ مشروعٌ للطلبِ الأولِ عبرَ مسارِ القرارِ نفسِهِ.
    const orders = await sql<{ id: string }[]>`
      select id::text from orders where status = 'searching' order by created_at
    `;
    const firstOrder = orders[0]?.id;
    const secondOrder = orders[1]?.id;
    if (firstOrder === undefined || secondOrder === undefined) throw new Error("لم يُبذَر الطلبان");

    const claimFirst = await sql<{ r: Record<string, unknown> }[]>`
      select claim_ride(${firstOrder}::uuid, ${driverId}::uuid) as r
    `;
    // نافذةُ القرارِ مفعَّلةٌ: المطالبةُ الأولى تُمرِّرُ مرشَّحاً لا إسناداً.
    const firstEnvelope = claimFirst[0]?.r as { ok: boolean; error?: string } | undefined;
    if (firstEnvelope?.ok !== true)
      throw new Error(`مطالبةٌ غيرُ متوقعة: ${String(firstEnvelope?.error)}`);

    // المرشَّحةُ على الطلبِ الثاني تقومُ والسائقُ حرٌّ — هذا هو الترتيبُ الذي يجعلُ
    // السباقَ واقعياً: التزامٌ جاءَ بعدَ ترشُّحٍ قائمٍ.
    const claimSecond = await sql<{ r: Record<string, unknown> }[]>`
      select claim_ride(${secondOrder}::uuid, ${driverId}::uuid) as r
    `;
    const secondEnvelope = claimSecond[0]?.r as { ok: boolean; error?: string } | undefined;
    if (secondEnvelope?.ok !== true)
      throw new Error(`مطالبةٌ غيرُ متوقعة: ${String(secondEnvelope?.error)}`);
    const candidate = await sql<{ candidate: string | null }[]>`
      select candidate_driver_id::text as candidate from orders where id = ${secondOrder}::uuid
    `;
    if (candidate[0]?.candidate !== driverId)
      throw new Error("لم تصر المرشحة قائمة على الطلب الثاني");

    // ثمَّ يلتزمُ السائقُ بالأولِ عبرَ مسارِ القرارِ نفسِهِ.
    const acceptFirst = await sql<{ r: Record<string, unknown> }[]>`
      select rider_decide_candidate(${riderTg}::bigint, ${firstOrder}::uuid, ${driverId}::uuid, true) as r
    `;
    const acceptEnvelope = acceptFirst[0]?.r as { ok: boolean; error?: string } | undefined;
    if (acceptEnvelope?.ok !== true)
      throw new Error(`قبولٌ غيرُ متوقَّع: ${String(acceptEnvelope?.error)}`);

    const engaged = await sql<{ count: string }[]>`
      select count(*)::text as count from orders
       where id = ${firstOrder}::uuid and status = 'matched' and assigned_driver_id = ${driverId}::uuid
    `;
    if (engaged[0]?.count !== "1") throw new Error("لم يقع الإسناد للطلب الأول — لا التزام للسائق");

    const decide = await sql<{ r: Record<string, unknown> }[]>`
      select rider_decide_candidate(${riderTg}::bigint, ${secondOrder}::uuid, ${driverId}::uuid, true) as r
    `;
    const decision = decide[0]?.r as { ok: boolean; error?: string } | undefined;
    expect(decision?.ok).toBe(false);
    expect(decision?.error).toBe("DRIVER_HAS_ACTIVE_ORDER");

    // المرشَّحُ حُرِّرَ: لا مرشَّحَ معلَّقاً على سائقٍ لن يُسنَدَ.
    const secondState = await sql<
      { status: string; candidate: string | null; assigned: string | null }[]
    >`
      select status::text as status, candidate_driver_id::text as candidate,
             assigned_driver_id::text as assigned
        from orders where id = ${secondOrder}::uuid
    `;
    const state = secondState[0];
    if (state === undefined) throw new Error("لم يُقرأ الطلب الثاني");
    expect(state.status).toBe("searching");
    expect(state.candidate).toBeNull();
    expect(state.assigned).toBeNull();

    expect(await engagedDuplicates()).toBe(0);
  }, 30_000);

  it("٢ — تسويةُ تفاوضِ قروبٍ لسائقٍ ملتزمٍ: رفضٌ نظيفٌ ولا شيءَ يُغلقُ أو يُسنَدُ", async () => {
    const orders = await sql<{ id: string }[]>`
      select id::text from orders where status = 'searching' order by created_at
    `;
    const engagedOrder = orders[0]?.id;
    const negotiationOrder = orders[1]?.id;
    if (engagedOrder === undefined || negotiationOrder === undefined) {
      throw new Error("لم يُبذَر الطلبان");
    }

    // التزامُ السائقِ القائمُ — إسنادٌ مباشرٌ في القاعدةِ يكفي للحارسِ لأنَّ حكمَهُ
    // على ما استقرَّ لا على مَن أسسَهُ.
    await sql`
      update orders set status = 'matched'::order_status, assigned_driver_id = ${driverId}::uuid,
                        matched_at = now()
       where id = ${engagedOrder}::uuid
    `;

    // تفاوضُ قروبٍ على الطلبِ الثاني: مطالبةٌ منتظرةٌ للسائقِ نفسِهِ.
    // القيدُ `unsubscribed_negotiations_active_requires_claim` يوجبُ أن تقومَ المطالبةُ
    // معَ الحالةِ النشطةِ في العبارةِ نفسِها: تُبذَرُ الحالةُ جمعاً، ثمَّ المطالبةُ،
    // ثمَّ التنشيطُ معاً.
    const negotiations = await sql<{ id: string }[]>`
      insert into unsubscribed_negotiations
        (city_id, order_id, cycle, status, collect_deadline)
      values (${cityId}, ${negotiationOrder}::uuid, 1, 'collecting'::negotiation_status,
              now() + interval '2 minutes')
      returning id
    `;
    const negotiation = negotiations[0]?.id;
    if (negotiation === undefined) throw new Error("تعذّر إنشاء التفاوض");
    const claims = await sql<{ id: string }[]>`
      insert into unsubscribed_claims
        (city_id, negotiation_id, order_id, driver_id, position, outcome, opened_at)
      values (${cityId}, ${negotiation}::uuid, ${negotiationOrder}::uuid, ${driverId}::uuid,
              1, 'waiting'::claim_outcome, now())
      returning id
    `;
    const claim = claims[0]?.id;
    if (claim === undefined) throw new Error("تعذّر إنشاء المطالبة");
    await sql`
      update unsubscribed_negotiations
         set status = 'negotiating'::negotiation_status, active_claim_id = ${claim}::uuid,
             negotiate_deadline = now() + interval '3 minutes'
       where id = ${negotiation}::uuid
    `;

    const settle = await sql<{ r: Record<string, unknown> }[]>`
      select settle_unsubscribed_negotiation(${negotiation}::uuid) as r
    `;
    const envelope = settle[0]?.r as { ok: boolean; error?: string } | undefined;
    expect(envelope?.ok).toBe(false);
    expect(envelope?.error).toBe("DRIVER_HAS_ACTIVE_ORDER");

    // لا حالةَ نصفَ مكتملةٍ: التفاوضُ باقٍ مفتوحاً والمطالبةُ باقيةً منتظرةً والطلبُ
    // باقياً على حالِهِ.
    const negotiationState = await sql<{ status: string; settled: string | null }[]>`
      select status::text as status, settled_at::text as settled
        from unsubscribed_negotiations where id = ${negotiation}::uuid
    `;
    const neg = negotiationState[0];
    if (neg === undefined) throw new Error("لم يُقرأ التفاوض");
    expect(neg.status).toBe("negotiating");
    expect(neg.settled).toBeNull();

    const claimState = await sql<{ outcome: string }[]>`
      select outcome::text as outcome from unsubscribed_claims where id = ${claim}::uuid
    `;
    expect(claimState[0]?.outcome).toBe("waiting");

    const orderState = await sql<{ status: string; assigned: string | null }[]>`
      select status::text as status, assigned_driver_id::text as assigned
        from orders where id = ${negotiationOrder}::uuid
    `;
    const ord = orderState[0];
    if (ord === undefined) throw new Error("لم يُقرأ الطلب");
    expect(ord.status).toBe("searching");
    expect(ord.assigned).toBeNull();

    expect(await engagedDuplicates()).toBe(0);
  }, 30_000);
});
