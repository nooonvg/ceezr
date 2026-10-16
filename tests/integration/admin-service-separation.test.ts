/**
 * الغرض: برهانُ فصلِ سطحِ لوحةِ الإدارةِ عن البوّابةِ **بعمليّاتٍ حقيقيّةٍ على
 *   قاعدةٍ حقيقيّةٍ** — `F5-08` / `ARCH-011` · ADR 0064. والمقيسُ استجاباتُ HTTP من
 *   عمليّاتٍ مُقلَعةٍ فعلاً، لا وجودُ دالّةٍ ولا سطرُ سجلٍّ.
 * الحالة: اختبار تكامل فعلي بعمليّاتٍ فرعيّةٍ — يتطلب TEST_DATABASE_URL.
 * ينتمي إلى: tests/integration
 * يُستخدم في: وظيفةُ «تكامل على PostgreSQL حقيقي» في CI.
 * ملاحظات مستقبلية: يومَ يُرفَع عددُ نسخِ البوّابةِ فوقَ واحدةٍ (`F5-06` / `SCL-008`)
 *   يُضاف ههنا أنّ خدمةَ اللوحةِ تبقى واحدةً — ولا يُغيَّر شاهدُ الاستجابةِ.
 *
 * ## لمَ لا يكفي اختبارُ وحدةٍ ههنا
 *
 * لأنّ الادّعاءَ المُراد إثباتُه **ادّعاءُ عمليّةٍ لا ادّعاءُ دالّةٍ**: أنّ عمليةً
 * مُقلَعةً بـ`RUN_ADMIN_IN_GATEWAY=false` لا تُخدّم `/admin`، وأنّ عمليةً أخرى
 * تُخدّمه من صورةٍ أخرى وقاعدةٍ واحدةٍ. واختبارُ وحدةٍ يستوردُ `mountAdminSurface`
 * يُثبِت أنّ الدالّةَ تُركِّب، ولا يُثبِت أنّ نقطةَ الدخولِ تُناديها بالشرطِ
 * الصحيحِ، ولا أنّ الصورةَ تحوي ما يلزمُها — وكلا هذَين موضعُ العطلِ الفعليِّ.
 *
 * ## ولمَ ثلاثُ حالاتٍ
 *
 * | الحالُ | المُتوقَّع | ما تُثبِته |
 * | --- | --- | --- |
 * | بوّابةٌ + `true` | `/admin/login` = 200 | أنّ طريقةَ الرصدِ تكشف سطحاً مُركَّباً فعلاً |
 * | بوّابةٌ + `false` | `/admin/login` = 404 مع بقاءِ `/health` | أنّ الإطفاءَ إطفاءٌ لا شكلٌ، ولم يُسقِط البوّابةَ |
 * | خدمةُ لوحةٍ مستقلّةٌ | `/admin/login` = 200 على نفسِ القاعدةِ | أنّ الفصلَ نقلَ السطحَ ولم يُلغِهِ |
 *
 * والحالةُ الوسطى وحدَها ليست برهاناً: توكيدُ «404» ينجح على عمليّةٍ لم تُقلع
 * أصلاً، وعلى منفذٍ خطأٍ، وعلى تطبيقٍ فارغٍ. فالضابطُ الموجبُ الأوّلُ يُثبِت أنّ
 * الرصدَ يرى السطحَ حين يكون، والثالثُ يُثبِت أنّه لم يُفقَد بالفصلِ.
 *
 * ولمَ `/admin/login` لا `/admin`: الجذرُ يُحوِّل غيرَ المُصرَّحِ فيصير الحكمُ على
 * سلسلةِ تحويلاتٍ، و`/admin/login` صفحةٌ تُعاد بـ200 بلا جلسةٍ — فالفرقُ بين 200
 * و404 ههنا **حضورُ الموجّهِ وغيابُه** لا حالُ التصريحِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createSql, type Sql } from "../../packages/infrastructure/db/client.ts";
import { reserveFreePort } from "../support/free-port.ts";

const DATABASE_URL = process.env.TEST_DATABASE_URL;

/** مهلةُ انتظارِ إقلاعِ العمليّةِ وقبولِها الاتّصالَ. */
const BOOT_TIMEOUT_MS = 30_000;

/** فاصلُ استقصاءِ المنفذِ — لا `sleep` واحدةٌ طويلةٌ تُخفي لحظةَ الجهوزيّةِ. */
const POLL_MS = 250;

/** مهلةُ الحالةِ: إقلاعٌ فطلباتٌ فإغلاقٌ فهامشٌ. */
const CASE_TIMEOUT_MS = 90_000;

