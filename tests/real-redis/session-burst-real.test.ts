/**
 * الغرض: اختبارُ انحدارِ جدارِ الجلسةِ المقيسِ في موجةِ الاستكمالِ (LOAD-01
 *   Recovery · 2026-10-17): حاجزُ تزامنِ Redis كانَ 128 فكانَ انفجارُ مبادلاتِ
 *   الجلساتِ المتزامنةِ يملؤهُ فيُرفضُ الفائضُ فورًا («saturated») ويرجعُ
 *   الحارسُ الإغلاقيُّ 503 — 250 متزامنًا رُفضَ 175 منها في القياسِ المعزولِ.
 *   هذا الاختبارُ يُثبِتُ أنَّ المسلكَ بعدَ التصحيحِ يحملُ ذروةَ الطلبَ
 *   المحسوبةَ (2×1,000 متزامنٍ) بلا رفضِ امتلاءٍ، وأنَّ أمانَ الحارسِ لا
 *   يُمسُّ: بصمةٌ واحدةٌ لا تُستهلكُ مرتينِ مهما بلغَ التزامنُ، والتبعيةُ
 *   المعطوبةُ تُغلقُ لا تفتحُ.
 * الحالة: اختبارٌ حقيقيٌّ — يتطلّبُ `UPSTASH_REDIS_REST_URL` و
 *   `UPSTASH_REDIS_REST_TOKEN` (وظيفةُ «تكامل على Redis حقيقي» في CI).
 * ينتمي إلى: tests/real-redis
 * يُتوقع أن يستخدمه لاحقاً: موجاتُ القبولِ — إن رُفضت المبادلاتُ هنا فلا
 *   تُشغَّلِ الموجاتُ أصلًا؛ هذا هوَ حاجزُ ما قبلَ البوابةِ.
 * ملاحظة: القيمةُ القديمةُ (128) تُسقِطُ هذا الاختبارَ — أُثبتَ بالفشلِ قبلَ
 *   الرفعِ والنجاحِ بعدَهُ (كلا الاتجاهينِ محفوظانِ في أدلةِ الجولةِ).
 */

import { describe, expect, it } from "bun:test";
import { createRedisInitDataReplayGuard } from "../../packages/infrastructure/identity/redis-init-data-replay-guard.ts";
import { createUpstashRedis } from "../../packages/infrastructure/redis/upstash.ts";
import { DEPENDENCY_BUDGETS } from "../../packages/shared/resilience/dependency-guard.ts";

const ENABLED =
  process.env.UPSTASH_REDIS_REST_URL !== undefined &&
  process.env.UPSTASH_REDIS_REST_TOKEN !== undefined;
const describeIf = ENABLED ? describe : describe.skip;

/** ذروةُ الطلبِ المحسوبةُ: 1,000 متزامنٍ × نداءانِ على الأقلِّ لكلِّ مبادلةٍ. */
const BURST = 2_000;

function makeClient() {
  return createUpstashRedis({
    url: process.env.UPSTASH_REDIS_REST_URL as string,
    token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
  });
}

