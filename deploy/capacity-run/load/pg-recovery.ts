/* biome-ignore-all lint/style/noNonNullAssertion: أداة تجربة تعافي — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * CAP-RUN-20261016-CONTINUATION · المرحلة 2ب — تعافي البوابة من انقطاع PG.
 *
 * تجربتان منفصلتان في البيئة المعزولة (netns · loopback فقط):
 *   (أ) قتلُ خلفياتِ PG الخاصةِ بالبوابةِ فقط (pg_terminate_backend) بينما
 *       استعلاماتُ دورةِ أعمالٍ جاريةٌ — البوابةُ عمليةً واحدةً تبقى حيةً
 *       (نفسُ PID) وتستعيدُ عملَها، ثمَّ تكتملُ دورةُ الأعمالِ من Mini App
 *       حتى حالةٍ نهائيةٍ والتحققُ منَ القاعدةِ (لا تكرارَ ولا معاملاتٍ عالقة).
 *   (ب) إيقافُ PG كاملًا وإعادتُه **بالأداةِ المصححةِ** (فعل pg_restart في
 *       monitor/chaos.ts — نفسُ الأداةِ التي أثبتَت المرحلةُ 2أ إصلاحَها)،
 *       مع تسجيلِ: PID البوابةِ وPG قبلَ وبعدَ، زمنُ غيابِ الجاهزيةِ،
 *       جاهزيةُ PG **قبلَ** جاهزيةِ البوابةِ، بقاءُ العمليةِ حيةً بلا تدخلٍ
 *       يدويٍّ — ثمَّ دورةُ أعمالٍ كاملةٍ بعدَ التعافي والتحققُ منَ القاعدةِ.
 *
 * والتحققُ كلهُ حكمُ القاعدةِ لا 2xx: الإسنادُ للسائقِ الصحيحِ، الحالةُ
 * النهائيةُ completed، لا طلبٍ مكررٍ لنفسِ مفتاحِ التماثلِ، لا معاملاتٍ
 * عالقةً، ولا uncaughtException في سجلِّ البوابةِ.
 *
 * التشغيل: gen-r1.sh pgrec (داخل netns عبر nsx — كما بقيةُ المولداتِ).
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import postgres from "postgres";
import { BASE, http, signedInitData, sleep } from "./lib.ts";

const RUN_DIR = process.env.RUN_DIR ?? "/tmp/cap-run";
const EV = `${RUN_DIR}/evidence`;
mkdirSync(EV, { recursive: true });
const DB_URL = process.env.DATABASE_URL ?? "";
const CITY = process.env.CITY ?? "JED";
const B = "/srv/ceezr-cap-20261016";
/**
 * خلفياتُ البوابةِ في `pg_stat_activity`: كلُّ تجمُّعٍ يُسمّي نفسَه `ceezr:<دور>`
 * (`ceezr:gatewayRequest` · `ceezr:gatewayDispatch` · `ceezr:workerJobs` …، `apps/gateway/src/container.ts`).
 * الاسمُ القديمُ `postgres.js` لم يعُد يطابقُ شيئاً — فكانَ القتلُ يقتلُ صفراً والحكمُ ينجحُ (عيبٌ
 * مُكتشَفٌ 2026-10-19 على `main` @ e3e4b39c). جلسةُ التجربةِ `pg-recovery-exp` خارجَ النمطِ عمداً.
 */
const GATEWAY_BACKENDS = "ceezr:%";
/** سجلُّ البوابةِ — قد لا يكونُ في `RUN_DIR` هذا (البوابةُ تُطلَقُ بـ`RUN_DIR` آخر)؛ غيابُه نقصٌ مُعلَنٌ لا صفرٌ. */
const GATEWAY_LOG =
  process.env.GATEWAY_LOG ?? `${process.env.RUN_DIR ?? "/tmp/cap-run"}/evidence/gateway.log`;
