/**
 * الغرض: مساراتُ الدرينرِ المتوازية (SANDBOX-SOAK-01). الدرينرُ التسلسليُّ كانَ ينتظرُ
 *    دلوَ محادثةٍ واحدةٍ (رسالةٌ/ثانية) فيحجبُ كلَّ المحادثاتِ الأخرى، فقيسَ في بيئةِ
 *    الحملِ التجريبيّةِ نحوُ تحديثٍ واحدٍ في الثانيةِ للمنصّةِ كلِّها. هنا يُثبَتُ أنَّ
 *    المستخدمينَ المختلفينَ يُعالَجونَ بالتوازي، وأنَّ ترتيبَ المستخدمِ الواحدِ محفوظ،
 *    وأنَّ `lanes` الغائبَ أو غيرَ العدديِّ يبقى على السلوكِ التسلسليِّ القائم.
 * الحالة: مُختبَر.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  drainTelegramUpdateJobsOnce,
  laneKeyOf,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type { BotKind } from "../../apps/gateway/src/routes/telegram-webhook.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

interface Probe {
  readonly order: string[];
  active: number;
  peak: number;
  finishes: number;
}

/** طابورٌ محدودٌ بوظائفَ معلومةٍ بترتيبٍ معلوم. */
function fixedQueue(
  users: readonly number[],
  probe: Probe,
): { queue: TelegramUpdateQueue; size: number } {
  const jobs: ClaimedTelegramUpdateJob[] = users.map((user, index) => ({
    bot: "rider",
    updateId: index + 1,
    payload: { update_id: index + 1, message: { from: { id: user }, chat: { id: user } } },
    claimToken: `token-${index + 1}`,
    attempts: 1,
    maxAttempts: 5,
  }));
  return {
    size: jobs.length,
    queue: {
      claim: async () => ({ job: jobs.shift() ?? null }),
      finish: async () => {
        probe.finishes += 1;
        return true;
      },
      abandon: async () => true,
    } as unknown as TelegramUpdateQueue,
  };
}

/** معالِجٌ يستغرقُ زمنًا ثابتًا ويسجّلُ ترتيبَ الإنهاءِ وذروةَ التزامن. */
function slowHandler(probe: Probe, ms: number) {
  return {
    handle: async (_bot: BotKind, payload: unknown): Promise<boolean> => {
      probe.active += 1;
      probe.peak = Math.max(probe.peak, probe.active);
      await Bun.sleep(ms);
      const update = payload as { update_id: number; message: { from: { id: number } } };
      probe.order.push(`${update.message.from.id}:${update.update_id}`);
      probe.active -= 1;
      return true;
    },
  };
}

const newProbe = (): Probe => ({ order: [], active: 0, peak: 0, finishes: 0 });

describe("مساراتُ الدرينرِ لكلِّ مستخدم", () => {
  test("مستخدمانِ يتوازيان، وترتيبُ كلٍّ منهما محفوظ", async () => {
    const probe = newProbe();
    const { queue } = fixedQueue([1, 2, 1, 2, 1, 2], probe);
    const started = performance.now();
    const report = await drainTelegramUpdateJobsOnce({
      queue,
      handler: slowHandler(probe, 60),
      lanes: 8,
    });
    const elapsed = performance.now() - started;

    expect(report).toEqual({ claimed: 6, done: 6, failed: 0, truncated: false });
    expect(probe.finishes).toBe(6);
    // مستخدمانِ فقط → لا يتجاوزُ التزامنُ اثنين مهما كثرت المسارات.
    expect(probe.peak).toBe(2);
    // ثلاثُ وظائفَ متتاليةٍ لكلِّ مستخدمٍ ≈ 180ms، لا ستٌّ تسلسليّةٌ ≈ 360ms.
    expect(elapsed).toBeLessThan(320);
    expect(probe.order.filter((entry) => entry.startsWith("1:"))).toEqual(["1:1", "1:3", "1:5"]);
    expect(probe.order.filter((entry) => entry.startsWith("2:"))).toEqual(["2:2", "2:4", "2:6"]);
  });

  test("سقفُ المساراتِ يحدُّ التزامنَ بينَ المستخدمينَ المختلفين", async () => {
    const probe = newProbe();
    const { queue } = fixedQueue([1, 2, 3, 4, 5, 6, 7, 8], probe);
    const report = await drainTelegramUpdateJobsOnce({
      queue,
      handler: slowHandler(probe, 20),
      lanes: 3,
    });
    expect(report.done).toBe(8);
    expect(probe.peak).toBe(3);
  });

  test("غيابُ lanes أو قيمةٌ غيرُ عدديّةٍ = السلوكُ التسلسليُّ القائم", async () => {
    for (const lanes of [undefined, Number.NaN, 0, 1]) {
      const probe = newProbe();
      const { queue } = fixedQueue([1, 2, 3], probe);
      const report = await drainTelegramUpdateJobsOnce({
        queue,
        handler: slowHandler(probe, 5),
        ...(lanes === undefined ? {} : { lanes }),
      });
      expect(report.done).toBe(3);
      expect(probe.peak).toBe(1);
      expect(probe.order).toEqual(["1:1", "2:2", "3:3"]);
    }
  });

  test("سقفُ الشوطِ يبقى مُحترَمًا في المسارِ المتوازي", async () => {
    const probe = newProbe();
    const { queue } = fixedQueue([1, 2, 3, 4, 5], probe);
    const report = await drainTelegramUpdateJobsOnce({
      queue,
      handler: slowHandler(probe, 1),
      lanes: 4,
      maxJobsPerRun: 2,
    });
    expect(report).toEqual({ claimed: 2, done: 2, failed: 0, truncated: true });
  });
});

describe("laneKeyOf", () => {
  test("المُرسِلُ يسبقُ المحادثة، والبوتُ جزءٌ من المفتاح", () => {
    expect(laneKeyOf("driver", { message: { from: { id: 7 }, chat: { id: -100 } } }, "1")).toBe(
      "driver:7",
    );
    expect(laneKeyOf("rider", { message: { from: { id: 7 }, chat: { id: 7 } } }, "1")).toBe(
      "rider:7",
    );
  });

  test("ضغطةٌ في القروبِ تُنسَبُ للسائقِ لا للقروب", () => {
    const payload = { callback_query: { from: { id: 42 }, message: { chat: { id: -100123 } } } };
    expect(laneKeyOf("driver", payload, "9")).toBe("driver:42");
  });

  test("طلبُ الانضمامِ يُنسَبُ لصاحبه", () => {
    expect(
      laneKeyOf("driver", { chat_join_request: { from: { id: 5 }, chat: { id: -1 } } }, "3"),
    ).toBe("driver:5");
  });

  test("تحديثٌ بلا مستخدمٍ يأخذُ مسارًا خاصًّا به", () => {
    expect(laneKeyOf("driver", { update_id: 11 }, "11")).toBe("driver:u11");
    expect(laneKeyOf("driver", null, "12")).toBe("driver:u12");
  });
});
