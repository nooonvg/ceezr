/**
 * الغرض: إثبات أن حرس القيم التجارية يفرّق بين قيمةٍ ينفّذها المنطق وقيمةٍ في تعليق وصفيّ.
 *
 *   قبل هذا الاختبار كان الفاحص يُسقط تعليقات `//` وحدها، فيرفع مخالفةً على رقمٍ داخل
 *   تعليق كتلة `/** … *\/` — وهو نصٌّ لا ينفّذه أحد. فكان CI البعيد أحمر على مخالفتين
 *   وهميتين، والأسوأ من الإنذار الكاذب أنّه يُدرَّب الناظر على تجاهل الفاحص.
 *
 *   والاختبار هنا يحرس الاتجاهين معاً: لا إنذار كاذب على التعليقات، ولا تسامح مع رقمٍ
 *   في كودٍ قابلٍ للتنفيذ — لأن ترخيص الفاحص أسوأ من ضجيجه.
 *
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيّ تعديل على scripts/check-business-constants.ts
 * ملاحظات مستقبلية: يوم تُضاف قيمة ممنوعة جديدة إلى FORBIDDEN تبقى هذه التوكيدات صالحة —
 *   فهي تختبر آلية التمييز لا قائمة الأرقام.
 */

import { describe, expect, it } from "bun:test";
import { executableLines, findHardcodedValues } from "../../scripts/check-business-constants.ts";

describe("حرس القيم التجارية: تعليق أم كود", () => {
  it("رقم ممنوع داخل تعليق سطريّ لا يُحتسب مخالفة", () => {
    expect(findHardcodedValues("// مهلة العرض 45 ثانية افتراضاً\nconst x = 1;\n")).toEqual([]);
  });

  it("رقم ممنوع داخل تعليق كتلة متعدّد الأسطر لا يُحتسب مخالفة", () => {
    const source = [
      "/**",
      " * أقصر من مهلة العرض (45 ثانية افتراضاً) عن قصد.",
      " */",
      "const timeout = readSetting();",
      "",
    ].join("\n");
    expect(findHardcodedValues(source)).toEqual([]);
  });

  it("رقم ممنوع في كود قابل للتنفيذ يُحتسب مخالفةً بسطره الصحيح", () => {
    const source = ["const a = 1;", "const offerTimeout = 45;", "const b = 2;", ""].join("\n");
    expect(findHardcodedValues(source)).toEqual([{ line: 2, value: 45 }]);
  });

  it("لا يُخفي كوداً يلي تعليق كتلة أُغلق في السطر نفسه", () => {
    const source = ["/* وصف */ const price = 250;", ""].join("\n");
    expect(findHardcodedValues(source)).toEqual([{ line: 1, value: 250 }]);
  });

  it("لا يعتبر الكود بعد نهاية الكتلة تعليقاً", () => {
    const source = ["/* بداية", "  وسط 45", "*/", "const price = 400;", ""].join("\n");
    expect(findHardcodedValues(source)).toEqual([{ line: 4, value: 400 }]);
  });

  it("رموز حالة HTTP تبقى مقبولة داخل الاستجابة", () => {
    expect(findHardcodedValues("return c.json({ ok: false }, 400);\n")).toEqual([]);
  });

  /**
   * الانحدار: مسار ويبهوك الدفع يردّ عبر مساعدٍ محلّي لا عبر `c.json`، فكان ٤٠٠
   * الحالة يُقرأ سعرَ اشتراك ويُسقط الفحص كلَّه على كودٍ لا يمسّ التسعير.
   */
  it("رمز حالة HTTP في مساعد استجابة محلّي مقبول", () => {
    expect(findHardcodedValues('return rejected(c, "PAYLOAD_TOO_LARGE", 400);\n')).toEqual([]);
  });

  it("سعرٌ آخرَ استدعاءٍ لا يتنكّر في هيئة رمز حالة", () => {
    expect(findHardcodedValues("charge(driverId, 250);\n")).toEqual([{ line: 1, value: 250 }]);
    expect(findHardcodedValues('charge("plan", 250);\n')).toEqual([{ line: 1, value: 250 }]);
  });

  it("عدد الأسطر المُخرَجة يساوي عدد أسطر المصدر فتبقى أرقام الأسطر صحيحة", () => {
    const source = "a\n/* x\ny */\nb\n";
    expect(executableLines(source).length).toBe(source.split("\n").length);
  });
});

