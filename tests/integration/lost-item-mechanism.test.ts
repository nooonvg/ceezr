/**
 * الغرض: اختبارُ قاعدةِ PostgreSQL حقيقيّةٍ لآليّةِ بلاغِ المفقودِ (`F12-07`). المقصودُ
 *   إثباتُ ما لا يُثبتُه mock ولا حاجزٌ ساكنٌ:
 *     ــ أنَّ التذكرةَ تُفتَحُ بلا طلبٍ (عقدُ `F3-08` المحفوظُ `ح-8`) فلا صفَّ صادرَ
 *        ولا ردَّ ORDER_REQUIRED.
 *     ــ أنَّ البلاغَ يُودَعُ **مشروطاً** بسائقٍ مُسنَدٍ ورحلةٍ منتهيةٍ («completed») في
 *        معاملةِ التذكرةِ نفسِها — فلا تذكرةَ بلا بلاغٍ ولا بلاغَ بلا تذكرةٍ.
 *     ــ أنَّ الطلبَ بلا سائقٍ مُسنَدٍ يُفتَحُ تذكرتُه **بلا بلاغٍ** — فلا صفٌّ ميّتٌ.
 *     ــ أنَّ مِلكيّةَ الطلبِ (`ORDER_NOT_YOURS`) قائمةٌ لم تُنزَعْ.
 *     ــ أنَّ الإغناءَ حيٌّ لحظةَ الالتقاطِ: محادثةُ السائقِ ولغتُه من القاعدةِ لا من
 *        الحمولةِ. ومفتاحُ منعِ التكرارِ `'lost_item:' || ticket_id` — تذكرةٌ واحدةٌ
 *        بلاغٌ واحدٌ.
 * الحالة: منفّذ فعلياً — 2026-09-18.
 * ينتمي إلى: tests/integration
 * يُستخدم من: bun test (وظيفةُ تكاملِ PostgreSQL في CI)
 * ملاحظات مستقبلية: لا شيءَ — البندُ إيداعُ البلاغِ وحسبُ.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  createLostItemReportHandler,
  type LostItemMessenger,
} from "../../packages/application/dispatch/deliver-lost-item-notification.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TELEGRAM = 954001;
const OTHER_RIDER_TELEGRAM = 954002;
const DRIVER_TELEGRAM = 954003;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let riderId: string;
let driverId: string;
let driverUserId: string;
let completedOrderId: string;
let searchingOrderId: string;

interface OpenPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly ticket_id?: string;
  readonly reference?: string;
}

interface Sent {
  readonly chatId: string;
  readonly language: string;
  readonly driverId: string;
  readonly ticketId: string;
  readonly reference: string;
}

function messenger(sent: Sent[]): LostItemMessenger {
  return {
    sendLostItemReport: async (notice) => {
      sent.push({
        chatId: notice.chatId,
        language: notice.language,
        driverId: notice.driverId,
        ticketId: notice.ticketId,
        reference: notice.reference,
      });
      return ok(`msg-lost-${sent.length}`);
    },
  };
}

function run(sent: Sent[]) {
  return deliverNotifications({
    outbox: createNotificationOutboxPort(sql),
    handlers: {
      lost_item_report: createLostItemReportHandler(messenger(sent)),
    },
  });
}

async function openTicket(options: {
  readonly telegramId: number;
  readonly orderId?: string | null;
}): Promise<OpenPayload> {
  const [row] = await sql<{ result: OpenPayload }[]>`
    select open_support_ticket(
      ${options.telegramId}::bigint,
      'lost_item'::support_ticket_type,
      ${"نسيتُ حقيبتي في المركبةِ"}::text,
      null::text,
      ${options.orderId ?? null}::uuid
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function outboxRows(): Promise<
  {
    readonly status: string;
    readonly attempts: number;
    readonly dedup_key: string | null;
    readonly ticket_id: string | null;
    readonly order_id: string | null;
    readonly driver_id: string | null;
    readonly reference: string | null;
  }[]
> {
  return await sql`
    select status, attempts, dedup_key,
           payload->>'ticket_id'  as ticket_id,
           payload->>'order_id'   as order_id,
           payload->>'driver_id'  as driver_id,
           payload->>'reference'  as reference
      from notification_outbox
     where kind = 'lost_item_report'
     order by created_at
  `;
}

async function makeDriver(
  telegramId: number,
  language: string,
): Promise<{ driverId: string; userId: string }> {
  const user = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${telegramId}::bigint, 'سائقُ المفقودِ', ${`+96650${telegramId}`},
            'driver'::user_role, ${language})
    returning id
  `;
  const driver = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${user[0]?.id ?? ""}::uuid, 'verified'::verification_status)
    returning id
  `;
  const d = driver[0]?.id ?? "";
  if (d === "") throw new Error("تعذّر تجهيز السائق");
  return { driverId: d, userId: user[0]?.id ?? "" };
}

async function makeRider(telegramId: number, language: string): Promise<string> {
  const user = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values (${cityId}, ${telegramId}::bigint, 'راكبُ المفقودِ', ${`+96650${telegramId}`},
            'rider'::user_role, ${language})
    returning id
  `;
  const rider = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${user[0]?.id ?? ""}::uuid)
    returning id
  `;
  const r = rider[0]?.id ?? "";
  if (r === "") throw new Error("تعذّر تجهيز الراكب");
  return r;
}

async function createFixture(): Promise<void> {
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  riderId = await makeRider(RIDER_TELEGRAM, "ar");
  await makeRider(OTHER_RIDER_TELEGRAM, "ar");
  const driver = await makeDriver(DRIVER_TELEGRAM, "en");
  driverId = driver.driverId;
  driverUserId = driver.userId;

  // رحلةٌ منتهيةٌ مُسنَدٌ سائقُها — حالةُ البلاغِ المشروطِ.
  const completed = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round,
                        assigned_driver_id)
    values (${cityId}, ${riderId}::uuid, 'transport'::service_type, 'completed'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 1,
            ${driverId}::uuid)
    returning id
  `;
  completedOrderId = completed[0]?.id ?? "";
  if (completedOrderId === "") throw new Error("تعذّر تجهيز الطلب المنتهي");

  // طلبٌ قائمٌ بلا سائقٍ مُسنَدٍ — يُفتَحُ له بلاغٌ بلا إخبارٍ (لا محادثةَ تُوجَّهُ إليها).
  const searching = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
    values (${cityId}, ${riderId}::uuid, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, 0)
    returning id
  `;
  searchingOrderId = searching[0]?.id ?? "";
  if (searchingOrderId === "") throw new Error("تعذّر تجهيز الطلب الباحث");
}

describeIf("آليّةُ بلاغِ المفقودِ على PostgreSQL حقيقيّةٍ (F12-07)", () => {
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

  it("تذكرةُ المفقودِ تُفتَحُ بلا طلبٍ — عقدُ F3-08 المحفوظُ، ولا ردَّ ORDER_REQUIRED", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM });
    expect(opened.ok).toBe(true);
    expect(opened.reference).toMatch(/^WSL-[0-9]{6,}$/);
    expect(await outboxRows()).toHaveLength(0);
  });

  it("البلاغُ يُودَعُ مشروطاً برحلةٍ منتهيةٍ مُسنَدٍ — في معاملةِ التذكرةِ نفسِها", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM, orderId: completedOrderId });
    expect(opened.ok).toBe(true);
    if (opened.ticket_id === undefined) throw new Error("الفتحُ بلا معرِّفِ تذكرةٍ");

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
    expect(row?.dedup_key).toBe(`lost_item:${opened.ticket_id}`);
    expect(row?.ticket_id).toBe(opened.ticket_id);
    expect(row?.order_id).toBe(completedOrderId);
    expect(row?.driver_id).toBe(driverId);
    expect(row?.reference).toBe(opened.reference);
  });

  it("طلبٌ بلا سائقٍ مُسنَدٍ يُفتَحُ تذكرتُه بلا بلاغٍ — فلا صفٌّ ميّتٌ يُحاولُ التسليمَ", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM, orderId: searchingOrderId });
    expect(opened.ok).toBe(true);
    expect(await outboxRows()).toHaveLength(0);
  });

  it("حارسُ مِلكيّةِ الطلبِ قائمٌ لم يُنزَعْ — ORDER_NOT_YOURS لغيرِ المالكِ", async () => {
    const opened = await openTicket({
      telegramId: OTHER_RIDER_TELEGRAM,
      orderId: completedOrderId,
    });
    expect(opened.ok).toBe(false);
    expect(opened.error).toBe("ORDER_NOT_YOURS");
    expect(await outboxRows()).toHaveLength(0);
    // ولا تذكرةَ كُتِبَت لغيرِ المالكِ.
    const tickets = await sql<{ count: number }[]>`
      select count(*)::integer as count from support_tickets where order_id = ${completedOrderId}::uuid
    `;
    expect(tickets[0]?.count).toBe(0);
  });

  it("رجوعُ معاملةِ الفتحِ لا يُبقي أثراً — لا تذكرةَ بلا بلاغٍ ولا بلاغَ بلا تذكرةٍ", async () => {
    const holder = createSql({ connectionString: DATABASE_URL ?? "", max: 1 });
    try {
      await holder
        .begin(async (tx) => {
          const opened = await tx<{ result: OpenPayload }[]>`
            select open_support_ticket(
              ${RIDER_TELEGRAM}::bigint, 'lost_item'::support_ticket_type,
              ${"نسيتُ حقيبتي"}::text, null::text, ${completedOrderId}::uuid
            ) as result
          `;
          expect(opened[0]?.result.ok).toBe(true);
          // البلاغُ وُضِعَ في المعاملةِ، ثمّ تُرجَعُ: لو كانَ أثراً صادراً لحظتَها لَبقيَ
          // بلاغٌ بلا تذكرةٍ بعدَ الرجوع.
          throw new Error("rollback");
        })
        .catch((error: unknown) => {
          expect(String(error)).toContain("rollback");
        });
    } finally {
      await holder.end({ timeout: 5 });
    }

    expect(await outboxRows()).toHaveLength(0);
    const tickets = await sql<{ count: number }[]>`
      select count(*)::integer as count from support_tickets where order_id = ${completedOrderId}::uuid
    `;
    expect(tickets[0]?.count).toBe(0);
  });

  it("الإغناءُ حيٌّ لحظةَ الالتقاطِ: محادثةُ السائقِ ولغتُه من القاعدةِ لا من الحمولةِ", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM, orderId: completedOrderId });
    expect(opened.ok).toBe(true);
    // اللغةُ تُغيَّرُ بعدَ الإيداعِ: لو جُمِّدت في الحمولةِ لَوصلت بالإنجليزيةِ.
    await sql`
      update users set language_code = 'ar'
       where id = ${driverUserId}::uuid
    `;

    const sent: Sent[] = [];
    const report = await run(sent);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe(String(DRIVER_TELEGRAM));
    expect(sent[0]?.language).toBe("ar");
    expect(sent[0]?.driverId).toBe(driverId);
    expect(sent[0]?.ticketId).toBe(opened.ticket_id);
    expect(sent[0]?.reference).toBe(opened.reference);

    const rows = await outboxRows();
    expect(rows[0]?.status).toBe("delivered");
  });

  it("مفتاحُ منعِ التكرارِ يردُّ الإيداعَ المُكرَّر — تذكرةٌ واحدةٌ بلاغٌ واحدٌ", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM, orderId: completedOrderId });
    expect(opened.ok).toBe(true);
    if (opened.ticket_id === undefined) throw new Error("الفتحُ بلا معرِّفِ تذكرةٍ");
    const ticketId = opened.ticket_id;

    // النداءُ المباشرُ بنفسِ المفتاحِ لا يُودِعُ صفّاً ثانياً.
    const repeated = await sql<{ id: string | null }[]>`
      select enqueue_notification(
        ${cityId}::uuid, 'lost_item_report',
        jsonb_build_object('ticket_id', ${ticketId}::text,
                           'driver_id', ${driverId}::text),
        ${`lost_item:${ticketId}`}
      ) as id
    `;
    expect(repeated[0]?.id).toBeNull();
    expect(await outboxRows()).toHaveLength(1);
  });

  it("صفٌّ بلا سائقٍ يُوجَدُ يُهجَرُ ولا يُعطِّلُ غيرَه", async () => {
    const opened = await openTicket({ telegramId: RIDER_TELEGRAM, orderId: completedOrderId });
    expect(opened.ok).toBe(true);
    // السائقُ غيرُ قابلٍ للوصولِ: نُبدِّلُ driver_id في الحمولةِ بمعرّفٍ لا سائقَ
    // له — فالالتقاطُ يَفشَلُ في قراءةِ المحادثةِ، والمعالجُ يُهجِرُ الصفَّ.
    // (لا يُحذَفُ السائقُ المُسنَدُ لأنَّ الطلبَ يَحيلُ إليه بقيدِ مفتاحٍ أجنبيٍّ،
    // ولا يُمكنُ تفريغُ telegram_id لأنَّ العمودَ not null.)
    await sql`
      update notification_outbox
         set payload = jsonb_set(payload, '{driver_id}', '"00000000-0000-0000-0000-000000000000"'::jsonb)
       where kind = 'lost_item_report'
    `;

    const sent: Sent[] = [];
    const report = await run(sent);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    // `SEC-19-ب-٣` — العنوانُ غائبٌ فلا يُحاوَلُ إرسالُه ولا يُعادُ: عُذِرَ تسليمُه
    // في القاعدةِ بـ`TELEGRAM_DELIVERY_NOT_REQUIRED` (غيرُ جوهريٍّ).
    expect(report.value.undeliverable).toBe(1);
    expect(report.value.abandoned).toBe(0);
    expect(report.value.delivered).toBe(0);
    expect(sent).toHaveLength(0);
    const rows = await outboxRows();
    expect(rows[0]?.status).toBe("undeliverable");
  });
});
