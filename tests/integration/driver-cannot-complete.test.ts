/**
 * الغرض: اختبارُ قاعدةٍ حقيقيّةٍ لسلسلةِ فعلِ «تعذّرَ الإكمالُ» (`PD-020`):
 *   بلاغُ سلامةٍ مرتبطٌ بالمَهمّةِ الجاريةِ للسائقِ بلا تغييرِ حالةٍ للطلبِ،
 *   وبطاقةُ الفريقِ تحملُ جنسَ البلاغِ، وسردُ الحالِ يفصلُ «استُقبِلَ» عن
 *   «اطّلعَ» — والمطالبةُ البشريّةُ وحدَها تقلبُ «اطّلعَ».
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun test` (عمليةُ تكاملِ PostgreSQL في CI).
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * لا يوجدُ Telegram فعليٌّ ههنا؛ الناشرُ المزدوجُ يُثبِتُ أثرَ الإرسالِ فحسب.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverSafetyIncidents } from "../../apps/workers/src/jobs/deliver-safety-incidents.ts";
import type { SafetyCardPublisher } from "../../packages/application/safety/ports.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDriverCannotCompletePort } from "../../packages/infrastructure/safety/driver-cannot-complete-store.ts";
import {
  createSafetyDeliveryPort,
  createSafetyResolutionPort,
  createTriggerSosPort,
} from "../../packages/infrastructure/safety/safety-adapters.ts";
import { createSosSurfaceReader } from "../../packages/infrastructure/safety/sos-surface-store.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM_ID = "889001";
const DRIVER_TELEGRAM_ID = "889002";
const SUPPORT_TELEGRAM_ID = "889101";
const ESCALATION_GROUP = "-100889";
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;
let driverId: string;
let cannot: ReturnType<typeof createDriverCannotCompletePort>;
let trigger: ReturnType<typeof createTriggerSosPort>;
let resolution: ReturnType<typeof createSafetyResolutionPort>;
let surface: ReturnType<typeof createSosSurfaceReader>;

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  cityHandle = await ensureActiveCity(sql, {
    groups: { support: -100891, escalation: ESCALATION_GROUP, unsubscribed: -100892 },
    prior: cityHandle,
  });
  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${RIDER_TELEGRAM_ID}::bigint, 'راكب تعذّر الإكمال', '+966500889001', 'rider')
    returning id
  `;
  const riderUserId = riderUser[0]?.id;
  if (riderUserId === undefined) throw new Error("تعذر تجهيز الراكب");
  const rider = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}::uuid) returning id
  `;
  const riderId = rider[0]?.id;
  if (riderId === undefined) throw new Error("تعذر تجهيز ملف الراكب");

  const driverUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}::bigint, 'سائق تعذّر الإكمال', '+966500889002', 'driver')
    returning id
  `;
  const driverUserId = driverUser[0]?.id;
  if (driverUserId === undefined) throw new Error("تعذر تجهيز السائق");
  const driver = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number,
                         national_id, vehicle_photo_file_id, preferred_area_label,
                         preferred_area_location,
                         logo_object_path, barcode_object_path, rating_average, rating_count)
    values (${cityId}, ${driverUserId}::uuid, 'verified', 'sedan', 'ح ط 8890',
            '10889002', 'file-photo-1', 'حيُّ الاختبارِ',
            st_setsrid(st_makepoint(39.8, 21.4), 4326)::geography,
            'logos/test.png', 'barcodes/test.png', 4.5, 7)
    returning id
  `;
  driverId = driver[0]?.id ?? "";
  if (driverId === "") throw new Error("تعذر تجهيز صف السياقة");

  // مَهمّةٌ **جاريةٌ**: أُسندَتْ للسائقِ ولم تُكملْ — الفعلُ لا يظهرُ إلّا عليها.
  const order = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, assigned_driver_id)
    values (
      ${cityId}, ${riderId}::uuid, 'transport', 'matched',
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography,
      ${driverId}::uuid
    )
    returning id
  `;
  orderId = order[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذر تجهيز الطلب");
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, ${SUPPORT_TELEGRAM_ID}::bigint, 'مدير الإسناد', '+966500889101', 'admin')
  `;
}

/** قراءةُ سردِ السائقِ لدورِهِ — الحاكمُ واحدٌ بسؤالِهِ واحدٍ. */
async function readDriverIncident(): Promise<{
  status: string;
  teamDeliveryStatus: string;
} | null> {
  const verdict = await surface.read({ telegramUserId: DRIVER_TELEGRAM_ID, role: "driver" });
  if (!verdict.ok || !verdict.value.found) return null;
  const incident = verdict.value.state.incident;
  return incident === null
    ? null
    : { status: incident.status, teamDeliveryStatus: incident.teamDeliveryStatus };
}

