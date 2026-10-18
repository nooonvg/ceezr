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
 * PROFILE (مراحلُ) · CITY (افتراضي JED) · SCENARIO_DEPTH (assign|full) ·
 * DRAIN_SEC (نافذةُ الختامِ الصارمةُ بعدَ نهايةِ الحقنِ — إلزاميةٌ > 0) ·
 * ACCEPT_RETRY_MAX/ACCEPT_RETRY_BUDGET_MS (سقفا إعادةِ محاولةِ القبولِ عندَ 409 العابر).
 *
 * `LOAD-01` (عقدُ القياسِ):
 * - **حدُّ إغلاقٍ صارمٌ:** كلُّ انتظارٍ داخلَ السيناريو محدودٌ بأقربِ مهلةٍ
 *   خاصتهِ وبموعدِ إغلاقِ المرحلةِ معًا — لا `Promise.all` بلا سقفٍ؛ وتجاوزُ
 *   الإغلاقِ مآلٌ مستقلٌّ `close_deadline` لا يُهملُ.
 * - **409 العابرُ:** القبولُ يعيدُ المحاولةَ بحدٍّ وميزانيةٍ بعدَ إعادةِ قراءةِ
 *   الحالةِ الفعليةِ (طلبٌ `searching` وعرضٌ `pending` لسائقِ السيناريو) — والتعارضُ
 *   النهائيُّ (فائزٌ آخرُ أو انتهاءٌ) لا يُعادُ ولا يُحوَّلُ نجاحًا.
 * - **السائقُ المسنَدُ فعليًّا:** الإسنادُ لغيرِ سائقِ السيناريو صنفٌ مستقلٌّ
 *   `assigned_to_other_driver` يحملُ هويةَ الفائزِ الفعليِّ لا «لا إسنادَ».
 * - **دورةُ حياةِ العرضِ:** لكلِّ سيناريو صفوفُ `order_offers` للطلبِ وطوابعُها
 *   + إشعاراتُ البوابةِ (delivered_at) تُسجَّلُ حدثَ `scenario.offer_lifecycle`.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { io as ioClient } from "socket.io-client";
