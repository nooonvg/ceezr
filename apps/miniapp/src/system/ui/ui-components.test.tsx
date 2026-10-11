/**
 * الغرض: إثباتُ تصليبِ مكوّناتِ `ui-*` الثلاثينَ (UI-1 / PR 1 · ADR 0233 «تصليبُ PR 1»).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/system/ui
 *
 * كلُّ خللٍ وُجِدَ في التدقيقِ له هنا اختبارٌ إيجابيٌّ (السلوكُ الصحيحُ قائمٌ)
 * وسلبيٌّ حيث يُمكنُ (الحاجزُ يُسقِطُ العودةَ إلى الخلل).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  avatarInitial,
  cancelToClose,
  type ModalElement,
  progressBounds,
  stepState,
  syncModal,
  tabKeyTarget,
  timerRatio,
  UiActionBar,
  UiAvatar,
  UiBanner,
  UiButton,
  UiChip,
  UiCopy,
  UiDialog,
  UiDivider,
  UiEmpty,
  UiError,
  UiField,
  UiHeader,
  UiPlaceholder,
  UiProgress,
  UiRail,
  UiSegment,
  UiSheet,
  UiSkeleton,
  UiStatus,
  UiStepper,
  UiTab,
  UiTabPanel,
  UiTimer,
  UiToast,
  UiTruth,
} from "./index.tsx";

const SOURCE_FILES = [
  "apps/miniapp/src/system/ui/index.tsx",
  "apps/miniapp/src/system/ui/icons.tsx",
] as const;

const html = (node: ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

/** يمحو التعليقاتَ كي لا يُحسَبَ نصُّ التوثيقِ نصّاً معروضاً. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * خروقُ «لا نصَّ مُضمَّن» و«عرضيٌّ صرف» في مصدرِ مكوّنٍ. التخزينُ غيرُ مذكورٍ ههنا عن
 * قصدٍ: `check-session-storage-policy` يحظرُه على التطبيقِ المصغَّرِ كلِّه (F1-04)،
 * ومنه `system/ui/`، فلا يُكرَّرُ حاجزٌ ولا يُوسَّعُ استثناؤه.
 */
function sourceProblems(source: string): readonly string[] {
  const body = code(source);
  const problems: string[] = [];
  if (/[\u0600-\u06FF]/.test(body)) problems.push("نصٌّ عربيٌّ مُضمَّنٌ خارجَ التعليقات");
  for (const banned of ["navigator.", "setInterval", "setTimeout", "fetch(", "useState"]) {
    if (body.includes(banned)) problems.push(`أثرٌ جانبيٌّ أو حالةٌ: ${banned}`);
  }
  return problems;
}

describe("ui-* — لا نصَّ مُضمَّنٌ ولا أثرَ جانبيٌّ", () => {
  for (const file of SOURCE_FILES) {
    it(`${file} نظيفٌ`, () => {
      expect(sourceProblems(readFileSync(file, "utf8"))).toEqual([]);
    });
  }

  it("الحاجزُ يُسقِطُ افتراضاً نصّيّاً مزروعاً وحافظةً مزروعةً (سلبيٌّ)", () => {
    const planted =
      'export function X({ label = "إغلاق" }) { navigator.clipboard?.writeText("x"); }';
    const problems = sourceProblems(planted);
    expect(problems.some((p) => p.includes("نصٌّ عربيٌّ"))).toBe(true);
    expect(problems.some((p) => p.includes("navigator."))).toBe(true);
  });

  it("التعليقُ العربيُّ لا يُحسَبُ نصّاً معروضاً", () => {
    expect(sourceProblems("/** شرحٌ */\n// شرحٌ\nexport const a = 1;")).toEqual([]);
  });
});

describe("ui-stp — مؤشّرٌ بلا تفاعلٍ وهميٍّ", () => {
  it("لا زرَّ إطلاقاً، والنصُّ من المستدعي، والقطعُ بعددِ الخطوات", () => {
    const out = html(<UiStepper current={2} total={3} text="T-2-3" />);
    expect(out).not.toContain("<button");
    expect(out).toContain("T-2-3");
    expect(out.match(/ui-stp__seg /g)?.length).toBe(3);
    expect(out).toContain("ui-stp__seg--done");
    expect(out).toContain("ui-stp__seg--current");
    expect(out).toContain("ui-stp__seg--pending");
    expect(out).toContain('aria-hidden="true"');
  });

  it("stepState: قبلَ/عندَ/بعدَ الحاليّة", () => {
    expect(stepState(1, 2)).toBe("done");
    expect(stepState(2, 2)).toBe("current");
    expect(stepState(3, 2)).toBe("pending");
  });

  it("عددٌ غيرُ صالحٍ لا يختلقُ قطعاً (سلبيٌّ)", () => {
    expect(html(<UiStepper current={1} total={Number.NaN} text="x" />)).not.toContain(
      "ui-stp__seg ",
    );
    expect(html(<UiStepper current={1} total={0} text="x" />)).not.toContain("ui-stp__seg ");
  });
});

