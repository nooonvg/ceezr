/**
 * الغرض: اختبار حمل حقيقي على البوابة: خادم HTTP فعلي، وقاعدة PostgreSQL فعلية،
 *   وتحديثات تلغرام حقيقية الشكل — بلا أي مزدوج إلا مُرسِل تلغرام نفسه.
 * الحالة: منفّذ فعلياً — القسم 2 البند د.3.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: من ينشر (قبل رفع عدد النسخ)، وأي تعديل يمسّ مسار الطلب
 * ملاحظات مستقبلية: مُرسِل تلغرام مُستبدَل عن قصد — قياس زمن شبكة تلغرام يقيس تلغرام
 *   لا يقيسنا. من أراد قياس الحلقة كاملة يُشغّله برموز حقيقية على مجموعة اختبار.
 *
 * التشغيل:
 *   TEST_DATABASE_URL=postgres://... bun run scripts/load-test.ts [--users 50] [--rounds 4]
 *
 * حدود هذه الأداة معروفة وموثقة (المرحلة 2 في `docs/SYSTEM_STATE.md`):
 * مولّد الحمل يسكن نفس العملية التي تشغّل الخادم، والحمل دفعٌة مغلقة
 * الحلقة بلا معدّل ورود، والنتائج لا تُحفَظ بصيغة تُقارَن. فهي **أداة إعادة
 * إنتاج الأرقام التاريخية في `docs/load-test-report.md` لا أداة القياس المعتمدة**.
 * القياس المعتمد يسكن `bench/`.
 *
 * لماذا `loadConfig` لا كائن `AppConfig` مكتوب باليد: كان هنا كائنٌ حرفيّ،
 * فحين أُضيف حقل `tracking` إلى `AppConfig` بقي هذا الكائن ناقصاً تسعة حقول،
 * ولأن `scripts/**` كان خارج `tsconfig.json` مرّ الأمر بلا خطأ حتّى انكسرت الأداة
 * في وقت التشغيل. القرار: لا تُكتب `AppConfig` باليد في أداة قياس أبداً — تُبنى
 * من محمّل الضبط الحقيقي نفسه، فأي حقل جديد يأتي بقيمته الافتراضية أو يفشل فشلاً
 * موصوفاً في الضبط لا بـ`TypeError` غامض.
 */

import type { TelegramSender } from "../apps/gateway/src/bots/driver/index.ts";
import { buildContainer } from "../apps/gateway/src/container.ts";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "../apps/gateway/src/rate-limit/fixed-window.ts";
import { createServer } from "../apps/gateway/src/server.ts";
import { loadConfig } from "../packages/shared/config/index.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === "") {
  console.error("❌ عيّن TEST_DATABASE_URL لقاعدة بها كل الهجرات مطبَّقة.");
  process.exit(1);
}

function intArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** عدد تحديثات الويبهوك في تسجيل واحد كامل — يُشتق منه معدّل الطلبات. */
const REGISTRATION_STEPS = 9;

const USERS = intArg("users", 50);
const ROUNDS = intArg("rounds", 4);
const PORT = intArg("port", 4123);
/** طوله فوق الحدّ الإنتاجي (32) ومن مجموعة محارف تلغرام، لأن الضبط يفحصهما. */
const SECRET = "load-test-secret-load-test-secret-0001";

/** مُرسِل صامت: لا شبكة، ولا تأخير مُصطنع — الزمن المقيس زمننا لا زمن تلغرام. */
const silentSender: TelegramSender = {
  sendMessage: async () => "1",
  sendPhoto: async () => "1",
  sendLocation: async () => "1",
};

/**
 * مصدر البيئة مُعلَن بالكامل ولا يُقرأ من `process.env`: متغيّر متروك في صدفة
 * المشغّل لا يجوز أن يغيّر ما يقيسه القياس من حيث لا يدري — وإلا تغيّرت الأرقام
 * بتغيّر الصدفة لا بتغيّر الكود.
 */
