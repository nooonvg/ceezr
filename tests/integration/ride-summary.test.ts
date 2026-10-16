/**
 * الغرض: قياسُ `completed_ride_summary` و`submit_rating_with_tags` على قاعدةٍ
 *   حقيقيّةٍ (`F2-07` · `SR-08`) — وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ حاجزٌ
 *   ساكنٌ ولا محرِّكٌ مُصنَّعٌ على قياسِه**:
 *     ــ أنَّ المِلكيّةَ **قيدُ استعلامٍ** لا فحصُ تطبيقٍ: ملخَّصُ رحلةِ راكبٍ
 *        آخرَ يُرَدُّ `ORDER_NOT_FOUND` من القاعدةِ نفسِها.
 *     ــ أنَّ المدّةَ **تقيسُها القاعدةُ** من ختمَيها لا الشاشةُ بساعةِ الجهازِ،
 *        وأنَّ ختماً ناقصاً يُنتِجُ `null` **لا صفراً**.
 *     ــ أنَّ رحلةً بلا وجهةٍ لا وترَ لها: `null` لا «٠ متراً».
 *     ــ أنَّ نافذةَ التقييمِ **تُقاسُ بساعةِ القاعدةِ** (`now()`)، فيُغلَقُ بابُ
 *        رحلةٍ قديمةٍ ولو زعمَ الجهازُ خلافَ ذلكَ.
 *     ــ أنَّ التقييمَ الثانيَ يُرَدُّ `ALREADY_RATED` **بالقيدِ الفريدِ** لا
 *        بفحصٍ سابقٍ في التطبيقِ — والفرقُ يظهرُ في السباقِ وحدَه.
 *     ــ أنَّ وسماً مجهولاً يُرَدُّ **قبلَ أيِّ قراءةِ صفٍّ**.
 *     ــ أنَّ `submit_rating` القديمةَ بقيَت **هيَ هيَ** بعدَ التفويضِ.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `SD-09` حينَ يُبنى تقييمُ السائقِ للراكبِ على
 *   الصفوفِ نفسِها، و`F2-09` إذ يزيدُ رمزَ تتبُّعٍ ولا يمسُّ هذه الأحكامَ.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ أجرةٌ ولا إيصالٌ**: محجوبانِ بـ`ADR 0039` §٤ و`م13-7` و`DEC-11`،
 *    والمقيسُ ههنا **غيابُهما من الحمولةِ** لا صحّةُ حسابٍ لا وجودَ له.
 * ــ **لا يُقاسُ تقييمُ السائقِ للراكبِ**: الاتجاهُ مبنيٌّ في القاعدةِ منذُ
 *    `Phase 2.5` وسطحُه `SD-09` غيرُ مبنيٍّ، فلا يُدَّعى.
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
const RIDER_TELEGRAM_ID = 900_000_971;
const OTHER_RIDER_TELEGRAM_ID = 900_000_972;
const DRIVER_TELEGRAM_ID = 900_000_973;
const STRANGER_TELEGRAM_ID = 900_000_974;
const ABSENT_TELEGRAM_ID = 900_000_975;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";
let otherUserId = "";
let otherRiderId = "";
let driverUserId = "";
let driverId = "";
let strangerUserId = "";

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;

interface SummaryPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly order_id?: string;
  readonly status?: string;
  readonly service?: string;
  readonly pickup_label?: string | null;
  readonly dropoff_label?: string | null;
  readonly created_at?: string;
  readonly matched_at?: string | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly duration_seconds?: number | string | null;
  readonly straight_line_meters?: number | string | null;
  readonly driver?: {
    first_name: string | null;
    vehicle_type: string | null;
    plate_number: string | null;
    rating_average: number | string | null;
    rating_count: number | string;
  } | null;
  readonly rating?: {
    already_rated: boolean;
    window_hours: number | string;
    window_closed: boolean;
    can_rate: boolean;
  };
}

interface RatingPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly rating_id?: string;
  readonly direction?: string;
  readonly stars?: number;
  readonly tags?: readonly string[];
}

async function summary(telegramId: number, orderId: string): Promise<SummaryPayload> {
  const [row] = await sql<{ result: SummaryPayload }[]>`
    select completed_ride_summary(${telegramId}::bigint, ${orderId}::uuid) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

async function rate(options: {
  readonly orderId: string;
  readonly telegramId: number;
  readonly stars: number;
  readonly comment?: string | null;
  readonly tags?: readonly string[] | null;
}): Promise<RatingPayload> {
  const [row] = await sql<{ result: RatingPayload }[]>`
    select submit_rating_with_tags(
      ${options.orderId}::uuid,
      ${options.telegramId}::bigint,
      ${options.stars}::smallint,
      ${options.comment ?? null}::text,
      ${options.tags === undefined || options.tags === null ? null : [...options.tags]}::text[]
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/** التوقيعُ القديمُ نفسُه — يُنادى كما ينادِيه كلُّ مُنادٍ قائمٍ. */
async function rateLegacy(options: {
  readonly orderId: string;
  readonly telegramId: number;
  readonly stars: number;
  readonly comment?: string | null;
}): Promise<RatingPayload> {
  const [row] = await sql<{ result: RatingPayload }[]>`
    select submit_rating(
      ${options.orderId}::uuid,
      ${options.telegramId}::bigint,
      ${options.stars}::smallint,
      ${options.comment ?? null}::text
    ) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/**
 * طلبٌ مزروعٌ بحالةٍ وأختامٍ مُعيَّنةٍ. والزرعُ مباشرٌ لا عبرَ `request_ride`:
 * المقيسُ ههنا **قراءةُ رحلةٍ منتهيةٍ**، ولا دالّةَ في المستودعِ تُنهي رحلةً
 * ببثِّ سائقٍ — ذاكَ عملُ `F3` غيرُ المبنيِّ.
 *
 * والأختامُ تُكتَبُ **إزاحاتٍ عن ساعةِ القاعدةِ** لا نصوصاً ثابتةً: القصدُ قياسُ
 * أنَّ القاعدةَ تحكمُ بساعتِها، فلو زُرِعَ وقتٌ ثابتٌ لَشاخَ الاختبارُ وصارَ
 * يسقطُ بعدَ يومٍ لسببٍ ليسَ هوَ المقصودَ.
 */
async function seedOrder(options: {
  readonly riderId: string;
  readonly status: string;
  readonly driver?: string | null;
  readonly dropoff?: boolean;
  readonly matchedMinutesAgo?: number | null;
  readonly startedMinutesAgo?: number | null;
  readonly completedMinutesAgo?: number | null;
}): Promise<string> {
  const stamp = (minutes: number | null | undefined) =>
    minutes === null || minutes === undefined
      ? sql`null::timestamptz`
      : sql`now() - make_interval(mins => ${minutes})`;
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label,
      assigned_driver_id, idempotency_key, matched_at, started_at, completed_at
    ) values (
      ${cityId}, ${options.riderId}, 'transport'::service_type, ${options.status}::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      ${
        options.dropoff === false
          ? null
          : sql`st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography`
      },
      'البلد',
      ${options.dropoff === false ? null : "الروضة"},
      ${options.driver ?? null},
      ${`ride-summary:${crypto.randomUUID()}`},
      ${stamp(options.matchedMinutesAgo)},
      ${stamp(options.startedMinutesAgo)},
      ${stamp(options.completedMinutesAgo)}
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** رحلةٌ منتهيةٌ نموذجيّةٌ: أُسنِدَت وبدأَت وانتهَت بأختامٍ متباعدةٍ معلومةٍ. */
async function seedCompleted(over: Parameters<typeof seedOrder>[0] | null = null): Promise<string> {
  return seedOrder({
    riderId,
    status: "completed",
    driver: driverId,
    matchedMinutesAgo: 40,
    startedMinutesAgo: 35,
    completedMinutesAgo: 20,
    ...(over ?? {}),
  });
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب الملخَّص', '+966500000971')
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
    values (${cityId}, ${OTHER_RIDER_TELEGRAM_ID}, 'rider', 'راكب آخر للملخَّص', '+966500000972')
    returning id
  `;
  if (otherUser === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherUserId = otherUser.id;
  const [otherRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${otherUserId}) returning id
  `;
  if (otherRider === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherRiderId = otherRider.id;

  const [stranger] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${STRANGER_TELEGRAM_ID}, 'rider', 'غريبٌ عن الرحلةِ', '+966500000974')
    returning id
  `;
  if (stranger === undefined) throw new Error("تعذّر زرعُ الغريبِ");
  strangerUserId = stranger.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سالم خالد العمري', '+966500000973')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر س ب 9712')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

/**
 * والحصادُ **بأقلِّ ذهابٍ وإياباً**: كلُّ عبارةٍ رحلةُ شبكةٍ إلى قاعدةٍ بعيدةٍ،
 * وحلقةٌ تحذفُ صفّاً صفّاً تُطيلُ الخُطّافَ حتّى يسقطَ بالمهلةِ لا بالخطأِ —
 * وسقوطٌ كهذا يُقرأُ عطباً في المقيسِ وليسَ فيه.
 */
beforeEach(async () => {
  if (DATABASE_URL === undefined) return;
  // I1 (ADR 0286): فهرسُ الالتزامِ الواحدِ للسائقِ يرفضُ بذرَ التزامٍ ثانٍ لسائقٍ
  // لا يزالُ التزامُ اختبارٍ سابقٍ حيًّا — فتُنهى التزاماتُ هذا الملفِّ قبلَ كلِّ اختبارٍ.
  await sql`update orders set status = 'completed', completed_at = now() where idempotency_key like 'ride-summary:%' and is_driver_engaged_order_status(status)`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  const riderIds = [riderId, otherRiderId].filter((id) => id !== "");
  const userIds = [riderUserId, otherUserId, strangerUserId, driverUserId].filter(
    (id) => id !== "",
  );
  if (riderIds.length > 0) {
    await sql`
      delete from ratings
       where order_id in (select id from orders where rider_id = any(${riderIds}::uuid[]))
    `;
    await sql`
      delete from order_offers
       where order_id in (select id from orders where rider_id = any(${riderIds}::uuid[]))
    `;
    await sql`delete from orders where rider_id = any(${riderIds}::uuid[])`;
    await sql`delete from riders where id = any(${riderIds}::uuid[])`;
  }
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  if (userIds.length > 0) {
    await sql`delete from audit_log where actor_user_id = any(${userIds}::uuid[])`;
    await sql`delete from users where id = any(${userIds}::uuid[])`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("المِلكيّةُ قيدُ استعلامٍ لا فحصُ تطبيقٍ", () => {
  it("١) المالكُ يقرأُ ملخَّصَه", async () => {
    const orderId = await seedCompleted();
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.ok).toBe(true);
    expect(payload.order_id).toBe(orderId);
    expect(payload.status).toBe("completed");
    expect(payload.service).toBe("transport");
    expect(payload.pickup_label).toBe("البلد");
  });

  it("٢) **راكبٌ آخرُ يُرَدُّ `ORDER_NOT_FOUND`** — لا «ممنوعٌ» يُثبِتُ الوجودَ", async () => {
    const orderId = await seedCompleted();
    const payload = await summary(OTHER_RIDER_TELEGRAM_ID, orderId);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("ORDER_NOT_FOUND");
  });

  it("٣) طلبٌ لا وجودَ له يُرَدُّ بالرمزِ نفسِه", async () => {
    const payload = await summary(RIDER_TELEGRAM_ID, crypto.randomUUID());
    expect(payload.error).toBe("ORDER_NOT_FOUND");
  });

  it("٤) مستخدمٌ غيرُ موجودٍ وراكبٌ غيرُ مسجَّلٍ: رمزانِ متمايزانِ", async () => {
    const absent = await summary(ABSENT_TELEGRAM_ID, crypto.randomUUID());
    expect(absent.error).toBe("USER_NOT_FOUND");
    const unregistered = await summary(STRANGER_TELEGRAM_ID, crypto.randomUUID());
    expect(unregistered.error).toBe("RIDER_NOT_REGISTERED");
  });
});

describeIf("المدّةُ بساعةِ القاعدةِ — والعَدَمُ ليسَ صفراً", () => {
  it("٥) المدّةُ فرقُ الختمَينِ كما تحسبُه القاعدةُ", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      matchedMinutesAgo: 40,
      startedMinutesAgo: 35,
      completedMinutesAgo: 20,
    });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    // خمسَ عشرةَ دقيقةً بينَ الختمَينِ — بهامشِ ثانيةٍ لتنفيذِ الزرعِ نفسِه.
    expect(Number(payload.duration_seconds)).toBeGreaterThanOrEqual(899);
    expect(Number(payload.duration_seconds)).toBeLessThanOrEqual(901);
    const started = Date.parse(String(payload.started_at));
    const completed = Date.parse(String(payload.completed_at));
    expect(Math.round((completed - started) / 1000)).toBe(Number(payload.duration_seconds));
  });

  it("٦) **ختمُ بدءٍ ناقصٌ ⇒ `null` لا صفرٌ**: «٠ د» تُقرأُ رحلةً لحظيّةً", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      matchedMinutesAgo: 40,
      startedMinutesAgo: null,
      completedMinutesAgo: 20,
    });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.started_at).toBeNull();
    expect(payload.duration_seconds).toBeNull();
  });

  it("٧) والأختامُ الأربعةُ تُنشَرُ كما هيَ، والناقصُ منها `null`", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      matchedMinutesAgo: null,
      startedMinutesAgo: 30,
      completedMinutesAgo: 10,
    });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.created_at).not.toBeNull();
    expect(payload.matched_at).toBeNull();
    expect(payload.started_at).not.toBeNull();
    expect(payload.completed_at).not.toBeNull();
  });
});

