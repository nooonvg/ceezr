/**
 * الغرض: `WR-04` (ADR 0267) — معالجُ تنبيهِ رسالةِ المحادثةِ الجديدة: يُرسِلُ ببوتِ المستقبِل
 *   نصًّا بلا محتوى الرسالةِ وزرَّ فتحِ الطلب، ويطوي المقروءَ وما انتهت رحلتُه، ولا يسجّلُ
 *   معرّفَ تيليجرام ولا نصًّا.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import {
  chatMessageNoticeText,
  createChatMessageNoticeHandler,
} from "../../packages/application/dispatch/deliver-chat-message-notice.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const MINIAPP = "https://waslah-miniapp.onrender.com/";

function delivery(payload: Record<string, unknown>, attempts = 1): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "order_chat_message",
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    payload,
  };
}

function recorder(result: string | null | Error = "m-1") {
  const sent: { chatId: string; text: string; keyboard: Keyboard | null }[] = [];
  return {
    sent,
    sender: {
      sendReturningId: async (chatId: string, text: string, keyboard: Keyboard | null) => {
        sent.push({ chatId, text, keyboard });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

function setup(
  opts: { rider?: string | null | Error; driver?: string | null | Error; url?: string | null } = {},
) {
  const rider = recorder(opts.rider);
  const driver = recorder(opts.driver);
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const handler = createChatMessageNoticeHandler({
    riderSender: rider.sender,
    driverSender: driver.sender,
    miniAppUrl: opts.url === undefined ? MINIAPP : opts.url,
    log: (event, meta) => logs.push({ event, meta }),
  });
  return { handler, rider, driver, logs };
}

const LIVE = {
  order_id: ORDER,
  recipient_role: "driver",
  sender_role: "rider",
  seq: 7,
  chat_id: "555",
  language: "ar",
  order_status: "matched",
  read: false,
};

describe("WR-04 — تنبيهُ رسالةِ المحادثةِ الجديدة", () => {
  test("النصُّ يذكرُ المرسِلَ والطلبَ المختصرَ، وبثلاثِ لغاتٍ بلا مفتاحٍ خام", () => {
    for (const lang of ["ar", "en", "ur"]) {
      for (const role of ["rider", "driver"] as const) {
        const text = chatMessageNoticeText(role, ORDER, lang);
        expect(text).toContain("#5c6a72c2");
        expect(text).not.toContain("chat.new_message");
      }
    }
    expect(chatMessageNoticeText("rider", ORDER, "ar")).toContain("السائق");
    expect(chatMessageNoticeText("driver", ORDER, "ar")).toContain("العميل");
  });

  test("المستقبِلُ السائقُ ⇒ بوتُ السائقِ بزرِّ «الرحلة»، ولا يُمَسُّ بوتُ الراكب", async () => {
    const { handler, rider, driver, logs } = setup();
    const result = await handler(delivery(LIVE));
    expect(result.ok && result.value.messageId).toBe("m-1");
    expect(rider.sent).toHaveLength(0);
    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0]?.chatId).toBe("555");
    expect(JSON.stringify(driver.sent[0]?.keyboard)).toContain("open=job");
    expect(logs.map((l) => l.event)).toEqual([
      "order_chat_notice.attempted",
      "order_chat_notice.accepted",
    ]);
    // لا معرّفَ تيليجرام ولا نصَّ في السجلّ.
    expect(JSON.stringify(logs)).not.toContain("555");
    expect(JSON.stringify(logs)).not.toContain("رسالة");
  });

  test("المستقبِلُ الراكبُ ⇒ بوتُ الراكبِ بزرٍّ يفتحُ هذا الطلبَ بعينِه", async () => {
    const { handler, rider, driver } = setup();
    await handler(delivery({ ...LIVE, recipient_role: "rider", sender_role: "driver" }));
    expect(driver.sent).toHaveLength(0);
    expect(rider.sent).toHaveLength(1);
    expect(JSON.stringify(rider.sent[0]?.keyboard)).toContain(ORDER);
  });

  test("قرأَها داخلَ Mini App قبلَ الموعد ⇒ يُطوى `TELEGRAM_DELIVERY_NOT_REQUIRED` بلا إرسال", async () => {
    const { handler, driver } = setup();
    const result = await handler(delivery({ ...LIVE, read: true }));
    expect(driver.sent).toHaveLength(0);
    expect(result.ok && result.value).toMatchObject({
      undeliverable: true,
      undeliverableReason: "TELEGRAM_DELIVERY_NOT_REQUIRED",
    });
  });

  test("الرحلةُ انتهت أو أُلغيت قبلَ الموعد ⇒ يُطوى ولا يُرسَل", async () => {
    for (const status of ["completed", "cancelled", "searching"]) {
      const { handler, driver } = setup();
      const result = await handler(delivery({ ...LIVE, order_status: status }));
      expect(driver.sent).toHaveLength(0);
      expect(result.ok && result.value.undeliverable).toBe(true);
    }
  });

  test("بلا محادثةٍ للمستقبِل ⇒ `TELEGRAM_DELIVERY_UNAVAILABLE`", async () => {
    const { handler } = setup();
    const result = await handler(delivery({ ...LIVE, chat_id: null }));
    expect(result.ok && result.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
  });

  test("حمولةٌ ناقصةٌ ⇒ تُهجَرُ بلا إرسال", async () => {
    const { handler, driver } = setup();
    const result = await handler(delivery({ ...LIVE, recipient_role: "admin" }));
    expect(result.ok && result.value.abandon).toBe(true);
    expect(driver.sent).toHaveLength(0);
  });

  test("رفضُ تيليجرام يُعادُ، والمحاولةُ الأخيرةُ تُسجَّلُ فشلاً نهائيّاً", async () => {
    const first = setup({ driver: null });
    const r1 = await first.handler(delivery(LIVE, 1));
    expect(r1.ok && r1.value.failure).toBe("TELEGRAM_REJECTED");
    expect(first.logs.at(-1)?.event).toBe("order_chat_notice.send_failed");

    const last = setup({ driver: new TypeError("boom") });
    const r3 = await last.handler(delivery(LIVE, 3));
    expect(r3.ok && r3.value.failure).toBe("TypeError");
    expect(last.logs.at(-1)?.event).toBe("order_chat_notice.final_failure");
  });

  test("السطحُ القديمُ (بلا رابطِ Mini App) ⇒ نصٌّ بلا زرّ", async () => {
    const { handler, driver } = setup({ url: null });
    await handler(delivery(LIVE));
    expect(driver.sent[0]?.keyboard).toBeNull();
  });
});
