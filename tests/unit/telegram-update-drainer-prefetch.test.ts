/**
 * الغرض: LOAD-01 (الدفعةُ 20) — الالتقاطُ المسبقُ في درينرِ تحديثاتِ تيليجرام.
 *   المقيسُ (`b20-trace-base-750`، `bad2cb5e`): زمنُ تنفيذِ الوظيفةِ p50 ‏0.8ث وانتظارُ المسارِ 0،
 *   لكنَّ انتظارَ الطابورِ p50 ‏17.7ث: 97% من زمنِ الشوطِ رحلاتُ التقاطٍ متسلسلة (16–17 رحلةً لكلِّ
 *   100 وظيفة، ~200ms للرحلةِ انتظارًا على تجمّعِ `gatewayRequest`)، وكلُّ رحلةٍ تجلبُ ما فرغَ من
 *   المساراتِ لحظتَها فقط (~6). فالمساراتُ تفرغُ أثناءَ الرحلةِ والإتمامُ ~27/ث < الواردِ ~34/ث.
 *   الإصلاح: رحلةُ الالتقاطِ التاليةُ تجري في الخلفيةِ والمساراتُ تعملُ، بحجمِ نصيبِ البوتِ كاملًا،
 *   والمخزَّنُ محجوزٌ يُجدَّدُ إيجارُه ولا يتجاوزُ سقفَ الشوط.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  createDrainLaneState,
  drainTelegramUpdateJobsOnce,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

type J = ClaimedTelegramUpdateJob;

function job(bot: string, updateId: number, userId: number): J {
  return {
    bot,
    updateId,
    payload: { message: { from: { id: userId } } },
    claimToken: `t${updateId}`,
    attempts: 1,
    maxAttempts: 5,
  };
}

function slowBatchQueue(jobs: J[], tripMs: number) {
  const all = [...jobs];
  const trips: number[] = [];
  const finished: number[] = [];
  const renewed: number[][] = [];
  let tripsInFlight = 0;
  let peakTripsInFlight = 0;
  const q: TelegramUpdateQueue = {
    claim: async () => ({ job: null }),
    claimFor: async () => ({ job: null }),
    claimBatchFor: async (bot: string, limit: number) => {
      tripsInFlight += 1;
      peakTripsInFlight = Math.max(peakTripsInFlight, tripsInFlight);
      await new Promise((r) => setTimeout(r, tripMs));
      tripsInFlight -= 1;
      trips.push(limit);
      const out: J[] = [];
      for (let i = 0; i < all.length && out.length < Math.min(limit, 100); ) {
        if ((all[i] as J).bot === bot) out.push(all.splice(i, 1)[0] as J);
        else i += 1;
      }
      return { jobs: out };
    },
    finish: async (lease) => {
      finished.push(lease.updateId);
      return true;
    },
    renew: async (leases) => {
      renewed.push(leases.map((l) => l.updateId));
      return leases.length;
    },
    abandon: async () => true,
  };
  return {
    q,
    trips,
    finished,
    renewed,
    remaining: () => all.length,
    peakTrips: () => peakTripsInFlight,
  };
}

/** إشغالُ المساراتِ متكاملًا على الزمن: مجموعُ (الجاري × المدّة) ÷ (المساراتُ × الزمنُ الكلّيّ). */
function occupancyTracker(runMs: number) {
  let active = 0;
  let area = 0;
  let last = performance.now();
  const order: number[] = [];
  const tick = () => {
    const now = performance.now();
    area += active * (now - last);
    last = now;
  };
  return {
    handler: {
      handle: async (_bot: string, payload: unknown) => {
        tick();
        active += 1;
        const id = (payload as { message: { from: { id: number } } }).message.from.id;
        order.push(id);
        await new Promise((r) => setTimeout(r, runMs));
        tick();
        active -= 1;
        return true;
      },
    },
    area: () => {
      tick();
      return area;
    },
  };
}

