/**
 * الغرض: إثباتُ أنَّ حاجزَ مصفوفةِ الهجرةِ (`W-2`) **يُخفِقُ فعلاً** — لا أنَّه يمرُّ.
 *    فحاجزٌ لا تُثبَتُ إخفاقاتُه حاجزٌ يُظَنُّ أنَّه يحرسُ، وهوَ أخطرُ من غيابِه.
 *    كلُّ اختبارٍ ههنا **يزرعُ خرقاً** ويطلبُ من الحاجزِ أن يراه.
 * الحالة: منفّذ فعلياً — اختباراتٌ سالبةٌ.
 * ينتمي إلى: tests/unit
 *
 * ولا يقيسُ هذا الملفُّ **صوابَ** آليّةٍ ولا رشدَ ترتيبِ موجةٍ — وهما حكمانِ
 * معماريّانِ يُراجَعانِ بالقراءةِ. يقيسُ أنَّ الشمولَ والتطابقَ والتماسكَ وصدقَ
 * الادّعاءِ **مفروضةٌ آليّاً** لا موصوفةٌ في وثيقةٍ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_INPUTS,
  declaredIds,
  type MatrixInputs,
  matrixProblems,
  migratedSectionIsEmpty,
  renderMatrix,
} from "../../scripts/check-migration-matrix.ts";
import {
  type ColumnPlanEntry,
  type MatrixEntry,
  WASLA_COLUMN_MIGRATION_PLAN,
  WASLA_MIGRATION_MATRIX,
} from "../../scripts/lib/wasla-migration-matrix.ts";

const ROADMAP = readFileSync("ROADMAP.md", "utf8");
const DOC = readFileSync("docs/migration/matrix.md", "utf8");

/** وثيقةٌ مطابقةٌ للمُدخلاتِ المزروعةِ، كي لا يُخلَطَ خرقُ الوثيقةِ بخرقِ السجلِّ. */
function docFor(inputs: MatrixInputs): string {
  return [
    "<!-- BEGIN GENERATED: migration-matrix -->",
    "",
    renderMatrix(inputs),
    "",
    "<!-- END GENERATED: migration-matrix -->",
  ].join("\n");
}

function withMatrix(matrix: readonly MatrixEntry[]): MatrixInputs {
  return { matrix, columnPlan: DEFAULT_INPUTS.columnPlan };
}

/** «لا هجرةَ» لا تحملُ موجةَ إتمامٍ، فتُنزَعُ المفتاحُ لا تُضبَطُ على `undefined`. */
function asNoMigration(entry: MatrixEntry): MatrixEntry {
  const { completesInWave: _dropped, ...rest } = entry;
  return { ...rest, mechanism: "NONE", wave: 0 };
}

function withColumns(columnPlan: readonly ColumnPlanEntry[]): MatrixInputs {
  return { matrix: DEFAULT_INPUTS.matrix, columnPlan };
}

/** أوّلُ تفصيلٍ يذكرُ الموضعَ — كي يُطابَقَ سببُ الإخفاقِ لا مجرَّدُ وقوعِه. */
function detailsFor(problems: readonly { where: string; detail: string }[], where: string) {
  return problems.filter((p) => p.where === where).map((p) => p.detail);
}

