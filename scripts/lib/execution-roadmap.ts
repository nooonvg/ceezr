/**
 * حارسُ خارطةِ التنفيذ (`DEC-25` · `ADR 0262`).
 *
 * منطقٌ خالصٌ بلا قراءةِ ملفّاتٍ ولا git، فيُختبَرُ كلُّه في `tests/unit/execution-roadmap.test.ts`.
 * ويقرأُ واجهتَه `scripts/check-execution-roadmap.ts`.
 *
 * قاعدتان:
 *   (أ) **بنيةُ الجدول:** كلُّ بندٍ قانونيٍّ موجودٌ مرّةً واحدة، وحالتُه من السلّم،
 *       ولا حالةَ أعلى من دليلِها.
 *   (ب) **التغييرُ وحالتُه معًا:** تغييرٌ تنفيذيٌّ يُعلِنُ بندَه (أو `WR-NONE` بسبب)،
 *       وكلُّ بندٍ مُعلَنٍ يتغيّرُ صفُّه في التغييرِ نفسِه.
 */

export const STATUS_PATH = "docs/roadmap/execution/STATUS.md";

/** البنودُ القانونيّةُ من أمرِ المالك. لا يُحذَفُ منها شيء، ويُضافُ إليها ما يُكتشَف. */
export const CANONICAL_ITEMS: readonly string[] = [
  "WR-00",
  "WR-04",
  "WR-05",
  "WR-06",
  "WR-07",
  "WR-08",
  "WR-09",
  "WR-10",
  "WR-11",
  "WR-12",
  "WR-13",
  "WR-14",
  "WR-15",
  "WR-16A",
  "WR-16B",
  "WR-16C",
  "WR-16D",
  "WR-17",
  "WR-18",
  "WR-19",
  "WR-20",
  "WR-21",
  "WR-22",
  "WR-23",
  "WR-24",
  "WR-25",
  "WR-26",
  "WR-27",
];

/** السلّمُ التصاعديّ، و`متوقف` خارجَه. */
export const STATUS_LADDER: readonly string[] = [
  "لم يبدأ",
  "قيد التنفيذ",
  "نُفذ في الشيفرة",
  "اجتاز الاختبارات الآلية",
  "نُشر في الإنتاج وتحقق منه",
  "اجتاز اختبار تيليجرام الفعلي",
];
export const BLOCKED = "متوقف";

const EMPTY_CELL = /^(?:—|-|–|)$/;

/** المساراتُ التي تُعَدُّ تنفيذًا. وهي نفسُها التي يعدُّها `check-state-sync.ts`. */
const IMPLEMENTATION = [
  /^apps\//,
  /^packages\//,
  /^supabase\//,
  /^scripts\//,
  /^tests\//,
  /^\.github\/workflows\//,
  /^render\.yaml$/,
  /^package\.json$/,
  /^bun\.lock$/,
  /^Dockerfile$/,
];

export interface StatusRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly evidence: string;
  readonly blocker: string;
  /** الصفُّ كما هو، لمقارنةِ التغيّر. */
  readonly raw: string;
}

export interface Problem {
  readonly rule: string;
  readonly detail: string;
}

export function isImplementation(path: string): boolean {
  return IMPLEMENTATION.some((pattern) => pattern.test(path));
}

/** يقرأُ صفوفَ الجدولِ التي يبدأُ عمودُها الأوّلُ بمعرّفِ `WR-`. */
export function parseStatusTable(text: string): StatusRow[] {
  const rows: StatusRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("| WR-")) continue;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    rows.push({
      id: cells[0] ?? "",
      title: cells[1] ?? "",
      status: cells[3] ?? "",
      evidence: cells[5] ?? "",
      blocker: cells[6] ?? "",
      raw: trimmed,
    });
  }
  return rows;
}

function rank(status: string): number {
  return STATUS_LADDER.indexOf(status);
}

