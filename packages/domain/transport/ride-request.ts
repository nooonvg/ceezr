/**
 * الغرض: قيمُ **أمرِ** إنشاءِ الرحلةِ وحالةِ البحثِ: عقدُ مفتاحِ التكرارِ، وطورُ
 *   البحثِ كما يُعرَضُ، وسياسةُ الإلغاءِ بلا عقوبةٍ — قيمُ منتَجٍ في النطاقِ لا
 *   في القاعدةِ ولا في الشاشةِ (القاعدة 0.3 · البند `F2-05` · `SR-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: packages/domain/transport
 * يُستخدم من: `packages/application/transport/*` · `apps/miniapp` (شاشةُ البحثِ)
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` (الرحلةُ النشطةُ) يقرأُ الأطوارَ نفسَها بعدَ
 *   الإسنادِ ولا يكتبُ سلسلةَ حالاتٍ ثانيةً.
 * ملاحظات مستقبلية: إذا صارَ للبثِّ دوراتٌ مُعلَنةٌ (`F3`) فطورٌ رابعٌ «الدورةُ
 *   الثانيةُ» موضعُه ههنا، ولا يُقرأُ من `broadcast_round` في الشاشةِ مباشرةً.
 *
 * ## لماذا عقدُ المفتاحِ في النطاقِ لا في الناقلِ
 *
 * لأنَّ المفتاحَ **قيمةُ منتَجٍ**: طولُه وحروفُه المقبولةُ قرارٌ يُقرأُ ويُراجَعُ،
 * ولو سكنَ في مسارِ HTTP لَصارَ لكلِّ ناقلٍ عقدُه، ولَاختلفَ الحدُّ بينَ مسارٍ
 * وبوتٍ. والقاعدةُ تفحصُ الفراغَ والطولَ **أيضاً** عن قصدٍ: الحاجزُ الأخيرُ
 * لا يُستبدَلُ بالأوّلِ (القاعدة 0.6)، فمن نادى الدالّةَ من مسارٍ آخرَ لا يُفلِتُ.
 *
 * ## ولماذا الطورُ يُشتَقُّ من زمنٍ مُقاسٍ لا من مؤقّتٍ في الشاشةِ
 *
 * المؤقّتُ في العميلِ يبدأُ عندَ **فتحِ الشاشةِ**، فمن أعادَ تحميلَ الصفحةِ بعدَ
 * دقيقةٍ رأى «مضتْ ثانيتانِ» عن رحلةٍ تنتظرُ من دقيقةٍ. والصدقُ أن يُقاسَ من
 * **ختمِ الإنشاءِ** الذي كتبتْه القاعدةُ — وهوَ ما تُعيدُه `ride_search_state`.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 * **لا يُسنِدُ ولا يرتِّبُ سائقينَ ولا يُقرِّرُ متى تُبَثُّ دورةٌ ثانيةٌ** — ذاكَ
 * التوزيعُ (`F3`). **ولا يعرفُ أجرةً ولا عقوبةَ إلغاءٍ**: `ADR 0039` §٤ يحجبُ
 * آليةَ الأجرةِ على `DEC-11`، و`م13-7` يُجمِّدُ حتّى الهياكلَ التمهيديّةَ،
 * والإلغاءُ قبلَ الإسنادِ **بلا عقوبةٍ** نصُّ `SR-05` نفسِه. **ولا يخترعُ عدداً
 * مُخطَراً**: العددُ يُحتسَبُ من صفوفِ العروضِ في القاعدةِ، وههنا يُقرأُ ويُصنَّفُ.
 */

/** حدُّ طولِ المفتاحِ — يُقابِلُ `length(p_idempotency_key) > 200` في الهجرةِ. */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

/**
 * أدنى طولٍ مقبولٍ.
 *
 * ثمانيةُ محارفَ لا محرفٌ واحدٌ: مفتاحٌ بطولِ `"1"` يُصادِمُ نفسَه عبرَ جلساتِ
 * الراكبِ نفسِه، فيُقرأُ أمرٌ جديدٌ إعادةً لأمرٍ قديمٍ **فلا تُنشأُ الرحلةُ
 * ألبتّةَ** — وذاكَ عطبٌ أسوأُ من التكرارِ الذي وُضِعَ المفتاحُ لمنعِه.
 */
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;

