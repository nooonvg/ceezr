/**
 * الغرض: آلةُ حالةِ تدفّقِ الراكبِ R3 → R4 → R5 (الرئيسيةُ ← الوجهةُ ← الاقتباسُ) نقيّةً،
 *   ومعها **معالجاتُ الأحداثِ نفسُها** التي يربطُها `RiderRoot.tsx` بالشاشات.
 * الحالة: منفّذ فعلياً — UI-3 / PR 3 (ADR 0235).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider
 *
 * لماذا ملفٌّ نقيٌّ: المستودعُ لا يملكُ بيئةَ DOM (انظر `routing/role-router-interactive.test.ts`
 * و`system/screens.test.tsx`)، ولا تُضافُ تبعيّةٌ لاختبارٍ. فالقرارُ كلُّه — المكدّسُ والوجهةُ
 * المختارةُ والمُصادَقةُ والشاشةُ الظاهرةُ — يُستخرَجُ ههنا، ويستعملُه `RiderRoot` بـ`useReducer`،
 * ويُقادُ في الاختبارِ بالمعالجاتِ ذاتِها التي تتلقّاها الشاشاتُ. ما لا يُثبَتُ ههنا: ربطُ JSX
 * بالمعالجِ (يحرسُه عقدُ المصدرِ) والنقرُ في DOM حيٍّ.
 *
 * المكدّسُ هو مكدّسُ UI-2 نفسُه (`screenStackReducer`) لا نسخةٌ موازية؛ والنيّةُ (R6) لا تُملَكُ
 * ههنا — تُسلَّمُ إلى `setIntent` القائمِ في `RiderRoot`.
 */

import type { RootTabId } from "../../shell/root-tabs.ts";
import {
  currentScreen,
  initialScreenStack,
  type ScreenStackState,
  screenStackReducer,
} from "../../shell/screen-stack.ts";
import type { ConfirmedDestination } from "./destination/DestinationScreen.tsx";
import type { ChosenDestination } from "./home/HomeScreen.tsx";
import type { SearchScreenIntent } from "./search/SearchScreen.tsx";

export type RiderRootTab = RootTabId<"rider">;
export type RiderFlowScreen = "destination" | "dropoff" | "quote";

export interface RiderFlowState {
  readonly stack: ScreenStackState<RiderRootTab, RiderFlowScreen>;
  /** ما اختارَه الراكبُ في R3 — نصٌّ وربما إحداثيّة، لم يُحكَم عليه بعد. */
  readonly chosen: ChosenDestination | null;
  /** ما صادقَته القاعدةُ في R4 — وحدَه يُقتبَسُ في R5. */
  readonly confirmed: ConfirmedDestination | null;
  /**
   * `WR-16C` — مكانُ **الاستلامِ** في التوصيل: يُؤكَّدُ أوّلًا (الخطوةُ الأولى بعدَ الرئيسية)، ثمَّ
   * تُسأَلُ الوجهةُ في `dropoff`. في المشوارِ يبقى `null` والالتقاطُ يُسأَلُ في الاقتباسِ كما كان.
   */
  readonly pickup: ConfirmedDestination | null;
}

export type RiderFlowAction =
  | { readonly type: "choose"; readonly chosen: ChosenDestination }
  | { readonly type: "confirm"; readonly confirmed: ConfirmedDestination }
  | { readonly type: "back" }
  /** تسليمُ النيّةِ إلى R6: يُفرَّغُ التدفّقُ كلُّه. */
  | { readonly type: "handoff" }
  /** رجوعٌ من R6+ إلى الرئيسية: لا وجهةَ معلّقةً ولا مكدّس. */
  | { readonly type: "clear" }
  | { readonly type: "selectTab"; readonly tab: RiderRootTab };

/**
 * UI-3 / PR 5 (ADR 0238): الحالةُ الأولى على **تبويبٍ** — «رحلاتي» و«الدعم» و«حسابي» جذورٌ في
 * `ScreenFrame mode="root"` لا راياتٌ تُخفي شريطَ التبويبات؛ فرابطُ الهبوطِ إلى أحدِها يبدأُ عليه.
 */
export function initialRiderFlow(tab: RiderRootTab = "home"): RiderFlowState {
  return {
    stack: initialScreenStack<RiderRootTab, RiderFlowScreen>(tab),
    chosen: null,
    confirmed: null,
    pickup: null,
  };
}

