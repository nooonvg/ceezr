/**
 * الغرض: نقطة تشغيل خادم Hono الحقيقي الذي يستقبل Webhooks تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: Render (أمر التشغيل)، docker/Dockerfile.gateway
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد في container.ts.
 */

import http from "node:http";
import { Server as IoServer } from "socket.io";
import {
  ReadUrlSignerAdapter,
  UnconfiguredAssetReader,
} from "../../../packages/application/driver/vehicle-asset-reader.ts";
import { probeTranslation } from "../../../packages/application/i18n-translation/probe-translation.ts";
import { translateMessage } from "../../../packages/application/i18n-translation/translate-message.ts";
import { createDriverPhoneProofs } from "../../../packages/application/identity/onboard-driver.ts";
import { createNegotiationApp } from "../../../packages/application/negotiation/negotiation-app.ts";
import { PortFailureError } from "../../../packages/application/ports/index.ts";
import type { OperatingCityDeps } from "../../../packages/application/rider-city/operating-city.ts";
import type { EmergencyContactDeps } from "../../../packages/application/safety/emergency-contact.ts";
import type { RideRequestCommand } from "../../../packages/application/transport/ride-request-ports.ts";
import { createFulfillmentLifecycle } from "../../../packages/application/wasla/fulfillment-lifecycle.ts";
import { isSupportedLanguage } from "../../../packages/domain/i18n-translation/value-objects.ts";
import { parseCitySettings, subscriptionPriceFor } from "../../../packages/domain/policy/entity.ts";
import type { SubscriptionPlan } from "../../../packages/domain/subscription/entity.ts";
import {
  createConsentRecordReader,
  createConsentRecordWriter,
} from "../../../packages/infrastructure/consent/consent-store.ts";
import { verifySchemaContract } from "../../../packages/infrastructure/db/schema-guard.ts";
import { createPostgresTelegramUpdateQueue } from "../../../packages/infrastructure/db/telegram-update-queue.ts";
import {
  createDestinationResolver,
  createDestinationSearcher,
} from "../../../packages/infrastructure/destinations/destinations-store.ts";
import {
  createTicketThreadReader,
  createTicketThreadWriter,
} from "../../../packages/infrastructure/dispute/ticket-threads-store.ts";
import { PostgresDriverActivityStore } from "../../../packages/infrastructure/driver/driver-activity-store.ts";
import { PostgresDriverDocumentStore } from "../../../packages/infrastructure/driver/driver-documents-store.ts";
import { PostgresDriverJobStore } from "../../../packages/infrastructure/driver/driver-job-store.ts";
import { PostgresDriverOfferStore } from "../../../packages/infrastructure/driver/driver-offers-store.ts";
import { PostgresDriverSubscriptionStore } from "../../../packages/infrastructure/driver/driver-subscription-store.ts";
import { PostgresDriverVehicleStore } from "../../../packages/infrastructure/driver/driver-vehicle-store.ts";
import { PostgresSubscriptionTaxInvoiceStore } from "../../../packages/infrastructure/driver/subscription-invoice-store.ts";
import { createDeductionTraceStore } from "../../../packages/infrastructure/financial/deduction-trace-store.ts";
import {
  createPaymentProvider,
  createPaymentRepository,
  createWebhookEventStore,
} from "../../../packages/infrastructure/financial/index.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import {
  createDriverDirectory,
  createRiderDirectory,
} from "../../../packages/infrastructure/identity/directories.ts";
import { createMemoryInitDataReplayGuard } from "../../../packages/infrastructure/identity/memory-init-data-replay-guard.ts";
import { createMemorySessionRevocationStore } from "../../../packages/infrastructure/identity/memory-session-revocation-store.ts";
import { createMiniAppRefreshTokens } from "../../../packages/infrastructure/identity/miniapp-refresh.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../../packages/infrastructure/identity/miniapp-session.ts";
import { createRedisInitDataReplayGuard } from "../../../packages/infrastructure/identity/redis-init-data-replay-guard.ts";
import { createRedisSessionRevocationStore } from "../../../packages/infrastructure/identity/redis-session-revocation-store.ts";
import { createRevocableSessionReader } from "../../../packages/infrastructure/identity/revocable-session-reader.ts";
import {
  createTelegramInitDataVerifier,
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
} from "../../../packages/infrastructure/identity/telegram-init-data.ts";
import { createViewerAccountReader } from "../../../packages/infrastructure/identity/viewer-account.ts";
import { createViewerAccountLanguageWriter } from "../../../packages/infrastructure/identity/viewer-language.ts";
import { createOrderChatStore } from "../../../packages/infrastructure/messaging/order-chat-store.ts";
import { createNegotiationAppStore } from "../../../packages/infrastructure/negotiation/negotiation-app-store.ts";
import { grammyTelegramSender } from "../../../packages/infrastructure/notification/telegram-api-sender.ts";
import { createUserNotificationCenter } from "../../../packages/infrastructure/notification/user-notification-center.ts";
import {
  createConfiguredMetricsExporter,
  createDatabaseGaugeCollector,
  createOperationalMetrics,
  createStructuredLogger,
} from "../../../packages/infrastructure/observability/index.ts";
import {
  createRecentDestinationReader,
  createSavedPlaceReader,
  createSavedPlaceWriter,
} from "../../../packages/infrastructure/places/places-store.ts";
import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";
import { PostgresDataRightsStore } from "../../../packages/infrastructure/privacy/data-rights-store.ts";
import { createQuoteJudge } from "../../../packages/infrastructure/quote/quote-store.ts";
import { createOperatingCityStore } from "../../../packages/infrastructure/rider-city/operating-city-store.ts";
import { createDriverCannotCompletePort } from "../../../packages/infrastructure/safety/driver-cannot-complete-store.ts";
import {
  createEmergencyContactReader,
  createEmergencyContactWriter,
} from "../../../packages/infrastructure/safety/emergency-contact-store.ts";
import {
  createNotificationPrefsReader,
  createNotificationPrefsWriter,
} from "../../../packages/infrastructure/safety/notification-prefs-store.ts";
import { createSosSurfaceReader } from "../../../packages/infrastructure/safety/sos-surface-store.ts";
import { createJobHeartbeatReader } from "../../../packages/infrastructure/scheduling/job-heartbeat-adapters.ts";
import { HttpObjectContentInspector } from "../../../packages/infrastructure/storage/object-content-inspector.ts";
import { HttpObjectExistenceChecker } from "../../../packages/infrastructure/storage/object-existence-checker.ts";
import {
  HttpReadSigner,
  readSignedReadConfig,
} from "../../../packages/infrastructure/storage/signed-read.ts";
import {
  readSignedUploadConfig,
  selectUploadSigner,
} from "../../../packages/infrastructure/storage/signed-upload.ts";
import { PostgresDriverSupportStore } from "../../../packages/infrastructure/support/driver-support-store.ts";
import { PostgresRiderSupportStore } from "../../../packages/infrastructure/support/rider-support-store.ts";
import { createEtaBandStore } from "../../../packages/infrastructure/tracking/eta-band-store.ts";
import { createActiveRideReader } from "../../../packages/infrastructure/transport/active-ride-store.ts";
import { createRideCandidateStore } from "../../../packages/infrastructure/transport/ride-candidate-store.ts";
import {
  createRideDetailReader,
  createRideHistoryReader,
} from "../../../packages/infrastructure/transport/ride-history-store.ts";
import {
  createRideCancelCommand,
  createRideRequestCommand,
  createRideSearchReader,
} from "../../../packages/infrastructure/transport/ride-request-store.ts";
import { createRideShareReader } from "../../../packages/infrastructure/transport/ride-share-store.ts";
import {
  createRideRatingCommand,
  createRideSummaryReader,
} from "../../../packages/infrastructure/transport/ride-summary-store.ts";
import { createRideTraceReader } from "../../../packages/infrastructure/transport/ride-trace-store.ts";
import { createRiderTripEventsStore } from "../../../packages/infrastructure/transport/rider-trip-events-store.ts";
import { createOperationalJobRepository } from "../../../packages/infrastructure/wasla/operational-job-repository.ts";
import {
  MAPLIBRE_CDN_ORIGIN,
  MAPLIBRE_SRI_UNSET,
  maplibreScriptUrl,
  maplibreStylesheetUrl,
  resolveMapStyle,
} from "../../../packages/maps/index.ts";
import {
  computeConnectionBudget,
  DECLARED_TOPOLOGY,
  describeConnectionBudget,
} from "../../../packages/shared/config/connection-budget.ts";
import { CORE_EVENT_TRANSPORT_ENV } from "../../../packages/shared/config/core-event-transport.ts";
import {
  TELEGRAM_REPLY_POOL_CONCURRENCY,
  TELEGRAM_REPLY_POOL_MAX_QUEUED,
  TELEGRAM_REPLY_POOL_MAX_WAIT_MS,
} from "../../../packages/shared/config/domain-ingress.ts";
import { missingEnvKeys, tryLoadConfig } from "../../../packages/shared/config/index.ts";
import {
  DECIDED_EVENT_DISTRIBUTION,
  singleInstanceInvariantViolation,
} from "../../../packages/shared/config/single-instance.ts";
import type { CityId } from "../../../packages/shared/kernel/index.ts";
import { err, ok } from "../../../packages/shared/result/index.ts";
import { assertEgressEnvironment } from "../../../packages/shared/wasla/egress-gate.ts";
import { jobHealthExpectations } from "../../workers/src/container.ts";
import { createAdminAuthPort } from "./admin/auth.ts";
import { mountAdminSurface } from "./admin/mount.ts";
import { createLoadTrace, type LoadTrace } from "./background/load-trace.ts";
import { createTelegramReplyPool } from "./background/telegram-reply-pool.ts";
import {
  parseTelegramDrainLanes,
  startTelegramUpdateDrainer,
  TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS,
  type TelegramUpdateDrainer,
  wakeDrainerOnEnqueue,
} from "./background/telegram-update-drainer.ts";
import { grammyCommandRegistrar, registerBotCommands } from "./bots/shared/register-commands.ts";
import { buildContainer } from "./container.ts";
import { type EmbeddedWorkerHandle, startEmbeddedWorker } from "./embedded-worker.ts";
import { createJobHealthProbes } from "./job-health.ts";
import { createLifecycle } from "./lifecycle.ts";
import { instrumentPaymentConfirmationDeps } from "./observability/payment.ts";
import {
  instrumentTelegramHandler,
  instrumentUpdateDeduplicator,
  instrumentUpdateIntake,
} from "./observability/telegram.ts";
import { createObservabilityJobLogger } from "./observability/worker.ts";
import { createPublicSecurityHeaders } from "./public/security-headers.ts";
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  type RateLimiter,
} from "./rate-limit/fixed-window.ts";
import { type KeyDimension, rateLimitPolicy } from "./rate-limit/policy.ts";
import {
  JOB_HEALTH_SNAPSHOT_MS,
  REDIS_PING_REMEMBER_MS,
  rememberSuccess,
  SCHEMA_CONTRACT_REMEMBER_MS,
} from "./readiness-memo.ts";
import {
  createActiveRideResolver,
  createOffersSessionVerifier,
  createSessionVerifier,
} from "./realtime/adapters.ts";
import { type ChatChannel, createChatChannel } from "./realtime/chat-channel.ts";
import { createHttpBridge } from "./realtime/http-bridge.ts";
import { isLiveLocationBroadcastPermitted } from "./realtime/live-tracking-policy.ts";
import { createOffersChannel } from "./realtime/offers-channel.ts";
import { createRideChannel } from "./realtime/ride-channel.ts";
import { createRiderTripChannel } from "./realtime/rider-trip-channel.ts";
import { createUpstashRedis, sanitizeUpstashError } from "./redis/upstash.ts";
import type { ProbeOutcome } from "./routes/health.ts";
import { createInternalOffersSignalRoutes } from "./routes/internal-offers-signal.ts";
import { createMetricsRoutes } from "./routes/metrics.ts";
import { createPublicTrackingRoutes } from "./routes/public-tracking.ts";
import { createUpdateDeduplicator } from "./routes/update-dedup.ts";
import { createPostgresUpdateIntake } from "./routes/update-intake.ts";
import { createServer } from "./server.ts";

/**
 * سجلُّ البوابةِ — من المُصدِرِ الوحيدِ لا من دالّةٍ محليّةٍ (`F8-03` · ADR 0078).
 * وقبلَ اليومَ كان هذا الموضعُ يكتبُ `{at, message, ...meta}` **بلا شدّةٍ**، وكانَ
 * العاملُ يكتبُ `{level, message}` **بلا زمنٍ**، فلم يكنْ ترتيبُ حدثٍ بينَ الخدمتَينِ
 * ممكناً ولا تصفيةُ خطأٍ في البوابةِ ممكنةً.
 */
const log = createStructuredLogger({ service: "gateway" });

const configResult = tryLoadConfig(process.env);

if (!configResult.ok) {
  const error = configResult.error;
  // «تعذّر إقلاع البوابة» — نصّاً كانَ على `console.error` بلا بنيةٍ، فلا يُقرأُ آلياً.
  if (error.code === "MISSING_ENV_VARS") {
    log.error("gateway.boot_missing_env", {
      detail: error.message,
      missing_keys: error.keys,
      hint: "أضِف هذه المتغيرات إلى بيئة التشغيل (انظر .env.example)",
    });
  } else {
    log.error("gateway.boot_config_invalid", { reason: error.code, detail: error.message });
  }
  // فشل سريع ومعلَن: أفضل من خادم يعمل بنصف مفاتيح ويفشل عند أول مستخدم حقيقي.
  process.exit(1);
}

