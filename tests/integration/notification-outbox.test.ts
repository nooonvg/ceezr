/**
 * اختبارُ قاعدةِ PostgreSQL حقيقيةٍ لمسارِ outbox إشعارِ العرضِ (BUG-004): الذرّيةُ
 *   بينَ العرضِ وصفِّ الإشعارِ في معاملةٍ واحدة، وعودةُ الصفِّ إلى pending بعد فشلِ
 *   الإرسالِ بلا تكرارِ أثر، واسترجاعُ الحجزِ المتروكِ، والتخلّي عن العرضِ الميّت.
 *   لا تيليجرامَ فعليٌّ هنا؛ الناشرُ المزدوجُ يُثبتُ أثرَ الإرسالِ ومعرّفَ الرسالةِ.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { deliverNotifications } from "../../apps/workers/src/jobs/deliver-notifications.ts";
import type { OfferPublisher } from "../../packages/application/dispatch/broadcast-offers.ts";
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferWriter } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let orderId: string;
let driverId: string;

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  // تفعيلٌ وقروباتُه في عبارةٍ واحدةٍ: مدينةٌ تُفعّل بلا قروباتِها تجعلُ نجاحَ
  // الاختبارِ معلّقاً على ملفٍ أسبقَ ضبطَها — والحاجزُ `check-test-city-activation` يمنعُه.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });

  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, 880002::bigint, 'راكب', '+966500880002', 'rider')
    returning id
  `;
  const riderUserId = riderUser[0]?.id ?? "";
  const rider = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}::uuid) returning id
  `;
  const riderId = rider[0]?.id ?? "";

  const driverUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, 990001::bigint, 'سائق', '+966500990001', 'driver')
    returning id
  `;
  const driverUserId = driverUser[0]?.id ?? "";
  const drv = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${driverUserId}::uuid, 'verified'::verification_status)
    returning id
  `;
  driverId = drv[0]?.id ?? "";
  if (driverId === "") throw new Error("تعذّر تجهيز السائق");

  const order = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (
      ${cityId}, ${riderId}::uuid, 'transport', 'searching',
      ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography
    )
    returning id
  `;
  orderId = order[0]?.id ?? "";
  if (orderId === "") throw new Error("تعذّر تجهيز الطلب");
}

async function openRound(): Promise<string> {
  const writer = createOfferWriter(sql);
  const written = await writer.openRound({
    orderId: orderId as OrderId,
    cityId: cityId as CityId,
    round: 1,
    entries: [{ driverId: driverId as DriverId, score: 10, distanceKm: 1.5 as DistanceKm }],
    expiresAt: new Date(Date.now() + 45_000),
  });
  if (!written.ok) throw new Error("فشل فتح الدورة");
  if (!written.value.opened) throw new Error("رفضت القاعدة فتح الدورة");
  const offerId = written.value.offers[0]?.offerId;
  if (offerId === undefined) throw new Error("لم يُرجَع معرّف عرض");
  return offerId;
}

/**
 * ناشرٌ مزدوجٌ يلتقطُ معرّفاتِ العروضِ المنشورة ويُرجعُ معرّفَ رسالةٍ ثابتًا.
 * failFirst = عددُ الاستدعاءاتِ الأولى التي تفشلُ بخطأٍ مؤقّت. messageId = null يُحاكي
 * رفضَ تيليجرامَ للرسالةِ (فشلٌ مؤقّتٌ كذلك، يُعادُ إرسالُه).
 */
function recordingPublisher(
  published: string[],
  messageId: string | null,
  failFirst: number,
): OfferPublisher {
  let calls = 0;
  return {
    publishOffer: async (notification) => {
      calls += 1;
      if (calls <= failFirst) {
        return err(new PortFailureError("publisher.publishOffer", "temporary failure"));
      }
      published.push(String(notification.offerId));
      return messageId === null
        ? err(new PortFailureError("publisher.publishOffer", "TELEGRAM_SEND_FAILED"))
        : ok(messageId);
    },
  };
}

