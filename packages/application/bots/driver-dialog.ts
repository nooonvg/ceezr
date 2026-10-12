/**
 * الغرض: منطق حوار بوت السائق كاملاً: التسجيل، التوافر، الاشتراك، وقبول/رفض العرض.
 *   دالة خالصة من ناحية الإطار: تأخذ تحديثاً مُجرَّداً وتعيد ردوداً، فتُختبر بلا تلغرام.
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/driver/index.ts
 * ملاحظات مستقبلية: كل قيمة تجارية (السعر، مدة التجربة) تُقرأ من platform_settings عبر منفذ الإعدادات.
 */

import {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  type GpsPolicy,
  type PreviousFix,
} from "../../domain/geo/gps-fix.ts";
import {
  type Coordinates,
  makeCoordinates,
  parseAreaLabel,
} from "../../domain/geo/value-objects.ts";
import { parseFullName, parsePhone } from "../../domain/identity/value-objects.ts";
import {
  parseNationalId,
  parsePlateNumber,
  parseVehicleType,
  VEHICLE_TYPES,
} from "../../domain/kyc/value-objects.ts";
import {
  type CitySettings,
  parseCitySettings,
  subscriptionPriceFor,
} from "../../domain/policy/entity.ts";
import {
  isSubscriptionLive,
  type Subscription,
  type SubscriptionPlan,
} from "../../domain/subscription/entity.ts";
import type { RoutingProvider } from "../../maps/core/index.ts";
import { t } from "../../shared/i18n/index.ts";
import type {
  CityId,
  Clock,
  DriverId,
  OfferId,
  OrderId,
  ServiceType,
} from "../../shared/kernel/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import type { Result } from "../../shared/result/index.ts";
import { err, ok } from "../../shared/result/index.ts";
import {
  type RegisterUnsubscribedClaimDependencies,
  registerUnsubscribedClaim,
} from "../dispatch/register-unsubscribed-claim.ts";
import {
  type RelayDependencies,
  relayNegotiationMessage,
} from "../dispatch/relay-negotiation-message.ts";
import { noticeRiderOfTrip, type RiderTripNoticeDeps } from "../driver/rider-trip-notice.ts";
import type {
  DriverFinanceOverviewDeps,
  FinanceObjectionView,
} from "../financial/driver-finance-overview.ts";
import { driverFinanceOverview } from "../financial/driver-finance-overview.ts";
import type { PaymentProvider, PaymentRepository, WalletBalance } from "../financial/ports.ts";
import { subscribePlan } from "../financial/subscribe-plan.ts";
import {
  type UpdateDriverLocationDeps,
  updateDriverLocation,
} from "../geo/update-driver-location.ts";
import {
  type GroupJoinGateDependencies,
  handleDriverGroupDirectJoin,
  handleDriverGroupJoinRequest,
} from "../groups/group-join-gate.ts";
import type {
  ClaimRideResult,
  DispatchRpcPort,
  PortFailureError,
  SettingsRepository,
} from "../ports/index.ts";
import type { ReputationReader } from "../reputation/index.ts";
import { isSafetyDecisionReason } from "../safety/ports.ts";
import {
  type ResolveSafetyIncidentDeps,
  resolveSafetyIncident,
} from "../safety/resolve-safety-incident.ts";
import { type TriggerSosDeps, TriggerSosError, triggerSos } from "../safety/trigger-sos.ts";
import { cancelSubscription, resumeSubscription } from "../subscription/cancel-subscription.ts";
import type { SubscriptionChangeRpcPort } from "../subscription/ports.ts";
import { upgradePlan } from "../subscription/upgrade-plan.ts";
import type { DriverTripCardReader, DriverTripKey } from "../tracking/driver-trip-card.ts";
import { driverTripCard } from "../tracking/driver-trip-card.ts";
import {
  type IssueTrackingTokenDeps,
  issueTrackingToken,
} from "../tracking/issue-tracking-token.ts";
import type { LiveTrackingPort } from "../tracking/live-tracking.ts";
import { driverTripPin, driverTripText } from "./driver-trip-reply.ts";
import {
  handleLanguageCallback,
  handleLanguageCommand,
  type LanguageDialogDependencies,
} from "./language-dialog.ts";
import {
  commandForMenuText,
  helpKeyboard,
  isMenuCommand,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "./main-menu.ts";
import { nameErrorKey } from "./name-errors.ts";
import { driverLeaveKeyboard } from "./negotiation-cards.ts";
import {
  type CounterpartNotifier,
  handleCompleteRide,
  handleRatingCallback,
  handleStartRide,
  type RatingDialogDependencies,
  shortOrderId,
  startRideKeyboard,
} from "./rating-dialog.ts";
import { reputationCardReplies } from "./reputation-card.ts";
import { readDialogSession, type SessionRead } from "./session-read.ts";
import {
  handleActivateCommand,
  handleAnswerCommand,
  handleFlagRatingCommand,
  handleSupportGroupAction,
  handleSupportTypeChoice,
  type SupportDialogDependencies,
  startSupportDialog,
  submitSupportMessage,
} from "./support-dialog.ts";
import type { LocationQualityHints } from "./types.ts";
import {
  type BotReply,
  type CityDirectory,
  type CityRef,
  type DialogState,
  type DriverDirectory,
  type DriverProfile,
  INITIAL_STATE,
  type IncomingUpdate,
  type Keyboard,
  type OfferDecisionPort,
  type Sender,
  type SessionStore,
  type SubscriptionReader,
  type TrialRpcPort,
} from "./types.ts";
import { waitingLine } from "./waiting-lines.ts";

export interface DriverBotDependencies {
  readonly sessions: SessionStore;
  readonly drivers: DriverDirectory;
  readonly cities: CityDirectory;
  readonly settings: SettingsRepository;
  readonly subscriptions: SubscriptionReader;
  readonly trial: TrialRpcPort;
  readonly dispatch: DispatchRpcPort;
  readonly offers: OfferDecisionPort;
  readonly clock: Clock;
  /**
   * حدود تقييم إصلاحة GPS النافذة. اختياريّ لا لأنّ غيابه مقبولٌ في الإنتاج —
   * الحاوية تُمرّره دائماً واختبارُ ربطٍ يُثبت ذلك — بل لأنّ اختبارات الحوار
   * القائمة لا شأن لها بحدود الأجهزة، وغيابه يعني افتراض المجال لا سلوكاً ثانياً.
   *
   * وكان الموضع هنا يستدعي `DEFAULT_GPS_POLICY` مرمَّزاً، فمتغيّرات
   * `TRACKING_*` المُعلَنة في `render.yaml` لم يكن لها أثرٌ على المسار الحيّ
   * الوحيد للمواقع. هذا الحقل هو الطريق الذي تسلكه فعلاً.
   */
  readonly gpsPolicy?: GpsPolicy;
  /**
   * مسارُ قروبِ غيرِ المشتركين (المرحلة 2.3). اختياري لأن الاختبارات القائمة
   * تختبر التسجيل والعروض وحدها؛ غيابه يعني أن أزرار القروب لا تُعالَج، لا أن تُعالَج خطأ.
   */
  readonly negotiation?: {
    readonly claims: RegisterUnsubscribedClaimDependencies;
    readonly relay: RelayDependencies;
  };
  /**
   * بوّابةُ دخولِ القروبِ (`PD-001` · `ADR 0157`). اختياريٌّ بنفسِ منطقِ `negotiation`:
   * غيابُهُ يعني أنَّ طلباتِ الانضمامِ تُقرُّ استلامَها ولا يُحكَمُ فيها (البوّابةُ
   * خاملةٌ)، لا أنَّها تُقبَلُ أو تُرفَضُ جزافاً. والتوصيلُ في `container.ts` دائمٌ
   * في الإنتاجِ — ورفضُ المطالبةِ البرمجيُّ (`negotiation.claims`) يبقى خطَّ الدفاعِ
   * الدائمَ سواءً وُصِلَتِ البوّابةُ أم لا.
   *
   * ويملكُ هذا الحقلُ وحدهُ رابطَ التسجيلِ العميقَ (`gate.registrationLink`) لأنَّهُ
   * من هويّةِ بوتِ السائقِ عندَ تلغرامَ يُبنى — لا إعدادٍ يدويٍّ يتقادمُ بصمت.
   */
  readonly groupJoinGate?: GroupJoinGateDependencies;
  /**
   * مسار الدعم (المرحلة 2.4). اختياري بنفس منطق negotiation: غيابه يعني أن /support
   * يردّ «أمر غير معروف» بدل أن يفتح حواراً لا نهاية له.
   */
  readonly support?: SupportDialogDependencies;
  /**
   * منفذُ المحفظةِ للمركزِ الماليّ (`PD-041`): قراءةُ الرصيدِ وحدَها — لا إصدارَ
   * استردادٍ ولا تسويةٍ من يدِ السائقِ (قرارُ `subscription-wallet-adapters.ts`:
   * هذا المسارُ إداريٌّ/ويبهوكٌ فقط). اختياريٌّ كِسائرِ المنافذِ: غيابُهُ سكوتٌ
   * عن سطرِ الرصيدِ لا وعدٌ كاذبٌ، والتوصيلُ في الحاويةِ دائمٌ في الإنتاجِ.
   */
  readonly financeWallet?: {
    readonly balance: (
      driverId: DriverId,
    ) => Promise<Result<WalletBalance | null, PortFailureError>>;
  };
  /**
   * منفذُ الاعتراضاتِ الماليّةِ المفتوحةِ (`PD-041`): تذاكرُ `deduction` القائمةُ
   * تُعَدُّ فحسبْ — تفاصيلُها من مسارِ «تذاكري» القائمِ لا تُنسَخُ ههنا.
   * اختياريٌّ بنفسِ المنطقِ.
   */
  readonly financeObjections?: {
    readonly listOpen: (
      driverId: DriverId,
    ) => Promise<Result<readonly FinanceObjectionView[], PortFailureError>>;
  };
  /**
   * المحاولةُ الفوريّة لإعادة عرض الطلبات الباحثة — المرحلة ١٤.
   *
   * القياسُ على قاعدةٍ حقيقية: سائقٌ موثَّقٌ متاحٌ بلا موقع، وراكبٌ يطلب فلا يجد
   * أحداً. ثم يُرسل السائق موقعَه فيصير مؤهّلاً تماماً — ويُقال له «أنت الآن ظاهر
   * للطلبات فعلاً» — والطلبُ الذي ينتظره يبقى بصفر عروضٍ إلى الأبد، لأنّ
   * `broadcastOffers` لم تُنادَ إلّا عند إنشاء الطلب. فالرسالةُ كانت كذباً في حقّ
   * راكبٍ ينتظر بالفعل، والسائقُ يظنّ نفسه عاملاً.
   *
   * ولماذا اختياريّ؟ بنفس منطق `negotiation` و`support`: غيابُه يعني أنّ الأرضيّة
   * الدوريّة في العامل تتولّى الأمر بعد ثوانٍ، لا أنّ شيئاً يُعالَج خطأً. وهو
   * اختياريٌّ كذلك حتى لا تُعاد بناءُ عشرات الاختبارات القائمة لتبعيّةٍ لا تمسّها.
   *
   * ولا يُعاد الوعدُ صادقاً بمجرّد وجود هذا المنفذ: البثُّ الفوريّ يجري **بعد**
   * كتابة الموقع لا قبلها، فإن سقط لا يُفقَد شيءٌ — الأرضيّةُ الدوريّة شبكةُ أمانه.
   */
  readonly redispatch?: {
    /** لا يرمي ولا يُعيد خطأً: إعادةُ العرض تحسينٌ لا شرطٌ لحفظ الموقع. */
    onDriverBecameDispatchable(cityId: CityId): Promise<void>;
  };
  /**
   * `F4-02` — الحالةُ الساخنةُ المشتركةُ. تُمرَّرُ كما هيَ إلى
   * `updateDriverLocation` ولا يقرأُها الحوارُ: قرارُ التجميعِ ليسَ قرارَ رسالةٍ.
   * وغيابُها يعني نسقَ `F4-01` حرفاً — كتابةٌ مشروطةٌ لكلِّ نبضةٍ.
   */
  readonly hotState?: UpdateDriverLocationDeps["hotState"];
  /** `F4-02` — أثرُ التدهوّرِ عندَ عطلِ `Redis`؛ لا يُبتلَعُ صامتاً. */
  readonly onHotStateDegraded?: UpdateDriverLocationDeps["onHotStateDegraded"];
  /**
   * منح المسؤول الأول (§6.2ب من التوجيه). بلا هذا المسار لا توجد طريقة لتعيين
   * أول مسؤول في نظام كل صلاحياته في القاعدة، إلا تعديل صفّ يدوياً في الإنتاج.
   */
  /**
   * `F16-01` — قارئُ السمعةِ لأمرِ `/rating` (`get-reputation-summary.ts` الذي كانَ
   * مبنيّاً بلا نداءٍ). اختياريٌّ بنفس منطق `rating` و`tracking`: غيابُهُ يردُّ
   * «أمرٌ غيرُ معروف» لا بطاقةً فارغةً، والتوصيلُ في الحاويةِ دائمٌ في الإنتاجِ.
   */
  readonly reputation?: ReputationReader;
  /**
   * دورة الرحلة والتقييم (المرحلة 2.5). اختياري بنفس منطق ما قبله: غيابه يعني أن
   * زرّ بدء الرحلة لا يظهر، لا أن يظهر ويفشل.
   */
  readonly rating?: RatingDialogDependencies;
  /**
   * اختيار اللغة (المرحلة 2.6). اختياري بنفس منطق ما قبله: غيابه يجعل /language
   * يردّ «أمر غير معروف» بدل أن يعرض قائمة لا تُكتب نتيجتها في القاعدة.
   */
  readonly language?: LanguageDialogDependencies;
  readonly bootstrapAdmin?: {
    readonly telegramId: string;
    grant(telegramId: string): Promise<unknown>;
  };
  /**
   * المرحلة ٦ — النقل اللحظي. اختياري بنفس منطق ما قبله: غيابه يعني أن
   * الموقع يُحفظ ولا يُبَثّ — لا أن حفظه يفشل.
   *
   * ولماذا اختياري والنقل اللحظي مطلوب في الإنتاج؟ لأنّ فرضه يوجب على كل
   * اختبار حوار قائم أن يبني ناقلاً وجلساتٍ ليختبر زرّ تسجيل — فيصير تغيير مسار
   * التتبّع موجباً لتعديل عشرات الاختبارات التي لا تمسّه. ووصله في الحاوية
   * ثابتٌ ويحميه اختبار تكامل صريح على قاعدة حقيقية.
   */
  readonly tracking?: LiveTrackingPort;
  /**
   * المرحلة ١٢ — قارئ بطاقة الرحلة. اختياريٌّ بنفس منطق `rating` و`tracking`:
   * غيابه يجعل `/trip` يردّ «أمر غير معروف» بدل أن يعرض بطاقةً فارغة، ويُبقي
   * الاختبارات التي لا تقيس الرحلة على تهيئةٍ أصغر.
   */
  readonly tripCards?: DriverTripCardReader;
  /**
   * المرحلة ١٥ — مزوّد التوجيه لزمن الوصول. غيابه = لا سطرَ زمنٍ، ولا سطرَ
   * فشلٍ أيضاً (`NOT_CONFIGURED` يُسكت عنه) — فالبطاقة تبقى كما كانت قبل المرحلة.
   */
  readonly routing?: RoutingProvider;
  /**
   * تغييرات الاشتراك — الإلغاء والتراجع عنه وترقية الخطّة (أمر المالك 2026-08-12).
   *
   * اختياريٌّ بنفس منطق `rating` و`tracking`: غيابه يعني أنّ أزرار التغيير لا
   * تظهر في بطاقة `/subscription` أصلاً، لا أنّها تظهر ثمّ تفشل. ووصله في
   * الحاوية ثابتٌ ويحميه اختبار تكامل على قاعدة حقيقية.
   *
   * ولماذا المنفذ الذرّي مباشرةً لا مستودعُ دفعٍ معه؟ لأنّ مسار الترقية
   * المدفوعة في هذه المرحلة تحصيلٌ يدويّ عبر الدعم — لا مزوّد دفع مُعتمَد بعد
   * (§1.3 من التوجيه) — فبطاقةُ الحوار تعرض الفرق المستحقّ من القاعدة نفسها
   * ولا تُنشئ معاملةً لا سبيل لدفعها. والترقية داخل التجربة المجّانية تُطبَّق
   * فوراً لأنّها بلا مقابل فعلاً.
   */
  readonly subscriptionChanges?: SubscriptionChangeRpcPort;
  /**
   * شراء الاشتراك المدفوع من داخل البوت — مسار البيع الذاتي.
   *
   * قبل هذا كانت بطاقة `/subscription` تعرض السعر ولا تعرض زرّاً واحداً للدفع:
   * منصّةٌ كلّ دخلها اشتراكُ سائقٍ لم يكن فيها طريقٌ يسلكه السائق ليشترك، فكان
   * الدخل كلّه معلّقاً على تدخّلٍ يدويّ من الدعم لكل سائقٍ على حدة.
   *
   * اختياريٌّ بنفس منطق `subscriptionChanges`: غيابه (لغياب أسرار المزوّد) يعني
   * أنّ الزرّ لا يظهر أصلاً، لا أنّه يظهر ثمّ يفشل بعد أن يرفع توقّع السائق.
   *
   * ولا يُفعِّل البوت اشتراكاً أبداً: هو ينشئ المعاملة ويعطي رابط الدفع فقط.
   * التفعيل حقُّ الويبهوك وحده بعد إعادة قراءة الدفعة من خادم المزوّد — وإلاّ
   * كان زرٌّ في تلغرام كافياً لتفعيل اشتراكٍ لم يُدفع.
   */
  readonly subscriptionPurchase?: {
    readonly payments: PaymentRepository;
    readonly provider: PaymentProvider;
  };
  /**
   * §4.2 — إخطار الراكب لحظة القبول، ومعه رابطُ التتبّع المؤقّت إن أُمكن.
   *
   * قبل هذا كان المسار المباشر (قبولٌ من زرّ العرض) يُخطِر السائق وحده: الراكب
   * يبقى يرى «نبحث عن سائق» حتّى يضغط `/status` بنفسه — وسائقٌ واقفٌ عنده ولا
   * يعلم. ومسارُ القروبات كان يُخطِر (`negotiation.agreed_rider`)، فالتفاوتُ بين
   * المسارين كان عيباً لا اختلاف تصميم.
   *
   * اختياريٌّ بنفس منطق `rating` و`tracking`: غيابه يعني أنّ القبول يجري كما كان
   * بلا إخطار، لا أنّه يفشل. و`links` اختياريٌّ داخله لأنّ الرابط يحتاج
   * `TRACKING_TOKEN_BASE_URL`؛ فإن غاب وُصِل الإخطار بلا رابط — ولا يُوعَد بما لا
   * يُمكن إنجازه.
   */
  readonly acceptNotice?: {
    readonly counterpart: CounterpartNotifier;
    readonly links?: IssueTrackingTokenDeps;
    /**
     * `ADR 0213`: أصلُ التطبيقِ المصغَّرِ — حين يُعطى يحملُ إخطارُ القبولِ زرَّ `web_app`
     * يفتحُ الرحلةَ نفسَها (`ride_<orderId>`) في تطبيقِ الراكبِ: المتابعةُ هناك لا في المحادثةِ.
     */
    readonly miniAppUrl?: string | null;
  };
  /**
   * `WR-15` (ADR 0265) — إخطارُ القبولِ صفٌّ في صندوقِ الصادرِ لا إرسالٌ مباشر: نفسُ
   * مفتاحِ منعِ التكرارِ `rider_trip:<order>:MATCHED` الذي يودعُه قبولُ Mini App،
   * فلا يصلُ الراكبَ إخطاران لقبولٍ واحدٍ من مسارين، والعاملُ يُعيدُ ويُعلِنُ الفشلَ
   * النهائيّ. حين يُعطى **يحلُّ محلَّ** `acceptNotice` (الإرسالَ المباشر) ولا يُضافُ إليه.
   */
  readonly riderNotice?: RiderTripNoticeDeps;
  /** SOS: فتح من السائق وقرارات قروب الإسناد من بوت السائق الذي نشر البطاقة. */
  readonly safety?: {
    readonly trigger: TriggerSosDeps;
    readonly resolutions: ResolveSafetyIncidentDeps;
  };
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
}

/**
 * ردّ إلى محادثة الشخص الخاصة مهما كان مصدر التحديث. في القروبات chatId هو القروب،
 * والردّ عليه يكشف تفاصيل فردية للجميع؛ ومعرّف مستخدم تلغرام هو نفسه معرّف محادثته الخاصة.
 */
function privateReply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.telegramUserId, text, keyboard };
}

