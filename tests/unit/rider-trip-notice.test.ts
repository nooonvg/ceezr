/**
 * الغرض: قياسُ إخطارِ الراكبِ بطَورِ رحلتِه من مسارِ السائقِ في التطبيقِ المصغَّرِ
 *   (`RIDE-NOTICE-01`): أنَّ كلَّ طَورٍ يُخطِرُ، وأنَّ الطَّورَ الفاشلَ لا يُخطِرُ،
 *   وأنَّ عطلَ الإخطارِ لا يُحوِّلُ طَوراً ناجحاً إلى رفضٍ.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 */

import { describe, expect, test } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import { createRiderTripNoticeHandler } from "../../packages/application/dispatch/deliver-rider-trip-notice.ts";
import type { DriverJobDeps } from "../../packages/application/driver/driver-job.ts";
import {
  completeDriverRide,
  markDriverArrived,
  startDriverRide,
} from "../../packages/application/driver/driver-job.ts";
import {
  noticeRiderOfTrip,
  type RiderTripEvent,
  type RiderTripFacts,
  type RiderTripNoticeDeps,
  riderTripText,
} from "../../packages/application/driver/rider-trip-notice.ts";
import type { OutboxDelivery } from "../../packages/application/notification/deliver-notification.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const FACTS: RiderTripFacts = {
  riderTelegramId: "8738396069",
  language: "ar",
  driverName: "سائق",
  plate: "ABC 123",
  vehicle: "sedan",
};

interface Queued {
  readonly orderId: string;
  readonly event: RiderTripEvent;
}

/** صندوقُ صادرٍ في الذاكرةِ بمفتاحِ منعِ التكرارِ نفسِه (`<order>:<event>`). */
function notice(options: { readonly throws?: boolean; readonly missing?: boolean } = {}): {
  deps: RiderTripNoticeDeps;
  queued: Queued[];
} {
  const queued: Queued[] = [];
  return {
    queued,
    deps: {
      outbox: {
        enqueue: async (orderId, event) => {
          if (options.throws === true) throw new Error("db down");
          if (options.missing === true) return null;
          const seen = queued.some((q) => q.orderId === orderId && q.event === event);
          if (!seen) queued.push({ orderId, event });
          return { created: !seen };
        },
      },
    },
  };
}

interface Sent {
  readonly to: string;
  readonly text: string;
  readonly keyboard: Keyboard | null;
}

function delivery(payload: Record<string, unknown>, attempts = 1, maxAttempts = 3): OutboxDelivery {
  return {
    deliveryId: "d-1",
    kind: "rider_trip_notice",
    cityId: "c-1" as OutboxDelivery["cityId"],
    claimToken: "tok",
    attempts,
    maxAttempts,
    batchLimit: 1,
    requestId: null,
    payload,
  };
}

function handler(options: {
  readonly reply?: string | null;
  readonly throws?: boolean;
  readonly facts?: RiderTripFacts | null;
}) {
  const sent: Sent[] = [];
  const events: { event: string; meta: Record<string, unknown> }[] = [];
  const handle = createRiderTripNoticeHandler({
    facts: { read: async () => (options.facts === undefined ? FACTS : options.facts) },
    sender: {
      sendReturningId: async (to, text, keyboard) => {
        if (options.throws === true) throw new TypeError("network");
        sent.push({ to, text, keyboard });
        return options.reply === undefined ? "777" : options.reply;
      },
    },
    miniAppUrl: "https://waslah-miniapp.onrender.com/",
    log: (event, meta) => events.push({ event, meta }),
  });
  return { handle, sent, events };
}

function jobDeps(riderNotice: RiderTripNoticeDeps, fail = false): DriverJobDeps {
  const stamp = { orderId: ORDER };
  return {
    sessions: {
      read: async () => ok({ telegramUserId: "643077811" }),
    } as unknown as DriverJobDeps["sessions"],
    now: () => new Date("2026-10-03T04:07:00Z"),
    store: {
      readActiveJob: async () => err({ kind: "failed", code: "STORE_ERROR" }),
      markArrived: async () =>
        fail ? err({ kind: "rejected", code: "NOT_YOUR_ORDER" }) : ok({ ...stamp, arrivedAt: "x" }),
      startRide: async () => ok({ ...stamp, startedAt: "x" }),
      completeRide: async () => ok({ ...stamp, completedAt: "x", durationSeconds: 7 }),
    } as unknown as DriverJobDeps["store"],
    riderNotice,
  };
}

