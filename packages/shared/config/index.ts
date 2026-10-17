/**
 * الغرض: قراءة وتحقق متغيرات البيئة التقنية فقط (اتصالات، مفاتيح) — لا قيم تجارية.
 * الحالة: أساس تقني منفّذ فعلياً.
 * ينتمي إلى: shared/config
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway، apps/workers، apps/admin-dashboard
 * ملاحظات مستقبلية: ممنوع منعاً باتاً وضع سعر/مهلة/وزن مطابقة هنا — مكانها جدول platform_settings.
 */

import { err, ok, type Result } from "../result/index.ts";

export type EnvName = "development" | "test" | "production";

/**
 * تجاوزات طبقة التتبّع من البيئة. كلّها `null` تعني «لم يضبط المشغّل شيئاً،
 * فاستُعمل افتراض المجال».
 *
 * ولماذا تجاوزاتٌ لا قيمٌ كاملة؟ لأنّ الأرقام الافتراضية لها مصدرُ حقيقةٍ واحد
 * هو `DEFAULT_GPS_POLICY` في `packages/domain/geo/gps-fix.ts` مع
 * `DEFAULT_TRACKING_CONFIG`. ولو كُتبت هنا مرّةً ثانيةً لصار في النظام رقمان
 * لنفس الحدّ، ويوماً ما يُعدَّل أحدهما وحده — وهذا بالضبط الانحراف الذي يُعالجه
 * هذا الحقل لا الذي يُنشئه. والدمج يحدث في `packages/tracking/config.ts`.
 *
 * وهذه القيم **تقنيّةٌ لا تجاريّة**: حدُّ سرعةٍ فيزيائيّ ودقّةُ جهازٍ وانحرافُ
 * ساعة — لا سعرٌ ولا عمولةٌ ولا مهلةُ عرض. القيم التجارية مكانها
 * `platform_settings` كما تقول ترويسة هذا الملفّ، ولا واحدةَ منها هنا.
 */
export interface TrackingEnvOverrides {
  /** TRACKING_GPS_INTERVAL_SECONDS */
  readonly gpsIntervalSeconds: number | null;
  /** TRACKING_GPS_IDLE_INTERVAL_SECONDS */
  readonly gpsIdleIntervalSeconds: number | null;
  /** TRACKING_MIN_DISTANCE_METERS */
  readonly minDistanceMeters: number | null;
  /** TRACKING_TELEPORT_THRESHOLD_METERS */
  readonly teleportThresholdMeters: number | null;
  /** TRACKING_MAX_REASONABLE_SPEED_KMH */
  readonly maxReasonableSpeedKmh: number | null;
  /** TRACKING_MAX_ACCURACY_METERS */
  readonly maxAccuracyMeters: number | null;
  /** TRACKING_MAX_TIME_DRIFT_SECONDS */
  readonly maxTimeDriftSeconds: number | null;
}

/**
 * «لم يضبط المشغّل شيئاً» — كلّ الحدود على افتراض المجال.
 *
 * مُصدَّرٌ لا مكرَّر في كلّ اختبار: كائنٌ منسوخٌ في ستّةٍ وعشرين ملفّاً يعني أنّ
 * إضافةَ حدٍّ جديدٍ يوماً تكسر ستّةً وعشرين ملفّاً وتُغري بإصلاحها بالنسخ.
 */
export const NO_TRACKING_OVERRIDES: TrackingEnvOverrides = {
  gpsIntervalSeconds: null,
  gpsIdleIntervalSeconds: null,
  minDistanceMeters: null,
  teleportThresholdMeters: null,
  maxReasonableSpeedKmh: null,
  maxAccuracyMeters: null,
  maxTimeDriftSeconds: null,
};

/** أسماء متغيّرات التتبّع كما تُكتب في البيئة — مصدر الحقيقة للتوثيق والحرّاس. */
export const TRACKING_ENV_KEYS = [
  "TRACKING_GPS_INTERVAL_SECONDS",
  "TRACKING_GPS_IDLE_INTERVAL_SECONDS",
  "TRACKING_MIN_DISTANCE_METERS",
  "TRACKING_TELEPORT_THRESHOLD_METERS",
  "TRACKING_MAX_REASONABLE_SPEED_KMH",
  "TRACKING_MAX_ACCURACY_METERS",
  "TRACKING_MAX_TIME_DRIFT_SECONDS",
] as const;

