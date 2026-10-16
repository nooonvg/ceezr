/**
 * الغرض: `I1` · `ADR 0286` — إثباتُ أنّ السائقَ الواحدَ لا يحملُ التزامًا
 *   (طلبَ matched/in_progress) ثانياً، وأنَّ الضمانَ على مستوى القاعدةِ والمسارِ
 *   الذرّيِّ للإسنادِ لا على واجهةِ Mini App وحدها ولا بفحصٍ مسبقٍ.
 *
 *   المُدَّعى خمسةٌ لا يُقاس أيٌّ منها بقراءةِ الكودِ:
 *   (١) أنّ المطالبةَ الأولى تُسنِدُ الطلبَ، والمطالبةَ الثانيةَ بطلبٍ آخرَ
 *       للسائقِ نفسِهِ تُردُّ بـ`DRIVER_HAS_ACTIVE_ORDER` صراحةً — لا صمتَ.
 *   (٢) أنّ سباقاً حقيقياً — السائقُ نفسُهُ يطالبُ طلبَينِ مختلفَينِ على
 *       **اتّصالَينِ منفصلَينِ** معاً — له فائزٌ واحدٌ وخاسرٌ صريحٌ، لا نجاحانِ.
 *       (قبلَ `I1` كانَ هذا يمرُّ: القفلُ على صفِّ الطلبِ لا يمنعُ أخاهُ.)
 *   (٣) أنّ ما استقرَّ في القاعدةِ صفرُ مخالفاتٍ: لا سائقَ يظهرُ ملتزماً
 *       بأكثرَ منَ طلبٍ واحدٍ — وهذا معيارُ القبولِ نصاً.
 *   (٤) أنّ جدارَ القاعدةِ (الفهرسُ الجزئيُّ الفريدُ `I1`) يصمدُ **بمعزلٍ عن
 *       الدوالِّ**: كتابةٌ مباشرةٌ لالتزامٍ ثانٍ للسائقِ نفسِهِ تسقطُ بخطأِ
 *       تفرُّدٍ صريحٍ — فأيُّ مسارِ إسنادٍ مستقبليٍّ أفلتَ منَ الحارسِ يرتطمُ به.
 *   (٥) أنّ الطلبَ المرفوضَ يبقى كما هو (`searching`) لا حالةَ نصفَ مكتملةٍ.
 *
 *   والحَكَمُ في كلِّ توكيدٍ ما استقرَّ في القاعدةِ لا ترتيبُ الوعودِ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL (قاعدة PostgreSQL بها
 *   الهجراتُ مطبَّقةً بما فيها `20261016120000_i1_driver_single_engaged_order`).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة قاعدةِ البيانات) وبوابةُ `I1` في جولاتِ
 *   السعةِ (`GEN-01`/`GROUP-01`/`EVIDENCE-01`).
 * ملاحظات مستقبلية: يومَ يُصبِحُ الالتزامُ القائمُ لغيرِ `matched`/`in_progress`
 *   يُراجَعُ `is_driver_engaged_order_status` ويُعادَ فحصُ هذا الملفِّ معه.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDispatchRpc } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let cityId: CityId;
let driverId: DriverId;
let orderA: OrderId;
let orderB: OrderId;

/** معيارُ القبولِ نصاً: صفرُ سائقينَ يظهرونَ ملتزمينَ بأكثرَ منَ التزامٍ واحدٍ. */
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

