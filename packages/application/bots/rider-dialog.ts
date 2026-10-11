/**
 * الغرض: منطق حوار بوت العميل: التسجيل، اختيار الخدمة (نقل/توصيل)، الطلب بموقع حقيقي،
 *   ثم بدء البحث عن سائق. مسار التوصيل يمرّ بحالة الاستخدام requestDelivery ولا يكرّر منطقها.
 * الحالة: منفّذ فعلياً — المرحلة 2.1، ووُسّع للتوصيل في المرحلة 2.2.
 * ينتمي إلى: application/bots
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/rider/index.ts
 * ملاحظات مستقبلية: التسعير المسبق يُضاف بقراءة تعرفة المدينة من platform_settings.
 */

import { haversineKm } from "../../domain/geo/index.ts";
import { makeCoordinates } from "../../domain/geo/value-objects.ts";
import { parseFullName } from "../../domain/identity/value-objects.ts";
import type { SupportTicketView } from "../../domain/support/ticket-types.ts";
import { DEFAULT_SESSION_POLICY } from "../../domain/tracking/session.ts";
import { t } from "../../shared/i18n/index.ts";
import type { Clock, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { requestDelivery } from "../delivery/request-delivery.ts";
import { type BroadcastDependencies, broadcastOffers } from "../dispatch/broadcast-offers.ts";
import {
  type RelayDependencies,
  relayNegotiationMessage,
} from "../dispatch/relay-negotiation-message.ts";
import {
  advanceNegotiationTurn,
  advanceNegotiationTurnAt,
  type NegotiationDriverCardReader,
  type RotateNegotiationDependencies,
  selectNegotiationDriver,
  settleNegotiation,
} from "../dispatch/rotate-negotiation-turn.ts";
import type { ReputationReader } from "../reputation/index.ts";
import { type TriggerSosDeps, TriggerSosError, triggerSos } from "../safety/trigger-sos.ts";
import {
  type IssueTrackingTokenDeps,
  issueTrackingToken,
} from "../tracking/issue-tracking-token.ts";
import type { LiveTrackingPort } from "../tracking/live-tracking.ts";
import { revokeOrderTrackingTokens } from "../tracking/revoke-tracking-token.ts";
import type { RideRequestCommand } from "../transport/ride-request-ports.ts";
import {
  handleLanguageCallback,
  handleLanguageCommand,
  type LanguageDialogDependencies,
} from "./language-dialog.ts";
import {
  commandForMenuText,
  helpKeyboard,
  isMenuCommand,
  type MenuContext,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "./main-menu.ts";
import { nameErrorKey } from "./name-errors.ts";
import { riderDriverInfoCard, riderPresentationCard } from "./negotiation-cards.ts";
import {
  handleRatingCallback,
  type RatingDialogDependencies,
  shortOrderId,
} from "./rating-dialog.ts";
import { reputationCardReplies } from "./reputation-card.ts";
import { readDialogSession, type SessionRead } from "./session-read.ts";
import {
  handleSupportGroupAction,
  type SupportDialogDependencies,
  startSupportDialog,
  submitSupportMessage,
} from "./support-dialog.ts";
import {
  type ActiveOrderSummary,
  type BotReply,
  type CityDirectory,
  type CityRef,
  type DialogState,
  INITIAL_STATE,
  type IncomingUpdate,
  type Keyboard,
  type OrderCancellationPort,
  type PastOrderSummary,
  type RiderDirectory,
  type RiderProfile,
  type Sender,
  type SessionStore,
} from "./types.ts";
import { waitBucket, waitingLine } from "./waiting-lines.ts";

export interface RiderBotDependencies {
  readonly sessions: SessionStore;
  readonly riders: RiderDirectory;
  readonly cities: CityDirectory;
  /**
   * منفذُ الإلغاءِ وحدَه — الإنشاءُ عبر `rides` (D-01).
   * الكتابةُ المباشرةُ في `orders` من البوتِ دَينٌ مغلقٌ.
   */
  readonly orders: OrderCancellationPort;
  /** الأمرُ الذرّيُّ الآمنُ لإنشاءِ الرحلةِ — مفتاحُ تكرارٍ وفحصُ منطقةٍ ومنعُ تكرارٍ. */
  readonly rides: RideRequestCommand;
  /** كل الطلبات النشطة للعميل — لا الأحدث وحده، فقد يملك مشواراً وطرداً معاً. */
  readonly activeOrdersOf: (riderId: RiderProfile["id"]) => Promise<readonly ActiveOrderSummary[]>;
  /**
   * سجلّ الطلبات المنتهية — البند 5.
   *
   * منفذٌ ثانٍ لا توسعةٌ للأول: `activeOrdersOf` يُنادى في كل `/help` و`/cancel`
   * و`/status`، فتحميله بصفوفٍ منتهية يُثقل أكثر المسارات طَرْقاً لأجل أندرها.
   */
  readonly pastOrdersOf: (riderId: RiderProfile["id"]) => Promise<readonly PastOrderSummary[]>;
  /**
   * تبعيات المطابقة والبثّ نفسها المستخدمة في broadcastOffers — لا تكرار للمنطق،
   * ومعها منفذُ إخطارِ الإلغاء: هذا البوت وحدَه هو من يلغي الطلب، فالحقلُ مطلوبٌ
   * هنا لا في تبعيات البثّ التي لا تستدعيه (BUG-004).
   */
  readonly matching: BroadcastDependencies;
  readonly clock: Clock;
  /** مسار التفاوض مع غير المشتركين (المرحلة 2.3) — اختياري كما في بوت السائق. */
  readonly negotiation?: {
    readonly rotation: RotateNegotiationDependencies;
    readonly relay: RelayDependencies;
    /** `NEG-SELECT-01` — بطاقةُ السائقِ المعروضِ. غيابُها يُعطِّلُ أزرارَ الاختيارِ وحدَها. */
    readonly driverCards?: NegotiationDriverCardReader;
  };
  /** مسار الدعم (المرحلة 2.4) — نزاعات الرحلات فقط: العميل لا اشتراك له. */
  readonly support?: SupportDialogDependencies;
  /** التقييم (المرحلة 2.5) — العميل يقيّم السائق فقط، فلا يحتاج منفذ دورة الرحلة. */
  readonly rating?: RatingDialogDependencies;
  /** اختيار اللغة (المرحلة 2.6) — نفس الحوار المستخدَم في بوت السائق حرفياً. */
  readonly language?: LanguageDialogDependencies;
  /**
   * منفذ التتبّع اللحظي — المرحلة ١١، للإلغاء وحده.
   *
   * ولماذا يدخل حوارَ العميل وقد كان في حوار التقييم فقط؟ لأن للرحلة نهايتين لا
   * نهايةً واحدة: تكتمل فتُغلقها `rating-dialog` بـ`TRIP_COMPLETED`، أو تُلغى —
   * ولم يكن للإلغاء مسارٌ إلى التتبّع إطلاقاً. فكان العميل يُلغي طلبه وتبقى في
   * محادثته خريطةٌ تُعلنها تلغرام «حيّة» على آخر موضعٍ لسائقٍ لم تعد له به صلة.
   *
   * اختياريٌّ كـ`rating`: التتبّع **عونٌ لا شرط** (نفس مبدأ الحاجز في
   * `live-tracking.ts`)، فحوارٌ يُركَّب بلا تتبّع في اختبارٍ يجب أن يُلغي الطلب
   * لا أن يفشل.
   */
  readonly tracking?: LiveTrackingPort;
  /**
   * §4.2 — روابطُ التتبّع المؤقّتة: زرّ «شارك موقعي الحي» وزرّ «إلغاء الرابط».
   *
   * اختياريٌّ لأنّ الرابط يحتاج `TRACKING_TOKEN_BASE_URL`، والتركيبُ بلا أساسٍ عامٍّ
   * لا يجوز أن يعرض زرّاً يُنتج رابطاً لا يُفتح. غيابه = لا زرّين، لا زرّان يفشلان.
   */
  readonly trackingLinks?: IssueTrackingTokenDeps;
  /** SOS اختياري في الاختبارات القديمة، ومربوط دائماً في الحاوية الحية. */
  readonly safety?: { readonly trigger: TriggerSosDeps };
  /**
   * `F16-01` — قارئُ السمعةِ لأمرِ `/rating`: السائقُ يقيّمُ الراكبَ أيضاً، فالسمعةُ
   * ليست حكراً على السائقين. اختياريٌّ بنفس منطق `safety`: غيابُهُ يردُّ «أمرٌ غيرُ
   * معروف» لا بطاقةً فارغةً، والتوصيلُ في الحاويةِ دائمٌ في الإنتاجِ.
   */
  readonly reputation?: ReputationReader;
  /**
   * PD-053 — قائمة تذاكر الدعم للراكب: نتيجة الإجراء تصل صاحبها لا تُدفن في القروب.
   * اختياري عمداً: غيابه يعني أن المسار غير مُجهَّز في هذه الحاوية.
   */
  readonly ticketLister?: {
    readonly list: (telegramUserId: string) => Promise<readonly SupportTicketView[]>;
  };
}

/**
 * PD-053 — تنسيق تذكرة دعم واحدة لعرضها في البوت: المرجع، الصنف، الحالة، والقرار.
 */
function formatTicketLine(
  ticket: SupportTicketView,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  const statusKey =
    ticket.status === "open"
      ? "support.status_open"
      : ticket.status === "claimed"
        ? "support.status_claimed"
        : ticket.status === "resolved"
          ? "support.status_resolved"
          : "support.status_closed";
  const categoryKey =
    ticket.category === "lost_item"
      ? "support.category_lost_item"
      : ticket.category === "ride_dispute"
        ? "support.category_ride_dispute"
        : ticket.category === "driver_conduct"
          ? "support.category_driver_conduct"
          : ticket.category === "app_problem"
            ? "support.category_app_problem"
            : ticket.category === "deduction"
              ? "support.category_deduction"
              : ticket.category === "subscription"
                ? "support.category_subscription"
                : "support.category_other";
  const resolution =
    ticket.resolution === null ? "" : ` — ${tr("support.resolution_label")}: ${ticket.resolution}`;
  return `• ${ticket.reference} — ${tr(categoryKey)} — ${tr(statusKey)}${resolution}`;
}

/**
 * PD-053 — تنسيق صفحة تذاكر الدعم للراكب.
 */
function formatTicketsPage(
  tickets: readonly SupportTicketView[],
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (tickets.length === 0) return tr("support.no_tickets");
  return tickets.map((t) => formatTicketLine(t, tr)).join("\n");
}

function reply(sender: Sender, text: string, keyboard: Keyboard | null = null): BotReply {
  return { chatId: sender.chatId, text, keyboard };
}

/** القائمة الدائمة بلغة الحالة الحالية — لغة الجلسة لا ثابتة، فالقائمة تُبنى عند كل ردّ. */
function menu(state: DialogState, context: MenuContext = {}): Keyboard {
  return mainMenuKeyboard("rider", state.language, context);
}

/** طلب الموقع ومعه القائمة الرئيسية تحته — البند 4.3: لا تُمحى القائمة في منتصف الطلب. */
function locationRequest(state: DialogState): Keyboard {
  return requestWithMenuKeyboard(
    { kind: "request_location", label: t(state.language)("rider.share_location_button") },
    "rider",
    state.language,
  );
}

/** قائمةٌ فيها زرّ التتبّع — تُستعمل حيث نعلم يقيناً أنّ للعميل طلباً نشطاً. */
function trackingMenu(state: DialogState): Keyboard {
  return menu(state, { hasActiveOrder: true });
}

function cityKeyboard(cities: readonly CityRef[]): Keyboard {
  return {
    kind: "inline",
    rows: cities.map((city) => [{ label: city.name, data: `city:${city.id}` }]),
  };
}

async function loadState(deps: RiderBotDependencies, sender: Sender): Promise<SessionRead> {
  return readDialogSession(deps.sessions, sender.telegramUserId, {
    ...INITIAL_STATE,
    language: sender.languageHint === "en" ? "en" : "ar",
  });
}

/**
 * `D-36`: نقراتٌ لا معنى لها إلّا بطورِ الحوارِ (المدينةُ · الخدمةُ · الرجوعُ). وما عداها
 * من نقراتٍ مصدرُ حقيقتِه القاعدةُ فيبقى يعملُ والجلسةُ متعذِّرةٌ (`ADR 0194`).
 */
const RIDER_STEP_CALLBACKS: ReadonlySet<string> = new Set(["city", "svc", "back"]);

function technicalFailure(sender: Sender, state: DialogState): readonly BotReply[] {
  return [reply(sender, t(state.language)("common.error_try_again"))];
}

export async function handleRiderUpdate(
  update: IncomingUpdate,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  /**
   * طلبُ انضمامٍ إلى قروبٍ (`PD-001`): قروبُ غيرِ المشتركينَ مسارُ سائقينَ،
   * وبوّابتُهُ في بوتِ السائقِ (`ADR 0157`). وإن وصلَ بوتَ العميلِ فإقرارُ استلامٍ
   * بلا حكمٍ — **قبلَ تحميلِ الجلسةِ** كي لا يُخلَقَ أثرٌ لمن لم يحاورِ البوتَ.
   */
  if (update.kind === "join_request" || update.kind === "member_joined") return [];

  const sender = update.from;
  const { state, unreadable } = await loadState(deps, sender);
  const tr = t(state.language);

  if (update.kind === "callback") {
    const [prefix, ...rest] = update.data.split(":");
    if (unreadable && prefix !== undefined && RIDER_STEP_CALLBACKS.has(prefix)) {
      return technicalFailure(sender, state);
    }
    if (prefix === "lang") {
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCallback(update.data, sender, state.language, deps.language);
    }
    if (prefix === "city") return handleCitySelected(rest.join(":"), sender, state, deps);
    if (prefix === "svc") return handleServiceSelected(rest.join(":"), sender, state, deps);
    if (prefix === "back") return handleBack(rest.join(":"), sender, state, deps);
    if (prefix === "unsub") {
      return handleNegotiationDecision(rest, sender, state, deps, update.messageId);
    }
    if (prefix === "cancel") return handleCancelChoice(rest.join(":"), sender, state, deps);
    if (prefix === "sos") return handleSosCallback(rest, sender, state, deps);
    if (prefix === "trk") return handleTrackingLinkCallback(rest, sender, state, deps);
    // البند 6.3: زرّ أمرٍ من لوحة `/help` — يمرّ بنفس موجّه الأوامر لا بمسار ثانٍ
    if (prefix === "cmd") {
      const command = rest.join(":");
      return isMenuCommand("rider", command)
        ? handleCommand(command, sender, state, update.updateId, deps)
        : [reply(sender, tr("common.unknown_command"))];
    }
    if (prefix === "rate") {
      return deps.rating === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleRatingCallback(update.data, sender, state.language, deps.rating);
    }
    if (prefix === "sup") {
      return deps.support === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleSupportGroupAction(rest, sender, state, deps.support);
    }
    return [reply(sender, tr("common.unknown_command"))];
  }

  // `D-36`: نقطةُ الراكبِ وصورتُه لا تُفهَمانِ إلّا بالطورِ، والطورُ لم يُقرَأْ.
  if (unreadable && (update.kind === "location" || update.kind === "photo")) {
    return technicalFailure(sender, state);
  }

  if (update.kind === "location") {
    return handleLocation(update.location, sender, state, update.updateId, deps);
  }

  if (update.kind === "photo") {
    if (state.step !== "awaiting_support_message" || deps.support === undefined) {
      return [reply(sender, tr("common.unknown_command"))];
    }
    return submitSupportMessage(
      {
        message: update.caption ?? tr("support.photo_only_message"),
        attachmentFileId: update.fileId,
      },
      sender,
      state,
      deps.support,
    );
  }

  if (update.kind === "contact" || update.kind === "unsupported") {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const text = update.text.trim();
  if (text.startsWith("/")) return handleCommand(text, sender, state, update.updateId, deps);

  // زرّ القائمة الدائمة يصل نصّاً لا بيانات (Reply Keyboard)، فيُترجَم إلى أمره هنا —
  // **قبل** أي فحص خطوة. الموضع هو المطلوب نفسه في البند 4.3: ضغطة واحدة في كل
  // الحالات. ولو جاء الفحص بعد الخطوات لصار زرّ «الدعم» يُسجَّل اسماً للعميل الجديد.
  const fromMenu = commandForMenuText("rider", text);
  if (fromMenu !== null) return handleCommand(fromMenu, sender, state, update.updateId, deps);

  // `D-36`: نصٌّ حرٌّ والطورُ مجهولٌ — يُنقَلُ إلى تفاوضٍ قائمٍ في القاعدةِ إن وُجِدَ، وإلّا
  // فعطلٌ صادقٌ: لعلَّه اسمٌ أو وصفُ طردٍ أو رسالةُ دعمٍ لا نعرفُ أيَّها.
  if (unreadable) return handleFreeText(text, sender, state, deps, technicalFailure);

  if (state.step === "awaiting_name") return handleName(text, sender, state, deps);
  if (state.step === "awaiting_support_message") {
    return deps.support === undefined
      ? [reply(sender, tr("common.unknown_command"))]
      : submitSupportMessage(
          { message: text, attachmentFileId: null },
          sender,
          state,
          deps.support,
        );
  }
  if (state.step === "awaiting_parcel")
    return handleParcel(text, sender, state, update.updateId, deps);
  if (state.step === "awaiting_pickup" || state.step === "awaiting_dropoff") {
    // لا نقبل عنواناً نصياً مكان إحداثيات: الموقع الوهمي أسوأ من لا موقع
    return [reply(sender, tr("rider.location_required"))];
  }
  return handleFreeText(text, sender, state, deps);
}

/** نصّ حرّ من عميل لا يمرّ بخطوة حوار: يُمرّر للسائق صاحب الدور إن وُجِد. */
async function handleFreeText(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
  unmatched: (sender: Sender, state: DialogState) => readonly BotReply[] = (to, from) => [
    reply(to, t(from.language)("common.unknown_command")),
  ],
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const negotiation = deps.negotiation;
  if (negotiation === undefined) return unmatched(sender, state);

  const found = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  const rider = found.value;
  if (rider === null) return unmatched(sender, state);

  const relayed = await relayNegotiationMessage(
    { from: "rider", driverId: null, riderId: rider.id, text },
    negotiation.relay,
  );
  if (!relayed.ok) return technicalFailure(sender, state);

  const report = relayed.value;
  if (report.reason === "NO_ACTIVE_NEGOTIATION" || report.reason === "EMPTY_MESSAGE") {
    return unmatched(sender, state);
  }
  if (report.reason === "UNREACHABLE") return [reply(sender, tr("negotiation.relay_unreachable"))];
  if (report.reason === "AWAITING_SELECTION") {
    return [reply(sender, tr("negotiation.rider_awaiting_selection"))];
  }
  if (report.redacted > 0) return [reply(sender, tr("negotiation.relay_redacted"))];
  return [];
}

/**
 * قرار العميل في التفاوض: «تم الاتفاق» يثبّت الإسناد، و«السائق التالي» يغلق القناة
 * ويفتحها مع التالي فوراً. الإخطارات من حالة الاستخدام نفسها، فلا تكرار هنا.
 */
/**
 * وصف الطلب في قائمة الاختيار. لا نعرض معرّف UUID على العميل: هو لا يعرفه ولا
 * يميّز به شيئاً. نعرض نوع الخدمة ووجهته ووقته، وهي ما يميّز طلباً عن آخر فعلاً.
 */
function describeActiveOrder(order: ActiveOrderSummary, language: string): string {
  const tr = t(language);
  const service = tr(
    order.service === "delivery" ? "rider.service_delivery" : "rider.service_transport",
  );
  const place = order.dropoffLabel ?? order.pickupLabel;
  const time = order.createdAt.toISOString().slice(11, 16);
  return place === null ? `${service} — ${time}` : `${service} — ${place} — ${time}`;
}

/**
 * سطر الطلب المنتهي في «طلباتي السابقة» — البند 5.
 *
 * التاريخ يُعرض واليومُ وحده لا يكفي: سجلٌّ بلا تاريخ يجعل طلبَ الأمس وطلبَ الشهر
 * الماضي سطرين متشابهين، والسؤال الذي يُفتح لأجله السجلّ أصلاً «متى كانت تلك الرحلة؟».
 *
 * ونهاية الطلب تُقال بنصّها لا بحالتها الخام: «cancelled» كلمةٌ إنجليزية في رسالة
 * عربية، ومن قرأها لا يعلم أهو ألغى أم أُلغي عليه.
 */
function describePastOrder(order: PastOrderSummary, language: string): string {
  const tr = t(language);
  const service = tr(
    order.service === "delivery" ? "rider.service_delivery" : "rider.service_transport",
  );
  // لحظة الانتهاء أدقّ من لحظة الإنشاء في سجلٍّ مرتَّب بالانتهاء؛ ولطلبٍ لم تُكتب
  // له نهاية يبقى الإنشاء أصدق ما يُعرف عنه.
  const when = (order.endedAt ?? order.createdAt).toISOString().slice(0, 16).replace("T", " ");
  const lines: string[] = [`${service} — ${when}`];

  const place = order.dropoffLabel ?? order.pickupLabel;
  if (place !== null && place.trim() !== "") lines.push(place);

  if (order.status === "completed") lines.push(tr("rider.history_completed"));
  else if (order.status === "cancelled") lines.push(tr("rider.history_cancelled"));
  else lines.push(tr("rider.history_failed"));

  if (order.driverName !== null && order.driverName.trim() !== "") {
    lines.push(tr("rider.history_driver", { name: order.driverName }));
  }

  // التقييم يُعرض للمكتمل وحده: «لم تقيّم بعد» على طلبٍ أُلغي دعوةٌ إلى تقييم
  // رحلةٍ لم تقع، وهي ما يرفضه `record_rating` في القاعدة أصلاً.
  if (order.status === "completed") {
    lines.push(
      order.ratingStars === null
        ? tr("rider.history_unrated")
        : tr("rider.history_rated", { bar: "⭐".repeat(order.ratingStars) }),
    );
  }

  return lines.join("\n");
}

/**
 * من متى يطول الانتظار فيستحقّ أن ندلّ العميل على الدعم من تلقائنا.
 * ربع ساعة بلا سائق في مدينة عاملة ليس تأخّراً طبيعياً، والسكوت عنه يترك العميل
 * ينتظر بلا أداة فعل — وهي الشكوى التي تصل الدعم متأخّرةً دائماً.
 */
const LONG_WAIT_MINUTES = 15;

/** دقائق الانتظار من إنشاء الطلب، غير سالبة أبداً (ساعة قاعدة تسبق ساعتنا ثوانٍ). */
function waitedMinutes(order: ActiveOrderSummary, now: Date): number {
  const elapsed = now.getTime() - order.createdAt.getTime();
  return elapsed <= 0 ? 0 : Math.floor(elapsed / 60_000);
}

/**
 * حدّ قدم الموقع المعروض للعميل — المرحلة ١١.
 *
 * ولا يُكتب رقمٌ جديد هنا: هو **نفس** الحدّ الذي يحكم به المجال على جلسة
 * التتبّع أنّها `STALE`. وحدٌّ ثانٍ أطول «لأن العميل لا يحتمل الإزعاج» يُنتج
 * حالاً يرى فيها المشغّل سائقاً منقطعاً ويرى العميل موقعاً يُعرَض بلا تحفّظ —
 * واختلافُ الحكمين على الواقعة نفسها هو ما يُمنع.
 */
export const DRIVER_LOCATION_STALE_SECONDS = DEFAULT_SESSION_POLICY.staleAfterSeconds;

/**
 * قرب السائق من المرجع الذي يعني العميل في هذه اللحظة — دالةٌ نقيّة لتُختبر
 * مباشرةً بلا بوتٍ ولا قاعدة.
 *
 * `null` لا «صفر متر» عند الجهل: مسافةٌ مخترعةٌ تقود عميلاً إلى الرصيف لسائقٍ
 * لم يُرسل موقعاً قطّ، وسطرٌ غائبٌ أصدق من رقمٍ كاذب.
 */
export function driverProximity(
  order: ActiveOrderSummary,
  now: Date,
): {
  readonly meters: number;
  readonly towards: "PICKUP" | "DROPOFF";
  readonly ageSeconds: number;
  readonly stale: boolean;
} | null {
  const at = order.assignedDriver?.lastLocation ?? null;
  if (at === null) return null;

  /**
   * المرجع يتبع الحالة لا ثابتاً واحداً، لأن السّؤال نفسه يتغيّر:
   *  - `matched`: العميل واقفٌ عند موضع الانطلاق يسأل «كم بقي ليصلَني؟»
   *  - `in_progress`: العميل داخل المركبة يسأل «كم بقي لأصلَ؟»
   * وقياسٌ واحد للحالتين يُعطي «يبعد عنك ٥٠ متراً» لمن هو جالسٌ في السيّارة.
   *
   * وما سوى الحالتين لا مرجع له: `searching` لا سائق له أصلاً.
   */
  const reference =
    order.status === "in_progress"
      ? (order.dropoff ?? null)
      : order.status === "matched"
        ? (order.pickup ?? null)
        : null;
  if (reference === null) return null;

  const meters =
    haversineKm(
      { latitude: at.lat, longitude: at.lng },
      { latitude: reference.lat, longitude: reference.lng },
    ) * 1000;

  // غير سالبٍ أبداً — نفس علّة `waitedMinutes`: ساعةُ جهاز السائق قد تسبق ساعتنا
  // ثوانٍ، و«قبل ٣- ثانية» تقرأ عطلاً لا حداثةً.
  const elapsed = now.getTime() - at.recordedAt.getTime();
  const ageSeconds = elapsed <= 0 ? 0 : Math.floor(elapsed / 1000);

  return {
    meters,
    towards: order.status === "in_progress" ? "DROPOFF" : "PICKUP",
    ageSeconds,
    stale: ageSeconds > DRIVER_LOCATION_STALE_SECONDS,
  };
}

/**
 * سطر المسافة — والتقريب فيه أمانةٌ لا تراخٍ.
 *
 * فـ`haversineKm` تقيس خطّاً مستقيماً لا مسار طريق، ودقةُ GPS نفسها بعشرات
 * الأمتار. فـ«١٤٧٣ متراً» تدّعي دقّةً لا نملكها مرتين: في الموضع وفي الطريق.
 * ولذلك لا يُذكر وقتٌ متوقّع (ETA) ألبتّة: الوقت يحتاج مساراً حقيقيّاً من OSRM
 * وهو غير موصول (خطر R-28)، وETA مشتقٌّ من خطٍّ مستقيم وعدٌ للعميل بما لا نعرفه.
 */
function distanceLine(
  tr: (key: string, vars?: Record<string, string | number>) => string,
  meters: number,
  towards: "PICKUP" | "DROPOFF",
): string {
  const suffix = towards === "DROPOFF" ? "dropoff" : "pickup";
  if (meters < 1000) {
    // لأقرب مئة متر، وبحدّ أدنى مئة: «صفر متر» تُقرأ «وصل» ولمّا يصل.
    return tr(`rider.status_distance_${suffix}_m`, {
      meters: Math.max(100, Math.round(meters / 100) * 100),
    });
  }
  return tr(`rider.status_distance_${suffix}_km`, {
    km: (Math.round(meters / 100) / 10).toFixed(1),
  });
}

/**
 * تقرير حالة طلب واحد: الحالة، والسائق ولوحته إن أُسنِد، ومدّة الانتظار.
 *
 * حالة غير معروفة لا تُسكِت الردّ: استعلام الطلبات النشطة قد يوسّع يوماً، فمن يسأل
 * «أين طلبي؟» يجب أن يرى طلبه ووقته على الأقل، لا رسالة فارغة.
 */
function describeOrderStatus(
  order: ActiveOrderSummary,
  language: string,
  now: Date,
): { readonly text: string; readonly photoFileId?: string } {
  const tr = t(language);
  const lines: string[] = [tr("rider.status_heading"), describeActiveOrder(order, language)];

  if (order.status === "matched") lines.push(tr("rider.status_matched"));
  else if (order.status === "in_progress") lines.push(tr("rider.status_in_progress"));
  else if (order.status === "searching") {
    // السطرُ يتغيّر مع دِلاء الانتظار: من يفتح «طلبي» ثلاث مرّات في دقيقةٍ يجب أن يرى
    // ثباتاً، ومن ينتظر عشرَ دقائق يجب أن يرى أنّ البحث ما زال يتحرّك لا أنّه معلّق.
    const minutes = Math.floor((now.getTime() - order.createdAt.getTime()) / 60000);
    lines.push(
      waitingLine("riderStillSearching", `${order.orderId}:${waitBucket(minutes)}`, language),
    );
  }

  const driver = order.assignedDriver ?? null;
  if (driver !== null) {
    lines.push(tr("rider.status_driver", { name: driver.fullName }));
    if (driver.vehicleType !== null && driver.vehicleType.trim() !== "") {
      lines.push(tr("rider.status_vehicle", { vehicle: driver.vehicleType }));
    }
    // لوحة ناقصة تُقال صراحةً لا تُسكت: سطرٌ غائب يُقرأ «لم يُرسل البوت كلّ شيء»
    lines.push(
      driver.plateNumber === null || driver.plateNumber.trim() === ""
        ? tr("rider.status_plate_missing")
        : tr("rider.status_plate", { plate: driver.plateNumber }),
    );

    /**
     * المرحلة ١١ — وأخيراً يجيب `/status` عن السّؤال الذي بُني له.
     *
     * وكان يقول اسم السائق ولوحته ولا يقول أين هو — والموقع مخزّنٌ في
     * `drivers.last_location` والمسافة تُحسب بـ`haversineKm` الموجودة والمستعملة
     * في الإسناد. فالنقص لم يكن في البيانات ولا في الحساب، بل في أن أحداً
     * لم يوصل الأوّل بالثاني عند العميل.
     *
     * والسطر يُحذف كلّه عند الجهل لا يُكتب «غير معروف»: اللوحة الناقصة تُقال
     * صراحةً لأنّها **عيب تسجيل** يُطلب من الدعم إصلاحه، وموقعٌ لم يُرسل
     * بعد حالٌ طبيعيّة في أوّل لحظات الإسناد لا يفعل العميل لها شيئاً.
     */
    const near = driverProximity(order, now);
    if (near !== null) {
      lines.push(distanceLine(tr, near.meters, near.towards));
      // والتحفّز لا يُكتب إلا حين يلزم: سطرٌ يُلازم كلّ تحديثٍ يُقرأ زخرفاً فيُتجاهل
      // حين يصدق فعلاً — وهو أسوأ من غيابه.
      if (near.stale) {
        lines.push(
          near.ageSeconds < 60
            ? tr("rider.status_location_stale_seconds", { seconds: near.ageSeconds })
            : tr("rider.status_location_stale_minutes", {
                minutes: Math.floor(near.ageSeconds / 60),
              }),
        );
      }
    }
  }

  const minutes = waitedMinutes(order, now);
  lines.push(
    tr(minutes >= LONG_WAIT_MINUTES ? "rider.status_waiting_long" : "rider.status_waiting", {
      minutes,
    }),
  );

  const text = lines.join("\n");
  const photo = driver?.vehiclePhotoFileId ?? null;
  // صورة المركبة تُرسل مع التقرير تعليقاً لا رسالة ثانية: رسالتان قد تفترقان
  // في محادثة مزدحمة، فيرى العميل صورة سيارة لا يعرف لأيّ طلب هي.
  return photo === null || photo.trim() === "" ? { text } : { text, photoFileId: photo };
}

/**
 * البند 2.2 — «أين طلبي؟ / أين سائقي؟» بضغطة واحدة.
 *
 * يُعرض كل طلب نشط لا الأحدث وحده، لنفس السبب الذي فرض ذلك على /cancel:
 * من له مشوار وطرد معاً ورأى حالة أحدهما وحده يحسب الآخر منتهياً.
 */
async function handleStatus(
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"))];

  const active = await deps.activeOrdersOf(rider.value.id);
  // القائمة تُصحّح نفسها هنا: من انتهى طلبه وبقي الزرّ معروضاً على جهازه
  // يردّ عليه بجواب صحيح وبلوحة بلا زرّ تتبّع، فيستوي المعروض مع الواقع.
  if (active.length === 0) {
    // أسماء الأزرار تُقرأ من مفاتيحها لا تُكتب في النصّ: نصٌّ يسمّي زرّاً ثم يتغيّر الزرّ يكذب
    return [
      reply(
        sender,
        tr("rider.status_none", {
          delivery_button: tr("menu.rider.delivery"),
          ride_button: tr("menu.rider.ride"),
        }),
        menu(state),
      ),
    ];
  }

  const now = deps.clock.now();
  const cards = active.map((order, index) => {
    const described = describeOrderStatus(order, state.language, now);
    // اللوحة مع الردّ الأخير وحده: تلغرام يُبقي المعروضة أخيراً، وإرسالها مع كل ردّ تكرار بلا أثر
    const keyboard = index === active.length - 1 ? trackingMenu(state) : null;
    return described.photoFileId === undefined
      ? reply(sender, described.text, keyboard)
      : {
          chatId: sender.chatId,
          text: described.text,
          keyboard,
          photoFileId: described.photoFileId,
        };
  });

  /**
   * §4.2 — رسالةُ الروابط تُلحَق بعد البطاقات ولا تحلّ محلّها. وتُقصَر على الطلبات
   * التي أُسندت فعلاً: طلبٌ مازال `searching` لا موقعَ سائقٍ فيه يُتابع، وعرضُ الزرّ
   * عليه كان وعداً بخريطةٍ فارغة — والقاعدةُ ترفضه أصلاً بلا موقع.
   */
  if (deps.trackingLinks === undefined) return cards;
  const linkable = active.filter(
    (order) => order.status === "matched" || order.status === "in_progress",
  );
  if (linkable.length === 0) return cards;
  return [
    ...cards,
    reply(sender, tr("tracking.share_prompt"), trackingLinksKeyboard(linkable, state.language)),
  ];
}

/**
 * §4.2 — زرّا الراكب: إصدارُ رابطٍ مؤقّت، وإلغاءُ ما أُصدِر.
 *
 * البيان معرّفُ الطلب لا الرمز: الرمزُ مفتاحٌ لمن يحمله، وكتابته في بيانٍ
 * يبقى في تاريخ المحادثة تجعل لقطةَ شاشةٍ للأزرار كافيةً لفتح الصفحة.
 */
async function handleTrackingLinkCallback(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const links = deps.trackingLinks;
  const [action, orderIdRaw] = parts;
  if (links === undefined || orderIdRaw === undefined || orderIdRaw === "") {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const orderId = orderIdRaw as OrderId;
  const telegramId = Number(sender.telegramUserId);
  if (!Number.isSafeInteger(telegramId)) return [reply(sender, tr("common.error_try_again"))];

  if (action === "off") {
    const revoked = await revokeOrderTrackingTokens({ orderId, telegramId }, links);
    if (!revoked.ok) return [reply(sender, tr("common.error_try_again"))];
    // الفرقُ يُقال للمستخدم: من لا رابطَ له يرى «لا روابط سارية» لا تأكيداً
    // كاذباً بإلغاءٍ لم يقع.
    const key = revoked.value > 0 ? "tracking.revoked" : "tracking.revoke_none";
    return [reply(sender, tr(key, { order: shortOrderId(String(orderId)) }), trackingMenu(state))];
  }

  if (action !== "new") return [reply(sender, tr("common.unknown_command"))];

  const issued = await issueTrackingToken({ orderId, telegramId }, links);
  if (!issued.ok) {
    /**
     * «لا تملك هذا الطلب» و«الطلب ليس جارياً» يُردّان برسالةٍ واحدة: التمييز
     * مِسبرٌ يُخبر من يجرّب معرّفاتٍ أيُّها طلبٌ قائمٌ لغيره.
     */
    const reason = issued.error.reason;
    const key =
      reason === "UNAUTHORIZED" || reason === "ORDER_NOT_ACTIVE" || reason === "ORDER_NOT_FOUND"
        ? "tracking.share_not_active"
        : "tracking.share_failed";
    return [reply(sender, tr(key), trackingMenu(state))];
  }

  const minutes = Math.max(
    1,
    Math.round((issued.value.expiresAt.getTime() - deps.clock.now().getTime()) / 60_000),
  );
  return [
    reply(
      sender,
      tr("tracking.share_ready", {
        order: shortOrderId(String(orderId)),
        minutes: String(minutes),
        url: issued.value.url,
      }),
      trackingMenu(state),
    ),
  ];
}

/**
 * لوحةُ الروابط: سطرٌ لكلّ طلبٍ جارٍ فيه زرّا المشاركة والإلغاء. ولماذا
 * لوحةٌ داخليّةٌ في رسالةٍ منفصلة لا مع بطاقة الحالة؟ لأنّ تلغرام لا يحمل لوحةً
 * داخليّةً وقائمةً دائمةً في رسالةٍ واحدة — فإلحاقها ببطاقة الحالة كان سيمحو القائمة.
 */
function trackingLinksKeyboard(orders: readonly ActiveOrderSummary[], language: string): Keyboard {
  const tr = t(language);
  return {
    kind: "inline",
    rows: orders.map((order) => [
      { label: tr("tracking.share_button"), data: `trk:new:${order.orderId}` },
      { label: tr("tracking.revoke_button"), data: `trk:off:${order.orderId}` },
    ]),
  };
}

function cancelChoiceKeyboard(orders: readonly ActiveOrderSummary[], language: string): Keyboard {
  return {
    kind: "inline",
    rows: orders.map((order) => [
      { label: describeActiveOrder(order, language), data: `cancel:${order.orderId}` },
    ]),
  };
}

/**
 * الإلغاء الفعلي لطلب بعينه، ومعه إخطار كل من يعنيه الأمر.
 *
 * الإخطار يجري بعد نجاح الإلغاء لا قبله، وفشله لا يُبطل الإلغاء: العميل وافق
 * وقُيّد قراره في القاعدة، فلا يصحّ أن يُلغى قراره لأن تيليجرام تعثّر.
 */
async function cancelOne(
  order: ActiveOrderSummary,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"))];

  const cancelled = await deps.orders.cancelByRider(order.orderId, rider.value.id);
  if (!cancelled.ok) return technicalFailure(sender, state);

  // «بدأت رحلتك فلا تُلغى بزرّ» ليست «لا يوجد طلب». الخلط بينهما يُخرج العميل
  // معتقداً أن طلبه اختفى، وهو ماضٍ.
  if (cancelled.value.kind === "not_cancellable") {
    return [reply(sender, tr("rider.order_not_cancellable"))];
  }
  if (cancelled.value.kind === "not_found") {
    return [reply(sender, tr("rider.no_active_order"))];
  }

  /**
   * المرحلة ١١ — إغلاق التتبّع قبل الإخطارات، وبنفس ترتيب `rating-dialog` وبنفس
   * علّته: لو أُخطر السائق والعميل أوّلاً لقرأ العميل «أُلغي طلبك» وفوقها خريطةٌ
   * مازال سائقه يتحرّك عليها.
   *
   * ولماذا هنا لا في `cancel_order_by_rider` في القاعدة؟ لأن إغلاق الجلسة ينشر
   * حدثاً على ناقلٍ **في العملية** يُوقف رسالةَ تلغرام، والقاعدةُ لا تعرف الناقل
   * ولا تُرسل رسائل. وهو نفس السبب الذي جعل `onTripEnded` في التطبيق أصلاً.
   *
   * ويُستدعى بلا شرطٍ على الحالة السابقة: `closeByTrip` لا يُغلق إلا جلسةً قائمة،
   * ولا يُنشر الحدث إلا لجلسةٍ أُغلقت فعلاً (`for (const session of closed)`).
   * فطلبٌ أُلغي في `searching` لا سائق له لا جلسة له، والنداء عليه بلا أثر — وشرطٌ
   * نكتبه هنا يكون مصدراً ثانياً لقاعدة «متى توجد جلسة» ينحرف عن الأوّل.
   */
  await deps.tracking?.onTripEnded(String(cancelled.value.orderId), "TRIP_CANCELLED");

  // البند 2.2: من ألغى أحد طلبيه لا يجوز أن يُسلَب زرّ متابعة الطلب الباقي.
  // قراءة بعد الإلغاء لا خصمٌ من القائمة القديمة: طلب قد يكتمل أو يُسنَد بينهما.
  const remaining = await deps.activeOrdersOf(rider.value.id);

  // التأكيد يسمّي الطلب. «تم إلغاء طلبك» وحدها هي التي أوقعت العميل في الوهم.
  return [
    reply(
      sender,
      tr("rider.order_cancelled_named", { order: describeActiveOrder(order, state.language) }),
      menu(state, { hasActiveOrder: remaining.length > 0 }),
    ),
  ];
}

async function handleCancelChoice(
  orderIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"))];

  // نُعيد القراءة بدل الوثوق بمعرّف قادم من زرّ قديم: الطلب قد يكون قُبل أو
  // انتهى بين عرض القائمة والضغط عليها.
  const active = await deps.activeOrdersOf(rider.value.id);
  const chosen = active.find((order) => String(order.orderId) === orderIdRaw);
  if (chosen === undefined) return [reply(sender, tr("rider.no_active_order"))];
  return cancelOne(chosen, sender, state, deps);
}

/**
 * `F8-05` — مسارُ استقبالِ الاستغاثةِ: نداءٌ واحدٌ على تبعيّةٍ واحدةٍ.
 *
 * ## ما كانَ ههنا ولمَ زالَ
 *
 * كانَ قبلَ النداءِ قراءتانِ: `riders.findByTelegramId` ثمَّ `activeOrdersOf`.
 * وإخفاقُ الأولى يردُّ «حدثَ عطلٌ» **فتُسقَطُ الاستغاثةُ**، وإخفاقُ الثانيةِ
 * يظهرُ قائمةً فارغةً فيردُّ «لا رحلةَ قائمةٌ» — **وهوَ أسوأُ من العطلِ**: يُخبِرُ
 * المُستغيثَ بكذبٍ مطمئنٍ عن حالةِ رحلتِه.
 *
 * ولم تكونا تُضيفانِ ضماناً: `trigger_sos` يُثبِتُ الملكيّةَ بنفسِه تحتَ
 * `for update`. فكانتا تكراراً لحكمٍ قائمٍ، بفارقٍ واحدٍ — أنَّهما تُسقِطانِ
 * النداءَ إن أخفقَتا، والدالّةُ لا.
 *
 * ## ولمَ لا يُمرَّرُ `orderId` من بياناتِ الزرِّ
 *
 * وقد كانَ حاضراً فيها بلا قراءةٍ. لأنَّه **مُدخَلٌ خارجيٌّ**: بياناتُ الزرِّ
 * تعودُ كما أُرسِلَت ولا تُوقَّعُ، **والأدهى** أنَّ زرّاً قديماً في محادثةٍ
 * تتحرَّكُ يشيرُ إلى طلبٍ **انتهى** — فتُنسَبُ استغاثةُ اليومَ إلى رحلةِ الأمسِ
 * ويُبلَّغُ قروبُ مدينةٍ قد لا يكونُ فيها. فالطلبُ يُحَلُّ في القاعدةِ حيثُ
 * القفلُ والحكمُ (`ADR-0077`).
 *
 * ولا يُقرأُ من بياناتِ الزرِّ إلّا الفعلُ: زرٌّ لا يقولُ `trigger` ليسَ استغاثةً.
 */
async function handleSosCallback(
  parts: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const [action] = parts;
  if (action !== "trigger" || deps.safety === undefined) {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const result = await triggerSos(
    { orderId: null, actorTelegramId: sender.telegramUserId, reporterRole: "rider", reason: "sos" },
    deps.safety.trigger,
  );
  if (!result.ok) {
    return [
      reply(
        sender,
        result.error instanceof TriggerSosError && result.error.isNoActiveOrder
          ? tr("safety.no_active_order")
          : tr("common.error_try_again"),
      ),
    ];
  }
  return [
    reply(
      sender,
      tr(result.value.created ? "safety.sent" : "safety.already_sent"),
      trackingMenu(state),
    ),
  ];
}

/**
 * `F8-05` — مسارُ الأمرِ `/sos` للراكبِ: نداءٌ واحدٌ بلا قائمةِ اختيارٍ.
 *
 * ## ما زالَ ولمَ
 *
 * كانَ الأمرُ يقرأُ `riders.findByTelegramId` ثمَّ `activeOrdersOf` ليعرضَ **قائمةَ
 * اختيارٍ** للطلبِ المعنيِّ، ثمَّ ينتظرَ ضغطةً ثانيةً. وفي هذا ثلاثُ عللٍ:
 * أوّلاً إخفاقُ أيِّ القراءتَينِ يُسقِطُ النداءَ أو يكذِبُ بـ«لا رحلةَ قائمةَ».
 * وثانياً ضغطتانِ في لحظةِ خطرٍ ثمَنٌ بلا مقابلٍ. وثالثاً أنَّ اختيارَ الراكبِ
 * لم يكن يُحترمُ أصلاً دونَ إعادةِ التحقّقِ: المُعرِّفُ يعودُ من بياناتِ الزرِّ
 * غيرَ مُوقَّعٍ، وقد أصابَته الفترةُ.
 *
 * والراكبُ لا يكونُ له أكثرُ من طلبٍ واحدٍ حيٍّ في الغالبِ، وإن كانَ فالدالّةُ
 * تختارُ **أحدثَها** تحتَ القفلِ (`ADR-0077`) — وهوَ أقربُ ما يُرادُ بالاستغاثةِ
 * من أمرٍ لا يحملُ وجهةً.
 *
 * ويبقى `handleSosCallback` لأزرارٍ مُرسَلةٍ فعلاً في محادثاتٍ قائمةٍ: لا يُكسَرُ
 * زرٌّ في الميدانِ لأنَّ المسارَ تغيّرَ.
 */
async function handleRiderSos(
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  if (deps.safety === undefined) return [reply(sender, tr("common.unknown_command"))];
  const result = await triggerSos(
    { orderId: null, actorTelegramId: sender.telegramUserId, reporterRole: "rider", reason: "sos" },
    deps.safety.trigger,
  );
  if (!result.ok) {
    return [
      reply(
        sender,
        result.error instanceof TriggerSosError && result.error.isNoActiveOrder
          ? tr("safety.no_active_order")
          : tr("common.error_try_again"),
        menu(state),
      ),
    ];
  }
  return [
    reply(sender, tr(result.value.created ? "safety.sent" : "safety.already_sent"), menu(state)),
  ];
}

async function handleNegotiationDecision(
  rest: readonly string[],
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
  messageId?: string,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const negotiation = deps.negotiation;
  const [action, negotiationId, positionRaw] = rest;
  if (negotiation === undefined || negotiationId === undefined) {
    return [reply(sender, tr("common.unknown_command"))];
  }
  /** ردٌّ يُبدِّلُ البطاقةَ التي حملَت الزرَّ في مكانِها متى عُرِفَ معرّفُها. */
  const inPlace = (text: string, keyboard: Keyboard | null = null): BotReply => ({
    ...reply(sender, text, keyboard),
    ...(messageId === undefined ? {} : { editMessageId: messageId }),
  });

  if (action === "agree") {
    const settled = await settleNegotiation({ negotiationId }, negotiation.rotation);
    if (!settled.ok) return technicalFailure(sender, state);
    if (!settled.value.settled) return [reply(sender, tr("negotiation.rider_turn_closed"))];
    return [];
  }

  if (action === "decline") {
    // أزرارُ بطاقةٍ أُرسِلَت قبلَ `NEG-SELECT-01` — تبقى تعملُ كما كانت.
    const moved = await advanceNegotiationTurn(
      { negotiationId, reason: "declined" },
      negotiation.rotation,
    );
    if (!moved.ok) return technicalFailure(sender, state);
    // نفاد الثلاثة يُبلَّغ للعميل هنا؛ إعادة النشر أو التصعيد مسؤولية المهمة الدورية.
    if (moved.value.exhausted) return [reply(sender, tr("negotiation.exhausted_rider"))];
    return [];
  }

  /**
   * `NEG-SELECT-01` — أفعالُ بطاقةِ العرضِ تحملُ موضعَ الدورِ. وقبلَ كلِّ فعلٍ تُقرأُ بطاقةُ
   * السائقِ **لصاحبِ الطلبِ وحدَه وللمعروضِ الآنَ وحدَه**: فلا يختارُ أحدٌ سائقاً في طلبِ
   * غيرِه، ولا يقعُ زرُّ بطاقةٍ قديمةٍ على السائقِ التالي.
   */
  const position = positionRaw === undefined ? Number.NaN : Number(positionRaw);
  if (!Number.isInteger(position) || position < 1 || negotiation.driverCards === undefined) {
    return [reply(sender, tr("common.unknown_command"))];
  }
  const current = await negotiation.driverCards.read(
    negotiationId,
    position,
    sender.telegramUserId,
  );
  if (!current.ok) return technicalFailure(sender, state);
  if (current.value === null) return [inPlace(tr("negotiation.card_stale"))];
  const driverCard = current.value;

  if (action === "info") {
    const card = riderDriverInfoCard(tr, driverCard);
    return [inPlace(card.text, card.keyboard)];
  }

  if (action === "ign") {
    // «تجاهل» يُغلِقُ بطاقةَ المعلوماتِ ويعودُ إلى الأزرارِ الأخرى في المكانِ نفسِه.
    const card = riderPresentationCard(tr, negotiationId, position, null);
    return [inPlace(card.text, card.keyboard)];
  }

  if (action === "sel") {
    const selected = await selectNegotiationDriver(
      { negotiationId, position },
      negotiation.rotation,
    );
    if (!selected.ok) return technicalFailure(sender, state);
    if (!selected.value.selected) return [inPlace(tr("negotiation.card_stale"))];
    // يُغلَقُ العرضُ؛ وبطاقةُ المحادثةِ (تم الاتفاق · إعادةُ الفتحِ) تصلُ من صندوقِ الصادرِ.
    return [inPlace(tr("negotiation.rider_selected_closed", { position }))];
  }

  if (action === "next" || action === "reopen") {
    const moved = await advanceNegotiationTurnAt(
      { negotiationId, position, reason: "declined" },
      negotiation.rotation,
    );
    if (!moved.ok) return technicalFailure(sender, state);
    if (!moved.value.advanced) return [inPlace(tr("negotiation.card_stale"))];
    if (moved.value.exhausted) return [inPlace(tr("negotiation.exhausted_rider"))];
    return [inPlace(tr("negotiation.rider_skipped"))];
  }

  return [reply(sender, tr("common.unknown_command"))];
}

async function handleCommand(
  command: string,
  sender: Sender,
  state: DialogState,
  updateId: number,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const name = command.split(/\s+/)[0] ?? command;

  /**
   * `F8-05` — وموضِعُ هذا السطرِ هوَ العملُ نفسُه: **قبلَ أوّلِ `await`**.
   * فأيُّ قراءةٍ تُوضَعُ فوقَه تصيرُ بابَ إسقاطٍ للنداءِ، وحاجزُ
   * `scripts/check-sos-intake-isolation.ts` يُسقِطُ البناءَ على ذلكَ.
   */
  if (name === "/sos") return handleRiderSos(sender, state, deps);

  const existing = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!existing.ok) return technicalFailure(sender, state);
  const rider = existing.value;

  switch (name) {
    case "/start": {
      if (rider !== null) return askService(sender, state, deps);
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_name",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      // القائمة مع الترحيب لا مع طلب الاسم: تلغرام يُبقي لوحة الردّ معروضة ما لم
      // تُستبدل، فترافق العميل من أوّل رسالة — وزرّ اللغة أول ما يحتاجه من لا يقرأ
      // العربية، وهو أقلّ الناس قدرةً على معرفة أمر /language من نصّ عربيّ.
      return [reply(sender, tr("rider.welcome"), menu(state)), reply(sender, tr("rider.ask_name"))];
    }

    case "/ride": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      return startServiceFlow("transport", sender, state, deps);
    }

    case "/delivery": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      return startServiceFlow("delivery", sender, state, deps);
    }

    case "/skip": {
      // `WR-18`: وصفُ الطردِ اختياريٌّ — `/skip` في خطوتِه يُنشئُ الطلبَ بلا وصف.
      if (state.step === "awaiting_parcel") {
        if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
        return handleParcel("", sender, state, updateId, deps);
      }
      if (state.step !== "awaiting_dropoff" || state.draftPickup === null) {
        return [reply(sender, tr("common.unknown_command"))];
      }
      if (rider === null) return [reply(sender, tr("rider.must_register_first"))];
      // الطرد يُسلَّم إلى مكان محدَّد: تخطّي الوجهة مسموح في النقل وحده
      if (state.draftService === "delivery") {
        return [reply(sender, tr("rider.delivery_dropoff_required"))];
      }
      return createOrderAndMatch(sender, state, rider, state.draftPickup, null, updateId, deps);
    }

    // البند 2.2: لا يُشترط له منفذ اختياري، فمنفذ الطلبات النشطة أساسي في الحوار أصلاً
    case "/status":
      return handleStatus(sender, state, deps);
    /**
     * `F8-05` — ولا `case "/sos"` ههنا عن قصدٍ: فرعٌ في هذا المُوزِّعِ يعني
     * أنَّ قراءةَ `riders.findByTelegramId` أعلاه قد مرَّت وأنَّ إخفاقَها
     * يُسقِطُ النداءَ. فالأمرُ يُوزَّعُ قبلَ ذلكَ كلِّه إلى `handleRiderSos`.
     */

    case "/support": {
      if (deps.support === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (rider === null) return [reply(sender, tr("support.not_registered"), menu(state))];
      // العميل لا يملك اشتراكاً، فسؤاله عن نوع المشكلة يولّد تذاكر مرفوضة حتماً
      return startSupportDialog(sender, state, deps.support, { allowSubscriptionType: false });
    }

    case "/tickets": {
      // PD-053 — نتيجة الإجراء تصل صاحبها لا تُدفن في القروب: قائمة تذاكر الدعم
      // والمفقودات للراكب في البوت نفسه، لا في القروب وحده.
      if (deps.ticketLister === undefined) return [reply(sender, tr("common.unknown_command"))];
      if (rider === null) return [reply(sender, tr("support.not_registered"), menu(state))];
      const tickets = await deps.ticketLister.list(sender.telegramUserId);
      return [
        reply(
          sender,
          `${tr("support.my_tickets")}\n\n${formatTicketsPage(tickets, tr)}`,
          menu(state),
        ),
      ];
    }

    case "/cancel": {
      // الإلغاء يخرج من أي خطوة حوار، حتى قبل اكتمال التسجيل. كان العميل الجديد
      // يبقى في awaiting_name رغم ظهور «سجّل أولاً»، بخلاف بوت السائق.
      // إزالة اللوحة هنا (`remove` سابقاً) كانت تخلي أسفل الشاشة في أكثر لحظة
      // يحتاج فيها العميل إلى طريق عودة أو إلى الدعم. الإلغاء رجوع للقائمة لا خروج.
      if (rider === null) {
        await deps.sessions.clear(sender.telegramUserId);
        return [reply(sender, tr("common.cancelled"), menu(state))];
      }
      const active = await deps.activeOrdersOf(rider.id);
      await deps.sessions.clear(sender.telegramUserId);
      // لا نسمّي إلغاء مسودة رحلة أو تذكرة دعم «لا يوجد طلب»: المسودة أُلغيت فعلاً.
      if (active.length === 0) {
        return [
          reply(
            sender,
            tr(state.step === "idle" ? "rider.no_active_order" : "common.cancelled"),
            menu(state),
          ),
        ];
      }
      // أكثر من طلب نشط: لا نختار عنه. كان النظام يُلغي الأحدث صامتاً ويقول
      // «تم إلغاء طلبك»، فيخرج العميل ظانّاً أن طلبه الآخر انتهى وهو باقٍ.
      if (active.length > 1) {
        return [
          reply(
            sender,
            tr("rider.cancel_which_order"),
            cancelChoiceKeyboard(active, state.language),
          ),
        ];
      }
      const only = active[0] as ActiveOrderSummary;
      return cancelOne(only, sender, state, deps);
    }

    case "/history": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"), menu(state))];
      const past = await deps.pastOrdersOf(rider.id);
      if (past.length === 0) return [reply(sender, tr("rider.history_empty"), menu(state))];
      const body = past.map((order) => describePastOrder(order, state.language)).join("\n\n");
      return [reply(sender, `${tr("rider.history_heading")}\n\n${body}`, menu(state))];
    }

    case "/city": {
      if (rider === null) return [reply(sender, tr("rider.must_register_first"), menu(state))];
      const cities = await deps.cities.listActive();
      if (!cities.ok) return technicalFailure(sender, state);
      if (cities.value.length === 0)
        return [reply(sender, tr("common.no_active_city"), menu(state))];
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_city_change",
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return [reply(sender, tr("city.change.prompt"), cityKeyboard(cities.value))];
    }

    case "/language":
      return deps.language === undefined
        ? [reply(sender, tr("common.unknown_command"))]
        : handleLanguageCommand(sender, state.language);

    /**
     * `F16-01` — `/rating`: بطاقةُ السمعةِ كسائقٍ وزبونٍ — السائقُ يقيّمُ الراكبَ
     * أيضاً فليست حكراً على السائقين. لا يشترطُ تسجيلًا: السمعةُ تُقرأُ بتلغرامِ
     * المُرسِلِ نفسِهِ.
     */
    case "/rating": {
      if (deps.reputation === undefined) return [reply(sender, tr("common.unknown_command"))];
      return reputationCardReplies(sender, state, sender.telegramUserId, {
        reputation: deps.reputation,
      });
    }

    case "/help": {
      // قراءة واحدة لتخرج القائمة مطابقةً للواقع: /help أوّل ما يلجأ إليه من ضاعت لوحته،
      // فلو أعادناها بلا زرّ تتبّع وله طلبٌ يبحث لسلبناه الزرّ في موطن طلب المساعدة.
      const active = rider === null ? [] : await deps.activeOrdersOf(rider.id);
      const context: MenuContext = { hasActiveOrder: active.length > 0 };
      // البند 6.3: الأوامر أزراراً لا نصّاً. لوحة inline على الرسالة لا تمسح الدائمة
      // أسفل الشاشة، والردّ الثاني يُعيد تأكيدها بحال العميل الحقيقية.
      return [
        // الشرحُ قبل قائمةِ الأوامر: الراكبُ الجديد يحتاج أن يعرف أنّ الطلب يبدأ بموقعٍ
        // يُرسله وأنّ الدفع نقديٌّ مع السائق — وهذان أكثرُ سؤالين يُفتحان على الدعم.
        reply(sender, tr("rider.guide")),
        reply(sender, tr("rider.help"), helpKeyboard("rider", state.language, context)),
        reply(sender, tr("menu.hint"), menu(state, context)),
      ];
    }

    default:
      return [reply(sender, tr("common.unknown_command"))];
  }
}

/** اختيار نوع الخدمة قبل أي موقع: النقل والتوصيل مساران مختلفان من أول خطوة. */
async function askService(
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_service",
    draftPickup: null,
    draftDropoff: null,
    draftService: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [
    reply(sender, tr("rider.ask_service"), {
      kind: "inline",
      rows: [
        [{ label: tr("rider.service_transport"), data: "svc:transport" }],
        [{ label: tr("rider.service_delivery"), data: "svc:delivery" }],
        [{ label: tr("common.back_button"), data: "back:city" }],
      ],
    }),
  ];
}

/** رجوع خطوة واحدة: يعيد سؤال المدينة بلا مسح الاسم. */
async function handleBack(
  target: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
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
  return [reply(sender, tr("rider.ask_city"), cityKeyboard(cities.value))];
}

function isServiceType(value: string): value is ServiceType {
  return value === "transport" || value === "delivery";
}

async function handleServiceSelected(
  raw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  // أزرار تلغرام القديمة تبقى قابلة للضغط في السجل. قبولها خارج شاشة اختيار
  // الخدمة قد يبدّل نوع طلبٍ جارٍ من نقل إلى توصيل بلا قصد المستخدم.
  if (state.step !== "awaiting_service" || !isServiceType(raw)) {
    return [reply(sender, tr("common.unknown_command"))];
  }
  return startServiceFlow(raw, sender, state, deps);
}

async function startServiceFlow(
  service: ServiceType,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_pickup",
    draftService: service,
    draftPickup: null,
    draftDropoff: null,
  });
  if (!saved.ok) return technicalFailure(sender, state);
  return [
    // البند 4.3: زرّ الموقع ومعه القائمة، فلا يُمحى زرّ الدعم في منتصف الطلب
    reply(
      sender,
      tr(service === "delivery" ? "rider.ask_parcel_pickup" : "rider.ask_pickup"),
      locationRequest(state),
    ),
  ];
}

