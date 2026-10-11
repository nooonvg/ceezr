/**
 * الغرض: إخطارُ الراكبِ على بوتِه حينَ يُغيِّرُ السائقُ طَورَ الرحلةِ من التطبيقِ
 *   المصغَّرِ — قبِلَ، وصلَ، بدأَ، أنهى (`RIDE-NOTICE-01`).
 * الحالة: منفَّذٌ فعليّاً — 2026-10-03.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `driver-offers.ts` (القبولُ) و`driver-job.ts` (الوصولُ/البدءُ/الإنهاءُ).
 *
 * ## لِمَ هذا الملفُّ
 *
 * اختبارُ رحلةٍ حيّةٍ في المدينةِ (2026-10-03) أثبتَ أنَّ مسارَ السائقِ في التطبيقِ
 * المصغَّرِ يكتبُ الطَّورَ في القاعدةِ **ولا يُخبرُ الراكبَ بشيءٍ**: لا صفَّ في
 * صندوقِ الصادرِ ولا رسالةَ بوتٍ. فراكبٌ أغلقَ التطبيقَ لا يعلمُ أنَّ سائقاً قبِلَ
 * ولا أنَّه ينتظرُه عندَ البابِ. ومسارُ البوتِ يُخطِرُ عندَ القبولِ وحدَه.
 *
 * ## لِمَ لا يُلقي ولا يُعيدُ شيئاً
 *
 * الطَّورُ وقعَ في القاعدةِ قبلَ هذه المكالمةِ. فعطلُ إخطارٍ يُرى للسائقِ «فشلاً»
 * يجعلُه يضغطُ ثانيةً على طَورٍ قد خُتِمَ. فالفشلُ يُبتلَعُ هنا كما في
 * `notifyRiderOfAcceptance` بحوارِ البوتِ — نفسُ الجسرِ `CounterpartNotifier`.
 */

import { t } from "../../shared/i18n/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import type { CounterpartNotifier } from "../bots/rating-dialog.ts";
import type { Keyboard } from "../bots/types.ts";

export type RiderTripEvent = "MATCHED" | "ARRIVED" | "STARTED" | "COMPLETED";

/** ما يلزمُ لمخاطبةِ الراكبِ — يُقرأُ حيّاً من القاعدةِ لحظةَ الإخطارِ. */
export interface RiderTripFacts {
  readonly riderTelegramId: string;
  readonly language: string;
  readonly driverName: string | null;
  readonly plate: string | null;
  readonly vehicle: string | null;
}

export interface RiderTripFactsReader {
  read(orderId: string): Promise<RiderTripFacts | null>;
}

export interface RiderTripNoticeDeps {
  readonly facts: RiderTripFactsReader;
  readonly counterpart: CounterpartNotifier;
  /** أصلُ التطبيقِ — `null` يُرسِلُ النصَّ بلا زرٍّ. */
  readonly miniAppUrl: string | null;
  /**
   * `WR-15` (§15): ما لا يصلُ الراكبَ يُسجَّلُ حدثاً لا يُبتلَعُ صامتاً — حقائقُ غائبةٌ
   * (`rider_trip_notice.facts_missing`) أو قراءةٌ/إرسالٌ أخفقَ (`rider_trip_notice.failed`).
   * بالطَّورِ ومعرّفِ الطلبِ وحدَهما، لا معرّفَ تيليجرام ولا نصّ.
   */
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
  switch (event) {
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

function rideButton(
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
    const facts = await deps.facts.read(orderId);
    if (facts === null) {
      deps.log?.("rider_trip_notice.facts_missing", { event, order_id: orderId });
      return;
    }
    const text = riderTripText(event, orderId, facts);
    // بعدَ الإنهاءِ لا رحلةَ تُتابَعُ — فالزرُّ يفتحُ ملخّصَها لا شاشةَ تتبُّعٍ انتهى محلُّها.
    const screen = event === "COMPLETED" ? "summary" : "ride";
    const keyboard = rideButton(deps.miniAppUrl, orderId, facts.language, screen);
    // §15: «أنشأنا الإشعار» — وقبولُ Telegram يُسجِّلُه الجسرُ (`counterpart.notify_sent`).
    deps.log?.("rider_trip_notice.created", { event, order_id: orderId });
    await deps.counterpart.notify(facts.riderTelegramId, text, keyboard);
  } catch (thrown) {
    // لا يُرفَعُ: الطَّورُ محفوظٌ في القاعدةِ، والراكبُ يراه في التطبيقِ. لكنَّه يُسجَّل (`WR-15`).
    deps.log?.("rider_trip_notice.failed", {
      event,
      order_id: orderId,
      error: thrown instanceof Error ? thrown.name : "unknown",
    });
  }
}
