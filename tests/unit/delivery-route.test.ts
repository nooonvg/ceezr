import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  createDeliveryRoutes,
  type DeliveryRouteDependencies,
} from "../../apps/gateway/src/routes/deliveries.ts";

/** Builds a minimal app with the delivery route mounted. */
function buildApp(deps: DeliveryRouteDependencies): Hono {
  const app = new Hono();
  app.route("/", createDeliveryRoutes(deps));
  return app;
}

/** Fake session reader that accepts any token and returns a fixed user. */
function fakeSessions(telegramUserId = "12345") {
  const value = {
    telegramUserId,
    bot: "rider",
    sessionId: "session-123",
    issuedAtSeconds: Math.floor(Date.now() / 1000),
    expiresAtSeconds: Math.floor(Date.now() / 1000) + 3600,
  };
  return {
    read: async () => ({ ok: true as const, value }),
    readSync: () => ({ ok: true as const, value }),
  };
}

/** Fake RideRequestCommand that always accepts and returns a new order. */
function fakeRides() {
  return {
    create: async () => ({
      ok: true as const,
      value: {
        accepted: true as const,
        ride: {
          orderId: "order-123",
          createdAtMs: Date.now(),
          reused: false,
        },
      },
    }),
  };
}

const BASE_BODY = {
  originLat: 21.4818,
  originLng: 39.1663,
  destinationLat: 21.4225,
  destinationLng: 39.8262,
  parcelDescription: "صندوق صغير",
};

const HEADERS = {
  authorization: "Bearer test-token",
  "idempotency-key": "test-key-123",
  "content-type": "application/json",
};

describe("POST /v1/deliveries", () => {
  let deps: DeliveryRouteDependencies;

  beforeEach(() => {
    deps = {
      request: {
        sessions: fakeSessions(),
        rides: fakeRides(),
        now: () => new Date(),
      },
      log: () => {},
    };
  });

  it("creates a delivery order with valid parcel description", async () => {
    const app = buildApp(deps);
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(BASE_BODY),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);
    expect(json.accepted).toBe(true);
    expect(json.orderId).toBe("order-123");
  });

  it("ORDER-TERMS-01: accepts a delivery without a parcel description (optional by owner's rule)", async () => {
    const seen: Record<string, unknown>[] = [];
    deps = {
      ...deps,
      request: {
        sessions: fakeSessions(),
        // `WR-06`: ساعةٌ ثابتةٌ قبلَ الموعدِ — الوقتُ الماضي يُرفَضُ الآنَ ولا يسقطُ صامتًا.
        now: () => new Date("2026-10-03T09:00:00.000Z"),
        rides: {
          create: async (input: Record<string, unknown>) => {
            seen.push(input);
            return fakeRides().create();
          },
        } as never,
      },
    };
    const app = buildApp(deps);
    const body: Record<string, unknown> = {
      ...BASE_BODY,
      pickupLabel: "مطار الملك عبدالعزيز الدولي",
      destinationLabel: "البلد",
      pickupAt: "2026-10-03T10:30:00.000Z",
    };
    delete body.parcelDescription;
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.notes).toBeNull();
    expect(seen[0]?.pickupLabel).toBe("مطار الملك عبدالعزيز الدولي");
    expect(seen[0]?.dropoffLabel).toBe("البلد");
    expect(String((seen[0]?.pickupAt as Date | undefined)?.toISOString())).toBe(
      "2026-10-03T10:30:00.000Z",
    );
  });

  it("rejects when parcel description is too short (< 3 chars)", async () => {
    const app = buildApp(deps);
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ ...BASE_BODY, parcelDescription: "ab" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("PARCEL_DESCRIPTION_INVALID");
  });

  it("rejects when parcel description looks like a bot command", async () => {
    const app = buildApp(deps);
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ ...BASE_BODY, parcelDescription: "/start" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("PARCEL_DESCRIPTION_INVALID");
  });

  it("rejects when destination is missing (dropoff required)", async () => {
    const app = buildApp(deps);
    const body = { ...BASE_BODY };
    delete (body as Record<string, unknown>).destinationLat;
    delete (body as Record<string, unknown>).destinationLng;
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("DROPOFF_REQUIRED");
  });

  it("rejects when idempotency key is missing", async () => {
    const app = buildApp(deps);
    const headers = { ...HEADERS };
    delete (headers as Record<string, unknown>)["idempotency-key"];
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers,
      body: JSON.stringify(BASE_BODY),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects when session token is missing", async () => {
    const app = buildApp(deps);
    const headers = { ...HEADERS };
    delete (headers as Record<string, unknown>).authorization;
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers,
      body: JSON.stringify(BASE_BODY),
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("SESSION_REQUIRED");
  });

  it("rejects when body is not valid JSON", async () => {
    const app = buildApp(deps);
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: "not json",
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("MALFORMED");
  });

  it("returns 503 when ride store is not available", async () => {
    const app = buildApp({ request: undefined, log: () => {} });
    const res = await app.request("/v1/deliveries", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(BASE_BODY),
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("RIDE_STORE_NOT_AVAILABLE");
  });
});
