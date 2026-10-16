/**
 * الغرض: التحقّق من ضبطِ التجميعِ المركزيّ للمقاييس — البند F5-07 (SCL-006).
 * الحالة: منفّذ فعلياً — يفشل قبل حقلِ `metricsExport` في الضبط ويمرّ بعده.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديلٍ في تحليلِ METRICS_EXPORT_* أو في تحقّقِه
 * ملاحظات مستقبلية: إن صار المُجمِّعُ إلزاميّاً في الإنتاج يُعدَّل «الغيابُ إطفاءٌ» هنا.
 *
 * ولماذا هذا الملفُّ أصلاً؟ لثلاثةِ أخطاءٍ لا يكشفها الاستعمالُ السعيد:
 *  ١) أن يكون الغيابُ فشلَ إقلاعٍ — فلا يُنشَر النظامُ قبل أن يوجد مُجمِّع.
 *  ٢) أن تُقبَل نقطةٌ بـ`http://` في الإنتاج — فتسير أحجامُ الأعمالِ ورمزُ الاعتمادِ
 *     في العراء.
 *  ٣) أن تُطبَع قيمةُ ترويسةِ الاعتمادِ في رسالةِ خطأِ إقلاعٍ يقرؤها من لا يملكها.
 */

import { describe, expect, it } from "bun:test";
import { parseMetricsExportHeaders, tryLoadConfig } from "../../packages/shared/config/index.ts";

function baseSource(
  overrides: Record<string, string | undefined> = {},
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
    MINIAPP_URL: "https://app.example.com",
    // F5-04 / ADR 0063: إعلانٌ إلزاميٌّ في الإنتاج — يُعلَن في الأساسِ كي يبقى
    // المُختبَرُ ههنا ضبطَ تصديرِ المقاييسِ وحدَه.
    RUN_WORKER_IN_GATEWAY: "false",
    // `F5-08` / ADR 0064: إعلانٌ إلزاميٌّ في الإنتاجِ كسابقِه. ويُعلَنُ في الأساسِ
    // لا في كلِّ حالةٍ — وقياسُ الغيابِ موضعُهُ `config-admin-placement.test.ts` وحدَه.
    RUN_ADMIN_IN_GATEWAY: "false",
    ...overrides,
  };
}

const SECRET_VALUE = "Bearer super-secret-collector-token";

