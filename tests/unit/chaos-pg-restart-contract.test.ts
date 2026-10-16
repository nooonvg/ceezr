import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * عقد أداة حقن الأعطال — `pg_restart` (المرحلة 2أ من خارطة الاستكمال).
 *
 * الدرس من جولة CAP-RUN-20261016 الأولى: كان فعل `pg_restart` يمرر خيارات
 * `-o` تضم `-k $B/sock` (مجلد سوكيت غير موجود — الفعلي `pg-sock` من
 * postgresql.conf)، فيوقف PG بنجاح ثم يفشل إقلاعه بصمت ويبقى ميتًا، فلا
 * يُعاد إلا يدويًا، وتُفسد جولة الحقن كلها.
 *
 * العقد: إعادة تشغيل PG تتبع آلية `setup-env-20261016.sh` نفسها — الإعداد
 * كله من `postgresql.conf` بلا `-o` — وتتبعها فحص `pg_isready` مستقل يفشل
 * بصوت عالٍ إن لم يعد الخادم.
 */

const CHAOS_TS = "deploy/capacity-run/monitor/chaos.ts";

function pgRestartCaseSource(): string {
  const src = readFileSync(CHAOS_TS, "utf8");
  const m = src.match(/case "pg_restart":\s*\{[\s\S]*?\n\s{6}\}/);
  if (!m) throw new Error(`لم يُعثر على case "pg_restart" في ${CHAOS_TS}`);
  return m[0];
}

describe("عقد pg_restart في أداة الحقن", () => {
  const src = pgRestartCaseSource();

  test("لا يمرر -o: الإعداد من postgresql.conf كما في setup-env", () => {
    // أي -o يعني تضمين إعدادًا موازيًا للـconf — مصدر الانفصال التاريخي.
    // (الاستثناء الوحيد المقبول: لا شيء. إن احتجت خيارًا فضعْه في الـconf.)
    expect(src).not.toContain('"-o"');
  });

  test("يستخدم pg_ctl restart مع وضع fast وانتظار الإقلاع", () => {
    expect(src).toContain('"restart"');
    expect(src).toContain('"fast"');
    expect(src).toContain('"-w"');
  });

  test("يتبعه تحقق pg_isready مستقل يُسجل فشل الأداة صراحة", () => {
    expect(src).toContain("pg_isready");
    expect(src).toContain("pgReadyCheck");
    expect(src).toContain("toolFailure");
  });

  test("السجل يخزن نتيجة الجاهزية للمراجعة اللاحقة", () => {
    expect(src).toMatch(/rec\.pgReadyCheck\s*=\s*await\s*sh\(/);
  });
});
