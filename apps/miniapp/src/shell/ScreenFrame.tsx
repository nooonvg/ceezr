/**
 * الغرض: هيكلُ الشاشةِ والتنقّلُ — PR 2 في §11 من الدليلِ المعتمد:
 *   `ScreenFrame` + التبويبُ الجذريُّ (`RootTabBar`) + `BackButton` + `ScreenTransition`.
 * الحالة: منفّذ فعلياً — UI-2 / PR 2 (Shell & Navigation · ADR 0234). صارَ أوّلُ
 *   مستهلكٍ له سطحَ الراكبِ في UI-3 / PR 3؛ ووصلُه بسطحِ السائقِ لاحقاً (UI-4).
 * ينتمي إلى: apps/miniapp/src/shell
 *
 * **لا نظامَ موازٍ:** الإطارُ هو كتلةُ `app-frame` القائمةُ (`F1-07`) بعناصرَ جديدةٍ،
 * والرأسُ `UiHeader` وشريطُ الأفعالِ `UiActionBar` من `ui-*` (UI-1). ولا بادئةَ جديدة.
 *
 * **§6 بالأنواع:** شاشةُ الجذرِ (`mode: "root"`) تحملُ شريطَ التبويبِ ولا رجوعَ لها؛
 * وشاشةُ التدفّقِ (`mode: "flow"`) تحملُ رجوعاً وشريطَ أفعالٍ **ولا تبويبَ فيها**.
 *
 * **رجوعٌ واحدٌ لا اثنان:** زرُّ تيليجرامَ الأصليُّ (`BackButton`) حيثُ يدعمُه المضيف،
 * وإلّا زرُّ الرأسِ في `UiHeader`. لا يُرسَمانِ معاً، ولا يُرسَمُ أيٌّ منهما بلا فعل.
 *
 * **لا نصَّ مُضمَّن:** كلُّ عنوانٍ ووسمٍ من المستدعي. **ولا مؤقّتَ ولا استقصاء:**
 * الانتقالُ حركةُ CSS، والتركيزُ يُنقَلُ مرّةً عندَ تغيّرِ الشاشة.
 */

import { type ReactNode, useContext, useEffect, useRef } from "react";
import { Glyph, type GlyphName } from "../system/ui/icons.tsx";
import { UiActionBar, UiHeader } from "../system/ui/index.tsx";
import { hasCapability, onBackButtonClick, setBackButtonVisible } from "../tg/index.ts";
import { InsideAppFrame } from "./Layout.tsx";
import { missingTabLabels, ROOT_TABS, type RootRole, type RootTabId } from "./root-tabs.ts";
import type { ScreenMotion } from "./screen-stack.ts";

// ─── BackButton (زرُّ تيليجرامَ الأصليُّ عبرَ الطبقةِ `tg/` وحدَها) ───────────

/** منفذُ زرِّ الرجوع — يُحقَنُ في الاختبارِ، والافتراضيُّ طبقةُ `tg/`. */
export interface BackButtonPort {
  readonly available: () => boolean;
  readonly setVisible: (visible: boolean) => void;
  readonly onClick: (handler: () => void) => () => void;
}

export const TELEGRAM_BACK_BUTTON: BackButtonPort = {
  available: () => hasCapability("backButton"),
  setVisible: (visible) => {
    setBackButtonVisible(visible);
  },
  onClick: (handler) => onBackButtonClick(handler),
};

/** الربطُ نفسُه نقيّاً: إظهارٌ ثمّ اشتراكٌ، والفكُّ اشتراكٌ يُلغى ثمّ إخفاء. */
export function bindNativeBack(port: BackButtonPort, handler: () => void): () => void {
  port.setVisible(true);
  const unsubscribe = port.onClick(handler);
  return () => {
    unsubscribe();
    port.setVisible(false);
  };
}

/**
 * يُظهِرُ الزرَّ الأصليَّ ويربطُ فعلَه ما دامَ `onBack` حاضراً والمضيفُ داعماً،
 * ويُخفيه ويفكُّ الربطَ عندَ الغيابِ أو التفكيك. يُعيدُ: هل الرجوعُ أصليٌّ؟
 * `onBack` الأحدثُ يُقرأُ من مرجعٍ، فلا يُعادُ الربطُ عندَ كلِّ رسم.
 */
export function useBackButton(
  onBack: (() => void) | undefined,
  port: BackButtonPort = TELEGRAM_BACK_BUTTON,
): boolean {
  const native = onBack !== undefined && port.available();
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!native) return;
    return bindNativeBack(port, () => latest.current?.());
  }, [native, port]);
  return native;
}

