/**
 * الغرض: LOAD-01 (الدفعةُ الحاديةَ عشرةَ) — حاجزُ نهايةِ الشوطِ المقطوع.
 *   المقيسُ (`b11-diag-base-500`): الشوطُ المقطوعُ عندَ سقفِه كانَ ينتظرُ آخرَ وظائفِه والمساراتُ تفرغُ
 *   قبلَ أن يلتقطَ التالي (~1.05ث من ~5.2ث، انشغالُ المساراتِ 57%، وانتظارُ طابورِ إثباتِ الهاتفِ p50 16ث).
 *   الإصلاح: حالةُ المساراتِ تمتدُّ عبرَ أشواطِ الدرينر؛ فالشوطُ المقطوعُ يعودُ فورًا والتالي يلتقطُ
 *   والذيلُ جارٍ، وسلسلةُ المستخدمِ الواحدِ تصونُ ترتيبَه بينَ شوطين، و`stop` ينتظرُ المحمول.
 *   (١) الكلفةُ المُعادُ إنتاجُها: بلا حالةٍ يستغرقُ الشوطُ المقطوعُ زمنَ أبطأِ وظائفِه.
 *   (٢) بحالةٍ ممتدّةٍ يعودُ قبلَ انتهاءِ الوظيفةِ البطيئة، ويبقى الجاري ضمنَ عددِ المسارات.
 *   (٣) الترتيب: تحديثُ المستخدمِ التالي المُلتقَطُ في الشوطِ الثاني لا يبدأُ قبلَ نهايةِ سابقِه.
 *   (٤) الدرينرُ الدوريُّ: إيقاظٌ واحدٌ يستنزفُ كلَّ شيءٍ، و`stop` لا يعودُ قبلَ ختمِ المحمول.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  createDrainLaneState,
  drainTelegramUpdateJobsOnce,
  startTelegramUpdateDrainer,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";

interface Spec {
  readonly updateId: number;
  readonly user: number;
  readonly ms: number;
}

function harness(specs: readonly Spec[]) {
  const pending = specs.map(
    (s): ClaimedTelegramUpdateJob => ({
      bot: "driver",
      updateId: s.updateId,
      payload: { update_id: s.updateId, message: { from: { id: s.user } } },
      claimToken: `t${s.updateId}`,
      attempts: 1,
      maxAttempts: 5,
    }),
  );
  const msOf = new Map(specs.map((s) => [s.updateId, s.ms]));
  const started = new Map<number, number>();
  const ended = new Map<number, number>();
  let running = 0;
  let peak = 0;
  const queue = {
    claim: async () => ({ job: pending.shift() ?? null }),
    finish: async () => true,
    abandon: async () => true,
  } as unknown as TelegramUpdateQueue;
  const handler = {
    handle: async (_bot: string, payload: unknown) => {
      const id = (payload as { update_id: number }).update_id;
      started.set(id, performance.now());
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, msOf.get(id) ?? 1));
      running -= 1;
      ended.set(id, performance.now());
      return true;
    },
  };
  return { queue, handler, started, ended, peak: () => peak, left: () => pending.length };
}

// الوظيفةُ 1 بطيئةٌ (المستخدمُ 1)، و2..4 سريعةٌ، و5 هي تحديثُ المستخدمِ 1 التالي، و6 سريعة.
const SPECS: readonly Spec[] = [
  { updateId: 1, user: 1, ms: 150 },
  { updateId: 2, user: 2, ms: 5 },
  { updateId: 3, user: 3, ms: 5 },
  { updateId: 4, user: 4, ms: 5 },
  { updateId: 5, user: 1, ms: 5 },
  { updateId: 6, user: 6, ms: 5 },
];

describe("LOAD-01 — حاجزُ نهايةِ الشوطِ المقطوع", () => {
  test("(١) بلا حالةٍ ممتدّةٍ: الشوطُ المقطوعُ ينتظرُ أبطأَ وظائفِه (الكلفةُ المقيسة)", async () => {
    const h = harness(SPECS);
    const t0 = performance.now();
    const r = await drainTelegramUpdateJobsOnce({
      queue: h.queue,
      handler: h.handler,
      lanes: 4,
      maxJobsPerRun: 4,
    });
    expect(r).toEqual({ claimed: 4, done: 4, failed: 0, truncated: true });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(140);
  });

  test("(٢)+(٣) بحالةٍ ممتدّة: يعودُ فورًا، والتالي يلتقطُ والذيلُ جارٍ، والترتيبُ مصون", async () => {
    const h = harness(SPECS);
    const state = createDrainLaneState();
    const deps = { queue: h.queue, handler: h.handler, lanes: 4, maxJobsPerRun: 4 };
    const t0 = performance.now();
    const first = await drainTelegramUpdateJobsOnce(deps, state);
    const firstMs = performance.now() - t0;
    expect(first.claimed).toBe(4);
    expect(first.truncated).toBe(true);
    expect(firstMs).toBeLessThan(100);
    expect(state.inflight.size).toBeGreaterThan(0);

    const second = await drainTelegramUpdateJobsOnce(deps, state);
    expect(second.claimed).toBe(2);
    expect(second.truncated).toBe(false);
    // الشوطُ غيرُ المقطوعِ ينتظرُ جاريَه كلَّه — ومنه المحمول.
    expect(state.inflight.size).toBe(0);
    expect(h.left()).toBe(0);
    // الوظيفةُ 6 (مستخدمٌ آخر) بدأت قبلَ نهايةِ البطيئة: لا حاجز.
    expect(h.started.get(6) as number).toBeLessThan(h.ended.get(1) as number);
    // والوظيفةُ 5 (المستخدمُ 1 نفسُه) لم تبدأ قبلَ نهايةِ سابقتِه.
    expect(h.started.get(5) as number).toBeGreaterThanOrEqual(h.ended.get(1) as number);
    // الجاري لا يتجاوزُ المساراتِ عبرَ الشوطين.
    expect(h.peak()).toBeLessThanOrEqual(4);
  });

  test("(٤) الدرينرُ الدوريُّ: إيقاظٌ واحدٌ يستنزفُ الكلَّ، و`stop` ينتظرُ المحمول", async () => {
    const specs: Spec[] = [];
    for (let i = 1; i <= 40; i += 1)
      specs.push({ updateId: i, user: i % 5, ms: i % 9 === 0 ? 60 : 3 });
    const h = harness(specs);
    const frozen = {
      setInterval: (() => 0) as unknown as typeof setInterval,
      clearInterval: (() => {}) as unknown as typeof clearInterval,
    };
    const d = startTelegramUpdateDrainer(
      { queue: h.queue, handler: h.handler, lanes: 4, maxJobsPerRun: 6 },
      { intervalMs: 60_000, clock: frozen },
    );
    d.kick();
    const end = Date.now() + 3000;
    while (h.left() > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 2));
    await d.stop();
    expect(h.ended.size).toBe(40);
    expect(h.peak()).toBeLessThanOrEqual(4);
    // ترتيبُ كلِّ مستخدمٍ: بدءُ كلِّ تحديثٍ بعدَ نهايةِ سابقِه للمستخدمِ نفسِه.
    for (let u = 0; u < 5; u += 1) {
      const ids = specs.filter((s) => s.user === u).map((s) => s.updateId);
      for (let k = 1; k < ids.length; k += 1) {
        expect(h.started.get(ids[k] as number) as number).toBeGreaterThanOrEqual(
          h.ended.get(ids[k - 1] as number) as number,
        );
      }
    }
  });
});
