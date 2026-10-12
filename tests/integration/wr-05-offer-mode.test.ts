/**
 * الغرض: `WR-05` (ADR 0264) على PostgreSQL حقيقيٍّ — سياسةُ المبلغِ تُكتَبُ مع الطلبِ في
 *   معاملتِه، والمُدخلُ المعطوبُ يُرفَضُ برمزٍ **قبلَ** إنشاءِ أيِّ طلب، والقيدُ يمنعُ صفّاً
 *   متناقضاً، وقارئُ بطاقةِ السائقِ ومحادثتِه يقرأُ السياسةَ كما كُتِبَت.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { readOrderPlaceExtras } from "../../packages/infrastructure/transport/order-place-extras.ts";
import { createRideRequestCommand } from "../../packages/infrastructure/transport/ride-request-store.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

const RIDER_TELEGRAM_ID = 900_002_571;
/** سائقٌ قادرٌ غيرُ متاحٍ — يُشبِعُ `city_served_services` ولا يُطابَق. */
const DRIVER_TELEGRAM_ID = 900_002_572;

let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";

const ORIGIN = { lat: 21.5433, lng: 39.1728 } as const;
const DESTINATION = { lat: 21.5551, lng: 39.1902 } as const;

function keyFor(label: string): string {
  return `ride:${label}:${crypto.randomUUID()}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  const cityId = cityHandle.cityId;
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب اختبار السعر', '+966500002571')
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = user.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;
  await seedCapableDriver({ sql, cityId, service: "transport", telegramId: DRIVER_TELEGRAM_ID });
});

afterEach(async () => {
  if (DATABASE_URL === undefined || riderId === "") return;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (riderUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${riderUserId}`;
    await sql`delete from users where id = ${riderUserId}`;
  }
  await sql`
    with d as (
      select dr.id from drivers dr join users u on u.id = dr.user_id
      where u.telegram_id = ${DRIVER_TELEGRAM_ID}
    )
    delete from driver_capabilities where driver_id in (select id from d)
  `;
  await sql`
    delete from subscriptions where driver_id in (
      select dr.id from drivers dr join users u on u.id = dr.user_id
      where u.telegram_id = ${DRIVER_TELEGRAM_ID})
  `;
  await sql`
    delete from drivers where user_id in (select id from users where telegram_id = ${DRIVER_TELEGRAM_ID})
  `;
  await sql`delete from users where telegram_id = ${DRIVER_TELEGRAM_ID}`;
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

