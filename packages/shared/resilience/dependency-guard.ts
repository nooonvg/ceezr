/**
 * الغرض: تركيبُ الحاجزِ والقاطعِ والمهلةِ في موضعٍ واحدٍ لكلِّ اعتماديّةٍ خارجيّةٍ
 *   (`CAP-006` · `F8-04`)، ومعَه **الميزانياتُ المُقرَّرةُ للاعتماديّاتِ الخمسِ**
 *   مصدرَ حقيقةٍ واحداً.
 * الحالة: منفّذ فعلياً — المرحلة `F8-04`.
 * ينتمي إلى: shared/resilience
 * يُتوقع أن يستخدمه: مصنعُ كلِّ اعتماديّةٍ (`createUpstashRedis` ·
 *   `createOsrmProvider` · مصنعُ الدفعِ · مصنعُ واجهةِ تلغرام)، ويُنفَذُ ذلكَ
 *   بحاجزِ `scripts/check-dependency-resilience.ts`.
 * ملاحظات مستقبلية: البديلُ (`fallback`) **ليسَ ههنا** — انظر «ما لا يُقالُ» أدناه.
 */

import { type Bulkhead, type BulkheadSnapshot, createBulkhead } from "./bulkhead.ts";
import {
  type BreakerConfig,
  type BreakerSnapshot,
  type CircuitBreaker,
  createCircuitBreaker,
} from "./circuit-breaker.ts";

/**
 * الاعتماديّاتُ الخمسُ التي يُسمّيها `CAP-006` بالنصِّ. **والقائمةُ مغلقةٌ**: من
 * أرادَ اعتماديّةً سادسةً أضافَها ههنا وأضافَ ميزانيتَها، ولا يُمرِّرُ نصّاً حرّاً
 * فيصيرَ لكلِّ موضعٍ اسمٌ يخصُّه ولا تُجمَعُ حالةُ اعتماديّةٍ واحدةٍ أبداً.
 */
export const DEPENDENCY_NAMES = ["telegram", "maps", "payment", "redis", "agent"] as const;

export type DependencyName = (typeof DEPENDENCY_NAMES)[number];

export interface GuardBudget extends BreakerConfig {
  /** الميزانيةُ الزمنيّةُ الكلّيّةُ للنداءِ الواحدِ بالميلي ثانية. */
  readonly timeoutMs: number;
  /** أقصى نداءٍ مُنطلِقٍ في وقتٍ واحدٍ لهذه الاعتماديّةِ في هذا المثيلِ. */
  readonly maxConcurrent: number;
}

/**
 * الميزانياتُ المُقرَّرةُ. **مُشتقّةٌ من المستهلِكِ لا من قدرةِ المُزوِّدِ**، وكلُّ
 * رقمٍ منها **غيرُ مُعايَرٍ على حملٍ حقيقيٍّ** — فهو قرارٌ مُعلَنٌ لا قياسٌ، ومعايرتُه
 * موضعُها مختبرُ الحملِ (`F10`).
 */
