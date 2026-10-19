#!/usr/bin/env bun
/**
 * الغرض: حاجزُ `EVIDENCE-01` — كلُّ `SHA256SUMS` تحتَ `docs/evidence/` يطابقُ ما في
 *   المستودعِ فعلًا، وكلُّ ملفٍّ في الحزمةِ مُدرَج، والاستثناءاتُ مُسمّاةٌ بأسبابِها.
 * الحالة: منفّذ فعلياً — الدفعة 19. القواعدُ في `scripts/lib/evidence-manifests.ts`.
 * ينتمي إلى: scripts.
 */

import { EVIDENCE_MANIFEST_EXCEPTIONS } from "./lib/evidence-manifest-exceptions.ts";
import { verifyEvidenceManifests } from "./lib/evidence-manifests.ts";

if (import.meta.main) {
  const report = verifyEvidenceManifests(
    process.cwd(),
    "docs/evidence",
    EVIDENCE_MANIFEST_EXCEPTIONS,
  );
  if (report.manifests === 0) {
    console.error("✗ لم يُقرأْ أيُّ SHA256SUMS — الكشفُ معطوبٌ، ولا يُقرأُ نجاحًا.");
    process.exit(1);
  }
  if (report.problems.length > 0) {
    console.error(`✗ بياناتُ الأدلة: ${report.problems.length} مشكلة في ${report.manifests} بيانًا`);
    for (const problem of report.problems)
      console.error(`  - ${problem.manifest}: ${problem.detail}`);
    process.exit(1);
  }
  console.log(
    `✓ بياناتُ الأدلة: ${report.manifests} بيانًا · ${report.files} ملفًّا مُدرَجًا مطابقًا · ${EVIDENCE_MANIFEST_EXCEPTIONS.length} استثناءً مُسمّى.`,
  );
}
