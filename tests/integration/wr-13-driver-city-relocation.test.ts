/**
 * الغرض: `WR-13` (ADR 0269) — مدينةُ السائقِ تتبعُ موقعَه الحديثَ الموثوقَ على قاعدةٍ حقيقيّة:
 *   النقلُ بين مدينتين مفعّلتين، ورفضُ الموقعِ القديمِ وغيرِ الموثوق، وصونُ الرحلةِ القائمة،
 *   وإخطارُ مَن خرجَ من التغطيةِ مرّةً لكلِّ نوبة.
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

const BASE_TG = 900_000_540;
const RIDER_TG = 900_000_549;
/** مركزُ حدِّ خدمةِ مكّةَ في البذرة، ونقطةٌ خارجَ كلِّ المدن. */
const MAKKAH_POINT = { lat: 21.425, lng: 39.85 };
const OUTSIDE_POINT = { lat: 30.0, lng: 35.0 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let makkahId = "";
let makkahPrior: Record<string, unknown> | null = null;
let riderId = "";
const userIds: string[] = [];
const drivers: Record<string, string> = {};
const TEST_NOTE = "اختبار WR-13";

async function relocate(): Promise<Record<string, number>> {
  const [row] = await sql<{ result: Record<string, number> }[]>`
    select relocate_drivers_by_location(500) as result`;
  return row?.result ?? {};
}

async function cityOf(driverId: string): Promise<{ driver: string; availability: string }> {
  const [row] = await sql<{ driver: string; availability: string }[]>`
    select d.city_id::text as driver, da.city_id::text as availability
      from drivers d join driver_availability da on da.driver_id = d.id
     where d.id = ${driverId}::uuid`;
  if (row === undefined) throw new Error("لا سائق");
  return row;
}

async function notices(driverId: string) {
  return sql<{ city_id: string; dedup_key: string; payload: Record<string, unknown> }[]>`
    select city_id::text, dedup_key, payload from notification_outbox
     where kind = 'driver_city_notice' and driver_id = ${driverId}::uuid order by created_at`;
}

async function place(
  driverId: string,
  point: { lat: number; lng: number },
  opts: { ageSec?: number; quality?: string; accuracy?: number | null } = {},
): Promise<void> {
  await sql`
    update drivers
       set city_id = ${cityId}::uuid,
           last_location = st_setsrid(st_makepoint(${point.lng}, ${point.lat}), 4326)::geography,
           last_location_at = now() - make_interval(secs => ${opts.ageSec ?? 10}),
           last_location_recorded_at = now() - make_interval(secs => ${opts.ageSec ?? 10}),
           last_location_quality = ${opts.quality ?? "ACCEPT"},
           last_location_accuracy_m = ${opts.accuracy === undefined ? 20 : opts.accuracy}
     where id = ${driverId}::uuid`;
  await sql`
    update driver_availability set city_id = ${cityId}::uuid, is_available = true,
           changed_at = now() - interval '30 minutes'
     where driver_id = ${driverId}::uuid`;
}

async function setSetting(key: string, value: number): Promise<void> {
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
    select c.id, ${key}, to_jsonb(${value}::integer), 'number', ${TEST_NOTE}, false
      from cities c where c.id in (${cityId}::uuid, ${makkahId}::uuid)
    on conflict (city_id, key) do update set value = excluded.value`;
}

async function reset(): Promise<void> {
  for (const id of Object.values(drivers)) {
    await sql`delete from notification_outbox where driver_id = ${id}::uuid`;
    await sql`delete from audit_log where entity_type = 'driver' and entity_id = ${id}::uuid`;
  }
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const [mkk] = await sql<
    {
      id: string;
      is_active: boolean;
      telegram_support_group_id: string | null;
      telegram_escalation_group_id: string | null;
      telegram_unsubscribed_drivers_group_id: string | null;
    }[]
  >`select id, is_active, telegram_support_group_id::text, telegram_escalation_group_id::text,
           telegram_unsubscribed_drivers_group_id::text
      from cities where code = 'MKK'`;
  if (mkk === undefined) throw new Error("لا مكّة في البذرة");
  makkahId = mkk.id;
  makkahPrior = mkk;
  if (!mkk.is_active) {
    await sql`
      update cities set
        telegram_support_group_id = coalesce(telegram_support_group_id, -1003101),
        telegram_escalation_group_id = coalesce(telegram_escalation_group_id, -1003102),
        telegram_unsubscribed_drivers_group_id = coalesce(telegram_unsubscribed_drivers_group_id, -1003103),
        is_active = true
       where id = ${makkahId}::uuid`;
  }
  const names = ["mover", "stale", "alert", "blurry", "onTrip", "outside"];
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
      values (${cityId}, ${user.id}, 'verified'::verification_status, 'سيدان', ${`ح م ${tg % 10_000}`})
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
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكب WR-13', '+966500000549') returning id`;
  if (riderUser === undefined) throw new Error("تعذّر زرعُ الراكب");
  userIds.push(riderUser.id);
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser.id}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
  await setSetting("driver_city_relocation_max_age_seconds", 120);
  await setSetting("driver_city_relocation_max_accuracy_m", 300);
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  await reset();
  if (riderId !== "") await sql`delete from riders where id = ${riderId}`;
  for (const id of Object.values(drivers)) {
    await sql`delete from driver_availability where driver_id = ${id}::uuid`;
    await sql`delete from drivers where id = ${id}::uuid`;
  }
  for (const id of userIds) {
    await sql`delete from audit_log where actor_user_id = ${id}`;
    await sql`delete from users where id = ${id}`;
  }
  await sql`delete from platform_settings where description_ar = ${TEST_NOTE}`;
  if (makkahPrior !== null) {
    await sql`
      update cities set is_active = ${Boolean(makkahPrior.is_active)},
        telegram_support_group_id = ${makkahPrior.telegram_support_group_id as string | null}::bigint,
        telegram_escalation_group_id = ${makkahPrior.telegram_escalation_group_id as string | null}::bigint,
        telegram_unsubscribed_drivers_group_id = ${makkahPrior.telegram_unsubscribed_drivers_group_id as string | null}::bigint
       where id = ${makkahId}::uuid`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-13 — مدينةُ السائقِ تتبعُ موقعَه الحديث (ADR 0269)", () => {
  it("موقعٌ حديثٌ موثوقٌ داخلَ مكّة ⇒ يُنقَلُ السائقُ والتوافرُ ويُسجَّلُ ويُخطَرُ باسمِ المدينة", async () => {
    await reset();
    const mover = String(drivers.mover);
    await place(mover, MAKKAH_POINT);
    await relocate();
    expect(await cityOf(mover)).toEqual({ driver: makkahId, availability: makkahId });
    const [audit] = await sql<{ payload: Record<string, unknown> }[]>`
      select payload from audit_log where action = 'driver.city_changed' and entity_id = ${mover}::uuid`;
    expect(audit?.payload).toMatchObject({ old_city_id: cityId, new_city_id: makkahId });
    const rows = await notices(mover);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.city_id).toBe(makkahId);
    expect(rows[0]?.payload).toMatchObject({ driver_id: mover, event: "changed" });
    expect(typeof rows[0]?.payload.city_name_ar).toBe("string");
    // مكانُه الآنَ داخلَ مدينتِه ⇒ لا نقلَ ولا إخطارَ ثانٍ.
    await relocate();
    expect(await notices(mover)).toHaveLength(1);
  });

  it("الموقعُ القديمُ أو `ALERT` أو الضبابيُّ لا يَنقُل", async () => {
    await reset();
    await place(String(drivers.stale), MAKKAH_POINT, { ageSec: 600 });
    await place(String(drivers.alert), MAKKAH_POINT, { quality: "ALERT" });
    await place(String(drivers.blurry), MAKKAH_POINT, { accuracy: 1500 });
    await relocate();
    for (const name of ["stale", "alert", "blurry"]) {
      expect((await cityOf(String(drivers[name]))).driver).toBe(cityId);
      expect(await notices(String(drivers[name]))).toHaveLength(0);
    }
  });

  it("الرحلةُ القائمةُ لا تُكسَر: لا نقلَ ما دامَ السائقُ فيها", async () => {
    await reset();
    const onTrip = String(drivers.onTrip);
    await place(onTrip, MAKKAH_POINT);
    await sql`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label,
                          dropoff_label, assigned_driver_id)
      values (${cityId}, ${riderId}, 'transport'::service_type, 'in_progress'::order_status,
              st_setsrid(st_makepoint(39.1925, 21.4858), 4326)::geography,
              st_setsrid(st_makepoint(39.85, 21.425), 4326)::geography,
              'جدة', 'الحرم', ${onTrip}::uuid)`;
    const result = await relocate();
    expect(Number(result.held)).toBeGreaterThanOrEqual(1);
    expect((await cityOf(onTrip)).driver).toBe(cityId);
    expect(await notices(onTrip)).toHaveLength(0);
  });

  it("خارجَ كلِّ المدنِ المفعّلة ⇒ لا نقل، وإخطارٌ واحدٌ لكلِّ نوبةِ توافر", async () => {
    await reset();
    const outside = String(drivers.outside);
    await place(outside, OUTSIDE_POINT);
    await relocate();
    await relocate();
    expect((await cityOf(outside)).driver).toBe(cityId);
    const rows = await notices(outside);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ driver_id: outside, event: "outside" });
    // غيرُ المتوفّرِ لا يُخطَر.
    await reset();
    await sql`update driver_availability set is_available = false where driver_id = ${outside}::uuid`;
    await relocate();
    expect(await notices(outside)).toHaveLength(0);
  });

  it("المهلةُ صفرٌ ⇒ لا نقلَ آليّ", async () => {
    await reset();
    await setSetting("driver_city_relocation_max_age_seconds", 0);
    try {
      await place(String(drivers.mover), MAKKAH_POINT);
      await relocate();
      expect((await cityOf(String(drivers.mover))).driver).toBe(cityId);
    } finally {
      await setSetting("driver_city_relocation_max_age_seconds", 120);
    }
  });

  it("المُطالِبُ يُرفِقُ محادثةَ السائقِ ولغتَه", async () => {
    await reset();
    const mover = String(drivers.mover);
    await place(mover, MAKKAH_POINT);
    await relocate();
    await sql`delete from notification_outbox where status in ('pending', 'sending') and (driver_id is distinct from ${mover}::uuid)`;
    let payload: Record<string, unknown> | null = null;
    for (let i = 0; i < 4 && payload === null; i += 1) {
      const [r] = await sql<{ result: Record<string, unknown> }[]>`
        select claim_notification_delivery() as result`;
      if (r?.result.undeliverable !== undefined) continue;
      const d = r?.result.delivery as Record<string, unknown> | null | undefined;
      if (d === null || d === undefined) break;
      if (d.kind === "driver_city_notice") payload = d.payload as Record<string, unknown>;
    }
    expect(payload).toMatchObject({
      driver_id: mover,
      event: "changed",
      chat_id: String(BASE_TG),
      language: "ar",
    });
  });
});
