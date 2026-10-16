/**
 * `F11-02` (الشقُّ المملوكُ للمستودَعِ): عمليّةُ عاملٍ **حقيقيّةٌ** تُقتَلُ بـ`SIGKILL` وهيَ تحملُ
 *   القفلَ الاستشاريَّ وحجزَ صفِّ الصادرِ، وعاملٌ ثانٍ **يعملُ قبلَ القتلِ** يتسلَّمُ بلا إعادةِ إقلاعٍ.
 *
 * طورانِ لا ثالثَ لهما في مسارِ الإرسالِ:
 *   - الموتُ **بعدَ الاستلامِ وقبلَ الإرسالِ**: لا رسالةَ بلغَت تيليجرامَ، فالحدُّ رسالةٌ واحدةٌ.
 *   - الموتُ **بعدَ وصولِ الإرسالِ وقبلَ الإقرارِ**: تيليجرامُ تلقّاها والقاعدةُ لم تعلمْ، فالعاملُ
 *     الثاني يُعيدُها — والحدُّ رسالتانِ (`ADR 0195`: الأثرُ في القاعدةِ مرّةً، والرسالةُ مرّةً على الأقلِّ).
 *
 * والمقيسُ يُطبَعُ سطراً (`── F11-02 · …`) فيُقرأُ من سجلِّ CI لا من ادّعاءٍ.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferWriter } from "../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createNotificationOutboxPort } from "../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import {
  LOCK_NAMESPACE,
  lockKeyOf,
} from "../../packages/infrastructure/scheduling/advisory-lock.ts";
import type { CityId, DriverId, OrderId } from "../../packages/shared/kernel/index.ts";
import { judgeWorkerLoss } from "../../scripts/lib/worker-loss-invariants.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import { WORKER_LOSS_JOB } from "../support/worker-loss-child.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const CHILD_SCRIPT = "tests/support/worker-loss-child.ts";
/** مهلةُ استرجاعِ الحجزِ في الاختبارِ — تُعادُ القيمُ الأصليّةُ بعدَه. */
const CLAIM_TIMEOUT_SECONDS = 2;

let sql: Sql;
let cityId = "";
let cityHandle: ActiveCityHandle | undefined;
let orderId = "";
let driverId = "";
let savedTimeouts: { id: string; value: unknown }[] = [];

type Hit = { offerId: string; pid: number };
const gateHits: Hit[] = [];
const sendHits: Hit[] = [];
let holdGateOnce = false;
let holdSendOnce = false;
let messageSeq = 0;
let server: ReturnType<typeof Bun.serve> | undefined;
const children: ReturnType<typeof Bun.spawn>[] = [];

function never(): Promise<Response> {
  return new Promise<Response>(() => {});
}

async function waitFor(what: string, cond: () => Promise<boolean> | boolean, ms = 20_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await cond()) return Date.now() - start;
    await Bun.sleep(50);
  }
  throw new Error(`انقضت المهلة: ${what}`);
}

function spawnWorker(): ReturnType<typeof Bun.spawn> {
  const child = Bun.spawn(["bun", CHILD_SCRIPT, DATABASE_URL ?? "", server?.url.origin ?? ""], {
    stdout: "inherit",
    stderr: "inherit",
  });
  children.push(child);
  return child;
}

/** جلساتُ القاعدةِ التي تحملُ قفلَ المهمّةِ الآنَ — بمعرِّفِ عمليّةِ الخادمِ لا بعددٍ وحدَه. */
async function lockHolders(): Promise<number[]> {
  const rows = await sql<{ pid: number }[]>`
    select pid from pg_locks
     where locktype = 'advisory' and granted
       and classid = ${LOCK_NAMESPACE >>> 0}::bigint::oid
       and objid = ${lockKeyOf(WORKER_LOSS_JOB) >>> 0}::bigint::oid
  `;
  return rows.map((r) => r.pid);
}

async function outboxRows(offerId: string) {
  return sql<
    { status: string; attempts: number; messageId: string | null; claimToken: string | null }[]
  >`
    select status, attempts, delivered_message_id as "messageId", claim_token::text as "claimToken"
      from notification_outbox where offer_id = ${offerId}::uuid
  `;
}

