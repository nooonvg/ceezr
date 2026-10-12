/**
 * الغرض: `WR-04` (ADR 0267) — تنبيهُ الطرفِ الآخرِ برسالةِ محادثةٍ جديدةٍ على قاعدةٍ حقيقيّة:
 *   صفٌّ مؤجَّلٌ ومجمَّعٌ في `notification_outbox`، بلا نصِّ الرسالة، والمُطالِبُ يقرأُ
 *   محادثةَ المستقبِلِ ولغتَه وهل قرأَ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const DRIVER_TG = 900_000_471;
const RIDER_TG = 900_000_473;
const STRANGER_TG = 900_000_474;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
const userIds: string[] = [];
const driverIds: string[] = [];
let driverId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly status?: string;
  readonly [key: string]: unknown;
}

async function one(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّة");
  return row.result;
}

function post(tg: number, orderId: string, clientId: string, body: string): Promise<Payload> {
  return one(sql<{ result: Payload }[]>`
    select post_order_message(${tg}::bigint, ${orderId}::uuid, ${clientId}::uuid, ${body}) as result
  `);
}

function markRead(tg: number, orderId: string, seq: number): Promise<Payload> {
  return one(sql<{ result: Payload }[]>`
    select mark_order_messages_read(${tg}::bigint, ${orderId}::uuid, ${seq}::bigint) as result
  `);
}

async function seedOrder(service: "transport" | "delivery", claim: boolean): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label)
    values (
      ${cityId}, ${riderId}, ${service}::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'نقطةُ الانطلاق', 'الحرم'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  if (!claim) return order.id;
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${driverId}, 1, 'pending'::offer_status, now() + interval '2 minutes')
  `;
  const claimed = await one(sql<{ result: Payload }[]>`
    select claim_ride(${order.id}::uuid, ${driverId}::uuid) as result
  `);
  if (claimed.ok !== true) throw new Error(`تعذّر الإسناد: ${String(claimed.error)}`);
  return order.id;
}

async function clearOrders(): Promise<void> {
  const orders = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from order_messages where order_id in (${orders})`;
  await sql`delete from order_message_reads where order_id in (${orders})`;
  await sql`delete from notification_outbox where order_id in (${orders})`;
  await sql`delete from order_offers where order_id in (${orders})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const seedDriver = async (tg: number, name: string) => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${tg}, 'driver', ${name}, ${`+9665000${tg % 100_000}`}) returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ السائق");
    userIds.push(user.id);
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ح ب ${tg % 10_000}`})
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائق");
    driverIds.push(driver.id);
    await sql`
      insert into driver_availability (driver_id, city_id, is_available)
      values (${driver.id}, ${cityId}, true)
      on conflict (driver_id) do update set is_available = true
    `;
    return driver.id;
  };
  driverId = await seedDriver(DRIVER_TG, "خالد السائق");

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'مريم الأنصارية', '+966500000473') returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبة");
  userIds.push(riderUser.id);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبة");
  riderId = rider.id;

  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TG}, 'rider', 'غريب', '+966500000474') returning id
  `;
  if (stranger !== undefined) userIds.push(stranger.id);
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") await clearOrders();
  for (const id of driverIds) {
    await sql`delete from notification_outbox where driver_id = ${id}`;
    await sql`delete from order_offers where driver_id = ${id}`;
    await sql`delete from driver_availability where driver_id = ${id}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of driverIds) await sql`delete from drivers where id = ${id}`;
  for (const id of userIds) {
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

interface Notice {
  readonly id: string;
  readonly status: string;
  readonly recipient_user_id: string;
  readonly next_attempt_at: Date;
  readonly dedup_key: string;
  readonly payload: Record<string, unknown>;
}

function notices(orderId: string): Promise<Notice[]> {
  return sql<Notice[]>`
    select id, status, recipient_user_id, next_attempt_at, dedup_key, payload
      from notification_outbox
     where kind = 'order_chat_message' and order_id = ${orderId}::uuid
     order by created_at, id
  `;
}

async function userIdOf(tg: number): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from users where telegram_id = ${tg}`;
  if (row === undefined) throw new Error("لا مستخدم");
  return row.id;
}

/** يجعلُ تنبيهاتِ الطلبِ مستحقّةً الآن ويطالبُ بها وحدَها (الصفوفُ المعلَّقةُ الأخرى تُحذَف). */
async function claimDue(orderId: string): Promise<Payload[]> {
  await sql`delete from notification_outbox where status in ('pending', 'sending') and (order_id is distinct from ${orderId}::uuid)`;
  await sql`update notification_outbox set next_attempt_at = now() where order_id = ${orderId}::uuid and status = 'pending'`;
  const seen: Payload[] = [];
  for (let i = 0; i < 6; i += 1) {
    const r = await one(sql<{ result: Payload }[]>`select claim_notification_delivery() as result`);
    if (r.undeliverable !== undefined) continue;
    const d = r.delivery as Payload | null;
    if (d === null || d === undefined) break;
    seen.push(d);
    await sql`
      update notification_outbox set status = 'delivered', delivered_at = now(),
             delivered_message_id = 'm', claim_token = null, claimed_at = null
       where id = ${String(d.delivery_id)}::uuid`;
  }
  return seen;
}

