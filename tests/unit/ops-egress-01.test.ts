/**
 * الغرض: `OPS-EGRESS-01` — خفضُ الحركةِ الصادرةِ الخاملةِ من البوابة إلى القاعدة.
 *   1) الدرينرُ يستيقظُ بالإيداعِ ولا يسألُ الطابورَ الفارغَ كلَّ نصفِ ثانية.
 *   2) نجاحُ فحصِ الجاهزيّةِ يُتذكَّرُ مدّةً، والفشلُ يُعادُ في كلِّ نداء.
 *   3) نبضةُ `ok` المتكرّرةُ تُكتَبُ مرّةً في المهلة، وتغيُّرُ الحالِ يُكتَبُ فورًا.
 * الحالة: اختبارُ وحدةٍ بلا شبكةٍ ولا قاعدة.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  startTelegramUpdateDrainer,
  TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS,
  wakeDrainerOnEnqueue,
} from "../../apps/gateway/src/background/telegram-update-drainer.ts";
import { JOB_HEALTH_SNAPSHOT_MS, rememberSuccess } from "../../apps/gateway/src/readiness-memo.ts";
import type { BotKind } from "../../apps/gateway/src/routes/telegram-webhook.ts";
import {
  createJobRunner,
  HEARTBEAT_OK_REWRITE_MS,
  type JobDefinition,
} from "../../apps/workers/src/runner.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";
import { MIN_HEARTBEAT_GRACE_MS } from "../../packages/application/scheduling/job-heartbeat.ts";
import type {
  ClaimedTelegramUpdateJob,
  TelegramUpdateQueue,
} from "../../packages/infrastructure/db/telegram-update-queue.ts";
import { rememberSettingsByCity } from "../../packages/infrastructure/policy/settings-repository.ts";

const alwaysHandles = { handle: async (_bot: BotKind, _payload: unknown) => true };

function queueWith(pending: number[], counters: { claims: number }): TelegramUpdateQueue {
  return {
    claim: async () => {
      counters.claims += 1;
      const updateId = pending.shift();
      if (updateId === undefined) return { job: null };
      const job: ClaimedTelegramUpdateJob = {
        bot: "rider",
        updateId,
        payload: { update_id: updateId },
        claimToken: `t-${updateId}`,
        attempts: 1,
        maxAttempts: 5,
      };
      return { job };
    },
    finish: async () => true,
    abandon: async () => true,
  } as unknown as TelegramUpdateQueue;
}

/** مؤقّتٌ يدويّ: لا يطلقُ شيئًا إلّا بـ`fire`، فيُقاسُ أثرُ الإيقاظِ وحدَه. */
function manualClock() {
  const timers: Array<() => void> = [];
  return {
    fire: () => {
      for (const t of timers) t();
    },
    clock: {
      setInterval: ((fn: () => void) => {
        timers.push(fn);
        return timers.length as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
      clearInterval: (() => {}) as unknown as typeof clearInterval,
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("OPS-EGRESS-01 — الدرينرُ يستيقظُ بالإيداع", () => {
  test("الإيقاظُ يعالجُ التحديثَ فورًا بلا انتظارِ المؤقّت", async () => {
    const pending: number[] = [];
    const counters = { claims: 0 };
    const manual = manualClock();
    const drainer = startTelegramUpdateDrainer(
      { queue: queueWith(pending, counters), handler: alwaysHandles },
      { intervalMs: TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS, clock: manual.clock },
    );
    expect(counters.claims).toBe(0);
    pending.push(1);
    drainer.kick();
    await settle();
    expect(pending.length).toBe(0);
    // سؤالان: واحدٌ وجدَ التحديث، وواحدٌ وجدَ الطابورَ فارغًا فختمَ الشوط.
    // CAP-RUN-20261015 / D5: وشوطٌ ثانٍ فوريٌّ لأنَّ الأوّلَ ختمَ وظيفةً (قد يكونُ فكَّ حجبَ وظيفةٍ تاليةٍ للمستخدمِ
    // نفسِه تحتَ D4) — سؤالٌ فارغٌ واحدٌ ثم سكون، لا دوَران. (telegram-update-drainer-lane-unblock-rerun.test.ts)
    expect(counters.claims).toBe(3);
    await drainer.stop();
  });

  test("إيقاظٌ أثناءَ شوطٍ جارٍ يُعيدُ الشوطَ مرّةً بعدَه فلا يفوتُ ما أُودِع", async () => {
    const pending: number[] = [1];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handled: number[] = [];
    const handler = {
      handle: async (_bot: BotKind, payload: unknown) => {
        const id = (payload as { update_id: number }).update_id;
        handled.push(id);
        if (id === 1) await gate;
        return true;
      },
    };
    const manual = manualClock();
    const drainer = startTelegramUpdateDrainer(
      { queue: queueWith(pending, { claims: 0 }), handler },
      { intervalMs: TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS, clock: manual.clock },
    );
    drainer.kick();
    await settle();
    expect(handled).toEqual([1]);
    // يصلُ الثاني بعدَ أن رأى الشوطُ الطابورَ… ثمَّ يُوقَظُ والشوطُ جارٍ.
    drainer.kick();
    release();
    pending.push(2);
    await settle();
    await settle();
    expect(handled).toEqual([1, 2]);
    await drainer.stop();
  });

  test("فترةُ شبكةِ الأمانِ أطولُ كثيرًا من نصفِ الثانيةِ القديمة", () => {
    expect(TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
    expect(TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });

  test("الإيداعُ الناجحُ وحدَه يوقظ — التكرارُ والتشبّعُ لا", async () => {
    const outcomes = ["enqueued", "duplicate", "shed", "in_progress", "enqueued"];
    let wakes = 0;
    const intake = wakeDrainerOnEnqueue(
      {
        claimAndEnqueue: async (_b: string, _u: number, _p: unknown) => outcomes.shift() as string,
      },
      () => {
        wakes += 1;
      },
    );
    for (let i = 0; i < 5; i += 1) await intake.claimAndEnqueue("rider", i, {});
    expect(wakes).toBe(2);
  });

  test("إيقاظٌ يرمي لا يُسقطُ الإيداع", async () => {
    const intake = wakeDrainerOnEnqueue(
      { claimAndEnqueue: async (_b: string, _u: number, _p: unknown) => "enqueued" },
      () => {
        throw new Error("boom");
      },
    );
    expect(await intake.claimAndEnqueue("driver", 1, {})).toBe("enqueued");
  });
});

describe("OPS-EGRESS-01 — تذكُّرُ نجاحِ فحصِ الجاهزيّة", () => {
  test("النجاحُ يُتذكَّرُ داخلَ المهلةِ ثمَّ يُعادُ الفحص", async () => {
    let nowMs = 0;
    let calls = 0;
    const check = rememberSuccess(
      async () => {
        calls += 1;
        return { ok: true };
      },
      60_000,
      () => nowMs,
    );
    await check();
    nowMs = 59_000;
    await check();
    expect(calls).toBe(1);
    nowMs = 60_000;
    await check();
    expect(calls).toBe(2);
  });

  test("الفشلُ لا يُتذكَّر: كلُّ نداءٍ يُعيدُ الفحصَ ويرى التعافي فورًا", async () => {
    let healthy = false;
    let calls = 0;
    const check = rememberSuccess(
      async () => {
        calls += 1;
        return healthy ? { ok: true } : { ok: false, detail: "down" };
      },
      60_000,
      () => 0,
    );
    expect((await check()).ok).toBe(false);
    expect((await check()).ok).toBe(false);
    healthy = true;
    expect((await check()).ok).toBe(true);
    expect(calls).toBe(3);
  });

  test("الاستثناءُ يمرُّ ولا يُتذكَّرُ نجاحًا", async () => {
    let calls = 0;
    const check = rememberSuccess(
      async () => {
        calls += 1;
        throw new Error("db");
      },
      60_000,
      () => 0,
    );
    await expect(check()).rejects.toThrow("db");
    await expect(check()).rejects.toThrow("db");
    expect(calls).toBe(2);
  });
});

describe("OPS-EGRESS-01 — تخفيفُ كتابةِ نبضةِ ok", () => {
  function setup(rewriteMs: number | undefined, outcomes: Array<"ok" | "fail">) {
    let nowMs = 0;
    const writes: string[] = [];
    const job: JobDefinition = {
      name: "j",
      everySeconds: 10,
      runOnStart: true,
      run: async () => {
        if (outcomes.shift() === "fail") throw new Error("x");
        return "done";
      },
    };
    const runner = createJobRunner({
      lock: createNoopLock(),
      jobs: [job],
      clock: { now: () => new Date(nowMs) },
      log: { info: () => {}, error: () => {} },
      heartbeat: {
        record: async (beat) => {
          writes.push(`${nowMs}:${beat.status}`);
        },
      },
      ...(rewriteMs === undefined ? {} : { heartbeatOkRewriteMs: rewriteMs }),
    });
    return {
      writes,
      runAt: async (ms: number) => {
        nowMs = ms;
        await runner.runDue();
      },
    };
  }

  test("بلا المهلةِ: كتابةٌ في كلِّ شوطٍ كما كان", async () => {
    const r = setup(undefined, ["ok", "ok", "ok"]);
    await r.runAt(0);
    await r.runAt(10_000);
    await r.runAt(20_000);
    expect(r.writes.length).toBe(3);
  });

  test("بالمهلة: ok المتكرّرةُ تُكتَبُ مرّةً في الدقيقة", async () => {
    const r = setup(HEARTBEAT_OK_REWRITE_MS, ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    for (let t = 0; t <= 70_000; t += 10_000) await r.runAt(t);
    expect(r.writes).toEqual(["0:ok", "60000:ok"]);
  });

  test("الفشلُ يُكتَبُ فورًا، والعودةُ إلى ok تُكتَبُ فورًا", async () => {
    const r = setup(HEARTBEAT_OK_REWRITE_MS, ["ok", "fail", "ok", "ok"]);
    await r.runAt(0);
    await r.runAt(10_000);
    await r.runAt(20_000);
    await r.runAt(30_000);
    expect(r.writes).toEqual(["0:ok", "10000:failed", "20000:ok"]);
  });

  test("الحدُّ الآمن: المهلةُ + الفترةُ + لقطةُ /ready دونَ عتبةِ البيات لكلِّ فترة", () => {
    for (const everySeconds of [5, 10, 15, 20, 30, 60, 90, 120, 300, 900, 3600]) {
      const threshold = Math.max(everySeconds * 2 * 1000, MIN_HEARTBEAT_GRACE_MS);
      const worst = HEARTBEAT_OK_REWRITE_MS + everySeconds * 1000 + JOB_HEALTH_SNAPSHOT_MS;
      expect(worst).toBeLessThanOrEqual(threshold);
    }
  });
});

describe("OPS-EGRESS-01 — تذكُّرُ إعداداتِ المدينةِ في العامل", () => {
  test("القراءةُ الناجحةُ تُتذكَّرُ لكلِّ مدينةٍ مستقلّةً، والفشلُ لا", async () => {
    let nowMs = 0;
    const calls: string[] = [];
    let fail = false;
    const repo = {
      findByCity: async (cityId: string) => {
        calls.push(cityId);
        return fail
          ? ({ ok: false, error: { kind: "port_failure" } } as never)
          : ({ ok: true, value: [] } as never);
      },
    };
    const remembered = rememberSettingsByCity(repo as never, 60_000, () => nowMs);
    await remembered.findByCity("a" as never);
    await remembered.findByCity("a" as never);
    await remembered.findByCity("b" as never);
    expect(calls).toEqual(["a", "b"]);
    nowMs = 60_000;
    fail = true;
    await remembered.findByCity("a" as never);
    await remembered.findByCity("a" as never);
    expect(calls).toEqual(["a", "b", "a", "a"]);
  });
});
