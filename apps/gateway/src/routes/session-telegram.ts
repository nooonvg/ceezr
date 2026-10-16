/**
 * الغرض: مسارُ `POST /v1/session/telegram` — مبادلةُ `initData` الخامِ بجلسةٍ
 *   داخلية بعدَ التحقّقِ التشفيريِّ على الخادم.
 * الحالة: منفّذ فعلياً — البند `F1-03`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/server.ts` عبر تركيبٍ اختياري.
 * ملاحظات مستقبلية: التجديدُ والتخزينُ على الجهازِ نُفِّذا في `F1-04` (مسارُ
 *   `POST /v1/session/refresh` وسياسةُ التخزينِ في `apps/miniapp/src/identity`)؛
 *   والإبطالُ الفوريُّ من الخادمِ غيرُ منفَّذٍ ولا مُدَّعى. وحدُّ المعدّلِ
 *   لكلِّ عنوانٍ ومستخدمٍ على هذا المسارِ يتبع سياسةَ القسم 10 عندَ بناءِ حدِّ API.
 *
 * ما لا يفعله هذا المسارُ عن قصد:
 *   ــ لا يقرأ حقلَ هويةٍ من الجسمِ غيرَ `initData`: لا `user` ولا `telegram_id`
 *      ولا `role`. وما أرسله العميلُ عنها يُهمَل إهمالاً تاماً.
 *   ــ لا يُنشئ ولا يعدّل كياناً من كياناتِ العمل (مستخدماً أو رحلةً أو سائقاً) —
 *      ADR 0035: التطبيقُ المصغَّرُ لا يخلق حالةَ عمل.
 *   ــ لا يُسجِّل `initData` الخامَ ولا `hash` ولا الرمزَ المُصدَر، ولا يكشف سببَ
 *      الرفضِ الدقيقَ في الردّ: السببُ المصنَّفُ للسجلِّ الداخليّ، والرمزُ العامُّ
 *      للعميل — كي لا يصير الردُّ دليلاً يقود المهاجمَ إلى موضعِ الثُّلمة.
 */

import { type Context, Hono } from "hono";
import {
  type ConsentDeps,
  readConsentStatus,
} from "../../../../packages/application/consent/record-consent.ts";
import {
  type ExchangeTelegramSessionDeps,
  exchangeTelegramSession,
} from "../../../../packages/application/identity/exchange-telegram-session.ts";
import {
  type ResolveViewerDeps,
  resolveViewer,
} from "../../../../packages/application/identity/resolve-viewer.ts";
import type { RateLimiter } from "../rate-limit/fixed-window.ts";
import { clientAddress, rateLimitRejection } from "../rate-limit/guard.ts";
import { readBounded } from "./telegram-webhook.ts";

/** حدُّ الجسم: `initData` نصٌّ صغير؛ وما تجاوز 16KB ليس `initData`. */
export const SESSION_TELEGRAM_MAX_BYTES = 16 * 1024;

export interface SessionTelegramDependencies {
  /**
   * تبعياتُ حالةِ الاستخدام — غيابُها **يعطّل المسارَ بـ503** ولا يجعله يقبل
   * بلا تحقّق (سابقةُ ويبهوك الدفع: غيابُ الموثِّقِ يعني تعطيلاً لا تسامحاً).
   */
  readonly exchange?: ExchangeTelegramSessionDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * حاصرُ المعدَّلِ — **اختياريٌّ في النوعِ لا في التشغيلِ**: يُمرَّرُ من موضعِ
   * التركيبِ (`apps/gateway/src/index.ts`) بأرقامِ `rate-limit/policy.ts`، ويغيبُ في
   * اختباراتِ المسارِ التي لا تقيسُ الحدَّ. وغيابُه **مُعلَنٌ في السِجلِّ** لا
   * مسكوتٌ عنه، وحاجزُ `check-rate-limit-coverage` يطلبُ نصَّ تركيبِه.
   */
  readonly limits?: { readonly perAddress: RateLimiter };
  /**
   * `F1-09` · `ADR 0210`: قراءتا الإقلاعِ (`GET /v1/me` · `GET /v1/consents`) تُضمَّنانِ في
   * ردِّ المبادلةِ **بالرمزِ المُصدَرِ نفسِه وبحالتَي الاستخدامِ نفسَيهما** — فيسقطُ ذهابٌ
   * وإيابٌ كاملٌ من مسارِ الإقلاعِ (~560 ms على «Slow 4G»). والتضمينُ **إضافةٌ لا بديلٌ**:
   * كلُّ قراءةٍ تفشلُ تُحذَفُ من الردِّ فيعودُ العميلُ إلى مسارِها المستقلِّ كما كانَ،
   * ولا تُسقِطُ المبادلةَ أبداً. وغيابُ هذه التبعيّةِ = ردٌّ كما كانَ حرفاً.
   */
  readonly bootstrap?: {
    readonly viewer?: ResolveViewerDeps;
    readonly consent?: ConsentDeps;
  };
}

