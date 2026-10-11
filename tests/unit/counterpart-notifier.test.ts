/**
 * `WR-15` (§15) — إخطار الطرف المقابل لا يبتلع الفشل صامتًا: الفشل النهائي يُسجَّل حدثًا
 * بالبوت ونوع الخطأ وحدهما، ولا يُرفع إلى المستدعي (الرحلة محفوظة في القاعدة قبله).
 */
import { describe, expect, it } from "bun:test";
import type { TelegramSender } from "../../apps/gateway/src/bots/driver/index.ts";
import {
  counterpartNotifier,
  notifyErrorKind,
} from "../../apps/gateway/src/bots/shared/counterpart-notifier.ts";

function sender(behaviour: () => Promise<void>): TelegramSender {
  return { sendMessage: behaviour } as unknown as TelegramSender;
}

describe("WR-15 — counterpartNotifier", () => {
  it("النجاح يُسجَّل قبولًا من Telegram API بالبوت وحده", async () => {
    const events: unknown[] = [];
    const notifier = counterpartNotifier(
      sender(async () => {}),
      (event, meta) => events.push({ event, meta }),
      "rider",
    );
    await notifier.notify("123", "نص", null);
    expect(events).toEqual([{ event: "counterpart.notify_sent", meta: { bot: "rider" } }]);
  });

  it("الفشل النهائي يُسجَّل بلا معرّف تيليجرام ولا نص، ولا يُرفع", async () => {
    const events: { event: string; meta: Record<string, unknown> }[] = [];
    const notifier = counterpartNotifier(
      sender(async () => {
        throw Object.assign(new Error("Forbidden: bot was blocked by the user"), {
          error_code: 403,
        });
      }),
      (event, meta) => events.push({ event, meta }),
      "rider",
    );
    await expect(notifier.notify("987654321", "رسالة سرية", null)).resolves.toBeUndefined();
    expect(events).toEqual([
      { event: "counterpart.notify_failed", meta: { bot: "rider", error: "telegram_403" } },
    ]);
    expect(JSON.stringify(events)).not.toContain("987654321");
    expect(JSON.stringify(events)).not.toContain("رسالة سرية");
  });

  it("نوع الخطأ: رمز تيليجرام، ثم الاسم، ثم unknown", () => {
    expect(notifyErrorKind({ error_code: 429 })).toBe("telegram_429");
    expect(notifyErrorKind(new TypeError("fetch failed"))).toBe("TypeError");
    expect(notifyErrorKind("x")).toBe("unknown");
  });
});
