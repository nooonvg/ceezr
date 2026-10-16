/* biome-ignore-all lint/style/noNonNullAssertion: أداة مراقبة تجريبية */
/**
 * CAP-RUN-20261016 — مراقب مستقل عن العملية المختبرة.
 * - كل 10ث: مقاييس القاعدة والطوابير (outbox، telegram_update_jobs، الطلبات، العروض، الاتصالات، الأقفال)،
 *   زمن Redis، موارد العمليات من /proc، حالة /ready، إحصاءات المحاكي.
 * - عند الدقائق المجدولة (REPORT_MARKS، افتراضيًا 10..60 من SOAK_START) يكتب تقريرًا JSON + MD إلى القرص.
 * - كل خطوة داخل try/catch بمهلة: تعطل البوابة أو القاعدة لا يوقف المراقب، بل يُسجَّل.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import postgres from "postgres";

const RUN_DIR = process.env.RUN_DIR!;
const EV = `${RUN_DIR}/evidence`;
const REP = `${RUN_DIR}/reports`;
mkdirSync(EV, { recursive: true });
mkdirSync(REP, { recursive: true });
const DB_URL = process.env.DATABASE_URL!;
const START = Number(process.env.SOAK_START_MS ?? Date.now());
const MARKS = (process.env.REPORT_MARKS ?? "10,20,30,40,50,60").split(",").map(Number);
const END_MIN = Number(process.env.MONITOR_END_MIN ?? 75);
const sql = postgres(`${DB_URL}?application_name=cap-monitor`, {
  max: 2,
  idle_timeout: 30,
  connect_timeout: 5,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout:${label}`)), ms)),
  ]);
}
function line(file: string, o: unknown) {
  try {
    appendFileSync(`${EV}/${file}`, `${JSON.stringify(o)}\n`);
  } catch {}
}

async function dbMetrics() {
  const [m] = await sql<Record<string, unknown>[]>`
    select
      (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from notification_outbox group by 1) x) outbox_by_status,
      (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from notification_outbox where kind='offer' group by 1) x) outbox_offer_by_status,
      (select count(*) from notification_outbox where status='pending' and next_attempt_at <= now()) outbox_due,
      (select extract(epoch from now() - min(next_attempt_at)) from notification_outbox where status='pending' and next_attempt_at <= now()) outbox_oldest_due_s,
      (select extract(epoch from now() - min(claimed_at)) from notification_outbox where status='sending') outbox_oldest_sending_s,
      (select count(*) from notification_outbox where created_at > now() - interval '10 seconds') outbox_created_10s,
      (select count(*) from notification_outbox where delivered_at > now() - interval '10 seconds') outbox_delivered_10s,
      (select count(*) from notification_outbox where kind='offer' and created_at > now() - interval '10 seconds') offer_rows_created_10s,
      (select count(*) from notification_outbox where kind='offer' and delivered_at > now() - interval '10 seconds') offer_rows_delivered_10s,
      (select percentile_cont(array[0.5,0.95,0.99]) within group (order by extract(epoch from delivered_at - created_at))
         from notification_outbox where delivered_at > now() - interval '60 seconds') outbox_latency_60s,
      (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from telegram_update_jobs group by 1) x) update_jobs_by_status,
      (select extract(epoch from now() - min(created_at)) from telegram_update_jobs where status='pending') update_oldest_pending_s,
      (select count(*) from telegram_update_jobs where completed_at > now() - interval '10 seconds') updates_done_10s,
      (select count(*) from telegram_update_jobs where created_at > now() - interval '10 seconds') updates_in_10s,
      (select percentile_cont(array[0.5,0.95,0.99]) within group (order by extract(epoch from completed_at - created_at))
         from telegram_update_jobs where completed_at > now() - interval '60 seconds') update_latency_60s,
      (select coalesce(jsonb_object_agg(k, n), '{}') from (select service::text||'/'||status::text k, count(*) n from orders group by 1) x) orders,
      (select count(*) from orders where created_at > now() - interval '10 seconds') orders_created_10s,
      (select coalesce(jsonb_object_agg(status, n), '{}') from (select status::text, count(*) n from order_offers group by 1) x) offers,
      (select count(*) from order_offers where created_at > now() - interval '10 seconds') offers_created_10s,
      (select coalesce(jsonb_object_agg(status, n), '{}') from (select status::text, count(*) n from unsubscribed_negotiations group by 1) x) negotiations,
      (select count(*) from unsubscribed_claims) claims,
      (select coalesce(jsonb_object_agg(coalesce(state,'?'), n), '{}') from (select state, count(*) n from pg_stat_activity where datname = current_database() group by 1) x) pg_conns,
      (select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock') pg_lock_waits,
      (select count(*) from pg_locks where not granted) pg_locks_not_granted,
      (select coalesce(max(extract(epoch from now() - query_start)), 0) from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()) pg_longest_active_s,
      (select xact_commit + xact_rollback from pg_stat_database where datname = current_database()) pg_xacts,
      (select deadlocks from pg_stat_database where datname = current_database()) pg_deadlocks,
      pg_database_size(current_database()) db_bytes`;
  return m!;
}

let redisClient: InstanceType<typeof Bun.RedisClient> | null = null;
async function redisLatency() {
  redisClient ??= new Bun.RedisClient("redis://127.0.0.1:56379", {
    connectionTimeout: 2000,
    autoReconnect: true,
  });
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await withTimeout(redisClient.send("PING", []), 2000, "redis");
    out.push(+(performance.now() - t).toFixed(2));
  }
  const info = String(await withTimeout(redisClient.send("INFO", ["memory"]), 2000, "redis-info"));
  const mem = Number(info.match(/used_memory:(\d+)/)?.[1] ?? 0);
  return { ping_ms: out, used_memory: mem };
}

const prevCpu = new Map<number, number>();
let prevSys: { idle: number; total: number } | null = null;
const HZ = 100;
function procs() {
  const groups: Record<string, { pids: number[]; rss_mb: number; cpu_pct: number }> = {};
  const pat: [string, RegExp][] = [
    ["gateway", /apps\/gateway\/src\/index\.ts/],
    ["generator", /load\/capacity\.ts/],
    ["telegram_mock", /telegram-mock-server\.ts/],
    ["shim", /shim\.ts/],
    ["postgres", /^postgres|\/postgres /],
    ["redis", /redis-server/],
    ["monitor", /monitor\/monitor\.ts/],
  ];
  for (const ent of readdirSync("/proc")) {
    const pid = Number(ent);
    if (!pid) continue;
    try {
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      const g = pat.find(([, re]) => re.test(cmd))?.[0];
      if (!g || cmd.startsWith("sudo") || cmd.startsWith("bash")) continue;
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]!.split(" ");
      const ticks = Number(stat[11]) + Number(stat[12]);
      const rss =
        Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) /
        1024;
      const prev = prevCpu.get(pid);
      prevCpu.set(pid, ticks);
      const e = groups[g] ?? { pids: [], rss_mb: 0, cpu_pct: 0 };
      groups[g] = e;
      e.pids.push(pid);
      e.rss_mb += rss;
      if (prev !== undefined) e.cpu_pct += ((ticks - prev) / HZ / 10) * 100;
    } catch {}
  }
  for (const g of Object.values(groups)) {
    g.rss_mb = +g.rss_mb.toFixed(1);
    g.cpu_pct = +g.cpu_pct.toFixed(1);
  }
  const cpu = readFileSync("/proc/stat", "utf8").split("\n")[0]!.split(/\s+/).slice(1).map(Number);
  const idle = cpu[3]! + cpu[4]!;
  const total = cpu.reduce((a, b) => a + b, 0);
  let sysCpu = 0;
  if (prevSys) sysCpu = +(100 * (1 - (idle - prevSys.idle) / (total - prevSys.total))).toFixed(1);
  prevSys = { idle, total };
  const mi = readFileSync("/proc/meminfo", "utf8");
  const memAvail = Number(mi.match(/MemAvailable:\s+(\d+)/)![1]) / 1024;
  const memTotal = Number(mi.match(/MemTotal:\s+(\d+)/)![1]) / 1024;
  const load = readFileSync("/proc/loadavg", "utf8").split(" ").slice(0, 3).map(Number);
  return {
    groups,
    system: {
      cpu_pct: sysCpu,
      mem_used_mb: +(memTotal - memAvail).toFixed(0),
      mem_total_mb: +memTotal.toFixed(0),
      load,
    },
  };
}

async function ready() {
  try {
    const t = performance.now();
    const r = await fetch("http://127.0.0.1:54300/ready", { signal: AbortSignal.timeout(3000) });
    return { status: r.status, ms: +(performance.now() - t).toFixed(1) };
  } catch (e) {
    return { status: 0, error: (e as Error).name };
  }
}
async function mockStats() {
  try {
    return await (
      await fetch("http://127.0.0.1:58090/stats", { signal: AbortSignal.timeout(3000) })
    ).json();
  } catch (e) {
    return { error: (e as Error).name };
  }
}
function lastGen(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  try {
    const f = `${EV}/generator-metrics.jsonl`;
    if (!existsSync(f)) return out;
    const lines = readFileSync(f, "utf8").trim().split("\n");
    const byGen = new Map<string, Record<string, unknown>>();
    for (const l of lines.slice(-50)) {
      try {
        const o = JSON.parse(l);
        byGen.set(o.gen, o);
      } catch {}
    }
    out.push(...byGen.values());
  } catch {}
  return out;
}

const history: Record<string, unknown>[] = [];
const errors: Record<string, number> = {};
let crashes = 0;
let prevReady = 200;

async function sample() {
  const at = new Date().toISOString();
  const minute = +((Date.now() - START) / 60000).toFixed(2);
  const rec: Record<string, unknown> = { at, minute };
  try {
    rec.db = await withTimeout(dbMetrics(), 8000, "db");
  } catch (e) {
    rec.db_error = (e as Error).message.slice(0, 120);
    errors.db = (errors.db ?? 0) + 1;
  }
  try {
    rec.redis = await redisLatency();
  } catch (e) {
    rec.redis_error = (e as Error).message.slice(0, 120);
    errors.redis = (errors.redis ?? 0) + 1;
    redisClient = null;
  }
  rec.ready = await ready();
  const rs = (rec.ready as { status: number }).status;
  if (rs !== 200 && prevReady === 200) {
    crashes++;
    line("timeline.jsonl", {
      t: at,
      minute,
      source: "monitor",
      event: "gateway.not_ready",
      ready: rec.ready,
    });
  } else if (rs === 200 && prevReady !== 200)
    line("timeline.jsonl", { t: at, minute, source: "monitor", event: "gateway.ready_again" });
  prevReady = rs;
  rec.mock = await mockStats();
  line("database-metrics.jsonl", rec);
  const res = { at, minute, ...procs() };
  line("resources.jsonl", res);
  history.push({ ...rec, resources: res });
  if (history.length > 400) history.shift();
}

function pctOf(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

function writeReport(mark: number) {
  const gens = lastGen();
  const last = history[history.length - 1] ?? {};
  const win = history.filter((h) => (h.minute as number) > mark - 10);
  const db = (last.db ?? {}) as Record<string, unknown>;
  const cpu = win.map((h) => (h.resources as { system: { cpu_pct: number } }).system.cpu_pct);
  const gwRss = win.map(
    (h) =>
      (h.resources as { groups: Record<string, { rss_mb: number }> }).groups.gateway?.rss_mb ?? 0,
  );
  const notReady = win.filter((h) => (h.ready as { status: number }).status !== 200).length;
  const g = gens[0] as Record<string, unknown> | undefined;
  const rep = {
    mark_min: mark,
    written_at: new Date().toISOString(),
    phase: g?.phase,
    load: {
      target: g?.target,
      concurrency: g?.concurrency,
      peak_concurrency: g?.peakConcurrency,
      riders_busy: g?.riders_busy,
      drivers: g?.drivers,
      rps_window: g?.http_window?.rps,
      http: g?.http,
      http_window: g?.http_window,
      gateway_down_now: g?.gateway_down,
      outages: g?.outages,
    },
    generators: gens.map((x) => ({
      gen: x.gen,
      s: x.s,
      phase: x.phase,
      concurrency: x.concurrency,
    })),
    scenarios: g?.scenarios,
    business: g?.biz,
    db_now: db,
    window_10min: {
      samples: win.length,
      not_ready_samples: notReady,
      cpu_pct: {
        avg: +(cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)).toFixed(1),
        p95: pctOf(cpu, 0.95),
        max: Math.max(0, ...cpu),
      },
      gateway_rss_mb: { max: Math.max(0, ...gwRss), last: gwRss[gwRss.length - 1] },
      outbox_due_max: Math.max(
        0,
        ...win.map((h) => Number((h.db as Record<string, unknown>)?.outbox_due ?? 0)),
      ),
      outbox_oldest_due_s_max: Math.max(
        0,
        ...win.map((h) => Number((h.db as Record<string, unknown>)?.outbox_oldest_due_s ?? 0)),
      ),
      outbox_created: win.reduce(
        (a, h) => a + Number((h.db as Record<string, unknown>)?.outbox_created_10s ?? 0),
        0,
      ),
      outbox_delivered: win.reduce(
        (a, h) => a + Number((h.db as Record<string, unknown>)?.outbox_delivered_10s ?? 0),
        0,
      ),
      updates_in: win.reduce(
        (a, h) => a + Number((h.db as Record<string, unknown>)?.updates_in_10s ?? 0),
        0,
      ),
      updates_done: win.reduce(
        (a, h) => a + Number((h.db as Record<string, unknown>)?.updates_done_10s ?? 0),
        0,
      ),
      pg_conns_max: Math.max(
        0,
        ...win.map((h) =>
          Object.values(
            ((h.db as Record<string, unknown>)?.pg_conns ?? {}) as Record<string, number>,
          ).reduce((a, b) => a + Number(b), 0),
        ),
      ),
      redis_ping_max_ms: Math.max(
        0,
        ...win.flatMap((h) => ((h.redis as Record<string, unknown>)?.ping_ms ?? []) as number[]),
      ),
    },
    generator_errors: g?.errors,
    monitor_errors: errors,
    gateway_not_ready_transitions: crashes,
    load_is_flowing: (g?.http_window?.n ?? 0) > 0 && !g?.gateway_down,
  };
  const name = `report_${String(mark).padStart(2, "0")}min`;
  writeFileSync(`${REP}/${name}.json`, JSON.stringify(rep, null, 2));
  const w = rep.window_10min;
  const sc = Object.entries((g?.scenarios ?? {}) as Record<string, unknown>)
    .map(
      ([k, v]) =>
        `| ${k} | ${v.started} | ${v.ok} | ${v.fail} | ${Object.entries(v.reasons)
          .map(([r, n]) => `${r}:${n}`)
          .join(", ")} |`,
    )
    .join("\n");
  const md = `# تقرير الدقيقة ${mark} — ${rep.written_at}

- المرحلة: ${rep.phase} · الهدف: ${rep.load.target} · التزامن الفعلي: ${rep.load.concurrency} (الذروة ${rep.load.peak_concurrency}) · الزبائن المشغولون: ${rep.load.riders_busy}
- السائقون حسب الحالة: ${JSON.stringify(rep.load.drivers)}
- HTTP تراكمي: ${g?.http?.total} طلب · نجاح ${g?.http?.ok} · غير 2xx ${g?.http?.non2xx} · شبكة ${g?.http?.netErr} · p50/p95/p99 = ${g?.http?.p50}/${g?.http?.p95}/${g?.http?.p99} ms
- آخر 10ث: ${rep.load.rps_window} طلب/ث · p95 ${g?.http_window?.p95} ms
- الإشعارات (نافذة 10د): أُنشئ ${w.outbox_created} · سُلّم ${w.outbox_delivered} · أقصى مستحق ${w.outbox_due_max} · أقدم مستحق ${Number(w.outbox_oldest_due_s_max).toFixed(0)}ث
- outbox الآن: ${JSON.stringify(db.outbox_by_status)} · عروض: ${JSON.stringify(db.outbox_offer_by_status)}
- تحديثات تيليجرام (نافذة 10د): وارد ${w.updates_in} · مُعالج ${w.updates_done} · الآن ${JSON.stringify(db.update_jobs_by_status)}
- CPU النظام: متوسط ${w.cpu_pct.avg}% · p95 ${w.cpu_pct.p95}% · ذاكرة البوابة القصوى ${w.gateway_rss_mb.max}MB · أقصى اتصالات PG ${w.pg_conns_max} · أقصى PING لـ Redis ${w.redis_ping_max_ms}ms
- عينات «غير جاهزة»: ${w.not_ready_samples} · انقطاعات رصدها المولّد: ${rep.load.outages}
- هل الحمل مستمر؟ ${rep.load_is_flowing ? "نعم" : "لا/متوقف"}

| السيناريو | بدأ | نجح | فشل | الأسباب |
|---|---|---|---|---|
${sc}

أخطاء المولّد: ${JSON.stringify(rep.generator_errors)}
`;
  writeFileSync(`${REP}/${name}.md`, md);
  line("timeline.jsonl", {
    t: rep.written_at,
    minute: mark,
    source: "monitor",
    event: "report.written",
    file: `reports/${name}.json`,
  });
}

const done = new Set<number>();
line("timeline.jsonl", {
  t: new Date().toISOString(),
  source: "monitor",
  event: "monitor.start",
  soak_start: new Date(START).toISOString(),
  marks: MARKS,
});
for (;;) {
  const t = Date.now();
  try {
    await sample();
  } catch (e) {
    errors.sample = (errors.sample ?? 0) + 1;
    line("timeline.jsonl", {
      t: new Date().toISOString(),
      source: "monitor",
      event: "monitor.sample_error",
      error: String(e).slice(0, 200),
    });
  }
  const minute = (Date.now() - START) / 60000;
  for (const m of MARKS)
    if (minute >= m && !done.has(m)) {
      done.add(m);
      try {
        writeReport(m);
      } catch (e) {
        line("timeline.jsonl", {
          t: new Date().toISOString(),
          source: "monitor",
          event: "report.error",
          mark: m,
          error: String(e).slice(0, 200),
        });
      }
    }
  if (minute > END_MIN) break;
  await sleep(Math.max(0, 10_000 - (Date.now() - t)));
}
line("timeline.jsonl", { t: new Date().toISOString(), source: "monitor", event: "monitor.end" });
process.exit(0);
