/**
 * الغرض: `WR-08` — بطاقةُ العرضِ الخاصّةُ لا تبقى بزرَّي «قبول/رفض» بعدَ موتِ عرضِها.
 *   تُلتقطُ بطاقاتُ العروضِ المسلَّمةُ غيرُ المغلقةِ التي صارَ عرضُها `expired` (انتهت مهلتُه أو
 *   سبقَ إليه غيرُه) أو `cancelled` (أُلغيَ الطلب)، فيُكتَبُ مآلُها على الرسالةِ نفسِها بلا لوحةٍ
 *   ثمَّ تُعلَّمُ مغلقة.
 * الحالة: منفّذ فعلياً — 2026-10-12 (ADR 0271).
 * ينتمي إلى: application/dispatch
 * يُستخدم من: apps/workers/src/container.ts (شوطُ `expire-offers:<city>`)
 * ملاحظات مستقبلية: البطاقاتُ القديمةُ قبلَ الهجرةِ عُلِّمَت مغلقةً دونَ تعديل.
 */

import type { CityId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import { isTerminalEditError } from "./close-stale-group-cards.ts";

/** مآلُ البطاقةِ كما يُكتَبُ عليها. */
export type OfferCardOutcome = "expired" | "taken" | "cancelled";

export interface DeadOfferCard {
  readonly deliveryId: string;
  /** محادثةُ السائقِ الخاصّةُ نصًّا. */
  readonly chatId: string;
  readonly messageId: string;
  readonly languageCode: string;
  readonly outcome: OfferCardOutcome;
}

export interface DeadOfferCardPort {
  listDead(
    cityId: CityId,
    limit: number,
    maxAttempts: number,
  ): Promise<Result<readonly DeadOfferCard[], PortFailureError>>;
  markClosed(deliveryId: string): Promise<Result<void, PortFailureError>>;
  markAttemptFailed(deliveryId: string): Promise<Result<void, PortFailureError>>;
}

export interface CloseDeadOfferCardsDependencies {
  readonly cards: DeadOfferCardPort;
  /** يعدّلُ نصَّ الرسالةِ ويُزيلُ لوحتَها (بلا `reply_markup`). */
  readonly edit: (chatId: string, messageId: string, text: string) => Promise<void>;
  readonly text: (outcome: OfferCardOutcome, languageCode: string) => string;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface CloseDeadOfferCardsReport {
  readonly closed: number;
  readonly failed: number;
}

export const OFFER_CARD_CLOSE_LIMIT = 20;
export const OFFER_CARD_CLOSE_MAX_ATTEMPTS = 5;

/**
 * ما لا يُصلحُه التكرارُ في محادثةٍ خاصّة: أخطاءُ التعديلِ النهائيّةُ نفسُها في بطاقةِ القروب،
 * ومعها حجبُ السائقِ للبوتِ أو تعطيلُ حسابِه.
 */
export function isTerminalOfferCardError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    isTerminalEditError(lower) ||
    lower.includes("bot was blocked by the user") ||
    lower.includes("user is deactivated")
  );
}

/** لا يرمي: عطلُ بطاقةٍ لا يُسقطُ الباقيَ ولا شوطَ انتهاءِ العروض. */
export async function closeDeadOfferCards(
  cityId: CityId,
  deps: CloseDeadOfferCardsDependencies,
): Promise<Result<CloseDeadOfferCardsReport, PortFailureError>> {
  const log = deps.log ?? (() => {});
  const listed = await deps.cards.listDead(
    cityId,
    deps.limit ?? OFFER_CARD_CLOSE_LIMIT,
    deps.maxAttempts ?? OFFER_CARD_CLOSE_MAX_ATTEMPTS,
  );
  if (!listed.ok) return listed;
  let closed = 0;
  let failed = 0;
  for (const card of listed.value) {
    const meta = { delivery_id: card.deliveryId, outcome: card.outcome };
    let terminal = false;
    try {
      await deps.edit(card.chatId, card.messageId, deps.text(card.outcome, card.languageCode));
    } catch (thrown) {
      const detail = thrown instanceof Error ? thrown.message : String(thrown);
      if (!isTerminalOfferCardError(detail)) {
        failed += 1;
        log("offer_card.close_failed", {
          ...meta,
          error: thrown instanceof Error ? thrown.name : "unknown",
        });
        await deps.cards.markAttemptFailed(card.deliveryId);
        continue;
      }
      terminal = true;
    }
    const marked = await deps.cards.markClosed(card.deliveryId);
    if (!marked.ok) {
      failed += 1;
      log("offer_card.mark_failed", meta);
      continue;
    }
    closed += 1;
    log("offer_card.closed", { ...meta, terminal_error: terminal ? "TELEGRAM_TERMINAL" : null });
  }
  return ok({ closed, failed });
}
