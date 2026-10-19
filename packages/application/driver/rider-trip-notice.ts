/**
 * الغرض: إخطارُ الراكبِ على بوتِه حينَ يُغيِّرُ السائقُ طَورَ الرحلةِ من التطبيقِ
 *   المصغَّرِ — قبِلَ، وصلَ، بدأَ، أنهى (`RIDE-NOTICE-01` ثمَّ `WR-15`).
 * الحالة: منفَّذٌ فعليّاً — 2026-10-03، ونُقلَ إلى صندوقِ الصادرِ 2026-10-12 (ADR 0265).
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `driver-offers.ts` (القبولُ) و`driver-job.ts` (الوصولُ/البدءُ/الإنهاءُ)،
 *   والعاملُ (`apps/workers`) لنصِّ الرسالةِ وزرِّها.
 *
 * ## لِمَ صندوقُ الصادرِ
 *
 * كانَ الإخطارُ يُرسَلُ من مسارِ طلبِ السائقِ مباشرةً، فسقوطُ تيليجرام أو انقطاعُ
 * العمليّةِ يُفقِدُه بلا أثرٍ في القاعدة. صارَ المسارُ **يُودِعُ** صفّاً واحداً لكلِّ
 * طلبٍ وطورٍ (`enqueue_rider_trip_notice`، بمفتاحِ منعِ تكرارٍ)، والعاملُ يُرسلُ
 * ويُعيدُ المحاولةَ ويُعلِنُ الفشلَ النهائيَّ (`dead`).
 *
 * ## لِمَ لا يُلقي
 *
 * الطَّورُ وقعَ في القاعدةِ قبلَ هذه المكالمةِ. فعطلُ إيداعٍ يُرى للسائقِ «فشلاً»
 * يجعلُه يضغطُ ثانيةً على طَورٍ قد خُتِمَ. فالفشلُ يُسجَّلُ (`rider_trip_notice.enqueue_failed`)
 * ولا يُعادُ للسائق.
 */

import { t } from "../../shared/i18n/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import { formatPickupMoment } from "../../shared/order-terms/index.ts";
import type { Keyboard } from "../bots/types.ts";

export type RiderTripEvent =
  | "MATCHED"
  | "ARRIVED"
  | "STARTED"
  | "COMPLETED"
  /** `WR-06` — حُفِظَ الطلبُ مجدولًا (تأكيد). */
  | "SCHEDULED"
  /** `WR-06` — تذكيرُ الراكبِ قبلَ موعدِه. */
  | "SCHEDULE_REMINDER"
  /** `WR-06` — أُطلِقَ المجدولُ: بدأَ البحثُ عن سائق. */
  | "SEARCH_STARTED"
  /** `WR-06` — فاتَ موعدُ المجدولِ قبلَ إطلاقِه (تعطّلُ النظام) فأُلغي. */
  | "SCHEDULE_MISSED"
  /** `WR-22` (ADR 0276) — انتهت مدّةُ البحثِ بلا سائقٍ فأُنهيَ الطلبُ `failed`. */
  | "SEARCH_EXPIRED";

/** `WR-06` — الأحداثُ التي لا تُرسَلُ إلّا والطلبُ في حالتِها؛ وإلّا فقدَ الخبرُ معناه. */
export const RIDER_TRIP_EVENT_REQUIRES_STATUS: Readonly<
  Partial<Record<RiderTripEvent, readonly string[]>>
> = {
  SCHEDULED: ["scheduled"],
  SCHEDULE_REMINDER: ["scheduled"],
  SEARCH_STARTED: ["searching"],
  SEARCH_EXPIRED: ["failed"],
};

/** ما يلزمُ لمخاطبةِ الراكبِ — يُقرأُ حيّاً من القاعدةِ لحظةَ الإخطارِ. */
export interface RiderTripFacts {
  readonly riderTelegramId: string;
  readonly language: string;
  readonly driverName: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
  /** `WR-06` — حالةُ الطلبِ لحظةَ الإرسال وموعدا المجدول (اختياريّةٌ لقرّاءٍ أقدم). */
  readonly status?: string | null;
  readonly pickupAt?: Date | null;
  readonly dispatchAt?: Date | null;
}

