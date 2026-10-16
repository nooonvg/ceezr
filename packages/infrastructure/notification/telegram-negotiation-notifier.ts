/**
 * الغرض: كل رسائل دورة غير المشتركين على تلغرام: بطاقة القروب، بطاقة الإسناد، إخطارات
 *   فتح الدور وإغلاقه والاتفاق، وتمرير الرسائل بين الطرفين. لا نصّ مكتوب هنا:
 *   كل حرف من القواميس، وكل معرّف محادثة يأتي محسوباً من طبقة التطبيق لا مُخمَّناً.
 * الحالة: منفّذ فعلياً — المرحلة 2.3.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers
 * ملاحظات مستقبلية: تعديل بطاقة القروب بعد الاتفاق (editMessageText) يُضاف في المرحلة 4.
 */

import { riderChatCard, riderPresentationCard } from "../../application/bots/negotiation-cards.ts";
import type { Keyboard } from "../../application/bots/types.ts";
import type {
  NegotiationMessenger,
  NegotiationSideNotice,
  TurnClosedReason,
} from "../../application/dispatch/deliver-negotiation-notification.ts";
import type {
  EscalationCard,
  EscalationGroupPublisher,
} from "../../application/dispatch/escalate-unmatched-order.ts";
import type {
  UnsubscribedCard,
  UnsubscribedGroupPublisher,
} from "../../application/dispatch/publish-to-unsubscribed-group.ts";
import type { NegotiationParties } from "../../application/dispatch/register-unsubscribed-claim.ts";
import type {
  RelaySender,
  RelaySide,
} from "../../application/dispatch/relay-negotiation-message.ts";
import {
  renderLocalizedTemplate,
  type TranslateMessageDependencies,
} from "../../application/i18n-translation/index.ts";
import { normalizeLanguageTag } from "../../domain/i18n-translation/index.ts";
import { DEFAULT_LANGUAGE, t } from "../../shared/i18n/index.ts";
import { startappDeepLink } from "../../shared/miniapp-link/index.ts";
import { orderTermsLines } from "../../shared/order-terms/index.ts";
import { serviceMarker } from "../../shared/service-marker/index.ts";
import { guard } from "../db/client.ts";
import type { OutboundSender } from "./telegram-driver-notifier.ts";

/**
 * مُرسِل يعيد معرّف الرسالة — تحتاجه بطاقة القروب لتُعدَّل أو تُشار إليها لاحقاً،
 * بخلاف OutboundSender الذي يكتفي بنجاح/فشل.
 */
export interface IdentifyingSender {
  /** يعيد معرّف الرسالة المنشورة، أو null إن رفضها تلغرام. */
  sendReturningId(chatId: string, text: string, keyboard: Keyboard | null): Promise<string | null>;
}

/** لغة القروب: قروب مدينة لا لغة له، فالافتراضية هي لغة النظام. */
function groupLanguage(): string {
  return DEFAULT_LANGUAGE;
}

