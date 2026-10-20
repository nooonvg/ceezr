/**
 * `F11-04` (الشقُّ المملوكُ للمستودَعِ) — بطءُ PostgreSQL: قفلٌ حصريٌّ على `orders` يُحبَسُ
 * أربعَ ثوانٍ، و`سقفُ البوّابةِ + OVERFLOW` استعلاماً عليه — أكثرُ من السقفِ أيّاً كانت قيمتُه، فيُثبَتُ
 * بالقياسِ أنَّ السقفَ كلَّه مشغولٌ على الخادمِ وأنَّ الفائضَ ينتظرُ اتّصالاً على العميل —
 * ثمَّ مسارٌ لا يمسُّ الجدولَ (`cities`). يُحاكَمُ بـ`judgeBrownout` (`ADR 0197`).
 *
 * طورانِ على `createSql` الحقيقيِّ: **بلا مهلةٍ** (الحالُ قبلَ `F11-04`) ويُنتظَرُ أن يُدينَه الحَكَمُ
 * بالانهيارِ المتتالي — فهوَ القياسُ «قبلُ» وسالبةٌ حقيقيّةٌ معاً؛ و**بمهلةِ 1000ms** ويُنتظَرُ أن يمرَّ.
 * والعالقُ يمرُّ بالأشكالِ الثلاثةِ: وسمٌ مُعلَّمٌ · `unsafe` · داخلَ `begin`.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { DB_POOL_MAX } from "../../packages/shared/config/connection-budget.ts";
import { type BrownoutSnapshot, judgeBrownout } from "../../scripts/lib/brownout-invariants.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
const BROWNOUT_MS = 4_000;
const TEST_DEADLINE_MS = 1_000;
const POOL_APP = "f11-04-pool";
/** فائضٌ فوقَ السقفِ: العددُ العالقُ مشتقٌّ من السقفِ فلا يساويه أبداً (كان ثابتاً 10 فساوى سقفَ 10). */
const POOL_CAP = DB_POOL_MAX.gatewayRequest;
const OVERFLOW = 5;
const BLOCKED_TOTAL = POOL_CAP + OVERFLOW;
const SATURATION_PROBE_MS = 600;

interface Saturation {
  /** اتّصالاتُ التجمُّعِ على الخادمِ في ذروةِ البطء. */
  poolBackends: number;
  /** منها ما ينتظرُ القفلَ على الخادم. */
  serverLockWaiters: number;
  /** اتّصالاتُ التجمُّعِ بعدَ إغلاقِه. */
  backendsAfterEnd: number;
  /** دفعةٌ بحجمِ العالقِ كلِّه بعدَ البطء: كلُّها خُدِمَت؟ وأطولُها؟ وأقصى اتّصالاتٍ رُصِدَت. */
  burstOk: number;
  burstMaxMs: number;
}

let observer: postgres.Sql;

