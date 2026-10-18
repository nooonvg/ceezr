/**
 * الغرض: إثباتُ قراءةِ لوحِ العروضِ **بجولةِ قاعدةٍ واحدةٍ** — `LOAD-01` (P4):
 * القراءةُ كانت ثلاثَ جولاتٍ (اللوحُ ثمَّ ملاحقُ الأماكنِ ثمَّ الأهليةُ) فصارت
 * عبارةً واحدةً، بلا تغييرٍ في عقدِ الاستجابةِ ولا في دلالاتِه.
 * الحالة: مُختبَرٌ على قاعدةٍ PostgreSQL حقيقيةٍ.
 * ينتمي إلى: tests/integration
 * يُستخدم من: `bun run test:integration` وخطوةُ «تكامل على PostgreSQL حقيقي» في CI.
 *
 * ## ما يُثبِتُه هذا الملفُّ
 *
 * 1. **عددُ العباراتِ**: قراءةُ اللوحِ (سائقٌ معروضٌ عليهِ عرضٌ فعليٌّ بملاحقيهِ
 *    وأهليتِه) تُنفَّذُ بعبارةِ SQL **واحدةٍ** لا ثلاثٍ — مُقاسًا بعدّادٍ فوقَ
 *    المحرّكِ نفسِهِ لا بافتراضٍ.
 * 2. **التكافؤُ الدلاليُّ**: نتيجةُ العبارةِ الواحدةِ **تساوي حرفياً** ما كانَ
 *    يُؤلَّفُ من المسارِ القديمِ (دالّةُ اللوحِ + قراءةُ الملاحقِ + قراءةُ
 *    الأهليةِ) على البياناتِ المزروعةِ نفسِها — فلا يتغيّرُ ما يراهُ السائقُ.
 * 3. **اللوحُ الفارغُ** يبقى قراءةً واحدةً وملاحقَ معدومةً (لا استعلامَ للملاحقِ
 *    حين لا عروضَ — كما كانَ).
 *
 * ## وما لا يقيسُه عن قصدٍ
 *
 * - لا يقيسُ مسارَ HTTP (الجلسةُ والترويسةُ): في `tests/unit`.
 * - لا يقيسُ أداءَ زمنِ الاستجابةِ: القياسُ المُكمَّمُ في جولاتِ السعةِ (`wave`)
 *    على البيئةِ المعزولةِ — هذا الملفُّ يثبِتُ **العقدَ** وعددَ العباراتِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  DriverEligibilityReason,
  DriverOfferBoard,
} from "../../packages/domain/driver/driver-offers.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  composeDriverOfferBoard,
  PostgresDriverOfferStore,
  readDriverEligibility,
} from "../../packages/infrastructure/driver/driver-offers-store.ts";
import {
  type OrderPlaceExtras,
  readOrderPlaceExtras,
} from "../../packages/infrastructure/transport/order-place-extras.ts";
import { ensureActiveCity, restoreCityBaseline } from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

let sql: Sql;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** معرّفاتٌ يزرعُها هذا الملفُّ وحدَه. */
const DRIVER_TELEGRAM_ID = 900_001_331;
const RIDER_TELEGRAM_ID = 900_001_332;
const ABSENT_TELEGRAM_ID = 900_001_333;

const PICKUP = { lat: 21.4858, lng: 39.1925 };
const DROPOFF = { lat: 21.5433, lng: 39.1728 };

let cityHandle: ReturnType<typeof ensureActiveCity> extends Promise<infer T> ? T : never;
let cityId: string;
let driverId: string;
let driverUserId = "";
let riderId: string;

/**
 * عدّادُ العباراتِ فوقَ المحرّكِ: كلُّ استدعاءٍ لوسمِ القالبِ يُحسَبُ عبارةً واحدةٍ
 * (العدُّ من العميلِ لا من pgss — كي يعملَ الاختبارُ دون امتيازاتِ قياسٍ).
 */