async function createFixture(): Promise<void> {
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  cityId = city[0]?.id ?? "";
  if (cityId === "") throw new Error("مدينة جدة غير مبذورة");
  cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
  const riderUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, 881102::bigint, 'راكب', '+966500881102', 'rider') returning id
  `;
  const rider = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id) values (${cityId}, ${riderUser[0]?.id ?? ""}::uuid) returning id
  `;
  const driverUser = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role)
    values (${cityId}, 991102::bigint, 'سائق', '+966500991102', 'driver') returning id
  `;
  const drv = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status)
    values (${cityId}, ${driverUser[0]?.id ?? ""}::uuid, 'verified'::verification_status) returning id
  `;
  driverId = drv[0]?.id ?? "";
  const order = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup)
    values (${cityId}, ${rider[0]?.id ?? ""}::uuid, 'transport', 'searching',
            ST_SetSRID(ST_MakePoint(39.1728, 21.5433), 4326)::geography)
    returning id
  `;
  orderId = order[0]?.id ?? "";
}

async function openRound(): Promise<string> {
  const written = await createOfferWriter(sql).openRound({
    orderId: orderId as OrderId,
    cityId: cityId as CityId,
    round: 1,
    entries: [{ driverId: driverId as DriverId, score: 10, distanceKm: 1.5 as DistanceKm }],
    expiresAt: new Date(Date.now() + 120_000),
  });
  if (!written.ok || !written.value.opened) throw new Error("تعذّر فتح الدورة");
  const offerId = written.value.offers[0]?.offerId;
  if (offerId === undefined) throw new Error("لم يُرجَع معرّف عرض");
  return String(offerId);
}

/**
 * طورٌ كاملٌ: عاملٌ أوّلُ يُحبَسُ عندَ `hold`، وعاملٌ ثانٍ يُقلِعُ **قبلَ** القتلِ فيرى القفلَ
 * مأخوذاً، ثمَّ `SIGKILL` للأوّلِ، ثمَّ تسلُّمُ الثاني. يُعيدُ لقطةَ الحَكَمِ والأزمنةَ.
 */
async function runPhase(hold: "gate" | "send") {
  const offerId = await openRound();
  if (hold === "gate") holdGateOnce = true;
  else holdSendOnce = true;
  const hits = hold === "gate" ? gateHits : sendHits;

  const a = spawnWorker();
  await waitFor(`العاملُ الأوّلُ يبلغُ /${hold}`, () => hits.some((h) => h.pid === a.pid));
  const held = (await outboxRows(offerId))[0];
  expect(held?.status).toBe("sending");
  const deadToken = held?.claimToken ?? "";
  const deadHolders = await lockHolders();
  expect(deadHolders).toHaveLength(1);

  // الثاني حيٌّ قبلَ القتلِ: القفلُ مأخوذٌ فلا يمسُّ الصفَّ.
  const b = spawnWorker();
  await Bun.sleep(1_500);
  expect(gateHits.some((h) => h.pid === b.pid)).toBe(false);
  expect(await lockHolders()).toEqual(deadHolders);

  const killedAt = Date.now();
  a.kill("SIGKILL");
  await a.exited;
  const deadHolder = deadHolders[0];
  const lockReleaseMs = await waitFor(
    "تحريرُ القفلِ بموتِ الجلسةِ",
    async () => !(await lockHolders()).includes(deadHolder ?? -1),
    10_000,
  );
  const locksAfterKill = (await lockHolders()).filter((pid) => pid === deadHolder).length;

  await waitFor(
    "تسلُّمُ الثاني وتسليمُه",
    async () => (await outboxRows(offerId))[0]?.status === "delivered",
    20_000,
  );
  const reclaimMs = Date.now() - killedAt;
  const late = await createNotificationOutboxPort(sql).finish({
    deliveryId:
      (
        await sql<
          { id: string }[]
        >`select id from notification_outbox where offer_id = ${offerId}::uuid`
      )[0]?.id ?? "",
    claimToken: deadToken,
    messageId: "ghost-of-dead-worker",
    error: null,
  });
  const rows = await outboxRows(offerId);
  const offers = await sql<
    { n: string }[]
  >`select count(*)::text as n from order_offers where order_id = ${orderId}::uuid`;
  const sends = sendHits.filter((h) => h.offerId === offerId);
  b.kill("SIGKILL");
  await b.exited;

  const snapshot = {
    advisoryLocksAfterKill: locksAfterKill,
    rows,
    deadClaimToken: deadToken,
    lateFinishAccepted: late.ok && late.value.ok,
    messageIdAfterLateFinish: rows[0]?.messageId ?? null,
    sends: sends.length,
    sendBound: hold === "gate" ? 1 : 2,
    offers: Number(offers[0]?.n ?? 0),
  };
  const verdict = judgeWorkerLoss(snapshot);
  console.log(
    `── F11-02 · موتٌ عندَ /${hold}: تحريرُ القفلِ ${lockReleaseMs}ms · تسلُّمٌ وتسليمٌ ${reclaimMs}ms بعدَ القتلِ · ` +
      `رسائلُ ${sends.length} (${sends.map((h) => (h.pid === a.pid ? "الميّت" : "الثاني")).join("،")}) · ` +
      `محاولاتٌ ${rows[0]?.attempts} · حالةٌ ${rows[0]?.status} · إعلانُ الميّتِ ${snapshot.lateFinishAccepted ? "مقبولٌ" : "مرفوضٌ"} · ` +
      `الحكمُ ${JSON.stringify(verdict)}`,
  );
  return { verdict, snapshot, deadPid: a.pid, heirPid: b.pid, sends };
}

describeIf("فقدانُ عمليّةِ عاملٍ حقيقيّةٍ — F11-02", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    savedTimeouts = await sql<{ id: string; value: unknown }[]>`
      select id, value from platform_settings where key = 'notification_claim_timeout_seconds'
    `;
    await sql`
      update platform_settings set value = ${sql.json(CLAIM_TIMEOUT_SECONDS)}
       where key = 'notification_claim_timeout_seconds'
    `;
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        const hit = (await req.json()) as Hit;
        const path = new URL(req.url).pathname;
        if (path === "/gate") {
          gateHits.push(hit);
          if (holdGateOnce) {
            holdGateOnce = false;
            return never();
          }
          return new Response("{}");
        }
        sendHits.push(hit);
        if (holdSendOnce) {
          holdSendOnce = false;
          return never();
        }
        messageSeq += 1;
        return Response.json({ message_id: `m-${hit.pid}-${messageSeq}` });
      },
    });
  });

  afterAll(async () => {
    // تنظيفٌ نهائي: الـbeforeEach يمسح قبل كل اختبار لكن لا شيء يمسح بعد الأخير
    // فيبقى سائق/راكب هذا الملف يلوّث الملفات المتوازية اللاحقة
    // (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9). قبل sql.end عمدًا.
    await sql`
      truncate table notification_outbox, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;

    for (const c of children) c.kill("SIGKILL");
    server?.stop(true);
    for (const t of savedTimeouts) {
      await sql`update platform_settings set value = ${sql.json(t.value as never)} where id = ${t.id}::uuid`;
    }
    await restoreCityBaseline(sql, cityHandle);
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql`
      truncate table notification_outbox, order_offers, orders, driver_availability,
        drivers, riders, users restart identity cascade
    `;
    await createFixture();
  });

  afterEach(() => {
    holdGateOnce = false;
    holdSendOnce = false;
  });

  it("موتٌ بعدَ الاستلامِ وقبلَ الإرسالِ: القفلُ يُحرَّرُ، والثاني يُسلِّمُ مرّةً، ورمزُ الميّتِ مرفوضٌ", async () => {
    const { verdict, sends, heirPid } = await runPhase("gate");
    expect(verdict).toEqual({ ok: true, violations: [] });
    expect(sends.map((h) => h.pid)).toEqual([heirPid]);
  }, 60_000);

  it("موتٌ بعدَ وصولِ الإرسالِ وقبلَ الإقرارِ: الأثرُ في القاعدةِ مرّةً، والرسالةُ مرّتانِ لا أكثرَ (ADR 0195)", async () => {
    const { verdict, sends, deadPid, heirPid } = await runPhase("send");
    expect(verdict).toEqual({ ok: true, violations: [] });
    expect(sends.map((h) => h.pid)).toEqual([deadPid, heirPid]);
  }, 60_000);
});
