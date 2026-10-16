/**
 * الغرض: مسار الدعم الكامل على قاعدة PostgreSQL فعلية عبر الـ webhook الحقيقي:
 *   سائق يرسل /support ← يختار نوع المشكلة ← يرسل صورة إيصال ← تُخزَّن التذكرة ويُعاد
 *   إرسال الصورة إلى قروب الدعم ببطاقة تحمل هويته واشتراكه الحيّ ← موظّف دعم يستلم
 *   ويضغط «تفعيل» ← يتغيّر subscriptions.status فعلاً ويصل التأكيد للسائق.
 *   ويُثبَت أيضاً: حدّ التكرار، ومنع غير المخوَّل، ومنع الحسم المزدوج، وترقية المسؤول الأول.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على القسم 2.4
 * ملاحظات مستقبلية: عند بناء لوحة الإدارة يجب أن تمرّ بنفس حالات الاستخدام لا باستعلام موازٍ.
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
import {
  disputeResolutionHandler,
  drainNotificationOutbox,
} from "../support/drain-notification-outbox.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const SUPPORT_GROUP = "-1001";
const DRIVER_CHAT = 340_001;
const OTHER_DRIVER_CHAT = 340_002;
const SUPPORT_CHAT = 340_101;
const RIDER_CHAT = 340_201;
const BOOTSTRAP_ADMIN_CHAT = 340_301;
/** معرّف صورة صوري بشكل معرّفات تلغرام — لا نُنزّل صورة ولا نرفع ملفاً. */
const RECEIPT_FILE_ID = "AgACAgQAAxkBAAIB_receipt_0001";
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3996,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: String(BOOTSTRAP_ADMIN_CHAT),
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
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
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
/**
 * صورة كما يرسلها تلغرام: عدّة مقاسات مرتّبة تصاعدياً. نتعمّد وضع أكثر من مقاس
 * لنُثبت أن المحوّل يختار الأكبر — الإيصال المصغّر غير مقروء.
 */
const photo = (chatId: number, fileId: string, caption?: string) =>
  message(chatId, {
    photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }],
    ...(caption === undefined ? {} : { caption }),
  });
