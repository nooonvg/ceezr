/**
 * الغرض: LOAD-01 (الدفعةُ السابعةُ) — التقاطٌ دُفعيٌّ مرتّبٌ في درينرِ تحديثاتِ تيليجرام.
 *   المقيسُ (`diag-r12-jobtiming-500`): الالتقاطُ المفردُ ~40ms للرحلةِ تحتَ الحملِ ⇒ الجاري
 *   4–5 من 32 مسارًا والإتمامُ ~25/ث ⇒ تفوتُ مهلةُ إثباتِ الهاتفِ (G1 = 73%). وبعدَه
 *   (`diag-r12-batchclaim-500`): زمنُ إتمامِ الوظيفةِ p50 = 0.6ث وG1 = 99.78%.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { drainTelegramUpdateJobsOnce } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

type J = ClaimedTelegramUpdateJob;
const ROUND_TRIP_MS = 20;

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

function slowQueue(jobs: J[], opts: { batch: boolean }) {
  const all = [...jobs];
  const trips: number[] = [];
  const done: J[] = [];
  const take = (bot: string, limit: number): J[] => {
    const out: J[] = [];
    for (let i = 0; i < all.length && out.length < limit; ) {
      if ((all[i] as J).bot === bot) out.push(all.splice(i, 1)[0] as J);
      else i += 1;
    }
    return out;
  };
  const trip = async () => new Promise((r) => setTimeout(r, ROUND_TRIP_MS));
  const q: TelegramUpdateQueue = {
    claim: async () => {
      await trip();
      trips.push(1);
      return { job: all.shift() ?? null };
    },
    claimFor: async (bot) => {
      await trip();
      trips.push(1);
      return { job: take(bot, 1)[0] ?? null };
    },
    ...(opts.batch
      ? {
          claimBatchFor: async (bot: string, limit: number) => {
            await trip();
            trips.push(limit);
            return { jobs: take(bot, limit) };
          },
        }
      : {}),
    finish: async (lease) => {
      const found = jobs.find((j) => j.updateId === lease.updateId);
      if (found) done.push(found);
      return true;
    },
    abandon: async () => true,
  };
  return { q, trips, done };
}

function tracker() {
  let active = 0;
  let peak = 0;
  return {
    handler: {
      handle: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        return true;
      },
    },
    peak: () => peak,
  };
}

describe("LOAD-01 — الالتقاطُ الدُّفعيُّ في الدرينر", () => {
  test("إعادةُ إنتاج: الالتقاطُ المفردُ البطيءُ لا يملأُ المسارات", async () => {
    const jobs = Array.from({ length: 64 }, (_, i) => job("driver", i + 1, 9000 + i));
    const f = slowQueue(jobs, { batch: false });
    const t = tracker();
    await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: t.handler as never,
      maxJobsPerRun: 1000,
      lanes: 16,
      fairBots: ["driver", "rider"],
    });
    expect(f.done.length).toBe(64);
    // معالجةٌ 30ms ورحلةٌ 20ms ⇒ لا يجري في آنٍ إلا ~2 مهما كثرت المسارات.
    expect(t.peak()).toBeLessThanOrEqual(3);
  });

  test("الدُّفعةُ تملأُ المساراتِ برحلاتٍ أقلَّ وتُنجزُ الكلَّ", async () => {
    const jobs = Array.from({ length: 64 }, (_, i) => job("driver", i + 1, 9000 + i));
    const f = slowQueue(jobs, { batch: true });
    const t = tracker();
    await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: t.handler as never,
      maxJobsPerRun: 1000,
      lanes: 16,
      fairBots: ["driver", "rider"],
    });
    expect(f.done.length).toBe(64);
    expect(t.peak()).toBeGreaterThanOrEqual(8);
    expect(f.trips.length).toBeLessThan(64 / 2);
    // لا دُفعةَ تتجاوزُ نصيبَ البوتِ من المساراتِ (16 / بوتين).
    expect(Math.max(...f.trips)).toBeLessThanOrEqual(8);
  });

  test("ترتيبُ تحديثاتِ المستخدمِ الواحدِ محفوظٌ داخلَ الدُّفعةِ وعبرَ الدُّفعات", async () => {
    const jobs: J[] = [];
    let id = 0;
    for (let round = 0; round < 6; round++)
      for (let user = 0; user < 5; user++) jobs.push(job("driver", ++id, 7000 + user));
    const f = slowQueue(jobs, { batch: true });
    const seen = new Map<number, number[]>();
    await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: {
        handle: async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 10));
          return true;
        },
      } as never,
      maxJobsPerRun: 1000,
      lanes: 8,
      fairBots: ["driver", "rider"],
    });
    for (const j of f.done) {
      const user = (j.payload as { message: { from: { id: number } } }).message.from.id;
      seen.set(user, [...(seen.get(user) ?? []), j.updateId]);
    }
    expect(seen.size).toBe(5);
    for (const ids of seen.values()) expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  test("سقفُ الشوطِ يحكمُ الدُّفعةَ: لا التقاطَ فوقَ maxJobsPerRun", async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => job("driver", i + 1, 9000 + i));
    const f = slowQueue(jobs, { batch: true });
    const report = await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: tracker().handler as never,
      maxJobsPerRun: 10,
      lanes: 16,
      fairBots: ["driver", "rider"],
    });
    expect(report.claimed).toBe(10);
    expect(report.truncated).toBe(true);
    expect(f.done.length).toBe(10);
  });

  test("الإنصافُ بين البوتين باقٍ مع الدُّفعة", async () => {
    const jobs: J[] = [];
    for (let i = 0; i < 40; i++) jobs.push(job("rider", i + 1, 1000 + i));
    for (let i = 0; i < 10; i++) jobs.push(job("driver", 100 + i, 5000 + i));
    const f = slowQueue(jobs, { batch: true });
    await drainTelegramUpdateJobsOnce({
      queue: f.q,
      handler: tracker().handler as never,
      maxJobsPerRun: 1000,
      lanes: 8,
      fairBots: ["driver", "rider"],
    });
    const firstDriver = f.done.findIndex((j) => j.bot === "driver");
    expect(firstDriver).toBeLessThan(10);
    expect(f.done.length).toBe(50);
  });
});
