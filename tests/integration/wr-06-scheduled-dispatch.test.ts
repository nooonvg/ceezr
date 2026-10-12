/**
 * الغرض: `WR-06` الخيارُ ج (ADR 0273) — الجدولةُ الحقيقيّةُ على قاعدةٍ حقيقيّة:
 *   الإنشاءُ مجدولًا أو فوريًّا، ومنعُ الطلبِ الثاني، والإعادةُ بالمفتاحِ نفسِه، والإطلاقُ في وقتِه
 *   وسباقُه (`skip locked`) وسباقُه مع الإلغاء، وما فاتَ موعدُه بعدَ تعطّل، والتذكيراتُ بلا تكرار،
 *   وعدّادُ البحثِ من لحظةِ الإطلاقِ لا الإنشاء، والطلباتُ القائمةُ لا تُمَسّ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createSearchingOrderFinder } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import {
  createPickupReminderStateReader,
  createScheduledOrderReleaser,
  enqueueScheduledReminders,
} from "../../packages/infrastructure/dispatch/scheduled-orders-adapters.ts";
import { createUnmatchedOrderFinder } from "../../packages/infrastructure/dispatch/unmatched-adapters.ts";
import {
  createRideCancelCommand,
  createRideRequestCommand,
} from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TG = 900_002_606;
const DRIVER_TG = 900_002_607;
const ORIGIN = { lat: 21.5433, lng: 39.1728 } as const;
const DESTINATION = { lat: 21.5551, lng: 39.1902 } as const;
const MINUTE = 60_000;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverId = "";

function key(label: string): string {
  return `ride:wr06:${label}:${crypto.randomUUID()}`;
}

function minuteFromNow(minutes: number): Date {
  const at = new Date(Date.now() + minutes * MINUTE);
  at.setUTCSeconds(0, 0);
  return at;
}

async function create(label: string, pickupAt: Date | null, idempotencyKey = key(label)) {
  const result = await createRideRequestCommand(sql).create({
    telegramUserId: String(RIDER_TG),
    idempotencyKey,
    service: "transport",
    origin: ORIGIN,
    destination: DESTINATION,
    notes: null,
    offerSar: null,
    offerMode: "open",
    ...(pickupAt === null ? {} : { pickupAt }),
  });
  if (!result.ok) throw new Error(`فشلَ المخزن: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createAccepted(label: string, pickupAt: Date | null) {
  const value = await create(label, pickupAt);
  if (!value.accepted) throw new Error(`رُفضَ الطلب: ${JSON.stringify(value)}`);
  return value.ride;
}

interface OrderRow {
  status: string;
  pickup_at: Date | null;
  dispatch_at: Date | null;
  searching_since: Date | null;
  cancelled_reason: string | null;
}

async function order(id: string): Promise<OrderRow> {
  const [row] = await sql<OrderRow[]>`
    select status::text as status, pickup_at, dispatch_at, searching_since, cancelled_reason
      from orders where id = ${id}::uuid`;
  if (row === undefined) throw new Error("الطلبُ غائب");
  return row;
}

async function riderEvents(id: string): Promise<string[]> {
  const rows = await sql<{ event: string }[]>`
    select payload->>'event' as event from notification_outbox
     where kind = 'rider_trip_notice' and order_id = ${id}::uuid order by created_at, id`;
  return rows.map((r) => r.event);
}

async function release() {
  const result = await createScheduledOrderReleaser(sql).releaseDue(cityId as CityId, 50);
  if (!result.ok) throw new Error(result.error.detail);
  return {
    released: result.value.released.map(String),
    missed: result.value.missed.map(String),
  };
}

/** يُقدِّمُ ساعةَ الطلبِ كأنَّ الزمنَ مضى: موعدُ الإطلاقِ والحضورِ (والإنشاءُ قبلَهما). */
async function shift(
  id: string,
  opts: { dispatchMin: number; pickupMin: number; createdMin?: number },
) {
  await sql`
    update orders
       set dispatch_at = now() + make_interval(mins => ${opts.dispatchMin}),
           pickup_at   = now() + make_interval(mins => ${opts.pickupMin}),
           created_at  = now() + make_interval(mins => ${opts.createdMin ?? -600})
     where id = ${id}::uuid`;
}

