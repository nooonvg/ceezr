/**
 * الغرض: الدرينرُ الخلفيُّ لوظائفِ تحديثِ تيليجرام — يلتقطُ ما أودعَه الويبهوكُ
 *    ويُعالجُه خارجَ مسارِ HTTP. هذا هو إغلاقُ `BUG-002` / `F6-02` على وجهِه
 *    العمليِّ: ACK سريعٌ عندَ الإيداعِ، ومعالجةٌ غيرُ متزامنةٍ هنا بإيجارٍ
 *    واسترجاعٍ وختمٍ برمزٍ. القرارُ المعماريُّ في
 *    [ADR 0057](../../../../docs/adr/0057-telegram-ingress-bound-payload-carrier-and-worker.md):
 *    الدرينرُ يعملُ داخلَ عمليةِ البوابةِ (gateway background drainer) لا في
 *    `apps/workers` — نقلُهُ إلى خدمةٍ منفصلةٍ (`SCL-007` / `F5-04`) لم يُغلَقْ بعد.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/src/background
 * يُتوقَّع أن يستخدمه لاحقاً: `apps/gateway/src/index.ts`
 *
 * ## لماذا دالتانِ لا واحدةٌ
 *
 * `drainTelegramUpdateJobsOnce` هي الشوطُ الواحدُ — تلتقطُ وتُعالجُ وتُختمُ. وهي ما
 * يُختَبرُ به مباشرةً بلا `setInterval`: فالاختبارُ يُلاقي حقيقةَ «التقاطٌ ثمّ ختمٌ»
 * لا مؤقِّتاً قد يتراكمُ. و`startTelegramUpdateDrainer` هي غلافُ الإنتاجِ الذي
 * يُديرُ المؤقّتَ ومانعَ التداخلِ والإيقافَ النظيفَ فوقَها.
 *
 * ## مانعُ التداخلِ
 *
 * إذا طال شوطُ المعالجةِ عن فترةِ التكرارِ، فلا يُجدولُ شوطٌ ثانٍ فوقَه: المؤقّتُ
 * يصيرُ «مُسكِتاً» لا «مُراكمَ». فلا تتنافسُ أشواطٌ على الإيجارِ، ولا تتضخّمُ
 * الذاكرةُ بدريَنرَ يقتلعُ بعضُه بعضاً.
 *
 * ## سقفُ الشوطِ (`F6-06`)
 *
 * مانعُ التداخلِ يمنعُ شوطاً فوقَ شوطٍ، ولا يمنعُ شوطاً **لا ينتهي**. وكانَ
 * الشوطُ يمضي حتّى يفرُغَ الطابورُ: فمع دفقةِ مليونِ تحديثٍ يصيرُ الشوطُ
 * الواحدُ مالِكَ العمليةِ دهراً، فيُجاعُ مسارُ HTTP في البوابةِ نفسِها (الدرينرُ
 * داخلَ عمليةِ البوابةِ بنصِّ ADR-0057)، ويتعذّرُ الإيقافُ النزيهُ لأنَّ `stop`
 * ينتظرُ الشوطَ الجاري. وهذا عينُ «الانهيارِ الشاملِ بسببِ خدمةٍ ثانويةٍ»
 * الذي سمّاه القسمُ ١٥ من الخارطةِ **عيباً معماريّاً**.
 *
 * والسقفُ هو `TELEGRAM_JOB_CONSUMER_CONCURRENCY`: حدُّ تزامنِ المستهلِكِ لهذا
 * الطابورِ، والمستهلِكُ ههنا متسلسلٌ، فمعنى الحدَّ في حقِّه **وظائفُ الشوطِ
 * الواحدِ**: يفرُغُ ما يقدرُ عليه ثمّ يُسلِمُ المعالجَ ويعودُ في التَّكةِ التّاليةِ.
 * وما بقيَ لا يُفقَدُ: الصفوفُ معلّقةٌ في القاعدةِ، و`truncated` يُعلِمُ أنَّ الطابورَ
 * لم يفرُغ فيُرصَدُ طولُ الطابورِ لا يُكتَم.
 */

import type { TelegramUpdateQueue } from "../../../../packages/infrastructure/db/telegram-update-queue.ts";
import { TELEGRAM_JOB_CONSUMER_CONCURRENCY } from "../../../../packages/shared/config/domain-ingress.ts";
import type { BotKind, UpdateHandler } from "../routes/telegram-webhook.ts";