async function runBrownout(
  deadlineMs: number | null,
): Promise<BrownoutSnapshot & { saturation: Saturation }> {
  let hookCalls = 0;
  const pool: Sql = createSql({
    connectionString: DATABASE_URL ?? "",
    max: POOL_CAP,
    applicationName: POOL_APP,
    ...(deadlineMs === null
      ? {}
      : {
          queryDeadlineMs: deadlineMs,
          onQueryDeadline: () => {
            hookCalls += 1;
          },
        }),
  });
  await pool`select 1`; // إحماءٌ: اتّصالٌ قائمٌ قبلَ البطءِ.

  const locker = await observer.reserve();
  await locker`begin`;
  await locker`lock table orders in access exclusive mode`;
  const [{ pid: lockerPid } = { pid: 0 }] = await locker<
    { pid: number }[]
  >`select pg_backend_pid() as pid`;
  const t0 = performance.now();
  const release = (async () => {
    await Bun.sleep(BROWNOUT_MS);
    await locker`rollback`;
    locker.release();
  })();

  type Outcome = { kind: "ok" | "cancelled" | "other"; ms: number; detail?: string };
  const settle = async (run: () => Promise<unknown>): Promise<Outcome> => {
    const start = performance.now();
    try {
      await run();
      return { kind: "ok", ms: performance.now() - start };
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      return {
        kind: code === "57014" ? "cancelled" : "other",
        ms: performance.now() - start,
        detail: String(cause),
      };
    }
  };
  const blockedRuns: Promise<Outcome>[] = [];
  for (let i = 0; i < BLOCKED_TOTAL - 4; i += 1)
    blockedRuns.push(settle(() => pool`select count(*) from orders`));
  for (let i = 0; i < 2; i += 1)
    blockedRuns.push(settle(() => pool.unsafe("select count(*) from orders")));
  for (let i = 0; i < 2; i += 1) {
    blockedRuns.push(settle(() => pool.begin(async (tx) => tx`select count(*) from orders`)));
  }

  const poolStat = async (): Promise<{ backends: number; lockWaiters: number }> => {
    const [row = { backends: 0, lockWaiters: 0 }] = await observer<
      { backends: number; lockWaiters: number }[]
    >`
      select count(*)::int as backends,
             (count(*) filter (where wait_event_type = 'Lock'))::int as "lockWaiters"
        from pg_stat_activity
       where datname = current_database() and application_name = ${POOL_APP}
         and pid <> ${lockerPid}
    `;
    return row;
  };
  await Bun.sleep(200);
  const unrelatedRun = settle(() => pool`select count(*)::int as n from cities`);

  // ذروةُ البطءِ وقبلَ المهلة: السقفُ كلُّه عالقٌ على الخادمِ، والفائضُ ينتظرُ اتّصالاً على العميل.
  await Bun.sleep(Math.max(0, SATURATION_PROBE_MS - (performance.now() - t0)));
  const peak = await poolStat();

  const probeAt = deadlineMs === null ? 2_000 : deadlineMs + 500;
  await Bun.sleep(Math.max(0, probeAt - (performance.now() - t0)));
  const [{ n: waiters } = { n: 0 }] = await observer<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity
     where datname = current_database() and application_name = ${POOL_APP}
       and wait_event_type = 'Lock' and pid <> ${lockerPid}
  `;

  const outcomes = await Promise.all(blockedRuns);
  const unrelated = await unrelatedRun;
  await release;
  const recovery = await settle(() => pool`select count(*) from orders`);
  await Bun.sleep(100);
  const [{ n: idleInTx } = { n: 0 }] = await observer<{ n: number }[]>`
    select count(*)::int as n from pg_stat_activity
     where datname = current_database() and application_name = ${POOL_APP}
       and state like 'idle in transaction%'
  `;
  // تعافي السعةِ كلِّها لا اتّصالٍ واحد: دفعةٌ بحجمِ العالقِ تُخدَمُ كلُّها بلا قفل.
  const burst = await Promise.all(
    Array.from({ length: BLOCKED_TOTAL }, () => settle(() => pool`select count(*) from orders`)),
  );
  await pool.end({ timeout: 5 });
  await Bun.sleep(100);
  const afterEnd = await poolStat();

  const others = outcomes.filter((o) => o.kind === "other");
  if (others.length > 0)
    console.log(
      "── F11-04 · أخطاءٌ أخرى:",
      others.map((o) => o.detail),
    );
  return {
    deadlineMs,
    brownoutMs: BROWNOUT_MS,
    blocked: {
      total: outcomes.length,
      cancelled: outcomes.filter((o) => o.kind === "cancelled").length,
      succeeded: outcomes.filter((o) => o.kind === "ok").length,
      otherErrors: others.length,
      maxSettleMs: Math.round(Math.max(...outcomes.map((o) => o.ms))),
    },
    unrelated: { ok: unrelated.kind === "ok", latencyMs: Math.round(unrelated.ms) },
    serverWaitersAfterDeadline: waiters,
    deadlineHookCalls: hookCalls,
    recovery: { ok: recovery.kind === "ok", latencyMs: Math.round(recovery.ms) },
    idleInTransaction: idleInTx,
    saturation: {
      poolBackends: peak.backends,
      serverLockWaiters: peak.lockWaiters,
      backendsAfterEnd: afterEnd.backends,
      burstOk: burst.filter((o) => o.kind === "ok").length,
      burstMaxMs: Math.round(Math.max(...burst.map((o) => o.ms))),
    },
  };
}

/** شرطُ التجاوزِ الفعليّ: يُفشِلُ الاختبارَ إن ساوى العالقُ السقفَ أو لم يُشغَلِ السقفُ كلُّه. */
function expectSaturatedAndRecovered(s: BrownoutSnapshot & { saturation: Saturation }): void {
  expect(s.blocked.total).toBe(BLOCKED_TOTAL);
  expect(s.blocked.total).toBeGreaterThan(POOL_CAP);
  // التجمُّعُ لا يفتحُ أكثرَ من سقفِه، والسقفُ كلُّه ينتظرُ القفلَ على الخادم…
  expect(s.saturation.poolBackends).toBe(POOL_CAP);
  expect(s.saturation.serverLockWaiters).toBe(POOL_CAP);
  // …فالفائضُ (OVERFLOW) ينتظرُ اتّصالاً على العميلِ لا على الخادم.
  expect(s.blocked.total - s.saturation.serverLockWaiters).toBe(OVERFLOW);
  // التنظيفُ والاستعادة: دفعةٌ بحجمِ العالقِ تُخدَمُ كلُّها، ولا اتّصالَ يبقى بعدَ الإغلاق.
  expect(s.saturation.burstOk).toBe(BLOCKED_TOTAL);
  expect(s.saturation.backendsAfterEnd).toBe(0);
}

function report(label: string, s: BrownoutSnapshot & { saturation: Saturation }): void {
  const verdict = judgeBrownout(s);
  console.log(
    `── F11-04 · ${label}: مسارُ cities ${s.unrelated.latencyMs}ms (${s.unrelated.ok ? "خُدِمَ" : "لم يُخدَم"}) · العالقُ ${s.blocked.total}: مُلغىً ${s.blocked.cancelled} · نجحَ ${s.blocked.succeeded} · آخرُ ${s.blocked.otherErrors} · أطولُه ${s.blocked.maxSettleMs}ms · منتظِرو الخادمِ بعدَ المهلةِ ${s.serverWaitersAfterDeadline} · الخطّافُ ${s.deadlineHookCalls} · التعافي ${s.recovery.latencyMs}ms · معاملاتٌ مفتوحةٌ ${s.idleInTransaction} · السقفُ ${POOL_CAP}: اتّصالاتٌ ${s.saturation.poolBackends} · على القفلِ ${s.saturation.serverLockWaiters} · دفعةُ التعافي ${s.saturation.burstOk}/${BLOCKED_TOTAL} في ${s.saturation.burstMaxMs}ms · بعدَ الإغلاقِ ${s.saturation.backendsAfterEnd} · الحكمُ ${JSON.stringify(verdict)}`,
  );
}

describeIf("بطءُ PostgreSQL على تجمُّعِ مسارِ الطلبِ — F11-04", () => {
  beforeAll(() => {
    observer = postgres(DATABASE_URL ?? "", {
      max: 2,
      connection: { application_name: "f11-04-observer" },
    });
  });
  afterAll(async () => {
    await observer.end({ timeout: 5 });
  });

  it("بلا مهلةٍ (الحالُ السابقةُ): الحَكَمُ يُدينُ الانهيارَ المتتاليَ — مسارٌ لا يمسُّ الجدولَ ينتظرُ البطءَ كلَّه", async () => {
    const s = await runBrownout(null);
    report("بلا مهلةٍ", s);
    const verdict = judgeBrownout(s);
    expect(verdict.ok).toBe(false);
    expect(verdict.violations).toContain("unrelated.cascaded");
    expect(verdict.violations).toContain("server.still_waiting");
    expectSaturatedAndRecovered(s);
    // بلا مهلةٍ ينتظرُ كلُّ عالقٍ البطءَ كلَّه — ومنه الفائضُ الذي لم يبلغِ الخادمَ بعد.
    expect(s.blocked.succeeded).toBe(BLOCKED_TOTAL);
  }, 20_000);

  it("بمهلةِ 1000ms: المسارُ غيرُ المعنيِّ يُخدَمُ ضمنَ المهلةِ، والعالقُ يُلغى على الخادمِ مرصوداً، والتجمُّعُ يتعافى", async () => {
    const s = await runBrownout(TEST_DEADLINE_MS);
    report(`بمهلةِ ${TEST_DEADLINE_MS}ms`, s);
    expect(judgeBrownout(s)).toEqual({ ok: true, violations: [] });
    expectSaturatedAndRecovered(s);
    // انقضاءُ الانتظار: كلُّ عالقٍ — المُرسَلُ إلى الخادمِ والمنتظِرُ اتّصالاً — يُلغى بالمهلة.
    expect(s.blocked.cancelled).toBe(BLOCKED_TOTAL);
    expect(s.deadlineHookCalls).toBe(BLOCKED_TOTAL);
  }, 20_000);
});
