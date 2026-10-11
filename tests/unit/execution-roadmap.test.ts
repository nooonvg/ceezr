import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CANONICAL_ITEMS,
  parseDeclaration,
  rangeProblems,
  STATUS_PATH,
  structureProblems,
} from "../../scripts/lib/execution-roadmap.ts";

const HEADER = "| المعرّف | البند | القسم | الحالة | الأساس | الدليل | العائق |\n|---|---|---|---|---|---|---|\n";

function row(id: string, status = "لم يبدأ", evidence = "—", blocker = "—"): string {
  return `| ${id} | بند | §1 | ${status} | — | ${evidence} | ${blocker} |`;
}

function table(overrides: Record<string, string> = {}): string {
  return HEADER + CANONICAL_ITEMS.map((id) => overrides[id] ?? row(id)).join("\n");
}

const rules = (problems: readonly { rule: string }[]) => problems.map((p) => p.rule);

describe("خارطة التنفيذ — بنية الجدول", () => {
  it("الجدول الحقيقي في المستودع سليم", () => {
    expect(structureProblems(readFileSync(STATUS_PATH, "utf8"))).toEqual([]);
  });

  it("جدول كامل بحالات أولية لا مشكلة فيه", () => {
    expect(structureProblems(table())).toEqual([]);
  });

  it("حذف بند قانوني يُرفض", () => {
    const text = table().replace(`${row("WR-04")}\n`, "");
    expect(rules(structureProblems(text))).toContain("missing-item");
  });

  it("حالة خارج السلّم تُرفض", () => {
    expect(rules(structureProblems(table({ "WR-05": row("WR-05", "مكتمل") })))).toContain("bad-status");
  });

  it("«نُفذ في الشيفرة» بلا دليل يُرفض، وبدليل يُقبل", () => {
    expect(rules(structureProblems(table({ "WR-18": row("WR-18", "نُفذ في الشيفرة") })))).toContain(
      "status-without-evidence",
    );
    expect(structureProblems(table({ "WR-18": row("WR-18", "نُفذ في الشيفرة", "PR #500") }))).toEqual([]);
  });

  it("«نُشر في الإنتاج» بلا commit يُرفض", () => {
    const bad = table({ "WR-18": row("WR-18", "نُشر في الإنتاج وتحقق منه", "منشور") });
    expect(rules(structureProblems(bad))).toContain("deploy-without-commit");
    const good = table({ "WR-18": row("WR-18", "نُشر في الإنتاج وتحقق منه", "gateway `a1b2c3d4` dep-x") });
    expect(structureProblems(good)).toEqual([]);
  });

  it("«اجتاز اختبار تيليجرام» بلا مسار دليل يُرفض", () => {
    const bad = table({ "WR-18": row("WR-18", "اجتاز اختبار تيليجرام الفعلي", "`a1b2c3d4`") });
    expect(rules(structureProblems(bad))).toContain("field-without-evidence");
  });

  it("«متوقف» بلا عائق يُرفض", () => {
    expect(rules(structureProblems(table({ "WR-21": row("WR-21", "متوقف") })))).toContain("blocked-without-reason");
  });

  it("بند مكرر يُرفض", () => {
    expect(rules(structureProblems(`${table()}\n${row("WR-04")}`))).toContain("duplicate-item");
  });
});

describe("خارطة التنفيذ — التغيير وحالته معًا", () => {
  const base = table();

  it("تغيير تنفيذي بلا إعلان يُرفض", () => {
    const problems = rangeProblems({
      changedFiles: ["apps/gateway/src/routes/rides.ts"],
      declarationText: "fix something",
      baseStatus: base,
      headStatus: base,
    });
    expect(rules(problems)).toEqual(["undeclared-change"]);
  });

  it("بند مُعلن لم يتغير صفه يُرفض", () => {
    const problems = rangeProblems({
      changedFiles: ["apps/gateway/src/routes/deliveries.ts"],
      declarationText: "بنود الخارطة: WR-18",
      baseStatus: base,
      headStatus: base,
    });
    expect(rules(problems)).toEqual(["status-not-updated"]);
  });

  it("بند مُعلن تغير صفه يُقبل", () => {
    const head = table({ "WR-18": row("WR-18", "قيد التنفيذ") });
    expect(
      rangeProblems({
        changedFiles: ["apps/gateway/src/routes/deliveries.ts", STATUS_PATH],
        declarationText: "بنود الخارطة: WR-18",
        baseStatus: base,
        headStatus: head,
      }),
    ).toEqual([]);
  });

  it("WR-NONE يحتاج سببًا محددًا", () => {
    const weak = rangeProblems({
      changedFiles: ["scripts/x.ts"],
      declarationText: "WR-NONE: ci",
      baseStatus: base,
      headStatus: base,
    });
    expect(rules(weak)).toEqual(["weak-none"]);
    const ok = rangeProblems({
      changedFiles: ["scripts/x.ts"],
      declarationText: "WR-NONE: تحديث مكتبة الاختبار دون أثر وظيفي",
      baseStatus: base,
      headStatus: base,
    });
    expect(ok).toEqual([]);
  });

  it("تغيير توثيقي وحده لا يحتاج إعلانًا", () => {
    expect(
      rangeProblems({ changedFiles: ["docs/runbook.md"], declarationText: "", baseStatus: base, headStatus: base }),
    ).toEqual([]);
  });

  it("بند مجهول يُرفض", () => {
    const problems = rangeProblems({
      changedFiles: [],
      declarationText: "WR-99",
      baseStatus: base,
      headStatus: base,
    });
    expect(rules(problems)).toContain("unknown-item");
  });

  it("قالب PR متروك كما هو لا يُقرأ إعلانًا", () => {
    const template = readFileSync(".github/pull_request_template.md", "utf8");
    expect(parseDeclaration(template)).toEqual({ items: [], none: null });
  });

  it("قالب PR بعلامة WR-NN لا يُقرأ إعلانًا", () => {
    expect(parseDeclaration("بنود الخارطة: WR-NN").items).toEqual([]);
  });
});
