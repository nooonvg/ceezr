/**
 * الغرض: `WR-22` (ADR 0283) — المجدولُ داخلَ عمليّةِ البوّابة يتوقّفُ إذا نامت الخدمة، و`cron` كلَّ 5 دقائق
 *   في GitHub لا يعني تنفيذًا كلَّ 5 دقائق. يقيسُ هذا الملفُّ: رصدَ التأخّرِ عندَ الإقلاع، والإنذارَ فوقَ
 *   العتبة، والاستدراكَ مرّةً واحدةً بلا تكرار، والتعافيَ بعدَ إعادةِ التشغيلِ من النبضات.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assessSchedulerGap,
  createJobRunner,
  type JobDefinition,
  lastRunMsFromHeartbeats,
  SCHEDULER_GAP_ALERT_MS,
} from "../../apps/workers/src/runner.ts";
import { createNoopLock } from "../../packages/application/scheduling/distributed-lock.ts";

const MIN = 60_000;
const clockAt = (ms: number) => {
  let now = ms;
  return {
    now: () => new Date(now),
    advance: (d: number) => {
      now += d;
    },
  };
};
const capture = () => {
  const info: { m: string; f?: Record<string, unknown> | undefined }[] = [];
  const error: { m: string; f?: Record<string, unknown> | undefined }[] = [];
  return {
    info,
    error,
    log: {
      info: (m: string, f?: Record<string, unknown>) => info.push({ m, f }),
      error: (m: string, f?: Record<string, unknown>) => error.push({ m, f }),
    },
  };
};

describe("WR-22 — لا ادّعاءَ أنّ cron كلَّ 5 دقائق تنفيذٌ كلَّ 5 دقائق", () => {
  const workflow = readFileSync(".github/workflows/gateway-keep-alive.yml", "utf8");
  test("ملفُّ الإيقاظِ يُعلِنُ أنّ جدولةَ GitHub قد تتأخّرُ ولا يَعِدُ بتوفّر", () => {
    expect(workflow).toContain('cron: "*/5 * * * *"');
    expect(workflow).toMatch(/جدولةُ\s*\n?#?\s*GitHub قد تتأخّرُ/);
    expect(workflow).toContain("ولا ضمانَ توفّرٍ");
  });
  test("وثيقةُ التشغيلِ تحملُ القياسَ الفعليَّ لا الجدولَ المعلَن", () => {
    const ops = readFileSync("docs/ops/free-tier-keep-alive.md", "utf8");
    expect(ops).toContain("WR-22 (ADR 0283)");
    expect(ops).toMatch(/الوسيط\s+16\s+دقيقة/);
    expect(ops).toMatch(/496\s+دقيقة/);
  });
  test("ولا وثيقةَ تزعمُ أنّ المهامَّ تجري كلَّ 5 دقائق بفضلِ الإيقاظ", () => {
    for (const path of ["docs/ops/free-tier-keep-alive.md", "docs/roadmap/execution/STATUS.md"]) {
      const text = readFileSync(path, "utf8");
      expect(text).not.toMatch(/(تُنفَّذ|تعمل|تجري)\s+(المهامّ?\s+)?كلَّ?\s*5\s*دقائق\s+(بفضل|بسبب)/);
    }
  });
});

describe("WR-22 — قياسُ التأخّرِ عندَ الإقلاع", () => {
  const minutely = { name: "expire-searching:c1", everySeconds: 60 };
  const jobs = [
    minutely,
    { name: "close-escalation-cards", everySeconds: 60 },
    { name: "backup-database", everySeconds: 86_400 },
  ];
  test("لا نبضةَ سابقة ⇒ لا تأخّرَ يُدّعى", () => {
    expect(assessSchedulerGap({ jobs, lastRunMs: new Map(), nowMs: 10 * MIN })).toEqual({
      overdue: [],
      maxLateMs: 0,
      exceeded: false,
    });
  });
  test("نومٌ 8 ساعات ⇒ كلُّ مهمّةٍ دقيقةٍ متأخّرةٌ، والإنذارُ مُطلَق، والمهمّةُ اليوميّةُ في موعدِها", () => {
    const now = 10 * 60 * MIN;
    const last = 2 * 60 * MIN;
    const r = assessSchedulerGap({
      jobs,
      lastRunMs: new Map(jobs.map((j) => [j.name, last])),
      nowMs: now,
    });
    expect(r.overdue.map((o) => o.job).sort()).toEqual([
      "close-escalation-cards",
      "expire-searching:c1",
    ]);
    expect(r.maxLateMs).toBe(now - last - 60_000);
    expect(r.exceeded).toBe(true);
  });
  test("العتبةُ حدٌّ صارم: عندَها لا إنذار، وفوقَها ببايتٍ إنذار", () => {
    const at = (late: number) =>
      assessSchedulerGap({
        jobs: [minutely],
        lastRunMs: new Map([[minutely.name, 0]]),
        nowMs: 60_000 + late,
      });
    expect(at(SCHEDULER_GAP_ALERT_MS).exceeded).toBe(false);
    expect(at(SCHEDULER_GAP_ALERT_MS + 1).exceeded).toBe(true);
    expect(SCHEDULER_GAP_ALERT_MS).toBe(15 * MIN);
  });
  test("اسمٌ مكرّرٌ (مهمّةُ مدنٍ) يُعَدُّ مرّة", () => {
    const r = assessSchedulerGap({
      jobs: [minutely, minutely],
      lastRunMs: new Map([[minutely.name, 0]]),
      nowMs: 30 * MIN,
    });
    expect(r.overdue.length).toBe(1);
  });
});

