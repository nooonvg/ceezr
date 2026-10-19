/**
 * الغرض: سقوطُ حاجزِ `EVIDENCE-01` (`scripts/check-evidence-manifests.ts`) مقيسٌ بخرقٍ
 *   مزروعٍ لكلِّ قاعدة: بصمةٌ معدّلة (حالةُ الدفعة 9)، ملفٌّ مُدرَجٌ غائب، ملفٌّ غيرُ مُدرَج،
 *   أصلٌ مضغوطٌ `.gz` يطابقُ ولا يطابق، بيانٌ مُستبدَلٌ لا يغطّيه الأب (حالةُ الدفعة 17)،
 *   واستثناءٌ متعفّنٌ أو بلا سبب. ثمّ الحاجزُ على المستودعِ الحقيقيّ.
 * الحالة: اختبار وحدة فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { EVIDENCE_MANIFEST_EXCEPTIONS } from "../../scripts/lib/evidence-manifest-exceptions.ts";
import {
  type ManifestException,
  parseManifest,
  verifyEvidenceManifests,
} from "../../scripts/lib/evidence-manifests.ts";

const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const REASON = "سببٌ مقروءٌ ومرجعٌ موثّقٌ لهذا الاستثناءِ في الاختبار";

function bundle(files: Record<string, string>, listed: Record<string, string> = files) {
  const root = mkdtempSync(join(tmpdir(), "evidence-"));
  const dir = join(root, "docs/evidence/run");
  mkdirSync(dir, { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const manifest = Object.entries(listed)
    .map(([path, body]) => `${sha(body)}  ./${path}`)
    .join("\n");
  writeFileSync(join(dir, "SHA256SUMS"), `${manifest}\n`);
  return { root, dir };
}

const check = (root: string, exceptions: readonly ManifestException[] = []) =>
  verifyEvidenceManifests(root, "docs/evidence", exceptions).problems.map((p) => p.detail);

describe("حاجزُ بياناتِ الأدلة (EVIDENCE-01)", () => {
  it("حزمةٌ سليمة: لا مشكلة", () => {
    const { root } = bundle({ "a.json": "{}", "sub/b.jsonl": "x\n" });
    expect(check(root)).toEqual([]);
  });

  it("بصمةٌ معدّلةٌ بعدَ التجزئة تُسقطُه (حالةُ الدفعة 9)", () => {
    const { root, dir } = bundle({ "diag-env.env": "POOL=6\n" });
    writeFileSync(join(dir, "diag-env.env"), "POOL=6\n# ملاحظة لاحقة\n");
    expect(check(root)).toEqual(["بصمةٌ غيرُ مطابقة: diag-env.env"]);
  });

  it("ملفٌّ مُدرَجٌ غائبٌ يُسقطُه، والاستثناءُ المسمّى يُجيزُه، والمتعفّنُ يُسقطُه", () => {
    const { root } = bundle({ "a.json": "{}" }, { "a.json": "{}", "gone.log": "y" });
    expect(check(root)).toEqual(["مُدرَجٌ غائب: gone.log"]);
    const ok = [{ dir: "docs/evidence/run", reason: REASON, absent: ["gone.log"] }];
    expect(check(root, ok)).toEqual([]);
    const stale = [{ dir: "docs/evidence/run", reason: REASON, absent: ["a.json"] }];
    expect(check(root, stale)).toEqual([
      "مُعلَنٌ غائبًا وهو موجود — يُزالُ من الاستثناء: a.json",
      "مُدرَجٌ غائب: gone.log",
    ]);
  });

  it("ملفٌّ غيرُ مُدرَجٍ يُسقطُه", () => {
    const { root, dir } = bundle({ "a.json": "{}" });
    writeFileSync(join(dir, "extra.md"), "#");
    expect(check(root)).toEqual(["ملفٌّ غيرُ مُدرَج: extra.md"]);
  });

  it("الأصلُ المضغوطُ يُتحقَّقُ منه بعدَ فكِّه — مطابقًا وغيرَ مطابق", () => {
    const { root, dir } = bundle({}, { "big.jsonl": "line\n" });
    writeFileSync(join(dir, "big.jsonl.gz"), gzipSync(Buffer.from("line\n")));
    expect(check(root)).toEqual([]);
    writeFileSync(join(dir, "big.jsonl.gz"), gzipSync(Buffer.from("tampered\n")));
    expect(check(root)).toEqual(["بصمةٌ غيرُ مطابقة (بعدَ فكِّ .gz): big.jsonl"]);
  });

  it("بيانٌ مُستبدَلٌ يُشترطُ أن يغطّيَ الأبُ ملفّاتِه (حالةُ الدفعة 17)", () => {
    const { root, dir } = bundle({ "w/new.md": "r" });
    writeFileSync(join(dir, "w/SHA256SUMS"), `${sha("r")}  ./old.txt\n`);
    expect(check(root)).toEqual(["مُدرَجٌ غائب: old.txt", "ملفٌّ غيرُ مُدرَج: new.md"]);
    const superseded = [
      { dir: "docs/evidence/run/w", reason: REASON, supersededBy: "docs/evidence/run" },
    ];
    expect(check(root, superseded)).toEqual([]);
    writeFileSync(join(dir, "w/uncovered.md"), "u");
    expect(check(root, superseded)).toEqual([
      "مُستبدَلٌ والأبُ لا يغطّي: docs/evidence/run/w/uncovered.md",
    ]);
  });

  it("استثناءٌ بلا سببٍ أو لبيانٍ غيرِ موجودٍ يُسقطُه", () => {
    const { root } = bundle({ "a.json": "{}" });
    expect(check(root, [{ dir: "docs/evidence/run", reason: "x" }])).toEqual([
      "استثناءٌ بلا سببٍ مقروء",
    ]);
    expect(check(root, [{ dir: "docs/evidence/nope", reason: REASON }])).toEqual([
      "استثناءٌ لبيانٍ غيرِ موجود — يُزال",
    ]);
  });

  it("سطرٌ غيرُ مقروءٍ في البيانِ يُرفَضُ لا يُتجاهَل", () => {
    expect(() => parseManifest("not-a-hash  file\n")).toThrow();
  });

  it("المستودعُ الحقيقيّ: كلُّ البياناتِ مطابقةٌ بالاستثناءاتِ المسمّاةِ وحدَها", () => {
    const report = verifyEvidenceManifests(
      process.cwd(),
      "docs/evidence",
      EVIDENCE_MANIFEST_EXCEPTIONS,
    );
    expect(report.manifests).toBeGreaterThanOrEqual(47);
    expect(report.problems).toEqual([]);
  });
});
