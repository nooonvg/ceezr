/**
 * الغرض: مساراتُ الرحلةِ — `POST /v1/rides` (ترويسةُ `Idempotency-Key`
 *   **إلزاميّةٌ**) و`GET /v1/rides/:id/search` (حالةٌ صادقةٌ) و
 *   `POST /v1/rides/:id/cancel` (إلغاءٌ بلا عقوبةٍ قبلَ الإسنادِ) —
 *   البند `F2-05` · `SR-05` · `ARCH-006`.
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وشاشةُ البحثِ
 *   في `apps/miniapp/src/surfaces/rider/search`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ `GET /v1/rides/:id` للرحلةِ النشطةِ على
 *   النسقِ نفسِه، و`F3` لا يزيدُ ههنا شيئاً: البثُّ عملُ عاملٍ لا مسارٍ.
 * ملاحظات مستقبلية: لا حقلَ أجرةٍ ولا وسيلةَ دفعٍ ولا عقوبةَ إلغاءٍ في أيِّ من
 *   هذه الحمولاتِ قبلَ `DEC-11` و`F12-16` (`ADR 0039` §٤ · `م13-7`).
 *
 * ## لماذا المفتاحُ ترويسةٌ لا حقلٌ في الجسمِ
 *
 * لأنَّه **صفةُ الأمرِ لا صفةُ الرحلةِ**: الرحلةُ لها مبدأٌ ومقصدٌ وخدمةٌ، وأمّا
 * «هذا نداءٌ واحدٌ لا نداءانِ» فشأنُ النقلِ. وترويسةُ `Idempotency-Key` عُرفٌ
 * مقروءٌ في الوسائطِ والوكلاءِ والسجلّاتِ، ويُقرأُ في المراجعةِ دونَ فتحِ الجسمِ.
 * وغيابُها **رمزٌ مُعلَنٌ** `IDEMPOTENCY_KEY_REQUIRED` بـ`400`، لا مفتاحٌ يختلقُه
 * الخادمُ — فمفتاحٌ جديدٌ لكلِّ نداءٍ يُبطِلُ `ARCH-006` نصّاً ومعنًى.
 *
 * ## ولماذا الرفضُ ههنا `200` والعطبُ `4xx`/`5xx`
 *
 * كما في `F2-03` و`F2-04`: «خارجَ منطقةِ الخدمةِ» و«لديكَ رحلةٌ قائمةٌ» **أجوبةٌ
 * صحيحةٌ** عن سؤالٍ صحيحٍ، وتُنشَرُ `200` بـ`accepted:false` ورمزٍ يُترجَمُ نصّاً
 * في الشاشةِ. وأمّا «لا ترويسةَ» و«جلسةٌ ساقطةٌ» و«المخزنُ معطَّلٌ» فعطبُ طلبٍ أو
 * بيئةٍ، ورمزُ الحالةِ فيها هوَ الجوابُ.
 *
 * ## ولماذا `reused` يُنشَرُ للعميلِ
 *
 * كي تعرفَ الشاشةُ أنَّ ضغطتَها الثانيةَ **لم تُنشئْ رحلةً ثانيةً** فتنتقلَ إلى
 * الرحلةِ القائمةِ بلا إنذارٍ مُخيفٍ. وطيُّه يجعلُ الإعادةَ تبدو إنشاءً جديداً،
 * فيُحسَبُ في أيِّ قياسٍ لاحقٍ رحلتَينِ حيثُ رحلةٌ واحدةٌ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ
 *
 *   ــ **لا تُسنِدُ سائقاً ولا تبثُّ عرضاً**: الإنشاءُ يُنتِجُ `searching` وحدَها.
 *   ــ **لا تقرأُ مدينةً ولا معرّفَ راكبٍ من الجسمِ**: الهويّةُ من الرمزِ الموقَّعِ
 *      والمدينةُ من صفِّ صاحبِ الحسابِ في القاعدةِ (القاعدة 0.4).
 *   ــ **لا تُعيدُ نصّاً معروضاً**: مفاتيحُ ورموزٌ وأعدادٌ وأختامٌ (القسم 9.11).
 *   ــ **لا تُفرِّقُ «ليسَ لك» من «غيرُ موجودٍ»**: `ORDER_NOT_FOUND` للأمرَينِ، كي
 *      لا يصيرَ المسارُ عدَّادَ معرّفاتٍ صحيحةً لمن يجرِّبُها.
 *
 * ## إضافةُ البند `F2-07` (2026-09-13) — الإنهاءُ والتقييمُ
 *
 * زِيدَ مسارانِ: `GET /v1/rides/:id/summary` (ملخَّصُ الرحلةِ المنتهيةِ) و
 * `POST /v1/rides/:id/rating` (تقييمٌ بوسومٍ). وما سبقَ من هذا الرأسِ يبقى
 * مكتوباً كما كُتِبَ (`ح-1` · `ح-8`)، وهذه زيادتُه:
 *
 *   ــ **ولماذا مسارُ ملخَّصٍ منفصلٌ عن `GET /v1/rides/:id`**: الأوّلُ يُسألُ
 *      كلَّ دقيقةٍ ويحملُ موقعاً بعُمرِه ومدّةَ وصولٍ من محرِّكِ توجيهٍ، وهذا
 *      يُسألُ مرّةً ويحملُ مدّةً ووتراً وحالةَ تقييمٍ **ولا موقعَ**. وجمعُهما
 *      يعني نداءَ محرِّكٍ لرحلةٍ انتهت، **وحقلَ موقعٍ في ردٍّ لرحلةٍ منتهيةٍ**.
 *   ــ **وللتقييمِ خريطةُ حالاتٍ خاصّةٌ به** (`STATUS_BY_RATING_ERROR`): توسيعُ
 *      `RequestRidePublicErrorCode` يُلزِمُ كلَّ مسارٍ يقرؤُه بحالاتٍ لرموزٍ لا
 *      تخصُّه، ورمزٌ بلا حالةٍ في خريطةٍ شاملةٍ `undefined` يُنشَرُ `200`.
 *   ــ **ولا حقلَ مبلغٍ ولا أجرةٍ ولا إكراميّةٍ في حمولةِ الملخَّصِ ولا خانةً
 *      لها** (`ADR 0039` §٤ · `م13-7` · `DEC-11`) — والملخَّصُ **ملخَّصُ رحلةٍ
 *      لا إيصالٌ**، وخانةٌ فارغةٌ لمالٍ تُقرأُ التزاماً.
 *   ــ **ولا زرَّ تذكرةِ دعمٍ ولا مسارَ لها ههنا**: `open_support_ticket`
 *      قائمةٌ في القاعدةِ ولها مُنادونَ، ووصلُها بهذا السطحِ خارجَ النطاقِ
 *      المحجوزِ — غيابٌ مُصرَّحٌ لا حقلٌ منسيٌّ.
 */

