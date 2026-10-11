/**
 * الغرض: إثباتُ سلوكِ تجربةِ السائقِ D0–D14 عبرَ آلةِ الحالةِ النقيّةِ **ومعالجاتِها الحقيقيّة**
 *   (`driverFlowHandlers`) — عينُ ما يربطُه `DriverRoot.tsx` بالشاشات.
 * الحالة: منفّذ فعلياً — UI-4 (ADR 0236).
 *
 * حدٌّ معلَن: المستودعُ بلا بيئةِ DOM ولا تُضافُ تبعيّة. ما يُقاسُ ههنا هوَ القرارُ (أيُّ شاشةٍ،
 * أيُّ تبويبٍ، أيُّ حركةٍ، وما يُرفَض)؛ ربطُ JSX بالمعالجِ يحرسُه `driver-root.test.tsx`.
 */

import { describe, expect, it } from "bun:test";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { ROOT_TABS } from "../../shell/root-tabs.ts";
import { currentScreenKey } from "../../shell/screen-stack.ts";
import {
  broadcastsLocation,
  DRIVER_TITLE_KEY,
  type DriverFlowAction,
  type DriverFlowState,
  driverFlowHandlers,
  driverFlowReducer,
  driverFlowView,
  initialDriverFlow,
} from "./driver-flow.ts";
import type { DriverEntryView } from "./entry-view.ts";

const OFFER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ORDER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function harness(entry: DriverEntryView = { kind: "offers" }) {
  let state: DriverFlowState = initialDriverFlow(entry);
  const dispatch = (action: DriverFlowAction) => {
    state = driverFlowReducer(state, action);
  };
  const go = driverFlowHandlers(dispatch);
  return {
    go,
    get state() {
      return state;
    },
    get view() {
      return driverFlowView(state);
    },
  };
}

describe("D0 — الحالُ الأولى من هدفِ الهبوطِ (ADR 0213)", () => {
  const cases: readonly [DriverEntryView, string, string | null][] = [
    [{ kind: "offers" }, "offers", null],
    [{ kind: "offer", offerId: OFFER }, "offers", "offer"],
    [{ kind: "job" }, "job", null],
    [{ kind: "activity" }, "earnings", null],
    [{ kind: "account" }, "account", null],
    [{ kind: "summary", orderId: ORDER }, "job", "summary"],
    [{ kind: "documents" }, "offers", "documents"],
    [{ kind: "subscription" }, "offers", "subscription"],
    [{ kind: "support" }, "offers", "support"],
    [{ kind: "vehicle" }, "account", "vehicle"],
  ];
  for (const [entry, tab, flow] of cases) {
    it(`${entry.kind} ⇒ تبويبُ ${tab}${flow === null ? "" : ` + ${flow}`}`, () => {
      const state = initialDriverFlow(entry);
      expect(state.tab).toBe(tab as never);
      const view = driverFlowView(state);
      if (flow === null) expect(view).toEqual({ screen: "root", tab: tab as never });
      else expect(view.screen === "flow" ? view.flow.kind : null).toBe(flow as never);
      // الهبوطُ ليسَ انتقالاً: لا حركةَ تقدّمٍ تُعلَنُ في أوّلِ رسم… إلّا لتدفّقٍ مدفوعٍ فوقَ جذره.
      expect(state.motion).toBe(flow === null ? "none" : "forward");
    });
  }

  it("هبوطٌ على عرضٍ يحملُ معرّفَه نفسَه، ورجوعُه إلى لوحِ العروض", () => {
    const h = harness({ kind: "offer", offerId: OFFER });
    expect(h.view).toEqual({ screen: "flow", flow: { kind: "offer", offerId: OFFER } });
    h.go.back();
    expect(h.view).toEqual({ screen: "root", tab: "offers" });
  });
});

describe("D1→D3 — لوحُ العروضِ وبطاقةُ العرضِ وتفاصيلُه", () => {
  it("فتحُ عرضٍ من اللوحِ يدفعُ التفاصيلَ بحركةِ تقدّم", () => {
    const h = harness();
    h.go.openOffer(OFFER);
    expect(h.view).toEqual({ screen: "flow", flow: { kind: "offer", offerId: OFFER } });
    expect(h.state.motion).toBe("forward");
  });

  it("قبولٌ ظفرَ ⇒ «مهمّتي» بمكدّسٍ فارغ — لا يبقى عرضٌ مقبولٌ تحتَ المَهمّة", () => {
    const h = harness();
    h.go.openOffer(OFFER);
    h.go.offerAccepted();
    expect(h.view).toEqual({ screen: "root", tab: "job" });
    expect(h.state.stack).toHaveLength(0);
    // والرجوعُ بعدَه لا يُعيدُ العرضَ: لا شيءَ في المكدّس.
    const before = h.state;
    h.go.back();
    expect(h.state).toBe(before);
  });

  it("رفضٌ نجحَ ⇒ رجوعٌ إلى اللوحِ بحركةِ رجوع", () => {
    const h = harness();
    h.go.openOffer(OFFER);
    h.go.offerRejected();
    expect(h.view).toEqual({ screen: "root", tab: "offers" });
    expect(h.state.motion).toBe("back");
  });

  it("سلبيّ: قبولٌ أو رفضٌ بلا عرضٍ ظاهرٍ يُرفَضانِ بالمرجعِ نفسِه", () => {
    const h = harness();
    const before = h.state;
    h.go.offerAccepted();
    h.go.offerRejected();
    expect(h.state).toBe(before);
  });

  it("سلبيّ: عرضٌ لا يُفتَحُ من تبويبٍ آخرَ ولا فوقَ تدفّقٍ مفتوح", () => {
    const h = harness();
    h.go.selectTab("job");
    const onJob = h.state;
    h.go.openOffer(OFFER);
    expect(h.state).toBe(onJob);
    h.go.selectTab("offers");
    h.go.openSupport();
    const onSupport = h.state;
    h.go.openOffer(OFFER);
    expect(h.state).toBe(onSupport);
  });
});

