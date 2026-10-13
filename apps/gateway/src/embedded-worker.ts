/**
 * الغرض: تشغيل مجدول المهامّ الدورية داخل عملية البوابة نفسها حين لا توجد خدمة عامل
 *   مستقلّة على منصّة النشر — بإعادة استخدام حاوية العامل ومشغّله بلا نسخ سطر منطق واحد.
 * الحالة: منفّذ فعلياً — إغلاق فجوة البند 0 القسم 0.2.
 * ينتمي إلى: apps/gateway
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/index.ts، tests/unit/embedded-worker.test.ts
 * ملاحظات مستقبلية: يوم تُنشأ خدمة `waslah-worker` يُضبط RUN_WORKER_IN_GATEWAY=false
 *   ويُحذف أثره كلّه بلا مسّ أي مهمّة — لا مهمّة واحدة معرّفة هنا.
 */

import { createJobHeartbeatReader } from "../../../packages/infrastructure/scheduling/job-heartbeat-adapters.ts";
import type { AppConfig } from "../../../packages/shared/config/index.ts";
import {
  buildWorkerContainer,
  MAX_JOB_CONCURRENCY,
  WORKER_SETTINGS_REMEMBER_MS,
  type WorkerContainerOverrides,
} from "../../workers/src/container.ts";
import {
  createJobRunner,
  HEARTBEAT_OK_REWRITE_MS,
  type JobLogger,
  lastRunMsFromHeartbeats,
} from "../../workers/src/runner.ts";

export interface EmbeddedWorkerHandle {
  /** عدد المهامّ التي سُجِّلت فعلاً — صفرٌ عرضٌ مشبوه يستحقّ سطر سجلّ. */
  readonly jobCount: number;
  /** إيقاف المشغّل وإغلاق تجمّعات الاتصال. */
  stop(): Promise<void>;
}

/**
 * يُقلع المجدول في نفس العملية ويُعيد مقبضاً لإيقافه.
 *
 * لماذا تُبنى حاوية عامل ثانية ولا يُعاد استخدام `container` البوابة؟ لأن العامل
 * يحتاج تجمّع اتصالات مستقلّاً للأقفال الاستشارية: القفل ملكُ الجلسة، فالمهمّة تحتجز
 * اتصالها طول عملها وهو خاملٌ لا يستعلم. لو أُخذ ذلك الاتصال من تجمّع البوابة لتنافس
 * الخاملُ المحتجزُ مع تحديثات تلغرام الحقيقية على نفس الميزانية، فيتحوّل مكسبُ توفير
 * الاتصالات إلى بطء في الحوار — وهو أسوأ ما يُقايَض به.
 *
 * `buildWorkerContainer` هو نفسه الذي تستدعيه `apps/workers/src/index.ts`. لا يوجد
 * هنا تعريف مهمّة ولا تواتر ولا عتبة: كل ذلك يبقى في موضع واحد.
 */
export async function startEmbeddedWorker(
  config: AppConfig,
  log: JobLogger,
  overrides: WorkerContainerOverrides = {},
): Promise<EmbeddedWorkerHandle> {
  const container = buildWorkerContainer(config, {
    settingsRememberMs: WORKER_SETTINGS_REMEMBER_MS,
    ...overrides,
    log,
  });
  const jobs = await container.jobs();

  if (jobs.length === 0) {
    log.error("embedded_worker.no_jobs", {
      hint: "لا مدينة مفعَّلة ولا مهامّ عامّة — راجع جدول cities",
    });
  }

  // `JOB-LAZY-01` — آخرُ شوطٍ لكلِّ مهمّةٍ من القاعدةِ لا من الذاكرةِ: الإقلاعُ لا يُصفِّرُ عدَّ
  // المهمّةِ اليوميّةِ. وفشلُ القراءةِ لا يُسقطُ العاملَ — تبدأُ المهامُّ الكسولةُ بعدَ مهلةِ الأوّلِ.
  let initialLastRunMs: Map<string, number> = new Map();
  try {
    initialLastRunMs = lastRunMsFromHeartbeats(
      await createJobHeartbeatReader(container.sql).list(),
    );
  } catch (cause) {
    log.error("runner.last_runs_unavailable", {
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
  const runner = createJobRunner({
    jobs,
    initialLastRunMs,
    lock: container.lock,
    maxConcurrency: MAX_JOB_CONCURRENCY,
    clock: { now: () => new Date() },
    log,
    // النبضة (§4.3): ولو كان العاملُ في العمليّة نفسها، فالمرجعُ القاعدة لا الذاكرة:
    // موضعٌ واحد لحقيقة واحدة يعمل في الحالتين بلا فرعٍ في الفحص، ومقبضٌ في الذاكرة
    // كان سيقول «المشغّل مقلع» لا «المهامّ تعمل» — وهما ليسا شيئاً واحداً.
    heartbeat: container.heartbeat,
    // `OPS-EGRESS-01`: نبضةُ `ok` المتكرّرةُ تُكتَبُ مرّةً في الدقيقةِ لا في كلِّ شوط.
    heartbeatOkRewriteMs: HEARTBEAT_OK_REWRITE_MS,
  });
  runner.start();
  log.info("embedded_worker.started", {
    jobCount: jobs.length,
    names: jobs.map((job) => job.name),
  });

  let stopped = false;
  return {
    jobCount: jobs.length,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      // إيقاف المشغّل قبل إغلاق القاعدة: شوطٌ جارٍ بلا اتصال يفشل بلا داعٍ.
      runner.stop();
      await container.close();
      log.info("embedded_worker.stopped", {});
    },
  };
}