export function riderFlowReducer(state: RiderFlowState, action: RiderFlowAction): RiderFlowState {
  switch (action.type) {
    case "choose":
      // لا تُدفَعُ وجهةٌ فوقَ وجهةٍ: الاختيارُ يقعُ من الجذرِ وحدَه.
      if (state.stack.stack.length > 0) return state;
      return {
        ...state,
        chosen: action.chosen,
        confirmed: null,
        pickup: null,
        stack: screenStackReducer(state.stack, { type: "push", screen: "destination" }),
      };
    case "confirm": {
      const top = currentScreen(state.stack);
      // `WR-16C`: في التوصيلِ أوّلُ تأكيدٍ هوَ **الاستلام**، فتُسأَلُ الوجهةُ بعدَه — لا نقاطَ معكوسة.
      if (top === "destination" && state.chosen?.service === "delivery") {
        return {
          ...state,
          pickup: action.confirmed,
          confirmed: null,
          stack: screenStackReducer(state.stack, { type: "push", screen: "dropoff" }),
        };
      }
      if (top !== "destination" && top !== "dropoff") return state;
      return {
        ...state,
        confirmed: action.confirmed,
        stack: screenStackReducer(state.stack, { type: "push", screen: "quote" }),
      };
    }
    case "back": {
      const top = currentScreen(state.stack);
      if (top === null) return state;
      const stack = screenStackReducer(state.stack, { type: "pop" });
      // الرجوعُ من الاقتباسِ يُسقِطُ الحكمَ ويُبقي الاختيارَ (فتُعادُ مصادقتُه)؛ ومن الوجهةِ يُسقِطُ الاختيار.
      if (top === "quote") return { ...state, stack, confirmed: null };
      // من الوجهةِ إلى الاستلام: يُسقَطُ الاستلامُ فيُعادُ تأكيدُه، والاختيارُ باقٍ.
      if (top === "dropoff") return { ...state, stack, pickup: null, confirmed: null };
      return { ...state, stack, chosen: null, confirmed: null, pickup: null };
    }
    case "handoff":
    case "clear": {
      const stack = screenStackReducer(state.stack, { type: "reset" });
      if (
        stack === state.stack &&
        state.chosen === null &&
        state.confirmed === null &&
        state.pickup === null
      ) {
        return state;
      }
      return { stack, chosen: null, confirmed: null, pickup: null };
    }
    case "selectTab": {
      const stack = screenStackReducer(state.stack, { type: "selectTab", tab: action.tab });
      if (stack === state.stack) return state;
      return { stack, chosen: null, confirmed: null, pickup: null };
    }
  }
}

/**
 * تبويبُ الهبوط (`ADR 0213` · UI-3 / PR 5): السجلُّ ⇒ «رحلاتي»، الحسابُ ⇒ «حسابي»، والدعمُ **العامُّ**
 * ⇒ «الدعم». ودعمٌ مربوطٌ برحلةٍ تدفّقٌ لا تبويب — يبقى على «الرئيسية» وتُفتَحُ فوقَه.
 */
export function riderLandingTab(landing: {
  readonly browsed: boolean;
  readonly account: boolean;
  readonly support: { readonly orderId: string | null } | null;
}): RiderRootTab {
  if (landing.browsed) return "rides";
  if (landing.account) return "account";
  if (landing.support !== null && landing.support.orderId === null) return "support";
  return "home";
}

/** الشاشةُ التي يرسمُها `RiderRoot` لتدفّقِ R3–R5 — قرارٌ واحدٌ لا شرطانِ متفرّقان. */
export type RiderFlowView =
  | { readonly screen: "home" }
  | { readonly screen: "destination"; readonly chosen: ChosenDestination }
  | { readonly screen: "dropoff"; readonly pickup: ConfirmedDestination }
  | {
      readonly screen: "quote";
      readonly confirmed: ConfirmedDestination;
      /** `WR-16C` — الخدمةُ المختارةُ في الرئيسية، ومكانُ الاستلامِ المؤكَّدُ في التوصيل. */
      readonly service: ChosenDestination["service"] | null;
      readonly pickup: ConfirmedDestination | null;
    };

export function riderFlowView(state: RiderFlowState): RiderFlowView {
  const top = currentScreen(state.stack);
  if (top === "quote" && state.confirmed !== null) {
    return {
      screen: "quote",
      confirmed: state.confirmed,
      service: state.chosen?.service ?? null,
      pickup: state.pickup,
    };
  }
  if (top === "dropoff" && state.pickup !== null) {
    return { screen: "dropoff", pickup: state.pickup };
  }
  if (top === "destination" && state.chosen !== null) {
    return { screen: "destination", chosen: state.chosen };
  }
  return { screen: "home" };
}

export interface RiderFlowHandlers {
  /** `HomeScreen.onDestinationChosen` */
  readonly onDestinationChosen: (chosen: ChosenDestination) => void;
  /** `DestinationScreen.onConfirmed` */
  readonly onConfirmed: (confirmed: ConfirmedDestination) => void;
  /** `ScreenFrame back.onBack` في R4 وR5 */
  readonly onBack: () => void;
  /** `QuoteScreen.onRequest` — يُفرِّغُ التدفّقَ ثمّ يُسلِّمُ النيّةَ إلى R6 كما هو قائم. */
  readonly onRequest: (intent: SearchScreenIntent) => void;
}

export function riderFlowHandlers(
  dispatch: (action: RiderFlowAction) => void,
  handOff: (intent: SearchScreenIntent) => void,
): RiderFlowHandlers {
  return {
    onDestinationChosen: (chosen) => dispatch({ type: "choose", chosen }),
    onConfirmed: (confirmed) => dispatch({ type: "confirm", confirmed }),
    onBack: () => dispatch({ type: "back" }),
    onRequest: (intent) => {
      dispatch({ type: "handoff" });
      handOff(intent);
    },
  };
}
