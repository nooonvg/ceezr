/* biome-ignore-all lint/style/noNonNullAssertion: أداة حمل تجريبية — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * R1 · ADR 0286 — المسارُ «ج»: **إثباتُ عزلِ المساراتِ** — منسّقُ تجاربَ لا مولّدُ
 *   دورةِ أعمالٍ ثالثٌ.
 *
 * التجاربُ الأربعُ (قابلةٌ للمقارنةِ — الحملُ واحدٌ والشرطُ هو المتغيّرُ):
 *   ١) «أ» وحدهُ — خطُّ الأساسِ.
 *   ٢) «أ» معَ «ب» بالحملِ المحددِ — تداخلُ المسارينِ.
 *   ٣) «أ» معَ ضغطِ webhook يُثبِتُ ظهورَ `webhook_inbound_429` — هل يبقى عملُ
 *      المنتجِ (الطلباتُ والإسنادُ في القاعدةِ) مستمرًّا؟
 *   ٤) «أ» معَ تعطيلِ تسليمِ إشعاراتِ تيليجرام (إيقافُ المحاكي فعليًا) —
 *      **التموجيهُ والإشعاراتُ لا يشرطانِ عملَ المنتجِ**: إنشاءُ الطلبِ
 *      والقبولُ وتقدُّمُ الرحلةِ يثبتانِ في القاعدةِ دونَ وصولِ تيليجرام.
 *
 * والتحققُ في كلِّ تجربةٍ **منَ القاعدةِ** لا منَ 2xx، مقيدًا بكتلةِ هوياتٍ
 * فريدةٍ لكلِّ تجربةٍ (معرّفُ ارتباطٍ لا لبسَ فيهِ): نسبةُ السيناريوهاتِ
 * المثبتةِ (matched/السائقُ الصحيحُ، ثمَّ completed)، وصفرُ مخالفاتِ I1
 * (سائقٌ بطلبينِ ملتزمَينِ)، وإحصاءُ صندوقِ الصادرِ (تسليم/معلّق/ميتٌ
 * وتأخيرُ التسليمِ بتوزيعِهِ الكاملِ).
 *
 * ملاحظةٌ صادقةٌ: المسارانِ يشتركانِ في المعالجِ والقاعدةِ — فلا يُدَّعى انعدامُ
 * الأثرِ، بل يُقاسُ ويُقارنَ بحدودِ القبولِ.
 *
 * التشغيلُ: `bun run deploy/capacity-run/load/isolate.ts` — يقرأُ بيئةَ الجولةِ
 * نفسَها ويشغّلُ المولّدَينِ عملياتٍ فرعيةً.
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { BASE, http, signedInitData, sleep } from "./lib.ts";

const RUN_DIR = process.env.RUN_DIR ?? "/tmp/cap-run";
const EV = `${RUN_DIR}/evidence`;
mkdirSync(EV, { recursive: true });
const DB_URL = process.env.DATABASE_URL ?? "";
const CONCURRENCY = Number(process.env.ISOLATE_CONC ?? 20);
const DURATION_SEC = Number(process.env.ISOLATE_SEC ?? 120);
const B_RATE = Number(process.env.ISOLATE_B_RATE ?? 5);
const B_PRESSURE_RATE = Number(process.env.ISOLATE_B_PRESSURE_RATE ?? 50);
const sql = postgres(`${DB_URL}?application_name=isolate`, {
  max: 4,
  idle_timeout: 20,
});

/* ── كتلُ هوياتٍ متباعدةٌ لكلِّ تجربةٍ — معرّفُ ارتباطٍ فريدٌ لا لبسَ فيه ──
 * راكبُ التجربةِ i يبدأُ من 6_100_000 + i*100_000، وسائقُها من 7_100_000 +
 * i*100_000. حكمُ التجربةِ منَ القاعدةِ يُقيدُ بهذهِ الكتلةِ فيكونُ منسوبًا
 * لهذهِ التجربةِ وحدها لا لغيرِها، ويُقارنُ بعددِ سيناريوهاتِ مولّدها. */