const benchEnv: Record<string, string> = {
  NODE_ENV: "test",
  PORT: String(PORT),
  SUPABASE_URL: "https://local.test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "load-test",
  DATABASE_URL,
  UPSTASH_REDIS_REST_URL: "http://localhost",
  UPSTASH_REDIS_REST_TOKEN: "load-test",
  DRIVER_BOT_TOKEN: "load-test-driver",
  RIDER_BOT_TOKEN: "load-test-rider",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "990001",
  SESSION_STORE: "memory",
  TRANSLATION_PROVIDER: "none",
  // مُعلَن صراحةً: افتراض الضبط `true`، والإنتاج اليوم `true`. هذا القياس
  // يعزل مسار الطلب عن المهام الدورية، فأرقامه **متفائلة مقابل الإنتاج**
  // وليست مماثلةً له. قياس التزاحم مع العامل المضمَّن قياسٌ منفصل واجب.
  RUN_WORKER_IN_GATEWAY: "false",
  // ‏`RUN_ADMIN_IN_GATEWAY` مُعلَنٌ **توثيقاً لا أثراً**: هذا المِقياسُ يبني الحاويةَ
  // بيدِه ولا يمرُّ بنقطةِ دخولِ البوّابةِ، فسطحُ الإدارةِ غيرُ مُركَّبٍ فيه في
  // الحالَين. والإعلانُ يمنع أن يُقرأ غيابُه سهواً فيُقلَب يوماً (F5-08).
  RUN_ADMIN_IN_GATEWAY: "false",
  // ADR 0286: الافتراضيُّ صارَ miniapp — ووضعُهُ يُلزمُ MINIAPP_URL،
  // فالمقعدُ المعماريُّ يُعلنُهُ صراحةً (قيمةُ اختبارٍ لا إنتاج) ليبقى
  // عقدُ البيئةِ مُلبّى بعدَ تغييرِ الافتراضيّ.
  BOT_SURFACE_MODE: "miniapp",
  MINIAPP_URL: "https://miniapp.bench-test.local",
};

const config = loadConfig(benchEnv);

const container = buildContainer(config, {
  driverSender: silentSender,
  riderSender: silentSender,
});
// نفس اتصال الحاوية لا اتصالاً ثانياً: القياس يجب أن يزاحم على نفس بِركة الاتصالات
// التي يزاحم عليها الإنتاج، وإلا قِسنا بِركتين حيث توجد واحدة.
const sql = container.sql;

// حدود المعدّل مرفوعة عملياً في هذا القياس: المطلوب قياس سعة المعالجة لا قياس
// الحدّ نفسه. تشغيله بالحدّ الإنتاجي يقيس متى نقول 429، وذاك اختبار آخر.
const permissive = (): RateLimiter =>
  createMemoryRateLimiter({ limit: 10 ** 9, windowSeconds: 60 });

const app = createServer({
  health: {
    now: () => new Date(),
    startedAt: new Date(),
    env: { ...process.env, ...requiredEnvStub() },
    readinessChecks: [
      {
        name: "database",
        check: async () => (await sql<{ ok: number }[]>`select 1 as ok`)[0]?.ok === 1,
      },
    ],
  },
  webhook: {
    webhookSecret: SECRET,
    handler: container.handler,
    rateLimits: { probes: permissive(), users: permissive() },
  },
});

function requiredEnvStub(): Record<string, string> {
  return {
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.supabaseServiceKey,
    DATABASE_URL: config.databaseUrl,
    UPSTASH_REDIS_REST_URL: config.redisUrl,
    UPSTASH_REDIS_REST_TOKEN: config.redisToken,
    DRIVER_BOT_TOKEN: config.driverBotToken,
    RIDER_BOT_TOKEN: config.riderBotToken,
    TELEGRAM_WEBHOOK_SECRET: config.telegramWebhookSecret,
    BOOTSTRAP_ADMIN_TELEGRAM_ID: config.bootstrapAdminTelegramId,
  };
}

const server = Bun.serve({ port: PORT, fetch: app.fetch });
const base = `http://localhost:${PORT}`;

async function prepare(): Promise<string> {
  await sql`truncate table audit_log, attendance_log, order_offers, orders,
                           subscriptions, driver_capabilities, driver_availability,
                           drivers, riders, users restart identity cascade`;
  await sql`
    update cities
       set is_active = true,
           telegram_support_group_id = -1001,
           telegram_escalation_group_id = -1002,
           telegram_unsubscribed_drivers_group_id = -1003
     where code = 'JED'
  `;
  const rows = await sql<{ id: string }[]>`select id from cities where code = 'JED'`;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("لم تُطبَّق هجرة بذر المدن");
  return id;
}

interface Sample {
  readonly label: string;
  readonly ms: number;
  readonly status: number;
  /** مسار الويبهوك يُجيب 200 على الفشل الداخلي، فالحكم من الجسم لا من الحالة. */
  readonly bodyError: string | null;
}

const samples: Sample[] = [];

/**
 * لماذا يُقرأ الجسم: مسار الويبهوك يُجيب `200 {ok:false,error:"NOT_HANDLED"}`
 * حين تفشل المعالجة، لأن تلغرام يُعيد الإرسال على غير 200. فقياسٌ يحكم من
 * الحالة وحدها يعدّ الفشل الكامل نجاحاً كاملاً — وهو ما حدث فعلاً قبل هذا الإصلاح.
 */
