/**
 * الغرض: قراءة مؤشرات تشغيلية مختصرة من PostgreSQL عند طلب /metrics، مع cache قصير
 *   وstatement_timeout كي لا يصبح جامِع المراقبة نفسه حملاً أو نقطة تعطل.
 * الحالة: منفّذ فعلياً — طبقة المراقبة التشغيلية.
 * ينتمي إلى: packages/infrastructure/observability
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/routes/metrics.ts.
 * ملاحظات مستقبلية: إذا كبرت الجداول تُراجع EXPLAIN لهذه الاستعلامات قبل تقصير cache.
 */

import { QUEUE_DEAD_WINDOW_SECONDS } from "../../shared/config/queue-backpressure.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";
import type { DatabaseGaugeValues, OperationalMetrics } from "./metrics.ts";

interface GaugeRow {
  readonly searching_orders: number;
  readonly available_drivers: number;
  readonly expired_subscriptions_today: number;
  readonly last_successful_backup_timestamp_seconds: number | null;
  readonly outbox_depth: number;
  readonly outbox_oldest_due_age_seconds: number | null;
  readonly outbox_dead_recent: number;
  readonly outbox_claimed: number;
  readonly telegram_jobs_depth: number;
  readonly telegram_jobs_oldest_due_age_seconds: number | null;
  readonly telegram_jobs_dead_recent: number;
  readonly telegram_jobs_claimed: number;
  readonly connections_active: number;
  readonly connections_idle: number;
  readonly connections_idle_in_transaction: number;
  readonly connections_other: number;
  readonly connections_limit: number;
  readonly matched_in_window: number;
  readonly assignment_p50_seconds: number | null;
  readonly assignment_p90_seconds: number | null;
}

/**
 * نافذةُ زمنِ الإسنادِ (`F8-02`): خمسُ دقائقَ. ولَم قصيرةٌ؟ لأنَّ الغرضَ
 * إنذارٌ حيٌّ: نافذةٌ بساعاتٍ تغمرُ تدهوراً عمرُه دقائقُ في متوسّطٍ هادئٍ
 * فيُقرأُ أنَّ شيئاً لم يقعْ. وهيَ **تُنشَرُ مقياساً** فلا يُقارَنُ رقمُها
 * برقمِ لوحةِ الإدارةِ (`F7-08`) وهما على نافذتينِ مختلفتينِ.
 */
export const ASSIGNMENT_WINDOW_SECONDS = 300;

export interface DatabaseGaugeCollectionError {
  readonly code: "DATABASE_GAUGE_COLLECTION_FAILED";
  readonly detail: string;
}

export interface DatabaseGaugeCollectorOptions {
  /** مدة حفظ قصيرة: تمنع تضخيم استعلامات العد عند تزامن جامعين Prometheus. */
  readonly cacheTtlMs?: number;
  /** حد زمني تقني داخل PostgreSQL؛ لا يترك الاستعلام العالق يستهلك اتصالاً. */
  readonly statementTimeoutMs?: number;
  readonly now?: () => number;
}

export interface DatabaseGaugeCollector {
  collect(): Promise<Result<DatabaseGaugeValues, DatabaseGaugeCollectionError>>;
}

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 2_000;

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/**
 * الجواب محفوظ 15 ثانية افتراضياً، لا بدقائق: هذه أرقام إنذار حيّة، لكن قراءة أربعة
 * عدّادات عند كل طلب من أكثر من جامع تكلف القاعدة أكثر من قيمة الدقة اللحظية.
 */
