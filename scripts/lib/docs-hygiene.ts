/**
 * الغرض: قواعدُ نظافةِ التوثيقِ — منطقٌ نقيٌّ بلا نظامِ ملفّاتٍ، ليُقاسَ سقوطُه بخرقٍ مزروع.
 * الحالة: منفّذ فعلياً — تنظيفُ المستودع 2026-10-11 (`AGENTS.md` §5).
 * ينتمي إلى: scripts/lib.
 *
 * ثلاثُ قواعد، كلٌّ منها يمنعُ صنفًا من الفوضى رُصِدَ فعلًا:
 *   1. `broken-link`: رابطٌ داخليٌّ في Markdown لا يصلُ إلى ملفّ. رُصدَ 18 قبلَ التنظيف.
 *   2. `docs-root`: ملفٌّ جديدٌ في جذرِ `docs/` خارجَ القائمةِ المعتمدة. كانَ الجذرُ 51 ملفًّا،
 *      أغلبُها تقاريرُ مراحلَ منتهية، فيُرشَدُ كاتبُها إلى `evidence/` أو `adr/` أو `archive/`.
 *   3. `missing-source`: مسارٌ يُعلنُه `AGENTS.md` مرجعًا ولا وجودَ له، فيضلُّ القارئُ من أوّلِ خطوة.
 */

export interface DocsHygieneInputs {
  /** كلُّ ملفّاتِ Markdown المتعقَّبة: المسارُ ونصُّه. */
  readonly markdown: readonly { readonly path: string; readonly text: string }[];
  /** هل المسارُ موجود؟ (نسبةً إلى جذرِ المستودع، بلا `./`) */
  readonly exists: (path: string) => boolean;
  /** نصُّ `AGENTS.md`، أو `null` إن غاب. */
  readonly agents: string | null;
}

export interface HygieneProblem {
  readonly rule: "broken-link" | "docs-root" | "missing-source" | "missing-entry";
  readonly detail: string;
}

/**
 * ما يجوزُ في جذرِ `docs/`: مراجعُ نافذةٌ، وملفّاتٌ تشيرُ إليها الحواجزُ بمسارِها.
 * والإضافةُ إليها قرارٌ يُكتَبُ هنا ويُراجَع، لا ملفٌّ يُلقى.
 */
export const DOCS_ROOT_ALLOWED: readonly string[] = [
  "MASTER_DIRECTIVE.md",
  "ROADMAP-MASTER.md",
  "ROADMAP-PRODUCT-DEBT.md",
  "SYSTEM_STATE.md",
  "UI_SURFACE_INVENTORY.md",
  "UI_UX_CANONICAL_DIRECTIVE.md",
  "UI_UX_RECONCILIATION_REPORT.md",
  "agent-core-activation.md",
  "api.md",
  "directive-item-0-live-diagnosis.md",
  "load-test-report.md",
  "render-deployment-vars.md",
  "rollback.md",
  "runbook.md",
  "runtime-prerequisites.md",
];

const FENCE = /```[\s\S]*?```/g;
const LINK = /\]\(([^)\s#]+)(#[^)]*)?\)/g;
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/** `a/b/../c` ← `a/c`، بلا اعتمادٍ على `node:path` (منطقٌ نقيّ). */
export function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** روابطُ Markdown الداخليّة في نصّ، بعدَ إسقاطِ كتلِ الكود. */
export function internalLinks(text: string): string[] {
  const links: string[] = [];
  for (const match of text.replace(FENCE, "").matchAll(LINK)) {
    const target = match[1] ?? "";
    if (target === "" || EXTERNAL.test(target)) continue;
    links.push(target);
  }
  return links;
}

/** مساراتُ المراجعِ في جدولِ §2 من `AGENTS.md`: كلُّ `docs/…` أو ملفٍّ جذريٍّ بين علامتَي كود، بلا أنماط. */
export function declaredSources(agents: string): string[] {
  const start = agents.indexOf("## 2.");
  const end = agents.indexOf("## 3.", start + 1);
  if (start === -1) return [];
  const section = agents.slice(start, end === -1 ? undefined : end);
  const paths = new Set<string>();
  for (const match of section.matchAll(/`([^`\s]+)`/g)) {
    const raw = match[1] ?? "";
    if (/[*{}<>]|NNNN/.test(raw)) continue;
    const path = raw.replace(/\/$/, "");
    if (path.startsWith("docs/") || /^[A-Z_-]+\.md$/.test(path)) paths.add(path);
  }
  return [...paths];
}

export function docsHygieneProblems(inputs: DocsHygieneInputs): readonly HygieneProblem[] {
  const problems: HygieneProblem[] = [];

  for (const doc of inputs.markdown) {
    for (const target of internalLinks(doc.text)) {
      const resolved = target.startsWith("/")
        ? normalize(target)
        : normalize(`${dirOf(doc.path)}/${target}`);
      if (!inputs.exists(resolved)) {
        problems.push({
          rule: "broken-link",
          detail: `${doc.path}: رابطٌ إلى \`${target}\` لا يصلُ إلى ملفّ (${resolved}).`,
        });
      }
    }
    const root = /^docs\/([^/]+\.md)$/.exec(doc.path);
    if (root !== null && !DOCS_ROOT_ALLOWED.includes(root[1] ?? "")) {
      problems.push({
        rule: "docs-root",
        detail:
          `${doc.path}: ملفٌّ في جذرِ \`docs/\` خارجَ القائمةِ المعتمدة. التقريرُ لا يُضافُ وثيقةً: ` +
          "دليلُه في `docs/evidence/`، وقرارُه ADR، وحالتُه في `SYSTEM_STATE` (`AGENTS.md` §5).",
      });
    }
  }

  if (inputs.agents === null) {
    problems.push({ rule: "missing-entry", detail: "`AGENTS.md` غائب — لا نقطةَ دخولٍ للمستلِم." });
  } else {
    const sources = declaredSources(inputs.agents);
    if (sources.length === 0) {
      problems.push({
        rule: "missing-entry",
        detail: "`AGENTS.md` بلا جدولِ مصادرَ قابلٍ للقراءة في §2 — الكشفُ معطوبٌ ولا يُقرأُ نجاحًا.",
      });
    }
    for (const path of sources) {
      if (!inputs.exists(path)) {
        problems.push({
          rule: "missing-source",
          detail: `AGENTS.md §2 يُعلنُ \`${path}\` مرجعًا ولا وجودَ له.`,
        });
      }
    }
  }
  return problems;
}
