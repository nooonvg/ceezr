/**
 * الغرض: معالجُ إشعارِ طورِ الرحلةِ للراكبِ في صندوقِ الصادرِ (`WR-15` · ADR 0265).
 *   الصفُّ أودعَه مسارُ السائقِ (`enqueue_rider_trip_notice`)، والمُطالِبُ قرأ محادثةَ
 *   الراكبِ ولغتَه حيّتينِ لحظةَ الالتقاطِ. والمعالجُ يقرأُ اسمَ السائقِ ولوحتَه ومركبتَه
 *   لحظةَ الإرسالِ، ويبني النصَّ والزرَّ بالدالّتينِ نفسيهما اللتينِ كانَ المسارُ المباشرُ
 *   يبنيهما (`riderTripText` و`riderTripKeyboard`).
 * الحالة: منفّذ فعلياً — 2026-10-12، البند `WR-15`.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/container.ts
 *
 * ## السجلُّ — ولا خلطَ بين الطبقات
 *
 * - `rider_trip_notice.attempted`: محاولةُ إرسالٍ برقمِها.
 * - `rider_trip_notice.accepted`: **Telegram API قبِلَ الرسالةَ وأعادَ معرّفَها**. وليسَ
 *   دليلاً على ظهورِ الإشعارِ في هاتفِ الراكب، ولا يدّعي ذلك.
 * - `rider_trip_notice.send_failed`: رفضٌ أو خطأٌ، ويُعادُ الصفُّ بمهلةِ المحاولات.
 * - `rider_trip_notice.final_failure`: آخرُ محاولةٍ مسموحةٍ فشلت؛ فالقاعدةُ تجعلُ الصفَّ `dead`.
 * - `rider_trip_notice.undeliverable`: لا محادثةَ للراكبِ أو مُسحَ حسابُه.
 *
 * لا يُسجَّلُ معرّفُ تيليجرام ولا النصُّ.
 */
import { ok } from "../../shared/result/index.ts";
import type { Keyboard } from "../bots/types.ts";
import {
  type RiderTripEvent,
  type RiderTripFactsReader,
  riderTripKeyboard,
  riderTripText,
} from "../driver/rider-trip-notice.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import {
  deliverRiderCandidateNotice,
  type RiderCandidateFactsReader,
} from "./deliver-candidate-notices.ts";

const EVENTS: readonly RiderTripEvent[] = ["MATCHED", "ARRIVED", "STARTED", "COMPLETED"];

export interface RiderTripNoticeSender {
  /** معرّفُ الرسالةِ التي قبِلَها Telegram API، أو null إن رفضها. */
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

export interface RiderTripNoticeHandlerDeps {
  readonly facts: RiderTripFactsReader;
  readonly sender: RiderTripNoticeSender;
  readonly miniAppUrl: string | null;
  /** `WR-09` — قارئُ المرشَّحِ لحدثِ `CANDIDATE`؛ غيابُه ⇒ الحدثُ حمولةٌ غيرُ مفهومة. */
  readonly candidates?: RiderCandidateFactsReader;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

function readEvent(value: unknown): RiderTripEvent | null {
  return EVENTS.find((entry) => entry === value) ?? null;
}

export function createRiderTripNoticeHandler(
  deps: RiderTripNoticeHandlerDeps,
): NotificationHandler {
  return async (delivery) => {
    if (delivery.payload.event === "CANDIDATE" && deps.candidates !== undefined) {
      return deliverRiderCandidateNotice(delivery, {
        candidates: deps.candidates,
        sender: deps.sender,
        miniAppUrl: deps.miniAppUrl,
        ...(deps.log === undefined ? {} : { log: deps.log }),
      });
    }
    const orderId = delivery.payload.order_id;
    const event = readEvent(delivery.payload.event);
    if (typeof orderId !== "string" || orderId === "" || event === null) {
      // حمولةٌ معطوبةٌ لن تُقبَلَ أبداً: الإعادةُ تكرارٌ بلا رجاء.
      deps.log?.("rider_trip_notice.payload_invalid", { delivery_id: delivery.deliveryId });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const meta = { event, order_id: orderId, delivery_id: delivery.deliveryId };
    const facts = await deps.facts.read(orderId);
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
    const local = { ...facts, language };
    const text = riderTripText(event, orderId, local);
    const keyboard = riderTripKeyboard(
      deps.miniAppUrl,
      orderId,
      language,
      event === "COMPLETED" ? "summary" : "ride",
    );
    deps.log?.("rider_trip_notice.attempted", { ...meta, attempt: delivery.attempts });
    let messageId: string | null = null;
    let failure: string | null = null;
    try {
      messageId = await deps.sender.sendReturningId(chatId, text, keyboard);
      if (messageId === null) failure = "TELEGRAM_REJECTED";
    } catch (thrown) {
      failure = thrown instanceof Error ? thrown.name : "unknown";
    }
    if (messageId !== null) {
      deps.log?.("rider_trip_notice.accepted", { ...meta, attempt: delivery.attempts });
      return ok({ abandon: false, messageId, failure: null });
    }
    const failed = {
      ...meta,
      attempt: delivery.attempts,
      max_attempts: delivery.maxAttempts,
      error: failure,
    };
    if (delivery.attempts >= delivery.maxAttempts) {
      deps.log?.("rider_trip_notice.final_failure", failed);
    } else {
      deps.log?.("rider_trip_notice.send_failed", failed);
    }
    return ok({ abandon: false, messageId: null, failure });
  };
}