describeIf("notification_outbox على PostgreSQL فعلية (BUG-004)", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;
    await createFixture();
  });

  it("فتحُ الدورةِ يكتبُ العرضَ وصفَّ الإشعارِ في معاملةٍ واحدةٍ", async () => {
    const offerId = await openRound();

    // العرضُ موجودٌ، وصفُّ الإشعارِ موجودٌ معه في نفسِ المعاملة — لا نافذةُ سباقٍ
    // يُوجَدُ فيها عرضٌ بلا إشعارٍ ينتظرُ العامل. هذا صميمُ BUG-004.
    const outbox = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from notification_outbox where offer_id = ${offerId}::uuid
    `;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.status).toBe("pending");
    expect(outbox[0]?.attempts).toBe(0);
  });

  it("رفضُ فتحِ الدورةِ لا يُتركُ أثرًا يتيمًا: لا عرضٌ بلا إشعار", async () => {
    // الطلبُ لم يَعُد يبحثُ، فلا تُفتحُ دورةٌ، ولا يُكتبُ عرضٌ ولا صفُّ إشعار.
    // 'cancelled' لا 'matched': الأخيرةُ تُلزِمُ بسائقٍ مُسنَدٍ (قيدُ التحقّقِ)،
    // أمّا 'cancelled' فحالٌ غيرُ باحثةٍ ولا يُكلِّفُ سائقًا — فيُرفضُ الفتحُ نظيفًا.
    await sql`update orders set status = 'cancelled' where id = ${orderId}::uuid`;
    const writer = createOfferWriter(sql);
    const written = await writer.openRound({
      orderId: orderId as OrderId,
      cityId: cityId as CityId,
      round: 1,
      entries: [{ driverId: driverId as DriverId, score: 10, distanceKm: 1.5 as DistanceKm }],
      expiresAt: new Date(Date.now() + 45_000),
    });
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.opened).toBe(false);

    const orphan = await sql<{ n: string }[]>`
      select count(*)::text as n from notification_outbox where order_id = ${orderId}::uuid
    `;
    expect(Number(orphan[0]?.n)).toBe(0);
    const offers = await sql<{ n: string }[]>`
      select count(*)::text as n from order_offers where order_id = ${orderId}::uuid
    `;
    expect(Number(offers[0]?.n)).toBe(0);
  });

  it("العاملُ يلتقطُ الصفَّ ويُسلّمُه بمعرّفِ رسالةٍ فعلًا", async () => {
    const offerId = await openRound();
    const published: string[] = [];
    const publisher = recordingPublisher(published, "msg-7", 0);

    const report = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: { offer: createOfferNotificationHandler(publisher) },
    });

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(1);
    expect(published).toEqual([offerId]);

    const delivered = await sql<{ status: string; attempts: number; message_id: string }[]>`
      select status, attempts, delivered_message_id as message_id from notification_outbox
      where offer_id = ${offerId}::uuid
    `;
    expect(delivered[0]).toEqual({ status: "delivered", attempts: 1, message_id: "msg-7" });
  });

  it("فشلُ الإرسالِ بعد نجاحِ المعاملةِ يُعادُ بلا تكرارِ أثر (BUG-004)", async () => {
    const offerId = await openRound();

    // المحاولةُ الأولى تفشلُ: الصفُّ يعودُ pending بموعدٍ جديد، ولا يُفقدُ العرضُ.
    const first = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: { offer: createOfferNotificationHandler(recordingPublisher([], "msg-8", 1)) },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.delivered).toBe(0);
    expect(first.value.failed).toBe(1);

    const pending = await sql<{ status: string; attempts: number }[]>`
      select status, attempts from notification_outbox where offer_id = ${offerId}::uuid
    `;
    expect(pending[0]?.status).toBe("pending");
    expect(pending[0]?.attempts).toBe(1);

    // نتجاوزُ فاصلَ الإعادةِ المأخوذَ من platform_settings؛ لا ننتظرُ 30 ثانية في اختبار.
    await sql`update notification_outbox set next_attempt_at = now() where offer_id = ${offerId}::uuid`;

    const published: string[] = [];
    const second = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: {
        offer: createOfferNotificationHandler(recordingPublisher(published, "msg-8", 0)),
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.delivered).toBe(1);
    // لا تكرارَ للأثر: نُشرَ مرّةً واحدةً فقط رغم المحاولتَين.
    expect(published).toEqual([offerId]);

    const delivered = await sql<{ status: string; attempts: number; message_id: string }[]>`
      select status, attempts, delivered_message_id as message_id from notification_outbox
      where offer_id = ${offerId}::uuid
    `;
    expect(delivered[0]).toEqual({ status: "delivered", attempts: 2, message_id: "msg-8" });
  });

  it("حجزٌ متروكٌ (عاملٌ انهار قبل الإعلان) يُستعادُ ويُسلَّم", async () => {
    const offerId = await openRound();
    // نُحاكي انهيارَ عاملٍ بعدَ الحجزِ: الصفُّ عالقٌ في sending بلا إعلان، وحجزُه قديم.
    await sql`
      update notification_outbox
         set status = 'sending', claim_token = gen_random_uuid(),
             claimed_at = now() - interval '1 hour', attempts = 1
       where offer_id = ${offerId}::uuid
    `;

    const published: string[] = [];
    const report = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: {
        offer: createOfferNotificationHandler(recordingPublisher(published, "msg-9", 0)),
      },
    });

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(1);
    expect(published).toEqual([offerId]);

    const delivered = await sql<{ status: string; message_id: string }[]>`
      select status, delivered_message_id as message_id from notification_outbox
      where offer_id = ${offerId}::uuid
    `;
    expect(delivered[0]?.status).toBe("delivered");
    expect(delivered[0]?.message_id).toBe("msg-9");
  });

  it("عرضٌ ميّتٌ (انتهت مهلته قبل أن يصلَه الإشعار) يُتخلى عنه لا يُعادُ أبدًا", async () => {
    const offerId = await openRound();
    // العرضُ انتهت مهلته قبل أن يصلَه الإشعارُ — لا فائدةَ من إرسالٍ لعرضٍ ميّت.
    await sql`update order_offers set expires_at = now() - interval '1 minute' where id = ${offerId}::uuid`;

    const published: string[] = [];
    const report = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: {
        offer: createOfferNotificationHandler(recordingPublisher(published, "msg-10", 0)),
      },
    });

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.delivered).toBe(0);
    expect(report.value.abandoned).toBe(1);
    expect(published).toEqual([]);

    const dead = await sql<{ status: string }[]>`
      select status from notification_outbox where offer_id = ${offerId}::uuid
    `;
    expect(dead[0]?.status).toBe("dead");
  });

  it("فشلٌ أثناء الإدراجِ يَرجعُ بالمعاملةِ كاملةً: لا رقمُ دورةٍ بلا عروضٍ ولا إشعار", async () => {
    // سائقٌ غيرُ موجودٍ في drivers يُفجّرُ قيدَ order_offers.driver_id الأجنبيَّ أثناء
    // الإدراجِ، بعد أن رُفِعَ broadcast_round. فيجبُ أن يرجعَ كلُّ شيءٍ: الرقمُ،
    // والعروضُ، وصفوفُ الإشعارِ — لا صفٌّ يتيمٌ ينتظرُ عاملًا على عرضٍ لم يُخلَق.
    const ghostDriver = "00000000-0000-0000-0000-000000000000" as DriverId;
    const writer = createOfferWriter(sql);
    const written = await writer.openRound({
      orderId: orderId as OrderId,
      cityId: cityId as CityId,
      round: 1,
      entries: [{ driverId: ghostDriver, score: 10, distanceKm: 1.5 as DistanceKm }],
      expiresAt: new Date(Date.now() + 45_000),
    });
    expect(written.ok).toBe(false);

    const round = await sql<{ n: string }[]>`
      select broadcast_round::text as n from orders where id = ${orderId}::uuid
    `;
    expect(Number(round[0]?.n)).toBe(0);
    const offers = await sql<{ n: string }[]>`
      select count(*)::text as n from order_offers where order_id = ${orderId}::uuid
    `;
    expect(Number(offers[0]?.n)).toBe(0);
    const orphan = await sql<{ n: string }[]>`
      select count(*)::text as n from notification_outbox where order_id = ${orderId}::uuid
    `;
    expect(Number(orphan[0]?.n)).toBe(0);
  });

  it("الصفُّ المُسلَّمُ لا يُلتقطُ ثانيةً: لا تكرارُ أثرٍ بعد التسليم (BUG-004)", async () => {
    const offerId = await openRound();

    // تسليمٌ ناجحٌ أوّلًا.
    const firstPublished: string[] = [];
    const first = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: {
        offer: createOfferNotificationHandler(recordingPublisher(firstPublished, "msg-11", 0)),
      },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.delivered).toBe(1);
    expect(firstPublished).toEqual([offerId]);

    // دورةٌ ثانيةٌ بناشرٍ يسجّلُ كلَّ نداءٍ: الصفُّ المُسلَّمُ لم يَعُد pending، فلا
    // يُلتقطُ أصلًا، ولا يُنشرُ له مرّةً ثانية.
    const secondPublished: string[] = [];
    const second = await deliverNotifications({
      outbox: createNotificationOutboxPort(sql),
      handlers: {
        offer: createOfferNotificationHandler(recordingPublisher(secondPublished, "msg-11", 0)),
      },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.delivered).toBe(0);
    expect(secondPublished).toEqual([]);
  });
});