function cityKeyboard(cities: readonly CityRef[]): Keyboard {
  return {
    kind: "inline",
    rows: cities.map((city) => [{ label: city.name, data: `city:${city.id}` }]),
  };
}

/** لا تُستخدم لغة غير مدعومة: نرجع إلى العربية بلا إسقاط الرسالة. */
function languageOf(state: DialogState): string {
  return state.language;
}

/** القائمة الدائمة بلغة الحالة الحالية — تُرفَق بكل ردّ يعود بالسائق إلى الجاهزية. */
function menu(state: DialogState): Keyboard {
  return mainMenuKeyboard("driver", languageOf(state));
}

/**
 * طلب الرقم ومعه القائمة تحته — البند 4.3.
 * خطوة الرقم أكثر مواضع تعثّر السائق الجديد (رقم مكتوب، بطاقة غيره، رقم دولي،
 * خصوصية تمنع مشاركة الرقم) — وكانت لوحتها تمحو زرّ الدعم وزرّ اللغة معاً.
 */
function phoneRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_contact", label: t(languageOf(state))("driver.share_phone_button") },
    "driver",
    languageOf(state),
  );
}

/** طلب الموقع ومعه القائمة تحته — لنفس سبب `phoneRequest`. */
function locationRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_location", label: t(languageOf(state))("driver.share_location_button") },
    "driver",
    languageOf(state),
  );
}

/**
 * البند 2.4 — لوحة خطوة المنطقة المفضّلة.
 *
 * الخطوة اختيارية، فيجب أن يكون مخرجها ظاهراً بقدر ظهور مدخلها: زرّ «تخطّي»
 * inline على الرسالة نفسها. بلا زرٍّ صريح يبقى السائق الجديد أمام سؤالٍ يظنّه
 * إلزامياً في آخر خطوة من تسجيله — وهي أسوأ لحظة يُترك فيها حائراً.
 */
function preferredAreaSkipKeyboard(state: DialogState): Keyboard {
  return {
    kind: "inline",
    rows: [
      [{ label: t(languageOf(state))("driver.preferred_area_skip_button"), data: "area:skip" }],
    ],
  };
}

/** طلب نقطة المنطقة ومعه القائمة تحته — لنفس سبب `locationRequest`. */
function preferredAreaLocationRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_location", label: t(languageOf(state))("driver.preferred_area_pin_button") },
    "driver",
    languageOf(state),
  );
}

async function loadState(deps: DriverBotDependencies, sender: Sender): Promise<SessionRead> {
  return readDialogSession(deps.sessions, sender.telegramUserId, {
    ...INITIAL_STATE,
    language: sender.languageHint === "en" ? "en" : "ar",
  });
}

/**
 * `D-36`: نقراتُ خطواتِ التسجيلِ والمنطقةِ المفضّلةِ لا معنى لها إلّا بالطورِ. ونقراتُ
 * العرضِ والرحلةِ والتقييمِ والاشتراكِ مصدرُ حقيقتِها القاعدةُ فتبقى تعملُ (`ADR 0194`).
 */
const DRIVER_STEP_CALLBACKS: ReadonlySet<string> = new Set([
  "city",
  "service",
  "vehicle",
  "back",
  "area",
]);

/** الردّ الموحّد لأي عطل تقني — لا نكشف تفاصيل داخلية للسائق. */
function technicalFailure(sender: Sender, state: DialogState): readonly BotReply[] {
  return [reply(sender, t(languageOf(state))("common.error_try_again"))];
}

/**
 * رابطُ قروب غير المشتركين من إعدادات المدينة، أو `null` إن لم يُضبط بعد.
 *
 * لا يمرّ بـ`parseCitySettings` لأنّه ليس من سياسة التوزيع: إعدادٌ مبدئيٌّ
 * (`is_provisional`) يملأه فريقُ المدينة، فلو دخل في السياسة المتحقّقة لأوقف حوارَ
 * السائق كلّه في مدينةٍ لم تملأ رابطاً بعد.
 */
async function unsubscribedGroupLinkOf(
  deps: DriverBotDependencies,
  driver: DriverProfile,
): Promise<string | null> {
  const rows = await deps.settings.findByCity(driver.cityId);
  if (!rows.ok) return null;
  const row = rows.value.find((entry) => entry.key === "unsubscribed_drivers_group_link");
  if (row === undefined) return null;
  const raw = typeof row.value === "string" ? row.value : String(row.value ?? "");
  const link = raw.trim();
  return link === "" ? null : link;
}

async function citySettingsOf(
  deps: DriverBotDependencies,
  driver: DriverProfile,
): Promise<CitySettings | null> {
  const rows = await deps.settings.findByCity(driver.cityId);
  if (!rows.ok) return null;
  const parsed = parseCitySettings(driver.cityId, rows.value);
  return parsed.ok ? parsed.value : null;
}

/** نقطة الدخول الوحيدة: تحديث واحد ← ردود. لا ترمي استثناءً أبداً. */
export async function handleDriverUpdate(
  update: IncomingUpdate,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  /**
   * طلبُ الانضمامِ إلى القروبِ (`PD-001`): **قبلَ تحميلِ الجلسةِ لا بعدها** —
   * صاحبُ الطلبِ لم يكتبْ للبوتِ بعدُ، وإنشاءُ جلسةٍ لهُ هوَ أثرٌ لمن لم يُوجَدْ.
   * والقرارُ في البوّابةِ (`handleDriverGroupJoinRequest`) لا في الحوارِ: فلا
   * نصَّ يُفهمُ ولا زرّاً يُضغَطُ، بل هويّةٌ تُقرأُ من القاعدةِ وحكمٌ يُبلَّغُ
   * لتلغرامَ. والردُّ هنا إقرارُ استلامٍ لا رسالةَ حوارٍ — فالبوّابةُ تُراسِلُ
   * صاحبَها بنفسِها (خاصةً) متى احتاجتْ.
   *
   * وغيابُ `groupJoinGate` يعني بوّابةً خاملةً: يُقرُّ الاستلامُ ولا يُحكَمُ —
   * لا يُقبَلُ غريبٌ ولا يُرفَضُ مسجَّلٌ جزافاً. (وحدُّ المطالبةِ البرمجيُّ باقٍ
   * خطَّ الدفاعِ الدائمَ في الحالتَين.)
   */
  if (update.kind === "join_request") {
    if (deps.groupJoinGate === undefined) return [];
    // عجزُ البوّابةِ التقنيُّ يُسجَّلُ فيها لا يُرمى: فالرسائلُ هنا إقرارُ استلامٍ
    // لا نتيجةَ حوارٍ، وإسقاطُ التحديثِ كلِّهِ لا يعيدُ فتحَهُ (تسلسلُ الويبهوكِ
    // انتهى بإقرارِ الاستلامِ عندَ الإيداعِ — ADR 0054/0057).
    await handleDriverGroupJoinRequest(
      {
        groupChatId: update.groupChatId,
        telegramUserId: update.from.telegramUserId,
        userChatId: update.userChatId,
        languageHint: update.from.languageHint,
      },
      deps.groupJoinGate,
    );
    return [];
  }

  // `GRP-GATE-02`: دخولٌ مباشرٌ إلى قروبِ سائقين — قرارُ بوّابةٍ لا حوارٌ، وبلا جلسةٍ.
  if (update.kind === "member_joined") {
    if (deps.groupJoinGate === undefined) return [];
    await handleDriverGroupDirectJoin(
      {
        groupChatId: update.groupChatId,
        telegramUserId: update.from.telegramUserId,
        languageHint: update.from.languageHint,
        isBot: update.isBot,
      },
      deps.groupJoinGate,
    );
    return [];
  }

  const sender = update.from;
  const { state, unreadable } = await loadState(deps, sender);

  if (update.kind === "callback") {
    const prefix = update.data.split(":")[0] ?? "";
    if (unreadable && DRIVER_STEP_CALLBACKS.has(prefix)) return technicalFailure(sender, state);
    return handleCallback(update.data, sender, state, deps, update.messageId);
  }
  /**
   * `D-36`: الرقمُ وصورةُ المركبةِ لا يُفهَمانِ إلّا بطورِ التسجيلِ. أمّا الموقعُ فيمرُّ:
   * نبضةُ السائقِ الحيّةُ مصدرُ حقيقتِها القاعدةُ ولا تُعطَّلُ بفقدانِ Redis (`F4-08`)،
   * وثمنُه أنَّ نقطةَ المنطقةِ المفضّلةِ أثناءَ الفقدانِ تُقرأُ موقعاً — تُعادُ ولا تُفسِدُ.
   */
  if (unreadable && (update.kind === "contact" || update.kind === "photo")) {
    return technicalFailure(sender, state);
  }
  if (update.kind === "contact") {
    /**
     * الرقم يُقبل فقط إن أقرّ تلغرام أن البطاقة للمرسِل نفسه. إعادة توجيه بطاقة
     * شخص آخر تصل بنفس شكل زرّ "مشاركة رقمي" — الفرق الوحيد هذا الحقل.
     */
    if (update.ownerTelegramId !== sender.telegramUserId) {
      return [reply(sender, t(languageOf(state))("driver.phone_not_yours"), phoneRequest(state))];
    }
    if (state.step === "idle") return recordMiniAppPhoneProof(update.phone, sender, state, deps);
    return handlePhone(update.phone, sender, state, deps);
  }
  if (update.kind === "location")
    return handleLocation(update.location, sender, state, deps, update.quality);
  if (update.kind === "photo") {
    if (state.step === "awaiting_vehicle_photo") {
      return completeRegistration(update.fileId, sender, state, deps);
    }
    if (state.step !== "awaiting_support_message" || deps.support === undefined) {
      return [reply(sender, t(languageOf(state))("common.unknown_command"))];
    }
    return submitSupportMessage(
      // صورة بلا تعليق ليست شكوى بلا وصف: الإيصال نفسه هو الوصف، ونصّه ثابت مفهوم للدعم
      {
        message: update.caption ?? t(languageOf(state))("support.photo_only_message"),
        attachmentFileId: update.fileId,
      },
      sender,
      state,
      deps.support,
    );
  }

  if (update.kind === "unsupported") {
    return [reply(sender, t(languageOf(state))("common.unknown_command"))];
  }

  const text = update.text.trim();
  if (text.startsWith("/")) return handleCommand(text, sender, state, deps);

  // زرّ القائمة الدائمة يصل نصّاً لا بيانات (Reply Keyboard)، فيُترجَم إلى أمره هنا —
  // **قبل** أي فحص خطوة، وهو ما يطلبه البند 4.3: ضغطة واحدة في كل الحالات.
  // ولو تأخّر لصار زرّ «الدعم» يُسجَّل رقمَ لوحة السائق أو اسمَه في منتصف التسجيل.
  const fromMenu = commandForMenuText("driver", text);
  if (fromMenu !== null) return handleCommand(fromMenu, sender, state, deps);

  // `D-36`: نصٌّ حرٌّ والطورُ مجهولٌ — يُنقَلُ إلى تفاوضٍ قائمٍ في القاعدةِ إن وُجِدَ، وإلّا
  // فعطلٌ صادقٌ: لعلَّه اسمٌ أو لوحةٌ أو هويّةٌ أو رسالةُ دعمٍ لا نعرفُ أيَّها.
  if (unreadable) {
    return (await relayIfNegotiating(text, sender, state, deps)) ?? technicalFailure(sender, state);
  }

  switch (state.step) {
    case "awaiting_name":
      return handleName(text, sender, state, deps);
    case "awaiting_phone":
      /**
       * رقم مكتوب بلا زرّ = رقم غير مثبَت لصاحبه. لا نرفضه بعد تخزينه بل قبله:
       * ما يُخزَّن في `driver.phone` يجب أن يكون مضموناً بتلغرام دائماً.
       */
      return [
        reply(sender, t(languageOf(state))("driver.phone_must_use_button"), phoneRequest(state)),
      ];
    case "awaiting_plate_number":
      return handlePlateNumber(text, sender, state, deps);
    case "awaiting_national_id":
      return handleNationalId(text, sender, state, deps);
    case "awaiting_vehicle_photo":
      // نصٌّ حيث تُنتظر صورة: يُقال له إنه يحتاج صورة فعلية، لا "أمر غير معروف".
      return [reply(sender, t(languageOf(state))("driver.vehicle_photo_required"))];
    case "awaiting_preferred_area_label": {
      /**
       * خطوة المنطقة المفضّلة **اختيارية ومفتوحة زمنياً**: التسجيل يتركه فيها
       * ولا شيء يُخرجه منها إلّا تخطٍّ صريح. والتفاوض **إلزامي ومحدود بمهلة**.
       * لو بقيت الأولوية للخطوة الاختيارية لابتلعت كل نصّ حرّ من سائق حديث
       * التسجيل، فلا تصل رسالة تفاوض واحدة إلى العميل حتى تنتهي المهلة.
       * لذلك: إن كان له دور تفاوض مفتوح فالنصّ له، وإلّا فهو اسم الحيّ كما كان.
       */
      const relayed = await relayIfNegotiating(text, sender, state, deps);
      if (relayed !== null) return relayed;
      return handlePreferredAreaLabel(text, sender, state, deps);
    }
    case "awaiting_preferred_area_location":
      // إحداثية مكتوبة يدوياً لا تُقبل: نقطة تلغرام مضمونة الشكل، والنصّ ليس كذلك
      return [
        reply(
          sender,
          t(languageOf(state))("driver.preferred_area_needs_pin"),
          preferredAreaLocationRequest(state),
        ),
      ];
    case "awaiting_support_message":
      return deps.support === undefined
        ? [reply(sender, t(languageOf(state))("common.unknown_command"))]
        : submitSupportMessage(
            { message: text, attachmentFileId: null },
            sender,
            state,
            deps.support,
          );
    default: {
      // قبل ردّ "أمر غير معروف": إن كان السائق طرفاً في تفاوض نشط، فهذا نصّ موجّه للعميل
      const relayed = await relayIfNegotiating(text, sender, state, deps);
      return relayed ?? [reply(sender, t(languageOf(state))("common.unknown_command"))];
    }
  }
}

