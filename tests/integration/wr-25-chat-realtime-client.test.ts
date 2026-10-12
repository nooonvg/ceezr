/**
 * الغرض: `WR-25` (ORDER §25، البندُ الأخير) — **العميلُ الحقيقيُّ** ينضمُّ إلى غرفةِ المحادثة، لا اختبارٌ
 *   يبثُّ الحدثَ نيابةً عنه. يُشغَّلُ خادمُ Socket.IO حقيقيٌّ على منفذٍ محلّيّ بقناةِ البوّابةِ نفسِها
 *   (`createChatChannel`) ومتحقّقِ الجلسةِ نفسِه (`createOffersSessionVerifier`) ومخزنِ المحادثةِ على
 *   PostgreSQL (`createOrderChatStore`)، ويتّصلُ به **مصنعُ مقبسِ Mini App المنشورُ** (`productionChatSocket`)
 *   بجلسةِ الراكبِ وجلسةِ السائقِ كلٌّ على حدة. والرسالةُ تُرسَلُ بحالةِ الاستخدامِ نفسِها التي يناديها
 *   مسارُ HTTP (`postOrderChatMessage`) و`onPosted` موصولٌ بـ`publish` كما في `apps/gateway/src/index.ts`.
 * يقيس: انضمامَ الطرفين، ورفضَ الغريب، ووصولَ الإشارةِ للطرفِ الآخر، وأنَّ المكرَّرَ لا يبثُّ ثانيةً،
 *   وأنَّ العائدَ بعدَ انقطاعٍ يسترجعُ ما فاتَه من القاعدة.
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server as IoServer } from "socket.io";
import { createOffersSessionVerifier } from "../../apps/gateway/src/realtime/adapters.ts";
import { createChatChannel } from "../../apps/gateway/src/realtime/chat-channel.ts";
import { postOrderChatMessage } from "../../packages/application/messaging/order-chat.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createOrderChatStore } from "../../packages/infrastructure/messaging/order-chat-store.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

/**
 * وحداتُ Mini App تُفحَصُ أنواعُها بـ`apps/miniapp/tsconfig.json` (فيها DOM)، والفحصُ الجذريُّ يستثني
 * `apps/miniapp/src`؛ فتُحمَّلُ هنا بمسارٍ يُحسَبُ وقتَ التشغيل كي لا يجرَّها الفحصُ الجذريّ، وبعقدٍ محلّيٍّ
 * مطابقٍ لِما تُصدِّرُه (`ChatSocketFactory` و`setSession`). والوحدةُ المحمَّلةُ هي الملفُّ المنشورُ نفسُه.
 */
interface ChatSocketHandle {
  readonly close: () => void;
}
type ChatSocketFactory = (
  orderId: string,
  handlers: {
    readonly onUpdate: (lastSeq: number) => void;
    readonly onJoined: () => void;
    readonly onLost: () => void;
  },
) => ChatSocketHandle;
const MINIAPP = "../../apps/miniapp/src";
let productionChatSocket: ChatSocketFactory;
let setSession: (session: { accessToken: string; expiresAt: number } | null) => void;

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  عميلُ المحادثةِ الحقيقيُّ WR-25 مُتخطّى: عيّن TEST_DATABASE_URL.");
}

const SECRET = "wr25-chat-realtime-secret-0123456789abcdef";
const DRIVER_TG = 900_025_101;
const RIDER_TG = 900_025_102;
const STRANGER_TG = 900_025_103;
const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let driverId = "";
let orderId = "";
const userIds: string[] = [];
let http: HttpServer;
let io: IoServer;
let channel: ReturnType<typeof createChatChannel>;
const sockets: ChatSocketHandle[] = [];
const notRevoked = { isRevoked: async () => ok(false) } as never;

function token(tg: number, bot: "rider" | "driver"): { accessToken: string; expiresAt: number } {
  const now = Date.now();
  const issued = createMiniAppSessionIssuer({ secret: SECRET }).issue(
    { telegramUserId: String(tg), bot, authDateSeconds: Math.floor(now / 1000) },
    now,
  );
  if (!issued.ok) throw new Error("تعذّر إصدارُ الجلسة");
  return { accessToken: issued.value.accessToken, expiresAt: issued.value.expiresAtMs };
}

