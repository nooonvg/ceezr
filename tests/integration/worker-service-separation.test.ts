/**
 * الغرض: برهانُ فصلِ العاملِ عن البوابةِ بعمليّاتٍ حقيقيّةٍ على قاعدةٍ حقيقيّةٍ —
 *   `F5-04` / `SCL-007` · ADR 0063. والمقيسُ **أثرٌ في القاعدة** لا سطرُ سجلٍّ:
 *   صفوفُ `job_heartbeats` هي الشاهدُ الوحيدُ على أنّ مهمّةً دوريّةً عملت فعلاً،
 *   وهي نفسُها الشاهدُ الذي يقرؤه `/ready` في الإنتاج (§4.3).
 * الحالة: اختبار تكامل فعلي بعمليّاتٍ فرعيّةٍ — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُستخدم في: وظيفةُ «تكامل على PostgreSQL حقيقي» في CI.
 * ملاحظات مستقبلية: يومَ يُصبح للعاملِ خادمُ HTTP خاصٌّ به (F5-08 / ARCH-011) يُضاف
 *   ههنا فحصُ جهوزيّتِه المستقلّةِ؛ ولا يُغيَّر شاهدُ القاعدةِ لأنّه المرجعُ المشترَك.
 *
 * ## لمَ ثلاثُ حالاتٍ لا حالةٌ واحدةٌ
 *
 * الحالةُ التي تُهمُّ المرحلةَ هي الوسطى: بوّابةٌ بـ`RUN_WORKER_IN_GATEWAY=false`
 * **لا تُشغِّل مهمّةً واحدةً**. لكنّ توكيدَ «لم يظهر صفٌّ» ينجح كذلك على قاعدةٍ
 * لا تكتب فيها المهامُّ أصلاً، وعلى مدينةٍ غيرِ مفعَّلةٍ، وعلى مهاجرةٍ لم تُطبَّق —
 * أي **ينجح على نظامٍ ميّتٍ تماماً**. فالشاهدُ السالبُ بلا ضابطٍ موجبٍ ليس برهاناً.
 *
 * | الحالُ | المُتوقَّع | ما تُثبِته |
 * | --- | --- | --- |
 * | بوّابةٌ + `true` | صفوفُ نبضٍ تظهر | أنّ طريقةَ الرصدِ تكشف عملَ المهامِّ فعلاً |
 * | بوّابةٌ + `false` | لا صفَّ نبضٍ | أنّ الإطفاءَ إطفاءٌ لا شكلٌ |
 * | عاملٌ مستقلٌّ | صفوفُ نبضٍ تظهر | أنّ الفصلَ لم يُسقِط المهامَّ بل نقلَها |
 *
 * وتشغيلُ الموضعَين معاً لا يُعاد إثباتُه ههنا: القفلُ الموزَّعُ مُثبَتٌ في
 * `tests/integration/distributed-lock.test.ts` على القاعدةِ نفسِها، وإعادةُ
 * البرهانِ في موضعَين تُنشئ موضعَي حقيقةٍ يتباعدان.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import {
  type ActiveCityHandle,
  ensureActiveCity,
  restoreCityBaseline,
} from "../support/active-city.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * نافذةُ الرصدِ. المشغّلُ ينبض **فوراً** عند `start()` قبلَ أوّلِ فاصلٍ
 * (`apps/workers/src/runner.ts`)، فما يُنتظَر هو إقلاعُ العمليّةِ وبناءُ الحاويةِ
 * وأوّلُ شوطٍ لا فاصلُ الجدولةِ. وسخاءُ النافذةِ **لا يُرخي التوكيدَ**: الحالةُ
 * السالبةُ تنتظر النافذةَ كلَّها قبلَ أن تحكم، والموجبةُ تخرج عند أوّلِ صفٍّ.
 */
const OBSERVE_MS = 25_000;

/** فاصلُ الاستقصاءِ في القاعدةِ — لا `sleep` واحدةٌ طويلةٌ تُخفي اللحظةَ. */
const POLL_MS = 500;

