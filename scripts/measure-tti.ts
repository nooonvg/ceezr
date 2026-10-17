/**
 * **زيادةُ `DEC-19` (قرارُ المالكِ 2026-09-24 · `ADR 0185` · النصُّ التالي باقٍ للتاريخِ):**
 *   هذا السكربتُ يقيسُ المسارَ المحكومَ للصفوفِ 3–5 — مسارَ راكبِ تيليجرام المُختبَرِ — على
 *   ملفَّينِ في تشغيلٍ واحدٍ وعلى البناءِ نفسِه: Chromium «Slow 4G» (المعيارُ الإلزاميُّ ·
 *   `rider-surface-budget.ts` · تقريرٌ حتى تُستوفى الحدودُ) وChromium «3G» (حارسُ انحدارٍ ·
 *   `interactive-budget.ts`). والمقاييسُ من `performance.timeOrigin`: FCP · LCP · «زمنُ
 *   بلوغِ سطحِ الراكبِ المرسومِ» (`PerformanceElementTiming.renderTime` لعنصرِ
 *   `elementtiming="waslah-rider-surface"` · قرارُ المالكِ) — لا «TTI».
 *
 * الغرض (الأصلُ): قياسُ «وقتِ التفاعلِ بعدَ فتحِ تيليجرام» (القسمُ 9.9 الصفُّ ٥) بمتصفّحٍ
 *   حقيقيٍّ على مُخرَجِ البناءِ — معَ مسارِ إقلاعٍ كاملٍ: `initData` مُوقَّعٌ
 *   ببروتوكولِ تيليجرامَ، بوّابةٌ حقيقيّةٌ تُبادلُهُ جلسةً، و`GET /v1/me` يقرأُ
 *   الدورَ. ويُحكَمُ بـ`scripts/lib/interactive-budget.ts`.
 * الحالة: أداةُ قياسٍ لا منطقَ أعمالٍ — `F1-09` الصفُّ ٥ · `D-26`.
 * ينتمي إلى: scripts
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ «متصفّحٌ حقيقيٌّ — وقتُ التفاعلِ» في CI.
 *
 * **ولماذا هو منفصلٌ عن `measure-first-paint.ts`**: لأنَّ الصفَّينِ ٣ و٤ يَقيسانِ
 * الرسمَ وحدَه — بلا جلسةٍ وبلا بوّابةٍ — والصفُّ ٥ يَقيسُ المسارَ كاملَه. والخلطُ
 * يُربِكُ التبعيّاتِ (بوّابةٌ + قاعدةٌ) في قياسٍ لا يحتاجها.
 *
 * **حدودُ القياسِ مُعلَنةٌ** (`ح-5`):
 *   - البوّابةُ نسخةٌ واحدةٌ في الذاكرةِ (لا Redis) — وهذا حدُّ الإنتاجِ اليومَ
 *     (`DEC-14`) فليسَ تضيلاً.
 *   - القاعدةُ `PostgreSQL` حقيقيّةٌ بها الهجراتُ — `GET /v1/me` يقرأُ `users`.
 *   - سكربتُ `telegram.org` محجوبٌ عمداً كما في الصفَّينِ ٣ و٤.
 *   - المُنفِّذُ ليسَ جوّالاً.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { buildContainer } from "../apps/gateway/src/container.ts";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "../apps/gateway/src/rate-limit/fixed-window.ts";
import { type KeyDimension, rateLimitPolicy } from "../apps/gateway/src/rate-limit/policy.ts";
import { createServer, type ServerDependencies } from "../apps/gateway/src/server.ts";
import { RIDER_SURFACE_TIMING_ID } from "../apps/miniapp/src/surfaces/rider/welcome/surface-timing.ts";
import { buildBrowserHostScript } from "../apps/miniapp/src/tg/measure-host.ts";
import {
  createConsentRecordReader,
  createConsentRecordWriter,
} from "../packages/infrastructure/consent/consent-store.ts";
import { createSql } from "../packages/infrastructure/db/client.ts";
import { createMemoryInitDataReplayGuard } from "../packages/infrastructure/identity/memory-init-data-replay-guard.ts";
import { createMemorySessionRevocationStore } from "../packages/infrastructure/identity/memory-session-revocation-store.ts";
import { createMiniAppRefreshTokens } from "../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../packages/infrastructure/identity/miniapp-session.ts";
import { createRevocableSessionReader } from "../packages/infrastructure/identity/revocable-session-reader.ts";
import {
  createTelegramInitDataVerifier,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
} from "../packages/infrastructure/identity/telegram-init-data.ts";
import { createViewerAccountReader } from "../packages/infrastructure/identity/viewer-account.ts";
import { createViewerAccountLanguageWriter } from "../packages/infrastructure/identity/viewer-language.ts";
import type { AppConfig } from "../packages/shared/config/index.ts";
import { SLOW_3G } from "./lib/first-paint-budget.ts";
import {
  DECLARED_SURFACE_RENDERED_BREACHES,
  declaredDecisionIds,
  evaluateInteractive,
  SURFACE_RENDERED_BUDGET_MS,
} from "./lib/interactive-budget.ts";
import {
  evaluateRiderSurface,
  RIDER_SURFACE_LIMITS,
  type RiderSurfaceRun,
  SLOW_4G,
  SLOW_4G_GATE_MODE,
} from "./lib/rider-surface-budget.ts";
import { signFreshInitData } from "./lib/telegram-test-init-data.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "apps/miniapp/dist");
const THROTTLED_RUNS = 3;
const RUN_TIMEOUT_MS = 60_000;
const QUIET_WINDOW_MS = 2_000;

/** رمزُ بوتٍ اختباريٌّ ثابتٌ — لا يُستعملُ في الإنتاجِ. */
const TEST_BOT_TOKEN = "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_SESSION_SECRET = "test-miniapp-session-secret-for-tti-measurement-only";
const TEST_USER = {
  id: 888_001,
  first_name: "TTI",
  last_name: "Test",
  username: "tti_test",
  language_code: "ar",
};

