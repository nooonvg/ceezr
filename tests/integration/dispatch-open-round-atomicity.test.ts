/**
 * الغرض: `BUG-005` — إثبات أنّ فتحَ دورةِ البثِّ صار قراراً ذرّيّاً **في القاعدةِ**،
 *   على PostgreSQL حقيقيّةٍ لا على مزدوجٍ في الذاكرةِ.
 *
 *   المُدَّعى خمسةٌ لا يُقاس أيٌّ منها بقراءةِ الكودِ:
 *   (١) أنّ استدعاءَينِ متزامنَينِ على **اتّصالَينِ منفصلَينِ** لا يفوزُ بهما اثنانِ:
 *       دورةٌ واحدةٌ تُفتَح، ورقمُ الدورةِ يرتفعُ درجةً واحدةً لا درجتَين.
 *   (٢) أنّ عددَ صفوفِ العروضِ هو عددُ الدفعةِ بالضبطِ — لا مضاعفةَ ولا نقصانَ.
 *   (٣) أنّ الخاسرةَ تفشلُ **حسماً** بجوابٍ يصلُها، لا بصمتٍ يُفسَّر نجاحاً، ولا
 *       بانتظارٍ ولا بإعادةِ محاولةٍ.
 *   (٤) أنّ طلباً لم يعُد `searching` لا تُفتَح له دورةٌ ولا يُكتَب له عرضٌ واحدٌ.
 *   (٥) أنّ الفشلَ في منتصفِ الإدخالِ يُرجِعُ كلَّ شيءٍ: لا رقمَ دورةٍ مرفوعاً بلا
 *       عروضٍ، ولا نصفَ جولةٍ.
 *
 *   والحاجزُ في اختبارِ التزاحمِ معاملةٌ مفتوحةٌ تُمسِك قفلَ الصفِّ — لا `sleep`
 *   يُرجى منه أن يصنعَ سباقاً. و`sleep` الوحيدُ هنا يُثبِتُ **الاحتباسَ** لا
 *   يصنعُ السباقَ: تنفيذٌ يقرأُ ثمّ يقارنُ في `JS` كان سيُجيبُ فوراً — بالقبولِ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة قاعدةِ البيانات).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { OpenRoundInput } from "../../packages/application/dispatch/broadcast-offers.ts";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferWriter } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let cityId: CityId;
let orderId: OrderId;
let driverIds: DriverId[] = [];

const EXPIRES_AT = new Date("2030-01-01T00:00:00.000Z");

function input(round: number, entries: readonly DriverId[]): OpenRoundInput {
  return {
    orderId,
    cityId,
    round,
    expiresAt: EXPIRES_AT,
    entries: entries.map((driverId, index) => ({
      driverId,
      score: 0.9 - index / 100,
      distanceKm: (1 + index) as DistanceKm,
    })),
  };
}

/** ما استقرَّ في القاعدةِ فعلاً — الحَكَمُ الوحيدُ، لا ترتيبُ الوعودِ. */
async function settled(): Promise<{
  round: number;
  status: string;
  offers: number;
  rounds: number;
}> {
  const orders = await sql<{ broadcast_round: number; status: string }[]>`
    select broadcast_round, status::text as status from orders where id = ${orderId}
  `;
  const order = orders[0];
  if (order === undefined) throw new Error("لم يُقرأ الطلب");
  const counted = await sql<{ offers: string; rounds: string }[]>`
    select count(*)::text as offers, count(distinct round)::text as rounds
      from order_offers where order_id = ${orderId}
  `;
  return {
    round: order.broadcast_round,
    status: order.status,
    offers: Number(counted[0]?.offers ?? "0"),
    rounds: Number(counted[0]?.rounds ?? "0"),
  };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("ذرّيّةُ فتحِ دورةِ البثّ — BUG-005", () => {
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
      values (${cityId}, 815000::bigint, 'راكبُ الذرّيّة', '+966500815000', 'rider'::user_role, 'ar')
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
    for (const index of [1, 2, 3]) {
      const users = await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role, language_code)
        values (${cityId}, ${815000 + index}::bigint, ${`سائق ${index}`},
                ${`+96650081500${index}`}, 'driver'::user_role, 'ar')
        returning id
      `;
      const userId = users[0]?.id;
      if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
      const drivers = await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, verification_status)
        values (${cityId}, ${userId}, 'verified'::verification_status)
        returning id
      `;
      const driverId = drivers[0]?.id;
      if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
      driverIds.push(driverId as DriverId);
    }

    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
      values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 0)
      returning id
    `;
    const created = orders[0]?.id;
    if (created === undefined) throw new Error("تعذّر إنشاء الطلب");
    orderId = created as OrderId;
  });

  it("١ — طلبٌ باحثٌ: تُفتَح الدورةُ وتُكتَب العروضُ ويرتفعُ الرقمُ درجةً واحدة", async () => {
    const writer = createOfferWriter(sql);
    const opened = await writer.openRound(input(1, driverIds));

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.opened).toBe(true);
    if (!opened.value.opened) return;
    expect(opened.value.offersInserted).toBe(3);
    /**
     * `BUG-003` — تردُّ القاعدةُ معرّفَ كلِّ عرضٍ مُدرَجٍ، فيملكُ البثُّ ما يبني بهِ زرَّ
     * رفضٍ لعرضٍ بعينِه. والمصفوفةُ بطولِ الدفعةِ ومطابقةٌ في `driverId`. والقيدُ
     * الحاسمُ: عددُ العروضِ الذي تُخبرُ به الدالّةُ (`offersInserted`) يساوي طولَ
     * مصفوفةِ المعرّفات (`offers`) — فلا تُفكِّر الدالّةُ عدداً لا تطابقُه المصفوفة.
     */
    expect(opened.value.offers).toHaveLength(3);
    expect(opened.value.offersInserted).toBe(opened.value.offers.length);
    expect(opened.value.offers.map((offer) => offer.driverId)).toEqual(driverIds);

    const state = await settled();
    expect(state.round).toBe(1);
    expect(state.offers).toBe(3);
    expect(state.rounds).toBe(1);
  });

  /**
   * العطلُ بحرفِه: قبلَ `BUG-005` كان الاستدعاءانِ يقرآنِ `broadcast_round = 0`
   * معاً فيكتبانِ الدورةَ ١ مرّتَينِ. والفوزُ هنا يُقاس بما استقرَّ في القاعدةِ.
   */
  it("٢ — استدعاءانِ متزامنانِ على اتّصالَينِ منفصلَين: دورةٌ واحدةٌ لا اثنتان", async () => {
    const first = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const second = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      const results = await Promise.all([
        createOfferWriter(first).openRound(input(1, driverIds)),
        createOfferWriter(second).openRound(input(1, driverIds)),
      ]);

      // لا انفجارَ ولا صمتَ: كلاهما أجاب جواباً مفهوماً.
      expect(results.every((result) => result.ok)).toBe(true);
      const outcomes = results.flatMap((result) => (result.ok ? [result.value] : []));
      expect(outcomes).toHaveLength(2);

      const won = outcomes.filter((outcome) => outcome.opened);
      const lost = outcomes.filter((outcome) => !outcome.opened);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);

      // والخاسرةُ تعرفُ **لماذا** خسِرت: الطلبُ ما يزالُ باحثاً وإنّما سُبِقت للدورةِ.
      const loser = lost[0];
      if (loser === undefined || loser.opened) throw new Error("توقّعنا خاسرةً واحدة");
      expect(loser.refusal).toBe("ROUND_ALREADY_OPENED");

      const state = await settled();
      expect(state.round).toBe(1);
      expect(state.rounds).toBe(1);
      expect(state.offers).toBe(3);
      expect(state.status).toBe("searching");
    } finally {
      await Promise.all([first.end({ timeout: 5 }), second.end({ timeout: 5 })]);
    }
  });

  /**
   * وهذا وحدَه يفصلُ بين حارسٍ في `where` وحارسٍ في `JS`: الثانيةُ تنطلقُ
   * **بينما** معاملةٌ مفتوحةٌ على اتّصالٍ آخرَ قد رفعت الرقمَ ولم تُثبَّت بعدُ.
   */
  it("٣ — الحكمُ يُعاد تقويمُه بعد تثبيتِ معاملةٍ متزامنة، لا على لقطةٍ سابقة", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const racer = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      let settledLate: Awaited<ReturnType<ReturnType<typeof createOfferWriter>["openRound"]>>;
      let pending: ReturnType<ReturnType<typeof createOfferWriter>["openRound"]> | undefined;

      const transaction = holder.begin(async (tx) => {
        await tx`
          update orders set broadcast_round = 1, updated_at = now() where id = ${orderId}
        `;
        pending = createOfferWriter(racer).openRound(input(1, driverIds));
        void pending.then((result) => {
          settledLate = result;
        });
        await Bun.sleep(300);
        // محبوسةٌ في القاعدةِ فعلاً: من يقرأُ ويقارنُ في `JS` كان سيُجيبُ الآن.
        expect(settledLate).toBeUndefined();
      });

      await transaction;
      if (pending === undefined) throw new Error("لم تنطلق المتزاحمة");
      const resolved = await pending;
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.value.opened).toBe(false);
      if (resolved.value.opened) return;
      expect(resolved.value.refusal).toBe("ROUND_ALREADY_OPENED");

      const state = await settled();
      expect(state.round).toBe(1);
      expect(state.offers).toBe(0);
    } finally {
      await holder.end({ timeout: 5 });
      await racer.end({ timeout: 5 });
    }
  });

  it("٤ — طلبٌ لم يعُد باحثاً: لا دورةَ ولا عرضٌ واحد، والحالُ يُذكَر", async () => {
    // سائقٌ ظفرَ بالطلبِ عبرَ `claim_ride` — وهو السباقُ الواقعيُّ لا المفتعَلُ.
    await sql`
      update orders
         set status = 'matched'::order_status,
             assigned_driver_id = ${driverIds[0] ?? null},
             matched_at = now()
       where id = ${orderId}
    `;

    const opened = await createOfferWriter(sql).openRound(input(1, driverIds));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.opened).toBe(false);
    if (opened.value.opened) return;
    expect(opened.value.refusal).toBe("ORDER_NOT_SEARCHING");
    if (opened.value.refusal !== "ORDER_NOT_SEARCHING") return;
    expect(opened.value.status).toBe("matched");

    const state = await settled();
    expect(state.round).toBe(0);
    expect(state.offers).toBe(0);
  });

  it("٥ — طلبٌ لا وجود له يُميَّز عن الطلبِ الذي لم يعُد باحثاً", async () => {
    const missing = await createOfferWriter(sql).openRound({
      ...input(1, driverIds),
      orderId: "00000000-0000-0000-0000-0000000000ff" as OrderId,
    });
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    expect(missing.value.opened).toBe(false);
    if (missing.value.opened) return;
    expect(missing.value.refusal).toBe("ORDER_NOT_FOUND");
  });

  /**
   * الرجوعُ الحقيقيُّ: سائقٌ لا وجودَ له في الدفعةِ يُفشِلُ المفتاحَ الأجنبيَّ
   * **بعدَ** أن رُفِع رقمُ الدورةِ في الجملةِ الأولى. فلو لم تكونا في معاملةٍ
   * واحدةٍ لبقيَ الطلبُ عند دورةٍ لا عروضَ لها — طلبٌ «بُثَّ» ولم يعلم به أحدٌ،
   * وهو أسوأُ من فشلٍ صريحٍ لأنّه صامتٌ.
   */
  it("٦ — فشلُ إدخالِ عرضٍ يُرجِع كلَّ شيء: لا رقمَ دورةٍ ولا نصفَ جولة", async () => {
    const before = await settled();
    expect(before.round).toBe(0);

    const ghost = "00000000-0000-0000-0000-0000000000fe" as DriverId;
    const broken = await createOfferWriter(sql).openRound(
      input(1, [...driverIds.slice(0, 2), ghost]),
    );

    // الفشلُ يصلُ عطلاً صريحاً لا نجاحاً صامتاً.
    expect(broken.ok).toBe(false);

    const after = await settled();
    expect(after.round).toBe(0);
    expect(after.offers).toBe(0);
    expect(after.rounds).toBe(0);
    expect(after.status).toBe("searching");
  });

  /** الدورةُ التاليةُ تُفتَح بعدَ الأولى لا تُمنَع: الحارسُ يمنعُ التكرارَ لا التقدُّمَ. */
  it("٧ — الدورةُ الثانيةُ تُفتَح بعد الأولى، ولا تُكرَّر الأولى", async () => {
    const writer = createOfferWriter(sql);
    const first = await writer.openRound(input(1, driverIds));
    expect(first.ok && first.value.opened).toBe(true);

    const repeated = await writer.openRound(input(1, driverIds));
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.value.opened).toBe(false);

    const second = await writer.openRound(input(2, driverIds));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.opened).toBe(true);

    const state = await settled();
    expect(state.round).toBe(2);
    expect(state.rounds).toBe(2);
    expect(state.offers).toBe(6);
  });
});
