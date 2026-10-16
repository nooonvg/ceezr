/* biome-ignore-all lint/style/noNonNullAssertion: أداة حمل تجريبية — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * R1 · ADR 0286 — المسارُ «أ»: حملُ Mini App HTTP — دورةُ أعمالِ المنتجِ كاملةً
 *   عبرَ واجهاتِ HTTP الفعليةِ لا عبرَ webhook ولا قراءةِ القاعدةِ لاكتشافِ
 *   العروضِ.
 *
 * السيناريوُ الواحدُ (راكبٌ + سائقٌ هويتانِ مستقلتانِ — لا يُعادُ السائقُ إلى
 * الحوضِ قبلَ إنهاءِ التزامِهِ عبرَ واجهةِ المنتجِ، وإلا قاسَتِ الجولاتُ رفضَ
 * `DRIVER_HAS_ACTIVE_ORDER` لا السعةَ):
 *   ١) تبادلُ هويةٍ موقَّعٍ (`POST /v1/session/telegram`) للراكبِ والسائقِ على
 *      حدةٍ — تحققٌ تشفيريٌّ حقيقيٌّ غيرُ معدَّلٍ (بوتٌ اصطناعيٌّ).
 *   ٢) الراكبُ ينشئُ الرحلةَ (`POST /v1/rides` بمفتاحِ تماثلٍ).
 *   ٣) السائقُ يعلنُ توفّرَهُ (`POST /v1/driver/availability`) ويرسلَ موقعَهُ
 *      (`POST /v1/driver/location`) — وهو ما يطلقُ إعادةَ الإرسالِ الفوريةَ
 *      للطلباتِ الباحثةِ.
 *   ٤) السائقُ يقرأُ لوحَ عروضِهِ (`GET /v1/driver/offers`) حتى يظهرَ عرضُهُ —
 *      الاكتشافُ منَ الواجهةِ لا منَ القاعدةِ.
 *   ٥) السائقُ يقبلُ (`POST /v1/driver/offers/:id/accept`) — وقرارُ المرشَّحِ
 *      للراكبِ (`POST /v1/rides/:id/candidate`) حينَ تظهرُ نافذةُ القرارِ.
 *   ٦) دورةُ الرحلةِ (`arrived` → `start` → `complete`) عبرَ واجهةِ عملِ السائقِ.
 *   ٧) **التحققُ منَ القاعدةِ**: الإسنادُ (`matched` + السائقُ الصحيحُ) ثمَّ
 *      الحالةُ النهائيةُ (`completed`) — فالنجاحُ حكمُ القاعدةِ لا حكمُ 2xx،
 *      والمرفوضُ والمتعثرُ وغيرُ المحسومِ في المقامِ لا يُحذفانِ.
 *
 * مبادئُ إضافيةٌ: لا يُسجَّلُ initData ولا bearer ولا رمزُ بوتٍ؛ لكلِّ نداءٍ
 * مهلةٌ؛ إعادةُ المحاولةِ ذاتُ سقفٍ وتحترمُ `Retry-After`.
 *
 * التشغيلُ: `RUN_DIR=… GEN_ID=genA bun run deploy/capacity-run/load/miniapp-load.ts`
 * يقرأُ: GATEWAY_URL · DATABASE_URL · RIDER_BOT_TOKEN · DRIVER_BOT_TOKEN ·
 * PROFILE (مراحلُ) · CITY (افتراضي JED) · SCENARIO_DEPTH (assign|full).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import {
  EV,
  engagedDuplicates,
  GEN_ID,
  type HttpResult,
  http,
  PathRecorder,
  RUN_DIR,
  rnd,
  signedInitData,
  sleep,
  sql,
  T0,
} from "./lib.ts";

mkdirSync(`${RUN_DIR}/evidence`, { recursive: true });

const RIDER_BOT_TOKEN = process.env.RIDER_BOT_TOKEN ?? "";
const DRIVER_BOT_TOKEN = process.env.DRIVER_BOT_TOKEN ?? "";
if (RIDER_BOT_TOKEN === "" || DRIVER_BOT_TOKEN === "") {
  console.error("✖ عيّن RIDER_BOT_TOKEN وDRIVER_BOT_TOKEN من بيئةِ الجولةِ.");
  process.exit(1);
}

type Phase = { name: string; sec: number; conc: number };
const PROFILE: Phase[] = JSON.parse(
  process.env.PROFILE ?? '[{"name":"smoke","sec":120,"conc":10}]',
);
const CITY = process.env.CITY ?? "JED";
const DEPTH = process.env.SCENARIO_DEPTH === "assign" ? "assign" : "full";
const MATCH_WAIT_MS = Number(process.env.MATCH_WAIT_MS ?? 120_000);
const POLL_MS = 2_000;
const IDEMPOTENCY_HEADER = "idempotency-key";

const rec = new PathRecorder({ path: "miniapp_http", gen: GEN_ID });

let phase = "init";
function ev(event: string, data: Record<string, unknown> = {}) {
  // حاجزُ أدلةٍ منفصلٌ لكلِّ مسارٍ — لا يُخلطُ مسارُ HTTP معَ مسارِ webhook.
  appendFileSync(
    `${EV}/miniapp-load-events.jsonl`,
    `${JSON.stringify({ t: new Date().toISOString(), path: "miniapp_http", gen: GEN_ID, phase, event, ...data })}\n`,
  );
}

/** كلُّ نداءٍ يمرُّ عبرَ العدّادِ: تزامنُ السيناريوهاتِ وطلباتُ HTTP قيدَ التنفيذِ
 *  مفكّكانِ — فلا يُخلطانِ في مقياسٍ واحدٍ. */