export interface RiderTripFactsReader {
  read(orderId: string): Promise<RiderTripFacts | null>;
}

/** إيداعُ إشعارِ طورٍ في صندوقِ الصادرِ. `null` ⇐ لا طلبَ بهذا المعرّف. */
export interface RiderTripNoticeOutbox {
  /**
   * `riderTelegramId` (LOAD-01 · الدفعةُ الحاديةَ عشرةَ): معرّفُ تيليجرامِ الراكبِ من الإيداعِ نفسِه
   * (`null` لحسابٍ مُجهَّل، و`undefined` لمنفذٍ لا يُعيدُه) — فلا استعلامَ ثانٍ للإشارةِ اللحظيّة.
   */
  enqueue(
    orderId: string,
    event: RiderTripEvent,
  ): Promise<{ readonly created: boolean; readonly riderTelegramId?: string | null } | null>;
  /**
   * LOAD-01 (الدفعةُ الخامسةَ عشرةَ) — **الإيداعُ تمَّ في عبارةٍ أخرى** (قبولُ العرضِ يودِعُ MATCHED في
   * معاملتِه: `driver_accept_offer_with_matched_notice`)، فيُنادى هذا بعدَ ثباتِه لآثارِ ما بعدَ الإيداعِ
   * وحدَها (الإشارةُ اللحظيّةُ · ADR 0287) **بلا إيداعٍ ثانٍ**. غيابُه = لا أثرَ لاحقَ.
   */
  deposited?(
    orderId: string,
    event: RiderTripEvent,
    result: { readonly created: boolean; readonly riderTelegramId?: string | null },
  ): void;
}

/**
 * مآلُ إيداعٍ جرى في عبارةِ عملٍ أخرى — مُعلَنٌ لا مُخمَّن: نجاحٌ (مع `created`)، أو طلبٌ مفقودٌ،
 * أو فشلٌ تراجعَت عنه نقطةُ الحفظِ وحدَه (والانتقالُ قبلَه ثابت · ADR 0265 §2).
 */
export type RiderTripDepositOutcome =
  | {
      readonly kind: "deposited";
      readonly created: boolean;
      readonly riderTelegramId?: string | null;
    }
  | { readonly kind: "order_missing" }
  | { readonly kind: "failed"; readonly error: string };