/** مهلةُ الحالةِ: إقلاعٌ فنافذةُ رصدٍ فإغلاقٌ رشيقٌ فهامشٌ. */
const CASE_TIMEOUT_MS = 90_000;

/**
 * منفذٌ فريدٌ حتماً لا عشوائيّاً: العشوائيُّ يجوز أن يصطدم بمنفذٍ مشغولٍ على عاملِ
 * CI فيُخفِق الإقلاعُ بلا ذنبٍ للمُختبَرِ.
 */
let nextPort = 39_411;

/** قيمٌ صناعيّةٌ شكلاً لا تُصيب خدمةً حقيقيّةً — تُجيز العبورَ فوقَ حارسِ الإقلاعِ. */
const CHILD_ENV: Record<string, string> = {
  // `test` لا `production`: المقيسُ ههنا **موضعُ المهامِّ** لا شروطُ الإنتاجِ.
  // وإلزامُ الإعلانِ في الإنتاجِ مُثبَتٌ في `tests/unit/config-worker-placement.test.ts`،
  // وبيئةٌ إنتاجيّةٌ ههنا كانت ستُلزِم Redis حقيقيّاً فتقيس شيئَين معاً.
  NODE_ENV: "test",
  SESSION_STORE: "memory",
  PROCESS_TOPOLOGY: "single-process",
  SUPABASE_URL: "https://fake-project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key-AAAAAAAAAAAAAAAAAAAA",
  UPSTASH_REDIS_REST_URL: "https://fake-redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "fake-upstash-token-BBBBBBBBBBBBBBBBBBBB",
  DRIVER_BOT_TOKEN: "1111111:fake-driver-bot-token-CCCCCCCCCCCC",
  RIDER_BOT_TOKEN: "2222222:fake-rider-bot-token-DDDDDDDDDDDD",
  TELEGRAM_WEBHOOK_SECRET: "fake-webhook-secret-EEEEEEEEEEEEEEEE",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "999999999",
  // `ADR 0213/0286`: الوضعُ الافتراضيُّ miniapp يُوجبُ MINIAPP_URL للإقلاعِ —
  // يُعطى عنوانُ اختبارٍ https صالحٌ لا تعطيلُ حارسِ الإقلاعِ.
  BOT_SURFACE_MODE: "miniapp",
  MINIAPP_URL: "https://miniapp.test",
  // لا مُجمِّعَ مقاييسٍ: عمليّةٌ تدفع إلى الشبكةِ من وراءِ ظهرِ كاتبِها تُخفق يومَ
  // تنقطع الشبكةُ لا يومَ ينكسر الكودُ (F5-07).
  METRICS_EXPORT_ENDPOINT: "",
};

interface Child {
  readonly process: ReturnType<typeof Bun.spawn>;
  /** ما كُتِب على المجريَين حتّى اللحظةِ — يُقرأ في رسالةِ الإخفاقِ لا في الحكمِ. */
  readonly output: () => string;
  readonly stop: () => Promise<void>;
}

/**
 * يقرأ المجرى إلى آخرِه في الخلفيّةِ. **والقراءةُ إلى الآخرِ شرطٌ لا ترفٌ**: أنبوبٌ
 * ممتلئٌ يُوقِف العمليّةَ الفرعيّةَ عند الكتابةِ قبلَ أن تُشغِّل مهمّةً، فيصير
 * الإخفاقُ «لم تعمل المهامُّ» بينما السببُ أنبوبٌ لم يُقرأ.
 */
function drain(stream: ReadableStream<Uint8Array>, into: string[]): void {
  void (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value !== undefined) into.push(decoder.decode(chunk.value, { stream: true }));
      }
    } catch {
      // انقطاعُ المجرى عند القتلِ ليس عطلاً — الحكمُ من القاعدةِ لا من المجرى.
    }
  })();
}

