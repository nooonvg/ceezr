/**
 * الغرض: `EVIDENCE-01` — التحقّقُ الآليُّ من كلِّ `SHA256SUMS` تحتَ `docs/evidence/`:
 *   كلُّ ملفٍّ مُدرَجٍ موجودٌ وبصمتُه مطابقة (أو أصلُه المضغوطُ `.gz` بعدَ فكِّه)، وكلُّ
 *   ملفٍّ في الحزمةِ مُدرَجٌ في بيانِها أو في بيانٍ متداخلٍ أو في استثناءٍ مُعلَنٍ بسبب.
 *
 *   والدافعُ مقيس (الدفعة 19): من 47 بيانًا كانت 5 لا تطابقُ ما في المستودع — ملفّانِ
 *   في الدفعة 9 عُدِّلا بعدَ التجزئة، وبيانانِ في الدفعة 17 يسبقانِ إعادةَ تسميةٍ
 *   موثّقة، ونسخةٌ جزئيّةٌ من حزمةِ `CAP-RUN-20261015`. ووجودُ `SHA256SUMS` وحدَه لم
 *   يكن يثبتُ شيئًا؛ هذا الحاجزُ يجعلُ المطابقةَ شرطًا لا ادّعاءً.
 *
 *   الاستثناءُ لا يُسكتُ فشلًا عامًّا: يُسمّي الملفّاتِ بعينِها ويحملُ سببًا ومرجعًا،
 *   واستثناءٌ لا يُطابقُ واقعًا (ملفٌّ مُعلَنٌ غائبًا وهو موجود، أو بيانٌ «مُستبدَلٌ»
 *   لا يغطّيه الأب) يُسقطُ الحاجزَ أيضًا — فلا يتعفّنُ السجلّ.
 * الحالة: منفّذ فعلياً — الدفعة 19.
 * ينتمي إلى: scripts/lib.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";

export type ManifestException = {
  /** مجلّدُ البيانِ نسبةً إلى جذرِ المستودع. */
  readonly dir: string;
  /** سببٌ مقروءٌ ومرجعُ توثيقه — إلزاميّ. */
  readonly reason: string;
  /** ملفّاتٌ مُدرَجةٌ غائبةٌ عن المستودعِ عمدًا (محفوظةٌ خارجَه). */
  readonly absent?: readonly string[];
  /** ملفّاتٌ في المجلّدِ غيرُ مُدرَجةٍ عمدًا (إضافةٌ لاحقةٌ مُعلَنة). */
  readonly unlisted?: readonly string[];
  /** البيانُ قديمٌ ويحلُّ محلَّهُ بيانُ هذا الأبِ الذي يجبُ أن يطابقَ ويغطّيَ كلَّ ملفّاتِ المجلّد. */
  readonly supersededBy?: string;
};

export type ManifestProblem = { readonly manifest: string; readonly detail: string };

