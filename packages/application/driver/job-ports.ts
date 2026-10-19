/**
 * الغرض: منافذُ مَهمّةِ السائقِ النشطةِ — عقدُ ما تحتاجُه حالاتُ الاستخدامِ من
 *   **مخزنِ قاعدةٍ** للقراءةِ ولأطوارِ الثلاثةِ، بلا SQL ولا HTTP (`F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-job.ts` ·
 *   `packages/infrastructure/driver/driver-job-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — قراءةُ الرحلاتِ المُنتهيةِ منفذٌ يُضافُ،
 *   ولا يُوسَّعُ عقدُ المَهمّةِ النشطةِ ليحملَ تاريخاً.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ **منفذٌ منفصلٌ** عن `DriverOfferStore` ولا طريقةٌ تُضافُ إليه
 *
 * لأنَّ الحقَّينِ مختلفانِ: عقدُ العروضِ حقُّ سائقٍ على **عرضٍ وُجِّهَ إليه**،
 * وهذا حقُّ سائقٍ على **مَهمّةٍ أُسندَت إليه**. ولو جُمِعا في عقدٍ واحدٍ لَصارَ
 * كلُّ مُركِّبٍ يحملُ سلطةَ الأطوارِ ليقرأَ لوحاً — وأوسعُ سلطةٍ في العقدِ تُقرأُ
 * سلطةَ كلِّ مُستعمِلِه. والمخزنُ الماديُّ واحدٌ (`Sql` واحدٌ)، والفصلُ في العقدِ
 * لا في الاتّصالِ.
 *
 * ## ولِمَ الأطوارُ الثلاثةُ **ثلاثُ طرقٍ** لا طريقةٌ بمُعامَلِ فعلٍ
 *
 * `transition(action)` كانت ستُخفي أنَّ لكلِّ طَورٍ **كاتباً مختلفاً** في
 * القاعدةِ: الوصولُ كاتبٌ جديدٌ، والبدءُ والإنهاءُ تفويضٌ إلى كاتبَينِ قائمَينِ.
 * ودالّةٌ واحدةٌ بمُعامَلٍ نصّيٍّ تُغري بـ`switch` في المحوِّلِ، فيصيرُ اسمُ
 * الفعلِ نصّاً يُمرَّرُ من الشاشةِ إلى القاعدةِ — وذاكَ سطحُ هجومٍ بلا مقابلٍ.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ إلغاءً**: `cancel_ride_by_telegram` كاتبُ الإلغاءِ القائمُ،
 *      وسياسةُ الإلغاءِ بعدَ الإسنادِ **مُجمَّدةٌ بقرارٍ** (`F2-06`).
 *   ــ **لا يقولُ موضعاً يُبَثُّ**: `F3-04` بندُ البثِّ، ومنفذُه يُضافُ هناكَ.
 *   ــ **لا يقولُ إخطاراً**: صندوقُ الصادرِ القائمُ يُخطِرُ الراكبَ.
 *   ــ **لا يعرفُ أجرةً** (`ADR 0039` §٤ · `م13-7`).
 */

import type {
  DriverJobArrival,
  DriverJobCompletion,
  DriverJobSnapshot,
  DriverJobStart,
} from "../../domain/driver/driver-job.ts";
import type { Result } from "../../shared/result/index.ts";
import type { RiderTripDepositOutcome } from "./rider-trip-notice.ts";

/**
 * رفضٌ **مُصنَّفٌ** من القاعدةِ — مجالٌ مغلقٌ يُقابِلُ رموزَ دوالِّ `F3-03`
 * حرفاً. و`JOB_NOT_FOUND` **جوابٌ واحدٌ** لمَهمّةٍ معدومةٍ ولمَهمّةِ غيرِه.
 */
export type DriverJobStoreRejection =
  | "USER_NOT_FOUND"
  | "NOT_A_DRIVER"
  | "JOB_NOT_FOUND"
  /** الطَورُ لا يسمحُ بالفعلِ — حالةٌ لا مِلكيّةٌ (المِلكيّةُ فُحِصَت قبلَه). */
  | "PHASE_MISMATCH"
  /** ختمُ الوصولِ موجودٌ سلفاً — ليسَ عطباً ولا نجاحاً صامتاً. */
  | "ALREADY_ARRIVED"
  /** رفضٌ من الكاتبِ القائمِ بلا رمزٍ معروفٍ — يُنقَلُ ولا يُخترَعُ له معنًى. */
  | "TRANSITION_REFUSED";

/** عطبُ مخزنٍ أو حمولةٌ لا تُفهَمُ — يُنشَرُ `503`، ولا يُخلَطُ برفضٍ مُصنَّفٍ. */
export interface DriverJobStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

export interface DriverJobRejectionDetail {
  readonly rejection: DriverJobStoreRejection;
}

export type DriverJobStoreError = DriverJobStoreFailure | DriverJobRejectionDetail;

export function isDriverJobRejection(
  error: DriverJobStoreError,
): error is DriverJobRejectionDetail {
  return "rejection" in error;
}

export interface DriverJobStore {
  /** **يقرأُ ولا يكتبُ**: مَهمّةُ `SD-05` بأختامِها وحكمِ المرحلةِ ولحظةِ خادمٍ. */
  readActiveJob(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverJobSnapshot, DriverJobStoreError>>;

  /** **يكتبُ — وهذا الكاتبُ الوحيدُ لـ`arrived_at`** في النظامِ كلِّه. */
  markArrived(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<DriverJobArrival, DriverJobStoreError>>;

  /** **يكتبُ — بالتفويضِ لا بالنسخِ**: `start_ride` القائمةُ تقفلُ وتُدقِّقُ. */
  startRide(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<DriverJobStart, DriverJobStoreError>>;

  /** **يكتبُ — بالتفويضِ**: `complete_ride` القائمةُ تُعيدُ السائقَ متاحاً. */
  completeRide(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<DriverJobCompletion, DriverJobStoreError>>;

  /**
   * LOAD-01 (الدفعةُ 21) — الأطوارُ الثلاثةُ نفسُها **وإيداعُ إشعارِ الراكبِ في العبارةِ نفسِها**
   * (`driver_*_with_notice`). الطورُ بفحوصِه حرفًا كما في الطرقِ أعلاه؛ و`notice` ردُّ الإيداعِ أو
   * غيابُه (منفذٌ أقدم ⇒ المستدعي يعودُ إلى المسارِ المستقلّ). اختياريٌّ: المنفذُ الذي لا يملكُه
   * يبقى صالحًا بنداءَين.
   */
  markArrivedWithNotice?(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<WithRiderNotice<DriverJobArrival>, DriverJobStoreError>>;
  startRideWithNotice?(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<WithRiderNotice<DriverJobStart>, DriverJobStoreError>>;
  completeRideWithNotice?(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<WithRiderNotice<DriverJobCompletion>, DriverJobStoreError>>;
}

/** نتيجةُ الطورِ وإيداعُ إشعارِه إن أعادَته العبارة. */
export interface WithRiderNotice<T> {
  readonly value: T;
  readonly notice?: RiderTripDepositOutcome;
}
