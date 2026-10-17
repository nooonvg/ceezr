/**
 * الغرض: معالجُ نوعِ «offer» في صندوقِ الصادرِ الموحَّدِ (BUG-004): يقرأُ حمولةَ
 *   الصفِّ الملتقَطِ — وهي بياناتُ العرضِ كما قُرئت حيّةً لحظةَ الالتقاطِ من
 *   order_offers لا نسخةً مخزَّنةً — فإن كان العرضُ ميّتًا (غيرَ pending أو
 *   منتهيًا أو محذوفًا) تخلّى عنه (dead) لا يُعادُ أبدًا، وإن كان حيًّا نشرَه
 *   وأعادَ معرّفَ الرسالةِ أو سببَ الفشلِ. البنيةُ (الالتقاطُ والإتمامُ والتخلّي)
 *   في deliver-notification العامِّ لا هنا.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: مهلةُ العرضِ تُقرأُ من الحمولةِ الحيّةِ لا من إعدادٍ ثانٍ.
 *   `WR-07` (2026-10-12): كلُّ مآلٍ يُسجَّلُ بسببِه — `offer_notice.abandoned`
 *   (العرضُ لم يَعُد حيًّا) و`attempted` و`accepted` (قبولُ Telegram API لا ظهورُ
 *   البطاقةِ على الهاتف) و`undeliverable` و`send_failed`/`final_failure` — بمعرّفي
 *   العرضِ والطلبِ وحدهما، بلا معرّفِ تيليجرام ولا نصّ.
 */
import type { DistanceKm } from "../../domain/geo/value-objects.ts";
import type { DriverId, OfferId, OrderId } from "../../shared/kernel/index.ts";
import { ok } from "../../shared/result/index.ts";
import type { NotificationHandler } from "../notification/deliver-notification.ts";
import type { OfferNotification, OfferPublisher } from "./broadcast-offers.ts";

const MS_PER_SECOND = 1000;

/** حمولةُ نوعِ العرضِ كما يبنيها claim_notification_delivery حيًّا. */
interface OfferPayload {
  readonly offerId: OfferId;
  readonly orderId: OrderId;
  readonly driverId: DriverId;
  readonly distanceKm: string;
  readonly expiresAt: string;
  readonly offerStatus: string;
  /** PD-051: بياناتُ الطلبِ الموجودةُ مسبقًا — إعادةُ ترتيبٍ لا بياناتٍ جديدة. */
  readonly service: string | null;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly notes: string | null;
}

function readOfferPayload(payload: Readonly<Record<string, unknown>>): OfferPayload | null {
  const offerId = payload.offer_id;
  const orderId = payload.order_id;
  const driverId = payload.driver_id;
  const distanceKm = payload.distance_km;
  const expiresAt = payload.expires_at;
  const offerStatus = payload.offer_status;
  if (
    typeof offerId !== "string" ||
    typeof orderId !== "string" ||
    typeof driverId !== "string" ||
    typeof distanceKm !== "string" ||
    typeof expiresAt !== "string" ||
    typeof offerStatus !== "string"
  ) {
    return null;
  }
  // PD-051: حقولُ الطلبِ قد تكونُ null في الحمولاتِ القديمةِ (قبلَ الإثراء).
  const service = payload.service;
  const pickupLabel = payload.pickup_label;
  const dropoffLabel = payload.dropoff_label;
  const notes = payload.notes;
  return {
    offerId: offerId as OfferId,
    orderId: orderId as OrderId,
    driverId: driverId as DriverId,
    distanceKm,
    expiresAt,
    offerStatus,
    service: typeof service === "string" ? service : null,
    pickupLabel: typeof pickupLabel === "string" ? pickupLabel : null,
    dropoffLabel: typeof dropoffLabel === "string" ? dropoffLabel : null,
    notes: typeof notes === "string" ? notes : null,
  };
}

function offerExpired(expiresAt: string, now: Date): boolean {
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) || ms <= now.getTime();
}

/** سجلُّ مآلاتِ إشعارِ العرضِ (`WR-07`). اختياريٌّ كي لا تنكسرَ المستدعياتُ القديمة. */
export type OfferNoticeLog = (event: string, meta: Record<string, unknown>) => void;

