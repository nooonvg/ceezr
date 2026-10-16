/**
 * الغرض: إثبات أن تسجيل السائق لم يعد ينتهي عند اختيار الخدمة. قبل هذه المرحلة
 *   كان يُنشأ سائقٌ لا يُعرف ما يقود ولا رقم لوحته ولا من هو، ثم يُوثَّق على هذا
 *   الفراغ — وهو ما اشتكى منه المالك. هنا نثبت أن الصفّ لا يُكتب إلا بملفٍّ كامل.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: يُوسَّع عند إضافة أماكن العمل المفضّلة ورخصة القيادة.
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
const WEBHOOK_SECRET = "kyc-secret";
const DRIVER_CHAT = 260_001;
const OTHER_CHAT = 260_002;

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

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

/** الخطوات حتى اختيار الخدمة — حيث كان التسجيل ينتهي سابقاً. */
async function upToService(chat: number, phone: string): Promise<void> {
  await post(text(chat, "/start"));
  await post(text(chat, "فهد العتيبي"));
  await post(contact(chat, phone));
  await post(callback(chat, `city:${cityId}`));
  await post(callback(chat, "service:transport"));
}

async function fullRegistration(
  chat: number,
  phone: string,
  nationalId: string,
  plate = "أ ب ج 1234",
): Promise<void> {
  await upToService(chat, phone);
  await post(callback(chat, "vehicle:sedan"));
  await post(text(chat, plate));
  await post(text(chat, nationalId));
  await post(photo(chat, `photo_${chat}`));
}

interface DriverRow {
  vehicle_type: string | null;
  plate_number: string | null;
  national_id: string | null;
  vehicle_photo_file_id: string | null;
  verification_status: string;
}

async function driverRows(): Promise<DriverRow[]> {
  return sql<DriverRow[]>`
    select vehicle_type, plate_number, national_id, vehicle_photo_file_id, verification_status
      from drivers`;
}

describeIf("تسجيل السائق: الملفّ التوثيقي", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
  });

  /**
   * إغلاقُ حاويةِ السيناريو عقب كلِّ اختبار لا مرّةً واحدةً في النهاية: الحاويةُ
   * تُنشئ حوضَ اتّصالاتٍ خاصّاً بها، وبناؤها في `beforeEach` مع إغلاقٍ وحيدٍ في
   * `afterAll` يُراكم أحواضاً بعددِ اختباراتِ الملفّ. القاعدةُ المحلّية كانت تحتمل
   * التراكمَ بسعتها الأوسع، أمّا خدمةُ PostgreSQL في آلةِ التكامل فتقف عند حدّها
   * الافتراضيّ فتردّ «sorry, too many clients already» — فيُخفق سربٌ من اختباراتٍ
   * سليمةٍ لا علاقةَ لها بالعيب، ويُحوّل الحمرةَ إلى ضجيجٍ يُخفي الأعطالَ الحقيقية.
   */
  afterEach(async () => {
    // إن أخفقَ التهيئةُ لم تُبنَ الحاويةُ أصلاً، وطرحُ خطأٍ ثانٍ في التفكيك يطمس الأوّل.
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
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

  it("لا يُنشئ سائقاً عند اختيار الخدمة بل يسأل عن المركبة", async () => {
    // هذا هو العطب المُبلَّغ عنه: هنا بالضبط كان يُكتب صفّ سائق بلا مركبة ولا هوية
    await upToService(DRIVER_CHAT, "+966500000260");

    expect(await driverRows()).toHaveLength(0);
    const last = driverSent.at(-1);
    expect(last?.text).toContain("نوع مركبتك");
    expect(last?.markup).not.toBeNull();
  });

  it("يُنشئ السائق بملفٍّ كامل بعد وصول الصورة", async () => {
    await fullRegistration(DRIVER_CHAT, "+966500000260", "1012345678");

    const rows = await driverRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vehicle_type).toBe("sedan");
    expect(rows[0]?.plate_number).toBe("أ ب ج 1234");
    expect(rows[0]?.national_id).toBe("1012345678");
    expect(rows[0]?.vehicle_photo_file_id).toBe(`photo_${DRIVER_CHAT}`);
    // التوثيق يبقى بشرياً: اكتمال الملفّ يؤهّل للتوثيق ولا يمنحه
    expect(rows[0]?.verification_status).toBe("pending");
  });

  it("يقبل الهوية واللوحة بالأرقام العربية ويخزّنهما بـASCII", async () => {
    await fullRegistration(OTHER_CHAT, "+966500000261", "١٠١٢٣٤٥٦٧٨", "abc ١٢٣٤");

    const rows = await driverRows();
    expect(rows[0]?.national_id).toBe("1012345678");
    expect(rows[0]?.plate_number).toBe("ABC 1234");
  });

  it("يرفض هوية خاطئة ويقول سببها ولا يتقدّم", async () => {
    await upToService(DRIVER_CHAT, "+966500000260");
    await post(callback(DRIVER_CHAT, "vehicle:sedan"));
    await post(text(DRIVER_CHAT, "أ ب ج 1234"));

    const before = driverSent.length;
    await post(text(DRIVER_CHAT, "9012345678"));

    // السبب بعينه لا "غير صالح": البادئة 9 ليست هوية ولا إقامة
    expect(driverSent.at(-1)?.text).toContain("يبدأ بـ1");
    expect(driverSent.length).toBe(before + 1);
    expect(await driverRows()).toHaveLength(0);
  });

  it("لا يقبل نصّاً مكان صورة المركبة", async () => {
    await upToService(DRIVER_CHAT, "+966500000260");
    await post(callback(DRIVER_CHAT, "vehicle:sedan"));
    await post(text(DRIVER_CHAT, "أ ب ج 1234"));
    await post(text(DRIVER_CHAT, "1012345678"));
    await post(text(DRIVER_CHAT, "أرسلتها"));

    expect(driverSent.at(-1)?.text).toContain("صورة فعلية");
    expect(await driverRows()).toHaveLength(0);
  });

  it("يمنع حساباً ثانياً بنفس الهوية في المدينة ويقول السبب", async () => {
    await fullRegistration(DRIVER_CHAT, "+966500000260", "1012345678");
    expect(await driverRows()).toHaveLength(1);

    // نفس الهوية من حساب تيليجرام آخر: تجربة مجّانية ثانية، أو عودة محظور
    await fullRegistration(OTHER_CHAT, "+966500000261", "1012345678");

    expect(await driverRows()).toHaveLength(1);
    expect(driverSent.at(-1)?.text).toContain("مسجَّل بالفعل");
  });
});
