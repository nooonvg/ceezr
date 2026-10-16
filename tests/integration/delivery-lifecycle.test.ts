/**
 * الغرض: دورةُ حياةِ التوصيلِ الكاملة على قاعدة PostgreSQL فعلية:
 *   تسجيل سائق توصيل ← طلب delivery ← عرض ← قبول ← وصول ← بدء ← إكمال.
 *   ويُثبت: حفظ بيانات التوصيل (service, dropoff, notes) حتى الإكمال،
 *   وعزل السائقين (سائق النقل لا يملك صلاحية على طلب التوصيل)،
 *   والإلغاء قبل الإسناد بلا عقوبة، والإكمال المتكرر لا يفسد الحالة.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على دورة حياة التوصيل
 * ملاحظات مستقبلية: عند إضافة إثبات تسليم (توقيع/صورة/رمز) تُضاف تأكيدات هنا.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "lifecycle-secret";
const COURIER_CHAT = 120_001;
const TRANSPORT_CHAT = 120_002;
const RIDER_CHAT = 220_001;
// جدة الحقيقية: الاستلام والتسليم وموقعا السائقين كلها داخل نصف قطر البحث
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const COURIER_AT = { latitude: 21.5471, longitude: 39.1751 };
const PARCEL = "صندوق كتب متوسط الحجم";

const config: AppConfig = testConfig({
  port: 3997,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

type Payload = Record<string, unknown>;

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function post(bot: string, update: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
      },
      body: JSON.stringify(update),
    }),
  );
}

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

const message = (chatId: number, body: Record<string, unknown>) => ({
  update_id: nextUpdateId(),
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("دورة حياة التوصيل الكاملة على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    driverSent = [];
    riderSent = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  /** يسجّل سائقاً بخدمة محدَّدة، ويجعله متحقَّقاً ومتاحاً بموقع حقيقي. */
  async function readyDriver(
    chatId: number,
    fullName: string,
    phone: string,
    service: "transport" | "delivery",
    at: { latitude: number; longitude: number },
  ): Promise<string> {
    await post("driver", text(chatId, "/start"));
    await post("driver", text(chatId, fullName));
    await post("driver", contact(chatId, phone));
    await post("driver", callback(chatId, `city:${cityId}`));
    await post("driver", callback(chatId, `service:${service}`));
    await post("driver", callback(chatId, "vehicle:sedan"));
    await post("driver", text(chatId, "أ ب ج 1234"));
    await post("driver", text(chatId, `1${String(chatId).slice(-9).padStart(9, "0")}`));
    await post("driver", photo(chatId, `vphoto_${chatId}`));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chatId}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error(`لم يُسجَّل السائق ${chatId}`);
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, ${service}::subscription_plan) as result`;
    await post("driver", text(chatId, "/available"));
    await post("driver", location(chatId, at));
    return driverId;
  }

  async function registerRider(): Promise<string> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
    const rows = await sql<{ id: string }[]>`select id from riders limit 1`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُسجَّل العميل");
    return id;
  }

  /** الحوار الكامل لطلب توصيل من عميل مسجَّل، ثم قبول العرض. يُرجع معرّف الطلب. */
  async function createAndMatchDelivery(): Promise<{ orderId: string; courierId: string }> {
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      COURIER_AT,
    );
    await registerRider();

    await post("rider", callback(RIDER_CHAT, "svc:delivery"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    await post("rider", text(RIDER_CHAT, PARCEL));

    const orders = await sql<{ id: string }[]>`select id from orders`;
    const orderId = orders[0]?.id;
    if (orderId === undefined) throw new Error("لم يُنشَأ طلب التوصيل");

    await drainNotificationOutbox(sql, capturing(driverSent));
    await post("driver", callback(COURIER_CHAT, `offer:accept:${orderId}`));

    return { orderId, courierId };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ١) الدورة الكاملة: إنشاء ← مطابقة ← قبول ← وصول ← بدء ← إكمال
  // ═══════════════════════════════════════════════════════════════════
  it("يكمل دورة التوصيل: إنشاء ← قبول ← وصول ← بدء ← إكمال، وبيانات التوصيل محفوظة", async () => {
    const { orderId, courierId } = await createAndMatchDelivery();

    // الحالة بعد القبول: matched
    const matched = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${orderId}
    `;
    expect(matched[0]?.status).toBe("matched");

    // ١) الوصول — driver_mark_arrived
    const arrived = await callJson(sql<{ result: Payload }[]>`
      select driver_mark_arrived(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(arrived.ok).toBe(true);

    // الحالة بعد الوصول: لا تزال matched (الوصول ختمٌ لا انتقال حالة)
    const afterArrived = await sql<{ status: string; arrived_at: string | null }[]>`
      select status::text as status, arrived_at from orders where id = ${orderId}
    `;
    expect(afterArrived[0]?.status).toBe("matched");
    expect(afterArrived[0]?.arrived_at).not.toBeNull();

    // ٢) بدء الرحلة — driver_start_ride
    const started = await callJson(sql<{ result: Payload }[]>`
      select driver_start_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(started.ok).toBe(true);

    // الحالة بعد البدء: in_progress
    const afterStart = await sql<{ status: string; started_at: string | null }[]>`
      select status::text as status, started_at from orders where id = ${orderId}
    `;
    expect(afterStart[0]?.status).toBe("in_progress");
    expect(afterStart[0]?.started_at).not.toBeNull();

    // ٣) إكمال الرحلة — driver_complete_ride
    const completed = await callJson(sql<{ result: Payload }[]>`
      select driver_complete_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(completed.ok).toBe(true);

    // الحالة بعد الإكمال: completed
    const afterComplete = await sql<{ status: string; completed_at: string | null }[]>`
      select status::text as status, completed_at from orders where id = ${orderId}
    `;
    expect(afterComplete[0]?.status).toBe("completed");
    expect(afterComplete[0]?.completed_at).not.toBeNull();

    // ٤) بيانات التوصيل محفوظة حتى بعد الإكمال
    const delivery = await sql<
      {
        service: string;
        notes: string | null;
        dlat: number | null;
        dlng: number | null;
      }[]
    >`
      select service, notes,
             st_y(dropoff::geometry) as dlat, st_x(dropoff::geometry) as dlng
        from orders where id = ${orderId}
    `;
    expect(delivery[0]?.service).toBe("delivery");
    expect(delivery[0]?.notes).toBe(PARCEL);
    expect(delivery[0]?.dlat).not.toBeNull();
    expect(Number(delivery[0]?.dlat)).toBeCloseTo(DROPOFF.latitude, 5);
    expect(Number(delivery[0]?.dlng)).toBeCloseTo(DROPOFF.longitude, 5);

    // ٥) السائق عاد متاحاً بعد الإكمال
    const driverState = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${courierId}
    `;
    expect(driverState[0]?.is_available).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٢) عزل الخدمات: سائق النقل لا يستطيع تنفيذ أفعال طلب التوصيل
  // ═══════════════════════════════════════════════════════════════════
  it("سائق النقل لا يستطيع الوصول أو البدء أو الإكمال على طلب توصيل", async () => {
    const { orderId } = await createAndMatchDelivery();

    // سجل سائق نقل
    const transportId = await readyDriver(
      TRANSPORT_CHAT,
      "خالد الزهراني",
      "0559876543",
      "transport",
      COURIER_AT,
    );

    // سائق النقل لا يستطيع الوصول
    const arrived = await callJson(sql<{ result: Payload }[]>`
      select driver_mark_arrived(${TRANSPORT_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(arrived.ok).toBe(false);

    // سائق النقل لا يستطيع البدء
    const started = await callJson(sql<{ result: Payload }[]>`
      select driver_start_ride(${TRANSPORT_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(started.ok).toBe(false);

    // سائق النقل لا يستطيع الإكمال
    const completed = await callJson(sql<{ result: Payload }[]>`
      select driver_complete_ride(${TRANSPORT_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(completed.ok).toBe(false);

    // الحالة لم تتغير
    const order = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status::text as status, assigned_driver_id from orders where id = ${orderId}
    `;
    expect(order[0]?.status).toBe("matched");
    expect(order[0]?.assigned_driver_id).not.toBe(transportId);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٣) الإلغاء قبل الإسناد بلا عقوبة
  // ═══════════════════════════════════════════════════════════════════
  it("يلغي طلب التوصيل قبل الإسناد بلا عقوبة", async () => {
    await readyDriver(COURIER_CHAT, "أحمد العمري", "0501234567", "delivery", COURIER_AT);
    const riderId = await registerRider();

    await post("rider", callback(RIDER_CHAT, "svc:delivery"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    await post("rider", text(RIDER_CHAT, PARCEL));

    const before = await sql<{ id: string; status: string }[]>`
      select id, status::text as status from orders limit 1
    `;
    expect(before[0]?.status).toBe("searching");
    const orderId = before[0]?.id;
    if (orderId === undefined) throw new Error("لم يُنشَأ طلب");

    // الإلغاء قبل الإسناد
    const cancelled = await callJson(sql<{ result: Payload }[]>`
      select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid, 'rider_cancelled') as result
    `);
    expect(cancelled.ok).toBe(true);

    const after = await sql<{ status: string }[]>`
      select status::text as status from orders limit 1
    `;
    expect(after[0]?.status).toBe("cancelled");
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٤) الإكمال المتكرر لا يفسد الحالة
  // ═══════════════════════════════════════════════════════════════════
  it("الإكمال المتكرر لا يفسد الحالة: الطلب يبقى completed", async () => {
    const { orderId, courierId } = await createAndMatchDelivery();

    // أكمل دورة الوصول والبدء أولاً
    await callJson(sql<{ result: Payload }[]>`
      select driver_mark_arrived(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    await callJson(sql<{ result: Payload }[]>`
      select driver_start_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);

    // أكمل الرحلة
    const firstComplete = await callJson(sql<{ result: Payload }[]>`
      select driver_complete_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(firstComplete.ok).toBe(true);

    // أكد الحالة
    const afterFirst = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${orderId}
    `;
    expect(afterFirst[0]?.status).toBe("completed");

    // حاول الإكمال مرة أخرى — يجب أن يرفض
    const secondComplete = await callJson(sql<{ result: Payload }[]>`
      select driver_complete_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result
    `);
    expect(secondComplete.ok).toBe(false);

    // الحالة لم تتغير
    const afterSecond = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${orderId}
    `;
    expect(afterSecond[0]?.status).toBe("completed");

    // السائق لا يزال متاحاً
    const driverState = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${courierId}
    `;
    expect(driverState[0]?.is_available).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٥) سائق آخر لا يستطيع الوصول لطلب لا يملكه
  // ═══════════════════════════════════════════════════════════════════
  it("سائق توصيل آخر لا يستطيع الوصول لطلب لا يملكه", async () => {
    const { orderId } = await createAndMatchDelivery();

    // سجل سائق توصيل ثانٍ
    const secondCourier = await readyDriver(
      120_003,
      "محمد القحطاني",
      "0533334444",
      "delivery",
      COURIER_AT,
    );

    // السائق الثاني لا يستطيع الوصول
    const arrived = await callJson(sql<{ result: Payload }[]>`
      select driver_mark_arrived(${120_003}::bigint, ${orderId}::uuid) as result
    `);
    expect(arrived.ok).toBe(false);

    // السائق الثاني لا يستطيع البدء
    const started = await callJson(sql<{ result: Payload }[]>`
      select driver_start_ride(${120_003}::bigint, ${orderId}::uuid) as result
    `);
    expect(started.ok).toBe(false);

    // الحالة لم تتغير
    const order = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status::text as status, assigned_driver_id from orders where id = ${orderId}
    `;
    expect(order[0]?.status).toBe("matched");
    expect(order[0]?.assigned_driver_id).not.toBe(secondCourier);
  });
});