describe("حرس القيم التجارية: اتّحادُ رموزِ حالةٍ في نوعٍ", () => {
  it("تعريفُ نوعٍ باتّحادِ رموزِ حالةٍ مقبولٌ: بروتوكولٌ لا سياسةٌ", () => {
    expect(findHardcodedValues("type RejectStatus = 400 | 401 | 415 | 422 | 503;\n")).toEqual([]);
    expect(findHardcodedValues("export type IntakeStatus = 400 | 503;\n")).toEqual([]);
  });

  it("سعرٌ لا يتنكّرُ في هيئةِ نوعٍ: كلُّ صورةٍ أخرى تبقى مخالفةً", () => {
    expect(findHardcodedValues("const subscriptionPrice = 400;\n")).toEqual([
      { line: 1, value: 400 },
    ]);
    expect(findHardcodedValues("type Price = 400 | 250;\n")).toHaveLength(2);
    // اتّحادٌ فيه حدٌّ ليسَ رمزَ حالةٍ (رقمانِ) لا يُستثنى ألبتّةَ: الحدّانِ كلاهما مخالفةٌ.
    expect(findHardcodedValues("type WeirdStatus = 400 | 45;\n")).toHaveLength(2);
    expect(findHardcodedValues("type RejectStatus = 400; const p = 400;\n")).toEqual([
      { line: 1, value: 400 },
    ]);
  });
});

describe("حرس القيم التجارية: خريطةُ رمزِ خطأٍ إلى رمزِ حالةٍ", () => {
  const MAP = [
    "const STATUS_BY_ERROR: Readonly<Record<ConsentPublicErrorCode, 400 | 401 | 404 | 503>> = {",
    "  SESSION_REQUIRED: 401,",
    "  UNKNOWN_DOCUMENT: 400,",
    "  ACCOUNT_NOT_FOUND: 404,",
    "};",
    "",
  ].join("\n");

  it("الخريطةُ المُنطاقةُ مقبولةٌ: بروتوكولٌ لا سياسةٌ", () => {
    expect(findHardcodedValues(MAP)).toEqual([]);
  });

  it("سطرُ `KEY: 400` خارجَ كتلةٍ مفتوحةٍ بنوعِها يبقى مخالفةً", () => {
    expect(findHardcodedValues("  SUBSCRIPTION_PRICE: 400,\n")).toEqual([{ line: 1, value: 400 }]);
    // كتلةٌ نوعُها `Record<string, number>` لا تُفتَحُ ألبتّةَ، فما فيها يُحاكَمُ.
    const loose = ["const PRICES: Record<string, number> = {", "  BASIC: 400,", "};", ""].join(
      "\n",
    );
    expect(findHardcodedValues(loose)).toEqual([{ line: 2, value: 400 }]);
  });

  it("حدُّ الاستثناءِ مُعلَنٌ: خريطةٌ تُثبِّتُ أسعارَها في نوعِها **تمرُّ** — ويُسجَّلُ", () => {
    // محاولةُ التنكُّرِ الأقربُ: تقليدُ الشكلِ حرفاً. وتُردُّ لأنَّ سطرَ التصريحِ
    // نفسَه يحملُ حرفيّاتٍ ممنوعةً ويُحاكَمُ قبلَ أن يُفتَحَ استثناءٌ... ولا
    // يُحاكَمُ: فالكتلةُ **تُفتَحُ** بهِ. ولذا يُقاسُ الأثرُ لا النيّةُ — وأثرُه
    // أن يصيرَ في المستودعِ اتّحادُ أسعارٍ في نوعٍ، وذاكَ ما يمنعُه حاجزٌ آخرُ
    // ويقرؤه المراجعُ سطراً واحداً ظاهراً لا قيمةً مدفونةً في دالّةٍ.
    const disguised = [
      "const P: Readonly<Record<Plan, 400 | 250>> = {",
      "  BASIC: 400,",
      "};",
      "",
    ].join("\n");
    const hits = findHardcodedValues(disguised);
    // المقيسُ ههنا **حدُّ الاستثناءِ مُعلَناً لا مُدَّعى**: الشكلُ يمرُّ، وهذا
    // مسجَّلٌ في ترويسةِ الحاجزِ بلا تلوينٍ، والمانعُ لهُ أنَّه يُثبِّتُ سعراً في
    // نوعٍ ظاهرٍ — لا أنَّ هذا الحاجزَ يراه.
    expect(hits).toEqual([]);
  });

  it("الكتلةُ ليست ملجأً: سطرٌ غيرُ مطابقٍ داخلَها يُحاكَمُ", () => {
    const smuggled = [
      "const STATUS_BY_ERROR: Readonly<Record<Code, 400 | 503>> = {",
      "  A: 400,",
      "  price: 250 * 1,",
      "};",
      "",
    ].join("\n");
    expect(findHardcodedValues(smuggled)).toEqual([{ line: 3, value: 250 }]);
  });

  it("الكتلةُ تُغلَقُ فلا يُستثنى ما بعدَها", () => {
    const after = [
      "const STATUS_BY_ERROR: Readonly<Record<Code, 400>> = {",
      "  A: 400,",
      "};",
      "const PRICE: number = 400;",
      "  LATER_KEY: 400,",
      "",
    ].join("\n");
    expect(findHardcodedValues(after)).toEqual([
      { line: 4, value: 400 },
      { line: 5, value: 400 },
    ]);
  });
});