// قاعدةُ الكتلِ قابلةٌ للتعيينِ منَ البيئةِ — كلُّ جولةٍ قياسٍ تُعطى قاعدةً
// جديدةً وإلا فالفحصُ المسبقُ يرفضُ الجولةَ (منعُ خلطِ نتائجِ الجولاتِ).
const RIDER_BLOCK_BASE = Number(process.env.ISOLATE_RIDER_BASE ?? 6_100_000);
const DRIVER_BLOCK_BASE = Number(process.env.ISOLATE_DRIVER_BASE ?? 7_100_000);
const BLOCK_SIZE = 100_000;
function riderBlock(i: number): [number, number] {
  const lo = RIDER_BLOCK_BASE + i * BLOCK_SIZE;
  return [lo, lo + BLOCK_SIZE - 1];
}
function driverBlock(i: number): [number, number] {
  const lo = DRIVER_BLOCK_BASE + i * BLOCK_SIZE;
  return [lo, lo + BLOCK_SIZE - 1];
}

function log(line: string) {
  console.log(line);
  appendFileSync(`${EV}/isolate-experiments.jsonl`, `${line}\n`);
}

interface ExperimentSpec {
  readonly name: string;
  readonly aProfile: string;
  readonly bProfile: string | null;
  readonly expectation: string;
}

const EXPERIMENTS: ExperimentSpec[] = [
  {
    name: "A-alone-baseline",
    aProfile: JSON.stringify([{ name: "baseline", sec: DURATION_SEC, conc: CONCURRENCY }]),
    bProfile: null,
    expectation: "خطُّ الأساسِ: نسبةُ إثباتِ «أ» بلا مسارٍ آخرَ",
  },
  {
    name: "A-with-B",
    aProfile: JSON.stringify([{ name: "withB", sec: DURATION_SEC, conc: CONCURRENCY }]),
    bProfile: JSON.stringify([{ name: "withA", sec: DURATION_SEC, ratePerSec: B_RATE }]),
    expectation: "تداخلُ المسارينِ: أثرٌ مقيسٌ لا منعدمٌ — المسارانِ يشتركانِ في المعالجِ",
  },
  {
    name: "A-with-webhook-pressure",
    aProfile: JSON.stringify([{ name: "pressure", sec: DURATION_SEC, conc: CONCURRENCY }]),
    bProfile: JSON.stringify([
      { name: "pressure", sec: DURATION_SEC, ratePerSec: B_PRESSURE_RATE },
    ]),
    expectation: "ضغطُ webhook يُثبِتُ webhook_inbound_429 — وعملُ المنتجِ في القاعدةِ مستمرٌّ",
  },
  {
    name: "A-with-telegram-down",
    aProfile: JSON.stringify([{ name: "tgdown", sec: DURATION_SEC, conc: CONCURRENCY }]),
    bProfile: JSON.stringify([{ name: "observe", sec: DURATION_SEC, ratePerSec: 0.5 }]),
    expectation: "إشعاراتُ تيليجرام متعطلةٌ — والإنشاءُ والقبولُ والتقدُّمُ يثبتونَ في القاعدةِ",
  },
];

function runGenerator(
  script: string,
  env: Record<string, string>,
): { done: Promise<void>; kill: () => void } {
  const child = spawn("bun", ["run", script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return {
    done: new Promise((resolve) => {
      child.on("exit", () => resolve());
    }),
    kill: () => {
      child.kill("SIGTERM");
    },
  };
}

/** تشغيلُ أمرِ إدارةِ الخدماتِ (svc.sh) — إيقافُ/إعادةُ المحاكي في التجربةِ الرابعة. */
function runSvc(action: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["deploy/capacity-run/svc.sh", action], {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env },
    });
    child.on("exit", (code) => resolve(code ?? -1));
  });
}

