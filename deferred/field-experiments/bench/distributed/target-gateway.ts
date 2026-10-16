#!/usr/bin/env bun

/**
 * الغرض: هدفُ جولةِ الحملِ الموزَّعِ — بوّابةٌ حقيقيّةٌ (حاويةُ المنتجِ نفسُها)
 *        في عمليةٍ مستقلّةٍ، لا خادمُ أرقامٍ ولا مزدوجٌ. المولّداتُ لا تعرفُ
 *        عنها شيئاً سوى URL — وهذا هو الدَّرزُ نفسُهُ الذي يفصلُ المولّداتِ عن
 *        الهدفِ لو كانت في مضيفينَ آخرين.
 * الحالة: منفَّذ — الشقُّ المملوكُ للمستودَعِ من `F9-03`.
 * ينتمي إلى: bench/distributed
 * يُتوقع أن يستخدمه لاحقاً: جولةُ خطِّ الأساسِ في `F10-01` حين تُفتحُ بيئةُ النشرِ.
 * ملاحظات مستقبلية: عقدُ البيئةِ منسوخٌ عن `scripts/load-test.ts` المُقيسِ لا
 *        مُختلَقٌ — فأيَّ خللٍ في العقدِ يظهرُ هنا يظهرُ هناكَ أيضًا.
 *
 * الاستخدام:
 *   BENCH_DATABASE_URL=postgres://… bun bench/distributed/target-gateway.ts --port 4301
 */

import type { TelegramSender } from "../../../../apps/gateway/src/bots/driver/index.ts";
import { buildContainer } from "../../../../apps/gateway/src/container.ts";
import { createMemoryRateLimiter } from "../../../../apps/gateway/src/rate-limit/fixed-window.ts";
import { createServer } from "../../../../apps/gateway/src/server.ts";
import { loadConfig } from "../../../../packages/shared/config/index.ts";

const DATABASE_URL = process.env.BENCH_DATABASE_URL;
if (DATABASE_URL === undefined || DATABASE_URL === "") {
  console.error("❌ عيّن BENCH_DATABASE_URL لقاعدةٍ بها كلُّ الهجراتِ مطبَّقةً.");
  process.exit(1);
}

function intArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const PORT = intArg("port", 4301);
const SECRET = "distributed-load-secret-32chars-min-padd";

/** مُرسِلٌ صامتٌ: لا شبكةَ — الحملُ هنا معماريٌّ (توزيعٌ وتنسيقٌ) لا قياسَ تلغرام. */
const silentSender: TelegramSender = {
  sendMessage: async () => "1",
  sendPhoto: async () => "1",
  sendLocation: async () => "1",
};

/** عقدُ البيئةِ من `load-test.ts` حرفيّاً — انظر تعليقَهُ هناك. */
const benchEnv: Record<string, string> = {
  NODE_ENV: "test",
  PORT: String(PORT),
  SUPABASE_URL: "https://local.test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "distributed-load",
  DATABASE_URL,
  UPSTASH_REDIS_REST_URL: "http://localhost",
  UPSTASH_REDIS_REST_TOKEN: "distributed-load",
  DRIVER_BOT_TOKEN: "distributed-load-driver",
  RIDER_BOT_TOKEN: "distributed-load-rider",
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "990002",
  SESSION_STORE: "memory",
  TRANSLATION_PROVIDER: "none",
  RUN_WORKER_IN_GATEWAY: "false",
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
const sql = container.sql;

const app = createServer({
  health: {
    now: () => new Date(),
    startedAt: new Date(),
    env: { ...process.env, ...benchEnv },
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
    rateLimits: {
      probes: createMemoryRateLimiter({ limit: 10 ** 9, windowSeconds: 60 }),
      users: createMemoryRateLimiter({ limit: 10 ** 9, windowSeconds: 60 }),
    },
  },
});

const server = Bun.serve({ port: PORT, fetch: app.fetch });
console.log(`[target-gateway] البوّابةُ الحقيقيّةُ تستقبلُ على ${server.url}`);

process.on("SIGTERM", () => {
  console.log("[target-gateway] إشارةُ إنهاءٍ — إغلاقٌ نظيفٌ.");
  server.stop(true);
  process.exit(0);
});