interface Probe {
  readonly joined: Promise<void>;
  readonly lost: Promise<void>;
  readonly updates: number[];
  readonly nextUpdate: () => Promise<number>;
  readonly handle: ChatSocketHandle;
}

/** يفتحُ مقبسَ Mini App المنشورَ بجلسةِ صاحبِه — المصنعُ يقرأُ الجلسةَ لحظةَ النداء. */
function open(tg: number, bot: "rider" | "driver"): Probe {
  setSession(token(tg, bot));
  let onJoined: () => void = () => undefined;
  let onLost: () => void = () => undefined;
  const joined = new Promise<void>((resolve) => {
    onJoined = resolve;
  });
  const lost = new Promise<void>((resolve) => {
    onLost = resolve;
  });
  const updates: number[] = [];
  let waiters: ((seq: number) => void)[] = [];
  const handle = productionChatSocket(orderId, {
    onJoined: () => onJoined(),
    onLost: () => onLost(),
    onUpdate: (seq) => {
      updates.push(seq);
      const pending = waiters;
      waiters = [];
      for (const w of pending) w(seq);
    },
  });
  setSession(null);
  sockets.push(handle);
  return {
    joined,
    lost,
    updates,
    nextUpdate: () => new Promise<number>((resolve) => waiters.push(resolve)),
    handle,
  };
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`مهلةُ ${what}`)), ms)),
  ]);
}

const chatDeps = () => ({
  sessions: createMiniAppSessionReader(SECRET),
  store: createOrderChatStore(sql),
  now: () => new Date(),
  onPosted: (signal: { readonly orderId: string; readonly lastSeq: number }) =>
    channel.publish(signal),
});

async function send(tg: number, bot: "rider" | "driver", text: string, clientMessageId: string) {
  return postOrderChatMessage(chatDeps(), {
    accessToken: token(tg, bot).accessToken,
    orderId,
    body: { clientMessageId, text },
  });
}

