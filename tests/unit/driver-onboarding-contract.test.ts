import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * عقد تسجيل السائق من التطبيق المصغَّر في تجهيز الحمل — المرحلة 1 من خارطة
 * الاستكمال (`ADR 0286` · `PRD-105` · `ADR 0257`).
 *
 * الدرس الذي يمنعه هذا العقد: عودةُ التجهيزِ إلى بذرِ SQL مباشرٍ (أو حوارِ
 * البوتِ) فتنقطعُ صلةُ الحملِ بالمسارِ الحقيقيِّ الذي يسلكُهُ المستخدمُ —
 * وهو ما تفتحُهُ المرحلةُ 7 (GROUP-01) اعتمادًا على هذه المرحلةِ.
 *
 * العقد:
 * 1. التسجيلُ نفسُهُ عبرَ `POST /v1/onboarding/driver` — لا INSERT مباشرًا في
 *    `drivers`/`users` (الاستثناءُ الموثَّقُ: خطواتُ المشرفِ — التوثيقُ والقدرةُ
 *    والتجربةُ — إذ لا واجهةَ إداريةً في البيئةِ المعزولةِ).
 * 2. إثباتُ الرقمِ عبرَ بطاقةِ الاتصالِ في الـwebhook — المسارُ الحقيقيُّ
 *    (المستنزفُ يعالجُها فعلًا) — لا زرعًا للإثباتِ في الجلسةِ مباشرةً.
 * 3. الهويةُ منَ الجلسةِ الموقعةِ — والضميمةُ غيرُ الموقعةِ لا تُلمس.
 * 4. مولّدُ الحملِ (miniapp-load) يستخدمُ هذهِ الوحدةَ لا بذرَهُ الخاصَّ.
 */

const MODULE = "deploy/capacity-run/load/driver-onboarding.ts";
const LOAD = "deploy/capacity-run/load/miniapp-load.ts";
const src = readFileSync(MODULE, "utf8");
const loadSrc = readFileSync(LOAD, "utf8");

describe("عقد تسجيل السائق من التطبيق في تجهيز الحمل (المرحلة 1)", () => {
  test("التسجيل عبر واجهة التطبيق: POST /v1/onboarding/driver — لا INSERT مباشراً في drivers/users", () => {
    expect(src).toContain('"/v1/onboarding/driver"');
    // أي INSERT في drivers/users يعني عودةَ البذرِ المباشرِ — ممنوع
    expect(src).not.toMatch(/insert into users/);
    expect(src).not.toMatch(/insert into drivers/);
    // الاستثناء الموثق: خطوات المشرف (update التوثيق + القدرة + التجربة)
    expect(src).toContain("update drivers set verification_status");
    expect(src).toContain("insert into driver_capabilities");
    expect(src).toContain("start_trial");
  });

  test("إثبات الرقم عبر بطاقة اتصال في الـwebhook — المسار الحقيقي للمستنزف", () => {
    expect(src).toContain("/webhook/telegram/driver");
    expect(src).toContain("phone_number");
    // بطاقة الاتصال تُقبل فقط إن كانت للمرسِل نفسه — الملكية تُرسل ولا تفترض
    expect(src).toContain("user_id: driverTg");
  });

  test("انتظار معالجة الوارد فعلاً — لا نجاح بمجرد استقبال الطلب", () => {
    // انتظار المهمة المحددة نفسها (مفتاح bot+update_id) حتى done — لا فراغ الطابور العام
    expect(src).toContain("waitForSpecificJob");
    expect(src).toContain("telegram_update_jobs");
    expect(src).toContain("update_id = ");
    // dead فشل صريح يُسجل، والمهلة timeout لا تُمرر نجاحاً
    expect(src).toContain('"dead"');
    expect(src).toContain('"timeout"');
  });

  test("الحكم من القاعدة لا من 2xx: التحقق من صف السائق بحالته", () => {
    expect(src).toContain("verification_status");
    expect(src).toMatch(/record\.ok\s*=/);
  });

  test("الهوية من الجلسة الموقعة — الضميمة غير الموقعة لا تُلمس", () => {
    expect(src).toContain('"/v1/session/telegram"');
    expect(src).toContain("signedInitData");
    // الرمز المحظور يُبنى تركيبيًا كي لا يظهر حرفيًا في هذا الملف (حارس F1-02)
    const forbidden = ["initData", "Unsafe"].join("");
    expect(src).not.toContain(forbidden);
    expect(src).not.toMatch(new RegExp(forbidden));
  });

  test("مولد الحمل يستخدم وحدة التسجيل لا بذره الخاص", () => {
    expect(loadSrc).toContain('from "./driver-onboarding.ts"');
    expect(loadSrc).toContain("seedDriverViaApp");
    // بذر السائق القديم (INSERT مباشر في drivers) زال من المولد
    expect(loadSrc).not.toMatch(/insert into drivers/);
  });

  test("فشل التسجيل يُسجل صادقاً — لا يُخفى ولا يُمرر كنجاح", () => {
    expect(loadSrc).toContain('"driver_onboarding_failed"');
  });
});
