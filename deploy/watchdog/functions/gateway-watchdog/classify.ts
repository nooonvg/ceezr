// تصنيفُ سببِ التوقّفِ وإيقاعُ تكرارِ التنبيه — منطقٌ خالصٌ بلا Deno ولا شبكة، فيُختبَرُ من `tests/unit`.
//
// لماذا (OPS-ALERT-02، 2026-10-13): أوقفَ Render الخدماتِ لتجاوزِ حصّةِ البياناتِ الشهريّة (Monthly Quota
// Exceeded)، فصارَ `/ready` يُعيدُ صفحةَ «Service Suspended» بـ503. والمراقبُ يُكرِّرُ تنبيهَ «متوقّفة» كلَّ دقيقة:
// 292 رسالةَ Telegram في أوّلِ خمسِ ساعات، ونحوُ 26 ألفًا حتّى بدايةِ الشهر. هذا الإيقافُ لا يزولُ وحدَه ولا
// بإعادةِ تشغيل، بل بإجراءٍ من المالكِ في لوحةِ Render، فالتنبيهُ كلَّ دقيقةٍ ضجيجٌ يُغرِقُ أيَّ تنبيهٍ آخر.
// الإصلاح: سببٌ مستقلٌّ `suspended` يُنبَّهُ عنه فورًا، ثمّ كلَّ ساعةٍ في Telegram وكلَّ ستِّ ساعاتٍ في البريد.
// وكلُّ توقّفٍ آخرَ (لا ردّ، 5xx من التطبيق، `failedChecks`) يبقى على إيقاعِه في `ops.watchdog_config`.

export type DownCause = "suspended" | "other";

/** صفحةُ Render للخدمةِ الموقوفة: 503 وعنوانُها «Service Suspended». */
const SUSPENDED_TITLE = /<title>\s*Service Suspended\s*<\/title>/i;

export function classifyDown(httpStatus: number | null, body: string): DownCause {
  return httpStatus === 503 && SUSPENDED_TITLE.test(body) ? "suspended" : "other";
}

export const SUSPENDED_TG_EVERY_S = 3600;
export const SUSPENDED_EMAIL_EVERY_S = 6 * 3600;

export interface RepeatConfig {
  down_tg_every_s: number;
  down_email_every_s: number;
}

/** فاصلُ تكرارِ تنبيهِ «متوقّفة» بالثواني. الإيقافُ لا يُنبَّهُ عنه أسرعَ ممّا في الإعداد إن كانَ الإعدادُ أبطأ. */
export function downRepeatSeconds(
  cause: DownCause,
  cfg: RepeatConfig,
): { tg: number; email: number } {
  if (cause === "suspended")
    return {
      tg: Math.max(cfg.down_tg_every_s, SUSPENDED_TG_EVERY_S),
      email: Math.max(cfg.down_email_every_s, SUSPENDED_EMAIL_EVERY_S),
    };
  return { tg: cfg.down_tg_every_s, email: cfg.down_email_every_s };
}

/** تفصيلُ الفحصِ المحفوظُ والمعروضُ في التنبيه: لا يُلصَقُ HTML صفحةِ الإيقافِ في رسالةِ Telegram. */
export function downDetail(httpStatus: number | null, body: string): string {
  if (classifyDown(httpStatus, body) === "suspended") return "HTTP 503 Render: Service Suspended";
  return `HTTP ${httpStatus} ${body.slice(0, 200)}`;
}
