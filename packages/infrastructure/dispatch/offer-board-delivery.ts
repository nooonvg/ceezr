/**
 * الغرض: مسارُ لوحِ العروضِ لشوطِ تسليمِ الإشعاراتِ — `LOAD-01 Recovery`
 *   (CAP-RUN-20261016-CONTINUATION · المرحلة 6-استكمال — الجدارُ الثاني).
 *   للسائقِ المتصلِ بالقناةِ الآنيةِ: إيصالٌ موثَّقٌ منَ العميلِ يُغني عنِ
 *   البطاقةِ، وإشارةٌ قصيرةٌ تنتظرُ الإيصالَ دوراتٍ مسقوفةً، ولغيرِ المتصلِ
 *   البطاقةُ كما كانَت. هذا هوَ فصلُ «ضجيجِ العروضِ» عنِ الإشعاراتِ الحرجةِ
 *   منَ الجذرِ: العروضُ تُصرَّفُ منَ اللوحِ والإشارةِ، ودلوُّ الإرسالِ يتنفَّسُ.
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: infrastructure/dispatch
 * يُستخدم من: `apps/workers/src/container.ts` (حقنُ تبعيةِ معالجِ العرضِ).
 *
 * ## قراراتٌ معلنةٌ
 *
 *   ــ **الإيصالُ منَ العميلِ لا منَ الجلبِ**: `findReceipt` يقرأُ جدولَ
 *      إيصالاتِ اللوحِ — العميلُ يُقرُّ بعدَ تطبيقِ اللقطةِ (مسارُ /receipts)،
 *      ففصلُ «أُرسِلَ» عنِ «وَصَلَ» محفوظٌ في القياسِ نفسِهِ.
 *   ــ **فشلُ الإشارةِ ليسَ فشلَ صفٍّ**: مهلةُ النداءِ 2ث، وكلُّ عطلِ شبكةٍ أو
 *      بطءٍ = «لم تُبَثّ» (البطاقةُ تنالُ فرصتها فورًا) لا خطأَ إرسالٍ
 *      يُحسَبُ على المحاولاتِ.
 *   ــ **دمجُ الإشاراتِ (coalescing)**: إشارةٌ واحدةٌ لكلِّ سائقٍ كلَّ ثانيتينِ
 *      كفى — الإشارةُ قولٌ واحدٌ («حدّثْ لوحَك») لا حديثٌ لكلِّ عرضٍ.
 *   ــ **حلُّ الهويةِ مخزونٌ مؤقتًا**: معرّفُ السائقِ الداخليُّ (في الحمولةِ)
 *      يُحلُّ إلى معرّفِ تيليجرامَ (غرفةُ القناةِ) بذاكرةِ خمسِ دقائقٍ —
 *      نداءٌ واحدٌ لكلِّ سائقٍ في الدورةِ لا واحدٌ لكلِّ صفٍّ.
 *   ــ **إخفاءُ السرِّ في السجلِّ**: ما يُسجَّلُ المآلُ والمدةُ لا الترويسةُ.
 */

import type { OfferBoardDelivery } from "../../application/dispatch/deliver-offer-notification.ts";
import { createGuardedFetch } from "../../shared/wasla/egress-gate.ts";
import type { Sql } from "../db/client.ts";

/** مهلةُ نداءِ الإشارةِ: قصيرةٌ كي لا يُعلَّقَ الشوطُ على بوابةٍ بطيئةٍ. */
const SIGNAL_TIMEOUT_MS = 2_000;
/** نافذةُ دمجِ الإشاراتِ لكلِّ سائقٍ: إشارةٌ واحدةٌ تكفي لكلِّ تحديثِ لوحٍ. */
const SIGNAL_COALESCE_MS = 2_000;
/** عمرُ ذاكرةِ حلِّ معرّفِ السائقِ إلى معرّفِ تيليجرامَ. */
const TELEGRAM_CACHE_TTL_MS = 5 * 60 * 1_000;

