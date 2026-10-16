/**
 * اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لإخطارَي صاحبِ الطلبِ العالقِ في صندوقِ الصادرِ
 *   الموحَّدِ (BUG-004): «الانتقالُ إلى دائرةٍ أوسعَ» و«لا سائقَ». المقصودُ إثباتُ ما
 *   لا يُثبتُه mock: أنَّ الإيداعَ يقعُ في معاملةِ فتحِ الدورةِ وفي معاملةِ أوّلِ
 *   تسليمٍ للبطاقةِ، فلا صفَّ يتيمٌ إن رجعتا ولا أثرَ صادرٌ قبلَ الـcommit؛ وأنَّ
 *   الخبرَ واحدٌ لا يتكرّرُ: الدورةُ الثانيةُ لا تُودِعُ خبرًا ثانيًا وأوّلُ تسليمٍ
 *   واحدٌ لا اثنانِ؛ وأنَّ المحادثةَ واللغةَ ونوعَ الخدمةِ تُقرأُ حيّةً لحظةَ
 *   الالتقاطِ لا لحظةَ الإيداعِ. ولا تيليجرامَ فعليٌّ هنا: المُبلِّغُ يُثبتُ الوجهةَ
 *   واللغةَ والنوعَ ومعرّفَ الرسالةِ.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: يُوسَّعُ حينَ يُنقَلُ إلغاءُ الراكبِ إلى الصندوقِ في شطرِه.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  createNoDriverFoundHandler,
  createWiderCircleOpenedHandler,
  type UnmatchedRiderMessenger,
  type UnmatchedRiderNotice,
} from "../../packages/application/dispatch/deliver-unmatched-notification.ts";
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

const RIDER_TELEGRAM = 952001;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;

/** ما وصلَ فعلًا: النوعُ ووجهتُه ولغتُه ونوعُ خدمتِه. */
interface Sent {
  readonly event: "wider" | "noDriver";
  readonly chatId: string;
  readonly language: string;
  readonly service: string;
}

/** مُبلِّغٌ يسجّلُ ما أُرسِلَ، ويُفشِلُ أوّلَ محاولاتٍ معدودةٍ لتُقاسَ الإعادةُ. */
function messenger(sent: Sent[], failTimes: number): UnmatchedRiderMessenger {
  let failures = 0;
  const record = (event: Sent["event"], notice: UnmatchedRiderNotice) => {
    if (failures < failTimes) {
      failures += 1;
      return err(new PortFailureError("notifier.unmatched", "temporary failure"));
    }
    sent.push({
      event,
      chatId: notice.chatId,
      language: notice.language,
      service: notice.service,
    });
    return ok(`msg-${event}-${sent.length}`);
  };
  return {
    sendWiderCircleOpened: async (notice) => record("wider", notice),
    sendNoDriverFound: async (notice) => record("noDriver", notice),
  };
}

function run(sent: Sent[], failTimes = 0) {
  const port = messenger(sent, failTimes);
  return deliverNotifications({
    outbox: createNotificationOutboxPort(sql),
    handlers: {
      wider_circle_opened: createWiderCircleOpenedHandler(port),
      no_driver_found: createNoDriverFoundHandler(port),
    },
  });
}

async function rows(kind: string): Promise<
  {
    status: string;
    attempts: number;
    dedup_key: string | null;
    message: string | null;
    order_id: string | null;
  }[]
