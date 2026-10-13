/**
 * الغرض: `WR-22` (ADR 0278) — إغلاقُ بطاقةِ الإسنادِ على PostGIS بالمسارِ الحقيقيّ: تصعيدٌ
 *   (`escalate_order` ثمّ `mark_escalation_delivered`) ثمّ انتهاءُ البحث
 *   (`expire_stale_searching_orders`) أو إسنادٌ أو إلغاء، ثمّ الشوط. يقيسُ: المآلُ الصحيح،
 *   والرسالةُ نفسُها تُعدَّل، والتكرارُ والتزامنُ لا يعيدانِ التعديل، والفشلُ العابرُ يُعاد حتّى حدّ،
 *   و`matched` لا يُغلِق، والتصعيدُ غيرُ المسلَّمِ لا بطاقةَ له.
 * الحالة: اختبار تكامل فعلي — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CloseEscalationCardsDependencies,
  closeEscalationCards,
} from "../../packages/application/dispatch/close-escalation-cards.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createStaleEscalationCardPort } from "../../packages/infrastructure/dispatch/escalation-card-adapters.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;

const RIDER_TG = 900_000_622;
const PICKUP = { lat: 21.4858, lng: 39.1925 };

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;
let cityId = "";
let riderId = "";
let riderUserId = "";
let driverId = "";
let driverUserId = "";
let priorSetting: unknown = null;

async function seedOrder(): Promise<string> {
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, pickup_label)
    values (
      ${cityId}, ${riderId}, 'transport'::service_type, 'searching'::order_status,
      st_setsrid(st_makepoint(${PICKUP.lng}, ${PICKUP.lat}), 4326)::geography, 'نقطةُ الانطلاق'
    ) returning id
  `;
  if (order === undefined) throw new Error("تعذّر زرعُ الطلب");
  return order.id;
}

/** تصعيدٌ حقيقيّ: الأثرُ ثمّ إعلانُ التسليمِ بمعرّفِ رسالة. */
async function escalate(orderId: string, messageId: string | null): Promise<string> {
  const [res] = await sql<{ r: { ok: boolean } }[]>`
    select escalate_order(${orderId}::uuid, 'no_driver_at_all') as r`;
  expect(res?.r.ok).toBe(true);
  if (messageId !== null) {
    await sql`select mark_escalation_delivered(${orderId}::uuid, ${messageId})`;
  }
  const [row] = await sql<{ id: string }[]>`
    select id from audit_log
     where entity_type = 'order' and entity_id = ${orderId}::uuid and action = 'order.escalated'`;
  if (row === undefined) throw new Error("لا أثرَ تصعيد");
  return row.id;
}

/** الأطوارُ ذاتُ السائقِ تشترطُ سائقًا مُسنَدًا (`orders_matched_requires_driver`). */
async function setStatus(orderId: string, status: string, reason: string | null = null) {
  const withDriver = ["matched", "in_progress", "completed"].includes(status);
  await sql`update orders set status = ${status}::order_status, cancelled_reason = ${reason},
                   assigned_driver_id = ${withDriver ? driverId : null}::uuid
             where id = ${orderId}::uuid`;
}

async function setMinutes(value: number): Promise<void> {
  await sql`
    insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
    values (${cityId}::uuid, 'searching_expire_after_minutes', ${sql.json(value)}, 'number', 'test', true)
    on conflict (city_id, key) do update set value = excluded.value`;
}

function harness(fail: (messageId: string) => Error | null = () => null) {
  const edits: { chat: string; message: string; text: string }[] = [];
  const events: string[] = [];
  const deps: CloseEscalationCardsDependencies = {
    cards: createStaleEscalationCardPort(sql),
    edit: async (chat, message, text) => {
      const e = fail(message);
      if (e !== null) throw e;
      edits.push({ chat, message, text });
    },
    text: (outcome, orderId) => `${outcome}:${orderId}`,
    log: (event) => events.push(event),
  };
  return { deps, edits, events };
}

