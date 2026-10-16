/**
 * الغرض: `F11-01` (الشقُّ المملوكُ للمستودَعِ) — **فقدانُ البوّابةِ نفسِها بلا إنذارٍ
 *   أثناءَ رحلةٍ جاريةٍ لا يُفقدُ تحديثاً ولا جلسةً ولا رحلةً**.
 *
 *   لا اختبارَ قبلَ هذا اقتَلَ بوّابةً حقيقيّةً (`apps/gateway/src/index.ts`) بـ`SIGKILL`
 *   في منتصفِ رحلةٍ ثمَّ أقلعَ بديلاً: مسارُ فوضى `F5-06` معطَّلٌ بنيويّاً (`R-17` ·
 *   ADR 0050 §٨) فموتُ النسخةِ فيهِ طريقٌ مسدودٌ لا يُنفَّذ. ههنا:
 *
 *     ١) بوّابةٌ حقيقيّةٌ كعمليةِ نظامٍ عبرَ `Bun.spawn` على PostgreSQL حقيقيّةٍ وRedis
 *        حقيقيٍّ (نفسُ قشرةِ REST)، بجلساتٍ في Redis (`ADR 0051`).
 *     ٢) رحلةٌ كاملةٌ عبرَ الويبهوكِ بتحديثاتٍ تحملُ `update_id` فتمرُّ بالإيصالِ
 *        الصامدِ (`ADR 0057`: تسجيلٌ ← طابورٌ ← درينرٌ داخلَ البوّابةِ).
 *     ٣) **قتلٌ حتميٌّ أثناءَ تعليقِ تحقيقٍ**: يُودَعُ تحديثٌ فلا تُقتَلُ الأُولى إلا
 *        وقد رأى الاختبارُ وظيفتَهُ `pending` — فإنْ سبقَهُ الدرينرُ أُعيدتِ المحاولةُ
 *        (أو أُقلِعَتِ الأُولى من جديدٍ إن كانَ القتلُ قد وقعَ) — فلا يعتمدُ القياسُ
 *        على حظِّ توقيتٍ.
 *     ٤) في أثناءِ الموتِ: طلبٌ يُرفَضُ على السِلكِ (رفضُ اتصالٍ لا 200 كاذبٌ).
 *     ٥) بديلٌ يُقلِعُ على المنفذِ نفسِهِ (الموتُ حرَّرَهُ) ويُجيبُ `/ready`.
 *     ٦) التحقيقُ المودَعُ قبلَ الموتِ تُعالِّجُهُ البديلةُ **مرّةً واحدةً** (لا فقدانَ
 *        ولا ازدواجَ)، والجلسةُ في Redis لم تُعَدْ إلى الحالةِ الابتدائيّةِ، والرحلةُ
 *        تكتملُ عبرَ البديلِ والسائقُ يعودُ متاحاً.
 *
 *   ## ما لا يُدَّعى (`ح-5`/`ح-6`)
 *
 *   لا حملَ (`DEC-17` · `OPS-004`): مقيسٌ الاستمراريّةُ عندَ فقدانِ العمليةِ بلا حملٍ.
 *   ولا تعدُّدَ مثيلاتٍ متزامنٌ: البديلُ يُقلِعُ **بعدَ** موتِ الأُولى لا معَهُ (`R-17`).
 *   ولا تصريفَ `SIGTERM` (ذلكَ مقيسٌ في `F5-06`): الموتُ ههنا **بلا إنذارٍ** عمداً.
 *
 * الحالة: اختبارٌ حقيقيٌّ — يتطلّب `UPSTASH_REDIS_REST_URL`/`_TOKEN` و`TEST_DATABASE_URL`.
 * ينتمي إلى: tests/real-redis
 * يُتوقَّع أن يستخدمه لاحقاً: وظيفةُ «تكامل على Redis حقيقي» في CI (ADR 0193).
 * ملاحظات مستقبلية: إن صارَ إقلاعُ البوّابةِ في CI أبطأَ فمهلةُ الجهوزيّةِ أوّلُ ما
 *   يُرفَعُ — لا يُقاسُ زمنُ الإقلاعِ ههنا.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { judgeGatewayLoss } from "../../scripts/lib/gateway-loss.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";
import {
  assertRealRedisWhenRequired,
  createRealRedis,
  type RealRedisHandle,
  realRedisConfigured,
} from "../support/real-redis.ts";

// يسقط التشغيلُ فوراً إن كانت الوظيفةُ تزعمُ Redis حقيقيّاً ولا نقطةَ لها.
assertRealRedisWhenRequired();

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DATABASE_URL = process.env.TEST_DATABASE_URL;
const WEBHOOK_SECRET = "gateway-loss-continuity-secret-0123456789";
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const DRIVER_CHAT = 531_101;
const RIDER_CHAT = 531_102;
const ADMIN = 991_401;
const PROBE_TEXT = "هل أنتَ هنا؟";
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5551, longitude: 39.1902 };
const DRIVER_AT = { latitude: 21.5471, longitude: 39.1751 };
const RIDER_SESSION_KEY = `waslah:session:rider:${RIDER_CHAT}`;
/** راكبُ الشاهدِ: يُترَكُ عمداً في منتصفِ حوارِهِ (`awaiting_pickup`) فيعبُرُ موتَ
 *  البوّابةِ وإقلاعَ البديلِ وهو في خطوتِهِ — فجلسةُ الراكبِ صاحبِ الرحلةِ تُمحى
 *  عمداً عندَ إنشاءِ الطلبِ (`sessions.clear`) وجلسةُ السائقِ عندَ إكمالِ تسجيلِهِ،
 *  فلا يصحُّ قياسُهما؛ الشاهدُ هو الجلسةُ الجاريةُ حقيقةً. */
