/**
 * الغرض: `I1` (`ADR 0286`) — تعزيزُ إثباتِ قيدِ الإسنادِ الأحاديِّ **بانحدارٍ متزامنٍ
 *   يثبتُ التداخلَ ولا يفترضُهُ**: سائقٌ واحدٌ يطالبُ **طلبَينِ مختلفَينِ** في
 *   اللحظةِ نفسِها. السباقُ نفسُهُ موجودٌ في `driver-single-engaged-order.test.ts`
 *   لكن بلا إثباتِ تداخلٍ (وعدانِ معًا فقط) وبجولةٍ واحدةٍ وبكتابةٍ مباشرةٍ
 *   تسلسليةٍ؛ و`i1-decide-settle-guards` يُثبتُ الرفضَ تسلسليًّا في الكاتبينِ
 *   الآخرينِ، و`wr-24-concurrent-races` يغطّي السباقاتِ الباقيةَ (السائقُ نفسُهُ
 *   على الطلبِ نفسِهِ، القبولُ مقابلَ الإلغاءِ والانتهاءِ). **الجديدُ هنا:**
 *   إثباتُ التداخلِ نفسِهِ (لا مجردِ إطلاقٍ متزامنٍ)، وجولاتٌ متكررةٌ، وجدارُ
 *   الفهرسِ بكتابةٍ مباشرةٍ **متزامنةٍ**، واستعلاماتٌ مستقلةٌ بعدَ الحملِ،
 *   وارتباطُ الملفِ بتجربةِ الإزالةِ (أدلةُ المرحلةِ 3): إزالةُ الفهرسِ أو
 *   حارسِ `claim_ride` **تفشلانِ هذا الملفَّ عمدًا**.
 *
 *   والمدَّعى أربعةٌ:
 *   (١) سائقٌ واحدٌ يطالبُ طلبَينِ مختلفَينِ معًا: إسنادٌ واحدٌ يفوزُ، والخاسرُ
 *       يُرَدُّ **رمزًا نظيفًا مقصودًا** (`DRIVER_HAS_ACTIVE_ORDER`) لا اصطدامًا خامًا
 *       بالفهرسِ — ولا شيءَ ينكسرُ: الطلبُ الخاسرُ باقٍ يبحثُ **وعرضُهُ باقٍ
 *       معلَّقًا بذاتِهِ** لا مرشَّحَ ولا أثرَ قبولٍ جزئيًّا.
 *   (٢) طلبٌ واحدٌ بسائقَينِ معًا: إسنادٌ واحدٌ وخاسرٌ صريحٌ، والحالةُ متسقةٌ.
 *   (٣) **جدارُ القاعدةِ نفسِهِ** (الفهرسُ الجزئيُّ الفريدُ `orders_one_engaged_order_per_driver`):
 *       كتابتانِ مباشرتانِ متزامنتانِ — خارجَ الدوالِّ المحروسةِ كليًّا — تصطدمُ
 *       إحداهما بالفهرسِ (23505 **باسمِ القيدِ نفسِهِ**) ولا تمرَّانِ معًا.
 *   (٤) صفرُ سائقينَ ملتزمينَ بأكثرَ منَ التزامٍ واحدٍ في كلِّ جولةٍ وقبلَ التنظيفِ
 *       وبعدَ الحملِ كلِّهِ — لا مخالفةً عابرةً تُخفيها نهايةٌ نظيفة.
 *
 *   **والتداخلُ مُثبَتٌ لا مُفترَضٌ — بقفلِ تحكُّمٍ**: في السباقينِ (١) و(٣) يمسكُ
 *   اتصالُ تحكُّمٍ ثالثٌ الصفَّ الذي لا بُدَّ لكلِّ متنافسٍ من المرورِ بهِ
 *   (صفُّ السائقِ في المطالباتِ، وصفَّا الطلبَينِ في الكتابةِ المباشرةِ)، ثم
 *   تُطلَقُ النداءانِ على اتصالَينِ مستقلَّينِ، ثم يُنتظرُ — بمهلةٍ معلنةٍ تُفشلِ
 *   الاختبارَ صريحًا إن لم تتحققْ — أن يظهرَ **الاثنانِ معًا** في نشاطِ القاعدةِ
 *   محجوبَينِ عن قفلِ التحكُّمِ. فحينها فقطَ يُحرَّرُ القفلُ وينطلقانِ من تداخلٍ
 *   مقيسٍ لا من ظنِّ وعودٍ. وسباقُ (٢) — حيثُ `skip locked` يجعلُ الخاسرَ يعودُ
 *   فورًا — يكتفي بحاجزِ علاماتٍ مُلتزَمةٍ (كلُّ طرفٍ يعلِّمُ ثمَّ ينتظرُ علامةَ
 *   الطرفِ الآخرِ) لإطلاقٍ متزامنٍ.
 *
 * الحالة: اختبار تكاملٍ — يتطلب TEST_DATABASE_URL (قاعدة PostgreSQL بها الهجراتُ
 *   مطبَّقةً بما فيها `20261016120000_i1_driver_single_engaged_order`).
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: بوابةُ `I1` في جولاتِ السعةِ، وتجربةُ إزالةِ الحارسِ
 *   (قاعدةٌ مؤقتةٌ مستقلةٌ: أزلِ الفهرسَ أو الحارسَ فيفشلُ هذا الملفُّ عمدًا).
 * ملاحظات مستقبلية: إن أُضيفَ كاتبُ إسنادٍ رابعٌ فليُضَفْ سباقُهُ هنا في المصفوفةَ
 *   نفسِها (كاتبٌ ← حارسٌ ← سباقٌ ← دليلُ إزالةٍ).
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn("⚠️  سباقاتُ I1 المتزامنةُ مُتخطّاة: عيّن TEST_DATABASE_URL.");
}

const MARK = "i1-races";
const RIDER_TG = 900_031_101;
const DRIVER_TGS = [900_031_201, 900_031_202] as const;
const ROUNDS = 6;

type Json = Record<string, unknown>;

describeIf("I1 — سائقٌ واحدٌ لا التزامَين: سباقاتٌ متزامنةٌ على قاعدةٍ حقيقيّة", () => {
  let sql: Sql;
  /** اتّصالٌ مستقلٌّ لكلِّ طرفٍ متسابق. */
  let lanes: Sql[] = [];
  /** اتصالُ التحكُّمِ: يمسكُ قفلًا يُثبتُ بهِ تداخلَ المتنافسَينِ. */
  let control: Sql;
  let cityId = "";
  let riderId = "";
  let drivers: string[] = [];

  async function purge(): Promise<void> {
    const tgs = [RIDER_TG, ...DRIVER_TGS];
    const users = sql`select id from users where telegram_id in ${sql(tgs)}`;
    const orders = sql`select id from orders where rider_id in (select id from riders where user_id in (${users}))`;
    await sql`delete from notification_outbox where order_id in (${orders})`;
    await sql`delete from audit_log where entity_id in (${orders})`;
    await sql`update orders set candidate_offer_id = null, candidate_driver_id = null where id in (${orders})`;
    await sql`delete from order_offers where order_id in (${orders})`;
    await sql`delete from orders where id in (${orders})`;
    await sql`delete from notification_outbox where recipient_user_id in (${users})`;
    await sql`delete from audit_log where actor_user_id in (${users})`;
    await sql`delete from drivers where user_id in (${users})`;
    await sql`delete from riders where user_id in (${users})`;
    await sql`delete from users where telegram_id in ${sql(tgs)}`;
    await sql`delete from i1_race_gate`;
  }

  async function user(tg: number, role: string): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      insert into users (city_id, telegram_id, full_name, language_code, role)
      values (${cityId}::uuid, ${tg}, ${`${MARK}-${tg}`}, 'ar', ${role}) returning id`;
    return rows[0]?.id as string;
  }

  /** طلبٌ جديدٌ «يبحث» وعرضٌ معلَّقٌ لكلِّ سائقٍ مُعطى. */
  async function freshOrder(
    offered: readonly string[],
    expiresIn = "45 seconds",
  ): Promise<{ orderId: string; offers: Map<string, string> }> {
    // `I1` (`ADR 0286`): تبدأ كلُّ جولةٍ منَ الحالةِ الابتدائيّةِ الخاليةِ — تُنهى
    // التزاماتُ السائقينَ المعروضينَ القائمةُ (تنظيفُ SQL موجَّهٌ لا تعطيلُ الحارسِ)،
    // وإلا ورثت الجولةُ التزامًا من سابقتِها فاختُبرَ غيرَ المقصودِ.
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

  /**
   * حاجزُ العلاماتِ (لسباقِ الطلبِ الواحدِ حيثُ `skip locked` يعيدُ الخاسرَ فورًا):
   * كلُّ طرفٍ يعلِّمُ جولتَهُ ثمَّ ينتظرُ علامةَ الطرفِ الآخرِ المُلتزَمةَ قبلَ
   * الانطلاقِ — إطلاقٌ متزامنٌ مثبَتٌ بالعلاماتِ.
   */
  async function gate(lane: Sql, self: number, other: number, round: number): Promise<void> {
    await lane`insert into i1_race_gate (lane, round) values (${self}, ${round})`;
    for (let i = 0; i < 400; i += 1) {
      const rows = await lane<{ n: number }[]>`
        select count(*)::int as n from i1_race_gate where lane = ${other} and round = ${round}`;
      if ((rows[0]?.n ?? 0) > 0) return;
      await lane`select pg_sleep(0.005)`;
    }
    throw new Error("حاجزُ الانطلاقِ لم يكتمل: الطرفُ الآخرُ لم يعلِّمْ جولتَهُ");
  }

  async function claimOn(lane: Sql, orderId: string, driverId: string): Promise<Json> {
    const rows = await lane<{ r: Json }[]>`
      select claim_ride(${orderId}::uuid, ${driverId}::uuid) as r`;
    return rows[0]?.r as Json;
  }

  /** كتابةُ إسنادٍ مباشرةٌ خارجَ الدوالِّ كلِّها — لاختبارِ جدارِ الفهرسِ وحدَهُ. */
  async function directAssignOn(lane: Sql, orderId: string, driverId: string): Promise<number> {
    const rows = await lane<{ n: number }[]>`
      update orders set status = 'matched', assigned_driver_id = ${driverId}::uuid,
             matched_at = now()
       where id = ${orderId}::uuid and status = 'searching' returning id`;
    return rows.length;
  }

  /**
   * إثباتُ التداخلِ بقفلِ تحكُّمٍ: معاملةٌ صريحةٌ (`begin`/`commit`) على اتصالِ التحكُّمِ
   * يمسكُ فيها `lockHolder` الصفوفَ التي لا بُدَّ للمتنافسَينِ منَ المرورِ بها، ثمّ
   * يُطلقُ `fire` النداءَينِ **منَ المستوى الأعلى** — الوعودُ غيرُ المنتظرةِ داخلَ
   * معاملةِ `begin` لا تنطلقُ أصلًا (درسٌ من هذه الجولةِ) — ثم يُنتظرُ — بمهلةٍ
   * تُفشِلُ الاختبارَ صريحًا — ظهورُ `needed` جلسةً محجوبةً عن قفلِ التحكُّمِ في
   * نشاطِ القاعدةِ (يُستعلمُ منَ الاتصالِ الرئيسيِّ لا من اتصالِ التحكُّمِ). حينها
   * فقط يُحرَّرُ القفلُ (`commit`) ويُعادُ الوعدانِ — فقد انطلقا منَ تداخلٍ مقيسٍ
   * لا من ظنِّ وعودٍ.
   */
  async function raceUnderControlLock<T>(
    lockHolder: (ctrl: Sql) => Promise<unknown>,
    fire: () => [Promise<T>, Promise<T>],
    needed: number,
  ): Promise<[T, T]> {
    await control`begin`;
    let fired: [Promise<T>, Promise<T>];
    try {
      await lockHolder(control);
      fired = fire();
      let blocked = 0;
      for (let i = 0; i < 600; i += 1) {
        const rows = await sql<{ n: number }[]>`
          select count(*)::int as n from pg_stat_activity
           where wait_event_type = 'Lock'
             and pid = any(${lanePids}::int[])`;
        blocked = rows[0]?.n ?? 0;
        if (blocked >= needed) break;
        await sql`select pg_sleep(0.005)`;
      }
      if (blocked < needed) {
        throw new Error(
          `لم يثبتِ التداخلُ: انتُظرَ ${needed} جلسةً محجوبةً عن قفلِ التحكُّمِ ولم يظهرْ سوى ${blocked}`,
        );
      }
    } finally {
      await control`commit`;
    }
    return Promise.all(fired) as Promise<[T, T]>;
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

  /** الثوابتُ التي لا يكسرُها أيُّ ترتيبٍ: عرضٌ مقبولٌ واحدٌ على الأكثر. */
  function expectCoherent(state: Awaited<ReturnType<typeof settled>>): void {
    const accepted = state.offers.filter((o) => o.status === "accepted");
    expect(accepted.length).toBeLessThanOrEqual(1);
    if (state.status === "matched") {
      expect(state.assigned).not.toBeNull();
      expect(accepted.map((o) => o.driver_id)).toEqual([state.assigned as string]);
      expect(state.offers.filter((o) => o.status === "pending")).toHaveLength(0);
      expect(state.candidate).toBeNull();
    }
    if (state.status === "searching") {
      expect(state.assigned).toBeNull();
      expect(accepted).toHaveLength(0);
      expect(state.candidate).toBeNull();
    }
  }

  /** صفرُ سائقينَ يظهرونَ ملتزمينَ بأكثرَ منَ التزامٍ واحدٍ — بعدَ كلِّ سباقٍ. */
  async function engagedDuplicates(): Promise<number> {
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from (
        select assigned_driver_id
          from orders
         where assigned_driver_id is not null
           and is_driver_engaged_order_status(status)
         group by assigned_driver_id
        having count(*) > 1
      ) as duplicates`;
    return Number(rows[0]?.count ?? "0");
  }

  /** معرّفُ جلسةِ كلِّ مسارٍ — يُعدُّ بها المحجوبُ حصرًا (لا نمطًا نصيًّا قد يلتقطَ غيرَها). */
  const lanePids: number[] = [];

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL as string });
    lanes = [0, 1].map(() => createSql({ connectionString: DATABASE_URL as string, max: 1 }));
    control = createSql({ connectionString: DATABASE_URL as string, max: 1 });
    for (const lane of lanes) {
      await lane`select 1`; // تسخينُ الاتصالِ ثمَّ قراءةُ معرّفِ جلستِهِ
      const row = (await lane<{ p: number }[]>`select pg_backend_pid() as p`)[0];
      if (row === undefined) throw new Error("تعذّرَ قراءةُ معرّفِ جلسةِ المسارِ");
      lanePids.push(row.p);
    }
    const city = (
      await sql<{ id: string }[]>`select id from cities order by created_at limit 1`
    )[0];
    if (city === undefined) throw new Error("لا مدينةَ في القاعدة");
    cityId = city.id;
    await sql`
      create table if not exists i1_race_gate (
        lane integer not null,
        round integer not null,
        marked_at timestamptz not null default now(),
        primary key (lane, round)
      )`;
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

  afterAll(async () => {
    if (sql === undefined) return;
    await purge();
    await sql`drop table if exists i1_race_gate`;
    await Promise.all(lanes.map((lane) => lane.end({ timeout: 5 })));
    await control.end({ timeout: 5 });
    await sql.end();
  });

  it("١ — سائقٌ واحدٌ يطالبُ طلبَينِ مختلفَينِ معًا: إسنادٌ واحدٌ وخاسرٌ نظيفٌ DRIVER_HAS_ACTIVE_ORDER", async () => {
    const [a] = drivers as [string];
    for (let round = 0; round < ROUNDS; round += 1) {
      const first = await freshOrder([a]);
      const second = await freshOrder([a]);
      // قفلُ صفِّ السائقِ في اتصالِ تحكُّمٍ، والمطالبتانِ تنطلقانِ معًا وتُحجَبانِ
      // عنهُ معًا — التداخلُ مقيسٌ من نشاطِ القاعدةِ — ثم يُحرَّرُ القفلُ.
      const [r1, r2] = await raceUnderControlLock(
        (tx) => tx`select id from drivers where id = ${a}::uuid for update`,
        () => [
          claimOn(lanes[0] as Sql, first.orderId, a),
          claimOn(lanes[1] as Sql, second.orderId, a),
        ],
        2,
      );
      // إسنادٌ واحدٌ بالضبطِ: فائزٌ واحدٌ وخاسرٌ واحدٌ برمزٍ مقصودٍ نظيفٍ — لا
      // اصطدامٍ خامٍ بالفهرسِ (الرفضُ قيمةُ إرجاعٍ لا استثناءٌ مُلقىً).
      const winners = [r1, r2].filter((r) => r.ok === true);
      const losers = [r1, r2].filter((r) => r.ok !== true);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]).toMatchObject({ ok: false, error: "DRIVER_HAS_ACTIVE_ORDER" });
      // والخاسرُ لم يُكسِرْ شيئًا: طلبُهُ باقٍ يبحثُ، وعرضُهُ هو باقٍ **معلَّقًا بذاتِهِ**،
      // ولا مرشَّحَ معلَّقًا ولا أثرَ قبولٍ جزئيًّا.
      const winnerState = await settled(r1.ok === true ? first.orderId : second.orderId);
      const loserState = await settled(r1.ok === true ? second.orderId : first.orderId);
      expect(winnerState).toMatchObject({ status: "matched", assigned: a, claimedAudits: 1 });
      expectCoherent(winnerState);
      expect(loserState).toMatchObject({ status: "searching", assigned: null });
      expectCoherent(loserState);
      expect(loserState.offers).toHaveLength(1);
      expect(loserState.offers[0]).toMatchObject({ driver_id: a, status: "pending" });
      // القيدُ يُفحصُ بعدَ كلِّ سباقٍ وقبلَ أيِّ تنظيفٍ — لا مخالفةً عابرةً.
      expect(await engagedDuplicates()).toBe(0);
      await sql`delete from i1_race_gate where round = ${round}`;
    }
  });

  it("٢ — طلبٌ واحدٌ بسائقَينِ معًا: إسنادٌ واحدٌ وخاسرٌ صريحٌ ولا ثاني", async () => {
    const [a, b] = drivers as [string, string];
    for (let round = 0; round < ROUNDS; round += 1) {
      const { orderId } = await freshOrder([a, b]);
      const race = Promise.all([
        (async () => {
          await gate(lanes[0] as Sql, 0, 1, round);
          return claimOn(lanes[0] as Sql, orderId, a);
        })(),
        (async () => {
          await gate(lanes[1] as Sql, 1, 0, round);
          return claimOn(lanes[1] as Sql, orderId, b);
        })(),
      ]);
      const [ra, rb] = await race;
      const winners = [ra, rb].filter((r) => r.ok === true);
      expect(winners).toHaveLength(1);
      const state = await settled(orderId);
      expect(state.status).toBe("matched");
      expect(state.assigned).toBe((winners[0]?.driver_id as string | undefined) ?? null);
      expect(state.claimedAudits).toBe(1);
      expectCoherent(state);
      expect(await engagedDuplicates()).toBe(0);
      await sql`delete from i1_race_gate where round = ${round}`;
    }
  });

  it("٣ — جدارُ القاعدةِ نفسِهِ: كتابتانِ مباشرتانِ متزامنتانِ للسائقِ نفسِهِ تصطدمُ بالفهرسِ", async () => {
    const [a] = drivers as [string];
    for (let round = 0; round < ROUNDS; round += 1) {
      const first = await freshOrder([a]);
      const second = await freshOrder([a]);
      // قفلُ صفَّي الطلبَينِ معًا في اتصالِ التحكُّمِ: الكتابتانِ تنطلقانِ وتُحجَبانِ
      // كلٌّ عن صفِّها معًا — تداخلٌ مقيسٌ — ثم يُحرَّرُ القفلُ فيتسابقانِ على الفهرسِ.
      const outcome = await raceUnderControlLock(
        (tx) =>
          tx`select id from orders where id in (${first.orderId}::uuid, ${second.orderId}::uuid) for update`,
        () => [
          directAssignOn(lanes[0] as Sql, first.orderId, a).then(
            (n) => ({ ok: true as const, n }) as const,
            (error: unknown) => ({ ok: false as const, error }) as const,
          ),
          directAssignOn(lanes[1] as Sql, second.orderId, a).then(
            (n) => ({ ok: true as const, n }) as const,
            (error: unknown) => ({ ok: false as const, error }) as const,
          ),
        ],
        2,
      );
      const [r1, r2] = outcome as [
        { ok: true; n: number } | { ok: false; error: unknown },
        { ok: true; n: number } | { ok: false; error: unknown },
      ];
      // واحدةٌ تنجحُ وواحدةٌ تصطدمُ بالفهرسِ (23505 **باسمِ القيدِ نفسِهِ**) — الجدارُ
      // الأخيرُ يعملُ حتى لو أفلتَ الكاتبُ من كلِّ حارسٍ في الدوالِّ. هذا الاختبارُ هو
      // الذي يفشلُ بإزالةِ الفهرسِ في تجربةِ الإزالةِ الموثَّقةِ في أدلةِ المرحلةِ 3.
      const fulfilled = [r1, r2].filter((r) => r.ok);
      const rejected = [r1, r2].filter((r) => !r.ok);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = (rejected[0] as { ok: false; error: unknown }).error as {
        code?: string;
        message?: string;
      };
      expect(reason?.code).toBe("23505");
      expect(String(reason?.message ?? "")).toContain("orders_one_engaged_order_per_driver");
      // والخاسرةُ لم تُكسِرْ شيئًا: طلبُها باقٍ يبحثُ بلا إسنادٍ.
      const winnerOrder = r1.ok ? first.orderId : second.orderId;
      const loserOrder = r1.ok ? second.orderId : first.orderId;
      const winnerState = await settled(winnerOrder);
      const loserState = await settled(loserOrder);
      expect(winnerState).toMatchObject({ status: "matched", assigned: a });
      expect(loserState).toMatchObject({ status: "searching", assigned: null });
      // القيدُ بعدَ كلِّ سباقٍ وقبلَ التنظيفِ.
      expect(await engagedDuplicates()).toBe(0);
      await sql`delete from i1_race_gate where round = ${round}`;
    }
  });

  it("٤ — بعدَ الحملِ: استعلاماتٌ مستقلةٌ — صفرُ التزاماتٍ مزدوجةٍ في القاعدةِ كلِّها", async () => {
    // استعلامٌ مستقلٌّ عن مساراتِ الاختبارِ نفسِها: المجموعةُ الكاملةُ من القاعدةِ،
    // فورَ انتهاءِ السباقاتِ وقبلَ أيِّ تنظيفٍ — لا مخالفةً عابرةً تُخفيها نهايةٌ نظيفة.
    expect(await engagedDuplicates()).toBe(0);
    // وسؤالٌ ثانٍ بصيغةٍ مختلفةٍ: أيُّ سائقٍ يظهرُ في أكثرَ من طلبٍ محميِّ الحالةِ؟
    const offenders = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select o.assigned_driver_id, o.status, count(*) over (partition by o.assigned_driver_id) as c
          from orders o
         where o.assigned_driver_id is not null
           and o.status in ('matched', 'in_progress')
      ) s where s.c > 1`;
    expect(offenders[0]?.n ?? 1).toBe(0);
    // ورابعٌ على مستوى العروضِ (بندُ «عدمِ قبولِ أكثرَ من عرضٍ للطلبِ نفسِه»):
    // لا طلبَ ينتهي بأكثرَ من عرضٍ واحدٍ مقبولٍ — في القاعدةِ كلِّها، استعلامًا
    // مستقلًّا عن مساراتِ الاختبارِ، لا منَ عدمِ ظهورِ خطأٍ فحسب.
    const multiAccepted = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select order_id from order_offers
         where status = 'accepted'
         group by order_id
        having count(*) > 1
      ) as m`;
    expect(multiAccepted[0]?.n ?? 1).toBe(0);
    // وثالثٌ مرتبطٌ بهويةِ هذه الجولةِ نفسِها: سائقوها هم تحديدًا بلا التزامٍ مزدوجٍ.
    const scoped = await sql<{ n: number }[]>`
      select count(*)::int as n from (
        select o.assigned_driver_id
          from orders o
         where o.assigned_driver_id = any(${drivers}::uuid[])
           and is_driver_engaged_order_status(o.status)
         group by o.assigned_driver_id
        having count(*) > 1
      ) as d`;
    expect(scoped[0]?.n ?? 1).toBe(0);
    // ثم تنظيفُ SQL موجَّهٌ يُنهي التزاماتِ سائقي الجولةِ (ليس إتمامًا عبرَ المسارِ
    // الأعماليِّ — ذاكَ يُقاسُ في اختباراتِ الدورةِ الكاملةِ)، فلا يبقى لهم التزامٌ
    // قائمٌ بعده — لا شيءَ يرشحُ من هويةِ الملفِّ.
    await sql`
      update orders set status = 'completed', completed_at = now()
       where assigned_driver_id = any(${drivers}::uuid[])
         and is_driver_engaged_order_status(status)`;
    const residual = await sql<{ n: number }[]>`
      select count(*)::int as n from orders o
       where o.assigned_driver_id = any(${drivers}::uuid[])
         and is_driver_engaged_order_status(o.status)`;
    expect(residual[0]?.n ?? 1).toBe(0);
  });
});