export interface AppConfig {
  readonly env: EnvName;
  readonly port: number;
  readonly supabaseUrl: string;
  /** رابط اتصال Postgres المباشر بقاعدة Supabase — عليه تعمل كل المحوّلات. */
  readonly databaseUrl: string;
  readonly supabaseServiceKey: string;
  readonly redisUrl: string;
  readonly redisToken: string;
  readonly driverBotToken: string;
  readonly riderBotToken: string;
  readonly telegramWebhookSecret: string;
  /**
   * معرّف تلغرام لأول مسؤول. بدونه لا يوجد أي مسار لتعيين مسؤول في نظام
   * كل صلاحياته في القاعدة: تعديل الصفّ يدوياً في الإنتاج ليس مساراً بل التفاف عليه.
   */
  readonly bootstrapAdminTelegramId: string;
  /**
   * مزوّد الترجمة الآلية (المرحلة 2.6). ليس في REQUIRED_ENV_KEYS عن قصد:
   * `none` قيمة صالحة تعني «شغّل بلا ترجمة»، والنظام يعمل كاملاً بدونها.
   * جعله إلزامياً كان سيمنع الإقلاع لغياب خدمة مساعِدة.
   */
  readonly translationProvider: TranslationProviderName;
  /** مفتاح المزوّد — مطلوب لـ deepl و google، وغير مطلوب لـ mymemory. */
  readonly translationApiKey: string | null;
  /** بريد تواصل يرفع الحصّة المجانية عند مزوّدات تشترطه في شروطها. */
  readonly translationContactEmail: string | null;
  /**
   * أين تُحفظ جلسات الحوار. ليست في REQUIRED_ENV_KEYS: الافتراضي `memory` يعمل
   * كاملاً لنسخة واحدة، و`redis` شرطٌ عند تعدّد النسخ لا تحسين (ADR 0011).
   */
  readonly sessionStore: SessionStoreName;
  /**
   * كم عمليةً يعمل النظامُ؟ محورٌ **مستقلٌّ** عن `sessionStore` (ADR 0051).
   *
   * ولماذا محورٌ ثانٍ لا استنتاجٌ من الأوّل: العلاقةُ التي يُثبِتها `ADR 0011` هي
   * `multi-process ⇒ redis` — أي أنّ Redis **شرطٌ لازمٌ** لتعدُّدِ العملياتِ لا
   * **دليلٌ** عليه. فنسخةٌ واحدةٌ بجلساتٍ في Redis حالةٌ مشروعةٌ، بل هي الخطوةُ
   * الأولى في مسارِ الانتقالِ المكتوبِ في `docs/render-deployment-vars.md` §٣.
   * وقراءةُ `SESSION_STORE` طوبولوجيا كانت تُحرِّم تلك الخطوةَ (ADR 0051 §١).
   *
   * ليست في `REQUIRED_ENV_KEYS`: الافتراضُ `single-process` هو حالُ الإنتاجِ اليومَ
   * (`numInstances: 1`)، فالغيابُ لا يُغيِّر سلوكاً قائماً. **أمّا القيمةُ التي لا
   * تُفهَم فخطأُ إعدادٍ حتميٌّ يمنع الإقلاعَ ولا تُردّ إلى الافتراضِ**: من كتب قيمةً
   * قصدَ شيئاً، وردُّها صمتاً من جنسِ ما يشكو منه `R-17`.
   */
  readonly processTopology: ProcessTopologyName;
  /**
   * دفعُ المقاييس إلى مُجمِّعٍ مركزيّ (`F5-07` / `SCL-006`). `endpoint: null` تعني
   * إطفاءً مُعلَناً — لا عطلاً ولا نقصاً في الضبط.
   */
  readonly metricsExport: MetricsExportConfig;
  /**
   * ناقلُ الرسائل الصادرة. `real` في كلّ تشغيلٍ حقيقي، و`silent` للقياس فقط
   * ومرفوضٌ في الإنتاج. راجع `TELEGRAM_TRANSPORT_NAMES` لسبب سكناه في الضبط.
   */
  readonly telegramTransport: TelegramTransportName;
  /**
   * سطحُ البوتِ (`BOT_SURFACE_MODE` — `ADR 0213` · `DEC-22`): `miniapp` يجعلُ البوتَ طبقةَ دخولٍ
   * وإشعاراتٍ وأوامرَ أساسيّةٍ ويُحيلُ ما سواها إلى التطبيقِ المصغَّرِ؛ و`legacy` يُبقي الحوارَ
   * القديمَ كاملاً — وهو مسارُ الرجوعِ بتغييرِ متغيّرٍ لا بنشرِ كودٍ.
   */
  readonly botSurfaceMode: BotSurfaceModeName;
  /** أصلُ التطبيقِ المصغَّرِ (`MINIAPP_URL`) — `https` حتماً؛ لازمٌ حين `botSurfaceMode = miniapp`. */
  readonly miniAppUrl: string | null;
  /**
   * هل تُشغَّل المهامّ الدورية داخل عملية البوابة نفسها.
   *
   * الأصل أن العامل خدمةٌ مستقلّة (`render.yaml` قسم `waslah-worker`)، وهو الأنظف:
   * إقلاعه وسجلّه ومقياسه منفصلة عن البوابة. لكن الفحص الحيّ للإنتاج أثبت أن تلك
   * الخدمة **غير موجودة أصلاً**، فلم تُنفَّذ مهمّة دورية واحدة قطّ: لا إشعار «لا يوجد
   * سائق»، ولا تصعيد إلى قروب الإسناد، ولا انتهاء مهلة عرض، ولا دوران تفاوض.
   * راجع `docs/directive-item-0-live-diagnosis.md` القسم 0.2.
   *
   * فهذا المتغيّر مخرجٌ صريح لا افتراضي: من يملك خدمة عامل مستقلّة يتركه `false`
   * فلا يتغيّر عليه شيء، ومن لا يملكها يضبطه `true` فتعمل المهامّ في نفس العملية.
   * القفل الموزَّع في المشغّل هو ما يجعل هذا آمناً: لو أُقلعت الخدمتان معاً بالخطأ
   * لما نُفِّذت مهمّة مرّتين، بل تخطّت إحداهما بحالة `skipped_locked_elsewhere`.
   *
   * ## حالُ المتغيّرِ بعدَ `F5-04` (ADR 0063)
   *
   * فُصِلَ العاملُ: `render.yaml` يُعلِن اليومَ `false` للبوّابةِ، وخدمةُ
   * `waslah-worker` هي موضعُ المهامِّ الوحيد. ولمّا صار الإطفاءُ هو الحالَ
   * المُعلَنَ لم يبقَ السكوتُ عنه مقبولاً **في الإنتاج**: الغيابُ أو القيمةُ التي
   * لا تُفهَم `InvalidEnvVarError` يمنع الإقلاعَ، لأنّ مَن نسيَ المتغيّرَ في خدمةٍ
   * جديدةٍ كان سيعودُ إلى `SCL-007` من حيث لا يشعر والقفلُ يُخفي الأثرَ.
   *
   * والافتراضيُّ يبقى `true` في غيرِ الإنتاجِ وحدَه: مَن يُشغِّل المستودعَ على
   * حاسبِه ليس له خدمةُ عاملٍ ثانيةٌ، ونظامٌ بلا مهامَّ دوريّةٍ في التطويرِ يُخفي
   * أخطاءً لا تُرى إلا في الإنتاجِ.
   */
  readonly runWorkerInGateway: boolean;
  /**
   * أيعملُ سطحُ لوحةِ الإدارةِ (`/admin` · `/admin/api` · `/admin/api/live`) داخلَ
   * عمليةِ البوّابةِ؟ — `F5-08` / `ARCH-011` · ADR 0064.
   *
   * ## ولمَ إعلانٌ لا افتراضٌ، وقد كان الافتراضُ مقبولاً في `PROCESS_TOPOLOGY`
   *
   * لأنّ الخطأَ ههنا **صامتٌ في الاتّجاهِ المعاكسِ** لخطأِ `RUN_WORKER_IN_GATEWAY`.
   * فمَن أطفأ العاملَ بلا خدمةِ عاملٍ فقدَ المهامَّ الدوريّةَ كلَّها بلا حرفٍ يشكو،
   * وأمّا مَن **أبقى اللوحةَ في البوّابةِ** بعدَ إنشاءِ خدمةِ `waslah-admin` فلا
   * يفقدُ شيئاً ظاهراً: اللوحةُ تعملُ من الأصلَين، و`/health` أخضرُ، ولا طلبٌ
   * يُخفِق — و**العزلُ الذي دُفِعَ ثمنُهُ غيرُ موجودٍ**: تقريرُ حرارةٍ ثقيلٌ يفتحه
   * مشغّلٌ لا يزالُ يسحبُ من بِركةِ اتّصالاتِ البوّابةِ نفسِها التي يجبُ أن تُجيبَ
   * ويبهوكَ تلغرام في ثوانٍ (ARCH-013: الأولويّاتُ جزءٌ من المعمارية).
   *
   * فالسكوتُ ههنا لا يُكتشَفُ بعطلٍ بل يُكتشَفُ بقياسٍ لا يُجريه أحدٌ. ولذلك صارَ
   * الإعلانُ في الإنتاجِ إلزاميّاً، وصارَ في `scripts/check-instance-invariant.ts`
   * حكمٌ يرفضُ **الحالَين معاً**: لوحةٌ في موضعَين، ولوحةٌ في لا موضع.
   *
   * والافتراضُ `true` يبقى في غيرِ الإنتاجِ: مَن يُشغِّلُ المستودعَ على حاسبِهِ
   * يفتحُ `/admin` على المَنفذِ نفسِهِ، وإلزامُهُ بعمليّةٍ ثانيةٍ ليرى صفحةً عائقٌ
   * بلا مقابل.
   */
  readonly runAdminInGateway: boolean;
  /**
   * مزوّد عرض الخريطة. الافتراضي `none`: منصّةٌ بلا خريطة تعمل كاملةً، وهي حالُها
   * قبل هذه المرحلة. جعلُه إلزامياً كان سيمنع الإقلاع لأجل واجهةٍ عرض.
   */
  readonly mapProvider: MapProviderName;
  /** رابط ملفّ نمط الخريطة (style.json) — `null` يعني غيرَ مُهيَّأ. */
  readonly mapStyleUrl: string | null;
  /**
   * مفتاح خدمة البلاطات. **عامٌّ بالتصميم**: المتصفّح هو من يطلب البلاطات فيظهر
   * المفتاح في كل طلب. الاسم يقول ذلك صراحةً حتى لا يوضع فيه مفتاحٌ بلا تقييد
   * نطاقٍ ولا سقفِ استخدام. يُنظر `MapStyleInput.publicApiKey`.
   */
  readonly mapTilesPublicKey: string | null;
  /**
   * بصمةُ سلامة (Subresource Integrity) لملفّ MapLibre بالإصدار المثبَّت.
   * `null` يعني **غيرَ محسوبة**، وحينها لا يُصيَّر وسمُ النصّ ألبتّة (ADR 0019).
   *
   * أُضيف في المرحلة ١٣: كان ADR 0019 يُعلن أن الخريطة لا تعمل حتى يحسب المشغّل
   * البصمة، لكن لم يكن في الضبط موضعٌ **يُدخِلها فيه** — فكان الإعلانُ صحيحاً
   * والنتيجةُ أن الخريطة لا تعمل أبداً بأي ضبط. هذا المفتاح هو الوصلةُ الناقصة،
   * لا سياسةٌ جديدة: القاعدة (بصمةٌ أو لا نصّ) كما هي.
   */
  readonly maplibreSri: string | null;
  /**
   * مزوّد التوجيه (Routing) — منه تُشتقّ مدّةُ الوصول في المرحلة ١٥.
   *
   * منفصلٌ عن `mapProvider` عن قصد، لأنّهما شيئان لا وجهان: `maplibre` يرسم
   * بلاطاتٍ في متصفّح، و`osrm` يحسب مساراً على خادم. وقد قيس أنّهما يُنشران
   * منفصلين فعلاً: خريطةٌ تعمل ببلاطاتٍ مُستضافةٍ بلا أيّ محرّك توجيه، ومحرّكُ
   * توجيهٍ يخدم زمنَ الوصول في تلغرام بلا أيّ خريطةٍ مرسومة. فمفتاحٌ واحدٌ
   * لهما كان يُلزم المشغّلَ بتشغيل ما لا يحتاج، أو يمنعه ممّا يحتاج.
   */
  readonly routingProvider: RoutingProviderName;
  /**
   * عنوان خادم OSRM. `null` يعني غيرَ مُهيَّأ — وحينها زمنُ الوصول **غيرُ متاح**
   * ويُقال ذلك صراحةً، لا يُقدَّر تقديراً تقريبياً (ADR 0024).
   */
  readonly osrmBaseUrl: string | null;
  /**
   * حدُّ معدّلِ طلباتِ HTTP إلى مزوّدِ التوجيهِ **كما يُعلِنُه عقدُ الحسابِ**
   * (`ROUTING_RATE_LIMIT` = `<طلبات>/<ثوانٍ>` · `REQ-09` · `ADR 0190`). `null` =
   * لا حدَّ مُعلَنٌ، ويُرفَضُ في الإنتاجِ متى كانَ `ROUTING_PROVIDER` غيرَ `none`:
   * حسابٌ مدفوعٌ بحدٍّ لا نعرفُه يُتجاوَزُ بلا علمِنا ويُفوتَرُ.
   */
  readonly routingRateLimit: RoutingRateLimit | null;
  /**
   * حدود طبقة التتبّع من البيئة — تجاوزاتٌ فوق افتراضات المجال.
   *
   * أُضيف لأنّ هذه المتغيّرات كانت مُعلَنةً في `render.yaml` و`.env.example`
   * ولا تُقرَأ في سطرٍ واحد من الكود: المشغّل يضبط `TRACKING_MAX_REASONABLE_SPEED_KMH`
   * فلا يتغيّر شيء، ولا رسالةَ خطأٍ تُخبره — وهمُ تحكّمٍ كامل، وهو نفس الخطر
   * (R-28) الذي أُصلح لـ`OSRM_BASE_URL` وحده وبقي هنا. وكانت الأسماء نفسها
   * مختلفةً بين الملفّين، فمن ضبط الاسم الوارد في `render.yaml` ضبط اسماً
   * لا وجود له في أيّ مكان آخر.
   */
  readonly tracking: TrackingEnvOverrides;
  /**
   * أساسُ روابط التتبّع العامّة (`TRACKING_TOKEN_BASE_URL`) — منه يُبنى
   * `<الأساس>/track/<الرمز>`. `null` يعني أنّ ميزةَ الرابط المُشارَك **مُطفأة**
   * صريحاً: لا يُصدَر رمزٌ ولا يُعرض زرٌّ، بدلاً من إرسال رابطٍ بأساسٍ مُخمَّن.
   *
   * منفصلٌ عن `PORT` وعن أيّ اشتقاقٍ من طلبٍ وارد عن قصد: البوابةُ خلف وسيطٍ في
   * Render، والرابطُ يُرسَل في رسالة تلغرام تُفتَح بعد ساعةٍ من جهازٍ آخر — فلو
   * اشتُقّ من `Host` أو `X-Forwarded-Host` صار عنوانُ الرابط رهنَ ترويسةٍ
   * يتحكّم بها الطالب، وهذا مدخلُ تصييدٍ صريح (رابطٌ يُرسله بوتُنا إلى نطاقٍ
   * يملكه المهاجم). فيُعلَن مرّةً في البيئة ولا يُشتقّ أبداً.
   */
  readonly trackingTokenBaseUrl: string | null;
  /**
   * سرُّ توقيعِ جلسةِ التطبيقِ المصغَّر (`F1-03`). `null` يعني أنّ مسارَ
   * `POST /v1/session/telegram` **مُعطَّلٌ صريحاً** فيردّ `503`، لا أنّه يقبل
   * بجلسةٍ بتوقيعٍ مُخمَّن: جلسةٌ بسرٍّ افتراضيٍّ أسوأُ من غيابِ الجلسة.
   *
   * وليس في `REQUIRED_ENV_KEYS` لأنّ النظامَ كلَّه — البوتان والويبهوك والعامل —
   * يعمل كاملاً بلا تطبيقٍ مصغَّر، فلو أُلزم لمنعَ الإقلاعَ لأجلِ واجهةٍ لم تُنشَر.
   * وهو **منفصلٌ عن رمزَي البوت** عن قصد: رمزُ البوت يُثبِت هويةَ تيليجرام،
   * وهذا السرُّ يوقّع تفويضَ نظامِنا؛ فتسريبُ أحدهما لا يُسقِط الآخر.
   */
  readonly miniappSessionSecret: string | null;
  /**
   * `LOAD-01 Recovery` — سرُّ مسارِ الإشارةِ الداخليِّ بينَ العاملِ والبوابةِ
   * (`INTERNAL_SIGNAL_SECRET`). غيابُهُ = مسارُ الإشارةِ معطَّلٌ (البطاقةُ
   * البديلةُ تعملُ كما كانَت) — لا يُفطَرُ على قيمةٍ افتراضيةٍ مفتوحةٍ.
   */
  readonly internalSignalSecret: string | null;
  /**
   * `LOAD-01 Recovery` — رابطُ البوابةِ لمسارِ الإشارةِ الداخليِّ
   * (`GATEWAY_INTERNAL_URL`، مثلُ `http://127.0.0.1:54300`). معطَّلٌ بالغيابِ.
   */
  readonly gatewayInternalUrl: string | null;

