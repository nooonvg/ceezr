import { describe, expect, test } from "bun:test";
import {
  classifyOfferWait,
  outcomeWithCorr,
  type ScenarioCorr,
  type ScenarioOutcome,
} from "../../deploy/capacity-run/load/miniapp-load.ts";

/**
 * اختباراتُ ربطِ المآلِ بالمعرّفاتِ (`LOAD-01`) — الجولةُ التاريخيةُ خسرت أسبابَ
 * 78 فشلًا لأنَّ مآلاتِها بلا ارتباطٍ؛ هذهِ الاختباراتُ تُثبتُ عقدَ الأداةِ:
 *
 * ١. كلُّ مآلٍ — ناجحًا أو مرفوضًا أو متعثرًا أو خروجًا مبكرًا أو استثناءً —
 *    يحملُ الارتباطَ المتوافرَ (الحقولُ الجزئيةُ تُرفقُ، لا تُسقَطُ كلُّها).
 * ٢. فشلُ قراءةِ اللوحِ صنفٌ مستقلٌ لا يُخلطُ بغيابِ العرضِ: كاملُ الاستطلاعاتِ
 *    فاشلةٌ = `unreadable` (علةُ قراءةٍ لا توزيعٍ)، ومختلطةٌ = `not_found`
 *    (يُشخَّصُ سببُهُ منَ القاعدةِ)، ولا استطلاعَ = `no_polls`.
 * ٣. الربطُ لا يغيّرُ المآلَ الأصليَّ: kind/reason يبقيانِ كما هما — فالتنظيفُ
 *    والتشخيصُ إضافةُ شهودٍ لا تحريفُ حكمٍ.
 */

describe("تصنيف انتظار العرض — فشل القراءة صنف مستقل", () => {
  test("كل الاستطلاعات فاشلة القراءة = unreadable (لا تُوسَّع المهلة لعلّة قراءة)", () => {
    expect(classifyOfferWait({ count: 61, readFailures: 61 })).toBe("unreadable");
  });
  test("قراءات ناجحة مع غياب الهدف = not_found (يشخص سببه من القاعدة)", () => {
    expect(classifyOfferWait({ count: 61, readFailures: 0 })).toBe("not_found");
  });
  test("مختلطة: نجح بعض القراءات = not_found (اللوح مقروء فالغياب حقيقي)", () => {
    expect(classifyOfferWait({ count: 61, readFailures: 3 })).toBe("not_found");
  });
  test("لا استطلاع واحد = no_polls (تمييز صريح لا صفر صامت)", () => {
    expect(classifyOfferWait({ count: 0, readFailures: 0 })).toBe("no_polls");
  });
});

describe("ربط المآل بالمعرّفات — كل مخرج يحمل الشهود المتوافرين", () => {
  const full: ScenarioCorr = {
    index: 42,
    riderTelegramId: 11500042,
    driverTelegramId: 12500042,
    orderId: "ord-42",
    orderCreatedAt: 1792200000000,
    offerWaitStartAt: 1792200000200,
    offerWaitMs: 120000,
    offerPolls: {
      count: 61,
      readFailures: 0,
      targetSeen: false,
      lastStatus: 200,
      lastBoardOffers: 0,
    },
  };

  test("المآل الناجح يخرج بالارتباط الكامل", () => {
    const out = outcomeWithCorr({ kind: "verified" }, full);
    expect(out.kind).toBe("verified");
    expect(out.index).toBe(42);
    expect(out.orderId).toBe("ord-42");
    expect(out.offerPolls?.count).toBe(61);
  });

  test("الخروج المبكر أثناء الإعداد: الارتباط الجزئي يُرفق ولا يسقط كله", () => {
    // فشل قبل إنشاء الطلب: لا orderId ولا offerPolls — والهويتان موجودتان
    const partial: ScenarioCorr = {
      index: 7,
      riderTelegramId: 11500007,
      driverTelegramId: 12500007,
    };
    const out = outcomeWithCorr({ kind: "undecided", reason: "driver_onboarding_failed" }, partial);
    expect(out.kind).toBe("undecided");
    expect(out.reason).toBe("driver_onboarding_failed");
    expect(out.index).toBe(7);
    expect(out.riderTelegramId).toBe(11500007);
    expect(out.orderId).toBeUndefined();
    expect(out.offerPolls).toBeUndefined();
  });

  test("الاستثناء: مآل الاستثناء يحمل ما توافر من هويات (لا يضيع السيناريو بلا شهود)", () => {
    const partial: ScenarioCorr = { index: 9, driverTelegramId: 12500009 };
    const out = outcomeWithCorr({ kind: "undecided", reason: "exception" }, partial);
    expect(out.kind).toBe("undecided");
    expect(out.index).toBe(9);
    expect(out.driverTelegramId).toBe(12500009);
    expect(out.riderTelegramId).toBeUndefined();
  });

  test("الربط لا يحرف الحكم: kind وreason يبقيان كما دخلا", () => {
    for (const base of [
      { kind: "verified" },
      { kind: "rejected", reason: "accept:OFFER_TAKEN" },
      { kind: "undecided", reason: "offer:offer_not_found_in_time" },
    ] as ScenarioOutcome[]) {
      const out = outcomeWithCorr(base, full);
      expect(out.kind).toBe(base.kind);
      expect(out.reason).toBe(base.reason);
    }
  });

  test("الفشل بلا سبب مفصل يبقى بلا سبب مفصل — الربط إضافة حقول لا اختراعها", () => {
    const out = outcomeWithCorr({ kind: "undecided" }, { index: 1 });
    expect(out.reason).toBeUndefined();
    expect(out.index).toBe(1);
  });
});
