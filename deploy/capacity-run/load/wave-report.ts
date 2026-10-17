/**
 * `LOAD-01` — حكمُ موجةِ القبولِ آليًّا من الأدلةِ (لا من الانطباع):
 * يقرأُ أحداثَ المولدِ (miniapp-load-events.jsonl · load-events.jsonl) وتدقيقَ
 * القاعدةِ (db-audit-post.json) ويطبقُ بواباتِ بروتوكولِ القبولِ المثبتةِ
 * مسبقًا (docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/
 * ACCEPTANCE-PROTOCOL.md §2) بندًا بندًا ويصدر حكمًا نهائيًّا.
 *
 * التشغيل: RUN_DIR=… bun run deploy/capacity-run/load/wave-report.ts
 * الخروجُ بغيرِ الصفرِ = موجةٌ فاشلةٌ (بوابةٌ حمراءُ على الأقل).
 */

import { existsSync, readFileSync } from "node:fs";
import { EV, RUN_DIR } from "./lib.ts";

interface Outcome {
  kind: string;
  reason?: string;
  index?: number;
  orderId?: string;
  orderCreatedAt?: number;
  offerFoundAt?: number;
  assignedToOtherDriver?: string;
  rider?: number;
  driver?: number;
}

function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // سطرٌ تالفٌ لا يُسقطَ الحكمَ كلَّهُ — يُتجاهلُ ويُحصى عندَ الحاجةِ.
    }
  }
  return rows;
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`;
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? null;
}

function main() {
  const events = readJsonl(`${EV}/miniapp-load-events.jsonl`);
  const loadRows = readJsonl(`${EV}/load-events.jsonl`);
  const auditPath = `${EV}/db-audit-post.json`;
  if (!existsSync(auditPath)) {
    console.error("✖ تدقيق ما بعد الموجة مفقود — شغّل db-audit --phase=post أولًا.");
    process.exit(2);
  }
  const audit = JSON.parse(readFileSync(auditPath, "utf8")) as {
    verdict: string;
    violations: { rule: string; detail: string }[];
    snapshot: {
      engagedDuplicates: number;
      outbox: { oldestPendingSec: number | null };
      availability: { available: number };
    };
    preSnapshot: { availability: { available: number } } | null;
    outcomes: { total: number; verified: number; failed: number; closeDeadlineHits: number };
  };

  const outcomes = events.filter((e) => e.event === "scenario.outcome") as unknown as Outcome[];
  const genEnd = events.find((e) => e.event === "gen.end") as
    | { closeDeadlineHits?: number; stuckAtClose?: number; engagedDuplicates?: number }
    | undefined;
  const latencyRows = loadRows.filter((r) => r.event === "latency_percentiles" && r.gen === "genA");
  const counterRows = loadRows.filter(
    (r) => r.path === "miniapp_http" && r.event === undefined,
  ) as unknown as {
    http2xx?: number;
    http5xx?: number;
    http4xx?: number;
    api429?: number;
    networkErrors?: number;
  }[];
  // عدّاداتُ الحملِ تراكميةٌ في كلِّ لقطةٍ — اللقطةُ الأخيرةُ هي المجموعُ.
  const lastCounters = counterRows.at(-1) ?? {};

  const total = outcomes.length;
  const verified = outcomes.filter((o) => o.kind === "verified").length;
  const closeHits = outcomes.filter((o) => (o.reason ?? "").includes("close_deadline")).length;
  const assignedOther = outcomes.filter((o) => o.assignedToOtherDriver !== undefined).length;
  const unreadable = outcomes.filter((o) => o.reason === "offer:offer_board_unreadable").length;
  const scenarioEnds = events.filter((e) => e.event === "scenario.end") as unknown as {
    elapsedMs: number;
  }[];
  const cycleMs = scenarioEnds.map((e) => Number(e.elapsedMs));
  const offerAppearMs = outcomes
    .filter((o) => o.orderCreatedAt !== undefined && o.offerFoundAt !== undefined)
    .map((o) => (o.offerFoundAt ?? 0) - (o.orderCreatedAt ?? 0));
  const requests =
    (lastCounters.http2xx ?? 0) +
    (lastCounters.http5xx ?? 0) +
    (lastCounters.http4xx ?? 0) +
    (lastCounters.api429 ?? 0) +
    (lastCounters.networkErrors ?? 0);
  const availabilityLeftover =
    audit.preSnapshot === null
      ? null
      : audit.snapshot.availability.available - audit.preSnapshot.availability.available;
  const stuckAtClose = Number(genEnd?.stuckAtClose ?? audit.outcomes.closeDeadlineHits);

  const gates: { id: string; rule: string; value: string; limit: string; pass: boolean }[] = [];
  const g = (id: string, rule: string, value: string, limit: string, pass: boolean) =>
    gates.push({ id, rule, value, limit, pass });

  g(
    "G1",
    "دورات مكتملة مثبتة من القاعدة",
    `${pct(verified, total)} (${verified}/${total})`,
    "≥ 99.0%",
    verified / Math.max(1, total) >= 0.99,
  );
  g(
    "G2",
    "إسناد مزدوج",
    String(audit.snapshot.engagedDuplicates),
    "= 0",
    audit.snapshot.engagedDuplicates === 0,
  );
  g(
    "G3",
    "تجاوز نافذة الختام / عالقون عند الإغلاق",
    `${closeHits} + ${stuckAtClose}`,
    "= 0",
    closeHits === 0 && stuckAtClose === 0,
  );
  g("G4", "تدقيق ما بعد الموجة", audit.verdict, "CLEAN", audit.verdict === "CLEAN");
  g(
    "G5",
    "سائقون بقوا متاحين بعد الجولة",
    availabilityLeftover === null ? "n/a" : String(availabilityLeftover),
    `≤ ${Math.max(1, Math.round(total * 0.005))} (0.5%)`,
    availabilityLeftover !== null && availabilityLeftover <= Math.max(1, total * 0.005),
  );
  g(
    "G6",
    "إسناد لسائق سيناريو آخر",
    `${pct(assignedOther, total)} (${assignedOther})`,
    "≤ 0.5%",
    assignedOther <= total * 0.005,
  );
  const ratio5xx = requests === 0 ? 0 : (lastCounters.http5xx ?? 0) / requests;
  g(
    "G7",
    "5xx من الطلبات",
    `${pct(lastCounters.http5xx ?? 0, requests)}`,
    "≤ 0.5%",
    ratio5xx <= 0.005,
  );
  g("G8", "تعثر قراءة لوح العروض", String(unreadable), "= 0", unreadable === 0);

  /**
   * `LOAD-01` §4 — إثباتُ الهويّاتِ والتزامنِ الفعليِّ من أحداثِ المولّدِ لا من
   * التصريحِ: الموجةَ تُدَّعى على N متزامنةٍ فهيّ تُثبِتُ (أ) أنّ هوياتِ
   * السيناريوهاتِ كلَّها فريدةٌ (راكبٌ وسائقٌ لكلِّ سيناريو — 2N هويةً لا
   * إعادةَ استخدامٍ تخفّفُ الحملَ زورًا)، و(ب) أنّ ذروةَ السيناريوهاتِ
   * المتزامنةِ الفعليةِ بلغتِ الهدفَ فعلًا (لا موجةً ادّعت 250 وجرت 30).
   */
  const uniqueRiders = new Set(outcomes.map((o) => o.rider).filter((v) => v !== undefined)).size;
  const uniqueDrivers = new Set(outcomes.map((o) => o.driver).filter((v) => v !== undefined)).size;
  g(
    "I1-identities",
    "هويات فريدة من أحداث المولد (راكب + سائق لكل سيناريو)",
    `riders ${uniqueRiders}/${total} · drivers ${uniqueDrivers}/${total}`,
    `= ${total} + ${total}`,
    uniqueRiders === total && uniqueDrivers === total,
  );
  // استقرارُ البوابةِ جزءٌ من الحكمِ لا ملاحظةً جانبيّةً: انهيارٌ أخفاهُ إعادةُ
  // تشغيلٍ تلقائيّةٌ يُسقِطُ الموجةَ كلَّها — فالمقياسُ أُجريَ على نسخةٍ غيرَ
  // التي بدأتْ. الدليلُ ملفُّ الخرقِ الذي يكتبُه finish-wave.sh (gateway-stability-fail.txt).
  const gatewayRestarted = existsSync(`${EV}/gateway-stability-fail.txt`);
  g(
    "GW-STABILITY",
    "البوابة نفس العملية عبر الموجة (لا انهيار خفي)",
    gatewayRestarted ? "restarted" : "stable",
    "stable",
    !gatewayRestarted,
  );

  // نزاهةُ القناةِ: كلُّ إرساليةٍ في نافذةِ الموجةِ مصنّفةٌ لبوتِها — «unknown»
  // يعني أنَّ المحاكيَ جمعَ البوتينِ في نافذةِ حدٍّ واحدةٍ فقياسُ P7 مزيَّفٌ.
  const readStats = (f: string): { unknown_token?: number } | null =>
    existsSync(`${EV}/${f}`)
      ? (JSON.parse(readFileSync(`${EV}/${f}`, "utf8")) as { unknown_token?: number })
      : null;
  const mockPre = readStats("mock-stats-pre.json");
  const mockPost = readStats("mock-stats-post.json");
  const unknownDelta =
    mockPre === null || mockPost === null
      ? null
      : (mockPost.unknown_token ?? 0) - (mockPre.unknown_token ?? 0);
  g(
    "EGRESS-CLASSIFIED",
    "كل إرسالية في المحاكي مصنفة لبوتها (لا unknown)",
    unknownDelta === null ? "n/a (لقطة مفقودة)" : `unknown +${unknownDelta}`,
    "= 0",
    unknownDelta === 0,
  );

  const genStart = events.find((e) => e.event === "gen.start") as
    | { profile?: { conc: number }[] }
    | undefined;
  const targetConc = Math.max(0, ...(genStart?.profile ?? []).map((ph) => ph.conc ?? 0));
  const peakScenarios = Math.max(0, ...loadRows.map((r) => Number(r.peakScenarios ?? 0)));
  // §4 حرفيًّا: الذروةُ ≥ N لا «قريبًا من N» — لا تسامحَ مخترَعًا.
  g(
    "CONC-peak",
    "ذروة السيناريوهات المتزامنة الفعلية من لقطات المولد",
    `peak ${peakScenarios} / target ${targetConc}`,
    `≥ ${targetConc}`,
    targetConc > 0 && peakScenarios >= targetConc,
  );

  const lat2 = latencyRows.at(-1) ?? null;
  const lat = (lat2 ?? {}) as unknown as Record<string, { p95: number; p99: number }>;
  const perf: { id: string; rule: string; value: string; limit: string; pass: boolean }[] = [];
  const p = (id: string, rule: string, value: number | null, limit: number, unit: string) =>
    perf.push({
      id,
      rule,
      value: value === null ? "n/a" : `${Math.round(value)}${unit}`,
      limit: `≤ ${limit}${unit}`,
      pass: value !== null && value <= limit,
    });
  p("P1", "p95 إنشاء الرحلة", lat.rides_create?.p95 ?? null, 1000, "ms");
  p("P2", "p95 قبول العرض", lat.driver_offer_accept?.p95 ?? null, 1000, "ms");
  p("P3", "p95 قراءة لوح العروض", lat.driver_offers_board?.p95 ?? null, 1000, "ms");
  p("P4", "p95 ظهور العرض على اللوح", p95(offerAppearMs), 30000, "ms");
  p("P5", "p95 دورة السيناريو كاملة", p95(cycleMs), 120000, "ms");
  p("P6a", "p99 إنشاء الرحلة", lat.rides_create?.p99 ?? null, 2500, "ms");
  p("P6b", "p99 قبول العرض", lat.driver_offer_accept?.p99 ?? null, 2500, "ms");
  p("P6c", "p99 قراءة اللوح", lat.driver_offers_board?.p99 ?? null, 2500, "ms");
  const pending = audit.snapshot.outbox.oldestPendingSec;
  perf.push({
    id: "P7",
    rule: "أقدم مهمة إشعار معلقة عند التدقيق",
    // `LOAD-01 Recovery` — لا معلّقَ أصلًا هوَ الحالةُ المثلىُ لا فشلٌ: البوابةُ
    // تقيسُ «لا مهمةً عالقةً أقدمَ من 120ث» — والطابورُ الفارغُ يحقّقُها
    // تحقيقًا تامًّا (لا شيءَ عالقٌ). القيمةُ المفقودةُ (`null`) ليست قياسًا
    // فاشلًا بل غيابَ المُدخَلِ نفسِهِ — والخلطُ بينهما أخفقَ موجةً صحيحةً
    // (`wave-50-attempt1`) في الجولةِ السابقةِ. الحدُّ (120ث) لم يتغيرْ.
    value: pending === null ? "لا معلّقَ (طابورٌ فارغٌ)" : `${pending}s`,
    limit: "≤ 120s",
    pass: pending === null || pending <= 120,
  });
  const ratio429 = requests === 0 ? 0 : (lastCounters.api429 ?? 0) / requests;
  perf.push({
    id: "P8",
    rule: "429 واجهات Mini App",
    value: pct(lastCounters.api429 ?? 0, requests),
    limit: "≤ 2%",
    pass: ratio429 <= 0.02,
  });
  const ratioNet = requests === 0 ? 0 : (lastCounters.networkErrors ?? 0) / requests;
  perf.push({
    id: "P9",
    rule: "أخطاء شبكة",
    value: pct(lastCounters.networkErrors ?? 0, requests),
    limit: "≤ 1%",
    pass: ratioNet <= 0.01,
  });

  const failed = [...gates, ...perf].filter((r) => !r.pass);
  const report = {
    runDir: RUN_DIR,
    total,
    verified,
    verdict: failed.length === 0 ? "PASS" : "FAIL",
    failedGates: failed.map((f) => f.id),
    gates,
    perf,
    auditViolations: audit.violations,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
