/**
 * الغرض: `NEG-SELECT-01` — بطاقاتُ دورِ التفاوضِ عند الراكبِ في مكانٍ واحدٍ: بطاقةُ العرضِ
 *   (معلوماتُ السائقِ · اختيارُه · السائقُ التالي)، وبطاقةُ المعلوماتِ (اختيار · تجاهل)،
 *   وبطاقةُ المحادثةِ (تم الاتفاق · إعادةُ فتحِ الطلبِ لسائقٍ آخر). يبنيها المُخطِرُ حين
 *   يُفتَحُ الدورُ، ويُعيدُ بناءَها الحوارُ حين يضغطُ الراكبُ «تجاهل» — فلا تختلفُ النسختانِ.
 * الحالة: منفّذ فعلياً — 2026-10-03.
 * ينتمي إلى: application/bots
 * ملاحظات: بياناتُ الأزرارِ تحملُ موضعَ الدورِ لا معرّفَ المطالبةِ — حدُّ تيليجرام 64 بايتاً
 *   (`unsub:info:` + uuid + `:` + موضعٌ ≈ 50)، والموضعُ يكفي حارساً للبطاقةِ القديمةِ.
 */

import { type MiniAppTarget, miniAppUrl } from "../../shared/miniapp-link/index.ts";
import type { NegotiationDriverCard } from "../dispatch/rotate-negotiation-turn.ts";
import type { Keyboard } from "./types.ts";

/**
 * `ADR 0286` — زرُّ التطبيقِ لبطاقاتِ الراكبِ: القرارُ (اختيارُ السائقِ · الاتفاقُ ·
 * التجاوزُ) من التطبيقِ المصغَّرِ حيثُ جلستُهُ الموقَّعةُ، لا من زرِّ محادثةٍ. البطاقةُ
 * إشعارٌ يخبِرُ ويُحيلُ، ولو غابَ الهدفُ (وضعُ `legacy` الاختباريُّ) بقيتِ الأزرارُ
 * القديمةُ كما هي — مسارُ توافقٍ معزولٌ لا يُفعَّلُ في تشغيلٍ فعليٍّ.
 */
function appKeyboard(tr: Translate, miniAppOrigin: string, target: MiniAppTarget): Keyboard {
  return {
    kind: "inline",
    rows: [
      [
        {
          label: tr("negotiation.rider_app_button"),
          webAppUrl: miniAppUrl(miniAppOrigin, target),
        },
      ],
    ],
  };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

export interface NegotiationCard {
  readonly text: string;
  readonly keyboard: Keyboard;
}

/** بطاقةُ العرضِ: إشعارٌ يُحيلُ إلى التطبيقِ، أو أزرارُ `legacy` في الاختبارِ المعزولِ. */
export function riderPresentationCard(
  tr: Translate,
  negotiationId: string,
  position: number,
  deadlineSeconds: number | null,
  app?: { readonly miniAppOrigin: string; readonly target: MiniAppTarget },
): NegotiationCard {
  const lines = [tr("negotiation.rider_presented", { position })];
  if (deadlineSeconds !== null) {
    lines.push(tr("negotiation.rider_presented_deadline", { seconds: deadlineSeconds }));
  }
  return {
    text: lines.join("\n"),
    keyboard:
      app === undefined
        ? {
            kind: "inline",
            rows: [
              [
                {
                  label: tr("negotiation.rider_info_button"),
                  data: `unsub:info:${negotiationId}:${position}`,
                },
                {
                  label: tr("negotiation.rider_select_button"),
                  data: `unsub:sel:${negotiationId}:${position}`,
                },
              ],
              [
                {
                  label: tr("negotiation.rider_next_button"),
                  data: `unsub:next:${negotiationId}:${position}`,
                },
              ],
            ],
          }
        : appKeyboard(tr, app.miniAppOrigin, app.target),
  };
}

/** بطاقةُ معلوماتِ السائقِ — وزرُّ التطبيقِ حين يكونُ القرارُ فيه (`ADR 0286`). */
export function riderDriverInfoCard(
  tr: Translate,
  card: NegotiationDriverCard,
  app?: { readonly miniAppOrigin: string; readonly target: MiniAppTarget },
): NegotiationCard {
  const unknown = tr("negotiation.driver_info_unknown");
  const rating =
    card.ratingAverage === null
      ? tr("negotiation.driver_info_no_rating")
      : tr("negotiation.driver_info_rating", {
          average: card.ratingAverage.toFixed(1),
          count: card.ratingCount,
        });
  const vehicleParts = [
    card.vehicleType,
    card.vehicleYear === null ? null : String(card.vehicleYear),
  ].filter((part): part is string => part !== null && part.trim() !== "");
  const text = tr("negotiation.driver_info_card", {
    name: card.firstName ?? unknown,
    rating,
    vehicle: vehicleParts.length === 0 ? unknown : vehicleParts.join(" · "),
    trips: card.completedTrips,
    since: card.memberSinceYear === null ? unknown : String(card.memberSinceYear),
  });
  return {
    text,
    keyboard:
      app === undefined
        ? {
            kind: "inline",
            rows: [
              [
                {
                  label: tr("negotiation.rider_select_button"),
                  data: `unsub:sel:${card.negotiationId}:${card.position}`,
                },
                {
                  label: tr("negotiation.rider_ignore_button"),
                  data: `unsub:ign:${card.negotiationId}:${card.position}`,
                },
              ],
            ],
          }
        : appKeyboard(tr, app.miniAppOrigin, app.target),
  };
}

/** بطاقةُ المحادثةِ بعدَ الاختيارِ: «جاري الاتفاق» — والحسمُ في التطبيقِ (`ADR 0286`). */
export function riderChatCard(
  tr: Translate,
  negotiationId: string,
  position: number,
  deadlineSeconds: number,
  app?: { readonly miniAppOrigin: string; readonly target: MiniAppTarget },
): NegotiationCard {
  return {
    text: tr("negotiation.rider_chat_opened", { position, seconds: deadlineSeconds }),
    keyboard:
      app === undefined
        ? {
            kind: "inline",
            rows: [
              [
                {
                  label: tr("negotiation.rider_agree_button"),
                  data: `unsub:agree:${negotiationId}`,
                },
              ],
              [
                {
                  label: tr("negotiation.rider_reopen_button"),
                  data: `unsub:reopen:${negotiationId}:${position}`,
                },
              ],
            ],
          }
        : appKeyboard(tr, app.miniAppOrigin, app.target),
  };
}

/** زرُّ «إنهاءِ الانتظارِ» تحتَ ردِّ السائقِ المنتظِرِ. */
export function driverLeaveKeyboard(tr: Translate, negotiationId: string): Keyboard {
  return {
    kind: "inline",
    rows: [
      [{ label: tr("negotiation.driver_leave_button"), data: `unsub:leave:${negotiationId}` }],
    ],
  };
}
