/**
 * الغرض: قياسُ `tracking_link_view` و`rider_ride_share_state` و`get_tracking_position`
 *   على قاعدةٍ حقيقيّةٍ (`F2-09` · `SR-13`) — وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ
 *   عليه حاجزٌ ساكنٌ ولا محرِّكٌ مُصنَّعٌ**:
 *     ــ أنَّ **المالكَ والغريبَ يريانِ الحكمَ نفسَه حرفاً**: الحمولتانِ من
 *        الحَكَمِ الواحدِ، فلا تُحجَبُ نقطةٌ عن صاحبِها وتُنشَرُ لحاملِ رابطٍ.
 *        (وهذا **العطبُ الأصليُّ**: الصفحةُ العامّةُ كانت تنشرُ إحداثيّةً بلا
 *        بوّابةِ طزاجةٍ، وشاشةُ المالكِ تحجبُ ما جاوزَ الحدَّ.)
 *     ــ أنَّ **الإحداثيّةَ لا تُغادِرُ القاعدةَ متى حُجِبَ الحكمُ** — غيابَ مفتاحٍ
 *        لا `null` يُغري قارئاً بملئِه.
 *     ــ أنَّ العُمرَ والبقيّةَ **بساعةِ القاعدةِ** لا بساعةِ جهازٍ.
 *     ــ أنَّ الحدَّ يأتي من `platform_settings` بمدينةِ الطلبِ، وأنَّ غيابَه
 *        يُنشَرُ `FALLBACK_DEFAULT` **باسمِه** لا صمتاً.
 *     ــ أنَّ **حياةَ الرابطِ حكمٌ يُحسَبُ لحظةَ القراءةِ** (`F12-04`): يموتُ في
 *        موعدِه — نهايةُ الرحلةِ + المهلةُ — **والوظيفةُ الدوريّةُ لم تدُرْ قطُّ**
 *        و`expires_at` ما زالَ بعدَ ساعاتٍ. وهذا ما لا يقدرُ عليه اختبارُ وحدةٍ.
 *     ــ أنَّ المِلكيّةَ **قيدُ استعلامٍ**: رحلةُ غيرِكَ `ORDER_NOT_FOUND` بالحرفِ
 *        الذي يُرَدُّ به معرِّفٌ معدومٌ.
 *     ــ أنَّ الإيقافَ **يُبطِلُ كلَّ الروابطِ** بمعرِّفِ الطلبِ لا بالرمزِ.
 *     ــ أنَّ **الرمزَ لا يُنشَرُ في أيِّ قراءةٍ** — يُعطى مرّةً عندَ الإصدارِ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`. حكمُ CI **غيرُ
 *   مقروءٍ** بعدُ (`B-CI-001`).
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `F2-10` إذ يُضيفُ نداءَ استغاثةٍ على الطلبِ نفسِه.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ صفحةُ HTML**: النصُّ المخدومُ سطحٌ، والمقيسُ حمولتُه.
 * ــ **لا يُقاسُ أجرٌ ولا إيصالٌ**: محجوبانِ بـ`ADR 0039` §٤.
 * ــ `RLS` يُقاسُ وجوداً لا أثراً: الاتصالُ بمالكِ القاعدةِ وهوَ يتخطّاه.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
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
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const RIDER_TELEGRAM_ID = 900_000_991;
const OTHER_RIDER_TELEGRAM_ID = 900_000_992;
const DRIVER_TELEGRAM_ID = 900_000_993;
const ABSENT_TELEGRAM_ID = 900_000_994;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };
const DRIVER_POINT = { lat: 21.49, lng: 39.19 };

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";
let otherUserId = "";
let otherRiderId = "";
let driverUserId = "";
let driverId = "";
let secondDriverUserId = "";

interface PositionPayload {
  readonly verdict?: string;
  readonly age_seconds?: number | null;
  readonly max_age_seconds?: number;
  readonly max_age_source?: string;
  readonly lat?: number;
  readonly lng?: number;
}

interface LifetimePayload {
  readonly verdict?: string;
  readonly seconds_remaining?: number | null;
  readonly grace_minutes?: number;
  readonly grace_source?: string;
  readonly ride_ended_at?: string | null;
}

interface SharePayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly order_id?: string;
  readonly status?: string;
  readonly can_share?: boolean;
  readonly links?: ReadonlyArray<Record<string, unknown>>;
  readonly max_lifetime_minutes?: number | null;
  readonly grace_minutes?: number | null;
  readonly lifetime?: LifetimePayload;
  readonly preview?: { active: boolean; position: PositionPayload };
}

interface PublicPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly active?: boolean;
  readonly position?: PositionPayload;
}

async function shareState(telegramId: number, orderId: string): Promise<SharePayload> {
  const [row] = await sql<{ result: SharePayload }[]>`
    select rider_ride_share_state(${telegramId}::bigint, ${orderId}::uuid) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function publicView(token: string): Promise<PublicPayload> {
  const [row] = await sql<{ result: PublicPayload }[]>`
    select get_tracking_position(${token}) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function issue(
  orderId: string,
  telegramId: number,
  token: string,
): Promise<Record<string, unknown>> {
  const [row] = await sql<{ result: Record<string, unknown> }[]>`
    select issue_tracking_token(${orderId}::uuid, ${telegramId}::bigint, ${token}) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الإصدارِ");
  // `TOKEN_TOO_SHORT` **عيبُ المِرصادِ لا حُكمُ النِّظامِ**: إنّه يُرَدُّ قبلَ أيِّ
  // حكمٍ موضوعيٍّ، فلو مرَّ صامتاً لادَّعى اختبارُ رفضٍ أنَّه قاسَ حالةَ الرحلةِ
  // وهوَ لم يبلغِ الشرطَ. فيُرفَعُ ههنا **عطبَ أداةٍ** لا فشلَ توقُّعٍ.
  if (row.result.error === "TOKEN_TOO_SHORT") {
    throw new Error(
      `رمزُ الاختبارِ أقصرُ من ${TOKEN_MIN_LENGTH} — القياسُ لم يبلغِ الموضوعَ (طولُ المُرسَلِ: ${token.length}).`,
    );
  }
  return row.result;
}

async function revokeAll(orderId: string, telegramId: number): Promise<Record<string, unknown>> {
  const [row] = await sql<{ result: Record<string, unknown> }[]>`
    select revoke_order_tracking_tokens(${orderId}::uuid, ${telegramId}::bigint) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الإلغاءِ");
  return row.result;
}

/**
 * رمزٌ يوافقُ **قيدَ القاعدةِ** لا تقديرَ الكاتبِ: `trip_tracking_tokens_token_long_enough`
 * و`issue_tracking_token` يشترطانِ أربعةً وستّينَ محرفاً على الأقلِّ، ورمزٌ أقصرُ
 * يُرَدُّ `TOKEN_TOO_SHORT` **قبلَ** أيِّ حكمٍ آخرَ — فيمرُّ الاختبارُ كاذباً إذ
 * يظنُّ أنَّه قاسَ حالةَ الرحلةِ وهوَ لم يبلغْها. والطولُ يُقرأُ من الثابتِ أدناه
 * لا من رقمٍ مبذورٍ في الدالّةِ.
 */