describeIf("WR-04 — تنبيهُ رسالةِ المحادثةِ الجديدةِ للطرفِ الآخر (ADR 0267)", () => {
  it("رسالةُ الراكبِ تودعُ تنبيهاً واحداً للسائقِ مؤجَّلاً، بلا نصِّ الرسالةِ في الحمولة", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    const body = "أنا عند البوابة الشمالية رقم 7";
    const sent = await post(RIDER_TG, orderId, crypto.randomUUID(), body);
    expect(sent.status).toBe("added");

    const rows = await notices(orderId);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.status).toBe("pending");
    expect(row?.recipient_user_id).toBe(await userIdOf(DRIVER_TG));
    expect(row?.payload).toMatchObject({
      order_id: orderId,
      sender_role: "rider",
      recipient_role: "driver",
      seq: (sent.message as Payload).seq,
    });
    expect(JSON.stringify(row?.payload)).not.toContain("البوابة");
    // مؤجَّلٌ بالإعدادِ (20 ثانيةً افتراضاً) لا فوريّ.
    expect((row?.next_attempt_at.getTime() ?? 0) - Date.now()).toBeGreaterThan(10_000);
  });

  it("رسائلُ متتاليةٌ قبلَ الإرسالِ تُطوى في تنبيهٍ واحد، وإعادةُ الإرسالِ لا تُنبِّه", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    const clientId = crypto.randomUUID();
    await post(RIDER_TG, orderId, clientId, "الأولى");
    await post(RIDER_TG, orderId, crypto.randomUUID(), "الثانية");
    await post(RIDER_TG, orderId, crypto.randomUUID(), "الثالثة");
    expect((await post(RIDER_TG, orderId, clientId, "الأولى")).status).toBe("duplicate");
    expect(await notices(orderId)).toHaveLength(1);
  });

  it("كلُّ طرفٍ يُنبَّهُ برسالةِ الآخرِ وحدَه، لا برسالتِه هو", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "مرحبا");
    await post(DRIVER_TG, orderId, crypto.randomUUID(), "أهلاً");
    const rows = await notices(orderId);
    expect(rows.map((r) => r.payload.recipient_role).sort()).toEqual(["driver", "rider"]);
  });

  it("بعدَ تنبيهٍ مُسلَّمٍ لا تنبيهَ ثانٍ داخلَ مهلةِ التهدئة، وبعدَها يعودُ", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "الأولى");
    const [first] = await notices(orderId);
    await sql`update notification_outbox set status = 'delivered', delivered_at = now(), delivered_message_id = 'm' where id = ${first?.id ?? ""}::uuid`;
    await post(RIDER_TG, orderId, crypto.randomUUID(), "الثانية");
    expect(await notices(orderId)).toHaveLength(1);

    await sql`update notification_outbox set delivered_at = now() - interval '10 minutes' where id = ${first?.id ?? ""}::uuid`;
    const third = await post(RIDER_TG, orderId, crypto.randomUUID(), "الثالثة");
    const rows = await notices(orderId);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.payload.seq).toBe((third.message as Payload).seq);
  });

  it("المُطالِبُ يُرفِقُ محادثةَ المستقبِلِ ولغتَه وطورَ الطلب، و`read` إن قرأَها داخلَ التطبيق", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "هل أنت قريب؟");
    let [delivery] = await claimDue(orderId);
    expect(delivery?.kind).toBe("order_chat_message");
    expect(delivery?.payload).toMatchObject({
      chat_id: String(DRIVER_TG),
      language: "ar",
      order_status: "matched",
      read: false,
      recipient_role: "driver",
    });

    // تنبيهٌ ثانٍ (بعدَ التهدئة) قرأَ السائقُ رسالتَه قبلَ موعدِه ⇒ `read: true`.
    await sql`update notification_outbox set delivered_at = now() - interval '10 minutes' where order_id = ${orderId}::uuid`;
    const sent = await post(RIDER_TG, orderId, crypto.randomUUID(), "أنا هنا");
    const seq = Number((sent.message as Payload).seq);
    expect((await markRead(DRIVER_TG, orderId, seq)).ok).toBe(true);
    [delivery] = await claimDue(orderId);
    expect(delivery?.payload).toMatchObject({ read: true });
  });

  it("الطرفُ الثالثُ لا يكتبُ فلا يُنبِّهُ أحداً", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    expect((await post(STRANGER_TG, orderId, crypto.randomUUID(), "مرحبا")).ok).toBe(false);
    expect(await notices(orderId)).toHaveLength(0);
  });
});
