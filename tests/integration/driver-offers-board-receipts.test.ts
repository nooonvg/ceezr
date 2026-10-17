/**
 * الغرض: إيصالاتُ لوحِ العروضِ على قاعدةٍ حقيقيةٍ — `LOAD-01 Recovery` (PR #563).
 * الحالة: مُختبَرٌ على قاعدةٍ حقيقيّةٍ — المرحلةُ 6-استكمال.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 *
 * ولِمَ على قاعدةٍ حقيقيّةٍ: أخطاءُ SQL لا تراها مُهايئاتُ الوحدةِ — الحاجزُ
 * `driver_offers_board_receipts` أُسقِطَ مرتينِ في الجولةِ الفعليةِ لأنَّ الاستعلامَ
 * الداخليَّ لم يُنتقِ `d.city_id` بينما الإدراجُ يقرأُه (`dr.city_id`) فرجعَ
 * `STORE_ERROR` على كلِّ إيصالٍ (79 فشلًا في جولةِ التدخينِ `smoke-03`)، ولم يسقطْ
 * شيءٌ في الوحدةِ لأنَّ المُهايئَ لا ينفَّذُ عليهِ SQL أصلًا. فصارَ القياسُ على
 * القاعدةِ الحقيقيّةِ حاجزًا: الإيصالُ **يُسجَّلُ فعلًا** لا أنَّ الدالّةَ تعيدُ
 * `ok` بلا صفٍّ.
 *
 * ## وما لا يقيسُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 * - **لا يقيسُ مسارَ HTTP للإيصالِ** (الجلسةُ والترويسةُ): في `tests/unit`.
 * - **لا يقيسُ منطقَ المعالجِ** (الإيصالُ يُسلِّمُ بالقناةِ): في وحدةِ المعالجِ.
 * - يقيسُ **العقدَ مع القاعدةِ**: الاستعلامُ ينفَّذُ ويُدرجُ ويُكرَّرُ بأمانٍ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { PostgresDriverOfferStore } from "../../packages/infrastructure/driver/driver-offers-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  إيصالاتُ اللوحِ مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_481;
const RIDER_TELEGRAM_ID = 900_000_482;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let riderUserId = "";
let riderId = "";
let offerId = "";

describeIf("LOAD-01 — إيصالاتُ لوحِ العروضِ على القاعدةِ الحقيقيّةِ", () => {
  let store: PostgresDriverOfferStore;

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    // نظافةُ بقايا جولةٍ سابقةٍ لنفسِ المعرفاتِ (اختبارٌ محليٌّ معاد): البذرُ لا
    // يفشلُ مرتينِ — والحذفُ موجَّهٌ بمعرفاتِ هذا الملفِّ وحدَهُ لا تنظيفٌ عامٌّ.
    await sql`delete from driver_offers_board_receipts where driver_id in (
      select d.id from drivers d join users u on u.id = d.user_id
      where u.telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from order_offers where order_id in (
      select o.id from orders o join riders r on r.id = o.rider_id
      join users u on u.id = r.user_id
      where u.telegram_id = ${RIDER_TELEGRAM_ID}::bigint)`;
    await sql`delete from orders where rider_id in (
      select id from riders where user_id in (
        select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)))`;
    await sql`delete from riders where user_id in (
      select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from drivers where user_id in (
      select id from users where telegram_id = ${DRIVER_TELEGRAM_ID}::bigint)`;
    await sql`delete from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)`;
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;

    const [driverUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ الإيصالِ', '+966500000481')
      returning id
    `;
    if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    driverUserId = driverUser.id;
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ح ص ل 481')
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    const [riderUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبُ الإيصالِ', '+966500000482')
      returning id
    `;
    if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبِ");
    riderUserId = riderUser.id;
    const [rider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ في جدولِ الراكبينِ");
    riderId = rider.id;
    const [order] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
      values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 0)
      returning id
    `;
    if (order === undefined) throw new Error("تعذّر إنشاءُ الطلبِ");
    const [offer] = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}, ${order.id}, ${driver.id}, 1, 'pending'::offer_status,
              now() + make_interval(secs => 120))
      returning id
    `;
    if (offer === undefined) throw new Error("تعذّر إنشاءُ العرضِ");
    offerId = offer.id;

    store = new PostgresDriverOfferStore(sql);
  });

  afterAll(async () => {
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  it("الإيصالُ يُسجَّلُ فعلًا في القاعدةِ لا أنَّ الدالّةَ تعيدُ ok بلا صفٍّ", async () => {
    const result = await store.recordBoardReceipts({
      telegramUserId: String(DRIVER_TELEGRAM_ID),
      offerIds: [offerId],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("الإيصالُ رُدَّ بخطأٍ والقاعدةُ حيّةٌ");
    expect(result.value.recorded).toBe(1);
  });

  it("الإيصالُ يحملُ مدينةَ السائقِ ويُثبِتُ وصولَ العرضِ إلى لوحِهِ", async () => {
    const rows = await sql<{ city_id: string }[]>`
      select city_id::text as city_id from driver_offers_board_receipts
      where offer_id = ${offerId}::uuid
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.city_id).toBe(cityId);
  });

  it("الإيصالُ المكرَّرُ آمنٌ: لا صفٌّ ثانٍ ولا فشلٌ — عقدُ التراكمِ", async () => {
    const result = await store.recordBoardReceipts({
      telegramUserId: String(DRIVER_TELEGRAM_ID),
      offerIds: [offerId],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("الإيصالُ المكرَّرُ فشلَ والعقدُ التراكميُّ مكسورٌ");
    expect(result.value.recorded).toBe(0);
    const rows = await sql<{ c: number }[]>`
      select count(*)::int as c from driver_offers_board_receipts where offer_id = ${offerId}::uuid
    `;
    expect(rows[0]?.c).toBe(1);
  });

  it("معرّفٌ غيرُ صالحٍ لا يُسقِطُ الدفعةَ كلَّها ولا يُسجِّلُ شيئًا", async () => {
    const result = await store.recordBoardReceipts({
      telegramUserId: String(DRIVER_TELEGRAM_ID),
      offerIds: ["ليس-معرّفًا"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("المعرّفُ الفاسدُ أسقطَ الدفعةَ");
    expect(result.value.recorded).toBe(0);
  });
});