/**
 * الحروفُ المقبولةُ: `UUID` وما يشبهُه.
 *
 * ولا تُقبَلُ محارفُ تحكُّمٍ ولا مسافاتٌ: المفتاحُ يُكتَبُ في سجلٍّ ويُقارَنُ
 * حرفاً بحرفٍ، ومسافةٌ في طرفِه تجعلُ إعادةً صادقةً أمراً جديداً.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export type IdempotencyKeyRefusal = "MISSING" | "TOO_SHORT" | "TOO_LONG" | "MALFORMED";

/**
 * قراءةُ المفتاحِ.
 *
 * **لا يُشذَّبُ** (`trim`) قبلَ الفحصِ ثمَّ يُقبَلُ: من بعثَ `" abc "` بعثَ مفتاحاً
 * آخرَ في نظرِ نفسِه، وشذبُه يجعلُ أمرَينِ مختلفَينِ في العميلِ أمراً واحداً في
 * القاعدةِ. فالمسافةُ **رفضٌ مُعلَنٌ** لا تصحيحٌ صامتٌ.
 */
export function readIdempotencyKey(
  value: unknown,
): { readonly key: string } | { readonly refusal: IdempotencyKeyRefusal } {
  if (typeof value !== "string" || value.length === 0) return { refusal: "MISSING" };
  if (value.length < IDEMPOTENCY_KEY_MIN_LENGTH) return { refusal: "TOO_SHORT" };
  if (value.length > IDEMPOTENCY_KEY_MAX_LENGTH) return { refusal: "TOO_LONG" };
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) return { refusal: "MALFORMED" };
  return { key: value };
}

/**
 * حدُّ ملاحظةِ السائقِ (`SR-04`).
 *
 * 280 محرفاً: ما يُقرأُ في لمحةٍ على شاشةِ سائقٍ يقودُ. وأطولُ منه لا يُقرأُ
 * فيُصبِحُ الحقلُ موضعَ حوارٍ لا موضعَ تعليمةٍ — والحوارُ له `F2-06` لا هذا الحقلُ.
 * والحدُّ نفسُه مكتوبٌ في الهجرةِ (`NOTES_TOO_LONG`) لا ههنا وحدَه: الحاجزُ
 * الأخيرُ لا يُستبدَلُ بالأوّلِ (القاعدة 0.6).
 */
export const RIDE_NOTES_MAX_LENGTH = 280;

/**
 * قراءةُ الملاحظةِ.
 *
 * الغيابُ والفراغُ والمسافاتُ **سواءٌ**: `null`. ونصٌّ فارغٌ في عمودٍ يُقرأُ
 * لاحقاً «كتبَ الراكبُ شيئاً» وهوَ لم يكتبْ. والشذبُ ههنا **مشروعٌ** بخلافِ
 * مفتاحِ التكرارِ: الملاحظةُ محتوًى يُقرأُ، والمفتاحُ هويّةٌ تُقارَنُ.
 */
