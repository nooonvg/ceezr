/* biome-ignore-all lint/style/noNonNullAssertion: أداة حمل تجريبية — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * CAP-RUN-20261016-CONTINUATION · المرحلة 1 — تسجيلُ السائقِ منَ التطبيقِ المصغَّرِ
 * في تجهيزِ الحملِ (لا من حوارِ البوتِ ولا بذرِ SQL مباشرٍ).
 *
 * المسارُ هو نفسُهُ الذي يسلكُهُ سائقٌ حقيقيٌّ يفتحُ Mini App (`ADR 0286` ·
 * `PRD-105` · `ADR 0257`):
 *   ١) جلسةٌ موقعةٌ: `POST /v1/session/telegram` بـinitData موقَّعٍ (الهويةُ من
 *      التوقيعِ لا منَ الضميمةِ غيرِ الموقعةِ).
 *   ٢) إثباتُ الرقمِ: بطاقةُ اتصالٍ تصلُ البوتَ عبرَ webhook (المسارُ الحقيقيُّ —
 *      مستنزفُ التحديثاتِ يعالجُها فيخزّنُ الإثباتَ في جلسةِ الحوارِ نفسِها
 *      التي يقرؤها مسارُ التسجيلِ). **تُنتظرُ المهمةُ نفسُها** من طابورِ
 *      `telegram_update_jobs` (مفتاحُها bot+n) حتى `done` — لا فراغَ الطابورِ
 *      العامَّ الذي قد يخفي مهمةً فاشلةً — و`dead` فشلٌ صريحٌ يُسجَّل.
 *   ٣) `POST /v1/onboarding/driver` بالاسمِ والمدينةِ والخدمةِ والمركبةِ واللوحةِ
 *      والهويةِ الوطنيةِ — الردُّ 201 والتحققُ `pending` (لا توثيقَ آليًّا — التوثيقُ
 *      قرارُ مالكٍ/مشرفٍ).
 *   ٤) **خطواتُ المالكِ/المشرفِ** (لا واجهةَ إداريةً في البيئةِ المعزولةِ): التوثيقُ
 *      والقدرةُ والتجربةُ — SQL موثَّقٌ صادقًا بأنهُ فعلُ مشرفٍ لا فعلِ المستخدمِ،
 *      **والحكمُ عليها منَ القاعدةِ** (الحالةُ النهائيةُ المقروءةُ) لا منَ نجاحِ
 *      تنفيذِ العبارةِ.
 *
 * والتحققُ منَ القاعدةِ لا منَ 2xx: صفُّ السائقِ موجودٌ بحالةِ `pending` بعدَ
 * التسجيلِ، ثمَّ `verified` معَ قدرةٍ واشتراكٍ فعّالٍ بعدَ خطواتِ المشرفِ.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";
import { BASE, http, signedInitData, sleep } from "./lib.ts";

const DB_URL = process.env.DATABASE_URL ?? "";
// إن غاب DATABASE_URL (كاستيرادٍ في اختبارٍ ما) يُبنى الرابطُ بصيغةٍ صالحةٍ —
// postgres.js لا يتصلُ إلا عندَ أولِ استعلامٍ فلا أثرَ للاستيرادِ في الاختباراتِ.
const sql = postgres(
  DB_URL === ""
    ? "postgres://127.0.0.1:5/none?application_name=driver-onboarding"
    : `${DB_URL}?application_name=driver-onboarding`,
  { max: 4, idle_timeout: 20, connect_timeout: 10 },
);
const DRIVER_BOT_TOKEN = process.env.DRIVER_BOT_TOKEN ?? "";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";

/**
 * معرّفُ تحديثٍ فريدٌ متزايدٌ — بطاقاتُ الاتصالِ المتتاليةُ (خلالَ الثانيةِ
 * نفسِها) لا يجوزُ أن تتصادمَ فيُتجاهلَها الـwebhook كتكرارٍ (`duplicate_ignored`)
 * فيضيعَ إثباتُ الرقمِ. البذرةُ منَ الساعةِ فتتفرّدُ الجولاتُ أيضًا.
 */
