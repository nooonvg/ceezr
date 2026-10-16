import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * عقد تجربة تعافي البوابة من انقطاع PG — المرحلة 2ب من خارطة الاستكمال.
 *
 * التجربة تجربتان منفصلتان: (أ) قتل خلفيات البوابة فقط أثناء عمل جارٍ،
 * (ب) إيقاف PG كامل وإعادته بالأداة المصححة (monitor/chaos.ts · فعل pg_restart
 * الذي أثبتت المرحلة 2أ إصلاحه). والعقد هنا يمنع رجوع العيوب المكتشفة:
 *
 * 1. القتل يقصد خلفيات البوابة وحدها (application_name='postgres.js') — لا
 *    جلسات التجربة نفسها ولا أداة الفوضى.
 * 2. الحكم يتطلب بقاء العملية نفسها (نفس PID) — لا يكفي أن «البوابة عادت»
 *    بعمليةٍ جديدة.
 * 3. التجربة (ب) تعيد PG بالأداة المصححة نفسها — لا استئناف يدوي.
 * 4. الحكم يتطلب دورة أعمال مكتملة من القاعدة (completed + لا تكرار: طلب
 *    واحد لكل راكب).
 * 5. الترتيب مقيس: جاهزية PG قبل جاهزية البوابة.
 * 6. سجل البوابة يُفحص على uncaughtException — الرقعة تُثبت وصولها للبناء.
 */

const SCRIPT = "deploy/capacity-run/load/pg-recovery.ts";
const src = readFileSync(SCRIPT, "utf8");

describe("عقد تجربة تعافي PG (المرحلة 2ب)", () => {
  test("قتل الخلفيات يقصد جلسات البوابة وحدها لا جلسات التجربة", () => {
    expect(src).toContain("application_name='postgres.js'");
    expect(src).toMatch(/application_name=pg-recovery-exp/);
  });

  test("الحكم يتطلب بقاء العملية نفسها — نفس PID قبل وبعد", () => {
    expect(src).toContain("pidSameA");
    expect(src).toContain("pidSameB");
    expect(src).toContain("BACKENDS_TERMINATED_GATEWAY_SURVIVED");
    expect(src).toContain("PG_RESTART_RECOVERED_BUSINESS_CYCLE_COMPLETED");
    // الحكم المشروط لا يُختصر إلى النجاح دومًا — الفشل مسارٌ مسجلٌ
    expect(src).toMatch(/: "NOT_PROVEN"/);
  });

  test("التجربة (ب) تعيد PG بالأداة المصححة نفسها — لا استئناف يدوي", () => {
    expect(src).toContain("deploy/capacity-run/monitor/chaos.ts");
    expect(src).toContain('action: "pg_restart"');
    // لا pg_ctl مباشر في التجربة — الأداة وحدها تمتلك إعادة التشغيل
    expect(src).not.toMatch(/pg_ctl/);
  });

  test("الحكم يتطلب دورة أعمال مكتملة من القاعدة بلا تكرار", () => {
    expect(src).toMatch(/cycleB\.completed && pidSameB && cycleB\.orderCountForRider === 1/);
    expect(src).toMatch(/cycleA\.completed && pidSameA && cycleA\.orderCountForRider === 1/);
    expect(src).toContain('"no_completion_in_db"');
  });

  test("الترتيب مقيس: جاهزية PG قبل جاهزية البوابة", () => {
    expect(src).toContain("pgBeforeGateway");
    expect(src).toContain("monitor.pgReadyAt");
    expect(src).toContain("monitor.gatewayReadyAt");
    expect(src).toMatch(/PG_RESTART_RECOVERED_BUSINESS_CYCLE_COMPLETED/);
  });

  test("الرقعة تُتحقق من وصولها للبناء فعلًا قبل التجربة", () => {
    expect(src).toContain("patchReachesBuild");
    expect(src).toContain("patchedDependencies");
    expect(src).toContain("node_modules/postgres/src/connection.js");
  });

  test("سجل البوابة يُفحص على انهيار غير ملتقط", () => {
    expect(src).toContain("uncaughtException");
    expect(src).toContain("unhandledRejection");
  });

  test("لا معاملات عالقة بعد التعافي — فحوصات مقيسة لا ادعاء", () => {
    expect(src).toContain("idle in transaction");
    expect(src).toContain("jobsClaimedStuckOver60s");
    expect(src).toContain("outboxSendingStuckOver5m");
  });
});
