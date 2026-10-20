/**
 * الغرض: LOAD-01 · الدفعة 25 — سلوكُ حدِّ الشوطِ الفوريِّ (`IMMEDIATE_REDISPATCH_LIMIT`)
 *   على PostgreSQL حقيقيٍّ، لا قيمةُ الثابتِ وحدَها. القياسُ في ب24 أثبتَ أنَّ الدورةَ
 *   2.00s (نافذةُ الخفضِ) فسقفُ الخدمةِ الاسميُّ = الحدُّ ÷ 2s؛ وفرضيةُ ب25 أنَّ رفعَ الحدِّ
 *   يرفعُ هذا السقفَ. فقبلَ أيِّ قياسٍ يُثبَتُ أنَّ الحدَّ الجديدَ يعملُ كما يُفترَضُ وأنّه
 *   لا يكسرُ شيئًا:
 *
 *   ١. **عبرَ الحاويةِ الحقيقيّةِ** (`buildContainer` + أثرُ الشوطِ): شوطٌ فوريٌّ واحدٌ
 *      يفحصُ حتى 100 طلبٍ ولا يتجاوزُها، والأقدمُ أولًا (لا يُجوَّعُ القديمُ للأحدثِ)،
 *      والشوطُ الممتلئُ الحدِّ يُجدوِلُ لاحقًا بعدَ نافذةِ الخفضِ **بلا محفّزٍ خارجيٍّ**
 *      فيُخدَمُ ما تبقّى (لا يضيعُ مستحقٌّ). على الرأسِ المرجعِ (حدُّ 50) يفشلُ هذا
 *      الاختبارُ — وهو شاهدُ الفشلِ قبلَ التغييرِ.
 *   ٢. حارسُ `open_offer_round` الذرّيُّ يبقى فعّالًا داخلَ شوطٍ من 100 طلبٍ: جولةٌ تُفتحُ
 *      منَ اتصالٍ آخرَ أثناءَ الشوطِ، أو إلغاءٌ متزامنٌ، لا يُنتجانِ جولةً مكرّرةً أو غيرَ
 *      جائزةٍ — والطلبُ يُصنَّفُ سباقًا. والمواضعُ تقعُ بعدَ الحدِّ القديمِ (50) عمدًا.
 *   ٣. حدودُ دوراتِ البثِّ وأهليّةُ السائقِ داخلَ نافذةٍ من 100: المستنفدُ لا يُبثُّ
 *      ويُصنَّفُ مستنفدًا، والسائقُ غيرُ المتاحِ لا يُعرَضُ عليه شيءٌ، ولا إسنادَ يحدثُ
 *      منَ الشوطِ (الإسنادُ قبولٌ لا بثٌّ — `assigned_driver_id` يبقى فارغًا).
 *
 * الحالة: اختبار تكامل فعلي — يحتاج TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُتوقع أن يستخدمه لاحقاً: أي تعديل على حدِّ الشوطِ الفوريِّ أو جدولتِه.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContainer } from "../../apps/gateway/src/container.ts";
import { redispatchSearchingOrders } from "../../packages/application/dispatch/redispatch-searching-orders.ts";
import { parseCitySettings } from "../../packages/domain/policy/entity.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createSettingsRepository } from "../../packages/infrastructure/policy/settings-repository.ts";
import { createOrderRepository } from "../../packages/infrastructure/transport/order-adapters.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import { systemClock } from "../../packages/shared/kernel/index.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { testConfig } from "../support/config.ts";
import { seedCapableDriver } from "../support/seed-capable-driver.ts";
import { capturing, type SentMessage } from "../support/telegram-capture.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
const describeIf = DATABASE_URL === "" ? describe.skip : describe;
if (DATABASE_URL === "") {
  console.warn(
    "⚠️  اختبارات التكامل مُتخطّاة: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** الحدُّ المُختبَرُ — القيمةُ التي تفرضُها الدفعةُ 25 على الحاويةِ. */
const LIMIT = 100;
/** نافذةُ الخفضِ القائمةُ (لا تتغيّرُ في هذه الدفعةِ) — اللاحقُ لا يبدأُ قبلَها. */
const DEBOUNCE_MS = 2_000;

let sql: Sql;
/** اتصالٌ مستقلٌّ للطرفِ الآخرِ منَ الحاجزِ: تغييرُ الحالةِ أثناءَ الشوطِ. */
let other: Sql;
let cityId: CityId;
let city: ActiveCityHandle | undefined;
let riderId: string;
let driverRowId: string;
let idleDriverRowId: string;
let maxRounds = 3;
const created: string[] = [];
const TG_RIDER = 8_825_001;
const TG_DRIVER = 8_825_002;
const TG_IDLE_DRIVER = 8_825_003;
const PICKUP = "SRID=4326;POINT(39.1728 21.5433)";

