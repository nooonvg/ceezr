/**
 * الغرض: `WR-08` (ADR 0271) — منفذُ بطاقاتِ العروضِ الميّتةِ على PostGIS: يلتقطُ بطاقةَ العرضِ
 *   المسلَّمةَ غيرَ المغلقةِ التي صارَ عرضُها `expired`/`cancelled` وحدَها، ويشتقُّ المآلَ من
 *   حالتَي العرضِ والطلب، ويقرأُ محادثةَ السائقِ ولغتَه حيّتَين، ويكفُّ بعدَ حدِّ المحاولات،
 *   والإغلاقُ الثاني لا يعيدُ التعديل. والهجرةُ لم تُعلِّم بطاقةً عرضُها حيّ.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { closeDeadOfferCards } from "../../packages/application/dispatch/close-dead-offer-cards.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDeadOfferCardPort } from "../../packages/infrastructure/dispatch/offer-card-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TG = 900_000_811;
const DRIVER_A_TG = 900_000_812;
const DRIVER_B_TG = 900_000_813;
const TGS = [RIDER_TG, DRIVER_A_TG, DRIVER_B_TG];

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let driverA = "";
let driverB = "";

async function makeUser(tg: number, role: "rider" | "driver", lang: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${tg}::bigint, ${role}::user_role, 'مستخدمُ البطاقة', ${`+9665${tg}`}, ${lang})
    returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ المستخدم");
  return user.id;
}

async function makeDriver(tg: number, lang: string): Promise<string> {
  const userId = await makeUser(tg, "driver", lang);
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${userId}::uuid, 'verified'::verification_status) returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائق");
  return driver.id;
}

async function seedOrder(
  status: "searching" | "matched" | "cancelled",
  assigned: string | null = null,
): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label, assigned_driver_id)
    values (${cityId}, ${riderId}, 'transport'::service_type, ${status}::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 'الانطلاق',
            ${assigned}::uuid)
    returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  return order.id;
}

/** عرضٌ وبطاقتُه المسلَّمة (أو غيرُ المسلَّمة إن كانَ `messageId` فارغًا). */
async function seedCard(
  orderId: string,
  driverId: string,
  offerStatus: "pending" | "expired" | "cancelled" | "accepted",
  messageId: string | null,
): Promise<string> {
  const [offer] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${orderId}::uuid, ${driverId}::uuid, 1, ${offerStatus}::offer_status,
            now() + interval '1 minute')
    returning id
  `;
  if (offer === undefined) throw new Error("تعذّر زرعُ العرض");
  const [row] = await sql<{ id: string }[]>`
    insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id, status,
                                     delivered_message_id, delivered_at)
    values (${cityId}, 'offer', ${offer.id}::uuid, ${orderId}::uuid, ${driverId}::uuid,
            ${messageId === null ? "pending" : "delivered"}, ${messageId},
            ${messageId === null ? null : new Date()})
    returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ البطاقة");
  return row.id;
}

