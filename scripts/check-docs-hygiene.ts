#!/usr/bin/env bun
/**
 * الغرض: حاجزُ نظافةِ التوثيق — روابطُ داخليّةٌ تصل، وجذرُ `docs/` بلا تقاريرَ مُلقاة،
 *   ومراجعُ `AGENTS.md` موجودة.
 * الحالة: منفّذ فعلياً — تنظيفُ المستودع 2026-10-11. القواعدُ في `scripts/lib/docs-hygiene.ts`.
 * ينتمي إلى: scripts.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { type DocsHygieneInputs, docsHygieneProblems } from "./lib/docs-hygiene.ts";

export function defaultInputs(): DocsHygieneInputs {
  const tracked = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path.length > 0 && existsSync(path));
  return {
    markdown: tracked.map((path) => ({ path, text: readFileSync(path, "utf8") })),
    exists: (path) => existsSync(path),
    agents: existsSync("AGENTS.md") ? readFileSync("AGENTS.md", "utf8") : null,
  };
}

if (import.meta.main) {
  const inputs = defaultInputs();
  if (inputs.markdown.length === 0) {
    console.error("✗ لم يُقرأْ ملفُّ Markdown — الكشفُ معطوبٌ، ولا يُقرأُ نجاحًا.");
    process.exit(1);
  }
  const problems = docsHygieneProblems(inputs);
  if (problems.length > 0) {
    console.error(`✗ نظافةُ التوثيق: ${problems.length} مشكلة`);
    for (const problem of problems) console.error(`  - [${problem.rule}] ${problem.detail}`);
    process.exit(1);
  }
  console.log(
    `✓ نظافةُ التوثيق: ${inputs.markdown.length} ملفّ — الروابطُ الداخليّةُ تصل، وجذرُ docs/ ضمنَ القائمة، ومراجعُ AGENTS.md موجودة.`,
  );
}
