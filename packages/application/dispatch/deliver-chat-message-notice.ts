/**
 * الغرض: تنبيهُ الطرفِ الآخرِ برسالةِ محادثةٍ جديدةٍ في تيليجرام (`WR-04` · ADR 0267).
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: `apps/workers/src/container.ts` (معالجُ النوعِ `order_chat_message`).
 *
 * الصفُّ يودعُه `post_order_message` مؤجَّلاً ومجمَّعاً، والمُطالِبُ يُرفِقُ:
 * `chat_id` و`language` للمستقبِل، و`read` (قرأَ حتى هذه الرسالةِ داخلَ Mini App)،
 * و`order_status`. فالمعالجُ:
 *   - يطوي المقروءَ (المستقبِلُ كانَ في المحادثة) وما انتهت رحلتُه، بسببِ
 *     `TELEGRAM_DELIVERY_NOT_REQUIRED` لا فشلاً؛
 *   - وإلّا يرسلُ «لديك رسالة جديدة من السائق/العميل في الطلب #…» بزرِّ فتحِ الطلب.
 * **لا نصَّ للرسالةِ** في التنبيهِ ولا في السجلّ، ولا معرّفَ تيليجرام في السجلّ.
 */
import { t } from "../../shared/i18n/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { Keyboard } from "../bots/types.ts";
import { riderTripKeyboard } from "../driver/rider-trip-notice.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";

export interface ChatNoticeSender {
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

export interface ChatMessageNoticeDeps {
  /** بوتُ الراكبِ للمستقبِلِ الراكب، وبوتُ السائقِ للسائق. */
  readonly riderSender: ChatNoticeSender;
  readonly driverSender: ChatNoticeSender;
  readonly miniAppUrl: string | null;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

/** الأطوارُ التي تُكتَبُ فيها المحادثة (ADR 0263) — خارجَها لا معنى لـ«افتح المحادثة». */
const OPEN_STATUSES: ReadonlySet<string> = new Set(["matched", "in_progress"]);

export function chatMessageNoticeText(
  recipientRole: "rider" | "driver",
  orderId: string,
  language: string,
): string {
  const key =
    recipientRole === "rider" ? "chat.new_message_from_driver" : "chat.new_message_from_rider";
  return t(language)(key, { order: `#${orderId.slice(0, 8)}` });
}

export function chatMessageNoticeKeyboard(
  base: string | null,
  recipientRole: "rider" | "driver",
  orderId: string,
  language: string,
): Keyboard | null {
  if (recipientRole === "rider") return riderTripKeyboard(base, orderId, language, "ride");
  if (base === null) return null;
  try {
    const url = miniAppUrl(base, { audience: "driver", screen: "job" });
    return {
      kind: "inline",
      rows: [[{ label: t(language)("miniapp.driver_job_button"), webAppUrl: url }]],
    };
  } catch {
    return null;
  }
}

export function createChatMessageNoticeHandler(deps: ChatMessageNoticeDeps): NotificationHandler {
  return async (delivery) => {
    const orderId = delivery.payload.order_id;
    const role = delivery.payload.recipient_role;
    if (typeof orderId !== "string" || orderId === "" || (role !== "rider" && role !== "driver")) {
      deps.log?.("order_chat_notice.payload_invalid", { delivery_id: delivery.deliveryId });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const meta = { order_id: orderId, recipient_role: role, delivery_id: delivery.deliveryId };
    const status = delivery.payload.order_status;
    if (delivery.payload.read === true || typeof status !== "string" || !OPEN_STATUSES.has(status)) {
      deps.log?.("order_chat_notice.not_required", {
        ...meta,
        read: delivery.payload.read === true,
      });
      return ok({
        abandon: false,
        messageId: null,
        failure: null,
        undeliverable: true,
        undeliverableReason: "TELEGRAM_DELIVERY_NOT_REQUIRED",
      });
    }
    const chatId = delivery.payload.chat_id;
    if (typeof chatId !== "string" || chatId === "") {
      deps.log?.("order_chat_notice.undeliverable", meta);
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
    const sender = role === "rider" ? deps.riderSender : deps.driverSender;
    deps.log?.("order_chat_notice.attempted", { ...meta, attempt: delivery.attempts });
    let messageId: string | null = null;
    let failure: string | null = null;
    try {
      messageId = await sender.sendReturningId(
        chatId,
        chatMessageNoticeText(role, orderId, language),
        chatMessageNoticeKeyboard(deps.miniAppUrl, role, orderId, language),
      );
      if (messageId === null) failure = "TELEGRAM_REJECTED";
    } catch (thrown) {
      failure = thrown instanceof Error ? thrown.name : "unknown";
    }
    if (messageId !== null) {
      // قبولُ Telegram API لا ظهورُه على الهاتف.
      deps.log?.("order_chat_notice.accepted", { ...meta, attempt: delivery.attempts });
      return ok({ abandon: false, messageId, failure: null });
    }
    const failed = {
      ...meta,
      attempt: delivery.attempts,
      max_attempts: delivery.maxAttempts,
      error: failure,
    };
    if (delivery.attempts >= delivery.maxAttempts) {
      deps.log?.("order_chat_notice.final_failure", failed);
    } else deps.log?.("order_chat_notice.send_failed", failed);
    return ok({ abandon: false, messageId: null, failure });
  };
}
