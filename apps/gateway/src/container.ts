/**
 * الغرض: تركيب التبعيات: يحوّل مجموعة منافذ جاهزة إلى معالج تحديثات يفهمه مسار الـ webhook،
 *   ويبني تلك المنافذ من محوّلات قاعدة البيانات الحقيقية عند الإقلاع.
 *   هذا هو الموضع الوحيد الذي يعرف "من يُنفِّذ ماذا"، فلا يعرفه منطق الحوار.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ومُختبَر على قاعدة حقيقية في tests/integration.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، apps/workers
 * ملاحظات مستقبلية: مخزن الجلسات يصير Redis بتبديل سطر واحد هنا، بلا لمس أي منطق.
 */

import type { DriverBotDependencies } from "../../../packages/application/bots/driver-dialog.ts";
import type { MiniAppSurfaceConfig } from "../../../packages/application/bots/miniapp-surface.ts";
import type { RiderBotDependencies } from "../../../packages/application/bots/rider-dialog.ts";
import type { SupportDialogDependencies } from "../../../packages/application/bots/support-dialog.ts";
import type {
  BotReply,
  DriverDirectory,
  OfferDecisionPort,
  OrderCancellationPort,
  SessionStore,
} from "../../../packages/application/bots/types.ts";
import { RIDER_TRIP_APP_FIRST_EVENTS } from "../../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import type { EscalateUnmatchedOrderDependencies } from "../../../packages/application/dispatch/escalate-unmatched-order.ts";
import type { PublishToUnsubscribedGroupDependencies } from "../../../packages/application/dispatch/publish-to-unsubscribed-group.ts";
import { redispatchSearchingOrders } from "../../../packages/application/dispatch/redispatch-searching-orders.ts";
import type { RepublishDependencies } from "../../../packages/application/dispatch/republish-order-card.ts";
import type { RotateNegotiationDependencies } from "../../../packages/application/dispatch/rotate-negotiation-turn.ts";
import type { PostDisputeCardDependencies } from "../../../packages/application/dispute/post-dispute-card.ts";
import type { SupportResolutionPort } from "../../../packages/application/dispute/resolve-dispute.ts";
import type { RiderTripNoticeDeps } from "../../../packages/application/driver/rider-trip-notice.ts";
import type { FinanceObjectionView } from "../../../packages/application/financial/driver-finance-overview.ts";
import type {
  PaymentProvider,
  SubscriptionWalletRpcPort,
} from "../../../packages/application/financial/ports.ts";
import type { UpdateDriverLocationDeps } from "../../../packages/application/geo/update-driver-location.ts";
import type {
  GroupJoinGateDependencies,
  TelegramGroupGatePort,
} from "../../../packages/application/groups/group-join-gate.ts";
import type {
  TranslateMessageDependencies,
  TranslationProvider,
} from "../../../packages/application/i18n-translation/index.ts";
import type {
  RatingFlagPort,
  ReputationReader,
} from "../../../packages/application/reputation/index.ts";
import type { TriggerSosPort } from "../../../packages/application/safety/ports.ts";
import { CachedRoutingProvider } from "../../../packages/application/tracking/cached-routing-provider.ts";
import {
  type CustomerLiveRelay,
  createCustomerLiveRelay,
  type LiveLocationChannel,
} from "../../../packages/application/tracking/customer-live-relay.ts";
import type { DriverTripCardReader } from "../../../packages/application/tracking/driver-trip-card.ts";
import {
  createLiveTracking,
  type LiveTrackingPort,
} from "../../../packages/application/tracking/live-tracking.ts";
import type {
  TrackingTokenMintPort,
  TrackingTokenRpcPort,
} from "../../../packages/application/tracking/tracking-token-ports.ts";
import type { TranslationFailure } from "../../../packages/domain/i18n-translation/index.ts";
import { DEFAULT_SESSION_POLICY } from "../../../packages/domain/tracking/session.ts";
import { createSql, type Sql } from "../../../packages/infrastructure/db/client.ts";
import {
  createDispatchRpc,
  createDriverCandidateRepository,
  createOfferDecisionPort,
  createOfferRepository,
  createOfferWriter,
  createSearchingOrderFinder,
} from "../../../packages/infrastructure/dispatch/dispatch-adapters.ts";
import {
  createActiveNegotiationLookup,
  createClaimRegistrationPort,
  createEscalationPort,
  createNegotiationDriverCardReader,
  createNegotiationRotationPort,
  createNegotiationSnapshotReader,
  createOrderNotesReader,
  createUnsubscribedCyclePort,
} from "../../../packages/infrastructure/dispatch/negotiation-adapters.ts";
import { createAgentMeasurementPort } from "../../../packages/infrastructure/dispute/agent-measurement-adapters.ts";
import {
  createSupportCardRecorder,
  createSupportClaimPort,
  createSupportResolutionPort,
  createSupportTicketContextReader,
  createSupportTicketPort,
} from "../../../packages/infrastructure/dispute/support-adapters.ts";
import { createPaymentRepository } from "../../../packages/infrastructure/financial/payment-adapters.ts";
import { createSubscriptionWalletRpc } from "../../../packages/infrastructure/financial/subscription-wallet-adapters.ts";
import { createCityDirectory } from "../../../packages/infrastructure/geo/city-directory.ts";
import { createRedisDriverLocationHotState } from "../../../packages/infrastructure/geo/redis-driver-location-hot-state.ts";
import {
  createGroupMembershipStore,
  createUnsubscribedGroupCityDirectory,
} from "../../../packages/infrastructure/groups/pg-group-memberships.ts";
import {
  createLanguagePreferencePort,
  createMemoryTranslationCache,
  createTranslationProvider,
} from "../../../packages/infrastructure/i18n-translation/index.ts";
import { createBootstrapAdminPort } from "../../../packages/infrastructure/identity/bootstrap-admin.ts";
import {
  createDriverDirectory,
  createRiderDirectory,
} from "../../../packages/infrastructure/identity/directories.ts";
import {
  MINIAPP_ENTRY_LABEL,
  withMiniAppEntry,
} from "../../../packages/infrastructure/notification/miniapp-entry-sender.ts";
import { createOutboundResilience } from "../../../packages/infrastructure/notification/outbound-resilience.ts";
import {
  outboundBucketKeyOfToken,
  withOutboundResilience,
} from "../../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import { createRiderTripNoticeOutbox } from "../../../packages/infrastructure/notification/rider-trip-notice-outbox.ts";
import { botUsernameProvider } from "../../../packages/infrastructure/notification/telegram-client.ts";
import { grammyGroupJoinGate } from "../../../packages/infrastructure/notification/telegram-join-gate.ts";
import {
  grammyLiveLocationChannel,
  TELEGRAM_MAX_LIVE_PERIOD_SECONDS,
} from "../../../packages/infrastructure/notification/telegram-live-location.ts";
import {
  createEscalationGroupPublisher,
  createTelegramRelaySender,
  createUnsubscribedGroupPublisher,
} from "../../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import { createSupportCardPublisher } from "../../../packages/infrastructure/notification/telegram-support-notifier.ts";
import {
  instrumentDispatchRpc,
  instrumentOfferWriter,
} from "../../../packages/infrastructure/observability/dispatch.ts";
import {
  createStructuredLogger,
  type OperationalMetrics,
} from "../../../packages/infrastructure/observability/index.ts";
import { createSettingsRepository } from "../../../packages/infrastructure/policy/settings-repository.ts";
import {
  createRatingFlagPort,
  createRatingPort,
  createReputationReader,
  createRideLifecyclePort,
} from "../../../packages/infrastructure/reputation/rating-adapters.ts";
import {
  createSafetyResolutionPort,
  createTriggerSosPort,
} from "../../../packages/infrastructure/safety/safety-adapters.ts";
import {
  createSubscriptionReader,
  createTrialRpc,
} from "../../../packages/infrastructure/subscription/subscription-adapters.ts";
import { createSubscriptionChangeRpc } from "../../../packages/infrastructure/subscription/subscription-change-adapters.ts";
import { PostgresRiderSupportStore } from "../../../packages/infrastructure/support/rider-support-store.ts";
import {
  createTrackingEventBus,
  type TrackingEventBus,
} from "../../../packages/infrastructure/tracking/event-bus.ts";
import { createRedisLiveBroadcastStore } from "../../../packages/infrastructure/tracking/redis-live-broadcast-store.ts";
import {
  createRedisStreamTrackingEventBus,
  DEFAULT_POLL_MS,
  TRACKING_EVENT_STREAM_KEY,
} from "../../../packages/infrastructure/tracking/redis-stream-event-bus.ts";
import { createTrackingSessionRepository } from "../../../packages/infrastructure/tracking/session-repository.ts";
import {
  createActiveTripReader,
  createDriverDutyAndTripReader,
  createDriverDutyReader,
  createDriverTripCardReader,
  createTrackingProofReader,
  type TrackingProofReader,
} from "../../../packages/infrastructure/tracking/tracking-queries.ts";
import {
  createTrackingTokenMint,
  createTrackingTokenRpc,
} from "../../../packages/infrastructure/tracking/tracking-token-adapters.ts";
import {
  createActiveOrdersLookup,
  createOrderRepository,
  createOrderWriter,
  createPastOrdersLookup,
} from "../../../packages/infrastructure/transport/order-adapters.ts";
import { createRideRequestCommand } from "../../../packages/infrastructure/transport/ride-request-store.ts";
import type { RoutingProvider, RoutingQuota } from "../../../packages/maps/index.ts";
import { createOsrmProvider } from "../../../packages/maps/index.ts";
import {
  DB_POOL_MAX,
  DB_QUERY_DEADLINE_MS,
} from "../../../packages/shared/config/connection-budget.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import { type CityId, systemClock } from "../../../packages/shared/kernel/index.ts";
import { resolveGpsPolicy } from "../../../packages/tracking/config.ts";
import type { TrackingSessionStore } from "../../../packages/tracking/session-store.ts";
import {
  createAgentCore,
  createSupportAdvicePublisher,
  createTicketAdvisor,
} from "./agent-advisor.ts";
import { createDispatchTrace } from "./background/dispatch-trace.ts";
import {
  createImmediateRedispatchScheduler,
  IMMEDIATE_REDISPATCH_DEBOUNCE_MS,
} from "./background/immediate-redispatch.ts";
import { createDriverBot, grammyTelegramSender, type TelegramSender } from "./bots/driver/index.ts";
import { createRiderBot } from "./bots/rider/index.ts";
import { counterpartNotifier } from "./bots/shared/counterpart-notifier.ts";
import {
  createLanguageHydration,
  type LanguageHydration,
} from "./bots/shared/language-middleware.ts";
import { createRedisSessionStore } from "./bots/shared/redis-session.ts";
import { createMemorySessionStore } from "./bots/shared/session.ts";
import type { RawTelegramUpdate } from "./bots/shared/telegram-mapper.ts";
import { createMemoryRateLimiter, createRedisRateLimiter } from "./rate-limit/fixed-window.ts";
import { createUpstashRedis, type RedisClient } from "./redis/upstash.ts";

