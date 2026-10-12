/**
 * الغرض: `WR-22` (ADR 0276) — انتهاءُ البحثِ على قاعدةٍ حقيقيّة: لا طلبَ «يبحثُ» إلى الأبد.
 *   المعطَّلُ لا يمسُّ شيئًا، وما تجاوزَ المدّةَ بلا أيِّ سائقٍ (ولا متّصل) يُنهى `failed` بسببٍ
 *   مسمّى وأثرٍ وإشعارٍ واحد، والإعادةُ وعاملانِ متزامنانِ لا يكرّرانِه، وما في يدِ مسارٍ آخرَ
 *   (عرضٌ معلَّق، مرشَّحٌ ينتظرُ الراكب، دورةُ قروب، سائقٌ مُسنَد) يُترَك، والقبولُ والإلغاءُ بعدَ
 *   الانتهاءِ مرفوضانِ بلا أثر، والمجدولُ يُقاسُ من إطلاقِه، والمعاملةُ المرتدّةُ لا تتركُ إشعارًا.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/integration
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createScheduledOrderReleaser,
  createSearchingOrderExpirer,
} from "../../packages/infrastructure/dispatch/scheduled-orders-adapters.ts";
import { createRideRequestCommand } from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TG = 900_002_622;
const DRIVER_TG = 900_002_623;
const ORIGIN = { lat: 21.5433, lng: 39.1728 } as const;
const DESTINATION = { lat: 21.5551, lng: 39.1902 } as const;
const EXPIRE_MIN = 30;

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderUserId = "";
let riderId = "";
let driverId = "";
let priorSetting: unknown = null;

async function create(label: string, pickupAt: Date | null = null): Promise<string> {
  const result = await createRideRequestCommand(sql).create({
    telegramUserId: String(RIDER_TG),
    idempotencyKey: `ride:wr22:${label}:${crypto.randomUUID()}`,
    service: "transport",
    origin: ORIGIN,
    destination: DESTINATION,
    notes: null,
    offerSar: null,
    offerMode: "open",
    ...(pickupAt === null ? {} : { pickupAt }),
  });
  if (!result.ok || !result.value.accepted) throw new Error(`رُفضَ الطلب: ${JSON.stringify(result)}`);
  return result.value.ride.orderId;
}

/** يُرجِعُ بدءَ البحثِ إلى الماضي كأنَّ الزمنَ مضى. */
async function age(id: string, minutes: number): Promise<void> {
  await sql`
    update orders
       set created_at = now() - make_interval(mins => ${minutes}),
           searching_since = case when searching_since is null then null
                                  else now() - make_interval(mins => ${minutes}) end
     where id = ${id}::uuid`;
}

async function setMinutes(value: number): Promise<void> {
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
    values (${cityId}::uuid, 'searching_expire_after_minutes', ${sql.json(value)}, 'number', 'test', true)
    on conflict (city_id, key) do update set value = excluded.value`;
}

async function expire(handle: Sql = sql) {
  const result = await createSearchingOrderExpirer(handle).expireStale(cityId as CityId, 50);
  if (!result.ok) throw new Error(result.error.detail);
  return { ...result.value, expired: result.value.expired.map(String) };
}

async function state(id: string) {
  const [row] = await sql<{ status: string; cancelled_reason: string | null }[]>`
    select status::text as status, cancelled_reason from orders where id = ${id}::uuid`;
  if (row === undefined) throw new Error("الطلبُ غائب");
  return row;
}

async function notices(id: string, event = "SEARCH_EXPIRED"): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from notification_outbox
     where kind = 'rider_trip_notice' and order_id = ${id}::uuid and payload->>'event' = ${event}`;
  return row?.n ?? 0;
}

