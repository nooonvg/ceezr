/**
 * الغرض: مسارُ التوصيلِ — `POST /v1/deliveries` ينشئ طلبَ توصيلٍ بتحقُّقٍ خاصٍّ
 *   بالتوصيل: وصفُ الطردِ إلزاميٌّ (٣–٢٠٠ حرفٍ، لا أمرَ بوت)، والوجهةُ إلزاميّةٌ.
 *   ثمَّ يُفوِّضُ الإنشاءَ إلى `requestRide` القائمِ بـ`service: "delivery"` و`notes` =
 *   وصفِ الطرد — فلا تكرارَ لمنطقِ الإنشاءِ ولا لمنطقِ الإلغاءِ ولا لمنطقِ البحثِ.
 * الحالة: منفَّذٌ — إكمالُ مسارِ التوصيلِ end-to-end عبر طبقاتِ API + domain.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ، وشاشةُ البحثِ
 *   في `apps/miniapp` حينَ يختار الراكبُ خدمةَ التوصيل.
 * يُتوقَّع أن يستخدمه لاحقاً: شاشةُ تتبُّعِ التوصيلِ إنِ اختلفت عن مسارِ الرحلة.
 *
 * ## لماذا مسارٌ منفصلٌ لا تعديلُ `POST /v1/rides`
 *
 * لأنَّ عقدَ `POST /v1/rides` `[x]` منذ `F2-05` وحاجزُه `check-ride-request-contract.ts`
 * يحرسُه. ووصفُ الطردِ ليس حقلاً في عقدِ الرحلة — وإنَّما حقلاً في عقدِ التوصيل.
 * فإضافته إلى `POST /v1/rides` تغيُّرٌ لعقدٍ مغلقٍ، وإنشاءُ مسارٍ منفصلٍ احترامٌ له.
 *
 * ## ولماذا التحقُّقُ هنا لا في `requestRide`
 *
 * لأنَّ `requestRide` دالّةٌ عامّةٌ لكلِّ خدمة، ووصفُ الطردِ خاصٌّ بالتوصيل.
 * والتحقُّقُ هنا يُبقي `requestRide` نظيفةً ولا يُحمِّلها معرفةً بفرعِ التوصيل.
 * والتحقُّقُ يستعملُ `parseParcelDescription` من طبقةِ النطاقِ لا منطقاً مكرَّراً.
 *
 * ## وما لا يفعله هذا المسارُ عن قصدٍ
 *
 *   ــ **لا يُنشئُ منطقَ إنشاءٍ مستقلاً**: يُفوِّضُ إلى `requestRide` القائم.
 *   ــ **لا يُضيفُ حقلاً ماليّاً**: لا أجرةَ ولا وسيلةَ دفعٍ (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يُغيِّرُ عقدَ `POST /v1/rides`**: مسارٌ منفصلٌ بعقدِه الخاص.
 *   ــ **لا يُسعِّرُ التوصيل**: التسعيرُ محجوبٌ بـ`DEC-11`/`F12-16`.
 */
import { type Context, Hono } from "hono";
import {
  type RequestRideDeps,
  type RequestRidePublicErrorCode,
  requestRide,
} from "../../../../packages/application/transport/request-ride.ts";
import { parseParcelDescription } from "../../../../packages/domain/delivery/value-objects.ts";
import { readPlacePoint } from "../../../../packages/domain/places/place-kinds.ts";
import { bearerTokenFrom } from "./me.ts";
import { IDEMPOTENCY_HEADER, RIDE_REQUEST_MAX_BYTES } from "./rides.ts";
import { readBounded } from "./telegram-webhook.ts";

/** رموزُ الأخطاءِ الخاصّةِ بالتوصيلِ — تُضافُ إلى رموزِ `requestRide` العامّة. */
export type DeliveryCreateErrorCode = RequestRidePublicErrorCode | "DROPOFF_REQUIRED";

