/**
 * الغرض: قياسُ `active_ride_snapshot` على قاعدةٍ حقيقيّةٍ (`F2-06` · `SR-06`) —
 *   وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ حاجزٌ ساكنٌ ولا محرِّكٌ مُصنَّعٌ على
 *   قياسِه**:
 *     ــ أنَّ المِلكيّةَ **قيدُ استفسارٍ** لا فحصُ تطبيقٍ: رحلةُ راكبٍ آخرَ
 *        تُرَدُّ `ORDER_NOT_FOUND` من القاعدةِ نفسِها.
 *     ــ أنَّ عُمرَ موقعِ السائقِ **تقيسُه القاعدةُ** بساعتِها (`now()`) لا
 *        الشاشةُ بساعةِ الجهازِ — وذاكَ الفرقُ هوَ ما يجعلُ الحجبَ صادقاً
 *        (`BUG-001`).
 *     ــ أنَّ بطاقةَ السائقِ **لا تُقرأُ** متى خرجَت الرحلةُ من حالتَي
 *        الإسنادِ، ولو بقيَ `assigned_driver_id` مكتوباً في الصفِّ.
 *     ــ أنَّ الإحداثيّاتِ تُقرأُ من `geography` بترتيبِها الصحيحِ: العرضُ عرضٌ
 *        والطولُ طولٌ — وانقلابُهما خطأٌ لا يظهرُ إلّا في مدينةٍ أُخرى.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` يقيسُ ختمَ `completed_at` والتقييمَ على
 *   الصفوفِ نفسِها، و`F2-09` يزيدُ رمزَ التتبُّعِ ولا يُعدِّلُ هذه الحالاتِ.
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ ═══
 * ــ **لا تُقاسُ أجرةٌ ولا عقوبةُ إلغاءٍ**: محجوبتانِ بـ`ADR 0039` §٤ و`م13-7`.
 * ــ **لا يُقاسُ أنَّ راكباً تابعَ سائقاً من جهازٍ**: لا نشرَ حيَّ (`ADR 0099`)،
 *    وبوّابةُ `F2` **غيرُ مُدَّعاةٍ**.
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
const RIDER_TELEGRAM_ID = 900_000_961;
const OTHER_RIDER_TELEGRAM_ID = 900_000_962;
const DRIVER_TELEGRAM_ID = 900_000_963;
const UNREGISTERED_TELEGRAM_ID = 900_000_964;
const ABSENT_TELEGRAM_ID = 900_000_965;

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let riderUserId = "";
let riderId = "";
let otherUserId = "";
let otherRiderId = "";
let driverUserId = "";
let driverId = "";
let unregisteredUserId = "";

const PICKUP = { lat: 21.4858, lng: 39.1925 } as const;
const DROPOFF = { lat: 21.5591, lng: 39.1553 } as const;
const DRIVER_POINT = { lat: 21.4901, lng: 39.1888 } as const;

interface SnapshotPayload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly order_id?: string;
  readonly status?: string;
  readonly service?: string;
  readonly pickup?: { lat: number; lng: number; label: string | null };
  readonly dropoff?: { lat: number; lng: number; label: string | null } | null;
  readonly created_at?: string;
  readonly matched_at?: string | null;
  readonly started_at?: string | null;
  readonly completed_at?: string | null;
  readonly driver?: {
    first_name: string | null;
    vehicle_type: string | null;
    plate_number: string | null;
    rating_average: number | string | null;
    rating_count: number | string;
    position: { lat: number; lng: number; age_seconds: number | null } | null;
  } | null;
}

async function snapshot(telegramId: number, orderId: string): Promise<SnapshotPayload> {
  const [row] = await sql<{ result: SnapshotPayload }[]>`
    select active_ride_snapshot(${telegramId}::bigint, ${orderId}::uuid) as result
  `;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

/**
 * طلبٌ مزروعٌ بحالةٍ ووقتٍ مُعيَّنَينِ. والزرعُ مباشرٌ لا عبرَ `request_ride`:
 * المقيسُ ههنا **القراءةُ** في أطوارٍ لا تُنتِجُها دالّةُ الإنشاءِ (`matched`
 * و`in_progress` و`cancelled`)، وبثُّ السائقِ عملُ `F3` غيرُ المبنيِّ.
 */
