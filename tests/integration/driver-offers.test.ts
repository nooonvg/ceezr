/**
 * الغرض: قياسُ عروضِ السائقِ على قاعدةٍ حقيقيّةٍ (`F3-02` · `SD-03` · `SD-04`) —
 *   وأهمُّ ما يُقاسُ ههنا ما **لا يقدرُ عليه حاجزٌ ساكنٌ**:
 *     ــ أنَّ **المؤقّتَ حقيقةُ خادمٍ**: `seconds_left` يتناقصُ بساعةِ القاعدةِ
 *        بينَ قراءتَينِ، **ولا تُنشَرُ `expires_at` ألبتّةَ** — فلا يُقارِنُ جهازٌ
 *        لحظةً مُطلقةً بساعتِه.
 *     ــ أنَّ **كاتبَ الإيكالِ واحدٌ**: قبولانِ متزامنانِ لطلبٍ واحدٍ يُنجِحانِ
 *        واحداً فقط، والخاسرُ يُرَدُّ برمزٍ مُصنَّفٍ لا بعُطلٍ.
 *     ــ أنَّ **الفراغَ مفسَّرٌ**: قائمةٌ خاليةٌ بسببِ وثيقةٍ منتهيةٍ تُنشَرُ معَ
 *        سببِها (`F12-14`)، لا «لا عروضَ الآنَ» وحدَها.
 *     ــ أنَّ **حمولةَ العرضِ بلا هويّةِ راكبٍ**: والعرضُ يذهبُ إلى كلِّ سائقي
 *        الجولةِ لا إلى من ظفرَ بالطلبِ.
 *     ــ أنَّ **المِلكيّةَ قيدُ استعلامٍ**: عرضُ غيرِكَ يُرَدُّ برمزِ المعدومِ نفسِه.
 * الحالة: اختبار تكامل فعلي — يتطلّبُ `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 * يُستخدم من: CI (خدمة postgis)
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` (الرحلةُ النشطةُ) — يبدأُ من صفٍّ `matched`
 *   زرعَه هذا الملفُّ بقبولٍ حقيقيٍّ لا بتحديثٍ يدويٍّ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ═══ ما لا يُقاسُ ههنا عن قصدٍ (`ح-5`) ═══
 * ــ **لا يُقاسُ انحرافُ ساعةِ جهازٍ حقيقيٍّ**: القاعدةُ تُنشِرُ الباقيَ ولحظتَها،
 *    وأثرُ انحرافِ ساعةِ هاتفٍ على العدِّ **دَينٌ مُعلَنٌ** لا يُدَّعى مقيساً.
 * ــ **لا تُقاسُ ذرّيّةُ `claim_ride` نفسِها**: هيَ مقيسةٌ في
 *    `tests/integration/dispatch-open-round-atomicity.test.ts` و
 *    `claim-ride-duplicate-delivery.test.ts` من قبلِ هذا البندِ. المقيسُ ههنا
 *    أنَّ **غلافَ `F3-02` لا يُفلِتُ ذرّيّتَها** ولا يُضيفُ كاتباً ثانياً.
 * ــ **لا تُقاسُ الشاشةُ ولا البوّابةُ**: الأولى نماذجُها مقيسةٌ نقيّةً في
 *    `tests/unit`، والثانيةُ عقدُها مقيسٌ في `scripts/check-driver-offers-contract.ts`.
 * ــ **لا تُقاسُ الصلاحيّاتُ أثراً**: الاتّصالُ بمالكِ القاعدةِ وهوَ يتخطّى
 *    `revoke`؛ والنزعُ مقيسٌ نصّاً في الحاجزِ الساكنِ.
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
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_000_321;
const RIVAL_TELEGRAM_ID = 900_000_322;
const RIDER_TELEGRAM_ID = 900_000_323;
const ABSENT_TELEGRAM_ID = 900_000_324;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

/** مدينةُ الزرعِ: إحداثيّاتُ `PICKUP`/`DROPOFF` أعلاه داخلَ منطقةِ خدمةِ جدّة. */

let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let driverUserId = "";
let driverId = "";
let rivalUserId = "";
let rivalDriverId = "";
let riderUserId = "";
let riderId = "";