// biome-ignore format: keep on single line for STATUS_MAP_OPENS check
const STATUS_BY_ERROR: Readonly<Record<DeliveryCreateErrorCode, 400 | 401 | 403 | 404 | 409 | 413 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_INVALID: 401,
  SESSION_EXPIRED: 401,
  SESSION_NOT_AVAILABLE: 503,
  MALFORMED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  UNKNOWN_SERVICE: 400,
  NOTES_TOO_LONG: 400,
  PLACE_INVALID: 400,
  PLACE_LINK_UNSUPPORTED: 400,
  PLACE_NOTES_TOO_LONG: 400,
  PLACE_POINT_UNRELIABLE: 400,
  ACCOUNT_NOT_FOUND: 404,
  RIDER_NOT_REGISTERED: 403,
  RIDE_STORE_NOT_AVAILABLE: 503,
  PARCEL_DESCRIPTION_INVALID: 400,
  // `WR-05` — سياسةُ المبلغ: عطبُ طلبٍ يُصلِحُه الراكب.
  OFFER_MODE_INVALID: 400,
  OFFER_AMOUNT_REQUIRED: 400,
  OFFER_AMOUNT_INVALID: 400,
  OFFER_AMOUNT_UNEXPECTED: 400,
  // `WR-06` — وقتُ حضورٍ لا يُقرأ أو خارجَ نافذتِه.
  PICKUP_AT_INVALID: 400,
  DROPOFF_REQUIRED: 400,
};

function rejected(c: Context, error: DeliveryCreateErrorCode) {
  return c.json({ ok: false, error }, STATUS_BY_ERROR[error]);
}

export interface DeliveryRouteDependencies {
  readonly request: RequestRideDeps | undefined;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** `WR-06` — لحظةٌ اختياريّةٌ إلى ISO؛ الغيابُ `null` صريحًا لا حقلٌ محذوف. */
function isoOrNull(ms: number | null | undefined): string | null {
  return ms === null || ms === undefined ? null : new Date(ms).toISOString();
}

export function createDeliveryRoutes(deps: DeliveryRouteDependencies): Hono {
  const app = new Hono();

  app.post("/v1/deliveries", async (c) => {
    if (deps.request === undefined) {
      deps.log?.("deliveries.create_disabled", {});
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
      return rejected(c, "MALFORMED");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return rejected(c, "MALFORMED");
    }
    const fields = body as Record<string, unknown>;

    // `ORDER-TERMS-01` — نوعُ الطردِ **اختياريٌّ** بطلبِ المالكِ (2026-10-03): يكتبُه الراكبُ أو
    // يتركُه، والبطاقةُ تقولُ «لم يُحدَّد». وما كُتِبَ يُحاكَمُ بعقدِه كما كان.
    const parcelRaw = typeof fields.parcelDescription === "string" ? fields.parcelDescription : "";
    let parcelNotes: string | null = null;
    if (parcelRaw.trim() !== "") {
      const parcel = parseParcelDescription(parcelRaw);
      if (!parcel.ok) {
        return rejected(c, "PARCEL_DESCRIPTION_INVALID");
      }
      parcelNotes = parcel.value;
    }

    // الوجهةُ إلزاميّةٌ في التوصيل — لا يجوزُ أن تكونَ null.
    const destination = readPlacePoint(fields.destinationLat, fields.destinationLng);
    if (destination === null) {
      return rejected(c, "DROPOFF_REQUIRED");
    }

    // الإحداثيّتان الأصليةُ إلزاميّتان — كما في `POST /v1/rides`.
    const origin = readPlacePoint(fields.originLat, fields.originLng);
    if (origin === null) {
      return rejected(c, "MALFORMED");
    }

    // التفويضُ إلى `requestRide` القائمِ — بلا تكرارٍ لمنطقِ الإنشاء.
    // `service` ثابتةٌ `"delivery"` — لا يقبلها العميلُ متغيّرة.
    const result = await requestRide(deps.request, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      idempotencyKey: c.req.header(IDEMPOTENCY_HEADER),
      body: {
        service: "delivery",
        originLat: fields.originLat,
        originLng: fields.originLng,
        destinationLat: fields.destinationLat,
        destinationLng: fields.destinationLng,
        notes: parcelNotes,
        // كانت تُسقَطُ فيرى السائقُ «مكانٌ غيرُ مسمّى» في كلِّ توصيلٍ.
        pickupLabel: fields.pickupLabel,
        destinationLabel: fields.destinationLabel,
        pickupAt: fields.pickupAt,
        offerSar: fields.offerSar,
        offerMode: fields.offerMode,
        // `LOC-TRUST-01` — مكانا الطردِ بعقدِ النقلِ نفسِه (رابطٌ وملاحظاتٌ ومصدر).
        pickupPlace: fields.pickupPlace,
        dropoffPlace: fields.dropoffPlace,
      },
    });
    if (!result.ok) return rejected(c, result.error);

    const verdict = result.value;
    if (!verdict.accepted) {
      return c.json({
        ok: true,
        accepted: false as const,
        refusal: verdict.refusal,
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

  return app;
}
