/**
 * الغرض: `WR-05` — قاعدةُ سياسةِ المبلغِ الواحدةُ للمسارات، ومعناها على بطاقةِ السائق.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, it } from "bun:test";
import { offerPolicyFrom } from "../../apps/miniapp/src/surfaces/rider/quote/quote-view.ts";
import {
  readOfferAmount,
  readOfferPolicy,
} from "../../packages/application/transport/offer-policy.ts";
import { t } from "../../packages/shared/i18n/index.ts";
import { offerTermLine, orderTermsLines } from "../../packages/shared/order-terms/index.ts";

describe("WR-05 — قاعدةُ المبلغِ في البوّابة", () => {
  it("الأرقامُ العربيّةُ والهنديّةُ تُقرأ، والصفرُ والسالبُ والكسرُ والنصُّ تُرفَض", () => {
    expect(readOfferAmount("٤٠")).toBe(40);
    expect(readOfferAmount("۲۵")).toBe(25);
    expect(readOfferAmount(" 40 ")).toBe(40);
    expect(readOfferAmount(10_000)).toBe(10_000);
    for (const bad of [0, "0", -5, "-5", 4.5, "4.5", "abc", 10_001, "١٠٠٠١", true, {}]) {
      expect(readOfferAmount(bad)).toBeNull();
    }
  });

  it("محدَّدٌ ومقترَحٌ يلزمُهما مبلغ، وبلا سعرٍ يمنعُه", () => {
    expect(readOfferPolicy({ offerMode: "fixed", offerSar: "٤٠" })).toEqual({
      policy: { offerMode: "fixed", offerSar: 40 },
    });
    expect(readOfferPolicy({ offerMode: "suggested", offerSar: 30 })).toEqual({
      policy: { offerMode: "suggested", offerSar: 30 },
    });
    expect(readOfferPolicy({ offerMode: "open", offerSar: undefined })).toEqual({
      policy: { offerMode: "open", offerSar: null },
    });
    expect(readOfferPolicy({ offerMode: "fixed", offerSar: "" })).toEqual({
      refusal: "OFFER_AMOUNT_REQUIRED",
    });
    expect(readOfferPolicy({ offerMode: "suggested", offerSar: 0 })).toEqual({
      refusal: "OFFER_AMOUNT_INVALID",
    });
    expect(readOfferPolicy({ offerMode: "fixed", offerSar: -3 })).toEqual({
      refusal: "OFFER_AMOUNT_INVALID",
    });
    expect(readOfferPolicy({ offerMode: "open", offerSar: 40 })).toEqual({
      refusal: "OFFER_AMOUNT_UNEXPECTED",
    });
    expect(readOfferPolicy({ offerMode: "auto", offerSar: 40 })).toEqual({
      refusal: "OFFER_MODE_INVALID",
    });
  });

  it("العميلُ الأقدمُ: المعطوبُ يُرفَضُ ولا يصيرُ «بلا سعر» صامتاً", () => {
    expect(readOfferPolicy({ offerMode: undefined, offerSar: undefined })).toEqual({
      policy: { offerMode: "open", offerSar: null },
    });
    expect(readOfferPolicy({ offerMode: undefined, offerSar: 40 })).toEqual({
      policy: { offerMode: "suggested", offerSar: 40 },
    });
    expect(readOfferPolicy({ offerMode: undefined, offerSar: "abc" })).toEqual({
      refusal: "OFFER_AMOUNT_INVALID",
    });
  });
});

describe("WR-05 — معنى المبلغِ على بطاقةِ السائق", () => {
  const tr = t("ar");
  it("النصوصُ الثلاثةُ كما طُلِبَت", () => {
    expect(offerTermLine(tr, "fixed", 40)).toContain("سعر محدد");
    expect(offerTermLine(tr, "fixed", 40)).toContain("غير قابل للتفاوض");
    expect(offerTermLine(tr, "fixed", 40)).toContain("40");
    expect(offerTermLine(tr, "suggested", 30)).toContain("السعر قابل للتفاوض");
    expect(offerTermLine(tr, "open", null)).toContain(
      "السعر غير محدد — اتفق مع طالب الخدمة عبر المحادثة",
    );
  });
  it("الطلبُ الأقدمُ يبقى بنصِّه القديم", () => {
    expect(offerTermLine(tr, null, null)).toBe(tr("driver.offer_card_paid_negotiable"));
    expect(offerTermLine(tr, undefined, 40)).toBe(tr("driver.offer_card_paid", { amount: 40 }));
  });
  it("البطاقةُ تحملُ السطرَ مع الشروط", () => {
    const lines = orderTermsLines(tr, "transport", {
      pickupAt: null,
      parcel: null,
      offerSar: 40,
      offerMode: "fixed",
    });
    expect(lines.some((l) => l.includes("غير قابل للتفاوض"))).toBe(true);
  });
});

describe("WR-05 — النموذجُ في Mini App", () => {
  it("بلا سعرٍ لا يقرأُ الحقل، وغيرُه يلزمُه مبلغٌ صحيح", () => {
    expect(offerPolicyFrom("open", "40")).toEqual({ ok: true, offerMode: "open", offerSar: null });
    expect(offerPolicyFrom("fixed", "٤٠")).toEqual({ ok: true, offerMode: "fixed", offerSar: 40 });
    expect(offerPolicyFrom("fixed", "")).toEqual({ ok: false, error: "required" });
    expect(offerPolicyFrom("suggested", "0")).toEqual({ ok: false, error: "invalid" });
    expect(offerPolicyFrom("suggested", "-1")).toEqual({ ok: false, error: "invalid" });
  });
});