describe("D4→D6 — المَهمّةُ واكتمالُها", () => {
  it("اكتمالُ رحلةٍ في «مهمّتي» يفتحُ ملخّصَها، والرجوعُ يعودُ إلى المَهمّة", () => {
    const h = harness({ kind: "job" });
    h.go.jobCompleted(ORDER);
    expect(h.view).toEqual({ screen: "flow", flow: { kind: "summary", orderId: ORDER } });
    h.go.back();
    expect(h.view).toEqual({ screen: "root", tab: "job" });
  });

  it("سلبيّ: لا ملخّصَ من لوحِ العروضِ ولا ملخّصٌ فوقَ ملخّص", () => {
    const h = harness();
    const before = h.state;
    h.go.jobCompleted(ORDER);
    expect(h.state).toBe(before);
    const j = harness({ kind: "summary", orderId: ORDER });
    const top = j.state;
    j.go.jobCompleted(ORDER);
    expect(j.state).toBe(top);
  });

  it("D0: بثُّ الموقعِ جزءُ الهيكل — في جذرَي العروضِ والمَهمّةِ وحدَهما", () => {
    expect(broadcastsLocation({ screen: "root", tab: "offers" })).toBe(true);
    expect(broadcastsLocation({ screen: "root", tab: "job" })).toBe(true);
    expect(broadcastsLocation({ screen: "root", tab: "earnings" })).toBe(false);
    expect(broadcastsLocation({ screen: "root", tab: "account" })).toBe(false);
    expect(broadcastsLocation({ screen: "flow", flow: { kind: "offer", offerId: OFFER } })).toBe(
      false,
    );
  });
});

describe("D8–D13 — الوثائقُ والمركبةُ والاشتراكُ والحسابُ والدعم", () => {
  it("D12→D8: «حسابي» ← الوثائق ← رجوعٌ إلى «حسابي»", () => {
    const h = harness();
    h.go.selectTab("account");
    h.go.openDocuments();
    expect(h.view).toEqual({ screen: "flow", flow: { kind: "documents", focusDocType: null } });
    h.go.back();
    expect(h.view).toEqual({ screen: "root", tab: "account" });
  });

  it("D1→D8: إصلاحُ حجبٍ من اللوحِ يفتحُ الوثائقَ ببؤرةِ النوعِ نفسِه", () => {
    const h = harness();
    h.go.openDocuments("driving_license");
    expect(h.view).toEqual({
      screen: "flow",
      flow: { kind: "documents", focusDocType: "driving_license" },
    });
  });

  it("D9/D11: المركبةُ والاشتراكُ يُفتَحانِ ويُرجَعُ منهما إلى الجذرِ نفسِه", () => {
    const h = harness({ kind: "account" });
    h.go.openVehicle();
    expect(h.view.screen === "flow" ? h.view.flow.kind : null).toBe("vehicle");
    h.go.back();
    h.go.openSubscription();
    expect(h.view.screen === "flow" ? h.view.flow.kind : null).toBe("subscription");
    h.go.back();
    expect(h.view).toEqual({ screen: "root", tab: "account" });
  });

  it("D13: كشفُ الخصومِ من دعمِ السائقِ وحدَه، والرجوعُ منه إلى الدعم ثمّ إلى الجذر", () => {
    const h = harness();
    h.go.openSupport();
    h.go.openDeductionTrace();
    expect(h.view.screen === "flow" ? h.view.flow.kind : null).toBe("deductionTrace");
    h.go.back();
    expect(h.view.screen === "flow" ? h.view.flow.kind : null).toBe("support");
    h.go.back();
    expect(h.view).toEqual({ screen: "root", tab: "offers" });
  });

  it("سلبيّ: كشفُ خصومٍ بلا دعمٍ ظاهرٍ، وشاشةٌ تُفتَحُ مرّتَين في التدفّق — كلاهما مرفوض", () => {
    const h = harness();
    const before = h.state;
    h.go.openDeductionTrace();
    expect(h.state).toBe(before);
    h.go.openSupport();
    const onSupport = h.state;
    h.go.openSupport();
    expect(h.state).toBe(onSupport);
    h.go.openDeductionTrace();
    h.go.openSupport();
    expect(h.state.stack.map((e) => e.screen.kind)).toEqual(["support", "deductionTrace"]);
  });
});

