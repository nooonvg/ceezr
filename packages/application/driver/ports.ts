/**
 * الغرض: منافذُ وثائقِ السائقِ — عقدُ ما تحتاجُه حالاتُ الاستخدامِ من **مخزنِ
 *   قاعدةٍ** ومن **مُوقِّعِ رفعٍ**، بلا ذكرِ SQL ولا HTTP (`F3-01`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `packages/application/driver/driver-documents.ts` ·
 *   `packages/infrastructure/driver/driver-documents-store.ts` ·
 *   `packages/infrastructure/storage/signed-upload.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — شعارُ المركبةِ وباركودُها يُرفَعانِ
 *   بالمُوقِّعِ نفسِه بدلوٍ آخرَ، ولا مُوقِّعٌ ثانٍ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ مُوقِّعٌ **منفذٌ** لا نداءُ مزوِّدٍ في حالةِ الاستخدامِ
 *
 * الهدفُ المُوثَّقُ **استقلالُ المشروعِ** (`ADR 0094`): مزوِّدُ التخزينِ
 * يُبدَّلُ يومَ تُبدَّلُ الاستضافةُ، ونداءٌ مكتوبٌ في حالةِ الاستخدامِ يجعلُ
 * التبديلَ تعديلَ منطقِ عملٍ. **والمنفذُ يجعلُه استبدالَ محوِّلٍ**.
 *
 * ## وما لا يقولُه هذا العقدُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقولُ اسمَ دلوٍ**: اسمُ الدلوِ تهيئةُ محوِّلٍ لا شأنُ حالةِ
 *      استخدامٍ. وحالةُ الاستخدامِ تُسلِّمُ **مساراً نطقَت بهِ القاعدةُ** فحسب.
 *   ــ **لا يعرفُ بايتاً**: لا رفعَ ههنا ولا قراءةَ مِلفٍّ — رابطٌ فحسب.
 *   ــ **لا يقبلُ وثيقةً**: القبولُ والرفضُ فعلُ إنسانٍ في اللوحةِ، ولا منفذَ
 *      له في هذا الملفِّ حتّى لا يُظَنَّ أنَّه مُنفَّذٌ.
 */

import type {
  DriverDocumentDashboard,
  DriverDocumentType,
} from "../../domain/driver/driver-documents.ts";
import type { Result } from "../../shared/result/index.ts";

/**
 * رفضٌ **مُصنَّفٌ** من القاعدةِ — مجالٌ مغلقٌ يُقابِلُ رموزَ
 * `driver_document_upload_slot` و`record_driver_document` و
 * `submit_driver_documents_for_review` و`driver_document_dashboard` حرفاً.
 */
export type DriverDocumentStoreRejection =
  | "USER_NOT_FOUND"
  | "USER_BLOCKED"
  | "NOT_A_DRIVER"
  | "UPLOAD_POLICY_MISSING"
  | "CONTENT_TYPE_NOT_ALLOWED"
  | "SIZE_NOT_POSITIVE"
  | "FILE_TOO_LARGE"
  | "OBJECT_PATH_NOT_MINE"
  | "EXPIRY_REQUIRED"
  | "EXPIRY_IN_PAST"
  | "EXPIRY_TOO_FAR"
  | "DOCUMENTS_INCOMPLETE";

/** عطبُ مخزنٍ أو حمولةٌ لا تُفهَمُ — يُنشَرُ `503`، ولا يُخلَطُ برفضٍ مُصنَّفٍ. */
export interface DriverDocumentStoreFailure {
  readonly reason: "STORE_ERROR" | "MALFORMED_RESULT";
}

/**
 * رفضٌ ومعَه ما يجعلُه مفهوماً: أنواعٌ مسموحةٌ، أو حدُّ حجمٍ، أو **أسماءُ
 * الوثائقِ الناقصةِ** — و`SD-02` ينصُّ «ناقص (بتحديد الناقص)» فالتسميةُ
 * جزءٌ من الرفضِ لا زينةٌ عليه.
 */
export interface DriverDocumentRejectionDetail {
  readonly rejection: DriverDocumentStoreRejection;
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number | null;
  readonly missing: readonly DriverDocumentType[];
}

export type DriverDocumentStoreError = DriverDocumentStoreFailure | DriverDocumentRejectionDetail;

export function isDriverDocumentRejection(
  error: DriverDocumentStoreError,
): error is DriverDocumentRejectionDetail {
  return "rejection" in error;
}

/** خانةٌ نطقَت بها القاعدةُ **قبلَ** التوقيعِ: مسارٌ وحدٌّ وعمرٌ. */
export interface DriverDocumentSlotGrant {
  readonly driverId: string;
  readonly docType: DriverDocumentType;
  readonly objectPath: string;
  readonly contentType: string;
  readonly maxBytes: number;
  readonly ttlSeconds: number;
}

/** أثرُ تسجيلِ وثيقةٍ — ومعَه هل أُحِلَّت محلَّ سابقةٍ. */
export interface RecordedDriverDocument {
  readonly documentId: string;
  readonly docType: DriverDocumentType;
  readonly status: "received";
  readonly expiresAt: string;
  readonly replaced: boolean;
}