import type { BotKind, UpdateHandler } from "./routes/telegram-webhook.ts";

export interface BotWiring {
  readonly driver: {
    readonly deps: DriverBotDependencies;
    readonly sender: TelegramSender;
    readonly language?: LanguageHydration;
  };
  readonly rider: {
    readonly deps: RiderBotDependencies;
    readonly sender: TelegramSender;
    readonly language?: LanguageHydration;
  };
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * سطحُ البوتِ (`ADR 0213`). غيابُه = الحوارُ القديمُ كاملاً — وهو ما تبنيه الاختباراتُ القائمةُ
   * فلا يتغيّرُ ما تحرسُه.
   */
  readonly surface?: MiniAppSurfaceConfig;
}

/** يبني معالج التحديثات الحقيقي: كل بوت إلى محوّله، وما سواه يُرفض بلا ادّعاء معالجة. */
export function createUpdateHandler(wiring: BotWiring): UpdateHandler {
  const log = wiring.log ?? (() => {});
  const driverBot = createDriverBot(
    wiring.driver.deps,
    wiring.driver.sender,
    log,
    wiring.driver.language,
    wiring.surface,
  );
  const riderBot = createRiderBot(
    wiring.rider.deps,
    wiring.rider.sender,
    log,
    wiring.rider.language,
    wiring.surface,
  );

  const routes: Readonly<Record<BotKind, (raw: RawTelegramUpdate) => Promise<boolean>>> = {
    driver: (raw) => driverBot.handleUpdate(raw),
    rider: (raw) => riderBot.handleUpdate(raw),
  };

  return {
    handle: async (bot, update) => {
      if (typeof update !== "object" || update === null) return false;
      return routes[bot](update as RawTelegramUpdate);
    },
    prepare: async (bot, update) => {
      if (typeof update !== "object" || update === null) return { handled: false, replies: [] };
      const target = bot === "driver" ? driverBot : riderBot;
      return target.prepare(update as RawTelegramUpdate);
    },
    deliver: (bot, replies, from) => {
      const target = bot === "driver" ? driverBot : riderBot;
      return target.deliver(replies as readonly BotReply[], from);
    },
  };
}

/** يجعل مُرسِل البوت صالحاً كمنفذ إخطار عام (يُستخدم لبثّ العروض على السائقين). */
import {
  asIdentifyingSender,
  asOutboundSender,
  asSupportSender,
} from "../../../packages/infrastructure/notification/telegram-api-sender.ts";
import {
  measuredTelegramSender,
  silentTelegramSender,
} from "../../../packages/infrastructure/notification/telegram-transport.ts";

export { asIdentifyingSender, asOutboundSender, asSupportSender };

export interface Container {
  readonly handler: UpdateHandler;
  readonly sql: Sql;
  /** `ADR 0289` — اتّصالُ شوطِ البثِّ الفوريِّ (`gatewayDispatch`)؛ يُغلَقُ مع `sql` عندَ الإيقافِ. */
  readonly dispatchSql: Sql;
  /**
   * ADR 0287 — خطّافُ الإشارةِ الآنيةِ لأطوارِ الرحلةِ: يُركَّبُ في `index.ts` بعدَ
   * إنشاءِ القناةِ؛ فإن أُودِعَ طورٌ جديدٌ بُثَّ `trip:update` للراكبِ فورًا (لا
   * بعدَ دورةِ العاملِ). الإشارةُ لا تُعدُّ تسليمًا — الإقرارُ وحدَه يُغلقُ الصفَّ.
   */
  readonly riderTripSignal: { notify: ((telegramUserId: string, orderId: string) => void) | null };
  /**
   * التكليفُ السابعُ (P4) — طلبٌ جديدٌ باحثٌ يُطلِقُ شوطَ العرضِ الفوريَّ لمدينتِه
   * (المُجدوِلُ نفسُه بخفضِه ومانعِ تداخلِه وحافتِه اللاحقةِ). كانَ أوّلُ عرضٍ ينتظرُ محفّزَ
   * موقعِ سائقٍ أو الدوريَّ (20ث). لا يحجبُ: يعودُ فورًا وفشلُه يُسجَّلُ.
   */
  readonly dispatchNewOrder: (orderId: string) => void;
  /**
   * `F2-04` — مزوِّدُ التوجيهِ مكشوفٌ لأنَّ مسارَ الاقتباسِ يحتاجُ **نفسَ** قرارِ
   * التهيئةِ الذي بُنيَ ههنا: `null` عندَ `ROUTING_PROVIDER=none` لا مزوِّدٌ
   * صوريٌّ. ولو بُنيَ في `index.ts` ثانيةً لَصارَ للقرارِ موضعانِ يتباعدانِ
   * (القاعدة 0.6)، ولَأمكنَ أن يمتنعَ أحدُهما ويُجيبَ الآخرُ عن المدّةِ نفسِها.
   */
  readonly routing: RoutingProvider | null;
  /**
   * `WR-04` — تبعيّاتُ الترجمةِ نفسُها التي يقرؤها مُرحِّلُ تيليجرام (المزوّدُ والذاكرةُ
   * المؤقّتةُ وسجلُّ الفشل)، مكشوفةٌ كي تُترجِمَ محادثةُ Mini App بالقرارِ نفسِه لا بنسخةٍ ثانية.
   */
  readonly translation: TranslateMessageDependencies;
  /**
   * مُرسِل بوت السائق مكشوف لأن لوحة الإدارة تسلّم رمز الدخول في محادثة المسؤول
   * الخاصة معه — القناة نفسها لا قناة ثانية بمفتاح ثانٍ يُنسى تدويره.
   */
  readonly driverSender: TelegramSender;
  /**
   * `PRD-105` — مخزنُ جلسةِ حوارِ السائق مكشوفٌ لأنَّ إثباتَ الرقمِ يكتبُه البوتُ فيه ويقرؤه
   * `POST /v1/onboarding/driver`. مخزنٌ واحدٌ لا نسخةٌ ثانية: في وضعِ `redis` يكونُ مشتركاً
   * بينَ المثيلات، وفي `memory` مثيلٌ واحدٌ يخدمُ البوتَ والمسارَ معاً.
   */
  readonly driverDialogSessions: SessionStore;
  /**
   * تبعيات دورة غير المشتركين مكشوفة لأن مُشغّل الجوبات واختبارات التكامل
   * تحتاج تشغيل الدورة خارج مسار الـ webhook — وبنفس المحوّلات لا بنسخة موازية.
   */
  readonly negotiation: NegotiationWiring;
  /**
   * `ADR 0286` — منافذُ أعمالِ التفاوضِ للتطبيقِ المصغَّرِ: نفسُ منافذِ الحوارِ
   * (`register/withdraw` · `select/settle/advanceAt`) — لا كاتبَ ثانٍ.
   */
  readonly negotiationApp: {
    readonly claims: ReturnType<typeof createClaimRegistrationPort>;
    readonly rotation: ReturnType<typeof createNegotiationRotationPort>;
  };
  /**
   * عمليات الائتمان والاسترداد والفاتورة والتصحيح مالية إدارية/ويبهوك فقط؛ لا
   * تُوصل لحوار السائق حتى لا يصبح البوت قناة قرار استرداد أو تسوية. لوحة الإدارة
   * ومسار الويبهوك يستعملان هذا المحول الإنتاجي نفسه عند تفعيل واجهتهما.
   */
  readonly financial: SubscriptionWalletRpcPort;
  /**
   * `F16-03` — منفذُ رموزِ التتبُّعِ مكشوفٌ لأنَّ قطعَ الروابطِ منَ اللوحةِ يجبُ
   * أن يمرَّ على **نفسِ** المنفذِ الذي يُلغي به زرُّ الراكبِ — منفذٌ ثانٍ كانَ
   * سيجعلُ للملكيّةِ حاكمَينِ يفترقانِ (القاعدةُ 0.6).
   */
  readonly trackingTokens: TrackingTokenRpcPort;
  /**
   * `F16-02` — منفذُ قراراتِ التذاكرِ مكشوفٌ لأنَّ الإقفالَ الإداريَّ من اللوحةِ
   * يجبُ أن يمرَّ على **نفسِ** المنفذِ الذي تحكُمُ به أزرارُ قروبِ الدعمِ:
   * `resolve_support_ticket` — منفذٌ ثانٍ كان سيجعلُ للحدِّ حكمانِ يفترقانِ (0.6).
   */
  readonly disputeResolutions: SupportResolutionPort;
  /**
   * `DEC-26` — نشرُ بطاقةِ التذكرةِ مكشوفٌ لأنَّ مسارَ الـ API يحتاجُ **نفسَ**
   * `supportCore.card` الذي يستخدمهُ حوارُ البوتِ — لا نسخةً ثانيةً (القاعدةُ 0.6).
   */
  readonly supportCard: PostDisputeCardDependencies;
  /**
   * `F16-01` — السمعةُ مكشوفةٌ لأنَّ سطحَ لوحةِ الإدارةِ يحتاجُ **نفسَ** منفذِ
   * التعليمِ الذي يعلَّمُ بهِ قروبُ الدعمِ (`/flag`) — لا نسخةً ثانيةً تُبنى في
   * نقطةِ التركيبِ (القاعدةُ 0.6).
   */
  readonly reputation: { readonly flags: RatingFlagPort; readonly reader: ReputationReader };
  /**
   * `F2-10` — منفذُ الاستغاثةِ مكشوفٌ لأنَّ مسارَ `POST /v1/safety/sos` يجبُ أن
   * يُقَيِّدَ الحادثَ بـ**نفسِ** المنفذِ الذي يكتبُ به بوتُ الراكبِ وبوتُ السائقِ.
   * وبناؤُ منفذٍ ثانٍ في `index.ts` كانَ سيُنشئُ **حاكمَينِ للاستغاثةِ** يفترقانِ
   * يومَ يتغيَّرُ شرطٌ في أحدِهما (القاعدة 0.6) — وفي الطوارئِ لا يُحتمَلُ حاكمانِ.
   */
  readonly safety: { readonly trigger: { readonly incidents: TriggerSosPort } };
  /**
   * المرحلة ٦ — النقل اللحظي مكشوف لأن مسار SSE يحتاج نفس الناقل الذي ينشر
   * فيه مسار البوت — لا ناقلاً ثانياً يُبنى في `index.ts`. والاختبارات تقرأ منه
   * الجلسات والبراهين بنفس المحوّلات لا بنسخة موازية.
   */
  readonly tracking: TrackingWiring;
  /**
   * `F4-01` — تبعياتُ استقبالِ الموقعِ مكشوفةٌ لأنَّ مسارَ `POST /v1/driver/location`
   * يجبُ أن يكتبَ بـ**نفسِ** المحوّلاتِ التي يكتبُ بها مسارُ البوتِ: نفسِ الدليلِ،
   * ونفسِ سياسةِ المجالِ المقروءةِ من `TRACKING_*`، ونفسِ ناقلِ البثِّ، ونفسِ
   * إعادةِ العرضِ. تركيبُ نسخةٍ ثانيةٍ في `index.ts` كانَ سيجعلُ للنظامِ سياستَي
   * موقعٍ تنزلقُ إحداهما عن الأخرى بلا أن يُخفِقَ اختبارٌ.
   */
  readonly driverLocation: DriverLocationWiring;
  /**
   * `F3-02` — تبعياتُ عروضِ السائقِ مكشوفةٌ لأنَّ مسارَ الرفضِ
   * `POST /v1/driver/offers/:offerId/reject` يجبُ أن يرفضَ بـ**نفسِ** المنفذِ الذي
   * يرفضُ به حوارُ البوتِ: منفذٌ ثانٍ يُبنى في `index.ts` كانَ سيُنشئُ كاتبَينِ
   * لانتقالٍ واحدٍ (القاعدة 0.6)، ولَأمكنَ أن يُصحَّحَ قيدُ `BUG-003` (رفضُ عرضٍ
   * **واحدٍ** بمعرِّفِه لا كلِّ عروضِ السائقِ) في أحدِهما ويبقى الآخرُ يمحو
   * الجولةَ كلَّها بلا أن يُخفِقَ اختبارٌ. والدليلُ **هوَ هوَ** الذي يقرأُ به
   * مسارُ الموقعِ، فتوفُّرُ السائقِ حالةٌ واحدةٌ لا حالتانِ.
   */
  readonly driverOffers: {
    readonly drivers: DriverDirectory;
    readonly decisions: OfferDecisionPort;
  };
  /**
   * `RIDE-NOTICE-01` ثمَّ `WR-15` (ADR 0265) — إخطارُ الراكبِ بطَورِ رحلتِه حينَ يضغطُ
   * السائقُ في التطبيقِ المصغَّرِ: صفٌّ في صندوقِ الصادرِ يُرسلُه العاملُ ببوتِ الراكب.
   */
  readonly riderTripNotice: RiderTripNoticeDeps;
  close(): Promise<void>;
}

