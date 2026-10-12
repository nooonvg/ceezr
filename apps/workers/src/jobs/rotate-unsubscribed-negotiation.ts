/**
 * الغرض: مهمة دورية تُدير دورات قروب غير المشتركين في مدينة واحدة: تُنهي مهلة التفاوض
 *   فتنقل الدور للذي يليه، وتُعيد نشر البطاقة عند نفاد المسجَّلين، وتُصعِّد إلى قروب
 *   الإسناد عند نفاد الدورات. القرار كلّه من الدومين، والتنفيذ من حالات الاستخدام.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.3.
 * ينتمي إلى: apps/workers/src/jobs
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts (Cron على Render)
 * ملاحظات مستقبلية: تعدّد النسخ آمن — كل كتابة تمرّ بقفل صفّ الدورة في القاعدة.
 */

import {
  type CloseStaleGroupCardsDependencies,
  closeStaleGroupCards,
} from "../../../../packages/application/dispatch/close-stale-group-cards.ts";
import {
  type EscalateUnmatchedOrderDependencies,
  escalateUnmatchedOrder,
} from "../../../../packages/application/dispatch/escalate-unmatched-order.ts";
import {
  type RepublishDependencies,
  republishOrderCard,
} from "../../../../packages/application/dispatch/republish-order-card.ts";
import {
  advanceNegotiationTurn,
  type NegotiationSnapshotReader,
  type RotateNegotiationDependencies,
} from "../../../../packages/application/dispatch/rotate-negotiation-turn.ts";
import type { PortFailureError } from "../../../../packages/application/ports/index.ts";
import { decideRotation } from "../../../../packages/domain/dispatch/negotiation.ts";
import type { CityId, Clock, OrderId } from "../../../../packages/shared/kernel/index.ts";
import { ok, type Result } from "../../../../packages/shared/result/index.ts";