const WITNESS_CHAT = 531_103;
const WITNESS_SESSION_KEY = `waslah:session:rider:${WITNESS_CHAT}`;
const DRIVER_SESSION_KEY = `waslah:session:driver:${DRIVER_CHAT}`;

/**
 * شرطُ التفعيلِ مكتوبٌ بأسماءِ المتغيّراتِ صريحةً — حاجزُ تصنيفِ التجاوزِ (`OPS-009`)
 * يقرأ **هذا الملفَّ** فيتحقّق أنّ ما يزعمُه السجلُّ شرطاً هو ما يقرؤه الملفُّ فعلاً.
 */
const enabled =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined &&
  realRedisConfigured() &&
  DATABASE_URL !== undefined;
const describeIf = enabled ? describe : describe.skip;
if (!enabled) {
  console.warn(
    "⚠️  فقدانُ البوّابةِ وسطَ رحلةٍ مُتخطًّى: يحتاج UPSTASH_REDIS_REST_URL/_TOKEN وTEST_DATABASE_URL معاً.",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// أدواتُ الويبهوكِ — نفسُ لغةِ تيليجرامَ التي يقرؤها المسارُ (لا بدائلَ مختصرةٍ).
// ─────────────────────────────────────────────────────────────────────────────

let updateId = 6_400_000;
const nextUpdateId = (): number => {
  updateId += 1;
  return updateId;
};

const message = (chatId: number, body: Record<string, unknown>) => ({
  message: { chat: { id: chatId }, from: { id: chatId, language_code: "ar" }, ...body },
});
const text = (chatId: number, value: string) => message(chatId, { text: value });
const photo = (chatId: number, fileId: string) =>
  message(chatId, { photo: [{ file_id: `${fileId}_thumb` }, { file_id: fileId }] });
const location = (chatId: number, at: { latitude: number; longitude: number }) =>
  message(chatId, { location: at });
const contact = (chatId: number, phone: string) =>
  message(chatId, { contact: { user_id: chatId, phone_number: phone } });
const privateCallback = (chatId: number, data: string) => ({
  callback_query: {
    data,
    from: { id: chatId },
    message: { chat: { id: chatId, type: "private" } },
  },
});

/** كلُّ تحديثٍ يحملُ `update_id` — بلا إيصالٍ صامدٍ يُردُّ المسارُ 400 INVALID_UPDATE. */
async function post(bot: "driver" | "rider", update: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE}/webhook/telegram/${bot}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
    },
    body: JSON.stringify({ update_id: nextUpdateId(), ...update }),
  });
}