async function closure(auditId: string) {
  const [row] = await sql<{ outcome: string | null; attempts: number; closed: boolean }[]>`
    select outcome, attempts, closed_at is not null as closed
      from escalation_card_closures where audit_id = ${auditId}::uuid`;
  return row ?? null;
}

async function clear(): Promise<void> {
  const orders = sql`select id from orders where rider_id = ${riderId}`;
  await sql`delete from notification_outbox where order_id in (${orders})`;
  await sql`delete from audit_log where entity_type = 'order' and entity_id in (${orders})`;
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
    values (${cityId}, ${RIDER_TG}, 'rider', 'راكب بطاقة الإسناد', '+966500002623', 'ar')
    returning id`;
  if (user === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderUserId = user.id;
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${user.id}) returning id`;
  if (rider === undefined) throw new Error("تعذّر زرعُ الراكب");
  riderId = rider.id;
  const [du] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone, language_code)
    values (${cityId}, ${RIDER_TG + 1}, 'driver', 'سائق بطاقة الإسناد', '+966500002624', 'ar')
    returning id`;
  if (du === undefined) throw new Error("تعذّر زرعُ السائق");
  driverUserId = du.id;
  const [d] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, plate_number, vehicle_type)
    values (${cityId}::uuid, ${du.id}::uuid, 'ب ط ق 622', 'sedan') returning id`;
  if (d === undefined) throw new Error("تعذّر زرعُ السائق");
  driverId = d.id;
});

