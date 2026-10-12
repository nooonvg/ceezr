/**
 * الغرض: إثباتُ حالاتِ الاقتباسِ والرفضِ والتعذّرِ وعدمِ اختلاقِ معلومةٍ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { ApiEtaVerdict, ApiServiceOffer } from "./quote-contract.ts";
import {
  distanceLine,
  durationLine,
  isRetryableQuoteError,
  quoteErrorKey,
  quoteRefusalKey,
  refusalRemedy,
  serviceCards,
} from "./quote-view.ts";

const SCREEN = readFileSync(new URL("./QuoteScreen.tsx", import.meta.url), "utf8");

describe("نموذجُ عرضِ الاقتباسِ (R5)", () => {
  it("سببُ امتناعِ المدّةِ يُعرَضُ، والسببُ المجهولُ لا يتحوّلُ إلى رقمٍ", () => {
    const unavailable: ApiEtaVerdict = { kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" };
    expect(durationLine(unavailable)).toEqual({
      kind: "UNAVAILABLE",
      reasonKey: "rider.quote.duration.providerDown",
    });
    expect(durationLine({ kind: "UNAVAILABLE", reason: "FUTURE_REASON" })).toEqual({
      kind: "UNAVAILABLE",
      reasonKey: "rider.quote.duration.unknown",
    });
    expect(distanceLine({ kind: "FUTURE_DISTANCE", meters: 1000 })).toBeNull();
  });

  it("الخدماتُ غيرُ المتاحةِ تُذكرُ بسببِها ولا تُعطي فعلاً؛ لا خدماتَ تعني حالةً فارغةً صريحة", () => {
    const offers: readonly ApiServiceOffer[] = [
      { service: "transport", available: false, reason: "NO_CAPABLE_DRIVER_IN_CITY" },
      { service: "future-service", available: true },
    ];
    expect(serviceCards(offers)).toEqual([
      {
        service: "transport",
        labelKey: "rider.quote.service.transport",
        available: false,
        reasonKey: "rider.quote.service.noCapableDriver",
      },
    ]);
    expect(serviceCards([])).toEqual([]);
    // `WR-17`: لا بطاقةَ بزرِّ طلب؛ الخدمةُ المختارةُ غيرُ المخدومةِ تُعرَضُ بسببِها بلا نموذج،
    // ولا خدمةَ متاحةً تعني حالةً فارغةً صريحة.
    expect(SCREEN).toContain("choosable.length === 0");
    expect(SCREEN).toContain('t("rider.quote.services.empty")');
    expect(SCREEN).toContain("chosenCard !== null && !chosenCard.available");
  });

  it("الرفضُ يقدّمُ العلاجَ الممكنَ فقط؛ ولا حلَّ مخترعاً للسببِ المجهول", () => {
    expect(quoteRefusalKey("FUTURE_REFUSAL")).toBe("rider.quote.refused.unknown");
    expect(refusalRemedy("ORIGIN_OUTSIDE_SERVICE_AREA")).toBe("RELOCATE");
    expect(refusalRemedy("DESTINATION_OUTSIDE_SERVICE_AREA")).toBe("PICK_ANOTHER_DESTINATION");
    expect(refusalRemedy("CITY_HAS_NO_SERVICE_AREA")).toBe("NONE");
    expect(refusalRemedy("FUTURE_REFUSAL")).toBe("NONE");
  });

  it("أخطاءُ الشبكة والخادم لها تصنيفٌ موحّدٌ؛ إعادةُ المحاولة ليست لكلِّ رفض", () => {
    expect(quoteErrorKey("FUTURE_ERROR")).toBe("rider.quote.error.unavailable");
    expect(isRetryableQuoteError("QUOTE_STORE_NOT_AVAILABLE")).toBe(true);
    expect(isRetryableQuoteError("MALFORMED")).toBe(false);
    expect(SCREEN).toContain("failureFromThrown(thrown)");
    expect(SCREEN).toContain("setSystem({ screen })");
  });
});