describe("كلُّ زرٍّ له فعلٌ حقيقيٌّ", () => {
  it("ui-chip: الضغطُ يستدعي onToggle", () => {
    let calls = 0;
    const el = UiChip({ label: "c", selected: false, onToggle: () => calls++ });
    (el.props as { onClick: () => void }).onClick();
    expect(calls).toBe(1);
    expect(html(el)).toContain('aria-pressed="false"');
  });

  it("ui-btn: الضغطُ يمرُّ، وأثناءَ الانتظارِ يُبتلَعُ ويبقى قابلاً للتركيز", () => {
    let calls = 0;
    const evt = { preventDefault: noop } as never;
    const idle = UiButton({ children: "x", onClick: () => calls++ });
    (idle.props as { onClick: (e: never) => void }).onClick(evt);
    expect(calls).toBe(1);

    const busy = UiButton({ children: "x", loading: true, onClick: () => calls++ });
    (busy.props as { onClick: (e: never) => void }).onClick(evt);
    expect(calls).toBe(1);
    const out = html(busy);
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
    // `disabled` أصيلٌ بأيِّ تسلسل (React: `disabled=""`، Preact: `disabled`) — لا يظهر؛ `aria-disabled` وحدَه.
    expect(out).not.toMatch(/\sdisabled(=""|[\s>])/);
    expect(out).toContain("ui-btn__spinner");
  });

  it("ui-btn: لا يُستبدَلُ صنفُه ولا يُختلَقُ نصٌّ للدوّار", () => {
    const out = html(<UiButton loading>x</UiButton>);
    expect(out).toContain('class="ui-btn ui-btn--neutral ui-btn--md"');
    expect(out).not.toContain("<title>");
  });

  it("ui-hdr: زرُّ الرجوعِ لا يُرسَمُ بلا فعلٍ ووسمٍ، ولا نمطَ مُضمَّن", () => {
    expect(html(<UiHeader title="t" />)).not.toContain("<button");
    let back = 0;
    const out = html(<UiHeader title="t" back={{ label: "B", onBack: () => back++ }} />);
    expect(out).toContain('aria-label="B"');
    expect(out).not.toContain("style=");
  });

  it("ui-toast: زرُّ الإغلاقِ بوسمٍ من المستدعي أو لا زرّ", () => {
    expect(html(<UiToast message="m" tone="ok" />)).not.toContain("<button");
    const out = html(<UiToast message="m" tone="ok" dismiss={{ label: "D", onDismiss: noop }} />);
    expect(out).toContain('aria-label="D"');
    expect(out).toMatch(/^<output/);
    expect(out).not.toContain("aria-live");
  });

  it("ui-copy: لا حافظةَ داخلَ المكوّن، والاسمُ يشملُ القيمةَ", () => {
    let copied = 0;
    const el = UiCopy({ text: "AB12", label: "L", onCopy: () => copied++ });
    (el.props as { onClick: () => void }).onClick();
    expect(copied).toBe(1);
    const out = html(el);
    expect(out).not.toContain("aria-label");
    expect(out).toContain("L");
    expect(out).toContain("AB12");
  });
});

