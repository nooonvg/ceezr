/**
 * الغرض: `WR-10` — منفذُ بطاقاتِ القروبِ المنتهيةِ على PostGIS: يلتقطُ الدورةَ المغلقةَ ذاتَ
 *   البطاقةِ غيرِ المغلقةِ وحدَها، ويشتقُّ المآلَ من طورِ الطلب، ويكفُّ بعدَ حدِّ المحاولات،
 *   والإغلاقُ الثاني لا يعيدُ التعديل.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { closeStaleGroupCards } from "../../packages/application/dispatch/close-stale-group-cards.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createStaleGroupCardPort } from "../../packages/infrastructure/dispatch/negotiation-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TG = 900_000_611;
const PICKUP = { lat: 21.4858, lng: 39.1925 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let riderUserId = "";

async function seedOrder(status: "searching" | "cancelled"): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
    values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography, 'نقطةُ الانطلاق'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  if (status === "cancelled") {
    await sql`update orders set status = 'cancelled'::order_status where id = ${order.id}`;
  }
  return order.id;
}

async function seedCycle(
  orderId: string,
  status: "collecting" | "cancelled" | "exhausted",
  messageId: number | null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into unsubscribed_negotiations (city_id, order_id, cycle, status, group_message_id, collect_deadline)
    values (${cityId}, ${orderId}, 1, ${status}::negotiation_status, ${messageId}, now() + interval '1 minute')
    returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الدورة");
  return row.id;
}

async function clear(): Promise<void> {
  const orders = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from unsubscribed_negotiations where order_id in (${orders})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكبُ القروب', '+966500000611') returning id
  `;
  if (user === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderUserId = user.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${user.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await clear();
    await sql`delete from riders where id = ${riderId}`;
  }
  if (riderUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${riderUserId}`;
    await sql`delete from users where id = ${riderUserId}`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-10 — بطاقاتُ القروبِ المنتهية (PostGIS)", () => {
  it("يلتقطُ الدورةَ المغلقةَ ذاتَ البطاقةِ وحدَها ويشتقُّ المآلَ من طورِ الطلب", async () => {
    await clear();
    const port = createStaleGroupCardPort(sql);
    const superseded = await seedCycle(await seedOrder("searching"), "exhausted", 7001);
    const cancelled = await seedCycle(await seedOrder("cancelled"), "cancelled", 7002);
    await seedCycle(await seedOrder("searching"), "collecting", 7003);
    await seedCycle(await seedOrder("cancelled"), "cancelled", null);

    const listed = await port.listStale(cityId as CityId, 20, 5);
    if (!listed.ok) throw new Error(listed.error.detail);
    const ids = listed.value.map((c) => c.negotiationId).sort();
    expect(ids).toEqual([superseded, cancelled].sort());
    expect(listed.value.every((c) => c.outcome === "closed")).toBe(true);
    expect(listed.value.find((c) => c.negotiationId === cancelled)?.messageId).toBe("7002");
    expect(listed.value[0]?.groupId).toMatch(/^-\d+$/);
  });

  it("الإغلاقُ يعلّمُ البطاقةَ فلا يعيدُ تعديلَها في المرورِ التالي", async () => {
    await clear();
    const id = await seedCycle(await seedOrder("cancelled"), "cancelled", 7101);
    const edits: string[] = [];
    const deps = {
      cards: createStaleGroupCardPort(sql),
      edit: async (_chat: string, messageId: string) => {
        edits.push(messageId);
      },
      text: () => "انتهت",
    };
    const first = await closeStaleGroupCards(cityId as CityId, deps);
    expect(first.ok && first.value.closed).toBe(1);
    const second = await closeStaleGroupCards(cityId as CityId, deps);
    expect(second.ok && second.value.closed).toBe(0);
    expect(edits).toEqual(["7101"]);
    const [row] = await sql<{ closed: boolean }[]>`
      select group_card_closed_at is not null as closed from unsubscribed_negotiations where id = ${id}
    `;
    expect(row?.closed).toBe(true);
  });

  it("الخطأُ العابرُ يزيدُ العدّادَ، وبعدَ الحدِّ لا تُلتقطُ البطاقة", async () => {
    await clear();
    const id = await seedCycle(await seedOrder("cancelled"), "cancelled", 7201);
    const deps = {
      cards: createStaleGroupCardPort(sql),
      edit: async () => {
        throw new Error("Too Many Requests: retry after 3");
      },
      text: () => "انتهت",
      maxAttempts: 2,
    };
    await closeStaleGroupCards(cityId as CityId, deps);
    await closeStaleGroupCards(cityId as CityId, deps);
    const third = await closeStaleGroupCards(cityId as CityId, deps);
    expect(third.ok && third.value).toEqual({ closed: 0, failed: 0 });
    const [row] = await sql<{ attempts: number; closed: boolean }[]>`
      select group_card_close_attempts as attempts, group_card_closed_at is not null as closed
        from unsubscribed_negotiations where id = ${id}
    `;
    expect(row).toEqual({ attempts: 2, closed: false });
  });
});