async function handleName(
  text: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  const parsed = parseFullName(text);
  if (!parsed.ok) return [reply(sender, tr(nameErrorKey(parsed.error.reason)))];

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  if (cities.value.length === 0) return [reply(sender, tr("common.no_active_city"))];

  const saved = await deps.sessions.save(sender.telegramUserId, {
    ...state,
    step: "awaiting_city",
    draftName: parsed.value,
  });
  if (!saved.ok) return technicalFailure(sender, state);

  return [reply(sender, tr("rider.ask_city"), cityKeyboard(cities.value))];
}

async function handleCitySelected(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  // فرع تغيير المدينة بعد التسجيل — للانتقال والسفر
  if (state.step === "awaiting_city_change") {
    return handleRiderCityChange(cityIdRaw, sender, state, deps);
  }

  if (state.step !== "awaiting_city" || state.draftName === null) {
    return [reply(sender, tr("common.unknown_command"))];
  }

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  const registered = await deps.riders.register({
    telegramUserId: sender.telegramUserId,
    cityId: city.id,
    fullName: state.draftName,
    language: state.language,
  });
  if (!registered.ok) return technicalFailure(sender, state);

  // askService هي من تحفظ الخطوة التالية — لا حفظان متتاليان للجلسة نفسها
  return [
    // كان `remove`. ولوحة المدن التي قبلها inline لا reply، فلا شيء يستدعي الحذف؛
    // وإنما كان يُفقد العميل قائمته لحظةً يكمل فيها تسجيله.
    reply(
      sender,
      tr("rider.registered", { name: registered.value.fullName, city: city.name }),
      menu(state),
    ),
    ...(await askService(sender, { ...state, draftCityId: city.id }, deps)),
  ];
}

