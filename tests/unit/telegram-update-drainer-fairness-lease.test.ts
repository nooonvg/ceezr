/**
 * الغرض: CAP-RUN-20261015 / D2 + D3 (وحدة).
 *   D2: حجبُ رأسِ الصفِّ بين البوتين — طابورٌ تتقدّمُه آلافُ وظائفِ بوتٍ مُختنِقٍ يُوقِفُ البوتَ الآخر.
 *   D3: الوظيفةُ المنتظرةُ في مسارِها يُجدَّدُ إيجارُها ما دامت محجوزة.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  drainTelegramUpdateJobsOnce,
  parseTelegramDrainLanes,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

type J = ClaimedTelegramUpdateJob;
function twoBotQueue(riderJobs: number, driverJobs: number) {
  const all: J[] = [];
  let id = 0;
  for (let i = 0; i < riderJobs; i++)
    all.push({
      bot: "rider",
      updateId: ++id,
      payload: { message: { from: { id: 1000 + i } } },
      claimToken: `t${id}`,
      attempts: 1,
      maxAttempts: 5,
    });
  for (let i = 0; i < driverJobs; i++)
    all.push({
      bot: "driver",
      updateId: ++id,
      payload: { message: { from: { id: 5000 + i } } },
      claimToken: `t${id}`,
      attempts: 1,
      maxAttempts: 5,
    });
  const order: string[] = [];
  const renewCalls: number[] = [];
  const q: TelegramUpdateQueue = {
    claim: async () => ({ job: all.shift() ?? null }),
    claimFor: async (bot: string) => {
      const i = all.findIndex((j) => j.bot === bot);
      return { job: i < 0 ? null : (all.splice(i, 1)[0] as J) };
    },
    renew: async (leases) => {
      renewCalls.push(leases.length);
      return leases.length;
    },
    finish: async (l) => {
      order.push(l.bot);
      return true;
    },
    abandon: async () => true,
  };
  return { q, order, renewCalls };
}
// البوتُ «rider» مختنقٌ بدلوِه: كلُّ معالجةٍ 30ms؛ «driver» سريعٌ 1ms.
const handler = {
  handle: async (bot: string) => {
    await new Promise((r) => setTimeout(r, bot === "rider" ? 30 : 1));
    return true;
  },
};

describe("D2: توزيعُ المساراتِ بين البوتين", () => {
  test("إعادةُ إنتاج: بلا توزيعٍ، وظائفُ driver اللاحقةُ تنتظرُ كلَّ وظائفِ rider", async () => {
    const f = twoBotQueue(200, 40);
    await drainTelegramUpdateJobsOnce({
      queue: (({ claimFor: _c, ...rest }) => rest)(f.q),
      handler: handler as never,
      maxJobsPerRun: 1000,
      lanes: 10,
    });
    const firstDriver = f.order.indexOf("driver");
    expect(firstDriver).toBeGreaterThanOrEqual(190);
  });
  test("بالتوزيع: كلُّ وظائفِ driver تُنجَزُ قبلَ ربعِ وظائفِ rider", async () => {
    const f = twoBotQueue(200, 40);
    await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: handler as never,
      maxJobsPerRun: 1000,
      lanes: 10,
      fairBots: ["driver", "rider"],
    });
    const lastDriver = f.order.lastIndexOf("driver");
    const ridersBefore = f.order.slice(0, lastDriver).filter((b) => b === "rider").length;
    expect(f.order.length).toBe(240);
    expect(ridersBefore).toBeLessThan(50);
  });
});

describe("D3: تجديدُ إيجارِ المحجوزِ المنتظر", () => {
  test("مستخدمٌ واحدٌ بستِّ وظائفَ متتابعةٍ: يُجدَّدُ إيجارُ المنتظرِ، وكلٌّ يُختَمُ مرّةً", async () => {
    const jobs: J[] = Array.from({ length: 6 }, (_, i) => ({
      bot: "rider",
      updateId: i + 1,
      payload: { message: { from: { id: 42 } } },
      claimToken: `t${i}`,
      attempts: 1,
      maxAttempts: 5,
    }));
    const finished: number[] = [];
    const renewed: number[] = [];
    const q: TelegramUpdateQueue = {
      claim: async () => ({ job: jobs.shift() ?? null }),
      renew: async (l) => {
        renewed.push(l.length);
        return l.length;
      },
      finish: async (l) => {
        finished.push(l.updateId);
        return true;
      },
      abandon: async () => true,
    };
    await drainTelegramUpdateJobsOnce({
      queue: q,
      handler: {
        handle: async () => {
          await new Promise((r) => setTimeout(r, 150));
          return true;
        },
      } as never,
      maxJobsPerRun: 100,
      lanes: 8,
      leaseRenewEveryMs: 250,
    });
    expect(finished).toEqual([1, 2, 3, 4, 5, 6]); // الترتيبُ محفوظٌ ولا ختمَ مكرّر
    expect(renewed.length).toBeGreaterThan(0);
    expect(Math.max(...renewed)).toBeGreaterThanOrEqual(4); // المنتظرونَ في المسارِ جُدِّدوا
  });
});

describe("TELEGRAM_DRAIN_LANES: تحليلٌ صريح", () => {
  test.each([
    [undefined, 1, false],
    ["", 1, false],
    ["1", 1, false],
    ["96", 96, false],
    ["256", 256, false],
    ["257", 1, true],
    ["0", 1, true],
    ["-5", 1, true],
    ["abc", 1, true],
    ["1e3", 1, true],
    ["8.5", 1, true],
    [" 12 ", 12, false],
  ] as const)("%p ⇒ %p", (raw, lanes, invalid) => {
    expect(parseTelegramDrainLanes(raw as string | undefined)).toEqual({ lanes, invalid });
  });
});
