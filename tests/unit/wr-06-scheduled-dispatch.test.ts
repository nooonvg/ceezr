/**
 * الغرض: `WR-06` الخيارُ ج (ADR 0273) — وحداتُ الجدولةِ بلا قاعدة: كتابةُ اللحظةِ بيومِها
 *   بتوقيتِ الرياض، والإطلاقُ ثمّ البثُّ الفوريُّ لما أُطلِقَ وحدَه، وتذكيرُ السائقِ يسقطُ إن
 *   فاتَ معناه، وأخبارُ الجدولةِ للراكبِ لا تُرسَلُ بعدَ أن تغيّرت الحالة.
 *   (القاعدةُ الحقيقيّةُ في `tests/integration/wr-06-scheduled-dispatch.test.ts`.)
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import { scheduledMomentText } from "../../apps/miniapp/src/surfaces/rider/search/search-view.ts";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import { createDriverCandidateNoticeHandler } from "../../packages/application/dispatch/deliver-candidate-notices.ts";
import { createRiderTripNoticeHandler } from "../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import {
  releaseScheduledOrders,
  type ScheduledOrderReleaser,
} from "../../packages/application/dispatch/release-scheduled-orders.ts";
import type { RiderTripFacts } from "../../packages/application/driver/rider-trip-notice.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import { formatPickupMoment } from "../../packages/shared/order-terms/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const DRIVER = "7d1b0a8e-1f2c-4c3d-9e4f-5a6b7c8d9e0f";
const CITY = "11111111-2222-4333-8444-555555555555" as CityId;

function tr(key: string, params?: Readonly<Record<string, string | number>>): string {
  const base: Record<string, string> = {
    "common.time_am": "ص",
    "common.time_pm": "م",
    "common.tomorrow_at": "غدًا {time}",
    "common.date_at": "{date} {time}",
  };
  let text = base[key] ?? key;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

describe("WR-06 — اللحظةُ بيومِها بتوقيتِ الرياض", () => {
  // 2026-10-12 10:00 بتوقيتِ الرياض = 07:00Z.
  const NOW = Date.parse("2026-10-12T07:00:00Z");

  test("اليومُ نفسُه ⇒ الساعةُ وحدَها", () => {
    expect(formatPickupMoment(Date.parse("2026-10-12T10:30:00Z"), NOW, tr)).toBe("1:30 م");
  });

  test("الغدُ بتوقيتِ الرياضِ لا بتوقيتِ الخادم", () => {
    // 21:30Z = 00:30 بتوقيتِ الرياضِ من 13 أكتوبر — غدٌ وإن كانَ اليومَ نفسَه في UTC.
    expect(formatPickupMoment(Date.parse("2026-10-12T21:30:00Z"), NOW, tr)).toBe("غدًا 12:30 ص");
  });

  test("ما بعدَ الغدِ ⇒ اليومُ/الشهرُ ثمّ الساعة", () => {
    expect(formatPickupMoment(Date.parse("2026-10-15T06:00:00Z"), NOW, tr)).toBe("15/10 9:00 ص");
  });

  test("التطبيقُ المصغَّرُ يكتبُها بمفاتيحِه، ولحظةٌ لا تُقرأُ لا تُرسَمُ", () => {
    const t = (key: string) =>
      ({
        "rider.search.scheduled.am": "ص",
        "rider.search.scheduled.pm": "م",
        "rider.search.scheduled.tomorrow": "غدًا {time}",
        "rider.search.scheduled.date": "{date} {time}",
      })[key] ?? key;
    expect(scheduledMomentText(t, "2026-10-12T21:30:00Z", NOW)).toBe("غدًا 12:30 ص");
    expect(scheduledMomentText(t, null, NOW)).toBeNull();
    expect(scheduledMomentText(t, "ليس-تاريخًا", NOW)).toBeNull();
  });
});

function fakeBroadcast(seen: string[]) {
  return {
    orders: {
      findById: async (id: OrderId) => {
        seen.push(id);
        return ok(null);
      },
    },
    offers: {},
    candidates: {},
    // واجهةُ الإعداداتِ كاملةً في العقدِ: اختبارُ الوحدةِ يعلنُ «الإعداداتُ
    // غيرُ متاحةٍ» صراحةً (ok=false) فتسلكُ الحالةُ القائمةُ — لا استثناءً
    // يبتلعهُ الإنتاجُ.
    settings: {
      findByCity: async () => ({ ok: false, error: { code: "SETTINGS_UNAVAILABLE" } }),
    },
    clock: { now: () => new Date() },
    offerWriter: {},
  } as unknown as Parameters<typeof releaseScheduledOrders>[1]["broadcast"];
}

function releaser(
  outcome: { released: string[]; missed: string[] } | "fail",
): ScheduledOrderReleaser {
  return {
    releaseDue: async () =>
      outcome === "fail"
        ? err(new PortFailureError("orders.releaseScheduled", "down"))
        : ok({
            released: outcome.released as OrderId[],
            missed: outcome.missed as OrderId[],
          }),
  };
}

describe("WR-06 — إطلاقُ المجدولِ ثمّ بثُّه", () => {
  test("لا مُستحَقّ ⇒ لا بثّ", async () => {
    const seen: string[] = [];
    const out = await releaseScheduledOrders(CITY, {
      releaser: releaser({ released: [], missed: [] }),
      broadcast: fakeBroadcast(seen),
      limit: 50,
    });
    expect(out.ok && out.value.broadcast).toBeNull();
    expect(seen).toEqual([]);
  });

  test("المُطلَقُ للتوّ وحدَه يُبَثُّ بخطِّ البثِّ القائم، وما فاتَ لا يُبَثّ", async () => {
    const seen: string[] = [];
    const logs: string[] = [];
    const out = await releaseScheduledOrders(CITY, {
      releaser: releaser({ released: [ORDER], missed: [DRIVER] }),
      broadcast: fakeBroadcast(seen),
      limit: 50,
      log: (message) => logs.push(message),
    });
    if (!out.ok) throw new Error("فشل");
    expect(seen).toEqual([ORDER]);
    expect(out.value.released).toEqual([ORDER as OrderId]);
    expect(out.value.missed).toEqual([DRIVER as OrderId]);
    // الطلبُ لم يُوجَد لحظةَ البثِّ (أُلغي بينهما) ⇒ سباقٌ صحّيٌّ لا عطل.
    expect(out.value.broadcast?.raced).toEqual([ORDER as OrderId]);
    expect(out.value.broadcastFailed).toBe(false);
    expect(logs).toContain("scheduled_order.released");
    expect(logs).toContain("scheduled_order.missed");
  });

  test("سقوطُ القاعدةِ يُعادُ فشلًا صريحًا لا نجاحًا صامتًا", async () => {
    const out = await releaseScheduledOrders(CITY, {
      releaser: releaser("fail"),
      broadcast: fakeBroadcast([]),
      limit: 50,
    });
    expect(out.ok).toBe(false);
  });
});

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

function recorder() {
  const sent: { chatId: string; text: string; keyboard: Keyboard | null }[] = [];
  return {
    sent,
    sender: {
      sendReturningId: async (chatId: string, text: string, keyboard: Keyboard | null) => {
        sent.push({ chatId, text, keyboard });
        return "m-1";
      },
    },
  };
}

const REMINDER = {
  outcome: "PICKUP_REMINDER",
  order_id: ORDER,
  driver_id: DRIVER,
  chat_id: "555",
  language: "ar",
  pickup_at: "2026-10-12T10:30:00Z",
};

describe("WR-06 — تذكيرُ السائقِ بموعدِ الحضور", () => {
  test("ما زالَ لازمًا ⇒ يُرسَلُ بالموعدِ وزرِّ الرحلة", async () => {
    const rec = recorder();
    const handler = createDriverCandidateNoticeHandler({
      sender: rec.sender,
      miniAppUrl: "https://waslah-miniapp.onrender.com",
      pickupReminderState: { read: async () => ({ stillDue: true }) },
    });
    const out = await handler(delivery("driver_candidate_notice", REMINDER));
    expect(out.ok).toBe(true);
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0]?.text).toContain("1:30");
    expect(JSON.stringify(rec.sent[0]?.keyboard)).toContain("open=job");
  });

  test("وصلَ أو أُلغيَ الطلبُ أو أُعيدَ إسنادُه ⇒ لا يُرسَل", async () => {
    for (const state of [{ stillDue: false }, null]) {
      const rec = recorder();
      const handler = createDriverCandidateNoticeHandler({
        sender: rec.sender,
        miniAppUrl: null,
        pickupReminderState: { read: async () => state },
      });
      const out = await handler(delivery("driver_candidate_notice", REMINDER));
      expect(out.ok && out.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
      expect(rec.sent).toHaveLength(0);
    }
  });
});

function facts(status: string): RiderTripFacts {
  return {
    riderTelegramId: "8738396069",
    language: "ar",
    driverName: null,
    plate: null,
    vehicle: null,
    status,
    pickupAt: new Date("2026-10-12T10:30:00Z"),
    dispatchAt: new Date("2026-10-12T10:10:00Z"),
  };
}

function riderHandler(status: string) {
  const rec = recorder();
  const handler = createRiderTripNoticeHandler({
    facts: { read: async () => facts(status) },
    sender: rec.sender,
    miniAppUrl: "https://waslah-miniapp.onrender.com",
  });
  return { handler, rec };
}

describe("WR-06 — أخبارُ الجدولةِ للراكب", () => {
  test("«حُفظ مجدولًا» يحملُ الموعدَ ولحظةَ بدءِ البحث", async () => {
    const { handler, rec } = riderHandler("scheduled");
    await handler(delivery("rider_trip_notice", { order_id: ORDER, event: "SCHEDULED" }));
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0]?.text).toContain("1:30");
    expect(rec.sent[0]?.text).toContain("1:10");
  });

  test("خبرٌ فاتَ معناه لا يُرسَل: تذكيرٌ بمجدولٍ أُلغي، و«بدأَ البحث» وقد أُسنِد", async () => {
    const cases: [string, string][] = [
      ["SCHEDULE_REMINDER", "cancelled"],
      ["SCHEDULED", "searching"],
      ["SEARCH_STARTED", "matched"],
    ];
    for (const [event, status] of cases) {
      const { handler, rec } = riderHandler(status);
      const out = await handler(delivery("rider_trip_notice", { order_id: ORDER, event }));
      expect(out.ok && out.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
      expect(rec.sent).toHaveLength(0);
    }
  });

  test("«فاتَ الموعد» يُرسَلُ للملغى", async () => {
    const { handler, rec } = riderHandler("cancelled");
    await handler(delivery("rider_trip_notice", { order_id: ORDER, event: "SCHEDULE_MISSED" }));
    expect(rec.sent).toHaveLength(1);
  });
});