export interface TelegramUpdateDrainDeps {
  readonly queue: TelegramUpdateQueue;
  readonly handler: UpdateHandler;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * سقفُ وظائفِ الشوطِ الواحدِ. الافتراضيُّ `TELEGRAM_JOB_CONSUMER_CONCURRENCY`.
   * ويُمرَّرُ في الاختبارِ ليُقاسَ السقفُ نفسُه بلا مائةِ وظيفةٍ وهميّةٍ.
   */
  readonly maxJobsPerRun?: number;
}

/** نتيجةُ شوطِ استنزافٍ واحد. */
export interface DrainReport {
  /** وظائفُ أُلتقطَت في هذا الشوطِ. */
  readonly claimed: number;
  /** وظائفُ خُتمَت بنجاحٍ. */
  readonly done: number;
  /** وظائفُ فشلَت وعادت للطابورِ أو ماتت. */
  readonly failed: number;
  /**
   * بلَغَ الشوطُ سقفَه والطابورُ لم يفرُغ. ولمَ يُعلَنُ: شوطٌ مقطوعٌ
   * يُقرأُ من خارجٍ شوطاً ناجحاً، فيُخفِي تراكُماً مستمرّاً.
   */
  readonly truncated: boolean;
}

/**
 * يلتقطُ وظيفةً واحدةً معلَّقةً ويُعالجُها ويُختمُها. يكرّرُ حتى يفرغَ الطابورُ
 * (claim يُعيدُ null) **أو يبلُغَ سقفَ الشوطِ فيُعلِنَ `truncated`**. يُعيدُ
 * تقريرَ الشوطِ. لا يُديرُ مؤقّتاً — للاختبارِ المباشرِ.
 */