/** فحصٌ فعليٌّ لصحةِ المحاكي — لا يُكتفى برمزِ خروجِ الأمر. */
async function mockHealthy(): Promise<boolean> {
  try {
    const response = await fetch(
      `${process.env.MOCK_TELEGRAM_URL ?? "http://127.0.0.1:58090"}/health`,
      {
        signal: AbortSignal.timeout(3_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/** عدُّ مخرجاتِ مولّدِ المسارِ «أ» منَ سجلِّ أحداثِهِ — verified/rejected/undecided. */
function countGeneratorOutcomes(genId: string): Record<string, number> {
  const counts: Record<string, number> = { verified: 0, rejected: 0, undecided: 0 };
  try {
    const lines = readFileSync(`${EV}/miniapp-load-events.jsonl`, "utf8").split("\n");
    for (const line of lines) {
      if (!line.includes(`"gen":"${genId}"`)) continue;
      const match = /"event":"scenario\.outcome","kind":"([a-z]+)"/.exec(line);
      if (match?.[1] !== undefined) counts[match[1]] = (counts[match[1]] ?? 0) + 1;
    }
  } catch {
    // سجلُّ المولّدِ غيرُ موجودٍ بعدُ — يُسجَّلُ صفرًا ولا يُدّعى غيرُه
  }
  return counts;
}

/** قراءةُ عدّاداتِ مولّدِ المسارِ «ب» الأخيرةِ (429 الواردِ ورصدُ الإشعاراتِ). */
function readBStats(genId: string): Record<string, unknown> | null {
  try {
    const lines = readFileSync(`${EV}/telegram-load-events.jsonl`, "utf8").split("\n");
    let last: Record<string, unknown> | null = null;
    for (const line of lines) {
      if (!line.includes(`"gen":"${genId}"`)) continue;
      if (line.includes('"event":"gen.end"')) {
        last = JSON.parse(line) as Record<string, unknown>;
      }
    }
    return last;
  } catch {
    return null;
  }
}

async function experiment(spec: ExperimentSpec, index: number): Promise<void> {
  const [riderLo, riderHi] = riderBlock(index);
  const [driverLo, driverHi] = driverBlock(index);
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "experiment.start",
      name: spec.name,
      expectation: spec.expectation,
      riderBlock: [riderLo, riderHi],
      driverBlock: [driverLo, driverHi],
    }),
  );

  // فحصُ تلوثٍ مسبقٌ: كتلةُ الهوياتِ يجبُ أن تكونُ خاليةً من أيِّ جولةٍ سابقةٍ —
  // وإلا فنتائجُ هذهِ الجولةِ ستُخلطُ بسابقتِها ويُرفضُ الاستمرارُ بصوتٍ عالٍ.
  const contamination = await sql<{ riders: number; drivers: number }[]>`
    select (select count(*)::int from users where telegram_id between ${riderLo} and ${riderHi}) riders,
           (select count(*)::int from users where telegram_id between ${driverLo} and ${driverHi}) drivers
  `;
  const contaminated = (contamination[0]?.riders ?? 0) > 0 || (contamination[0]?.drivers ?? 0) > 0;
  if (contaminated) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "experiment.contaminated_block",
        verdict: "REFUSED_REUSED_IDENTITY_BLOCK",
        found: contamination[0],
        fix: "عيّن ISOLATE_RIDER_BASE/ISOLATE_DRIVER_BASE بكتلةٍ جديدةٍ لهذه الجولة",
      }),
    );
    return;
  }

  // جاهزيةٌ قبلَ التجربةِ: مدنٌ فعّالةٌ وعمقُ الطابورِ والطلباتُ الباحثةُ
  // المتبقيةُ من جولاتٍ سابقةٍ تُسجَّلُ (لا يُفترضُ صفاءً) لأنها تنافسُ على العروض.
  const readiness = await sql<
    { cities: number; queue: number; outboxPending: number; leftoverSearching: number }[]
  >`
    select (select count(*)::int from cities where is_active) as cities,
           (select count(*)::int from telegram_update_jobs where status in ('pending','claimed')) as queue,
           (select count(*)::int from notification_outbox where status in ('pending','sending')) as "outboxPending",
           (select count(*)::int from orders where status = 'searching') as "leftoverSearching"
  `;
  const ready = readiness[0];
  if (ready === undefined || ready.cities < 1) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "experiment.readiness",
        verdict: "NOT_PROVEN_NO_ACTIVE_CITY",
      }),
    );
    return;
  }
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "experiment.readiness",
      activeCities: ready.cities,
      inboundQueueDepth: ready.queue,
      outboxPendingStart: ready.outboxPending,
      leftoverSearchingOrders: ready.leftoverSearching,
    }),
  );

  // التجربةُ الرابعةُ: تعطيلُ صادرِ تيليجرام فعلًا — إيقافُ المحاكي (مسارُ
  // الإشعاراتِ الخارجي) قبلَ الحملِ، معَ تحققٍ فعليٍّ من غيابِهِ، وإعادتُهُ بعدَهُ
  // في finally معَ تحققٍ من عودتِهِ. الحكمَ يبقى للقاعدةِ.
  const telegramDisabled = spec.name === "A-with-telegram-down";
  const startedAt = new Date();
  let a: { done: Promise<void>; kill: () => void } | null = null;
  let b: { done: Promise<void>; kill: () => void } | null = null;
  try {
    if (telegramDisabled) {
      const code = await runSvc("stop-mock");
      const healthy = await mockHealthy();
      log(
        JSON.stringify({
          t: new Date().toISOString(),
          event: "telegram_down.applied",
          svcExit: code,
          mockVerifiedDown: !healthy,
        }),
      );
      if (healthy) {
        // لم ينقطعِ المحاكي فعليًا — لا يُدّعى التعطيلُ ويُرفضُ الاستمرارُ.
        log(
          JSON.stringify({
            t: new Date().toISOString(),
            event: "telegram_down.failed",
            verdict: "REFUSED_MOCK_STILL_UP",
          }),
        );
        return;
      }
    }

    const aEnv = {
      RUN_DIR,
      GEN_ID: `iso-${spec.name}`,
      PROFILE: spec.aProfile,
      SCENARIO_DEPTH: process.env.ISOLATE_DEPTH === "assign" ? "assign" : "full",
      RIDER_SEQ_START: String(riderLo),
      DRIVER_SEQ_START: String(driverLo),
    };
    a = runGenerator("deploy/capacity-run/load/miniapp-load.ts", aEnv);
    if (spec.bProfile !== null) {
      b = runGenerator("deploy/capacity-run/load/telegram-load.ts", {
        RUN_DIR,
        GEN_ID: `iso-${spec.name}-B`,
        PROFILE: spec.bProfile,
      });
    }
    await a.done;
    a = null;
    if (b !== null) {
      // إيقافٌ منظمٌ لمولّدِ «ب»: يُمهَلُ حتى يكتبَ خلاصتَهُ (gen.end) لا يُقتلُ
      // فيضيعَ الدليلُ — ثمّ يُقتلُ إن تجاوزَ المهلةَ.
      // يُمهَلُ حتى يكتبَ خلاصتَهُ (gen.end) فلا يضيعَ الدليلُ — لكنّهُ لا يخرجُ
      // ذاتيًا (حلقةُ الرصدِ لا تنتهي) فيُقتلُ بعدَ الخلاصةِ أو المهلةِ.
      const genEndWritten = await waitForBGenEnd(`iso-${spec.name}-B`, 20_000);
      if (genEndWritten) await sleep(1_000);
      b.kill();
      await b.done;
      b = null;
    }
  } finally {
    if (telegramDisabled) {
      // إعادةُ المحاكي في finally — حتى لو فشلَ الحملُ لا يبقى البيئةُ معطلةً.
      const code = await runSvc("mock");
      // التحققُ بإعادةِ المحاولةِ: الإقلاعُ ليسَ لحظيًا فحتى 10ث قبلَ الحكمِ
      let healthy = await mockHealthy();
      for (let i = 0; i < 10 && !healthy; i += 1) {
        await sleep(1_000);
        healthy = await mockHealthy();
      }
      log(
        JSON.stringify({
          t: new Date().toISOString(),
          event: "telegram_down.restored",
          svcExit: code,
          mockVerifiedUp: healthy,
        }),
      );
    }
  }

  // الحكمُ منَ القاعدةِ مقيدًا بكتلةِ هوياتِ هذهِ التجربةِ — منسوبٌ لها وحدها.
  // (orders.rider_id يشيرُ إلى riders.id وriders.user_id إلى users.id.)
  const outcomes = await sql<{ status: string; count: string }[]>`
    select o.status::text as status, count(*)::text as count
      from orders o
      join riders rd on rd.id = o.rider_id
      join users u on u.id = rd.user_id
     where u.telegram_id between ${riderLo} and ${riderHi}
     group by 1 order by 1
  `;
  const duplicates = await sql<{ count: string }[]>`
    select count(*)::text as count from (
      select o.assigned_driver_id from orders o
       where o.assigned_driver_id is not null
         and is_driver_engaged_order_status(o.status)
         and exists (
           select 1 from drivers dd
             join users du on du.id = dd.user_id
            where dd.id = o.assigned_driver_id
              and du.telegram_id between ${driverLo} and ${driverHi})
       group by o.assigned_driver_id having count(*) > 1
    ) as d
  `;
  const seeded = await sql<{ riders: number; drivers: number }[]>`
    select (select count(*)::int from users where telegram_id between ${riderLo} and ${riderHi}) riders,
           (select count(*)::int from users where telegram_id between ${driverLo} and ${driverHi}) drivers
  `;

  // إحصاءُ مخرجاتِ مولّدِ المسارِ «أ» نفسِهِ — قياسُ التوقّعِ مقابلَ القاعدةِ
  const generatorOutcomes = countGeneratorOutcomes(`iso-${spec.name}`);

  // إحصاءُ 429 الواردِ منَ مولّدِ المسارِ «ب» في هذهِ التجربةِ (منَ سجلّهِ)
  const bStats = spec.bProfile === null ? null : readBStats(`iso-${spec.name}-B`);

  // صندوقُ الصادرِ خلالَ نافذةِ التجربةِ: تسليمٌ ومعلّقٌ وميتٌ وتأخيرُ التسليمِ
  // الفعليُّ (delivered_at − created_at) بتوزيعِهِ الكاملِ بلا فلترٍ يحيدُه.
  const outbox = await sql<
    {
      status: string;
      count: string;
      p50: string | null;
      p95: string | null;
      max_s: string | null;
    }[]
  >`
    select status::text as status, count(*)::text as count,
           percentile_disc(0.5) within group (order by extract(epoch from (delivered_at - created_at)))::text as p50,
           percentile_disc(0.95) within group (order by extract(epoch from (delivered_at - created_at)))::text as p95,
           max(extract(epoch from (delivered_at - created_at)))::text as max_s
      from notification_outbox
     where created_at >= ${startedAt}
     group by 1 order by 1
  `;

  const totalOrders = outcomes.reduce((sum, r) => sum + Number(r.count), 0);
  const countOf = (status: string): number =>
    Number(outcomes.find((r) => r.status === status)?.count ?? 0);
  const matchedCount = countOf("matched") + countOf("driver_arrived") + countOf("ride_started");
  const completedCount = countOf("completed");
  const depthIsAssign = process.env.ISOLATE_DEPTH === "assign";
  // البوابة: دورة أعمال مكتملة من القاعدة (completed>0 في الوضع الكامل،
  // matched>0 في وضع الإسناد) — وجود طلب «باحث» وحده لا يثبت شيئًا.
  let verdict: string;
  if (totalOrders === 0) {
    verdict = "EMPTY_INVALID_PROOF";
  } else if (depthIsAssign ? matchedCount === 0 : completedCount === 0) {
    verdict = "ORDERS_EXIST_NO_COMPLETED_BUSINESS_CYCLE";
  } else {
    verdict = "NONEMPTY_DB_VERIFIED";
  }
  // تجربة ضغط الويبهوك تثبت بوابتها 429>0 فعلًا — وإلا فالحكم غير مثبت.
  const bStatsRec = bStats as { webhookInbound429?: unknown } | null;
  const b429 = Number(bStatsRec?.webhookInbound429 ?? 0);
  if (spec.name === "A-with-webhook-pressure" && verdict === "NONEMPTY_DB_VERIFIED") {
    verdict = b429 > 0 ? "NONEMPTY_DB_VERIFIED_WEBHOOK_429_PROVEN" : "WEBHOOK_429_NOT_PROVEN";
  }
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "experiment.end",
      name: spec.name,
      windowStartedAt: startedAt.toISOString(),
      ordersByStatus: outcomes,
      ordersInBlock: totalOrders,
      matchedInBlock: matchedCount,
      completedInBlock: completedCount,
      seeded: seeded[0] ?? null,
      generatorOutcomes,
      bStats,
      bWebhookInbound429: b429,
      outboxWindow: outbox,
      outboxMockCorrelation: await correlateOutboxWithMock(startedAt),
      i1Duplicates: Number(duplicates[0]?.count ?? "0"),
      verdict,
    }),
  );
}

