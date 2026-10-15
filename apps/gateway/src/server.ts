/**
 * الغرض: تركيب تطبيق Hono الفعلي: المسارات، معالجة الأخطاء، ورفض ما لا يُعرَف.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، tests/unit/gateway-*.test.ts
 * ملاحظات مستقبلية: مسارات لوحة الإدارة تُضاف كموجّه منفصل بلا تعديل هذا الملف.
 *
 * `F1-08`: أُضيف وسيطُ معرّفِ الطلبِ **أوّلَ الوسائطِ** (`observability/request-id.ts`)
 * فيلحق `X-Request-Id` كلَّ ردٍّ — ناجحاً كان أو `404` أو استثناءً غيرَ متوقَّعٍ.
 */

import { Hono } from "hono";
import type { OperationalMetrics } from "../../../packages/infrastructure/observability/index.ts";
import { createHttpMetricsMiddleware } from "./observability/http-metrics.ts";
import { createRequestIdMiddleware } from "./observability/request-id.ts";
import { type ConsentRouteDependencies, createConsentRoutes } from "./routes/consents.ts";
import {
  type CoreEventIntakeDependencies,
  createCoreEventIntakeRoutes,
} from "./routes/core-event-intake.ts";
import { createDeliveryRoutes, type DeliveryRouteDependencies } from "./routes/deliveries.ts";
import {
  createDestinationsRoutes,
  type DestinationsRouteDependencies,
} from "./routes/destinations.ts";
import {
  createDriverActivityRoutes,
  type DriverActivityRouteDependencies,
} from "./routes/driver-activity.ts";
import {
  createDriverDeductionsRoutes,
  type DriverDeductionsRouteDependencies,
} from "./routes/driver-deductions.ts";
import {
  createDriverDocumentRoutes,
  type DriverDocumentRouteDependencies,
} from "./routes/driver-documents.ts";
import { createDriverJobRoutes, type DriverJobRouteDependencies } from "./routes/driver-job.ts";
import {
  createDriverLocationRoutes,
  type DriverLocationDependencies,
} from "./routes/driver-location.ts";
import {
  createDriverOfferRoutes,
  type DriverOfferRouteDependencies,
} from "./routes/driver-offers.ts";
import {
  createDriverSubscriptionRoutes,
  type DriverSubscriptionRouteDependencies,
} from "./routes/driver-subscription.ts";
import {
  createDriverSubscriptionInvoiceRoutes,
  type DriverSubscriptionInvoiceRouteDependencies,
} from "./routes/driver-subscription-invoice.ts";
import {
  createDriverVehicleRoutes,
  type DriverVehicleRouteDependencies,
} from "./routes/driver-vehicle.ts";
import { createHealthRoutes, type HealthDependencies } from "./routes/health.ts";
import { createMeRoutes, type MeDependencies } from "./routes/me.ts";
import {
  createDataRightsRoutes,
  type DataRightsRouteDependencies,
} from "./routes/me-data-rights.ts";
import {
  createEmergencyContactRoutes,
  type EmergencyContactRouteDependencies,
} from "./routes/me-emergency-contact.ts";
import {
  createNotificationPrefsRoutes,
  type NotificationPrefsRouteDependencies,
} from "./routes/me-notification-prefs.ts";
import {
  createOperatingCityRoutes,
  type OperatingCityRouteDependencies,
} from "./routes/me-operating-city.ts";
import { createPlacesRoutes, type PlacesRouteDependencies } from "./routes/me-places.ts";
import {
  createNegotiationRoutes,
  type NegotiationRouteDependencies,
} from "./routes/negotiations.ts";
import {
  createNotificationRoutes,
  type NotificationsDependencies,
} from "./routes/notifications.ts";
import { createOnboardingRoutes, type OnboardingRouteDependencies } from "./routes/onboarding.ts";
import { createOrderChatRoutes, type OrderChatRouteDependencies } from "./routes/order-chat.ts";
import {
  createPaymentWebhookRoutes,
  type PaymentWebhookDependencies,
} from "./routes/payment-webhook.ts";
import { createPolicyRoutes, type PolicyRouteDependencies } from "./routes/policy.ts";
import { createQuoteRoutes, type QuoteRouteDependencies } from "./routes/quote.ts";
import { createRidesRoutes, type RidesRouteDependencies } from "./routes/rides.ts";
import { createSafetyRoutes, type SafetyRouteDependencies } from "./routes/safety.ts";
import {
  createSessionRefreshRoutes,
  type SessionRefreshDependencies,
} from "./routes/session-refresh.ts";
import {
  createSessionTelegramRoutes,
  type SessionTelegramDependencies,
} from "./routes/session-telegram.ts";
import { createSupportRoutes, type SupportRouteDependencies } from "./routes/support-tickets.ts";
import {
  createTelegramWebhookRoutes,
  type WebhookDependencies,
} from "./routes/telegram-webhook.ts";