  /**
   * `SEC-21` · `ADR 0176` — مفتاحُ تشفيرِ أسرارِ TOTP للبابِ الموازي
   * (break-glass) AES-256-GCM. اختياريٌّ حتّى لا يُوقَفَ إقلاعُ بيئةٍ لم تُنشئ
   * بابًا بعدُ، لكنَّ ما وُجدَ منهُ لا يُقبَلُ دونَ 32 بايتًا (64 ستَّ عشريّةً أو
   * 44 قاعدةً 64). وهو **منفصلٌ عن فِلفِلِ التجزئةِ**: ذاكَ يُهضَمُ به في
   * القاعدةِ، وهذا يُشفَّرُ به في الخادمِ — فتسريبُ أحدهما لا يفتحُ الآخرَ.
   */
  readonly adminBreakGlassTotpKey: string | null;

  /**
   * `F4-07` — هل يُفعَّلُ مُرحِّلُ الموقعِ الحيِّ عبر تلغرام كاحتياطٍ؟
   *
   * **افتراضيًّا `false`**: قناةُ Socket.IO صارَت المسارَ الرئيسيَّ لتتبُّعِ الراكبِ،
   * فلا يُنشَأُ مُرحِّلُ تلغرام ولا خريطةُ `tripId→messageId`. ويُفعَّلُ فقط إن
   * كان هناك مستهلكٌ لا يفتحُ التطبيقَ المصغَّرَ (بوتٌ قديمٌ، أو رحلةٌ بلا قناةٍ).
   *
   * ولا يُفعَّلُ بثقةٍ: إن لم يكن `riderBotToken` صالحًا فلا مُرحِّلَ أصلاً.
   */
  readonly liveLocationFallbackEnabled: boolean;
}

/** مخازن الجلسات المدعومة. */
export const SESSION_STORE_NAMES = ["memory", "redis"] as const;

export type SessionStoreName = (typeof SESSION_STORE_NAMES)[number];

/**
 * طوبولوجيا التشغيل — محورُ «كم عمليةً نحن» (ADR 0051 §٢-ب).
 *
 * وهو **غيرُ** محورِ `SESSION_STORE`: ذاك يجيب «أين تُخزَّن حالةُ الجلسةِ»، وهذا
 * يجيب «هل نحن أكثرُ من عمليةٍ». وخلطُهما هو العيبُ الذي نسخَه `ADR 0051` من
 * `ADR 0050` §٣-ب.
 *
 * ولا `INSTANCE_COUNT` ولا رقمَ نسخٍ في البيئةِ: Render لا يُصدِّر عددَ النسخِ إلى
 * العمليةِ، فقيمةٌ تُكتَب بيدٍ تُخالِف `render.yaml` بلا كاشفٍ. والحرفُ يُحرَس حيثُ
 * يوجد — `numInstances` في ملفِّ النشرِ بحاجزِ `scripts/check-instance-invariant.ts`.
 */
export const PROCESS_TOPOLOGY_NAMES = ["single-process", "multi-process"] as const;

export type ProcessTopologyName = (typeof PROCESS_TOPOLOGY_NAMES)[number];

/**
 * ناقلُ الرسائل الصادرة إلى تلغرام.
 *
 * `real` هو الناقل الوحيد الذي يُرسل فعلاً، وهو الافتراض. و`silent` ينفّذ نفس
 * المنفذ بلا نداءٍ شبكيّ ويحصي ما كان سيُرسَل.
 *
 * ولماذا يسكن هذا في الضبط لا في مِلفِّ قياسٍ منفصل؟ لأن البديل كان نسخةً ثانيةً
 * من نقطة الدخول (٥١٥ سطراً) تُستنسخ لتُبدِّل المُرسِل، وهي بالضبط صنفُ العطب
 * الذي أفسد `scripts/load-test.ts`: نسخةٌ تتعفّن بصمتٍ خلف الأصل. فالقياس يجب أن
 * يشغّل الخادم الحقيقي نفسه، ولا يختلف عنه إلا في بديلٍ واحدٍ مُعلَن.
 *
 * وهو **مرفوضٌ في الإنتاج** رفضاً قاطعاً في `loadConfig`: نظامٌ يقبل إسكات
 * إشعاراته بمتغيّر بيئةٍ واحد هو نظامٌ يستطيع أن يخدع مستخدميه بخطأ ضبط.
 */
export const TELEGRAM_TRANSPORT_NAMES = ["real", "silent"] as const;

export type TelegramTransportName = (typeof TELEGRAM_TRANSPORT_NAMES)[number];

/**
 * أوضاعُ سطحِ البوتِ (`ADR 0213` · `ADR 0286`). الافتراضُ عند الغيابِ `miniapp`:
 * هو سطحَ المنتجِ الوحيدَ في التشغيلِ الفعليّ، فلا بيئةٌ تعملُ بالحوارِ القديمِ إلا
 * بِعَلمٍ صريحٍ. و`legacy` **مسارُ اختبارِ توافقٍ معزولٌ فقط** (`ADR 0286`):
 * يُرفضُ في `NODE_ENV=production` رفضاً قاطعاً، ولا يُقبلُ خارجها إلّا مع
 * `BOT_SURFACE_TEST_LEGACY=1` صريحاً — فلا يعودُ الوضعُ القديمُ بالسهوِ ولا بالضبطِ العرضيّ.
 */
export const BOT_SURFACE_MODE_NAMES = ["legacy", "miniapp"] as const;

export type BotSurfaceModeName = (typeof BOT_SURFACE_MODE_NAMES)[number];

/**
 * مزوّدات عرض الخريطة المدعومة. `none` اختيارٌ صريح: «اعمل بلا خريطة».
 *
 * تسكن القائمة هنا لا في `packages/maps` لأن هذا موضعُ مفردات الضبط، والاتجاه
 * القائم في المستودع هو `maps → shared` (نمط `Result`). ووضعُها هناك واستيرادُها
 * هنا كان سيقلب الاتجاه فيصير أدنى الطبقات معتمداً على طبقةٍ فوقه.
 * وكتابتُها في الموضعين كانت ستُنتج ضبطاً يقبل ما لا يُحلّله المزوّد.
 */
export const MAP_PROVIDER_NAMES = ["none", "maplibre"] as const;

export type MapProviderName = (typeof MAP_PROVIDER_NAMES)[number];

/**
 * مزوّدات التوجيه المدعومة. `none` اختيارٌ صريح: «اعمل بلا زمن وصول».
 *
 * القائمةُ هنا لا في `packages/maps` لنفس سبب `MAP_PROVIDER_NAMES` أعلاه:
 * الاتجاه القائم `maps → shared`، وقلبُه يجعل أدنى الطبقات معتمداً على ما فوقه.
 */
export const ROUTING_PROVIDER_NAMES = ["none", "osrm"] as const;

export type RoutingProviderName = (typeof ROUTING_PROVIDER_NAMES)[number];

/** حدٌّ مُعلَنٌ: `calls` طلباً في كلِّ `windowSeconds` ثانيةٍ منزلقةٍ. */
export interface RoutingRateLimit {
  readonly calls: number;
  readonly windowSeconds: number;
}

/**
 * سقفا الصيغةِ — لا سقفا الحدِّ: النافذةُ المنزلقةُ على `Redis` مجموعةٌ مرتَّبةٌ
 * بعضوٍ لكلِّ طلبٍ، فنافذةُ يومٍ بمئةِ ألفِ طلبٍ مفتاحٌ بمئةِ ألفِ عضوٍ. وعقودُ
 * المزوّدينَ تُعلِنُ حدَّ الثانيةِ أو الدقيقةِ؛ والحصّةُ الشهريّةُ شأنُ الفاتورةِ.
 */
export const ROUTING_RATE_LIMIT_MAX_WINDOW_SECONDS = 60;
export const ROUTING_RATE_LIMIT_MAX_CALLS = 10_000;

/** يُحلِّلُ `<طلبات>/<ثوانٍ>` أو يُعيدُ سببَ الرفضِ نصّاً. */
export function parseRoutingRateLimit(raw: string): RoutingRateLimit | string {
  const match = /^([0-9]+)\/([0-9]+)$/.exec(raw.trim());
  if (match === null) return `الصيغةُ <طلبات>/<ثوانٍ> — وردت: ${raw}`;
  const calls = Number(match[1]);
  const windowSeconds = Number(match[2]);
  if (calls < 1 || calls > ROUTING_RATE_LIMIT_MAX_CALLS) {
    return `الطلباتُ بينَ 1 و${ROUTING_RATE_LIMIT_MAX_CALLS} — وردت: ${calls}`;
  }
  if (windowSeconds < 1 || windowSeconds > ROUTING_RATE_LIMIT_MAX_WINDOW_SECONDS) {
    return `الثواني بينَ 1 و${ROUTING_RATE_LIMIT_MAX_WINDOW_SECONDS} — وردت: ${windowSeconds}`;
  }
  return { calls, windowSeconds };
}

