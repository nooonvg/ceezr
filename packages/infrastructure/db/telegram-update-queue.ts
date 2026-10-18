/**
 * الغرض: منفذُ طابورِ وظائفِ تحديثِ تيليجرام — ما يلتقطُه الدرينرُ الخلفيُّ
 *    ويعالجُه خارجَ مسارِ HTTP. الالتقاطُ بإيجارٍ (FOR UPDATE SKIP LOCKED +
 *    claim_token)، والختمُ برمزِ الوظيفةِ لا الإيصالِ، والاسترجاعُ للإيجارِ
 *    المنتهي، والموتُ النهائيُّ للوظيفةِ الفاشلةِ. مرآةٌ لِـ`claim_notification_delivery`
 *    لكنّها فوقَ `telegram_update_jobs` المربوطِ 1:1 بالإيصالِ.
 *    الشطرُ التنفيذيُّ من [ADR 0057](../../../../docs/adr/0057-telegram-ingress-bound-payload-carrier-and-worker.md).
 * الحالة: منفّذ فعلياً — إغلاقُ `BUG-002` / `F6-02`.
 * ينتمي إلى: packages/infrastructure/db
 * يُتوقَّع أن يستخدمه لاحقاً: `apps/gateway/src/background/telegram-update-drainer.ts`
 *
 * ## لماذا سُلطةُ الختمِ هي رمزُ الوظيفةِ لا الإيصالِ
 *
 * الويبهوكُ يُودعُ الإيصالَ والوظيفةَ ويعيدُ ACK فوراً — فلا يملكُ رمزَ حجزٍ
 * يُختمُ به. الدرينرُ وحده يملكُ إيجارَ الوظيفةِ (claim_token)، فهو سُلطةُ الختمِ:
 * `finish_telegram_update_job` يتحقّقُ من رمزِ الوظيفةِ ويختمُ النصفينِ معاً ذرّيًّا.
 *
 * ## لماذا رميٌّ لا Result
 *
 * الدرينرُ يلتقطُ في حلقةٍ، وأيُّ فشلِ قاعدةٍ فيها يعني أنّه لا جديدَ يُلتقطُ — فالرميُ
 * يكسرُ الحلقةَ طبيعيّاً ويظهرُ الخطأُ في السجلِّ. أنماطُ `guard`/`Result` للمنافذِ التي
 * تُرجِعُ قراراتٍ قابلةً للمعالجةِ، وههنا القرارُ ثنائيٌّ: إمّا وظيفةٌ أو لا.
 */

import {
  TELEGRAM_JOB_LEASE_TIMEOUT_SECONDS,
  TELEGRAM_JOB_MAX_ATTEMPTS,
  TELEGRAM_JOB_RETRY_DELAY_SECONDS,
} from "../../shared/config/domain-ingress.ts";
import { readEnvelope, type Sql } from "./client.ts";

