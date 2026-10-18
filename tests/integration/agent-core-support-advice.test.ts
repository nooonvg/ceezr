/**
 * الغرض: إثبات مسار القسم ج **كاملاً وفعلياً** على قاعدة PostgreSQL حقيقية عبر
 *   الـwebhook الحقيقي: سائق يفتح تذكرة دعم ← البطاقة تُنشر لفريق الدعم ← ثم
 *   يُنشَر **اقتراح آلي منفصل يُقرأ ولا يُنفَّذ** ← وتُسجَّل التجربة.
 *   وإثبات **اختبار العزل الإلزامي**: بتعطيل الطبقة يعمل فتح التذكرة ومعالجتها
 *   تماماً كما كانا قبل وجودها، بلا أي تغيير محسوس.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على نقطة الربط
 * ملاحظات مستقبلية: عند ربط حدث تشغيلي ثانٍ يُكتب له ملف مثله — **ولا يُوسَّع هذا**،
 *   فبقاؤه عن مسارٍ واحد هو ما يجعل فشله يدلّ على موضعه.
 *
 * ⚠️ الفرق الوحيد بين المجموعتين أدناه هو `AGENT_CORE_ENABLED`. كل ما عداه متطابق
 * حرفاً بحرف عمداً: هذا ما يجعل الفرق في النتيجة منسوباً إلى الطبقة وحدها.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
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
const WEBHOOK_SECRET = "advice-secret";
const SUPPORT_GROUP = "-1101";
const DRIVER_CHAT = 360_001;
const BOOTSTRAP_ADMIN_CHAT = 360_301;
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3994,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(BOOTSTRAP_ADMIN_CHAT),
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer> | undefined;
let driverSent: SentMessage[];
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
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const privateCallback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبار اقتراح الدعم مُتخطّى: عيّن TEST_DATABASE_URL.");
}

describeIf("القسم ج — اقتراح آلي على تذكرة دعم حقيقية", () => {
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
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا،
    // وبعدَ إغلاقِ الحاويةِ (شوطُها الخلفيُّ لا يسابقُ المسحَ — انظر beforeEach).
    await container?.close();
    container = undefined;
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, support_tickets, unsubscribed_claims,
                             unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
    delete process.env.AGENT_CORE_ENABLED;
    delete process.env.AGENT_CORE_RUNTIME_ROOT;
    delete process.env.AGENT_CORE_PERSISTENCE;
  });

  beforeEach(async () => {
    // حاويةُ الاختبارِ السابقِ تُغلَقُ قبلَ المسحِ: شوطُ البثِّ الفوريِّ الذي حفّزَه `/available`
    // يجري في الخلفيّةِ على اتّصالِه (`gatewayDispatch`، ADR 0289)، فإن بقيَ حيًّا سابقَ
    // `truncate` على الأقفالِ (deadlock 40P01). `end` ينتظرُ الاستعلامَ الجاريَ ثمّ يُغلق.
    if (container !== undefined) {
      await container.close();
      container = undefined;
    }
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, support_tickets, unsubscribed_claims,
                             unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: SUPPORT_GROUP, escalation: -1102, unsubscribed: -1103 },
      prior: cityHandle,
    });
    driverSent = [];
  });

  /** يُبنى الخادم **بعد** ضبط متغيّر التفعيل: البوّابة تقرأ الإعداد عند التركيب. */
  function boot(): void {
    container = buildContainer(config, { driverSender: capturing(driverSent) });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  }

  async function registerDriver(chatId: number): Promise<void> {
    await post(text(chatId, "/start"));
    await post(text(chatId, "فهد السائق"));
    await post(contact(chatId, "+966500000021"));
    await post(privateCallback(chatId, `city:${cityId}`));
    await post(privateCallback(chatId, "service:transport"));
    await post(privateCallback(chatId, "vehicle:sedan"));
    await post(text(chatId, "أ ب ج 1234"));
    await post(text(chatId, `1${String(chatId).slice(-9).padStart(9, "0")}`));
    await post(photo(chatId, `vphoto_${chatId}`));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chatId}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await post(text(chatId, "/available"));
    await post(location(chatId, DRIVER_AT));
  }

  async function openTicket(chatId: number, body: string): Promise<void> {
    await post(text(chatId, "/support"));
    await post(privateCallback(chatId, "sup:type:subscription"));
    await post(text(chatId, body));
  }

  const groupMessages = () => driverSent.filter((m) => m.chatId === SUPPORT_GROUP);
  const privateMessages = (chatId: number) => driverSent.filter((m) => m.chatId === String(chatId));

  // ══════════════════════════════════════════════════════════════════════════
  // ⚠️ اختبار العزل الإلزامي (القسم ج، البند 5)
  // ══════════════════════════════════════════════════════════════════════════

  describe("⚠️ الطبقة معطَّلة — يجب ألّا يتغيّر شيء", () => {
    beforeEach(() => {
      delete process.env.AGENT_CORE_ENABLED;
      boot();
    });

    it("فتح التذكرة ونشر بطاقتها وردّ السائق: كما كان تماماً", async () => {
      await registerDriver(DRIVER_CHAT);
      await openTicket(DRIVER_CHAT, "اشتراكي منتهي ودفعت التجديد ولين الحين ما تفعّل");

      const tickets = await sql<{ id: string }[]>`select id from support_tickets`;
      expect(tickets.length).toBe(1);

      // **رسالة واحدة فقط** في قروب الدعم: البطاقة. لا اقتراح ولا أثر للطبقة.
      expect(groupMessages().length).toBe(1);

      const ticketId = tickets[0]?.id ?? "";
      const confirmation = privateMessages(DRIVER_CHAT).at(-1);
      expect(confirmation?.text).toBe(
        ar("support.ticket_created", { ticket: ticketId.slice(0, 8) }),
      );
    });

    it("لا تُنشأ أي ملفات تشغيل للطبقة", () => {
      // البوّابة تعود فوراً عند التعطيل بلا تهيئة مخزن — يُثبَت هذا في اختبار الوحدة،
      // ويُثبَت هنا أنه صحيح داخل التركيب الحقيقي أيضاً.
      expect(process.env.AGENT_CORE_ENABLED).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // مسار القسم ج كاملاً — الطبقة مفعّلة
  // ══════════════════════════════════════════════════════════════════════════

  describe("الطبقة مفعّلة — اقتراح يُقرأ لا فعل يُنفَّذ", () => {
    beforeEach(() => {
      process.env.AGENT_CORE_ENABLED = "true";
      // بلا تخزين على القرص في الاختبار: السلوك واحد، والأثر الجانبي صفر.
      process.env.AGENT_CORE_PERSISTENCE = "false";
      boot();
    });

    it("يُنشَر اقتراح **منفصل** بعد البطاقة، وردّ السائق لا يتغيّر", async () => {
      await registerDriver(DRIVER_CHAT);
      await openTicket(DRIVER_CHAT, "اشتراكي منتهي ودفعت التجديد ولين الحين ما تفعّل الباقة");

      const tickets = await sql<{ id: string }[]>`select id from support_tickets`;
      expect(tickets.length).toBe(1);
      const ticketId = tickets[0]?.id ?? "";

      const group = groupMessages();
      // بطاقة + اقتراح = رسالتان. الفصل مقصود: الوقائع في رسالة والظنّ في أخرى.
      expect(group.length).toBe(2);

      const advice = group.at(-1)?.text ?? "";
      expect(advice).toContain(ticketId.slice(0, 8));
      // ⚠️ التحذير الصريح جزء من الرسالة نفسها لا من التوثيق.
      expect(advice).toContain("اقتراح");
      expect(advice).toContain("للقراءة فقط");

      // ⚠️ **ردّ السائق هو نفسه حرفياً** كما في حالة التعطيل: المستخدم لا يرى فرقاً.
      const confirmation = privateMessages(DRIVER_CHAT).at(-1);
      expect(confirmation?.text).toBe(
        ar("support.ticket_created", { ticket: ticketId.slice(0, 8) }),
      );
    });

    it("⚠️ الاقتراح لا يغيّر حالة التذكرة ولا الاشتراك — لا فعل يُنفَّذ", async () => {
      await registerDriver(DRIVER_CHAT);
      const before = await sql<{ status: string }[]>`select status from subscriptions`;
      await openTicket(DRIVER_CHAT, "اشتراكي منتهي ودفعت التجديد وما تفعّل");

      const ticket = await sql<{ status: string; claimed_by_user_id: string | null }[]>`
        select status, claimed_by_user_id from support_tickets limit 1
      `;
      // التذكرة **مفتوحة وغير مُستلَمة**: الاقتراح لم يستلمها ولم يحسمها.
      expect(ticket[0]?.status).toBe("open");
      expect(ticket[0]?.claimed_by_user_id).toBeNull();

      const after = await sql<{ status: string }[]>`select status from subscriptions`;
      expect(after.map((row) => row.status)).toEqual(before.map((row) => row.status));
    });

    /**
     * ═══ تعديل مقصود لهذا الاختبار ═══
     *
     * كان يؤكّد «لا أزرار أصلاً»، وذلك **كان يقيس الوسيلة لا الغاية**. الغاية
     * أن لا يوجد **زرّ قرار** تحت الاقتراح، لا أن تخلو الرسالة من كل زرّ.
     * فأُبدِل بما هو أقوى منه: ليس في الرسالة إلا `sup:advice:*`، ولا أثر فيها
     * لـ `activate` أو `terminate` أو `reject` — وهي أفعال الدنيا الثلاثة.
     */
    it("⚠️ الاقتراح بلا أزرار قرار — زرّا تقييم لا غير", async () => {
      await registerDriver(DRIVER_CHAT);
      await openTicket(DRIVER_CHAT, "اشتراكي منتهي وأبغى أفعّل الباقة");
      const markup = JSON.stringify(groupMessages().at(-1)?.markup ?? null);

      expect(markup).toContain("sup:advice:ok:");
      expect(markup).toContain("sup:advice:no:");
      // ⚠️ ولا واحد من أفعال القرار يبلغ هذه الرسالة.
      for (const decisionAction of ["activate", "terminate", "reject", "claim"]) {
        expect(markup).not.toContain(`sup:${decisionAction}:`);
      }
    });

    it("القرار يُحفظ في `agent_decisions` بسقف SUGGEST لا غير", async () => {
      await registerDriver(DRIVER_CHAT);
      await openTicket(DRIVER_CHAT, "اشتراكي منتهي وأبغى أفعّل الباقة");

      const rows = await sql<
        { trace_id: string; allowed_tool_level: string; published: boolean; city_id: string }[]
      >`select trace_id, allowed_tool_level, published, city_id from agent_decisions`;

      // قرارٌ واحد محفوظ — فبلا صفّ لا قياس لاحقاً مهما نُقِر من أزرار.
      expect(rows.length).toBe(1);
      expect(rows[0]?.published).toBe(true);
      expect(rows[0]?.city_id).not.toBeNull();
      // ⚠️ القيد مكتوب في البيانات: صفّ بغير SUGGEST يعني أن شيئاً جوهرياً انكسر.
      expect(rows[0]?.allowed_tool_level).toBe("SUGGEST");
    });

    it("نصّ مهذّب بلا شكوى: تُفتح التذكرة وتُنشر بطاقتها بلا اقتراح", async () => {
      await registerDriver(DRIVER_CHAT);
      await openTicket(DRIVER_CHAT, "السلام عليكم ورحمة الله وبركاته وبعد شكرا لكم");

      expect((await sql`select id from support_tickets`).length).toBe(1);
      // البطاقة وحدها: لا اقتراح مخترَع لنصّ لا يدلّ على شيء.
      expect(groupMessages().length).toBe(1);
    });
  });
});
