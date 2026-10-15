import { describe, expect, it } from "bun:test";
import { tryLoadConfig } from "../../packages/shared/config/index.ts";

/**
 * SCL-002 — مخزنُ الجلساتِ في الذاكرةِ مرفوضٌ في الإنتاج.
 *
 * جلساتُ الذاكرةِ تُمحى بإعادةِ التشغيلِ ولا تُشارَكُ بينَ النسخِ ولا تحملُ CAS
 * (BUG-007). فالسماحُ بها في الإنتاجِ يُخفي عطلاً صامتاً. هنا يُثبَت أنَّ الإقلاعَ
 * يفشلُ صريحاً عندَ `SESSION_STORE=memory` (أو عندَ غيابِها فتفترضُ memory) في
 * الإنتاج، بينما تبقى مسموحةً في التطويرِ والاختبار.
 */

/** مصدرُ بيئةٍ كاملٌ صالحٌ لكلِّ التحقّقاتِ، يُعدَّلُ بحسبَ الحالةِ. */
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
    // ٤٠ محرفاً أبجديّاً رقميّاً: يُجيز تحقّقَ الإنتاجِ (طولٌ ≥٣٢ ومجموعةُ المحارفِ).
    TELEGRAM_WEBHOOK_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789abcd",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "123456789",
    MINIAPP_URL: "https://app.example.com",
    // F5-04 / ADR 0063: إعلانٌ إلزاميٌّ في الإنتاج — يُعلَن في الأساسِ كي يبقى
    // المُختبَرُ ههنا مخزنَ الجلساتِ وحدَه لا شرطَين معاً.
    RUN_WORKER_IN_GATEWAY: "false",
    // `F5-08` / ADR 0064: إعلانٌ إلزاميٌّ في الإنتاجِ كسابقِه. ويُعلَنُ في الأساسِ
    // لا في كلِّ حالةٍ — وقياسُ الغيابِ موضعُهُ `config-admin-placement.test.ts` وحدَه.
    RUN_ADMIN_IN_GATEWAY: "false",
    ...overrides,
  };
}

describe("SCL-002: رفضُ مخزنِّ الجلساتِ في الذاكرةِ في الإنتاج", () => {
  it("الإنتاجُ + SESSION_STORE=memory ⇒ فشلُ إقلاعٍ صريح", () => {
    const result = tryLoadConfig(baseSource({ NODE_ENV: "production", SESSION_STORE: "memory" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe("InvalidEnvVarError");
      expect(result.error.message).toContain("SESSION_STORE");
      expect(result.error.message).toContain("redis");
    }
  });

  it("الإنتاجُ + غيابُ SESSION_STORE (يفترضُ memory) ⇒ فشلُ إقلاعٍ", () => {
    const source = baseSource({ NODE_ENV: "production" });
    delete source.SESSION_STORE;
    const result = tryLoadConfig(source);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.name).toBe("InvalidEnvVarError");
      expect(result.error.message).toContain("redis");
    }
  });

  it("الإنتاجُ + SESSION_STORE=redis ⇒ إقلاعٌ ناجح", () => {
    const result = tryLoadConfig(baseSource({ NODE_ENV: "production", SESSION_STORE: "redis" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessionStore).toBe("redis");
  });

  it("التطويرُ + SESSION_STORE=memory ⇒ مسموحٌ", () => {
    const result = tryLoadConfig(baseSource({ NODE_ENV: "development", SESSION_STORE: "memory" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessionStore).toBe("memory");
  });

  it("الاختبارُ + SESSION_STORE=memory ⇒ مسموحٌ (بيئةُ CI تستعملُ الذاكرةَ)", () => {
    const result = tryLoadConfig(baseSource({ NODE_ENV: "test", SESSION_STORE: "memory" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessionStore).toBe("memory");
  });

  it("التطويرُ + غيابُ SESSION_STORE ⇒ memory افتراضياً (مسموحٌ خارجَ الإنتاج)", () => {
    const source = baseSource({ NODE_ENV: "development" });
    delete source.SESSION_STORE;
    const result = tryLoadConfig(source);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.sessionStore).toBe("memory");
  });
});
