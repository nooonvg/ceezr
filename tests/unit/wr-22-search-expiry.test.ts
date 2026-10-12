/**
 * الغرض: `WR-22` (ADR 0276) — انتهاءُ البحثِ في طبقةِ التطبيق: المآلُ يُقرأُ ويُسجَّلُ بلا قرارٍ
 *   ثانٍ، وعطلُ القاعدةِ يُرَدُّ ولا يُبتلَع، وإشعارُ الراكبِ بلغاتِه الثلاث لا يُرسَلُ إلّا والطلبُ
 *   `failed` فعلًا، ويحملُ زرَّ فتحِ الطلبِ في Mini App.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  rideStatusKey,
  searchEndedWithoutRide,
} from "../../apps/miniapp/src/surfaces/rider/search/search-view.ts";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import { createRiderTripNoticeHandler } from "../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import { expireSearchingOrders } from "../../packages/application/dispatch/expire-searching-orders.ts";
import {
  RIDER_TRIP_EVENT_REQUIRES_STATUS,
  type RiderTripFacts,
  riderTripText,
} from "../../packages/application/driver/rider-trip-notice.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = "ddc32390-ba8a-49fc-a776-3a8f38581f68" as CityId;
const ORDER = "4d67e20f-e49c-4d0e-acf5-008955d40735";

function facts(status: string, language = "ar"): RiderTripFacts {
  return {
    riderTelegramId: "8738396069",
    language,
    driverName: null,
    plate: null,
    vehicle: null,
    status,
    pickupAt: null,
    dispatchAt: null,
  };
}

function delivery(payload: Record<string, unknown>): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "rider_trip_notice",
    cityId: CITY as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts: 1,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    payload,
  };
}

function handlerFor(status: string) {
  const sent: { text: string; keyboard: Keyboard | null }[] = [];
  const handler = createRiderTripNoticeHandler({
    facts: { read: async () => facts(status) },
    sender: {
      sendReturningId: async (_chatId: string, text: string, keyboard: Keyboard | null) => {
        sent.push({ text, keyboard });
        return "m-1";
      },
    },
    miniAppUrl: "https://waslah-miniapp.onrender.com",
  });
  return { handler, sent };
}

describe("WR-22 — الشوطُ في طبقةِ التطبيق", () => {
  test("يقرأُ المآلَ كما هو ويسجّلُ كلَّ طلبٍ أُنهي", async () => {
    const logged: string[] = [];
    const out = await expireSearchingOrders(CITY, {
      expirer: {
        expireStale: async () => ok({ disabled: false, expired: [ORDER as OrderId], held: 2 }),
      },
      limit: 50,
      log: (message, meta) => logged.push(`${message}:${String(meta.order_id)}`),
    });
    expect(out.ok && out.value).toEqual({
      cityId: CITY,
      disabled: false,
      expired: [ORDER as OrderId],
      held: 2,
    });
    expect(logged).toEqual([`order.search_expired:${ORDER}`]);
  });

  test("المعطَّلُ لا يسجّلُ شيئًا", async () => {
    const logged: string[] = [];
    const out = await expireSearchingOrders(CITY, {
      expirer: { expireStale: async () => ok({ disabled: true, expired: [], held: 0 }) },
      limit: 50,
      log: (message) => logged.push(message),
    });
    expect(out.ok && out.value.disabled).toBe(true);
    expect(logged).toEqual([]);
  });

  test("عطلُ القاعدةِ يُرَدُّ فيسقطُ الشوطُ ويُعادُ لاحقًا، لا يُبتلَع", async () => {
    const out = await expireSearchingOrders(CITY, {
      expirer: {
        expireStale: async () => err(new PortFailureError("orders.expireSearching", "down")),
      },
      limit: 50,
    });
    expect(out.ok).toBe(false);
  });
});

describe("WR-22 — إشعارُ الراكب «انتهى البحث»", () => {
  test("بلغاتِ الراكبِ الثلاث، ويحملُ رقمَ الطلبِ المختصر", () => {
    for (const language of ["ar", "en", "ur"]) {
      const text = riderTripText("SEARCH_EXPIRED", ORDER, facts("failed", language));
      expect(text).toContain("#4d67e20f");
      expect(text).not.toContain("{order}");
      expect(text.startsWith("⌛")).toBe(true);
    }
    expect(riderTripText("SEARCH_EXPIRED", ORDER, facts("failed"))).toContain(
      "يمكنك إنشاء طلب جديد",
    );
  });

  test("لا يُرسَلُ إلّا والطلبُ `failed`", () => {
    expect(RIDER_TRIP_EVENT_REQUIRES_STATUS.SEARCH_EXPIRED).toEqual(["failed"]);
  });

  test("الطلبُ `failed` ⇒ رسالةٌ واحدةٌ بزرِّ فتحِ الطلب", async () => {
    const { handler, sent } = handlerFor("failed");
    const out = await handler(delivery({ order_id: ORDER, event: "SEARCH_EXPIRED" }));
    expect(out.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.keyboard).not.toBeNull();
  });

  test("عادَ الطلبُ إلى حالةٍ أخرى قبلَ الإرسال ⇒ لا يُرسَلُ خبرٌ فاتَ معناه", async () => {
    for (const status of ["searching", "matched", "cancelled"]) {
      const { handler, sent } = handlerFor(status);
      const out = await handler(delivery({ order_id: ORDER, event: "SEARCH_EXPIRED" }));
      expect(out.ok && out.value.undeliverableReason).toBe("TELEGRAM_DELIVERY_NOT_REQUIRED");
      expect(sent).toHaveLength(0);
    }
  });
});

describe("WR-22 — شاشةُ البحثِ في Mini App", () => {
  test("`failed` و`cancelled` انتهاءٌ بلا رحلة؛ والبحثُ والإسنادُ والمجدولُ ليست كذلك", () => {
    expect(searchEndedWithoutRide("failed")).toBe(true);
    expect(searchEndedWithoutRide("cancelled")).toBe(true);
    for (const status of ["searching", "scheduled", "matched", "in_progress", "completed"]) {
      expect(searchEndedWithoutRide(status)).toBe(false);
    }
  });

  test("نصُّ `failed` يقولُ ما حدثَ بلغاتِه الثلاث: انتهى البحثُ دونَ سائق", () => {
    const key = rideStatusKey("failed");
    const expected: Record<string, string> = {
      ar: "انتهى البحث دون سائق",
      en: "The search ended without a driver",
      ur: "تلاش ڈرائیور کے بغیر ختم ہو گئی",
    };
    for (const [language, text] of Object.entries(expected)) {
      const dict = JSON.parse(
        readFileSync(`packages/shared/i18n/miniapp/${language}.json`, "utf8"),
      ) as Record<string, string>;
      expect(dict[key]).toBe(text);
    }
  });

  test("بابُ الرجوعِ مشروطٌ بتمريرِه وبانتهاءِ البحثِ معًا", () => {
    const source = readFileSync("apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx", "utf8");
    expect(source).toContain(
      "onBack !== undefined && view !== null && searchEndedWithoutRide(view.status)",
    );
  });
});
