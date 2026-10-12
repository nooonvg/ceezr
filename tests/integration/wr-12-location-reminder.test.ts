/**
 * الغرض: `WR-12` (ADR 0268) — تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه على قاعدةٍ حقيقيّة:
 *   من يُذكَّرُ ومن لا يُذكَّر، والتكرارُ والسقف، والمُطالِبُ يقرأُ حالَ السائقِ لحظةَ الإرسال.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const BASE_TG = 900_000_520;
const RIDER_TG = 900_000_529;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
const userIds: string[] = [];
const drivers: Record<string, string> = {};

interface Payload {
  readonly [key: string]: unknown;
}

async function enqueue(): Promise<number> {
  const [row] = await sql<{ result: { enqueued: number } }[]>`
    select enqueue_driver_location_reminders(500) as result`;
  return Number(row?.result.enqueued ?? 0);
}

async function reminders(driverId: string) {
  return sql<{ id: string; status: string; dedup_key: string; created_at: Date }[]>`
    select id, status, dedup_key, created_at from notification_outbox
     where kind = 'driver_location_reminder' and driver_id = ${driverId}::uuid
     order by created_at`;
}

async function setSetting(key: string, value: number): Promise<void> {
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
    values (${cityId}, ${key}, to_jsonb(${value}::integer), 'number', 'اختبار WR-12', false)
    on conflict (city_id, key) do update set value = excluded.value`;
}

/** يضبطُ حالَ السائق: متوفّرٌ أم لا، ومنذُ كم دقيقةً فعّلَ التوافر، ومنذُ كم وصلَ موقعُه. */
async function shape(
  driverId: string,
  opts: { available: boolean; changedMin: number; locatedMin: number | null },
): Promise<void> {
  await sql`
    update driver_availability
       set is_available = ${opts.available},
           changed_at = now() - make_interval(mins => ${opts.changedMin})
     where driver_id = ${driverId}::uuid`;
  await sql`
    update drivers
       set last_location = case when ${opts.locatedMin}::integer is null then null
                               else st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography end,
           last_location_at = case when ${opts.locatedMin}::integer is null then null
                                   else now() - make_interval(mins => ${opts.locatedMin}::integer) end,
           last_location_recorded_at = null
     where id = ${driverId}::uuid`;
}

/**
 * يدفعُ تذكيراتِ السائقِ إلى الماضي كأنَّ دقائقَ مضت. ومفتاحُ الدلوِ يتقدّمُ مع الزمنِ الحقيقيّ،
 * فيُزاحُ هنا كما كانَ سيُزاحُ بمرورِ المهلة.
 */
async function age(driverId: string, minutes: number): Promise<void> {
  await sql`
    update notification_outbox
       set created_at = created_at - make_interval(mins => ${minutes}),
           dedup_key = dedup_key || ':aged-' || id::text
     where kind = 'driver_location_reminder' and driver_id = ${driverId}::uuid`;
}