describe("مصفوفةُ الهجرةِ — الحالةُ الحاضرةُ في المستودعِ", () => {
  it("تمرُّ كما هيَ: لا خرقَ في السجلِّ ولا في الوثيقةِ", () => {
    expect(matrixProblems(ROADMAP, DOC)).toEqual([]);
  });

  // الرقمُ مُثبَّتٌ عن قصدٍ لا مُشتَقٌّ من الجردِ: لو قُرِئَ من الجردِ لصارَ
  // الاختبارُ صحيحاً بالإنشاءِ فلا يُوقِعُ نمواً صامتاً. ويُرفَعُ يداً معَ كلِّ
  // جدولٍ جديدٍ — ورُفِعَ من 47 إلى 48 بجدولِ `user_consents` (`F2-01`)، ثمَّ من 48
  // إلى 49 بجدولِ `saved_places` (`F2-02`) — ولا جدولَ ثانياً لأخرِ الوجهاتِ
  // فهيَ قراءةٌ من `orders` — ثمَّ من 49 إلى **51** بجدولَي `F2-03`:
  // `city_service_areas` و`destination_landmarks`، وكلاهما `NONE` في الموجةِ ٠
  // لأنَّه مملوكٌ لـMOVE بلا صفِّ مستخدمٍ فيه. ثمَّ من 51 إلى **53** بجدولَي
  // `ADR 0113`: `identity_hash_pepper` و`identity_marks`، وكلاهما
  // `HANDOVER_WITH_OPAQUE_REFERENCE` في الموجةِ ٤ لأنَّ الحظرَ والسمعةَ
  // مملوكانِ لـCORE؛ والأرقامُ السابقةُ مكتوبةٌ لا ممحوّةٌ (`ح-8`). ثمَّ من 53 إلى
  // **54** بجدولِ `driver_documents` (`F3-01`)، وهوَ `NONE` في الموجةِ ٠ لأنَّ
  // حكمَ أهليّةِ القيادةِ مملوكٌ لـMOVE ويُقرأُ في مسارِ العرضِ الحارِّ نفسِه.
  // ثمَّ من 54 إلى **55** بجدولِ `admin_metric_snapshots` (`F7-08`)، وهوَ `NONE`
  // في الموجةِ ٠ لأنَّهُ **تجميعٌ مشتقٌّ من جداولٍ مملوكةٍ لـMOVE** يُعادُ
  // حسابُهُ كلَّ ستّينَ ثانيةً، فلا صفَّ يُنقَلُ ولا مفهومَ فيهِ يملِكُهُ CORE —
  // ولو مُحِيَ كلُّهُ لأُعيدَ بناءُهُ من مصادرِه في شوطٍ واحدٍ.
  // ثمَّ من 55 إلى **56** بجدولِ `authority_data_requests` (`F12-09`)، وهوَ `NONE`
  // في الموجةِ ٠ لأنَّهُ سجلُّ طلبٍ تشغيليٌّ يملكُهُ MOVE ولا مفهومَ فيهِ يملِكُهُ CORE.
  // ثمَّ من 61 إلى **62** بجدولِ `group_memberships` (`PD-001` · ADR 0157)،
  // وهوَ `NONE` في الموجةِ ٠ لأنَّهُ قرارُ بوّابةِ دخولٍ يملكُهُ MOVE ولا مفهومَ
  // فيهِ يملِكُهُ CORE — فالبوّابةُ تنظيمُ وصولٍ لا استحقاقٌ. ثمَّ من 62 إلى
  // **63** بجدولِ `account_recovery_requests` (`SEC-20`)، وهوَ `NONE` في
  // الموجةِ ٠ لأنَّ وجهتَهُ في جردِ الحدودِ `KEEP` لِمالكِ الهويّةِ (CORE):
  // لا جدولًا يُنقَلُ ولا مرجعًا يُعادُ ربطُهُ — مسارُ الاستردادِ يقرأُ الهدفَ
  // بـ`users.id` الداخليِّ، وينتقلُ بأكملِهِ معَ `users` في `W-3` متى نُفِّذَ.
  // ثمَّ من 63 إلى **64** بجدولِ `admin_break_glass_credentials` (`SEC-21` ·
  // ADR 0176)، وهوَ `NONE` في الموجةِ ٠ لأنَّ وجهتَهُ في جردِ الحدودِ `KEEP`
  // لِمالكِ الهويّةِ (CORE): سرُّ البابِ الموازي يُقفَلُ على `user_id` لا
  // على `telegram_id`، فينتقلُ بأكملِهِ معَ `users` في `W-3` متى نُفِّذَ.
  // ثمَّ من 66 إلى **67** بجدولِ `driver_document_reviewers` (`PD-042` · ADR 0256)،
  // `NONE` في الموجةِ ٠ لأنَّ وجهتَه `KEEP` لـMOVE تبعاً لوثائقِ السائق.
  // ثمَّ من 67 إلى **69** بجدولَي `order_messages` و`order_message_reads` (`WR-04` ·
  // ADR 0263)، `NONE` في الموجةِ ٠ لأنَّ محادثةَ المهمّةِ أثرُ تنفيذٍ يملكُه MOVE.
  // ثمَّ من 69 إلى **70** بجدولِ `escalation_card_closures` (`WR-22` · ADR 0278)، `NONE`
  // في الموجةِ ٠ لأنَّ وجهتَه `KEEP` لـMOVE تبعاً لتصعيدِ المهمّة.
  // ثمَّ من 70 إلى **71** بجدولِ `driver_offers_board_receipts` (`LOAD-01
  // Recovery` · CAP-RUN-20261016-CONTINUATION)، `NONE` في الموجةِ ٠ لأنَّ وجهتَه
  // `KEEP` لـMOVE تبعاً لدليلِ تسليمِ العروضِ (إيصالاتُ اللوحِ).
  // ثمَّ من 71 إلى **72** بجدولِ `rider_trip_event_receipts` (ADR 0287 · التكليفُ
  // السابعُ)، `NONE` في الموجةِ ٠ لأنَّ وجهتَه `KEEP` لـMOVE تبعاً لدليلِ تسليمِ أحداثِ الرحلةِ.
  // والأرقامُ السابقةُ محفوظةٌ لا ممحوّةٌ (`ح-8`).
  it("تغطّي كلَّ جدولٍ في جردِ الحدودِ بلا زيادةٍ", () => {
    expect(WASLA_MIGRATION_MATRIX.length).toBe(72);
    expect(new Set(WASLA_MIGRATION_MATRIX.map((e) => e.table)).size).toBe(72);
  });

  it("لا مُدخلَ يدّعي تنفيذاً اليومَ — ولا خطّةَ عمودٍ", () => {
    for (const e of [...WASLA_MIGRATION_MATRIX, ...WASLA_COLUMN_MIGRATION_PLAN])
      expect(e.executed).toBe(false);
  });
});

