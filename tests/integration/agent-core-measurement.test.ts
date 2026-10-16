/**
 * الغرض: إثبات **إغلاق حلقة القياس** فعلياً على قاعدة حقيقية: قرارٌ يُحفظ، ثم
 *   حكمٌ عليه يصل بالطرق الثلاث (نقرة، استنتاج، توسيم يدوي)، وأسبقيةٌ بينها
 *   تُحسم في القاعدة لا في التوثيق، وتقريرٌ يقرأ الحصيلة.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأي تعديل على `record_agent_outcome`
 * ملاحظات مستقبلية: حين يُقاس وكيل ثانٍ لا يتغيّر هذا الملف — الجدول لا يعرف الوكلاء.
 *
 * ═══ لماذا هذا الملف موجود أصلاً ═══
 *
 * قبله كان `recordOutcome` **معرَّفاً ولا يُستدعى من أيّ مسار حقيقي**: التقييم كان
 * سيعود `insufficient_data` أبداً مهما مرّ من تذاكر. فهذا الملف ليس تغطيةً إضافية
 * لمسارٍ قائم، بل **البرهان على أن الحلقة أُغلقت** — وبسقوطه يعود النظام أعمى
 * عن جدوى نفسه دون أن يُعلن ذلك.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
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
const WEBHOOK_SECRET = "measure-secret";
const SUPPORT_GROUP = "-1201";
const DRIVER_CHAT = 361_001;
const SUPPORT_CHAT = 361_101;
const BOOTSTRAP_ADMIN_CHAT = 361_301;
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3993,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(BOOTSTRAP_ADMIN_CHAT),
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
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
/** ضغطة داخل قروب الدعم: `chat.id` هو القروب، و`from.id` هو الموظّف. */
const groupCallback = (userId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: userId }, message: { chat: { id: SUPPORT_GROUP } } },
});

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  اختبار قياس الاقتراحات مُتخطّى: عيّن TEST_DATABASE_URL.");
}

interface OutcomeRow {
  verdict: string;
  source: string;
  human_action: string | null;
}

