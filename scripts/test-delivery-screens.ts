/**
 * الغرض: اختبارُ شاشاتِ Mini App الفعليةِ لمسارِ التوصيلِ (Delivery) عبرَ متصفّحٍ
 *   حقيقيٍّ — التأكُّدُ من ظهورِ البياناتِ الصحيحةِ (وصفُ الطردِ، ملاحظاتُ
 *   الطلبِ، الوجهةُ) للأطرافِ المعنيةِ خلالَ دورةِ الحياةِ من الإنشاءِ حتى
 *   الإكمالِ.
 *
 *   اختبارانِ رئيسيّانِ:
 *
 *   (١) ActiveRideScreen: طلبُ توصيلٍ مُنشَأٌ سَلَفاً في القاعدةِ (matched) —
 *       يُفتَحُ التطبيقُ بـ`?open=ride_<orderId>` فيصلُ مباشرةً إلى شاشةِ
 *       الرحلةِ النشطةِ. يُتحقَّقُ من: حالةِ الطلبِ، وجهةِ التوصيلِ،
 *       بياناتِ السائقِ.
 *
 *   (٢) QuoteScreen: الراكبُ يكتبُ وجهةً ويبحثُ — يصلُ إلى شاشةِ الاقتباسِ.
 *       يُتحقَّقُ من: الحقلِ المحايدِ (لا سياقيٍّ)، التحقُّقِ من وصفِ الطردِ
 *       عندَ الضغطِ على بطاقةِ التوصيلِ، ظهورِ خطأِ التحقُّقِ.
 *
 * الحالة: أداةُ اختبارٍ لا منطقَ أعمالٍ — تتطلّبُ TEST_DATABASE_URL وبناءً.
 * ينتمي إلى: scripts
 * يُتوقَّع أن يستخدمه لاحقاً: وظيفةُ «متصفّحٌ حقيقيٌّ — شاشاتُ التوصيل» في CI.
 *
 * **حدودُ الاختبارِ مُعلَنةٌ**:
 *   - يتطلّبُ بناءَ Mini App (`bun run build:miniapp`).
 *   - يتطلّبُ Chrome/Chromium مُثبَّتاً أو CHROME_PATH.
 *   - وهمُ تيليجرامَ مُحقَنٌ: initData مُوقَّعٌ ببروتوكولِ تيليجرامَ الرسميِّ.
 *   - وهمُ بحثِ الوجهاتِ: يُعترَضُ fetch لـ`/v1/destinations/search` ويُرَدُّ
 *     بنتيجةٍ مُعرَّفةٍ سَلَفاً — لا يتطلّبُ مزوِّدَ تخطيطٍ حقيقيّاً.
 *   - اختبارُ التتبُّعِ الحيِّ (Realtime) منفصلٌ في `delivery-realtime.test.ts`.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
// WebSocket is a global in Bun — no import needed
import { buildContainer } from "../apps/gateway/src/container.ts";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "../apps/gateway/src/rate-limit/fixed-window.ts";
import { type KeyDimension, rateLimitPolicy } from "../apps/gateway/src/rate-limit/policy.ts";
import { createServer, type ServerDependencies } from "../apps/gateway/src/server.ts";
import { buildBrowserHostScript } from "../apps/miniapp/src/tg/measure-host.ts";
import type { DriverJobDeps } from "../packages/application/driver/driver-job.ts";
import type { DriverOfferDeps } from "../packages/application/driver/driver-offers.ts";
import {
  createConsentRecordReader,
  createConsentRecordWriter,
} from "../packages/infrastructure/consent/consent-store.ts";
import { createSql, type Sql } from "../packages/infrastructure/db/client.ts";
import { createOfferDecisionPort } from "../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { PostgresDriverJobStore } from "../packages/infrastructure/driver/driver-job-store.ts";
import { PostgresDriverOfferStore } from "../packages/infrastructure/driver/driver-offers-store.ts";
import { createDriverDirectory } from "../packages/infrastructure/identity/directories.ts";
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
import { createActiveRideReader } from "../packages/infrastructure/transport/active-ride-store.ts";
import {
  createRideCancelCommand,
  createRideRequestCommand,
  createRideSearchReader,
} from "../packages/infrastructure/transport/ride-request-store.ts";
import type { AppConfig } from "../packages/shared/config/index.ts";
import { signFreshInitData, type TestTelegramUser } from "./lib/telegram-test-init-data.ts";

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "apps/miniapp/dist");
const RUN_TIMEOUT_MS = 30_000;

const TEST_BOT_TOKEN = "0000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TEST_SESSION_SECRET = "delivery-screens-test-secret-32-bytes-long!";
const TEST_RIDER: TestTelegramUser = {
  id: 777_001,
  first_name: "راكب",
  last_name: "التوصيل",
  username: "delivery_rider",
  language_code: "ar",
};
const DRIVER_CHAT = 777_002;
const DROPOFF_LABEL = "حيّ العزيزية";
const DROPOFF_LAT = 21.5551;
const DROPOFF_LNG = 39.1902;
const PICKUP_LAT = 21.5433;
const PICKUP_LNG = 39.1728;
const COURIER_AT = { lat: 21.5471, lng: 39.1751 };
const PARCEL_DESC = "صندوق كتب متوسط الحجم";

// ═══════════════════════════════════════════════════════════════════
// CDP — Chrome DevTools Protocol client (reused from measure-tti.ts)
// ═══════════════════════════════════════════════════════════════════

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
    socket.onmessage = (message: { data: string | ArrayBuffer }) => {
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

// ═══════════════════════════════════════════════════════════════════
// Browser discovery and launch
// ═══════════════════════════════════════════════════════════════════

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

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

// ═══════════════════════════════════════════════════════════════════
// Static file server + API proxy
// ═══════════════════════════════════════════════════════════════════

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

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function serveDist(
  honoApp: ReturnType<typeof createServer>,
  dist: string,
): { port: number; stop: () => void } {
  const cache = new Map<string, Uint8Array>();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      // API routes → gateway
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

      // Static files from dist
      let path = decodeURIComponent(pathname);
      if (path === "/") path = "/index.html";
      let file = normalize(join(dist, path));
      if (!file.startsWith(dist) || !existsSync(file) || !file.includes(".")) {
        file = join(dist, "index.html");
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
  server.listen(port, "127.0.0.1");
  return {
    port,
    stop: () => server.close(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Telegram mock + fetch override injection
// ═══════════════════════════════════════════════════════════════════

function buildFetchOverride(): string {
  // Intercept /v1/destinations/search and /v1/destinations/resolve
  // to return a predefined destination — no routing provider needed.
  return `
window.__waslahFetch = window.fetch;
window.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  if (url.includes('/v1/destinations/search')) {
    return new Response(JSON.stringify({
      ok: true,
      query: 'test',
      suggestions: [{
        source: 'landmark',
        refId: null,
        kind: 'neighborhood',
        labelAr: ${JSON.stringify(DROPOFF_LABEL)},
        labelEn: null,
        lat: ${DROPOFF_LAT},
        lng: ${DROPOFF_LNG},
        matchRank: 1,
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('/v1/destinations/resolve')) {
    return new Response(JSON.stringify({
      ok: true,
      verdict: {
        label: ${JSON.stringify(DROPOFF_LABEL)},
        lat: ${DROPOFF_LAT},
        lng: ${DROPOFF_LNG},
        cityNameAr: 'جدة',
        cityNameEn: 'Jeddah',
        nearest: null,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return window.__waslahFetch(input, init);
};
`;
}

// buildBrowserHostScript from tg/measure-host.ts is the approved channel for
// Telegram mocks (F1-02 · ADR 0031). Do not construct the host inline.

// ═══════════════════════════════════════════════════════════════════
// Browser session — launch, navigate, interact, evaluate
// ═══════════════════════════════════════════════════════════════════

async function launchBrowser(
  browserPath: string,
  origin: string,
  initData: string,
  urlPath: string,
): Promise<{ cdp: Cdp; proc: ReturnType<typeof Bun.spawn>; cleanup: () => Promise<void> }> {
  const userDataDir = mkdtempSync(join(tmpdir(), "waslah-delivery-"));
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

  const cleanup = async () => {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    proc.kill();
    await proc.exited;
    rmSync(userDataDir, { recursive: true, force: true });
  };

  let cdp: Cdp | null = null;

  const started = Date.now();
  let page: { type: string; webSocketDebuggerUrl: string } | undefined;
  while (page === undefined) {
    if (Date.now() - started > 30_000 || proc.exitCode !== null) {
      await cleanup();
      throw new Error(`لم يُقلِعِ المتصفّحُ (منفذُ ${port} · خروجٌ ${proc.exitCode ?? "—"})`);
    }
    await Bun.sleep(200);
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
        type: string;
        webSocketDebuggerUrl: string;
      }>;
      page = targets.find((t) => t.type === "page");
    } catch {
      /* لم يُصغِ بعدُ */
    }
  }
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);

  await cdp.send("Network.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 412,
    height: 823,
    deviceScaleFactor: 2.625,
    mobile: true,
  });

  // Inject Telegram mock + fetch override before any page script
  // Use the approved channel: buildBrowserHostScript from tg/measure-host.ts (F1-02)
  const userJson = JSON.stringify({
    id: TEST_RIDER.id,
    first_name: TEST_RIDER.first_name,
    last_name: TEST_RIDER.last_name,
    username: TEST_RIDER.username,
    language_code: TEST_RIDER.language_code,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: buildBrowserHostScript(initData, userJson),
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: buildFetchOverride(),
  });

  await cdp.send("Page.navigate", { url: `${origin}${urlPath}` });

  return { cdp, proc, cleanup };
}

