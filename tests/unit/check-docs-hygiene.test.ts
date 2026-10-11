/**
 * الغرض: قياسُ **سقوطِ** حاجزِ نظافةِ التوثيقِ بخرقٍ مزروعٍ لكلِّ قاعدة، لا بالمستودَعِ كما هو.
 * الحالة: منفّذ فعلياً — تنظيفُ المستودع 2026-10-11.
 * ينتمي إلى: tests/unit.
 */

import { describe, expect, test } from "bun:test";
import { defaultInputs } from "../../scripts/check-docs-hygiene.ts";
import {
  type DocsHygieneInputs,
  declaredSources,
  docsHygieneProblems,
  internalLinks,
  normalize,
} from "../../scripts/lib/docs-hygiene.ts";

const AGENTS =
  "# x\n## 2. مصادر\n| a | `docs/SYSTEM_STATE.md` | `docs/adr/NNNN-*.md` |\n## 3. قيود\n`docs/ignored.md`\n";

function inputsOf(overrides: Partial<DocsHygieneInputs>): DocsHygieneInputs {
  const files = new Set(["docs/SYSTEM_STATE.md", "docs/adr/0001-x.md"]);
  return {
    markdown: [{ path: "docs/SYSTEM_STATE.md", text: "[ADR](adr/0001-x.md)" }],
    exists: (path) => files.has(path),
    agents: AGENTS,
    ...overrides,
  };
}

const rules = (inputs: DocsHygieneInputs) => docsHygieneProblems(inputs).map((p) => p.rule);

describe("نظافةُ التوثيق — كلُّ قاعدةٍ تسقطُ بخرقِها", () => {
  test("الحالةُ النظيفةُ بلا مشكلة", () => {
    expect(rules(inputsOf({}))).toEqual([]);
  });

  test("رابطٌ مكسور", () => {
    const markdown = [{ path: "docs/SYSTEM_STATE.md", text: "[x](../adr/0001-x.md)" }];
    expect(rules(inputsOf({ markdown }))).toEqual(["broken-link"]);
  });

  test("الروابطُ الخارجيّةُ وما في كتلِ الكودِ لا تُفحَص", () => {
    const text = "[a](https://x.test/y) [m](mailto:a@b)\n```\n[b](nowhere.md)\n```";
    expect(internalLinks(text)).toEqual([]);
  });

  test("الرابطُ يُحَلُّ نسبةً إلى ملفِّه، والمرساةُ تُسقَط", () => {
    expect(internalLinks("[a](../b/c.md#sec)")).toEqual(["../b/c.md"]);
    expect(normalize("docs/evidence/../adr/./0001-x.md")).toBe("docs/adr/0001-x.md");
  });

  test("ملفٌّ جديدٌ في جذرِ docs/ خارجَ القائمة", () => {
    const markdown = [{ path: "docs/agent-session-report.md", text: "" }];
    expect(rules(inputsOf({ markdown }))).toEqual(["docs-root"]);
  });

  test("ما تحتَ مجلّدٍ في docs/ لا تحكمُه قائمةُ الجذر", () => {
    const markdown = [{ path: "docs/evidence/production/X.md", text: "" }];
    expect(rules(inputsOf({ markdown }))).toEqual([]);
  });

  test("مرجعٌ في AGENTS.md §2 لا وجودَ له", () => {
    const agents = AGENTS.replace("docs/SYSTEM_STATE.md", "docs/GONE.md");
    expect(rules(inputsOf({ agents }))).toEqual(["missing-source"]);
  });

  test("AGENTS.md غائب، أو بلا جدولِ مصادر: يسقطُ ولا يُقرأُ نجاحًا", () => {
    expect(rules(inputsOf({ agents: null }))).toEqual(["missing-entry"]);
    expect(rules(inputsOf({ agents: "# بلا أقسام" }))).toEqual(["missing-entry"]);
  });

  test("الأنماطُ في §2 لا تُعامَلُ مسارات، وما خارجَ §2 لا يُقرأ", () => {
    expect(declaredSources(AGENTS)).toEqual(["docs/SYSTEM_STATE.md"]);
  });

  test("المستودعُ كما هو يُقرأُ فعلًا (لا كشفَ معطوب)", () => {
    const inputs = defaultInputs();
    expect(inputs.markdown.length).toBeGreaterThan(100);
    expect(inputs.agents).not.toBeNull();
    expect(declaredSources(inputs.agents ?? "").length).toBeGreaterThan(5);
  });
});
