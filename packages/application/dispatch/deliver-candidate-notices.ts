/**
 * الغرض: إشعارا المرشَّحِ في صندوقِ الصادر (`WR-09` · ADR 0266):
 *   - للراكب: «قبِلَ سائقٌ طلبَك — اختَرْه أو ارفضْه خلالَ N ثانية» بزرِّ فتحِ الطلب
 *     (`rider_trip_notice` بحدثِ `CANDIDATE`، يودعُه `claim_ride` في معاملةِ الحجز).
 *   - للسائق: مآلُ قبولِه (`driver_candidate_notice`): اختارَك، لم يختَرْك، انتهت المهلة،
 *     أُلغيَ الطلب.
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: `deliver-rider-trip-notice.ts` (الحدثُ `CANDIDATE`) و`apps/workers/src/container.ts`.
 *
 * إشعارُ الراكبِ **يُطوى** إن فاتَ المرشَّحُ قبلَ الإرسال (قرارٌ وقعَ أو موعدٌ فات):
 * رسالةٌ تطلبُ قراراً لم يَعُدْ ممكناً كذبٌ. فيُعلَنُ الصفُّ `undeliverable` بسببِ
 * `TELEGRAM_DELIVERY_NOT_REQUIRED` لا فشلاً. ولا يُسجَّلُ معرّفُ تيليجرام ولا النصّ.
 */

import { t } from "../../shared/i18n/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import { formatPickupMoment } from "../../shared/order-terms/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { Keyboard } from "../bots/types.ts";
import { riderTripKeyboard } from "../driver/rider-trip-notice.ts";
import type {
  OutboxDelivery as NotificationDelivery,
  NotificationHandler,
} from "../notification/deliver-notification.ts";

export interface RiderCandidateFacts {
  readonly riderTelegramId: string;
  readonly language: string;
  /** المرشَّحُ في القاعدةِ هو هذا العرضُ وموعدُه لم يَفُت. */
  readonly live: boolean;
  readonly driverName: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
  readonly ratingAverage: number | null;
  readonly ratingCount: number;
  readonly secondsLeft: number;
}

export interface RiderCandidateFactsReader {
  read(orderId: string, offerId: string): Promise<RiderCandidateFacts | null>;
}