/**
 * تغيير مدينة العميل بعد التسجيل — للانتقال والسفر.
 * يستدعي RPC ذرّياً ويعيد العميل إلى الجاهزية.
 */
async function handleRiderCityChange(
  cityIdRaw: string,
  sender: Sender,
  state: DialogState,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  const cities = await deps.cities.listActive();
  if (!cities.ok) return technicalFailure(sender, state);
  const city = cities.value.find((candidate) => candidate.id === cityIdRaw);
  if (city === undefined) return [reply(sender, tr("common.no_active_city"))];

  // نحتاج معرّف العميل — نقرأه من الملف
  const rider = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!rider.ok) return technicalFailure(sender, state);
  if (rider.value === null) return [reply(sender, tr("rider.must_register_first"), menu(state))];

  const result = await deps.riders.changeCity(rider.value.id, city.id);
  if (!result.ok) return technicalFailure(sender, state);

  await deps.sessions.clear(sender.telegramUserId);

  if (!result.value.ok) {
    if (result.value.error === "ACTIVE_ORDER_IN_PROGRESS") {
      return [reply(sender, tr("city.change.active_order"), menu(state))];
    }
    return [reply(sender, tr("city.change.failed"), menu(state))];
  }

  return [reply(sender, tr("city.change.success", { city: city.name }), menu(state))];
}