describe("WR-22 — الإقلاعُ بعدَ نوم: إنذارٌ، واستدراكٌ مرّةً، وبلا تكرار", () => {
  test("بعدَ نومٍ طويل ⇒ `scheduler.gap_exceeded` خطأً، والمهمّةُ تُستدرَكُ مرّةً لا بعددِ الفائت", async () => {
    const boot = 8 * 60 * MIN;
    const clock = clockAt(boot);
    const { log, error, info } = capture();
    let runs = 0;
    const job: JobDefinition = {
      name: "expire-searching:c1",
      everySeconds: 60,
      run: async () => {
        runs += 1;
        return "expired=1";
      },
    };
    const runner = createJobRunner({
      jobs: [job],
      clock,
      log,
      lock: createNoopLock(),
      initialLastRunMs: lastRunMsFromHeartbeats([{ jobName: job.name, lastRunAt: new Date(0) }]),
      tickMs: 3_600_000,
    });
    runner.start();
    runner.stop();
    await runner.drain(1000);
    expect(error.map((e) => e.m)).toContain("scheduler.gap_exceeded");
    const f = error.find((e) => e.m === "scheduler.gap_exceeded")?.f;
    expect(f?.max_late_seconds).toBe((boot - 60_000) / 1000);
    expect(f?.overdue_jobs).toBe(1);
    expect(info.map((e) => e.m)).not.toContain("scheduler.resumed_after_gap");
    expect(runs).toBe(1);
    // نبضةٌ ثانيةٌ في الثانيةِ نفسِها لا تُكرّر الاستدراك.
    await runner.runDue();
    expect(runs).toBe(1);
    clock.advance(60_000);
    await runner.runDue();
    expect(runs).toBe(2);
  });

  test("تأخّرٌ دونَ العتبة ⇒ `scheduler.resumed_after_gap` معلومةً لا خطأ", () => {
    const clock = clockAt(10 * MIN);
    const { log, error, info } = capture();
    const job: JobDefinition = { name: "j", everySeconds: 60, run: async () => "ok" };
    const runner = createJobRunner({
      jobs: [job],
      clock,
      log,
      lock: createNoopLock(),
      initialLastRunMs: new Map([["j", 5 * MIN]]),
      tickMs: 3_600_000,
    });
    runner.start();
    runner.stop();
    expect(error.length).toBe(0);
    expect(info.find((e) => e.m === "scheduler.resumed_after_gap")?.f?.max_late_seconds).toBe(
      4 * 60,
    );
  });

  test("إقلاعٌ في الموعد ⇒ لا سطرَ تأخّر", () => {
    const clock = clockAt(10 * MIN);
    const { log, error, info } = capture();
    const job: JobDefinition = { name: "j", everySeconds: 60, run: async () => "ok" };
    const runner = createJobRunner({
      jobs: [job],
      clock,
      log,
      lock: createNoopLock(),
      initialLastRunMs: new Map([["j", 10 * MIN - 30_000]]),
      tickMs: 3_600_000,
    });
    runner.start();
    runner.stop();
    expect([...error, ...info].map((e) => e.m).filter((m) => m.startsWith("scheduler."))).toEqual(
      [],
    );
  });

  test("إعادةُ تشغيلٍ ثانيةٌ بعدَ الاستدراك تقرأُ النبضةَ الجديدة فلا تُعيدُ الإنذار", async () => {
    let lastBeat = new Date(0);
    const heartbeat = {
      record: async () => {
        lastBeat = new Date(clock.now());
      },
    };
    const clock = clockAt(3 * 60 * MIN);
    const job: JobDefinition = { name: "j", everySeconds: 60, run: async () => "ok" };
    const first = capture();
    const r1 = createJobRunner({
      jobs: [job],
      clock,
      log: first.log,
      lock: createNoopLock(),
      heartbeat: heartbeat as never,
      initialLastRunMs: new Map([["j", 0]]),
      tickMs: 3_600_000,
    });
    r1.start();
    r1.stop();
    await new Promise((r) => setTimeout(r, 20));
    await r1.drain(1000);
    expect(first.error.map((e) => e.m)).toContain("scheduler.gap_exceeded");
    clock.advance(30_000);
    const second = capture();
    const r2 = createJobRunner({
      jobs: [job],
      clock,
      log: second.log,
      lock: createNoopLock(),
      initialLastRunMs: lastRunMsFromHeartbeats([{ jobName: "j", lastRunAt: lastBeat }]),
      tickMs: 3_600_000,
    });
    r2.start();
    r2.stop();
    expect(
      [...second.error, ...second.info].map((e) => e.m).filter((m) => m.startsWith("scheduler.")),
    ).toEqual([]);
  });
});