function spawnChild(entry: string, extraEnv: Record<string, string>): Child {
  const lines: string[] = [];
  const child = Bun.spawn(["bun", entry], {
    env: {
      PATH: process.env.PATH ?? "",
      ...CHILD_ENV,
      DATABASE_URL: DATABASE_URL ?? "",
      TEST_DATABASE_URL: DATABASE_URL ?? "",
      PORT: String(nextPort++),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(child.stdout, lines);
  drain(child.stderr, lines);
  return {
    process: child,
    output: () => lines.join(""),
    stop: async () => {
      child.kill("SIGTERM");
      // مهلةٌ ثمّ قتلٌ قاسٍ: عمليّةٌ عالقةٌ تُعلِّق ملفَّ الاختبارِ كلَّه، وتنظيفُ
      // العمليّاتِ ليس هو المُختبَرَ (التصريفُ الرشيقُ مُثبَتٌ في F5-05).
      const raced = await Promise.race([
        child.exited,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 8_000)),
      ]);
      if (raced === "timeout") child.kill("SIGKILL");
    },
  };
}

let sql: Sql;
let cityHandle: ActiveCityHandle | undefined;

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  برهانُ فصلِ العامل مُتخطّى: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

/** عددُ صفوفِ النبضِ الآن — الشاهدُ الوحيدُ على أنّ مهمّةً دوريّةً عملت. */
async function heartbeatCount(): Promise<number> {
  const rows = await sql<{ count: string }[]>`select count(*)::text as count from job_heartbeats`;
  return Number.parseInt(rows[0]?.count ?? "0", 10);
}

/** ينتظر ظهورَ صفِّ نبضٍ واحدٍ على الأقلّ، ويُعيد `false` إن انقضت النافذةُ. */
async function waitForHeartbeat(): Promise<boolean> {
  const deadline = Date.now() + OBSERVE_MS;
  for (;;) {
    if ((await heartbeatCount()) > 0) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** يستنفد النافذةَ كلَّها ثمّ يُعيد ما إن ظهر صفٌّ في أثنائها. */
async function anyHeartbeatWithinWindow(): Promise<boolean> {
  const deadline = Date.now() + OBSERVE_MS;
  while (Date.now() < deadline) {
    if ((await heartbeatCount()) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

describeIf("فصلُ العامل عن البوابة على قاعدةٍ حقيقيّةٍ — F5-04 / SCL-007", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
  });

  afterAll(async () => {
    await restoreCityBaseline(sql, cityHandle);
    // تنظيفٌ نهائي (CI-01 — خارطة استكمال CAP-RUN-20261016، المرحلة 9):
    // لا شيء كان يمسح job_heartbeats بعد آخر اختبار فيبقى أثرٌ للملفات المتوازية.
    await sql`truncate table job_heartbeats`;
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    // المدينةُ مفعَّلةٌ شرطُ تمهيدٍ لا توكيدٌ: `container.jobs()` لا تُنتج مهمّةً
    // واحدةً بلا مدينةٍ مفعَّلةٍ، فتنجح الحالةُ السالبةُ على نظامٍ لا مهامَّ فيه أصلاً.
    cityHandle = await ensureActiveCity(sql, { prior: cityHandle });
    await sql`truncate table job_heartbeats`;
    expect(await heartbeatCount()).toBe(0);
  });

  /**
   * الضابطُ الموجبُ. لولاه لصارت الحالةُ التاليةُ توكيداً بلا معنى: «لم يظهر صفٌّ»
   * تصدق على قاعدةٍ لا تكتب فيها المهامُّ أصلاً.
   */
  it(
    "بوّابةٌ بـRUN_WORKER_IN_GATEWAY=true ⇒ صفوفُ نبضٍ تظهر — الرصدُ يكشف عملَ المهامِّ",
    async () => {
      const gateway = spawnChild("apps/gateway/src/index.ts", {
        RUN_WORKER_IN_GATEWAY: "true",
      });
      try {
        const beat = await waitForHeartbeat();
        expect(beat, `لم تظهر نبضةٌ والعاملُ المضمَّنُ مُفعَّلٌ.\n${gateway.output()}`).toBe(true);
      } finally {
        await gateway.stop();
      }
    },
    CASE_TIMEOUT_MS,
  );

  /**
   * جوهرُ المرحلةِ: الإطفاءُ إطفاءٌ فعليٌّ. وهذا هو الحالُ الذي كان يقع في الإنتاجِ
   * بلا خدمةِ عاملٍ فيُوقِف النظامَ كلَّه بصمتٍ
   * (`docs/directive-item-0-live-diagnosis.md` §0.2) — ولذلك لا يُقبَل اليومَ في
   * `render.yaml` إلا مع خدمةِ عاملٍ مُعلَنةٍ (`JOBS_ORPHANED`).
   */
  it(
    "بوّابةٌ بـRUN_WORKER_IN_GATEWAY=false ⇒ لا صفَّ نبضٍ في النافذةِ كلِّها",
    async () => {
      const gateway = spawnChild("apps/gateway/src/index.ts", {
        RUN_WORKER_IN_GATEWAY: "false",
      });
      try {
        const beat = await anyHeartbeatWithinWindow();
        expect(beat, `ظهرت نبضةٌ والعاملُ المضمَّنُ مُطفأٌ.\n${gateway.output()}`).toBe(false);
        // ولا يكفي غيابُ الأثرِ: بوّابةٌ لم تُقلع أصلاً لا تكتب نبضةً كذلك. فيُوجَب
        // سطرُ الفرعِ المُطفأِ نفسِه شاهداً على أنّها بلغت الموضعَ واختارت الإطفاءَ.
        // **تصحيحٌ (2026-09-11 · حكمُ CI الأوّلُ):** كانَ المُوجَبُ ههنا نصّاً عربيّاً
        // حرّاً («العامل المدمج غير مُفعَّل») وقد استُبدِلَ بسجلٍّ مُهيكلٍ في `F8-03`
        // (ADR 0078) فصارَ الفرعُ يطبعُ رمزَ حدثٍ لاتينيّاً منقوطاً. فبقيَ المُوجَبُ
        // يطلبُ جملةً لا تُطبَعُ — وهوَ إخفاقٌ في المُوجَبِ لا في السلوكِ. والرمزُ
        // `embedded_worker.disabled` هوَ المُوجَبُ الأصدقُ: حاجزُ `check-structured-logging`
        // يفرضُ ثباتَه حرفاً لاتينيّاً منقوطاً، فلا يتقادمُ بترجمةٍ ولا بصياغةٍ.
        //
        // OPS-012: كانَ الشاهدُ نصّاً حرّاً («العامل المدمج غير مُفعَّل») وقد أزالَه
        // F8-03 حينَ صارَ السجلُّ رمزَ حدثٍ لا نصّاً؛ فبقيَ الشرطُ يُطابِقُ تعليقاً في
        // الشيفرةِ لا سطرَ سجلٍّ، فكانَ يمرُّ حينَ تسقطُ البوّابةُ (فتطبعُ بُنٌ مقتطفَ
        // الشيفرةِ بتعليقِه) ويسقطُ حينَ تُقلعُ سليمةً — أي شاهدٌ مقلوبٌ. والشاهدُ
        // الصحيحُ هوَ رمزُ الحدثِ المُنفَذُ نفسُه.
        expect(gateway.output()).toContain("embedded_worker.disabled");
      } finally {
        await gateway.stop();
      }
    },
    CASE_TIMEOUT_MS,
  );

  /**
   * الشاهدُ على أنّ الفصلَ نقلٌ لا إسقاطٌ: العمليّةُ المستقلّةُ — وهي التي تُقلعها
   * خدمةُ `waslah-worker` بـ`docker/Dockerfile.worker` — تكتب النبضةَ نفسَها في
   * القاعدةِ نفسِها، فيقرؤها `/ready` في البوّابةِ بلا أن تعرف عنها شيئاً.
   */
  it(
    "عمليّةُ عاملٍ مستقلّةٌ ⇒ صفوفُ نبضٍ تظهر — الفصلُ نقلٌ لا إسقاطٌ",
    async () => {
      const worker = spawnChild("apps/workers/src/index.ts", {});
      try {
        const beat = await waitForHeartbeat();
        expect(beat, `لم تظهر نبضةٌ والعاملُ المستقلُّ يعمل.\n${worker.output()}`).toBe(true);
        expect(worker.output()).toContain("worker.started");
      } finally {
        await worker.stop();
      }
    },
    CASE_TIMEOUT_MS,
  );
});
