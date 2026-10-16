/**
 * الغرض: ضبطُ سطحِ البوتِ (`BOT_SURFACE_MODE` · `MINIAPP_URL`) — `ADR 0213` · `ADR 0286`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { tryLoadConfig } from "../../packages/shared/config/index.ts";

function baseSource(
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> {
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
    RUN_WORKER_IN_GATEWAY: "false",
    RUN_ADMIN_IN_GATEWAY: "false",
    ...overrides,
  };
}

describe("ADR 0213 · ADR 0286: ضبطُ سطحِ البوتِ", () => {
  it("الغيابُ ⇒ miniapp — وهو سطحُ المنتجِ الوحيدَ في التشغيلِ الفعليّ", () => {
    const result = tryLoadConfig(baseSource({ MINIAPP_URL: "https://app.example.com" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.botSurfaceMode).toBe("miniapp");
      expect(result.value.miniAppUrl).toBe("https://app.example.com/");
    }
  });

  it("الغيابُ بلا MINIAPP_URL ⇒ فشلُ إقلاعٍ صريحٌ لا سقوطٌ صامتٌ إلى legacy", () => {
    const result = tryLoadConfig(baseSource({}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("MINIAPP_URL");
  });

  it("legacy بلا علمٍ صريحٍ ⇒ مرفوضٌ حتى خارجَ الإنتاجِ — لا عودةً بالسهو", () => {
    const result = tryLoadConfig(
      baseSource({ BOT_SURFACE_MODE: "legacy", MINIAPP_URL: "https://app.example.com" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("ADR 0286");
  });

  it("legacy بعلمٍ صريحٍ خارجَ الإنتاجِ ⇒ مسارُ اختبارِ توافقٍ معزولٌ مقبول", () => {
    const result = tryLoadConfig(
      baseSource({
        BOT_SURFACE_MODE: "legacy",
        BOT_SURFACE_TEST_LEGACY: "1",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.botSurfaceMode).toBe("legacy");
  });

  it("legacy في الإنتاجِ ⇒ مرفوضٌ رفضاً قاطعاً ولو مع العلمِ الصريح", () => {
    const result = tryLoadConfig(
      baseSource({
        NODE_ENV: "production",
        TELEGRAM_TRANSPORT: "real",
        // جلساتُ redis سليمةٌ عمداً — ليكونَ الرفضُ عن سطحِ البوتِ وحدَه لا عن غيرِه.
        SESSION_STORE: "redis",
        BOT_SURFACE_MODE: "legacy",
        BOT_SURFACE_TEST_LEGACY: "1",
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("BOT_SURFACE_MODE");
      expect(result.error.message).toContain("الإنتاج");
    }
  });

  it("miniapp + رابطُ https ⇒ مقبولٌ ويُطبَّعُ", () => {
    const result = tryLoadConfig(
      baseSource({ BOT_SURFACE_MODE: "miniapp", MINIAPP_URL: "https://app.example.com" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.botSurfaceMode).toBe("miniapp");
      expect(result.value.miniAppUrl).toBe("https://app.example.com/");
    }
  });

  it("miniapp بلا MINIAPP_URL ⇒ فشلُ إقلاعٍ صريحٌ", () => {
    const result = tryLoadConfig(baseSource({ BOT_SURFACE_MODE: "miniapp" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("MINIAPP_URL");
  });

  it("رابطٌ بغيرِ https ⇒ مرفوضٌ: تيليجرامُ يُسقِطُ الرسالةَ كلَّها", () => {
    const result = tryLoadConfig(
      baseSource({ BOT_SURFACE_MODE: "miniapp", MINIAPP_URL: "http://app.example.com" }),
    );
    expect(result.ok).toBe(false);
  });

  it("وضعٌ مجهولٌ ⇒ مرفوضٌ بالمتاحِ", () => {
    const result = tryLoadConfig(
      baseSource({ BOT_SURFACE_MODE: "hybrid", MINIAPP_URL: "https://app.example.com" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("BOT_SURFACE_MODE");
  });
});