describe("ui-tab — WAI-ARIA Tabs", () => {
  const tabs = [
    { id: "t-a", panelId: "p-a", label: "A" },
    { id: "t-b", panelId: "p-b", label: "B" },
    { id: "t-c", panelId: "p-c", label: "C" },
  ];

  it("تركيزٌ متجوّلٌ + aria-controls + اسمُ القائمة", () => {
    const out = html(<UiTab label="L" tabs={tabs} active="t-b" onSelect={noop} />);
    expect(out).toContain('role="tablist" aria-label="L"');
    expect(out.match(/tabindex="0"/g)?.length).toBe(1);
    expect(out.match(/tabindex="-1"/g)?.length).toBe(2);
    expect(out).toContain('aria-controls="p-b"');
    expect(out).toContain('id="t-b"');
  });

  it("الأسهمُ تتبعُ الاتّجاه: في RTL السهمُ الأيسرُ يتقدّم", () => {
    expect(tabKeyTarget(0, 3, "ArrowRight", false)).toBe(1);
    expect(tabKeyTarget(0, 3, "ArrowLeft", true)).toBe(1);
    expect(tabKeyTarget(0, 3, "ArrowRight", true)).toBe(2);
    expect(tabKeyTarget(2, 3, "ArrowRight", false)).toBe(0);
    expect(tabKeyTarget(1, 3, "Home", true)).toBe(0);
    expect(tabKeyTarget(1, 3, "End", false)).toBe(2);
  });

  it("مفتاحٌ آخرُ أو قائمةٌ فارغةٌ لا تنقلُ (سلبيٌّ)", () => {
    expect(tabKeyTarget(0, 3, "Enter", false)).toBeNull();
    expect(tabKeyTarget(0, 0, "ArrowRight", false)).toBeNull();
  });

  it("اللوحةُ مربوطةٌ بزرِّها ومخفيّةٌ حينَ لا تنشط", () => {
    const on = html(
      <UiTabPanel id="p-a" tabId="t-a" active>
        x
      </UiTabPanel>,
    );
    expect(on).toContain('role="tabpanel"');
    expect(on).toContain('aria-labelledby="t-a"');
    expect(on).not.toContain("hidden");
    const off = html(
      <UiTabPanel id="p-b" tabId="t-b" active={false}>
        x
      </UiTabPanel>,
    );
    expect(off).toMatch(/ hidden[ >]/);
  });
});

describe("ui-sg — راديو أصيلٌ باسمٍ مستقلٍّ", () => {
  it("name من المستدعي لا من الوسمِ المرئيّ", () => {
    const out = html(
      <UiSegment
        name="seg-x"
        label="Visible label"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        value="b"
        onSelect={noop}
      />,
    );
    expect(out.match(/name="seg-x"/g)?.length).toBe(2);
    expect(out).not.toContain('name="Visible label"');
    expect(out).toContain('role="radiogroup" aria-label="Visible label"');
    expect(out).toContain("ui-sg__item ui-sg__item--on");
  });
});

describe("ui-sht / ui-dg — <dialog> أصيلٌ", () => {
  for (const [name, node] of [
    [
      "ui-sht",
      <UiSheet key="s" open title="T" closeLabel="X" onClose={noop}>
        b
      </UiSheet>,
    ],
    [
      "ui-dg",
      <UiDialog key="d" open title="T" closeLabel="X" onClose={noop}>
        b
      </UiDialog>,
    ],
  ] as const) {
    it(`${name}: عنصرُ dialog مُسمّى بعنوانِه، ووسمُ الإغلاقِ من المستدعي`, () => {
      const out = html(node);
      expect(out).toMatch(/^<dialog /);
      expect(out).not.toContain('role="dialog"');
      expect(out).not.toContain("__overlay");
      const labelled = out.match(/aria-labelledby="([^"]+)"/)?.[1];
      expect(labelled).toBeDefined();
      expect(out).toContain(`id="${labelled}"`);
      expect(out).toContain('aria-label="X"');
    });
  }

  function fakeDialog(withApi: boolean) {
    const log: string[] = [];
    const el: ModalElement & { open: boolean } = {
      open: false,
      setAttribute: (n) => {
        log.push(`set:${n}`);
        el.open = true;
      },
      removeAttribute: (n) => {
        log.push(`remove:${n}`);
        el.open = false;
      },
    };
    if (withApi) {
      el.showModal = () => {
        log.push("showModal");
        el.open = true;
      };
      el.close = () => {
        log.push("close");
        el.open = false;
      };
    }
    return { el, log };
  }

  it("syncModal: الفتحُ بـshowModal والإغلاقُ بـclose، ولا تكرار", () => {
    const { el, log } = fakeDialog(true);
    syncModal(el, true);
    syncModal(el, true);
    syncModal(el, false);
    syncModal(el, false);
    expect(log).toEqual(["showModal", "close"]);
  });

  it("syncModal: بلا showModal يُفتَحُ بالخاصيّةِ لا يُفقَد (سلبيٌّ)", () => {
    const { el, log } = fakeDialog(false);
    syncModal(el, true);
    syncModal(el, false);
    expect(log).toEqual(["set:open", "remove:open"]);
  });

  it("Escape: الإغلاقُ الأصيلُ ممنوعٌ والقرارُ للمستدعي", () => {
    let prevented = 0;
    let closed = 0;
    cancelToClose(() => closed++)({ preventDefault: () => prevented++ });
    expect([prevented, closed]).toEqual([1, 1]);
  });
});