interface Payload {
  readonly ok?: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

async function callJson(query: Promise<{ result: Payload }[]>): Promise<Payload> {
  const [row] = await query;
  if (row === undefined) throw new Error("لا ردَّ من الدالّةِ");
  return row.result;
}

function board(telegramId: number): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_offer_board(${telegramId}::bigint) as result
  `);
}

function detail(telegramId: number, offerId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_offer_detail(${telegramId}::bigint, ${offerId}::uuid) as result
  `);
}

function accept(telegramId: number, offerId: string): Promise<Payload> {
  return callJson(sql<{ result: Payload }[]>`
    select driver_accept_offer(${telegramId}::bigint, ${offerId}::uuid) as result
  `);
}

/** طلبٌ في حالةِ بحثٍ — بوجهةٍ أو بلا وجهةٍ (`ADR 0023`: الغيابُ عَدَمٌ لا صفرٌ). */
async function seedOrder(options?: { readonly withDropoff?: boolean }): Promise<string> {
  const withDropoff = options?.withDropoff ?? true;
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label, notes
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      ${
        withDropoff
          ? sql`st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography`
          : sql`null`
      },
      'دوّارُ الانطلاقِ', ${withDropoff ? "بوّابةُ الوجهةِ" : null}, 'أمامَ البابِ الشماليِّ'
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** عرضٌ لسائقٍ بمهلةٍ منسوبةٍ إلى **ساعةِ القاعدةِ** لا إلى ساعةِ المُشغِّلِ. */
async function seedOffer(
  orderId: string,
  driver: string,
  options?: {
    readonly ttlSeconds?: number;
    readonly round?: number;
    readonly distanceKm?: number | null;
    readonly status?: string;
  },
): Promise<string> {
  const ttl = options?.ttlSeconds ?? 45;
  const [row] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, distance_km, status, expires_at)
    values (
      ${cityId}, ${orderId}, ${driver}, ${options?.round ?? 1},
      ${options !== undefined && "distanceKm" in options ? options.distanceKm : 2.5},
      ${options?.status ?? "pending"}::offer_status,
      now() + make_interval(secs => ${ttl})
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ العرضِ");
  return row.id;
}

/** يُفرِغُ ما زرعَه اختبارٌ سابقٌ كي يبدأَ كلُّ قياسٍ من لوحٍ معروفٍ. */
async function clearOffersAndOrders(): Promise<void> {
  await sql`
    delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId})
  `;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

interface OfferCard {
  readonly offer_id: string;
  readonly order_id: string;
  readonly seconds_left: number;
  readonly rider_distance: { readonly kind: string; readonly meters: number } | null;
  readonly trip_distance: { readonly kind: string; readonly meters: number } | null;
  readonly [key: string]: unknown;
}

function cards(payload: Payload): readonly OfferCard[] {
  return (payload.offers ?? []) as readonly OfferCard[];
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  // **الشرطُ المسبقُ يُصنَعُ ههنا لا يُستعارُ** (`OPS-019`): بذرةُ الهجراتِ تُنشئُ
  // مدنَ الإطلاقِ **معطَّلةً** بقرارِ `F2-05`، فاستعلامٌ يطلبُ «أوّلَ مدينةٍ
  // مفعَّلةٍ» لا يجدُ شيئاً على قاعدةٍ نظيفةٍ ولا ينجحُ إلّا إن سبقَه ملفٌّ آخرُ
  // فعَّلَ مدينةً ولم يُرجِعْها — فيصيرُ الأخضرُ رهنَ ترتيبِ التشغيلِ.
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const seedDriver = async (
    telegramId: number,
    name: string,
    phone: string,
  ): Promise<{ userId: string; driverId: string }> => {
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone)
      values (${cityId}, ${telegramId}, 'driver', ${name}, ${phone})
      returning id
    `;
    if (user === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (
        ${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان',
        ${`ع ر ض ${telegramId % 10_000}`}
      )
      returning id
    `;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
    return { userId: user.id, driverId: driver.id };
  };

  const main = await seedDriver(DRIVER_TELEGRAM_ID, "سائقُ العروضِ", "+966500000321");
  driverUserId = main.userId;
  driverId = main.driverId;
  const rival = await seedDriver(RIVAL_TELEGRAM_ID, "سائقٌ منافسٌ", "+966500000322");
  rivalUserId = rival.userId;
  rivalDriverId = rival.driverId;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبةُ العروضِ', '+966500000323', 'ar')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderUserId = riderUser.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكبةِ");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  // **الترتيبُ مقصودٌ**: `notification_outbox` يشيرُ إلى `order_offers`، فحذفُ
  // العرضِ قبلَ إشعارِه يُوقِعُ خطأَ مرجعٍ ويُترِكُ صفوفاً مزروعةً في القاعدةِ.
  for (const id of [driverId, rivalDriverId]) {
    if (id === "") continue;
    await sql`delete from notification_outbox where driver_id = ${id}`;
    await sql`delete from order_offers where driver_id = ${id}`;
    await sql`delete from driver_availability where driver_id = ${id}`;
    await sql`delete from driver_documents where driver_id = ${id}`;
  }
  if (riderId !== "") {
    await clearOffersAndOrders();
    await sql`delete from riders where id = ${riderId}`;
  }
  for (const id of [driverId, rivalDriverId]) {
    if (id !== "") await sql`delete from drivers where id = ${id}`;
  }
  for (const id of [driverUserId, rivalUserId, riderUserId]) {
    if (id === "") continue;
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  // ترجعُ المدينةُ إلى حالتِها قبلَ هذا الملفِّ: تركُها مفعَّلةً يُورِّثُ لِمَن
  // بعدَها شرطاً لم يطلُبْه، وهوَ الداءُ نفسُه معكوساً.
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("لوحُ العروضِ — هويّةٌ أوّلاً ثمَّ لوحٌ مفسَّرٌ", () => {
  it("١) معرِّفٌ معدومٌ يُرَدُّ `USER_NOT_FOUND` ولا يُكشَفُ به شيءٌ", async () => {
    expect(await board(ABSENT_TELEGRAM_ID)).toEqual({ ok: false, error: "USER_NOT_FOUND" });
  });

  it("٢) راكبةٌ تطلبُ لوحَ سائقٍ تُرَدُّ `NOT_A_DRIVER`", async () => {
    expect(await board(RIDER_TELEGRAM_ID)).toEqual({ ok: false, error: "NOT_A_DRIVER" });
  });

  it("٣) لوحٌ بلا عروضٍ يُنشِرُ لحظةَ الخادمِ وحالةَ التوفُّرِ وقائمةً خاليةً", async () => {
    await clearOffersAndOrders();
    const payload = await board(DRIVER_TELEGRAM_ID);
    expect(payload.ok).toBe(true);
    expect(typeof payload.server_time).toBe("string");
    expect(payload.is_available).toBe(false);
    expect(payload.is_blocked).toBe(false);
    expect(cards(payload)).toEqual([]);
  });

  it("٤) التوفُّرُ المكتوبُ في `driver_availability` يُقرأُ في اللوحِ — كاتبُه بندٌ سابقٌ", async () => {
    await sql`
      insert into driver_availability (city_id, driver_id, is_available, changed_at)
      values (${cityId}, ${driverId}, true, now())
      on conflict (driver_id) do update set is_available = true, changed_at = now()
    `;
    const payload = await board(DRIVER_TELEGRAM_ID);
    expect(payload.is_available).toBe(true);
    expect(typeof payload.availability_changed_at).toBe("string");
  });
});

describeIf("المؤقّتُ حقيقةُ خادمٍ لا ساعةُ جهازٍ", () => {
  it("٥) الباقي يُنشَرُ ولحظةُ الانتهاءِ **لا تُنشَرُ** — فلا مقارنةَ بساعةِ جهازٍ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, driverId, { ttlSeconds: 45 });

    const payload = await board(DRIVER_TELEGRAM_ID);
    const [card] = cards(payload);
    expect(card?.offer_id).toBe(offerId);
    expect(card?.seconds_left).toBeGreaterThan(40);
    expect(card?.seconds_left).toBeLessThanOrEqual(45);

    const text = JSON.stringify(payload);
    expect(text).not.toContain("expires_at");
    expect(text).not.toContain("expiresAt");
  });

  it("٦) الباقي يتناقصُ بساعةِ القاعدةِ بينَ قراءتَينِ — والعدُّ نقلٌ لا ظنٌّ", async () => {
    const first = cards(await board(DRIVER_TELEGRAM_ID))[0];
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const second = cards(await board(DRIVER_TELEGRAM_ID))[0];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second?.seconds_left).toBeLessThan(first?.seconds_left ?? 0);
  });

  it("٧) عرضٌ انتهَت مهلتُه لا يُعرَضُ — وصفرٌ لا يُنشَرُ سالباً", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    await seedOffer(orderId, driverId, { ttlSeconds: -30 });
    expect(cards(await board(DRIVER_TELEGRAM_ID))).toEqual([]);
  });

  it("٨) طلبٌ خرجَ من البحثِ لا يُعرَضُ ولو بقيَ صفُّ عرضِه معلَّقاً", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    await seedOffer(orderId, driverId);
    await sql`update orders set status = 'cancelled'::order_status where id = ${orderId}`;
    expect(cards(await board(DRIVER_TELEGRAM_ID))).toEqual([]);
  });

  it("٩) عرضُ سائقٍ آخرَ لا يظهرُ في لوحي", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    await seedOffer(orderId, rivalDriverId);
    expect(cards(await board(DRIVER_TELEGRAM_ID))).toEqual([]);
    expect(cards(await board(RIVAL_TELEGRAM_ID)).length).toBe(1);
  });

  it("١٠) العروضُ مرتَّبةٌ بأقربِ انتهاءٍ — والأعجلُ أوّلاً لا الأحدثُ", async () => {
    await clearOffersAndOrders();
    const far = await seedOrder();
    const near = await seedOrder();
    await seedOffer(far, driverId, { ttlSeconds: 90 });
    const nearOffer = await seedOffer(near, driverId, { ttlSeconds: 20 });
    const list = cards(await board(DRIVER_TELEGRAM_ID));
    expect(list.length).toBe(2);
    expect(list[0]?.offer_id).toBe(nearOffer);
  });
});