/**
 * نصّ حرّ من سائق: يُمرّر للعميل إن كان دوره في التفاوض مفتوحاً.
 *
 * القيمة `null` تعني "لا تفاوض نشط لهذا السائق" — وهي إشارة للمنادي بأن يتصرّف
 * في النصّ بمنطقه هو (اسم حيّ، أو ردّ "أمر غير معروف"). التمييز مقصود: الدالة
 * لم تعد تفترض أن غياب التفاوض يساوي أمراً مجهولاً، لأنها صارت تُنادى من خطوة
 * حوار قائمة أيضاً لا من الحالة الافتراضية وحدها.
 * من ليس طرفاً في تفاوض نشط لا تُمرّر رسالته — وهذا ما يمنع مخاطبة العميل خارج الدور.
 */
async function relayIfNegotiating(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[] | null> {
  const tr = t(languageOf(state));
  const negotiation = deps.negotiation;
  if (negotiation === undefined) return null;

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return null;

  const relayed = await relayNegotiationMessage(
    { from: "driver", driverId: driver.id, riderId: null, text },
    negotiation.relay,
  );
  if (!relayed.ok) return technicalFailure(sender, state);

  const report = relayed.value;
  if (report.reason === "NO_ACTIVE_NEGOTIATION" || report.reason === "EMPTY_MESSAGE") {
    return null;
  }
  if (report.reason === "UNREACHABLE") {
    return [reply(sender, tr("negotiation.relay_unreachable"))];
  }
  if (report.reason === "AWAITING_SELECTION") {
    return [reply(sender, tr("negotiation.driver_awaiting_selection"))];
  }
  // تنبيه الحجب يُرسَل فقط عند الحجب فعلاً؛ الرسالة مُرّرت في الحالتين.
  if (report.redacted > 0) return [reply(sender, tr("negotiation.relay_redacted"))];
  return [];
}

const CLAIM_REASON_KEYS: Readonly<Record<string, string>> = {
  ALREADY_CLAIMED: "negotiation.claim_rejected_already",
  SLOTS_FULL: "negotiation.claim_rejected_full",
  EXCLUDED_PREVIOUS_CYCLE: "negotiation.claim_rejected_excluded",
  COLLECT_WINDOW_CLOSED: "negotiation.claim_rejected_closed",
  NEGOTIATION_CLOSED: "negotiation.claim_rejected_closed",
  NEGOTIATION_NOT_FOUND: "negotiation.claim_rejected_closed",
};

/**
 * زرّ «قبول» داخل قروب غير المشتركين. الردّ يذهب لمحادثة السائق الخاصة لا للقروب:
 * إعلان ترتيب المسجّلين أمام الجميع يفتح باب المزايدة والضغط على من لم يلحق.
 */
async function handleUnsubscribedClaim(
  rest: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
  messageId?: string,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const negotiation = deps.negotiation;
  const [action, negotiationId] = rest;
  if (
    negotiation === undefined ||
    (action !== "claim" && action !== "leave") ||
    negotiationId === undefined
  ) {
    return [privateReply(sender, tr("common.unknown_command"))];
  }

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) {
    // `PD-001c`: غيرُ المسجَّلِ كانَ يصلُهُ حرفيًّا نصُّ المفتاحِ (`driver.not_registered`
    // لم يكنْ في أيِّ قاموسٍ) — والآنَ يصلُهُ أمرُ التسجيلِ، ومعَهُ رابطٌ عميقٌ
    // متى وُجِدَتِ البوّابةُ. والرابطُ أفضلُ جهدٍ لا وعدٌ: تعذُّرُهُ يردُّ إلى
    // النصِّ العاريِّ لا إلى حرفِ مفتاحٍ مقروءٍ كمخرجٍ.
    const link =
      deps.groupJoinGate === undefined ? null : await deps.groupJoinGate.gate.registrationLink();
    return [
      privateReply(
        sender,
        link === null
          ? tr("driver.not_registered")
          : tr("driver.not_registered_with_link", { link }),
      ),
    ];
  }

  if (action === "leave") {
    // `NEG-SELECT-01` — «إنهاءُ الانتظارِ والبحثُ عن عروضٍ أخرى»: يُغلِقُ مطالبتَه المنتظِرةَ
    // وحدَها. والردُّ يُبدِّلُ رسالةَ الانتظارِ في مكانِها متى عُرِفَ معرّفُها.
    const left = await negotiation.claims.claims.withdrawClaim(negotiationId, driver.id);
    if (!left.ok) return technicalFailure(sender, state);
    const key = left.value.withdrawn
      ? "negotiation.driver_left"
      : left.value.reason === "CLAIM_ACTIVE"
        ? "negotiation.driver_leave_active"
        : "negotiation.card_stale";
    return [
      {
        ...privateReply(sender, tr(key)),
        ...(messageId === undefined ? {} : { editMessageId: messageId }),
      },
    ];
  }

  const claimed = await registerUnsubscribedClaim(
    { negotiationId, driverId: driver.id },
    negotiation.claims,
  );
  if (!claimed.ok) return technicalFailure(sender, state);

  const report = claimed.value;
  if (!report.registered) {
    const key = CLAIM_REASON_KEYS[report.reason ?? ""] ?? "negotiation.claim_rejected_closed";
    return [privateReply(sender, tr(key))];
  }

  // صاحبُ الدورِ الأولِ أُودِعَ إخطارُه في معاملةِ التسجيلِ نفسِها (BUG-004)
  // ويُسلِّمُه عاملُ الصادرِ؛ فلا نكرّرُ عليه رسالةً من هنا.
  if (report.isActive) return [];
  return [
    privateReply(
      sender,
      tr("negotiation.claim_registered_waiting", {
        position: report.position ?? 0,
      }),
      driverLeaveKeyboard(tr, negotiationId),
    ),
  ];
}

/**
 * `F8-05` — مسارُ استقبالِ الاستغاثةِ للسائقِ: نداءٌ واحدٌ على تبعيّةٍ واحدةٍ.
 *
 * ## ما كانَ ولمَ زالَ
 *
 * كانَ `/sos` فرعاً في مُوزِّعِ الأوامرِ، والمُوزِّعُ يقرأُ
 * `drivers.findByTelegramId` **قبلَ كلِّ أمرٍ** ويردُّ عندَ إخفاقِها «حدثَ عطلٌ»
 * — **فتُسقَطُ الاستغاثةُ بعطبِ قراءةٍ لا تخصُّها**. وكانَ فوقَ ذلكَ
 * مشروطاً بـ`deps.tripCards !== undefined` وبـ`cardOf` بعدَها: **فغيابُ بطاقةِ
 * الرحلةِ كانَ يُحوّلُ الاستغاثةَ إلى «لم أفهم هذه الرسالةَ»** — تبعيّةٌ لا
 * يقتضيها النداءُ تُسكِتُ أخطرَ زرٍّ في المنتَجِ.
 *
 * فصارَ يُوزَّعُ **قبلَ** أيِّ `await` في المُوزِّعِ، والطلبُ يُحَلُّ في القاعدةِ
 * تحتَ القفلِ (`ADR-0077`). وما بقيَ شرطاً هوَ `deps.safety` وحدَه: تبعيّةُ
 * الاستغاثةِ نفسُها لا غيرُها.
 *
 * ولا تُقرأُ ههنا حالُ الاشتراكِ ولا التوافرُ ولا التسجيلُ: سائقٌ انتهى
 * اشتراكُه وهوَ في رحلةٍ قائمةٍ يبقى له الزرُّ، والدالّةُ تحكمُ بـ`ACTOR_NOT_FOUND`
 * لمن لا حسابَ له أصلاً.
 */
async function handleDriverSos(
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (deps.safety === undefined) return [reply(sender, tr("common.unknown_command"))];
  const raised = await triggerSos(
    {
      orderId: null,
      actorTelegramId: sender.telegramUserId,
      reporterRole: "driver",
      reason: "sos",
    },
    deps.safety.trigger,
  );
  if (!raised.ok) {
    return [
      reply(
        sender,
        raised.error instanceof TriggerSosError && raised.error.isNoActiveOrder
          ? tr("safety.no_active_order")
          : tr("common.error_try_again"),
        menu(state),
      ),
    ];
  }
  return [
    reply(sender, tr(raised.value.created ? "safety.sent" : "safety.already_sent"), menu(state)),
  ];
}

