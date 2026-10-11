/**
 * الغرض: اختباراتُ وحدةٍ لتحقُّقِ وصفِ الطردِ في شاشةِ الاقتباسِ —
 *   يُثبِّتُ أنَّ العميلَ يمنعُ الإرسالَ الفارغَ والقصيرَ والطويلَ وأمرَ البوتِ
 *   قبلَ أن يصلَ إلى البوّابةِ.
 * الحالة: منفَّذ — يُكمِّلُ `F2-04`/`F2-05` لخدمةِ التوصيل.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 */

import { describe, expect, it } from "bun:test";
import {
  hasDeliveryService,
  parcelValidationError,
} from "../../apps/miniapp/src/surfaces/rider/quote/quote-view.ts";

describe("hasDeliveryService", () => {
  it("returns true when delivery is available", () => {
    expect(
      hasDeliveryService([
        { service: "transport", available: true },
        { service: "delivery", available: true },
      ]),
    ).toBe(true);
  });

  it("returns false when delivery is not available", () => {
    expect(
      hasDeliveryService([
        { service: "transport", available: true },
        { service: "delivery", available: false, reason: "NO_DRIVERS" },
      ]),
    ).toBe(false);
  });

  it("returns false when only transport is offered", () => {
    expect(hasDeliveryService([{ service: "transport", available: true }])).toBe(false);
  });

  it("returns false for empty offers", () => {
    expect(hasDeliveryService([])).toBe(false);
  });
});

describe("parcelValidationError", () => {
  it("returns null for a valid description", () => {
    expect(parcelValidationError("صندوقٌ صغيرٌ يحتوي على كتب")).toBeNull();
  });

  it("returns null for minimum length (3 chars)", () => {
    expect(parcelValidationError("abc")).toBeNull();
  });

  it("returns null for maximum length (200 chars)", () => {
    expect(parcelValidationError("a".repeat(200))).toBeNull();
  });

  // WR-18 — قرار المالك: وصف الطرد اختياري، فالفراغ صالح لا خطأ.
  it("returns null for empty string (description is optional, WR-18)", () => {
    expect(parcelValidationError("")).toBeNull();
  });

  it("returns null for whitespace-only string (description is optional, WR-18)", () => {
    expect(parcelValidationError("   ")).toBeNull();
  });

  it("returns too_short error for 2 characters", () => {
    const result = parcelValidationError("ab");
    expect(result).not.toBeNull();
    expect((result as { errorKey: string }).errorKey).toBe("rider.quote.parcel.error.too_short");
  });

  it("returns too_long error for 201 characters", () => {
    const result = parcelValidationError("a".repeat(201));
    expect(result).not.toBeNull();
    expect((result as { errorKey: string }).errorKey).toBe("rider.quote.parcel.error.too_long");
  });

  it("returns command error for slash-prefixed text", () => {
    const result = parcelValidationError("/skip");
    expect(result).not.toBeNull();
    expect((result as { errorKey: string }).errorKey).toBe("rider.quote.parcel.error.command");
  });

  it("trims before checking length", () => {
    expect(parcelValidationError("  abc  ")).toBeNull();
  });
});
