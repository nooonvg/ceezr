/**
 * اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لأنواعِ دورةِ غيرِ المشتركينِ الثلاثةِ في صندوقِ
 *   الصادرِ الموحَّدِ (BUG-004): فتحُ الدورِ، وإغلاقُه بسببِه، والاتفاقُ. المقصودُ
 *   إثباتُ ما لا يُثبتُه mock: أنّ الإيداعَ يقعُ في معاملةِ الطلبِ نفسِها فلا صفَّ
 *   يتيمٌ إن رجعت، ولا أثرَ صادرٌ قبلَ الـcommit، وأنّ الصفَّ لمُستلِمٍ واحدٍ فلا
 *   يُعيدُ فشلُ طرفٍ إرسالَ الطرفِ الذي وصلَه أصلاً، وأنّ المحادثةَ واللغةَ تُقرآنِ
 *   حيّتَينِ لحظةَ الالتقاطِ لا لحظةَ الإيداعِ. ولا تيليجرامَ فعليٌّ هنا: المُبلِّغُ
 *   المزدوجُ يُثبتُ الوجهةَ والنوعَ والسببَ ومعرّفَ الرسالةِ.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: تُضافُ الأنواعُ الباقيةُ في شطرَيْها من الخارطة.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  createAgreedHandler,
  createTurnClosedHandler,
  createTurnOpenedHandler,
  type NegotiationMessenger,
  type NegotiationSideNotice,
  type TurnClosedReason,
} from "../../packages/application/dispatch/deliver-negotiation-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const DRIVER_ONE_TELEGRAM = 951001;
const DRIVER_TWO_TELEGRAM = 951002;
const RIDER_TELEGRAM = 951003;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;
let driverIds: string[] = [];
let negotiationId: string;

/** ما وصلَ فعلًا: النوعُ ووجهتُه ولغتُه وموضعُه وسببُه إن كان إغلاقًا. */
interface Sent {
  readonly event: "opened" | "closed" | "agreed";
  readonly side: "driver" | "rider";
  readonly chatId: string;
  readonly language: string;
  readonly position: number;
  readonly deadlineSeconds: number;
  readonly reason: TurnClosedReason | null;
}

/**
 * مُبلِّغٌ يسجّلُ ما أُرسِلَ، ويُفشِلُ جهةً معيّنةً عددًا من المرّاتِ لتُقاسَ
 * الإعادةُ على الفاشلِ وحدَه لا على مَن وصلَه.
 */
function messenger(sent: Sent[], failSide: "driver" | "rider" | null, failTimes: number) {
  let failures = 0;
  const record = (
    event: Sent["event"],
    notice: NegotiationSideNotice,
    reason: TurnClosedReason | null,
  ) => {
    if (notice.side === failSide && failures < failTimes) {
      failures += 1;
      return err(new PortFailureError("notifier.negotiation", "temporary failure"));
    }
    sent.push({
      event,
      side: notice.side,
      chatId: notice.chatId,
      language: notice.language,
      position: notice.position,
      deadlineSeconds: notice.deadlineSeconds,
      reason,
    });
    return ok(`msg-${event}-${notice.side}-${sent.length}`);
  };
  const port: NegotiationMessenger = {
    sendTurnOpened: async (notice) => record("opened", notice, null),
    sendTurnClosed: async (notice, reason) => record("closed", notice, reason),
    sendAgreed: async (notice) => record("agreed", notice, null),
  };
  return port;
}

function run(sent: Sent[], failSide: "driver" | "rider" | null = null, failTimes = 0) {
  const port = messenger(sent, failSide, failTimes);
  return deliverNotifications({
    outbox: createNotificationOutboxPort(sql),
    handlers: {
      negotiation_turn_opened: createTurnOpenedHandler(port),
      negotiation_turn_closed: createTurnClosedHandler(port),
      negotiation_agreed: createAgreedHandler(port),
    },
  });
}

async function rows(kind: string): Promise<
  {
    side: string;
    status: string;
    attempts: number;
    dedup_key: string | null;
    message: string | null;
    language: string | null;
    chat_id: string | null;
    reason: string | null;
  }[]
