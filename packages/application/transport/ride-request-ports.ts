/**
 * الغرض: عقدُ أمرِ إنشاءِ الرحلةِ وقراءةِ حالةِ بحثِها بينَ طبقةِ التطبيقِ
 *   والقاعدةِ — رموزُ رفضٍ مُعلَنةٌ، وحمولةٌ **بلا أجرةٍ ولا خانةٍ لها**
 *   (البند `F2-05` · `SR-05` · `ARCH-006`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: packages/application/transport
 * يُستخدم من: `packages/application/transport/request-ride.ts` ·
 *   `packages/application/transport/read-ride-search.ts` ·
 *   `packages/infrastructure/transport/ride-request-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ قارئاً للرحلةِ النشطةِ بعدَ الإسنادِ
 *   على العقدِ نفسِه، و`F3` يزيدُ منفذَ الإسنادِ ولا يُعدِّلُ هذَينِ.
 * ملاحظات مستقبلية: متى حلَّ التوجيهُ الحقيقيُّ (`ADR 0024`) زِيدَت مدّةٌ إلى
 *   `RideSearchState` **موسومةً** كما في `F2-04`، ولا تُنشَرُ رقماً عارياً.
 *
 * ## لماذا مِنفذانِ لا مِنفذٌ واحدٌ
 *
 * الأمرُ يكتبُ والقراءةُ تقرأُ. ولو جُمِعا في واجهةٍ واحدةٍ لَاحتاجَ مسارُ
 * `GET` أن يَحمِلَ تبعيةً تملكُ حقَّ الإنشاءِ، فيُقرأُ في المراجعةِ «هذا المسارُ
 * يستطيعُ أن يُنشئَ رحلةً» — وهوَ ما لا يجبُ أن يستطيعَه.
 *
 * ## ولماذا رمزُ الطلبِ النشطِ يحملُ معرّفَ الطلبِ
 *
 * «لديكَ رحلةٌ جاريةٌ» بلا معرّفٍ يُنتِجُ شاشةً مسدودةً: الراكبُ لا يستطيعُ أن
 * يذهبَ إلى رحلتِه ولا أن يُلغيَها. فالرفضُ يحملُ **طريقَ الخروجِ منه**.
 *
 * ## ما لا يفعلُه هذا العقدُ عن قصدٍ
 *
 *   ــ **لا يعرفُ أجرةً ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ ولا حقلاً فارغاً لها**:
 *      `ADR 0039` §٤ يحجبُ الآليّةَ على `DEC-11`، و`م13-7` يُجمِّدُ الهياكلَ
 *      التمهيديّةَ، و`scripts/check-ride-request-contract.ts` يُسقِطُ CI إن عادَت.
 *   ــ **لا يُسنِدُ سائقاً ولا يقرأُ ترتيبَ بثٍّ**: ذاكَ `F3`.
 *   ــ **لا يُصرِّحُ بمدينةٍ في الأمرِ**: المدينةُ من صفِّ صاحبِ الحسابِ في
 *      القاعدةِ (القاعدة 0.4)، ومن أرسلَها في الجسمِ أرسلَ ما يُهمَلُ.
 */

import type { PlaceMeta } from "../../domain/places/place-input.ts";
import type { RideStatus } from "../../domain/transport/ride-request.ts";
import type { OfferMode } from "../../shared/order-terms/index.ts";
import type { Result } from "../../shared/result/index.ts";

export type RideStoreFailureReason =
  /** لا صفَّ مستخدمٍ لهذا المعرّفِ — لا يُنشَأُ ههنا (`ADR 0035`). */
  | "USER_NOT_FOUND"
  /** صفُّ مستخدمٍ قائمٌ ولا صفَّ راكبٍ: تسجيلٌ ناقصٌ يُعلَنُ ولا يُكمَلُ ضمناً. */
  | "RIDER_NOT_REGISTERED"
  | "NOT_CONFIGURED"
  | "STORE_ERROR";