/**
 * القراءتانِ متوازيتانِ، وكلٌّ منهما بشكلِ ردِّ مسارِها المستقلِّ حرفاً (`{ ok: true, … }`)
 * كي يستهلكَه العميلُ بلا فرعٍ جديدٍ. ورميٌ في إحداهما = غيابُها لا فشلُ المبادلةِ.
 */
export async function bootstrapReads(
  bootstrap: SessionTelegramDependencies["bootstrap"],
  accessToken: string,
): Promise<Record<string, unknown>> {
  if (bootstrap === undefined) return {};
  const viewer =
    bootstrap.viewer === undefined
      ? Promise.resolve(undefined)
      : resolveViewer({ accessToken }, bootstrap.viewer).then(
          (r) =>
            r.ok
              ? {
                  ok: true,
                  role: r.value.role,
                  status: r.value.status,
                  languageCode: r.value.languageCode,
                }
              : undefined,
          () => undefined,
        );
  const consents =
    bootstrap.consent === undefined
      ? Promise.resolve(undefined)
      : readConsentStatus(bootstrap.consent, { accessToken }).then(
          (r) =>
            r.ok
              ? { ok: true, documents: r.value.documents, onboarding: r.value.onboarding }
              : undefined,
          () => undefined,
        );
  const [v, c] = await Promise.all([viewer, consents]);
  return { ...(v === undefined ? {} : { viewer: v }), ...(c === undefined ? {} : { consents: c }) };
}

function rejected(c: Context, error: string, status: 400 | 401 | 413 | 503) {
  return c.json({ ok: false, error }, status);
}