/** أثرُ الإرسالِ للمراجعةِ — عددُ ما تحرَّكَ وأسبابُ الحجبِ بعدَه. */
export interface SubmittedForReview {
  readonly submitted: number;
  readonly stillBlocked: boolean;
}

export interface DriverDocumentStore {
  /** **يقرأُ ولا يكتبُ**: خانةٌ لم يُوقَّعْ رابطُها بعدُ. */
  requestSlot(input: {
    readonly telegramUserId: string;
    readonly docType: DriverDocumentType;
    readonly contentType: string;
    readonly sizeBytes: number;
  }): Promise<Result<DriverDocumentSlotGrant, DriverDocumentStoreError>>;

  /** **يكتبُ**: صفُّ وثيقةٍ وسجلُّ تدقيقٍ في معاملةِ القاعدةِ نفسِها. */
  record(input: {
    readonly telegramUserId: string;
    readonly docType: DriverDocumentType;
    readonly objectPath: string;
    readonly expiresAt: string;
  }): Promise<Result<RecordedDriverDocument, DriverDocumentStoreError>>;

  /** **يكتبُ**: نقلُ ما لم يُقبَلْ إلى «قيدَ المراجعةِ». */
  submitForReview(input: {
    readonly telegramUserId: string;
  }): Promise<Result<SubmittedForReview, DriverDocumentStoreError>>;

  /** **يقرأُ ولا يكتبُ** — لوحُ `SD-02` وأسبابُ الحجبِ معَه. */
  readDashboard(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverDocumentDashboard, DriverDocumentStoreError>>;

  /** **يقرأُ ولا يكتبُ** — مسارُ كائنِ وثيقةٍ مرفوعةٍ (`DEC-31`). */
  readObjectPath(input: {
    readonly telegramUserId: string;
    readonly docType: DriverDocumentType;
  }): Promise<Result<string | null, DriverDocumentStoreError>>;
}

/** عطبُ توقيعٍ — **مجالٌ مغلقٌ**، ولا يُخلَطُ برفضِ القاعدةِ. */
export type UploadSignerFailure =
  /** المُوقِّعُ غيرُ مُهيَّأٍ (لا مفتاحَ ولا عنوانَ) — `503` لا `500`. */
  | "SIGNER_NOT_CONFIGURED"
  /** المزوِّعُ ردَّ عطباً أو تعذَّرَ الوصولُ إليه. */
  | "SIGNER_UNAVAILABLE"
  /** ردَّ جواباً لا يحملُ رابطاً — يُقرأُ عطباً ولا يُعادُ نصفَ خانةٍ. */
  | "SIGNER_MALFORMED_RESPONSE"
  /** عمرٌ خارجَ المجالِ المسموحِ — يُردُّ ههنا ولا يُرسَلُ للمزوِّدِ. */
  | "SIGNER_TTL_OUT_OF_RANGE";

export interface SignedUpload {
  readonly uploadUrl: string;
  readonly uploadToken: string | null;
  readonly expiresAtEpochMs: number;
}

export interface UploadSigner {
  /**
   * **لا يرفعُ ولا يقرأُ**: يُوقِّعُ إذنَ كتابةٍ لمسارٍ بعينِه ولمدّةٍ بعينِها.
   * والمسارُ يأتي من القاعدةِ لا من العميلِ.
   */
  signUpload(input: {
    readonly objectPath: string;
    readonly contentType: string;
    readonly ttlSeconds: number;
  }): Promise<Result<SignedUpload, UploadSignerFailure>>;
}

/**
 * فاحصُ وجودِ الكائنِ في المخزنِ (`DEC-30` · `ADR 0227`) — يتحقَّقُ أنَّ الكائنَ
 * المُسجَّلَ في القاعدةِ موجودٌ فعلاً في المخزنِ. فشلُ الفحصِ لا يُسقِطُ الطلبَ —
 * يُعامَلُ كأنَّ الكائنَ ليسَ للسائقِ (أمانٌ لا عطلٌ).
 */
export type ObjectExistenceFailure = "CHECKER_UNAVAILABLE";

export type ObjectContentInspectionFailure = "INSPECTOR_UNAVAILABLE" | "OBJECT_NOT_FOUND";

/**
 * `WR-21` (ADR 0282): قارئُ عيّنةٍ من الكائنِ المرفوع — حجمُه من المخزنِ ورأسُه وذيلُه — كي يحكمَ
 * الخادمُ على البايتاتِ لا على النوعِ المُعلَن.
 */
export interface ObjectContentInspector {
  inspect(input: {
    readonly objectPath: string;
  }): Promise<
    Result<
      { readonly sizeBytes: number; readonly head: Uint8Array; readonly tail: Uint8Array },
      ObjectContentInspectionFailure
    >
  >;
}

export interface ObjectExistenceChecker {
  checkExists(input: {
    readonly objectPath: string;
  }): Promise<Result<boolean, ObjectExistenceFailure>>;
}
