/**
 * الغرض: ربطُ تدفّقِ R0–R5 بمكدّسِ UI-2: الوجهةُ ← الاقتباسُ ← الرجوعُ،
 *   والتبويباتُ الجذريّةُ والحركةُ المنطقيّةُ.
 * الحالة: اختباراتُ المخفِّضِ النقيِّ + عقودُ وصلٍ ساكنةٌ؛ لا بيئةَ DOM تفاعليّةً.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppDictionary,
  miniAppTranslator,
  translateMiniApp,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { ROOT_TABS } from "../../shell/root-tabs.ts";
import { RootTabBar, ScreenTransition } from "../../shell/ScreenFrame.tsx";
import { currentScreenKey, screenStackReducer } from "../../shell/screen-stack.ts";
import { type ConfirmedDestination, DestinationScreen } from "./destination/DestinationScreen.tsx";
import { type ChosenDestination, HomeScreen } from "./home/HomeScreen.tsx";
import { QuoteScreen } from "./quote/QuoteScreen.tsx";
import RiderRoot from "./RiderRoot.tsx";
import {
  initialRiderFlow,
  type RiderFlowAction,
  type RiderFlowScreen,
  type RiderFlowState,
  type RiderRootTab,
  riderFlowHandlers,
  riderFlowReducer,
  riderFlowView,
} from "./rider-flow.ts";
import type { SearchScreenIntent } from "./search/SearchScreen.tsx";

const SOURCE = readFileSync(new URL("./RiderRoot.tsx", import.meta.url), "utf8");

// ─── R3 → R4 → R5 → R6: يُقادُ بالمعالجاتِ نفسِها التي يربطُها RiderRoot ─────────
//
// حدٌّ معلَن: المستودعُ بلا بيئةِ DOM ولا تُضافُ تبعيّة. فما يُقاسُ ههنا هوَ آلةُ الحالةِ
// النقيّةُ ومعالجاتُها الحقيقيّةُ (`riderFlowHandlers`) — وهيَ عينُ ما تتلقّاه الشاشاتُ —
// معَ `riderFlowView` الذي يقرّرُ أيَّ شاشةٍ ترسمُ RiderRoot. ربطُ JSX بالمعالجِ يحرسُه عقدُ
// المصدرِ أدناه؛ والنقرُ في DOM حيٍّ خارجَ هذا الاختبار (ADR 0235).

const PICKED: ChosenDestination = { label: "Mall", lat: 24.7, lng: 46.6, service: "transport" };
const CONFIRMED: ConfirmedDestination = { label: "Mall", lat: 24.7, lng: 46.6, cityCode: "RUH" };
const INTENT = {
  service: "transport",
  originLat: 24.6,
  originLng: 46.5,
  destinationLat: 24.7,
  destinationLng: 46.6,
  destinationLabel: "Mall",
  pickupLabel: null,
  notes: null,
  idempotencyKey: "k-1",
} as unknown as SearchScreenIntent;

/** مُشغِّلٌ يحاكي `useReducer` + `setIntent` بلا React: الحالةُ تتقدّمُ بكلِّ نداءٍ للمعالج. */
function harness() {
  let state: RiderFlowState = initialRiderFlow();
  const handedOff: SearchScreenIntent[] = [];
  const dispatch = (action: RiderFlowAction) => {
    state = riderFlowReducer(state, action);
  };
  const handlers = riderFlowHandlers(dispatch, (intent) => handedOff.push(intent));
  return {
    handlers,
    dispatch,
    handedOff,
    get state() {
      return state;
    },
    get view() {
      return riderFlowView(state);
    },
  };
}

