/**
 * الغرض: غلافُ صمودٍ للمُرسِلِ الصادرِ إلى تيليجرام (`CAP-002`/`F6-04`). المُرسِلُ
 *   الخامُ في `telegram-api-sender.ts` كانَ نداءً مباشراً بلا مهلةٍ ولا إعادةِ
 *   محاولةٍ ولا حدٍّ عالميٍّ، و`retry_after` مُتجاهَلٌ — فكلُّ نداءٍ إمّا نجحَ وإمّا
 *   رمى، والمحوّلاتُ تبتلعُ الرمي إلى `false`/`null` بلا أثرٍ يوقظُ أحداً.
 *   وههنا يُضافُ فوقَه — بلا تغييرِ سطرٍ فيه — خمسةٌ: دلوٌ مشتركٌ، ومهلةٌ لكلِّ
 *   نداءٍ، واحترامُ `retry_after`، وتراجعٌ أسّيٌّ بـjitter، وطابورُ موتى (DLQ)
 *   بتصنيفِ الرسالةِ حرجةً أو غيرَ حرجةٍ.
 * الحالة: منفّذٌ فعلياً — `CAP-002`/`F6-04`.
 * ينتمي إلى: infrastructure/notification
 * يُستخدم من: apps/gateway/src/container.ts، apps/workers/src/container.ts
 * ملاحظات مستقبلية: الغلافُ لا يعرفُ grammY: يقرأُ شكلَ الخطأِ لا صنفَه، فيُثبَّتُ
 *   كاملاً بمزدوجٍ في الاختبارِ، ويصمدُ لو بدَّلَ grammY أصنافَه.
 */

import { createHash } from "node:crypto";
import { bucketClassOfSendPriority } from "../../shared/config/traffic-priority.ts";
import type { OutboundRateBucket } from "./outbound-rate-bucket.ts";
import {
  interactiveOf,
  type SendOptions,
  type SendPriority,
  type TelegramSender,
} from "./telegram-api-sender.ts";

/** عمليّاتُ الصادرِ الثلاثُ — تُسجَّلُ في طابورِ الموتى كي يُعرَفَ ما ضاعَ. */
export type OutboundOperation = "sendMessage" | "sendPhoto" | "sendLocation";

/**
 * تصنيفُ الفشلِ. **الفارقُ بينَ الثلاثةِ قرارٌ لا وصفٌ**: العابرُ يُعادُ بتراجعٍ،
 * والمخنوقُ يُنتظَرُ بمقدارِ ما طلبَ تيليجرام نفسُه، والدائمُ **لا يُعادُ أبداً** —
 * فمن أعادَ إرسالَ رسالةٍ إلى مستخدمٍ حظرَ البوتَ أنفقَ حصّةَ الحدِّ العالميِّ على
 * فشلٍ مضمونٍ، وحرمَ منها رسالةً كانت ستصلُ.
 */
export type OutboundFailureClass = "transient" | "throttled" | "permanent" | "congestion";

export interface OutboundDeadLetter {
  readonly chatId: string;
  readonly operation: OutboundOperation;
  readonly priority: SendPriority;
  readonly failure: OutboundFailureClass;
  readonly attempts: number;
  readonly reason: string;
  readonly atIso: string;
}

export interface OutboundDeadLetterSink {
  /** **لا يرمي أبداً**: من رمى في طابورِ الموتى أضاعَ الخبرَ والرسالةَ معاً. */
  record(letter: OutboundDeadLetter): Promise<void>;
}

/**
 * ازدحامُ دلائِنا (لا خطأُ تيليجرام): الفتحةُ لم تُتَح في مهلةِ المسارِ القصيرةِ.
 * `D8` (CAP-RUN-20261016-CONTINUATION): يُرمى **فوراً** — لا انتظارَ داخلَ المسارِ
 * ولا إعادةً داخلَ المُرسِلِ — فالمسارُ يتفرّغُ لصفٍّ آخرَ لمحادثةٍ باردةٍ، والصفُّ
 * يعودُ إلى الطابورِ بموعدِ الفتحةِ القادمِ دون أن يُحسَبَ لهذه الدورةِ محاولةٌ
 * (الازدحامُ ضغطٌ عابرٌ لا فشلُ إرسالٍ). `retryAfterMs` = تقديرُ فتحةِ الدلوِ.
 */
