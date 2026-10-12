/**
 * الغرض: شكلُ ردودِ مساراتِ مَهمّةِ السائقِ النشطةِ كما يقرؤها العميلُ — أنواعٌ
 *   لا منطقٌ (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/job
 * يُستخدم من: `job-api.ts` · `job-view.ts` · `JobScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — الأرباحُ تُقرأُ من مسارٍ آخرَ، ولا يُوسَّعُ
 *   جوابُ الإنهاءِ ليحملَ حصيلةً.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ الطَورُ يُنشَرُ **فعلاً قادماً** (`next_action`) لا حالةً تُترجَمُ
 *
 * لأنَّ الشاشةَ لو اشتقّت زرَّها من `status` وأختامِ الزمنِ لَصارَ في التطبيقِ
 * نسخةٌ ثانيةٌ من آلةِ الحالاتِ: تتقادَمُ حينَ يُضافُ طَورٌ في القاعدةِ، ويرى
 * سائقٌ زرَّ «بدأتُ» على رحلةٍ لم يَختِم وصولَها. فالخادمُ يقولُ **ما يُفعَلُ
 * الآنَ**، والشاشةُ تُصيِّرُه زرّاً واحداً — مصدرُ حقيقةٍ واحدٌ.
 *
 * ## وما لا يصفُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا هاتفَ راكبٍ ولا معرِّفَ تلغرامَ**: الاسمُ الأوّلُ ولغتُه فحسب، وقناةُ
 *      الاتّصالِ بندٌ لهُ حكمُه لا يُشتَقُّ ههنا.
 *   ــ **لا أجرةَ ولا حقلَ لها** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا مسافةَ ولا مدّةَ وصولٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`)، ولا يُشتَقُّ
 *      طَورٌ من قُربٍ (`ADR 0118`).
 *   ــ **لا مسارَ طريقٍ ولا خريطةً مُضمَّنةً**: إحداثيّتانِ ورابطٌ خارجيٌّ.
 */

export type ApiDriverJobService = "transport" | "delivery";

export type ApiDriverJobStatus = "matched" | "in_progress";

/** الفعلُ القادمُ **بحكمِ الخادمِ** — الشاشةُ تُصيِّرُه زرّاً ولا تحكمُ بنفسِها. */
export type ApiDriverJobAction = "MARK_ARRIVED" | "START_RIDE" | "COMPLETE_RIDE";

export interface ApiDriverJobPlace {
  readonly label: string | null;
  readonly latitude: number;
  readonly longitude: number;
  /**
   * رابطُ ملاحةٍ **يُبنَى في الخادمِ** وتفتحُه الشاشةُ كما أُعطِيَت. ولا
   * يُركَّبُ ههنا عن قصدٍ: `F1-10` و`TG-005` يقصُرانِ عنوانَ المطلقِ في حزمةِ
   * المصغَّرِ على قائمةٍ مغلقةٍ، ومُضيفُ الملاحةِ **لا يُوسَّعُ له حاجزٌ**
   * لأنَّه ليسَ أصلاً تنفيذيّاً — فيبقى في الخادمِ حيثُ يُقرأُ في سجلِّ المخارجِ.
   */
  readonly navigation_url: string;
  /** `LOC-TRUST-01` — ملاحظاتُ الراكبِ ورابطُه الأصليُّ ورابطُ الفتحِ (الأصليُّ إن صلحَ)؛ تغيبُ من بوّابةٍ أقدم. */
  readonly link?: string | null;
  readonly notes?: string | null;
  readonly open_url?: string | null;
}

/** راكبٌ **بلا هويّةٍ تُتعقَّبُ** — اسمٌ أوّلُ ولغةٌ تُخاطَبُ بها. */
export interface ApiDriverJobRider {
  readonly first_name: string | null;
  readonly language_code: string | null;
}

