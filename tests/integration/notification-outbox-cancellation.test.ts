/**
 * الغرض: اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لإخطارِ إلغاءِ الراكبِ في صندوقِ الصادرِ
 *   الموحَّدِ (BUG-004). المقصودُ إثباتُ ما لا يُثبتُه mock: أنَّ الإيداعَ يقعُ في
 *   معاملةِ `cancel_order_by_rider` نفسِها فلا صفَّ يبقى إن رجعت ولا أثرَ صادرٌ
 *   قبلَ الـcommit؛ وأنَّ الصفَّ لكلِّ سائقٍ لا للحادثةِ — فإعادةُ محاولةِ سائقٍ لا
 *   تُعيدُ الإرسالَ إلى مَن وصلَه؛ وأنَّ الإسنادَ يغلبُ العرضَ لسائقٍ جمعَ الحالَين؛
 *   وأنَّ المحادثةَ واللغةَ تُقرآنِ حيَّتَينِ لحظةَ الالتقاطِ لا لحظةَ الإيداعِ. ولا
 *   تيليجرامَ فعليٌّ هنا: المُبلِّغُ يُثبتُ الوجهةَ واللغةَ وصفةَ الإسناد.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: سحبُ بطاقةِ العرضِ من محادثةِ السائقِ يُقاسُ هنا إن أُضيف.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  type CancellationMessenger,
  createOrderCancelledHandler,
} from "../../packages/application/dispatch/deliver-cancellation-notification.ts";
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

const RIDER_TELEGRAM = 953001;
/** المُسنَدُ الذي هو صاحبُ عرضٍ معلَّقٍ كذلك — حالةُ الجمعِ بين الوصفَين. */
const ASSIGNED_TELEGRAM = 953002;
/** صاحبُ عرضٍ معلَّقٍ لم يُسنَدْ إليه شيءٌ. */
const OFFERED_TELEGRAM = 953003;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;
let riderId: string;
let assignedDriverId: string;
let offeredDriverId: string;

/** ما وصلَ فعلًا: وجهتُه ولغتُه وصفةُ إسنادِه ومَن هو. */
interface Sent {
  readonly chatId: string;
  readonly language: string;
  readonly wasAssigned: boolean;
  readonly driverId: string;
}

/**
 * مُبلِّغٌ يسجّلُ ما أُرسِلَ. `failFor` يُفشِلُ سائقًا بعينِه أوّلَ مرّةٍ حتّى تُقاسَ
 * عزلةُ الإعادةِ: مَن فشلَ يُعادُ له وحدَه، ومَن وصلَه لا يصلُه ثانيةً.
 */
function messenger(sent: Sent[], failFor: string | null = null): CancellationMessenger {
  const failed = new Set<string>();
  return {
    sendOrderCancelled: async (notice) => {
      if (notice.driverId === failFor && !failed.has(notice.driverId)) {
        failed.add(notice.driverId);
        return err(new PortFailureError("notifier.orderCancelled", "temporary failure"));
      }
      sent.push({
        chatId: notice.chatId,
        language: notice.language,
        wasAssigned: notice.wasAssigned,
        driverId: notice.driverId,
      });
      return ok(`msg-cancel-${sent.length}`);
    },
  };
}

function run(sent: Sent[], failFor: string | null = null) {
  return deliverNotifications({
    outbox: createNotificationOutboxPort(sql),
    handlers: {
      order_cancelled: createOrderCancelledHandler(messenger(sent, failFor)),
    },
  });
}

async function rows(): Promise<
  {
    status: string;
    attempts: number;
    dedup_key: string | null;
    message: string | null;
    order_id: string | null;
    driver_id: string | null;
    was_assigned: boolean | null;
  }[]
> {
  return await sql`
    select status,
           attempts,
           dedup_key,
           delivered_message_id                 as message,
           payload->>'order_id'                 as order_id,
           payload->>'driver_id'                as driver_id,
           (payload->>'was_assigned')::boolean  as was_assigned
      from notification_outbox
     where kind = 'order_cancelled'
     order by payload->>'driver_id'
  `;
}