describe("التبويبُ والمكدّس (§6 · UI-2)", () => {
  it("تبديلُ التبويبِ يمسحُ المكدّسَ مهما عمُق، وإعادةُ النشطِ تعودُ إلى جذره", () => {
    const h = harness();
    h.go.openSupport();
    h.go.openDeductionTrace();
    h.go.selectTab("earnings");
    expect(h.view).toEqual({ screen: "root", tab: "earnings" });
    expect(h.state.stack).toHaveLength(0);
    h.go.openVehicle();
    h.go.selectTab("earnings");
    expect(h.view).toEqual({ screen: "root", tab: "earnings" });
  });

  it("إعادةُ اختيارِ التبويبِ النشطِ على جذرِه لا تُغيّرُ المرجع", () => {
    const h = harness();
    const before = h.state;
    h.go.selectTab("offers");
    expect(h.state).toBe(before);
  });

  it("مفتاحُ الشاشةِ يتغيّرُ معَ كلِّ دفعٍ فتُعادُ الحركةُ، ويعودُ بالرجوع", () => {
    const h = harness();
    const root = currentScreenKey(h.state);
    h.go.openOffer(OFFER);
    const offer = currentScreenKey(h.state);
    expect(offer).not.toBe(root);
    h.go.offerRejected();
    expect(currentScreenKey(h.state)).toBe(root);
    h.go.openOffer(OFFER);
    expect(currentScreenKey(h.state)).not.toBe(offer);
  });

  it("تسلسلٌ كاملٌ: لوح ← عرض ← قبول ← مهمّة ← اكتمال ← ملخّص ← رجوع ← العروض", () => {
    const h = harness();
    h.go.openOffer(OFFER);
    h.go.offerAccepted();
    h.go.jobCompleted(ORDER);
    expect(h.view).toEqual({ screen: "flow", flow: { kind: "summary", orderId: ORDER } });
    h.go.back();
    h.go.selectTab("offers");
    expect(h.view).toEqual({ screen: "root", tab: "offers" });
    expect(h.state.stack).toHaveLength(0);
  });
});

describe("العناوينُ والوسوم — من القاموسِ في اللغاتِ الثلاث", () => {
  it("لكلِّ تبويبٍ وشاشةِ تدفّقٍ مفتاحُ عنوانٍ موجودٌ غيرُ فارغ", () => {
    const kinds = [
      ...ROOT_TABS.driver,
      "offer",
      "summary",
      "documents",
      "vehicle",
      "subscription",
      "support",
      "deductionTrace",
    ] as const;
    expect(Object.keys(DRIVER_TITLE_KEY).sort()).toEqual([...kinds].sort());
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const kind of kinds) {
        const key = DRIVER_TITLE_KEY[kind];
        expect(dictionary[key]?.trim(), `${key} @ ${language}`).toBeTruthy();
      }
    }
  });

  it("مفاتيحُ UI-4 الجديدةُ في اللغاتِ الثلاثِ، وعناصرُ الإحلالِ محفوظة", () => {
    const keys: Record<string, readonly string[]> = {
      "driver.tabs.offers": [],
      "driver.tabs.job": [],
      "driver.tabs.earnings": [],
      "driver.tabs.account": [],
      "driver.tabs.navigation": [],
      "driver.nav.back": [],
      "driver.offers.timer.label": [],
      "driver.offers.timer.leftAtRender": ["{value}"],
      "driver.documents.step.position": ["{current}", "{total}"],
      "driver.summary.retry": [],
      "driver.account.work.label": [],
      "driver.account.work.documents": [],
      "driver.account.work.vehicle": [],
      "driver.account.work.subscription": [],
    };
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const [key, placeholders] of Object.entries(keys)) {
        const text = dictionary[key];
        expect(text?.trim(), `${key} @ ${language}`).toBeTruthy();
        for (const placeholder of placeholders) expect(text).toContain(placeholder);
      }
    }
  });
});

describe("WR-20 — المهمة النشطة تُفتح عند الدخول (§20)", () => {
  it("الدخول الافتراضي مع مهمة نشطة من الخادم يفتح «مهمّتي»", () => {
    const h = harness();
    expect(h.view).toEqual({ screen: "root", tab: "offers" });
    h.go.activeJobFound();
    expect(h.view).toEqual({ screen: "root", tab: "job" });
  });

  it("لا يقطع شاشة فتحها السائق قبل وصول الرد", () => {
    const h = harness();
    h.go.openOffer(OFFER);
    h.go.activeJobFound();
    expect(h.view.screen).toBe("flow");
    expect(h.state.tab).toBe("offers");
  });

  it("لا يقطع تبويبًا اختاره السائق قبل وصول الرد", () => {
    const h = harness();
    h.go.selectTab("account");
    h.go.activeJobFound();
    expect(h.view).toEqual({ screen: "root", tab: "account" });
  });

  it("تكرار الإشارة لا يغيّر شيئًا وهو في «مهمّتي»", () => {
    const h = harness({ kind: "job" });
    const before = h.state;
    h.go.activeJobFound();
    expect(h.state).toBe(before);
  });
});
