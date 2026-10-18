/**
 * الغرض: تركيب تبعيات العامل الخلفي وبناء قائمة الجوبات الفعلية لكل مدينة مفعَّلة.
 *   هذا هو الموضع الوحيد الذي يعرف فيه العامل قاعدةً ومرسِلَ تيليجرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts، واختبارات جوبات العامل
 * ملاحظات مستقبلية: القفل الموزَّع يُبنى هنا ويُسلَّم للمشغّل، فيحمي كل مهمّة مسجَّلة.
 */

import { startRideKeyboard } from "../../../packages/application/bots/rating-dialog.ts";
import type { BroadcastPublisher } from "../../../packages/application/broadcast/ports.ts";
import type { OfferPublisher } from "../../../packages/application/dispatch/broadcast-offers.ts";
import { closeDeadOfferCards } from "../../../packages/application/dispatch/close-dead-offer-cards.ts";
import { closeEscalationCards } from "../../../packages/application/dispatch/close-escalation-cards.ts";
import {
  type CancellationMessenger,
  createOrderCancelledHandler,
} from "../../../packages/application/dispatch/deliver-cancellation-notification.ts";
import { createDriverCandidateNoticeHandler } from "../../../packages/application/dispatch/deliver-candidate-notices.ts";
import { createChatMessageNoticeHandler } from "../../../packages/application/dispatch/deliver-chat-message-notice.ts";
import { createDriverCityNoticeHandler } from "../../../packages/application/dispatch/deliver-driver-city-notice.ts";
import { createLocationReminderHandler } from "../../../packages/application/dispatch/deliver-location-reminder.ts";
import {
  createLostItemReportHandler,
  type LostItemMessenger,
} from "../../../packages/application/dispatch/deliver-lost-item-notification.ts";
import {
  createAgreedHandler,
  createTurnClosedHandler,
  createTurnOpenedHandler,
  type NegotiationMessenger,
} from "../../../packages/application/dispatch/deliver-negotiation-notification.ts";
import { createOfferNotificationHandler } from "../../../packages/application/dispatch/deliver-offer-notification.ts";
import { createRiderTripNoticeHandler } from "../../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import {
  createNoDriverFoundHandler,
  createWiderCircleOpenedHandler,
  type UnmatchedRiderMessenger,
} from "../../../packages/application/dispatch/deliver-unmatched-notification.ts";
import { expireSearchingOrders } from "../../../packages/application/dispatch/expire-searching-orders.ts";
import { releaseScheduledOrders } from "../../../packages/application/dispatch/release-scheduled-orders.ts";
import { createDisputeResolutionHandler } from "../../../packages/application/dispute/deliver-dispute-resolution.ts";
import type { DocumentExpiryWarningSender } from "../../../packages/application/driver/warn-expiring-documents.ts";
import { archiveDueLocationPartitions } from "../../../packages/application/geo/archive-location-partitions.ts";
import { ensureLocationPartitions } from "../../../packages/application/geo/ensure-location-partitions.ts";
import { flushDriverLocationBacklog } from "../../../packages/application/geo/flush-driver-location-backlog.ts";
import { PortFailureError } from "../../../packages/application/ports/index.ts";
import {
  createSafetyResolutionClosedHandler,
  type SafetyResolutionMessenger,
} from "../../../packages/application/safety/deliver-safety-resolution.ts";
import type { SafetyCardPublisher } from "../../../packages/application/safety/ports.ts";
import type { DistributedLock } from "../../../packages/application/scheduling/distributed-lock.ts";
import type {
  CriticalJobExpectation,
  JobHeartbeatRecorderPort,
} from "../../../packages/application/scheduling/job-heartbeat.ts";
import type { ExpiryWarningSender } from "../../../packages/application/subscription/expire-subscriptions.ts";
import type { SubscriptionNoticePublisher } from "../../../packages/application/subscription/notice-ports.ts";
import { createFulfillmentLifecycle } from "../../../packages/application/wasla/fulfillment-lifecycle.ts";
import { shipDueMoveEvents } from "../../../packages/application/wasla/ship-due-move-events.ts";
import { ADMIN_METRIC_WINDOW_HOURS } from "../../../packages/domain/admin/metric-snapshot.ts";
import { createMetricSnapshotRefreshPort } from "../../../packages/infrastructure/admin/metric-snapshot-store.ts";
import {
  createGoogleDriveStorage,
  createLocalBackupStorage,
} from "../../../packages/infrastructure/backup/index.ts";
import { createBroadcastDeliveryPort } from "../../../packages/infrastructure/broadcast/broadcast-adapters.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createDriverCandidateRepository,
  createExpireOffersRpc,
  createOfferRepository,
  createOfferWriter,
  createPendingOfferRepository,
  createSearchingOrderFinder,
} from "../../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import { createStaleEscalationCardPort } from "../../../packages/infrastructure/dispatch/escalation-card-adapters.ts";
import { createStaleGroupCardPort } from "../../../packages/infrastructure/dispatch/negotiation-adapters.ts";
import { createNegotiationWiring } from "../../../packages/infrastructure/dispatch/negotiation-wiring.ts";
import { createOfferBoardDelivery } from "../../../packages/infrastructure/dispatch/offer-board-delivery.ts";
import { createDeadOfferCardPort } from "../../../packages/infrastructure/dispatch/offer-card-adapters.ts";
import {
  createPickupReminderStateReader,
  createScheduledOrderReleaser,
  createSearchingOrderExpirer,
  enqueueScheduledReminders,
} from "../../../packages/infrastructure/dispatch/scheduled-orders-adapters.ts";
import { createUnmatchedOrderFinder } from "../../../packages/infrastructure/dispatch/unmatched-adapters.ts";
import { createDocumentExpiryRpcPort } from "../../../packages/infrastructure/driver/document-expiry-rpc.ts";
import { createPaymentRepository } from "../../../packages/infrastructure/financial/payment-adapters.ts";
import { createPaymentProvider } from "../../../packages/infrastructure/financial/payment-provider-factory.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import { createDriverLocationBatchPersistence } from "../../../packages/infrastructure/geo/driver-location-batch-persistence.ts";
import { createDriverLocationPartitionMaintenance } from "../../../packages/infrastructure/geo/driver-location-partition-maintenance.ts";
import {
  createLocationArchiveCatalog,
  createLocationArchiveCodec,
  createLocationArchiveStore,
} from "../../../packages/infrastructure/geo/location-archive-adapters.ts";
import { createRedisDriverLocationHotState } from "../../../packages/infrastructure/geo/redis-driver-location-hot-state.ts";
import {
  MINIAPP_ENTRY_LABEL,
  withMiniAppEntry,
} from "../../../packages/infrastructure/notification/miniapp-entry-sender.ts";
import { createNotificationOutboxPort } from "../../../packages/infrastructure/notification/notification-outbox-adapters.ts";
import { createOutboundResilience } from "../../../packages/infrastructure/notification/outbound-resilience.ts";
import {
  outboundBucketKeyOfToken,
  withOutboundResilience,
} from "../../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import { createRiderTripAppDelivery } from "../../../packages/infrastructure/notification/rider-trip-app-delivery.ts";
import {
  createRiderCandidateFactsReader,
  createRiderTripFactsReader,
} from "../../../packages/infrastructure/notification/rider-trip-facts.ts";
import {
  asIdentifyingSender,
  asOutboundSender,
  asSupportSender,
  grammyTelegramSender,
  type TelegramSender,
} from "../../../packages/infrastructure/notification/telegram-api-sender.ts";
import {
  createBroadcastPublisher,
  grammyBroadcastApi,
} from "../../../packages/infrastructure/notification/telegram-broadcast-sender.ts";
import { createTelegramCancellationMessenger } from "../../../packages/infrastructure/notification/telegram-cancellation-notifier.ts";
import { createTelegramApi } from "../../../packages/infrastructure/notification/telegram-client.ts";
import type { OutboundSender } from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { createOfferPublisher } from "../../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import { createTelegramLostItemMessenger } from "../../../packages/infrastructure/notification/telegram-lost-item-notifier.ts";
import {
  createTelegramNegotiationMessenger,
  type IdentifyingSender,
} from "../../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import {
  createSubscriptionNoticePublisher,
  grammyNoticeApi,
} from "../../../packages/infrastructure/notification/telegram-notice-sender.ts";
import { createSafetyCardPublisher } from "../../../packages/infrastructure/notification/telegram-safety-notifier.ts";
import { createTelegramSafetyResolutionMessenger } from "../../../packages/infrastructure/notification/telegram-safety-resolution-notifier.ts";
import { createTicketOwnerNotifier } from "../../../packages/infrastructure/notification/telegram-support-notifier.ts";
import { createTelegramUnmatchedMessenger } from "../../../packages/infrastructure/notification/telegram-unmatched-notifier.ts";
import { withTrafficPriority } from "../../../packages/infrastructure/notification/traffic-priority-sender.ts";
import { runWithCorrelationId } from "../../../packages/infrastructure/observability/correlation.ts";
import {
  instrumentExpireOffersRpc,
  instrumentOfferWriter,
} from "../../../packages/infrastructure/observability/dispatch.ts";
import {
  createStructuredLogger,
  type OperationalMetrics,
} from "../../../packages/infrastructure/observability/index.ts";
import {
  createSettingsRepository,
  rememberSettingsByCity,
} from "../../../packages/infrastructure/policy/settings-repository.ts";
import { createUpstashRedis } from "../../../packages/infrastructure/redis/upstash.ts";
import { createRatingRecomputePort } from "../../../packages/infrastructure/reputation/rating-adapters.ts";
import { createSafetyDeliveryPort } from "../../../packages/infrastructure/safety/safety-adapters.ts";
import { createAdvisoryLock } from "../../../packages/infrastructure/scheduling/advisory-lock.ts";
import { createStaleAvailabilityRpc } from "../../../packages/infrastructure/scheduling/availability-adapters.ts";
import { createJobHeartbeatRecorder } from "../../../packages/infrastructure/scheduling/job-heartbeat-adapters.ts";
import { createSubscriptionLifecycleRpc } from "../../../packages/infrastructure/subscription/lifecycle-adapters.ts";
import { createSubscriptionNoticeDeliveryPort } from "../../../packages/infrastructure/subscription/notice-adapters.ts";
import { createCeilingExceededAdapter } from "../../../packages/infrastructure/tracking/ceiling-exceeded-adapters.ts";
import { createStalledOrderAdapter } from "../../../packages/infrastructure/tracking/stalled-order-adapters.ts";
import { createTrackingTokenRpc } from "../../../packages/infrastructure/tracking/tracking-token-adapters.ts";
import { createOrderRepository } from "../../../packages/infrastructure/transport/order-adapters.ts";
import { createCoreEventShipper } from "../../../packages/infrastructure/wasla/core-event-shipper.ts";
import { createOperationalJobRepository } from "../../../packages/infrastructure/wasla/operational-job-repository.ts";
import { DB_POOL_MAX, JOB_CONCURRENCY } from "../../../packages/shared/config/connection-budget.ts";
import { CORE_EVENT_TRANSPORT_ENV } from "../../../packages/shared/config/core-event-transport.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { MOVE_EVENT_OUTBOX_CONSUMER_CONCURRENCY } from "../../../packages/shared/config/move-event-outbox.ts";
import type { NotificationKind } from "../../../packages/shared/config/notification-kinds.ts";
import {
  ARCHIVE_MAX_DAYS_PER_RUN,
  ARCHIVE_PART_ROWS,
  LOCATION_HOT_DAYS,
} from "../../../packages/shared/config/retention-policy.ts";
import { translate } from "../../../packages/shared/i18n/index.ts";
import { type CityId, systemClock } from "../../../packages/shared/kernel/index.ts";
import { err, ok } from "../../../packages/shared/result/index.ts";
import { type BackupConfig, createPgDumper, runDatabaseBackup } from "./jobs/backup-database.ts";
import { cleanupStaleSessions } from "./jobs/cleanup-stale-sessions.ts";
import { deliverBroadcasts } from "./jobs/deliver-broadcasts.ts";
import {
  deliverNotifications,
  notificationDrainSettingsFromEnv,
} from "./jobs/deliver-notifications.ts";
import { deliverSafetyIncidents } from "./jobs/deliver-safety-incidents.ts";
import { deliverSubscriptionNotices } from "./jobs/deliver-subscription-notices.ts";
import { detectCeilingExceededOrders } from "./jobs/detect-ceiling-exceeded.ts";
import { detectStalledOrders } from "./jobs/detect-stalled-orders.ts";
import { expireOffers } from "./jobs/expire-offers.ts";
import { expireSubscriptions, warnExpiringSoon } from "./jobs/expire-subscriptions.ts";
import { expireTrackingTokens } from "./jobs/expire-tracking-tokens.ts";
import { recomputeRatings } from "./jobs/recompute-ratings.ts";
import { runReconcilePendingPayments } from "./jobs/reconcile-pending-payments.ts";
import { runRedispatchSearching } from "./jobs/redispatch-searching.ts";
import { refreshAdminMetrics } from "./jobs/refresh-admin-metrics.ts";
import { rotateUnsubscribedNegotiations } from "./jobs/rotate-unsubscribed-negotiation.ts";
import { sweepDecidedOfferNotifications } from "./jobs/sweep-decided-offer-notifications.ts";
import { runSweepUnmatchedOrders } from "./jobs/sweep-unmatched-orders.ts";
import { runBackupRestoreVerification } from "./jobs/verify-backup-restore.ts";
import { warnExpiringDocumentsJob } from "./jobs/warn-expiring-documents.ts";
import type { JobDefinition, JobLogger } from "./runner.ts";

/** `OPS-POOL-01`: محاولاتُ قراءةِ المدنِ عندَ الإقلاعِ وخطوةُ المهلةِ المتزايدةِ بينَها. */
const CITY_LIST_ATTEMPTS = 8;
const CITY_LIST_RETRY_STEP_MS = 4_000;

/**
 * `OPS-EGRESS-01` — مدّةُ تذكُّرِ إعداداتِ المدينةِ في العامل. دقيقةٌ لا تُغيّرُ معنى إعدادٍ
 * مقيسٍ بالدقائق (مدّةُ البحث، مهلةُ العرض)، وتجعلُ القراءةَ مرّةً لكلِّ مدينةٍ في الدقيقة
 * بدلَ مرّةٍ في كلِّ شوط. وتعديلُ المالكِ يصلُ المهامَّ خلالَها.
 */
export const WORKER_SETTINGS_REMEMBER_MS = 60_000;