describe("ui-fld — ربطُ الوسمِ والتلميحِ والخطأ", () => {
  it("بلا خطأ: لا aria-invalid، والتلميحُ موصوفٌ", () => {
    const out = html(<UiField id="f1" label="L" hint="H" />);
    expect(out).toContain('for="f1"');
    expect(out).toContain('aria-describedby="f1-hint"');
    expect(out).not.toContain("aria-invalid");
  });

  it("مع خطأ: aria-invalid والتلميحُ والخطأُ معاً موصوفان", () => {
    const out = html(<UiField id="f1" label="L" hint="H" error="E" />);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="f1-hint f1-error"');
    expect(out).toContain('id="f1-error" role="alert"');
  });
});

describe("المناطقُ الحيّةُ والأدوارُ — بلا ضجيجٍ ولا ازدواج", () => {
  it("ui-st / ui-pl / ui-empty / ui-banner ساكنةٌ", () => {
    for (const out of [
      html(<UiStatus label="s" tone="ok" />),
      html(<UiPlaceholder label="p" />),
      html(<UiEmpty title="t" body="b" />),
      html(<UiBanner message="m" tone="amber" />),
    ]) {
      expect(out).not.toContain('role="status"');
      expect(out).not.toContain('role="img"');
      expect(out).not.toContain("aria-live");
    }
  });

  it("ui-err: role=alert، والأيقونةُ داخلَ شارةٍ مُعبَّأة", () => {
    const out = html(<UiError title="t" body="b" tone="bad" />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("ui-err__badge");
  });

  it("ui-truth: <output> واحدٌ، و«المجهولُ» نغمةٌ محايدةٌ", () => {
    const out = html(<UiTruth text="unknown-x" tone="unknown" />);
    expect(out).toMatch(/^<output class="ui-truth ui-truth--unknown"/);
    expect(out).toContain("unknown-x");
  });

  it("ui-skel: اسمٌ من المستدعي، والأسطرُ مخفيّة", () => {
    const out = html(<UiSkeleton label="LOADING" lines={2} />);
    expect(out).toContain('aria-label="LOADING"');
    expect(out.match(/ui-skel__line/g)?.length).toBe(2);
  });

  it("ui-act: ليسَ معلمَ تنقّل", () => {
    expect(html(<UiActionBar>x</UiActionBar>)).not.toContain("<nav");
  });
});

describe("ui-rail — الحالةُ لا تُقالُ باللونِ وحدَه", () => {
  it("المنجزُ علامةٌ لا رقمٌ، ولكلِّ خطوةٍ نصُّ حالتِها", () => {
    const out = html(
      <UiRail
        label="R"
        stateText={{ done: "SD", current: "SC", pending: "SP" }}
        steps={[
          { id: "a", label: "A", state: "done" },
          { id: "b", label: "B", state: "current" },
          { id: "c", label: "C", state: "pending" },
        ]}
      />,
    );
    expect(out).toContain('aria-label="R"');
    expect(out).toContain("ui-rail__check");
    expect(out).toContain('aria-current="step"');
    for (const t of ["SD", "SC", "SP"]) expect(out).toContain(t);
    expect(out).not.toMatch(/aria-hidden="true" class="ui-rail__dot">1</);
    expect(out).toMatch(/aria-hidden="true" class="ui-rail__dot">3</);
  });
});

describe("ui-timer — مؤقّتُ CSS بلا عدٍّ يتجمّد", () => {
  it("الاسمُ من الوسمِ والموعدِ، والتفريغُ برموزِ CSS", () => {
    const out = html(
      <UiTimer
        label="LBL"
        deadlineText="DL"
        remainingSeconds={30}
        totalSeconds={60}
        tone="amber"
      />,
    );
    const ids = out.match(/aria-labelledby="([^"]+)"/)?.[1]?.split(" ") ?? [];
    expect(ids.length).toBe(2);
    for (const id of ids) expect(out).toContain(`id="${id}"`);
    expect(out).toContain("--ui-timer-start:0.5");
    expect(out).toContain("--ui-timer-duration:30s");
    expect(out).not.toMatch(/\d+:\d\d/);
  });

  it("timerRatio: مقصورٌ، والمدخلُ غيرُ الصالحِ صفرٌ لا قيمةٌ مختلقة", () => {
    expect(timerRatio(30, 60)).toBe(0.5);
    expect(timerRatio(90, 60)).toBe(1);
    expect(timerRatio(-5, 60)).toBe(0);
    expect(timerRatio(10, 0)).toBe(0);
    expect(timerRatio(Number.NaN, 60)).toBe(0);
  });
});

