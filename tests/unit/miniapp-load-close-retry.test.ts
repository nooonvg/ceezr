import { describe, expect, test } from "bun:test";
import {
  acceptRetryBackoffMs,
  acceptRetryDecision,
  boundedDeadline,
} from "../../deploy/capacity-run/load/miniapp-load.ts";

/**
 * اختباراتُ عقدِ القياسِ (`LOAD-01`) — الدوالُ النقيةُ الجديدةُ:
 *
 * ١. **حدُّ الإغلاقِ الصارمُ:** كلُّ انتظارٍ يُحدُّ بأقربِ مهلةٍ ذاتيةٍ أو
 *    موعدِ إغلاقِ المرحلةِ — فلا انتظارَ بلا سقفٍ بعدَ نهايةِ الحقنِ.
 * ٢. **سياسةُ إعادةِ محاولةِ القبولِ عندَ 409:** تُعادُ المحاولةُ فقط للقفلِ
 *    العابرِ (طلبٌ `searching` وعرضٌ `pending`) ضمنَ عددٍ وميزانيةٍ؛ والتعارضُ
 *    النهائيُّ وما ليسَ 409 عابرًا قرارٌ نهائيٌّ لا يتحولُ نجاحًا ولا يُعادُ
 *    بلا سقفٍ. هذا عقدُ الجولةِ التشخيصيةِ: `OFFER_TAKEN` ثبتَ أنها تزاحمُ
 *    قفلٍ لحظيٌّ (`for update skip locked`) لا خسارةَ سباقٍ حقيقيةٍ.
 * ٣. **التأخيرُ التدريجيُّ:** محدودُ السقفِ ومعهُ jitter — لا تأخيرَ ثابتًا
 *    يزامنُ الطلباتِ المتزاحمةَ.
 */

describe("حد الإغلاق — كل انتظار محدود بأقرب الأجلين", () => {
  test("موعد الإغلاق أبكر من المهلة الذاتية يحكم", () => {
    expect(boundedDeadline(121_000, 31_000)).toBe(31_000);
  });
  test("المهلة الذاتية الأقرب تحكم عندما الإغلاق بعيد", () => {
    expect(boundedDeadline(31_000, 301_000)).toBe(31_000);
  });
});

describe("قرار إعادة محاولة القبول — 409 العابر فقط يُعاد ضمن الحدود", () => {
  const opts = { max: 3, budgetMs: 15_000 };
  const transient = {
    httpStatus: 409,
    code: "OFFER_TAKEN",
    orderStatus: "searching",
    offerStatus: "pending",
  };

  test("409 عابر والطلب searching والعرض pending = إعادة محاولة", () => {
    const d = acceptRetryDecision({ ...transient, attempt: 1, elapsedMs: 100 }, opts);
    expect(d.retry).toBe(true);
  });

  test("ORDER_NOT_CLAIMABLE العابرة تصنف مثل OFFER_TAKEN (نفس جذر القفل)", () => {
    const d = acceptRetryDecision(
      { ...transient, code: "ORDER_NOT_CLAIMABLE", attempt: 1, elapsedMs: 100 },
      opts,
    );
    expect(d.retry).toBe(true);
  });

  test("الطلب لم يعد searching = تعارض نهائي لا يُعاد", () => {
    const d = acceptRetryDecision(
      { ...transient, orderStatus: "matched", attempt: 1, elapsedMs: 100 },
      opts,
    );
    expect(d.retry).toBe(false);
    expect(d.final).toBe("conflict_final");
  });

  test("العرض لم يعد pending = تعارض نهائي لا يُعاد", () => {
    const d = acceptRetryDecision(
      { ...transient, offerStatus: "expired", attempt: 1, elapsedMs: 100 },
      opts,
    );
    expect(d.retry).toBe(false);
    expect(d.final).toBe("conflict_final");
  });

  test("استنفاد عدد المحاولات = قرار نهائي مسمى", () => {
    const d = acceptRetryDecision({ ...transient, attempt: 3, elapsedMs: 100 }, opts);
    expect(d.retry).toBe(false);
    expect(d.final).toBe("attempts_exhausted");
  });

  test("استنفاد الميزانية الزمنية = قرار نهائي مسمى", () => {
    const d = acceptRetryDecision({ ...transient, attempt: 1, elapsedMs: 15_000 }, opts);
    expect(d.retry).toBe(false);
    expect(d.final).toBe("budget_exhausted");
  });

  test("ليس 409 (429 أو 5xx أو رفض منطقي) = لا إعادة ضمن هذه السياسة", () => {
    for (const httpStatus of [429, 500, 400]) {
      const d = acceptRetryDecision({ ...transient, httpStatus, attempt: 1, elapsedMs: 100 }, opts);
      expect(d.retry).toBe(false);
      expect(d.final).toBe("non_transient");
    }
  });

  test("رمز غير عابر داخل 409 = لا إعادة", () => {
    const d = acceptRetryDecision(
      { ...transient, code: "DRIVER_HAS_ACTIVE_ORDER", attempt: 1, elapsedMs: 100 },
      opts,
    );
    expect(d.retry).toBe(false);
    expect(d.final).toBe("non_transient");
  });
});

describe("التأخير التدريجي — محدود السقف ومع jitter", () => {
  test("يتضاعف تقريبيًا ولا يتجاوز سقف المحاولة الثالثة", () => {
    const b1 = acceptRetryBackoffMs(1);
    const b2 = acceptRetryBackoffMs(2);
    const b3 = acceptRetryBackoffMs(3);
    expect(b1).toBeGreaterThanOrEqual(250);
    expect(b1).toBeLessThan(500);
    expect(b2).toBeGreaterThanOrEqual(500);
    expect(b2).toBeLessThan(1000);
    expect(b3).toBeGreaterThanOrEqual(1000);
    expect(b3).toBeLessThan(2000);
  });
});
