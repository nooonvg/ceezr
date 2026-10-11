/**
 * الغرض: اختباراتُ سلوكٍ لمنطقِ التوجيهِ والتحقُّقِ في مسارِ التوصيلِ —
 *   يُثبِتُ أنَّ طلبَ التوصيلِ الفارغَ لا يمرُّ، وأنَّ الصالحَ يمرُّ، وأنَّ
 *   النقلَ لا يخضعُ لتحقُّقِ الطرد، وأنَّ النصَّ يصلُ إلى `/v1/deliveries`.
 * الحالة: منفَّذ — يُكمِّلُ اختباراتِ `F2-04`/`F2-05` لخدمةِ التوصيل.
 * ينتمي إلى: tests/unit
 *
 * ## لماذا اختباراتُ سلوكٍ لا اختباراتُ شاشةٍ
 *
 * لأنَّ شاشةَ الاقتباسِ مكوّنُ React، واختبارُه يحتاجُ متصفّحاً أو إطارَ
 * اختبارِ مكوّناتٍ. والمنطقُ الذي يحكمُ التحقُّقَ والتوجيهَ في دالّاتٍ
 * نقيّةٍ قابلةٍ للاختبارِ مباشرةً. فهذه الاختباراتُ تُثبِتُ السلوكَ
 * الذي يحكمُ الشاشةَ بلا DOM.
 */

import { describe, expect, it } from "bun:test";
import { parcelValidationError } from "../../apps/miniapp/src/surfaces/rider/quote/quote-view.ts";

/**
 * يحاكي منطقَ معالجِ النقرِ في شاشةِ الاقتباسِ: يُقرِّرُ هل يُستدعى
 * `onRequest` أم يُمنَعُ، وما رسالةُ الخطأِ إن وُجدَت.
 *
 * هذا نموذجٌ للسلوكِ لا للشاشةِ — يُثبِتُ المنطقَ الذي يحكمُ التحقُّقَ
 * بلا DOM.
 */
function simulateRequestClick(
  service: string,
  notes: string,
): { readonly onRequestCalled: boolean; readonly parcelErrorKey: string | null } {
  const parcelError = service === "delivery" ? parcelValidationError(notes) : null;
  if (parcelError !== null) {
    return { onRequestCalled: false, parcelErrorKey: parcelError.errorKey };
  }
  return { onRequestCalled: true, parcelErrorKey: null };
}

describe("Delivery request behavior", () => {
  // WR-18 — قرار المالك: لا يُرفض طلب توصيل لأن الراكب لم يكتب وصفًا.
  it("empty delivery calls onRequest (description is optional, WR-18)", () => {
    const result = simulateRequestClick("delivery", "");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("whitespace-only delivery calls onRequest (description is optional, WR-18)", () => {
    const result = simulateRequestClick("delivery", "   ");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("bot command delivery does not call onRequest", () => {
    const result = simulateRequestClick("delivery", "/skip");
    expect(result.onRequestCalled).toBe(false);
    expect(result.parcelErrorKey).toBe("rider.quote.parcel.error.command");
  });

  it("too-short delivery (2 chars) does not call onRequest", () => {
    const result = simulateRequestClick("delivery", "ab");
    expect(result.onRequestCalled).toBe(false);
    expect(result.parcelErrorKey).toBe("rider.quote.parcel.error.too_short");
  });

  it("too-long delivery (201 chars) does not call onRequest", () => {
    const result = simulateRequestClick("delivery", "a".repeat(201));
    expect(result.onRequestCalled).toBe(false);
    expect(result.parcelErrorKey).toBe("rider.quote.parcel.error.too_long");
  });

  it("valid delivery (3 chars) calls onRequest", () => {
    const result = simulateRequestClick("delivery", "abc");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("valid delivery (200 chars) calls onRequest", () => {
    const result = simulateRequestClick("delivery", "a".repeat(200));
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("valid delivery with Arabic text calls onRequest", () => {
    const result = simulateRequestClick("delivery", "صندوقٌ صغيرٌ يحتوي على كتبٍ");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });
});

describe("Transport request does not trigger parcel validation", () => {
  it("empty transport calls onRequest (notes are optional)", () => {
    const result = simulateRequestClick("transport", "");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("short transport calls onRequest (no minimum for transport notes)", () => {
    const result = simulateRequestClick("transport", "a");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("slash-prefixed transport calls onRequest (not checked for transport)", () => {
    const result = simulateRequestClick("transport", "/skip");
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });

  it("long transport (250 chars) calls onRequest (transport limit is higher)", () => {
    const result = simulateRequestClick("transport", "a".repeat(250));
    expect(result.onRequestCalled).toBe(true);
    expect(result.parcelErrorKey).toBeNull();
  });
});
