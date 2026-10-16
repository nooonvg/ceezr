/**
 * اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لنوعِ «dispute_resolution» في صندوقِ الصادرِ
 *   الموحَّدِ (BUG-004): الإيداعُ داخلَ معاملةِ resolve_support_ticket نفسِها، ولا
 *   صفَّ يتيمٌ إن رجعت المعاملةُ، ولا أثرَ صادرٌ قبلَ الـcommit، وفشلُ الإرسالِ بعدَه
 *   يُعادُ بلا تكرارِ أثرٍ، والمفتاحُ يمنعُ صفَّينِ لقرارٍ واحدٍ، والصفُّ الواحدُ لا
 *   يُلتقطُ مرّتينِ عند التزامنِ. ولا تيليجرامَ فعليٌّ هنا: المُبلِّغُ المزدوجُ
 *   يُثبتُ الأثرَ ومعرّفَ الرسالةِ ومَن أُرسِلَ إليه.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import { createDisputeResolutionHandler } from "../../packages/application/dispute/deliver-dispute-resolution.ts";
import type { TicketOwnerNotifier } from "../../packages/application/dispute/index.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSupportResolutionPort } from "../../packages/infrastructure/dispute/support-adapters.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const SUPPORT_TELEGRAM = 770001;
const DRIVER_TELEGRAM = 990001;
const RIDER_TELEGRAM = 880002;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let driverId: string;
let riderId: string;
let driverTicketId: string;
let riderTicketId: string;

/** ما وصلَ فعلًا: وجهةُ الرسالةِ والقرارُ ولغتُه وأيُّ بوتٍ أرسلَها. */
interface Sent {
  readonly bot: "driver" | "rider";
  readonly telegramId: string;
  readonly action: string;
  readonly language: string;
}