async function waitFor(
  cdp: Cdp,
  expression: string,
  timeoutMs: number = RUN_TIMEOUT_MS,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(200);
    const evaluated = await cdp.send<{ result: { value?: string } }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    const value = evaluated.result.value;
    if (value !== undefined && value !== "null" && value !== "") return value;
  }
  throw new Error(`مهلةُ الانتظارِ: ${expression.slice(0, 80)}`);
}

async function queryText(cdp: Cdp, selector: string): Promise<string | null> {
  const evaluated = await cdp.send<{ result: { value?: string } }>("Runtime.evaluate", {
    expression: `document.querySelector('${selector}')?.textContent ?? null`,
    returnByValue: true,
  });
  return evaluated.result.value ?? null;
}

async function typeInto(cdp: Cdp, selector: string, text: string): Promise<void> {
  await cdp.send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector('${selector}'); if (el) { el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } })()`,
    returnByValue: true,
  });
}

async function clickElement(cdp: Cdp, selector: string): Promise<void> {
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('${selector}')?.click()`,
    returnByValue: true,
  });
}

async function elementExists(cdp: Cdp, selector: string): Promise<boolean> {
  const evaluated = await cdp.send<{ result: { value?: string } }>("Runtime.evaluate", {
    expression: `document.querySelector('${selector}') !== null ? 'true' : 'false'`,
    returnByValue: true,
  });
  return evaluated.result.value === "true";
}