describe("الشمولُ والتطابقُ", () => {
  it("يُخفِقُ على جدولٍ مُصنَّفٍ في الجردِ بلا خطّةِ هجرةٍ", () => {
    const inputs = withMatrix(WASLA_MIGRATION_MATRIX.filter((e) => e.table !== "orders"));
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "orders")).toContain("جدولٌ مُصنَّفٌ في الجردِ ولا خطّةَ هجرةٍ له");
  });

  it("يُخفِقُ على مُدخلٍ ميّتٍ لجدولٍ لا وجودَ له في الجردِ", () => {
    const ghost: MatrixEntry = {
      table: "table_that_was_dropped",
      mechanism: "READ_THROUGH_CORE",
      wave: 1,
      prerequisites: [],
      rollback: "ر",
      verification: "ق",
      executed: false,
    };
    const inputs = withMatrix([...WASLA_MIGRATION_MATRIX, ghost]);
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "table_that_was_dropped")).toContain(
      "مُدخلٌ في المصفوفةِ لجدولٍ لا وجودَ له في جردِ الحدودِ — مُدخلٌ ميّتٌ",
    );
  });

  it("يُخفِقُ على مُدخلٍ مكرَّرٍ لجدولٍ واحدٍ", () => {
    const orders = WASLA_MIGRATION_MATRIX.find((e) => e.table === "orders");
    if (orders === undefined) throw new Error("`orders` مفقودٌ من المصفوفةِ");
    const inputs = withMatrix([...WASLA_MIGRATION_MATRIX, orders]);
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "orders")).toContain("مُدخلٌ مكرَّرٌ في المصفوفةِ");
  });
});

describe("تنافرُ الآليّةِ معَ وجهةِ الجردِ", () => {
  it("يُخفِقُ على «لا هجرةَ» لجدولٍ وجهتُه MOVE_TO_CORE", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.table === "payment_transactions" ? asNoMigration(e) : e,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "payment_transactions").some((d) => d.startsWith("تنافرٌ:"))).toBe(
      true,
    );
  });

  it("يُخفِقُ على «لا هجرةَ» في موجةِ عملٍ، وعلى عملٍ في الموجةِ ٠", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) => {
        if (e.table === "db_backups") return { ...e, wave: 3 };
        if (e.table === "cities") return { ...e, wave: 0 };
        return e;
      }),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "db_backups")).toContain(
      "آليّةُ NONE في الموجةِ 3 — «لا هجرةَ» لا تنتمي إلى موجةِ عملٍ",
    );
    expect(detailsFor(problems, "cities")).toContain(
      "الموجةُ ٠ لا عملَ فيها، والآليّةُ EVENT_PROJECTION عملٌ",
    );
  });

  it("يُخفِقُ على آليّةٍ خارجَ القائمةِ المغلقةِ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.table === "cities" ? { ...e, mechanism: "BIG_BANG_CUTOVER" as never } : e,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "cities")).toContain("آليّةٌ خارجَ القائمةِ المغلقةِ: BIG_BANG_CUTOVER");
  });

  it("يُخفِقُ على «لا هجرةَ» لجدولٍ عليه اختراقُ حدٍّ عموديٌّ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) => (e.table === "drivers" ? asNoMigration(e) : e)),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "drivers")).toContain(
      "«لا هجرةَ» لجدولٍ عليه اختراقُ حدٍّ عموديٌّ مُعلَنٌ في الجردِ",
    );
  });
});