async function handleCommand(
  command: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const name = command.split(/\s+/)[0] ?? command;

  /**
   * `F8-05` — وموضِعُ هذا السطرِ هوَ العملُ نفسُه: **قبلَ أوّلِ `await`**.
   * فأيُّ قراءةٍ تُوضَعُ فوقَه تصيرُ بابَ إسقاطٍ للنداءِ، وحاجزُ
   * `scripts/check-sos-intake-isolation.ts` يُسقِطُ البناءَ على ذلكَ.
   */
  if (name === "/sos") return handleDriverSos(sender, state, deps);

  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const driver = existing.value;

  // ترقية المسؤول الأول: idempotent، وتُحاول عند كل /start لأن الحساب قد لا يكون
  // مسجَّلاً في أوّل مرة. فشلها لا يمنع الحوار: هي مسار إداري لا شرط استخدام.
  if (
    name === "/start" &&
    deps.bootstrapAdmin !== undefined &&
    deps.bootstrapAdmin.telegramId === sender.telegramUserId
  ) {
    await deps.bootstrapAdmin.grant(sender.telegramUserId);
  }

  switch (name) {
    /**
     * البند 2.4 — `/area` لمن سجّل قبل وجود هذه الخطوة، ولمن غيّر حيّه.
     *
     * بلا هذا الأمر تكون المنطقة المفضّلة حكراً على من يسجّل بعد اليوم، ويبقى
     * كل سائق قائم في القاعدة بلا سبيل إليها إلّا حذف حسابه وإعادة إنشائه.
     */
    case "/area": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const started = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_preferred_area_label",
        draftPreferredAreaLabel: null,
      });
      if (!started.ok) return technicalFailure(sender, state);
      return [
        reply(sender, tr("driver.preferred_area_ask_label"), preferredAreaSkipKeyboard(state)),
      ];
    }

    case "/city": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const cities = await deps.cities.listActive();
      if (!cities.ok) return technicalFailure(sender, state);
      if (cities.value.length === 0) return [reply(sender, tr("common.no_active_city"))];
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_city_change",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("city.change.prompt"), cityKeyboard(cities.value))];
    }

    case "/start": {
      if (driver !== null) {
        return [
          reply(sender, tr("driver.already_registered", { name: driver.fullName }), menu(state)),
        ];
      }
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_name",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      // القائمة تُرفق بالترحيب لا بطلب الاسم: تلغرام يُبقي لوحة الردّ معروضة ما لم
      // تُستبدل أو تُحذف، فتبقى معه من أول رسالة — وزرّ اللغة أول ما يحتاجه من لا
      // يقرأ العربية، وهو أحوج الناس إليه وأقلّهم قدرةً على معرفة أمر /language.
      return [
        reply(sender, tr("driver.welcome"), menu(state)),
        reply(sender, tr("driver.ask_name")),
      ];
    }

    /**
     * البند 6.3: الأوامر أزراراً لا نصّاً. اللوحة الأولى inline على الرسالة نفسها،
     * ولا تمسح الدائمة لأن تلغرام يفصل بين لوحة الرسالة ولوحة أسفل الشاشة —
     * والثانية تُعيد تأكيد الدائمة، إذ `/help` أوّل ما يلجأ إليه من ضاعت لوحته.
     */
    case "/help":
      return [
        // الشرحُ قبل قائمةِ الأوامر: من يطلب المساعدة لا يعرف ماذا يفعل أصلاً، وقائمةُ
        // أزرارٍ بلا شرحٍ تُخبره بما يستطيع الضغطَ عليه لا بما هو مطلوبٌ منه — وأكثرُ
        // ما يُسقط سائقاً جديداً أنّه لا يعلم أنّ «متاح» شرطٌ لوصول الطلبات إليه.
        reply(sender, tr("driver.guide")),
        reply(sender, tr("driver.help"), helpKeyboard("driver", languageOf(state))),
        reply(sender, tr("menu.hint"), menu(state)),
      ];

    case "/language":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCommand(sender, languageOf(state));

    case "/cancel": {
      await deps.sessions.clear(sender.telegramUserId);
      // كان يرسل `remove` فيُخلي أسفل الشاشة تماماً. وإلغاء خطوة ليس خروجاً من
      // البوت: إزالة القائمة هنا تجعل أكثر لحظة يحتاج فيها المستخدم زرّاً أخلى لحظة
      // منها، وتنقض مطلب البند 4.3 صراحةً: زرّ الدعم في كل الحالات.
      return [reply(sender, tr("common.cancelled"), menu(state))];
    }

    case "/available":
    case "/unavailable": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      const goingAvailable = name === "/available";

      if (goingAvailable && !driver.isVerified) {
        return [reply(sender, tr("driver.not_verified"))];
      }

      const applied = await deps.drivers.setAvailability(driver.id, goingAvailable);
      if (!applied.ok) return technicalFailure(sender, state);

      /**
       * المرحلة ١٢ — الخروج من الخدمة يُغلق جلسة التتبّع.
       *
       * وقبله كان السائق يضغط «أوقف استقبال الطلبات» فيُجاب «أوقفت»، وتبقى
       * جلسته مفتوحةً في `tracking_sessions` فيُرى على خريطة العمليات حيّاً — والاستعلام
       * يقرأ `ended_at is null` لا الإتاحة. والنداء **بعد** نجاح الكتابة لا قبلها:
       * إغلاق جلسةٍ لخروجٍ لم يُكتب يُنزل السائق من الخريطة وهو في الخدمة فعلاً.
       */
      if (!goingAvailable) await deps.tracking?.onDutyEnded(driver.id);

      // لا نقول «أنت الآن متاح» لمن لا موقع له. استعلام المرشّحين يشترط
      // سبب رفض `NO_LOCATION` في الدومين، فسائقٌ متاحٌ بلا موقع لا تُحسَب له مسافة
      // فلا يُسنَد إليه شيء. وقد وقع هذا فعلاً في الإنتاج: سائق موثَّق ومتاح ومشترك،
      // ولم يصله طلب واحد، وهو يظنّ نفسه عاملاً — لأن البوت أخبره بذلك.
      // فالرسالة الآن تقول الحقيقة، والطلب يصير خطوةً ناقصة لا حاشية.
      // (شرط SQL القديم `last_location is not null` رُفع في البند 2.3 ليظهر السبب
      // للمشغّل بدل أن يختفي السائق صامتاً؛ والحجب عن الإسناد باقٍ كما هو.)
      const replies: BotReply[] = [];

      if (goingAvailable && !driver.hasLocation) {
        replies.push(reply(sender, tr("driver.available_needs_location")));
        replies.push(reply(sender, tr("driver.ask_location"), locationRequest(state)));
      } else {
        replies.push(
          reply(
            sender,
            // الدخولُ إلى الخدمة لحظةُ انتظارٍ أيضاً: السائقُ ينتظر أوّل طلب. والبذرةُ
            // معرّفُه مع الدقيقة فيختلف السطرُ بين نوبةٍ وأخرى ولا يثبت على جملةٍ واحدة.
            goingAvailable
              ? waitingLine(
                  "driverAvailable",
                  `${driver.id}:${Math.floor(Date.now() / 60000)}`,
                  languageOf(state),
                )
              : tr("driver.now_unavailable"),
            menu(state),
          ),
        );
      }

      if (goingAvailable) {
        const live = await liveSubscription(deps, driver.id);
        if (live === null) {
          // اسم الزرّ يُقرأ من مفتاحه لا يُكتب في النصّ: نصٌّ يسمّي زرّاً ثم يتغيّر الزرّ يكذب
          replies.push(
            reply(
              sender,
              tr("driver.no_live_subscription", {
                subscription_button: tr("menu.driver.subscription"),
              }),
            ),
          );
        }
      }
      return replies;
    }

    case "/support": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (driver === null) return [reply(sender, tr("support.not_registered"), menu(state))];
      return startSupportDialog(sender, state, deps.support, { allowSubscriptionType: true });
    }
    /**
     * `F8-05` — ولا `case "/sos"` ههنا عن قصدٍ: فرعٌ في هذا المُوزِّعِ يعني
     * أنَّ قراءةَ `drivers.findByTelegramId` أعلاه قد مرَّت وأنَّ إخفاقَها
     * يُسقِطُ النداءَ. فالأمرُ يُوزَّعُ قبلَ ذلكَ كلِّه إلى `handleDriverSos`.
     */

    case "/activate": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleActivateCommand(command, sender, state, deps.support);
    }

    /**
     * `/answer` معَ `/activate` في هذا المُوزِّعِ لا في مُوزِّعِ الراكبِ: قروبُ
     * الدعمِ يُخدَمُ ببوتِ السائقِ — وهوَ مقروءٌ من موضعِ `/activate` لا مُقدَّرٌ.
     */
    case "/answer": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleAnswerCommand(command, sender, state, deps.support);
    }

    /**
     * `F16-01` — `/flag <rating_id>`: تعليمُ تقييمٍ مسيءٍ من قروبِ الدعمِ. معَ
     * `/answer` و`/activate` في مُوزِّعِ السائقِ لا الراكبِ: القروبُ يُخدَمُ ببوتِ
     * السائقِ — وهوَ مقروءٌ من موضعِ `/answer` لا مُقدَّرٌ.
     */
    case "/flag": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleFlagRatingCommand(command, sender, state, deps.support);
    }

    /**
     * `F16-01` — `/rating`: بطاقةُ السمعةِ — ملخّصٌ كسائقٍ وزبونٍ معَ آخرِ التقييماتِ
     * المستلمةِ (`get-reputation-summary.ts` الذي كانَ مبنيّاً بلا نداءٍ). لا يشترطُ
     * تسجيلًا: السمعةَ تُقرأُ بتلغرامِ المُرسِلِ نفسِهِ، والغيرُ المسجَّلِ لا تقييمَ
     * لهُ أصلاً فتُجيبُهُ البطاقةُ «لا تقييماتٍ بعد» — لا «سجّل أوّلاً».
     */
    case "/rating": {
      if (deps.reputation === undefined) return [reply(sender, tr("common.unknown_command"))];
      return reputationCardReplies(sender, state, sender.telegramUserId, {
        reputation: deps.reputation,
      });
    }

    case "/subscription": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      return describeSubscription(sender, state, driver, deps);
    }

    /**
     * PD-041 — `/finance`: المركزُ الماليُّ للسائقِ في بطاقةٍ واحدةٍ.
     * يَعرضُ الاشتراكَ + المحفظةَ + الاعتراضَ الماليَّ + الاستردادَ.
     * `/subscription` ما زال يعمل للتوافق — لكنّ الزرّ الدائمَ صار `/finance`.
     */
    case "/finance": {
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      return describeFinanceCenter(sender, state, driver, deps);
    }

    /**
     * المرحلة ١٢ — `/trip`: أين أنا، وإلى أين، وكم بقي.
     *
     * قبله كان `/trip` و`/mytrip` و`/route` و`/map` كلّها تردّ «لم أفهم هذه
     * الرسالة» — قياساً بمسبار تنفيذٍ لا استنتاجاً. فالسائق الذي نسي وسم
     * الانطلاق لم يكن له سبيلٌ إلى استرجاعه إلا بالعودة إلى رسالةٍ قديمة في
     * محادثةٍ تتحرّك، أو بمكالمة الراكب.
     *
     * ولا يُقرأ `driver.id` من رسالةٍ ولا من زرّ: القارئ يسأل «ما رحلة هذا
     * السائق؟» فالعلاقة تُثبَت في الخادم (المرحلة ١).
     */
    case "/trip": {
      if (deps.tripCards === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (driver === null) return [reply(sender, tr("driver.must_register_first"))];
      return tripCardReplies(
        sender,
        state,
        { driverId: driver.id },
        deps.tripCards,
        deps.routing ?? null,
        menu(state),
      );
    }

    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

/** أزرار قروب الإسناد: تسجل قرار إنسان فقط، ولا تتخذ أي قرار من محتوى الحادث. */
async function handleSafetyGroupAction(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const [action, incidentId] = parts;
  if (deps.safety === undefined || incidentId === undefined || incidentId === "") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  // `PD-021` — الإغلاقُ والحظرُ بلا سببٍ داخليٍّ مُختارٍ لا يُنفَّذان. الضغطُ
  // الأولُ يَعرضُ قائمةَ أسبابٍ مغلقةً، والثاني يُنفِّذُ القرارَ بالسببِ.
  if (action === "resolve") {
    const [, , decisionRaw, reasonRaw] = parts;
    if (decisionRaw !== "close" && decisionRaw !== "block") {
      return [reply(sender, tr("common.unknown_command"))];
    }
    if (!isSafetyDecisionReason(reasonRaw)) {
      return [reply(sender, tr("common.unknown_command"))];
    }
    const mapped = decisionRaw === "block" ? "block_reporter" : "close";
    const resolved = await resolveSafetyIncident(
      {
        incidentId,
        actorTelegramId: sender.telegramUserId,
        action: mapped,
        decisionReason: reasonRaw,
      },
      deps.safety.resolutions,
    );
    if (!resolved.ok) {
      const key =
        resolved.error.detail === "ACTOR_NOT_AUTHORIZED"
          ? "safety.not_authorized"
          : resolved.error.detail === "DECISION_REASON_REQUIRED"
            ? "safety.reason_required"
            : "safety.already_handled";
      return [{ chatId: sender.telegramUserId, text: tr(key), keyboard: null }];
    }
    return [reply(sender, tr(mapped === "block_reporter" ? "safety.blocked" : "safety.closed"))];
  }

  const mapped =
    action === "claim"
      ? "claim"
      : action === "close"
        ? "close"
        : action === "block"
          ? "block_reporter"
          : null;
  if (mapped === null) return [reply(sender, tr("common.unknown_command"))];

  if (mapped === "claim") {
    const resolved = await resolveSafetyIncident(
      { incidentId, actorTelegramId: sender.telegramUserId, action: "claim", decisionReason: null },
      deps.safety.resolutions,
    );
    if (!resolved.ok) {
      const key =
        resolved.error.detail === "ACTOR_NOT_AUTHORIZED"
          ? "safety.not_authorized"
          : "safety.already_handled";
      return [{ chatId: sender.telegramUserId, text: tr(key), keyboard: null }];
    }
    return [reply(sender, tr("safety.claimed", { actor: sender.telegramUserId }))];
  }

  // `PD-021` — اعرض قائمةَ أسبابٍ مغلقةٍ قبلَ تنفيذِ القرارِ.
  const decisionKey = mapped === "block_reporter" ? "block" : "close";
  return [
    {
      chatId: sender.telegramUserId,
      text: tr("safety.choose_reason", { incident: incidentId.slice(0, 8) }),
      keyboard: {
        kind: "inline",
        rows: [
          [
            {
              label: tr("safety.reason_resolved"),
              data: `sos:resolve:${incidentId}:${decisionKey}:resolved`,
            },
          ],
          [
            {
              label: tr("safety.reason_false_report"),
              data: `sos:resolve:${incidentId}:${decisionKey}:false_report`,
            },
          ],
          [
            {
              label: tr("safety.reason_duplicate"),
              data: `sos:resolve:${incidentId}:${decisionKey}:duplicate`,
            },
          ],
          [
            {
              label: tr("safety.reason_escalated"),
              data: `sos:resolve:${incidentId}:${decisionKey}:escalated`,
            },
          ],
          [
            {
              label: tr("safety.reason_safety_risk"),
              data: `sos:resolve:${incidentId}:${decisionKey}:safety_risk`,
            },
          ],
          [
            {
              label: tr("safety.reason_policy_violation"),
              data: `sos:resolve:${incidentId}:${decisionKey}:policy_violation`,
            },
          ],
        ],
      },
    },
  ];
}

async function liveSubscription(deps: DriverBotDependencies, driverId: DriverId) {
  const found = await deps.subscriptions.findLive(driverId);
  if (!found.ok || found.value === null) return null;
  return isSubscriptionLive(found.value, deps.clock.now()) ? found.value : null;
}

/**
 * تاريخٌ لم تُعِده القاعدة لا يُخترع ولا يُترك فارغاً في نصٍّ يقرأه السائق:
 * الشرطة تقول «غير معروف» بلا إيهامٍ بيومٍ بعينه.
 */
const UNKNOWN_DATE = "—";

/** التاريخ يوماً واحداً بلا ساعة — الساعة تُوهم السائق بدقّةٍ لا تخدمه في قرارٍ يوميّ. */
function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * أيّامٌ كاملةٌ باقية، بالتقريب لأعلى ولا تنزل تحت الصفر: «يتبقّى 0 أيام» أهدأُ من
 * «يتبقّى -1»، والسائقُ الذي بقيت له ساعةٌ يقرأ «يوماً» لا «صفراً».
 */
function daysUntil(endsAt: Date, now: Date): number {
  const remaining = endsAt.getTime() - now.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / 86_400_000);
}

/**
 * أزرار بطاقة الاشتراك. تُبنى من حالة الصفّ لا من ذاكرة الحوار: ما يُعرض على
 * السائق هو ما في القاعدة لحظةَ العرض، فلا يظهر «إلغاء» لمن ألغى، ولا
 * «ترقية» لمن هو على الخطّة الشاملة أصلاً.
 */
function subscriptionActionsKeyboard(
  subscription: Subscription,
  state: DialogState,
  deps: DriverBotDependencies,
): Keyboard | null {
  if (deps.subscriptionChanges === undefined) return null;
  const tr = t(languageOf(state));
  const rows: { readonly label: string; readonly data: string }[][] = [];
  // من طلب الإلغاء لا يُعرض عليه أن يزيد ما يدفع: يُقدَّم له التراجع أولاً،
  // ثم تظهر الترقية في بطاقةٍ تالية. وعرضُ الاثنين معاً يبيع لمن يودّع.
  if (subscription.plan !== "both" && !subscription.cancelAtPeriodEnd) {
    rows.push([{ label: tr("driver.subscription_upgrade_button"), data: "sub:upgrade:both" }]);
  }
  rows.push(
    subscription.cancelAtPeriodEnd
      ? [{ label: tr("driver.subscription_resume_button"), data: "sub:resume" }]
      : [{ label: tr("driver.subscription_cancel_button"), data: "sub:cancel" }],
  );
  return { kind: "inline", rows };
}

/**
 * أزرار تغييرات الاشتراك — البادئة `sub`.
 *
 * ولا يُقرأ معرّف السائق من الزرّ ولا من نصّ الرسالة: العلاقة تُثبَت في الخادم
 * من معرّف تلغرام، وإلا كان زرّاً منسوخاً كافياً لإلغاء اشتراك غيره.
 */
