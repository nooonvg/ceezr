/**
 * الغرض: مساراتُ مَهمّةِ السائقِ النشطةِ — `GET /v1/driver/job` و
 *   `POST /v1/driver/job/:orderId/arrived` و`…/start` و`…/complete`
 *   و`…/cannot-complete` (`F3-03` · `SD-05` · `PD-020`).
 * الحالة: منفَّذٌ فعليّاً — البندانِ `F3-03` و`PD-020`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — الأرباحُ مسارٌ يُضافُ، ولا يُغيَّرُ جوابُ
 *   الإنهاءِ ليحملَ حصيلةً.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md ·
 *   docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * ## لِمَ المعرِّفُ **في المسارِ** لا في الجسمِ
 *
 * لأنَّ الفعلَ فعلٌ على مَورِدٍ بعينِه، والمسارُ يقولُ أيَّ مَورِدٍ. ولأنَّ هذا
 * يُغني عن قراءةِ جسمٍ في `POST` بلا حمولةٍ — وجسمٌ يُقرأُ بلا حاجةٍ سطحٌ يُفحَصُ
 * ويُحَدُّ بلا مقابلٍ. **ومعرِّفُ السائقِ لا يُقرأُ من المسارِ ولا من الجسمِ
 * ألبتّةَ**: من الرمزِ الموقَّعِ وحدَه.
 *
 * ## ولِمَ ثلاثةُ مساراتٍ لا مسارٌ بحقلِ فعلٍ
 *
 * `POST /v1/driver/job {action}` كانت ستجعلَ اسمَ الفعلِ **نصّاً من الشاشةِ**
 * يُوجَّهُ به إلى كاتبٍ في القاعدةِ، ويصيرُ سجلُّ الوصولِ (`access log`) عاجزاً
 * عن التفريقِ بينَ ختمِ وصولٍ وإنهاءِ رحلةٍ. ومسارٌ لكلِّ انتقالٍ **يُقرأُ في
 * السجلِّ وفي حدِّ المعدّلِ وفي التصريحِ** بلا فتحِ حمولةٍ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُفرِّقُ بينَ «لا وجودَ لها» و«ليسَت لكَ»**: `JOB_NOT_FOUND` واحدٌ —
 *      والفرقُ يُعلِمُ المُجرِّبَ بوجودِ مَهمّةٍ لغيرِه.
 *   ــ **لا تُلغي رحلةً**: لا مسارَ إلغاءٍ ههنا — كاتبُه قائمٌ وسياستُه مُجمَّدةٌ
 *      بقرارٍ (`F2-06`).
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا تُسجِّلُ موضعاً ولا ملاحظةَ راكبٍ في السجلِّ**: الرمزُ والحكمُ فحسب.
 *   ــ **لا تُقدِّرُ زمناً**: امتناعٌ مُصنَّفٌ (`ADR 0024`).
 */

import { type Context, Hono } from "hono";
import {
  completeDriverRide,
  type DriverJobDeps,
  type DriverJobPublicErrorCode,
  type DriverJobRejection,
  markDriverArrived,
  readDriverActiveJob,
  startDriverRide,
} from "../../../../packages/application/driver/driver-job.ts";
import {
  type DriverCannotCompleteDeps,
  type DriverCannotCompletePublicErrorCode,
  requestDriverCannotComplete,
} from "../../../../packages/application/safety/driver-cannot-complete.ts";
import { navigationUrlFor, openUrlFor } from "./place-links.ts";

export interface DriverJobRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly job?: DriverJobDeps;
  /**
   * فعلُ «تعذّرَ الإكمالُ» (`PD-020` · الشقُّ `ج`) — **تبعيّةٌ مستقلّةٌ عن مَهمّةِ
   * النقلِ**: بلاغُ سلامةٍ يدخلُ من بابِ المَهمّةِ ويُحفَظُ في بيتِ السلامةِ،
   * فغيابُها يُعطّلُ الفعلَ وحدَهُ لا القراءةَ والأفعالَ الأخرى.
   */
  readonly cannotReport?: DriverCannotCompleteDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<DriverJobPublicErrorCode, 401 | 403 | 404 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  JOB_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  // طلبٌ مفهومٌ وقيمتُه ليسَت معرِّفاً — لا عطبَ خدمةٍ ولا منعَ صلاحيةٍ.
  ORDER_ID_INVALID: 422,
  JOB_NOT_FOUND: 404,
  // تعارُضٌ مع حالةِ المَورِدِ: الطلبُ صحيحٌ والطَورُ لا يسمحُ به.
  PHASE_MISMATCH: 409,
  ALREADY_ARRIVED: 409,
  TRANSITION_REFUSED: 409,
};