async function call(path: string, init: Parameters<typeof http>[1] = {}): Promise<HttpResult> {
  rec.httpStart();
  try {
    const result = await http(path, init);
    rec.httpEnd(result);
    return result;
  } catch (error) {
    rec.httpEnd({
      status: 0,
      ok: false,
      is429: false,
      elapsedMs: 0,
      body: null,
      networkError: error instanceof Error ? error.name : "network",
    });
    throw error;
  }
}

/* ───────── البذرُ (تأسيسُ هوياتٍ فقط — كلُّ أعمالٍ بعدها عبرَ HTTP) ───────── */

interface SeededUser {
  readonly telegramId: number;
  readonly userId: string;
}

async function seedUser(telegramId: number, role: "rider" | "driver"): Promise<SeededUser> {
  const users = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, full_name, phone, role, language_code)
    values ((select id from cities where code = ${CITY}), ${telegramId}::bigint,
            ${`حمل ${GEN_ID} ${telegramId}`}, ${`+9665${String(telegramId).padStart(8, "0").slice(-8)}`},
            ${role}::user_role, 'ar')
    on conflict (telegram_id) do update set full_name = excluded.full_name
    returning id
  `;
  const userId = users[0]?.id;
  if (userId === undefined) throw new Error(`تعذّر بذر مستخدم ${telegramId}`);
  return { telegramId, userId };
}

let riderSeq = Number(process.env.RIDER_SEQ_START ?? 6_000_000);
let driverSeq = Number(process.env.DRIVER_SEQ_START ?? 7_000_000);

async function seedRider(): Promise<SeededUser> {
  riderSeq += 1;
  const rider = await seedUser(riderSeq, "rider");
  await sql`
    insert into riders (city_id, user_id)
    values ((select id from cities where code = ${CITY}), ${rider.userId}::uuid)
    on conflict (user_id) do nothing
  `;
  return rider;
}

async function seedDriver(): Promise<SeededUser> {
  driverSeq += 1;
  const driver = await seedUser(driverSeq, "driver");
  const drivers = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, plate_number, vehicle_type)
    values ((select id from cities where code = ${CITY}), ${driver.userId}::uuid,
            'verified'::verification_status, ${`أ ب ج ${String(driverSeq).slice(-4)}`}, 'sedan')
    on conflict (user_id) do update set verification_status = 'verified'::verification_status
    returning id
  `;
  const driverRow = drivers[0]?.id;
  if (driverRow === undefined) throw new Error(`تعذّر بذر سائق ${driverSeq}`);
  // قدرةُ الخدمةِ واشتراكٌ فعّالٌ — تأسيسٌ لا عملٌ: بدءُ التجربةِ كما يفعلُ
  // المشرفُ (اختصارٌ معلنٌ: KYC اليدويُّ ليس موضوعَ هذا الحملِ).
  await sql`
    insert into driver_capabilities (city_id, driver_id, service)
    values ((select id from cities where code = ${CITY}), ${driverRow}::uuid, 'transport')
    on conflict do nothing
  `;
  await sql`
    select start_trial(${driverRow}::uuid, 'transport'::subscription_plan)
     where not exists (select 1 from subscriptions s where s.driver_id = ${driverRow}::uuid)
  `;
  return driver;
}

