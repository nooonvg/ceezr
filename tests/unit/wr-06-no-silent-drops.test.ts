/**
 * الغرض: `WR-06` — لا يسقطُ ما أدخلَه الراكبُ صامتًا: وقتُ حضورٍ خارجَ نافذتِه يُرفَضُ برمزِه،
 * ورموزُ الرفضِ التي يُصلِحُها الراكبُ تُقالُ بسببِها، ووقتُ الحضورِ يظهرُ على بطاقةِ السائقِ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import {
  pickupAtText,
  toOfferCard,
  toOfferDetail,
} from "../../apps/miniapp/src/surfaces/driver/offers/offers-view.ts";
import {
  isRetryableRideError,
  rideErrorKey,
} from "../../apps/miniapp/src/surfaces/rider/search/search-view.ts";
import { judgePickupAt, requestRide } from "../../packages/application/transport/request-ride.ts";
import ar from "../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };

const NOW = new Date("2026-10-12T09:00:00.000Z");
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

function deps(seen: Record<string, unknown>[]) {
  const value = {
    telegramUserId: "12345",
    bot: "rider",
    sessionId: "session-123",
    issuedAtSeconds: Math.floor(NOW.getTime() / 1000),
    expiresAtSeconds: Math.floor(NOW.getTime() / 1000) + 3600,
  };
  return {
    sessions: {
      read: async () => ({ ok: true as const, value }),
      readSync: () => ({ ok: true as const, value }),
    },
    rides: {
      create: async (command: Record<string, unknown>) => {
        seen.push(command);
        return {
          ok: true as const,
          value: {
            accepted: true as const,
            ride: { orderId: "order-123", createdAtMs: NOW.getTime(), reused: false },
          },
        };
      },
    },
    now: () => NOW,
  } as unknown as Parameters<typeof requestRide>[0];
}

async function call(pickupAt: unknown) {
  const seen: Record<string, unknown>[] = [];
  const result = await requestRide(deps(seen), {
    accessToken: "token",
    idempotencyKey: "wr06-key-123",
    body: {
      service: "transport",
      originLat: 21.4818,
      originLng: 39.1663,
      destinationLat: 21.4225,
      destinationLng: 39.8262,
      pickupAt,
    },
  });
  return { result, seen };
}

describe("WR-06 — وقتُ الحضورِ لا يصيرُ «الآن» صامتًا", () => {
  it("الغيابُ والفراغُ «الآن»", () => {
    for (const blank of [undefined, null, "", "   "]) {
      expect(judgePickupAt(blank, NOW)).toEqual({ at: null });
    }
  });

  it("وقتٌ في النافذةِ يُقبَلُ كما هو", () => {
    const at = new Date(NOW.getTime() + 90 * MIN).toISOString();
    expect(judgePickupAt(at, NOW)).toEqual({ at: new Date(at) });
    const justPast = new Date(NOW.getTime() - 9 * MIN).toISOString();
    expect("at" in judgePickupAt(justPast, NOW)).toBe(true);
  });

  it("المشوَّهُ وما قبلَ 10 دقائقَ وما بعدَ 14 يومًا يُرفَضُ برمزِه", () => {
    for (const bad of [
      "غدًا",
      "25:99",
      42,
      {},
      new Date(NOW.getTime() - 11 * MIN).toISOString(),
      new Date(NOW.getTime() + 14 * DAY + MIN).toISOString(),
    ]) {
      expect(judgePickupAt(bad, NOW)).toEqual({ refusal: "PICKUP_AT_INVALID" });
    }
  });

  it("الرفضُ قبلَ أيِّ كتابة، والصالحُ يصلُ إلى المخزنِ بوقتِه", async () => {
    const refused = await call(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(refused.result).toEqual({ ok: false, error: "PICKUP_AT_INVALID" });
    expect(refused.seen).toHaveLength(0);

    const at = new Date(NOW.getTime() + 2 * 60 * MIN).toISOString();
    const accepted = await call(at);
    expect(accepted.result.ok).toBe(true);
    expect((accepted.seen[0]?.pickupAt as Date).toISOString()).toBe(at);

    const now = await call(undefined);
    expect(now.seen[0]?.pickupAt).toBeNull();
  });
});

describe("WR-06 — رموزُ الرفضِ تُقالُ بسببِها لا «الخدمة غير متاحة»", () => {
  const codes = [
    "OFFER_MODE_INVALID",
    "OFFER_AMOUNT_REQUIRED",
    "OFFER_AMOUNT_INVALID",
    "OFFER_AMOUNT_UNEXPECTED",
    "PARCEL_DESCRIPTION_INVALID",
    "PLACE_INVALID",
    "PLACE_LINK_UNSUPPORTED",
    "PLACE_NOTES_TOO_LONG",
    "PLACE_POINT_UNRELIABLE",
    "PICKUP_AT_INVALID",
  ];

  it("لكلِّ رمزٍ مفتاحُه، ولا يُعرَضُ زرُّ إعادةٍ لما لا يتغيّرُ بالإعادة", () => {
    for (const code of codes) {
      const key = rideErrorKey(code);
      expect(key).not.toBe("rider.search.error.unavailable");
      expect(isRetryableRideError(code)).toBe(false);
      for (const dict of [ar, en, ur] as Record<string, string>[]) {
        expect(typeof dict[key]).toBe("string");
      }
    }
  });

  it("مفاتيحُ شاشةِ التسعيرِ وبطاقةِ السائقِ موجودةٌ في القواميسِ الثلاثة", () => {
    for (const key of [
      "rider.quote.pickup.laterHint",
      "rider.quote.pickup.timeRequired",
      "driver.offers.pickupAt.now",
      "driver.offers.pickupAt.at",
      "driver.offers.pickupAt.am",
      "driver.offers.pickupAt.pm",
    ]) {
      for (const dict of [ar, en, ur] as Record<string, string>[]) {
        expect(typeof dict[key]).toBe("string");
      }
    }
  });
});

describe("WR-06 — وقتُ الحضورِ على بطاقةِ السائقِ في التطبيق", () => {
  const dict = ar as Record<string, string>;
  const t = (key: string) => dict[key] ?? key;

  it("«الآن» حينَ لا وقت، والساعةُ بتوقيتِ الرياضِ حينَ يُطلَب", () => {
    expect(pickupAtText(t, null)).toBe("وقت الحضور: الآن");
    // 10:30Z = 1:30 م بتوقيتِ الرياض.
    expect(pickupAtText(t, "2026-10-12T10:30:00.000Z")).toBe("وقت الحضور: 1:30 م");
    expect(pickupAtText(t, "ليس وقتًا")).toBe("وقت الحضور: الآن");
  });

  it("البطاقةُ والتفاصيلُ تحملانِ `pickup_at`، وغيابُه في بوّابةٍ أقدمَ «الآن»", () => {
    const card = {
      offer_id: "o1",
      order_id: "r1",
      round: 1,
      service: "ride",
      pickup_label: "الحرم",
      dropoff_label: null,
      expires_at: NOW.toISOString(),
      seconds_left: 30,
      rider_distance: null,
      trip_distance: null,
      pickup_at: "2026-10-12T10:30:00.000Z",
    } as unknown as Parameters<typeof toOfferCard>[0];
    expect(toOfferCard(card).pickupAt).toBe("2026-10-12T10:30:00.000Z");
    const { pickup_at: _drop, ...older } = card as unknown as Record<string, unknown>;
    expect(toOfferCard(older as unknown as Parameters<typeof toOfferCard>[0]).pickupAt).toBeNull();

    const detail = {
      offer_id: "o1",
      order_id: "r1",
      round: 1,
      service: "ride",
      offer_status: "offered",
      order_status: "searching",
      seconds_left: 30,
      is_claimable: true,
      pickup: { label: "الحرم", latitude: 24.46, longitude: 39.61 },
      dropoff: null,
      rider_distance: null,
      trip_distance: null,
      notes: null,
      pickup_at: null,
    } as unknown as Parameters<typeof toOfferDetail>[0];
    expect(toOfferDetail(detail).pickupAt).toBeNull();
  });
});
