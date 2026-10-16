/**
 * الغرض: إثبات ما كان يحدث فعلاً في الإنتاج وما صار يحدث بعده: راكب يطلب ولا
 *   سائق في المدينة، فيبقى طلبه 'searching' بلا عرض واحد. قبل مهمّة الكنس كان
 *   يبقى كذلك إلى الأبد بلا كلمة تصله؛ وبعدها يُصعَّد إلى قروب الإسناد ويُخبَر
 *   صاحبه مرّة واحدة لا في كل شوط.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 *
 *   وأُضيفت طبقةٌ ثانية: الطلب اليتيم المستنفد دوراته — عُرِض فتجاهلوه حتّى
 *   نفدت الدورات، فلا يُبَّث (redispatch تردّه بـBROADCAST_ROUNDS_EXHAUSTED) ولا كان
 *   يُصعَّد (الاستعلام كان يشترط «بلا أي عرض») — يتيمٌ دائمٌ والراكب ينتظر.
 *
 *   وطبقةٌ ثالثة هي أخطرها: الكنس كان يتخطّى القسم ٣.٤ بأكمله. قروب السائقين غير
 *   المشتركين مبنيٌّ بدوراته ومطالباته وتدويره، ولم يكن في كلّ المنتج موضعٌ واحدٌ
 *   يفتح دورته الأولى: `republishOrderCard` يُنادى من مهمّة التدوير وحدها، وهي
 *   تدوّر ما هو مفتوحٌ أصلاً. فكانت كلّ طلبات الإنتاج تمرّ من المشتركين إلى قروب
 *   الإسناد مباشرةً — بشرٌ يعالجون بأيديهم ما بُني ليُعالج تلقائيّاً، وقروبٌ فارغٌ
 *   أُرسلت روابطُه للسائقين المنتهية تجاربُهم.
 * ملاحظات مستقبلية: يُوسَّع حين تُضاف إعادة البثّ قبل التصعيد.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { runSweepUnmatchedOrders } from "../../apps/workers/src/jobs/sweep-unmatched-orders.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createNegotiationWiring } from "../../packages/infrastructure/dispatch/negotiation-wiring.ts";
import { createUnmatchedOrderFinder } from "../../packages/infrastructure/dispatch/unmatched-adapters.ts";
import { asOutboundSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import {
  drainNotificationOutbox,
  unmatchedHandlers,
} from "../support/drain-notification-outbox.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "unmatched-secret";
const RIDER_CHAT = 250_001;
const OFFERED_DRIVER_CHAT = 250_002;
/** حدّ دورات البثّ في الاختبار — يُمرّر صراحةً كما يقرأه العامل من إعدادات المدينة. */
const MAX_ROUNDS = 3;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1902 };

