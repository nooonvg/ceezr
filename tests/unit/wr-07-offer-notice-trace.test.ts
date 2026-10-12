/**
 * الغرض: `WR-07` — مآلُ إشعارِ العرضِ يُسجَّلُ بسببِه حتى يُتتبَّعَ المسارُ إلى البوت:
 *   التخلّي بسببٍ مُسمّى، والمحاولةُ، وقبولُ Telegram API (لا ظهورُ البطاقة)، والفشلُ
 *   المؤقّتُ والنهائيّ، وغيابُ العنوان — بلا معرّفِ تيليجرام ولا نصّ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type {
  OfferNotification,
  OfferPublisher,
} from "../../packages/application/dispatch/broadcast-offers.ts";
import { createOfferNotificationHandler } from "../../packages/application/dispatch/deliver-offer-notification.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const OFFER = "a836566d-4e3c-47c7-ac93-ce21213fe04e";
const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    offer_id: OFFER,
    order_id: ORDER,
    driver_id: "e9297405-8884-499f-9264-b14b76c894a3",
    distance_km: "1.4",
    expires_at: new Date(Date.now() + 40_000).toISOString(),
    offer_status: "pending",
    service: "transport",
    pickup_label: "العوالي",
    dropoff_label: "الحرم",
    notes: null,
    chat_id: "999000111",
    ...over,
  };
}

function delivery(p: Record<string, unknown>, attempts = 1): OutboxDelivery {
  return {
    deliveryId: "d-7",
    kind: "offer",
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    payload: p,
  };
}

function setup(result: Awaited<ReturnType<OfferPublisher["publishOffer"]>> = ok("m-1")) {
  const published: OfferNotification[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const handler = createOfferNotificationHandler(
    {
      publishOffer: async (n) => {
        published.push(n);
        return result;
      },
    },
    (event, meta) => logs.push({ event, meta }),
  );
  return { handler, published, logs };
}

describe("WR-07 — تتبّعُ إشعارِ العرض", () => {
  test("القبولُ يسجّلُ attempted ثم accepted بمعرّفَي العرضِ والطلبِ فقط", async () => {
    const { handler, logs, published } = setup();
    const r = await handler(delivery(payload()));
    expect(r.ok && r.value.messageId).toBe("m-1");
    expect(published).toHaveLength(1);
    expect(logs.map((l) => l.event)).toEqual(["offer_notice.attempted", "offer_notice.accepted"]);
    expect(logs[1]?.meta).toEqual({
      delivery_id: "d-7",
      offer_id: OFFER,
      order_id: ORDER,
      attempt: 1,
    });
    expect(Number(logs[0]?.meta.expires_in_seconds)).toBeGreaterThan(30);
  });

  test("العرضُ المحسومُ لغيرِه يُتخلّى عنه بسببٍ مُسمّى ولا يُرسَل", async () => {
    const { handler, logs, published } = setup();
    const r = await handler(delivery(payload({ offer_status: "superseded" })));
    expect(r.ok && r.value.abandon).toBe(true);
    expect(published).toHaveLength(0);
    expect(logs).toEqual([
      {
        event: "offer_notice.abandoned",
        meta: { delivery_id: "d-7", offer_id: OFFER, order_id: ORDER, reason: "OFFER_SUPERSEDED" },
      },
    ]);
  });

  test("العرضُ المنتهي مهلتُه سببُه OFFER_EXPIRED", async () => {
    const { handler, logs } = setup();
    await handler(delivery(payload({ expires_at: new Date(Date.now() - 1000).toISOString() })));
    expect(logs[0]?.meta.reason).toBe("OFFER_EXPIRED");
  });

  test("الحمولةُ التالفةُ سببُها PAYLOAD_INVALID بلا معرّفات", async () => {
    const { handler, logs } = setup();
    await handler(delivery({ order_id: ORDER }));
    expect(logs[0]).toEqual({
      event: "offer_notice.abandoned",
      meta: { delivery_id: "d-7", offer_id: null, order_id: null, reason: "PAYLOAD_INVALID" },
    });
  });

  test("الفشلُ قبلَ آخرِ محاولةٍ send_failed، وفي الأخيرةِ final_failure", async () => {
    const failing = err(new PortFailureError("telegram", "TELEGRAM_429"));
    const first = setup(failing);
    const r1 = await first.handler(delivery(payload(), 1));
    expect(r1.ok && r1.value.failure).toBe("TELEGRAM_429");
    expect(first.logs.at(-1)?.event).toBe("offer_notice.send_failed");
    expect(first.logs.at(-1)?.meta.error).toBe("TELEGRAM_429");
    const last = setup(failing);
    await last.handler(delivery(payload(), 3));
    expect(last.logs.at(-1)?.event).toBe("offer_notice.final_failure");
    expect(last.logs.at(-1)?.meta.max_attempts).toBe(3);
  });

  test("غيابُ عنوانِ السائقِ undeliverable لا فشلَ محاولة", async () => {
    const { handler, logs } = setup(
      err(new PortFailureError("telegram", "TELEGRAM_DELIVERY_UNAVAILABLE")),
    );
    const r = await handler(delivery(payload()));
    expect(r.ok && r.value.undeliverable).toBe(true);
    expect(logs.at(-1)?.event).toBe("offer_notice.undeliverable");
  });

  test("لا معرّفَ تيليجرام ولا نصَّ في أيِّ سجلّ", async () => {
    const { handler, logs } = setup();
    await handler(delivery(payload()));
    const dumped = JSON.stringify(logs);
    expect(dumped).not.toContain("999000111");
    expect(dumped).not.toContain("الحرم");
    expect(dumped).not.toContain("العوالي");
  });

  test("بلا سجلٍّ يبقى المعالجُ كما كان", async () => {
    const handler = createOfferNotificationHandler({ publishOffer: async () => ok("m-2") });
    const r = await handler(delivery(payload()));
    expect(r.ok && r.value.messageId).toBe("m-2");
  });
});
