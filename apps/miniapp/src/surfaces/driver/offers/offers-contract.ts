/**
 * الغرض: شكلُ ردودِ مساراتِ عروضِ السائقِ كما يقرؤها العميلُ — أنواعٌ لا منطقٌ
 *   (البند `F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `offers-api.ts` · `offers-view.ts` · `OffersScreen.tsx` ·
 *   `OfferDetailScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — الرحلةُ النشطةُ تبدأُ من `order_id` الذي
 *   يُعيدُه القبولُ، فالحقلُ ههنا هوَ مِفصلُ البندِ القادمِ.
 *
 * ## لِمَ لا حقلَ `expires_at` في هذا العقدِ ألبتّةَ
 *
 * لأنَّ ما لا يُنشَرُ **لا يُسيءُ أحدٌ استعمالَه**: لحظةُ انتهاءٍ مُطلقةٌ في
 * الحمولةِ دعوةٌ صريحةٌ إلى `expires_at - Date.now()`، وذاكَ يُدخِلُ انحرافَ
 * ساعةِ الهاتفِ في حكمِ صلاحيّةِ عرضٍ. فالخادمُ يقولُ `seconds_left` **ولحظتَه**
 * (`server_time`)، والباقي فرقُ قراءتَينِ من ساعةٍ واحدةٍ.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا أجرةَ ولا حقلَ لها**: الطبقةُ الماليّةُ **غائبةٌ بإعلانٍ**
 *      (`ADR 0039` §٤ · `م13-7` · `DEC-11`) — لا `fare` ولا `fare: null`.
 *   ــ **لا مدّةَ وصولٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`)، والشاشةُ تقولُه سطراً.
 *   ــ **لا هويّةَ راكبٍ**: لا اسمَ ولا هاتفَ ولا معرِّفَ تلغرامَ — عرضٌ
 *      **مُحتَملٌ** لا يُبرِّرُ كشفَ راكبٍ لكلِّ سائقٍ في الجولةِ.
 *   ــ **لا خريطةَ ولا مسارَ طريقٍ**: إحداثيّتانِ فحسب، والخريطةُ دَينٌ مُعلَنٌ.
 */

/** مسافةٌ **موسومةٌ في نوعِها** — لا رقمَ عارياً يُقرأُ طولَ طريقٍ (`ADR 0024`). */
export interface ApiTaggedDistance {
  readonly kind: "STRAIGHT_LINE";
  readonly meters: number;
}

export type ApiDriverOfferService = "transport" | "delivery";

export type ApiDriverOfferStatus = "pending" | "accepted" | "rejected" | "expired" | "cancelled";

export type ApiDriverOrderStatus =
  | "scheduled"
  | "searching"
  | "matched"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export interface ApiDriverOfferCard {
  readonly offer_id: string;
  readonly order_id: string;
  readonly round: number;
  readonly service: ApiDriverOfferService;
  /** الباقي **لحظةَ القراءةِ** بساعةِ القاعدةِ — لا لحظةَ انتهاءٍ مُطلقةً. */
  readonly seconds_left: number;
  /** `null` = صفُّ عرضٍ بلا قياسٍ محفوظٍ — **غيابٌ لا صفرٌ** (`ADR 0023`). */
  readonly rider_distance: ApiTaggedDistance | null;
  readonly trip_distance: ApiTaggedDistance | null;
  readonly pickup_label: string | null;
  readonly dropoff_label: string | null;
  /** `LOC-TRUST-01` — ملاحظاتُ الراكبِ ورابطُه الأصليُّ ورابطُ الفتح؛ تغيبُ من بوّابةٍ أقدم. */
  readonly pickup_notes?: string | null;
  readonly pickup_link?: string | null;
  readonly pickup_open_url?: string | null;
  readonly dropoff_notes?: string | null;
  readonly dropoff_link?: string | null;
  readonly dropoff_open_url?: string | null;
  /** `WR-05` — سياسةُ المبلغِ ومبلغُه كما كتبَهما الراكب؛ تغيبُ من بوّابةٍ أقدم. */
  readonly offer_mode?: "fixed" | "suggested" | "open" | null;
  readonly offer_sar?: number | null;
  /** `WR-06` — وقتُ الحضورِ ISO، و`null` = الآن. غائبٌ في بوّابةٍ أقدم. */
  readonly pickup_at?: string | null;
}

/**
 * `LOAD-01 Recovery` — ردُّ إقرارِ استلامِ اللوحِ: كم إيصالًا سُجِّلَ. الإقرارُ
 * يأتي **بعدَ تطبيقِ اللقطةِ** لا عندَ جلبِها — فصلُ «سلّمها الخادمُ» عنِ
 * «وصلَتْ» هوَ عينُ أمانةِ القياسِ.
 */
