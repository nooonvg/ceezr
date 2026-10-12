/**
 * الغرض: تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه (`WR-12` · ADR 0268).
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: `apps/workers/src/container.ts` (معالجُ النوعِ `driver_location_reminder`).
 *
 * الصفُّ يودعُه `enqueue_driver_location_reminders` من شوطِ العامل، والمُطالِبُ يُرفِقُ حالَ
 * السائقِ **لحظةَ الإرسال**: `is_available` و`still_stale` و`minutes` (منذُ آخرِ موقعٍ، أو
 * `null` إن لم يصل موقعٌ قطّ). فالمعالجُ:
 *   - يطوي ما لم يَعُد لازمًا (أوقفَ توافرَه أو وصلَ موقعٌ حديث) بسببِ
 *     `TELEGRAM_DELIVERY_NOT_REQUIRED`؛
 *   - وإلّا يرسلُ تذكيرًا **قابلًا للفعل**: زرُّ فتحِ وَصْلة (حيثُ يُستعادُ البثُّ بعدَ إذنِ
 *     الموقع) وزرُّ «اجعلني غير متوفر» (`avail:off`، يمرُّ بمسارِ `/unavailable` نفسِه).
 * والنصُّ لا يدّعي أنَّ التطبيقَ يأخذُ الموقعَ وهو مغلق.
 */
import { t } from "../../shared/i18n/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { ButtonRow, Keyboard } from "../bots/types.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";

/** بيانُ زرِّ «اجعلني غير متوفر» — يُعالجُه حوارُ السائقِ (`driver-dialog.ts`). */
export const LOCATION_REMINDER_OFF_CALLBACK = "avail:off";

export interface LocationReminderSender {
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

export interface LocationReminderDeps {
  readonly sender: LocationReminderSender;
  readonly miniAppUrl: string | null;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

export function locationReminderText(minutes: number | null, language: string): string {
  const tr = t(language);
  return minutes === null
    ? tr("driver.location_reminder_never")
    : tr("driver.location_reminder", { minutes: Math.max(1, minutes) });
}

export function locationReminderKeyboard(base: string | null, language: string): Keyboard {
  const tr = t(language);
  const rows: ButtonRow[] = [];
  if (base !== null) {
    try {
      const url = miniAppUrl(base, { audience: "driver", screen: "offers" });
      rows.push([{ label: tr("driver.location_reminder_open"), webAppUrl: url }]);
    } catch {
      // رابطٌ غيرُ صالحٍ لا يُسقِطُ التذكير: يبقى زرُّ «غير متوفر» ونصُّ «أرسل موقعك هنا».
    }
  }
  rows.push([
    { label: tr("driver.location_reminder_unavailable"), data: LOCATION_REMINDER_OFF_CALLBACK },
  ]);
  return { kind: "inline", rows };
}

export function createLocationReminderHandler(deps: LocationReminderDeps): NotificationHandler {
  return async (delivery) => {
    const driverId = delivery.payload.driver_id;
    if (typeof driverId !== "string" || driverId === "") {
      deps.log?.("driver_location_reminder.payload_invalid", { delivery_id: delivery.deliveryId });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const meta = { driver_id: driverId, delivery_id: delivery.deliveryId };
    if (delivery.payload.is_available !== true || delivery.payload.still_stale !== true) {
      deps.log?.("driver_location_reminder.not_required", {
        ...meta,
        available: delivery.payload.is_available === true,
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
      deps.log?.("driver_location_reminder.undeliverable", meta);
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
    const rawMinutes = delivery.payload.minutes;
    const minutes =
      typeof rawMinutes === "number" && Number.isFinite(rawMinutes) ? Math.floor(rawMinutes) : null;
    deps.log?.("driver_location_reminder.attempted", { ...meta, attempt: delivery.attempts });
    let messageId: string | null = null;
    let failure: string | null = null;
    try {
      messageId = await deps.sender.sendReturningId(
        chatId,
        locationReminderText(minutes, language),
        locationReminderKeyboard(deps.miniAppUrl, language),
      );
      if (messageId === null) failure = "TELEGRAM_REJECTED";
    } catch (thrown) {
      failure = thrown instanceof Error ? thrown.name : "unknown";
    }
    if (messageId !== null) {
      // قبولُ Telegram API لا ظهورُه على الهاتف.
      deps.log?.("driver_location_reminder.accepted", { ...meta, attempt: delivery.attempts });
      return ok({ abandon: false, messageId, failure: null });
    }
    const failed = {
      ...meta,
      attempt: delivery.attempts,
      max_attempts: delivery.maxAttempts,
      error: failure,
    };
    if (delivery.attempts >= delivery.maxAttempts) {
      deps.log?.("driver_location_reminder.final_failure", failed);
    } else deps.log?.("driver_location_reminder.send_failed", failed);
    return ok({ abandon: false, messageId: null, failure });
  };
}