const config = configResult.value;

/**
 * حاجزُ تشابكِ الأبوابِ عندَ الإقلاعِ — البندُ `W-6` · `ADR 0086`.
 *
 * وموضعُه بعدَ تحميلِ الضبطِ وقبلَ تركيبِ الحاويةِ: يقرأُ مفاتيحَ البيئةِ التي
 * تُعيِّنُ المقاصدَ، فيسقطُ الإقلاعُ إن كانَ مفتاحُ مقصدٍ مضبوطاً على **بابِ مقصدٍ
 * آخرَ** — كأن يُوجَّهَ `CORE_EVENTS_BASE_URL` إلى بوّابةِ دفعٍ. والبوّابةُ وقتَ
 * النداءِ ترفضُ ذلكَ أيضاً، لكن رفضاً عندَ أوّلِ حدثٍ حقيقيٍّ متأخّرٌ: خدمةٌ قامَت
 * ثمَّ تُخفِقُ نداءً نداءً. وما **لا** يُقاسُ ههنا: أنَّ المضيفَ المضبوطَ هوَ CORE
 * حقّاً — عنوانُه بيئيٌّ لا يعرفُه المستودعُ (`DEP-CORE-005`).
 */
try {
  assertEgressEnvironment(process.env);
} catch (error) {
  log.error("gateway.boot_egress_env_invalid", {
    detail: error instanceof Error ? error.message : String(error),
    hint: "مفتاحُ مقصدٍ مضبوطٌ على بابِ مقصدٍ آخرَ — راجعْ docs/wasla/egress-boundary.md",
  });
  process.exit(1);
}

/**
 * شرطُ صحّةِ النسخةِ الواحدةِ — يُفحَص قبلَ تركيبِ شيءٍ (`R-17` · ADR 0050).
 *
 * وموضعُه ههنا لا في آخرِ الإقلاعِ: خدمةٌ تُنشئ اتّصالاتِ قاعدةٍ وتُسجِّل مسالكَ ثمّ
 * تسقط ليست «فشلاً سريعاً». والفحصُ **بعدَ** تحميلِ الضبطِ لأنّه يقرأ `processTopology`
 * منه، و**قبلَ** الحاوية لأنّ الناقلَ داخلَ العمليةِ يُركَّب فيها.
 *
 * وما يُرفَض ههنا **تنافرٌ مُعلَنٌ** بين الطوبولوجيا وآليةِ التوزيعِ: أكثرُ من
 * عمليةٍ مع ناقلِ أحداثٍ لا يعبر العمليةَ. وليس `SESSION_STORE=redis` مرفوضاً ولا
 * دليلاً على طوبولوجيا — ذاك استدلالٌ معكوسٌ نسخَه `ADR 0051` §١: نسخةٌ واحدةٌ
 * بجلساتٍ في Redis حالةٌ إنتاجيةٌ مشروعةٌ ويجب ألّا يمنعَها النظامُ. وذلك ما
 * يصفه `R-17` بالكسرِ الصامتِ، فصار صاخباً في موضعِه الصحيحِ وحدَه. ولا تجاوزَ
 * بمتغيّرِ بيئةٍ: راجع الترويسةَ في `single-instance.ts`.
 */
const topologyViolation = singleInstanceInvariantViolation({
  topology: config.processTopology,
  sessionStore: config.sessionStore,
  distribution: DECIDED_EVENT_DISTRIBUTION,
});

if (topologyViolation !== null) {
  // «تعذّر إقلاع البوابة» — خرقُ طوبولوجيا العملياتِ.
  log.error("gateway.boot_topology_violation", {
    reason: topologyViolation.code,
    detail: topologyViolation.message,
  });
  process.exit(1);
}

const startedAt = new Date();

/**
 * سجل المقاييس يُنشأ قبل الحاوية لأن `observabilityLog` يُمرَّر إليها. قبل اليوم كانت
 * البوابة عمياء تماماً: لا `/metrics` ولا عدّاد واحد في المستودع كلّه، ومنصّةُ نقلٍ
 * لا تعرف كم طلباً لم يجد سائقاً تُدار بالشكوى لا بالقياس.
 */
const operationalMetrics = createOperationalMetrics();

function observabilityLog(event: string, meta: Record<string, unknown> = {}): void {
  if (event === "dispatch.no_eligible_driver") operationalMetrics.recordDispatchNoDriver();
  log(event, meta);
}

/**
 * مزوّد الدفع الحقيقي — اختياري: يُفعَّل عند توفّر أسراره (البند 8)، وغيابها يُعطّل
 * المسار لا يوقف الإقلاع. لكنّ إعداداً **خاطئاً** لا يُمرّ صامتاً: من كتب
 * `PAYMENT_PROVIDER` وأخطأ في مفاتيحه يظنّ أن الدفع يعمل، فيُعلَن السبب في السجلّ.
 *
 * ولا يُقرأ `PAYMENT_WEBHOOK_SECRET` بعد اليوم: التحقّق صار من اختصاص المحوّل
 * (Moyasar يُثبِت `secret_token` داخل الجسم)، ومقارنةُ سرٍّ مشترك في ترويسة مخترعة
 * كانت تجعل معرفةَ السرّ وحدها كافيةً لتفعيل أي اشتراك بأي مبلغ.
 */
const paymentProviderName = process.env.PAYMENT_PROVIDER ?? "";
const paymentProviderResult =
  paymentProviderName === ""
    ? null
    : createPaymentProvider(paymentProviderName, {
        moyasar: {
          secretKey: process.env.MOYASAR_SECRET_KEY ?? "",
          webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET ?? "",
          callbackUrl: process.env.MOYASAR_CALLBACK_URL ?? "",
          ...(process.env.MOYASAR_SUCCESS_URL === undefined
            ? {}
            : { successUrl: process.env.MOYASAR_SUCCESS_URL }),
          ...(process.env.MOYASAR_BACK_URL === undefined
            ? {}
            : { backUrl: process.env.MOYASAR_BACK_URL }),
        },
        tap: {
          secretKey: process.env.TAP_SECRET_KEY ?? "",
          redirectUrl: process.env.TAP_REDIRECT_URL ?? "",
          ...(process.env.TAP_POST_URL === undefined ? {} : { postUrl: process.env.TAP_POST_URL }),
        },
      });

if (paymentProviderResult === null) {
  // «مزوّد الدفع غير مُعدّ»
  log("payment_provider.not_configured", {
    hint: "اضبط PAYMENT_PROVIDER=tap أو moyasar مع مفاتيحه، أو manual للتفعيل اليدوي عبر الدعم",
  });
} else if (!paymentProviderResult.ok) {
  // لا يُسقِط البوابة: إسقاطها يُفقد البوتَين والرحلات كلّها لأجل الاشتراك وحده،
  // والرحلات لا تتوقّف على مزوّد دفع. ولكنّ الفشل مُعلَن لا مكتوم.
  log.error("payment_provider.config_invalid", {
    provider: paymentProviderName,
    detail: paymentProviderResult.error.detail,
  });
}

const paymentProvider = paymentProviderResult?.ok === true ? paymentProviderResult.value : null;

// التركيب الحقيقي: اتصال قاعدة واحد ومحوّلات فعلية لكل منفذ.
const container = buildContainer(config, {
  log: observabilityLog,
  paymentProvider,
  metrics: operationalMetrics,
});
const databaseGauges = createDatabaseGaugeCollector(container.sql, operationalMetrics);

/**
 * دفعُ المقاييس إلى مُجمِّعٍ مركزيّ — `F5-07` / `SCL-006` (ADR 0062).
 *
 * `GET /metrics` يعرض **العمليّةَ التي أجابت** لا النظام. فما دامت نسخةٌ واحدةٌ فلا
 * فرق؛ فإذا صار خلفَ المُوجِّهِ ثلاثُ نسخٍ (`F5-06`) أو انفصل العاملُ (`F5-04`) صار
 * كلُّ كشطٍ يقرأ عمليّةً عشوائيّةً ولا يُقرأ مجموعُ النظامِ من أيِّ موضع. فالدفعُ
 * هنا هو ما يجعل تينك الخطوتَين ممكنتَين لا مُعمِيتَين.
 *
 * و`null` تعني «لا مُجمِّعَ مضبوطاً» — وهو حالُ الإنتاجِ اليومَ — فلا يعمل شيءٌ ولا
 * يُسجَّل خطأ. و`GET /metrics` يبقى كما هو في الحالَين: هذا مسارُ قراءةٍ ثانٍ لا بديل.
 */
const metricsExporter = createConfiguredMetricsExporter({
  registry: operationalMetrics.registry,
  serviceName: "waslah-gateway",
  deploymentEnvironment: config.env,
  processTopology: config.processTopology,
  metricsExport: config.metricsExport,
  log,
  // نفسُ ما يفعله `GET /metrics` قبل العرض: `collect` تكتب المقاييسَ اللحظيّةَ في
  // المسجِّل بنفسها، وفشلُها مُحصىً في عدّادٍ داخلَها لا مبتلَعٌ هنا.
  beforeSnapshot: async () => {
    await databaseGauges.collect();
  },
});
if (metricsExporter === null) {
  log("metrics_export.disabled", { reason: "METRICS_EXPORT_ENDPOINT غير مضبوط" });
} else {
  metricsExporter.start();
}

/**
 * مقبض العامل المدمج إن كان مُفعَّلاً. يُملأ بعد إعلان جاهزية المنفذ لا قبله.
 */
let embeddedWorker: EmbeddedWorkerHandle | null = null;

/**
 * الدرينرُ الخلفيُّ لوظائفِ تحديثِ تيليجرام — يلتقطُ ما أودعَه الويبهوكُ ويُعالجُه
 * خارجَ مسارِ HTTP (ADR 0057). يعملُ في عمليةِ البوابةِ لا في `apps/workers`؛
 * نقلُهُ إلى خدمةٍ منفصلةٍ (`SCL-007` / `F5-04`) لم يُغلَقْ بعد. يُوقفُ نظيفاً عند
 * التصريفِ بعدَ انتظارِ الشوطِ الجاري.
 */
let updateDrainer: TelegramUpdateDrainer | null = null;
// يُعلَنُ هنا لا عندَ إنشائه: `close()` قد يُستدعى أثناءَ الإقلاعِ قبلَ سطرِ الإنشاءِ (لا TDZ).
let loadTrace: LoadTrace | null = null;

/**
 * مقبضُ خادمِ HTTP من Node — يُملأ آخرَ الإقلاع. التصريفُ الرشيقُ يقرؤه عبر الإغلاقِ
 * لا مباشرةً، لأنّ الإشارةَ قد تصل قبلَ اكتمالِ التركيبِ (F5-05).
 * `Bun.serve` استُبدِلَ بـ`http.createServer` ليرتبطَ به Socket.IO (F4-04 · ADR 0042).
 */
type GatewayServer = import("node:http").Server;
let serverHandle: GatewayServer | null = null;
let rideChannel: ReturnType<typeof createRideChannel> | null = null;
let offersChannel: ReturnType<typeof createOffersChannel> | null = null;
let riderTripChannel: ReturnType<typeof createRiderTripChannel> | null = null;
/** `WR-04` — قناةُ غرفِ المحادثة؛ تُركَّبُ بعدَ `ioServer`، والمساراتُ تبثُّ عبرَها متى وُجِدَت. */
let chatChannel: ChatChannel | null = null;
let ioServer: IoServer | null = null;

/**
 * عددُ الطلباتِ الجاريةِ لحظةً بلحظة. يُزادُ عند الاستلامِ ويُنقصُ عند الفراغِ،
 * فيعرفُ التصريفُ متى يفرغُ الجاري بلا انتظارٍ أعمى (F5-05 / CAP-008).
 */
let inFlightRequests = 0;

/**
 * دورةُ حياةِ التصريفِ الرشيقِ. تُنشأ قبلَ تركيبِ المساراتِ لأنّ `/ready`
 * يقرأُ `isDraining()`، والمواردُ تُملأُ عبر إغلاقٍ يُقرأُ عند الإشارةِ لا عند الإنشاء.
 */
