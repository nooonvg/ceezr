/**
 * الغرض: نقطة دخول العامل الخلفي على Render: يبني الحاوية، يجمع الجوبات، يشغّل
 *   المشغّل الدوري، ويُغلق كل شيء بنظافة عند SIGTERM.
 * الحالة: منفّذ فعلياً — المرحلة 2.6 الخطوة 02.
 * ينتمي إلى: apps/workers
 * يُتوقع أن يستخدمه لاحقاً: docker/Dockerfile.worker كأمر تشغيل الخدمة
 * ملاحظات مستقبلية: القفل الموزَّع يأتي من الحاوية، فتشغيل عدّة نسخ آمن بلا تعديل هنا.
 */

import {
  createConfiguredMetricsExporter,
  createOperationalMetrics,
  createStructuredLogger,
} from "../../../packages/infrastructure/observability/index.ts";
import { createJobHeartbeatReader } from "../../../packages/infrastructure/scheduling/job-heartbeat-adapters.ts";
import { tryLoadConfig } from "../../../packages/shared/config/index.ts";
import {
  buildWorkerContainer,
  MAX_JOB_CONCURRENCY,
  WORKER_SETTINGS_REMEMBER_MS,
} from "./container.ts";
import {
  createJobRunner,
  HEARTBEAT_OK_REWRITE_MS,
  type JobLogger,
  lastRunMsFromHeartbeats,
} from "./runner.ts";

/**
 * سجلُّ العاملِ — من المُصدِرِ الوحيدِ (`F8-03` · ADR 0078). وقبلَ اليومَ كانَ
 * هذا الموضعُ يكتبُ `{level, message}` **بلا طابعِ زمنٍ ألبتَّةَ**، فلم يكنِ الترتيبُ
 * الزمنيُّ لأسطرِ العاملِ ممكناً ولا مقارنتُها بأسطرِ البوابةِ.
 */
const structuredLog = createStructuredLogger({ service: "worker" });
const log: JobLogger = { info: structuredLog.info, error: structuredLog.error };

async function main(): Promise<void> {
  const config = tryLoadConfig(process.env);
  if (!config.ok) {
    // إقلاعٌ بإعداد ناقص أخطر من عدم الإقلاع: عاملٌ يعمل بنصف إعداد يُفسد بيانات
    // بصمت، وعاملٌ لا يعمل يظهر فوراً في Render.
    log.error("worker.config_invalid", { detail: String(config.error) });
    process.exit(1);
  }

  /**
   * مسجِّلُ مقاييسِ العامل — `F5-07` / `SCL-006`.
   *
   * ولماذا في العاملِ أصلاً: لأنّ `apps/workers` عمليّةٌ منفصلةٌ **بلا خادمِ HTTP**،
   * فلا `GET /metrics` فيها أصلاً ولا موضعَ يُكشَط منه. وهذا بالضبط ما يجعل الدفعَ
   * الطريقَ الوحيدَ لقياسِها، وهو شرطٌ سابقٌ لـ`F5-04` (فصلُ العاملِ عن البوابة): فصلٌ
   * بلا تجميعٍ مركزيٍّ يعني عاملاً حيّاً لا يراه أحد.
   *
   * ويُمرَّر إلى `buildWorkerContainer` عبر `overrides.metrics` الذي تقبله الحاويةُ
   * أصلاً منذ اليوم الأول، فتُقاس محوّلاتُ العروضِ في العاملِ كما تُقاس في البوابة.
   * وقبلَ اليوم كان هذا الحقلُ يُترَك فارغاً في نقطةِ التشغيل، فتعمل الحاويةُ بمحوّلاتٍ
   * غيرِ مُقاسة — أي عاملٌ يعمل ولا يُنتج رقماً واحداً.
   */
  const workerMetrics = createOperationalMetrics();
  const metricsExporter = createConfiguredMetricsExporter({
    registry: workerMetrics.registry,
    serviceName: "waslah-worker",
    deploymentEnvironment: config.value.env,
    processTopology: config.value.processTopology,
    metricsExport: config.value.metricsExport,
    log: log.info,
  });
  if (metricsExporter === null) {
    log.info("metrics_export.disabled", { reason: "METRICS_EXPORT_ENDPOINT غير مضبوط" });
  } else {
    metricsExporter.start();
  }

  const container = buildWorkerContainer(config.value, {
    metrics: workerMetrics,
    settingsRememberMs: WORKER_SETTINGS_REMEMBER_MS,
  });
  const jobs = await container.jobs();

  if (jobs.length === 0) {
    log.error("worker.no_jobs", { hint: "لا مدينة مفعَّلة ولا مهامّ عامّة — راجع جدول cities" });
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
    // النبضة (§4.3): هذه الخدمة منفصلة عن البوابة، ولا طريقةَ للبوابة لتعلم أنّ
    // مهامّها تعمل إلاّ من القاعدة. بلا هذا السطر يقول `/ready` إنّ المهامّ غائبة.
    heartbeat: container.heartbeat,
    // `OPS-EGRESS-01`: نبضةُ `ok` المتكرّرةُ تُكتَبُ مرّةً في الدقيقةِ لا في كلِّ شوط.
    heartbeatOkRewriteMs: HEARTBEAT_OK_REWRITE_MS,
  });
  runner.start();
  log.info("worker.started", { jobCount: jobs.length });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("worker.shutdown", { signal });
    runner.stop();
    // إغلاق القاعدة بعد إيقاف المشغّل لا قبله: شوطٌ جاري بلا اتصال يفشل بلا داعٍ.
    // و`stop` وحده لا يكفي: يمسح المؤقّت ولا ينتظر الجاري، فالتصريف هو ما يجعل
    // الترتيب أعلاه وعداً محقّقاً لا تعليقاً. والمهلة محدودة لأنّ المنصّة تقتل قسراً.
    const drained = await runner.drain();
    if (!drained) log.error("worker.shutdown_not_drained", { signal });
    // دفعةٌ أخيرةٌ بعدَ التصريفِ وقبلَ إغلاقِ القاعدة: تحمل نتيجةَ آخرِ شوطٍ
    // انتهى توّاً. وبدونها يموت العاملُ حاملاً عدّادَ مهمّاتِه إلى القبر.
    if (metricsExporter !== null) await metricsExporter.stop();
    await container.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// يُشغَّل فقط عند التنفيذ المباشر، فتستورده الاختبارات بلا أن تُقلع عاملاً حقيقياً.
if (import.meta.main) {
  await main();
}

export { main };
