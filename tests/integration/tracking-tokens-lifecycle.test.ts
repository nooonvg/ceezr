/**
 * الغرض: §4.2 على قاعدة PostgreSQL فعليّة — لا على مزدوجات. يُقاس هنا ما لا
 *   تقيسه الوحدات:
 *
 *   (١) **مغلّف `claim_ride`** يعيد هويّةَ الراكب الصحيحة (معرّف تلغرام ولغته)
 *       وبيانات السائق — من صفوفٍ حقيقيّة لا من كائنٍ مُصطنَع.
 *   (٢) **شرطُ الملكية في القاعدة**: غيرُ المالك لا يُصدر رمزاً ولا يُلغي، وردُّه
 *       لا يُميّزه عن «لا رابطَ» فلا يصير مِسبراً.
 *   (٣) **`revoke_order_tracking_tokens` يُلغي كلّ روابط الطلب** لا أحدثها.
 *   (٤) **انقضاءُ الرابط**: ما تجاوز `expires_at` يُقرأ «غير صالح»، والصفحةُ
 *       العامّة تُجيب 404 — قبل أيّ ماسحٍ دوريّ.
 *   (٥) **الصفحةُ العامّة** لا تُسرِّب هويّةً: لا اسمَ سائقٍ ولا لوحةَ ولا معرّفَ
 *       طلبٍ في جسمها، ومعها ترويسةُ CSP.
 *
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL. أُضيف في 2026-08-14.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: CI، وأيّ تعديل على دوالّ الرموز أو المسار العامّ
 * ملاحظات مستقبلية: يوم يُطلب مسارُ الرحلة لا نقطتُها يُضاف اختبارٌ لعدد النقاط
 *   المُعادة — لا يُوسَّع اختبارُ الموقع الواحد.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createPublicSecurityHeaders } from "../../apps/gateway/src/public/security-headers.ts";
import { createPublicTrackingRoutes } from "../../apps/gateway/src/routes/public-tracking.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createDispatchRpc } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import {
  createTrackingTokenMint,
  createTrackingTokenRpc,
} from "../../packages/infrastructure/tracking/tracking-token-adapters.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const RIDER_TELEGRAM = 260_814;
const OTHER_TELEGRAM = 260_815;
const DRIVER_TELEGRAM = 160_814;
const NOT_FOUND = 404;
const HTTP_OK = 200;

let sql: Sql;
let cityId: string;
let cityHandle: ActiveCityHandle | undefined;
let tokens: ReturnType<typeof createTrackingTokenRpc>;
let dispatch: ReturnType<typeof createDispatchRpc>;
let ids: { riderId: string; driverId: string; orderId: string };

const mint = createTrackingTokenMint();

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

describeIf("§4.2 — دورةُ حياة رموز التتبّع على قاعدة حقيقية", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
    const id = cities[0]?.id;
    if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن على قاعدة الاختبار");
    cityId = id;
    tokens = createTrackingTokenRpc(sql);
    dispatch = createDispatchRpc(sql);
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`truncate table trip_tracking_tokens, tracking_sessions, audit_log, attendance_log,
                             order_offers, orders, driver_availability, driver_capabilities,
                             drivers, riders, users restart identity cascade`;

    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`truncate table trip_tracking_tokens, tracking_sessions, audit_log, attendance_log,
                             order_offers, orders, driver_availability, driver_capabilities,
                             drivers, riders, users restart identity cascade`;
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
    ids = await seed();
  });

  /** راكبٌ بلغةٍ غيرِ العربية (لنُثبت أنّ اللغة تُقرأ لا تُفترض)، وسائقٌ، وطلبٌ يبحث. */
  async function seed(): Promise<{ riderId: string; driverId: string; orderId: string }> {
    const riderUsers = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${RIDER_TELEGRAM}::bigint, 'سميرة القحطاني', '+966500260814', 'ur', 'rider')
      returning id
    `;
    const riderUser = riderUsers[0]?.id;
    if (riderUser === undefined) throw new Error("تعذّر إنشاء مستخدم الراكب");
    const riders = await sql<{ id: string }[]>`
      insert into riders (city_id, user_id) values (${cityId}, ${riderUser}::uuid) returning id
    `;
    const riderId = riders[0]?.id;
    if (riderId === undefined) throw new Error("تعذّر إنشاء الراكب");

    // راكبٌ ثانٍ: هو «غيرُ المالك» في اختبارات الملكية — لا معرّفٌ عشوائيّ لا وجودَ له،
    // فحسابٌ حقيقيٌّ يُجرّب طلبَ غيره هو الحالةُ التي تُخشى.
    await sql`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${OTHER_TELEGRAM}::bigint, 'راكب آخر', '+966500260815', 'ar', 'rider')
    `;

    const driverUsers = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, phone, language_code, role)
      values (${cityId}, ${DRIVER_TELEGRAM}::bigint, 'فهد الغامدي', '+966500160814', 'ar', 'driver')
      returning id
    `;
    const driverUser = driverUsers[0]?.id;
    if (driverUser === undefined) throw new Error("تعذّر إنشاء مستخدم السائق");
    const drivers = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, national_id, plate_number, vehicle_type,
                           verification_status)
      values (${cityId}, ${driverUser}::uuid, '1000160814', 'أ ب ج 1814', 'sedan', 'verified')
      returning id
    `;
    const driverId = drivers[0]?.id;
    if (driverId === undefined) throw new Error("تعذّر إنشاء السائق");
    await sql`select record_attendance(${driverId}::uuid, true, 'test_seed')`;

    const orders = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff,
                          pickup_label, dropoff_label)
      values (${cityId}, ${riderId}::uuid, 'transport', 'searching',
              st_point(39.1751, 21.5471)::geography, st_point(39.1901, 21.5601)::geography,
              'الحرم', 'المطار')
      returning id
    `;
    const orderId = orders[0]?.id;
    if (orderId === undefined) throw new Error("تعذّر إنشاء الطلب");
    return { riderId, driverId, orderId };
  }

  /** عرضٌ سارٍ للسائق: `claim_ride` لا تُسنِد بلا عرضٍ مفتوح. */
  async function openOffer(): Promise<void> {
    await sql`
      insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
      values (${cityId}, ${ids.orderId}::uuid, ${ids.driverId}::uuid, 1, 'pending',
              now() + interval '2 minutes')
    `;
  }

  async function issueFor(telegramId: number): Promise<string | null> {
    const token = mint.mint();
    const result = await tokens.issue(ids.orderId as OrderId, telegramId, token);
    if (!result.ok) throw new Error(`عطلُ منفذٍ لا رفضُ قاعدة: ${result.error.detail}`);
    return result.value.ok ? result.value.row.token : null;
  }

  it("مغلّفُ claim_ride يحمل هويّةَ الراكب الصحيحة ولغتَه وبيانات السائق", async () => {
    await openOffer();
    const claim = await dispatch.claimRide(ids.orderId as OrderId, ids.driverId as DriverId);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.value.claimed).toBe(true);
    expect(claim.value.cityId).toBe(cityId as CityId);
    expect(claim.value.rider).not.toBeNull();
    expect(claim.value.rider?.telegramId).toBe(String(RIDER_TELEGRAM));
    expect(claim.value.rider?.riderId).toBe(ids.riderId);
    // اللغةُ تُقرأ من صفّ الراكب لا تُفترض عربيّة: هذا الراكب أُردِيّ.
    expect(claim.value.rider?.languageCode).toBe("ur");
    expect(claim.value.driverName).toBe("فهد الغامدي");
    expect(claim.value.driverPlate).toBe("أ ب ج 1814");
    expect(claim.value.driverVehicle).toBe("sedan");
    const rows = await sql<{ status: string }[]>`
      select status from orders where id = ${ids.orderId}::uuid
    `;
    expect(rows[0]?.status).toBe("matched");
  });

  it("الإصدارُ لصاحب الطلب وحده: غيرُ المالك يُرفض بـUNAUTHORIZED", async () => {
    const owner = await issueFor(RIDER_TELEGRAM);
    expect(owner).not.toBeNull();
    const token = mint.mint();
    const result = await tokens.issue(ids.orderId as OrderId, OTHER_TELEGRAM, token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(false);
    if (result.value.ok) return;
    expect(result.value.rejection).toBe("UNAUTHORIZED");
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from trip_tracking_tokens where token = ${token}
    `;
    expect(rows[0]?.count).toBe("0");
  });

  it("الإلغاءُ بالطلب يُلغي كلَّ الروابط السارية لا أحدثها", async () => {
    const first = await issueFor(RIDER_TELEGRAM);
    const second = await issueFor(RIDER_TELEGRAM);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (first === null || second === null) return;

    const revoked = await tokens.revokeForOrder(ids.orderId as OrderId, RIDER_TELEGRAM);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(revoked.value).toBe(2);

    // والقراءةُ بعد الإلغاء «غير صالح» للاثنين: لا عينٌ تبقى مفتوحةً يظنّها المستخدم مغلقة.
    for (const token of [first, second]) {
      const read = await tokens.read(token);
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.value.kind).toBe("invalid");
    }
  });

  it("إلغاءُ غيرِ المالك يُعيد صفراً ولا يمسّ رابطاً — بلا تمييزٍ يُخبره أنّ الطلب قائم", async () => {
    const token = await issueFor(RIDER_TELEGRAM);
    expect(token).not.toBeNull();
    if (token === null) return;

    const stranger = await tokens.revokeForOrder(ids.orderId as OrderId, OTHER_TELEGRAM);
    expect(stranger.ok).toBe(true);
    if (stranger.ok) expect(stranger.value).toBe(0);

    // نفسُ الردّ لطلبٍ لا وجودَ له: الجوابُ واحدٌ فلا يُستدلّ به على وجود طلبٍ لغيره.
    const missing = await tokens.revokeForOrder(
      "00000000-0000-0000-0000-000000000000" as OrderId,
      OTHER_TELEGRAM,
    );
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.value).toBe(0);

    const read = await tokens.read(token);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.kind).not.toBe("invalid");
  });

  it("ما تجاوز مدّته يُقرأ «غير صالح» قبل أيّ ماسحٍ دوريّ", async () => {
    const token = await issueFor(RIDER_TELEGRAM);
    expect(token).not.toBeNull();
    if (token === null) return;
    await sql`
      update trip_tracking_tokens set expires_at = now() - interval '1 minute'
       where token = ${token}
    `;
    const read = await tokens.read(token);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.value.kind).toBe("invalid");
  });

  it("الصفحةُ العامّة: رمزٌ ساري ⇒ 200 بلا هويّة، ورمزٌ مُلغى ⇒ 404", async () => {
    const token = await issueFor(RIDER_TELEGRAM);
    expect(token).not.toBeNull();
    if (token === null) return;

    const app = createPublicTrackingRoutes({
      tokens,
      // بلا خريطةٍ عن قصد: السؤالُ هنا سؤالُ رمزٍ وهويّةٍ لا سؤالُ بلاطات.
      mapStyle: { configured: false, reason: "لا خريطة في الاختبار" },
      scriptUrl: "https://cdn.test/maplibre.js",
      stylesheetUrl: "https://cdn.test/maplibre.css",
      integrity: "sha384-test",
      securityHeaders: createPublicSecurityHeaders({
        mapOrigins: [],
        scriptOrigin: "https://cdn.test",
      }),
    });

    const live = await app.request(`/track/${token}`);
    expect(live.status).toBe(HTTP_OK);
    expect(live.headers.get("content-security-policy")).toContain("default-src 'none'");
    const body = await live.text();
    // ما وُعِد به حاملُ الرابط نقطةٌ ووقت — لا اسمَ سائقٍ ولا لوحةَ ولا معرّفَ طلب.
    expect(body).not.toContain("فهد الغامدي");
    expect(body).not.toContain("أ ب ج 1814");
    expect(body).not.toContain(ids.orderId);
    expect(body).not.toContain(String(RIDER_TELEGRAM));

    await tokens.revokeForOrder(ids.orderId as OrderId, RIDER_TELEGRAM);
    const dead = await app.request(`/track/${token}`);
    expect(dead.status).toBe(NOT_FOUND);
    const deadApi = await app.request(`/api/track/${token}/position`);
    expect(deadApi.status).toBe(NOT_FOUND);
  });
});
