/**
 * الغرض: `WR-13` (ADR 0269) — معالجُ إخطارِ السائقِ بانتقالِ مدينتِه أو بخروجِه من التغطية.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import {
  createDriverCityNoticeHandler,
  driverCityNoticeText,
} from "../../packages/application/dispatch/deliver-driver-city-notice.ts";
import { LOCATION_REMINDER_OFF_CALLBACK } from "../../packages/application/dispatch/deliver-location-reminder.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { t } from "../../packages/shared/i18n/index.ts";

const DRIVER = "7d1f2b3a-0c4e-4b5f-9a6d-1e2f3a4b5c6d";

function delivery(payload: Record<string, unknown>, attempts = 1): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "driver_city_notice",
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    payload,
  };
}

function setup(result: string | null | Error = "m-1") {
  const sent: { chatId: string; text: string; keyboard: Keyboard | null }[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const handler = createDriverCityNoticeHandler({
    sender: {
      sendReturningId: async (chatId, text, keyboard) => {
        sent.push({ chatId, text, keyboard });
        if (result instanceof Error) throw result;
        return result;
      },
    },
    log: (event, meta) => logs.push({ event, meta }),
  });
  return { handler, sent, logs };
}

const changed = {
  driver_id: DRIVER,
  event: "changed",
  city_name_ar: "مكة المكرمة",
  city_name_en: "Makkah",
  chat_id: "5550001",
  language: "ar",
};

describe("WR-13 — إخطارُ مدينةِ السائق", () => {
  test("انتقالٌ ⇒ اسمُ المدينةِ بلغةِ السائقِ وبلا أزرار", async () => {
    const s = setup();
    const out = await s.handler(delivery(changed));
    expect(out.ok && out.value.messageId).toBe("m-1");
    expect(s.sent[0]?.text).toBe(t("ar")("driver.city_auto_changed", { city: "مكة المكرمة" }));
    expect(s.sent[0]?.keyboard).toBeNull();
    const en = setup();
    await en.handler(delivery({ ...changed, language: "en" }));
    expect(en.sent[0]?.text).toContain("Makkah");
  });

  test("خارجَ التغطيةِ ⇒ النصُّ وزرُّ «غير متوفر»", async () => {
    const s = setup();
    await s.handler(
      delivery({ driver_id: DRIVER, event: "outside", chat_id: "5550001", language: "ar" }),
    );
    expect(s.sent[0]?.text).toBe(t("ar")("driver.city_outside_coverage"));
    const kb = s.sent[0]?.keyboard;
    const data =
      kb?.kind === "inline" ? kb.rows.flat().map((b) => ("data" in b ? b.data : null)) : [];
    expect(data).toEqual([LOCATION_REMINDER_OFF_CALLBACK]);
  });

  test("حمولةٌ ناقصةٌ ⇒ تخلٍّ، وبلا محادثةٍ ⇒ غيرُ قابلٍ للتسليم", async () => {
    const a = await setup().handler(delivery({ ...changed, event: "moved" }));
    expect(a.ok && a.value.abandon).toBe(true);
    const b = await setup().handler(
      delivery({ ...changed, city_name_ar: null, city_name_en: null }),
    );
    expect(b.ok && b.value.abandon).toBe(true);
    const c = await setup().handler(delivery({ ...changed, chat_id: "" }));
    expect(c.ok && c.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
  });

  test("الرفضُ يُعادُ، والأخيرُ final_failure، والسجلُّ بلا معرّفِ محادثة", async () => {
    const r = await setup(null).handler(delivery(changed));
    expect(r.ok && r.value.failure).toBe("TELEGRAM_REJECTED");
    const s = setup(new TypeError("x"));
    await s.handler(delivery(changed, 3));
    expect(s.logs.some((l) => l.event === "driver_city_notice.final_failure")).toBe(true);
    expect(JSON.stringify(s.logs)).not.toContain("5550001");
  });

  test("النصوصُ في اللغاتِ الثلاثِ بلا عنصرٍ نائب", () => {
    for (const lang of ["ar", "en", "ur"]) {
      expect(driverCityNoticeText("changed", "X", lang)).not.toContain("{city}");
      expect(driverCityNoticeText("outside", null, lang).length).toBeGreaterThan(20);
    }
  });
});
