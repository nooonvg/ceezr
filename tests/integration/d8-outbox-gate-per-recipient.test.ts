/**
 * `D8` (CAP-RUN-20261016-CONTINUATION · المرحلة 4) — بوابةُ تسلسلِ «نفسِ الطلبِ»
 * في التقاطِ صندوقِ الصادرِ تسري على **المستلِمِ نفسِهِ** لا على الطلبِ كلِّهِ.
 *
 * المُقاسُ قبلَ الإصلاحِ (جولةُ J1 على مقعدِ D8): عرضٌ قديمٌ للسائقِ (أولويةٌ ٢)
 * كان يحجبُ إشعارَ طورِ الرحلةِ للراكبِ (أولويةٌ ١) لنفسِ الطلبِ — لأنَّ بوابةَ
 * «نفسِ الطلبِ» تنظرُ إلى أقدمِ صفٍّ للطلبِ أيا كان مستلِمُهُ. تحتَ عاصفةِ العروضِ
 * (122 صفًّا/ث) انتظرتِ الحرجةُ خلفَ العروضِ فتجاوزَ أثرُها الزمنيُّ كلَّ حدٍّ.
 *
 * هذا الاختبارُ يُثبتُ المعادلةَ بعدَ الإصلاحِ: الصفُّ الأقدمُ لمستلِمٍ آخرَ
 * (العرضُ للسائقِ) **لا يحجبُ** الأحدثَ للمستلِمِ المقصودِ (إشعارُ الراكبِ) —
 * والتسلسلُ داخلَ المستلِمِ الواحدِ **يبقى** (صفٌّ أقدمُ لنفسِ المستلِمِ يحجبُ
 * الأحدثَ كما قصدَ التصميمُ: قصتُهُ تصلُهُ بترتيبِها).
 *
 * الحالة: اختبار تكاملٍ — يتطلب TEST_DATABASE_URL (قاعدة PostgreSQL بها الهجراتُ
 * ومنها 20261016130000). يُتخطّى بلا TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  بوابةُ D8 للمستلِمِ مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

type Json = Record<string, unknown>;
const sql = createSql({ connectionString: DATABASE_URL as string });
const RIDER_TG = 9_410_001;
const DRIVER_TG = 9_410_002;

interface OutboxRow {
  id: string;
  kind: string;
  recipient_user_id: string | null;
}

/** ادّعاءُ صفٍّ واحدٍ من الصندوقِ — يُعيدُ الصفَّ المُلتقَطَ أو null. */
async function claimOnce(): Promise<OutboxRow | null> {
  const rows = await sql<{ result: Json }[]>`select claim_notification_delivery() result`;
  const envelope = rows[0]?.result as { ok?: boolean; delivery?: Json } | null;
  if (envelope?.ok !== true) throw new Error("claim_notification_delivery ردّ بخطأ");
  const delivery = envelope.delivery as { delivery_id?: string; kind?: string } | null;
  return delivery === null
    ? null
    : { id: String(delivery.delivery_id), kind: String(delivery.kind), recipient_user_id: null };
}

/** أولُ صفٍّ من النتيجةِ — فشلُ البذرِ خطأٌ صريحٌ لا صمتٌ (وبلا تأكيدِ غير-العدمِ). */
function first<T>(rows: T[]): T {
  if (rows.length === 0 || rows[0] === undefined) throw new Error("تعذّرَ البذرُ — صفٌّ فارغٌ");
  return rows[0];
}

