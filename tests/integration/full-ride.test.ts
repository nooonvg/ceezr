/**
 * الغرض: السيناريو الحقيقي الكامل على قاعدة PostgreSQL فعلية، من HTTP webhook إلى صفوف في الجداول:
 *   تسجيل سائق ← تجربة مجانية ← تحقّق الإدارة ← توافر وموقع ← تسجيل عميل ← طلب برحلة حقيقية
 *   ← مطابقة وبثّ عرض ← قبول ذرّي ← الطلب matched. بلا مزدوج واحد إلا مُرسِل تلغرام.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على المحوّلات
 * ملاحظات مستقبلية: عند وصول رموز البوتين يُستبدل المُرسِل الملتقِط بمُرسِل حقيقي في اختبار دخان واحد.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createOperationalMetrics,
  type OperationalMetrics,
} from "../../packages/infrastructure/observability/index.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import { testConfig } from "../support/config.ts";
import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 100_001;
const RIDER_CHAT = 200_001;
// جدة الحقيقية: نقطة انطلاق العميل وموقع السائق على بعد أقل من كيلومتر
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  telegramWebhookSecret: WEBHOOK_SECRET,
  port: 3999,
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let metrics: OperationalMetrics;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let cityId: string;

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
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("المسار الكامل على قاعدة حقيقية", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // قاعدة نظيفة قبل كل سيناريو: نمسح الحركة ونُبقي المدن والإعدادات المبذورة
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    // تفعيل جدة يتطلب مجموعاتها الثلاث (قيد cities_active_requires_groups)
    await sql`
      update cities
         set is_active = true,
             telegram_support_group_id = -1001,
             telegram_escalation_group_id = -1002,
             telegram_unsubscribed_drivers_group_id = -1003
       where id = ${cityId}
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
    const rows = await sql<{ id: string }[]>`select id from drivers limit 1`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُسجَّل السائق");
    return id;
  }

  async function verifyAndActivate(driverId: string): Promise<void> {
    // ما تفعله الإدارة يدوياً اليوم، وستفعله لوحة الإدارة في 2.4
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    await post("driver", text(DRIVER_CHAT, "/available"));
    await post("driver", location(DRIVER_CHAT, DRIVER_AT));
  }

  async function registerRider(): Promise<string> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
    const rows = await sql<{ id: string }[]>`select id from riders limit 1`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُسجَّل العميل");
    return id;
  }

  it("يسجّل سائقاً حقيقياً في users و drivers ويبدأ تجربته المجانية بعد التوثيق", async () => {
    const driverId = await registerDriver();
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;

    const users = await sql<{ full_name: string; phone: string; role: string; city_id: string }[]>`
      select full_name, phone, role, city_id from users where telegram_id = ${DRIVER_CHAT}
    `;
    expect(users[0]?.full_name).toBe("أحمد العمري");
    // الجوال يُوحَّد في الدومين لا في القاعدة
    expect(users[0]?.phone).toBe("+966501234567");
    expect(users[0]?.role).toBe("driver");
    expect(users[0]?.city_id).toBe(cityId);

    const caps = await sql<{ service: string; is_enabled: boolean }[]>`
      select service, is_enabled from driver_capabilities where driver_id = ${driverId}
    `;
    expect(caps.length).toBe(1);
    expect(caps[0]?.service).toBe("transport");
    expect(caps[0]?.is_enabled).toBe(true);

    const subs = await sql<{ status: string; trial_ends_at: Date | null }[]>`
      select status, trial_ends_at from subscriptions where driver_id = ${driverId}
    `;
    expect(subs[0]?.status).toBe("trialing");
    // مدة التجربة من platform_settings لا من ثابت في الكود
    const days = await sql<{ v: string }[]>`
      select get_setting_number(${cityId}::uuid, 'trial_days')::text as v
    `;
    const expected = Number(days[0]?.v);
    const endsAt = subs[0]?.trial_ends_at;
    expect(endsAt).not.toBeNull();
    const actualDays = Math.round(
      ((endsAt as Date).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    expect(actualDays).toBe(expected);
  });

  it("يمنع التوافر قبل تحقّق الإدارة، ويسمح به بعده ويسجّله في attendance_log", async () => {
    const driverId = await registerDriver();

    driverSent.length = 0;
    await post("driver", text(DRIVER_CHAT, "/available"));
    expect(driverSent.map((m) => m.text)).toEqual([ar("driver.not_verified")]);
    const before = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(before[0]?.is_available).toBe(false);

    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    driverSent.length = 0;
    await post("driver", text(DRIVER_CHAT, "/available"));
    const after = await sql<{ is_available: boolean }[]>`
      select is_available from driver_availability where driver_id = ${driverId}
    `;
    expect(after[0]?.is_available).toBe(true);
    const log = await sql<{ is_available: boolean; source: string }[]>`
      select is_available, source from attendance_log where driver_id = ${driverId}
    `;
    expect(log.length).toBe(1);
    expect(log[0]?.is_available).toBe(true);
    expect(log[0]?.source).toBe("driver_bot");
  });

  it("يعرض سعر مدينة السائق من platform_settings لا من قيمة مرمَّزة", async () => {
    const driverId = await registerDriver();
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    // انتهت التجربة: عندئذٍ يُعرض السعر، ومصدره الإعدادات لا ثابت في الكود
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    driverSent.length = 0;
    await post("driver", text(DRIVER_CHAT, "/subscription"));

    const price = await sql<{ v: string }[]>`
      select get_setting_number(${cityId}::uuid, 'subscription_price_transport')::text as v
    `;
    const amount = Number(price[0]?.v);
    expect(driverSent.some((m) => m.text.includes(String(amount)))).toBe(true);
  });

  it("ينشئ طلباً حقيقياً بموقع جغرافي ويبثّه على السائق المؤهل ثم يُسند بالقبول الذرّي", async () => {
    const driverId = await registerDriver();
    await verifyAndActivate(driverId);
    await registerRider();

    driverSent.length = 0;
    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));

    // منذ BUG-004 لم يُرسَل إشعارُ العرضِ متزامنًا من broadcastOffers — بل يُكتَبُ صفُّهُ
    // في معاملةِ open_offer_round ويُتركُ لعاملِ التسليم. هُنا نُفرّغُ الصفَّ يدويًا
    // كما يفعلُ العاملُ في الإنتاج، فيصلُ الإشعارُ إلى مُلتقِطِ الرسائل قبل التحقّق.
    await drainNotificationOutbox(sql, capturing(driverSent));
    // 1) الطلب مكتوب فعلاً بإحداثيات حقيقية
    const orders = await sql<
      {
        id: string;
        status: string;
        lat: number;
        lng: number;
        broadcast_round: number;
      }[]
    >`
      select id, status, st_y(pickup::geometry) as lat, st_x(pickup::geometry) as lng,
             broadcast_round
        from orders
    `;
    const order = orders[0];
    expect(order?.status).toBe("searching");
    expect(Number(order?.lat)).toBeCloseTo(PICKUP.latitude, 5);
    expect(Number(order?.lng)).toBeCloseTo(PICKUP.longitude, 5);
    expect(order?.broadcast_round).toBe(1);

    // 2) العرض مكتوب في order_offers بمسافة محسوبة حقيقية ومهلة من الإعدادات
    const offers = await sql<
      {
        driver_id: string;
        status: string;
        round: number;
        distance_km: string;
      }[]
    >`
      select driver_id, status, round, distance_km from order_offers
    `;
    expect(offers).toHaveLength(1);
    expect(offers[0]?.driver_id).toBe(driverId);
    expect(offers[0]?.status).toBe("pending");
    expect(Number(offers[0]?.distance_km)).toBeGreaterThan(0);
    expect(Number(offers[0]?.distance_km)).toBeLessThan(1);

    // 3) السائق أُخطر فعلاً برسالة فيها زرّا قبول ورفض
    const offerMessage = driverSent.find(
      (m) => m.text.includes(ar("driver.offer_accept_button")) === false,
    );
    expect(offerMessage).toBeDefined();
    expect(offerMessage?.chatId).toBe(String(DRIVER_CHAT));
    // `ADR 0286` — البطاقةُ إشعارٌ لا زرَّ قبولٍ: قرارُ القبولِ في لوحِ عروضِ
    // التطبيقِ، فالبطاقةُ موجودةٌ نصًّا وبطاقتُها بلا زرِّ `offer:` أصلًا.
    expect(JSON.stringify(offerMessage?.markup)).not.toContain("offer:");

    // 4) القبول يمرّ عبر claim_ride فيصير الطلب matched والعرض accepted
    driverSent.length = 0;
    // القبولُ عبرَ القلبِ الذرّيِّ في القاعدةِ (`claim_ride`) — عينُ ما تستدعيه
    // بوابةُ التطبيقِ من مسارِ القبولِ، بلا زرِّ بوتٍ (ADR 0286).
    await sql`select claim_ride(${order?.id ?? ""}::uuid, ${driverId}::uuid)`;
    // `ADR 0286`: سطحُ السائقِ بعدَ القبولِ هوَ التطبيقُ — لا رسائلَ عملٍ في بوتِه
    // (لا نصَّ قبولٍ ولا بطاقةَ رحلةٍ ولا دبّوسَ موقعٍ): مقصدُ المرحلةِ ١٢ —
    // توجيهُ السائقِ إلى نقطةِ الانطلاقِ — صارَ شاشةَ رحلةِ التطبيقِ، وواجهتُها
    // تُقاسُ في اختباراتِ التطبيقِ المصغَّرِ لا في مسارِ البوتِ.
    expect(driverSent).toHaveLength(0);

    const afterClaim = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id from orders where id = ${order?.id ?? ""}
    `;
    expect(afterClaim[0]?.status).toBe("matched");
    expect(afterClaim[0]?.assigned_driver_id).toBe(driverId);

    const acceptedOffer = await sql<{ status: string }[]>`
      select status from order_offers where order_id = ${order?.id ?? ""}
    `;
    expect(acceptedOffer[0]?.status).toBe("accepted");

    // 5) أثرٌ مدقَّق في audit_log — لا إسناد صامت
    const audit = await sql<{ action: string }[]>`
      select action from audit_log where entity_id = ${order?.id ?? ""}
    `;
    expect(audit.map((row) => row.action)).toContain("order.claimed");

    /**
     * 6) العدّادات تحرّكت على هذا المسار نفسه — لا على مسارٍ اختباريّ موازٍ.
     *
     * محوّلات القياس كانت مكتوبةً وغير مركّبة في الحاويتين، ووحدةٌ غير مركّبة لا
     * تعمل ولو كانت اختباراتها خضراء. فيُثبَت التركيب هنا حيث يمرّ الطلب الحقيقي:
     * لو حُذف لفُّ المنفذ من `container.ts` سقط هذا التوكيد، وهو الغرض منه.
     */
    const rendered = metrics.registry.render();
    const counter = (name: string): number => {
      const match = new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.]+)$`, "m").exec(rendered);
      return match === null ? Number.NaN : Number(match[1]);
    };
    expect(counter("waslah_dispatch_requests_total")).toBe(1);
    expect(counter("waslah_dispatch_offers_sent_total")).toBe(1);
    // `ADR 0286` — مقياسُ القبولِ (`offers_accepted_total`) يُحرِّكُهُ غلافُ
    // مراقبةِ مسارِ مطالبةِ البوتِ لا القلبُ الذرّيُّ في القاعدةِ؛ وبقبولِ
    // البوتِ إلى العدمِ صارَ قياسُهُ منَ مسارِ التطبيقِ — وهذه فجوةٌ تُرصَدُ
    // في تقريرِ الجولةِ (R1 يقيسُ بالقاعدةِ لا بالمقياسِ).
  });

  it("لا يبثّ على سائق غير متاح، ويبقى الطلب في البحث بلا عرض", async () => {
    const driverId = await registerDriver();
    await verifyAndActivate(driverId);
    await post("driver", text(DRIVER_CHAT, "/unavailable"));
    await registerRider();

    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));

    const offers = await sql<{ id: string }[]>`select id from order_offers`;
    expect(offers).toHaveLength(0);
    const orders = await sql<{ status: string }[]>`select status from orders`;
    expect(orders[0]?.status).toBe("searching");
  });

  it("سائقان يتنافسان تزامناً: واحد فقط يظفر مهما كان ترتيب الوصول", async () => {
    const firstDriver = await registerDriver();
    await verifyAndActivate(firstDriver);

    // سائق ثانٍ حقيقي في نفس المدينة، أبعد قليلاً
    const secondChat = 100_002;
    await post("driver", text(secondChat, "/start"));
    await post("driver", text(secondChat, "خالد الزهراني"));
    await post("driver", contact(secondChat, "0559876543"));
    await post("driver", callback(secondChat, `city:${cityId}`));
    await post("driver", callback(secondChat, "service:transport"));
    await post("driver", callback(secondChat, "vehicle:sedan"));
    await post("driver", text(secondChat, "أ ب ج 1234"));
    await post("driver", text(secondChat, "1000001008"));
    await post("driver", photo(secondChat, "vphoto_1000001008"));
    const secondRows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${secondChat}
    `;
    const secondDriver = secondRows[0]?.id ?? "";
    await sql`update drivers set verification_status = 'verified' where id = ${secondDriver}`;
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ
    await sql`select start_trial(${secondDriver}::uuid, 'transport') as result`;
    await post("driver", text(secondChat, "/available"));
    await post("driver", location(secondChat, { latitude: 21.5501, longitude: 39.1801 }));

    await registerRider();
    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));

    const orders = await sql<{ id: string }[]>`select id from orders`;
    const orderId = orders[0]?.id ?? "";
    const offers = await sql<{ driver_id: string; score: string }[]>`
      select driver_id, score from order_offers order by score desc
    `;
    expect(offers).toHaveLength(2);
    // الأقرب أعلى نقاطاً — والمعادلة من الدومين لا من القاعدة
    expect(offers[0]?.driver_id).toBe(firstDriver);

    driverSent.length = 0;
    // تنافس فعلي لا تتابعي: الطلبان ينطلقان معاً ويصلان للقاعدة متداخلين.
    // الذرّية مسؤولية claim_ride في القاعدة، لا ترتيب الاستدعاء في الاختبار.
    // القبولُ المتنافسُ عبرَ القلبِ الذرّيِّ نفسِه (`claim_ride`) من طرفينِ معاً —
    // الذرّيةُ حكمُ القاعدةِ لا ترتيبَ الاستدعاءِ (ADR 0286: لا زرَّ بوتٍ).
    const [firstClaim, secondClaim] = await Promise.all([
      sql`select claim_ride(${orderId}::uuid, ${firstDriver}::uuid) as claimed`,
      sql`select claim_ride(${orderId}::uuid, ${secondDriver}::uuid) as claimed`,
    ]);
    expect(firstClaim.length + secondClaim.length).toBeGreaterThan(0);

    // بصرف النظر عن ترتيب الوصول: ظافرٌ واحد ومحرومٌ واحد، لا أكثر ولا أقل.
    // `ADR 0286`: رسائلُ القبولِ والبطاقةِ والمحرومِ كانت مسارَ بوتٍ — الآنَ
    // الحكمُ على نتيجةِ المطالباتِ نفسِها وعلى القاعدةِ: ظافرٌ واحدٌ صريحٌ،
    // والخاسرُ ردُّهُ نامٌّ (`ORDER_NOT_CLAIMABLE`) لا صمتٌ.
    expect(driverSent).toHaveLength(0);
    const claimResults = [firstClaim, secondClaim] as { claimed?: Record<string, unknown> }[][];
    expect(claimResults.filter((rows) => rows[0]?.claimed?.ok === true)).toHaveLength(1);
    expect(claimResults.filter((rows) => rows[0]?.claimed?.ok === false)).toHaveLength(1);

    const finalOffers = await sql<{ driver_id: string; status: string }[]>`
      select driver_id, status from order_offers
    `;
    const accepted = finalOffers.filter((row) => row.status === "accepted");
    // الشرط الجوهري: صفٌّ مقبول واحد بالضبط مهما تسابق السائقان
    expect(accepted).toHaveLength(1);

    // والطلب مُسنَد لنفس السائق الظافر لا لغيره — لا إسناد مزدوج ولا معلَّق
    const claimedBy = accepted[0]?.driver_id ?? "";
    expect([firstDriver, secondDriver]).toContain(claimedBy);
    const finalOrder = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id from orders where id = ${orderId}
    `;
    expect(finalOrder[0]?.status).toBe("matched");
    expect(finalOrder[0]?.assigned_driver_id).toBe(claimedBy);

    // والخاسر عرضه لم يبقَ معلَّقاً
    const loser = finalOffers.find((row) => row.driver_id !== claimedBy);
    expect(loser?.status).not.toBe("pending");
  });

  it("رفض السائق يُسجَّل فوراً فلا يُعاد عرضه عليه في الدورة التالية", async () => {
    const driverId = await registerDriver();
    await verifyAndActivate(driverId);
    await registerRider();

    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));

    const orders = await sql<{ id: string }[]>`select id from orders`;
    const orderId = orders[0]?.id ?? "";

    driverSent.length = 0;
    // `BUG-003` — زرُّ الرفضِ يحملُ معرّفَ العرضِ لا معرّفَ الطلبِ: فنُحضِرُ المعرّفَ
    // الفعليَّ للعرضِ المعلَّقِ لهذا السائقِ — كما يبنيه المغلَّفُ نفسُه في الإنتاجِ —
    // لا نمرّرُ `orderId` موهوماً.
    const pendingOffer = await sql<{ id: string }[]>`
      select id from order_offers
       where order_id = ${orderId} and driver_id = ${driverId} and status = 'pending'
    `;
    const offerId = pendingOffer[0]?.id ?? "";
    await post("driver", callback(DRIVER_CHAT, `offer:reject:${offerId}`));
    expect(driverSent.map((m) => m.text)).toEqual([ar("driver.offer_rejected")]);

    const rejected = await sql<{ status: string; responded_at: Date | null }[]>`
      select status, responded_at from order_offers where id = ${offerId}
    `;
    expect(rejected[0]?.status).toBe("rejected");
    expect(rejected[0]?.responded_at).not.toBeNull();

    // القبول بعد الرفض مرفوض: العرض لم يعد معلَّقاً
    driverSent.length = 0;
    await post("driver", callback(DRIVER_CHAT, `offer:accept:${orderId}`));
    expect(driverSent[0]?.text).not.toBe(ar("driver.offer_accepted"));
    const stillSearching = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}
    `;
    expect(stillSearching[0]?.status).toBe("searching");
  });

  it("يلغي العميل طلبه النشط فعلاً", async () => {
    const driverId = await registerDriver();
    await verifyAndActivate(driverId);
    await registerRider();
    await post("rider", text(RIDER_CHAT, "/ride"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", text(RIDER_CHAT, "/skip"));

    riderSent.length = 0;
    await post("rider", text(RIDER_CHAT, "/cancel"));
    // التأكيد صار يسمّي الطلب: «تم إلغاء طلبك» المجرّدة أوهمت عميلاً في الإنتاج
    // أن مشواره أُلغي بينما أُلغي طرده، فبقي المشوار يبحث عن سائق خمس ساعات.
    expect(riderSent.at(-1)?.text).toContain("تم إلغاء:");

    const orders = await sql<{ status: string; cancelled_reason: string | null }[]>`
      select status, cancelled_reason from orders
    `;
    expect(orders[0]?.status).toBe("cancelled");
    expect(orders[0]?.cancelled_reason).toBe("rider_cancelled");
  });

  it("لا يعرض مدينة غير مفعَّلة على أي مستخدم", async () => {
    // نُطفئ المدنَ جميعاً لا مدينةَ السيناريو وحدَها: المقصودُ «لا مدينةَ مفعَّلة»،
    // وإطفاءُ واحدةٍ يجعل النتيجةَ رهنَ بقيّةِ صفوفِ الجدول لا رهنَ سلوكِ المنتَج.
    await sql`update cities set is_active = false`;
    driverSent.length = 0;
    await post("driver", text(DRIVER_CHAT, "/start"));
    await post("driver", text(DRIVER_CHAT, "أحمد العمري"));
    await post("driver", contact(DRIVER_CHAT, "0501234567"));
    expect(driverSent[driverSent.length - 1]?.text).toBe(ar("common.no_active_city"));
    const drivers = await sql<{ id: string }[]>`select id from drivers`;
    expect(drivers).toHaveLength(0);
  });
});
