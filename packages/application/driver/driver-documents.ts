/**
 * الغرض: حالاتُ استخدامِ وثائقِ السائقِ — «اطلبْ خانةَ رفعٍ» و«سجِّلْ وثيقةً»
 *   و«أرسِلْ للمراجعةِ» و«لوحُ حالاتي» (`F3-01` · `SD-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-documents.ts`
 * يُتوقع أن يستخدمه لاحقاً: `F12-14` — لا سطرَ ههنا يقرِّرُ الحجبَ، والقرارُ
 *   في القاعدةِ؛ وهذه الطبقةُ **تنقلُه** إلى الشاشةِ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ التوقيعُ **بعدَ** حكمِ القاعدةِ لا قبلَه
 *
 * الترتيبُ حكمٌ لا تفصيلٌ: لو وُقِّعَ الرابطُ أوّلاً ثمَّ سُئِلَت القاعدةُ،
 * لصارَ لكلِّ محاولةٍ مرفوضةٍ **إذنُ كتابةٍ صالحٌ** في يدِ طالبِها — محجوبٌ
 * ومحظورٌ ومن ليسَ سائقاً. فالقاعدةُ تُقرِّرُ أوّلاً وتُسمّي المسارَ، ثمَّ
 * يُوقَّعُ ما سمَّته وحدَه.
 *
 * ## ولِمَ نوعُ المحتوى والحجمُ يُفحَصانِ في القاعدةِ لا ههنا
 *
 * لأنَّهما **إعدادُ مدينةٍ** (`driver_document_max_bytes` ·
 * `driver_document_allowed_content_types`)، ونسخُهما ثابتَينِ في هذه الطبقةِ
 * مصدرُ حقيقةٍ ثانٍ يتخلّفُ عن اللوحةِ. وما يُفحَصُ ههنا **شكلٌ لا سياسةٌ**:
 * نوعٌ ليسَ نصّاً، وحجمٌ ليسَ رقماً صحيحاً — عطبُ صياغةٍ لا يُنفَقُ له ذَهابٌ.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا ترفعُ بايتاً**: `POST …/upload-url` يُعطي خانةً، والرفعُ من
 *      الهاتفِ إلى المخزنِ مباشرةً (نصُّ القسم 10.1).
 *   ــ **لا تقبلُ وثيقةً ولا ترفضُها**: لا مسارَ قبولٍ في هذه الطبقةِ أصلاً.
 *   ــ **لا تُنبِّهُ قبلَ الانتهاءِ**: `expires_soon` **يُعادُ للشاشةِ** لتعرضَه؛
 *      وإشعارٌ يُرسَلُ قبلَ ثلاثينَ يوماً **دَينٌ مُعلَنٌ** لا مُنفَّذٌ.
 *   ــ **لا تحسبُ يوماً من ساعةِ العمليّةِ**: الأيّامُ الباقيةُ من القاعدةِ.
 */

import {
  DRIVER_DOCUMENT_CONTENT_TYPES,
  DRIVER_DOCUMENT_HARD_MAX_BYTES,
  verifyDriverDocumentContent,
} from "../../domain/driver/driver-document-content.ts";
import {
  type DriverDocumentDashboard,
  type DriverDocumentType,
  type DriverDocumentUploadSlot,
  isDriverDocumentType,
  MAX_UPLOAD_TTL_SECONDS,
  MIN_UPLOAD_TTL_SECONDS,
  parsePlainDay,
} from "../../domain/driver/driver-documents.ts";
import type { ReadUrlSigner } from "../../infrastructure/storage/signed-read.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  type DriverDocumentStore,
  type DriverDocumentStoreError,
  isDriverDocumentRejection,
  type ObjectContentInspector,
  type ObjectExistenceChecker,
  type RecordedDriverDocument,
  type SubmittedForReview,
  type UploadSigner,
} from "./ports.ts";

/**
 * رموزُ العطبِ المنشورةُ — **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادٌ وحدَه،
 * كي يُلزِمَ الحاجزُ أنَّ لكلِّ رمزٍ نصّاً في القواميسِ الثلاثةِ (القاعدة 0.6).
 */