export interface RiderTripNoticeDeps {
  readonly outbox: RiderTripNoticeOutbox;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

const VEHICLE_KEYS: Readonly<Record<string, string>> = {
  sedan: "driver.vehicle_sedan",
  suv: "driver.vehicle_suv",
  motorcycle: "driver.vehicle_motorcycle",
};

function shortOrder(orderId: string): string {
  return `#${orderId.slice(0, 8)}`;
}

/** نصُّ الإخطارِ بلغةِ الراكبِ — مُصدَّرٌ للاختبارِ. */
export function riderTripText(
  event: RiderTripEvent,
  orderId: string,
  facts: RiderTripFacts,
): string {
  const tr = t(facts.language);
  const unknown = tr("tracking.unknown_value");
  const vehicleKey = facts.vehicle === null ? undefined : VEHICLE_KEYS[facts.vehicle];
  const params = {
    order: shortOrder(orderId),
    driver: facts.driverName ?? unknown,
    plate: facts.plate ?? unknown,
    vehicle: vehicleKey === undefined ? (facts.vehicle ?? unknown) : tr(vehicleKey),
  };
  const now = Date.now();
  const timeParams = {
    order: params.order,
    time: facts.pickupAt ? formatPickupMoment(facts.pickupAt, now, tr) : unknown,
    search_time: facts.dispatchAt ? formatPickupMoment(facts.dispatchAt, now, tr) : unknown,
  };
  switch (event) {
    case "SCHEDULED":
      return tr("tracking.rider_scheduled", timeParams);
    case "SCHEDULE_REMINDER":
      return tr("tracking.rider_schedule_reminder", timeParams);
    case "SEARCH_STARTED":
      return tr("tracking.rider_search_started", timeParams);
    case "SCHEDULE_MISSED":
      return tr("tracking.rider_schedule_missed", timeParams);
    case "SEARCH_EXPIRED":
      return tr("tracking.rider_search_expired", timeParams);
    case "MATCHED":
      return tr("tracking.rider_matched", params);
    case "ARRIVED":
      return tr("tracking.rider_driver_arrived", params);
    case "STARTED":
      return tr("tracking.rider_trip_started", params);
    case "COMPLETED":
      return tr("tracking.rider_trip_completed", params);
  }
}

export function riderTripKeyboard(
  base: string | null,
  orderId: string,
  language: string,
  screen: "ride" | "summary",
): Keyboard | null {
  if (base === null) return null;
  let url: string;
  try {
    url = miniAppUrl(base, { audience: "rider", screen, id: orderId });
  } catch {
    return null;
  }
  return {
    kind: "inline",
    rows: [[{ label: t(language)("miniapp.ride_button"), webAppUrl: url }]],
  };
}

/** أفضلُ جهدٍ — لا يُلقي أبداً (انظرْ رأسَ الملفِّ). */
export async function noticeRiderOfTrip(
  deps: RiderTripNoticeDeps | undefined,
  orderId: string,
  event: RiderTripEvent,
): Promise<void> {
  if (deps === undefined) return;
  try {
    const queued = await deps.outbox.enqueue(orderId, event);
    if (queued === null) {
      deps.log?.("rider_trip_notice.order_missing", { event, order_id: orderId });
      return;
    }
    if (queued.created) deps.log?.("rider_trip_notice.created", { event, order_id: orderId });
    else deps.log?.("rider_trip_notice.deduplicated", { event, order_id: orderId });
  } catch (thrown) {
    deps.log?.("rider_trip_notice.enqueue_failed", {
      event,
      order_id: orderId,
      error: thrown instanceof Error ? thrown.name : "unknown",
    });
  }
}

/**
 * سجلُّ إيداعٍ تمَّ في القاعدةِ ضمنَ عبارةِ الانتقالِ نفسِها — **السجلُّ نفسُه** الذي يكتبُه
 * `noticeRiderOfTrip` (`created` · `deduplicated` · `order_missing` · `enqueue_failed`) والإشارةُ
 * اللحظيّةُ نفسُها، بلا رحلةٍ ثانيةٍ إلى القاعدة. أفضلُ جهدٍ: لا يُلقي أبداً.
 */
export function recordRiderTripDeposit(
  deps: RiderTripNoticeDeps | undefined,
  orderId: string,
  event: RiderTripEvent,
  outcome: RiderTripDepositOutcome,
): void {
  if (deps === undefined) return;
  try {
    if (outcome.kind === "order_missing") {
      deps.log?.("rider_trip_notice.order_missing", { event, order_id: orderId });
      return;
    }
    if (outcome.kind === "failed") {
      deps.log?.("rider_trip_notice.enqueue_failed", {
        event,
        order_id: orderId,
        error: outcome.error,
      });
      return;
    }
    if (outcome.created) deps.log?.("rider_trip_notice.created", { event, order_id: orderId });
    else deps.log?.("rider_trip_notice.deduplicated", { event, order_id: orderId });
    deps.outbox.deposited?.(orderId, event, {
      created: outcome.created,
      ...(outcome.riderTelegramId === undefined
        ? {}
        : { riderTelegramId: outcome.riderTelegramId }),
    });
  } catch {
    // أفضلُ جهدٍ كـ`noticeRiderOfTrip`: السجلُّ والإشارةُ لا يمسّانِ الانتقالَ الثابت.
  }
}
