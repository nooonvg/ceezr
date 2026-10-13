/**
 * الغرض: منفذا نبضةِ المهامّ على القاعدة الحقيقية — الكتابة عبر
 *   `record_job_heartbeat`، والقراءة من `job_heartbeats` مباشرةً.
 * الحالة: منفّذ فعلياً — أُضيف في 2026-08-14 (§4.3 من أمر الإطلاق التجاري).
 * ينتمي إلى: infrastructure/scheduling
 * يُستخدم في: apps/workers/src/container.ts، apps/gateway/src/index.ts
 * الجدول والدالّة: supabase/migrations/20260814130000_job_heartbeats.sql
 */

import type {
  JobHeartbeatReaderPort,
  JobHeartbeatRecord,
  JobHeartbeatRecorderPort,
  JobHeartbeatRow,
  JobHeartbeatStatus,
} from "../../application/scheduling/job-heartbeat.ts";
import type { CityId } from "../../shared/kernel/index.ts";
import type { Sql } from "../db/client.ts";

export interface HeartbeatLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * كاتبُ النبضة. **يبتلع كلَّ خطأ عن قصد** ويسجّله مرّةً واحدة بسطرٍ مفهوم:
 * قاعدةٌ متعطّلة لحظةَ النبضة كانت ستُحوّل شوطاً ناجحاً إلى استثناءٍ يُلوَّن فشلاً
 * في السجلّ ويُعاد تشغيله بلا داعٍ. والرصدُ لا يجوز أن يكون سبب العطل الذي يرصده.
 */
export function createJobHeartbeatRecorder(
  sql: Sql,
  log?: HeartbeatLogger,
): JobHeartbeatRecorderPort {
  return {
    record: async (input: JobHeartbeatRecord): Promise<void> => {
      try {
        await sql`
          select record_job_heartbeat(
            ${input.jobName}::text,
            ${input.cityId}::uuid,
            ${input.status}::text,
            ${input.detail}::text
          ) as result
        `;
      } catch (cause) {
        log?.error("job_heartbeat.write_failed", {
          job: input.jobName,
          detail: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  };
}

function toStatus(value: unknown): JobHeartbeatStatus {
  return value === "failed" || value === "skipped" ? value : "ok";
}

export function createJobHeartbeatReader(sql: Sql): JobHeartbeatReaderPort {
  return {
    /**
     * `OPS-EGRESS-01`: تفصيلُ الشوطِ السليمِ لا يقرؤه حكمُ الصحّةِ ولا بذرةُ الإقلاع، وكانَ
     * أكثرَ بايتاتِ اللقطةِ في كلِّ `/ready`، فيُسحَبُ تفصيلُ الفاشلِ والمتخطّى وحدَه. والتعليقُ
     * خارجَ نصِّ الاستعلامِ عمدًا: ما في النصِّ يُرسَلُ إلى القاعدةِ مع كلِّ نداء.
     */
    list: async (): Promise<readonly JobHeartbeatRow[]> => {
      const rows = await sql<
        {
          job_name: string;
          city_id: string;
          last_run_at: Date;
          last_status: string;
          detail: string | null;
        }[]
      >`
        select job_name, city_id, last_run_at, last_status,
               case when last_status = 'ok' then null else detail end as detail
        from job_heartbeats
      `;
      return rows.map((row) => ({
        jobName: row.job_name,
        cityId: row.city_id as CityId,
        lastRunAt: row.last_run_at instanceof Date ? row.last_run_at : new Date(row.last_run_at),
        lastStatus: toStatus(row.last_status),
        detail: row.detail,
      }));
    },
  };
}