describe("خطّةُ الأعمدةِ", () => {
  it("يُخفِقُ على اختراقِ حدٍّ مُعلَنٍ في الجردِ بلا خطّةِ عمودٍ", () => {
    const inputs = withColumns(
      WASLA_COLUMN_MIGRATION_PLAN.filter((p) => !(p.table === "users" && p.column === "role")),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "users.role")).toContain("اختراقُ حدٍّ مُعلَنٌ في الجردِ ولا خطّةَ عمودٍ له");
  });

  it("يُخفِقُ على خطّةِ عمودٍ لاختراقٍ غيرِ مُعلَنٍ", () => {
    const ghost: ColumnPlanEntry = {
      table: "orders",
      column: "column_never_declared",
      mechanism: "COLUMN_SPLIT",
      wave: 1,
      prerequisites: [],
      rollback: "ر",
      verification: "ق",
      executed: false,
    };
    const inputs = withColumns([...WASLA_COLUMN_MIGRATION_PLAN, ghost]);
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "orders.column_never_declared")).toContain(
      "خطّةُ عمودٍ لاختراقٍ غيرِ مُعلَنٍ في الجردِ",
    );
  });

  it("يُخفِقُ على اختراقِ حدٍّ يُزعَمُ إغلاقُه بـ«لا هجرةَ»", () => {
    const inputs = withColumns(
      WASLA_COLUMN_MIGRATION_PLAN.map((p) =>
        p.column === "role" ? { ...p, mechanism: "NONE" as const } : p,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "users.role")).toContain("اختراقُ حدٍّ لا يُغلَقُ بـ«لا هجرةَ»");
  });

  it("يقبلُ عموداً داخلَ موجةِ إتمامِ جدولِه، ويُخفِقُ على ما تجاوزَها", () => {
    const inputs = withColumns(
      WASLA_COLUMN_MIGRATION_PLAN.map((p) => (p.column === "rider_id" ? { ...p, wave: 6 } : p)),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    // موجةُ `orders` هيَ ٦، فـ٦ مقبولةٌ — نزيدُها إلى ما بعدَها لنرى الإخفاقَ.
    expect(detailsFor(problems, "orders.rider_id")).toEqual([]);

    const worse = withColumns(
      WASLA_COLUMN_MIGRATION_PLAN.map((p) => (p.column === "user_id" ? { ...p, wave: 5 } : p)),
    );
    const worseProblems = matrixProblems(ROADMAP, docFor(worse), worse);
    expect(
      detailsFor(worseProblems, "drivers.user_id").some((d) =>
        d.includes("تمامٌ مُدّعى وعمودٌ مُعلَنٌ لمّا يُنزَعْ"),
      ),
    ).toBe(true);
  });
});

describe("الشروطُ السابقةُ والموجاتُ", () => {
  it("يُخفِقُ على معرّفِ شرطٍ سابقٍ غيرِ مُعلَنٍ في ROADMAP.md", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.table === "cities" ? { ...e, prerequisites: ["DEP-CORE-999"] } : e,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "cities")).toContain(
      "شرطٌ سابقٌ بمعرّفٍ غيرِ مُعلَنٍ في ROADMAP.md: DEP-CORE-999",
    );
  });

  it("يقرأُ كلَّ معرّفٍ مُعلَنٍ فعلاً، ولا يخترعُ واحداً", () => {
    const ids = declaredIds(ROADMAP);
    for (const id of ["B-1", "B-5", "O-1", "DEP-CORE-002", "DEP-CORE-007"])
      expect(ids.has(id)).toBe(true);
    expect(ids.has("B-99")).toBe(false);
  });

  it("يُخفِقُ على موجةٍ غيرِ مُعرَّفةٍ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) => (e.table === "cities" ? { ...e, wave: 42 } : e)),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "cities")).toContain("موجةٌ غيرُ مُعرَّفةٍ: 42");
  });

  it("يُخفِقُ على إتمامٍ يسبقُ البدايةَ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) => (e.table === "orders" ? { ...e, completesInWave: 1 } : e)),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "orders")).toContain("يُقرَأُ تامّاً في الموجةِ 1 قبلَ موجةِ بدايتِه 6");
  });

  it("يُخفِقُ على آليّةٍ مُعلَنةٍ لا يستعملُها مُدخلٌ — إعلانٌ ميّتٌ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.mechanism === "EVENT_PROJECTION" ? { ...e, mechanism: "READ_THROUGH_CORE" as const } : e,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "EVENT_PROJECTION")).toContain(
      "آليّةٌ مُعلَنةٌ لا يستعملُها مُدخلٌ — إعلانٌ ميّتٌ يُقرأُ خطّةً",
    );
  });
});