/** سببُ التخلّي المُسمّى: يفرّقُ «لم يَعُد حيًّا» عن «حمولةٌ تالفة». */
function offerAbandonReason(offer: OfferPayload | null, now: Date): string | null {
  if (offer === null) return "PAYLOAD_INVALID";
  if (offer.offerStatus !== "pending") return `OFFER_${offer.offerStatus.toUpperCase()}`;
  if (offerExpired(offer.expiresAt, now)) return "OFFER_EXPIRED";
  return null;
}

/**
 * `LOAD-01 Recovery` — مسارُ لوحِ العروضِ للسائقِ المتصلِ: الإيصالُ حقيقةً
 * (منَ العميلِ الموثّقِ لا من جلبٍ صمّاءَ)، والإشارةُ للمتصلِ فقط، والبطاقةُ
 * البديلُ لغيرِ المتصلِ أو من استنفدَ انتظارَه.
 */
export interface OfferBoardDelivery {
  /**
   * إيصالُ وصولِ العرضِ إلى لوحِ السائقِ — يُرسِلُه العميلُ بعدَ تطبيقِ لقطةِ
   * اللوحِ (لا يكفي جلبُها)، فيُعلَنُ التسليمُ بالإيصالِ القائمِ لا بادعاءِ
   * إرسالٍ. `null` = لا إيصالَ بعدُ.
   */
  readonly findReceipt: (driverId: string, offerId: string) => Promise<Date | null>;
  /**
   * إشارةُ السائقِ المتصلِ عبرَ القناةِ الآنيةِ: `true` إن بُثّت لسائقٍ في
   * غرفةِ العروضِ. فشلُ الشبكةِ أو المهلةُ = `false` (لم تُبَثّ) لا فشلَ صفٍّ —
   * فالبطاقةُ البديلةُ تنالُ فرصتها فورًا.
   */
  readonly signalDriver: (driverId: string) => Promise<boolean>;
}

/**
 * سقفُ دوراتِ انتظارِ إشارةِ اللوحِ قبلَ بطاقةِ البوتِ: ثلاثُ إشاراتٍ
 * (~9 ثوانٍ) ثمّ البطاقةُ — لا تعليقٌ بلا نهايةٍ (نصيحةُ المراجعةِ: الانتظارُ
 * عدٌّ مسقوفٌ لا ميزانيةَ بطاقةٍ).
 */
const MAX_SIGNAL_WAITS = 3;
const SIGNAL_WAIT_RETRY_MS = 3_000;