describeIf("D8 — بوابةُ صندوقِ الصادرِ: التسلسلُ على المستلِمِ لا على الطلبِ", () => {
  let cityId: string;
  let riderUserId: string;
  let driverUserId: string;
  let orderId: string;
  const created: string[] = [];

  beforeAll(async () => {
    // ── تنظيفُ بقايا الجولاتِ الفاشلةِ بهويةِ الاختبارِ (الالتقاطُ يتركُ صفوفَ
    // «sending» إن انهارَ الاختبارُ قبلَ إنهائِها، والبذرُ يعيدُ الإدخالَ فيصيرُ
    // التكرارُ حتميًّا بلا هذا التنظيفِ الموجَّهِ — لا truncate عامًّا).
    await sql`update notification_outbox set status='dead', dead_reason='D8_TEST_PURGE', died_at=now()
              where recipient_user_id in (select id from users where telegram_id in (${RIDER_TG}::bigint, ${DRIVER_TG}::bigint))
                 or dedup_key like 'd8-gate:%' or dedup_key like 'd8dbg:%'`;
    await sql`delete from notification_outbox where city_id in (select id from cities where code = 'd8gate')`;
    await sql`delete from notification_outbox where recipient_user_id in (select id from users where telegram_id in (${RIDER_TG}::bigint, ${DRIVER_TG}::bigint))`;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id in (select id from riders where user_id in (select id from users where telegram_id in (${RIDER_TG}::bigint, ${DRIVER_TG}::bigint))))`;
    await sql`delete from orders where rider_id in (select id from riders where user_id in (select id from users where telegram_id in (${RIDER_TG}::bigint, ${DRIVER_TG}::bigint)))`;
    await sql`delete from riders where user_id in (select id from users where telegram_id in (${RIDER_TG}::bigint, ${DRIVER_TG}::bigint))`;
    await sql`delete from drivers where user_id in (select id from users where telegram_id in (${DRIVER_TG}::bigint))`;
    await sql`delete from users where telegram_id in (${RIDER_TG}::bigint, ${DRIVER_TG}::bigint)`;

    // ── البذرُ المُتحكَّمُ: مدينةٌ فعّالةٌ وراكبٌ وسائقٌ وطلبٌ واحدٌ وعرضانِ.
    // مدينةُ اختبارٍ خاصَّةٌ فعّالةٌ (الالتقاطُ لا يرى صفوفَ المدنِ غيرِ الفعّالةِ).
    const city = first(
      await sql<{ id: string }[]>`
      insert into cities (code, name_ar, name_en, is_active, telegram_support_group_id, telegram_escalation_group_id, telegram_unsubscribed_drivers_group_id)
      values ('d8gate', 'مدينة بوابة D8', 'D8 Gate City', true, -1000000000041, -1000000000042, -1000000000043)
      on conflict (code) do update set is_active = true
      returning id`,
    );
    if (city === undefined) throw new Error("تعذّرَ تهيئةُ مدينةِ الاختبارِ.");
    cityId = city.id;

    const riderUser = first(
      await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}::uuid, ${RIDER_TG}::bigint, 'راكب بوابة D8', '+96659410001', 'ar', 'rider'::user_role)
      returning id`,
    );
    const driverUser = first(
      await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}::uuid, ${DRIVER_TG}::bigint, 'سائق بوابة D8', '+96659410002', 'ar', 'driver'::user_role)
      returning id`,
    );
    riderUserId = riderUser.id;
    driverUserId = driverUser.id;
    const rider = first(
      await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}::uuid, ${riderUserId}::uuid) returning id`,
    );
    const driver = first(
      await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
      values (${cityId}::uuid, ${driverUser.id}::uuid, 'verified'::verification_status, 'ر س ق 41', 'sedan')
      returning id`,
    );

    const order = first(
      await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup)
      values (${cityId}::uuid, ${rider.id}::uuid, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(39.17, 21.54), 4326)::geography)
      returning id`,
    );
    orderId = order.id;
    const offer = first(
      await sql<{ id: string }[]>`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}::uuid, ${orderId}::uuid, ${driver.id}::uuid, 1, 'pending'::offer_status, now() + interval '45 minutes')
      returning id`,
    );

    // ── الصفُّ الأقدمُ: عرضٌ **للسائقِ** (أولويةٌ ٢).
    const offerRow = first(
      await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, order_id, offer_id, driver_id, recipient_user_id, payload, created_at, next_attempt_at)
      values (${cityId}::uuid, 'offer', ${orderId}::uuid, ${offer.id}::uuid, ${driver.id}::uuid, ${driverUserId}::uuid,
              jsonb_build_object('order_id', ${orderId}::uuid), now() - interval '1 hour 10 seconds', now())
      returning id`,
    );
    created.push(offerRow.id);

    // ── الصفُّ الأحدثُ: إشعارُ طورِ الرحلةِ **للراكبِ** (أولويةٌ ١).
    const noticeRow = first(
      await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key, next_attempt_at)
      values (${cityId}::uuid, 'rider_trip_notice', ${orderId}::uuid, ${riderUserId}::uuid,
              jsonb_build_object('order_id', ${orderId}::uuid, 'event', 'driver_accepted'),
              'd8-gate:trip:' || ${orderId}::text, now() - interval '1 hour')
      returning id`,
    );
    created.push(noticeRow.id);
  });

  it("الحرجةُ للراكبِ لا تنتظرُ خلفَ عرضٍ أقدمَ للسائقِ — الالتقاطُ يختارُها", async () => {
    // الصفانِ جاهزانِ (pending وnext_attempt_at≤now): قبلَ الإصلاحِ كانت البوابةُ
    // تحجبُ إشعارَ الراكبِ خلفَ عرضِ السائقِ الأقدمِ فيختارُ الالتقاطُ العرضَ؛
    // بعدَهُ يختارُ الأولويةَ الأعلى للمستلِمِ غيرِ المحجوبِ.
    const claimed = await claimOnce();
    expect(claimed).not.toBeNull();
    if (claimed === null) throw new Error("الالتقاطُ ردَّ null");
    // إشعارُ الرحلةِ (أولويةٌ ١) يجبُ أن يكونَ المُلتقَطَ — لا العرضَ.
    const row = first(
      await sql<{ kind: string; recipient: string | null }[]>`
      select kind, recipient_user_id::text as recipient from notification_outbox where id = ${claimed?.id ?? "unclaimed"}`,
    );
    expect(row.kind).toBe("rider_trip_notice");
    expect(row.recipient).toBe(riderUserId);
  });

  it("التسلسلُ داخلَ المستلِمِ الواحدِ يبقى: الأقدمُ يُقدَّمُ على الأحدثِ ولو كانَ أدنى أولويةً", async () => {
    // نظافةُ الجولةِ: صفوفُ الاختبارِ السابقةُ تُنهى (delivered وهميًّا) ثمَّ
    // يُبذرُ صفّانِ لنفسِ الراكبِ: الأقدمُ «دائرةٌ أوسعُ» (أولويةٌ ٢) والأحدثُ
    // إشعارُ رحلةٍ (أولويةٌ ١). البوابةُ تُلزمُ قصةَ المستلِمِ بترتيبِها: لا
    // يُلتقَطُ الأحدثُ ما دامَ الأقدمُ جاهزًا معلَّقًا — حتى لو كانت أولويّتُهُ
    // أدنى. (بدونَ البوابةِ لاختارَ الالتقاطُ الأحدثَ الأعلىَ أولويةً أولًا.)
    await sql`update notification_outbox set status='delivered', delivered_at=now(), delivered_message_id='d8-test' where recipient_user_id in (${riderUserId}::uuid, ${driverUserId}::uuid) and status in ('pending','sending')`;

    const older = first(
      await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key, created_at, next_attempt_at)
      values (${cityId}::uuid, 'wider_circle_opened', ${orderId}::uuid, ${riderUserId}::uuid,
              jsonb_build_object('event', 'circle'), 'd8-gate:older:' || ${orderId}::text, now() - interval '1 hour 10 seconds', now())
      returning id`,
    );
    created.push(older.id);
    const newer = first(
      await sql<{ id: string }[]>`
      insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key, next_attempt_at)
      values (${cityId}::uuid, 'rider_trip_notice', ${orderId}::uuid, ${riderUserId}::uuid,
              jsonb_build_object('event', 'newer'), 'd8-gate:newer:' || ${orderId}::text, now() - interval '1 hour')
      returning id`,
    );
    created.push(newer.id);

    const claimed = await claimOnce();
    expect(claimed).not.toBeNull();
    if (claimed === null) throw new Error("الالتقاطُ ردَّ null");
    // الأقدمُ (أولويةٌ ٢) يُقدَّمُ — قصةُ المستلِمِ بترتيبِها لا بأولويةِ الأحدثِ.
    expect(claimed?.id).toBe(older.id);
    expect(claimed?.id).not.toBe(newer.id);
  });

  it("D8 — إعادةُ الازدحامِ: لا تُحسَبُ محاولةً ولا تقتلُ الصفَّ، وبالرمزِ لا بغيرِه", async () => {
    // صفٌّ واحدٌ يُلتقطُ ثمَّ يُعادُ بازدحامٍ خمسَ مراتٍ: يجبُ أن يبقى `pending`
    // بموعدِ فتحةٍ، وبمحاولاتٍ لا تنمو (لا موتَ بـMAX_ATTEMPTS لضغطٍ عابرٍ)،
    // وإعادةُ رمزٍ آخرَ تُرفَضُ (NOT_CLAIMED_BY_CALLER).
    await sql`update notification_outbox set status='delivered', delivered_at=now(), delivered_message_id='d8-test' where recipient_user_id in (${riderUserId}::uuid, ${driverUserId}::uuid) and status in ('pending','sending')`;
    const row = first(
      await sql<{ id: string; token: string }[]>`
      insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key, next_attempt_at)
      values (${cityId}::uuid, 'rider_trip_notice', ${orderId}::uuid, ${riderUserId}::uuid,
              jsonb_build_object('event', 'congestion'), 'd8-gate:cong:' || ${orderId}::text, now() - interval '1 hour')
      returning id`,
    );
    created.push(row.id);

    // رمزٌ آخرَ (زائفٌ) يُرفضُ — الأمانُ بالرمزِ لا بالصفِّ.
    const foreign = first(
      await sql<{ result: { ok?: boolean } }[]>`
      select requeue_notification_delivery(${row.id}::uuid, gen_random_uuid()::uuid, 1000) result`,
    );
    expect(foreign.result.ok).toBe(false);

    for (let round = 0; round < 5; round += 1) {
      const claim = first(
        await sql<
          {
            result: { ok: boolean; delivery: { delivery_id: string; claim_token: string } | null };
          }[]
        >`
        select claim_notification_delivery() result`,
      );
      expect(claim.result.ok).toBe(true);
      if (claim.result.delivery === null) throw new Error("لم يُلتقَط الصفُّ — تعارضُ بذرٍ");
      expect(claim.result.delivery.delivery_id).toBe(row.id);
      const requeued = first(
        await sql<{ result: { ok: boolean; outcome: string; attempts: number } }[]>`
        select requeue_notification_delivery(${row.id}::uuid, ${claim.result.delivery.claim_token}::uuid, 0) result`,
      );
      expect(requeued.result.ok).toBe(true);
      expect(requeued.result.outcome).toBe("requeued");
      // المحاولاتُ لا تنمو: الازدحامُ لا يُحسَبُ — الصفُّ لا يموتُ بضغطٍ عابرٍ.
      expect(requeued.result.attempts).toBe(0);
    }

    // الصفُّ حيٌّ معلَّقٌ لا ميّتٌ ولا مُسلَّمٌ.
    const state = first(
      await sql<{ status: string; attempts: number; last_error: string }[]>`
      select status, attempts, last_error from notification_outbox where id = ${row.id}`,
    );
    expect(state.status).toBe("pending");
    expect(state.attempts).toBe(0);
    expect(state.last_error).toBe("OUTBOUND_CONGESTION");
  });

  afterAll(async () => {
    // تنظيفٌ موجَّهٌ بهويةِ الاختبارِ (لا truncate عامًّا — درسُ المرحلةِ 9).
    await sql`delete from notification_outbox where recipient_user_id in (${riderUserId}::uuid, ${driverUserId}::uuid)`;
    await sql`delete from notification_outbox where order_id = ${orderId}::uuid`;
    await sql`delete from order_offers where order_id = ${orderId}::uuid`;
    await sql`delete from orders where id = ${orderId}::uuid`;
    await sql`delete from drivers where user_id = ${driverUserId}::uuid`;
    await sql`delete from riders where user_id = ${riderUserId}::uuid`;
    await sql`delete from users where id in (${riderUserId}::uuid, ${driverUserId}::uuid)`;
    await sql.end({ timeout: 3 });
  });
});