/* ───────── السيناريو ───────── */

const JED = { lat: 21.4858, lng: 39.1925 };

interface ScenarioOutcome {
  readonly kind: "verified" | "rejected" | "undecided";
  readonly reason?: string;
}

async function exchangeSession(
  botToken: string,
  telegramId: number,
  startParam?: string,
): Promise<{ token: string | null; error?: string }> {
  const initData = signedInitData({
    botToken,
    telegramId,
    ...(startParam === undefined ? {} : { startParam }),
  });
  const result = await call("/v1/session/telegram", {
    method: "POST",
    body: { initData },
    timeoutMs: 15_000,
  });
  if (!result.ok || result.body === null) {
    return { token: null, error: result.networkError ?? `HTTP ${result.status}` };
  }
  const token = result.body.accessToken;
  if (typeof token !== "string") return { token: null, error: "no_token" };
  return { token };
}

/* خزينُ الجلساتِ: التطبيقُ الحقيقيُّ يفتحُ مرةً لكلِّ هويةٍ ويعيدُ استخدامَ
 * الرمزَ دقائقَ — لا يُبادلُ initData معَ كلِّ عملٍ. حدُّ المبادلةِ (30/دقيقةٌ
 * لكلِّ عنوانٍ) صحيحٌ للمنتجِ، والمولّدُ الأحاديُّ العنوانِ يحترمُه بالمشاركةِ
 * لا بتعطيلِ الحدِّ. هويةٌ فشلتْ مبادلتُها تُعادُ محاولتُها (لا تُخزَّن).
 */
const sessionCache = new Map<number, string>();
async function cachedSession(
  botToken: string,
  telegramId: number,
): Promise<{ token: string | null; error?: string }> {
  const cached = sessionCache.get(telegramId);
  if (cached !== undefined) return { token: cached };
  const result = await exchangeSession(botToken, telegramId);
  if (result.token !== null) sessionCache.set(telegramId, result.token);
  return result;
}

async function driverFindOffer(
  token: string,
  orderId: string,
  waitMs: number,
): Promise<{ offerId: string | null; error?: string }> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const board = await call("/v1/driver/offers", { token, timeoutMs: 15_000 });
    if (board.ok && board.body !== null) {
      const offers = board.body.offers;
      if (Array.isArray(offers)) {
        const match = offers.find(
          (offer) =>
            typeof offer === "object" &&
            offer !== null &&
            (offer as Record<string, unknown>).order_id === orderId,
        ) as Record<string, unknown> | undefined;
        const offerId = match?.offer_id ?? match?.id;
        if (typeof offerId === "string") return { offerId };
      }
    }
    if (Date.now() >= deadline) {
      return { offerId: null, error: "offer_not_found_in_time" };
    }
    await sleep(POLL_MS);
  }
}

async function riderDecideCandidate(
  token: string,
  orderId: string,
  driverId: string,
): Promise<{ decided: boolean; error?: string }> {
  const result = await call(`/v1/rides/${orderId}/candidate`, {
    method: "POST",
    token,
    body: { accept: true, driver_id: driverId },
    timeoutMs: 15_000,
  });
  if (!result.ok || result.body === null) {
    return { decided: false, error: result.networkError ?? `HTTP ${result.status}` };
  }
  return { decided: true };
}

