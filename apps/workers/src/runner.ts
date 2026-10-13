/**
 * الغرض: مشغّل الجوبات: يعرف ماذا يُشغَّل ومتى، ويعزل كل مهمّة عن أخواتها فلا يُسقط
 *   عطلُ واحدة الحلقة كلّها، ولا يبدأ شوطاً جديداً لمهمّة لم ينتهِ شوطها السابق.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: apps/workers/src/index.ts، واختبارات المشغّل
 * ملاحظات مستقبلية: القفل الموزَّع مُطبَّق هنا في المشغّل لا في كل مهمّة، فمهمّة جديدة
 *   تُحمى بمجرّد تسجيلها. أيّ تنفيذ آخر للقفل (Redis مثلاً) يدخل من نفس المنفذ.
 */

import type { DistributedLock } from "../../../packages/application/scheduling/distributed-lock.ts";
import type {
  JobHeartbeatRecorderPort,
  JobHeartbeatStatus,
} from "../../../packages/application/scheduling/job-heartbeat.ts";
import {
  newWorkerCorrelationId,
  runWithCorrelationId,
} from "../../../packages/infrastructure/observability/correlation.ts";
import type { CityId, Clock } from "../../../packages/shared/kernel/index.ts";

export interface JobDefinition {
  readonly name: string;
  /** كل كم ثانية يُشغَّل. */
  readonly everySeconds: number;
  /**
   * لا ترمي: المهمّة مسؤولة عن ترجمة فشلها إلى سطر سجلّ. لكن إن رمت رغم ذلك
   * فالمشغّل يلتقطها ويستمرّ — مهمّة معطوبة لا يجوز أن تُوقف بقية النظام.
   */
  run(): Promise<string>;
  /** هل يُشغَّل مرّة عند الإقلاع قبل انتظار أول دورة. */
  readonly runOnStart?: boolean;
  /**
   * مدينةُ المهمّة إن كانت مهمّةَ مدينة. تُمرَّر للنبضة وحدها (§4.3): اسمُ المهمّة
   * يحمل المعرّف نصّاً، وتفكيكُ نصٍّ لاستخراج مفتاحٍ أجنبي هشٌّ بلا داعٍ.
   */
  readonly cityId?: CityId;
}

