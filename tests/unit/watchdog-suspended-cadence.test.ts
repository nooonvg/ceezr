// OPS-ALERT-02: إيقافُ Render (Service Suspended) سببٌ مستقلٌّ يُنبَّهُ عنه كلَّ ساعةٍ لا كلَّ دقيقة.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  classifyDown,
  downDetail,
  downRepeatSeconds,
  SUSPENDED_EMAIL_EVERY_S,
  SUSPENDED_TG_EVERY_S,
} from "../../deploy/watchdog/functions/gateway-watchdog/classify.ts";

// مقتطفُ الصفحةِ كما وصلَت في تنبيهِ 2026-10-13 (HTTP 503 من waslah-gateway.onrender.com).
const RENDER_SUSPENDED = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Service Suspended</title>
</head>
<body>
This service has been suspended.`;
const CFG = { down_tg_every_s: 60, down_email_every_s: 600 };

describe("OPS-ALERT-02 — تصنيفُ سببِ التوقّف", () => {
  test("صفحةُ Render للإيقافِ بـ503 = suspended", () => {
    expect(classifyDown(503, RENDER_SUSPENDED)).toBe("suspended");
  });
  test("503 من التطبيقِ نفسِه (JSON) يبقى توقّفًا عاديًّا", () => {
    expect(classifyDown(503, '{"status":"not_ready","failedChecks":["db"]}')).toBe("other");
  });
  test("العنوانُ نفسُه بحالةٍ غيرِ 503 لا يُعَدُّ إيقافًا", () => {
    expect(classifyDown(200, RENDER_SUSPENDED)).toBe("other");
    expect(classifyDown(502, RENDER_SUSPENDED)).toBe("other");
    expect(classifyDown(null, "")).toBe("other");
  });
  test("التفصيلُ لا يحملُ HTML الصفحة", () => {
    expect(downDetail(503, RENDER_SUSPENDED)).toBe("HTTP 503 Render: Service Suspended");
    expect(downDetail(502, "Bad Gateway")).toBe("HTTP 502 Bad Gateway");
  });
});

describe("OPS-ALERT-02 — إيقاعُ التكرار", () => {
  test("الإيقافُ: Telegram كلَّ ساعة، والبريدُ كلَّ ستِّ ساعات", () => {
    expect(downRepeatSeconds("suspended", CFG)).toEqual({
      tg: SUSPENDED_TG_EVERY_S,
      email: SUSPENDED_EMAIL_EVERY_S,
    });
    expect(SUSPENDED_TG_EVERY_S).toBe(3600);
    expect(SUSPENDED_EMAIL_EVERY_S).toBe(21600);
  });
  test("التوقّفُ العاديُّ يبقى على إعدادِ ops.watchdog_config", () => {
    expect(downRepeatSeconds("other", CFG)).toEqual({ tg: 60, email: 600 });
  });
  test("إعدادٌ أبطأُ من الحدِّ يُحترَمُ في الإيقافِ أيضًا", () => {
    expect(
      downRepeatSeconds("suspended", { down_tg_every_s: 7200, down_email_every_s: 86400 }),
    ).toEqual({
      tg: 7200,
      email: 86400,
    });
  });
  // 18 يومًا من الإيقاف: كانَ ~25,920 رسالة، وصارَ 432.
  test("أثرُ 18 يومًا من الإيقاف", () => {
    const secs = 18 * 86400;
    expect(Math.ceil(secs / downRepeatSeconds("other", CFG).tg)).toBe(25920);
    expect(Math.ceil(secs / downRepeatSeconds("suspended", CFG).tg)).toBe(432);
  });
});

describe("OPS-ALERT-02 — الدالّةُ تستعملُ التصنيف", () => {
  const src = readFileSync("deploy/watchdog/functions/gateway-watchdog/index.ts", "utf8");
  test("الفحصُ يُصنِّفُ والتكرارُ يمرُّ بـdownRepeatSeconds", () => {
    expect(src).toContain('from "./classify.ts"');
    expect(src).toContain("cause: classifyDown(r.status, body)");
    expect(src).toContain("downRepeatSeconds(cause, cfg)");
    expect(src).toContain("every.tg - 5");
    expect(src).toContain("every.email - 5");
    expect(src).not.toContain("cfg.down_tg_every_s - 5");
  });
});