beforeAll(async () => {
  if (DATABASE_URL === "") return;
  sql = createSql({ connectionString: DATABASE_URL });
  other = createSql({ connectionString: DATABASE_URL, applicationName: "ceezr:test-b25-barrier" });
  city = await ensureActiveCity(sql);
  cityId = city.cityId as CityId;

  const [rider] = await sql<{ id: string }[]>`
    insert into users (city_id, role, telegram_id) values (${cityId}::uuid, 'rider', ${TG_RIDER})
      on conflict (telegram_id) do update set city_id = excluded.city_id returning id`;
  if (rider === undefined) throw new Error("users: لم يُدرَج الصفُّ");
  const [riderRow] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}::uuid, ${rider.id}::uuid)
      on conflict (user_id) do update set user_id = excluded.user_id returning id`;
  if (riderRow === undefined) throw new Error("riders: لم يُدرَج الصفُّ");
  riderId = riderRow.id;
  await purgeMyOrders();

  // سائقٌ مؤهّلٌ متاحٌ بجوارِ الالتقاطِ: كلُّ طلبٍ يُفحَصُ يُبثُّ إليه، فتصيرُ جولةُ الطلبِ
  // في القاعدةِ شاهدًا على أنّه فُحِصَ (المرشّحونَ لا يُستبعَدونَ لعرضٍ معلَّقٍ عندَهم).
  driverRowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_DRIVER,
    name: "سائق حد الشوط",
  });
  // سائقٌ موثَّقٌ قادرٌ بموقعٍ بجوارِ الالتقاطِ لكنّه **غيرُ متاحٍ**: الأهليّةُ تُبعدُه.
  idleDriverRowId = await seedCapableDriver({
    sql,
    cityId,
    service: "transport",
    telegramId: TG_IDLE_DRIVER,
    name: "سائق غير متاح",
  });
  for (const d of [driverRowId, idleDriverRowId]) {
    await sql`
      update subscriptions set current_period_end = now() + interval '30 days'
       where driver_id = ${d}::uuid and status in ('trialing', 'active')`;
  }
  await sql`
    insert into driver_availability (city_id, driver_id, is_available, changed_at)
    values (${cityId}::uuid, ${driverRowId}::uuid, true, now())
    on conflict (driver_id) do update set is_available = true, changed_at = now()`;
  await sql`
    insert into driver_availability (city_id, driver_id, is_available, changed_at)
    values (${cityId}::uuid, ${idleDriverRowId}::uuid, false, now())
    on conflict (driver_id) do update set is_available = false, changed_at = now()`;

  const raw = await createSettingsRepository(sql).findByCity(cityId);
  if (raw.ok) {
    const parsed = parseCitySettings(cityId, raw.value);
    if (parsed.ok) maxRounds = parsed.value.maxBroadcastRounds;
  }
});

afterAll(async () => {
  if (DATABASE_URL === "") return;
  await purgeMyOrders();
  for (const d of [driverRowId, idleDriverRowId]) {
    await sql`delete from driver_availability where driver_id = ${d}::uuid`;
    await sql`delete from drivers where id = ${d}::uuid`;
  }
  await sql`delete from riders where id = ${riderId}::uuid`;
  await sql`delete from users where telegram_id in (${TG_RIDER}, ${TG_DRIVER}, ${TG_IDLE_DRIVER})`;
  await restoreCityBaseline(sql, city);
  await sql.end();
  await other.end();
});

beforeEach(async () => {
  if (DATABASE_URL === "") return;
  await purgeMyOrders();
  await parkForeignSearching();
  // موقعٌ حيٌّ للسائقَينِ لكلِّ اختبارٍ (الاختبارُ الأوّلُ ينتظرُ ثوانيَ — لا يتقادمُ الموقعُ).
  for (const d of [driverRowId, idleDriverRowId]) {
    await sql`
      update drivers set last_location = ${PICKUP}::geography, last_location_at = now(),
        last_location_quality = 'ACCEPT'
      where id = ${d}::uuid`;
  }
});

afterEach(async () => {
  if (DATABASE_URL === "") return;
  await restoreForeignSearching();
});

async function purgeMyOrders(): Promise<void> {
  await sql`delete from notification_outbox where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from order_offers where order_id in (select id from orders where rider_id = ${riderId}::uuid)`;
  await sql`delete from orders where rider_id = ${riderId}::uuid`;
  created.length = 0;
}

/** `n` طلبًا باحثًا، الأوّلُ أقدمُها (عمرُه `n + 30` ثانيةً) والأخيرُ أحدثُها. */
async function seedSearching(n: number, broadcastRound = 0): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(Date.now() - (n + 30 - i) * 1000);
    const [o] = await sql<{ id: string }[]>`
      insert into orders (city_id, rider_id, service, status, pickup, broadcast_round, created_at, searching_since)
      values (${cityId}::uuid, ${riderId}::uuid, 'transport', 'searching', ${PICKUP}::geography,
              ${broadcastRound}, ${at}, ${at})
      returning id`;
    if (o === undefined) throw new Error("orders: لم يُدرَج الطلبُ");
    ids.push(o.id);
    created.push(o.id);
  }
  return ids;
}

/**
 * الطلباتُ الباحثةُ في المدينةِ لغيرِ راكبِ هذا الملفِّ (بقايا ملفّاتٍ أخرى في قاعدةِ الاختبارِ
 * المشتركةِ) تسرقُ نافذةَ الشوطِ فتُبطلُ الحكمَ. تُحيَّدُ مؤقّتًا بالمسارِ نفسِه الذي يستثنيها
 * القارئُ به (مرشَّحٌ حيٌّ `candidate_expires_at` مستقبليٌّ — WR-09) ثمّ تُستعادُ قيمُها حرفيًّا.
 * لا حذفَ ولا تغييرَ حالٍ: الاختبارُ لا يعتمدُ على نظافةِ غيرِه ولا يُفسدُ بقاياه.
 */
let parked: { id: string; candidate_expires_at: Date | null }[] = [];
async function parkForeignSearching(): Promise<void> {
  parked = await sql<{ id: string; candidate_expires_at: Date | null }[]>`
    select id, candidate_expires_at from orders
     where city_id = ${cityId}::uuid and status = 'searching' and assigned_driver_id is null
       and rider_id <> ${riderId}::uuid`;
  if (parked.length === 0) return;
  await sql`update orders set candidate_expires_at = now() + interval '1 hour'
             where id = any(${parked.map((p) => p.id)}::uuid[])`;
}
async function restoreForeignSearching(): Promise<void> {
  for (const p of parked) {
    await sql`update orders set candidate_expires_at = ${p.candidate_expires_at} where id = ${p.id}::uuid`;
  }
  parked = [];
}

/** بعدَ التحييدِ: لا طلبَ باحثًا مرئيًّا للقارئِ في المدينةِ إلا طلباتُ هذا الملفِّ. */
async function foreignSearching(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int n from orders
     where city_id = ${cityId}::uuid and status = 'searching' and assigned_driver_id is null
       and (candidate_expires_at is null or candidate_expires_at <= now())
       and rider_id <> ${riderId}::uuid`;
  return r?.n ?? 0;
}