/** أسماء المزوّدات المدعومة. `none` ليست غياباً بل اختياراً صريحاً. */
export const TRANSLATION_PROVIDER_NAMES = [
  "none",
  "deepl",
  "google",
  "google-web",
  "mymemory",
] as const;

export type TranslationProviderName = (typeof TRANSLATION_PROVIDER_NAMES)[number];

/**
 * ضبطُ دفعِ المقاييس إلى مُجمِّعٍ مركزيّ — `F5-07` / `SCL-006` (ADR 0062).
 *
 * **الغيابُ إطفاءٌ مُعلَنٌ لا عطلٌ صامت**: `endpoint === null` تعني «لا مُجمِّعَ
 * مضبوطاً»، والنظامُ يعمل كاملاً بلا واحد — `GET /metrics` يبقى كما هو. ولهذا لا
 * مكانَ لهذه المتغيّرات في `REQUIRED_ENV_KEYS`.
 */
export interface MetricsExportConfig {
  /** نقطةُ استقبالِ OTLP/HTTP الكاملة، أو `null` أي «لا دفعَ مركزيّاً». */
  readonly endpoint: string | null;
  /**
   * ترويساتُ الاعتمادِ نحوَ المُجمِّع. **سرٌّ**: لا تُسجَّل ولا تظهر في رسالةِ خطأ.
   * فارغةٌ إن لم تُضبَط — بعضُ المُجمِّعاتِ داخلَ الشبكةِ لا يطلب اعتماداً.
   */
  readonly headers: Readonly<Record<string, string>>;
  /** الفاصلُ بين دورَي دفع (ثانية). */
  readonly intervalSeconds: number;
  /**
   * معرّفُ النسخةِ في سماتِ المورد. `null` يعني «وَلِّدْه عند الإقلاع»، وهو الحالُ
   * الغالبُ: المنصّةُ لا تُعطي معرّفاً ثابتاً لكلِّ نسخةٍ، والمُولَّدُ يكفي لتمييزِ
   * عمليّتَين تعملان معاً — وهو كلُّ ما يلزم كي لا يدهسَ أحدُهما سلاسلَ الآخر.
   */
  readonly serviceInstanceId: string | null;
}

/** الحدُّ الأدنى والأعلى لفاصلِ الدفع — حدودٌ تقنيّةٌ لا تجاريّة. */
const MIN_METRICS_EXPORT_INTERVAL_SECONDS = 1;
const MAX_METRICS_EXPORT_INTERVAL_SECONDS = 3600;
/** الافتراضُ: خمسَ عشرةَ ثانيةً — فاصلُ الكشطِ الشائعُ في Prometheus. */
const DEFAULT_METRICS_EXPORT_INTERVAL_SECONDS = 15;

/**
 * يُحلِّل `METRICS_EXPORT_HEADERS` بصيغةِ `k=v,k=v`.
 *
 * **ولا تدخل القيمةُ رسالةَ الخطأ أبداً** — لا كاملةً ولا مقتطعةً. هذا حقلُ سرٍّ،
 * ورسالةُ الإقلاعِ تُطبَع في سجلِّ المنصّةِ الذي يقرؤه من لا يملك السرّ. فيُقال
 * «الصيغةُ خاطئةٌ في المُدخَل رقم كذا» ولا يُقال ماذا كان فيه.
 */
export function parseMetricsExportHeaders(
  raw: string,
): Result<Readonly<Record<string, string>>, string> {
  const headers: Record<string, string> = {};
  const entries = raw.split(",");
  for (const [index, entry] of entries.entries()) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0 || separator === trimmed.length - 1) {
      return err(`الصيغةُ المتوقَّعة name=value مفصولةً بفواصل — المُدخَل رقم ${index + 1} لا يطابقها`);
    }
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || value.length === 0) {
      return err(`اسمُ ترويسةٍ غيرُ صالحٍ أو قيمةٌ فارغةٌ في المُدخَل رقم ${index + 1}`);
    }
    headers[name.toLowerCase()] = value;
  }
  return ok(headers);
}

/** المتغيرات التي بلا قيمة صالحة لها لا يمكن للنظام أن يعمل إطلاقاً. */
export const REQUIRED_ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "DRIVER_BOT_TOKEN",
  "RIDER_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "BOOTSTRAP_ADMIN_TELEGRAM_ID",
] as const;

export type RequiredEnvKey = (typeof REQUIRED_ENV_KEYS)[number];

export class MissingEnvVarError extends Error {
  readonly code = "MISSING_ENV_VARS" as const;
  constructor(public readonly keys: readonly string[]) {
    super(`متغيرات بيئة ناقصة: ${keys.join(", ")}`);
    this.name = "MissingEnvVarError";
  }
}

export class InvalidEnvVarError extends Error {
  readonly code = "INVALID_ENV_VAR" as const;
  constructor(
    public readonly key: string,
    public readonly reason: string,
  ) {
    super(`متغير بيئة غير صالح ${key}: ${reason}`);
    this.name = "InvalidEnvVarError";
  }
}

export type ConfigError = MissingEnvVarError | InvalidEnvVarError;

/** الحدّ الأدنى لطول سرّ الويبهوك في الإنتاج — مطابق لما تشترطه وثيقة النشر. */
export const MIN_WEBHOOK_SECRET_LENGTH = 32;

/** الحدّ الأدنى لطول سرّ توقيع جلسة التطبيق المصغَّر — في كل بيئة لا الإنتاج وحده. */
export const MIN_SESSION_SECRET_LENGTH = 32;

/** مجموعة المحارف التي يقبلها تلغرام في ترويسة secret_token. */
const TELEGRAM_SECRET_CHARSET = /^[A-Za-z0-9_-]+$/;

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

/**
 * الحروفُ التي يفهمها `parseBooleanEnv`. مُعلَنةٌ مُصدَّرةً لأنّ التحقّقَ الصارمَ
 * في الإنتاجِ (`RUN_WORKER_IN_GATEWAY` · F5-04) يذكرها في رسالةِ الخطأِ، ورسالةٌ
 * تقول «قيمةٌ لا تُفهَم» بلا ذكرِ المفهومِ تترك المشغّلَ يُخمِّن.
 */
export const BOOLEAN_ENV_LITERALS = ["true", "1", "yes", "on", "false", "0", "no", "off"] as const;

/**
 * قراءة متغيّر بيئة منطقي بحالة افتراضية مُعلنة. المفهوم من التفعيل:
 * `true`/`1`/`yes`/`on`، ومن التعطيل: `false`/`0`/`no`/`off`، وما سواهما
 * والغياب يعنيان `fallback`.
 *
 * لماذا لا يُرفض المجهول بخطأ إقلاع؟ لأن هذا المتغيّر مُفعِّل ميزة لا مفتاح اتصال:
 * قيمةٌ مكتوبة خطأً تعني «لم يُفعَّل» وهو الحال الافتراضي أصلاً، لا انحرافاً صامتاً.
 * أما أسماء المزوّدات فتُرفض صريحاً لأن الخطأ فيها يعني خدمةً تعمل بنصف إعداد.
 *
 * **واستُثنيَ من هذا `RUN_WORKER_IN_GATEWAY` في الإنتاجِ وحدَه** (F5-04 · ADR 0063):
 * لم يبقَ مُفعِّلَ ميزةٍ بعدَ فصلِ العاملِ، بل صار إعلانَ موضعِ المهامِّ الدوريّةِ —
 * فيُفحَص قبلَ الوصولِ إلى هاهُنا، ولا يُدركه ردُّ المجهولِ إلى الافتراضِ.
 */
/**
 * إعلانٌ منطقيٌّ إلزاميٌّ في الإنتاجِ: يُعيدُ الخطأَ إن غابَ المتغيّرُ أو حملَ قيمةً
 * خارجَ `BOOLEAN_ENV_LITERALS`، و`null` إن كانَ سليماً.
 *
 * ## ولمَ دالّةٌ واحدةٌ لا كتلتانِ متجاورتان
 *
 * لأنّ المفتاحَينِ (`RUN_WORKER_IN_GATEWAY` · `RUN_ADMIN_IN_GATEWAY`) يخضعانِ
 * **لنفسِ العقدِ حرفاً**: غيابٌ ⇒ سقوطٌ، وقيمةٌ لا تُفهَم ⇒ سقوطٌ، ولا ردَّ إلى
 * الافتراضِ في الإنتاج. وكتلتانِ منسوختانِ تعنيانِ أنّ تصحيحَ رسالةٍ أو توسيعَ
 * القائمةِ في إحداهما يترك الأخرى — وهو بالضبطِ الانحرافُ الذي يشكو منه `R-17`
 * في مستوى الشيفرةِ لا الضبط.
 *
 * وما **لا** يُوحَّدُ: السببُ المكتوبُ لكلِّ مفتاحٍ. فهو مُفصَّلٌ عندَ حقلِهِ في
 * `AppConfig` لأنّ الخطأَ الذي يمنعُهُ كلٌّ منهما مختلفٌ اختلافاً تامّاً — توقّفٌ
 * صامتٌ في الأوّلِ، وعزلٌ وهميٌّ في الثاني.
 */
