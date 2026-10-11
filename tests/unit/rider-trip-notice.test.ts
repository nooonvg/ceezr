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
import type { DriverJobDeps } from "../../packages/application/driver/driver-job.ts";
import {
  completeDriverRide,
  markDriverArrived,
  startDriverRide,
} from "../../packages/application/driver/driver-job.ts";
import {
  noticeRiderOfTrip,
  type RiderTripFacts,
  type RiderTripNoticeDeps,
  riderTripText,
} from "../../packages/application/driver/rider-trip-notice.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const FACTS: RiderTripFacts = {
  riderTelegramId: "8738396069",
  language: "ar",
  driverName: "سائق",
  plate: "ABC 123",
  vehicle: "sedan",
};

interface Sent {
  readonly to: string;
  readonly text: string;
  readonly keyboard: Keyboard | null;
}

function notice(options: { readonly throws?: boolean } = {}): {
  deps: RiderTripNoticeDeps;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  return {
    sent,
    deps: {
      facts: { read: async () => FACTS },
      counterpart: {
        notify: async (to, text, keyboard) => {
          if (options.throws === true) throw new Error("telegram down");
          sent.push({ to, text, keyboard });
        },
      },
      miniAppUrl: "https://waslah-miniapp.onrender.com/",
    },
  };
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

describe("RIDE-NOTICE-01 — إخطارُ الراكبِ بطَورِ رحلتِه", () => {
  test("كلُّ طَورٍ له نصٌّ بلغةِ الراكبِ لا مفتاحٌ خامٌ", () => {
    for (const event of ["MATCHED", "ARRIVED", "STARTED", "COMPLETED"] as const) {
      const text = riderTripText(event, ORDER, FACTS);
      expect(text).not.toContain("tracking.");
      expect(text).toContain("#5c6a72c2");
    }
    expect(riderTripText("ARRIVED", ORDER, FACTS)).toContain("ABC 123");
  });

  test("الوصولُ والبدءُ والإنهاءُ تُخطِرُ الراكبَ على معرِّفِه", async () => {
    const n = notice();
    const deps = jobDeps(n.deps);
    expect((await markDriverArrived(deps, { accessToken: "t", orderId: ORDER })).ok).toBe(true);
    expect((await startDriverRide(deps, { accessToken: "t", orderId: ORDER })).ok).toBe(true);
    expect((await completeDriverRide(deps, { accessToken: "t", orderId: ORDER })).ok).toBe(true);
    expect(n.sent.map((s) => s.to)).toEqual(["8738396069", "8738396069", "8738396069"]);
    // الإنهاءُ يفتحُ الملخّصَ، وما قبلَه يفتحُ شاشةَ الرحلةِ.
    const urls = n.sent.map((s) =>
      s.keyboard?.kind === "inline" ? (s.keyboard.rows[0]?.[0]?.webAppUrl ?? "") : "",
    );
    expect(urls[0]).toContain("ride_");
    expect(urls[2]).toContain("summary_");
  });

  test("طَورٌ رُفِضَ لا يُخطِرُ أحداً", async () => {
    const n = notice();
    const result = await markDriverArrived(jobDeps(n.deps, true), {
      accessToken: "t",
      orderId: ORDER,
    });
    expect(result.ok).toBe(false);
    expect(n.sent).toHaveLength(0);
  });

  test("عطلُ تلغرامَ لا يُحوِّلُ الطَّورَ الناجحَ رفضاً", async () => {
    const n = notice({ throws: true });
    const result = await markDriverArrived(jobDeps(n.deps), { accessToken: "t", orderId: ORDER });
    expect(result.ok).toBe(true);
  });

  test("غيابُ المنفذِ يُسكِتُ الإخطارَ وحدَه", async () => {
    await expect(noticeRiderOfTrip(undefined, ORDER, "ARRIVED")).resolves.toBeUndefined();
  });
});

describe("WR-15 — ما لا يصل الراكب يُسجَّل ولا يُبتلع صامتًا", () => {
  test("إخفاق الإرسال يُسجَّل بالطور ومعرّف الطلب، بلا معرّف تيليجرام", async () => {
    const events: { event: string; meta: Record<string, unknown> }[] = [];
    const { deps } = notice({ throws: true });
    await noticeRiderOfTrip(
      { ...deps, log: (event, meta) => events.push({ event, meta }) },
      ORDER,
      "ARRIVED",
    );
    expect(events).toEqual([
      { event: "rider_trip_notice.created", meta: { event: "ARRIVED", order_id: ORDER } },
      {
        event: "rider_trip_notice.failed",
        meta: { event: "ARRIVED", order_id: ORDER, error: "Error" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(FACTS.riderTelegramId);
  });

  test("غياب الحقائق يُسجَّل", async () => {
    const events: { event: string; meta: Record<string, unknown> }[] = [];
    const { deps } = notice();
    await noticeRiderOfTrip(
      {
        ...deps,
        facts: { read: async () => null },
        log: (event, meta) => events.push({ event, meta }),
      },
      ORDER,
      "STARTED",
    );
    expect(events).toEqual([
      { event: "rider_trip_notice.facts_missing", meta: { event: "STARTED", order_id: ORDER } },
    ]);
  });

  test("النجاح يسجّل «أنشأنا الإشعار» وحده (قبول Telegram يسجّله الجسر)", async () => {
    const events: unknown[] = [];
    const { deps, sent } = notice();
    await noticeRiderOfTrip({ ...deps, log: (event) => events.push(event) }, ORDER, "MATCHED");
    expect(sent).toHaveLength(1);
    expect(events).toEqual(["rider_trip_notice.created"]);
  });
});