async function seedOrder(options: {
  readonly riderId: string;
  readonly status: string;
  readonly driver?: string | null;
  readonly dropoff?: boolean;
  readonly matchedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}): Promise<string> {
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
      ${`active-ride:${crypto.randomUUID()}`},
      ${options.matchedAt ?? null}::timestamptz,
      ${options.startedAt ?? null}::timestamptz,
      ${options.completedAt ?? null}::timestamptz
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** موقعُ السائقِ بختمٍ مُعيَّنٍ — و`null` يزرعُ نقطةً بلا ختمٍ. */
async function seedDriverLocation(ageSeconds: number | null, hasPoint = true): Promise<void> {
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
    where id = ${driverId}
  `;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // `OPS-019`: الشرطُ يُصنَعُ ويُردُّ في `afterAll` — لا يُستعارُ من ملفٍّ سبقَ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكب الرحلة النشطة', '+966500000961')
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
    values (${cityId}, ${OTHER_RIDER_TELEGRAM_ID}, 'rider', 'راكب آخر', '+966500000962')
    returning id
  `;
  if (otherUser === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherUserId = otherUser.id;
  const [otherRider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${otherUserId}) returning id
  `;
  if (otherRider === undefined) throw new Error("تعذّر زرعُ الراكبِ الآخرِ");
  otherRiderId = otherRider.id;

  const [unregistered] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${UNREGISTERED_TELEGRAM_ID}, 'rider', 'راكب غير مسجَّل', '+966500000964')
    returning id
  `;
  if (unregistered === undefined) throw new Error("تعذّر زرعُ المستخدمِ غيرِ المسجَّلِ");
  unregisteredUserId = unregistered.id;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'خالد أحمد الغامدي', '+966500000963')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUserId}, 'verified'::verification_status, 'سيدان', 'ر س ب 1234')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;
});

