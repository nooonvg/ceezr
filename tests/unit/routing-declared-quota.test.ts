import { afterEach, describe, expect, it } from "bun:test";

/**
 * `REQ-09` (الشقُّ المملوكُ للمستودَعِ) · `ADR 0190` — حدُّ معدّلِ مزوّدِ التوجيهِ
 * **المُعلَنُ في عقدِ الحسابِ** يُفرَضُ عندَنا قبلَ أن يُرسَلَ الطلبُ.
 *
 * المقيسُ: الضبطُ يرفضُ صيغةً فاسدةً ويُلزِمُ الحدَّ في الإنتاجِ؛ والمزوّدُ لا يبلغُ
 * الشبكةَ فوقَ الحدِّ؛ والمحاولةُ الثانيةُ تُحتسَبُ طلباً؛ و`quota_exhausted` لا
 * يُعادُ؛ وإصابةُ الذاكرةِ المؤقّتةِ لا تستهلكُ؛ والحاويةُ تُركِّبُ الحدَّ فعلاً.
 * وما لا يُقاسُ: حدٌّ حقيقيٌّ لمزوّدٍ حقيقيٍّ — لا حسابَ بعدُ (`REQ-09` يبقى `[!]`).
 */

import { buildContainer } from "../../apps/gateway/src/container.ts";
import { createMemoryRateLimiter } from "../../apps/gateway/src/rate-limit/fixed-window.ts";
import { CachedRoutingProvider } from "../../packages/application/tracking/cached-routing-provider.ts";
import {
  deservesRoutingRetry,
  type RoutingQuota,
} from "../../packages/maps/core/routing-provider.ts";
import { createOsrmProvider } from "../../packages/maps/providers/osrm/osrm-provider.ts";
import { parseRoutingRateLimit, tryLoadConfig } from "../../packages/shared/config/index.ts";
import { testConfig } from "../support/config.ts";

const ORIGIN = { lat: 21.4858, lng: 39.1925 };
const DEST = { lat: 21.6, lng: 39.15 };
const OK_ROUTE = {
  code: "Ok",
  routes: [{ distance: 12000, duration: 900, geometry: { coordinates: [[39.19, 21.48]] } }],
};
const noSleep = async (): Promise<void> => {};