/** تواتر كل مهمّة بالثواني. تقنيّة لا تجارية: لا تُقرأ من platform_settings. */
export const JOB_INTERVALS = {
  expireOffers: 60,
  /**
   * `LOAD-01 Recovery` — كنسُّ العروضِ المحسومةِ من طابورِ الإشعاراتِ جملةً: مهلةُ
   * العرضِ (٤٥ث) وزمنُ حسمِهِ الفعليُّ (~١٠ث) يَدَعانِ هامشًا واسعًا للدقيقةِ
   * الكاملةِ (الحسمُ + الكنسُ ≈ ٧٠ث « ١٢٠ث بوابةَ P7) — والدقيقةُ الأخفُّ حملًا
   * على القاعدةِ: جولةُ ٥٠ب قاستْ ٨٪ فشلَ تحديثِ موقعٍ تحتَ الكنسِ كلَّ ١٥ث
   * (ازدحامُ القاعدةِ يظهرُ في المسارِ الأضعفِ لا في الكنسِ نفسِهِ).
   */
  sweepDecidedOffers: 60,
  rotateNegotiations: 60,
  cleanupStale: 1800,
  expireSubscriptions: 900,
  warnExpiring: 21_600,
  warnExpiringDocuments: 21_600,
  sweepUnmatched: 60,
  /**
   * أقصر من مهلة العرض (45 ثانية افتراضاً) عن قصد: راكبٌ ينتظر، وعرضٌ انتهت مهلته
   * يجب أن تُفتح بعده دورةٌ في جزءٍ من مهلةٍ أخرى لا في مهلةٍ كاملة. والشوطُ الذي
   * يجد كلَّ المؤهّلين مستبعَدين بعرضٍ حيّ لا يكتب شيئاً ولا يستهلك دورةَ بثّ.
   */
  redispatchSearching: 20,
  /**
   * `WR-06` (ADR 0273) — إطلاقُ المجدولِ إلى البحث. أقصرُ من شوطِ البثِّ: الإطلاقُ يبثُّ ما
   * أطلقَه فورًا، فالتأخّرُ عن `dispatch_at` لا يتجاوزُ هذه الثواني. وحرِجٌ بنبضةٍ لكلِّ مدينة:
   * توقّفُه يعني طلباتٍ لا يُبحَثُ لها عن سائقٍ أبدًا.
   */
  releaseScheduled: 15,
  /**
   * `WR-22` (ADR 0276) — انتهاءُ البحث. المدّةُ بالدقائق، فشوطٌ في الدقيقةِ يكفي: الطلبُ يُنهى
   * بعدَ مدّتِه بأقلَّ من دقيقة. وليسَ حرجًا (لا نبضةَ في `/ready`): توقّفُه يُبقي الطلبَ يبحثُ
   * كما كانَ قبلَه، لا يُفسدُ شيئًا.
   */
  expireSearching: 60,
  closeEscalationCards: 60,
  /** `WR-06` — تذكيراتُ المجدول (الراكبُ قبلَ موعدِه، والسائقُ المُسنَدُ قبلَ الحضور). */
  enqueueScheduledReminders: 60,
  recomputeRatings: 3600,
  backupDatabase: 86400, // يوميّ لا أقلّ — البند 7.2
  /**
   * التحقّق يوميّ مثل النسخ نفسه: نسخةٌ لم تُستعاد قطّ ليست نسخةً احتياطية بل
   * ملفٌ مجهول المحتوى، ومن اكتشف فسادها يوم الكارثة لم يكن يملك نسخاً.
   */
  verifyBackupRestore: 86400,
  /**
   * `F7-06` — يوميٌّ: النافذةُ الساخنةُ أربعةَ عشرَ يوماً، فشوطٌ في اليومِ يكفي
   * بفارقٍ واسعٍ، وأكثرُ من ذلكَ رفعٌ متكرّرٌ لا يُخرِجُ صفّاً زائداً.
   */
  archiveLocationPartitions: 86400,
  deliverSafetyIncidents: 30,
  /**
   * `W-5` — كلّ خمسَ عشرةَ ثانيةً: حدثُ `move.job.*` خبرٌ يَنتظِرُه CORE ليُخبِرَ
   * عميلَه، وعمرُ أقدمِ صفٍّ مرصودٌ بحدِّ ثلاثِ مئةِ ثانيةٍ
   * (`MOVE_EVENT_OUTBOX_OLDEST_AGE_LIMIT_SECONDS`)، فدورةٌ في خمسَ عشرةَ تُبقي الحدَّ
   * بعيداً بفارقٍ يَحتمِلُ شوطاً ساقطاً أو اثنَينِ. وأسرعُ من ذلكَ نداءاتُ حجزٍ
   * فارغةٌ على قاعدةٍ في أكثرِ الدوراتِ: الصندوقُ فارغٌ في العادةِ.
   */
  shipMoveEvents: 15,
  /**
   * كلّ خمسِ ثوانٍ (كانت ثلاثين حتى `WR-09`): إشعارُ العرضِ يُكتَبُ ذرّيًّا في معاملةِ
   * open_offer_round نفسِها ثمّ يُرسَلُ من هذا العامل. وإشعارُ المرشَّحِ للراكبِ له نافذةُ
   * قرارٍ قصيرةٌ (15 ثانية)، فشوطٌ كلَّ ثلاثين كان يُوصِلُه بعدَ فواتِها. والشوطُ الفارغُ
   * نداءُ مطالبةٍ واحدٌ يعودُ `delivery: null`.
   * فشلُ تيليجرام يُعيدُ الصفَّ pending بموعدٍ جديد بلا تكرارِ أثرٍ (BUG-004).
   */
  deliverNotifications: 5,
  /** `WR-09` — تحريرُ المرشَّحِ الفائتِ وإخطارُ سائقِه. والانتهاءُ يُحكَمُ كسولاً في القاعدةِ أيضاً. */
  expireOrderCandidates: 5,
  /**
   * `WR-12` — كلَّ دقيقة: المهلةُ نفسُها بالدقائق (خمسٌ افتراضًا) فدقّةُ الثانيةِ بلا معنى،
   * والإيداعُ مفتاحُه دلوُ الزمنِ فتكرارُ الشوطِ لا يُكرِّرُ التذكير.
   */
  enqueueLocationReminders: 60,
  /**
   * `WR-13` — كلَّ دقيقة: نقلُ مدينةِ السائقِ يكفيه تأخّرُ دقيقة، والموقعُ المقبولُ للنقلِ
   * حديثٌ بدقيقتين (`driver_city_relocation_max_age_seconds`).
   */
  relocateDriversByLocation: 60,
  /**
   * كلّ عشر ثوانٍ: البثُّ محدودٌ بحجم دفعةٍ من إعداد المدينة (٢٥ افتراضاً)، فهذا
   * سقفٌ نظريّ حوالي ١٥٠ رسالة في الدقيقة للمدينة — تحت حدّ تلغرام بفارقٍ مريح،
   * وسريعٌ بما يكفي لئلّا يستغرق إعلانٌ لألف سائق ساعةً كاملة.
   */
  deliverBroadcasts: 10,
  /**
   * كل خمس دقائق: المراجعة ليست مسار الحسم الأساسي بل شبكة الأمان تحته. تشغيلها
   * أسرع يضاعف استدعاءات المزوّد بلا فائدة — الويبهوك أسرع منها دائماً — وتشغيلها
   * أبطأ يطيل المدّة التي يكون فيها السائق قد دفع ولا يعمل.
   */
  reconcilePendingPayments: 300,
  /**
   * كل خمس عشرة ثانية: صندوقُ إشعارات الاشتراك صغيرٌ بطبعه (تفعيلٌ أو انتهاءٌ
   * لسائقٍ واحد)، لكنّ تأخيرَه مكلف: سائقٌ دفع ولا يعرف أنّ اشتراكه سرى يعيد
   * الدفع أو يفتح تذكرةَ دعم.
   */
  deliverSubscriptionNotices: 15,
  /**
   * كلّ دقيقة: تضييقُ نافذةِ رابط التتبّع بعد انتهاء الرحلة (§4.2). لا يُسرَّع أكثر
   * لأنّ مهلةَ السماح نفسها بالدقائق (ربعُ ساعةٍ افتراضاً) فدقّةُ الثانية بلا
   * معنى، ولا يُبطَّأ لأنّ نبضةً كلَّ خمس دقائق تُطيل عمرَ الرابط خمسَ دقائق بلا
   * سبب. وليس هو حدَّ الأمن — التفصيل في رأس ملفّ المهمّة.
   */
  expireTrackingTokens: 60,
  /**
   * `F12-04` — كشفُ الطلباتِ العالقةِ. ١٢٠ ثانيةً لا ٦٠: أقصرُ مهلةِ عَلَقٍ
   * عشرونَ دقيقةً، فنبضةٌ كلَّ دقيقتَينِ تكشفُ في حدودِ ١٪ من المهلةِ — وأسرعُ
   * من ذلكَ نداءُ قاعدةٍ بلا فائدةٍ لأنَّ الحكمَ لا يتغيَّرُ في ثانيةٍ.
   */
  detectStalledOrders: 120,
  /**
   * `F12-20` — كاشفُ تجاوزِ السقفِ. ٣٠٠ ثانيةً (خمسُ دقائقَ): السقفُ بالساعاتِ
   * (٧٢٠ دقيقةً افتراضاً)، فنبضةٌ كلَّ خمسِ دقائقَ تكشفُ في حدودِ ١٪ من المهلةِ —
   * وأسرعُ من ذلكَ نداءُ قاعدةٍ بلا فائدةٍ لأنَّ الحكمَ (`started_at` لا يتغيّرُ)
   * لا يتغيّرُ في دقائقَ، ولا يُبطَّأ لأنَّ رحلةً متجاوزةً السقفَ يُستحسنُ أن تقفَ
   * أمامَ عينِ المُشغِّلِ في غضونِ دقائقَ لا ساعةٍ. وليست حرجةً في `CRITICAL_CITY_JOBS`:
   * الكشفُ والتصعيدُ وحدَهما (`ADR 0216`) — لا تغييرَ حالةَ ولا حذفَ بياناتٍ،
   * فتأخّرُها تأخُّرُ رؤيةٍ لا تأخُّرَ حكمٍ.
   */
  detectCeilingExceeded: 300,
  /**
   * كلَّ يومٍ: تقديمُ نافذةِ أقسامِ `driver_location_history` (`F7-03`). لا يُسرَّعُ
   * لأنَّ القِسمَ يوميٌّ فنداءٌ ثانٍ في اليومِ نفسِه لا يُنشئُ شيئاً، ولا يُبطَّأُ
   * لأنَّ نافذةَ الأربعةَ عشرَ يوماً تُستهلَكُ يوماً بيومٍ. و`runOnStart` يجعلُ
   * أوّلَ إقلاعٍ بعدَ عطلٍ طويلٍ يُصلحُ النافذةَ فوراً لا بعدَ يومٍ.
   */
  ensureLocationPartitions: 86_400,
  /**
   * `F7-08` — كلَّ ستِّينَ ثانيةً: لوحةُ الإدارةِ تُقرَأُ ليُقرَّرَ فيها شيءٌ
   * (توثيقُ سائقٍ، تذكرةُ نزاعٍ)، فدقيقةٌ تأخُّرٍ في عدَدٍ مقروءٍ **معَ عُمرِه
   * المنشورِ** لا تُغيرُ قراراً. وأسرعُ من ذلكَ يُناقِضُ البندَ نفسَه: الشوطُ
   * يمسحُ ستّةَ جداولَ مرّةً، فتواتُرٌ أقصرُ من زمنِ الشوطِ يُحيلُ التخفيفَ
   * تثقيلاً دائماً. وأبطأُ يجعلُ الوسمَ المتقادِمَ الحالَ المعتادَ فيُقرَأُ ضجيجاً.
   *
   * **وموضِعُ التواتُرِ ههنا وحدَه وليسَ في `platform_settings`**: المُشغِّلُ
   * يقرأُ `everySeconds` مرّةً عندَ البناءِ، فإعدادٌ في القاعدةِ يُغَيَّرُ ولا يُتبَعُ
   * وعدٌ مكتوبٌ لا يُوفى.
   */
  refreshAdminMetrics: 60,
} as const;

/** المهلة الافتراضية للتوفّر البائت حين يغيب الإعداد — ثلاث ساعات. */
const AVAILABILITY_FALLBACK_MINUTES = 180;
/** أيام التحذير الافتراضية حين يغيب الإعداد. */
const WARNING_FALLBACK_DAYS = 2;

/**
 * حدود المراجعة الافتراضية حين تغيب من `platform_settings`.
 *
 * • عشر دقائق قبل السؤال: أقصر من ذلك يسأل عن دفعةٍ السائقُ في صفحتها الآن،
 *   فيقرأ `pending` ويعدّها معلّقة — استدعاءٌ بلا معلومة.
 * • يومان سقفاً للعمر: بعدهما تكون فاتورة المزوّد انتهت ولن تتغيّر حالتها أبداً،
 *   فالسؤال عنها استدعاءٌ متكرّرٌ إلى الأبد لصفٍّ ميّت.
 * • خمسون سقفاً للدفعة: يحمي حدّ استدعاءات المزوّد، والأقدمُ أوّلاً فلا يُهمَل صفّ.
 */
const RECONCILE_FALLBACK_OLDER_THAN_SECONDS = 600;
const RECONCILE_FALLBACK_MAX_AGE_SECONDS = 172_800;
const RECONCILE_FALLBACK_LIMIT = 50;

/**
 * يقرأ إعداد النسخ الاحتياطي من متغيّرات البيئة. يعيد `null` إذا غاب كلّ مخزنٍ
 * متاح — فالنسخ الاحتياطي ميزة اختيارية لا توقف الإقلاع بغيابها.
 * لا قيمة تجارية في الكود: عدد النسخ المحفوظة من متغيّر بيئة، والافتراضي 14.
 *
 * ويقوم الإعداد بوجود Google Drive **أو** مجلّد محليّ. لماذا المحليّ خيار؟ لأنّ ربط
 * النسخ بمزوّد سحابيّ واحد يجعل تعطّل اعتماداته تعطّلاً تامّاً للنسخ، ومجلّدٌ محليّ
 * على قرصٍ دائم أقلّ حمايةً لكنّه ليس عدماً.
 */
function readBackupConfig(databaseUrl: string): BackupConfig | null {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  const localDir = process.env.BACKUP_LOCAL_DIR;
  if ((!serviceAccountJson || !folderId) && !localDir) return null;
  const rawRetention = Number(process.env.BACKUP_RETENTION_COUNT ?? "14");
  const retentionCount =
    Number.isFinite(rawRetention) && rawRetention > 0 ? Math.trunc(rawRetention) : 14;
  return { databaseUrl, retentionCount };
}
/**
 * العتبة الاحتياطية حين يغيب الإعداد: 180 ثانية. الغياب لا يجوز أن يعني
 * "لا تُصعّد أبداً" — فذلك يُعيد بالضبط العطب الذي جاءت هذه المهمة لإصلاحه.
 */
