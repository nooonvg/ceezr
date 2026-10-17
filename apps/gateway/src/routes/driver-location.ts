/**
 * الغرض: مسارُ `POST /v1/driver/location` — استقبالُ إصلاحةِ موقعٍ من تطبيقِ
 *   السائقِ المصغَّرِ معَ تحقُّقٍ في الحدِّ وحراسةِ التسلسلِ في القاعدةِ
 *   (البند `F4-01` · `BUG-001` · `BUG-009` · القسم 10: صنفُه «مسارٌ ساخنٌ»).
 * الحالة: منفّذ فعلياً — 2026-09-09.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ،
 *   وبثُّ الموقعِ التكيُّفيُّ من الواجهةِ بندُ `F3-04`.
 * ملاحظات مستقبلية: `request-id` يلحقُ كلَّ ردٍّ بوسيطِ `F1-08` في `server.ts`
 *   فلا يُعادُ ههنا؛ والحالةُ الساخنةُ
 *   المشتركةُ والاستمرارُ المجمَّعُ بندُ `F4-02` — فهذا المسارُ يكتبُ في المصدرِ
 *   القانونيِّ اليومَ ولا يُدَّعى أنَّه يحتملُ حِمْلَ ٤٦٠٠٠ كتابةٍ في الثانيةِ.
 *
 * ## ما لا يفعلُه هذا المسارُ عن قصدٍ
 *
 * - **لا يقرأُ هويّةَ سائقٍ من الطلبِ**: لا معرّفٌ في جسمٍ ولا في `query` ولا في
 *   مسارٍ. الهويّةُ من رمزٍ **موقَّعٍ منّا**، ثمَّ يُقرأُ صفُّ السائقِ بمعرّفِ
 *   تيليجرام. فحاملُ جلسةٍ لا يستطيعُ أن يكتبَ موقعاً لسائقٍ غيرِه ولو أخفقَ
 *   فحصٌ في هذا الملفِّ.
 * - **لا يحكمُ على الإصلاحةِ ههنا**: الحكمُ في `updateDriverLocation` وحدَها —
 *   حَكَمٌ ثانٍ على «الأحدثِ» ينهى عنه `ADR 0053 §٦` نصّاً. وما ههنا تحقُّقُ
 *   **شكلٍ** لا سياسةُ مجالٍ: «أرقامٌ أم لا» لا «أمقبولةٌ أم لا».
 * - **لا يُثبِّتُ حدَّ معدّلٍ في كودِه**: الأرقامُ تُمرَّرُ من موضعِ التركيبِ كما
 *   في `telegram-webhook.ts` — والقسم 10 يوجبُ حدّاً ولا يُعطي رقماً، فلا يُخترَعُ
 *   رقمٌ في مسارٍ.
 * - **لا ينتظرُ أثراً خارجيّاً**: لا تلغرامَ ولا خرائطَ. البثُّ والجلسةُ داخلَ
 *   حالةِ الاستخدامِ على القاعدةِ، وبوابةُ `F6` تنهى عن انتظارِ أثرٍ طويلٍ.
 * - **لا `Idempotency-Key`**: القسم 10 يوجبُه على «كلِّ أمرٍ»، وصنفُ هذا المسارِ
 *   «مسارٌ ساخنٌ» لا أمرٌ، **والامتناعُ محفوظٌ في القاعدةِ لا في ترويسةٍ**:
 *   الكتابةُ الشرطيّةُ تجعلُ إعادةَ إرسالِ النبضةِ نفسِها `stale` أو لا أثرَ لها،
 *   فترويسةٌ تُخزَّنُ لكلِّ نبضةٍ من كلِّ سائقٍ كلَّ ثانيةٍ **حملٌ بلا مقابلٍ**.
 * - **لا يُعيدُ موقعاً مخزَّناً ولا معرّفَ تيليجرام ولا رمزاً** في ردٍّ ولا خطأٍ.
 */

import { type Context, Hono } from "hono";
import type { DriverProfile } from "../../../../packages/application/bots/types.ts";
import {
  type UpdateDriverLocationDeps,
  type UpdateDriverLocationFailureReason,
  updateDriverLocation,
} from "../../../../packages/application/geo/update-driver-location.ts";
import {
  type AuthorizedViewer,
  authorizeViewer,
  type ResolveViewerDeps,
  type ViewerPublicErrorCode,
} from "../../../../packages/application/identity/resolve-viewer.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import type { Result } from "../../../../packages/shared/result/index.ts";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { rateLimitRejection } from "../rate-limit/guard.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

/**
 * قارئُ صفِّ السائقِ كما يحتاجُه المسارُ وحدَه: `findByTelegramId` لا الواجهةُ
 * كاملةً — فلا يستطيعُ المسارُ أن يسجِّلَ سائقاً ولا أن يُقلِّبَ توفُّرَه.
 */