const config: AppConfig = testConfig({
  port: 3997,
  telegramWebhookSecret: WEBHOOK_SECRET,
});

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let riderSent: SentMessage[];
let groupSent: SentMessage[];
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
const callback = (chatId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

/**
 * نصُّ الرسالةِ كما يبنيهِ الإنتاجُ: اسمُ زرِّ الإلغاءِ يُقرأُ من مفتاحِه ويُحلُّ في
 * القالبِ. مقارنةُ القالبِ الخامِّ كانت ستقبلَ رسالةً تقولُ للراكبِ «{cancel_button}».
 */
function riderText(key: string): string {
  // `MSG-AUDIT-01`: الإحالةُ إلى الإلغاءِ سطرٌ مُعَدٌّ مسبقاً بحسبِ السطحِ؛ والمُرسِلُ
  // في هذا الاختبارِ بلا خيارِ سطحٍ، فسطحُه الافتراضيُّ «chat» — زرُّ القائمةِ.
  const cancelButton = translate("ar", "menu.rider.cancel");
  return translate("ar", key, {
    cancel_button: cancelButton,
    cancel_hint: translate("ar", "rider.cancel_hint_menu", { cancel_button: cancelButton }),
  });
}

/**
 * من يردّ بإخفاق عند إرسال بطاقة الإسناد. يُنقص في كل نداءٍ حتّى يبلغ الصفر،
 * فيُحاكي إخفاقاً عابراً لا دائماً — والعابر هو محلّ العطب المقيس.
 */
let sendFailuresLeft = 0;

/** كنسٌ بعتبة صفرية: الطلب المُنشأ للتوّ يُعدّ عالقاً بلا انتظار حقيقي في الاختبار. */
async function sweep(staleAfterSeconds = 0, maxBroadcastRounds = MAX_ROUNDS) {
  const negotiation = createNegotiationWiring(sql, {
    driverOut: asOutboundSender(capturing(groupSent)),
    riderOut: asOutboundSender(capturing(riderSent)),
    // بطاقة قروب الإسناد تُنشَر ببوت السائق: هو وحده العضو في القروبات،
    // ويجب أن يعود معرّف الرسالة ليُربط بالطلب.
    identifyingDriver: {
      sendReturningId: async (chatId: string, body: string) => {
        if (sendFailuresLeft > 0) {
          sendFailuresLeft -= 1;
          throw new Error("انقطاعٌ عابرٌ في الشبكة");
        }
        groupSent.push({ chatId, text: body, markup: null });
        return "1";
      },
    },
  });

  const report = await runSweepUnmatchedOrders(cityId as CityId, {
    finder: createUnmatchedOrderFinder(sql),
    escalate: negotiation.escalate,
    unsubscribed: negotiation.republish,
    staleAfterSeconds,
    maxBroadcastRounds,
  });

  /**
   * إخطارُ صاحبِ الطلبِ لم يبقَ أثراً متزامناً في المسحِ: صارَ صفّاً يُودَعُ في
   * معاملةِ القاعدةِ ويُرسِلُه عاملُ الصادرِ بعدَ الالتزامِ (BUG-004). فيُشغَّلُ
   * العاملُ الحقيقيُّ هنا بمُرسِلِ الراكبِ نفسِه، لا يُقلَّدُ الإرسالُ بيدٍ.
   */
  await drainNotificationOutbox(sql, capturing(groupSent), {
    ...unmatchedHandlers(capturing(riderSent)),
  });

  return report;
}

/**
 * يُنهي مسار قروب غير المشتركين للطلب بدوراتٍ مُستنفدةٍ مكتوبةٍ في القاعدة لا
 * بتعطيل إعدادٍ ولا بحذف معرّف القروب: هذه هي الحال التي تقع في الإنتاج فعلاً
 * بعد دوراتٍ لم يتفق فيها أحد، وعندها وحدها يفتح باب الإسناد.
 */
async function exhaustUnsubscribedCycles(orderId: string): Promise<void> {
  const rows = await sql<{ value: string }[]>`
    select value from platform_settings
     where city_id = ${cityId}::uuid and key = 'unsubscribed_max_cycles'`;
  const max = Number(rows[0]?.value);
  if (!Number.isFinite(max) || max < 1) throw new Error("لم يُقرأ حدّ الدورات من الإعدادات");

  for (let cycle = 1; cycle <= max; cycle += 1) {
    await sql`
      insert into unsubscribed_negotiations (city_id, order_id, cycle, status, collect_deadline)
      values (${cityId}::uuid, ${orderId}::uuid, ${cycle}, 'exhausted', now() - interval '1 minute')
    `;
  }
}

/** معرّف الطلب الوحيد القائم — كلّ اختبار هنا ينشئ طلباً واحداً. */
async function currentOrderId(): Promise<string> {
  const rows = await sql<{ id: string }[]>`select id from orders`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("لا طلب قائم");
  return id;
}

/**
 * مختصرٌ لما تشترك فيه كلّ اختبارات التصعيد بعد وصل الباب الثاني: الإسناد
 * البشريّ لم يعد أوّل من يُنادى، بل آخره — ومن أراد اختباره فعليه أن يستنفد ما قبله.
 */
async function exhaustWiderCircleForCurrentOrder(): Promise<void> {
  await exhaustUnsubscribedCycles(await currentOrderId());
}

/**
 * سائقٌ مُتحقّق يُكتب مباشرةً لا عبر البوت: المقصود إنشاء عرضٍ منتهٍ لا
 * اختبار تسجيل السائقين، والمرور بالبوت هنا يخلط ما يُقاس بما لا يُقاس.
 */
async function insertVerifiedDriver(): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    with u as (
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}::uuid, ${OFFERED_DRIVER_CHAT}, 'سائق العرض المنتهي', '+966500000251',
              'driver', 'ar')
      returning id
    )
    insert into drivers (city_id, user_id, verification_status)
    select ${cityId}::uuid, u.id, 'verified' from u
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("لم يُكتب السائق");
  return id;
}