const lifecycle = createLifecycle({
  resources: {
    inFlight: () => inFlightRequests,
    forceClose: () => {
      // بعدَ انقضاءِ المهلةِ: إغلاقٌ قسريٌّ لما تبقّى من جارٍ.
      serverHandle?.close();
    },
    close: async () => {
      // الدرينرُ قبلَ القاعدةِ: شوطٌ جارٍ يحجزُ وظيفةً بإيجارٍ، وإغلاقُ القاعدةِ
      // تحته يُتركُها محجوزةً حتى ينتهي الإيجارُ. فنتوقفُه أوّلاً وينتظرُ الجاري.
      if (updateDrainer !== null) {
        await updateDrainer.stop();
        updateDrainer = null;
      }
      await loadTrace?.stop();
      // العاملُ أولاً: مهمّةٌ جاريةٌ تستعلمُ القاعدةَ، وإغلاقُ التجمّعِ تحتها يجعلها
      // تفشلُ بخطأِ اتصالٍ لا معنىً له بدلَ أن تنتهي أو تُوقَفَ نظيفة.
      if (embeddedWorker !== null) await embeddedWorker.stop();
      // **بعدَ** توقّفِ الدرينرِ والعاملِ وقبلَ إغلاقِ القاعدة: دفعةٌ أخيرةٌ تحمل ما
      // تراكم منذ آخرِ دورٍ. بدونها تخسر كلُّ إعادةِ نشرٍ حتى `intervalSeconds` من
      // العدِّ، فيصير مجموعُ النظامِ ناقصاً بمقدارِ عددِ إعاداتِ النشرِ في اليوم.
      // وقبلَ القاعدةِ لأنّ `beforeSnapshot` يستعلمها.
      if (metricsExporter !== null) await metricsExporter.stop();
      // قناةُ الرحلةِ الآنيةُ قبلَ الخادمِ: تُفصلُ مقابسِ Socket.IO نظيفاً.
      if (rideChannel !== null) {
        rideChannel.stop();
        rideChannel = null;
      }
      if (riderTripChannel !== null) {
        riderTripChannel.stop();
        riderTripChannel = null;
      }
      if (offersChannel !== null) {
        offersChannel.stop();
        offersChannel = null;
      }
      if (chatChannel !== null) {
        chatChannel.stop();
        chatChannel = null;
      }
      if (ioServer !== null) {
        ioServer.close();
        ioServer = null;
      }
      await container.close();
      // الخادمُ أخيراً — بقيَ يستقبلُ طوالَ التصريفِ حتى يُجيبَ `/ready` بـ«مُصرِّف».
      serverHandle?.close();
    },
  },
  graceMs: 10_000,
  /**
   * نصفُ ثانيةٍ يراها المُوجّهُ. وبدونِها، إذا جاءَت الإشارةُ ولا طلبَ جارٍ — وهو
   * الغالبُ في إعادةِ النشرِ — أُغلِقَ المقبسُ في دورةِ حدثٍ واحدةٍ فرأى المُوجّهُ
   * رفضَ اتصالٍ لا «مُصرِّف». وليست مهلةَ سياسةٍ بل زمنُ انتشارِ حالةٍ في مُوجّهٍ
   * (القاعدةُ 0.3 لا تشملُ هذا كما لا تشملُ `graceMs` فوقَه).
   */
  announceMs: 500,
  log,
});

process.on("SIGTERM", () => {
  void lifecycle.requestShutdown("SIGTERM").then(() => process.exit(0));
});
process.on("SIGINT", () => {
  void lifecycle.requestShutdown("SIGINT").then(() => process.exit(0));
});

/**
 * حدودٌ تقنيّةٌ لا تجاريّةٌ: لا مكانَ لها في `platform_settings`. **وأرقامُها لم تَبقَ
 * ههنا**: نُقِلَت إلى `rate-limit/policy.ts` بلا تغييرِ قيمةٍ (`SEC-07` · ADR 0139)،
 * لأنَّ رقماً في موضعِ التركيبِ وعهداً في وثيقةٍ موضعا حقيقةٍ يفترقانِ. وموضعُ
 * التركيبِ يطلبُ حدَّه بمسارِه وبُعدِ مفتاحِه، **فإن لم يكن مُعلَناً رمى عندَ
 * الإقلاعِ** ولم يخترعْ حدَّاً في التشغيلِ.
 */

/**
 * الحدّ على Redis عند تعدّد النسخ، وفي الذاكرة عند نسخة واحدة: حدٌّ يعدّ كل نسخة
 * وحدها ليس حدّاً بل قسمةً له على عددها. يُربَط بنفس مفتاح SESSION_STORE لأن كليهما
 * يجيب سؤالاً واحداً: هل نحن أكثر من عملية؟ (ADR 0011)
 */
const rateRedis =
  config.sessionStore === "redis"
    ? createUpstashRedis({
        url: config.redisUrl,
        token: config.redisToken,
      })
    : null;

function limiter(options: { readonly limit: number; readonly windowSeconds: number }): RateLimiter {
  return rateRedis === null
    ? createMemoryRateLimiter(options)
    : createRedisRateLimiter(rateRedis, {
        ...options,
        onFailure: (detail) => log("rate_limit.redis_failed", { detail }),
      });
}

/**
 * حاصرٌ لمسارٍ بعينِه من السِجلِّ المغلقِ. **والنداءُ نصُّه هوَ الدليلُ**: حاجزُ
 * `scripts/check-rate-limit-coverage.ts` يقرأُ هذا الملفَّ ويطلبُ نصَّ النداءِ
 * المُعلَنِ في `wiredIn` لكلِّ حدٍّ — فحدٌّ مُعلَنٌ بلا تركيبٍ يُسقِطُ البناءَ.
 */
function limiterFor(method: string, path: string, keyDimension: KeyDimension): RateLimiter {
  return limiter(rateLimitPolicy(method, path, keyDimension));
}

const paymentWebhook =
  paymentProvider === null
    ? undefined
    : {
        provider: paymentProvider,
        confirmDeps: instrumentPaymentConfirmationDeps(
          {
            payments: createPaymentRepository(container.sql, async (driverId) => {
              const rows = await container.sql<{ city_id: string }[]>`
                select city_id from drivers where id = ${driverId}::uuid
              `;
              return rows[0]?.city_id ?? null;
            }),
            events: createWebhookEventStore(container.sql),
          },
          operationalMetrics,
        ),
        limits: { perAddress: limiterFor("POST", "/webhook/payment", "عنوانُ العميلِ") },
        log,
      };

/**
 * تبعياتُ مسارِ الجلسة (`F1-03`). تُبنى فقط عند توفّرِ سرِّ التوقيع: بلا سرٍّ
 * لا يُركَّب المسارُ أصلاً، فلا يوجد طريقٌ يُصدِر جلسةً بتوقيعٍ ضعيف. والبوتان
 * كلاهما موقِّعٌ مقبول: التطبيقُ المصغَّر يُفتَح من بوتِ السائقِ وبوتِ الراكب،
 * فردُّ إثباتٍ صحيحٍ لأنّه جاء من البوتِ الآخر خطأٌ لا صرامة.
 */
const miniappSessionIssuer =
  config.miniappSessionSecret === null
    ? null
    : createMiniAppSessionIssuer({ secret: config.miniappSessionSecret });

/**
 * سلسلةُ التجديد (`F1-04`): رموزُ التجديدِ بمفتاحٍ **مشتقٍّ** من سرِّ الجلسةِ بفصلِ
 * نطاق، ومُصدِرُ رمزِ الوصولِ هو نفسُه المُصدِرُ من إذنِ التجديدِ — فمعرّفُ الجلسةِ
 * واحدٌ في الرمزَين. ولا متغيّرَ بيئةٍ ثانياً: انظر تعليلَ الاشتقاقِ وحدودَه في
 * `packages/infrastructure/identity/miniapp-refresh.ts`.
 */
const refreshChain =
  config.miniappSessionSecret === null || miniappSessionIssuer === null
    ? undefined
    : {
        refresh: createMiniAppRefreshTokens({ secret: config.miniappSessionSecret }),
        grantIssuer: miniappSessionIssuer,
      };

/**
 * `SEC-17` — حارسُ إعادةِ استعمالِ `initData`. على Redis عند تعدّدِ النسخ، وفي
 * الذاكرة عند نسخةٍ واحدة: نفسُ مفتاح `SESSION_STORE` لأنَّ السؤالَ واحدٌ — هل نحن
 * أكثرُ من عملية؟ وإن غابَ Redis (نسخةٌ واحدة) فالذاكرةُ كافيةٌ، وإن حضرَ فالاستهلاكُ
 * ذرّيٌّ عبرَ `SET NX`. **والحارسُ دائمًا موصولٌ**: لا يُتركُ المسارُ بلا حمايةٍ إلا
 * حين لا يُوجَدُ سرٌّ أصلاً (المسارُ نفسه معطَّل).
 */
const initDataReplayGuard =
  rateRedis === null
    ? createMemoryInitDataReplayGuard(() => new Date())
    : createRedisInitDataReplayGuard(rateRedis);

/**
 * مخزنُ إبطالِ الجلساتِ (`SEC-18`) — قائمةُ منعٍ يقرؤها كلُّ تحقُّقٍ من جلسةٍ.
 * نفسُ المنطقِ: Redis متى وُجِدَ، والذاكرةُ للنسخةِ الواحدةِ والاختبار. والفشلُ
 * في الوصولِ **إغلاقٌ لا فتحٌ**.
 */
const sessionRevocationStore =
  rateRedis === null
    ? createMemorySessionRevocationStore()
    : createRedisSessionRevocationStore(rateRedis);

const sessionTelegram =
  miniappSessionIssuer === null
    ? undefined
    : {
        exchange: {
          verifier: createTelegramInitDataVerifier({
            bots: [
              { name: "driver", token: config.driverBotToken },
              { name: "rider", token: config.riderBotToken },
            ],
          }),
          issuer: miniappSessionIssuer,
          ...(refreshChain === undefined ? {} : { refreshChain }),
          replayGuard: initDataReplayGuard,
          initDataMaxAgeSeconds: TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
          now: () => new Date(),
          log,
        },
        limits: { perAddress: limiterFor("POST", "/v1/session/telegram", "عنوانُ العميلِ") },
        log,
      };

/**
 * مسارُ التجديد (`F1-04`) — يُركَّب مع سلسلةِ التجديدِ وحدَها. ولا يلمس تيليجرامَ:
 * التحقّقُ من تيليجرامَ يقع عندَ إنشاءِ الجلسةِ وحدَه (`F1-03` · ADR 0035).
 */
const sessionRefresh =
  refreshChain === undefined
    ? undefined
    : {
        renew: {
          refresh: refreshChain.refresh,
          issuer: refreshChain.grantIssuer,
          revocation: sessionRevocationStore,
          now: () => new Date(),
          log,
        },
        limits: { perAddress: limiterFor("POST", "/v1/session/refresh", "عنوانُ العميلِ") },
        log,
      };

/**
 * مسارُ الدورِ والحالة (`F1-05`) — يُركَّب مع سرِّ الجلسةِ وحدَه، ويقرأ `users`
 * قراءةً فقط. ولا يلمس تيليجرامَ ولا يُنشئ حساباً: غيابُ الصفِّ حالةٌ تُعاد
 * («غير مسجَّل») لا صفٌّ يُكتَب — قرارُ مالكِ المنتجِ في `F1-05`.
 */
const me =
  config.miniappSessionSecret === null
    ? undefined
    : {
        viewer: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          accounts: createViewerAccountReader(container.sql),
          now: () => new Date(),
          log,
        },
        languageWriter: createViewerAccountLanguageWriter(container.sql),
        log,
      };

/**
 * تسجيلُ الراكبِ من التطبيقِ المصغَّرِ (`ADR 0213`) — **نفسُ** مصادقةِ `me` ونفسُ منفذَي
 * التسجيلِ اللذَين يستعملُهما حوارُ البوتِ؛ فلا قاعدةَ تسجيلٍ ثانيةٌ تتباعد.
 */
/** إثباتُ رقمِ السائقِ كما كتبَه بوتُه (`recordMiniAppPhoneProof`) — قراءةُ `draftPhone` ومسحُه. */
const driverPhoneProofs = createDriverPhoneProofs(container.driverDialogSessions);

const onboarding =
  me === undefined
    ? undefined
    : {
        onboarding: {
          viewer: me.viewer,
          riders: createRiderDirectory(container.sql),
          cities: createCityDirectory(container.sql),
          driverPhoneProofs,
          log,
        },
        // `PRD-105` — تسجيلُ السائقِ: الرقمُ من إثباتِ بوتِه في جلستِه، والكتابةُ بمنفذِ الحوارِ نفسِه.
        driverOnboarding: {
          viewer: me.viewer,
          drivers: createDriverDirectory(container.sql),
          cities: createCityDirectory(container.sql),
          phoneProofs: driverPhoneProofs,
          log,
        },
        log,
      };

/**
 * مركزُ الإشعاراتِ داخلَ التطبيقِ (`F6-05` / `SS-07`) — سطحُ قراءةٍ ووسمٍ فقط،
 * يعيدُ استخدامَ **نفسَ** مصادقةِ `F1-05` بلا مسارِ مصادقةٍ ثانٍ يتخلّفُ عن الأوّل.
 * وتحويلُ معرّفِ تيليجرام إلى `users.id` يقعُ داخلَ دالّةِ القاعدةِ لا ههنا،
 * فالتفويضُ على مستوى الكائنِ خاصّيّةُ مخطَّطٍ لا انتباهُ مُراجعٍ. وغيابُ سرِّ
 * الجلسةِ يُسقِطُ السطحَ بلا أن يُعطِّلَ التصنيفَ: التصنيفُ في القاعدةِ لا ههنا.
 */
const notifications =
  config.miniappSessionSecret === null
    ? undefined
    : {
        viewer: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          accounts: createViewerAccountReader(container.sql),
          now: () => new Date(),
          log,
        },
        center: createUserNotificationCenter(container.sql),
        log,
      };

/**
 * `F4-01` — سطحُ استقبالِ الموقعِ للتطبيقِ المصغَّرِ. يُركَّبُ مع سرِّ الجلسةِ
 * وحدَه كأخويهِ، **ويعيدُ استخدامَ تبعياتِ الحاويةِ نفسِها** التي يكتبُ بها مسارُ
 * البوتِ — لا دليلَ سائقينَ ثانياً ولا سياسةَ مجالٍ ثانيةً.
 *
 * وحدُّ المعدّلِ رقمُه ههنا لا في المسارِ: نبضةُ موقعٍ كلَّ ثانيةٍ هيَ المعتادُ في
 * تطبيقٍ حيٍّ، فحدُّ المستخدمِ العامُّ (`/webhook/telegram/:bot`) هوَ عينُ ما يَسَعُها ولا
 * يُخترَعُ له رقمٌ ثالثٌ يُصانُ في موضعينِ.
 */
