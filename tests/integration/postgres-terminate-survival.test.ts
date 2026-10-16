/**
 * الغرض: اختبارُ تكاملٍ لعيبِ **D7** (انهيارُ العمليةِ بخطأٍ غير ملتقطٍ في
 *   `postgres@3.4.9` تحتَ قتلِ الخلفياتِ): البوابةُ عمليةً ابنةً تُقتَلُ خلفياتُ
 *   قاعدتِها خمسَ جولاتٍ بينما استعلاماتُها جاريةٌ، فيُثبتُ الاختبارُ أنَّ العمليةَ
 *   نفسَها تعيشُ (الرمزُ `exitCode` يبقى `null`) وتستعيدُ جاهزيتَها في مهلةٍ محدودةٍ —
 *   لا انهيارَ ولا خروجًا بشفرةٍ غيرِ صفريةٍ كما وقعَ في جولةِ `CAP-RUN-20261015`
 *   (02:49:18 · انقطاعٌ 231.9ث · `TypeError … socket.write` في `nextWrite`).
 * الحالة: منفّذ فعلياً — رقعةُ `patches/postgres@3.4.9.patch` + حارسُ `nextWrite`.
 * ينتمي إلى: tests/integration
 * يُشترطُ: `TEST_DATABASE_URL` (قاعدةُ اختبارٍ لا إنتاجٌ — يُتحققُ من اسمِها).
 *
 * ## ولماذا قتلُ الخلفياتِ لا إيقافُ الخادمِ
 *
 * لأنَّ هذا عينُ ما كشفَ العيبَ في الجولةِ السابقةِ: `pg_terminate_backend` يقطعُ
 * المقبسَ من جهةِ الخادمِ فجأةً (لا إغلاقًا ودّيًا)، فيسبقُ حدثُ الإغلاقُ تسويةَ
 * الاستعلاماتِ — وهي نافذةُ السباقِ التي يُقاسُ هنا صمودُها. والحارسُ إنْ لم يكن
 * موجودًا انهارتِ العمليةُ بخطأٍ غير ملتقطٍ (انظر `postgres-nextwrite-guard.test.ts`
 * للانحدارِ المباشرِ على الحارسِ نفسِهِ).
 *
 * ## عزلُ القتلِ عن غيرِها
 *
 * البوابةُ الوليدةُ تُقلعُ بمعاملِ `application_name` خاصٍّ بها في رابطِ قاعدتِها،
 * فلا يُقتَلُ من جلساتِ القاعدةِ إلا جلساتُها هي — لا جلساتُ اختباراتٍ أخرى تعملُ
 * على القاعدةِ نفسِها في CI.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";

/** قتلُ خلفياتِ القاعدةِ وتعافيها خمسَ جولاتٍ — I/O ثقيلٌ تحتَ حملِ الحزمةِ. */
const slowIt = (name: string, fn: () => Promise<void> | void) => it(name, fn, 60_000);

import { createSql } from "../../packages/infrastructure/db/client.ts";
import { reserveFreePort } from "../support/free-port.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
/** بلا رابطِ قاعدةِ اختبارٍ لا معنى للاختبارِ — يُتخطّى صراحةً لا يُنجحُ صمتًا. */
const describeIf = TEST_DATABASE_URL === "" ? describe.skip : describe;

/** اسمُ تطبيقٍ يميّزُ جلساتِ هذه البوابةِ الوليدةِ وحدَها. */
const GATEWAY_APP_NAME = "d7_terminate_survival_gateway";

/** مهلةُ استعادةِ الجاهزيةِ بعدَ كلِّ جولةِ قتلٍ — سقفٌ لا مهلةَ توكيدٍ. */
const READY_RECOVERY_BOUND_MS = 15_000;
/** مهلةُ إقلاعِ البوابةِ الوليدةِ. */
const BOOT_TIMEOUT_MS = 40_000;
const BOOT_ATTEMPTS = 4;
/** عددُ جولاتِ القتلِ. */
const ROUNDS = 5;