export interface JobLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export interface JobRunnerOptions {
  readonly jobs: readonly JobDefinition[];
  readonly clock: Clock;
  readonly log: JobLogger;
  /**
   * القفل الموزَّع. موضعه هنا — في المشغّل لا في كل مهمّة — قرار مقصود: لو كان على
   * كل مهمّة أن تقفل نفسها، لكانت أوّل مهمّة جديدة يكتبها أحدٌ في المستقبل بلا قفل،
   * وما كان أحد سيلاحظ حتى تُنفَّذ مرّتين في الإنتاج.
   */
  readonly lock: DistributedLock;
  /** كل كم مللي ثانية تُفحَص المهامّ المستحقّة. لا علاقة له بتواتر المهامّ نفسها. */
  readonly tickMs?: number;
  /**
   * أقصى عدد مهامّ تعمل في اللحظة نفسها. ليس ضبطاً تجميلياً بل حدٌّ لازم: كل مهمّة
   * جارية تستهلك اتصال قفل محجوزاً واتصالاً أو أكثر لاستعلاماتها، فتوازٍ غير محدود
   * مع أربع مدن مفعَّلة يعني 24 مهمّة تتزاحم على تجمّع اتصالات محدود — وهذا استنزاف
   * تجمّع يُسقط المهامّ جميعاً بمهلة انتظار لا بخطأ مفهوم.
   *
   * والحدّ **على المشغّل كلّه لا على النبضة الواحدة**: `start` يستدعي `runDue` بلا
   * انتظار انتهاء سابقته، فشوطٌ يتجاوز النبضة (النسخ الاحتياطي يومياً) يجعل نبضتين
   * متراكبتين. وحدٌّ محسوبٌ داخل كل استدعاء يصير حدَّين، فيتضاعف التوازي الفعلي.
   */
  readonly maxConcurrency?: number;
  /**
   * كاتبُ النبضة (§4.3). اختياريّ عن قصد: اختباراتُ المشغّل لا تحتاج قاعدةً،
   * والعاملُ في الإنتاج يمرّره دائماً. غيابُه يعني «لا رصد» لا «رصدٌ فاشل».
   */
  readonly heartbeat?: JobHeartbeatRecorderPort;
  /**
   * `JOB-LAZY-01` — آخرُ شوطٍ معروفٍ لكلِّ مهمّةٍ (مللي ثانية)، يُقرأُ من `job_heartbeats`
   * عندَ الإقلاعِ. بلا هذا تبدأُ المهمّةُ اليوميّةُ عدَّها من الصفرِ في كلِّ إقلاعٍ، والبوابةُ
   * على خطّةٍ مجّانيّةٍ تُنشَرُ وتنامُ مرّاتٍ في اليومِ فلا تبلغُ مهمّةٌ يوميّةٌ موعدَها أبداً.
   */
  readonly initialLastRunMs?: ReadonlyMap<string, number>;
  /**
   * `JOB-LAZY-01` — مهلةُ أوّلِ شوطٍ لمهمّةٍ بلا `runOnStart` ولا شوطٍ سابقٍ معروفٍ:
   * `min(everySeconds, firstRunGraceMs)`. افتراضاً دقيقة: تُبعِدُ المهامَّ الكسولةَ عن زحامِ
   * الإقلاعِ ولا تؤجّلُها يوماً.
   */
  readonly firstRunGraceMs?: number;
}

export interface JobOutcome {
  readonly name: string;
  readonly status:
    | "ran"
    | "skipped_not_due"
    | "skipped_overlapping"
    | "skipped_locked_elsewhere"
    | "failed";
  readonly durationMs: number;
  readonly detail: string | null;
}

export interface JobRunner {
  /**
   * يُشغّل ما استحقّ في هذه اللحظة ويعيد نتيجة كل مهمّة. مكشوفة للاختبار عن قصد:
   * اختبار الجدولة بانتظار ساعة حقيقية اختبارٌ لا يُشغَّل، فيصبح اختباراً لا وجود له.
   */
  runDue(): Promise<readonly JobOutcome[]>;
  start(): void;
  stop(): void;
  /**
   * ينتظر انتهاء الأشواط الجارية. لازمٌ للإطفاء: `stop` يمسح المؤقّت ولا ينتظر
   * شيئاً، فإغلاق القاعدة بعده مباشرةً يسحب الاتصال من شوطٍ جارٍ فيُفشله بلا داعٍ.
   * ومحدودٌ بمهلة: منصّة النشر تقتل العملية قسراً بعد مدّة، فانتظارٌ بلا حدٍّ
   * يضيع فرصة الإغلاق النطيف بدل أن يحفزها — والنسخ الاحتياطي قد يطول دقائق.
   *
   * يعود `true` إن فرغت الأشواط، و`false` إن انتهت المهلة وبعضها جارٍ — فالمُطفِئ
   * يسجّل ذلك بدل أن يظنّ أنّه أغلق نطيفاً.
   */
  drain(timeoutMs?: number): Promise<boolean>;
  readonly running: boolean;
}

/**
 * `WR-22` (ADR 0283) — عتبةُ الإنذارِ بتأخّرِ المجدول: ربعُ ساعةٍ فوقَ موعدِ مهمّةٍ مستحقّة. هيَ مهلةُ نومِ
 * Render المجانيّة نفسُها، وربعُ نافذةِ البحثِ (60 دقيقة): تأخّرٌ فوقَها يعني أنّ انتهاءَ البحثِ أو
 * إغلاقَ البطاقةِ أو التذكيرَ وقعَ متأخّرًا بما يراه المستخدم.
 */