/** انتظار كتابة مولّد «ب» خلاصته (gen.end) قبل قتله — لا يُفقد الدليل. */
/** ربطُ تسليماتِ صندوقِ الصادرِ بأحداثِ المحاكي عبرَ معرّفِ الرسالةِ — عينةً
 *  فعليةً تُثبتُ أنَّ «delivered» في القاعدةِ يقابلُهُ حدثُ استقبالٍ ناجحٌ
 *  عندَ الحدِّ الخارجيِّ (المحاكي)، لا مجردَ تغييرِ حالةٍ داخليٍّ. */
async function correlateOutboxWithMock(
  startedAt: Date,
): Promise<{ deliveredRows: number; withMessageId: number; matchedInMock: number } | null> {
  try {
    const delivered = await sql<{ mid: string | null }[]>`
      select delivered_message_id::text as mid from notification_outbox
       where created_at >= ${startedAt} and status = 'delivered'
    `;
    const withId = delivered.filter((r) => r.mid !== null);
    const mockIds = new Set<string>();
    try {
      const lines = readFileSync(`${EV}/telegram-mock.jsonl`, "utf8").split("\n");
      for (const line of lines) {
        const m = /"message_id":(\d+)/.exec(line);
        if (m?.[1] !== undefined) mockIds.add(m[1]);
      }
    } catch {
      // سجل المحاكي غير موجود — يُسجل الربط ناقصًا لا مختلقًا
    }
    const matched = withId.filter((r) => mockIds.has(r.mid ?? "")).length;
    return {
      deliveredRows: delivered.length,
      withMessageId: withId.length,
      matchedInMock: matched,
    };
  } catch {
    return null;
  }
}