function rejected(c: Context, rejection: DriverJobRejection) {
  return c.json({ ok: false, error: rejection.code }, STATUS_BY_ERROR[rejection.code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

function unavailable(code: DriverJobPublicErrorCode): DriverJobRejection {
  return { code };
}

// `LOC-TRUST-01`: الدالّةُ انتقلَت إلى `place-links.ts` (مصدرٌ واحدٌ لروابطِ المكان) —
// وسببُ بنائِها في الخادمِ لا في المصغَّرِ (`F1-10` · `TG-005`) مكتوبٌ هناك.
export { navigationUrlFor };

/**
 * خريطةُ حالاتِ فعلِ «تعذّرَ الإكمالُ» — رموزُ قناةِ السلامةِ لا رموزَ النقلِ:
 * `CITY_NOT_READY` نقصُ تهيئةٍ في مدينةِ المَهمّةِ (لا قروبَ تصعيدٍ) يُقرأُ
 * عطبَ خادمٍ لا رفضًا للسائقِ؛ والبلاغُ المرفوضُ **يُقالُ مرفوضاً في الجوابِ
 * الصحيحِ للسؤالِ الصحيحِ** كما سياستَه في مسارَي سلامةِ الراكبِ.
 */
const CANNOT_COMPLETE_STATUS_BY_ERROR: Readonly<
  Record<DriverCannotCompletePublicErrorCode, 401 | 403 | 404 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  SAFETY_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  ORDER_ID_INVALID: 422,
  JOB_NOT_FOUND: 404,
  ACTOR_BLOCKED: 403,
  CITY_NOT_READY: 503,
  REPORT_REJECTED: 409,
};

function wirePlace(place: {
  latitude: number;
  longitude: number;
  label: string | null;
  link?: string | null;
  notes?: string | null;
}) {
  const link = place.link ?? null;
  return {
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
    // الملاحةُ من النقطةِ دائماً (القيادةُ تحتاجُ إحداثيّة)؛ والرابطُ الأصليُّ يُفتَحُ وحدَه.
    navigation_url: navigationUrlFor(place),
    // `LOC-TRUST-01` — ما أدخلَه الراكبُ: الرابطُ حرفاً، وملاحظاتُ المكان، ورابطُ فتحِه.
    link,
    notes: place.notes ?? null,
    open_url: openUrlFor({ link, latitude: place.latitude, longitude: place.longitude }),
  };
}

export function createDriverJobRoutes(deps: DriverJobRouteDependencies): Hono {
  const app = new Hono();

  /** «مَهمّتي» — `SD-05` كامِلاً: الطَورُ وأختامُه ونقطتا الرحلةِ وراكبٌ بلا هويّةٍ. */
  app.get("/v1/driver/job", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.read_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverActiveJob(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const snapshot = result.value;
    const job = snapshot.job;
    return c.json({
      ok: true,
      // **لحظةُ الخادمِ تُنشَرُ**: كلُّ عُمرٍ يُعرَضُ فرقٌ عنها.
      server_time: snapshot.serverTime,
      // **سياسةُ النبضةِ في الجذرِ** (`F3-04`): تُنشَرُ ولو كانَ `job = null`، إذ
      // سائقٌ متاحٌ بلا مَهمّةٍ يبثُّ أيضاً. **ومُدّةٌ لا ختمُ انتهاءٍ**: العميلُ
      // يُطيعُ رقماً ولا يطرحُ بساعتِه (نفسُ حكمِ `F3-02`).
      location_broadcast: {
        reason: snapshot.locationBroadcast.reason,
        // `null` = **لا تبثَّ** — غيابٌ يُنشَرُ غياباً لا صفراً (`ADR 0023`).
        interval_seconds: snapshot.locationBroadcast.intervalSeconds,
      },
      // **عَدَمٌ صريحٌ** لا كائنٌ فارغٌ: «لا مَهمّةَ» حالٌ تُقالُ لا تُخمَّنُ.
      job:
        job === null
          ? null
          : {
              order_id: job.orderId,
              status: job.status,
              service: job.service,
              next_action: job.nextAction,
              matched_at: job.matchedAt,
              arrived_at: job.arrivedAt,
              started_at: job.startedAt,
              pickup: wirePlace(job.pickup),
              dropoff: job.dropoff === null ? null : wirePlace(job.dropoff),
              notes: job.notes,
              rider: {
                first_name: job.rider.firstName,
                language_code: job.rider.languageCode,
              },
              // `WR-05` — معنى المبلغِ كما كتبَه الراكب (`null` ⇒ لم يُقرَأ أو طلبٌ أقدمُ من السياسة).
              offer_mode: job.offerTerms?.mode ?? null,
              offer_sar: job.offerTerms?.offerSar ?? null,
            },
    });
  });

  /** «وصلتُ» — الطَورُ الذي لم يكن له كاتبٌ، وكاتبُه `driver_mark_arrived`. */
  app.post("/v1/driver/job/:orderId/arrived", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.arrived_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await markDriverArrived(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.arrived_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_job.arrived", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      arrived_at: result.value.arrivedAt,
    });
  });

  /** «بدأتُ الرحلةَ» — تفويضٌ إلى `start_ride` القائمةِ بحرفِها. */
  app.post("/v1/driver/job/:orderId/start", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.start_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await startDriverRide(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.start_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_job.started", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      started_at: result.value.startedAt,
    });
  });

  /** «أنهيتُ» — تفويضٌ إلى `complete_ride` القائمةِ، وهيَ تُعيدُ السائقَ متاحاً. */
  app.post("/v1/driver/job/:orderId/complete", async (c) => {
    if (deps.job === undefined) {
      deps.log?.("driver_job.complete_disabled", {});
      return rejected(c, unavailable("JOB_STORE_NOT_AVAILABLE"));
    }

    const result = await completeDriverRide(deps.job, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.complete_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_job.completed", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      completed_at: result.value.completedAt,
      // المدّةُ **مقيسةٌ في الكاتبِ** — تُنقَلُ ولا تُحسَبُ ههنا.
      duration_seconds: result.value.durationSeconds,
    });
  });

  /**
   * «تعذّرَ الإكمالُ» (`PD-020` · الشقُّ `ج`) — فعلُ السائقِ الذي لا يملكُ
   * فعلاً. **بلاغُ سلامةٍ مرتبطٌ بالمَهمّةِ لا انتقالُ حالةِ رحلةٍ**: لا يُفتَحُ
   * الطلبُ من جديدٍ ولا يُخطَرُ الراكبُ ولا تُمسُّ حالةُ المَهمّةِ — بطاقةٌ تصلُ
   * قروبَ الإسنادِ وقرارُ الإسنادِ يبقى للفريقِ البشريِّ. و`created:false`
   * جوابٌ صحيحٌ لا فشلَ: بلاغُهُ الأوّلُ على المَهمّةِ نفسِها ما يزالُ قائماً.
   */
  app.post("/v1/driver/job/:orderId/cannot-complete", async (c) => {
    if (deps.cannotReport === undefined) {
      deps.log?.("driver_job.cannot_complete_disabled", {});
      return c.json(
        { ok: false, error: "SAFETY_STORE_NOT_AVAILABLE" },
        CANNOT_COMPLETE_STATUS_BY_ERROR.SAFETY_STORE_NOT_AVAILABLE,
      );
    }

    const result = await requestDriverCannotComplete(deps.cannotReport, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
    });
    if (!result.ok) {
      deps.log?.("driver_job.cannot_complete_rejected", { error: result.error });
      return c.json(
        { ok: false, error: result.error },
        CANNOT_COMPLETE_STATUS_BY_ERROR[result.error],
      );
    }

    const outcome = result.value;
    if (!outcome.accepted) {
      // رفضُ الحاكمِ **جوابٌ لا عطبُ طلبٍ**: سائقٌ في لحظةِ عُجزٍ لا يُدرَّبُ على
      // إعادةِ الصياغةِ برمزِ حالةٍ يقودُ إلى إعادةِ المحاولةِ.
      return c.json({ ok: true, accepted: false as const, refusal: outcome.rejection.code });
    }
    deps.log?.("driver_job.cannot_complete", {
      order_id: outcome.orderId,
      incident_id: outcome.incidentId,
      created: outcome.created,
    });
    return c.json({
      ok: true,
      accepted: true as const,
      order_id: outcome.orderId,
      incident_id: outcome.incidentId,
      created: outcome.created,
    });
  });

  return app;
}
