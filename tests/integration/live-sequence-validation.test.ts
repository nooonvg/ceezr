/**
 * الغرض: المرحلة ٥ — إثبات أن **تحقّق التتابع** يعمل في المسار الحيّ.
 *
 *   المرحلة ٤ وصّلت تقييم الإصلاحة الواحدة (الإحداثيات، الدقّة، الاتجاه، الزمن)
 *   وصرّحت بأن تقييم التتابع لا يعمل: `handleLocation` كانت تمرّر `previous = null`
 *   ثابتةً، فكان نصف المُقيِّم معطّلاً حيّاً. وهذه الاختبارات تقيس الفرق:
 *
 *   (١) إصلاحتان متتاليتان بمسافة معقولة ⇒ ACCEPT.
 *   (٢) قفزة مئتَي كيلومتر بين رسالتين متتاليتين ⇒ الحكم يتدهور، والموقع الأحدث
 *       يُخزَّن مع حكمه لا يُطرح.
 *   (٣) السابقة تُقرأ من المصدر القانوني (ADR-0015) لا من ذاكرة العملية: تُحقَن
 *       قيمةٌ في القاعدة مباشرةً، فيراها التقييم التالي.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
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
const DRIVER_CHAT = 120_778;
const ADMIN_TELEGRAM = 990_778;

/** جدة ← ثم نقطة على بُعد ٢٥٠ متراً ← ثم الرياض. */
const JEDDAH = { latitude: 21.5471, longitude: 39.1751 };
const JEDDAH_NEARBY = { latitude: 21.5493, longitude: 39.1751 };
const RIYADH = { latitude: 24.7136, longitude: 46.6753 };

const config: AppConfig = testConfig({
  port: 3996,
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

/** `atSecondsAgo` يُحرّك طابع الرسالة، وبه تُصنع سرعةٌ محسوبة يُحكم عليها. */
const location = (chatId: number, at: { latitude: number; longitude: number }, atSecondsAgo = 0) =>
  message(chatId, {
    location: { ...at, horizontal_accuracy: 8 },
    date: Math.floor(Date.now() / 1000) - atSecondsAgo,
  });

interface LocationRow {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly quality: string | null;
}

async function readCanonical(driverId: string): Promise<LocationRow> {
  const rows = await sql<LocationRow[]>`
    select st_y(last_location::geometry) as lat,
           st_x(last_location::geometry) as lng,
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

describeIf("تحقّق التتابع في المسار الحيّ — المرحلة ٥", () => {
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
    await post("driver", text(DRIVER_CHAT, "سالم الحربي"));
    await post("driver", contact(DRIVER_CHAT, "0501110778"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1235"));
    await post("driver", text(DRIVER_CHAT, "1000001778"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001778"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    return driverId;
  }

  it("حركة طبيعية بين إصلاحتين تبقى ACCEPT", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH, 60));
    await post("driver", location(DRIVER_CHAT, JEDDAH_NEARBY, 0));

    const row = await readCanonical(driverId);
    expect(row.quality).toBe("ACCEPT");
    expect(row.lat).toBeCloseTo(JEDDAH_NEARBY.latitude, 4);
  });

  it("قفزة ٨٠٠ كم بين رسالتين تُكتشف الآن — وكانت تمرّ بلا أثر", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH, 60));
    await post("driver", location(DRIVER_CHAT, RIYADH, 0));

    const row = await readCanonical(driverId);
    /**
     * هذا هو قلب المرحلة. قبلها كانت `previous = null` فتُقيَّم الرياض إصلاحةً
     * سليمةً معزولة — لأنها كذلك في ذاتها — فتُخزَّن `ACCEPT`، وتقرؤها المطابقة
     * سائقاً حقيقياً هناك. والانتقال اللحظي لا يظهر إلا بين نقطتين.
     */
    expect(row.quality).not.toBe("ACCEPT");
    expect(row.lat).toBeCloseTo(RIYADH.latitude, 3);
    // والأحدث يُخزَّن موسوماً لا يُطرح: طرحُه يُجمّد السائق عند نقطة ميتة
    // ويترك العمليات ترى مكاناً يعلم الجميع أنه ليس فيه.
  });

  it("السابقة تُقرأ من المصدر القانوني لا من ذاكرة العملية", async () => {
    const driverId = await registerDriver();

    /**
     * تُحقَن السابقة في القاعدة مباشرةً بلا أن تمرّ بالبوت. فلو كانت الذاكرة هي
     * المرجع لما رآها التقييم التالي شيئاً وحكم ACCEPT. ونجاح هذا الاختبار هو
     * الدليل على أن ADR-0015 هو ما يُقرأ فعلاً — ذاكرةٌ محلّية كانت تضيع بإعادة
     * التشغيل وتترك كل نسخةٍ من الخادم بتاريخٍ مختلف للسائق نفسه.
     */
    await sql`
      update drivers
         set last_location = st_setsrid(st_makepoint(${RIYADH.longitude}, ${RIYADH.latitude}), 4326)::geography,
             last_location_at = now() - interval '60 seconds',
             last_location_recorded_at = now() - interval '60 seconds'
       where id = ${driverId}
    `;

    await post("driver", location(DRIVER_CHAT, JEDDAH, 0));

    const row = await readCanonical(driverId);
    expect(row.quality).not.toBe("ACCEPT");
    expect(row.lat).toBeCloseTo(JEDDAH.latitude, 4);
  });

  it("أول إصلاحة على الإطلاق لا سابقة لها فتُقبل ACCEPT", async () => {
    const driverId = await registerDriver();
    await post("driver", location(DRIVER_CHAT, JEDDAH, 0));

    // غياب السابقة ليس تنبيهاً: كلّ سائق يبدأ بلا تاريخ، ووسمُ أول إصلاحة
    // بالشكّ كان سيجعل كل تسجيلٍ جديد يبدأ موسوماً.
    const row = await readCanonical(driverId);
    expect(row.quality).toBe("ACCEPT");
  });
});
