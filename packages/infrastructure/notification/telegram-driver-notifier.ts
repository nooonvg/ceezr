/**
 * الغرض: إخطار السائق بعرض حقيقي: يقرأ معرّف دردشته ولغته من القاعدة، ويرسل نصّاً من القواميس
 *   مع زرّي قبول ورفض يحملان معرّف الطلب. لا نصّ مكتوب هنا ولا معرّف مُخمَّن.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/workers/src/container.ts عبر منفذ OfferPublisher
 * ملاحظات مستقبلية: سائق حجب البوت يُبلَّغ عنه كـ unreachable ليُستبعد من الدورة التالية.
 */

import type { Keyboard } from "../../application/bots/types.ts";
import type {
  OfferNotification,
  OfferPublisher,
} from "../../application/dispatch/broadcast-offers.ts";
import { openUrlFor } from "../../domain/places/place-open-url.ts";
import { t } from "../../shared/i18n/index.ts";
import { miniAppUrl } from "../../shared/miniapp-link/index.ts";
import { isOfferMode, orderTermsLines } from "../../shared/order-terms/index.ts";
import { serviceMarker } from "../../shared/service-marker/index.ts";
import { guard, type Sql } from "../db/client.ts";
import { readOrderPlaceExtras } from "../transport/order-place-extras.ts";
import type { IdentifyingSender } from "./telegram-negotiation-notifier.ts";

/**
 * الناشر غير المتزامن لعروض التوصيل: يُستخدمه عاملُ تسليم الإشعار (BUG-004 outbox).
 * يعيد مُعرِّف الرسالة الفعليّ (message_id) من تلغرام — فهو دليلُ التسليم الفعليّ
 * الذي يُخزَّن في عمود `delivered_message_id`. هذا على نقيض `OutboundSender` القديم
 * الذي كان يعيد booleanًا فلا يُمكن إثباتُ التسليم ولا منعُ الإعادة المكرَّرة.
 *
 * `IdentifyingSender` هو ذاته منفذُ إشعارات التفاوض — تُعيد `sendReturningId`
 * معرِّفَ الرسالة (string) أو null عند الفشل. نُحوِّل null إلى فشل صريح.
 */

/** إرسالٌ فعلي إلى المنصّة — يحقّقه محوّل grammY في apps/gateway. */
export interface OutboundSender {
  send(chatId: string, text: string, keyboard: Keyboard | null): Promise<boolean>;
}

interface DriverContactRow {
  readonly telegram_id: string | null;
  readonly language_code: string;
}

const KM_DECIMALS = 1;

/**
 * ناشرُ الإشعار لِعاملِ تسليم عروض التوصيل (BUG-004 — نمط Outbox). يُبنى في
 * `apps/workers/src/container.ts` ويُمرَّر إلى عامل `deliver-notifications`.
 *
 * وهو يُعيدُ مُعرِّفَ الرسالة الفعليَّ (message_id) لا booleanًا — فهو الدليلُ الذي
 * يُخزَّن في `delivered_message_id` لمنعِ إعادةِ الإرسالِ بعد نجاحٍ سابق.
 *
 * يُلقي `DRIVER_CONTACT_NOT_FOUND` عند غيابِ سجلِّ التواصل، و`TELEGRAM_SEND_FAILED`
 * عند إرجاعِ `sendReturningId` لـnull — وكلاهما يُحوَّلان عبر `guard` إلى
 * `PortFailureError` يُعاد معالجته من عاملِ التسليم (إعادةُ المحاولة أو الأَماتة).
 */
export interface OfferPublisherOptions {
  /**
   * `ADR 0213`: أصلُ التطبيقِ المصغَّرِ — حين يُعطى تحملُ البطاقةُ صفّاً ثانياً بزرِّ `web_app`
   * يفتحُ العرضَ نفسَه (`offer_<offerId>`) في التطبيقِ. زرّا القبولِ والرفضِ يبقيانِ: البطاقةُ
   * إشعارٌ عاجلٌ، ومن ضغطَ «قبول» في المحادثةِ لا يُجبَرُ على فتحِ شاشةٍ ليقبلَ.
   */
  readonly miniAppUrl?: string | null;
}