async function handleLocation(
  location: { readonly latitude: number; readonly longitude: number },
  sender: Sender,
  state: DialogState,
  updateId: number,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);
  // إحداثيات تلغرام تُتحقَّق كأي مُدخَل خارجي: خط عرض/طول خارج المدى مرفوض
  const coordinates = makeCoordinates(location.latitude, location.longitude);
  if (!coordinates.ok) {
    return [reply(sender, tr("rider.location_required"))];
  }

  const found = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  if (found.value === null) return [reply(sender, tr("rider.must_register_first"))];
  const rider = found.value;

  const isDelivery = state.draftService === "delivery";

  if (state.step === "awaiting_pickup") {
    const saved = await deps.sessions.save(sender.telegramUserId, {
      ...state,
      step: "awaiting_dropoff",
      draftPickup: location,
    });
    if (!saved.ok) return technicalFailure(sender, state);
    // التوصيلُ يبقى له وصفُ الطردِ بعدَ الوجهةِ، فهذه ليست الخطوةَ الأخيرةَ فيه؛
    // والنقلُ يُنشئُ الطلبَ فورَ الوجهةِ، فهذه آخرُ رسالةٍ قبلَ نقطةِ اللاعودةِ.
    if (isDelivery) {
      // القائمة بدل `remove`: المقصود إنهاء لوحة طلب الموقع لا ترك العميل عارياً.
      return [reply(sender, tr("rider.ask_parcel_dropoff"), menu(state))];
    }
    return askFinalInputBeforeOrder(sender, state, "rider.ask_dropoff");
  }

  if (state.step === "awaiting_dropoff" && state.draftPickup !== null) {
    // التوصيل لا ينتهي عند الوجهة: يبقى وصف الطرد، وهو ركن لا خيار
    if (isDelivery) {
      const saved = await deps.sessions.save(sender.telegramUserId, {
        ...state,
        step: "awaiting_parcel",
        draftDropoff: location,
      });
      if (!saved.ok) return technicalFailure(sender, state);
      return askFinalInputBeforeOrder(sender, state, "rider.ask_parcel");
    }
    return createOrderAndMatch(sender, state, rider, state.draftPickup, location, updateId, deps);
  }

  return [reply(sender, tr("common.unknown_command"))];
}

