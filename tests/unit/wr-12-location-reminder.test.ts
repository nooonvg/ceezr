/**
 * الغرض: `WR-12` (ADR 0268) — معالجُ تذكيرِ السائقِ بتحديثِ موقعِه: يُرسلُ ببوتِ السائقِ
 *   نصًّا لا يدّعي بثًّا في الخلفيةِ، بزرِّ فتحِ وَصْلة وزرِّ «غير متوفر»، ويطوي ما لم يَعُد
 *   لازمًا، ولا يسجّلُ معرّفَ تيليجرام.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import {
  createLocationReminderHandler,
  LOCATION_REMINDER_OFF_CALLBACK,
  locationReminderText,
} from "../../packages/application/dispatch/deliver-location-reminder.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { t } from "../../packages/shared/i18n/index.ts";

const DRIVER = "7d1f2b3a-0c4e-4b5f-9a6d-1e2f3a4b5c6d";
const MINIAPP = "https://waslah-miniapp.onrender.com/";

function delivery(payload: Record<string, unknown>, attempts = 1): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "driver_location_reminder",
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    payload,
  };
}

const due = {
  driver_id: DRIVER,
  chat_id: "5550001",
  language: "ar",
  is_available: true,
  still_stale: true,
  minutes: 7,
};

function setup(opts: { result?: string | null | Error; url?: string | null } = {}) {
  const sent: { chatId: string; text: string; keyboard: Keyboard | null }[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const result = opts.result === undefined ? "m-1" : opts.result;
  const handler = createLocationReminderHandler({
    sender: {
      sendReturningId: async (chatId, text, keyboard) => {
        sent.push({ chatId, text, keyboard });
        if (result instanceof Error) throw result;
        return result;
      },
    },
    miniAppUrl: opts.url === undefined ? MINIAPP : opts.url,
    log: (event, meta) => logs.push({ event, meta }),
  });
  return { handler, sent, logs };
}

function buttons(keyboard: Keyboard | null) {
  if (keyboard === null || keyboard.kind !== "inline") return [];
  return keyboard.rows.flat();
}

describe("WR-12 — تذكيرُ تحديثِ الموقع", () => {
  test("سائقٌ متوفّرٌ بموقعٍ قديم ⇒ رسالةٌ بالدقائقِ وزرّا الفتحِ و«غير متوفر»", async () => {
    const { handler, sent } = setup();
    const out = await handler(delivery(due));
    expect(out.ok && out.value.messageId).toBe("m-1");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chatId).toBe("5550001");
    expect(sent[0]?.text).toContain("7");
    const bs = buttons(sent[0]?.keyboard ?? null);
    expect(bs.some((b) => "webAppUrl" in b && String(b.webAppUrl).startsWith(MINIAPP))).toBe(true);
    expect(bs.some((b) => "data" in b && b.data === LOCATION_REMINDER_OFF_CALLBACK)).toBe(true);
  });

  test("أوقفَ توافرَه قبلَ الإرسال ⇒ يُطوى بلا رسالة", async () => {
    const { handler, sent } = setup();
    const out = await handler(delivery({ ...due, is_available: false }));
    expect(sent).toHaveLength(0);
    expect(out.ok && out.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
  });

  test("وصلَ موقعٌ حديثٌ قبلَ الإرسال ⇒ يُطوى بلا رسالة", async () => {
    const { handler, sent } = setup();
    const out = await handler(delivery({ ...due, still_stale: false }));
    expect(sent).toHaveLength(0);
    expect(out.ok && out.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
  });

  test("لم يصل موقعٌ قطّ ⇒ نصُّ «لم يصلنا أي موقع»", async () => {
    const { handler, sent } = setup();
    await handler(delivery({ ...due, minutes: null }));
    expect(sent[0]?.text).toBe(t("ar")("driver.location_reminder_never"));
  });

  test("الوضعُ القديمُ بلا Mini App ⇒ زرُّ «غير متوفر» وحدَه", async () => {
    const { handler, sent } = setup({ url: null });
    await handler(delivery(due));
    const bs = buttons(sent[0]?.keyboard ?? null);
    expect(bs).toHaveLength(1);
    expect(bs[0] && "data" in bs[0] ? bs[0].data : null).toBe(LOCATION_REMINDER_OFF_CALLBACK);
  });

  test("بلا محادثة ⇒ غيرُ قابلٍ للتسليم، وبلا معرّفٍ صالح ⇒ تخلٍّ", async () => {
    const a = await setup().handler(delivery({ ...due, chat_id: null }));
    expect(a.ok && a.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
    const b = await setup().handler(delivery({ ...due, driver_id: "" }));
    expect(b.ok && b.value.abandon).toBe(true);
  });

  test("رفضُ تيليجرام أو استثناءٌ ⇒ فشلٌ يُعادُ، والأخيرُ final_failure", async () => {
    const r = await setup({ result: null }).handler(delivery(due));
    expect(r.ok && r.value.failure).toBe("TELEGRAM_REJECTED");
    const s = setup({ result: new TypeError("x") });
    const e = await s.handler(delivery(due, 3));
    expect(e.ok && e.value.failure).toBe("TypeError");
    expect(s.logs.some((l) => l.event === "driver_location_reminder.final_failure")).toBe(true);
  });

  test("السجلُّ بلا معرّفِ محادثة", async () => {
    const s = setup();
    await s.handler(delivery(due));
    expect(JSON.stringify(s.logs)).not.toContain("5550001");
  });

  test("النصُّ لا يدّعي أخذَ الموقعِ في الخلفية — في اللغاتِ الثلاث", () => {
    for (const lang of ["ar", "en", "ur"]) {
      const text = locationReminderText(5, lang);
      expect(text).toContain("5");
      expect(text).not.toContain("{minutes}");
    }
    expect(locationReminderText(5, "ar")).toContain("لا تأخذ موقعك وهي مغلقة");
    expect(locationReminderText(5, "en")).toContain("can't read your location while it's closed");
    expect(locationReminderText(0, "ar")).toContain("1");
  });
});
