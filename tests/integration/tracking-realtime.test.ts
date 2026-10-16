/**
 * الغرض: المرحلة ٦ — إثبات النقل اللحظي على قاعدة حقيقية، من رسالة السائق إلى
 *   العميل والعمليات معاً.
 *
 *   الاختبارات هنا تقيس ما لا تقيسه الوحدات:
 *
 *   (١) **الجلسة صارت في القاعدة** لا في خريطة العملية: رسالة موقعٍ واحدة من بوت
 *       السائق تُنتج صفّاً في `tracking_sessions`. وهذا دليل إغلاق R-10/R-15 —
 *       لأن `handleLocation` كانت لا تفتح جلسةً قط، والوقائع كانت تضيع بإعادة النشر.
 *   (٢) **لا ماسح دوري**: جلسةٌ تجاوزت سقفها تُغلق `EXPIRED` وتُستبدل عند أول
 *       إصلاحة تالية (R-14).
 *   (٣) **فهرس الجلسة الواحدة** يمنع جلستين مفتوحتين لسائق — على القاعدة نفسها
 *       لا في المنطق.
 *   (٤) **الدفع إلى العميل يذهب لصاحب الرحلة وحده**: القناة تُحقَن فتُلتقط
 *       الوجهة، ويُقارَن معرّف محادثتها بمعرّف تلغرام لصاحب الرحلة، ويُثبَت أنّ
 *       راكباً آخر في نفس المدينة لا يُدفع إليه شيء.
 *   (٥) **مجرى العمليات محميّ**: بلا جلسة لوحة ⇒ ٤٠١، ومعها ⇒ لقطةٌ تحمل السائق.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على مسار الموقع أو على جدول الجلسات
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAdminAuthPort } from "../../apps/gateway/src/admin/auth.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createAdminLiveRoutes } from "../../apps/gateway/src/routes/admin-live.ts";
import { createAdminUiRoutes } from "../../apps/gateway/src/routes/admin-ui.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import {
  DEFAULT_RELAY_MIN_INTERVAL_MS,
  type LivePosition,
} from "../../packages/application/tracking/customer-live-relay.ts";
import { DEFAULT_SESSION_POLICY } from "../../packages/domain/tracking/session.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 120_806;
const RIDER_CHAT = 220_806;
const OTHER_RIDER_CHAT = 221_806;
const ADMIN_TELEGRAM = 990_806;
const UNAUTHORIZED = 401;
const HTTP_OK = 200;
const SEE_OTHER = 303;

const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
/** على بُعد ~٧٠٠ متر: يتجاوز حدّ الحركة في المُرحِّل ولا يُنتج سرعةً مستحيلة. */
const JEDDAH_MOVED = { latitude: 21.5534, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3991,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN_TELEGRAM),
});

interface LiveCall {
  readonly op: "start" | "update" | "stop";
  readonly chatId: string;
  /** المرحلة ١١: مدّةُ البثّ المطلوبة — تُلتقط لأنها مفتاحُ الرجل الميّت لا زينة. */
  readonly livePeriodSeconds?: number;
}

let sql: Sql;
let app: ReturnType<typeof createServer>;
let adminApp: Hono;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let liveCalls: LiveCall[];
let adminCodes: string[];
/**
 * المرحلة ١١: رسائل بوت العميل صارت مقيسةً في هذا الملف (تقرير `/status`)، فرُفع
 * المصفوف إلى نطاق الوحدة. وهو يُستبدل في كل `beforeEach` لا يُفرَّغ: التفريغ
 * يترك المُرسِل المُركَّب في الحاوية السابقة يكتب في نفس المصفوف.
 */
let riderSent: SentMessage[];
/**
 * المرحلة ١٢: رسائل بوت السائق صارت مقيسةً هنا (بطاقة الرحلة ودبّوسها)، فرُفعت
 * إلى نطاق الوحدة لنفس السبب المذكور أعلاه في `riderSent`.
 */
let driverSent: SentMessage[];

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
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});
const location = (chatId: number, at: { latitude: number; longitude: number }, agoSeconds = 0) =>
  message(chatId, {
    location: { ...at, horizontal_accuracy: 8 },
    date: Math.floor(Date.now() / 1000) - agoSeconds,
  });

interface SessionRow {
  readonly id: string;
  readonly trip_id: string | null;
  readonly last_fix_at: string | null;
  readonly ended_at: string | null;
  readonly end_reason: string | null;
}