async function orderCount(): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from orders where rider_id = ${riderId}`;
  return rows[0]?.n ?? -1;
}

async function callPrice(
  label: string,
  mode: string | null,
  amount: number | null,
): Promise<Record<string, unknown>> {
  const rows = await sql.unsafe<{ result: Record<string, unknown> }[]>(
    "select request_ride_with_offer($1, $2, 'transport', $3, $4, $5, $6, null, null, null, null, $7, null, null, $8) as result",
    [
      RIDER_TELEGRAM_ID,
      keyFor(label),
      ORIGIN.lat,
      ORIGIN.lng,
      DESTINATION.lat,
      DESTINATION.lng,
      amount,
      mode,
    ],
  );
  return rows[0]?.result ?? {};
}

function base(label: string) {
  return {
    telegramUserId: String(RIDER_TELEGRAM_ID),
    idempotencyKey: keyFor(label),
    service: "transport" as const,
    origin: ORIGIN,
    destination: DESTINATION,
    notes: null,
  };
}

describeIf("WR-05 — سياسةُ المبلغِ في القاعدة", () => {
  it("محدَّدٌ بمبلغٍ يُكتَبُ مع الطلبِ ويقرؤه قارئُ بطاقةِ السائق", async () => {
    const result = await createRideRequestCommand(sql).create({
      ...base("fixed"),
      offerSar: 40,
      offerMode: "fixed",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.value.accepted) throw new Error("لم يُنشَأ الطلب");
    const orderId = result.value.ride.orderId;
    const [row] = await sql<{ rider_offer_mode: string | null; rider_offer_sar: number | null }[]>`
      select rider_offer_mode, rider_offer_sar from orders where id = ${orderId}`;
    expect(row).toEqual({ rider_offer_mode: "fixed", rider_offer_sar: 40 });
    const extras = (await readOrderPlaceExtras(sql, [orderId])).get(orderId);
    expect(extras?.offerTerms).toEqual({ mode: "fixed", offerSar: 40 });
  });

  it("مسارٌ بلا سياسةٍ (البوت) يُكتَبُ «بلا سعر» لا مبلغاً مُختلَقاً", async () => {
    const result = await createRideRequestCommand(sql).create({ ...base("bot"), offerSar: null });
    if (!result.ok || !result.value.accepted) throw new Error("لم يُنشَأ الطلب");
    const [row] = await sql<{ rider_offer_mode: string | null; rider_offer_sar: number | null }[]>`
      select rider_offer_mode, rider_offer_sar from orders where id = ${result.value.ride.orderId}`;
    expect(row).toEqual({ rider_offer_mode: "open", rider_offer_sar: null });
  });

  it("المعطوبُ يُرفَضُ برمزِه ولا يُنشِئُ طلباً", async () => {
    expect((await callPrice("req", "fixed", null)).error).toBe("OFFER_AMOUNT_REQUIRED");
    expect((await callPrice("zero", "suggested", 0)).error).toBe("OFFER_AMOUNT_INVALID");
    expect((await callPrice("neg", "fixed", -5)).error).toBe("OFFER_AMOUNT_INVALID");
    expect((await callPrice("big", "fixed", 10_001)).error).toBe("OFFER_AMOUNT_INVALID");
    expect((await callPrice("open-amt", "open", 40)).error).toBe("OFFER_AMOUNT_UNEXPECTED");
    expect((await callPrice("mode", "auto", 40)).error).toBe("OFFER_MODE_INVALID");
    expect((await callPrice("null-mode", null, null)).error).toBe("OFFER_MODE_INVALID");
    expect(await orderCount()).toBe(0);
  });

  it("إعادةُ المفتاحِ نفسِه لا تُعيدُ الكتابةَ ولا تُغيِّرُ السياسة", async () => {
    const key = keyFor("replay");
    const command = createRideRequestCommand(sql);
    const first = await command.create({
      ...base("replay"),
      idempotencyKey: key,
      offerSar: 25,
      offerMode: "suggested",
    });
    const second = await command.create({
      ...base("replay"),
      idempotencyKey: key,
      offerSar: null,
      offerMode: "open",
    });
    if (!first.ok || !first.value.accepted || !second.ok || !second.value.accepted) {
      throw new Error("لم يُنشَأ الطلب");
    }
    expect(second.value.ride.orderId).toBe(first.value.ride.orderId);
    const [row] = await sql<{ rider_offer_mode: string | null; rider_offer_sar: number | null }[]>`
      select rider_offer_mode, rider_offer_sar from orders where id = ${first.value.ride.orderId}`;
    expect(row).toEqual({ rider_offer_mode: "suggested", rider_offer_sar: 25 });
    expect(await orderCount()).toBe(1);
  });

  it("القيدُ يمنعُ صفّاً متناقضاً: محدَّدٌ بلا مبلغ، أو «بلا سعر» بمبلغ", async () => {
    const result = await createRideRequestCommand(sql).create({
      ...base("constraint"),
      offerSar: 40,
      offerMode: "fixed",
    });
    if (!result.ok || !result.value.accepted) throw new Error("لم يُنشَأ الطلب");
    const id = result.value.ride.orderId;
    const rejectedBy = async (statement: () => Promise<unknown>): Promise<string> => {
      try {
        await statement();
        return "accepted";
      } catch (error) {
        return (error as { code?: string }).code ?? "unknown";
      }
    };
    // 23514 = check_violation — القيدُ نفسُه لا عطبٌ آخر.
    expect(
      await rejectedBy(() => sql`update orders set rider_offer_sar = null where id = ${id}`),
    ).toBe("23514");
    expect(
      await rejectedBy(() => sql`update orders set rider_offer_mode = 'open' where id = ${id}`),
    ).toBe("23514");
    expect(
      await rejectedBy(() => sql`update orders set rider_offer_mode = 'auto' where id = ${id}`),
    ).toBe("23514");
  });
});