describe("ui-pg — <progress> بلا بديلٍ ميّت", () => {
  it("لا محتوى داخليٌّ ولا نمطٌ مُضمَّن", () => {
    const out = html(<UiProgress value={40} max={100} label="P" />);
    expect(out).toBe('<progress value="40" max="100" aria-label="P" class="ui-pg"></progress>');
  });

  it("progressBounds يقصرُ القيمةَ ويرفضُ الحدَّ غيرَ الصالح", () => {
    expect(progressBounds(150, 100)).toEqual({ value: 100, max: 100 });
    expect(progressBounds(-1, 100)).toEqual({ value: 0, max: 100 });
    expect(progressBounds(5, 0)).toEqual({ value: 0, max: 1 });
    expect(progressBounds(Number.NaN, 10)).toEqual({ value: 0, max: 10 });
  });
});

describe("ui-av / ui-ds", () => {
  it("ui-av: الصورةُ تُسمّى مرّةً (alt) بلا role=img مزدوج", () => {
    const out = html(<UiAvatar name="N" src="/a.png" />);
    expect(out).toContain('alt="N"');
    expect(out).not.toContain('role="img"');
  });

  it("ui-av: الحرفُ الأوّلُ محرفٌ كاملٌ، والاسمُ الفارغُ مخفيّ", () => {
    expect(avatarInitial("  سارة")).toBe("س");
    expect(avatarInitial("😀x")).toBe("😀");
    expect(html(<UiAvatar name="  " />)).toContain('aria-hidden="true"');
  });

  it("ui-ds: hr بلا وسمٍ، ونسخةُ الوسمِ معدَّلةٌ لا hr", () => {
    expect(html(<UiDivider />)).toBe('<hr class="ui-ds"/>');
    expect(html(<UiDivider label="or" />)).toContain('class="ui-ds ui-ds--labeled"');
  });
});

// ─── CSS: كتلةُ PR 1 ──────────────────────────────────────────────────────────

const CSS = readFileSync("apps/miniapp/src/styles/global.css", "utf8");
const MARK = "UI-1 / PR 1 — نظامُ التصميم";

