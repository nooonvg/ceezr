/**
 * الغرض: `BUG-008` — إثباتُ أنّ `claim_ride` تُميّزُ «إعادةَ تسليمٍ لنقرةِ الفائزِ
 *   نفسِه» من «سُبِقتُ»، على PostgreSQL حقيقيّةٍ لا على مزدوجٍ في الذاكرة.
 *
 *   المُدَّعى ستّةٌ لا يُقاس أيٌّ منها بقراءةِ الكودِ:
 *   (١) أنّ المطالبةَ الأولى الصحيحةَ تُسنِدُ الطلبَ وتُخرِجُ `duplicate=false`.
 *   (٢) أنّ سباقاً حقيقيّاً بين سائقَينِ على **اتّصالَينِ منفصلَينِ** له فائزٌ
 *       واحدٌ وخاسرٌ **صريحٌ** بـ`ORDER_NOT_CLAIMABLE` — لا صمتَ ولا نجاحَينِ.
 *   (٣) أنّ إعادةَ المطالبةِ من الفائزِ نفسِه تخرجُ **نجاحاً** بـ`duplicate=true`
 *       وبنفسِ لحظةِ الإسنادِ المحفوظةِ — لا رسالةَ خسارةٍ كاذبةً.
 *   (٤) أنّ الخاسرَ يبقى خاسراً وإن أعادَ المحاولةَ — فالتكرارُ لا يُنصِّبُ فائزاً.
 *   (٥) أنّ مسارَ التكرارِ **لا يكتبُ شيئاً**: عرضٌ مقبولٌ واحدٌ، وصفُّ تدقيقٍ
 *       واحدٌ، ولا حالةَ نصفَ مكتملةٍ.
 *   (٦) أنّ طلباً انتهى (`completed`/`cancelled`) لا يُقرأُ تكراراً وإن بقيَ اسمُ
 *       السائقِ في `assigned_driver_id` — فلا نجاحٌ كاذبٌ في الاتّجاهِ المعاكس.
 *
 *   والحَكَمُ في كلِّ توكيدٍ ما استقرَّ في القاعدةِ لا ترتيبُ الوعودِ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة قاعدةِ البيانات).
 * ملاحظات مستقبلية: يومَ يُسنَدُ طلبٌ بغيرِ `orders.assigned_driver_id` يُبطَلُ
 *   هذا التمييزُ كلُّه — فيُراجَعُ هذا الملفُّ مع الهجرةِ لا بعدَها.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDispatchRpc } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let cityId: CityId;
let orderId: OrderId;
let driverIds: DriverId[] = [];

/** ما استقرَّ في القاعدةِ فعلاً — لا ما ردَّته الدالّةُ عن نفسِها. */
async function settled(): Promise<{
  status: string;
  assigned: string | null;
  matchedAt: string | null;
  accepted: number;
  pending: number;
  cancelled: number;
  claimedAudits: number;
}> {
  const orders = await sql<
    { status: string; assigned_driver_id: string | null; matched_at: string | null }[]
  >`
    select status::text as status, assigned_driver_id, matched_at::text as matched_at
      from orders where id = ${orderId}
  `;
  const order = orders[0];
  if (order === undefined) throw new Error("لم يُقرأ الطلب");
  const offers = await sql<{ status: string; count: string }[]>`
    select status::text as status, count(*)::text as count
      from order_offers where order_id = ${orderId} group by status
  `;
  const of = (status: string) => Number(offers.find((row) => row.status === status)?.count ?? "0");
  const audits = await sql<{ count: string }[]>`
    select count(*)::text as count from audit_log
     where entity_id = ${orderId} and action = 'order.claimed'
  `;
  return {
    status: order.status,
    assigned: order.assigned_driver_id,
    matchedAt: order.matched_at,
    accepted: of("accepted"),
    pending: of("pending"),
    cancelled: of("cancelled"),
    claimedAudits: Number(audits[0]?.count ?? "0"),
  };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("تمييزُ التسليمِ المكرَّرِ من فقدانِ السباق — BUG-008", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    const riderUsers = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, 816000::bigint, 'راكبُ التكرار', '+966500816000', 'rider'::user_role, 'ar')
      returning id
    `;
    const riderUserId = riderUsers[0]?.id;
    if (riderUserId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    driverIds = [];
    for (const index of [1, 2]) {
      const users = await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role, language_code)
        values (${cityId}, ${816000 + index}::bigint, ${`سائقُ التكرار ${index}`},
                ${`+96650081600${index}`}, 'driver'::user_role, 'ar')
        returning id
      `;
      const userId = users[0]?.id;
      if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
      const drivers = await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
        values (${cityId}, ${userId}, 'verified'::verification_status,
                ${`أ ب ج 100${index}`}, 'sedan')
        returning id
      `;
      const driverId = drivers[0]?.id;
      if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
      driverIds.push(driverId as DriverId);
    }

    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
      values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 1)
      returning id
    `;
    const created = orders[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء الطلب");
    orderId = created as OrderId;

    for (const driverId of driverIds) {
      await sql`
        insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
        values (${cityId}, ${orderId}, ${driverId}, 1, 'pending'::offer_status,
                now() + interval '20 minutes')
      `;
    }
  });

  it("١ — مطالبةٌ صحيحةٌ أوّلَ مرّة: إسنادٌ واقعٌ و`duplicate=false`", async () => {
    const winner = driverIds[0];
    if (winner === undefined) throw new Error("لا سائق");
    const claim = await createDispatchRpc(sql).claimRide(orderId, winner);

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.claimed).toBe(true);
    expect(claim.value.duplicate).toBe(false);
    // الراكبُ يخرجُ في الإسنادِ الواقعِ ليُخطَر مرّةً واحدة.
    expect(claim.value.rider).not.toBeNull();

    const state = await settled();
    expect(state.status).toBe("matched");
    expect(state.assigned).toBe(winner);
    expect(state.accepted).toBe(1);
    expect(state.pending).toBe(0);
    expect(state.cancelled).toBe(1);
    expect(state.claimedAudits).toBe(1);
  });

  /**
   * السباقُ الحقيقيُّ: اتّصالانِ منفصلانِ ينطلقانِ معاً. والفوزُ يُقاس بما
   * استقرَّ في القاعدةِ لا بترتيبِ الوعودِ — ولذلك يُقرأُ `assigned_driver_id`.
   */
  it("٢ — سباقٌ بين سائقَينِ على اتّصالَينِ منفصلَين: فائزٌ واحدٌ وخاسرٌ صريح", async () => {
    const [alpha, beta] = driverIds;
    if (alpha === undefined || beta === undefined) throw new Error("سائقانِ مطلوبان");

    const first = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const second = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      const results = await Promise.all([
        createDispatchRpc(first).claimRide(orderId, alpha),
        createDispatchRpc(second).claimRide(orderId, beta),
      ]);

      // لا انفجارَ ولا صمتَ: كلاهما أجابَ جواباً مفهوماً.
      expect(results.every((result) => result.ok)).toBe(true);
      const outcomes = results.flatMap((result) => (result.ok ? [result.value] : []));
      expect(outcomes).toHaveLength(2);

      const won = outcomes.filter((outcome) => outcome.claimed);
      const lost = outcomes.filter((outcome) => !outcome.claimed);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);

      // الفائزُ إسنادٌ أوّلُ لا تكرارٌ، والخاسرُ يعرفُ **لماذا** خسِر.
      expect(won[0]?.duplicate).toBe(false);
      expect(lost[0]?.duplicate).toBe(false);
      expect(lost[0]?.reason).toBe("ORDER_NOT_CLAIMABLE");

      const state = await settled();
      expect(state.status).toBe("matched");
      expect([String(alpha), String(beta)]).toContain(String(state.assigned));
      expect(state.accepted).toBe(1);
      expect(state.pending).toBe(0);
      expect(state.claimedAudits).toBe(1);
    } finally {
      await Promise.all([first.end({ timeout: 5 }), second.end({ timeout: 5 })]);
    }
  });

  /**
   * العطلُ بحرفِه: قبلَ `BUG-008` كان هذا النداءُ يخرجُ `ORDER_NOT_CLAIMABLE`
   * فيُقالُ للفائزِ «سبقك سائق آخر» عن رحلةٍ هي رحلتُه.
   */
  it("٣ — إعادةُ مطالبةِ الفائزِ نفسِه: نجاحٌ `duplicate=true` بنفسِ لحظةِ الإسناد", async () => {
    const winner = driverIds[0];
    if (winner === undefined) throw new Error("لا سائق");
    const rpc = createDispatchRpc(sql);

    const firstClaim = await rpc.claimRide(orderId, winner);
    expect(firstClaim.ok && firstClaim.value.claimed).toBe(true);
    const afterFirst = await settled();

    const repeat = await rpc.claimRide(orderId, winner);
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.value.claimed).toBe(true);
    expect(repeat.value.duplicate).toBe(true);
    expect(repeat.value.reason).toBeNull();
    // ولا راكبَ في المغلَّفِ: أُخطِرَ مرّةً، وإخطارُه ثانيةً أثرٌ مكرَّر.
    expect(repeat.value.rider).toBeNull();
    expect(repeat.value.cityId).toBe(cityId);

    // والحالةُ لم تتحرّك حرفاً: لا كتابةَ في مسارِ التكرار.
    const afterRepeat = await settled();
    expect(afterRepeat).toEqual(afterFirst);
    expect(afterRepeat.accepted).toBe(1);
    expect(afterRepeat.claimedAudits).toBe(1);
  });

  it("٤ — الخاسرُ يبقى خاسراً وإن أعادَ المحاولة: التكرارُ لا يُنصِّبُ فائزاً", async () => {
    const [winner, loser] = driverIds;
    if (winner === undefined || loser === undefined) throw new Error("سائقانِ مطلوبان");
    const rpc = createDispatchRpc(sql);

    expect((await rpc.claimRide(orderId, winner)).ok).toBe(true);

    for (const attempt of [1, 2]) {
      const lost = await rpc.claimRide(orderId, loser);
      expect(lost.ok).toBe(true);
      if (!lost.ok) return;
      expect(lost.value.claimed).toBe(false);
      expect(lost.value.duplicate).toBe(false);
      expect(lost.value.reason).toBe("ORDER_NOT_CLAIMABLE");
      expect(attempt).toBeGreaterThan(0);
    }

    const state = await settled();
    expect(state.assigned).toBe(winner);
    expect(state.accepted).toBe(1);
    expect(state.claimedAudits).toBe(1);
  });

  it("٥ — الرحلةُ الجارية: الفائزُ ما زالَ صاحبَ الإسنادِ لا مسبوقاً", async () => {
    const winner = driverIds[0];
    if (winner === undefined) throw new Error("لا سائق");
    const rpc = createDispatchRpc(sql);
    expect((await rpc.claimRide(orderId, winner)).ok).toBe(true);

    await sql`
      update orders set status = 'in_progress'::order_status where id = ${orderId}
    `;

    const repeat = await rpc.claimRide(orderId, winner);
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.value.claimed).toBe(true);
    expect(repeat.value.duplicate).toBe(true);

    const state = await settled();
    expect(state.status).toBe("in_progress");
    expect(state.accepted).toBe(1);
    expect(state.claimedAudits).toBe(1);
  });

  /**
   * الاتّجاهُ المعاكس: التمييزُ لا يجوز أن يُنتِجَ نجاحاً على طلبٍ انتهى. اسمُ
   * السائقِ باقٍ في `assigned_driver_id` بعدَ الإكمالِ — والالتزامُ ليس قائماً.
   */
  it("٦ — طلبٌ انتهى لا يُقرأُ تكراراً: جوابٌ حاسمٌ لا نجاحٌ كاذب", async () => {
    const winner = driverIds[0];
    if (winner === undefined) throw new Error("لا سائق");
    const rpc = createDispatchRpc(sql);
    expect((await rpc.claimRide(orderId, winner)).ok).toBe(true);

    for (const status of ["completed", "cancelled"]) {
      await sql`
        update orders set status = ${status}::order_status where id = ${orderId}
      `;
      const late = await rpc.claimRide(orderId, winner);
      expect(late.ok).toBe(true);
      if (!late.ok) return;
      expect(late.value.claimed).toBe(false);
      expect(late.value.duplicate).toBe(false);
      expect(late.value.reason).toBe("ORDER_NOT_CLAIMABLE");
    }

    const state = await settled();
    expect(state.accepted).toBe(1);
    expect(state.claimedAudits).toBe(1);
  });

  /**
   * التسليمُ المكرَّرُ **بينما** معاملةُ الفائزِ لم تُثبَّت بعدُ: سباقٌ حقيقيٌّ
   * في لحظتِه، فالجوابُ الحاسمُ `ORDER_NOT_CLAIMABLE` صحيحٌ — والمهمُّ أنّه لا
   * ينتظرُ ولا يترك حالةً نصفَ مكتملةٍ، ثمّ يصيرُ تكراراً بعدَ التثبيتِ.
   */
  it("٧ — تسليمٌ ثانٍ قبلَ تثبيتِ الأوّلِ: حاسمٌ في لحظتِه ثمّ تكرارٌ بعدَ التثبيت", async () => {
    const winner = driverIds[0];
    if (winner === undefined) throw new Error("لا سائق");
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const racer = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      let during:
        | Awaited<ReturnType<ReturnType<typeof createDispatchRpc>["claimRide"]>>
        | undefined;

      await holder.begin(async (tx) => {
        await tx`select claim_ride(${orderId}::uuid, ${winner}::uuid) as result`;
        during = await createDispatchRpc(racer).claimRide(orderId, winner);
      });

      if (during === undefined) throw new Error("لم ينطلق التسليمُ الثاني");
      expect(during.ok).toBe(true);
      if (!during.ok) return;
      // لا انتظارَ ولا نجاحٌ مزدوج: الجوابُ حاسمٌ على ما استقرَّ حتى تلك اللحظة.
      expect(during.value.claimed).toBe(false);
      expect(during.value.reason).toBe("ORDER_NOT_CLAIMABLE");

      // وبعدَ التثبيتِ يصيرُ التسليمُ المكرَّرُ نجاحاً — مرّةً واحدةً في الأثر.
      const after = await createDispatchRpc(racer).claimRide(orderId, winner);
      expect(after.ok).toBe(true);
      if (!after.ok) return;
      expect(after.value.claimed).toBe(true);
      expect(after.value.duplicate).toBe(true);

      const state = await settled();
      expect(state.status).toBe("matched");
      expect(state.assigned).toBe(winner);
      expect(state.accepted).toBe(1);
      expect(state.pending).toBe(0);
      expect(state.claimedAudits).toBe(1);
    } finally {
      await holder.end({ timeout: 5 });
      await racer.end({ timeout: 5 });
    }
  });
});