/**
 * يبلغ بالطلب القائم حالةَ اليتيم الموصوفة: دورةٌ معلومة وعرضٌ منتهٍ لا حيّ.
 * الانتهاء بـexpired لا بـrejected عمداً: الصمتُ ليس رفضاً، وهو الحال الأكثر
 * وقوعاً في الواقع: سائقٌ يقود وهاتفه في جيبه.
 */
async function makeOrphanWithDeadOffer(round: number): Promise<string> {
  const driverId = await insertVerifiedDriver();
  const orders = await sql<{ id: string }[]>`select id from orders`;
  const orderId = orders[0]?.id;
  if (orderId === undefined) throw new Error("لا طلب قائم");

  await sql`update orders set broadcast_round = ${round} where id = ${orderId}::uuid`;
  await sql`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}::uuid, ${orderId}::uuid, ${driverId}::uuid, ${round}, 'expired',
            now() - interval '1 minute')
  `;
  return orderId;
}

/** راكب يصل إلى طلب رحلة قائم بلا أي سائق في المدينة. */
async function riderOrdersRide(): Promise<void> {
  await post("rider", text(RIDER_CHAT, "/start"));
  await post("rider", text(RIDER_CHAT, "عبدالله"));
  await post("rider", contact(RIDER_CHAT, "+966500000250"));
  await post("rider", callback(RIDER_CHAT, `city:${cityId}`));
  await post("rider", text(RIDER_CHAT, "/ride"));
  await post("rider", callback(RIDER_CHAT, "svc:transport"));
  await post("rider", location(RIDER_CHAT, PICKUP));
  await post("rider", location(RIDER_CHAT, DROPOFF));
}

