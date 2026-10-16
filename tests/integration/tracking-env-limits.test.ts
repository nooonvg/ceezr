/**
 * الغرض: §4.3 — إثبات أنّ متغيّرات `TRACKING_*` تُغيّر سلوك المسار الحيّ فعلاً.
 *
 *   لم تكن هذه المتغيّرات تُقرأ في سطرٍ واحد من الكود: مُعلَنةٌ في `render.yaml`
 *   و`.env.example` بأسماء مختلفة بينهما، و`driver-dialog` يستدعي
 *   `DEFAULT_GPS_POLICY` مرمَّزاً. فالمشغّل يشدّ حدّ السرعة استجابةً لانتحالٍ
 *   يراه، ويعيد النشر، ولا يتغيّر شيء — ولا رسالةَ خطأٍ تُخبره. وهم تحكّمٍ كامل.
 *
 *   والاختبار على الافتراض لا يُثبت شيئاً من هذا: يمرّ تماماً في الحالتين. فهنا
 *   تُبنى **حاويتان** من نفس الكود بضبطين مختلفين، وتُقاس نفس الحركة بهما:
 *
 *   (١) ٢٥٠ متراً في ٦٠ ثانية (≈١٥ كم/س) بالافتراض ⇒ ACCEPT.
 *   (٢) نفس الحركة بحدٍّ بيئيّ ٥ كم/س ⇒ تتدهور. الفرق كلّه من البيئة.
 *   (٣) حدُّ الدقّة كذلك: إصلاحةٌ بدقّة ٨ أمتار تُرفض حين يُضبط الحدّ على ٣.
 *   (٤) قيمةٌ غير رقميّة في البيئة تُسقط الإقلاع بخطأٍ يسمّي المتغيّر.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig, TrackingEnvOverrides } from "../../packages/shared/config/index.ts";
import { NO_TRACKING_OVERRIDES, tryLoadConfig } from "../../packages/shared/config/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 120_991;
const ADMIN_TELEGRAM = 990_991;

/** ٢٥٠ متراً تقريباً بين النقطتين — حركةُ حيٍّ عاديّة لا قفزةَ انتحال. */
const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
const JEDDAH_NEARBY = { latitude: 21.5493, longitude: 39.1751 };

function configWith(tracking: TrackingEnvOverrides): AppConfig {
  return testConfig({
    port: 3991,
    telegramWebhookSecret: WEBHOOK_SECRET,
    bootstrapAdminTelegramId: String(ADMIN_TELEGRAM),
    tracking,
  });
}

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let container: ReturnType<typeof buildContainer> | null = null;
let app: ReturnType<typeof createServer>;

async function post(update: unknown): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/webhook/telegram/driver", {
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
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});
const location = (
  chatId: number,
  at: { latitude: number; longitude: number },
  atSecondsAgo = 0,
  accuracyMeters = 8,
) =>
  message(chatId, {
    location: { ...at, horizontal_accuracy: accuracyMeters },
    date: Math.floor(Date.now() / 1000) - atSecondsAgo,
  });

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