/**
 * بذرُ مستخدمٍ راكبٍ نشِطٍ في قاعدةِ الاختبارِ — حتى يُعيدُ `GET /v1/me` دوراً
 * معروفاً وسطحاً منتجاً، لا `unregistered`/`surface: none`.
 *
 * **لا يُفترَضُ وجودُ الصفِّ**: السكربتُ يزرعُهُ إن لم يكن. وإن لم يُزرَعْ، فمسارُ
 * `resolve-viewer.ts` معروفٌ: لا صفَّ ← `unregistered` ← `surface: none` ← شاشةٌ
 * نظاميّةٌ ← والعلامةُ (بعدَ التصحيحِ) لا تُطلَقُ — فيفشلُ القياسُ لا يخضرَّ.
 */
async function seedTestUserIfMissing(
  sql: import("../packages/infrastructure/db/client.ts").Sql,
): Promise<void> {
  const existing = await sql<{ count: string }[]>`
    select count(*)::text as count from users where telegram_id = ${TEST_USER.id}::bigint
  `;
  const count = Number(existing[0]?.count ?? 0);
  if (count > 0) return;
  const city = await sql<{ id: string }[]>`select id from cities where code = 'JED' limit 1`;
  const cityId = city[0]?.id;
  if (cityId === undefined)
    throw new Error("لا مدينةَ 'JED' في قاعدةِ الاختبارِ — هل طُبِّقتْ هجراتُ البذور؟");
  await sql`
    insert into users (city_id, telegram_id, full_name, language_code, role)
    values (${cityId}, ${TEST_USER.id}::bigint, 'راكب TTI', 'ar', 'rider')
    on conflict (telegram_id) do nothing
  `;
}

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: "test",
    port: 3999,
    supabaseUrl: "https://local.test.supabase.co",
    databaseUrl: process.env.TEST_DATABASE_URL ?? "postgres://invalid",
    supabaseServiceKey: "local-test",
    redisUrl: "http://localhost",
    redisToken: "local-test",
    sessionStore: "memory",
    processTopology: "single-process",
    metricsExport: { endpoint: null, headers: {}, intervalSeconds: 15, serviceInstanceId: null },
    telegramTransport: "silent",
    botSurfaceMode: "legacy",
    miniAppUrl: null,
    internalSignalSecret: null,
    gatewayInternalUrl: null,
    driverBotToken: TEST_BOT_TOKEN,
    riderBotToken: TEST_BOT_TOKEN,
    telegramWebhookSecret: "tti-test-secret",
    bootstrapAdminTelegramId: "990001",
    translationProvider: "none",
    translationApiKey: null,
    translationContactEmail: null,
    runWorkerInGateway: false,
    runAdminInGateway: false,
    mapProvider: "none",
    mapStyleUrl: null,
    mapTilesPublicKey: null,
    maplibreSri: null,
    routingProvider: "none",
    osrmBaseUrl: null,
    routingRateLimit: null,
    tracking: {
      gpsIntervalSeconds: 3,
      gpsIdleIntervalSeconds: 30,
      minDistanceMeters: 25,
      teleportThresholdMeters: null,
      maxReasonableSpeedKmh: null,
      maxAccuracyMeters: null,
      maxTimeDriftSeconds: null,
    },
    trackingTokenBaseUrl: null,
    miniappSessionSecret: TEST_SESSION_SECRET,
    adminBreakGlassTotpKey: "dGVzdC1icmVhay1nbGFzcy10b3RwLWtleS0zMi1ieXRlcy1sb25n",
    liveLocationFallbackEnabled: false,
    ...overrides,
  };
}

