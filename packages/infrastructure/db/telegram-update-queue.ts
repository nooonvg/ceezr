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
   * CAP-RUN-20261015 / D3 — تجديدُ إيجارِ وظائفَ ما زالت محجوزةً بالرمزِ نفسِه (تنتظرُ مسارَها).
   * يعيدُ عددَ المجدَّد. اختياريٌّ.
   */
  renew?(jobs: readonly JobLease[]): Promise<number>;
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
