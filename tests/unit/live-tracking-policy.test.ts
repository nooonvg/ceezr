/**
 * الغرضُ: `F2-06` — قياسُ الدعوى «**العميلُ لا يُعطى `lat/lng` حيّاً في الإنتاجِ**»
 *   حكماً مُفرَداً، لا بإقلاعِ خادمٍ ولا بمراجعةِ عينٍ.
 * ينتمي إلى: tests/unit
 * يحرسُ: `apps/gateway/src/realtime/live-tracking-policy.ts` ·
 *   شرطَ الإنتاجِ في `packages/shared/config/index.ts` (المسارُ الاحتياطيُّ).
 *
 * وسالباتُه مزروعةٌ (`ح-7`): لكلِّ قاعدةٍ حالةٌ **تُخفِقُ لو رُفِعَ الحدُّ**.
 */
import { describe, expect, it } from "bun:test";
import {
  isLiveLocationBroadcastPermitted,
  LIVE_TRACKING_FORBIDDEN_ENVS,
} from "../../apps/gateway/src/realtime/live-tracking-policy.ts";
import { tryLoadConfig } from "../../packages/shared/config/index.ts";

/** بيئةُ إنتاجٍ كاملةٌ صالحةٌ — مرجعُها `tests/unit/config-loading.test.ts`. */
const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(48),
  DATABASE_URL: "postgresql://u:p@localhost:5432/postgres",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "t".repeat(48),
  DRIVER_BOT_TOKEN: "111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  RIDER_BOT_TOKEN: "222:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  TELEGRAM_WEBHOOK_SECRET: "t".repeat(48),
  SESSION_SECRET: "s".repeat(48),
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "1",
  MINIAPP_URL: "https://app.example.com",
  SESSION_STORE: "redis",
  RUN_WORKER_IN_GATEWAY: "false",
  RUN_ADMIN_IN_GATEWAY: "false",
  PROCESS_TOPOLOGY: "single-process",
};

describe("F2-06 — لا تتبّعَ حيّاً في الإنتاجِ", () => {
  it("يمنعُ بثَّ الموقعِ في الإنتاجِ", () => {
    expect(isLiveLocationBroadcastPermitted("production")).toBe(false);
  });

  it("يُبقيه مسموحاً خارجَ الإنتاجِ كي يبقى مقيساً", () => {
    expect(isLiveLocationBroadcastPermitted("development")).toBe(true);
    expect(isLiveLocationBroadcastPermitted("test")).toBe(true);
  });

  it("والإنتاجُ مُعلَنٌ في قائمةِ المنعِ لا مسطوراً في الشرطِ", () => {
    expect(LIVE_TRACKING_FORBIDDEN_ENVS).toContain("production");
  });

  it("لا يُقلِعُ الإنتاجُ ومسارُ الاحتياطِ مُفعَّلٌ — البابُ الثاني مسدودٌ", () => {
    const result = tryLoadConfig({ ...PRODUCTION_ENV, LIVE_LOCATION_FALLBACK_ENABLED: "true" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("LIVE_LOCATION_FALLBACK_ENABLED");
    }
  });

  it("ويُقلِعُ الإنتاجُ ومسارُ الاحتياطِ مطفأٌ — فالمنعُ مُوجَّهٌ لا شاملٌ", () => {
    const off = tryLoadConfig({ ...PRODUCTION_ENV, LIVE_LOCATION_FALLBACK_ENABLED: "false" });
    expect(off.ok).toBe(true);
    const absent = tryLoadConfig(PRODUCTION_ENV);
    expect(absent.ok).toBe(true);
  });

  it("وغيرُ الإنتاجِ يقبلُ المسارَ الاحتياطيَّ — فالحدُّ حدُّ بيئةٍ", () => {
    const result = tryLoadConfig({
      ...PRODUCTION_ENV,
      NODE_ENV: "development",
      LIVE_LOCATION_FALLBACK_ENABLED: "true",
    });
    expect(result.ok).toBe(true);
  });
});