describeIf("وترُ الخطِّ المستقيمِ — لا مسافةٌ مقطوعةٌ تُدَّعى", () => {
  it("٨) الوترُ يُقاسُ من `geography` نفسِها لا من حسابٍ في التطبيقِ", async () => {
    const orderId = await seedCompleted();
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    const [row] = await sql<{ meters: string }[]>`
      select round(st_distance(pickup, dropoff)::numeric, 1) as meters
        from orders where id = ${orderId}
    `;
    expect(Number(payload.straight_line_meters)).toBe(Number(row?.meters));
    // ومكّةُ ليسَت أوسلو: انقلابُ العرضِ والطولِ يُظهِرُ رقماً من قارّةٍ أُخرى.
    expect(Number(payload.straight_line_meters)).toBeGreaterThan(7_000);
    expect(Number(payload.straight_line_meters)).toBeLessThan(10_000);
  });

  it("٩) **لا وجهةَ ⇒ `null`** لا «٠ متراً» تُقرأُ «لم تتحرَّكْ»", async () => {
    const orderId = await seedCompleted({ riderId, status: "completed", dropoff: false });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.dropoff_label).toBeNull();
    expect(payload.straight_line_meters).toBeNull();
  });
});

describeIf("بطاقةُ السائقِ والمالُ", () => {
  it("١٠) البطاقةُ بلا موقعٍ ولا هاتفٍ ولا أجرةٍ — والرحلةُ انتهَت", async () => {
    const orderId = await seedCompleted();
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(Object.keys(payload.driver ?? {}).sort()).toEqual([
      "first_name",
      "plate_number",
      "rating_average",
      "rating_count",
      "vehicle_type",
    ]);
    // الاسمُ الأوّلُ وحدَه: الرحلةُ انتهَت فلا حاجةَ لاسمٍ كاملٍ.
    expect(payload.driver?.first_name).toBe("سالم");
  });

  it("١١) **لا لفظَ مالٍ في الحمولةِ كلِّها**: الأجرةُ مُجمَّدةٌ", async () => {
    const orderId = await seedCompleted();
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    const text = JSON.stringify(payload).toLowerCase();
    for (const token of ["fare", "price", "amount", "receipt", "currency", "tip", "commission"]) {
      expect(text.includes(token)).toBe(false);
    }
  });

  it("١٢) رحلةٌ أُلغِيَت بعدَ إسنادٍ: لا بطاقةَ سائقٍ ولا أهليّةَ تقييمٍ", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "cancelled",
      driver: driverId,
      matchedMinutesAgo: 40,
      startedMinutesAgo: null,
      completedMinutesAgo: null,
    });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.ok).toBe(true);
    expect(payload.driver).toBeNull();
    expect(payload.rating?.can_rate).toBe(false);
    // لا ختمَ انتهاءٍ ⇒ النافذةُ مُغلَقةٌ حكماً لا «مفتوحةٌ إلى الأبدِ».
    expect(payload.rating?.window_closed).toBe(true);
  });
});