const RIDER_BASE = Number(process.env.PGR_RIDER_BASE ?? 10_200_000);
const DRIVER_BASE = Number(process.env.PGR_DRIVER_BASE ?? 11_200_000);
const sql = postgres(`${DB_URL}?application_name=pg-recovery-exp`, {
  max: 4,
  idle_timeout: 20,
  connect_timeout: 10,
});
const RIDER_BOT_TOKEN = process.env.RIDER_BOT_TOKEN ?? "";
const DRIVER_BOT_TOKEN = process.env.DRIVER_BOT_TOKEN ?? "";

function log(o: Record<string, unknown>): void {
  appendFileSync(
    `${EV}/pg-recovery.jsonl`,
    `${JSON.stringify({ t: new Date().toISOString(), ...o })}\n`,
  );
}

async function sh(
  cmd: string[],
  timeoutMs = 30_000,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0] ?? "", cmd.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(9), timeoutMs);
    let out = "";
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.stderr?.on("data", (d) => {
      out += String(d);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out: out.slice(0, 400) });
    });
  });
}

/** PID عمليةِ البوابةِ (عمليةُ المستخدمِ وحدها — كما في أداةِ الفوضى). */
async function gatewayPids(): Promise<number[]> {
  const r = await sh([
    "pgrep",
    "-u",
    String(process.getuid?.() ?? 1000),
    "-f",
    "[a]pps/gateway/src/index.ts",
  ]);
  return r.out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number)
    .filter((p) => p > 0);
}