const driverLocation =
  config.miniappSessionSecret === null
    ? undefined
    : {
        viewer: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          accounts: createViewerAccountReader(container.sql),
          now: () => new Date(),
          log,
        },
        drivers: container.driverLocation.drivers,
        ingest: container.driverLocation.ingest,
        limits: {
          perDriver: limiterFor("POST", "/v1/driver/location", "جلسةٌ موقَّعةٌ منّا"),
        },
        log,
      };

/**
 * `W-5` — بابُ استقبالِ أحداثِ CORE. يُركَّبُ حينَ يزرعُ المُشغِّلُ سرَّ الاشتراكِ
 * الذي سجَّلَه في CORE؛ وغيابُه لا يُسقِطُ الخدمةَ ولا يفتحُ باباً بلا توقيعٍ: لا
 * يُركَّبُ المسارُ أصلاً، فيَظهرُ الغيابُ `404` لا قَبولاً كاذباً. والسرُّ يُقرأُ
 * من البيئةِ لا من `platform_settings`: سرٌّ في قاعدةٍ تقرؤها أدواتُ الإدارةِ
 * أوسعُ انتشاراً من سرٍّ في بيئةِ عمليّةٍ واحدةٍ.
 */
const coreInboundSigningSecret = process.env[CORE_EVENT_TRANSPORT_ENV.inboundSigningSecret];
const coreEventIntake =
  coreInboundSigningSecret === undefined
    ? undefined
    : {
        signingSecret: coreInboundSigningSecret,
        lifecycle: createFulfillmentLifecycle(createOperationalJobRepository(container.sql)),
        limits: { perAddress: limiterFor("POST", "/webhook/core-events", "عنوانُ العميلِ") },
      };

/**
 * مسارا الموافقاتِ (`F2-01`) — يُركَّبانِ مع سرِّ الجلسةِ وحدَه كأخويهِما، ويكتبانِ
 * عبرَ دالّةٍ ذرّيّةٍ واحدةٍ تستنبطُ المدينةَ من صفِّ المستخدمِ داخلَ القاعدةِ
 * (القاعدتانِ 0.4 و0.5). ولا يُمرَّرُ `city_id` من هنا أصلاً: لا موضعَ في البابِ
 * يستقبلُه، فلا يستطيعُ خطأُ تركيبٍ أن يكتبَ موافقةً في مدينةٍ ليست مدينةَ صاحبِها.
 *
 * وغيابُ السرِّ يُسقِطُ المسارَينِ (`404`) ولا يُعطِّلُهما (`503`): مسارٌ معلَنٌ بلا
 * مصادقةٍ يدعو إلى إرسالِ إقرارٍ لا هويّةَ له.
 */
const consents =
  config.miniappSessionSecret === null
    ? undefined
    : {
        consent: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          reader: createConsentRecordReader(container.sql),
          writer: createConsentRecordWriter(container.sql),
          now: () => new Date(),
          log,
        },
        log,
      };

/**
 * مساراتُ الأماكنِ المحفوظةِ وآخرِ الوجهاتِ (`F2-02`) — تُركَّبُ مع سرِّ الجلسةِ
 * وحدَه كأخواتِها، والمدينةُ تُستنبَطُ من صفِّ المستخدمِ داخلَ القاعدةِ فلا موضعَ
 * ههنا يستقبلُ `city_id` أصلاً (القاعدتانِ 0.4 و0.5).
 *
 * والوجهاتُ الأخيرةُ **قارئٌ ثالثٌ** لا امتدادٌ للأوّلِ: مصدرُها `orders` لا
 * `saved_places`، وفصلُها في التركيبِ يمنعُ أن يُظنَّ يوماً أنَّها تُكتَبُ.
 */
const places =
  config.miniappSessionSecret === null
    ? undefined
    : {
        places: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          reader: createSavedPlaceReader(container.sql),
          writer: createSavedPlaceWriter(container.sql),
          recent: createRecentDestinationReader(container.sql),
          now: () => new Date(),
        },
        log,
      };

/**
 * DEC-41: مسارُ جهةِ الاتصالِ في الطوارئ — نفسُ سرِّ الجلسةِ ونفسُ نمطِ الأماكنِ.
 */
const emergencyContact =
  config.miniappSessionSecret === null
    ? undefined
    : {
        emergencyContact: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          reader: createEmergencyContactReader(container.sql),
          writer: createEmergencyContactWriter(container.sql),
          now: () => new Date(),
        } satisfies EmergencyContactDeps,
        log,
      };

/** R1 · ADR 0252: المدينةُ التشغيليّةُ للراكبِ — نفسُ سرِّ الجلسةِ ونفسُ نمطِ جهةِ الطوارئ. */
const operatingCity =
  config.miniappSessionSecret === null
    ? undefined
    : {
        operatingCity: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: createOperatingCityStore(container.sql),
          now: () => new Date(),
        } satisfies OperatingCityDeps,
        log,
      };

/**
 * مساراتُ اختيارِ الوجهةِ (`F2-03`) — تُركَّبُ مع سرِّ الجلسةِ وحدَه، ولا مزوِّدَ
 * خارجيَّ ههنا: لا مُرمِّزَ جغرافيّاً ولا مفتاحَ خرائطَ (استقلالُ المشروعِ `O-7`
 * ويفرضُه `check-egress-boundary`). والبحثُ والمصادقةُ كلاهما نداءُ دالّةٍ
 * واحدةٍ في القاعدةِ يقرأُ مدينةَ صاحبِ الجلسةِ وحدَّها (القاعدتانِ 0.4 و0.5).
 */
const destinations =
  config.miniappSessionSecret === null
    ? undefined
    : {
        destinations: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          searcher: createDestinationSearcher(container.sql),
          resolver: createDestinationResolver(container.sql),
          now: () => new Date(),
        },
        log,
      };

/**
 * مسارُ الاقتباسِ (`F2-04`) — يُركَّبُ مع سرِّ الجلسةِ وحدَه. ولا مفتاحَ خرائطَ
 * ههنا: المسافةُ من PostGIS والمدّةُ من مزوِّدِ التوجيهِ المُهيَّأِ إن وُجِدَ،
 * و`null` منه امتناعٌ مُعلَنٌ لا رقمٌ مخترَعٌ (`ADR 0024` · استقلالُ المشروعِ
 * `O-7`). و`container.routing` هوَ **نفسُه** الذي تستعملُه بطاقةُ السائقِ، فلا
 * قرارُ تهيئةٍ ثانٍ.
 */
const quote =
  config.miniappSessionSecret === null
    ? undefined
    : {
        quote: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          judge: createQuoteJudge(container.sql),
          routing: container.routing,
          now: () => new Date(),
        },
        log,
      };

/**
 * مساراتُ الرحلةِ (`F2-05`) — سرُّ الجلسةِ وحدَه شرطُ تركيبِها، كالاقتباسِ. ولا
 * مفتاحَ خرائطَ ههنا ولا مزوِّدَ توجيهٍ: الإنشاءُ حكمٌ في القاعدةِ، وحالةُ البحثِ
 * قراءةٌ منها. والقارئُ والآمرُ والمُلغي **ثلاثةُ كائناتٍ** لا واحدٌ: مسارُ
 * القراءةِ لا يجبُ أن يملكَ حقَّ الكتابةِ ولا حقَّ الإلغاءِ.
 */
/**
 * التكليفُ السابعُ (P4) — طلبٌ جديدٌ (لا إعادةُ مفتاحٍ) في طورِ البحثِ يُطلِقُ عرضَ مدينتِه
 * فورًا بدلَ انتظارِ محفّزِ موقعٍ أو الدوريِّ (20ث). المجدوَلُ لا يُطلَقُ (يبدأُ بموعدِه).
 */
function withNewOrderDispatch(command: RideRequestCommand): RideRequestCommand {
  return {
    ...command,
    create: async (input) => {
      const result = await command.create(input);
      if (
        result.ok &&
        result.value.accepted &&
        !result.value.ride.reused &&
        (result.value.ride.status === undefined || result.value.ride.status === "searching")
      ) {
        container.dispatchNewOrder(result.value.ride.orderId);
      }
      return result;
    },
  };
}

const rides =
  config.miniappSessionSecret === null
    ? undefined
    : {
        request: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          rides: withNewOrderDispatch(createRideRequestCommand(container.sql)),
          now: () => new Date(),
        },
        search: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          search: createRideSearchReader(container.sql),
          now: () => new Date(),
        },
        // `WR-09` — المرشَّحُ وقرارُ الراكب؛ الحكمُ في القاعدة.
        candidate: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: createRideCandidateStore(container.sql),
          now: () => new Date(),
        },
        // ADR 0287 — أحداثُ رحلةِ الراكبِ في Mini App وإقرارُه بعدَ التطبيقِ.
        tripEvents: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: createRiderTripEventsStore(container.sql),
          now: () => new Date(),
        },
        // الرحلةُ النشطةُ (`F2-06`) **تملكُ مزوِّدَ التوجيهِ** خلافاً لأخواتِها:
        // مدّةُ وصولِ السائقِ سؤالُها. و`container.routing` قد يكونُ `null` بقرارِ
        // مشغِّلٍ مُعلَنٍ، فتعودُ المدّةُ `NOT_CONFIGURED` امتناعاً مُصنَّفاً — ولا
        // يُعطَّلُ المسارُ كلُّه لأجلِ حقلٍ تكميليٍّ.
        active: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          rides: createActiveRideReader(container.sql),
          now: () => new Date(),
          routing: { routing: container.routing },
          // ADR 0243: مقياسُ خطأِ التقديرِ المرصود — مدى التنبؤِ الصادق.
          etaBands: createEtaBandStore(container.sql),
        },
        cancel: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          canceller: createRideCancelCommand(container.sql),
          now: () => new Date(),
        },
        // الملخَّصُ والتقييمُ (`F2-07`) **كائنانِ منفصلانِ** كسابقَيهما: قارئُ
        // الملخَّصِ لا يملكُ حقَّ كتابةِ تقييمٍ، وآمرُ التقييمِ لا يملكُ قراءةَ
        // ملخَّصٍ. **ولا مزوِّدَ توجيهٍ ههنا**: لا مدّةَ وصولٍ لرحلةٍ انتهت.
        summary: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          rides: createRideSummaryReader(container.sql),
          // مسافةُ الأثرِ المسجَّلِ (`ADR 0208`): منفذُ قراءةٍ ضيّقٌ يعيدُ الصفوفَ
          // وحدَها، والقياسُ في الدالّةِ الصرفةِ في النطاقِ — طبقةٌ واحدةٌ.
          trace: createRideTraceReader(container.sql),
          now: () => new Date(),
        },
        rating: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          ratings: createRideRatingCommand(container.sql),
          now: () => new Date(),
        },
        // السجلُّ والتفاصيلُ (`F2-08`) **كائنانِ منفصلانِ** كسوابقِهما، وكلاهما
        // **قارئٌ محضٌ**: لا حقَّ كتابةٍ في سجلٍّ ولا في تفاصيلَ.
        // **ولا مزوِّدَ توجيهٍ ولا خرائطَ**: الماضي لا يُتابَعُ (`ADR 0007`).
        history: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          history: createRideHistoryReader(container.sql),
          now: () => new Date(),
        },
        detail: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          details: createRideDetailReader(container.sql),
          now: () => new Date(),
        },
        // المشاركةُ (`F2-09`) **ثلاثةُ كائناتٍ** لا واحدٌ: قارئُ الحالِ لا يملكُ
        // حقَّ إصدارِ رابطٍ، والمُصدِرُ لا يملكُ حقَّ الإلغاءِ. والإصدارُ وحدَه
        // يحملُ الأساسَ العامَّ — و`issuing: undefined` حينَ يغيبُ
        // `TRACKING_TOKEN_BASE_URL`: **قرارُ مشغِّلٍ مُعلَنٌ** يُقرأُ
        // `SHARING_NOT_CONFIGURED`، لا رابطٌ يُبنى بأساسٍ مُخمَّنٍ.
        share: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          shares: createRideShareReader(container.sql),
          now: () => new Date(),
        },
        shareStart: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          issuing:
            config.trackingTokenBaseUrl === null
              ? undefined
              : {
                  tokens: container.tracking.tokens,
                  mint: container.tracking.tokenMint,
                  baseUrl: config.trackingTokenBaseUrl,
                },
        },
        // الإيقافُ **لا يشترطُ الأساسَ العامَّ**: إلغاءُ رابطٍ قائمٍ لا يحتاجُ أن
        // يُبنى رابطٌ — ولو رُبِطَ بالأساسِ لَبقيَت روابطُ حيّةٌ بلا زرٍّ يُغلقُها
        // يومَ يُسحَبُ الإعدادُ.
        shareStop: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          revoking: { tokens: container.tracking.tokens },
        },
        log,
      };

/**
 * مسارُ التوصيلِ (`POST /v1/deliveries`) — يُفوِّضُ الإنشاءَ إلى `requestRide` القائمِ
 * بـ`service: "delivery"`، ويُضيفُ تحقُّقَ وصفِ الطردِ ووجهةِ التسليمِ الإلزاميّة.
 * يُركَّبُ معَ نفسِ سرِّ الجلسةِ و`RideRequestCommand` الذي يستعمله `rides`.
 */
const deliveries =
  config.miniappSessionSecret === null
    ? undefined
    : {
        request: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          rides: withNewOrderDispatch(createRideRequestCommand(container.sql)),
          now: () => new Date(),
        },
        log,
      };