interface SpawnedGateway {
  readonly port: number;
  readonly child: ReturnType<typeof Bun.spawn>;
  readonly stderrLines: string[];
}

function gatewayEnv(databaseUrl: string, port: number): Record<string, string> {
  const joiner = databaseUrl.includes("?") ? "&" : "?";
  return {
    NODE_ENV: "test",
    PORT: String(port),
    // جلساتُ البوابةِ وحدَها تُوسَمُ بهذا الاسمِ فيُقتَلُ هيَ وحدَها.
    DATABASE_URL: `${databaseUrl}${joiner}application_name=${GATEWAY_APP_NAME}`,
    SUPABASE_URL: "https://supabase-unused.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-key",
    UPSTASH_REDIS_REST_URL: "https://upstash-unused.invalid",
    UPSTASH_REDIS_REST_TOKEN: "shim-token",
    DRIVER_BOT_TOKEN: "1111111:fake-driver-bot-token-d7",
    RIDER_BOT_TOKEN: "2222222:fake-rider-bot-token-d7",
    TELEGRAM_WEBHOOK_SECRET: "d7-webhook-secret-32chars-min-padding",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "100000007",
    // `ADR 0286` — عنوانُ التطبيقِ شرطُ إقلاعِ سطحِ miniapp الافتراضيِّ.
    MINIAPP_URL: "https://miniapp-d7.invalid",
    TELEGRAM_TRANSPORT: "silent",
    SESSION_STORE: "memory",
    RUN_WORKER_IN_GATEWAY: "false",
    RUN_ADMIN_IN_GATEWAY: "false",
    TRANSLATION_PROVIDER: "none",
    ROUTING_PROVIDER: "none",
  };
}

function drainStderr(child: ReturnType<typeof Bun.spawn>, into: string[]): void {
  void (async () => {
    const reader = (child.stderr as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (chunk.value !== undefined) into.push(decoder.decode(chunk.value, { stream: true }));
      }
    } catch {
      // أُغلقَ الأنبوبُ مع العمليّةِ — متوقّعٌ وليسَ إخفاقًا.
    }
  })();
}

async function bootGateway(): Promise<SpawnedGateway> {
  let lastTail = "";
  for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
    const port = reserveFreePort();
    const stderrLines: string[] = [];
    const child = Bun.spawn(["bun", "apps/gateway/src/index.ts"], {
      env: { ...process.env, ...gatewayEnv(TEST_DATABASE_URL, port) },
      stdout: "ignore",
      stderr: "pipe",
    });
    drainStderr(child, stderrLines);
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    for (;;) {
      if (Date.now() > deadline) break;
      if (child.exitCode !== null) {
        lastTail = stderrLines.slice(-5).join("\n");
        break;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) return { port, child, stderrLines };
      } catch {
        // لم يُقلعْ بعدُ — جولةُ انتظارٍ أخرى.
      }
      await Bun.sleep(250);
    }
    if (child.exitCode === null) {
      // أجابَتِ الصحّةُ متأخرةً عن المهلةِ أو لم تُجب: قتلٌ نظيفٌ ثمّ محاولةٌ أخرى.
      child.kill(9);
      await child.exited;
    }
  }
  throw new Error(`لم تُقلعِ البوابةُ خلالَ المحاولاتِ — آخرُ ذيلٍ:\n${lastTail}`);
}