export class OutboundCongestionError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`ازدحامُ دلاءِ الإرسالِ — الفتحةُ القادمةُ بعدَ ${retryAfterMs} مللي ثانية`);
    this.name = "OutboundCongestionError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * خطأُ صادرٍ مُصنَّفٌ. يُرمى بعدَ استنفادِ المحاولاتِ أو عندَ الفشلِ الدائمِ، فيبقى
 * عقدُ `TelegramSender` كما هو (يرمي عندَ الفشلِ) ولا يُمَسُّ أيُّ مُنادٍ — ومن أرادَ
 * التصرّفَ بالتصنيفِ وجدَه في الحقلِ لا في نصِّ الرسالةِ.
 */
export class OutboundSendError extends Error {
  readonly failure: OutboundFailureClass;
  readonly attempts: number;
  readonly operation: OutboundOperation;
  readonly chatId: string;

  constructor(input: {
    message: string;
    failure: OutboundFailureClass;
    attempts: number;
    operation: OutboundOperation;
    chatId: string;
  }) {
    super(input.message);
    this.name = "OutboundSendError";
    this.failure = input.failure;
    this.attempts = input.attempts;
    this.operation = input.operation;
    this.chatId = input.chatId;
  }
}

export interface OutboundResilienceOptions {
  readonly bucket: OutboundRateBucket;
  /**
   * CAP-RUN-20261015 / D6 — مفتاحُ الدلوِ العالميِّ لهذا البوت. حدُّ Bot API لكلِّ رمزِ بوتٍ على حِدَة، فبوتا
   * السائقِ والزبونِ دلوان لا دلوٌ واحد. غيابُه = المفتاحُ القديمُ المشتركُ "bot" (توافقٌ للاختبارات والمستدعين
   * القدامى). يُبنى بـ`outboundBucketKeyOfToken` فلا يدخلُ الرمزُ نفسُه Redis ولا السجلّ.
   */
  readonly bucketKey?: string;
  readonly deadLetter: OutboundDeadLetterSink;
  /** مهلةُ النداءِ الواحدِ. نداءٌ بلا مهلةٍ يحجزُ العاملَ إلى الأبدِ عندَ تعليقِ شبكةٍ. */
  readonly callTimeoutMs?: number;
  /** سقفُ المحاولاتِ للرسالةِ الحرجةِ ولغيرِ الحرجةِ. */
  readonly criticalMaxAttempts?: number;
  readonly informationalMaxAttempts?: number;
  /** أساسُ التراجعِ الأسّيِّ وسقفُه. */
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /**
   * أقصى ما يُنتظَرُ استجابةً لـ`retry_after`. فوقَه يُتخلّى: الحرجةُ إلى طابورِ
   * الموتى ليُعادَ النظرُ فيها، وغيرُ الحرجةِ تُسقَطُ — فخنقٌ طويلٌ يعني أنَّ حصّةَ
   * البوتِ استُنفِدَت، والوقوفُ فيه دقائقَ لأجلِ إشعارٍ ثانويٍّ يحجبُ ما هو أهمُّ.
   */
  readonly maxThrottleWaitMs?: number;
  /**
   * أقصى ما يُنتظَرُ فتحةً من الدلوِ قبلَ اعتبارِ الضغطِ العكسيِّ فشلاً عابراً —
   * سياسةُ الانتظارِ الافتراضيّةِ (مسارُ النداءِ المباشرِ).
   */
  readonly maxBucketWaitMs?: number;
  /**
   * `D8` — ميزانيّةُ سياسةِ الإحالةِ (`congestion: "abort"`) على مستوى النداء:
   * ما دامَ الضغطُ العكسيُّ أطولَ منها يُرمى `OutboundCongestionError` فوراً
   * فيتفرّغُ المسارُ ويعودُ الصفُّ إلى الطابورِ بموعدِ الفتحةِ. مسارُ صندوقِ
   * الصادرِ وحدَهُ يملكُ عقدَ `requeue` فيُوسَمُ به، والمساراتُ المباشرةُ
   * تبقى على سياسةِ الانتظارِ (`F11-05`).
   */
  readonly congestionAbortMaxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly nowIso?: () => string;
  readonly onEvent?: (event: OutboundEvent) => void;
}

