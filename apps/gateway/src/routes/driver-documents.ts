/**
 * الغرض: مساراتُ وثائقِ السائقِ — `POST /v1/driver/documents/upload-url` و
 *   `POST /v1/driver/documents` و`POST /v1/driver/documents/submit` و
 *   `GET /v1/driver/documents` (`F3-01` · `SD-01` · `SD-02`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` — وثائقُ المركبةِ أنواعٌ في المسارِ نفسِه
 *   لا مساراتٌ جديدةٌ.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ خانةُ الرفعِ `POST` ولا `GET` وإن كانت «قراءةً»
 *
 * لأنَّها **ليسَت قراءةً**: كلُّ نداءٍ يُولِّدُ مساراً جديداً بقُرعةٍ ويمنحُ
 * إذنَ كتابةٍ. و`GET` يُخزَّنُ في الوسائطِ ويُعادُ من الذاكرةِ، فإذنُ كتابةٍ
 * مُخزَّنٌ في وسيطٍ **مفتاحٌ يُعادُ لمن لا يملكُه**.
 *
 * ## ولِمَ `202` للإرسالِ للمراجعةِ ولا `200`
 *
 * الإرسالُ **يبدأُ عملاً بشريّاً** لا يُنجَزُ في الطلبِ: مراجعٌ يقرأُ ويقبلُ.
 * و`200` يقولُ «تمَّ»، والسائقُ يقرؤها «وُثِّقتُ» فينتظرُ عروضاً محجوبةً.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ معرّفَ سائقٍ من الطلبِ**: من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تستقبلُ بايتاً**: لا `multipart` ولا جسمَ مِلفٍّ — رفعٌ مباشرٌ.
 *   ــ **لا تُعيدُ رابطَ قراءةٍ للوثيقةِ**: عرضُ المرفوعِ للسائقِ **دَينٌ
 *      مُعلَنٌ**؛ واللوحُ يقولُ الحالةَ والتاريخَ لا الصورةَ.
 *   ــ **لا تقبلُ وثيقةً ولا ترفضُها**: لوحةُ المراجعةِ بندٌ آخرُ.
 *   ــ **لا تُسجِّلُ مساراً ولا رمزاً في السجلِّ**: إذنُ كتابةٍ في سجلٍّ
 *      مفتاحٌ منسوخٌ — يُسجَّلُ النوعُ والحكمُ فحسب.
 */

import { type Context, Hono } from "hono";
import {
  type DriverDocumentDeps,
  type DriverDocumentPublicErrorCode,
  type DriverDocumentReadUrl,
  type DriverDocumentRejection,
  readDriverDocumentDashboard,
  readDriverDocumentUrl,
  recordDriverDocument,
  requestDriverDocumentUploadSlot,
  submitDriverDocumentsForReview,
} from "../../../../packages/application/driver/driver-documents.ts";

export interface DriverDocumentRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly documents?: DriverDocumentDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<DriverDocumentPublicErrorCode, 401 | 403 | 404 | 409 | 413 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  DOCUMENT_STORE_NOT_AVAILABLE: 503,
  // مُوقِّعٌ غيرُ مُهيَّأٍ أو مزوِّدٌ ساقطٌ: **عطبُ خدمتِنا** لا خطأُ السائقِ.
  UPLOAD_NOT_AVAILABLE: 503,
  // طلبٌ مفهومٌ وقيمتُه خارجَ المجالِ — لا عطبُ صياغةٍ ولا منعُ صلاحيةٍ.
  DOC_TYPE_UNKNOWN: 422,
  CONTENT_TYPE_INVALID: 422,
  CONTENT_TYPE_NOT_ALLOWED: 422,
  SIZE_INVALID: 422,
  EXPIRY_REQUIRED: 422,
  EXPIRY_INVALID: 422,
  EXPIRY_IN_PAST: 422,
  EXPIRY_TOO_FAR: 422,
  // **حجمٌ فوقَ الحدِّ رمزُه القياسيُّ `413`**: العميلُ يعرفُه فيقيسُ قبلَ
  // الرفعِ، ولا يُخبِّئُ الحدَّ في `422` عامٍّ.
  FILE_TOO_LARGE: 413,
  // مسارُ غيرِكَ: **منعُ صلاحيةٍ**، ولا يُفرَّقُ بينَ «لا وجودَ له» و«لغيرِكَ».
  OBJECT_PATH_NOT_MINE: 403,
  OBJECT_NOT_FOUND: 422,
  // `WR-21`: ملفٌّ بنوعٍ مسموحٍ في رأسِه ونهايتُه تالفةٌ أو مقطوعة.
  FILE_CONTENT_INVALID: 422,
  OBJECT_NOT_SUBMITTED: 404,
  ACCOUNT_BLOCKED: 403,
  NOT_A_DRIVER: 403,
  // نقصٌ في الوثائقِ **تعارضٌ مع حالةِ المَورِدِ** لا قيمةٌ خطأٌ في الطلبِ:
  // الطلبُ صحيحٌ تماماً، والحالةُ لا تسمحُ به بعدُ.
  DOCUMENTS_INCOMPLETE: 409,
  // مدينةٌ بلا إعدادِ وثائقَ: تهيئةٌ ناقصةٌ عندَنا لا خطأُ المستخدمِ.
  CITY_NOT_READY: 503,
};

