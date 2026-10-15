/**
 * الغرض: التحقّق أن الإقلاع يرفض بيئة ناقصة ويسمّي كل النواقص لا أولها.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: أي متغير بيئة جديد يُضاف إلى REQUIRED_ENV_KEYS يسقط هذه الاختبارات إن نُسي.
 */
import { describe, expect, it } from "bun:test";
import {
  MIN_SESSION_SECRET_LENGTH,
  MIN_WEBHOOK_SECRET_LENGTH,
  missingEnvKeys,
  REQUIRED_ENV_KEYS,
  tryLoadConfig,
} from "../../packages/shared/config/index.ts";

const FULL: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.co",
  DATABASE_URL: "postgres://user:pass@db.project.supabase.co:5432/postgres",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  DRIVER_BOT_TOKEN: "driver-token",
  RIDER_BOT_TOKEN: "rider-token",
  // SCL-002: الإنتاجُ يرفضُ memory، فالثابتُ الكاملُ يستعملُ redis ليكونَ صالحاً
  // في كلِّ بيئةٍ (التطويرُ يسمحُ بالاثنين، والإنتاجُ يلزمُ redis).
  SESSION_STORE: "redis",
  // F5-04 / ADR 0063: الإنتاجُ يُلزم إعلانَ موضعِ المهامِّ الدوريّةِ صريحاً، فالثابتُ
  // الكاملُ يُعلنه ليبقى صالحاً في كلِّ بيئةٍ. وحكمُ الغيابِ نفسُه مُختبَرٌ في
  // `tests/unit/config-worker-placement.test.ts` — لا يُقاس ههنا ضمناً.
  RUN_WORKER_IN_GATEWAY: "false",
  // `F5-08` / ADR 0064: إعلانٌ إلزاميٌّ في الإنتاجِ كسابقِه. ويُعلَنُ في الأساسِ
  // لا في كلِّ حالةٍ — وقياسُ الغيابِ موضعُهُ `config-admin-placement.test.ts` وحدَه.
  RUN_ADMIN_IN_GATEWAY: "false",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  BOOTSTRAP_ADMIN_TELEGRAM_ID: "900000",
  MINIAPP_URL: "https://app.example.com",
};