export interface RideStoreFailure {
  readonly reason: RideStoreFailureReason;
}

/**
 * رفضُ الأمرِ — حكمٌ مقيسٌ لا عطبٌ.
 *
 * ولا يُطوى `ACTIVE_RIDE_EXISTS` في `STORE_ERROR`: «عندَك رحلةٌ» جوابٌ صحيحٌ
 * عن سؤالٍ صحيحٍ، وعرضُه عطباً يجعلُ الراكبَ يُعيدُ المحاولةَ بلا أملٍ.
 */
export type RideRequestRefusal =
  | "INVALID_POINT"
  | "CITY_HAS_NO_SERVICE_AREA"
  /**
   * المدينةُ غيرُ مُفعَّلةٍ — الخطوةُ ٨.
   *
   * ويُقابِلُ الرمزَ نفسَه في بابِ السائقِ (`start_trial`): بابانِ بلغةٍ واحدةٍ
   * لا رمزانِ لمعنىً واحدٍ (القاعدة 0.6).
   */
  | "CITY_NOT_ACTIVE"
  | "ORIGIN_OUTSIDE_SERVICE_AREA"
  | "DESTINATION_OUTSIDE_SERVICE_AREA"
  | "SERVICE_NOT_AVAILABLE_IN_CITY"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_TOO_LONG"
  /** حدُّ ملاحظةِ السائقِ — يُفحَصُ في النطاقِ **وفي القاعدةِ** (القاعدة 0.6). */
  | "NOTES_TOO_LONG"
  | "ACTIVE_RIDE_EXISTS"
  /** `LOC-TRUST-01` — مكانٌ لم يقبلْه حكمُ القاعدةِ (مصدرٌ مجهولٌ أو حدٌّ متجاوَز). */
  | "PLACE_INVALID";

export interface RidePoint {
  readonly lat: number;
  readonly lng: number;
}

/** ما تُعيدُه القاعدةُ عندَ القبولِ: معرّفٌ وختمُ إنشاءٍ و**هل أُعيدَ أمرٌ سابقٌ**. */
export interface CreatedRide {
  readonly orderId: string;
  readonly createdAtMs: number;
  /** `true` = المفتاحُ نفسُه سبقَ، فلا صفَّ جديدَ — وهذا **نجاحٌ** لا فشلٌ. */
  readonly reused: boolean;
  /**
   * `WR-06` — حالةُ الطلبِ بعدَ الإنشاء: `scheduled` إن كانَ موعدُه أبعدَ من مهلةِ الإطلاق،
   * وإلّا `searching`. غيابُها (مخزنٌ أقدم) يُقرأُ `searching`.
   */
  readonly status?: RideStatus;
  /** موعدُ الحضورِ و**لحظةُ بدءِ البحث** للمجدول — `null` لما ليسَ مجدولًا. */
  readonly pickupAtMs?: number | null;
  readonly dispatchAtMs?: number | null;
}

export type RideRequestVerdict =
  | { readonly accepted: true; readonly ride: CreatedRide }
  | {
      readonly accepted: false;
      readonly refusal: RideRequestRefusal;
      /** يُملأُ في `ACTIVE_RIDE_EXISTS` وحدَه: طريقُ الخروجِ من الرفضِ. */
      readonly activeRide: { readonly orderId: string; readonly status: RideStatus } | null;
    };