> {
  return await sql`
    select payload->>'side'     as side,
           status,
           attempts,
           dedup_key,
           delivered_message_id as message,
           payload->>'language' as language,
           payload->>'chat_id'  as chat_id,
           payload->>'reason'   as reason
      from notification_outbox
     where kind = ${kind}
     order by payload->>'side'
  `;
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  // تفعيلٌ وقروباتُه في عبارةٍ واحدةٍ: القروبُ شرطُ فتحِ الدورةِ، ومدينةٌ تُفعّل
  // بلا قروباتِها تجعلُ نجاحَ الاختبارِ معلّقاً على ملفٍ أسبقَ ضبطَها.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'راكبُ الصندوقِ', '+966500951003',
            'rider'::user_role, 'en')
    returning id
  `;
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser[0]?.id ?? ""}::uuid)
    returning id
  `;
  const riderId = riders[0]?.id ?? "";
  if (riderId === "") throw new Error("تعذّر تجهيز الراكب");

  driverIds = [];
  for (const telegramId of [DRIVER_ONE_TELEGRAM, DRIVER_TWO_TELEGRAM]) {
    const driverUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, role, language_code)
      values (${cityId}, ${telegramId}::bigint, ${`سائق ${telegramId}`},
              ${`+96650${telegramId}`}, 'driver'::user_role, 'ur')
      returning id
    `;
    const driver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status)
      values (${cityId}, ${driverUser[0]?.id ?? ""}::uuid, 'verified'::verification_status)
      returning id
    `;
    const created = driver[0]?.id ?? "";
    if (created === "") throw new Error("تعذّر تجهيز السائق");
    driverIds.push(created);
  }

  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
    values (${cityId}, ${riderId}::uuid, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 0)
    returning id
  `;
  orderId = orders[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذّر تجهيز الطلب");

  const cycle = await sql<{ result: { ok: boolean; negotiation_id?: string } }[]>`
    select open_unsubscribed_cycle(${orderId}::uuid) as result
  `;
  if (cycle[0]?.result.ok !== true) throw new Error("تعذّر فتحُ دورةِ غيرِ المشتركين");
  negotiationId = cycle[0]?.result.negotiation_id ?? "";
  if (negotiationId === "") throw new Error("دورةٌ بلا معرّف");

  // فتحُ الدورةِ إعدادٌ هنا لا موضوعُ قياسٍ، وهو يُودِعُ إخطارَ صاحبِ الطلبِ أيضًا.
  // ذاك النوعُ مقيسٌ في ملفِّه (`notification-outbox-unmatched`)، وبقاؤه في الصفِّ
  // يُدخِلُ صفًّا أجنبيًّا في كلِّ عدٍّ هنا. فيُنقّى الصفُّ لأنواعِ التفاوضِ وحدَها.
  await sql`delete from notification_outbox where kind = 'wider_circle_opened'`;
}

async function claim(index: number): Promise<{ ok: boolean; notifications_queued?: number }> {
  const registered = await sql<{ result: { ok: boolean; notifications_queued?: number } }[]>`
    select register_unsubscribed_claim(
      ${negotiationId}::uuid, ${driverIds[index] ?? ""}::uuid
    ) as result
  `;
  return registered[0]?.result ?? { ok: false };
}

describeIf("إخطاراتُ دورةِ غيرِ المشتركينِ في صندوقِ الصادرِ على PostgreSQL فعلية (BUG-004)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, unsubscribed_claims, unsubscribed_negotiations,
        support_tickets, subscriptions, audit_log, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, unsubscribed_claims, unsubscribed_negotiations,
        support_tickets, subscriptions, audit_log, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;
    await createFixture();
  });

  it("فتحُ الدورِ يُودِعُ صفًّا لكلِّ طرفٍ في معاملةِ التسجيلِ — ولا أثرَ صادرٌ فيها", async () => {
    const sent: Sent[] = [];
    const registered = await claim(0);
    expect(registered.ok).toBe(true);
    expect(registered.notifications_queued).toBe(2);

    // صفٌّ لكلِّ مُستلِمٍ لا صفٌّ للحادثةِ: هكذا وحدَه يكونُ لكلِّ رسالةٍ معرّفُها
    // ومحاولاتُها، ولا يُعيدُ فشلُ طرفٍ إرسالَ الآخر.
    const queued = await rows("negotiation_turn_opened");
    expect(queued.map((row) => row.side)).toEqual(["driver", "rider"]);
    expect(queued.every((row) => row.status === "pending" && row.attempts === 0)).toBe(true);
    const claimRow = await sql<{ id: string }[]>`
      select id from unsubscribed_claims where negotiation_id = ${negotiationId}::uuid
    `;
    const claimId = claimRow[0]?.id ?? "";
    expect(queued.map((row) => row.dedup_key).sort()).toEqual([
      `negotiation_turn_opened:${claimId}:driver`,
      `negotiation_turn_opened:${claimId}:rider`,
    ]);
    // ولا رسالةَ خرجت من مسارِ الضغطةِ: الأثرُ الصادرُ بعدَ الـcommit ومن العاملِ.
    expect(sent).toHaveLength(0);
  });

  it("رجوعُ المعاملةِ لا يُتركُ صفًّا يتيمًا: لا إخطارَ بدورٍ لم يُفتح", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      await holder
        .begin(async (tx) => {
          const registered = await tx<{ result: { ok: boolean } }[]>`
            select register_unsubscribed_claim(
              ${negotiationId}::uuid, ${driverIds[0] ?? ""}::uuid
            ) as result
          `;
          expect(registered[0]?.result.ok).toBe(true);
          // التسجيلُ نجحَ ثمّ تُرجَعُ المعاملةُ: لو كان الإخطارُ أثرًا صادرًا لحظتَها
          // لَبَلَغَ سائقًا وراكبًا عن دورٍ لا وجودَ له بعدَ الرجوع.
          throw new Error("rollback");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("rollback");
        });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect(await rows("negotiation_turn_opened")).toHaveLength(0);
    const claims = await sql<{ count: string }[]>`
      select count(*)::text as count from unsubscribed_claims
       where negotiation_id = ${negotiationId}::uuid
    `;
    expect(claims[0]?.count).toBe("0");
  });

  it("فشلُ جانبٍ يُعادُ وحدَه: مَن وصلَه الإخطارُ لا يصلُه ثانيةً", async () => {
    expect((await claim(0)).ok).toBe(true);

    const sent: Sent[] = [];
    const first = await run(sent, "rider", 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.delivered).toBe(1);
    expect(first.value.failed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.side).toBe("driver");
    expect(sent[0]?.chatId).toBe(String(DRIVER_ONE_TELEGRAM));
    // لغةُ كلِّ طرفٍ لغتُه هو كما قرأتها القاعدةُ حيّةً: السائقُ بالأردية.
    expect(sent[0]?.language).toBe("ur");
    expect(sent[0]?.position).toBe(1);
    expect(sent[0]?.deadlineSeconds).toBeGreaterThan(0);

    const afterFirst = await rows("negotiation_turn_opened");
    expect(afterFirst[0]?.status).toBe("delivered");
    expect(afterFirst[0]?.message).not.toBeNull();
    expect(afterFirst[1]?.status).toBe("pending");
    expect(afterFirst[1]?.attempts).toBe(1);

    await sql`
      update notification_outbox set next_attempt_at = now() - interval '1 second'
       where kind = 'negotiation_turn_opened' and status = 'pending'
    `;
    const second = await run(sent);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.delivered).toBe(1);
    // الرسالتانِ اثنتانِ لا ثلاثٌ: الإعادةُ مسّت الفاشلَ وحدَه.
    expect(sent).toHaveLength(2);
    expect(sent[1]?.side).toBe("rider");
    expect(sent[1]?.chatId).toBe(String(RIDER_TELEGRAM));
    expect(sent[1]?.language).toBe("en");

    const settled = await rows("negotiation_turn_opened");
    expect(settled.every((row) => row.status === "delivered")).toBe(true);
    // شوطٌ ثالثٌ لا يجدُ صفًّا ولا يُرسِلُ شيئًا.
    const third = await run(sent);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.claimed).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("المحادثةُ واللغةُ تُقرآنِ لحظةَ الالتقاطِ لا لحظةَ الإيداعِ", async () => {
    expect((await claim(0)).ok).toBe(true);
    // الحمولةُ المودَعةُ لا تحملُ محادثةً ولا لغةً: الإغناءُ في الالتقاطِ.
    const queued = await rows("negotiation_turn_opened");
    expect(queued.every((row) => row.chat_id === null && row.language === null)).toBe(true);

    // ثمّ يُغيّرُ السائقُ لغتَه ومحادثتَه بينَ الإيداعِ والتسليمِ.
    await sql`
      update users set language_code = 'en', telegram_id = ${DRIVER_ONE_TELEGRAM + 500}::bigint
       where telegram_id = ${DRIVER_ONE_TELEGRAM}::bigint
    `;
    const sent: Sent[] = [];
    const report = await run(sent);
    expect(report.ok).toBe(true);
    const driverMessage = sent.find((message) => message.side === "driver");
    expect(driverMessage?.language).toBe("en");
    expect(driverMessage?.chatId).toBe(String(DRIVER_ONE_TELEGRAM + 500));
  });

  it("التدويرُ يُودِعُ إغلاقًا بسببِه وفتحًا لمن بعدَه في معاملةٍ واحدةٍ", async () => {
    expect((await claim(0)).ok).toBe(true);
    expect((await claim(1)).ok).toBe(true);
    await sql`delete from notification_outbox`;

    const advanced = await sql<{ result: { ok: boolean; notifications_queued?: number } }[]>`
      select advance_unsubscribed_negotiation(${negotiationId}::uuid, 'expired') as result
    `;
    expect(advanced[0]?.result.ok).toBe(true);
    expect(advanced[0]?.result.notifications_queued).toBe(4);

    const closed = await rows("negotiation_turn_closed");
    expect(closed.map((row) => row.side)).toEqual(["driver", "rider"]);
    // السببُ في الحمولةِ لا في نصٍّ مُخترَعٍ: بلا سببٍ صحيحٍ يُهجَرُ الصفُّ.
    expect(closed.every((row) => row.reason === "expired")).toBe(true);
    expect(await rows("negotiation_turn_opened")).toHaveLength(2);

    const sent: Sent[] = [];
    let guard = 0;
    while (guard < 6) {
      const report = await run(sent);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      if (report.value.claimed === 0) break;
      guard += 1;
    }
    expect(sent.filter((message) => message.event === "closed")).toHaveLength(2);
    const opened = sent.filter((message) => message.event === "opened");
    expect(opened).toHaveLength(2);
    // الدورُ الثاني موضعُه الثاني، ووجهةُ سائقِه سائقُ الدورِ الجديدِ لا القديم.
    expect(opened.every((message) => message.position === 2)).toBe(true);
    expect(opened.some((message) => message.chatId === String(DRIVER_TWO_TELEGRAM))).toBe(true);
    expect(sent.find((message) => message.event === "closed")?.reason).toBe("expired");
  });

  it("الاتفاقُ يُودَعُ في معاملةِ الإسنادِ نفسِها ويُسلَّمُ للطرفَينِ", async () => {
    expect((await claim(0)).ok).toBe(true);
    await sql`delete from notification_outbox`;

    const settled = await sql<{ result: { ok: boolean; notifications_queued?: number } }[]>`
      select settle_unsubscribed_negotiation(${negotiationId}::uuid) as result
    `;
    expect(settled[0]?.result.ok).toBe(true);
    expect(settled[0]?.result.notifications_queued).toBe(2);

    // الطلبُ صارَ مُسنَدًا والإخطارُ مودَعٌ معه: لا راكبٌ له سائقٌ لا يعلمُ باتفاقِه.
    const order = await sql<{ status: string; driver: string | null }[]>`
      select status::text as status, assigned_driver_id as driver from orders
       where id = ${orderId}::uuid
    `;
    expect(order[0]?.status).toBe("matched");
    expect(order[0]?.driver).toBe(driverIds[0] ?? "");

    const sent: Sent[] = [];
    let guard = 0;
    while (guard < 4) {
      const report = await run(sent);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      if (report.value.claimed === 0) break;
      guard += 1;
    }
    expect(sent.map((message) => message.event)).toEqual(["agreed", "agreed"]);
    expect(sent.map((message) => message.side).sort()).toEqual(["driver", "rider"]);
    const delivered = await rows("negotiation_agreed");
    expect(delivered.every((row) => row.status === "delivered" && row.message !== null)).toBe(true);
  });

  it("المفتاحُ يمنعُ صفَّينِ لطرفٍ واحدٍ في الحادثةِ نفسِها", async () => {
    expect((await claim(0)).ok).toBe(true);
    const claimRow = await sql<{ id: string }[]>`
      select id from unsubscribed_claims where negotiation_id = ${negotiationId}::uuid
    `;
    const again = await sql<{ queued: number }[]>`
      select enqueue_negotiation_notification(
        ${cityId}::uuid, 'negotiation_turn_opened'::text, ${claimRow[0]?.id ?? ""}::uuid
      ) as queued
    `;
    // إيداعٌ ثانٍ لا يُدرِجُ صفًّا: لا رسالتانِ لطرفٍ عن دورٍ واحدٍ.
    expect(again[0]?.queued).toBe(0);
    expect(await rows("negotiation_turn_opened")).toHaveLength(2);
  });
});