export function createOfferNotificationHandler(
  publisher: OfferPublisher,
  log?: OfferNoticeLog,
  board?: OfferBoardDelivery,
): NotificationHandler {
  return async (delivery) => {
    const offer = readOfferPayload(delivery.payload);
    const abandonReason = offerAbandonReason(offer, new Date());
    /**
     * العرضُ الميّتُ لا يُبعَثُ: انتهت مهلته أو لم يَعُد pending أو زال صفُّه
     * قبل أن يصلَه الإشعارُ. لا إعادةُ إرسالٍ أبديةٌ لصفٍّ لن يُقبل أبدًا —
     * تخلٍّ نهائيٌّ (dead) يُسجَّلُ بالرمزِ كالـfinish، فلا يُسلبَ الصفَّ من حائزه.
     */
    if (offer === null || abandonReason !== null) {
      log?.("offer_notice.abandoned", {
        delivery_id: delivery.deliveryId,
        offer_id: offer?.offerId ?? null,
        order_id: offer?.orderId ?? null,
        reason: abandonReason ?? "PAYLOAD_INVALID",
      });
      return ok({ abandon: true, messageId: null, failure: null });
    }
    const meta = {
      delivery_id: delivery.deliveryId,
      offer_id: offer.offerId,
      order_id: offer.orderId,
      attempt: delivery.attempts,
    };
    const notification: OfferNotification = {
      orderId: offer.orderId,
      offerId: offer.offerId,
      driverId: offer.driverId,
      distanceKm: Number(offer.distanceKm) as DistanceKm,
      expiresInSeconds: Math.max(
        0,
        Math.ceil((Date.parse(offer.expiresAt) - Date.now()) / MS_PER_SECOND),
      ),
      service: offer.service,
      pickupLabel: offer.pickupLabel,
      dropoffLabel: offer.dropoffLabel,
      notes: offer.notes,
    };
    log?.("offer_notice.attempted", {
      ...meta,
      expires_in_seconds: notification.expiresInSeconds,
    });
    // ---------------------------------------------------------------------
    // `LOAD-01 Recovery` — لوحُ العروضِ أولًا: إيصالٌ موثَّقٌ منَ العميلِ يُغني
    // عنِ البطاقةِ (والدلوِ الضيّقِ)، وإشارةٌ للسائقِ المتصلِ تُؤجِّلُ البطاقةَ
    // دوراتٍ مسقوفةً، ومن لا إيصالَ ولا اتصالَ لهُ البطاقةُ كما كانَ. هذا هوَ
    // فصلُ «ضجيجِ العروضِ» عنِ الإشعاراتِ الحرجةِ منَ الجذرِ: العروضُ الراكدةُ
    // تُصرَّفُ منَ اللوحِ والإشارةِ، والدلوُّ يتنفَّسُ للحرجِ.
    // ---------------------------------------------------------------------
    if (board !== undefined && offer !== null) {
      const driverKey = String(offer.driverId);
      const offerKey = String(offer.offerId);
      const receipt = await board.findReceipt(driverKey, offerKey);
      if (receipt !== null) {
        // وصلَ فعلًا: تسليمٌ معلَنٌ بالقناةِ وبوقتِ الإيصالِ — لا معرّفَ رسالةٍ
        // مُختلَقًا (القيدُ في القاعدةِ يسمحُ بالإيصالِ المصرَّحِ).
        log?.("offer_notice.delivered_via_board", { ...meta, received_at: receipt.toISOString() });
        return ok({
          abandon: false,
          messageId: null,
          failure: null,
          deliveredViaBoard: true,
        });
      }
      const waits = delivery.signalWaitCount ?? 0;
      if (waits < MAX_SIGNAL_WAITS) {
        const emitted = await board.signalDriver(driverKey);
        if (emitted) {
          // متصلٌ وبُثّتِ الإشارةُ: انتظارٌ قصيرٌ للإيصالِ بلا محاولةِ إرسالٍ
          // محسوبةٍ — البطاقةُ إن لم يصلِ الإيصالُ تنالُ ميزانيتَها كاملةً.
          log?.("offer_notice.board_signal_wait", { ...meta, signal_waits: waits + 1 });
          return ok({
            abandon: false,
            messageId: null,
            failure: null,
            signalWait: { retryAfterMs: SIGNAL_WAIT_RETRY_MS },
          });
        }
      }
      // غيرُ متصلٍ (أو استنفدَ الانتظارَ): بطاقةُ البوتِ فورًا — كما كانَ.
    }
    const sent = await publisher.publishOffer(notification);
    // `SEC-19-ب-٤` — لو كانَ عنوانُ السائقِ غائبًا (telegram_id = null) رمى الناشرُ
    // `TELEGRAM_DELIVERY_UNAVAILABLE`. لا يُعادُ ولا يُتخلَّى عنه كـ`dead`، بل
    // يُعلَنُ `undeliverable` بسببٍ مُسمّىً — مفصولاً عن فشلِ المحاولاتِ.
    if (!sent.ok && sent.error.detail === "TELEGRAM_DELIVERY_UNAVAILABLE") {
      log?.("offer_notice.undeliverable", { ...meta, reason: "TELEGRAM_DELIVERY_UNAVAILABLE" });
      return ok({
        abandon: false,
        messageId: null,
        failure: null,
        undeliverable: true,
        undeliverableReason: "TELEGRAM_DELIVERY_UNAVAILABLE",
      });
    }
    if (sent.ok) {
      // قبولُ Telegram API وحده: لا يُثبِتُ ظهورَ البطاقةِ ولا إشعارَ الهاتف.
      log?.("offer_notice.accepted", meta);
      return ok({ abandon: false, messageId: sent.value, failure: null });
    }
    const failed = { ...meta, max_attempts: delivery.maxAttempts, error: sent.error.detail };
    if (delivery.attempts >= delivery.maxAttempts) log?.("offer_notice.final_failure", failed);
    else log?.("offer_notice.send_failed", failed);
    return ok({ abandon: false, messageId: null, failure: sent.error.detail });
  };
}