export interface RotateUnsubscribedDependencies {
  readonly snapshots: NegotiationSnapshotReader;
  readonly rotate: RotateNegotiationDependencies;
  readonly republish: RepublishDependencies;
  readonly escalate: EscalateUnmatchedOrderDependencies;
  readonly clock: Clock;
  /** `WR-10` — إغلاقُ بطاقاتِ الدوراتِ المنتهية. اختياريٌّ: غيابُه يُبقي السلوكَ السابق. */
  readonly groupCards?: CloseStaleGroupCardsDependencies;
  /** يسجّل ما تعذّر بلا إسقاط بقية الدورات — دورة واحدة معطوبة لا تُعطّل المدينة. */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface RotateUnsubscribedReport {
  readonly cityId: CityId;
  readonly examined: number;
  readonly advanced: readonly string[];
  readonly republished: readonly OrderId[];
  readonly escalated: readonly OrderId[];
  readonly waiting: number;
  /** `WR-10` — بطاقاتٌ أُغلِقَت في هذا المرور. */
  readonly cardsClosed: number;
  /** أخطاء غير قاتلة حدثت أثناء المرور: تُعاد لتُسجَّل، ولا تُخفى. */
  readonly failures: readonly string[];
}

/**
 * مرور واحد على دورات المدينة. لا يرمي أبداً: كل عطل في دورة يُسجَّل ويُمضى للتي بعدها،
 * لأن هذه المهمة تعمل كل دقيقة وسقوطها كاملاً بسبب طلب واحد يوقف كل الطلبات.
 */
export async function rotateUnsubscribedNegotiations(
  cityId: CityId,
  deps: RotateUnsubscribedDependencies,
): Promise<Result<RotateUnsubscribedReport, PortFailureError>> {
  const log = deps.log ?? (() => {});
  const pending = await deps.snapshots.findPending(cityId);
  if (!pending.ok) return pending;

  const now = deps.clock.now();
  const advanced: string[] = [];
  const republished: OrderId[] = [];
  const escalated: OrderId[] = [];
  const failures: string[] = [];
  let waiting = 0;

  for (const entry of pending.value) {
    const decision = decideRotation(entry.snapshot, entry.maxCycles, now);
    const action = decision.action;

    if (action.kind === "wait") {
      waiting += 1;
      continue;
    }

    if (action.kind === "advance") {
      const moved = await advanceNegotiationTurn(
        { negotiationId: decision.negotiationId, reason: action.reason },
        deps.rotate,
      );
      if (!moved.ok) {
        failures.push(`advance:${decision.negotiationId}:${moved.error.code}`);
        log("negotiation.rotate_failed", { negotiationId: decision.negotiationId });
        continue;
      }
      // النفاد بعد التدوير يُعالَج في المرور التالي: الحالة صارت 'exhausted' في القاعدة،
      // فتُلتقط بلا إعادة قراءة هنا، وبذلك يبقى كل مسار قراراً واحداً لا قرارين متشابكين.
      advanced.push(decision.negotiationId);
      continue;
    }

    if (action.kind === "republish") {
      // الإغلاق قبل النشر لا بعده: الفهرس unsubscribed_negotiations_single_open يمنع
      // دورتين مفتوحتين، ودورة collecting ميتة لم تُغلَق ستردّ النشر بـ CYCLE_ALREADY_OPEN.
      const closed = await deps.rotate.rotation.close(decision.negotiationId, "republish");
      if (!closed.ok) {
        failures.push(`close:${decision.negotiationId}:${closed.error.code}`);
        log("negotiation.round_close_failed", { negotiationId: decision.negotiationId });
        continue;
      }

      const again = await republishOrderCard({ orderId: decision.orderId }, deps.republish);
      if (!again.ok) {
        failures.push(`republish:${decision.orderId}:${again.error.code}`);
        log("negotiation.card_repost_failed", { orderId: decision.orderId });
        continue;
      }
      if (again.value.published) republished.push(decision.orderId);
      else failures.push(`republish:${decision.orderId}:${again.value.reason ?? "UNKNOWN"}`);
      continue;
    }

    const raised = await escalateUnmatchedOrder(
      {
        orderId: decision.orderId,
        reason: action.reason,
        cyclesTried: entry.snapshot.cycle,
      },
      deps.escalate,
    );
    if (!raised.ok) {
      failures.push(`escalate:${decision.orderId}:${raised.error.code}`);
      log("negotiation.escalation_failed", { orderId: decision.orderId });
      continue;
    }
    // الإغلاق يجري في الحالتين: صُعّد الطلب الآن أم كان مُصعّداً من قبل،
    // فالدورة انتهت ولا يجوز أن تعود في المرور التالي.
    const closedAfter = await deps.rotate.rotation.close(decision.negotiationId, "escalated");
    if (!closedAfter.ok) {
      failures.push(`close:${decision.negotiationId}:${closedAfter.error.code}`);
    }

    if (raised.value.escalated) escalated.push(decision.orderId);
    else failures.push(`escalate:${decision.orderId}:${raised.value.reason ?? "UNKNOWN"}`);
  }

  /**
   * `WR-10` — بعدَ القراراتِ لا قبلَها: دورةٌ أُغلِقَت في هذا المرورِ تُغلَقُ بطاقتُها فيه.
   * وعطلُ القراءةِ لا يُسقطُ المرور: يُسجَّلُ إخفاقًا ويُمضى.
   */
  let cardsClosed = 0;
  if (deps.groupCards !== undefined) {
    const cards = await closeStaleGroupCards(cityId, deps.groupCards);
    if (cards.ok) {
      cardsClosed = cards.value.closed;
      if (cards.value.failed > 0) failures.push(`group_cards:${cards.value.failed}`);
    } else failures.push(`group_cards:${cards.error.code}`);
  }

  return ok({
    cityId,
    examined: pending.value.length,
    cardsClosed,
    advanced,
    republished,
    escalated,
    waiting,
    failures,
  });
}
