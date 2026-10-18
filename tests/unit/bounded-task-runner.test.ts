/**
 * LOAD-01 (الدفعةُ السابعةُ، P4) — المُشغِّلُ الخلفيُّ المحدودُ لعرضِ الطلبِ الأقربِ إلى السائقِ الواصلِ.
 * المقيسُ: شوطُ المدينةِ يخدمُ أقدمَ 50 باحثًا، فالسائقُ الواصلُ لا يُعرَضُ عليه الطلبُ المجاورُ
 * حتى تبلغَه النافذةُ (`diag-r12-conc12-500`: P4 = 56.6ث). العقدُ هنا: إيداعٌ فوريٌّ، توازٍ محدودٌ،
 * طابورٌ بسقفٍ يرفضُ فيلجأُ المستدعي إلى المسارِ القائمِ، وفشلٌ يُسجَّلُ ولا يوقفُ ما بعدَه.
 */
import { describe, expect, it } from "bun:test";
import { createBoundedTaskRunner } from "../../apps/gateway/src/background/bounded-task-runner.ts";

function gate() {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe("LOAD-01 — المُشغِّلُ الخلفيُّ المحدودُ", () => {
  it("١) الإيداعُ يعودُ فورًا والمهمّةُ تبدأُ بلا انتظارِ نافذةٍ", async () => {
    const runner = createBoundedTaskRunner({ concurrency: 4, maxQueued: 10 });
    const started: number[] = [];
    const g = gate();
    expect(
      runner.submit(async () => {
        started.push(1);
        await g.promise;
      }),
    ).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([1]);
    g.open();
    await runner.idle();
    expect(runner.stats()).toEqual({ queued: 0, running: 0, done: 1 });
  });

  it("٢) التوازي لا يتجاوزُ concurrency، والباقي بترتيبِ الإيداعِ", async () => {
    const runner = createBoundedTaskRunner({ concurrency: 2, maxQueued: 10 });
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    for (let i = 0; i < 6; i++) {
      runner.submit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(i);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
      });
    }
    await runner.idle();
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("٣) الطابورُ الممتلئُ يرفضُ فيلجأُ المستدعي إلى المسارِ القائمِ", () => {
    const runner = createBoundedTaskRunner({ concurrency: 1, maxQueued: 1 });
    const g = gate();
    expect(runner.submit(() => g.promise)).toBe(true); // يجري
    expect(runner.submit(() => g.promise)).toBe(true); // في الطابورِ
    expect(runner.submit(() => g.promise)).toBe(false);
    g.open();
  });

  it("٤) فشلُ مهمّةٍ يُسجَّلُ ولا يوقفُ ما بعدَها", async () => {
    const logs: string[] = [];
    const runner = createBoundedTaskRunner({
      concurrency: 1,
      maxQueued: 10,
      log: (m) => logs.push(m),
    });
    const ran: string[] = [];
    runner.submit(async () => {
      throw new Error("boom");
    });
    runner.submit(async () => {
      ran.push("next");
    });
    await runner.idle();
    expect(ran).toEqual(["next"]);
    expect(logs).toContain("dispatch.background_task_failed");
  });
});