export const DEPENDENCY_BUDGETS: Readonly<Record<DependencyName, GuardBudget>> = {
  /**
   * تلغرام: الميزانيةُ **عشرُ ثوانٍ** لا خمسُمئةٍ — وخمسُمئةٍ هيَ ما كانَ قائماً
   * افتراضاً في grammY بلا أن يُقرَّرَ. والتزامنُ واسعٌ (٦٤) لأنَّ الصادرَ مُجمَّعٌ
   * في صندوقٍ ومُرسِلٍ واعٍ بالحدِّ (`CAP-002`)، فالضيقُ ههنا حدُّ تلغرام نفسِه
   * لا مسالكُنا. والحدُّ يمنعُ أن يحتجزَ عطلٌ في تلغرام كلَّ المثيلِ.
   */
  telegram: {
    timeoutMs: 10_000,
    maxConcurrent: 64,
    failureThreshold: 10,
    windowMs: 30_000,
    cooldownMs: 15_000,
    halfOpenProbes: 1,
  },
  /**
   * الخرائطُ: ثلاثُ ثوانٍ كما قرَّرَ `OSRM_TIMEOUT_MS`، والتزامنُ ضيّقٌ (١٦) لأنَّ
   * التوجيهَ **تحسينٌ فوقَ تقديرٍ متاحٍ أصلاً** (هافرساين)، فليسَ من الصوابِ أن
   * يحتجزَ مسالكَ أكثرَ ممّا يحتجزُه ما لا بديلَ له.
   */
  maps: {
    timeoutMs: 3_000,
    maxConcurrent: 16,
    failureThreshold: 5,
    windowMs: 20_000,
    cooldownMs: 10_000,
    halfOpenProbes: 1,
  },
  /**
   * الدفعُ: ثلاثونَ ثانيةً **لأنَّ المُحوِّلَ يُعيدُ ثلاثَ محاولاتٍ بمهلةِ عشرٍ
   * لكلٍّ** — وميزانيةٌ أضيقُ من مجموعِ محاولاتِه كانت ستقطعُه في منتصفِ عملِه.
   * والقاطعُ **متساهلٌ عن قصدٍ** (١٥ إخفاقاً في دقيقةٍ): قطعُ الدفعِ يمنعُ اشتراكاً
   * ويكلِّفُ مالاً، فلا يُفتَحُ إلاّ على عطلٍ واضحٍ. والتزامنُ ٨: الدفعُ نادرٌ
   * بطبيعتِه (اشتراكٌ شهريٌّ) وموجتُه لا تُقاسُ بموجةِ الرحلاتِ.
   */
  payment: {
    timeoutMs: 30_000,
    maxConcurrent: 8,
    failureThreshold: 15,
    windowMs: 60_000,
    cooldownMs: 20_000,
    halfOpenProbes: 1,
  },
  /**
   * Redis: ثانيتانِ كما قرَّرَ `REDIS_TIMEOUT_MS`. **والحدُّ أوسعُ ما ههنا (١٢٨)**
   * لأنَّ Redis في المسارِ الساخنِ لأكثرِ الطلباتِ، فحدٌّ ضيّقٌ عليه يصيرُ هوَ
   * عنقَ الزجاجةِ بدلَ أن يحميَ منه. والقاطعُ سريعٌ (٨ في عشرِ ثوانٍ): ارتدادٌ
   * فوريٌّ من Redis معطوبٍ أنفعُ من ألفِ نداءٍ ينتظرُ كلٌّ منها ثانيتَينِ.
   */
  redis: {
    timeoutMs: 2_000,
    // 2,048 (كانت 128) — قياسُ موجةِ الاستكمالِ 2026-10-17 (LOAD-01 Recovery):
    // 128 كانَ يملؤهُ انفجارُ مبادلاتِ الجلساتِ (250 متزامنًا = 175 رفضًا 503
    // «حاجزُ تزامنِ Redis ممتلئٌ»؛ 959/959 من فشلِ الموجاتِ بهذا السببِ وحدَهُ)،
    // والقيمةُ محسوبةٌ منَ الطلبِ لا مخمَّنة: كلُّ مبادلةِ جلسةٍ نداءانِ على
    // مسلكِ rateRedis نفسِهِ (حدُّ المعدَّلِ + حارسُ إعادةِ الاستعمالِ — كلاهما
    // على العميلِ المنفصلِ rateRedis لا مسلكِ الحاويةِ)، فذروةُ 1,000 متزامنٍ —
    // هدفُ السعةِ المعلنِ — تحتاجُ ~2,000 مسلكٍ في اللحظةِ نفسِها (الخامُّ:
    // 128 يرفضُ 1,872 منَ 2,000 والقيمةُ الجديدةُ صفرُ رفضٍ —
    // LANE-BURST-RAW.json). والتبعيةُ نفسُها قيستْ تتحملُ 1,024 نداءً
    // متزامنًا بـp99=21ms
    // (مسبارُ shim-latency-probe)، فالحاجزُ هوَ الذي كانَ دونَ التبعيةِ ودونَ
    // الطلبِ معًا. الحمايةُ منَ التبعيةِ البطيئةِ قائمةٌ لا يمسُّها هذا: المهلةُ
    // ثانيتانِ وقاطعُ الدائرةِ 8/10ث — الحاجزُ يحدُّ الطلبَ اللحظيَّ لا يعالجُ
    // البطءَ. (اختبارُ الانحدارِ: tests/real-redis/session-burst-real.test.ts —
    // يفشلُ بالقيمةِ القديمةِ ويمرُّ بهذه.)
    maxConcurrent: 2_048,
    failureThreshold: 8,
    windowMs: 10_000,
    cooldownMs: 5_000,
    halfOpenProbes: 1,
  },
  /**
   * الوكيلُ (`packages/agent-core` · `ADR 0012`): استشاريٌّ محدودٌ، **ولا مُحوِّلَ
   * شبكيٌّ له اليومَ** — المُنفَّذُ `nullModel` يردُّ «غيرُ متاحٍ» بلا خروجٍ. فهذه
   * الميزانيةُ **مُقرَّرةٌ سابقاً لموضعٍ لم يُوصَلْ بعدُ**، والحاجزُ يُلزِمُ أوّلَ
   * مُحوِّلٍ حقيقيٍّ بأن يمرَّ بها. وهيَ الأضيقُ: ما كانَ استشاريّاً لا يحتجزُ.
   */
  agent: {
    timeoutMs: 5_000,
    maxConcurrent: 4,
    failureThreshold: 3,
    windowMs: 30_000,
    cooldownMs: 30_000,
    halfOpenProbes: 1,
  },
};