describe("tryLoadConfig", () => {
  it("ينجح ببيئة كاملة ويستخدم المنفذ الافتراضي 3000", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(3000);
    expect(result.value.env).toBe("development");
    expect(result.value.supabaseUrl).toBe("https://project.supabase.co");
  });

  it("يجمع كل المتغيرات الناقصة في خطأ واحد", () => {
    const result = tryLoadConfig({ SUPABASE_URL: FULL.SUPABASE_URL });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_ENV_VARS");
    if (result.error.code !== "MISSING_ENV_VARS") return;
    expect([...result.error.keys].sort()).toEqual(
      REQUIRED_ENV_KEYS.filter((k) => k !== "SUPABASE_URL")
        .slice()
        .sort(),
    );
  });

  it("يعتبر القيمة الفراغية ناقصة لا موجودة", () => {
    const result = tryLoadConfig({ ...FULL, DRIVER_BOT_TOKEN: "   " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("DRIVER_BOT_TOKEN");
  });

  it("يرفض منفذاً غير صالح", () => {
    for (const port of ["abc", "0", "70000", "-1"]) {
      const result = tryLoadConfig({ ...FULL, PORT: port });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
    }
  });

  // `SEC-21` · ADR 0176: مفتاحُ تشفيرِ سرِّ TOTP للبابِ الموازي — اختياريٌّ
  // اختياراً **محروساً**: غيابُهُ يُغلقُ البابَ موحَّدًا، وحضورُهُ الناقصُ أو
  // المشوَّهُ يُسقِطُ الإقلاعَ لا يُضعِفُ السرَّ في صمتٍ. والمسافةُ تُقَاسُ على
  // القيمةِ نفسِها (بايتُها لا طولُ نصِّها) — فمفتاحٌ "قصيرٌ مرموزٌ" لا يمرّ.
  it("SEC-21: غيابُ مفتاحِ TOTP مسموحٌ — البابُ يُغلقُ موحَّدًا لا سقوطًا", () => {
    const result = tryLoadConfig({ ...FULL });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adminBreakGlassTotpKey).toBe(null);
  });

  it("SEC-21: مفتاحُ TOTP الصالحُ يُقبَلُ كما هو (بلا فكٍّ ولا اشتقاقٍ في الضبطِ)", () => {
    const key = Buffer.from("k".repeat(32)).toString("base64");
    const result = tryLoadConfig({ ...FULL, ADMIN_BREAK_GLASS_TOTP_KEY: key });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.adminBreakGlassTotpKey).toBe(key);
  });

  it("SEC-21: مفتاحُ TOTP بترميزٍ غيرِ قاعدةِ 64 يُرفضُ بالاسمِ", () => {
    const result = tryLoadConfig({
      ...FULL,
      ADMIN_BREAK_GLASS_TOTP_KEY: "يوجدُ هنا رموزٌ ليست قاعدةَ 64؟!!",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
    expect(result.error.message).toContain("ADMIN_BREAK_GLASS_TOTP_KEY");
  });

  it("SEC-21: مفتاحُ TOTP أقصرُ من 32 بايتًا يُرفضُ ولو كانَ ترميزَهُ صحيحًا", () => {
    const result = tryLoadConfig({
      ...FULL,
      ADMIN_BREAK_GLASS_TOTP_KEY: Buffer.from("short-key").toString("base64"),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
    expect(result.error.message).toContain("32");
  });

  it("يرفض رابط Supabase بلا https", () => {
    const result = tryLoadConfig({ ...FULL, SUPABASE_URL: "http://project.supabase.co" });
    expect(result.ok).toBe(false);
  });

  it("يميّز بيئة الإنتاج والاختبار ويردّ ما سواهما إلى التطوير", () => {
    // الإنتاج يفرض حدّاً أدنى لطول سرّ الويبهوك، وموضوع هذا الاختبار قراءة اسم
    // البيئة لا قوّة السرّ، فيُمرَّر سرّ مستوفٍ حتى لا يقيس شيئين معاً.
    const prod = tryLoadConfig({
      ...FULL,
      NODE_ENV: "production",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_WEBHOOK_SECRET_LENGTH),
    });
    const test = tryLoadConfig({ ...FULL, NODE_ENV: "test" });
    const weird = tryLoadConfig({ ...FULL, NODE_ENV: "staging" });
    expect(prod.ok && prod.value.env).toBe("production");
    expect(test.ok && test.value.env).toBe("test");
    expect(weird.ok && weird.value.env).toBe("development");
  });

  it("لا يقرأ أي قيمة تجارية من البيئة", () => {
    const contaminated = { ...FULL, SUBSCRIPTION_PRICE: "250", OFFER_TIMEOUT_SECONDS: "45" };
    const result = tryLoadConfig(contaminated);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain("250");
    expect(JSON.stringify(result.value)).not.toContain("45");
  });
});

describe("missingEnvKeys", () => {
  it("يعيد قائمة فارغة لبيئة كاملة", () => {
    expect(missingEnvKeys(FULL)).toEqual([]);
  });
  it("يعيد كل المفاتيح لبيئة خالية", () => {
    expect(missingEnvKeys({}).length).toBe(REQUIRED_ENV_KEYS.length);
  });
});

describe("DATABASE_URL", () => {
  it("يرفض رابطاً ليس رابط Postgres", () => {
    const result = tryLoadConfig({ ...FULL, DATABASE_URL: "https://db.example.com" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_ENV_VAR");
  });

  it("يقبل postgresql:// كما يقبل postgres://", () => {
    const result = tryLoadConfig({
      ...FULL,
      DATABASE_URL: "postgresql://user:pass@host:5432/postgres",
    });
    expect(result.ok).toBe(true);
  });

  // سرّ الويبهوك هو الحدّ الوحيد بين محادثة حقيقية وانتحال كامل لهوية أي
  // سائق أو راكب، لأن ما بعده يثق بـ from.id بلا تحقق إضافي.
  describe("قوّة سرّ الويبهوك", () => {
    const STRONG = "a".repeat(MIN_WEBHOOK_SECRET_LENGTH);

    it("يرفض سرّاً أقصر من الحدّ الأدنى في الإنتاج", () => {
      const result = tryLoadConfig({
        ...FULL,
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_WEBHOOK_SECRET_LENGTH - 1),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      if (result.error.code !== "INVALID_ENV_VAR") return;
      expect(result.error.key).toBe("TELEGRAM_WEBHOOK_SECRET");
    });

    it("يرفض محارف لا يقبلها تلغرام حتى لو طال السرّ", () => {
      const result = tryLoadConfig({
        ...FULL,
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: `${"س".repeat(MIN_WEBHOOK_SECRET_LENGTH)}`,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      if (result.error.code !== "INVALID_ENV_VAR") return;
      expect(result.error.key).toBe("TELEGRAM_WEBHOOK_SECRET");
    });

    it("يقبل سرّاً مستوفياً في الإنتاج", () => {
      const result = tryLoadConfig({
        ...FULL,
        NODE_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: STRONG,
      });
      expect(result.ok).toBe(true);
    });

    // القيد إنتاجي عمداً: التطوير والاختبار يستعملان أسراراً قصيرة مقروءة.
    it("لا يفرض القيد خارج الإنتاج", () => {
      expect(tryLoadConfig({ ...FULL, TELEGRAM_WEBHOOK_SECRET: "short" }).ok).toBe(true);
      expect(
        tryLoadConfig({ ...FULL, NODE_ENV: "test", TELEGRAM_WEBHOOK_SECRET: "short" }).ok,
      ).toBe(true);
    });
  });
});

describe("ضبط الخريطة (المرحلة ١٠)", () => {
  it("الافتراض بلا متغيّرات: none وبلا نمطٍ ولا مفتاح", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapProvider).toBe("none");
    expect(result.value.mapStyleUrl).toBeNull();
    expect(result.value.mapTilesPublicKey).toBeNull();
  });

  it("المتغيّرات الثلاثة تُقرأ فعلاً — كانت تُهمَل كلُّها قبل هذه المرحلة", () => {
    const result = tryLoadConfig({
      ...FULL,
      MAP_PROVIDER: "maplibre",
      MAP_STYLE_URL: "https://tiles.example.org/style.json",
      MAP_TILES_PUBLIC_KEY: "pk-123",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapProvider).toBe("maplibre");
    expect(result.value.mapStyleUrl).toBe("https://tiles.example.org/style.json");
    expect(result.value.mapTilesPublicKey).toBe("pk-123");
  });

  it("مزوّدٌ مجهول يمنع الإقلاع — لا يُقبل بصمتٍ كما كان", () => {
    // `google` مدرجٌ قصداً: كان موعوداً به في `.env.example` ولم يُنفّذ، فمن يضبطه
    // يجب أن يُمنع لا أن يُعطى لوحةً بلا خريطةٍ بلا سبب.
    for (const MAP_PROVIDER of ["leaflet", "google", "mapbox", "مزيّف", "non"]) {
      const result = tryLoadConfig({ ...FULL, MAP_PROVIDER });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
    }
  });

  it("تسويةُ الحالة والمسافات مقصودة، وعلى نفس سابقة TRANSLATION_PROVIDER", () => {
    // من يكتب متغيّرات البيئة إنسان، و`MapLibre ` ليس خطأً في النيّة بل في الرسم.
    // ورفضُه كان سيخالف ما يفعله `TRANSLATION_PROVIDER` في نفس الدالّة، فيصير
    // للملفّ قاعدتان مختلفتان لنفس الشيء.
    for (const MAP_PROVIDER of ["MapLibre", "maplibre ", " MAPLIBRE"]) {
      const result = tryLoadConfig({ ...FULL, MAP_PROVIDER });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.mapProvider).toBe("maplibre");
    }
  });

  /**
   * ## `PROCESS_TOPOLOGY` — الغيابُ ليس البطلانَ (ADR 0051 §٢-ب)
   *
   * الفرقُ بين الحالتَين **عقدٌ لا تفصيلُ تنفيذٍ**، فيُثبَّت باختبارٍ يميّزهما
   * صراحةً بدلَ أن يُقرأ ضمناً من نجاحِ حالةٍ واحدة.
   */
  it("غيابُ PROCESS_TOPOLOGY ⇒ single-process — افتراضٌ مُعلَنٌ لا سكوتٌ", () => {
    expect(FULL.PROCESS_TOPOLOGY).toBeUndefined();
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.processTopology).toBe("single-process");
  });

  it("قيمةٌ فارغةٌ أو مسافاتٌ ⇒ خطأُ إعدادٍ — كُتِب شيءٌ لم يُفهَم", () => {
    // مفتاحٌ مضبوطٌ بلا قيمةٍ ليس مفتاحاً غائباً: الأوّلُ فعلُ كاتبٍ، والثاني سكوتُه.
    for (const PROCESS_TOPOLOGY of ["", " ", "\t"]) {
      const result = tryLoadConfig({ ...FULL, PROCESS_TOPOLOGY });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
    }
  });

  it("قيمةٌ مجهولةٌ ⇒ خطأُ إعدادٍ لا ردٌّ صامتٌ إلى الافتراضِ", () => {
    for (const PROCESS_TOPOLOGY of ["many", "cluster", "single", "multi", "1"]) {
      const result = tryLoadConfig({ ...FULL, PROCESS_TOPOLOGY });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
    }
  });

  it("القيمتان الصالحتان تُقرآن، وتسويةُ الحالةِ والمسافاتِ على سابقةِ الملفِّ", () => {
    for (const [PROCESS_TOPOLOGY, expected] of [
      ["single-process", "single-process"],
      ["multi-process", "multi-process"],
      [" Multi-Process ", "multi-process"],
    ] as const) {
      const result = tryLoadConfig({ ...FULL, PROCESS_TOPOLOGY });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.processTopology).toBe(expected);
    }
  });

  it("MAP_TILES_URL لم يُعد اسماً معروفاً: اسمٌ واحد لا اسمان", () => {
    // كان `.env.example` يُعلن MAP_TILES_URL و`render.yaml` يُعلن MAP_STYLE_URL،
    // وكلاهما لم يُقرأ. الاسم القانوني الآن MAP_STYLE_URL وحده، وهذا الاختبار
    // يمنع عودةَ الاسم الميت من باب التوافق.
    const result = tryLoadConfig({ ...FULL, MAP_TILES_URL: "https://old.example.org/t.json" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapStyleUrl).toBeNull();
  });

  it("القيم الفارغة أو المسافات تُقرأ null لا نصّاً فارغاً", () => {
    const result = tryLoadConfig({ ...FULL, MAP_STYLE_URL: "   ", MAP_TILES_PUBLIC_KEY: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapStyleUrl).toBeNull();
    expect(result.value.mapTilesPublicKey).toBeNull();
  });
});

/**
 * المرحلة ١٥ — `OSRM_BASE_URL` كان مذكوراً في `.env.example` و`render.yaml` منذ
 * المرحلة ٩ ولا يُقرأ في الضبط قط. فمن ضبطه ظنّ أنّه شغّل التوجيه وهو معطَّل.
 * وهذه الاختبارات تمنع عودةَ ذلك الصمت: إمّا يُقرأ، أو يُرفَض الإقلاعُ بسببٍ مبيَّن.
 */
describe("الضبط: مزوّد التوجيه (المرحلة ١٥)", () => {
  it("الافتراضُ «لا مزوّد» لا «osrm بلا عنوان»: منصّةٌ لم تُضبَط تُقلع وتصمت", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routingProvider).toBe("none");
    expect(result.value.osrmBaseUrl).toBeNull();
  });

  it("المتغيّران يُقرآن فعلاً — وهذا ما لم يكن يحدث قبل المرحلة", () => {
    const result = tryLoadConfig({
      ...FULL,
      ROUTING_PROVIDER: "osrm",
      OSRM_BASE_URL: "http://osrm.internal:5000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routingProvider).toBe("osrm");
    expect(result.value.osrmBaseUrl).toBe("http://osrm.internal:5000");
  });

  it("‏osrm بلا عنوانٍ يمنع الإقلاع: خدمةٌ موعودٌ بها ولا وجود لها أسوأ من غيابها", () => {
    const result = tryLoadConfig({ ...FULL, ROUTING_PROVIDER: "osrm" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
    // ولماذا يُقاس المفتاح لا الرمزُ وحده: المشغّلُ يقرأ سجلَّ الإقلاع ليعرف **أيَّ**
    // متغيّرٍ يُصلح. ورمزٌ صحيحٌ بمفتاحٍ خطأ يُرسله إلى المتغيّر الخطأ.
    expect(result.error).toHaveProperty("key", "OSRM_BASE_URL");
  });

  it("مزوّدٌ مجهولٌ يمنع الإقلاع ولا يُقبل بصمت", () => {
    for (const ROUTING_PROVIDER of ["valhalla", "graphhopper", "google", "مزيّف", "non"]) {
      const result = tryLoadConfig({ ...FULL, ROUTING_PROVIDER, OSRM_BASE_URL: "http://x:5000" });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      expect(result.error).toHaveProperty("key", "ROUTING_PROVIDER");
    }
  });

  it("عنوانٌ بلا مِخطاطٍ يُرفَض: `fetch` عليه يُلقي في كلّ نداءٍ بعد الإقلاع", () => {
    for (const OSRM_BASE_URL of ["osrm.internal:5000", "localhost", "ftp://osrm", "//osrm", ""]) {
      const result = tryLoadConfig({ ...FULL, ROUTING_PROVIDER: "osrm", OSRM_BASE_URL });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("INVALID_ENV_VAR");
      expect(result.error).toHaveProperty("key", "OSRM_BASE_URL");
    }
  });

  it("‏https مقبولٌ كـ http: النشرُ داخل الشبكة وخارجها كلاهما مشروع", () => {
    const result = tryLoadConfig({
      ...FULL,
      ROUTING_PROVIDER: "osrm",
      OSRM_BASE_URL: "https://osrm.example.org",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.osrmBaseUrl).toBe("https://osrm.example.org");
  });

  it("تسويةُ الحالة والمسافات على نفس سابقة MAP_PROVIDER", () => {
    for (const ROUTING_PROVIDER of ["OSRM", "osrm ", " Osrm"]) {
      const result = tryLoadConfig({
        ...FULL,
        ROUTING_PROVIDER,
        OSRM_BASE_URL: "http://osrm.internal:5000",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.routingProvider).toBe("osrm");
    }
  });

  it("عنوانُ التوجيه مستقلٌّ عن مزوّد البلاطات: الخدمتان تُنشران منفصلتين", () => {
    const result = tryLoadConfig({
      ...FULL,
      MAP_PROVIDER: "none",
      ROUTING_PROVIDER: "osrm",
      OSRM_BASE_URL: "http://osrm.internal:5000",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mapProvider).toBe("none");
    expect(result.value.routingProvider).toBe("osrm");
  });
});

describe("TELEGRAM_TRANSPORT", () => {
  it("افتراضه `real` حين لا يُضبط — فلا يصمت نظامٌ بالسكوت عن الضبط", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.telegramTransport).toBe("real");
  });

  it("يقبل `silent` خارج الإنتاج ويقبل اختلاف حالة الأحرف والفراغ", () => {
    const result = tryLoadConfig({ ...FULL, TELEGRAM_TRANSPORT: "  SILENT " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.telegramTransport).toBe("silent");
  });

  it("يرفض قيمةً مجهولة ولا يسقط إلى افتراضٍ صامت", () => {
    const result = tryLoadConfig({ ...FULL, TELEGRAM_TRANSPORT: "quiet" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
  });

  /**
   * هذا هو الاختبار الحاكم في هذه المجموعة: الناقل الصامت أداةُ قياس، ووصولُه
   * إلى الإنتاج يعني نظاماً يبتلع إشعارات مستخدميه بلا أن يُخطئ ولا أن يُسجّل.
   * فالرفض يجب أن يكون في محمّل الضبط — أي عند الإقلاع — لا في مراجعةٍ بشرية.
   */
  it("يرفض `silent` في الإنتاج رفضاً قاطعاً عند الإقلاع", () => {
    const result = tryLoadConfig({
      ...FULL,
      NODE_ENV: "production",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_WEBHOOK_SECRET_LENGTH),
      TELEGRAM_TRANSPORT: "silent",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
  });

  it("يقبل `real` في الإنتاج", () => {
    const result = tryLoadConfig({
      ...FULL,
      NODE_ENV: "production",
      TELEGRAM_WEBHOOK_SECRET: "a".repeat(MIN_WEBHOOK_SECRET_LENGTH),
      TELEGRAM_TRANSPORT: "real",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.telegramTransport).toBe("real");
  });

  /**
   * سرُّ جلسةِ التطبيقِ المصغَّر (البند `F1-03`): اختياريٌّ لأنّ النظامَ
   * يعمل بلا تطبيقٍ مصغَّر، لكنّ حضورَه قصيراً خطأٌ يوقِف الإقلاع لا تحذيرٌ يُتيح
   * توقيعَ جلساتٍ بسرٍّ قابلٍ للتخمين.
   */
  it("يجعل سرَّ جلسةِ التطبيقِ المصغَّر `null` عند غيابِه ولا يمنع الإقلاع", () => {
    const result = tryLoadConfig(FULL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.miniappSessionSecret).toBeNull();

    const blank = tryLoadConfig({ ...FULL, MINIAPP_SESSION_SECRET: "   " });
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.value.miniappSessionSecret).toBeNull();
  });

  it("يرفض سرَّ جلسةٍ أقصرَ من الحدّ في كلِّ بيئةٍ لا في الإنتاجِ وحده", () => {
    const result = tryLoadConfig({
      ...FULL,
      MINIAPP_SESSION_SECRET: "b".repeat(MIN_SESSION_SECRET_LENGTH - 1),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_ENV_VAR");
  });

  it("يقبل سراً بالطولِ المطلوبِ ويقلّم فراغاتِه", () => {
    const secret = "c".repeat(MIN_SESSION_SECRET_LENGTH);
    const result = tryLoadConfig({ ...FULL, MINIAPP_SESSION_SECRET: ` ${secret} ` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.miniappSessionSecret).toBe(secret);
  });
});
