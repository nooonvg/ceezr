/**
 * الغرض: **عقدُ** مساراتِ الرحلةِ عندَ العميلِ — أشكالُ الطلبِ والردِّ وحدَها،
 *   بلا نداءِ شبكةٍ وبلا استيرادٍ زمنَ التنفيذِ (البند `F2-05` · `SR-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `ride-api.ts` (النداءُ) و`search-view.ts` (العرضُ).
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ الرحلةِ النشطةِ في `F2-06` تقرأُ `status`
 *   و`service` من هذا العقدِ نفسِه ولا تُعيدُ تعريفَهما.
 * ملاحظات مستقبلية: لا حقلَ أجرةٍ ولا وسيلةِ دفعٍ ولا عقوبةِ إلغاءٍ ههنا قبلَ
 *   `DEC-11` (`ADR 0039` §٤ · `م13-7`) — ولا حقلَ مُعَدّاً لها.
 *
 * ## لماذا مِلفٌّ للعقدِ منفصلٌ — كما في `F2-03` و`F2-04`
 *
 * نموذجُ العرضِ دالّاتٌ نقيّةٌ تُقاسُ بلا مُتصفِّحٍ، ولو استوردَ أشكالَه من مِلفِّ
 * النداءِ لَجرَّ معَه `api/client.ts` وفيه `window` و`fetch`.
 *
 * ## ولماذا `createdAt` نصُّ ختمٍ لا مدّةٌ محسوبةٌ
 *
 * لأنَّ المدّةَ المعروضةَ يجبُ أن تُقاسَ **من ميلادِ الرحلةِ** لا من فتحِ الشاشةِ:
 * راكبٌ أغلقَ التطبيقَ ثمَّ عادَ بعدَ خمسِ دقائقَ يجبُ أن يرى خمساً لا صفراً.
 * فالختمُ يُنشَرُ، والعميلُ يطرحُه من ساعتِه، والخادمُ يُنشرُ `elapsedSeconds`
 * أيضاً كي تُصحَّحَ ساعةُ جهازٍ منحرفةٍ عندَ كلِّ قراءةٍ.
 *
 * ## وما لا يفعلُه: لا دالّةَ ولا ثابتَ ولا نصَّ معروضاً — أنواعٌ تُمحى كلُّها.
 */

/** حالةُ الرحلةِ كما تُنشَرُ — نصٌّ لا رقمٌ، ويُصادَقُ في `search-view.ts`. */
export type ApiRideStatus = string;

export interface ApiActiveRide {
  readonly orderId: string;
  readonly status: ApiRideStatus;
}

/**
 * ردُّ الإنشاءِ. يُميَّزُ بـ`accepted` لا برمزِ حالةٍ: «لديكَ رحلةٌ قائمةٌ» جوابٌ
 * صحيحٌ عن سؤالٍ صحيحٍ، ولو نُشِرَ `409` لَابتلعَه `apiFetch` خطأً فصارَ شاشةَ
 * انقطاعٍ بلا طريقِ خروجٍ.
 */
export type RequestRideResponse =
  | {
      readonly ok: true;
      readonly accepted: true;
      readonly orderId: string;
      readonly createdAt: string;
      /** `true` يعني: ضغطتُك الثانيةُ لم تُنشئْ رحلةً ثانيةً (`ARCH-006`). */
      readonly reused: boolean;
      /** `WR-06` — `scheduled` لموعدٍ أبعدَ من مهلةِ الإطلاق، وإلّا `searching`. غيابُه (خادمٌ أقدم) ⇒ بحث. */
      readonly status?: ApiRideStatus;
      readonly pickupAt?: string | null;
      /** لحظةُ بدءِ البحثِ عن سائقٍ للمجدول. */
      readonly dispatchAt?: string | null;
    }
  | {
      readonly ok: true;
      readonly accepted: false;
      readonly refusal: string;
      /** طريقُ الخروجِ من «لديكَ رحلةٌ قائمةٌ» — و`null` لِما لا طريقَ له. */
      readonly activeRide: ApiActiveRide | null;
    };

export type RideSearchResponse =
  | {
      readonly ok: true;
      readonly found: true;
      readonly orderId: string;
      readonly status: ApiRideStatus;
      readonly service: string;
      readonly phase: string;
      readonly createdAt: string;
      /** عددُ السائقينَ المبلَّغينَ كما قاسَته القاعدةُ — والصفرُ صفرٌ. */
      readonly notifiedDriverCount: number;
      readonly elapsedSeconds: number;
      readonly cancellableWithoutPenalty: boolean;
      /** `WR-06` — موعدا المجدول؛ `null` لما ليسَ مجدولًا، وغيابُهما خادمٌ أقدم. */
      readonly pickupAt?: string | null;
      readonly dispatchAt?: string | null;
    }
  | { readonly ok: true; readonly found: false; readonly refusal: string };

export type CancelRideResponse =
  | { readonly ok: true; readonly cancelled: true }
  | { readonly ok: true; readonly cancelled: false; readonly refusal: string };

/**
 * `WR-05` — سياسةُ المبلغِ كما يختارُها الراكبُ في نموذجِ الطلب. البوّابةُ تحكمُ عليها
 * بقاعدتِها (`packages/application/transport/offer-policy.ts`) ولا تثقُ بالعميل.
 */
export type RiderOfferMode = "fixed" | "suggested" | "open";
