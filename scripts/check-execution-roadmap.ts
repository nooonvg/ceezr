#!/usr/bin/env bun
/**
 * حارسُ خارطةِ التنفيذ (`DEC-25` · `ADR 0262`). المنطقُ في `scripts/lib/execution-roadmap.ts`.
 *
 *   bun run scripts/check-execution-roadmap.ts            # البنيةُ وحدَها (يشغّلُه `bun run ci`)
 *   bun run scripts/check-execution-roadmap.ts --range    # البنيةُ + التغييرُ وحالتُه
 *
 * في `--range` يُقرأُ المدى من `BASE_SHA`/`HEAD_SHA`، أو من أصلِ الفرعِ في `origin/main`.
 * ويُقرأُ الإعلانُ من `PR_TITLE` و`PR_BODY` إن وُجدا، ومن رسائلِ الـcommit في المدى دائمًا.
 * **ومدىً لا يُحَلُّ يُسقِطُ الفحص**: «لم أستطعْ أنْ أنظرَ» لا تُقرأُ نجاحًا (درسُ `check-roadmap.mjs`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Problem, rangeProblems, STATUS_PATH, structureProblems } from "./lib/execution-roadmap.ts";

const ZERO_SHA = "0000000000000000000000000000000000000000";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function resolveRange(): { base: string; head: string } | string {
  const head = process.env.HEAD_SHA?.trim() || "HEAD";
  const envBase = process.env.BASE_SHA?.trim();
  if (envBase && envBase !== ZERO_SHA) {
    try {
      git(["rev-parse", "--verify", `${envBase}^{commit}`]);
      return { base: envBase, head };
    } catch {
      /* أصلُ الفرعِ يُجرَّبُ تاليًا */
    }
  }
  for (const ref of ["origin/main", "main"]) {
    try {
      const base = git(["merge-base", ref, head]).trim();
      if (base.length > 0 && base !== git(["rev-parse", head]).trim()) return { base, head };
    } catch {
      /* المرجعُ التالي */
    }
  }
  return "لا مدى يُحَلّ: لا BASE_SHA صالح ولا أصلَ في main (نسخةٌ ضحلة؟ اضبطْ fetch-depth: 0).";
}

function report(problems: Problem[], label: string): void {
  if (problems.length === 0) return;
  console.error(`✗ خارطةُ التنفيذ (${label}): ${problems.length} مشكلة`);
  for (const problem of problems) console.error(`  - [${problem.rule}] ${problem.detail}`);
}

const headStatus = readFileSync(STATUS_PATH, "utf8");
const structural = structureProblems(headStatus);
report(structural, "البنية");

let ranged: Problem[] = [];
if (process.argv.includes("--range")) {
  const range = resolveRange();
  if (typeof range === "string") {
    console.error(`✗ خارطةُ التنفيذ: ${range}`);
    process.exit(1);
  }
  const changedFiles = git(["diff", "--name-only", `${range.base}...${range.head}`])
    .split("\n")
    .filter((f) => f.length > 0);
  const messages = git(["log", "--format=%B", `${range.base}..${range.head}`]);
  let baseStatus: string | null = null;
  try {
    baseStatus = git(["show", `${range.base}:${STATUS_PATH}`]);
  } catch {
    baseStatus = null; // الجدولُ جديدٌ في هذا المدى
  }
  const declarationText = [process.env.PR_TITLE ?? "", process.env.PR_BODY ?? "", messages].join("\n");
  ranged = rangeProblems({ changedFiles, declarationText, baseStatus, headStatus });
  report(ranged, `المدى ${range.base.slice(0, 8)}..${range.head.slice(0, 8)}`);
}

if (structural.length + ranged.length > 0) process.exit(1);
console.log(
  `✓ خارطةُ التنفيذ: الجدولُ سليم${process.argv.includes("--range") ? "، وكلُّ تغييرٍ تنفيذيٍّ مربوطٌ ببندٍ حُدِّثَ صفُّه" : ""}.`,
);
