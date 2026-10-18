/**
 * LOAD-01 (الدفعةُ السابعةُ، P4) — مُشغِّلُ مهامٍّ خلفيٌّ بتوازٍ محدودٍ وطابورٍ بسقفٍ.
 *
 * يخدمُ اليومَ «الطلبَ الأقربَ إلى السائقِ الواصلِ» (`dispatchNearestToDriver` في الحاوية):
 * مسارُ الموقعِ لا ينتظرُ المطابقةَ، والمطابقاتُ لا تتدافعُ على تجمّعِ اتصالاتِ البوابةِ (15).
 * وُلدَ أوّلَ مرّةٍ لعرضِ الطلبِ الجديدِ عندَ إنشائِه، وأُسقطَ ذلك الاستعمالُ بالقياسِ: في
 * بروتوكولِ القبولِ يتّصلُ سائقُ السيناريو **بعدَ** الإنشاءِ، فالجولةُ الأولى المفتوحةُ فورًا تذهبُ
 * إلى سائقينَ لا يقبلونَها وتستهلكُ دورةً من ثلاثٍ (`diag-r12-conc12-500`: P4 = 56.6ث و9 طلباتٍ
 * مستنفدةٍ). التفصيلُ في ADR 0289.
 *
 * **العقدُ:**
 * - `submit(task)` يعودُ فورًا.
 * - `concurrency` مهمّةً في آنٍ.
 * - طابورٌ بسقفٍ: الامتلاءُ يعيدُ `false` فيلجأُ المستدعي إلى المسارِ القائمِ (شوطُ المدينةِ
 *   المخفوضُ ثم الدوريُّ 20ث) — لا ذاكرةَ بلا حدٍّ ولا طلبَ بلا مسارٍ.
 * - الفشلُ يُسجَّلُ ولا يُرمى؛ والطلبُ يبقى `searching` فتدركُه الأرضيّةُ الدوريّةُ.
 */

export interface BoundedTaskRunner {
  submit(task: () => Promise<unknown>): boolean;
  stats(): { readonly queued: number; readonly running: number; readonly done: number };
  idle(): Promise<void>;
}

export function createBoundedTaskRunner(options: {
  readonly concurrency: number;
  readonly maxQueued: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}): BoundedTaskRunner {
  const concurrency = Math.max(1, Math.trunc(options.concurrency));
  const queue: (() => Promise<unknown>)[] = [];
  let running = 0;
  let done = 0;
  let waiters: (() => void)[] = [];

  const settle = (): void => {
    if (running > 0 || queue.length > 0) return;
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  const pump = (): void => {
    while (running < concurrency && queue.length > 0) {
      const task = queue.shift() as () => Promise<unknown>;
      running += 1;
      void Promise.resolve()
        .then(task)
        .catch((error: unknown) =>
          options.log?.("dispatch.background_task_failed", {
            detail: error instanceof Error ? error.message : String(error),
          }),
        )
        .finally(() => {
          running -= 1;
          done += 1;
          pump();
          settle();
        });
    }
  };

  return {
    submit: (task) => {
      if (queue.length >= options.maxQueued) return false;
      queue.push(task);
      pump();
      return true;
    },
    stats: () => ({ queued: queue.length, running, done }),
    idle: () =>
      running === 0 && queue.length === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          }),
  };
}