async function roundsOf(ids: readonly string[]): Promise<Map<string, number>> {
  const rows = await sql<{ id: string; broadcast_round: number }[]>`
    select id, broadcast_round from orders where id = any(${ids}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.broadcast_round]));
}

/** حاجزُ عدمِ الازدواجِ منَ القاعدةِ: لا عرضَ مكرّرٌ (طلب، جولة، سائق) ولا جولةٌ فوقَ الحدِّ ولا إسناد. */
async function expectNoDuplicateOrIllegalRounds(ids: readonly string[]): Promise<void> {
  const [dup] = await sql<{ n: number }[]>`
    select count(*)::int n from (
      select order_id, round, driver_id from order_offers
       where order_id = any(${ids}::uuid[])
       group by 1, 2, 3 having count(*) > 1) d`;
  expect(dup?.n ?? 0).toBe(0);
  const [beyond] = await sql<{ n: number }[]>`
    select count(*)::int n from orders
     where id = any(${ids}::uuid[]) and broadcast_round > ${maxRounds}`;
  expect(beyond?.n ?? 0).toBe(0);
  // كلُّ عرضٍ لجولةٍ فُتحت فعلًا (لا عرضَ لجولةٍ أعلى من جولةِ الطلبِ).
  const [orphan] = await sql<{ n: number }[]>`
    select count(*)::int n from order_offers f join orders o on o.id = f.order_id
     where o.id = any(${ids}::uuid[]) and f.round > o.broadcast_round`;
  expect(orphan?.n ?? 0).toBe(0);
  const [assigned] = await sql<{ n: number }[]>`
    select count(*)::int n from orders where id = any(${ids}::uuid[]) and assigned_driver_id is not null`;
  expect(assigned?.n ?? 0).toBe(0);
}

function passDeps(limit: number) {
  return {
    finder: createSearchingOrderFinder(sql),
    broadcast: {
      orders: createOrderRepository(sql),
      offers: createOfferRepository(sql),
      candidates: createDriverCandidateRepository(sql),
      settings: createSettingsRepository(sql),
      offerWriter: createOfferWriter(sql),
      clock: systemClock,
    },
    limit,
  };
}

interface PassRow {
  readonly k: string;
  readonly cityId: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly picked: number;
  readonly rebroadcast: number | null;
}

function readPasses(file: string): PassRow[] {
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as PassRow)
    .filter((r) => r.k === "pass" && r.cityId === cityId)
    .sort((a, b) => a.startAt - b.startAt);
}

describeIf("LOAD-01 (ب25) — حدُّ الشوطِ الفوريِّ 100 على PostgreSQL حقيقيّ", () => {
  it("الحاويةُ: شوطٌ يفحصُ 100 لا أكثرَ والأقدمُ أوّلًا، والممتلئُ يُجدوِلُ لاحقًا بعدَ الخفضِ يخدمُ الباقي", async () => {
    expect(await foreignSearching()).toBe(0);
    const ids = await seedSearching(LIMIT + 30);
    const oldest = ids.slice(0, LIMIT);
    const newest = ids.slice(LIMIT);

    const dir = mkdtempSync(join(tmpdir(), "ceezr-b25-"));
    const traceFile = join(dir, "dispatch-trace.jsonl");
    const prevTrace = process.env.DISPATCH_TRACE_FILE;
    process.env.DISPATCH_TRACE_FILE = traceFile;
    const sent: SentMessage[] = [];
    const container = buildContainer(testConfig({ port: 3994 }), {
      driverSender: capturing(sent),
      riderSender: capturing(sent),
    });
    if (prevTrace === undefined) delete process.env.DISPATCH_TRACE_FILE;
    else process.env.DISPATCH_TRACE_FILE = prevTrace;

    try {
      // محفّزٌ واحدٌ فقط (إنشاءُ طلبٍ) — أيُّ شوطٍ ثانٍ لا يأتي إلا من جدولةِ اللاحقِ.
      container.dispatchNewOrder(ids[ids.length - 1] as string);

      let passes: PassRow[] = [];
      const deadline = Date.now() + 25_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        passes = readPasses(traceFile);
        if (passes.length >= 2) break;
      }
      expect(passes.length).toBeGreaterThanOrEqual(2);
      const [first, second] = passes as [PassRow, PassRow];

      // (١) الحدُّ: الشوطُ الأوّلُ فحصَ 100 بالضبطِ — لا أقلَّ (الحدُّ القديمُ 50) ولا أكثر.
      expect(first.picked).toBe(LIMIT);
      expect(first.picked).toBeLessThanOrEqual(LIMIT);
      expect(first.rebroadcast).toBe(LIMIT);

      // (٢) الإنصافُ: مَن فُحصَ في الشوطِ الأوّلِ هوَ الأقدمُ المئةُ؛ والأحدثُ لم يسبقْهم.
      // (اللقطةُ تؤخذُ قبلَ الشوطِ الثاني: المئةُ جولتُها 1 والثلاثونَ لم تُمسّ بعدُ.)
      // الجولةُ تُقرأُ بعدَ الشوطَينِ، فالحكمُ منَ العروضِ المكتوبةِ قبلَ بدءِ الثاني.
      const firstWave = await sql<{ order_id: string }[]>`
          select distinct order_id from order_offers
           where order_id = any(${ids}::uuid[])
             and created_at <= to_timestamp(${first.endAt / 1000})`;
      const firstSet = new Set(firstWave.map((r) => r.order_id));
      expect(oldest.every((id) => firstSet.has(id))).toBe(true);
      expect(newest.some((id) => firstSet.has(id))).toBe(false);

      // (٣) الشوطُ اللاحقُ: جاءَ بلا محفّزٍ خارجيٍّ، بعدَ نافذةِ الخفضِ لا قبلَها،
      // ولم يتداخلْ معَ الأوّلِ (مانعُ التداخلِ) — وخدمَ الثلاثينَ الأحدثَ.
      expect(second.startAt - first.startAt).toBeGreaterThanOrEqual(DEBOUNCE_MS - 50);
      expect(second.startAt).toBeGreaterThanOrEqual(first.endAt);
      expect(second.picked).toBeLessThanOrEqual(LIMIT);
      const rounds = await roundsOf(newest);
      expect(newest.every((id) => (rounds.get(id) ?? 0) >= 1)).toBe(true);

      await expectNoDuplicateOrIllegalRounds(ids);
    } finally {
      await container.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it("حارسُ open_offer_round داخلَ شوطٍ من 100: جولةٌ متزامنةٌ وإلغاءٌ متزامنٌ بعدَ الموضعِ 50 = سباقٌ لا جولةٌ مكرّرة", async () => {
    expect(await foreignSearching()).toBe(0);
    const ids = await seedSearching(LIMIT);
    const takenOver = ids[74] as string; // بعدَ الحدِّ القديمِ عمدًا
    const cancelled = ids[79] as string;

    let seen = 0;
    const report = await redispatchSearchingOrders(cityId, {
      ...passDeps(LIMIT),
      aroundOrder: async <T>(orderId: OrderId, fn: () => Promise<T>): Promise<T> => {
        seen += 1;
        if (orderId === takenOver) {
          // الجولةُ الخارجيةُ لسائقٍ آخرَ عمدًا: سائقُ الشوطِ يبقى مؤهّلًا للطلبِ فيبلغُ قرارُ
          // اللقطةِ المتقادمةِ (جولتُها 0) الكتابةَ — فيرفضُه حارسُ open_offer_round ذرّيًّا.
          // (لو كانت لسائقِ الشوطِ نفسِه لأُبعدَ بالأهليّةِ قبلَ الكتابةِ فلا يُختبرُ الحارسُ.)
          const r = await other<{ ok: boolean }[]>`
            select (open_offer_round(${orderId}::uuid, 1, now() + interval '45 seconds',
              jsonb_build_array(jsonb_build_object('driver_id', ${idleDriverRowId}::uuid, 'score', 1, 'distance_km', 0.1))))->>'ok' = 'true' as ok`;
          if (r[0]?.ok !== true) throw new Error("فتحُ الجولةِ الحاجزةِ فشلَ");
        }
        if (orderId === cancelled) {
          await other`update orders set status = 'cancelled' where id = ${orderId}::uuid`;
        }
        return fn();
      },
    });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.examined).toBe(LIMIT);
    expect(seen).toBe(LIMIT);
    expect(report.value.raced).toContain(takenOver as OrderId);
    expect(report.value.raced).toContain(cancelled as OrderId);
    expect(report.value.rebroadcast).toHaveLength(LIMIT - 2);
    expect(report.value.failed).toBe(0);

    const taken = await sql<{ round: number }[]>`
      select distinct round from order_offers where order_id = ${takenOver}::uuid`;
    expect(taken.map((r) => r.round)).toEqual([1]);
    const rounds = await roundsOf([takenOver]);
    expect(rounds.get(takenOver)).toBe(1);
    // جولةُ الطلبِ المأخوذِ هي الخارجيةُ وحدَها: لا عرضَ من الشوطِ لسائقِه.
    const [mine] = await sql<{ n: number }[]>`
      select count(*)::int n from order_offers
       where order_id = ${takenOver}::uuid and driver_id = ${driverRowId}::uuid`;
    expect(mine?.n ?? 0).toBe(0);
    const [c] = await sql<{ n: number }[]>`
      select count(*)::int n from order_offers where order_id = ${cancelled}::uuid`;
    expect(c?.n ?? 0).toBe(0);
    await expectNoDuplicateOrIllegalRounds(ids);
  });

  it("حدودُ الدوراتِ والأهليّةُ داخلَ نافذةِ 100: المستنفدُ لا يُبثُّ، وغيرُ المتاحِ لا يُعرَضُ عليه، ولا إسناد", async () => {
    expect(await foreignSearching()).toBe(0);
    const fresh = await seedSearching(80, 0);
    const spent = await seedSearching(20, maxRounds);
    const report = await redispatchSearchingOrders(cityId, passDeps(LIMIT));
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.examined).toBe(LIMIT);
    expect(report.value.exhausted.map(String).sort()).toEqual([...spent].sort());
    expect(report.value.rebroadcast.map(String).sort()).toEqual([...fresh].sort());

    const [spentOffers] = await sql<{ n: number }[]>`
      select count(*)::int n from order_offers where order_id = any(${spent}::uuid[])`;
    expect(spentOffers?.n ?? 0).toBe(0);
    const [idleOffers] = await sql<{ n: number }[]>`
      select count(*)::int n from order_offers
       where driver_id = ${idleDriverRowId}::uuid and order_id = any(${[...fresh, ...spent]}::uuid[])`;
    expect(idleOffers?.n ?? 0).toBe(0);
    const rounds = await roundsOf(spent);
    expect(spent.every((id) => rounds.get(id) === maxRounds)).toBe(true);
    await expectNoDuplicateOrIllegalRounds([...fresh, ...spent]);
  });
});
