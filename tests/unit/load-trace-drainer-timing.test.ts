/**
 * الغرض: LOAD-01 (الدفعةُ الحاديةَ عشرةَ) — أثرُ التوقيتِ التشخيصيُّ للدرينر ولمسارِ HTTP.
 *   (١) بغيابِ `timing` لا يتغيّرُ شيءٌ (النتيجةُ نفسُها)، (٢) بحضورِه لكلِّ وظيفةٍ سطرٌ واحدٌ
 *   بلحظةِ الالتقاطِ ≤ البدء ≤ النهاية، ولكلِّ شوطٍ سطرٌ بعددِ المُلتقَطِ ورحلاتِه،
 *   (٣) تطبيعُ المسارِ يطوي المعرّفاتِ فلا ينفجرُ عددُ المفاتيح، (٤) بلا ملفٍّ لا أثر.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { createLoadTrace, normaliseRoute } from "../../apps/gateway/src/background/load-trace.ts";
import {
  type DrainerJobTiming,
  type DrainerSweepTiming,
  drainTelegramUpdateJobsOnce,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

function job(bot: string, updateId: number, userId: number): ClaimedTelegramUpdateJob {
  return {
    bot,
    updateId,
    payload: { message: { from: { id: userId } } },
    claimToken: `t${updateId}`,
    attempts: 1,
    maxAttempts: 5,
  };
}

function queueOf(jobs: ClaimedTelegramUpdateJob[]): TelegramUpdateQueue {
  const all = [...jobs];
  return {
    claim: async () => ({ job: all.shift() ?? null }),
    claimFor: async (bot) => {
      const i = all.findIndex((j) => j.bot === bot);
      return { job: i < 0 ? null : (all.splice(i, 1)[0] ?? null) };
    },
    claimBatchFor: async (bot, limit) => {
      const out: ClaimedTelegramUpdateJob[] = [];
      for (let i = 0; i < all.length && out.length < limit; ) {
        if ((all[i] as ClaimedTelegramUpdateJob).bot === bot)
          out.push(all.splice(i, 1)[0] as ClaimedTelegramUpdateJob);
        else i += 1;
      }
      return { jobs: out };
    },
    finish: async () => true,
    abandon: async () => true,
  };
}

const handler = {
  handle: async () => {
    await new Promise((r) => setTimeout(r, 5));
    return true;
  },
};

describe("LOAD-01 — أثرُ توقيتِ الدرينر", () => {
  const jobs = () => [
    job("driver", 1, 11),
    job("driver", 2, 12),
    job("rider", 3, 13),
    job("driver", 4, 11),
  ];

  test("بلا timing: النتيجةُ كما هي", async () => {
    const report = await drainTelegramUpdateJobsOnce({
      queue: queueOf(jobs()),
      handler,
      lanes: 4,
      fairBots: ["driver", "rider"],
    });
    expect(report).toEqual({ claimed: 4, done: 4, failed: 0, truncated: false });
  });

  test("بـtiming: سطرٌ لكلِّ وظيفةٍ مرتّبُ اللحظات، وسطرٌ للشوط، والنتيجةُ نفسُها", async () => {
    const seen: DrainerJobTiming[] = [];
    const sweeps: DrainerSweepTiming[] = [];
    const report = await drainTelegramUpdateJobsOnce({
      queue: queueOf(jobs()),
      handler,
      lanes: 4,
      fairBots: ["driver", "rider"],
      timing: { onJob: (t) => seen.push(t), onSweep: (t) => sweeps.push(t) },
    });
    expect(report).toEqual({ claimed: 4, done: 4, failed: 0, truncated: false });
    expect(seen.map((t) => t.updateId).sort()).toEqual([1, 2, 3, 4]);
    for (const t of seen) {
      expect(t.ok).toBe(true);
      expect(t.claimedAt).toBeLessThanOrEqual(t.startedAt);
      expect(t.startedAt).toBeLessThanOrEqual(t.endedAt);
    }
    // ترتيبُ المستخدمِ الواحدِ باقٍ: الوظيفةُ 4 (المستخدمُ 11) تبدأُ بعدَ نهايةِ 1.
    const first = seen.find((t) => t.updateId === 1) as DrainerJobTiming;
    const fourth = seen.find((t) => t.updateId === 4) as DrainerJobTiming;
    expect(fourth.startedAt).toBeGreaterThanOrEqual(first.endedAt);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]?.claimed).toBe(4);
    expect(sweeps[0]?.claimTrips).toBeGreaterThan(0);
  });
});

describe("LOAD-01 — أثرُ HTTP", () => {
  test("التطبيعُ يطوي UUID والأرقامَ الطويلةَ ويُبقي البنية", () => {
    expect(
      normaliseRoute("POST", "/v1/driver/offers/3f2b1c9e-1a2b-4c3d-8e9f-0123456789ab/accept"),
    ).toBe("POST /v1/driver/offers/:id/accept");
    expect(normaliseRoute("GET", "/v1/rides/123456/events")).toBe("GET /v1/rides/:id/events");
    expect(normaliseRoute("GET", "/v1/driver/offers")).toBe("GET /v1/driver/offers");
  });

  test("بلا ملفٍّ لا أثر", () => {
    expect(createLoadTrace(undefined)).toBeNull();
    expect(createLoadTrace("")).toBeNull();
  });
});