describe("RIDE-NOTICE-01 · WR-15 — إيداعُ إشعارِ الطورِ من مسارِ السائق", () => {
  test("كلُّ طَورٍ له نصٌّ بلغةِ الراكبِ لا مفتاحٌ خامٌ", () => {
    for (const event of ["MATCHED", "ARRIVED", "STARTED", "COMPLETED"] as const) {
      const text = riderTripText(event, ORDER, FACTS);
      expect(text).not.toContain("tracking.");
      expect(text).toContain("#5c6a72c2");
    }
    expect(riderTripText("ARRIVED", ORDER, FACTS)).toContain("ABC 123");
  });

  test("الوصولُ والبدءُ والإنهاءُ تُودِعُ صفّاً لكلِّ طورٍ، ولا تُرسلُ من المسار", async () => {
    const n = notice();
    const deps = jobDeps(n.deps);
    expect((await markDriverArrived(deps, { accessToken: "t", orderId: ORDER })).ok).toBe(true);
    expect((await startDriverRide(deps, { accessToken: "t", orderId: ORDER })).ok).toBe(true);
    expect((await completeDriverRide(deps, { accessToken: "t", orderId: ORDER })).ok).toBe(true);
    expect(n.queued.map((q) => q.event)).toEqual(["ARRIVED", "STARTED", "COMPLETED"]);
  });

  test("الضغطةُ المكرّرةُ لا تُودِعُ صفّاً ثانياً وتُسجَّلُ «مكرّرة»", async () => {
    const n = notice();
    const events: string[] = [];
    const deps = { ...n.deps, log: (event: string) => events.push(event) };
    await noticeRiderOfTrip(deps, ORDER, "ARRIVED");
    await noticeRiderOfTrip(deps, ORDER, "ARRIVED");
    expect(n.queued).toHaveLength(1);
    expect(events).toEqual(["rider_trip_notice.created", "rider_trip_notice.deduplicated"]);
  });

  test("طَورٌ رُفِضَ لا يُودِعُ شيئاً", async () => {
    const n = notice();
    const result = await markDriverArrived(jobDeps(n.deps, true), {
      accessToken: "t",
      orderId: ORDER,
    });
    expect(result.ok).toBe(false);
    expect(n.queued).toHaveLength(0);
  });

  test("عطلُ الإيداعِ يُسجَّلُ ولا يُحوِّلُ الطَّورَ الناجحَ رفضاً", async () => {
    const events: { event: string; meta: Record<string, unknown> }[] = [];
    const n = notice({ throws: true });
    const deps = jobDeps({ ...n.deps, log: (event, meta) => events.push({ event, meta }) });
    const result = await markDriverArrived(deps, { accessToken: "t", orderId: ORDER });
    expect(result.ok).toBe(true);
    expect(events).toEqual([
      {
        event: "rider_trip_notice.enqueue_failed",
        meta: { event: "ARRIVED", order_id: ORDER, error: "Error" },
      },
    ]);
  });

  test("طلبٌ غيرُ موجودٍ يُسجَّلُ", async () => {
    const events: string[] = [];
    const n = notice({ missing: true });
    await noticeRiderOfTrip({ ...n.deps, log: (event) => events.push(event) }, ORDER, "STARTED");
    expect(events).toEqual(["rider_trip_notice.order_missing"]);
  });

  test("غيابُ المنفذِ يُسكِتُ الإخطارَ وحدَه", async () => {
    await expect(noticeRiderOfTrip(undefined, ORDER, "ARRIVED")).resolves.toBeUndefined();
  });
});

describe("WR-15 — معالجُ العاملِ: قبولُ Telegram API ليسَ ظهوراً على الهاتف", () => {
  test("يُرسلُ إلى محادثةِ الراكبِ المقروءةِ لحظةَ الالتقاطِ، ويُسجِّلُ المحاولةَ والقبول", async () => {
    const h = handler({});
    const result = await h.handle(
      delivery({ order_id: ORDER, event: "COMPLETED", chat_id: "8738396069", language: "ar" }),
    );
    expect(result.ok && result.value.messageId).toBe("777");
    expect(h.sent.map((s) => s.to)).toEqual(["8738396069"]);
    const url =
      h.sent[0]?.keyboard?.kind === "inline"
        ? (h.sent[0].keyboard.rows[0]?.[0]?.webAppUrl ?? "")
        : "";
    expect(url).toContain("summary_");
    expect(h.events.map((e) => e.event)).toEqual([
      "rider_trip_notice.attempted",
      "rider_trip_notice.accepted",
    ]);
    expect(JSON.stringify(h.events)).not.toContain("8738396069");
  });

  test("رفضُ تيليجرام فشلٌ يُعادُ، وآخرُ محاولةٍ تُسجَّلُ فشلاً نهائيّاً", async () => {
    const first = handler({ reply: null });
    const r1 = await first.handle(delivery({ order_id: ORDER, event: "ARRIVED", chat_id: "1" }, 1));
    expect(r1.ok && r1.value.failure).toBe("TELEGRAM_REJECTED");
    expect(first.events.at(-1)?.event).toBe("rider_trip_notice.send_failed");

    const last = handler({ throws: true });
    const r3 = await last.handle(
      delivery({ order_id: ORDER, event: "ARRIVED", chat_id: "1" }, 3, 3),
    );
    expect(r3.ok && r3.value.failure).toBe("TypeError");
    expect(last.events.at(-1)?.event).toBe("rider_trip_notice.final_failure");
  });

  test("راكبٌ لا محادثةَ له يُعلَنُ undeliverable لا يُعادُ", async () => {
    const h = handler({ facts: null });
    const result = await h.handle(delivery({ order_id: ORDER, event: "MATCHED" }));
    expect(result.ok && result.value.undeliverable).toBe(true);
    expect(h.sent).toHaveLength(0);
  });

  test("حمولةٌ معطوبةٌ تُتركُ بلا إعادة", async () => {
    const h = handler({});
    const result = await h.handle(delivery({ order_id: ORDER, event: "TELEPORTED" }));
    expect(result.ok && result.value.abandon).toBe(true);
    expect(h.sent).toHaveLength(0);
  });
});
