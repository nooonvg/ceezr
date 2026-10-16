/**
 * الغرض: إثباتُ أنّ موضعَ المهامِّ الدوريّةِ صار **إعلاناً إلزاميّاً في الإنتاجِ**
 *   لا افتراضاً صامتاً — `F5-04` / `SCL-007` · ADR 0063. والمُختبَرُ حكمُ المحمِّلِ
 *   نفسُه: الغيابُ سقوطٌ، والقيمةُ التي لا تُفهَم سقوطٌ، والإعلانُ الصريحُ يُقرأ
 *   كما كُتِب، وغيرُ الإنتاجِ يبقى على افتراضِه القديمِ `true`.
 * الحالة: منفّذ فعلياً — أُضيف مع `F5-04`.
 * ينتمي إلى: tests/unit
 * يُستخدم في: `bun run test` · وظيفةُ `verify` في CI.
 * ملاحظات مستقبلية: هذا الملفُّ هو **الموضعُ الوحيدُ** الذي يُقاس فيه غيابُ
 *   `RUN_WORKER_IN_GATEWAY`؛ وبقيّةُ ثوابتِ الاختبارِ تُعلنه في أساسِها كي يبقى
 *   كلُّ ملفٍّ يقيس ما كُتِب له.
 *
 * ## ولمَ اختبارٌ مستقلٌّ لمتغيّرٍ منطقيٍّ واحد
 *
 * لأنّ الحكمَ عليه **استثناءٌ مُعلَن** من قاعدةِ `parseBooleanEnv` العامّةِ (ردُّ
 * المجهولِ إلى الافتراضِ صامتاً). واستثناءٌ بلا اختبارٍ يُلغى في أوّلِ تبسيطٍ:
 * يقرأ قارئٌ أنّ المتغيّرَ منطقيٌّ فيُوحِّده مع البقيّةِ، فيعود العطلُ الذي كلّف
 * الإنتاجَ توقّفاً تامّاً صامتاً (`docs/directive-item-0-live-diagnosis.md` §0.2).
 */

import { describe, expect, it } from "bun:test";
import { BOOLEAN_ENV_LITERALS, tryLoadConfig } from "../../packages/shared/config/index.ts";

/** مصدرُ بيئةٍ كاملٌ صالحٌ في الإنتاجِ **إلا** من موضعِ المهامِّ — يُضاف في كلِّ حالةٍ. */
function productionSourceWithout(): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    PORT: "3000",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    DATABASE_URL: "postgres://user:pass@db.example.co:5432/postgres",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    DRIVER_BOT_TOKEN: "123456:driver",
    RIDER_BOT_TOKEN: "654321:rider",
    TELEGRAM_WEBHOOK_SECRET: "abcdefghijklmnopqrstuvwxyz0123456789abcd",
    BOOTSTRAP_ADMIN_TELEGRAM_ID: "123456789",
    // SCL-002: الإنتاجُ يرفض `memory` — يُعلَن كي يقع السقوطُ على المُختبَرِ لا على غيرِه.
    SESSION_STORE: "redis",
    // `F5-08` / ADR 0064: إعلانٌ إلزاميٌّ آخرُ في الإنتاجِ، يُعلَن ههنا لنفسِ السببِ
    // حرفاً — وإلّا وقعَ سقوطُ كلِّ حالةٍ عليهِ لا على موضعِ المهامِّ المُختبَرِ.
    // (اسمُ الدالّةِ «بلا» يعني بلا `RUN_WORKER_IN_GATEWAY` وحدَه.)
    RUN_ADMIN_IN_GATEWAY: "false",
    // `ADR 0286` — عنوانُ التطبيقِ شرطُ إقلاعِ سطحِ miniapp الافتراضيِّ، فيُعلَن هنا
    // لنفسِ سببِ بقيةِ الإعلاناتِ: ليقعَ السقوطُ على المُختبَرِ وحدَهُ لا على غيرِهِ.
    MINIAPP_URL: "https://app.example.com",
  };
}

const production = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({ ...productionSourceWithout(), ...overrides });