export function createUnsubscribedGroupPublisher(
  sender: IdentifyingSender,
  options?: {
    /**
     * `ADR 0286` — هويّةُ بوتِ السائقينَ (`getMe` مُخزَّنةً لا إعدادًا يدويًّا يتقادمُ
     * بصمتٍ): زرُّ القروبِ رابطُ `startapp` لا زرَّ `web_app` — فتيليجرامُ يقصرُهُ على
     * المحادثاتِ الخاصةِ، والقروبُ إشعارٌ يفتحُ التطبيقَ بمعاملِهِ الموقَّعِ.
     */
    readonly driverBotUsername?: () => Promise<string | null>;
  },
): UnsubscribedGroupPublisher {
  return {
    publishCard: (card: UnsubscribedCard) =>
      guard("publisher.unsubscribedCard", async () => {
        const tr = t(groupLanguage());
        const serviceLabel = tr(
          card.service === "transport" ? "driver.service_transport" : "driver.service_delivery",
        );
        // `ORDER-TERMS-01`: وقتُ الحضورِ (ونوعُ الطردِ في التوصيلِ) — وفي النقلِ تبقى الملاحظاتُ
        // سطراً بعدَه. بطاقةٌ بلا وقتٍ مقروءٍ (مسارٌ قديمٌ) تبقى كما كانت.
        const details: string[] =
          card.pickupAt === undefined
            ? []
            : [
                ...orderTermsLines(tr, card.service, {
                  pickupAt: card.pickupAt ?? null,
                  parcel: card.notes,
                  ...(card.offerSar === undefined ? {} : { offerSar: card.offerSar }),
                  ...(card.offerMode === undefined ? {} : { offerMode: card.offerMode }),
                }),
              ];
        // `GRP-CARD-01` — «إلى» قبلَ الشروطِ متى سمّى الراكبُ وجهتَه، كبطاقةِ المشترك.
        const dropoff = card.dropoffLabel?.trim() ?? "";
        if (dropoff !== "") details.unshift(tr("driver.offer_card_to", { dropoff }));
        if (card.service !== "delivery" || details.length === 0) {
          details.push(
            tr("group.unsub_notes_line", { notes: card.notes ?? tr("group.unsub_no_notes") }),
          );
        }
        const text = tr("group.unsub_card", {
          marker: serviceMarker(card.service),
          service: serviceLabel,
          // اسمُ الالتقاطِ المختارُ أوضحُ للسائقِ من إحداثيّتَين مقرَّبتَين، ولا يزيدُ دقّةً.
          area:
            card.pickupLabel !== undefined &&
            card.pickupLabel !== null &&
            card.pickupLabel.trim() !== ""
              ? card.pickupLabel.trim()
              : card.areaLabel,
          cycle: card.cycle,
          details: details.join("\n"),
        });
        // `ADR 0286` — القروبُ إشعارٌ لا مسارَ عملٍ: زرُّهُ رابطٌ يفتحُ تطبيقَ السائقِ
        // حيثُ جلستُهُ الموقَّعةُ ولوحُ عروضِهِ ودوراتُهُ. وغيابُ الهويّةِ (وضعُ `legacy`
        // الاختباريُّ المعزولُ) يُبقي زرَّ المطالبةِ القديمَ — مسارَ توافقٍ لا يُفعَّلُ في
        // تشغيلٍ فعليٍّ. ولا `web_app` ههنا: تيليجرامُ يقصرُهُ على المحادثاتِ الخاصةِ.
        let username: string | null = null;
        if (options?.driverBotUsername !== undefined) {
          try {
            username = await options.driverBotUsername();
          } catch {
            username = null;
          }
        }
        const keyboard: Keyboard =
          username === null
            ? {
                kind: "inline",
                rows: [
                  [
                    {
                      label: tr("group.unsub_accept_button"),
                      data: `unsub:claim:${card.negotiationId}`,
                    },
                  ],
                ],
              }
            : {
                kind: "inline",
                rows: [
                  [
                    {
                      label: tr("group.unsub_app_button"),
                      url: startappDeepLink(username, { audience: "driver", screen: "offers" }),
                    },
                  ],
                ],
              };
        return sender.sendReturningId(card.groupId, text, keyboard);
      }),
  };
}

export function createEscalationGroupPublisher(
  sender: IdentifyingSender,
): EscalationGroupPublisher {
  return {
    publishEscalation: (card: EscalationCard) =>
      guard("publisher.escalationCard", async () => {
        const tr = t(groupLanguage());
        const serviceLabel = tr(
          card.service === "transport" ? "driver.service_transport" : "driver.service_delivery",
        );
        const text = tr("group.escalation_card", {
          service: serviceLabel,
          area: card.areaLabel,
          cycles: card.cyclesTried,
          reason: tr(`group.escalation_reason_${card.reason}`),
          order: card.orderId,
        });
        return sender.sendReturningId(card.groupId, text, null);
      }),
  };
}

/**
 * مُرسِلُ إخطاراتِ الدورةِ لطرفٍ واحدٍ في المرّةِ (BUG-004): صفُّ الصادرِ لمُستلِمٍ
 * لا لحادثةٍ، فيلزمُ أن يُعيدَ كلُّ إرسالٍ معرّفَ رسالتِه هو ليُعلَنَ التسليمُ به.
 * وكلُّ رسالةٍ بلغةِ صاحبِها، وزرّا القرارِ للعميلِ وحدَه لأنّه صاحبُ القرارِ.
 */