import { type Context, Hono } from "hono";
import {
  type CancelRideRequestDeps,
  cancelRideRequest,
} from "../../../../packages/application/transport/cancel-ride-request.ts";
import {
  type ReadActiveRideDeps,
  readActiveRide,
} from "../../../../packages/application/transport/read-active-ride.ts";
import {
  type ReadRideDetailDeps,
  readRideDetail,
} from "../../../../packages/application/transport/read-ride-detail.ts";
import {
  type ReadRideHistoryDeps,
  readRideHistory,
} from "../../../../packages/application/transport/read-ride-history.ts";
import {
  type ReadRideSearchDeps,
  readRideSearch,
} from "../../../../packages/application/transport/read-ride-search.ts";
import {
  type ReadRideSummaryDeps,
  readRideSummary,
} from "../../../../packages/application/transport/read-ride-summary.ts";
import {
  type RequestRideDeps,
  type RequestRidePublicErrorCode,
  requestRide,
} from "../../../../packages/application/transport/request-ride.ts";
import {
  decideRideCandidate,
  type RideCandidateDeps,
  type RideCandidateErrorCode,
  readRideCandidate,
} from "../../../../packages/application/transport/ride-candidate.ts";
import {
  type ReadRideShareDeps,
  type RideSharePublicErrorCode,
  readRideShare,
  type StartRideShareDeps,
  type StopRideShareDeps,
  startRideShare,
  stopRideShare,
} from "../../../../packages/application/transport/ride-share.ts";
import {
  ackRiderTripEvents,
  type RiderTripEventsDeps,
  type RiderTripEventsErrorCode,
  readRiderTripEvents,
} from "../../../../packages/application/transport/rider-trip-events.ts";
import {
  // الاسمُ يُقصَّرُ عندَ الاستيرادِ **لا يُغيَّرُ في مصدرِه**: خريطةُ الحالاتِ
  // أدناهُ يجبُ أن يبقى تصريحُها **سطراً واحداً** يُرى فيه اتّحادُ الحالاتِ
  // المسموحةِ كما هوَ، وبالاسمِ الطويلِ يتجاوزُ السطرُ عرضَ المُنسِّقِ فيُكسَرُ
  // ثلاثةَ أسطرٍ ويختفي الاتّحادُ عن سطرِ التصريحِ.
  type SubmitRideRatingPublicErrorCode as RatingErrorCode,
  type SubmitRideRatingDeps,
  submitRideRating,
} from "../../../../packages/application/transport/submit-ride-rating.ts";
import {
  SHARE_DISCLOSED,
  SHARE_WITHHELD,
} from "../../../../packages/domain/transport/ride-share.ts";
import { bearerTokenFrom } from "./me.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface RidesRouteDependencies {
  /** غيابُها يُعطِّلُ الإنشاءَ بـ503 ولا يجعلُه يُجيبُ بلا كتابةٍ. */
  readonly request?: RequestRideDeps;
  readonly search?: ReadRideSearchDeps;
  /** قارئُ الرحلةِ النشطةِ (`F2-06`) — غيابُه يُعطِّلُ المسارَ بـ503 صادقاً. */
  readonly active?: ReadActiveRideDeps;
  readonly cancel?: CancelRideRequestDeps;
  /** قارئُ ملخَّصِ المنتهيةِ (`F2-07`) — غيابُه يُعطِّلُ المسارَ بـ503 صادقاً. */
  readonly summary?: ReadRideSummaryDeps;
  /** أمرُ التقييمِ (`F2-07`) — غيابُه يُعطِّلُ المسارَ بـ503 لا بـ500 صامتٍ. */
  readonly rating?: SubmitRideRatingDeps;
  /** قارئُ السجلِّ (`F2-08`) — غيابُه يُعطِّلُ `GET /v1/rides` بـ503 صادقاً. */
  readonly history?: ReadRideHistoryDeps;
  /** قارئُ التفاصيلِ (`F2-08`) — منفصلٌ عن السجلِّ: تعطيلُ أحدِهما لا يُسقِطُ الآخرَ. */
  readonly detail?: ReadRideDetailDeps;
  /** قارئُ حالِ المشاركةِ (`F2-09`) — غيابُه يُعطِّلُ القراءةَ بـ503 صادقاً. */
  readonly share?: ReadRideShareDeps;
  /**
   * إصدارُ الرابطِ (`F2-09`). **منفصلٌ عن القراءةِ بقصدٍ**: الأساسُ العامُّ
   * (`TRACKING_TOKEN_BASE_URL`) قد يكونُ غيرَ مضبوطٍ فيُطفأُ الإصدارُ وحدَه،
   * **وتبقى القراءةُ تقولُ للمالكِ ما حالُ روابطِه القائمةِ** — لا شاشةٌ عمياءُ.
   */
  readonly shareStart?: StartRideShareDeps;
  /**
   * الإيقافُ (`F2-09`). **منفصلٌ عن الإصدارِ**: لو أُطفئَ الإصدارُ لخللٍ وجبَ أن
   * يبقى الإيقافُ عاملاً — **زرُّ «أوقِفْ» أحقُّ بالبقاءِ من زرِّ «شارِكْ»**.
   */
  readonly shareStop?: StopRideShareDeps;
  /** `WR-09` — المرشَّحُ وقرارُ الراكب؛ غيابُه ⇒ `503` للمسارَين. */
  readonly candidate?: RideCandidateDeps;
  /** ADR 0287 — أحداثُ رحلةِ الراكبِ وإقرارُه؛ غيابُه ⇒ `503` للمسارَين. */
  readonly tripEvents?: RiderTripEventsDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/**
 * أربعةُ حقولٍ عشريّةٍ وخدمةٌ وملاحظةٌ حدُّها 280 محرفاً.
 *
 * `LOC-TRUST-01` رفعَ الحدَّ من 2048: صارَ الجسمُ يحملُ مكانَين، لكلٍّ رابطٌ حتّى 2048
 * محرفاً (ASCII) وملاحظةٌ حتّى 200 (≈ 600 بايتٍ بالعربيّة) واسمٌ حتّى 120 (≈ 360).
 * فأسوأُ حالٍ مشروعٍ ≈ 840 + 2×(2048 + 600 + 360) + ~600 للحقولِ والأقواس ≈ 7.5 KB؛
 * و12 KiB تتركُ هامشاً لترميزِ JSON (`\uXXXX`) ولا تفتحُ بابَ حمولةٍ كبيرة.
 *
 * و2048 بايتاً تكفي الملاحظةَ بالعربيّةِ في UTF-8 (ثلاثةُ بايتاتٍ للمحرفِ في
 * أسوأِ حالٍ شائعٍ) ولا تدعُ بابَ حمولةٍ كبيرةٍ مفتوحاً. حدُّ نقلٍ لا قيمةُ
 * منتَجٍ (القاعدة 0.3)، وحدُّ الملاحظةِ نفسُه في النطاقِ وفي القاعدةِ.
 */