import { type DriverOnboardingRecord, onboardDriverViaApp } from "./driver-onboarding.ts";
import {
  BASE,
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
// حارسُ التشغيلِ المباشرِ فقط — الاستيرادُ للاختبارِ لا يُخرجُ من العمليةِ
if (import.meta.main && (RIDER_BOT_TOKEN === "" || DRIVER_BOT_TOKEN === "")) {
  console.error("✖ عيّن RIDER_BOT_TOKEN وDRIVER_BOT_TOKEN من بيئةِ الجولةِ.");
  process.exit(1);
}

type Phase = { name: string; sec: number; conc: number };
const PROFILE: Phase[] = JSON.parse(
  process.env.PROFILE ?? '[{"name":"smoke","sec":120,"conc":10}]',
);
const CITY = process.env.CITY ?? "JED";

/**
 * `LOAD-01 Recovery` — مزيجُ اتصالِ السائقينَ بالقناةِ الآنيةِ: واقعُ التطبيقِ
 * ليسَ اتصالًا كاملًا ولا انعدامًا — فأهلُ اللوحِ المتصلونَ يُخدَمونَ بالإشارةِ
 * (لا دلوَّ يُستهلكُ)، والغائبونَ بالبطاقةِ. النسبةُ **مسجَّلةٌ مسبقًا** في
 * أدلةِ الجولةِ لا تُختارُ بعدَ النتيجةِ، وتغييرُها يغيّرُ حكمَ الدلوِ فلا
 * يُعدَّلُ صامتًا.
 */
const DRIVER_SOCKET_MIX = Math.min(1, Math.max(0, Number(process.env.DRIVER_SOCKET_MIX ?? "0.7")));

/**
 * ADR 0287 — مزيجُ اتصالِ الركّابِ بقناةِ أحداثِ الرحلةِ: المتصلُ يُخدَمُ في
 * Mini App بإقرارٍ بعدَ التطبيقِ، والغائبُ بتيليجرامَ احتياطًا. النسبةُ **مسجَّلةٌ
 * قبلَ الجولةِ** في `gen.start` وتثبتُ في كلِّ موجةِ قبولٍ — لا تُختارُ بعدَ النتيجةِ.
 */
const RIDER_SOCKET_MIX = Math.min(1, Math.max(0, Number(process.env.RIDER_SOCKET_MIX ?? "0.7")));
/** بقاءُ عميلِ الراكبِ بعدَ اكتمالِ الرحلةِ (شاشةُ الملخصِ) حتى يُقرَّ بـ COMPLETED. */
const RIDER_LINGER_MS = Number(process.env.RIDER_LINGER_MS ?? 20_000);
const riderSocketStats = {
  opened: 0,
  joined: 0,
  signals: 0,
  fetches: 0,
  fetchFailures: 0,
  acks: 0,
  ackFailures: 0,
  eventsAcked: 0,
  completedAcked: 0,
  lingerTimeouts: 0,
};

/** عداداتُ القناةِ في الجولةِ: تُطبَعُ في الختامِ — حقيقةُ المزيجِ مقيسةٌ لا مفترضةٌ. */
const socketStats = {
  opened: 0,
  joined: 0,
  signals: 0,
  wakes: 0,
  boardRefreshes: 0,
  acks: 0,
  ackFailures: 0,
};
/**
 * التكليفُ السابعُ — مَن ينتظرُ عرضَه على اللوحِ (`driverFindOffer`) يُوقَظُ بالإشارةِ
 * فيقرأُ اللوحَ فورًا كما يفعلُ التطبيقُ (`onUpdate` ⇒ تحديثُ اللوحِ)؛ والاستطلاعُ كلَّ
 * `POLL_MS` يبقى شبكةَ أمانٍ لا المسارَ الوحيدَ.
 */
const boardWaiters = new Map<string, () => void>();
const DEPTH = process.env.SCENARIO_DEPTH === "assign" ? "assign" : "full";
const MATCH_WAIT_MS = Number(process.env.MATCH_WAIT_MS ?? 120_000);
const POLL_MS = 2_000;
const IDEMPOTENCY_HEADER = "idempotency-key";

/** `LOAD-01` — نافذةُ الختامِ الصارمةُ (ثانيةٌ) بعدَ نهايةِ حقنِ كلِّ مرحلةٍ:
 *  لا انتظارَ بلا سقفٍ؛ صفرٌ أو غيابٌ يُرفَضُ صريحًا لأنَّ الجولةَ بلا حدٍّ ليست
 *  قياسًا. يجبُ أن تسعَ أطولَ انتظارٍ مشروعٍ (MATCH_WAIT_MS) بهامشٍ. */
const DRAIN_SEC = Number(process.env.DRAIN_SEC ?? 0);
if (import.meta.main && (DRAIN_SEC * 1000 <= MATCH_WAIT_MS || DRAIN_SEC <= 0)) {
  console.error("✖ عيّن DRAIN_SEC > MATCH_WAIT_MS/1000 لإغلاقٍ صارمٍ لا رمزيًّا.");
  process.exit(1);
}

/** سقفا إعادةِ محاولةِ القبولِ عندَ 409 العابرِ (قفلُ `skip locked`): محاولاتٌ
 *  محدودةٌ وميزانيةُ زمنٍ كليةٌ — لا إعادةً للمحاولةِ عندَ تعارضٍ نهائيٍّ. */
const ACCEPT_RETRY_MAX = Number(process.env.ACCEPT_RETRY_MAX ?? 3);
const ACCEPT_RETRY_BUDGET_MS = Number(process.env.ACCEPT_RETRY_BUDGET_MS ?? 15_000);

/** أقربُ موعدٍ: مهلةُ الانتظارِ الذاتيةُ أو موعدُ إغلاقِ المرحلةِ — نقيةٌ تُختبرُ. */
export function boundedDeadline(ownDeadlineMs: number, closeAtMs: number): number {
  return Math.min(ownDeadlineMs, closeAtMs);
}

/** قرارُ إعادةِ محاولةِ القبولِ — نقيةٌ تُختبرُ: يُعادُ فقط عندَ 409 عابرٍ (قفلٌ
 *  لحظيٌّ) والطلبُ ما يزالُ `searching` والعرضُ `pending` لسائقِ السيناريو،
 *  ضمنَ عددِ المحاولاتِ والميزانيةِ. ما سوى ذلك قرارٌ نهائيٌّ لا يُعادُ ولا
 *  يُحوَّلُ نجاحًا. */
export interface AcceptRetryInput {
  readonly httpStatus: number;
  readonly code: string;
  readonly orderStatus: string;
  readonly offerStatus: string;
  readonly attempt: number; // بدءًا من 1 (المحاولةُ الأولى لا «إعادةً»)
  readonly elapsedMs: number;
}
export function acceptRetryDecision(
  input: AcceptRetryInput,
  opts: { max: number; budgetMs: number } = {
    max: ACCEPT_RETRY_MAX,
    budgetMs: ACCEPT_RETRY_BUDGET_MS,
  },
): { retry: boolean; final: string } {
  const transientLock =
    input.httpStatus === 409 &&
    (input.code === "OFFER_TAKEN" || input.code === "ORDER_NOT_CLAIMABLE");
  if (!transientLock) {
    // فشلٌ آخرُ (شبكة/429/5xx/رفضٌ منطقيٌّ): قرارُه عندَ نداءِ القبولِ الأولِ —
    // إعادةُ المحاولةِ العامةُ خارجَ نطاقِ هذهِ السياسةِ لا تُضافُ ضمنيًا.
    return { retry: false, final: "non_transient" };
  }
  if (input.orderStatus !== "searching" || input.offerStatus !== "pending") {
    return { retry: false, final: "conflict_final" };
  }
  if (input.attempt >= opts.max) return { retry: false, final: "attempts_exhausted" };
  if (input.elapsedMs >= opts.budgetMs) return { retry: false, final: "budget_exhausted" };
  return { retry: true, final: "" };
}

/** مهلةُ التأخيرِ التدريجيِّ بينَ محاولاتِ القبولِ (معَ jitter) — نقيةٌ تُختبرُ. */
export function acceptRetryBackoffMs(attempt: number): number {
  return 250 * 2 ** Math.max(0, attempt - 1) + Math.floor(Math.random() * 250);
}

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
  const callStartedAt = performance.now();
  try {
    const result = await http(path, init);
    rec.httpEnd(result);
    rec.httpLatency(callLabel(path), result.elapsedMs);
    return result;
  } catch (error) {
    rec.httpEnd({
      status: 0,
      ok: false,
      is429: false,
      // الزمنُ الحقيقيُّ للفشلِ لا الصفرُ — الفشلُ الصفريُّ لهُ مدةٌ تُقاسُ.
      elapsedMs: performance.now() - callStartedAt,
      body: null,
      networkError: error instanceof Error ? error.name : "network",
      requestId: null,
    });
    throw error;
  }
}

/** تسميةُ النداءِ لمقياسِ زمنِ الاستجابةِ: المساراتُ الديناميكيةُ تُطبَّعُ
 *  (معرّفُ العرض/الطلب/الخطوة) فتُجمعُ العيّناتُ في صنفٍ واحدٍ قابلٍ للحكمِ. */