async function waitForBGenEnd(genId: string, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(`${EV}/telegram-load-events.jsonl`, "utf8").split("\n");
      const written = lines.some(
        (line) => line.includes(`"gen":"${genId}"`) && line.includes('"event":"gen.end"'),
      );
      if (written) return true;
    } catch {
      // السجل لم يُنشأ بعد
    }
    await sleep(1_000);
  }
  return false;
}

async function main() {
  let index = 0;
  for (const spec of EXPERIMENTS) {
    await experiment(spec, index);
    index += 1;
  }
  // تجربةٌ خامسةٌ صريحةٌ: زرُّ عملٍ قديمٌ عبرَ webhook لا يغيّرُ حالةً — المسارُ
  // القديمُ للقبولِ مغلقٌ والحكمُ للقاعدةِ.
  await legacyCallbackProbe();
  await sql.end({ timeout: 5 });
  log(JSON.stringify({ t: new Date().toISOString(), event: "isolate.done" }));
}

/**
 * مسبارُ المسارِ القديمِ بعرضٍ حيٍّ لا بمعرّفٍ خياليٍّ: يُنشئُ طلبًا حقيقيًا
 * (راكبٌ + سائقٌ مؤهلٌ عبرَ Mini App HTTP)، ينتظرُ ظهورَ عرضِهِ على لوحِ
 * السائقِ، ثمّ يرسلُ زرَّ قبولٍ قديمًا (`offer:accept`) عبرَ webhook — وينتظرُ
 * معالجةَ الواردِ فعلًا — فإن لم يتغيرْ إسنادُ الطلبِ فهذا دليلٌ أنَّ المسارَ
 * القديمَ لا يُنجزُ الأعمالَ. ثمّ يُقبلُ العرضُ منَ واجهةِ Mini App ويُتحققُ
 * منَ الإسنادِ في القاعدةِ — فإثباتُ الإغلاقِ لا يكتملُ إلا بإتمامِ العملِ
 * منَ الواجهةِ المعتمدةِ بعدَ رفضِ القديمِ.
 */