let updateSeq = Date.now() % 2_000_000_000;
export function nextUpdateId(): number {
  updateSeq = (updateSeq + 1) % 2_000_000_000;
  return updateSeq;
}

export interface DriverOnboardingRecord {
  readonly telegramId: number;
  readonly fullName: string;
  readonly phone: string;
  readonly plateNumber: string;
  readonly nationalId: string;
  driverId: string | null;
  /** معرّفُ بطاقةِ الاتصالِ في طابورِ الواردِ — للتشخيصِ والربطِ */
  contactUpdateId: number;
  /** مدينةُ التسجيلِ كما سجّلتها الواجهةُ — والقدرةُ تُنشأُ في المدينةِ نفسِها */
  cityId: string | null;
  /** كلُّ خطوةٍ بمآلِها الصادقِ — النجاحُ والفشلُ يُسجَّلانِ لا يُخفى أحدهما */
  readonly steps: {
    session: "ok" | string;
    phoneProofWebhook: number;
    phoneProofJob: "ok" | "dead" | "timeout" | "not_run";
    onboardingPost: number;
    dbPendingVerified: boolean;
    adminVerification: "ok" | string;
    capability: "ok" | string;
    trial: "ok" | string;
  };
  ok: boolean;
}

export interface OnboardDriverOptions {
  readonly telegramId: number;
  /** مدينةُ التسجيلِ (معرّفًا) — مثلُ مولّدِ القروباتِ الذي يعرفُ مدنَهُ سلفًا */
  readonly cityId?: string | null;
  /** مدينةُ التسجيلِ (رمزًا مثل JED) — مدينةُ السيناريو: التسجيلُ والقدرةُ فيها */
  readonly cityCode?: string;
  /** خدمةُ السائقِ (مولّدُ القروباتِ يحتاجُ transport وdelivery معًا) */
  readonly service?: "transport" | "delivery";
}

/**
 * انتظارُ **المهمةِ المحددةِ** — لا فراغَ الطابورِ العامَّ: المهمةُ محفوظةٌ
 * بمفتاحِ (bot, n) وحالتُها `done`/`dead` تُختمُ فلا تختفي. `dead` فشلٌ صريحٌ،
 * وانتهاءُ المهلةِ `timeout` يُسجَّلُ لا يُمرَّرُ نجاحًا.
 */
async function waitForSpecificJob(
  updateId: number,
  deadlineMs: number,
): Promise<"ok" | "dead" | "timeout"> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const rows = await sql<{ status: string }[]>`
      select status from telegram_update_jobs where bot = 'driver' and update_id = ${updateId}::bigint
    `;
    const status = rows[0]?.status;
    if (status === "done") return "ok";
    if (status === "dead") return "dead";
    await sleep(400);
  }
  return "timeout";
}

/** إرسالُ بطاقةِ الاتصالِ عبرَ webhook — المسارُ الحقيقيُّ لإثباتِ الرقمِ. */
async function sendContactViaWebhook(
  driverTg: number,
  phone: string,
): Promise<{ status: number; updateId: number }> {
  const updateId = nextUpdateId();
  const update = JSON.stringify({
    update_id: updateId,
    message: {
      chat: { id: driverTg },
      from: { id: driverTg, is_bot: false, first_name: "driver" },
      date: Math.floor(Date.now() / 1000),
      contact: { phone_number: phone, first_name: "driver", user_id: driverTg },
    },
  });
  try {
    const response = await fetch(`${BASE}/webhook/telegram/driver`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": TELEGRAM_WEBHOOK_SECRET,
      },
      body: update,
      signal: AbortSignal.timeout(10_000),
    });
    await response.arrayBuffer();
    return { status: response.status, updateId };
  } catch {
    return { status: 0, updateId };
  }
}

/** مدنُ التسجيلِ من واجهةِ التطبيقِ نفسِها (GET /v1/onboarding). */
async function citiesFromApp(token: string): Promise<{ id: string }[]> {
  const status = await http("/v1/onboarding", { token, timeoutMs: 15_000 });
  return (status.body as { cities?: { id: string }[] } | null)?.cities ?? [];
}