async function cleanup(): Promise<void> {
  if (riderId !== "") {
    const orders = sql`select id from orders where rider_id = ${riderId}`;
    await sql`delete from order_messages where order_id in (${orders})`;
    await sql`delete from order_message_reads where order_id in (${orders})`;
    await sql`delete from notification_outbox where order_id in (${orders})`;
    await sql`delete from order_offers where order_id in (${orders})`;
    await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
    await sql`delete from orders where rider_id = ${riderId}`;
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") {
    await sql`delete from notification_outbox where driver_id = ${driverId}`;
    await sql`delete from driver_availability where driver_id = ${driverId}`;
    await sql`delete from drivers where id = ${driverId}`;
  }
  for (const id of userIds) {
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  const socketModule = (await import(`${MINIAPP}/surfaces/chat/order-chat-socket.ts`)) as {
    productionChatSocket: ChatSocketFactory;
  };
  const sessionModule = (await import(`${MINIAPP}/identity/session.ts`)) as {
    setSession: typeof setSession;
  };
  productionChatSocket = socketModule.productionChatSocket;
  setSession = sessionModule.setSession;
  sql = createSql({ connectionString: DATABASE_URL as string });
  await sql`delete from users where telegram_id in (${DRIVER_TG}, ${RIDER_TG}, ${STRANGER_TG})`.catch(
    () => undefined,
  );
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TG}, 'driver', 'سائقُ WR-25', '+966500025101') returning id`;
  userIds.push(driverUser?.id as string);
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUser?.id as string}, 'verified'::verification_status, 'سيدان', 'ح ب 2510')
    returning id`;
  driverId = driver?.id as string;
  await sql`insert into driver_availability (driver_id, city_id, is_available)
            values (${driverId}, ${cityId}, true)`;
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكبةُ WR-25', '+966500025102') returning id`;
  userIds.push(riderUser?.id as string);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser?.id as string}) returning id`;
  riderId = rider?.id as string;
  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TG}, 'rider', 'غريب', '+966500025103') returning id`;
  userIds.push(stranger?.id as string);

  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label)
    values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
            st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
            'نقطةُ الانطلاق', 'الحرم') returning id`;
  orderId = order?.id as string;
  await sql`insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
            values (${cityId}, ${orderId}, ${driverId}, 1, 'pending'::offer_status, now() + interval '2 minutes')`;
  const [claimed] = await sql<{ r: { ok?: boolean } }[]>`
    select claim_ride(${orderId}::uuid, ${driverId}::uuid) as r`;
  if (claimed?.r.ok !== true) throw new Error("تعذّر الإسناد");

  http = createServer();
  io = new IoServer(http, { transports: ["polling"] });
  channel = createChatChannel({
    io,
    sessions: createOffersSessionVerifier(SECRET, () => Date.now(), notRevoked),
    store: createOrderChatStore(sql),
  });
  channel.start();
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  // المصنعُ المنشورُ يقرأُ أصلَ البوّابةِ من هذا المتغيّرِ لحظةَ الاتّصال.
  process.env.VITE_WASLAH_API_BASE = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  for (const s of sockets) s.close();
  channel?.stop();
  await new Promise<void>((resolve) => io?.close(() => resolve()));
  delete process.env.VITE_WASLAH_API_BASE;
  if (sql === undefined) return;
  await cleanup();
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-25 — عميلُ Mini App الحقيقيُّ ينضمُّ إلى غرفةِ المحادثة", () => {
  it("الطرفانِ ينضمّانِ بعميلِ Mini App والغريبُ يُرفَض، والإشارةُ تصلُ الطرفَ الآخرَ وحدَه", async () => {
    const rider = open(RIDER_TG, "rider");
    const driver = open(DRIVER_TG, "driver");
    const stranger = open(STRANGER_TG, "rider");
    await within(Promise.all([rider.joined, driver.joined]), 10_000, "انضمامِ الطرفين");
    await within(stranger.lost, 10_000, "رفضِ الغريب");

    const arriving = driver.nextUpdate();
    const posted = await send(RIDER_TG, "rider", "أنا عند البوابة الشمالية", crypto.randomUUID());
    expect(posted.ok).toBe(true);
    const seq = await within(arriving, 10_000, "إشارةِ السائق");
    expect(seq).toBe(posted.ok ? posted.value.message.seq : -1);
    expect(stranger.updates).toEqual([]);

    // الإشارةُ لا تحملُ النصّ: السائقُ يقرؤه من القاعدةِ بجلستِه.
    const listed = await createOrderChatStore(sql).list({
      telegramUserId: String(DRIVER_TG),
      orderId,
      afterSeq: 0,
      limit: 50,
    });
    expect(listed.ok && listed.value.messages.map((m) => m.body)).toEqual([
      "أنا عند البوابة الشمالية",
    ]);
  });

  it("المكرَّرُ بالمعرّفِ نفسِه لا يبثُّ ثانيةً", async () => {
    const driver = open(DRIVER_TG, "driver");
    await within(driver.joined, 10_000, "انضمامِ السائق");
    const clientId = crypto.randomUUID();
    const first = driver.nextUpdate();
    const a = await send(RIDER_TG, "rider", "رسالةٌ واحدة", clientId);
    await within(first, 10_000, "الإشارةِ الأولى");
    const b = await send(RIDER_TG, "rider", "رسالةٌ واحدة", clientId);
    expect(a.ok && a.value.status).toBe("added");
    expect(b.ok && b.value.status).toBe("duplicate");
    await Bun.sleep(400);
    expect(driver.updates).toHaveLength(1);
  });

  it("العائدُ بعدَ انقطاعٍ ينضمُّ من جديدٍ ويسترجعُ ما فاتَه من القاعدة", async () => {
    const driver = open(DRIVER_TG, "driver");
    await within(driver.joined, 10_000, "انضمامِ السائق");
    driver.handle.close();
    const missed = await send(RIDER_TG, "rider", "وصلت؟", crypto.randomUUID());
    expect(missed.ok).toBe(true);
    const back = open(DRIVER_TG, "driver");
    await within(back.joined, 10_000, "عودةِ السائق");
    const after = missed.ok ? missed.value.message.seq - 1 : 0;
    const listed = await createOrderChatStore(sql).list({
      telegramUserId: String(DRIVER_TG),
      orderId,
      afterSeq: after,
      limit: 50,
    });
    expect(listed.ok && listed.value.messages.map((m) => m.body)).toEqual(["وصلت؟"]);
    expect(driver.updates).toEqual([]);
  });
});