describeIf("المسافةُ موسومةٌ والوجهةُ الغائبةُ عَدَمٌ لا صفرٌ", () => {
  it("١١) مسافةُ الراكبِ تُنشَرُ موسومةً `STRAIGHT_LINE` بأمتارٍ من `distance_km` المخزونِ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    await seedOffer(orderId, driverId, { distanceKm: 2.5 });
    const [card] = cards(await board(DRIVER_TELEGRAM_ID));
    expect(card?.rider_distance).toEqual({ kind: "STRAIGHT_LINE", meters: 2500 });
    expect(card?.trip_distance?.kind).toBe("STRAIGHT_LINE");
    expect(card?.trip_distance?.meters).toBeGreaterThan(0);
  });

  it("١٢) عرضٌ بلا `distance_km` يُنشَرُ `null` لا صفراً — والغيابُ يُقالُ غياباً", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    await seedOffer(orderId, driverId, { distanceKm: null });
    const [card] = cards(await board(DRIVER_TELEGRAM_ID));
    expect(card?.rider_distance).toBeNull();
  });

  it("١٣) طلبٌ بلا وجهةٍ: وترُ الرحلةِ `null` والوجهةُ `null` في التفصيلِ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder({ withDropoff: false });
    const offerId = await seedOffer(orderId, driverId);
    const [card] = cards(await board(DRIVER_TELEGRAM_ID));
    expect(card?.trip_distance).toBeNull();
    const one = await detail(DRIVER_TELEGRAM_ID, offerId);
    expect(one.dropoff).toBeNull();
    expect(one.trip_distance).toBeNull();
  });
});

