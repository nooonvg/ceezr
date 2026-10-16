/**
 * الغرض: قياسُ **عددِ رسائلِ تيليجرام في رحلةٍ واحدةٍ** على السِلكِ — البندُ
 *   `ECO-003` (§17). لا يُقدَّرُ العددُ ولا يُستنبَطُ من قراءةِ شيفرةٍ: تُدارُ رحلةٌ
 *   كاملةٌ من الطلبِ إلى التقييمِ عبرَ الـwebhook الحقيقيِّ وبوّابةٍ من
 *   `buildContainer` وقاعدةِ PostgreSQL حقيقيّةٍ، وتُسنَدُ كلُّ رسالةٍ تخرجُ من
 *   مُرسِلِ البوتَينِ إلى **التحديثِ الذي كانَ يُعالَجُ** حينَ خرجَت ومَن أرسلَه،
 *   ثمَّ يُقابَلُ الناتجُ بحَكَمِ `scripts/lib/telegram-message-budget.ts`.
 *
 *   والإسنادُ هوَ جوهرُ القياسِ لا تفصيلٌ فيه: بغيرِه لا تُفرَّقُ **رسالةُ دفعٍ**
 *   (تخرجُ إلى طرفٍ لم يطلبْها، وتتوسَّعُ بعددِ السائقينَ، وهيَ وحدَها التي
 *   تصطدمُ بحدِّ `TG-001`) عن **ردِّ حوارٍ** (مشدودٍ إلى تحديثٍ واحدٍ، لا
 *   يتوسَّعُ) — فيصيرُ الرقمُ إجماليّاً لا يُقرأُ منه خطرٌ ولا فاتورةٌ.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI (خدمة postgis)، وأيُّ تغييرٍ يضيفُ إشعاراً في
 *   دورةِ حياةِ الرحلةِ أو يوسِّعُ بثَّ العروضِ.
 *
 * ما لا يقيسُه هذا الملفُّ عن قصدٍ: **لا سعرَ ولا نجومَ**. تمكينُ البثِّ المدفوعِ
 *   وسعرُه قرارُ مالكٍ محجوزٌ بـ`DEC-04` (`[!]`)، والقياسُ ههنا عددٌ لا مالٌ.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createServer } from "../../apps/gateway/src/server.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import type { AppConfig } from "../../packages/shared/config/index.ts";
import {
  NOTIFICATION_KINDS,
  SEEDED_NOTIFICATION_CHANNELS,
} from "../../packages/shared/config/notification-kinds.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import {
  judgeTelegramMessages,
  type MeasuredMessage,
  pushMessageBudget,
  pushMessages,
  RIDE_MESSAGE_PROFILE,
  replyMessages,
  rideMessageBudget,
  summarizeTelegramMessages,
  TELEGRAM_FREE_RATE_PER_SECOND,
  type TelegramMessageFacts,
} from "../../scripts/lib/telegram-message-budget.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "integration-secret";
const DRIVER_CHAT = 470_001;
const RIDER_CHAT = 470_201;
const DRIVER_NAME = "سعيد السائق";
const RIDER_NAME = "منى العميلة";
const PICKUP = { latitude: 21.5471, longitude: 39.1751 };
const DROPOFF = { latitude: 21.5601, longitude: 39.1901 };

/** عددُ الأنواعِ المُعلَنةِ `critical` — مقروءٌ من مصدرِه الواحدِ لا مكتوباً رقماً. */
const DECLARED_CRITICAL_KINDS = NOTIFICATION_KINDS.filter(
  (kind) => SEEDED_NOTIFICATION_CHANNELS[kind] === "critical",
).length;

const config: AppConfig = testConfig({ port: 3991, telegramWebhookSecret: WEBHOOK_SECRET });

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;

/**
 * سياقُ المعالجةِ الجاري — يُضبَطُ قبلَ كلِّ تحديثٍ وارِدٍ ويُقرأُ في المُرسِلِ.
 * وبه يُسنَدُ كلُّ خروجٍ إلى سببِه: مَن أرسلَ التحديثَ وما تسلسلُه. وخارجَ
 * معالجةِ تحديثٍ (تفريغُ صندوقِ الصادرِ) يكونُ `null` — فذاكَ دفعٌ بلا طالبٍ.
 */