export interface DriverOffersReceiptsResponse {
  readonly ok: boolean;
  readonly recorded: number;
}

export interface DriverOffersResponse {
  readonly ok: true;
  /** لحظةُ الخادمِ — تُقرأُ لتُوثِّقَ أنَّ المؤقّتَ من عندِه لا من الجهازِ. */
  readonly server_time: string;
  readonly is_available: boolean;
  readonly availability_changed_at: string | null;
  readonly is_blocked: boolean;
  /** `EXPIRED:insurance` ونظائرُها — نصٌّ من القاعدةِ يُقسَمُ في `offers-view`. */
  readonly block_reasons: readonly string[];
  /**
   * `WR-11` — أسبابُ استبعادِ المتوفّرِ غيرِ المحجوب: `NOT_VERIFIED`/`NO_LOCATION`/`STALE_LOCATION`.
   * اختياريّةٌ: بوّابةٌ أقدمُ لا ترسلُها فيبقى اللوحُ كما كان.
   */
  readonly eligibility_reasons?: readonly string[];
  readonly offers: readonly ApiDriverOfferCard[];
}

export interface ApiDriverOfferPlace {
  readonly label: string | null;
  readonly latitude: number;
  readonly longitude: number;
  /** `LOC-TRUST-01` — تغيبُ من بوّابةٍ أقدم. */
  readonly link?: string | null;
  readonly notes?: string | null;
  readonly open_url?: string | null;
}

export interface DriverOfferDetailResponse {
  readonly ok: true;
  readonly server_time: string;
  readonly offer_id: string;
  readonly order_id: string;
  readonly round: number;
  readonly service: ApiDriverOfferService;
  readonly offer_status: ApiDriverOfferStatus;
  readonly order_status: ApiDriverOrderStatus;
  readonly seconds_left: number;
  /** **حكمُ الخادمِ** على القبولِ — الشاشةُ تُخفي زرّاً ولا تحكمُ بنفسِها. */
  readonly is_claimable: boolean;
  readonly pickup: ApiDriverOfferPlace;
  readonly dropoff: ApiDriverOfferPlace | null;
  readonly rider_distance: ApiTaggedDistance | null;
  readonly trip_distance: ApiTaggedDistance | null;
  readonly notes: string | null;
  /** `WR-05` — سياسةُ المبلغِ ومبلغُه كما كتبَهما الراكب؛ تغيبُ من بوّابةٍ أقدم. */
  readonly offer_mode?: "fixed" | "suggested" | "open" | null;
  readonly offer_sar?: number | null;
  /** `WR-06` — وقتُ الحضورِ ISO، و`null` = الآن. غائبٌ في بوّابةٍ أقدم. */
  readonly pickup_at?: string | null;
}

export interface AcceptDriverOfferResponse {
  readonly ok: true;
  readonly order_id: string;
  readonly matched_at: string | null;
  /** `WR-09` — `true` ⇒ الطلبُ محجوزٌ لكَ والراكبُ يقرّر؛ تغيبُ من بوّابةٍ أقدم. */
  readonly pending_rider?: boolean;
  /** الباقي من مهلةِ قرارِ الراكبِ بساعةِ الخادمِ لحظةَ الردّ. */
  readonly seconds_left?: number | null;
}

export interface RejectDriverOfferResponse {
  readonly ok: true;
  readonly offer_id: string;
}

export interface DriverAvailabilityResponse {
  readonly ok: true;
  readonly is_available: boolean;
}

/**
 * `ADR 0286` — دوراتُ القروباتِ المفتوحةُ في مدينةِ السائقِ: إشعارُ البطاقةِ نفسُها
 * (الخدمةُ · الالتقاطُ · الوجهةُ · نافذةُ الجمعِ) والمطالبةُ فعلٌ من التطبيقِ لا من
 * زرِّ القروبِ. وثواني النافذةِ من الخادمِ كما في العروضِ (`ADR 0117`).
 */
export interface ApiDriverNegotiationCard {
  readonly negotiationId: string;
  readonly orderId: string;
  readonly service: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly collectSecondsLeft: number;
  readonly myPosition: number | null;
}

export interface DriverNegotiationsResponse {
  readonly ok: true;
  readonly negotiations: readonly ApiDriverNegotiationCard[];
}

export interface ClaimNegotiationResponse {
  readonly ok: true;
  readonly registered: boolean;
  readonly position: number | null;
  readonly slots: number | null;
  readonly reason: string | null;
}

export interface LeaveNegotiationResponse {
  readonly ok: true;
  readonly withdrawn: boolean;
  readonly reason: string | null;
}
