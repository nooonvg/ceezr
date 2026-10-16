/**
 * CAP-RUN-20261016 — حارس خروج يُحمَّل بـ `bun --preload` قبل البوابة الحقيقية.
 *
 * الطبقة الأولى من طبقتين (الثانية: network namespace بلا واجهة غير loopback):
 * - كل نداء إلى api.telegram.org يُعاد توجيهه إلى محاكي تيليجرام المحلي (MOCK_TELEGRAM_URL).
 *   لا يوجد أي مسار يستدعي fetch الحقيقي لمضيف تيليجرام: إن تعطّل المحاكي يفشل النداء
 *   (fail closed) ولا يُجرَّب الإنترنت.
 * - أي مضيف غير loopback يُرفض فورًا بخطأ EGRESS_BLOCKED ويُسجَّل في egress-blocked.jsonl.
 */
import { appendFileSync, mkdirSync } from "node:fs";

const MOCK = process.env.MOCK_TELEGRAM_URL;
const DIR = process.env.RUN_DIR ? `${process.env.RUN_DIR}/evidence` : "/tmp";
mkdirSync(DIR, { recursive: true });
if (!MOCK || !/^http:\/\/127\.0\.0\.1:\d+$/.test(MOCK)) {
  console.error(
    "[egress-guard] MOCK_TELEGRAM_URL مفقود أو ليس loopback — رفض الإقلاع (fail closed)",
  );
  process.exit(78);
}
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const realFetch = globalThis.fetch.bind(globalThis);
let blocked = 0;
let redirected = 0;

function block(url: string, why: string): never {
  blocked++;
  appendFileSync(
    `${DIR}/egress-blocked.jsonl`,
    `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, why, host: safeHost(url) })}\n`,
  );
  throw new TypeError(`EGRESS_BLOCKED: ${safeHost(url)}`);
}
function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return block(raw, "invalid_url");
  }
  if (u.hostname === "api.telegram.org") {
    redirected++;
    const target = `${MOCK}${u.pathname}${u.search}`;
    if (input instanceof Request) {
      const body = init?.body ?? (input.method === "GET" ? undefined : await input.arrayBuffer());
      return realFetch(target, {
        method: init?.method ?? input.method,
        headers: init?.headers ?? input.headers,
        body,
        signal: init?.signal ?? input.signal,
      });
    }
    return realFetch(target, init);
  }
  if (!LOOPBACK.has(u.hostname)) return block(raw, "non_loopback_host");
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;
globalThis.fetch = guarded;

process.on("exit", () => {
  try {
    appendFileSync(
      `${DIR}/egress-guard-summary.jsonl`,
      `${JSON.stringify({ t: new Date().toISOString(), pid: process.pid, blocked, redirected })}\n`,
    );
  } catch {}
});
console.log(`[egress-guard] active pid=${process.pid} telegram→${MOCK} non-loopback=BLOCK`);