describeIf("حدود التتبّع من البيئة تُغيّر المسار الحيّ — §4.3", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
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
    /**
     * القروباتُ الثلاثة تُضبَط هنا مع التفعيل لا قبله: قيدُ
     * `cities_active_requires_groups` يمنع تفعيلَ مدينةٍ بلا قروباتها، ولا تبذُرها
     * أيّةُ هجرة. فكان هذا السطرُ ينجح فقط إذا سبقه ملفُّ اختبارٍ آخرُ ضبطها —
     * أي أنّ نجاحَه كان معلَّقاً على ترتيبِ اكتشافِ الملفّات، وهو يختلف بين
     * الجهازِ المحلّيّ وآلةِ التكامل. فمرّ محلّياً وسقط بعيداً، ثمّ سرَّب فشلُه
     * حاوياتٍ لم تُغلَق فأنفدَ اتّصالاتَ القاعدة وأسقط ملفّاتٍ لا علاقة لها به.
     */
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  });

  afterEach(async () => {
    if (container !== null) {
      await container.close();
      container = null;
    }
  });

  /** يبني الخادم بضبطٍ مُعيَّن — وهذا هو محلّ القياس: نفس الكود، بيئةٌ أخرى. */
  function boot(tracking: TrackingEnvOverrides): void {
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    container = buildContainer(configWith(tracking), {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  }

  async function registerDriver(): Promise<string> {
    await post(text(DRIVER_CHAT, "/start"));
    await post(text(DRIVER_CHAT, "سالم الحربي"));
    await post(contact(DRIVER_CHAT, "0501110991"));
    await post(callback(DRIVER_CHAT, `city:${cityId}`));
    await post(callback(DRIVER_CHAT, "service:transport"));
    await post(callback(DRIVER_CHAT, "vehicle:sedan"));
    await post(text(DRIVER_CHAT, "أ ب ج 1991"));
    await post(text(DRIVER_CHAT, "1000001991"));
    await post(photo(DRIVER_CHAT, "vphoto_1000001991"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    return driverId;
  }

  async function qualityOf(driverId: string): Promise<string | null> {
    const rows = await sql<{ quality: string | null }[]>`
      select last_location_quality as quality from drivers where id = ${driverId}
    `;
    const row = rows[0];
    if (row === undefined) throw new Error("لم يُقرأ السائق");
    return row.quality;
  }

  it("١٥ كم/س بالافتراض ⇒ ACCEPT — الأساس الذي يُقاس عليه", async () => {
    boot(NO_TRACKING_OVERRIDES);
    const driverId = await registerDriver();
    await post(location(DRIVER_CHAT, JEDDAH, 60));
    await post(location(DRIVER_CHAT, JEDDAH_NEARBY, 0));

    expect(await qualityOf(driverId)).toBe("ACCEPT");
  });

  it("نفس الحركة بحدٍّ بيئيّ ٥ كم/س ⇒ تتدهور — البيئة وحدها هي الفرق", async () => {
    boot({ ...NO_TRACKING_OVERRIDES, maxReasonableSpeedKmh: 5 });
    const driverId = await registerDriver();
    await post(location(DRIVER_CHAT, JEDDAH, 60));
    await post(location(DRIVER_CHAT, JEDDAH_NEARBY, 0));

    /**
     * لو رجع الاستدعاء إلى `DEFAULT_GPS_POLICY` مرمَّزاً يوماً لعاد هذا التوقّع
     * `ACCEPT` — فهذا الاختبار هو الحرس على الربط نفسه لا على الرقم.
     */
    expect(await qualityOf(driverId)).not.toBe("ACCEPT");
  });

  it("حدّ الدقّة البيئيّ يسري كذلك: ٨ أمتار تُرفض عند حدّ ٣", async () => {
    boot({ ...NO_TRACKING_OVERRIDES, maxAccuracyMeters: 3 });
    const driverId = await registerDriver();
    await post(location(DRIVER_CHAT, JEDDAH, 0, 8));

    // لا سابقة هنا ولا سرعة — الحكم من الدقّة وحدها، فالمتغيّر معزولٌ في القياس.
    expect(await qualityOf(driverId)).not.toBe("ACCEPT");
  });

  it("قيمة غير رقميّة تُسقط الإقلاع باسم المتغيّر — لا تُهمَل إلى الافتراض", () => {
    const base: Record<string, string> = {
      NODE_ENV: "test",
      PORT: "3000",
      SUPABASE_URL: "https://x.supabase.co",
      DATABASE_URL: "postgres://u@h/db",
      SUPABASE_SERVICE_ROLE_KEY: "k",
      UPSTASH_REDIS_REST_URL: "http://localhost",
      UPSTASH_REDIS_REST_TOKEN: "t",
      DRIVER_BOT_TOKEN: "d",
      RIDER_BOT_TOKEN: "r",
      TELEGRAM_WEBHOOK_SECRET: "s".repeat(40),
      BOOTSTRAP_ADMIN_TELEGRAM_ID: "1",
      BOT_SURFACE_MODE: "miniapp",
      MINIAPP_URL: "https://miniapp.example",
      TRACKING_MAX_REASONABLE_SPEED_KMH: "سريع",
    };
    const result = tryLoadConfig(base);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    /**
     * الإهمالُ الصامت هو الخطر الأصليّ نفسه بلبوسٍ آخر: مشغّلٌ كتب `120kmh`
     * بلاحقةٍ ويظنّ الحدّ ١٢٠ وهو ٢٠٠. الفشلُ عند الإقلاع يكلّف دقيقةً، والقبولُ
     * الصامت يكلّف حادثاً لا يُعرف سببه.
     */
    expect(result.error.message).toContain("TRACKING_MAX_REASONABLE_SPEED_KMH");
  });
});