export interface TrackingWiring {
  readonly bus: TrackingEventBus;
  readonly sessions: TrackingSessionStore;
  readonly proofs: TrackingProofReader;
  readonly live: LiveTrackingPort;
  /**
   * المُرحِّل نفسه — لا نسخةٌ عنه. يُعرَض لأن عدد البثوث المفتوحة حالةٌ في
   * الذاكرة لا أثر لها في القاعدة، فبلا عرضها لا يستطيع اختبارٌ ولا مقياسُ
   * تشغيلٍ أن يشهد على تسريبٍ فيها إلا بالاستدلال من رسائل تلغرام.
   */
  readonly relay: CustomerLiveRelay | null;
  /**
   * قارئ بطاقة رحلة السائق — يُعرَض لنفس سبب عرض `relay`: بلا عرضه لا يستطيع
   * اختبارٌ أن يشهد على أنّ المفتاحين (معرّف السائق ومعرّف تلغرام) يجيبان بنفس
   * الرحلة، ولا على أنّ سائقاً لا يرى رحلة غيره، إلا بالاستدلال من نصّ رسالة.
   * والاستدلالُ من النصّ يُخفي فرقاً في الاستعلام نفسه.
   */
  readonly tripCards: DriverTripCardReader;
  /**
   * رموزُ التتبّع المُشارَك (§4.2). تُعرَض لأنّ المسارَ العامّ `/track/:token` في
   * `index.ts` يقرأ بها، وحوارُ الراكب يُصدر بها — ومنفذٌ ثانٍ يُبنى في `index.ts`
   * كان سيصير اتصالَ قاعدةٍ ثانياً بمُجمَّعٍ ثانٍ لنفس العمل.
   */
  readonly tokens: TrackingTokenRpcPort;
  /** مُولّدُ الرمز — يُعرَض ليُبدَّل بمُولّدٍ حتميّ في الاختبار. */
  readonly tokenMint: TrackingTokenMintPort;
}

export interface NegotiationWiring {
  readonly snapshots: ReturnType<typeof createNegotiationSnapshotReader>;
  readonly rotate: RotateNegotiationDependencies;
  readonly republish: RepublishDependencies;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  readonly publish: PublishToUnsubscribedGroupDependencies;
  readonly clock: typeof systemClock;
}

export interface DriverLocationWiring {
  /** قراءةُ صفِّ السائقِ بمعرّفِ تيليجرام — لا كتابةَ فيه من هذا الطريقِ. */
  readonly drivers: DriverDirectory;
  readonly ingest: UpdateDriverLocationDeps;
}

export interface ContainerOverrides {
  readonly driverSender?: TelegramSender;
  readonly riderSender?: TelegramSender;
  /**
   * بوّابةُ دخولِ القروبِ البديلةُ (`PD-001` · `ADR 0157`). تُحقن في الاختبارِ
   * ببوّابةٍ تلتقطُ القرارَ (قبولٌ/رفضٌ/مراسلةٌ) بلا شبكةِ تلغرامَ، فيُثبَتُ
   * حكمُ البوّابةِ كاملاً على قاعدةٍ حقيقيّةٍ. والغيابُ يبني البوّابةَ الفعليّةَ
   * (تلقائيّةَ الاختبارِ الذاتيّ عبرَ `getMe` لا الإنتاجِ وحده).
   */
  readonly driverJoinGate?: TelegramGroupGatePort;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * مزوّد ترجمة بديل. يُحقن في الاختبار بمزوّد حتمي بلا شبكة، فيُثبَت مسار
   * الترجمة كاملاً في CI بلا اعتماد على خدمة خارجية ولا على منفذ إنترنت.
   */
  readonly translationProvider?: TranslationProvider | null;
  /**
   * عميل Redis بديل. يُحقن في الاختبار بعميل في الذاكرة، فيُثبَت مسار الجلسات
   * على Redis كاملاً في CI بلا خادم Redis ولا منفذ إنترنت.
   */
  readonly redis?: RedisClient;
  /**
   * المرحلة ٦ — قناة الموقع الحيّ البديلة. تُحقن في الاختبار بقناةٍ تلتقط البثّ،
   * فيُثبَت مسار الدفع إلى العميل كاملاً على قاعدة حقيقية بلا شبكة تلغرام.
   */
  readonly liveLocationChannel?: LiveLocationChannel;
  /**
   * مزوّد الدفع المُركَّب في نقطة الدخول — البيع الذاتي للاشتراك من بوت السائق.
   *
   * يُمرَّر جاهزاً ولا يُبنى هنا عن قصد: بناؤه هنا يوجب قراءة مفاتيح المزوّد
   * داخل الحاوية، فتصير أسرارُ الدفع في مسارٍ تستورده اختبارات البوت كلّها.
   * وغيابه يعني أنّ زرّ «اشترك الآن» لا يظهر، لا أنّه يظهر ثمّ يفشل.
   */
  readonly paymentProvider?: PaymentProvider | null;
  /**
   * سجلّ المقاييس. يُمرَّر من نقطة الدخول فتُلَفّ به منافذُ التوزيع الحقيقية:
   * فتح جولة العروض وقبولها. والقياس بلفّ المنفذ لا بحقنٍ في المنطق — الدومين
   * لا يعرف أنّه مقيس، ومصدرُ العدّ نتيجةُ RPC لا رسالةُ تلغرام التي قد تفشل بعدها.
   */
  readonly metrics?: OperationalMetrics;
}

/**
 * التركيب الحقيقي من الإعدادات: اتصال قاعدة واحد، ومحوّلات حقيقية لكل منفذ.
 * المُرسِلان قابلان للاستبدال ليُختبر المسار كاملاً بلا شبكة تلغرام.
 */
