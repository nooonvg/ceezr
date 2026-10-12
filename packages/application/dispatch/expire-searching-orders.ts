/**
 * الغرض: `WR-22` (ADR 0276) — لا طلبَ «يبحثُ» إلى الأبد.
 *
 * الحكمُ كلُّه في القاعدة (`expire_stale_searching_orders`): ما تجاوزَ مدّةَ البحثِ المضبوطةَ
 * للمدينة وهو `searching` بلا سائقٍ مُسنَدٍ ولا مرشَّحٍ ولا عرضٍ معلَّقٍ ولا دورةِ قروبٍ مفتوحة
 * يصيرُ `failed` بسببِ `search_expired`، ويُودَعُ إشعارُ الراكبِ في الصادرِ داخلَ المعاملةِ نفسِها.
 * وهذا المِلفُّ يقرأُ المآلَ ويسجّلُه فقط — لا قرارَ ثانٍ في الذاكرة.
 *
 * المدّةُ قرارٌ تجاريٌّ للمالك (`searching_expire_after_minutes`)، و0 يعني «معطَّل».
 */

import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";

export interface SearchExpiryOutcome {
  /** الإعدادُ صفرٌ: الآليّةُ لا تُنهي شيئًا في هذه المدينة. */
  readonly disabled: boolean;
  /** أُنهيَت في هذا الشوط. */
  readonly expired: readonly OrderId[];
  /** تجاوزَت المدّةَ لكنَّ مسارًا آخرَ يملكُها لحظةَ القفل — يلتقطُها شوطٌ لاحق. */
  readonly held: number;
}

export interface SearchingOrderExpirer {
  expireStale(
    cityId: CityId,
    limit: number,
  ): Promise<Result<SearchExpiryOutcome, PortFailureError>>;
}

export interface ExpireSearchingDeps {
  readonly expirer: SearchingOrderExpirer;
  readonly limit: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export interface ExpireSearchingReport extends SearchExpiryOutcome {
  readonly cityId: CityId;
}

export async function expireSearchingOrders(
  cityId: CityId,
  deps: ExpireSearchingDeps,
): Promise<Result<ExpireSearchingReport, PortFailureError>> {
  const outcome = await deps.expirer.expireStale(cityId, deps.limit);
  if (!outcome.ok) return outcome;
  for (const orderId of outcome.value.expired) {
    deps.log?.("order.search_expired", { city_id: cityId, order_id: orderId });
  }
  return ok({ cityId, ...outcome.value });
}
