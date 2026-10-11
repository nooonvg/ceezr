/**
 * الغرض: مُوقِّعُ روابطِ الرفعِ على مخزنِ كائناتٍ متوافقٍ مع واجهةِ Supabase
 *   Storage — إذنُ كتابةٍ **لمسارٍ واحدٍ ولمدّةٍ قصيرةٍ** (`F3-01` · القسم 10.1).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`، ومُقاسٌ على مشروعٍ حقيقيٍّ.
 * ينتمي إلى: infrastructure/storage
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-11` (صورُ المركبةِ) · `F4-xx` (مرفقاتُ
 *   الشكاوى) — بدلوٍ آخرَ وبالمُوقِّعِ نفسِه.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * ## لِمَ رابطٌ موقَّعٌ ولا رفعٌ عبرَ البوّابةِ
 *
 * صورةٌ بخمسةِ ميغابايتَ تعبرُ البوّابةَ تشغلُ ذاكرتَها ونطاقَها ووقتَها،
 * ومئةُ سائقٍ يرفعونَ معاً يُسقِطونَ خدمةَ الطلباتِ. **والرابطُ الموقَّعُ
 * يُخرِجُ البايتَ من مسارِ الطلبِ كلِّه**: الهاتفُ يرفعُ إلى المخزنِ، والبوّابةُ
 * لا ترى إلّا سطراً في القاعدةِ.
 *
 * ## ولِمَ **المفتاحُ السرِّيُّ لا يُشتَقُّ ولا يُدفَنُ في الشِفرةِ**
 *
 * التوقيعُ فعلٌ يحتاجُ مفتاحَ خدمةٍ؛ ومفتاحُ النشرِ العامُّ (`publishable`)
 * **لا يُوقِّعُ في دلوٍ خاصٍّ** — قِيسَ ذلكَ فعلاً فردَّ `403` بسياسةِ صفوفٍ
 * (`docs/evidence/storage/F3-01-SIGNED-UPLOAD-20260915.md`). فالمفتاحُ يُقرأُ
 * من البيئةِ، **وغيابُه يُعطِّلُ المسارَ بجوابٍ مُصنَّفٍ** ولا يُصمِتُ العطبَ
 * ولا يُحاوَلُ توقيعٌ بمفتاحٍ لا يملكُ الإذنَ فيُقرأَ `403` عطبَ مستخدمٍ.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يرفعُ بايتاً ولا يقرأُ مِلفّاً**: يُوقِّعُ إذناً فحسب.
 *   ــ **لا يُوقِّعُ روابطَ قراءةٍ**: عرضُ الوثيقةِ في لوحةِ المراجعةِ
 *      (`F4-xx`) يحتاجُ توقيعَ قراءةٍ، وهو **دَينٌ مُعلَنٌ** لا مُنفَّذٌ ههنا.
 *   ــ **لا يُقرِّرُ مساراً**: المسارُ من القاعدةِ، وههنا يُرمَّزُ للعنوانِ فحسب.
 *   ــ **لا يحذفُ كائناً**: كائنٌ مرفوعٌ لم يُسجَّلْ صفُّه يبقى — ونظافتُه
 *      عملٌ دوريٌّ مُعلَنٌ كدَينٍ، لا حذفٌ في مسارِ طلبٍ.
 *   ــ **لا يتحقَّقُ أنَّ الرفعَ حدثَ**: الدَّينُ المُعلَنُ مُنشَطٌ —
 *      `ObjectExistenceChecker` في `object-existence-checker.ts` يفحصُ الوجودَ
 *      عبرَ HEAD قبلَ التسجيلِ (DEC-30 · ADR 0227).
 */

import type {
  SignedUpload,
  UploadSigner,
  UploadSignerFailure,
} from "../../application/driver/ports.ts";
import {
  MAX_UPLOAD_TTL_SECONDS,
  MIN_UPLOAD_TTL_SECONDS,
} from "../../domain/driver/driver-documents.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { createGuardedFetch, type FetchLike } from "../../shared/wasla/egress-gate.ts";