export function createDatabaseGaugeCollector(
  sql: Sql,
  metrics: OperationalMetrics,
  options: DatabaseGaugeCollectorOptions = {},
): DatabaseGaugeCollector {
  const cacheTtlMs = positiveInteger(
    options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    DEFAULT_CACHE_TTL_MS,
  );
  const statementTimeoutMs = positiveInteger(
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
    DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const now = options.now ?? Date.now;
  let cached: { readonly atMs: number; readonly value: DatabaseGaugeValues } | null = null;
  let inFlight: Promise<Result<DatabaseGaugeValues, DatabaseGaugeCollectionError>> | null = null;

  async function query(): Promise<Result<DatabaseGaugeValues, DatabaseGaugeCollectionError>> {
    const startedAt = now();
    try {
      const rows = await sql.begin(async (transaction) => {
        // القيمة رقم مُطبّع محلياً قبل إدخالها في SET، فلا تدخل نصوص من طلب HTTP إلى SQL.
        await transaction.unsafe(`set local statement_timeout = ${statementTimeoutMs}`);
        return transaction<GaugeRow[]>`
          select
            (select count(*)::int from orders where status = 'searching') as searching_orders,
            (select count(*)::int from driver_availability where is_available) as available_drivers,
            (select count(*)::int
               from subscriptions
              where status = 'expired'
                and updated_at >= date_trunc('day', now())
                and updated_at < date_trunc('day', now()) + interval '1 day')
              as expired_subscriptions_today,
            (select extract(epoch from max(created_at))::float8
               from db_backups
              where status = 'success') as last_successful_backup_timestamp_seconds,
            -- حِمْلُ الطوابيرِ الصامدةِ (F6-06): مجموعٌ على المدنِ كلِّها، فلا وسمَ
            -- مدينةٍ في المقياسِ. والتعريفاتُ حرفاً حرفاً كما في دالَّتَي الحِمْلِ
            -- notification_outbox_load وtelegram_update_jobs_load: عمقٌ = عملٌ لم
            -- يُنهَ (معلَّقٌ + محجوزٌ)، وعمرٌ = أقدمُ **مستحقٍّ** معلَّقٍ، وموتى في
            -- نافذةٍ. واختلافُ التعريفِ بينَ اللوحةِ وحكمِ القاعدةِ هوَ عينُ العطبِ
            -- الذي يُصلِحُه هذا البندُ: رقمانِ باسمٍ واحدٍ ومعنيَينِ.
            (select count(*)::int from notification_outbox
              where status in ('pending', 'sending')) as outbox_depth,
            (select extract(epoch from now() - min(next_attempt_at))::float8
               from notification_outbox
              where status = 'pending' and next_attempt_at <= now())
              as outbox_oldest_due_age_seconds,
            (select count(*)::int from notification_outbox
              where status = 'dead' and died_at is not null
                and died_at > now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS}))
              as outbox_dead_recent,
            (select count(*)::int from notification_outbox
              where status = 'sending') as outbox_claimed,
            (select count(*)::int from telegram_update_jobs
              where status in ('pending', 'claimed')) as telegram_jobs_depth,
            (select extract(epoch from now() - min(coalesce(next_attempt_at, created_at)))::float8
               from telegram_update_jobs
              where status = 'pending' and coalesce(next_attempt_at, created_at) <= now())
              as telegram_jobs_oldest_due_age_seconds,
            (select count(*)::int from telegram_update_jobs
              where status = 'dead' and completed_at is not null
                and completed_at > now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS}))
              as telegram_jobs_dead_recent,
            (select count(*)::int from telegram_update_jobs
              where status = 'claimed') as telegram_jobs_claimed,
            -- الاتصالاتُ (F8-02): من pg_stat_activity وهيَ رؤيةُ المحرِّكِ
            -- لا عدٌّ في العمليّةِ: عدٌّ في العمليّةِ يرى مجمعَ نفسِها وحدَه،
            -- والسقفُ مشترَكٌ بينَ النسخِ كلِّها والعاملينَ والهجراتِ.
            -- ولا وسمَ مستخدمٍ ولا تطبيقٍ ولا عنوانٍ: ثلاثُ حالاتٍ ورابعةٌ
            -- جامعةٌ، وما سوى ذلكَ يُنشئُ سلسلةً لكلِّ نسخةٍ تُنشَرُ.
            (select count(*)::int from pg_stat_activity
              where datname = current_database() and state = 'active') as connections_active,
            (select count(*)::int from pg_stat_activity
              where datname = current_database() and state = 'idle') as connections_idle,
            (select count(*)::int from pg_stat_activity
              where datname = current_database()
                and state in ('idle in transaction', 'idle in transaction (aborted)'))
              as connections_idle_in_transaction,
            (select count(*)::int from pg_stat_activity
              where datname = current_database()
                and (state is null
                  or state not in (
                    'active', 'idle',
                    'idle in transaction', 'idle in transaction (aborted)')))
              as connections_other,
            (select current_setting('max_connections')::int) as connections_limit,
            -- زمنُ الإسنادِ (F8-02): من الختمينِ المكتوبَينِ لا من مؤقِّتٍ
            -- في الذاكرةِ: الطلبُ يُنشَأُ في عمليّةٍ ويُسنَدُ في أخرى، ومؤقِّتٌ
            -- في الذاكرةِ يُفقَدُ بإعادةِ التشغيلِ ويكذبُ عندَ تعدُّدِ النسخِ.
            -- والشرطُ على ختمِ المطابقةِ لا على ختمِ الإنشاءِ: المقيسُ متى وقعَ
            -- الإسنادُ لا متى وردَ الطلبُ، وإلّا سقطَ من النافذةِ كلُّ طلبٍ
            -- بطيءِ الإسنادِ — وهوَ عينُ ما يُرادُ قياسُه.
            (select count(*)::int from orders where status = 'searching') as searching_orders,
            (select count(*)::int from driver_availability where is_available) as available_drivers,
            (select count(*)::int
               from subscriptions
              where status = 'expired'
                and updated_at >= date_trunc('day', now())
                and updated_at < date_trunc('day', now()) + interval '1 day')
              as expired_subscriptions_today,
            (select extract(epoch from max(created_at))::float8
               from db_backups
              where status = 'success') as last_successful_backup_timestamp_seconds,
            -- حِمْلُ الطوابيرِ الصامدةِ (F6-06): مجموعٌ على المدنِ كلِّها، فلا وسمَ
            -- مدينةٍ في المقياسِ. والتعريفاتُ حرفاً حرفاً كما في دالَّتَي الحِمْلِ
            -- notification_outbox_load وtelegram_update_jobs_load: عمقٌ = عملٌ لم
            -- يُنهَ (معلَّقٌ + محجوزٌ)، وعمرٌ = أقدمُ **مستحقٍّ** معلَّقٍ، وموتى في
            -- نافذةٍ. واختلافُ التعريفِ بينَ اللوحةِ وحكمِ القاعدةِ هوَ عينُ العطبِ
            -- الذي يُصلِحُه هذا البندُ: رقمانِ باسمٍ واحدٍ ومعنيَينِ.
            (select count(*)::int from notification_outbox
              where status in ('pending', 'sending')) as outbox_depth,
            (select extract(epoch from now() - min(next_attempt_at))::float8
               from notification_outbox
              where status = 'pending' and next_attempt_at <= now())
              as outbox_oldest_due_age_seconds,
            (select count(*)::int from notification_outbox
              where status = 'dead' and died_at is not null
                and died_at > now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS}))
              as outbox_dead_recent,
            (select count(*)::int from notification_outbox
              where status = 'sending') as outbox_claimed,
            (select count(*)::int from telegram_update_jobs
              where status in ('pending', 'claimed')) as telegram_jobs_depth,
            (select extract(epoch from now() - min(coalesce(next_attempt_at, created_at)))::float8
               from telegram_update_jobs
              where status = 'pending' and coalesce(next_attempt_at, created_at) <= now())
              as telegram_jobs_oldest_due_age_seconds,
            (select count(*)::int from telegram_update_jobs
              where status = 'dead' and completed_at is not null
                and completed_at > now() - make_interval(secs => ${QUEUE_DEAD_WINDOW_SECONDS}))
              as telegram_jobs_dead_recent,
            (select count(*)::int from telegram_update_jobs
              where status = 'claimed') as telegram_jobs_claimed,
            -- الاتصالاتُ (F8-02): من pg_stat_activity وهيَ رؤيةُ المحرِّكِ
            -- لا عدٌّ في العمليّةِ: عدٌّ في العمليّةِ يرى مجمعَ نفسِها وحدَه،
            -- والسقفُ مشترَكٌ بينَ النسخِ كلِّها والعاملينَ والهجراتِ.
            -- ولا وسمَ مستخدمٍ ولا تطبيقٍ ولا عنوانٍ: ثلاثُ حالاتٍ ورابعةٌ
            -- جامعةٌ، وما سوى ذلكَ يُنشئُ سلسلةً لكلِّ نسخةٍ تُنشَرُ.
            (select count(*)::int from pg_stat_activity
              where datname = current_database() and state = 'active') as connections_active,
            (select count(*)::int from pg_stat_activity
              where datname = current_database() and state = 'idle') as connections_idle,
            (select count(*)::int from pg_stat_activity
              where datname = current_database()
                and state in ('idle in transaction', 'idle in transaction (aborted)'))
              as connections_idle_in_transaction,
            (select count(*)::int from pg_stat_activity
              where datname = current_database()
                and (state is null
                  or state not in (
                    'active', 'idle',
                    'idle in transaction', 'idle in transaction (aborted)')))
              as connections_other,
            (select current_setting('max_connections')::int) as connections_limit,
            -- زمنُ الإسنادِ (F8-02): من الختمينِ المكتوبَينِ لا من مؤقِّتٍ
            -- في الذاكرةِ: الطلبُ يُنشَأُ في عمليّةٍ ويُسنَدُ في أخرى، ومؤقِّتٌ
            -- في الذاكرةِ يُفقَدُ بإعادةِ التشغيلِ ويكذبُ عندَ تعدُّدِ النسخِ.
            -- والشرطُ على ختمِ المطابقةِ لا ختمِ الإنشاءِ: المقيسُ متى وقعَ
            -- الإسنادُ لا متى وردَ الطلبُ، وإلّا سقطَ من النافذةِ كلُّ طلبٍ
            -- بطيءِ الإسنادِ — وهوَ عينُ ما يُرادُ قياسُه.
            (select count(*)::int from orders
              where matched_at is not null
                and matched_at >= now() - make_interval(secs => ${ASSIGNMENT_WINDOW_SECONDS}))
              as matched_in_window,
            (select percentile_cont(0.5) within group (
                order by extract(epoch from (matched_at - coalesce(searching_since, created_at))))::float8
               from orders
              where matched_at is not null
                and matched_at >= now() - make_interval(secs => ${ASSIGNMENT_WINDOW_SECONDS}))
              as assignment_p50_seconds,
            (select percentile_cont(0.9) within group (
                order by extract(epoch from (matched_at - coalesce(searching_since, created_at))))::float8
               from orders
              where matched_at is not null
                and matched_at >= now() - make_interval(secs => ${ASSIGNMENT_WINDOW_SECONDS}))
              as assignment_p90_seconds
        `;
      });
      const row = rows[0];
      const value: DatabaseGaugeValues = {
        searchingOrders: row?.searching_orders ?? 0,
        availableDrivers: row?.available_drivers ?? 0,
        expiredSubscriptionsToday: row?.expired_subscriptions_today ?? 0,
        lastSuccessfulBackupTimestampSeconds: row?.last_successful_backup_timestamp_seconds ?? 0,
        queues: [
          {
            queue: "notification_outbox",
            depth: row?.outbox_depth ?? 0,
            oldestDueAgeSeconds: row?.outbox_oldest_due_age_seconds ?? 0,
            deadInWindow: row?.outbox_dead_recent ?? 0,
            claimed: row?.outbox_claimed ?? 0,
          },
          {
            queue: "telegram_update_jobs",
            depth: row?.telegram_jobs_depth ?? 0,
            oldestDueAgeSeconds: row?.telegram_jobs_oldest_due_age_seconds ?? 0,
            deadInWindow: row?.telegram_jobs_dead_recent ?? 0,
            claimed: row?.telegram_jobs_claimed ?? 0,
          },
        ],
        connections: [
          { state: "active", count: row?.connections_active ?? 0 },
          { state: "idle", count: row?.connections_idle ?? 0 },
          { state: "idle_in_transaction", count: row?.connections_idle_in_transaction ?? 0 },
          { state: "other", count: row?.connections_other ?? 0 },
        ],
        maxConnections: row?.connections_limit ?? 0,
        assignment: {
          matchedInWindow: row?.matched_in_window ?? 0,
          // ولاَ إسنادَ في النافذةِ يُعيدُ `null` من `percentile_cont`، ويُنشَرُ
          // صفراً معَ `matchedInWindow = 0` الذي يقرأُ معَه فيُفهَمُ غياباً لا سرعةً.
          p50Seconds: row?.assignment_p50_seconds ?? 0,
          p90Seconds: row?.assignment_p90_seconds ?? 0,
          windowSeconds: ASSIGNMENT_WINDOW_SECONDS,
        },
      };
      metrics.observeCriticalDatabaseQuery("operational_gauges", now() - startedAt);
      metrics.setDatabaseGauges(value);
      cached = { atMs: now(), value };
      return ok(value);
    } catch (cause) {
      metrics.observeCriticalDatabaseQuery("operational_gauges", now() - startedAt);
      metrics.recordDatabaseGaugeCollectionFailure();
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err({ code: "DATABASE_GAUGE_COLLECTION_FAILED", detail });
    }
  }

  return {
    collect: async () => {
      const current = cached;
      if (current !== null && now() - current.atMs < cacheTtlMs) return ok(current.value);
      if (inFlight !== null) return inFlight;
      inFlight = query();
      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}