/**
 * سببُ الرَّدِّ. **مُسمّىً لا `boolean`**: من ردَّ بـ«أخفقَ» سوّى بينَ ثلاثةِ
 * أحوالٍ علاجُها مختلفٌ — `open` يعني اعتماديّةً مقطوعةً فانتظرْ، و`saturated`
 * يعني ضيقاً عندَنا فوسِّعْ أو خفِّفْ، و`timeout` يعني بطئاً فراجعْ الميزانيةَ.
 */
export type GuardRejectionReason = "open" | "saturated" | "timeout";

export interface GuardRejection {
  readonly dependency: DependencyName;
  readonly reason: GuardRejectionReason;
  /** ما يُنصَحُ بالانتظارِ قبلَ المحاولةِ. `null` إن لم يكنْ معلوماً. */
  readonly retryAfterMs: number | null;
}

export type GuardOutcome<T> =
  | { readonly admitted: true; readonly value: T }
  | { readonly admitted: false; readonly rejection: GuardRejection };

export interface GuardSnapshot {
  readonly dependency: DependencyName;
  readonly breaker: BreakerSnapshot;
  readonly bulkhead: BulkheadSnapshot;
}

/**
 * تصنيفُ القيمةِ المُعادةِ إخفاقاً للاعتماديّةِ (`Result` الراجعُ بخطأٍ مثلاً).
 *
 * **وبِغَيرِه يكونُ القاطعُ أعمى في كلِّ محوّلٍ يُعيدُ `Result` بدلَ أن يرمي**:
 * خادمٌ يردُّ `503` مئةَ مرّةٍ كانَ سيُعَدُّ مئةَ نجاحٍ فلا يُفتَحُ القاطعُ أبداً.
 * والقيمةُ **تُعادُ كما هيَ** (`admitted: true`) لأنّها جوابٌ وصلَ من الاعتماديّةِ
 * فعلاً، وإنّما يُسجَّلُ الإخفاقُ عندَ القاطعِ وحدَه.
 */
export interface GuardRunOptions<T> {
  readonly failed?: (value: T) => boolean;
}

export interface DependencyGuard {
  /**
   * يُشغِّلُ العمليّةَ داخلَ الحاجزِ والقاطعِ والمهلةِ.
   *
   * **والإشارةُ مُمرَّرةٌ لتُطاعَ**: من تجاوزَ الميزانيةَ يُبلَّغُ بها المُشغَّلُ
   * ليُلغيَ نداءَه فعلاً. ومن لم يُطِعْها **يستقرُّ متأخّراً**، والمُنتَظِرُ ههنا لا
   * يُحجَبُ عنه الردُّ — لكنَّ **مَسلَكَ الحاجزِ يبقى محجوزاً حتّى يستقرَّ النداءُ
   * فعلاً**، لا حتّى تنقضيَ المهلةُ. وتحريرُه عندَ المهلةِ كانَ سيجعلُ الحدَّ
   * كذباً: مئةُ نداءٍ عالقٍ وحاجزٌ يقولُ «لا شيءَ مُنطلِقٌ».
   *
   * ورَميُ العمليّةِ **يُنقَلُ كما هوَ** ويُعَدُّ إخفاقاً عندَ القاطعِ: من حوَّلَ
   * الرمياتِ إلى `admitted: false` أخفى صنفَ الخطأِ عن المُحوِّلِ الذي يُصنِّفُه.
   */
  run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options?: GuardRunOptions<T>,
  ): Promise<GuardOutcome<T>>;
  snapshot(): GuardSnapshot;
}