describe("سلامةُ المُدخلِ", () => {
  it("يُخفِقُ على مُدخلٍ بلا مسارِ عودةٍ أو بلا قياسٍ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.table === "cities" ? { ...e, rollback: "   ", verification: "" } : e,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(detailsFor(problems, "cities")).toContain("مُدخلٌ بلا مسارِ عودةٍ");
    expect(detailsFor(problems, "cities")).toContain("مُدخلٌ بلا قياسٍ يُغلِقُه");
  });
});

describe("صدقُ الادّعاءِ — الفحصُ الحاكمُ", () => {
  it("يقرأُ قسمَ «Migrated» الحاضرَ خالياً", () => {
    expect(migratedSectionIsEmpty(ROADMAP)).toBe(true);
  });

  it("يُخفِقُ على مُدخلٍ يدّعي تنفيذاً وقسمُ «Migrated» خالٍ", () => {
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.table === "cities" ? ({ ...e, executed: true } as unknown as MatrixEntry) : e,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(
      detailsFor(problems, "cities").some((d) => d.includes("ادّعاءٌ بلا مقابلٍ في حالةِ المستودعِ")),
    ).toBe(true);
  });

  it("يُخفِقُ كذلكَ على خطّةِ عمودٍ تدّعي تنفيذاً", () => {
    const inputs = withColumns(
      WASLA_COLUMN_MIGRATION_PLAN.map((p) =>
        p.column === "role" ? ({ ...p, executed: true } as unknown as ColumnPlanEntry) : p,
      ),
    );
    const problems = matrixProblems(ROADMAP, docFor(inputs), inputs);
    expect(
      detailsFor(problems, "users.role").some((d) =>
        d.includes("ادّعاءٌ بلا مقابلٍ في حالةِ المستودعِ"),
      ),
    ).toBe(true);
  });

  it("لا يُخفِقُ على الادّعاءِ إن صارَ في «Migrated» صفٌّ حقيقيٌّ — الحاجزُ يقيسُ لا يُعاندُ", () => {
    const migrated = ROADMAP.replace(
      /^## Migrated\s*$([\s\S]*?)^## /m,
      "## Migrated\n\n- `cities` — أُسقِطَ من CORE في 2026-01-01، بدليلٍ.\n\n## ",
    );
    expect(migratedSectionIsEmpty(migrated)).toBe(false);
    const inputs = withMatrix(
      WASLA_MIGRATION_MATRIX.map((e) =>
        e.table === "cities" ? ({ ...e, executed: true } as unknown as MatrixEntry) : e,
      ),
    );
    const problems = matrixProblems(migrated, docFor(inputs), inputs);
    expect(
      detailsFor(problems, "cities").some((d) => d.includes("ادّعاءٌ بلا مقابلٍ في حالةِ المستودعِ")),
    ).toBe(false);
  });
});

describe("الوثيقةُ مُولَّدةٌ لا مكتوبةٌ بيدٍ", () => {
  it("يُخفِقُ على وثيقةٍ حُرِّرَت بيدٍ فافترقَت عن السجلِّ", () => {
    const tampered = DOC.replace("`cities`", "`cities` (سنُهاجِرُها لاحقاً بإذنِ اللهِ)");
    expect(tampered).not.toBe(DOC);
    const problems = matrixProblems(ROADMAP, tampered);
    expect(detailsFor(problems, "docs/migration/matrix.md")).toContain(
      "جدولُ الوثيقةِ لا يطابقُ السجلَّ — شغِّل `--write` ولا تُحرِّرْه بيدٍ",
    );
  });

  it("يُخفِقُ على وثيقةٍ فُقِدَت منها علامةُ التوليدِ", () => {
    const problems = matrixProblems(
      ROADMAP,
      DOC.replace("<!-- END GENERATED: migration-matrix -->", ""),
    );
    expect(
      detailsFor(problems, "docs/migration/matrix.md").some((d) =>
        d.startsWith("الوثيقةُ بلا علامتَي التوليدِ"),
      ),
    ).toBe(true);
  });

  it("لا يقرأُ وثيقةً غائبةً إخفاقاً صامتاً — يُمرِّرُ السجلَّ وحدَه", () => {
    expect(matrixProblems(ROADMAP, null)).toEqual([]);
  });
});
