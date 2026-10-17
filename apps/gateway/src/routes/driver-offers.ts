/**
 * الغرض: مساراتُ عروضِ السائقِ — `GET /v1/driver/offers` و
 *   `GET /v1/driver/offers/:offerId` و`POST …/accept` و`POST …/reject` و
 *   `POST /v1/driver/availability` (`F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — «رحلتي النشطةُ» مسارٌ يُضافُ، ولا يُغيَّرُ
 *   جوابُ القبولِ ليحملَ حالةَ رحلةٍ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ القبولُ `POST` على مَورِدِ العرضِ ولا `PATCH` على الطلبِ
 *
 * لأنَّ السائقَ **لا يملكُ الطلبَ**: يملكُ عرضاً وُجِّهَ إليه بمعرِّفِه، وحقُّه
 * فعلٌ عليه. و`PATCH /orders/:id` يُوهِمُ أنَّ للسائقِ سلطاناً على صفِّ الطلبِ،
 * وهيَ سلطةٌ لا يملكُها إلّا `claim_ride` بشرطِها.
 *
 * ## ولِمَ مسارُ العرضِ الواحدِ **لا يُعيدُ هويّةَ الراكبِ**
 *
 * عرضٌ **مُحتَملٌ** لا يُبرِّرُ كشفَ راكبٍ: لو رأى كلُّ سائقٍ في الجولةِ اسمَ
 * الراكبِ ومعرِّفَه لَصارَ البثُّ **تسريباً موزّعاً**. فما يُعادُ موضعٌ وملاحظةٌ
 * وقياساتٌ، والتواصلُ بعدَ المطابقةِ بندٌ آخرُ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ معرّفَ سائقٍ من الطلبِ**: من الرمزِ الموقَّعِ وحدَه — ومعرِّفٌ
 *      في الجسمِ أو في ترويسةٍ **لا يُقرأُ ألبتّةَ**.
 *   ــ **لا تحكمُ على انتهاءِ المهلةِ**: تنقلُ ثوانِ الخادمِ وحكمَه.
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا تفتحُ بثّاً ولا تُغلِقُ جولةً**: البثُّ عملُ الموزِّعِ.
 *   ــ **لا تُسجِّلُ ملاحظةَ راكبٍ ولا موضعاً في السجلِّ**: الرمزُ والحكمُ فحسب.
 */

import { type Context, Hono } from "hono";
import {
  acceptDriverOffer,
  type DriverOfferDeps,
  type DriverOfferPublicErrorCode,
  type DriverOfferRejection,
  readDriverOfferBoard,
  readDriverOfferDetail,
  recordDriverOfferBoardReceipts,
  rejectDriverOffer,
  setDriverAvailability,
} from "../../../../packages/application/driver/driver-offers.ts";
import type { DriverOfferPlace } from "../../../../packages/domain/driver/driver-offers.ts";
import { openUrlFor } from "./place-links.ts";

export interface DriverOfferRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly offers?: DriverOfferDeps;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<DriverOfferPublicErrorCode, 401 | 403 | 404 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  OFFER_STORE_NOT_AVAILABLE: 503,
  AVAILABILITY_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  // طلبٌ مفهومٌ وقيمتُه ليسَت معرِّفاً — لا عطبَ خدمةٍ ولا منعَ صلاحيةٍ.
  OFFER_ID_INVALID: 422,
  AVAILABILITY_INVALID: 422,
  // **لا يُفرَّقُ بينَ «لا وجودَ له» و«ليسَ لكَ»**: الفرقُ يُعلِمُ المُهاجِمَ
  // بوجودِ عرضٍ لغيرِه، وهوَ ما لا يحتاجُه صاحبُ الحقِّ ليعملَ.
  OFFER_NOT_FOUND: 404,
  // تعارُضٌ مع حالةِ المَورِدِ: الطلبُ صحيحٌ والحالةُ لا تسمحُ به.
  OFFER_ALREADY_ANSWERED: 409,
  OFFER_EXPIRED: 409,
  OFFER_TAKEN: 409,
  ORDER_HELD: 409,
  CITY_MISMATCH: 409,
  CLAIM_REFUSED: 409,
  DRIVER_HAS_ACTIVE_ORDER: 409,
};