async function handleSubscriptionChange(
  rest: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const changes = deps.subscriptionChanges;
  const [action, ...tail] = rest;
  // الشراء مستقلٌّ عن `subscriptionChanges`: منصّةٌ مركّبٌ فيها الدفع دون منفذ
  // تغييرات الاشتراك كانت ستفقد البيع كلَّه لأجل تبعيّةٍ لا يحتاجها الشراء.
  if (action !== "buy" && changes === undefined) {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return [reply(sender, tr("driver.must_register_first"))];

  if (action === "buy") {
    return handleSubscriptionPurchase(tail[0], sender, state, driver, deps);
  }
  if (changes === undefined) return [reply(sender, tr("common.unknown_command"))];

  switch (action) {
    case "cancel":
      return tail[0] === "yes"
        ? confirmCancellation(sender, state, driver, changes, deps)
        : askCancellationConfirmation(sender, state, driver, deps);
    case "resume":
      return applyResume(sender, state, driver, changes);
    case "upgrade":
      return handleUpgradeButton(tail, sender, state, driver, changes, deps);
    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

/**
 * الإلغاء لا يقع بضغطةٍ واحدة: زرٌّ واحد بين السائق وبين توقّف رزقه خطرٌ لا
 * يُبرّره اختصارُ خطوة، والخطوة الثانية تقول له بالنصّ ما يخسره ومتى.
 */
async function askCancellationConfirmation(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const live = await liveSubscription(deps, driver.id);
  const until = live === null ? null : (live.currentPeriodEnd ?? live.trialEndsAt);
  if (until === null) {
    return [reply(sender, tr("driver.subscription_change_no_live"), menu(state))];
  }
  return [
    reply(sender, tr("driver.subscription_cancel_confirm", { until: dayOf(until) }), {
      kind: "inline",
      rows: [[{ label: tr("driver.subscription_cancel_confirm_button"), data: "sub:cancel:yes" }]],
    }),
  ];
}

async function confirmCancellation(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  changes: SubscriptionChangeRpcPort,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const outcome = await cancelSubscription({ driverId: driver.id }, { changes });
  if (!outcome.ok) {
    return outcome.error.detail === "NO_LIVE_SUBSCRIPTION"
      ? [reply(sender, tr("driver.subscription_change_no_live"), menu(state))]
      : technicalFailure(sender, state);
  }
  const value = outcome.value;
  // `serviceUntil` يكون فارغاً داخل التجربة المجّانية بلا دورة مدفوعة: يُقرأ
  // حينها من نهاية التجربة، ولا يُخترع تاريخٌ لم تُعِده القاعدة.
  const live = value.serviceUntil === null ? await liveSubscription(deps, driver.id) : null;
  const until = value.serviceUntil ?? live?.trialEndsAt ?? null;
  const params = { until: until === null ? UNKNOWN_DATE : dayOf(until) };
  return [
    reply(
      sender,
      value.alreadyCancelled
        ? tr("driver.subscription_cancel_already", params)
        : tr("driver.subscription_cancelled", params),
      menu(state),
    ),
  ];
}

async function applyResume(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  changes: SubscriptionChangeRpcPort,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const outcome = await resumeSubscription({ driverId: driver.id }, { changes });
  if (!outcome.ok) {
    return outcome.error.detail === "NO_LIVE_SUBSCRIPTION"
      ? [reply(sender, tr("driver.subscription_change_no_live"), menu(state))]
      : technicalFailure(sender, state);
  }
  return [
    reply(
      sender,
      outcome.value.alreadyActive
        ? tr("driver.subscription_resume_already")
        : tr("driver.subscription_resumed"),
      menu(state),
    ),
  ];
}

/**
 * الترقية خطوتان: عرضُ سعرٍ يُقرأ من القاعدة، ثمّ تأكيد.
 *
 * والفرقُ المعروض لا يُحسب في هذه الطبقة أبداً: `plan_upgrade_quote` تقرأ
 * `platform_settings`، فلا يختلف الرقمُ الذي يراه السائق عن الرقم الذي
 * تتحقّق منه الترقية في القاعدة.
 */
async function handleUpgradeButton(
  tail: readonly string[],
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  changes: SubscriptionChangeRpcPort,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const confirmed = tail[0] === "confirm";
  const planRaw = confirmed ? tail[1] : tail[0];
  if (planRaw !== "both" && planRaw !== "transport" && planRaw !== "delivery") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const newPlan: SubscriptionPlan = planRaw;

  const quoted = await changes.quoteUpgrade(driver.id, newPlan);
  if (!quoted.ok) return technicalFailure(sender, state);
  const quote = quoted.value;
  if (!quote.ok) {
    switch (quote.error) {
      case "NO_LIVE_SUBSCRIPTION":
        return [reply(sender, tr("driver.subscription_change_no_live"), menu(state))];
      case "ALREADY_ON_PLAN":
        return [
          reply(sender, tr("driver.subscription_upgrade_already", { plan: newPlan }), menu(state)),
        ];
      case "PLAN_NOT_AN_UPGRADE":
      case "UPGRADE_PRICE_NOT_HIGHER":
        return [reply(sender, tr("driver.subscription_upgrade_not_available"), menu(state))];
      default:
        return technicalFailure(sender, state);
    }
  }

  const until = quote.periodEnd === null ? UNKNOWN_DATE : dayOf(quote.periodEnd);

  // المسار المدفوع. مزوّد الدفع مُركَّبٌ أو لا، وهذا هو الفرق:
  //
  //   • مُركَّب: يُنشأ طلب دفعٍ حقيقيّ عبر حالة الاستخدام `upgradePlan`، فيصل
  //     السائق إلى رابط دفعٍ ويُطبَّق فرقُ الخطّة داخل `confirm_payment` نفسها.
  //     وحالةُ الاستخدام هي المكان الوحيد الذي يُنشئ معاملةً ويستدعي المزوّد:
  //     تكرارُ ذلك هنا كان سيصير مسارَ ترقيةٍ ثانياً بمفتاح إيدمبوتنسي مختلف،
  //     وهو تحديداً ما يُنتج فاتورتين للترقية الواحدة.
  //   • غير مُركَّب: يبقى النصّ صادقاً — تحصيلٌ يدويّ عبر الدعم. ولا تُنشأ
  //     معاملةٌ معلّقة لا سبيل إلى دفعها فتبقى في القاعدة سجلّاً لا يُغلق.
  if (quote.paymentRequired) {
    const money = { amount: quote.amountDue, currency: quote.currency ?? "" };
    const purchase = deps.subscriptionPurchase;
    if (purchase === undefined) {
      return [
        reply(
          sender,
          tr("driver.subscription_upgrade_quote_paid", { plan: newPlan, ...money, until }),
        ),
        reply(sender, tr("driver.subscription_upgrade_manual_payment", money), menu(state)),
      ];
    }
    // لا يُنشأ طلب دفعٍ بضغطةٍ واحدة: الفرق يُعرض أولاً ثم يُؤكَّد، كما في الإلغاء.
    if (!confirmed) {
      return [
        reply(
          sender,
          tr("driver.subscription_upgrade_quote_paid", { plan: newPlan, ...money, until }),
          {
            kind: "inline",
            rows: [
              [
                {
                  label: tr("driver.subscription_upgrade_confirm_button"),
                  data: `sub:upgrade:confirm:${newPlan}`,
                },
              ],
            ],
          },
        ),
      ];
    }
    const day = deps.clock.now().toISOString().slice(0, 10);
    const outcome = await upgradePlan(
      {
        driverId: driver.id,
        cityId: driver.cityId,
        newPlan,
        // مفتاحٌ على (السائق + الخطّة + اليوم) لا على وقتٍ لحظيّ: تلغرام يعيد
        // إرسال التحديث نفسه عند تعثّر الشبكة، وضغطتان تُنتجان فرقين مستحقّين
        // لترقيةٍ واحدة لو تغيّر المفتاح بينهما.
        idempotencyKey: `driver_subscription_upgrade:${driver.id}:${newPlan}:${day}`,
      },
      { changes, payments: purchase.payments, provider: purchase.provider },
    );
    if (!outcome.ok) {
      return outcome.error.detail === "ALREADY_ON_PLAN"
        ? [reply(sender, tr("driver.subscription_upgrade_already", { plan: newPlan }), menu(state))]
        : technicalFailure(sender, state);
    }
    // التجربة المجّانية قد تُطبَّق مباشرةً حتى في هذا الفرع لو تغيّرت الدورة بين
    // العرض والتأكيد: تُقرأ النتيجة الفعليّة ولا يُفترض أنّها ما عُرض.
    if (outcome.value.kind === "applied") {
      const appliedUntil =
        outcome.value.periodEnd === null ? until : dayOf(outcome.value.periodEnd);
      return [
        reply(
          sender,
          tr("driver.subscription_upgraded", { plan: outcome.value.plan, until: appliedUntil }),
          menu(state),
        ),
      ];
    }
    if (outcome.value.checkoutUrl === null) {
      return [reply(sender, tr("driver.subscription_checkout_pending"), menu(state))];
    }
    return [
      reply(
        sender,
        tr("driver.subscription_upgrade_checkout", {
          plan: newPlan,
          amount: outcome.value.amountDue,
          currency: outcome.value.currency,
          url: outcome.value.checkoutUrl,
        }),
        menu(state),
      ),
    ];
  }

  // المسار المجّاني (التجربة): بلا مقابل فعلاً، فيُطبَّق ذرّياً بعد تأكيدٍ صريح.
  if (!confirmed) {
    return [
      reply(sender, tr("driver.subscription_upgrade_quote_free", { plan: newPlan }), {
        kind: "inline",
        rows: [
          [
            {
              label: tr("driver.subscription_upgrade_confirm_button"),
              data: `sub:upgrade:confirm:${newPlan}`,
            },
          ],
        ],
      }),
    ];
  }

  const applied = await changes.applyUpgrade(driver.id, newPlan, null);
  if (!applied.ok) return technicalFailure(sender, state);
  const value = applied.value;
  if (!value.ok) {
    return value.error === "ALREADY_ON_PLAN"
      ? [reply(sender, tr("driver.subscription_upgrade_already", { plan: newPlan }), menu(state))]
      : technicalFailure(sender, state);
  }
  // داخل التجربة لا `current_period_end`، فتاريخ الانتهاء المعروض هو نهاية
  // التجربة كما أعادها عرض السعر — لا تاريخٌ يُخترع هنا.
  const appliedUntil = value.periodEnd === null ? until : dayOf(value.periodEnd);
  return [
    reply(
      sender,
      tr("driver.subscription_upgraded", { plan: value.plan ?? newPlan, until: appliedUntil }),
      menu(state),
    ),
  ];
}

/**
 * PD-041 — المركزُ الماليُّ للسائقِ: بطاقةٌ واحدةٌ تَعرضُ الاشتراكَ والمحفظةَ
 * والاعتراضَ الماليَّ القائمَ وأهليّةَ الاستردادَ. لا تُنشئُ شيئًا — تَقرأُ ما هو قائمٌ.
 *
 * **موصولةٌ بنموذجِ القراءةِ `driverFinanceOverview`** (تصحيحٌ مُلحَقٌ 2026-09-30 ·
 * `ح-8`): كانت البطاقةُ تقرأُ الاشتراكَ والعملةَ يدويّاً وتسكُتُ عن المحفظةِ
 * والاعتراضِ والاستردادِ، ونموذجُ القراءةِ الذي يجمعُها كانَ مبنيّاً غيرَ موصولٍ،
 * ووصفُ القائمةِ الدائمِ يَعِدُ «الاشتراك والمحفظة والاعتراض والاسترداد في
 * موضع واحد». صارت البطاقةُ تُبنى من النموذجِ: مصدرُ الحقيقةِ واحدٌ لا اثنانِ.
 * ومنافذا المحفظةِ والاعتراضِ اختياريّانِ في `DriverBotDependencies` كِسائرِ
 * المنافذِ الاختياريّةِ في هذا الملفّ: غيابُ المنفذِ سكوتٌ صادقٌ لا وعدٌ كاذبٌ،
 * والتوصيلُ في الحاويةِ دائمٌ في الإنتاجِ.
 */
async function describeFinanceCenter(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));

  const wallet = deps.financeWallet;
  const objections = deps.financeObjections;
  const walletPort =
    wallet === undefined
      ? undefined
      : ((async (driverId: DriverId) => {
          const found = await wallet.balance(driverId);
          return found.ok ? ok(found.value) : err(new Error(JSON.stringify(found.error)));
        }) satisfies DriverFinanceOverviewDeps["walletBalance"]);
  const objectionsPort =
    objections === undefined
      ? undefined
      : ((async (driverId: DriverId) => {
          const found = await objections.listOpen(driverId);
          return found.ok ? ok(found.value) : err(new Error(JSON.stringify(found.error)));
        }) satisfies DriverFinanceOverviewDeps["openObjections"]);
  const overview = await driverFinanceOverview(driver.id, driver.cityId, {
    findLiveSubscription: async (driverId) => {
      const found = await deps.subscriptions.findLive(driverId);
      return found.ok ? ok(found.value) : err(new Error(JSON.stringify(found.error)));
    },
    citySettings: async (cityId) => {
      const found = await deps.settings.findByCity(cityId);
      if (!found.ok) return err(new Error("settings unavailable"));
      const parsed = parseCitySettings(cityId, found.value);
      return parsed.ok ? ok(parsed.value) : err(new Error("settings unparsable"));
    },
    ...(walletPort !== undefined ? { walletBalance: walletPort } : {}),
    ...(objectionsPort !== undefined ? { openObjections: objectionsPort } : {}),
  });
  if (!overview.ok) return technicalFailure(sender, state);

  const card = overview.value;

  const rows: { readonly label: string; readonly data: string }[][] = [];

  // الاشتراك: زرٌّ يَفتحُ تفاصيلَ الاشتراكِ القائمةَ (مسار `sub:`).
  rows.push([{ label: tr("driver.finance_subscription_button"), data: "fin:subscription" }]);

  // الاعتراضُ الماليّ: زرٌّ يَفتحُ تذكرةَ خصمٍ.
  rows.push([{ label: tr("driver.finance_objection_button"), data: "fin:objection" }]);

  const subscriptionLine =
    card.subscription !== null &&
    isSubscriptionLive(subscriptionOf(card.subscription), deps.clock.now())
      ? tr("driver.finance_subscription_active", {
          plan: card.subscription.plan,
          until:
            card.subscription.currentPeriodEnd !== null
              ? dayOf(new Date(card.subscription.currentPeriodEnd))
              : "",
        })
      : tr("driver.finance_subscription_inactive");

  // سطورُ البطاقةِ: الاشتراكُ والعملةُ دائماً، ثمّ — إن وُجِدَ منفذُ المحفظةِ —
  // الرصيدُ وأهليّةُ الاستردادِ، ثمّ عددُ الاعتراضاتِ المفتوحةِ. الغائبُ يُسكَتُ
  // عنهُ لا يُعرَضُ صفراً كاذباً (ADR 0161: «إن لم يكن المزود يدعم الاسترداد يُسكَت عنه»).
  const lines = [
    tr("driver.finance_center", {
      subscription: subscriptionLine,
      currency:
        card.earnings !== null
          ? tr("driver.finance_currency", { currency: card.earnings.currency })
          : "",
    }),
  ];

  if (card.walletBalance !== null && card.walletBalance.balanceMinor !== null) {
    lines.push(
      tr("driver.finance_wallet", {
        balance: formatMinorUnits(
          card.walletBalance.balanceMinor,
          card.walletBalance.currency ?? "",
        ),
      }),
    );
    if (card.refund !== null) {
      lines.push(
        card.refund.eligible
          ? tr("driver.finance_refund_eligible")
          : tr("driver.finance_refund_not_eligible", { reason: card.refund.reason ?? "" }),
      );
    }
  }

  if (card.openObjections.length > 0) {
    lines.push(tr("driver.finance_objections_line", { count: String(card.openObjections.length) }));
  }

  return [reply(sender, lines.join("\n"), { kind: "inline", rows })];
}

/**
 * يعيد بناءَ كيانِ الاشتراكِ من منظورِ النموذجِ ليفحصَه `isSubscriptionLive` —
 * النموذجَ يُخرِجُ ISO نصوصاً (عقدُ السلكِ)، والفحصُ بحاجِ حقيقةِ القاعدةِ.
 */
function subscriptionOf(view: {
  readonly plan: string;
  readonly currentPeriodEnd: string | null;
  readonly trialEndsAt: string | null;
  readonly cancelAtPeriodEnd: boolean;
}): Subscription {
  return {
    plan: view.plan as SubscriptionPlan,
    currentPeriodEnd: view.currentPeriodEnd !== null ? new Date(view.currentPeriodEnd) : null,
    trialEndsAt: view.trialEndsAt !== null ? new Date(view.trialEndsAt) : null,
    cancelAtPeriodEnd: view.cancelAtPeriodEnd,
  } as unknown as Subscription;
}

/** رصيدٌ بالوحداتِ الصغرى يُعرَضُ بخانتينِ عشريّتَينِ — قراءةً لا حسابَ دفعٍ. */
function formatMinorUnits(minor: number, currency: string): string {
  const major = (minor / 100).toFixed(2);
  return currency === "" ? major : `${major} ${currency}`;
}

/**
 * PD-041 — مُعالِجُ أزرارِ المركزِ الماليّ: `fin:subscription` يَعرضُ الاشتراكَ،
 * و`fin:objection` يَفتحُ اعتراضًا ماليًّا (تذكرةَ خصمٍ).
 */
async function handleFinanceCallback(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const [action] = parts;

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const driver = found.value;
  if (driver === null) return [reply(sender, tr("driver.must_register_first"))];

  if (action === "subscription") {
    return describeSubscription(sender, state, driver, deps);
  }

  if (action === "objection") {
    // فتحُ تذكرةِ خصمٍ عبر مسارِ الدعمِ القائمِ: نُحدِّدُ الصنفَ ونَطلبُ الرسالةَ.
    if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
    const saved = await deps.sessions.save(sender.telegramUserId, {
      ...state,
      step: "awaiting_support_message",
      draftSupportType: "deduction",
    });
    if (!saved.ok) return [reply(sender, tr("common.error_try_again"))];
    return [reply(sender, tr("driver.finance_objection_prompt"))];
  }

  return [reply(sender, tr("common.unknown_command"))];
}

async function describeSubscription(
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const found = await deps.subscriptions.findLive(driver.id);
  if (!found.ok) return technicalFailure(sender, state);

  const subscription = found.value;

  /**
   * الشهرُ المجانيُّ ليس اشتراكاً، فلا يُعرَض بنصّه.
   *
   * البطاقةُ كانت تقول لصاحب التجربة «اشتراكك (transport) سارٍ حتى …» مع زرَّي
   * إلغاءٍ وترقية، فيقرأ السائق أنّه دافعٌ مشترك، ثمّ يُفاجأ بعد شهرٍ بانقطاع
   * الطلبات. ولا سبيلَ له إلى الدفع مبكّراً: زرُّ الشراء كان مشروطاً بغياب
   * اشتراكٍ سارٍ، والتجربةُ سارية. فمن أراد أن يُطمئن نفسه قبل انتهاء شهره لم
   * يجد زرّاً واحداً يفعل ذلك.
   *
   * والنصُّ يقول له صراحةً أنّ التفعيلَ المبكّر يُنهي ما بقي من أيّامه المجانية،
   * لأنّ `activate_subscription` يبدأ مدّةً جديدة ولا يُضيفها إلى التجربة.
   */
  if (
    subscription !== null &&
    subscription.status === "trialing" &&
    isSubscriptionLive(subscription, deps.clock.now())
  ) {
    const settings = await citySettingsOf(deps, driver);
    if (settings === null) return technicalFailure(sender, state);
    const endsAt = subscription.trialEndsAt ?? subscription.currentPeriodEnd;
    const plan: SubscriptionPlan = subscription.plan;
    return [
      reply(
        sender,
        tr("driver.subscription_trial", {
          days: endsAt === null ? 0 : daysUntil(endsAt, deps.clock.now()),
          until: endsAt === null ? "" : dayOf(endsAt),
          plan,
          price: subscriptionPriceFor(settings, plan),
          currency: settings.currency,
        }),
        deps.subscriptionPurchase === undefined
          ? menu(state)
          : {
              kind: "inline",
              rows: [
                [
                  {
                    label: tr("driver.subscription_trial_activate_button"),
                    data: `sub:buy:${plan}`,
                  },
                ],
              ],
            },
      ),
    ];
  }

  if (
    subscription !== null &&
    subscription.currentPeriodEnd !== null &&
    isSubscriptionLive(subscription, deps.clock.now())
  ) {
    const until = dayOf(subscription.currentPeriodEnd);
    return [
      reply(
        sender,
        subscription.cancelAtPeriodEnd
          ? tr("driver.subscription_cancel_pending", { plan: subscription.plan, until })
          : tr("driver.subscription_live", { plan: subscription.plan, until }),
        subscriptionActionsKeyboard(subscription, state, deps),
      ),
    ];
  }

  const settings = await citySettingsOf(deps, driver);
  if (settings === null) return technicalFailure(sender, state);

  const plan: SubscriptionPlan = subscription?.plan ?? "transport";
  /**
   * رابطُ قروب غير المشتركين يُلحَق متى كان مضبوطاً: إخبارُ السائق أنّ له
   * طريقاً ثانياً ثمّ تركُه يبحث عن بابه إحالةٌ إلى لا شيء. ومتى لم يُضبط بعد
   * فلا يُذكر سطرٌ فارغ: وعدٌ برابطٍ لا يوجد أسوأ من السكوت عنه.
   */
  const groupLink = await unsubscribedGroupLinkOf(deps, driver);
  const body = tr("driver.subscription_none", {
    plan,
    price: subscriptionPriceFor(settings, plan),
    currency: settings.currency,
  });
  return [
    reply(
      sender,
      groupLink === null
        ? body
        : `${body}\n\n${tr("driver.subscription_group_link", { link: groupLink })}`,
      // الزرّ يظهر فقط عند تركيب مزوّد دفع: عرضُ «اشترك الآن» بلا مزوّد يحوّل
      // بطاقةً صادقة إلى وعدٍ يفشل عند الضغط.
      deps.subscriptionPurchase === undefined
        ? null
        : {
            kind: "inline",
            rows: [[{ label: tr("driver.subscription_buy_button"), data: `sub:buy:${plan}` }]],
          },
    ),
  ];
}

/**
 * شراء الاشتراك: ينشئ معاملة دفعٍ ويعيد رابط الدفع المستضاف. لا يُفعِّل شيئاً.
 *
 * ومفتاح الإيدمبوتنسي مبنيّ على (السائق + الخطّة + اليوم) لا على وقتٍ لحظيّ:
 * ضغطتان متتاليتان — وتلغرام يعيد إرسال التحديث نفسه عند تعثّر الشبكة — كانتا
 * ستُنشئان فاتورتين، ومن دفعهما يخسر شهراً كاملاً لأنّ `activate_subscription`
 * يستبدل المدّة ولا يجمعها. ورابط الفاتورة الأولى محفوظٌ في المعاملة، فالضغطة
 * الثانية تستعيده بدل أن تُصطدم بمعاملةٍ معلّقة لا سبيل إلى دفعها.
 */
async function handleSubscriptionPurchase(
  requestedPlan: string | undefined,
  sender: Sender,
  state: DialogState,
  driver: DriverProfile,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const purchase = deps.subscriptionPurchase;
  if (purchase === undefined) return [reply(sender, tr("common.unknown_command"))];

  // الخطّة لا تُقرأ من الزرّ إلا بعد التحقق منها: نصُّ الزرّ مُدخَلٌ من المستخدم.
  const plan: SubscriptionPlan =
    requestedPlan === "transport" || requestedPlan === "delivery" || requestedPlan === "both"
      ? requestedPlan
      : "transport";

  // من له اشتراكٌ **مدفوعٌ** سارٍ لا يُبَع له اشتراكٌ ثانٍ: التفعيل يستبدل المدّة،
  // فبيعُه اشتراكاً وهو مشترك يمحو ما بقي له من شهرٍ دفع ثمنه.
  //
  // أمّا صاحبُ الشهر المجاني فيُباع له: لا مالَ يُمحى، وحجبُ الشراء عنه كان يعني
  // أنّ من أراد تأمين استمراره قبل انتهاء تجربته لا يجد إليه سبيلاً. والبطاقةُ
  // تُخبره قبل الضغط أنّ التفعيل يُنهي أيّامَه المجانية الباقية.
  const live = await deps.subscriptions.findLive(driver.id);
  if (!live.ok) return technicalFailure(sender, state);
  if (
    live.value !== null &&
    live.value.status !== "trialing" &&
    isSubscriptionLive(live.value, deps.clock.now())
  ) {
    return describeSubscription(sender, state, driver, deps);
  }

  const settings = await citySettingsOf(deps, driver);
  if (settings === null) return technicalFailure(sender, state);

  const day = deps.clock.now().toISOString().slice(0, 10);
  const outcome = await subscribePlan(
    {
      driverId: driver.id,
      cityId: driver.cityId,
      plan,
      idempotencyKey: `driver_subscription:${driver.id}:${plan}:${day}`,
    },
    {
      payments: purchase.payments,
      provider: purchase.provider,
      // السعر من `platform_settings` عبر المدينة لا من الكود، ويُحوَّل إلى الوحدة
      // الصغرى: `Money.amount` بالهلّات، وتمرير 400 مباشرةً كان سيبيع اشتراكاً
      // بأربعة ريالات.
      priceReader: async () =>
        ok({
          amount: Math.round(subscriptionPriceFor(settings, plan) * 100),
          currency: settings.currency,
        }),
    },
  );

  if (!outcome.ok) return technicalFailure(sender, state);
  if (outcome.value.checkoutUrl === null) {
    return [reply(sender, tr("driver.subscription_checkout_pending"), menu(state))];
  }

  return [
    reply(
      sender,
      tr("driver.subscription_checkout", {
        plan,
        price: subscriptionPriceFor(settings, plan),
        currency: settings.currency,
        url: outcome.value.checkoutUrl,
      }),
      menu(state),
    ),
  ];
}

async function handleName(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parseFullName(text);
  if (!parsed.ok) {
    return [reply(sender, tr(nameErrorKey(parsed.error.reason)))];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_phone",
    draftName: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_phone"), phoneRequest(state))];
}

/**
 * `PRD-105` — البطاقةُ تصلُ والحوارُ خاملٌ: هذا مسارُ التطبيقِ المصغَّر (`requestContact` يُرسِلُ
 * جهةَ الاتّصالِ إلى البوت). يُحفَظُ الرقمُ في الجلسةِ إثباتاً مضموناً بتيليجرام — المقارنةُ بصاحبِ
 * البطاقةِ تمَّت قبلَ هذا السطر — ويقرؤه `POST /v1/onboarding/driver`؛ ولا تُغيَّرُ الخطوةُ فلا
 * يُفتَحُ حوارُ تسجيلٍ في البوت. ومَن سُجِّلَ سائقاً لا يحتاجُ إثباتاً: يبقى الردُّ القديم.
 */
async function recordMiniAppPhoneProof(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  if (existing.value !== null) return [reply(sender, tr("common.unknown_command"))];
  const parsed = parsePhone(raw);
  if (!parsed.ok) return [reply(sender, tr("driver.phone_invalid"))];
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    draftPhone: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [reply(sender, tr("driver.phone_received_for_app"))];
}

async function handlePhone(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_phone") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const parsed = parsePhone(raw);
  if (!parsed.ok) return [reply(sender, tr("driver.phone_invalid"))];

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  if (cities.value.length === 0) {
    // البند 4.3: إزالة اللوحة هنا كانت تسلب السائق زرّ الدعم في عطلٍ ليس من فعله
    // («لا مدينة عاملة» خلل تشغيلي عندنا)، وهي بالضبط الحالة التي يجب أن يشتكي فيها.
    return [reply(sender, tr("common.no_active_city"), menu(state))];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_city",
    draftPhone: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_city"), cityKeyboard(cities.value))];
}

async function handleCallback(
  data: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
  messageId?: string,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const [prefix, ...rest] = data.split(":");

  switch (prefix) {
    // البند 6.3: زرّ أمرٍ من لوحة `/help` — يمرّ بنفس موجّه الأوامر لا بمسار ثانٍ
    case "cmd": {
      const command = rest.join(":");
      if (!isMenuCommand("driver", command)) {
        return [reply(sender, tr("common.unknown_command"))];
      }
      return handleCommand(command, sender, state, deps);
    }
    // `WR-12` (ADR 0268) — زرُّ «اجعلني غير متوفر» في تذكيرِ تحديثِ الموقع. يمرُّ بمسارِ
    // `/unavailable` نفسِه (الكتابةُ ثمَّ إغلاقُ جلسةِ التتبّع) لا بمسارٍ ثانٍ. وليس `cmd:`
    // عن قصد: `cmd:/unavailable` في وضعِ Mini App يفتحُ التطبيقَ ولا يُنفِّذ.
    case "avail":
      return rest.join(":") === "off"
        ? handleCommand("/unavailable", sender, state, deps)
        : [reply(sender, tr("common.unknown_command"))];
    case "lang":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCallback(data, sender, languageOf(state), deps.language);
    case "city":
      return handleCitySelected(rest.join(":"), sender, state, deps);
    case "service":
      return handleServiceSelected(rest.join(":"), sender, state, deps);
    case "vehicle":
      return handleVehicleTypeSelected(rest.join(":"), sender, state, deps);
    case "back":
      return handleBack(rest.join(":"), sender, state, deps);
    // البند 2.4: تخطّي المنطقة المفضّلة — خطوة اختيارية يجب أن يكون لها مخرج ظاهر
    case "area":
      return rest[0] === "skip"
        ? skipPreferredArea(sender, state, deps)
        : [reply(sender, tr("common.unknown_command"))];
    case "offer":
      return handleOfferDecision(rest, sender, state, deps, messageId);
    case "unsub":
      return handleUnsubscribedClaim(rest, sender, state, deps, messageId);
    case "ride": {
      if (deps.rating === undefined) return [reply(sender, tr("common.unknown_command"))];
      const [action, orderIdRaw] = rest;
      if (orderIdRaw === undefined || orderIdRaw === "") {
        return [reply(sender, tr("common.unknown_command"))];
      }
      const rideOrderId = orderIdRaw as OrderId;
      if (action === "start") {
        return handleStartRide(rideOrderId, sender, languageOf(state), deps.rating);
      }
      if (action === "complete") {
        return handleCompleteRide(rideOrderId, sender, languageOf(state), deps.rating);
      }
      return [reply(sender, tr("common.unknown_command"))];
    }
    case "rate": {
      if (deps.rating === undefined) return [reply(sender, tr("common.unknown_command"))];
      return handleRatingCallback(data, sender, languageOf(state), deps.rating);
    }
    // تغييرات الاشتراك: الإلغاء والتراجع عنه والترقية — أمر المالك 2026-08-12.
    case "sub":
      return handleSubscriptionChange(rest, sender, state, deps);
    /**
     * PD-041 — `fin:` المركزُ الماليُّ للسائقِ: عرضُ البطاقةِ الماليّةِ الكاملةِ،
     * وفتحُ الاعتراضِ الماليّ، وعرضُ الاشتراكِ من السطحِ نفسِه.
     */
    case "fin":
      return handleFinanceCallback(rest, sender, state, deps);
    case "sup": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      const [action, ...tail] = rest;
      if (action === "type") {
        return handleSupportTypeChoice(tail.join(":"), sender, state, deps.support);
      }
      return handleSupportGroupAction(rest, sender, state, deps.support);
    }
    case "sos":
      return handleSafetyGroupAction(rest, sender, state, deps);
    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

async function handleCitySelected(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));

  // فرع تغيير المدينة بعد التسجيل — للانتقال والسفر
  if (state.step === "awaiting_city_change") {
    return handleCityChange(cityIdRaw, sender, state, deps);
  }

  if (state.step !== "awaiting_city") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);

  // لا نقبل معرّف مدينة من الزرّ على أنه صحيح: نتحقّق أنها ضمن المدن المفعَّلة فعلاً
  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_service",
    draftCityId: city.id,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [
    reply(sender, tr("driver.ask_service"), {
      kind: "inline",
      rows: [
        [{ label: tr("driver.service_transport"), data: "service:transport" }],
        [{ label: tr("driver.service_delivery"), data: "service:delivery" }],
        // اختيار المدينة كان غير قابل للتراجع: تصحيحه يعني /cancel وإعادة الاسم والرقم
        [{ label: tr("common.back_button"), data: "back:city" }],
      ],
    }),
  ];
}

/**
 * تغيير مدينة السائق بعد التسجيل — للانتقال والسفر.
 * يستدعي RPC ذرّياً ويعيد السائق إلى الجاهزية.
 */
async function handleCityChange(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);

  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  // نحتاج معرّف السائق — نقرأه من الملف
  const driver = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!driver.ok) return technicalFailure(sender, state);
  if (driver.value === null) return [reply(sender, tr("driver.must_register_first"))];

  const result = await deps.drivers.changeCity(driver.value.id, city.id);
  if (!result.ok) return technicalFailure(sender, state);

  // العودة إلى الجاهزية
  await deps.sessions.clear(sender.telegramUserId);

  if (!result.value.ok) {
    if (result.value.error === "ACTIVE_ORDER_IN_PROGRESS") {
      return [reply(sender, tr("city.change.active_order"), menu(state))];
    }
    return [reply(sender, tr("city.change.failed"), menu(state))];
  }

  // same=true يعني أنّ المدينة لم تتغير
  return [reply(sender, tr("city.change.success", { city: city.name }), menu(state))];
}