async function sessionsOf(driverId: string): Promise<readonly SessionRow[]> {
  return sql<SessionRow[]>`
    select id, trip_id, last_fix_at, ended_at, end_reason
      from tracking_sessions where driver_id = ${driverId}
     order by started_at asc
  `;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

/** دخول المسؤول بدورةٍ كاملة: الكعكة الناتجة صالحة لأي موجّه يقرأ نفس الجدول. */
async function adminCookie(): Promise<string> {
  adminCodes = [];
  const requested = await adminApp.fetch(
    new Request("http://localhost/admin/login/code", {
      method: "POST",
      headers: { "user-agent": "integration-test" },
      body: form({ telegram_id: String(ADMIN_TELEGRAM) }),
      redirect: "manual",
    }),
  );
  expect(requested.status).toBe(SEE_OTHER);
  const delivered = adminCodes[0];
  if (delivered === undefined) throw new Error("لم يُرسَل رمز دخول");
  const code = delivered.match(/[0-9]{6}/)?.[0];
  if (code === undefined) throw new Error(`لا رمز في الرسالة: ${delivered}`);

  const verified = await adminApp.fetch(
    new Request("http://localhost/admin/login/verify", {
      method: "POST",
      headers: { "user-agent": "integration-test" },
      body: form({ telegram_id: String(ADMIN_TELEGRAM), code }),
      redirect: "manual",
    }),
  );
  expect(verified.status).toBe(SEE_OTHER);
  const header = verified.headers.get("set-cookie");
  if (header === null) throw new Error("لا كعكة جلسة");
  const value = header.split(";")[0];
  if (value === undefined) throw new Error("كعكة بلا قيمة");
  return value;
}

/**
 * يقرأ أوّل حدثٍ من مجرى SSE ثم يقطعه. القطع ضروري: الحلقة تعمل إلى أن يُقطع
 * المجرى، ومن تركها معلّقة أوقف الاختبار إلى مهلته.
 */
async function firstSseEvent(response: Response): Promise<string> {
  const body = response.body;
  if (body === null) throw new Error("مجرى بلا جسم");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (let guard = 0; guard < 50; guard += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      if (buffer.includes("\n\n")) return buffer;
    }
  } finally {
    await reader.cancel();
  }
  throw new Error(`لم يصل حدث من المجرى: ${buffer}`);
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("النقل اللحظي على قاعدة حقيقية — المرحلة ٦", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  afterEach(async () => {
    // إن أخفقَ التهيئةُ لم تُبنَ الحاويةُ أصلاً، وطرحُ خطأٍ ثانٍ في التفكيك يطمس الأوّل.
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table tracking_sessions, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, ratings, support_tickets,
                             unsubscribed_claims, unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             admin_sessions, admin_login_codes,
                             drivers, riders, users restart identity cascade`;
    /**
     * القروباتُ الثلاثة تُضبَط هنا مع التفعيل لا قبله: قيدُ
     * `cities_active_requires_groups` يمنع تفعيلَ مدينةٍ بلا قروباتها، ولا تبذُرها
     * أيّةُ هجرة. فكان هذا السطرُ ينجح فقط إذا سبقه ملفُّ اختبارٍ آخرُ ضبطها —
     * أي أنّ نجاحَه كان معلَّقاً على ترتيبِ اكتشافِ الملفّات، وهو يختلف بين
     * الجهازِ المحلّيّ وآلةِ التكامل. فمرّ محلّياً وسقط بعيداً، ثمّ سرَّب فشلُه
     * حاوياتٍ لم تُغلَق فأنفدَ اتّصالاتَ القاعدة وأسقط ملفّاتٍ لا علاقة لها به.
     */
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

    liveCalls = [];
    adminCodes = [];
    driverSent = [];
    riderSent = [];

    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      liveLocationChannel: {
        start: async (chatId: string, _position: LivePosition, live: number) => {
          liveCalls.push({ op: "start", chatId, livePeriodSeconds: live });
          return `msg-${liveCalls.length}`;
        },
        update: async (chatId: string) => {
          liveCalls.push({ op: "update", chatId });
          return true;
        },
        stop: async (chatId: string) => {
          liveCalls.push({ op: "stop", chatId });
          return true;
        },
      },
    });

    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });

    const auth = createAdminAuthPort(container.sql);
    adminApp = new Hono();
    adminApp.route(
      "/admin/api/live",
      createAdminLiveRoutes({ sql: container.sql, auth, bus: container.tracking.bus }),
    );
    adminApp.route(
      "/admin",
      createAdminUiRoutes({
        sql: container.sql,
        auth,
        codeSender: {
          send: async (_chatId, body) => {
            adminCodes.push(body);
            return true;
          },
        },
      }),
    );
  });

  async function registerDriver(): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "فهد الغامدي"));
    await post("driver", contact(DRIVER_CHAT, "0501110806"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1806"));
    await post("driver", text(DRIVER_CHAT, "1000001806"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001806"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");

    /**
     * المرحلة ١٢ — السائق يُدخل الخدمة بعد توثيقه.
     *
     * ولماذا أُضيف هذا الآن؟ لأن اختبارات المرحلة ٦ كانت تقيس ميكانيكا الجلسة
     * (تُفتح، تتقدّم، تنتهي بالسقف) على سائقٍ **لم يدخل الخدمة قطّ** — وهي حالةٌ لا
     * تقع في الإنتاج لمن يُتتبَّع فعلاً. فمقصد الاختبارات باقٍ كما هو، والمهيّئ وحده
     * صار يماثل الواقع. وسلوك من هو خارج الخدمة يُقاس في اختباراته الخاصة
     * لا بأن يُحمَّل على اختباراتٍ تسأل سؤالاً آخر.
     *
     * والإدخال بدالة `record_attendance` لا بإدراجٍ يدويّ: هي كاتب الإتاحة في
     * الإنتاج، ومهيّئٌ يكتب الصفّ بيده يختبر حالةً لا تنتجها الشيفرة أبداً.
     */
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}::uuid`;
    await sql`select record_attendance(${driverId}::uuid, true, 'test_seed')`;
    return driverId;
  }

  async function seedAdmin(): Promise<void> {
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${ADMIN_TELEGRAM}::bigint, 'مسؤول النظام', '+966500000801', 'ar', 'admin')
    `;
  }

  /** راكبٌ ورحلةٌ جارية مُسنَدة إلى السائق — البرهان الذي يُبنى عليه الدفع. */
  async function seedAssignedTrip(
    driverId: string,
    chat: number,
  ): Promise<{ readonly tripId: string; readonly riderId: string }> {
    const fullName = `راكب ${chat}`;
    const phone = `+9665${chat}`;
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${chat}::bigint, ${fullName}, ${phone}, 'ar', 'rider')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${userId}::uuid) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, assigned_driver_id, service, status,
                          pickup, dropoff, pickup_label, dropoff_label)
      values (${cityId}, ${riderId}::uuid, ${driverId}::uuid, 'transport', 'in_progress',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
              'الحرم', 'المطار')
      returning id
    `;
    const tripId = orders[0]?.id;
    if (tripId === undefined) throw new Error("تعذّر إنشاء الرحلة");
    return { tripId, riderId };
  }

  async function seedUnassignedTrip(chat: number): Promise<void> {
    const fullName = `راكب ${chat}`;
    const phone = `+9665${chat}`;
    const users = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${chat}::bigint, ${fullName}, ${phone}, 'ar', 'rider')
      returning id
    `;
    const userId = users[0]?.id;
    if (userId === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${userId}::uuid) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");
    await sql`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff,
                         pickup_label, dropoff_label)
      values (${cityId}, ${riderId}::uuid, 'transport', 'searching',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
              'الحرم', 'المطار')
    `;
  }

  it("رسالة موقعٍ واحدة تفتح جلسة تتبّع في القاعدة", async () => {
    /**
     * هذا هو إغلاق R-15. قبله كانت `handleLocation` تكتب الموقع القانوني ولا
     * تفتح جلسةً قط: الجلسة كانت آلةً في المجال بلا مسارٍ يُشغّلها، فكل ما
     * يُبنى عليها (الحياة، الانقطاع، التتبّع) كان بلا مصدر.
     */
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.ended_at).toBeNull();
    expect(rows[0]?.last_fix_at).not.toBeNull();
  });

  it("إصلاحتان متتاليتان تُقدّمان الجلسة نفسها ولا تفتحان ثانية", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH, 60));
    const afterFirst = await sessionsOf(driverId);
    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(afterFirst[0]?.id);
    expect(rows[0]?.last_fix_at).not.toBe(afterFirst[0]?.last_fix_at);
  });

  it("جلسة تجاوزت سقفها تُغلق EXPIRED وتُستبدل بلا ماسحٍ دوري", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    // تقديم البداية إلى ما قبل السقف (١٢ ساعة) بلا مؤقّت: أول إصلاحة تالية هي الماسح.
    await sql`
      update tracking_sessions
         set started_at = now() - interval '13 hours',
             last_fix_at = now() - interval '13 hours'
       where driver_id = ${driverId} and ended_at is null
    `;

    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(2);
    expect(rows[0]?.end_reason).toBe("EXPIRED");
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(rows[1]?.ended_at).toBeNull();
  });

  it("القاعدة نفسها تمنع جلستين مفتوحتين لسائق واحد", async () => {
    /**
     * الفهرس الفريد الجزئي لا المنطق. المنطق يُصيب في المسار المتوقّع؛ والفهرس
     * يُصيب في سباق رسالتَي موقعٍ متزامنتين — وهي الحال التي تُنتج سائقاً
     * مرسوماً مرّتين على خريطة العمليات إلى الأبد.
     */
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    let rejected = false;
    try {
      await sql`insert into tracking_sessions (driver_id) values (${driverId}::uuid)`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("رحلةٌ جارية تُربَط بالجلسة، وموقع السائق يُدفع إلى صاحبها وحده", async () => {
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);
    // راكبٌ آخر في نفس المدينة بلا إسناد: وجوده هو الاختبار — لا يُدفع إليه شيء.
    // I1 (ADR 0286): لا يُبذر التزامٌ ثانٍ للسائقِ نفسِه حتى للحظةٍ — فيُزرعُ
    // طلبُ الراكبِ الآخرِ باحثًا بلا سائقٍ من الأصلِ، لا مُسنَدًا ثم يُفكُّ.
    await seedUnassignedTrip(OTHER_RIDER_CHAT);

    await post("driver", location(DRIVER_CHAT, JEDDAH));

    const rows = await sessionsOf(driverId);
    expect(rows[0]?.trip_id).toBe(mine.tripId);

    expect(liveCalls.length).toBe(1);
    expect(liveCalls[0]?.op).toBe("start");
    expect(liveCalls[0]?.chatId).toBe(String(RIDER_CHAT));
  });

  it("سائقٌ بلا رحلة مُسنَدة لا يُدفع موقعه إلى أيّ عميل", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    const rows = await sessionsOf(driverId);
    expect(rows[0]?.trip_id).toBeNull();
    // جلسة تتبّعٍ بلا رحلة حالةٌ مشروعة (سائق متاح للمطابقة) لا خطأ — ولا مستقبِل لها.
    expect(liveCalls.length).toBe(0);
  });

  it("إنهاء الرحلة يُغلق جلستها في القاعدة ويوقف بثّ الموقع عن العميل", async () => {
    /**
     * المنفذ هو نفسه المركّب في حوار التقييم (`deps.tracking.onTripEnded`)،
     * ويُستدعى هنا مباشرةً لأن المقيس في هذا الاختبار هو SQL الإغلاق
     * ومسار الإيقاف لا حوار السائق — ومسار الرحلة الكامل مقيسٌ في
     * `full-ride.test.ts`. وأن الحوار يمرّ بهذا المنفذ مضمونٌ بالمُترجِم لا
     * بالاختبار: `tracking` حقلٌ في `RatingDialogDependencies` يُمرّر في الحاوية.
     */
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);
    await post("driver", location(DRIVER_CHAT, JEDDAH));
    expect(liveCalls.map((c) => c.op)).toEqual(["start"]);

    await container.tracking.live.onTripEnded(mine.tripId, "TRIP_COMPLETED");

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.end_reason).toBe("TRIP_COMPLETED");
    expect(rows[0]?.ended_at).not.toBeNull();
    // وإيقاف البثّ لا تركُه ينتهي وحده: خريطةٌ حيّة بعد الرحلة تتبّعٌ بلا سند.
    expect(liveCalls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(liveCalls[1]?.chatId).toBe(String(RIDER_CHAT));
  });

  /**
   * المرحلة ١١ — العيب P11-1 مقيساً على المسار الحقيقيّ: لا منفذٌ يُنادى من
   * الاختبار بل رسالة `/cancel` تدخل من الويبهوك كما تدخل في الإنتاج — لأن
   * المقيس أنّ **التركيب في الحاوية حاصلٌ فعلاً**. وقد كان `riderDeps` بلا `tracking`
   * أصلاً، فاختبارٌ ينادي المنفذ مباشرةً كان ليمرّ والعيب قائم.
   *
   * والمنفذ هو **نفس المتغيرّ** المُمرّر لبوت السائق لا نسخةً ثانية: حالة
   * البثّ في الذاكرة، فمنفذان يعنيان خريطتين لا تعرف إحداهما الأخرى.
   */
  it("إلغاء العميل من الويبهوك يُغلق جلسته ويوقف خريطته", async () => {
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);
    // الإلغاء من حقّ العميل قبل الركوب؛ و`seedAssignedTrip` تبدأ `in_progress`.
    await sql`update orders set status = 'matched' where id = ${mine.tripId}::uuid`;

    await post("driver", location(DRIVER_CHAT, JEDDAH));
    expect(liveCalls.map((c) => c.op)).toEqual(["start"]);

    await post("rider", text(RIDER_CHAT, "/cancel"));

    const statuses = await sql<{ status: string }[]>`
      select status from orders where id = ${mine.tripId}::uuid
    `;
    expect(statuses[0]?.status).toBe("cancelled");

    const rows = await sessionsOf(driverId);
    expect(rows.length).toBe(1);
    expect(rows[0]?.end_reason).toBe("TRIP_CANCELLED");
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(liveCalls.map((c) => c.op)).toEqual(["start", "stop"]);
    expect(liveCalls[1]?.chatId).toBe(String(RIDER_CHAT));
  });

  /**
   * والعيب P11-2 كان أسوأ من خريطةٍ معلّقة: السائق يأخذ رحلةً ثانية بعد
   * الملغاة، فيبقى بثّ الأول مفتوحاً في خريطة `broadcasts` ولا شيء يمسحه دون إعادة
   * تشغيل. والمقيس هنا أن العميل الأول لا يتلقّى تعديلاً واحداً بعد إلغائه.
   */
  it("رحلةٌ تالية لنفس السائق لا تُحدّث خريطة العميل الملغي", async () => {
    const driverId = await registerDriver();
    const first = await seedAssignedTrip(driverId, RIDER_CHAT);
    await sql`update orders set status = 'matched' where id = ${first.tripId}::uuid`;

    await post("driver", location(DRIVER_CHAT, JEDDAH));
    await post("rider", text(RIDER_CHAT, "/cancel"));
    expect(liveCalls.map((c) => c.op)).toEqual(["start", "stop"]);

    // راكبٌ ثانٍ ورحلةٌ جديدة لنفس السائق، وموقعٌ يتجاوز حدّ الحركة.
    await seedAssignedTrip(driverId, OTHER_RIDER_CHAT);
    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

    const ops = liveCalls.filter((c) => c.chatId === String(RIDER_CHAT)).map((c) => c.op);
    expect(ops).toEqual(["start", "stop"]);
    // والعميل الثاني يحصل على خريطته هو: الحراسة ليست حجباً شاملاً.
    expect(liveCalls.some((c) => c.chatId === String(OTHER_RIDER_CHAT) && c.op === "start")).toBe(
      true,
    );
  });

  /**
   * والعيب P11-3 مقيساً على قاعدةٍ حقيقيّة: حدثٌ يُنشر على الناقل لرحلةٍ حالتُها
   * في القاعدة `completed`. والنشر مباشرةً لا برسالة سائق — **وهو المقيس نفسه**:
   * رسالةُ السائق تمرّ بـ`activeTripOf` التي تُرشِّح `matched/in_progress`، فتُنتج
   * حدثاً بلا `tripId` فلا يبلغ المرحّل أصلاً. فاختبارٌ يمرّ من الرسالة كان
   * ليَخضَرّ بلا أن يلمس الحراسة ألبتّة — وقد جرّبناه فمرّ والحراسة مُعطَّلة.
   *
   * والحدث المنشور مباشرةً ليس افتراضاً: هو حدثٌ متأخّرٌ في الرتل، أو إعادةُ نشرٍ
   * بعد إعادة تشغيل، أو رحلةٌ انتهت بين لحظة ربط الجلسة ولحظة وصول الإصلاحة.
   * والمرحّل يشترك `operations/all_cities` فيمرّ بـ`canOperationsWatch` التي تُجيز
   * كلّ شيء ولا تلمس `isTripLive` — فكان يُفتح بثٌّ لعميلٍ انتهت رحلته، ولا شيء
   * يوقفه بعدئذ لأن `session_ended` قد مرّ أصلاً.
   */
  it("حدثٌ متأخّر لرحلةٍ مكتملة في القاعدة لا يفتح خريطةً للعميل", async () => {
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);

    // خطّ الأساس: ما دامت حيّةً يُفتح البثّ — فالحراسة ليست حجباً شاملاً.
    await container.tracking.bus.publish({
      type: "location_updated",
      driverId,
      tripId: mine.tripId,
      sessionId: RELAY_PROBE_SESSION,
      sequence: 2,
      cityId,
      position: { lat: JEDDAH.latitude, lng: JEDDAH.longitude },
      timestamp: new Date(),
    });
    expect(liveCalls.map((c) => c.op)).toEqual(["start"]);
    /**
     * ومدّةُ البثّ المطلوبة من الحاوية الحقيقيّة سقفُ الجلسة لا سقفُ تلغرام:
     * بثٌّ يعيش ضعفَ عمر الجلسة التي وُلد منها يترك نقطةً مجمّدة في هاتف العميل
     * اثنتي عشرة ساعة إضافيّة إن لم يبلغ المرحّلَ حدثٌ آخر أبداً.
     */
    expect(liveCalls[0]?.livePeriodSeconds).toBe(DEFAULT_SESSION_POLICY.maxSessionSeconds);

    // ثم تنتهي الرحلة في القاعدة، ويصل حدثٌ ثانٍ بعد حدّ الزمن.
    liveCalls = [];
    await sql`update orders set status = 'completed' where id = ${mine.tripId}::uuid`;
    /**
     * انتظارٌ حقيقيّ لأن ساعة الحاوية `systemClock` لا تُحقَن. وهو مقصودٌ لا
     * محتمَل: خمس ثوانٍ هي الحدّ الفعليّ الذي يعيشه العميل، فاختبارٌ يتجاوزه
     * بساعةٍ مزيّفة لا يقيس ما يحدث في الإنتاج.
     */
    await Bun.sleep(DEFAULT_RELAY_MIN_INTERVAL_MS + 200);
    /**
     * و**نفس** الإحداثيات لا موقعٌ متحرّك: سائقٌ أوقف سيّارته. وهي الحالة التي
     * أسقطت هذا الاختبار أوّلاً حين كان فحص الحياة بعد حدّ الحركة — فلا يتجاوزه
     * واقفٌ قطّ، فتبقى خريطة العميل حيّةً إلى انتهاء مدّة تلغرام كلها.
     */
    await container.tracking.bus.publish({
      type: "location_updated",
      driverId,
      tripId: mine.tripId,
      sessionId: RELAY_PROBE_SESSION,
      sequence: 3,
      cityId,
      position: { lat: JEDDAH.latitude, lng: JEDDAH.longitude },
      timestamp: new Date(),
    });

    // يُوقَف لا يُحدَّث: الخريطة المفتوحة مسؤوليّةٌ لا تُترك للمهلة.
    expect(liveCalls.map((c) => c.op)).toEqual(["stop"]);

    // وبثٌّ جديد لا يُفتح لها بعد ذلك ألبتّة.
    liveCalls = [];
    await container.tracking.bus.publish({
      type: "location_updated",
      driverId,
      tripId: mine.tripId,
      sessionId: RELAY_PROBE_SESSION,
      sequence: 4,
      cityId,
      position: { lat: JEDDAH_MOVED.latitude, lng: JEDDAH_MOVED.longitude },
      timestamp: new Date(),
    });
    expect(liveCalls.length).toBe(0);
    // مهلةٌ موسَّعة: الانتظار الحقيقيّ لحدّ الخنق يتجاوز مهلة bun الافتراضيّة.
  }, 20_000);

  /**
   * المرحلة ١١ — العيب P11-5 مقيساً من طرفه إلى طرفه: الموقع يُكتب في
   * `drivers.last_location` من رسالة السائق الحقيقيّة (لا بإدراجٍ يدويّ)، ثم يُقرأ
   * في `/status`. والمقيس هنا ما لا تقيسه الوحدات: أن SQL الاستعلام تستخرج
   * `ST_Y/ST_X` بالترتيب الصحيح — وقلبهما خطأٌ تمرّ منه كلّ اختبارات الوحدة
   * لأنّها تبني النقطة بيدها، ويُنتج في الإنتاج مسافةً بألوف الكيلومترات.
   */
  it("تقرير العميل يقرأ موقع السائق المخزّن ويُنتج مسافةً معقولة", async () => {
    const driverId = await registerDriver();
    const mine = await seedAssignedTrip(driverId, RIDER_CHAT);
    await sql`update orders set status = 'matched' where id = ${mine.tripId}::uuid`;

    // الموقع يدخل من مساره الوحيد المشروع (ADR-0015): رسالة السائق.
    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));
    const stored = await sql<{ lat: number }[]>`
      select st_y(last_location::geometry) as lat from drivers where id = ${driverId}::uuid
    `;
    expect(stored[0]?.lat).toBeCloseTo(JEDDAH_MOVED.latitude, 4);

    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/status"));
    const body = riderSent.map((m) => m.text).join("\n");

    /**
     * والتأكيد على الرقم لا على وجود السطر: موضع الانطلاق (٢١.٥٤٧١) وموقع
     * السائق (٢١.٥٥٣٤) يفصلهما نحو ٧٠٠ متر — فإن قُلب إحداثيّان أو خُلطت
     * الوحدات صار الرقم ألوفاً وسقط الاختبار.
     */
    expect(body).toContain("700");
    expect(body).toContain("خطّ مستقيم");
  });

  it("مجرى العمليات يُرفض بلا جلسة لوحة", async () => {
    const response = await adminApp.fetch(
      new Request("http://localhost/admin/api/live/drivers", {
        headers: { "user-agent": "integration-test" },
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(UNAUTHORIZED);
  });

  it("مجرى العمليات يفتح لقطةً تحمل السائق المُتتبَّع", async () => {
    await seedAdmin();
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));
    const cookie = await adminCookie();

    const response = await adminApp.fetch(
      new Request("http://localhost/admin/api/live/drivers", {
        headers: { "user-agent": "integration-test", cookie },
        redirect: "manual",
      }),
    );
    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const payload = await firstSseEvent(response);
    expect(payload).toContain("event: snapshot");
    expect(payload).toContain(driverId);
  });

  /**
   * ## المرحلة ١٢ — بطاقة رحلة السائق ودورة حياة التتبّع
   *
   * قياسُ ما قبل هذه المرحلة (بمسبار تنفيذٍ على هذه القاعدة، لا بمراجعة نظرية)
   * أظهر أربعة عيوب: السائق يُؤمَر بالتوجّه «إلى نقطة الانطلاق» بلا إحداثية ولا
   * اسم؛ و`/trip` و`/status` و`/route` كلّها تُجيب «لم أفهم»؛ وجلسة التتبّع تبقى
   * مفتوحةً بعد خروجه من الخدمة فيظلّ على خريطة العمليات إلى سقف الاثنتي عشرة
   * ساعة؛ ورسالة بدء الرحلة بلا مقصد. وهذه الاختبارات تُقيّد إغلاقها.
   */
  const ar = (key: string, params?: Record<string, string | number>) =>
    translate("ar", key, params ?? {});

  it("‏/trip بلا رحلة يقول ذلك صراحةً ولا يُجيب «لم أفهم»", async () => {
    await registerDriver();
    driverSent.length = 0;
    await post("driver", text(DRIVER_CHAT, "/trip"));

    const texts = driverSent.map((m) => m.text);
    expect(texts).toEqual([ar("driver.trip_none")]);
    // العيب المقيس: الأمر كان يسقط في المُلتقِط العامّ
    expect(texts[0]).not.toContain("لم أفهم");
    expect(driverSent.filter((m) => m.location !== undefined)).toHaveLength(0);
  });

  it("‏/trip برحلةٍ جارية يُعطي النقطتين والمرحلة ودبّوساً على المقصد", async () => {
    const driverId = await registerDriver();
    await seedAssignedTrip(driverId, RIDER_CHAT);
    // موقعٌ قانوني للسائق: به تُحسَب المسافة، وبلا موقعٍ تكون `null` لا صفراً
    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));
    driverSent.length = 0;
    await post("driver", text(DRIVER_CHAT, "/trip"));

    const cards = driverSent.filter((m) => m.location === undefined);
    expect(cards).toHaveLength(1);
    const card = cards[0]?.text ?? "";
    expect(card).toContain(ar("driver.trip_header"));
    // الرحلة `in_progress` فمرحلته إلى المقصد لا إلى الانطلاق
    expect(card).toContain(ar("driver.trip_leg_to_destination"));
    expect(card).toContain("الحرم");
    expect(card).toContain("المطار");
    // ‏JEDDAH_MOVED إلى المطار: ١٫٧ كم بالخطّ المستقيم — رقمٌ محسوبٌ لا مُقرَّب يدوياً
    expect(card).toContain(ar("driver.trip_distance_straight", { km: 1.7 }));

    const pins = driverSent.filter((m) => m.location !== undefined);
    expect(pins).toHaveLength(1);
    // الدبّوس على المطار: الوجهة الآن، لا على الانطلاق الذي تجاوزه
    expect(pins[0]?.location).toEqual({ latitude: 21.5601, longitude: 39.1901 });
  });

  it("القارئ يجيب بنفس الرحلة بمفتاح السائق وبمفتاح تلغرام معاً", async () => {
    /**
     * المفتاحان كلاهما مُثبَتٌ في الخادم، ومسارا الاستخدام مختلفان (القبول يعرف
     * `driverId`، وبدء الرحلة يعرف `telegramId` فقط). فلو تباعد جوابهما لرأى
     * السائق بطاقةً في موضعٍ ولا يراها في آخر — وهو عيبٌ يصعب تفسيره.
     */
    const driverId = await registerDriver();
    const { tripId } = await seedAssignedTrip(driverId, RIDER_CHAT);
    const reader = container.tracking.tripCards;

    const byId = await reader.cardOf({ driverId });
    const byTelegram = await reader.cardOf({ driverTelegramId: String(DRIVER_CHAT) });
    expect(byId?.trip.tripId).toBe(tripId);
    expect(byTelegram?.trip.tripId).toBe(tripId);
    expect(byTelegram?.trip).toEqual(byId?.trip);
  });

  it("سائقٌ آخر لا يرى رحلة غيره: القارئ يجيب null لا بطاقةً مسروقة", async () => {
    const driverId = await registerDriver();
    await seedAssignedTrip(driverId, RIDER_CHAT);
    const others = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${DRIVER_CHAT + 7}::bigint, 'سائق آخر', '+966500000707', 'ar', 'driver')
      returning id
    `;
    const otherUser = others[0]?.id;
    if (otherUser === undefined) throw new Error("تعذّر إنشاء المستخدم الثاني");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, national_id, plate_number, vehicle_type,
                           verification_status)
      values (${cityId}, ${otherUser}::uuid, '1000007070', 'د ه و 7070', 'sedan', 'verified')
      returning id
    `;
    const otherDriver = drivers[0]?.id;
    if (otherDriver === undefined) throw new Error("تعذّر إنشاء السائق الثاني");

    const reader = container.tracking.tripCards;
    expect(await reader.cardOf({ driverId: otherDriver })).toBeNull();
    expect(await reader.cardOf({ driverTelegramId: String(DRIVER_CHAT + 7) })).toBeNull();
  });

  it("الخروج من الخدمة يُغلق الجلسة فوراً بسبب DRIVER_STOPPED", async () => {
    /**
     * هذا هو إغلاق P12-3، وهو عيبُ خصوصيةٍ لا عيبُ عرض: `listLiveDriverPositions`
     * تُرشِّح `ended_at is null` وحدها، فسائقٌ خرج من الخدمة كان يبقى على خريطة
     * العمليات إلى سقف الاثنتي عشرة ساعة — يُرصَد موقعه وهو يعتقد أنه انصرف.
     */
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));
    expect((await sessionsOf(driverId))[0]?.ended_at).toBeNull();

    await post("driver", text(DRIVER_CHAT, "/unavailable"));

    const rows = await sessionsOf(driverId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(rows[0]?.end_reason).toBe("DRIVER_STOPPED");
  });

  it("إصلاحةٌ تصل من سائقٍ خارج الخدمة تُغلق جلسته ولا تُفتح له أخرى", async () => {
    /**
     * موضعُ إغلاقٍ ثانٍ مستقلّ عن الأول: `/unavailable` يُغلق فوراً، وهذا يُغلق
     * إصلاحةً وصلت بعد خروجٍ **لم يمرّ عبر البوت** — كتغيير المسؤول لحالة التوثيق،
     * أو مهمّة `expire_stale_availability` المجدولة. وفحصُ تحويرٍ على هذا السطر
     * وحده نجا قبل إضافة هذا الاختبار، فهو ليس تكراراً للذي قبله.
     */
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH));
    expect((await sessionsOf(driverId))[0]?.ended_at).toBeNull();

    // خروجٌ من الخدمة في القاعدة مباشرةً: كما يفعله المسؤول والمهمّة المجدولة
    await sql`select record_attendance(${driverId}::uuid, false, 'test_admin')`;
    await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

    const rows = await sessionsOf(driverId);
    // جلسةٌ واحدة مُغلقة: لا جلسةٌ جديدة تُفتح لمن ليس في الخدمة
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ended_at).not.toBeNull();
    expect(rows[0]?.end_reason).toBe("DRIVER_STOPPED");
  });

  it("لكن الخروج من الخدمة لا يقطع تتبّع رحلةٍ جارية", async () => {
    /**
     * ولماذا هذا القيد؟ لأن `claim_ride` لا يلمس `driver_availability` إطلاقاً،
     * فالسائق المُسنَد قد يكون «خارج الخدمة» في الجدول ورحلته جارية في الواقع.
     * وإغلاق جلسته حينها يعني عميلاً يفقد أثر سيّارةٍ هو راكبٌ فيها.
     */
    const driverId = await registerDriver();
    await seedAssignedTrip(driverId, RIDER_CHAT);
    await post("driver", location(DRIVER_CHAT, JEDDAH));

    await post("driver", text(DRIVER_CHAT, "/unavailable"));

    const rows = await sessionsOf(driverId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ended_at).toBeNull();
  });

  /**
   * المرحلة ١٥ — إغلاق R-28. القياسُ قبل هذه المرحلة أثبت أن `createOsrmProvider`
   * لا يُستدعى إلاّ في الاختبارات، وأن `OSRM_BASE_URL` مذكورٌ في `.env.example`
   * و`render.yaml` ولا يُقرأ في الضبط قط — أي أنّ محرّك التوجيه كان **غيرَ قابلٍ
   * للبناء في الإنتاج**. ولا تُغلَق تلك الثغرة باختبارِ وحدةٍ يبني المزوّد بيده:
   * ذلك يُثبِت أنّ المزوّد يعمل، لا أنّ **الحاوية توصله**. فالإثباتُ هنا يمرّ من
   * `buildContainer` بضبطٍ حقيقيّ، إلى خادم OSRM مُزيَّفٍ يُصغي على منفذٍ حقيقيّ،
   * إلى نصّ الرسالة التي يقرؤها السائق.
   */
  describe("المرحلة ١٥: زمن الوصول موصولٌ في الحاوية", () => {
    const ROUTE_BODY = {
      code: "Ok",
      routes: [
        { distance: 1731.4, duration: 714.9, geometry: { coordinates: [[39.1751, 21.5534]] } },
      ],
      waypoints: [{ distance: 12.3 }, { distance: 27.4 }],
    };

    /** يبني حاويةً بضبطِ توجيهٍ مُعطى، ويردّ دالّةَ إرسالٍ إلى بوت السائق. */
    function appWith(routingConfig: Partial<AppConfig>): {
      readonly send: (update: unknown) => Promise<Response>;
      readonly sent: SentMessage[];
    } {
      const sent: SentMessage[] = [];
      const built = buildContainer({ ...config, ...routingConfig } as AppConfig, {
        driverSender: capturing(sent),
        riderSender: capturing(riderSent),
      });
      const server = createServer({
        health: { now: () => new Date(), startedAt: new Date(), env: process.env },
        webhook: { webhookSecret: WEBHOOK_SECRET, handler: built.handler },
      });
      return {
        sent,
        send: async (update: unknown) =>
          server.fetch(
            new Request("http://localhost/webhook/telegram/driver", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
              },
              body: JSON.stringify(update),
            }),
          ),
      };
    }

    it("‏ROUTING_PROVIDER=osrm يجعل السائق يقرأ زمن وصولٍ محسوباً بمسار الطريق", async () => {
      const osrm = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(JSON.stringify(ROUTE_BODY), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });
      try {
        const driverId = await registerDriver();
        await seedAssignedTrip(driverId, RIDER_CHAT);
        await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

        const bot = appWith({
          routingProvider: "osrm",
          osrmBaseUrl: `http://localhost:${osrm.port}`,
        });
        await bot.send(text(DRIVER_CHAT, "/trip"));

        const card = bot.sent.filter((m) => m.location === undefined)[0]?.text ?? "";
        // ‏٧١٤.٩ ثانية = ١٢ دقيقة بعد التدوير — الرقمُ من الخادم لا من افتراض
        expect(card).toContain(ar("driver.trip_eta_routed", { minutes: 12 }));
        expect(card).not.toContain(ar("driver.trip_eta_unavailable"));
        // ولا يُفقد ما كان يُقال قبل المرحلة: زمنُ الوصول إضافةٌ لا استبدال
        expect(card).toContain(ar("driver.trip_header"));
        expect(card).toContain(ar("driver.trip_distance_straight", { km: 1.7 }));
        expect(card).not.toContain("{");
      } finally {
        osrm.stop(true);
      }
    });

    it("خادمُ توجيهٍ ساقطٌ يُقال عنه صراحةً ولا يُسقط بقيّةَ البطاقة", async () => {
      const driverId = await registerDriver();
      await seedAssignedTrip(driverId, RIDER_CHAT);
      await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

      // منفذٌ ١ لا يُصغي عليه شيء: انقطاعٌ حقيقيّ لا مُحاكى بتزييف الدالّة
      const bot = appWith({ routingProvider: "osrm", osrmBaseUrl: "http://127.0.0.1:1" });
      await bot.send(text(DRIVER_CHAT, "/trip"));

      const card = bot.sent.filter((m) => m.location === undefined)[0]?.text ?? "";
      expect(card).toContain(ar("driver.trip_eta_unavailable"));
      expect(card).toContain(ar("driver.trip_header"));
      expect(card).toContain(ar("driver.trip_distance_straight", { km: 1.7 }));
    });

    /**
     * ولماذا يُثبَّت الصمتُ صراحةً: منصّةٌ بلا محرّكِ توجيهٍ لا تملك ما تقوله عن
     * زمن الوصول، وسطرُ «غير متاح الآن» فيها ضجيجٌ دائمٌ في كلّ بطاقةٍ لكلّ سائق.
     * فالامتناعُ عن السؤال ليس فشلاً يُبلَّغ عنه.
     */
    it("وبلا مزوّدٍ مضبوطٍ لا يُذكَر زمنُ الوصول أصلاً — لا رقماً ولا شكوى", async () => {
      const driverId = await registerDriver();
      await seedAssignedTrip(driverId, RIDER_CHAT);
      await post("driver", location(DRIVER_CHAT, JEDDAH_MOVED));

      const bot = appWith({ routingProvider: "none", osrmBaseUrl: null });
      await bot.send(text(DRIVER_CHAT, "/trip"));

      const card = bot.sent.filter((m) => m.location === undefined)[0]?.text ?? "";
      expect(card).not.toContain(ar("driver.trip_eta_unavailable"));
      expect(card).not.toContain("زمن الوصول");
      expect(card).toContain(ar("driver.trip_header"));
    });
  });
});
/**
 * `BUG-009` — أحداثُ هذا الملفِّ التي تُنشَر يدويّاً على الناقلِ تختبر حَرَسَ
 * المُرحِّلِ لا مولِّدَ الترتيبِ، فرقمُ الجلسةِ والتسلسلُ فيها قيمٌ اصطناعيّةٌ
 * صريحةٌ. ودليلُ المولِّدِ الحقيقيِّ — الأرقامُ تصدر من `PostgreSQL` — في
 * `tests/integration/tracking-sequence.test.ts`.
 */
const RELAY_PROBE_SESSION = "22222222-2222-4222-8222-222222222222";