export function readRideNotes(
  value: unknown,
): { readonly notes: string | null } | { readonly refusal: "NOTES_TOO_LONG" | "MALFORMED" } {
  if (value === undefined || value === null) return { notes: null };
  if (typeof value !== "string") return { refusal: "MALFORMED" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { notes: null };
  if (trimmed.length > RIDE_NOTES_MAX_LENGTH) return { refusal: "NOTES_TOO_LONG" };
  return { notes: trimmed };
}

/** حالاتُ الطلبِ كما يعرفُها المخطَّطُ (`order_status`) — تُقرأُ ولا تُختلَقُ. */
export const RIDE_STATUSES = [
  /** `WR-06` — مجدولٌ لم يحِن إطلاقُه إلى البحث. */
  "scheduled",
  "searching",
  "matched",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

export function isRideStatus(value: unknown): value is RideStatus {
  return typeof value === "string" && (RIDE_STATUSES as readonly string[]).includes(value);
}

/**
 * طورُ البحثِ كما يُعرَضُ — لا كما يُخزَّنُ.
 *
 * `announced` = أُخطِرَ سائقٌ واحدٌ على الأقلِّ فعلاً. و`silent` = لم يُخطَرْ أحدٌ
 * بعدُ. والفصلُ بينهما **لأنَّ الصمتَ ليسَ رفضاً** (`ADR 0023`): شاشةٌ تعرضُ
 * دوّاراً واحداً للحالتَينِ تكذبُ على الراكبِ في إحداهما لا محالةَ.
 *
 * و`widened` = فُتِحَتْ دورةُ الدائرةِ الأوسعِ (غيرُ المشتركينَ) — «وسّعنا
 * البحثَ». و`escalated` = وصلَ الطلبُ إلى فريقِ الإسنادِ بتصعيدٍ **مُسلَّمٍ** —
 * «أحلينا طلبكَ إليهم». وكلتاهما رايتانِ تشغيليّتانِ تقرؤهما القاعدةُ من
 * حالاتِها القائمةِ (صفٌّ في `unsubscribed_negotiations` · أثرُ `order.escalated`
 * المُسلَّمُ) لا من رسائلٍ تُرسَلُ مرّةً ثم تُحذَفُ (`PD-050`).
 */
export type SearchPhase =
  /** `WR-06` — الطلبُ مجدولٌ: لا بحثَ بعدُ، والبحثُ يبدأُ في موعدِ إطلاقِه. */
  "scheduled" | "silent" | "announced" | "widened" | "escalated" | "assigned" | "closed";

export interface RideSearchSnapshot {
  readonly status: RideStatus;
  readonly notifiedDriverCount: number;
  readonly createdAtMs: number;
  /** فُتِحَتْ دورةُ الدائرةِ الأوسعِ لهذا الطلبِ (وجودُ أيِّ صفٍّ في `unsubscribed_negotiations`). */
  readonly widerCircleOpened: boolean;
  /** وصلَ الطلبُ إلى قروبِ الإسنادِ بتصعيدٍ مُسلَّمٍ (أثرُ `order.escalated` المُسلَّمُ). */
  readonly escalated: boolean;
}

/**
 * ترتيبُ الأطوارِ مقصودٌ: الإسنادُ يغلبُ الكلَّ لأنّهُ الجوابُ الذي ينتظرُهُ
 * الراكبُ، ثمّ ما ليسَ بحثًا مُغلَقٌ، ثمّ التصعيدُ (آخرُ الأخبارِ) فالتوسيعُ
 * (الخبرُ الأقدمُ منهُ) فالإعلانُ فالصمتُ. وطلبٌ صُعِّدَ ثمّ رجعَ إلى دورةٍ
 * أوسعَ جديدةٍ يبقى «مُصعَّدًا»: عودتُهُ خبرٌ يخصُّ التوزيعَ الداخليَّ لا سؤالَ
 * الراكبِ، فلا يتراجعُ السردُ إلى الوراءِ.
 */
export function searchPhaseOf(snapshot: RideSearchSnapshot): SearchPhase {
  if (snapshot.status === "matched" || snapshot.status === "in_progress") return "assigned";
  if (snapshot.status === "scheduled") return "scheduled";
  if (snapshot.status !== "searching") return "closed";
  if (snapshot.escalated) return "escalated";
  if (snapshot.widerCircleOpened) return "widened";
  return snapshot.notifiedDriverCount > 0 ? "announced" : "silent";
}

/**
 * الإلغاءُ بلا عقوبةٍ **قبلَ الإسنادِ** — `SR-05` حرفاً.
 *
 * والحكمُ يُقرأُ من الحالةِ لا من مضيِّ الوقتِ: من مضى عليه دقيقتانِ ولم يُسنَدْ
 * له سائقٌ يُلغي بلا عقوبةٍ كمن مضتْ عليه ثانيتانِ. ولا عقوبةَ في المشروعِ
 * أصلاً (`ADR 0027`: الدخلُ اشتراكُ سائقٍ)، والاسمُ يُعلِنُ الشرطَ كي لا يُضافَ
 * أثرٌ ماليٌّ لاحقاً بلا أن يمرَّ على هذا الحكمِ.
 */
export function cancellableWithoutPenalty(status: RideStatus): boolean {
  return status === "searching" || status === "scheduled";
}

/** حدُّ ما يُعرَضُ من الثواني — والمؤقّتُ يُقاسُ من ختمِ الإنشاءِ لا من فتحِ الشاشةِ. */
export function elapsedSecondsSince(createdAtMs: number, nowMs: number): number {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return 0;
  const seconds = Math.floor((nowMs - createdAtMs) / 1000);
  // ساعةُ عميلٍ متقدِّمةٌ على ساعةِ القاعدةِ تُنتِجُ سالباً؛ والسالبُ يُقرأُ صفراً
  // ولا يُعرَضُ «مضتْ -3 ثوانٍ».
  return seconds > 0 ? seconds : 0;
}