function countedEngine(): { engine: Sql; count: () => number } {
  let n = 0;
  // الوكيلُ فوقَ دالةِ العدّ مباشرةً: نداءُ القالبِ يُعَدّ ثمّ يمرّ، وكلُّ خاصيةٍ
  // أخرى (`array` وغيرُها) تُمرَّرُ إلى المحرّكِ الحقيقيِّ — بلا تمريرٍ كانَ استعلامُ
  // الملاحقِ يُبتلَعُ (`sql.array` غيرُ معرّفٍ فيرفعُ داخلَ try فيُقنَّعُ) فيَنقصُ العدُّ.
  const counting = ((strings: TemplateStringsArray, ...values: readonly unknown[]): unknown => {
    n += 1;
    return (
      sql as unknown as (strings: TemplateStringsArray, ...values: readonly unknown[]) => unknown
    )(strings, ...values);
  }) as unknown as Sql;
  const engine = new Proxy(counting, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const value = Reflect.get(sql as object, prop, sql);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(sql)
        : value;
    },
  }) as unknown as Sql;
  return { engine, count: () => n };
} /** ترتيبٌ مستقرٌّ للمقارنةِ الحرفيةِ — المصفوفاتُ والخرائطُ لا تُقارَنُ مرتَّبةً. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}

/** بطاقةُ اللوحِ مع الملاحقِ مدموجةً كما كانَ المسارُ القديمُ يبنيها. */
function composeLegacyBoard(
  payload: Record<string, unknown>,
  extras: ReadonlyMap<string, OrderPlaceExtras>,
  eligibilityReasons: readonly DriverEligibilityReason[],
): DriverOfferBoard {
  const composed = composeDriverOfferBoard(payload, { extrasMap: extras, eligibilityReasons });
  if (!composed.ok) throw new Error("تعذّر تركيبُ اللوحِ من المسارِ القديمِ");
  return composed.value;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });

  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;

  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_TELEGRAM_ID}, 'driver', 'سائقُ الجولةِ الواحدةِ', '+966500001331')
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذّر زرعُ مستخدمِ السائقِ");
  driverUserId = driverUser.id;
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
    values (${cityId}, ${driverUser.id}, 'verified'::verification_status, 'سيدان', 'ع ر ض 1331')
    returning id
  `;
  if (driver === undefined) throw new Error("تعذّر زرعُ السائقِ");
  driverId = driver.id;

  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TELEGRAM_ID}, 'rider', 'راكبُ الجولةِ الواحدةِ', '+966500001332')
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكبِ");
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id
  `;
  if (rider === undefined) throw new Error("تعذّر زرعُ راكبِ الجولةِ");
  riderId = rider.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;
  await sql`delete from orders where rider_id = ${riderId}`;
  await sql`delete from riders where id = ${riderId}`;
  await sql`delete from audit_log where actor_user_id in (${driverUserId}, (select id from users where telegram_id = ${RIDER_TELEGRAM_ID}))`;
  await sql`delete from users where telegram_id = ${RIDER_TELEGRAM_ID}`;
  await sql`delete from driver_availability where driver_id = ${driverId}`;
  await sql`delete from order_offers where driver_id = ${driverId}`;
  await sql`delete from drivers where id = ${driverId}`;
  await sql`delete from audit_log where actor_user_id = ${driverUserId}`;
  await sql`delete from users where id = ${driverUserId}`;
  await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

/** طلبٌ في حالةِ بحثٍ بوجهةٍ كاملةٍ — كي تُقرأَ الملاحقُ من الجولةِ الواحدةِ. */
async function seedSearchingOrder(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into orders (
      city_id, rider_id, service, status, pickup, dropoff, pickup_label, dropoff_label, notes
    ) values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF.lng}, ${DROPOFF.lat}), 4326)::geography,
      'دوّارُ الانطلاقِ', 'بوّابةُ الوجهةِ', 'أمامَ البابِ الشماليِّ'
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ الطلبِ");
  return row.id;
}