export interface OutboundEvent {
  readonly type: "throttled" | "retry" | "gave_up" | "backpressure";
  readonly operation: OutboundOperation;
  readonly chatId: string;
  readonly attempt: number;
  readonly waitMs: number;
  readonly detail: string;
}

const DEFAULTS = {
  callTimeoutMs: 10_000,
  criticalMaxAttempts: 5,
  informationalMaxAttempts: 2,
  baseBackoffMs: 500,
  maxBackoffMs: 30_000,
  maxThrottleWaitMs: 60_000,
  maxBucketWaitMs: 5_000,
  congestionAbortMaxWaitMs: 300,
} as const;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * قراءةُ `error_code` و`parameters.retry_after` من الخطأِ **بشكلِه لا بصنفِه**.
 * grammY يرمي `GrammyError` بهذه الحقولِ، لكنَّ الاعتمادَ على `instanceof` يربطُ
 * منطقَ التصنيفِ بحزمةٍ خارجيّةٍ ويمنعُ اختبارَه بمزدوجٍ. والحقولُ نفسُها من
 * توثيقِ Bot API لا من grammY: https://core.telegram.org/bots/api#responseparameters
 */
function readTelegramError(error: unknown): {
  code: number | null;
  retryAfterMs: number | null;
} {
  if (typeof error !== "object" || error === null) return { code: null, retryAfterMs: null };
  const bag = error as Record<string, unknown>;
  const rawCode = bag.error_code;
  const code = typeof rawCode === "number" && Number.isFinite(rawCode) ? rawCode : null;
  const params = bag.parameters;
  let retryAfterMs: number | null = null;
  if (typeof params === "object" && params !== null) {
    const raw = (params as Record<string, unknown>).retry_after;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
      retryAfterMs = Math.ceil(raw * 1000);
    }
  }
  return { code, retryAfterMs };
}

/**
 * تصنيفُ الخطأِ. **الأصلُ العابرُ لا الدائمُ**: من صنَّفَ المجهولَ دائماً أسقطَ
 * رسائلَ صحيحةً لعطلٍ عارضٍ. والدائمُ محصورٌ فيما نصَّ عليه Bot API صراحةً:
 * `400` طلبٌ لا يُقبَلُ بصيغتِه · `401` رمزٌ باطلٌ · `403` المستخدمُ حظرَ البوتَ أو
 * طُرِدَ منه · `404` لا وجودَ للمقصدِ. وإعادةُ أيٍّ من هذه لا تُغيِّرُ نتيجتَها أبداً.
 */