describeIf("قياس جدوى الاقتراحات — الحلقة مغلقة فعلاً", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
    delete process.env.AGENT_CORE_ENABLED;
    delete process.env.AGENT_CORE_RUNTIME_ROOT;
    delete process.env.AGENT_CORE_PERSISTENCE;
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: SUPPORT_GROUP, escalation: -1202, unsubscribed: -1203 },
      prior: cityHandle,
    });
    driverSent = [];
    process.env.AGENT_CORE_ENABLED = "true";
    process.env.AGENT_CORE_PERSISTENCE = "memory";
    container = buildContainer(config, { driverSender: capturing(driverSent) });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  async function registerDriver(chatId: number): Promise<void> {
    await post(text(chatId, "/start"));
    await post(text(chatId, "فهد السائق"));
    await post(contact(chatId, "+966500000031"));
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

  /** موظّف دعم حقيقي في `users` — النقرة تتطلّب فاعلاً موجوداً، والقاعدة تفرضه. */
  async function registerSupportAgent(chatId: number): Promise<void> {
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, ${chatId}, 'سعيد الدعم', '+966500000039', 'support')
    `;
  }

  /** يفتح تذكرة تُنتج اقتراحاً، ويعيد معرّفي التذكرة والأثر معاً. */
  async function openAdvisedTicket(
    body = "اشتراكي منتهي ودفعت التجديد ولين الحين ما تفعّل",
  ): Promise<{ ticketId: string; traceId: string }> {
    await post(text(DRIVER_CHAT, "/support"));
    await post(privateCallback(DRIVER_CHAT, "sup:type:subscription"));
    await post(text(DRIVER_CHAT, body));
    const rows = await sql<{ ticket_id: string; trace_id: string }[]>`
      select ticket_id, trace_id from agent_decisions order by created_at desc limit 1
    `;
    const row = rows[0];
    if (row === undefined) throw new Error("لم يُحفَظ أي قرار — الحلقة مفتوحة");
    return { ticketId: row.ticket_id, traceId: row.trace_id };
  }

  const outcomes = () =>
    sql<OutcomeRow[]>`select verdict, source, human_action from agent_outcomes`;

  // ════════════════════════════════════════════════════════════════════════
  // ١ — النقرة
  // ════════════════════════════════════════════════════════════════════════

  it("زرّ «مفيد» يُسجّل حكماً موثوقاً بمصدر button ولا يمسّ التذكرة", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId, traceId } = await openAdvisedTicket();

    await post(groupCallback(SUPPORT_CHAT, `sup:advice:ok:${traceId}`));

    const rows = await outcomes();
    expect(rows.length).toBe(1);
    expect(rows[0]?.verdict).toBe("accepted");
    expect(rows[0]?.source).toBe("button");

    // ⚠️ **جوهر القيد**: نقرة التقييم لم تستلم التذكرة ولم تحسمها ولم تفعّل اشتراكاً.
    const ticket = await sql<{ status: string; claimed_by_user_id: string | null }[]>`
      select status, claimed_by_user_id from support_tickets where id = ${ticketId}
    `;
    expect(ticket[0]?.status).toBe("open");
    expect(ticket[0]?.claimed_by_user_id).toBeNull();
  });

  it("زرّ «غير مفيد» يُسجّل rejected، والردّ خاصٌّ لا في القروب", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { traceId } = await openAdvisedTicket();
    const groupBefore = driverSent.filter((m) => m.chatId === SUPPORT_GROUP).length;

    await post(groupCallback(SUPPORT_CHAT, `sup:advice:no:${traceId}`));

    const rows = await outcomes();
    expect(rows[0]?.verdict).toBe("rejected");
    expect(rows[0]?.source).toBe("button");

    // لا رسالة جديدة في القروب: التقييم لا يُعلَن على الزملاء.
    expect(driverSent.filter((m) => m.chatId === SUPPORT_GROUP).length).toBe(groupBefore);
    const priv = driverSent.filter((m) => m.chatId === String(SUPPORT_CHAT)).at(-1);
    expect(priv?.text).toBe(ar("support.advice_feedback_thanks"));
  });

  it("نقرة على أثر لا وجود له لا تكتب شيئاً ولا تُسقط الطلب", async () => {
    await registerSupportAgent(SUPPORT_CHAT);
    const response = await post(groupCallback(SUPPORT_CHAT, "sup:advice:ok:trace-لا-يوجد"));
    expect(response.status).toBe(200);
    expect((await outcomes()).length).toBe(0);
  });

  // ════════════════════════════════════════════════════════════════════════
  // ٢ — الاستنتاج الآلي
  // ════════════════════════════════════════════════════════════════════════

  it("تفعيل الاشتراك بعد اقتراح «مشكلة اشتراك» يُستنتج accepted", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId } = await openAdvisedTicket();

    await post(groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));

    const rows = await outcomes();
    expect(rows.length).toBe(1);
    expect(rows[0]?.verdict).toBe("accepted");
    expect(rows[0]?.source).toBe("inferred");
    expect(rows[0]?.human_action).toBe("activate");
  });

  it("رفض التذكرة بعد الاقتراح نفسه يُستنتج rejected — الاستنتاج ليس مجاملة", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId } = await openAdvisedTicket();

    await post(groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:reject:${ticketId}`));

    const rows = await outcomes();
    expect(rows[0]?.verdict).toBe("rejected");
    expect(rows[0]?.source).toBe("inferred");
  });

  // ════════════════════════════════════════════════════════════════════════
  // ٣ — الأسبقية: النقرة تغلب الاستنتاج مهما تأخّرت أو تقدّمت
  // ════════════════════════════════════════════════════════════════════════

  it("⚠️ استنتاجٌ بعد نقرةٍ لا يطمسها: الحكم النافذ يبقى للإنسان", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId, traceId } = await openAdvisedTicket();

    // الموظّف قال «غير مفيد» صراحةً، ثم فعّل الاشتراك لسببٍ عنده.
    await post(groupCallback(SUPPORT_CHAT, `sup:advice:no:${traceId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));

    // التاريخ محفوظ كاملاً — لا يُحذف حكمٌ مضى.
    const rows = await outcomes();
    expect(rows.length).toBe(2);

    // لكن الحكم **النافذ** في التقرير هو نقرة الإنسان لا استنتاج الآلة.
    const view = await sql<{ verdict: string; verdict_source: string }[]>`
      select verdict, verdict_source from agent_effectiveness where trace_id = ${traceId}
    `;
    expect(view[0]?.verdict_source).toBe("button");
    expect(view[0]?.verdict).toBe("rejected");
  });

  it("نقرةٌ بعد استنتاج تَجُبّه: الأسبقية بالمصدر لا بالترتيب الزمني", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId, traceId } = await openAdvisedTicket();

    await post(groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:advice:no:${traceId}`));

    const view = await sql<{ verdict: string; verdict_source: string }[]>`
      select verdict, verdict_source from agent_effectiveness where trace_id = ${traceId}
    `;
    expect(view[0]?.verdict_source).toBe("button");
    expect(view[0]?.verdict).toBe("rejected");
  });

  // ════════════════════════════════════════════════════════════════════════
  // ٤ — التوسيم اليدوي والتقرير
  // ════════════════════════════════════════════════════════════════════════

  it("التوسيم اليدوي يَغلب الاستنتاج ويَخضع للنقرة", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId, traceId } = await openAdvisedTicket();
    await post(groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));

    // توسيمٌ يدوي مخالف للاستنتاج: المراجع رأى ما لم تره القاعدة.
    await sql`select record_agent_outcome(${traceId}, 'rejected', 'manual', 'مراجعة دورية', null)`;
    let view = await sql<{ verdict: string; verdict_source: string }[]>`
      select verdict, verdict_source from agent_effectiveness where trace_id = ${traceId}
    `;
    expect(view[0]?.verdict_source).toBe("manual");
    expect(view[0]?.verdict).toBe("rejected");

    // ثم تصل نقرة موظّف: تعلو على التوسيم لأنها من صاحب الواقعة لا مراجعها.
    await post(groupCallback(SUPPORT_CHAT, `sup:advice:ok:${traceId}`));
    view = await sql<{ verdict: string; verdict_source: string }[]>`
      select verdict, verdict_source from agent_effectiveness where trace_id = ${traceId}
    `;
    expect(view[0]?.verdict_source).toBe("button");
    expect(view[0]?.verdict).toBe("accepted");
  });

  it("⚠️ التقرير يرى كل قرار مرّة واحدة — لا تضخيم بتكرار الأحكام", async () => {
    await registerDriver(DRIVER_CHAT);
    await registerSupportAgent(SUPPORT_CHAT);
    const { ticketId, traceId } = await openAdvisedTicket();

    await post(groupCallback(SUPPORT_CHAT, `sup:advice:ok:${traceId}`));
    await sql`select record_agent_outcome(${traceId}, 'rejected', 'manual', 'مراجعة', null)`;
    await post(groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post(groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));

    // ثلاثة أحكام في التاريخ، وصفٌّ واحد في التقرير: لو ضربها التقرير ثلاثاً
    // لصار قرارٌ واحد يبدو ثلاثة، ولانتفخت الحصيلة بلا تذاكر جديدة.
    expect((await outcomes()).length).toBe(3);
    const view = await sql<{ trace_id: string }[]>`select trace_id from agent_effectiveness`;
    expect(view.length).toBe(1);
  });

  it("قرارٌ بلا أيّ حكم يظهر في التقرير معلَّقاً لا محسوباً", async () => {
    await registerDriver(DRIVER_CHAT);
    const { traceId } = await openAdvisedTicket();

    const view = await sql<{ verdict: string | null; verdict_source: string | null }[]>`
      select verdict, verdict_source from agent_effectiveness where trace_id = ${traceId}
    `;
    expect(view.length).toBe(1);
    // ⚠️ `null` لا `ignored`: «لم يُحكَم عليه بعد» غير «حُكم عليه بالتجاهل».
    // خلطهما كان سيجعل كل اقتراح جديد يُحسب فشلاً في اللحظة التي يُنشر فيها.
    expect(view[0]?.verdict).toBeNull();
    expect(view[0]?.verdict_source).toBeNull();
  });
});
