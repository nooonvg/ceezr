/**
 * الغرض: استثناءاتُ `check-evidence-manifests` المُعلَنة — كلٌّ بملفّاتِه بعينِها وسببِه
 *   ومرجعِه. لا استثناءَ عامّ، واستثناءٌ لا يطابقُ واقعًا يُسقطُ الحاجز.
 * الحالة: منفّذ فعلياً — الدفعة 19 (EVIDENCE-01).
 * ينتمي إلى: scripts/lib.
 */

import type { ManifestException } from "./evidence-manifests.ts";

const STAGE6 = "docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw";

export const EVIDENCE_MANIFEST_EXCEPTIONS: readonly ManifestException[] = [
  {
    // الحزمةُ الكاملةُ (373MB) في بيئةِ الجولة، والمستودعُ يحملُ نسخةً جزئيّة (README.md).
    // هذا سببُ بقاءِ EVIDENCE-01 = FAIL لهذه الجولة؛ الاستثناءُ يُسجّلُه ولا يُخفيه.
    dir: "docs/evidence/capacity/CAP-RUN-20261015",
    reason:
      "نسخةٌ جزئيّةٌ مضغوطةٌ من حزمةٍ كاملةٍ خارجَ المستودع (README.md)؛ البيانُ بصماتُ الحزمةِ الكاملة — EVIDENCE-01 يبقى FAIL لهذه الجولة",
    absent: [
      "chaos.out",
      "edge/d8-before-fix-test-output.txt",
      "edge/edge-attempt1.out",
      "edge/edge-attempt2.out",
      "edge/edge-attempt3-preD8.out",
      "edge/edge-attempt4-D8-catchup.out",
      "edge/edge-cases.attempt4.json",
      "edge/edge-cases.json",
      "edge/edge.out",
      "edge/gateway-edge.log",
      "egress-blocked.jsonl",
      "egress-guard-summary.jsonl",
      "fault-injection.part1.json",
      "fault-injection.part2.json",
      "gateway-starts.jsonl",
      "gateway.log",
      "gen1.out",
      "generator-metrics.jsonl",
      "generator-summary.gen1.json",
      "git-diff.patch",
      "isolation-check.txt",
      "load-config.gen1.json",
      "monitor.out",
      "resources.jsonl",
      "soak-round-metrics.json",
      "telegram-mock-stats.json",
      "telegram-mock.jsonl",
    ],
    unlisted: ["README.md"],
  },
  {
    dir: `${STAGE6}/batch17/b17-acc-250`,
    reason:
      "بيانٌ داخليٌّ يسبقُ إعادةَ تسميةِ .txt/.out وحذفَ db-audit-*.out (BATCH-17 §الأدلة)؛ والمرجعُ raw/batch17/SHA256SUMS",
    supersededBy: `${STAGE6}/batch17`,
  },
  {
    dir: `${STAGE6}/batch17/b17-acc-500`,
    reason:
      "بيانٌ داخليٌّ يسبقُ إعادةَ تسميةِ .txt/.out وحذفَ db-audit-*.out (BATCH-17 §الأدلة)؛ والمرجعُ raw/batch17/SHA256SUMS",
    supersededBy: `${STAGE6}/batch17`,
  },
  {
    dir: `${STAGE6}/batch9/b9-isoReq6-500`,
    reason:
      "ملاحظةُ code_dirty=1 نُقلت من diag-env.env إلى ANNOTATIONS.md (الدفعة 19) لتعودَ البصمةُ مطابقة",
    unlisted: ["ANNOTATIONS.md"],
  },
  {
    dir: `${STAGE6}/batch9/b9-isoReq6W3-500`,
    reason:
      "ملاحظةُ code_dirty=1 نُقلت من diag-env.env إلى ANNOTATIONS.md (الدفعة 19) لتعودَ البصمةُ مطابقة",
    unlisted: ["ANNOTATIONS.md"],
  },
];