async function audits(id: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from audit_log
     where action = 'order.search_expired' and entity_id = ${id}::uuid`;
  return row?.n ?? 0;
}

async function pendingOffer(id: string, expiresInSeconds: number): Promise<void> {
  await sql`
    insert into order_offers (city_id, order_id, driver_id, status, expires_at)
    values (${cityId}::uuid, ${id}::uuid, ${driverId}::uuid, 'pending',
            now() + make_interval(secs => ${expiresInSeconds}))`;
}

async function clearOrders(): Promise<void> {
  const ids = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (${ids})`;
  await sql`delete from unsubscribed_negotiations where order_id in (${ids})`;
  await sql`delete from order_offers where order_id in (${ids})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${ids})`;
  await sql`delete from orders where rider_id = ${riderId}`;
}

beforeAll(async () => {
  if (DATABASE_URL === undefined) return;
  sql = createSql({ connectionString: DATABASE_URL });
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  cityId = cityHandle.cityId;
  const [prior] = await sql<{ value: unknown }[]>`
    select value from platform_settings
     where city_id = ${cityId}::uuid and key = 'searching_expire_after_minutes'`;
  priorSetting = prior?.value ?? null;
  const [user] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكب WR-22', '+966500002622', 'ar')
    returning id`;
  if (user === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderUserId = user.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUserId}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
  driverId = await seedCapableDriver({ sql, cityId, service: "transport", telegramId: DRIVER_TG });
  // السائقُ غيرُ متّصل: لا مرشَّحَ في المدينة — حالةُ المدينة المنوّرة نفسُها.
  await sql`update driver_availability set is_available = false where driver_id = ${driverId}::uuid`;
});

afterEach(async () => {
  if (DATABASE_URL === undefined || riderId === "") return;
  await clearOrders();
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (priorSetting === null) {
    await sql`delete from platform_settings
               where city_id = ${cityId}::uuid and key = 'searching_expire_after_minutes'`;
  } else {
    await sql`update platform_settings set value = ${sql.json(priorSetting as number)}
               where city_id = ${cityId}::uuid and key = 'searching_expire_after_minutes'`;
  }
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

describeIf("WR-22 — انتهاءُ البحث: السياسة", () => {
  it("الإعدادُ صفر (المبذورُ حتّى يقرّرَ المالك) ⇒ معطَّل، والطلبُ القديمُ يبقى يبحث", async () => {
    await setMinutes(0);
    const id = await create("disabled");
    await age(id, 600);
    const out = await expire();
    expect(out.disabled).toBe(true);
    expect(out.expired).toEqual([]);
    expect((await state(id)).status).toBe("searching");
  });

  it("قيمةٌ دونَ الحدِّ الأدنى تُرفَعُ إلى 10 دقائق، لا إنهاءَ فوريّ", async () => {
    await setMinutes(1);
    const id = await create("clamp");
    await age(id, 5);
    expect((await expire()).expired).not.toContain(id);
    await age(id, 11);
    expect((await expire()).expired).toContain(id);
  });

  it("لا سائقَ مؤهَّلًا ولا متّصلًا وتجاوزَ المدّة ⇒ `failed` و`search_expired` وأثرٌ وإشعارٌ واحد", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("no-driver");
    await age(id, EXPIRE_MIN + 1);
    const out = await expire();
    expect(out.disabled).toBe(false);
    expect(out.expired).toContain(id);
    expect(await state(id)).toEqual({ status: "failed", cancelled_reason: "search_expired" });
    expect(await audits(id)).toBe(1);
    expect(await notices(id)).toBe(1);
  });

  it("إعادةُ التشغيل (شوطٌ ثانٍ وثالث) ⇒ لا إنهاءَ ثانٍ ولا إشعارٌ ثانٍ ولا أثرٌ ثانٍ", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("rerun");
    await age(id, EXPIRE_MIN + 5);
    await expire();
    const again = await expire();
    const third = await expire();
    expect(again.expired).not.toContain(id);
    expect(third.expired).not.toContain(id);
    expect(await audits(id)).toBe(1);
    expect(await notices(id)).toBe(1);
  });

  it("دونَ المدّة ⇒ يبقى يبحث", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("young");
    await age(id, EXPIRE_MIN - 2);
    expect((await expire()).expired).not.toContain(id);
    expect((await state(id)).status).toBe("searching");
  });
});

describeIf("WR-22 — انتهاءُ البحث: ما في يدِ مسارٍ آخر", () => {
  it("عرضٌ معلَّقٌ حيّ ⇒ يُترَك؛ وبعدَ انتهاءِ العرضِ يُنهى", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("offer");
    await age(id, EXPIRE_MIN + 1);
    await pendingOffer(id, 45);
    expect((await expire()).expired).not.toContain(id);
    expect((await state(id)).status).toBe("searching");
    await sql`update order_offers set status = 'expired' where order_id = ${id}::uuid`;
    expect((await expire()).expired).toContain(id);
  });

  it("مرشَّحٌ ينتظرُ قرارَ الراكب ⇒ يُترَك", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("candidate");
    await age(id, EXPIRE_MIN + 1);
    await sql`update orders set candidate_driver_id = ${driverId}::uuid,
                                candidate_expires_at = now() + interval '30 seconds'
               where id = ${id}::uuid`;
    expect((await expire()).expired).not.toContain(id);
    expect((await state(id)).status).toBe("searching");
  });

  it("دورةُ قروبِ غيرِ المشتركينَ مفتوحة ⇒ تُترَك؛ وبعدَ إغلاقِها يُنهى", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("negotiation");
    await age(id, EXPIRE_MIN + 1);
    await sql`insert into unsubscribed_negotiations (city_id, order_id, cycle, status, collect_deadline)
              values (${cityId}::uuid, ${id}::uuid, 1, 'collecting', now() + interval '2 minutes')`;
    expect((await expire()).expired).not.toContain(id);
    await sql`update unsubscribed_negotiations set status = 'exhausted', settled_at = now()
               where order_id = ${id}::uuid`;
    expect((await expire()).expired).toContain(id);
  });

  it("المجدولُ يُقاسُ من إطلاقِه: أُنشئَ قبلَ يومَين وأُطلِقَ الآن ⇒ لا إنهاء", async () => {
    await setMinutes(EXPIRE_MIN);
    const pickup = new Date(Date.now() + 180 * 60_000);
    pickup.setUTCSeconds(0, 0);
    const id = await create("scheduled", pickup);
    await sql`update orders set dispatch_at = now() - interval '1 minute',
                                pickup_at = now() + interval '19 minutes',
                                created_at = now() - interval '2 days'
               where id = ${id}::uuid`;
    const released = await createScheduledOrderReleaser(sql).releaseDue(cityId as CityId, 50);
    if (!released.ok) throw new Error(released.error.detail);
    expect(released.value.released.map(String)).toContain(id);
    expect((await expire()).expired).not.toContain(id);
    await sql`update orders set searching_since = now() - make_interval(mins => ${EXPIRE_MIN + 1})
               where id = ${id}::uuid`;
    expect((await expire()).expired).toContain(id);
    expect(await notices(id, "SEARCH_STARTED")).toBe(1);
    expect(await notices(id)).toBe(1);
  });
});

describeIf("WR-22 — انتهاءُ البحث: التزامنُ والفشل", () => {
  it("عاملانِ متزامنانِ (مثيلان) ⇒ يُنهى مرّةً واحدة بإشعارٍ واحد", async () => {
    await setMinutes(EXPIRE_MIN);
    const ids = [await create("race-a")];
    for (const id of ids) await age(id, EXPIRE_MIN + 1);
    const other = createSql({ connectionString: String(DATABASE_URL) });
    try {
      const [x, y] = await Promise.all([expire(sql), expire(other)]);
      const hits = [...x.expired, ...y.expired].filter((id) => ids.includes(id));
      expect(hits).toHaveLength(ids.length);
    } finally {
      await other.end();
    }
    for (const id of ids) {
      expect(await notices(id)).toBe(1);
      expect(await audits(id)).toBe(1);
    }
  });

  it("سائقٌ قَبِلَ قبلَ الانتهاء (مرشَّحٌ ثمَّ إسناد) ⇒ الطلبُ المُسنَدُ لا يُمَسّ", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("matched");
    await age(id, EXPIRE_MIN + 1);
    await sql`update orders set status = 'matched', assigned_driver_id = ${driverId}::uuid,
                                matched_at = now() where id = ${id}::uuid`;
    expect((await expire()).expired).not.toContain(id);
    expect((await state(id)).status).toBe("matched");
    expect(await notices(id)).toBe(0);
  });

  it("الراكبُ ألغى قبلَ الانتهاء ⇒ يبقى `cancelled` بسببِه ولا إشعارَ انتهاء", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("cancelled");
    await age(id, EXPIRE_MIN + 1);
    const [c] = await sql<{ r: { ok: boolean } }[]>`
      select cancel_order_by_rider(${id}::uuid, ${riderId}::uuid) as r`;
    expect(c?.r.ok).toBe(true);
    expect((await expire()).expired).not.toContain(id);
    expect(await state(id)).toEqual({ status: "cancelled", cancelled_reason: "rider_cancelled" });
    expect(await notices(id)).toBe(0);
  });

  it("بعدَ الانتهاء: قبولُ سائقٍ وإلغاءُ الراكبِ مرفوضانِ بلا أثر", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("after");
    await age(id, EXPIRE_MIN + 1);
    await expire();
    const [claim] = await sql<{ r: { ok: boolean } }[]>`
      select claim_ride(${id}::uuid, ${driverId}::uuid) as r`;
    expect(claim?.r.ok).toBe(false);
    const [cancel] = await sql<{ r: { ok: boolean; error: string } }[]>`
      select cancel_order_by_rider(${id}::uuid, ${riderId}::uuid) as r`;
    expect(cancel?.r).toMatchObject({ ok: false, error: "ORDER_NOT_CANCELLABLE" });
    const row = await sql<{ status: string; assigned: string | null; candidate: string | null }[]>`
      select status::text as status, assigned_driver_id::text as assigned,
             candidate_driver_id::text as candidate from orders where id = ${id}::uuid`;
    expect(row[0]).toEqual({ status: "failed", assigned: null, candidate: null });
  });

  it("القبولُ يمسكُ القفلَ أوّلًا ⇒ العاملُ يتخطّاه، ثمَّ يتركُ الطلبَ المُرشَّح", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("lock");
    await age(id, EXPIRE_MIN + 1);
    const other = createSql({ connectionString: String(DATABASE_URL) });
    try {
      await sql.begin(async (tx) => {
        await tx`select id from orders where id = ${id}::uuid for update`;
        // العاملُ يتخطّى الصفَّ المقفول (`skip locked`) ولا ينتظر.
        const during = await expire(other);
        expect(during.expired).not.toContain(id);
        await tx`update orders set candidate_driver_id = ${driverId}::uuid,
                                   candidate_expires_at = now() + interval '30 seconds'
                  where id = ${id}::uuid`;
      });
      expect((await expire(other)).expired).not.toContain(id);
    } finally {
      await other.end();
    }
    expect((await state(id)).status).toBe("searching");
  });

  it("فشلُ العاملِ في منتصفِ المعاملة (ارتداد) ⇒ لا حالةَ ولا أثرَ ولا إشعار، والشوطُ التالي يُتمّ", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("rollback");
    await age(id, EXPIRE_MIN + 1);
    await expect(
      sql.begin(async (tx) => {
        await tx`select expire_stale_searching_orders(${cityId}::uuid, 50)`;
        throw new Error("انقطعَ العاملُ قبلَ الالتزام");
      }),
    ).rejects.toThrow("انقطعَ العاملُ");
    expect((await state(id)).status).toBe("searching");
    expect(await notices(id)).toBe(0);
    expect(await audits(id)).toBe(0);
    expect((await expire()).expired).toContain(id);
    expect(await notices(id)).toBe(1);
  });

  it("الراكبُ يستطيعُ طلبًا جديدًا بعدَ الانتهاء", async () => {
    await setMinutes(EXPIRE_MIN);
    const id = await create("renew");
    await age(id, EXPIRE_MIN + 1);
    await expire();
    const next = await create("renew-2");
    expect(next).not.toBe(id);
  });
});
