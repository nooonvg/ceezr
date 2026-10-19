/**
 * الغرض: `acceptDriverOffer` (LOAD-01 · الدفعةُ الخامسةَ عشرةَ) — حينَ يدعمُ المخزنُ `acceptWithMatchedNotice`
 *   يكونُ القبولُ وإيداعُ MATCHED **نداءً واحداً**، والسجلُّ والإشارةُ اللحظيّةُ كما كانا بلا إيداعٍ ثانٍ؛
 *   وحينَ لا يدعمُه، أو لا يُعيدُ مآلاً، يبقى المسارُ القديمُ حرفاً. وفشلُ الإيداعِ لا يرفضُ القبول.
 */

import { describe, expect, it } from "bun:test";
import {
  acceptDriverOffer,
  type DriverOfferDeps,
} from "../../packages/application/driver/driver-offers.ts";
import type { DriverOfferStore } from "../../packages/application/driver/offer-ports.ts";
import type {
  RiderTripDepositOutcome,
  RiderTripNoticeDeps,
} from "../../packages/application/driver/rider-trip-notice.ts";
import { ok } from "../../packages/shared/result/index.ts";

const ORDER = "11111111-2222-4333-8444-555555555555";
const OFFER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CLAIM = { orderId: ORDER, matchedAt: "2026-10-19T00:00:00Z", pendingRider: false };

interface Probe {
  readonly calls: string[];
  readonly logs: { event: string; meta: Record<string, unknown> }[];
  readonly signals: { orderId: string; event: string; created: boolean }[];
}

function harness(options: {
  readonly combined?: RiderTripDepositOutcome | "absent-field" | "unsupported";
  readonly pending?: boolean;
  readonly withNotice?: boolean;
}): { deps: DriverOfferDeps; probe: Probe } {
  const probe: Probe = { calls: [], logs: [], signals: [] };
  const claim = { ...CLAIM, pendingRider: options.pending === true };
  const store: Partial<DriverOfferStore> = {
    accept: async () => {
      probe.calls.push("accept");
      return ok(claim);
    },
  };
  if (options.combined !== "unsupported") {
    (
      store as { acceptWithMatchedNotice: DriverOfferStore["acceptWithMatchedNotice"] }
    ).acceptWithMatchedNotice = async () => {
      probe.calls.push("acceptWithMatchedNotice");
      const c = options.combined;
      const notice: RiderTripDepositOutcome | undefined =
        c === undefined || c === "absent-field" || c === "unsupported" ? undefined : c;
      return ok({ claim, ...(notice === undefined ? {} : { matchedNotice: notice }) });
    };
  }
  const riderNotice: RiderTripNoticeDeps = {
    outbox: {
      enqueue: async () => {
        probe.calls.push("enqueue");
        return { created: true, riderTelegramId: "42" };
      },
      deposited: (orderId, event, result) => {
        probe.signals.push({ orderId, event, created: result.created });
      },
    },
    log: (event, meta) => probe.logs.push({ event, meta }),
  };
  const deps = {
    sessions: {
      read: async () =>
        ok({ telegramUserId: "7", bot: "driver", sessionId: "s", issuedAtMs: 0, expiresAtMs: 1 }),
    },
    store: store as DriverOfferStore,
    drivers: {} as DriverOfferDeps["drivers"],
    offers: {} as DriverOfferDeps["offers"],
    now: () => new Date(0),
    ...(options.withNotice === false ? {} : { riderNotice }),
  } as unknown as DriverOfferDeps;
  return { deps, probe };
}

describe("القبولُ وإيداعُ MATCHED في نداءٍ واحد", () => {
  it("المخزنُ يدعمُه: نداءٌ واحدٌ، لا enqueue ثانٍ، والسجلُّ created والإشارةُ مرّةً", async () => {
    const { deps, probe } = harness({
      combined: { kind: "deposited", created: true, riderTelegramId: "42" },
    });
    const result = await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(result.ok).toBe(true);
    expect(probe.calls).toEqual(["acceptWithMatchedNotice"]);
    expect(probe.logs.map((l) => l.event)).toEqual(["rider_trip_notice.created"]);
    expect(probe.signals).toEqual([{ orderId: ORDER, event: "MATCHED", created: true }]);
  });

  it("فشلُ الإيداعِ المعزول: القبولُ ناجحٌ، والسجلُّ enqueue_failed، ولا إشارةَ", async () => {
    const { deps, probe } = harness({ combined: { kind: "failed", error: "ENQUEUE_EXCEPTION" } });
    const result = await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(result.ok).toBe(true);
    expect(probe.calls).toEqual(["acceptWithMatchedNotice"]);
    expect(probe.logs).toEqual([
      {
        event: "rider_trip_notice.enqueue_failed",
        meta: { event: "MATCHED", order_id: ORDER, error: "ENQUEUE_EXCEPTION" },
      },
    ]);
    expect(probe.signals).toEqual([]);
  });

  it("مكرَّرٌ (created=false): السجلُّ deduplicated، والإشارةُ تُنادى بـcreated=false فتسكتُ في الحاوية", async () => {
    const { deps, probe } = harness({ combined: { kind: "deposited", created: false } });
    await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(probe.logs.map((l) => l.event)).toEqual(["rider_trip_notice.deduplicated"]);
    expect(probe.signals).toEqual([{ orderId: ORDER, event: "MATCHED", created: false }]);
  });

  it("ردٌّ بلا مآلِ إيداع: يرجعُ إلى enqueue المستقلّ (ومفتاحُ منعِ التكرارِ يحرسُه)", async () => {
    const { deps, probe } = harness({ combined: "absent-field" });
    await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(probe.calls).toEqual(["acceptWithMatchedNotice", "enqueue"]);
  });

  it("مخزنٌ لا يدعمُه: المسارُ القديمُ حرفاً (accept ثمّ enqueue)", async () => {
    const { deps, probe } = harness({ combined: "unsupported" });
    await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(probe.calls).toEqual(["accept", "enqueue"]);
  });

  it("بلا riderNotice: لا إيداعَ في القاعدة — accept القديمُ وحدَه", async () => {
    const { deps, probe } = harness({
      combined: { kind: "deposited", created: true },
      withNotice: false,
    });
    await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(probe.calls).toEqual(["accept"]);
  });

  it("حجزٌ بانتظارِ الراكب (WR-09): لا سجلَّ MATCHED ولا enqueue", async () => {
    const { deps, probe } = harness({ pending: true });
    const result = await acceptDriverOffer(deps, { accessToken: "t", offerId: OFFER });
    expect(result.ok).toBe(true);
    expect(probe.calls).toEqual(["acceptWithMatchedNotice"]);
    expect(probe.logs).toEqual([]);
  });
});