describeIf("تفصيلُ عرضٍ — مِلكيّةٌ بقيدِ استعلامٍ وصلاحيّةُ قبولٍ من الخادمِ", () => {
  it("١٤) تفصيلٌ كاملٌ: انطلاقٌ بإحداثيّاتٍ وملاحظةٌ وصلاحيّةُ قبولٍ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, driverId);
    const payload = await detail(DRIVER_TELEGRAM_ID, offerId);
    expect(payload.ok).toBe(true);
    expect(payload.offer_id).toBe(offerId);
    expect(payload.order_id).toBe(orderId);
    expect(payload.offer_status).toBe("pending");
    expect(payload.order_status).toBe("searching");
    expect(payload.is_claimable).toBe(true);
    expect(payload.notes).toBe("أمامَ البابِ الشماليِّ");
    const pickup = payload.pickup as { latitude: number; longitude: number };
    expect(pickup.latitude).toBeCloseTo(PICKUP.lat, 5);
    expect(pickup.longitude).toBeCloseTo(PICKUP.lng, 5);
    expect(JSON.stringify(payload)).not.toContain("expires_at");
  });

  it("١٥) عرضُ غيري يُرَدُّ `OFFER_NOT_FOUND` — كرمزِ المعدومِ نفسِه، فلا يُكشَفُ وجودُ صفٍّ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const rivalOffer = await seedOffer(orderId, rivalDriverId);
    expect(await detail(DRIVER_TELEGRAM_ID, rivalOffer)).toEqual({
      ok: false,
      error: "OFFER_NOT_FOUND",
    });
    const [absent] = await sql<{ id: string }[]>`select gen_random_uuid() as id`;
    expect(await detail(DRIVER_TELEGRAM_ID, String(absent?.id))).toEqual({
      ok: false,
      error: "OFFER_NOT_FOUND",
    });
  });

  it("١٦) عرضٌ انتهَت مهلتُه: `is_claimable = false` — فتُخفي الشاشةُ زرّاً لا يعملُ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, driverId, { ttlSeconds: -5 });
    const payload = await detail(DRIVER_TELEGRAM_ID, offerId);
    expect(payload.ok).toBe(true);
    expect(payload.seconds_left).toBe(0);
    expect(payload.is_claimable).toBe(false);
  });
});