export const SCHEDULER_GAP_ALERT_MS = 15 * 60_000;

export interface SchedulerGapReport {
  /** مهامُّ تجاوزَت موعدَها حينَ أقلعَ المشغّل، مرتّبةً بالأكثرِ تأخّرًا. */
  readonly overdue: readonly { readonly job: string; readonly lateMs: number }[];
  /** أقصى تأخّرٍ (0 إن لم يتأخّر شيء). */
  readonly maxLateMs: number;
  readonly exceeded: boolean;
}

/**
 * `WR-22` (ADR 0283) — كم تأخّرَت كلُّ مهمّةٍ عن موعدِها عندَ الإقلاع، من آخرِ نبضةٍ معروفة. المجدولُ
 * يعملُ داخلَ عمليّةِ البوّابة، فإذا نامت الخدمةُ لم تُشغَّل مهمّة، و`cron` كلَّ 5 دقائق في GitHub لا يعني
 * تنفيذًا كلَّ 5 دقائق. والاستدراكُ نفسُه في `isDue`: المهمّةُ المتأخّرةُ مستحقّةٌ في أوّلِ نبضة، وتُشغَّلُ
 * مرّةً واحدةً لا بعددِ الأشواطِ الفائتة.
 */
export function assessSchedulerGap(input: {
  readonly jobs: readonly Pick<JobDefinition, "name" | "everySeconds">[];
  readonly lastRunMs: ReadonlyMap<string, number>;
  readonly nowMs: number;
  readonly alertMs?: number;
}): SchedulerGapReport {
  const alertMs = input.alertMs ?? SCHEDULER_GAP_ALERT_MS;
  const overdue: { job: string; lateMs: number }[] = [];
  const seen = new Set<string>();
  for (const job of input.jobs) {
    if (seen.has(job.name)) continue;
    seen.add(job.name);
    const last = input.lastRunMs.get(job.name);
    if (last === undefined) continue;
    const lateMs = input.nowMs - last - job.everySeconds * 1000;
    if (lateMs > 0) overdue.push({ job: job.name, lateMs });
  }
  overdue.sort((a, b) => b.lateMs - a.lateMs);
  const maxLateMs = overdue[0]?.lateMs ?? 0;
  return { overdue, maxLateMs, exceeded: maxLateMs > alertMs };
}

const DEFAULT_TICK_MS = 10_000;
const DEFAULT_MAX_CONCURRENCY = 4;
/** `JOB-LAZY-01` — سقفُ انتظارِ أوّلِ شوطٍ لمهمّةٍ كسولةٍ لم تَجرِ قطّ. */
export const DEFAULT_FIRST_RUN_GRACE_MS = 60_000;

/** مهلة التصريف الافتراضية: أقلّ من مهلة القتل القسري لدى منصّة النشر، ليبقى متّسعٌ للإغلاق. */
const DEFAULT_DRAIN_MS = 20_000;
const DRAIN_POLL_MS = 50;

