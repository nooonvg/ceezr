/**
 * الغرض: `WR-19` — دورةُ التوصيلِ مثلَ المشوار، من البدايةِ إلى النهايةِ على قاعدةٍ حقيقيّة:
 *   راكبٌ يطلبُ توصيلًا ببوتِه **بلا وصفِ طرد** (`/skip`) ← التوزيعُ الحقيقيُّ يكتبُ عرضًا لمندوبِ
 *   التوصيلِ وحدَه وبطاقتُه تُسلَّمُ بزرِّ قبول ← المندوبُ يقبلُ ← يُحجَزُ مرشَّحًا بمهلةِ 15 ثانية
 *   (`WR-09`) ← الراكبُ يقبلُه ← المحادثةُ الخاصّةُ في الاتّجاهين بلا تكرارٍ ولا طرفٍ ثالث
 *   (`WR-04`) ← وصلَ ← بدأ ← أكمل (والإكمالُ الثاني بلا أثر) ← المحادثةُ تُقرأُ ولا تُكتَب ←
 *   التقييمُ مرّةً واحدة ← ولا إلغاءَ بعدَ الإكمال (`WR-22`).
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
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
import { drainNotificationOutbox } from "../support/drain-notification-outbox.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "wr19-delivery-cycle";
const COURIER_CHAT = 119_001;
const TRANSPORT_CHAT = 119_002;
const RIDER_CHAT = 219_001;
const STRANGER_CHAT = 219_002;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const COURIER_AT = { latitude: 21.5471, longitude: 39.1751 };

type Payload = Record<string, unknown>;

const config: AppConfig = testConfig({ port: 3994, telegramWebhookSecret: WEBHOOK_SECRET });

let sql: Sql;
let app: ReturnType<typeof createServer>;
let container: ReturnType<typeof buildContainer>;
let driverSent: SentMessage[];
let riderSent: SentMessage[];
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let previousWindow: unknown = null;

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

let updateId = 0;
const message = (chatId: number, body: Record<string, unknown>) => ({
  update_id: ++updateId,
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
  update_id: ++updateId,
  callback_query: { data, from: { id: chatId }, message: { chat: { id: chatId } } },
});

async function one(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّة");
  return row.result;
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  دورةُ التوصيلِ مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

describeIf("WR-19 — دورةُ التوصيلِ كاملةً على قاعدةٍ حقيقيّة", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterEach(async () => {
    await (container as ReturnType<typeof buildContainer> | undefined)?.close();
  });

  afterAll(async () => {
    // تنظيفُ بياناتِ آخرِ اختبارٍ: الـbeforeEach يقتلعُ كلَّ شيءٍ قبلَ كلِّ
    // اختبارٍ لكن لا شيءَ يقتلعُه بعدَ الأخيرِ — فيبقى سائقُ التوصيلِ (وغيرُه)
    // يلوّثُ الملفاتَ التاليةَ (quote ترى `delivery` في خدماتِ المدينةِ).
    await sql`
      truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_message_reads, order_messages, notification_outbox,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    if (previousWindow !== null) {
      await sql`
        update platform_settings set value = ${sql.json(previousWindow as never)}
         where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    }
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log,
                             order_message_reads, order_messages, notification_outbox,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, {
      groups: { support: -1001, escalation: -1002, unsubscribed: -1003 },
      prior: cityHandle,
    });
    cityId = cityHandle.cityId;
    const prev = await sql<{ value: unknown }[]>`
      select value from platform_settings
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    if (prev[0] === undefined) throw new Error("الإعدادُ rider_choice_window_seconds غيرُ مبذور");
    if (previousWindow === null) previousWindow = prev[0].value;
    // المهلةُ المعتمدةُ في الإنتاجِ للمدنِ الخمس (`WR-09`).
    await sql`
      update platform_settings set value = to_jsonb(15)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
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

  async function readyDriver(
    chatId: number,
    fullName: string,
    phone: string,
    service: "transport" | "delivery",
    at: { latitude: number; longitude: number },
  ): Promise<string> {
    await post("driver", text(chatId, "/start"));
    await post("driver", text(chatId, fullName));
    await post("driver", contact(chatId, phone));
    await post("driver", callback(chatId, `city:${cityId}`));
    await post("driver", callback(chatId, `service:${service}`));
    await post("driver", callback(chatId, "vehicle:sedan"));
    await post("driver", text(chatId, "أ ب ج 1234"));
    await post("driver", text(chatId, `1${String(chatId).slice(-9).padStart(9, "0")}`));
    await post("driver", photo(chatId, `vphoto_${chatId}`));
    const rows = await sql<{ id: string }[]>`
      select d.id from drivers d join users u on u.id = d.user_id where u.telegram_id = ${chatId}
    `;
    const driverId = rows[0]?.id;
    if (driverId === undefined) throw new Error(`لم يُسجَّل السائق ${chatId}`);
    await sql`update drivers set verification_status = 'verified' where id = ${driverId}`;
    await sql`select start_trial(${driverId}::uuid, ${service}::subscription_plan) as result`;
    await post("driver", text(chatId, "/available"));
    await post("driver", location(chatId, at));
    return driverId;
  }

  async function registerRider(chatId: number, name: string): Promise<string> {
    await post("rider", text(chatId, "/start"));
    await post("rider", text(chatId, name));
    await post("rider", callback(chatId, `city:${cityId}`));
    const rows = await sql<{ id: string }[]>`
      select r.id from riders r join users u on u.id = r.user_id where u.telegram_id = ${chatId}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("لم يُسجَّل العميل");
    return id;
  }

  const chat = (tg: number, orderId: string, clientId: string, body: string) =>
    one(sql<{ result: Payload }[]>`
      select post_order_message(${tg}::bigint, ${orderId}::uuid, ${clientId}::uuid, ${body}) as result`);
  const listChat = (tg: number, orderId: string) =>
    one(sql<{ result: Payload }[]>`
      select list_order_messages(${tg}::bigint, ${orderId}::uuid, 0::bigint, 200) as result`);
  const driverStep = (fn: "arrived" | "start" | "complete", orderId: string) =>
    fn === "arrived"
      ? one(sql<{ result: Payload }[]>`
          select driver_mark_arrived(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result`)
      : fn === "start"
        ? one(sql<{ result: Payload }[]>`
            select driver_start_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result`)
        : one(sql<{ result: Payload }[]>`
            select driver_complete_ride(${COURIER_CHAT}::bigint, ${orderId}::uuid) as result`);

  it("طلبٌ بلا وصفِ طرد ← عرضٌ للمندوب ← قبول ← اختيارُ الراكب ← محادثة ← إكمال ← تقييم", async () => {
    const transportId = await readyDriver(
      TRANSPORT_CHAT,
      "خالد الزهراني",
      "0559876543",
      "transport",
      PICKUP,
    );
    const courierId = await readyDriver(
      COURIER_CHAT,
      "أحمد العمري",
      "0501234567",
      "delivery",
      COURIER_AT,
    );
    const riderId = await registerRider(RIDER_CHAT, "سالم الحربي");
    await registerRider(STRANGER_CHAT, "طرفٌ ثالث");
    driverSent.length = 0;

    // ١) الطلبُ ببوتِ الراكب، و`/skip` في خطوةِ الوصف (`WR-18`).
    await post("rider", callback(RIDER_CHAT, "svc:delivery"));
    await post("rider", location(RIDER_CHAT, PICKUP));
    await post("rider", location(RIDER_CHAT, DROPOFF));
    await post("rider", text(RIDER_CHAT, "/skip"));

    const orders = await sql<
      { id: string; service: string; status: string; notes: string | null; has_dropoff: boolean }[]
    >`select id, service::text, status::text, notes, dropoff is not null as has_dropoff
        from orders where rider_id = ${riderId}::uuid`;
    expect(orders).toHaveLength(1);
    const order = orders[0];
    if (order === undefined) throw new Error("لم يُنشأ الطلب");
    expect(order).toMatchObject({
      service: "delivery",
      status: "searching",
      notes: null,
      has_dropoff: true,
    });
    const orderId = order.id;

    // ٢) التوزيعُ الحقيقيُّ: عرضٌ لمندوبِ التوصيلِ وحدَه، والبطاقةُ تُسلَّمُ بزرِّ قبول.
    const offers = await sql<{ id: string; driver_id: string; status: string }[]>`
      select id, driver_id::text, status::text from order_offers where order_id = ${orderId}::uuid`;
    expect(offers.map((o) => o.driver_id)).toEqual([courierId]);
    expect(offers.map((o) => o.driver_id)).not.toContain(transportId);
    await drainNotificationOutbox(sql, capturing(driverSent));
    // `ADR 0286` — البطاقةُ إشعارٌ لا زرَّ قبولٍ في البوتِ: الاكتشافُ والقبولُ في
    // لوحِ عروضِ التطبيقِ، وفي وضعِ `legacy` الاختباريِّ بلا زرٍّ أصلًا. فتُوجدُ
    // البطاقةُ نصًّا، وبطاقتُها بلا زرِّ `offer:` يعودُ إليها.
    const card = driverSent.find(
      (m) =>
        (m.text ?? "").includes(translate("ar", "driver.offer_card_service_delivery")) ||
        (m.text ?? "").includes("الخدمة:"),
    );
    expect(card).toBeDefined();
    expect(JSON.stringify(card?.markup ?? null)).not.toContain("offer:");
    expect(card?.text ?? "").not.toMatch(/undefined|null/);
    // `WR-08`: البطاقةُ تقولُ الخدمة (سقطَت من حمولةِ المُطالِبِ منذُ 2026-09-21 وأُعيدَت في
    // `20261012200100`)، وبلا مبلغٍ تقولُ إنَّ الاتّفاقَ في المحادثة (`WR-05`).
    expect(card?.text ?? "").toContain(translate("ar", "driver.offer_card_service_delivery"));
    expect(card?.text ?? "").toContain(translate("ar", "driver.offer_card_terms_open"));

    // ٣) المندوبُ يقبلُ ببوتِه: يُحجَزُ مرشَّحًا والطلبُ باقٍ في البحث، ولا إسنادَ قبلَ قرارِ الراكب.
    await post("driver", callback(COURIER_CHAT, `offer:accept:${orderId}`));
    const held = await sql<
      { status: string; candidate: string | null; assigned: string | null; left: number }[]
    >`
      select status::text, candidate_driver_id::text as candidate, assigned_driver_id::text as assigned,
             extract(epoch from candidate_expires_at - now())::float8 as left
        from orders where id = ${orderId}::uuid`;
    expect(held[0]).toMatchObject({ status: "searching", candidate: courierId, assigned: null });
    expect(held[0]?.left ?? 0).toBeGreaterThan(10);
    expect(held[0]?.left ?? 99).toBeLessThanOrEqual(16);

    // المحادثةُ لا تُفتَحُ قبلَ الإسناد.
    const early = await chat(RIDER_CHAT, orderId, crypto.randomUUID(), "هل أنت قريب؟");
    expect(early.ok).toBe(false);

    // ٤) الراكبُ يقبلُ المرشَّح: إسنادٌ ذرّي، والقبولُ الثاني بلا أثرٍ ثانٍ.
    const decided = await one(sql<{ result: Payload }[]>`
      select rider_decide_candidate(${RIDER_CHAT}::bigint, ${orderId}::uuid, ${courierId}::uuid, true) as result`);
    expect(decided.ok).toBe(true);
    const matched = await sql<
      { status: string; assigned: string | null; candidate: string | null }[]
    >`
      select status::text, assigned_driver_id::text as assigned, candidate_driver_id::text as candidate
        from orders where id = ${orderId}::uuid`;
    expect(matched[0]).toMatchObject({ status: "matched", assigned: courierId, candidate: null });
    const again = await one(sql<{ result: Payload }[]>`
      select rider_decide_candidate(${RIDER_CHAT}::bigint, ${orderId}::uuid, ${courierId}::uuid, true) as result`);
    expect(again.ok === true ? again.duplicate : again.ok).toBeTruthy();

    // ٥) المحادثةُ في الاتّجاهين، والمعرّفُ المكرَّرُ لا يُنشئُ رسالةً ثانية، والطرفُ الثالثُ يُرَدّ.
    const riderMsg = crypto.randomUUID();
    expect((await chat(RIDER_CHAT, orderId, riderMsg, "الطرد عند البوابة")).ok).toBe(true);
    expect((await chat(RIDER_CHAT, orderId, riderMsg, "الطرد عند البوابة")).ok).toBe(true);
    expect((await chat(COURIER_CHAT, orderId, crypto.randomUUID(), "في الطريق")).ok).toBe(true);
    expect((await chat(STRANGER_CHAT, orderId, crypto.randomUUID(), "تسلّل")).ok).toBe(false);
    expect((await listChat(STRANGER_CHAT, orderId)).ok).toBe(false);
    const riderView = await listChat(RIDER_CHAT, orderId);
    const courierView = await listChat(COURIER_CHAT, orderId);
    const bodies = (p: Payload) => ((p.messages ?? []) as { body: string }[]).map((m) => m.body);
    expect(bodies(riderView)).toEqual(["الطرد عند البوابة", "في الطريق"]);
    expect(bodies(courierView)).toEqual(bodies(riderView));

    // ٦) المراحل: وصل ← بدأ ← أكمل، والإكمالُ الثاني لا يُفسدُ الحالة.
    expect((await driverStep("arrived", orderId)).ok).toBe(true);
    expect((await driverStep("start", orderId)).ok).toBe(true);
    expect((await driverStep("complete", orderId)).ok).toBe(true);
    await driverStep("complete", orderId);
    const done = await sql<{ status: string; completed: number }[]>`
      select status::text,
             (select count(*)::int from audit_log a
               where a.entity_id = ${orderId}::uuid and a.action like '%complet%') as completed
        from orders where id = ${orderId}::uuid`;
    expect(done[0]?.status).toBe("completed");
    expect(done[0]?.completed ?? 0).toBeLessThanOrEqual(1);

    // ٧) بعدَ الإكمال: المحادثةُ تُقرأُ ولا تُكتَب.
    expect((await chat(RIDER_CHAT, orderId, crypto.randomUUID(), "شكرًا")).ok).toBe(false);
    expect(bodies(await listChat(RIDER_CHAT, orderId))).toHaveLength(2);

    // ٨) التقييمُ مرّةً واحدة.
    const rated = await one(sql<{ result: Payload }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${RIDER_CHAT}::bigint, 5::smallint, null::text, null::text[]) as result`);
    expect(rated.ok).toBe(true);
    const ratedAgain = await one(sql<{ result: Payload }[]>`
      select submit_rating_with_tags(${orderId}::uuid, ${RIDER_CHAT}::bigint, 4::smallint, null::text, null::text[]) as result`);
    const ratings = await sql<{ n: number }[]>`
      select count(*)::int as n from ratings where order_id = ${orderId}::uuid`;
    expect(ratings[0]?.n).toBe(1);
    expect(ratedAgain.ok === false || ratedAgain.duplicate === true).toBe(true);

    // ٩) ولا إلغاءَ بعدَ الإكمال.
    const cancelled = await one(sql<{ result: Payload }[]>`
      select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid) as result`);
    expect(cancelled.ok).toBe(false);
    const final = await sql<
      { status: string }[]
    >`select status::text from orders where id = ${orderId}::uuid`;
    expect(final[0]?.status).toBe("completed");
  });
});
