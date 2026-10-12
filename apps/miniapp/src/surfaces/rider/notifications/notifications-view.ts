/**
 * الغرض: نموذجُ عرضِ المركزِ — **مفاتيحُ نصٍّ وأجزاءُ تاريخٍ لا نصٌّ**: عنوانُ
 *   الصنفِ، وشارةُ القناة، ومفاتيحُ الخطأِ (البند `SS-07` · `F6-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `SS-07`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/notifications
 * يُستخدم من: `NotificationsScreen.tsx`.
 *
 * ## ولماذا `instantParts` يُستورَدُ ولا يُكتَبُ ثانيةً
 *
 * لأنَّ تنسيقَ اللحظةِ إلى أجزاءٍ حكمٌ واحدٌ مُقيسٌ في النطاقِ، ونسخةٌ ههنا
 * تفترقُ عندَ أوّلِ منطقةٍ زمنيّةٍ جديدةٍ (القاعدة 0.6).
 *
 * ## ولماذا صنفٌ غيرُ معروفٍ يُعرَضُ **خامّاً** لا مُخفىً
 *
 * نوعٌ لا تعرفُه هذه القائمةُ عطبٌ في مصدرِه، وإخفاؤُه يُنتِجُ بطاقةً بلا عنوانٍ
 * تبدو خللاً في الرسمِ. فيُعرَضُ كما وردَ بمفتاحٍ يقولُ إنَّه خامٌّ.
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يفكُّ حمولةَ `payload` ولا يُركِّبُ نصّاً من داخلِها** — لا عقدَ
 *      يحكمُ معاني حقولِ كلِّ نوعٍ، فالتركيبُ يكونُ مصدراً ثانياً للحقيقةِ
 *      (القاعدة 0.6).
 *   ــ **لا يُصيغُ نصّاً ولا يحملُ حرفاً عربيّاً** (§9.11).
 *   ــ **لا يفرزُ ولا يُعيدُ ترتيبَ عنصرٍ**: الترتيبُ حكمُ القاعدةِ.
 */

import { type InstantParts, instantParts } from "../history/ride-history-view.ts";

export type { InstantParts };

/** عنوانُ الصنفِ ⇒ مفتاحُ نصِّه. وما لا يُعرَفُ يُعرَضُ خامّاً لا مُخفىً. */
const KIND_KEYS: Readonly<Record<string, string>> = {
  offer: "rider.notifications.kind.offer",
  dispute_resolution: "rider.notifications.kind.dispute_resolution",
  negotiation_turn_opened: "rider.notifications.kind.negotiation_turn_opened",
  negotiation_turn_closed: "rider.notifications.kind.negotiation_turn_closed",
  negotiation_agreed: "rider.notifications.kind.negotiation_agreed",
  wider_circle_opened: "rider.notifications.kind.wider_circle_opened",
  no_driver_found: "rider.notifications.kind.no_driver_found",
  order_cancelled: "rider.notifications.kind.order_cancelled",
  safety_incident: "rider.notifications.kind.safety_incident",
  subscription_notice: "rider.notifications.kind.subscription_notice",
  broadcast_recipient: "rider.notifications.kind.broadcast_recipient",
  lost_item_report: "rider.notifications.kind.lost_item_report",
  safety_resolution_closed: "rider.notifications.kind.safety_resolution_closed",
  safety_resolution_blocked: "rider.notifications.kind.safety_resolution_blocked",
  rider_trip_notice: "rider.notifications.kind.rider_trip_notice",
  driver_candidate_notice: "rider.notifications.kind.driver_candidate_notice",
};

export function kindKey(kind: string): string {
  return KIND_KEYS[kind] ?? "rider.notifications.kind.unknown";
}

/** شارةُ القناةِ ⇒ مفتاحُ نصِّها. وما لا يُعرَفُ يُعرَضُ خامّاً. */
const CHANNEL_KEYS: Readonly<Record<string, string>> = {
  critical: "rider.notifications.channel.critical",
  in_app: "rider.notifications.channel.in_app",
};

export function channelKey(channel: string): string {
  return CHANNEL_KEYS[channel] ?? "rider.notifications.channel.unknown";
}

/** قراءةُ اللحظةِ إلى أجزاءٍ للشاشةِ — أو `null` حينَ تَعطِبُ أو ترفضُ المنطقةُ. */
export function instantOf(iso: string, timeZone: string): InstantParts | null {
  return instantParts(iso, timeZone);
}

/** نصُّ اللحظةِ في الشاشةِ — مفتاحٌ وأجزاءٌ، أو خامٌّ مُعلَنٌ حينَ تَعطِبُ. */
export type InstantLabel =
  | { readonly known: true; readonly key: string; readonly parts: InstantParts }
  | { readonly known: false; readonly key: string; readonly raw: string };

export function instantLabel(iso: string, timeZone: string): InstantLabel {
  const parts = instantOf(iso, timeZone);
  if (parts === null) {
    return { known: false, key: "rider.notifications.when.raw", raw: iso };
  }
  return { known: true, key: "rider.notifications.when.stamped", parts };
}

/** مفاتيحُ الأخطاءِ كما يُصنِّفُها حدُّ API. */
const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_NOT_AVAILABLE: "rider.notifications.error.session",
  RECIPIENT_NOT_FOUND: "rider.notifications.error.notRegistered",
  NOTIFICATION_NOT_FOUND: "rider.notifications.error.notFound",
};

export function notificationsErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.notifications.error.unavailable";
}