export function createOfferPublisher(
  sql: Sql,
  sender: IdentifyingSender,
  options: OfferPublisherOptions = {},
): OfferPublisher {
  return {
    publishOffer: (notification: OfferNotification) =>
      guard("publisher.publishOffer", async () => {
        const rows = await sql<DriverContactRow[]>`
          select u.telegram_id, u.language_code
            from drivers d
            join users u on u.id = d.user_id
           where d.id = ${notification.driverId}
        `;
        const contact = rows[0];
        if (contact === undefined) {
          throw new Error("DRIVER_CONTACT_NOT_FOUND");
        }

        // `SEC-19-ب-٤` — حرسُ العنوانِ الغائبِ قبلَ `String(...)`: لو كانَ
        // `telegram_id` غائبًا (مستخدمٌ بلا قناةٍ) فلا يُصبَحُ "null" نصًّا
        // يُرسَلُ إلى تيليجرامَ. `offer` نوعٌ جوهريٌّ فالسببُ `TELEGRAM_DELIVERY_UNAVAILABLE`.
        if (contact.telegram_id === null || contact.telegram_id === undefined) {
          throw new Error("TELEGRAM_DELIVERY_UNAVAILABLE");
        }

        const tr = t(contact.language_code);
        // PD-051: ترتيبُ بطاقةِ العرضِ — خدمةٌ ← من أينَ ← إلى أينَ ← مسافة/وقتٌ ← قيود.
        // البياناتُ كلُّها من الطلبِ الموجودِ مسبقًا — إعادةُ ترتيبٍ لا بياناتٍ جديدة.
        const serviceLabel =
          notification.service === "transport"
            ? tr("driver.offer_card_service_transport")
            : notification.service === "delivery"
              ? tr("driver.offer_card_service_delivery")
              : (notification.service ?? "");
        const lines: string[] = [];
        if (notification.service !== null) {
          lines.push(
            tr("driver.offer_card_service", {
              service: serviceLabel,
              marker: serviceMarker(notification.service),
            }),
          );
        }
        // `LOC-TRUST-01`: ما أدخلَه الراكبُ عن كلِّ مكانٍ — الاسمُ والملاحظاتُ والرابطُ الأصليُّ
        // حرفاً. يُقرأُ من الطلبِ لحظةَ الإرسالِ؛ وعطبُه (قاعدةٌ قبلَ الهجرة) يُبقي البطاقةَ كما كانت.
        const places = (await readOrderPlaceExtras(sql, [String(notification.orderId)])).get(
          String(notification.orderId),
        );
        const hasPickupLabel = notification.pickupLabel !== null && notification.pickupLabel !== "";
        if (hasPickupLabel) {
          lines.push(tr("driver.offer_card_from", { pickup: notification.pickupLabel }));
        } else if (places !== undefined) {
          // لا اسمَ ⇒ لا يُخترَعُ اسمٌ (ولا يُوضَعُ أقربُ معلَمٍ مكانَه): النقطةُ هيَ المرجع.
          lines.push(tr("driver.offer_card_from_point"));
        }
        if (places?.pickup.notes != null) {
          lines.push(tr("driver.offer_card_pickup_notes", { notes: places.pickup.notes }));
        }
        if (places?.pickup.link != null) {
          lines.push(tr("driver.offer_card_pickup_link", { link: places.pickup.link }));
        }
        if (notification.dropoffLabel !== null && notification.dropoffLabel !== "") {
          lines.push(tr("driver.offer_card_to", { dropoff: notification.dropoffLabel }));
        } else if (places?.dropoff != null) {
          lines.push(tr("driver.offer_card_to_point"));
        }
        if (places?.dropoff?.notes != null) {
          lines.push(tr("driver.offer_card_dropoff_notes", { notes: places.dropoff.notes }));
        }
        if (places?.dropoff?.link != null) {
          lines.push(tr("driver.offer_card_dropoff_link", { link: places.dropoff.link }));
        }
        // `ORDER-TERMS-01`: وقتُ الحضورِ (ونوعُ الطردِ في التوصيلِ) بعدَ «إلى» وقبلَ المسافةِ —
        // يُقرأُ من الطلبِ لحظةَ الإرسالِ، فلا تتغيّرُ حمولةُ صفِّ العرضِ.
        const termRows = await sql<
          {
            pickup_at: Date | null;
            rider_offer_sar: number | null;
            rider_offer_mode: string | null;
          }[]
        >`
          select pickup_at, rider_offer_sar, rider_offer_mode
            from orders where id = ${notification.orderId}
        `;
        const termRow = termRows[0];
        lines.push(
          ...orderTermsLines(tr, notification.service, {
            pickupAt: termRow?.pickup_at ?? null,
            parcel: notification.notes,
            offerSar: termRow?.rider_offer_sar ?? null,
            // `WR-05` — معنى المبلغِ في البطاقةِ نفسِها: محدَّدٌ أو مقترَحٌ أو بلا مبلغ.
            offerMode: isOfferMode(termRow?.rider_offer_mode) ? termRow.rider_offer_mode : null,
          }),
        );
        lines.push(
          tr("driver.offer_card_distance", {
            distance: notification.distanceKm.toFixed(KM_DECIMALS),
          }),
        );
        lines.push(tr("driver.offer_card_time", { seconds: notification.expiresInSeconds }));
        // في التوصيلِ الملاحظةُ هي وصفُ الطردِ وقد عُرِضَت سطراً لها؛ فلا تتكرّرُ.
        if (
          notification.service !== "delivery" &&
          notification.notes !== null &&
          notification.notes !== ""
        ) {
          lines.push(tr("driver.offer_card_notes", { notes: notification.notes }));
        }
        const text = lines.join("\n");
        // `ADR 0286` — البطاقةُ إشعارٌ وزرُّ تطبيقٍ لا زرَّ عملٍ: القبولُ والرفضُ في
        // لوحِ عروضِ التطبيقِ حيثُ الجلسةُ الموقَّعةُ وملكيّةُ القرارِ. لا يُنفَّذُ
        // قرارٌ تجاريٌّ من المحادثةِ، ولا يعودُ زرُّ `offer:` إلى بطاقةٍ جديدةٍ.
        const keyboard: Keyboard =
          options.miniAppUrl === undefined || options.miniAppUrl === null
            ? // وضعُ `legacy` الاختباريُّ: بطاقةٌ بلا زرٍّ — لا زرَّ عملٍ يعودُ إليها.
              { kind: "inline", rows: [] }
            : {
                kind: "inline",
                rows: [
                  [
                    {
                      label: tr("miniapp.offer_button"),
                      webAppUrl: miniAppUrl(options.miniAppUrl, {
                        audience: "driver",
                        screen: "offer",
                        id: String(notification.offerId),
                      }),
                    },
                  ],
                  [
                    {
                      label: tr("miniapp.offers_button"),
                      webAppUrl: miniAppUrl(options.miniAppUrl, {
                        audience: "driver",
                        screen: "offers",
                      }),
                    },
                  ],
                ],
              };
        // `LOC-TRUST-01` — «فتح موقع الالتقاط/الوجهة»: الرابطُ الأصليُّ إن صلحَ وإلّا من النقطة.
        const pickupUrl = places === undefined ? null : openUrlFor(places.pickup);
        const dropoffUrl =
          places === undefined || places.dropoff === null ? null : openUrlFor(places.dropoff);
        const openRow = [
          ...(pickupUrl === null
            ? []
            : [{ label: tr("driver.offer_open_pickup_button"), url: pickupUrl }]),
          ...(dropoffUrl === null
            ? []
            : [{ label: tr("driver.offer_open_dropoff_button"), url: dropoffUrl }]),
        ];
        const chatId = String(contact.telegram_id);
        if (openRow.length > 0 && keyboard.kind === "inline") {
          const withLinks: Keyboard = { kind: "inline", rows: [openRow, ...keyboard.rows] };
          const linked = await sender.sendReturningId(chatId, text, withLinks);
          if (linked !== null) return linked;
          // زرُّ رابطٍ يرفضُه Telegram يُسقِطُ الرسالةَ كلَّها؛ والرابطُ مكتوبٌ نصّاً في البطاقة،
          // فتُعادُ بلا أزرارِ الروابطِ ولا يفوتُ السائقَ العرض.
        }
        const messageId = await sender.sendReturningId(chatId, text, keyboard);
        if (messageId === null) {
          throw new Error("TELEGRAM_SEND_FAILED");
        }
        return messageId;
      }),
  };
}