async function send(label: string, body: unknown): Promise<void> {
  const startedAt = performance.now();
  const response = await fetch(`${base}/webhook/telegram/driver`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": SECRET,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  const ms = performance.now() - startedAt;
  samples.push({ label, ms, status: response.status, bodyError: bodyErrorOf(raw) });
}

function bodyErrorOf(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "UNPARSEABLE_BODY";
  }
  if (typeof parsed !== "object" || parsed === null) return "UNPARSEABLE_BODY";
  const record = parsed as Record<string, unknown>;
  if (record.ok === true) return null;
  const code = record.error;
  return typeof code === "string" ? code : "UNKNOWN_ERROR";
}

const text = (id: number, value: string) => ({
  message: { chat: { id }, from: { id, language_code: "ar" }, text: value },
});
/**
 * `user_id` واجب لا زائد: الحوار يرفض بطاقةً لا تملكها ("هذه بطاقة شخص آخر")،
 * وهو قيدٌ أُضيف بعد كتابة هذا القياس. بغيابه يتوقّف الحوار عند الجوال أبداً،
 * وزرّ مشاركة الرقم في تلغرام يرسل `user_id` فعلاً — فهذه محاكاةٌ للواقع لا تحايل.
 */
const contact = (id: number, phone: string) => ({
  message: {
    chat: { id },
    from: { id, language_code: "ar" },
    contact: { phone_number: phone, user_id: id },
  },
});
const callback = (id: number, data: string) => ({
  callback_query: { data, from: { id }, message: { chat: { id } } },
});
const photo = (id: number, fileId: string) => ({
  message: { chat: { id }, from: { id, language_code: "ar" }, photo: [{ file_id: fileId }] },
});

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
}

function report(label: string, values: number[]): string {
  const total = values.reduce((sum, value) => sum + value, 0);
  return [
    label.padEnd(26),
    `عدد ${String(values.length).padStart(5)}`,
    `وسيط ${percentile(values, 0.5).toFixed(1)}ms`,
    `p95 ${percentile(values, 0.95).toFixed(1)}ms`,
    `p99 ${percentile(values, 0.99).toFixed(1)}ms`,
    `أقصى ${Math.max(...values).toFixed(1)}ms`,
    `متوسط ${(total / values.length).toFixed(1)}ms`,
  ].join("  ");
}