describe("LOAD-01 (الدفعة 20) — الالتقاطُ المسبقُ يُبقي المساراتِ ممتلئة", () => {
  test("رحلةُ التقاطٍ بطيئةٌ لا تُفرغُ المسارات: الإشغالُ ≥ 80% والزمنُ قريبٌ من الأمثل", async () => {
    // نسبُ المقيس: رحلةٌ ~200ms ومعالجةٌ ~750ms و32 مسارًا ⇒ هنا 20ms و75ms و32.
    const lanes = 32;
    const runMs = 75;
    const n = 640;
    const jobs = Array.from({ length: n }, (_, i) => job("driver", i + 1, 10_000 + i));
    const f = slowBatchQueue(jobs, 20);
    const t = occupancyTracker(runMs);
    const t0 = performance.now();
    const state = createDrainLaneState();
    for (let i = 0; i < 100; i++) {
      const r = await drainTelegramUpdateJobsOnce(
        {
          queue: f.q,
          handler: t.handler as never,
          maxJobsPerRun: 100,
          lanes,
          fairBots: ["driver", "rider"],
        },
        state,
      );
      if (!r.truncated && r.claimed === 0 && state.inflight.size === 0) break;
    }
    while (state.inflight.size > 0) await Promise.allSettled([...state.inflight]);
    const elapsed = performance.now() - t0;
    expect(f.finished.length).toBe(n);
    expect(new Set(f.finished).size).toBe(n);
    const occupancy = t.area() / (lanes * elapsed);
    const ideal = (n / lanes) * runMs;
    expect(occupancy).toBeGreaterThanOrEqual(0.8);
    expect(elapsed).toBeLessThanOrEqual(ideal * 1.3);
  });

  test("لا رحلتا التقاطٍ متزامنتان، ولا دُفعةَ تتجاوزُ نصيبَ البوتِ أو حدَّ القاعدة", async () => {
    const jobs = Array.from({ length: 300 }, (_, i) => job("driver", i + 1, 20_000 + i));
    const f = slowBatchQueue(jobs, 15);
    const t = occupancyTracker(40);
    const state = createDrainLaneState();
    for (let i = 0; i < 50; i++) {
      const r = await drainTelegramUpdateJobsOnce(
        {
          queue: f.q,
          handler: t.handler as never,
          maxJobsPerRun: 100,
          lanes: 32,
          fairBots: ["driver", "rider"],
        },
        state,
      );
      if (!r.truncated && r.claimed === 0 && state.inflight.size === 0) break;
    }
    while (state.inflight.size > 0) await Promise.allSettled([...state.inflight]);
    expect(f.finished.length).toBe(300);
    expect(f.peakTrips()).toBe(1);
    expect(Math.max(...f.trips)).toBeLessThanOrEqual(16);
  });

  test("سقفُ الشوطِ يشملُ المخزَّن: لا وظيفةَ محجوزةٌ تبقى بلا مسارٍ عندَ القطع", async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => job("driver", i + 1, 30_000 + i));
    const f = slowBatchQueue(jobs, 5);
    const report = await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: occupancyTracker(5).handler as never,
      maxJobsPerRun: 10,
      lanes: 16,
      fairBots: ["driver", "rider"],
    });
    expect(report.claimed).toBe(10);
    expect(report.truncated).toBe(true);
    expect(f.finished.length).toBe(10);
    expect(f.remaining()).toBe(40);
  });

  test("المخزَّنُ المنتظرُ مسارًا يُجدَّدُ إيجارُه مع الجاري", async () => {
    // مسارٌ واحدٌ لمستخدمٍ واحد: الثانيةُ تنتظرُ الأولى في المخزَّنِ أو السلسلة — وكلاهما محجوز.
    const jobs = Array.from({ length: 6 }, (_, i) => job("driver", i + 1, 40_000));
    const f = slowBatchQueue(jobs, 1);
    await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: occupancyTracker(120).handler as never,
      maxJobsPerRun: 100,
      lanes: 2,
      fairBots: ["driver", "rider"],
      leaseRenewEveryMs: 250,
    });
    expect(f.finished).toEqual([1, 2, 3, 4, 5, 6]);
    // كلُّ تجديدٍ يشملُ كلَّ ما التُقطَ ولم يُختَم — لا محجوزَ يفوتُه التجديد.
    const firstRenew = f.renewed[0] ?? [];
    expect(firstRenew.length).toBeGreaterThanOrEqual(2);
  });
});