const UNMATCHED_FALLBACK_SECONDS = 180;

/**
 * حدّ الدورات الاحتياطي حين يغيب `max_broadcast_rounds`: واحدة، وميلانُه مقصود.
 * الخطأ هنا له اتجاهان غير متكافئين: حدٌّ أقلّ ممّا ينبغي يُصعَّد طلباً كان له دورةٌ
 * أخرى، فيراه موظّفٌ ويتصرّف — وحدٌّ أعلى ممّا ينبغي يُعيد اليتم الذي جاء هذا المسح
 * ليغلقه، وبلا أثر. وإعدادات المدن المفعّلة تحمل المفتاح فعلاً، فهذا مسار الخراب لا المعتاد.
 */
const BROADCAST_ROUNDS_FALLBACK = 1;

/**
 * أقصى تواز للمهامّ، ومعه حجم تجمّع اتصالات القفل. الرقمان مرتبطان بالضرورة لا
 * بالاختيار: كل مهمّة جارية تحتجز اتصال قفل واحداً طول عملها، فتجمّع القفل يجب أن
 * يتّسع للتوازي كلّه وإلّا انتظرت مهمّة اتصالاً لن يتحرّر إلّا بانتهاء مهمّة أخرى.
 *
 * `F7-04` — **والقيمةُ نُقِلَت إلى نموذجِ ميزانيّةِ الاتّصالاتِ ولم تُبدَّل**:
 * `JOB_CONCURRENCY` في `packages/shared/config/connection-budget.ts`. والسببُ أنّ
 * هذا الرقمَ حدٌّ في الميزانيّةِ قبلَ أن يكونَ حدَّ تَوازٍ — تجمُّعُ القفلِ مشتقٌّ
 * منه — فبقاؤه ههنا كان يجعلُ الميزانيّةَ تُحسَبُ من رقمٍ لا تملكُه. والاسمُ
 * يبقى مُصدَّراً من موضعِه هذا فلا يتغيّرُ مُستدعٍ واحدٌ.
 */
export const MAX_JOB_CONCURRENCY = JOB_CONCURRENCY;

/**
 * أقصى ما يُفحَص من طلبٍ عالقٍ في شوطٍ واحد لمدينة. خمسون لا «كلّها»: شوطٌ يفتح
 * دورةَ مطابقةٍ لكل طلبٍ عالقٍ في مدينةٍ تعطّل توزيعُها ساعةً كاملة يفتح مئاتها في
 * نَفَسٍ واحد، فيستنزف تجمّعَ الاتصالات ويُسقط بقيّةَ المهامّ — فيصير إصلاحُ التوزيع
 * سببَ تعطيله. والأقدمُ أوّلاً، فالمتخلّف لا يُتخطّى بل يُؤجَّل شوطاً.
 */
export const REDISPATCH_LIMIT = 50;

export interface WorkerContainerOverrides {
  readonly sql?: Sql;
  /**
   * عميلُ Redis لدلوِ الحدِّ الصادرِ المشتركِ (`CAP-002`). يُمرَّر `null` صريحاً في
   * الاختبارِ ليُستعمَلَ دلوُ الذاكرةِ بلا شبكةٍ؛ و`undefined` يعني «ابنِه من الضبطِ».
   */
  readonly outboundRedis?: ReturnType<typeof createUpstashRedis> | null;
  readonly warningSender?: ExpiryWarningSender;
  readonly log?: JobLogger;
  /** يُستبدل في اختبار الوحدة بقفل لا يقفل؛ الافتراضي هو القفل الحقيقي على القاعدة. */
  readonly lock?: DistributedLock;
  /**
   * `OPS-EGRESS-01` — مدّةُ تذكُّرِ إعداداتِ المدينةِ في مهامِّ العامل (مللي ثانية). كلُّ قراءةٍ
   * تسحبُ قرابةَ 100 صفٍّ (~14 KB)، وكانت تتكرّرُ آلافَ المرّاتِ يوميًّا فتستهلكُ من حصّةِ
   * Supabase للبياناتِ الصادرة. غيابُها = قراءةٌ في كلِّ مرّةٍ كما كان (الاختبارات). والإنتاجُ
   * يمرّرُ `WORKER_SETTINGS_REMEMBER_MS`: تعديلُ المالكِ لإعدادٍ يصلُ المهامَّ خلالَها.
   */
  readonly settingsRememberMs?: number;
  /** تجمّع اتصالات القفل وحده — يُمرَّر في الاختبار لتقاسم قاعدة الاختبار نفسها. */
  readonly lockSql?: Sql;
  /** كاتبُ النبضة — يُحقَن في الاختبار ليُراقب ما يُكتب بلا قاعدة. */
  readonly heartbeat?: JobHeartbeatRecorderPort;
  /** مُرسِلا تيليجرام الحقيقيان — يُستبدلان في الاختبار بمُرسِل يجمع بلا شبكة. */
  readonly driverOut?: OutboundSender;
  readonly riderOut?: OutboundSender;
  readonly identifyingDriver?: IdentifyingSender;
  /** مُرسِلُ إخطاراتِ الدورةِ — يُستبدَلُ في الاختبارِ بمُرسِلٍ يجمعُ ويُرجعُ معرّفًا. (BUG-004) */
  readonly negotiationMessenger?: NegotiationMessenger;
  /** مُرسِلُ إخطارَي صاحبِ الطلبِ العالقِ — يُستبدَلُ في الاختبارِ بمُرسِلٍ يجمعُ. (BUG-004) */
  readonly unmatchedMessenger?: UnmatchedRiderMessenger;
  /** مُرسِلُ إخطارِ الإلغاءِ للسائقينِ — يُستبدَلُ في الاختبارِ بمُرسِلٍ يجمعُ. (BUG-004) */
  readonly cancellationMessenger?: CancellationMessenger;
  /** مُرسِلُ بلاغِ المفقودِ للسائقِ — يُستبدَلُ في الاختبارِ بمُرسِلٍ يجمعُ. (F12-07) */
  readonly lostItemMessenger?: LostItemMessenger;
  /** بطاقة SOS قابلة للاستبدال في اختبار فشل تيليجرام ثم إعادة التسليم. */
  readonly safetyPublisher?: SafetyCardPublisher;
  readonly safetyResolutionMessenger?: SafetyResolutionMessenger;
  /** ناشرُ إشعارِ العرضِ — يُستبدَلُ في الاختبار بناشرٍ يجمع ويُرجعُ معرّفًا. (BUG-004) */
  readonly offerPublisher?: OfferPublisher;
  /** ناشر البثّ الجماعي — يُستبدل في الاختبار بناشرٍ يجمع ويُخفق عند الطلب. */
  readonly broadcastPublisher?: BroadcastPublisher;
  /** ناشر إشعارات الاشتراك — يُستبدل في الاختبار بناشرٍ يجمع ويُخفق عند الطلب. */
  readonly subscriptionNoticePublisher?: SubscriptionNoticePublisher;
  /**
   * سجلّ المقاييس. يُلَفّ به منفذُ إسقاط العروض بمهلتها، فيُعَدّ ما لا يظهر في أيّ
   * سجلٍّ آخر: عرضٌ عُرِض ولم يُقبل. ومصدرُ العدّ نتيجةُ RPC — أي عددُ الصفوف التي
   * انتقلت فعلاً — لا نيّةُ المهمّة، فلا يُعَدّ إسقاطٌ لم يحدث.
   */
  readonly metrics?: OperationalMetrics;
}

/** مرسِل التحذيرات عبر واجهة تيليجرام الحقيقية، ملفوفاً في Result بلا استثناءات. */
export function grammyWarningSender(token: string): ExpiryWarningSender {
  const api = createTelegramApi(token);
  return {
    send: async ({ chatId, text }) => {
      try {
        await api.sendMessage(chatId, text);
        return ok(undefined);
      } catch (error) {
        // سائق حجب البوت يرمي هنا. هذا ليس عطل نظام بل حقيقة عن سائق واحد،
        // فيُعاد فشلاً محصوراً به ولا يُوقف بقية الدفعة.
        const detail = error instanceof Error ? error.message : String(error);
        return err(new PortFailureError("telegram.sendMessage", detail));
      }
    },
  };
}

/**
 * المهامّ التي غيابُ نبضتها عطلٌ لا ملاحظة (§4.3) — مدنيّة، تُسجّل بلا شرط لكلّ مدينة مفعّلة.
 *
 * لماذا هذه الأربع تحديداً: توقّفُ أيّها يُوقف دورةَ الرزق أو دورةَ الطلب ولا يظهر في
 * أيّ مكانٍ آخر: العروضُ تبقى معلّقةً على السائق، والطلبُ لا يُعاد توزيعُه فينتظر
 * الراكب إلى ما لا نهاية، والسائقُ يدفع ولا يعرف أنّ اشتراكه سرى، والاشتراكاتُ المنتهية
 * تبقى سارية فيُعمل مجّاناً. وبقيّةُ المهامّ تأخيرُها مُزعج لا قاتل، وحشرُها هنا كان سيجعل
 * `/ready` يسقط لأسبابٍ لا تستحقّ إيقافَ توجيه الحركة — فيُهمَل الفحصُ كلّه.
 */
/**
 * `PRD-001` — أقصى مدّةٍ بينَ سحبَينِ لمدينةٍ خاملةٍ. نبضاتُ هذه العمليّةِ تُوقِظُ
 * السحبَ في الدورةِ التالية فوراً؛ والسقفُ لنبضاتِ نسخةٍ أخرى ولإعادةِ ما سُحِبَ.
 * المقيسُ الخاملُ قبلَه: 5 مدنٍ × دورةٌ/~20ث ≈ 21.6K أمرٍ/يوم؛ وبعدَه ≈ 3.6K/يوم.
 */
export const DRIVER_LOCATION_IDLE_DRAIN_CEILING_MS = 120_000;

const CRITICAL_CITY_JOBS: readonly { readonly prefix: string; readonly everySeconds: number }[] = [
  { prefix: "expire-offers", everySeconds: JOB_INTERVALS.expireOffers },
  { prefix: "redispatch-searching", everySeconds: JOB_INTERVALS.redispatchSearching },
  { prefix: "release-scheduled", everySeconds: JOB_INTERVALS.releaseScheduled },
  {
    prefix: "deliver-subscription-notices",
    everySeconds: JOB_INTERVALS.deliverSubscriptionNotices,
  },
];

/** مهامّ عامّة تُسجّل بلا شرط — غيابُها يعني عاملاً لم يعمل أصلاً. */
const CRITICAL_GLOBAL_JOBS: readonly CriticalJobExpectation[] = [
  { jobName: "expire-subscriptions", everySeconds: JOB_INTERVALS.expireSubscriptions },
];

/**
 * مهامّ مشروطة باعتمادٍ خارجي: يُراقَب بياتُها ولا يُحاسَب غيابُها.
 *
 * النسخُ الاحتياطي حرجٌ للعمل (البند 7.2) لكنّه لا يُسجّل أصلاً بلا اعتمادات التخزين،
 * وإدراجُه في الواجب كان سيجعل `/ready` يردّ `not_ready` في أيّ بيئةٍ بلا Google Drive.
 * فإن وُجدت الاعتمادات ونبض مرّة، صار انقطاعُه بعدها تدهوّراً مرئيّاً — وهذا هو المطلوب
 * فعلاً: «كان يعمل وتوقّف» لا «لم يُفعّل قطّ».
 */
const OPTIONAL_GLOBAL_JOBS: readonly CriticalJobExpectation[] = [
  { jobName: "backup-database", everySeconds: JOB_INTERVALS.backupDatabase },
  { jobName: "verify-backup-restore", everySeconds: JOB_INTERVALS.verifyBackupRestore },
];

/**
 * توقّعاتُ النبض لمدنٍ مفعّلة معلومة — موضعها هنا لا في البوابة لأنّ `JOB_INTERVALS`
 * هنا: تواترٌ يُعدّل في ملفٍّ وعتبةُ بياتٍ تُقرأ في ملفٍ آخر ينزلقان عن بعضهما حتماً.
 */
export function jobHealthExpectations(cityIds: readonly CityId[]): {
  readonly required: readonly CriticalJobExpectation[];
  readonly optional: readonly CriticalJobExpectation[];
} {
  const perCity = cityIds.flatMap((cityId) =>
    CRITICAL_CITY_JOBS.map((entry) => ({
      jobName: `${entry.prefix}:${cityId}`,
      everySeconds: entry.everySeconds,
    })),
  );
  // بلا مدينةٍ مفعّلة لا مهمّةً مدنيّة تُسجّل، والمهامّ العامّة وحدها تُنتظر.
  return { required: [...perCity, ...CRITICAL_GLOBAL_JOBS], optional: OPTIONAL_GLOBAL_JOBS };
}

export interface WorkerContainer {
  readonly sql: Sql;
  /** كاتبُ نبضة المهامّ (§4.3) — مكشوفٌ ليمرّره من يبني المشغّل. */
  readonly heartbeat: JobHeartbeatRecorderPort;
  /** القفل الموزَّع الذي يُسلَّم للمشغّل — مكشوف حتى يُثبته الاختبار لا يفترضه. */
  readonly lock: DistributedLock;
  /** قائمة الجوبات كما ستُسلَّم للمشغّل — تُبنى مرّة عند الإقلاع. */
  jobs(): Promise<readonly JobDefinition[]>;
  close(): Promise<void>;
}