describe("parseMetricsExportHeaders", () => {
  it("يُحلّل مُدخَلاً واحداً ويُنزِل اسمَ الترويسة", () => {
    const result = parseMetricsExportHeaders("Authorization=Bearer abc");
    expect(result.ok).toBe(true);
    // الأسماءُ في HTTP غيرُ حسّاسةٍ لحالةِ الأحرف، وإنزالُها هنا يمنع إرسالَ
    // `Authorization` و`authorization` معاً حين يُدمَج مع ترويساتِنا الثابتة.
    if (result.ok) expect(result.value).toEqual({ authorization: "Bearer abc" });
  });

  it("يُحلّل عدّةَ مُدخَلاتٍ ويتجاهل الفراغَ بينها", () => {
    const result = parseMetricsExportHeaders(" a=1 , , b=2 ,");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: "1", b: "2" });
  });

  it("القيمةُ التي فيها `=` تبقى كاملةً: الفصلُ على أوّلِ علامةٍ لا على كلِّها", () => {
    // رموزُ Base64 تنتهي بـ`=` كثيراً، والفصلُ على كلِّ علامةٍ كان سيقصّ الرمزَ
    // فيُرفَض الدفعُ بـ401 بلا سببٍ ظاهرٍ في السجلّ.
    const result = parseMetricsExportHeaders("authorization=Basic dXNlcjpwYXNz==");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.authorization).toBe("Basic dXNlcjpwYXNz==");
  });

  it("نصٌّ فارغٌ ⇒ لا ترويسةَ ولا خطأ", () => {
    const result = parseMetricsExportHeaders("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it("مُدخَلٌ بلا علامةِ يساوٍ يُرفَض ولا تظهر قيمتُه في الخطأ", () => {
    const result = parseMetricsExportHeaders(SECRET_VALUE);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // يُقال **أيُّ** مُدخَلٍ أخطأ ليمكنَ الإصلاح، ولا يُقال **ما** كان فيه.
      expect(result.error).toContain("1");
      expect(result.error).not.toContain("super-secret-collector-token");
    }
  });

  it("اسمُ ترويسةٍ فيه محرفٌ غيرُ مسموحٍ يُرفَض بلا كشفِ القيمة", () => {
    const result = parseMetricsExportHeaders(`x auth=${SECRET_VALUE}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("super-secret-collector-token");
  });

  it("قيمةٌ فارغةٌ بعدَ العلامةِ تُرفَض", () => {
    expect(parseMetricsExportHeaders("authorization=").ok).toBe(false);
  });
});

describe("tryLoadConfig — metricsExport", () => {
  it("الغيابُ إطفاءٌ لا فشلُ إقلاع", () => {
    const result = tryLoadConfig(baseSource());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // لو كان الغيابُ فشلاً، لصار نشرُ النظامِ موقوفاً على وجودِ مُجمِّعٍ لم يُنشَأ
    // بعد. والنظامُ يعمل كاملاً بلا تجميعٍ مركزيّ — `GET /metrics` قائم.
    expect(result.value.metricsExport.endpoint).toBeNull();
    expect(result.value.metricsExport.headers).toEqual({});
    expect(result.value.metricsExport.intervalSeconds).toBe(15);
    expect(result.value.metricsExport.serviceInstanceId).toBeNull();
  });

  it("نقطةٌ صالحةٌ + ترويساتٌ + فاصلٌ ⇒ تُقرأ كما ضُبِطت", () => {
    const result = tryLoadConfig(
      baseSource({
        METRICS_EXPORT_ENDPOINT: " https://collector.example/v1/metrics ",
        METRICS_EXPORT_HEADERS: "authorization=Bearer abc,x-tenant=waslah",
        METRICS_EXPORT_INTERVAL_SECONDS: "30",
        SERVICE_INSTANCE_ID: " render-srv-abc-1 ",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.metricsExport.endpoint).toBe("https://collector.example/v1/metrics");
    expect(result.value.metricsExport.headers).toEqual({
      authorization: "Bearer abc",
      "x-tenant": "waslah",
    });
    expect(result.value.metricsExport.intervalSeconds).toBe(30);
    expect(result.value.metricsExport.serviceInstanceId).toBe("render-srv-abc-1");
  });

  it("نقطةٌ لا تبدأ بـhttp(s):// ⇒ فشلُ إقلاعٍ صريح", () => {
    const result = tryLoadConfig(
      baseSource({ METRICS_EXPORT_ENDPOINT: "collector.example/v1/metrics" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("METRICS_EXPORT_ENDPOINT");
  });

  it("http:// مسموحٌ في التطويرِ فالمُجمِّعُ قد يكون على المضيفِ نفسِه", () => {
    const result = tryLoadConfig(
      baseSource({ METRICS_EXPORT_ENDPOINT: "http://localhost:4318/v1/metrics" }),
    );
    expect(result.ok).toBe(true);
  });

  it("http:// مرفوضٌ في الإنتاج", () => {
    const result = tryLoadConfig(
      baseSource({
        NODE_ENV: "production",
        SESSION_STORE: "redis",
        METRICS_EXPORT_ENDPOINT: "http://collector.example/v1/metrics",
      }),
    );
    // الجسمُ يحمل أحجامَ الأعمالِ وأوقاتَ الذروةِ وعددَ السائقين، والترويسةُ تحمل
    // رمزَ اعتمادِ المُجمِّع. فنصٌّ صريحٌ في الإنتاج كشفٌ مزدوج.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("https://");
  });

  it("ترويسةٌ خاطئةُ الصيغةِ ⇒ فشلُ إقلاعٍ بلا كشفِ القيمةِ في الرسالة", () => {
    const result = tryLoadConfig(baseSource({ METRICS_EXPORT_HEADERS: SECRET_VALUE }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("METRICS_EXPORT_HEADERS");
      // رسالةُ الإقلاعِ تُطبَع في سجلِّ المنصّةِ الذي يقرؤه من لا يملك السرّ.
      expect(result.error.message).not.toContain("super-secret-collector-token");
    }
  });

  it("فاصلٌ غيرُ رقميٍّ أو خارجَ المدى ⇒ فشلُ إقلاع", () => {
    for (const value of ["abc", "0", "3601", "1.5", "-5"]) {
      const result = tryLoadConfig(baseSource({ METRICS_EXPORT_INTERVAL_SECONDS: value }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.message).toContain("METRICS_EXPORT_INTERVAL_SECONDS");
    }
  });

  it("طرفا المدى مقبولان", () => {
    for (const value of ["1", "3600"]) {
      const result = tryLoadConfig(baseSource({ METRICS_EXPORT_INTERVAL_SECONDS: value }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.metricsExport.intervalSeconds).toBe(Number(value));
    }
  });

  it("الفاصلُ يُتحقَّق منه حتى بلا نقطةٍ مضبوطة", () => {
    // ضبطٌ خاطئٌ يظهر يومَ يُضبَط لا يومَ يُوصَل المُجمِّعُ بعد أسابيع: أن يُقبَل
    // `abc` صامتاً اليومَ ثم يُسقِط الإقلاعَ حين تُضاف النقطةُ عطبٌ مؤجَّل.
    const result = tryLoadConfig(baseSource({ METRICS_EXPORT_INTERVAL_SECONDS: "abc" }));
    expect(result.ok).toBe(false);
  });
});
