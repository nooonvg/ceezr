/**
 * الغرض: مسارُ الإشارةِ الداخليُّ للوحةِ العروضِ — نداءٌ من شوطِ تسليمِ
 *   الإشعاراتِ (العاملُ) إلى البوابةِ: «هل السائقُ متصلٌ؟ بُثَّتْ لهُ إشارةُ
 *   اللوحِ». `LOAD-01 Recovery` (المرحلة 6-استكمال — الجدارُ الثاني).
 * الحالة: منفَّذٌ فعليّاً — إشارةُ العروضِ كانَ بلا مستدعي (كودٌ ميتٌ).
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/workers/src/jobs/deliver-notifications.ts` عبرَ التبعيةِ.
 *
 * ## ولِمَ سرٌّ مشتركٌ ومهلةٌ قصيرةٌ
 *
 * هذا مسارُ خدمةٍ لخدمةٍ لا مسارَ عميلٍ: لا جلسةَ ولا رمزَ مستخدمٍ — سِرٌّ
 * مشتركٌ بينَ العاملِ والبوابةِ (`INTERNAL_SIGNAL_SECRET`) في ترويسةٍ، ومهلةُ
 * نداءٍ قصيرةٌ عندَ الطالبِ (2ث) كي لا يُعلَّقَ شوطُ التسليمِ على بوابةٍ
 * بطيئةٍ: فشلُ الإشارةِ = «لم تُبَثّ» (بطاقةُ البوتِ تنالُ فرصتها) لا فشلَ
 * صفٍّ. و`emitted: false` للغيرِ متصلٍ — فالانتظارُ للمتصلِ وحدَهُ.
 *
 * ## وما لا يفعلُه هذا المسارُ عن قصدٍ
 *
 *   ــ **لا يُغيّرُ حالةَ عرضٍ ولا صفَّ صادرٍ**: بثُّ إشارةٍ تحديثٍ فحسب.
 *   ــ **لا يقبلَ معرّفَ سائقٍ منَ الجسمِ**: الهويةَ يحلُّها الطالبُ (العاملُ)
 *      من القاعدةِ — هنا معرّفُ تيليجرامَ المستخرَجُ لا يُصدَّقُ منَ الغيبِ.
 *   ــ **لا يُخفّي انقطاعَ القناةِ**: غيابُ السرِّ = `503` معلَنٌ (المسارُ
 *      معطَّلٌ لا مفتوحٌ لكلِّ أحدٍ).
 */
import { Hono } from "hono";

export interface InternalOffersSignalDependencies {
  /** `LOAD-01 Recovery` — فحصُ الاتصالِ وبثُّ الإشارةِ (قناةُ العروضِ). */
  readonly isDriverConnected: (telegramUserId: string) => boolean;
  readonly notifyDriver: (telegramUserId: string) => void;
  /** السرُّ المشتركُ — غيابُه يعطّلُ المسارَ (503) لا يفتحُه لكلِّ أحدٍ. */
  readonly secret: string | null;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /** ADR 0287 — غرفةُ أحداثِ رحلةِ الراكبِ؛ غيابُها = المسارُ غيرُ مُركَّبٍ. */
  readonly rider?: {
    readonly isRiderConnected: (telegramUserId: string) => boolean;
    readonly notifyRider: (telegramUserId: string, orderId: string) => void;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInternalOffersSignalRoutes(deps: InternalOffersSignalDependencies) {
  const app = new Hono();

  app.post("/internal/realtime/offers-signal", async (c) => {
    if (deps.secret === null || deps.secret.length < 16) {
      deps.log?.("internal_offers_signal.disabled", {});
      return c.json({ ok: false, error: "INTERNAL_SIGNAL_NOT_CONFIGURED" }, 503);
    }
    const provided = c.req.header("x-internal-secret") ?? "";
    // مقارنةٌ ثابتةُ الزمنِ: السرُّ لا يُتَسَرَّبُ بتوقيتِ المقارنةِ.
    if (provided.length !== deps.secret.length || !timingSafeEqual(provided, deps.secret)) {
      deps.log?.("internal_offers_signal.rejected", {});
      return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
    }

    const body = await c.req.json().catch(() => null);
    const telegramUserId = (body as Record<string, unknown> | null)?.telegram_user_id;
    if (typeof telegramUserId !== "string" || !/^\d{1,20}$/.test(telegramUserId)) {
      return c.json({ ok: false, error: "TELEGRAM_USER_ID_INVALID" }, 422);
    }

    const connected = deps.isDriverConnected(telegramUserId);
    if (!connected) return c.json({ ok: true, emitted: false });
    deps.notifyDriver(telegramUserId);
    return c.json({ ok: true, emitted: true });
  });

  /**
   * ADR 0287 — «هل الراكبُ متصلٌ؟ بُثَّ لهُ `trip:update`». الجوابُ `emitted`
   * يعني أنَّ في الغرفةِ عميلًا لحظةَ البثِّ — لا أنَّ الحدثَ وصلَ: الوصولُ
   * بالإقرارِ وحدَه.
   */
  const rider = deps.rider;
  if (rider !== undefined) {
    app.post("/internal/realtime/rider-trip-signal", async (c) => {
      if (deps.secret === null || deps.secret.length < 16) {
        deps.log?.("internal_rider_trip_signal.disabled", {});
        return c.json({ ok: false, error: "INTERNAL_SIGNAL_NOT_CONFIGURED" }, 503);
      }
      const provided = c.req.header("x-internal-secret") ?? "";
      if (provided.length !== deps.secret.length || !timingSafeEqual(provided, deps.secret)) {
        deps.log?.("internal_rider_trip_signal.rejected", {});
        return c.json({ ok: false, error: "UNAUTHORIZED" }, 401);
      }
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      const telegramUserId = body?.telegram_user_id;
      const orderId = body?.order_id;
      if (typeof telegramUserId !== "string" || !/^\d{1,20}$/.test(telegramUserId)) {
        return c.json({ ok: false, error: "TELEGRAM_USER_ID_INVALID" }, 422);
      }
      if (typeof orderId !== "string" || !UUID_RE.test(orderId)) {
        return c.json({ ok: false, error: "ORDER_ID_INVALID" }, 422);
      }
      if (!rider.isRiderConnected(telegramUserId)) return c.json({ ok: true, emitted: false });
      rider.notifyRider(telegramUserId, orderId);
      return c.json({ ok: true, emitted: true });
    });
  }

  return app;
}

/** مقارنةٌ ثابتةُ الزمنِ — لا تتسربُ بالتوقيتِ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
