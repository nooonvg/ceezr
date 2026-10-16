import { describe, expect, test } from "bun:test";
import {
  collapseDigitRuns,
  nextUpdateId,
} from "../../deploy/capacity-run/load/driver-onboarding.ts";
import { signedInitData } from "../../deploy/capacity-run/load/lib.ts";
import {
  COMMAND_HOMES,
  LEGACY_DIALOG_STEP_COMMANDS,
  OWNER_OPS_COMMANDS,
} from "../../packages/application/bots/miniapp-surface.ts";

/**
 * اختبارات سلوكية للانحدارات الثلاث التي شُخصت أثناء إثبات المرحلة 1 — كلها
 * كانت أعطابَ أداةِ الحملِ أمامَ سلوكٍ صحيحٍ للمنتجِ، فالعقد هنا يثبت أن الأداة
 * تحترم المنتج ولا تتحايل عليه:
 *
 * ١. `parseFullName` يرفض تكرار محرف متتالٍ (4+) كعبثٍ — أسماء المولّد تُطهَّر.
 * ٢. الـwebhook يتجاهل التحديثَ المكررَ (duplicate_ignored) — معرّفات البطاقات
 *    فريدة متزايدة فلا تتصادم داخل الثانية.
 * ٣. حارس إعادة استعمال initData (`SEC-17`) يرفض initData المتطابقة — جلسةُ
 *    التسجيلِ تميّز initData (start_param) عن جلسةِ العملِ فلا يصطدم الحارسُ.
 */

describe("انحدارات أداة الحمل الثلاث — سلوك لا نص", () => {
  test("تطهير الاسم: تكرار 4+ محارف متتالية يُطوى إلى 3 (parseFullName يرفضه كعبث)", () => {
    // "10500001" فيها "0000" — كانت تُرفض بـNAME_LOOKS_LIKE_GIBBERISH
    expect(collapseDigitRuns("10500001")).toBe("1050001");
    // "7300001" فيها "0000" كذلك
    expect(collapseDigitRuns("7300001")).toBe("730001");
    // ثلاثة تكرارات متتالية اسمٌ مقبول — لا يُمس
    expect(collapseDigitRuns("10500011")).toBe("10500011");
    // لا تكرار — لا تغيير
    expect(collapseDigitRuns("123456")).toBe("123456");
    // سلسلة كاملة من محرف واحد تُطوى إلى ثلاثة
    expect(collapseDigitRuns("111111")).toBe("111");
  });

  test("معرّف التحديث فريد متزايد — بطاقتان في الثانية نفسها لا تتصادمان (duplicate_ignored)", () => {
    const ids = new Set<number>();
    for (let i = 0; i < 1000; i += 1) ids.add(nextUpdateId());
    expect(ids.size).toBe(1000);
    // متزايد رياضيًا (بلا لفّ الحلقة داخل الدفعة)
    const a = nextUpdateId();
    const b = nextUpdateId();
    expect(b).toBe((a + 1) % 2_000_000_000);
  });

  test("initData جلسة التسجيل تميّزها عن جلسة العمل — حارس SEC-17 لا يرى المتطابقة", () => {
    const base = { botToken: "test-token", telegramId: 10500001 };
    const onboard = signedInitData({ ...base, startParam: "onboard" });
    const business = signedInitData(base);
    // متطابقة المُدخل ما عدا التمييز → initData مختلفة فلا رفض إعادة استعمال
    expect(onboard).not.toBe(business);
    expect(onboard).toContain("start_param=onboard");
    expect(business).not.toContain("start_param");
    // نفس الوسائط تُنتج نفس التوقيع (حتمية التوقيع محفوظة)
    expect(signedInitData({ ...base, startParam: "onboard" })).toBe(onboard);
  });
});

describe("جرد الأوامر: التصنيف سلوك مغلق — أمر غير مصنف يُرفض", () => {
  const isClassified = (audience: "rider" | "driver", command: string): boolean =>
    command in COMMAND_HOMES[audience] ||
    LEGACY_DIALOG_STEP_COMMANDS[audience].has(command) ||
    OWNER_OPS_COMMANDS.has(command);

  test("كل أوامر الحوار الحقيقية مصنفة", () => {
    for (const command of ["/start", "/city", "/skip", "/cancel", "/activate", "/flag"]) {
      expect(isClassified("rider", command) || isClassified("driver", command)).toBe(true);
    }
  });

  test("أمر جديد غير مصنف يُرفض — هذا هو المانع لا القائمة اليدوية", () => {
    expect(isClassified("rider", "/newbusiness")).toBe(false);
    expect(isClassified("driver", "/newbusiness")).toBe(false);
  });
});
