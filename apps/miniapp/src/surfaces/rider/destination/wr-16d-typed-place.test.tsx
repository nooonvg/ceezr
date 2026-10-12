/**
 * الغرض: `WR-16D` — اسمُ مكانٍ مكتوبٌ مثلُ «الحرم» لا يُستبدَلُ بالموقعِ الحاليّ: الاختصارُ منفصلٌ
 *   وبعدَ نتائجِ البحث، ولا يمحو مكانًا مختارًا بالاسمِ دونَ سؤال.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/destination
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ar from "../../../../../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../../../../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../../../../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };
import { DestinationScreen } from "./DestinationScreen.tsx";
import { locateIntent, locateShortcutPlacement } from "./destination-view.ts";

describe("WR-16D — موضعُ اختصارِ الموقعِ الحاليّ", () => {
  it("قبلَ النتائجِ ما دامَ البحثُ فارغًا، وبعدَها حينَ يُكتَبُ اسم", () => {
    expect(locateShortcutPlacement("")).toBe("beforeResults");
    expect(locateShortcutPlacement(" ")).toBe("beforeResults");
    expect(locateShortcutPlacement("الحرم")).toBe("afterResults");
  });

  it("الشاشةُ الفارغةُ تعرضُ الاختصارَ ولا تقرأُ الموقعَ وحدَها", () => {
    let reads = 0;
    const html = renderToStaticMarkup(
      <DestinationScreen
        initialLanguage="ar"
        readDeviceLocation={async () => {
          reads += 1;
          return { ok: false, reason: "denied" } as never;
        }}
      />,
    );
    expect(html).toContain("rd__locate-shortcut");
    expect(html).toContain(ar["rider.destination.location.action"]);
    expect(reads).toBe(0);
  });

  it("الشاشةُ تضعُ الاختصارَ في الموضعين بحكمِ الدالّةِ لا ثابتًا قبلَ النتائج", () => {
    const source = readFileSync(new URL("./DestinationScreen.tsx", import.meta.url), "utf8");
    const before = source.indexOf('locateShortcutPlacement(typed) === "beforeResults"');
    const results = source.indexOf("{results()}");
    const after = source.indexOf('locateShortcutPlacement(typed) === "afterResults"');
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(results);
    expect(after).toBeGreaterThan(results);
  });
});

describe("WR-16D — لا استبدالَ دونَ موافقة", () => {
  it("لا مكانَ مختارًا، أو نقطةٌ بلا اسم: يُقرأُ الموقعُ مباشرة", () => {
    expect(locateIntent(null)).toEqual({ kind: "read" });
    expect(locateIntent({ presetLabel: null })).toEqual({ kind: "read" });
    expect(locateIntent({ presetLabel: "  " })).toEqual({ kind: "read" });
  });

  it("مكانٌ مختارٌ بالاسمِ يُسألُ عنه قبلَ الاستبدال", () => {
    expect(locateIntent({ presetLabel: "الحرم" })).toEqual({
      kind: "confirmReplace",
      label: "الحرم",
    });
  });

  it("نصوصُ السؤالِ في اللغاتِ الثلاث، وتحملُ اسمَ المكان", () => {
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      for (const key of [
        "rider.destination.location.orInstead",
        "rider.destination.location.replaceYes",
      ]) {
        expect(typeof dict[key]).toBe("string");
      }
      expect(dict["rider.destination.location.replaceAsk"]).toContain("{label}");
      expect(dict["rider.destination.location.replaceKeep"]).toContain("{label}");
    }
  });
});