/**
 * **تصحيحٌ مقيسٌ لا تجميليٌّ (`ح-8`).** كانَ المنفذُ يُحسَبُ `39_000 + (pid % 1_000)
 * * 10 + 1` بحجّةِ أنَّ المشتقَّ من PID فريدٌ حتماً. والحُجّةُ باطلةٌ: هوَ فريدٌ
 * **بين حالاتِ هذا الملفِّ** ولا يمنعُ شاغلاً آخرَ على عاملِ CI — وهوَ ما وقعَ
 * بحرفِه في الشغلةِ `34736418060` (الوظيفةُ `تكامل على PostgreSQL حقيقي` ·
 * الخطوةُ 11): ماتَتِ البوّابةُ على المنفذِ 46602 بـ`Failed to start server. Is
 * port 46602 in use?` فبقيَ المُختبَرُ يستقصي `/health` ثلاثينَ ثانيةً ثمَّ سقطَ
 * بمهلةٍ — **والمهلةُ عَرَضٌ والسببُ منفذٌ مشغولٌ**، وشِفرةُ الإنتاجِ سليمةٌ.
 * فصارَ المنفذُ يُسألُ منَ النظامِ لكلِّ إقلاعٍ، وتُعادُ المحاولةُ عندَ
 * `EADDRINUSE` وحدَه. ولا مهلةَ رُفِعَت ولا توكيدَ خُفِّف ولا حالةَ صُنِّفَت
 * تخطّياً (`ADR 0100`).
 */
const BOOT_ATTEMPTS = 4;

/** قيمٌ صناعيّةٌ شكلاً لا تُصيب خدمةً حقيقيّةً — تُجيز العبورَ فوقَ حارسِ الإقلاعِ. */
const CHILD_ENV: Record<string, string> = {
  // `test` لا `production`: المقيسُ ههنا **موضعُ السطحِ** لا شروطُ الإنتاجِ.
  // وإلزامُ الإعلانِ في الإنتاجِ مُثبَتٌ في `tests/unit/config-admin-placement.test.ts`.
  NODE_ENV: "test",
  SESSION_STORE: "memory",
  PROCESS_TOPOLOGY: "single-process",
  // المهامُّ الدوريّةُ مُطفأةٌ في **كلِّ** حالةٍ: هذا الملفُّ لا يقيسها، وتشغيلُها
  // يُدخِل نبضاتٍ وأقفالاً موزَّعةً في قاعدةِ الاختبارِ فتتشوّش حالاتُ ملفٍّ آخرَ.
  RUN_WORKER_IN_GATEWAY: "false",
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
  METRICS_EXPORT_ENDPOINT: "",
};

interface Child {
  readonly port: number;
  /** ما كُتِب على المجريَين حتّى اللحظةِ — يُقرأ في رسالةِ الإخفاقِ لا في الحكمِ. */
  readonly output: () => string;
  readonly stop: () => Promise<void>;
}

