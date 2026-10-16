/**
 * الغرض: إثباتُ أنّ موضعَ **سطحِ لوحةِ الإدارةِ** صار إعلاناً إلزاميّاً في الإنتاجِ
 *   لا افتراضاً صامتاً — `F5-08` / `ARCH-011` · ADR 0064. والمُختبَرُ حكمُ المحمِّلِ
 *   نفسِه: الغيابُ سقوطٌ، والقيمةُ التي لا تُفهَم سقوطٌ، والإعلانُ الصريحُ يُقرأ
 *   كما كُتِب، وغيرُ الإنتاجِ يبقى على افتراضِه القديمِ `true`.
 * الحالة: منفّذ فعلياً — أُضيف مع `F5-08`.
 * ينتمي إلى: tests/unit
 * يُستخدم في: `bun run test` · وظيفةُ `verify` في CI.
 * ملاحظات مستقبلية: هذا الملفُّ هو **الموضعُ الوحيدُ** الذي يُقاس فيه غيابُ
 *   `RUN_ADMIN_IN_GATEWAY`؛ وبقيّةُ ثوابتِ الاختبارِ تُعلنه في أساسِها كي يبقى
 *   كلُّ ملفٍّ يقيس ما كُتِب له.
 *
 * ## ولمَ ملفٌّ ثانٍ بجانبِ `config-worker-placement.test.ts`
 *
 * لأنّ الحكمَين **ليسا نظيرَين وإن تشابهت مِيكانيكاهما**، والخلطُ بينهما هو الخطرُ:
 * غيابُ إعلانِ المهامِّ يُنتِج — إن فُسِّر افتراضاً — توقّفاً تامّاً صاخبَ الأثرِ.
 * وغيابُ إعلانِ اللوحةِ يُنتِج لوحةً تعمل من موضعَين **ولا شيءَ يُخفِق**. فملفٌّ
 * واحدٌ يجمعهما كان سيُقرأ «متغيّرانِ منطقيّانِ متشابهانِ» فيُوحَّدُ حكمُهما، وهو
 * أوّلُ خطوةٍ إلى إعادةِ أحدِهما إلى `parseBooleanEnv` العامّةِ.
 */

import { describe, expect, it } from "bun:test";
import { BOOLEAN_ENV_LITERALS, tryLoadConfig } from "../../packages/shared/config/index.ts";

/** مصدرُ بيئةٍ كاملٌ صالحٌ في الإنتاجِ **إلا** من موضعِ اللوحةِ — يُضاف في كلِّ حالةٍ. */
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
    SESSION_STORE: "redis",
    // موضعُ المهامِّ يُعلَن ههنا كي يقع السقوطُ على المُختبَرِ لا على غيرِه
    // (ADR 0063) — والعكسُ مفعولٌ في `config-worker-placement.test.ts`.
    RUN_WORKER_IN_GATEWAY: "false",
    // `ADR 0286` — عنوانُ التطبيقِ شرطُ إقلاعِ سطحِ miniapp الافتراضيِّ.
    MINIAPP_URL: "https://app.example.com",
  };
}

