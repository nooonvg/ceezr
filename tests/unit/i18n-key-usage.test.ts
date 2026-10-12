/**
 * الغرض: حاجزُ **استعمالِ** المفاتيح — ما لا يفحصُه `scripts/check-i18n.ts` عن قصدٍ (تماثلُ المفاتيحِ بين
 *   اللغاتِ لا وجودُ المفتاحِ الذي تناديه الشيفرة). ومعه حاجزُ التهجئةِ الإنجليزيّةِ للعلامة (ADR 0182).
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 *
 * ## لِمَ
 *
 * جردُ 2026-10-12 وجدَ مفاتيحَ تناديها الشيفرةُ ولا وجودَ لها في أيِّ قاموس، فيرى المستخدمُ المفتاحَ خامًا:
 *   ــ بوتُ الراكب: `rider.already_searching` حينَ يطلبُ وله طلبٌ قائم (رحلةً أو توصيلًا).
 *   ــ ملخّصُ رحلةِ السائق: `common.error` و`common.loading` و`common.submitting`.
 * وكانت القواميسُ الإنجليزيّةُ قد عادت إلى `Wasla` و`Waslah` (45 موضعًا) بعدَ قرارِ المالكِ `WASLA`.
 *
 * ## النطاق
 *
 * المفاتيحُ **الحرفيّةُ** في نداءاتِ `t(...)` و`tr(...)` و`translate(lang, ...)` و`translateMiniApp(lang, ...)`.
 * المفاتيحُ المبنيّةُ بقالبٍ (`` `vehicle.type.${raw}` ``) خارجَه: فُحِصَت أُسَرُها يدويًّا في الجردِ نفسِه
 * مقابلَ أنواعِ الدومين، ويحرسُ بعضَها اختبارُ سطحِه.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const bot = JSON.parse(readFileSync(join(ROOT, "packages/shared/i18n/ar.json"), "utf8")) as Record<
  string,
  string
>;
const miniapp = JSON.parse(
  readFileSync(join(ROOT, "packages/shared/i18n/miniapp/ar.json"), "utf8"),
) as Record<string, string>;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const CALL =
  /(?<![\w.])(?:t|tr|translate|translateMiniApp)\(\s*(?:[a-zA-Z_]+\s*,\s*)?["'`]([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)["'`]/g;

function missingKeys(): string[] {
  const missing: string[] = [];
  for (const file of [...sources(join(ROOT, "apps")), ...sources(join(ROOT, "packages"))]) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, "utf8");
    const inMiniApp = rel.startsWith("apps/miniapp/");
    for (const match of text.matchAll(CALL)) {
      const key = match[1] as string;
      const known = inMiniApp ? key in miniapp : key in bot || key in miniapp;
      if (!known) missing.push(`${rel}: ${key}`);
    }
  }
  return missing;
}

describe("استعمالُ مفاتيحِ الترجمة", () => {
  it("كلُّ مفتاحٍ حرفيٍّ تناديه الشيفرةُ موجودٌ في قاموسِ سطحِه — فلا يظهرُ خامًا", () => {
    expect(missingKeys()).toEqual([]);
  });

  it("الحاجزُ يمسكُ مفتاحًا مفقودًا فعلًا (ليسَ نمطًا لا يطابقُ شيئًا)", () => {
    const sample = 'reply(sender, tr("rider.status_none"));\nt("driver.summary.retry")';
    const keys = [...sample.matchAll(CALL)].map((m) => m[1]);
    expect(keys).toEqual(["rider.status_none", "driver.summary.retry"]);
  });
});

describe("التهجئةُ الإنجليزيّةُ للعلامة (ADR 0182)", () => {
  for (const path of ["packages/shared/i18n/en.json", "packages/shared/i18n/miniapp/en.json"]) {
    it(`${path}: «WASLA» وحدَها، لا Wasla ولا Waslah`, () => {
      const text = readFileSync(join(ROOT, path), "utf8");
      expect(text.match(/\bWaslah?\b/g) ?? []).toEqual([]);
      expect(text).toContain("WASLA");
    });
  }
});