export function createJobRunner(options: JobRunnerOptions): JobRunner {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  const lastRunMs = new Map<string, number>(options.initialLastRunMs ?? []);
  const inFlight = new Set<string>();
  /**
   * `JOB-LAZY-01` — مهامُّ تنتظرُ خانةً. بلا هذا تُعادُ إضافةُ المهمّةِ المنتظِرةِ في كلِّ
   * نبضةٍ (فهي ليست في `inFlight` بعدُ)، فيطولُ طابورُ الخاناتِ بنسخٍ مكرّرةٍ تُشغَّلُ
   * كلُّها لاحقاً — أي أشواطٌ زائدةٌ تأكلُ الخاناتِ في الضغطِ بعينِه.
   */
  const queued = new Set<string>();
  const createdAtMs = options.clock.now().getTime();
  const firstRunGraceMs = Math.max(0, options.firstRunGraceMs ?? DEFAULT_FIRST_RUN_GRACE_MS);
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * خانات التوازي على مستوى المشغّل، لا على مستوى الاستدعاء. الحالة هنا — في
   * الإغلاق لا داخل `runDue` — هي جوهر الأمر: نبضتان متراكبتان لكلٍّ منهما عدّادها
   * تُشغّلان ضِعف السقف، وتجمّع القفل مقاسٌ على السقف بالضبط (`MAX_JOB_CONCURRENCY + 1`)
   * فالتجاوز استنزافُ تجمّع لا بطءٌ مقبول.
   *
   * والخانة تُسلَّم للمنتظر تسليماً ولا تُحرَّر ثم تُطلب، فلا تنفلت خانة لطالبٍ جديد
   * بين التحرير والاستلام.
   */
  let activeSlots = 0;
  const slotWaiters: (() => void)[] = [];

  async function acquireSlot(): Promise<void> {
    if (activeSlots < maxConcurrency) {
      activeSlots += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      slotWaiters.push(resolve);
    });
  }

  function releaseSlot(): void {
    const next = slotWaiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    activeSlots -= 1;
  }

  function isDue(job: JobDefinition, nowMs: number): boolean {
    const last = lastRunMs.get(job.name);
    if (last === undefined) {
      if (job.runOnStart === true) return true;
      // `JOB-LAZY-01` — كانَ هذا `return false` أبداً: `lastRunMs` لا يُكتَبُ إلّا بعدَ شوطٍ،
      // فالمهمّةُ بلا `runOnStart` لم تكن تُشغَّلُ ولا مرّةً (مقيسٌ على الإنتاجِ 2026-10-03:
      // لا نبضةَ قطّ للنسخِ الاحتياطيِّ ولا لإفراغِ المواقعِ ولا لانتهاءِ روابطِ التتبّعِ).
      return nowMs - createdAtMs >= Math.min(job.everySeconds * 1000, firstRunGraceMs);
    }
    return nowMs - last >= job.everySeconds * 1000;
  }

  /**
   * النبضةُ تُكتب بعد انتهاء الشوط لا قبله، وخارجَ القفل: الكتابةُ ذاتُ حراسةٍ في
   * منفذها فلا ترمي، وإدخالُها في القفل يُطيل حَملَه بكتابةٍ لا علاقةَ لها بذرّية المهمّة.
   */
  async function beat(
    job: JobDefinition,
    status: JobHeartbeatStatus,
    detail: string | null,
  ): Promise<void> {
    if (options.heartbeat === undefined) return;
    await options.heartbeat.record({
      jobName: job.name,
      cityId: job.cityId ?? null,
      status,
      detail,
    });
  }

  async function runOne(job: JobDefinition, nowMs: number): Promise<JobOutcome> {
    // الحماية من التراكب أهمّ ممّا تبدو: مهمّة تأخذ دقيقتين وتواترها دقيقة تُنتج
    // نسختين متزامنتين تتنافسان على نفس الصفوف — وهذا مصدر أقفال متبادلة حقيقي.
    if (inFlight.has(job.name)) {
      return { name: job.name, status: "skipped_overlapping", durationMs: 0, detail: null };
    }

    inFlight.add(job.name);
    // `F8-01` — لكلِّ شوطٍ معرِّفُ ارتباطٍ خاصٌّ به (`job-…`) يجري في سياقِه كلُّ
    // سطرِ سجلٍّ وكلُّ كتابةٍ في القاعدةِ من هذا الشوطِ. والبادئةُ مقصودةٌ: شوطٌ
    // دوريٌّ لا ينشأُ عن طلبِ مستخدمٍ فلا يجوزُ أن يتنكّرَ بمعرِّفِ طلبٍ. وما
    // نشأَ عن طلبٍ فعليٍّ (صفُّ طابورٍ يحملُ معرِّفَه) يستعيدُ معرِّفَه داخلَ
    // هذا السياقِ فيَغلبُه — سلسلةُ السببِ أصدقُ من سلسلةِ الجدولةِ.
    return await runWithCorrelationId(
      { requestId: newWorkerCorrelationId(), entry: "worker" },
      () => runOneTraced(job, nowMs),
    );
  }

  /**
   * جسمُ الشوطِ. فُصِلَ عن `runOne` ليجريَ كلُّه داخلَ سياقِ ارتباطِ الشوطِ
   * (`F8-01`) بلا تكرارٍ للفِّ في كلِّ فرعٍ — والسلوكُ لم يتغيّرْ حرفاً.
   */
  async function runOneTraced(job: JobDefinition, nowMs: number): Promise<JobOutcome> {
    const startedAt = options.clock.now().getTime();

    try {
      // القفل باسم المهمّة نفسه، وأسماء مهامّ المدن تحمل معرّف المدينة، فمدينتان
      // لا تتعطّل إحداهما بقفل الأخرى — الحصرية لكل (مهمّة، مدينة) لا لكل مهمّة.
      const attempt = await options.lock.withLock(job.name, () => job.run());

      if (!attempt.acquired) {
        // نسخة أخرى تعمل الآن. لا يُسجَّل الوقت: هذه النسخة لم تُشغّل شيئاً، وتسجيل
        // الوقت كان سيعني أنها ستنتظر فاصلاً كاملاً بعد شوطٍ لم يحدث عندها.
        const durationMs = options.clock.now().getTime() - startedAt;
        options.log.info("job.skipped_locked_elsewhere", { job: job.name, durationMs });
        // تُسجَّل `skipped` ولا تُترك صامتةً: صاحبُ القفل هو من ينبض `ok`، لكنّ
        // صمتَ هذه النسخة كان سيُظهر المهمّة بلا نبضةٍ لو مات صاحبُ القفل بينهما.
        await beat(job, "skipped", "نسخة أخرى تحمل القفل");
        return { name: job.name, status: "skipped_locked_elsewhere", durationMs, detail: null };
      }

      const detail = attempt.value;
      lastRunMs.set(job.name, nowMs);
      const durationMs = options.clock.now().getTime() - startedAt;
      options.log.info("job.ran", { job: job.name, durationMs, detail });
      await beat(job, "ok", detail);
      return { name: job.name, status: "ran", durationMs, detail };
    } catch (error) {
      // التوقيت يُسجَّل حتى عند الفشل: مهمّة تفشل كل مرّة لا يجوز أن تُشغَّل في
      // كل نبضة، وإلّا صارت هجوماً على القاعدة بدل أن تكون مهمّة دورية.
      lastRunMs.set(job.name, nowMs);
      const durationMs = options.clock.now().getTime() - startedAt;
      const detail = error instanceof Error ? error.message : String(error);
      options.log.error("job.failed", { job: job.name, durationMs, detail });
      // الفشلُ يُنبض أيضاً: مهمّةٌ تفشل كلّ شوط تُرى في `/ready` بحالتها لا بغيابها،
      // والفرقُ عمليّ: الغيابُ عاملٌ ميّت، والفشلُ عاملٌ حيّ فيه عطل — والعلاج مختلف.
      await beat(job, "failed", detail);
      return { name: job.name, status: "failed", durationMs, detail };
    } finally {
      inFlight.delete(job.name);
    }
  }

  async function runDue(): Promise<readonly JobOutcome[]> {
    const nowMs = options.clock.now().getTime();
    const outcomes: JobOutcome[] = [];

    // المهامّ المستحقّة تُشغَّل متوازية: مهمّة بطيئة لا يجوز أن تؤخّر أختها المستحقّة
    // في نفس النبضة، خصوصاً وأن إنهاء العروض المنتهية حسّاسٌ للتأخير.
    const due = options.jobs.filter((job) => !queued.has(job.name) && isDue(job, nowMs));
    const dueNames = new Set(due.map((job) => job.name));
    const notDue = options.jobs.filter((job) => !dueNames.has(job.name));

    for (const job of notDue) {
      outcomes.push({ name: job.name, status: "skipped_not_due", durationMs: 0, detail: null });
    }

    // توازٍ محدود بنافذة منزلقة: تبدأ مهمّة كلّما تحرّرت خانة، فلا ننتظر انتهاء
    // دفعة كاملة قبل بدء التالية (وهو ما يجعل مهمّة واحدة بطيئة تُعطّل ثلاثاً معها).
    // والخانات مشتركة بين النبضات المتراكبة، فالسقف سقفُ المشغّل لا سقفُ النبضة.
    const results: JobOutcome[] = [];
    await Promise.all(
      due.map(async (job) => {
        queued.add(job.name);
        try {
          await acquireSlot();
        } finally {
          queued.delete(job.name);
        }
        try {
          results.push(await runOne(job, nowMs));
        } finally {
          releaseSlot();
        }
      }),
    );

    outcomes.push(...results);
    return outcomes;
  }

  return {
    runDue,

    get running() {
      return timer !== null;
    },

    start: () => {
      if (timer !== null) return;
      options.log.info("runner.started", {
        jobs: options.jobs.map((job) => `${job.name}@${job.everySeconds}s`),
        tickMs,
      });
      // `WR-22` (ADR 0283): التأخّرُ يُقاسُ قبلَ أوّلِ نبضة — بعدَها تُكتَبُ نبضاتٌ جديدةٌ فيختفي أثرُ النوم.
      const gap = assessSchedulerGap({
        jobs: options.jobs,
        lastRunMs,
        nowMs: options.clock.now().getTime(),
      });
      if (gap.overdue.length > 0) {
        const fields = {
          max_late_seconds: Math.round(gap.maxLateMs / 1000),
          overdue_jobs: gap.overdue.length,
          most_late: gap.overdue.slice(0, 5).map((o) => `${o.job}:${Math.round(o.lateMs / 1000)}s`),
          alert_after_seconds: SCHEDULER_GAP_ALERT_MS / 1000,
        };
        if (gap.exceeded) options.log.error("scheduler.gap_exceeded", fields);
        else options.log.info("scheduler.resumed_after_gap", fields);
      }
      timer = setInterval(() => {
        void runDue();
      }, tickMs);
      // نبضة فورية حتى تعمل مهامّ runOnStart بلا انتظار أول فاصل.
      void runDue();
    },

    drain: async (timeoutMs = DEFAULT_DRAIN_MS) => {
      // استقصاءٌ لا تجميعُ وعود: الأشواط تُنشأ في نبضاتٍ لا نملك وعودها هنا،
      // والمرجع الواحد للجاري هو `inFlight` نفسه — وهو مرجعٌ صادق لأنّ `finally`
      // يحذف منه حتّى عند الرمي، فلا يبقى اسمٌ عالقاً فيه فيستنفد المهلة أبداً.
      const deadline = options.clock.now().getTime() + timeoutMs;
      while (inFlight.size > 0) {
        if (options.clock.now().getTime() >= deadline) {
          options.log.error("runner.drain_timeout", { pending: [...inFlight] });
          return false;
        }
        await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
      }
      return true;
    },

    stop: () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      options.log.info("runner.stopped", {});
    },
  };
}

/**
 * `JOB-LAZY-01` — يحوّلُ صفوفَ `job_heartbeats` إلى بذرةِ `initialLastRunMs`. المهمّةُ العامّةُ
 * تكتبُ صفّاً لكلِّ مدينةٍ باسمِها نفسِه، فيؤخَذُ أحدثُها.
 */
export function lastRunMsFromHeartbeats(
  rows: readonly { readonly jobName: string; readonly lastRunAt: Date }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const at = row.lastRunAt.getTime();
    if (!Number.isFinite(at)) continue;
    const prev = out.get(row.jobName);
    if (prev === undefined || at > prev) out.set(row.jobName, at);
  }
  return out;
}
