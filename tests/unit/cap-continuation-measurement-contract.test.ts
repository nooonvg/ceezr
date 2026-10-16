import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * عقد أدوات قياس المرحلة 5 (خارطة استكمال CAP-RUN-20261016-CONTINUATION).
 *
 * درسا جولة CAP-RUN-20261016: (أ) تجاربُ العزلِ كانت تُحكمُ بنافذةِ زمنٍ لا
 * بمعرّفِ ارتباطٍ — فتُخلطُ نتائجُ الجولاتِ وتُقبلُ النتيجةُ الفارغةُ دليلًا؛
 * (ب) قياسُ تأخيرِ الإشعاراتِ كانَ يخلطُ بروتوكولَ المحاكي (`since`/`cursor`
 * بدلَ `after`/`seq`) فيعيدُ قراءةَ كلِّ التاريخِ في كلِّ استطلاعٍ، ثمّ يستبعدُ
 * كلَّ عينةٍ أبطأَ منْ 60ث — فيصفّرُ نفسَهُ ويتحسّنُ زورًا.
 *
 * العقدان: حكمُ التجربةِ منَ القاعدةِ مقيدًا بكتلةِ هوياتٍ فريدةٍ لكلِّ
 * تجربةٍ (لا نافذةَ زمنٍ مفتوحة)، وقياسُ التأخيرِ منَ صندوقِ الصادرِ
 * (delivered_at − created_at) بتوزيعٍ كاملٍ بلا فلترٍ يحيدُه.
 */

const TELEGRAM_LOAD_TS = "deploy/capacity-run/load/telegram-load.ts";
const ISOLATE_TS = "deploy/capacity-run/load/isolate.ts";

function sourceOf(path: string): string {
  return readFileSync(path, "utf8");
}

describe("عقد قياس تأخير الإشعارات (telegram-load)", () => {
  const src = sourceOf(TELEGRAM_LOAD_TS);

  test("يستخدم بروتوكول المحاكي الصحيح: after وseq لا since وcursor", () => {
    // الخلط التاريخي: `?since=` يُتجاهله المحاكي (يقبل `after` فقط) و`body.cursor`
    // غير موجود (الرد يحمل `seq`) — فيعيد كل الاستطلاعات التاريخ كله.
    expect(src).toContain("/events?after=");
    expect(src).not.toContain("?since=");
    expect(src).not.toContain("body.cursor");
    expect(src).toContain("body.seq");
  });

  test("المؤشر يبدأ من ذيل السجل الحالي لا من الصفر", () => {
    expect(src).toContain("/health");
    expect(src).toContain("tailKnown");
    expect(src).toContain("inbox.tail_baseline");
  });

  test("لا فلتر ≤60ث يستبعد العينات البطيئة", () => {
    expect(src).not.toContain("notificationLatencyFresh");
    expect(src).not.toContain("60_000");
  });

  test("تأخير التسليم يُقاس من القاعدة بتوزيع كامل (p50/p95/max)", () => {
    expect(src).toContain("outboxLatency");
    expect(src).toContain("delivered_at - created_at");
    expect(src).toContain("percentile_disc(0.5)");
    expect(src).toContain("percentile_disc(0.95)");
    expect(src).toContain("outboxDeliveryLatency");
  });

  test("يميز عمر الحدث عند الرصد عن زمن التسليم", () => {
    expect(src).toContain("observationAgeMaxMs");
    expect(src).toContain("ليسَ تأخيرَ تسليمٍ");
  });
});

describe("عقد تجارب العزل (isolate)", () => {
  const src = sourceOf(ISOLATE_TS);

  test("كل تجربة تملك كتلة هويات فريدة تُمرر للمولد", () => {
    expect(src).toContain("RIDER_SEQ_START");
    expect(src).toContain("DRIVER_SEQ_START");
    expect(src).toContain("riderBlock");
    expect(src).toContain("driverBlock");
  });

  test("الحكم من القاعدة مقيد بكتلة الهويات لا بنافذة زمن مفتوحة", () => {
    expect(src).toMatch(/u\.telegram_id between \$\{riderLo\} and \$\{riderHi\}/);
    expect(src).not.toContain("audit_log al");
  });

  test("الربط الصحيح للراكب: riders ثم users لا users مباشرة", () => {
    // orders.rider_id يشير إلى riders.id — الربط المباشر بـ users يُرجع صفرًا
    // دائمًا فيبدو الناجحُ فارغًا (خطأ اكتُشف في جولة القياس الأولى).
    expect(src).toMatch(
      /join riders rd on rd\.id = o\.rider_id[\s\S]*?join users u on u\.id = rd\.user_id/,
    );
    expect(src).not.toMatch(/join users u on u\.id = o\.rider_id/);
  });

  test("الربط الصحيح للسائق في تعارضات I1: drivers ثم users", () => {
    // orders.assigned_driver_id يشير إلى drivers.id لا users.id.
    expect(src).toMatch(
      /from drivers dd[\s\S]*?join users du on du\.id = dd\.user_id[\s\S]*?where dd\.id = o\.assigned_driver_id/,
    );
  });

  test("النتيجة الفارغة ترفض صراحة لا أن تُقبل دليلًا", () => {
    expect(src).toContain("EMPTY_INVALID_PROOF");
    expect(src).toContain("NONEMPTY_DB_VERIFIED");
  });

  test("تجربة تعطيل تيليجرام توقف المحاكي وتعيده فعليًا", () => {
    expect(src).toContain('spec.name === "A-with-telegram-down"');
    expect(src).toContain('runSvc("stop-mock")');
    expect(src).toContain('runSvc("mock")');
  });

  test("إحصاء صندوق الصادر خلال نافذة التجربة يُسجل مع الحكم", () => {
    expect(src).toContain("outboxWindow");
    expect(src).toMatch(/created_at >= \$\{startedAt\}/);
  });

  test("جاهزية التجربة تُفحص قبل بدئها (مدن فاعلة وعمق الطابور)", () => {
    expect(src).toContain("experiment.readiness");
    expect(src).toContain("NOT_PROVEN_NO_ACTIVE_CITY");
    expect(src).toContain("inboundQueueDepth");
  });
});