/** عرضٌ مفتوحٌ بمهلةٍ منسوبةٍ إلى ساعةِ القاعدةِ. */
async function seedOpenOffer(orderId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into order_offers (city_id, order_id, driver_id, round, distance_km, status, expires_at)
    values (
      ${cityId}, ${orderId}, ${driverId}, 1, 2.5, 'pending'::offer_status,
      now() + make_interval(secs => 45)
    ) returning id
  `;
  if (row === undefined) throw new Error("تعذّر زرعُ العرضِ");
  return row.id;
}

describeIf("لوحُ العروضِ بجولةِ قاعدةٍ واحدةٍ — LOAD-01 (P4)", () => {
  it("١) قراءةٌ واحدةٌ لا ثلاثٌ: عدّادُ العباراتِ فوقَ المحرّكِ يقولُ ١", async () => {
    await sql`
      insert into driver_availability (city_id, driver_id, is_available, changed_at)
      values (${cityId}, ${driverId}, true, now())
      on conflict (driver_id) do update set is_available = true, changed_at = now()
    `;
    await sql`
      update drivers set last_location = st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography,
        last_location_quality = 'ACCEPT'
      where id = ${driverId}
    `;
    const orderId = await seedSearchingOrder();
    await seedOpenOffer(orderId);

    const { engine, count } = countedEngine();
    const store = new PostgresDriverOfferStore(engine);
    const board = await store.readBoard({ telegramUserId: String(DRIVER_TELEGRAM_ID) });

    expect(board.ok).toBe(true);
    if (!board.ok) throw new Error("تعذّرت قراءةُ اللوحِ");
    expect(board.value.offers.length).toBeGreaterThan(0);
    // العقدُ الجوهريُّ: الملاحقُ جاءت مع الجولةِ نفسِها (لا استعلاماتٍ تاليةً).
    expect(board.value.offers.every((card) => card.pickupExtras !== undefined)).toBe(true);
    expect(count()).toBe(1);
  });

  it("٢) تكافؤٌ دلاليٌّ حرفيٌّ مع المسارِ القديمِ (لوحٌ + ملاحقٌ + أهليةٌ)", async () => {
    const orderId = await seedSearchingOrder();
    await seedOpenOffer(orderId);

    const { engine } = countedEngine();
    const store = new PostgresDriverOfferStore(engine);
    const merged = await store.readBoard({ telegramUserId: String(DRIVER_TELEGRAM_ID) });
    expect(merged.ok).toBe(true);
    if (!merged.ok) throw new Error("تعذّرت قراءةُ اللوحِ الموحّدةِ");

    // المسارُ القديمُ بجولاتِهِ الثلاثِ — على البياناتِ نفسِها، **معدودةً بالعدّادِ
    // نفسِهِ** (3 عباراتٍ: اللوحُ ثمّ الملاحقُ ثمّ الأهليةُ) في مقابلِ الواحدةِ أعلاه.
    const legacyEngine = countedEngine();
    const [fn] = await legacyEngine.engine<{ result: unknown }[]>`
      select driver_offer_board(${DRIVER_TELEGRAM_ID}::bigint) as result`;
    const legacyPayload = fn?.result as {
      ok: true;
      offers: readonly { order_id: string }[];
    } & Record<string, unknown>;
    expect(legacyPayload.ok).toBe(true);
    // الملاحقُ تُستعلمُ فقطَ لقائمةِ عروضٍ غيرِ فارغةٍ — نُثبتُها هنا كي يكونَ عددُ
    // العباراتِ (3) مقيسًا على المسارِ الكاملِ لا على حالتِهِ الفارغةِ.
    expect(legacyPayload.offers.length).toBeGreaterThan(0);
    const legacyExtras = await readOrderPlaceExtras(
      legacyEngine.engine,
      legacyPayload.offers.map((card) => card.order_id),
    );
    const legacyEligibility = await readDriverEligibility(
      legacyEngine.engine,
      String(DRIVER_TELEGRAM_ID),
    );
    // العددُ المقيسُ للمسارِ القديمِ: ثلاثُ عباراتٍ — في مقابلِ الواحدةِ للمسارِ الموحّدِ.
    expect(legacyEngine.count()).toBe(3);

    // `server_time` هوَ لحظةُ القراءةِ بذاتِها (تتقدّمُ بينَ القراءتينِ) فلا يصحُّ
    // في تكافؤٍ حرفيٍّ — يُقارنُ وحدهُ بقربٍ لا بالمساواةِ، ويُقارنُ الباقي حرفياً.
    const stripServerTime = (board: DriverOfferBoard): DriverOfferBoard =>
      ({ ...board, serverTime: undefined }) as unknown as DriverOfferBoard;
    expect(canonical(stripServerTime(merged.value))).toEqual(
      canonical(
        stripServerTime(composeLegacyBoard(legacyPayload, legacyExtras, legacyEligibility)),
      ),
    );
    const mergedMs = Date.parse(merged.value.serverTime);
    const legacyMs = Date.parse(
      composeLegacyBoard(legacyPayload, legacyExtras, legacyEligibility).serverTime,
    );
    expect(Math.abs(mergedMs - legacyMs)).toBeLessThan(60_000);
  });

  it("٣) اللوحُ الفارغُ: قراءةٌ واحدةٌ وملاحقُ معدومةٌ كما كانَ", async () => {
    await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId})`;

    const { engine, count } = countedEngine();
    const store = new PostgresDriverOfferStore(engine);
    const board = await store.readBoard({ telegramUserId: String(DRIVER_TELEGRAM_ID) });

    expect(board.ok).toBe(true);
    if (!board.ok) throw new Error("تعذّرت قراءةُ اللوحِ");
    expect(board.value.offers).toEqual([]);
    expect(count()).toBe(1);
  });

  it("٤) سائقٌ معدومٌ: رفضُ `USER_NOT_FOUND` يصعدُ من العبارةِ الواحدةِ كما كانَ", async () => {
    const { engine, count } = countedEngine();
    const store = new PostgresDriverOfferStore(engine);
    const board = await store.readBoard({ telegramUserId: String(ABSENT_TELEGRAM_ID) });
    expect(board.ok).toBe(false);
    if (board.ok) throw new Error("كانَ لا بدَّ من رفضٍ");
    expect(board.error).toMatchObject({ rejection: "USER_NOT_FOUND" });
    expect(count()).toBe(1);
  });
});