// ─── RootTabBar (التبويبُ الجذريُّ · §6) ──────────────────────────────────────

/** `UX-V2`: رمزُ كلِّ تبويبٍ جذريٍّ — زخرفةٌ بجانبِ الاسمِ لا بديلٌ عنه. */
const TAB_GLYPHS = {
  home: "home",
  rides: "rides",
  support: "support",
  account: "account",
  offers: "offers",
  job: "job",
  earnings: "earnings",
} as const satisfies Record<string, GlyphName>;

const ROOT_TAB_STATES = [
  { on: false, modifier: "" },
  { on: true, modifier: "app-frame__tab--on" },
] as const;

export interface RootTabBarProps<R extends RootRole> {
  /** السطحُ (الدور) الذي تُقرأُ تبويباتُه من §6. */
  readonly surface: R;
  /** وسمُ معلمِ التنقّلِ لقارئِ الشاشة. */
  readonly label: string;
  readonly labels: Readonly<Record<RootTabId<R>, string>>;
  readonly active: RootTabId<R>;
  readonly onSelect: (tab: RootTabId<R>) => void;
}

/**
 * `WR-16B` — شريطُ السائقِ مرفوعٌ قليلًا فوقَ حدِّ الشاشةِ وأزرارِ النظام (الصورة 03 في أمرِ
 * 2026-10-12): يطفو بمسافةٍ ثابتةٍ فوقَ `--safe-bottom` بدلَ أن يلتصقَ بالحافّةِ وتقعَ أزرارُ
 * Android فوقَ حشوتِه. والراكبُ على شريطِه القائمِ إلى أن يُطلَبَ له مثلُه.
 */
const ROOT_TAB_BAR_SURFACES = [
  { surface: "rider", modifier: "" },
  { surface: "driver", modifier: "app-frame__tabs--raised" },
] as const satisfies readonly { readonly surface: RootRole; readonly modifier: string }[];

function rootTabBarModifier(surface: RootRole): string {
  return ROOT_TAB_BAR_SURFACES.find((x) => x.surface === surface)?.modifier ?? "";
}

export function rootTabBarClass(surface: RootRole): string {
  return `app-frame__tabs ${rootTabBarModifier(surface)}`.trimEnd();
}

/**
 * معلمُ تنقّلٍ (`<nav>`) لا `tablist`: كلُّ تبويبٍ ينقلُ إلى شاشةِ جذرٍ لا يُبدِّلُ
 * لوحةً داخلَ الصفحة، فالنشطُ `aria-current="page"`. الترتيبُ ترتيبُ §6 والاتجاهُ
 * يقلبُه CSS (flex)، فلا نسخةَ RTL. وسمٌ ناقصٌ = لا شريطَ (لا تبويبَ بنصٍّ مخترَع).
 */
