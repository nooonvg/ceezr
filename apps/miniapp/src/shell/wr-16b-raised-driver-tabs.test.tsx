/**
 * الغرض: `WR-16B` — شريطُ تنقّلِ السائقِ مرفوعٌ فوقَ المنطقةِ الآمنةِ السفلى ويلتصقُ أثناءَ التمرير،
 *   وشريطُ الراكبِ على حالِه، وكلُّ تبويبٍ ينقلُ إلى محتواه ويُميَّزُ الحاليّ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/shell
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RootTabBar, rootTabBarClass } from "./ScreenFrame.tsx";

const DRIVER_LABELS = { offers: "العروض", job: "مهمتي", earnings: "حصيلتي", account: "حسابي" };

describe("WR-16B — صنفُ الشريط", () => {
  it("السائقُ مرفوعٌ والراكبُ على حاله", () => {
    expect(rootTabBarClass("driver")).toBe("app-frame__tabs app-frame__tabs--raised");
    expect(rootTabBarClass("rider")).toBe("app-frame__tabs");
  });

  it("شريطُ السائقِ يحملُ الصنفَ، والتبويبُ الحاليُّ `aria-current` وحدَه", () => {
    const html = renderToStaticMarkup(
      <RootTabBar
        surface="driver"
        label="nav"
        labels={DRIVER_LABELS}
        active="job"
        onSelect={() => undefined}
      />,
    );
    expect(html).toContain('class="app-frame__tabs app-frame__tabs--raised"');
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    const current = html.split("<button").find((b) => b.includes('aria-current="page"')) ?? "";
    expect(current).toContain("app-frame__tab--on");
    expect(current).toContain("مهمتي");
  });
});

describe("WR-16B — CSS الشريطِ المرفوع", () => {
  const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  };

  it("الحاوي يلتصقُ فوقَ `--safe-bottom` بمسافةٍ ويحجزُها في آخرِ المحتوى", () => {
    const action = rule(".app-frame__action:has(> .app-frame__tabs--raised)");
    expect(action).toContain("position: sticky;");
    expect(action).toContain("inset-block-end: calc(0.75rem + var(--safe-bottom));");
    expect(action).toContain("margin-block-end: calc(0.75rem + var(--safe-bottom));");
  });

  it("الشريطُ نفسُه لا يحسبُ الحاشيةَ الآمنةَ مرّتين ولا يمتدُّ تحتَ أزرارِ النظام", () => {
    const tabs = rule(".app-frame__tabs--raised");
    expect(tabs).toContain("position: static;");
    expect(tabs).toContain("padding: 0.375rem 0.5rem;");
    expect(tabs).not.toContain("--safe-bottom");
    expect(tabs).toContain("margin-inline: 0;");
  });
});
