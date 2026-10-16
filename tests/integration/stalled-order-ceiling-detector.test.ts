/**
 * الغرض: قياسُ كاشفِ تجاوزِ السقفِ (`F12-20`) على قاعدةٍ حقيقيّةٍ — أنَّ
 *   `detect_ceiling_exceeded_orders` يُحصي طلباتِ `in_progress` التي تجاوزَتْ
 *   سقفَ `tracking_link_max_lifetime_minutes`، ولا يُحصي الطلباتِ المنتهيةَ
 *   ولا الجاريةَ تحتَ السقفِ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * الحاكم: docs/adr/0216-ceiling-exceeded-detector.md
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

interface Row {
  readonly order_id: string;
  readonly status: string;
  readonly elapsed_minutes: number;
  readonly ceiling_minutes: number;
  readonly ceiling_source: string;
}

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let secondDriverUserId = "";
let driverId = "";

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  // تعافي ذاتيّ: مخلّفاتُ جولةٍ سابقةٍ (اختبارٌ فشل قبل تنظيفِه) لا تُسقِطُ
  // هذا الملفَ إلى الأبد — تُفكُّ إسناداتُها ثم تُحذفُ قبلَ البذرِ.
  await sql`
    update orders set assigned_driver_id = null, status = 'cancelled'
     where assigned_driver_id in (
       select id from drivers where user_id in (
         select id from users where telegram_id in (900_000_501, 900_000_502)))`;
  await sql`
    delete from order_offers where order_id in (
      select id from orders where rider_id in (
        select id from riders where user_id in (
          select id from users where telegram_id in (900_000_501, 900_000_502))))`;
  await sql`
    delete from orders where rider_id in (
      select id from riders where user_id in (
        select id from users where telegram_id in (900_000_501, 900_000_502)))`;
  await sql`
    delete from drivers where user_id in (
      select id from users where telegram_id in (900_000_501, 900_000_502))`;
  await sql`
    delete from riders where user_id in (
      select id from users where telegram_id in (900_000_501, 900_000_502))`;
  await sql`
    delete from audit_log where actor_user_id in (
      select id from users where telegram_id in (900_000_501, 900_000_502))`;
  await sql`delete from users where telegram_id in (900_000_501, 900_000_502)`;
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_501, 'rider', 'راكبُ السقفِ', '+966500000501')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, 900_000_502, 'driver', 'سائقُ السقفِ', '+966500000502')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUser.id}, 'verified'::verification_status, 'سيدان', 'ر س د 502')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

beforeEach(async () => {
  if (DATABASE_URL === undefined || riderId === "") return;
  // I1 (ADR 0286): فهرسُ الالتزامِ الواحدِ يرفضُ التزامًا ثانيًا لسائقٍ لا يزالُ
  // التزامُ اختبارٍ سابقٍ حيًّا — فتُنهى التزاماتُ هذا الملفِّ قبلَ كلِّ اختبارٍ.
  await sql`update orders set status = 'completed', completed_at = now()
             where rider_id = ${riderId}::uuid and is_driver_engaged_order_status(status)`;
});

afterAll(async () => {
  if (DATABASE_URL !== undefined && secondDriverUserId !== "") {
    // أوّلاً: فكُّ إسنادِ طلباتِه (قيدُ FK) ثم حذفُ السائقِ فالمستخدمِ.
    await sql`update orders set assigned_driver_id = null, status = 'cancelled'
               where assigned_driver_id in (select id from drivers where user_id = ${secondDriverUserId}::uuid)`;
    await sql`delete from drivers where user_id = ${secondDriverUserId}::uuid`;
    await sql`delete from users where id = ${secondDriverUserId}::uuid`;
  }
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") {
    await sql`delete from drivers where id = ${driverId}`;
  }
  await sql`delete from users where telegram_id in (900_000_501, 900_000_502)`;
  if (cityHandle !== undefined) {
    await restoreCityBaseline(sql, cityHandle);
  }
});

async function createOrder(
  startedMinutesAgo: number,
  targetDriverId: string = driverId,
): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, assigned_driver_id, started_at)
    values (
      ${cityId}, ${riderId}, 'transport', 'in_progress',
      st_setsrid(st_makepoint(39.1925, 21.4858), 4326),
      ${targetDriverId},
      now() - (${startedMinutesAgo}::integer || ' minutes')::interval
    )
    returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return order.id;
}

describeIf("F12-20 — كاشفُ تجاوزِ السقفِ", () => {
  it("لا يُحصي طلباتٍ تحتَ السقفِ", async () => {
    await createOrder(10); // 10 دقائق — تحتَ 720
    const rows = await sql<Row[]>`
      select * from detect_ceiling_exceeded_orders(${cityId}::uuid, 100)
    `;
    const found = rows.filter((r) => r.status === "in_progress");
    // قد تكون هناك طلباتٌ أخرى من اختباراتٍ سابقة، لكن ليسَ هذا
    expect(found.length).toBe(0);
  });

  it("يُحصي طلباتٍ تجاوزَتْ السقفَ", async () => {
    const orderId = await createOrder(721); // 721 دقيقة — فوقَ 720
    const rows = await sql<Row[]>`
      select * from detect_ceiling_exceeded_orders(${cityId}::uuid, 100)
    `;
    const found = rows.find((r) => r.order_id === orderId);
    expect(found).toBeDefined();
    expect(found?.status).toBe("in_progress");
    expect(found?.elapsed_minutes).toBeGreaterThanOrEqual(721);
    expect(found?.ceiling_minutes).toBe(720);
  });

  it("لا يُحصي طلباتٍ منتهيةً", async () => {
    const orderId = await createOrder(800);
    await sql`update orders set status = 'completed', completed_at = now() where id = ${orderId}`;
    const rows = await sql<Row[]>`
      select * from detect_ceiling_exceeded_orders(${cityId}::uuid, 100)
    `;
    const found = rows.find((r) => r.order_id === orderId);
    expect(found).toBeUndefined();
  });

  it("يُرتِّبُ الأطولَ عمراً أوّلاً", async () => {
    // I1 (ADR 0286): لا التزامَينِ لسائقٍ واحدٍ — فالطلبُ الأطولُ لسائقٍ ثانٍ.
    const secondTelegramId = 900_500_000 + Math.floor(Math.random() * 100_000);
    const secondDriverUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${secondTelegramId}, 'driver', 'سائقُ سقفٍ ثانٍ', '+966500000502')
      returning id`;
    const secondUserId = secondDriverUser[0]?.id;
    if (secondUserId === undefined) throw new Error("SECOND_DRIVER_USER_MISSING");
    secondDriverUserId = secondUserId;
    const secondDriver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}, ${secondUserId}, 'verified'::verification_status)
      returning id`;
    const secondDriverId = secondDriver[0]?.id;
    if (secondDriverId === undefined) throw new Error("SECOND_DRIVER_MISSING");
    const shortOrder = await createOrder(730);
    const longOrder = await createOrder(800, secondDriverId);
    const rows = await sql<Row[]>`
      select * from detect_ceiling_exceeded_orders(${cityId}::uuid, 100)
    `;
    const shortRow = rows.findIndex((r) => r.order_id === shortOrder);
    const longRow = rows.findIndex((r) => r.order_id === longOrder);
    expect(longRow).toBeGreaterThanOrEqual(0);
    expect(shortRow).toBeGreaterThanOrEqual(0);
    expect(longRow).toBeLessThan(shortRow); // الأطولُ أوّلاً
  });
});