/**
 * سطحُ الاستغاثةِ (`F2-10`) — **كائنانِ** كسوابقِه: قارئُ الحكمِ لا يملكُ حقَّ
 * تقييدِ حادثٍ، وآمرُ الضغطةِ لا يقرأُ حكماً. والدورُ `"rider"` **مُركَّبٌ ههنا**
 * لا مقروءٌ من الطلبِ: لو قُرِئَ من الجسمِ لَأمكنَ لراكبٍ أن يُبلِّغَ بصفةِ سائقٍ.
 *
 * **والمنفذُ هوَ منفذُ البوتَينِ نفسُه** (`container.safety.trigger.incidents`):
 * مسارانِ للسطحِ وحاكمٌ واحدٌ، لا حاكمانِ يفترقانِ يومَ يتغيَّرُ شرطٌ في القاعدةِ.
 */
const safety =
  config.miniappSessionSecret === null
    ? undefined
    : {
        surface: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          surface: createSosSurfaceReader(container.sql),
          role: "rider" as const,
        },
        // `PD-020` · الشقُّ `ج` — الحاكمُ نفسُه بدورِ السائقِ: يحلُّ مَهمّتَهُ
        // الجاريةَ فيُقرأُ سردُ بلاغِ «تعذّرَ الإكمالُ» في شاشةِ المَهمّةِ.
        driverSurface: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          surface: createSosSurfaceReader(container.sql),
          role: "driver" as const,
        },
        trigger: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          incidents: container.safety.trigger.incidents,
          role: "rider" as const,
        },
        // `F12-22` — قناةُ استغاثةٍ ثانيةً للسائقِ بلا تيليجرام: نفسُ المنفذِ
        // ونفسُ الجلسةِ، والدورُ `"driver"` مُركَّبٌ ههنا لا مقروءٌ من الطلبِ.
        driverTrigger: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          incidents: container.safety.trigger.incidents,
          role: "driver" as const,
        },
        log,
      };

/**
 * حقّا البيانةِ (`F2-11`) — **تبعيةٌ واحدةٌ لحقَّينِ**: مصدرُ حقيقةِ ما يُنزَّلُ
 * وما يُمحى سجلٌّ واحدٌ (`erasure-policy.ts`)، فمنفذٌ واحدٌ يقرؤه. ولا دورَ
 * مُركَّبٌ ههنا: الدالّتانِ في القاعدةِ تقرآنِ دورَ الصفِّ وترفضانِ غيرَ الراكبِ
 * برمزٍ مُصنَّفٍ — فحقُّ السائقِ (`SD-12`) يُفتَحُ في القاعدةِ لا بسطرٍ ههنا.
 */
const dataRights =
  config.miniappSessionSecret === null
    ? undefined
    : {
        dataRights: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresDataRightsStore(container.sql),
        },
        log,
      };

/**
 * الدعمُ من داخلِ التطبيقِ (`F2-12` · `F3-08`) — **منفذانِ لأربعةِ مساراتٍ**:
 * الكتابةُ دالّةٌ واحدةٌ للدورَينِ، **والقراءةُ تفترقُ بالفرزِ** (`driver_id` لا
 * `rider_id`) فلكلِّ دورٍ مخزنُه. ولا فحصَ دورٍ ههنا: `open_support_ticket`
 * تقرأُ صفَّ صاحبِ الحسابِ وتردُّ غيرَ أهلِه برمزٍ مُصنَّفٍ — **موضعُ الحكمِ
 * واحدٌ في القاعدةِ**، والتركيبُ ههنا سباكةٌ لا حكمٌ.
 */
const support =
  config.miniappSessionSecret === null
    ? undefined
    : {
        support: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresRiderSupportStore(container.sql),
        },
        driverSupport: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresDriverSupportStore(container.sql),
        },
        threads: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          reader: createTicketThreadReader(container.sql),
          writer: createTicketThreadWriter(container.sql),
          now: () => new Date(),
        },
        card: container.supportCard,
        log,
      };

/**
 * `WR-04` — محادثةُ طرفَي الطلب. مسارُ HTTP هوَ الحقيقةُ (الحفظُ والاسترجاعُ)،
 * والقناةُ الآنيّةُ إشارةٌ تُسرِّعُ الوصولَ فقط. غيابُ سرِّ الجلسةِ يُلغي المسارات.
 */
const orderChatStore = createOrderChatStore(container.sql);
const orderChat =
  config.miniappSessionSecret === null
    ? undefined
    : {
        chat: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: orderChatStore,
          now: () => new Date(),
          onPosted: (signal: { readonly orderId: string; readonly lastSeq: number }) =>
            chatChannel?.publish(signal),
          log,
          // `WR-04` — ترجمةُ رسالةِ الطرفِ الآخرِ إلى لغةِ القارئ بمزوّدِ `TRANSLATION_PROVIDER`
          // نفسِه. `none` ⇒ لا دالّةَ ترجمةٍ أصلًا، فيُعرَضُ الأصلُ وحدَه ولا إفصاحَ عن مزوّدٍ
          // غيرِ موجود (ADR 0277).
          ...(container.translation.provider === null
            ? {}
            : {
                translate: async (input: {
                  readonly text: string;
                  readonly from: string;
                  readonly to: string;
                }) => {
                  if (!isSupportedLanguage(input.from) || !isSupportedLanguage(input.to))
                    return null;
                  const result = await translateMessage(
                    { text: input.text, pair: { from: input.from, to: input.to } },
                    container.translation,
                  );
                  return result.translated ? result.text : null;
                },
              }),
        },
      };

/**
 * تفضيلاتُ الإشعاراتِ (DEC-42) — مسارُ `GET/PUT /v1/me/notification-preferences`.
 * موصولٌ دائمًا في حاويةِ البوّابةِ: القارئُ والكاتبُ على القاعدة، والجلسةُ من
 * التطبيقِ المصغَّرِ. غيابُ `miniappSessionSecret` يُلغي المسارَ كله.
 */
const notificationPrefs =
  config.miniappSessionSecret === null
    ? undefined
    : {
        notificationPrefs: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          reader: createNotificationPrefsReader(container.sql),
          writer: createNotificationPrefsWriter(container.sql),
          now: () => new Date(),
        },
      };

/**
 * وثائقُ السائقِ (`F3-01`) — **مخزنٌ واحدٌ لأربعةِ مساراتٍ**، ومُوقِّعٌ يُقرأُ من
 * البيئةِ. وغيابُ مفتاحِ التخزينِ **لا يُسقِطُ السطحَ**: يُركَّبُ مُوقِّعٌ غيرُ
 * مُهيَّأٍ يردُّ رفضاً مُصنَّفاً، فيبقى لوحُ الحالاتِ يقولُ للسائقِ سببَ حجبِه —
 * وذاكَ أنفعُ من بابٍ مُغلَقٍ بالكامِلِ لأنَّ الرفعَ متعذِّرٌ.
 */
const driverDocuments =
  config.miniappSessionSecret === null
    ? undefined
    : (() => {
        const storage = readSignedUploadConfig(process.env);
        const readStorage = readSignedReadConfig(process.env);
        const upload = selectUploadSigner(process.env, storage);
        if (upload.state === "not_configured") {
          log("driver_documents.signer_not_configured", {
            hint: "OBJECT_STORAGE_URL + OBJECT_STORAGE_SECRET_KEY",
          });
        } else if (upload.state === "paused") {
          // لا نسخةَ مُثبَتةً لبايتاتِ المخزنِ بعد — `BACKUP-STORAGE-20261011.md`.
          log("driver_documents.uploads_paused", {
            hint: "DRIVER_DOCUMENT_UPLOADS=enabled after a verified Storage restore drill",
          });
        }
        return {
          documents: {
            sessions: createRevocableSessionReader(
              createMiniAppSessionReader(config.miniappSessionSecret),
              sessionRevocationStore,
            ),
            now: () => new Date(),
            store: new PostgresDriverDocumentStore(container.sql),
            signer: upload.signer,
            ...(storage === null
              ? {}
              : {
                  existenceChecker: new HttpObjectExistenceChecker(storage),
                  // `WR-21` (ADR 0282): الحكمُ على البايتاتِ الفعليّة.
                  contentInspector: new HttpObjectContentInspector(storage),
                }),
            ...(readStorage === null ? {} : { readSigner: new HttpReadSigner(readStorage) }),
          },
          log,
        };
      })();

/**
 * عروضُ السائقِ (`F3-02`) — **ثلاثةُ منافذٍ لخمسةِ مساراتٍ**: مخزنُ قاعدةٍ
 * جديدٌ للقراءةِ والقبولِ، و**منفذانِ قائمانِ كما هما** للرفضِ والتوفُّرِ
 * (`container.driverOffers`) لأنَّ لكلِّ انتقالٍ كاتباً واحداً (القاعدة 0.6). وغيابُ سرِّ
 * الجلسةِ **يُسقِطُ السطحَ كلَّه**: مسارُ قبولٍ بلا رمزٍ موقَّعٍ يعني أنَّ من
 * عرفَ معرِّفَ عرضٍ أخذَ رحلةَ غيرِه.
 */
const driverOffers =
  config.miniappSessionSecret === null
    ? undefined
    : {
        offers: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresDriverOfferStore(container.sql),
          drivers: container.driverOffers.drivers,
          offers: container.driverOffers.decisions,
          riderNotice: container.riderTripNotice,
        },
        log,
      };

/**
 * `ADR 0286` — أعمالُ التفاوضِ من التطبيقِ المصغَّرِ: مطالبةُ السائقِ في دورةِ
 * القروبِ وقرارُ الراكبِ (اختيارٌ · اتفاقٌ · تجاوزٌ). **المنافذُ هي نفسُها** التي
 * يناديها حوارُ البوتِ — لا كاتبَ ثانٍ ولا نسخةً ثانيةً من الحقيقةِ — والهويّةُ
 * من الجلسةِ الموقَّعةِ لا من جسمِ الطلبِ. وغيابُ سرِّ الجلسةِ **يُسقِطُ السطحَ
 * كلَّه**: مطالبةٌ بلا رمزٍ موقَّعٍ تعني مطالبةً باسمِ غيرِكَ.
 */
const negotiationApp =
  config.miniappSessionSecret === null
    ? undefined
    : {
        negotiation: createNegotiationApp({
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: createNegotiationAppStore(container.sql),
          claims: container.negotiationApp.claims,
          rotation: container.negotiationApp.rotation,
          drivers: container.driverOffers.drivers,
        }),
        log,
      };

/**
 * مَهمّةُ السائقِ النشطةُ (`F3-03`) — **منفذٌ واحدٌ لأربعةِ مساراتٍ**: مخزنٌ
 * يقرأُ الطَورَ ويُنادي كاتبَه. و**لا منفذَ إخطارٍ ولا منفذَ موضعٍ ههنا**:
 * الإخطارُ صندوقُ الصادرِ القائمُ، والبثُّ بندُ `F3-04`. وغيابُ سرِّ الجلسةِ
 * **يُسقِطُ السطحَ كلَّه**: ختمُ وصولٍ بلا رمزٍ موقَّعٍ يعني أنَّ من عرفَ معرِّفَ
 * طلبٍ ختمَ طَوراً في رحلةِ غيرِه.
 */
const driverJob =
  config.miniappSessionSecret === null
    ? undefined
    : {
        job: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresDriverJobStore(container.sql),
          riderNotice: container.riderTripNotice,
        },
        // `PD-020` · الشقُّ `ج` — فعلُ «تعذّرَ الإكمالُ»: بلاغُ سلامةٍ يُحفَظُ في
        // بيتِ السلامةِ ويدخلُ من بابِ المَهمّةِ، فمَنفذُهُ مَنفذُ السلامةِ لا
        // مَنفذَ النقلِ.
        cannotReport: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          reports: createDriverCannotCompletePort(container.sql),
        },
        log,
      };

/**
 * حصيلةُ السائقِ (`F3-05`) — **مخزنٌ يقرأُ ولا يكتبُ**، ولذا لا يُشارِكُ مخزنَ
 * المَهمّةِ الكاتبَ ولو اتّحدَ الاتصالُ: أوسعُ سلطةٍ في عقدٍ تُقرأُ سلطةَ كلِّ
 * مُستعمِلِه. وغيابُ سرِّ الجلسةِ **يُسقِطُ السطحَ**: تقريرٌ بلا رمزٍ موقَّعٍ
 * يعني أنَّ من عرفَ معرِّفاً قرأَ حصيلةَ غيرِه.
 */
const driverActivity =
  config.miniappSessionSecret === null
    ? undefined
    : {
        activity: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresDriverActivityStore(container.sql),
        },
        log,
      };

/**
 * اشتراكُ السائقِ (`F3-06`) — **مخزنٌ يقرأُ ولا يكتبُ**: لوحُ الاشتراكِ بأسعارِه
 * وتجربتِه وتحذيرِه، وتاريخُ دفعاتِه. وغيابُ سرِّ الجلسةِ **يُسقِطُ السطحَ**:
 * لوحُ اشتراكٍ بلا رمزٍ موقَّعٍ يعني أنَّ من عرفَ معرِّفاً قرأَ حالَ غيرِه.
 */