async function legacyCallbackProbe(): Promise<void> {
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const RIDER_BOT_TOKEN = process.env.RIDER_BOT_TOKEN ?? "";
  const DRIVER_BOT_TOKEN = process.env.DRIVER_BOT_TOKEN ?? "";
  const CITY = process.env.CITY ?? "JED";
  const riderTg = RIDER_BLOCK_BASE + 90_000;
  const driverTg = DRIVER_BLOCK_BASE + 90_000;

  // بذرُ الهويتين كما في المولدِ (تأسيسٌ لا عملٌ)
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values ((select id from cities where code = ${CITY}), ${riderTg}::bigint,
            'مسبار قديم راكب', '+96650000090', 'rider'::user_role, 'ar')
    on conflict (telegram_id) do nothing
  `;
  await sql`
    insert into riders (city_id, user_id)
    values ((select id from cities where code = ${CITY}),
            (select id from users where telegram_id = ${riderTg}))
    on conflict (user_id) do nothing
  `;
  await sql`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values ((select id from cities where code = ${CITY}), ${driverTg}::bigint,
            'مسبار قديم سائق', '+96650000091', 'driver'::user_role, 'ar')
    on conflict (telegram_id) do nothing
  `;
  const driverRows = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
    values ((select id from cities where code = ${CITY}),
            (select id from users where telegram_id = ${driverTg}),
            'verified'::verification_status, 'أ ب ج 9900', 'sedan')
    on conflict (user_id) do update set verification_status = 'verified'::verification_status
    returning id
  `;
  const driverId = driverRows[0]?.id;
  if (driverId === undefined) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "legacy_callback_probe",
        verdict: "NOT_PROVEN_SEED_FAILED",
      }),
    );
    return;
  }
  await sql`
    insert into driver_capabilities (city_id, driver_id, service)
    values ((select id from cities where code = ${CITY}), ${driverId}::uuid, 'transport')
    on conflict do nothing
  `;
  await sql`
    select start_trial(${driverId}::uuid, 'transport'::subscription_plan)
     where not exists (select 1 from subscriptions s where s.driver_id = ${driverId}::uuid)
  `;

  // الجلساتُ الموقعةُ — كما في التطبيقِ الحقيقيِّ
  const riderInit = signedInitData({ botToken: RIDER_BOT_TOKEN, telegramId: riderTg });
  const driverInit = signedInitData({ botToken: DRIVER_BOT_TOKEN, telegramId: driverTg });
  const riderSession = await http("/v1/session/telegram", {
    method: "POST",
    body: { initData: riderInit },
    timeoutMs: 15_000,
  });
  const driverSession = await http("/v1/session/telegram", {
    method: "POST",
    body: { initData: driverInit },
    timeoutMs: 15_000,
  });
  if (!riderSession.ok || !driverSession.ok) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "legacy_callback_probe",
        verdict: "NOT_PROVEN_SESSION_FAILED",
      }),
    );
    return;
  }
  const riderToken = (riderSession.body as { accessToken?: string } | null)?.accessToken ?? null;
  const driverToken = (driverSession.body as { accessToken?: string } | null)?.accessToken ?? null;
  if (riderToken === null || driverToken === null) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "legacy_callback_probe",
        verdict: "NOT_PROVEN_NO_TOKEN",
      }),
    );
    return;
  }

  // طلبٌ حقيقيٌّ عبرَ واجهةِ الراكبِ
  const create = await http("/v1/rides", {
    method: "POST",
    token: riderToken,
    headers: { "idempotency-key": `probe-${Date.now()}` },
    body: {
      service: "transport",
      originLat: 21.4858,
      originLng: 39.1925,
      destinationLat: 21.5,
      destinationLng: 39.2,
    },
    timeoutMs: 20_000,
  });
  if (!create.ok || create.body === null || create.body.accepted !== true) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "legacy_callback_probe",
        verdict: "NOT_PROVEN_RIDE_CREATE_FAILED",
      }),
    );
    return;
  }
  const orderId = (create.body as { orderId?: string }).orderId;
  if (typeof orderId !== "string") {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "legacy_callback_probe",
        verdict: "NOT_PROVEN_NO_ORDER_ID",
      }),
    );
    return;
  }

  // السائقُ متاحٌ قربَ نقطةِ الالتقاطِ
  await http("/v1/driver/availability", {
    method: "POST",
    token: driverToken,
    body: { is_available: true },
    timeoutMs: 15_000,
  });
  await http("/v1/driver/location", {
    method: "POST",
    token: driverToken,
    body: { latitude: 21.4859, longitude: 39.1926, accuracyMeters: 10 },
    timeoutMs: 15_000,
  });

  // انتظارُ ظهورِ العرضِ على اللوحِ — منَ الواجهةِ لا منَ القاعدةِ
  let offerId: string | null = null;
  const offerDeadline = Date.now() + 60_000;
  while (offerId === null && Date.now() < offerDeadline) {
    const board = await http("/v1/driver/offers", { token: driverToken, timeoutMs: 15_000 });
    if (
      board.ok &&
      board.body !== null &&
      Array.isArray((board.body as { offers?: unknown }).offers)
    ) {
      const match = ((board.body as { offers: Record<string, unknown>[] }).offers ?? []).find(
        (offer) => offer.order_id === orderId,
      );
      const found = match?.offer_id ?? match?.id;
      if (typeof found === "string") offerId = found;
    }
    if (offerId === null) await sleep(2_000);
  }
  if (offerId === null) {
    log(
      JSON.stringify({
        t: new Date().toISOString(),
        event: "legacy_callback_probe",
        verdict: "NOT_PROVEN_NO_LIVE_OFFER",
      }),
    );
    return;
  }

  // زرُّ قبولٍ قديمٌ عبرَ webhook على عرضٍ حيٍّ — ثمّ انتظارُ معالجةِ الواردِ فعلًا
  const before = await sql<{ status: string; assigned: string | null }[]>`
    select status::text as status, assigned_driver_id::text as assigned from orders where id = ${orderId}
  `;
  const chat = driverTg;
  const update = JSON.stringify({
    update_id: Math.floor(Date.now() / 1000) % 1_000_000_000,
    callback_query: {
      id: String(Date.now()),
      from: { id: chat, is_bot: false, first_name: "probe" },
      message: { chat: { id: chat }, date: Math.floor(Date.now() / 1000), text: "x" },
      data: `offer:accept:${offerId}`,
    },
  });
  let status = -1;
  try {
    const response = await fetch(`${BASE}/webhook/telegram/driver`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET,
      },
      body: update,
      signal: AbortSignal.timeout(10_000),
    });
    status = response.status;
    await response.arrayBuffer();
  } catch {
    status = 0;
  }
  // انتظارُ تصريفِ طابورِ الواردِ — المعالجةُ الفعليةُ لا مجردُ استقبالِ الطلبِ
  const drainDeadline = Date.now() + 30_000;
  let queueDepth = -1;
  while (Date.now() < drainDeadline) {
    const q = await sql<{ q: number }[]>`
      select count(*)::int q from telegram_update_jobs where status in ('pending','claimed')
    `;
    queueDepth = q[0]?.q ?? -1;
    if (queueDepth === 0) break;
    await sleep(1_000);
  }
  await sleep(3_000);

  const after = await sql<{ status: string; assigned: string | null }[]>`
    select status::text as status, assigned_driver_id::text as assigned from orders where id = ${orderId}
  `;
  const legacyAssigned =
    after[0]?.assigned !== null &&
    after[0]?.assigned !== undefined &&
    after[0]?.assigned !== before[0]?.assigned;

  // القبولُ منَ الواجهةِ المعتمدةِ — إتمامُ العملِ منْ حيثُ ينبغي
  const accept = await http(`/v1/driver/offers/${offerId}/accept`, {
    method: "POST",
    token: driverToken,
    timeoutMs: 20_000,
  });
  let apiAssigned = false;
  if (accept.ok) {
    const settleDeadline = Date.now() + 30_000;
    while (Date.now() < settleDeadline && !apiAssigned) {
      const state = await sql<{ status: string; assigned: string | null }[]>`
        select status::text as status, assigned_driver_id::text as assigned from orders where id = ${orderId}
      `;
      const row = state[0];
      if (row?.status === "matched" && row.assigned === driverId) apiAssigned = true;
      if (!apiAssigned) await sleep(2_000);
    }
  }

  const verdict = legacyAssigned
    ? "LEGACY_PATH_CHANGED_STATE_FAIL"
    : apiAssigned
      ? "LEGACY_BUSINESS_PATH_CLOSED"
      : "API_ACCEPT_DID_NOT_ASSIGN";
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "legacy_callback_probe",
      orderId,
      offerId,
      webhookStatus: status,
      webhookQueueDrainedTo: queueDepth,
      legacyCallbackAssigned: legacyAssigned,
      apiAcceptAssigned: apiAssigned,
      verdict,
    }),
  );
}

void main();