async function clearReminders(): Promise<void> {
  for (const id of Object.values(drivers)) {
    await sql`delete from notification_outbox where driver_id = ${id}::uuid`;
  }
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const names = ["stale", "fresh", "off", "justOn", "never", "onTrip"];
  for (const [i, name] of names.entries()) {
    const tg = BASE_TG + i;
    const [user] = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, role, full_name, phone, language_code)
      values (${cityId}, ${tg}, 'driver', ${`سائق ${name}`}, ${`+9665000${tg % 100_000}`}, 'ar')
      returning id`;
    if (user === undefined) throw new Error("تعذّر زرعُ السائق");
    userIds.push(user.id);
    const [driver] = await sql<{ id: string }[]>`
      insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number)
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ح ل ${tg % 10_000}`})
      returning id`;
    if (driver === undefined) throw new Error("تعذّر زرعُ السائق");
    drivers[name] = driver.id;
    await sql`
      insert into driver_availability (driver_id, city_id, is_available)
      values (${driver.id}, ${cityId}, true)
      on conflict (driver_id) do update set is_available = true`;
  }
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكب WR-12', '+966500000529') returning id`;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكب");
  userIds.push(riderUser.id);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
  await setSetting("driver_location_reminder_seconds", 300);
  await setSetting("driver_location_reminder_max_count", 3);
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await sql`delete from orders where rider_id = ${riderId}`;
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of Object.values(drivers)) {
    await sql`delete from notification_outbox where driver_id = ${id}::uuid`;
    await sql`delete from driver_availability where driver_id = ${id}::uuid`;
    await sql`delete from drivers where id = ${id}::uuid`;
  }
  for (const id of userIds) {
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await sql`delete from platform_settings where city_id = ${cityId} and description_ar = 'اختبار WR-12'`;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

async function shapeAll(): Promise<void> {
  await shape(String(drivers.stale), { available: true, changedMin: 30, locatedMin: 10 });
  await shape(String(drivers.fresh), { available: true, changedMin: 30, locatedMin: 1 });
  await shape(String(drivers.off), { available: false, changedMin: 30, locatedMin: 10 });
  await shape(String(drivers.justOn), { available: true, changedMin: 2, locatedMin: 10 });
  await shape(String(drivers.never), { available: true, changedMin: 30, locatedMin: null });
  await shape(String(drivers.onTrip), { available: true, changedMin: 30, locatedMin: 10 });
  await sql`delete from orders where rider_id = ${riderId}`;
  await sql`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label,
                        dropoff_label, assigned_driver_id)
    values (${cityId}, ${riderId}, 'transport'::service_type, 'matched'::order_status,
            st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography,
            st_setsrid(st_makepoint(39.1728, 21.5433), 4326)::geography,
            'الانطلاق', 'الحرم', ${String(drivers.onTrip)}::uuid)`;
}

describeIf("WR-12 — تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه (ADR 0268)", () => {
  it("يُذكَّرُ المتوفّرُ بموقعٍ قديمٍ أو بلا موقع، ولا يُذكَّرُ الحديثُ ولا الموقوفُ ولا حديثُ التفعيلِ ولا مَن في رحلة", async () => {
    await clearReminders();
    await shapeAll();
    await enqueue();
    expect(await reminders(String(drivers.stale))).toHaveLength(1);
    expect(await reminders(String(drivers.never))).toHaveLength(1);
    for (const name of ["fresh", "off", "justOn", "onTrip"]) {
      expect(await reminders(String(drivers[name]))).toHaveLength(0);
    }
    const [row] = await reminders(String(drivers.stale));
    expect(row?.status).toBe("pending");
    expect(row?.dedup_key.startsWith(`location_reminder:${String(drivers.stale)}:`)).toBe(true);
  });

  it("تكرارُ الشوطِ لا يُكرِّرُ، والتذكيرُ التالي بعدَ المهلة، والسقفُ ثلاثةٌ بلا موقعٍ جديد", async () => {
    await clearReminders();
    await shapeAll();
    const stale = String(drivers.stale);
    // آخرُ موقعٍ قبلَ ساعةٍ فتبقى التذكيراتُ المُزاحةُ بعدَه، كما في الزمنِ الحقيقيّ.
    await shape(stale, { available: true, changedMin: 90, locatedMin: 60 });
    await enqueue();
    await enqueue();
    expect(await reminders(stale)).toHaveLength(1);
    await age(stale, 6);
    await enqueue();
    expect(await reminders(stale)).toHaveLength(1 + 1);
    await age(stale, 6);
    await enqueue();
    expect(await reminders(stale)).toHaveLength(3);
    await age(stale, 6);
    await enqueue();
    expect(await reminders(stale)).toHaveLength(3);
    // موقعٌ وصلَ بعدَها ثمّ قدُمَ ⇒ نوبةُ تذكيرٍ جديدة.
    await shape(stale, { available: true, changedMin: 90, locatedMin: 6 });
    await enqueue();
    expect(await reminders(stale)).toHaveLength(4);
  });

  it("المهلةُ صفرٌ ⇒ لا تذكير", async () => {
    await clearReminders();
    await shapeAll();
    await setSetting("driver_location_reminder_seconds", 0);
    try {
      await enqueue();
      expect(await reminders(String(drivers.stale))).toHaveLength(0);
    } finally {
      await setSetting("driver_location_reminder_seconds", 300);
    }
  });

  it("المُطالِبُ يُرفِقُ المحادثةَ واللغةَ وحالَ السائقِ لحظةَ الإرسال", async () => {
    await clearReminders();
    await shapeAll();
    await enqueue();
    const stale = String(drivers.stale);
    // الصفوفُ المعلّقةُ الأخرى تُحذَفُ ليُطالَبَ بصفِّ هذا السائقِ وحدَه.
    await sql`delete from notification_outbox where status in ('pending', 'sending') and (driver_id is distinct from ${stale}::uuid)`;
    // أوقفَ توافرَه بعدَ الإيداعِ وقبلَ الإرسال.
    await sql`update driver_availability set is_available = false where driver_id = ${stale}::uuid`;
    let payload: Payload | null = null;
    for (let i = 0; i < 4 && payload === null; i += 1) {
      const [r] = await sql<{ result: Payload }[]>`select claim_notification_delivery() as result`;
      const d = r?.result.delivery as Payload | null | undefined;
      if (r?.result.undeliverable !== undefined) continue;
      if (d === null || d === undefined) break;
      if (d.kind === "driver_location_reminder") payload = d.payload as Payload;
    }
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      driver_id: stale,
      chat_id: String(BASE_TG),
      language: "ar",
      is_available: false,
      still_stale: true,
    });
    expect(Number(payload?.minutes)).toBeGreaterThanOrEqual(9);
  });
});