/**
 * معرّفُ مدينةِ السيناريو (برمزِها) منَ القاعدةِ، معَ تحققٍ أنّها في قائمةِ
 * مدنِ التطبيقِ الفعالةِ — التسجيلُ والقدرةُ في مدينةِ السيناريو نفسِها فلا
 * يُسجَّلُ السائقُ في مدينةٍ لا يُختبرُ فيها (مطابقةُ العروضِ بالقدرةِ).
 */
async function cityIdForCode(token: string, code: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id::text as id from cities where code = ${code}
  `;
  const id = rows[0]?.id ?? null;
  if (id === null) return null;
  const cities = await citiesFromApp(token);
  return cities.some((c) => c.id === id) ? id : null;
}

/**
 * تطهيرُ الاسمِ منَ تكرارِ محرفٍ متتالٍ (4+) — `parseFullName` يرفضُه كعبثٍ
 * وهو سلوكٌ صحيحٌ للمنتجِ نحترمُهُ لا نتحايلُ عليهِ. دالةٌ نقيةٌ تُختبرُ سلوكيًّا.
 */
export function collapseDigitRuns(value: string): string {
  return value.replace(/(\d)\1{3,}/g, (m) => m.slice(0, 3));
}

/**
 * تسجيلُ سائقٍ كاملُ منَ التطبيقِ — يعيدُ السجلَّ بمآلِ كلِّ خطوةٍ. الهويةُ
 * `telegramId` صريحةٌ (لا اشتقاقَ قاعدةٍ) ليستخدمَهُ مولّدُ القروباتِ بمحادثاتِهِ
 * المحددةِ سلفًا.
 */
export async function onboardDriverViaApp(
  opts: OnboardDriverOptions,
): Promise<DriverOnboardingRecord> {
  const driverTg = opts.telegramId;
  // الاسمُ للعرضِ فقط — لا يُقاسُ بهِ تفردٌ (الهويةُ telegram_id)
  const nameTag = collapseDigitRuns(String(driverTg));
  const fullName = `سائق التطبيق ${nameTag}`;
  // الجوالُ السعودي: 5 ثمّ ثمانيةَ أرقامَ — يُشتقُّ منَ الهويةِ فيتفرّدُ لكلِّ سائقٍ
  const phone = `+9665${`5${String(driverTg).padStart(7, "0").slice(-7)}`.slice(-8)}`;
  const plateNumber = `ر س ق ${String(driverTg).slice(-4)}`;
  const nationalId = `1${String(driverTg).padStart(9, "0").slice(-9)}`;
  let contactUpdateId = -1;
  let cityId: string | null = opts.cityId ?? null;
  const service = opts.service ?? "transport";
  const record: DriverOnboardingRecord = {
    telegramId: driverTg,
    fullName,
    phone,
    plateNumber,
    nationalId,
    driverId: null,
    contactUpdateId: -1,
    cityId: null,
    steps: {
      session: "not_run",
      phoneProofWebhook: 0,
      phoneProofJob: "not_run",
      onboardingPost: 0,
      dbPendingVerified: false,
      adminVerification: "not_run",
      capability: "not_run",
      trial: "not_run",
    },
    ok: false,
  };

  // ١) الجلسةُ الموقعةُ — المستخدمُ غيرُ المسجَّلِ يملكُ جلسةً (حالةُ التسجيلِ).
  // `start_param` يميّزُ initData عنْ جلسةِ العملِ اللاحقةِ: حارسُ إعادةِ الاستعمالِ
  // (`SEC-17`) يرفضُ initData المتطابقةَ — وسلوكُهُ صحيحٌ، فالتمييزُ علينا.
  const session = await http("/v1/session/telegram", {
    method: "POST",
    body: {
      initData: signedInitData({
        botToken: DRIVER_BOT_TOKEN,
        telegramId: driverTg,
        startParam: "onboard",
      }),
    },
    timeoutMs: 15_000,
  });
  const token = (session.body as { accessToken?: string } | null)?.accessToken ?? null;
  record.steps.session = session.ok && token !== null ? "ok" : `http_${session.status}`;

  // ٢) إثباتُ الرقمِ عبرَ webhook — تُنتظرُ المهمةُ نفسُها حتى done
  if (token !== null) {
    const contact = await sendContactViaWebhook(driverTg, phone);
    contactUpdateId = contact.updateId;
    record.steps.phoneProofWebhook = contact.status;
    if (contact.status === 200) {
      // تشخيصُ فقط (ب24): مهلةُ انتظارِ معالجةِ مهمّةِ إثباتِ الهاتفِ قابلةٌ للضبطِ
      // لإعادةِ إنتاجِ نظامِ «طابورِ البثّ» على مقعدٍ محدودِ المعالجِ؛ الافتراضيُّ 20s
      // كما في كلِّ الجولاتِ السابقةِ، ولا يغيّرُ هذا سلوكَ القبولِ الرسميّ.
      const phoneProofWaitMs = Number(process.env.PHONE_PROOF_WAIT_MS ?? 20_000);
      record.steps.phoneProofJob = await waitForSpecificJob(contact.updateId, phoneProofWaitMs);
    }
  }
  record.contactUpdateId = contactUpdateId;

  // ٣) التسجيلُ من واجهةِ التطبيقِ — الهويةُ الوطنيةُ تُشتقُّ منَ الهويةِ فتتفرّدُ
  if (token !== null && record.steps.phoneProofWebhook === 200) {
    if (cityId === null && opts.cityCode !== undefined) {
      cityId = await cityIdForCode(token, opts.cityCode);
    }
    if (cityId === null) cityId = (await citiesFromApp(token))[0]?.id ?? null;
    if (cityId !== null) {
      const create = await http("/v1/onboarding/driver", {
        method: "POST",
        token,
        body: {
          fullName,
          cityId,
          service,
          vehicleType: "sedan",
          plateNumber,
          nationalId,
          language: "ar",
        },
        timeoutMs: 20_000,
      });
      record.steps.onboardingPost = create.status;
    } else {
      record.steps.onboardingPost = -1; // لا مدينةً منَ الواجهةِ — يُسجَّلَ لا يُفترَضْ
    }
  }
  record.cityId = cityId;

  // التحققُ منَ القاعدةِ: صفٌّ بحالةِ pending — لا توثيقَ آليًّا (قرارُ مشرفٍ).
  // هذا الحكمُ يثبتُ بالانتقالِ أنَّ بطاقةَ الاتصالِ عولجت فعلًا (ولولاها لرفضَ
  // المسارُ بـ409 PHONE_NOT_VERIFIED).
  const seeded = await sql<{ id: string; verification: string }[]>`
    select d.id::text as id, d.verification_status::text as verification
      from drivers d join users u on u.id = d.user_id
     where u.telegram_id = ${driverTg}::bigint
  `;
  const row = seeded[0];
  record.driverId = row?.id ?? null;
  record.steps.dbPendingVerified = row?.verification === "pending";

  // ٤) خطواتُ المشرفِ (لا واجهةَ إداريةً معزولةً): التوثيقُ والقدرةُ والتجربةُ.
  // القدرةُ في مدينةِ التسجيلِ نفسِها (اتساقٌ لا تناقضٌ بين بيتِ السائقِ وقدرتِه).
  if (record.steps.dbPendingVerified && record.driverId !== null) {
    try {
      await sql`
        update drivers set verification_status = 'verified'::verification_status
         where id = ${record.driverId}::uuid and verification_status = 'pending'::verification_status
      `;
    } catch (e) {
      record.steps.adminVerification = String(e).slice(0, 60);
    }
    try {
      await sql`
        insert into driver_capabilities (city_id, driver_id, service)
        values (${cityId ?? null}::uuid, ${record.driverId}::uuid, ${service}::service_type)
        on conflict do nothing
      `;
    } catch (e) {
      record.steps.capability = String(e).slice(0, 60);
    }
    try {
      // الدالةُ تعيد jsonb (ok/خطأ) ولا ترمي — قيمتُها تُسجَّل لا تُبتلَع
      const trial = await sql<{ result: unknown }[]>`
        select start_trial(${record.driverId}::uuid, ${service}::subscription_plan) as result
         where not exists (select 1 from subscriptions s where s.driver_id = ${record.driverId}::uuid)
      `;
      const trialResult = trial[0]?.result;
      if (trialResult !== undefined && JSON.stringify(trialResult).includes('"ok":false')) {
        record.steps.trial = `fn_${JSON.stringify(trialResult).slice(0, 50)}`;
      }
    } catch (e) {
      record.steps.trial = String(e).slice(0, 60);
    }

    // الحكمُ منَ القاعدةِ (الحالةُ النهائيةُ المقروءةُ) لا منَ نجاحِ تنفيذِ SQL:
    // توثيقٌ verified + قدرةٌ قائمةٌ + اشتراكٌ فعّالٌ.
    const final = await sql<{ verification: string; capability: boolean; active_sub: boolean }[]>`
      select d.verification_status::text verification,
             exists(select 1 from driver_capabilities c
                     where c.driver_id = d.id and c.service = ${service}::service_type) capability,
             exists(select 1 from subscriptions s
                     where s.driver_id = d.id and s.status in ('trialing'::subscription_status, 'active'::subscription_status)) active_sub
        from drivers d where d.id = ${record.driverId}::uuid
    `;
    const f = final[0];
    record.steps.adminVerification =
      record.steps.adminVerification === "not_run" && f?.verification === "verified"
        ? "ok"
        : record.steps.adminVerification === "not_run"
          ? `db_${f?.verification ?? "absent"}`
          : record.steps.adminVerification;
    record.steps.capability =
      record.steps.capability === "not_run" && f?.capability === true
        ? "ok"
        : record.steps.capability === "not_run"
          ? "db_missing"
          : record.steps.capability;
    record.steps.trial =
      record.steps.trial === "not_run" && f?.active_sub === true
        ? "ok"
        : record.steps.trial === "not_run"
          ? "db_no_active_sub"
          : record.steps.trial;
  }

  record.ok =
    record.steps.session === "ok" &&
    record.steps.phoneProofWebhook === 200 &&
    record.steps.phoneProofJob === "ok" &&
    record.steps.onboardingPost === 201 &&
    record.steps.dbPendingVerified &&
    record.steps.adminVerification === "ok" &&
    record.steps.capability === "ok" &&
    record.steps.trial === "ok";
  return record;
}

/** تشغيلٌ مستقلٌّ: `RUN_ONBOARD_STANDALONE=1 ONBOARD_BASE=... bun run ...` */
async function main(): Promise<void> {
  const base = Number(process.env.ONBOARD_BASE ?? 10_500_000);
  const count = Number(process.env.ONBOARD_COUNT ?? 3);
  const results: DriverOnboardingRecord[] = [];
  for (let i = 1; i <= count; i += 1) {
    const record = await onboardDriverViaApp({ telegramId: base + i });
    results.push(record);
    console.log(JSON.stringify(record));
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(
    JSON.stringify({
      event: "driver_onboarding.summary",
      total: results.length,
      ok,
      failed: results.length - ok,
    }),
  );
  appendToFile(results);
  await sql.end({ timeout: 5 });
}

function appendToFile(results: DriverOnboardingRecord[]): void {
  const RUN_DIR = process.env.RUN_DIR ?? "/tmp/cap-run";
  mkdirSync(`${RUN_DIR}/evidence`, { recursive: true });
  const lines = results.map((r) => JSON.stringify(r)).join("\n");
  appendFileSync(`${RUN_DIR}/evidence/driver-onboarding.jsonl`, `${lines}\n`);
}

if (process.env.RUN_ONBOARD_STANDALONE === "1") {
  void main();
}
