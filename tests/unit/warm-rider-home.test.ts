/**
 * الغرض: إثباتُ أنَّ تسخينَ `rider-home` (`F1-09` · `D-31` · `ADR 0187`) لا يُحقَنُ إلّا لحزمةٍ يستوردُها سطحُ السائقِ ثابتاً،
 *   وأنَّ علامةَ السكربتِ الساكنِ تُستبدَلُ مرّةً واحدةً بالضبطِ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  injectWarmChunk,
  resolveWarmChunk,
  resolveWarmChunks,
  WARM_PLACEHOLDER,
  type WarmChunk,
} from "../../apps/miniapp/vite/warm-rider-home.ts";

const RIDER: WarmChunk = {
  fileName: "assets/rider-home-A.js",
  moduleIds: ["/app/src/surfaces/rider/RiderRoot.tsx"],
  imports: ["assets/shell-B.js"],
};
const driver = (imports: string[]): WarmChunk => ({
  fileName: "assets/driver-C.js",
  moduleIds: ["/app/src/surfaces/driver/DriverRoot.tsx"],
  imports,
});

describe("resolveWarmChunk (F1-09 · D-31)", () => {
  it("يُعيدُ حزمةَ الراكبِ حينَ يستوردُها السائقُ ثابتاً", () => {
    expect(resolveWarmChunk([RIDER, driver(["assets/rider-home-A.js"])])).toEqual({
      ok: true,
      fileName: "assets/rider-home-A.js",
    });
  });

  it("يرفضُ حينَ انفصلَ السطحانِ — التسخينُ يُهدَرُ على السائقِ", () => {
    const r = resolveWarmChunk([RIDER, driver(["assets/shell-B.js"])]);
    expect(r.ok).toBe(false);
  });

  it("يرفضُ حينَ لا حزمةَ للراكبِ أو للسائقِ", () => {
    expect(resolveWarmChunk([driver([])]).ok).toBe(false);
    expect(resolveWarmChunk([RIDER]).ok).toBe(false);
  });
});

describe("resolveWarmChunks — تبعيّاتُ `rider-home` خارجَ رسمِ المدخل (PRD-009 · ADR 0258)", () => {
  const entry: WarmChunk = {
    fileName: "assets/index.js",
    moduleIds: [],
    imports: ["assets/shell-B.js"],
    isEntry: true,
  };
  const shell: WarmChunk = {
    fileName: "assets/shell-B.js",
    moduleIds: [],
    imports: ["assets/vendor-react-V.js"],
  };
  const vendor: WarmChunk = { fileName: "assets/vendor-react-V.js", moduleIds: [], imports: [] };
  const runtime: WarmChunk = {
    fileName: "assets/rolldown-runtime-R.js",
    moduleIds: [],
    imports: [],
  };
  const rider: WarmChunk = {
    ...RIDER,
    imports: ["assets/shell-B.js", "assets/vendor-react-V.js", "assets/rolldown-runtime-R.js"],
  };
  const all = [entry, shell, vendor, runtime, rider, driver(["assets/rider-home-A.js"])];

  it("يُسخِّنُ `rider-home` أوّلًا ثمَّ ما لا يبلغُه المدخلُ ثابتًا (`rolldown-runtime`)", () => {
    expect(resolveWarmChunks(all)).toEqual({
      ok: true,
      fileNames: ["assets/rider-home-A.js", "assets/rolldown-runtime-R.js"],
    });
  });

  it("سلبيّ: ما يبلغُه المدخلُ بالتعدّي (`shell` ← `vendor-react`) لا يُكرَّرُ تسخينُه", () => {
    const r = resolveWarmChunks(all);
    expect(r.ok && r.fileNames).not.toContain("assets/shell-B.js");
    expect(r.ok && r.fileNames).not.toContain("assets/vendor-react-V.js");
  });

  it("سلبيّ: رفضُ `resolveWarmChunk` يمرُّ كما هوَ — لا تسخينَ لسطحَين منفصلَين", () => {
    expect(resolveWarmChunks([entry, rider, driver([])]).ok).toBe(false);
  });
});

describe("injectWarmChunk (F1-09 · D-31)", () => {
  it("يستبدلُ العلامةَ مرّةً واحدةً", () => {
    const html = `<script>var warm = "${WARM_PLACEHOLDER}";</script>`;
    expect(injectWarmChunk(html, "/assets/rider-home-A.js")).toBe(
      '<script>var warm = "/assets/rider-home-A.js";</script>',
    );
  });

  it("يرفضُ غيابَ العلامةِ أو تكرارَها", () => {
    expect(() => injectWarmChunk("<script></script>", "/x.js")).toThrow();
    const twice = `"${WARM_PLACEHOLDER}" "${WARM_PLACEHOLDER}"`;
    expect(() => injectWarmChunk(twice, "/x.js")).toThrow();
  });
});

describe("موضعُ التسخينِ في سكربتِ ما قبلَ الإقلاعِ (F1-09 · D-34 · ADR 0189)", () => {
  const html = readFileSync(resolve(import.meta.dirname, "../../apps/miniapp/index.html"), "utf8");
  const script = html.slice(
    html.indexOf("var initData"),
    html.indexOf("})();", html.indexOf("var initData")),
  );
  const warmAt = script.indexOf(`var warm = "${WARM_PLACEHOLDER}"`);

  it("بعدَ شرطِ `initData` وإرسالِ الجلسةِ — لا تسخينَ خارجَ تيليجرامَ", () => {
    expect(warmAt).toBeGreaterThan(script.indexOf("if (initData.length === 0) return;"));
    expect(warmAt).toBeGreaterThan(script.indexOf('fetch(base + "/v1/session/telegram"'));
  });

  it("القيمةُ قائمةٌ بفواصل: كلُّ عنصرٍ وسمُ `modulepreload` مستقلّ (PRD-009 · ADR 0258)", () => {
    expect(script.slice(warmAt)).toContain('warm.split(",")');
    expect(script.slice(warmAt)).toContain('l.rel = "modulepreload"');
  });

  it("لا ينتظرُ نجاحَ الجلسةِ ولا الدورَ: خارجَ كلِّ `.then(`", () => {
    const before = script.slice(0, warmAt);
    const opened = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(opened).toBe(0);
    expect(script.slice(warmAt)).not.toContain("viewer");
  });
});
