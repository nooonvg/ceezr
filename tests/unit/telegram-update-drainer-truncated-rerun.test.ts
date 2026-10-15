/**
 * الغرض: CAP-RUN-20261015 / عيب D1 — شوطٌ مقطوعٌ بالسقفِ (`truncated`) كانَ ينتهي بلا إعادةِ جدولة،
 *   فلا يُستأنَفُ الاستنزافُ إلّا بإيقاظٍ جديدٍ أو بعدَ مؤقّتِ الأمانِ (10ث). تحتَ تراكمٍ بلا واردٍ جديدٍ
 *   صارَ السقفُ (100 وظيفة) كلَّ 10ث = 10 تحديثات/ث للمنصّةِ كلِّها — مقيسٌ في الجولةِ المحليّة.
 *   الإصلاح: الشوطُ المقطوعُ يُعيدُ الجدولةَ فورًا (السقفُ يبقى حدًّا للشوطِ الواحدِ لا لمعدّلِ الاستنزاف).
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { startTelegramUpdateDrainer } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type { TelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

function finiteQueue(count: number, c: { claims: number; finishes: number }): TelegramUpdateQueue {
  return {
    claim: async () => {
      if (c.claims >= count) return { job: null };
      c.claims += 1;
      return {
        job: {
          bot: "rider",
          updateId: c.claims,
          payload: { update_id: c.claims, message: { from: { id: c.claims % 7 } } },
          claimToken: `t${c.claims}`,
          attempts: 1,
          maxAttempts: 5,
        },
      };
    },
    finish: async () => {
      c.finishes += 1;
      return true;
    },
    abandon: async () => true,
  } as unknown as TelegramUpdateQueue;
}
/** مؤقّتٌ لا يُطلِقُ أبدًا: فما يُستنزَفُ يُستنزَفُ بالإيقاظِ وإعادةِ الجدولةِ وحدَهما. */
const frozenClock = {
  setInterval: (() => 0) as unknown as typeof setInterval,
  clearInterval: (() => {}) as unknown as typeof clearInterval,
};
const handles = { handle: async () => true };
const until = async (f: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};

describe("D1: الشوطُ المقطوعُ يُعيدُ الجدولةَ فورًا", () => {
  for (const lanes of [1, 8]) {
    test(`250 وظيفة بسقف 100 وإيقاظٍ واحد تُستنزَفُ كلُّها بلا مؤقّت (lanes=${lanes})`, async () => {
      const c = { claims: 0, finishes: 0 };
      const d = startTelegramUpdateDrainer(
        { queue: finiteQueue(250, c), handler: handles, maxJobsPerRun: 100, lanes },
        { intervalMs: 60_000, clock: frozenClock },
      );
      d.kick();
      await until(() => c.finishes >= 250, 2000);
      await d.stop();
      expect(c.claims).toBe(250);
      expect(c.finishes).toBe(250); // لا ختمَ مكرّر ولا مفقود
    });
  }
  test("طابورٌ لا يفرُغُ: stop() ما زالَ ينهي الحلقةَ", async () => {
    const c = { claims: 0, finishes: 0 };
    const d = startTelegramUpdateDrainer(
      {
        queue: finiteQueue(Number.MAX_SAFE_INTEGER, c),
        handler: handles,
        maxJobsPerRun: 10,
        lanes: 4,
      },
      { intervalMs: 60_000, clock: frozenClock },
    );
    d.kick();
    await until(() => c.claims >= 100, 2000);
    await d.stop();
    const after = c.claims;
    await new Promise((r) => setTimeout(r, 50));
    expect(c.claims).toBe(after);
    expect(c.finishes).toBe(c.claims);
  });
});
