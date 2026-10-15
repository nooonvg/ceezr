/**
 * الغرض: CAP-RUN-20261015 / عيب D5 (أثرٌ جانبيٌّ لـD4، مقيسٌ في جولة الفحص المحليّة) — بعد D4 لا تُلتقَطُ وظيفةُ
 *   المستخدمِ التاليةُ ما دامت سابقتُه محجوزة؛ فإذا انتهى الشوطُ (claim=null) ثم خُتمت السابقة، لم يكن يوقِظُ
 *   أحدٌ الدرينر: صارت وظائفُ المستخدمِ تُنجَزُ واحدةً كلَّ مؤقّتِ أمان (~10ث) — مقيس: 8 أوامر /help لزبونٍ
 *   واحدٍ بفاصلِ 10ث، وتأخّرُ قبولِ العرض حتى انتهائه.
 *   الإصلاح: شوطٌ ختمَ وظيفةً واحدةً على الأقلّ يُعيدُ الجدولةَ فورًا؛ شوطٌ فارغٌ لا يُعيد (لا دوَرانَ فارغ).
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import { startTelegramUpdateDrainer } from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type { TelegramUpdateQueue } from "../../packages/infrastructure/db/telegram-update-queue.ts";

/** طابورٌ يحاكي D4: وظائفُ مستخدمٍ واحدٍ متسلسلة؛ لا تُلتقَطُ التاليةُ قبلَ ختمِ السابقة. */
function laneQueue(
  n: number,
  c: { claims: number; finishes: number; emptyClaims: number },
): TelegramUpdateQueue {
  let inFlight = false;
  let next = 1;
  return {
    claim: async () => {
      if (inFlight || next > n) {
        c.emptyClaims += 1;
        return { job: null };
      }
      inFlight = true;
      c.claims += 1;
      const id = next++;
      return {
        job: {
          bot: "rider",
          updateId: id,
          payload: { update_id: id, message: { from: { id: 1 } } },
          claimToken: `t${id}`,
          attempts: 1,
          maxAttempts: 5,
        },
      };
    },
    finish: async () => {
      inFlight = false;
      c.finishes += 1;
      return true;
    },
    abandon: async () => true,
  } as unknown as TelegramUpdateQueue;
}
const frozenClock = {
  setInterval: (() => 0) as unknown as typeof setInterval,
  clearInterval: (() => {}) as unknown as typeof clearInterval,
};
const until = async (f: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};

describe("D5: ختمُ وظيفةٍ يُعيدُ الجدولةَ فورًا فتُفَكُّ وظيفةُ المستخدمِ التالية", () => {
  for (const lanes of [1, 8]) {
    test(`8 وظائف متسلسلة لمستخدمٍ واحدٍ بإيقاظٍ واحدٍ تُنجَزُ كلُّها بلا مؤقّت (lanes=${lanes})`, async () => {
      const c = { claims: 0, finishes: 0, emptyClaims: 0 };
      const d = startTelegramUpdateDrainer(
        {
          queue: laneQueue(8, c),
          handler: {
            handle: async () => {
              await new Promise((r) => setTimeout(r, 5));
              return true;
            },
          },
          maxJobsPerRun: 100,
          lanes,
        },
        { intervalMs: 60_000, clock: frozenClock },
      );
      d.kick();
      await until(() => c.finishes >= 8, 2000);
      await new Promise((r) => setTimeout(r, 30));
      await d.stop();
      expect(c.finishes).toBe(8);
      // لا دوَرانَ فارغ: بعدَ آخرِ ختمٍ شوطٌ واحدٌ فارغٌ على الأكثرِ ثم سكون
      const settled = c.emptyClaims;
      await new Promise((r) => setTimeout(r, 30));
      expect(c.emptyClaims).toBe(settled);
    });
  }
});