async function main(): Promise<void> {
  const cityId = await prepare();
  const firstId = 700_000;

  console.log(`▶️  ${USERS} مستخدماً متزامناً × ${ROUNDS} دورة، على المنفذ ${PORT}`);

  // 1) تسجيل متزامن: أثقل مسار كتابةً — أربع خطوات حوار وإنشاء صفوف في users
  //    وdrivers وdriver_capabilities وsubscriptions لكل مستخدم.
  const registerStartedAt = performance.now();
  await Promise.all(
    Array.from({ length: USERS }, async (_unused, index) => {
      const id = firstId + index;
      // الخطوات التسع هي الحوار الحقيقي كما في packages/application/bots/driver-dialog.ts:
      // awaiting_name ← phone ← city ← service ← vehicle_type ← plate ← national_id ← photo.
      // كان هذا القياس يتوقّف عند الخدمة، فلا يُكتب صفّ سائقٍ واحد، ومع ذلك يطبع
      // «تسجيل كامل: … طلب/ثانية». الصفوف تُكتب في الخطوة الأخيرة دفعةً واحدة.
      await send("تسجيل: /start", text(id, "/start"));
      await send("تسجيل: الاسم", text(id, `سائق رقم ${index}`));
      await send("تسجيل: الجوال", contact(id, `+96650000${String(index).padStart(4, "0")}`));
      await send("تسجيل: المدينة", callback(id, `city:${cityId}`));
      await send("تسجيل: الخدمة", callback(id, "service:transport"));
      await send("تسجيل: نوع المركبة", callback(id, "vehicle:sedan"));
      await send("تسجيل: اللوحة", text(id, `ABC${String(1000 + index).slice(-4)}`));
      // عشرة أرقام تبدأ بـ1 أو 2، وفريدة لكل سائق لأن الهوية مقيَّدة بالتفرّد.
      await send("تسجيل: الهوية", text(id, `1${String(100000000 + index).slice(-9)}`));
      await send("تسجيل: صورة المركبة", photo(id, `load-test-photo-${id}`));
    }),
  );
  const registerMs = performance.now() - registerStartedAt;

  const registered = await sql<{ count: string }[]>`select count(*)::text as count from drivers`;
  console.log(`   سُجّل ${registered[0]?.count} سائقاً في ${(registerMs / 1000).toFixed(2)} ثانية`);

  // 2) أوامر متكرّرة على قاعدة فيها بيانات فعلية: قراءة حالة + استعلام إعدادات.
  const commandStartedAt = performance.now();
  for (let round = 0; round < ROUNDS; round += 1) {
    await Promise.all(
      Array.from({ length: USERS }, (_unused, index) =>
        send("أمر متكرّر: /status", text(firstId + index, "/status")),
      ),
    );
  }
  const commandMs = performance.now() - commandStartedAt;
  const commandCount = USERS * ROUNDS;

  // 3) رفض السرّ الخاطئ: أرخص مسار — يقيس سقف الاستقبال بلا عمل قاعدة.
  const rejectStartedAt = performance.now();
  await Promise.all(
    Array.from({ length: commandCount }, async () => {
      const startedAt = performance.now();
      const response = await fetch(`${base}/webhook/telegram/driver`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "wrong",
        },
        body: "{}",
      });
      await response.text();
      samples.push({
        label: "رفض سرّ خاطئ",
        ms: performance.now() - startedAt,
        status: response.status,
        // الرفض هو المطلوب هنا، فلا يُحتسب خطأ جسمٍ غير متوقَّع.
        bodyError: null,
      });
    }),
  );
  const rejectMs = performance.now() - rejectStartedAt;

  // 4) /ready تحت الحمل: هو ما تسأله Render، فإن تأخّر أعادت تشغيل خدمة سليمة.
  const readyStartedAt = performance.now();
  await Promise.all(
    Array.from({ length: 100 }, async () => {
      const startedAt = performance.now();
      const response = await fetch(`${base}/ready`);
      await response.text();
      samples.push({
        label: "/ready",
        ms: performance.now() - startedAt,
        status: response.status,
        bodyError: null,
      });
    }),
  );
  const readyMs = performance.now() - readyStartedAt;

  console.log("\n=== النتائج ===");
  const byLabel = new Map<string, number[]>();
  for (const sample of samples) {
    const list = byLabel.get(sample.label) ?? [];
    list.push(sample.ms);
    byLabel.set(sample.label, list);
  }
  for (const [label, values] of byLabel) console.log(report(label, values));

  const statuses = new Map<number, number>();
  for (const sample of samples) statuses.set(sample.status, (statuses.get(sample.status) ?? 0) + 1);
  console.log("\nالحالات:", [...statuses].map(([code, count]) => `${code}×${count}`).join(" "));

  console.log("\n=== السعة ===");
  const throughput = (count: number, ms: number) => (count / (ms / 1000)).toFixed(1);
  console.log(`تسجيل كامل     : ${throughput(USERS * REGISTRATION_STEPS, registerMs)} طلب/ثانية`);
  console.log(`أمر متكرّر      : ${throughput(commandCount, commandMs)} طلب/ثانية`);
  console.log(`رفض سرّ خاطئ    : ${throughput(commandCount, rejectMs)} طلب/ثانية`);
  console.log(`/ready         : ${throughput(100, readyMs)} طلب/ثانية`);

  const serverErrors = samples.filter((sample) => sample.status >= 500);
  console.log(`\nأخطاء 5xx: ${serverErrors.length}`);

  // الحكم على الصحة قبل الحكم على السرعة: أرقامُ سعةٍ على مسارٍ لم يعمل بلا معنى.
  const bodyErrors = new Map<string, number>();
  for (const sample of samples) {
    if (sample.bodyError === null) continue;
    bodyErrors.set(sample.bodyError, (bodyErrors.get(sample.bodyError) ?? 0) + 1);
  }
  const bodyErrorCount = [...bodyErrors.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `أخطاء جسمٍ داخل 200: ${bodyErrorCount}` +
      (bodyErrorCount === 0
        ? ""
        : ` — ${[...bodyErrors].map(([code, count]) => `${code}×${count}`).join(" ")}`),
  );

  const [driverRow] = await sql<{ count: string }[]>`select count(*)::text as count from drivers`;
  const driversAtEnd = Number(driverRow?.count ?? "0");
  const registrationHeld = driversAtEnd === USERS;
  console.log(
    `صفوف drivers في النهاية: ${driversAtEnd} من ${USERS} متوقَّعاً — ` +
      (registrationHeld ? "مطابق" : "غير مطابق"),
  );

  if (serverErrors.length > 0 || bodyErrorCount > 0 || !registrationHeld) {
    console.error("\n❌ الجريان غير صالح: أرقام السعة أعلاه لا تُعتمد لأن المسار لم يُنجز عمله.");
    process.exitCode = 1;
  }
}

try {
  await main();
} finally {
  server.stop(true);
  await container.close();
}