export const RIDE_REQUEST_MAX_BYTES = 12_288;

const STATUS_BY_ERROR: Readonly<Record<RequestRidePublicErrorCode, 400 | 401 | 404 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  UNKNOWN_SERVICE: 400,
  NOTES_TOO_LONG: 400,
  PARCEL_DESCRIPTION_INVALID: 400,
  // `WR-05` — سياسةُ المبلغ: عطبُ طلبٍ يُصلِحُه الراكب.
  OFFER_MODE_INVALID: 400,
  OFFER_AMOUNT_REQUIRED: 400,
  OFFER_AMOUNT_INVALID: 400,
  OFFER_AMOUNT_UNEXPECTED: 400,
  // `WR-06` — وقتُ حضورٍ لا يُقرأ أو خارجَ نافذتِه.
  PICKUP_AT_INVALID: 400,
  // `LOC-TRUST-01` — عطبُ طلبٍ يُصلِحُه المُنادي.
  PLACE_INVALID: 400,
  PLACE_LINK_UNSUPPORTED: 400,
  PLACE_NOTES_TOO_LONG: 400,
  PLACE_POINT_UNRELIABLE: 400,
  // الجلسةُ صحيحةٌ ولا صفَّ مستخدمٍ: `404` لا `401`، ولا يُنشَأُ الصفُّ (`ADR 0035`).
  ACCOUNT_NOT_FOUND: 404,
  RIDER_NOT_REGISTERED: 404,
  RIDE_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, error: RequestRidePublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

/**
 * حدُّ جسمِ التقييمِ. ملاحظةٌ حدُّها ألفُ محرفٍ في UTF-8 تبلغُ ثلاثةَ آلافِ
 * بايتٍ بالعربيّةِ في أسوأِ حالٍ شائعٍ، وزيادةُ النجومِ وثلاثةِ وسومٍ وأقواسِ
 * JSON دونَ الكيلوبايتِ. **حدُّ نقلٍ لا قيمةُ منتَجٍ** (القاعدة 0.3): حدُّ
 * الملاحظةِ نفسُه مكتوبٌ في النطاقِ وفي القاعدةِ.
 */
export const RIDE_RATING_MAX_BYTES = 4096;

/**
 * خريطةُ حالاتِ التقييمِ — **شاملةٌ حرفاً** لاتّحادِ رموزِه.
 *
 * ورموزُ الحدِّ الجديدةُ كلُّها `400`: نجومٌ خارجَ المدى أو ملاحظةٌ فوقَ الحدِّ
 * أو وسمٌ مجهولٌ **عطبُ طلبٍ** يُصلِحُه المُنادي، لا حكمٌ مقيسٌ يُنشَرُ `200`.
 * وأمّا رفضُ القاعدةِ (`ALREADY_RATED` · `RATING_WINDOW_CLOSED` · …) فيُنشَرُ
 * `200` بـ`accepted:false` كما في بقيّةِ مساراتِ الرحلةِ.
 */
const STATUS_BY_RATING_ERROR: Readonly<Record<RatingErrorCode, 400 | 401 | 404 | 503>> = {
  ...STATUS_BY_ERROR,
  STARS_OUT_OF_RANGE: 400,
  COMMENT_TOO_LONG: 400,
  UNKNOWN_RATING_TAG: 400,
  TOO_MANY_RATING_TAGS: 400,
  DUPLICATE_RATING_TAG: 400,
};

function ratingRejected(c: Context, error: RatingErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_RATING_ERROR[error]);
}

/**
 * خريطةُ حالاتِ المشاركةِ (`F2-09`) — **شاملةٌ حرفاً** لاتّحادِ رموزِها.
 *
 * و`SHARING_NOT_CONFIGURED` تُنشَرُ `503` لا `400`: المُنادي لم يُخطئْ، والمنصّةُ
 * هيَ التي لم تُضبَطْ. و`400` كانت ستدفعُ العميلَ إلى تصحيحِ طلبٍ سليمٍ أبداً.
 */
const STATUS_BY_SHARE_ERROR: Readonly<Record<RideSharePublicErrorCode, 400 | 401 | 404 | 503>> = {
  ...STATUS_BY_ERROR,
  SHARING_NOT_CONFIGURED: 503,
};