describeIf("نافذةُ التقييمِ تُقاسُ بساعةِ القاعدةِ", () => {
  it("١٣) رحلةٌ انتهَت قبلَ ساعاتٍ: النافذةُ مفتوحةٌ", async () => {
    const orderId = await seedCompleted({ riderId, status: "completed" });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.rating?.window_hours).toBe(48);
    expect(payload.rating?.window_closed).toBe(false);
    expect(payload.rating?.already_rated).toBe(false);
    expect(payload.rating?.can_rate).toBe(true);
  });

  it("١٤) **رحلةٌ انتهَت قبلَ تسعٍ وأربعينَ ساعةً: البابُ مُغلَقٌ**", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      matchedMinutesAgo: 60 * 50,
      startedMinutesAgo: 60 * 49 + 30,
      completedMinutesAgo: 60 * 49,
    });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.rating?.window_closed).toBe(true);
    expect(payload.rating?.can_rate).toBe(false);

    // والقراءةُ والكتابةُ **تتّفقانِ**: الكتابةُ تردُّ بالرمزِ الذي وعدَت به القراءةُ.
    const refused = await rate({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 5 });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("RATING_WINDOW_CLOSED");
  });

  it("١٥) وسبعٌ وأربعونَ ساعةً ما زالَت داخلَ النافذةِ — الحدُّ مقيسٌ لا مُقدَّرٌ", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      matchedMinutesAgo: 60 * 48,
      startedMinutesAgo: 60 * 47 + 30,
      completedMinutesAgo: 60 * 47,
    });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.rating?.window_closed).toBe(false);
    expect(payload.rating?.can_rate).toBe(true);
  });
});

