/**
 * الغرض: `WR-04` — محادثةُ طرفَي الطلبِ على قاعدةٍ حقيقيّةٍ: من يقرأُ ومن يكتبُ،
 *   ومتى تُغلَقُ، وأنَّ إعادةَ الإرسالِ لا تُكرِّرُ، وأنَّ الطرفَ الثالثَ يُرَدُّ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 *
 * الإسنادُ يُصنَعُ بـ`claim_ride` كما في الإنتاجِ لا بتحديثٍ يدويٍّ للحالة، والإنهاءُ
 * بـ`driver_complete_ride` — فالحكمُ يُقاسُ على حالاتٍ تقعُ فعلاً.
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

const DRIVER_TG = 900_000_461;
const OTHER_DRIVER_TG = 900_000_462;
const RIDER_TG = 900_000_463;
const STRANGER_TG = 900_000_464;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
const userIds: string[] = [];
const driverIds: string[] = [];
let driverId = "";
let otherDriverId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly status?: string;
  readonly [key: string]: unknown;
}

interface Message {
  readonly id: string;
  readonly seq: number;
  readonly sender_role: string;
  readonly mine: boolean;
  readonly body: string;
  readonly client_message_id: string | null;
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

function postKind(
  tg: number,
  orderId: string,
  clientId: string,
  kind: string,
  payload: unknown,
): Promise<Payload> {
  // نصٌّ يُمرَّرُ كما هو: عددٌ هائلٌ (`1e400`) لا يُكتَبُ في JavaScript إلّا نصًّا.
  const json =
    payload === null ? null : typeof payload === "string" ? payload : JSON.stringify(payload);
  return one(sql<{ result: Payload }[]>`
    select post_order_message_kind(
      ${tg}::bigint, ${orderId}::uuid, ${clientId}::uuid, ${kind}, null, ${json}::text::jsonb
    ) as result
  `);
}

function list(tg: number, orderId: string, after = 0): Promise<Payload> {
  return one(sql<{ result: Payload }[]>`
    select list_order_messages(${tg}::bigint, ${orderId}::uuid, ${after}::bigint, 200) as result
  `);
}

function markRead(tg: number, orderId: string, seq: number): Promise<Payload> {
  return one(sql<{ result: Payload }[]>`
    select mark_order_messages_read(${tg}::bigint, ${orderId}::uuid, ${seq}::bigint) as result
  `);
}

function messagesOf(payload: Payload): readonly Message[] {
  return (payload.messages ?? []) as readonly Message[];
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
  otherDriverId = await seedDriver(OTHER_DRIVER_TG, "سائق آخر");

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'مريم الأنصارية', '+966500000463') returning id
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
    values (${cityId}, ${STRANGER_TG}, 'rider', 'غريب', '+966500000464') returning id
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

describeIf("WR-04 — محادثةُ طرفَي الطلبِ على قاعدةٍ حقيقيّة", () => {
  it("لا غرفةَ قبلَ الإسناد: الطلبُ الذي يبحثُ لا محادثةَ له", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", false);
    expect((await list(RIDER_TG, orderId)).error).toBe("CHAT_NOT_FOUND");
    expect((await post(RIDER_TG, orderId, crypto.randomUUID(), "مرحبا")).error).toBe(
      "CHAT_NOT_FOUND",
    );
  });

  it("الطرفانِ يتبادلانِ الرسائلَ وتُحفَظُ بترتيبِها، ويرى كلٌّ منهما الطرفَ الآخرَ", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);

    const first = await post(RIDER_TG, orderId, crypto.randomUUID(), "أنا عند البوابة الشمالية");
    expect(first.ok).toBe(true);
    expect(first.status).toBe("added");
    const reply = await post(DRIVER_TG, orderId, crypto.randomUUID(), "وصلت خلال دقيقتين");
    expect(reply.status).toBe("added");

    const riderView = await list(RIDER_TG, orderId);
    expect(riderView.ok).toBe(true);
    expect(riderView.my_role).toBe("rider");
    expect((riderView.counterpart as { first_name: string }).first_name).toBe("خالد");
    expect((riderView.order as { writable: boolean; service: string }).writable).toBe(true);
    const riderMessages = messagesOf(riderView);
    expect(riderMessages.map((m) => m.body)).toEqual([
      "أنا عند البوابة الشمالية",
      "وصلت خلال دقيقتين",
    ]);
    expect(riderMessages.map((m) => m.mine)).toEqual([true, false]);
    expect(riderMessages[0]?.seq).toBeLessThan(riderMessages[1]?.seq ?? 0);
    // رسالةُ السائقِ لم يقرأها الراكبُ بعدُ.
    expect(riderView.unread).toBe(1);
    // معرّفُ العميلِ يُعادُ لصاحبِه وحدَه.
    expect(riderMessages[1]?.client_message_id).toBeNull();

    const driverView = await list(DRIVER_TG, orderId);
    expect(driverView.my_role).toBe("driver");
    expect((driverView.counterpart as { first_name: string }).first_name).toBe("مريم");
    expect(messagesOf(driverView).map((m) => m.mine)).toEqual([false, true]);
  });

  it("الاسترجاعُ بعدَ آخرِ تسلسلٍ يُعيدُ الجديدَ وحدَه — لا فقدَ ولا تكرار", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "١");
    const seen = messagesOf(await list(DRIVER_TG, orderId));
    const lastSeen = seen[seen.length - 1]?.seq ?? 0;
    await post(RIDER_TG, orderId, crypto.randomUUID(), "٢");
    await post(DRIVER_TG, orderId, crypto.randomUUID(), "٣");
    const fresh = messagesOf(await list(DRIVER_TG, orderId, lastSeen));
    expect(fresh.map((m) => m.body)).toEqual(["٢", "٣"]);
  });

  it("إعادةُ إرسالِ الرسالةِ نفسِها بمعرّفِها لا تُنشئُ صفّاً ثانياً", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    const clientId = crypto.randomUUID();
    const a = await post(RIDER_TG, orderId, clientId, "سأتأخر قليلا");
    const b = await post(RIDER_TG, orderId, clientId, "سأتأخر قليلا");
    expect(a.status).toBe("added");
    expect(b.status).toBe("duplicate");
    expect((b.message as Message).id).toBe((a.message as Message).id);
    expect(messagesOf(await list(DRIVER_TG, orderId))).toHaveLength(1);
  });

  it("الطرفُ الثالثُ يُرَدُّ من القاعدة: سائقٌ آخرُ وراكبٌ آخرُ ومعرّفٌ مجهول", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "رسالة خاصة");
    for (const tg of [OTHER_DRIVER_TG, STRANGER_TG, 900_000_499]) {
      expect((await list(tg, orderId)).error).toBe("CHAT_NOT_FOUND");
      expect((await post(tg, orderId, crypto.randomUUID(), "اختراق")).error).toBe("CHAT_NOT_FOUND");
      expect((await markRead(tg, orderId, 1)).error).toBe("CHAT_NOT_FOUND");
    }
    // لا أثرَ لمحاولاتِ الطرفِ الثالث.
    expect(messagesOf(await list(RIDER_TG, orderId))).toHaveLength(1);
    void otherDriverId;
  });

  it("الرسالةُ الفارغةُ والطويلةُ تُرفَضانِ برمزٍ لا تُحوَّلانِ صامتتين", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    expect((await post(RIDER_TG, orderId, crypto.randomUUID(), "   ")).error).toBe("MESSAGE_EMPTY");
    expect((await post(RIDER_TG, orderId, crypto.randomUUID(), "x".repeat(1001))).error).toBe(
      "MESSAGE_TOO_LONG",
    );
  });

  it("موضعُ القراءةِ يتقدّمُ ولا يرجعُ ولا يتجاوزُ آخرَ رسالة", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(DRIVER_TG, orderId, crypto.randomUUID(), "أ");
    await post(DRIVER_TG, orderId, crypto.randomUUID(), "ب");
    const before = await list(RIDER_TG, orderId);
    expect(before.unread).toBe(2);
    const last = Number(before.last_seq);
    expect((await markRead(RIDER_TG, orderId, last + 1000)).ok).toBe(true);
    const after = await list(RIDER_TG, orderId);
    expect(after.unread).toBe(0);
    expect(after.my_last_read_seq).toBe(last);
    await markRead(RIDER_TG, orderId, 0);
    expect((await list(RIDER_TG, orderId)).my_last_read_seq).toBe(last);
    expect((await list(DRIVER_TG, orderId)).counterpart_last_read_seq).toBe(last);
  });

  it("بعدَ الإكمالِ: السجلُّ للقراءةِ، والكتابةُ مغلقة", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "شكرا");
    for (const fn of ["driver_mark_arrived", "driver_start_ride", "driver_complete_ride"]) {
      const step = await one(
        sql.unsafe<{ result: Payload }[]>(`select ${fn}($1::bigint, $2::uuid) as result`, [
          DRIVER_TG,
          orderId,
        ]),
      );
      expect(step.ok).toBe(true);
    }
    const view = await list(RIDER_TG, orderId);
    expect(view.ok).toBe(true);
    expect((view.order as { writable: boolean; status: string }).writable).toBe(false);
    expect((view.order as { status: string }).status).toBe("completed");
    expect(messagesOf(view)).toHaveLength(1);
    expect((await post(DRIVER_TG, orderId, crypto.randomUUID(), "بعد النهاية")).error).toBe(
      "CHAT_CLOSED",
    );
  });

  it("خارجَ نافذةِ القراءةِ يُحجَبُ السجلُّ عن الطرفين", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "قديمة");
    await sql`
      update orders set status = 'completed'::order_status,
             completed_at = now() - order_chat_read_window() - interval '1 minute'
       where id = ${orderId}
    `;
    expect((await list(RIDER_TG, orderId)).error).toBe("CHAT_NOT_FOUND");
    expect((await list(DRIVER_TG, orderId)).error).toBe("CHAT_NOT_FOUND");
  });

  it("طلبُ التوصيلِ يفتحُ الغرفةَ نفسَها بنوعِ خدمتِه", async () => {
    await clearOrders();
    const orderId = await seedOrder("delivery", true);
    expect((await post(RIDER_TG, orderId, crypto.randomUUID(), "الطرد عند الحارس")).status).toBe(
      "added",
    );
    const view = await list(DRIVER_TG, orderId);
    expect((view.order as { service: string }).service).toBe("delivery");
    expect(messagesOf(view).map((m) => m.body)).toEqual(["الطرد عند الحارس"]);
  });

  it("تنزيلُ البياناتِ يحملُ ما كتبَه المستخدمُ وحدَه", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "من الراكبة");
    await post(DRIVER_TG, orderId, crypto.randomUUID(), "من السائق");
    const exported = await one(sql<{ result: Payload }[]>`
      select export_my_data(${RIDER_TG}::bigint) as result
    `);
    const sections = exported.sections as { orderMessages?: { body: string }[] };
    expect(sections.orderMessages?.map((m) => m.body)).toEqual(["من الراكبة"]);
  });

  it("رسالةُ الموقعِ تُحفَظُ بإحداثيّاتٍ مفحوصةٍ ويراها الطرفُ الآخرُ نوعًا وحمولة", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    const clientId = crypto.randomUUID();
    const sent = await postKind(RIDER_TG, orderId, clientId, "location", {
      lat: 21.4858123456,
      lng: 39.1925,
      accuracy_m: 14.27,
      extra: "لا يُحفَظ",
    });
    expect(sent.ok).toBe(true);
    expect(sent.status).toBe("added");
    const message = sent.message as Message & { kind: string; payload: Record<string, unknown> };
    expect(message.kind).toBe("location");
    expect(message.payload).toEqual({
      lat: 21.485812,
      lng: 39.1925,
      accuracy_m: 14.3,
      label: null,
    });
    // نصٌّ احتياطيٌّ يقرؤه عميلٌ أقدمُ دونَ أن يسقط.
    expect(message.body).toBe("21.485812,39.192500");

    const driverView = messagesOf(await list(DRIVER_TG, orderId)) as readonly (Message & {
      kind: string;
      payload: Record<string, unknown> | null;
    })[];
    expect(driverView.map((m) => m.kind)).toEqual(["location"]);
    expect(driverView[0]?.payload?.lat).toBe(21.485812);

    // المعرّفُ نفسُه لا ينشئُ رسالةَ موقعٍ ثانية.
    const again = await postKind(RIDER_TG, orderId, clientId, "location", { lat: 1, lng: 1 });
    expect(again.status).toBe("duplicate");
    expect(messagesOf(await list(DRIVER_TG, orderId))).toHaveLength(1);
    // والرسالةُ الجديدةُ تُنبِّهُ الطرفَ الآخرَ كما تُنبِّهُ النصّيّة.
    const notices = await sql<{ n: number }[]>`
      select count(*)::int as n from notification_outbox
       where order_id = ${orderId} and kind = 'order_chat_message'`;
    expect(notices[0]?.n).toBe(1);
  });

  it("الموقعُ غيرُ السليمِ يُرفَضُ برمزٍ مسمّى ولا يُحفَظ", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    const bad: unknown[] = [
      null,
      {},
      { lat: 91, lng: 10 },
      { lat: 10, lng: -180.5 },
      { lat: "21.4", lng: 39.1 },
      '{"lat": 1e400, "lng": 39.1}',
      { lat: 21.4, lng: 39.1, label: "x".repeat(121) },
    ];
    for (const payload of bad) {
      expect(
        (await postKind(RIDER_TG, orderId, crypto.randomUUID(), "location", payload)).error,
      ).toBe("LOCATION_INVALID");
    }
    expect(
      (await postKind(RIDER_TG, orderId, crypto.randomUUID(), "image", { lat: 1, lng: 1 })).error,
    ).toBe("MESSAGE_KIND_INVALID");
    expect(messagesOf(await list(DRIVER_TG, orderId))).toHaveLength(0);
    // والقيدُ في الجدولِ نفسِه يمنعُ كتابةً تتجاوزُ الدالّة.
    let blocked = false;
    try {
      await sql`
        insert into order_messages (order_id, city_id, sender_user_id, sender_role, client_message_id, body, kind, payload)
        select ${orderId}, ${cityId}, u.id, 'rider', gen_random_uuid(), 'x', 'location', '{"lat": 200, "lng": 1}'::jsonb
          from users u where u.telegram_id = ${RIDER_TG}`;
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it("الطرفُ الثالثُ لا يرسلُ موقعًا، والمحادثةُ المغلقةُ لا تقبلُه", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    for (const tg of [OTHER_DRIVER_TG, STRANGER_TG]) {
      expect(
        (await postKind(tg, orderId, crypto.randomUUID(), "location", { lat: 21.4, lng: 39.1 }))
          .error,
      ).toBe("CHAT_NOT_FOUND");
    }
    await sql`update orders set status = 'completed'::order_status, completed_at = now() where id = ${orderId}`;
    expect(
      (await postKind(RIDER_TG, orderId, crypto.randomUUID(), "location", { lat: 21.4, lng: 39.1 }))
        .error,
    ).toBe("CHAT_CLOSED");
  });

  it("السجلُّ يحملُ لغةَ القارئِ ولغةَ الطرفِ الآخرِ من `users.language_code` للترجمة", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await sql`update users set language_code = 'ar' where telegram_id = ${RIDER_TG}`;
    await sql`update users set language_code = 'ur' where telegram_id = ${DRIVER_TG}`;
    try {
      const riderView = await list(RIDER_TG, orderId);
      expect(riderView.my_language).toBe("ar");
      expect((riderView.counterpart as { language: string | null }).language).toBe("ur");
      const driverView = await list(DRIVER_TG, orderId);
      expect(driverView.my_language).toBe("ur");
      expect((driverView.counterpart as { language: string | null }).language).toBe("ar");
    } finally {
      await sql`update users set language_code = 'ar' where telegram_id in (${RIDER_TG}, ${DRIVER_TG})`;
    }
  });

  // آخرُ القياساتِ عمداً: المحوُ يُجهِّلُ حسابَ الراكبة.
  it("محوُ الحسابِ يمحو ما كتبَه صاحبُه ويُبقي رسائلَ الطرفِ الآخر", async () => {
    await clearOrders();
    const orderId = await seedOrder("transport", true);
    await post(RIDER_TG, orderId, crypto.randomUUID(), "رسالة ستُمحى");
    await post(DRIVER_TG, orderId, crypto.randomUUID(), "رسالة السائق");
    await sql`update orders set status = 'completed'::order_status, completed_at = now() where id = ${orderId}`;
    const erased = await one(sql<{ result: Payload }[]>`
      select erase_my_account(${RIDER_TG}::bigint) as result
    `);
    expect(erased.ok).toBe(true);
    const left = await sql<{ sender_role: string }[]>`
      select sender_role from order_messages where order_id = ${orderId}
    `;
    expect(left.map((r) => r.sender_role)).toEqual(["driver"]);
    const reads = await sql<{ n: number }[]>`
      select count(*)::int as n from order_message_reads r
        join riders rd on rd.user_id = r.user_id where rd.id = ${riderId}
    `;
    expect(reads[0]?.n).toBe(0);
  });
});
