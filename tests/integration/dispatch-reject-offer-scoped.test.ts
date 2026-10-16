/**
 * الغرض: `BUG-003` — إثباتٌ على PostgreSQL حقيقيّةٍ أنّ الرفضَ يَصوبُ على **عرضٍ
 *   واحدٍ بمعرّفِه**، فلا يُلغي عرضَ الجولةِ الثانيةِ عرضَ الجولةِ الأولى المعلَّقَ
 *   للسائقِ نفسِه على الطلبِ نفسِه.
 *
 *   المُدَّعى ثلاثةٌ لا يُقاس أيٌّ منها بقراءةِ الكودِ:
 *   (١) سائقٌ له عرضانِ معلَّقانِ في جولتَينِ مختلفتَينِ على الطلبِ نفسِه: رفضُ
 *       عرضِ الجولةِ الثانيةِ بمعرّفِه يُغيّرُ صفَّه وحدَه إلى `rejected`، ويتركُ
 *       عرضَ الجولةِ الأولى `pending` لم يُمَسَّ.
 *   (٢) الرفضُ بمعرّفِ عرضٍ ينتمي إلى سائقٍ آخر لا يُصيبُ صفاً واحداً: `driver_id`
 *       في الشرطِ يَحرُسُ أن لا يرفضَ سائقٌ عرضَ غيرِه.
 *   (٣) عرضٌ مقبولٌ أو منتهٍ لا يُرفضُ بأثرٍ رجعيّ: `status = 'pending'` في الشرطِ
 *       يَحرُسُ أن لا يُعكَسَ قرارٌ حُسِم.
 *
 *   وهذا الاختبارُ كانَ سيفشلُ على الكودِ القديمِ: كان الرفضُ يُصيبُ بالاسمِ
 *   `(order_id, driver_id)` كلَّ عرضٍ معلَّقٍ، فيُصبحُ عرضُ الجولةِ الأولى
 *   `rejected` أيضًا — وهو العطلُ الذي وُجِدَ `BUG-003` ليُغلقَه.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة قاعدةِ البيانات).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createOfferDecisionPort,
  createOfferWriter,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import type { CityId, DriverId, OfferId, OrderId } from "../../packages/shared/kernel/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;
let cityId: CityId;
let orderId: OrderId;
let driverId: DriverId;
let otherDriverId: DriverId;

const EXPIRES_AT = new Date("2030-01-01T00:00:00.000Z");

function roundInput(round: number, driver: DriverId) {
  return {
    orderId,
    cityId,
    round,
    expiresAt: EXPIRES_AT,
    entries: [
      {
        driverId: driver,
        score: 0.9,
        distanceKm: 1 as DistanceKm,
      },
    ],
  };
}

interface OfferRow {
  id: string;
  round: number;
  status: string;
}

async function offersForDriver(driver: DriverId): Promise<OfferRow[]> {
  const rows = await sql<OfferRow[]>`
    select id, round, status::text as status
      from order_offers
     where order_id = ${orderId} and driver_id = ${driver}
     order by round
  `;
  return rows;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("تحديدُ نطاقِ الرفضِ بمعرّفِ عرضٍ واحدٍ — BUG-003", () => {
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
      values (${cityId}, 816000::bigint, 'راكبُ الرفضِ', '+966500816000', 'rider'::user_role, 'ar')
      returning id
    `;
    const riderUserId = riderUsers[0]?.id;
    if (riderUserId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    const createdDrivers: DriverId[] = [];
    for (const index of [1, 2]) {
      const users = await sql<{ id: string }[]>`
        insert into users (city_id, telegram_id, full_name, phone, role, language_code)
        values (${cityId}, ${816000 + index}::bigint, ${`سائق ${index}`},
                ${`+96650081600${index}`}, 'driver'::user_role, 'ar')
        returning id
      `;
      const userId = users[0]?.id;
      if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
      const drivers = await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, verification_status)
        values (${cityId}, ${userId}, 'verified'::verification_status)
        returning id
      `;
      const driver = drivers[0]?.id;
      if (driver === undefined) throw new Error("تعذّر إنشاء السائق");
      createdDrivers.push(driver as DriverId);
    }
    driverId = createdDrivers[0] as DriverId;
    otherDriverId = createdDrivers[1] as DriverId;

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

  it("١ — رفضُ عرضِ الجولةِ الثانيةِ بمعرّفِه يتركُ عرضَ الجولةِ الأولى معلَّقاً", async () => {
    const writer = createOfferWriter(sql);

    /** الجولةُ الأولى: عرضٌ معلَّقٌ واحدٌ للسائقِ. */
    const firstOpened = await writer.openRound(roundInput(1, driverId));
    expect(firstOpened.ok).toBe(true);
    if (!firstOpened.ok) return;
    expect(firstOpened.value.opened).toBe(true);
    if (!firstOpened.value.opened) return;
    expect(firstOpened.value.offers).toHaveLength(1);
    const firstOfferId = firstOpened.value.offers[0]?.offerId as OfferId | undefined;
    expect(firstOfferId).toBeDefined();

    /** الجولةُ الثانية: عرضٌ معلَّقٌ ثانٍ للسائقِ نفسِه على الطلبِ نفسِه. */
    const secondOpened = await writer.openRound(roundInput(2, driverId));
    expect(secondOpened.ok).toBe(true);
    if (!secondOpened.ok) return;
    expect(secondOpened.value.opened).toBe(true);
    if (!secondOpened.value.opened) return;
    expect(secondOpened.value.offers).toHaveLength(1);
    const secondOfferId = secondOpened.value.offers[0]?.offerId as OfferId | undefined;
    expect(secondOfferId).toBeDefined();
    expect(secondOfferId).not.toBe(firstOfferId);

    /** الرفضُ يَصوبُ على عرضِ الجولةِ الثانيةِ وحدَه بمعرّفِه. */
    const rejected = await createOfferDecisionPort(sql).reject(secondOfferId as OfferId, driverId);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value).toBe(true);

    /** الحَكَمُ ما استقرَّ في القاعدةِ: عرضُ الجولةِ الثانيةِ `rejected`، والأولى `pending`. */
    const rows = await offersForDriver(driverId);
    expect(rows).toHaveLength(2);
    const firstRow = rows.find((row) => row.round === 1);
    const secondRow = rows.find((row) => row.round === 2);
    expect(firstRow?.status).toBe("pending");
    expect(secondRow?.status).toBe("rejected");
  });

  it("٢ — الرفضُ بمعرّفِ عرضِ سائقٍ آخر لا يُصيبُ صفاً", async () => {
    const writer = createOfferWriter(sql);
    const opened = await writer.openRound(roundInput(1, driverId));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.opened).toBe(true);
    if (!opened.value.opened) return;
    const offerId = opened.value.offers[0]?.offerId as OfferId | undefined;
    expect(offerId).toBeDefined();

    /** سائقٌ آخر يرفضُ بمعرّفِ عرضٍ لا يملكُه: `driver_id` في الشرطِ يَحرُسُ الملكيّةَ. */
    const rejected = await createOfferDecisionPort(sql).reject(offerId as OfferId, otherDriverId);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value).toBe(false);

    /** العرضُ لم يُمَسَّ — لا يزالُ معلَّقاً. */
    const rows = await offersForDriver(driverId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
  });

  it("٣ — عرضٌ مقبولٌ لا يُرفضُ بأثرٍ رجعيّ", async () => {
    const writer = createOfferWriter(sql);
    const opened = await writer.openRound(roundInput(1, driverId));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.opened).toBe(true);
    if (!opened.value.opened) return;
    const offerId = opened.value.offers[0]?.offerId as OfferId | undefined;
    expect(offerId).toBeDefined();

    /** القبولُ يُسنِدُ الطلبَ للسائقِ ويُلغي بقيةَ عروضِه المعلَّقةِ ذرّياً. */
    const claimed = await sql<{ ok: boolean }[]>`
      select (claim_ride(${orderId}::uuid, ${driverId}::uuid)->>'ok')::boolean as ok
    `;
    expect(claimed[0]?.ok).toBe(true);

    /** الرفضُ على عرضٍ مقبولٍ لا يُغيّرُ شيئاً: `status = 'pending'` يَحرُسُ البابَ. */
    const rejected = await createOfferDecisionPort(sql).reject(offerId as OfferId, driverId);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.value).toBe(false);

    const rows = await offersForDriver(driverId);
    expect(rows[0]?.status).toBe("accepted");
  });
});