/** رجوع خطوة واحدة داخل التسجيل. لا يمسح الاسم ولا الرقم — يعيد السؤال فقط. */
async function handleBack(
  target: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (target !== "city" || state.step !== "awaiting_service") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  if (cities.value.length === 0) return [reply(sender, tr("common.no_active_city"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_city",
    draftCityId: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [reply(sender, tr("driver.ask_city"), cityKeyboard(cities.value))];
}

function isServiceType(value: string): value is ServiceType {
  return value === "transport" || value === "delivery";
}

async function handleServiceSelected(
  serviceRaw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_service" || !isServiceType(serviceRaw)) {
    return [reply(sender, tr("common.unknown_command"))];
  }
  if (state.draftName === null || state.draftPhone === null || state.draftCityId === null) {
    // جلسة ناقصة: نبدأ من جديد بدل تسجيل بيانات نصف مكتملة
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("driver.must_register_first"))];
  }

  /**
   * التسجيل لم يعد ينتهي هنا. كان ينتهي، فيُنشأ سائقٌ لا يُعرف ما يقود ولا رقم
   * لوحته ولا من هو — ويُوثَّق على هذا الفراغ. الآن تُجمَع بقية الملفّ في الجلسة
   * ولا يُكتب صفٌّ في القاعدة إلا بعد اكتماله، حتى لا يرى موظّف التوثيق ملفّاً
   * نصف مكتمل فيحسبه ملفّاً حقيقياً.
   */
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_vehicle_type",
    draftService: serviceRaw,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_vehicle_type"), vehicleTypeKeyboard(tr))];
}