describeIf("التقييمُ بوسومٍ — القيدُ في القاعدةِ", () => {
  it("١٦) تقييمٌ بثلاثةِ وسومٍ يُقبَلُ ويُخزَّنُ بها", async () => {
    const orderId = await seedCompleted();
    const accepted = await rate({
      orderId,
      telegramId: RIDER_TELEGRAM_ID,
      stars: 5,
      comment: "  شكراً جزيلاً  ",
      tags: ["cleanliness", "politeness", "punctuality"],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.direction).toBe("rider_to_driver");
    expect(accepted.tags).toEqual(["cleanliness", "politeness", "punctuality"]);

    const [row] = await sql<{ tags: string[] | null; comment: string | null; stars: number }[]>`
      select tags, comment, stars from ratings where order_id = ${orderId}
    `;
    expect(row?.tags).toEqual(["cleanliness", "politeness", "punctuality"]);
    // الملاحظةُ تُشذَّبُ ولا تُخزَّنُ بفراغاتِها.
    expect(row?.comment).toBe("شكراً جزيلاً");
    expect(Number(row?.stars)).toBe(5);
  });

  it("١٧) والملخَّصُ بعدَه يقولُ «قيَّمتَ» ولا يُعيدُ فتحَ البابِ", async () => {
    const orderId = await seedCompleted();
    await rate({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 4, tags: ["punctuality"] });
    const payload = await summary(RIDER_TELEGRAM_ID, orderId);
    expect(payload.rating?.already_rated).toBe(true);
    expect(payload.rating?.can_rate).toBe(false);
    expect(payload.rating?.window_closed).toBe(false);
  });

  it("١٨) **التقييمُ الثاني `ALREADY_RATED` بالقيدِ الفريدِ** لا بفحصٍ سابقٍ", async () => {
    const orderId = await seedCompleted();
    const first = await rate({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 5 });
    expect(first.ok).toBe(true);
    const second = await rate({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 1 });
    expect(second.ok).toBe(false);
    expect(second.error).toBe("ALREADY_RATED");

    // والصفُّ الأوّلُ **لم يُمَسَّ**: الرفضُ ليسَ تحديثاً صامتاً.
    const [row] = await sql<{ stars: number; count: string }[]>`
      select stars, (select count(*) from ratings where order_id = ${orderId}) as count
        from ratings where order_id = ${orderId}
    `;
    expect(Number(row?.stars)).toBe(5);
    expect(Number(row?.count)).toBe(1);
  });

  it("١٩) القيدُ الفريدُ نفسُه موجودٌ في المخطَّطِ — لا في التطبيقِ", async () => {
    const [row] = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes
       where schemaname = 'public' and indexname = 'ratings_one_per_order_direction'
    `;
    expect(row?.indexdef).toContain("UNIQUE");
    expect(row?.indexdef).toContain("order_id");
    expect(row?.indexdef).toContain("direction");
  });

  it("٢٠) **الوسمُ المجهولُ يُرَدُّ قبلَ أيِّ قراءةِ صفٍّ**", async () => {
    // طلبٌ لا وجودَ له ومُقيِّمٌ لا وجودَ له: لو قُرِئَ صفٌّ قبلَ الوسمِ لَكانَ
    // الرمزُ `RATER_NOT_FOUND` أو `ORDER_NOT_FOUND` — فالرمزُ ههنا شاهدُ ترتيبٍ.
    const refused = await rate({
      orderId: crypto.randomUUID(),
      telegramId: ABSENT_TELEGRAM_ID,
      stars: 5,
      tags: ["friendly"],
    });
    expect(refused.error).toBe("UNKNOWN_RATING_TAG");
  });

  it("٢١) وأكثرُ من ثلاثةٍ، والمكرَّرُ: رمزانِ متمايزانِ لا رمزٌ عامٌّ", async () => {
    const many = await rate({
      orderId: crypto.randomUUID(),
      telegramId: ABSENT_TELEGRAM_ID,
      stars: 5,
      tags: ["cleanliness", "politeness", "punctuality", "driving_safety"],
    });
    expect(many.error).toBe("TOO_MANY_RATING_TAGS");
    const duplicated = await rate({
      orderId: crypto.randomUUID(),
      telegramId: ABSENT_TELEGRAM_ID,
      stars: 5,
      tags: ["cleanliness", "cleanliness"],
    });
    expect(duplicated.error).toBe("DUPLICATE_RATING_TAG");
  });

  it("٢٢) **والقيدُ في العمودِ نفسِه**: كتابةٌ مباشرةٌ بوسمٍ مجهولٍ تُرَدُّ", async () => {
    const orderId = await seedCompleted();
    let refused = false;
    try {
      await sql`
        insert into ratings (city_id, order_id, direction, rater_user_id, ratee_user_id, stars, tags)
        values (${cityId}, ${orderId}, 'rider_to_driver'::rating_direction,
                ${riderUserId}, ${driverUserId}, 5, array['friendly']::text[])
      `;
    } catch (thrown) {
      refused = String(thrown).includes("ratings_tags_vocabulary");
    }
    expect(refused).toBe(true);
  });

  it("٢٣) ومصفوفةٌ فارغةٌ تُخزَّنُ `null`: الوجهانِ لمعنىً واحدٍ لا يُخزَّنانِ", async () => {
    const orderId = await seedCompleted();
    const accepted = await rate({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 3, tags: [] });
    expect(accepted.ok).toBe(true);
    expect(accepted.tags).toEqual([]);
    const [row] = await sql<{ tags: string[] | null }[]>`
      select tags from ratings where order_id = ${orderId}
    `;
    expect(row?.tags).toBeNull();
  });

  it("٢٤) ومن ليسَ طرفاً في الرحلةِ لا يُقيِّمُها", async () => {
    const orderId = await seedCompleted();
    const refused = await rate({ orderId, telegramId: OTHER_RIDER_TELEGRAM_ID, stars: 5 });
    expect(refused.error).toBe("RATER_NOT_PARTY_TO_ORDER");
  });

  it("٢٥) ورحلةٌ لم تنتهِ لا تُقيَّمُ", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "in_progress",
      driver: driverId,
      matchedMinutesAgo: 20,
      startedMinutesAgo: 15,
    });
    const refused = await rate({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 5 });
    expect(refused.error).toBe("ORDER_NOT_COMPLETED");
  });
});

describeIf("التوقيعُ القديمُ بعدَ التفويضِ — **هوَ هوَ**", () => {
  it("٢٦) `submit_rating` تقبلُ وتُخزِّنُ بلا وسومٍ", async () => {
    const orderId = await seedCompleted();
    const accepted = await rateLegacy({
      orderId,
      telegramId: RIDER_TELEGRAM_ID,
      stars: 4,
      comment: "طيّبٌ",
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.direction).toBe("rider_to_driver");
    expect(accepted.stars).toBe(4);
    expect(accepted.tags).toEqual([]);
    const [row] = await sql<{ tags: string[] | null; comment: string | null }[]>`
      select tags, comment from ratings where order_id = ${orderId}
    `;
    expect(row?.tags).toBeNull();
    expect(row?.comment).toBe("طيّبٌ");
  });

  it("٢٧) ورموزُ رفضِها كما كانَت حرفاً", async () => {
    const notCompleted = await seedOrder({
      riderId,
      status: "in_progress",
      driver: driverId,
      matchedMinutesAgo: 20,
      startedMinutesAgo: 15,
    });
    expect(
      (await rateLegacy({ orderId: notCompleted, telegramId: RIDER_TELEGRAM_ID, stars: 5 })).error,
    ).toBe("ORDER_NOT_COMPLETED");

    const completed = await seedCompleted();
    expect(
      (await rateLegacy({ orderId: completed, telegramId: RIDER_TELEGRAM_ID, stars: 0 })).error,
    ).toBe("STARS_OUT_OF_RANGE");
    expect(
      (await rateLegacy({ orderId: completed, telegramId: OTHER_RIDER_TELEGRAM_ID, stars: 5 }))
        .error,
    ).toBe("RATER_NOT_PARTY_TO_ORDER");
    expect(
      (await rateLegacy({ orderId: crypto.randomUUID(), telegramId: ABSENT_TELEGRAM_ID, stars: 5 }))
        .error,
    ).toBe("RATER_NOT_FOUND");
    expect(
      (await rateLegacy({ orderId: crypto.randomUUID(), telegramId: RIDER_TELEGRAM_ID, stars: 5 }))
        .error,
    ).toBe("ORDER_NOT_FOUND");
  });

  it("٢٨) والتقييمُ عبرَها يُثمِرُ في متوسِّطِ السائقِ كما كانَ", async () => {
    const [before] = await sql<{ count: number }[]>`
      select rating_count as count from drivers where id = ${driverId}
    `;
    const orderId = await seedCompleted();
    expect((await rateLegacy({ orderId, telegramId: RIDER_TELEGRAM_ID, stars: 5 })).ok).toBe(true);
    const [after] = await sql<{ count: number; average: string | null }[]>`
      select rating_count as count, rating_average as average from drivers where id = ${driverId}
    `;
    expect(Number(after?.count)).toBe(Number(before?.count) + 1);
    expect(after?.average).not.toBeNull();
  });

  it("٢٩) والتفويضُ مكتوبٌ في جسمِ الدالّةِ لا منسوخٌ", async () => {
    const [row] = await sql<{ body: string }[]>`
      select prosrc as body from pg_proc
       where proname = 'submit_rating'
         and pronargs = 4
         and pronamespace = 'public'::regnamespace
    `;
    expect(row?.body).toContain("submit_rating_with_tags");
    // نسخةٌ ثانيةٌ من المنطقِ تفترقُ عندَ أوّلِ تصحيحٍ — فلا نافذةَ ههنا.
    expect(row?.body).not.toContain("rating_prompt_window_hours");
  });
});

describeIf("سطحُ الصلاحيّاتِ لدوالِّ البندِ", () => {
  it("٣٠) الدوالُّ الأربعُ لا يُنفِّذُها `anon` ولا `authenticated` ولا `public`", async () => {
    const rows = await sql<{ name: string; anon: boolean; authenticated: boolean }[]>`
      select p.proname as name,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as authenticated
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('completed_ride_summary', 'submit_rating_with_tags',
                           'submit_rating', 'rating_tags_are_valid')
    `;
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) {
      expect({ name: row.name, anon: row.anon, authenticated: row.authenticated }).toEqual({
        name: row.name,
        anon: false,
        authenticated: false,
      });
    }
  });

  it("٣١) والقراءةُ `stable security invoker` والكتابةُ `security definer`", async () => {
    const rows = await sql<{ name: string; secdef: boolean; volatility: string }[]>`
      select proname as name, prosecdef as secdef, provolatile as volatility
        from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in ('completed_ride_summary', 'submit_rating_with_tags')
    `;
    const read = rows.find((row) => row.name === "completed_ride_summary");
    const write = rows.find((row) => row.name === "submit_rating_with_tags");
    expect(read?.secdef).toBe(false);
    expect(read?.volatility).toBe("s");
    expect(write?.secdef).toBe(true);
    expect(write?.volatility).toBe("v");
  });
});