function rejected(c: Context, rejection: DriverOfferRejection) {
  return c.json({ ok: false, error: rejection.code }, STATUS_BY_ERROR[rejection.code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** حدُّ سلامةٍ لجسمِ الطلبِ — حقلٌ منطقيٌّ واحدٌ يكفيهِ هذا. */
const MAX_BODY_BYTES = 512;

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

function unavailable(code: DriverOfferPublicErrorCode): DriverOfferRejection {
  return { code };
}

/**
 * `LOC-TRUST-01` — المكانُ كما يراه السائق: الاسمُ والنقطةُ كما كانا، والرابطُ الأصليُّ
 * حرفاً، وملاحظاتُ المكان، ورابطُ الفتحِ (الأصليُّ إن صلحَ وإلّا من النقطة).
 */
function wireOfferPlace(place: DriverOfferPlace) {
  const link = place.link ?? null;
  return {
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
    link,
    notes: place.notes ?? null,
    open_url: openUrlFor({ link, latitude: place.latitude, longitude: place.longitude }),
  };
}

export function createDriverOfferRoutes(deps: DriverOfferRouteDependencies): Hono {
  const app = new Hono();

  /** «عروضي» — `SD-03` كامِلاً: مؤقّتٌ ومسافاتٌ وحالةُ توفُّرٍ وسببُ حجبٍ. */
  app.get("/v1/driver/offers", async (c) => {
    if (deps.offers === undefined) {
      deps.log?.("driver_offers.board_disabled", {});
      return rejected(c, unavailable("OFFER_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverOfferBoard(deps.offers, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
    });
    if (!result.ok) return rejected(c, result.error);

    const board = result.value;
    return c.json({
      ok: true,
      // **لحظةُ الخادمِ تُنشَرُ** كي يكونَ العدُّ التنازليُّ فرقاً لا مقارنةً.
      server_time: board.serverTime,
      is_available: board.isAvailable,
      availability_changed_at: board.availabilityChangedAt,
      is_blocked: board.isBlocked,
      block_reasons: board.blockReasons,
      // `WR-11`: لِمَ لا يصلُ المتوفّرَ عرضٌ وإن لم يُحجَب (التوثيقُ والموضعُ وقِدَمُه).
      eligibility_reasons: board.eligibilityReasons ?? [],
      offers: board.offers.map((offer) => ({
        offer_id: offer.offerId,
        order_id: offer.orderId,
        round: offer.round,
        service: offer.service,
        seconds_left: offer.secondsLeft,
        rider_distance: offer.riderDistance,
        trip_distance: offer.tripDistance,
        pickup_label: offer.pickupLabel,
        dropoff_label: offer.dropoffLabel,
        // `LOC-TRUST-01` — ما أدخلَه الراكبُ عن المكانَين، ورابطُ الفتحِ مبنيّاً في الخادم.
        pickup_notes: offer.pickupExtras?.notes ?? null,
        pickup_link: offer.pickupExtras?.link ?? null,
        pickup_open_url: offer.pickupExtras === undefined ? null : openUrlFor(offer.pickupExtras),
        dropoff_notes: offer.dropoffExtras?.notes ?? null,
        dropoff_link: offer.dropoffExtras?.link ?? null,
        dropoff_open_url:
          offer.dropoffExtras === undefined || offer.dropoffExtras === null
            ? null
            : openUrlFor(offer.dropoffExtras),
        // `WR-05` — معنى المبلغِ كما كتبَه الراكب (`null` ⇒ لم يُقرَأ أو طلبٌ أقدمُ من السياسة).
        offer_mode: offer.offerTerms?.mode ?? null,
        offer_sar: offer.offerTerms?.offerSar ?? null,
        // `WR-06`: وقتُ الحضورِ على بطاقةِ التطبيقِ كما على رسالةِ البوت.
        pickup_at: offer.offerTerms?.pickupAt ?? null,
      })),
    });
  });

  /**
   * `LOAD-01 Recovery` — إيصالاتُ اللوحِ: إقرارُ العميلِ بأنَّهُ طبّقَ لقطةً
   * فيها هذهِ العروضُ. **جلبُ اللوحِ (GET) لا يُسجِّلُ إيصالًا**: الإيصالُ
   * إقرارٌ لاحقٌ منَ العميلِ — فصلُ «سلّمها الخادمُ» عنِ «وصلَتْ».
   */
  app.post("/v1/driver/offers/receipts", async (c) => {
    if (deps.offers === undefined) {
      deps.log?.("driver_offers.board_disabled", {});
      return rejected(c, unavailable("OFFER_STORE_NOT_AVAILABLE"));
    }

    const body = await c.req.json().catch(() => null);
    const offerIds = Array.isArray((body as Record<string, unknown> | null)?.offer_ids)
      ? ((body as { offer_ids: unknown }).offer_ids as unknown[])
          .filter((id): id is string => typeof id === "string")
          .slice(0, 50)
      : [];
    const result = await recordDriverOfferBoardReceipts(deps.offers, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      offerIds,
    });
    if (!result.ok) return rejected(c, result.error);
    return c.json({ ok: true, recorded: result.value.recorded });
  });

  /** «تفاصيلُ عرضٍ» — `SD-04`: موضعانِ وملاحظةٌ وقياساتٌ ومؤقّتٌ. */
  app.get("/v1/driver/offers/:offerId", async (c) => {
    if (deps.offers === undefined) {
      deps.log?.("driver_offers.detail_disabled", {});
      return rejected(c, unavailable("OFFER_STORE_NOT_AVAILABLE"));
    }

    const result = await readDriverOfferDetail(deps.offers, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      offerId: c.req.param("offerId"),
    });
    if (!result.ok) return rejected(c, result.error);

    const detail = result.value;
    return c.json({
      ok: true,
      server_time: detail.serverTime,
      offer_id: detail.offerId,
      order_id: detail.orderId,
      round: detail.round,
      service: detail.service,
      offer_status: detail.offerStatus,
      order_status: detail.orderStatus,
      seconds_left: detail.secondsLeft,
      is_claimable: detail.isClaimable,
      pickup: wireOfferPlace(detail.pickup),
      dropoff: detail.dropoff === null ? null : wireOfferPlace(detail.dropoff),
      rider_distance: detail.riderDistance,
      trip_distance: detail.tripDistance,
      notes: detail.notes,
      // `WR-05` — معنى المبلغِ كما كتبَه الراكب (`null` ⇒ لم يُقرَأ أو طلبٌ أقدمُ من السياسة).
      offer_mode: detail.offerTerms?.mode ?? null,
      offer_sar: detail.offerTerms?.offerSar ?? null,
      pickup_at: detail.offerTerms?.pickupAt ?? null,
    });
  });

  /** «اقبَلْ» — الفعلُ الذرّيُّ، وذرّيّتُه في `claim_ride` لا ههنا. */
  app.post("/v1/driver/offers/:offerId/accept", async (c) => {
    if (deps.offers === undefined) {
      deps.log?.("driver_offers.accept_disabled", {});
      return rejected(c, unavailable("OFFER_STORE_NOT_AVAILABLE"));
    }

    const result = await acceptDriverOffer(deps.offers, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      offerId: c.req.param("offerId"),
    });
    if (!result.ok) {
      deps.log?.("driver_offers.accept_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_offers.accepted", { order_id: result.value.orderId });
    return c.json({
      ok: true,
      order_id: result.value.orderId,
      matched_at: result.value.matchedAt,
      // `WR-09` — `true` ⇒ الطلبُ محجوزٌ والراكبُ يقرّر؛ والباقي بساعةِ الخادم.
      pending_rider: result.value.pendingRider === true,
      seconds_left: result.value.pendingRider === true ? (result.value.secondsLeft ?? 0) : null,
    });
  });

  /** «ارفُضْ» — يُخرِجُ السائقَ من الجولةِ القادمةِ بلا انتظارِ المهلةِ. */
  app.post("/v1/driver/offers/:offerId/reject", async (c) => {
    if (deps.offers === undefined) {
      deps.log?.("driver_offers.reject_disabled", {});
      return rejected(c, unavailable("OFFER_STORE_NOT_AVAILABLE"));
    }

    const result = await rejectDriverOffer(deps.offers, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      offerId: c.req.param("offerId"),
    });
    if (!result.ok) {
      deps.log?.("driver_offers.reject_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    return c.json({ ok: true, offer_id: result.value.offerId });
  });

  /** «متاحٌ / غيرُ متاحٍ» — مبدّلُ `SD-03`، وكاتبُه `record_attendance`. */
  app.post("/v1/driver/availability", async (c) => {
    if (deps.offers === undefined) {
      deps.log?.("driver_offers.availability_disabled", {});
      return rejected(c, unavailable("AVAILABILITY_NOT_AVAILABLE"));
    }

    const body = await readJsonBody(c);
    const result = await setDriverAvailability(deps.offers, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      isAvailable: body?.is_available,
    });
    if (!result.ok) {
      deps.log?.("driver_offers.availability_rejected", { error: result.error.code });
      return rejected(c, result.error);
    }

    deps.log?.("driver_offers.availability_set", { is_available: result.value.isAvailable });
    return c.json({ ok: true, is_available: result.value.isAvailable });
  });

  return app;
}
