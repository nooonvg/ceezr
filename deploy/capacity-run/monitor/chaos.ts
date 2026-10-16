/* biome-ignore-all lint/style/noNonNullAssertion: أداة حقن أعطال تجريبية */
/**
 * CAP-RUN-20261016 — منسّقُ حقنِ الأعطال (عمليةٌ مستقلةٌ عن البوابةِ والمولّد).
 * جدولٌ زمنيٌّ ثابت (CHAOS_PLAN بالدقائق من SOAK_START_MS). كل حقنٍ يُسجَّل: البدء، الانتهاء،
 * زمن عودة /ready، وحالة الطوابير بعد 60ث (sending/claimed العالقة). لا spawnSync: كل أمر خارجي
 * Bun.spawn بمهلة، فلا يتجمد المنسّق إن تعطل أمر.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";

const RUN_DIR = process.env.RUN_DIR!;
const EV = `${RUN_DIR}/evidence`;
const HERE = new URL(".", import.meta.url).pathname;
const SVC = `${HERE}../svc.sh`;
const START = Number(process.env.SOAK_START_MS ?? Date.now());
const B = "/srv/ceezr-cap-20261016";
const DB = "postgres://postgres@127.0.0.1:55432/ceezr_cap_20261016";
type Step = { at_min: number; action: string; arg?: number };
const PLAN: Step[] = JSON.parse(
  process.env.CHAOS_PLAN ??
    JSON.stringify([
      { at_min: 8, action: "pg_terminate_backends" },
      { at_min: 14, action: "db_lock_delay", arg: 8 },
      { at_min: 20, action: "gateway_kill9_restart", arg: 5 },
      { at_min: 27, action: "redis_pause", arg: 10 },
      { at_min: 33, action: "shim_kill_restart", arg: 5 },
      { at_min: 38, action: "pg_restart" },
      { at_min: 45, action: "gateway_graceful_restart" },
      { at_min: 52, action: "redis_restart_persisted" },
      { at_min: 56, action: "gateway_kill9_restart", arg: 3 },
    ]),
);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Record<string, unknown>[] = [];
function tl(o: Record<string, unknown>) {
  appendFileSync(
    `${EV}/timeline.jsonl`,
    `${JSON.stringify({ t: new Date().toISOString(), minute: +((Date.now() - START) / 60000).toFixed(2), source: "chaos", ...o })}\n`,
  );
}
async function sh(
  cmd: string[],
  timeoutMs = 30_000,
): Promise<{ code: number | null; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => p.kill(9), timeoutMs);
  const [out, errOut] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code, out: (out + errOut).slice(0, 400) };
}
async function readyAt(maxMs: number): Promise<number | null> {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    try {
      const r = await fetch("http://127.0.0.1:54300/ready", { signal: AbortSignal.timeout(1500) });
      if (r.status === 200) return Date.now() - t;
    } catch {}
    await sleep(250);
  }
  return null;
}
async function q<T>(f: (s: postgres.Sql) => Promise<T>): Promise<T | { error: string }> {
  const s = postgres(`${DB}?application_name=cap-chaos`, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 2,
  });
  try {
    return await Promise.race([f(s), sleep(10_000).then(() => ({ error: "timeout" }) as never)]);
  } catch (e) {
    return { error: String((e as Error).message).slice(0, 120) };
  } finally {
    s.end({ timeout: 1 }).catch(() => {});
  }
}
const queueState = () =>
  q(
    async (s) =>
      (
        await s`select
      (select count(*)::int from notification_outbox where status='sending') outbox_sending,
      (select count(*)::int from notification_outbox where status='sending' and claimed_at < now() - interval '5 minutes') outbox_sending_over_5m,
      (select count(*)::int from telegram_update_jobs where status='claimed') jobs_claimed,
      (select count(*)::int from telegram_update_jobs where status='claimed' and claimed_at < now() - interval '60 seconds') jobs_claimed_over_60s,
      (select count(*)::int from telegram_update_jobs where status='dead') jobs_dead,
      (select count(*)::int from notification_outbox where status='dead') outbox_dead`
      )[0],
  );
// -u: عمليات المستخدم وحدها — بدونه يطابق pgrep غلافَ sudo (root) فيفشل kill بـEPERM (عيبُ أداةٍ مقيس في الدقيقة 20)
const gatewayPid = async () =>
  (
    await sh([
      "pgrep",
      "-u",
      String(process.getuid?.() ?? 1000),
      "-f",
      "[a]pps/gateway/src/index.ts",
    ])
  ).out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number)
    .filter((p) => p > 0);

async function inject(step: Step) {
  const t0 = Date.now();
  const rec: Record<string, unknown> = {
    ...step,
    started_at: new Date().toISOString(),
    before: await queueState(),
  };
  tl({ event: "fault.start", action: step.action });
  try {
    switch (step.action) {
      case "pg_terminate_backends": {
        rec.result = await q(
          async (s) =>
            (
              await s`select count(*)::int n from (select pg_terminate_backend(pid) from pg_stat_activity
            where datname=current_database() and pid<>pg_backend_pid() and application_name not in ('cap-monitor','cap-chaos','gen1','gen2')) x`
            )[0],
        );
        break;
      }
      case "db_lock_delay": {
        const secs = step.arg ?? 8;
        rec.result = await q(async (s) =>
          s.begin(async (tx) => {
            await tx`set local lock_timeout = '5s'`;
            await tx`lock table notification_outbox, telegram_update_jobs, orders in exclusive mode`;
            await tx`select pg_sleep(${secs})`;
            return { held_s: secs };
          }),
        );
        break;
      }
      case "gateway_kill9_restart": {
        const pids = await gatewayPid();
        for (const p of pids) process.kill(p, "SIGKILL");
        rec.killed = pids;
        await sleep((step.arg ?? 5) * 1000);
        rec.restart = await sh(["bash", SVC, "gateway"], 60_000);
        break;
      }
      case "gateway_graceful_restart": {
        const pids = await gatewayPid();
        for (const p of pids) process.kill(p, "SIGTERM");
        const t = Date.now();
        while ((await gatewayPid()).length && Date.now() - t < 40_000) await sleep(250);
        rec.graceful_exit_ms = Date.now() - t;
        rec.restart = await sh(["bash", SVC, "gateway"], 60_000);
        break;
      }
      case "redis_pause": {
        rec.result = await sh([
          "redis-cli",
          "-p",
          "56379",
          "CLIENT",
          "PAUSE",
          String((step.arg ?? 10) * 1000),
          "ALL",
        ]);
        await sleep((step.arg ?? 10) * 1000);
        break;
      }
      case "shim_kill_restart": {
        rec.result = await sh(["bash", SVC, "stop-shim"]);
        await sleep((step.arg ?? 5) * 1000);
        rec.restart = await sh(["bash", SVC, "shim"]);
        break;
      }
      case "pg_restart": {
        // مطابق لآلية setup-env-20261016.sh: الإعداد كله من postgresql.conf
        // (بلا -o). الخيارات المضمّنة سابقًا كانت تشير لمجلد سوكيت $B/sock
        // غير الموجود — الفعلي $B/pg-sock من postgresql.conf — فيفشل إقلاع
        // PG بصمت بعد التوقف ويبقى ميتًا (قُتل في جولة 2026-10-16 الأولى
        // ولم يُعد إلا يدويًا). إضافة تحقق جاهزية مستقل بعد كل إعادة تشغيل
        // حتى تفشل الأداة بصوت عالٍ لا بصمت.
        rec.result = await sh(
          [
            "/usr/lib/postgresql/18/bin/pg_ctl",
            "-D",
            `${B}/pg`,
            "-m",
            "fast",
            "-w",
            "-t",
            "60",
            "-l",
            `${B}/pg.log`,
            "restart",
          ],
          90_000,
        );
        rec.pgReadyCheck = await sh(["pg_isready", "-h", "127.0.0.1", "-p", "55432"]);
        if (rec.pgReadyCheck.code !== 0) {
          rec.toolFailure = "pg_restart: أعاد التشغيل لكن pg_isready فشل — الأداة لا تدّعي النجاح";
        }
        break;
      }
      case "redis_restart_persisted": {
        rec.shutdown = await sh(["redis-cli", "-p", "56379", "SHUTDOWN", "SAVE"]);
        await sleep(1000);
        rec.restart = await sh([
          "redis-server",
          "--port",
          "56379",
          "--bind",
          "127.0.0.1",
          "--dir",
          `${B}/redis`,
          "--save",
          "",
          "--appendonly",
          "no",
          "--daemonize",
          "yes",
          "--logfile",
          `${B}/logs/redis.log`,
          "--pidfile",
          `${B}/redis/redis.pid`,
        ]);
        break;
      }
      default:
        rec.error = "unknown_action";
    }
  } catch (e) {
    rec.error = String(e).slice(0, 200);
  }
  rec.action_ms = Date.now() - t0;
  rec.ready_after_ms = await readyAt(120_000);
  rec.recovered = rec.ready_after_ms !== null;
  tl({
    event: "fault.end",
    action: step.action,
    recovered: rec.recovered,
    ready_after_ms: rec.ready_after_ms,
    error: rec.error ?? null,
    killed: rec.killed ?? null,
  });
  await sleep(60_000);
  rec.after_60s = await queueState();
  results.push(rec);
  writeFileSync(
    `${EV}/fault-injection.json`,
    JSON.stringify({ plan: PLAN, soak_start: new Date(START).toISOString(), results }, null, 2),
  );
}

tl({ event: "chaos.start", plan: PLAN });
for (const step of PLAN) {
  const due = START + step.at_min * 60_000;
  while (Date.now() < due) await sleep(Math.min(5000, due - Date.now()));
  await inject(step);
}
tl({ event: "chaos.end" });
process.exit(0);
