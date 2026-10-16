import { describe, expect, test } from "bun:test";
import {
  type ConsumptionState,
  consumePage,
  type MockEvent,
} from "../../deploy/capacity-run/load/mock-events.ts";

/**
 * اختبارٌ سلوكيٌّ لاستهلاكِ أحداثِ محاكيِ تيليجرام (المرحلة 5ب) — لا اختبارُ
 * نصٍّ فقط: الدرسُ التاريخيُّ أنَّ قياسَ التأخيرِ كانَ يعيدُ قراءةَ كلِّ
 * التاريخِ (مؤشّرٌ لا يتقدّمُ) ثمّ يستبعدُ كلَّ عينةٍ أبطأَ منْ 60ث فيصفّرُ
 * نفسَهُ ويتحسّنُ زورًا.
 */

function ev(seq: number, ageSec: number, nowMs: number): MockEvent {
  return {
    seq,
    t: nowMs - ageSec * 1000,
    bot: "rider",
    method: "sendMessage",
    chat_id: "1",
    message_id: seq,
    status: 200,
  };
}

const NOW = 1_000_000_000_000;

function state(cursor: number): ConsumptionState {
  return { cursor, observed: 0, ageSumMs: 0, ageMaxMs: 0 };
}

describe("استهلاك أحداث المحاكي (سلوكي)", () => {
  test("الحدث الجديد يُحصى مرة واحدة والمؤشر يتقدم إلى آخر حدث مستهلك", () => {
    const s0 = state(10);
    const s1 = consumePage([ev(11, 2, NOW), ev(12, 3, NOW)], s0, NOW);
    expect(s1.observed).toBe(2);
    expect(s1.cursor).toBe(12);
    // الاستطلاع التالي لا يعيد نفس الأحداث: الاستهلاك من بعد المؤشر
    const s2 = consumePage([ev(13, 1, NOW)], s1, NOW);
    expect(s2.observed).toBe(3);
    expect(s2.cursor).toBe(13);
  });

  test("الصفحة الممتلئة لا تقفز إلى رأس السجل — يتقدم المؤشر إلى آخر صفحة فقط", () => {
    // 5000 حدث (حد الصفحة) ورأس السجل عند 9000: القفز إلى الرأس يتخطى
    // أحداثًا لم تُقرأ — المؤشر يجب أن يقف عند آخر حدث مستهلك فعلًا.
    const page = Array.from({ length: 5000 }, (_, i) => ev(i + 1, 1, NOW));
    const s1 = consumePage(page, state(0), NOW);
    expect(s1.cursor).toBe(5000);
    const rest = Array.from({ length: 1000 }, (_, i) => ev(5001 + i, 1, NOW));
    const s2 = consumePage(rest, s1, NOW);
    expect(s2.observed).toBe(6000);
    expect(s2.cursor).toBe(6000);
  });

  test("العينة الأبطأ من دقيقة تُحصى وتبقى في التوزيع — لا فلتر يستبعدها", () => {
    // هذا هو جوهر إصلاح القياس: عينة عمرها 95ث (تسليم متأخر) كانت تُستبعد
    // بالفلتر القديم فتتحسن المتوسطات زورًا — الآن تُحصى ويُرصد أقصاها.
    const s1 = consumePage([ev(1, 5, NOW), ev(2, 95, NOW), ev(3, 8, NOW)], state(0), NOW);
    expect(s1.observed).toBe(3);
    expect(s1.ageMaxMs).toBe(95_000);
    expect(s1.ageSumMs).toBe(108_000);
  });

  test("الأحداث التاريخية القديمة لا تُخلط بالمتوسط إن بدأ المؤشر من الذيل", () => {
    // خطوة الأساس (tail baseline) تعني أن الأحداث السابقة للجولة لا تُقرأ
    // أصلًا — الاستهلاك يبدأ من بعدها فلا يحرق المتوسط بدقائق لا معنى لها.
    const s1 = consumePage([ev(101, 1, NOW), ev(102, 2, NOW)], state(100), NOW);
    expect(s1.observed).toBe(2);
    expect(s1.ageSumMs).toBe(3000);
  });
});
