/**
 * الغرض: القائمةُ المغلقةُ لأنواعِ الإشعاراتِ في صندوقِ الصادرِ الموحَّدِ، وقنواتُها
 *   المسموحةُ — مصدرُ الحقيقةِ الذي يُقابِلُه حاجزُ `scripts/check-notification-classification.ts`
 *   بما في هجرةِ `F6-05` فعلاً. البند `F6-05` / `TG-002`.
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: packages/shared/config
 * يُتوقع أن يستخدمه لاحقاً: `scripts/check-notification-classification.ts`،
 *   واختباراتُ الوحدةِ التي تُثبِّتُ المجاميع.
 *
 * ## لماذا قائمةٌ مغلقةٌ ولماذا ههنا
 *
 * قيدُ `kind in (...)` في القاعدةِ يمنعُ نوعاً مجهولاً من الدخول. لكنّه **لا
 * يمنعُ نوعاً معلوماً من أن يبقى بلا سياسةِ قناةٍ**، وذلكَ هوَ الحالُ الذي يهمُّ:
 * نوعٌ بلا سياسةٍ يُرسَلُ افتراضاً (وهوَ الميلُ الآمنُ) — لكنَّه يُرسَلُ **بلا أن
 * يقرّرَ أحدٌ ذلك**، فيبقى قرارُ منتَجٍ مؤجَّلاً إلى الأبدِ بلا أثرٍ يُقرأ.
 * فالحاجزُ يفرضُ أن يكونَ لكلِّ نوعٍ إعلانٌ صريحٌ، ووجودُ الإعلانِ ههنا في
 * TypeScript يجعلُ الحاجزَ يقرأُ **طرفَينِ مستقلَّينِ** (هذا الملفُّ والهجرةُ)
 * ويطابقُ بينَهما — ولو قرأَ الهجرةَ وحدَها لكانَ يقارنُ الملفَّ بنفسِه.
 *
 * ## عدمُ التماثلِ الذي يُبرِّرُ `GROUP_ADDRESSED_KINDS`
 *
 * نوعٌ يُوجَّهُ إلى **مجموعةٍ** لا مستقبِلَ فرداً له، فلا صفَّ مركزٍ يُكتَبُ له.
 * وتصنيفُه `in_app` لا يعني «هدِّئْه» بل **«أعدِمْه»**: لا رسالةٌ تُرسَلُ ولا
 * مدخلٌ يُقيَّدُ. و`safety_incident` — بلاغُ استغاثةٍ — هوَ عينُ هذا الصنفِ اليومَ.
 * فالقائمةُ مغلقةٌ ومكرَّرةٌ في القاعدةِ بدالّةِ `notification_kind_is_group_addressed`
 * وفي قيدِ الجدولِ، **والتكرارُ مقصودٌ ومحروسٌ**: القاعدةُ تمنعُ الصفَّ الخاطئَ
 * وقتَ الكتابةِ، والحاجزُ يمنعُ افتراقَ القائمتَينِ وقتَ المراجعة.
 */

/** قنواتُ التسليمِ — قيمتانِ لا ثالثَ لهما، وهما نصُّ قيدِ القاعدةِ حرفاً. */
export const NOTIFICATION_CHANNELS = ["critical", "in_app"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * أنواعُ صندوقِ الصادرِ الموحَّدِ — مطابِقةٌ لقيدِ `notification_outbox_kind_check`.
 * الترتيبُ لا يعني شيئاً؛ المطابقةُ في الحاجزِ بالمجموعةِ لا بالتسلسل.
 */
export const NOTIFICATION_KINDS = [
  "offer",
  "dispute_resolution",
  "negotiation_turn_opened",
  "negotiation_turn_closed",
  "negotiation_agreed",
  "wider_circle_opened",
  "no_driver_found",
  "order_cancelled",
  "safety_incident",
  "subscription_notice",
  "broadcast_recipient",
  "lost_item_report",
  "safety_resolution_closed",
  "safety_resolution_blocked",
  "rider_trip_notice",
  "driver_candidate_notice",
  "order_chat_message",
  "driver_location_reminder",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * الأنواعُ المُوجَّهةُ إلى مجموعةٍ — **لا تُصنَّفُ `in_app` أبداً**.
 * توسيعُ هذه القائمةِ يلزمُه توسيعُ `notification_kind_is_group_addressed` في
 * هجرةٍ، وإلّا أخفقَ الحاجز.
 */
export const GROUP_ADDRESSED_KINDS: readonly NotificationKind[] = ["safety_incident"];

export function isGroupAddressedKind(kind: string): boolean {
  return GROUP_ADDRESSED_KINDS.some((entry) => entry === kind);
}

/**
 * القناةُ المُعلَنةُ لكلِّ نوعٍ عندَ بذرِ `F6-05`. **كلُّها `critical` عمداً**:
 * واجهةُ `SS-07` في التطبيقِ المصغَّرِ لم تُبنَ بعدُ (شاشاتُ `F2`/`F3`)، وإعادةُ
 * تصنيفِ نوعٍ إلى `in_app` قبلَ وجودِ شاشةٍ تعرضُه **إسكاتٌ لا تهدئةٌ**. فالآليّةُ
 * تُبنى وتُبرهَنُ، وقلبُ صفٍّ لاحقاً قرارُ منتَجٍ لا نشرةٌ.
 */
export const SEEDED_NOTIFICATION_CHANNELS: Readonly<Record<NotificationKind, NotificationChannel>> =
  {
    offer: "critical",
    dispute_resolution: "critical",
    negotiation_turn_opened: "critical",
    negotiation_turn_closed: "critical",
    negotiation_agreed: "critical",
    wider_circle_opened: "critical",
    no_driver_found: "critical",
    order_cancelled: "critical",
    safety_incident: "critical",
    subscription_notice: "critical",
    broadcast_recipient: "critical",
    lost_item_report: "critical",
    safety_resolution_closed: "critical",
    safety_resolution_blocked: "critical",
    rider_trip_notice: "critical",
    driver_candidate_notice: "critical",
    order_chat_message: "critical",
    driver_location_reminder: "critical",
  };

/**
 * الحالةُ النهائيّةُ لصفٍّ لم يُرسَل لأنَّ قناتَه داخلَ التطبيقِ. ليست `delivered`
 * (يلزمُها معرّفُ رسالةٍ لا وجودَ لها) ولا `canceled` (قرارُ مشرفٍ يُلغي إرسالاً
 * مقصوداً). واسمُها المتمايزُ يجعلُ «كم إشعاراً لم يُرسَل؟» استعلاماً لا تخميناً.
 */
export const IN_APP_ONLY_STATUS = "in_app_only";
