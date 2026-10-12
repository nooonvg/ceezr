/**
 * الغرض: `WR-09` (ADR 0266) — إشعارا المرشَّح: للراكبِ «سائقٌ قبِلَ — اختَرْ خلالَ N ثانية»
 *   بزرِّ فتحِ الطلبِ ويُطوى إن فاتَ المرشَّح، وللسائقِ مآلُ قبولِه بنصٍّ لكلِّ مآلٍ وزرِّ
 *   «الرحلة» عندَ الاختيار. (بطاقةُ التطبيقِ المصغَّرِ في `RideCandidateCard.test.tsx`.)
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import {
  createDriverCandidateNoticeHandler,
  driverCandidateText,
  type RiderCandidateFacts,
  riderCandidateText,
} from "../../packages/application/dispatch/deliver-candidate-notices.ts";
import { createRiderTripNoticeHandler } from "../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const OFFER = "7d1b0a8e-1f2c-4c3d-9e4f-5a6b7c8d9e0f";
const MINIAPP = "https://waslah-miniapp.onrender.com";

const FACTS: RiderCandidateFacts = {
  riderTelegramId: "8738396069",
  language: "ar",
  live: true,
  driverName: "سالم",
  plate: "أ ب ج 123",
  vehicle: "sedan",
  ratingAverage: 4.83,
  ratingCount: 12,
  secondsLeft: 14,
};

function delivery(kind: string, payload: Record<string, unknown>): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind,
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts: 1,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    payload,
  };
}

function recorder(result: string | null = "m-1") {
  const sent: { chatId: string; text: string; keyboard: Keyboard | null }[] = [];
  return {
    sent,
    sender: {
      sendReturningId: async (chatId: string, text: string, keyboard: Keyboard | null) => {
        sent.push({ chatId, text, keyboard });
        return result;
      },
    },
  };
}

function riderHandler(facts: RiderCandidateFacts | null, miniAppUrl: string | null = MINIAPP) {
  const rec = recorder();
  const logs: string[] = [];
  const handler = createRiderTripNoticeHandler({
    facts: { read: async () => null },
    candidates: { read: async () => facts },
    sender: rec.sender,
    miniAppUrl,
    log: (event) => logs.push(event),
  });
  return { handler, rec, logs };
}

describe("WR-09 — إشعارُ المرشَّحِ للراكب", () => {
  test("النصُّ يحملُ السائقَ وتقييمَه ومركبتَه ولوحتَه والثوانيَ، بلا معرّفِ تيليجرام", () => {
    const text = riderCandidateText(ORDER, FACTS);
    expect(text).toContain("سالم");
    expect(text).toContain("4.8 (12)");
    expect(text).toContain("أ ب ج 123");
    expect(text).toContain("14");
    expect(text).not.toContain(FACTS.riderTelegramId);
  });

  test("سائقٌ بلا تقييمٍ يُقالُ «بلا تقييم» لا صفراً", () => {
    const text = riderCandidateText(ORDER, { ...FACTS, ratingAverage: null, ratingCount: 0 });
    expect(text).not.toContain("0.0");
  });

  test("الإنجليزيّةُ والأورديّةُ لهما نصٌّ لا مفتاحٌ خام", () => {
    for (const language of ["en", "ur"]) {
      const text = riderCandidateText(ORDER, { ...FACTS, language });
      expect(text).not.toContain("tracking.rider_candidate");
    }
  });

  test("مرشَّحٌ حيٌّ ⇒ رسالةٌ بزرِّ فتحِ الطلبِ في التطبيقِ المصغَّر", async () => {
    const { handler, rec } = riderHandler(FACTS);
    const result = await handler(
      delivery("rider_trip_notice", { event: "CANDIDATE", order_id: ORDER, offer_id: OFFER }),
    );
    expect(result.ok && result.value.messageId).toBe("m-1");
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0]?.chatId).toBe(FACTS.riderTelegramId);
    const keyboard = rec.sent[0]?.keyboard;
    expect(keyboard?.kind).toBe("inline");
    expect(JSON.stringify(keyboard)).toContain(`ride_${ORDER}`);
  });

  test("فاتَ المرشَّحُ قبلَ الإرسالِ ⇒ يُطوى بلا رسالة (TELEGRAM_DELIVERY_NOT_REQUIRED)", async () => {
    const { handler, rec, logs } = riderHandler({ ...FACTS, live: false });
    const result = await handler(
      delivery("rider_trip_notice", { event: "CANDIDATE", order_id: ORDER, offer_id: OFFER }),
    );
    expect(result.ok && result.value.undeliverable).toBe(true);
    expect(result.ok && result.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
    expect(rec.sent).toHaveLength(0);
    expect(logs).toContain("rider_trip_notice.candidate_stale");
  });

  test("حمولةٌ بلا عرضٍ تُهجَرُ ولا تُعادُ", async () => {
    const { handler, rec } = riderHandler(FACTS);
    const result = await handler(
      delivery("rider_trip_notice", { event: "CANDIDATE", order_id: ORDER }),
    );
    expect(result.ok && result.value.abandon).toBe(true);
    expect(rec.sent).toHaveLength(0);
  });

  test("رفضُ تيليجرام ⇒ فشلٌ يُعادُ لا تسليم", async () => {
    const rec = recorder(null);
    const handler = createRiderTripNoticeHandler({
      facts: { read: async () => null },
      candidates: { read: async () => FACTS },
      sender: rec.sender,
      miniAppUrl: MINIAPP,
    });
    const result = await handler(
      delivery("rider_trip_notice", { event: "CANDIDATE", order_id: ORDER, offer_id: OFFER }),
    );
    expect(result.ok && result.value.messageId).toBeNull();
    expect(result.ok && result.value.failure).toBe("TELEGRAM_REJECTED");
  });
});

describe("WR-09 — إشعارُ المآلِ للسائق", () => {
  test("لكلِّ مآلٍ نصٌّ في اللغاتِ الثلاث", () => {
    for (const outcome of ["ACCEPTED", "DECLINED", "EXPIRED", "CANCELLED"] as const) {
      for (const language of ["ar", "en", "ur"]) {
        const text = driverCandidateText(outcome, ORDER, language);
        expect(text).toContain("#5c6a72c2");
        expect(text).not.toContain("driver.candidate_");
      }
    }
  });

  test("ACCEPTED في سطحِ التطبيقِ المصغَّرِ ⇒ زرُّ شاشةِ الرحلة", async () => {
    const rec = recorder();
    const handler = createDriverCandidateNoticeHandler({ sender: rec.sender, miniAppUrl: MINIAPP });
    await handler(
      delivery("driver_candidate_notice", {
        outcome: "ACCEPTED",
        order_id: ORDER,
        chat_id: "555",
        language: "ar",
      }),
    );
    expect(rec.sent[0]?.chatId).toBe("555");
    expect(JSON.stringify(rec.sent[0]?.keyboard)).toContain("open=job");
  });

  test("ACCEPTED في السطحِ القديمِ ⇒ لوحةُ «بدء الرحلة» المحقونة", async () => {
    const rec = recorder();
    const start: Keyboard = { kind: "inline", rows: [[{ label: "ابدأ", data: "x" }]] };
    const handler = createDriverCandidateNoticeHandler({
      sender: rec.sender,
      miniAppUrl: null,
      startKeyboard: () => start,
    });
    await handler(
      delivery("driver_candidate_notice", { outcome: "ACCEPTED", order_id: ORDER, chat_id: "555" }),
    );
    expect(rec.sent[0]?.keyboard).toEqual(start);
  });

  test("DECLINED بلا زرّ، وبلا محادثةٍ ⇒ undeliverable، ومآلٌ مجهولٌ يُهجَر", async () => {
    const rec = recorder();
    const handler = createDriverCandidateNoticeHandler({ sender: rec.sender, miniAppUrl: MINIAPP });
    await handler(
      delivery("driver_candidate_notice", { outcome: "DECLINED", order_id: ORDER, chat_id: "555" }),
    );
    expect(rec.sent[0]?.keyboard).toBeNull();
    const missing = await handler(
      delivery("driver_candidate_notice", { outcome: "EXPIRED", order_id: ORDER }),
    );
    expect(missing.ok && missing.value.undeliverable).toBe(true);
    const unknown = await handler(
      delivery("driver_candidate_notice", { outcome: "MAYBE", order_id: ORDER, chat_id: "555" }),
    );
    expect(unknown.ok && unknown.value.abandon).toBe(true);
    expect(rec.sent).toHaveLength(1);
  });
});
