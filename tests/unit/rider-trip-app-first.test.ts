/**
 * ADR 0287 — أطوارُ رحلةِ الراكبِ: Mini App أولًا بإقرارِ العميلِ، وتيليجرامُ احتياطًا.
 *
 * يثبتُ قراراتِ المعالجِ في الحالاتِ الستِّ المطلوبةِ: متصلٌ أقرَّ، غيرُ متصلٍ،
 * متأخرٌ عنِ الإقرارِ (انقضاءُ المهلةِ)، انقطاعُ المقبسِ بعدَ البثِّ، عودةُ العميلِ
 * (إيصالٌ بعدَ انتظارٍ)، والتكرارُ — والبثُّ وحدَه لا يُعدُّ تسليمًا قطُّ.
 */
import { describe, expect, test } from "bun:test";
import {
  createRiderTripNoticeHandler,
  RIDER_TRIP_APP_ACK_WAIT_MS,
  RIDER_TRIP_APP_MAX_SIGNAL_WAITS,
  type RiderTripAppDelivery,
} from "../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import type { RiderTripFacts } from "../../packages/application/driver/rider-trip-notice.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const RIDER_TG = "8738396069";
const FACTS: RiderTripFacts = {
  riderTelegramId: RIDER_TG,
  language: "ar",
  driverName: "سائق",
  plate: "ABC 123",
  vehicle: "sedan",
};

function delivery(event: string, signalWaitCount = 0): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "rider_trip_notice",
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts: 0,
    maxAttempts: 3,
    batchLimit: 1,
    requestId: null,
    signalWaitCount,
    payload: { order_id: ORDER, event, chat_id: RIDER_TG },
  };
}

function fixture(
  app: Partial<RiderTripAppDelivery> & { connected?: boolean; receipt?: Date | null },
) {
  const sent: string[] = [];
  const signalled: string[] = [];
  const events: string[] = [];
  const handle = createRiderTripNoticeHandler({
    facts: { read: async () => FACTS },
    sender: {
      sendReturningId: async (to) => {
        sent.push(to);
        return "777";
      },
    },
    miniAppUrl: "https://example.test/",
    app: {
      findReceipt: app.findReceipt ?? (async () => app.receipt ?? null),
      signalRider:
        app.signalRider ??
        (async (tg, order) => {
          signalled.push(`${tg}:${order}`);
          return app.connected === true;
        }),
    },
    log: (event) => events.push(event),
  });
  return { handle, sent, signalled, events };
}

