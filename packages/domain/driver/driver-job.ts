/**
 * الغرض: نطاقُ مَهمّةِ السائقِ النشطةِ — شكلُ المَهمّةِ وأطوارُها **وحكمُ
 *   الخادمِ على زرِّ المرحلةِ**، ولا طَورَ يُشتَقُّ من مسافةٍ (`F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/application/driver/driver-job.ts` ·
 *   `packages/infrastructure/driver/driver-job-store.ts` ·
 *   `apps/miniapp/src/surfaces/driver/job/job-view.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` (أرباحُ السائقِ) تقرأُ رحلاتٍ مُنتهيةً
 *   بأختامِها نفسِها، فلا اسمَ ثانياً لختمِ الإنهاءِ.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ **حالةُ الطلبِ ومعَها ختمُ الوصولِ** لا حالةٌ واحدةٌ خامسةٌ
 *
 * `order_status` معدودٌ في القاعدةِ ولهُ سِتُّ تسمياتٍ، والطَورُ الذي يفصلُ
 * «أُسندَ إليَّ» عن «أنا واقفٌ عندَ الراكبِ» **ليسَ حالةَ طلبٍ**: الطلبُ في
 * الحالتَينِ `matched` — لم تبدأِ الرحلةُ ولم يُلغَ شيءٌ. فإضافةُ تسميةٍ سابعةٍ
 * كانت ستُجبِرَ كلَّ قارئٍ لحالةِ الطلبِ في النظامِ على أن يعرفَها (والحارسُ في
 * `20260814140000` يُسقِطُ الترحيلَ لمن يُضيفُ تسميةً بلا تحريرِ كلِّ قارئٍ)،
 * وهيَ كُلفةٌ لطَورٍ يخصُّ سطحاً واحداً. فالطَورُ **ختمٌ زمنيٌّ** (`arrivedAt`)
 * إلى جانبِ الحالةِ، والحكمُ المُركَّبُ منهما يقولُه الخادمُ مرّةً في
 * `nextAction`.
 *
 * ## و«قاربَ» ليسَ «وصلَ» — (`ADR 0118`)
 *
 * لا دالّةَ ههنا تأخذُ مسافةً ولا موضعاً: لو صارَ الطَورُ استنتاجاً من قُربٍ
 * لَرأى الراكبُ «وصلَ سائقُك» وسائقُه واقفٌ في إشارةٍ على مئةِ مترٍ، فيخرجُ إلى
 * الشارعِ ليلاً على كَذِبةٍ. **والختمُ فعلُ إنسانٍ يُسألُ عنه.**
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()` — الأختامُ نصوصٌ
 *      تُمرَّرُ كما قالَتها القاعدةُ.
 *   ــ **لا يُقدِّرُ زمنَ وصولٍ ولا مدّةَ رحلةٍ**: امتناعٌ مُصنَّفٌ (`ADR 0024`)،
 *      والمدّةُ **مقيسةٌ في الكاتبِ** بعدَ الإنهاءِ لا مُتوقَّعةٌ قبلَه.
 *   ــ **لا يعرفُ أجرةً ولا وسيلةَ دفعٍ ولا خانةً لهما** (`ADR 0039` §٤ ·
 *      `م13-7` · `DEC-11`).
 *   ــ **لا يحملُ هاتفَ الراكبِ ولا معرِّفَ تلغرامِه**: لا حقلَ لهما ألبتّةَ —
 *      وحقلٌ فارغٌ اليومَ يُملأُ غداً بلا قرارٍ.
 *   ــ **لا يُعرِّفُ نوعاً ثانياً للموضعِ ولا لحالةِ الطلبِ**: يستوردُهما من
 *      `driver-offers.ts` — نسخةٌ ثانيةٌ لشكلِ الطلبِ مصدرُ حقيقةٍ ثانٍ.
 */

import type { ServiceType } from "../../shared/kernel/index.ts";
import type { DriverOfferPlace, DriverOfferTerms, DriverOrderStatus } from "./driver-offers.ts";
import type { BroadcastPolicy } from "./location-broadcast.ts";

/**
 * أفعالُ المرحلةِ — **مجالٌ مغلقٌ يحكمُه الخادمُ**. وغيابُ الفعلِ (`null`)
 * حالٌ سويّةٌ: مَهمّةٌ في طَورٍ لا زرَّ فيه للسائقِ.
 */
export const DRIVER_JOB_ACTIONS = ["MARK_ARRIVED", "START_RIDE", "COMPLETE_RIDE"] as const;

export type DriverJobAction = (typeof DRIVER_JOB_ACTIONS)[number];

export function isDriverJobAction(value: unknown): value is DriverJobAction {
  return typeof value === "string" && (DRIVER_JOB_ACTIONS as readonly string[]).includes(value);
}