describe("RiderRoot — تدفّقُ R3→R5 عبرَ المعالجاتِ الحقيقيّة", () => {
  it("١) اختيارُ وجهةٍ من Home يعرضُ Destination بحركةِ تقدّم", () => {
    const h = harness();
    expect(h.view).toEqual({ screen: "home" });
    h.handlers.onDestinationChosen(PICKED);
    expect(h.view).toEqual({ screen: "destination", chosen: PICKED });
    expect(h.state.stack.motion).toBe("forward");
    expect(currentScreenKey(h.state.stack)).not.toBe("tab:home");
  });

  it("٢) تأكيدُ الوجهةِ يعرضُ Quote بالوجهةِ المُصادَقةِ لا المختارة", () => {
    const h = harness();
    h.handlers.onDestinationChosen(PICKED);
    h.handlers.onConfirmed(CONFIRMED);
    expect(h.view).toEqual({ screen: "quote", confirmed: CONFIRMED });
    expect(h.state.stack.stack.map((e) => e.screen)).toEqual(["destination", "quote"]);
    expect(h.state.stack.motion).toBe("forward");
  });

  it("٣) Back من Quote يعودُ إلى Destination بالاختيارِ نفسِه ويُسقِطُ الحكم", () => {
    const h = harness();
    h.handlers.onDestinationChosen(PICKED);
    const destinationKey = currentScreenKey(h.state.stack);
    h.handlers.onConfirmed(CONFIRMED);
    h.handlers.onBack();
    expect(h.view).toEqual({ screen: "destination", chosen: PICKED });
    expect(h.state.confirmed).toBeNull();
    expect(h.state.stack.motion).toBe("back");
    expect(currentScreenKey(h.state.stack)).toBe(destinationKey);
  });

  it("٤) Back من Destination يعودُ إلى Home بلا اختيارٍ معلّق", () => {
    const h = harness();
    h.handlers.onDestinationChosen(PICKED);
    h.handlers.onConfirmed(CONFIRMED);
    h.handlers.onBack();
    h.handlers.onBack();
    expect(h.view).toEqual({ screen: "home" });
    expect(h.state.chosen).toBeNull();
    expect(h.state.stack.stack).toHaveLength(0);
    expect(h.state.stack.tab).toBe("home");
    expect(currentScreenKey(h.state.stack)).toBe("tab:home");
  });

  it("٥) Request من Quote يُفرِّغُ التدفّقَ ثمّ يسلّمُ النيّةَ نفسَها إلى R6 مرّةً واحدة", () => {
    const h = harness();
    h.handlers.onDestinationChosen(PICKED);
    h.handlers.onConfirmed(CONFIRMED);
    h.handlers.onRequest(INTENT);
    expect(h.handedOff).toEqual([INTENT]);
    expect(h.handedOff[0]).toBe(INTENT);
    expect(h.state.stack.stack).toHaveLength(0);
    expect(h.state.chosen).toBeNull();
    expect(h.state.confirmed).toBeNull();
    // تحتَ R6 لا يبقى اقتباسٌ قديمٌ: الرجوعُ من R6 (`clear`) يجدُ الرئيسية.
    h.dispatch({ type: "clear" });
    expect(h.view).toEqual({ screen: "home" });
  });

  it("سلبيّ: Back على Home لا يفعلُ شيئاً — المرجعُ نفسُه", () => {
    const h = harness();
    const before = h.state;
    h.handlers.onBack();
    expect(h.state).toBe(before);
  });

  it("سلبيّ: تأكيدٌ بلا Destination ظاهرةٍ لا يقفزُ إلى Quote", () => {
    const h = harness();
    const before = h.state;
    h.handlers.onConfirmed(CONFIRMED);
    expect(h.state).toBe(before);
    expect(h.view).toEqual({ screen: "home" });
  });

  it("سلبيّ: اختيارٌ ثانٍ فوقَ Destination لا يكدّسُ وجهتين", () => {
    const h = harness();
    h.handlers.onDestinationChosen(PICKED);
    const before = h.state;
    h.handlers.onDestinationChosen({ ...PICKED, label: "Other" });
    expect(h.state).toBe(before);
  });

  it("سلبيّ: مكدّسٌ يشيرُ إلى quote بلا وجهةٍ مُصادَقةٍ يُرسَمُ Home لا Quote فارغاً", () => {
    const pushed = screenStackReducer<RiderRootTab, RiderFlowScreen>(initialRiderFlow().stack, {
      type: "push",
      screen: "quote",
    });
    expect(riderFlowView({ stack: pushed, chosen: null, confirmed: null })).toEqual({
      screen: "home",
    });
  });

  it("تبديلُ التبويبِ يمسحُ التدفّقَ (§6) والمختارَ معه", () => {
    const h = harness();
    h.handlers.onDestinationChosen(PICKED);
    h.dispatch({ type: "selectTab", tab: "rides" });
    expect(h.state.stack.stack).toHaveLength(0);
    expect(h.state.chosen).toBeNull();
    expect(h.state.stack.tab).toBe("rides");
  });
});

describe("RiderRoot — عقدُ الربطِ بالمعالجاتِ (حارسُ المصدر)", () => {
  it("كلُّ شاشةٍ في R3–R5 تتلقّى معالجَ `rider-flow.ts` لا نسخةً مكتوبةً باليد", () => {
    expect(SOURCE).toContain("onDestinationChosen={flowHandlers.onDestinationChosen}");
    expect(SOURCE).toContain("onConfirmed={flowHandlers.onConfirmed}");
    expect(SOURCE).toContain("onRequest={flowHandlers.onRequest}");
    expect(SOURCE.match(/onBack: flowHandlers\.onBack/g)).toHaveLength(2);
    expect(SOURCE).toContain("riderFlowHandlers(dispatchFlow, setIntent)");
    // UI-3 / PR 5 (ADR 0238): الحالةُ الأولى على تبويبِ الهبوطِ لا على «الرئيسية» دائماً.
    expect(SOURCE).toMatch(
      /useReducer\(\s*riderFlowReducer,\s*riderLandingTab\(landing\),\s*initialRiderFlow,?\s*\)/,
    );
    expect(SOURCE).toContain('view.screen === "quote"');
    expect(SOURCE).toContain('view.screen === "destination"');
  });

  it("ScreenTransition يتلقّى مفتاحَ المكدّسِ وحركتَه في الشاشاتِ الثلاث", () => {
    expect(
      SOURCE.match(/<ScreenTransition screenKey=\{stackKey\} motion=\{stack\.motion\}>/g),
    ).toHaveLength(3);
    const forward = renderToStaticMarkup(
      <ScreenTransition screenKey="s1" motion="forward">
        <p>destination</p>
      </ScreenTransition>,
    );
    const back = renderToStaticMarkup(
      <ScreenTransition screenKey="tab:home" motion="back">
        <p>home</p>
      </ScreenTransition>,
    );
    expect(forward).toContain("app-frame__screen--forward");
    expect(back).toContain("app-frame__screen--back");
  });
});

