/**
 * الغرض: LOAD-01 (الدفعةُ 21) — أطوارُ الرحلةِ الثلاثةُ مع إيداعِ إشعارِ الراكبِ في عبارةٍ واحدة:
 *   المسارُ المدمجُ يُستعمَلُ فقط حينَ يُطلَبُ الإشعارُ ويدعمُه المخزن، والجلسةُ (ومعها إلغاؤها عندَ
 *   الحظر) تُفحَصُ قبلَه في كلِّ طلبٍ كما كانت، والرفضُ يعودُ بلا إيداع، وغيابُ حقلِ الإيداعِ يعودُ
 *   إلى المسارِ المستقلّ، وغيابُ المنفذِ المدمجِ يُبقي النداءَين حرفًا.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import type { DriverJobDeps } from "../../packages/application/driver/driver-job.ts";
import {
  completeDriverRide,
  markDriverArrived,
  startDriverRide,
} from "../../packages/application/driver/driver-job.ts";
import type {
  RiderTripDepositOutcome,
  RiderTripEvent,
  RiderTripNoticeDeps,
} from "../../packages/application/driver/rider-trip-notice.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";
const DRIVER = "643077811";

interface Harness {
  readonly deps: DriverJobDeps;
  readonly calls: string[];
  readonly enqueued: RiderTripEvent[];
  readonly deposited: RiderTripEvent[];
  readonly logs: string[];
  revoked: boolean;
}

function harness(options: {
  readonly combined?: boolean;
  readonly reject?: boolean;
  readonly notice?: RiderTripDepositOutcome | null;
  readonly riderNotice?: boolean;
}): Harness {
  const calls: string[] = [];
  const enqueued: RiderTripEvent[] = [];
  const deposited: RiderTripEvent[] = [];
  const logs: string[] = [];
  const h = { calls, enqueued, deposited, logs, revoked: false } as Harness;
  const stamp = { orderId: ORDER };
  const notice: RiderTripDepositOutcome | undefined =
    options.notice === null
      ? undefined
      : (options.notice ?? { kind: "deposited", created: true, riderTelegramId: "8738396069" });
  const rejected = err({ kind: "rejected", code: "JOB_NOT_FOUND" } as never);
  const phase =
    <T>(name: string, value: T) =>
    async (input: { telegramUserId: string; orderId: string }) => {
      calls.push(`${name}:${input.telegramUserId}`);
      return options.reject === true ? rejected : ok(value);
    };
  const withNotice =
    <T>(name: string, value: T) =>
    async (input: { telegramUserId: string; orderId: string }) => {
      calls.push(`${name}:${input.telegramUserId}`);
      if (options.reject === true) return rejected;
      return ok(notice === undefined ? { value } : { value, notice });
    };
  const store: Record<string, unknown> = {
    readActiveJob: async () => err({ kind: "failed", code: "STORE_ERROR" }),
    markArrived: phase("markArrived", { ...stamp, arrivedAt: "x" }),
    startRide: phase("startRide", { ...stamp, startedAt: "x" }),
    completeRide: phase("completeRide", { ...stamp, completedAt: "x", durationSeconds: 7 }),
  };
  if (options.combined !== false) {
    store.markArrivedWithNotice = withNotice("markArrivedWithNotice", { ...stamp, arrivedAt: "x" });
    store.startRideWithNotice = withNotice("startRideWithNotice", { ...stamp, startedAt: "x" });
    store.completeRideWithNotice = withNotice("completeRideWithNotice", {
      ...stamp,
      completedAt: "x",
      durationSeconds: 7,
    });
  }
  const riderNotice: RiderTripNoticeDeps = {
    outbox: {
      enqueue: async (_orderId, event) => {
        enqueued.push(event);
        return { created: true };
      },
      deposited: (_orderId, event) => {
        deposited.push(event);
      },
    },
    log: (event) => logs.push(event),
  };
  (h as { deps: DriverJobDeps }).deps = {
    sessions: {
      read: async () =>
        h.revoked ? err({ reason: "revoked" }) : ok({ telegramUserId: DRIVER, sessionId: "s-1" }),
    } as unknown as DriverJobDeps["sessions"],
    now: () => new Date("2026-10-20T04:07:00Z"),
    store: store as unknown as DriverJobDeps["store"],
    ...(options.riderNotice === false ? {} : { riderNotice }),
  };
  return h;
}

const input = { accessToken: "t", orderId: ORDER };

describe("LOAD-01 (الدفعة 21) — الطورُ والإشعارُ في عبارةٍ واحدة", () => {
  test("الأطوارُ الثلاثةُ تُنادي المدمجَ مرّةً، ولا نداءَ إيداعٍ مستقلّ، والإيداعُ يُسجَّلُ ويُشار", async () => {
    const h = harness({});
    expect((await markDriverArrived(h.deps, input)).ok).toBe(true);
    expect((await startDriverRide(h.deps, input)).ok).toBe(true);
    expect((await completeDriverRide(h.deps, input)).ok).toBe(true);
    expect(h.calls).toEqual([
      `markArrivedWithNotice:${DRIVER}`,
      `startRideWithNotice:${DRIVER}`,
      `completeRideWithNotice:${DRIVER}`,
    ]);
    expect(h.enqueued).toEqual([]);
    expect(h.deposited).toEqual(["ARRIVED", "STARTED", "COMPLETED"]);
    expect(h.logs).toEqual([
      "rider_trip_notice.created",
      "rider_trip_notice.created",
      "rider_trip_notice.created",
    ]);
  });

  test("الردُّ للعميلِ هو قيمةُ الطورِ نفسُها لا غلافُها", async () => {
    const h = harness({});
    const result = await completeDriverRide(h.deps, input);
    expect(result).toEqual(ok({ orderId: ORDER, completedAt: "x", durationSeconds: 7 }));
  });

  test("الرفضُ يعودُ كما هو بلا إيداعٍ ولا إشارة", async () => {
    const h = harness({ reject: true });
    const result = await startDriverRide(h.deps, input);
    expect(result.ok).toBe(false);
    expect(h.enqueued).toEqual([]);
    expect(h.deposited).toEqual([]);
  });

  test("جلسةٌ أُلغيَت بينَ طلبَين (الحظرُ يُلغي الجلسات) ⇒ رفضٌ قبلَ أيِّ نداءٍ للمخزن", async () => {
    const h = harness({});
    expect((await markDriverArrived(h.deps, input)).ok).toBe(true);
    h.revoked = true;
    const refused = await startDriverRide(h.deps, input);
    expect(refused.ok).toBe(false);
    expect(h.calls).toEqual([`markArrivedWithNotice:${DRIVER}`]);
    expect(h.deposited).toEqual(["ARRIVED"]);
  });

  test("نجاحٌ بلا حقلِ الإيداع (منفذٌ أقدم) ⇒ المسارُ المستقلُّ مرّةً واحدة", async () => {
    const h = harness({ notice: null });
    expect((await markDriverArrived(h.deps, input)).ok).toBe(true);
    expect(h.enqueued).toEqual(["ARRIVED"]);
  });

  test("فشلُ الإيداعِ داخلَ العبارة يُسجَّلُ ولا يُحوِّلُ الطورَ رفضًا ولا يُعادُ مستقلًّا", async () => {
    const h = harness({ notice: { kind: "failed", error: "ENQUEUE_EXCEPTION" } });
    expect((await markDriverArrived(h.deps, input)).ok).toBe(true);
    expect(h.logs).toEqual(["rider_trip_notice.enqueue_failed"]);
    expect(h.enqueued).toEqual([]);
    expect(h.deposited).toEqual([]);
  });

  test("مخزنٌ بلا المدمج ⇒ نداءانِ كما كانَ حرفًا", async () => {
    const h = harness({ combined: false });
    expect((await markDriverArrived(h.deps, input)).ok).toBe(true);
    expect(h.calls).toEqual([`markArrived:${DRIVER}`]);
    expect(h.enqueued).toEqual(["ARRIVED"]);
  });

  test("بلا إشعارٍ مطلوبٍ ⇒ الطورُ وحدَه، ولا يُنادى المدمج", async () => {
    const h = harness({ riderNotice: false });
    expect((await completeDriverRide(h.deps, input)).ok).toBe(true);
    expect(h.calls).toEqual([`completeRide:${DRIVER}`]);
  });
});