/**
 * ما يُنشَرُ عن الراكبِ للسائقِ المُسنَدِ — **الاسمُ الأوّلُ ولغةُ الخطابِ**.
 *
 * ولِمَ اللغةُ؟ لأنَّها **تُغيِّرُ فعلَ السائقِ**: سائقٌ يعلمُ أنَّ راكبَه
 * أورديُّ اللسانِ لا يُطيلُ عليه بالعربيّةِ في الهاتفِ. وأمّا الهاتفُ نفسُه
 * فمحجوبٌ إلى أن يُبنى الاتّصالُ المُقنَّعُ (`F2-06` أعلنَه عائقاً).
 */
export interface DriverJobRider {
  readonly firstName: string | null;
  readonly languageCode: string | null;
}

/** مَهمّةٌ نشطةٌ واحدةٌ — سائقٌ لا يحملُ اثنتَينِ في آنٍ بحكمِ الموزِّعِ. */
export interface DriverActiveJob {
  readonly orderId: string;
  readonly status: DriverOrderStatus;
  readonly service: ServiceType;
  /** **حكمُ الخادمِ** على زرِّ المرحلةِ — لا تحكمُ الشاشةُ عليه بنفسِها. */
  readonly nextAction: DriverJobAction | null;
  readonly matchedAt: string | null;
  /** ختمُ «وصلتُ» — `null` تعني «لمّا يُختَمْ» لا «لم يصلْ بعدُ» بحسبةِ قُربٍ. */
  readonly arrivedAt: string | null;
  readonly startedAt: string | null;
  readonly pickup: DriverOfferPlace;
  /** وجهةٌ غائبةٌ **عَدَمٌ لا صفرٌ** (`ADR 0023`) — رحلةٌ بلا وجهةٍ مسموحةٌ. */
  readonly dropoff: DriverOfferPlace | null;
  /** ملاحظةُ الراكبِ كما كتبَها — لا تُترجَمُ ولا تُقصَّرُ ههنا. */
  readonly notes: string | null;
  readonly rider: DriverJobRider;
  /** `WR-05` — معنى المبلغِ بعدَ القبول. غائبٌ = لم يُقرَأ. */
  readonly offerTerms?: DriverOfferTerms;
}

/**
 * القراءةُ الواحدةُ. و`job: null` **عَدَمٌ صريحٌ**: سائقٌ بلا مَهمّةٍ حالٌ
 * سويّةٌ تُقالُ في الشاشةِ، لا شاشةٌ تدورُ منتظرةً ما لن يأتيَ.
 */
export interface DriverJobSnapshot {
  /** لحظةُ الخادمِ — كلُّ عُمرٍ يُعرَضُ فرقٌ عنها لا عن ساعةِ الجهازِ. */
  readonly serverTime: string;
  readonly job: DriverActiveJob | null;
  /**
   * سياسةُ نبضةِ الموقعِ (`F3-04`) — **في الجذرِ لا داخلَ `job`** لأنَّ سائقاً
   * متاحاً بلا مَهمّةٍ يبثُّ أيضاً، و`job = null` لا تعني «لا نبضةَ». والمُدّةُ
   * `interval_seconds` لا `expires_at`: العميلُ يُطيعُ مُدّةً ولا يحسبُ فرقاً
   * بساعتِه (نفسُ حكمِ `F3-02`).
   */
  readonly locationBroadcast: BroadcastPolicy;
}

/** يُعادُ تصديرُه ههنا ليكونَ للقراءةِ الواحدةِ نطاقٌ واحدٌ يُقرأُ منه. */
export type { BroadcastPolicy, BroadcastReason } from "./location-broadcast.ts";

/** أثرُ ختمِ الوصولِ — الختمُ نفسُه يُعادُ ليُعرَضَ بلا قراءةٍ ثانيةٍ. */
export interface DriverJobArrival {
  readonly orderId: string;
  readonly arrivedAt: string;
}

/** أثرُ بدءِ الرحلةِ — **بلا هويّةِ راكبٍ**: الكاتبُ يُعيدُها والغلافُ يُنقّيها. */
export interface DriverJobStart {
  readonly orderId: string;
  readonly startedAt: string | null;
}

/** أثرُ الإنهاءِ — والمدّةُ **مقيسةٌ في الكاتبِ** لا محسوبةٌ ههنا. */
export interface DriverJobCompletion {
  readonly orderId: string;
  readonly completedAt: string | null;
  readonly durationSeconds: number | null;
}

/**
 * هل هذا الطَورُ يقبلُ هذا الفعلَ؟ **مِرآةُ حكمِ الخادمِ لا حُكمٌ ثانٍ**: تُستعمَلُ
 * في الشاشةِ لتعطيلِ زرٍّ ضُغِطَ مرّتَينِ قبلَ وصولِ الجوابِ، والحكمُ النافذُ
 * حكمُ القاعدةِ حتماً — فرفضُها يُعرَضُ ولا يُخفى.
 */
export function jobActionMatches(
  snapshot: DriverActiveJob | null,
  action: DriverJobAction,
): boolean {
  return snapshot !== null && snapshot.nextAction === action;
}