export async function drainTelegramUpdateJobsOnce(
  deps: TelegramUpdateDrainDeps,
): Promise<DrainReport> {
  let claimed = 0;
  let done = 0;
  let failed = 0;
  let truncated = false;

  const maxJobsPerRun = deps.maxJobsPerRun ?? TELEGRAM_JOB_CONSUMER_CONCURRENCY;

  for (;;) {
    if (claimed >= maxJobsPerRun) {
      // السقفُ يُقاسُ بالملتقَطِ لا بالمختومِ: الملتقَطُ هو ما شغَلَ المستهلِكَ.
      truncated = true;
      break;
    }
    let job: Awaited<ReturnType<TelegramUpdateQueue["claim"]>>["job"];
    try {
      job = (await deps.queue.claim()).job;
    } catch (error) {
      // عجزُ القاعدةِ عندَ الالتقاطِ يكسرُ الشوطَ لا يقتله: السياقُ التاليُّ للدرينرِ
      // الخلفيِّ يُعيدُ المحاولةَ في المؤقّتِ. والوظيفةُ إن وُجدت تبقى معلَّقةً لا تُفقَد.
      const message = error instanceof Error ? error.message : String(error);
      deps.log?.("telegram.drainer.claim_failed", { error: message });
      break;
    }
    if (job === null) break;
    claimed += 1;

    const lease = { bot: job.bot, updateId: job.updateId, claimToken: job.claimToken };
    try {
      const handled = await deps.handler.handle(job.bot as BotKind, job.payload);
      const sealed = await deps.queue.finish(lease, handled, handled ? undefined : "NOT_HANDLED");
      if (handled && sealed) {
        done += 1;
      } else {
        failed += 1;
        deps.log?.("telegram.drainer.stamp_failed", {
          bot: job.bot,
          updateId: job.updateId,
          handled,
        });
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      // الختمُ كفشلٍ: إن لم تُستنفدِ المحاولاتُ تعاد للطابورِ، وإلّا ماتت نهائيّاً.
      await deps.queue.finish(lease, false, message).catch(() => {});
      deps.log?.("telegram.drainer.job_error", {
        bot: job.bot,
        updateId: job.updateId,
        error: message,
      });
    }
  }

  return { claimed, done, failed, truncated };
}

export interface TelegramUpdateDrainer {
  /** يُوقفُ المؤقّتَ وينتظرُ الشوطَ الجاري إن وُجد. */
  stop(): Promise<void>;
  /**
   * `OPS-EGRESS-01` — إيقاظٌ فوريٌّ بعدَ إيداعِ تحديثٍ في هذه العمليّة. فالتحديثُ يُعالَجُ
   * فورَ وصولِه لا عندَ الدورةِ التالية، والمؤقّتُ يصيرُ شبكةَ أمانٍ بطيئةً (إعاداتٌ مؤجّلة،
   * أو تحديثٌ أودعَته نسخةٌ أخرى) بدلَ سؤالِ القاعدةِ كلَّ نصفِ ثانيةٍ والطابورُ فارغ.
   * وإن جاءَ الإيقاظُ والشوطُ جارٍ، يُعادُ الشوطُ مرّةً بعدَه فلا يفوتُ ما أُودِعَ أثناءَه.
   */
  kick(): void;
}

export interface StartDrainerOptions {
  /** فترةُ التكرارِ بين الأشواطِ، مللي ثانية. */
  readonly intervalMs: number;
  readonly clock?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

/**
 * يُشغّلُ الدرينرَ دوريّاً في الخلفيةِ مع مانعِ تداخلٍ: إن طالَ شوطٌ عن فترةِ
 * التكرارِ يُسكَتُ المؤقّتُ ولا يُجدولُ فوقَه. يتوقّفُ نظيفاً عندَ `stop` منتظراً
 * الشوطَ الجاري.
 */
export function startTelegramUpdateDrainer(
  deps: TelegramUpdateDrainDeps,
  options: StartDrainerOptions,
): TelegramUpdateDrainer {
  const setInterval = options.clock?.setInterval ?? globalThis.setInterval;
  const clearInterval = options.clock?.clearInterval ?? globalThis.clearInterval;

  let running = false;
  let rerun = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async (): Promise<void> => {
    if (running) return; // مانعُ التداخلِ: لا شوطٌ فوقَ شوطٍ.
    running = true;
    rerun = false;
    try {
      const report = await drainTelegramUpdateJobsOnce(deps);
      if (report.claimed > 0) {
        deps.log?.("telegram.drainer.sweep_completed", { ...report });
      }
      if (report.truncated) {
        // شوطٌ مقطوعٌ يُعلَنُ وحدَه: تكرّرُه معناه أنَّ الواردَ أسرعُ من المستهلِكِ.
        deps.log?.("telegram.drainer.sweep_cap_reached", {
          claimed: report.claimed,
        });
      }
    } finally {
      running = false;
    }
    if (rerun && !stopped) {
      rerun = false;
      void tick();
    }
  };

  timer = setInterval(() => {
    void tick();
  }, options.intervalMs) as ReturnType<typeof setInterval>;

  return {
    kick: () => {
      if (stopped) return;
      if (running) {
        rerun = true;
        return;
      }
      void tick();
    },
    stop: async () => {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      // إن كان شوطٌ جارٍ، انتظرْه. لا نُهملُ وظيفةً محجوزةً.
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

/**
 * `OPS-EGRESS-01` — فترةُ شبكةِ الأمانِ حينَ لا إيقاظ. الإيداعُ في هذه العمليّةِ يوقظُ الدرينرَ
 * فورًا، فهذه الفترةُ لا تحكمُ زمنَ معالجةِ تحديثٍ جديد، بل تلتقطُ ما لا يوقظُه أحد: إعادةٌ
 * مؤجّلةٌ حانَ موعدُها، أو صفٌّ أودعته نسخةٌ أخرى ثمَّ ماتت. عشرُ ثوانٍ تُبقي أسوأَ تأخيرٍ لهما
 * قصيرًا، وتخفضُ أسئلةَ الطابورِ الفارغِ من 7200 إلى 360 في الساعة.
 */
export const TELEGRAM_DRAINER_FALLBACK_INTERVAL_MS = 10_000;

/**
 * يلفُّ منفذَ الإيداعِ فيوقظُ الدرينرَ بعدَ كلِّ إيداعٍ ناجحٍ (`enqueued`) وحدَه. والتكرارُ
 * والتشبّعُ لا يوقظان: لا عملَ جديدًا. والإيقاظُ لا يرمي ولا يُؤخّرُ ردَّ الويبهوك: يُجدوِلُ
 * الشوطَ ولا ينتظرُه.
 */
export function wakeDrainerOnEnqueue<
  T extends {
    claimAndEnqueue(bot: string, updateId: number, payload: unknown): Promise<string>;
  },
>(intake: T, wake: () => void): T {
  return {
    ...intake,
    claimAndEnqueue: async (bot: string, updateId: number, payload: unknown) => {
      const outcome = await intake.claimAndEnqueue(bot, updateId, payload);
      if (outcome === "enqueued") {
        try {
          wake();
        } catch {
          // الإيقاظُ تحسينٌ لا شرط: شبكةُ الأمانِ تلتقطُ الصفَّ.
        }
      }
      return outcome;
    },
  };
}