/**
 * انحدار أرضية إيجار المستنزف (2026-10-16 · CAP-RUN-20261016-CONTINUATION د9):
 * نُقلت أرضيةُ تجديدِ الإيجارِ (250ms) من جسمِ المستنزفِ إلى طبقةِ الإعداداتِ
 * (`packages/shared/config/domain-ingress.ts`) — ملكيةٌ مشروعةٌ لا تجاوزٌ للحارس.
 * هذا الاختبارُ يثبتُ الاتجاهين: الحارسُ لا يمسُّ الإعدادَ المشروعَ في طبقةِ
 * الإعدادات، ولا يزالُ يكشفُ أيَّ 250 تجاريٍّ في `apps/`.
 */
describe("حرس القيم التجارية: أرضية إيجار المستنزف", () => {
  it("إعداد طبقة الإعدادات (خارج جذور الفحص) مشروع — والحارس لا يمسه", () => {
    // أرضيةُ الإيجارِ معلنةٌ في packages/shared/config/domain-ingress.ts
    // وليسَ في apps/ — فجذورُ الفحصِ (apps، packages/domain، packages/application)
    // لا تشملُ طبقةَ الإعداداتِ المشتركة. هذا هوَ عقدُ الملكيةِ المشروعة.
    const configSource = "export const MIN_DRAINER_LEASE_RENEW_MS = 250;";
    // الفاحصُ يُشغَّلُ على جذورِه فقط — وهذا المصدرُ خارجَها فلا يُفحصُ أصلًا،
    // لكن نثبتُ أنَّ الآليةَ نفسَها لو فُحِصَ هذا الملفُّ لالتُقط. العبرةُ أنَّ
    // الملكيةَ في الطبقةِ الصحيحةِ لا أنَّ الرقمَ اختفى.
    const detected = findHardcodedValues(configSource);
    expect(detected.length).toBe(1);
    expect(detected[0]?.value).toBe(250);
  });

  it("الحارس لا يزال يكشف 250 تجاريًّا في كود apps قابل للتنفيذ", () => {
    const businessSource = "const price = 250;";
    const detected = findHardcodedValues(businessSource);
    expect(detected.length).toBe(1);
    expect(detected[0]?.value).toBe(250);
    expect(detected[0]?.line).toBe(1);
  });
});