> {
  return await sql`
    select status,
           attempts,
           dedup_key,
           delivered_message_id as message,
           payload->>'order_id'  as order_id
      from notification_outbox
     where kind = ${kind}
     order by created_at
  `;
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  // القروبان شرطٌ: فتحُ الدورةِ يحتاج قروبَ غيرِ المشتركين، والتصعيدُ قروبَ الإسناد.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'راكبُ الطلبِ العالقِ', '+966500952001',
            'rider'::user_role, 'en')
    returning id
  `;
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser[0]?.id ?? ""}::uuid)
    returning id
  `;
  const riderId = riders[0]?.id ?? "";
  if (riderId === "") throw new Error("تعذّر تجهيز الراكب");

  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
    values (${cityId}, ${riderId}::uuid, 'delivery'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 0)
    returning id
  `;
  orderId = orders[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذّر تجهيز الطلب");
}

async function openCycle(): Promise<{
  ok: boolean;
  cycle?: number;
  notification_queued?: boolean;
}> {
  const opened = await sql<
    { result: { ok: boolean; cycle?: number; notification_queued?: boolean } }[]
  >`
    select open_unsubscribed_cycle(${orderId}::uuid) as result
  `;
  return opened[0]?.result ?? { ok: false };
}

/** يُنهي الدورةَ القائمةَ كما تُنهيها مهمّةُ التدويرِ حين لا يتفق أحدٌ. */
async function exhaustOpenCycle(): Promise<void> {
  await sql`
    update unsubscribed_negotiations
       set status = 'exhausted'::negotiation_status
     where order_id = ${orderId}::uuid and status = 'collecting'::negotiation_status
  `;
}

async function escalate(): Promise<void> {
  const escalated = await sql<{ result: { ok: boolean } }[]>`
    select escalate_order(${orderId}::uuid, 'no_driver_at_all') as result
  `;
  if (escalated[0]?.result.ok !== true) throw new Error("تعذّر كتابةُ أثرِ التصعيد");
}

async function markDelivered(
  messageId: string,
): Promise<{ first_delivery?: boolean; notification_queued?: boolean }> {
  const marked = await sql<
    { result: { first_delivery?: boolean; notification_queued?: boolean } }[]
  >`
    select mark_escalation_delivered(${orderId}::uuid, ${messageId}) as result
  `;
  return marked[0]?.result ?? {};
}

describeIf("إخطارا صاحبِ الطلبِ العالقِ في صندوقِ الصادرِ على PostgreSQL فعلية (BUG-004)", () => {
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

  it("فتحُ الدورةِ الأولى يُودِعُ صفًّا واحدًا في معاملتِها — ولا أثرَ صادرٌ فيها", async () => {
    const sent: Sent[] = [];
    const opened = await openCycle();
    expect(opened.ok).toBe(true);
    expect(opened.cycle).toBe(1);
    expect(opened.notification_queued).toBe(true);

    const queued = await rows("wider_circle_opened");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("pending");
    expect(queued[0]?.attempts).toBe(0);
    expect(queued[0]?.order_id).toBe(orderId);
    // مفتاحُ المنعِ بالطلبِ نفسِه: خبرٌ واحدٌ لا خبرٌ لكلِّ شوطٍ.
    expect(queued[0]?.dedup_key).toBe(`wider_circle_opened:${orderId}`);
    // ولا رسالةَ خرجت من مسارِ الفتحِ: الأثرُ الصادرُ بعدَ الـcommit ومن العاملِ.
    expect(sent).toHaveLength(0);
  });

  it("رجوعُ معاملةِ الفتحِ لا يُتركُ صفًّا يتيمًا: لا خبرَ بدائرةٍ لم تُفتح", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      await holder
        .begin(async (tx) => {
          const opened = await tx<{ result: { ok: boolean } }[]>`
            select open_unsubscribed_cycle(${orderId}::uuid) as result
          `;
          expect(opened[0]?.result.ok).toBe(true);
          // الفتحُ نجحَ ثمّ تُرجَعُ المعاملةُ: لو كان الخبرُ أثرًا صادرًا لحظتَها
          // لبلغَ صاحبَ الطلبِ خبرٌ عن دائرةٍ لا وجودَ لها بعدَ الرجوع.
          throw new Error("rollback");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("rollback");
        });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect(await rows("wider_circle_opened")).toHaveLength(0);
    const cycles = await sql<{ count: string }[]>`
      select count(*)::text as count from unsubscribed_negotiations
       where order_id = ${orderId}::uuid
    `;
    expect(cycles[0]?.count).toBe("0");
  });

  it("الدورةُ الثانيةُ لا تُودِعُ خبرًا ثانيًا: ما بعدَ الأولى إعادةُ محاولةٍ", async () => {
    expect((await openCycle()).notification_queued).toBe(true);
    await exhaustOpenCycle();

    const second = await openCycle();
    expect(second.ok).toBe(true);
    expect(second.cycle).toBe(2);
    expect(second.notification_queued).toBe(false);
    expect(await rows("wider_circle_opened")).toHaveLength(1);
  });

  it("أوّلُ تسليمٍ لبطاقةِ الإسنادِ يُودِعُ «لا سائقَ» في معاملتِه، والثاني لا يُودِع", async () => {
    await escalate();
    const first = await markDelivered("77");
    expect(first.first_delivery).toBe(true);
    expect(first.notification_queued).toBe(true);

    const queued = await rows("no_driver_found");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe("pending");
    expect(queued[0]?.dedup_key).toBe(`no_driver_found:${orderId}`);

    // شوطٌ ثانٍ: لا أثرَ غيرَ مسلَّمٍ، فلا خبرَ ثانيًا لصاحبِ الطلبِ.
    const again = await markDelivered("78");
    expect(again.first_delivery).toBe(false);
    expect(again.notification_queued).toBeUndefined();
    expect(await rows("no_driver_found")).toHaveLength(1);
  });

  it("رجوعُ معاملةِ التسليمِ لا يُبقي صفًّا ولا يُسلِّمُ الأثرَ", async () => {
    await escalate();
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      await holder
        .begin(async (tx) => {
          const marked = await tx<{ result: { first_delivery?: boolean } }[]>`
            select mark_escalation_delivered(${orderId}::uuid, '79') as result
          `;
          expect(marked[0]?.result.first_delivery).toBe(true);
          throw new Error("rollback");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("rollback");
        });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect(await rows("no_driver_found")).toHaveLength(0);
    // والأثرُ باقٍ غيرَ مسلَّمٍ: الشوطُ التالي يُعيدُ الإرسالَ ثمّ يُودِعُ الخبرَ.
    const audit = await sql<{ delivered: boolean | null }[]>`
      select (payload->>'delivered')::boolean as delivered
        from audit_log where action = 'order.escalated'
    `;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.delivered).toBe(false);
  });

  it("الإغناءُ حيٌّ لحظةَ الالتقاطِ: لغةٌ تغيّرت بعدَ الإيداعِ ونوعُ خدمةٍ من الطلبِ", async () => {
    expect((await openCycle()).notification_queued).toBe(true);
    // اللغةُ تُغيَّرُ بعدَ الإيداعِ: لو كانت مُجمَّدةً في الحمولةِ لَوصلت بالإنجليزية.
    await sql`
      update users set language_code = 'ur'
       where telegram_id = ${RIDER_TELEGRAM}::bigint
    `;

    const sent: Sent[] = [];
    const report = await run(sent);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.event).toBe("wider");
    expect(sent[0]?.chatId).toBe(String(RIDER_TELEGRAM));
    expect(sent[0]?.language).toBe("ur");
    // نوعُ الخدمةِ من الطلبِ لا اجتهادًا: طلبُ توصيلٍ لا نقلٍ في هذه التهيئة.
    expect(sent[0]?.service).toBe("delivery");

    const after = await rows("wider_circle_opened");
    expect(after[0]?.status).toBe("delivered");
    expect(after[0]?.message).not.toBeNull();
  });

  it("فشلُ الإرسالِ يُعادُ حتّى يصلَ، وما وصلَ لا يُرسَلُ ثانيةً", async () => {
    await escalate();
    expect((await markDelivered("80")).notification_queued).toBe(true);

    const sent: Sent[] = [];
    const first = await run(sent, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.failed).toBe(1);
    expect(sent).toHaveLength(0);

    const afterFailure = await rows("no_driver_found");
    expect(afterFailure[0]?.status).toBe("pending");
    expect(afterFailure[0]?.attempts).toBe(1);
    expect(afterFailure[0]?.message).toBeNull();

    // المهلةُ بين المحاولاتِ حقيقيةٌ في القاعدةِ: تُقرَّبُ لتُقاسَ الإعادةُ نفسُها.
    await sql`
      update notification_outbox set next_attempt_at = now()
       where kind = 'no_driver_found'
    `;

    const second = await run(sent);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.event).toBe("noDriver");

    const delivered = await rows("no_driver_found");
    expect(delivered[0]?.status).toBe("delivered");
    expect(delivered[0]?.attempts).toBe(2);
    expect(delivered[0]?.message).not.toBeNull();

    // وشوطٌ ثالثٌ لا يلتقطُ شيئًا: ما وصلَ لا يُرسَلُ ثانيةً.
    const third = await run(sent);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.claimed).toBe(0);
    expect(sent).toHaveLength(1);
  });
});