export interface DependencyGuardOptions {
  readonly dependency: DependencyName;
  /** تجاوزُ الميزانيةِ المُقرَّرةِ — للاختبارِ ولضبطٍ بيئيٍّ، لا للتخفُّفِ. */
  readonly budget?: GuardBudget;
  /** ساعةٌ مُمرَّرةٌ (اختبارٌ). */
  readonly now?: () => number;
  /**
   * مُؤقِّتٌ مُمرَّرٌ (اختبارٌ). يعيدُ وعداً يُحَلُّ بعدَ `ms`، ومعَه `cancel`
   * لأنَّ مُؤقِّتاً لا يُلغى يُبقي المسارَ حيّاً بعدَ استقرارِ النداءِ.
   */
  readonly delay?: (ms: number) => { readonly promise: Promise<void>; cancel(): void };
}

function realDelay(ms: number): { readonly promise: Promise<void>; cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel(): void {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
}

export function createDependencyGuard(options: DependencyGuardOptions): DependencyGuard {
  const budget = options.budget ?? DEPENDENCY_BUDGETS[options.dependency];
  const now = options.now ?? (() => Date.now());
  const delay = options.delay ?? realDelay;
  const breaker: CircuitBreaker = createCircuitBreaker(budget, now);
  const bulkhead: Bulkhead = createBulkhead({ maxConcurrent: budget.maxConcurrent });
  const dependency = options.dependency;

  return {
    async run<T>(
      operation: (signal: AbortSignal) => Promise<T>,
      runOptions?: GuardRunOptions<T>,
    ): Promise<GuardOutcome<T>> {
      // الترتيبُ: القاطعُ **قبلَ** الحاجزِ. من حجزَ مَسلَكاً ثمَّ سألَ القاطعَ
      // أنفقَ سعةً على نداءٍ يعلمُ أنّه مردودٌ.
      if (!breaker.tryAcquire()) {
        const openedUntil = breaker.snapshot().openedUntil;
        return {
          admitted: false,
          rejection: {
            dependency,
            reason: "open",
            retryAfterMs:
              openedUntil === null ? budget.cooldownMs : Math.max(0, openedUntil - now()),
          },
        };
      }

      const permit = bulkhead.tryAcquire();
      if (permit === null) {
        // امتلاءُ المَسلَكِ **ليسَ إخفاقاً للاعتماديّةِ**: هيَ لم تُسأَلْ. وعَدُّه
        // إخفاقاً كانَ سيفتحُ القاطعَ على ضيقٍ عندَنا فيُضاعِفُ المنعَ.
        breaker.recordSuccess();
        return {
          admitted: false,
          rejection: { dependency, reason: "saturated", retryAfterMs: null },
        };
      }

      const controller = new AbortController();
      const timer = delay(budget.timeoutMs);
      const started = operation(controller.signal);

      // **الإفراجُ مُعلَّقٌ على استقرارِ النداءِ نفسِه** لا على من فازَ بالمُسابقةِ.
      // وهوَ أيضاً ما يمنعُ رفضاً غيرَ مُعالَجٍ إذا رمى النداءُ بعدَ المهلةِ.
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        permit.release();
      };
      started.then(release, release);

      const TIMED_OUT: unique symbol = Symbol("timeout");
      try {
        const raced = await Promise.race<T | typeof TIMED_OUT>([
          started,
          timer.promise.then(() => TIMED_OUT),
        ]);

        if (raced === TIMED_OUT) {
          controller.abort();
          breaker.recordFailure();
          return {
            admitted: false,
            rejection: { dependency, reason: "timeout", retryAfterMs: null },
          };
        }
        if (runOptions?.failed?.(raced) === true) breaker.recordFailure();
        else breaker.recordSuccess();
        return { admitted: true, value: raced };
      } catch (error) {
        breaker.recordFailure();
        throw error;
      } finally {
        timer.cancel();
      }
    },

    snapshot(): GuardSnapshot {
      return { dependency, breaker: breaker.snapshot(), bulkhead: bulkhead.snapshot() };
    },
  };
}