/**
 * آخر خطوة في التوصيل: وصف الطرد. التحقّق كله في الدومين، وهنا ترجمة الخطأ إلى رسالة.
 * الطلب يُكتب ويُبثّ عبر requestDelivery — لا نسخة ثانية من المنطق هنا.
 */
async function handleParcel(
  raw: string,
  sender: Sender,
  state: DialogState,
  updateId: number,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  const found = await deps.riders.findByTelegramId(sender.telegramUserId);
  if (!found.ok) return technicalFailure(sender, state);
  if (found.value === null) return [reply(sender, tr("rider.must_register_first"))];
  const rider = found.value;

  if (state.draftPickup === null || state.draftDropoff === null) {
    // جلسة ناقصة: نعيد المسار من أوله بدل إنشاء طلب نصف مكتمل
    await deps.sessions.clear(sender.telegramUserId);
    return [reply(sender, tr("rider.delivery_dropoff_required"))];
  }

  const requested = await requestDelivery(
    {
      cityId: rider.cityId,
      riderId: rider.id,
      pickup: state.draftPickup,
      dropoff: state.draftDropoff,
      parcelDescription: raw,
    },
    { rides: deps.rides, matching: deps.matching },
    `telegram-update:${sender.telegramUserId}:${updateId}`,
    sender.telegramUserId,
  );

  if (!requested.ok) {
    if (requested.error.code === "DELIVERY_DROPOFF_REQUIRED") {
      return [reply(sender, tr("rider.delivery_dropoff_required"))];
    }
    if (requested.error.code === "INVALID_PARCEL_DESCRIPTION") {
      const key =
        requested.error.reason === "too_long" ? "rider.parcel_too_long" : "rider.parcel_invalid";
      return [reply(sender, tr(key))];
    }
    if (requested.error.code === "ACTIVE_DELIVERY_EXISTS") {
      return [reply(sender, tr("rider.already_searching", { orderId: requested.error.orderId }))];
    }
    return technicalFailure(sender, state);
  }

  await deps.sessions.clear(sender.telegramUserId);

  // البند 2.2: الطلب صار في searching قبل هذا السطر، فزرّ التتبّع يظهر مع أوّل ردّ
  // يراه العميل بعد الطلب لا بعد رسالة تالية — ولحظة الطلب هي لحظة القلق.
  const replies: BotReply[] = [
    reply(
      sender,
      waitingLine("riderSearchingDelivery", requested.value.orderId, state.language),
      trackingMenu(state),
    ),
  ];
  if (requested.value.offered.length === 0) return replies;
  return [
    ...replies,
    reply(sender, tr("rider.drivers_notified", { count: requested.value.offered.length })),
  ];
}