async function makeDriver(telegramId: number, language: string): Promise<string> {
  const user = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${telegramId}::bigint, 'سائقُ الإلغاءِ', ${`+96650${telegramId}`},
            'driver'::user_role, ${language})
    returning id
  `;
  const driver = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${user[0]?.id ?? ""}::uuid, 'verified'::verification_status)
    returning id
  `;
  const created = driver[0]?.id ?? "";
  if (created === "") throw new Error("تعذّر تجهيز السائق");
  return created;
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  // القروباتُ الثلاثةُ في عبارةِ التفعيلِ نفسِها: تفعيلٌ بلا قروبٍ نجاحٌ معلَّقٌ
  // على ترتيبِ الملفّاتِ لا على حالٍ مضبوطةٍ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'راكبُ الإلغاءِ', '+966500953001',
            'rider'::user_role, 'ar')
    returning id
  `;
  const riders = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser[0]?.id ?? ""}::uuid)
    returning id
  `;
  riderId = riders[0]?.id ?? "";
  if (riderId === "") throw new Error("تعذّر تجهيز الراكب");

  assignedDriverId = await makeDriver(ASSIGNED_TELEGRAM, "en");
  offeredDriverId = await makeDriver(OFFERED_TELEGRAM, "ur");

  // الطلبُ مُطابَقٌ ومُسنَدٌ: الإلغاءُ بعدَ الإسنادِ هو الحالةُ التي يجبُ أن يعلمَها
  // السائقُ حتمًا — فهو في طريقِه فعلًا.
  const orders = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round,
                        assigned_driver_id)
    values (${cityId}, ${riderId}::uuid, 'transport'::service_type, 'matched'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 1,
            ${assignedDriverId}::uuid)
    returning id
  `;
  orderId = orders[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذّر تجهيز الطلب");

  // عرضانِ معلَّقانِ: أحدُهما للمُسنَدِ نفسِه — فيجتمعُ الوصفانِ في سائقٍ واحدٍ.
  for (const driverId of [assignedDriverId, offeredDriverId]) {
    await sql`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}, ${orderId}::uuid, ${driverId}::uuid, 1, 'pending'::offer_status,
              now() + interval '20 minutes')
    `;
  }
}

interface CancelResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly notifications_queued?: number;
  readonly previous_status?: string;
}

async function cancel(): Promise<CancelResult> {
  const cancelled = await sql<{ result: CancelResult }[]>`
    select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid, 'rider_cancelled') as result
  `;
  return cancelled[0]?.result ?? { ok: false };
}

describeIf("إخطارُ إلغاءِ الراكبِ في صندوقِ الصادرِ على PostgreSQL فعلية (BUG-004)", () => {
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

  it("الإلغاءُ يُودِعُ صفًّا لكلِّ سائقٍ في معاملتِه — والإسنادُ يغلبُ العرضَ", async () => {
    const sent: Sent[] = [];
    const result = await cancel();
    expect(result.ok).toBe(true);
    expect(result.previous_status).toBe("matched");
    // سائقانِ لا ثلاثةٌ: المُسنَدُ صاحبُ عرضٍ كذلك، فصفُّه واحدٌ لا اثنان.
    expect(result.notifications_queued).toBe(2);

    const queued = await rows();
    expect(queued).toHaveLength(2);
    const byDriver = new Map(queued.map((row) => [row.driver_id, row]));
    expect(byDriver.get(assignedDriverId)?.was_assigned).toBe(true);
    expect(byDriver.get(offeredDriverId)?.was_assigned).toBe(false);
    for (const row of queued) {
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
      expect(row.order_id).toBe(orderId);
      expect(row.dedup_key).toBe(`order_cancelled:${orderId}:${row.driver_id}`);
    }
    // ولا رسالةَ خرجت من مسارِ الإلغاءِ نفسِه: الأثرُ الصادرُ بعدَ الـcommit.
    expect(sent).toHaveLength(0);
  });

  it("رجوعُ معاملةِ الإلغاءِ لا يُبقي صفًّا: لا سائقَ يُخبَرُ بإلغاءٍ لم يقعْ", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      await holder
        .begin(async (tx) => {
          const cancelled = await tx<{ result: CancelResult }[]>`
            select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid,
                                         'rider_cancelled') as result
          `;
          expect(cancelled[0]?.result.ok).toBe(true);
          // الإلغاءُ نجحَ ثمّ تُرجَعُ المعاملةُ: لو كان الإخطارُ أثرًا صادرًا لحظتَها
          // لبلغَ السائقَ إلغاءٌ لا وجودَ له بعدَ الرجوع.
          expect(cancelled[0]?.result.notifications_queued).toBe(2);
          throw new Error("rollback");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("rollback");
        });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect(await rows()).toHaveLength(0);
    const order = await sql<{ status: string }[]>`
      select status from orders where id = ${orderId}::uuid
    `;
    expect(order[0]?.status).toBe("matched");
  });

  it("إلغاءُ طلبٍ مُلغىً لا يُودِعُ صفًّا ثانيًا — والمنعُ بالمفتاحِ لو أُعيدَ", async () => {
    expect((await cancel()).notifications_queued).toBe(2);

    const again = await cancel();
    expect(again.ok).toBe(false);
    expect(again.error).toBe("ORDER_NOT_CANCELLABLE");
    expect(await rows()).toHaveLength(2);

    // ومفتاحُ المنعِ نفسُه لو نُودِيَ الإيداعُ مباشرةً: لا صفَّ ثالثٌ.
    const repeated = await sql<{ id: string | null }[]>`
      select enqueue_notification(
        ${cityId}::uuid, 'order_cancelled',
        jsonb_build_object('order_id', ${orderId}::text,
                           'driver_id', ${assignedDriverId}::text,
                           'was_assigned', true),
        ${`order_cancelled:${orderId}:${assignedDriverId}`}
      ) as id
    `;
    expect(repeated[0]?.id).toBeNull();
    expect(await rows()).toHaveLength(2);
  });

  it("الإغناءُ حيٌّ لحظةَ الالتقاطِ: محادثةُ السائقِ ولغتُه من القاعدةِ لا من الحمولةِ", async () => {
    expect((await cancel()).notifications_queued).toBe(2);
    // اللغةُ تُغيَّرُ بعدَ الإيداعِ: لو جُمِّدت في الحمولةِ لَوصلت بالإنجليزية.
    await sql`
      update users set language_code = 'ar'
       where telegram_id = ${ASSIGNED_TELEGRAM}::bigint
    `;

    const sent: Sent[] = [];
    const report = await run(sent);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(2);
    expect(sent).toHaveLength(2);

    const assigned = sent.find((row) => row.driverId === assignedDriverId);
    expect(assigned?.chatId).toBe(String(ASSIGNED_TELEGRAM));
    expect(assigned?.language).toBe("ar");
    expect(assigned?.wasAssigned).toBe(true);

    const offered = sent.find((row) => row.driverId === offeredDriverId);
    expect(offered?.chatId).toBe(String(OFFERED_TELEGRAM));
    expect(offered?.language).toBe("ur");
    expect(offered?.wasAssigned).toBe(false);

    for (const row of await rows()) {
      expect(row.status).toBe("delivered");
      expect(row.message).not.toBeNull();
    }
  });

  it("فشلُ سائقٍ يُعادُ له وحدَه: مَن وصلَه لا يصلُه ثانيةً بإعادةِ غيرِه", async () => {
    expect((await cancel()).notifications_queued).toBe(2);

    const sent: Sent[] = [];
    const first = await run(sent, assignedDriverId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.delivered).toBe(1);
    expect(first.value.failed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.driverId).toBe(offeredDriverId);

    const afterFailure = await rows();
    const failedRow = afterFailure.find((row) => row.driver_id === assignedDriverId);
    expect(failedRow?.status).toBe("pending");
    expect(failedRow?.attempts).toBe(1);
    expect(failedRow?.message).toBeNull();
    const deliveredRow = afterFailure.find((row) => row.driver_id === offeredDriverId);
    expect(deliveredRow?.status).toBe("delivered");

    // المهلةُ بين المحاولاتِ حقيقيةٌ في القاعدةِ: تُقرَّبُ لتُقاسَ الإعادةُ نفسُها.
    await sql`
      update notification_outbox set next_attempt_at = now()
       where kind = 'order_cancelled' and status = 'pending'
    `;

    const second = await run(sent);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // صفٌّ واحدٌ فقط يُلتقَطُ: المُسلَّمُ خرجَ من الصفِّ ولم يُرسَلْ إليه ثانيةً.
    expect(second.value.claimed).toBe(1);
    expect(second.value.delivered).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.driverId).toBe(assignedDriverId);

    const settled = await rows();
    for (const row of settled) {
      expect(row.status).toBe("delivered");
      expect(row.message).not.toBeNull();
    }
    expect(settled.find((row) => row.driver_id === assignedDriverId)?.attempts).toBe(2);

    // وشوطٌ ثالثٌ لا يلتقطُ شيئًا: ما وصلَ لا يُرسَلُ ثانيةً.
    const third = await run(sent);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.claimed).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("سائقٌ حُذِفَ سجلُّه قبلَ الالتقاطِ يُهجَرُ صفُّه ولا يُعطِّلُ غيرَه", async () => {
    expect((await cancel()).notifications_queued).toBe(2);
    // حالةُ الواقعِ: صفٌّ لا يمكنُ إغناؤه — لا محادثةَ تُقرأُ — فلا يُعادُ إلى الأبدِ.
    await sql`delete from order_offers where driver_id = ${offeredDriverId}::uuid`;
    await sql`delete from drivers where id = ${offeredDriverId}::uuid`;

    const sent: Sent[] = [];
    const report = await run(sent);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(1);
    // `SEC-19-ب-٣` — السائقُ المحذوفُ لا عنوانَ له فلا يُحاوَلُ إرسالُه ولا
    // يُعادُ: عُذِرَ تسليمُه في القاعدةِ بـ`TELEGRAM_DELIVERY_UNAVAILABLE`.
    expect(report.value.undeliverable).toBe(1);
    expect(report.value.abandoned).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.driverId).toBe(assignedDriverId);

    const settled = await rows();
    expect(settled.find((row) => row.driver_id === assignedDriverId)?.status).toBe("delivered");
    expect(settled.find((row) => row.driver_id === offeredDriverId)?.status).toBe("undeliverable");
  });
});
