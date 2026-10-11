/**
 * الغرض: آلةُ حالةِ تجربةِ السائقِ D0–D14 نقيّةً — التبويباتُ الجذريّةُ الأربعُ (§6) ومكدّسُ
 *   التدفّقاتِ فوقَها، ومعها **معالجاتُ الأحداثِ نفسُها** التي يربطُها `DriverRoot.tsx`.
 * الحالة: منفّذ فعلياً — UI-4 (ADR 0236).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver
 *
 * المكدّسُ هوَ مكدّسُ UI-2 نفسُه (`screenStackReducer`) لا نسخةٌ موازية؛ وهذه الطبقةُ تزيدُ
 * عليه **قواعدَ الموضعِ** فقط: أيُّ تدفّقٍ يُفتَحُ من أين، وما الذي يُرفَضُ لأنّه حالٌ مستحيلة
 * (قبولُ عرضٍ ليسَ ظاهراً، ملخّصُ رحلةٍ فوقَ لوحِ العروض، كشفُ خصومٍ بلا شاشةِ دعم…).
 * الرفضُ يُعيدُ **المرجعَ نفسَه** فلا يُعادُ رسمٌ ولا تتغيّرُ حركة.
 *
 * لماذا نقيّةٌ: المستودعُ بلا بيئةِ DOM ولا تُضافُ تبعيّة (ADR 0235)؛ فالقرارُ كلُّه ههنا
 * ويُقادُ في الاختبارِ بالمعالجاتِ ذاتِها التي تتلقّاها الشاشات.
 *
 * التبويبات (§6): العروض (`offers`) · مهمّتي (`job`) · أرباحي (`earnings`) · حسابي (`account`).
 * «أرباحي» هيَ شاشةُ الحصيلةِ (`ActivityScreen`): **لا مبلغَ يُعرَضُ** لأنَّ المنصّةَ لا تعرفُ
 * أجرةً (`ADR 0039` §٤ · `money.amount: null`)، والشاشةُ تقولُ ذلكَ نصّاً.
 */

import type { RootTabId } from "../../shell/root-tabs.ts";
import {
  currentScreen,
  initialScreenStack,
  type ScreenStackState,
  screenStackReducer,
} from "../../shell/screen-stack.ts";
import type { DriverEntryView } from "./entry-view.ts";

export type DriverRootTab = RootTabId<"driver">;

/** شاشاتُ التدفّقِ — كلُّ ما ليسَ جذرَ تبويب. المعرّفُ شرطُ فتحٍ في النوعِ نفسِه. */
export type DriverFlowScreen =
  | { readonly kind: "offer"; readonly offerId: string }
  | { readonly kind: "summary"; readonly orderId: string }
  | { readonly kind: "documents"; readonly focusDocType: string | null }
  | { readonly kind: "vehicle" }
  | { readonly kind: "subscription" }
  | { readonly kind: "support" }
  | { readonly kind: "deductionTrace" };

/** ما يُفتَحُ بفعلٍ عامٍّ من جذرٍ أو تدفّق — والبقيّةُ لها أفعالُها المقيَّدة. */
export type DriverOpenable = Extract<
  DriverFlowScreen,
  { readonly kind: "documents" | "vehicle" | "subscription" | "support" }
>;

export type DriverFlowState = ScreenStackState<DriverRootTab, DriverFlowScreen>;

export type DriverFlowAction =
  /** D1/D2→D3: تفاصيلُ العرضِ من بطاقتِه في لوحِ العروضِ وحدَه. */
  | { readonly type: "openOffer"; readonly offerId: string }
  /** D3: قبولٌ ظفرَ — إلى «مهمّتي» ويُمسَحُ المكدّس. */
  | { readonly type: "offerAccepted" }
  /** D3: رفضٌ نجحَ — رجوعٌ إلى اللوح. */
  | { readonly type: "offerRejected" }
  /** D4→D6: رحلةٌ اكتملَت من «مهمّتي» — إلى ملخّصِها. */
  | { readonly type: "jobCompleted"; readonly orderId: string }
  /**
   * `WR-20` (§20): قراءةُ الخادمِ عندَ الدخولِ وجدَت مَهمّةً نشطةً — إلى «مهمّتي».
   * لا يقطعُ سياقًا: يُطبَّقُ على جذرِ العروضِ وحدَه، فسائقٌ فتحَ شاشةً أو تبويبًا قبلَ وصولِ الردِّ يبقى حيثُ هو.
   */
  | { readonly type: "activeJobFound" }
  | { readonly type: "open"; readonly screen: DriverOpenable }
  /** D13: كشفُ الخصومِ من شاشةِ دعمِ السائقِ وحدَها. */
  | { readonly type: "openDeductionTrace" }
  | { readonly type: "back" }
  | { readonly type: "selectTab"; readonly tab: DriverRootTab };

function push(state: DriverFlowState, screen: DriverFlowScreen): DriverFlowState {
  return screenStackReducer(state, { type: "push", screen });
}

/** D0: الحالُ الأولى من هدفِ الهبوطِ (`ADR 0213`) — وما بعدَها ملاحةُ السائقِ لا الرابط. */
export function initialDriverFlow(entry: DriverEntryView): DriverFlowState {
  const at = (tab: DriverRootTab) => initialScreenStack<DriverRootTab, DriverFlowScreen>(tab);
  switch (entry.kind) {
    case "offers":
      return at("offers");
    case "offer":
      return push(at("offers"), { kind: "offer", offerId: entry.offerId });
    case "job":
      return at("job");
    case "activity":
      return at("earnings");
    case "account":
      return at("account");
    case "summary":
      return push(at("job"), { kind: "summary", orderId: entry.orderId });
    case "documents":
      return push(at("offers"), { kind: "documents", focusDocType: null });
    case "subscription":
      return push(at("offers"), { kind: "subscription" });
    case "support":
      return push(at("offers"), { kind: "support" });
    case "vehicle":
      return push(at("account"), { kind: "vehicle" });
  }
}