/** مثلُ `post` لكنَّهُ يُعيدُ `update_id` الذي نُشِرَ فعلاً — القاتلُ يحتاجُ أن يستعلِمَ عنِ المعرّفِ المودَعِ لا عن معرّفٍ تالٍ لم يُنشرْ قطُّ. */
async function postTracked(
  bot: "driver" | "rider",
  update: Record<string, unknown>,
): Promise<{ res: Response; updateId: number }> {
  const updateId = nextUpdateId();
  const res = await fetch(`${BASE}/webhook/telegram/${bot}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": WEBHOOK_SECRET,
    },
    body: JSON.stringify({ update_id: updateId, ...update }),
  });
  return { res, updateId };
}

async function expectOk(res: Promise<Response> | Response): Promise<void> {
  const response = await res;
  if (response.status !== 200) {
    throw new Error(`ويبهوكٌ رُدَّ ${response.status}: ${await response.text()}`);
  }
}

/** ينتظرُ تحقّقَ شرطٍ على DB مع مهلة — لا يفترضُ التوفرَ الفوريَّ. */
async function poll<T>(label: string, fn: () => Promise<T | null>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null && value !== undefined) return value;
    last = value;
    await Bun.sleep(250);
  }
  throw new Error(`انقضتِ المهلةُ بانتظارِ «${label}» (آخرُ قراءةٍ: ${JSON.stringify(last)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// إدارةُ عمليةِ البوّابةِ الحقيقيّةِ
// ─────────────────────────────────────────────────────────────────────────────

interface GatewayHandle {
  readonly proc: Bun.Subprocess;
  readonly logPath: string;
}

let gatewaySeq = 0;

/**
 * يُقلِعُ بوّابةً حقيقيّةً كعمليةِ نظامٍ. السجلاتُ إلى ملفٍّ في `/tmp` — لا أنبوبٌ
 * يُملأُ فيُعلَّقُ الطفلُ، ولا صمتٌ يُخفي تشخيصاً. المفاتيحُ البيئيّةُ نفسُها التي
 * دخلتِ الاختبارَ تُمرَّرُ للطفلِ (نقطةُ Redis نفسُها)، وما يخصُّ الجلسةِ يُضبَطُ
 * صريحاً: `SESSION_STORE=redis` وإلا فالجلسةُ في ذاكرةِ البوّابةِ ويموتُ القياسُ.
 */
function spawnGateway(instanceId: string): GatewayHandle {
  gatewaySeq += 1;
  const logPath = `/tmp/f11-01-gateway-${instanceId}-${gatewaySeq}.log`;
  const log = Bun.file(logPath);
  const proc = Bun.spawn([process.execPath, "apps/gateway/src/index.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(PORT),
      DATABASE_URL: DATABASE_URL ?? "",
      SUPABASE_URL: "https://supabase-unused.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ?? "",
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
      DRIVER_BOT_TOKEN: "fake-driver-bot-token",
      RIDER_BOT_TOKEN: "fake-rider-bot-token",
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      BOOTSTRAP_ADMIN_TELEGRAM_ID: String(ADMIN),
      TELEGRAM_TRANSPORT: "silent",
      SESSION_STORE: "redis",
      RUN_WORKER_IN_GATEWAY: "false",
      RUN_ADMIN_IN_GATEWAY: "false",
      // ADR 0286: الافتراضيُّ صارَ miniapp ويُلزمُ MINIAPP_URL —
      // وبدونِهِ تنهارُ البوّابةُ عندَ تحميلِ التهيئةِ ولا يُجيبُ /ready أبدًا.
      // ADR 0286: في وضع miniapp لا عملَ تجاريًّا في المحادثةِ إطلاقًا — وهذا
      // الاختبارُ يقيسُ دورةَ الرحلةِ عبرَ حوارِ البوتِ (المسارُ القديمُ)،
      // فإثباتُهُ يقتضي الوضعَ القديمَ صراحةً؛ والافتراضيُّ صارَ miniapp.
      BOT_SURFACE_MODE: "legacy",
      BOT_SURFACE_TEST_LEGACY: "1",
      MINIAPP_URL: "https://miniapp.real-redis-test.local",
      TRANSLATION_PROVIDER: "none",
      ROUTING_PROVIDER: "none",
      SERVICE_INSTANCE_ID: instanceId,
    },
    stdout: log,
    stderr: log,
    stdin: "ignore",
  });
  return { proc, logPath };
}

async function waitReady(label: string): Promise<void> {
  await poll(
    `/ready=200 (${label})`,
    async () => {
      const res = await fetch(`${BASE}/ready`).catch(() => null);
      return res !== null && res.status === 200 ? true : null;
    },
    90_000,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// الاختبارُ
// ─────────────────────────────────────────────────────────────────────────────

describeIf("F11-01 · فقدانُ البوّابةِ بلا إنذارٍ: الرحلةُ تعبرُ موتَها", () => {
  let sql: Sql | undefined;
  let redisHandle: RealRedisHandle | undefined;
  let city: ActiveCityHandle | undefined;
  let gatewayA: GatewayHandle | null = null;
  let gatewayB: GatewayHandle | null = null;

  const jobStatus = async (updateId_: number): Promise<string | null> => {
    const handle = sql;
    if (handle === undefined) throw new Error("لا قاعدةَ قبلَ التهيئةِ");
    const rows = await handle<{ status: string }[]>`
      select status from telegram_update_jobs where bot = 'rider' and update_id = ${updateId_}
    `;
    return rows[0]?.status ?? null;
  };

  /** أوّلُ مشاهدةٍ لوظيفةِ التحديثِ بعدَ إيداعِهِ — الإيداعُ متزامنٌ مع الـ200. */
  const firstSeenStatus = async (updateId_: number): Promise<string | null> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const status = await jobStatus(updateId_);
      if (status !== null) return status;
      await Bun.sleep(5);
    }
    return null;
  };

  const redisGet = async (key: string): Promise<string | null> => {
    const handle = redisHandle;
    if (handle === undefined) throw new Error("لا Redis قبلَ التهيئةِ");
    const result = await handle.client.command(["GET", key]);
    if (!result.ok) throw new Error(`قراءةُ ${key} من Redis فشلت: ${JSON.stringify(result.error)}`);
    return result.value === null || result.value === undefined ? null : String(result.value);
  };

  function startA(): GatewayHandle {
    gatewayA = spawnGateway("f11-01-a");
    return gatewayA;
  }

  /** يقتلُ ما بقيَ حيّاً من العمليّتَينِ وينتظرُ خروجَهُ — حتى على فشلِ الاختبارِ. */
  async function killSurvivors(): Promise<void> {
    for (const handle of [gatewayA, gatewayB]) {
      if (handle === null) continue;
      try {
        handle.proc.kill("SIGKILL");
      } catch {
        // ماتتْ من قبلُ — لا شيءَ نقتُلُهُ.
      }
      await handle.proc.exited;
    }
    gatewayA = null;
    gatewayB = null;
  }

  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    redisHandle = createRealRedis();
    // مفاتيحُ جلسةٍ يكتبُها طفلُ البوّابةِ ببادئةِ الإنتاجِ — تُسجَّل لتُمحى في النهايةِ.
    redisHandle.trackForeignKey(RIDER_SESSION_KEY);
    redisHandle.trackForeignKey(WITNESS_SESSION_KEY);
    redisHandle.trackForeignKey(DRIVER_SESSION_KEY);
    city = await ensureActiveCity(sql);
    // تطهيرٌ شاملٌ قبلَ إقلاعِ الأُولى: لا وظيفةَ متروكةً يستنزفُها درينرُ الطفلِ.
    await sql`truncate table agent_outcomes, agent_decisions, audit_log, attendance_log, ratings,
                             support_tickets, unsubscribed_claims, unsubscribed_negotiations,
                             order_offers, orders, subscriptions, driver_capabilities,
                             driver_availability, drivers, riders, users,
                             telegram_update_jobs, telegram_update_receipts restart identity cascade`;
  }, 30_000);

  afterAll(async () => {
    // يُنفَّذُ ولو فشلَ الاختبارُ: لا عمليةَ تُتْرَكُ حيّةً على المنفذِ.
    await killSurvivors();
    if (redisHandle !== undefined) {
      const remaining = await redisHandle.cleanup();
      if (remaining !== 0) {
        throw new Error(`مفاتيحُ لم تُمحَ بعدَ التنظيفِ: ${remaining}`);
      }
    }
    // ردُّ الأساسِ قبلَ إغلاقِ الاتصالِ — بعدهُ يصيرُ استعلامُه على مجمِّعٍ مُغلَقٍ
    // فيُعَلِّقُ العمليةَ بعدَ نجاحِ الاختبارِ كأنَّه فشلٌ صامتٌ ( CONNECTION_ENDED ).
    if (city !== undefined && sql !== undefined) await restoreCityBaseline(sql, city);
    await sql?.end({ timeout: 5 }).catch(() => undefined);
  }, 60_000);

  it("قتلٌ حتميٌّ أثناءَ تعليقِ تحقيقٍ، والرحلةُ تكتملُ عبرَ البديلِ", async () => {
    if (sql === undefined) throw new Error("لا قاعدةَ — لم تُهيَّأِ الوظيفةُ");
    const db = sql;
    // ── ١) الأُولى ──
    startA();
    await waitReady("الأُولى");

    // ── ٢) تسجيلُ السائقِ عبرَ الأُولى (وصفةُ f5-06) ──
    await expectOk(post("driver", text(DRIVER_CHAT, "/start")));
    await expectOk(post("driver", text(DRIVER_CHAT, "فهد الصامد")));
    await expectOk(post("driver", contact(DRIVER_CHAT, "+966500450010")));
    await expectOk(post("driver", privateCallback(DRIVER_CHAT, `city:${city?.cityId ?? ""}`)));
    await expectOk(post("driver", privateCallback(DRIVER_CHAT, "service:transport")));
    await expectOk(post("driver", privateCallback(DRIVER_CHAT, "vehicle:sedan")));
    await expectOk(post("driver", text(DRIVER_CHAT, "أ ب ج 1234")));
    await expectOk(post("driver", text(DRIVER_CHAT, "1000001010")));
    await expectOk(post("driver", photo(DRIVER_CHAT, "vphoto_1000001010")));
    const driverId = await poll("تسجيلُ السائقِ", async () => {
      const rows = await db<{ id: string }[]>`
        select d.id from drivers d join users u on u.id = d.user_id
         where u.telegram_id = ${DRIVER_CHAT}
      `;
      return rows[0]?.id ?? null;
    });
    // `OPS-EGRESS-01`: الدرينرُ يستيقظُ بالإيداعِ فيعالجُ آخرَ خطوةٍ في التسجيلِ وهذا السطرُ
    // يكتبُ في `drivers` نفسِها؛ فكتابةُ الاختبارِ المباشرةُ تنتظرُ فراغَ الطابورِ لئلّا تتقاطعَ
    // أقفالُهما (deadlock). الانتظارُ على حالِ القاعدةِ لا على مهلةٍ ثابتة.
    await poll("فراغُ طابورِ التحديثات", async () => {
      const rows = await db<{ busy: number }[]>`
        select count(*)::int as busy from telegram_update_jobs where status in ('pending', 'claimed')
      `;
      return (rows[0]?.busy ?? 1) === 0 ? true : null;
    });
    await db`update drivers set verification_status = 'verified' where id = ${driverId}`;
    // اشتراكٌ سائقٍ — ليس زينةً: `city_served_services()` لا تُعرِفُ مدينةً خدمةً إلا
    // بسائقٍ موثّقٍ **مشترِكٍ** قادرٍ، والتوزيعُ يشترطُ اشتراكاً **سارياً** بفترةٍ لم
    // تنقضِ (بلا فترةٍ يُغبَطُ: `NO_LIVE_SUBSCRIPTION` فيبقى الطلبُ بلا بثٍّ). والحوارُ
    // لا يبدأُ تجربةً تلقائيّاً. على بذرةِ tests/support/seed-capable-driver.ts بيدَ أنّ
    // سائقَنا مسجّلٌ بالحوارِ نفسِهِ وفترتُهُ ساريةٌ كي يصحَّّ مطابقةُ العرضِ.
    await db`
      insert into subscriptions (city_id, driver_id, plan, status, current_period_end)
      values (
        ${city?.cityId ?? ""},
        ${driverId},
        'both'::subscription_plan,
        'active'::subscription_status,
        now() + interval '30 days'
      )
      on conflict (driver_id) where status in ('trialing', 'active')
        do update set status = 'active', current_period_end = now() + interval '30 days', updated_at = now()
    `;
    await expectOk(post("driver", text(DRIVER_CHAT, "/available")));
    await expectOk(post("driver", location(DRIVER_CHAT, DRIVER_AT)));
    await poll("سائقٌ متاحٌ", async () => {
      const rows = await db<{ is_available: boolean }[]>`
        select is_available from driver_availability where driver_id = ${driverId}
      `;
      return rows[0]?.is_available === true ? true : null;
    });

    // ── ٣) الراكبُ والرحلةُ (وصفةُ F11-03 المجَرَّبةُ: بلا أمرِ /ride — الإحداثيتُانِ تطلقانِ الطلبَ) ──
    await expectOk(post("rider", text(RIDER_CHAT, "/start")));
    await expectOk(post("rider", text(RIDER_CHAT, "راكبُ يستعبرُ")));
    await expectOk(post("rider", privateCallback(RIDER_CHAT, `city:${city?.cityId ?? ""}`)));
    await expectOk(post("rider", privateCallback(RIDER_CHAT, "svc:transport")));
    await expectOk(post("rider", location(RIDER_CHAT, PICKUP)));
    await expectOk(post("rider", location(RIDER_CHAT, DROPOFF)));
    const orderId = await poll("إنشاءُ الطلبِ", async () => {
      const rows = await db<{ id: string }[]>`
        select o.id from orders o
         join riders r on r.id = o.rider_id
         join users u on u.id = r.user_id
        where u.telegram_id = ${RIDER_CHAT}
        order by o.created_at desc limit 1
      `;
      return rows[0]?.id ?? null;
    });

    // ── ٤) القبولُ والبدءُ — الرحلةُ جاريةٌ ──
    await expectOk(post("driver", privateCallback(DRIVER_CHAT, `offer:accept:${orderId}`)));
    await poll("قبولُ العرضِ", async () => {
      const rows = await db<{ status: string }[]>`
        select status from order_offers where order_id = ${orderId} limit 1
      `;
      return rows[0]?.status === "accepted" ? true : null;
    });
    await expectOk(post("driver", privateCallback(DRIVER_CHAT, `ride:start:${orderId}`)));
    await poll("بدءُ الرحلةِ", async () => {
      const rows = await db<{ status: string }[]>`
        select status from orders where id = ${orderId}
      `;
      return rows[0]?.status === "in_progress" ? true : null;
    });

    // ── ٥) شاهدُ الجلسةِ: راكبٌ يُترَكُ في منتصفِ حوارِهِ — جلسةٌ جاريةٌ في Redis
    //      لا في ذاكرةِ البوّابةِ. (جلسةُ صاحبِ الرحلةِ تُمحى عندَ إنشاءِ الطلبِ
    //      عمداً وجلسةُ السائقِ عندَ إكمالِ تسجيلِهِ — انظرِ الحاشيةَ عندَ الثوابتِ.)
    await expectOk(post("rider", text(WITNESS_CHAT, "/start")));
    await expectOk(post("rider", text(WITNESS_CHAT, "شاهدُ الجلسةِ")));
    await expectOk(post("rider", privateCallback(WITNESS_CHAT, `city:${city?.cityId ?? ""}`)));
    await expectOk(post("rider", privateCallback(WITNESS_CHAT, "svc:transport")));
    const sessionBefore = await poll("جلسةُ الشاهدِ في Redis", async () => {
      const value = await redisGet(WITNESS_SESSION_KEY);
      return value === null ? null : value;
    });
    const witnessStepBefore = JSON.parse(sessionBefore).state?.step ?? null;
    expect(witnessStepBefore).not.toBe("idle");

    // ── ٦) القتلُ الحتميُّ: لا قتلَ إلا وقد رأينا تحقيقاً معلَّقاً ──
    let probeUpdateId = 0;
    let statusAtDeath: string | null = null;
    let killSignal = "";
    let killRounds = 0;
    for (let round = 0; round < 24; round += 1) {
      killRounds += 1;
      const tracked = await postTracked("rider", text(RIDER_CHAT, PROBE_TEXT));
      if (tracked.res.status !== 200) {
        throw new Error(`تحقيقُ القتلِ رُدَّ ${tracked.res.status}: ${await tracked.res.text()}`);
      }
      probeUpdateId = tracked.updateId;
      const firstSeen = await firstSeenStatus(probeUpdateId);
      if (firstSeen !== "pending") {
        // الدرينرُ سبقَنا إلى هذا التحقيقِ — الأُولى لا تزالُ حيّةً: تحقيقٌ آخرَ.
        continue;
      }
      const current = gatewayA;
      if (current === null) throw new Error("بوّابةٌ مفقودةٌ قبلَ القتلِ");
      current.proc.kill("SIGKILL");
      await current.proc.exited;
      killSignal = String((current.proc as unknown as { signalCode?: string }).signalCode ?? "");
      gatewayA = null;
      statusAtDeath = await jobStatus(probeUpdateId);
      if (statusAtDeath === "pending") break;
      // سبقَ الدرينرُ القتلَ في نافذةِ الموتِ (دورةُ ٥٠٠ms وقعتَ في الفاصلِ) —
      // أعدْ إقلاعَ الأُولى (الرحلةُ لم تتأثرْ) وحاوِلِ القتلَ ثانيةً.
      startA();
      await waitReady(`إقلاعُ الأُولى ثانيةً (جولةُ ${round})`);
    }
    if (statusAtDeath !== "pending") {
      throw new Error(
        `لم يُدرَكْ تحديثٌ معلَّقٌ لحظةَ الموتِ بعدَ ${killRounds} جولةً — عطلٌ في تصميمِ القياسِ لا خضرةٌ.`,
      );
    }
    const deadAt = Date.now();

    // ── ٧) الصدقُ في أثناءِ الموتِ: رفضٌ على السِلكِ لا 200 كاذبٌ ──
    let refusedAtNetworkLevel = false;
    let answeredOk = false;
    try {
      const res = await post("rider", text(RIDER_CHAT, "أيّها العالمُ؟"));
      answeredOk = res.status === 200;
      console.log(`── طلبُ وقتِ الموتِ: جوابٌ ${res.status}`);
    } catch (error) {
      refusedAtNetworkLevel = true;
      console.log(
        `── طلبُ وقتِ الموتِ: رفضٌ (${(error as Error).constructor.name}: ${(error as Error).message?.slice(0, 60)})`,
      );
    }
    expect(refusedAtNetworkLevel, "طلبُ وقتِ الموتِ لم يُرفَضْ على السِلكِ").toBe(true);
    expect(answeredOk, "عمليةٌ ميتةٌ أجابتْ 200").toBe(false);

    // ── ٨) البديلُ: الإقلاعُ على المنفذِ نفسِهِ ──
    gatewayB = spawnGateway("f11-01-b");
    await waitReady("البديلُ");
    const replacementReadyAt = Date.now();

    // ── ٩) التحقيقُ المودَعُ قبلَ الموتِ: البديلةُ تُفرِغُهُ مرّةً واحدةً ──
    const probeStatusAfter = await poll(
      "البديلةُ تُفرِغُ التحقيقَ المودَعَ قبلَ الموتِ",
      async () => {
        const status = await jobStatus(probeUpdateId);
        return status === "done" ? status : null;
      },
      60_000,
    );
    const probeJobRows = await db<{ count: string }[]>`
      select count(*)::text as count from telegram_update_jobs
       where bot = 'rider' and update_id = ${probeUpdateId}
    `;

    // ── ١٠) الجلسةُ بعدَ البديلِ: باقيةٌ لم تُبنَ من جديدٍ ──
    const sessionAfter = await redisGet(WITNESS_SESSION_KEY);
    const stepAfter = sessionAfter === null ? null : (JSON.parse(sessionAfter).state?.step ?? null);

    // ── ١١) الإكمالُ عبرَ البديلِ: أمرُ الإقفالِ يمرُّ بويبهوكِ البديلةِ ──
    await expectOk(post("driver", privateCallback(DRIVER_CHAT, `ride:complete:${orderId}`)));
    const finalStatus = await poll("إكمالُ الرحلةِ عبرَ البديلِ", async () => {
      const rows = await db<{ status: string }[]>`
        select status from orders where id = ${orderId}
      `;
      return rows[0]?.status === "completed" ? rows[0].status : null;
    });
    const driverAvailableAgain = await poll("عودةُ السائقِ متاحاً", async () => {
      const rows = await db<{ is_available: boolean }[]>`
        select is_available from driver_availability where driver_id = ${driverId}
      `;
      return rows[0]?.is_available === true ? true : null;
    });
    const orderRows = await db<{ count: string }[]>`
      select count(*)::text as count from orders o
       join riders r on r.id = o.rider_id
       join users u on u.id = r.user_id
      where u.telegram_id = ${RIDER_CHAT}
    `;

    // ── الحكمُ ──
    const verdict = judgeGatewayLoss({
      kill: { signal: killSignal, exited: true },
      downtime: { refusedAtNetworkLevel, answeredOk },
      replacement: { readyStatus: 200 },
      durableUpdate: {
        statusAtDeath,
        statusAfterReplacement: probeStatusAfter,
        jobRows: Number(probeJobRows[0]?.count ?? 0),
      },
      session: {
        existedBeforeDeath: sessionBefore !== null,
        existsAfterReplacement: sessionAfter !== null,
        resetToInitialState: stepAfter === "idle",
      },
      ride: {
        orderRows: Number(orderRows[0]?.count ?? 0),
        finalStatus,
        driverAvailableAgain,
      },
    });
    console.log(
      `── F11-01 · القتلُ بعدَ ${killRounds} جولةٍ · إشارةُ ${killSignal} · تعطُّلُ ${replacementReadyAt - deadAt}ms · قواعدٌ ${verdict.rules.length}`,
    );
    expect(verdict.violations, `مخالفاتُ الحَكَمِ: ${verdict.violations.join(" · ")}`).toEqual([]);
    expect(verdict.verdict).toBe("ok");
    expect(killSignal, "الموتُ لم يكنْ SIGKILL — الفقدانُ غيرُ مُثبَتٍ").toBe("SIGKILL");
  }, 300_000);
});