const driverSubscription =
  config.miniappSessionSecret === null
    ? undefined
    : {
        subscription: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: new PostgresDriverSubscriptionStore(container.sql),
        },
        ...(paymentProvider === null
          ? {}
          : {
              renewal: {
                sessions: createRevocableSessionReader(
                  createMiniAppSessionReader(config.miniappSessionSecret),
                  sessionRevocationStore,
                ),
                drivers: createDriverDirectory(container.sql),
                payments: createPaymentRepository(container.sql, async (driverId) => {
                  const rows = await container.sql<{ city_id: string }[]>`
                    select city_id from drivers where id = ${driverId}::uuid
                  `;
                  return rows[0]?.city_id ?? null;
                }),
                provider: paymentProvider,
                priceReader: async (cityId: CityId, plan: SubscriptionPlan) => {
                  const settings = createSettingsRepository(container.sql);
                  const rows = await settings.findByCity(cityId);
                  if (!rows.ok) {
                    return err(new PortFailureError("settings.findByCity", rows.error.detail));
                  }
                  const city = parseCitySettings(cityId, rows.value);
                  if (!city.ok) {
                    const detail = "message" in city.error ? city.error.message : city.error.code;
                    return err(new PortFailureError("parseCitySettings", String(detail)));
                  }
                  const amount = subscriptionPriceFor(city.value, plan) * 100;
                  return ok({ amount, currency: city.value.currency });
                },
                now: () => new Date(),
              },
            }),
        log,
      };

/**
 * فاتورةُ الاشتراكِ الضريبيّةُ وحالُ عمليتِه (`F3-09`) — **مخزنٌ يُصدِرُ مرّةً
 * ويقرأُ مرّتَينِ**. وغيابُ سرِّ الجلسةِ **يُسقِطُ السطحَ**: وثيقةٌ ضريبيّةٌ
 * تُقرَأُ بمعرِّفٍ في مسارٍ وحدَه تجعلُ من خمَّنَ رقماً قارئاً لدفعةِ غيرِه.
 * ومغيبُ مزوّدِ دفعٍ **لا يُعطِّلُه**: الفواتيرُ تُصدَرُ لدفعاتٍ مضَت ولو توقَّفَ
 * التحصيلُ — وربطُهما يحجبُ وثائقَ مالٍ قُبِضَ فعلاً.
 */
const driverSubscriptionInvoice =
  config.miniappSessionSecret === null
    ? undefined
    : {
        invoices: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: new PostgresSubscriptionTaxInvoiceStore(container.sql),
          now: () => new Date(),
        },
        log,
      };

/**
 * كشفُ الخصومِ التفصيليُّ (`DEC-37`) — قراءةٌ فقط من سجلِّ المحفظةِ. غيابُ سرِّ
 * الجلسةِ **يُسقِطُ السطحَ** كغيرهِ.
 */
const driverDeductions =
  config.miniappSessionSecret === null
    ? undefined
    : {
        deductions: {
          sessions: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          now: () => new Date(),
          store: createDeductionTraceStore(container.sql),
        },
        log,
      };

/**
 * مركبةُ السائقِ (`F3-07` · `F12-06`) — بياناتُ المركبةِ ووثائقُها الثلاثُ
 * في نداءٍ واحدٍ، وروابطُ قراءةٍ موقَّعةٌ للشعارِ والباركودِ.
 * وغيابُ سرِّ الجلسةِ **يُسقِطُ السطحَ** كالعروضِ والنشاطِ.
 */
const vehicleReadStorage = readSignedReadConfig(process.env);
const vehicleAssetReader =
  vehicleReadStorage === null
    ? new UnconfiguredAssetReader()
    : new ReadUrlSignerAdapter(new HttpReadSigner(vehicleReadStorage));

const driverVehicle =
  config.miniappSessionSecret === null
    ? undefined
    : {
        vehicle: {
          session: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: new PostgresDriverVehicleStore(container.sql),
          now: () => new Date(),
        },
        vehicleAssets: {
          session: createRevocableSessionReader(
            createMiniAppSessionReader(config.miniappSessionSecret),
            sessionRevocationStore,
          ),
          store: new PostgresDriverVehicleStore(container.sql),
          assetReader: vehicleAssetReader,
          now: () => new Date(),
        },
        log,
      };

const app = createServer({
  // `F8-02`: مقاييسُ الحافةِ على المُسجِّلِ **نفسِه** الذي ينشرُه مسارُ `/metrics`؛
  // مُسجِّلانِ في عمليّةٍ واحدةٍ يعني أنَّ المنشورَ نصفُ المقيسِ.
  httpMetrics: operationalMetrics,
  health: {
    now: () => new Date(),
    startedAt,
    env: process.env,
    isDraining: lifecycle.isDraining,
    probeTimeoutMs: 2_000,
    // فحص جاهزية حقيقي: استعلام فعلي على القاعدة، لا افتراض أن الرابط صحيح
    readinessChecks: [
      {
        name: "database",
        check: async () => {
          const rows = await container.sql<{ ok: number }[]>`select 1 as ok`;
          return rows[0]?.ok === 1;
        },
      },
      /**
       * الاتّصالُ الناجح لا يعني قاعدةً صالحة. قاعدةُ الإنتاج بقيت متأخّرةً سبعَ
       * عشرةَ ترحيلةً عن المستودع بينما `/ready` يقول «جاهز»: الجداولُ والدوالُّ
       * التي يناديها الكودُ غائبة، والإخفاقُ يظهر أوّلَ ما يضغط سائقٌ زرّاً — أي
       * على المستخدم لا على المراقبة. فهذا الفحصُ يُقدّم الإخفاقَ إلى النشر.
       *
       * وهو `critical`: خدمةٌ تعمل على مخطّطٍ ناقصٍ تكتب بياناتٍ نصفَ متّسقة،
       * وذلك أسوأُ من رفضِ الحركة حتى تُطبَّق الترحيلات.
       */
      {
        name: "database_schema",
        // `OPS-EGRESS-01`: النجاحُ يُتذكَّرُ عشرَ دقائق؛ الفشلُ يُعادُ في كلِّ نداء.
        check: rememberSuccess(async () => {
          const report = await verifySchemaContract(container.sql);
          if (report.complete) return { ok: true };
          const missing = [
            report.missingFunctions.length > 0
              ? `دوالّ: ${report.missingFunctions.join(", ")}`
              : null,
            report.missingTables.length > 0 ? `جداول: ${report.missingTables.join(", ")}` : null,
          ]
            .filter((line): line is string => line !== null)
            .join(" | ");
          return { ok: false, detail: `ترحيلات غير مطبّقة — ${missing}` };
        }, SCHEMA_CONTRACT_REMEMBER_MS),
      },
      // Redis يُفحَص فقط حين يكون في المسار الحرج فعلاً. فحصه دائماً كان سيُسقط
      // الجهوزية في بيئةٍ لا تستعمله أصلاً، فيصير الفحص كذباً في الاتجاه المعاكس.
      //
      // وهو `critical: false` عن قصد: انقطاع Redis يُضعف ولا يُعطّل — حدّ المعدّل
      // يفشل مفتوحاً (fixed-window.ts: allowOnFailure)، والحوارات تعود إلى بدايتها
      // ولا تفسد، والرحلات ولوحة الإدارة على القاعدة لا على Redis. وإعادة تشغيل
      // النسخة لا تُعيد Redis. فإسقاط الجهوزية هنا كان سيجعل Render يقطع الحركة
      // بعد 15 ثانية ثم يُعيد التشغيل بعد 60 — فيصير عطل Upstash انقطاعاً كاملاً
      // للمنصّة كلها. العطل يبقى مرئياً في `degradedChecks` لا مكتوماً.
      ...(rateRedis === null
        ? []
        : [
            {
              name: "redis",
              critical: false,
              // PRD-001: النتيجةُ مفصّلةٌ لا منطقيّة — `degradedChecks: ["redis"]` بلا سببٍ
              // بقيَ أيّاماً لا يُشخَّصُ من الخارج. والتفصيلُ مُعقَّمٌ في المحوّلِ نفسِه.
              check: rememberSuccess(async (): Promise<ProbeOutcome> => {
                const result = await rateRedis.command(["PING"]);
                return result.ok
                  ? { ok: true }
                  : {
                      ok: false,
                      detail: sanitizeUpstashError(`${result.error.kind}: ${result.error.detail}`),
                    };
              }, REDIS_PING_REMEMBER_MS),
            },
          ]),
      /**
       * نبضةُ المهامّ (§4.3). الفجوةُ التي تُغلَق هنا: إقلاعُ العامل المضمَّن لا
       * يُسقط البوابة عند فشله — وهو قرارٌ صحيح — لكنّ ثمنَه أنّ `/ready` كان يقول
       * `ready` والمهامّ ميّتة: العروضُ لا تنتهي، والطلبُ لا يُعاد توزيعُه، والسائقُ
       * يدفع ولا يُشعَر — ولا مؤشّر واحد يُرى من خارج السجلّ.
       *
       * والتوقّعاتُ تُقرأ من حاوية العامل (`jobHealthExpectations`) لا تُكتب هنا:
       * تواترٌ يُعدّل في `JOB_INTERVALS` وعتبةُ بياتٍ منسوخة في البوابة ينزلقان حتماً.
       */
      ...createJobHealthProbes({
        heartbeats: createJobHeartbeatReader(container.sql),
        expectations: async () => {
          const rows = await container.sql<{ id: string }[]>`
            select id from cities where is_active = true
          `;
          return jobHealthExpectations(rows.map((row) => row.id as CityId));
        },
        now: () => new Date(),
        startedAt,
        cacheMs: JOB_HEALTH_SNAPSHOT_MS,
      }),
    ],
  },
  webhook: {
    webhookSecret: config.telegramWebhookSecret,
    log,
    handler: instrumentTelegramHandler(container.handler, operationalMetrics, { log }),
    // مصدرُ قرارِ منعِ التكرارِ في الإنتاج: القاعدةُ لا الذاكرةُ (ADR 0054 §٣-أ).
    // ويبقى `dedup` موصولاً للمقاييسِ وللتدهورِ المُعلَنِ حينَ يغيبُ `intake`.
    intake: wakeDrainerOnEnqueue(
      instrumentUpdateIntake(createPostgresUpdateIntake(container.sql), operationalMetrics),
      () => updateDrainer?.kick(),
    ),
    // **SCL-001**: في الإنتاجِ يُحظَرُ العملُ بلا إيداعٍ صامدٍ فيُرمي المصنعُ عند الإقلاع،
    // فلا يصيرَ dedup الذاكرةُ مساراً صامتاً (ADR 0059).
    requireDurableIntake: config.env === "production",
    dedup: instrumentUpdateDeduplicator(createUpdateDeduplicator(), operationalMetrics),
    rateLimits: {
      probes: limiterFor("POST", "/webhook/telegram/:bot", "عنوانُ العميلِ"),
      users: limiterFor("POST", "/webhook/telegram/:bot", "مستخدمُ تيليجرامَ"),
    },
  },
  ...(paymentWebhook === undefined ? {} : { paymentWebhook }),
  ...(sessionTelegram === undefined ? {} : { sessionTelegram }),
  ...(sessionRefresh === undefined ? {} : { sessionRefresh }),
  ...(me === undefined ? {} : { me }),
  ...(onboarding === undefined ? {} : { onboarding }),
  ...(consents === undefined ? {} : { consents }),
  ...(places === undefined ? {} : { places }),
  ...(emergencyContact === undefined ? {} : { emergencyContact }),
  ...(operatingCity === undefined ? {} : { operatingCity }),
  ...(destinations === undefined ? {} : { destinations }),
  ...(quote === undefined ? {} : { quote }),
  ...(rides === undefined ? {} : { rides }),
  ...(deliveries === undefined ? {} : { deliveries }),
  ...(safety === undefined ? {} : { safety }),
  ...(dataRights === undefined ? {} : { dataRights }),
  ...(support === undefined ? {} : { support }),
  ...(driverDocuments === undefined ? {} : { driverDocuments }),
  ...(driverOffers === undefined ? {} : { driverOffers }),
  ...(negotiationApp === undefined ? {} : { negotiationApp }),
  ...(driverJob === undefined ? {} : { driverJob }),
  ...(orderChat === undefined ? {} : { orderChat }),
  ...(driverActivity === undefined ? {} : { driverActivity }),
  ...(driverSubscription === undefined ? {} : { driverSubscription }),
  ...(driverSubscriptionInvoice === undefined ? {} : { driverSubscriptionInvoice }),
  ...(driverDeductions === undefined ? {} : { driverDeductions }),
  ...(driverVehicle === undefined ? {} : { driverVehicle }),
  ...(notifications === undefined ? {} : { notifications }),
  ...(notificationPrefs === undefined ? {} : { notificationPrefs }),
  ...(driverLocation === undefined ? {} : { driverLocation }),
  ...(coreEventIntake === undefined ? {} : { coreEventIntake }),
  policy: {
    sql: container.sql,
    perAddress: limiterFor("GET", "/v1/policy", "عنوانُ العميلِ"),
    log,
  },
});

/**
 * مسار المقاييس — يُركَّب هنا وليس في `server.ts` لنفس سبب موجّهي الإدارة
 * (ADR 0007): قراءة مقاييس القاعدة تستعلم فعلاً، و`server.ts` يُستورد في اختبارات
 * المسارات بلا قاعدة. والمسار يفشل مغلقاً عند غياب `METRICS_TOKEN`: مقاييسُ
 * منصّةٍ مفتوحةٌ للعالم تكشف أحجام الأعمال وأوقات الذروة لمن طلب الرابط.
 */
app.route(
  "/",
  createMetricsRoutes({
    metrics: operationalMetrics,
    metricsToken: process.env.METRICS_TOKEN,
    databaseGauges,
    log,
  }),
);