export function RootTabBar<R extends RootRole>({
  surface,
  label,
  labels,
  active,
  onSelect,
}: RootTabBarProps<R>) {
  if (label.trim() === "" || missingTabLabels(surface, labels).length > 0) return null;
  const ids = ROOT_TABS[surface] as readonly RootTabId<R>[];
  const bar = { modifier: rootTabBarModifier(surface) };
  return (
    <nav className={`app-frame__tabs ${bar.modifier}`.trimEnd()} aria-label={label}>
      {ids.map((id) => {
        const on = id === active;
        const state = ROOT_TAB_STATES.find((x) => x.on === on) ?? ROOT_TAB_STATES[0];
        return (
          <button
            key={id}
            type="button"
            className={`app-frame__tab ${state.modifier}`.trimEnd()}
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect(id)}
          >
            <span className="app-frame__tab-icon">
              <Glyph name={TAB_GLYPHS[id as keyof typeof TAB_GLYPHS]} />
            </span>
            <span className="app-frame__tab-label">{labels[id]}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ─── ScreenTransition (حركةُ CSS · بلا مكتبة) ────────────────────────────────

const MOTIONS = [
  { motion: "none", modifier: "" },
  { motion: "forward", modifier: "app-frame__screen--forward" },
  { motion: "back", modifier: "app-frame__screen--back" },
] as const;

/** صنفُ حاوي الشاشةِ لحركةٍ — جدولٌ حرفيٌّ يقرؤه حاجزُ تغطيةِ الأصناف. */
export function motionClass(motion: ScreenMotion): string {
  const m = MOTIONS.find((x) => x.motion === motion) ?? MOTIONS[0];
  return `app-frame__screen ${m.modifier}`.trimEnd();
}

export interface ScreenTransitionProps {
  /** يتغيّرُ مع كلِّ شاشةٍ (`currentKey` من `useScreenStack`) فيُعادُ التركيبُ والحركة. */
  readonly screenKey: string;
  readonly motion: ScreenMotion;
  readonly children: ReactNode;
}

/**
 * الحاوي يُعادُ تركيبُه بالمفتاحِ فتجري حركةُ الدخولِ مرّةً؛ واتجاهُها منطقيٌّ (CSS
 * يقلبُها في RTL)، وتُلغى عندَ `prefers-reduced-motion`. وعندَ تقدّمٍ أو رجوعٍ
 * يُنقَلُ التركيزُ إلى الشاشةِ الجديدةِ فيقرأُ قارئُ الشاشةِ ما حلَّ محلَّ القديمة؛
 * وتبديلُ التبويبِ (`none`) يُبقي التركيزَ على زرِّ التبويبِ حيثُ ضغطَ المستخدم.
 */
export function ScreenTransition({ screenKey, motion, children }: ScreenTransitionProps) {
  return (
    <TransitionBody key={screenKey} motion={motion}>
      {children}
    </TransitionBody>
  );
}

function TransitionBody({
  motion,
  children,
}: {
  readonly motion: ScreenMotion;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initialMotion = useRef(motion);
  useEffect(() => {
    if (initialMotion.current === "none") return;
    ref.current?.focus({ preventScroll: true });
  }, []);
  const m = MOTIONS.find((x) => x.motion === motion) ?? MOTIONS[0];
  return (
    <div ref={ref} className={`app-frame__screen ${m.modifier}`.trimEnd()} tabIndex={-1}>
      {children}
    </div>
  );
}

// ─── ScreenFrame ─────────────────────────────────────────────────────────────

interface ScreenFrameBase {
  readonly title: string;
  readonly subtitle?: string;
  readonly headerAction?: ReactNode;
  /** `UX-10`: الانشغالُ يُعلَنُ للقارئِ الآليِّ لا باللونِ وحدَه. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

export interface RootScreenFrameProps extends ScreenFrameBase {
  readonly mode: "root";
  /** شريطُ التبويبِ (`RootTabBar`) — في الجذرِ وحدَه. */
  readonly tabs: ReactNode;
  readonly back?: never;
  readonly action?: never;
}

export interface FlowScreenFrameProps extends ScreenFrameBase {
  readonly mode: "flow";
  readonly back: { readonly label: string; readonly onBack: () => void };
  /** أفعالُ التدفّقِ في `UiActionBar`؛ الغيابُ = لا شريط. */
  readonly action?: ReactNode;
  readonly tabs?: never;
  readonly backPort?: BackButtonPort;
}

export type ScreenFrameProps = RootScreenFrameProps | FlowScreenFrameProps;

export function ScreenFrame(props: ScreenFrameProps) {
  const flow = props.mode === "flow" ? props : null;
  const native = useBackButton(flow?.back.onBack, flow?.backPort);
  const nested = useContext(InsideAppFrame);
  const headerBack = flow !== null && !native ? flow.back : undefined;
  const header = (
    <UiHeader
      title={props.title}
      {...(props.subtitle !== undefined ? { subtitle: props.subtitle } : {})}
      {...(headerBack !== undefined ? { back: headerBack } : {})}
      {...(props.headerAction !== undefined ? { action: props.headerAction } : {})}
    />
  );
  let bottom: ReactNode = null;
  if (props.mode === "root") bottom = props.tabs;
  else if (props.action !== undefined) bottom = <UiActionBar>{props.action}</UiActionBar>;
  const busy = props.busy === true ? "true" : undefined;
  const parts = (
    <>
      {header}
      <div className="app-frame__content">{props.children}</div>
      <div className="app-frame__action">{bottom}</div>
    </>
  );
  // `UI-10`: داخلَ إطارِ الهيكلِ لا يُرسَمُ معلمٌ `<main>` ثانٍ ولا حاشيةٌ ثانية — قرينةُ
  // `InsideAppFrame`. وخارجَه (اختبارٌ أو مضيفٌ آخر) يبقى `<main>` كما كان.
  if (nested) {
    return (
      <div className="app-frame app-frame--nested" aria-busy={busy}>
        {parts}
      </div>
    );
  }
  return (
    <main className="app-frame" aria-busy={busy}>
      {parts}
    </main>
  );
}