function limiterFor(method: string, path: string, keyDimension: KeyDimension): RateLimiter {
  return createMemoryRateLimiter(rateLimitPolicy(method, path, keyDimension));
}

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function findBrowser(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (!existsSync(fromEnv)) throw new Error(`CHROME_PATH لا يُشيرُ إلى ملفٍّ: ${fromEnv}`);
    return fromEnv;
  }
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const playwright = join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (existsSync(playwright)) {
    for (const dir of readdirSync(playwright).filter((d) => d.startsWith("chromium"))) {
      for (const sub of readdirSync(join(playwright, dir))) {
        candidates.push(join(playwright, dir, sub, "chrome-headless-shell"));
        candidates.push(join(playwright, dir, sub, "chrome"));
      }
    }
  }
  const found = candidates.find((c) => existsSync(c));
  if (found === undefined) {
    throw new Error("لا متصفّحَ — عيِّنْ CHROME_PATH. وغيابُه إخفاقٌ لا تخطٍّ.");
  }
  return found;
}

interface CdpEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

class Cdp {
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  readonly listeners: Array<(event: CdpEvent) => void> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (message) => {
      const data = JSON.parse(String(message.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
        method?: string;
        params?: Record<string, unknown>;
      };
      if (data.id !== undefined) {
        const waiter = this.pending.get(data.id);
        if (waiter === undefined) return;
        this.pending.delete(data.id);
        if (data.error !== undefined) waiter.reject(new Error(data.error.message));
        else waiter.resolve(data.result);
      } else if (data.method !== undefined) {
        for (const listener of this.listeners)
          listener({ method: data.method, params: data.params ?? {} });
      }
    };
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`تعذَّرَ الاتّصالُ بـ${url}`));
    });
    return new Cdp(socket);
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.socket.close();
  }
}

const OBSERVERS = `
window.__paint = { fcp: null, lcp: null };
window.__tti = { marked: false, time: null, surface: null, rendered: null, timingCount: 0, timingInBusy: false };
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.name === "first-contentful-paint") window.__paint.fcp = e.startTime;
}).observe({ type: "paint", buffered: true });
new PerformanceObserver((list) => {
  // DEC-19: مُدخَلاتُ LCP اسمُها فارغٌ — فالترشيحُ بالاسمِ كانَ يُبقي lcp دائماً null.
  // كلُّ مُدخَلٍ يُرصَدُ يحلُّ محلَّ سابقِه، فالمقروءُ آخرُ مُدخَلٍ حتى توقُّفِ القياسِ.
  for (const e of list.getEntries()) window.__paint.lcp = e.startTime;
}).observe({ type: "largest-contentful-paint", buffered: true });
const ttiObserver = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.name === "waslah-interactive") {
      window.__tti.marked = true;
      window.__tti.time = e.startTime;
    }
    // استخراجُ السطحِ المنتجِ من علامةٍ ثانيةٍ اسمُها waslah-surface: ثم اسمُ السطحِ —
    // إثباتٌ أنّ الموجّهَ وصلَ إلى سطحٍ منتجٍ لا شاشةٍ نظاميّةٍ.
    const surfaceMatch = /^waslah-surface:(rider|driver|admin)$/.exec(e.name);
    if (surfaceMatch && surfaceMatch[1] !== undefined) {
      window.__tti.surface = surfaceMatch[1];
    }
  }
});
ttiObserver.observe({ type: "mark", buffered: true });
// DEC-19 (قرارُ المالكِ): زمنُ بلوغِ سطحِ الراكبِ المرسومِ = renderTime لعنصرِ القياسِ من timeOrigin.
// renderTime صفرٌ يعني أنَّه لم يُحسَب — فيبقى null ويُسقِطُ الحَكَمُ القياسَ.
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.identifier !== ${JSON.stringify(RIDER_SURFACE_TIMING_ID)}) continue;
    window.__tti.timingCount += 1;
    if (window.__tti.rendered === null && e.renderTime > 0) window.__tti.rendered = e.renderTime;
    if (e.element && e.element.closest('[aria-busy="true"]') !== null) window.__tti.timingInBusy = true;
  }
}).observe({ type: "element", buffered: true });
`;

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