/** PID خادمِ PG (postmaster) من ملفِهِ الرسميِّ — يُقارن قبلَ وبعدَ. */
function postmasterPid(): number | null {
  try {
    const line = readFileSync(`${B}/pg/postmaster.pid`, "utf8").split("\n")[0];
    const pid = Number(line);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function pgReady(): Promise<boolean> {
  const r = await sh(["pg_isready", "-h", "127.0.0.1", "-p", "55432"], 5_000);
  return r.code === 0;
}

async function readyOk(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(1_500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** بذرُ هويةٍ (تأسيسٌ فقط) — كما في مولّدِ المسارِ «أ» حرفيًا. */
async function seedUser(telegramId: number, role: "rider" | "driver"): Promise<string | null> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values ((select id from cities where code = ${CITY}), ${telegramId}::bigint,
            ${`تعافي 2ب ${telegramId}`}, ${`+9665${String(telegramId).padStart(8, "0").slice(-8)}`},
            ${role}::user_role, 'ar')
    on conflict (telegram_id) do update set full_name = excluded.full_name
    returning id
  `;
  return users[0]?.id ?? null;
}

async function seedPair(
  attempt: number,
): Promise<{ riderTg: number; driverTg: number; driverId: string } | null> {
  const riderTg = RIDER_BASE + attempt * 10;
  const driverTg = DRIVER_BASE + attempt * 10;
  const riderUserId = await seedUser(riderTg, "rider");
  const driverUserId = await seedUser(driverTg, "driver");
  if (riderUserId === null || driverUserId === null) return null;
  await sql`
    insert into riders (city_id, user_id)
    values ((select id from cities where code = ${CITY}), ${riderUserId}::uuid)
    on conflict (user_id) do nothing
  `;
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
    values ((select id from cities where code = ${CITY}), ${driverUserId}::uuid,
            'verified'::verification_status, ${`أ ب ج ${String(driverTg).slice(-4)}`}, 'sedan')
    on conflict (user_id) do update set verification_status = 'verified'::verification_status
    returning id
  `;
  const driverId = drivers[0]?.id;
  if (driverId === undefined) return null;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service)
    values ((select id from cities where code = ${CITY}), ${driverId}::uuid, 'transport')
    on conflict do nothing
  `;
  await sql`
    select start_trial(${driverId}::uuid, 'transport'::subscription_plan)
     where not exists (select 1 from subscriptions s where s.driver_id = ${driverId}::uuid)
  `;
  return { riderTg, driverTg, driverId };
}

async function session(botToken: string, telegramId: number): Promise<string | null> {
  const r = await http("/v1/session/telegram", {
    method: "POST",
    body: { initData: signedInitData({ botToken, telegramId }) },
    timeoutMs: 15_000,
  });
  return r.ok ? ((r.body as { accessToken?: string } | null)?.accessToken ?? null) : null;
}

interface CycleResult {
  completed: boolean;
  reason?: string;
  riderTg?: number;
  orderId?: string;
  orderCountForRider?: number;
  assignedCorrect?: boolean;
  offerPollFailures?: number;
  acceptAttempts?: number;
}

/**
 * دورةُ أعمالٍ كاملةٌ من Mini App (إنشاء → عرضٌ → قبولٌ → قرارُ المرشَّحِ إن
 * ظهرَ → وصولٌ → بدءٌ → إتمام) والتحققُ منَ القاعدةِ: completed، الإسنادُ
 * للسائقِ الصحيحِ، لا طلبٍ مكررٍ لنفسِ الراكبِ، لا معاملاتٍ عالقةٍ.
 *
 * `duringOfferPoll` (اختياري): عطلٌ يُطلقُ بالتوازي معَ استطلاعِ العروضِ —
 * البوابةُ حينها تنشطُ في الإرسالِ والاستعلاماتِ (طلبٌ باحثٌ + مُصرِفُ إشعاراتٍ)
 * فيقعُ القتلُ على استعلاماتٍ جاريةٍ فعلًا، ويُحصى ما رآهُ العميلُ منَ فشلِ
 * استطلاعٍ (offerPollFailures) لا أن يُدّعى أنَّ شيئًا لم ينكسر.
 */
async function businessCycle(
  tag: string,
  attempt: number,
  duringOfferPoll?: () => Promise<void>,
): Promise<CycleResult> {
  const seeded = await seedPair(attempt);
  if (seeded === null) return { completed: false, reason: "seed_failed" };
  const riderToken = await session(RIDER_BOT_TOKEN, seeded.riderTg);
  const driverToken = await session(DRIVER_BOT_TOKEN, seeded.driverTg);
  if (riderToken === null || driverToken === null) {
    return { completed: false, reason: "session_failed", riderTg: seeded.riderTg };
  }
  const idemKey = `pgrec-${tag}-${seeded.riderTg}`;
  const create = await http("/v1/rides", {
    method: "POST",
    token: riderToken,
    headers: { "idempotency-key": idemKey },
    body: {
      service: "transport",
      originLat: 21.4858,
      originLng: 39.1925,
      destinationLat: 21.5,
      destinationLng: 39.2,
    },
    timeoutMs: 20_000,
  });
  const orderId = (create.body as { orderId?: string } | null)?.orderId;
  if (!create.ok || orderId === undefined) {
    return { completed: false, reason: `create:${create.status}`, riderTg: seeded.riderTg };
  }
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

  // اكتشافُ العرضِ منَ الواجهةِ — والعدُّ الصادقُ لفشلِ الاستطلاعاتِ خلالَ العطلِ.
  // العطلُ (إن مُرِّرَ) يُطلقُ الآن بالتوازي: البوابةُ تعملُ والاستعلاماتُ جاريةٌ.
  const faultDone = duringOfferPoll !== undefined ? duringOfferPoll() : Promise.resolve();
  let offerId: string | null = null;
  let pollFailures = 0;
  const deadline = Date.now() + 180_000;
  while (offerId === null && Date.now() < deadline) {
    const board = await http("/v1/driver/offers", { token: driverToken, timeoutMs: 15_000 });
    if (!board.ok) pollFailures += 1;
    else if (board.body !== null && Array.isArray((board.body as { offers?: unknown }).offers)) {
      const match = ((board.body as { offers: Record<string, unknown>[] }).offers ?? []).find(
        (offer) => offer.order_id === orderId,
      );
      const found = match?.offer_id ?? match?.id;
      if (typeof found === "string") offerId = found;
    }
    if (offerId === null) await sleep(2_000);
  }
  await faultDone;
  if (offerId === null) {
    return { completed: false, reason: "no_offer_in_time", riderTg: seeded.riderTg, orderId };
  }

  // القبولُ معَ إعادةِ المحاولةِ: أثناءَ العطلِ قد يفشل النداءُ بـ503/شبكةٍ
  // (فشلٌ نظيفٌ مقيسٌ لا انهيارٌ) — يُعادُ بعدَ تعافي البوابةِ كما يفعلُ
  // عميلٌ حقيقيٌّ، معَ إعادةِ اكتشافِ العرضِ إن انقضى القديمُ. عددُ المحاولاتِ
  // يُسجَّلَ صادقًا (acceptAttempts) لا يُخفى.
  let accepted = false;
  let acceptAttempts = 0;
  const acceptDeadline = Date.now() + 120_000;
  while (!accepted && Date.now() < acceptDeadline) {
    const accept = await http(`/v1/driver/offers/${offerId}/accept`, {
      method: "POST",
      token: driverToken,
      timeoutMs: 20_000,
    });
    acceptAttempts += 1;
    if (accept.ok) {
      accepted = true;
      break;
    }
    // العرضُ ربما انقضى — يُعادُ اكتشافُهُ منَ اللوحِ قبلَ المحاولةِ التاليةِ
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
    await sleep(3_000);
  }
  if (!accepted) {
    return {
      completed: false,
      reason: `accept:failed_after_${acceptAttempts}_attempts`,
      riderTg: seeded.riderTg,
      orderId,
    };
  }
  // قرارُ المرشَّحِ إن كانت نافذةُ اختيارِ الراكبِ مفتوحةً — كما في المولّدِ.
  const candidate = await http(`/v1/rides/${orderId}/candidate`, {
    token: riderToken,
    timeoutMs: 15_000,
  });
  if (candidate.ok && (candidate.body as { candidate?: unknown } | null)?.candidate != null) {
    await http(`/v1/rides/${orderId}/candidate`, {
      method: "POST",
      token: riderToken,
      body: { accept: true, driver_id: seeded.driverId },
      timeoutMs: 15_000,
    });
  }

  // الحكمُ للقاعدةِ: الإسنادُ للسائقِ الصحيحِ.
  let matched = false;
  const matchDeadline = Date.now() + 60_000;
  while (!matched && Date.now() < matchDeadline) {
    const state = await sql<{ status: string; assigned: string | null }[]>`
      select status::text as status, assigned_driver_id::text as assigned from orders where id = ${orderId}
    `;
    const row = state[0];
    if (row?.status === "matched" && row.assigned === seeded.driverId) matched = true;
    else await sleep(2_000);
  }
  if (!matched) {
    return { completed: false, reason: "no_match_in_db", riderTg: seeded.riderTg, orderId };
  }

  for (const step of ["arrived", "start", "complete"] as const) {
    const action = await http(`/v1/driver/job/${orderId}/${step}`, {
      method: "POST",
      token: driverToken,
      timeoutMs: 20_000,
    });
    if (!action.ok) {
      return {
        completed: false,
        reason: `job_${step}:${action.status}`,
        riderTg: seeded.riderTg,
        orderId,
      };
    }
  }
  let completedInDb = false;
  const doneDeadline = Date.now() + 60_000;
  while (!completedInDb && Date.now() < doneDeadline) {
    const state = await sql<{ status: string }[]>`
      select status::text as status from orders where id = ${orderId}
    `;
    if (state[0]?.status === "completed") completedInDb = true;
    else await sleep(2_000);
  }
  if (!completedInDb) {
    return { completed: false, reason: "no_completion_in_db", riderTg: seeded.riderTg, orderId };
  }

  // التحققُ الختاميُّ: لا تكرارَ (طلبٌ واحدٌ لهذا الراكبِ) والإسنادُ صحيحٌ.
  const final = await sql<{ count: string; assigned: string | null }[]>`
    select count(*)::text as count, max(assigned_driver_id::text) as assigned
      from orders o join riders rd on rd.id = o.rider_id join users u on u.id = rd.user_id
     where u.telegram_id = ${seeded.riderTg}
  `;
  const orderCount = Number(final[0]?.count ?? "0");
  const assignedCorrect = final[0]?.assigned === seeded.driverId;
  return {
    completed: orderCount === 1 && assignedCorrect,
    ...(orderCount !== 1 || !assignedCorrect
      ? { reason: `final_check:count=${orderCount},assigned=${assignedCorrect}` }
      : {}),
    riderTg: seeded.riderTg,
    orderId,
    orderCountForRider: orderCount,
    assignedCorrect,
    offerPollFailures: pollFailures,
    acceptAttempts,
  };
}

/** خلفياتُ البوابةِ لكلِّ دورٍ الآن (`ceezr:%`) — دليلُ أنَّ القتلَ أصابَها وأنَّها عادَت. */
async function gatewayBackends(): Promise<Record<string, number>> {
  const rows = await sql<{ app: string; n: number }[]>`
    select application_name as app, count(*)::int as n from pg_stat_activity
     where datname = current_database() and application_name like ${GATEWAY_BACKENDS}
     group by 1 order by 1
  `;
  return Object.fromEntries(rows.map((r) => [r.app, r.n]));
}

/** فحوصاتُ ما بعدَ التعافي: لا معاملاتٍ عالقةٍ ولا مهامَّ مستولى عليها متقادمةٍ. */
async function postRecoveryChecks(): Promise<Record<string, unknown>> {
  const stuckTx = await sql<{ n: string }[]>`
    select count(*)::text as n from pg_stat_activity
     where state = 'idle in transaction' and application_name like ${GATEWAY_BACKENDS}
       and xact_start < now() - interval '30 seconds'
  `;
  const jobsStuck = await sql<{ n: string }[]>`
    select count(*)::text as n from telegram_update_jobs
     where status = 'claimed' and claimed_at < now() - interval '60 seconds'
  `;
  const outboxStuck = await sql<{ n: string }[]>`
    select count(*)::text as n from notification_outbox
     where status = 'sending' and claimed_at < now() - interval '5 minutes'
  `;
  return {
    idleInTransactionOver30s: Number(stuckTx[0]?.n ?? "0"),
    jobsClaimedStuckOver60s: Number(jobsStuck[0]?.n ?? "0"),
    outboxSendingStuckOver5m: Number(outboxStuck[0]?.n ?? "0"),
  };
}

async function main(): Promise<void> {
  /* المتطلباتُ المسبقةُ: العزلُ والرقعةُ تصلُ البناءَ فعلًا */
  const marker = await sql<{ m: string }[]>`
    select current_setting('data_directory')||'|'||current_setting('ceezr.run_marker')||'|'||current_database() as m
  `;
  const isolationOk = marker[0]?.m === `${B}/pg|ceezr-cap-20261016|ceezr_cap_20261016`;
  let patchOk = false;
  let patchDetail = "";
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      patchedDependencies?: Record<string, string>;
    };
    const wired = pkg.patchedDependencies?.["postgres@3.4.9"] === "patches/postgres@3.4.9.patch";
    const installed = readFileSync("node_modules/postgres/src/connection.js", "utf8");
    const guardPresent =
      installed.includes("CEEZR D7") && installed.includes("CONNECTION_DESTROYED");
    patchOk = wired && guardPresent;
    patchDetail = `patchedDependencies_wired=${wired},guard_in_installed_source=${guardPresent}`;
  } catch (e) {
    patchDetail = `check_failed:${String(e).slice(0, 80)}`;
  }
  const pidsBefore = await gatewayPids();
  log({
    event: "experiment.preconditions",
    isolationOk,
    runMarker: marker[0]?.m ?? null,
    patchReachesBuild: patchOk,
    patchDetail,
    gatewayReady: await readyOk(),
    gatewayPids: pidsBefore,
    postmasterPid: postmasterPid(),
  });
  const gatewayLogPath = GATEWAY_LOG;
  const gatewayLogReadable = existsSync(gatewayLogPath);
  const logStartOffset = gatewayLogReadable ? statSync(gatewayLogPath).size : 0;
  const backendsBefore = await gatewayBackends();
  log({ event: "experiment.gateway_backends", gatewayLogPath, gatewayLogReadable, backendsBefore });

  /* ── التجربةُ (أ): قتلُ خلفياتِ البوابةِ فقط — أثناءَ عملٍ جارٍ ── */
  const pidsA = await gatewayPids();
  log({ event: "expA.start", gatewayPidsBefore: pidsA, postmasterPid: postmasterPid() });
  // العطلُ يُطلقُ بعدَ إنشاءِ الطلبِ وإعلانِ توفّرِ السائقِ — أي أثناءَ استطلاعِ
  // لوحِ العروضِ والبوابةُ تنشطُ في الإرسالِ (طلبٌ باحثٌ + مُصرِفٌ يعملُ).
  let killedA = 0;
  const cycleA = await businessCycle("A", 0, async () => {
    await sleep(1_000); // الاستطلاعُ بدأَ فعلًا
    const killed = await sql<{ n: number }[]>`
      select count(*)::int as n from (select pg_terminate_backend(pid) from pg_stat_activity
        where datname=current_database() and pid<>pg_backend_pid()
          and application_name like ${GATEWAY_BACKENDS}) x
    `;
    killedA = killed[0]?.n ?? 0;
    // جاهزيةُ البوابةِ في لحظةِ ما بعدَ القتلِ مباشرةً (قد لا تنكسرَ أصلًا)
    const readyRightAfter = await readyOk();
    log({
      event: "expA.fault_injected",
      backendsKilled: killed[0]?.n ?? 0,
      readyRightAfterKill: readyRightAfter,
    });
  });
  const pidsAAfter = await gatewayPids();
  const pidSameA = pidsAAfter.join(",") === pidsA.join(",");
  const checksA = await postRecoveryChecks();
  // البوابةُ أعادَت فتحَ اتصالاتِها فعلاً — لا يكفي أنَّ دورةً اكتملَت (قد تكتملُ عبرَ تجمُّعٍ لم يُقتَل).
  const backendsAfterA = await gatewayBackends();
  // فشلٌ مغلقٌ: بلا عطلٍ مُحقَنٍ لا حكمَ نجاح — الصفرُ «لم يُختبَر» لا «نجا».
  const verdictA =
    killedA === 0
      ? "NO_FAULT_INJECTED"
      : cycleA.completed && pidSameA && cycleA.orderCountForRider === 1
        ? "BACKENDS_TERMINATED_GATEWAY_SURVIVED"
        : "NOT_PROVEN";
  log({
    event: "expA.end",
    ...cycleA,
    gatewayPidsAfter: pidsAAfter,
    pidSame: pidSameA,
    postRecovery: checksA,
    backendsKilled: killedA,
    backendsAfter: backendsAfterA,
    verdict: verdictA,
  });

  /* ── التجربةُ (ب): إيقافُ PG كاملًا وإعادتُه بالأداةِ المصححةِ ── */
  const pidsB = await gatewayPids();
  const pmBefore = postmasterPid();
  log({ event: "expB.start", gatewayPidsBefore: pidsB, postmasterPidBefore: pmBefore });

  // الأداةُ المصححةُ نفسُها (monitor/chaos.ts · فعل pg_restart) — لا استئنافٌ يدويٌّ.
  const chaos = spawn("bun", ["run", "deploy/capacity-run/monitor/chaos.ts"], {
    env: {
      ...process.env,
      RUN_DIR,
      SOAK_START_MS: String(Date.now()),
      CHAOS_PLAN: JSON.stringify([{ at_min: 0, action: "pg_restart" }]),
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  // مراقبةٌ كثيفةٌ أثناءَ عملِ الأداةِ: متى انكسرتِ الجاهزيةُ، متى عادَ PG،
  // متى عادتِ البوابةُ — وبأيِّ ترتيبٍ.
  const monitor = {
    firstReadyFailAt: null as number | null,
    pgReadyAt: null as number | null,
    gatewayReadyAt: null as number | null,
    readyFailures: 0,
  };
  const t0 = Date.now();
  let chaosDone = false;
  const chaosExit = new Promise<void>((resolve) => {
    chaos.on("exit", () => {
      chaosDone = true;
      resolve();
    });
  });
  const guard = setTimeout(() => chaos.kill(9), 240_000);
  while (!chaosDone && Date.now() - t0 < 240_000) {
    const ready = await readyOk();
    if (!ready) {
      monitor.readyFailures += 1;
      if (monitor.firstReadyFailAt === null) monitor.firstReadyFailAt = Date.now();
    } else if (monitor.firstReadyFailAt !== null && monitor.gatewayReadyAt === null) {
      monitor.gatewayReadyAt = Date.now();
    }
    if (monitor.pgReadyAt === null && (await pgReady())) monitor.pgReadyAt = Date.now();
    await sleep(150);
  }
  clearTimeout(guard);
  await chaosExit;

  let toolRecord: Record<string, unknown> | null = null;
  try {
    toolRecord = JSON.parse(readFileSync(`${EV}/fault-injection.json`, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    // سجلُّ الأداةِ غيرُ موجودٍ — يُسجَّلَ النقصُ ولا يُختلق
  }
  const pidsBAfter = await gatewayPids();
  const pmAfter = postmasterPid();
  const pidSameB = pidsBAfter.join(",") === pidsB.join(",");
  const pgBeforeGateway =
    monitor.pgReadyAt !== null &&
    (monitor.gatewayReadyAt !== null || monitor.firstReadyFailAt === null);
  const downtimeMs =
    monitor.firstReadyFailAt !== null && monitor.gatewayReadyAt !== null
      ? monitor.gatewayReadyAt - monitor.firstReadyFailAt
      : 0;

  // دورةُ أعمالٍ كاملةٌ **بعدَ التعافي** — منَ الواجهةِ حتى الحالةِ النهائيةِ.
  const cycleB = await businessCycle("B", 5);
  const checksB = await postRecoveryChecks();
  const verdictB =
    cycleB.completed && pidSameB && cycleB.orderCountForRider === 1 && pgBeforeGateway
      ? "PG_RESTART_RECOVERED_BUSINESS_CYCLE_COMPLETED"
      : "NOT_PROVEN";
  log({
    event: "expB.end",
    ...cycleB,
    gatewayPidsAfter: pidsBAfter,
    pidSame: pidSameB,
    postmasterPidAfter: pmAfter,
    postmasterChanged: pmAfter !== null && pmAfter !== pmBefore,
    monitor,
    downtimeMs,
    pgBeforeGateway,
    toolRecord,
    postRecovery: checksB,
    verdict: verdictB,
  });

  /* سجلُّ البوابةِ: لا انهيارٌ غيرُ ملتقطٍ خلالَ التجربتين */
  let uncaught = 0;
  let unhandled = 0;
  let logScanned = false;
  if (gatewayLogReadable) {
    try {
      const tail = readFileSync(gatewayLogPath, "utf8").slice(logStartOffset);
      uncaught = (tail.match(/uncaughtException/g) ?? []).length;
      unhandled = (tail.match(/unhandledRejection/g) ?? []).length;
      logScanned = true;
    } catch {
      // غيرُ مقروءٍ — يبقى logScanned=false فيسقطُ الحكمُ الكلّيُّ إلى NOT_PROVEN
    }
  }
  log({
    event: "experiment.done",
    gatewayLogScan: logScanned
      ? { readable: true, uncaughtException: uncaught, unhandledRejection: unhandled }
      : { readable: false, path: gatewayLogPath },
    // الحكمُ الكلّيُّ: لا ينجحُ إلّا بعطلٍ مُحقَنٍ في (أ)، وسجلٍّ مقروءٍ بلا انهيار.
    verdict:
      verdictA === "BACKENDS_TERMINATED_GATEWAY_SURVIVED" &&
      verdictB === "PG_RESTART_RECOVERED_BUSINESS_CYCLE_COMPLETED" &&
      logScanned &&
      uncaught === 0 &&
      unhandled === 0
        ? "RECOVERY_PROVEN"
        : "NOT_PROVEN",
  });
  await sql.end({ timeout: 5 });
}

void main();