export interface ServerDependencies {
  readonly health: HealthDependencies;
  readonly webhook: WebhookDependencies;
  /** منفذ ويبهوك الدفع — اختياري: يُفعَّل فقط عند توفّر أسرار الدفع (البند 8). */
  readonly paymentWebhook?: PaymentWebhookDependencies;
  /**
   * مسارُ جلسةِ التطبيقِ المصغَّر (`F1-03`) — اختياريٌّ: يُركَّب فقط عند توفّرِ سرِّ
   * التوقيعِ ورمزِ بوتٍ موقِّع. وغيابُه هنا يعني أنّ المسارَ غيرُ موجودٍ أصلاً
   * (`404`)، وحضورُه بلا تبعياتِ تحقّقٍ يعني تعطيلاً معلَناً (`503`).
   */
  readonly sessionTelegram?: SessionTelegramDependencies;
  /**
   * مسارُ تجديدِ الجلسة (`F1-04`) — اختياريٌ بنفسِ منطقِ مسارِ الإنشاء:
   * غيابُه هنا = لا مسار (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَن (`503`).
   */
  readonly sessionRefresh?: SessionRefreshDependencies;
  /**
   * مسارُ قراءةِ الدورِ والحالة (`F1-05`) — اختياريٌّ بنفسِ منطقِ مسارَي الجلسة:
   * غيابُه هنا = لا مسار (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَن (`503`).
   */
  readonly me?: MeDependencies;
  /** تسجيلُ الراكبِ من التطبيقِ المصغَّرِ (`ADR 0213`). */
  readonly onboarding?: OnboardingRouteDependencies;
  /**
   * مسارا الموافقاتِ (`F2-01`) — اختياريّانِ بنفسِ المنطقِ: غيابُهما هنا = لا
   * مسارَ (`404`)، وحضورُهما بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`). ولا يُركَّبانِ
   * مع سرِّ الجلسةِ وحدَه: يحتاجانِ سجلَّ الموافقاتِ في القاعدةِ أيضاً، فلا
   * يُعلَنُ مسارٌ يقبلُ إقراراً لا موضعَ لكتابتِه.
   */
  readonly consents?: ConsentRouteDependencies;
  /**
   * مساراتُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ (`F2-02` / `SR-02`) — كأخواتِها:
   * غيابُ الحقلِ = لا مسارَ (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`).
   */
  readonly places?: PlacesRouteDependencies;
  readonly emergencyContact?: EmergencyContactRouteDependencies;
  /** R1 · ADR 0252: المدينةُ التشغيليّةُ للراكبِ من آخرِ موقعٍ صالح — بنمطِ أخواتِها. */
  readonly operatingCity?: OperatingCityRouteDependencies;
  readonly notificationPrefs?: NotificationPrefsRouteDependencies;
  /**
   * مسارُ السياسةِ (`F12-17`) — اختياريٌّ بنفسِ المنطقِ: غيابُه = لا مسار (`404`)،
   * وحضورُه بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`).
   */
  readonly policy?: PolicyRouteDependencies;
  /**
   * مساراتُ اختيارِ الوجهةِ (`F2-03` / `SR-03`) — كأخواتِها: غيابُ الحقلِ = لا
   * مسارَ (`404`)، وحضورُه بلا تبعياتٍ = تعطيلٌ معلَنٌ (`503`). وهيَ **مفصولةٌ**
   * عن `places` وإن تشاركَتا سرَّ الجلسةِ: مصدرُ صفوفِها ثلاثةٌ لا واحدٌ، ودالّةُ
   * المصادقةِ تقرأُ حدَّ المدينةِ لا جدولَ الأماكنِ.
   */
  readonly destinations?: DestinationsRouteDependencies;
  /** غيابُها يُسقِطُ مسارَ الاقتباسِ من التركيبِ أصلاً (`F2-04`). */
  readonly quote?: QuoteRouteDependencies;
  /**
   * مساراتُ الرحلةِ (`F2-05` / `SR-05`): الإنشاءُ بمفتاحِ تكرارٍ إلزاميٍّ،
   * وقراءةُ حالةِ البحثِ، والإلغاءُ قبلَ الإسنادِ. وغيابُها يُسقِطُها من التركيبِ
   * أصلاً — **ولا يُنشَأُ مسارٌ يُجيبُ بلا كتابةٍ**: إنشاءٌ يعودُ `200` بلا صفٍّ
   * أسوأُ من مسارٍ غائبٍ، لأنَّ الشاشةَ تنتقلُ إلى بحثٍ عن رحلةٍ لا وجودَ لها.
   */
  readonly rides?: RidesRouteDependencies;
  readonly deliveries?: DeliveryRouteDependencies;
  /**
   * سطحُ الاستغاثةِ في التطبيقِ المصغَّرِ (`F2-10` / `SR-14`) — يُركَّبُ معَ سرِّ
   * الجلسةِ. وغيابُه **لا يُعطِّلُ الاستغاثةَ**: مسارُ البوتِ قائمٌ ومستقلٌّ،
   * وهذا سطحٌ ثانٍ على الحاكمِ نفسِه لا بديلٌ عنه.
   */
  readonly safety?: SafetyRouteDependencies;
  /** حقّا البيانةِ (`F2-11`) — غيابُهما تعطيلٌ صريحٌ لا ردٌّ صوريٌّ. */
  readonly dataRights?: DataRightsRouteDependencies;
  /**
   * الدعمُ والشكوى من داخلِ التطبيقِ (`F2-12` / `SR-11`) — يُركَّبُ مع سرِّ
   * الجلسةِ والقاعدةِ. وغيابُه **لا يُغلِقُ بابَ الدعمِ**: قروبُ المدينةِ
   * ومسارُ البوتِ قائمانِ على `open_support_ticket` عينِها، فهذا سطحٌ ثانٍ على
   * الحاكمِ نفسِه لا مصدرُ حقيقةٍ ثانٍ. **وغيابُه يُعلَنُ `503`** ولا يُجابُ
   * بـ`201` بلا تذكرةٍ: مرجعٌ يُعرَضُ ولا تذكرةَ خلفَه أسوأُ من بابٍ مُغلَقٍ.
   */
  readonly support?: SupportRouteDependencies;
  /**
   * وثائقُ السائقِ (`F3-01` / `SD-01` / `SD-02`) — تُركَّبُ مع سرِّ الجلسةِ
   * والقاعدةِ، ومُوقِّعُ الرفعِ **اختياريٌّ داخِلَها**: غيابُ المفتاحِ يُعطِّلُ
   * طلبَ الخانةِ بـ`503` **ولا يُعطِّلُ لوحَ الحالاتِ** — سائقٌ يحتاجُ أن يرى
   * لماذا هو محجوبٌ حتّى لو تعذَّرَ الرفعُ الآنَ. وغيابُ التبعيةِ كلِّها
   * **يُعلَنُ `503`** ولا يُجابُ بلوحٍ فارغٍ يُقرأُ «لا وثيقةَ مطلوبةً».
   */
  readonly driverDocuments?: DriverDocumentRouteDependencies;
  /**
   * عروضُ السائقِ (`F3-02` / `SD-03` / `SD-04`) — تُركَّبُ مع سرِّ الجلسةِ
   * والقاعدةِ. وغيابُها **يُعلَنُ `503`** ولا يُجابُ بلوحٍ فارغٍ: لوحٌ فارغٌ
   * يُقرأُ «لا عملَ الآنَ» فيُغلِقُ السائقُ التطبيقَ والعروضُ تُبَثُّ إليهِ فعلاً.
   * والمساراتُ **لا تُعَطَّلُ بغيابِ موقِّعٍ ولا مزوِّدِ توجيهٍ**: القبولُ
   * فعلُ قاعدةٍ لا فعلُ خدمةٍ خارجيّةٍ.
   */
  readonly driverOffers?: DriverOfferRouteDependencies;
  /**
   * `ADR 0286` — أعمالُ التفاوضِ من التطبيقِ المصغَّرِ: مطالبةُ السائقِ في دورةِ
   * القروبِ وقرارُ الراكبِ (اختيارٌ · اتفاقٌ · تجاوزٌ) عبرَ المنافذِ الذرّيّةِ
   * القائمةِ. وغيابُ سرِّ الجلسةِ **يُسقِطُ السطحَ كلَّه**.
   */
  readonly negotiationApp?: NegotiationRouteDependencies;
  /**
   * مَهمّةُ السائقِ النشطةُ (`F3-03` / `SD-05`) — تُركَّبُ مع سرِّ الجلسةِ
   * والقاعدةِ. وغيابُها **يُعلَنُ `503`** ولا يُجابُ بـ«لا مَهمّةَ لكَ»: سائقٌ
   * في رحلةٍ يقرأُ الفراغَ إلغاءً فيُنزِلُ راكبَه في الطريقِ. **وهيَ سطحٌ
   * منفصلٌ عن العروضِ** لأنَّ حقَّ المَهمّةِ حقُّ إسنادٍ لا حقُّ عرضٍ.
   */
  readonly driverJob?: DriverJobRouteDependencies;
  /** `WR-04` — محادثةُ طرفَي الطلب؛ غيابُها لا يُركِّبُ المسارات. */
  readonly orderChat?: OrderChatRouteDependencies;
  /**
   * حصيلةُ السائقِ وأدائُه (`F3-05` / `SD-06` · `SD-09`) — تُركَّبُ مع سرِّ
   * الجلسةِ والقاعدةِ. و**غيابُها يُعلَنُ `503`** ولا يُجابُ بأصفارٍ: حصيلةٌ
   * صفرٌ تُقرأُ «لم تعملْ» في وجهِ سائقٍ عملَ نهارَه، وذاكَ كذبٌ لا نقصٌ.
   * **وهيَ سطحُ قراءةٍ محضٍ** لا يشاركُ منفذَ المَهمّةِ الكاتبَ: لِئلّا يحملَ
   * قارئُ تقريرٍ سلطةَ ختمِ الأطوارِ.
   */
  readonly driverActivity?: DriverActivityRouteDependencies;
  /**
   * اشتراكُ السائقِ (`F3-06` / `SD-07`) — يُركَّبُ مع سرِّ الجلسةِ والقاعدةِ.
   * وغيابُه **يُعلَنُ `503`** ولا يُجابُ بلوحٍ فارغٍ: لوحٌ بلا أسعارٍ يُقرأُ
   * «لا اشتراكَ» في حينَ أنَّ الأسعارَ موجودةٌ في الإعداداتِ.
   */
  readonly driverSubscription?: DriverSubscriptionRouteDependencies;
  /**
   * فاتورةُ الاشتراكِ وحالُ عمليتِه (`F3-09` / `SD-08`) — يُركَّبُ مع سرِّ الجلسةِ
   * والقاعدةِ. وغيابُه **يُعلَنُ `503`**: وثيقةٌ ضريبيّةٌ إمّا تُصدَرُ كاملةً أو
   * يُقالُ إنَّها لا تُصدَرُ الآنَ — ولا وسطَ بينَهما.
   */
  readonly driverSubscriptionInvoice?: DriverSubscriptionInvoiceRouteDependencies;
  readonly driverDeductions?: DriverDeductionsRouteDependencies;
  readonly driverVehicle?: DriverVehicleRouteDependencies;
  /**
   * مركزُ الإشعاراتِ داخلَ التطبيقِ (`F6-05` / `SS-07`) — يُركَّبُ مع سرِّ الجلسةِ
   * وحدَه. وغيابُه **لا يعطّلُ تصنيفَ الإشعاراتِ**: التصنيفُ في القاعدةِ يعملُ
   * سواءٌ رُكِّبَ هذا السطحُ أم لا، لأنَّ القرارَ الحرجَ لا يُترَكُ لسطحِ قراءةٍ
   * اختياريٍّ في خدمةٍ قد لا تُشغَّل.
   */
  readonly notifications?: NotificationsDependencies;
  /**
   * استقبالُ موقعِ السائقِ (`F4-01`) — يُركَّبُ مع سرِّ الجلسةِ والقاعدةِ. وغيابُه
   * **لا يُوقِفُ استقبالَ المواقعِ**: مسارُ البوتِ يكتبُ في المصدرِ القانونيِّ
   * نفسِه عبرَ حالةِ الاستخدامِ عينِها، فهذا سطحٌ ثانٍ لا مصدرُ حقيقةٍ ثانٍ.
   */
  readonly driverLocation?: DriverLocationDependencies;
  /**
   * `W-5`: بابُ أحداثِ CORE الواردةِ — اختياريٌّ: يُركَّبُ عندَ توفّرِ سرِّ توقيعِ
   * الاشتراكِ والقاعدةِ. وغيابُه هنا يعني `404` لا قبولاً صامتاً؛ وحضورُه بلا
   * سرٍّ سليمٍ يعني تعطيلاً معلَناً (`503`) لا تحقّقاً مُخفَّفاً.
   */
  readonly coreEventIntake?: CoreEventIntakeDependencies;
  /**
   * `F1-08`: مولّدُ معرّفِ الطلب — يُحقَن للاختبارِ وحدَه، وغيابُه يعني
   * `crypto.randomUUID`. ولا يُقرأ رأسُ `X-Request-Id` الوارِدُ من العميلِ في
   * أيِّ حالٍ (ADR 0043).
   */
  readonly newRequestId?: () => string;
  /**
   * `F8-02`: مقاييسُ الحافةِ — يُركَّبُ الوسيطُ **متى وُجِدَ المُسجِّلُ** وحدَه.
   * وغيابُه لا يُغيِّرُ سلوكَ مسارٍ ولا رمزَ حالةٍ: يُفقَدُ العدُّ لا الخدمةُ.
   * وموضعُه **بعدَ معرِّفِ الطلبِ وقبلَ كلِّ مسارٍ**، فيعُدُّ ردَّ `404` وردَّ
   * الاستثناءِ كما يعُدُّ ردَّ المسارِ الناجحِ — وردَّانِ من الثلاثةِ هما ما
   * يحتاجُ المُشغِّلُ عدَّهما فعلاً.
   */
  readonly httpMetrics?: OperationalMetrics;
}