function callLabel(path: string): string {
  return path
    .replace(/\/v1\/rides\/[^/]+\/candidate/, "rides_candidate")
    .replace(/\/v1\/driver\/offers\/[^/]+\/accept/, "driver_offer_accept")
    .replace(/\/v1\/driver\/job\/[^/]+\/(arrived|start|complete)/, "driver_job_$1")
    .replace(/^\/?v1\/driver\/offers$/, "driver_offers_board")
    .replace(/^\/?v1\/driver\/availability$/, "driver_availability")
    .replace(/^\/?v1\/driver\/location$/, "driver_location")
    .replace(/^\/?v1\/rides$/, "rides_create")
    .replace(/^\/?v1\/session\/telegram$/, "session_exchange")
    .replace(/\d+/g, "N");
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

/**
 * تجهيزُ السائقِ منَ التطبيقِ المصغَّرِ — لا بذرَ SQL مباشرًا ولا حوارَ بوتٍ
 * (`ADR 0286` · المرحلةُ 1): جلسةٌ موقعةٌ ← إثباتُ رقمٍ عبرَ بطاقةِ اتصالٍ في
 * الـwebhook (المستنزفُ يعالجُها فعلًا) ← `POST /v1/onboarding/driver` ←
 * فالتحققُ منَ القاعدةِ (pending). خطواتُ المشرفِ (التوثيقُ والقدرةُ والتجربةُ)
 * موثقةٌ داخلَ المسارِ نفسِهِ بأنها فعلُ مشرفٍ لا فعلِ المستخدمِ.
 */
async function seedDriverViaApp(): Promise<DriverOnboardingRecord> {
  driverSeq += 1;
  return onboardDriverViaApp({ telegramId: driverSeq, cityCode: CITY });
}

/* ───────── السيناريو ───────── */

const JED = { lat: 21.4858, lng: 39.1925 };

export interface ScenarioOutcome {
  readonly kind: "verified" | "rejected" | "undecided";
  readonly reason?: string;
  /**
   * `LOAD-01` — ربطُ السيناريو بصفوفِ القاعدةِ: التشخيصُ منَ الأحداثِ وحدها
   * مستحيلٌ بلا هذهِ الحقولِ (الجولةُ التاريخيةُ خسرت أسبابَ 78 فشلًا لأنها
   * بلا معرّفاتِ ارتباطٍ). لا تُسجَّلُ الجلساتُ ولا الأسرارُ — الهوياتُ فقط.
   */
  readonly index?: number;
  readonly riderTelegramId?: number;
  readonly driverTelegramId?: number;
  readonly orderId?: string;
  readonly orderCreatedAt?: number;
  readonly offerWaitStartAt?: number;
  readonly offerWaitMs?: number;
  readonly offerPolls?: {
    readonly count: number;
    readonly readFailures: number;
    readonly targetSeen: boolean;
    readonly lastStatus: number | string;
    readonly lastBoardOffers: number | null;
  };
  /** `LOAD-01` — عددُ محاولاتِ القبولِ (1 = بلا إعادةٍ) والفائزُ الفعليُّ إذا
   *  أسندَ الطلبُ لغيرِ سائقِ السيناريو. */
  readonly acceptAttempts?: number;
  readonly assignedToOtherDriver?: string;
  readonly offerFoundAt?: number;
}

/**
 * تصنيفُ انتظارِ العرضِ من إحصاءاتِ الاستطلاعِ — دالةٌ نقيةٌ تُختبرُ سلوكيًا:
 * فشلُ قراءةِ اللوحِ كلهُ صنفٌ مستقلٌ (`unreadable`) لا يُخلطُ بغيابِ العرضِ،
 * والقراءاتُ الناجحةُ مع غيابِ الهدفِ = `not_found` (يُشخَّص سببُه من القاعدة).
 */
export function classifyOfferWait(stats: {
  count: number;
  readFailures: number;
}): "unreadable" | "not_found" | "no_polls" {
  if (stats.count === 0) return "no_polls";
  if (stats.readFailures === stats.count) return "unreadable";
  return "not_found";
}

/** الحالةُ المشتركةُ التي يملؤها السيناريو كلما توافرَ حقلاً — يُرفقُ بالمآلِ. */
export interface ScenarioCorr {
  index: number;
  riderTelegramId?: number;
  driverTelegramId?: number;
  orderId?: string;
  orderCreatedAt?: number;
  offerWaitStartAt?: number;
  offerWaitMs?: number;
  offerPolls?: ScenarioOutcome["offerPolls"];
  acceptAttempts?: number;
  assignedToOtherDriver?: string;
  /** `LOAD-01` — لحظةُ رؤيةِ العرضِ على اللوحِ (لقياسِ زمنِ التوزيعِ والاستلامِ). */
  offerFoundAt?: number;
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

/**
 * `LOAD-01` — فشلُ قراءةِ اللوحِ ليس غيابَ عرضٍ: الاستطلاعُ الفاشلُ (شبكةٌ أو
 * مهلةٌ أو جسمٌ غيرُ صالحٍ) يُحسَبُ قراءةً فاشلةً لا «عدمَ وجودٍ»، وإلا خُطئَ
 * التشخيصَ ووُسِّعَتِ المهلةُ لعلّةِ قراءةٍ لا لعلّةِ توزيعٍ.
 */
/**
 * `LOAD-01 Recovery` — مقبسُ لوحِ العروضِ للسائقِ المتصلِ: يحاكي عميلَ Mini App
 * الحقيقيَّ — اتصالٌ بمصادقةِ الجلسةِ، واستماعٌ لإشارةِ التحديثِ، وعندَها تحديثُ
 * اللوحِ **وإقرارُ استلامِهِ** (الإيصالُ الذي يُثبِتُ الوصولَ منَ الجهةِ التي
 * تملكُ الحكمَ). حقيقةُ المحاكاةِ: الغائبُ عنِ الغرفةِ لا يُشاهَدُ — إشارةُ
 * الغائبِ لا تُزعَمُ.
 */
function openDriverOffersSocket(sessionToken: string): { close: () => void } {
  const socket = ioClient(BASE, {
    auth: { sessionToken },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
  });
  socketStats.opened += 1;
  // عيبُ مولّدٍ (r7–r11): المقبسُ لم يُرسلْ `offers:join` قطُّ فلم يُضمَّ إلى غرفةِ السائقِ،
  // فكانَ الخادمُ يرى كلَّ سائقٍ غائبًا وإشاراتُ العروضِ صفرًا. التطبيقُ الحقيقيُّ يُرسلُه
  // عندَ كلِّ اتصالٍ (`apps/miniapp/src/services/offers-channel-client.ts`).
  socket.on("connect", () => socket.emit("offers:join"));
  socket.on("offers:joined", () => {
    socketStats.joined += 1;
  });
  socket.on("offers:update", () => {
    socketStats.signals += 1;
    const wake = boardWaiters.get(sessionToken);
    if (wake !== undefined) {
      // الباحثُ عن عرضِه يقرأُ اللوحَ ويُقرُّ بنفسِه — قراءةٌ واحدةٌ لكلِّ إشارةٍ كالتطبيقِ.
      socketStats.wakes += 1;
      wake();
      return;
    }
    // عميلٌ يُحدِّثُ لوحَهُ على الإشارةِ ثمَّ يُقرُّ بما وصلهُ — كما التطبيقُ.
    void (async () => {
      try {
        const board = await call("/v1/driver/offers", { token: sessionToken, timeoutMs: 15_000 });
        if (!board.ok || board.body === null) return;
        socketStats.boardRefreshes += 1;
        const offers = board.body.offers;
        if (!Array.isArray(offers)) return;
        const ids = offers
          .map((offer) => (offer as Record<string, unknown> | null)?.offer_id)
          .filter((id): id is string => typeof id === "string");
        if (ids.length === 0) return;
        const ack = await call("/v1/driver/offers/receipts", {
          token: sessionToken,
          method: "POST",
          body: { offer_ids: ids.slice(0, 50) },
        });
        if (ack.ok) socketStats.acks += 1;
        else socketStats.ackFailures += 1;
      } catch {
        // إيصالٌ تراكميٌّ: فشلُهُ لا يُوقفُ السيناريو — التحديثُ التالي يُقرُّ.
      }
    })();
  });
  return { close: () => socket.disconnect() };
}

async function driverFindOffer(
  token: string,
  orderId: string,
  waitMs: number,
  corr: ScenarioCorr,
  closeAt: number,
): Promise<{ offerId: string | null; error?: string }> {
  // `LOAD-01` — الاستطلاعُ محدودٌ بمهلةٍ ذاتيةٍ وبموعدِ إغلاقِ المرحلةِ معًا.
  const deadline = boundedDeadline(Date.now() + waitMs, closeAt);
  let polls = 0;
  let readFailures = 0;
  let targetSeen = false;
  let lastStatus: number | string = "none";
  let lastBoardOffers: number | null = null;
  corr.offerWaitStartAt = Date.now();
  corr.offerWaitMs = waitMs;
  for (;;) {
    const board = await call("/v1/driver/offers", { token, timeoutMs: 15_000 });
    polls += 1;
    lastStatus = board.ok ? board.status : (board.networkError ?? board.status);
    if (board.ok && board.body !== null) {
      const offers = board.body.offers;
      if (Array.isArray(offers)) {
        lastBoardOffers = offers.length;
        // `LOAD-01` — إيصالُ اللوحِ المطبَّقِ: العميلُ يُقرُّ بما رأهُ بعدَ كلِّ
        // تطبيقٍ (كما التطبيقُ الحقيقيُّ: `ackAppliedBoard` على كلِّ قراءةٍ لا على
        // الإشارةِ وحدها) — تراكميٌّ صامتُ الفشلِ لا يُعطِّلُ الاستطلاعَ.
        const seenIds = offers
          .map((offer) => (offer as Record<string, unknown> | null)?.offer_id)
          .filter((id): id is string => typeof id === "string");
        if (seenIds.length > 0) {
          void (async () => {
            try {
              const ack = await call("/v1/driver/offers/receipts", {
                token,
                method: "POST",
                body: { offer_ids: seenIds.slice(0, 50) },
                timeoutMs: 5_000,
              });
              if (ack.ok) socketStats.acks += 1;
              else socketStats.ackFailures += 1;
            } catch {
              socketStats.ackFailures += 1;
            }
          })();
        }
        const match = offers.find(
          (offer) =>
            typeof offer === "object" &&
            offer !== null &&
            (offer as Record<string, unknown>).order_id === orderId,
        ) as Record<string, unknown> | undefined;
        const offerId = match?.offer_id ?? match?.id;
        if (typeof offerId === "string") {
          corr.offerFoundAt = Date.now();
          corr.offerPolls = {
            count: polls,
            readFailures,
            targetSeen: true,
            lastStatus,
            lastBoardOffers,
          };
          return { offerId };
        }
        if (match !== undefined) targetSeen = true; // ظهرَ الطلبُ بلا معرّفِ عرضٍ صالحٍ
      } else {
        readFailures += 1; // جسمٌ غيرُ صالحٍ: قراءةٌ فاشلةٌ لا غيابَ عرضٍ
      }
    } else {
      readFailures += 1;
    }
    if (Date.now() >= deadline) {
      corr.offerPolls = { count: polls, readFailures, targetSeen, lastStatus, lastBoardOffers };
      if (readFailures === polls) {
        // كلُّ الاستطلاعاتِ فشلت: اللوحُ غيرُ مقروءٍ — صنفٌ مستقلٌّ لا يُخلطُ
        // بغيابِ العرضِ، وتوسيعُ المهلةِ هنا يخفي العلةَ لا يعالجُها.
        return { offerId: null, error: "offer_board_unreadable" };
      }
      if (Date.now() >= closeAt) {
        // نافذةُ الختامِ انتهت والسيناريو لم يكتمل — مآلٌ مستقلٌّ لا يُهملُ.
        return { offerId: null, error: "close_deadline" };
      }
      return { offerId: null, error: "offer_not_found_in_time" };
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (boardWaiters.get(token) === done) boardWaiters.delete(token);
        resolve();
      };
      const timer = setTimeout(done, Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
      boardWaiters.set(token, done);
    });
  }
}

/**
 * ADR 0287 — عميلُ الراكبِ المتصلُ: يدخلُ غرفةَ أحداثِ الرحلةِ بجلسته، وعندَ كلِّ
 * `trip:update` يجلبُ أحداثَ الرحلةِ، «يطبّقُها» (يسجّلُها في حالتِه بترتيبِ
 * التسلسلِ)، ثم **يُقرُّ** بما طبّقَه — كما شاشةُ الرحلةِ في التطبيقِ. وعندَ
 * الدخولِ (العودةُ للتطبيقِ) يجلبُ مرةً بلا إشارةٍ. البثُّ لا يُحسبُ وصولًا.
 */
function openRiderTripSocket(sessionToken: string): {
  linger: (ms: number) => void;
  close: () => void;
} {
  const socket = ioClient(BASE, {
    auth: { sessionToken },
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
  });
  riderSocketStats.opened += 1;
  const applied = new Map<string, string>(); // id → event
  let completedAcked = false;
  let onCompleted: (() => void) | null = null;
  const sync = async (orderId: string): Promise<void> => {
    riderSocketStats.fetches += 1;
    const listed = await call(`/v1/rides/${orderId}/trip-events`, {
      token: sessionToken,
      timeoutMs: 10_000,
    });
    const events = listed.ok ? listed.body?.events : undefined;
    if (!Array.isArray(events)) {
      riderSocketStats.fetchFailures += 1;
      return;
    }
    const pending = (events as Record<string, unknown>[])
      .filter((e) => e.acked !== true && typeof e.id === "string")
      .sort((a, b) => Number(a.seq) - Number(b.seq));
    if (pending.length === 0) return;
    // التطبيقُ قبلَ الإقرارِ: الحالةُ المحليةُ تُحدَّثُ أولًا ثم يُرسَلُ الإقرارُ.
    for (const e of pending) applied.set(e.id as string, String(e.event));
    const ack = await call(`/v1/rides/${orderId}/trip-events/ack`, {
      token: sessionToken,
      method: "POST",
      body: { ids: pending.map((e) => e.id) },
      timeoutMs: 10_000,
    });
    if (!ack.ok) {
      riderSocketStats.ackFailures += 1;
      return;
    }
    riderSocketStats.acks += 1;
    riderSocketStats.eventsAcked += pending.length;
    if (pending.some((e) => e.event === "COMPLETED")) {
      completedAcked = true;
      riderSocketStats.completedAcked += 1;
      onCompleted?.();
    }
  };
  let lastOrder: string | null = null;
  socket.on("connect", () => socket.emit("trip:join"));
  socket.on("trip:joined", () => {
    riderSocketStats.joined += 1;
    if (lastOrder !== null) void sync(lastOrder).catch(() => undefined);
  });
  socket.on("trip:update", (payload: { order_id?: unknown }) => {
    riderSocketStats.signals += 1;
    const orderId = typeof payload?.order_id === "string" ? payload.order_id : null;
    if (orderId === null) return;
    lastOrder = orderId;
    void sync(orderId).catch(() => {
      riderSocketStats.fetchFailures += 1;
    });
  });
  return {
    close: () => socket.close(),
    // شاشةُ الملخصِ: يبقى حتى يُقرَّ بـ COMPLETED أو تنقضي المهلةُ — منفصلٌ عن
    // فتحةِ التزامنِ (لا يُبطئُ حقنَ الحملِ ولا يُخفّضه).
    linger: (ms) => {
      if (completedAcked) {
        socket.close();
        return;
      }
      const timer = setTimeout(() => {
        riderSocketStats.lingerTimeouts += 1;
        socket.close();
      }, ms);
      onCompleted = () => {
        clearTimeout(timer);
        socket.close();
      };
    },
  };
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

/**
 * ربطُ المآلِ بالارتباطِ — نقيةٌ تُختبرُ: الخروجُ المبكرُ (ارتباطٌ جزئي) والاستثناءُ
 * (مآلٌ بلا سببٍ مفصلٍ) كلاهما يخرجُ بالمعرّفاتِ المتوفرةِ لا بلا شيءٍ.
 */
export function outcomeWithCorr(outcome: ScenarioOutcome, corr: ScenarioCorr): ScenarioOutcome {
  return {
    ...outcome,
    index: corr.index,
    ...(corr.riderTelegramId === undefined ? {} : { riderTelegramId: corr.riderTelegramId }),
    ...(corr.driverTelegramId === undefined ? {} : { driverTelegramId: corr.driverTelegramId }),
    ...(corr.orderId === undefined ? {} : { orderId: corr.orderId }),
    ...(corr.orderCreatedAt === undefined ? {} : { orderCreatedAt: corr.orderCreatedAt }),
    ...(corr.offerWaitStartAt === undefined ? {} : { offerWaitStartAt: corr.offerWaitStartAt }),
    ...(corr.offerWaitMs === undefined ? {} : { offerWaitMs: corr.offerWaitMs }),
    ...(corr.offerPolls === undefined ? {} : { offerPolls: corr.offerPolls }),
    ...(corr.acceptAttempts === undefined ? {} : { acceptAttempts: corr.acceptAttempts }),
    ...(corr.assignedToOtherDriver === undefined
      ? {}
      : { assignedToOtherDriver: corr.assignedToOtherDriver }),
    ...(corr.offerFoundAt === undefined ? {} : { offerFoundAt: corr.offerFoundAt }),
  };
}

async function runScenario(index: number, closeAt: number): Promise<ScenarioOutcome> {
  // `LOAD-01` — الغلافُ يرفقُ الارتباطَ بالمآلِ أيًّا كانَ موضعُ الخروجِ: لا
  // خروجَ مبكرًا يُفلتُ منَ الربطِ (هذا عينُ ما أضاعَ أسبابَ فشلِ الجولةِ
  // التاريخيةِ: مآلٌ بلا معرّفاتٍ لا يُشخَّصُ منَ القاعدةِ).
  //
  // عدُّ السيناريو **منَ الانطلاقِ** لا من نجاحِ الالتحاقِ: البروتوكولُ §1/§4
  // يُعرّفُ وحدةَ الحملِ بالسيناريو المُطلَقِ (الجلسةُ والرحلةُ دورتُه)؛ والعدادُ
  // القديمُ كانَ يُنهي ما لم يُبدَأ (فاشلُ الالتحاقِ يُنقصُ بلا زيادةٍ سابقةٍ)
  // فيَنخفضُ الذروةُ زورًا وتَفقدُ لقطةُ «التزامنِ الفعليِّ» دلالتَها. البدايةُ
  // هنا والنهايةُ عندَ المآلِ في الغلافِ — توازنٌ مضمونٌ لكلِّ مخرجٍ.
  rec.scenarioStart(`launch-${index}`);
  const corr: ScenarioCorr = { index };
  const outcome = await runScenarioSteps(corr, closeAt);
  return outcomeWithCorr(outcome, corr);
}

async function runScenarioSteps(corr: ScenarioCorr, closeAt: number): Promise<ScenarioOutcome> {
  const rider = await seedRider();
  corr.riderTelegramId = rider.telegramId;
  // تجهيزُ السائقِ منَ التطبيقِ (لا حوارَ بوتٍ) — فشلُهُ يُسجَّلُ لا يُخفى
  const driver = await seedDriverViaApp();
  if (!driver.ok) {
    // `LOAD-01` — فشلُ التجهيزِ يُسجَّل بخطواتِهِ لا يُخفى: سببُ الجولةِ الأولىِ
    // الفاشلةِ (مدنٌ غيرُ مفعّلةٍ) ضاع لولا تشخيصُ الخطواتِ.
    ev("driver.onboarding_failed", {
      index: corr.index,
      telegramId: driver.telegramId,
      steps: driver.steps,
    });
    corr.driverTelegramId = driver.telegramId;
    return { kind: "undecided", reason: "driver_onboarding_failed" };
  }
  corr.driverTelegramId = driver.telegramId;
  const startedAt = Date.now();
  // `LOAD-01` — رمزُ جلسةِ السائقِ يُرفَعُ قبلَ try ليصحَّ تنظيفُهُ في finally:
  // السائقُ الذي أنهى سيناريوهُ لا يبقى «متاحًا» في الحوضِ إلى الأبدِ.
  let driverToken: string | null = null;
  // `LOAD-01 Recovery` — مقبسُ لوحِ العروضِ يُرفَعُ قبلَ try ليُغلقَ في finally:
  // السائقُ لا يبقى متصلًا بقناةِ العروضِ بعدَ سيناريوهِ.
  let driverSocket: { close: () => void } | null = null;
  let riderSocket: { linger: (ms: number) => void; close: () => void } | null = null;
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
    driverToken = driverSession.token;

    // `LOAD-01 Recovery` — مزيجُ الاتصالِ: سبعةٌ من كلِّ عشرةِ سائقينَ متصلونَ
    // بالقناةِ (النسبةُ مسجَّلةٌ أعلاه) — منهمْ تُصرَّفُ العروضُ بالإشارةِ
    // والإيصالِ، ومن غابَ فلهُ البطاقةُ. حقيقةُ المزيجِ تُقاسُ في الختامِ.
    driverSocket = Math.random() < DRIVER_SOCKET_MIX ? openDriverOffersSocket(driverToken) : null;

    // نقطةُ الالتقاطِ ثابتةٌ للرحلةِ والسائقِ معًا: السائقُ ينتظرُ قربَها
    // (±110م) فيكونُ أقربَ من أيِّ سائقٍ مزروعٍ بعيدًا عنها — المطابقةُ على
    // القربِ لا تحتملُ أن يخسرَ سائقُ السيناريو السباقَ لسائقٍ أقربَ.
    const pickup = {
      lat: JED.lat + rnd(-0.01, 0.01),
      lng: JED.lng + rnd(-0.01, 0.01),
    };
    // ADR 0287 — شاشةُ الراكبِ مفتوحةٌ (بالمزيجِ المسجَّلِ) قبلَ الإنشاءِ.
    riderSocket = Math.random() < RIDER_SOCKET_MIX ? openRiderTripSocket(riderSession.token) : null;
    // ٢) إنشاءُ الرحلةِ عبرَ واجهةِ المنتجِ.
    const idempotencyKey = `cap-${GEN_ID}-${T0}-${corr.index}`;
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
    corr.orderId = orderId;
    corr.orderCreatedAt = Date.now();

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
      headers: {
        "x-cap-corr": `sc:${corr.index}`,
      },
    });
    if (!location.ok) {
      // `LOAD-01` — الفشلُ الصفريُّ ليسَ جنسًا واحدًا: انتهاءُ مهلةٍ (TimeoutError)
      // غيرُ رفضِ اتصالٍ (TypeError) غيرُ خطأٍ خامدٍ. يُسجَّلُ الجنسُ والمدةُ معًا
      // في الدليلِ الخامِ حتى يُحكَمَ على المهلةِ منَ الطبقتينِ لا منَ العميلِ وحده.
      return {
        kind: "rejected",
        reason: `location:${location.status}/${location.networkError ?? "?"}/${Math.round(location.elapsedMs)}ms${location.requestId ? `@${location.requestId}` : ""}`,
      };
    }

    // ٤) اكتشافُ العرضِ منَ الواجهةِ لا منَ القاعدةِ.
    const found = await driverFindOffer(driverSession.token, orderId, MATCH_WAIT_MS, corr, closeAt);
    if (found.offerId === null) {
      return { kind: "undecided", reason: `offer:${found.error ?? "?"}` };
    }

    // ٥) القبولُ — `LOAD-01`: 409 العابرُ (تزاحمُ قفلِ `skip locked` المُثبتُ في
    // الجولةِ التشخيصيةِ) يُعادُ محاولتُهُ بحدٍّ وميزانيةٍ بعدَ إعادةِ قراءةِ
    // الحالةِ الفعليةِ؛ والتعارضُ النهائيُّ لا يُعادُ ولا يُحوَّلُ نجاحًا. وقد
    // تظهرُ نافذةُ قرارِ الراكبِ فتُفضّى منَ واجهةِ الراكبِ.
    const acceptStartedAt = Date.now();
    let accept: HttpResult | null = null;
    let acceptCode = "";
    let acceptAttempt = 0;
    for (;;) {
      acceptAttempt += 1;
      accept = await call(`/v1/driver/offers/${found.offerId}/accept`, {
        method: "POST",
        token: driverSession.token,
        timeoutMs: 20_000,
      });
      if (accept.is429) {
        corr.acceptAttempts = acceptAttempt;
        return { kind: "undecided", reason: "accept:429" };
      }
      if (accept.ok) {
        corr.acceptAttempts = acceptAttempt;
        break;
      }
      const body = accept.body as Record<string, unknown> | null;
      const rejection = body?.rejection as Record<string, unknown> | undefined;
      acceptCode = String(body?.error ?? rejection?.code ?? accept.status);
      // إعادةُ قراءةِ الحالةِ الفعليةِ قبلَ قرارِ الإعادةِ — لا افتراضًا.
      const [orderState, offerState] = await Promise.all([
        orderStateSafe(orderId),
        offerStateSafe(found.offerId),
      ]);
      const decision = acceptRetryDecision(
        {
          httpStatus: accept.status,
          code: acceptCode,
          orderStatus: orderState?.status ?? "unknown",
          offerStatus: offerState?.status ?? "unknown",
          attempt: acceptAttempt,
          elapsedMs: Date.now() - acceptStartedAt,
        },
        { max: ACCEPT_RETRY_MAX, budgetMs: ACCEPT_RETRY_BUDGET_MS },
      );
      corr.acceptAttempts = acceptAttempt;
      if (!decision.retry) {
        ev("accept.retry_final", {
          index: corr.index,
          orderId,
          code: acceptCode,
          final: decision.final,
          orderStatus: orderState?.status ?? "unknown",
          offerStatus: offerState?.status ?? "unknown",
          attempts: acceptAttempt,
        });
        return { kind: "rejected", reason: `accept:${acceptCode}` };
      }
      ev("accept.retry", {
        index: corr.index,
        orderId,
        code: acceptCode,
        attempt: acceptAttempt,
        orderStatus: orderState?.status ?? "unknown",
        offerStatus: offerState?.status ?? "unknown",
      });
      if (Date.now() >= closeAt) {
        return { kind: "undecided", reason: "close_deadline" };
      }
      await sleep(acceptRetryBackoffMs(acceptAttempt));
    }

    // قرارُ المرشَّحِ إن كانَ الطلبُ في نافذةِ اختيارِ الراكبِ.
    const driverId = driver.driverId;
    if (driverId === null) return { kind: "undecided", reason: "driver_row_missing" };
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

    // ٦) التحققُ منَ القاعدةِ: الإسنادُ — للسائقِ الصحيحِ أو لفائزٍ آخرَ فعليٍّ
    // (صنفٌ مستقلٌّ يحملُ هويةَ الفائزِ لا «لا إسنادَ»).
    const matched = await waitDb(
      orderId,
      (state) => state.status === "matched",
      MATCH_WAIT_MS,
      closeAt,
    );
    if (matched === null) {
      return { kind: "undecided", reason: "no_match_in_db" };
    }
    const finalState = await orderStateSafe(orderId);
    if (
      finalState !== null &&
      finalState.assignedDriverId !== null &&
      finalState.assignedDriverId !== driverId
    ) {
      corr.assignedToOtherDriver = finalState.assignedDriverId;
      return { kind: "rejected", reason: "assigned_to_other_driver" };
    }
    if (finalState === null || finalState.assignedDriverId !== driverId) {
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
    const completed = await waitDb(
      orderId,
      (state) => state.status === "completed",
      MATCH_WAIT_MS,
      closeAt,
    );
    if (completed === null) {
      if (Date.now() >= closeAt) return { kind: "undecided", reason: "close_deadline" };
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
    driverSocket?.close();
    riderSocket?.linger(RIDER_LINGER_MS);
    // `LOAD-01` — دورةُ حياةِ العرضِ منَ القاعدةِ (أفضلُ جهدٍ): طوابعُ صفوفِ
    // `order_offers` للطلبِ وإشعارُ البوابةِ — تُقرأُ قبلَ التنظيفِ لتُوثَّقَ
    // الحالةُ الفعليةُ التي انتهى إليها السيناريو.
    if (corr.orderId !== undefined) {
      try {
        await recordOfferLifecycle(corr);
      } catch {
        // أفضلُ جهدٍ — فشلُ التوثيقِ لا يغيّرُ المآلَ.
      }
    }
    // تنظيفُ نهايةِ السيناريو: السائقُ يغدو غيرَ متاحٍ — وإلا تراكمَ في الحوضِ
    // مئاتُ السائقينَ الخاملينَ المتاحينَ (`LOAD-01` التشخيصُ: هذا عينُ ما أفقدَ
    // سائقَ السيناريو مقعدَهُ بينَ أقربِ خمسةٍ مرشحينَ في الجولاتِ المتأخرةِ،
    // فبقيتِ الطلباتُ تبحثُ بلا وصولٍ أبدًا) — التنظيفُ أفضلُ جهدٍ لا يُفشلُ
    // السيناريو: فشلُهُ يُسجَّلُ حدثًا لا يغيّرُ المآلَ.
    if (driverToken !== null) {
      try {
        const cleanup = await call("/v1/driver/availability", {
          method: "POST",
          token: driverToken,
          body: { is_available: false },
          timeoutMs: 15_000,
        });
        if (!cleanup.ok) {
          ev("driver.cleanup_failed", {
            index: corr.index,
            status: cleanup.networkError ?? cleanup.status,
          });
        }
      } catch {
        ev("driver.cleanup_failed", { index: corr.index, status: "exception" });
      }
    }
    ev("scenario.end", {
      index: corr.index,
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
  closeAt: number,
): Promise<true | null> {
  const deadline = boundedDeadline(Date.now() + waitMs, closeAt);
  for (;;) {
    const state = await orderStateSafe(orderId);
    if (state !== null && predicate(state)) return true;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
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

async function offerStateSafe(offerId: string) {
  const rows = await sql<{ status: string }[]>`
    select status::text as status from order_offers where id = ${offerId}
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return { status: row.status };
}

/** دورةُ حياةِ العرضِ منَ القاعدةِ — طوابعُ العروضِ للطلبِ (الإنشاءُ/الصلاحيةُ/
 * الاستجابةُ) وحالةُ كلٍّ منها ومستقبِلُه، وإشعارُ البوابةِ للعرضِ (delivered_at)
 * — لا يُسجَّلُ payload ولا رموزٌ. */
async function recordOfferLifecycle(corr: ScenarioCorr): Promise<void> {
  const orderId = corr.orderId;
  if (orderId === undefined) return;
  const offers = await sql<
    {
      id: string;
      status: string;
      driver_id: string;
      round: number;
      created_at: string;
      expires_at: string;
      responded_at: string | null;
    }[]
  >`
    select id::text, status::text, driver_id::text, round,
           created_at::text, expires_at::text, responded_at::text
      from order_offers where order_id = ${orderId} order by round, created_at
  `;
  const outbox = await sql<{ status: string; attempts: number; delivered_at: string | null }[]>`
    select status::text, attempts, delivered_at::text
      from notification_outbox where order_id = ${orderId} and offer_id is not null
  `;
  ev("scenario.offer_lifecycle", {
    index: corr.index,
    orderId,
    offers: offers.map((o) => ({
      id: o.id.slice(0, 8),
      status: o.status,
      driver: o.driver_id.slice(0, 8),
      round: o.round,
      createdAt: o.created_at,
      expiresAt: o.expires_at,
      respondedAt: o.responded_at,
    })),
    outbox: outbox.map((n) => ({
      status: n.status,
      attempts: n.attempts,
      deliveredAt: n.delivered_at,
    })),
  });
}

/* ───────── الحلقةُ الرئيسةُ ───────── */

async function main() {
  ev("gen.start", {
    profile: PROFILE,
    depth: DEPTH,
    city: CITY,
    drainSec: DRAIN_SEC,
    driverSocketMix: DRIVER_SOCKET_MIX,
    riderSocketMix: RIDER_SOCKET_MIX,
    riderLingerMs: RIDER_LINGER_MS,
  });
  // حارسُ مهلةٍ خارجيٌّ: لا تعليقَ للجولةِ كلِّها مهما علقَ — يُوثّقُ ويخرجُ.
  const watchdogAt =
    T0 + (PROFILE.reduce((acc, ph) => acc + ph.sec, 0) + DRAIN_SEC * PROFILE.length + 60) * 1000;
  const watchdog = setTimeout(
    () => {
      ev("gen.watchdog", { at: watchdogAt, budgetSec: Math.round((watchdogAt - T0) / 1000) });
      console.error("✖ حارسُ المهلةِ: الجولةُ لم تُغلق ضمنَ الميزانيةِ.");
      process.exit(1);
    },
    Math.max(1, watchdogAt - Date.now()),
  );
  watchdog.unref?.();
  const snapshotTimer = setInterval(() => rec.snapshot(), 1_000);
  const closeStats = { closeDeadlineHits: 0, stuckAtClose: 0, drainMsTotal: 0 };
  for (const ph of PROFILE) {
    phase = ph.name;
    ev("phase.start", { name: ph.name, sec: ph.sec, conc: ph.conc });
    const stopAt = Date.now() + ph.sec * 1000;
    // `LOAD-01` — موعدُ الإغلاقِ الصارمُ: نهايةُ الحقنِ + نافذةُ ختامٍ معلنةٌ؛
    // كلُّ انتظارٍ في السيناريو محدودٌ بهِ فلا انتظارَ بلا سقفٍ.
    const closeAt = stopAt + DRAIN_SEC * 1000;
    let index = 0;
    const running = new Set<Promise<void>>();
    const launch = async (): Promise<void> => {
      const outcome = await runScenario(index++, closeAt);
      if (outcome.kind === "verified") rec.scenarioEnd("verified");
      else if (outcome.kind === "rejected") rec.scenarioEnd("rejected");
      else rec.scenarioEnd("undecided");
      if ((outcome.reason ?? "").includes("close_deadline")) closeStats.closeDeadlineHits += 1;
      // المآلُ يُسجَّلُ دائمًا — الناجحُ أيضًا — لا فقطِ المتعثرِ: فبدلُّهِ
      // يبدو الحملُ كلهُ فاشلًا في سجلِّ الأحداثِ رغمَ نجاحِهِ في القاعدةِ.
      ev("scenario.outcome", {
        kind: outcome.kind,
        ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
        // `LOAD-01` — الارتباطُ الكاملُ في الحدثِ نفسِهِ (لا رموزَ جلساتٍ).
        ...(outcome.index === undefined ? {} : { index: outcome.index }),
        ...(outcome.riderTelegramId === undefined ? {} : { rider: outcome.riderTelegramId }),
        ...(outcome.driverTelegramId === undefined ? {} : { driver: outcome.driverTelegramId }),
        ...(outcome.orderId === undefined ? {} : { orderId: outcome.orderId }),
        ...(outcome.orderCreatedAt === undefined ? {} : { orderCreatedAt: outcome.orderCreatedAt }),
        ...(outcome.offerWaitStartAt === undefined
          ? {}
          : { offerWaitStartAt: outcome.offerWaitStartAt }),
        ...(outcome.offerWaitMs === undefined ? {} : { offerWaitMs: outcome.offerWaitMs }),
        ...(outcome.offerPolls === undefined ? {} : { offerPolls: outcome.offerPolls }),
        ...(outcome.acceptAttempts === undefined ? {} : { acceptAttempts: outcome.acceptAttempts }),
        ...(outcome.assignedToOtherDriver === undefined
          ? {}
          : { assignedToOtherDriver: outcome.assignedToOtherDriver }),
        ...(outcome.offerFoundAt === undefined ? {} : { offerFoundAt: outcome.offerFoundAt }),
      });
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
    // `LOAD-01` — نافذةُ الختامِ: تصريفٌ محدودٌ بموعدِ الإغلاقِ لا `Promise.all`
    // بلا سقفٍ؛ ما بقيَ بعدَ الموعدِ يُحصى عالقًا ولا يُهملُ.
    ev("phase.drain_start", { name: ph.name, running: running.size, closeAt });
    while (running.size > 0 && Date.now() < closeAt) {
      await sleep(250);
    }
    const stuck = running.size;
    closeStats.stuckAtClose += stuck;
    const drainMs = DRAIN_SEC * 1000 - (closeAt - Date.now());
    closeStats.drainMsTotal += Math.max(0, drainMs);
    if (stuck > 0) {
      ev("phase.close_stuck", { name: ph.name, stuck, closeAt });
    }
    ev("phase.end", { name: ph.name, drainMs: Math.max(0, drainMs), stuck, closeAt });
  }
  clearInterval(snapshotTimer);
  // `LOAD-01 Recovery` — المزيجُ يُعلَنُ قبلَ النتائجِ لا بعدها (النسبةُ منَ
  // البيئةِ لا تُعدَّلُ في أثناءِ الجولةِ).
  ev("gen.driver_socket_mix", { mix: DRIVER_SOCKET_MIX });
  rec.snapshot(true);
  rec.finalSnapshot();

  // الحكمُ النهائيُّ منَ القاعدةِ — لا منَ الوعودِ.
  const duplicates = await engagedDuplicates();
  const summary = {
    path: "miniapp_http",
    gen: GEN_ID,
    elapsedSec: Math.round((Date.now() - T0) / 1000),
    engagedDuplicates: duplicates,
    ...closeStats,
    lastPhaseCloseBudgetSec: DRAIN_SEC,
    // `LOAD-01 Recovery` — حقيقةُ مزيجِ الاتصالِ مقيسةً لا مفترضةً: كم مقبسًا
    // فُتحَ وكم إشارةً وصلت وكم إقرارَ استلامٍ سُجِّل — بها يُحكمُ على مسارِ
    // اللوحِ (الإشارةُ والإيصالُ) لا على العددِ المزروعِ.
    driverSocket: { mix: DRIVER_SOCKET_MIX, ...socketStats },
    riderSocket: { mix: RIDER_SOCKET_MIX, ...riderSocketStats },
  };
  ev("gen.end", summary);
  console.log(JSON.stringify(summary));
  await sql.end({ timeout: 5 });
  process.exit(0);
}

// الاستيرادُ لا يُطلقُ جولةً: اختباراتُ الوحدةِ تستوردُ دوالَّ المولّدِ، وكانَ `main()` يبدأُ عندَ
// الاستيرادِ فيُسلِّحُ حارسَ المهلةِ داخلَ عمليةِ `bun test` ويُسقطُها (`process.exit(1)`) متى طالتِ
// السلسلةُ على جهازٍ بطيءٍ — قيسَ في CI المحلّيِّ للدفعةِ السابعةِ.
if (import.meta.main) void main();