export interface OfferBoardDeliveryDeps {
  readonly sql: Sql;
  /** غيابُهُ أو غيابُ السرِّ = مسارُ الإشارةِ معطَّلٌ (البطاقةُ كما كانَت). */
  readonly gatewayInternalUrl: string | null;
  readonly secret: string | null;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export function createOfferBoardDelivery(deps: OfferBoardDeliveryDeps): OfferBoardDelivery {
  // كلُّ صادرٍ منَ العمليةِ يمرُّ منَ بوّابةِ الصادرِ المُعلَنةِ (حاجزُ الحدودِ):
  // نداءُ الإشارةِ الداخليُّ مقصدٌ مُعلَنٌ بمعرّفِهِ لا `fetch` عارٍ.
  const guardedFetch = createGuardedFetch("gateway-internal-offers-signal");
  const telegramById = new Map<string, { telegramId: string; at: number }>();
  const lastSignalAt = new Map<string, number>();
  const signalEnabled =
    deps.gatewayInternalUrl !== null && deps.secret !== null && deps.secret.length >= 16;

  async function telegramIdOf(driverId: string): Promise<string | null> {
    const cached = telegramById.get(driverId);
    if (cached !== undefined && Date.now() - cached.at < TELEGRAM_CACHE_TTL_MS) {
      return cached.telegramId;
    }
    try {
      const rows = await deps.sql<{ telegram_id: string }[]>`
        select u.telegram_id::text as telegram_id
        from drivers d join users u on u.id = d.user_id
        where d.id = ${driverId}::uuid`;
      const telegramId = rows[0]?.telegram_id ?? null;
      if (telegramId !== null) {
        telegramById.set(driverId, { telegramId, at: Date.now() });
      }
      return telegramId;
    } catch {
      // حلُّ الهويةِ فشلَ: هذهَ «لم تُبَثّ» لا فشلَ صفٍّ — البطاقةُ تنالُها.
      return null;
    }
  }

  return {
    findReceipt: async (driverId, offerId) => {
      try {
        const rows = await deps.sql<{ received_at: Date }[]>`
          select received_at from driver_offers_board_receipts
          where driver_id = ${driverId}::uuid and offer_id = ${offerId}::uuid`;
        const at = rows[0]?.received_at;
        return at instanceof Date ? at : null;
      } catch {
        // قراءةُ الإيصالِ فشلت: لا يُدَّعى وصولٌ لم يُقَس — البطاقةُ تنالُها.
        return null;
      }
    },
    signalDriver: async (driverId) => {
      if (!signalEnabled) return false;
      const now = Date.now();
      const last = lastSignalAt.get(driverId);
      if (last !== undefined && now - last < SIGNAL_COALESCE_MS) {
        // أُشيرَ لهُ قبلَ ثانيتينِ: إشارةٌ واحدةٌ لكلِّ تحديثِ لوحٍ تكفي.
        return true;
      }
      const telegramId = await telegramIdOf(driverId);
      if (telegramId === null) return false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);
      try {
        const response = await guardedFetch(
          `${deps.gatewayInternalUrl}/internal/realtime/offers-signal`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-internal-secret": deps.secret as string,
            },
            body: JSON.stringify({ telegram_user_id: telegramId }),
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          // رفضٌ معلَنٌ (401/422/503) = «لم تُبَثّ» لا فشلَ صفٍّ.
          deps.log?.("offer_board_signal.rejected", { status: response.status });
          return false;
        }
        const payload = (await response.json().catch(() => null)) as {
          emitted?: boolean;
        } | null;
        const emitted = payload?.emitted === true;
        if (emitted) lastSignalAt.set(driverId, now);
        return emitted;
      } catch {
        // شبكةٌ أو مهلةٌ: «لم تُبَثّ» — البطاقةُ تنالُ فرصتها فورًا.
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