export function driverFlowReducer(
  state: DriverFlowState,
  action: DriverFlowAction,
): DriverFlowState {
  const top = currentScreen(state);
  switch (action.type) {
    case "openOffer":
      if (state.tab !== "offers" || top !== null) return state;
      return push(state, { kind: "offer", offerId: action.offerId });
    case "offerAccepted":
      if (top?.kind !== "offer") return state;
      return screenStackReducer(state, { type: "selectTab", tab: "job" });
    case "offerRejected":
      if (top?.kind !== "offer") return state;
      return screenStackReducer(state, { type: "pop" });
    case "activeJobFound":
      if (state.tab !== "offers" || top !== null) return state;
      return screenStackReducer(state, { type: "selectTab", tab: "job" });
    case "jobCompleted":
      if (state.tab !== "job" || top !== null) return state;
      return push(state, { kind: "summary", orderId: action.orderId });
    case "open":
      // لا تُكدَّسُ الشاشةُ فوقَ نفسِها ولا تُفتَحُ مرّتَين في التدفّقِ نفسِه.
      if (state.stack.some((entry) => entry.screen.kind === action.screen.kind)) return state;
      return push(state, action.screen);
    case "openDeductionTrace":
      if (top?.kind !== "support") return state;
      return push(state, { kind: "deductionTrace" });
    case "back":
      return screenStackReducer(state, { type: "pop" });
    case "selectTab":
      return screenStackReducer(state, { type: "selectTab", tab: action.tab });
  }
}

/** ما يرسمُه `DriverRoot`: جذرُ تبويبٍ أو شاشةُ تدفّقٍ — قرارٌ واحد. */
export type DriverFlowView =
  | { readonly screen: "root"; readonly tab: DriverRootTab }
  | { readonly screen: "flow"; readonly flow: DriverFlowScreen };

export function driverFlowView(state: DriverFlowState): DriverFlowView {
  const top = currentScreen(state);
  return top === null ? { screen: "root", tab: state.tab } : { screen: "flow", flow: top };
}

/**
 * D0: بثُّ الموقعِ جزءُ الهيكلِ — حالُ السائقِ لا حالُ شاشة — يُركَّبُ في جذرَي «العروض» و«مهمّتي» كما كانَ
 * (`F3-04`)، ولا يُركَّبُ في تفاصيلِ عرضٍ (قرارٌ في ثوانٍ) ولا في أرشيفٍ أو ورق.
 */
export function broadcastsLocation(view: DriverFlowView): boolean {
  return view.screen === "root" && (view.tab === "offers" || view.tab === "job");
}

export interface DriverFlowHandlers {
  readonly selectTab: (tab: DriverRootTab) => void;
  readonly back: () => void;
  readonly openOffer: (offerId: string) => void;
  readonly offerAccepted: () => void;
  readonly offerRejected: () => void;
  readonly jobCompleted: (orderId: string) => void;
  readonly activeJobFound: () => void;
  readonly openDocuments: (focusDocType?: string) => void;
  readonly openVehicle: () => void;
  readonly openSubscription: () => void;
  readonly openSupport: () => void;
  readonly openDeductionTrace: () => void;
}

export function driverFlowHandlers(
  dispatch: (action: DriverFlowAction) => void,
): DriverFlowHandlers {
  return {
    selectTab: (tab) => dispatch({ type: "selectTab", tab }),
    back: () => dispatch({ type: "back" }),
    openOffer: (offerId) => dispatch({ type: "openOffer", offerId }),
    offerAccepted: () => dispatch({ type: "offerAccepted" }),
    offerRejected: () => dispatch({ type: "offerRejected" }),
    jobCompleted: (orderId) => dispatch({ type: "jobCompleted", orderId }),
    activeJobFound: () => dispatch({ type: "activeJobFound" }),
    openDocuments: (focusDocType) =>
      dispatch({ type: "open", screen: { kind: "documents", focusDocType: focusDocType ?? null } }),
    openVehicle: () => dispatch({ type: "open", screen: { kind: "vehicle" } }),
    openSubscription: () => dispatch({ type: "open", screen: { kind: "subscription" } }),
    openSupport: () => dispatch({ type: "open", screen: { kind: "support" } }),
    openDeductionTrace: () => dispatch({ type: "openDeductionTrace" }),
  };
}

/** مفتاحُ العنوانِ لكلِّ شاشة — مفاتيحُ قائمةٌ في القاموس، لا نصٌّ مُضمَّن. */
export const DRIVER_TITLE_KEY: Readonly<Record<DriverRootTab | DriverFlowScreen["kind"], string>> =
  {
    offers: "driver.offers.title",
    job: "driver.job.title",
    earnings: "driver.activity.title",
    account: "driver.account.title",
    offer: "driver.offers.detail.title",
    summary: "driver.summary.title",
    documents: "driver.documents.title",
    vehicle: "driver.vehicle.title",
    subscription: "driver.subscription.title",
    support: "driver.support.title",
    deductionTrace: "driver.support.deductionTrace.title",
  };