async function clear(): Promise<void> {
  const orders = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (${orders})`;
  await sql`delete from order_offers where order_id in (${orders})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

async function cleanupUsers(): Promise<void> {
  const users = sql`select id from users where telegram_id in ${sql(TGS)}`;
  const orders = sql`select o.id from orders o join riders r on r.id = o.rider_id where r.user_id in (${users})`;
  await sql`delete from notification_outbox where order_id in (${orders})`;
  await sql`delete from order_offers where order_id in (${orders})`;
  await sql`delete from orders where id in (${orders})`;
  await sql`delete from drivers where user_id in (${users})`;
  await sql`delete from riders where user_id in (${users})`;
  await sql`delete from audit_log where actor_user_id in (${users})`;
  await sql`delete from users where telegram_id in ${sql(TGS)}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  await cleanupUsers();
  const riderUser = await makeUser(RIDER_TG, "rider", "ar");
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
  driverA = await makeDriver(DRIVER_A_TG, "en");
  driverB = await makeDriver(DRIVER_B_TG, "ar");
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await cleanupUsers();
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-08 — بطاقاتُ العروضِ الميّتة (PostGIS)", () => {
  beforeEach(async () => {
    await clear();
  });

  it("يلتقطُ البطاقةَ المسلَّمةَ ذاتَ العرضِ الميّتِ وحدَها ويشتقُّ المآل", async () => {
    const searching = await seedOrder("searching");
    const expired = await seedCard(searching, driverA, "expired", "5001");
    const taken = await seedCard(await seedOrder("matched", driverB), driverA, "expired", "5002");
    const cancelled = await seedCard(await seedOrder("cancelled"), driverB, "cancelled", "5003");
    await seedCard(searching, driverB, "pending", "5004");
    await seedCard(await seedOrder("searching"), driverB, "expired", null);
    await seedCard(await seedOrder("matched", driverA), driverA, "accepted", "5006");

    const listed = await createDeadOfferCardPort(sql).listDead(cityId as CityId, 20, 5);
    if (!listed.ok) throw new Error(listed.error.detail);
    const byId = new Map(listed.value.map((c) => [c.deliveryId, c]));
    expect([...byId.keys()].sort()).toEqual([expired, taken, cancelled].sort());
    expect(byId.get(expired)?.outcome).toBe("expired");
    expect(byId.get(taken)?.outcome).toBe("taken");
    expect(byId.get(cancelled)?.outcome).toBe("cancelled");
    expect(byId.get(expired)?.chatId).toBe(String(DRIVER_A_TG));
    expect(byId.get(expired)?.languageCode).toBe("en");
    expect(byId.get(cancelled)?.messageId).toBe("5003");
  });

  it("الإغلاقُ يعلّمُ البطاقةَ فلا يعيدُ تعديلَها في المرورِ التالي", async () => {
    const id = await seedCard(await seedOrder("searching"), driverA, "expired", "5101");
    const edits: string[] = [];
    const deps = {
      cards: createDeadOfferCardPort(sql),
      edit: async (_chat: string, messageId: string) => {
        edits.push(messageId);
      },
      text: () => "انتهت",
    };
    const first = await closeDeadOfferCards(cityId as CityId, deps);
    expect(first.ok && first.value.closed).toBe(1);
    const second = await closeDeadOfferCards(cityId as CityId, deps);
    expect(second.ok && second.value.closed).toBe(0);
    expect(edits).toEqual(["5101"]);
    const [row] = await sql<{ closed: boolean }[]>`
      select offer_card_closed_at is not null as closed from notification_outbox where id = ${id}
    `;
    expect(row?.closed).toBe(true);
  });

  it("الخطأُ العابرُ يزيدُ العدّادَ، وبعدَ الحدِّ لا تُلتقطُ البطاقة", async () => {
    const id = await seedCard(await seedOrder("searching"), driverA, "expired", "5201");
    const deps = {
      cards: createDeadOfferCardPort(sql),
      edit: async () => {
        throw new Error("Too Many Requests: retry after 3");
      },
      text: () => "انتهت",
      maxAttempts: 2,
    };
    await closeDeadOfferCards(cityId as CityId, deps);
    await closeDeadOfferCards(cityId as CityId, deps);
    const third = await closeDeadOfferCards(cityId as CityId, deps);
    expect(third.ok && third.value).toEqual({ closed: 0, failed: 0 });
    const [row] = await sql<{ attempts: number; closed: boolean }[]>`
      select offer_card_close_attempts as attempts, offer_card_closed_at is not null as closed
        from notification_outbox where id = ${id}
    `;
    expect(row).toEqual({ attempts: 2, closed: false });
  });

  it("عبارةُ الهجرةِ تعلّمُ البطاقاتِ القديمةَ مغلقةً إلّا ما عرضُه حيّ", async () => {
    const order = await seedOrder("searching");
    const live = await seedCard(order, driverA, "pending", "5301");
    const dead = await seedCard(order, driverB, "expired", "5302");
    const file = readFileSync(
      new URL(
        "../../supabase/migrations/20261012200000_wr_08_offer_card_close.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const update = file.slice(file.indexOf("update notification_outbox"));
    await sql.unsafe(update);
    const rows = await sql<{ id: string; closed: boolean }[]>`
      select id, offer_card_closed_at is not null as closed
        from notification_outbox where id in (${live}::uuid, ${dead}::uuid)
    `;
    const closed = new Map(rows.map((r) => [r.id, r.closed]));
    expect(closed.get(live)).toBe(false);
    expect(closed.get(dead)).toBe(true);
  });

  it("حمولةُ المُطالِبِ لبطاقةِ العرضِ تحملُ الخدمةَ واسمَي المكانَين والملاحظات (20261012200100)", async () => {
    const [order] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label, notes)
      values (${cityId}, ${riderId}, 'delivery'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.6111, 24.4672), 4326)::geography,
              st_setsrid(st_makepoint(39.6200, 24.4700), 4326)::geography,
              'الحرم', 'قباء', 'صندوق صغير')
      returning id
    `;
    if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
    const [offer] = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}, ${order.id}::uuid, ${driverA}::uuid, 1, 'pending', now() + interval '1 minute')
      returning id
    `;
    if (offer === undefined) throw new Error("تعذّر زرعُ العرض");
    await sql`
      insert into notification_outbox (city_id, kind, offer_id, order_id, driver_id, status)
      values (${cityId}, 'offer', ${offer.id}::uuid, ${order.id}::uuid, ${driverA}::uuid, 'pending')
    `;
    let payload: Record<string, unknown> | null = null;
    for (let i = 0; i < 50 && payload === null; i++) {
      const [row] = await sql<
        { r: { delivery: { kind: string; payload: Record<string, unknown> } | null } }[]
      >`
        select claim_notification_delivery() as r`;
      const delivery = row?.r.delivery ?? null;
      if (delivery === null) break;
      if (delivery.kind === "offer" && delivery.payload.offer_id === offer.id)
        payload = delivery.payload;
    }
    expect(payload).toMatchObject({
      offer_id: offer.id,
      order_id: order.id,
      service: "delivery",
      pickup_label: "الحرم",
      dropoff_label: "قباء",
      notes: "صندوق صغير",
    });
  });
});
