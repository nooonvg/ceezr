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

import type {
  PendingUpdateReplies,
  TelegramUpdateEffectLedger,
  TelegramUpdateQueue,
} from "../../../../packages/infrastructure/db/telegram-update-queue.ts";
import {
  MIN_DRAINER_LEASE_RENEW_MS,
  TELEGRAM_JOB_CONSUMER_CONCURRENCY,
} from "../../../../packages/shared/config/domain-ingress.ts";
import type { BotKind, UpdateHandler } from "../routes/telegram-webhook.ts";
import type { TelegramReplyPool } from "./telegram-reply-pool.ts";

export interface TelegramUpdateDrainDeps {
  readonly queue: TelegramUpdateQueue;
  readonly handler: UpdateHandler;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /**
   * سقفُ وظائفِ الشوطِ الواحدِ. الافتراضيُّ `TELEGRAM_JOB_CONSUMER_CONCURRENCY`.
   * ويُمرَّرُ في الاختبارِ ليُقاسَ السقفُ نفسُه بلا مائةِ وظيفةٍ وهميّةٍ.
   */
  readonly maxJobsPerRun?: number;
  /**
   * SANDBOX-SOAK-01 — عددُ المساراتِ المتوازية. الافتراضُ ١ (السلوكُ التسلسليُّ القائم).
   * عندَ >١: تُعالَجُ تحديثاتُ المستخدمين المختلفين بالتوازي، وتحديثاتُ المستخدمِ الواحدِ
   * (لكلِّ بوت) بالترتيبِ داخلَ مسارٍ واحد — فانتظارُ دلوِ محادثةٍ (١ رسالة/ث) لا يحجبُ
   * بقيّةَ المحادثات (Head-of-line blocking).
   */
  readonly lanes?: number;
  /**
   * CAP-RUN-20261015 / D2 — البوتاتُ التي تُوزَّعُ عليها المساراتُ (الأقلُّ انشغالًا أوّلًا).
   * يتطلّبُ `queue.claimFor`؛ وبدونه يبقى الالتقاطُ العامُّ بـ created_at.
   */
  readonly fairBots?: readonly string[];
  /** CAP-RUN-20261015 / D3 — فترةُ تجديدِ إيجارِ المحجوزِ المنتظرِ (مللي ثانية). الافتراضيُّ 10ث (ثلثُ الإيجار). */
  readonly leaseRenewEveryMs?: number;
  /**
   * S5 (ADR 0288 §ملحق) — مُرسِلُ الردودِ الفوريُّ غيرُ الحاجبِ. بدونِه يُرسَلُ الردُّ داخلَ
   * مسارِ الوظيفةِ (السلوكُ السابقُ)، فيصيرُ معدّلُ إتمامِ الوظائفِ معدّلَ دلوِ البوتِ.
   */
  readonly replyPool?: TelegramReplyPool;
}

/** حقلٌ من حمولةِ تيليجرام يحملُ مُرسِلًا أو محادثة — كلُّ ما يلزمُ مفتاحَ المسار. */
interface LaneCarrier {
  readonly from?: { readonly id?: number | string };
  readonly chat?: { readonly id?: number | string };
}

/** الحقولُ التي تحملُ صاحبَ التحديثِ في Bot API، بترتيبِ الأولويّة. */
const LANE_FIELDS = [
  "message",
  "edited_message",
  "callback_query",
  "chat_join_request",
  "my_chat_member",
  "chat_member",
  "inline_query",
] as const;

/**
 * SANDBOX-SOAK-01 — مفتاحُ المسار: البوت + هويّةُ المستخدم (وإلّا المحادثة).
 * تحديثاتُ المستخدمِ الواحدِ لبوتٍ واحدٍ تقعُ في مسارٍ واحدٍ فيبقى ترتيبُها؛ وما لا
 * يحملُ مستخدمًا يأخذُ مسارًا خاصًّا به (`fallback` = رقمُ التحديث) فلا يحجبُ غيرَه.
 */
export function laneKeyOf(bot: string, payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Readonly<Record<string, LaneCarrier | undefined>>;
    for (const field of LANE_FIELDS) {
      const carrier = record[field];
      const id = carrier?.from?.id ?? carrier?.chat?.id;
      if (id !== undefined) return `${bot}:${String(id)}`;
    }
  }
  return `${bot}:u${fallback}`;
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
  const lanes = Math.max(1, Math.trunc(deps.lanes ?? 1));
  if (lanes > 1) return drainConcurrently(deps, maxJobsPerRun, lanes);

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

    if (await processClaimedJob(deps, job)) done += 1;
    else failed += 1;
  }

  return { claimed, done, failed, truncated };
}