export interface DriverLocationDirectory {
  findByTelegramId(telegramUserId: string): Promise<Result<DriverProfile | null, PortFailureError>>;
}

export interface DriverLocationDependencies {
  /** غيابُها **يعطّلُ المسارَ بـ503** ولا يجعلُه يكتبُ بلا تحقّقٍ. */
  readonly viewer?: ResolveViewerDeps;
  readonly drivers?: DriverLocationDirectory;
  readonly ingest?: UpdateDriverLocationDeps;
  /** حدُّ المعدّلِ لكلِّ سائقٍ — رقمُه من موضعِ التركيبِ لا من ههنا. */
  readonly limits?: { readonly perDriver: RateLimiter };
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * حدُّ حجمِ الجسمِ: إصلاحةٌ خمسةُ أرقامٍ، وكيلوبايتٌ واحدٌ سعةٌ لا تُبلَغُ إلّا
 * بحمولةٍ مُصطنَعةٍ. ورمزُ الحالةِ بروتوكولٌ لا سياسةٌ تجاريّةٌ فيُكتَبُ حرفيّاً
 * في موضعِ الاستجابةِ كما في `session-refresh.ts`.
 */
const DRIVER_LOCATION_MAX_BYTES = 1_024;

type ErrorStatus = { readonly status: 400 | 401 | 403 | 404 | 413 | 422 | 429 | 503 }["status"];

/** جدولٌ واحدٌ حتميٌّ — لا شروطٌ مبثوثةٌ تختلفُ بينَ فرعٍ وفرعٍ. */
const VIEWER_ERROR_STATUS: Readonly<Record<ViewerPublicErrorCode, ErrorStatus>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  ACCOUNT_BLOCKED: 403,
  PROFILE_NOT_AVAILABLE: 503,
};

/**
 * `FIX_REJECTED` **٤٢٢ لا ٤٠٠**: الجسمُ سليمُ الشكلِ وأرقامُه أرقامٌ، وإنّما
 * حكمَ المجالُ بأنَّ الإصلاحةَ لا تُقبَلُ (قِدَمٌ · قفزةٌ · سرعةٌ محالةٌ · دقّةٌ
 * فاحشةٌ). والفرقُ يحتاجُه العميلُ: ٤٠٠ يُصحَّحُ في الكودِ، و٤٢٢ يُصحَّحُ في
 * المستشعِرِ أو يُنتظَرُ فيه نبضةٌ أفضلُ. و`WRITE_FAILED` ٥٠٣ لا ٥٠٠: عطلُ
 * اعتمادٍ يُعادُ محاولةً.
 */
const INGEST_ERROR_STATUS: Readonly<Record<UpdateDriverLocationFailureReason, ErrorStatus>> = {
  FIX_REJECTED: 422,
  DRIVER_NOT_FOUND: 404,
  WRITE_FAILED: 503,
};

function rejected(c: Context, error: string, status: ErrorStatus) {
  return c.json({ ok: false, error }, status);
}

/** رقمٌ منتهٍ أو غيابٌ — و`null` من JSON ليسَ غياباً بل قيمةٌ مرفوضةٌ. */
function optionalFiniteNumber(raw: unknown): number | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "invalid";
  return raw;
}

export interface ParsedDriverFix {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters?: number;
  readonly headingDegrees?: number;
  readonly recordedAtMs?: number;
}

/**
 * تحقُّقُ الشكلِ وحدَه — والحدودُ الجغرافيّةُ والزمنيّةُ في المجالِ لا ههنا.
 *
 * ومُصدَّرةٌ ليُحمَّلَ الحدُّ باختبارِ وحدةٍ مباشرةً: مسارٌ يُختبَرُ من فوقِ HTTP
 * وحدَه تبقى فروعُ رفضِه غيرَ مقروءةٍ.
 */
