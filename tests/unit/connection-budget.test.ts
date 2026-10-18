/**
 * الغرض: إثباتُ أنّ نموذجَ ميزانيّةِ الاتّصالاتِ يحسبُ الطلبَ من الثوابتِ التي
 *    تُفتَحُ بها التجمُّعاتُ فعلاً — لا من صيغةٍ منثورةٍ في وثيقةٍ (`F7-04` · `CAP-004`).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: وظيفةُ `verify` في CI.
 * ملاحظات مستقبلية: يومَ يُضاف دورٌ إلى `DB_POOL_MAX` تسقطُ هذه الاختباراتُ حتّى
 *    يُنسَبَ إلى العمليةِ التي تحملُه — وهذا مقصودٌ لا عائقٌ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_JOB_CONCURRENCY } from "../../apps/workers/src/container.ts";
import {
  BUDGETED_PROCESSES,
  type ConnectionBudget,
  computeConnectionBudget,
  DB_POOL_MAX,
  DB_POOL_ROLES,
  DECLARED_TOPOLOGY,
  DEFAULT_DB_POOL_MAX,
  describeConnectionBudget,
  JOB_CONCURRENCY,
  TRANSIENT_POOL_ROLES,
} from "../../packages/shared/config/connection-budget.ts";
import { analyseManifest, MANIFEST_NAME } from "../../scripts/check-connection-budget.ts";

const budget = computeConnectionBudget(DECLARED_TOPOLOGY);

/** حِملُ عمليةِ نوعٍ واحدٍ كلِّها — يُقرأ من الصفِّ لا يُعاد حسابُه ههنا. */
function subtotalOf(candidate: ConnectionBudget, process: string): number {
  const row = candidate.rows.find((entry) => entry.process === process);
  if (row === undefined) throw new Error(`صفُّ «${process}» مفقودٌ من الميزانيّةِ`);
  return row.subtotal;
}

describe("ثوابتُ الميزانيّةِ", () => {
  it("كلُّ دورٍ مُعلَنٍ له سقفٌ صحيحٌ موجبٌ، ولا سقفَ بلا دورٍ", () => {
    expect(Object.keys(DB_POOL_MAX).sort()).toEqual([...DB_POOL_ROLES].sort());
    for (const role of DB_POOL_ROLES) {
      expect(Number.isInteger(DB_POOL_MAX[role])).toBe(true);
      expect(DB_POOL_MAX[role]).toBeGreaterThan(0);
    }
  });

  /**
   * الارتباطُ ضرورةٌ لا اختيارٌ: كلُّ مهمّةٍ جاريةٍ تحتجزُ اتّصالَ قفلٍ طولَ عملِها،
   * فتجمُّعُ قفلٍ لا يتّسعُ للتوازي كلِّه يجعلُ مهمّةً تنتظرُ اتّصالاً لا يتحرّرُ إلّا
   * بانتهاءِ أُختِها.
   */
  it("تجمُّعُ القفلِ يتّسعُ للتوازي كلِّه وزيادةً", () => {
    expect(DB_POOL_MAX.workerLocks).toBeGreaterThan(JOB_CONCURRENCY);
  });

  /** الاسمُ القديمُ يبقى مُصدَّراً من موضعِه، والقيمةُ واحدةٌ لا نسختانِ تتباعدانِ. */
  it("MAX_JOB_CONCURRENCY في العاملِ هو JOB_CONCURRENCY نفسُه", () => {
    expect(MAX_JOB_CONCURRENCY).toBe(JOB_CONCURRENCY);
  });

  it("الافتراضيُّ في عميلِ القاعدةِ هو دورُ طلبِ البوّابةِ بعينِه", () => {
    expect(DEFAULT_DB_POOL_MAX).toBe(DB_POOL_MAX.gatewayRequest);
  });

  it("كلُّ دورٍ عابرٍ دورٌ مُعلَنٌ", () => {
    for (const role of TRANSIENT_POOL_ROLES) {
      expect(DB_POOL_ROLES).toContain(role);
    }
  });
});