async function runScenario(index: number): Promise<ScenarioOutcome> {
  const rider = await seedRider();
  const driver = await seedDriver();
  rec.scenarioStart(String(rider.telegramId));
  const startedAt = Date.now();
  try {
    // ١) الهويةُ — تحققٌ موقَّعٌ حقيقيٌّ لكلٍّ منَ الطرفينِ.
    const riderSession = await cachedSession(RIDER_BOT_TOKEN, rider.telegramId);
    if (riderSession.token === null) {
      return { kind: "undecided", reason: `rider_session:${riderSession.error}` };
    }
    const driverSession = await cachedSession(DRIVER_BOT_TOKEN, driver.telegramId);
    if (driverSession.token === null) {
      return { kind: "undecided", reason: `driver_session:${driverSession.error}` };
    }

    // نقطةُ الالتقاطِ ثابتةٌ للرحلةِ والسائقِ معًا: السائقُ ينتظرُ قربَها
    // (±110م) فيكونُ أقربَ من أيِّ سائقٍ مزروعٍ بعيدًا عنها — المطابقةُ على
    // القربِ لا تحتملُ أن يخسرَ سائقُ السيناريو السباقَ لسائقٍ أقربَ.
    const pickup = {
      lat: JED.lat + rnd(-0.01, 0.01),
      lng: JED.lng + rnd(-0.01, 0.01),
    };
    // ٢) إنشاءُ الرحلةِ عبرَ واجهةِ المنتجِ.
    const idempotencyKey = `cap-${GEN_ID}-${T0}-${index}`;
    const create = await call("/v1/rides", {
      method: "POST",
      token: riderSession.token,
      headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
      body: {
        service: "transport",
        originLat: pickup.lat,
        originLng: pickup.lng,
        destinationLat: JED.lat + rnd(-0.02, 0.02),
        destinationLng: JED.lng + rnd(-0.02, 0.02),
      },
      timeoutMs: 20_000,
    });
    if (!create.ok || create.body === null) {
      return {
        kind: "rejected",
        reason: `ride_create:${create.networkError ?? create.status}`,
      };
    }
    if (create.body.accepted !== true) {
      return { kind: "rejected", reason: `ride_refused:${String(create.body.refusal ?? "?")}` };
    }
    const orderId = create.body.orderId;
    if (typeof orderId !== "string") {
      return { kind: "undecided", reason: "no_order_id" };
    }

    // ٣) السائقُ متاحٌ ويرسلُ موقعَهُ — وههنا يُطلقُ الإرسالُ الفوريُّ.
    const availability = await call("/v1/driver/availability", {
      method: "POST",
      token: driverSession.token,
      body: { is_available: true },
      timeoutMs: 15_000,
    });
    if (!availability.ok) {
      return { kind: "rejected", reason: `availability:${availability.status}` };
    }
    const location = await call("/v1/driver/location", {
      method: "POST",
      token: driverSession.token,
      body: {
        latitude: pickup.lat + rnd(-0.001, 0.001),
        longitude: pickup.lng + rnd(-0.001, 0.001),
        accuracyMeters: 10,
      },
      timeoutMs: 15_000,
    });
    if (!location.ok) {
      return { kind: "rejected", reason: `location:${location.status}` };
    }

    // ٤) اكتشافُ العرضِ منَ الواجهةِ لا منَ القاعدةِ.
    const found = await driverFindOffer(driverSession.token, orderId, MATCH_WAIT_MS);
    if (found.offerId === null) {
      return { kind: "undecided", reason: `offer:${found.error ?? "?"}` };
    }

    // ٥) القبولُ — وقد تظهرُ نافذةُ قرارِ الراكبِ فتُفضّى منَ واجهةِ الراكبِ.
    const accept = await call(`/v1/driver/offers/${found.offerId}/accept`, {
      method: "POST",
      token: driverSession.token,
      timeoutMs: 20_000,
    });
    if (accept.is429) {
      return { kind: "undecided", reason: "accept:429" };
    }
    if (!accept.ok) {
      const body = accept.body as Record<string, unknown> | null;
      const rejection = body?.rejection as Record<string, unknown> | undefined;
      const code = body?.error ?? rejection?.code ?? accept.status;
      return { kind: "rejected", reason: `accept:${String(code)}` };
    }

    // قرارُ المرشَّحِ إن كانَ الطلبُ في نافذةِ اختيارِ الراكبِ.
    const driverRow = await sql<{ id: string }[]>`
      select id::text from drivers where user_id = ${driver.userId}::uuid
    `;
    const driverId = driverRow[0]?.id;
    if (driverId === undefined) return { kind: "undecided", reason: "driver_row_missing" };
    const candidate = await call(`/v1/rides/${orderId}/candidate`, {
      token: riderSession.token,
      timeoutMs: 15_000,
    });
    if (candidate.ok && candidate.body !== null && candidate.body.candidate !== null) {
      const decided = await riderDecideCandidate(riderSession.token, orderId, driverId);
      if (!decided.decided) {
        return { kind: "undecided", reason: `candidate:${decided.error ?? "?"}` };
      }
    }

    // ٦) التحققُ منَ القاعدةِ: الإسنادُ وقعَ للسائقِ الصحيحِ — لا يكفي 2xx.
    const matched = await waitDb(
      orderId,
      (state) => state.status === "matched" && state.assignedDriverId === driverId,
      MATCH_WAIT_MS,
    );
    if (matched === null) {
      return { kind: "undecided", reason: "no_match_in_db" };
    }

    if (DEPTH === "assign") {
      return { kind: "verified" };
    }

    // دورةُ الرحلةِ كاملةً عبرَ واجهةِ عملِ السائقِ.
    for (const step of ["arrived", "start", "complete"] as const) {
      const action = await call(`/v1/driver/job/${orderId}/${step}`, {
        method: "POST",
        token: driverSession.token,
        timeoutMs: 20_000,
      });
      if (!action.ok) {
        return { kind: "undecided", reason: `job_${step}:${action.status}` };
      }
    }
    const completed = await waitDb(orderId, (state) => state.status === "completed", MATCH_WAIT_MS);
    if (completed === null) {
      return { kind: "undecided", reason: "no_completion_in_db" };
    }
    return { kind: "verified" };
  } catch (error) {
    if (error instanceof Error && /stack/i.test(error.message)) {
      // تتبُّعُ كاملٌ لعلّةِ «تجاوزِ حجمِ المكدسِ» — يُطبعُ مرةً واحدةً.
      console.error(`STACK_TRACE_BEGIN\n${String(error.stack)}\nSTACK_TRACE_END`);
    }
    return {
      kind: "undecided",
      reason: error instanceof Error ? error.message.slice(0, 120) : "exception",
    };
  } finally {
    ev("scenario.end", {
      index,
      rider: rider.telegramId,
      driver: driver.telegramId,
      elapsedMs: Date.now() - startedAt,
    });
  }
}