export const DRIVER_DOCUMENT_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "DOCUMENT_STORE_NOT_AVAILABLE",
  "UPLOAD_NOT_AVAILABLE",
  "DOC_TYPE_UNKNOWN",
  "CONTENT_TYPE_INVALID",
  "CONTENT_TYPE_NOT_ALLOWED",
  "SIZE_INVALID",
  "FILE_TOO_LARGE",
  "OBJECT_PATH_NOT_MINE",
  "OBJECT_NOT_FOUND",
  "FILE_CONTENT_INVALID",
  "OBJECT_NOT_SUBMITTED",
  "EXPIRY_REQUIRED",
  "EXPIRY_INVALID",
  "EXPIRY_IN_PAST",
  "EXPIRY_TOO_FAR",
  "DOCUMENTS_INCOMPLETE",
  "ACCOUNT_BLOCKED",
  "NOT_A_DRIVER",
  "CITY_NOT_READY",
] as const;

export type DriverDocumentPublicErrorCode = (typeof DRIVER_DOCUMENT_PUBLIC_ERROR_CODES)[number];

export interface DriverDocumentDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DriverDocumentStore;
  /** غيابُه يُعطّلُ مسارَ الخانةِ وحدَه بـ`503` ولا يُعطّلُ اللوحَ. */
  readonly signer?: UploadSigner;
  /**
   * فاحصُ وجودِ الكائنِ في المخزنِ (`DEC-30` · `ADR 0227`) — اختياريٌّ: غيابُهُ يُبقي
   * السلوكَ كالسابقِ (يُسجَّلُ ما قالَه العميلُ). وحضورُهُ يَرفُضُ التسجيلَ إن لم
   * يُوجَدْ الكائنُ فعلاً.
   */
  readonly existenceChecker?: ObjectExistenceChecker;
  /**
   * `WR-21` (ADR 0282): قارئُ بايتاتِ الكائن. حضورُه يجعلُ التسجيلَ مشروطًا بنوعٍ مسموحٍ من الرأس،
   * ونهايةٍ سليمةٍ من الذيل، وحجمٍ من المخزنِ تحتَ السقف — لا بما أعلنَه العميل.
   */
  readonly contentInspector?: ObjectContentInspector;
  /**
   * مُوقِّعُ روابطِ القراءةِ (`DEC-31`) — اختياريٌّ: غيابُهُ يُعطِّلُ مسارَ قراءةِ
   * الوثيقةِ بـ`503` ولا يُعطِّلُ اللوحَ.
   */
  readonly readSigner?: ReadUrlSigner;
  readonly now: () => Date;
}

/** رفضٌ يحملُ ما يجعلُه قابلاً للعرضِ: أنواعٌ · حدٌّ · **أسماءُ الناقصِ**. */
export interface DriverDocumentRejection {
  readonly code: DriverDocumentPublicErrorCode;
  readonly allowedContentTypes: readonly string[];
  readonly maxBytes: number | null;
  readonly missing: readonly DriverDocumentType[];
}

function rejection(
  code: DriverDocumentPublicErrorCode,
  extra?: {
    readonly allowedContentTypes?: readonly string[];
    readonly maxBytes?: number | null;
    readonly missing?: readonly DriverDocumentType[];
  },
): DriverDocumentRejection {
  return {
    code,
    allowedContentTypes: extra?.allowedContentTypes ?? [],
    maxBytes: extra?.maxBytes ?? null,
    missing: extra?.missing ?? [],
  };
}

function sessionErrorFrom(reason: string): DriverDocumentPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function openSession(
  deps: DriverDocumentDeps,
  accessToken: string | undefined,
): Promise<Result<string, DriverDocumentRejection>> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/**
 * تحويلُ رفضِ المخزنِ إلى رمزٍ منشورٍ — **شاملٌ حرفاً** لاتّحادِ الرفضِ، فرمزٌ
 * جديدٌ في القاعدةِ يُسقِطُ البناءَ (`switch` مُستنفَدٌ) ولا يمرُّ خاماً لشاشةٍ.
 */
