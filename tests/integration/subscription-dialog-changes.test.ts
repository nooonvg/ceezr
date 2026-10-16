/**
 * الغرض: إثبات أنّ أزرار «إلغاء الاشتراك» و«التراجع» و«الترقية» في بوت السائق
 *   تصل إلى القاعدة فعلاً عبر الويبهوك والحاوية الحقيقية — لا عبر مزدوجات.
 *
 *   واختبارات الوحدة لا تكفي هنا: هي تُثبت أنّ الحوار ينادي المنفذ المُلقَّن،
 *   وهذا يُثبت أنّ المنفذ موصولٌ في `buildContainer` أصلاً، وأنّ الصفّ في
 *   `subscriptions` تغيّر بعد الضغطة. وبين الأمرين انقطاعٌ كان يمكن أن يمرّ
 *   صامتاً: تبعيّةٌ اختياريّةٌ غيرُ موصولةٍ تجعل الزرّ لا يظهر في الإنتاج
 *   واختبارات الوحدة كلّها خضراء.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL على PostgreSQL+PostGIS.
 * ينتمي إلى: tests/integration
 * ملاحظات مستقبلية: عند اعتماد مزوّد دفع تُضاف هنا حالة الترقية المدفوعة
 *   من طرفها إلى طرفها بدل التحقّق من نصّ التحصيل اليدوي.
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
const WEBHOOK_SECRET = "sub-dialog-secret";
const DRIVER_CHAT = 264_001;

const config: AppConfig = testConfig({
  port: 3987,
  telegramWebhookSecret: WEBHOOK_SECRET,
  bootstrapAdminTelegramId: "990002",
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let driverId: string;

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

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

interface SubscriptionRow {
  readonly id: string;
  readonly plan: string;
  readonly status: string;
  readonly cancel_at_period_end: boolean;
  readonly cancellation_requested_at: Date | null;
  readonly current_period_end: Date | null;
}

async function subscriptionRow(): Promise<SubscriptionRow | undefined> {
  const rows = await sql<SubscriptionRow[]>`
    select id, plan, status, cancel_at_period_end, cancellation_requested_at, current_period_end
      from subscriptions
     where driver_id = ${driverId}
     order by created_at desc
     limit 1
  `;
  return rows[0];
}

/** آخر ما وصل السائق فعلاً — الردود تُقاس من الملتقِط لا من قيمةٍ مُعادة. */
function lastText(): string {
  return driverSent.at(-1)?.text ?? "";
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

describeIf("تغييرات الاشتراك من بوت السائق على قاعدة حقيقية", () => {
  beforeAll(async () => {
    if (DATABASE_URL === undefined) return;
    sql = createSql({ connectionString: DATABASE_URL });
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
                             order_offers, orders, payment_transactions, subscriptions,
                             driver_capabilities, driver_availability, drivers, riders, users
                             restart identity cascade`;

    if (DATABASE_URL === undefined) return;
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    if (DATABASE_URL === undefined) return;
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, payment_transactions, subscriptions,
                             driver_capabilities, driver_availability, drivers, riders, users
                             restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -2001, escalation: -2002, unsubscribed: -2003 },
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

    await post(text(DRIVER_CHAT, "/start"));
    await post(text(DRIVER_CHAT, "سعد القحطاني"));
    await post(contact(DRIVER_CHAT, "+966500000264"));
    await post(callback(DRIVER_CHAT, `city:${cityId}`));
    await post(callback(DRIVER_CHAT, "service:transport"));
    await post(callback(DRIVER_CHAT, "vehicle:sedan"));
    await post(text(DRIVER_CHAT, "أ ب ج 4264"));
    await post(text(DRIVER_CHAT, "1012345264"));
    await post(photo(DRIVER_CHAT, "photo_264"));

    const rows = await sql<{ id: string }[]>`select id from drivers limit 1`;
    const found = rows[0]?.id;
    if (found === undefined) throw new Error("لم يُنشأ السائق في التهيئة");
    driverId = found;

    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ — نُوثِّقُ السائقَ ثم نبدأُ التجربة
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
  });

  /** دورة مدفوعة حقيقية عبر الدالّة الذرّية — لا صفٌّ يُكتب يدوياً بحالةٍ مخترعة. */
  async function activatePaid(plan = "transport"): Promise<void> {
    const activated = await sql<{ result: { ok: boolean } }[]>`
      select activate_subscription(${driverId}::uuid, ${plan}::subscription_plan, 30) as result
    `;
    if (activated[0]?.result.ok !== true) throw new Error("فشل تفعيل الاشتراك في التهيئة");
  }

  it("بطاقة /subscription تعرض زرّي الترقية والإلغاء — أي أنّ المنفذ موصولٌ في الحاوية", async () => {
    await activatePaid();
    driverSent.length = 0;
    await post(text(DRIVER_CHAT, "/subscription"));

    const card = driverSent.at(-1);
    expect(card?.text).toContain("transport");
    const markup = JSON.stringify(card?.markup ?? {});
    expect(markup).toContain("sub:upgrade:both");
    expect(markup).toContain("sub:cancel");
  });

  it("الضغطة الأولى لا تُلغي شيئاً في القاعدة", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:cancel"));

    const row = await subscriptionRow();
    expect(row?.cancel_at_period_end).toBe(false);
    expect(row?.cancellation_requested_at).toBeNull();
    expect(JSON.stringify(driverSent.at(-1)?.markup ?? {})).toContain("sub:cancel:yes");
  });

  it("التأكيد يكتب طلب الإلغاء ويُبقي الخدمة سارية إلى آخر الدورة", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));

    const row = await subscriptionRow();
    expect(row?.cancel_at_period_end).toBe(true);
    expect(row?.cancellation_requested_at).not.toBeNull();
    // الجوهر التجاري: الحالة تبقى `active` — الإلغاء ليس قطعاً فوريّاً لخدمةٍ مدفوعة.
    expect(row?.status).toBe("active");
    const until = row?.current_period_end?.toISOString().slice(0, 10) ?? "";
    expect(lastText()).toBe(ar("driver.subscription_cancelled", { until }));
  });

  it("بعد الإلغاء تعرض البطاقة التراجع ولا تعرض إلغاءً ثانياً ولا ترقية", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));
    driverSent.length = 0;
    await post(text(DRIVER_CHAT, "/subscription"));

    const markup = JSON.stringify(driverSent.at(-1)?.markup ?? {});
    expect(markup).toContain("sub:resume");
    expect(markup).not.toContain("sub:cancel");
    expect(markup).not.toContain("sub:upgrade");
  });

  it("التراجع يمسح طلب الإلغاء من الصفّ نفسه", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));
    const cancelled = await subscriptionRow();
    await post(callback(DRIVER_CHAT, "sub:resume"));

    const row = await subscriptionRow();
    expect(row?.id).toBe(cancelled?.id ?? "");
    expect(row?.cancel_at_period_end).toBe(false);
    expect(row?.cancellation_requested_at).toBeNull();
    expect(lastText()).toBe(ar("driver.subscription_resumed"));
  });

  it("إلغاءٌ مكرَّر لا يُخطئ ولا يُنشئ اشتراكاً سارياً ثانياً", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));

    // صفوف التجربة المنتهية تبقى للسجلّ؛ المهمّ أن السارية واحدةٌ لا تنقسم.
    const rows = await sql<{ n: string }[]>`
      select count(*)::text as n
        from subscriptions
       where driver_id = ${driverId}
         and status in ('trialing', 'active')
    `;
    expect(rows[0]?.n).toBe("1");
    const row = await subscriptionRow();
    const until = row?.current_period_end?.toISOString().slice(0, 10) ?? "";
    expect(lastText()).toBe(ar("driver.subscription_cancel_already", { until }));
  });

  it("الترقية المدفوعة تعرض الفرق من platform_settings ولا تُغيّر الخطّة ولا تُنشئ معاملة", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:upgrade:both"));

    const row = await subscriptionRow();
    expect(row?.plan).toBe("transport");
    const payments = await sql<
      { n: string }[]
    >`select count(*)::text as n from payment_transactions`;
    expect(payments[0]?.n).toBe("0");

    const prices = await sql<{ key: string; value: number }[]>`
      select key, (value #>> '{}')::numeric as value
        from platform_settings
       where city_id = ${cityId}
         and key in ('subscription_price_transport', 'subscription_price_both')
    `;
    const priceOf = (key: string) => prices.find((p) => p.key === key)?.value ?? 0;
    const difference = priceOf("subscription_price_both") - priceOf("subscription_price_transport");
    expect(difference).toBeGreaterThan(0);
    // الرقم المعروض هو فرق الإعدادات نفسه، لا رقمٌ محسوبٌ في طبقة التطبيق.
    expect(driverSent.at(-2)?.text).toContain(String(difference));
    expect(lastText()).toContain(String(difference));
  });

  it("داخل التجربة المجانية: ترقية «both» تتطلب دفعاً — خدمة واحدة مجانية والثانية مدفوعة", async () => {
    // التسجيل نفسه يبدأ التجربة (driver-dialog.ts: startTrial بعد التوثيق)،
    // فلا نبدأ تجربةً ثانية — `subscriptions_one_live_per_driver` يرفضها بحقّ،
    // ونعمل على الصفّ الذي أنشأه المسار الحقيقي.
    const trialRow = await subscriptionRow();
    expect(trialRow?.status).toBe("trialing");

    await post(callback(DRIVER_CHAT, "sub:upgrade:both"));
    // الخطّة لا تتغيّر قبل الدفع.
    expect((await subscriptionRow())?.plan).toBe("transport");

    // عرض السعر المدفوع يُظهر الفرق من platform_settings.
    const prices = await sql<{ key: string; value: number }[]>`
      select key, (value #>> '{}')::numeric as value from platform_settings
       where city_id = ${cityId} and key in ('subscription_price_transport', 'subscription_price_both')
    `;
    const priceOf = (key: string) => prices.find((p) => p.key === key)?.value ?? 0;
    const difference = priceOf("subscription_price_both") - priceOf("subscription_price_transport");
    expect(difference).toBeGreaterThan(0);
    // الرسالة الأولى تعرض الفرق.
    expect(driverSent.at(-2)?.text).toContain(String(difference));

    // تأكيد الترقية: لا مزوّد دفع، فالرسالة يدويّة.
    await post(callback(DRIVER_CHAT, "sub:upgrade:confirm:both"));
    expect((await subscriptionRow())?.plan).toBe("transport");
    expect(lastText()).toBe(
      ar("driver.subscription_upgrade_manual_payment", { amount: difference, currency: "SAR" }),
    );
  });

  it("من انتهى اشتراكه لا يُلغي: يُقال لا اشتراك سارٍ ولا يُمسّ الصفّ المنتهي", async () => {
    // التسجيل يمنح تجربةً، فحالة «لا اشتراك سارٍ» تُصنع بانتهاء التجربة لا بغيابها.
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));

    const row = await subscriptionRow();
    expect(row?.status).toBe("expired");
    expect(row?.cancel_at_period_end).toBe(false);
    expect(lastText()).toBe(ar("driver.subscription_change_no_live"));
  });

  it("كل تغيير يُسجَّل في audit_log بمدينته — لا تغيير صامت على مال السائق", async () => {
    await activatePaid();
    await post(callback(DRIVER_CHAT, "sub:cancel:yes"));
    await post(callback(DRIVER_CHAT, "sub:resume"));

    const rows = await sql<{ action: string; city_id: string | null }[]>`
      select action, city_id from audit_log
       where action like 'subscription.%'
       order by created_at
    `;
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("subscription.cancellation_requested");
    expect(actions).toContain("subscription.cancellation_revoked");
    for (const row of rows) expect(row.city_id).toBe(cityId);
  });
});
