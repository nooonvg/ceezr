/**
 * `OPS-EGRESS-01` — تذكُّرُ نجاحِ فحصِ جاهزيّةٍ مدّةً قصيرة.
 *
 * `/ready` يُسأَلُ من ثلاثِ جهاتٍ: فحصُ Render الصحّيّ، ومراقبُ Supabase كلَّ دقيقة، ومُبقي
 * الاستيقاظِ كلَّ خمسِ دقائق — قرابةَ 5300 مرّةٍ يوميًّا مقيسةً من `pg_stat_statements`. وكلُّ
 * نداءٍ كانَ يسحبُ أسماءَ 216 دالّةً وجدولًا ونبضاتِ 130 مهمّة (~36 KB)، فيستهلكُ وحدَه قرابةَ
 * حصّةِ Supabase المجانيّةِ للبياناتِ الصادرة (5 GB/شهر).
 *
 * **النجاحُ وحدَه يُتذكَّر**: الفشلُ يُعادُ فحصُه في كلِّ نداء، فلا يُخفي التذكُّرُ عطلًا، ولا
 * يتأخّرُ التعافي. وأقصى ما يتأخّرُ هوَ رؤيةُ عطلٍ نشأَ بعدَ آخرِ نجاحٍ، بقدرِ `ttlMs`.
 * والنداءاتُ المتزامنةُ تشتركُ في فحصٍ واحدٍ جارٍ.
 */
import type { ProbeOutcome } from "./routes/health.ts";

export function rememberSuccess(
  check: () => Promise<ProbeOutcome>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<ProbeOutcome> {
  let okAt: number | null = null;
  let pending: Promise<ProbeOutcome> | null = null;
  return async () => {
    if (okAt !== null && now() - okAt < ttlMs) return { ok: true };
    pending ??= (async () => {
      try {
        const outcome = await check();
        okAt = outcome.ok ? now() : null;
        return outcome;
      } catch (error) {
        okAt = null;
        throw error;
      } finally {
        pending = null;
      }
    })();
    return pending;
  };
}

/** أسماءُ الدوالِّ والجداولِ لا تتغيّرُ إلّا بهجرة، والهجرةُ تسبقُ نشرًا يعيدُ الفحصَ عندَ الإقلاع. */
export const SCHEMA_CONTRACT_REMEMBER_MS = 10 * 60_000;

/** `PING` إلى Upstash يُحسَبُ أمرًا من حصّةِ الـ500K الشهريّة، وطلبَ HTTPS صادرًا من Render. */
export const REDIS_PING_REMEMBER_MS = 60_000;

/**
 * لقطةُ النبضاتِ في `/ready`. الحدُّ: أسوأُ عمرٍ لنبضةٍ في اللقطةِ = عمرُ اللقطة + مهلةُ
 * تخفيفِ الكتابة (`HEARTBEAT_OK_REWRITE_MS`) + فترةُ المهمّة، ويجبُ أن يبقى دونَ عتبةِ البيات
 * `max(2×الفترة، 180 ث)`. لفترةِ 60 ث: 30 + 60 + 60 = 150 < 180، ولـ120 ث: 210 < 240.
 */
export const JOB_HEALTH_SNAPSHOT_MS = 30_000;
