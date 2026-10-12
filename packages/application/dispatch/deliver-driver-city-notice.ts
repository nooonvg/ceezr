/**
 * الغرض: إخطارُ السائقِ بانتقالِ مدينتِه حسبَ موقعِه الحديث، أو بخروجِه من المدنِ المفعّلة
 *   (`WR-13` · ADR 0269).
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: `apps/workers/src/container.ts` (معالجُ النوعِ `driver_city_notice`).
 *
 * الصفُّ يودعُه `relocate_drivers_by_location` بحدثٍ من اثنين:
 *   - `changed`: نُقلَ السائقُ إلى مدينةٍ مفعّلةٍ يغطّي حدُّها موقعَه، ويُذكَرُ اسمُها؛
 *   - `outside`: موقعُه خارجَ كلِّ المدنِ المفعّلة وهو متوفّر، فلن تصلَه طلبات. ومعه زرُّ
 *     «اجعلني غير متوفر» (`avail:off`).
 */
import { t } from "../../shared/i18n/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { Keyboard } from "../bots/types.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import { LOCATION_REMINDER_OFF_CALLBACK } from "./deliver-location-reminder.ts";

export interface DriverCityNoticeSender {
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

export interface DriverCityNoticeDeps {
  readonly sender: DriverCityNoticeSender;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

type CityEvent = "changed" | "outside";

function cityEventOf(value: unknown): CityEvent | null {
  return value === "changed" || value === "outside" ? value : null;
}

function cityName(payload: Record<string, unknown>, language: string): string | null {
  const ar = typeof payload.city_name_ar === "string" ? payload.city_name_ar : null;
  const en = typeof payload.city_name_en === "string" ? payload.city_name_en : null;
  return language === "ar" ? (ar ?? en) : (en ?? ar);
}

export function driverCityNoticeText(
  event: CityEvent,
  city: string | null,
  language: string,
): string {
  const tr = t(language);
  return event === "changed" && city !== null
    ? tr("driver.city_auto_changed", { city })
    : tr("driver.city_outside_coverage");
}

export function createDriverCityNoticeHandler(deps: DriverCityNoticeDeps): NotificationHandler {
  return async (delivery) => {
    const driverId = delivery.payload.driver_id;
    const event = cityEventOf(delivery.payload.event);
    const language =
      typeof delivery.payload.language === "string" && delivery.payload.language !== ""
        ? delivery.payload.language
        : "ar";
    const city = cityName(delivery.payload, language);
    if (typeof driverId !== "string" || driverId === "" || event === null) {
      deps.log?.("driver_city_notice.payload_invalid", { delivery_id: delivery.deliveryId });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    if (event === "changed" && city === null) {
      deps.log?.("driver_city_notice.payload_invalid", { delivery_id: delivery.deliveryId });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const meta = { driver_id: driverId, delivery_id: delivery.deliveryId, event };
    const chatId = delivery.payload.chat_id;
    if (typeof chatId !== "string" || chatId === "") {
      deps.log?.("driver_city_notice.undeliverable", meta);
      return ok({
        abandon: false,
        messageId: null,
        failure: null,
        undeliverable: true,
        undeliverableReason: "TELEGRAM_DELIVERY_UNAVAILABLE",
      });
    }
    const keyboard: Keyboard | null =
      event === "outside"
        ? {
            kind: "inline",
            rows: [
              [
                {
                  label: t(language)("driver.location_reminder_unavailable"),
                  data: LOCATION_REMINDER_OFF_CALLBACK,
                },
              ],
            ],
          }
        : null;
    deps.log?.("driver_city_notice.attempted", { ...meta, attempt: delivery.attempts });
    let messageId: string | null = null;
    let failure: string | null = null;
    try {
      messageId = await deps.sender.sendReturningId(
        chatId,
        driverCityNoticeText(event, city, language),
        keyboard,
      );
      if (messageId === null) failure = "TELEGRAM_REJECTED";
    } catch (thrown) {
      failure = thrown instanceof Error ? thrown.name : "unknown";
    }
    if (messageId !== null) {
      // قبولُ Telegram API لا ظهورُه على الهاتف.
      deps.log?.("driver_city_notice.accepted", { ...meta, attempt: delivery.attempts });
      return ok({ abandon: false, messageId, failure: null });
    }
    const failed = {
      ...meta,
      attempt: delivery.attempts,
      max_attempts: delivery.maxAttempts,
      error: failure,
    };
    if (delivery.attempts >= delivery.maxAttempts) {
      deps.log?.("driver_city_notice.final_failure", failed);
    } else deps.log?.("driver_city_notice.send_failed", failed);
    return ok({ abandon: false, messageId: null, failure });
  };
}