const production = (
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({ ...productionSourceWithout(), ...overrides });

describe("موضعُ سطحِ لوحةِ الإدارةِ في الإنتاج — F5-08 / ARCH-011 · ADR 0064", () => {
  /**
   * الحالُ التي كانت تعمل قبلَ هذه المرحلةِ فصارت سقوطاً: بيئةٌ إنتاجيّةٌ كاملةٌ
   * ساكتةٌ عن موضعِ اللوحةِ. والسكوتُ كان يُقرأ `true` — أي بوّابةً تُخدّم سطحَ
   * الإدارةِ من حيث لا يعلم مَن نشرَها، ومعها خدمةُ لوحةٍ تُخدّمه أيضاً.
   */
  it("الإنتاجُ + غيابُ الإعلانِ ⇒ فشلُ إقلاعٍ صريحٌ لا افتراضٌ", () => {
    const result = tryLoadConfig(productionSourceWithout());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
    if (result.error.code !== "INVALID_ENV_VAR") return;
    expect(result.error.key).toBe("RUN_ADMIN_IN_GATEWAY");
  });

  /**
   * رسالةُ الغيابِ تُسمّي **متى تُضبَط كلُّ قيمةٍ**، لا تكتفي بالرفضِ ولا بسردِ
   * الحروفِ. لأنّ مَن يقرأُها في سجلِّ إقلاعٍ فاشلٍ لا يعرف الجوابَ أصلاً: رسالةٌ
   * تقول «المتاح true · false» تُصلَح بنقشِ إحداهما عشواءً — فيُقلعُ النظامُ
   * ويبقى الخرقُ. فتُسمّي الخدمةَ بالاسمِ، وتُسمّي الخرقَ الصامتَ بأثرِه.
   */
  it("رسالةُ الغيابِ تُسمّي شرطَ كلِّ قيمةٍ لا الحروفَ وحدَها", () => {
    const result = tryLoadConfig(productionSourceWithout());
    if (result.ok) return;
    if (result.error.code !== "INVALID_ENV_VAR") return;
    expect(result.error.message).toContain("false");
    expect(result.error.message).toContain("true");
    expect(result.error.message).toContain("waslah-admin");
    expect(result.error.message).toContain("ADR 0064");
  });

  /** والقيمةُ المبطَلةُ رسالتُها **أخرى**: ههنا تُسرَد الحروفُ لأنّ السؤالَ صار «ماذا يُفهَم». */
  it("رسالةُ البطلانِ تسرد كلَّ حرفٍ صالحٍ", () => {
    const result = tryLoadConfig(production({ RUN_ADMIN_IN_GATEWAY: "perhaps" }));
    if (result.ok) return;
    if (result.error.code !== "INVALID_ENV_VAR") return;
    for (const literal of BOOLEAN_ENV_LITERALS) {
      expect(result.error.message).toContain(literal);
    }
  });

  it("قيمةٌ لا تُفهَم ⇒ سقوطٌ، ولا تُردُّ إلى الافتراضِ", () => {
    const result = tryLoadConfig(production({ RUN_ADMIN_IN_GATEWAY: "fasle" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== "INVALID_ENV_VAR") return;
    expect(result.error.key).toBe("RUN_ADMIN_IN_GATEWAY");
  });

  it("كلُّ حرفٍ صالحٍ يُقرأ كما كُتِب لا كما يُظنُّ", () => {
    for (const literal of BOOLEAN_ENV_LITERALS) {
      const result = tryLoadConfig(production({ RUN_ADMIN_IN_GATEWAY: literal }));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const expected = !["false", "0", "no", "off"].includes(literal.toLowerCase());
      expect(result.value.runAdminInGateway).toBe(expected);
    }
  });

  /**
   * غيرُ الإنتاجِ يبقى على `true`: بيئةُ تطويرٍ تُقلع بعمليّةٍ واحدةٍ تُخدّم كلَّ
   * شيءٍ، وإلزامُها بالإعلانِ كان سيُوجِب سطراً في كلِّ `.env` محلّيٍّ لأجلِ حكمٍ
   * لا يخصُّ إلّا النشرَ. والإنتاجُ وحدَه هو موضعُ الخطرِ لأنّه موضعُ الخدمتَين.
   */
  it("غيرُ الإنتاجِ: الغيابُ يبقى افتراضاً true لا سقوطاً", () => {
    const result = tryLoadConfig({
      ...productionSourceWithout(),
      NODE_ENV: "development",
      SESSION_STORE: "memory",
      RUN_WORKER_IN_GATEWAY: undefined,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.runAdminInGateway).toBe(true);
  });

  /**
   * الإعلانانِ **مستقلّانِ**: قيمةُ أحدِهما لا تُشتقُّ من الآخرِ ولا تُقيَّد به.
   * ولو رُبِطا (مثلاً: «فصلُ العاملِ يعني فصلَ اللوحةِ») لصار قلبُ أحدِهما في
   * تراجعٍ طارئٍ يقلب الآخرَ بلا أن يُقصَد.
   */
  it("الموضعانِ مستقلّانِ: أربعُ تركيباتٍ كلُّها مقروءةٌ كما كُتِبت", () => {
    for (const worker of ["true", "false"]) {
      for (const admin of ["true", "false"]) {
        const result = tryLoadConfig(
          production({ RUN_WORKER_IN_GATEWAY: worker, RUN_ADMIN_IN_GATEWAY: admin }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        expect(result.value.runWorkerInGateway).toBe(worker === "true");
        expect(result.value.runAdminInGateway).toBe(admin === "true");
      }
    }
  });
});