export interface RideRequestCommand {
  create(input: {
    /** نصٌّ لا عددٌ — يُفحَصُ في المحوّلِ قبلَ أن يُرسَلَ إلى `bigint`. */
    readonly telegramUserId: string;
    readonly idempotencyKey: string;
    readonly service: string;
    readonly origin: RidePoint;
    /** الوجهةُ — معدومةٌ في مسارِ البوتِ `/skip`. كلٌّ أو لا شيء. */
    readonly destination: RidePoint | null;
    /** ملاحظةُ السائقِ (`SR-04`) — `null` غيابٌ، لا نصٌّ فارغٌ. */
    readonly notes: string | null;
    /**
     * `RIDE-LABEL-01` — اسما الالتقاطِ والوجهةِ كما اختارَهما الراكبُ، ليراهما السائقُ
     * بدلَ «مكانٍ غيرِ مُسمّى». اختياريّانِ: مسارُ البوتِ لا يعرفُهما.
     */
    readonly pickupLabel?: string | null;
    readonly dropoffLabel?: string | null;
    /** `ORDER-TERMS-01` — وقتُ حضورِ السائقِ. null ⇒ الآن. */
    readonly pickupAt?: Date | null;
    /** `ORDER-OFFER-01` — ما يعرضُه الراكبُ بالريال. null ⇒ قابلٌ للتفاوض. */
    readonly offerSar?: number | null;
    /**
     * `WR-05` — سياسةُ المبلغ. غيابُها (البوت) ⇒ `open` في المخزن، فلا طلبَ جديدٌ بلا سياسة.
     */
    readonly offerMode?: OfferMode;
    /**
     * `LOC-TRUST-01` — مصدرُ النقطةِ ودقّتُها ووقتُها والرابطُ الأصليُّ وملاحظاتُ المكان.
     * غيابُهما (البوتُ وعميلٌ قديم) يُبقي النداءَ القديمَ حرفاً.
     */
    readonly pickupPlace?: PlaceMeta | null;
    readonly dropoffPlace?: PlaceMeta | null;
  }): Promise<Result<RideRequestVerdict, RideStoreFailure>>;
}

/** حالةُ البحثِ كما تُقرأُ من القاعدةِ — العددُ مشتقٌّ من صفوفِ العروضِ. */
export interface RideSearchState {
  readonly orderId: string;
  readonly status: RideStatus;
  readonly service: string;
  readonly createdAtMs: number;
  readonly notifiedDriverCount: number;
  /** فُتِحَتْ دورةُ الدائرةِ الأوسعِ — رايةٌ داخليةٌ يُشتقُّ منها الطورُ ولا تُنشَرُ كما هي (`PD-050`). */
  readonly widerCircleOpened: boolean;
  /** وصلَ الطلبُ إلى قروبِ الإسنادِ بتصعيدٍ مُسلَّمٍ — رايةٌ داخليةٌ مثلُ سابقتِها. */
  readonly escalated: boolean;
  readonly cancellableWithoutPenalty: boolean;
  /** `WR-06` — بدءُ البحثِ الفعليّ (إطلاقُ المجدول)؛ غيابُه ⇒ `createdAtMs`. */
  readonly searchStartedAtMs?: number;
  /** `WR-06` — موعدُ الحضورِ ولحظةُ الإطلاقِ (للمجدولِ وحدَه). */
  readonly pickupAtMs?: number | null;
  readonly dispatchAtMs?: number | null;
}

export type RideSearchRefusal = "INVALID_ORDER_ID" | "ORDER_NOT_FOUND";

export type RideSearchVerdict =
  | { readonly found: true; readonly state: RideSearchState }
  | { readonly found: false; readonly refusal: RideSearchRefusal };

export interface RideSearchReader {
  read(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<RideSearchVerdict, RideStoreFailure>>;
}

/**
 * رفضُ الإلغاءِ.
 *
 * و`ORDER_NOT_CANCELLABLE` **مفصولٌ** عن `ORDER_NOT_FOUND` كما فصلتهما
 * `cancel_order_by_rider` منذُ `20260906040000`: «لا رحلةَ» و«فاتَ أوانُ الإلغاءِ»
 * جوابانِ مختلفانِ، وقولُ أحدِهما مكانَ الآخرِ كذبٌ على الراكبِ.
 */
export type RideCancelRefusal = "INVALID_ORDER_ID" | "ORDER_NOT_FOUND" | "ORDER_NOT_CANCELLABLE";

export type RideCancelVerdict =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly refusal: RideCancelRefusal };

export interface RideCancelCommand {
  cancel(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<RideCancelVerdict, RideStoreFailure>>;
}
