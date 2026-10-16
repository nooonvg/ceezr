/**
 * الغرض: اختبارُ تكاملٍ لدورةِ حياةِ التوصيلِ عبرَ مساراتِ HTTP الحقيقية:
 *   POST /v1/deliveries → GET /v1/driver/offers → POST /v1/driver/offers/:id/accept
 *   → GET /v1/driver/job → POST /v1/driver/job/:id/arrived → …/start → …/complete
 *   → GET /v1/rides/:id
 *   مع إثبات: الجلسةِ والصلاحياتِ، الردودِ HTTP، بياناتِ التوصيلِ، الحالةِ النهائية.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على مسار HTTP للتوصيل
 * ملاحظات مستقبلية: عند إضافة اختبار Realtime يُضاف هنا أو في ملفٍ مستقلٍ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import type { DriverJobDeps } from "../../packages/application/driver/driver-job.ts";
import type { DriverOfferDeps } from "../../packages/application/driver/driver-offers.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferDecisionPort } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { PostgresDriverJobStore } from "../../packages/infrastructure/driver/driver-job-store.ts";
import { PostgresDriverOfferStore } from "../../packages/infrastructure/driver/driver-offers-store.ts";
import { createDriverDirectory } from "../../packages/infrastructure/identity/directories.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../packages/infrastructure/identity/miniapp-session.ts";
import { createViewerAccountReader } from "../../packages/infrastructure/identity/viewer-account.ts";
import { createActiveRideReader } from "../../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideCancelCommand,
  createRideRequestCommand,
  createRideSearchReader,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const SESSION_SECRET = "delivery-gateway-lifecycle-secret-اثنان-وثلاثون-حرفاً-على-الأقلِّ";
const WEBHOOK_SECRET = "delivery-gateway-webhook";
const COURIER_CHAT = 130_001;
const RIDER_CHAT = 230_001;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const COURIER_AT = { latitude: 21.5471, longitude: 39.1751 };
const PARCEL = "صندوق كتب متوسط الحجم";
const IDEMPOTENCY_KEY = "delivery-gateway-lifecycle-2026-09-30";

const config: AppConfig = testConfig({
  port: 3996,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;

function tokenFor(telegramUserId: string, bot: "rider" | "driver"): string {
  const issued = createMiniAppSessionIssuer({ secret: SESSION_SECRET }).issue(
    { telegramUserId, bot, authDateSeconds: Math.floor(Date.now() / 1000) },
    Date.now(),
  );
  if (!issued.ok) throw new Error("إصدارُ الجلسةِ فاشلٌ");
  return issued.value.accessToken;
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

describeIf("دورة حياة التوصيل عبر مسارات HTTP على قاعدة حقيقية", () => {
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

    const sessions = createMiniAppSessionReader(SESSION_SECRET);
    const now = (): Date => new Date();
    const drivers = createDriverDirectory(sql);

    app = createServer({
      health: { now, startedAt: now(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
      deliveries: {
        request: { sessions, rides: createRideRequestCommand(sql), now },
      },
      rides: {
        request: { sessions, rides: createRideRequestCommand(sql), now },
        search: { sessions, search: createRideSearchReader(sql), now },
        active: {
          sessions,
          rides: createActiveRideReader(sql),
          now,
          routing: { routing: container.routing },
        },
        cancel: {
          sessions,
          canceller: createRideCancelCommand(sql),
          now,
        },
      },
      driverOffers: {
        offers: {
          sessions,
          store: new PostgresDriverOfferStore(sql),
          drivers,
          offers: createOfferDecisionPort(sql),
          now,
        } satisfies DriverOfferDeps,
        log: () => {},
      },
      driverJob: {
        job: {
          sessions,
          store: new PostgresDriverJobStore(sql),
          now,
        } satisfies DriverJobDeps,
        log: () => {},
      },
      driverLocation: {
        viewer: { sessions, accounts: createViewerAccountReader(sql), now },
        drivers: container.driverLocation.drivers,
        ingest: container.driverLocation.ingest,
      },
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

  // ═══════════════════════════════════════════════════════════════════
  // ١) الدورة الكاملة عبر HTTP: إنشاء ← عروض ← قبول ← وصول ← بدء ← إكمال
  // ═══════════════════════════════════════════════════════════════════
  it("يكمل دورة التوصيل عبر مسارات HTTP: إنشاء ← قبول ← وصول ← بدء ← إكمال", async () => {
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      COURIER_AT,
    );
    await registerRider();

    const riderToken = tokenFor(String(RIDER_CHAT), "rider");
    const driverToken = tokenFor(String(COURIER_CHAT), "driver");

    // ١) إنشاء طلب توصيل عبر POST /v1/deliveries
    // المسار يُنشئ الطلب عبر requestRide؛ بثُّ العرض يتمُّ بواسطة dispatch منفصل،
    // فنُدرج العرض يدويًّا كما يفعل support-volume-budget.test.ts.
    const createRes = await app.fetch(
      new Request("http://localhost/v1/deliveries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${riderToken}`,
          "idempotency-key": IDEMPOTENCY_KEY,
        },
        body: JSON.stringify({
          originLat: PICKUP.latitude,
          originLng: PICKUP.longitude,
          destinationLat: DROPOFF.latitude,
          destinationLng: DROPOFF.longitude,
          parcelDescription: PARCEL,
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as {
      ok: boolean;
      accepted: boolean;
      orderId?: string;
    };
    expect(createBody.ok).toBe(true);
    expect(createBody.accepted).toBe(true);
    const orderId = createBody.orderId;
    if (orderId === undefined) throw new Error("لم يُنشَأ طلب التوصيل");

    // إدراج العرض يدويًّا — كما في support-volume-budget.test.ts
    const offerRows = await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}, ${orderId}, ${courierId}, 1, 'pending'::offer_status,
              now() + make_interval(secs => 120))
      returning id
    `;
    const offerId = offerRows[0]?.id;
    if (offerId === undefined) throw new Error("لم يُنشَأ العرض");

    // ٢) السائق يرى العرض عبر GET /v1/driver/offers
    const offersRes = await app.fetch(
      new Request("http://localhost/v1/driver/offers", {
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(offersRes.status).toBe(200);
    const offersBody = (await offersRes.json()) as {
      ok: boolean;
      offers: Array<{
        offer_id: string;
        order_id: string;
        service: string;
      }>;
    };
    expect(offersBody.ok).toBe(true);
    expect(offersBody.offers).toHaveLength(1);
    expect(offersBody.offers[0]?.order_id).toBe(orderId);
    expect(offersBody.offers[0]?.service).toBe("delivery");

    // ٣) قبول العرض عبر POST /v1/driver/offers/:offerId/accept
    const acceptRes = await app.fetch(
      new Request(`http://localhost/v1/driver/offers/${offerId}/accept`, {
        method: "POST",
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as { ok: boolean };
    expect(acceptBody.ok).toBe(true);

    // ٤) السائق يرى المهمة عبر GET /v1/driver/job
    const jobRes = await app.fetch(
      new Request("http://localhost/v1/driver/job", {
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(jobRes.status).toBe(200);
    const jobBody = (await jobRes.json()) as {
      ok: boolean;
      job: {
        order_id: string;
        status: string;
        service: string;
        next_action: string;
        dropoff: { latitude: number; longitude: number } | null;
        notes: string | null;
      } | null;
    };
    expect(jobBody.ok).toBe(true);
    expect(jobBody.job?.order_id).toBe(orderId);
    expect(jobBody.job?.status).toBe("matched");
    expect(jobBody.job?.service).toBe("delivery");
    expect(jobBody.job?.dropoff).not.toBeNull();
    expect(jobBody.job?.dropoff?.latitude).toBeCloseTo(DROPOFF.latitude, 4);
    expect(jobBody.job?.dropoff?.longitude).toBeCloseTo(DROPOFF.longitude, 4);
    expect(jobBody.job?.notes).toBe(PARCEL);

    // ٥) الوصول عبر POST /v1/driver/job/:orderId/arrived
    const arrivedRes = await app.fetch(
      new Request(`http://localhost/v1/driver/job/${orderId}/arrived`, {
        method: "POST",
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(arrivedRes.status).toBe(200);
    const arrivedBody = (await arrivedRes.json()) as {
      ok: boolean;
      arrived_at: string;
    };
    expect(arrivedBody.ok).toBe(true);
    expect(arrivedBody.arrived_at).not.toBeNull();

    // ٦) بدء الرحلة عبر POST /v1/driver/job/:orderId/start
    const startRes = await app.fetch(
      new Request(`http://localhost/v1/driver/job/${orderId}/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      ok: boolean;
      started_at: string;
    };
    expect(startBody.ok).toBe(true);
    expect(startBody.started_at).not.toBeNull();

    // ٧) إكمال الرحلة عبر POST /v1/driver/job/:orderId/complete
    const completeRes = await app.fetch(
      new Request(`http://localhost/v1/driver/job/${orderId}/complete`, {
        method: "POST",
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(completeRes.status).toBe(200);
    const completeBody = (await completeRes.json()) as { ok: boolean };
    expect(completeBody.ok).toBe(true);

    // ٨) الحالة النهائية في قاعدة البيانات: completed
    // GET /v1/rides/:id يستخدم القارئ النشط الذي يُرجع null للرحلات المنتهية،
    // فنُثبِت الحالة النهائية من القاعدة مباشرةً بعد إكمالها عبر HTTP.
    const finalOrder = await sql<{ status: string; service: string }[]>`
      select status::text as status, service from orders where id = ${orderId}
    `;
    expect(finalOrder[0]?.status).toBe("completed");
    expect(finalOrder[0]?.service).toBe("delivery");

    // ٩) المهمة اختفت من شاشة السائق
    const jobAfterRes = await app.fetch(
      new Request("http://localhost/v1/driver/job", {
        headers: { authorization: `Bearer ${driverToken}` },
      }),
    );
    expect(jobAfterRes.status).toBe(200);
    const jobAfterBody = (await jobAfterRes.json()) as {
      ok: boolean;
      job: unknown | null;
    };
    expect(jobAfterBody.ok).toBe(true);
    expect(jobAfterBody.job).toBeNull();
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٢) ركوب طلب التوصيل يتطلب جلسة
  // ═══════════════════════════════════════════════════════════════════
  it("يرفض إنشاء طلب توصيل بلا جلسة: 401", async () => {
    await readyDriver(COURIER_CHAT, "أحمد العمري", "0501234567", "delivery", COURIER_AT);
    await registerRider();

    const createRes = await app.fetch(
      new Request("http://localhost/v1/deliveries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "no-session-test",
        },
        body: JSON.stringify({
          originLat: PICKUP.latitude,
          originLng: PICKUP.longitude,
          destinationLat: DROPOFF.latitude,
          destinationLng: DROPOFF.longitude,
          parcelDescription: PARCEL,
        }),
      }),
    );
    expect(createRes.status).toBe(401);
    const body = (await createRes.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("SESSION_REQUIRED");
  });

  // ═══════════════════════════════════════════════════════════════════
  // ٣) ركوب آخر لا يستطيع قراءة رحلة توصيل لا يملكها
  // ═══════════════════════════════════════════════════════════════════
  it("يرفض قراءة رحلة توصيل برمز سائق لا يملكها: 404", async () => {
    await readyDriver(COURIER_CHAT, "أحمد العمري", "0501234567", "delivery", COURIER_AT);
    await registerRider();
    const riderToken = tokenFor(String(RIDER_CHAT), "rider");

    // إنشاء طلب توصيل
    const createRes = await app.fetch(
      new Request("http://localhost/v1/deliveries", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${riderToken}`,
          "idempotency-key": "auth-isolation-test",
        },
        body: JSON.stringify({
          originLat: PICKUP.latitude,
          originLng: PICKUP.longitude,
          destinationLat: DROPOFF.latitude,
          destinationLng: DROPOFF.longitude,
          parcelDescription: PARCEL,
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const createBody = (await createRes.json()) as { ok: boolean; orderId?: string };
    const orderId = createBody.orderId;

    // سائق آخر (نقل) يحاول قراءة الرحلة
    const otherToken = tokenFor(String(130_002), "driver");
    const rideRes = await app.fetch(
      new Request(`http://localhost/v1/rides/${orderId}`, {
        headers: { authorization: `Bearer ${otherToken}` },
      }),
    );
    // 404 لأن السائق ليس مالك الطلب ولا الراكب
    expect(rideRes.status).toBe(404);
  });
});