function classify(error: unknown): { failure: OutboundFailureClass; retryAfterMs: number | null } {
  const { code, retryAfterMs } = readTelegramError(error);
  if (code === 429 || retryAfterMs !== null) {
    return { failure: "throttled", retryAfterMs: retryAfterMs ?? null };
  }
  if (code === 400 || code === 401 || code === 403 || code === 404) {
    return { failure: "permanent", retryAfterMs: null };
  }
  return { failure: "transient", retryAfterMs: null };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * غلافٌ يُضيفُ الصمودَ إلى أيِّ `TelegramSender` بلا أن يعرفَ ما تحتَه. يُطبَّقُ
 * عندَ إنشاءِ المُرسِلِ وحدَه (`container`)، فيرثُه كلُّ ما بُنيَ فوقَه — المحوّلاتُ
 * ومعالجاتُ صندوقِ الصادرِ والمُبلِّغاتُ — بلا تعديلِ موضعِ نداءٍ واحدٍ.
 */
/**
 * CAP-RUN-20261015 / D6 — مفتاحُ دلوٍ ثابتٌ لرمزِ بوت: بصمةٌ (sha256، 16 خانة) لا الرمزُ نفسُه. الرمزُ نفسُه مُهيَّأً
 * لبوتين يعطي المفتاحَ نفسَه، فلا يتضاعفُ الحدُّ.
 */
export function outboundBucketKeyOfToken(token: string): string {
  return `bot-${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}

export function withOutboundResilience(
  inner: TelegramSender,
  options: OutboundResilienceOptions,
): TelegramSender {
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULTS.callTimeoutMs;
  const criticalMax = options.criticalMaxAttempts ?? DEFAULTS.criticalMaxAttempts;
  const informationalMax = options.informationalMaxAttempts ?? DEFAULTS.informationalMaxAttempts;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULTS.baseBackoffMs;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  const maxThrottleWaitMs = options.maxThrottleWaitMs ?? DEFAULTS.maxThrottleWaitMs;
  const maxBucketWaitMs = options.maxBucketWaitMs ?? DEFAULTS.maxBucketWaitMs;
  const congestionAbortMaxWaitMs =
    options.congestionAbortMaxWaitMs ?? DEFAULTS.congestionAbortMaxWaitMs;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const nowIso = options.nowIso ?? (() => new Date().toISOString());

  /**
   * تراجعٌ أسّيٌّ **كامِلُ الـjitter** (`random_between(0, base * 2^n)`) لا نصفُه.
   * والسببُ أنَّ التراجعَ بلا jitter يجمعُ كلَّ النسخِ على اللحظةِ نفسِها بعدَ عطلٍ
   * مشتركٍ، فتضربُ الموجةُ الثانيةُ أقسى من الأولى — وهي «قطيعُ الرعدِ» بعينِه.
   */
  const backoffFor = (attempt: number): number => {
    const ceiling = Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.max(0, attempt - 1));
    return Math.max(1, Math.floor(random() * ceiling));
  };

  /** مهلةٌ حولَ النداءِ: أوّلُهما حسماً يحسمُ، والنداءُ المتأخّرُ يُهمَلُ لا يُنتظَر. */
  const withTimeout = async <T>(
    call: () => Promise<T>,
    operation: OutboundOperation,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        call(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`تجاوزَ ${operation} مهلةَ ${callTimeoutMs} مللي ثانية`)),
            callTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /** انتظارُ فتحةٍ من الدلوِ بنطاقَيه. يُعيدُ سببَ العجزِ وموعدَ الفتحةِ القادمةِ.
   * `D8`: ما لم يُتَح في مسارِ الإرسالِ لا يُنتظرُ داخلَ المسارِ.
   *
   * `LOAD-01` (الدفعةُ الخامسةُ) — **فتحةُ المحادثةِ أولًا ثمَّ العالميُّ**:
   * الدلوُ العالميُّ موردٌ مشتركٌ للبوتِ كلِّهِ (25/ث)، وفتحةُ المحادثةِ ملكُ
   * محادثةٍ واحدةٍ (1/ث تتجدّدُ في ثانيةٍ). ولما كانَ الاقتناءُ يستهلكُ الفتحةَ
   * عندَ المنحِ، كانَ اقتناءُ العالميِّ أولًا يُهدِرُ فتحةً مشتركةً في كلِّ ازدحامِ
   * محادثةٍ: قياسُ موجةِ `r3-wave-50` الرسميةِ — 60% من فتحاتِ البوتِ هُدرتْ
   * على محادثاتٍ مزدحمةٍ (12.5 رسالة/ث مُسلَّمةً من سقفِ 25/ث، وفي التصريفِ
   * 1.6/ث) — والفتحةُ المُهدَرةُ لا تمنعُ شيئاً: رفضُ فتحةِ المحادثةِ هوَ ما
   * يمنعُ الإرسالَ للمحادثةِ المزدحمةِ، فلا معنى لحرقِ نصيبِ البوتِ كلِّهِ معها.
   * وبعكسِ الترتيبِ ينتقلُ الهدرُ إلى دلوِ المحادثةِ نفسِها: محدودٌ بمالكِهِ،
   * يتجدّدُ في ثانيةٍ، فلا يمسُّ محادثةً أخرى ولا سقفَ البوتِ المشتركَ. */
  const awaitSlot = async (
    chatId: string,
    operation: OutboundOperation,
    attempt: number,
    priority: SendPriority,
    budgetMs: number,
  ): Promise<{ reason: string | null; retryAfterMs: number }> => {
    let waited = 0;
    // القسمُ ١٥ / `F6-07`: غيرُ الحرجِ يُمنَعُ قبلَ آخِرِ فتحاتِ الدلوِ العالميِّ
    // فيبقى للحرجِ متنفَّسٌ. ودلوُ المحادثةِ لا حِصّةَ فيه (فتحةٌ واحدةٌ لا تُقسَمُ).
    const bucketClass = bucketClassOfSendPriority(priority);
    for (;;) {
      const chatSlot = await options.bucket.acquire("chat", chatId, bucketClass);
      if (!chatSlot.granted) {
        if (waited + chatSlot.waitMs > budgetMs) {
          return { reason: "ازدحامُ دلوِ المحادثةِ", retryAfterMs: chatSlot.waitMs };
        }
        options.onEvent?.({
          type: "backpressure",
          operation,
          chatId,
          attempt,
          waitMs: chatSlot.waitMs,
          detail: "chat",
        });
        await sleep(chatSlot.waitMs);
        waited += chatSlot.waitMs;
        continue;
      }
      const globalSlot = await options.bucket.acquire(
        "global",
        options.bucketKey ?? "bot",
        bucketClass,
      );
      if (globalSlot.granted) return { reason: null, retryAfterMs: 0 };
      // فتحةُ المحادثةِ استُهلِكَت ولم تُرسَلِ الرسالةُ: الهدرُ محدودٌ بمالكِهِ —
      // يتجدّدُ في ثانيةٍ ولا يمسُّ محادثةً أخرى ولا سقفَ البوتِ المشتركَ.
      if (waited + globalSlot.waitMs > budgetMs) {
        return { reason: "ازدحامُ الدلوِ العالميِّ", retryAfterMs: globalSlot.waitMs };
      }
      options.onEvent?.({
        type: "backpressure",
        operation,
        chatId,
        attempt,
        waitMs: globalSlot.waitMs,
        detail: "global",
      });
      await sleep(globalSlot.waitMs);
      waited += globalSlot.waitMs;
    }
  };

  const run = async (
    operation: OutboundOperation,
    chatId: string,
    priority: SendPriority,
    call: () => Promise<string | null>,
    sendOptions?: SendOptions,
  ): Promise<string | null> => {
    const maxAttempts = priority === "critical" ? criticalMax : informationalMax;
    // `D8` — سياسةُ الضغطِ العكسيِّ على مستوى النداءِ لا المُرسِلِ: مسارُ صندوقِ
    // الصادرِ يملكُ عقدَ `requeue` فيُوسَمُ بـ`congestion: "abort"` (يُرمى
    // `OutboundCongestionError` فورَ تجاوزِ ميزانيّةٍ قصيرةٍ فيتفرّغُ المسارُ)،
    // وسائرُ النداءاتِ المباشرةِ تبقى على سياسةِ الانتظارِ وإعادةِ المحاولةِ
    // القديمةِ (الضغطُ فشلٌ عابرٌ يُعادُ عليهِ حتى استنفادِ المحاولاتِ).
    const abortOnCongestion = sendOptions?.congestion === "abort";
    const budgetMs = abortOnCongestion ? congestionAbortMaxWaitMs : maxBucketWaitMs;
    let lastReason = "لا سببَ مُسجَّلٌ";
    let lastFailure: OutboundFailureClass = "transient";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const slot = await awaitSlot(chatId, operation, attempt, priority, budgetMs);
      if (slot.reason !== null) {
        if (abortOnCongestion) {
          // ازدحامُ الدلاءِ ضغطٌ عابرٌ لا فشلَ إرسالٍ: يُرمى فوراً فيتفرّغُ
          // المسارُ لصفٍّ آخرَ، ويعودُ الصفُّ إلى الطابورِ بموعدِ الفتحةِ
          // (بلا محاولةٍ محتسَبةٍ) — عقدُ المستهلِكِ الذي يملكُ `requeue`.
          throw new OutboundCongestionError(slot.retryAfterMs);
        }
        // السياسةُ الافتراضيّةُ (الانتظار): الضغطُ العكسيُّ فشلٌ عابرٌ يُعادُ
        // عليهِ كما كانَ — والمستهلِكُ المباشرُ لا يملكُ طابوراً يعيدُ الصفَّ
        // فيعتمدُ إعادةَ المحاولةِ هنا (عقدُ `F11-05` القديم).
        lastReason = slot.reason;
        lastFailure = "transient";
        if (attempt < maxAttempts) {
          await sleep(backoffFor(attempt));
          continue;
        }
        break;
      }

      try {
        return await withTimeout(call, operation);
      } catch (error) {
        const { failure, retryAfterMs } = classify(error);
        lastReason = describe(error);
        lastFailure = failure;

        if (failure === "permanent") break;

        if (failure === "throttled") {
          // **`retry_after` يُحترَمُ حرفاً** لا يُستبدَلُ بتراجعِنا: تيليجرام وحدَه
          // يعرفُ متى تُفتَحُ الحصّةُ، ومن أعادَ قبلَها ضاعفَ العقوبةَ.
          const wait = retryAfterMs ?? backoffFor(attempt);
          options.onEvent?.({
            type: "throttled",
            operation,
            chatId,
            attempt,
            waitMs: wait,
            detail: lastReason,
          });
          if (wait > maxThrottleWaitMs || attempt >= maxAttempts) break;
          // jitter صغيرٌ فوقَ ما طلبَه لا داخلَه: لا يُنقِصُ الانتظارَ أبداً،
          // ويمنعُ النسخَ من أن تعودَ كلُّها في المللي ثانيةِ نفسِها.
          await sleep(wait + Math.floor(random() * 250));
          continue;
        }

        if (attempt >= maxAttempts) break;
        const wait = backoffFor(attempt);
        options.onEvent?.({
          type: "retry",
          operation,
          chatId,
          attempt,
          waitMs: wait,
          detail: lastReason,
        });
        await sleep(wait);
      }
    }

    await options.deadLetter.record({
      chatId,
      operation,
      priority,
      failure: lastFailure,
      attempts: maxAttempts,
      reason: lastReason,
      atIso: nowIso(),
    });
    options.onEvent?.({
      type: "gave_up",
      operation,
      chatId,
      attempt: maxAttempts,
      waitMs: 0,
      detail: lastReason,
    });
    throw new OutboundSendError({
      message: `تعذّرَ ${operation} إلى ${chatId}: ${lastReason}`,
      failure: lastFailure,
      attempts: maxAttempts,
      operation,
      chatId,
    });
  };

  return {
    sendMessage: (chatId, text, markup, sendOptions) =>
      run(
        "sendMessage",
        chatId,
        sendOptions?.priority ?? "informational",
        () => inner.sendMessage(chatId, text, markup, sendOptions),
        sendOptions,
      ),
    sendPhoto: (chatId, fileId, caption, markup, sendOptions) =>
      run(
        "sendPhoto",
        chatId,
        sendOptions?.priority ?? "informational",
        () => inner.sendPhoto(chatId, fileId, caption, markup, sendOptions),
        sendOptions,
      ),
    sendLocation: (chatId, latitude, longitude, sendOptions) =>
      run(
        "sendLocation",
        chatId,
        sendOptions?.priority ?? "critical",
        () => inner.sendLocation(chatId, latitude, longitude, sendOptions),
        sendOptions,
      ),
    ...interactiveOf(inner),
  };
}

/**
 * طابورُ موتى في ذاكرةِ العمليةِ، **محدودُ السَّعةِ**. صالحٌ للاختبارِ وللنسخةِ
 * الواحدةِ، ولا يصمدُ عبرَ إعادةِ التشغيلِ — وهذا مُعلَنٌ لا مسكوتٌ عنه.
 */
export function createMemoryDeadLetterSink(
  capacity = 200,
): OutboundDeadLetterSink & { readonly entries: () => readonly OutboundDeadLetter[] } {
  const letters: OutboundDeadLetter[] = [];
  return {
    entries: () => letters.slice(),
    record: async (letter) => {
      letters.push(letter);
      while (letters.length > capacity) letters.shift();
    },
  };
}

/** مصرِفٌ لا يحفظُ شيئاً — لمسارِ الاختبارِ الصامتِ وحدَه. */
export function createNoopDeadLetterSink(): OutboundDeadLetterSink {
  return { record: async () => {} };
}