/** طوبولوجيا الفصلِ (قبلَ 2026-10-02) — مرجعُ المقارنةِ. */
const SEPARATED = Object.freeze({
  gatewayInstances: 1,
  workerInstances: 1,
  adminInstances: 1,
  workerRunsInGateway: false,
  adminRunsInGateway: false,
});

describe("حسابُ الميزانيّةِ", () => {
  it("الطوبولوجيا المُعلَنةُ (2026-10-02): بوّابةٌ واحدةٌ تحملُ العاملَ واللوحةَ", () => {
    expect(DECLARED_TOPOLOGY.gatewayInstances).toBe(1);
    expect(DECLARED_TOPOLOGY.workerInstances).toBe(0);
    expect(DECLARED_TOPOLOGY.adminInstances).toBe(0);
    expect(DECLARED_TOPOLOGY.workerRunsInGateway).toBe(true);
    expect(DECLARED_TOPOLOGY.adminRunsInGateway).toBe(true);
  });

  it("البوّابةُ الجامعةُ تحملُ تجمُّعاتِ الثلاثةِ ولا يضيعُ حِملٌ", () => {
    const separated = computeConnectionBudget(SEPARATED);
    expect(budget.steadyStateTotal).toBe(separated.steadyStateTotal);
    expect(subtotalOf(budget, "gateway")).toBe(
      subtotalOf(separated, "gateway") +
        subtotalOf(separated, "worker") +
        subtotalOf(separated, "admin"),
    );
  });

  it("يُفصِّلُ كلَّ عمليةٍ مُدرَجةٍ في الميزانيّةِ ولا يزيدُ", () => {
    expect(budget.rows.map((row) => row.process).sort()).toEqual([...BUDGETED_PROCESSES].sort());
  });

  it("المجموعُ مجموعُ الأجزاءِ لا رقماً مستقلّاً", () => {
    const sum = budget.rows.reduce((total, row) => total + row.subtotal, 0);
    expect(budget.steadyStateTotal).toBe(sum);
    for (const row of budget.rows) {
      expect(row.subtotal).toBe(row.perInstance * row.instances);
    }
  });

  /**
   * الحدُّ الذي أسقطَته صيغةُ `5N + 10M`: بوّابةٌ تحملُ المهامَّ تحملُ تجمُّعَيها
   * معها. والفرقُ يجبُ أن يُساويَ حِملَ العاملِ بالضبطِ لا أن يكونَ «أكبرَ».
   */
  it("إدماجُ المهامِّ في البوّابةِ ينقلُ حِملَ العاملِ إليها ولا يُضيِّعُه", () => {
    const embedded = computeConnectionBudget({
      ...SEPARATED,
      workerRunsInGateway: true,
    });
    const workerLoad = DB_POOL_MAX.workerJobs + DB_POOL_MAX.workerLocks;
    expect(subtotalOf(embedded, "gateway")).toBe(
      subtotalOf(computeConnectionBudget(SEPARATED), "gateway") + workerLoad,
    );
  });

  it("رفعُ النسخِ يضاعفُ حِملَ العمليةِ خطّيّاً", () => {
    const scaled = computeConnectionBudget({
      ...DECLARED_TOPOLOGY,
      gatewayInstances: 3,
    });
    expect(subtotalOf(scaled, "gateway")).toBe(subtotalOf(budget, "gateway") * 3);
  });

  it("العابرُ يُعلَنُ ذروةً ولا يدخلُ في صفوفِ الحالةِ المستقرّةِ", () => {
    expect(budget.transientPeak).toBe(
      TRANSIENT_POOL_ROLES.reduce((total, role) => total + DB_POOL_MAX[role], 0),
    );
    const transientInRows = budget.rows.some((row) =>
      row.roles.some((role) => TRANSIENT_POOL_ROLES.includes(role)),
    );
    expect(transientInRows).toBe(false);
  });

  /** عددٌ ليس صحيحاً غيرَ سالبٍ مُدخَلٌ لا يُفهَم — والسقوطُ أصدقُ من رقمٍ مُخترَعٍ. */
  it("عددُ نسخٍ باطلٌ ⇒ سقوطٌ لا حسابٌ صامتٌ", () => {
    expect(() => computeConnectionBudget({ ...DECLARED_TOPOLOGY, workerInstances: -1 })).toThrow(
      RangeError,
    );
    expect(() => computeConnectionBudget({ ...DECLARED_TOPOLOGY, adminInstances: 1.5 })).toThrow(
      RangeError,
    );
  });

  it("صفرُ نسخٍ حالٌ مشروعةٌ: خدمةٌ موقوفةٌ لا تفتحُ اتّصالاً وسقفُها يبقى معلوماً", () => {
    const stopped = computeConnectionBudget({
      ...SEPARATED,
      adminInstances: 0,
    });
    const admin = stopped.rows.find((row) => row.process === "admin");
    expect(admin?.subtotal).toBe(0);
    expect(admin?.perInstance).toBe(DB_POOL_MAX.adminRequest);
  });

  it("الوصفُ يذكرُ الصيغةَ والمجموعَ والعابرَ فيصلحُ سطرَ إقلاعٍ", () => {
    const summary = describeConnectionBudget(budget);
    expect(summary).toContain(budget.formula);
    expect(summary).toContain(String(budget.steadyStateTotal));
    expect(summary).toContain(String(budget.transientPeak));
  });
});