describe("RiderRoot — أوّلُ رسمٍ: بوّابةُ الموافقةِ قبلَ Home (لا وميض)", () => {
  it("أوّلُ خرجٍ للسطحِ هوَ تحقّقُ الموافقةِ المشغولُ — لا Home ولا تبويبٌ ولا «ابدأ»", () => {
    const html = renderToStaticMarkup(<RiderRoot language="ar" />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="sk"');
    expect(html).not.toContain("rh__");
    expect(html).not.toContain("app-frame__tabs");
    expect(html).not.toContain("wc__doc");
    expect(html).not.toContain(translateMiniApp("ar", "welcome.start"));
  });
});

describe("RiderRoot — تبويباتُ الجذرِ", () => {
  const t = miniAppTranslator("en");
  const labels = {
    home: t("rider.tabs.home"),
    rides: t("rider.tabs.rides"),
    support: t("rider.tabs.support"),
    account: t("rider.tabs.account"),
  };

  it("يُخرِجُ أربعَ علاماتٍ بوسومِ القاموسِ ومعلمِ تنقّلٍ دلاليٍّ", () => {
    expect(ROOT_TABS.rider).toEqual(["home", "rides", "support", "account"]);
    const html = renderToStaticMarkup(
      <RootTabBar
        surface="rider"
        label={t("rider.tabs.navigation")}
        labels={labels}
        active="home"
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('<nav aria-label="Main navigation" class="app-frame__tabs">');
    expect(html.match(/<button type="button"/g)).toHaveLength(4);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain(">Home<");
    expect(html).toContain(">My rides<");
    expect(html).toContain(">Support<");
    expect(html).toContain(">Account<");
  });

  it("الإطارُ يملكُ العنوانَ والرجوعَ؛ الشاشاتُ لا تكرّرُ H1 ولا ترسمُ رجوعاً بلا فعل", () => {
    const home = renderToStaticMarkup(
      <HomeScreen
        showTitle={false}
        loadPlaces={() => new Promise(() => {})}
        loadRecent={() => new Promise(() => {})}
      />,
    );
    const destination = renderToStaticMarkup(<DestinationScreen showTitle={false} />);
    const quote = renderToStaticMarkup(
      <QuoteScreen showTitle={false} destination={{ label: "Destination", lat: 24, lng: 46 }} />,
    );
    expect(home).not.toContain('id="rh-title"');
    expect(destination).not.toContain('id="rd-title"');
    expect(destination).not.toContain("rd__back");
    expect(quote).not.toContain('id="qt-title"');
    expect(quote).not.toContain("qt__back");
    expect(SOURCE).toContain(
      'back={{ label: t("rider.frame.back"), onBack: flowHandlers.onBack }}',
    );
    expect(SOURCE).toContain(
      'back={{ label: t("rider.frame.back"), onBack: flowHandlers.onBack }}',
    );
  });

  it("اختيارُ rides/support/account يصلُ إلى وجهته القائمةِ ولا يضيفُ فعلًا وهميّاً", () => {
    // UI-3 / PR 5 (ADR 0238): التبويبُ هوَ الحالُ — لا رايةٌ تُرفَعُ بجانبِه فتُخفي شريطَ التبويبات.
    expect(SOURCE).toContain(
      'const selectRootTab = (tab: RiderRootTab) => dispatchFlow({ type: "selectTab", tab });',
    );
    expect(SOURCE).toContain("switch (stack.tab) {");
    expect(SOURCE).toContain('case "rides":');
    expect(SOURCE).toContain('case "support":');
    expect(SOURCE).toContain('case "account":');
    expect(SOURCE).toContain('const onOpenHistory = () => selectRootTab("rides");');
    expect(SOURCE).toContain('const onOpenAccount = () => selectRootTab("account");');
    expect(SOURCE).toContain('onOpenSupport={() => selectRootTab("support")}');
    expect(SOURCE).not.toContain("setBrowsed");
    expect(SOURCE).not.toContain("setAccount");
    expect(SOURCE).not.toContain("setSupport({ orderId: null })");
  });

  it("وسومُ التبويبِ واسمُ معلمِ التنقّلِ موجودةٌ في اللغاتِ الثلاثِ", () => {
    for (const language of MINIAPP_LANGUAGES) {
      const dictionary = miniAppDictionary(language);
      for (const key of [
        "rider.tabs.account",
        "rider.tabs.home",
        "rider.tabs.navigation",
        "rider.tabs.rides",
        "rider.tabs.support",
        "rider.quote.services.empty",
      ]) {
        expect(dictionary[key], `${key} @ ${language}`).toBeString();
        expect(dictionary[key]?.trim()).not.toBe("");
      }
    }
  });
});
