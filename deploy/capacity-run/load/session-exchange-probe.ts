/**
 * الغرض: مسبارُ عزلِ جدارِ الجلسةِ (LOAD-01 Recovery) — يصطنعُ N هويةً جديدةً
 *   ويبادلُ الجلسةَ لكلٍّ منها بتزامنٍ مضبوطٍ، ويسجّلُ الحالةَ وزمنَ الاستجابةِ
 *   لا غيرَ. لا يفترضَ السببَ: الحكمَ على 503 (وهل هو حاجزُ التزامنِ أم قاطعُ
 *   الدائرةِ أم مهلةٌ) يعطيه سجلُّ البوّابةِ المرتبطُ بنافذةِ المسبارِ نفسِها.
 * الحالة: مُنفَّذٌ — عزلُ السببِ الفرعيِّ قبلَ أيِّ إصلاحٍ (توجيهُ الاستكمالِ §3).
 * ينتمي إلى: deploy/capacity-run/load
 * يُشغَّلُ: `bun run deploy/capacity-run/load/session-exchange-probe.ts --concurrency 250 --rounds 1`
 * ملاحظات: الهويةُ لا تُعادُ — كلُّ جولةٍ بصماتِ initData جديدةٍ (وإلا ردَّ حارسُ
 *   إعادةِ الاستعمالِ REPLAYED وهو ليسَ العطبَ المقصودَ هنا).
 */

import { signedInitData } from "./lib.ts";

const args = process.argv.slice(2);
function arg(name: string, dflt: number): number {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || args[i + 1] === undefined) return dflt;
  return Number(args[i + 1]);
}

const CONCURRENCY = arg("concurrency", 50);
const ROUNDS = arg("rounds", 1);
const BASE_URL = process.env.LOAD_BASE_URL ?? "http://127.0.0.1:54300";
const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
/** بصمةُ الجولةِ في السجلِ — تُربَطُ نافذةُ المسبارِ بسجلِّ البوّابةِ. */
const PROBE_TAG = `probe-session-${Date.now()}`;
let nextTelegramId = 90_500_000_000 + Math.floor(Math.random() * 10_000_000);

interface Sample {
  readonly status: number;
  readonly ms: number;
  readonly bodyError: string | null;
}

async function exchangeOnce(): Promise<Sample> {
  const telegramId = nextTelegramId++;
  const initData = signedInitData({ botToken: BOT_TOKEN, telegramId });
  const started = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/v1/session/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - started;
    let bodyError: string | null = null;
    try {
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (body.ok !== true) bodyError = body.error ?? null;
    } catch {
      bodyError = "unreadable_body";
    }
    return { status: response.status, ms, bodyError };
  } catch (thrown) {
    return { status: -1, ms: Date.now() - started, bodyError: String(thrown) };
  }
}

console.log(
  JSON.stringify({ probe: PROBE_TAG, concurrency: CONCURRENCY, rounds: ROUNDS, baseUrl: BASE_URL }),
);

for (let round = 1; round <= ROUNDS; round += 1) {
  const samples = await Promise.all(Array.from({ length: CONCURRENCY }, () => exchangeOnce()));
  const byStatus = new Map<number, number>();
  const byError = new Map<string, number>();
  const latencies: number[] = [];
  for (const s of samples) {
    byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
    if (s.bodyError !== null) {
      byError.set(s.bodyError, (byError.get(s.bodyError) ?? 0) + 1);
    }
    latencies.push(s.ms);
  }
  latencies.sort((a, b) => a - b);
  const p = (q: number): number => latencies[Math.floor((latencies.length - 1) * q)];
  console.log(
    JSON.stringify({
      probe: PROBE_TAG,
      round,
      count: samples.length,
      status: Object.fromEntries(byStatus),
      errors: Object.fromEntries(byError),
      latencyMs: { p50: p(0.5), p95: p(0.95), max: latencies[latencies.length - 1] },
    }),
  );
}