export function createTelegramNegotiationMessenger(
  driverSender: IdentifyingSender,
  riderSender: IdentifyingSender,
  options?: { readonly miniAppUrl?: string | null },
): NegotiationMessenger {
  const senderFor = (side: "driver" | "rider"): IdentifyingSender =>
    side === "driver" ? driverSender : riderSender;
  // `ADR 0286` — هدفُّ بطاقاتِ الراكبِ: الرئيسةُ تعرضُ طلبَهُ الجاري وسطحَ القرارِ فيه.
  const riderApp =
    options?.miniAppUrl === undefined || options?.miniAppUrl === null
      ? undefined
      : {
          miniAppOrigin: options.miniAppUrl,
          target: { audience: "rider", screen: "home" } as const,
        };

  return {
    sendTurnOpened: (notice: NegotiationSideNotice) =>
      guard("notifier.turnOpened", async () => {
        const tr = t(notice.language);
        const selected = notice.phase === "selected";
        if (notice.side === "driver") {
          // `NEG-SELECT-01`: عند العرضِ يعلمُ السائقُ أنّ عرضَه أمامَ العميلِ ولا يكتبُ بعدُ؛
          // وعند الاختيارِ تُفتَحُ له المحادثةُ.
          return driverSender.sendReturningId(
            notice.chatId,
            tr(selected ? "negotiation.driver_selected" : "negotiation.driver_turn_opened", {
              seconds: notice.deadlineSeconds,
              position: notice.position,
            }),
            null,
          );
        }
        const card = selected
          ? riderChatCard(
              tr,
              notice.negotiationId,
              notice.position,
              notice.deadlineSeconds,
              riderApp,
            )
          : riderPresentationCard(
              tr,
              notice.negotiationId,
              notice.position,
              notice.deadlineSeconds,
              riderApp,
            );
        return riderSender.sendReturningId(notice.chatId, card.text, card.keyboard);
      }),

    sendTurnClosed: (notice: NegotiationSideNotice, reason: TurnClosedReason) =>
      guard("notifier.turnClosed", async () => {
        const tr = t(notice.language);
        const key =
          notice.side === "rider"
            ? "negotiation.rider_turn_closed"
            : reason === "expired"
              ? "negotiation.driver_turn_closed_expired"
              : "negotiation.driver_turn_closed_declined";
        return senderFor(notice.side).sendReturningId(notice.chatId, tr(key), null);
      }),

    sendAgreed: (notice: NegotiationSideNotice) =>
      guard("notifier.agreed", async () => {
        const tr = t(notice.language);
        const key =
          notice.side === "driver" ? "negotiation.agreed_driver" : "negotiation.agreed_rider";
        return senderFor(notice.side).sendReturningId(notice.chatId, tr(key), null);
      }),
  };
}

/** التمرير: من السائق إلى العميل والعكس، كلٌّ ببوته هو لأن المحادثتين منفصلتان. */
/**
 * الترجمة المتبادلة (المرحلة 2.6): حين تختلف لغتا الطرفين تُترجَم رسالة كلٍّ منهما
 * إلى لغة الآخر قبل الإرسال. التبعية اختيارية لأن غياب مزوّد ترجمة حالةٌ سليمة —
 * النظام يعمل بلا ترجمة، والرسالة تصل بلغتها الأصلية بدل أن تُحجب.
 */
export function createTelegramRelaySender(
  driverSender: OutboundSender,
  riderSender: OutboundSender,
  translation?: TranslateMessageDependencies,
): RelaySender {
  const deps: TranslateMessageDependencies = translation ?? { provider: null };

  return {
    relay: (parties: NegotiationParties, from: RelaySide, text: string) =>
      guard("relay.send", async () => {
        const driverLanguage = normalizeLanguageTag(parties.driverLanguage) ?? DEFAULT_LANGUAGE;
        const riderLanguage = normalizeLanguageTag(parties.riderLanguage) ?? DEFAULT_LANGUAGE;

        // اللغتان تُطبَّعان أولاً: وسم مثل ar-SA قادم من تيليجرام يجب ألّا يُقارَن
        // نصّياً بـ ar فيُحسب اختلافاً لغوياً فتُطلَب ترجمة من العربية إلى العربية.
        if (from === "driver") {
          const rendered = await renderLocalizedTemplate(
            {
              templateKey: "negotiation.relay_from_driver",
              body: text,
              from: driverLanguage,
              to: riderLanguage,
            },
            deps,
          );
          return riderSender.send(parties.riderChatId, rendered.text, null);
        }

        const rendered = await renderLocalizedTemplate(
          {
            templateKey: "negotiation.relay_from_rider",
            body: text,
            from: riderLanguage,
            to: driverLanguage,
          },
          deps,
        );
        return driverSender.send(parties.driverChatId, rendered.text, null);
      }),
  };
}