function declaredBooleanError(
  env: string,
  raw: string,
  key: string,
  absenceHint: string,
): InvalidEnvVarError | null {
  if (env !== "production") return null;
  if (isBlank(raw)) return new InvalidEnvVarError(key, absenceHint);
  if (!(BOOLEAN_ENV_LITERALS as readonly string[]).includes(raw.trim().toLowerCase())) {
    return new InvalidEnvVarError(
      key,
      `قيمةٌ لا تُفهَم — المتاح: ${BOOLEAN_ENV_LITERALS.join(" · ")}. ولا تُردُّ المجهولةُ إلى الافتراضِ: من كتبها قصدَ شيئاً، وردُّها صمتاً يجعلُ الموضعَ غيرَ الذي ضُبِط`,
    );
  }
  return null;
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (isBlank(value)) return fallback;
  const normalized = (value as string).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

/**
 * يقرأ عدداً موجباً من البيئة، أو `null` إن لم يُضبَط.
 *
 * والقيمةُ المكتوبةُ خطأً تُرفض عند الإقلاع ولا تُهمَل إلى الافتراض: إهمالُها
 * يعني مشغّلاً ضبط حدّاً وظنّ أنّه سرى، وهو نفس وهم التحكّم الذي نُصلحه هنا.
 */
function readPositiveNumber(
  raw: string | undefined,
  key: string,
): Result<number | null, ConfigError> {
  if (isBlank(raw)) return ok(null);
  const value = Number((raw as string).trim());
  if (!Number.isFinite(value) || value <= 0) {
    return err(new InvalidEnvVarError(key, `يجب أن يكون عدداً موجباً — وردت: ${raw as string}`));
  }
  return ok(value);
}

/** كل المتغيرات الناقصة، لا أولها فقط — ليعرف المشغّل ما ينقصه في نظرة واحدة. */
export function missingEnvKeys(
  source: Record<string, string | undefined> = process.env,
): readonly RequiredEnvKey[] {
  return REQUIRED_ENV_KEYS.filter((key) => isBlank(source[key]));
}

/**
 * يقرأ الإعدادات ويعيد Result — بلا throw، ويجمع كل النواقص معاً.
 * لا يقرأ أي قيمة تجارية: تلك مكانها platform_settings.
 */
export function tryLoadConfig(
  source: Record<string, string | undefined> = process.env,
): Result<AppConfig, ConfigError> {
  const missing = missingEnvKeys(source);
  if (missing.length > 0) return err(new MissingEnvVarError(missing));

  const rawPort = source.PORT ?? "3000";
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return err(new InvalidEnvVarError("PORT", `ليس منفذاً صالحاً: ${rawPort}`));
  }

  const rawEnv = source.NODE_ENV ?? "development";
  const env: EnvName = rawEnv === "production" || rawEnv === "test" ? rawEnv : "development";

  const supabaseUrl = source.SUPABASE_URL as string;
  if (!supabaseUrl.startsWith("https://")) {
    return err(new InvalidEnvVarError("SUPABASE_URL", "يجب أن يبدأ بـ https://"));
  }

  const databaseUrl = source.DATABASE_URL as string;
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    return err(
      new InvalidEnvVarError("DATABASE_URL", "يجب أن يبدأ بـ postgres:// أو postgresql://"),
    );
  }

  // سرّ الويبهوك هو الشيء الوحيد الذي يفصل بين تحديث تلغرام حقيقي وتحديث
  // مزوَّر. ونموذج الهوية كله يثق بـ `update.message.from.id` بعد اجتيازه، أي
  // أن تخمين هذا السرّ = انتحال أي سائق أو راكب. الوثائق تشترط ≥٣٢ محرفاً منذ
  // البداية (docs/render-deployment-vars.md) لكن لم يُفرض ذلك في أي مكان، فبقي
  // الشرط توصيةً تُخالَف بلا إنذار. الفرض هنا في الإنتاج وحده كي لا تُكسر
  // اختبارات الوحدة التي تستعمل أسراراً قصيرة عمداً.
  // المحارف المسموحة هي ما يقبله تلغرام نفسه في secret_token.
  const telegramWebhookSecret = source.TELEGRAM_WEBHOOK_SECRET as string;
  if (env === "production") {
    if (telegramWebhookSecret.length < MIN_WEBHOOK_SECRET_LENGTH) {
      return err(
        new InvalidEnvVarError(
          "TELEGRAM_WEBHOOK_SECRET",
          `يجب ألا يقلّ عن ${MIN_WEBHOOK_SECRET_LENGTH} محرفاً في الإنتاج — وردت ${telegramWebhookSecret.length}`,
        ),
      );
    }
    if (!TELEGRAM_SECRET_CHARSET.test(telegramWebhookSecret)) {
      return err(
        new InvalidEnvVarError(
          "TELEGRAM_WEBHOOK_SECRET",
          "يقبل تلغرام في secret_token المحارف A-Z a-z 0-9 _ - فقط",
        ),
      );
    }
  }

  // سرُّ جلسةِ التطبيقِ المصغَّر: اختياريٌّ، لكنْ إن ورد فطولُه شرطٌ في كلِّ بيئة.
  // سرٌّ قصيرٌ ليس «ضبطاً ناقصاً» بل توقيعٌ قابلٌ للتخمين، فيُرفض صريحاً بدلاً من
  // أن يمضي النظامُ موقِّعاً جلساتٍ بسرٍّ لا يحمي.
  // `LOAD-01 Recovery` — سرُّ الإشارةِ الداخليِّ ورابطُ البوابةِ: اختياريانِ،
  // وغيابُهما يعطّلُ مسارَ الإشارةِ (البطاقةُ البديلةُ كما كانَت) لا يفطرُهُ
  // على قيمةٍ مفتوحةٍ. السرُّ القصيرُ يُرفَضُ صريحًا لا يُقبَلُ ضعيفًا.
  const internalSignalSecret = isBlank(source.INTERNAL_SIGNAL_SECRET)
    ? null
    : (source.INTERNAL_SIGNAL_SECRET as string).trim();
  if (internalSignalSecret !== null && internalSignalSecret.length < 16) {
    return err(
      new InvalidEnvVarError(
        "INTERNAL_SIGNAL_SECRET",
        `يجب ألا يقلّ عن 16 محرفاً — وردت ${internalSignalSecret.length}`,
      ),
    );
  }
  let gatewayInternalUrl: string | null = null;
  if (!isBlank(source.GATEWAY_INTERNAL_URL)) {
    try {
      gatewayInternalUrl = new URL(source.GATEWAY_INTERNAL_URL as string).toString();
    } catch {
      return err(new InvalidEnvVarError("GATEWAY_INTERNAL_URL", "ليس رابطًا صالحًا"));
    }
  }
  const miniappSessionSecret = isBlank(source.MINIAPP_SESSION_SECRET)
    ? null
    : (source.MINIAPP_SESSION_SECRET as string).trim();
  if (miniappSessionSecret !== null && miniappSessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    return err(
      new InvalidEnvVarError(
        "MINIAPP_SESSION_SECRET",
        `يجب ألا يقلّ عن ${MIN_SESSION_SECRET_LENGTH} محرفاً — وردت ${miniappSessionSecret.length}`,
      ),
    );
  }

  const adminBreakGlassTotpKey = isBlank(source.ADMIN_BREAK_GLASS_TOTP_KEY)
    ? null
    : (source.ADMIN_BREAK_GLASS_TOTP_KEY as string).trim();
  if (adminBreakGlassTotpKey !== null && !/^[A-Za-z0-9+/=]+$/.test(adminBreakGlassTotpKey)) {
    return err(
      new InvalidEnvVarError(
        "ADMIN_BREAK_GLASS_TOTP_KEY",
        "مفتاحُ تشفيرِ TOTP يقبلُ ترميزَ قاعدةِ 64 فقط (A-Za-z0-9+/=)",
      ),
    );
  }
  if (adminBreakGlassTotpKey !== null && Buffer.byteLength(adminBreakGlassTotpKey, "utf8") < 32) {
    return err(
      new InvalidEnvVarError(
        "ADMIN_BREAK_GLASS_TOTP_KEY",
        `مفتاحُ تشفيرِ TOTP لا يقلُّ عن 32 بايتًا — وردت ${Buffer.byteLength(adminBreakGlassTotpKey, "utf8")} بايتًا`,
      ),
    );
  }

  const bootstrapAdminTelegramId = (source.BOOTSTRAP_ADMIN_TELEGRAM_ID as string).trim();
  if (!/^\d+$/.test(bootstrapAdminTelegramId)) {
    return err(
      new InvalidEnvVarError("BOOTSTRAP_ADMIN_TELEGRAM_ID", "يجب أن يكون معرّف تلغرام رقمياً"),
    );
  }

  const rawProvider = (source.TRANSLATION_PROVIDER ?? "none").trim().toLowerCase();
  if (!(TRANSLATION_PROVIDER_NAMES as readonly string[]).includes(rawProvider)) {
    return err(
      new InvalidEnvVarError(
        "TRANSLATION_PROVIDER",
        `المتاح: ${TRANSLATION_PROVIDER_NAMES.join(", ")} — وردت: ${rawProvider}`,
      ),
    );
  }
  const translationProvider = rawProvider as TranslationProviderName;

  const rawSessionStore = (source.SESSION_STORE ?? "memory").trim().toLowerCase();
  if (!(SESSION_STORE_NAMES as readonly string[]).includes(rawSessionStore)) {
    return err(
      new InvalidEnvVarError(
        "SESSION_STORE",
        `المتاح: ${SESSION_STORE_NAMES.join(", ")} — وردت: ${rawSessionStore}`,
      ),
    );
  }

  /**
   * SCL-002 — في الإنتاجِ لا يُسمَحُ بمخزنِّ الجلساتِ في الذاكرةِ. جلساتُ الذاكرةِ
   * تُمحى عندَ إعادةِ التشغيلِ ولا تُشارَكُ بينَ النسخِ ولا تحملُ CAS (BUG-007)،
   * فيُخفي اختيارُها عطلاً صامتاً: تحديثٌ متزامنٌ يُفقدُ خطوةَ حوار، وإعادةُ
   * تشغيلٍ تُسقِطُ كلَّ الجلساتِ. فالرفضُ عندَ الإقلاعِ صريحٌ ومُعلَنٌ بدلَ أن
   * يعملَ النظامُ بنصفِ ضمانٍ ويُخفقَ عندَ أوّلِ مستخدمٍ حقيقيّ. و`redis` وحدهُ
   * مسموحٌ في الإنتاج، وهو يتطلّبُ `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`
   * المفروضَين أصلاً في `REQUIRED_ENV_KEYS`.
   */
  if (env === "production" && rawSessionStore === "memory") {
    return err(
      new InvalidEnvVarError(
        "SESSION_STORE",
        "memory غير مسموحٍ في الإنتاج — جلساتُ الذاكرةِ تُمحى بإعادةِ التشغيلِ وتُفقدُ خطواتٍ عندَ التزامنِ بلا CAS. اضبط SESSION_STORE=redis",
      ),
    );
  }

  /**
   * `F2-06` — **ولا مسارَ احتياطٍ يُعيدُ الموقعَ الحيَّ من بابٍ آخرَ** (قرارُ المالكِ
   * 2026-09-19: التتبّعُ الحيُّ ممنوعٌ منعاً باتّاً في إنتاجِ الإطلاقِ).
   *
   * قناةُ Socket.IO تُمنَعُ بـ`live-tracking-policy.ts`، وهذا **البابُ الثاني**:
   * `createCustomerLiveRelay` يبثُّ موقعَ السائقِ خريطةً حيّةً **في محادثةِ العميلِ
   * على تلغرام**، وهو التتبّعُ الحيُّ عينُه بمنقولٍ آخرَ. وكانَ افتراضُه
   * `false` — والافتراضُ **ليسَ حدّاً**: متغيّرٌ يُضافُ في لوحةِ Render يُعيدُ
   * البثَّ بلا مراجعةِ كودٍ. فالرفضُ عندَ الإقلاعِ صريحاً أوكَدُ من افتراضٍ
   * صامتٍ. ولا يُحذَفُ المتغيّرُ كي يبقى المسارُ مقيساً خارجَ الإنتاجِ.
   */
  if (env === "production" && parseBooleanEnv(source.LIVE_LOCATION_FALLBACK_ENABLED, false)) {
    return err(
      new InvalidEnvVarError(
        "LIVE_LOCATION_FALLBACK_ENABLED",
        "التتبّعُ الحيُّ ممنوعٌ في الإنتاجِ (F2-06 · قرارُ المالكِ 2026-09-19) — وهذا المتغيّرُ يبثُّ موقعَ السائقِ خريطةً حيّةً في محادثةِ العميلِ. احذفهُ أو اضبطهُ false",
      ),
    );
  }

  /**
   * الطوبولوجيا تُعلَن ولا تُستنتَج (ADR 0051). والقيمةُ غيرُ الصالحةِ **سقوطٌ
   * حتميٌّ** لا ردٌّ إلى الافتراضِ — على نمطِ `SESSION_STORE` لا نمطِ
   * `RUN_WORKER_IN_GATEWAY`: هذا شرطُ صحّةٍ لا مُفعِّلُ ميزةٍ.
   *
   * ## الغيابُ والبطلانُ ليسا شيئاً واحداً — والعقدُ مثبَّتٌ ههنا صراحةً
   *
   * | الحالُ في بيئةِ العمليةِ | الحكمُ | السندُ |
   * | --- | --- | --- |
   * | المفتاحُ **غائبٌ** رأساً | `single-process` — **الافتراضُ المُعلَن** | ADR 0051 §٢-ب |
   * | قيمةٌ **فارغةٌ أو مسافاتٌ** | `InvalidEnvVarError` | كُتِب شيءٌ لم يُفهَم |
   * | قيمةٌ **مجهولةٌ** (`many` …) | `InvalidEnvVarError` | مَن كتبها قصَد شيئاً |
   *
   * والغيابُ ليس صمتاً خطراً: `single-process` **هو حالُ الإنتاجِ اليومَ**
   * (`numInstances: 1`)، فالافتراضُ لا يُخفي طوبولوجيا ثانيةً بل يصف القائمةَ.
   * والقيمةُ المكتوبةُ التي لا تُفهَم تُرَدُّ خطأً لأنّ ردَّها إلى الافتراضِ
   * **صمتٌ من جنسِ ما يشكو منه `R-17`**.
   *
   * **ولا يُقاس على هذا حكمُ ملفِّ النشرِ:** في `render.yaml` يُوجِب
   * `scripts/check-instance-invariant.ts` **إعلاناً صريحاً** ويسقط على غيابِه
   * (`MISSING_PROCESS_TOPOLOGY`) — لأنّ الملفَّ **إعلانُ نيّةٍ يُقرأ بجانبِ
   * `numInstances`** فلا يُقبَل فيه سكوتٌ، بينما البيئةُ **مُشتقَّةٌ منه**.
   * طبقتانِ لهما قاعدتانِ عن قصدٍ (ADR 0051 §٢-ب مقابلَ §٢-هـ).
   */
  const rawProcessTopology = (source.PROCESS_TOPOLOGY ?? "single-process").trim().toLowerCase();
  if (!(PROCESS_TOPOLOGY_NAMES as readonly string[]).includes(rawProcessTopology)) {
    return err(
      new InvalidEnvVarError(
        "PROCESS_TOPOLOGY",
        `المتاح: ${PROCESS_TOPOLOGY_NAMES.join(", ")} — وردت: ${rawProcessTopology}`,
      ),
    );
  }

  const rawTelegramTransport = (source.TELEGRAM_TRANSPORT ?? "real").trim().toLowerCase();
  if (!(TELEGRAM_TRANSPORT_NAMES as readonly string[]).includes(rawTelegramTransport)) {
    return err(
      new InvalidEnvVarError(
        "TELEGRAM_TRANSPORT",
        `المتاح: ${TELEGRAM_TRANSPORT_NAMES.join(", ")} — وردت: ${rawTelegramTransport}`,
      ),
    );
  }
  if (env === "production" && rawTelegramTransport !== "real") {
    return err(
      new InvalidEnvVarError(
        "TELEGRAM_TRANSPORT",
        "لا يُقبل في الإنتاج إلا `real`؛ وأيّ ناقلٍ آخر يعني نظاماً يبتلع إشعارات مستخدميه بصمت",
      ),
    );
  }

  const rawBotSurfaceMode = (source.BOT_SURFACE_MODE ?? "miniapp").trim().toLowerCase();
  if (!(BOT_SURFACE_MODE_NAMES as readonly string[]).includes(rawBotSurfaceMode)) {
    return err(
      new InvalidEnvVarError(
        "BOT_SURFACE_MODE",
        `المتاح: ${BOT_SURFACE_MODE_NAMES.join(", ")} — وردت: ${rawBotSurfaceMode}`,
      ),
    );
  }
  // `ADR 0286` — لا واجهةَ بوتٍ في تشغيلٍ فعليّ: `legacy` مسارُ اختبارِ توافقٍ معزول.
  // في الإنتاج يُرفضُ مطلقاً؛ وخارجَه لا يُقبلُ إلا بعلمٍ صريحٍ من اختبارٍ لا من سهوٍ.
  if (rawBotSurfaceMode === "legacy") {
    const testLegacyOptIn = (source.BOT_SURFACE_TEST_LEGACY ?? "").trim().toLowerCase() === "1";
    if (env === "production" || !testLegacyOptIn) {
      return err(
        new InvalidEnvVarError(
          "BOT_SURFACE_MODE",
          "وضعُ `legacy` مسارُ اختبارِ توافقٍ معزولٌ فقط (`ADR 0286`): Mini App هو سطحُ المنتجِ الوحيد. " +
            (env === "production"
              ? "وهو مرفوضٌ في الإنتاجِ رفضاً قاطعاً."
              : "ويُفعَّلُ خارجَ الإنتاجِ بـ`BOT_SURFACE_TEST_LEGACY=1` صريحاً فقط."),
        ),
      );
    }
  }
  let miniAppUrl: string | null = null;
  if (!isBlank(source.MINIAPP_URL)) {
    const rawMiniAppUrl = (source.MINIAPP_URL as string).trim();
    let parsedMiniAppUrl: URL | null = null;
    try {
      parsedMiniAppUrl = new URL(rawMiniAppUrl);
    } catch {
      parsedMiniAppUrl = null;
    }
    // تيليجرامُ يرفضُ زرَّ `web_app` بغيرِ `https`، ورفضُه يُسقِطُ الرسالةَ كلَّها لا الزرَّ.
    if (parsedMiniAppUrl === null || parsedMiniAppUrl.protocol !== "https:") {
      return err(new InvalidEnvVarError("MINIAPP_URL", "يجب أن يكون رابط https صالحاً"));
    }
    miniAppUrl = parsedMiniAppUrl.toString();
  }
  if (rawBotSurfaceMode === "miniapp" && miniAppUrl === null) {
    return err(
      new InvalidEnvVarError(
        "MINIAPP_URL",
        "مطلوبٌ حين BOT_SURFACE_MODE=miniapp: البوتُ يُحيلُ إلى تطبيقٍ لا يعرفُ عنوانَه",
      ),
    );
  }

  /**
   * `RUN_WORKER_IN_GATEWAY` في الإنتاج: **إعلانٌ إلزاميٌّ صريحٌ لا افتراضٌ** —
   * `F5-04` / `SCL-007` · ADR 0063.
   *
   * ## لمَ تغيَّر الحكمُ اليومَ وقد كان الافتراضُ مقبولاً أمسِ
   *
   * قبلَ فصلِ العاملِ كان طرفا الخطأِ **غيرَ متكافئَين**، والافتراضُ `true` يقع في
   * الطرفِ الرخيصِ منهما: خطأُ `true` مع وجودِ خدمةِ عاملٍ تكرارٌ يبتلعه القفلُ
   * الموزَّعُ (`skipped_locked_elsewhere`)، وخطأُ `false` بلا خدمةِ عاملٍ **توقّفٌ
   * تامٌّ صامتٌ**. فكان الميلُ إلى الطرفِ الرخيصِ صواباً.
   *
   * وبعدَ الفصلِ صار الطرفُ الرخيصُ هو الخطأَ المُتوقَّعَ لا النادر: مَن نسيَ
   * المتغيّرَ في خدمةٍ جديدةٍ يحصل على بوّابةٍ تُشغِّل المهامَّ مرّةً أخرى — أيْ
   * **يُعيد `SCL-007` نفسَه من حيث لا يشعر**، ولا حرفَ يشكو لأنّ القفلَ يُخفي
   * الأثرَ. والحاجزُ الساكنُ في `scripts/check-instance-invariant.ts` يحرس
   * `render.yaml` وحدَه، ولا يرى بيئةً تُضبَط بيدٍ في لوحةِ المنصّةِ.
   *
   * فصار المطلوبُ في الإنتاج **جملةً مكتوبةً** يُقرأ منها أين تعيش المهامُّ، لا
   * سكوتاً يُفسَّر. وفي التطويرِ يبقى الافتراضُ `true` كما كان: مَن يُشغِّل
   * المستودعَ على حاسبِه لا يملك خدمةَ عاملٍ ثانيةً، وإلزامُه بسطرٍ إضافيٍّ
   * ليصيرَ للنظامِ مهامُّ عائقٌ بلا مقابل.
   *
   * ## والقيمةُ التي كُتِبت ولم تُفهَم سقوطٌ كذلك
   *
   * `parseBooleanEnv` تردُّ المجهولَ إلى الافتراضِ صامتةً. وهذا مقبولٌ في مُفعِّلِ
   * ميزةٍ، وغيرُ مقبولٍ ههنا: `RUN_WORKER_IN_GATEWAY=fasle` تُقرأ `true` فتعمل
   * المهامُّ في موضعَين بينما كتبَ المشغّلُ ما يظنُّه إطفاءً — والانحرافُ بين ما
   * ضُبِط وما يعمل هو عينُ ما يشكو منه `R-17`. فالقائمةُ مغلقةٌ ومُعلَنةٌ.
   */
  const runWorkerError = declaredBooleanError(
    env,
    source.RUN_WORKER_IN_GATEWAY ?? "",
    "RUN_WORKER_IN_GATEWAY",
    "إعلانٌ إلزاميٌّ في الإنتاج (F5-04 · ADR 0063): أين تعيش المهامُّ الدوريّةُ جملةٌ تُكتَب لا سكوتٌ يُفسَّر. " +
      "اضبط false إن كانت خدمةُ waslah-worker قائمةً، أو true إن لم تكن — وغيابُ الاثنين معاً يعني ألّا مهمّةَ دوريّةً تُنفَّذ أبداً",
  );
  if (runWorkerError !== null) return err(runWorkerError);

  /**
   * `RUN_ADMIN_IN_GATEWAY` في الإنتاج — `F5-08` / `ARCH-011` · ADR 0064.
   *
   * التعليلُ الكاملُ عندَ حقلِ `runAdminInGateway` في `AppConfig`. وخلاصتُهُ أنّ
   * الخطأَ ههنا لا يُعلِنُ عن نفسِهِ بعطلٍ: لوحةٌ تعملُ من أصلَينِ حالٌ صحيحةٌ
   * ظاهراً وباطنُها أنّ العزلَ المدفوعَ ثمنُهُ غيرُ قائمٍ. فلا يُقبَلُ فيه سكوتٌ.
   */
  const runAdminError = declaredBooleanError(
    env,
    source.RUN_ADMIN_IN_GATEWAY ?? "",
    "RUN_ADMIN_IN_GATEWAY",
    "إعلانٌ إلزاميٌّ في الإنتاج (F5-08 · ADR 0064): أين يعيشُ سطحُ لوحةِ الإدارةِ جملةٌ تُكتَب لا سكوتٌ يُفسَّر. " +
      "اضبط false إن كانت خدمةُ waslah-admin قائمةً، أو true إن لم تكن — وإبقاؤُها في البوّابةِ مع وجودِ الخدمةِ يعني لوحةً في موضعَينِ وعزلاً وهميّاً",
  );
  if (runAdminError !== null) return err(runAdminError);

  // مزوّد الخريطة يُرفض إن كان مجهولاً في كلّ البيئات، لا في الإنتاج وحده كما في
  // `RUN_WORKER_IN_GATEWAY` أعلاه: قيمةٌ مكتوبةٌ خطأً هنا تعني مشغّلاً يظنّ أنه فعّل
  // خريطةً لم تُفعَّل، وهو انحرافٌ صامت بين ما ضُبِط وما يعمل — والمحليُّ فيه مقدرةٌ
  // على التجربة فلا يُعفَى، بخلاف خدمةِ عاملٍ لا يملكها مُطوّرٌ.
  const rawMapProvider = (source.MAP_PROVIDER ?? "none").trim().toLowerCase();
  if (!(MAP_PROVIDER_NAMES as readonly string[]).includes(rawMapProvider)) {
    return err(
      new InvalidEnvVarError(
        "MAP_PROVIDER",
        `المتاح: ${MAP_PROVIDER_NAMES.join(", ")} — وردت: ${rawMapProvider}`,
      ),
    );
  }

  // مزوّد التوجيه — نفس منهاج `MAP_PROVIDER`: قيمةٌ مجهولةٌ تُرفض عند الإقلاع لا
  // تُهمَل، لأنّ إهمالها يعني مشغّلاً يظنّ أنّه فعّل زمنَ وصولٍ لم يُفعَّل.
  const rawRoutingProvider = (source.ROUTING_PROVIDER ?? "none").trim().toLowerCase();
  if (!(ROUTING_PROVIDER_NAMES as readonly string[]).includes(rawRoutingProvider)) {
    return err(
      new InvalidEnvVarError(
        "ROUTING_PROVIDER",
        `المتاح: ${ROUTING_PROVIDER_NAMES.join(", ")} — وردت: ${rawRoutingProvider}`,
      ),
    );
  }

  const osrmBaseUrl = isBlank(source.OSRM_BASE_URL)
    ? null
    : (source.OSRM_BASE_URL as string).trim();

  /**
   * `ROUTING_PROVIDER=osrm` بلا عنوانٍ يُرفض عند الإقلاع.
   *
   * وهذا بالضبط ما لم يكن موجوداً حتى المرحلة ١٥: `OSRM_BASE_URL` كان مُعلَناً في
   * `.env.example` و`render.yaml` ولا يُقرأ في الضبط أصلاً (الخطر R-28). فكان
   * المشغّلُ يضبطه فلا يحدث شيء، ولا رسالةَ خطأٍ تُخبره — أسوأ من غيابٍ صريح.
   * والرفضُ هنا لا في أوّل نداءٍ توجيه: خطأُ ضبطٍ يجب أن يراه المشغّل لا العميل.
   */
  if (rawRoutingProvider === "osrm" && osrmBaseUrl === null) {
    return err(new InvalidEnvVarError("OSRM_BASE_URL", "مطلوب مع ROUTING_PROVIDER=osrm"));
  }

  // عنوانٌ غيرُ صالحٍ يُرفض هنا أيضاً: `new URL` في المزوّد كان سيُلقي استثناءً في
  // أوّل نداءٍ — أي في وجه عميلٍ ينتظر، لا في سجلّ إقلاعٍ يقرؤه المشغّل.
  if (osrmBaseUrl !== null && !/^https?:\/\/.+/i.test(osrmBaseUrl)) {
    return err(
      new InvalidEnvVarError("OSRM_BASE_URL", `يجب أن يبدأ بـhttp(s):// — وردت: ${osrmBaseUrl}`),
    );
  }

  // `REQ-09` · `ADR 0190`: الحدُّ المُعلَنُ في عقدِ الحسابِ.
  let routingRateLimit: RoutingRateLimit | null = null;
  if (!isBlank(source.ROUTING_RATE_LIMIT)) {
    const parsed = parseRoutingRateLimit(source.ROUTING_RATE_LIMIT as string);
    if (typeof parsed === "string") {
      return err(new InvalidEnvVarError("ROUTING_RATE_LIMIT", parsed));
    }
    routingRateLimit = parsed;
  }
  if (env === "production" && rawRoutingProvider !== "none" && routingRateLimit === null) {
    return err(
      new InvalidEnvVarError(
        "ROUTING_RATE_LIMIT",
        "مطلوبٌ في الإنتاجِ مع مزوّدِ توجيهٍ: انقلْ حدَّ عقدِ الحسابِ (REQ-09)",
      ),
    );
  }

  const trackingTokenBaseUrl = isBlank(source.TRACKING_TOKEN_BASE_URL)
    ? null
    : (source.TRACKING_TOKEN_BASE_URL as string).trim();

  // أساسٌ غيرُ صالح يُرفض عند الإقلاع لا عند أوّل إصدارٍ: الرابطُ يُرسَل مرّةً إلى
  // عميلٍ فلا يُصلَح بعدها، فخطأُ الشكل يجب أن يُوقف الإقلاع.
  if (trackingTokenBaseUrl !== null && !/^https?:\/\/.+/i.test(trackingTokenBaseUrl)) {
    return err(
      new InvalidEnvVarError(
        "TRACKING_TOKEN_BASE_URL",
        `يجب أن يبدأ بـhttp(s):// — وردت: ${trackingTokenBaseUrl}`,
      ),
    );
  }

  // في الإنتاج `http://` غيرُ مقبول: الرمزُ نفسُه هو كلمةُ السرّ، وإرسالُه في
  // مسارٍ غير مُشفَّر يُسلّمه لكلّ وسيطٍ على الطريق.
  if (env === "production" && trackingTokenBaseUrl !== null) {
    if (!trackingTokenBaseUrl.toLowerCase().startsWith("https://")) {
      return err(
        new InvalidEnvVarError("TRACKING_TOKEN_BASE_URL", "يجب أن يبدأ بـhttps:// في الإنتاج"),
      );
    }
  }

  /**
   * دفعُ المقاييس إلى مُجمِّعٍ مركزيّ (`F5-07` / `SCL-006` · ADR 0062).
   *
   * الغيابُ إطفاءٌ صريحٌ لا خطأ. أمّا القيمةُ المكتوبةُ التي لا تصلح فسقوطٌ عند
   * الإقلاع: من ضبط نقطةَ مُجمِّعٍ يظنّ أنّ مقاييسَه تصل، ونظامٌ يبتلع خطأَ ضبطِه
   * صامتاً يترك المشغّلَ يقرأ لوحةً فارغةً ويظنّ أنّ النظامَ هادئ.
   */
  const metricsExportEndpoint = isBlank(source.METRICS_EXPORT_ENDPOINT)
    ? null
    : (source.METRICS_EXPORT_ENDPOINT as string).trim();
  if (metricsExportEndpoint !== null) {
    if (!/^https?:\/\/.+/i.test(metricsExportEndpoint)) {
      return err(new InvalidEnvVarError("METRICS_EXPORT_ENDPOINT", "يجب أن يبدأ بـhttp(s)://"));
    }
    // في الإنتاج `http://` مرفوض: الجسمُ يحمل أحجامَ الأعمالِ وأوقاتَ الذروة،
    // والترويسةُ تحمل رمزَ اعتمادِ المُجمِّع — كلاهما مكشوفٌ لكلّ وسيطٍ على الطريق.
    if (env === "production" && !metricsExportEndpoint.toLowerCase().startsWith("https://")) {
      return err(
        new InvalidEnvVarError("METRICS_EXPORT_ENDPOINT", "يجب أن يبدأ بـhttps:// في الإنتاج"),
      );
    }
  }

  const rawMetricsExportHeaders = isBlank(source.METRICS_EXPORT_HEADERS)
    ? ""
    : (source.METRICS_EXPORT_HEADERS as string);
  const parsedMetricsHeaders = parseMetricsExportHeaders(rawMetricsExportHeaders);
  if (!parsedMetricsHeaders.ok) {
    return err(new InvalidEnvVarError("METRICS_EXPORT_HEADERS", parsedMetricsHeaders.error));
  }

  const rawMetricsInterval = isBlank(source.METRICS_EXPORT_INTERVAL_SECONDS)
    ? `${DEFAULT_METRICS_EXPORT_INTERVAL_SECONDS}`
    : (source.METRICS_EXPORT_INTERVAL_SECONDS as string).trim();
  // ولماذا تُفحَص الصيغةُ قبلَ التحويل؟ لأنّ `parseInt("1.5")` يردُّ `1` و`parseInt("30s")`
  // يردُّ `30`، فيُقبَل مُدخَلٌ خاطئٌ بمعنىً غيرِ ما قصدَه المشغّل ولا حرفَ يشكو.
  const metricsIntervalSeconds = /^\d+$/.test(rawMetricsInterval)
    ? Number.parseInt(rawMetricsInterval, 10)
    : Number.NaN;
  if (
    !Number.isInteger(metricsIntervalSeconds) ||
    metricsIntervalSeconds < MIN_METRICS_EXPORT_INTERVAL_SECONDS ||
    metricsIntervalSeconds > MAX_METRICS_EXPORT_INTERVAL_SECONDS
  ) {
    return err(
      new InvalidEnvVarError(
        "METRICS_EXPORT_INTERVAL_SECONDS",
        `عددٌ صحيحٌ بين ${MIN_METRICS_EXPORT_INTERVAL_SECONDS} و${MAX_METRICS_EXPORT_INTERVAL_SECONDS} — وردت: ${rawMetricsInterval}`,
      ),
    );
  }

  const metricsExport: MetricsExportConfig = {
    endpoint: metricsExportEndpoint,
    headers: parsedMetricsHeaders.value,
    intervalSeconds: metricsIntervalSeconds,
    serviceInstanceId: isBlank(source.SERVICE_INSTANCE_ID)
      ? null
      : (source.SERVICE_INSTANCE_ID as string).trim(),
  };

  const translationApiKey = isBlank(source.TRANSLATION_API_KEY)
    ? null
    : (source.TRANSLATION_API_KEY as string).trim();

  // المزوّد المضبوط بلا مفتاحه يفشل عند أول رسالة لا عند الإقلاع، وهذا أسوأ
  // أنواع الفشل: يظهر للمستخدم لا للمشغّل. فيُرفض هنا صريحاً.
  if (
    (translationProvider === "deepl" || translationProvider === "google") &&
    translationApiKey === null
  ) {
    return err(
      new InvalidEnvVarError(
        "TRANSLATION_API_KEY",
        `مطلوب مع TRANSLATION_PROVIDER=${translationProvider}`,
      ),
    );
  }

  /**
   * حدود التتبّع. تُقرأ كلّها ويُجمَع أوّل خطأٍ فيها — والقراءة هنا لا في طبقة
   * التتبّع كي يفشل الإقلاع في وجه المشغّل لا أوّلُ إصلاحةِ GPS في وجه سائق.
   */
  const trackingReads = {
    gpsIntervalSeconds: readPositiveNumber(
      source.TRACKING_GPS_INTERVAL_SECONDS,
      "TRACKING_GPS_INTERVAL_SECONDS",
    ),
    gpsIdleIntervalSeconds: readPositiveNumber(
      source.TRACKING_GPS_IDLE_INTERVAL_SECONDS,
      "TRACKING_GPS_IDLE_INTERVAL_SECONDS",
    ),
    minDistanceMeters: readPositiveNumber(
      source.TRACKING_MIN_DISTANCE_METERS,
      "TRACKING_MIN_DISTANCE_METERS",
    ),
    teleportThresholdMeters: readPositiveNumber(
      source.TRACKING_TELEPORT_THRESHOLD_METERS,
      "TRACKING_TELEPORT_THRESHOLD_METERS",
    ),
    maxReasonableSpeedKmh: readPositiveNumber(
      source.TRACKING_MAX_REASONABLE_SPEED_KMH,
      "TRACKING_MAX_REASONABLE_SPEED_KMH",
    ),
    maxAccuracyMeters: readPositiveNumber(
      source.TRACKING_MAX_ACCURACY_METERS,
      "TRACKING_MAX_ACCURACY_METERS",
    ),
    maxTimeDriftSeconds: readPositiveNumber(
      source.TRACKING_MAX_TIME_DRIFT_SECONDS,
      "TRACKING_MAX_TIME_DRIFT_SECONDS",
    ),
  } as const;
  for (const read of Object.values(trackingReads)) {
    if (!read.ok) return err(read.error);
  }
  const tracking: TrackingEnvOverrides = {
    gpsIntervalSeconds: trackingReads.gpsIntervalSeconds.ok
      ? trackingReads.gpsIntervalSeconds.value
      : null,
    gpsIdleIntervalSeconds: trackingReads.gpsIdleIntervalSeconds.ok
      ? trackingReads.gpsIdleIntervalSeconds.value
      : null,
    minDistanceMeters: trackingReads.minDistanceMeters.ok
      ? trackingReads.minDistanceMeters.value
      : null,
    teleportThresholdMeters: trackingReads.teleportThresholdMeters.ok
      ? trackingReads.teleportThresholdMeters.value
      : null,
    maxReasonableSpeedKmh: trackingReads.maxReasonableSpeedKmh.ok
      ? trackingReads.maxReasonableSpeedKmh.value
      : null,
    maxAccuracyMeters: trackingReads.maxAccuracyMeters.ok
      ? trackingReads.maxAccuracyMeters.value
      : null,
    maxTimeDriftSeconds: trackingReads.maxTimeDriftSeconds.ok
      ? trackingReads.maxTimeDriftSeconds.value
      : null,
  };

  return ok({
    env,
    port,
    supabaseUrl,
    databaseUrl,
    supabaseServiceKey: source.SUPABASE_SERVICE_ROLE_KEY as string,
    redisUrl: source.UPSTASH_REDIS_REST_URL as string,
    redisToken: source.UPSTASH_REDIS_REST_TOKEN as string,
    driverBotToken: source.DRIVER_BOT_TOKEN as string,
    riderBotToken: source.RIDER_BOT_TOKEN as string,
    telegramWebhookSecret,
    bootstrapAdminTelegramId,
    translationProvider,
    translationApiKey,
    translationContactEmail: isBlank(source.TRANSLATION_CONTACT_EMAIL)
      ? null
      : (source.TRANSLATION_CONTACT_EMAIL as string).trim(),
    sessionStore: rawSessionStore as SessionStoreName,
    processTopology: rawProcessTopology as ProcessTopologyName,
    telegramTransport: rawTelegramTransport as TelegramTransportName,
    botSurfaceMode: rawBotSurfaceMode as BotSurfaceModeName,
    miniAppUrl,
    // الافتراض `true` لا `false`، وهذا قلبٌ متعمّد للافتراض القديم. وجها الخطأ ليسا
    // متكافئين: خطأ `true` مع وجود خدمة `waslah-worker` يعني أن القفل الموزّع يجعل
    // إحداهما تتخطّى بحالة `skipped_locked_elsewhere` — أي لا أذى؛ وخطأ `false` بلا تلك
    // الخدمة — وهو واقع الإنتاج المُثبَت في `docs/directive-item-0-live-diagnosis.md` §0.2
    // — يعني أن ولا مهمّة دورية تُنفَّذ أبداً: لا اشتراك ينتهي، ولا عرض يُسقَط بمهلته
    // فيبقى الطلب باحثاً للأبد، ولا توفّر بائت يُطفَأ، ولا نسخة احتياطية تُؤخَذ.
    // الأول تكرارٌ محميّ بقفل، والثاني توقّفٌ تامّ صامت. فمن أراد إطفاءه فليُعلنه
    // بـ`false` صريحة.
    //
    // وبعدَ `F5-04` صار الإعلانُ إلزاميّاً في الإنتاجِ (يُفحَص أعلاه · ADR 0063)،
    // فالافتراضُ `true` ههنا لا يُبلَغ في الإنتاجِ أبداً: هو حالُ التطويرِ وحدَه.
    runWorkerInGateway: parseBooleanEnv(source.RUN_WORKER_IN_GATEWAY, true),
    runAdminInGateway: parseBooleanEnv(source.RUN_ADMIN_IN_GATEWAY, true),
    mapProvider: rawMapProvider as MapProviderName,
    mapStyleUrl: isBlank(source.MAP_STYLE_URL) ? null : (source.MAP_STYLE_URL as string).trim(),
    mapTilesPublicKey: isBlank(source.MAP_TILES_PUBLIC_KEY)
      ? null
      : (source.MAP_TILES_PUBLIC_KEY as string).trim(),
    maplibreSri: isBlank(source.MAPLIBRE_SRI) ? null : (source.MAPLIBRE_SRI as string).trim(),
    routingProvider: rawRoutingProvider as RoutingProviderName,
    osrmBaseUrl,
    routingRateLimit,
    tracking,
    trackingTokenBaseUrl,
    miniappSessionSecret,
    internalSignalSecret,
    gatewayInternalUrl,
    adminBreakGlassTotpKey,
    liveLocationFallbackEnabled: parseBooleanEnv(source.LIVE_LOCATION_FALLBACK_ENABLED, false),
    metricsExport,
  });
}

/**
 * نسخة تُوقف الإقلاع فوراً — تُستخدم في نقطة تشغيل التطبيق فقط،
 * حيث الفشل السريع مطلوب ولا يوجد مستخدم ليتلقى Result.
 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const result = tryLoadConfig(source);
  if (!result.ok) throw result.error;
  return result.value;
}
