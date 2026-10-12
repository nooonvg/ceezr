/**
 * الغرض: إطلاقُ الطلباتِ المجدولةِ إلى البحثِ في موعدِها — `WR-06` (الخيارُ ج · ADR 0273).
 *
 * الحكمُ كلُّه في القاعدة (`release_due_scheduled_orders`): ما حانَ إطلاقُه يصيرُ `searching`
 * بقفلِ `for update skip locked`، وما فاتَ موعدُه بأكثرَ من مهلةِ السماحِ (النظامُ كانَ معطَّلًا)
 * يُلغى بسببٍ مسمّى ويُعلَمُ الراكب. وهذا المِلفُّ يُكمِلُ الخطوةَ الثانيةَ وحدَها: **البثُّ الفوريُّ**
 * لما أُطلِق، بخطِّ البثِّ القائمِ نفسِه (`redispatchSearchingOrders`) مقصورًا على المُطلَقِ
 * للتوّ. ولو سقطَ البثُّ هنا لالتقطَه شوطُ `redispatch-searching` التالي — فالمُطلَقُ «يبحث»
 * في القاعدةِ وإن لم يُبَثَّ بعد.
 *
 * ولا قرارَ بعدَ الإطلاق ههنا: انعدامُ السائقِ، والدوائرُ الأوسع، والتصعيدُ، والسقفُ — كلُّها
 * مساراتُ البحثِ القائمةُ بلا تغيير (والمؤقّتاتُ تُقاسُ من `searching_since`).
 */

import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import {
  type RedispatchDependencies,
  type RedispatchReport,
  redispatchSearchingOrders,
} from "./redispatch-searching-orders.ts";

export interface ScheduledReleaseOutcome {
  /** أُطلِقَت إلى `searching` في هذا الشوط. */
  readonly released: readonly OrderId[];
  /** فاتَ موعدُها قبلَ الإطلاقِ فأُلغيَت (`scheduled_missed`). */
  readonly missed: readonly OrderId[];
}

export interface ScheduledOrderReleaser {
  releaseDue(
    cityId: CityId,
    limit: number,
  ): Promise<Result<ScheduledReleaseOutcome, PortFailureError>>;
}

export interface ReleaseScheduledDeps {
  readonly releaser: ScheduledOrderReleaser;
  /** تبعيّاتُ البثِّ نفسُها التي يستعملُها `redispatch-searching` — لا منطقَ ثانٍ. */
  readonly broadcast: RedispatchDependencies["broadcast"];
  readonly limit: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface ReleaseScheduledReport extends ScheduledReleaseOutcome {
  readonly cityId: CityId;
  /** تقريرُ البثِّ الفوريِّ لما أُطلِق، أو `null` إن لم يُطلَق شيء. */
  readonly broadcast: RedispatchReport | null;
  /** سقطَ البثُّ الفوريُّ (والشوطُ الدوريُّ يُدركُه) — لا يُسقِطُ الإطلاق. */
  readonly broadcastFailed: boolean;
}

export async function releaseScheduledOrders(
  cityId: CityId,
  deps: ReleaseScheduledDeps,
): Promise<Result<ReleaseScheduledReport, PortFailureError>> {
  const released = await deps.releaser.releaseDue(cityId, deps.limit);
  if (!released.ok) return released;
  const { released: ids, missed } = released.value;
  for (const orderId of missed) {
    deps.log?.("scheduled_order.missed", { city_id: cityId, order_id: orderId });
  }
  if (ids.length === 0) {
    return ok({ cityId, released: ids, missed, broadcast: null, broadcastFailed: false });
  }
  for (const orderId of ids) {
    deps.log?.("scheduled_order.released", { city_id: cityId, order_id: orderId });
  }
  const report = await redispatchSearchingOrders(cityId, {
    finder: {
      findSearching: async () => ok(ids.map((orderId) => ({ orderId, cityId, waitingSeconds: 0 }))),
    },
    broadcast: deps.broadcast,
    limit: ids.length,
    ...(deps.log === undefined ? {} : { log: deps.log }),
  });
  if (!report.ok) {
    deps.log?.("scheduled_order.broadcast_deferred", {
      city_id: cityId,
      released: ids.length,
      error: report.error.detail,
    });
    return ok({ cityId, released: ids, missed, broadcast: null, broadcastFailed: true });
  }
  return ok({ cityId, released: ids, missed, broadcast: report.value, broadcastFailed: false });
}