function shareRejected(c: Context, error: RideSharePublicErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_SHARE_ERROR[error]);
}

/** ترويسةُ المفتاحِ — تُقرأُ بالاسمِ المُعرَّفِ لا بأيِّ مرادفٍ. */
export const RIDE_CANDIDATE_MAX_BYTES = 1024;

const CANDIDATE_STATUS: Record<RideCandidateErrorCode, 400 | 401 | 404 | 409 | 410 | 503> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  ORDER_NOT_FOUND: 404,
  ORDER_NOT_SEARCHING: 409,
  CANDIDATE_CHANGED: 409,
  CANDIDATE_EXPIRED: 410,
  RIDE_STORE_NOT_AVAILABLE: 503,
};

const TRIP_EVENTS_STATUS: Record<RiderTripEventsErrorCode, 400 | 401 | 404 | 503> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  ORDER_NOT_FOUND: 404,
  RIDE_STORE_NOT_AVAILABLE: 503,
};

function tripEventsRejected(c: Context, error: RiderTripEventsErrorCode) {
  return c.json({ ok: false, error }, TRIP_EVENTS_STATUS[error]);
}

function candidateRejected(c: Context, error: RideCandidateErrorCode) {
  return c.json({ ok: false, error }, CANDIDATE_STATUS[error]);
}

export const IDEMPOTENCY_HEADER = "idempotency-key";