/**
 * حدُّ المحاولةِ الفوريّة. القيمةُ القديمةُ (١٠) كان مبررُها أنّ الشوطَ كان يجري
 * داخل معالجةِ تحديثِ تلغرامَ نفسِه فخيفَ تجاوزُ مهلةِ الـwebhook — وقد زالَ هذا
 * المبررُ كليًّا منذَ صارَ الشوطُ مجدوَلًا في الخلفيةِ (`immediate-redispatch.ts`:
 * جدولةٌ خارجَ مسارِ الطلبِ + خفضُ ثانيتينَ + مانعُ تداخلٍ لكلِّ مدينةٍ)، فالردُّ
 * لا ينتظرُه أصلًا. والقياسُ (موجةُ 250 · 2026-10-17): ٩٣ شوطًا فوريًّا بلغت
 * الحدَّ العشرةَ كلُّها (متوسطُ ٩٫٤ طلباً للشوط) بينما وصولُ الطلباتِ ٧٫٣/ث —
 * فصارَ الحدُّ نفسُه سقفَ خدمةٍ (≈٥/ث) دونَه يتجاوزُ انتظارُ العرضِ ثلاثينَ ثانيةً
 * ويجوّعُ مَن أُهدرت دورتُه الأولى. القيمةُ الجديدةُ (٥٠) توازي حدَّ العاملِ
 * الدوريّ، ويبقى الخفضُ ومانعُ التداخلِ حمايةَ التزاحمِ، والأرضيّةُ الدوريّةُ
 * الضمانةَ المعلنةَ.
 */
const IMMEDIATE_REDISPATCH_LIMIT = 50;

/**
 * حصّةُ مزوّدِ التوجيهِ المُعلَنةُ (`REQ-09` · `ADR 0190`). على `Redis` متى وُجِدَ:
 * الحدُّ حدُّ **الحسابِ**، فحدٌّ في ذاكرةِ كلِّ نسخةٍ يضربُه في عددِ النسخِ. وسياسةُ
 * عجزِ `Redis` سياسةُ الحدِّ القائمةِ (يُسمَحُ ويُسجَّلُ) — والمزوّدُ يبقى يردُّ `429`
 * فلا يُخفى التجاوزُ.
 */
function routingQuota(
  limit: NonNullable<AppConfig["routingRateLimit"]>,
  redis: RedisClient | null,
  log: (message: string, meta: Record<string, unknown>) => void,
): RoutingQuota {
  const options = { limit: limit.calls, windowSeconds: limit.windowSeconds };
  return redis === null
    ? createMemoryRateLimiter(options)
    : createRedisRateLimiter(redis, {
        ...options,
        onFailure: (detail) => log("routing.quota_redis_failed", { detail }),
      });
}