describeIf("فعل تعذّر الإكمال على PostgreSQL فعلية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, safety_incident_deliveries, safety_incidents, order_offers, orders,
        driver_availability, drivers, riders, users restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, safety_incident_deliveries, safety_incidents, order_offers, orders,
        driver_availability, drivers, riders, users restart identity cascade
    `;
    await createFixture();
    cannot = createDriverCannotCompletePort(sql);
    trigger = createTriggerSosPort(sql);
    resolution = createSafetyResolutionPort(sql);
    surface = createSosSurfaceReader(sql);
  });

  it("سلسلة التعذّر: بلاغٌ مرتبطٌ بالمَهمّةِ بلا تغييرِ حالةٍ، ثمّ «استُقبِلَ»، ثمّ «اطّلعَ»", async () => {
    const reported = await cannot.report({
      actorTelegramId: DRIVER_TELEGRAM_ID,
      orderId,
    });
    expect(reported.ok).toBe(true);
    if (!reported.ok || reported.value.incidentId === null) return;
    expect(reported.value.created).toBe(true);
    const incidentId = reported.value.incidentId;

    // **جوهرُ البندِ**: بلاغُ سلامةٍ لا انتقالَ حالةٍ — الطلبُ كما كانَ.
    const incident = await sql<{ reason: string; reporter_role: string; order_id: string }[]>`
      select reason, reporter_role, order_id::text from safety_incidents where id = ${incidentId}::uuid
    `;
    expect(incident[0]?.reason).toBe("driver_cannot_complete");
    expect(incident[0]?.reporter_role).toBe("driver");
    expect(incident[0]?.order_id).toBe(orderId);
    const orderRow = await sql<{ status: string; assigned_driver_id: string | null }[]>`
      select status, assigned_driver_id::text from orders where id = ${orderId}::uuid
    `;
    expect(orderRow[0]?.status).toBe("matched");
    expect(orderRow[0]?.assigned_driver_id).toBe(driverId);

    // «استُقبِلَ البلاغُ» **قبلَ** «اطّلعَ عليهِ الفريقُ»: السردُ يفصلُ بينَهما.
    expect(await readDriverIncident()).toEqual({ status: "open", teamDeliveryStatus: "pending" });

    // البطاقةُ تحملُ جنسَ البلاغِ — القالبُ يُختارُ بهِ في الناشرِ الحقيقيِّ.
    const published: { reason: string; orderId: string | null; reporterRole: string }[] = [];
    const publisher: SafetyCardPublisher = {
      publish: async (card) => {
        published.push({
          reason: card.incidentReason,
          orderId: card.orderId,
          reporterRole: card.reporterRole,
        });
        return ok("99001");
      },
    };
    const delivered = await deliverSafetyIncidents({
      deliveries: createSafetyDeliveryPort(sql),
      publisher,
    });
    expect(delivered.ok).toBe(true);
    if (delivered.ok) expect(delivered.value.delivered).toBe(1);
    expect(published).toEqual([
      { reason: "driver_cannot_complete", orderId, reporterRole: "driver" },
    ]);

    // سُلِّمَ للفريقِ ولم يطَّلِعْ أحدٌ بعدُ: «استُقبِلَ» وحدها.
    expect(await readDriverIncident()).toEqual({ status: "open", teamDeliveryStatus: "delivered" });

    // المطالبةُ البشريّةُ وحدَها تقلبُ «اطّلعَ».
    const claimed = await resolution.claim(incidentId, SUPPORT_TELEGRAM_ID);
    expect(claimed.ok).toBe(true);
    if (claimed.ok) expect(claimed.value.claimed).toBe(true);
    expect(await readDriverIncident()).toEqual({
      status: "received",
      teamDeliveryStatus: "delivered",
    });

    const closed = await resolution.resolve({
      incidentId,
      actorTelegramId: SUPPORT_TELEGRAM_ID,
      decision: "close",
      decisionReason: "resolved",
    });
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.value.resolved).toBe(true);
    expect(await readDriverIncident()).toEqual({
      status: "closed",
      teamDeliveryStatus: "delivered",
    });
  });

  it("بلاغُ تعذّرٍ بعدَ استغاثةٍ على المَهمّةِ نفسِها يعيدُ البلاغَ القائمَ لا بلاغاً ثانياً", async () => {
    const opened = await trigger.trigger({
      orderId,
      actorTelegramId: DRIVER_TELEGRAM_ID,
      reporterRole: "driver",
      reason: "sos",
    });
    expect(opened.ok).toBe(true);

    const reported = await cannot.report({
      actorTelegramId: DRIVER_TELEGRAM_ID,
      orderId,
    });
    expect(reported.ok).toBe(true);
    if (!reported.ok) return;
    // «بلاغُكَ الأوّلُ قائمٌ»: نجاحٌ لا فشلٌ، وبلاغٌ واحدٌ لا بلاغانِ.
    if (reported.value.incidentId === null) {
      throw new Error("كان يجب أن يُعادَ البلاغُ القائمُ");
    }
    expect(reported.value.created).toBe(false);
    expect(reported.value.incidentId).toBe(
      opened.ok && opened.value.incidentId !== null
        ? opened.value.incidentId
        : reported.value.incidentId,
    );
    const counts = await sql<{ incidents: string; deliveries: string }[]>`
      select
        (select count(*)::text from safety_incidents where order_id = ${orderId}::uuid) incidents,
        (select count(*)::text from notification_outbox where kind = 'safety_incident') deliveries
    `;
    expect(Number(counts[0]?.incidents)).toBe(1);
    expect(Number(counts[0]?.deliveries)).toBe(1);
  });

  it("فعلٌ على مَهمّةٍ غيرِ قائمةٍ يُرَدُّ برمزِ المَهمّةِ لا برمزِ مِلكيّةٍ", async () => {
    const reported = await cannot.report({
      actorTelegramId: DRIVER_TELEGRAM_ID,
      orderId: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
    });
    expect(reported.ok).toBe(true);
    if (reported.ok) {
      expect(reported.value.incidentId).toBe(null);
      if (reported.value.incidentId === null) {
        expect(reported.value.rejection).toBe("JOB_NOT_FOUND");
      }
    }
  });

  it("من ليسَ سائقاً لا يفتحُ بابَ الفعلِ — الرمزُ دورٌ لا مِلكيّةٌ", async () => {
    const reported = await cannot.report({
      actorTelegramId: RIDER_TELEGRAM_ID,
      orderId,
    });
    expect(reported.ok).toBe(true);
    if (reported.ok) {
      expect(reported.value.incidentId).toBe(null);
      if (reported.value.incidentId === null) {
        expect(reported.value.rejection).toBe("NOT_A_DRIVER");
      }
    }
    const counts = await sql<{ incidents: string }[]>`
      select count(*)::text as incidents from safety_incidents
    `;
    expect(Number(counts[0]?.incidents)).toBe(0);
  });
});