export function buildWorkerContainer(
  config: AppConfig,
  overrides: WorkerContainerOverrides = {},
): WorkerContainer {
  const sql =
    overrides.sql ??
    createSql({
      connectionString: config.databaseUrl,
      max: DB_POOL_MAX.workerJobs,
      applicationName: "ceezr:workerJobs",
      prepare: false,
    });
  // سجلٌّ من المُصدِرِ الوحيدِ لا دالّةٌ رابعةٌ بشكلٍ رابعٍ (`F8-03` · ADR 0078).
  const log: JobLogger = overrides.log ?? createStructuredLogger({ service: "worker" });

  /**
   * تجمّع اتصالات مستقلّ للأقفال، وهذا ليس ترفاً.
   *
   * القفل الاستشاري ملكُ الجلسة، فالمهمّة تحتجز اتصالها طول عملها بينما هو خاملٌ
   * لا يُنفّذ استعلاماً. لو خرج هذا الاتصال من تجمّع الاستعلامات لتنافس الخاملُ
   * المحتجزُ مع العاملِ المحتاج على نفس الميزانية — وهو ما حدث فعلاً أوّل تشغيل:
   * ستّ مهامّ متوازية احتجزت أقفالها من تجمّع سعته خمسة، فلم يبقَ اتصال لاستعلاماتها
   * وسقط الملفّ كلّه بمهلة انتظار لا بخطأ مفهوم. الميزانيتان منفصلتان بحكم طبيعتَي
   * الاستهلاك: واحدة للانتظار وأخرى للعمل.
   */
  const lockSql =
    overrides.lockSql ??
    createSql({
      connectionString: config.databaseUrl,
      max: DB_POOL_MAX.workerLocks,
      applicationName: "ceezr:workerLocks",
      prepare: false,
      // القفلُ الاستشاريُّ ملكُ الجلسةِ: إغلاقُ اتّصالٍ خاملٍ يُسقِطُ قفلاً محتجَزاً (`OPS-POOL-01`).
      idleTimeoutSeconds: null,
    });

  // الافتراضي هو القفل الحقيقي لا المُعطَّل: نسيان تمريره في الإنتاج يجب أن يكون
  // مستحيلاً، لا أن يكون خطأً صامتاً يظهر بعد مضاعفة عدد النسخ على Render.
  const lock = overrides.lock ?? createAdvisoryLock(lockSql);

  const cities = createCityDirectory(sql);
  const settings =
    overrides.settingsRememberMs === undefined
      ? createSettingsRepository(sql)
      : rememberSettingsByCity(createSettingsRepository(sql), overrides.settingsRememberMs);
  const offers = createPendingOfferRepository(sql);
  const expireRpc =
    overrides.metrics === undefined
      ? createExpireOffersRpc(sql)
      : instrumentExpireOffersRpc(createExpireOffersRpc(sql), overrides.metrics);
  const lifecycleRpc = createSubscriptionLifecycleRpc(sql);
  const availabilityRpc = createStaleAvailabilityRpc(sql);
  const recomputePort = createRatingRecomputePort(sql);
  const adminMetricSnapshotPort = createMetricSnapshotRefreshPort(sql);
  const trackingTokens = createTrackingTokenRpc(sql);
  const stalledOrders = createStalledOrderAdapter(sql);
  const ceilingExceeded = createCeilingExceededAdapter(sql);

  /**
   * مزوّد الدفع في العامل يُبنى من نفس متغيّرات البيئة التي تبنيه في البوابة، لا
   * من إعدادٍ ثانٍ: مزوّدان مختلفان في عمليّتين على قاعدةٍ واحدة يعني أن يُراجَع
   * صفٌّ أنشأه مزوّدٌ بسؤال مزوّدٍ آخر.
   *
   * وغيابه ليس خطأً يُسقِط العامل: بقيّة المهامّ (العروض، التوزيع، الاشتراكات،
   * النسخ) لا تتوقّف على الدفع. وكذلك `manual`: مزوّدٌ لا خادم له لا يُسأل، فلا
   * تُسجَّل المهمّة أصلاً بدل أن تفشل كل خمس دقائق إلى الأبد.
   */
  const paymentProviderName = process.env.PAYMENT_PROVIDER;
  const reconcileProvider = (() => {
    if (paymentProviderName === undefined || paymentProviderName === "manual") return null;
    const built = createPaymentProvider(paymentProviderName, {
      moyasar: {
        secretKey: process.env.MOYASAR_SECRET_KEY ?? "",
        webhookSecret: process.env.MOYASAR_WEBHOOK_SECRET ?? "",
        callbackUrl: process.env.MOYASAR_CALLBACK_URL ?? "",
      },
      tap: {
        secretKey: process.env.TAP_SECRET_KEY ?? "",
        redirectUrl: process.env.TAP_REDIRECT_URL ?? "",
      },
    });
    if (!built.ok) {
      log.error("worker.payment_provider_invalid", {
        provider: paymentProviderName,
        detail: built.error.detail,
      });
      return null;
    }
    return built.value;
  })();
  const payments = createPaymentRepository(sql, async (driverId) => {
    const rows = await sql<{ city_id: string }[]>`
      select city_id from drivers where id = ${driverId}::uuid
    `;
    return rows[0]?.city_id ?? null;
  });
  /**
   * صمودُ الصادرِ (`CAP-002`/`F6-04`). ودلوُ الحدِّ **مشتركٌ مع البوّابةِ** عبرَ
   * Redis: حدُّ Bot API حدٌّ على البوتِ لا على العمليةِ، والبوّابةُ والعاملُ
   * يُرسِلانِ بالرمزِ نفسِه — فدلوانِ منفصلانِ في ذاكرتَيهما يعنيانِ ضِعفَ الحدِّ
   * المُعلَنِ، وهو بعينِه ما يستدعي `429` ثمَّ خنقاً للبوتِ كلِّه. ولذلك نُقِلَ
   * عميلُ Upstash إلى `packages/infrastructure/redis` في هذه المرحلةِ: استيرادُ
   * `apps/workers` من `apps/gateway` خرقٌ لحدودِ التطبيقاتِ.
   *
   * ويُبنى العميلُ من الضبطِ متى كانت الجلساتُ على Redis — وهي العلامةُ نفسُها
   * التي تعتمدُها البوّابةُ، فلا يفترقُ المسارانِ. وعندَ غيابِه دلوُ ذاكرةٍ:
   * صحيحٌ للنسخةِ الواحدةِ، مُعلَنُ القصورِ لما فوقَها.
   */
  const outboundRedis =
    overrides.outboundRedis !== undefined
      ? overrides.outboundRedis
      : config.sessionStore === "redis"
        ? createUpstashRedis({ url: config.redisUrl, token: config.redisToken })
        : null;
  const outboundResilience = createOutboundResilience({
    redis: outboundRedis,
    log: (message, meta) => log.info(message, meta),
  });

  /**
   * `F4-02` — طرفا الإفراغِ المجمَّعِ: المخزنُ الساخنُ (يُسحَبُ منه) والدالّةُ
   * الذرّيّةُ (يُكتَبُ بها). ويُشارِكانِ عميلَ Redis نفسَه الذي يشاركُه دلوُ الحدِّ:
   * عميلٌ ثانٍ لا يزيدُ شيئاً — الحدُّ حدُّ الخدمةِ لا حدُّ الكائنِ.
   *
   * وبلا Redis لا مهمّةَ إفراغٍ أصلاً: البوّابةُ في هذه الحالِ تكتبُ كلَّ نبضةٍ
   * مباشرةً (`F4-01`)، فقائمةُ الانتظارِ لا تُملأُ ومهمّةٌ تسحبُ من فراغٍ ضجيجُ
   * سجلٍّ لا عملٌ.
   */
  const driverLocationHotState =
    outboundRedis === null
      ? null
      : createRedisDriverLocationHotState({
          redis: outboundRedis,
          settings,
          clock: systemClock,
          onFailure: (detail) => log.error("driver_location.hot_state_failed", detail),
          // PRD-001: لا `EVAL` على قائمةٍ يُعلَمُ فراغُها؛ سقفُ أمانٍ دقيقتانِ.
          idleDrainCeilingMs: DRIVER_LOCATION_IDLE_DRAIN_CEILING_MS,
        });
  const driverLocationPersistence = createDriverLocationBatchPersistence(sql);
  const driverLocationPartitions = createDriverLocationPartitionMaintenance(sql);

  const warningSender = overrides.warningSender ?? grammyWarningSender(config.driverBotToken);

  /**
   * العامل ينشر في قروب غير المشتركين ويصعّد الطلبات، فيحتاج مُرسِلاً حقيقياً تماماً
   * كالبوابة. المُرسِل المبني على رمز بوت السائق هو الصحيح: أزرار القروب يضغطها
   * سائقون، وردّ الضغطة يجب أن يعود إلى البوت الذي نشرها لا إلى بوت العميل.
   */
  /**
   * `ADR 0213`: في وضعِ التطبيقِ كلُّ إشعارٍ خاصٍّ بابٌ إليه — الزرُّ يُلحَقُ عند المُرسِلِ مرّةً
   * لا في كلِّ مُخطِرٍ، والقروباتُ لا تُمَسُّ (`withMiniAppEntry`).
   */
  const entryFor = (sender: TelegramSender): TelegramSender =>
    config.botSurfaceMode === "miniapp" && config.miniAppUrl !== null
      ? withMiniAppEntry(sender, { miniAppUrl: config.miniAppUrl, label: MINIAPP_ENTRY_LABEL })
      : sender;
  const telegram = entryFor(
    withOutboundResilience(grammyTelegramSender(config.driverBotToken), {
      ...outboundResilience.options,
      bucketKey: outboundBucketKeyOfToken(config.driverBotToken), // CAP-RUN-20261015 / D6
    }),
  );
  const driverOut = overrides.driverOut ?? asOutboundSender(telegram);

  /**
   * الراكب يُراسَل ببوت الراكب لا ببوت السائق. كان الافتراضي هنا driverOut،
   * وهو خطأ صامت لا يظهر في أي اختبار لأن الاختبارات تمرّر riderOut دائماً:
   * الراكب لم يبدأ محادثة مع بوت السائق قط، وتيليجرام يرفض أن يبتدئ بوتٌ
   * محادثةً مع مستخدم لم يفتحها. فكل رسالة تفاوض موجَّهة للراكب كانت تسقط
   * في الإنتاج بـ403 بلا أثر مرئي — لا خطأ يوقظ أحداً، ولا رسالة تصل.
   */
  const riderTelegram = entryFor(
    withOutboundResilience(grammyTelegramSender(config.riderBotToken), {
      ...outboundResilience.options,
      bucketKey: outboundBucketKeyOfToken(config.riderBotToken), // CAP-RUN-20261015 / D6
    }),
  );
  const riderOut = overrides.riderOut ?? asOutboundSender(riderTelegram);
  const safetyPublisher = overrides.safetyPublisher ?? createSafetyCardPublisher(telegram);

  /**
   * `PD-021` — مُرسِلُ مآلِ البلاغِ للمُبلِّغِ. يُرسَلُ ببوتِ الراكبِ: المُبلِّغُ هو
   * راكبٌ أو سائقٌ، وكلاهُما يَفتحُ محادثةً معَ بوتِ الراكبِ، فلا مناصَ من بوتِهِ.
   */
  const safetyResolutionMessenger =
    overrides.safetyResolutionMessenger ??
    createTelegramSafetyResolutionMessenger(
      asIdentifyingSender(withTrafficPriority(riderTelegram, "safety_resolution_closed")),
    );
  const safetyDeliveries = createSafetyDeliveryPort(sql);
  const offerPublisher =
    overrides.offerPublisher ??
    createOfferPublisher(
      sql,
      overrides.identifyingDriver ?? asIdentifyingSender(withTrafficPriority(telegram, "offer")),
      config.botSurfaceMode === "miniapp" ? { miniAppUrl: config.miniAppUrl } : {},
    );
  /**
   * صندوقُ الصادرِ الموحَّدُ (BUG-004): منفذٌ واحدٌ للجدولِ، ومعالجٌ لكلِّ نوعٍ.
   * وتبليغُ صاحبِ التذكرةِ بمُرسِلِ بوتِه هو — بوتُ السائقِ لسائقٍ وبوتُ الراكبِ
   * لراكبٍ — لأنَّ رسالةً خاصّةً من بوتٍ لم يبدأ معه محادثةً لا تصلُ أصلاً.
   */
  const notificationOutbox = createNotificationOutboxPort(sql);
  /**
   * مُراسِلٌ **لكلِّ نوعٍ** لا مُراسِلٌ واحدٌ لثلاثةِ أنواعٍ (`F6-07`): الوسمُ يجري
   * عندَ بناءِ المُرسِلِ، فمُراسِلٌ واحدٌ مشتركٌ كانَ سيَسِمُ الأنواعَ الثلاثةَ بوسمِ
   * أحدِها. وأنواعُ التفاوضِ الثلاثةُ حرجةٌ اليومَ فالنتيجةُ واحدةٌ، ولكنَّ اعتمادَ
   * التساوي كانَ سيصيرُ خطأً صامتاً أوّلَ ما تُغيَّرُ رتبةُ أحدِها في السجلِّ.
   */
  const negotiationMessengerFor = (kind: NotificationKind) =>
    overrides.negotiationMessenger ??
    createTelegramNegotiationMessenger(
      asIdentifyingSender(withTrafficPriority(telegram, kind)),
      asIdentifyingSender(withTrafficPriority(riderTelegram, kind)),
      // `ADR 0286` — بطاقاتُ الراكبِ تُحيلُ إلى التطبيقِ لا أن تُنفِّذَ من المحادثةِ.
      { miniAppUrl: config.miniAppUrl },
    );
  /**
   * إخطارا صاحبِ الطلبِ العالقِ ببوتِ الراكبِ حصرًا (BUG-004): كانا يُرسَلانِ من
   * مسارِ المسحِ بعدَ عودةِ الدالّةِ الذرّيةِ، فصارا صفَّينِ يُودَعانِ في معاملتِها.
   */
  /**
   * وههنا الفارقُ **ليسَ نظريّاً**: `wider_circle_opened` مرتفعٌ و`no_driver_found`
   * متوسّطٌ قابلٌ للتأجيلِ، فمُراسِلٌ واحدٌ مشتركٌ كانَ سيُعطي أحدَهما رتبةَ الآخرِ.
   */
  const unmatchedMessengerFor = (kind: NotificationKind) =>
    overrides.unmatchedMessenger ??
    createTelegramUnmatchedMessenger(
      asIdentifyingSender(withTrafficPriority(riderTelegram, kind)),
      {
        surface:
          config.botSurfaceMode === "miniapp" && config.miniAppUrl !== null ? "miniapp" : "chat",
      },
    );
  /**
   * إخطارُ الإلغاءِ ببوتِ السائقِ حصرًا (BUG-004): كان يُرسَلُ من مسارِ ضغطةِ العميلِ
   * بعدَ عودةِ الدالّةِ الذرّيةِ، فصارَ صفًّا لكلِّ سائقٍ يُودَعُ في معاملتِها.
   */
  const cancellationMessenger =
    overrides.cancellationMessenger ??
    createTelegramCancellationMessenger(
      asIdentifyingSender(withTrafficPriority(telegram, "order_cancelled")),
    );
  /**
   * بلاغُ المفقودِ للسائقِ (`F12-07`): يُرسَلُ ببوتِ السائقِ، وهو تحديثُ دعمٍ ذو
   * قيمةٍ زمنيّةٍ (متوسّطٌ) لا إلغاءُ رحلةٍ (حرجٌ) — فلذلك مُرسِلٌ مستقلٌّ برتبتِه.
   */
  const lostItemMessenger =
    overrides.lostItemMessenger ??
    createTelegramLostItemMessenger(
      asIdentifyingSender(withTrafficPriority(telegram, "lost_item_report")),
    );
  /**
   * `WR-15` (ADR 0265) — إشعارُ طورِ الرحلةِ للراكبِ ببوتِ الراكبِ. والزرُّ يبنيه
   * المعالجُ نفسُه (`riderTripKeyboard`)، فلا يُضافُ زرُّ دخولٍ ثانٍ إلّا إن غابَ.
   * والفشلُ النهائيُّ وحدَه يُسجَّلُ خطأً؛ وما قبلَه إعادةٌ متوقَّعة.
   */
  const riderTripNoticeHandler = createRiderTripNoticeHandler({
    facts: createRiderTripFactsReader(sql),
    // ADR 0287 — أطوارُ الرحلةِ Mini App أولًا بإقرارِ العميلِ، وتيليجرامُ
    // احتياطًا لغيرِ المتصلِ أو لمن لم يُقرَّ ضمنَ المهلةِ.
    app: createRiderTripAppDelivery({
      sql,
      gatewayInternalUrl: config.gatewayInternalUrl,
      secret: config.internalSignalSecret,
      log: (message, meta) => log.info(message, meta),
    }),
    // `WR-09` — حدثُ `CANDIDATE`: يُطوى إن فاتَ المرشَّحُ قبلَ الإرسال.
    candidates: createRiderCandidateFactsReader(sql),
    sender: asIdentifyingSender(withTrafficPriority(riderTelegram, "rider_trip_notice")),
    miniAppUrl: config.botSurfaceMode === "miniapp" ? config.miniAppUrl : null,
    log: (event, meta) =>
      event === "rider_trip_notice.final_failure" ? log.error(event, meta) : log.info(event, meta),
  });
  /**
   * `WR-09` (ADR 0266) — مآلُ قبولِ السائقِ بعدَ قرارِ الراكبِ، ببوتِ السائق. وفي سطحِ
   * البوتِ القديمِ يحملُ «اختارَك» زرَّ «بدء الرحلة» كما كانَ تأكيدُ القبولِ يحمله.
   */
  const driverCandidateNoticeHandler = createDriverCandidateNoticeHandler({
    sender: asIdentifyingSender(withTrafficPriority(telegram, "driver_candidate_notice")),
    miniAppUrl: config.botSurfaceMode === "miniapp" ? config.miniAppUrl : null,
    startKeyboard: startRideKeyboard,
    // `WR-06` — تذكيرُ الحضورِ يُطوى إن أُلغيَ الطلبُ أو وصلَ السائقُ قبلَ الإرسال.
    pickupReminderState: createPickupReminderStateReader(sql),
    log: (event, meta) =>
      event === "driver_candidate_notice.final_failure"
        ? log.error(event, meta)
        : log.info(event, meta),
  });
  /**
   * `WR-04` (ADR 0267) — تنبيهُ رسالةِ المحادثةِ الجديدة: ببوتِ المستقبِل، بلا نصِّ الرسالة،
   * ويُطوى إن قرأَها المستقبِلُ داخلَ Mini App قبلَ موعدِه أو انتهت الرحلة.
   */
  const chatMessageNoticeHandler = createChatMessageNoticeHandler({
    riderSender: asIdentifyingSender(withTrafficPriority(riderTelegram, "order_chat_message")),
    driverSender: asIdentifyingSender(withTrafficPriority(telegram, "order_chat_message")),
    miniAppUrl: config.botSurfaceMode === "miniapp" ? config.miniAppUrl : null,
    log: (event, meta) =>
      event === "order_chat_notice.final_failure" ? log.error(event, meta) : log.info(event, meta),
  });
  /**
   * `WR-12` (ADR 0268) — تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه. ببوتِ السائق، ويُطوى إن
   * أوقفَ توافرَه أو وصلَ منه موقعٌ حديثٌ قبلَ الإرسال.
   */
  const locationReminderHandler = createLocationReminderHandler({
    sender: asIdentifyingSender(withTrafficPriority(telegram, "driver_location_reminder")),
    miniAppUrl: config.botSurfaceMode === "miniapp" ? config.miniAppUrl : null,
    log: (event, meta) =>
      event === "driver_location_reminder.final_failure"
        ? log.error(event, meta)
        : log.info(event, meta),
  });
  /**
   * `WR-13` (ADR 0269) — إخطارُ السائقِ بانتقالِ مدينتِه حسبَ موقعِه، أو بخروجِه من التغطية.
   */
  const driverCityNoticeHandler = createDriverCityNoticeHandler({
    sender: asIdentifyingSender(withTrafficPriority(telegram, "driver_city_notice")),
    log: (event, meta) =>
      event === "driver_city_notice.final_failure" ? log.error(event, meta) : log.info(event, meta),
  });
  const notificationHandlers = {
    offer: createOfferNotificationHandler(
      offerPublisher,
      (event, meta) =>
        event === "offer_notice.final_failure" ? log.error(event, meta) : log.info(event, meta),
      // `LOAD-01 Recovery` — لوحُ العروضِ والإشارةُ للسائقِ المتصلِ، والبطاقةُ
      // البديلةُ لغيرِ المتصلِ: فصلُ «ضجيجِ العروضِ» عنِ الإشعاراتِ الحرجةِ.
      createOfferBoardDelivery({
        sql,
        gatewayInternalUrl: config.gatewayInternalUrl,
        secret: config.internalSignalSecret,
        log: (message, meta) => log.info(message, meta),
      }),
    ),
    dispute_resolution: createDisputeResolutionHandler({
      driver: createTicketOwnerNotifier(
        asSupportSender(withTrafficPriority(telegram, "dispute_resolution")),
      ),
      rider: createTicketOwnerNotifier(
        asSupportSender(withTrafficPriority(riderTelegram, "dispute_resolution")),
      ),
    }),
    negotiation_turn_opened: createTurnOpenedHandler(
      negotiationMessengerFor("negotiation_turn_opened"),
    ),
    negotiation_turn_closed: createTurnClosedHandler(
      negotiationMessengerFor("negotiation_turn_closed"),
    ),
    negotiation_agreed: createAgreedHandler(negotiationMessengerFor("negotiation_agreed")),
    wider_circle_opened: createWiderCircleOpenedHandler(
      unmatchedMessengerFor("wider_circle_opened"),
    ),
    no_driver_found: createNoDriverFoundHandler(unmatchedMessengerFor("no_driver_found")),
    order_cancelled: createOrderCancelledHandler(cancellationMessenger),
    lost_item_report: createLostItemReportHandler(lostItemMessenger),
    safety_resolution_closed: createSafetyResolutionClosedHandler(safetyResolutionMessenger),
    safety_resolution_blocked: createSafetyResolutionClosedHandler(safetyResolutionMessenger),
    rider_trip_notice: riderTripNoticeHandler,
    driver_candidate_notice: driverCandidateNoticeHandler,
    order_chat_message: chatMessageNoticeHandler,
    driver_location_reminder: locationReminderHandler,
    driver_city_notice: driverCityNoticeHandler,
  };

  /**
   * البثُّ يُرسَل ببوت الجمهور المقصود، ولذلك ناشران لا واحد: رسالةُ الركّاب من
   * بوت الراكب ورسالةُ السائقين من بوت السائق. بوتٌ واحد للاثنين كان سيُردّ
   * بـ403 على كل مستقبِلٍ لم يفتح محادثةً معه — أي على الجمهور كلّه.
   */
  const driverBroadcastPublisher =
    overrides.broadcastPublisher ??
    createBroadcastPublisher(grammyBroadcastApi(config.driverBotToken));
  const riderBroadcastPublisher =
    overrides.broadcastPublisher ??
    createBroadcastPublisher(grammyBroadcastApi(config.riderBotToken));
  const broadcastDeliveries = createBroadcastDeliveryPort(sql);
  // بوت السائق لا بوت الراكب: كلُّ إشعارات دورة حياة الاشتراك تخصّ سائقاً.
  const subscriptionNoticePublisher =
    overrides.subscriptionNoticePublisher ??
    createSubscriptionNoticePublisher(grammyNoticeApi(config.driverBotToken));
  const subscriptionNotices = createSubscriptionNoticeDeliveryPort(sql);

  const searchingFinder = createSearchingOrderFinder(sql);

  /**
   * **نفسُ** تبعيّات البثّ التي تبنيها البوابة عند إنشاء الطلب، لا نسخةٌ مبسّطة:
   * أيّ فرقٍ بين ما يُبَثّ عند الإنشاء وما يُبَثّ عند الإعادة هو تفرّعُ سلوكٍ لا
   * يظهر إلّا كشكوى «العرض الثاني يذهب لسائقٍ أبعد» ولا يفسّره أحد.
   */
  const scheduledReleaser = createScheduledOrderReleaser(sql);
  const searchingExpirer = createSearchingOrderExpirer(sql);
  const redispatchBroadcast = {
    orders: createOrderRepository(sql),
    offers: createOfferRepository(sql),
    candidates: createDriverCandidateRepository(sql),
    settings,
    offerWriter:
      overrides.metrics === undefined
        ? createOfferWriter(sql)
        : instrumentOfferWriter(createOfferWriter(sql), overrides.metrics),
    clock: systemClock,
    log: (message: string, meta: Record<string, unknown>) => log.info(message, meta),
  };

  const unmatchedFinder = createUnmatchedOrderFinder(sql);
  const negotiation = createNegotiationWiring(sql, {
    driverOut,
    riderOut,
    identifyingDriver: overrides.identifyingDriver ?? asIdentifyingSender(telegram),
  });
  /**
   * `WR-10` — إغلاقُ بطاقاتِ القروبِ المنتهيةِ ببوتِ السائقِ الذي نشرَها، بلا لوحةٍ
   * (`markup` غائبٌ ⇒ تُزالُ الأزرار). ولغةُ القروبِ العربيّةُ كالبطاقةِ نفسِها.
   */
  const editGroupMessage = telegram.editMessageText;
  const groupCards =
    editGroupMessage === undefined
      ? undefined
      : {
          cards: createStaleGroupCardPort(sql),
          edit: (chatId: string, messageId: string, text: string) =>
            editGroupMessage(chatId, messageId, text, undefined),
          text: (outcome: "assigned" | "closed") =>
            translate(
              "ar",
              outcome === "assigned" ? "group.unsub_card_assigned" : "group.unsub_card_closed",
            ),
          log: (event: string, meta: Record<string, unknown>) => log.info(event, meta),
        };

  /**
   * `WR-22` (ADR 0278) — بطاقةُ الإسنادِ في قروبِ المدينةِ تُعدَّلُ نفسُها إلى مآلِ الطلبِ حينَ
   * يبلغُ حالًا لا رجعةَ عنها، ببوتِ السائقِ الذي نشرَها. ولغةُ القروبِ العربيّةُ كالبطاقة.
   */
  const editEscalationMessage = telegram.editMessageText;
  const escalationCards =
    editEscalationMessage === undefined
      ? undefined
      : {
          cards: createStaleEscalationCardPort(sql),
          edit: (chatId: string, messageId: string, text: string) =>
            editEscalationMessage(chatId, messageId, text, undefined),
          text: (outcome: "assigned" | "cancelled" | "search_expired" | "ended", orderId: string) =>
            translate("ar", `group.escalation_card_${outcome}`, { order: orderId }),
          log: (event: string, meta: Record<string, unknown>) => log.info(event, meta),
        };

  /**
   * `WR-08` (ADR 0271) — بطاقةُ العرضِ الخاصّةُ التي ماتَ عرضُها (انتهى أو سُبِقَ إليه أو أُلغي
   * طلبُه) يُكتَبُ مآلُها عليها ببوتِ السائقِ الذي أرسلَها، بلا لوحةٍ فيزولُ زرّا «قبول/رفض».
   * ونصُّ «انتهى» و«سُبِقَ» هو نصُّ النقرةِ نفسُه (`WR-08`، #507)، فلا يتبدّلُ ما كتبَته النقرة.
   */
  const editOfferMessage = telegram.editMessageText;
  const offerCards =
    editOfferMessage === undefined
      ? undefined
      : {
          cards: createDeadOfferCardPort(sql),
          edit: (chatId: string, messageId: string, text: string) =>
            editOfferMessage(chatId, messageId, text, undefined),
          text: (outcome: "expired" | "taken" | "cancelled", languageCode: string) =>
            translate(
              languageCode,
              outcome === "expired"
                ? "driver.offer_expired"
                : outcome === "taken"
                  ? "driver.offer_taken"
                  : "driver.offer_card_cancelled",
            ),
          log: (event: string, meta: Record<string, unknown>) => log.info(event, meta),
        };

  /**
   * المدن تُقرأ عند بناء القائمة لا في كل شوط: تفعيل مدينة جديدة حدثٌ نادر
   * يستحقّ إعادة نشر العامل، واستعلامُ المدن كل دقيقة إنفاقٌ بلا مقابل.
   */
  async function activeCityIds(): Promise<readonly CityId[]> {
    /*
     * `OPS-POOL-01`: قراءةُ المدنِ تُعادُ عندَ الفشلِ ولا تُسلَّمُ صفراً من أوّلِ محاولةٍ.
     * مرصودٌ في الإنتاجِ 2026-10-02: نسخةٌ جديدةٌ تُقلِعُ والقديمةُ ما زالت تحتجزُ
     * اتّصالاتِ المُجمِّعِ (`EMAXCONNSESSION`) فتفشلُ هذه القراءةُ الواحدةُ، فيعملُ العاملُ
     * **بلا أيِّ مهمّةٍ مدنيّةٍ** (لا بثَّ ولا إعادةَ إرسالٍ ولا انقضاءَ عروضٍ) حتّى النشرِ
     * التالي — عطلٌ صامتٌ تامٌّ يبدو «جاهزاً». فتُعادُ بمهلٍ متزايدةٍ (~دقيقتانِ إجمالاً).
     */
    for (let attempt = 1; ; attempt++) {
      const list = await cities.listActive();
      if (list.ok) return list.value.map((city) => city.id);
      log.error("worker.cities_failed", { detail: list.error.detail, attempt });
      if (attempt >= CITY_LIST_ATTEMPTS) return [];
      await new Promise((resolve) => setTimeout(resolve, CITY_LIST_RETRY_STEP_MS * attempt));
    }
  }

  async function warningDays(cityId: CityId): Promise<number> {
    const raw = await settings.findByCity(cityId);
    if (!raw.ok) return WARNING_FALLBACK_DAYS;
    const row = raw.value.find((entry) => entry.key === "subscription_expiry_warning_days");
    const parsed = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : WARNING_FALLBACK_DAYS;
  }

  /**
   * يقرأ حدّاً رقمياً من إعدادات المدينة، ويعود للاحتياطي عند غيابه أو تلفه.
   *
   * الاحتياطي ليس ترفاً: إعدادٌ ناقص لمدينةٍ لا يجوز أن يعني «لا تُراجَع دفعاتها
   * أبداً» — فذلك يُعيد الثقب الذي جاءت المراجعة لإغلاقه، وبصمتٍ تام.
   */
  async function numericSetting(cityId: CityId, key: string, fallback: number): Promise<number> {
    const raw = await settings.findByCity(cityId);
    if (!raw.ok) return fallback;
    const row = raw.value.find((entry) => entry.key === key);
    const parsed = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
  }

  async function unmatchedThreshold(cityId: CityId): Promise<number> {
    const raw = await settings.findByCity(cityId);
    if (!raw.ok) return UNMATCHED_FALLBACK_SECONDS;
    const row = raw.value.find((entry) => entry.key === "unmatched_escalate_after_seconds");
    const parsed = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : UNMATCHED_FALLBACK_SECONDS;
  }

  return {
    sql,
    lock,
    heartbeat: overrides.heartbeat ?? createJobHeartbeatRecorder(sql, log),

    jobs: async (): Promise<readonly JobDefinition[]> => {
      const cityIds = await activeCityIds();
      if (cityIds.length === 0) {
        // لا مدينة مفعَّلة يعني نظاماً لم يُفتَح بعد. المهامّ العامّة تبقى، والمدنية
        // تغيب — وهذا يُسجَّل صراحةً لأن عاملاً بلا مهامّ مدنية عرضٌ مشبوه.
        log.info("worker.no_active_cities", {});
      }

      /**
       * `cityId` يُلحَق بكلّ مهمّةٍ مدنيّة من داخل الحلقة التي تعرفه (§4.3)، لا بتفكيك
       * اسمِ المهمّة لاحقاً: الاسمُ نصٌّ للقراءة، واستخراجُ مفتاحٍ أجنبي من نصٍّ ينكسر يوم
       * يدخل النقطتين في اسمٍ لسببٍ آخر. والإلحاقُ مرّةً واحدة يجعل أيّ مهمّةٍ تُضاف
       * لاحقاً ترث النسبة بلا أن يتذكّرها كاتبُها.
       */
      const perCity: JobDefinition[] = cityIds.flatMap((cityId): JobDefinition[] =>
        (
          [
            {
              /**
               * انقضاءُ روابط التتبّع (§4.2). ليست في `CRITICAL_CITY_JOBS`: تعطُّلها
               * لا يفتح رابطاً ولا يُبقي موقعاً حيّاً (السقفُ المطلق وحالةُ الطلب
               * يحرسان ذلك)، فهي مهمّةٌ نافعةٌ لا حرجَ في تأخّرها — وإدراجُها
               * حرجةً كان سيُرجِع 503 من `/ready` على تأخّرٍ لا أثرَ له على أحد.
               */
              name: `expire-tracking-tokens:${cityId}`,
              everySeconds: JOB_INTERVALS.expireTrackingTokens,
              run: async () => {
                const report = await expireTrackingTokens(cityId, { tokens: trackingTokens });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                return `pulled=${report.value.pulled}`;
              },
            },
            {
              /**
               * `F12-04` — كشفُ الطلباتِ العالقةِ. **ليست في `CRITICAL_CITY_JOBS`**:
               * تعطُّلُها لا يفتحُ رابطاً ولا يُبقي موقعاً حيّاً، لأنَّ الحَكَمَ
               * (`tracking_link_lifetime` عن `order_stall_state`) يُجيبُ لحظةَ
               * القراءةِ لا عن صفٍّ تكتبُه هذه المهمّةُ. فهيَ **عينُ مُشغِّلٍ**
               * لا حدُّ أمنٍ، وإدراجُها حرجةً كانَ سيُرجِعُ 503 من `/ready` على
               * تأخُّرٍ لا يمسُّ أحداً.
               */
              name: `detect-stalled-orders:${cityId}`,
              everySeconds: JOB_INTERVALS.detectStalledOrders,
              run: async () => {
                const report = await detectStalledOrders(cityId, {
                  stalled: stalledOrders,
                  escalate: (fields) => {
                    log.info("worker.order_stalled", fields);
                  },
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                return `stalled=${report.value.stalled} worstIdle=${report.value.worstIdleSeconds ?? "-"}`;
              },
            },
            {
              /**
               * `F12-20` — كاشفُ تجاوزِ السقفِ (`tracking_link_max_lifetime_minutes`).
               * **ليست في `CRITICAL_CITY_JOBS`** لِعَينِ العلّةِ في جارتِها أعلاه:
               * الكشفُ والتصعيدُ وحدَهما (`ADR 0216`) — لا تغييرَ حالةَ طلبٍ ولا
               * حذفَ بياناتٍ، فتعطُّلُها يؤخّرُ رؤيةَ المُشغِّلِ لا حكمَ النظامِ.
               * والقراءةُ محضةٌ من القاعدةِ (`detect_ceiling_exceeded_orders`).
               */
              name: `detect-ceiling-exceeded:${cityId}`,
              everySeconds: JOB_INTERVALS.detectCeilingExceeded,
              run: async () => {
                const report = await detectCeilingExceededOrders(cityId, {
                  detector: ceilingExceeded,
                  escalate: (fields) => {
                    log.info("worker.order_ceiling_exceeded", fields);
                  },
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                return `exceeded=${report.value.exceeded} worstElapsed=${report.value.worstElapsedMinutes ?? "-"}`;
              },
            },
            {
              name: `expire-offers:${cityId}`,
              everySeconds: JOB_INTERVALS.expireOffers,
              runOnStart: true,
              run: async () => {
                const report = await expireOffers(cityId, {
                  offers,
                  settings,
                  rpc: expireRpc,
                  clock: systemClock,
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                // `WR-08` — بعدَ الإنهاءِ لا قبلَه: عرضٌ انتهى في هذا المرورِ تُغلَقُ بطاقتُه فيه.
                // وعطلُ البطاقاتِ لا يُسقطُ الشوط: يُذكَرُ في سطرِ المآل.
                let cards = "";
                if (offerCards !== undefined) {
                  const closedCards = await closeDeadOfferCards(cityId, offerCards);
                  cards = closedCards.ok
                    ? ` cardsClosed=${closedCards.value.closed} cardsFailed=${closedCards.value.failed}`
                    : ` cardsError=${closedCards.error.code}`;
                }
                return `examined=${report.value.examined} expired=${report.value.appliedCount}${cards}`;
              },
            },
            {
              /**
               * `WR-06` (ADR 0273) — ما حانَ إطلاقُه من المجدولِ يصيرُ «يبحث» ويُبَثُّ فورًا، وما
               * فاتَ موعدُه (النظامُ كانَ معطَّلًا) يُلغى ويُعلَمُ الراكب. `runOnStart` لازمٌ:
               * أوّلُ ما يفعلُه عاملٌ عادَ بعدَ تعطّلٍ هو إدراكُ ما فاتَه.
               */
              name: `release-scheduled:${cityId}`,
              everySeconds: JOB_INTERVALS.releaseScheduled,
              runOnStart: true,
              run: async () => {
                const report = await releaseScheduledOrders(cityId, {
                  releaser: scheduledReleaser,
                  broadcast: redispatchBroadcast,
                  limit: REDISPATCH_LIMIT,
                  log: (message, meta) => log.info(message, meta),
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                const value = report.value;
                return `released=${value.released.length} missed=${value.missed.length} rebroadcast=${value.broadcast?.rebroadcast.length ?? 0} deferred=${value.broadcastFailed}`;
              },
            },
            {
              /**
               * `WR-22` (ADR 0276) — ما تجاوزَ مدّةَ البحثِ بلا سائقٍ يُنهى `failed` ويُعلَمُ الراكبُ
               * مرّةً واحدة. `runOnStart`: عاملٌ عادَ بعدَ تعطّلٍ يُدرِكُ ما فاتَه أوّلًا.
               */
              name: `expire-searching:${cityId}`,
              everySeconds: JOB_INTERVALS.expireSearching,
              runOnStart: true,
              run: async () => {
                const report = await expireSearchingOrders(cityId, {
                  expirer: searchingExpirer,
                  limit: REDISPATCH_LIMIT,
                  log: (message, meta) => log.info(message, meta),
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                const value = report.value;
                return value.disabled
                  ? "disabled"
                  : `expired=${value.expired.length} held=${value.held}`;
              },
            },
            ...(escalationCards === undefined
              ? []
              : [
                  {
                    /**
                     * `WR-22` (ADR 0278) — بعدَ انتهاءِ البحثِ أو الإسنادِ أو الإلغاءِ تُعدَّلُ بطاقةُ
                     * الإسنادِ نفسُها. غيرُ حرجة: عطلُ Telegram لا يمسُّ الطلبَ ولا الراكب.
                     */
                    name: `close-escalation-cards:${cityId}`,
                    everySeconds: JOB_INTERVALS.closeEscalationCards,
                    runOnStart: true,
                    run: async () => {
                      const report = await closeEscalationCards(cityId, escalationCards);
                      if (!report.ok) throw new Error(JSON.stringify(report.error));
                      const value = report.value;
                      return `closed=${value.closed} failed=${value.failed} raced=${value.raced}`;
                    },
                  },
                ]),
            {
              /**
               * قبل التصعيد لا بعده: الطلبُ الذي يمكن بثُّه ثانيةً يجب أن يُبَثّ قبل أن
               * يُقال للراكب «لا سائق»، لا أن يُبَشَّر بالفشل ثم يُخدَم.
               */
              name: `redispatch-searching:${cityId}`,
              everySeconds: JOB_INTERVALS.redispatchSearching,
              runOnStart: true,
              run: async () => {
                const report = await runRedispatchSearching(cityId, {
                  finder: searchingFinder,
                  broadcast: redispatchBroadcast,
                  limit: REDISPATCH_LIMIT,
                  log: (message, meta) => log.info(message, meta),
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                const value = report.value;
                return `examined=${value.examined} rebroadcast=${value.rebroadcast.length} noDriver=${value.stillNoDriver.length} exhausted=${value.exhausted.length} raced=${value.raced.length} failed=${value.failed}`;
              },
            },
            {
              name: `sweep-unmatched:${cityId}`,
              everySeconds: JOB_INTERVALS.sweepUnmatched,
              runOnStart: true,
              run: async () => {
                const report = await runSweepUnmatchedOrders(cityId, {
                  finder: unmatchedFinder,
                  escalate: negotiation.escalate,
                  /**
                   * الباب الثاني يُوصَل هنا: بدونه تذهب كلّ طلبات الإنتاج إلى قروب الإسناد
                   * ويبقى قروب غير المشتركين فارغاً — آلةٌ كاملةٌ مبنيّةٌ لا أحد يفتح دورتها.
                   */
                  unsubscribed: negotiation.republish,
                  staleAfterSeconds: await unmatchedThreshold(cityId),
                  maxBroadcastRounds: await numericSetting(
                    cityId,
                    "max_broadcast_rounds",
                    BROADCAST_ROUNDS_FALLBACK,
                  ),
                  log: (message, meta) => log.info(message, meta),
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                const value = report.value;
                return `examined=${value.examined} unsubOffered=${value.offeredToUnsubscribed.length} unsubWaiting=${value.awaitingUnsubscribed} escalated=${value.escalated.length} queuedNoDriver=${value.queuedNoDriver.length} queuedWiderCircle=${value.queuedWiderCircle.length} already=${value.alreadyEscalated} broadcasting=${value.stillBroadcasting} failed=${value.failed}`;
              },
            },
            {
              name: `rotate-negotiations:${cityId}`,
              everySeconds: JOB_INTERVALS.rotateNegotiations,
              runOnStart: true,
              run: async () => {
                const report = await rotateUnsubscribedNegotiations(cityId, {
                  snapshots: negotiation.snapshots,
                  rotate: negotiation.rotate,
                  republish: negotiation.republish,
                  escalate: negotiation.escalate,
                  clock: systemClock,
                  log: (message, meta) => log.info(message, meta),
                  ...(groupCards === undefined ? {} : { groupCards }),
                });
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                const value = report.value;
                return `advanced=${value.advanced.length} republished=${value.republished.length} escalated=${value.escalated.length} cardsClosed=${value.cardsClosed} failures=${value.failures.length}`;
              },
            },
            {
              name: `cleanup-stale:${cityId}`,
              everySeconds: JOB_INTERVALS.cleanupStale,
              run: async () => {
                const report = await cleanupStaleSessions(
                  { cityId },
                  {
                    settings,
                    rpc: availabilityRpc,
                    fallbackMinutes: AVAILABILITY_FALLBACK_MINUTES,
                  },
                );
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                return `deactivated=${report.value.availability.deactivated} staleMinutes=${report.value.availability.staleMinutes}`;
              },
            },
            ...(reconcileProvider === null
              ? []
              : [
                  {
                    /**
                     * شبكة الأمان تحت الويبهوك: تسأل خادم المزوّد عن كل دفعةٍ بقيت
                     * معلّقة، فتحسم ما دُفِع ولم يُفعَّل. بلاها كان الويبهوك الضائع
                     * خسارةً نهائية لا يعرف بها أحد.
                     */
                    name: `reconcile-pending-payments:${cityId}`,
                    everySeconds: JOB_INTERVALS.reconcilePendingPayments,
                    run: async () => {
                      const report = await runReconcilePendingPayments(
                        {
                          cityId,
                          olderThanSeconds: await numericSetting(
                            cityId,
                            "payment_reconcile_after_seconds",
                            RECONCILE_FALLBACK_OLDER_THAN_SECONDS,
                          ),
                          maxAgeSeconds: await numericSetting(
                            cityId,
                            "payment_reconcile_max_age_seconds",
                            RECONCILE_FALLBACK_MAX_AGE_SECONDS,
                          ),
                          limit: await numericSetting(
                            cityId,
                            "payment_reconcile_batch_limit",
                            RECONCILE_FALLBACK_LIMIT,
                          ),
                        },
                        {
                          payments,
                          provider: reconcileProvider,
                          log: (message, meta) => log.info(message, meta),
                        },
                      );
                      if (!report.ok) throw new Error(report.error.detail);
                      const value = report.value;
                      return `examined=${value.examined} settled=${value.settled} pending=${value.stillPending} already=${value.alreadySettled} failed=${value.failed}`;
                    },
                  },
                ]),
            {
              name: `warn-expiring:${cityId}`,
              everySeconds: JOB_INTERVALS.warnExpiring,
              runOnStart: true,
              run: async () => {
                const days = await warningDays(cityId);
                const report = await warnExpiringSoon(
                  { cityId, days },
                  {
                    rpc: lifecycleRpc,
                    sender: warningSender,
                    onSendFailure: (subscriptionId, failure) =>
                      log.error("warn_expiring.send_failed", {
                        subscriptionId,
                        detail: failure.detail,
                      }),
                  },
                );
                if (!report.ok) throw new Error(JSON.stringify(report.error));
                return `days=${days} examined=${report.value.examined} warned=${report.value.warned} failed=${report.value.failed.length}`;
              },
            },
            {
              /**
               * `DEC-27` — إشعارُ انتهاءِ وثائقِ السائقِ قبلَ ثلاثينَ يومًا.
               * نفسُ نمطِ `warn-expiring` للاشتراكاتِ: مهمّةٌ لكلِّ مدينةٍ،
               * والقرارُ في القاعدةِ لا هنا.
               */
              name: `warn-expiring-documents:${cityId}`,
              everySeconds: JOB_INTERVALS.warnExpiringDocuments,
              run: async () => {
                const documentExpiryRpc = createDocumentExpiryRpcPort(sql);
                const documentExpirySender =
                  warningSender as unknown as DocumentExpiryWarningSender;
                const report = await warnExpiringDocumentsJob(
                  { cityId, days: 30 },
                  {
                    rpc: documentExpiryRpc,
                    sender: documentExpirySender,
                    onSendFailure: (documentId, failure) =>
                      log.error("warn_expiring_documents.send_failed", {
                        documentId,
                        detail: failure.detail,
                      }),
                  },
                );
                if (!report.ok) throw new Error(report.error.message);
                return `examined=${report.value.examined} warned=${report.value.warned} failed=${report.value.failed.length}`;
              },
            },
            {
              /**
               * مهمّةٌ لكلّ مدينة لا مهمّةٌ عامّة، لأنّ حدّ الدفعة وموعدَ إعادةِ المحاولة
               * يُقرأان من `platform_settings` المُفتاحة بالمدينة. ومهمّةٌ واحدة عابرةٌ
               * للمدن كانت ستجعل مدينةً مزدحمة تستنزف دفعةَ غيرها في كلّ شوط.
               */
              name: `deliver-broadcasts:${cityId}`,
              everySeconds: JOB_INTERVALS.deliverBroadcasts,
              runOnStart: true,
              run: async () => {
                const report = await deliverBroadcasts(cityId, {
                  deliveries: broadcastDeliveries,
                  publishers: {
                    drivers: driverBroadcastPublisher,
                    riders: riderBroadcastPublisher,
                  },
                });
                if (!report.ok) throw new Error(report.error.detail);
                const value = report.value;
                return `claimed=${value.claimed} sent=${value.sent} failed=${value.failed} retried=${value.retried}`;
              },
            },
            {
              /**
               * إشعاراتُ الاشتراك تُكتب في القاعدة داخل معاملة تغيُّر الحالة، فلا يُفقد
               * إشعارٌ لأنّ تلغرام كان محجوباً لحظةَ التفعيل. وهذه المهمّة تسلّمها فقط.
               */
              name: `deliver-subscription-notices:${cityId}`,
              everySeconds: JOB_INTERVALS.deliverSubscriptionNotices,
              runOnStart: true,
              run: async () => {
                const report = await deliverSubscriptionNotices(cityId, {
                  notices: subscriptionNotices,
                  publisher: subscriptionNoticePublisher,
                });
                if (!report.ok) throw new Error(report.error.detail);
                const value = report.value;
                return `claimed=${value.claimed} sent=${value.sent} failed=${value.failed} retried=${value.retried}`;
              },
            },
          ] as JobDefinition[]
        ).map((job) => ({ ...job, cityId })),
      );

      // مهامّ لا تخصّ مدينة بعينها: الدالّتان تعملان على القاعدة كلّها في نداء واحد،
      // فتشغيلهما لكل مدينة كان سيكرّر نفس العمل بعدد المدن.
      // المهامّ العامة تشمل النسخ الاحتياطي اليوميّ إلى Google Drive (البند 7).
      // لا يُفعَّل إلا عند توفر اعتمادات Google Drive، فغيابها تخطّي صامت لا خطأ.
      const backupConfig = readBackupConfig(config.databaseUrl);
      const backupLocalDir = process.env.BACKUP_LOCAL_DIR;
      const backupStorage =
        backupConfig === null
          ? null
          : backupLocalDir
            ? createLocalBackupStorage({ directory: backupLocalDir })
            : createGoogleDriveStorage({
                serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
                folderId: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID ?? "",
              });

      /**
       * `W-5` — ناقلُ أحداثِ MOVE إلى CORE. لا يُسجَّلُ إلّا حينَ يزرعُ المُشغِّلُ
       * عنوانَ CORE ورمزَ خدمةِ MOVE: مهمّةٌ تعملُ بلا عنوانٍ كانت ستُخفِقُ كلَّ
       * خمسَ عشرةَ ثانيةً بضجيجٍ لا يُصلِحُه أحدٌ، وصفوفُ الصادرِ محفوظةٌ تُصرَّفُ
       * حينَ يُضبَطُ الإعدادُ لا تُفقَدُ. والغيابُ يُسجَّلُ مرّةً عندَ البناءِ
       * ليُقرأَ في السجلِّ لا يُخمَّنَ.
       */
      const coreEventsBaseUrl = process.env[CORE_EVENT_TRANSPORT_ENV.baseUrl];
      const coreEventsBearerToken = process.env[CORE_EVENT_TRANSPORT_ENV.bearerToken];
      const moveEventShipper =
        coreEventsBaseUrl === undefined || coreEventsBearerToken === undefined
          ? null
          : createCoreEventShipper({
              baseUrl: coreEventsBaseUrl,
              bearerToken: coreEventsBearerToken,
            });
      /**
       * `WR-15` (2026-10-12) — الغيابُ **حالةٌ مقرَّرةٌ لا عطل**: تكاملُ CORE مؤجَّلٌ بتعليمةِ
       * المالكِ `O-7` (ADR 0094 · ADR 0095)، فلا عنوانَ ولا رمزَ صحيحَين يُضبَطان اليوم، وجدولُ
       * `move_event_outbox` في `deferred/` لا في القاعدة. كانَ يُسجَّلُ `error` عندَ كلِّ إقلاعٍ
       * فيُغرِقُ قراءةَ السجلِّ بإنذارٍ لا يُصلِحُه أحد، ويُخفي الخطأَ الحقيقيَّ بجوارِه. فصارَ
       * `info` باسمٍ يقولُ السبب. ويعودُ خطأً **إن ضُبِطَ أحدُ المتغيّرَين دونَ الآخر**: ذلك
       * إعدادٌ ناقصٌ حقّاً.
       */
      if (moveEventShipper === null) {
        const partial = (coreEventsBaseUrl === undefined) !== (coreEventsBearerToken === undefined);
        const meta = {
          baseUrl: CORE_EVENT_TRANSPORT_ENV.baseUrl,
          bearerToken: CORE_EVENT_TRANSPORT_ENV.bearerToken,
          decision: "O-7 · ADR 0094",
        };
        if (partial) log.error("move_event_outbox.shipper_partially_configured", meta);
        else log.info("move_event_outbox.deferred", meta);
      }

      const global: JobDefinition[] = [
        {
          // `LOAD-01 Recovery` — كنسٌّ عالميٌّ (لا مدينةَ بعينِها): الدالّةُ تنظرُ
          // الطابورَ كلَّهُ. عطلُهُ لا يفتحُ رابطًا ولا يُبطِلُ إشعارًا حيًّا —
          // الصفوفُ تعودُ إلى انتظارِ المعالجِ كما كانَ (أبطأُ لا مكسورٌ).
          name: "sweep-decided-offers",
          everySeconds: JOB_INTERVALS.sweepDecidedOffers,
          run: async () => {
            const report = await sweepDecidedOfferNotifications(sql);
            if (!report.ok) throw new Error(report.error.detail);
            return `swept=${report.value.swept}`;
          },
        },
        ...(cityIds.length === 0
          ? []
          : [
              {
                // القفل باسم ثابت يجعل نسختين من العامل تتسابقان على outbox واحداً من
                // دون إرسال بطاقتين؛ وSKIP LOCKED داخل RPC يحمي كذلك تعدد العناصر.
                name: "deliver-safety-incidents",
                everySeconds: JOB_INTERVALS.deliverSafetyIncidents,
                runOnStart: true,
                run: async () => {
                  const report = await deliverSafetyIncidents({
                    deliveries: safetyDeliveries,
                    publisher: safetyPublisher,
                  });
                  if (!report.ok) throw new Error(report.error.detail);
                  // المؤجَّل يُذكر باسمه في سطر السجلّ: نداءُ استغاثةٍ لا يُسلَّم
                  // لنقص إعدادٍ يجب أن يظهر في كل دورة حتى يُضبط الإعداد.
                  const deferred = report.value.deferred
                    .map((entry) => `${entry.cityId}:${entry.reason}`)
                    .join(",");
                  return [
                    `claimed=${report.value.claimed}`,
                    `delivered=${report.value.delivered}`,
                    `failed=${report.value.failed}`,
                    deferred === ""
                      ? "deferred=0"
                      : `deferred=${report.value.deferred.length} (${deferred})`,
                  ].join(" ");
                },
              },
              {
                // `WR-09` (ADR 0266) — ما فاتَ موعدُه من المرشَّحين يُحرَّرُ (عرضُه `rejected`
                // فيُستبعَدُ من الجولاتِ التالية) ويُخطَرُ سائقُه، وما أُلغيَ طلبُه كذلك.
                name: "expire-order-candidates",
                everySeconds: JOB_INTERVALS.expireOrderCandidates,
                runOnStart: true,
                run: async () => {
                  const rows = await sql<{ result: Record<string, unknown> }[]>`
                    select expire_order_candidates(50) as result`;
                  const result = rows[0]?.result ?? {};
                  return `expired=${String(result.expired ?? 0)} cancelled=${String(result.cancelled ?? 0)}`;
                },
              },
              {
                // `WR-13` (ADR 0269) — مَن موقعُه الحديثُ الموثوقُ خارجَ حدِّ مدينتِه يُنقَلُ إلى المدينةِ
                // المفعّلةِ التي تغطّيه بـ`update_driver_city` نفسِه، أو يُخطَرُ أنَّه خارجَ التغطية.
                name: "relocate-drivers-by-location",
                everySeconds: JOB_INTERVALS.relocateDriversByLocation,
                runOnStart: false,
                run: async () => {
                  const rows = await sql<{ result: Record<string, unknown> }[]>`
                    select relocate_drivers_by_location(100) as result`;
                  const r = rows[0]?.result ?? {};
                  return `moved=${String(r.moved ?? 0)} outside=${String(r.outside ?? 0)} held=${String(r.held ?? 0)}`;
                },
              },
              {
                // `WR-06` (ADR 0273) — تذكيرُ الراكبِ بمجدولِه وتذكيرُ السائقِ المُسنَدِ بالحضور،
                // بمفتاحٍ لكلِّ طلبٍ فلا يتكرّرُ بعدَ إعادةِ تشغيل. الإرسالُ من `deliver-notifications`.
                name: "enqueue-scheduled-reminders",
                everySeconds: JOB_INTERVALS.enqueueScheduledReminders,
                runOnStart: true,
                run: async () => {
                  const counts = await enqueueScheduledReminders(sql, 100);
                  return `riders=${counts.riderReminders} drivers=${counts.driverReminders}`;
                },
              },
              {
                // `WR-12` (ADR 0268) — السائقُ المتوفّرُ الذي لم يصل منه موقعٌ خلالَ المهلةِ يُذكَّر،
                // بسقفٍ لكلِّ نوبةٍ ومفتاحِ دلوٍ زمنيّ. الإرسالُ نفسُه من `deliver-notifications`.
                name: "enqueue-location-reminders",
                everySeconds: JOB_INTERVALS.enqueueLocationReminders,
                runOnStart: false,
                run: async () => {
                  const rows = await sql<{ result: Record<string, unknown> }[]>`
                    select enqueue_driver_location_reminders(100) as result`;
                  return `enqueued=${String(rows[0]?.result?.enqueued ?? 0)}`;
                },
              },
              {
                // كلُّ إشعارٍ يقعُ أثرُه بعدَ تغيّرِ حالةٍ يُكتَبُ ذرّيًّا في معاملةِ ذاك
                // التغييرِ (open_offer_round، resolve_support_ticket، …) ثمّ يُرسَلُ من
                // هذا العاملِ وحدَه. القفلُ باسمٍ ثابتٍ + claim_token يمنعانِ تكرارَ
                // الإرسالِ لو تسابقت نسختانِ من العاملِ على الصفّ؛ والصفُّ المُسلَّمُ لا
                // يُلتقطُ ثانيةً (BUG-004).
                name: "deliver-notifications",
                everySeconds: JOB_INTERVALS.deliverNotifications,
                runOnStart: true,
                run: async () => {
                  const report = await deliverNotifications(
                    {
                      outbox: notificationOutbox,
                      handlers: notificationHandlers,
                      // `F8-01` — عبورُ الطابورِ: معالجةُ الصفِّ وإعلانُ نتيجتِه
                      // تجريانِ **بمعرِّفِ الطلبِ الذي أنشأَ الصفَّ**، فمَن بحثَ
                      // بمعرِّفٍ من ردٍّ وجدَ أثرَ الإرسالِ في العاملِ أيضاً لا في
                      // البوّابةِ وحدَها. وصفٌّ بلا معرِّفٍ يمضي بسياقِ الشوطِ نفسِه
                      // (`job-…`) ولا يُلفَّقُ له معرِّفُ طلبٍ.
                      withDeliveryCorrelation: (delivery, run) =>
                        delivery.requestId === null
                          ? run()
                          : runWithCorrelationId(
                              { requestId: delivery.requestId, entry: "worker" },
                              run,
                            ),
                    },
                    // CAP-RUN-20261015 / N1: استنزافٌ متزامنٌ محدود؛ NOTIFICATION_DRAIN_BUDGET_MS=0 = السلوكُ القديم.
                    notificationDrainSettingsFromEnv(process.env),
                  );
                  if (!report.ok) throw new Error(report.error.detail);
                  return [
                    `claimed=${report.value.claimed}`,
                    `delivered=${report.value.delivered}`,
                    `failed=${report.value.failed}`,
                    `abandoned=${report.value.abandoned}`,
                    `undeliverable=${report.value.undeliverable}`,
                  ].join(" ");
                },
              },
            ]),
        {
          name: "expire-subscriptions",
          everySeconds: JOB_INTERVALS.expireSubscriptions,
          runOnStart: true,
          run: async () => {
            const report = await expireSubscriptions({ rpc: lifecycleRpc });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `expired=${report.value.expiredCount}`;
          },
        },
        {
          name: "recompute-ratings",
          everySeconds: JOB_INTERVALS.recomputeRatings,
          run: async () => {
            const report = await recomputeRatings({ recompute: recomputePort });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            return `drivers=${report.value.driversUpdated} riders=${report.value.ridersUpdated}`;
          },
        },
        {
          /**
           * `F7-08` · `CAP-011` — شوطٌ واحدٌ يُعيدُ بناءَ لقطةِ لوحةِ الإدارةِ
           * لكلِّ المدنِ. وعائدُه **زمنُ القياسِ لا زمنُ الكتابةِ**: هوَ عينُ ما
           * يُنشَرُ للمُشغِّلِ في اللوحةِ، فوجودُه في السجلِّ يجعلُ مقارنةَ ما رأى
           * بما جرى مُمكنةً بلا استنتاجٍ.
           */
          name: "refresh-admin-metrics",
          everySeconds: JOB_INTERVALS.refreshAdminMetrics,
          run: async () => {
            const report = await refreshAdminMetrics(
              { port: adminMetricSnapshotPort },
              { windowHours: ADMIN_METRIC_WINDOW_HOURS },
            );
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            const value = report.value;
            /**
             * صفرُ مدنٍ مكتوبةٍ يُرفَعُ إلى `error` لا `info`: الشوطُ يمسحُ
             * `cities` كلَّها ويكتبُ أصفاراً للساكنةِ، فصفرٌ لا يعني «لا نشاطَ»
             * بل **لا مدينةَ في القاعدةِ** — ولوحةٌ تُقرَأُ فارغةً أبداً بلا أن
             * يسقطَ شيءٌ أسوأُ من لوحةٍ تسقُطُ.
             */
            if (value.citiesWritten === 0) {
              log.error("admin_metrics.no_cities_written", {
                windowHours: value.windowHours,
                computedAt: value.computedAt,
              });
            }
            return `cities=${value.citiesWritten} computed_at=${value.computedAt}`;
          },
        },
      ];

      if (moveEventShipper !== null) {
        const fulfillmentLifecycle = createFulfillmentLifecycle(
          createOperationalJobRepository(sql),
        );
        global.push({
          name: "ship-move-events",
          everySeconds: JOB_INTERVALS.shipMoveEvents,
          runOnStart: true,
          run: async () => {
            const report = await shipDueMoveEvents({
              lifecycle: fulfillmentLifecycle,
              shipper: moveEventShipper,
              maxEvents: MOVE_EVENT_OUTBOX_CONSUMER_CONCURRENCY,
            });
            if (!report.ok) throw new Error(JSON.stringify(report.error));
            const value = report.value;
            /**
             * الميّتُ يُرفَعُ إلى `error`: صفٌّ ماتَ يعني خبراً لن يصلَ CORE أبداً،
             * وذاكَ عطلٌ يستوجبُ يداً لا سطراً في `info` يمرُّ.
             */
            if (value.dead + value.contractRejected > 0) {
              log.error("move_event_outbox.events_dead", {
                dead: value.dead,
                contractRejected: value.contractRejected,
              });
            }
            return (
              `claimed=${value.claimed} delivered=${value.delivered} retried=${value.retried} ` +
              `dead=${value.dead} contract_rejected=${value.contractRejected} truncated=${value.truncated}`
            );
          },
        });
      }

      // النسخ الاحتياطي مهمّة عامّة لا لكل مدينة: قاعدة واحدة نسخة واحدة.
      if (backupStorage !== null && backupConfig !== null) {
        global.push({
          name: "backup-database",
          everySeconds: JOB_INTERVALS.backupDatabase,
          run: async () => {
            const report = await runDatabaseBackup(
              backupConfig,
              {
                storage: backupStorage,
                sql,
                clock: systemClock,
                log: (message, meta) => log.info(message, meta),
              },
              createPgDumper(),
            );
            if (!report.ok) throw new Error(report.error.detail);
            const v = report.value;
            return v.status === "uploaded"
              ? `uploaded bytes=${v.bytes ?? 0} pruned=${v.pruned ?? 0}`
              : `skipped (${v.status})`;
          },
        });

        /**
         * تحقّق الاستعادة: يُنزِل أحدث أرشيف ويستعيده فعلاً في قاعدةٍ معزولة، ويعدّ
         * الجداول والدوال وسياسات RLS والقُيود. يُسجّل مع مهمة النسخ نفسها وبنفس
         * شرطها: تحقّقٌ بلا نسخٍ لا معنى له، ونسخٌ بلا تحقّق وعدٌ لم يُختبر قطّ.
         * القفل الموزّع في runner يمنع تمرينين متزامنين يتسابقان على قاعدة التمرين.
         */
        global.push({
          name: "verify-backup-restore",
          everySeconds: JOB_INTERVALS.verifyBackupRestore,
          run: async () => {
            const report = await runBackupRestoreVerification(
              { databaseUrl: config.databaseUrl },
              { storage: backupStorage, sql, log: (message, meta) => log.info(message, meta) },
            );
            if (!report.ok) throw new Error(report.error.detail);
            return `${report.value.status} run=${report.value.backupRunId ?? "none"}`;
          },
        });
      }

      /**
       * `F7-03` — تقديمُ نافذةِ أقسامِ `driver_location_history` (`ADR-0074`).
       *
       * عامّةٌ لا مدنيّةٌ، ولا تُشرَطُ بمدينةٍ مفعّلةٍ: القِسمُ يقعُ على
       * `recorded_at` وحدَه، ومدىً زمنيٌّ واحدٌ يخدمُ المدنَ كلَّها — فمهمّةٌ لكلِّ
       * مدينةٍ تعني نداءاتٍ متسابقةً تُنشئُ الجدولَ نفسَه.
       *
       * ولا تُشرَطُ بـRedis ولا بمسارِ الدفعةِ: المسارُ المباشرُ (`F4-01`)
       * يُلحِقُ أيضاً، فغيابُ القِسمِ يُسقِطُ كتابةَ الموقعِ أيًّا كانَ المسارُ.
       *
       * وليسَ في `CRITICAL_GLOBAL_JOBS`: نافذةُ أربعةَ عشرَ يوماً تعني أنَّ فوتَ
       * نبضةٍ أو نبضتينِ لا أثرَ له، وإدراجُها حرجةً كانَ سيُرجِعُ `503` من
       * `/ready` على مهمّةٍ مهلتُها أسبوعانِ.
       */
      global.push({
        name: "ensure-location-partitions",
        everySeconds: JOB_INTERVALS.ensureLocationPartitions,
        runOnStart: true,
        run: async () => {
          const report = await ensureLocationPartitions({ partitions: driverLocationPartitions });
          if (!report.ok) throw new Error(report.error.detail);
          const value = report.value;
          /**
           * صفوفُ القِسمِ الافتراضيِّ تُرفَعُ إلى `error` لا `info`: وجودُها
           * يعني أنَّ إصلاحةً هبطت في شبكةِ الأمانِ لغيابِ قِسمِ يومِها — وهوَ
           * حالٌ شاذٌّ يُعالَجُ بيدٍ، ولا يُسقِطُ المهمّةَ إذ أقسامُ الغدِ تُنشَأُ.
           */
          if (value.defaultRows > 0) {
            log.error("driver_location.default_partition_not_empty", {
              rows: value.defaultRows,
            });
          }
          return `created=${value.created.length} existing=${value.existing} default_rows=${value.defaultRows}`;
        },
      });

      /**
       * `F7-06` / `DEC-15` — أرشفةُ الأقسامِ التي تجاوزَت النافذةَ الساخنةَ ثمَّ
       * إسقاطُها. مهمّةٌ عامّةٌ يوميّةٌ، لا مدنيّةٌ: القِسمُ يقعُ على `recorded_at`
       * وحدَه، والأرشفةُ داخلَه تُقسَّمُ بالمدينةِ في حالةِ الاستخدامِ نفسِها.
       *
       * **ولا تُسجَّلُ ألبتّةَ إن لم يكنْ مخزنٌ**: أرشفةٌ بلا مخزنٍ تعني إسقاطاً
       * بلا نسخةٍ، وذاكَ إتلافٌ لا استبقاءٌ. وغيابُ المخزنِ تخطٍّ صامتٌ للمهمّةِ
       * كما هوَ حالُ النسخِ الاحتياطيِّ نفسِه، والقاعدةُ تنمو — وهوَ الحالُ
       * القائمُ اليومَ لا انحدارٌ أحدثَه هذا البندُ.
       *
       * وليست في `CRITICAL_GLOBAL_JOBS`: فوتُ نبضةٍ أو نبضتينِ على مهمّةٍ مهلتُها
       * يومٌ ونافذتُها أربعةَ عشرَ يوماً لا أثرَ له، وإدراجُها حرجةً كانَ
       * سيُرجِعُ `503` من `/ready` على تأخّرٍ لا يمسُّ راكباً ولا سائقاً.
       */
      if (backupStorage !== null) {
        const locationArchiveCatalog = createLocationArchiveCatalog(sql);
        const locationArchiveStore = createLocationArchiveStore(backupStorage);
        const locationArchiveCodec = createLocationArchiveCodec();
        global.push({
          name: "archive-location-partitions",
          everySeconds: JOB_INTERVALS.archiveLocationPartitions,
          run: async () => {
            const report = await archiveDueLocationPartitions(
              {
                catalog: locationArchiveCatalog,
                store: locationArchiveStore,
                codec: locationArchiveCodec,
                log: (message, meta) => log.error(message, meta),
              },
              {
                hotDays: LOCATION_HOT_DAYS,
                maxDays: ARCHIVE_MAX_DAYS_PER_RUN,
                partRows: ARCHIVE_PART_ROWS,
              },
            );
            if (!report.ok) throw new Error(report.error.detail);
            const value = report.value;
            /**
             * الرفضُ يُرفَعُ إلى `error` لا `info`: يومٌ يُرفَضُ إسقاطُه شوطاً
             * بعدَ شوطٍ يعني أنَّ الأرشفةَ لا تكتملُ، والقرصُ يمتلئُ بينما
             * المهمّةُ تُرجِعُ نجاحاً في كلِّ مرّةٍ.
             */
            if (value.refused.length > 0) {
              log.error("location_archive.days_refused", { refused: value.refused });
            }
            return (
              `days=${value.daysExamined} parts=${value.partsUploaded} ` +
              `archived=${value.rowsArchived} dropped_partitions=${value.partitionsDropped} ` +
              `dropped_rows=${value.rowsDropped} refused=${value.refused.length}`
            );
          },
        });
      }

      /**
       * `F4-02` — إفراغُ قائمةِ انتظارِ المواقعِ. تُبنى **بعدَ** قراءةِ الأرقامِ من
       * `platform_settings` لأنَّ `everySeconds` تُثبَّتُ لحظةَ التسجيلِ لا لحظةَ
       * الشوطِ: قراءةُ الدورةِ داخلَ `run` كانت ستُغيِّرُ ما يُقاسُ لا ما يُنفَّذُ.
       *
       * ومدينةٌ ناقصةُ الإعدادِ **لا تُسجَّلُ لها مهمّةٌ** ويُسجَّلُ الخرقُ: لا رقمَ
       * احتياطيَّ في الشيفرةِ (القاعدةُ ٠.٤)، والنظامُ يتدهوّرُ إلى كتابةٍ مباشرةٍ
       * لكلِّ نبضةٍ — أبطأُ ولا يفقدُ موضعاً. واختراعُ دورةٍ ههنا كانَ سيجعلَ رقماً
       * في الشيفرةِ يحكمُ حِمْلَ القاعدةِ بلا أن يراهُ مالكٌ في لوحةٍ.
       *
       * وليست في `CRITICAL_CITY_JOBS`: تأخّرُها يُبقي صفَّ السائقِ متأخّراً ثوانيَ
       * والخريطةُ الحيّةُ تقرأُ من البثِّ لا من الصفِّ، فلا تتوقّفُ دورةُ الرحلةِ
       * ولا دورةُ الرزقِ. وإدراجُها حرجةً كانَ سيُرجِعُ `503` من `/ready` على تأخّرٍ
       * أثرُه دقّةُ موضعٍ لا انقطاعُ خدمةٍ.
       */
      const hotState = driverLocationHotState;
      const flushJobs: JobDefinition[] =
        hotState === null
          ? []
          : (
              await Promise.all(
                cityIds.map(async (cityId): Promise<JobDefinition | null> => {
                  const limits = await hotState.limits(cityId);
                  if (!limits.ok) {
                    log.error("driver_location.flush_not_registered", {
                      cityId,
                      detail: limits.error.detail,
                    });
                    return null;
                  }
                  const everySeconds = limits.value.flushIntervalSeconds;
                  return {
                    name: `flush-driver-locations:${cityId}`,
                    everySeconds,
                    cityId,
                    run: async () => {
                      const report = await flushDriverLocationBacklog(cityId, {
                        backlog: hotState,
                        persistence: driverLocationPersistence,
                        limits: limits.value,
                      });
                      if (!report.ok) throw new Error(JSON.stringify(report.error));
                      const value = report.value;
                      // `appended` في السطرِ نفسِه بقصدٍ: يَعُدُّ صفوفَ الأثرِ
                      // (النبضاتِ) فيزيدُ على `applied` (السائقينَ) في الدفعةِ
                      // المتراكمةِ — وهذا هوَ السويُّ بعدَ `D-38` (`ADR 0209`)،
                      // وعينٌ تقرأُ السطرَ ترى نبضةً مقبولةً لم تبلغِ الأثرَ فوراً.
                      return `drained=${value.drained} batched=${value.batched} applied=${value.applied} stale=${value.stale} missing=${value.missing} appended=${value.appended}`;
                    },
                  };
                }),
              )
            ).filter((job): job is JobDefinition => job !== null);

      // المهامّ العامّة تبقى بلا `cityId` عن قصد: لا مدينةَ لها أصلاً، وإسنادُها إلى
      // مدينةٍ اعتباطية كان سيجعل نبضةً عامّة تبدو مدنيّة في `job_heartbeats`.
      return [...perCity, ...flushJobs, ...global];
    },

    close: async () => {
      // تجمّع القفل يُغلق أولاً: اتصالٌ يحمل قفلاً يُنهى فيسقط القفل معه فوراً،
      // فلا تنتظر النسخة التالية انقضاء مهلة اتصال ميت لتأخذ ما هو متروك أصلاً.
      if (overrides.lockSql === undefined) await lockSql.end({ timeout: 5 });
      if (overrides.sql === undefined) await sql.end({ timeout: 5 });
    },
  };
}
