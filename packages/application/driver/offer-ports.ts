/**
 * الغرض: منافذُ عروضِ السائقِ — عقدُ ما تحتاجُه حالاتُ الاستخدامِ من **مخزنِ
 *   قاعدةٍ** للقراءةِ والقبولِ، بلا SQL ولا HTTP (`F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-offers.ts` ·
 *   `packages/infrastructure/driver/driver-offers-store.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — الرحلةُ النشطةُ تقرأُ الطلبَ المطابَقَ،
 *   وقراءتُها تُضافُ منفذاً ههنا ولا يُخترَعُ مخزنٌ ثانٍ للسائقِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ **لا منفذَ رفضٍ ولا منفذَ توفُّرٍ** ههنا
 *
 * لأنَّ لكلٍّ منهما **كاتباً قائماً** (القاعدة 0.6): الرفضُ `OfferDecisionPort`
 * بحرفِ `BUG-003`، والتوفُّرُ `DriverDirectory.setAvailability` عبرَ
 * `record_attendance`. ومنفذٌ ثانٍ لهما ليسَ تجريداً بل **مصدرُ حقيقةٍ ثانٍ**
 * يختلفُ عن الأوّلِ يومَ يُعدَّلُ واحدُهما. فحالاتُ الاستخدامِ ههنا تطلبُ
 * المنفذَينِ القائمَينِ كما هما.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ ذرّيّةً**: القبولُ فعلُ `claim_ride` في القاعدةِ، وهذا
 *      المنفذُ **ينقلُ حكمَها** ولا يعرفُ قفلاً ولا معاملةً.
 *   ــ **لا يعرفُ أجرةً**: محجوبةٌ (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يُبثُّ منه إخطارٌ**: الإخطارُ صندوقُ الصادرِ القائمُ.
 */

import type {
  DriverOfferBoard,
  DriverOfferClaim,
  DriverOfferDetail,
} from "../../domain/driver/driver-offers.ts";
import type { Result } from "../../shared/result/index.ts";
import type { RiderTripDepositOutcome } from "./rider-trip-notice.ts";

/**
 * رفضٌ **مُصنَّفٌ** من القاعدةِ — مجالٌ مغلقٌ يُقابِلُ رموزَ `driver_offer_board`
 * و`driver_offer_detail` و`driver_accept_offer` حرفاً، **ورموزُ `claim_ride`
 * تمرُّ كما هيَ** لأنَّ الحكمَ حكمُها لا حكمُ غلافٍ.
 */
export type DriverOfferStoreRejection =
  | "USER_NOT_FOUND"
  | "NOT_A_DRIVER"
  | "OFFER_NOT_FOUND"
  /** الطلبُ لم يبقَ قابلاً للأخذِ — سُبِقَ إليه أو أُلغيَ (`claim_ride`). */
  | "ORDER_NOT_CLAIMABLE"
  /** العرضُ نفسُه لم يبقَ صالحاً: انتهَت مهلتُه أو أُلغيَ (`claim_ride`). */
  | "OFFER_NOT_VALID"
  /** `WR-09` — سائقٌ آخرُ مرشَّحٌ والراكبُ يقرّر؛ العرضُ باقٍ ويُعادُ إن رُفِض. */
  | "ORDER_HELD"
  /** سائقٌ من مدينةٍ وطلبٌ من أخرى — يُردُّ ولا يُطابَقُ. */
  | "CITY_MISMATCH"
  /** رفضٌ من `claim_ride` بلا رمزٍ معروفٍ — يُنقَلُ ولا يُخترَعُ له معنًى. */
  | "CLAIM_REFUSED"
  /** `I1` · `ADR 0286` — السائقُ يحملُ التزامًا قائمًا؛ لا إسنادَ ثانياً له. */
  | "DRIVER_HAS_ACTIVE_ORDER";

/** عطبُ مخزنٍ أو حمولةٌ لا تُفهَمُ — يُنشَرُ `503`، ولا يُخلَطُ برفضٍ مُصنَّفٍ. */
export interface DriverOfferStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

export interface DriverOfferRejectionDetail {
  readonly rejection: DriverOfferStoreRejection;
}

export type DriverOfferStoreError = DriverOfferStoreFailure | DriverOfferRejectionDetail;

export function isDriverOfferRejection(
  error: DriverOfferStoreError,
): error is DriverOfferRejectionDetail {
  return "rejection" in error;
}

export interface DriverOfferStore {
  /** **يقرأُ ولا يكتبُ**: لوحُ `SD-03` بمؤقّتٍ ولحظةِ خادمٍ. */
  readBoard(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverOfferBoard, DriverOfferStoreError>>;

  /**
   * `LOAD-01 Recovery` — إيصالاتُ لوحِ العروضِ: العميلُ يُقرُّ بأنَّه طبّقَ لقطةً
   * فيها هذهِ العروضُ، فيُثبَتُ وصولُها منَ الجهةِ التي يملكُ الحكمَ (الخادمُ)
   * لا منَ ادعاءِ إرسالٍ. **يكتبُ إيصالًا لا يغيّرُ عرضًا**: `on conflict do
   * nothing` — إيصالٌ مرتانِ إيصالٌ واحدٌ، ولا يُمسُّ حالةُ العرضِ هنا.
   */
  recordBoardReceipts(input: {
    readonly telegramUserId: string;
    readonly offerIds: readonly string[];
  }): Promise<Result<{ readonly recorded: number }, DriverOfferStoreError>>;

  /** **يقرأُ ولا يكتبُ**: تفاصيلُ `SD-04` لعرضٍ يملكُه هذا السائقُ وحدَه. */
  readDetail(input: {
    readonly telegramUserId: string;
    readonly offerId: string;
  }): Promise<Result<DriverOfferDetail, DriverOfferStoreError>>;

  /**
   * **يكتبُ — بالتفويضِ لا بالنسخِ**: يُنادي `claim_ride` القائمةَ، فالقفلُ
   * وإلغاءُ المنافسِ وسجلُّ التدقيقِ كلُّها فعلُها هيَ.
   */
  accept(input: {
    readonly telegramUserId: string;
    readonly offerId: string;
  }): Promise<Result<DriverOfferClaim, DriverOfferStoreError>>;

  /**
   * LOAD-01 (الدفعةُ الخامسةَ عشرةَ) — القبولُ **نفسُه** (`driver_accept_offer` بلا تغيير) مع إيداعِ
   * إشعارِ MATCHED في معاملتِه، في رحلةِ ذهابٍ وإيابٍ واحدة. `matchedNotice` غائبٌ حينَ لا إيداعَ
   * (رفضٌ، أو حجزٌ بانتظارِ الراكب — `WR-09` يودِعُ إشعارَ المرشَّح بنفسِه). اختياريٌّ: غيابُه =
   * المسارُ القديمُ (قبولٌ ثمّ إيداعٌ مستقلّ).
   */
  acceptWithMatchedNotice?(input: {
    readonly telegramUserId: string;
    readonly offerId: string;
  }): Promise<
    Result<
      { readonly claim: DriverOfferClaim; readonly matchedNotice?: RiderTripDepositOutcome },
      DriverOfferStoreError
    >
  >;
}
