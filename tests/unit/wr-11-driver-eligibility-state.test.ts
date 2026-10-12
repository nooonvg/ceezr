/**
 * الغرض: `WR-11` · `WR-16A` — حالةُ السائقِ تقولُ الحقيقة: المتوفّرُ غيرُ المؤهَّلِ (غيرُ موثَّقٍ أو
 *   بلا موضعٍ أو بموضعٍ قديم) لا يُقالُ له «لا عرضَ في هذه اللحظة» ولا يُلوَّنُ أخضر، وعبارةُ البثِّ
 *   لا تدّعي بثًّا والتطبيقُ مغلق.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type { DriverOffersResponse } from "../../apps/miniapp/src/surfaces/driver/offers/offers-contract.ts";
import { toOffersBoard } from "../../apps/miniapp/src/surfaces/driver/offers/offers-view.ts";
import { eligibilityReasonsFrom } from "../../packages/infrastructure/driver/driver-offers-store.ts";
import ar from "../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };

function board(over: Partial<DriverOffersResponse> = {}): DriverOffersResponse {
  return {
    ok: true,
    server_time: "2026-10-12T04:00:00.000Z",
    is_available: true,
    availability_changed_at: null,
    is_blocked: false,
    block_reasons: [],
    offers: [],
    ...over,
  };
}

describe("WR-11 — حكمُ الأهليّةِ بقواعدِ التوزيع", () => {
  test("الموثَّقُ بموضعٍ حديثٍ مؤهَّل", () => {
    expect(
      eligibilityReasonsFrom({
        verificationStatus: "verified",
        hasLocation: true,
        ageSeconds: 30,
        maxAgeSeconds: 600,
      }),
    ).toEqual([]);
  });

  test("قيدُ المراجعةِ NOT_VERIFIED، والمرفوضُ والموقوفُ كذلك", () => {
    for (const status of ["pending", "rejected", "suspended"]) {
      expect(
        eligibilityReasonsFrom({
          verificationStatus: status,
          hasLocation: true,
          ageSeconds: 1,
          maxAgeSeconds: 0,
        }),
      ).toEqual(["NOT_VERIFIED"]);
    }
  });

  test("بلا موضعٍ NO_LOCATION ولو كانَ الحارسُ مطفأً", () => {
    expect(
      eligibilityReasonsFrom({
        verificationStatus: "verified",
        hasLocation: false,
        ageSeconds: null,
        maxAgeSeconds: 0,
      }),
    ).toEqual(["NO_LOCATION"]);
  });

  test("القِدَمُ يُقاسُ فقط والحارسُ مُشغَّل (`driver_location_max_age_seconds` > 0)", () => {
    const old = { verificationStatus: "verified", hasLocation: true, ageSeconds: 3600 };
    expect(eligibilityReasonsFrom({ ...old, maxAgeSeconds: 0 })).toEqual([]);
    expect(eligibilityReasonsFrom({ ...old, maxAgeSeconds: 600 })).toEqual(["STALE_LOCATION"]);
    expect(eligibilityReasonsFrom({ ...old, ageSeconds: null, maxAgeSeconds: 600 })).toEqual([
      "STALE_LOCATION",
    ]);
  });

  test("WR-23 — موضعٌ حكمُه ALERT يُسمّى للسائقِ ولا يُخلَطُ بالقديم، وWARNING لا يمنع", () => {
    const fresh = {
      verificationStatus: "verified",
      hasLocation: true,
      ageSeconds: 30,
      maxAgeSeconds: 600,
    };
    expect(eligibilityReasonsFrom({ ...fresh, locationQuality: "ALERT" })).toEqual([
      "UNTRUSTED_LOCATION",
    ]);
    expect(eligibilityReasonsFrom({ ...fresh, locationQuality: "WARNING" })).toEqual([]);
    expect(eligibilityReasonsFrom({ ...fresh, locationQuality: null })).toEqual([]);
    // القديمُ أولى بالقولِ كترتيبِ `rejectionReasonFor`.
    expect(
      eligibilityReasonsFrom({ ...fresh, ageSeconds: 3600, locationQuality: "ALERT" }),
    ).toEqual(["STALE_LOCATION"]);
  });

  test("الأسبابُ مرتَّبةٌ كترتيبِ التوزيع: التوثيقُ أوّلاً", () => {
    expect(
      eligibilityReasonsFrom({
        verificationStatus: "pending",
        hasLocation: false,
        ageSeconds: null,
        maxAgeSeconds: 600,
      }),
    ).toEqual(["NOT_VERIFIED", "NO_LOCATION"]);
  });
});

describe("WR-11 · WR-16A — اللوحُ يقولُ السببَ ويُلوِّنُ بالأهليّة", () => {
  test("متوفّرٌ قيدَ المراجعةِ: عنوانُ التوثيقِ لا «لا عرض»، ولا أخضر", () => {
    const model = toOffersBoard(board({ eligibility_reasons: ["NOT_VERIFIED"] }));
    expect(model.headlineKey).toBe("driver.offers.headline.notVerified");
    expect(model.isAvailable).toBe(true);
    expect(model.isReady).toBe(false);
  });

  test("بلا موضعٍ وبموضعٍ قديمٍ عنوانانِ مختلفان", () => {
    expect(toOffersBoard(board({ eligibility_reasons: ["NO_LOCATION"] })).headlineKey).toBe(
      "driver.offers.headline.noLocation",
    );
    expect(toOffersBoard(board({ eligibility_reasons: ["STALE_LOCATION"] })).headlineKey).toBe(
      "driver.offers.headline.staleLocation",
    );
  });

  test("WR-23 — موضعٌ غيرُ موثوقٍ له عنوانُه", () => {
    expect(toOffersBoard(board({ eligibility_reasons: ["UNTRUSTED_LOCATION"] })).headlineKey).toBe(
      "driver.offers.headline.untrustedLocation",
    );
  });

  test("المؤهَّلُ بلا عرضٍ ينتظرُ وأخضر", () => {
    const model = toOffersBoard(board({ eligibility_reasons: [] }));
    expect(model.headlineKey).toBe("driver.offers.headline.waiting");
    expect(model.isReady).toBe(true);
  });

  test("الحجبُ ثمَّ عدمُ التوفّرِ يتقدّمانِ على الأهليّة", () => {
    expect(
      toOffersBoard(board({ is_blocked: true, eligibility_reasons: ["NOT_VERIFIED"] })).headlineKey,
    ).toBe("driver.offers.headline.blocked");
    const off = toOffersBoard(board({ is_available: false, eligibility_reasons: ["NO_LOCATION"] }));
    expect(off.headlineKey).toBe("driver.offers.headline.unavailable");
    expect(off.isReady).toBe(false);
  });

  test("بوّابةٌ أقدمُ بلا الحقلِ: السلوكُ السابقُ نفسُه", () => {
    const model = toOffersBoard(board());
    expect(model.headlineKey).toBe("driver.offers.headline.waiting");
    expect(model.isReady).toBe(true);
  });

  test("سببٌ مجهولٌ لا يُخترَعُ له عنوان", () => {
    expect(toOffersBoard(board({ eligibility_reasons: ["SOMETHING_NEW"] })).headlineKey).toBe(
      "driver.offers.headline.waiting",
    );
  });
});

describe("WR-16A — عبارةُ البثِّ لا تدّعي بثًّا والتطبيقُ مغلق", () => {
  const dictionaries: Record<string, Record<string, string>> = { ar, en, ur };
  test("كلُّ لغةٍ لها العناوينُ الثلاثةُ وعبارتا البث", () => {
    for (const dict of Object.values(dictionaries)) {
      for (const key of [
        "driver.offers.headline.notVerified",
        "driver.offers.headline.noLocation",
        "driver.offers.headline.staleLocation",
        "driver.location.on",
        "driver.location.onEvery",
      ]) {
        expect(typeof dict[key]).toBe("string");
      }
      expect(dict["driver.location.onEvery"]).toContain("{seconds}");
    }
  });

  test("العربيّةُ تقولُ إنَّ الإرسالَ ما دامَ التطبيقُ مفتوحًا ويتوقّفُ بإغلاقِه", () => {
    expect(ar["driver.location.onEvery"]).toContain("ما دامت وَصْلة مفتوحة");
    expect(ar["driver.location.onEvery"]).toContain("يتوقّف إذا أغلقتها");
    expect(ar["driver.location.on"]).toContain("يتوقّف إذا أغلقتها");
  });
});