export type ManifestReport = {
  readonly manifests: number;
  readonly files: number;
  readonly problems: readonly ManifestProblem[];
};

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export function parseManifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
    if (match === null) throw new Error(`سطرٌ غيرُ مقروءٍ في البيان: ${line}`);
    const [, hash, path] = match as unknown as [string, string, string];
    entries.set(path.replace(/^\.\//, ""), hash);
  }
  return entries;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

export function findManifests(root: string): string[] {
  if (!existsSync(root)) return [];
  return walk(root)
    .filter((path) => path.endsWith("/SHA256SUMS") || path === "SHA256SUMS")
    .sort();
}

/** يُعيدُ بصمةَ الملفِّ، أو أصلِه المضغوطِ بعدَ فكِّه، أو `null` إن غابا. */
function digestOf(path: string): { hash: string; via: "file" | "gz" } | null {
  if (existsSync(path)) return { hash: sha256(readFileSync(path)), via: "file" };
  if (existsSync(`${path}.gz`))
    return { hash: sha256(gunzipSync(readFileSync(`${path}.gz`))), via: "gz" };
  return null;
}

export function verifyEvidenceManifests(
  repoRoot: string,
  evidenceRoot: string,
  exceptions: readonly ManifestException[],
): ManifestReport {
  const problems: ManifestProblem[] = [];
  const manifests = findManifests(join(repoRoot, evidenceRoot));
  const byDir = new Map(exceptions.map((e) => [e.dir, e]));
  const usedExceptions = new Set<string>();
  const parsed = new Map<string, Map<string, string>>();
  let files = 0;

  for (const manifestPath of manifests) {
    const dir = dirname(manifestPath);
    try {
      parsed.set(dir, parseManifest(readFileSync(manifestPath, "utf8")));
    } catch (error) {
      problems.push({ manifest: relative(repoRoot, manifestPath), detail: String(error) });
    }
  }

  for (const manifestPath of manifests) {
    const dir = dirname(manifestPath);
    const relDir = relative(repoRoot, dir);
    const name = relative(repoRoot, manifestPath);
    const entries = parsed.get(dir);
    if (entries === undefined) continue;
    const exception = byDir.get(relDir);
    if (exception !== undefined) {
      usedExceptions.add(relDir);
      if (exception.reason.trim().length < 20) {
        problems.push({ manifest: name, detail: "استثناءٌ بلا سببٍ مقروء" });
      }
    }

    // البيانُ المُستبدَل: لا يُتحقَّقُ منه بذاته؛ يُشترطُ أن يغطّيَ الأبُ كلَّ ملفّاتِ المجلّد.
    if (exception?.supersededBy !== undefined) {
      const parentDir = join(repoRoot, exception.supersededBy);
      const parent = parsed.get(parentDir);
      if (parent === undefined) {
        problems.push({
          manifest: name,
          detail: `البيانُ الأبُ غيرُ موجود: ${exception.supersededBy}`,
        });
        continue;
      }
      for (const file of walk(dir)) {
        const rel = relative(parentDir, file);
        // البيانُ القديمُ نفسُه أثرٌ تاريخيٌّ لا يُشترطُ أن يُدرجَه الأب.
        if (file === manifestPath) continue;
        if (!parent.has(rel)) {
          problems.push({
            manifest: name,
            detail: `مُستبدَلٌ والأبُ لا يغطّي: ${relative(repoRoot, file)}`,
          });
        }
      }
      continue;
    }

    const absent = new Set(exception?.absent ?? []);
    for (const [path, hash] of entries) {
      files += 1;
      const digest = digestOf(join(dir, path));
      if (digest === null) {
        if (!absent.has(path)) problems.push({ manifest: name, detail: `مُدرَجٌ غائب: ${path}` });
        continue;
      }
      if (absent.has(path)) {
        problems.push({
          manifest: name,
          detail: `مُعلَنٌ غائبًا وهو موجود — يُزالُ من الاستثناء: ${path}`,
        });
      }
      if (digest.hash !== hash) {
        problems.push({
          manifest: name,
          detail: `بصمةٌ غيرُ مطابقة${digest.via === "gz" ? " (بعدَ فكِّ .gz)" : ""}: ${path}`,
        });
      }
    }
    for (const path of absent) {
      if (!entries.has(path))
        problems.push({ manifest: name, detail: `استثناءُ غيابٍ لملفٍّ غيرِ مُدرَج: ${path}` });
    }

    // ما في المجلّدِ ولا يُدرجُه البيانُ ولا بيانٌ متداخل.
    const nested = [...parsed.keys()].filter(
      (other) => other !== dir && other.startsWith(`${dir}/`),
    );
    const unlisted = new Set(exception?.unlisted ?? []);
    for (const file of walk(dir)) {
      const rel = relative(dir, file);
      if (rel === "SHA256SUMS") continue;
      const plain = rel.endsWith(".gz") ? rel.slice(0, -3) : rel;
      if (entries.has(rel) || entries.has(plain)) continue;
      if (nested.some((child) => file.startsWith(`${child}/`))) continue;
      if (unlisted.has(rel)) continue;
      problems.push({ manifest: name, detail: `ملفٌّ غيرُ مُدرَج: ${rel}` });
    }
    for (const path of unlisted) {
      if (!existsSync(join(dir, path))) {
        problems.push({ manifest: name, detail: `استثناءُ «غيرِ مُدرَجٍ» لملفٍّ غائب: ${path}` });
      }
    }
  }

  for (const exception of exceptions) {
    if (!usedExceptions.has(exception.dir)) {
      problems.push({ manifest: exception.dir, detail: "استثناءٌ لبيانٍ غيرِ موجود — يُزال" });
    }
  }

  return { manifests: manifests.length, files, problems };
}