describeIf("جدارُ الجلسةِ — حاجزُ تزامنِ Redis تحتَ الانفجارِ", () => {
  it("المسلكُ يحملُ ذروةَ الطلبِ المحسوبةَ بلا رفضِ امتلاءٍ", async () => {
    // درسُ الجولةِ الأولى: خادمُ CI واحدٌ يُشارَكُ بينَ اختباراتِ الملفِّ كلِّها،
    // فمفاتيحُ الانفجارِ (2,000) لو تُرِكَت حتى انتهاءِ مهلتِها لملأتْ دُفعةَ
    // SCAN في اختبارِ الجلساتِ القائمِ فأفلتتِ المفاتيحُ المطلوبةَ منَ الصفحةِ
    // الأولى — فالتُنظَّفْ هنا في نهايةِ كلِّ اختبارٍ لا بعدها.
    // القيمةُ المعلنةُ في الميزانيةِ تكفي الذروةَ — وإلا كانَ هذا الاختبارُ
    // إنذارَ ارتدادٍ لا استرحامًا: من خفّضها دونَ حسابٍ يكسرُ الموجاتِ هنا.
    expect(DEPENDENCY_BUDGETS.redis.maxConcurrent).toBeGreaterThanOrEqual(BURST);

    const redis = makeClient();
    const burstTag = Date.now();
    const started = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: BURST }, (_, i) =>
        redis.command(["SET", `load01-burst-probe:${burstTag}:${i}`, "1", "NX", "EX", "30"]),
      ),
    );
    const saturated = outcomes.filter((o) => !o.ok && o.error.kind === "saturated");
    const failures = outcomes.filter((o) => !o.ok && o.error.kind !== "saturated");
    const wallMs = Date.now() - started;
    // لا رفضَ امتلاءٍ إطلاقًا: كلُّ نداءٍ دخلَ المسلكَ — هذا عينُ الجدارِ
    // المقيسِ (175/250 رفضًا بالقيمةِ القديمةِ) وقد زالَ.
    expect(saturated).toHaveLength(0);
    // ولا فشلَ آخرَ (شبكة/مهلة/قاطع) — التبعيةُ نفسُها بريئةٌ كما قيستْ.
    expect(failures).toHaveLength(0);
    // وللصرفِ في الحسابِ: الدفعةُ كلُّها عبرت في ثوانٍ لا دقائقَ.
    expect(wallMs).toBeLessThan(10_000);
    // التنظيفُ بعدَ الانفجارِ: الخادمُ مشتركٌ بينَ اختباراتِ الملفِّ، ومفاتيحُ
    // الاختبارِ لا تُخلَّفْ لمن بعده (UNLINK دفعاتٍ من مئةٍ).
    const keys = outcomes.map((_, i) => `load01-burst-probe:${burstTag}:${i}`);
    for (let start = 0; start < keys.length; start += 100) {
      await redis.command(["UNLINK", ...keys.slice(start, start + 100)]);
    }
  });

  it("بصمةٌ واحدةٌ لا تُستهلكُ مرتينِ مهما بلغَ التزامنُ (أمانُ الحارسِ لا يمسُّه الرفعُ)", async () => {
    const redis = makeClient();
    const guard = createRedisInitDataReplayGuard(redis);
    const raw = `load01-replay-guard-proof:${Date.now()}`;
    const attempts = await Promise.all(Array.from({ length: 64 }, () => guard.consume(raw, 60)));
    const consumed = attempts.filter((a) => a.ok);
    const replayed = attempts.filter((a) => !a.ok && a.error.kind === "REPLAYED");
    const unavailable = attempts.filter((a) => !a.ok && a.error.kind === "STORE_UNAVAILABLE");
    // الفائزُ واحدٌ بالضبطِ — ذرّيّةُ `SET NX` فوقَ أيِّ تزامنٍ.
    expect(consumed).toHaveLength(1);
    // والباقي كلهُ رفضُ إعادةِ استعمالٍ صريحٌ لا عطلٌ.
    expect(replayed).toHaveLength(63);
    expect(unavailable).toHaveLength(0);
    // **التعافي لا يعيدُ فتحَ البابِ:** البصمةُ المستهلَكةُ تبقى مستهلَكةً
    // (لا انفصامَ بعدَ أيِّ عطلٍ لاحقٍ في المُصدرِ)، والبصماتُ الجديدةُ
    // تعملُ (تعافٍ لا حجرٌ).
    const fresh = await guard.consume(`${raw}:fresh`, 60);
    expect(fresh.ok).toBe(true);
    const again = await guard.consume(raw, 60);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe("REPLAYED");
  });

  it("التبعيةُ المعطوبةُ تُغلقُ لا تفتحُ — لا جلسةَ عبرَ حارسٍ معجزٍ", async () => {
    // عنوانٌ لا يستجيبُ: الرفضُ «إغلاقٌ» (STORE_UNAVAILABLE) لا نجاحٌ كاذبٌ،
    // ولو خُفِّض الحاجزُ أو رُفعَ فهذا الأمانُ فوقَ أيِّ ميزانيةٍ.
    const redis = createUpstashRedis({
      url: "http://127.0.0.1:1",
      token: "not-a-token",
      // مهلةٌ قصيرةٌ كي لا ينتظرَ الاختبارُ ميزانيةَ الإنتاجِ كاملةً.
      timeoutMs: 250,
    });
    const guard = createRedisInitDataReplayGuard(redis);
    const outcome = await guard.consume("load01-dead-store-proof", 60);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe("STORE_UNAVAILABLE");
    }
  });
});