/** PRD-006 · ADR 0250 — قيمةُ HSTS المملوكةُ للبوّابة. */
export const GATEWAY_HSTS_HEADER = "Strict-Transport-Security";
export const GATEWAY_HSTS_VALUE = "max-age=31536000";

export function createServer(deps: ServerDependencies): Hono {
  const app = new Hono();

  // `F1-08`: أوّلُ وسيطٍ قبلَ أيِّ مسارٍ — فمعرّفُ الطلبِ يلحق ردَّ المسارِ
  // وردَّ `404` وردَّ الاستثناءِ سواءً، لا الردودَ الناجحةَ وحدَها.
  app.use(
    "*",
    deps.newRequestId === undefined
      ? createRequestIdMiddleware()
      : createRequestIdMiddleware(deps.newRequestId),
  );

  // PRD-006 · ADR 0250: HSTS سياسةٌ مملوكةٌ للبوّابةِ على كلِّ ردٍّ (المسارُ و`404`
  // والاستثناء)، لا اعتمادًا على حافّةِ المنصّة التي لم تُرسِله حيًّا. سنةٌ بلا
  // `includeSubDomains` ولا `preload`: `onrender.com` نطاقٌ مشتركٌ لا نملكُه — كقاعدةِ
  // التطبيقِ المصغَّرِ في `render.yaml`. والمتصفّحُ يتجاهلُه على HTTP المحلّيّ.
  app.use("*", async (c, next) => {
    await next();
    c.header(GATEWAY_HSTS_HEADER, GATEWAY_HSTS_VALUE);
  });

  // `F8-02`: ثانيَ وسيطٍ — بعدَ معرِّفِ الطلبِ كي يُلحَقَ الرأسُ بالردِّ الذي
  // نعُدُّه، وقبلَ المساراتِ كي يُعَدَّ `404` والاستثناءُ لا الناجحُ وحدَه.
  if (deps.httpMetrics !== undefined) {
    app.use("*", createHttpMetricsMiddleware(deps.httpMetrics));
  }

  app.route("/", createHealthRoutes(deps.health));
  app.route("/", createTelegramWebhookRoutes(deps.webhook));
  if (deps.paymentWebhook !== undefined) {
    app.route("/", createPaymentWebhookRoutes(deps.paymentWebhook));
  }
  if (deps.sessionTelegram !== undefined) {
    // `ADR 0210`: قراءتا الإقلاعِ تُضمَّنانِ في ردِّ المبادلةِ بتبعيّاتِ مسارَيهما نفسِها — لا
    // مصدرَ ثانٍ للحقيقةِ. وغيابُ أيٍّ منهما هنا يعني غيابَها من الردِّ لا غيرُ.
    app.route(
      "/",
      createSessionTelegramRoutes({
        ...deps.sessionTelegram,
        bootstrap: {
          ...(deps.me?.viewer === undefined ? {} : { viewer: deps.me.viewer }),
          ...(deps.consents?.consent === undefined ? {} : { consent: deps.consents.consent }),
        },
      }),
    );
  }
  if (deps.sessionRefresh !== undefined) {
    app.route("/", createSessionRefreshRoutes(deps.sessionRefresh));
  }
  if (deps.me !== undefined) {
    app.route("/", createMeRoutes(deps.me));
  }
  if (deps.onboarding !== undefined) {
    app.route("/", createOnboardingRoutes(deps.onboarding));
  }
  if (deps.consents !== undefined) {
    app.route("/", createConsentRoutes(deps.consents));
  }
  if (deps.places !== undefined) {
    app.route("/", createPlacesRoutes(deps.places));
  }
  if (deps.emergencyContact !== undefined) {
    app.route("/", createEmergencyContactRoutes(deps.emergencyContact));
  }
  if (deps.operatingCity !== undefined) {
    app.route("/", createOperatingCityRoutes(deps.operatingCity));
  }
  if (deps.notificationPrefs !== undefined) {
    app.route("/", createNotificationPrefsRoutes(deps.notificationPrefs));
  }
  if (deps.policy !== undefined) {
    app.route("/", createPolicyRoutes(deps.policy));
  }
  if (deps.quote !== undefined) {
    app.route("/", createQuoteRoutes(deps.quote));
  }
  if (deps.rides !== undefined) {
    app.route("/", createRidesRoutes(deps.rides));
  }
  if (deps.deliveries !== undefined) {
    app.route("/", createDeliveryRoutes(deps.deliveries));
  }
  if (deps.safety !== undefined) {
    app.route("/", createSafetyRoutes(deps.safety));
  }
  if (deps.dataRights !== undefined) {
    app.route("/", createDataRightsRoutes(deps.dataRights));
  }
  if (deps.support !== undefined) {
    app.route("/", createSupportRoutes(deps.support));
  }
  if (deps.driverDocuments !== undefined) {
    app.route("/", createDriverDocumentRoutes(deps.driverDocuments));
  }
  if (deps.driverOffers !== undefined) {
    app.route("/", createDriverOfferRoutes(deps.driverOffers));
  }
  if (deps.negotiationApp !== undefined) {
    app.route("/", createNegotiationRoutes(deps.negotiationApp));
  }
  if (deps.driverJob !== undefined) {
    app.route("/", createDriverJobRoutes(deps.driverJob));
  }
  if (deps.orderChat !== undefined) {
    app.route("/", createOrderChatRoutes(deps.orderChat));
  }
  if (deps.driverActivity !== undefined) {
    app.route("/", createDriverActivityRoutes(deps.driverActivity));
  }
  if (deps.driverSubscription !== undefined) {
    app.route("/", createDriverSubscriptionRoutes(deps.driverSubscription));
  }
  if (deps.driverSubscriptionInvoice !== undefined) {
    app.route("/", createDriverSubscriptionInvoiceRoutes(deps.driverSubscriptionInvoice));
  }
  if (deps.driverDeductions !== undefined) {
    app.route("/", createDriverDeductionsRoutes(deps.driverDeductions));
  }
  if (deps.driverVehicle !== undefined) {
    app.route("/", createDriverVehicleRoutes(deps.driverVehicle));
  }

  if (deps.destinations !== undefined) {
    app.route("/", createDestinationsRoutes(deps.destinations));
  }
  if (deps.notifications !== undefined) {
    app.route("/", createNotificationRoutes(deps.notifications));
  }
  if (deps.driverLocation !== undefined) {
    app.route("/", createDriverLocationRoutes(deps.driverLocation));
  }
  if (deps.coreEventIntake !== undefined) {
    app.route("/", createCoreEventIntakeRoutes(deps.coreEventIntake));
  }

  app.notFound((c) => c.json({ ok: false, error: "NOT_FOUND" }, 404));

  // أي استثناء غير متوقَّع لا يكشف تفاصيل داخلية للمُرسِل
  app.onError((error, c) => {
    deps.webhook.log?.("gateway.webhook_unexpected_error", { message: String(error) });
    return c.json({ ok: false, error: "INTERNAL_ERROR" }, 500);
  });

  return app;
}