afterAll(async () => {
  if (DATABASE_URL === undefined) return;
  if (riderId !== "") {
    await clear();
    await sql`delete from riders where id = ${riderId}`;
  }
  if (driverId !== "") await sql`delete from drivers where id = ${driverId}::uuid`;
  if (driverUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${driverUserId}`;
    await sql`delete from users where id = ${driverUserId}`;
  }
  if (riderUserId !== "") {
    await sql`delete from audit_log where actor_user_id = ${riderUserId}`;
    await sql`delete from users where id = ${riderUserId}`;
  }
  if (priorSetting === null) {
    await sql`delete from platform_settings
               where city_id = ${cityId}::uuid and key = 'searching_expire_after_minutes'`;
  } else {
    await sql`update platform_settings set value = ${sql.json(priorSetting as never)}
               where city_id = ${cityId}::uuid and key = 'searching_expire_after_minutes'`;
  }
  if (cityHandle !== undefined) await restoreCityBaseline(sql, cityHandle);
  await sql.end();
});

describeIf("WR-22 — بطاقةُ الإسناد: المآل", () => {
  it("انتهاءُ البحثِ الحقيقيّ ⇒ تُعدَّلُ الرسالةُ نفسُها «search_expired» مرّةً واحدة", async () => {
    await clear();
    const orderId = await seedOrder();
    const auditId = await escalate(orderId, "8801");
    await setMinutes(60);
    await sql`update orders set created_at = now() - interval '61 minutes' where id = ${orderId}::uuid`;
    await sql`select expire_stale_searching_orders(${cityId}::uuid, 50)`;
    const [o] = await sql<
      { status: string }[]
    >`select status::text from orders where id = ${orderId}::uuid`;
    expect(o?.status).toBe("failed");

    const h = harness();
    const first = await closeEscalationCards(cityId as CityId, h.deps);
    expect(first.ok && first.value).toEqual({ closed: 1, failed: 0, raced: 0 });
    expect(h.edits).toHaveLength(1);
    expect(h.edits[0]?.message).toBe("8801");
    expect(h.edits[0]?.chat).toMatch(/^-\d+$/);
    expect(h.edits[0]?.text).toBe(`search_expired:${orderId}`);
    expect(await closure(auditId)).toEqual({
      outcome: "search_expired",
      attempts: 0,
      closed: true,
    });

    const again = await closeEscalationCards(cityId as CityId, h.deps);
    expect(again.ok && again.value.closed).toBe(0);
    expect(h.edits).toHaveLength(1);
    expect(h.events).toEqual(["escalation_card.closed"]);
  });

  it("الإلغاءُ ⇒ cancelled، والبدءُ والإكمال ⇒ assigned، وfailed بسببٍ آخر ⇒ ended", async () => {
    await clear();
    const cancelled = await seedOrder();
    await escalate(cancelled, "8811");
    await setStatus(cancelled, "cancelled", "rider_cancelled");
    const started = await seedOrder();
    await escalate(started, "8812");
    await setStatus(started, "in_progress");
    const done = await seedOrder();
    await escalate(done, "8813");
    await setStatus(done, "completed");
    const other = await seedOrder();
    await escalate(other, "8814");
    await setStatus(other, "failed", "ops_closed");

    const h = harness();
    const out = await closeEscalationCards(cityId as CityId, h.deps);
    expect(out.ok && out.value.closed).toBe(4);
    const byMessage = Object.fromEntries(h.edits.map((e) => [e.message, e.text.split(":")[0]]));
    expect(byMessage).toEqual({
      "8811": "cancelled",
      "8812": "assigned",
      "8813": "assigned",
      "8814": "ended",
    });
  });
});

describeIf("WR-22 — بطاقةُ الإسناد: ما لا يُغلَق", () => {
  it("ما زالَ يبحث، أو `matched` (قد يعودُ يبحث) ⇒ لا تعديل", async () => {
    await clear();
    const searching = await seedOrder();
    await escalate(searching, "8821");
    const matched = await seedOrder();
    await escalate(matched, "8822");
    await setStatus(matched, "matched");
    const h = harness();
    const out = await closeEscalationCards(cityId as CityId, h.deps);
    expect(out.ok && out.value.closed).toBe(0);
    expect(h.edits).toHaveLength(0);

    // يعودُ يبحثُ بعدَ انسحابِ السائق: البطاقةُ ما زالت مفتوحةً للموظّف.
    await setStatus(matched, "searching");
    const later = await closeEscalationCards(cityId as CityId, h.deps);
    expect(later.ok && later.value.closed).toBe(0);
  });

  it("تصعيدٌ لم يُسلَّم (لا رسالة) ⇒ لا بطاقةَ تُعدَّل", async () => {
    await clear();
    const orderId = await seedOrder();
    await escalate(orderId, null);
    await setStatus(orderId, "cancelled", "rider_cancelled");
    const h = harness();
    const out = await closeEscalationCards(cityId as CityId, h.deps);
    expect(out.ok && out.value.closed).toBe(0);
    expect(h.edits).toHaveLength(0);
  });

  it("طلبٌ بلا تصعيدٍ أصلًا ⇒ لا شيء", async () => {
    await clear();
    const orderId = await seedOrder();
    await setStatus(orderId, "cancelled", "rider_cancelled");
    const h = harness();
    const out = await closeEscalationCards(cityId as CityId, h.deps);
    expect(out.ok && out.value).toEqual({ closed: 0, failed: 0, raced: 0 });
  });
});

describeIf("WR-22 — بطاقةُ الإسناد: الفشلُ والتكرارُ والتزامن", () => {
  it("فشلٌ عابرٌ يُعادُ في المرورِ التالي، ويكفُّ بعدَ الحدّ", async () => {
    await clear();
    const orderId = await seedOrder();
    const auditId = await escalate(orderId, "8831");
    await setStatus(orderId, "cancelled", "rider_cancelled");
    let failing = true;
    const h = harness(() => (failing ? new Error("Too Many Requests: retry after 3") : null));
    const first = await closeEscalationCards(cityId as CityId, h.deps);
    expect(first.ok && first.value).toEqual({ closed: 0, failed: 1, raced: 0 });
    expect(await closure(auditId)).toEqual({ outcome: null, attempts: 1, closed: false });
    expect(h.events).toEqual(["escalation_card.close_failed"]);

    failing = false;
    const second = await closeEscalationCards(cityId as CityId, h.deps);
    expect(second.ok && second.value.closed).toBe(1);
    expect(await closure(auditId)).toEqual({ outcome: "cancelled", attempts: 1, closed: true });

    // بعدَ الحدّ: لا يُلتقطُ ثانيةً ولو بقيَ غيرَ مغلق.
    await clear();
    const stuck = await seedOrder();
    const stuckAudit = await escalate(stuck, "8832");
    await setStatus(stuck, "cancelled", "rider_cancelled");
    const always = harness(() => new Error("Bad Gateway"));
    for (let i = 0; i < 6; i += 1) {
      await closeEscalationCards(cityId as CityId, { ...always.deps, maxAttempts: 3 });
    }
    expect(await closure(stuckAudit)).toEqual({ outcome: null, attempts: 3, closed: false });
  });

  it("خطأٌ نهائيٌّ من Telegram (محذوفة أو معدَّلة سلفًا) ⇒ تُعلَّمُ مغلقةً بلا إعادة", async () => {
    await clear();
    const orderId = await seedOrder();
    const auditId = await escalate(orderId, "8841");
    await setStatus(orderId, "cancelled", "rider_cancelled");
    const h = harness(() => new Error("Bad Request: message to edit not found"));
    const out = await closeEscalationCards(cityId as CityId, h.deps);
    expect(out.ok && out.value.closed).toBe(1);
    expect((await closure(auditId))?.closed).toBe(true);
  });

  it("عاملانِ متزامنان ⇒ إغلاقٌ واحدٌ مسجَّل، والآخرُ سَبْقٌ لا خطأ", async () => {
    await clear();
    const orderId = await seedOrder();
    const auditId = await escalate(orderId, "8851");
    await setStatus(orderId, "failed", "search_expired");
    const a = harness();
    const b = harness();
    const [ra, rb] = await Promise.all([
      closeEscalationCards(cityId as CityId, a.deps),
      closeEscalationCards(cityId as CityId, b.deps),
    ]);
    const closed = (ra.ok ? ra.value.closed : 0) + (rb.ok ? rb.value.closed : 0);
    const raced = (ra.ok ? ra.value.raced : 0) + (rb.ok ? rb.value.raced : 0);
    expect(closed).toBe(1);
    expect(closed + raced).toBe(a.edits.length + b.edits.length);
    expect(await closure(auditId)).toEqual({
      outcome: "search_expired",
      attempts: 0,
      closed: true,
    });
  });

  it("وصولٌ متأخّرٌ بعدَ الإغلاق (إلغاءٌ بعدَ البدء) ⇒ لا تعديلَ ثانٍ", async () => {
    await clear();
    const orderId = await seedOrder();
    const auditId = await escalate(orderId, "8861");
    await setStatus(orderId, "in_progress");
    const h = harness();
    await closeEscalationCards(cityId as CityId, h.deps);
    await setStatus(orderId, "cancelled", "driver_cancelled");
    await closeEscalationCards(cityId as CityId, h.deps);
    expect(h.edits.map((e) => e.text.split(":")[0])).toEqual(["assigned"]);
    expect((await closure(auditId))?.outcome).toBe("assigned");
  });

  it("الجدولُ مغلقٌ على anon وauthenticated", async () => {
    const [row] = await sql<{ anon: boolean; auth: boolean; rls: boolean }[]>`
      select has_table_privilege('anon', 'escalation_card_closures', 'select') as anon,
             has_table_privilege('authenticated', 'escalation_card_closures', 'select') as auth,
             relrowsecurity as rls
        from pg_class where relname = 'escalation_card_closures'`;
    expect(row).toEqual({ anon: false, auth: false, rls: true });
  });
});