describeIf("الطلب الذي لا يجد سائقاً: تصعيد وإشعار", () => {
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
    sendFailuresLeft = 0;
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    /*
     * بعد D-01، يمرّ مسارُ البوتِ لإنشاءِ الطلبِ عبر `request_ride()` التي تتحقَّقُ من
     * قدرةِ المدينةِ (`city_served_services`). هذه الاختباراتُ تحتاجُ الطلبَ أن يُنشأَ
     * ويبقى في `searching` ليُكنَس ويُصعَّد، فنُبذر سائقاً قادراً غير متاحٍ ولا يملكُ موقعاً.
     */
    await seedCapableDriver({
      sql,
      cityId,
      service: "transport",
      telegramId: 250_099,
    });
    riderSent = [];
    groupSent = [];
    container = buildContainer(config, {
      driverSender: capturing(groupSent),
      riderSender: capturing(riderSent),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  it("يُعيد إنتاج العطب: طلب بلا سائق يبقى يبحث بلا أي عرض", async () => {
    await riderOrdersRide();

    const orders = await sql<{ status: string; broadcast_round: number }[]>`
      select status, broadcast_round from orders`;
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("searching");

    // هذا بالضبط ما رأيناه في الإنتاج: صفر عروض. لا شيء تُنهي مهلته expire-offers،
    // ولا دورة تُدوّرها rotate-negotiations — فالطلب كان يسقط بين المهمّتين.
    const offers = await sql<{ count: string }[]>`select count(*) from order_offers`;
    expect(Number(offers[0]?.count)).toBe(0);
  });

  /**
   * الانحدار المقصود من وصل الباب الثاني: قبله كان أوّل كنسٍ يرمي الطلب للبشر،
   * وقروب غير المشتركين — وهو موضع تحويل السائق إلى مشتركٍ — لا يرى طلباً أبداً.
   */
  it("الكنس يفتح الدائرة الأوسع قبل البشر: بطاقةٌ في قروب غير المشتركين ودورةٌ أولى", async () => {
    await riderOrdersRide();
    riderSent.length = 0;
    groupSent.length = 0;

    const report = await sweep();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.examined).toBe(1);
    expect(report.value.offeredToUnsubscribed).toHaveLength(1);
    expect(report.value.queuedWiderCircle).toHaveLength(1);
    // ولا تصعيد: البشر لا يُنادون والأوتوماتيكيّ لمّا يُجرّب.
    expect(report.value.escalated).toHaveLength(0);
    expect(report.value.failed).toBe(0);

    // دورةٌ أولى مفتوحةٌ في القاعدة لا في الذاكرة.
    const cycles = await sql<{ cycle: number; status: string; group_message_id: string | null }[]>`
      select cycle, status, group_message_id from unsubscribed_negotiations`;
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.cycle).toBe(1);
    expect(cycles[0]?.status).toBe("collecting");
    expect(cycles[0]?.group_message_id).not.toBeNull();

    // البطاقة إلى قروب غير المشتركين لا إلى قروب الإسناد.
    expect(groupSent.filter((m) => String(m.chatId) === "-1003").length).toBeGreaterThan(0);
    expect(groupSent.filter((m) => String(m.chatId) === "-1002")).toHaveLength(0);

    // والراكب يُخبَر بما يجري فعلاً لا بـ«أُحيل طلبُك يدويّاً».
    const told = riderSent.filter((m) => m.text === riderText("rider.searching_wider_circle"));
    expect(told).toHaveLength(1);
    expect(String(told[0]?.chatId)).toBe(String(RIDER_CHAT));
    expect(riderSent.filter((m) => m.text === riderText("rider.no_driver_found"))).toHaveLength(0);

    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'order.escalated'`;
    expect(Number(audit[0]?.count)).toBe(0);
  });

  /** ولا بطاقتان لنفس الطلب: الدورة الحيّة تملكها مهمّة التدوير لا الكنس. */
  it("الشوط التالي لا ينشر بطاقةً ثانية ولا يُزعج الراكب ولا يُصعّد", async () => {
    await riderOrdersRide();
    await sweep();
    riderSent.length = 0;
    groupSent.length = 0;

    const second = await sweep();
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.awaitingUnsubscribed).toBe(1);
    expect(second.value.offeredToUnsubscribed).toHaveLength(0);
    expect(second.value.queuedWiderCircle).toHaveLength(0);
    expect(second.value.escalated).toHaveLength(0);
    expect(groupSent).toHaveLength(0);
    expect(riderSent).toHaveLength(0);

    const cycles = await sql<{ count: string }[]>`
      select count(*) from unsubscribed_negotiations`;
    expect(Number(cycles[0]?.count)).toBe(1);
  });

  it("الكنس يُصعّد الطلب إلى قروب الإسناد ويُخبر الراكب بالحقيقة", async () => {
    await riderOrdersRide();
    await exhaustWiderCircleForCurrentOrder();
    riderSent.length = 0;
    groupSent.length = 0;

    const report = await sweep();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.examined).toBe(1);
    expect(report.value.escalated).toHaveLength(1);
    expect(report.value.queuedNoDriver).toHaveLength(1);

    // الأثر مُثبَّت في القاعدة لا في الذاكرة فقط
    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'order.escalated'`;
    expect(Number(audit[0]?.count)).toBe(1);

    // الراكب أُخبِر فعلاً، وبنصٍّ يقول له إنه لا سائق — لا صمت
    const told = riderSent.filter((m) => m.text === riderText("rider.no_driver_found"));
    expect(told).toHaveLength(1);
    expect(String(told[0]?.chatId)).toBe(String(RIDER_CHAT));

    // وبطاقة وصلت قروب الإسناد
    const toGroup = groupSent.filter((m) => String(m.chatId) === "-1002");
    expect(toGroup.length).toBeGreaterThan(0);
  });

  it("الطلب لا يُصعَّد مرّتين ولا يُزعَج صاحبه في كل شوط", async () => {
    await riderOrdersRide();
    await exhaustWiderCircleForCurrentOrder();
    await sweep();
    riderSent.length = 0;
    groupSent.length = 0;

    // الشوط الثاني بعد دقيقة في الواقع — وهنا فوراً
    const second = await sweep();
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.examined).toBe(1);
    expect(second.value.escalated).toHaveLength(0);
    expect(second.value.alreadyEscalated).toBe(1);
    expect(second.value.queuedNoDriver).toHaveLength(0);

    // لا رسالة ثانية للراكب: عدم التكرار مضمون في القاعدة لا في ذاكرة العملية
    expect(riderSent.filter((m) => m.text === riderText("rider.no_driver_found"))).toHaveLength(0);

    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'order.escalated'`;
    expect(Number(audit[0]?.count)).toBe(1);
  });

  /**
   * الانحدار المقصود: قبل الإصلاح كان `examined` صفراً لأنّ الاستعلام
   * يشترط «بلا أي عرض»، فيخرج الطلب من مساري البثّ والتصعيد معاً ويبقى
   * `searching` إلى الأبد. وإن أُعيد الشرط يوماً يرجع هذا الاختبار أحمر.
   */
  it("الطلب المستنفد دوراته وله عرضٌ منتهٍ يُصعَّد بسببٍ يقول الحقيقة", async () => {
    await riderOrdersRide();
    await makeOrphanWithDeadOffer(MAX_ROUNDS);
    await exhaustWiderCircleForCurrentOrder();
    riderSent.length = 0;
    groupSent.length = 0;

    const report = await sweep();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.examined).toBe(1);
    expect(report.value.escalated).toHaveLength(1);
    expect(report.value.stillBroadcasting).toBe(0);
    expect(report.value.queuedNoDriver).toHaveLength(1);

    // السبب يفرّق ما لا يجوز خلطُه: تجاهلُ سائقٍ ليس انعدامَ السائقين.
    const audit = await sql<{ reason: string }[]>`
      select payload->>'reason' as reason
        from audit_log where action = 'order.escalated'`;
    expect(audit).toHaveLength(1);
    /**
     * والسبب تغيّر حين وُصل الباب الثاني، وهو أصدق ممّا كان: من يقرأ البطاقة
     * في قروب الإسناد يحتاج أن يعرف أنّ الدائرتين معاً أُجرِّبتا ولم تنجحا، لا أن يقرأ
     * عن دورات بثٍّ انتهت قبل محاولةٍ أخرى برمتها.
     */
    expect(audit[0]?.reason).toBe("unsubscribed_cycles_exhausted");

    // وبطاقةٌ وصلت قروب الإسناد بنصّ السبب المترجم لا بمفتاحٍ خام.
    const toGroup = groupSent.filter((m) => String(m.chatId) === "-1002");
    expect(toGroup.length).toBeGreaterThan(0);
    const reasonText = translate("ar", "group.escalation_reason_unsubscribed_cycles_exhausted");
    expect(toGroup.some((m) => m.text.includes(reasonText))).toBe(true);
  });

  /**
   * وجهُ الإصلاح الآخر: توسيعُ الاستعلام إلى «بلا عرضٍ حيّ» لا يجوز أن يُغرق
   * قروب الإسناد بمن لمّا يزل في مسار البثّ.
   */
  it("الطلب في وسط دوراته لا يُصعَّد ويُعدّ باقياً في البثّ", async () => {
    await riderOrdersRide();
    await makeOrphanWithDeadOffer(1);
    riderSent.length = 0;
    groupSent.length = 0;

    const report = await sweep();
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    // يُقرأ لأنّ لا عرض حيّ له، ويُترك لأنّ دوراته باقية — ويُعدّ لا يُطمر.
    expect(report.value.examined).toBe(1);
    expect(report.value.escalated).toHaveLength(0);
    expect(report.value.stillBroadcasting).toBe(1);
    expect(report.value.queuedNoDriver).toHaveLength(0);
    expect(riderSent).toHaveLength(0);

    const audit = await sql<{ count: string }[]>`
      select count(*) from audit_log where action = 'order.escalated'`;
    expect(Number(audit[0]?.count)).toBe(0);
  });

  /**
   * وحدّ المدينة هو الحاكم لا رقمٌ مكتوب في الكود: نفس الطلب بدورة واحدة
   * يُترك حين الحدّ ٣ ويُصعَّد حين الحدّ ١ — ولا شيء تغير إلّا الإعداد.
   */
  it("الحدّ المقروء من الإعدادات هو من يحكم لا رقمٌ في الكود", async () => {
    await riderOrdersRide();
    await makeOrphanWithDeadOffer(1);
    await exhaustWiderCircleForCurrentOrder();

    const report = await sweep(0, 1);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.escalated).toHaveLength(1);
    expect(report.value.stillBroadcasting).toBe(0);
  });

  /**
   * العطب المقيس: كان الأثر يُكتب قبل إرسال البطاقة، فإن أخفق الإرسال مرّةً
   * واحدةً — انقطاعٌ أو 429 من تلغرام — قرأ الحارس ذلك الأثرَ فمنع كلّ إعادة
   * إلى الأبد: بطاقةٌ لم تصل قروبَ الإسناد، وراكبٌ لم يُخبَر، وأثرٌ يقول «صُعِّد»
   * فيطمأنُّ من يراجعه. اليتم بعينه الذي جاء التصعيد ليمنعه.
   */
  it("إخفاق إرسال البطاقة لا يُخرس الطلب: الشوط التالي يُصعّده فعلاً", async () => {
    await riderOrdersRide();
    await exhaustWiderCircleForCurrentOrder();
    riderSent.length = 0;
    groupSent.length = 0;

    sendFailuresLeft = 1;
    const first = await sweep();
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // الشوط الأول: لا بطاقة، ولا رسالةً للراكب، ويُعدّ مُخفقاً لا مُصعّداً.
    expect(first.value.escalated).toHaveLength(0);
    expect(first.value.failed).toBe(1);
    expect(groupSent).toHaveLength(0);
    expect(riderSent).toHaveLength(0);

    // والأثر لا يكذب: موجودٌ ولكنّه موسومٌ بأنّ البطاقة لم تُسلَّم.
    const pending = await sql<{ delivered: boolean | null }[]>`
      select (payload->>'delivered')::boolean as delivered
        from audit_log where action = 'order.escalated'`;
    expect(pending).toHaveLength(1);
    expect(pending[0]?.delivered).toBe(false);

    // الشوط التالي ينجح: البطاقة تصل، والراكب يُخبَر أخيراً.
    const second = await sweep();
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.escalated).toHaveLength(1);
    expect(second.value.queuedNoDriver).toHaveLength(1);
    expect(groupSent.filter((m) => m.chatId === "-1002")).toHaveLength(1);
    expect(riderSent).toHaveLength(1);

    // ولا يتراكم في السجلّ أثرٌ لكلّ محاولة: أثرٌ واحدٌ صار مُسلَّماً.
    const settled = await sql<{ delivered: boolean | null; message_id: string | null }[]>`
      select (payload->>'delivered')::boolean as delivered,
             payload->>'message_id' as message_id
        from audit_log where action = 'order.escalated'`;
    expect(settled).toHaveLength(1);
    expect(settled[0]?.delivered).toBe(true);
    expect(settled[0]?.message_id).toBe("1");
  });

  /**
   * والإصلاح لا يفتح باب التكرار: تسليمٌ ناجحٌ يُغلق الباب كما كان يُغلقه
   * من قبل — ولا يُغرَق قروبُ الإسناد بنفس الحالة كلّ دقيقة.
   */
  it("التسليم الناجح لا يُكرّر: شوطٌ ثانٍ لا يبعث بطاقةً ولا رسالةً", async () => {
    await riderOrdersRide();
    await exhaustWiderCircleForCurrentOrder();
    riderSent.length = 0;
    groupSent.length = 0;

    await sweep();
    expect(groupSent.filter((m) => m.chatId === "-1002")).toHaveLength(1);
    expect(riderSent).toHaveLength(1);

    const again = await sweep();
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.value.escalated).toHaveLength(0);
    expect(again.value.alreadyEscalated).toBe(1);
    expect(groupSent.filter((m) => m.chatId === "-1002")).toHaveLength(1);
    expect(riderSent).toHaveLength(1);
  });

  it("الطلب الذي لم يبلغ العتبة بعد لا يُصعَّد", async () => {
    await riderOrdersRide();
    riderSent.length = 0;

    // عتبة ساعة كاملة: الطلب أُنشئ للتوّ فلا يجوز أن يُصعَّد
    const report = await sweep(3600);
    expect(report.ok).toBe(true);
    if (!report.ok) return;

    expect(report.value.examined).toBe(0);
    expect(report.value.escalated).toHaveLength(0);
    expect(riderSent).toHaveLength(0);
  });
});
