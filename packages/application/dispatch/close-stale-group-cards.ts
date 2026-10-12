/**
 * الغرض: `WR-10` — بطاقةُ قروبِ غيرِ المشتركينَ لا تبقى «طلبًا متاحًا» بعدَ انتهاءِ دورتِها.
 *   تُلتقطُ الدوراتُ المغلقةُ (اتفاقٌ أو إلغاءٌ أو إعادةُ نشرٍ أو تصعيدٌ) ذاتُ البطاقةِ غيرِ
 *   المغلقة، فيُكتَبُ مآلُها على البطاقةِ نفسِها وتُزالُ أزرارُها، ثمَّ تُعلَّمُ مغلقة.
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/jobs/rotate-unsubscribed-negotiation.ts
 * ملاحظات مستقبلية: البطاقاتُ القديمةُ قبلَ الهجرةِ عُلِّمَت مغلقةً دونَ تعديلٍ (لا مساسَ بالقروبِ الحقيقيّ).
 */

import type { CityId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

/** مآلُ البطاقةِ كما يُكتَبُ عليها: أُسنِدَ الطلبُ، أو لم يَعُد متاحًا. */
export type GroupCardOutcome = "assigned" | "closed";

export interface StaleGroupCard {
  readonly negotiationId: string;
  /** معرّفُ القروبِ نصًّا (bigint سالب). */
  readonly groupId: string;
  readonly messageId: string;
  readonly outcome: GroupCardOutcome;
}

export interface StaleGroupCardPort {
  /** دوراتٌ مغلقةٌ بطاقاتُها غيرُ مغلقةٍ، دونَ حدِّ المحاولات. */
  listStale(
    cityId: CityId,
    limit: number,
    maxAttempts: number,
  ): Promise<Result<readonly StaleGroupCard[], PortFailureError>>;
  markClosed(negotiationId: string): Promise<Result<void, PortFailureError>>;
  markAttemptFailed(negotiationId: string): Promise<Result<void, PortFailureError>>;
}

export interface CloseStaleGroupCardsDependencies {
  readonly cards: StaleGroupCardPort;
  /** يعدّلُ نصَّ الرسالةِ ويُزيلُ لوحتَها (بلا `reply_markup`). */
  readonly edit: (chatId: string, messageId: string, text: string) => Promise<void>;
  readonly text: (outcome: GroupCardOutcome) => string;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface CloseStaleGroupCardsReport {
  readonly closed: number;
  readonly failed: number;
}

export const GROUP_CARD_CLOSE_LIMIT = 20;
export const GROUP_CARD_CLOSE_MAX_ATTEMPTS = 5;

/**
 * أخطاءُ Telegram التي لا يُصلحُها التكرار: الرسالةُ معدَّلةٌ سلفًا، أو محذوفةٌ، أو لا تُعدَّل.
 * فتُعلَّمُ مغلقةً بسببِها بدلَ إعادةِ المحاولة.
 */
const TERMINAL_EDIT_ERRORS = [
  "message is not modified",
  "message to edit not found",
  "message can't be edited",
  "chat not found",
] as const;

export function isTerminalEditError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return TERMINAL_EDIT_ERRORS.some((needle) => lower.includes(needle));
}

/** لا يرمي: عطلُ بطاقةٍ لا يُسقطُ الباقي ولا شوطَ التدوير. */
export async function closeStaleGroupCards(
  cityId: CityId,
  deps: CloseStaleGroupCardsDependencies,
): Promise<Result<CloseStaleGroupCardsReport, PortFailureError>> {
  const log = deps.log ?? (() => {});
  const listed = await deps.cards.listStale(
    cityId,
    deps.limit ?? GROUP_CARD_CLOSE_LIMIT,
    deps.maxAttempts ?? GROUP_CARD_CLOSE_MAX_ATTEMPTS,
  );
  if (!listed.ok) return listed;
  let closed = 0;
  let failed = 0;
  for (const card of listed.value) {
    const meta = { negotiation_id: card.negotiationId, outcome: card.outcome };
    let terminal: string | null = null;
    try {
      await deps.edit(card.groupId, card.messageId, deps.text(card.outcome));
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      if (!isTerminalEditError(detail)) {
        failed += 1;
        log("group_card.close_failed", {
          ...meta,
          error: thrown instanceof Error ? thrown.name : "unknown",
        });
        await deps.cards.markAttemptFailed(card.negotiationId);
        continue;
      }
      terminal = detail;
    }
    const marked = await deps.cards.markClosed(card.negotiationId);
    if (!marked.ok) {
      failed += 1;
      log("group_card.mark_failed", meta);
      continue;
    }
    closed += 1;
    log("group_card.closed", {
      ...meta,
      terminal_error: terminal === null ? null : "TELEGRAM_TERMINAL",
    });
  }
  return ok({ closed, failed });
}
