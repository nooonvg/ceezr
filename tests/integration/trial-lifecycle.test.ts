/**
 * الغرض: دورةُ حياةِ الشهر المجاني للسائق من طرفٍ إلى طرف على قاعدةٍ حقيقية —
 *   تسجيلٌ يبدأ التجربةَ بمدّةِ الإعدادات، وسائقٌ في تجربته يستقبل الطلبات فعلاً،
 *   ثمّ انتهاءُ المدّة يُخرجه من الإسناد ويُشعِره مرّةً واحدةً برابطِ قروب غير
 *   المشتركين، ثمّ الدفعُ يُعيده إلى الخدمة ويُشعِره بالتفعيل.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيُّ تعديل على `start_trial` أو
 *   `expire_due_subscriptions` أو شرطِ الأهليّة `NO_LIVE_SUBSCRIPTION`.
 * ملاحظات مستقبلية: متى صار للاشتراك تذكيرٌ قبل الانتهاء (لا بعده) يُضاف هنا
 *   بنفس الطريقة: تقديمُ الساعة في القاعدة لا انتظارُ ثلاثين يوماً.
 *
 * لماذا اختبارٌ جديد ولا يكفي ما في `full-ride`؟ لأنّ ذاك يُثبت بدايةَ التجربة
 * وحدَها. والسؤالُ التجاريُّ هو ما بعدها: هل يتوقّف العملُ فعلاً حين تنتهي؟
 * سائقٌ منتهيةٌ تجربتُه يظلّ يستقبل الطلبات يعني أنّه لا سببَ للاشتراك أصلاً.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { deliverSubscriptionNotices } from "../../packages/application/subscription/deliver-notices.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createOperationalMetrics,
  type OperationalMetrics,
} from "../../packages/infrastructure/observability/index.ts";
import { createSubscriptionNoticeDeliveryPort } from "../../packages/infrastructure/subscription/notice-adapters.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "trial-secret";
const DRIVER_CHAT = 100_777;
const RIDER_CHAT = 200_777;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };
const GROUP_LINK = "https://t.me/+waslah_unsubscribed";

const config: AppConfig = testConfig({
  port: 3997,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let metrics: OperationalMetrics;
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

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

describeIf("دورةُ الشهر المجاني للسائق على قاعدة حقيقية", () => {
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
    await sql`truncate table subscription_notices, notification_outbox, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, order_offers, orders, subscriptions,
                             driver_capabilities, driver_availability, drivers, riders, users
                       restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table subscription_notices, notification_outbox, agent_outcomes, agent_decisions, audit_log,
                             attendance_log, order_offers, orders, subscriptions,
                             driver_capabilities, driver_availability, drivers, riders, users
                       restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    /*
     * بعد D-01، يمرّ مسارُ البوتِ لإنشاءِ الطلبِ عبر `request_ride()` التي تتحقَّقُ من
     * قدرةِ المدينةِ. اختبارُ «بعد انتهاءِ التجربة» يُنهي اشتراكَ السائقِ المسجَّلِ
     * فيُصبحُ غيرَ قادرٍ، فلا يُنشأُ الطلبُ. نُبذر سائقاً قادراً غير متاحٍ لتلبيةِ
     * شرطِ القدرةِ دونَ التدخُّلِ في إسنادِ الطلبِ للسائقِ المُختبَرِ.
     */
    await seedCapableDriver({
      sql,
      cityId,
      service: "transport",
      telegramId: 200_099,
    });
    // الرابطُ إعدادٌ لكلّ مدينة: معرّفُ القروب لا يُفتَح من جهاز السائق
    await sql`
      update platform_settings
         set value = ${sql.json(GROUP_LINK)}
       where city_id = ${cityId} and key = 'unsubscribed_drivers_group_link'
    `;
    driverSent = [];
    riderSent = [];
    metrics = createOperationalMetrics();
    container = buildContainer(config, {
      driverSender: capturing(driverSent),
      riderSender: capturing(riderSent),
      metrics,
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  async function registerDriver(): Promise<string> {
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "أحمد العمري"));
    await post("driver", contact(DRIVER_CHAT, "0501234567"));
    await post("driver", callback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", callback(DRIVER_CHAT, "service:transport"));
    await post("driver", callback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", text(DRIVER_CHAT, "1000001007"));
    await post("driver", photo(DRIVER_CHAT, "vphoto_1000001007"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d
        join users u on u.id = d.user_id
       where u.telegram_id = ${DRIVER_CHAT}::bigint
       limit 1
    `;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُسجَّل السائق");
    return id;
  }

  async function readyDriver(): Promise<string> {
    const driverId = await registerDriver();
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    await post("driver", text(DRIVER_CHAT, "/available"));
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
    return driverId;
  }

  async function registerRider(): Promise<void> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
  }

  async function requestRide(): Promise<void> {
    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));
  }

  /** تقديمُ الساعة في القاعدة: لا اختبارَ ينتظر ثلاثين يوماً. */
  async function endTrialNow(driverId: string): Promise<void> {
    await sql`
      update subscriptions
         set trial_ends_at = now() - interval '1 minute',
             current_period_end = now() - interval '1 minute'
       where driver_id = ${driverId}
    `;
  }

  async function noticeRows(): Promise<{ kind: string; status: string; payload: unknown }[]> {
    return sql<{ kind: string; status: string; payload: unknown }[]>`
      select payload->>'notice_kind' as kind, status, payload
      from notification_outbox
      where kind = 'subscription_notice'
      order by created_at
    `;
  }

  it("التسجيلُ لا يبدأُ تجربةً قبلَ التوثيقِ، وبعدَ التوثيقِ تبدأُ بمدّةِ الإعداداتِ ولا تُمنَح ثانيةً", async () => {
    const driverId = await registerDriver();

    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    const noTrial = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select start_trial(${driverId}::uuid, 'transport') as result
    `;
    expect(noTrial[0]?.result.ok).toBe(false);
    expect(noTrial[0]?.result.error).toBe("DRIVER_NOT_VERIFIED");

    // بعدَ التوثيقِ تبدأُ التجربةُ
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;

    const rows = await sql<{ status: string; trial_ends_at: Date | null; plan: string }[]>`
      select status, trial_ends_at, plan from subscriptions where driver_id = ${driverId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("trialing");
    expect(rows[0]?.plan).toBe("transport");

    const days = await sql<{ v: string }[]>`
      select get_setting_number(${cityId}::uuid, 'trial_days')::text as v
    `;
    const endsAt = rows[0]?.trial_ends_at as Date;
    const actualDays = Math.round((endsAt.getTime() - Date.now()) / 86_400_000);
    expect(actualDays).toBe(Number(days[0]?.v));
    // الشهرُ الذي وعد به المالك: ما في الإعدادات هو ثلاثون يوماً فعلاً
    expect(Number(days[0]?.v)).toBe(30);

    // ولا تجربةَ ثانيةً لنفس السائق حتى لو نُودي بالدالّة مباشرةً
    const again = await sql<{ result: { ok: boolean; error?: string } }[]>`
      select start_trial(${driverId}::uuid, 'transport') as result
    `;
    expect(again[0]?.result.ok).toBe(false);
    expect(again[0]?.result.error).toBe("TRIAL_ALREADY_USED");
    const count = await sql<{ n: string }[]>`
      select count(*)::text as n from subscriptions where driver_id = ${driverId}
    `;
    expect(count[0]?.n).toBe("1");
  });

  it("السائقُ في تجربته يستقبل الطلبَ فعلاً — التجربةُ اشتراكٌ سارٍ لا وعدٌ", async () => {
    const driverId = await readyDriver();
    await registerRider();
    driverSent.length = 0;

    await requestRide();

    // منذ BUG-004 يُكتَبُ صفُّ إشعارِ العرضِ في معاملةِ open_offer_round ويُسلَّمُ من عاملٍ،
    // فنُفرّغُهُ هنا كما يفعلُ العاملُ قبل التحقّقِ من وصولِهِ.
    await drainNotificationOutbox(sql, capturing(driverSent));

    const offers = await sql<{ driver_id: string; status: string }[]>`
      select driver_id, status from order_offers
    `;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_id).toBe(driverId);
    // `ADR 0286` — بطاقةُ العرضِ إشعارٌ لا زرَّ عملٍ: لا يُنفَّذُ قرارٌ تجاريٌّ
    // من المحادثةِ. وفي وضعِ `legacy` الاختباريِّ بلا `miniAppUrl` لا زرَّ أصلًا —
    // فالمقصودُ: البطاقةُ وصلت، وبلا زرِّ `offer:` يعودُ إليها.
    const offerMessage = driverSent.find((m) => (m.text ?? "").includes("الخدمة:"));
    expect(offerMessage).toBeDefined();
    expect(JSON.stringify(offerMessage?.markup ?? {})).not.toContain("offer:");
  });

  it("انتهاءُ التجربة: صفٌّ منتهٍ، وإشعارٌ واحدٌ لا أكثر، ولو دار العاملُ مرّتين", async () => {
    const driverId = await readyDriver();
    await endTrialNow(driverId);

    const first = await sql<{ result: { expired_subscriptions: number } }[]>`
      select expire_due_subscriptions() as result
    `;
    expect(first[0]?.result.expired_subscriptions).toBe(1);

    const status = await sql<{ status: string }[]>`
      select status from subscriptions where driver_id = ${driverId}
    `;
    expect(status[0]?.status).toBe("expired");

    const notices = await noticeRows();
    expect(notices).toHaveLength(1);
    // انتهاءُ تجربةٍ لا انتهاءُ اشتراكٍ مدفوع: النصّان مختلفان لأنّ الموقفَ مختلف
    expect(notices[0]?.kind).toBe("trial_expired");

    // دورةٌ ثانيةٌ للعامل لا تُنتج إشعاراً ثانياً ولا تُعيد الحساب
    const second = await sql<{ result: { expired_subscriptions: number } }[]>`
      select expire_due_subscriptions() as result
    `;
    expect(second[0]?.result.expired_subscriptions).toBe(0);
    expect(await noticeRows()).toHaveLength(1);
  });

  it("بعد انتهاءِ التجربة لا يُسنَد إليه طلبٌ، والعميلُ لا يُوعَد بسائقٍ لا يوجد", async () => {
    const driverId = await readyDriver();
    await registerRider();
    await endTrialNow(driverId);
    await sql`select expire_due_subscriptions()`;
    driverSent.length = 0;
    riderSent.length = 0;

    await requestRide();

    // الطلبُ مكتوبٌ ويبحث — لكن لا عرضَ لمن لا اشتراكَ له
    const orders = await sql<{ status: string }[]>`select status from orders`;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("searching");
    expect(await sql`select 1 from order_offers`).toHaveLength(0);
    expect(
      driverSent.filter((m) => JSON.stringify(m.markup ?? {}).includes("offer:accept:")),
    ).toHaveLength(0);
    // والعميلُ لا يُوعَد بمن أُخطِر: سطرُ البحث وحدَه، ولا رسالةَ «أُخطِر ن سائقاً»
    expect(riderSent.some((m) => m.text.includes(ar("rider.drivers_notified", { count: 1 })))).toBe(
      false,
    );
    expect(riderSent.at(-1)?.text).not.toContain(ar("rider.drivers_notified", { count: 0 }));
  });

  it("إشعارُ انتهاءِ التجربة يصل بالرابط الفعليّ لقروب غير المشتركين", async () => {
    const driverId = await readyDriver();
    await endTrialNow(driverId);
    await sql`select expire_due_subscriptions()`;

    const sent: { chatId: string; text: string }[] = [];
    const port = createSubscriptionNoticeDeliveryPort(sql);
    const result = await deliverSubscriptionNotices(cityId, {
      notices: port,
      publisher: {
        publish: async (target) => {
          sent.push({ chatId: target.chatId, text: target.text });
          // معرّفُ رسالة تلغرام bigint في القاعدة: نصٌّ غيرُ رقميّ يُخفق في finish
          return ok({ messageId: "918273" });
        },
      },
    });
    if (!result.ok) throw new Error(`تعذّر تسليم الإشعار: ${JSON.stringify(result.error)}`);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(String(DRIVER_CHAT));
    // الرابطُ نفسُه لا معرّفٌ رقميٌّ لا يُفتَح من جهاز السائق
    expect(sent[0]?.text).toContain(GROUP_LINK);
    expect(sent[0]?.text).not.toContain("-1003");

    const notices = await noticeRows();
    expect(notices[0]?.status).toBe("delivered");
    void driverId;
  });

  it("الدفعُ بعد انتهاءِ التجربة يُعيده إلى الإسناد ويُشعِره بالتفعيل لا بالانتهاء", async () => {
    const driverId = await readyDriver();
    await registerRider();
    await endTrialNow(driverId);
    await sql`select expire_due_subscriptions()`;

    await sql`select activate_subscription(${driverId}::uuid, 'transport', 30)`;

    const rows = await sql<{ status: string }[]>`
      select status from subscriptions where driver_id = ${driverId} and status = 'active'
    `;
    expect(rows).toHaveLength(1);

    const kinds = (await noticeRows()).map((row) => row.kind);
    expect(kinds).toContain("trial_expired");
    expect(kinds).toContain("activated");
    // ولا إشعارَ انتهاءٍ كاذبٍ من إغلاقِ الصفوف داخل التفعيل نفسه
    expect(kinds).not.toContain("expired");

    driverSent.length = 0;
    await requestRide();
    const offers = await sql<{ driver_id: string }[]>`select driver_id from order_offers`;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_id).toBe(driverId);
  });
  /**
   * البطاقةُ كانت تقول لصاحب التجربة «اشتراكك سارٍ»، فيقرأ أنّه دافعٌ مشترك ثمّ
   * يُفاجأ بانقطاع الطلبات. وهذا يحرس أنّ النصَّ يُسمّي الشهرَ المجانيَّ باسمه
   * ويعدُّ أيّامَه ويشرح الطريقين.
   */
  it("بطاقةُ /subscription في التجربة تُسمّي الشهرَ المجانيَّ وتعدُّ أيّامَه", async () => {
    const driverId = await readyDriver();
    driverSent.length = 0;

    await post("driver", text(DRIVER_CHAT, "/subscription"));

    const card = driverSent.map((message) => message.text).join("\n");
    expect(card).toContain("شهرك المجاني");
    expect(card).toContain("30 يوماً");
    expect(card).toContain("غير المشتركين");
    // ولا يُقال له إنّه مشترك، ولا يُعرض عليه إلغاءُ ما لم يشترِ
    expect(card).not.toContain("اشتراكك (transport) سارٍ");
    const markup = JSON.stringify(driverSent.map((message) => message.markup ?? {}));
    expect(markup).not.toContain("sub:cancel");
    void driverId;
  });
  /**
   * بعد انتهاء الشهر المجاني كانت البطاقة تقول «لا يوجد اشتراك سارٍ» والسعر، ثمّ
   * تسكت — فالسائق يقرأ أنّه خرج من المنصّة، ولا يعرف أنّ له طريقاً ثانياً ولا
   * أين بابه. والرابطُ يُلحَق من إعدادات المدينة متى كان مضبوطاً.
   */
  it("بطاقةُ ما بعد الانتهاء تشرح الطريقين وتُرفق رابطَ قروب غير المشتركين", async () => {
    const driverId = await readyDriver();
    await endTrialNow(driverId);
    await sql`select expire_due_subscriptions()`;
    driverSent.length = 0;

    await post("driver", text(DRIVER_CHAT, "/subscription"));

    const card = driverSent.map((message) => message.text).join("\n");
    expect(card).toContain("لا يوجد اشتراك سارٍ");
    expect(card).toContain("بالتنافس");
    expect(card).toContain(GROUP_LINK);
  });
});