function pr1Block(css: string): string {
  const at = css.indexOf(MARK);
  if (at < 0) throw new Error("كتلةُ PR 1 غائبةٌ عن global.css");
  return css.slice(css.lastIndexOf("/*", at)).replace(/\/\*[\s\S]*?\*\//g, "");
}

/** خروقُ كتلةِ PR 1: رموزٌ ميتةٌ/غيرُ معرَّفةٍ، وخصائصُ فيزيائيّةٌ، وطبقاتٌ وأولويّات. */
function cssProblems(block: string): readonly string[] {
  const problems: string[] = [];
  const defined = new Set([...block.matchAll(/(--ui-[a-z-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...block.matchAll(/var\((--ui-[a-z-]+)/g)].map((m) => m[1]));
  for (const name of used) {
    if (!defined.has(name) && name !== "--ui-timer-start" && name !== "--ui-timer-duration") {
      problems.push(`رمزٌ مُستعمَلٌ غيرُ معرَّف: ${name}`);
    }
  }
  for (const name of defined) {
    // ألوانُ Layer 2 وسُلَّمُ §3 واجهةٌ عامّةٌ كاملةٌ (يُثبَتُ تطابقُها أدناه)؛ سواهما يُستعمَلُ أو يُحذَف.
    if (
      !used.has(name) &&
      !/^--ui-(brand|amber|ok|bad|info|size-|line-|weight-)/.test(name ?? "")
    ) {
      problems.push(`رمزٌ معرَّفٌ لا يُستعمَل: ${name}`);
    }
  }
  if (/@layer|!important/.test(block)) problems.push("@layer أو !important");
  const physical =
    /(^|[\s;{])(margin|padding|border)-(left|right)\s*:|(^|[\s;{])(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/m;
  if (physical.test(block)) problems.push("خاصيّةٌ فيزيائيّةٌ بدلَ المنطقيّة");
  if (/font-size:\s*var\(--ui-font-/.test(block)) problems.push("رمزُ طباعةٍ مركّبٌ في font-size");
  return problems;
}

describe("CSS — كتلةُ PR 1", () => {
  const block = pr1Block(CSS);

  it("لا خرقَ: رموزٌ معرَّفةٌ ومستعملةٌ، منطقيّةٌ، مسطّحة", () => {
    expect(cssProblems(block)).toEqual([]);
  });

  it("الحاجزُ يُسقِطُ رمزاً مركّباً وخاصيّةً فيزيائيّةً ورمزاً غيرَ معرَّف (سلبيٌّ)", () => {
    const planted =
      ":root { --ui-x: 1rem / 1.2; } .a { font-size: var(--ui-font-body); margin-left: 1px; color: var(--ui-y); }";
    const problems = cssProblems(planted);
    expect(problems.some((p) => p.includes("مركّب"))).toBe(true);
    expect(problems.some((p) => p.includes("فيزيائيّة"))).toBe(true);
    expect(problems.some((p) => p.includes("--ui-y"))).toBe(true);
  });

  it("سُلَّمُ الطباعةِ = جدولُ §3 في الدليلِ حرفاً (حجمٌ/سطرٌ/وزنٌ لكلِّ دور)", () => {
    const directive = readFileSync("docs/UI_UX_CANONICAL_DIRECTIVE.md", "utf8");
    const rows = [
      ...directive.matchAll(
        /^\| (display|title|heading|body|label|caption|mono) \| ([\d.]+rem) \/ ([\d.]+) \| (\d+)/gm,
      ),
    ];
    expect(rows.length).toBe(7);
    const value = (name: string) => block.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim();
    for (const [, role, size, line, weight] of rows) {
      expect(value(`--ui-size-${role}`)).toBe(size);
      expect(value(`--ui-line-${role}`)).toBe(line);
      expect(value(`--ui-weight-${role}`)).toBe(weight);
    }
  });

  it("ui-pg: لا قاعدةَ لبديلٍ ميّتٍ، وappearance مُصفَّرٌ كي تنطبقَ أشباهُ العناصر", () => {
    expect(block).not.toContain(".ui-pg__bar");
    expect(block).toMatch(/\.ui-pg \{[^}]*appearance: none;/);
  });

  it("ui-ds: hr لا يُعطى display:flex يمحوه", () => {
    expect(block).toMatch(/\.ui-ds \{[^}]*block-size: 1px;[^}]*background:/);
    expect(block).not.toMatch(/\.ui-ds \{[^}]*display: flex/);
  });

  it("سهمُ الرجوعِ يتبعُ الاتّجاهَ، والحركةُ تحترمُ التخفيف", () => {
    expect(block).toContain('[dir="rtl"] .ui-hdr__back-icon');
    expect(block).toContain("@media (prefers-reduced-motion: reduce)");
    expect(block).toMatch(/\.ui-sht::backdrop/);
    expect(block).toMatch(/\.ui-dg::backdrop/);
  });

  it("اللونُ الدلاليُّ لا يُكتَبُ نصّاً على سطحٍ مجهول", () => {
    for (const rule of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = rule[2] ?? "";
      const colorTone = /(^|[\s;])color:\s*var\(--ui-(brand|amber|ok|bad)\)/.test(body);
      if (!colorTone) continue;
      expect(`${rule[1]?.trim()} → ${/background:\s*var\(--ui-/.test(body)}`).toContain("→ true");
    }
  });
});

describe("UX-V2 · رموزُ الرسمِ الزخرفيِّ (ADR 0248)", () => {
  it("`--w-glyph-*` لا يلوِّنُ إلا حاويَ رمزٍ زخرفيٍّ (icon/avatar/pulse) — لا نصّاً", () => {
    const flat = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders: string[] = [];
    for (const rule of flat.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = rule[1]?.trim() ?? "";
      const body = rule[2] ?? "";
      if (!/var\(--w-glyph-/.test(body) || selector === ":root") continue;
      const parts = selector.split(",").map((part) => part.trim());
      if (!parts.every((part) => /(icon|avatar|pulse)\b[^\s]*$/.test(part)))
        offenders.push(selector);
    }
    expect(offenders).toEqual([]);
  });
});