/** لوحة أنواع المركبات — تُبنى من قائمة الدومين فلا تتفرّق النسختان. */
function vehicleTypeKeyboard(tr: (key: string) => string): Keyboard {
  return {
    kind: "inline",
    rows: VEHICLE_TYPES.map((type) => [
      { label: tr(`driver.vehicle_${type}`), data: `vehicle:${type}` },
    ]),
  };
}

async function handleVehicleTypeSelected(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (state.step !== "awaiting_vehicle_type") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const parsed = parseVehicleType(raw);
  if (!parsed.ok) return [reply(sender, tr("common.unknown_command"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_plate_number",
    draftVehicleType: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_plate_number"))];
}

async function handlePlateNumber(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parsePlateNumber(raw);
  // سبب الرفض يُقال بعينه: "غير صالح" وحدها تترك السائق يخمّن ما الخطأ.
  if (!parsed.ok) return [reply(sender, tr(`driver.plate_invalid_${parsed.error.reason}`))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_national_id",
    draftPlateNumber: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_national_id"))];
}

async function handleNationalId(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parseNationalId(raw);
  if (!parsed.ok) return [reply(sender, tr(`driver.national_id_invalid_${parsed.error.reason}`))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_vehicle_photo",
    draftNationalId: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("driver.ask_vehicle_photo"))];
}

/** آخر خطوة: تصل الصورة فيُكتب الصفّ كاملاً دفعة واحدة. */
async function completeRegistration(
  fileId: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  if (
    state.draftName === null ||
    state.draftPhone === null ||
    state.draftCityId === null ||
    state.draftService === null ||
    state.draftVehicleType === null ||
    state.draftPlateNumber === null ||
    state.draftNationalId === null
  ) {
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("driver.must_register_first"))];
  }

  const serviceRaw = state.draftService;
  const registered = await deps.drivers.register({
    telegramUserId: sender.telegramUserId,
    cityId: state.draftCityId,
    fullName: state.draftName,
    phone: state.draftPhone,
    service: serviceRaw,
    language: languageOf(state),
    vehicleType: state.draftVehicleType,
    plateNumber: state.draftPlateNumber,
    nationalId: state.draftNationalId,
    vehiclePhotoFileId: fileId,
  });
  if (!registered.ok) {
    /**
     * ازدواج الهوية ليس عطلاً تقنياً بل رفضٌ مفهوم: شخصٌ يحاول حساباً ثانياً
     * بنفس هويته. يُقال له السبب صراحةً بدل "حدث خطأ تقني" التي تدفعه للإعادة
     * إلى ما لا نهاية. والجلسة تُمسح لأن إعادة المحاولة بنفس الرقم لن تنجح.
     */
    if (isDuplicateNationalId(registered.error)) {
      await deps.sessions.clear(sender.telegramUserId);
      // البند 4.3: رفضٌ مفهوم لا خروج من البوت — ومن رُفض لازدواج هويّة هو أوّل
      // من يحتاج زرّ الدعم، فإزالة اللوحة كانت تسدّ عليه الطريق الوحيد للاعتراض.
      return [reply(sender, tr("driver.national_id_taken"), menu(state))];
    }
    return technicalFailure(sender, state);
  }

  // بعد اكتمال التسجيل مباشرة: أوّل /start لم يجد حساباً ليرقّيه، وهذه أوّل لحظة يوجد فيها
  if (
    deps.bootstrapAdmin !== undefined &&
    deps.bootstrapAdmin.telegramId === sender.telegramUserId
  ) {
    await deps.bootstrapAdmin.grant(sender.telegramUserId);
  }

  /**
   * البند 2.4: الجلسة **لا** تُمسح هنا كما كانت، بل تُحوَّل إلى الخطوة الاختيارية.
   * الصفّ كُتب فعلاً قبل هذا السطر، فسقوط الخطوة الاختيارية أو تخطّيها لا يكلّف
   * السائق شيئاً — وهذا هو سبب وضعها بعد الكتابة لا قبلها.
   */
  const areaStep = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_preferred_area_label",
    draftPreferredAreaLabel: null,
  });

  const cities = await deps.cities.listActive();
  const cityName = cities.ok
    ? (cities.value.find((c) => c.id === state.draftCityId)?.name ?? "")
    : "";

  const replies: BotReply[] = [
    // كان `remove`: فينتهي التسجيل بإخلاء أسفل الشاشة تماماً، فيبقى السائق الجديد
    // ولا يعرف ما يفعل بعدها — وهي أحرج لحظة في رحلته كلّها. ومن أجلها القائمة.
    reply(
      sender,
      tr("driver.registered", { name: registered.value.fullName, city: cityName }),
      mainMenuKeyboard("driver", languageOf(state)),
    ),
  ];

  const trialResult = await deps.trial.startTrial(registered.value.id, serviceRaw);
  if (trialResult.ok && trialResult.value.started) {
    const settings = await citySettingsOf(deps, registered.value);
    if (settings !== null) {
      replies.push(reply(sender, tr("driver.trial_started", { days: settings.trialDays })));
    }
  } else if (trialResult.ok && trialResult.value.reason !== null) {
    replies.push(
      reply(sender, tr("driver.trial_not_started", { reason: trialResult.value.reason })),
    );
  }

  /**
   * سؤال المنطقة **آخر** الردود لا وسطها: خبر بدء التجربة المجانية هو ما ينتظره
   * السائق، ووضعُ سؤالٍ اختياري قبله يدفنه. ويُطرح فقط إن نجح حفظ الجلسة —
   * طرحُه مع جلسةٍ لم تُحفَظ يجعل جواب السائق يسقط في الفراغ ثم يُردّ عليه
   * بـ«أمر غير معروف». ومن لم يُسأل يبقى بلا منطقة، وهي الحال الافتراضية أصلاً.
   */
  if (areaStep.ok) {
    replies.push(
      reply(sender, tr("driver.preferred_area_ask_label"), preferredAreaSkipKeyboard(state)),
    );
  }

  return replies;
}

async function handleOfferDecision(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
  messageId?: string,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  /**
   * `WR-08` — مآلُ العرضِ يُكتَبُ **على بطاقتِه نفسِها** متى عُرِفَ معرّفُها: رفضٌ أو
   * انتهاءٌ أو سبقٌ أو حجزٌ أو انتظارُ الراكبِ أو قبولٌ. فتزولُ أزرارُ «قبول/رفض»
   * القديمةُ ولا تبقى البطاقةُ كأنَّها عرضٌ متاح. وإن تعذّرَ التعديلُ (رسالةٌ قديمة)
   * أرسلَ البوتُ الردَّ رسالةً جديدةً كما كان.
   */
  const onCard = (r: BotReply): BotReply =>
    messageId === undefined ? r : { ...r, editMessageId: messageId };
  const [action, idRaw] = parts;
  if (idRaw === undefined || idRaw === "") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const found = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  if (found.value === null) return [reply(sender, tr("driver.must_register_first"))];
  const driver = found.value;

  if (action === "reject") {
    /**
     * `BUG-003` — الرفضُ يصوبُ على عرضٍ واحدٍ بمعرّفِه لا على كلِّ عرضٍ معلَّقٍ
     * للسائقِ. فالزرُّ يحمِلُ `offerId`، فيُرفَضُ عرضُ الجولةِ الثانيةِ وحدهُ
     * ويبقى عرضُ الجولةِ الأولى معلَّقاً لم تنتهِ مهلتُه. والمعرّفُ واحدٌ لا
     * يتجزّأ، ولا يُخمَّنُ منه `orderId` ولا `round`.
     */
    const offerId = idRaw as OfferId;
    const rejected = await deps.offers.reject(offerId, driver.id);
    if (!rejected.ok) return technicalFailure(sender, state);
    return [onCard(reply(sender, tr("driver.offer_rejected")))];
  }

  if (action !== "accept") return [reply(sender, tr("common.unknown_command"))];

  /** القبولُ يبقى على `orderId` — `claim_ride` يختارُ أحدثَّ جولةٍ معلَّقةٍ ذرّياً. */
  const orderId = idRaw as OrderId;

  // القبول يمرّ عبر الدالة الذرّية claim_ride: هي الحكم الوحيد في التنافس
  const claim = await deps.dispatch.claimRide(orderId, driver.id);
  if (!claim.ok) return technicalFailure(sender, state);

  if (claim.value.claimed && claim.value.pendingRider === true) {
    /**
     * `WR-09` — الطلبُ محجوزٌ لهذا السائقِ والراكبُ يقرّر. لا إخطارَ «قبِلَ سائقٌ»
     * (إشعارُ المرشَّحِ أودعَته القاعدةُ في معاملةِ الحجز)، ولا زرَّ بدءٍ قبلَ الإسناد.
     * والمآلُ يصلُه رسالةً من صندوقِ الصادر (`driver_candidate_notice`).
     */
    return [
      onCard(
        reply(
          sender,
          tr("driver.candidate_waiting", {
            seconds: secondsUntil(claim.value.candidateExpiresAt ?? null, deps.clock.now()),
          }),
        ),
      ),
    ];
  }

  if (claim.value.claimed) {
    /**
     * `BUG-008` — إعادةُ تسليمٍ لنقرةِ الفائزِ نفسِه نجاحٌ **بلا أثرٍ ثانٍ**:
     * الراكبُ أُخطِرَ مرّةً عند الإسنادِ الواقعِ، فإخطارُه ثانيةً «قَبِلَ سائقٌ
     * طلبَك» كذبٌ ثانٍ في الاتّجاهِ المعاكس. والردُّ للسائقِ هو نفسُ ردِّ
     * النجاحِ الأوّلِ — فالتسليمُ المكرَّرُ لا يُميَّزُ عن الأصلِ في ما يراه.
     */
    if (deps.riderNotice !== undefined) {
      // `WR-15`: الإيداعُ بمفتاحِ منعِ التكرارِ يكفي للمكرَّرِ أيضاً — ولا يُلقي.
      await noticeRiderOfTrip(deps.riderNotice, String(orderId), "MATCHED");
    } else if (!claim.value.duplicate) {
      // الراكب يُخطَر قبل بناء ردّ السائق، والفشل مبتلَعٌ داخل الدالّة فلا يمسّ إسناداً وقع.
      await notifyRiderOfAcceptance(orderId, claim.value, deps);
    }
    // زرّ البدء يخرج مع تأكيد القبول: السائق لا يحفظ معرّف الطلب ولا يُطلب منه كتابته
    const keyboard =
      deps.rating === undefined ? null : startRideKeyboard(String(orderId), languageOf(state));
    const confirmation = onCard(reply(sender, tr("driver.offer_accepted"), keyboard));
    /**
     * المرحلة ١٢ — التأكيد يبقى، وتُلحق به البطاقة. ولماذا لا يُدمجان في رسالة؟
     * لأن زرّ «بدء الرحلة» مُعلَّقٌ على التأكيد، والدبّوس رسالةٌ منفصلة في تلغرام
     * أصلاً — فدمجُهما كان سيُنتج رسالةً واحدة طويلة يختفي زرّها تحت الدبّوس.
     *
     * وإن غاب القارئ (تهيئةٌ لا تعرض الرحلات) بقي السلوك كما كان بحرفه: تأكيدٌ
     * وزرّ. لا مسار جديد يُفرض على تركيبٍ لم يطلبه.
     */
    if (deps.tripCards === undefined) return [confirmation];
    const card = await tripCardReplies(
      sender,
      state,
      { driverId: driver.id },
      deps.tripCards,
      deps.routing ?? null,
    );
    return [confirmation, ...card];
  }

  const key =
    claim.value.reason === "offer_expired"
      ? "driver.offer_expired"
      : claim.value.reason === "ORDER_HELD"
        ? "driver.offer_held"
        : "driver.offer_taken";
  return [onCard(reply(sender, tr(key)))];
}