const privateCallback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});
/** ضغطة زرّ داخل قروب الدعم: chatId هو القروب لا المستخدم. */
const groupCallback = (userId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: userId }, message: { chat: { id: SUPPORT_GROUP } } },
});

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("مسار الدعم والاشتراك على قاعدة حقيقية", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, support_tickets, unsubscribed_claims,
                             unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, support_tickets, unsubscribed_claims,
                             unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: SUPPORT_GROUP, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    // platform_settings لا يُفرغ: أي اختبار يغيّر إعداداً يلوّث التشغيل التالي للملف كله
    await sql`
      update platform_settings
         set value = case key
                       when 'support_ticket_cooldown_seconds' then '300'
                       when 'support_activation_days'         then '30'
                       else value
                     end
       where city_id = ${cityId} and key like 'support_%'
    `;

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

  /** سائق مسجَّل ومتحقَّق باشتراك تجريبي — الحالة الطبيعية لمن يشتكي من اشتراكه. */
  async function registerDriver(chatId: number, name: string, phone: string): Promise<string> {
    await post("driver", text(chatId, "/start"));
    await post("driver", text(chatId, name));
    await post("driver", contact(chatId, phone));
    await post("driver", privateCallback(chatId, `city:${cityId}`));
    await post("driver", privateCallback(chatId, "service:transport"));
    await post("driver", privateCallback(chatId, "vehicle:sedan"));
    await post("driver", text(chatId, "أ ب ج 1234"));
    await post("driver", text(chatId, `1${String(chatId).slice(-9).padStart(9, "0")}`));
    await post("driver", photo(chatId, `vphoto_${chatId}`));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chatId}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error(`لم يُسجَّل السائق ${chatId}`);
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    await post("driver", text(chatId, "/available"));
    await post("driver", location(chatId, DRIVER_AT));
    return driverId;
  }

  /** موظّف دعم حقيقي في users بدور support — لا نزوّر صلاحية في طبقة التطبيق. */
  async function registerSupportAgent(chatId: number): Promise<void> {
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, ${chatId}, 'سعيد الدعم', '+966500000009', 'support')
    `;
  }

  const groupMessages = () => driverSent.filter((m) => m.chatId === SUPPORT_GROUP);
  const privateMessages = (chatId: number) => driverSent.filter((m) => m.chatId === String(chatId));

  /**
   * تسليمُ ما أودعَه القرارُ في صندوقِ الصادرِ (BUG-004): تبليغُ صاحبِ التذكرةِ
   * لم يَعُدْ أثرًا يقعُ في مسارِ الضغطةِ قبلَ الـcommit، بل صفًّا مودَعًا داخلَ
   * معاملةِ القرارِ يُسلِّمُه العاملُ بعدَه. فالاختبارُ يُشغِّلُ العاملَ نفسَه
   * ثمَّ يتحقّقُ من الرسالةِ نفسِها في المحادثةِ نفسِها — لا تخفيفَ للقاعدةِ،
   * وإنّما اتّباعٌ لموضعِ الأثرِ حيث صارَ.
   */
  const deliverQueuedNotifications = async (): Promise<void> => {
    await drainNotificationOutbox(sql, capturing(driverSent), {
      dispute_resolution: disputeResolutionHandler(capturing(driverSent), capturing(riderSent)),
    });
  };

  async function openTicketWithPhoto(chatId: number, caption: string): Promise<string> {
    await post("driver", text(chatId, "/support"));
    await post("driver", privateCallback(chatId, "sup:type:subscription"));
    await post("driver", photo(chatId, RECEIPT_FILE_ID, caption));
    const rows = await sql<{ id: string }[]>`
      select id from support_tickets order by created_at desc limit 1
    `;
    const ticketId = rows[0]?.id;
    if (ticketId === undefined) throw new Error("لم تُفتح التذكرة");
    return ticketId;
  }

  it("يخزّن التذكرة بمعرّف الصورة الأكبر ولا يخزّن الصورة نفسها", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ ولم يُفعَّل الاشتراك");

    const rows = await sql<
      {
        type: string;
        status: string;
        driver_id: string | null;
        rider_id: string | null;
        message: string;
        attachment_file_id: string | null;
        city_id: string;
      }[]
    >`select type, status, driver_id, rider_id, message, attachment_file_id, city_id
        from support_tickets where id = ${ticketId}`;
    const ticket = rows[0];
    expect(ticket).toBeDefined();
    expect(ticket?.type).toBe("subscription");
    expect(ticket?.status).toBe("open");
    expect(ticket?.driver_id).toBe(driverId);
    expect(ticket?.rider_id).toBeNull();
    expect(ticket?.city_id).toBe(cityId);
    expect(ticket?.message).toBe("حوّلت المبلغ ولم يُفعَّل الاشتراك");
    // المقاس الأكبر لا المصغَّر: الإيصال المصغّر غير مقروء
    expect(ticket?.attachment_file_id).toBe(RECEIPT_FILE_ID);
  });

  it("يعيد إرسال الصورة إلى القروب صورةً بمعرّفها، لا رابطاً نصّياً", async () => {
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ ولم يُفعَّل الاشتراك");

    const cards = groupMessages();
    expect(cards.length).toBe(1);
    expect(cards[0]?.photoFileId).toBe(RECEIPT_FILE_ID);
    // لا يظهر معرّف الملف في النصّ: هو صورة معروضة لا نصّ منسوخ
    expect(cards[0]?.text.includes(RECEIPT_FILE_ID)).toBe(false);
  });

  it("بطاقة القروب تحمل الاسم والهاتف ومعرّف تلغرام والمدينة ونصّ الشكوى كما كُتب", async () => {
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await openTicketWithPhoto(DRIVER_CHAT, "حوّلت 250 ريال ولم يُفعَّل الاشتراك");

    const card = groupMessages()[0]?.text ?? "";
    expect(card.includes("أحمد العمري")).toBe(true);
    expect(card.includes("+966501234567")).toBe(true);
    expect(card.includes(String(DRIVER_CHAT))).toBe(true);
    expect(card.includes("جدة")).toBe(true);
    expect(card.includes("حوّلت 250 ريال ولم يُفعَّل الاشتراك")).toBe(true);
  });

  it("حالة الاشتراك في البطاقة تُقرأ لحظة الإرسال لا من نسخة قديمة", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    // نُنهي اشتراكه بعد التسجيل مباشرة: البطاقة يجب أن تعكس الحقيقة الآن لا وقت التسجيل
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;

    await openTicketWithPhoto(DRIVER_CHAT, "اشتراكي منتهٍ وأريد تجديده");
    const card = groupMessages()[0]?.text ?? "";
    // `MSG-AUDIT-01`: الحالةُ تُعرَضُ مترجَمةً للفريقِ («منتهٍ») لا رمزاً خاماً («expired»).
    expect(card.includes("منتهٍ")).toBe(true);
    expect(card.includes("expired")).toBe(false);
    expect(card.includes("⚠️")).toBe(true);
  });

  it("يفعّل الدعم الاشتراك من زرّ القروب: تتغيّر القاعدة فعلاً ويصل التأكيد للسائق", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    await registerSupportAgent(SUPPORT_CHAT);
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ وأرفقت الإيصال");

    const before = driverSent.length;
    await post("driver", groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post("driver", groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));

    await deliverQueuedNotifications();

    const ticket = await sql<{ status: string; resolved_by_user_id: string | null }[]>`
      select status, resolved_by_user_id from support_tickets where id = ${ticketId}
    `;
    expect(ticket[0]?.status).toBe("resolved");
    expect(ticket[0]?.resolved_by_user_id).not.toBeNull();

    const subscription = await sql<{ status: string; current_period_end: Date | null }[]>`
      select status, current_period_end from subscriptions where driver_id = ${driverId}
         and status in ('active', 'trialing')
    `;
    expect(subscription.length).toBe(1);
    expect(subscription[0]?.status).toBe("active");
    expect(subscription[0]?.current_period_end).not.toBeNull();

    // التأكيد يصل إلى محادثة السائق الخاصة لا إلى القروب
    const confirmations = driverSent
      .slice(before)
      .filter(
        (m) => m.chatId === String(DRIVER_CHAT) && m.text === ar("support.resolved_activated"),
      );
    expect(confirmations.length).toBe(1);
  });

  it("‏/activate بالرقم يسلك المسار نفسه تماماً كزرّ القروب", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    await registerSupportAgent(SUPPORT_CHAT);
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "أرجو تفعيل اشتراكي المدفوع");

    await post("driver", text(SUPPORT_CHAT, `/activate ${ticketId}`));

    const subscription = await sql<{ status: string }[]>`
      select status from subscriptions where driver_id = ${driverId} and status = 'active'
    `;
    expect(subscription.length).toBe(1);
    const ticket = await sql<{ status: string }[]>`
      select status from support_tickets where id = ${ticketId}
    `;
    expect(ticket[0]?.status).toBe("resolved");
  });

  it("سائق غير مخوَّل لا يستطيع تفعيل اشتراك أحد ولو ضغط الزرّ", async () => {
    const victimId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await sql`update subscriptions set status = 'expired' where driver_id = ${victimId}`;
    await registerDriver(OTHER_DRIVER_CHAT, "خالد المطيري", "0507654321");
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ وأرفقت الإيصال");

    await post("driver", groupCallback(OTHER_DRIVER_CHAT, `sup:activate:${ticketId}`));

    const subscription = await sql<{ status: string }[]>`
      select status from subscriptions where driver_id = ${victimId} and status = 'active'
    `;
    expect(subscription.length).toBe(0);
    const ticket = await sql<{ status: string }[]>`
      select status from support_tickets where id = ${ticketId}
    `;
    expect(ticket[0]?.status).toBe("open");
    // الرفض يصل للضاغط في محادثته الخاصة لا في القروب أمام الجميع
    const refusals = privateMessages(OTHER_DRIVER_CHAT).filter(
      (m) => m.text === ar("support.not_authorized"),
    );
    expect(refusals.length).toBe(1);
  });

  it("لا يُحسم القرار مرتين: الضغطة الثانية تُرفض ولا تمدّد الاشتراك", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    await registerSupportAgent(SUPPORT_CHAT);
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ وأرفقت الإيصال");

    await post("driver", groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));
    const first = await sql<{ current_period_end: Date }[]>`
      select current_period_end from subscriptions where driver_id = ${driverId} and status = 'active'
    `;
    await post("driver", groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));
    const second = await sql<{ current_period_end: Date }[]>`
      select current_period_end from subscriptions where driver_id = ${driverId} and status = 'active'
    `;

    expect(second[0]?.current_period_end?.toISOString()).toBe(
      first[0]?.current_period_end?.toISOString(),
    );
    const settled = privateMessages(SUPPORT_CHAT).filter(
      (m) => m.text === ar("support.already_settled"),
    );
    expect(settled.length).toBe(1);
  });

  it("الاستلام لأوّل ضاغط فقط، والثاني يُخبَر بمن سبقه", async () => {
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await registerSupportAgent(SUPPORT_CHAT);
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, role)
      values (${cityId}, ${SUPPORT_CHAT + 1}, 'نورة الدعم', '+966500000008', 'support')
    `;
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "لدي مشكلة في تفعيل الاشتراك");

    await post("driver", groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post("driver", groupCallback(SUPPORT_CHAT + 1, `sup:claim:${ticketId}`));

    // الاستعلام واحد بربط مقصود: من استلم فعلاً يُقرأ بمعرّف تلغرامه لا بمعرّف داخلي
    const rows = await sql<{ status: string; telegram_id: string | null }[]>`
      select st.status, u.telegram_id
        from support_tickets st
        left join users u on u.id = st.claimed_by_user_id
       where st.id = ${ticketId}
    `;
    expect(rows[0]?.status).toBe("claimed");
    expect(String(rows[0]?.telegram_id)).toBe(String(SUPPORT_CHAT));
    const rejected = privateMessages(SUPPORT_CHAT + 1).filter((m) =>
      m.text.startsWith(ar("support.already_claimed", { actor: "" }).slice(0, 12)),
    );
    expect(rejected.length).toBe(1);
  });

  it("حدّ التكرار يمنع تذكرة ثانية فوراً ويخبر السائق بالمدّة", async () => {
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await openTicketWithPhoto(DRIVER_CHAT, "المشكلة الأولى في الاشتراك");

    await post("driver", text(DRIVER_CHAT, "/support"));
    await post("driver", privateCallback(DRIVER_CHAT, "sup:type:subscription"));
    await post("driver", text(DRIVER_CHAT, "المشكلة الثانية في الاشتراك"));

    const count = await sql<{ count: string }[]>`select count(*)::text from support_tickets`;
    expect(count[0]?.count).toBe("1");
    const cooldowns = privateMessages(DRIVER_CHAT).filter((m) =>
      m.text.startsWith(ar("support.cooldown_active", { minutes: 5 }).slice(0, 20)),
    );
    expect(cooldowns.length).toBe(1);
  });

  it("رسالة قصيرة تُرفض بلا فتح تذكرة، والخطوة تبقى ليعيد الكتابة", async () => {
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await post("driver", text(DRIVER_CHAT, "/support"));
    await post("driver", privateCallback(DRIVER_CHAT, "sup:type:subscription"));
    await post("driver", text(DRIVER_CHAT, "مشكلة"));

    const empty = await sql<{ count: string }[]>`select count(*)::text from support_tickets`;
    expect(empty[0]?.count).toBe("0");
    expect(
      privateMessages(DRIVER_CHAT).some((m) => m.text === ar("support.message_too_short")),
    ).toBe(true);

    // الخطوة لم تُلغَ: الرسالة التالية تُقبل بلا إعادة /support
    await post("driver", text(DRIVER_CHAT, "حوّلت المبلغ ولم يُفعَّل الاشتراك بعد يومين"));
    const opened = await sql<{ count: string }[]>`select count(*)::text from support_tickets`;
    expect(opened[0]?.count).toBe("1");
  });

  it("العميل يفتح نزاع رحلة بلا سؤاله عن اشتراك لا يملكه", async () => {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
    await post("rider", text(RIDER_CHAT, "/support"));
    await post("rider", text(RIDER_CHAT, "السائق طلب مبلغاً أعلى من المتفق عليه"));

    const rows = await sql<{ type: string; rider_id: string | null; driver_id: string | null }[]>`
      select type, rider_id, driver_id from support_tickets
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]?.type).toBe("ride_dispute");
    expect(rows[0]?.rider_id).not.toBeNull();
    expect(rows[0]?.driver_id).toBeNull();
    // لم يُعرض عليه خيار «مشكلة اشتراك» إطلاقاً
    expect(riderSent.some((m) => m.text === ar("support.choose_type"))).toBe(false);
  });

  it("تذكرة نزاع بلا اشتراك لا تعرض زرّ التفعيل على الفريق", async () => {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
    await post("rider", text(RIDER_CHAT, "/support"));
    await post("rider", text(RIDER_CHAT, "السائق لم يصل إلى نقطة الانطلاق إطلاقاً"));

    // البطاقة تُنشر بمُرسِل بوت السائق حتى لو كان صاحبها عميلاً: القروب مرتبط بذلك البوت
    // وردّ الضغطة يجب أن يعود إلى البوت الذي نشر الأزرار، لا إلى بوت آخر لا يراها.
    expect(riderSent.some((m) => m.chatId === SUPPORT_GROUP)).toBe(false);
    const card = driverSent.find((m) => m.chatId === SUPPORT_GROUP);
    expect(card).toBeDefined();
    const markup = card?.markup as { inline_keyboard: { text: string }[][] };
    const labels = markup.inline_keyboard.flat().map((button) => button.text);
    expect(labels).toEqual([ar("support.claim_button"), ar("support.reject_button")]);
  });

  it("الرفض يُغلق التذكرة بلا لمس الاشتراك ويبلّغ صاحبها", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await registerSupportAgent(SUPPORT_CHAT);
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "أريد تفعيلاً بلا تحويل مبلغ");

    const before = await sql<{ status: string }[]>`
      select status from subscriptions where driver_id = ${driverId}
    `;
    await post("driver", groupCallback(SUPPORT_CHAT, `sup:reject:${ticketId}`));
    await deliverQueuedNotifications();
    const after = await sql<{ status: string }[]>`
      select status from subscriptions where driver_id = ${driverId}
    `;

    expect(after.map((row) => row.status)).toEqual(before.map((row) => row.status));
    const ticket = await sql<{ status: string }[]>`
      select status from support_tickets where id = ${ticketId}
    `;
    expect(ticket[0]?.status).toBe("rejected");
    expect(
      privateMessages(DRIVER_CHAT).some((m) => m.text === ar("support.resolved_rejected")),
    ).toBe(true);
  });

  it("الإنهاء اليدوي يوقف الاشتراك السارِي فعلاً", async () => {
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await registerSupportAgent(SUPPORT_CHAT);
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "أرجو إيقاف اشتراكي نهائياً");

    await post("driver", groupCallback(SUPPORT_CHAT, `sup:terminate:${ticketId}`));
    await deliverQueuedNotifications();

    const live = await sql<{ count: string }[]>`
      select count(*)::text from subscriptions
       where driver_id = ${driverId} and status in ('active', 'trialing')
    `;
    expect(live[0]?.count).toBe("0");
    expect(
      privateMessages(DRIVER_CHAT).some((m) => m.text === ar("support.resolved_terminated")),
    ).toBe(true);
  });

  it("كل خطوة تُكتب في سجلّ التدقيق بمدينتها وفاعلها", async () => {
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await registerSupportAgent(SUPPORT_CHAT);
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ وأرفقت الإيصال");
    await post("driver", groupCallback(SUPPORT_CHAT, `sup:claim:${ticketId}`));
    await post("driver", groupCallback(SUPPORT_CHAT, `sup:activate:${ticketId}`));

    const rows = await sql<{ action: string; city_id: string; actor_user_id: string | null }[]>`
      select action, city_id, actor_user_id from audit_log
       where action like 'support.%' order by created_at
    `;
    expect(rows.map((row) => row.action)).toEqual([
      "support.ticket_opened",
      "support.ticket_claimed",
      "support.ticket_activate",
    ]);
    expect(rows.every((row) => row.city_id === cityId)).toBe(true);
    expect(rows.every((row) => row.actor_user_id !== null)).toBe(true);
  });

  it("يرقّي أوّل مسؤول من متغيّر البيئة عند التسجيل، ولا يمنح الصفة لغيره", async () => {
    await registerDriver(BOOTSTRAP_ADMIN_CHAT, "مالك المنصة", "0500000001");
    await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");

    const roles = await sql<{ telegram_id: string; role: string }[]>`
      select telegram_id, role from users where telegram_id in
        (${BOOTSTRAP_ADMIN_CHAT}, ${DRIVER_CHAT})
    `;
    const byId = new Map(roles.map((row) => [String(row.telegram_id), row.role]));
    expect(byId.get(String(BOOTSTRAP_ADMIN_CHAT))).toBe("admin");
    expect(byId.get(String(DRIVER_CHAT))).toBe("driver");

    const audits = await sql<{ count: string }[]>`
      select count(*)::text from audit_log where action = 'identity.bootstrap_admin_granted'
    `;
    // مرّة واحدة رغم تكرار /start أثناء التسجيل: الترقية idempotent
    expect(audits[0]?.count).toBe("1");
  });

  it("المسؤول المرقَّى يقدر فعلاً على حسم التذاكر", async () => {
    await registerDriver(BOOTSTRAP_ADMIN_CHAT, "مالك المنصة", "0500000001");
    const driverId = await registerDriver(DRIVER_CHAT, "أحمد العمري", "0501234567");
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    const ticketId = await openTicketWithPhoto(DRIVER_CHAT, "حوّلت المبلغ وأرفقت الإيصال");

    await post("driver", groupCallback(BOOTSTRAP_ADMIN_CHAT, `sup:activate:${ticketId}`));

    const active = await sql<{ count: string }[]>`
      select count(*)::text from subscriptions where driver_id = ${driverId} and status = 'active'
    `;
    expect(active[0]?.count).toBe("1");
  });
});
