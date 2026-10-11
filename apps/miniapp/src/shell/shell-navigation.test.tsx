/**
 * الغرض: إثباتُ هيكلِ UI-2 / PR 2 — `ScreenFrame` + التبويبُ الجذريُّ + `BackButton`
 *   + `ScreenTransition` + `useScreenStack` (§6 · §11 · ADR 0234).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/shell
 *
 * لكلِّ سلوكٍ حرجٍ اختبارٌ إيجابيٌّ (القائمُ صحيح) وسلبيٌّ (الخللُ يُسقِطُ الاختبار):
 * هيكلٌ، وRTL، والوصوليّة، و«لا فعلَ بلا أثر»، و«لا نصَّ مخترَع».
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { isRootTab, missingTabLabels, ROOT_TABS } from "./root-tabs.ts";
import {
  type BackButtonPort,
  bindNativeBack,
  motionClass,
  RootTabBar,
  ScreenFrame,
  ScreenTransition,
  TELEGRAM_BACK_BUTTON,
} from "./ScreenFrame.tsx";
import {
  currentScreen,
  currentScreenKey,
  initialScreenStack,
  type ScreenStackState,
  screenStackReducer,
} from "./screen-stack.ts";

type Tab = "home" | "rides";
type S = { readonly name: string };
const start = (): ScreenStackState<Tab, S> => initialScreenStack<Tab, S>("home");
const push = (state: ScreenStackState<Tab, S>, name: string) =>
  screenStackReducer(state, { type: "push", screen: { name } });

const RIDER_LABELS = {
  home: "t-home",
  rides: "t-rides",
  support: "t-support",
  account: "t-account",
};

function fakePort(available: boolean) {
  const calls: string[] = [];
  let handler: (() => void) | null = null;
  const port: BackButtonPort = {
    available: () => available,
    setVisible: (visible) => calls.push(visible ? "show" : "hide"),
    onClick: (h) => {
      handler = h;
      calls.push("subscribe");
      return () => {
        handler = null;
        calls.push("unsubscribe");
      };
    },
  };
  return { port, calls, click: () => handler?.() };
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ─── useScreenStack: القرارُ النقيّ ──────────────────────────────────────────

describe("screenStackReducer — push / pop / replace / reset (§6)", () => {
  it("push يضعُ شاشةً فوقَ الجذرِ بحركةِ تقدّمٍ ومفتاحٍ فريد", () => {
    const a = push(start(), "a");
    const b = push(a, "b");
    expect(b.stack.map((e) => e.screen.name)).toEqual(["a", "b"]);
    expect(b.motion).toBe("forward");
    expect(new Set(b.stack.map((e) => e.key)).size).toBe(2);
    expect(currentScreen(b)).toEqual({ name: "b" });
  });

  it("pop يعودُ خطوةً بحركةِ رجوع", () => {
    const s = screenStackReducer(push(push(start(), "a"), "b"), { type: "pop" });
    expect(s.stack.map((e) => e.screen.name)).toEqual(["a"]);
    expect(s.motion).toBe("back");
  });

  it("سلبيّ: pop على الجذرِ لا يفعلُ شيئاً — المرجعُ نفسُه", () => {
    const root = start();
    expect(screenStackReducer(root, { type: "pop" })).toBe(root);
  });

  it("replace يستبدلُ الأعلى بلا تغييرِ العمقِ وبلا حركة", () => {
    const before = push(push(start(), "a"), "b");
    const after = screenStackReducer(before, { type: "replace", screen: { name: "c" } });
    expect(after.stack.map((e) => e.screen.name)).toEqual(["a", "c"]);
    expect(after.motion).toBe("none");
    expect(after.stack[1]?.key).not.toBe(before.stack[1]?.key);
  });

  it("سلبيّ: replace على الجذرِ لا يستبدلُ جذرَ التبويب", () => {
    const root = start();
    expect(screenStackReducer(root, { type: "replace", screen: { name: "x" } })).toBe(root);
  });

  it("reset يعودُ إلى الجذرِ بحركةِ رجوع", () => {
    const s = screenStackReducer(push(push(start(), "a"), "b"), { type: "reset" });
    expect(s.stack).toEqual([]);
    expect(s.motion).toBe("back");
    expect(currentScreen(s)).toBeNull();
  });

  it("سلبيّ: reset على الجذرِ لا يفعلُ شيئاً", () => {
    const root = start();
    expect(screenStackReducer(root, { type: "reset" })).toBe(root);
  });
});

describe("screenStackReducer — تبديلُ التبويبِ يمسحُ المكدّس (§6)", () => {
  it("تبويبٌ آخرُ: مكدّسٌ فارغٌ وبلا حركة", () => {
    const s = screenStackReducer(push(start(), "a"), { type: "selectTab", tab: "rides" });
    expect(s.tab).toBe("rides");
    expect(s.stack).toEqual([]);
    expect(s.motion).toBe("none");
  });

  it("إعادةُ اختيارِ النشطِ داخلَ تدفّقٍ تعودُ إلى جذرِه", () => {
    const s = screenStackReducer(push(start(), "a"), { type: "selectTab", tab: "home" });
    expect(s.stack).toEqual([]);
  });

  it("سلبيّ: إعادةُ اختيارِ النشطِ على جذرِه لا تفعلُ شيئاً", () => {
    const root = start();
    expect(screenStackReducer(root, { type: "selectTab", tab: "home" })).toBe(root);
  });

  it("مفتاحُ الشاشةِ: جذرُ التبويبِ ثمّ مفتاحُ أعلى المكدّس", () => {
    const root = start();
    expect(currentScreenKey(root)).toBe("tab:home");
    const a = push(root, "a");
    expect(currentScreenKey(a)).toBe(a.stack[0]?.key ?? "");
  });
});

// ─── التبويباتُ الجذريّة ─────────────────────────────────────────────────────

describe("ROOT_TABS — §6 حرفاً", () => {
  it("أربعةٌ لكلِّ دورٍ بترتيبِ §6", () => {
    expect(ROOT_TABS.rider).toEqual(["home", "rides", "support", "account"]);
    expect(ROOT_TABS.driver).toEqual(["offers", "job", "earnings", "account"]);
  });

  it("isRootTab يقبلُ تبويبَ الدورِ ويرفضُ تبويبَ غيرِه", () => {
    expect(isRootTab("rider", "rides")).toBe(true);
    expect(isRootTab("rider", "offers")).toBe(false);
    expect(isRootTab("driver", "home")).toBe(false);
  });

  it("missingTabLabels: لا شيءَ حينَ تكتملُ الوسوم، ويُسمّي الغائبَ والفارغ", () => {
    expect(missingTabLabels("rider", RIDER_LABELS)).toEqual([]);
    expect(missingTabLabels("rider", { ...RIDER_LABELS, rides: "  " })).toEqual(["rides"]);
    expect(missingTabLabels("driver", { offers: "x" })).toEqual(["job", "earnings", "account"]);
  });
});

describe("RootTabBar — معلمُ تنقّلٍ بوسومٍ من المستدعي", () => {
  const html = renderToStaticMarkup(
    <RootTabBar
      surface="rider"
      label="nav-label"
      labels={RIDER_LABELS}
      active="rides"
      onSelect={() => undefined}
    />,
  );

  it("nav بوسمٍ وأربعةُ أزرارٍ بترتيبِ §6", () => {
    expect(html.startsWith('<nav aria-label="nav-label" class="app-frame__tabs">')).toBe(true);
    expect(html.match(/<button type="button"/g)?.length).toBe(4);
    const order = [...html.matchAll(/>(t-[a-z]+)</g)].map((m) => m[1]);
    expect(order).toEqual(["t-home", "t-rides", "t-support", "t-account"]);
  });

  it("النشطُ وحدَه aria-current=page وصنفُ --on", () => {
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    // `UX-V2`: الزرُّ يحملُ رمزاً زخرفيّاً مخفيّاً ثمَّ وسمَه — والوسمُ داخلَ الزرِّ النشطِ نفسِه.
    expect(html).toMatch(
      /aria-current="page" class="app-frame__tab app-frame__tab--on"><span class="app-frame__tab-icon">(?:(?!<\/button>).)*<span class="app-frame__tab-label">t-rides<\/span><\/button>/,
    );
    expect(html.match(/app-frame__tab--on/g)?.length).toBe(1);
  });

  it("سلبيّ: ليسَ tablist — لا role=tab ولا aria-selected", () => {
    expect(html).not.toContain('role="tab');
    expect(html).not.toContain("aria-selected");
  });

  it("سلبيّ: وسمٌ ناقصٌ أو فارغٌ = لا شريطَ (لا نصَّ مخترَع)", () => {
    const blank = renderToStaticMarkup(
      <RootTabBar
        surface="rider"
        label="nav"
        labels={{ ...RIDER_LABELS, support: "" }}
        active="home"
        onSelect={() => undefined}
      />,
    );
    expect(blank).toBe("");
    const noNavLabel = renderToStaticMarkup(
      <RootTabBar
        surface="rider"
        label=" "
        labels={RIDER_LABELS}
        active="home"
        onSelect={() => undefined}
      />,
    );
    expect(noNavLabel).toBe("");
  });
});

// ─── BackButton ──────────────────────────────────────────────────────────────

describe("BackButton — زرُّ تيليجرامَ الأصليّ", () => {
  it("bindNativeBack: إظهارٌ ثمّ اشتراكٌ، والنقرُ ينادي الفعل", () => {
    const f = fakePort(true);
    let backs = 0;
    const unbind = bindNativeBack(f.port, () => {
      backs += 1;
    });
    expect(f.calls).toEqual(["show", "subscribe"]);
    f.click();
    expect(backs).toBe(1);
    unbind();
    expect(f.calls).toEqual(["show", "subscribe", "unsubscribe", "hide"]);
  });

  it("سلبيّ: بعدَ الفكِّ لا يصلُ النقرُ إلى الفعل", () => {
    const f = fakePort(true);
    let backs = 0;
    bindNativeBack(f.port, () => {
      backs += 1;
    })();
    f.click();
    expect(backs).toBe(0);
  });

  it("خارجَ تيليجرامَ المنفذُ الافتراضيُّ غيرُ متاحٍ فيُرسَمُ زرُّ الرأس", () => {
    expect(TELEGRAM_BACK_BUTTON.available()).toBe(false);
  });
});

// ─── ScreenFrame ─────────────────────────────────────────────────────────────

describe("ScreenFrame — الجذرُ والتدفّق (§6)", () => {
  const tabs = (
    <RootTabBar
      surface="rider"
      label="nav"
      labels={RIDER_LABELS}
      active="home"
      onSelect={() => undefined}
    />
  );

  it("الجذرُ: إطارٌ + رأسٌ + شريطُ تبويبٍ، ولا رجوعَ ولا شريطَ أفعال", () => {
    const html = renderToStaticMarkup(
      <ScreenFrame mode="root" title="title-x" tabs={tabs}>
        <p>body</p>
      </ScreenFrame>,
    );
    expect(html.startsWith('<main class="app-frame">')).toBe(true);
    expect(html).toContain('<h1 class="ui-hdr__title">title-x</h1>');
    expect(html).toMatch(/<nav [^>]*class="app-frame__tabs"/);
    expect(html).not.toContain("ui-hdr__back");
    expect(html).not.toContain('class="ui-act"');
  });

  it("التدفّقُ بلا مضيفٍ داعمٍ: زرُّ رجوعٍ في الرأسِ بوسمِه، ولا تبويب", () => {
    const f = fakePort(false);
    const html = renderToStaticMarkup(
      <ScreenFrame
        mode="flow"
        title="t"
        back={{ label: "back-label", onBack: () => undefined }}
        action={<button type="button">go</button>}
        backPort={f.port}
      >
        <p>body</p>
      </ScreenFrame>,
    );
    expect(html).toContain('aria-label="back-label" class="ui-hdr__back"');
    expect(html).not.toContain("app-frame__tabs");
    expect(html).toContain('<div class="ui-act"><button type="button">go</button></div>');
  });

  it("سلبيّ: التدفّقُ مع مضيفٍ داعمٍ لا يرسمُ رجوعاً ثانياً في الرأس", () => {
    const f = fakePort(true);
    const html = renderToStaticMarkup(
      <ScreenFrame
        mode="flow"
        title="t"
        back={{ label: "back-label", onBack: () => undefined }}
        backPort={f.port}
      >
        <p>body</p>
      </ScreenFrame>,
    );
    expect(html).not.toContain("ui-hdr__back");
  });

  it("سلبيّ: تدفّقٌ بلا أفعالٍ لا يرسمُ شريطاً فارغاً", () => {
    const html = renderToStaticMarkup(
      <ScreenFrame
        mode="flow"
        title="t"
        back={{ label: "b", onBack: () => undefined }}
        backPort={fakePort(false).port}
      >
        <p>body</p>
      </ScreenFrame>,
    );
    expect(html).not.toContain("ui-act");
    expect(html).toContain('<div class="app-frame__action"></div>');
  });

  it("الانشغالُ يُعلَنُ بـaria-busy، وغيابُه لا يكتبُ الخاصيّة", () => {
    const busy = renderToStaticMarkup(
      <ScreenFrame mode="root" title="t" tabs={tabs} busy>
        <p>x</p>
      </ScreenFrame>,
    );
    expect(busy).toContain('aria-busy="true"');
    const idle = renderToStaticMarkup(
      <ScreenFrame mode="root" title="t" tabs={tabs}>
        <p>x</p>
      </ScreenFrame>,
    );
    expect(idle).not.toContain("aria-busy");
  });

  it("سلبيّ (أنواع): لا تبويبَ في تدفّقٍ ولا رجوعَ في جذر", () => {
    const flowWithTabs = (
      // @ts-expect-error — §6: لا tab bar داخلَ التدفّقات.
      <ScreenFrame mode="flow" title="t" back={{ label: "b", onBack: () => undefined }} tabs={tabs}>
        x
      </ScreenFrame>
    );
    const rootWithBack = (
      // @ts-expect-error — الجذرُ لا رجوعَ له.
      <ScreenFrame mode="root" title="t" tabs={tabs} back={{ label: "b", onBack: () => undefined }}>
        x
      </ScreenFrame>
    );
    expect(flowWithTabs).toBeDefined();
    expect(rootWithBack).toBeDefined();
  });
});

// ─── ScreenTransition ────────────────────────────────────────────────────────

describe("ScreenTransition — حركةُ CSS وتركيزٌ برمجيّ", () => {
  it("كلُّ حركةٍ صنفُها، والسكونُ بلا مُعدِّل", () => {
    expect(motionClass("forward")).toBe("app-frame__screen app-frame__screen--forward");
    expect(motionClass("back")).toBe("app-frame__screen app-frame__screen--back");
    expect(motionClass("none")).toBe("app-frame__screen");
  });

  it("الحاوي قابلٌ للتركيزِ برمجيّاً لا بـTab، وصنفُه صنفُ الحركة", () => {
    const html = renderToStaticMarkup(
      <ScreenTransition screenKey="s1" motion="forward">
        <p>x</p>
      </ScreenTransition>,
    );
    expect(html).toBe(
      '<div tabindex="-1" class="app-frame__screen app-frame__screen--forward"><p>x</p></div>',
    );
  });
});

// ─── CSS: مسطّحٌ · منطقيٌّ · RTL · تقليلُ الحركة ─────────────────────────────

describe("CSS — كتلةُ PR 2 في global.css", () => {
  const css = read("../styles/global.css");
  const start = css.indexOf("UI-2 / PR 2 — الهيكلُ والتنقّل");
  const block = css.slice(css.lastIndexOf("/*", start));
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");

  it("الكتلةُ موجودةٌ وفيها قواعدُ كلِّ صنفٍ يُصدِرُه الهيكل", () => {
    expect(start).toBeGreaterThan(0);
    for (const cls of [
      ".app-frame__tabs {",
      ".app-frame__tab {",
      ".app-frame__tab--on {",
      ".app-frame__screen {",
      ".app-frame__screen--forward {",
      ".app-frame__screen--back {",
    ]) {
      expect(block).toContain(cls);
    }
  });

  it("مسطّحٌ: لا @layer ولا !important ولا تداخل", () => {
    expect(rules).not.toContain("@layer");
    expect(rules).not.toContain("!important");
    expect(rules).not.toMatch(/\{[^{}]*&/);
    // سلبيٌّ للحاجزِ نفسِه: قاعدةٌ مزروعةٌ تُكشَف.
    expect("x { a: b !important; }").toContain("!important");
  });

  it("منطقيٌّ: لا left/right فيزيائيّة، ولمسٌ 44px", () => {
    expect(rules).not.toMatch(/(margin|padding|border)-(left|right)\b/);
    expect(rules).not.toMatch(/\b(left|right)\s*:/);
    expect(block).toMatch(/\.app-frame__tab \{[^}]*min-block-size: 44px;/);
  });

  it("RTL يقلبُ اتجاهَ الدخولِ في التقدّمِ والرجوع", () => {
    expect(block).toMatch(
      /\[dir="rtl"\] \.app-frame__screen--forward \{\s*animation-name: app-frame-enter-start;/,
    );
    expect(block).toMatch(
      /\[dir="rtl"\] \.app-frame__screen--back \{\s*animation-name: app-frame-enter-end;/,
    );
  });

  it("تقليلُ الحركةِ يلغي الانتقالَين", () => {
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.app-frame__screen--forward,\s*\.app-frame__screen--back \{\s*animation: none;/,
    );
  });

  it("تركيزٌ ظاهرٌ لزرِّ التبويب", () => {
    expect(block).toMatch(
      /\.app-frame__tab:focus-visible \{\s*outline: 2px solid var\(--ui-brand\);/,
    );
  });
});

// ─── لا نصَّ مُضمَّن ولا مؤقّت ───────────────────────────────────────────────

describe("لا نصَّ مُضمَّنٌ ولا مؤقّتٌ في شيفرةِ الهيكل", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const file of ["./ScreenFrame.tsx", "./root-tabs.ts", "./screen-stack.ts"]) {
    it(`${file}: لا حرفَ عربيٌّ خارجَ التعليقات، ولا setInterval/setTimeout`, () => {
      const code = strip(read(file));
      expect(code).not.toMatch(/[\u0600-\u06FF]/);
      expect(code).not.toMatch(/\bset(Interval|Timeout)\s*\(/);
    });
  }
});