/** ثوانٍ صحيحةٌ حتى الموعد، بحدٍّ أدنى صفر. موعدٌ مجهولٌ ⇒ صفر (النصُّ لا يكذبُ بمهلة). */
function secondsUntil(iso: string | null, now: Date): number {
  if (iso === null) return 0;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

/**
 * §4.2 — إخطارُ الراكب بقبول سائق، بلغته هو، ومعه رابطُ تتبّعٍ مؤقّت إن أُمكن.
 *
 * لا تُلقي ولا تُعيد شيئاً: الإسناد وقع في القاعدة قبل هذه المكالمة، فإرجاعُ خطأٍ
 * منها كان سيُري السائق «فشل القبول» وهو قد نجح — فيضغط ثانيةً فيُقال له «سبقك
 * أحدهم» والرحلةُ رحلته. وفشلُ إصدار الرابط لا يمنع الإخطار نفسه: معرفةُ الراكب
 * أنّ سائقاً قبِل أولى من خريطةٍ تتحرّك.
 */
async function notifyRiderOfAcceptance(
  orderId: OrderId,
  claim: ClaimRideResult,
  deps: DriverBotDependencies,
): Promise<void> {
  const notice = deps.acceptNotice;
  const rider = claim.rider;
  if (notice === undefined || rider === null) return;
  const tr = t(rider.languageCode);
  const unknown = tr("tracking.unknown_value");
  const text = tr("tracking.rider_matched", {
    order: shortOrderId(String(orderId)),
    driver: claim.driverName ?? unknown,
    plate: claim.driverPlate ?? unknown,
    vehicle: claim.driverVehicle ?? unknown,
  });

  const link = notice.links === undefined ? null : await issueLink(orderId, rider, notice.links);
  const full = link === null ? text : `${text}\n\n${tr("tracking.rider_link", { url: link })}`;
  /**
   * الحاجزُ هنا لا في المحوّل وحده: `counterpartNotifier` الحيّ يبلع أعطالَه فعلاً،
   * لكن الحوارَ لا يجوز أن يتّكل على أدبِ تركيبٍ بعينه — ومُخطِرٌ يُلقي في تركيبٍ
   * آخر كان سيُري السائق «سبقك أحدهم» عن رحلةٍ صارت رحلته. اختبارٌ فعليّ أوقع هذا.
   */
  try {
    const followInApp: Keyboard | null =
      notice.miniAppUrl === undefined || notice.miniAppUrl === null
        ? null
        : {
            kind: "inline",
            rows: [
              [
                {
                  label: tr("miniapp.ride_button"),
                  webAppUrl: miniAppUrl(notice.miniAppUrl, {
                    audience: "rider",
                    screen: "ride",
                    id: String(orderId),
                  }),
                },
              ],
            ],
          };
    await notice.counterpart.notify(rider.telegramId, full, followInApp);
  } catch {
    // لا سبيلَ للتراجع ولا داعي: الإسنادُ نهائيّ، والراكب سيرى الحالة بـ`/status`.
  }
}

/** إصدارٌ لا يُسقِط الإخطار: ما فشل يخرج `null` فيُرسل النصّ وحده. */
async function issueLink(
  orderId: OrderId,
  rider: { readonly telegramId: string },
  links: IssueTrackingTokenDeps,
): Promise<string | null> {
  const telegramId = Number(rider.telegramId);
  if (!Number.isSafeInteger(telegramId)) return null;
  const issued = await issueTrackingToken({ orderId, telegramId }, links);
  return issued.ok ? issued.value.url : null;
}

/**
 * المرحلة ١٢ — بطاقة الرحلة كردودٍ جاهزة للإرسال. تُستخدم في ثلاثة مواضع:
 * `/trip`، وردّ قبول العرض، وردّ بدء الرحلة — بصيغةٍ واحدة لا ثلاث.
 *
 * وتُعيد مصفوفةً لأن «لا رحلة لك» ردٌّ واحد، والبطاقة ردٌّ واحد بدبّوس. ولا
 * تُلقي عند غياب الرحلة: السائق الذي أنهى رحلته وضغط `/trip` ليس في حالة عطل.
 */
export async function tripCardReplies(
  sender: Sender,
  state: DialogState,
  key: DriverTripKey,
  cards: DriverTripCardReader,
  routing: RoutingProvider | null,
  keyboard: Keyboard | null = null,
): Promise<BotReply[]> {
  const tr = t(languageOf(state));
  const card = await driverTripCard(key, { cards, routing });
  if (card === null) return [reply(sender, tr("driver.trip_none"), keyboard)];
  const { view, eta } = card;
  const base = reply(sender, driverTripText(view, eta, tr), keyboard);
  /**
   * الحقل يُسقَط ولا يُمرَّر `undefined`: التركيب يعمل بـ`exactOptionalPropertyTypes`،
   * فـ`mapPin: undefined` ليس كغياب `mapPin` — والمترجم أوقف هذا فعلاً.
   */
  const pin = driverTripPin(view, tr);
  return [pin === undefined ? base : { ...base, mapPin: pin }];
}

/**
 * موقع السائق يُحفظ فوراً: بلا موقع لا مطابقة، ومع موقع قديم تكون المطابقة كاذبة.
 * السائق غير المسجَّل لا يُحفظ له موقع إطلاقاً.
 */
/**
 * المرحلة ٥ — الإصلاحة السابقة للمُقيِّم. كانت `null` ثابتةً في المرحلة ٤، وهو
 * ما كان يُعطّل نصف المُقيِّم في المسار الحيّ: الإحداثيات والدقّة والزمن كانت
 * تُفحص، أمّا الإزاحة والانتقال اللحظي والسرعة المحسوبة فلا — لأنّها كلّها
 * تُقاس بين نقطتين، والثانية لم تكن تصل.
 *
 * وأثرُه العملي أن جهازاً مُزوَّراً يقفز مئتي كيلومتر بين رسالتين كان يمرّ
 * بلا أثر، فتراه المطابقة سائقاً قريباً من الراكب وهو في مدينة أخرى.
 */
function previousFixOf(driver: DriverProfile): PreviousFix | null {
  if (driver.lastFix === null) return null;
  const coordinates = makeCoordinates(driver.lastFix.latitude, driver.lastFix.longitude);
  // إحداثيةٌ محفوظةٌ فاسدة لا تُوقف الحاضر: تُهمَل كسابقةٍ فيُفحص الجديد وحده.
  if (!coordinates.ok) return null;
  return { coordinates: coordinates.value, recordedAtMs: driver.lastFix.recordedAtMs };
}

async function handleLocation(
  location: Coordinates,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
  hints?: LocationQualityHints,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const existing = await deps.drivers.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const driver = existing.value;
  if (driver === null) return [reply(sender, tr("driver.must_register_first"))];

  /**
   * البند 2.4: موقعٌ يصل في خطوة المنطقة المفضّلة هو مركز المنطقة لا موقع العمل
   * الحالي. الفصل هنا لا في حالة الاستخدام: خلطهما كان سيجعل كل تحديث موقع
   * يوميّ يُعيد رسم منطقة السائق المفضّلة، فتصير نيّتُه المعلنة ظلّاً لتحرّكه.
   *
   * والتقييمُ في هذا الفرعِ باقٍ كما كانَ حرفاً: نقطةٌ مرفوضةٌ لا تصيرُ مركزَ
   * منطقةٍ، والفرعُ لا يمرُّ بمسارِ الاستقبالِ أصلاً فلا كتابةَ موقعٍ فيه.
   */
  if (state.step === "awaiting_preferred_area_location") {
    const assessment = assessGpsFix(
      {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: hints?.accuracyMeters,
        headingDegrees: hints?.headingDegrees,
        recordedAtMs: hints?.recordedAtMs ?? deps.clock.now().getTime(),
      },
      previousFixOf(driver),
      deps.clock.now().getTime(),
      deps.gpsPolicy ?? DEFAULT_GPS_POLICY,
    );
    if (assessment.fix === null) return [reply(sender, tr("driver.location_invalid"))];
    return savePreferredArea(driver, assessment.fix.coordinates, sender, state, deps);
  }

  /**
   * `F4-01` — قرارُ الاستقبالِ صارَ في `updateDriverLocation` لا ههنا.
   *
   * وهذا ليسَ تنظيماً: مسارُ `POST /v1/driver/location` يستقبلُ الإصلاحةَ نفسَها،
   * ولو أعادَ بناءَ القرارِ لصارَ للنظامِ **حَكَمانِ على الأحدثِ** — وهوَ عينُ ما
   * ينهى عنه `ADR 0053 §٦` وما كلَّفَ `BUG-001` و`BUG-009` ثمنَهما. والترتيبُ
   * كلُّه (تقييمٌ ← كتابةٌ شرطيّةٌ ← امتناعُ نشرِ الأقدمِ ← جلسةٌ وبثٌّ ← إعادةُ
   * عرضٍ على الانتقالِ) محفوظٌ في موضعٍ واحدٍ يقرؤه المُراجِعُ مرّةً.
   *
   * وما بقيَ ههنا هوَ ما لا يعرفُه غيرُ الحوارِ: أيَّ رسالةٍ يُجيبُ، وأيَّ لوحةٍ
   * يُظهِرُ. و`stale` يُجابُ عنها بما يُجابُ عندَ الحفظِ: لم يقعْ عطلٌ، وموقعُه
   * المعروفُ عندَنا أحدثُ من نبضتِه هذه، ولا يُبنى على الرفضِ انتقالُ حالةٍ.
   */
  const ingested = await updateDriverLocation(
    {
      driver,
      latitude: location.latitude,
      longitude: location.longitude,
      ...(hints === undefined ? {} : { quality: hints }),
    },
    {
      drivers: deps.drivers,
      clock: deps.clock,
      ...(deps.gpsPolicy === undefined ? {} : { gpsPolicy: deps.gpsPolicy }),
      ...(deps.tracking === undefined ? {} : { tracking: deps.tracking }),
      ...(deps.redispatch === undefined ? {} : { redispatch: deps.redispatch }),
      // `F4-02`: المنفذُ يُمرَّرُ ولا يُقرأُ — والحقلُ يُسقَطُ عندَ الغيابِ
      // لا يُمرَّرُ `undefined`: `exactOptionalPropertyTypes`.
      ...(deps.hotState === undefined ? {} : { hotState: deps.hotState }),
      ...(deps.onHotStateDegraded === undefined
        ? {}
        : { onHotStateDegraded: deps.onHotStateDegraded }),
    },
  );
  if (!ingested.ok) {
    if (ingested.error.reason === "FIX_REJECTED") {
      return [reply(sender, tr("driver.location_invalid"))];
    }
    return technicalFailure(sender, state);
  }
  if (ingested.value.kind === "stale") {
    return [reply(sender, tr("driver.location_saved"), menu(state))];
  }

  // من كان متاحاً وينقصه الموقع فقد اكتملت شروطه الآن، فيُخبَر أنه صار ظاهراً
  // فعلاً — لا «حُفظ موقعك» وحدها، فهي لا تُعلمه أن الحجب عنه ارتفع.
  const becameLive = ingested.value.becameLive;
  return [
    reply(
      sender,
      tr(becameLive ? "driver.location_saved_now_live" : "driver.location_saved"),
      menu(state),
    ),
  ];
}

/**
 * البند 2.4 — الخطوة الاختيارية الأولى: اسم المنطقة.
 *
 * لماذا الاسم قبل النقطة لا العكس؟ لأن النقطة بلا اسم لا تُراجَع: موظّف التوثيق
 * يرى إحداثية عشرية لا يعرف أصحيحة هي أم أرسلها السائق وهو في مطار. والاسم
 * أوّلاً يجعل السائق يقرّر منطقته بوعي قبل أن يضغط زرّ الموقع.
 */
async function handlePreferredAreaLabel(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const parsed = parseAreaLabel(raw);
  if (!parsed.ok) {
    return [
      reply(
        sender,
        tr(`driver.preferred_area_label_invalid_${parsed.error.reason}`),
        preferredAreaSkipKeyboard(state),
      ),
    ];
  }

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_preferred_area_location",
    draftPreferredAreaLabel: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [
    reply(
      sender,
      tr("driver.preferred_area_ask_pin", { area: parsed.value }),
      preferredAreaLocationRequest(state),
    ),
  ];
}

/**
 * البند 2.4 — النقطة وصلت: تُكتب المنطقة كاملة وتُغلق الجلسة.
 *
 * فشل الكتابة لا يُعيد السائق إلى الخطوة: تسجيله مكتمل وحسابه يعمل، وحبسُه في
 * خطوة اختيارية بسبب عطلٍ لا يدَ له فيه عقوبةٌ على لا شيء. يُقال له إن المنطقة
 * لم تُحفَظ، وتُغلق الجلسة، وله أن يعيدها بـ/area متى شاء.
 */
async function savePreferredArea(
  driver: DriverProfile,
  location: Coordinates,
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(languageOf(state));
  const label = state.draftPreferredAreaLabel;
  if (label === null) {
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("driver.preferred_area_skipped"), menu(state))];
  }

  const written = await deps.drivers.setPreferredArea(driver.id, { label, location });
  await deps.sessions.clear(sender.telegramUserId);
  if (!written.ok) return [reply(sender, tr("driver.preferred_area_failed"), menu(state))];

  return [reply(sender, tr("driver.preferred_area_saved", { area: label }), menu(state))];
}

/** البند 2.4 — تخطّي صريح: لا منطقة، والترتيب بالقرب وحده كما كان. */
async function skipPreferredArea(
  sender: Sender,
  state: DialogState,
  deps: DriverBotDependencies,
): Promise<readonly BotReply[]> {
  await deps.sessions.clear(sender.telegramUserId);
  return [reply(sender, t(languageOf(state))("driver.preferred_area_skipped"), menu(state))];
}

/**
 * ازدواج الهوية يصل من القاعدة كخرق قيد فريد. نميّزه بالفهرس لا بنصّ عام:
 * "duplicate key" وحدها كانت ستبتلع أي ازدواج آخر فتقول للسائق سبباً خاطئاً.
 */
function isDuplicateNationalId(error: { readonly detail?: string } | unknown): boolean {
  const detail = (error as { readonly detail?: string }).detail ?? "";
  return detail.includes("drivers_city_national_id_uniq");
}
