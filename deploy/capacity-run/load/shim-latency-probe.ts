/**
 * الغرض: مسبارُ زمنِ استجابةِ موصلِ Redis (shim) بتزامنٍ حقيقيٍّ — قياسٌ بلا GIL
 *   ولا خيوطِ نظامٍ متسلسلةِ الانطلاقِ: كلُّ النداءاتِ تنطلقُ معًا (barrier عبرَ
 *   Promise.all) من حلقةِ أحداثٍ واحدةٍ كما تفعلُ البوّابةُ نفسُها.
 * الحالة: مُنفَّذٌ — قرارُ قيمةِ مسلكِ Redis (bulkhead) يقاسُ لا يُخمَّن.
 * ينتمي إلى: deploy/capacity-run/load
 * يُشغَّلُ: `bun run deploy/capacity-run/load/shim-latency-probe.ts --concurrency 1024`
 */

const args = process.argv.slice(2);
function arg(name: string, dflt: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || args[i + 1] === undefined) return dflt;
  return Number(args[i + 1]);
}
const CONCURRENCY = arg("concurrency", 256);
const BASE = process.env.UPSTASH_REDIS_REST_URL ?? "http://127.0.0.1:58081";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

async function call(): Promise<number> {
  const started = Date.now();
  const response = await fetch(BASE, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(["PING"]),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await response.text();
  return Date.now() - started;
}

const latencies: number[] = [];
const errors: string[] = [];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    try {
      latencies.push(await call());
    } catch (thrown) {
      errors.push(String(thrown));
    }
  }),
);
latencies.sort((a, b) => a - b);
const p = (q: number): number => latencies[Math.floor((latencies.length - 1) * q)];
console.log(
  JSON.stringify({
    concurrency: CONCURRENCY,
    ok: latencies.length,
    errors: errors.length,
    latencyMs: {
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      max: latencies[latencies.length - 1],
    },
  }),
);
