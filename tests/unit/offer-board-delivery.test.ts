/**
 * الغرض: اختبارُ انحدارِ مسارِ لوحِ العروضِ في شوطِ التسليمِ — `LOAD-01
 *   Recovery` (المرحلة 6-استكمال — الجدارُ الثاني). القواعدُ المحفوظةُ:
 *   الإيصالُ تسليمٌ موثَّقٌ (لا بطاقةَ ولا دلوَّ يُستهلكُ)، والإشارةُ للمتصلِ
 *   انتظارٌ مسقوفٌ لا محاولةَ إرسالٍ، ولغيرِ المتصلِ البطاقةُ فورًا، والعروضُ
 *   المنتهيةُ لا تُسلَّمُ ولا تُقبلُ (حارسُ انتهاءِ المهلةِ قبلَ كلِّ شيءٍ).
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: موجاتُ القبولِ — إن سقطَ هذا فلا موجاتِ.
 */

import { describe, expect, it } from "bun:test";
import type { OfferPublisher } from "../../packages/application/dispatch/broadcast-offers.ts";
import type { OfferBoardDelivery } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

const FUTURE = new Date(Date.now() + 5 * 60_000).toISOString();

function makeDelivery(overrides: Partial<OutboxDelivery> = {}): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "offer",
    cityId: "city" as never,
    claimToken: "t-1",
    attempts: 1,
    maxAttempts: 5,
    batchLimit: 8,
    requestId: null,
    signalWaitCount: 0,
    payload: {
      offer_id: "o-1",
      order_id: "ord-1",
      driver_id: "drv-1",
      distance_km: "2.5",
      expires_at: FUTURE,
      offer_status: "pending",
    },
    ...overrides,
  };
}

function makePublisher(): OfferPublisher & { calls: number } {
  const publisher = {
    calls: 0,
    publishOffer: async (): Promise<Result<string, { detail: string }>> => {
      publisher.calls += 1;
      return ok("msg-1");
    },
  };
  return publisher as never;
}

function makeBoard(
  receipt: Date | null,
  emitted: boolean,
): OfferBoardDelivery & { signals: number } {
  const board = {
    signals: 0,
    findReceipt: async () => receipt,
    signalDriver: async () => {
      board.signals += 1;
      return emitted;
    },
  };
  return board as never;
}

describe("لوحُ العروضِ في شوطِ التسليمِ — إيصالٌ وإشارةٌ وبطاقةٌ بديلةٌ", () => {
  it("الإيصالُ الموثَّقُ تسليمٌ عبرَ اللوحِ: لا بطاقةَ ولا دلوَّ يُستهلكُ", async () => {
    const publisher = makePublisher();
    const handler = createOfferNotificationHandler(
      publisher,
      undefined,
      makeBoard(new Date(), true),
    );
    const outcome = await handler(makeDelivery());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.deliveredViaBoard).toBe(true);
    expect(outcome.value.messageId).toBeNull();
    expect(publisher.calls).toBe(0);
  });

  it("السائقُ المتصلُ بلا إيصالٍ بعدُ: إشارةٌ ثمَّ انتظارٌ قصيرٌ لا محاولةَ إرسالٍ محسوبةٍ", async () => {
    const publisher = makePublisher();
    const handler = createOfferNotificationHandler(publisher, undefined, makeBoard(null, true));
    const outcome = await handler(makeDelivery());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signalWait).toEqual({ retryAfterMs: 3_000 });
    expect(outcome.value.deliveredViaBoard).toBeUndefined();
    expect(publisher.calls).toBe(0);
  });

  it("سقفُ الانتظارِ ثلاثُ دوراتٍ ثمَّ البطاقةُ: لا تعليقَ بلا نهايةٍ للمتصلِ الذي لا يقرأُ", async () => {
    const publisher = makePublisher();
    const board = makeBoard(null, true);
    const handler = createOfferNotificationHandler(publisher, undefined, board);
    // استنفدَ الصفُّ دوراتِهِ الثلاثَ (signalWaitCount من القاعدةِ):
    const outcome = await handler(makeDelivery({ signalWaitCount: 3, attempts: 1 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signalWait).toBeUndefined();
    expect(outcome.value.deliveredViaBoard).toBeUndefined();
    expect(publisher.calls).toBe(1);
  });

  it("غيرُ المتصلِ: البطاقةُ فورًا — لا انتظارَ لغائبٍ", async () => {
    const publisher = makePublisher();
    const handler = createOfferNotificationHandler(publisher, undefined, makeBoard(null, false));
    const outcome = await handler(makeDelivery());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.signalWait).toBeUndefined();
    expect(publisher.calls).toBe(1);
  });

  it("العرضُ المنتهي لا يُسلَّمُ حتى بإيصالٍ: حارسُ المهلةِ قبلَ كلِّ شيءٍ — لا قبولَ منتهيًا", async () => {
    const publisher = makePublisher();
    const handler = createOfferNotificationHandler(
      publisher,
      undefined,
      makeBoard(new Date(), true),
    );
    const past = new Date(Date.now() - 1_000).toISOString();
    const outcome = await handler(
      makeDelivery({ payload: { ...makeDelivery().payload, expires_at: past } }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.abandon).toBe(true);
    expect(publisher.calls).toBe(0);
  });

  it("غيابُ مسارِ اللوحِ (التوصيلُ القديمُ): البطاقةُ كما كانَت — لا انكسارَ للمستدعياتِ", async () => {
    const publisher = makePublisher();
    const handler = createOfferNotificationHandler(publisher);
    const outcome = await handler(makeDelivery());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.messageId).toBe("msg-1");
    expect(publisher.calls).toBe(1);
  });

  it("عنوانُ السائقِ غائبٌ (SEC-19-ب-٤): تعذُّرٌ مسمّىً لا موتًا — والإيصالُ لا يُخفيهِ", async () => {
    const publisher: OfferPublisher = {
      publishOffer: async () => err({ detail: "TELEGRAM_DELIVERY_UNAVAILABLE" } as never),
    };
    const handler = createOfferNotificationHandler(publisher, undefined, makeBoard(null, false));
    const outcome = await handler(makeDelivery());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.undeliverable).toBe(true);
    expect(outcome.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_UNAVAILABLE");
  });
});