export function parseDriverFix(body: unknown): ParsedDriverFix | { readonly error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "INVALID_BODY" };
  }
  const raw = body as Record<string, unknown>;
  const latitude = optionalFiniteNumber(raw.latitude);
  const longitude = optionalFiniteNumber(raw.longitude);
  if (latitude === undefined || longitude === undefined) return { error: "COORDINATES_MISSING" };
  if (latitude === "invalid" || longitude === "invalid") return { error: "INVALID_COORDINATES" };

  const accuracyMeters = optionalFiniteNumber(raw.accuracyMeters);
  if (accuracyMeters === "invalid") return { error: "INVALID_ACCURACY" };
  const headingDegrees = optionalFiniteNumber(raw.headingDegrees);
  if (headingDegrees === "invalid") return { error: "INVALID_HEADING" };
  const recordedAtMs = optionalFiniteNumber(raw.recordedAtMs);
  if (recordedAtMs === "invalid") return { error: "INVALID_RECORDED_AT" };
  // طابعٌ غيرُ صحيحٍ عدداً أو غيرُ موجبٍ ليسَ زمناً: يُرفَضُ شكلاً لا يُقرَّبُ.
  if (recordedAtMs !== undefined && (!Number.isInteger(recordedAtMs) || recordedAtMs <= 0)) {
    return { error: "INVALID_RECORDED_AT" };
  }

  return {
    latitude,
    longitude,
    ...(accuracyMeters === undefined ? {} : { accuracyMeters }),
    ...(headingDegrees === undefined ? {} : { headingDegrees }),
    ...(recordedAtMs === undefined ? {} : { recordedAtMs }),
  };
}

async function authenticate(
  c: Context,
  deps: DriverLocationDependencies,
): Promise<{ readonly viewer: AuthorizedViewer } | { readonly response: Response }> {
  if (deps.viewer === undefined || deps.drivers === undefined || deps.ingest === undefined) {
    deps.log?.("driver_location.route_disabled", {});
    return { response: rejected(c, "SESSION_NOT_AVAILABLE", 503) };
  }
  const accessToken = bearerTokenFrom(c.req.header("authorization"));
  const authorized = await authorizeViewer({ accessToken }, deps.viewer);
  if (!authorized.ok) {
    return {
      response: rejected(
        c,
        authorized.error.publicCode,
        VIEWER_ERROR_STATUS[authorized.error.publicCode],
      ),
    };
  }
  return { viewer: authorized.value };
}

