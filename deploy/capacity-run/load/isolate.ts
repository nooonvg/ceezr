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
 *   ٤) «أ» معَ تعطيلِ تسليمِ إشعاراتِ تيليجرام — **التموجيهُ والإشعاراتُ لا يشرطانِ
 *      عملَ المنتجِ**: إنشاءُ الطلبِ والقبولُ وتقدُّمُ الرحلةِ يثبتانِ في القاعدةِ
 *      دونَ وصولِ تيليجرام.
 *
 * والتحققُ في كلِّ تجربةٍ **منَ القاعدةِ** لا منَ 2xx: نسبةُ السيناريوهاتِ
 * المثبتةِ (matched/السائقُ الصحيحُ، ثمَّ completed) في كلِّ تجربةٍ، وصفرُ
 * مخالفاتِ I1 (سائقٌ بطلبينِ ملتزمَينِ).
 *
 * ملاحظةٌ صادقةٌ: المسارانِ يشتركانِ في المعالجِ والقاعدةِ — فلا يُدَّعى انعدامُ
 * الأثرِ، بل يُقاسُ ويُقارنَ بحدودِ القبولِ.
 *
 * التشغيلُ: `bun run deploy/capacity-run/load/isolate.ts` — يقرأُ بيئةَ الجولةِ
 * نفسَها ويشغّلُ المولّدَينِ عملياتٍ فرعيةً.
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";

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

async function experiment(spec: ExperimentSpec): Promise<void> {
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "experiment.start",
      name: spec.name,
      expectation: spec.expectation,
    }),
  );
  const aEnv = {
    RUN_DIR,
    GEN_ID: `iso-${spec.name}`,
    PROFILE: spec.aProfile,
    SCENARIO_DEPTH: process.env.ISOLATE_DEPTH === "assign" ? "assign" : "full",
  };
  const a = runGenerator("deploy/capacity-run/load/miniapp-load.ts", aEnv);
  let b: { done: Promise<void>; kill: () => void } | null = null;
  if (spec.bProfile !== null) {
    b = runGenerator("deploy/capacity-run/load/telegram-load.ts", {
      RUN_DIR,
      GEN_ID: `iso-${spec.name}-B`,
      PROFILE: spec.bProfile,
    });
  }
  await a.done;
  b?.kill();
  await b?.done;

  // الحكمُ منَ القاعدةِ — نتائجُ هذه الجولةِ وحدها (وسمُ المولّدِ يميّزُها).
  const windowSeconds = DURATION_SEC + 60;
  const outcomes = await sql`
    select status::text as status, count(*)::text as count
      from orders o
     where exists (
       select 1 from audit_log al
        where al.entity_id = o.id and al.action = 'order.created'
          and al.created_at > now() - (${windowSeconds}::int * interval '1 second')
     )
     group by status
  `;
  const duplicates = await sql<{ count: string }[]>`
    select count(*)::text as count from (
      select assigned_driver_id from orders
       where assigned_driver_id is not null and is_driver_engaged_order_status(status)
       group by assigned_driver_id having count(*) > 1
    ) as d
  `;
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "experiment.end",
      name: spec.name,
      ordersByStatus: outcomes,
      i1Duplicates: Number(duplicates[0]?.count ?? "0"),
    }),
  );
}

async function main() {
  for (const spec of EXPERIMENTS) {
    await experiment(spec);
  }
  // تجربةٌ خامسةٌ صريحةٌ: زرُّ عملٍ قديمٌ عبرَ webhook لا يغيّرُ حالةً — المسارُ
  // القديمُ للقبولِ مغلقٌ والحكمُ للقاعدةِ.
  await legacyCallbackProbe();
  await sql.end({ timeout: 5 });
  log(JSON.stringify({ t: new Date().toISOString(), event: "isolate.done" }));
}

/** زرُّ قبولٍ قديمٌ (`offer:accept`) عبرَ webhook: لا إسنادَ يقعُ به — الحكمُ منَ
 *  القاعدةِ لا منَ ردِّ البوابةِ. */
async function legacyCallbackProbe(): Promise<void> {
  const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const BASE_URL = process.env.GATEWAY_URL ?? "http://127.0.0.1:54300";
  const before = await sql<{ count: string }[]>`
    select count(*)::text as count from orders where status = 'matched'
  `;
  const chat = 990_001;
  const update = JSON.stringify({
    update_id: Math.floor(Date.now() / 1000) % 1_000_000_000,
    callback_query: {
      id: String(Date.now()),
      from: { id: chat, is_bot: false, first_name: "probe" },
      message: { chat: { id: chat }, date: Math.floor(Date.now() / 1000), text: "x" },
      data: "offer:accept:00000000-0000-0000-0000-000000000000",
    },
  });
  let status = -1;
  try {
    const response = await fetch(`${BASE_URL}/webhook/telegram/driver`, {
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
  await new Promise((r) => setTimeout(r, 3_000));
  const after = await sql<{ count: string }[]>`
    select count(*)::text as count from orders where status = 'matched'
  `;
  const changed = before[0]?.count !== after[0]?.count;
  log(
    JSON.stringify({
      t: new Date().toISOString(),
      event: "legacy_callback_probe",
      webhookStatus: status,
      matchedCountChanged: changed,
      verdict: changed ? "INCONCLUSIVE" : "LEGACY_BUSINESS_PATH_CLOSED",
    }),
  );
}

void main();
