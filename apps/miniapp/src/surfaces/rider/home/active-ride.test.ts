import { describe, expect, it } from "bun:test";
import type { RideHistoryResponse } from "../history/ride-history-contract.ts";
import { activeRideIdFrom } from "./active-ride.ts";

const ORDER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function history(status: string | null): RideHistoryResponse {
  return {
    ok: true,
    accepted: true,
    query: null,
    monthTimezone: "Asia/Riyadh",
    monthTimezoneTrust: "CITY",
    groups:
      status === null
        ? []
        : [
            {
              monthKey: "2026-10",
              rides: [
                {
                  orderId: ORDER,
                  status,
                  service: "transport",
                  pickupLabel: null,
                  dropoffLabel: null,
                  createdAt: "2026-10-12T09:00:00.000Z",
                  completedAt: null,
                },
              ],
            },
          ],
    hasMore: false,
    nextCursor: null,
  };
}

describe("WR-14 — الرحلة القائمة من الخادم (§14)", () => {
  it("أحدث رحلة في البحث أو المطابقة أو التنفيذ تُعرض للمتابعة", () => {
    for (const status of ["searching", "matched", "in_progress"]) {
      expect(activeRideIdFrom(history(status))).toBe(ORDER);
    }
  });

  it("أحدث رحلة منتهية لا تُعرض", () => {
    for (const status of ["completed", "cancelled", "failed"]) {
      expect(activeRideIdFrom(history(status))).toBeNull();
    }
  });

  it("سجل فارغ أو رفض لا يعرض بطاقة", () => {
    expect(activeRideIdFrom(history(null))).toBeNull();
    expect(
      activeRideIdFrom({ ok: true, accepted: false, refusal: "RIDER_NOT_REGISTERED" }),
    ).toBeNull();
  });
});

describe("WR-14 — الربط في الجذر والرئيسة", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const root = readFileSync(new URL("../RiderRoot.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("./HomeScreen.tsx", import.meta.url), "utf8");

  it("بطاقة المتابعة تفتح الرحلة بمعرّفها من الخادم، لا طلبًا جديدًا", () => {
    expect(root).toContain("onContinueRide={(orderId) => setFollowed(orderId)}");
    expect(home).toContain("onClick={() => onContinueRide(activeRideId)}");
    expect(home).toContain('t("rider.home.activeRide.continue")');
  });

  // وغياب التخزين المحلي يفرضه `check-session-storage-policy.ts` على التطبيق كله.
});