export function createDriverLocationRoutes(deps: DriverLocationDependencies): Hono {
  const app = new Hono();

  /**
   * `LOAD-01` — توقيتاتُ أطوارِ الطلبِ الواحدِ: يُقاسُ كلُّ طورٍ (الإثباتُ، حدُّ
   * المعدّلِ، قراءةُ السائقِ، الكتابةُ) على حدةٍ، ويُرسَلُ سطرٌ واحدٌ عندَ خروجِ
   * المعالجِ — نجاحًا أو رفضًا أو استثناءً — عبرَ `driver_location.served`.
   * الربطُ بمعرّفِ الطلبِ ليسَ ههنا: سياقُ الارتباطِ المحمولُ (`F1-08` · `F8-01`)
   * يُلحقُ المعرّفَ بكلِّ سطرٍ يُصدِرُهُ المُصدِرُ الوحيدُ، فيُقارَنَ زمنُ العميلِ
   * بأطوارِ الخادمِ للطلبِ نفسِهِ من غيرِ قراءةِ رأسٍ واردٍ (القاعدةُ `ADR 0043`).
   */
  interface DriverLocationPhaseTimings {
    authMs?: number;
    limitMs?: number;
    lookupMs?: number;
    ingestMs?: number;
    /** مفتاحُ الربطِ مع دليلِ المولّدِ وقاعدةِ البياناتِ — معرّفٌ داخليٌّ لا هويّةَ شخصية. */
    driverId?: string;
  }

  const serve = async (c: Context, timings: DriverLocationPhaseTimings): Promise<Response> => {
    const authStartedAt = performance.now();
    const auth = await authenticate(c, deps);
    timings.authMs = Math.round(performance.now() - authStartedAt);
    if ("response" in auth) return auth.response;
    const directory = deps.drivers;
    const ingest = deps.ingest;
    if (directory === undefined || ingest === undefined) {
      return rejected(c, "SESSION_NOT_AVAILABLE", 503);
    }

    /**
     * الحدُّ **قبلَ** قراءةِ الجسمِ وبعدَ إثباتِ الجلسةِ: مفتاحُه هويّةٌ موقَّعةٌ
     * لا عنوانٌ يُنتحَلُ، ولا يُستنزَفُ الحدُّ بنصٍّ عشوائيٍّ من غيرِ صاحبِ جلسةٍ.
     * والحدُّ يفشلُ مفتوحاً في مُنفِّذِه — انقطاعُ مخزنِه يُضعِفُ ولا يُعطِّلُ.
     *
     * **تصحيحٌ (`ح-8`)**: كانَ الجوابُ `429` **بلا `Retry-After`** لأنَّ الجوابَ
     * الموحَّدَ كانَ خاصّاً في `telegram-webhook.ts` فكُتِبَ ههنا من جديدٍ ناقصاً —
     * وعميلٌ يُرَدُّ ولا يُخبَرُ متى يعودُ يُعيدُ فوراً. صارَ من
     * `../rate-limit/guard.ts` (`SEC-07` · ADR 0139).
     */
    const limitStartedAt = performance.now();
    const decision = await deps.limits?.perDriver.hit(`driver-location:${auth.viewer.sessionId}`);
    const exceeded = rateLimitRejection(c, decision);
    timings.limitMs = Math.round(performance.now() - limitStartedAt);
    if (exceeded !== null) return exceeded;

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > DRIVER_LOCATION_MAX_BYTES) {
      return rejected(c, "PAYLOAD_TOO_LARGE", 413);
    }
    const raw = await readBounded(c.req.raw.body, DRIVER_LOCATION_MAX_BYTES);
    if (raw === null) return rejected(c, "PAYLOAD_TOO_LARGE", 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return rejected(c, "INVALID_JSON", 400);
    }
    const fix = parseDriverFix(body);
    if ("error" in fix) return c.json({ ok: false, error: fix.error }, 400);

    /**
     * صفُّ السائقِ يُقرأُ بمعرّفِ تيليجرامَ من الرمزِ — وهوَ **التفويضُ نفسُه**:
     * مَن لا صفَّ سائقٍ له لا يكتبُ موقعَ سائقٍ. ولا يُقرأُ دورٌ من الطلبِ، ولا
     * يُرقّى مجهولٌ إلى سائقٍ عندَ الشكِّ.
     */
    const lookupStartedAt = performance.now();
    const found = await directory.findByTelegramId(auth.viewer.telegramUserId);
    timings.lookupMs = Math.round(performance.now() - lookupStartedAt);
    if (!found.ok) return rejected(c, "DRIVER_LOOKUP_FAILED", 503);
    if (found.value === null) return rejected(c, "DRIVER_NOT_REGISTERED", 404);
    timings.driverId = found.value.id;

    const ingestStartedAt = performance.now();
    const result = await updateDriverLocation(
      {
        driver: found.value,
        latitude: fix.latitude,
        longitude: fix.longitude,
        quality: {
          ...(fix.accuracyMeters === undefined ? {} : { accuracyMeters: fix.accuracyMeters }),
          ...(fix.headingDegrees === undefined ? {} : { headingDegrees: fix.headingDegrees }),
          ...(fix.recordedAtMs === undefined ? {} : { recordedAtMs: fix.recordedAtMs }),
        },
      },
      ingest,
    );
    timings.ingestMs = Math.round(performance.now() - ingestStartedAt);

    if (!result.ok) {
      const status = INGEST_ERROR_STATUS[result.error.reason];
      // رموزُ الملاحظاتِ تُعادُ عندَ الرفضِ وحدَه: تشخيصٌ يُصلِحُ به العميلُ
      // نبضتَه، وليسَ فيها حالةٌ مخزَّنةٌ ولا موضعٌ سابقٌ يُستدَلُّ به.
      if (result.error.reason === "FIX_REJECTED") {
        return c.json(
          { ok: false, error: "FIX_REJECTED", findings: result.error.findings },
          status,
        );
      }
      return rejected(c, result.error.reason, status);
    }

    /**
     * `stale` **ليسَ خطأً فلا يُجابُ برمزِ خطأٍ**: في القاعدةِ إصلاحةٌ أحدثُ،
     * والحالةُ سليمةٌ ولم تتراجعْ. وإجابتُه ٤٠٩ كانت ستجعلَ عميلاً يُعيدُ
     * المحاولةَ على شيءٍ لا تُصلِحُه إعادةٌ — والصدقُ أن يُقالَ: قُبِلَ؟ لا.
     */
    if (result.value.kind === "stale") {
      return c.json({ ok: true, accepted: false, reason: "STALE" });
    }
    return c.json({
      ok: true,
      accepted: true,
      verdict: result.value.verdict,
      recordedAtMs: result.value.recordedAtMs,
      dispatchable: result.value.becameLive,
    });
  };

  app.post("/v1/driver/location", async (c) => {
    const startedAt = performance.now();
    const timings: DriverLocationPhaseTimings = {};
    let response: Response | undefined;
    try {
      response = await serve(c, timings);
      return response;
    } finally {
      /**
       * سطرٌ واحدٌ لكلِّ طلبٍ — نجاحًا ورفضًا واستثناءً — بلا قراءةِ رأسٍ من
       * العميلِ وبلا أثرٍ في الجوابِ. وعطلُ التسجيلِ نفسِهِ لا يُسقِطُ الطلبَ:
       * القياسُ لا يعطّلُ ما يقيسُهُ.
       */
      try {
        deps.log?.("driver_location.served", {
          status: response?.status ?? null,
          totalMs: Math.round(performance.now() - startedAt),
          ...timings,
        });
      } catch {
        /* القياسُ لا يُسقِطُ ما يقيسُهُ. */
      }
    }
  });

  return app;
}