/**
 * معالجةُ وظيفةٍ ملتقَطةٍ واحدةٍ وختمُها — مشتركةٌ بينَ المسارِ التسلسليِّ والمتوازي
 * فلا يختلفُ بينهما معنى «تمّ» ولا «فشل». تعيدُ `true` إن عولجَت وخُتمَت.
 */
async function processClaimedJob(deps: TelegramUpdateDrainDeps, job: ClaimedJob): Promise<boolean> {
  const lease = { bot: job.bot, updateId: job.updateId, claimToken: job.claimToken };
  const ledger = deps.queue.ledger;
  if (
    ledger !== undefined &&
    deps.handler.prepare !== undefined &&
    deps.handler.deliver !== undefined
  ) {
    return processDurably(deps, job, lease, ledger);
  }
  try {
    const handled = await deps.handler.handle(job.bot as BotKind, job.payload);
    const sealed = await deps.queue.finish(lease, handled, handled ? undefined : "NOT_HANDLED");
    if (handled && sealed) return true;
    deps.log?.("telegram.drainer.stamp_failed", {
      bot: job.bot,
      updateId: job.updateId,
      handled,
    });
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.queue.finish(lease, false, message).catch(() => {});
    deps.log?.("telegram.drainer.job_error", {
      bot: job.bot,
      updateId: job.updateId,
      error: message,
    });
    return false;
  }
}

/**
 * S5 (ADR 0288) — المسارُ الدائمُ: (١) إعادةٌ بعدَ ختمٍ ⇒ لا أثرَ ثانٍ، تُتمُّ الوظيفةُ؛
 * (٢) الأثرُ وحسابُ الردودِ؛ (٣) ختمُ الأثرِ + نيّةِ الردِّ + إتمامِ الوظيفةِ ذرّيًّا —
 * إخفاقُه يُبقي الوظيفةَ غيرَ مُتمّةٍ (لا نجاحَ يُسجَّلُ قبلَ الالتزامِ)؛ (٤) إرسالٌ فوريٌّ
 * مِن المؤشرِ ثم ختمُه — رفضُه يُجدوِلُ الردَّ وحدَه للمُرسِلِ الخلفيِّ ولا يمسُّ الوظيفةَ.
 */