async function waitDb(
  orderId: string,
  predicate: (state: { status: string; assignedDriverId: string | null }) => boolean,
  waitMs: number,
): Promise<true | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const state = await orderStateSafe(orderId);
    if (state !== null && predicate(state)) return true;
    if (Date.now() >= deadline) return null;
    await sleep(POLL_MS);
  }
}

async function orderStateSafe(orderId: string) {
  const rows = await sql<{ status: string; assigned: string | null }[]>`
    select status::text as status, assigned_driver_id::text as assigned
      from orders where id = ${orderId}
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return { status: row.status, assignedDriverId: row.assigned };
}

/* ───────── الحلقةُ الرئيسةُ ───────── */

async function main() {
  ev("gen.start", { profile: PROFILE, depth: DEPTH, city: CITY });
  const snapshotTimer = setInterval(() => rec.snapshot(), 1_000);
  for (const ph of PROFILE) {
    phase = ph.name;
    ev("phase.start", { name: ph.name, sec: ph.sec, conc: ph.conc });
    const stopAt = Date.now() + ph.sec * 1000;
    let index = 0;
    const running = new Set<Promise<void>>();
    const launch = async (): Promise<void> => {
      const outcome = await runScenario(index++);
      if (outcome.kind === "verified") rec.scenarioEnd("verified");
      else if (outcome.kind === "rejected") rec.scenarioEnd("rejected");
      else rec.scenarioEnd("undecided");
      if (outcome.reason !== undefined) {
        ev("scenario.outcome", { kind: outcome.kind, reason: outcome.reason });
      }
    };
    while (Date.now() < stopAt) {
      while (running.size < ph.conc && Date.now() < stopAt) {
        const p = launch();
        running.add(p);
        void p.then(
          () => {
            running.delete(p);
          },
          () => {
            running.delete(p);
          },
        );
      }
      await sleep(250);
    }
    await Promise.all([...running]);
    ev("phase.end", { name: ph.name });
  }
  clearInterval(snapshotTimer);
  rec.snapshot(true);

  // الحكمُ النهائيُّ منَ القاعدةِ — لا منَ الوعودِ.
  const duplicates = await engagedDuplicates();
  const summary = {
    path: "miniapp_http",
    gen: GEN_ID,
    elapsedSec: Math.round((Date.now() - T0) / 1000),
    engagedDuplicates: duplicates,
  };
  ev("gen.end", summary);
  console.log(JSON.stringify(summary));
  await sql.end({ timeout: 5 });
}

void main();
