/**
 * الغرض: الدورة الكاملة لقروب السائقين غير المشتركين على قاعدة PostgreSQL فعلية:
 *   طلب لا يجد سائقاً مشتركاً ← نشر بطاقة في قروب المدينة ← ثلاث ضغطات «قبول» تُسجَّل
 *   بالترتيب والرابعة تُرفض ← قناة مع الأول وحده ← رفض العميل ينقلها للثاني ثم الثالث
 *   ← نفاد الثلاثة ← إعادة نشر مع استبعاد سائقي الدورة السابقة ← اتفاق فعلي يُسنِد الطلب
 *   ← ونفاد الدورات كلها يُصعِّد لقروب الإسناد. وتُثبت خصوصية القناة: لا رقم هاتف يعبر.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأي تعديل على القسم 3.4
 * ملاحظات مستقبلية: عند إضافة السعر المتفَق عليه تُضاف تأكيدات على عموده هنا.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { rotateUnsubscribedNegotiations } from "../../apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts";
import { publishToUnsubscribedGroup } from "../../packages/application/dispatch/publish-to-unsubscribed-group.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import {
  drainNotificationOutbox,
  negotiationHandlers,
  unmatchedHandlers,
} from "../support/drain-notification-outbox.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const UNSUB_GROUP = "-1003";
const ESCALATION_GROUP = "-1002";
const RIDER_CHAT = 310_001;
const DRIVER_CHATS = [320_001, 320_002, 320_003, 320_004, 320_005] as const;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };

const config: AppConfig = testConfig({
  port: 3997,
  telegramWebhookSecret: WEBHOOK_SECRET,
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
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
/** ضغطة زرّ داخل قروب: chatId هو القروب لا المستخدم — هذا هو واقع تلغرام. */
const groupCallback = (userId: number, data: string) => ({
  update_id: nextUpdateId(),
  callback_query: { data, from: { id: userId }, message: { chat: { id: UNSUB_GROUP } } },
});
const privateCallback = (chatId: number, data: string) => ({
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

describeIf("دورة قروب غير المشتركين على قاعدة حقيقية", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, unsubscribed_claims,
                             unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, unsubscribed_claims,
                             unsubscribed_negotiations, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: ESCALATION_GROUP, unsubscribed: UNSUB_GROUP },
      prior: cityHandle,
    });
    /*
     * بعد D-01، مسارُ البوتِ يمرّ عبر `request_ride()` التي تتحقَّقُ من قدرةِ
     * المدينةِ (`city_served_services`) قبلَ أن يُنشأَ الطلبَ. هذه الاختباراتُ تحتاجُ
     * الطلبَ أن يُنشأَ ويبقى في `searching` ليُسرَّ إلى قروب غير المشتركين، لا أن
     * يُرفضَ بـ`SERVICE_NOT_AVAILABLE_IN_CITY`. فنُبذُر سائقاً قادراً غير متاحٍ ولا
     * يملكُ موقعاً حيًّا، فيُشبِعُ شرطَ القدرةِ ويتركُ الطلبَ بلا إسنادٍ — وهو ما يُرسي
     * الدورةَ كلَّها.
     */
    await seedCapableDriver({
      sql,
      cityId,
      service: "transport",
      telegramId: 310_099,
    });
    // platform_settings لا يُفرغ، فأي اختبار يغيّر إعداداً يُلوّث من بعده — ويلوّث التشغيل التالي
    // للملف كله. نعيد إعدادات الدورة لقيم البذر قبل كل اختبار ليكون الملف مستقراً مهما تكرر.
    await sql`
      update platform_settings
         set value = case key
                       when 'unsubscribed_claim_slots'       then '3'
                       when 'unsubscribed_collect_seconds'   then '120'
                       when 'unsubscribed_negotiate_seconds' then '180'
                       when 'unsubscribed_max_cycles'        then '3'
                       else value
                     end
       where city_id = ${cityId} and key like 'unsubscribed_%'
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

  /**
   * سائق مسجَّل ومتحقَّق لكن بلا اشتراك سارٍ — وهذا هو بيت القصيد: من ينتظر في هذا
   * القروب هو من لا يصله عرض مباشر. نُلغي اشتراكه التجريبي صراحةً بعد التسجيل.
   */
  async function unsubscribedDriver(chatId: number, name: string, phone: string): Promise<string> {
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
    // PD-040: التجربةُ لا تبدأُ قبلَ التوثيقِ — نبدأُها ثم نُنهيها لنحاكي انقضاءها
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    await sql`update subscriptions set status = 'expired' where driver_id = ${driverId}`;
    await post("driver", text(chatId, "/available"));
    await post("driver", location(chatId, DRIVER_AT));
    return driverId;
  }

  /** طلب نقل حقيقي من عميل مسجَّل، يبقى searching لأن لا مشترك يقبله. */
  async function searchingOrder(): Promise<OrderId> {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
    await post("rider", privateCallback(RIDER_CHAT, "svc:transport"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    const rows = await sql<{ id: string; status: string }[]>`
      select id, status from orders order by created_at desc limit 1
    `;
    const order = rows[0];
    if (order === undefined) throw new Error("لم يُنشأ الطلب");
    expect(order.status).toBe("searching");
    return order.id as OrderId;
  }

  async function publish(orderId: OrderId) {
    const published = await publishToUnsubscribedGroup({ orderId }, container.negotiation.publish);
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error("فشل النشر");
    return published.value;
  }

  const groupCards = () => driverSent.filter((m) => m.chatId === UNSUB_GROUP);

  /**
   * تشغيلُ عاملِ التسليمِ فعليًّا: منذُ BUG-004 لا تُرسَلُ إخطاراتُ الدورةِ من
   * مسارِ الطلبِ بعدَ commit، بل تُودَعُ صفوفُها في المعاملةِ نفسِها ويُسلِّمُها
   * العامل. فالتحقّقُ من وصولِها يستدعي تشغيلَه لا انتظارَ أثرٍ متزامنٍ لا يقع.
   */
  const deliverQueued = () =>
    drainNotificationOutbox(sql, capturing(driverSent), {
      ...negotiationHandlers(capturing(driverSent), capturing(riderSent)),
      // فتحُ الدورةِ يُودِعُ إخطارَ صاحبِ الطلبِ في الصفِّ نفسِه: مَن يُفرِّغُ الصفَّ
      // يُفرِّغُه كما يفعلُ العاملُ — بمعالجاتِ كلِّ نوعٍ فيه لا بنوعٍ واحدٍ منه.
      ...unmatchedHandlers(capturing(riderSent)),
    });

  it("ينشر بطاقة في قروب المدينة بلا رقم هاتف ولا موقع دقيق، ويحفظ معرّف الرسالة", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501234567");
    const orderId = await searchingOrder();

    const report = await publish(orderId);
    expect(report.published).toBe(true);
    expect(report.cycle).toBe(1);

    const cards = groupCards();
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (card === undefined) throw new Error("لم تُنشر البطاقة");

    // الخصوصية: لا رقم العميل ولا رقم السائق ولا الإحداثيات الدقيقة
    expect(card.text).not.toContain("0501234567");
    expect(card.text).not.toContain(String(PICKUP.latitude));
    expect(card.text).toContain("21.54, 39.17");
    expect(card.text).toContain(ar("driver.service_transport"));

    const rows = await sql<{ group_message_id: string | null; status: string; cycle: number }[]>`
      select group_message_id, status, cycle from unsubscribed_negotiations
       where order_id = ${orderId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("collecting");
    expect(rows[0]?.group_message_id).not.toBeNull();
  });

  it("يسجّل أول ثلاث ضغطات بالترتيب، ويرفض الرابعة وتكرار الشخص نفسه", async () => {
    const ids = [
      await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111"),
      await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222"),
      await unsubscribedDriver(DRIVER_CHATS[2], "فهد القحطاني", "0503333333"),
      await unsubscribedDriver(DRIVER_CHATS[3], "ماجد الشمري", "0504444444"),
    ];
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId;
    if (negotiationId === null) throw new Error("لم تُفتح الدورة");

    for (const chat of [DRIVER_CHATS[0], DRIVER_CHATS[1], DRIVER_CHATS[2]]) {
      await post("driver", groupCallback(chat, `unsub:claim:${negotiationId}`));
    }
    // الرابع: العدد اكتمل
    await post("driver", groupCallback(DRIVER_CHATS[3], `unsub:claim:${negotiationId}`));
    // والأول مرّة ثانية: لا يُسجَّل مرّتين
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));

    const claims = await sql<{ driver_id: string; position: number; outcome: string }[]>`
      select driver_id, position, outcome from unsubscribed_claims
       where negotiation_id = ${negotiationId} order by position
    `;
    expect(claims).toHaveLength(3);
    expect(claims.map((c) => c.position)).toEqual([1, 2, 3]);
    expect(claims.map((c) => c.driver_id)).toEqual([ids[0], ids[1], ids[2]] as string[]);
    expect(claims[0]?.outcome).toBe("negotiating");
    expect(claims[1]?.outcome).toBe("waiting");
    expect(claims[2]?.outcome).toBe("waiting");

    // الردود الرافضة وصلت للمحادثة الخاصة لا للقروب — ولا تكشف شيئاً أمام الجميع
    const toFourth = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[3]));
    expect(toFourth.at(-1)?.text).toBe(ar("negotiation.claim_rejected_full"));
    const toFirst = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toFirst.at(-1)?.text).toBe(ar("negotiation.claim_rejected_already"));
    expect(driverSent.filter((m) => m.chatId === UNSUB_GROUP)).toHaveLength(1);
  });

  it("يفتح القناة مع الأول وحده: الثاني والثالث لا تصل رسالتهما للعميل", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";

    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("driver", groupCallback(DRIVER_CHATS[1], `unsub:claim:${negotiationId}`));

    // NEG-SELECT-01: قبلَ أن يختارَ العميلُ السائقَ لا تُفتَحُ القناةُ حتى لصاحبِ الدورِ.
    const unselected = riderSent.length;
    await post("driver", text(DRIVER_CHATS[0], "قبل الاختيار"));
    expect(riderSent.filter((m) => m.text.includes("قبل الاختيار"))).toHaveLength(0);
    expect(riderSent.length).toBe(unselected);
    expect(driverSent.at(-1)?.text).toBe(ar("negotiation.driver_awaiting_selection"));
    await post("rider", text(RIDER_CHAT, "مرحبا"));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.rider_awaiting_selection"));
    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${negotiationId}:1`));

    const before = riderSent.length;
    await post("driver", text(DRIVER_CHATS[1], "أنا أقرب وأرخص، خذني أنا"));
    expect(riderSent).toHaveLength(before);

    await post("driver", text(DRIVER_CHATS[0], "أوصلك بأربعين ريال"));
    expect(riderSent.at(-1)?.text).toBe(
      ar("negotiation.relay_from_driver", { text: "أوصلك بأربعين ريال" }),
    );
    expect(riderSent.at(-1)?.chatId).toBe(String(RIDER_CHAT));
  });

  it("يحجب أرقام الهواتف داخل القناة في الاتجاهين وينبّه المرسِل", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${report.negotiationId}`));
    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${report.negotiationId}:1`));

    await post("driver", text(DRIVER_CHATS[0], "كلمني على 0509998877"));
    expect(riderSent.at(-1)?.text).not.toContain("0509998877");
    expect(driverSent.at(-1)?.text).toBe(ar("negotiation.relay_redacted"));

    await post("rider", text(RIDER_CHAT, "رقمي 0501234567 اتصل"));
    const toDriver = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toDriver.at(-1)?.text).not.toContain("0501234567");
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.relay_redacted"));
  });

  it("رفض العميل ينقل الدور للثاني ثم الثالث، وبعدها تنفد الدورة", async () => {
    const ids = [
      await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111"),
      await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222"),
      await unsubscribedDriver(DRIVER_CHATS[2], "فهد القحطاني", "0503333333"),
    ];
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";

    for (const chat of DRIVER_CHATS.slice(0, 3)) {
      await post("driver", groupCallback(chat, `unsub:claim:${negotiationId}`));
    }

    const activeDriver = async () => {
      const rows = await sql<{ driver_id: string | null }[]>`
        select c.driver_id from unsubscribed_negotiations n
          left join unsubscribed_claims c on c.id = n.active_claim_id
         where n.id = ${negotiationId}
      `;
      return rows[0]?.driver_id ?? null;
    };

    expect(await activeDriver()).toBe(ids[0] as string);
    await post("rider", privateCallback(RIDER_CHAT, `unsub:decline:${negotiationId}`));
    expect(await activeDriver()).toBe(ids[1] as string);
    await post("rider", privateCallback(RIDER_CHAT, `unsub:decline:${negotiationId}`));
    expect(await activeDriver()).toBe(ids[2] as string);
    await post("rider", privateCallback(RIDER_CHAT, `unsub:decline:${negotiationId}`));

    const state = await sql<{ status: string }[]>`
      select status from unsubscribed_negotiations where id = ${negotiationId}
    `;
    expect(state[0]?.status).toBe("exhausted");
    expect(await activeDriver()).toBeNull();
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.exhausted_rider"));

    // الطلب ما زال باحثاً: نفاد الثلاثة لا يُلغي الطلب ولا يُسنِده
    const order = await sql<{ status: string }[]>`select status from orders where id = ${orderId}`;
    expect(order[0]?.status).toBe("searching");
  });

  it("«تم الاتفاق» يُسنِد الطلب فعلاً للسائق صاحب الدور ويُغلق ما سواه", async () => {
    const first = await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";

    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("driver", groupCallback(DRIVER_CHATS[1], `unsub:claim:${negotiationId}`));
    await post("rider", privateCallback(RIDER_CHAT, `unsub:agree:${negotiationId}`));
    // إخطارُ الاتفاقِ يُودَعُ في صندوقِ الصادرِ داخلَ معاملةِ الإسنادِ (BUG-004)،
    // فالتسليمُ صارَ للعامل. نُشغّلُه هنا فعليًّا ثمّ نتحقّقُ من نفسِ الرسائلِ.
    await deliverQueued();

    const order = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id from orders where id = ${orderId}
    `;
    expect(order[0]?.status).toBe("matched");
    expect(order[0]?.assigned_driver_id).toBe(first);

    const claims = await sql<{ position: number; outcome: string }[]>`
      select position, outcome from unsubscribed_claims
       where negotiation_id = ${negotiationId} order by position
    `;
    expect(claims[0]?.outcome).toBe("agreed");
    expect(claims[1]?.outcome).toBe("cancelled");

    const negotiation = await sql<{ status: string }[]>`
      select status from unsubscribed_negotiations where id = ${negotiationId}
    `;
    expect(negotiation[0]?.status).toBe("agreed");

    const toDriver = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toDriver.at(-1)?.text).toBe(ar("negotiation.agreed_driver"));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.agreed_rider"));
  });

  it("العامل يُعيد النشر بعد النفاد، ويستبعد سائقي الدورة السابقة مباشرةً", async () => {
    const ids = [
      await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111"),
      await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222"),
      await unsubscribedDriver(DRIVER_CHATS[2], "فهد القحطاني", "0503333333"),
      await unsubscribedDriver(DRIVER_CHATS[3], "ماجد الشمري", "0504444444"),
    ];
    const orderId = await searchingOrder();
    const first = await publish(orderId);
    const firstId = first.negotiationId ?? "";

    for (const chat of DRIVER_CHATS.slice(0, 3)) {
      await post("driver", groupCallback(chat, `unsub:claim:${firstId}`));
    }
    for (let index = 0; index < 3; index += 1) {
      await post("rider", privateCallback(RIDER_CHAT, `unsub:decline:${firstId}`));
    }

    const run = await rotateUnsubscribedNegotiations(cityId as CityId, {
      snapshots: container.negotiation.snapshots,
      rotate: container.negotiation.rotate,
      republish: container.negotiation.republish,
      escalate: container.negotiation.escalate,
      clock: container.negotiation.clock,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.republished).toEqual([orderId]);
    expect(run.value.failures).toEqual([]);

    const cycles = await sql<{ id: string; cycle: number; status: string }[]>`
      select id, cycle, status from unsubscribed_negotiations
       where order_id = ${orderId} order by cycle
    `;
    expect(cycles).toHaveLength(2);
    expect(cycles[0]?.status).toBe("cancelled");
    expect(cycles[1]?.cycle).toBe(2);
    expect(cycles[1]?.status).toBe("collecting");
    expect(groupCards()).toHaveLength(2);

    // الاستبعاد: من شارك في الدورة الأولى يُرفَض في الثانية، والرابع الجديد يُقبل
    const secondId = cycles[1]?.id ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${secondId}`));
    const toFirst = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toFirst.at(-1)?.text).toBe(ar("negotiation.claim_rejected_excluded"));

    await post("driver", groupCallback(DRIVER_CHATS[3], `unsub:claim:${secondId}`));
    const secondClaims = await sql<{ driver_id: string; position: number }[]>`
      select driver_id, position from unsubscribed_claims where negotiation_id = ${secondId}
    `;
    expect(secondClaims).toHaveLength(1);
    expect(secondClaims[0]?.driver_id).toBe(ids[3] as string);
    expect(secondClaims[0]?.position).toBe(1);
  });

  it("نفاد الدورات كلها يُصعِّد لقروب الإسناد مرّة واحدة، ولا يُكرَّر كل مرور", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();

    // سقف دورة واحدة لهذه المدينة: النفاد الأول يعني التصعيد مباشرةً
    await sql`
      update platform_settings set value = '1'
       where city_id = ${cityId} and key = 'unsubscribed_max_cycles'
    `;
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("rider", privateCallback(RIDER_CHAT, `unsub:decline:${negotiationId}`));

    const deps = {
      snapshots: container.negotiation.snapshots,
      rotate: container.negotiation.rotate,
      republish: container.negotiation.republish,
      escalate: container.negotiation.escalate,
      clock: container.negotiation.clock,
    };
    const run = await rotateUnsubscribedNegotiations(cityId as CityId, deps);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.escalated).toEqual([orderId]);
    expect(run.value.failures).toEqual([]);

    const escalations = driverSent.filter((m) => m.chatId === ESCALATION_GROUP);
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.text).toContain(orderId);

    // المرور الثاني لا يفعل شيئاً: الدورة أُغلقت، فلا تصعيد مكرَّر ولا خطأ صامت
    const again = await rotateUnsubscribedNegotiations(cityId as CityId, deps);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.examined).toBe(0);
    expect(again.value.escalated).toEqual([]);
    expect(driverSent.filter((m) => m.chatId === ESCALATION_GROUP)).toHaveLength(1);
  });

  it("العامل لا يمسّ دورة ما زالت في مهلتها", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    await publish(orderId);

    const run = await rotateUnsubscribedNegotiations(cityId as CityId, {
      snapshots: container.negotiation.snapshots,
      rotate: container.negotiation.rotate,
      republish: container.negotiation.republish,
      escalate: container.negotiation.escalate,
      clock: container.negotiation.clock,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.examined).toBe(1);
    expect(run.value.waiting).toBe(1);
    expect(run.value.republished).toEqual([]);
    expect(run.value.escalated).toEqual([]);
    expect(groupCards()).toHaveLength(1);
  });

  it("انتهاء مهلة التفاوض بلا قرار ينقل الدور تلقائياً ويُخطِر الطرفين", async () => {
    const ids = [
      await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111"),
      await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222"),
    ];
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";

    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("driver", groupCallback(DRIVER_CHATS[1], `unsub:claim:${negotiationId}`));

    // ندفع المهلة للماضي في القاعدة نفسها بدل تزييف الساعة: المهلة مقروءة من الصفّ
    await sql`
      update unsubscribed_negotiations set negotiate_deadline = now() - interval '1 minute'
       where id = ${negotiationId}
    `;

    const run = await rotateUnsubscribedNegotiations(cityId as CityId, {
      snapshots: container.negotiation.snapshots,
      rotate: container.negotiation.rotate,
      republish: container.negotiation.republish,
      escalate: container.negotiation.escalate,
      clock: container.negotiation.clock,
    });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.advanced).toEqual([negotiationId]);
    expect(run.value.failures).toEqual([]);

    const rows = await sql<{ driver_id: string | null; status: string }[]>`
      select c.driver_id, n.status from unsubscribed_negotiations n
        left join unsubscribed_claims c on c.id = n.active_claim_id
       where n.id = ${negotiationId}
    `;
    expect(rows[0]?.status).toBe("negotiating");
    expect(rows[0]?.driver_id).toBe(ids[1] as string);

    const expiredClaim = await sql<{ outcome: string }[]>`
      select outcome from unsubscribed_claims
       where negotiation_id = ${negotiationId} and driver_id = ${ids[0] as string}
    `;
    expect(expiredClaim[0]?.outcome).toBe("expired");

    await deliverQueued();

    const toFirst = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toFirst.at(-1)?.text).toBe(ar("negotiation.driver_turn_closed_expired"));
    const toSecond = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[1]));
    expect(toSecond.at(-1)?.text).toContain(
      ar("negotiation.driver_turn_opened", {
        seconds: 180,
        position: 2,
      }),
    );
  });

  it("NEG-SELECT-01: بطاقةُ العرضِ ثمَّ «معلومات السائق» ثمَّ «تجاهل» ثمَّ «اختيار» تفتحُ المحادثة", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await deliverQueued();

    // العميلُ يرى بطاقةَ العرضِ بأزرارِها الثلاثةِ، والسائقُ يعلمُ أنّ عرضَه أمامَ العميلِ.
    const presented = riderSent.find((m) =>
      m.text.startsWith(ar("negotiation.rider_presented", { position: 1 })),
    );
    expect(presented).toBeDefined();
    const buttons = JSON.stringify(presented?.markup ?? null);
    expect(buttons).toContain(`unsub:info:${negotiationId}:1`);
    expect(buttons).toContain(`unsub:sel:${negotiationId}:1`);
    expect(buttons).toContain(`unsub:next:${negotiationId}:1`);
    const toDriver = () => driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toDriver().some((m) => m.text.includes("عرضك أمام العميل"))).toBe(true);

    // «معلومات السائق»: الاسمُ الأوّلُ وحدَه ولا رقمَ هاتفٍ.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:info:${negotiationId}:1`));
    const info = riderSent.at(-1);
    expect(info?.text).toContain("👤");
    expect(info?.text).toContain("أحمد");
    expect(info?.text).not.toContain("العمري");
    expect(info?.text).not.toContain("0501111111");
    expect(JSON.stringify(info?.markup ?? null)).toContain(`unsub:ign:${negotiationId}:1`);

    // «تجاهل» يعودُ إلى بطاقةِ العرضِ.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:ign:${negotiationId}:1`));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.rider_presented", { position: 1 }));

    // «اختيار السائق» يُغلِقُ العرضَ ويفتحُ المحادثةَ للطرفَين.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${negotiationId}:1`));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.rider_selected_closed", { position: 1 }));
    const selected = await sql<{ selected_at: Date | null }[]>`
      select selected_at from unsubscribed_claims where negotiation_id = ${negotiationId}
    `;
    expect(selected[0]?.selected_at).not.toBeNull();
    await deliverQueued();
    const chatCard = riderSent.find((m) => m.text.startsWith("💬"));
    expect(JSON.stringify(chatCard?.markup ?? null)).toContain(`unsub:reopen:${negotiationId}:1`);
    expect(toDriver().some((m) => m.text.includes("اختارك العميل"))).toBe(true);

    // الضغطُ الثاني على «اختيار» لا يُودِعُ إخطاراً ثانياً.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${negotiationId}:1`));
    const queued = await sql<{ n: number }[]>`
      select count(*)::int as n from notification_outbox
       where dedup_key like ${`negotiation_turn_opened:selected:%`}
         and payload->>'claim_id' in (
           select id::text from unsubscribed_claims where negotiation_id = ${negotiationId})
    `;
    expect(queued[0]?.n).toBe(2);
  });

  it("NEG-SELECT-01: «السائق التالي» ينقل الدور بحارسِ البطاقة، والزرُّ القديمُ لا يمسُّ التالي", async () => {
    const ids = [
      await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111"),
      await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222"),
    ];
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("driver", groupCallback(DRIVER_CHATS[1], `unsub:claim:${negotiationId}`));

    await post("rider", privateCallback(RIDER_CHAT, `unsub:next:${negotiationId}:1`));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.rider_skipped"));
    // زرٌّ على بطاقةِ السائقِ الأوّلِ بعدَ انتقالِ الدورِ: بطاقةٌ قديمةٌ لا اختيارٌ للثاني.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${negotiationId}:1`));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.card_stale"));
    const active = await sql<{ driver_id: string; selected_at: Date | null }[]>`
      select c.driver_id, c.selected_at from unsubscribed_negotiations n
        join unsubscribed_claims c on c.id = n.active_claim_id where n.id = ${negotiationId}
    `;
    expect(active[0]?.driver_id).toBe(ids[1] as string);
    expect(active[0]?.selected_at).toBeNull();

    // الإخطارُ للسائقِ الذي تُخطِّيَ لطيفٌ لا جارحٌ.
    await deliverQueued();
    const first = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(first.at(-1)?.text).toBe(ar("negotiation.driver_turn_closed_declined"));
  });

  it("NEG-SELECT-01: المنتظرُ يُنهي انتظارَه بزرٍّ، وصاحبُ الدورِ لا يستطيع", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const second = await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("driver", groupCallback(DRIVER_CHATS[1], `unsub:claim:${negotiationId}`));

    const waiting = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[1])).at(-1);
    expect(waiting?.text).toBe(ar("negotiation.claim_registered_waiting", { position: 2 }));
    expect(JSON.stringify(waiting?.markup ?? null)).toContain(`unsub:leave:${negotiationId}`);

    await post("driver", privateCallback(DRIVER_CHATS[1], `unsub:leave:${negotiationId}`));
    expect(driverSent.at(-1)?.text).toBe(ar("negotiation.driver_left"));
    const claim = await sql<{ outcome: string }[]>`
      select outcome from unsubscribed_claims
       where negotiation_id = ${negotiationId} and driver_id = ${second}
    `;
    expect(claim[0]?.outcome).toBe("cancelled");
    const audit = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where action = 'unsubscribed.claim_withdrawn' and payload->>'negotiation_id' = ${negotiationId}
    `;
    expect(audit[0]?.n).toBe(1);

    await post("driver", privateCallback(DRIVER_CHATS[0], `unsub:leave:${negotiationId}`));
    expect(driverSent.at(-1)?.text).toBe(ar("negotiation.driver_leave_active"));

    // بعدَ انسحابِ المنتظِرِ يُفضي «السائق التالي» إلى النفادِ لا إلى المنسحب.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:next:${negotiationId}:1`));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.exhausted_rider"));
  });

  it("NEG-SELECT-01: عميلٌ آخرُ لا يرى معلوماتِ السائقِ ولا يختارُه", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));

    const stranger = DRIVER_CHATS[4];
    await post("rider", privateCallback(stranger, `unsub:info:${negotiationId}:1`));
    await post("rider", privateCallback(stranger, `unsub:sel:${negotiationId}:1`));
    const toStranger = riderSent.filter((m) => m.chatId === String(stranger));
    expect(toStranger.every((m) => !m.text.includes("أحمد"))).toBe(true);
    const selected = await sql<{ selected_at: Date | null }[]>`
      select selected_at from unsubscribed_claims where negotiation_id = ${negotiationId}
    `;
    expect(selected[0]?.selected_at).toBeNull();
  });

  it("لا تُفتح دورتان لطلب واحد مهما تكرّر النشر", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    await publish(orderId);
    const second = await publish(orderId);

    expect(second.published).toBe(false);
    expect(second.reason).toBe("CYCLE_ALREADY_OPEN");
    expect(groupCards()).toHaveLength(1);
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from unsubscribed_negotiations where order_id = ${orderId}
    `;
    expect(rows[0]?.count).toBe("1");
  });

  it("NEG-SELECT-01: «اختيار» ثمَّ «إعادة فتح الطلب لسائق آخر» ينقلُ إلى التالي، ثمَّ اختيارُه فالاتفاق", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const second = await unsubscribedDriver(DRIVER_CHATS[1], "خالد الزهراني", "0502222222");
    const orderId = await searchingOrder();
    const report = await publish(orderId);
    const negotiationId = report.negotiationId ?? "";
    await post("driver", groupCallback(DRIVER_CHATS[0], `unsub:claim:${negotiationId}`));
    await post("driver", groupCallback(DRIVER_CHATS[1], `unsub:claim:${negotiationId}`));

    // الأوّلُ يُختارُ فتُفتحُ المحادثةُ والطلبُ «جاري الاتفاق»؛ والثاني ينتظرُ وزرُّ الإنهاءِ معه.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${negotiationId}:1`));
    await deliverQueued();
    const waiting = driverSent.find(
      (m) =>
        m.chatId === String(DRIVER_CHATS[1]) &&
        m.text === ar("negotiation.claim_registered_waiting", { position: 2 }),
    );
    expect(JSON.stringify(waiting?.markup ?? null)).toContain(`unsub:leave:${negotiationId}`);

    // لم يتّفقا: «إعادة فتح الطلب لسائق آخر» من بطاقةِ المحادثةِ.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:reopen:${negotiationId}:1`));
    await deliverQueued();
    const toFirst = driverSent.filter((m) => m.chatId === String(DRIVER_CHATS[0]));
    expect(toFirst.at(-1)?.text).toBe(ar("negotiation.driver_turn_closed_declined"));
    expect(toFirst.at(-1)?.text).not.toContain("رفض");
    const presentedSecond = riderSent.find((m) =>
      m.text.startsWith(ar("negotiation.rider_presented", { position: 2 })),
    );
    expect(presentedSecond).toBeDefined();
    expect(JSON.stringify(presentedSecond?.markup ?? null)).toContain(
      `unsub:sel:${negotiationId}:2`,
    );

    // زرُّ الأوّلِ القديمُ لا يمسُّ الثاني.
    await post("rider", privateCallback(RIDER_CHAT, `unsub:reopen:${negotiationId}:1`));
    expect(riderSent.at(-1)?.text).toBe(ar("negotiation.card_stale"));

    await post("rider", privateCallback(RIDER_CHAT, `unsub:sel:${negotiationId}:2`));
    await post("rider", privateCallback(RIDER_CHAT, `unsub:agree:${negotiationId}`));
    await deliverQueued();
    const order = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id from orders where id = ${orderId}
    `;
    expect(order[0]?.status).toBe("matched");
    expect(order[0]?.assigned_driver_id).toBe(second);
    const stuck = await sql<{ n: number }[]>`
      select count(*)::int as n from notification_outbox
       where status in ('pending', 'sending')
         and payload->>'claim_id' in (
           select id::text from unsubscribed_claims where negotiation_id = ${negotiationId})
    `;
    expect(stuck[0]?.n).toBe(0);
  });

  it("ORDER-OFFER-01: بطاقةُ القروبِ تعرضُ «المدفوع» — مبلغُ الراكبِ أو «قابل للتفاوض»", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    // طلبٌ أقدمُ من `WR-05` (`rider_offer_mode` null) يبقى بنصِّه القديم. والطلبُ الجديدُ
    // يُكتَبُ `open`، فالمبلغُ يُضافُ مع إزالةِ السياسةِ وإلّا ردَّه قيدُ `orders_rider_offer_mode_valid`.
    await sql`update orders set rider_offer_mode = null, rider_offer_sar = 40 where id = ${orderId}`;
    await publish(orderId);
    const card = groupCards().at(-1)?.text ?? "";
    expect(card).toContain(ar("driver.offer_card_paid", { amount: 40 }));
    expect(card).not.toContain(ar("driver.offer_card_paid_negotiable"));
  });

  it("WR-05: بطاقةُ القروبِ تعرضُ معنى المبلغ — «سعر محدد — غير قابل للتفاوض»", async () => {
    await unsubscribedDriver(DRIVER_CHATS[0], "أحمد العمري", "0501111111");
    const orderId = await searchingOrder();
    await sql`update orders set rider_offer_mode = 'fixed', rider_offer_sar = 55 where id = ${orderId}`;
    await publish(orderId);
    const card = groupCards().at(-1)?.text ?? "";
    expect(card).toContain(ar("driver.offer_card_terms_fixed", { amount: 55 }));
    expect(card).toContain("غير قابل للتفاوض");
    expect(card).not.toContain(ar("driver.offer_card_paid_negotiable"));
  });

  it("ORDER-OFFER-01: الغلافُ يكتبُ المبلغَ في الصفِّ الجديدِ وحدَه، ويُسقطُ ما خارجَ الحدود", async () => {
    await post("rider", text(RIDER_CHAT, "/start"));
    await post("rider", text(RIDER_CHAT, "سالم الحربي"));
    await post("rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
    const call = (key: string, offer: number) => sql<
      { r: { ok: boolean; order_id?: string; reused?: boolean } }[]
    >`
      select request_ride_with_terms(
        ${RIDER_CHAT}::bigint, ${key}::text, 'transport'::service_type,
        ${PICKUP.latitude}::float8, ${PICKUP.longitude}::float8,
        ${DROPOFF.latitude}::float8, ${DROPOFF.longitude}::float8,
        null::text, null::text, null::text, null::timestamptz, ${offer}::integer
      ) as r
    `;
    const first = (await call("offer-key-1", 40))[0]?.r;
    expect(first?.ok).toBe(true);
    const again = (await call("offer-key-1", 99))[0]?.r;
    expect(again?.reused).toBe(true);
    const rows = await sql<{ rider_offer_sar: number | null }[]>`
      select rider_offer_sar from orders where id = ${first?.order_id ?? ""}
    `;
    expect(rows[0]?.rider_offer_sar).toBe(40);
  });
});