/**
 * ADR 0170 — مَعبَرٌ واحدٌ لطلبِ المُدخَلِ الأخيرِ قبلَ إنشاءِ الطلبِ.
 *
 * في البوتِ لا شاشةَ تأكيدٍ ألبتَّةَ: `createOrderAndMatch` تُنادى **فورَ** وصولِ
 * المُدخَلِ الأخيرِ (موقعُ الوصولِ في النقلِ · وصفُ الطردِ في التوصيلِ · `/skip`).
 * فآخرُ ما يقرأُهُ الراكبُ قبلَ نقطةِ اللاعودةِ هوَ **طلبُ ذاكَ المُدخَلِ** — وهوَ
 * ما يُقابِلُ `QuoteScreen` في المِنِي آب (`ADR 0169`).
 *
 * ولذا لا يُطلَبُ المُدخَلُ الأخيرُ إلّا من هنا، ومن هنا وحدَهُ يُرسَلُ بيانُ الدفعِ
 * **قبلَهُ** لا بعدَهُ. **وهذا موضعٌ واحدٌ لا تنسيقٌ**: مسارٌ جديدٌ يطلبُ مُدخَلاً
 * أخيراً بلا هذا المَعبَرِ يعودُ بالصمتِ الذي هوَ إيهامٌ، ولذا يحرُسُهُ
 * `check-quote-contract` بالقاعدةِ ٩ فيُسقِطُ البناءَ.
 */