function buildTelegramMock(initData: string): string {
  const user = JSON.stringify({
    id: TEST_USER.id,
    first_name: TEST_USER.first_name,
    last_name: TEST_USER.last_name,
    username: TEST_USER.username,
    language_code: TEST_USER.language_code,
  });
  return buildBrowserHostScript(initData, user);
}

interface NetRequest {
  readonly url: string;
  readonly start: number;
  end: number | null;
  bytes: number;
}

/** تشغيلٌ مقيسٌ: حقائقُ الحَكَمَينِ + سجلُّ الطلباتِ للتقريرِ. */
interface MeasuredRun extends RiderSurfaceRun {
  readonly requests: readonly NetRequest[];
}

/**
 * تقريرٌ لا حكمٌ: البايتاتُ المنقولةُ (`encodedDataLength`) للطلباتِ التي اكتملَت حتى علامةِ
 * بلوغِ السطحِ المرسومِ، وعددُ الطلباتِ التي بدأَت قبلَها. والتوقيتُ منسوبٌ إلى بدءِ طلبِ
 * المستندِ (وهوَ ≈ `performance.timeOrigin` لا مطابقٌ له بالضبطِ — للتقريرِ لا للحكمِ).
 */
function reportRequests(run: MeasuredRun, label: string, verbose: boolean): void {
  const reqs = [...run.requests].sort((a, b) => a.start - b.start);
  const t0 = reqs[0]?.start ?? 0;
  const until = run.surfaceRenderedMs ?? Number.POSITIVE_INFINITY;
  const started = reqs.filter((r) => r.start - t0 <= until);
  const bytes = started.reduce(
    (n, r) => n + (r.end !== null && r.end - t0 <= until ? r.bytes : 0),
    0,
  );
  console.log(
    `    ${label}: طلباتٌ بدأَت قبلَ السطحِ المرسومِ=${started.length} · بايتاتٌ منقولةٌ حتّاه=${bytes}`,
  );
  if (!verbose) return;
  for (const r of started) {
    const path = r.url.replace(/^https?:\/\/[^/]+/, "");
    const end = r.end === null ? "—" : (r.end - t0).toFixed(0);
    console.log(`      ${(r.start - t0).toFixed(0)}→${end} ms · ${r.bytes} B · ${path}`);
  }
}