async function clearOrders(): Promise<void> {
  const ids = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (${ids})`;
  await sql`delete from order_offers where order_id in (${ids})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${ids})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكب WR-06 المجدول', '+966500002606', 'ar')
    returning id`;
  if (user === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderUserId = user.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
  driverId = await seedCapableDriver({ sql, cityId, service: "transport", telegramId: DRIVER_TG });
});

afterEach(async () => {
  if (DATABASE_URL === undefined || riderId === "") return;
  await clearOrders();
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await clearOrders();
    await sql`delete from riders where id = ${riderId}`;
  }
  if (riderUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${riderUserId}`;
    await sql`delete from users where id = ${riderUserId}`;
  }
  if (driverId !== "") {
    await sql`delete from notification_outbox where driver_id = ${driverId}::uuid`;
    await sql`delete from driver_capabilities where driver_id = ${driverId}::uuid`;
    await sql`delete from subscriptions where driver_id = ${driverId}::uuid`;
    await sql`delete from driver_availability where driver_id = ${driverId}::uuid`;
    await sql`delete from drivers where id = ${driverId}::uuid`;
  }
  await sql`delete from users where telegram_id = ${DRIVER_TG}`;
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-06 ج — الإنشاءُ مجدولًا أو فوريًّا", () => {
  it("موعدٌ بعيدٌ ⇒ `scheduled` ولحظةُ إطلاقٍ = الموعدُ − المهلة (20 د افتراضًا)، ولا عرضَ لأيِّ سائق", async () => {
    const pickupAt = minuteFromNow(180);
    const ride = await createAccepted("far", pickupAt);
    expect(ride.status).toBe("scheduled");
    expect(ride.pickupAtMs).toBe(pickupAt.getTime());
    expect(ride.dispatchAtMs).toBe(pickupAt.getTime() - 20 * MINUTE);
    const row = await order(ride.orderId);
    expect(row.status).toBe("scheduled");
    expect(row.searching_since).toBeNull();
    const [offers] = await sql<{ n: number }[]>`
      select count(*)::int as n from order_offers where order_id = ${ride.orderId}::uuid`;
    expect(offers?.n).toBe(0);
    expect(await riderEvents(ride.orderId)).toEqual(["SCHEDULED"]);
    const [audit] = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where action = 'order.scheduled' and entity_id = ${ride.orderId}::uuid`;
    expect(audit?.n).toBe(1);
  });

  it("المجدولُ لا يراه مُعيدُ البثِّ ولا مُصعِّدُ «لا سائق»", async () => {
    const ride = await createAccepted("invisible", minuteFromNow(180));
    await sql`update orders set created_at = now() - interval '2 days' where id = ${ride.orderId}::uuid`;
    const searching = await createSearchingOrderFinder(sql).findSearching(cityId as CityId, 500);
    if (!searching.ok) throw new Error(searching.error.detail);
    expect(searching.value.map((o) => o.orderId)).not.toContain(ride.orderId);
    const stale = await createUnmatchedOrderFinder(sql).findStaleSearching(cityId as CityId, 60);
    if (!stale.ok) throw new Error(stale.error.detail);
    expect(stale.value.map((o) => o.orderId)).not.toContain(ride.orderId);
  });

  it("موعدٌ داخلَ المهلةِ أو بلا موعد ⇒ بحثٌ فوريٌّ كما كان", async () => {
    const near = await createAccepted("near", minuteFromNow(10));
    expect(near.status).toBe("searching");
    const nearRow = await order(near.orderId);
    expect(nearRow.status).toBe("searching");
    expect(nearRow.dispatch_at).toBeNull();
    expect(nearRow.pickup_at).not.toBeNull();
    await clearOrders();
    const now = await createAccepted("now", null);
    expect(now.status).toBe("searching");
    expect((await order(now.orderId)).pickup_at).toBeNull();
  });

  it("مجدولٌ قائمٌ يمنعُ طلبًا ثانيًا، والمفتاحُ نفسُه يُعيدُ المجدولَ نفسَه", async () => {
    const idem = key("idem");
    const first = await create("idem", minuteFromNow(240), idem);
    if (!first.accepted) throw new Error("رُفض");
    const again = await create("idem", minuteFromNow(240), idem);
    expect(again.accepted).toBe(true);
    if (!again.accepted) return;
    expect(again.ride.orderId).toBe(first.ride.orderId);
    expect(again.ride.reused).toBe(true);
    expect(again.ride.status).toBe("scheduled");
    const second = await create("second", null);
    expect(second.accepted).toBe(false);
    if (second.accepted) return;
    expect(second.refusal).toBe("ACTIVE_RIDE_EXISTS");
  });

  it("قيدُ القاعدة: لا `scheduled` بلا لحظتَي الحضورِ والإطلاق", async () => {
    const ride = await createAccepted("constraint", minuteFromNow(180));
    let refused: string | null = null;
    try {
      await sql`update orders set dispatch_at = null where id = ${ride.orderId}::uuid`;
    } catch (cause) {
      refused = cause instanceof Error ? cause.message : String(cause);
    }
    expect(refused).toContain("orders_scheduled_has_times");
  });

  it("حالةُ البحثِ تقولُ «مجدول» بموعدَيه وقابلًا للإلغاء", async () => {
    const pickupAt = minuteFromNow(180);
    const ride = await createAccepted("state", pickupAt);
    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      select ride_search_state(${RIDER_TG}::bigint, ${ride.orderId}::uuid) as result`;
    expect(row?.result.status).toBe("scheduled");
    expect(row?.result.cancellable_without_penalty).toBe(true);
    expect(Date.parse(String(row?.result.pickup_at))).toBe(pickupAt.getTime());
    expect(Date.parse(String(row?.result.dispatch_at))).toBe(pickupAt.getTime() - 20 * MINUTE);
  });

  it("حذفُ الحسابِ يُرفَضُ وللراكبِ طلبٌ مجدول", async () => {
    await createAccepted("erase", minuteFromNow(180));
    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      select erase_my_account(${RIDER_TG}::bigint) as result`;
    expect(row?.result.ok).toBe(false);
    const [still] = await sql<{ n: number }[]>`
      select count(*)::int as n from users where id = ${riderUserId}::uuid and erased_at is null`;
    expect(still?.n).toBe(1);
  });
});

describeIf("WR-06 ج — الإطلاقُ والتعافي", () => {
  it("حانَ موعدُ الإطلاق ⇒ `searching` وعدّادُ البحثِ يبدأُ الآن، وإشعارُ «بدأ البحث» مرّةً واحدة", async () => {
    const ride = await createAccepted("release", minuteFromNow(180));
    await shift(ride.orderId, { dispatchMin: -1, pickupMin: 19, createdMin: -2880 });
    const first = await release();
    expect(first.released).toContain(ride.orderId);
    const row = await order(ride.orderId);
    expect(row.status).toBe("searching");
    expect(row.searching_since).not.toBeNull();
    const again = await release();
    expect(again.released).not.toContain(ride.orderId);
    expect(await riderEvents(ride.orderId)).toEqual(["SCHEDULED", "SEARCH_STARTED"]);
    // أُنشئَ قبلَ يومَين، لكنَّ الانتظارَ يُقاسُ من الإطلاق: لا تصعيدَ فوريّ.
    const searching = await createSearchingOrderFinder(sql).findSearching(cityId as CityId, 500);
    if (!searching.ok) throw new Error(searching.error.detail);
    const ref = searching.value.find((o) => o.orderId === ride.orderId);
    expect(ref).toBeDefined();
    expect(Number(ref?.waitingSeconds)).toBeLessThan(60);
    const stale = await createUnmatchedOrderFinder(sql).findStaleSearching(cityId as CityId, 60);
    if (!stale.ok) throw new Error(stale.error.detail);
    expect(stale.value.map((o) => o.orderId)).not.toContain(ride.orderId);
  });

  it("لم يحِن الموعدُ ⇒ لا إطلاق", async () => {
    const ride = await createAccepted("early", minuteFromNow(180));
    const out = await release();
    expect(out.released).not.toContain(ride.orderId);
    expect((await order(ride.orderId)).status).toBe("scheduled");
  });

  it("تعطّلَ النظامُ حتّى فاتَ الموعدُ ومهلتُه ⇒ يُلغى `scheduled_missed` ويُبلَّغُ الراكب، لا بحثٌ متأخّر", async () => {
    const ride = await createAccepted("missed", minuteFromNow(180));
    await shift(ride.orderId, { dispatchMin: -60, pickupMin: -40 });
    const out = await release();
    expect(out.missed).toContain(ride.orderId);
    expect(out.released).not.toContain(ride.orderId);
    const row = await order(ride.orderId);
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_reason).toBe("scheduled_missed");
    expect(await riderEvents(ride.orderId)).toEqual(["SCHEDULED", "SCHEDULE_MISSED"]);
  });

  it("تعطّلَ النظامُ لكنَّ الموعدَ ما زالَ داخلَ المهلة ⇒ يُطلَقُ متأخّرًا", async () => {
    const ride = await createAccepted("late", minuteFromNow(180));
    await shift(ride.orderId, { dispatchMin: -25, pickupMin: -5 });
    const out = await release();
    expect(out.released).toContain(ride.orderId);
    expect((await order(ride.orderId)).status).toBe("searching");
  });

  it("سباقُ مُطلِقَين متزامنَين (مثيلان): كلُّ طلبٍ يُطلَقُ مرّةً واحدة", async () => {
    const a = await createAccepted("race-a", minuteFromNow(180));
    await shift(a.orderId, { dispatchMin: -1, pickupMin: 19 });
    const other = createSql({ connectionString: String(DATABASE_URL) });
    try {
      const [x, y] = await Promise.all([
        createScheduledOrderReleaser(sql).releaseDue(cityId as CityId, 50),
        createScheduledOrderReleaser(other).releaseDue(cityId as CityId, 50),
      ]);
      if (!x.ok || !y.ok) throw new Error("فشلَ الإطلاق");
      const hits = [...x.value.released, ...y.value.released]
        .map(String)
        .filter((id) => id === a.orderId);
      expect(hits).toHaveLength(1);
      expect(await riderEvents(a.orderId)).toEqual(["SCHEDULED", "SEARCH_STARTED"]);
    } finally {
      await other.end();
    }
  });

  it("الإلغاءُ يمسكُ الصفَّ والإطلاقُ يتخطّاه، ثمّ لا يُطلَقُ الملغى أبدًا", async () => {
    const ride = await createAccepted("cancel-race", minuteFromNow(180));
    await shift(ride.orderId, { dispatchMin: -1, pickupMin: 19 });
    const holder = createSql({ connectionString: String(DATABASE_URL), max: 1 });
    try {
      let releasedDuringLock: readonly string[] = [];
      await holder.begin(async (tx) => {
        await tx`select id from orders where id = ${ride.orderId}::uuid for update`;
        releasedDuringLock = (await release()).released;
        await tx`select cancel_ride_by_telegram(${RIDER_TG}::bigint, ${ride.orderId}::uuid)`;
      });
      expect(releasedDuringLock).not.toContain(ride.orderId);
      expect((await order(ride.orderId)).status).toBe("cancelled");
      expect((await release()).released).not.toContain(ride.orderId);
      expect(await riderEvents(ride.orderId)).toEqual(["SCHEDULED"]);
    } finally {
      await holder.end();
    }
  });

  it("الراكبُ يُلغي مجدولَه بلا أثرٍ وبلا أن يبلغَ أيَّ سائق", async () => {
    const ride = await createAccepted("cancel", minuteFromNow(180));
    const cancelled = await createRideCancelCommand(sql).cancel({
      telegramUserId: String(RIDER_TG),
      orderId: ride.orderId,
    });
    expect(cancelled.ok && cancelled.value.cancelled).toBe(true);
    expect((await order(ride.orderId)).status).toBe("cancelled");
    const [offers] = await sql<{ n: number }[]>`
      select count(*)::int as n from order_offers where order_id = ${ride.orderId}::uuid`;
    expect(offers?.n).toBe(0);
  });

  it("طلبٌ قائمٌ بموعدٍ وحالةِ `searching` (قبلَ الميزة) لا يمسُّه المُطلِق", async () => {
    const [row] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, dropoff, pickup_label,
                          dropoff_label, pickup_at)
      values (${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
              st_setsrid(st_makepoint(${ORIGIN.lng}, ${ORIGIN.lat}), 4326)::geography,
              st_setsrid(st_makepoint(${DESTINATION.lng}, ${DESTINATION.lat}), 4326)::geography,
              'الانطلاق', 'الوجهة', now() + interval '3 hours')
      returning id`;
    if (row === undefined) throw new Error("تعذّر الزرع");
    const out = await release();
    expect([...out.released, ...out.missed]).not.toContain(row.id);
    const after = await order(row.id);
    expect(after.status).toBe("searching");
    expect(after.searching_since).toBeNull();
    expect(after.dispatch_at).toBeNull();
  });
});