const TOKEN_MIN_LENGTH = 64;

function freshToken(): string {
  let token = "f209";
  while (token.length < TOKEN_MIN_LENGTH) {
    token += crypto.randomUUID().replaceAll("-", "");
  }
  return token;
}

async function seedOrder(options: {
  readonly riderId: string;
  readonly status: string;
  readonly driver?: string | null;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
      assigned_driver_id, idempotency_key
    ) values (
      ${cityId}, ${options.riderId}, 'transport'::service_type, ${options.status}::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'البلد', 'الروضة',
      ${options.driver ?? null},
      ${`ride-share:${crypto.randomUUID()}`}
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** موقعُ السائقِ بعُمرٍ مُعيَّنٍ — و`null` ختماً يزرعُ نقطةً بلا ختمٍ. */
async function seedDriverLocation(
  ageSeconds: number | null,
  hasPoint = true,
  targetDriverId: string = driverId,
): Promise<void> {
  await sql`
    update drivers set
      last_location = ${
        hasPoint
          ? sql`st_setsrid(st_makepoint(${DRIVER_POINT.lng}, ${DRIVER_POINT.lat}), 4326)::geography`
          : null
      },
      last_location_at = ${
        ageSeconds === null ? null : sql`now() - make_interval(secs => ${ageSeconds})`
      }
    where id = ${targetDriverId}
  `;
}

/**
 * إنهاءُ الرحلةِ **بساعةِ القاعدةِ** قبلَ دقائقَ مُعيَّنةٍ: `completed_at` هوَ الحرفُ
 * الأوّلُ الذي يقرؤُه `tracking_link_lifetime` (و`expire_tracking_tokens` نفسُها)،
 * ويُضبَطُ `updated_at` معَه كي لا يُقاسَ فرقٌ بين حرفَين لنهايةٍ واحدةٍ.
 */
async function endRide(orderId: string, minutesAgo: number): Promise<void> {
  await sql`
    update orders set
      status = 'completed'::order_status,
      completed_at = now() - make_interval(mins => ${minutesAgo}),
      updated_at = now() - make_interval(mins => ${minutesAgo})
    where id = ${orderId}
  `;
}

/** مهلةُ المدينةِ كما تقرؤُها القاعدةُ — لا رقمٌ مبذورٌ في الاختبارِ. */
async function graceMinutes(): Promise<number> {
  const [row] = await sql<{ grace: number | null }[]>`
    select (get_setting(${cityId}, 'tracking_link_grace_minutes') #>> '{}')::numeric::integer as grace
  `;
  if (row?.grace === null || row?.grace === undefined) {
    throw new Error("لا إعدادَ لمهلةِ الرابطِ في مدينةِ الاختبارِ");
  }
  return row.grace;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبة المشاركة', '+966500000991')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ الراكبِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  riderId = rider.id;

  const [otherUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${OTHER_RIDER_TELEGRAM_ID}, 'rider', 'راكب آخر', '+966500000992')
    returning id
  `;
  if (otherUser === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherUserId = otherUser.id;
  const [otherRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${otherUserId}) returning id
  `;
  if (otherRider === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherRiderId = otherRider.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ المشاركةِ', '+966500000993')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر س ب 4321')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

beforeEach(async () => {
  if (DATABASE_URL === undefined) return;
  // I1 (ADR 0286): فهرسُ الالتزامِ الواحدِ للسائقِ يرفضُ بذرَ التزامٍ ثانٍ لسائقٍ
  // لا يزالُ التزامُ اختبارٍ سابقٍ حيًّا — فتُنهى التزاماتُ هذا الملفِّ قبلَ كلِّ اختبارٍ.
  await sql`update orders set status = 'completed', completed_at = now() where idempotency_key like 'ride-share:%' and is_driver_engaged_order_status(status)`;
});

afterAll(async () => {
  if (DATABASE_URL !== undefined && secondDriverUserId !== "") {
    // أوّلاً: فكُّ إسنادِ طلباتِه (قيدُ FK) ثم حذفُ السائقِ فالمستخدمِ.
    await sql`update orders set assigned_driver_id = null, status = 'cancelled'
               where assigned_driver_id in (select id from drivers where user_id = ${secondDriverUserId}::uuid)`;
    await sql`delete from drivers where user_id = ${secondDriverUserId}::uuid`;
    await sql`delete from users where id = ${secondDriverUserId}::uuid`;
  }
  if (DATABASE_URL === undefined) return;
  for (const id of [riderId, otherRiderId]) {
    if (id === "") continue;
    await sql`
      delete from trip_tracking_tokens
       where order_id in (select id from orders where rider_id = ${id})
    `;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${id})`;
    await sql`delete from orders where rider_id = ${id}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  if (otherRiderId !== "") await sql`delete from riders where id = ${otherRiderId}`;
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  for (const id of [riderUserId, otherUserId, driverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("المِلكيّةُ قيدُ استعلامٍ لا فرعَ شرطٍ", () => {
  it("١) المالكةُ تقرأُ حالَها", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
    expect(payload.ok).toBe(true);
    expect(payload.order_id).toBe(orderId);
    expect(payload.can_share).toBe(true);
  });

  it("٢) رحلةُ غيرِكَ ومعرِّفٌ معدومٌ **جوابٌ واحدٌ** — لا عدَّادَ معرّفاتٍ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const notMine = await shareState(OTHER_RIDER_TELEGRAM_ID, orderId);
    const absent = await shareState(RIDER_TELEGRAM_ID, crypto.randomUUID());
    expect(notMine.error).toBe("ORDER_NOT_FOUND");
    expect(absent.error).toBe("ORDER_NOT_FOUND");
    expect(notMine.preview).toBeUndefined();
    expect(notMine.links).toBeUndefined();
  });

  it("٣) حسابٌ غائبٌ يُرَدُّ بالجوابِ نفسِه ولا يُفشي وجودَ الرحلةِ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    expect((await shareState(ABSENT_TELEGRAM_ID, orderId)).error).toBe("ORDER_NOT_FOUND");
  });

  it("٤) مُدخَلٌ معدومٌ يُرَدُّ `INVALID_INPUT` قبلَ أيِّ استعلامٍ", async () => {
    const [row] = await sql<{ result: SharePayload }[]>`
      select rider_ride_share_state(null::bigint, null::uuid) as result
    `;
    expect(row?.result.error).toBe("INVALID_INPUT");
  });
});

describeIf("الإتاحةُ تتبعُ حالةَ الرحلةِ لا شرطاً مُوازياً", () => {
  it("٥) الرحلةُ الجاريةُ تُتيحُ الإصدارَ والمنتهيةُ تمنعُه — بالحكمِ نفسِه الذي تفرضُه دالّةُ الإصدارِ", async () => {
    const active = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const done = await seedOrder({ riderId, status: "completed", driver: driverId });
    expect((await shareState(RIDER_TELEGRAM_ID, active)).can_share).toBe(true);
    expect((await shareState(RIDER_TELEGRAM_ID, done)).can_share).toBe(false);

    // والمُدَّعى أنَّهُما **حكمٌ واحدٌ**: ما منعَته المعاينةُ تمنعُه دالّةُ الإصدارِ.
    const refused = await issue(done, RIDER_TELEGRAM_ID, freshToken());
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("ORDER_NOT_ACTIVE");
  });
});

describeIf("حَكَمٌ واحدٌ: المالكةُ والغريبُ يريانِ الحكمَ نفسَه", () => {
  it("٦) نقطةٌ طازجةٌ تُنشَرُ للاثنَينِ بالإحداثيّةِ نفسِها وبالحكمِ نفسِه", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(5);
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);

    const owner = await shareState(RIDER_TELEGRAM_ID, orderId);
    const stranger = await publicView(token);

    expect(owner.preview?.position.verdict).toBe("LOCATED");
    expect(stranger.position?.verdict).toBe("LOCATED");
    expect(stranger.position?.lat).toBeCloseTo(owner.preview?.position.lat ?? 0, 6);
    expect(stranger.position?.lng).toBeCloseTo(owner.preview?.position.lng ?? 0, 6);
    expect(stranger.active).toBe(owner.preview?.active ?? false);
  });

  // **هذا هوَ العطبُ الأصليُّ**: الصفحةُ العامّةُ كانت تنشرُ إحداثيّةً بلا حدِّ
  // عُمرٍ، وشاشةُ المالكةِ تحجبُ فوقَ تسعينَ ثانيةً — فكانَ الغريبُ مُصدَّقاً
  // أكثرَ من صاحبةِ الرحلةِ. والمقيسُ ههنا **أنَّ الحجبَ صارَ واحداً**.
  it("٧) نقطةٌ متقادمةٌ تُحجَبُ عن الاثنَينِ معاً — والإحداثيّةُ لا تُغادِرُ القاعدةَ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(600);
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);

    const owner = await shareState(RIDER_TELEGRAM_ID, orderId);
    const stranger = await publicView(token);

    expect(owner.preview?.position.verdict).toBe("TOO_OLD");
    expect(stranger.position?.verdict).toBe("TOO_OLD");
    for (const position of [owner.preview?.position, stranger.position]) {
      expect(position).toBeDefined();
      expect(Object.hasOwn(position ?? {}, "lat")).toBe(false);
      expect(Object.hasOwn(position ?? {}, "lng")).toBe(false);
    }
  });

  it("٨) «لم يُبلِّغْ قطُّ» و«بلا ختمٍ» حكمانِ مفصولانِ لا حالٌ صمّاءُ واحدةٌ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);

    await seedDriverLocation(null, false);
    expect((await publicView(token)).position?.verdict).toBe("NEVER_REPORTED");
    expect((await shareState(RIDER_TELEGRAM_ID, orderId)).preview?.position.verdict).toBe(
      "NEVER_REPORTED",
    );

    await seedDriverLocation(null, true);
    expect((await publicView(token)).position?.verdict).toBe("NO_TIMESTAMP");
    expect((await shareState(RIDER_TELEGRAM_ID, orderId)).preview?.position.verdict).toBe(
      "NO_TIMESTAMP",
    );
  });

  it("٩) العُمرُ يُنشَرُ معَ الحجبِ — «آخرُ موقعٍ قبلَ كذا» جوابٌ صادقٌ والفراغُ ليسَ جواباً", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(600);
    const owner = await shareState(RIDER_TELEGRAM_ID, orderId);
    const age = owner.preview?.position.age_seconds ?? 0;
    expect(age).toBeGreaterThanOrEqual(600);
    expect(age).toBeLessThan(700);
  });

  it("١٠) الحدُّ يأتي من إعدادِ المدينةِ **باسمِ مصدرِه** لا مكتوباً في الكودِ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(5);
    const owner = await shareState(RIDER_TELEGRAM_ID, orderId);
    expect(owner.preview?.position.max_age_source).toBe("SETTING");
    expect(owner.preview?.position.max_age_seconds).toBe(90);
  });

  // الحدُّ إعدادٌ لا ثابتٌ: تغييرُه يُغيِّرُ الحكمَ **بلا نشرِ كودٍ**.
  it("١١) رفعُ الحدِّ يكشفُ نقطةً كانت محجوبةً — للاثنَينِ في اللحظةِ نفسِها", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(300);
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    expect((await publicView(token)).position?.verdict).toBe("TOO_OLD");

    // القيمةُ الأصليّةُ تُعادُ **كما كانت** لا كرقمٍ مكتوبٍ ههنا: رقمٌ مكتوبٌ في
    // الاختبارِ يصيرُ مصدرَ حقيقةٍ ثانياً يُخالِفُ بذرةَ الهجرةِ بصمتٍ.
    // والإعادةُ بـ`::text::jsonb` لا بـ`::jsonb`: في `$1::jsonb` يستنبِطُ
    // PostgreSQL نوعَ المُعامِلِ `jsonb` فيُرمِّزُ السائقُ النصَّ ثانيةً
    // (`90` ← `"90"`) فيصلُ القاعدةَ `jsonb` من نوعِ `string` فيخرقُ
    // `platform_settings_value_type_coherent`. والوسيطُ `::text` يثبِّتُ نوعَ
    // المُعامِلِ نصّاً فيمرُّ البايتُ كما هو. وحاجزُ `check-jsonb-binding` يمنعُ
    // عودةَ النمطِ المعطوبِ إلى المستودَعِ ألبتةً.
    const [before] = await sql<{ value_text: string }[]>`
      select value::text as value_text from platform_settings
       where city_id = ${cityId} and key = 'driver_position_max_age_seconds'
    `;
    if (before === undefined) throw new Error("لا إعدادَ لحدِّ العُمرِ في مدينةِ الاختبارِ");
    await sql`
      update platform_settings set value = '600'::jsonb
       where city_id = ${cityId} and key = 'driver_position_max_age_seconds'
    `;
    try {
      expect((await publicView(token)).position?.verdict).toBe("LOCATED");
      expect((await shareState(RIDER_TELEGRAM_ID, orderId)).preview?.position.verdict).toBe(
        "LOCATED",
      );
    } finally {
      await sql`
        update platform_settings set value = ${before.value_text}::text::jsonb
         where city_id = ${cityId} and key = 'driver_position_max_age_seconds'
      `;
    }
  });

  it("١٢) غيابُ الإعدادِ يُنشَرُ افتراضاً **باسمِه** لا صمتاً", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(5);
    // الصفُّ يُحفَظُ **بتمثيلِ القاعدةِ نفسِها** (`value::text`) لا بتمثيلِ العميلِ:
    // المُحرِّكُ يُعيدُ `jsonb` رقماً أو نصّاً بحسبِ إعدادِه، فـ`JSON.stringify`
    // عليه قد يُنتِجُ `'"90"'` — نصّاً — فيخرقُ القيدَ
    // `platform_settings_value_type_coherent` عندَ الإعادةِ، فتسقطُ الإعادةُ
    // **وتبقى المدينةُ ناقصةَ مفتاحٍ فتُسمِّمَ كلَّ ملفٍّ يُفعِّلُ مدينةً بعدَها**.
    // وهذا ما حدثَ بالفعلِ في أوّلِ حكمٍ لـCI. فالنوعُ والوصفُ والمؤقّتيّةُ
    // تُحفَظُ كلُّها وتُعادُ كما كانت، ثمَّ **يُتحقَّقُ من الإعادةِ** — فإن فشلَت
    // سقطَ هذا الاختبارُ وحدَه ولم يُنقَلْ عطبُه إلى غيرِه.
    const [saved] = await sql<
      {
        value_text: string;
        value_type: string;
        description_ar: string | null;
        is_provisional: boolean;
      }[]
    >`
      select value::text as value_text, value_type, description_ar, is_provisional
        from platform_settings
       where city_id = ${cityId} and key = 'driver_position_max_age_seconds'
    `;
    if (saved === undefined) throw new Error("لا إعدادَ لحدِّ العُمرِ في مدينةِ الاختبارِ");
    await sql`
      delete from platform_settings
       where city_id = ${cityId} and key = 'driver_position_max_age_seconds'
    `;
    try {
      const owner = await shareState(RIDER_TELEGRAM_ID, orderId);
      expect(owner.preview?.position.max_age_source).toBe("FALLBACK_DEFAULT");
      expect(owner.preview?.position.max_age_seconds).toBe(90);
    } finally {
      await sql`
        insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
        values (${cityId}, 'driver_position_max_age_seconds',
                ${saved.value_text}::text::jsonb, ${saved.value_type},
                ${saved.description_ar}, ${saved.is_provisional})
        on conflict (city_id, key) do update
           set value = excluded.value, value_type = excluded.value_type
      `;
    }
    const [restored] = await sql<{ value_text: string }[]>`
      select value::text as value_text from platform_settings
       where city_id = ${cityId} and key = 'driver_position_max_age_seconds'
    `;
    expect(restored?.value_text).toBe(saved.value_text);
  });
});