export interface SignedUploadConfig {
  /** أصلُ المخزنِ — مثلَ `https://<ref>.supabase.co` بلا شرطةٍ أخيرةٍ. */
  readonly baseUrl: string;
  /** مفتاحُ خدمةٍ يملكُ الكتابةَ في الدلوِ. **لا يُسجَّلُ ولا يُعادُ أبداً.** */
  readonly secretKey: string;
  readonly bucket: string;
  /** ساعةٌ محقونةٌ — كي يُقاسَ الانتهاءُ في الاختبارِ بلا انتظارٍ. */
  readonly now?: () => Date;
  /**
   * جالبٌ محقونٌ — كي يُقاسَ العطبُ بلا شبكةٍ.
   *
   * وإن غابَ فالافتراضُ **ليسَ `fetch` عارياً** بل جالبٌ يمرُّ من بوّابةِ
   * الصادرِ باسمِ المقصدِ `supabase-object-storage`: مضيفُ المخزنِ يأتي من
   * البيئةِ، فلو نُودِيَ عارياً لَخرجَ من الجهازِ إلى أيِّ مضيفٍ يُوضَعُ في
   * المتغيّرِ بلا أن يُخفِقَ سطرٌ واحدٌ (الفحصُ ١٣ من حاجزِ حدِّ الصادرِ).
   */
  readonly fetch?: FetchLike;
  /** سقفُ زمنِ النداءِ بالمِلِّي — نداءٌ لا ينتهي يُجمِّدُ طلبَ سائقٍ. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** اسمُ دلوٍ أو مسارٍ لا يحملُ محرفاً يُغيِّرُ معنى العنوانِ. */
const SAFE_SEGMENT = /^[A-Za-z0-9._\-/]+$/;

function isSafeObjectPath(objectPath: string): boolean {
  if (objectPath.length === 0 || objectPath.length > 512) return false;
  if (!SAFE_SEGMENT.test(objectPath)) return false;
  // `..` تخرجُ من بادئةِ السائقِ فتكتبُ في مسارِ غيرِه؛ وشرطةٌ في الأوّلِ أو
  // شرطتانِ متتاليتانِ تُنتِجانِ مساراً غيرَ مُطابِقٍ لما فُحِصَت ملكيّتُه.
  if (objectPath.startsWith("/") || objectPath.includes("//")) return false;
  return !objectPath.split("/").includes("..");
}

function encodeObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * **مِفتاحُ إيقافِ الرفعِ حتّى تثبتَ النسخةُ** (`BACKUP-STORAGE-20261011.md`).
 * وثيقةُ السائقِ تُرفَعُ إلى المخزنِ لا إلى القاعدة، ونسخُ القاعدةِ لا يحملُ
 * بايتاتِها. فلا يُمنَحُ إذنُ رفعٍ إلّا إذا كتبَ المالكُ القيمةَ `enabled` حرفاً
 * بعدَ تمرينِ استعادةٍ ناجح — **وأيُّ قيمةٍ أخرى أو غيابُها إيقاف** (يفشلُ
 * مغلقاً: خطأٌ إملائيٌّ لا يفتحُ الرفعَ). والقراءةُ والحالاتُ لا تتأثّر.
 */
export function driverDocumentUploadsEnabled(env: Record<string, string | undefined>): boolean {
  return (env.DRIVER_DOCUMENT_UPLOADS ?? "").trim() === "enabled";
}

/**
 * المُوقِّعُ الذي يُركَّب: الحقيقيُّ حين تكتملُ التهيئةُ **ويُفتَحُ الرفع**، وإلّا
 * مُوقِّعٌ غيرُ مُهيَّأٍ يردُّ رفضاً مُصنَّفاً (`UPLOAD_NOT_AVAILABLE` للسائق).
 */
export function selectUploadSigner(
  env: Record<string, string | undefined>,
  config: SignedUploadConfig | null,
): { readonly signer: UploadSigner; readonly state: "active" | "paused" | "not_configured" } {
  if (config === null) return { signer: new UnconfiguredUploadSigner(), state: "not_configured" };
  if (!driverDocumentUploadsEnabled(env)) {
    return { signer: new UnconfiguredUploadSigner(), state: "paused" };
  }
  return { signer: new HttpUploadSigner(config), state: "active" };
}

/**
 * قراءةُ التهيئةِ من البيئةِ. **غيابُ المفتاحِ ليسَ عطباً يُرمى**: يُعادُ
 * `null` فيُبنى مُوقِّعٌ يردُّ `SIGNER_NOT_CONFIGURED`، وتبقى بقيّةُ الخدمةِ
 * تعملُ — لوحُ الحالاتِ يُقرأُ وإن تعذَّرَ الرفعُ.
 */
export function readSignedUploadConfig(
  env: Record<string, string | undefined>,
): SignedUploadConfig | null {
  const baseUrl = (env.OBJECT_STORAGE_URL ?? env.SUPABASE_URL ?? "").trim();
  const secretKey = (
    env.OBJECT_STORAGE_SECRET_KEY ??
    env.SUPABASE_STORAGE_SECRET_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  ).trim();
  const bucket = (env.DRIVER_DOCUMENTS_BUCKET ?? "driver-documents").trim();
  if (baseUrl.length === 0 || secretKey.length === 0 || bucket.length === 0) return null;
  if (!SAFE_SEGMENT.test(bucket)) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), secretKey, bucket };
}