// لوحة الإدارة: موجّهان منفصلان يُركَّبان هنا لا في server.ts (ADR 0007).
const adminAuth = createAdminAuthPort(container.sql);

/**
 * نمطُ الخريطة يُحلَّل مرّةً عند الإقلاع لا في كل طلب: الضبط ثابتٌ في عمر العملية،
 * وتحليلُه في كل طلب كان سيدفع ثمنَ تفكيك روابطٍ بلا فائدةٍ ويُخفي خطأَ ضبطٍ إلى
 * أول زيارةٍ للصفحة بدل أن يظهر في السجل عند الإقلاع.
 *
 * وضبطٌ خاطئ (نمطٌ على http، أو مفتاحٌ في موضعين) **لا يُسقط البوابة**: الخريطة
 * زينةُ لوحةٍ إدارية، وإسقاطُ استقبال طلبات تلغرام لأجلها كان سيُوقف الخدمةَ كلَّها
 * بسبب ميزةٍ ثانوية. يُسجَّل بوضوح، وتبقى السياسة أضيقَ ما يمكن (لا أصلَ خارجي).
 */
const mapStyle = resolveMapStyle({
  provider: config.mapProvider,
  styleUrl: config.mapStyleUrl,
  publicApiKey: config.mapTilesPublicKey,
});
if (!mapStyle.ok) {
  log("map.config.invalid", { key: mapStyle.error.key, detail: mapStyle.error.detail });
} else if (!mapStyle.value.configured) {
  log("map.disabled", { reason: mapStyle.value.reason });
} else {
  log("map.enabled", { origins: mapStyle.value.origins });
}
const mapOrigins: readonly string[] =
  mapStyle.ok && mapStyle.value.configured ? mapStyle.value.origins : [];
/**
 * سطحُ اللوحةِ — `F5-08` / `ARCH-011` · ADR 0064.
 *
 * التركيبُ **مشروطٌ بإعلانٍ** لا دائمٌ: حين تُعلَنُ `RUN_ADMIN_IN_GATEWAY=false`
 * تكونُ خدمةُ `waslah-admin` هي موضعَ اللوحةِ الوحيدَ، وتركيبُها ههنا كذلك يعني
 * سطحاً إداريّاً مكشوفاً على الأصلِ الذي يستقبلُ ويبهوكَ تلغرام، وتقاريرَ ثقيلةً
 * تسحبُ من بِركةِ الاتّصالاتِ التي يجبُ أن تُجيبَ الويبهوكَ في ثوانٍ — أي إبطالُ
 * العزلِ الذي أُنشئت الخدمةُ لأجلِهِ، بلا طلبٍ يُخفِقُ ولا حرفٍ يشكو.
 *
 * والترتيبُ الحرجُ (الأخصُّ أوّلاً) انتقلَ إلى `admin/mount.ts`: هو الموضعُ الوحيدُ
 * الذي يعرفُهُ، وتستدعيهِ عمليةُ `apps/admin` نفسُها — فلا ينحرفُ الترتيبُ بين
 * موضعَي تشغيلٍ. والتعليلُ الكاملُ في رأسِ ذلك الملفِّ.
 *
 * ومُرسِلُ رمزِ الدخولِ يُغلَّفُ ههنا لا في `mount.ts`: البوّابةُ تملكُ مُرسِلَ بوتِ
 * السائقِ أصلاً من حاويتِها، وعمليةُ اللوحةِ تبنيه بنفسِها من الرمزِ وحدَه.
 */
if (config.runAdminInGateway) {
  mountAdminSurface(app, {
    sql: container.sql,
    auth: adminAuth,
    bus: container.tracking.bus,
    // مسلكُ إبطالِ جلساتِ Mini App منَ اللوحةِ (`SEC-18-ب`) — بلا هذا السطرِ يردُّ ٥٠٣.
    revocation: sessionRevocationStore,
    // `F16-03` — منفذُ رموزِ التتبُّعِ لقطعِ الروابطِ منَ اللوحةِ: نفسُ منفذِ
    // زرِّ الراكبِ لا نسخةً ثانيةً.
    trackingTokens: container.trackingTokens,
    // `F16-02` — منفذُ الإقفالِ الإداريِّ للتذاكرِ من صفحةِ النزاعاتِ: نفسُ
    // منفذِ أزرارِ القروبِ (`resolve_support_ticket`) لا نسخةً ثانيةً.
    disputeResolutions: container.disputeResolutions,
    // `F16-01` — منفذُ تعليمِ التقييمِ منَ اللوحةِ: نفسُ منفذِ `/flag` في القروبِ.
    ratingFlags: container.reputation.flags,
    // مفتاحُ سرِّ البابِ الموازي (`SEC-21`) — غيابُهُ يُغلقُ البابَ موحَّدًا لا سقوطًا.
    breakGlassTotpKey: config.adminBreakGlassTotpKey,
    // حاصرُ دخولِ البابِ الموازي (`SEC-21`): منَ السِجلِّ المغلقِ كما كلَّ حدٍّ،
    // ويُرقّى إلى Redis متى وُجدَ كسائرِ حدودِ ما قبلَ المصادقةِ (ADR 0139).
    breakGlassLoginPerAddress: limiterFor("POST", "/admin/login/break-glass", "عنوانُ العميلِ"),
    // مُوقِّعُ روابطِ القراءةِ للوثائقِ — نفسُ المُوقِّعِ الذي يخدمُ مسارَ المركبةِ.
    ...(vehicleReadStorage === null ? {} : { readSigner: new HttpReadSigner(vehicleReadStorage) }),
    mapOrigins,
    ...(mapStyle.ok ? { mapStyle: mapStyle.value } : {}),
    maplibreSri: config.maplibreSri,
    // `ADM-MSG-01` — معاينةُ معرضِ الرسائلِ: مُرسِلٌ خامٌ لكلِّ بوتٍ (لا غلافَ دخولٍ —
    // العيّنةُ تحملُ لوحتَها النهائيّةَ). وفي النقلِ الصامتِ لا معاينةَ: لا رسائلَ حقيقيّةً.
    ...(config.telegramTransport === "silent"
      ? {}
      : {
          messagePreview: (() => {
            const senders = {
              driver: grammyTelegramSender(config.driverBotToken),
              rider: grammyTelegramSender(config.riderBotToken),
            };
            return {
              miniAppUrl: config.miniAppUrl,
              send: async (
                bot: "driver" | "rider",
                chatId: string,
                text: string,
                markup: unknown,
              ) => {
                await senders[bot].sendMessage(chatId, text, markup);
              },
            };
          })(),
        }),
    codeSender: {
      send: async (telegramId, text) => {
        try {
          await container.driverSender.sendMessage(telegramId, text, undefined);
          return true;
        } catch {
          return false;
        }
      },
    },
    log,
  });
} else {
  log("admin_surface.not_mounted", {
    hint: "RUN_ADMIN_IN_GATEWAY=false — اللوحةُ في خدمةِ waslah-admin وحدَها (ADR 0064)",
  });
}

/**
 * صفحةُ التتبّع العامّة (§4.2). تُركَّب هنا لا في `server.ts` لنفس سبب موجّهي
 * الإدارة (ADR 0007): تقرأ من القاعدة، و`server.ts` يُستورد في اختبارات المسارات
 * بلا قاعدة.
 *
 * والوسيطُ الأمنيّ يُركَّب على الموجّه نفسه لا على التطبيق كلّه: سياسةُ
 * `default-src 'none'` كانت ستكسر لوحةَ الإدارة، ومسارُ الويبهوك لا يحتاج ترويسةَ
 * صفحةٍ أصلاً. فيُحصر الوسيطُ في صاحبه.
 *
 * وترتيبُ التركيب: بعد سطحِ الإدارةِ كلِّه. وكان قبلَ `F5-08` بينَ `/admin/api`
 * و`/admin`؛ فلمّا صار السطحُ يُركَّب دفعةً واحدةً في `mountAdminSurface` انتقلَ
 * هذا السطرُ إلى ما بعدَهم جميعاً. **والانتقالُ بلا أثرٍ** لا لأنّ الترتيبَ لا
 * يُهمُّ بل لأنّ `/track` و`/api/track` لا يتشابهان مع أيِّ بادئةٍ إداريّةٍ في أيِّ
 * اتجاهٍ — لا هما بادئةٌ لها ولا هي بادئةٌ لهما. ولو تشابهت لكان النقلُ عطلاً
 * صامتاً، ولذلك تُقال عدمُ التشابهِ صريحاً ولا يُقال «الترتيبُ محفوظٌ».
 * (ولا تعارضَ مع `routes/tracking.ts` لأنّه غيرُ مركَّب أصلاً — الفرقُ موثَّقٌ في
 * رأس `routes/public-tracking.ts`.)
 */
const publicTracking = createPublicTrackingRoutes({
  tokens: container.tracking.tokens,
  mapStyle: mapStyle.ok ? mapStyle.value : { configured: false, reason: "ضبطُ الخريطة غير صالح" },
  scriptUrl: maplibreScriptUrl(),
  stylesheetUrl: maplibreStylesheetUrl(),
  integrity: config.maplibreSri ?? MAPLIBRE_SRI_UNSET,
  securityHeaders: createPublicSecurityHeaders({
    mapOrigins,
    scriptOrigin: MAPLIBRE_CDN_ORIGIN,
  }),
  limits: {
    perTokenPage: limiterFor("GET", "/track/:token", "رمزُ المشاركةِ"),
    perTokenPosition: limiterFor("GET", "/api/track/:token/position", "رمزُ المشاركةِ"),
  },
  log,
});
app.route("/", publicTracking);

/**
 * فحص مخطط استباقي: الاتصال بالقاعدة ينجح تماماً ولو كانت فارغة بلا هجرات،
 * فتقلع الخدمة سليمة ظاهراً ثم يكتشف العطلَ أولُ مستخدم حقيقي يضغط /start.
 * هذا ما حدث فعلاً في أول نشر على Render.
 *
 * لا يمنع الإقلاع عمداً: الخدمة تبقى حيّة لـ /health ولتطبيق الهجرات عليها
 * دون دورة إعادة تشغيل خانقة، لكن السبب يظهر في السجلّ لحظة الإقلاع لا بعد ساعات.
 */
async function verifySchemaApplied(): Promise<void> {
  try {
    await container.sql`select 1 from cities limit 1`;
    log("gateway.schema_applied", {});
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    log("gateway.schema_not_applied", {
      detail,
      remedy: "راجع docs/render-deployment-vars.md §4 — خطوة «القاعدة أولاً»",
    });
  }
}

log("gateway.started", {
  port: config.port,
  env: config.env,
  missingEnv: missingEnvKeys(process.env),
});

// بعد سطر «البوابة تعمل» لا قبله، حتى لا يؤخّر استعلامٌ بطيء إعلانَ جاهزية المنفذ.
void verifySchemaApplied();

/**
 * `WR-04` (ADR 0279) — فحصُ اتّصالٍ واحدٍ بمزوّدِ الترجمةِ من بيئةِ التشغيلِ نفسِها، بعدَ إعلانِ
 * الجاهزيّةِ لا قبلَه. نصٌّ ثابتٌ عامٌّ، ومرّةٌ لكلِّ إقلاع، فلا يُرسَلُ شيءٌ من مستخدمٍ ولا يُستنزَفُ
 * من الحصّةِ إلّا بضعُ حروف. والسجلُّ: المآلُ والزمنُ و«البريدُ مضبوطٌ؟» نعم/لا، لا قيمتُه.
 */
if (container.translation.provider !== null) {
  const translationProvider = container.translation.provider;
  void probeTranslation(translationProvider, {
    contactEmailConfigured: config.translationContactEmail !== null,
  }).then((report) => {
    const meta = {
      provider: report.provider,
      kind: report.kind,
      ms: report.ms,
      contact_email_configured: report.contactEmailConfigured,
    };
    if (report.ok) log("translation.probe_ok", meta);
    else log("translation.probe_failed", meta);
  });
}

/**
 * `F7-04` — سطرُ ميزانيّةِ الاتّصالاتِ عندَ الإقلاعِ.
 *
 * ولمَ يُسجَّلُ أصلاً: يومَ تضيقُ القاعدةُ باتّصالاتِها يكونُ أوّلَ سؤالٍ «كم
 * اتّصالاً تفتحُ المنظومةُ عن نفسِها؟» — وأسوأُ جوابٍ عنه تخمينٌ يُجمَعُ بيدٍ من
 * أربعةِ ملفّاتٍ تحتَ ضغطِ عطلٍ. والرقمُ ههنا **محسوبٌ من الثوابتِ التي أقلعَت
 * عليها هذه العمليةُ نفسُها**، و`workerRunsInGateway` تُقرأُ من الإعدادِ الفعليِّ لا
 * من المُعلَنِ: بوّابةٌ تحملُ المهامَّ تحملُ تجمُّعَيها معها، وهو الفرقُ الذي كانت
 * صيغةُ `5N + 10M` تُسقِطُه.
 *
 * ولا يُقارَنُ بسقفِ المزوِّدِ ولا يُسقِطُ إقلاعاً: السقفُ مُدخَلٌ من خارجِ
 * المستودعِ (خطّةُ الحسابِ · إعدادُ pooler)، وحاجزٌ يحكمُ على رقمٍ لا يعرفُه
 * يُطمئنُ زوراً (`ح-5`).
 */
log("connection_budget.declared", {
  summary: describeConnectionBudget(
    computeConnectionBudget({
      ...DECLARED_TOPOLOGY,
      workerRunsInGateway: config.runWorkerInGateway,
      adminRunsInGateway: config.runAdminInGateway,
    }),
  ),
});