let context: { readonly from: string; readonly index: number } | null = null;
let recorded: MeasuredMessage[];
let counting = false;

/**
 * مُرسِلٌ يعُدُّ ويُسنِدُ. ولا يُصنَّفُ السببُ ههنا بالتخمينِ: ما خرجَ خارجَ
 * معالجةِ تحديثٍ بثٌّ، وما خرجَ إلى غيرِ مُرسِلِ التحديثِ دفعُ دورةِ حياةٍ —
 * ويُمَيَّزُ طلبُ التقييمِ بنصِّه المُعلَنِ في `i18n` لا بموضعِه في التسلسلِ.
 */
function recordingSender(party: string): TelegramSender {
  const push = (text: string): string => {
    if (counting) {
      recorded.push({
        party,
        duringUpdateFrom: context?.from ?? null,
        updateIndex: context?.index ?? null,
        cause: causeOf(party, text),
      });
    }
    return String(recorded.length + 1);
  };
  return {
    sendMessage: async (_chatId, text) => push(text),
    sendPhoto: async (_chatId, _fileId, caption) => push(caption),
    sendLocation: async () => push(""),
  };
}

const ratingPromptTexts = [
  translate("ar", "rating.ask_rating_driver", { driver: DRIVER_NAME }),
  translate("ar", "rating.ask_rating_rider", { rider: RIDER_NAME }),
];

function causeOf(party: string, text: string): string {
  if (context === null) return "offer.broadcast";
  if (context.from === party) return "dialog.reply";
  if (ratingPromptTexts.some((prompt) => text === prompt)) return "rating.prompt";
  return "lifecycle.transition";
}