/** مُوقِّعٌ لا يملكُ تهيئةً — يردُّ رفضاً مُصنَّفاً ولا يتظاهرُ بالنجاحِ. */
export class UnconfiguredUploadSigner implements UploadSigner {
  async signUpload(): Promise<Result<SignedUpload, UploadSignerFailure>> {
    return err<UploadSignerFailure>("SIGNER_NOT_CONFIGURED");
  }
}

export class HttpUploadSigner implements UploadSigner {
  readonly #config: SignedUploadConfig;
  readonly #now: () => Date;
  /**
   * ناقلُ النداءِ. وسُمِّيَ `#transport` لا `#fetch` عن قصدٍ: حاجزُ حدِّ الصادرِ
   * (الفحصُ ١٢) يقرأُ كلَّ `fetch(` غيرَ مسبوقٍ بنقطةٍ نداءً عارياً، و`#fetch(`
   * يُقرأُ كذلكَ — فالاسمُ وحدَه كانَ يُشعِلُ الحاجزَ على شيفرةٍ **مُبوَّبةٍ فعلاً**،
   * وإسكاتُ الحاجزِ ثمنٌ لا يُدفَعُ لأجلِ اسمِ حقلٍ.
   */
  readonly #transport: FetchLike;
  readonly #timeoutMs: number;

  constructor(config: SignedUploadConfig) {
    this.#config = config;
    this.#now = config.now ?? (() => new Date());
    this.#transport = config.fetch ?? createGuardedFetch("supabase-object-storage");
    this.#timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async signUpload(input: {
    readonly objectPath: string;
    readonly contentType: string;
    readonly ttlSeconds: number;
  }): Promise<Result<SignedUpload, UploadSignerFailure>> {
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < MIN_UPLOAD_TTL_SECONDS ||
      input.ttlSeconds > MAX_UPLOAD_TTL_SECONDS
    ) {
      return err<UploadSignerFailure>("SIGNER_TTL_OUT_OF_RANGE");
    }
    // مسارٌ غيرُ آمنٍ **لا يُرسَلُ**: هو مسارٌ نطقَت بهِ قاعدتُنا، فشكلٌ غريبٌ
    // فيه عطبُ حمولةٍ لا خطأُ مستخدمٍ.
    if (!isSafeObjectPath(input.objectPath)) {
      return err<UploadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }

    const target =
      `${this.#config.baseUrl}/storage/v1/object/upload/sign/` +
      `${encodeURIComponent(this.#config.bucket)}/${encodeObjectPath(input.objectPath)}`;

    const signedAtMs = this.#now().getTime();
    let response: Response;
    try {
      response = await this.#transport(target, {
        method: "POST",
        headers: {
          // **مفتاحُ خدمةٍ في ترويسةٍ لا في عنوانٍ**: العناوينُ تُسجَّلُ في
          // سجلّاتِ الوسائطِ، والترويسةُ لا تُسجَّلُ افتراضاً.
          authorization: `Bearer ${this.#config.secretKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ expiresIn: input.ttlSeconds }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      return err<UploadSignerFailure>("SIGNER_UNAVAILABLE");
    }

    if (!response.ok) return err<UploadSignerFailure>("SIGNER_UNAVAILABLE");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return err<UploadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }
    if (typeof payload !== "object" || payload === null) {
      return err<UploadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }
    const record = payload as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url : null;
    const token = typeof record.token === "string" && record.token.length > 0 ? record.token : null;
    if (url === null || url.length === 0) {
      return err<UploadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }

    // المزوِّدُ يردُّ مساراً نسبيّاً؛ **يُطلَقُ على أصلِنا** ولا يُصدَّقُ أصلٌ
    // يأتي منه: أصلٌ مُبدَّلٌ في جوابٍ يُحوِّلُ رفعَ وثيقةٍ إلى خادمِ غريبٍ.
    let absolute: string;
    try {
      const resolved = new URL(url, `${this.#config.baseUrl}/`);
      const own = new URL(this.#config.baseUrl);
      if (resolved.origin !== own.origin) {
        return err<UploadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
      }
      if (token !== null && !resolved.searchParams.has("token")) {
        resolved.searchParams.set("token", token);
      }
      absolute = resolved.toString();
    } catch {
      return err<UploadSignerFailure>("SIGNER_MALFORMED_RESPONSE");
    }

    return ok({
      uploadUrl: absolute,
      uploadToken: token,
      // **الانتهاءُ يُحسَبُ من لحظةِ الطلبِ** لا من قراءةِ الرمزِ: قراءةُ
      // `exp` من داخلِ الرمزِ تربطُنا بصيغةِ مزوِّدٍ، وههنا يكفي وعدٌ
      // **مُتحفِّظٌ** (أقصرُ من الحقيقيِّ لا أطولُ) تبنيه الشاشةُ عليه.
      expiresAtEpochMs: signedAtMs + input.ttlSeconds * 1000,
    });
  }
}