export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const log = overrides.log ?? (() => {});
  /**
   * `F11-04` · `ADR 0197` — **مهلةُ استعلامٍ من العميلِ**: بطءٌ على جدولٍ واحدٍ كانَ يحتجزُ
   * اتّصالاتِ التجمُّعِ الخمسةَ فيقفُ كلُّ مسارٍ طولَ البطءِ. والإلغاءُ مرصودٌ لا صامتٌ.
   */
  const sql = createSql({
    connectionString: config.databaseUrl,
    // اسمُ الدورِ في `pg_stat_activity.application_name`: يُنسَبُ به CPU كلِّ خادمٍ خلفيٍّ
    // إلى تجمُّعِه (LOAD-01 · الدفعةُ الحاديةَ عشرة)، ولا يغيّرُ سلوكاً.
    applicationName: "ceezr:gatewayRequest",
    queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayRequest,
    onQueryDeadline: ({ deadlineMs }) =>
      log("db.query_deadline_exceeded", { pool: "gatewayRequest", deadlineMs }),
  });

  // مخزنان منفصلان: حالة حوار السائق لا تخصّ العميل، ودمجهما كان سيخلط خطوتين
  // لشخص واحد يستخدم البوتين بمعرّف تلغرام واحد. الفصل في الذاكرة بخريطتين،
  // وفي Redis بفضاء مفتاح لكل بوت — نفس الضمان بآليتين (ADR 0011).
  const redis =
    overrides.redis ??
    (config.sessionStore === "redis"
      ? createUpstashRedis({ url: config.redisUrl, token: config.redisToken })
      : null);

  /**
   * صمودُ الصادرِ يُبنى **قبلَ** المُرسِلِ لأنَّه يلفُّه (`CAP-002`/`F6-04`). ودلوُ
   * الحدِّ على Redis متى وُجِدَ: حدُّ Bot API حدٌّ على البوتِ لا على العمليةِ،
   * فدلوٌ في ذاكرةِ كلِّ نسخةٍ يضربُ الحدَّ في عددِ النسخِ ويستدعي `429`.
   */
  const outboundResilience = createOutboundResilience({ redis, log });

  // ناقلُ الصادر يُختار من الضبط، والقياس يلفّه بعد الاختيار لا قبله. والترتيب
  // مقصود: العدّاد يسري على الناقل الحقيقي في الإنتاج أيضاً، فليس أداةَ قياسٍ
  // مُلحقةً بل رؤيةٌ كانت غائبةً عن النظام — لم يكن يرى ما يخرج منه من رسائل.
  // و`overrides` يتقدّم على الاثنين: الاختباراتُ تمرّر مُرسِلاً ملتقطاً وتتحقّق
  // منه هي، فلفّه بعدّادٍ كان سيزيد وسيطاً لا يقرأه أحد.
  const buildSender = (bot: "driver" | "rider", token: string): TelegramSender => {
    const base =
      config.telegramTransport === "silent" ? silentTelegramSender() : grammyTelegramSender(token);
    const measured =
      overrides.metrics === undefined ? base : measuredTelegramSender(base, bot, overrides.metrics);
    // غلافُ الصمودِ **فوقَ** القياسِ لا تحتَه (`CAP-002`): العدّادُ يجبُ أن يرى
    // النداءَ الفعليَّ الواصلَ إلى تيليجرام — كلَّ إعادةِ محاولةٍ على حِدَةٍ — لا
    // نداءً منطقيّاً واحداً يُخفي خمسَ محاولاتٍ. ولو لُفَّ القياسُ فوقَ الصمودِ
    // لأظهرَ الرسمُ البيانيُّ صادراً هادئاً بينما البوتُ يضربُ حدَّه فعلاً.
    // و`silent` لا يُستثنى: الاختبارُ يجبُ أن يسلكَ المسارَ الذي يسلكُه الإنتاجُ.
    // CAP-RUN-20261015 / D6: دلوٌ عالميٌّ لكلِّ رمزِ بوت — حدُّ Bot API لكلِّ بوتٍ على حِدَة.
    const resilient = withOutboundResilience(measured, {
      ...outboundResilience.options,
      bucketKey: outboundBucketKeyOfToken(token),
    });
    // `ADR 0213`: في وضعِ التطبيقِ كلُّ رسالةٍ خاصّةٍ بابٌ إليه — زرٌّ واحدٌ يُلحَقُ عند المُرسِلِ
    // لا في كلِّ مُخطِرٍ. الغلافُ **فوقَ** الصمودِ: إعادةُ المحاولةِ تُعيدُ الرسالةَ نفسَها بزرِّها.
    return config.botSurfaceMode === "miniapp" && config.miniAppUrl !== null
      ? withMiniAppEntry(resilient, { miniAppUrl: config.miniAppUrl, label: MINIAPP_ENTRY_LABEL })
      : resilient;
  };
  const driverSender = overrides.driverSender ?? buildSender("driver", config.driverBotToken);
  const riderSender = overrides.riderSender ?? buildSender("rider", config.riderBotToken);

  const onSessionFailure = (failure: {
    readonly kind: string;
    readonly detail: string;
    readonly operation: string;
  }): void => {
    log("session.redis_failed", failure);
  };

  const makeSessions = (namespace: "driver" | "rider"): SessionStore =>
    config.sessionStore === "redis" && redis !== null
      ? createRedisSessionStore(redis, namespace, { onFailure: onSessionFailure })
      : createMemorySessionStore(systemClock);

  const driverSessions = makeSessions("driver");
  const riderSessions = makeSessions("rider");
  log("session.store_selected", { store: config.sessionStore });

  const settings = createSettingsRepository(sql);
  const financial = createSubscriptionWalletRpc(sql);
  const cities = createCityDirectory(sql);
  const drivers = createDriverDirectory(sql);
  const riders = createRiderDirectory(sql);
  const orders = createOrderRepository(sql);
  const orderWriter = createOrderWriter(sql);
  const rides = createRideRequestCommand(sql);
  // D-01: البوتُ يحملُ الإلغاءَ وحدَه لا الإنشاءَ — نُمرِّرُ غلافاً يكشفُ `cancelByRider` فقط.
  const orderCancellation: OrderCancellationPort = {
    cancelByRider: (orderId, riderId) => orderWriter.cancelByRider(orderId, riderId),
  };
  const offers = createOfferRepository(sql);
  const candidates = createDriverCandidateRepository(sql);

  const matching = {
    orders,
    offers,
    candidates,
    settings,
    offerWriter:
      overrides.metrics === undefined
        ? createOfferWriter(sql)
        : instrumentOfferWriter(createOfferWriter(sql), overrides.metrics),
    clock: systemClock,
    // يوصل `dispatch.no_eligible_driver` وتعداد أسباب الرفض إلى سجلّ الإنتاج.
    // دونه يبقى التشخيص حبيساً في قيمة راجعة يُسقطها منادي بوت العميل.
    log,
  };

  // مسار قروب غير المشتركين: مُرسِل السائق هو من ينشر في القروب، لأن أزراره
  // يضغطها سائقون ويجب أن تصل ردودها لبوت السائق لا بوت العميل.
  const driverOut = asOutboundSender(driverSender);
  const riderOut = asOutboundSender(riderSender);
  const rotationPort = createNegotiationRotationPort(sql);

  // الترجمة المتبادلة (المرحلة 2.6). الذاكرة المؤقتة في العملية الآن، وتنتقل إلى
  // Redis في القسم 5 بتبديل سطر واحد: المنفذ نفسه بتنفيذ آخر.
  const translationProvider =
    overrides.translationProvider !== undefined
      ? overrides.translationProvider
      : createTranslationProvider({
          provider: config.translationProvider,
          ...(config.translationApiKey === null ? {} : { apiKey: config.translationApiKey }),
          ...(config.translationContactEmail === null
            ? {}
            : { contactEmail: config.translationContactEmail }),
        });

  const translation = {
    provider: translationProvider,
    cache: createMemoryTranslationCache(systemClock),
    onFailure: (failure: TranslationFailure) => {
      // فشل المزوّد يُسجَّل ولا يُوقف الرسالة: الرسالة تصل بلغتها الأصلية.
      log("translation.failed", {
        kind: failure.kind,
        provider: failure.provider,
        detail: failure.detail,
        retryable: failure.retryable,
      });
    },
  };

  const languagePreferences = createLanguagePreferencePort(sql);

  /**
   * حوار اللغة لكل بوت بمخزن جلسته هو. الجلسة تُحدَّث بعد نجاح الكتابة في القاعدة
   * فقط: لو حدّثناها قبل ذلك لتغيّرت لغة الرسائل مع بقاء القاعدة على القديمة،
   * فيعود المستخدم بعد انتهاء الجلسة إلى لغة لم يخترها.
   */
  const languageDeps = (sessions: SessionStore) => ({
    preferences: languagePreferences,
    rememberLanguage: async (telegramId: string, language: string): Promise<void> => {
      const stored = await sessions.load(telegramId);
      if (!stored.ok || stored.value === null) return;
      await sessions.save(telegramId, { ...stored.value, language });
    },
  });

  const relayDeps = {
    lookup: createActiveNegotiationLookup(sql),
    sender: createTelegramRelaySender(driverOut, riderOut, translation),
  };

  // إخطاراتُ الدورةِ تُودَعُ في صندوقِ الصادرِ داخلَ معاملةِ الدالّةِ الذرّيةِ
  // (BUG-004)، والعاملُ الخلفيُّ هو من يُسلِّمُها. فلا مُخطِرَ في تبعياتِ البوابةِ.
  const claimDeps = {
    claims: createClaimRegistrationPort(sql),
  };

  const rotationDeps = {
    rotation: rotationPort,
  };

  /**
   * `ADR 0286` — هويّةُ بوتِ السائقينَ لمرةٍ واحدةٍ (`getMe` مُخزَّنةً): زرُّ بطاقةِ القروبِ
   * رابطُ `startapp` لا زرَّ `web_app` (فهو للمحادثاتِ الخاصةِ وحدَها)، والهويّةُ من
   * البوتِ نفسِهِ لا من إعدادٍ يدويٍّ يتقادمُ بصمتٍ. وتعذُّرُها لا يُسقِطُ البطاقةَ:
   * يبقى زرُّ المطالبةِ القديمَ (وضعُ `legacy` المعزولُ) لا بلا زرٍّ.
   */
  const driverBotUsername = botUsernameProvider(config.driverBotToken);
  const publishDeps = {
    orders,
    notes: createOrderNotesReader(sql),
    cycles: createUnsubscribedCyclePort(sql),
    publisher: createUnsubscribedGroupPublisher(asIdentifyingSender(driverSender), {
      driverBotUsername,
    }),
  };

  const escalationDeps = {
    orders,
    escalation: createEscalationPort(sql),
    publisher: createEscalationGroupPublisher(asIdentifyingSender(driverSender)),
  };

  /**
   * مسار الدعم: بطاقة التذكرة تُنشر بمُرسِل بوت السائق لأن أزرارها يضغطها فريق الدعم
   * في قروب مرتبط ببوت السائق، وردّ الضغطة يجب أن يعود إلى البوت الذي نشرها.
   * التبليغ الفردي يذهب بمُرسِل البوت نفسه الذي يخاطبه صاحب التذكرة.
   */
  const supportSender = asSupportSender(driverSender);
  const ticketContext = createSupportTicketContextReader(sql);

  /**
   * طبقة الذكاء الاصطناعي المعزولة — **معطّلة ما لم يُضبط `AGENT_CORE_ENABLED=true`**.
   * حين تُعطّل يُحذف `advice` من الاعتمادات أصلاً، فيعود مسار الدعم إلى ما كان
   * عليه حرفاً بحرف قبل وجود هذه الطبقة — لا فرعٌ مُعطّل بل **غيابٌ تام**.
   */
  const agentCore = createAgentCore({
    log: createStructuredLogger({ service: "agent-core" }),
  });
  // مخزن القياس يُبنى مع الطبقة ويُطفأ معها: بلا طبقة لا قرارات تُقاس، وزرٌّ لا
  // يُنشَر أصلاً لا يحتاج مستقبِلاً. وربطهما بشرطٍ واحد يمنع نصفاً مفعَّلاً بلا نصفه.
  const measurement = agentCore.enabled ? createAgentMeasurementPort(sql) : undefined;
  const advice =
    agentCore.enabled && measurement !== undefined
      ? {
          context: ticketContext,
          advisor: createTicketAdvisor(agentCore),
          publisher: createSupportAdvicePublisher(supportSender),
          measurement,
        }
      : undefined;

  const supportCore = {
    open: { tickets: createSupportTicketPort(sql) },
    card: {
      context: ticketContext,
      publisher: createSupportCardPublisher(supportSender),
      recorder: createSupportCardRecorder(sql),
    },
    claims: { claims: createSupportClaimPort(sql) },
    // `exactOptionalPropertyTypes`: الحقل يُنشر عند وجوده ولا يُضاف `undefined` صراحةً.
    ...(advice === undefined ? {} : { advice }),
    ...(measurement === undefined ? {} : { measurement }),
  };
  const resolutionPort = createSupportResolutionPort(sql);
  /**
   * `F16-01` — قارئُ السمعةِ ومنفذُ التعليمِ: نفسُ المحوّلاتِ للبوتَينِ وللوحةِ
   * الإدارةِ لا نسخٌ ثانويةٌ (القاعدةُ 0.6 — حاكمٌ واحدٌ لكلِّ قرارٍ).
   */
  const reputationReader = createReputationReader(sql);
  const ratingFlagPort = createRatingFlagPort(sql);
  // SOS يكتب الحادث وoutbox في RPC ذرّي؛ العامل، لا webhook، هو من يرسل البطاقة.
  // المنفذ نفسه يُمرَّر لبوت العميل والسائق حتى لا يوجد مساران مختلفان للطوارئ.
  const safety = {
    trigger: { incidents: createTriggerSosPort(sql) },
    resolutions: { incidents: createSafetyResolutionPort(sql) },
  };

  const driverSupport: SupportDialogDependencies = {
    ...supportCore,
    sessions: driverSessions,
    // `F16-01` — منفذُ التعليمِ لحوارِ الدعمِ: `/flag` من القروبِ — نفسُ المنفذِ
    // الذي تعلَّمُ بهِ اللوحةُ فلا حاكمانِ للفعلِ الواحدِ.
    flags: ratingFlagPort,
    // تبليغُ صاحبِ التذكرةِ لا يقعُ في هذا المسارِ: يُودَعُ في صندوقِ الصادرِ داخلَ
    // معاملةِ resolve_support_ticket ويُرسَلُ من عاملِ التسليمِ (BUG-004).
    resolutions: { resolutions: resolutionPort },
  };

  const riderSupport: SupportDialogDependencies = {
    ...supportCore,
    sessions: riderSessions,
    resolutions: { resolutions: resolutionPort },
  };

  /**
   * التقييم المتبادل: منفذا الرحلة والتقييم واحدان للبوتين، فالسلوك واحد في الاتجاهين.
   * بوت العميل لا يحتاج منفذ دورة الرحلة لأن البدء والإنهاء بيد السائق وحده.
   */
  const ratingPort = createRatingPort(sql);
  const lifecyclePort = createRideLifecyclePort(sql);

  /**
   * المرحلة ٦ — النقل اللحظي. التركيب هنا لا داخل الحوار: الناقل **واحد**
   * للعملية كلّها، ومن بناه في موضعين صار له مشتركون لا يرون أحداث بعضهم.
   *
   * `SCL-004` — حين يكونُ Redisُ حاضراً يُغلَّفُ الناقلُ المحليُّ بطبقةِ Streams
   * فيصيرُ الحدثُ مرئيّاً عبرَ النسخِ (`XADD`/`XREAD` على عميلِ REST نفسِه، بلا
   * مقبسٍ دائمٍ — ADR 0016/0058). والماسحُ يبدأُ هنا ويُوقَفُ عندَ الإغلاقِ.
   */
  const localTrackingBus = createTrackingEventBus(log);
  const distributedTrackingBus =
    redis !== null
      ? createRedisStreamTrackingEventBus({
          local: localTrackingBus,
          redis,
          streamKey: TRACKING_EVENT_STREAM_KEY,
          instanceId: crypto.randomUUID(),
          pollMs: DEFAULT_POLL_MS,
        })
      : null;
  if (distributedTrackingBus !== null) {
    distributedTrackingBus.start();
  }
  const trackingBus: TrackingEventBus = distributedTrackingBus ?? localTrackingBus;
  const trackingSessions = createTrackingSessionRepository(sql);
  const trackingProofs = createTrackingProofReader(sql);
  const trackingTokenMint = createTrackingTokenMint();

  /**
   * قناة الموقع الحيّ على **بوت العميل**: الخريطة تظهر في محادثة العميل،
   * وإرسالها من بوت السائق يعني محادثةً لا يفتحها العميل أصلاً (وترفضها تلغرام
   * لمن لم يبدأ المحادثة). وهو نفس منطق `counterpartNotifier` القائم.
   */
  /**
   * `F4-07` — مُرحِّلُ الموقعِ الحيِّ عبر تلغرام احتياطٌ لا مسارٌ رئيسيٌّ.
   *
   * كانَ المُرحِّلُ يُنشَأُ ويُشترِكُ في كلِّ تركيبٍ. والآنَ صارَ يُنشَأُ ويُشترِكُ
   * فقط إن كان `liveLocationFallbackEnabled` مُفعَّلًا. وخريطةُ `tripId→messageId`
   * (مخزنُ البثِّ) لا تُنشَأُ إلّا معه. فالإنتاجُ الافتراضيُّ بلا مُرحِّلَ ولا خريطة:
   * قناةُ Socket.IO وحدها.
   *
   * والكودُ **لم يُحذَفْ** (القاعدة ح-١): `createCustomerLiveRelay` و`LiveBroadcastStore`
   * باقيان كاحتياطٍ يُفعَّلُ بصراحةٍ لا افتراضًا.
   */
  const customerRelay =
    config.liveLocationFallbackEnabled || overrides.liveLocationChannel !== undefined
      ? createCustomerLiveRelay({
          channel: overrides.liveLocationChannel ?? grammyLiveLocationChannel(config.riderBotToken),
          customers: { resolve: (tripId) => trackingProofs.customerOf(tripId) },
          clock: systemClock,
          livePeriodSeconds: Math.min(
            DEFAULT_SESSION_POLICY.maxSessionSeconds,
            TELEGRAM_MAX_LIVE_PERIOD_SECONDS,
          ),
          log,
          ...(redis ? { store: createRedisLiveBroadcastStore(redis) } : {}),
          newClaimToken: () => crypto.randomUUID(),
        })
      : null;

  if (customerRelay !== null) {
    trackingBus.subscribe(
      { kind: "operations", scope: { kind: "all_cities" } },
      { deliver: (event) => customerRelay.handle(event) },
    );
  }

  /**
   * المرحلة ١٢ — قارئٌ واحد يُمرَّر إلى حوار السائق وحوار التقييم: نسختان منه
   * لا تُنتجان بيانات مختلفة (كلتاهما تقرأ `orders`)، لكنّهما موضعان لتعديل
   * الاستعلام يُنسى أحدهما. والمصدر واحد فالقارئ واحد.
   */
  const driverTripCards = createDriverTripCardReader(sql);

  /**
   * المرحلة ١٥ — مزوّد التوجيه يُبنى من الضبط هنا، وهذا **أولُ موضعٍ يُبنى
   * فيه في المستودع كلّه خارج الاختبارات**.
   *
   * وقياسُ ما كان قبله: `createOsrmProvider` لا يُستدعى إلاّ في ثلاثة ملفّات
   * اختبار، و`RoutingProvider` لا يُذكر خارج `packages/maps` ألبتّة، و`OSRM_BASE_URL`
   * مُعلَنٌ في `render.yaml` ولا يُقرأ في الضبط (الخطر R-28). فكان المحرّك
   * **غيرَ قابلٍ للبناء في الإنتاج** لا «موجوداً غيرَ مفعّل».
   *
   * و`null` عند `none` لا مزوّدٌ صوريٌّ يُجيب أرقاماً: مزوّدٌ يكذب أخطر من غيابٍ
   * موصوف. والضبط يرفض `osrm` بلا عنوانٍ عند الإقلاع، فالفحص هنا تضييقُ نوعٍ
   * لا منطقٌ ثانٍ للقرار.
   */
  const routing: RoutingProvider | null =
    config.routingProvider === "osrm" && config.osrmBaseUrl !== null
      ? new CachedRoutingProvider(
          createOsrmProvider({
            baseUrl: config.osrmBaseUrl,
            // `REQ-09` · `ADR 0190`: الحصّةُ تحتَ الذاكرةِ المؤقّتةِ فلا تستهلكُها إصابةٌ،
            // وعلى `Redis` متى وُجِدَ لأنَّ الحدَّ حدُّ الحسابِ لا النسخةِ.
            ...(config.routingRateLimit === null
              ? {}
              : { quota: routingQuota(config.routingRateLimit, redis, log) }),
          }),
        )
      : null;

  const liveTracking = createLiveTracking({
    sessions: trackingSessions,
    publisher: trackingBus,
    trips: createActiveTripReader(sql),
    duty: createDriverDutyReader(sql),
    /**
     * القارئُ الموحّد: يقرأُ بوابةَ الخدمةِ والرحلةَ النشطةَ في استعلامٍ واحدٍ
     * في مسارِ `POST /v1/driver/location` — فلا تعبرَ الإصلاحةُ الواحدةُ طابورَ
     * مجموعةِ الطلباتِ ثلاثَ مراتٍ كما كانت (بوابةُ الخدمةِ ثمّ الرحلةُ للجلسةِ
     * ثمّ الرحلةُ للإرفاق). مسارٌ ساخنٌ بلا شرطِ منتجٍ يتغيّر: نفسُ الجداولِ
     * ونفسُ الأحكامِ ولقطةٌ واحدةٌ أبعدُ عن التمزّق.
     */
    dutyAndTrip: createDriverDutyAndTripReader(sql),
    clock: systemClock,
    log,
  });

  /**
   * المرحلة ١٤ — المحاولةُ الفوريّة لإعادة عرض الطلبات الباحثة عند صيرورة السائق
   * قابلاً للإسناد. تُبنى على **نفس** `matching` التي يستخدمها بوت الراكب عند إنشاء
   * الطلب، فلا يوجد في النظام مسارُ بثٍّ ثانٍ بسلوكٍ ثانٍ.
   *
   * والإخفاقُ يُبتلَع عن قصدٍ ويُسجَّل: السائقُ أرسل موقعَه ونجحت كتابتُه، فإخفاقُ
   * محاولةِ إعادةِ العرض لا يجوز أن يُظهر له «عطلٌ تقنيّ» عن عملٍ نجح — والأرضيّةُ
   * الدوريّة في العامل تُدرك ما فات بعد ثوانٍ.
   */
  /**
   * `LOAD-01` (الدفعةُ الرابعةُ) — إعادةُ العرضِ الفوريّةُ **تُجدوَلُ ولا تُنتظرُ
   * في مسارِ الطلبِ**: أولُ موقعٍ لسائقٍ متاحٍ كانَ يحجبُ ردَّ `POST
   * /v1/driver/location` حتى تكتملَ مطابقةُ طلباتِ المدينةِ (قيسَ: وسيطُ 10.4ث
   * وأقصى 17.9ث تحتَ 50 متزامنًا فماتتْ مهلةُ العميلِ 15ث) — والجدولةُ الخلفيّةُ
   * المخفوضةُ للمدينةِ (ثانيتانِ + مانعُ تداخلٍ) في `background/immediate-redispatch.ts`
   * تُبقي الاستجابةَ للكتابةِ والبثِّ وحدهما، والدوريّةَ (20ث) أرضًا صلبةً.
   */
  // `LOAD-01 · P4` — أثرٌ تشخيصيٌّ اختياريٌّ (`DISPATCH_TRACE_FILE`)؛ غيابُه = المسارُ الأصلُ حرفيّاً.
  const dispatchTrace = createDispatchTrace({ file: process.env.DISPATCH_TRACE_FILE, sql });
  /**
   * `LOAD-01 · P4` · `ADR 0289` — **شوطُ البثِّ الفوريِّ على اتّصالِه المُعلَنِ** (`gatewayDispatch`)
   * لا على تجمُّعِ الطلبِ. الشوطُ تسلسليٌّ لكلِّ مدينةٍ، فطاقتُه = 1 ÷ مجموعِ رحلاتِ الطلبِ الواحدِ،
   * وكلُّ رحلةٍ على تجمُّعِ الطلبِ كانت تنتظرُ اتّصالاً خلفَ حركةِ الراكبِ والسائقِ. تجربةُ العزلِ
   * بمتغيّرٍ واحدٍ (`b9-isoPool1-500`): انتظارُ ما قبلَ أوّلِ معالجةٍ p95 من ~35ث إلى ~3ث.
   * المنافذُ هي منافذُ `matching` نفسُها مبنيّةً على هذا الاتّصالِ (والعدّادُ على كاتبِ العروضِ
   * باقٍ)، فلا يتغيّرُ معنى عرضٍ ولا جولةٍ: الذرّيّةُ في `open_offer_round` و`driver_accept_offer`.
   */
  const dispatchSql = createSql({
    connectionString: config.databaseUrl,
    max: DB_POOL_MAX.gatewayDispatch,
    applicationName: "ceezr:gatewayDispatch",
    queryDeadlineMs: DB_QUERY_DEADLINE_MS.gatewayDispatch,
    onQueryDeadline: ({ deadlineMs }) =>
      log("db.query_deadline_exceeded", { pool: "gatewayDispatch", deadlineMs }),
  });
  const immediateMatching = {
    ...matching,
    orders: createOrderRepository(dispatchSql),
    offers: createOfferRepository(dispatchSql),
    candidates: createDriverCandidateRepository(dispatchSql),
    settings: createSettingsRepository(dispatchSql),
    offerWriter:
      overrides.metrics === undefined
        ? createOfferWriter(dispatchSql)
        : instrumentOfferWriter(createOfferWriter(dispatchSql), overrides.metrics),
  };
  const immediateRedispatchScheduler = createImmediateRedispatchScheduler({
    run: async (cityId) => {
      const finder = createSearchingOrderFinder(dispatchSql);
      const pass = dispatchTrace?.beginPass(cityId, finder, immediateMatching) ?? null;
      const report = await redispatchSearchingOrders(cityId, {
        finder: pass?.finder ?? finder,
        broadcast: pass?.broadcast ?? immediateMatching,
        limit: IMMEDIATE_REDISPATCH_LIMIT,
        ...(pass ? { aroundOrder: pass.aroundOrder } : {}),
        log,
      });
      pass?.end(report);
      if (!report.ok) {
        log("redispatch.immediate_failed", { cityId, detail: report.error.detail });
        return;
      }
      // امتلأَ الحدُّ وتقدّمَ ⇒ بقيَ مستحقٌّ على الأرجحِ: شوطٌ لاحقٌ واحدٌ بعدَ النافذةِ.
      return {
        saturated:
          report.value.examined >= IMMEDIATE_REDISPATCH_LIMIT &&
          report.value.rebroadcast.length > 0,
      };
    },
    debounceMs: IMMEDIATE_REDISPATCH_DEBOUNCE_MS,
    now: () => Date.now(),
    schedule: (fn) => setTimeout(fn, 0),
    // ربطُ قرارِ الجدولةِ بأثرِ التشخيصِ: لحظةُ قبولِ المحفّزِ تُسجّلُ فتُربطُ ببدءِ الشوطِ.
    ...(dispatchTrace ? { onTrigger: dispatchTrace.onTrigger } : {}),
    log,
  });

  const redispatchDeps = {
    /**
     * `LOAD-01` — جدولةٌ لا حجبٌ: يعودُ فورًا، والشوطُ الخلفيُّ المخفوضُ للمدينةِ
     * (المعرَّفُ أعلاه) هوَ الذي يعملُ. عقدُ الخطوةِ الخامسةِ في حالةِ الاستخدامِ
     * («إعادةُ العرضِ بعدَ الكتابةِ») قائمٌ — لكنهُ غيرُ حاجبٍ للردِّ.
     */
    onDriverBecameDispatchable: async (cityId: CityId): Promise<void> => {
      dispatchTrace?.onTrigger(cityId, "accepted");
      immediateRedispatchScheduler.trigger(cityId);
    },
  };

  /**
   * §4.3 — حدود التتبّع تُحسَب مرّةً واحدة من الضبط وتُمرَّر إلى المسار الحيّ.
   * قبل هذا كان `driver-dialog` يستدعي `DEFAULT_GPS_POLICY` مرمَّزاً، فكلّ
   * `TRACKING_*` في `render.yaml` حبرٌ على ورق. واختبارُ الربط في
   * `tests/unit/tracking-config-wiring.test.ts` يمنع رجوع هذا صامتاً.
   */
  const gpsPolicy = resolveGpsPolicy(config.tracking);

  /**
   * `F4-02` — الحالةُ الساخنةُ المشتركةُ لموقعِ السائقِ. تُبنى **مرّةً واحدةً**
   * للعمليّةِ كلّها لا في موضعَينِ: من بناها مرّتَينِ صارَ له ذاكرتانِ للأرقامِ
   * الأربعةِ تنقضي إحداهما قبلَ الأخرى، فيقرأُ مسارُ HTTP سقفاً وحوارُ البوتِ
   * سقفاً آخرَ للحدِّ نفسِه.
   *
   * وبلا `Redis` تكونُ `null` — وذلكَ يعني نسقَ `F4-01` بحرفِه: كتابةٌ مشروطةٌ
   * لكلِّ نبضةٍ. ولا يسقطُ استقبالُ الموقعِ لغيابِ مخزنٍ ساخنٍ.
   */
  const driverLocationHotState =
    redis !== null
      ? createRedisDriverLocationHotState({
          redis,
          settings,
          clock: systemClock,
          onFailure: (detail) => log("driver_location.hot_state_failed", detail),
        })
      : null;

  /**
   * `F4-05` — رموزُ التتبّعِ العامّةُ تقرأُ الموقعَ من الحالةِ الساخنةِ لا من
   * القاعدةِ كلَّ خمسِ ثوانٍ. ولا يسقطُ غيابُ `Redis`: القاعدةُ تظلُّ الأرضيّةَ.
   */
  const trackingTokens = createTrackingTokenRpc(sql, {
    ...(driverLocationHotState === null ? {} : { hotStateReader: driverLocationHotState }),
    clock: systemClock,
  });

  /**
   * أثرُ التدهوّرِ: يُسجَّلُ ولا يُبتلَعُ. والسائقُ لا يُخبَرُ بشيءٍ — موقعُه كُتِبَ
   * فعلاً في القاعدةِ، والذي سقطَ هوَ **التجميعُ** لا الحفظُ. ورسالةُ عطلٍ عن
   * عملٍ نجحَ أسوأُ من صمتٍ عن تدهوّرٍ مُسجَّلٍ.
   */
  const onHotStateDegraded = (detail: {
    readonly driverId: string;
    readonly cityId: string;
    readonly reason: string;
  }): void => {
    log("driver_location.hot_state_degraded", detail);
  };

  /**
   * `F3-02` — **منفذٌ واحدٌ لرفضِ العرضِ** يتقاسمُه حوارُ البوتِ ومسارُ التطبيقِ
   * المصغَّرِ: نسختانِ من محوِّلٍ واحدٍ ليستا عطباً اليومَ ولكنَّهما موضِعا تعديلٍ
   * غداً، والتعديلُ يقعُ في أحدِهما.
   */
  const offerDecisions = createOfferDecisionPort(sql);

  /**
   * `WR-15` (ADR 0265) — منفذُ إيداعِ إخطاراتِ الطورِ للراكب، واحدٌ لكلِّ المسارات:
   * Mini App وأزرارُ بوتِ السائق. المفتاحُ `rider_trip:<order>:<event>` يمنعُ التكرار.
   */
  const riderTripSignal: Container["riderTripSignal"] = { notify: null };
  const riderTripOutbox = createRiderTripNoticeOutbox(sql);
  // ADR 0287 — إشارةٌ لحظيةٌ للطورِ الجديدِ وحدَه، بعدَ ثباتِ صفِّه، وبلا انتظارٍ: فشلُها لا يمسُّ
  // الانتقالَ (العاملُ يُشيرُ ثانيةً ثم تيليجرامُ). LOAD-01 (الدفعةُ الحاديةَ عشرةَ): معرّفُ الراكبِ يأتي
  // في ردِّ الإيداعِ نفسِه (20261018150000). والدفعةُ الخامسةَ عشرةَ: الموضعُ الواحدُ للإشارةِ سواءٌ أودَعَ
  // `enqueue` أم أودعَت عبارةُ القبولِ نفسُها (`deposited`) — فلا يختلفُ السلوكُ باختلافِ المسار.
  const signalAfterDeposit = (
    orderId: string,
    event: Parameters<RiderTripNoticeDeps["outbox"]["enqueue"]>[1],
    result: { readonly created: boolean; readonly riderTelegramId?: string | null } | null,
  ): void => {
    const notify = riderTripSignal.notify;
    if (result?.created === true && notify !== null && RIDER_TRIP_APP_FIRST_EVENTS.has(event)) {
      const tg = result.riderTelegramId;
      if (typeof tg === "string") {
        // كما كانَ تمامًا: فشلُ الإشارةِ لا يمسُّ الانتقال (كانَ `.catch(() => undefined)`).
        try {
          notify(tg, orderId);
        } catch {
          // لا شيء: العاملُ يُشيرُ ثانيةً ثم تيليجرام.
        }
      }
    }
  };
  const riderTripNoticeDeps: RiderTripNoticeDeps = {
    outbox: {
      enqueue: async (orderId, event) => {
        const result = await riderTripOutbox.enqueue(orderId, event);
        signalAfterDeposit(orderId, event, result);
        return result;
      },
      deposited: (orderId, event, result) => signalAfterDeposit(orderId, event, result),
    },
    log,
  };
  /**
   * أزرارُ بوتِ السائقِ تسلكُ صندوقَ الصادرِ في سطحِ `miniapp` (الإنتاج): إخطارُه يحملُ زرَّ
   * فتحِ الرحلةِ في Mini App، فيُغني عن رابطِ التتبّعِ الذي كانَ يُلحَقُ بالرسالةِ المباشرة.
   * وفي سطحِ `bot` القديمِ لا Mini App يُفتَح، فيبقى المسارُ المباشرُ برابطِه كما كان.
   */
  const botNoticeViaOutbox = config.botSurfaceMode === "miniapp";

  const driverDeps: DriverBotDependencies = {
    gpsPolicy,
    sessions: driverSessions,
    drivers,
    cities,
    settings,
    subscriptions: createSubscriptionReader(sql),
    trial: createTrialRpc(sql),
    // تغييرات الاشتراك (أمر المالك 2026-08-12): الإلغاء آخرَ الدورة، والتراجع
    // عنه، وترقية الخطّة. المنفذ نفسه الذي تختبره اختبارات التكامل على قاعدة
    // حقيقية — لا نسخةٌ ثانية بسلوكٍ ثانٍ.
    subscriptionChanges: createSubscriptionChangeRpc(sql),
    // البيع الذاتي: يظهر زرّ الشراء فقط عند تركيب مزوّد دفعٍ فعليّ.
    ...(overrides.paymentProvider === undefined || overrides.paymentProvider === null
      ? {}
      : {
          subscriptionPurchase: {
            payments: createPaymentRepository(sql, async (driverId) => {
              const rows = await sql<{ city_id: string }[]>`
                select city_id from drivers where id = ${driverId}::uuid
              `;
              return rows[0]?.city_id ?? null;
            }),
            provider: overrides.paymentProvider,
          },
        }),
    dispatch:
      overrides.metrics === undefined
        ? createDispatchRpc(sql)
        : instrumentDispatchRpc(createDispatchRpc(sql), overrides.metrics),
    offers: offerDecisions,
    clock: systemClock,
    negotiation: { claims: claimDeps, relay: relayDeps },
    /**
     * `PD-001` · `ADR 0157` — بوّابةُ دخولِ قروبِ غيرِ المشتركينَ: طلبُ
     * الانضمامِ يُحكَمُ فيهِ من هويّةِ السائقِ المسجَّلةِ (مدينتُهُ وتوثيقُهُ)
     * لا من انتمائِهِ للقروبِ — فالقروبُ ليسَ شهادةً. والبوّابةُ تلغراميّةُ هنا
     * والقرارُ مطروقٌ عبرَ الحقنِ في الاختبارِ لا عبرَ شبكةٍ حقيقيّةٍ.
     */
    groupJoinGate: {
      cities: createUnsubscribedGroupCityDirectory(sql),
      memberships: createGroupMembershipStore(sql),
      drivers,
      gate: overrides.driverJoinGate ?? grammyGroupJoinGate(config.driverBotToken),
      log,
    } satisfies GroupJoinGateDependencies,
    support: driverSupport,
    /**
     * `PD-041` — منفذا المحفظةِ والاعتراضاتِ للمركزِ الماليّ: التوصيلُ دائمٌ في
     * الإنتاجِ (الاختياريّةُ للحقنِ في اختباراتِ الحوارِ القائمةِ التي لا شأنَ
     * لها بالمالِ). المحفظةُ من `subscription_wallet_balance` قراءةً وحدَها — لا
     * إصدارَ استردادٍ من يدِ السائقِ. والاعتراضاتُ المفتوحةُ تُعَدُّ من
     * `support_tickets` بصنفِ `deduction` وحالةٍ غيرِ مُغلقةٍ — عدٌّ لا نسخُ
     * تفاصيلَ (تفاصيلُها من مسارِ «تذاكري» القائمِ).
     */
    financeWallet: {
      balance: (driverId) => financial.getBalance(driverId),
    },
    financeObjections: {
      listOpen: async (driverId) => {
        const rows = await sql<{ reference: string; status: string; created_at: string }[]>`
          select reference, status::text as status, created_at::text as created_at
          from support_tickets
          where driver_id = ${driverId}::uuid
            and type = 'deduction'
            and status not in ('resolved', 'rejected')
          order by created_at desc
          limit 10
        `;
        const views: readonly FinanceObjectionView[] = rows.map((row) => ({
          reference: row.reference,
          status: row.status,
          createdAt: row.created_at,
        }));
        return { ok: true as const, value: views };
      },
    },
    safety,
    tracking: liveTracking,
    reputation: reputationReader,
    tripCards: driverTripCards,
    // المرحلة ١٥ — الحقل يُسقَط عند `null` لا يُمرَّر: `exactOptionalPropertyTypes`.
    ...(routing === null ? {} : { routing }),
    redispatch: redispatchDeps,
    // `F4-02` — الحقلُ يُسقَط عند `null` لا يُمرَّر: `exactOptionalPropertyTypes`.
    ...(driverLocationHotState === null ? {} : { hotState: driverLocationHotState }),
    onHotStateDegraded,
    rating: {
      sessions: driverSessions,
      lifecycle: lifecyclePort,
      ratings: ratingPort,
      // المرحلة ١٢ — المقصد يُعرَض لحظةَ بدء الرحلة، لا بعد أن يسأل السائق عنه.
      tripCards: driverTripCards,
      ...(routing === null ? {} : { routing }),
      // الجسر إلى بوت العميل: من أنهى الرحلة سائقٌ، ومن يُبلَّغ بها عميلٌ على بوت آخر
      counterpart: counterpartNotifier(riderSender, log, "rider"),
      // `WR-15` — إخطارا البدءِ والإكمالِ للراكبِ عبرَ صندوقِ الصادرِ، كمسارِ Mini App.
      ...(botNoticeViaOutbox ? { riderNotice: riderTripNoticeDeps } : {}),
      // إنهاء الرحلة يُغلق الجلسة ويُوقف بثّ الموقع عن العميل — المرحلة ٦.
      tracking: liveTracking,
    },
    language: languageDeps(driverSessions),
    /**
     * §4.2 — إخطارُ الراكب لحظة القبول عبر بوته هو — نفس جسر التقييم، فلا
     * مسارٌ موازٍ ثان. و`links` يُسقَط حين يغيب `TRACKING_TOKEN_BASE_URL`: الإخطار
     * يُرسل بلا رابط ولا يُوعَد بما لا يُمكن.
     */
    // `WR-15` — قبولُ رسالةِ البوتِ يودعُ الإخطارَ في صندوقِ الصادرِ، فيحلُّ محلَّ `acceptNotice`.
    ...(botNoticeViaOutbox ? { riderNotice: riderTripNoticeDeps } : {}),
    acceptNotice: {
      counterpart: counterpartNotifier(riderSender, log, "rider"),
      ...(config.botSurfaceMode === "miniapp" ? { miniAppUrl: config.miniAppUrl } : {}),
      ...(config.trackingTokenBaseUrl === null
        ? {}
        : {
            links: {
              tokens: trackingTokens,
              mint: trackingTokenMint,
              baseUrl: config.trackingTokenBaseUrl,
            },
          }),
    },
    bootstrapAdmin: {
      telegramId: config.bootstrapAdminTelegramId,
      grant: (telegramId) => createBootstrapAdminPort(sql).grant(telegramId),
    },
  };

  const riderDeps: RiderBotDependencies = {
    sessions: riderSessions,
    riders,
    cities,
    orders: orderCancellation,
    rides,
    activeOrdersOf: createActiveOrdersLookup(sql),
    pastOrdersOf: createPastOrdersLookup(sql),
    matching,
    clock: systemClock,
    negotiation: {
      rotation: rotationDeps,
      relay: relayDeps,
      // NEG-SELECT-01 — «معلوماتُ السائقِ» وحارسُ ملكيّةِ أزرارِ الاختيارِ.
      driverCards: createNegotiationDriverCardReader(sql),
    },
    support: riderSupport,
    safety: { trigger: safety.trigger },
    reputation: reputationReader,
    // PD-053 — قائمة تذاكر الدعم للراكب في البوت: نتيجة الإجراء تصل صاحبها.
    ticketLister: (() => {
      const store = new PostgresRiderSupportStore(sql);
      return {
        list: async (telegramUserId: string) => {
          const page = await store.listTickets({
            telegramUserId,
            limit: 10,
            cursor: null,
          });
          return page.ok ? page.value.tickets : [];
        },
      };
    })(),
    rating: {
      sessions: riderSessions,
      lifecycle: lifecyclePort,
      ratings: ratingPort,
      counterpart: counterpartNotifier(driverSender, log, "driver"),
    },
    language: languageDeps(riderSessions),
    /**
     * §4.2 — زرّا «شارك موقعي الحي» و«إلغاء الرابط». الحقلُ يُسقَط بلا أساسٍ عامٍّ
     * فلا يُعرَض زرٌّ يُنتج رابطاً لا يُفتح.
     */
    ...(config.trackingTokenBaseUrl === null
      ? {}
      : {
          trackingLinks: {
            tokens: trackingTokens,
            mint: trackingTokenMint,
            baseUrl: config.trackingTokenBaseUrl,
          },
        }),
    // المرحلة ١١: **نفس** المنفذ المُمرّر لبوت السائق لا نسخةٌ ثانية: جلسات التتبّع
    // والبثّات المفتوحة حالةٌ في الذاكرة، ومنفذٌ ثانٍ فوقها يعني مُغلقاً يقرأ خريطة غير
    // التي كتبتها إصلاحات السائق — فلا يُغلق شيئاً.
    tracking: liveTracking,
  };

  const dispatchNewOrder = (orderId: string): void => {
    void sql<
      { city_id: string }[]
    >`select city_id::text as city_id from orders where id = ${orderId}::uuid`
      .then((rows) => {
        const cityId = rows[0]?.city_id;
        if (cityId !== undefined) {
          dispatchTrace?.onTrigger(cityId, "accepted");
          immediateRedispatchScheduler.trigger(cityId as CityId);
        }
      })
      .catch((cause: unknown) =>
        log("redispatch.new_order_trigger_failed", {
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
      );
  };

  return {
    dispatchNewOrder,
    riderTripSignal,
    routing,
    translation,
    driverDialogSessions: driverSessions,
    handler: createUpdateHandler({
      // ترطيب اللغة بمخزن جلسة كلّ بوت على حدة: من كتب لغته في بوت السائق يجدها
      // مطبّقة في بوت الراكب أيضاً — فالقاعدة واحدة (`users.language_code`)، والفصل في
      // الجلسة وحدها (ADR 0011) لا في التفضيل.
      driver: {
        deps: driverDeps,
        sender: driverSender,
        language: createLanguageHydration({
          preferences: languagePreferences,
          sessions: driverSessions,
          log,
        }),
      },
      rider: {
        deps: riderDeps,
        sender: riderSender,
        language: createLanguageHydration({
          preferences: languagePreferences,
          sessions: riderSessions,
          log,
        }),
      },
      log,
      ...(config.botSurfaceMode === "miniapp"
        ? { surface: { mode: config.botSurfaceMode, miniAppUrl: config.miniAppUrl } }
        : {}),
    }),
    sql,
    dispatchSql,
    driverSender,
    financial,
    trackingTokens: trackingTokens,
    /**
     * `F16-02` — منفذُ قراراتِ التذاكرِ للإقفالِ الإداريِّ من اللوحةِ: نفسُ
     * `resolutionPort` الذي يحكُمُ أزرارَ القروبِ لا نسخةٌ ثانيةٌ (القاعدةُ 0.6).
     */
    disputeResolutions: resolutionPort,
    /**
     * `DEC-26` — نشرُ بطاقةِ التذكرةِ في قروبِ الدعمِ من مسارِ الـ API:
     * نفسُ `supportCore.card` الذي يستخدمهُ حوارُ البوتِ لا نسخةٌ ثانيةٌ (القاعدةُ 0.6).
     */
    supportCard: supportCore.card,
    reputation: { flags: ratingFlagPort, reader: reputationReader },
    safety: { trigger: safety.trigger },
    driverOffers: { drivers, decisions: offerDecisions },
    /**
     * `ADR 0286` — منافذُ أعمالِ التفاوضِ للتطبيقِ المصغَّرِ: نفسُ المنافذِ الذرّيّةِ
     * التي يناديها حوارُ البوتِ (`register/withdraw` للمطالبةِ · `select/settle/
     * advanceAt` لقرارِ الراكبِ) — لا كاتبَ ثانٍ ولا نسخةً ثانيةً من الحقيقةِ.
     */
    negotiationApp: {
      claims: claimDeps.claims,
      rotation: rotationDeps.rotation,
    },
    // `WR-15` (ADR 0265) — الإيداعُ في صندوقِ الصادرِ لا الإرسالُ: العاملُ يُرسلُ ويُعيد.
    riderTripNotice: riderTripNoticeDeps,
    driverLocation: {
      drivers,
      ingest: {
        drivers,
        clock: systemClock,
        gpsPolicy,
        tracking: liveTracking,
        redispatch: redispatchDeps,
        // `F4-02` — المخزنُ الساخنُ **هوَ هوَ** الذي يقرؤه حوارُ البوتِ أعلاه: نسخةٌ
        // ثانيةٌ ههنا كانت ستجعلُ لنبضةِ HTTP حالةً ساخنةً لا يراها مسارُ البوتِ.
        ...(driverLocationHotState === null ? {} : { hotState: driverLocationHotState }),
        onHotStateDegraded,
      },
    },
    tracking: {
      bus: trackingBus,
      sessions: trackingSessions,
      proofs: trackingProofs,
      live: liveTracking,
      relay: customerRelay,
      tripCards: driverTripCards,
      tokens: trackingTokens,
      tokenMint: trackingTokenMint,
    },
    negotiation: {
      snapshots: createNegotiationSnapshotReader(sql),
      rotate: rotationDeps,
      republish: publishDeps,
      escalate: escalationDeps,
      publish: publishDeps,
      clock: systemClock,
    },
    close: async () => {
      distributedTrackingBus?.stop();
      await Promise.all([sql.end({ timeout: 5 }), dispatchSql.end({ timeout: 5 })]);
    },
  };
}