export function createSessionTelegramRoutes(deps: SessionTelegramDependencies): Hono {
  const app = new Hono();

  app.post("/v1/session/telegram", async (c) => {
    /**
     * الحدُّ **قبلَ قراءةِ الجسمِ وقبلَ حسابِ `HMAC`**: كلُّ نداءٍ ههنا يستهلكُ
     * تحقُّقاً تشفيريّاً لِمُنادٍ لا هويّةَ له بعدُ، فحدٌّ بعدَ الحسابِ يدفعُ الثمنَ
     * الذي جاءَ ليمنعَه. والمفتاحُ عنوانٌ — وهوَ مُنتحَلٌ، وذاكَ **يُقالُ لا
     * يُدَّعى خلافُه** (`SEC-07` · ADR 0139).
     */
    const exceeded = rateLimitRejection(
      c,
      await deps.limits?.perAddress.hit(
        `session-telegram:${clientAddress(c.req.header("x-forwarded-for"))}`,
      ),
    );
    if (exceeded !== null) return exceeded;
    /**
     * **والحدُّ قبلَ فحصِ التركيبِ** لا بعدَه: بابٌ غيرُ مُهيَّأٍ يُجيبُ `503`، وذاكَ
     * جوابٌ يُحسَبُ ثمنُه أيضاً — فلا يُترَكُ سطحٌ مكشوفٌ بلا عدٍّ لأنَّه معطَّلٌ.
     */

    if (deps.exchange === undefined) {
      deps.log?.("session.telegram_route_disabled", {});
      return rejected(c, "SESSION_NOT_CONFIGURED", 503);
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > SESSION_TELEGRAM_MAX_BYTES) {
      return rejected(c, "PAYLOAD_TOO_LARGE", 413);
    }
    const raw = await readBounded(c.req.raw.body, SESSION_TELEGRAM_MAX_BYTES);
    if (raw === null) return rejected(c, "PAYLOAD_TOO_LARGE", 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return rejected(c, "INVALID_JSON", 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return rejected(c, "INVALID_BODY", 400);
    }

    const initData = (body as Record<string, unknown>).initData;
    if (typeof initData !== "string" || initData.length === 0) {
      return rejected(c, "INIT_DATA_MISSING", 400);
    }

    const result = await exchangeTelegramSession({ initData }, deps.exchange);
    if (!result.ok) {
      if (result.error.code === "SESSION_ISSUE_FAILED") {
        return rejected(c, result.error.publicCode, 503);
      }
      if (result.error.code === "REPLAY_GUARD_UNAVAILABLE") {
        return rejected(c, result.error.publicCode, 503);
      }
      // 401 لا 400 في الأصل: المدخلُ سليمُ الشكلِ نحوياً لكنّ إثباتَ الهويةِ لم
      // يُقبَل؛ أمّا التشويهُ وغيابُ الحقولِ الملزَمةِ فخطأُ طلبٍ صريح.
      if (result.error.publicCode === "INIT_DATA_MALFORMED") {
        return rejected(c, "INIT_DATA_MALFORMED", 400);
      }
      if (result.error.publicCode === "INIT_DATA_MISSING") {
        return rejected(c, "INIT_DATA_MISSING", 400);
      }
      return rejected(c, result.error.publicCode, 401);
    }

    // الردُّ لا يعيد شيئاً من `initData`، ولا الاسمَ ولا اللغةَ: رمزٌ وانتهاءٌ فقط،
    // ومعرّفُ مستخدمِ تيليجرامَ الذي يعرفه العميلُ عن نفسِه أصلاً — إلا `start_param`:
    // فهو هدفُ هبوطٍ موقَّعٌ من تيليجرامَ نفسِهِ (لا ضميمةٌ خام) يقرؤه التطبيقُ للتموجيهِ
    // حينَ فُتِحَ برابطِ `startapp` من بطاقةِ قروبٍ (`ADR 0286`) — تموجيهٌ لا هويةٌ ولا
    // صلاحيةً: الهويّةُ من التوقيعِ وحده.
    const embedded = await bootstrapReads(deps.bootstrap, result.value.session.accessToken);
    return c.json(
      {
        ok: true,
        ...embedded,
        ...(result.value.proof.startParam === undefined
          ? {}
          : { startParam: result.value.proof.startParam }),
        accessToken: result.value.session.accessToken,
        tokenType: result.value.session.tokenType,
        expiresAtMs: result.value.session.expiresAtMs,
        expiresInSeconds: result.value.session.expiresInSeconds,
        telegramUserId: result.value.proof.telegramUserId,
        // رمزُ التجديدِ ومواعيدُه (`F1-04`) — يظهر إن وُصِلت سلسلةُ التجديد. ويبقى
        // الردُّ بلا تجديدٍ ردّاً صحيحاً: جلسةٌ بلا تجديدٍ لا جلسةٌ بلا توقيع.
        ...(result.value.refresh === undefined
          ? {}
          : {
              refreshToken: result.value.refresh.refreshToken,
              refreshExpiresAtMs: result.value.refresh.refreshExpiresAtMs,
              refreshExpiresInSeconds: result.value.refresh.refreshExpiresInSeconds,
              absoluteExpiresAtMs: result.value.refresh.absoluteExpiresAtMs,
            }),
      },
      201,
    );
  });

  return app;
}