describe("الميزانيّةُ المحسوبةُ المُثبَّتةُ (LOAD-01 · الدفعةُ العاشرة)", () => {
  // رقمٌ مُثبَّتٌ عمداً لا مُشتقٌّ: تغييرُ أيِّ سقفٍ يُسقطُ هذا الاختبارَ فيُقرأُ الأثرُ على
  // الميزانيّةِ صراحةً في طلبِ الدمجِ نفسِه (ADR 0073)، لا يمرُّ صامتاً. المرشّحُ `gatewayRequest = 6`
  // (22) قيسَ ولم يُعتمَد — `BATCH-10-LOAD01-ACCEPT500.md`.
  const budget = computeConnectionBudget(DECLARED_TOPOLOGY);

  it("السقوفُ المعتمدةُ: الطلبُ 5 والشوطُ 1 والمهامُّ 5 والأقفالُ JOB_CONCURRENCY+1 واللوحةُ 5", () => {
    expect(DB_POOL_MAX.gatewayRequest).toBe(5);
    expect(DB_POOL_MAX.gatewayDispatch).toBe(1);
    expect(DB_POOL_MAX.workerJobs).toBe(5);
    expect(DB_POOL_MAX.workerLocks).toBe(JOB_CONCURRENCY + 1);
    expect(JOB_CONCURRENCY).toBe(4);
    expect(DB_POOL_MAX.adminRequest).toBe(5);
    expect(DB_POOL_MAX.restoreVerifier).toBe(1);
  });

  it("الحالةُ المستقرّةُ على طوبولوجيا render.yaml = 21: بوّابةٌ واحدةٌ تحملُ (5+1) + (5+5) + 5", () => {
    const manifest = readFileSync(join(import.meta.dir, "..", "..", MANIFEST_NAME), "utf8");
    expect(analyseManifest(manifest)).toEqual([]);
    expect(budget.rows).toHaveLength(3);
    const gateway = budget.rows.find((row) => row.process === "gateway");
    expect(gateway?.instances).toBe(1);
    expect(gateway?.perInstance).toBe(21);
    expect(budget.steadyStateTotal).toBe(21);
  });

  it("restoreVerifier عابرٌ: يُعلَنُ في الذروةِ العابرةِ (1) ولا يدخلُ مجموعَ الحالةِ المستقرّة", () => {
    expect(TRANSIENT_POOL_ROLES).toEqual(["restoreVerifier"]);
    expect(budget.transientPeak).toBe(1);
    for (const row of budget.rows) expect(row.roles).not.toContain("restoreVerifier");
  });
});