async function readyStatus(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/ready`);
  // القراءةُ إلى الآخرِ كي لا يُحتجزَ المقبضُ.
  await response.text();
  return response.status;
}

/** انتظارُ عودةِ الجاهزيةِ ضمنَ سقفٍ — يُرجعُ الملّي ثانيةَ التي استغرقَها. */
async function waitForReady(port: number, boundMs: number): Promise<number> {
  const start = Date.now();
  for (;;) {
    if ((await readyStatus(port)) === 200) return Date.now() - start;
    if (Date.now() - start > boundMs) {
      throw new Error(`لم تستعدِ الجاهزيةُ خلالَ ${boundMs}ملّي ثانيةٍ`);
    }
    await Bun.sleep(300);
  }
}

describeIf("D7 — صمودُ البوابةِ تحتَ قتلِ خلفياتِ قاعدتِها", () => {
  let gateway: SpawnedGateway | null = null;
  let killer: ReturnType<typeof createSql> | null = null;

  beforeAll(async () => {
    gateway = await bootGateway();
    killer = createSql({ connectionString: TEST_DATABASE_URL });
  });

  afterAll(async () => {
    // قتلٌ فوريٌّ لا إغلاقٌ رشيقٌ: رشاقةُ الإغلاقِ ملفُّها الخاصُّ
    // (`gateway-graceful-shutdown.test.ts`)؛ وههنا يُكتفى بألّا تبقى عمليةٌ يتيمةٌ
    // بعدَ الاختبارِ — والمهلةُ الافتراضيّةُ للخطّافاتِ خمسُ ثوانٍ لا تتّسعُ لغيرِه.
    if (gateway !== null && gateway.child.exitCode === null) {
      gateway.child.kill(9);
      await Promise.race([gateway.child.exited, Bun.sleep(3000)]);
    }
    if (killer !== null) await killer.end({ timeout: 2000 });
  });

  slowIt("قتلُ خلفياتِ البوابةِ خمسَ جولاتٍ: العمليّةُ نفسُها تعيشُ وتستعيدُ جاهزيتَها في مهلةٍ", async () => {
    if (gateway === null || killer === null) throw new Error("التمهيدُ لم يكتمل");
    expect(gateway.child.exitCode).toBeNull();
    // جاهزيةٌ قبلَ أولِ جولةٍ — القاعدةُ تعملُ والاستعلامُ الحقيقيُّ يمرُّ.
    expect(await waitForReady(gateway.port, READY_RECOVERY_BOUND_MS)).toBeLessThan(
      READY_RECOVERY_BOUND_MS,
    );
    // منفذٌ ثابتٌ في نطاقٍ خالٍ منَ الإبطالِ — لا تدورُ القيمةُ داخلَ الإغلاقِ.
    const gatewayPort = gateway.port;

    for (let round = 1; round <= ROUNDS; round += 1) {
      // استعلاماتٌ جاريةٌ فعلاً: ضغطٌ متزامنٌ على `/ready` وكلُّ ردٍّ استعلامُ قاعدةٍ.
      const inFlight = Array.from({ length: 6 }, () => readyStatus(gatewayPort).catch(() => 503));
      // قتلُ جلساتِ البوابةِ وحدَها — بوسمِها لا بوسمِ غيرِها.
      await killer`select pg_terminate_backend(pid) from pg_stat_activity where application_name = ${GATEWAY_APP_NAME}`;
      await Promise.all(inFlight);

      // العمليّةُ نفسُها: لا خروجَ ولا انهيارَ — هذا جوهرُ D7.
      expect(gateway.child.exitCode).toBeNull();
      // الجاهزيةُ تعودُ ضمنَ السقفِ — لا انتظارَ إلى الأبدِ ولا إعادةَ تشغيلٍ خارجيّةً.
      const recoveryMs = await waitForReady(gateway.port, READY_RECOVERY_BOUND_MS);
      expect(recoveryMs).toBeLessThan(READY_RECOVERY_BOUND_MS);
      // ولم تُطبعْ رسالةُ انهيارِ العمليةِ في سجلِّها.
      expect(gateway.stderrLines.join("\n")).not.toContain("uncaughtException");
    }

    // خاتمةٌ: ما زالتِ العمليّةُ نفسَها حيّةً بعدَ الجولاتِ كلِّها.
    expect(gateway.child.exitCode).toBeNull();
  });
});
