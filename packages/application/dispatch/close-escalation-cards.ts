/**
 * الغرض: `WR-22` (ADR 0278) — بطاقةُ الإسنادِ لا تبقى «طلبٌ يحتاجُ إسنادًا يدويًا» بعدَ أن يصلَ
 *   الطلبُ حالًا لا رجعةَ عنها. تُعدَّلُ الرسالةُ نفسُها إلى مآلِها، ولا تُنشأُ بطاقةٌ بديلة.
 * الحالة: منفّذ فعلياً — 2026-10-13.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/container.ts (`close-escalation-cards:<city>`)
 * ملاحظات مستقبلية: `matched` لا يُغلِق — السائقُ قد ينسحبُ فيعودُ الطلبُ يبحث.
 */

import type { CityId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import { isTerminalEditError } from "./close-stale-group-cards.ts";

/** مآلُ البطاقةِ كما يُكتَبُ عليها. */
export type EscalationCardOutcome = "assigned" | "cancelled" | "search_expired" | "ended";

export interface StaleEscalationCard {
  /** معرّفُ أثرِ `order.escalated` — مفتاحُ البطاقة. */
  readonly auditId: string;
  readonly orderId: string;
  /** معرّفُ قروبِ الإسنادِ نصًّا (bigint سالب). */
  readonly groupId: string;
  readonly messageId: string;
  readonly outcome: EscalationCardOutcome;
}

export interface StaleEscalationCardPort {
  /** بطاقاتٌ مسلَّمةٌ طلباتُها في حالٍ لا رجعةَ عنها، غيرُ مغلقة، دونَ حدِّ المحاولات. */
  listStale(
    cityId: CityId,
    limit: number,
    maxAttempts: number,
  ): Promise<Result<readonly StaleEscalationCard[], PortFailureError>>;
  /** يعلّمُها مغلقةً مرّةً واحدة؛ `false` إن سبقَه عاملٌ آخر. */
  markClosed(card: StaleEscalationCard, cityId: CityId): Promise<Result<boolean, PortFailureError>>;
  markAttemptFailed(
    card: StaleEscalationCard,
    cityId: CityId,
  ): Promise<Result<void, PortFailureError>>;
}

export interface CloseEscalationCardsDependencies {
  readonly cards: StaleEscalationCardPort;
  /** يعدّلُ نصَّ الرسالةِ نفسِها. يرمي عندَ رفضِ Telegram. */
  readonly edit: (chatId: string, messageId: string, text: string) => Promise<void>;
  readonly text: (outcome: EscalationCardOutcome, orderId: string) => string;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface CloseEscalationCardsReport {
  readonly closed: number;
  readonly failed: number;
  readonly raced: number;
}

export const ESCALATION_CARD_CLOSE_LIMIT = 20;
export const ESCALATION_CARD_CLOSE_MAX_ATTEMPTS = 5;

/** لا يرمي: عطلُ بطاقةٍ لا يُسقطُ الباقي. ولا نصَّ رسالةٍ ولا معرّفَ قروبٍ في السجل. */
export async function closeEscalationCards(
  cityId: CityId,
  deps: CloseEscalationCardsDependencies,
): Promise<Result<CloseEscalationCardsReport, PortFailureError>> {
  const log = deps.log ?? (() => {});
  const listed = await deps.cards.listStale(
    cityId,
    deps.limit ?? ESCALATION_CARD_CLOSE_LIMIT,
    deps.maxAttempts ?? ESCALATION_CARD_CLOSE_MAX_ATTEMPTS,
  );
  if (!listed.ok) return listed;
  let closed = 0;
  let failed = 0;
  let raced = 0;
  for (const card of listed.value) {
    const meta = { order_id: card.orderId, outcome: card.outcome };
    let terminal = false;
    try {
      await deps.edit(card.groupId, card.messageId, deps.text(card.outcome, card.orderId));
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      if (!isTerminalEditError(detail)) {
        failed += 1;
        log("escalation_card.close_failed", {
          ...meta,
          error: thrown instanceof Error ? thrown.name : "unknown",
        });
        const counted = await deps.cards.markAttemptFailed(card, cityId);
        if (!counted.ok) log("escalation_card.mark_failed", meta);
        continue;
      }
      // معدَّلةٌ سلفًا (عاملٌ آخرُ سبق) أو محذوفةٌ أو لا تُعدَّل: لا يُصلحُها التكرار.
      terminal = true;
    }
    const marked = await deps.cards.markClosed(card, cityId);
    if (!marked.ok) {
      failed += 1;
      log("escalation_card.mark_failed", meta);
      continue;
    }
    if (!marked.value) {
      raced += 1;
      continue;
    }
    closed += 1;
    log("escalation_card.closed", {
      ...meta,
      terminal_error: terminal ? "TELEGRAM_TERMINAL" : null,
    });
  }
  return ok({ closed, failed, raced });
}
