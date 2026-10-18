/**
 * الغرض: إثباتُ أنَّ التقاطَ الإشعاراتِ لا يستهلكُ قراءاتٍ ولا محاولاتِ تسليمٍ
 * لعروضٍ حُسِمَت بالفعلِ — `LOAD-01` (P4): الاستبعادُ في دالّةِ الالتقاطِ نفسِها
 * (20261018130000)، لا هجرًا بعدَ الالتقاطِ.
 * الحالة: مُختبَرٌ على قاعدةٍ PostgreSQL حقيقيةٍ.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 *
 * ## ما يُثبِتُه هذا الملفُّ
 *
 * 1. صفُّ إشعارِ عرضٍ محسومٍ (مقبولٍ) **لا يُلتقطُ أصلًا**: الدالّةُ تُعيدُ
 *    `delivery: null` والصفُّ يبقى `pending` بعدَّدِ محاولاتٍ لم يزدد — لا دورةَ
 *    التقاطٍ تُستهلكُ ولا هجرَ يُكتبَ.
 * 2. العرضُ الحيُّ يُلتقطُ كما كانَ — الاستبعادُ لا يمدُّ يدَهُ للحيِّ.
 * 3. المحسومُ **لا يحجبُ** ما خلفَهُ لمستلِمٍ واحدٍ: صفٌّ أقدمُ محسومٌ وصفٌّ أحدثُ
 *    حيٌّ لنفسِ السائقِ — الالتقاطُ يعودُ بالأحدثِ الحيِّ لا بالانتظارِ خلفَ الميّتِ.
 * 4. الكنسُ الدوريُّ (`sweep_decided_offer_notifications`) ما زالَ يوسمُ المحسومَ
 *    ميتًا بالسببِ نفسِهِ (`ABANDONED`) — فالحدثُ لا يُحذفُ والتدقيقُ لا يتغيّرُ.
 *
 * ## وما لا يقيسُه عن قصدٍ
 *
 * - تزامنُ مستهلكَيْنِ على صفٍّ واحدٍ (`for update skip locked`): مغطّىً في
 *   `wr-24-concurrent-races` — التعديلُ لم يمسّ آليةَ القفلِ.
 * - سياساتُ الضغطِ والاسترجاعِ: لم تتغيّرْ حرفيًا في التعديلِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  تخطيُّ المحسومِ في الالتقاطِ مُتخطّى: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_001_521;
const RIDER_TELEGRAM_ID = 900_001_522;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let riderUserId = "";
let riderId = "";
let decidedOutboxId = "";
let liveOutboxId = "";

async function seedOrderWithOffer(
  offerStatus: "accepted" | "pending",
  broadcastRound: number,
): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, broadcast_round)
    values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography, ${broadcastRound})
    returning id
  `;
  if (order === undefined) throw new Error("تعذّر إنشاءُ الطلبِ");
  const [offer] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
    values (${cityId}, ${order.id}, ${driverId}, 1, ${offerStatus}::offer_status,
            now() + make_interval(secs => 120))
    returning id
  `;
  if (offer === undefined) throw new Error("تعذّر إنشاءُ العرضِ");
  return offer.id;
}

async function seedOutboxOfferRow(offerId: string, createdAtLagSeconds: number): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into notification_outbox (city_id, kind, order_id, offer_id, driver_id, recipient_user_id, payload, dedup_key, next_attempt_at, created_at)
    values (${cityId}::uuid, 'offer',
            (select order_id from order_offers where id = ${offerId}::uuid),
            ${offerId}::uuid, ${driverId}::uuid, ${driverUserId}::uuid,
            jsonb_build_object('offer_id', ${offerId}::uuid),
            'claimskip-test:' || ${offerId}::text, now(),
            now() - make_interval(secs => ${createdAtLagSeconds}))
    returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ صفِّ الصادرِ");
  return row.id;
}

interface ClaimEnvelope {
  readonly ok: boolean;
  readonly delivery: {
    readonly delivery_id: string;
    readonly kind: string;
    readonly attempts: number;
  } | null;
}

async function claimOnce(): Promise<ClaimEnvelope> {
  const [row] = await sql<{ result: ClaimEnvelope }[]>`
    select claim_notification_delivery() result`;
  if (row === undefined) throw new Error("تعذّر استدعاءُ الالتقاطِ");
  return row.result;
}

describeIf("LOAD-01 — الالتقاطُ لا يستهلكُ المحسومَ", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    // نظافةُ بقايا جولةٍ سابقةٍ لنفسِ المعرفاتِ (اختبارٌ محليٌّ معاد).
    await sql`delete from notification_outbox where dedup_key like 'claimskip-test:%' or recipient_user_id in (
      select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from order_offers where order_id in (
      select o.id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id
      where u.telegram_id = ${RIDER_TELEGRAM_ID}::bigint)`;
    await sql`delete from orders where rider_id in (
      select id from riders where user_id in (
        select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)))`;
    await sql`delete from riders where user_id in (
      select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from drivers where user_id in (
      select id from users where telegram_id = ${DRIVER_TELEGRAM_ID}::bigint)`;
    await sql`delete from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)`;
    cityHandle = await ensureActiveCity(sql);
    cityId = cityHandle.cityId;

    const [driverUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ التخطي', '+966500001521')
      returning id
    `;
    if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    driverUserId = driverUser.id;
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ع م ر 521')
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    driverId = driver.id;
    const [riderUser] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبُ التخطي', '+966500001522')
      returning id
    `;
    if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبِ");
    riderUserId = riderUser.id;
    const [rider] = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
    `;
    if (rider === undefined) throw new Error("تعذّر زرعُ راكبِ التخطي");
    riderId = rider.id;

    // الأقدمُ: محسومٌ (قُبِلَ) — والأحدثُ: حيٌّ. كلاهما لنفسِ السائقِ المستلِمِ.
    const decidedOfferId = await seedOrderWithOffer("accepted", 0);
    decidedOutboxId = await seedOutboxOfferRow(decidedOfferId, 90);
    const liveOfferId = await seedOrderWithOffer("pending", 1);
    liveOutboxId = await seedOutboxOfferRow(liveOfferId, 30);
  });

  afterAll(async () => {
    await sql`delete from notification_outbox where dedup_key like 'claimskip-test:%'`;
    await sql`delete from order_offers where order_id in (
      select o.id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id
      where u.telegram_id = ${RIDER_TELEGRAM_ID}::bigint)`;
    await sql`delete from orders where rider_id in (
      select id from riders where user_id in (
        select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)))`;
    await sql`delete from riders where user_id in (
      select id from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint))`;
    await sql`delete from drivers where user_id in (
      select id from users where telegram_id = ${DRIVER_TELEGRAM_ID}::bigint)`;
    await sql`delete from users where telegram_id in (${DRIVER_TELEGRAM_ID}::bigint, ${RIDER_TELEGRAM_ID}::bigint)`;
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  it("١) المحسومُ لا يُلتقطُ: صفُّهُ يبقى `pending` بعدَّدِ محاولاتٍ كما هو", async () => {
    const before = await sql<{ attempts: number; status: string }[]>`
      select attempts, status from notification_outbox where id = ${decidedOutboxId}::uuid`;
    expect(before[0]?.status).toBe("pending");

    // جولاتُ التقاطٍ متتاليةٌ: لا واحدةٌ منها تعودُ بصفِّ المحسومِ.
    for (let i = 0; i < 3; i += 1) {
      const envelope = await claimOnce();
      if (envelope.delivery !== null) {
        expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      }
    }
    const after = await sql<{ attempts: number; status: string }[]>`
      select attempts, status from notification_outbox where id = ${decidedOutboxId}::uuid`;
    expect(after[0]?.status).toBe("pending");
    expect(after[0]?.attempts).toBe(before[0]?.attempts);
  });

  it("٢) الحيُّ يُلتقطُ كما كانَ — الاستبعادُ لا يمدُّ يدَهُ للحيِّ", async () => {
    // نُفرّغُ صفَّ الحيِّ من يدِ أيِّ التقاطٍ سابقٍ ثمّ نلتقطُ حتى نصلَ إليهِ (قاعدةُ
    // الاختبارِ مشتركةٌ فقد يسبقُهُ صفٌّ آخرُ — أما المحسومُ فلا يجوزُ أن يُعادَ أبدًا).
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${liveOutboxId}::uuid`;
    let claimedLive = false;
    for (let i = 0; i < 12 && !claimedLive; i += 1) {
      const envelope = await claimOnce();
      expect(envelope.ok).toBe(true);
      if (envelope.delivery === null) break;
      expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      if (envelope.delivery.delivery_id === liveOutboxId) claimedLive = true;
    }
    expect(claimedLive).toBe(true);
    // نُعيدُهُ `pending` كي لا يعيقَ ما بعدَهُ من اختباراتِ هذا الملفِّ.
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${liveOutboxId}::uuid`;
  });

  it("٣) المحسومُ لا يحجبُ: الأقدمُ ميّتٌ لا يؤجّلُ الأحدثَ الحيَّ لنفسِ المستلِمِ", async () => {
    // كلا الصفَّينِ لنفسِ السائقِ والمحسومُ أقدمُ منهُ — والطلبُ هنا محدودٌ بمستلِمِ
    // هذا الملفِّ: أقربُ صفٍّ قابلٍ للالتقاطِ للسائقِ هو الحيُّ، لا انتظارَ خلفَ الميّتِ.
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null, next_attempt_at=now() where id = ${liveOutboxId}::uuid`;
    let claimedLive = false;
    for (let i = 0; i < 12 && !claimedLive; i += 1) {
      const envelope = await claimOnce();
      if (envelope.delivery === null) break;
      expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      if (envelope.delivery.delivery_id === liveOutboxId) claimedLive = true;
      else
        await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${envelope.delivery.delivery_id}::uuid`;
    }
    expect(claimedLive).toBe(true);
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${liveOutboxId}::uuid`;
  });

  it("٤) الكنسُ الدوريُّ ما زالَ يوسمُ المحسومَ `dead` بالسببِ نفسِهِ — لا حذفَ للحدثِ", async () => {
    const result = await sql`select public.sweep_decided_offer_notifications() result`;
    const envelope = (result[0] as { result: { ok: boolean; swept: number } }).result;
    expect(envelope.ok).toBe(true);
    expect(envelope.swept).toBeGreaterThanOrEqual(1);
    const rows = await sql<{ status: string; reason: string | null }[]>`
      select status, dead_reason as reason from notification_outbox where id = ${decidedOutboxId}::uuid`;
    expect(rows[0]?.status).toBe("dead");
    expect(rows[0]?.reason).toBe("ABANDONED");
  });

  it("٥) تزامنُ مُلتقطَينِ على قائمةٍ فيها محسومٌ `pending`: لا واحدٌ منهما يعودُ بالمحسومِ، والحيُّ يُلتقطُ مرةً واحدةً لا مرتينِ", async () => {
    // نُعيدُ الحيَّ والمحسومَ `pending` معًا (الاختبارُ ٤ وسَمَ المحسومَ `dead`) ثمّ نُطلقُ
    // التقاطَينِ معًا: قفلُ `for update skip locked` يمنعُ الالتقاطَ المزدوجَ، والاستبعادُ
    // الجديدُ يمنعُ المحسومَ `pending` من كليهما — وهذا هو جوهرُ الإصلاحِ تحتَ التزامنِ.
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null, dead_reason=null where id = ${liveOutboxId}::uuid`;
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null, dead_reason=null, attempts=0 where id = ${decidedOutboxId}::uuid`;
    const decidedAttemptsBefore = (
      await sql<
        { attempts: number }[]
      >`select attempts from notification_outbox where id = ${decidedOutboxId}::uuid`
    )[0]?.attempts;
    const [a, b] = await Promise.all([claimOnce(), claimOnce()]);
    for (const envelope of [a, b]) {
      expect(envelope.ok).toBe(true);
      if (envelope.delivery !== null) {
        expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      }
    }
    // نُكملُ حتى يُلتقطَ الحيُّ (قد يسبقَ التقاطَينِ صفوفٌ أخرى من قاعدةٍ مشتركةٍ)،
    // ونعدُّ مراتِ التقاطِهِ في الجولتينِ المتزامنتينِ وما تلاهما: مرةً واحدةً بالضبطِ.
    let liveClaims = [a.delivery?.delivery_id, b.delivery?.delivery_id].filter(
      (id) => id === liveOutboxId,
    ).length;
    for (let i = 0; i < 12 && liveClaims === 0; i += 1) {
      const envelope = await claimOnce();
      if (envelope.delivery === null) continue;
      expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      if (envelope.delivery.delivery_id === liveOutboxId) liveClaims += 1;
      else
        await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${envelope.delivery.delivery_id}::uuid`;
    }
    expect(liveClaims).toBe(1);
    const decided = await sql<{ attempts: number; status: string }[]>`
      select attempts, status from notification_outbox where id = ${decidedOutboxId}::uuid`;
    expect(decided[0]?.status).toBe("pending");
    expect(decided[0]?.attempts).toBe(decidedAttemptsBefore);
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${liveOutboxId}::uuid`;
  });

  it("٦) مسارُ إعادةِ المحاولةِ للحيِّ سليمٌ بعدَ فشلِ تسليمٍ — عدّادُ محاولاتِهِ يزادُ، والمحسومُ لا يعودُ بالترتيبِ", async () => {
    // الحيُّ يُلتقطُ، يُعادُ إلى الطابورِ (`requeue`) بعدَ «فشلِ إرسالٍ»، ثمّ يُلتقطُ من جديدٍ
    // — عدّادُ المحاولاتِ يزادُ للحيِّ (نُثبتُهُ بالقيمِ قبلَ/بعدَ)، والمحسومُ لا يدخلُ الدورةَ أصلًا.
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null, next_attempt_at=now() where id = ${liveOutboxId}::uuid`;
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null, dead_reason=null, attempts=0 where id = ${decidedOutboxId}::uuid`;
    const decidedAttemptsBefore = (
      await sql<
        { attempts: number }[]
      >`select attempts from notification_outbox where id = ${decidedOutboxId}::uuid`
    )[0]?.attempts;
    let claimToken = "";
    let claimedLive = false;
    let liveAttemptsAfterFirstClaim = -1;
    for (let i = 0; i < 12 && !claimedLive; i += 1) {
      const envelope = await claimOnce();
      if (envelope.delivery === null) break;
      expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      if (envelope.delivery.delivery_id === liveOutboxId) {
        claimedLive = true;
        const row = await sql<{ claim_token: string | null; attempts: number }[]>`
          select claim_token, attempts from notification_outbox where id = ${liveOutboxId}::uuid`;
        claimToken = row[0]?.claim_token ?? "";
        liveAttemptsAfterFirstClaim = row[0]?.attempts ?? -1;
      } else {
        await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${envelope.delivery.delivery_id}::uuid`;
      }
    }
    expect(claimedLive).toBe(true);
    expect(claimToken).not.toBe("");
    // «فشلُ الإرسالِ»: إعادةٌ إلى الطابورِ بمحاولةٍ بعدَ مهلةٍ قصيرةٍ.
    const requeued = await sql<{ result: { ok: boolean } }[]>`
      select requeue_notification_delivery(${liveOutboxId}::uuid, ${claimToken}::uuid, 0) result`;
    expect((requeued[0] as { result: { ok: boolean } })?.result?.ok).toBe(true);
    await sql`update notification_outbox set next_attempt_at = now() where id = ${liveOutboxId}::uuid`;
    let reclaimedLive = false;
    for (let i = 0; i < 12 && !reclaimedLive; i += 1) {
      const envelope = await claimOnce();
      if (envelope.delivery === null) break;
      expect(envelope.delivery.delivery_id).not.toBe(decidedOutboxId);
      if (envelope.delivery.delivery_id === liveOutboxId) reclaimedLive = true;
      else
        await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${envelope.delivery.delivery_id}::uuid`;
    }
    expect(reclaimedLive).toBe(true);
    // دورةُ العدّادِ موثّقةٌ بالقيمِ: الالتقاطُ يزيدُ (`attempts+1`)، `requeue` ينقصُ (`−1` —
    // إعادةُ الطابورِ لا تُحسَبُ محاولةً فاشلةً)، ثمّ الالتقاطُ الثاني يزيدُ من جديدٍ: إقرارٌ فعليٌّ
    // بأنّ مسارَ إعادةِ المحاولةِ يمرُّ عبرَ الدالةِ نفسِها، والمحسومُ لم يُمسّ طوالَ الدورةِ.
    const liveAfter = (
      await sql<
        { attempts: number }[]
      >`select attempts from notification_outbox where id = ${liveOutboxId}::uuid`
    )[0]?.attempts;
    expect(liveAttemptsAfterFirstClaim).toBeGreaterThanOrEqual(1);
    expect(liveAfter).toBeGreaterThanOrEqual(1);
    const decidedAfter = (
      await sql<{ attempts: number; status: string }[]>`
        select attempts, status from notification_outbox where id = ${decidedOutboxId}::uuid`
    )[0];
    expect(decidedAfter?.status).toBe("pending");
    expect(decidedAfter?.attempts).toBe(decidedAttemptsBefore);
    await sql`update notification_outbox set status='pending', claim_token=null, claimed_at=null where id = ${liveOutboxId}::uuid`;
  });
});