function publicCodeFrom(error: DriverDocumentStoreError): DriverDocumentRejection {
  if (!isDriverDocumentRejection(error)) return rejection("DOCUMENT_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    // حسابٌ لا صفَّ له في القاعدةِ ليسَ جلسةً فاسدةً (القسم 9.8).
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return rejection("NOT_A_DRIVER");
    case "USER_BLOCKED":
      return rejection("ACCOUNT_BLOCKED");
    // إعدادُ مدينةٍ ناقصٌ **ليسَ خطأَ المستخدمِ**: مدينةٌ غيرُ جاهزةٍ.
    case "UPLOAD_POLICY_MISSING":
      return rejection("CITY_NOT_READY");
    case "CONTENT_TYPE_NOT_ALLOWED":
      return rejection("CONTENT_TYPE_NOT_ALLOWED", {
        allowedContentTypes: error.allowedContentTypes,
      });
    case "SIZE_NOT_POSITIVE":
      return rejection("SIZE_INVALID");
    case "FILE_TOO_LARGE":
      return rejection("FILE_TOO_LARGE", { maxBytes: error.maxBytes });
    case "OBJECT_PATH_NOT_MINE":
      return rejection("OBJECT_PATH_NOT_MINE");
    case "EXPIRY_REQUIRED":
      return rejection("EXPIRY_REQUIRED");
    case "EXPIRY_IN_PAST":
      return rejection("EXPIRY_IN_PAST");
    case "EXPIRY_TOO_FAR":
      return rejection("EXPIRY_TOO_FAR");
    case "DOCUMENTS_INCOMPLETE":
      return rejection("DOCUMENTS_INCOMPLETE", { missing: error.missing });
  }
}

function signerFailureCode(): DriverDocumentPublicErrorCode {
  // كلُّ عطبِ توقيعٍ **عطبُ خدمةٍ لا خطأُ مستخدمٍ**: رمزٌ واحدٌ يُقرأُ `503`،
  // وتفصيلُه يُكتَبُ في السجلِّ لا في الجوابِ (لا يُكشَفُ مزوِّدٌ ولا مفتاحٌ).
  return "UPLOAD_NOT_AVAILABLE";
}

export async function requestDriverDocumentUploadSlot(
  deps: DriverDocumentDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly docType: unknown;
    readonly contentType: unknown;
    readonly sizeBytes: unknown;
  },
): Promise<Result<DriverDocumentUploadSlot, DriverDocumentRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  if (!isDriverDocumentType(input.docType)) return err(rejection("DOC_TYPE_UNKNOWN"));

  if (typeof input.contentType !== "string" || input.contentType.trim().length === 0) {
    return err(rejection("CONTENT_TYPE_INVALID"));
  }
  const contentType = input.contentType.trim().toLowerCase();

  const size =
    typeof input.sizeBytes === "number"
      ? input.sizeBytes
      : typeof input.sizeBytes === "string" && input.sizeBytes.length > 0
        ? Number(input.sizeBytes)
        : Number.NaN;
  if (!Number.isInteger(size) || size <= 0) return err(rejection("SIZE_INVALID"));

  if (deps.signer === undefined) return err(rejection("UPLOAD_NOT_AVAILABLE"));

  const granted = await deps.store.requestSlot({
    telegramUserId: session.value,
    docType: input.docType,
    contentType,
    sizeBytes: size,
  });
  if (!granted.ok) return err(publicCodeFrom(granted.error));

  // العمرُ يُقصَرُ على المجالِ المسموحِ ولا يُصدَّقُ إعداداً على عواهنِه: إعدادٌ
  // يقولُ يوماً كامِلاً يجعلُ إذنَ الكتابةِ يعيشُ يوماً — والقصرُ ههنا **حاجزٌ
  // ثانٍ** لا مصدرُ حقيقةٍ ثانٍ، فهو حدٌّ لا قيمةٌ.
  const ttl = Math.min(
    MAX_UPLOAD_TTL_SECONDS,
    Math.max(MIN_UPLOAD_TTL_SECONDS, granted.value.ttlSeconds),
  );

  const signed = await deps.signer.signUpload({
    objectPath: granted.value.objectPath,
    contentType: granted.value.contentType,
    ttlSeconds: ttl,
  });
  if (!signed.ok) return err(rejection(signerFailureCode()));

  return ok({
    docType: granted.value.docType,
    objectPath: granted.value.objectPath,
    uploadUrl: signed.value.uploadUrl,
    uploadToken: signed.value.uploadToken,
    maxBytes: granted.value.maxBytes,
    expiresAtEpochMs: signed.value.expiresAtEpochMs,
  });
}

