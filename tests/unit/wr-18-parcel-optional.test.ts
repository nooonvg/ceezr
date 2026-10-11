/**
 * `WR-18` — قرار المالك: وصف الطرد اختياري في كل المسارات.
 * - `/v1/rides` بـ`service=delivery` و`/v1/deliveries` يتفقان: الفراغ مقبول، والمكتوب بعقد الطرد نفسه.
 * - البوت يقبل `/skip` في خطوة وصف الطرد (اختبار الحوار في `rider-dialog`).
 */
import { describe, expect, it } from "bun:test";
import { requestRide } from "../../packages/application/transport/request-ride.ts";

const NOW = new Date("2026-10-12T09:00:00.000Z");

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

function body(service: string, notes: unknown) {
  return {
    service,
    originLat: 21.4818,
    originLng: 39.1663,
    destinationLat: 21.4225,
    destinationLng: 39.8262,
    notes,
  };
}

async function call(service: string, notes: unknown) {
  const seen: Record<string, unknown>[] = [];
  const result = await requestRide(deps(seen), {
    accessToken: "token",
    idempotencyKey: "wr18-key-123",
    body: body(service, notes),
  });
  return { result, seen };
}

describe("WR-18 — وصف الطرد اختياري ومتّسق بين المسارين", () => {
  it("توصيل بلا وصف (غياب أو فراغ) يُنشأ والوصف null", async () => {
    for (const notes of [undefined, null, "", "   "]) {
      const { result, seen } = await call("delivery", notes);
      expect(result.ok).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.notes).toBeNull();
    }
  });

  it("توصيل بوصف صالح يُنشأ بالوصف منسّقًا", async () => {
    const { result, seen } = await call("delivery", "  صندوق   صغير  ");
    expect(result.ok).toBe(true);
    expect(seen[0]?.notes).toBe("صندوق صغير");
  });

  it("توصيل بوصف مكتوب غير صالح يُرفض بالرمز نفسه الذي يرفض به /v1/deliveries", async () => {
    for (const notes of ["/start", "ab"]) {
      const { result, seen } = await call("delivery", notes);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toBe("PARCEL_DESCRIPTION_INVALID");
      expect(seen).toHaveLength(0);
    }
  });

  it("النقل لا يتأثر: ملاحظة قصيرة أو تبدأ بشرطة تبقى ملاحظة", async () => {
    const { result, seen } = await call("transport", "ab");
    expect(result.ok).toBe(true);
    expect(seen[0]?.notes).toBe("ab");
  });
});