/** `WR-06` — لحظةٌ اختياريّةٌ إلى ISO؛ الغيابُ `null` صريحًا لا حقلٌ محذوف. */
function isoOrNull(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

export function createRidesRoutes(deps: RidesRouteDependencies): Hono {
  const app = new Hono();

  app.post("/v1/rides", async (c) => {
    if (deps.request === undefined) {
      deps.log?.("rides.create_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > RIDE_REQUEST_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, RIDE_REQUEST_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }

    const result = await requestRide(deps.request, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      idempotencyKey: c.req.header(IDEMPOTENCY_HEADER),
      body,
    });
    if (!result.ok) return rejected(c, result.error);

    const verdict = result.value;
    if (!verdict.accepted) {
      return c.json({
        ok: true,
        accepted: false as const,
        refusal: verdict.refusal,
        // طريقُ الخروجِ من الرفضِ يُنشَرُ معَه: رفضٌ بلا طريقٍ شاشةٌ مسدودةٌ.
        activeRide: verdict.activeRide,
      });
    }
    return c.json({
      ok: true,
      accepted: true as const,
      orderId: verdict.ride.orderId,
      createdAt: new Date(verdict.ride.createdAtMs).toISOString(),
      reused: verdict.ride.reused,
      // `WR-06` — المجدولُ يُعلَنُ للعميلِ بحالتِه وموعدَيه: «يبدأُ البحثُ في …» لا «نبحثُ الآن».
      status: verdict.ride.status ?? "searching",
      pickupAt: isoOrNull(verdict.ride.pickupAtMs),
      dispatchAt: isoOrNull(verdict.ride.dispatchAtMs),
    });
  });

  /**
   * `WR-09` — السائقُ الذي قبِلَ والراكبُ لم يقرّر. `candidate: null` ⇐ لا مرشَّحَ حيٌّ
   * (لم يقبلْ أحدٌ، أو فاتَ الموعدُ، أو أُسنِدَ الطلب). والباقي بساعةِ الخادم.
   */
  app.get("/v1/rides/:id/candidate", async (c) => {
    if (deps.candidate === undefined) return candidateRejected(c, "RIDE_STORE_NOT_AVAILABLE");
    const result = await readRideCandidate(deps.candidate, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return candidateRejected(c, result.error);
    const { candidate } = result.value;
    return c.json({
      ok: true,
      order_status: result.value.orderStatus,
      server_time: result.value.serverTime,
      candidate:
        candidate === null
          ? null
          : {
              driver_id: candidate.driverId,
              driver_name: candidate.driverName,
              plate: candidate.plate,
              vehicle: candidate.vehicle,
              rating_average: candidate.ratingAverage,
              rating_count: candidate.ratingCount,
              distance_km: candidate.distanceKm,
              expires_at: candidate.expiresAt,
              seconds_left: candidate.secondsLeft,
            },
    });
  });

  /** `WR-09` — قرارُ الراكب: `{ driverId, decision: "accept" | "reject" }`. */
  app.post("/v1/rides/:id/candidate", async (c) => {
    if (deps.candidate === undefined) return candidateRejected(c, "RIDE_STORE_NOT_AVAILABLE");
    const raw = await readBounded(c.req.raw.body, RIDE_CANDIDATE_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }
    const result = await decideRideCandidate(deps.candidate, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
      body,
    });
    if (!result.ok) {
      deps.log?.("rides.candidate_refused", { error: result.error });
      return candidateRejected(c, result.error);
    }
    // بلا معرّفِ الطلب: الحدثُ نفسُه مسجَّلٌ في القاعدةِ بهويّةِ صاحبِه (`order_events`).
    deps.log?.("rides.candidate_decided", {
      decision: result.value.decision,
      duplicate: result.value.duplicate,
    });
    return c.json({
      ok: true,
      decision: result.value.decision,
      duplicate: result.value.duplicate,
      matched_at: result.value.matchedAt,
    });
  });

  /**
   * ADR 0287 — أحداثُ أطوارِ الرحلةِ الدائمةُ لراكبِها (معرّفٌ ثابتٌ وتسلسلٌ).
   * القراءةُ لا تُعدُّ تسليمًا: العميلُ يطبّقُ ثم يُقرُّ في المسارِ التالي.
   */
  app.get("/v1/rides/:id/trip-events", async (c) => {
    if (deps.tripEvents === undefined) return tripEventsRejected(c, "RIDE_STORE_NOT_AVAILABLE");
    const result = await readRiderTripEvents(deps.tripEvents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return tripEventsRejected(c, result.error);
    return c.json({
      ok: true,
      events: result.value.map((e) => ({
        id: e.id,
        event: e.event,
        seq: e.seq,
        created_at: e.createdAt,
        acked: e.acked,
      })),
    });
  });

  /**
   * ADR 0287 — إقرارُ العميلِ **بعدَ تطبيقِ** الأحداثِ: `{ ids: [...] }`. متكرّرُه
   * لا يُنشئُ إيصالًا ثانيًا، وما لا يملكُه صاحبُ الجلسةِ يُهمَلُ.
   */
  app.post("/v1/rides/:id/trip-events/ack", async (c) => {
    if (deps.tripEvents === undefined) return tripEventsRejected(c, "RIDE_STORE_NOT_AVAILABLE");
    const raw = await readBounded(c.req.raw.body, RIDE_CANDIDATE_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }
    const ids =
      body !== null && typeof body === "object" ? (body as Record<string, unknown>).ids : undefined;
    const result = await ackRiderTripEvents(deps.tripEvents, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
      deliveryIds: ids,
    });
    if (!result.ok) return tripEventsRejected(c, result.error);
    return c.json({ ok: true, recorded: result.value.recorded, closed: result.value.closed });
  });

  app.get("/v1/rides/:id/search", async (c) => {
    if (deps.search === undefined) {
      deps.log?.("rides.search_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readRideSearch(deps.search, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const { state, phase, elapsedSeconds } = read.view;
    // الطورُ وحدهُ لغةُ العميلِ (`PD-050` · `IDEA-P`): رايتا المصدرِ
    // (`widerCircleOpened`/`escalated`) تُشتقُّ منهما الطورُ فوقَ ولا تُعبُرُ إلى
    // هنا، وعدّادُ الجولاتِ الداخليُّ (`broadcastRound`) حُجبَ عن الردِّ العامِّ.
    return c.json({
      ok: true,
      found: true as const,
      orderId: state.orderId,
      status: state.status,
      service: state.service,
      phase,
      createdAt: new Date(state.createdAtMs).toISOString(),
      // العددُ يُنشَرُ كما قاسَته القاعدةُ، **والصفرُ يُنشَرُ صفراً** (`ADR 0023`).
      notifiedDriverCount: state.notifiedDriverCount,
      elapsedSeconds,
      cancellableWithoutPenalty: state.cancellableWithoutPenalty,
      // `WR-06` — موعدا المجدول (والبحثُ يبدأُ في `dispatchAt`)؛ `null` لما ليسَ مجدولًا.
      pickupAt: isoOrNull(state.pickupAtMs),
      dispatchAt: isoOrNull(state.dispatchAtMs),
    });
  });

  /**
   * لقطةُ الرحلةِ النشطةِ (`F2-06` · `SR-06`).
   *
   * **ولماذا لا يُنشَرُ موقعُ السائقِ إلّا معَ حكمِه**: الحكمُ (`show`) وسببُ
   * الحجبِ يُنشرانِ، ولا تُنشَرُ إحداثيّةٌ حُجِبَت. ولو نُشِرَت «للاحتياطِ» لَرسمَها
   * عميلٌ مستقبليٌّ يقرأُ الحقلَ ولا يقرأُ الحكمَ — فالحجبُ **في السلكِ** لا في
   * نيّةِ العميلِ.
   *
   * **ولا رقمَ هاتفٍ ولا رمزَ مشاركةٍ ولا زرَّ طوارئَ في هذا الردِّ**: `SR-06`
   * يطلبُها، ومساراتُها `F2-09` و`F2-10`، وحقلٌ فارغٌ لها اليومَ وعدٌ لا عقدٌ.
   */
  app.get("/v1/rides/:id", async (c) => {
    if (deps.active === undefined) {
      deps.log?.("rides.active_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readActiveRide(deps.active, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const { state, phase, position, eta, etaBand, cancelPolicy, elapsedSeconds, observedAtMs } =
      read.view;
    const driver = state.driver;
    return c.json({
      ok: true,
      found: true as const,
      orderId: state.orderId,
      status: state.status,
      service: state.service,
      phase,
      pickup: state.pickup,
      dropoff: state.dropoff,
      createdAt: new Date(state.createdAtMs).toISOString(),
      matchedAt: state.matchedAtMs === null ? null : new Date(state.matchedAtMs).toISOString(),
      startedAt: state.startedAtMs === null ? null : new Date(state.startedAtMs).toISOString(),
      arrivedAt: state.arrivedAtMs === null ? null : new Date(state.arrivedAtMs).toISOString(),
      completedAt:
        state.completedAtMs === null ? null : new Date(state.completedAtMs).toISOString(),
      elapsedSeconds,
      // ADR 0243: لحظةُ القراءةِ بساعةِ الخادم — اللحظةُ نفسُها التي قِيسَ بها `elapsedSeconds`.
      observedAt: new Date(observedAtMs).toISOString(),
      cancelPolicy,
      driver:
        driver === null
          ? null
          : {
              firstName: driver.firstName,
              vehicleType: driver.vehicleType,
              plateNumber: driver.plateNumber,
              // `null` = لا تقييمَ بعدُ، ولا يُستبدَلُ برقمٍ افتراضيٍّ.
              ratingAverage: driver.ratingAverage,
              ratingCount: driver.ratingCount,
            },
      position:
        position === null
          ? null
          : position.show
            ? {
                show: true as const,
                lat: position.position.lat,
                lng: position.position.lng,
                ageSeconds: position.ageSeconds,
              }
            : {
                show: false as const,
                reason: position.reason,
                ageSeconds: position.reason === "TOO_OLD" ? position.ageSeconds : null,
              },
      // المدّةُ حكمٌ مُصنَّفٌ لا رقمٌ عارٍ: `ROUTED` بدقائقِها، أو `UNAVAILABLE`
      // بسببِها — ولا صفرَ ولا شَرطةَ (`ADR 0024`).
      eta:
        eta === null
          ? null
          : eta.kind === "ROUTED"
            ? {
                kind: "ROUTED" as const,
                minutes: eta.minutes,
                source: eta.source,
                // ADR 0243: مدى الخطأِ المرصودِ في المدينة، أو سببُ غيابِه — لا مدىً مفترَض.
                band: etaBand ?? {
                  kind: "UNAVAILABLE" as const,
                  reason: "NOT_CONFIGURED" as const,
                },
              }
            : { kind: "UNAVAILABLE" as const, reason: eta.reason },
    });
  });

  /**
   * ملخَّصُ الرحلةِ المنتهيةِ (`F2-07` · `SR-07`).
   *
   * **والمدّةُ والوترُ يُنشرانِ حكمَينِ مُصنَّفَينِ لا رقمَينِ عاريَينِ**: غيابُ
   * ختمٍ يُنشَرُ `known:false` بسببِه، وغيابُ وجهةٍ يُنشَرُ `NO_DROPOFF` —
   * **ولا صفرَ**: «٠ ثانيةً» تُقرأُ رحلةً لحظيّةً و«٠ متراً» تُقرأُ «لم تتحرَّكْ».
   *
   * **واسمُ الحقلِ `straightLineMeters` في السلكِ نفسِه**: لا أثرَ مسارٍ في
   * المخطَّطِ، فتسميتُه «المسافةَ» شاهدٌ كاذبٌ يُقرأُ في نزاعٍ.
   */
  app.get("/v1/rides/:id/summary", async (c) => {
    if (deps.summary === undefined) {
      deps.log?.("rides.summary_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readRideSummary(deps.summary, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const { state, duration, straightLine, travelledTrace, eligibility } = read.view;
    const driver = state.driver;
    const rider = state.rider;
    return c.json({
      ok: true,
      found: true as const,
      orderId: state.orderId,
      status: state.status,
      service: state.service,
      pickupLabel: state.pickupLabel,
      dropoffLabel: state.dropoffLabel,
      createdAt: new Date(state.createdAtMs).toISOString(),
      matchedAt: state.matchedAtMs === null ? null : new Date(state.matchedAtMs).toISOString(),
      startedAt: state.startedAtMs === null ? null : new Date(state.startedAtMs).toISOString(),
      completedAt:
        state.completedAtMs === null ? null : new Date(state.completedAtMs).toISOString(),
      duration: duration.known
        ? {
            known: true as const,
            totalSeconds: duration.totalSeconds,
            minutes: duration.minutes,
            seconds: duration.seconds,
          }
        : { known: false as const, reason: duration.reason },
      straightLine: straightLine.known
        ? { known: true as const, meters: straightLine.meters }
        : { known: false as const, reason: straightLine.reason },
      // مسافةُ الأثرِ المسجَّلِ — **بجانبِ الوترِ لا بدلاً منهُ** (`ADR 0208` §٧):
      // حقلٌ جديدٌ يُركَّبُ من الدالّةِ الصرفةِ ومنفذِ القراءةِ الضيّقِ، ولا يُمسُّ
      // حقلُ الوترِ ولا جسمُ `completed_ride_summary`. و`asked:false` صدقٌ: رحلةٌ
      // لم تكتملْ لا يُسألُ عنها سؤالُ المسافةِ. وغيرُ المقيسِ سببٌ مُسمّىً لا صفرٌ.
      travelledTrace: travelledTrace.asked
        ? {
            asked: true as const,
            verdict: travelledTrace.verdict,
          }
        : { asked: false as const },
      driver:
        driver === null
          ? null
          : {
              firstName: driver.firstName,
              vehicleType: driver.vehicleType,
              plateNumber: driver.plateNumber,
              // `null` = لا تقييمَ بعدُ، ولا يُستبدَلُ برقمٍ افتراضيٍّ.
              ratingAverage: driver.ratingAverage,
              ratingCount: driver.ratingCount,
            },
      rider:
        rider === null
          ? null
          : {
              firstName: rider.firstName,
              ratingAverage: rider.ratingAverage,
              ratingCount: rider.ratingCount,
            },
      rating: {
        // حكمُ النطاقِ **وحكمُ القاعدةِ** معاً: الأوّلُ يُترجَمُ نصّاً والثاني
        // هوَ المُلزِمُ، وتنافرُهما عطبٌ يُرى في الردِّ لا يُطوى فيه.
        eligibility,
        direction: state.rating.direction,
        canRate: state.rating.canRate,
        alreadyRated: state.rating.alreadyRated,
        windowHours: state.rating.windowHours,
        windowClosed: state.rating.windowClosed,
      },
    });
  });

  /**
   * إرسالُ تقييمِ الراكبِ للسائقِ بوسومٍ (`F2-07` · `SR-08`).
   *
   * **ولا ترويسةَ `Idempotency-Key` ههنا**: القيدُ الفريدُ
   * `ratings_one_per_order_direction` يجعلُ النداءَ الثاني `ALREADY_RATED`
   * حكماً من القاعدةِ — ومفتاحٌ إضافيٌّ يُنشئُ حاجزاً ثانياً يخالفُ الأوّلَ.
   *
   * **ولا يُقرأُ الملخَّصُ قبلَ الكتابةِ** للتحقُّقِ من الأهليّةِ: فحصٌ ثمَّ
   * كتابةٌ **سباقٌ**، والنافذةُ والتكرارُ يُحكَمانِ في العبارةِ نفسِها.
   */
  app.post("/v1/rides/:id/rating", async (c) => {
    if (deps.rating === undefined) {
      deps.log?.("rides.rating_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const declaredLength = Number(c.req.header("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > RIDE_RATING_MAX_BYTES) {
      return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    const raw = await readBounded(c.req.raw.body, RIDE_RATING_MAX_BYTES);
    if (raw === null) return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ ok: false, error: "INVALID_JSON" }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return ratingRejected(c, "MALFORMED");
    }
    const fields = body as Record<string, unknown>;

    const result = await submitRideRating(deps.rating, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
      stars: fields.stars,
      comment: fields.comment,
      tags: fields.tags,
    });
    if (!result.ok) return ratingRejected(c, result.error);

    const verdict = result.value;
    if (!verdict.accepted) {
      return c.json({ ok: true, accepted: false as const, refusal: verdict.refusal });
    }
    return c.json({
      ok: true,
      accepted: true as const,
      ratingId: verdict.rating.ratingId,
      stars: verdict.rating.stars,
      tags: verdict.rating.tags,
    });
  });

  /**
   * سجلُّ رحلاتِ الراكبِ — صفحةٌ بمفتاحٍ (`F2-08` · `SR-09`).
   *
   * **ولا ترقيمَ بصفحاتٍ مرقَّمةٍ** (`?page=3`): سجلٌّ يُضافُ إليه من أعلاه
   * يُزيحُ كلَّ صفحةٍ مرقَّمةٍ عندَ أوّلِ رحلةٍ جديدةٍ، فيُقرأُ صفٌّ مرّتَينِ
   * أو يُقفَزُ عنه. والمفتاحُ (لحظةٌ ومعرِّفٌ) ثابتٌ لا يُزيحُه إدخالٌ.
   *
   * **ونصفُ مفتاحٍ رفضٌ مُعلَنٌ** لا مفتاحٌ يُكمِلُه الخادمُ بافتراضٍ: لحظةٌ بلا
   * معرِّفٍ تُنتِجُ حدّاً غيرَ حاسمٍ بينَ صفَّينِ في الميكروثانيةِ نفسِها.
   */
  app.get("/v1/rides", async (c) => {
    if (deps.history === undefined) {
      deps.log?.("rides.history_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const cursorCreatedAt = c.req.query("cursorCreatedAt");
    const cursorId = c.req.query("cursorId");
    // نصفُ مفتاحٍ يُمرَّرُ **كما هوَ** إلى القاعدةِ فتردَّ `INVALID_CURSOR`:
    // حكمُ المفتاحِ حكمٌ واحدٌ في موضعٍ واحدٍ (القاعدة 0.6).
    const cursor =
      cursorCreatedAt === undefined && cursorId === undefined
        ? null
        : { createdAt: cursorCreatedAt ?? "", id: cursorId ?? "" };

    const result = await readRideHistory(deps.history, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      query: c.req.query("q") ?? null,
      pageSize: c.req.query("pageSize") ?? null,
      cursor,
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.ok) return c.json({ ok: true, accepted: false as const, refusal: read.refusal });

    const { view } = read;
    return c.json({
      ok: true,
      accepted: true as const,
      query: view.query,
      // منطقةُ التصنيفِ ودرجةُ الثقةِ بها تُنشَرانِ: عنوانُ شهرٍ بلا سندِ
      // ساعتِه حكمٌ لا يُراجَعُ.
      monthTimezone: view.monthTimezone,
      monthTimezoneTrust: view.monthTimezoneTrust,
      groups: view.groups.map((group) => ({
        monthKey: group.monthKey,
        rides: group.rides.map((ride) => ({
          orderId: ride.orderId,
          status: ride.status,
          service: ride.service,
          pickupLabel: ride.pickupLabel,
          dropoffLabel: ride.dropoffLabel,
          createdAt: new Date(ride.createdAtMs).toISOString(),
          // `null` = لم تنتهِ. ولا يُستبدَلُ بلحظةِ الإنشاءِ.
          completedAt:
            ride.completedAtMs === null ? null : new Date(ride.completedAtMs).toISOString(),
        })),
      })),
      hasMore: view.hasMore,
      nextCursor:
        view.nextCursor === null
          ? null
          : { createdAt: view.nextCursor.createdAt, id: view.nextCursor.id },
    });
  });

  /**
   * تفاصيلُ رحلةٍ واحدةٍ وسجلُّ أحداثِها (`F2-08` · `SR-10`).
   *
   * **ولا ملكيّةَ تُفحَصُ ههنا**: القاعدةُ تجعلُ الملكيّةَ قيداً في الاستعلامِ،
   * فرحلةُ غيرِك **لا توجدُ** — ولا يُميَّزُ ذاكَ عن العَدَمِ برمزٍ ثانٍ.
   *
   * **ولا إيصالَ ولا مبلغَ ولا زرَّ «مشكلةٌ في هذه الرحلةِ»**: الأوّلانِ
   * مُجمَّدانِ (`ADR 0039` §٤ · `م13-7`)، والثالثُ `F2-12` — غيابٌ مُصرَّحٌ بلا
   * زرٍّ مُعطَّلٍ يَعِدُ بما لا يفي.
   */
  app.get("/v1/rides/:id/detail", async (c) => {
    if (deps.detail === undefined) {
      deps.log?.("rides.detail_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readRideDetail(deps.detail, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const { state, outcome } = read.view;
    const driver = state.driver;
    return c.json({
      ok: true,
      found: true as const,
      orderId: state.orderId,
      status: state.status,
      outcome,
      service: state.service,
      pickupLabel: state.pickupLabel,
      dropoffLabel: state.dropoffLabel,
      cancelledReason: state.cancelledReason,
      driver:
        driver === null
          ? null
          : {
              firstName: driver.firstName,
              vehicleType: driver.vehicleType,
              plateNumber: driver.plateNumber,
              ratingAverage: driver.ratingAverage,
              ratingCount: driver.ratingCount,
            },
      events: state.events.map((event) => ({
        kind: event.kind,
        // النوعُ الخامُّ يُنشَرُ معَ المُصنَّفِ: نوعٌ جديدٌ في القاعدةِ يُرى في
        // الردِّ ولا يُطوى تحتَ `UNKNOWN` بلا أثرٍ.
        rawKind: event.rawKind,
        // `null` = حدثٌ بلا ختمٍ مكتوبٍ. ولا يُستبدَلُ بلحظةِ قراءةٍ.
        at: event.atMs === null ? null : new Date(event.atMs).toISOString(),
        source: event.source,
        detail: event.detail,
      })),
    });
  });

  app.post("/v1/rides/:id/cancel", async (c) => {
    if (deps.cancel === undefined) {
      deps.log?.("rides.cancel_disabled", {});
      return rejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await cancelRideRequest(deps.cancel, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      idempotencyKey: c.req.header(IDEMPOTENCY_HEADER),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return rejected(c, result.error);

    const verdict = result.value;
    if (!verdict.cancelled) {
      return c.json({ ok: true, cancelled: false as const, refusal: verdict.refusal });
    }
    return c.json({ ok: true, cancelled: true as const });
  });

  /**
   * حالُ المشاركةِ (`F2-09` · `SR-13`).
   *
   * **والمعاينةُ تُنشَرُ كما يراها المستلمُ حرفاً**: نفسُ الحكمِ ونفسُ العُمرِ
   * ونفسُ الحدِّ من `tracking_link_view` — فما يقولُه هذا الردُّ للمالكِ هوَ ما
   * ستقولُه الصفحةُ العامّةُ للغريبِ في اللحظةِ نفسِها، ولا موضعَ لحكمَينِ.
   *
   * **ولا رمزَ في الردِّ**: الرمزُ يُعطى مرّةً عندَ الإصدارِ. ولو أُعيدَ في كلِّ
   * قراءةٍ لَصارَ في كلِّ سجلٍّ ولقطةِ شاشةٍ مفتاحاً يفتحُ موقعَ إنسانٍ.
   */
  app.get("/v1/rides/:id/share", async (c) => {
    if (deps.share === undefined) {
      deps.log?.("rides.share_read_disabled", {});
      return shareRejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await readRideShare(deps.share, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return shareRejected(c, result.error);

    const read = result.value;
    if (!read.found) return c.json({ ok: true, found: false as const, refusal: read.refusal });

    const s = read.state;
    return c.json({
      ok: true,
      found: true as const,
      orderId: s.orderId,
      availability: s.availability,
      sharingNow: s.sharingNow,
      // **حكمُ الحياةِ يُنشَرُ كما حكمَته القاعدةُ** (`F12-04`): الشاشةُ تقولُ
      // «حتّى تنتهيَ رحلتُكَ» أو تعدُّ إلى الموعدِ الحقيقيِّ — ولا تعدُّ إلى سقفٍ.
      lifetime: {
        verdict: s.lifetime.verdict,
        secondsRemaining: s.lifetime.verdict === "LIVE_GRACE" ? s.lifetime.secondsRemaining : null,
        graceMinutes: s.lifetime.graceMinutes,
        graceSource: s.lifetime.graceSource,
      },
      soonestCeilingSeconds: s.soonestCeilingSeconds,
      // `null` = الإعدادُ غائبٌ. **ولا رقمَ يُخترَعُ**: جملةٌ بلا رقمٍ أصدقُ من
      // وعدٍ بمدّةٍ لم تقطعْها المنصّةُ.
      maxLifetimeMinutes: s.maxLifetimeMinutes,
      graceMinutes: s.graceMinutes,
      links: s.links.map((link) => ({
        id: link.id,
        createdAt: new Date(link.createdAtMs).toISOString(),
        // **سقفٌ باسمِه** لا موعدَ انتهاءِ المشاركةِ (`F12-04`).
        ceilingSecondsRemaining: link.ceilingSecondsRemaining,
      })),
      preview:
        s.preview.verdict === "LOCATED"
          ? {
              verdict: "LOCATED" as const,
              active: s.preview.active,
              lat: s.preview.position.lat,
              lng: s.preview.position.lng,
              ageSeconds: s.preview.position.ageSeconds,
              maxAgeSeconds: s.preview.maxAgeSeconds,
              maxAgeSource: s.preview.maxAgeSource,
            }
          : {
              verdict: s.preview.verdict,
              active: s.preview.active,
              ageSeconds: s.preview.ageSeconds,
              maxAgeSeconds: s.preview.maxAgeSeconds,
              maxAgeSource: s.preview.maxAgeSource,
            },
      // إفصاحٌ مُرقَّمٌ يُترجَمُ في الواجهةِ — **لا نصَّ تسويقيٍّ** يُكتَبُ مرّةً
      // ثمّ يُنسى حينَ يُضافُ حقلٌ إلى الحمولةِ العامّةِ.
      disclosure: { shown: SHARE_DISCLOSED, hidden: SHARE_WITHHELD },
    });
  });

  /**
   * إصدارُ رابطٍ (`F2-09`). **الرمزُ يُنشَرُ ههنا وههنا وحدَه**، ومعَه الرابطُ
   * كاملاً كي لا يُبنى شكلُه في الواجهةِ مرّةً ثانيةً.
   */
  app.post("/v1/rides/:id/share", async (c) => {
    if (deps.shareStart === undefined) {
      deps.log?.("rides.share_start_disabled", {});
      return shareRejected(c, "SHARING_NOT_CONFIGURED");
    }

    const result = await startRideShare(deps.shareStart, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return shareRejected(c, result.error);

    const outcome = result.value;
    if (!outcome.issued) {
      return c.json({ ok: true, issued: false as const, refusal: outcome.refusal });
    }
    return c.json({
      ok: true,
      issued: true as const,
      url: outcome.link.url,
      expiresAt: outcome.link.expiresAt.toISOString(),
    });
  });

  /**
   * إيقافُ المشاركةِ (`F2-09`) — **كلُّ روابطِ الرحلةِ دفعةً واحدةً**.
   *
   * ويُنشَرُ العددُ لا `true`: «أوقفنا رابطَينِ» غيرُ «لا رابطَ ساري أصلاً»،
   * والفرقُ يراهُ الضاغطُ فلا يظنُّ أنَّ الزرَّ لم يعملْ.
   */
  app.delete("/v1/rides/:id/share", async (c) => {
    if (deps.shareStop === undefined) {
      deps.log?.("rides.share_stop_disabled", {});
      return shareRejected(c, "RIDE_STORE_NOT_AVAILABLE");
    }

    const result = await stopRideShare(deps.shareStop, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("id"),
    });
    if (!result.ok) return shareRejected(c, result.error);
    return c.json({ ok: true, revoked: result.value });
  });

  return app;
}