/** القاعدةُ (أ): بنيةُ الجدولِ وصدقُ حالاتِه. */
export function structureProblems(text: string): Problem[] {
  const rows = parseStatusTable(text);
  const problems: Problem[] = [];
  if (rows.length === 0) {
    return [{ rule: "empty", detail: `لا صفَّ بمعرّفِ WR- في ${STATUS_PATH} — الجدولُ مفقودٌ أو تغيّرت بنيتُه.` }];
  }

  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
  for (const id of CANONICAL_ITEMS) {
    if (!seen.has(id)) problems.push({ rule: "missing-item", detail: `${id} محذوفٌ من الجدول، ولا يُحذَفُ بندٌ من أمرِ المالك.` });
  }
  for (const [id, count] of seen) {
    if (count > 1) problems.push({ rule: "duplicate-item", detail: `${id} مكرّرٌ ${count} مرّات.` });
    if (!/^WR-\d{2}[A-Z]?$/.test(id)) problems.push({ rule: "bad-id", detail: `معرّفٌ غيرُ صالح: «${id}».` });
  }

  for (const row of rows) {
    const blocked = row.status === BLOCKED;
    const r = rank(row.status);
    if (!blocked && r < 0) {
      problems.push({ rule: "bad-status", detail: `${row.id}: الحالةُ «${row.status}» ليست من السلّم المعتمد.` });
      continue;
    }
    if (blocked && EMPTY_CELL.test(row.blocker)) {
      problems.push({ rule: "blocked-without-reason", detail: `${row.id}: «متوقف» بلا عائقٍ مذكور.` });
    }
    if (!blocked && r >= rank("نُفذ في الشيفرة") && EMPTY_CELL.test(row.evidence)) {
      problems.push({ rule: "status-without-evidence", detail: `${row.id}: «${row.status}» بلا دليل.` });
    }
    if (!blocked && r >= rank("نُشر في الإنتاج وتحقق منه") && !/\b[0-9a-f]{7,40}\b/.test(row.evidence)) {
      problems.push({ rule: "deploy-without-commit", detail: `${row.id}: «${row.status}» بلا commit منشور في الدليل.` });
    }
    if (!blocked && r >= rank("اجتاز اختبار تيليجرام الفعلي") && !row.evidence.includes("docs/evidence/")) {
      problems.push({ rule: "field-without-evidence", detail: `${row.id}: «${row.status}» بلا مسارِ دليلٍ في docs/evidence/.` });
    }
  }
  return problems;
}

export interface Declaration {
  readonly items: readonly string[];
  readonly none: string | null;
}

/** يستخرجُ ما يُعلنُه وصفُ PR أو رسائلُ الـcommit: معرّفاتُ `WR-` و`WR-NONE: سبب`. */
export function parseDeclaration(raw: string): Declaration {
  // تعليقاتُ HTML في قالبِ الطلبِ أمثلةٌ لا إعلان: قالبٌ تُرِكَ كما هو لا يُقرأُ إعلانًا.
  const text = raw.replace(/<!--[\s\S]*?-->/g, "");
  const noneMatch = /WR-NONE\s*:\s*(.+)/.exec(text);
  const items = new Set<string>();
  for (const match of text.matchAll(/\bWR-(\d{2}[A-Z]?)\b/g)) items.add(`WR-${match[1]}`);
  return { items: [...items].sort(), none: noneMatch ? (noneMatch[1] ?? "").trim() : null };
}

export interface RangeInput {
  readonly changedFiles: readonly string[];
  readonly declarationText: string;
  readonly baseStatus: string | null;
  readonly headStatus: string;
}

/** القاعدةُ (ب): التغييرُ التنفيذيُّ يُعلِنُ بندَه، والبندُ المُعلَنُ يتغيّرُ صفُّه. */
export function rangeProblems(input: RangeInput): Problem[] {
  const problems: Problem[] = [];
  const impl = input.changedFiles.filter(isImplementation);
  const declaration = parseDeclaration(input.declarationText);
  const known = new Set(parseStatusTable(input.headStatus).map((row) => row.id));

  for (const id of declaration.items) {
    if (!known.has(id)) problems.push({ rule: "unknown-item", detail: `${id} مُعلَنٌ وليسَ في الجدول.` });
  }

  if (impl.length > 0 && declaration.items.length === 0) {
    if (declaration.none === null) {
      problems.push({
        rule: "undeclared-change",
        detail: `تغييرٌ تنفيذيٌّ (${impl.length} ملفّ، أوّلُها ${impl[0]}) بلا «بنود الخارطة: WR-NN» ولا «WR-NONE: سبب».`,
      });
    } else if (declaration.none.length < 10) {
      problems.push({ rule: "weak-none", detail: "«WR-NONE» يحتاجُ سببًا محدّدًا لا يقلُّ عن عشرةِ أحرف." });
    }
  }

  if (declaration.items.length > 0) {
    const before = new Map(parseStatusTable(input.baseStatus ?? "").map((row) => [row.id, row.raw]));
    const after = new Map(parseStatusTable(input.headStatus).map((row) => [row.id, row.raw]));
    for (const id of declaration.items) {
      if (!after.has(id)) continue;
      if (before.get(id) === after.get(id)) {
        problems.push({
          rule: "status-not-updated",
          detail: `${id} مُعلَنٌ في هذا التغيير، وصفُّه في ${STATUS_PATH} لم يتغيّر. حدِّثْ حالتَه ودليلَه في التغييرِ نفسِه.`,
        });
      }
    }
  }
  return problems;
}