export interface CandidateNoticeSender {
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

const VEHICLE_KEYS: Readonly<Record<string, string>> = {
  sedan: "driver.vehicle_sedan",
  suv: "driver.vehicle_suv",
  motorcycle: "driver.vehicle_motorcycle",
};

function shortOrder(orderId: string): string {
  return `#${orderId.slice(0, 8)}`;
}

/** نصُّ إشعارِ المرشَّحِ للراكب — مُصدَّرٌ للاختبار. */
export function riderCandidateText(orderId: string, facts: RiderCandidateFacts): string {
  const tr = t(facts.language);
  const unknown = tr("tracking.unknown_value");
  const vehicleKey = facts.vehicle === null ? undefined : VEHICLE_KEYS[facts.vehicle];
  const rating =
    facts.ratingAverage === null || facts.ratingCount === 0
      ? tr("tracking.rider_candidate_unrated")
      : `${facts.ratingAverage.toFixed(1)} (${facts.ratingCount})`;
  return tr("tracking.rider_candidate", {
    order: shortOrder(orderId),
    driver: facts.driverName ?? unknown,
    rating,
    vehicle: vehicleKey === undefined ? (facts.vehicle ?? unknown) : tr(vehicleKey),
    plate: facts.plate ?? unknown,
    seconds: facts.secondsLeft,
  });
}

async function send(
  sender: CandidateNoticeSender,
  chatId: string,
  text: string,
  keyboard: Keyboard | null,
): Promise<{ messageId: string | null; failure: string | null }> {
  try {
    const messageId = await sender.sendReturningId(chatId, text, keyboard);
    return { messageId, failure: messageId === null ? "TELEGRAM_REJECTED" : null };
  } catch (thrown) {
    return { messageId: null, failure: thrown instanceof Error ? thrown.name : "unknown" };
  }
}

function outcome(
  prefix: "rider_trip_notice" | "driver_candidate_notice",
  delivery: NotificationDelivery,
  meta: Record<string, unknown>,
  sent: { messageId: string | null; failure: string | null },
  log?: (event: string, meta: Record<string, unknown>) => void,
) {
  if (sent.messageId !== null) {
    if (prefix === "rider_trip_notice") {
      log?.("rider_trip_notice.accepted", { ...meta, attempt: delivery.attempts });
    } else log?.("driver_candidate_notice.accepted", { ...meta, attempt: delivery.attempts });
    return ok({ abandon: false, messageId: sent.messageId, failure: null });
  }
  const failed = {
    ...meta,
    attempt: delivery.attempts,
    max_attempts: delivery.maxAttempts,
    error: sent.failure,
  };
  const final = delivery.attempts >= delivery.maxAttempts;
  if (prefix === "rider_trip_notice") {
    if (final) log?.("rider_trip_notice.final_failure", failed);
    else log?.("rider_trip_notice.send_failed", failed);
  } else if (final) log?.("driver_candidate_notice.final_failure", failed);
  else log?.("driver_candidate_notice.send_failed", failed);
  return ok({ abandon: false, messageId: null, failure: sent.failure });
}

/** فرعُ `CANDIDATE` من معالجِ `rider_trip_notice`. */
export async function deliverRiderCandidateNotice(
  delivery: NotificationDelivery,
  deps: {
    readonly candidates: RiderCandidateFactsReader;
    readonly sender: CandidateNoticeSender;
    readonly miniAppUrl: string | null;
    readonly log?: (event: string, meta: Record<string, unknown>) => void;
  },
) {
  const orderId = delivery.payload.order_id;
  const offerId = delivery.payload.offer_id;
  if (typeof orderId !== "string" || typeof offerId !== "string") {
    deps.log?.("rider_trip_notice.payload_invalid", { delivery_id: delivery.deliveryId });
    return ok({ abandon: true, messageId: null, failure: null });
  }
  const meta = { event: "CANDIDATE", order_id: orderId, delivery_id: delivery.deliveryId };
  const facts = await deps.candidates.read(orderId, offerId);
  if (facts !== null && !facts.live) {
    deps.log?.("rider_trip_notice.candidate_stale", meta);
    return ok({
      abandon: false,
      messageId: null,
      failure: null,
      undeliverable: true,
      undeliverableReason: "TELEGRAM_DELIVERY_NOT_REQUIRED",
    });
  }
  const claimedChat = delivery.payload.chat_id;
  const chatId =
    typeof claimedChat === "string" && claimedChat !== "" ? claimedChat : facts?.riderTelegramId;
  if (facts === null || chatId === undefined) {
    deps.log?.("rider_trip_notice.undeliverable", meta);
    return ok({
      abandon: false,
      messageId: null,
      failure: null,
      undeliverable: true,
      undeliverableReason: "TELEGRAM_DELIVERY_UNAVAILABLE",
    });
  }
  const language =
    typeof delivery.payload.language === "string" && delivery.payload.language !== ""
      ? delivery.payload.language
      : facts.language;
  const text = riderCandidateText(orderId, { ...facts, language });
  const keyboard = riderTripKeyboard(deps.miniAppUrl, orderId, language, "ride");
  deps.log?.("rider_trip_notice.attempted", { ...meta, attempt: delivery.attempts });
  return outcome(
    "rider_trip_notice",
    delivery,
    meta,
    await send(deps.sender, chatId, text, keyboard),
    deps.log,
  );
}

export type DriverCandidateOutcome =
  | "ACCEPTED"
  | "DECLINED"
  | "EXPIRED"
  | "CANCELLED"
  /** `WR-06` — تذكيرُ السائقِ المُسنَدِ إلى طلبٍ مجدولٍ بموعدِ الحضور (لم يصلْ بعد). */
  | "PICKUP_REMINDER";
const OUTCOMES: readonly DriverCandidateOutcome[] = [
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
  "PICKUP_REMINDER",
];

const OUTCOME_KEYS: Readonly<Record<DriverCandidateOutcome, string>> = {
  ACCEPTED: "driver.candidate_accepted",
  DECLINED: "driver.candidate_declined",
  EXPIRED: "driver.candidate_expired",
  CANCELLED: "driver.candidate_cancelled",
  PICKUP_REMINDER: "driver.pickup_reminder",
};

export function driverCandidateText(
  outcomeName: DriverCandidateOutcome,
  orderId: string,
  language: string,
  pickupAt: Date | null = null,
): string {
  const tr = t(language);
  return tr(OUTCOME_KEYS[outcomeName], {
    order: shortOrder(orderId),
    time:
      pickupAt === null
        ? tr("tracking.unknown_value")
        : formatPickupMoment(pickupAt, Date.now(), tr),
  });
}

/** `WR-06` — حالةُ الطلبِ وهل وصلَ السائقُ، لحظةَ الإرسال: تذكيرٌ بطلبٍ أُلغيَ لا يُرسَل. */
export interface PickupReminderStateReader {
  read(orderId: string, driverId: string): Promise<{ readonly stillDue: boolean } | null>;
}

export interface DriverCandidateNoticeDeps {
  readonly sender: CandidateNoticeSender;
  readonly miniAppUrl: string | null;
  /** لوحةُ «بدء الرحلة» في سطحِ البوتِ القديم (لا Mini App). */
  readonly startKeyboard?: (orderId: string, language: string) => Keyboard;
  /** `WR-06` — غيابُه ⇒ يُرسَلُ التذكيرُ بلا فحصٍ (اختبارٌ أو تركيبٌ أقدم). */
  readonly pickupReminderState?: PickupReminderStateReader;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

function driverKeyboard(
  deps: DriverCandidateNoticeDeps,
  orderId: string,
  language: string,
): Keyboard | null {
  if (deps.miniAppUrl !== null) {
    try {
      const url = miniAppUrl(deps.miniAppUrl, { audience: "driver", screen: "job" });
      return {
        kind: "inline",
        rows: [[{ label: t(language)("miniapp.driver_job_button"), webAppUrl: url }]],
      };
    } catch {
      return null;
    }
  }
  return deps.startKeyboard?.(orderId, language) ?? null;
}

export function createDriverCandidateNoticeHandler(
  deps: DriverCandidateNoticeDeps,
): NotificationHandler {
  return async (delivery) => {
    const orderId = delivery.payload.order_id;
    const name = OUTCOMES.find((entry) => entry === delivery.payload.outcome) ?? null;
    if (typeof orderId !== "string" || orderId === "" || name === null) {
      deps.log?.("driver_candidate_notice.payload_invalid", { delivery_id: delivery.deliveryId });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const meta = { outcome: name, order_id: orderId, delivery_id: delivery.deliveryId };
    const chatId = delivery.payload.chat_id;
    if (typeof chatId !== "string" || chatId === "") {
      deps.log?.("driver_candidate_notice.undeliverable", meta);
      return ok({
        abandon: false,
        messageId: null,
        failure: null,
        undeliverable: true,
        undeliverableReason: "TELEGRAM_DELIVERY_UNAVAILABLE",
      });
    }
    const language =
      typeof delivery.payload.language === "string" && delivery.payload.language !== ""
        ? delivery.payload.language
        : "ar";
    let pickupAt: Date | null = null;
    if (name === "PICKUP_REMINDER") {
      const driverId = delivery.payload.driver_id;
      if (deps.pickupReminderState !== undefined && typeof driverId === "string") {
        const state = await deps.pickupReminderState.read(orderId, driverId);
        if (state === null || !state.stillDue) {
          deps.log?.("driver_candidate_notice.not_required", meta);
          return ok({
            abandon: false,
            messageId: null,
            failure: null,
            undeliverable: true,
            undeliverableReason: "TELEGRAM_DELIVERY_NOT_REQUIRED",
          });
        }
      }
      const raw = delivery.payload.pickup_at;
      const parsed = typeof raw === "string" ? new Date(raw) : null;
      pickupAt = parsed !== null && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    const text = driverCandidateText(name, orderId, language, pickupAt);
    const keyboard =
      name === "ACCEPTED" || name === "PICKUP_REMINDER"
        ? driverKeyboard(deps, orderId, language)
        : null;
    deps.log?.("driver_candidate_notice.attempted", { ...meta, attempt: delivery.attempts });
    return outcome(
      "driver_candidate_notice",
      delivery,
      meta,
      await send(deps.sender, chatId, text, keyboard),
      deps.log,
    );
  };
}