describeIf("الروابطُ — ساريةٌ وحدَها، وبلا رمزٍ، وبقيّةٌ بساعةِ القاعدةِ", () => {
  it("١٣) الرابطُ المُصدَرُ يظهرُ في الحالِ ببقيّةٍ موجبةٍ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    expect((await issue(orderId, RIDER_TELEGRAM_ID, freshToken())).ok).toBe(true);
    const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
    expect(payload.links).toHaveLength(1);
    const link = payload.links?.[0] ?? {};
    // السقفُ يُنشَرُ **باسمِه** لا عدّاً يُقرأُ موعداً (`F12-04`)، والاسمُ القديمُ
    // يُقاسُ غيابُه: بقاؤُه يعني قارئاً يُعِدُّ نحوَ موعدٍ ليسَ هوَ الموعدَ.
    expect(Number(link.ceiling_seconds_remaining)).toBeGreaterThan(0);
    expect(Object.hasOwn(link, "seconds_remaining")).toBe(false);
  });

  // الرمزُ كلمةُ السرِّ: يُعطى مرّةً عندَ الإصدارِ **ولا يُعادُ في قراءةٍ** —
  // فلا يُلتقَطُ من سجلٍّ ولا من لقطةِ شاشةٍ لاحقةٍ.
  it("١٤) الرمزُ **لا يُنشَرُ** في أيِّ قراءةٍ — لا في حقلٍ ولا في نصِّ الحمولةِ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
    expect(JSON.stringify(payload)).not.toContain(token);
    for (const link of payload.links ?? []) {
      expect(Object.hasOwn(link, "token")).toBe(false);
    }
  });

  it("١٥) الرابطُ المنتهي لا يُعرَضُ حيّاً ولا يُقرأُ من الصفحةِ العامّةِ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    await sql`
      update trip_tracking_tokens set expires_at = now() - interval '1 second' where token = ${token}
    `;
    expect((await shareState(RIDER_TELEGRAM_ID, orderId)).links).toHaveLength(0);
    const stranger = await publicView(token);
    expect(stranger.ok).toBe(false);
    expect(stranger.error).toBe("TOKEN_NOT_FOUND");
  });

  it("١٦) الإيقافُ يُبطِلُ **كلَّ** روابطِ الطلبِ بمعرِّفِه لا برمزٍ يحملُه الراكبُ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const first = freshToken();
    const second = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, first)).ok).toBe(true);
    expect((await issue(orderId, RIDER_TELEGRAM_ID, second)).ok).toBe(true);
    expect((await shareState(RIDER_TELEGRAM_ID, orderId)).links).toHaveLength(2);

    const revoked = await revokeAll(orderId, RIDER_TELEGRAM_ID);
    expect(revoked.ok).toBe(true);
    expect(Number(revoked.revoked)).toBe(2);
    expect((await shareState(RIDER_TELEGRAM_ID, orderId)).links).toHaveLength(0);
    expect((await publicView(first)).error).toBe("TOKEN_NOT_FOUND");
    expect((await publicView(second)).error).toBe("TOKEN_NOT_FOUND");
  });

  it("١٧) «لا رابطَ ساري» صفرٌ صادقٌ لا عطبٌ، و«ليست لكَ» لا تُميَّزُ عنه", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const mine = await revokeAll(orderId, RIDER_TELEGRAM_ID);
    expect(mine.ok).toBe(true);
    expect(Number(mine.revoked)).toBe(0);
    const notMine = await revokeAll(orderId, OTHER_RIDER_TELEGRAM_ID);
    expect(notMine.ok).toBe(true);
    expect(Number(notMine.revoked)).toBe(0);
  });

  it("١٨) رمزٌ لا وجودَ لهُ ورمزٌ مُلغىً **جوابٌ واحدٌ** — لا استكشافَ بالتجريبِ", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    await revokeAll(orderId, RIDER_TELEGRAM_ID);
    expect((await publicView(token)).error).toBe("TOKEN_NOT_FOUND");
    expect((await publicView(freshToken())).error).toBe("TOKEN_NOT_FOUND");
  });
});

describeIf("الحمولةُ العامّةُ بلا هويّةٍ", () => {
  it("١٩) لا اسمَ ولا رقمَ ولا لوحةَ ولا معرِّفَ طلبٍ في ردِّ الصفحةِ العامّةِ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(5);
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    const stranger = await publicView(token);
    const text = JSON.stringify(stranger);

    expect(text).not.toContain("راكبة المشاركة");
    expect(text).not.toContain("سائقُ المشاركةِ");
    expect(text).not.toContain("+966500000991");
    expect(text).not.toContain("+966500000993");
    expect(text).not.toContain("ر س ب 4321");
    expect(text).not.toContain(orderId);
    expect(Object.keys(stranger).sort()).toEqual(["active", "ok", "position"]);
  });

  it("٢٠) حالُ الرحلةِ يُنشَرُ علماً واحداً لا حالةً حرفيّةً تُفشي المسارَ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    const stranger = await publicView(token);
    expect(stranger.active).toBe(true);
    expect(JSON.stringify(stranger)).not.toContain("in_progress");
  });
});

describeIf("سطحُ الصلاحيّاتِ لدوالِّ المشاركةِ", () => {
  // درسُ `F2-06` بثمنِه: `postgres` يمنحُ `execute` لـ`public` تلقائيّاً.
  // و`tracking_link_view` **بلا إذنٍ فيها**، فتركُها مكشوفةً يعني قراءةَ موقعِ
  // أيِّ طلبٍ بمعرِّفِه بلا رمزٍ ولا مِلكيّةٍ. والمقيسُ **حكمُ القاعدةِ** لا نصُّ الهجرةِ.
  it("٢١) لا `anon` ولا `authenticated` ينفِّذُ دالّةً من دوالِّ البندِ", async () => {
    // والحَكَمُ الجديدُ (`F12-04`) يُقاسُ ههنا معَهنَّ: دالّةٌ **بلا إذنٍ فيها**
    // تُركَتْ مكشوفةً تعني قراءةَ حالِ أيِّ رحلةٍ بمعرِّفِها بلا رمزٍ ولا مِلكيّةٍ.
    const signatures = [
      "tracking_link_view(uuid)",
      "tracking_link_lifetime(uuid)",
      "tracking_link_token_order(text)",
      "rider_ride_share_state(bigint, uuid)",
      "get_tracking_position(text)",
      // `F12-04` — حَكَمُ العَلَقِ وكاشفُه: الأوّلُ يُفشي حالَ رحلةٍ بمعرِّفِها،
      // والثاني يُفشي **كلَّ** طلباتِ مدينةٍ العالقةِ بمعرِّفِها. وتركُ أيِّهما
      // مكشوفاً أسوأُ من تركِ `tracking_link_view`.
      "order_stall_state(uuid)",
      "detect_stalled_orders(uuid, integer)",
    ];
    for (const signature of signatures) {
      for (const role of ["anon", "authenticated", "public"]) {
        const [row] = await sql<{ allowed: boolean }[]>`
          select has_function_privilege(${role}, ${signature}, 'execute') as allowed
        `;
        expect({ signature, role, allowed: row?.allowed }).toEqual({
          signature,
          role,
          allowed: false,
        });
      }
    }
  });
});

/**
 * ═══ `F12-04` — «المشاركةُ تدومُ ما دامَت الرحلةُ» ═══
 *
 * وأهمُّ ما ههنا **لا يقدرُ عليه اختبارُ وحدةٍ**: أنَّ الحكمَ يموتُ في موعدِه
 * **وَالوظيفةُ الدوريّةُ لم تدُرْ قطُّ**. فكلُّ اختبارٍ أدناه يزرعُ رحلةً ورابطاً
 * ثمَّ **لا يُنادي `expire_tracking_tokens` ألبتّةَ**، ويُثبِتُ أنَّ `expires_at`
 * ما زالَ في المستقبلِ البعيدِ — فلو كانَ الحكمُ رايةً مخزَّنةً لَمَرَّ الرابطُ.
 */
describeIf("حياةُ الرابطِ حكمٌ يُحسَبُ لا رايةٌ تسحبُها وظيفةٌ (F12-04)", () => {
  it("٢٢) رحلةٌ جاريةٌ: `LIVE_RIDE_ACTIVE` **بلا عدٍّ تنازليٍّ** — لا رقمَ يُوعَدُ به", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    expect((await issue(orderId, RIDER_TELEGRAM_ID, freshToken())).ok).toBe(true);
    const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
    expect(payload.lifetime?.verdict).toBe("LIVE_RIDE_ACTIVE");
    expect(payload.lifetime?.seconds_remaining).toBeNull();
    expect(payload.lifetime?.ride_ended_at).toBeNull();
    expect(payload.lifetime?.grace_minutes).toBe(await graceMinutes());
    expect(payload.lifetime?.grace_source).toBe("SETTING");
    expect(payload.links).toHaveLength(1);
  });

  it("٢٣) انتهَت الرحلةُ قبلَ قليلٍ: `LIVE_GRACE` وعدٌّ نحوَ **نهايةِ الرحلةِ + المهلةِ** لا نحوَ السقفِ", async () => {
    const grace = await graceMinutes();
    if (grace < 2) throw new Error(`مهلةُ المدينةِ ${grace} دقيقةً — القياسُ لا يبلغُ موضوعَه`);
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    await endRide(orderId, 1);

    const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
    const remaining = Number(payload.lifetime?.seconds_remaining);
    expect(payload.lifetime?.verdict).toBe("LIVE_GRACE");
    // البقيّةُ **دقيقةٌ أقلُّ من المهلةِ** لا اثنتا عشرةَ ساعةً: هذا هوَ الفرقُ
    // بينَ عدٍّ نحوَ الموعدِ وعدٍّ نحوَ سقفٍ أعمى.
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual((grace - 1) * 60);
    expect(remaining).toBeGreaterThan((grace - 1) * 60 - 120);
    expect(payload.lifetime?.ride_ended_at).not.toBeNull();
    // والرابطُ حيٌّ للاثنَينِ في المهلةِ — المالكةُ والغريبُ حكمٌ واحدٌ.
    expect(payload.links).toHaveLength(1);
    expect((await publicView(token)).ok).toBe(true);
    // والسقفُ في المستقبلِ البعيدِ، فالعدُّ ليسَ منه.
    const [ceiling] = await sql<{ far: boolean }[]>`
      select expires_at > now() + interval '6 hours' as far
        from trip_tracking_tokens where token = ${token}
    `;
    expect(ceiling?.far).toBe(true);
  });

  it("٢٤) مضَت المهلةُ **والوظيفةُ لم تدُرْ**: الرابطُ ميّتٌ للاثنَينِ والسقفُ ما زالَ بعدَ ساعاتٍ", async () => {
    const grace = await graceMinutes();
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    await seedDriverLocation(5);
    await endRide(orderId, grace + 5);

    // **لا نداءَ لـ`expire_tracking_tokens` ههنا عن قصدٍ**: هذا هوَ المقيسُ.
    const [row] = await sql<{ far: boolean; revoked: boolean }[]>`
      select expires_at > now() + interval '6 hours' as far,
             revoked_at is not null as revoked
        from trip_tracking_tokens where token = ${token}
    `;
    expect(row?.far).toBe(true);
    expect(row?.revoked).toBe(false);

    const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
    expect(payload.lifetime?.verdict).toBe("EXPIRED_RIDE_ENDED");
    expect(payload.lifetime?.seconds_remaining).toBe(0);
    expect(payload.links).toHaveLength(0);

    // والغريبُ يُرَدُّ بالجوابِ الواحدِ، **ولا إحداثيّةَ تُغادِرُ القاعدةَ**.
    const stranger = await publicView(token);
    expect(stranger.ok).toBe(false);
    expect(stranger.error).toBe("TOKEN_NOT_FOUND");
    expect(JSON.stringify(stranger)).not.toContain(String(DRIVER_POINT.lat));
  });

  it("٢٥) الحَكَمُ يُجيبُ الحكمَ نفسَه للطلبِ مباشرةً — حَكَمٌ واحدٌ لا حكمانِ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    await endRide(orderId, (await graceMinutes()) + 30);

    const [direct] = await sql<{ result: LifetimePayload }[]>`
      select tracking_link_lifetime(${orderId}::uuid) as result
    `;
    const viaOwner = (await shareState(RIDER_TELEGRAM_ID, orderId)).lifetime;
    expect(direct?.result.verdict).toBe("EXPIRED_RIDE_ENDED");
    expect(viaOwner?.verdict).toBe(direct?.result.verdict);
    expect(viaOwner?.grace_minutes).toBe(direct?.result.grace_minutes);
    expect(viaOwner?.grace_source).toBe(direct?.result.grace_source);

    // وطلبٌ معدومٌ: `null` حكماً — لا صفٌّ مُختلَقٌ ولا حكمٌ متسامحٌ.
    const [absent] = await sql<{ result: LifetimePayload | null }[]>`
      select tracking_link_lifetime(${crypto.randomUUID()}::uuid) as result
    `;
    expect(absent?.result).toBeNull();
  });

  it("٢٦) غيابُ إعدادِ المهلةِ يُنشَرُ `FALLBACK_DEFAULT` **باسمِه** ويُحكَمُ به", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    expect((await issue(orderId, RIDER_TELEGRAM_ID, freshToken())).ok).toBe(true);
    await endRide(orderId, 1);
    const [saved] = await sql<
      {
        value_text: string;
        value_type: string;
        description_ar: string | null;
        is_provisional: boolean;
      }[]
    >`
      select value::text as value_text, value_type, description_ar, is_provisional
        from platform_settings
       where city_id = ${cityId} and key = 'tracking_link_grace_minutes'
    `;
    if (saved === undefined) throw new Error("لا إعدادَ لمهلةِ الرابطِ في مدينةِ الاختبارِ");
    await sql`
      delete from platform_settings
       where city_id = ${cityId} and key = 'tracking_link_grace_minutes'
    `;
    try {
      const payload = await shareState(RIDER_TELEGRAM_ID, orderId);
      expect(payload.lifetime?.grace_source).toBe("FALLBACK_DEFAULT");
      expect(payload.lifetime?.grace_minutes).toBe(15);
      expect(payload.lifetime?.verdict).toBe("LIVE_GRACE");
    } finally {
      await sql`
        insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
        values (${cityId}, 'tracking_link_grace_minutes',
                ${saved.value_text}::text::jsonb, ${saved.value_type},
                ${saved.description_ar}, ${saved.is_provisional})
        on conflict (city_id, key) do update
           set value = excluded.value, value_type = excluded.value_type
      `;
    }
    const [restored] = await sql<{ value_text: string }[]>`
      select value::text as value_text from platform_settings
       where city_id = ${cityId} and key = 'tracking_link_grace_minutes'
    `;
    expect(restored?.value_text).toBe(saved.value_text);
  });
});

/**
 * ═══ `F12-04` — كاشفُ الحالاتِ العالقةِ ═══
 *
 * وأهمُّ ما ههنا **لا يقدرُ عليه اختبارُ وحدةٍ**: أنَّ حكمَ «عَلِقَ» يُحسَبُ
 * بساعةِ القاعدةِ على إشارةِ حياةٍ مُقاسةٍ، وأنَّ رابطَ رحلةٍ عَلِقَت يموتُ
 * **والوظيفةُ الدوريّةُ لم تدُرْ قطُّ** و`expires_at` ما زالَ بعدَ ساعاتٍ.
 *
 * ═══ وما لا يُقاسُ ههنا عن قصدٍ ═══
 * **لا يُقاسُ إلغاءٌ ولا إفشالٌ ولا عقوبةٌ** — لأنَّ الكاشفَ لا يفعلُها. وتلكَ
 * قرارٌ تجاريٌّ يمسُّ `F2-05` لم يُتَّخَذْ، واختبارٌ يقيسُها كانَ سيُثبِّتُ
 * سياسةً مُختلَقةً بدلاً من أن يكشفَ غيابَها.
 */
interface StallPayload {
  readonly verdict: string;
  readonly status: string | null;
  readonly idle_seconds: number | null;
  readonly threshold_minutes: number | null;
  readonly threshold_source: string | null;
  readonly signal_source: string | null;
  readonly last_signal_at: string | null;
}

describeIf("F12-04 — حَكَمُ الحالاتِ العالقةِ", () => {
  async function stallOf(orderId: string): Promise<StallPayload | null> {
    const [row] = await sql<{ result: StallPayload | null }[]>`
      select order_stall_state(${orderId}::uuid) as result
    `;
    return row?.result ?? null;
  }

  /**
   * **ولا مُساعِدَ يُقدِّمُ `orders.updated_at` ههنا — لأنَّه مستحيلٌ.**
   *
   * محرِّكُ `orders_set_updated_at` (`before update on orders`) يفرضُ
   * `updated_at = now()` عندَ **كلِّ** كتابةٍ، فعبارةٌ تكتبُ فيه ماضياً يُبطِلُها
   * المحرِّكُ في اللحظةِ نفسِها. فالسكونُ يُزرَعُ حيثُ **يُمكِنُ** زرعُه:
   * `drivers.last_location_at` — وهوَ الإشارةُ التي يحكمُ بها الحَكَمُ أصلاً متى
   * كانَ سائقٌ مُسنَداً يبثُّ. ولولا هذا الاكتشافُ لبقيَ الحكمُ يأخذُ أحدثَ
   * الطابعَينِ فيُقنِّعُ سائقاً ميّتاً بلمسةِ صفٍّ.
   */

  it("٢٧) طلبٌ جارٍ حديثُ الإشارةِ حكمُه `LIVE` لا `STALLED`", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(5);
    const stall = await stallOf(orderId);

    expect(stall?.verdict).toBe("LIVE");
    // والإشارةُ تُنشَرُ باسمِها: رقمٌ بلا نسبٍ لا يُراجَعُ.
    expect(stall?.signal_source).toBe("DRIVER_LOCATION");
    expect(stall?.threshold_source).toBe("SETTING");
    expect(stall?.idle_seconds).toBeLessThan(60);
  });

  it("٢٨) طلبٌ جارٍ سكنَ فوقَ مهلتِه حكمُه `STALLED` بساعةِ القاعدةِ", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(4 * 60 * 60);
    const stall = await stallOf(orderId);

    expect(stall?.verdict).toBe("STALLED");
    // والحكمُ على **موقعِ السائقِ** لا على لمسةِ الصفِّ — و`updated_at` الآنَ
    // `now()` بفعلِ المحرِّكِ، فلو أُخِذَ أحدثُ الطابعَينِ لقُرِئَ الطلبُ حيّاً.
    expect(stall?.signal_source).toBe("DRIVER_LOCATION");
    expect(stall?.status).toBe("in_progress");
    expect(stall?.idle_seconds ?? 0).toBeGreaterThan((stall?.threshold_minutes ?? 0) * 60);
  });

  it("٢٩) سالبٌ (ح-7): طلبٌ منتهٍ **لا يَعلَقُ** — والمعنى لا يُمَدُّ إلى غيرِ محلِّه", async () => {
    const orderId = await seedOrder({ riderId, status: "completed", driver: driverId });
    await seedDriverLocation(9 * 60 * 60);
    const stall = await stallOf(orderId);

    // القاعدةُ الحارسةُ: `is_active_order_status` هوَ المصدرُ الوحيدُ لمعنى
    // «جارٍ». ولو قِيسَ السكونُ على منتهٍ لصارَ كلُّ طلبٍ قديمٍ في القاعدةِ
    // «عالقاً» فغرِقَ سجلُّ المُشغِّلِ في ضجيجٍ وضاعَ فيه العالقُ الحقيقيُّ.
    expect(stall?.verdict).toBe("NOT_ACTIVE");
    expect(stall?.idle_seconds).toBeNull();
    expect(stall?.threshold_minutes).toBeNull();
  });

  it("٣٠) طلبٌ معدومٌ: `null` حكماً لا صفٌّ مُختلَقٌ ولا حكمٌ متسامحٌ", async () => {
    expect(await stallOf(crypto.randomUUID())).toBeNull();
  });

  it("٣١) لكلِّ حالةٍ مهلتُها — و`searching` تُقاسُ بعمرِ الصفِّ لا بموقعِ سائقٍ", async () => {
    const searching = await seedOrder({ riderId, status: "searching", driver: null });
    const inProgress = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    await seedDriverLocation(5);
    const a = await stallOf(searching);
    const b = await stallOf(inProgress);

    // `searching` بلا سائقٍ مُسنَدٍ فلا تُدَّعى إشارةُ سائقٍ لها.
    expect(a?.signal_source).toBe("ORDER_TOUCHED");
    expect(b?.signal_source).toBe("DRIVER_LOCATION");
    // مهلةٌ واحدةٌ لحالتَينِ مختلفتَينِ كانت ستُخطئَ في إحداهما حتماً:
    // البحثُ بلا سائقٍ يُحتمَلُ فيه طولٌ، والرحلةُ الجاريةُ لا يُحتمَلُ.
    expect(a?.threshold_minutes).not.toBe(b?.threshold_minutes);
  });

  it("٣٢) رابطُ رحلةٍ عَلِقَت يموتُ **والوظيفةُ الدوريّةُ لم تدُرْ قطُّ**", async () => {
    const orderId = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    const token = freshToken();
    expect((await issue(orderId, RIDER_TELEGRAM_ID, token)).ok).toBe(true);
    await seedDriverLocation(6 * 60 * 60);

    // **لا نداءَ لـ`expire_tracking_tokens` ههنا عن قصدٍ**، و`expires_at` بعيدٌ.
    const [row] = await sql<{ far: boolean; revoked: boolean }[]>`
      select expires_at > now() + interval '6 hours' as far,
             revoked_at is not null as revoked
        from trip_tracking_tokens where token = ${token}
    `;
    expect(row?.far).toBe(true);
    expect(row?.revoked).toBe(false);

    const [life] = await sql<{ result: LifetimePayload }[]>`
      select tracking_link_lifetime(${orderId}::uuid) as result
    `;
    expect(life?.result.verdict).toBe("EXPIRED_RIDE_STALLED");
    expect(life?.result.seconds_remaining).toBe(0);

    // والغريبُ يُرَدُّ بالجوابِ الواحدِ، **ولا إحداثيّةَ تُغادِرُ القاعدةَ**.
    const stranger = await publicView(token);
    expect(stranger.ok).toBe(false);
    expect(JSON.stringify(stranger)).not.toContain(String(DRIVER_POINT.lat));
  });

  it("٣٣) الكاشفُ يُحصي العالقَ وحدَه، أطولَ سكوناً أوّلاً، ولا يمسُّ الحيَّ", async () => {
    const stuckA = await seedOrder({ riderId, status: "in_progress", driver: driverId });
    // I1 (ADR 0286): السائقُ الواحدُ لا يحملُ التزامين — فالعالقُ الثاني لسائقٍ آخرَ
    // بذرَه الاختبارُ: المقيسُ إحصاءُ الكاشفِ للعالقين، لا سائقٌ واحدٌ بلا دعوى.
    const secondDriverUser = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${DRIVER_TELEGRAM_ID + 1}, 'driver', 'سائقُ عالقٍ ثانٍ', '+966500000994')
      returning id`;
    secondDriverUserId = secondDriverUser[0]?.id ?? "";
    if (secondDriverUserId === "") throw new Error("SECOND_DRIVER_USER_MISSING");
    const secondDriver = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${secondDriverUserId}::uuid, 'verified'::verification_status, 'سيدان', 'ر س ب 5678')
      returning id`;
    const secondDriverId = secondDriver[0]?.id;
    if (secondDriverId === undefined) throw new Error("SECOND_DRIVER_MISSING");
    const stuckB = await seedOrder({ riderId, status: "in_progress", driver: secondDriverId });
    const fresh = await seedOrder({ riderId, status: "searching", driver: null });
    await seedDriverLocation(10 * 60 * 60);
    // وللسائقِ الثاني — حاملِ العالقِ الثاني — الموقعُ المتقادمُ نفسُه.
    await seedDriverLocation(10 * 60 * 60, true, secondDriverId);

    const rows = await sql<{ order_id: string; idle_seconds: number }[]>`
      select order_id, idle_seconds from detect_stalled_orders(${cityId}::uuid, 100)
    `;
    const ids = rows.map((r) => r.order_id);
    expect(ids).toContain(stuckA);
    expect(ids).toContain(stuckB);
    // **وطلبٌ حيٌّ لا يُحصى**: حاجزٌ يردُّ كلَّ شيءٍ لا يُميِّزُ شيئاً.
    expect(ids).not.toContain(fresh);

    // عقدُ الترتيبِ: أطولَ سكوناً أوّلاً — فمن عَلِقَ أطولَ أحقُّ بنظرِ المُشغِّلِ.
    const idle = rows.map((r) => Number(r.idle_seconds));
    expect(idle).toEqual([...idle].sort((a, b) => b - a));

    // **ولا يُغيِّرُ الكاشفُ حالةَ طلبٍ**: قراءةٌ محضةٌ، والحالاتُ كما زُرِعَت.
    const after = await sql<{ status: string }[]>`
      select status from orders where id in (${stuckA}, ${stuckB})
    `;
    expect(after.every((r) => r.status === "in_progress")).toBe(true);
  });

  it("٣٤) المهلاتُ الثلاثُ مبذورةٌ `is_provisional` — قيمٌ تشغيليّةٌ لا سياسةٌ مُصادَقٌ عليها", async () => {
    const rows = await sql<{ key: string; is_provisional: boolean }[]>`
      select key, is_provisional from platform_settings
       where city_id = ${cityId} and key like 'stalled_order%'
       order by key
    `;
    expect(rows.map((r) => r.key)).toEqual([
      "stalled_order_in_progress_minutes",
      "stalled_order_matched_minutes",
      "stalled_order_searching_minutes",
    ]);
    // والرايةُ **موضعُ الحقيقةِ** لا تعليقٌ في ملفٍّ: المالكُ لم يُصادِقْ عليها بعدُ.
    expect(rows.every((r) => r.is_provisional)).toBe(true);
  });
});