async function post(bot: string, from: string, update: unknown): Promise<Response> {
  context = { from, index: ++updateIdCounter };
  try {
    return await app.fetch(
      new Request(`http://localhost/webhook/telegram/${bot}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
        },
        body: JSON.stringify(update),
      }),
    );
  } finally {
    context = null;
  }
}

let updateIdCounter = 0;
const message = (chatId: number, body: Record<string, unknown>) => ({
  update_id: ++updateIdCounter,
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
  update_id: ++updateIdCounter,
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("ميزانُ رسائلِ تيليجرام في رحلةٍ واحدةٍ (ECO-003)", () => {
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
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             notification_outbox, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             driver_location_history, drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             notification_outbox, order_offers, orders,
                             subscriptions, driver_capabilities, driver_availability,
                             driver_location_history, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: "-1001", escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    recorded = [];
    counting = false;
    container = buildContainer(config, {
      driverSender: recordingSender("driver"),
      riderSender: recordingSender("rider"),
    });
    app = createServer({
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: WEBHOOK_SECRET, handler: container.handler },
    });
  });

  /** سائقٌ مسجَّلٌ متحقَّقٌ متاحٌ له موقعٌ — أدنى حالٍ يصلُه فيها عرضٌ. */
  async function registerDriver(): Promise<string> {
    await post("driver", "driver", text(DRIVER_CHAT, "/start"));
    await post("driver", "driver", text(DRIVER_CHAT, DRIVER_NAME));
    await post("driver", "driver", contact(DRIVER_CHAT, "+966500000101"));
    await post("driver", "driver", privateCallback(DRIVER_CHAT, `city:${cityId}`));
    await post("driver", "driver", privateCallback(DRIVER_CHAT, "service:transport"));
    await post("driver", "driver", privateCallback(DRIVER_CHAT, "vehicle:sedan"));
    await post("driver", "driver", text(DRIVER_CHAT, "أ ب ج 1234"));
    await post("driver", "driver", text(DRIVER_CHAT, "1000470001"));
    await post("driver", "driver", photo(DRIVER_CHAT, "vphoto_470001"));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id
       where u.telegram_id = ${DRIVER_CHAT}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error("لم يُسجَّل السائق");
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, 'transport') as result`;
    await post("driver", "driver", text(DRIVER_CHAT, "/available"));
    await post("driver", "driver", location(DRIVER_CHAT, PICKUP));
    return driverId;
  }

  async function registerRider(): Promise<void> {
    await post("rider", "rider", text(RIDER_CHAT, "/start"));
    await post("rider", "rider", text(RIDER_CHAT, RIDER_NAME));
    await post("rider", "rider", contact(RIDER_CHAT, "+966500000201"));
    await post("rider", "rider", privateCallback(RIDER_CHAT, `city:${cityId}`));
  }

  it("يعدُّ كلَّ رسالةٍ في رحلةٍ كاملةٍ ويُسنِدُها، فلا يتجاوزُ السقفَ المُشتَقَّ", async () => {
    await registerDriver();
    await registerRider();

    /**
     * نافذةُ القياسِ تبدأُ ههنا: التسجيلُ ليسَ من الرحلةِ، وعدُّه يخلطُ كلفةَ
     * اكتسابِ مستخدمٍ **مرّةً واحدةً في عمرِه** بكلفةِ رحلةٍ تتكرَّرُ كلَّ يومٍ.
     */
    counting = true;
    let inboundUpdates = 0;
    const drive = async (bot: string, from: string, update: unknown): Promise<void> => {
      inboundUpdates += 1;
      await post(bot, from, update);
    };

    await drive("rider", "rider", text(RIDER_CHAT, "/ride"));
    await drive("rider", "rider", location(RIDER_CHAT, PICKUP));
    await drive("rider", "rider", location(RIDER_CHAT, DROPOFF));

    /**
     * تفريغُ صندوقِ الصادرِ كما يفعلُه عاملُ التسليمِ في الإنتاج (منذُ BUG-004
     * لا يُرسَلُ إشعارُ العرضِ متزامناً). ويقعُ **خارجَ سياقِ أيِّ تحديثٍ** —
     * وذاكَ صدقُ الإسنادِ لا حيلةٌ فيه: البثُّ فعلاً لا يقعُ ردّاً على أحدٍ.
     */
    await drainNotificationOutbox(sql, recordingSender("driver"));

    const orders = await sql<{ id: string }[]>`
      select id from orders order by created_at desc limit 1
    `;
    const orderId = orders[0]?.id;
    if (orderId === undefined) throw new Error("لم يُنشأ الطلب");

    await drive("driver", "driver", privateCallback(DRIVER_CHAT, `offer:accept:${orderId}`));
    await drive("driver", "driver", privateCallback(DRIVER_CHAT, `ride:start:${orderId}`));
    await drive("driver", "driver", privateCallback(DRIVER_CHAT, `ride:complete:${orderId}`));
    await drive("rider", "rider", privateCallback(RIDER_CHAT, `rate:5:${orderId}`));
    await drive("driver", "driver", privateCallback(DRIVER_CHAT, `rate:5:${orderId}`));
    counting = false;

    // الرحلةُ اكتملَت فعلاً — وإلّا فالقياسُ على مسارٍ مقطوعٍ لا على رحلةٍ.
    const [finished] = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}
    `;
    expect(finished?.status).toBe("completed");
    const ratings = await sql<{ id: string }[]>`select id from ratings`;
    expect(ratings).toHaveLength(2);

    const facts: TelegramMessageFacts = {
      measured: true,
      inboundUpdateCount: inboundUpdates,
      messages: recorded,
      driverMessageCount: recorded.filter((m) => m.party === "driver").length,
      riderMessageCount: recorded.filter((m) => m.party === "rider").length,
      criticalKindCount: DECLARED_CRITICAL_KINDS,
    };

    const budget = pushMessageBudget(RIDE_MESSAGE_PROFILE);
    const violations = judgeTelegramMessages({
      facts,
      profile: RIDE_MESSAGE_PROFILE,
      budget,
      declaredCriticalKindCount: DECLARED_CRITICAL_KINDS,
    });
    expect(violations).toEqual([]);

    // البثُّ وقعَ فعلاً: قياسٌ بلا رسالةِ دفعٍ واحدةٍ يقيسُ حواراً لا رحلةً.
    const pushed = pushMessages(recorded);
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed.filter((m) => m.cause === "offer.broadcast")).toHaveLength(
      RIDE_MESSAGE_PROFILE.offeredDriverCount * RIDE_MESSAGE_PROFILE.broadcastRoundCount,
    );
    // انتقالاتُ دورةِ الحياةِ الثلاثةُ وصلَت الطرفَ المقابلَ كلُّها.
    expect(pushed.filter((m) => m.cause === "lifecycle.transition")).toHaveLength(
      RIDE_MESSAGE_PROFILE.crossPartyTransitionCount,
    );
    expect(pushed.filter((m) => m.cause === "rating.prompt")).toHaveLength(
      RIDE_MESSAGE_PROFILE.pushedRatingPromptCount,
    );
    expect(pushed).toHaveLength(budget);

    // وكلُّ ما بقيَ ردُّ حوارٍ مشدودٌ إلى تحديثٍ من صاحبِه.
    const replies = replyMessages(recorded);
    expect(replies.length + pushed.length).toBe(recorded.length);
    for (const reply of replies) expect(reply.duringUpdateFrom).toBe(reply.party);

    // وإجماليُّ الرحلةِ دونَ سقفِها المُشتَقِّ ودونَ حدِّ TG-001.
    expect(recorded.length).toBeLessThanOrEqual(rideMessageBudget(inboundUpdates));
    expect(recorded.length).toBeLessThanOrEqual(TELEGRAM_FREE_RATE_PER_SECOND);

    console.log(`📊 ECO-003 — ${summarizeTelegramMessages(facts, budget)}`);
  });

  /**
   * والنصفُ الثاني من الدعوى: **رسالةُ الدفعِ هيَ التي تتوسَّعُ**. سائقانِ
   * مؤهَّلانِ يُنتِجانِ ضِعفَ نصيبِ البثِّ من حدثٍ واحدٍ، وردودُ الحوارِ لا تتغيَّرُ.
   * فمن قرأَ الإجماليَّ وحدَه لم يرَ أيَّ نصفٍ ينمو — وهذا الاختبارُ يُظهِرُه قياساً.
   */
  it("نصيبُ البثِّ ينمو بعددِ السائقينَ المؤهَّلينَ لا بعددِ رسائلِ الحوارِ", async () => {
    await registerDriver();
    const secondChat = 470_002;
    await post("driver", "driver", text(secondChat, "/start"));
    await post("driver", "driver", text(secondChat, "خالد الثاني"));
    await post("driver", "driver", contact(secondChat, "+966500000102"));
    await post("driver", "driver", privateCallback(secondChat, `city:${cityId}`));
    await post("driver", "driver", privateCallback(secondChat, "service:transport"));
    await post("driver", "driver", privateCallback(secondChat, "vehicle:sedan"));
    await post("driver", "driver", text(secondChat, "أ ب ج 5678"));
    await post("driver", "driver", text(secondChat, "1000470002"));
    await post("driver", "driver", photo(secondChat, "vphoto_470002"));
    const second = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${secondChat}
    `;
    const secondId = second[0]?.id ?? "";
    await sql`update drivers set verification_status = 'verified' where id = ${secondId}`;
    await sql`select start_trial(${secondId}::uuid, 'transport') as result`;
    await post("driver", "driver", text(secondChat, "/available"));
    await post("driver", "driver", location(secondChat, DROPOFF));
    await registerRider();

    counting = true;
    await post("rider", "rider", text(RIDER_CHAT, "/ride"));
    await post("rider", "rider", location(RIDER_CHAT, PICKUP));
    await post("rider", "rider", location(RIDER_CHAT, DROPOFF));
    await drainNotificationOutbox(sql, recordingSender("driver"));
    counting = false;

    const offers = await sql<{ id: string }[]>`select id from order_offers`;
    expect(offers).toHaveLength(2);
    const broadcast = recorded.filter((m) => m.cause === "offer.broadcast");
    // سائقانِ = رسالتا بثٍّ من حدثٍ واحدٍ: النموُّ خطّيٌّ في السائقينَ قياساً.
    expect(broadcast).toHaveLength(2);
    expect(broadcast.length).toBe(
      2 * RIDE_MESSAGE_PROFILE.offeredDriverCount * RIDE_MESSAGE_PROFILE.broadcastRoundCount,
    );
    for (const message of broadcast) expect(message.duringUpdateFrom).toBeNull();
  });
});