function countingFetch(status = 200): { impl: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (async () => {
    calls += 1;
    return status === 200
      ? new Response(JSON.stringify(OK_ROUTE), { status: 200 })
      : new Response("down", { status });
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

/** حصّةٌ تعدُّ الاستشاراتِ وتسمحُ بـ`allow` منها. */
function countingQuota(allow: number): RoutingQuota & { hits: () => number } {
  let hits = 0;
  return {
    hit: async () => {
      hits += 1;
      return { allowed: hits <= allow, resetSeconds: 7 };
    },
    hits: () => hits,
  };
}

function baseSource(overrides: Record<string, string | undefined>) {
  return {
    NODE_ENV: "development",
    PORT: "3000",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    DATABASE_URL: "postgres://localhost/test",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    DRIVER_BOT_TOKEN: "123456:driver",
    RIDER_BOT_TOKEN: "654321:rider",
    TELEGRAM_WEBHOOK_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789abcd",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "123456789",
    MINIAPP_URL: "https://app.example.com",
    RUN_WORKER_IN_GATEWAY: "false",
    RUN_ADMIN_IN_GATEWAY: "false",
    SESSION_STORE: "redis",
    ...overrides,
  };
}

describe("REQ-09: صيغةُ الحدِّ المُعلَنِ", () => {
  it("يقبلُ <طلبات>/<ثوانٍ> ويقرأُه أرقاماً", () => {
    expect(parseRoutingRateLimit("50/1")).toEqual({ calls: 50, windowSeconds: 1 });
    expect(parseRoutingRateLimit(" 600/60 ")).toEqual({ calls: 600, windowSeconds: 60 });
  });

  it("سوالبُ مزروعةٌ (ح-7): كلُّ صيغةٍ فاسدةٍ تُرفَضُ نصّاً", () => {
    for (const raw of [
      "50",
      "50/",
      "/1",
      "0/1",
      "50/0",
      "-1/1",
      "1.5/1",
      "50/61",
      "10001/1",
      "a/b",
    ]) {
      expect(typeof parseRoutingRateLimit(raw)).toBe("string");
    }
  });

  it("صيغةٌ فاسدةٌ تمنعُ الإقلاعَ بمفتاحِها", () => {
    const result = tryLoadConfig(baseSource({ ROUTING_RATE_LIMIT: "fifty" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty("key", "ROUTING_RATE_LIMIT");
  });

  it("الإنتاجُ + مزوّدُ توجيهٍ بلا حدٍّ مُعلَنٍ ⇒ لا إقلاعَ", () => {
    const result = tryLoadConfig(
      baseSource({
        NODE_ENV: "production",
        ROUTING_PROVIDER: "osrm",
        OSRM_BASE_URL: "http://osrm.internal:5000",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty("key", "ROUTING_RATE_LIMIT");
  });

  it("الإنتاجُ + مزوّدٌ + حدٌّ ⇒ إقلاعٌ؛ والإنتاجُ بلا مزوّدٍ لا يُلزَمُ بحدٍّ", () => {
    const withLimit = tryLoadConfig(
      baseSource({
        NODE_ENV: "production",
        ROUTING_PROVIDER: "osrm",
        OSRM_BASE_URL: "http://osrm.internal:5000",
        ROUTING_RATE_LIMIT: "50/1",
      }),
    );
    expect(withLimit.ok).toBe(true);
    if (withLimit.ok)
      expect(withLimit.value.routingRateLimit).toEqual({ calls: 50, windowSeconds: 1 });
    const none = tryLoadConfig(baseSource({ NODE_ENV: "production" }));
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value.routingRateLimit).toBeNull();
  });
});

describe("REQ-09: الحدُّ قبلَ الشبكةِ", () => {
  it("فوقَ الحدِّ لا يبلغُ الطلبُ الشبكةَ، والصنفُ quota_exhausted", async () => {
    const f = countingFetch();
    const quota = countingQuota(1);
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
      quota,
    });
    expect((await provider.route({ origin: ORIGIN, destination: DEST })).ok).toBe(true);
    const refused = await provider.route({ origin: ORIGIN, destination: DEST });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe("quota_exhausted");
    expect(f.calls()).toBe(1);
  });

  it("المحاولةُ الثانيةُ طلبٌ مُفوتَرٌ فتُحتسَبُ", async () => {
    const f = countingFetch(503);
    const quota = countingQuota(10);
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
      quota,
    });
    await provider.route({ origin: ORIGIN, destination: DEST });
    expect(f.calls()).toBe(2);
    expect(quota.hits()).toBe(2);
  });

  it("الرفضُ لا يُعادُ: محاولةٌ ثانيةٌ فوقَ الحدِّ لا تُرسَلُ", async () => {
    const f = countingFetch(503);
    const quota = countingQuota(1);
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      sleepImpl: noSleep,
      quota,
    });
    const r = await provider.route({ origin: ORIGIN, destination: DEST });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("quota_exhausted");
    expect(f.calls()).toBe(1);
    expect(deservesRoutingRetry("quota_exhausted")).toBe(false);
  });

  it("إصابةُ الذاكرةِ المؤقّتةِ لا تستهلكُ حصّةً", async () => {
    const f = countingFetch();
    const quota = countingQuota(1);
    const cached = new CachedRoutingProvider(
      createOsrmProvider({ baseUrl: "http://osrm.invalid", fetchImpl: f.impl, quota }),
    );
    for (let i = 0; i < 5; i++) {
      expect((await cached.route({ origin: ORIGIN, destination: DEST })).ok).toBe(true);
    }
    expect(quota.hits()).toBe(1);
  });

  it("حدُّ البوّابةِ نفسُه (ذاكرةٌ) يُمرَّرُ بنيويّاً ويفرضُ النافذةَ", async () => {
    const f = countingFetch();
    const provider = createOsrmProvider({
      baseUrl: "http://osrm.invalid",
      fetchImpl: f.impl,
      quota: createMemoryRateLimiter({ limit: 2, windowSeconds: 60 }),
    });
    const kinds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await provider.route({ origin: { lat: 21 + i / 100, lng: 39 }, destination: DEST });
      kinds.push(r.ok ? "ok" : r.error.kind);
    }
    expect(kinds).toEqual(["ok", "ok", "quota_exhausted", "quota_exhausted"]);
    expect(f.calls()).toBe(2);
  });
});

describe("REQ-09: الحاويةُ تُركِّبُ الحدَّ المُعلَنَ", () => {
  const originalFetch = globalThis.fetch;
  const originalOsrm = process.env.OSRM_BASE_URL;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalOsrm === undefined) delete process.env.OSRM_BASE_URL;
    else process.env.OSRM_BASE_URL = originalOsrm;
  });

  async function networkCallsFor(
    routingRateLimit: { calls: number; windowSeconds: number } | null,
  ) {
    const baseUrl = "http://osrm.test.invalid:5000";
    process.env.OSRM_BASE_URL = baseUrl;
    const f = countingFetch();
    globalThis.fetch = f.impl;
    const container = buildContainer(
      testConfig({ routingProvider: "osrm", osrmBaseUrl: baseUrl, routingRateLimit }),
    );
    if (container.routing === null) throw new Error("routing غيرُ مُركَّبٍ");
    for (let i = 0; i < 3; i++) {
      await container.routing.route({ origin: { lat: 21 + i / 100, lng: 39 }, destination: DEST });
    }
    return f.calls();
  }

  it("حدٌّ مُعلَنٌ بطلبٍ واحدٍ ⇒ طلبٌ واحدٌ يبلغُ الشبكةَ من ثلاثةِ مساراتٍ مختلفةٍ", async () => {
    expect(await networkCallsFor({ calls: 1, windowSeconds: 60 })).toBe(1);
  });

  it("سالبةٌ مزروعةٌ: بلا حدٍّ تبلغُ الثلاثةُ الشبكةَ — فالقياسُ يُفرِّقُ", async () => {
    expect(await networkCallsFor(null)).toBe(3);
  });
});
