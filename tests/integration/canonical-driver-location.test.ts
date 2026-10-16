/**
 * الغرض: المرحلة ٤ — إثبات ADR-0015 على قاعدة حقيقية.
 *
 *   الادّعاء المُختبَر ليس «الكود يستدعي المُقيِّم» بل ثلاثة أشياء قابلة للقياس:
 *   (١) رسالة موقع من تلغرام تصل إلى `drivers.last_location` وحده، وأن الدقّة
 *       والحكم يُخزَّنان معها في الصفّ نفسه لا يُطرحان في الطريق.
 *   (٢) أن المسار الحيّ صار يمرّ بمُقيِّم المرحلة ٣ فعلاً: إصلاحة خشنة تُقبل
 *       موسومةً بـWARNING، وهو ما لم يكن ممكناً تمثيله قبل هذه المرحلة أصلاً.
 *   (٣) أن الكاتب واحد: القارئ الذي تستعمله المطابقة يرى ما كتبه مسار البوت.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: عند تنفيذ LocationStore في المرحلة ٦ يُضاف هنا تأكيد أنها
 *   مشتقّة من القاعدة لا موازية لها (أي أن التعارض يُحسم لصالح القاعدة).
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
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 120_777;
const ADMIN_TELEGRAM = 990_777;
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3997,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(ADMIN_TELEGRAM),
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;

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

/** رسالة موقع بشكلها الكامل كما يرسلها تلغرام — بالدقّة والاتجاه والطابع الزمني. */
const location = (
  chatId: number,
  at: { latitude: number; longitude: number },
  extra: Record<string, unknown> = {},
) =>
  message(chatId, {
    location: { ...at, ...extra },
    date: Math.floor(Date.now() / 1000),
  });

interface LocationRow {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly accuracy: number | null;
  readonly quality: string | null;
}

async function readCanonical(driverId: string): Promise<LocationRow> {
  const rows = await sql<LocationRow[]>`
    select st_y(last_location::geometry) as lat,
           st_x(last_location::geometry) as lng,
           last_location_accuracy_m as accuracy,
           last_location_quality as quality
      from drivers where id = ${driverId}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error("لم يُقرأ السائق");
  return row;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("الموقع القانوني — ADR-0015", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  /**
   * كل حالة تبني حاويةً جديدة، فكل حالة تُغلق حاويتها. تركُ الإغلاق لـ`afterAll`
   * يُغلق الأخيرة وحدها ويترك ما قبلها ممسكاً ببِرك اتصال إلى نهاية التشغيل —
   * وهو تسريب لا يظهر في ملفٍّ يُشغَّل وحده، ويظهر حين تجتمع ملفات التكامل كلّها.
   */
  afterEach(async () => {
    // إن أخفقَ التهيئةُ لم تُبنَ الحاويةُ أصلاً، وطرحُ خطأٍ ثانٍ في التفكيك يطمس الأوّل.
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
    /**
     * القروباتُ الثلاثة تُضبَط هنا مع التفعيل لا قبله: قيدُ
     * `cities_active_requires_groups` يمنع تفعيلَ مدينةٍ بلا قروباتها، ولا تبذُرها
     * أيّةُ هجرة. فكان هذا السطرُ ينجح فقط إذا سبقه ملفُّ اختبارٍ آخرُ ضبطها —
     * أي أنّ نجاحَه كان معلَّقاً على ترتيبِ اكتشافِ الملفّات، وهو يختلف بين
     * الجهازِ المحلّيّ وآلةِ التكامل. فمرّ محلّياً وسقط بعيداً، ثمّ سرَّب فشلُه
     * حاوياتٍ لم تُغلَق فأنفدَ اتّصالاتَ القاعدة وأسقط ملفّاتٍ لا علاقة لها به.
     */
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
    const driverSent: SentMessage[] = [];
    const riderSent: SentMessage[] = [];
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  async function registerDriver(): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "خالد المطيري"));
    await post("driver", contact(DRIVER_CHAT, "0501110777"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000001777"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001777"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    return driverId;
  }

  it("رسالة الموقع تكتب الموضع والدقّة والحكم في الصفّ نفسه", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, DRIVER_AT, { horizontal_accuracy: 12 }));

    const row = await readCanonical(driverId);
    expect(row.lat).toBeCloseTo(DRIVER_AT.latitude, 5);
    expect(row.lng).toBeCloseTo(DRIVER_AT.longitude, 5);
    expect(row.accuracy).toBe(12);
    expect(row.quality).toBe("ACCEPT");
  });

  /**
   * قبل المرحلة ٤ كان هذا غير قابل للتمثيل: الدقّة كانت تُسقَط في المُحوِّل،
   * فتُخزَّن إصلاحة بدقّة ثلاثة كيلومترات كأنها إصلاحة بدقّة مترين.
   */
  it("الإصلاحة الخشنة تُقبل موسومةً بـWARNING لا تُطرح", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, DRIVER_AT, { horizontal_accuracy: 3000 }));

    const row = await readCanonical(driverId);
    expect(row.lat).toBeCloseTo(DRIVER_AT.latitude, 5);
    expect(row.accuracy).toBe(3000);
    expect(row.quality).toBe("WARNING");
  });

  it("الاتجاه الفاسد لا يمنع حفظ الموضع", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, DRIVER_AT, { heading: 900 }));

    const row = await readCanonical(driverId);
    expect(row.lat).toBeCloseTo(DRIVER_AT.latitude, 5);
    expect(row.quality).toBe("WARNING");
  });

  /** مصدر لم يُبلّغ دقّة ≠ مصدر بلّغ دقّةً ممتازة. `null` تحفظ الفرق. */
  it("غياب الدقّة يُخزَّن null لا صفراً", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));

    const row = await readCanonical(driverId);
    expect(row.accuracy).toBeNull();
    expect(row.quality).toBe("ACCEPT");
  });

  /**
   * جوهر ADR-0015: القاعدة تحرس عمودها بنفسها. لو التفّ كاتبٌ ثانٍ يوماً على
   * المنفذ وكتب حكماً بتهجئة أخرى، فالقيد يرفضه في القاعدة لا في مراجعة كود.
   */
  it("القاعدة ترفض حكم جودة غير مُعرَّف", async () => {
    const driverId = await registerDriver();
    let rejected = false;
    try {
      await sql`update drivers set last_location_quality = 'GOOD' where id = ${driverId}`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("القاعدة ترفض دقّة سالبة", async () => {
    const driverId = await registerDriver();
    let rejected = false;
    try {
      await sql`update drivers set last_location_accuracy_m = -1 where id = ${driverId}`;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  /**
   * الكاتب واحد: يُقرأ بالاستعلام نفسه الذي تقرأ به المطابقة (ST_Y/ST_X على
   * `last_location`)، لا بمنفذ آخر — فلو تفرّع مسار كتابةٍ ثانٍ لظهر هنا فرقٌ.
   */
  it("ما يكتبه مسار البوت هو ما تقرؤه المطابقة", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, DRIVER_AT, { horizontal_accuracy: 8 }));

    const rows = await sql<{ lat: number; lng: number }[]>`
      select st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng
        from drivers d
       where d.id = ${driverId} and d.last_location is not null
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lat).toBeCloseTo(DRIVER_AT.latitude, 5);
  });
});