beforeEach(async () => {
  if (DATABASE_URL === undefined) return;
  // I1 (ADR 0286): فهرسُ الالتزامِ الواحدِ للسائقِ يرفضُ بذرَ التزامٍ ثانٍ لسائقٍ
  // لا يزالُ التزامُ اختبارٍ سابقٍ حيًّا — فتُنهى التزاماتُ هذا الملفِّ قبلَ كلِّ اختبارٍ.
  await sql`update orders set status = 'completed', completed_at = now() where idempotency_key like 'active-ride:%' and is_driver_engaged_order_status(status)`;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  for (const id of [riderId, otherRiderId]) {
    if (id === "") continue;
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${id})`;
    await sql`delete from orders where rider_id = ${id}`;
  }
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  if (otherRiderId !== "") await sql`delete from riders where id = ${otherRiderId}`;
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}`;
  for (const id of [riderUserId, otherUserId, unregisteredUserId, driverUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("المِلكيّةُ قيدُ استفسارٍ لا فحصُ تطبيقٍ", () => {
  it("١) المالكُ يقرأُ لقطتَه", async () => {
    const orderId = await seedOrder({ riderId, status: "searching" });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.ok).toBe(true);
    expect(payload.order_id).toBe(orderId);
    expect(payload.status).toBe("searching");
    expect(payload.service).toBe("transport");
  });

  it("٢) راكبٌ آخرُ يُرَدُّ `ORDER_NOT_FOUND` — لا `FORBIDDEN` ولا حمولةٌ منقوصةٌ", async () => {
    const orderId = await seedOrder({ riderId, status: "searching" });
    const payload = await snapshot(OTHER_RIDER_TELEGRAM_ID, orderId);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("ORDER_NOT_FOUND");
    expect(payload.status).toBeUndefined();
    expect(payload.driver).toBeUndefined();
  });

  it("٣) معرِّفٌ غيرُ موجودٍ ورحلةُ غيرِك جوابُهما **واحدٌ**: لا عدَّادَ معرّفاتٍ", async () => {
    const mine = await snapshot(RIDER_TELEGRAM_ID, crypto.randomUUID());
    const notMine = await snapshot(
      OTHER_RIDER_TELEGRAM_ID,
      await seedOrder({ riderId, status: "searching" }),
    );
    expect(mine.error).toBe("ORDER_NOT_FOUND");
    expect(notMine.error).toBe("ORDER_NOT_FOUND");
  });

  it("٤) حسابٌ غائبٌ وراكبٌ غيرُ مُسجَّلٍ رمزانِ مفصولانِ", async () => {
    const orderId = await seedOrder({ riderId, status: "searching" });
    expect((await snapshot(ABSENT_TELEGRAM_ID, orderId)).error).toBe("USER_NOT_FOUND");
    expect((await snapshot(UNREGISTERED_TELEGRAM_ID, orderId)).error).toBe("RIDER_NOT_REGISTERED");
  });

  it("٥) معرِّفٌ معدومٌ رفضٌ مُصنَّفٌ لا استثناءٌ", async () => {
    const [row] = await sql<{ result: SnapshotPayload }[]>`
      select active_ride_snapshot(${RIDER_TELEGRAM_ID}::bigint, null::uuid) as result
    `;
    expect(row?.result.error).toBe("INVALID_ORDER_ID");
  });
});

describeIf("طرفا الرحلةِ وأختامُ الأطوارِ", () => {
  it("٦) الإحداثيّةُ تُقرأُ بترتيبِها: العرضُ عرضٌ والطولُ طولٌ", async () => {
    const orderId = await seedOrder({ riderId, status: "searching" });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.pickup?.lat).toBeCloseTo(PICKUP.lat, 6);
    expect(payload.pickup?.lng).toBeCloseTo(PICKUP.lng, 6);
    expect(payload.pickup?.label).toBe("البلد");
    expect(payload.dropoff?.lat).toBeCloseTo(DROPOFF.lat, 6);
    expect(payload.dropoff?.lng).toBeCloseTo(DROPOFF.lng, 6);
  });

  it("٧) وجهةٌ غائبةٌ تُنشَرُ عَدَماً لا نقطةَ أصفارٍ", async () => {
    const orderId = await seedOrder({ riderId, status: "searching", dropoff: false });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.dropoff).toBeNull();
  });

  it("٨) الأختامُ تُنشَرُ كما كُتِبَت، والغائبُ منها `null`", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "in_progress",
      driver: driverId,
      matchedAt: "2027-03-01T09:00:00Z",
      startedAt: "2027-03-01T09:04:00Z",
    });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(Date.parse(payload.matched_at ?? "")).toBe(Date.parse("2027-03-01T09:00:00Z"));
    expect(Date.parse(payload.started_at ?? "")).toBe(Date.parse("2027-03-01T09:04:00Z"));
    expect(payload.completed_at).toBeNull();
    expect(Number.isFinite(Date.parse(payload.created_at ?? ""))).toBe(true);
  });
});