/** وظيفةٌ ملتقَطةٌ جاهزةٌ للمعالجةِ، أو `null` إن لم يكن معلَّقٌ. */
export interface ClaimedTelegramUpdateJob {
  readonly bot: string;
  readonly updateId: number;
  /** حمولةُ التحديثِ الخامِّ كما أُودِعَت عندَ الاستلام. */
  readonly payload: Record<string, unknown>;
  /** رمزُ إيجارِ الوظيفةِ — به يُختَمُ أو يُترَكُ. */
  readonly claimToken: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** مُعرِّفُ وظيفةٍ مُحتجَزةٍ — ما يحتاجُه الدرينرُ ليختمَ أو يتركَ. */
export interface JobLease {
  readonly bot: string;
  readonly updateId: number;
  readonly claimToken: string;
}

export interface TelegramUpdateQueue {
  /**
   * يلتقطُ وظيفةً معلَّقةً واحدةً بإيجارٍ. يسترجعُ الإيجاراتِ المنتهيةَ أوّلاً،
   * ثمّ يلتقطُ بـFOR UPDATE SKIP LOCKED. يعيدُ {job: null} إن لم يكن معلَّقٌ.
   * يرمي عندَ عجزِ القاعدةِ.
   */
  claim(): Promise<{ job: ClaimedTelegramUpdateJob | null }>;
  /**
   * يختمُ الوظيفةَ والإيصالَ معاً برمزِ الوظيفةِ. delivered=true⇒done، وإلّا
   * فإمّا إعادةُ تسليمٍ (pending) أو موتٌ نهائيٌّ (dead) عندَ استنفادِ المحاولاتِ.
   */
  finish(job: JobLease, delivered: boolean, errorCode?: string): Promise<boolean>;
  /** موتٌ نهائيٌّ صريحٌ للوظيفةِ الفاشلةِ التي لن تُقبلَ أبداً. */
  abandon(job: JobLease, errorCode?: string): Promise<boolean>;
  /**
   * CAP-RUN-20261015 / D2 — التقاطٌ مقيَّدٌ ببوتٍ واحد (لتوزيعِ المساراتِ بين البوتين). اختياريٌّ:
   * طابورٌ لا يوفّرُه يُستعمَلُ `claim()` العامُّ كما كان.
   */
  claimFor?(bot: string): Promise<{ job: ClaimedTelegramUpdateJob | null }>;
  /**
   * LOAD-01 (الدفعةُ السابعةُ) — التقاطُ حتى `limit` وظيفةً لبوتٍ في رحلةٍ واحدةٍ، **مرتّبةً
   * بـ`created_at`** (ترتيبُ تحديثاتِ المستخدمِ محفوظٌ). اختياريٌّ: غيابُه = `claimFor` المفردُ.
   */
  claimBatchFor?(
    bot: string,
    limit: number,
  ): Promise<{ jobs: readonly ClaimedTelegramUpdateJob[] }>;
  /**
   * CAP-RUN-20261015 / D3 — تجديدُ إيجارِ وظائفَ ما زالت محجوزةً بالرمزِ نفسِه (تنتظرُ مسارَها).
   * يعيدُ عددَ المجدَّد. اختياريٌّ.
   */
  renew?(jobs: readonly JobLease[]): Promise<number>;
  /** S5 (ADR 0288) — دفترُ الأثرِ ونيّةُ الردِّ الدائمةُ. اختياريٌّ: غيابُه = المسارُ القديمُ. */
  readonly ledger?: TelegramUpdateEffectLedger;
}

export interface PendingUpdateReplies {
  readonly bot: string;
  readonly updateId: number;
  readonly replies: readonly unknown[];
  readonly repliesSent: number;
  readonly replyToken: string;
  readonly attempts: number;
}

export type RecordEffectResult =
  | { readonly ok: true; readonly first: boolean; readonly replyToken: string | null }
  | { readonly ok: false; readonly error: string };

export interface TelegramUpdateEffectLedger {
  /** هل خُتمَ أثرُ التحديثِ سلفًا؟ (إعادةٌ بعدَ انقضاءِ إيجارٍ — لا يُعادُ الأثرُ). */
  effectRecorded(bot: string, updateId: number): Promise<boolean>;
  /** ختمُ الأثرِ + نيّةِ الردِّ + إتمامِ الوظيفةِ في معاملةٍ واحدةٍ (لحائزِ الإيجارِ). */
  recordEffect(job: JobLease, replies: readonly unknown[]): Promise<RecordEffectResult>;
  /** ختمُ محاولةِ إرسالٍ بالمؤشرِ؛ يعيدُ `done`/`retried`/`dead` أو `null` إن فُقدتِ الملكيةُ. */
  finishReplies(
    bot: string,
    updateId: number,
    replyToken: string,
    sent: number,
    error: string | null,
    retryAfterSec: number | null,
  ): Promise<string | null>;
  /** التقاطُ الردودِ المستحقّةِ والمحمولةِ التي ماتَ حائزُها. */
  claimReplies(limit: number, leaseSeconds: number): Promise<readonly PendingUpdateReplies[]>;
}

function envelopeOf(value: unknown, name: string): Record<string, unknown> {
  const result = readEnvelope(value);
  if (result === null) throw new Error(`ردّ ${name} غير مفهوم`);
  return result;
}

export function createPostgresTelegramUpdateQueue(
  sql: Sql,
  options?: {
    readonly leaseTimeoutSeconds?: number;
    readonly maxAttempts?: number;
    readonly retryDelaySeconds?: number;
  },
): TelegramUpdateQueue {
  const leaseTimeout = options?.leaseTimeoutSeconds ?? TELEGRAM_JOB_LEASE_TIMEOUT_SECONDS;
  const maxAttempts = options?.maxAttempts ?? TELEGRAM_JOB_MAX_ATTEMPTS;
  const retryDelay = options?.retryDelaySeconds ?? TELEGRAM_JOB_RETRY_DELAY_SECONDS;

  return {
    claim: async () => {
      const rows = await sql<{ result: unknown }[]>`
        select claim_telegram_update_job(${leaseTimeout}, ${maxAttempts}) as result
      `;
      const row = envelopeOf(rows[0]?.result, "claim_telegram_update_job");
      if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
      const delivery = row.delivery as Record<string, unknown> | null;
      if (delivery == null) return { job: null };
      const payload = delivery.payload;
      return {
        job: {
          bot: String(delivery.bot),
          updateId: Number(delivery.update_id),
          payload:
            typeof payload === "object" && payload !== null
              ? (payload as Record<string, unknown>)
              : {},
          claimToken: String(delivery.claim_token),
          attempts: Number(delivery.attempts),
          maxAttempts: Number(delivery.max_attempts),
        } satisfies ClaimedTelegramUpdateJob,
      };
    },

    claimFor: async (bot: string) => {
      const rows = await sql<{ result: unknown }[]>`
        select claim_telegram_update_job_for_bot(${leaseTimeout}, ${maxAttempts}, ${bot}) as result
      `;
      const row = envelopeOf(rows[0]?.result, "claim_telegram_update_job_for_bot");
      if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
      const delivery = row.delivery as Record<string, unknown> | null;
      if (delivery == null) return { job: null };
      const payload = delivery.payload;
      return {
        job: {
          bot: String(delivery.bot),
          updateId: Number(delivery.update_id),
          payload:
            typeof payload === "object" && payload !== null
              ? (payload as Record<string, unknown>)
              : {},
          claimToken: String(delivery.claim_token),
          attempts: Number(delivery.attempts),
          maxAttempts: Number(delivery.max_attempts),
        } satisfies ClaimedTelegramUpdateJob,
      };
    },

    claimBatchFor: async (bot: string, limit: number) => {
      const rows = await sql<{ result: unknown }[]>`
        select claim_telegram_update_jobs_for_bot(${leaseTimeout}, ${maxAttempts}, ${bot}, ${limit}) as result
      `;
      const row = envelopeOf(rows[0]?.result, "claim_telegram_update_jobs_for_bot");
      if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
      const list = Array.isArray(row.jobs) ? (row.jobs as Record<string, unknown>[]) : [];
      return {
        jobs: list.map(
          (delivery) =>
            ({
              bot: String(delivery.bot),
              updateId: Number(delivery.update_id),
              payload:
                typeof delivery.payload === "object" && delivery.payload !== null
                  ? (delivery.payload as Record<string, unknown>)
                  : {},
              claimToken: String(delivery.claim_token),
              attempts: Number(delivery.attempts),
              maxAttempts: Number(delivery.max_attempts),
            }) satisfies ClaimedTelegramUpdateJob,
        ),
      };
    },

    renew: async (jobs) => {
      if (jobs.length === 0) return 0;
      const rows = await sql<{ n: number }[]>`
        select renew_telegram_update_leases(
          ${jobs.map((j) => j.bot)}::text[], ${jobs.map((j) => j.updateId)}::bigint[], ${jobs.map((j) => j.claimToken)}::uuid[]
        ) as n
      `;
      return Number(rows[0]?.n ?? 0);
    },

    finish: async (job, delivered, errorCode) => {
      const rows = await sql<{ result: unknown }[]>`
        select finish_telegram_update_job(
          ${job.bot}, ${job.updateId}, ${job.claimToken}::uuid,
          ${delivered}, ${errorCode ?? null}, ${maxAttempts}, ${retryDelay}
        ) as result
      `;
      const row = envelopeOf(rows[0]?.result, "finish_telegram_update_job");
      return row.ok === true;
    },

    ledger: {
      effectRecorded: async (bot, updateId) => {
        const rows = await sql<{ r: boolean }[]>`
          select telegram_update_effect_recorded(${bot}, ${updateId}) as r`;
        return rows[0]?.r === true;
      },
      recordEffect: async (job, replies) => {
        const rows = await sql<{ result: unknown }[]>`
          select record_telegram_update_effect(
            ${job.bot}, ${job.updateId}, ${job.claimToken}::uuid, ${sql.json(replies as never)}::jsonb
          ) as result`;
        const row = envelopeOf(rows[0]?.result, "record_telegram_update_effect");
        if (row.ok !== true) return { ok: false, error: String(row.error ?? "UNKNOWN") };
        return {
          ok: true,
          first: row.first === true,
          replyToken: typeof row.reply_token === "string" ? row.reply_token : null,
        };
      },
      finishReplies: async (bot, updateId, replyToken, sent, error, retryAfterSec) => {
        const rows = await sql<{ result: unknown }[]>`
          select finish_telegram_update_replies(
            ${bot}, ${updateId}, ${replyToken}::uuid, ${sent}::integer,
            ${error}, ${retryAfterSec}::integer
          ) as result`;
        const row = envelopeOf(rows[0]?.result, "finish_telegram_update_replies");
        return row.ok === true ? String(row.outcome) : null;
      },
      claimReplies: async (limit, leaseSeconds) => {
        const rows = await sql<{ result: unknown }[]>`
          select claim_telegram_update_replies(${limit}::integer, ${leaseSeconds}::integer) as result`;
        const row = envelopeOf(rows[0]?.result, "claim_telegram_update_replies");
        if (row.ok !== true) throw new Error(String(row.error ?? "UNKNOWN"));
        const jobs = Array.isArray(row.jobs) ? (row.jobs as Record<string, unknown>[]) : [];
        return jobs.map((j) => ({
          bot: String(j.bot),
          updateId: Number(j.update_id),
          replies: Array.isArray(j.replies) ? (j.replies as unknown[]) : [],
          repliesSent: Number(j.replies_sent ?? 0),
          replyToken: String(j.reply_token),
          attempts: Number(j.attempts ?? 0),
        }));
      },
    },

    abandon: async (job, errorCode) => {
      const rows = await sql<{ result: unknown }[]>`
        select abandon_telegram_update_job(
          ${job.bot}, ${job.updateId}, ${job.claimToken}::uuid, ${errorCode ?? null}
        ) as result
      `;
      const row = envelopeOf(rows[0]?.result, "abandon_telegram_update_job");
      return row.ok === true;
    },
  };
}