describeIf("WR-06 ج — التذكيرات", () => {
  it("الراكب: يُذكَّرُ مرّةً داخلَ النافذة، ولا يُذكَّرُ من حجزَ داخلَها للتوّ", async () => {
    const old = await createAccepted("remind-old", minuteFromNow(180));
    await shift(old.orderId, { dispatchMin: 30, pickupMin: 50, createdMin: -600 });
    await enqueueScheduledReminders(sql, 100);
    await enqueueScheduledReminders(sql, 100);
    expect(await riderEvents(old.orderId)).toEqual(["SCHEDULED", "SCHEDULE_REMINDER"]);
    await clearOrders();
    const fresh = await createAccepted("remind-fresh", minuteFromNow(50));
    expect(fresh.status).toBe("scheduled");
    await enqueueScheduledReminders(sql, 100);
    expect(await riderEvents(fresh.orderId)).toEqual(["SCHEDULED"]);
  });

  it("السائق: تذكيرٌ واحدٌ قبلَ الموعدِ لمن أُسنِدَ قبلَ النافذة، ويسقطُ إن وصلَ أو أُلغي", async () => {
    const ride = await createAccepted("driver-remind", minuteFromNow(180));
    await sql`
      update orders
         set status = 'matched', assigned_driver_id = ${driverId}::uuid,
             matched_at = now() - interval '30 minutes',
             dispatch_at = now() - interval '15 minutes', pickup_at = now() + interval '5 minutes',
             searching_since = now() - interval '15 minutes'
       where id = ${ride.orderId}::uuid`;
    const first = await enqueueScheduledReminders(sql, 100);
    const second = await enqueueScheduledReminders(sql, 100);
    expect(first.driverReminders).toBeGreaterThanOrEqual(1);
    expect(second.driverReminders).toBe(0);
    const rows = await sql<{ payload: Record<string, unknown>; dedup_key: string }[]>`
      select payload, dedup_key from notification_outbox
       where kind = 'driver_candidate_notice' and order_id = ${ride.orderId}::uuid`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.outcome).toBe("PICKUP_REMINDER");
    expect(rows[0]?.dedup_key).toBe(`driver_pickup_reminder:${ride.orderId}:${driverId}`);
    const reader = createPickupReminderStateReader(sql);
    expect(await reader.read(ride.orderId, driverId)).toEqual({ stillDue: true });
    await sql`update orders set arrived_at = now() where id = ${ride.orderId}::uuid`;
    expect(await reader.read(ride.orderId, driverId)).toEqual({ stillDue: false });
  });

  it("طلبٌ فوريٌّ (بلا إطلاقٍ مجدول) لا يُذكَّرُ سائقُه", async () => {
    const ride = await createAccepted("driver-immediate", minuteFromNow(10));
    await sql`
      update orders
         set status = 'matched', assigned_driver_id = ${driverId}::uuid,
             matched_at = now() - interval '30 minutes', pickup_at = now() + interval '5 minutes'
       where id = ${ride.orderId}::uuid`;
    await enqueueScheduledReminders(sql, 100);
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from notification_outbox
       where kind = 'driver_candidate_notice' and order_id = ${ride.orderId}::uuid`;
    expect(rows[0]?.n).toBe(0);
  });
});