describeIf("القبولُ — كاتبٌ واحدٌ، وجوابٌ منقّىً من هويّةِ الراكبِ", () => {
  it("١٧) قبولٌ صحيحٌ: الطلبُ يُوكَلُ ويُوسَمُ بلحظةِ مطابقةٍ من القاعدةِ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, driverId);
    const payload = await accept(DRIVER_TELEGRAM_ID, offerId);
    expect(payload.ok).toBe(true);
    expect(payload.order_id).toBe(orderId);
    expect(typeof payload.matched_at).toBe("string");

    const [row] = await sql<{ status: string; assigned: string | null }[]>`
      select status::text as status, assigned_driver_id::text as assigned
        from orders where id = ${orderId}
    `;
    expect(row?.status).toBe("matched");
    expect(row?.assigned).toBe(driverId);
    const [offer] = await sql<{ status: string }[]>`
      select status::text as status from order_offers where id = ${offerId}
    `;
    expect(offer?.status).toBe("accepted");
  });

  it("١٨) جوابُ القبولِ لا يحملُ هويّةَ الراكبِ — و`claim_ride` تحملُها فتُسقَطُ ههنا", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, driverId);
    const payload = await accept(DRIVER_TELEGRAM_ID, offerId);
    // `WR-09` (ADR 0266): مفتاحا المرشّح زائدان لا ناقصان، والمهلة صفرٌ ⇒ لا حجزَ.
    expect(Object.keys(payload).sort()).toEqual([
      "expires_at",
      "matched_at",
      "ok",
      "order_id",
      "pending_rider",
    ]);
    expect(payload.pending_rider).toBe(false);
    expect(payload.expires_at).toBeNull();
    // اسمُ الرايةِ `pending_rider` ليسَ هويّةً؛ يُفحَصُ ما سواه.
    const text = JSON.stringify(payload).replace('"pending_rider"', '"pending_choice"');
    for (const token of ["telegram_id", "language_code", "full_name", "phone", "rider"]) {
      expect(text).not.toContain(token);
    }
  });

  it("١٩) عرضٌ لغيري يُرَدُّ `OFFER_NOT_FOUND` قبلَ أن يُنادى القفلُ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const rivalOffer = await seedOffer(orderId, rivalDriverId);
    expect(await accept(DRIVER_TELEGRAM_ID, rivalOffer)).toEqual({
      ok: false,
      error: "OFFER_NOT_FOUND",
    });
    const [row] = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${orderId}
    `;
    expect(row?.status).toBe("searching");
  });

  it("٢٠) عرضٌ انتهَت مهلتُه يُرَدُّ `OFFER_NOT_VALID` — رمزُ `claim_ride` كما هوَ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const offerId = await seedOffer(orderId, driverId, { ttlSeconds: -10 });
    expect(await accept(DRIVER_TELEGRAM_ID, offerId)).toEqual({
      ok: false,
      error: "OFFER_NOT_VALID",
    });
  });

  it("٢١) طلبٌ أُوكِلَ لغيري يُرَدُّ `ORDER_NOT_CLAIMABLE` — والخسارةُ رمزٌ مُصنَّفٌ لا عُطلٌ", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const mine = await seedOffer(orderId, driverId);
    const theirs = await seedOffer(orderId, rivalDriverId);
    expect((await accept(RIVAL_TELEGRAM_ID, theirs)).ok).toBe(true);
    expect(await accept(DRIVER_TELEGRAM_ID, mine)).toEqual({
      ok: false,
      error: "ORDER_NOT_CLAIMABLE",
    });
    const [offer] = await sql<{ status: string }[]>`
      select status::text as status from order_offers where id = ${mine}
    `;
    // `claim_ride` تُلغي عروضَ المنافسينَ في المعاملةِ نفسِها — فلا عرضٌ معلَّقٌ
    // يبقى يعرضُ زرَّ قبولٍ على طلبٍ أُوكِلَ.
    expect(offer?.status).toBe("cancelled");
  });

  it("٢٢) **قبولانِ متزامنانِ يُنجِحانِ واحداً فقط** — والغلافُ لا يُفلِتُ ذرّيّةَ `claim_ride`", async () => {
    await clearOffersAndOrders();
    const orderId = await seedOrder();
    const mine = await seedOffer(orderId, driverId);
    const theirs = await seedOffer(orderId, rivalDriverId);

    // اتّصالانِ مستقلّانِ: نداءانِ على تجمُّعٍ واحدٍ قد يُتسلسَلانِ فيمرُّ
    // الاختبارُ بلا سبقٍ حقيقيٍّ — والقياسُ بلا تزامنٍ لا يقيسُ ذرّيّةً.
    const first = createSql({ connectionString: DATABASE_URL as string });
    const second = createSql({ connectionString: DATABASE_URL as string });
    try {
      const [a, b] = await Promise.all([
        callJson(first<{ result: Payload }[]>`
          select driver_accept_offer(${DRIVER_TELEGRAM_ID}::bigint, ${mine}::uuid) as result
        `),
        callJson(second<{ result: Payload }[]>`
          select driver_accept_offer(${RIVAL_TELEGRAM_ID}::bigint, ${theirs}::uuid) as result
        `),
      ]);
      const winners = [a, b].filter((payload) => payload.ok === true);
      const losers = [a, b].filter((payload) => payload.ok !== true);
      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);
      expect(["ORDER_NOT_CLAIMABLE", "OFFER_NOT_VALID"]).toContain(String(losers[0]?.error));
    } finally {
      await first.end();
      await second.end();
    }

    const [accepted] = await sql<{ count: string }[]>`
      select count(*)::text as count from order_offers
       where order_id = ${orderId} and status = 'accepted'
    `;
    expect(accepted?.count).toBe("1");
  });
});

describeIf("الفراغُ مفسَّرٌ — وثيقةٌ منتهيةٌ تحجبُ البثَّ فيُنشَرُ سببُه", () => {
  it("٢٣) وثيقةٌ مقبولةٌ انتهى تاريخُها تُنشِرُ `EXPIRED:` في `block_reasons`", async () => {
    await clearOffersAndOrders();
    await sql`
      insert into driver_documents (city_id, driver_id, doc_type, status, object_path, expires_at)
      values (
        ${cityId}, ${driverId}, 'insurance'::driver_document_type,
        'accepted'::driver_document_status,
        ${`drivers/${driverId}/insurance/seed`}, current_date - 1
      )
      on conflict (driver_id, doc_type) do update
        set status = 'accepted'::driver_document_status, expires_at = current_date - 1
    `;
    const payload = await board(DRIVER_TELEGRAM_ID);
    expect(payload.is_blocked).toBe(true);
    const reasons = (payload.block_reasons ?? []) as readonly string[];
    expect(reasons.some((reason) => reason.startsWith("EXPIRED:"))).toBe(true);
    // والحجبُ **لا يُصادِرُ اللوحَ**: القائمةُ تبقى مقروءةً ومعَها سببُها، فتقولُ
    // الشاشةُ «لا عروضَ لأنَّ وثيقةً منتهيةٌ» لا «لا عروضَ الآنَ».
    expect(payload.ok).toBe(true);
    expect(Array.isArray(payload.offers)).toBe(true);
  });

  it("٢٤) تصحيحُ الوثيقةِ يرفعُ الحجبَ في القراءةِ التاليةِ — بلا وظيفةٍ تُشغَّلُ", async () => {
    await sql`
      update driver_documents set expires_at = current_date + 400
       where driver_id = ${driverId} and doc_type = 'insurance'::driver_document_type
    `;
    const payload = await board(DRIVER_TELEGRAM_ID);
    expect(payload.is_blocked).toBe(false);
    expect(payload.block_reasons).toEqual([]);
  });
});