async function measureOnce(
  browserPath: string,
  origin: string,
  profile: typeof SLOW_3G | typeof SLOW_4G | null,
  initData: string,
): Promise<MeasuredRun> {
  const userDataDir = mkdtempSync(join(tmpdir(), "waslah-tti-"));
  const headlessFlag = browserPath.includes("headless-shell") ? "--headless" : "--headless=new";
  const port = freePort();
  const proc = Bun.spawn(
    [
      browserPath,
      headlessFlag,
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let stderrTail = "";
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      stderrTail = (stderrTail + decoder.decode(chunk)).slice(-2000);
    }
  })();
  let cdp: Cdp | null = null;
  try {
    const started = Date.now();
    let page: { type: string; webSocketDebuggerUrl: string } | undefined;
    while (page === undefined) {
      if (Date.now() - started > 30_000 || proc.exitCode !== null) {
        throw new Error(
          `لم يُقلِعِ المتصفّحُ (منفذُ ${port} · خروجٌ ${proc.exitCode ?? "—"}):\n${stderrTail || "(لا مخرجاتِ أخطاءٍ)"}`,
        );
      }
      await Bun.sleep(200);
      try {
        const targets = (await (
          await fetch(`http://127.0.0.1:${port}/json/list`)
        ).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
        page = targets.find((t) => t.type === "page");
      } catch {
        /* لم يُصغِ بعدُ */
      }
    }
    cdp = await Cdp.connect(page.webSocketDebuggerUrl);

    const failed: string[] = [];
    const exceptions: string[] = [];
    const urls = new Map<string, string>();
    const inflight = new Set<string>();
    const netLog = new Map<string, NetRequest>();
    let lastNetworkActivity = Date.now();
    cdp.listeners.push(({ method, params }) => {
      const requestId = String(params.requestId ?? "");
      // سجلُّ طلباتٍ للتقريرِ وحدَه (الحملُ والانتظاراتُ) — لا يدخلُ في أيِّ حكمٍ.
      const at = typeof params.timestamp === "number" ? params.timestamp * 1000 : 0;
      if (method === "Network.requestWillBeSent" && !netLog.has(requestId)) {
        const url = (params.request as { url: string }).url;
        if (!url.startsWith("data:"))
          netLog.set(requestId, { url, start: at, end: null, bytes: 0 });
      } else if (method === "Network.loadingFinished") {
        const entry = netLog.get(requestId);
        if (entry !== undefined) {
          entry.end = at;
          entry.bytes = Number(params.encodedDataLength ?? 0);
        }
      }
      if (method === "Network.requestWillBeSent") {
        urls.set(requestId, (params.request as { url: string }).url);
        inflight.add(requestId);
        lastNetworkActivity = Date.now();
      } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
        inflight.delete(requestId);
        lastNetworkActivity = Date.now();
        const url = urls.get(requestId) ?? "";
        if (method === "Network.loadingFailed" && url.startsWith(origin)) {
          failed.push(`${String(params.errorText)} ${url}`);
        }
      } else if (method === "Network.responseReceived") {
        const response = params.response as { url: string; status: number };
        if (response.url.startsWith(origin) && response.status >= 400) {
          failed.push(`${response.status} ${response.url}`);
        }
      } else if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails as {
          text?: string;
          exception?: { description?: string };
        };
        exceptions.push(details.exception?.description ?? details.text ?? "استثناءٌ بلا نصٍّ");
      }
    });

    await cdp.send("Network.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBlockedURLs", {
      urls: ["*://telegram.org/*", "*://*.telegram.org/*"],
    });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 823,
      deviceScaleFactor: 2.625,
      mobile: true,
    });
    if (profile !== null) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latencyMs,
        downloadThroughput: profile.downloadBytesPerSecond,
        uploadThroughput: profile.uploadBytesPerSecond,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuSlowdown });
    }
    // حقنُ وهمِ تيليجرامَ قبلَ تحميلِ الصفحةِ — قبلَ أيِّ سكربتٍ.
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildTelegramMock(initData),
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: OBSERVERS });
    await cdp.send("Page.navigate", { url: `${origin}/` });

    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let state = {
      fcp: null as number | null,
      lcp: null as number | null,
      root: 0,
      interactive: false as boolean,
      interactiveTime: null as number | null,
      rendered: null as number | null,
      timingCount: 0,
      timingInBusy: false as boolean,
      surface: null as "rider" | "driver" | "admin" | null,
      complete: false,
    };
    while (Date.now() < deadline) {
      await Bun.sleep(250);
      const evaluated = await cdp.send<{ result: { value?: string } }>("Runtime.evaluate", {
        expression:
          "JSON.stringify({fcp: window.__paint?.fcp ?? null, lcp: window.__paint?.lcp ?? null," +
          " root: document.getElementById('root')?.childElementCount ?? 0," +
          " interactive: window.__tti?.marked ?? false," +
          " interactiveTime: window.__tti?.time ?? null," +
          " rendered: window.__tti?.rendered ?? null," +
          " timingCount: window.__tti?.timingCount ?? 0," +
          " timingInBusy: window.__tti?.timingInBusy ?? false," +
          " surface: window.__tti?.surface ?? null," +
          " complete: document.readyState === 'complete'})",
        returnByValue: true,
      });
      if (evaluated.result.value !== undefined) state = JSON.parse(evaluated.result.value);
      const quiet = inflight.size === 0 && Date.now() - lastNetworkActivity >= QUIET_WINDOW_MS;
      // توقُّفُ القياسِ (ومعَه قراءةُ آخرِ LCP): المستندُ مكتملٌ · لا طلبَ جارٍ ومضَت ثانيتانِ
      // على آخرِ نشاطٍ شبكيٍّ · بلغَ الموجّهُ سطحاً · رُصِدَ renderTime لعنصرِ القياسِ. أو المهلةُ.
      if (
        state.complete &&
        quiet &&
        state.interactive &&
        state.surface !== null &&
        state.rendered !== null
      )
        break;
    }
    return {
      surfaceRenderedMs: state.rendered,
      lcpMs: state.lcp,
      requests: [...netLog.values()],
      fcpMs: state.fcp,
      rootChildCount: state.root,
      failedSameOriginRequests: failed,
      uncaughtExceptions: exceptions,
      interactiveMarked: state.interactive,
      surface: state.surface,
      timingEntryCount: state.timingCount,
      timingInBusyTree: state.timingInBusy,
    };
  } finally {
    cdp?.close();
    proc.kill();
    await proc.exited;
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("✗ لا مُخرَجَ بناءٍ في apps/miniapp/dist — شغّل: bun run build:miniapp");
    process.exit(1);
  }

  const dbUrl = process.env.TEST_DATABASE_URL;
  if (!dbUrl) {
    console.error("✗ لا قاعدةَ — عيِّنْ TEST_DATABASE_URL (PostgreSQL بها الهجرات)");
    process.exit(1);
  }

  const browser = findBrowser();

  // بناءُ البوّابةِ الحقيقيّةِ بالتبعيّاتِ الأدنى: جلسةُ التطبيقِ المصغَّرِ + /v1/me.
  const config = testConfig({ databaseUrl: dbUrl });
  const container = buildContainer(config, {});
  const sql = createSql({ connectionString: dbUrl });

  try {
    const issuer = createMiniAppSessionIssuer({ secret: TEST_SESSION_SECRET });
    const refreshChain = {
      refresh: createMiniAppRefreshTokens({ secret: TEST_SESSION_SECRET }),
      grantIssuer: issuer,
    };
    const replayGuard = createMemoryInitDataReplayGuard(() => new Date());
    const revocationStore = createMemorySessionRevocationStore();

    const sessionTelegram = {
      exchange: {
        verifier: createTelegramInitDataVerifier({
          bots: [{ name: "rider", token: TEST_BOT_TOKEN }],
        }),
        issuer,
        refreshChain,
        replayGuard,
        initDataMaxAgeSeconds: TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
        now: () => new Date(),
        log: () => {},
      },
      limits: {
        perAddress: limiterFor("POST", "/v1/session/telegram", "عنوانُ العميلِ" as KeyDimension),
      },
      log: () => {},
    };

    const me = {
      viewer: {
        sessions: createRevocableSessionReader(
          createMiniAppSessionReader(TEST_SESSION_SECRET),
          revocationStore,
        ),
        accounts: createViewerAccountReader(sql),
        now: () => new Date(),
        log: () => {},
      },
      languageWriter: createViewerAccountLanguageWriter(sql),
      log: () => {},
    };

    const serverDeps: ServerDependencies = {
      health: { now: () => new Date(), startedAt: new Date(), env: process.env },
      webhook: { webhookSecret: "tti-test-secret", handler: container.handler },
      sessionTelegram,
      me,
      // مسارُ الموافقاتِ: سطحُ الراكبِ يطلُبُ `/v1/consents` عندَ الإقلاعِ، فهو
      // جزءٌ من شريحةِ الإقلاعِ المُختبَرةِ لا إضافةٌ خارجيّةٌ. وغيابُه كانَ يُسقِطُ
      // القياسَ بـ`FAILED_REQUEST` بعدَ إصلاحِ صدقِ المسارِ.
      consents: {
        consent: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(TEST_SESSION_SECRET),
            revocationStore,
          ),
          reader: createConsentRecordReader(sql),
          writer: createConsentRecordWriter(sql),
          now: () => new Date(),
          log: () => {},
        },
        log: () => {},
      },
    };

    const honoApp = createServer(serverDeps);

    // بذرُ مستخدمٍ راكبٍ نشِطٍ — حتى يُعيدُ `/v1/me` سطحاً منتجاً، لا `unregistered`.
    // وثباتُ الصدقِ: إذا لم يُنجَحْ هذا البذرُ، فالقياسُ لا يستمرُّ.
    await seedTestUserIfMissing(sql);

    // خادمٌ واحدٌ يُقدِّمُ `dist` ويُمرِّرُ الـAPI إلى البوّابةِ — نفسُ الأصلِ.
    const cache = new Map<string, Uint8Array>();
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost`);
        const pathname = url.pathname;

        // مساراتُ الـAPI تُمرَّرُ إلى البوّابةِ.
        if (
          pathname.startsWith("/v1/") ||
          pathname.startsWith("/health") ||
          pathname.startsWith("/ready") ||
          pathname.startsWith("/webhook/")
        ) {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === "string") headers[key] = value;
          }
          const body =
            req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
          const request = new Request(`http://localhost${req.url}` as never, {
            method: req.method ?? "GET",
            headers: new Headers(headers),
            ...(body === undefined ? {} : { body }),
          });
          const response = await honoApp.fetch(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          const buf = await response.arrayBuffer();
          res.end(Buffer.from(buf));
          return;
        }

        // الملفاتُ الثابتةُ من `dist`.
        let path = decodeURIComponent(pathname);
        if (path === "/") path = "/index.html";
        let file = normalize(join(DIST, path));
        if (!file.startsWith(DIST) || !existsSync(file) || !file.includes(".")) {
          file = join(DIST, "index.html");
        }
        let body = cache.get(file);
        if (body === undefined) {
          body = gzipSync(readFileSync(file), { level: 9 });
          cache.set(file, body);
        }
        res.writeHead(200, {
          "content-type": MIME[extname(file)] ?? "application/octet-stream",
          "content-encoding": "gzip",
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });

    const port = freePort();
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${port}`;

    console.log(`وقتُ التفاعلِ بمتصفّحٍ حقيقيٍّ (F1-09 الصفُّ ٥ · D-26) — ${browser}`);
    console.log(`  البوّابةُ على ${origin} · القاعدةُ ${dbUrl.replace(/\/\/.*@/, "//***@")}`);

    // **تحقّقُ صدقِ المسارِ قبلَ القياسِ**: تبادلُ الجلسةِ ← `GET /v1/me` ←
    // الدورُ المتوقَّعُ ← السطحُ المنتج. فإن لم يحدثْ هذا، فالقياسُ لا معنى له —
    // قد يَصيرُ أخضرَ بعدَ الوصولِ إلى شاشةِ `unregistered` لا إلى سطحِ الراكب.
    // والتحقّقُ هنا قبلَ تشغيلِ المتصفّحِ حتى يُخفِقَ صراحةً بلا انتظارٍ.
    const initData = signFreshInitData(TEST_BOT_TOKEN, TEST_USER, 1)[0];
    if (initData === undefined) {
      console.error("✗ تعذَّرَ توليدُ بيانِ الدخولِ الموقَّعِ للتحقّقِ من المسار");
      process.exit(1);
    }
    const sessionRes = await fetch(`${origin}/v1/session/telegram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData: initData.raw }),
    });
    if (sessionRes.status !== 201) {
      console.error(`✗ تبادلُ الجلسةِ لم ينجح: ${sessionRes.status} — المسارُ غيرُ صالحٍ للقياس`);
      process.exit(1);
    }
    const sessionBody = (await sessionRes.json()) as { accessToken?: string };
    const accessToken = sessionBody.accessToken;
    if (typeof accessToken !== "string" || accessToken.length === 0) {
      console.error("✗ تبادلُ الجلسةِ لم يُعِدْ رمزَ وصولٍ — المسارُ غيرُ صالحٍ للقياس");
      process.exit(1);
    }
    const meRes = await fetch(`${origin}/v1/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (meRes.status !== 200) {
      console.error(`✗ GET /v1/me لم ينجح: ${meRes.status} — المسارُ غيرُ صالحٍ للقياس`);
      process.exit(1);
    }
    const meBody = (await meRes.json()) as { role?: string; status?: string };
    if (meBody.role !== "rider" || meBody.status !== "active") {
      console.error(
        `✗ /v1/me أعاد role=${meBody.role ?? "—"} status=${meBody.status ?? "—"} — المتوقَّعُ rider/active. المسارُ يصلُ إلى شاشةٍ نظاميّةٍ لا سطحاً منتجاً`,
      );
      process.exit(1);
    }
    console.log(
      `  تحقّقُ المسار: session=201 · me=200 · role=${meBody.role} · status=${meBody.status} · surface=rider`,
    );

    // توليدُ initData مُوقَّعةٍ لكلِّ تشغيلٍ (تفاديًا لـSEC-17).
    const initDatas = signFreshInitData(TEST_BOT_TOKEN, TEST_USER, THROTTLED_RUNS + 1);

    try {
      // تشغيلٌ بلا تقييدٍ — لشرطِ الحياةِ.
      const unthrottled = await measureOnce(browser, origin, null, initDatas[0]?.raw ?? "");
      console.log(
        `  بلا تقييدٍ: FCP=${unthrottled.fcpMs?.toFixed(0) ?? "—"} ms · بلوغُ السطحِ المرسومِ=${fmt(unthrottled.surfaceRenderedMs)} ms · surface=${unthrottled.surface ?? "—"} · عُقَدُ #root=${unthrottled.rootChildCount}`,
      );

      /**
       * (١) Chromium «3G» — حارسُ انحدارٍ لا حاجزُ إغلاقٍ (`DEC-19`). يُسقِطُ على الانحدارِ
       * فوقَ السقفِ المُعلَنِ وعلى شرطِ الحياةِ؛ ولا يُدَّعى أنَّ الحدَّ قابلٌ للتحقيقِ عليه.
       */
      const throttled: MeasuredRun[] = [];
      for (let i = 0; i < THROTTLED_RUNS; i++) {
        const run = await measureOnce(browser, origin, SLOW_3G, initDatas[i + 1]?.raw ?? "");
        throttled.push(run);
        console.log(
          `  ${SLOW_3G.id} #${i + 1}: FCP=${fmt(run.fcpMs)} ms · LCP=${fmt(run.lcpMs)} ms · بلوغُ السطحِ المرسومِ=${fmt(run.surfaceRenderedMs)} ms · surface=${run.surface ?? "—"}`,
        );
        reportRequests(run, `${SLOW_3G.id} #${i + 1}`, false);
      }

      const roadmap = readFileSync(join(ROOT, "docs/ROADMAP-MASTER.md"), "utf8");
      const verdict = evaluateInteractive({
        unthrottled,
        profileId: SLOW_3G.id,
        throttled,
        declared: DECLARED_SURFACE_RENDERED_BREACHES,
        knownDecisions: declaredDecisionIds(roadmap),
      });
      console.log(
        `  [حارسُ انحدارٍ] الوسيطُ على ${SLOW_3G.id}: بلوغُ السطحِ المرسومِ=${fmt(verdict.medianSurfaceRenderedMs)} ms (السقفُ ${DECLARED_SURFACE_RENDERED_BREACHES[0]?.ceilingMs ?? "—"} · الحدُّ ${SURFACE_RENDERED_BUDGET_MS} غيرُ قابلٍ للتحقيقِ على هذا الملفِّ)`,
      );

      /**
       * (٢) Chromium «Slow 4G» — المعيارُ الإلزاميُّ للصفوفِ 3–5 (`DEC-19`) على سطحِ الراكبِ.
       * الوضعُ `SLOW_4G_GATE_MODE`: تقريرٌ حتى تُستوفى الحدودُ، وشرطُ الحياةِ حاجزٌ دائماً.
       */
      const slow4g: MeasuredRun[] = [];
      const initDatas4g = signFreshInitData(TEST_BOT_TOKEN, TEST_USER, THROTTLED_RUNS);
      for (let i = 0; i < THROTTLED_RUNS; i++) {
        const run = await measureOnce(browser, origin, SLOW_4G, initDatas4g[i]?.raw ?? "");
        slow4g.push(run);
        console.log(
          `  ${SLOW_4G.id} #${i + 1}: FCP=${fmt(run.fcpMs)} ms · LCP=${fmt(run.lcpMs)} ms · بلوغُ السطحِ المرسومِ=${fmt(run.surfaceRenderedMs)} ms · surface=${run.surface ?? "—"}`,
        );
        reportRequests(run, `${SLOW_4G.id} #${i + 1}`, i === 0);
      }
      const rider = evaluateRiderSurface({
        runs: slow4g,
        mode: SLOW_4G_GATE_MODE,
        profileId: SLOW_4G.id,
      });
      console.log(`  [DEC-19 · ${SLOW_4G_GATE_MODE}] الوسيطُ على ${SLOW_4G.id} (سطحُ الراكبِ):`);
      for (const m of rider.metrics) {
        console.log(
          `    ${m.metric} = ${fmt(m.medianMs)} ms · الحدُّ ${m.limitMs} ms · ${m.met ? "مستوفىً" : "غيرُ مستوفىً"}`,
        );
      }
      console.log(
        `    الحدودُ: FCP ≤ ${RIDER_SURFACE_LIMITS.fcpMs} · LCP ≤ ${RIDER_SURFACE_LIMITS.lcpMs} · بلوغُ السطحِ المرسومِ ≤ ${RIDER_SURFACE_LIMITS.surfaceRenderedMs} — ${rider.allMet ? "مستوفاةٌ" : "غيرُ مستوفاةٍ؛ F1-09 يبقى [~]"}`,
      );

      const problems = [...verdict.problems, ...rider.problems];
      if (problems.length > 0) {
        for (const problem of problems) console.error(`✗ [${problem.rule}] ${problem.detail}`);
        process.exit(1);
      }
      console.log(
        "✓ شرطُ الحياةِ مستوفىً على الملفّاتِ كلِّها، وحارسُ «3G» ضمنَ سقفِه — ولا يُقرأُ هذا استيفاءً لحدودِ 9.9 (DEC-19 · F1-09 [~])",
      );
    } finally {
      server.close();
    }
  } finally {
    await sql.end({ timeout: 5 });
    await container.close();
  }
}

function fmt(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(0) : "—";
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

await main();