function rejected(c: Context, rejection: DriverDocumentRejection) {
  const status = STATUS_BY_ERROR[rejection.code];
  const body: Record<string, unknown> = { ok: false, error: rejection.code };
  // التفصيلُ **يُعادُ حينَ يُفيدُ فعلاً**: أنواعٌ مسموحةٌ وحدٌّ وأسماءُ ناقصٍ —
  // كي تبنيَ الشاشةُ جملةً بلغتِها ولا تعرضَ رمزاً خاماً.
  if (rejection.allowedContentTypes.length > 0) {
    body.allowed_content_types = rejection.allowedContentTypes;
  }
  if (rejection.maxBytes !== null) body.max_bytes = rejection.maxBytes;
  if (rejection.missing.length > 0) body.missing = rejection.missing;
  return c.json(body, status);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** حدُّ سلامةٍ لجسمِ الطلبِ — لا مِلفَّ ههنا، فحقولٌ قصيرةٌ تكفي. */
const MAX_BODY_BYTES = 2048;

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  const raw = await c.req.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function unavailable(code: DriverDocumentPublicErrorCode): DriverDocumentRejection {
  return { code, allowedContentTypes: [], maxBytes: null, missing: [] };
}

export function createDriverDocumentRoutes(deps: DriverDocumentRouteDependencies): Hono {
  const app = new Hono();

  /** «ارفعْ وثيقةً» — خانةٌ موقَّعةٌ، والبايتُ يذهبُ للمخزنِ لا إلينا. */
  app.post("/v1/driver/documents/upload-url", async (c) => {
    if (deps.documents === undefined) {
      deps.log?.("driver_documents.upload_url_disabled", {});
      return rejected(c, unavailable("DOCUMENT_STORE_NOT_AVAILABLE"));
    }

    const body = await readJsonBody(c);
    const result = await requestDriverDocumentUploadSlot(deps.documents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      docType: body?.doc_type,
      contentType: body?.content_type,
      sizeBytes: body?.size_bytes,
    });
    if (!result.ok) {
      deps.log?.("driver_documents.upload_url_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    const slot = result.value;
    // **لا مسارَ ولا رمزَ في السجلِّ** — النوعُ وحدَه.
    deps.log?.("driver_documents.upload_url_signed", { doc_type: slot.docType });
    return c.json({
      ok: true,
      doc_type: slot.docType,
      object_path: slot.objectPath,
      upload_url: slot.uploadUrl,
      upload_token: slot.uploadToken,
      max_bytes: slot.maxBytes,
      expires_at: new Date(slot.expiresAtEpochMs).toISOString(),
    });
  });

  /** «سجِّلْ ما رفعتُه» — بعدَ الرفعِ، ومعَه **تاريخُ الانتهاءِ إلزاماً**. */
  app.post("/v1/driver/documents", async (c) => {
    if (deps.documents === undefined) {
      deps.log?.("driver_documents.record_disabled", {});
      return rejected(c, unavailable("DOCUMENT_STORE_NOT_AVAILABLE"));
    }

    const body = await readJsonBody(c);
    const result = await recordDriverDocument(deps.documents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      docType: body?.doc_type,
      objectPath: body?.object_path,
      expiresAt: body?.expires_at,
    });
    if (!result.ok) {
      deps.log?.("driver_documents.record_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    const recorded = result.value;
    deps.log?.("driver_documents.recorded", {
      doc_type: recorded.docType,
      replaced: recorded.replaced,
    });
    // `201` لأنَّ صفَّ وثيقةٍ أُنشئَ (أو أُحِلَّ محلَّ سابقٍ فصارَ صفّاً جديداً
    // في معناه: حالةٌ جديدةٌ وتاريخٌ جديدٌ ومراجعةٌ من أوّلِها).
    return c.json(
      {
        ok: true,
        document_id: recorded.documentId,
        doc_type: recorded.docType,
        status: recorded.status,
        expires_at: recorded.expiresAt,
        replaced: recorded.replaced,
      },
      201,
    );
  });

  /** «أرسِلْ للمراجعةِ» — الفعلُ الأساسيُّ في `SD-01`. */
  app.post("/v1/driver/documents/submit", async (c) => {
    if (deps.documents === undefined) {
      deps.log?.("driver_documents.submit_disabled", {});
      return rejected(c, unavailable("DOCUMENT_STORE_NOT_AVAILABLE"));
    }

    const result = await submitDriverDocumentsForReview(deps.documents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) {
      deps.log?.("driver_documents.submit_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    const submitted = result.value;
    deps.log?.("driver_documents.submitted", { moved: submitted.submitted });
    return c.json(
      {
        ok: true,
        submitted: submitted.submitted,
        // **يُقالُ صريحاً إنَّ الحجبَ قائمٌ** حتّى تُقبَلَ الوثائقُ: وعدٌ بأنَّ
        // «الإرسالَ» يفتحُ العملَ كذبةٌ تُنتِجُ سائقاً ينتظرُ عرضاً محجوباً.
        still_blocked: submitted.stillBlocked,
      },
      202,
    );
  });

  /** «حالةُ وثائقي» — `SD-02` كامِلاً بحالةٍ وتاريخٍ وأيّامٍ باقيةٍ. */
  app.get("/v1/driver/documents", async (c) => {
    if (deps.documents === undefined) {
      deps.log?.("driver_documents.dashboard_disabled", {});
      return rejected(c, unavailable("DOCUMENT_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverDocumentDashboard(deps.documents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const board = result.value;
    return c.json({
      ok: true,
      verification_status: board.verificationStatus,
      warning_days: board.warningDays,
      documents: board.documents.map((row) => ({
        doc_type: row.docType,
        submitted: row.submitted,
        status: row.status,
        expires_at: row.expiresAt,
        days_left: row.daysLeft,
        expires_soon: row.expiresSoon,
        review_note: row.reviewNote,
        submitted_at: row.submittedAt,
        reviewed_at: row.reviewedAt,
      })),
      block_reasons: board.blockReasons.map((reason) => ({
        code: reason.code,
        doc_type: reason.docType,
      })),
      // **عددُ ما لم يُقرأْ يُعادُ** ولا يُطرَحُ: شاشةٌ حديثةٌ تعرضُ سطراً
      // عامّاً، وقديمةٌ لا تعرضُ شيئاً — و`is_blocked` يبقى صادقاً للاثنتَينِ.
      unreadable_block_reasons: board.unreadableBlockReasons,
      is_blocked: board.isBlocked,
    });
  });

  /** «أرِني صورةَ وثيقتي» — رابطُ قراءةٍ موقَّعٌ للوثيقةِ المرفوعةِ (`DEC-31`). */
  app.get("/v1/driver/documents/:docType/read-url", async (c) => {
    if (deps.documents === undefined) {
      deps.log?.("driver_documents.read_url_disabled", {});
      return rejected(c, unavailable("DOCUMENT_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverDocumentUrl(deps.documents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      docType: c.req.param("docType"),
    });
    if (!result.ok) {
      deps.log?.("driver_documents.read_url_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    const url: DriverDocumentReadUrl = result.value;
    deps.log?.("driver_documents.read_url_granted", { doc_type: url.docType });
    return c.json({
      ok: true,
      doc_type: url.docType,
      read_url: url.readUrl,
      expires_at_epoch_ms: url.expiresAtEpochMs,
    });
  });

  return app;
}