/**
 * يقرأ المجرى إلى آخرِه في الخلفيّةِ. **والقراءةُ إلى الآخرِ شرطٌ لا ترفٌ**: أنبوبٌ
 * ممتلئٌ يُوقِف العمليّةَ الفرعيّةَ عند الكتابةِ فتصير الاستجابةُ متعذّرةً، ويُقرأ
 * الإخفاقُ «لم تُقلع» بينما السببُ أنبوبٌ لم يُقرأ.
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
      // انقطاعُ المجرى عند القتلِ ليس عطلاً — الحكمُ من الاستجابةِ لا من المجرى.
    }
  })();
}

async function spawnService(entry: string, extraEnv: Record<string, string>): Promise<Child> {
  let lastError = "";
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
    const outcome = await spawnOnce(entry, extraEnv);
    if (outcome.child !== undefined) return outcome.child;
    lastError = outcome.detail;
    // تعارضُ منفذٍ وحدَه يُعادُ. وأيُّ إخفاقِ إقلاعٍ آخرَ عطلٌ حقيقيٌّ يُرفَعُ فوراً.
    if (!/EADDRINUSE|port \d+ in use/i.test(lastError)) break;
  }
  throw new Error(`لم تُقلع «${entry}» في ${BOOT_ATTEMPTS} محاولاتٍ:\n${lastError}`);
}

interface SpawnOutcome {
  readonly child?: Child;
  readonly detail: string;
}

async function spawnOnce(entry: string, extraEnv: Record<string, string>): Promise<SpawnOutcome> {
  const port = reserveFreePort();
  const lines: string[] = [];
  const child = Bun.spawn(["bun", entry], {
    env: {
      PATH: process.env.PATH ?? "",
      ...CHILD_ENV,
      DATABASE_URL: DATABASE_URL ?? "",
      TEST_DATABASE_URL: DATABASE_URL ?? "",
      PORT: String(port),
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  drain(child.stdout, lines);
  drain(child.stderr, lines);

  const stop = async (): Promise<void> => {
    child.kill("SIGTERM");
    const raced = await Promise.race([
      child.exited,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 8_000)),
    ]);
    if (raced === "timeout") child.kill("SIGKILL");
  };

  /*
   * الجهوزيّةُ تُنتظَر على `/health` لا على `/admin`: `/health` قائمٌ في العمليّتَين
   * وفي **كلتا** قيمتَي موضعِ اللوحةِ، فينفصل «هل أقلعت» عن «هل تُخدّم اللوحةَ» —
   * وهو عينُ ما يُقاس. ولو انتُظِرت الجهوزيّةُ على `/admin` لصارت الحالةُ السالبةُ
   * تنتظر ما لا يجيء أبداً فتُخفِق بمهلةٍ لا بحكمٍ.
   */
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/health`);
      if (probe.ok) break;
    } catch {
      // لم يُقبَل الاتّصالُ بعدُ.
    }
    /*
     * موتُ الوليدِ يُقرأُ **قبلَ** انقضاءِ المهلةِ: لو ماتَ لسببٍ مهما كانَ فلا
     * معنىً لاستقصاءِ منفذٍ لا أحدَ عليه ثلاثينَ ثانيةً، ولا لأن يُقرأَ السببُ
     * «مهلةً». وبهذا يظهرُ `EADDRINUSE` في أقلَّ من ثانيةٍ فتُعادُ المحاولةُ.
     */
    if (child.exitCode !== null) {
      const detail = `مات الوليدُ «${entry}» بالرمزِ ${child.exitCode} على المنفذِ ${port}:\n${lines.join("")}`;
      return { detail };
    }
    if (Date.now() >= deadline) {
      await stop();
      return {
        detail: `لم تُقلع «${entry}» على المنفذِ ${port} في المهلةِ:\n${lines.join("")}`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  return { child: { port, output: () => lines.join(""), stop }, detail: "" };
}

const describeIf = DATABASE_URL === undefined ? describe.skip : describe;
if (DATABASE_URL === undefined) {
  console.warn(
    "⚠️  برهانُ فصلِ لوحةِ الإدارة مُتخطّى: عيّن TEST_DATABASE_URL لقاعدة PostgreSQL بها الهجرات مطبَّقة.",
  );
}

let sql: Sql;

describeIf("فصلُ لوحةِ الإدارةِ عن البوّابةِ على قاعدةٍ حقيقيّةٍ — F5-08 / ARCH-011", () => {
  beforeAll(async () => {
    sql = createSql({ connectionString: DATABASE_URL ?? "" });
    // القاعدةُ تُلمَس مرّةً: الهجراتُ غيرُ المطبَّقةِ تُخفِق ههنا برسالةٍ صريحةٍ لا
    // بـ«500 على /admin/login» يُقرأ خطأً في التركيبِ.
    const rows = await sql<{ count: string }[]>`select count(*)::text as count from admin_sessions`;
    expect(Number.parseInt(rows[0]?.count ?? "-1", 10)).toBeGreaterThanOrEqual(0);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  /**
   * ## الضابطُ الموجبُ — أنّ الرصدَ يرى السطحَ حين يكون
   */
  it(
    "بوّابةٌ + RUN_ADMIN_IN_GATEWAY=true ⇒ /admin/login مُخدَّمٌ (200)",
    async () => {
      const gateway = await spawnService("apps/gateway/src/index.ts", {
        RUN_ADMIN_IN_GATEWAY: "true",
      });
      try {
        const response = await fetch(`http://127.0.0.1:${gateway.port}/admin/login`);
        expect(response.status).toBe(200);
      } finally {
        await gateway.stop();
      }
    },
    CASE_TIMEOUT_MS,
  );

  /**
   * ## الحالُ المقصودةُ — أنّ الإطفاءَ إطفاءٌ، وأنّه لم يُسقِط البوّابةَ
   *
   * ويُفحَص `/health` **في نفسِ العمليّةِ** لا في أخرى: لو أُخِذ 404 وحدَه لجازَ أن
   * تكون العمليّةُ ميّتةً أو التطبيقُ فارغاً، فيُقرأ العطلُ نجاحاً. فالحكمُ
   * مزدوجٌ: السطحُ غائبٌ **والبوّابةُ حيّةٌ**.
   */
  it(
    "بوّابةٌ + RUN_ADMIN_IN_GATEWAY=false ⇒ /admin/login غائبٌ (404) والبوّابةُ حيّةٌ",
    async () => {
      const gateway = await spawnService("apps/gateway/src/index.ts", {
        RUN_ADMIN_IN_GATEWAY: "false",
      });
      try {
        const admin = await fetch(`http://127.0.0.1:${gateway.port}/admin/login`);
        expect(admin.status).toBe(404);

        // ولا `/admin/api` ولا مجرى `/admin/api/live`: البادئاتُ الثلاثُ تذهب معاً.
        expect((await fetch(`http://127.0.0.1:${gateway.port}/admin/api/orders`)).status).toBe(404);
        expect((await fetch(`http://127.0.0.1:${gateway.port}/admin/api/live/orders`)).status).toBe(
          404,
        );

        // والبوّابةُ حيّةٌ: الحياةُ والجهوزيّةُ كلتاهما تُجيبان.
        expect((await fetch(`http://127.0.0.1:${gateway.port}/health`)).ok).toBe(true);
        const ready = await fetch(`http://127.0.0.1:${gateway.port}/ready`);
        // ‏`/ready` قد يرتدَّ 503 على قاعدةِ اختبارٍ بلا Redis حقيقيٍّ — والمقصودُ
        // أنّه **يُجيب** لا أنّه أخضرُ: عمليّةٌ ميّتةٌ لا تُجيب بشيءٍ أصلاً.
        expect([200, 503]).toContain(ready.status);
      } finally {
        await gateway.stop();
      }
    },
    CASE_TIMEOUT_MS,
  );

  /**
   * ## الحالُ الثالثةُ — أنّ الفصلَ نقلَ السطحَ ولم يُلغِهِ
   *
   * وهذه العمليّةُ هي **الخدمةُ الجديدةُ** بنقطةِ دخولِها وحاويتِها الضيّقةِ، تقرأُ
   * نفسَ القاعدةِ. وهي ما يُثبِت أنّ ما ذهبَ من البوّابةِ لم يذهب من النظامِ.
   */
  it(
    "خدمةُ اللوحةِ المستقلّةُ ⇒ /admin/login مُخدَّمٌ (200) على نفسِ القاعدةِ",
    async () => {
      const admin = await spawnService("apps/admin/src/index.ts", {
        RUN_ADMIN_IN_GATEWAY: "false",
      });
      try {
        const login = await fetch(`http://127.0.0.1:${admin.port}/admin/login`);
        expect(login.status).toBe(200);
        // صفحةٌ لا رسالةَ خطأٍ: نصُّ الصفحةِ يُقرأ كي لا يُقبَل 200 من معالجٍ عامٍّ.
        expect(await login.text()).toContain("<form");

        // وفحصُ الحياةِ يُسمّي الخدمةَ: عمليّتانِ على منفذَين تُقرأ سجلّاتُهما معاً.
        const health = await fetch(`http://127.0.0.1:${admin.port}/health`);
        expect(health.ok).toBe(true);
        expect(((await health.json()) as { service?: string }).service).toBe("waslah-admin");
      } finally {
        await admin.stop();
      }
    },
    CASE_TIMEOUT_MS,
  );

  /**
   * ## وما لم يُثبَت ههنا — يُقال صريحاً
   *
   * 1. **العزلُ نفسُه غيرُ مقيسٍ**: أنّ استعلاماتِ اللوحةِ لم تبقَ تسحب من بِركةِ
   *    اتّصالاتِ البوّابةِ **مُستنتَجٌ** من أنّها في عمليّةٍ أخرى ببِركةٍ أخرى، لا
   *    مَقيسٌ بحملٍ. وقياسُه يحتاج بيئةَ نشرٍ حقيقيّةً بحملٍ متزامنٍ — وهو ما يجعل
   *    درجةَ `F5-08` **مُختبَراً** لا **مَقيساً** في سلّمِ `docs/ROADMAP-MASTER.md`.
   * 2. **الدلتا اللحظيّةُ عبرَ العمليّاتِ غيرُ مُثبَتةٍ ههنا**: هذه الحالاتُ تُقلعُ
   *    بـ`SESSION_STORE=memory` فلا مجرى Redis فيها. وعبورُ الأحداثِ مُثبَتٌ في
   *    `tests/integration/redis-stream-event-bus.test.ts` (`SCL-004` · ADR 0058) على
   *    Redis حقيقيٍّ، وإعادةُ إثباتِه ههنا تُنشئ موضعَي حقيقةٍ يتباعدان.
   * 3. **الصورةُ غيرُ مبنيّةٍ**: اكتمالُ نطاقِ `COPY` في `docker/Dockerfile.admin`
   *    محروسٌ بحلِّ الاستيراداتِ في `scripts/verify-container-build.sh` لا بـ
   *    `docker build` — والبيئةُ بلا عفريتِ Docker (القيدُ موثَّقٌ هناك).
   */
});