export interface ApiDriverActiveJob {
  readonly order_id: string;
  readonly status: ApiDriverJobStatus;
  readonly service: ApiDriverJobService;
  readonly next_action: ApiDriverJobAction;
  readonly matched_at: string | null;
  /** `null` = لم يُختَم وصولٌ — **غيابٌ لا صفرٌ** ولا استنتاجٌ من مسافةٍ. */
  readonly arrived_at: string | null;
  readonly started_at: string | null;
  readonly pickup: ApiDriverJobPlace;
  readonly dropoff: ApiDriverJobPlace | null;
  readonly notes: string | null;
  readonly rider: ApiDriverJobRider;
  /** `WR-05` — سياسةُ المبلغِ ومبلغُه كما كتبَهما الراكب؛ تغيبُ من بوّابةٍ أقدم. */
  readonly offer_mode?: "fixed" | "suggested" | "open" | null;
  readonly offer_sar?: number | null;
}

/** سببُ النبضةِ **كما قالَه الخادمُ** — ولا يُشتَقُّ من `status` في الشاشةِ. */
export type ApiBroadcastReason = "AVAILABLE" | "TO_PICKUP" | "ON_TRIP";

/**
 * سياسةُ نبضةِ الموقعِ (`F3-04`). **ومُدّةٌ لا ختمُ انتهاءٍ**: العميلُ ينتظرُ
 * رقماً ولا يطرحُ بساعتِه. و`interval_seconds = null` **لا تبثَّ** — غيابٌ
 * يُطاعُ لا نقصٌ يُكمَّلُ بافتراضٍ في الشاشةِ (`ADR 0023`).
 */
export interface ApiLocationBroadcast {
  readonly reason: ApiBroadcastReason | null;
  readonly interval_seconds: number | null;
}

export interface DriverActiveJobResponse {
  readonly ok: true;
  /** لحظةُ الخادمِ — كلُّ عُمرٍ يُعرَضُ فرقٌ عنها لا عن ساعةِ الجهازِ. */
  readonly server_time: string;
  /** في الجذرِ لا داخلَ `job`: سائقٌ متاحٌ بلا مَهمّةٍ يبثُّ أيضاً. */
  readonly location_broadcast: ApiLocationBroadcast;
  /** `null` = لا مَهمّةَ الآنَ — **عَدَمٌ صريحٌ** لا كائنٌ فارغٌ. */
  readonly job: ApiDriverActiveJob | null;
}

export interface DriverJobArrivedResponse {
  readonly ok: true;
  readonly order_id: string;
  readonly arrived_at: string;
}

export interface DriverJobStartedResponse {
  readonly ok: true;
  readonly order_id: string;
  readonly started_at: string;
}

export interface DriverJobCompletedResponse {
  readonly ok: true;
  readonly order_id: string;
  readonly completed_at: string;
  /** مقيسةٌ في الكاتبِ — تُنقَلُ ولا تُحسَبُ في العميلِ. */
  readonly duration_seconds: number | null;
}

/**
 * فعلُ «تعذّرَ الإكمالُ» (`PD-020` · `ADR 0159`) — **بلاغُ سلامةٍ لا تغييرُ
 * حالةٍ**: الرحلةُ تبقى على حالِها والفريقُ يقرَّرُ. والرفضُ جوابٌ لا عطبُ
 * طلبٍ (رمزُ حالةٍ 200) — سائقٌ في لحظةِ عُجزٍ لا يُدرَّبُ على إعادةِ الصياغةِ.
 */
export type DriverCannotCompleteResponse =
  | { readonly ok: true; readonly accepted: false; readonly refusal: string }
  | {
      readonly ok: true;
      readonly accepted: true;
      readonly order_id: string;
      readonly incident_id: string;
      /**
       * `false` = «بلاغُكَ الأوّلُ ما يزالُ قائماً» — مثلُه مثلَ استغاثةِ الراكبِ:
       * مَن أبلغَ ثمَّ رأى «لم يحدثْ شيءٌ» ضغطَ ثانيةً فيُشتِّتُ الفريقَ.
       */
      readonly created: boolean;
    };