function notifier(bot: "driver" | "rider", sent: Sent[], failFirst: number): TicketOwnerNotifier {
  let calls = 0;
  return {
    notifyResolution: async (input) => {
      calls += 1;
      if (calls <= failFirst) {
        return err(new PortFailureError("notifier.ticketOwner", "temporary failure"));
      }
      sent.push({
        bot,
        telegramId: input.telegramId,
        action: input.action,
        language: input.language,
      });
      return ok(`msg-${bot}-${calls}`);
    },
  };
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  // تفعيلٌ وقروباتُه في عبارةٍ واحدةٍ: مدينةٌ تُفعّل بلا قروباتِها تجعلُ نجاحَ
  // الاختبارِ معلّقاً على ملفٍ أسبقَ ضبطَها — والحاجزُ `check-test-city-activation` يمنعُه.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${SUPPORT_TELEGRAM}::bigint, 'دعم', '+966500770001', 'admin', 'ar')
  `;

  const driverUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${DRIVER_TELEGRAM}::bigint, 'سائق', '+966500990001', 'driver', 'ur')
    returning id
  `;
  const drv = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${driverUser[0]?.id ?? ""}::uuid, 'verified'::verification_status)
    returning id
  `;
  driverId = drv[0]?.id ?? "";

  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'راكب', '+966500880002', 'rider', 'en')
    returning id
  `;
  const rdr = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser[0]?.id ?? ""}::uuid)
    returning id
  `;
  riderId = rdr[0]?.id ?? "";
  if (driverId === "" || riderId === "") throw new Error("تعذّر تجهيز أصحاب التذاكر");

  const driverTicket = await sql<{ id: string }[]>`
    insert into support_tickets (city_id, driver_id, type, status, message)
    values (${cityId}, ${driverId}::uuid, 'subscription', 'open', 'أرجو تفعيل اشتراكي')
    returning id
  `;
  driverTicketId = driverTicket[0]?.id ?? "";
  const riderTicket = await sql<{ id: string }[]>`
    insert into support_tickets (city_id, rider_id, type, status, message)
    values (${cityId}, ${riderId}::uuid, 'ride_dispute', 'open', 'شكوى على رحلة')
    returning id
  `;
  riderTicketId = riderTicket[0]?.id ?? "";
  if (driverTicketId === "" || riderTicketId === "") throw new Error("تعذّر تجهيز التذاكر");
}

async function outboxRows(
  ticketId: string,
): Promise<{ status: string; attempts: number; dedup_key: string | null }[]> {
  return await sql<{ status: string; attempts: number; dedup_key: string | null }[]>`
    select status, attempts, dedup_key from notification_outbox
     where kind = 'dispute_resolution' and payload->>'ticket_id' = ${ticketId}
  `;
}

function run(handlers: Record<string, ReturnType<typeof createDisputeResolutionHandler>>) {
  return deliverNotifications({ outbox: createNotificationOutboxPort(sql), handlers });
}

describeIf("قرارُ الدعمِ في صندوقِ الصادرِ الموحَّدِ على PostgreSQL فعلية (BUG-004)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, support_tickets, subscriptions, audit_log,
        order_offers, orders, driver_availability, drivers, riders, users
        restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, support_tickets, subscriptions, audit_log,
        order_offers, orders, driver_availability, drivers, riders, users
        restart identity cascade
    `;
    await createFixture();
  });

  it("القرارُ يُودِعُ صفَّ التبليغِ في معاملتِه نفسِها — ولا أثرَ صادرٌ في مسارِ القرارِ", async () => {
    const sent: Sent[] = [];
    const resolved = await createSupportResolutionPort(sql).resolve({
      ticketId: driverTicketId,
      actorTelegramId: String(SUPPORT_TELEGRAM),
      action: "reject",
      note: null,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.resolved).toBe(true);
    expect(resolved.value.notificationQueued).toBe(true);

    // الصفُّ مودَعٌ مع القرارِ، ولا رسالةَ خرجت من مسارِ القرارِ: الأثرُ الصادرُ
    // بعدَ الـcommit وحدَه، ومن العاملِ لا من هنا. هذا صميمُ BUG-004.
    const rows = await outboxRows(driverTicketId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.attempts).toBe(0);
    expect(rows[0]?.dedup_key).toBe(`dispute_resolution:${driverTicketId}`);
    expect(sent).toHaveLength(0);
  });

  it("رجوعُ المعاملةِ لا يُتركُ صفًّا يتيمًا: لا تبليغَ عن قرارٍ لم يقع", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      await holder
        .begin(async (tx) => {
          const settled = await tx<{ result: { ok: boolean } }[]>`
            select resolve_support_ticket(
              ${driverTicketId}::uuid, ${SUPPORT_TELEGRAM}::bigint, 'reject'::text, null::text
            ) as result
          `;
          expect(settled[0]?.result.ok).toBe(true);
          // القرارُ نجحَ داخلَ المعاملةِ، ثمّ تُرجَعُ: لو كان التبليغُ أثرًا صادرًا
          // لحظتَها لكان قد وصلَ صاحبَه عن قرارٍ لا وجودَ له بعدَ الرجوعِ.
          throw new Error("rollback");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("rollback");
        });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect(await outboxRows(driverTicketId)).toHaveLength(0);
    const ticket = await sql<{ status: string }[]>`
      select status::text as status from support_tickets where id = ${driverTicketId}::uuid
    `;
    expect(ticket[0]?.status).toBe("open");
  });

  it("فشلُ الإرسالِ بعدَ الـcommit يُعادُ بموعدٍ جديدٍ بلا تكرارِ أثرٍ ولا ضياعِ تبليغٍ", async () => {
    const port = createSupportResolutionPort(sql);
    const settled = await port.resolve({
      ticketId: driverTicketId,
      actorTelegramId: String(SUPPORT_TELEGRAM),
      action: "reject",
      note: null,
    });
    expect(settled.ok).toBe(true);

    const sent: Sent[] = [];
    const failing = await run({
      dispute_resolution: createDisputeResolutionHandler({
        driver: notifier("driver", sent, 1),
        rider: notifier("rider", sent, 0),
      }),
    });
    expect(failing.ok).toBe(true);
    if (!failing.ok) return;
    expect(failing.value.delivered).toBe(0);
    expect(failing.value.failed).toBe(1);
    expect(sent).toHaveLength(0);

    // الصفُّ عادَ pending بموعدٍ مستقبليٍّ ومحاولةٍ محسوبةٍ: لا ضياعَ ولا لفٌّ محموم.
    const pending = await sql<{ status: string; attempts: number; due: boolean }[]>`
      select status, attempts, next_attempt_at > now() as due from notification_outbox
       where kind = 'dispute_resolution' and payload->>'ticket_id' = ${driverTicketId}
    `;
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.attempts).toBe(1);
    expect(pending[0]?.due).toBe(true);

    // ثمّ يحينُ موعدُه فيُسلَّمُ مرّةً واحدةً — وأثرٌ واحدٌ لا اثنان.
    await sql`
      update notification_outbox set next_attempt_at = now() - interval '1 second'
       where kind = 'dispute_resolution' and payload->>'ticket_id' = ${driverTicketId}
    `;
    const second = await run({
      dispute_resolution: createDisputeResolutionHandler({
        driver: notifier("driver", sent, 0),
        rider: notifier("rider", sent, 0),
      }),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.bot).toBe("driver");
    expect(sent[0]?.telegramId).toBe(String(DRIVER_TELEGRAM));
    expect(sent[0]?.action).toBe("reject");
    // لغةُ صاحبِ التذكرةِ تُقرأُ حيّةً لحظةَ الالتقاطِ لا نسخةً مخزَّنةً في الصفِّ.
    expect(sent[0]?.language).toBe("ur");

    const delivered = await sql<{ status: string; message: string | null }[]>`
      select status, delivered_message_id as message from notification_outbox
       where kind = 'dispute_resolution' and payload->>'ticket_id' = ${driverTicketId}
    `;
    expect(delivered[0]?.status).toBe("delivered");
    expect(delivered[0]?.message).toBe("msg-driver-1");

    // والصفُّ المُسلَّمُ لا يُلتقطُ ثالثةً: شوطٌ ثالثٌ لا يجدُ شيئًا ولا يُرسِلُ شيئًا.
    const third = await run({
      dispute_resolution: createDisputeResolutionHandler({
        driver: notifier("driver", sent, 0),
        rider: notifier("rider", sent, 0),
      }),
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.claimed).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("راكبٌ صاحبُ تذكرةٍ يُبلَّغُ ببوتِ الراكبِ لا ببوتِ السائقِ", async () => {
    const settled = await createSupportResolutionPort(sql).resolve({
      ticketId: riderTicketId,
      actorTelegramId: String(SUPPORT_TELEGRAM),
      action: "reject",
      note: null,
    });
    expect(settled.ok).toBe(true);

    const sent: Sent[] = [];
    const report = await run({
      dispute_resolution: createDisputeResolutionHandler({
        driver: notifier("driver", sent, 0),
        rider: notifier("rider", sent, 0),
      }),
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(1);
    // رسالةٌ خاصّةٌ من بوتٍ لم يبدأ الراكبُ معه محادثةً لا تصلُ أصلًا — فالمُرسِلُ
    // يُختارُ بصنفِ صاحبِ التذكرةِ كما قرأته القاعدةُ، لا بواحدٍ ثابتٍ.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.bot).toBe("rider");
    expect(sent[0]?.telegramId).toBe(String(RIDER_TELEGRAM));
    expect(sent[0]?.language).toBe("en");
  });

  it("المفتاحُ يمنعُ صفَّينِ لقرارٍ واحدٍ: إعادةُ الإيداعِ لا تُنشئُ أثرًا ثانيًا", async () => {
    const key = `dispute_resolution:${driverTicketId}`;
    const first = await sql<{ id: string | null }[]>`
      select enqueue_notification(
        ${cityId}::uuid, 'dispute_resolution'::text,
        jsonb_build_object('ticket_id', ${driverTicketId}::text, 'action', 'reject'),
        ${key}::text
      ) as id
    `;
    const again = await sql<{ id: string | null }[]>`
      select enqueue_notification(
        ${cityId}::uuid, 'dispute_resolution'::text,
        jsonb_build_object('ticket_id', ${driverTicketId}::text, 'action', 'reject'),
        ${key}::text
      ) as id
    `;
    expect(first[0]?.id).not.toBeNull();
    // الإيداعُ الثاني بالمفتاحِ نفسِه لا يُدرِجُ صفًّا: لا رسالتانِ لقرارٍ واحدٍ.
    expect(again[0]?.id).toBeNull();
    expect(await outboxRows(driverTicketId)).toHaveLength(1);
  });

  it("التزامنُ لا يُنتِجُ التقاطًا مزدوجًا: صفٌّ واحدٌ لعاملٍ واحدٍ", async () => {
    const settled = await createSupportResolutionPort(sql).resolve({
      ticketId: driverTicketId,
      actorTelegramId: String(SUPPORT_TELEGRAM),
      action: "reject",
      note: null,
    });
    expect(settled.ok).toBe(true);

    const first = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    const second = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      const [a, b] = await Promise.all([
        createNotificationOutboxPort(first).claim(),
        createNotificationOutboxPort(second).claim(),
      ]);
      expect(a.ok && b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      const claimed = [a.value.delivery, b.value.delivery].filter((row) => row !== null);
      // FOR UPDATE SKIP LOCKED: واحدٌ يفوزُ والآخرُ لا يرى شيئًا — لا رسالتانِ.
      expect(claimed).toHaveLength(1);
    } finally {
      await Promise.all([first.end({ timeout: 5 }), second.end({ timeout: 5 })]);
    }
  });
});