/**
 * المهامّ الدورية داخل نفس العملية — خلف متغيّر بيئة صريح.
 *
 * لماذا هنا وليس في `server.ts`؟ لأن `server.ts` يُستدعى في اختبارات المسارات، وبدء
 * مؤقّتات حقيقية وتجمّعات اتصال هناك كان سيجعل كل اختبار مسار يعلّق على القاعدة.
 * هذا الموضع — نقطة التشغيل وحدها — لا يُستورد في أي اختبار.
 *
 * الإقلاع غير حاجز: بناء قائمة المهامّ يستعلم جدول المدن، ولا يجوز أن يؤخّر ذلك
 * استجابة المنفذ فيقرأها Render فشلاً في فحص الجاهزية.
 */
if (config.runWorkerInGateway) {
  void startEmbeddedWorker(
    config,
    createObservabilityJobLogger(operationalMetrics, { info: log.info, error: log.error }),
    // نفسُ سجلّ المقاييس الذي يخدمه `/metrics`: العامل المدمج يعيش في هذه العملية،
    // فعدّاداتُه — وأهمُّها عرضٌ سقط بمهلته — تُقرأ من المنفذ نفسه بلا خدمةٍ ثانية.
    { metrics: operationalMetrics },
  )
    .then((handle) => {
      embeddedWorker = handle;
    })
    .catch((cause: unknown) => {
      // فشل إقلاع العامل لا يُسقط البوابة: بوابةٌ تعمل بلا مهامّ دورية أفضل من
      // انعدام البوتَين معاً، والسبب يظهر في السجلّ لحظته.
      const detail = cause instanceof Error ? cause.message : String(cause);
      log.error("embedded_worker.boot_failed", { detail });
    });
} else {
  // «العامل المدمج غير مُفعَّل»
  log("embedded_worker.disabled", {
    hint: "اضبط RUN_WORKER_IN_GATEWAY=true إن لم توجد خدمة waslah-worker مستقلّة",
  });
}

/**
 * تسجيل قائمة الأوامر عند تلغرام — غير حاجز ولا مُسقِط.
 *
 * لماذا هنا وليس في `server.ts`: لنفس السبب في العامل المدمج — `server.ts`
 * يُستورد في اختبارات المسارات، ونداء شبكة حقيقيّ إلى api.telegram.org هناك كان
 * سيجعل كل اختبار مسار يخرج إلى الشبكة.
 *
 * وفشله لا يمسّ الخدمة: القائمة زينة في واجهة تلغرام، والأوامر نفسها تعمل
 * مكتوبةً بلا تسجيل، والقائمة الدائمة أسفل الشاشة تعمل من داخل الحوار لا من هنا.
 * فلا يجوز أن يمنع عجزٌ عن تزيين الواجهة إقلاعَ البوتَين.
 */
for (const [audience, token] of [
  ["driver", config.driverBotToken],
  ["rider", config.riderBotToken],
] as const) {
  void registerBotCommands(audience, grammyCommandRegistrar(token), {
    mode: config.botSurfaceMode,
    miniAppUrl: config.miniAppUrl,
  })
    .then(() => log("bot_commands.registered", { audience }))
    .catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      log("bot_commands.register_failed", { audience, detail });
    });
}

/**
 * الدرينرُ الخلفيُّ لوظائفِ تحديثِ تيليجرام — يُقلعُ بعدَ اكتمالِ تركيبِ الويبهوكِ
 * والحاويةِ، فإيصالُه إلى `handler` ممكنٌ هنا وحدَه. فشلُ إقلاعِه لا يُسقطُ البوابةَ:
 * وظائفُ تتراكمُ في الطابورِ (دائمةٌ في القاعدةِ) حتى يُقلعَ درينرٌ تالٍ، فلا يُفقَدُ
 * تحديثٌ. والسببُ يظهرُ في السجلّ.
 *
 * `OPS-EGRESS-01` (2026-10-13): كانت الفترةُ نصفَ ثانيةٍ، فكانَ الدرينرُ يسألُ القاعدةَ
 * 7200 مرّةٍ في الساعةِ والطابورُ فارغٌ — قرابةَ خُمسِ الحركةِ الصادرةِ من Render التي
 * استنفدت حصّةَ الـ5 GB المجانيّةَ فأُوقِفَت الخدمات. صارَ الإيداعُ في هذه العمليّةِ يوقظُ
 * الدرينرَ فورًا (`wakeDrainerOnEnqueue`)، فلا يتأخّرُ تحديثٌ، والمؤقّتُ شبكةُ أمانٍ لما
 * لا إيقاظَ له: إعادةٌ مؤجّلةٌ بـ`next_attempt_at`، أو صفٌّ أودعته نسخةٌ أخرى. والدرينرُ
 * يفرغُ الطابورَ كاملاً في كلِّ شوطٍ (claim حتى null)، ومانعُ التداخلِ باقٍ.
 */
// LOAD-01 (الدفعةُ الحاديةَ عشرةَ): أثرُ كلفةِ السيناريو — بغيابِ `DISPATCH_TRACE_FILE` هو `null` ولا أثرَ له.
loadTrace = createLoadTrace(process.env.DISPATCH_TRACE_FILE);
const drainLanes = parseTelegramDrainLanes(process.env.TELEGRAM_DRAIN_LANES);
if (drainLanes.invalid)
  log("telegram.drainer.lanes_invalid", {
    raw: process.env.TELEGRAM_DRAIN_LANES ?? null,
    using: drainLanes.lanes,
  });
updateDrainer = startTelegramUpdateDrainer(
  {
    queue: createPostgresTelegramUpdateQueue(container.sql),
    handler: container.handler,
    log,
    // SANDBOX-SOAK-01: مساراتٌ متوازيةٌ لكلِّ مستخدم. الافتراضُ ١ = السلوكُ التسلسليُّ القائم،
    // وقيمةٌ غيرُ عدديّةٍ تُسقِطُ إلى ١ داخلَ الدرينر (`Number.NaN > 1` باطل).
    lanes: drainLanes.lanes,
    // CAP-RUN-20261015 / D2+D3: توزيعُ المساراتِ بين البوتين وتجديدُ إيجارِ المحجوزِ المنتظر.
    fairBots: ["driver", "rider"],
    ...(loadTrace === null ? {} : { timing: loadTrace.drainer }),
    // S5 (ADR 0288 §ملحق): الردُّ لا يحجزُ مسارَ الوظيفةِ — `r11-wave-500` أثبتَ أنَّ انتظارَه
    // جعلَ إتمامَ وظائفِ إثباتِ الهاتفِ بمعدّلِ دلوِ البوتِ (22ث → 62ث).
    replyPool: createTelegramReplyPool({
      concurrency: TELEGRAM_REPLY_POOL_CONCURRENCY,
      maxQueued: TELEGRAM_REPLY_POOL_MAX_QUEUED,
      maxWaitMs: TELEGRAM_REPLY_POOL_MAX_WAIT_MS,
      log,
    }),
  },
  { intervalMs: TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS },
);

/**
 * خادمُ `Bun.serve` الفعليُّ — يُنشأ بعدَ اكتمالِ تركيبِ المسارات. الـ`fetch`
 * يُغلِّفُ `app.fetch` بثلاثةِ أمورٍ: (١) عدَّادُ الطلباتِ التجاريّةِ الجاريةِ لا فحوصِ
 * الصحةِ؛ (٢) بوّابةُ التصريفِ: عندَ `isDraining` يُسمَحُ لـ`/health` و`/ready`
 * فقط (حتى يرى المُوجِّهُ حالةَ «مُصرِّف») ويُرفَضُ ما عداهما بـ`503 draining`؛
 * (٣) و`serverHandle` يُملأ هنا فيقرؤهُ `lifecycle` عند الإشارةِ عبر الإغلاقِ.
 */
const httpHandler = createHttpBridge(
  {
    fetch: async (request: Request, server?: unknown) => {
      const { pathname } = new URL(request.url);
      const isProbe = pathname === "/health" || pathname === "/ready";

      if (lifecycle.isDraining() && !isProbe) {
        return Response.json({ status: "draining" }, { status: 503 });
      }

      if (isProbe) {
        return app.fetch(request, server);
      }

      inFlightRequests += 1;
      if (loadTrace === null) {
        try {
          return await app.fetch(request, server);
        } finally {
          inFlightRequests -= 1;
        }
      }
      const t0 = performance.now();
      let status = 500;
      try {
        const response = await loadTrace.inRoute(pathname, request.method, async () =>
          app.fetch(request, server),
        );
        status = response.status;
        return response;
      } finally {
        inFlightRequests -= 1;
        loadTrace.onHttp(pathname, request.method, performance.now() - t0, status);
      }
    },
  },
  config.port,
);

serverHandle = http.createServer(httpHandler);
serverHandle.listen(config.port);

ioServer = new IoServer(serverHandle, {
  cors: { origin: "*" },
});

/**
 * `F2-06` — **الإنتاجُ لا يبثُّ موقعاً حيّاً** (قرارُ المالكِ 2026-09-19). وقبلَ
 * هذا السطرِ كانَ الشرطُ `config.miniappSessionSecret !== null` وحدَه، و`render.yaml`
 * يضبطُ `MINIAPP_SESSION_SECRET` للبوّابةِ — فكانَت القناةُ تبثُّ `location_updated`
 * بـ`lat/lng` في الإنتاجِ **بلا رايةٍ ولا قرارٍ**، ووجودُ السرِّ وحدَه يُشغِّلُها.
 * والحكمُ الآنَ في `live-tracking-policy.ts` دالّةً نقيّةً مَقيسةً، لا شرطاً
 * مسطوراً ههنا لا يُختبَرُ إلّا بإقلاعِ خادمٍ.
 */
if (config.miniappSessionSecret !== null && isLiveLocationBroadcastPermitted(config.env)) {
  rideChannel = createRideChannel({
    io: ioServer,
    eventBus: container.tracking.bus,
    rides: createActiveRideResolver(container.sql),
    sessions: createSessionVerifier(
      container.sql,
      config.miniappSessionSecret,
      () => Date.now(),
      sessionRevocationStore,
    ),
    log,
  });
  rideChannel.start();
}

/**
 * `LOAD-01 Recovery` + `WR-04` — قناةُ العروضِ **خارجَ** حكمِ منعِ بثِّ الموقعِ:
 * لا تحملُ موقعًا (إشارةُ «حدّثْ لوحَك» فحسب)، فقرارُ 2026-09-19 لا يشملُها —
 * كانَ إقفالُها عليهِ خطأً تصنيفٍ أبقى إشارةَ العروضِ ميتةً في الإنتاجِ.
 * وتشترطُ سرَّ الجلسةِ وحدَهُ.
 */
if (config.miniappSessionSecret !== null) {
  offersChannel = createOffersChannel({
    io: ioServer,
    sessions: createOffersSessionVerifier(
      config.miniappSessionSecret,
      () => Date.now(),
      sessionRevocationStore,
    ),
  });
  offersChannel.start();
  // ADR 0287 — غرفةُ أحداثِ رحلةِ الراكبِ بالمحقِّقِ نفسِه (الهويةُ منَ الجلسةِ).
  riderTripChannel = createRiderTripChannel({
    io: ioServer,
    sessions: createOffersSessionVerifier(
      config.miniappSessionSecret,
      () => Date.now(),
      sessionRevocationStore,
    ),
  });
  riderTripChannel.start();
  const channel = riderTripChannel;
  container.riderTripSignal.notify = (telegramUserId, orderId) => {
    if (channel.isRiderConnected(telegramUserId)) channel.notifyRider(telegramUserId, orderId);
  };
}

/**
 * `LOAD-01 Recovery` — مسارُ الإشارةِ الداخليُّ: نداءُ شوطِ التسليمِ (العاملُ)
 * يسألُ: «هل السائقُ متصلٌ؟ بُثَّتْ لهُ إشارةُ اللوحِ». سرٌّ مشتركٌ
 * (`INTERNAL_SIGNAL_SECRET`) يُعطَّلُ المسارُ بغيابِهِ (503) لا يُفتَحُ لكلِّ
 * أحدٍ، ومهلةُ الطالبِ قصيرةٌ كي لا يُعلَّقَ الشوطُ على بوابةٍ بطيئةٍ.
 */
if (offersChannel !== null) {
  app.route(
    "/",
    createInternalOffersSignalRoutes({
      isDriverConnected: offersChannel.isDriverConnected,
      notifyDriver: offersChannel.notifyDriver,
      secret: process.env.INTERNAL_SIGNAL_SECRET ?? null,
      log,
      ...(riderTripChannel === null
        ? {}
        : {
            rider: {
              isRiderConnected: riderTripChannel.isRiderConnected,
              notifyRider: riderTripChannel.notifyRider,
            },
          }),
    }),
  );
}

/**
 * `WR-04` — قناةُ المحادثةِ **خارجَ** حكمِ منعِ بثِّ الموقعِ: لا تحملُ موقعاً،
 * فلا يشملُها قرارُ 2026-09-19. وتشترطُ سرَّ الجلسةِ وحدَه.
 */
if (config.miniappSessionSecret !== null) {
  chatChannel = createChatChannel({
    io: ioServer,
    sessions: createOffersSessionVerifier(
      config.miniappSessionSecret,
      () => Date.now(),
      sessionRevocationStore,
    ),
    store: orderChatStore,
    log,
  });
  chatChannel.start();
}