function askFinalInputBeforeOrder(
  sender: Sender,
  state: DialogState,
  key: "rider.ask_dropoff" | "rider.ask_parcel",
): readonly BotReply[] {
  const tr = t(state.language);
  // البيانُ أوّلاً: تلغرام يعرِضُ الرسائلَ بترتيبِ إرسالِها، فالترتيبُ ههنا هوَ
  // ترتيبُ القراءةِ. والقائمةُ على الرسالةِ الثانيةِ لأنَّها هيَ التي تنتظرُ فعلاً.
  return [reply(sender, tr("rider.payment_notice")), reply(sender, tr(key), menu(state))];
}

async function createOrderAndMatch(
  sender: Sender,
  state: DialogState,
  _rider: RiderProfile,
  pickup: { readonly latitude: number; readonly longitude: number },
  dropoff: { readonly latitude: number; readonly longitude: number } | null,
  updateId: number,
  deps: RiderBotDependencies,
): Promise<readonly BotReply[]> {
  const tr = t(state.language);

  // D-01: المسارُ الذرّيُّ الآمنُ — مفتاحُ تكرارٍ من `update_id` وفحصُ منطقةِ خدمةٍ ومنعُ تكرارٍ.
  // لا كتابةً مباشرةً في `orders` بعدَ اليوم.
  const idempotencyKey = `telegram-update:${sender.telegramUserId}:${updateId}`;
  const created = await deps.rides.create({
    telegramUserId: sender.telegramUserId,
    idempotencyKey,
    service: "transport",
    origin: { lat: pickup.latitude, lng: pickup.longitude },
    destination: dropoff === null ? null : { lat: dropoff.latitude, lng: dropoff.longitude },
    notes: null,
  });
  if (!created.ok) return technicalFailure(sender, state);

  // الرفضُ مقيسٌ لا عطبٌ — لكنَّ البوتَ يُبلِّغُهُ بصدقٍ.
  if (!created.value.accepted) {
    if (created.value.refusal === "ACTIVE_RIDE_EXISTS" && created.value.activeRide !== null) {
      return [
        reply(
          sender,
          tr("rider.already_searching", { orderId: created.value.activeRide?.orderId ?? "" }),
        ),
      ];
    }
    return technicalFailure(sender, state);
  }

  // `reused: true` = الأمرُ نفسُه سُبِقَ — لا بثَّ ثانٍ ولا إشعارٌ ثانٍ.
  const orderId = created.value.ride.orderId as OrderId;
  if (created.value.ride.reused) {
    return [
      reply(sender, waitingLine("riderSearching", orderId, state.language), trackingMenu(state)),
    ];
  }

  await deps.sessions.clear(sender.telegramUserId);

  // البند 2.2: كما في التوصيل — الزرّ يرافق إعلان بدء البحث نفسه
  // سطرُ الانتظار يختلف بين طلبٍ وطلب: العميلُ الذي يطلب كلّ يوم يقرأ الجملةَ
  // نفسَها فيراها آلةً، لا فريقاً يبحث له. والبذرةُ معرّفُ الطلب فيثبت السطرُ لطلبه.
  const replies: BotReply[] = [
    reply(sender, waitingLine("riderSearching", orderId, state.language), trackingMenu(state)),
  ];

  // البثّ الحقيقي يبدأ فوراً: تُكتب العروض في order_offers ويُكتب لكلِّ عرضٍ صفُّ
  // إشعارٍ في معاملةِ الدورةِ نفسِها، والإرسالُ إلى السائقِ يتولّاه عاملُ التسليم (BUG-004).
  // لا سائق الآن؟ الطلب يبقى في حالة البحث وتتولّاه دورات البثّ التالية — والعميل يُخبَر بصدق.
  const broadcast = await broadcastOffers({ orderId }, deps.matching);
  if (!broadcast.ok) return replies;
  if (broadcast.value.offered.length === 0) return replies;

  return [
    ...replies,
    reply(sender, tr("rider.drivers_notified", { count: broadcast.value.offered.length })),
  ];
}
