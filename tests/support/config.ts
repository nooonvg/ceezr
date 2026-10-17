/**
 * الغرض: ضبطُ اختبارٍ واحد مشترك — أساسٌ ثابت وفروقٌ تُمرَّر صريحةً.
 * الحالة: منفّذ فعلياً — المرحلة 2 وحدة 2-2 (كان مكرّراً في ٢٩ ملف اختبار قبلها).
 * ينتمي إلى: tests/support
 * يُتوقع أن يستخدمه لاحقاً: كل اختبار يبني حاويةً أو خادماً ويحتاج `AppConfig`
 * ملاحظات مستقبلية: أيّ حقلٍ جديد في `AppConfig` يُضاف هنا وحده لا في كل ملف.
 *
 * ولماذا وُلد هذا الملف؟ لأن عقد `AppConfig` كان مكتوباً يدوياً ٢٩ مرّة، وكلُّ
 * نسخةٍ منها ٢٤ حقلاً متطابقةً إلا في حقلٍ أو حقلين. وهذا هو بالضبط صنفُ العطب
 * الذي أفسد `scripts/load-test.ts` وأبطل قياسه: نسخةٌ من عقدٍ تتعفّن خلف أصلها.
 * والفارق الوحيد أن فحص الأنواع كان يحمي هذه النسخ التسعةَ والعشرين من التعفّن
 * الصامت — فحين يُضاف حقل، تسقط ٢٩ ملفاً معاً. حمايةٌ صحيحة لكن كلفتها ٢٩ تعديلاً
 * في كل مرّة، وهي كلفةٌ تدفع نحو الحلول الرخيصة (حقلٌ اختياري، `as` قاسر) التي
 * تُضعف العقد نفسه. فالمعينُ يجعل الكلفة سطراً واحداً.
 *
 * ولماذا لا يُقرأ السرُّ ولا معرّفُ المشرف من الأساس؟ لأنهما يختلفان فعلاً بين
 * الاختبارات: كلُّ ملفٍ يُرسل ترويسةَ `X-Telegram-Bot-Api-Secret-Token` بسرِّه،
 * فتسطيحُها كان سيجعل اختباراتٍ تتحقّق من سرٍّ غير الذي أُرسل. تُمرَّر صريحةً.
 */

import type { AppConfig } from "../../packages/shared/config/index.ts";
import { NO_TRACKING_OVERRIDES } from "../../packages/shared/config/index.ts";

/**
 * الأساس: بيئةُ اختبارٍ بلا خدمةٍ خارجية واحدة — لا خريطة، ولا توجيه، ولا ترجمة،
 * ولا عاملٌ دوريّ في العملية. كلُّ اختبارٍ يحتاج غيرَ ذلك يُعلنه في `overrides`
 * فيظهر الفرقُ في موضع الاستدعاء لا مطموراً في ٢٤ سطراً متشابهة.
 *
 * وقاعدةُ البيانات تُقرأ من `TEST_DATABASE_URL` كما كانت تفعل كلُّ نسخةٍ من قبل،
 * وتسقط إلى عنوانٍ باطلٍ صريح: الاختباراتُ التكاملية تتخطّى نفسها حين لا يوجد
 * عنوان، ولا يجوز أن تصمت باتصالٍ إلى قاعدةٍ أخرى.
 */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: "test",
    port: 3999,
    supabaseUrl: "https://local.test.supabase.co",
    databaseUrl: process.env.TEST_DATABASE_URL ?? "postgres://invalid",
    supabaseServiceKey: "local-test",
    redisUrl: "http://localhost",
    redisToken: "local-test",
    sessionStore: "memory",
    // عمليةٌ واحدةٌ — محورٌ مستقلٌّ عن `sessionStore` (ADR 0051). واختبارٌ يريد
    // طوبولوجيا متعدّدةً يُعلنها في `overrides` فيظهر قصدُه في موضعِ الاستدعاء.
    processTopology: "single-process",
    /**
     * لا مُجمِّعَ مقاييسٍ في الاختبار (`F5-07`). و`endpoint: null` ليست نقصاً في
     * الضبط بل إطفاءٌ مُعلَن: اختبارٌ يدفع إلى الشبكةِ من وراءِ ظهرِ كاتبِه
     * اختبارٌ يُخفق يومَ تنقطع الشبكةُ لا يومَ ينكسر الكود. ومن أراد مُصدِّراً عاملاً
     * أعلنَه في `overrides` ووجّهَه إلى خادمٍ محلّيٍّ يملكُه.
     */
    metricsExport: {
      endpoint: null,
      headers: {},
      intervalSeconds: 15,
      serviceInstanceId: null,
    },
    // `real` وليس `silent`: الاختبارات تمرّر مُرسِلاً ملتقطاً عبر `overrides` في
    // الحاوية، فلا نداء شبكيّ أصلاً. وإعلانه `silent` كان سيكذب على القارئ:
    // الناقل الصامت مسارٌ أخر للقياس، لا وصفاً لما تفعله الاختبارات.
    telegramTransport: "real",
    botSurfaceMode: "legacy",
    miniAppUrl: null,
    driverBotToken: "driver-token",
    riderBotToken: "rider-token",
    telegramWebhookSecret: "integration-secret",
    bootstrapAdminTelegramId: "990001",
    translationProvider: "none",
    translationApiKey: null,
    translationContactEmail: null,
    runWorkerInGateway: false,
    // اللوحةُ **مُركَّبةٌ** في تجهيزِ الاختباراتِ لا مُطفأةٌ (`F5-08`): مسارات
    // `/admin` لها اختباراتُها تركبُ نفسَ التطبيقِ، وإطفاؤُها ههنا كان سيُسقطها
    // جميعاً بـ404 وتُقرأُ كأنّها انحدارٌ في اللوحةِ لا تغييرٌ في التجهيز.
    runAdminInGateway: true,
    mapProvider: "none",
    mapStyleUrl: null,
    mapTilesPublicKey: null,
    maplibreSri: null,
    routingProvider: "none",
    osrmBaseUrl: null,
    routingRateLimit: null,
    tracking: NO_TRACKING_OVERRIDES,
    trackingTokenBaseUrl: null,
    // `null` يعني أنّ مسارَ جلسةِ التطبيقِ المصغَّر غيرُ مُركَّبٍ في الاختبارِ أصلاً
    // (`F1-03`): من أراده يُعلن سرّاً في `overrides` فيظهر الفرقُ في موضعِ الاستدعاء.
    miniappSessionSecret: null,
    // `LOAD-01 Recovery` — مسارُ الإشارةِ الداخليِّ معطَّلٌ في الاختباراتِ ما لم
    // يُطلَبْ (البطاقةُ البديلةُ هيَ المسارَ الافتراضيَّ هناك).
    internalSignalSecret: null,
    gatewayInternalUrl: null,
    /**
     * `SEC-21`: مفتاحُ تشفيرِ أسرارِ TOTP للبابِ الموازي — قيمةٌ اختباريّةٌ
     * ثابتةٌ (لا سرَّ حقيقيًّا: اختبارٌ محليٌّ لا يحمِلُ سرَّ إنتاجٍ)، ومن
     * أراد مفتاحًا مختلفًا أعلنَهُ في `overrides`.
     */
    adminBreakGlassTotpKey: "dGVzdC1icmVhay1nbGFzcy10b3RwLWtleS0zMi1ieXRlcy1sb25n",
    liveLocationFallbackEnabled: false,
    ...overrides,
  };
}