async function processDurably(
  deps: TelegramUpdateDrainDeps,
  job: ClaimedJob,
  lease: { bot: string; updateId: number; claimToken: string },
  ledger: TelegramUpdateEffectLedger,
): Promise<boolean> {
  const bot = job.bot as BotKind;
  try {
    if (await ledger.effectRecorded(job.bot, job.updateId)) {
      const replay = await ledger.recordEffect(lease, []);
      deps.log?.("telegram.drainer.effect_replay_skipped", {
        bot: job.bot,
        updateId: job.updateId,
        sealed: replay.ok,
      });
      return replay.ok;
    }
    const prepared = await (deps.handler.prepare as NonNullable<UpdateHandler["prepare"]>)(
      bot,
      job.payload,
    );
    if (!prepared.handled) {
      await deps.queue.finish(lease, false, "NOT_HANDLED").catch(() => {});
      deps.log?.("telegram.drainer.stamp_failed", {
        bot: job.bot,
        updateId: job.updateId,
        handled: false,
      });
      return false;
    }
    const recorded = await ledger.recordEffect(lease, prepared.replies);
    if (!recorded.ok) {
      deps.log?.("telegram.drainer.effect_record_failed", {
        bot: job.bot,
        updateId: job.updateId,
        error: recorded.error,
      });
      return false;
    }
    if (recorded.replyToken !== null) {
      const pending: PendingUpdateReplies = {
        bot: job.bot,
        updateId: job.updateId,
        replies: prepared.replies,
        repliesSent: 0,
        replyToken: recorded.replyToken,
        attempts: 0,
      };
      // الوظيفةُ مُتمّةٌ منذُ `recordEffect`؛ والردُّ لا يحجزُ المسارَ عن الوظيفةِ التاليةِ.
      // الامتلاءُ (أو غيابُ المُرسِلِ) ⇒ إرسالٌ داخلَ المسارِ: ضغطٌ خلفيٌّ صريحٌ.
      const queued =
        deps.replyPool?.submit(laneKeyOf(job.bot, job.payload, String(job.updateId)), () =>
          sendRepliesFrom(deps, ledger, pending),
        ) ?? false;
      if (!queued) await sendRepliesFrom(deps, ledger, pending);
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.queue.finish(lease, false, message).catch(() => {});
    deps.log?.("telegram.drainer.job_error", {
      bot: job.bot,
      updateId: job.updateId,
      error: message,
    });
    return false;
  }
}

/** إرسالُ ردودِ وظيفةٍ من مؤشرِها ثم ختمُ المحاولةِ — للمسارِ الفوريِّ والخلفيِّ معًا. */
async function sendRepliesFrom(
  deps: TelegramUpdateDrainDeps,
  ledger: TelegramUpdateEffectLedger,
  pending: PendingUpdateReplies,
): Promise<string | null> {
  const deliver = deps.handler.deliver as NonNullable<UpdateHandler["deliver"]>;
  let result: Awaited<ReturnType<typeof deliver>>;
  try {
    result = await deliver(pending.bot as BotKind, pending.replies, pending.repliesSent);
  } catch (error) {
    result = {
      sent: pending.repliesSent,
      error: {
        message: error instanceof Error ? error.message : String(error),
        retryAfterSec: null,
      },
    };
  }
  const outcome = await ledger
    .finishReplies(
      pending.bot,
      pending.updateId,
      pending.replyToken,
      result.sent,
      result.error?.message ?? null,
      result.error?.retryAfterSec ?? null,
    )
    .catch((error: unknown) => {
      // إخفاقُ الختمِ يُبقي الردَّ `sending`؛ ينقضي إيجارُه فيلتقطُه المُرسِلُ الخلفيُّ
      // (وقد يُعيدُ ما قبلَه تيليجرامُ — «مرةً على الأقلِّ»، ADR 0288).
      deps.log?.("telegram.replies.finish_failed", {
        bot: pending.bot,
        updateId: pending.updateId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  if (result.error !== null) {
    deps.log?.("telegram.replies.deferred", {
      bot: pending.bot,
      updateId: pending.updateId,
      sent: result.sent,
      total: pending.replies.length,
      outcome,
      retryAfterSec: result.error.retryAfterSec,
    });
  }
  return outcome;
}

/** إيجارُ إرسالِ الردِّ: بعدَه يُعدُّ حائزُه ميتًا فيُستردُّ الردُّ. */
export const TELEGRAM_REPLY_LEASE_SECONDS = 60;

/**
 * S5 — المُرسِلُ الخلفيُّ لردودِ الحوارِ المؤجّلةِ: يلتقطُ المستحقَّ (بعدَ تراجعِه) والمحمولَ
 * الذي ماتَ حائزُه (إعادةُ تشغيلٍ)، ويُكملُ كلًّا من مؤشرِه. لا يمسُّ الأثرَ التجاريَّ.
 */
export async function drainTelegramUpdateRepliesOnce(
  deps: TelegramUpdateDrainDeps,
  limit = 20,
): Promise<{ readonly claimed: number; readonly done: number }> {
  const ledger = deps.queue.ledger;
  if (ledger === undefined || deps.handler.deliver === undefined) return { claimed: 0, done: 0 };
  let pending: readonly PendingUpdateReplies[];
  try {
    pending = await ledger.claimReplies(limit, TELEGRAM_REPLY_LEASE_SECONDS);
  } catch (error) {
    deps.log?.("telegram.replies.claim_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { claimed: 0, done: 0 };
  }
  let done = 0;
  // بالتسلسلِ: الالتقاطُ رتّبَ المساراتِ، والإرسالُ محكومٌ بدلاءِ البوتِ أصلًا.
  for (const item of pending) {
    if ((await sendRepliesFrom(deps, ledger, item)) === "done") done += 1;
  }
  return { claimed: pending.length, done };
}

type ClaimedJob = NonNullable<Awaited<ReturnType<TelegramUpdateQueue["claim"]>>["job"]>;

/**
 * SANDBOX-SOAK-01 — استنزافٌ متوازٍ بمساراتٍ لكلِّ مستخدم. يلتقطُ حتى `lanes` وظيفةً جاريةً،
 * ويُسلسِلُ وظائفَ المفتاحِ الواحدِ (البوت+المستخدم) خلفَ بعضِها بترتيبِ الالتقاطِ (= created_at).
 */
async function drainConcurrently(
  deps: TelegramUpdateDrainDeps,
  maxJobsPerRun: number,
  lanes: number,
): Promise<DrainReport> {
  let claimed = 0;
  let done = 0;
  let failed = 0;
  let truncated = false;
  const tails = new Map<string, Promise<void>>();
  const inflight = new Set<Promise<void>>();
  // D3: كلُّ محجوزٍ لم يُختَم بعدُ (ينتظرُ مسارَه أو يُعالَج) يُجدَّدُ إيجارُه دوريًّا.
  const held = new Map<string, { bot: string; updateId: number; claimToken: string }>();
  const renewEvery = Math.max(MIN_DRAINER_LEASE_RENEW_MS, deps.leaseRenewEveryMs ?? 10_000);
  const renewTimer =
    deps.queue.renew === undefined
      ? null
      : setInterval(() => {
          const leases = [...held.values()];
          if (leases.length === 0) return;
          deps.queue.renew?.(leases).then(
            (n) => {
              if (n < leases.length)
                deps.log?.("telegram.drainer.lease_renew_partial", {
                  held: leases.length,
                  renewed: n,
                });
            },
            (error: unknown) =>
              deps.log?.("telegram.drainer.lease_renew_failed", {
                error: error instanceof Error ? error.message : String(error),
              }),
          );
        }, renewEvery);
  // D2: توزيعُ الالتقاطِ بين البوتين — الأقلُّ انشغالًا أوّلًا، ومن فرغَ طابورُه في هذا الشوطِ يُتخطّى.
  const fair =
    deps.fairBots !== undefined && deps.fairBots.length > 1 && deps.queue.claimFor !== undefined
      ? [...deps.fairBots]
      : null;
  const busy = new Map<string, number>();
  const drained = new Set<string>();
  const nextClaim = async (): Promise<ClaimedJob | null> => {
    if (fair === null) return (await deps.queue.claim()).job;
    for (;;) {
      const open = fair.filter((b) => !drained.has(b));
      if (open.length === 0) return null;
      open.sort((a, b) => (busy.get(a) ?? 0) - (busy.get(b) ?? 0));
      const bot = open[0] as string;
      const job = (await deps.queue.claimFor?.(bot))?.job ?? null;
      if (job !== null) return job;
      drained.add(bot);
    }
  };

  try {
    for (;;) {
      if (claimed >= maxJobsPerRun) {
        truncated = true;
        break;
      }
      while (inflight.size >= lanes) await Promise.race(inflight);
      let job: ClaimedJob | null;
      try {
        job = await nextClaim();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.log?.("telegram.drainer.claim_failed", { error: message });
        break;
      }
      if (job === null) break;
      claimed += 1;
      const claimedJob = job;
      const heldKey = `${claimedJob.bot}:${claimedJob.updateId}`;
      held.set(heldKey, {
        bot: claimedJob.bot,
        updateId: claimedJob.updateId,
        claimToken: claimedJob.claimToken,
      });
      busy.set(claimedJob.bot, (busy.get(claimedJob.bot) ?? 0) + 1);
      const key = laneKeyOf(claimedJob.bot, claimedJob.payload, String(claimedJob.updateId));
      const prev = tails.get(key) ?? Promise.resolve();
      const run = prev.then(async () => {
        if (await processClaimedJob(deps, claimedJob)) done += 1;
        else failed += 1;
      });
      tails.set(key, run);
      const tracked: Promise<void> = run.finally(() => {
        held.delete(heldKey);
        busy.set(claimedJob.bot, (busy.get(claimedJob.bot) ?? 1) - 1);
        inflight.delete(tracked);
        if (tails.get(key) === run) tails.delete(key);
      });
      inflight.add(tracked);
    }
    await Promise.all(inflight);
  } finally {
    if (renewTimer !== null) clearInterval(renewTimer);
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
  /** S5 — فترةُ مُرسِلِ الردودِ المؤجّلةِ (افتراضيًّا `TELEGRAM_REPLY_DRAIN_INTERVAL_MS`). */
  readonly replyIntervalMs?: number;
}

/** S5 (ADR 0288) — فترةُ التقاطِ الردودِ المؤجّلةِ: أقصرُ تراجعٍ ثانيتان. */
export const TELEGRAM_REPLY_DRAIN_INTERVAL_MS = 2_000;

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
        // CAP-RUN-20261015 / D1: بقيَ عملٌ مستحقٌّ يقينًا، فيُستأنَفُ فورًا بدلَ انتظارِ مؤقّتِ
        // الأمانِ (10ث). السقفُ يبقى حدًّا للشوطِ الواحدِ (ليُسمَعَ stop ويُعادَ تقييمُ الطابور)،
        // لا سقفًا لمعدّلِ الاستنزافِ كلِّه. مُختبَر: telegram-update-drainer-truncated-rerun.test.ts
        rerun = true;
      }
      if (report.done + report.failed > 0) {
        // CAP-RUN-20261015 / D5: مع D4 لا تُلتقَطُ وظيفةُ المستخدمِ التاليةُ ما دامت سابقتُه محجوزة؛ فمسارٌ
        // رأى claim=null قد خرجَ قبلَ أن تُختَمَ السابقة. شوطٌ ختمَ وظيفةً يُعيدُ الجدولةَ فورًا ليلتقطَ ما
        // فُكَّ حجبُه، وشوطٌ فارغٌ لا يُعيد (لا دوَرانَ فارغ). مُختبَر: telegram-update-drainer-lane-unblock-rerun.test.ts
        rerun = true;
      }
    } finally {
      running = false;
    }
    if (rerun && !stopped) {
      rerun = false;
      // CAP-RUN-20261015 / D1: الإعادةُ بعدَ تسليمِ الحلقةِ (macrotask) لا في السلسلةِ نفسِها، فلا
      // تُجوِّعُ سلسلةُ أشواطٍ متتاليةٍ حلقةَ الأحداثِ (مؤقّتات، stop، استقبالُ الويبهوك).
      setImmediate(() => {
        if (!stopped) void tick();
      });
    }
  };

  timer = setInterval(() => {
    void tick();
  }, options.intervalMs) as ReturnType<typeof setInterval>;

  // S5 (ADR 0288) — مؤقّتُ الردودِ المؤجّلةِ مستقلٌّ عن أشواطِ الوظائفِ: التراجعُ يبدأُ
  // من ثانيتين، فلا ينتظرُ ردٌّ مستحقٌّ شبكةَ الأمانِ (10ث). وبلا دفترٍ لا مؤقّتَ أصلًا.
  let replying = false;
  const replyTimer =
    deps.queue.ledger === undefined || deps.handler.deliver === undefined
      ? null
      : (setInterval(() => {
          if (replying || stopped) return;
          replying = true;
          void drainTelegramUpdateRepliesOnce(deps)
            .then((report) => {
              if (report.claimed > 0) deps.log?.("telegram.replies.sweep_completed", { ...report });
            })
            .finally(() => {
              replying = false;
            });
        }, options.replyIntervalMs ?? TELEGRAM_REPLY_DRAIN_INTERVAL_MS) as ReturnType<
          typeof setInterval
        >);

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
      if (replyTimer !== null) clearInterval(replyTimer);
      while (replying) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // الردودُ المقبولةُ في المُرسِلِ الفوريِّ تُكمَلُ أو تُتركُ لإيجارِها (لا تُفقَدُ: صفُّها دائمٌ).
      if (deps.replyPool !== undefined) {
        await Promise.race([
          deps.replyPool.idle(),
          new Promise((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
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

/**
 * CAP-RUN-20261015 — تحليلٌ صريحٌ لـ`TELEGRAM_DRAIN_LANES` بدل `Number(...)`: كان "1e3" يصيرُ 1000،
 * و"-5"/"abc" يسقطانِ صامتَين. المقبولُ عددٌ صحيحٌ عشريٌّ 1..256؛ غيرُه ⇒ 1 (التسلسليّ) مع إعلانِ invalid.
 */
export const TELEGRAM_DRAIN_LANES_MAX = 256;
export function parseTelegramDrainLanes(raw: string | undefined): {
  lanes: number;
  invalid: boolean;
} {
  if (raw === undefined || raw.trim() === "") return { lanes: 1, invalid: false };
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return { lanes: 1, invalid: true };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 1 || n > TELEGRAM_DRAIN_LANES_MAX)
    return { lanes: 1, invalid: true };
  return { lanes: n, invalid: false };
}