describe("ADR 0287 — Mini App أولًا لأطوارِ الرحلةِ", () => {
  test("متصلٌ بلا إقرارٍ بعدُ: إشارةٌ ثم انتظارٌ — لا بطاقةَ ولا تسليمَ", async () => {
    const f = fixture({ connected: true });
    const out = await f.handle(delivery("MATCHED"));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.signalWait).toEqual({ retryAfterMs: RIDER_TRIP_APP_ACK_WAIT_MS });
    expect(out.value.deliveredViaBoard).toBeUndefined();
    expect(out.value.messageId).toBeNull();
    expect(f.signalled).toEqual([`${RIDER_TG}:${ORDER}`]);
    expect(f.sent).toEqual([]);
  });

  test("إقرارُ العميلِ موجودٌ: تسليمٌ عبرَ Mini App — بلا إشارةٍ ولا بطاقةٍ", async () => {
    const f = fixture({ connected: true, receipt: new Date() });
    const out = await f.handle(delivery("ARRIVED", 1));
    expect(out.ok && out.value.deliveredViaBoard).toBe(true);
    expect(f.signalled).toEqual([]);
    expect(f.sent).toEqual([]);
    expect(f.events).toContain("rider_trip_notice.app_acked");
  });

  test("غيرُ متصلٍ: تيليجرامُ فورًا (لا انتظارَ على غائبٍ)", async () => {
    const f = fixture({ connected: false });
    const out = await f.handle(delivery("STARTED"));
    expect(out.ok && out.value.messageId).toBe("777");
    expect(out.ok && out.value.signalWait).toBeUndefined();
    expect(f.sent).toEqual([RIDER_TG]);
    expect(f.events).toContain("rider_trip_notice.telegram_fallback");
  });

  test("متصلٌ لم يُقرَّ ضمنَ المهلةِ (سقفُ الانتظاراتِ): تيليجرامُ احتياطًا", async () => {
    const f = fixture({ connected: true });
    const out = await f.handle(delivery("COMPLETED", RIDER_TRIP_APP_MAX_SIGNAL_WAITS));
    expect(out.ok && out.value.messageId).toBe("777");
    // لا إشارةَ رابعةَ: السقفُ يمنعُ تعليقَ الحدثِ على عميلٍ صامتٍ.
    expect(f.signalled).toEqual([]);
    expect(f.sent).toEqual([RIDER_TG]);
  });

  test("انقطاعُ المقبسِ بعدَ البثِّ: البثُّ لم يُحسبْ تسليمًا، والالتقاطُ التالي بلا متصلٍ = تيليجرامُ", async () => {
    let connected = true;
    const f = fixture({ signalRider: async () => connected });
    const first = await f.handle(delivery("MATCHED", 0));
    expect(first.ok && first.value.signalWait).toBeDefined();
    connected = false; // انقطعَ قبلَ أن يُقرَّ
    const second = await f.handle(delivery("MATCHED", 1));
    expect(second.ok && second.value.messageId).toBe("777");
    expect(f.sent).toEqual([RIDER_TG]);
  });

  test("عودةُ العميلِ بعدَ انتظارٍ: الإيصالُ يُغلقُ الحدثَ بلا بطاقةٍ", async () => {
    let receipt: Date | null = null;
    const f = fixture({ connected: true, findReceipt: async () => receipt });
    const first = await f.handle(delivery("ARRIVED", 0));
    expect(first.ok && first.value.signalWait).toBeDefined();
    receipt = new Date(); // العميلُ عادَ وجلبَ وطبّقَ وأقرَّ
    const second = await f.handle(delivery("ARRIVED", 1));
    expect(second.ok && second.value.deliveredViaBoard).toBe(true);
    expect(f.sent).toEqual([]);
  });

  test("فشلُ قراءةِ الإيصالِ أو الإشارةِ ليسَ تسليمًا: يُنزَلُ إلى تيليجرامَ", async () => {
    const f = fixture({ findReceipt: async () => null, signalRider: async () => false });
    const out = await f.handle(delivery("COMPLETED"));
    expect(out.ok && out.value.messageId).toBe("777");
    expect(out.ok && out.value.deliveredViaBoard).toBeUndefined();
  });

  test("أحداثٌ خارجَ أطوارِ الرحلةِ تبقى تيليجرامَ أولًا (لا إشارةَ)", async () => {
    const f = fixture({ connected: true });
    // SEARCH_EXPIRED: الراكبُ غالبًا ليسَ في التطبيقِ ساعتَها.
    const out = await f.handle(delivery("SEARCH_EXPIRED"));
    expect(out.ok).toBe(true);
    expect(f.signalled).toEqual([]);
  });

  test("بلا محادثةٍ ملتقَطةٍ: لا إشارةَ (لا غرفةَ معروفةٌ) — المسارُ القديمُ يحكمُ", async () => {
    const f = fixture({ connected: true });
    const d = delivery("MATCHED");
    const out = await f.handle({ ...d, payload: { order_id: ORDER, event: "MATCHED" } });
    expect(out.ok).toBe(true);
    expect(f.signalled).toEqual([]);
    // facts.riderTelegramId يوفّرُ المحادثةَ فتُرسَلُ البطاقةُ.
    expect(f.sent).toEqual([RIDER_TG]);
  });
});