/** ما استقرَّ للطلبِ فعلاً — لا ما ردَّته الدالّةُ عن نفسِها. */
async function settled(order: OrderId): Promise<{ status: string; assigned: string | null }> {
  const rows = await sql<{ status: string; assigned_driver_id: string | null }[]>`
    select status::text as status, assigned_driver_id
      from orders where id = ${order}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لم يُقرأ الطلب");
  return { status: row.status, assigned: row.assigned_driver_id };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("I1 · سائقٌ واحدٌ لا يحملُ التزاماً ثانياً — ADR 0286", () => {
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
      values (${cityId}, 817000::bigint, 'راكبةُ الإسناد الأحادي', '+966500817000', 'rider'::user_role, 'ar')
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
      values (${cityId}, 817001::bigint, 'سائقُ الإسناد الأحادي', '+966500817001', 'driver'::user_role, 'ar')
      returning id
    `;
    const driverUserId = driverUsers[0]?.id;
    if (driverUserId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
      values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'أ ب ج 8171', 'sedan')
      returning id
    `;
    const driver = drivers[0]?.id;
    if (driver === undefined) throw new Error("تعذّر إنشاء السائق");
    driverId = driver as DriverId;

    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
      values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 1),
             (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1935, 21.4868), 4326)::geography, 1)
      returning id
    `;
    const a = orders[0]?.id;
    const b = orders[1]?.id;
    if (a === undefined || b === undefined) throw new Error("تعذّر إنشاء الطلبين");
    orderA = a as OrderId;
    orderB = b as OrderId;

    for (const order of [orderA, orderB]) {
      await sql`
        insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
        values (${cityId}, ${order}, ${driverId}, 1, 'pending'::offer_status,
                now() + interval '20 minutes')
      `;
    }
  });

  it("١ — التزامٌ ثانٍ للسائقِ نفسِهِ يُردُّ صراحةً بـDRIVER_HAS_ACTIVE_ORDER", async () => {
    const rpc = createDispatchRpc(sql);

    const first = await rpc.claimRide(orderA, driverId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.claimed).toBe(true);

    const second = await rpc.claimRide(orderB, driverId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.claimed).toBe(false);
    expect(second.value.reason).toBe("DRIVER_HAS_ACTIVE_ORDER");

    // الفائزُ أُسندَ، والخاسرُ بقيَ كما هو — لا حالةَ نصفَ مكتملةٍ.
    const stateA = await settled(orderA);
    const stateB = await settled(orderB);
    expect(stateA.status).toBe("matched");
    expect(stateA.assigned).toBe(driverId);
    expect(stateB.status).toBe("searching");
    expect(stateB.assigned).toBeNull();

    expect(await engagedDuplicates()).toBe(0);
  });

  it("٢ — سباقٌ حقيقيٌّ على اتّصالَينِ: فائزٌ واحدٌ وخاسرٌ صريحٌ لا نجاحانِ", async () => {
    const first = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const second = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      const outcomes = await Promise.all([
        createDispatchRpc(first).claimRide(orderA, driverId),
        createDispatchRpc(second).claimRide(orderB, driverId),
      ]);

      // مغلَّفُ النداءِ ناجحٌ دائماً؛ الحكمُ للحملةِ: `claimed` هيَ الفيصلُ.
      const won = outcomes.filter((outcome) => outcome.ok && outcome.value.claimed);
      const lost = outcomes.filter((outcome) => outcome.ok && !outcome.value.claimed);
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);

      // الخاسرُ يعرفُ **لماذا** خسِر — لا صمتَ ولا رمزٌ غامضٌ.
      if (lost[0]?.ok) {
        expect(lost[0]?.value.reason).toBe("DRIVER_HAS_ACTIVE_ORDER");
      }

      // ما استقرَّ: التزامٌ واحدٌ لا غيرُ، والطلبُ الآخرُ باقٍ على حالِهِ.
      const states = [await settled(orderA), await settled(orderB)];
      const matched = states.filter((state) => state.status === "matched");
      const searching = states.filter((state) => state.status === "searching");
      expect(matched).toHaveLength(1);
      expect(matched[0]?.assigned).toBe(driverId);
      expect(searching).toHaveLength(1);
      expect(searching[0]?.assigned).toBeNull();

      // معيارُ القبولِ نصاً: صفرُ مخالفاتٍ.
      expect(await engagedDuplicates()).toBe(0);
    } finally {
      await Promise.all([first.end({ timeout: 5 }), second.end({ timeout: 5 })]);
    }
  });

  it("٣ — جدارُ القاعدةِ يصمدُ بمعزلٍ عن الدوالِّ: كتابةٌ مباشرةٌ لالتزامٍ ثانٍ تسقطُ بخطأِ تفرُّدٍ", async () => {
    // سائقٌ بلا التزامٍ: أسند لهُ طلباً مباشرةً — تجوزُ.
    await sql`
      update orders set status = 'matched'::order_status, assigned_driver_id = ${driverId},
                        matched_at = now()
       where id = ${orderA}
    `;

    // الالتزامُ الثاني — كتابةٌ مباشرةٌ تتجاوزُ كلَّ دالّةِ إسنادٍ — يجبُ أن تسقطَ
    // بخطأِ تفرُّدٍ صريحٍ (23505) لا أن تمرَّ.
    let uniqueViolation = false;
    let violationCode: string | null = null;
    try {
      await sql`
        update orders set status = 'matched'::order_status, assigned_driver_id = ${driverId},
                           matched_at = now()
         where id = ${orderB}
      `;
    } catch (error) {
      uniqueViolation = true;
      const message = error instanceof Error ? error.message : String(error);
      const codeMatch = /unique constraint .*orders_one_engaged_order_per_driver/.exec(message);
      violationCode = codeMatch !== null ? "23505" : message;
    }
    expect(uniqueViolation).toBe(true);
    expect(violationCode).toBe("23505");

    // وما استقرَّ: التزامٌ واحدٌ فقط — الخاسرُ لم يُكتبْ شيئاً.
    expect(await settled(orderB).then((state) => state.status)).toBe("searching");
    expect(await engagedDuplicates()).toBe(0);
  });
});
