/**
 * الغرض: `WR-14` (§14) — هل للراكبِ رحلةٌ قائمةٌ الآن؟ يُقرأُ **من الخادمِ** لا من ذاكرةِ
 *   الجهاز: أحدثُ صفٍّ في سجلِّ الرحلاتِ (`GET /v1/rides`، الأحدثُ أوّلًا) إن كانَ في
 *   الطيران (`searching` · `matched` · `in_progress`، حكمُ `rideOutcomeClassOf` نفسُه في السجلّ).
 *   وللراكبِ رحلةٌ نشطةٌ واحدةٌ على الأكثرِ (`ACTIVE_RIDE_EXISTS`)، فالصفُّ الأحدثُ يكفي.
 * الحالة: منفّذ فعلياً — `WR-14`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 */

import { rideOutcomeClassOf } from "../../../../../../packages/domain/transport/ride-history.ts";
import { apiFetch } from "../../../api/client.ts";
// نوعٌ فقط: حزمةُ السجلِّ مؤجَّلةٌ (`F1-09` · `D-30`) ولا تدخلُ حِملَ الرئيسةِ الأوّل.
import type { RideHistoryResponse } from "../history/ride-history-contract.ts";

/** معرّفُ الرحلةِ القائمةِ أو `null`. رفضٌ أو سجلٌّ فارغٌ = لا رحلةَ تُعرَض. */
export function activeRideIdFrom(response: RideHistoryResponse): string | null {
  if (!response.accepted) return null;
  const latest = response.groups[0]?.rides[0];
  if (latest === undefined) return null;
  return rideOutcomeClassOf(latest.status) === "IN_FLIGHT" ? latest.orderId : null;
}

export async function fetchActiveRideId(): Promise<string | null> {
  // الطلبُ نفسُه الذي يبنيه `readRideHistory` بصفحةٍ واحدة، بلا حملِ حزمةِ السجلّ.
  return activeRideIdFrom(
    await apiFetch<RideHistoryResponse>("/v1/rides?pageSize=1", { method: "GET" }),
  );
}