describe("موضعُ المهامِّ الدوريّةِ في الإنتاج — F5-04 / SCL-007 · ADR 0063", () => {
  /**
   * الحالُ التي كانت تعمل قبلَ هذه المرحلةِ فصارت سقوطاً: بيئةٌ إنتاجيّةٌ كاملةٌ
   * ساكتةٌ عن موضعِ المهامِّ. والسكوتُ كان يُقرأ `true` — أي بوّابةً تُشغِّل
   * المهامَّ من حيث لا يعلم مَن نشرَها، وهو عينُ `SCL-007`.
   */
  it("الإنتاجُ + غيابُ الإعلانِ ⇒ فشلُ إقلاعٍ صريحٌ لا افتراضٌ", () => {
    const result = tryLoadConfig(productionSourceWithout());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
    if (result.error.code !== "INVALID_ENV_VAR") return;
    expect(result.error.key).toBe("RUN_WORKER_IN_GATEWAY");
  });

  /** قيمةٌ فارغةٌ أو مسافاتٌ ليست إعلاناً: كُتِب شيءٌ لا يُقرأ منه قرارٌ. */
  it("الإنتاجُ + قيمةٌ فارغةٌ أو مسافاتٌ ⇒ فشلُ إقلاعٍ كذلك", () => {
    for (const blank of ["", "   "]) {
      const result = tryLoadConfig(production({ RUN_WORKER_IN_GATEWAY: blank }));
      expect(result.ok).toBe(false);
    }
  });

  /**
   * الخطأُ الإملائيُّ هو الحالةُ الواقعيّةُ لا المُتخيَّلة: `fasle` كانت تُقرأ
   * `true` صامتةً، فيعمل النظامُ في غيرِ الموضعِ الذي ضُبِط — والقفلُ الموزَّعُ
   * يُخفي الأثرَ فلا سجلَّ يشكو.
   */
  it("الإنتاجُ + قيمةٌ لا تُفهَم ⇒ فشلُ إقلاعٍ ولا تُردُّ إلى الافتراضِ", () => {
    for (const typo of ["fasle", "ture", "maybe", "2"]) {
      const result = tryLoadConfig(production({ RUN_WORKER_IN_GATEWAY: typo }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      if (result.error.code !== "INVALID_ENV_VAR") continue;
      expect(result.error.key).toBe("RUN_WORKER_IN_GATEWAY");
    }
  });

  /** رسالةُ الخطأِ تذكر المفهومَ: مشغّلٌ يُخمِّن أسوأُ من مشغّلٍ يُخطئ. */
  it("رسالةُ الرفضِ تذكر الحروفَ المقبولةَ لا «قيمةٌ غيرُ صالحةٍ» وحدَها", () => {
    const result = tryLoadConfig(production({ RUN_WORKER_IN_GATEWAY: "fasle" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("true");
    expect(result.error.message).toContain("false");
  });

  it("الإنتاجُ + false صريحةٌ ⇒ إقلاعٌ ناجحٌ والمهامُّ خارجَ البوّابةِ", () => {
    const result = tryLoadConfig(production({ RUN_WORKER_IN_GATEWAY: "false" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(false);
  });

  /**
   * الإدماجُ يبقى حالاً مشروعةً في الإنتاجِ: مَن لا يملك خدمةَ عاملٍ أفضلُ له أن
   * يُشغِّل المهامَّ في البوّابةِ من ألّا يُشغِّلها. المرفوضُ السكوتُ لا الإدماجُ.
   */
  it("الإنتاجُ + true صريحةٌ ⇒ إقلاعٌ ناجحٌ — الإدماجُ خيارٌ لا خرقٌ", () => {
    const result = tryLoadConfig(production({ RUN_WORKER_IN_GATEWAY: "true" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(true);
  });

  /** كلُّ حرفٍ في القائمةِ المُعلَنةِ مقبولٌ فعلاً — لا قائمةً تُعلَن ولا تُنفَّذ. */
  it("كلُّ حرفٍ في القائمةِ المُعلَنةِ يُقلع، وحالةُ الأحرفِ والفراغُ لا يُفسدانِه", () => {
    for (const literal of BOOLEAN_ENV_LITERALS) {
      const result = tryLoadConfig(
        production({ RUN_WORKER_IN_GATEWAY: `  ${literal.toUpperCase()}  ` }),
      );
      expect(result.ok).toBe(true);
    }
  });

  /**
   * والقيمةُ المقروءةُ هي المكتوبةُ لا الافتراضُ: مطابقةُ الحرفِ بمعناه تمنع
   * حالاً تُقلع فيها الخدمةُ وتعمل المهامُّ في غيرِ موضعِها.
   */
  it("معنى كلِّ حرفٍ يُقرأ كما هو لا كما يُفترَض", () => {
    const truthy = ["true", "1", "yes", "on"];
    for (const literal of BOOLEAN_ENV_LITERALS) {
      const result = tryLoadConfig(production({ RUN_WORKER_IN_GATEWAY: literal }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.runWorkerInGateway).toBe(truthy.includes(literal));
    }
  });
});

describe("وغيرُ الإنتاجِ يبقى على افتراضِه — طبقتانِ لهما قاعدتانِ عن قصدٍ", () => {
  /**
   * مَن يُشغِّل المستودعَ على حاسبِه ليس له خدمةُ عاملٍ ثانيةٌ، ونظامٌ بلا مهامَّ
   * دوريّةٍ في التطويرِ يُخفي أخطاءً لا تُرى إلا في الإنتاجِ. فالإلزامُ إنتاجيٌّ
   * عن قصدٍ، لا سهواً عن بقيّةِ البيئاتِ.
   */
  it("التطويرُ + غيابُ الإعلانِ ⇒ إقلاعٌ ناجحٌ بالافتراضِ true", () => {
    const result = tryLoadConfig(production({ NODE_ENV: "development" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(true);
  });

  it("الاختبارُ + قيمةٌ لا تُفهَم ⇒ تُردُّ إلى الافتراضِ ولا تمنع الإقلاعَ", () => {
    const result = tryLoadConfig(production({ NODE_ENV: "test", RUN_WORKER_IN_GATEWAY: "fasle" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(true);
  });

  it("والإعلانُ الصريحُ في التطويرِ يُقرأ كما كُتِب", () => {
    const result = tryLoadConfig(
      production({ NODE_ENV: "development", RUN_WORKER_IN_GATEWAY: "false" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runWorkerInGateway).toBe(false);
  });
});