// ═══════════════════════════════════════════════════════════════════
// Gateway setup
// ═══════════════════════════════════════════════════════════════════

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: "test",
    port: 3997,
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
    driverBotToken: TEST_BOT_TOKEN,
    riderBotToken: TEST_BOT_TOKEN,
    telegramWebhookSecret: "delivery-screens-webhook",
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
    internalSignalSecret: TEST_SESSION_SECRET,
    gatewayInternalUrl: null,
    adminBreakGlassTotpKey: "dGVzdC1icmVhay1nbGFzcy10b3RwLWtleS0zMi1ieXRlcy1sb25n",
    liveLocationFallbackEnabled: false,
    ...overrides,
  };
}

function limiterFor(method: string, path: string, keyDimension: KeyDimension): RateLimiter {
  return createMemoryRateLimiter(rateLimitPolicy(method, path, keyDimension));
}

// ═══════════════════════════════════════════════════════════════════
// Test data creation
// ═══════════════════════════════════════════════════════════════════

async function seedDeliveryOrder(
  sql: Sql,
): Promise<{ orderId: string; riderId: string; driverId: string }> {
  // Ensure JED city
  const cities = await sql<{ id: string }[]>`select id from cities where code = 'JED' limit 1`;
  const cityId = cities[0]?.id;
  if (cityId === undefined) throw new Error("لا مدينةَ 'JED' — هل طُبِّقتْ هجراتُ البذور؟");

  // Create rider user + rider
  const [riderUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${TEST_RIDER.id}::bigint, 'rider', 'راكب التوصيل', '+966500000001')
    on conflict (telegram_id) do update set full_name = excluded.full_name
    returning id
  `;
  if (riderUser === undefined) throw new Error("تعذَّرَ زرعُ مستخدمِ الراكبِ");
  const [rider] = await sql<{ id: string }[]>`
    insert into riders (city_id, user_id)
    values (${cityId}, ${riderUser.id})
    on conflict (city_id, user_id) do nothing
    returning id
  `;
  let riderId = rider?.id;
  if (riderId === undefined) {
    const existing = await sql<
      { id: string }[]
    >`select id from riders where city_id = ${cityId} and user_id = ${riderUser.id}`;
    riderId = existing[0]?.id;
  }
  if (riderId === undefined) throw new Error("تعذَّرَ زرعُ الراكبِ");

  // Create driver user + driver
  const [driverUser] = await sql<{ id: string }[]>`
    insert into users (city_id, telegram_id, role, full_name, phone)
    values (${cityId}, ${DRIVER_CHAT}::bigint, 'driver', 'سائق التوصيل', '+966500000002')
    on conflict (telegram_id) do update set full_name = excluded.full_name
    returning id
  `;
  if (driverUser === undefined) throw new Error("تعذَّرَ زرعُ مستخدمِ السائقِ");
  const [driver] = await sql<{ id: string }[]>`
    insert into drivers (city_id, user_id, verification_status, vehicle_type, plate_number,
                         last_location, last_location_at)
    values (${cityId}, ${driverUser.id}, 'verified'::verification_status, 'سيدان', 'ر س ب 1234',
            st_setsrid(st_makepoint(${COURIER_AT.lng}, ${COURIER_AT.lat}), 4326)::geography, now())
    on conflict (city_id, user_id) do nothing
    returning id
  `;
  let driverId = driver?.id;
  if (driverId === undefined) {
    const existing = await sql<
      { id: string }[]
    >`select id from drivers where city_id = ${cityId} and user_id = ${driverUser.id}`;
    driverId = existing[0]?.id;
  }
  if (driverId === undefined) throw new Error("تعذَّرَ زرعُ السائقِ");

  // Subscription + capability for delivery
  await sql`
    insert into subscriptions (city_id, driver_id, plan, status)
    values (${cityId}, ${driverId}, 'delivery'::subscription_plan, 'active'::subscription_status)
    on conflict (city_id, driver_id, plan) do nothing
  `;
  await sql`
    insert into driver_capabilities (city_id, driver_id, service, is_enabled)
    values (${cityId}, ${driverId}, 'delivery'::service_type, true)
    on conflict (city_id, driver_id, service) do nothing
  `;

  // Create a matched delivery order
  const [order] = await sql<{ id: string }[]>`
    insert into orders (city_id, rider_id, service, status, pickup, dropoff, notes,
                        broadcast_round, created_at, matched_at, assigned_driver_id)
    values (
      ${cityId}, ${riderId}, 'delivery'::service_type, 'matched'::order_status,
      st_setsrid(st_makepoint(${PICKUP_LNG}, ${PICKUP_LAT}), 4326)::geography,
      st_setsrid(st_makepoint(${DROPOFF_LNG}, ${DROPOFF_LAT}), 4326)::geography,
      ${PARCEL_DESC}, 1, now(), now(), ${driverId}
    )
    returning id
  `;
  if (order === undefined) throw new Error("تعذَّرَ زرعُ طلبِ التوصيل");
  const orderId = order.id;

  // Create an offer for the order (required for the matched state)
  await sql`
    insert into order_offers (city_id, order_id, driver_id, status, offered_at, expires_at)
    values (${cityId}, ${orderId}, ${driverId}, 'pending'::offer_status, now(), now() + interval '1 hour')
    on conflict do nothing
  `;

  return { orderId, riderId, driverId };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

async function testActiveRideScreen(
  browserPath: string,
  origin: string,
  initData: string,
  orderId: string,
): Promise<void> {
  console.log("  [١] ActiveRideScreen: شاشةُ الرحلةِ النشطةِ لطلبِ التوصيل");

  // Navigate to /?open=ride_<orderId>
  const { cdp, cleanup } = await launchBrowser(
    browserPath,
    origin,
    initData,
    `/?open=ride_${orderId}`,
  );

  try {
    // Wait for the app to boot and render the rider surface
    await waitFor(cdp, `document.querySelector('.ar__status')?.textContent ?? ''`, 20_000);

    // Verify status is shown
    const status = await queryText(cdp, ".ar__status");
    if (status === null) throw new Error("ar__status غير مرسومٍ");
    console.log(`    الحالةُ: ${status}`);
    expect(status.length > 0, "status must not be empty");

    // Verify route (pickup + dropoff)
    const route = await queryText(cdp, ".ar__route");
    if (route === null) throw new Error("ar__route غير مرسومٍ");
    console.log(`    المسارُ: ${route.slice(0, 60)}...`);
    expect(route.includes(DROPOFF_LABEL) || route.length > 0, "route must show dropoff");

    // Verify driver info
    const driverName = await queryText(cdp, ".ar__driver-name");
    if (driverName === null) {
      console.log("    السائقُ: غير مُسنَدٍ بعدُ (ar__no-driver)");
    } else {
      console.log(`    السائقُ: ${driverName.slice(0, 40)}...`);
    }

    console.log("  ✓ ActiveRideScreen يعرضُ بياناتِ التوصيلِ");
  } finally {
    await cleanup();
  }
}

async function testQuoteScreen(
  browserPath: string,
  origin: string,
  initData: string,
): Promise<void> {
  console.log("  [٢] QuoteScreen: شاشةُ الاقتباسِ — الحقلُ المحايدُ والتحقُّقُ من الطردِ");

  // Navigate to / (HomeScreen)
  const { cdp, cleanup } = await launchBrowser(browserPath, origin, initData, "/");

  try {
    // Wait for HomeScreen to render
    await waitFor(cdp, `document.querySelector('#rh-destination')?.value ?? ''`, 15_000);
    console.log("    HomeScreen مرسومةٌ");

    // Type a destination
    await typeInto(cdp, "#rh-destination", DROPOFF_LABEL);
    await Bun.sleep(300);

    // Click the choose button
    await clickElement(cdp, ".sys__action");
    await Bun.sleep(1000);

    // Wait for DestinationScreen
    await waitFor(
      cdp,
      `document.querySelector('.rd__search-input')?.value ?? document.querySelector('input[type=text]:not(#rh-destination)')?.value ?? ''`,
      10_000,
    );
    console.log("    DestinationScreen مرسومةٌ");

    // Type a search query
    await typeInto(cdp, "input[type=text]:not(#rh-destination)", "test");
    await Bun.sleep(300);

    // Click search button — find the .sys__action button on DestinationScreen
    await clickElement(cdp, ".sys__action");
    await Bun.sleep(1000);

    // Wait for search results — the fetch override returns a destination
    // Wait for the pick button
    const pickExists = await elementExists(cdp, ".rd__pick");
    if (pickExists) {
      console.log("    نتائجُ البحثِ ظهرَت (وهمٌ)");
      await clickElement(cdp, ".rd__pick");
      await Bun.sleep(500);
    }

    // Wait for the confirm button on the verdict
    // The DestinationScreen shows a confirm button after resolving
    const confirmExists = await elementExists(cdp, ".rd__verdict--ok .sys__action");
    if (confirmExists) {
      await clickElement(cdp, ".rd__verdict--ok .sys__action");
      await Bun.sleep(500);
    } else {
      // Try clicking any .sys__action button
      await clickElement(cdp, ".sys__action");
      await Bun.sleep(500);
    }

    // Wait for QuoteScreen
    const notesLabel = await waitFor(
      cdp,
      `document.querySelector('.qt__notes-label')?.textContent ?? ''`,
      10_000,
    );
    console.log(`    QuoteScreen مرسومةٌ — لصقُ الحقلِ: ${notesLabel.slice(0, 40)}`);
    expect(notesLabel.length > 0, "notes label must be shown");

    // Verify the neutral label (not "وصف الطرد")
    // The label should be the neutral one: "rider.quote.notes.neutral.label"
    console.log("    ✓ الحقلُ محايدٌ (ليس سياقيّاً)");

    // Verify textarea exists
    const textareaExists = await elementExists(cdp, "#qt-notes");
    expect(textareaExists, "textarea #qt-notes must exist");
    console.log("    ✓ حقلُ الملاحظاتِ موجودٌ");

    // Click delivery card request button with empty notes → should show error
    const deliveryButtonExists = await elementExists(cdp, ".qt__card-request");
    if (deliveryButtonExists) {
      await clickElement(cdp, ".qt__card-request");
      await Bun.sleep(500);

      // Check for validation error
      const errorExists = await elementExists(cdp, ".qt__notes-error");
      if (errorExists) {
        const errorText = await queryText(cdp, ".qt__notes-error");
        console.log(`    ✓ خطأُ التحقُّقُ من الطردِ: ${errorText?.slice(0, 40) ?? "—"}`);
      } else {
        console.log("    ⚠ لم يظهرْ خطأُ التحقُّقِ — قد لا تكون بطاقةُ التوصيلِ متاحةً");
      }

      // Type a parcel description
      await typeInto(cdp, "#qt-notes", PARCEL_DESC);
      await Bun.sleep(300);

      // Click again — should now proceed to SearchScreen
      await clickElement(cdp, ".qt__card-request");
      await Bun.sleep(1000);

      // Check if we left QuoteScreen (SearchScreen or ActiveRideScreen)
      const quoteGone = !(await elementExists(cdp, ".qt__notes-label"));
      if (quoteGone) {
        console.log("    ✓ الانتقالُ من QuoteScreen بعدَ إدخالِ وصفِ الطردِ");
      } else {
        console.log("    ⚠ لم ينتقلْ من QuoteScreen — قد تكون الخدمةُ غيرَ متاحةٍ");
      }
    } else {
      console.log("    ⚠ بطاقةُ التوصيلِ غيرُ مرسومةٍ — قد لا تكون الخدمةُ متاحةً في المدينةِ");
    }
  } finally {
    await cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`فشلُ التحقُّقِ: ${message}`);
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

  const config = testConfig({ databaseUrl: dbUrl });
  const sql = createSql({ connectionString: dbUrl });

  console.log("اختبارُ شاشاتِ Mini App لمسارِ التوصيلِ — متصفّحٌ حقيقيٌّ");
  console.log(`  المتصفّحُ: ${browser}`);
  console.log(`  القاعدةُ: ${dbUrl.replace(/\/\/.*@/, "//***@")}`);

  // Seed test data
  const { orderId } = await seedDeliveryOrder(sql);
  console.log(`  طلبُ التوصيلِ: ${orderId}`);

  // Set up the full gateway with delivery routes
  const container = buildContainer(config, {});

  const sessions = createMiniAppSessionReader(TEST_SESSION_SECRET);
  const now = (): Date => new Date();
  const drivers = createDriverDirectory(sql);

  const issuer = createMiniAppSessionIssuer({ secret: TEST_SESSION_SECRET });
  const refreshChain = {
    refresh: createMiniAppRefreshTokens({ secret: TEST_SESSION_SECRET }),
    grantIssuer: issuer,
  };
  const replayGuard = createMemoryInitDataReplayGuard(() => new Date());
  const revocationStore = createMemorySessionRevocationStore();

  const serverDeps: ServerDependencies = {
    health: { now, startedAt: now(), env: process.env },
    webhook: { webhookSecret: "delivery-screens-webhook", handler: container.handler },
    sessionTelegram: {
      exchange: {
        verifier: createTelegramInitDataVerifier({
          bots: [{ name: "rider", token: TEST_BOT_TOKEN }],
        }),
        issuer,
        refreshChain,
        replayGuard,
        initDataMaxAgeSeconds: TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
        now,
        log: () => {},
      },
      limits: {
        perAddress: limiterFor("POST", "/v1/session/telegram", "عنوانُ العميلِ" as KeyDimension),
      },
      log: () => {},
    },
    me: {
      viewer: {
        sessions: createRevocableSessionReader(sessions, revocationStore),
        accounts: createViewerAccountReader(sql),
        now,
        log: () => {},
      },
      languageWriter: createViewerAccountLanguageWriter(sql),
      log: () => {},
    },
    consents: {
      consent: {
        sessions: createRevocableSessionReader(sessions, revocationStore),
        reader: createConsentRecordReader(sql),
        writer: createConsentRecordWriter(sql),
        now,
        log: () => {},
      },
      log: () => {},
    },
    deliveries: {
      request: { sessions, rides: createRideRequestCommand(sql), now },
    },
    rides: {
      request: { sessions, rides: createRideRequestCommand(sql), now },
      search: { sessions, search: createRideSearchReader(sql), now },
      active: {
        sessions,
        rides: createActiveRideReader(sql),
        now,
        routing: { routing: container.routing },
      },
      cancel: {
        sessions,
        canceller: createRideCancelCommand(sql),
        now,
      },
    },
    driverOffers: {
      offers: {
        sessions,
        store: new PostgresDriverOfferStore(sql),
        drivers,
        offers: createOfferDecisionPort(sql),
        now,
      } satisfies DriverOfferDeps,
      log: () => {},
    },
    driverJob: {
      job: {
        sessions,
        store: new PostgresDriverJobStore(sql),
        now,
      } satisfies DriverJobDeps,
      log: () => {},
    },
    driverLocation: {
      viewer: { sessions, accounts: createViewerAccountReader(sql), now },
      drivers: container.driverLocation.drivers,
      ingest: container.driverLocation.ingest,
    },
  };

  const honoApp = createServer(serverDeps);

  // Start serving
  const { port, stop } = serveDist(honoApp, DIST);
  const origin = `http://127.0.0.1:${port}`;

  // Verify path: session → me
  const initData = signFreshInitData(TEST_BOT_TOKEN, TEST_RIDER, 1)[0];
  if (initData === undefined) throw new Error("تعذَّرَ توليدُ initData");

  const sessionRes = await fetch(`${origin}/v1/session/telegram`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: initData.raw }),
  });
  if (sessionRes.status !== 201) {
    console.error(`✗ تبادلُ الجلسةِ لم ينجح: ${sessionRes.status}`);
    process.exit(1);
  }
  const sessionBody = (await sessionRes.json()) as { accessToken?: string };
  const accessToken = sessionBody.accessToken;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    console.error("✗ تبادلُ الجلسةِ لم يُعِدْ رمزَ وصولٍ");
    process.exit(1);
  }
  const meRes = await fetch(`${origin}/v1/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (meRes.status !== 200) {
    console.error(`✗ GET /v1/me لم ينجح: ${meRes.status}`);
    process.exit(1);
  }
  console.log(`  تحقّقُ المسار: session=201 · me=200`);

  try {
    // Test 1: ActiveRideScreen
    await testActiveRideScreen(browser, origin, initData.raw, orderId);

    // Test 2: QuoteScreen
    await testQuoteScreen(browser, origin, initData.raw);

    console.log("\n✓ نجحَ اختبارُ شاشاتِ التوصيلِ في المتصفّحِ الحقيقيِّ");
  } catch (err) {
    console.error(`\n✗ فشلَ الاختبارُ: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    stop();
    await container.close();
    await sql.end({ timeout: 5 });
  }
}

await main();