describeIf("بطاقةُ السائقِ تُقرأُ في حالتَي الإسنادِ وحدَهما", () => {
  it("٩) `matched` بسائقٍ: تُقرأُ بطاقتُه بالاسمِ الأوّلِ وحدَه", async () => {
    await seedDriverLocation(5);
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.first_name).toBe("خالد");
    expect(payload.driver?.vehicle_type).toBe("سيدان");
    expect(payload.driver?.plate_number).toBe("ر س ب 1234");
  });

  it("١٠) `searching` بلا سائقٍ: لا بطاقةَ ولا موقعَ", async () => {
    const orderId = await seedOrder({ riderId, status: "searching" });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver).toBeNull();
  });

  it("١١) رحلةٌ أُلغِيَت بعدَ إسنادٍ: السائقُ مكتوبٌ في الصفِّ **ولا يُقرأُ**", async () => {
    const orderId = await seedOrder({ riderId, status: "cancelled", driver: driverId });
    const [row] = await sql<{ assigned: string | null }[]>`
      select assigned_driver_id as assigned from orders where id = ${orderId}
    `;
    expect(row?.assigned).toBe(driverId);
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.status).toBe("cancelled");
    expect(payload.driver).toBeNull();
  });

  it("١٢) رحلةٌ انتهَت: لا بطاقةَ سائقٍ في لقطةِ الرحلةِ النشطةِ", async () => {
    const orderId = await seedOrder({
      riderId,
      status: "completed",
      driver: driverId,
      completedAt: "2027-03-01T09:20:00Z",
    });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.status).toBe("completed");
    expect(payload.driver).toBeNull();
  });

  it("١٣) تقييمٌ لم يُوجَدْ بعدُ يُنشَرُ عَدَماً وعدُّه صفراً — لا «٥٫٠»", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.rating_average).toBeNull();
    expect(Number(payload.driver?.rating_count)).toBe(0);
  });
});

describeIf("عُمرُ الموقعِ تقيسُه القاعدةُ بساعتِها", () => {
  it("١٤) موقعٌ حديثٌ: نقطةٌ **وعُمرٌ معها** بالثواني", async () => {
    await seedDriverLocation(7);
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.position?.lat).toBeCloseTo(DRIVER_POINT.lat, 6);
    expect(payload.driver?.position?.lng).toBeCloseTo(DRIVER_POINT.lng, 6);
    const age = payload.driver?.position?.age_seconds ?? -1;
    expect(age).toBeGreaterThanOrEqual(7);
    expect(age).toBeLessThan(20);
  });

  it("١٥) موقعٌ قديمٌ: القاعدةُ **تنشرُ عُمرَه صادقاً** والحجبُ حكمُ النطاقِ", async () => {
    await seedDriverLocation(600);
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.position?.age_seconds ?? 0).toBeGreaterThanOrEqual(600);
  });

  it("١٦) نقطةٌ بلا ختمٍ: عُمرُها `null` **ولا يُقرأُ صفراً**", async () => {
    await seedDriverLocation(null);
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.position).not.toBeNull();
    expect(payload.driver?.position?.age_seconds).toBeNull();
  });

  it("١٧) لا نقطةَ أصلاً: `position` عَدَمٌ والبطاقةُ باقيةٌ", async () => {
    await seedDriverLocation(null, false);
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.first_name).toBe("خالد");
    expect(payload.driver?.position).toBeNull();
  });

  it("١٨) ختمٌ في المستقبلِ لا يُنتِجُ عُمراً سالباً", async () => {
    await seedDriverLocation(-120);
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const payload = await snapshot(RIDER_TELEGRAM_ID, orderId);
    expect(payload.driver?.position?.age_seconds).toBe(0);
  });
});

describeIf("اللقطةُ قراءةٌ لا كتابةٌ", () => {
  it("١٩) الدالّةُ مُعلَنةٌ `stable` وبصلاحيّةِ المُنادي", async () => {
    const [row] = await sql<{ volatility: string; security: boolean }[]>`
      select p.provolatile::text as volatility, p.prosecdef as security
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'active_ride_snapshot'
    `;
    expect(row?.volatility).toBe("s");
    expect(row?.security).toBe(false);
  });

  it("٢٠) قراءةٌ متكرِّرةٌ لا تُغيِّرُ صفّاً واحداً", async () => {
    const orderId = await seedOrder({ riderId, status: "matched", driver: driverId });
    const [before] = await sql<{ stamp: string }[]>`
      select coalesce(updated_at, created_at)::text as stamp from orders where id = ${orderId}
    `;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await snapshot(RIDER_TELEGRAM_ID, orderId);
    }
    const [after] = await sql<{ stamp: string; count: string }[]>`
      select coalesce(updated_at, created_at)::text as stamp,
             (select count(*)::text from orders where rider_id = ${riderId}) as count
        from orders where id = ${orderId}
    `;
    expect(after?.stamp).toBe(before?.stamp);
  });
});
