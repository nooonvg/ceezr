/**
 * يدير شوطَ صندوقِ الصادرِ الموحَّدِ لكلِّ أنواعِ الإشعاراتِ؛ القفل الموزع يطبقه
 * runner على اسم المهمة المسجل، فلا يجري شوطانِ في وقتٍ واحدٍ (BUG-004).
 *
 * CAP-RUN-20261015 / N1 — الشوطُ صارَ استنزافًا متزامنًا محدودًا (انظر
 * `deliverNotificationsConcurrently`). `NOTIFICATION_DRAIN_BUDGET_MS=0` يعيدُ السلوكَ القديمَ حرفيًّا
 * (دفعةٌ تسلسليّةٌ واحدةٌ حتّى batch_limit) — للمقارنةِ قبل/بعد وللرجوعِ السريع.
 */

import {
  type DeliveryBatchOutcome,
  deliverNotificationBatch,
  deliverNotificationsConcurrently,
  type NotificationDeliveryDeps,
} from "../../../../packages/application/notification/deliver-notification.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";

export interface NotificationDrainSettings {
  readonly lanes: number;
  readonly budgetMs: number;
  readonly maxClaims: number;
}

export const NOTIFICATION_DRAIN_DEFAULTS: NotificationDrainSettings = {
  // يساوي سقفَ تزامنِ المستهلكِ الافتراضيَّ لكلِّ مدينة (outbox_queue_consumer_concurrency=8)؛
  // والقاعدةُ تفرضُ السقفَ لكلِّ مدينةٍ مهما كانت قيمةُ هذا الإعداد.
  lanes: 8,
  // أقلُّ من دقّةِ المشغّلِ (10ث) ليبقى هامشٌ للمهامِّ الأخرى ولإيقافٍ نظيف.
  budgetMs: 8_000,
  maxClaims: 2_000,
};

function intIn(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** قيمٌ غيرُ صالحةٍ تعودُ للافتراضيِّ (لا تُعطِّلُ الإقلاع) وتُعلَنُ في `invalid`. */
export function notificationDrainSettingsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): NotificationDrainSettings & { invalid: string[] } {
  const invalid: string[] = [];
  const pickOr = (name: string, min: number, max: number, dflt: number) => {
    const raw = env[name];
    const v = intIn(raw, min, max);
    if (raw !== undefined && raw.trim() !== "" && v === null) invalid.push(name);
    return v ?? dflt;
  };
  return {
    lanes: pickOr("NOTIFICATION_DRAIN_LANES", 1, 64, NOTIFICATION_DRAIN_DEFAULTS.lanes),
    budgetMs: pickOr(
      "NOTIFICATION_DRAIN_BUDGET_MS",
      0,
      60_000,
      NOTIFICATION_DRAIN_DEFAULTS.budgetMs,
    ),
    maxClaims: pickOr(
      "NOTIFICATION_DRAIN_MAX_CLAIMS",
      1,
      100_000,
      NOTIFICATION_DRAIN_DEFAULTS.maxClaims,
    ),
    invalid,
  };
}

export function deliverNotifications(
  deps: NotificationDeliveryDeps,
  settings: NotificationDrainSettings = { ...NOTIFICATION_DRAIN_DEFAULTS, budgetMs: 0 },
): Promise<Result<DeliveryBatchOutcome, PortFailureError>> {
  if (settings.budgetMs <= 0) return deliverNotificationBatch(deps);
  return deliverNotificationsConcurrently(deps, settings);
}
