/**
 * الغرض: `WR-24` (ORDER §24) على PostgreSQL حقيقيٍّ — **سباقاتٌ متزامنةٌ** لا تسلسل: كلُّ طرفٍ
 *   على اتّصالٍ مستقلٍّ (`max: 1`) والنداءاتُ تنطلقُ معًا بـ`Promise.all`، وكلُّ سباقٍ يُعادُ
 *   جولاتٍ على طلبٍ جديدٍ في كلِّ جولة. والحكمُ على **ما استقرَّ في القاعدة** لا على ترتيبِ الوعود:
 *   الحالةُ النهائيّةُ يجبُ أن تطابقَ ترتيبًا تسلسليًّا واحدًا للنداءات، بلا إسنادٍ مزدوجٍ ولا عرضٍ
 *   مقبولٍ لطلبٍ ملغى ولا مرشَّحٍ عالقٍ ولا إشعارٍ مكرَّر.
 *
 *   ١ ثلاثةُ سائقين يقبلونَ العرضَ معًا (البوت `claim_ride` وMini App `driver_accept_offer`).
 *   ٢ السائقُ نفسُه يقبلُ من البوتِ وMini App معًا.
 *   ٣ قبولُ السائقِ مقابلَ إلغاءِ الراكب.
 *   ٤ انتهاءُ مهلةِ العرضِ (`expire_stale_offers`) لحظةَ القبول.
 *   ٥ عدّةُ مرشَّحين بانتظارِ قرارِ الراكب (`WR-09`)، وقرارُ الراكبِ مقابلَ انتهاءِ مهلةِ المرشَّح
 *     ومقابلَ إلغائه.
 *   ٦ عاملانِ يلتقطانِ صندوقَ الصادرِ معًا (إعادةُ العامل)، وإيداعُ إشعارِ الطورِ نفسِه معًا.
 *   ٧ العرضُ في القروبِ (اتفاقُ غيرِ المشترك) وفي البوتِ معًا، ومعَ مرشَّحٍ محجوزٍ للراكب.
 *
 * الحالة: اختبار تكاملٍ — يُتخطّى بلا `TEST_DATABASE_URL`.
 * ينتمي إلى: tests/integration
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  سباقاتُ WR-24 مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

const MARK = "wr24-races";
const RIDER_TG = 900_024_101;
const DRIVER_TGS = [900_024_201, 900_024_202, 900_024_203] as const;
const ROUNDS = 6;

type Json = Record<string, unknown>;

describeIf("WR-24 — سباقاتٌ متزامنةٌ على قاعدةٍ حقيقيّة", () => {
  let sql: Sql;
  /** اتّصالٌ مستقلٌّ لكلِّ طرفٍ متسابق. */
  let lanes: Sql[] = [];
  let cityId = "";
  let previousWindow: unknown = null;
  let riderId = "";
  let drivers: string[] = [];

  async function purge(): Promise<void> {
    const tgs = [RIDER_TG, ...DRIVER_TGS];
    const users = sql`select id from users where telegram_id in ${sql(tgs)}`;
    const orders = sql`select id from orders where rider_id in (select id from riders where user_id in (${users}))`;
    await sql`delete from notification_outbox where order_id in (${orders})`;
    await sql`delete from audit_log where entity_id in (${orders})`;
    await sql`update orders set candidate_offer_id = null, candidate_driver_id = null where id in (${orders})`;
    await sql`delete from unsubscribed_negotiations where order_id in (${orders})`;
    await sql`delete from unsubscribed_claims where order_id in (${orders})`;
    await sql`delete from order_offers where order_id in (${orders})`;
    await sql`delete from orders where id in (${orders})`;
    await sql`delete from notification_outbox where recipient_user_id in (${users})`;
    await sql`delete from audit_log where actor_user_id in (${users})`;
    await sql`delete from drivers where user_id in (${users})`;
    await sql`delete from riders where user_id in (${users})`;
    await sql`delete from users where telegram_id in ${sql(tgs)}`;
  }

  async function user(tg: number, role: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${tg}, ${`${MARK}-${tg}`}, 'ar', ${role}) returning id`;
    return rows[0]?.id as string;
  }

  async function setWindow(seconds: number): Promise<void> {
    await sql`
      update platform_settings set value = to_jsonb(${seconds}::int)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
  }

  /** طلبٌ جديدٌ «يبحث» وعرضٌ معلَّقٌ لكلِّ سائقٍ مُعطى. */
  async function freshOrder(
    offered: readonly string[],
    expiresIn = "45 seconds",
  ): Promise<{ orderId: string; offers: Map<string, string> }> {
    // `I1` (`ADR 0286`): السائقُ لا يحملُ التزامًا ثانيًا — وجولاتُ هذا الملفِ
    // وجولاتُ من سبقَهُ تُبقي السائقَ الفائزَ مشغولًا. فتُنهى التزاماتُ السائقينَ
    // المعروضينَ قبلَ كلِّ جولةٍ — هذا هو إتمامُ رحلاتِهم لا تعطيلُ الحارسِ.
    await sql`
      update orders set status = 'completed', completed_at = now()
       where assigned_driver_id = any(${offered}::uuid[])
         and is_driver_engaged_order_status(status)`;
    const orderId = (
      await sql<{ id: string }[]>`
        insert into orders (city_id, rider_id, service, status, pickup)
        values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching',
                st_setsrid(st_makepoint(39.17, 21.54), 4326))
        returning id`
    )[0]?.id as string;
    const offers = new Map<string, string>();
    for (const driverId of offered) {
      const row = await sql<{ id: string }[]>`
        insert into order_offers (city_id, order_id, driver_id, round, status, expires_at)
        values (${cityId}::uuid, ${orderId}::uuid, ${driverId}::uuid, 1, 'pending',
                now() + ${expiresIn}::interval)
        returning id`;
      offers.set(driverId, row[0]?.id as string);
    }
    return { orderId, offers };
  }

  async function claimOn(lane: Sql, orderId: string, driverId: string): Promise<Json> {
    const rows = await lane<{ r: Json }[]>`
      select claim_ride(${orderId}::uuid, ${driverId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  async function acceptOn(lane: Sql, tg: number, offerId: string): Promise<Json> {
    const rows = await lane<{ r: Json }[]>`
      select driver_accept_offer(${tg}, ${offerId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  async function cancelOn(lane: Sql, orderId: string): Promise<Json> {
    const rows = await lane<{ r: Json }[]>`
      select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid, 'wr24-race') as r`;
    return rows[0]?.r as Json;
  }

  async function decideOn(lane: Sql, orderId: string, driverId: string): Promise<Json> {
    const rows = await lane<{ r: Json }[]>`
      select rider_decide_candidate(${RIDER_TG}, ${orderId}::uuid, ${driverId}::uuid, true) as r`;
    return rows[0]?.r as Json;
  }

  async function settled(orderId: string): Promise<{
    status: string;
    assigned: string | null;
    candidate: string | null;
    offers: { driver_id: string; status: string }[];
    claimedAudits: number;
  }> {
    const order = (
      await sql<{ status: string; assigned: string | null; candidate: string | null }[]>`
        select status::text, assigned_driver_id::text as assigned,
               candidate_driver_id::text as candidate
          from orders where id = ${orderId}::uuid`
    )[0];
    if (order === undefined) throw new Error("الطلبُ غائب");
    const offers = await sql<{ driver_id: string; status: string }[]>`
      select driver_id::text, status::text from order_offers where order_id = ${orderId}::uuid`;
    const audits = await sql<{ n: number }[]>`
      select count(*)::int as n from audit_log
       where entity_id = ${orderId}::uuid and action = 'order.claimed'`;
    return { ...order, offers, claimedAudits: audits[0]?.n ?? 0 };
  }

  /** الثوابتُ التي لا يكسرُها أيُّ ترتيبٍ: عرضٌ مقبولٌ واحدٌ على الأكثر، وهو للسائقِ المُسنَد. */
  function expectCoherent(state: Awaited<ReturnType<typeof settled>>): void {
    const accepted = state.offers.filter((o) => o.status === "accepted");
    expect(accepted.length).toBeLessThanOrEqual(1);
    if (state.status === "matched") {
      expect(state.assigned).not.toBeNull();
      expect(accepted.map((o) => o.driver_id)).toEqual([state.assigned as string]);
      expect(state.offers.filter((o) => o.status === "pending")).toHaveLength(0);
      expect(state.candidate).toBeNull();
    }
    if (state.status === "cancelled") {
      expect(state.offers.filter((o) => o.status === "pending")).toHaveLength(0);
      expect(state.candidate).toBeNull();
    }
    if (state.status === "searching") {
      expect(state.assigned).toBeNull();
      expect(accepted).toHaveLength(0);
    }
  }

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    lanes = [0, 1, 2, 3].map(() => createSql({ connectionString: DATABASE_URL as string, max: 1 }));
    const city = (
      await sql<{ id: string }[]>`select id from cities order by created_at limit 1`
    )[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدة");
    cityId = city.id;
    const prev = await sql<{ value: unknown }[]>`
      select value from platform_settings
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    if (prev[0] === undefined) throw new Error("الإعدادُ rider_choice_window_seconds غيرُ مبذور");
    previousWindow = prev[0].value;
    await purge();
    const riderUser = await user(RIDER_TG, "rider");
    riderId = (
      await sql<{ id: string }[]>`
        insert into riders (city_id, user_id) values (${cityId}::uuid, ${riderUser}::uuid) returning id`
    )[0]?.id as string;
    drivers = [];
    for (const [index, tg] of DRIVER_TGS.entries()) {
      const u = await user(tg, "driver");
      const row = await sql<{ id: string }[]>`
        insert into drivers (city_id, user_id, plate_number, vehicle_type)
        values (${cityId}::uuid, ${u}::uuid, ${`و ص ل ${index + 1}`}, 'sedan') returning id`;
      drivers.push(row[0]?.id as string);
    }
  });

  beforeEach(async () => {
    await setWindow(0);
  });

  afterAll(async () => {
    if (sql === undefined) return;
    await sql`
      update platform_settings set value = to_jsonb(${Number(previousWindow)}::int)
       where city_id = ${cityId}::uuid and key = 'rider_choice_window_seconds'`;
    await purge();
    await Promise.all(lanes.map((lane) => lane.end({ timeout: 5 })));
    await sql.end();
  });

  it("١ — ثلاثةُ سائقين يقبلونَ معًا من البوتِ وMini App: إسنادٌ واحدٌ وخاسرانِ صريحان", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const { orderId, offers } = await freshOrder(drivers);
      const [a, b, c] = drivers as [string, string, string];
      const results = await Promise.all([
        claimOn(lanes[0] as Sql, orderId, a),
        acceptOn(lanes[1] as Sql, DRIVER_TGS[1], offers.get(b) as string),
        claimOn(lanes[2] as Sql, orderId, c),
      ]);
      const winners = results.filter((r) => r.ok === true);
      expect(winners).toHaveLength(1);
      for (const loser of results.filter((r) => r.ok !== true)) {
        expect(String(loser.error)).toMatch(/ORDER_NOT_CLAIMABLE|OFFER_NOT_VALID/);
      }
      const state = await settled(orderId);
      expect(state.status).toBe("matched");
      expectCoherent(state);
      expect(state.offers.filter((o) => o.status === "cancelled")).toHaveLength(2);
      expect(state.claimedAudits).toBe(1);
    }
  });

  it("٢ — السائقُ نفسُه من البوتِ وMini App معًا: إسنادٌ واحدٌ، والثاني تكرارٌ لا «سبقك غيرُك»", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const [a] = drivers as [string];
      const { orderId, offers } = await freshOrder([a]);
      const [bot, app] = await Promise.all([
        claimOn(lanes[0] as Sql, orderId, a),
        acceptOn(lanes[1] as Sql, DRIVER_TGS[0], offers.get(a) as string),
      ]);
      const state = await settled(orderId);
      expect(state).toMatchObject({ status: "matched", assigned: a, claimedAudits: 1 });
      expectCoherent(state);
      // `skip locked`: الخاسرُ في اللحظةِ نفسِها قد يُرَدُّ «غيرَ قابلٍ للمطالبة» — لكنّه لا يُسنِدُ ثانيةً.
      expect([bot.ok, app.ok]).toContain(true);
      // والفائزُ يعيدُ الضغطَ بعدَ استقرارِ القفل: نجاحٌ مكرَّرٌ لا خسارة.
      expect(await claimOn(lanes[2] as Sql, orderId, a)).toMatchObject({
        ok: true,
        duplicate: true,
      });
    }
  });

  it("٣ — قبولُ السائقِ مقابلَ إلغاءِ الراكب: الحالةُ تطابقُ ترتيبًا تسلسليًّا واحدًا", async () => {
    const seen = new Set<string>();
    for (let round = 0; round < ROUNDS * 2; round++) {
      const [a, b] = drivers as [string, string];
      const { orderId } = await freshOrder([a, b]);
      const [claim, cancel] = await Promise.all([
        claimOn(lanes[0] as Sql, orderId, a),
        cancelOn(lanes[1] as Sql, orderId),
      ]);
      const state = await settled(orderId);
      expectCoherent(state);
      // الإلغاءُ يقبلُ «يبحث» و«أُسنِد»، فالإلغاءُ ينجحُ في الترتيبَين؛ والفرقُ في القبول.
      expect(cancel.ok).toBe(true);
      expect(state.status).toBe("cancelled");
      expect(state.offers.filter((o) => o.status === "pending")).toHaveLength(0);
      if (claim.ok === true) {
        // القبولُ أوّلًا ثمَّ الإلغاء: الإسنادُ سجلٌّ، والعرضُ المقبولُ لصاحبِه وحدَه.
        expect(state.assigned).toBe(a);
        expect(cancel.previous_status).toBe("matched");
        seen.add("claim-then-cancel");
      } else {
        // الإلغاءُ أوّلًا: لا إسنادَ ولا عرضَ مقبول.
        expect(state.assigned).toBeNull();
        expect(state.offers.filter((o) => o.status === "accepted")).toHaveLength(0);
        expect(state.claimedAudits).toBe(0);
        seen.add("cancel-then-claim");
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(1);
  });

  it("٤ — انتهاءُ مهلةِ العرضِ لحظةَ القبول: لا عرضَ «منتهٍ» لطلبٍ أُسنِدَ به، ولا قبولَ بعدَ الموعد", async () => {
    for (let round = 0; round < ROUNDS * 2; round++) {
      const [a] = drivers as [string];
      const { orderId, offers } = await freshOrder([a], "150 milliseconds");
      await Bun.sleep(140 + (round % 3) * 5);
      const [claim] = await Promise.all([
        claimOn(lanes[0] as Sql, orderId, a),
        (lanes[1] as Sql)`select expire_stale_offers()`,
      ]);
      const state = await settled(orderId);
      expectCoherent(state);
      const offer = state.offers[0];
      if (claim.ok === true) {
        expect(state.status).toBe("matched");
        expect(offer?.status).toBe("accepted");
        // المقارنةُ في القاعدةِ بدقّةِ الميكروثانية: `Date` يقطعُ إلى الملّيثانية فيتساوى
        // موعدانِ مختلفان (`claim_ride` يشترطُ `expires_at > v_now` ويكتبُ `matched_at = v_now`).
        const before = (
          await sql<{ before: boolean }[]>`
            select o.matched_at < f.expires_at as before
              from orders o join order_offers f on f.order_id = o.id
             where o.id = ${orderId}::uuid and f.id = ${offers.get(a) as string}::uuid`
        )[0];
        expect(before?.before).toBe(true);
      } else {
        expect(state.status).toBe("searching");
        expect(["expired", "pending"]).toContain(offer?.status as string);
      }
    }
  });

  it("٥أ — سائقانِ يقبلانِ معًا ونافذةُ الراكبِ مفتوحة: مرشَّحٌ واحدٌ، والآخرُ ORDER_HELD وعرضُه باقٍ", async () => {
    await setWindow(15);
    for (let round = 0; round < ROUNDS; round++) {
      const [a, b] = drivers as [string, string];
      const { orderId, offers } = await freshOrder([a, b]);
      const results = await Promise.all([
        claimOn(lanes[0] as Sql, orderId, a),
        claimOn(lanes[1] as Sql, orderId, b),
      ]);
      const held = results.filter((r) => r.ok === true);
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ pending_rider: true, duplicate: false });
      const state = await settled(orderId);
      expect(state.status).toBe("searching");
      expect(state.assigned).toBeNull();
      expect([a, b]).toContain(state.candidate as string);
      const loser = state.candidate === a ? b : a;
      expect(state.offers.find((o) => o.driver_id === loser)?.status).toBe("pending");
      const loserResult = results.find((r) => r.ok !== true) as Json;
      // `skip locked` قد يُجيبُ «غيرُ قابلٍ للمطالبة» في اللحظةِ نفسِها؛ وما بعدَها ORDER_HELD.
      expect(String(loserResult.error)).toMatch(/ORDER_HELD|ORDER_NOT_CLAIMABLE/);
      expect(await claimOn(lanes[2] as Sql, orderId, loser)).toMatchObject({
        ok: false,
        error: "ORDER_HELD",
      });
      const notices = await sql<{ n: number }[]>`
        select count(*)::int as n from notification_outbox
         where order_id = ${orderId}::uuid and kind = 'rider_trip_notice'`;
      expect(notices[0]?.n).toBe(1);
      void offers;
    }
  });

  it("٥ب — قرارُ الراكبِ مقابلَ انتهاءِ مهلةِ المرشَّحِ ومقابلَ إلغائه: مآلٌ واحدٌ وإشعارٌ واحدٌ للسائق", async () => {
    await setWindow(15);
    const outcomes = new Set<string>();
    for (let round = 0; round < ROUNDS * 2; round++) {
      const [a, b] = drivers as [string, string];
      const { orderId } = await freshOrder([a, b]);
      expect(await claimOn(sql, orderId, a)).toMatchObject({ ok: true, pending_rider: true });
      // الموعدُ يحلُّ الآن، فيتسابقُ القبولُ والشوطُ والإلغاء.
      await sql`update orders set candidate_expires_at = now() + interval '20 milliseconds' where id = ${orderId}::uuid`;
      await Bun.sleep(15 + (round % 3) * 3);
      const [decision, , cancel] = await Promise.all([
        decideOn(lanes[0] as Sql, orderId, a),
        (lanes[1] as Sql)`select expire_order_candidates(50)`,
        round % 2 === 0 ? cancelOn(lanes[2] as Sql, orderId) : Promise.resolve(null),
      ]);
      const state = await settled(orderId);
      expectCoherent(state);
      const notices = await sql<{ outcome: string }[]>`
        select payload->>'outcome' as outcome from notification_outbox
         where order_id = ${orderId}::uuid and kind = 'driver_candidate_notice'`;
      // للمرشَّحِ إشعارٌ واحدٌ بمآلِه، أيًّا كانَ الفائز.
      expect(notices).toHaveLength(1);
      if (decision.ok === true && decision.decision === "accepted") {
        // القبولُ أوّلًا: الإسنادُ للمرشَّح، وإلغاءٌ لاحقٌ (إن وقع) يُلغي الطلبَ المُسنَدَ ولا يمحو الإسناد.
        expect(state.assigned).toBe(a);
        expect(["matched", "cancelled"]).toContain(state.status);
        expect(notices[0]?.outcome).toBe("ACCEPTED");
      } else {
        // الشوطُ أو الإلغاءُ أوّلًا: لا إسنادَ، والمرشَّحُ محرَّرٌ بمآلٍ واحد.
        expect(state.assigned).toBeNull();
        expect(state.candidate).toBeNull();
        expect(state.offers.find((o) => o.driver_id === a)?.status).not.toBe("accepted");
        expect(["EXPIRED", "CANCELLED"]).toContain(notices[0]?.outcome as string);
      }
      if (cancel !== null) expect(cancel.ok).toBe(true);
      outcomes.add(`${state.status}:${notices[0]?.outcome}`);
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  });

  it("٦ — عاملانِ يلتقطانِ الصادرَ معًا وإيداعُ الطورِ نفسِه ثلاثًا معًا: لا صفَّ يُلتقطُ مرّتين ولا يُكرَّر", async () => {
    const [a] = drivers as [string];
    const { orderId } = await freshOrder([a]);
    expect(await claimOn(sql, orderId, a)).toMatchObject({ ok: true });
    const enqueued = await Promise.all(
      [0, 1, 2].map(
        (i) =>
          (lanes[i] as Sql)`select enqueue_rider_trip_notice(${orderId}::uuid, 'ARRIVED') as r`,
      ),
    );
    expect(enqueued).toHaveLength(3);
    const rows = await sql<{ id: string }[]>`
      select id::text from notification_outbox
       where order_id = ${orderId}::uuid and dedup_key = ${`rider_trip:${orderId}:ARRIVED`}`;
    expect(rows).toHaveLength(1);

    // صفوفُ هذا الطلبِ وحدَها مستحقّةٌ الآن؛ وما سواها يُؤجَّلُ ساعةً ثمَّ يُعادُ موعدُه حرفًا.
    const others = await sql<{ id: string; next_attempt_at: Date }[]>`
      select id::text, next_attempt_at from notification_outbox
       where status = 'pending' and (order_id is null or order_id <> ${orderId}::uuid)`;
    await sql`
      update notification_outbox set next_attempt_at = now() + interval '1 hour'
       where status = 'pending' and (order_id is null or order_id <> ${orderId}::uuid)`;
    try {
      await sql`
        update notification_outbox set next_attempt_at = now() - interval '1 second'
         where order_id = ${orderId}::uuid and status = 'pending'`;
      const pending = await sql<{ n: number }[]>`
        select count(*)::int as n from notification_outbox
         where order_id = ${orderId}::uuid and status = 'pending'`;
      const total = pending[0]?.n ?? 0;
      expect(total).toBeGreaterThan(0);
      const claimed: string[] = [];
      for (let pass = 0; pass < total + 2; pass++) {
        const batch = await Promise.all(
          lanes.map((lane) => lane<{ r: Json }[]>`select claim_notification_delivery() as r`),
        );
        for (const rows of batch) {
          const r = rows[0]?.r as Json;
          const delivery = r.delivery as Json | null;
          const id = delivery === null ? r.undeliverable : delivery.delivery_id;
          if (id !== undefined && id !== null) claimed.push(String(id));
        }
        // العاملُ يُنهي ما التقطَه بالدالّةِ نفسِها التي يستعملُها في الإنتاج.
        for (const rows of batch) {
          const delivery = ((rows[0] as { r: Json }).r as Json).delivery as Json | null;
          if (delivery === null) continue;
          await sql`
            select finish_notification_delivery(${String(delivery.delivery_id)}::uuid,
              ${String(delivery.claim_token)}::uuid, ${"wr24"}, true, null)`;
        }
      }
      // لا صفَّ التقطَه عاملان، وكلُّ صفٍّ التُقِط.
      expect(new Set(claimed).size).toBe(claimed.length);
      expect(claimed.length).toBe(total);
    } finally {
      for (const row of others) {
        await sql`update notification_outbox set next_attempt_at = ${row.next_attempt_at}
                   where id = ${row.id}::uuid`;
      }
    }
  });

  it("٧أ — اتفاقُ القروبِ واستلامُ البوتِ معًا: إسنادٌ واحدٌ، ولا عرضٌ معلَّقٌ ولا مسارا إسناد", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const [a, , c] = drivers as [string, string, string];
      // إتمامُ التزاماتِ طرفَيِ السباقِ قبلَ الجولةِ: `freshOrder` يُنهي التزاماتِ
      // المعروضِ لهم (a) فقط، والفائزُ بالسباقِ قد يكونُ مرشَّحَ الاتفاقِ (c) — فإن فازَ
      // الاتفاقُ جولةً بقي c مشغولًا وطلباتُه عندَ الراكبِ قائمة، فتفشلُ الجولةُ
      // التاليةُ من الطرفينِ معًا (ORDER_NOT_CLAIMABLE وDRIVER_HAS_ACTIVE_ORDER) رغمَ
      // أنّ العينَ واحدةٌ فعلًا — هشاشةٌ كشفتها موجةُ تغيّرِ توقيتِ الالتقاطِ،
      // فتُنهى التزاماتُ الطرفينِ قبلَ كلِّ جولةٍ كما يفعلُ `freshOrder` للمعروضِ لهم.
      await sql`
        update orders set status = 'completed', completed_at = now()
         where assigned_driver_id = any(${[a, c]}::uuid[])
           and is_driver_engaged_order_status(status)`;
      const { orderId } = await freshOrder([a]);
      const negotiation = await groupNegotiation(orderId, c);
      const [bot, group] = await Promise.all([
        claimOn(lanes[0] as Sql, orderId, a),
        (lanes[1] as Sql)<{ r: Json }[]>`
          select settle_unsubscribed_negotiation(${negotiation}::uuid) as r`.then(
          (r) => r[0]?.r as Json,
        ),
      ]);
      // تشخيصُ حالتِ «كلاهما فشل» (تحتَ الحملِ): أسبابُ الرفضِ لا تُبتلع.
      if (bot.ok !== true && group.ok !== true) {
        console.error(
          `WR24_7A_BOTH_FAILED bot=${JSON.stringify(bot)} group=${JSON.stringify(group)}`,
        );
      }
      expect([bot.ok, group.ok].filter((ok) => ok === true)).toHaveLength(1);
      const state = await settled(orderId);
      expect(state.status).toBe("matched");
      expect(state.candidate).toBeNull();
      expect(state.offers.filter((o) => o.status === "pending")).toHaveLength(0);
      if (group.ok === true) {
        expect(state.assigned).toBe(c);
        expect(state.offers.filter((o) => o.status === "accepted")).toHaveLength(0);
      } else {
        expectCoherent(state);
        expect(state.assigned).toBe(a);
      }
    }
  });

  it("٧ب — اتفاقُ القروبِ لا يتجاوزُ مرشَّحًا محجوزًا لقرارِ الراكب", async () => {
    await setWindow(15);
    const [a, , c] = drivers as [string, string, string];
    const { orderId } = await freshOrder([a]);
    const negotiation = await groupNegotiation(orderId, c);
    expect(await claimOn(sql, orderId, a)).toMatchObject({ ok: true, pending_rider: true });
    const settledGroup = (
      await sql<{ r: Json }[]>`select settle_unsubscribed_negotiation(${negotiation}::uuid) as r`
    )[0]?.r as Json;
    const state = await settled(orderId);
    // لا إسنادَ لسائقِ القروبِ والراكبُ ينظرُ في مرشَّحٍ آخر: يُرفَضُ الاتفاقُ ويبقى المرشَّحُ وعرضُه.
    expect(settledGroup).toMatchObject({ ok: false, error: "ORDER_HELD" });
    expect(state).toMatchObject({ status: "searching", assigned: null, candidate: a });
    expect(state.offers.find((o) => o.driver_id === a)?.status).toBe("pending");
  });

  async function groupNegotiation(orderId: string, driverId: string): Promise<string> {
    const neg = (
      await sql<{ id: string }[]>`
        insert into unsubscribed_negotiations (city_id, order_id, cycle, status, collect_deadline)
        values (${cityId}::uuid, ${orderId}::uuid, 1, 'collecting', now() + interval '1 minute')
        returning id`
    )[0]?.id as string;
    const claimId = (
      await sql<{ id: string }[]>`
        insert into unsubscribed_claims (city_id, negotiation_id, order_id, driver_id, position, opened_at)
        values (${cityId}::uuid, ${neg}::uuid, ${orderId}::uuid, ${driverId}::uuid, 1, now())
        returning id`
    )[0]?.id as string;
    await sql`
      update unsubscribed_negotiations
         set status = 'negotiating', active_claim_id = ${claimId}::uuid,
             negotiate_deadline = now() + interval '1 minute'
       where id = ${neg}::uuid`;
    return neg;
  }
});