export async function recordDriverDocument(
  deps: DriverDocumentDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly docType: unknown;
    readonly objectPath: unknown;
    readonly expiresAt: unknown;
  },
): Promise<Result<RecordedDriverDocument, DriverDocumentRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  if (!isDriverDocumentType(input.docType)) return err(rejection("DOC_TYPE_UNKNOWN"));

  if (typeof input.objectPath !== "string" || input.objectPath.trim().length === 0) {
    // مسارٌ فارغٌ **ليسَ مساراً لغيرِكَ**: يُردُّ رمزَ المِلكيّةِ نفسَه كي لا
    // يُميِّزَ المُهاجِمُ بينَ «صيغةٌ خطأٌ» و«ليسَ مسارَكَ» فيَستدلَّ به.
    return err(rejection("OBJECT_PATH_NOT_MINE"));
  }

  if (input.expiresAt === undefined || input.expiresAt === null || input.expiresAt === "") {
    return err(rejection("EXPIRY_REQUIRED"));
  }
  const expiresAt = parsePlainDay(input.expiresAt);
  if (expiresAt === null) return err(rejection("EXPIRY_INVALID"));

  // `DEC-30` — مطابقةُ وجودِ الكائنِ فعلاً في المخزنِ قبلَ تسجيلِه. اختياريٌّ:
  // غيابُ الفاحصِ يُبقي السلوكَ كالسابقِ (تسجيلٌ بلا تحقُّقٍ).
  if (deps.existenceChecker !== undefined) {
    const exists = await deps.existenceChecker.checkExists({ objectPath: input.objectPath.trim() });
    if (!exists.ok) return err(rejection("OBJECT_PATH_NOT_MINE"));
    if (!exists.value) return err(rejection("OBJECT_NOT_FOUND"));
  }

  // `WR-21` (ADR 0282): البايتاتُ الفعليّةُ هي الحكم. تعذُّرُ القراءةِ رفضٌ لا قبول.
  if (deps.contentInspector !== undefined) {
    const sample = await deps.contentInspector.inspect({ objectPath: input.objectPath.trim() });
    if (!sample.ok) {
      return err(
        rejection(
          sample.error === "OBJECT_NOT_FOUND" ? "OBJECT_NOT_FOUND" : "UPLOAD_NOT_AVAILABLE",
        ),
      );
    }
    const verdict = verifyDriverDocumentContent(sample.value);
    if (!verdict.ok) {
      return err(
        rejection(verdict.reason, {
          allowedContentTypes:
            verdict.reason === "CONTENT_TYPE_NOT_ALLOWED" ? DRIVER_DOCUMENT_CONTENT_TYPES : [],
          maxBytes: verdict.reason === "FILE_TOO_LARGE" ? DRIVER_DOCUMENT_HARD_MAX_BYTES : null,
        }),
      );
    }
  }

  const written = await deps.store.record({
    telegramUserId: session.value,
    docType: input.docType,
    objectPath: input.objectPath.trim(),
    expiresAt,
  });
  if (!written.ok) return err(publicCodeFrom(written.error));
  return ok(written.value);
}

export async function submitDriverDocumentsForReview(
  deps: DriverDocumentDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<SubmittedForReview, DriverDocumentRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const submitted = await deps.store.submitForReview({ telegramUserId: session.value });
  if (!submitted.ok) return err(publicCodeFrom(submitted.error));
  return ok(submitted.value);
}

export async function readDriverDocumentDashboard(
  deps: DriverDocumentDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<DriverDocumentDashboard, DriverDocumentRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.store.readDashboard({ telegramUserId: session.value });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

/** رابطُ قراءةٍ موقَّعٌ لوثيقةٍ مرفوعةٍ (`DEC-31`). */
export interface DriverDocumentReadUrl {
  readonly docType: DriverDocumentType;
  readonly readUrl: string;
  readonly expiresAtEpochMs: number;
}

export async function readDriverDocumentUrl(
  deps: DriverDocumentDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly docType: unknown;
  },
): Promise<Result<DriverDocumentReadUrl, DriverDocumentRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  if (!isDriverDocumentType(input.docType)) return err(rejection("DOC_TYPE_UNKNOWN"));

  if (deps.readSigner === undefined) {
    return err(rejection("UPLOAD_NOT_AVAILABLE"));
  }

  const objectPathResult = await deps.store.readObjectPath({
    telegramUserId: session.value,
    docType: input.docType,
  });
  if (!objectPathResult.ok) return err(publicCodeFrom(objectPathResult.error));

  const objectPath = objectPathResult.value;
  if (objectPath === null) return err(rejection("OBJECT_NOT_SUBMITTED"));

  const signed = await deps.readSigner.signRead({ objectPath, ttlSeconds: 300 });
  if (!signed.ok) return err(rejection("UPLOAD_NOT_AVAILABLE"));

  return ok({
    docType: input.docType,
    readUrl: signed.value.readUrl,
    expiresAtEpochMs: signed.value.expiresAtEpochMs,
  });
}
