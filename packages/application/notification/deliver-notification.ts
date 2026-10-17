/**
 * الغرض: شوطُ صندوقِ الصادرِ الموحَّدِ (BUG-004): يلتقطُ صفًّا واحدًا بالرمزِ،
 *   يسلّمُه إلى معالجِ نوعِه، ثمّ يُعلنُ النتيجةَ — مُسلَّمًا بمعرّفِ رسالةٍ حقيقيٍّ،
 *   أو pending بموعدٍ جديدٍ إن فشلَ النشرُ، أو dead لا يُعادُ أبدًا إن كان الأثرُ
 *   لن يُقبلَ أبدًا. البنيةُ واحدةٌ لكلِّ الأنواعِ، والمعرفةُ بالنوعِ في معالجِه.
 * الحالة: منفّذ فعلياً — 2026-09-06.
 * ينتمي إلى: application/notification
 * يُستخدم من: apps/workers/src/jobs/deliver-notifications.ts
 * ملاحظات مستقبلية: كلُّ نوعٍ جديدٍ يُسجِّلُ معالجَه في الخريطةِ؛ ونوعٌ لا معالجَ
 *   له خطأٌ مُعلَنٌ لا صفٌّ مُهملٌ بصمتٍ.
 */
import type { CityId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { PortFailureError } from "../ports/index.ts";

/** صفُّ صادرٍ مُلتقَطٌ: البنيةُ عامّةٌ، والمعرفةُ بالنوعِ في الحمولةِ ومعالجِها. */
export interface OutboxDelivery {
  readonly deliveryId: string;
  readonly kind: string;
  readonly cityId: CityId;
  readonly claimToken: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  /**
   * `LOAD-01 Recovery` — كم مرةً انتظرَ الصفُّ إشارةَ اللوحِ (بلا محاولةِ
   * إرسالٍ محسوبةٍ): يعرفهُ المعالجُ فيُسقِفُ الانتظارَ لا ميزانيةَ البطاقةِ.
   */
  readonly signalWaitCount?: number;
  /**
   * سقفُ صفوفِ الشوطِ الواحدِ لهذه المدينةِ (`F6-06`). كانَ الشوطُ يُقاسُ بـ
   * `maxAttempts` — وهو **حدُّ إعادةِ محاولةِ الصفِّ الواحدِ** لا سعةُ الشوطِ —
   * فكانَ المفتاحُ الواحدُ يحملُ معنيَينِ: من رفعَ سماحَ الإعادةِ إلى عشرٍ رفعَ
   * حجمَ الشوطِ إلى عشرةٍ بلا أن يطلُبَ ذلك، ومن ضيّقَ الإعادةَ إلى واحدةٍ حبسَ
   * كلَّ التسليمِ في صفٍّ واحدٍ لكلِّ دورةٍ. فصارَ للسعةِ مفتاحُها.
   */
  readonly batchLimit: number;
  /**
   * معرِّفُ وحدةِ العملِ التي **أنشأَت** هذا الصفَّ، كما حُفِظَ في القاعدةِ
   * (`F8-01`). `null` يعني أنَّ الصفَّ كُتِبَ خارجَ وحدةِ عملٍ موصولةٍ — ويبقى
   * `null` ولا يُستبدَلُ بمولَّدٍ: سلسلةٌ مجهولةٌ أصدقُ من سلسلةٍ مُلفَّقةٍ.
   */
  readonly requestId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * مآلُ إعلانِ النتيجةِ كما تحكمُ به القاعدةُ لا كما يظنُّه المُستدعي: `delivered`
 * برسالةٍ لها معرّفٌ، أو `dead` لأنَّ المحاولاتِ استُنفدَت (CAP-002)، أو `retried`
 * بموعدٍ جديدٍ. و`null` حينَ رُفِضَ الإعلانُ أصلاً (رمزٌ لا يملكُ الصفَّ).
 */
export type FinishOutcome = "delivered" | "dead" | "retried";

export interface FinishResult {
  readonly ok: boolean;
  readonly outcome: FinishOutcome | null;
}

/**
 * سببُ منعِ الالتقاطِ حينَ لا صفَّ يعودُ: `CONSUMER_CONCURRENCY` تعني أنَّ سقفَ
 * تزامنِ المستهلِكِ بلغَ حدَّه فالصفوفُ موجودةٌ ولا تُلتقَطُ. و`null` تعني أنَّ
 * الطابورَ فارغٌ حقّاً. والتمييزُ لازمٌ: «لا عملَ» و«ممنوعٌ من العملِ» يُقرآنِ
 * سواءً في العدَّادِ فيُخفِيانِ تشبُّعاً مستمرّاً وراءَ شوطٍ هادئٍ.
 */
export type ClaimBackpressure = "CONSUMER_CONCURRENCY";

export interface NotificationOutboxPort {
  claim(): Promise<
    Result<
      {
        delivery: OutboxDelivery | null;
        /**
         * صفٌّ التُقطَ وعُذِرَ تسليمُه في القاعدةِ (`SEC-19-ب-٣`): العنوانُ غائبٌ
         * فلا يُحاوَلُ إرسالُه ولا يُعادُ. والعدُّ يُكملُ الشوطَ لا يُنهيهِ.
         */
        readonly undeliverable?: {
          readonly deliveryId: string;
          readonly kind: string;
          readonly reason: string;
          readonly batchLimit: number;
        } | null;
        backpressure?: ClaimBackpressure | null;
      },
      PortFailureError
    >
  >;
  finish(input: {
    deliveryId: string;
    claimToken: string;
    messageId: string | null;
    /** آخرُ خطأٍ من المُرسِلِ — يُحفظُ في الصفِّ ليُعرفَ سببُ موتِه لا أن يُخمَّنَ. */
    error: string | null;
  }): Promise<Result<FinishResult, PortFailureError>>;
  abandon(input: {
    deliveryId: string;
    claimToken: string;
    /** سببُ التخلّي الصريحُ — يُحفظُ في `dead_reason`. */
    reason: string | null;
  }): Promise<Result<boolean, PortFailureError>>;
  /**
   * `LOAD-01 Recovery` — إعلانُ تسليمٍ عبرَ لوحِ Mini App بإيصالٍ موثَّقٍ منَ
   * العميلِ: `delivered_channel = 'miniapp_board'` بلا معرّفِ رسالةٍ مُختلَقٍ.
   * حارسُ الرمزِ نفسُهُ — لا يعملُ إلا على صفٍّ `sending` يحملُ الرمزَ نفسَهُ.
   */
  finishViaBoard(input: {
    deliveryId: string;
    claimToken: string;
  }): Promise<Result<FinishResult, PortFailureError>>;
  /**
   * `LOAD-01 Recovery` — عودةٌ للطابورِ **بانتظارِ إشارةِ اللوحِ**: كمسارِ
   * الازدحامِ لا تُحسَبُ محاولةَ إرسالٍ، لكنّ عدّادَ الانتظارِ يزيدُ فيُعلَمُ
   * أنّ الصفّ ينتظرُ لا يفشلُ، والسقفُ عندَ المعالجِ (ثلاثٌ ثمّ البطاقةُ).
   */
  requeueSignalWait(input: {
    deliveryId: string;
    claimToken: string;
    retryAfterMs: number;
  }): Promise<Result<FinishResult, PortFailureError>>;
  /**
   * `D8` — إعادةُ صفٍّ إلى الطابورِ بعدَ **ازدحامِ دلاءِ الإرسالِ** (ضغطٍ عابرٍ
   * لا فشلِ إرسالٍ): يعودُ `pending` بموعدِ الفتحةِ القادمةِ، **ولا تُحسَبُ لهذه
   * الدورةِ محاولةٌ** — فالموتُ باستنفادِ المحاولاتِ لعثراتِ الإرسالِ الحقيقيةِ لا
   * لازدحامٍ يزولُ بزوالِ الحملِ. يُستدعى بموعدِ الفتحةِ الذي قدّرَه المُرسِلُ.
   */
  requeue(input: {
    deliveryId: string;
    claimToken: string;
    /** موعدُ الفتحةِ القادمةِ من الآنِ بالمللي ثانيةِ — تقديرُ المُرسِلِ. */
    retryAfterMs: number;
  }): Promise<Result<boolean, PortFailureError>>;
  /**
   * يُعلِنُ صفًّا **غيرَ قابلٍ للتسليمِ** من طبقةِ التطبيقِ (`SEC-19-ب-٤`):
   * العنوانُ غائبٌ فلا يُحاوَلُ إرسالُه ولا يُعادُ، ويُفصَلُ عن `dead` الذي
   * يعني فشلاً بعدَ جهدٍ. يَضَعُ `status = 'undeliverable'` بـ`dead_reason` و`died_at`.
   */
  undeliverable(input: {
    deliveryId: string;
    claimToken: string;
    reason: string;
  }): Promise<Result<boolean, PortFailureError>>;
}

/**
 * حكمُ المعالجِ على الصفِّ: إمّا تخلٍّ نهائيٌّ (أثرٌ لن يُقبلَ أبدًا)، وإمّا نشرٌ
 * نجحَ بمعرّفِ رسالةٍ، وإمّا فشلٌ بسببٍ مُعلَنٍ يعودُ به الصفُّ pending.
 * أو عجزُ تسليمٍ (`SEC-19-ب-٤`): العنوانُ غائبٌ فلا يُحاوَلُ ولا يُعادُ.
 */
export interface HandlerOutcome {
  readonly abandon: boolean;
  readonly messageId: string | null;
  readonly failure: string | null;
  /**
   * `SEC-19-ب-٤` — العنوانُ غائبٌ لا فشلٌ بعدَ جهدٍ. يُستدعى `outbox.undeliverable`
   * لا `outbox.abandon`، فيُفصَلُ عجزُ التسليمِ عن `dead`.
   */
  readonly undeliverable?: boolean;
  /**
   * `LOAD-01 Recovery` — وصلَ العرضُ إلى لوحِ السائقِ بإيصالٍ موثَّقٍ منَ
   * العميلِ (لا بادعاءِ إرسالٍ): يُعلَنُ التسليمُ عبرَ اللوحِ بمعرّفِ
   * الإيصالِ القائمِ لا بمعرّفِ رسالةٍ مُختلَقٍ.
   */
  readonly deliveredViaBoard?: boolean;
  /**
   * `LOAD-01 Recovery` — انتظارُ إشارةِ اللوحِ للسائقِ المتصلِ: عودةٌ للطابورِ
   * بموعدٍ قصيرٍ **بلا محاولةِ إرسالٍ محسوبةٍ** (نصيحةُ المراجعةِ: الانتظارُ
   * عدٌّ منفصلٌ مسقوفٌ لا من ميزانيةِ البطاقةِ)، والسقفُ في المعالجِ.
   */
  readonly signalWait?: { readonly retryAfterMs: number };
  /**
   * سببُ التعذُّرِ حينَ `undeliverable = true` — يُحفظُ في `dead_reason`.
   * أسماءٌ مغلقةٌ: `TELEGRAM_DELIVERY_UNAVAILABLE` (جوهريٌّ) و
   * `TELEGRAM_DELIVERY_NOT_REQUIRED` (غيرُ جوهريٍّ).
   */
  readonly undeliverableReason?: string;
}

export type NotificationHandler = (
  delivery: OutboxDelivery,
) => Promise<Result<HandlerOutcome, PortFailureError>>;

export interface NotificationDeliveryDeps {
  readonly outbox: NotificationOutboxPort;
  readonly handlers: Readonly<Record<string, NotificationHandler>>;
  /**
   * **الرجلُ الثالثةُ من `F8-01`: عبورُ الطابورِ.** تُحقَنُ من العاملِ فتُشغِّلُ
   * معالجةَ الصفِّ وإعلانَ نتيجتِه **داخلَ سياقِ ارتباطٍ مُستعادٍ من الصفِّ
   * نفسِه**، فتحملُ كتاباتُ العاملِ معرِّفَ الطلبِ الذي أنشأَ الصفَّ.
   *
   * وهيَ **حَقنٌ لا استيرادٌ** لأنَّ هذه الطبقةَ لا تعرفُ `AsyncLocalStorage`
   * ولا القاعدةَ: طبقةُ التطبيقِ تُعلِنُ الحاجةَ، والطبقةُ التحتيّةُ تُلبّيها.
   *
   * وغيابُها **لا يُسقِطُ التسليمَ**: الشوطُ يجري بلا ارتباطٍ (وهو حالُ كلِّ
   * اختبارٍ لا يعنيهِ الارتباطُ) — حاجزُ مراقبةٍ لا يجوزُ أن يمنعَ عملاً.
   */
  readonly withDeliveryCorrelation?: <T>(
    delivery: OutboxDelivery,
    run: () => Promise<T>,
  ) => Promise<T>;
}

export interface DeliveryAttemptOutcome {
  readonly found: boolean;
  readonly kind: string | null;
  readonly delivered: boolean;
  readonly abandoned: boolean;
  /** ماتَ الصفُّ باستنفادِ المحاولاتِ في `finish` — لا بتخلٍّ صريحٍ (CAP-002). */
  readonly died: boolean;
  /**
   * عُذِرَ تسليمُ الصفِّ في القاعدةِ (`SEC-19-ب-٣`): العنوانُ غائبٌ فلا يُحاوَلُ
   * إرسالُه. والعدُّ يُكملُ الشوطَ لا يُنهيهِ.
   */
  readonly undeliverable: boolean;
  readonly maxAttempts: number | null;
  /** سقفُ صفوفِ الشوطِ كما أعلنَه الالتقاطُ الذرّيُّ — `null` إن لم يُلتقَط صفٌّ. */
  readonly batchLimit: number | null;
  /** بلغَ سقفُ تزامنِ المستهلِكِ حدَّه فمُنعَ الالتقاطُ — لا أنَّ الطابورَ فرغَ. */
  readonly backpressure: ClaimBackpressure | null;
  /**
   * سببُ فشلِ النشرِ إن فشلَ. والصفُّ يعودُ `pending` بموعدٍ جديدٍ **ما لم تُستنفدِ
   * المحاولاتُ** — فحينَها يموتُ بـ`MAX_ATTEMPTS` ولا يُعادُ أبداً (CAP-002).
   */
  readonly failure: string | null;
}

export async function deliverNotification(
  deps: NotificationDeliveryDeps,
): Promise<Result<DeliveryAttemptOutcome, PortFailureError>> {
  const claimed = await deps.outbox.claim();
  if (!claimed.ok) return claimed;
  const delivery = claimed.value.delivery;
  const undeliverable = claimed.value.undeliverable ?? null;
  if (delivery === null) {
    // `SEC-19-ب-٣` — صفٌّ عُذِرَ تسليمُه في القاعدةِ: العنوانُ غائبٌ. لا يُحاوَلُ
    // إرسالُه ولا يُعادُ، والعدُّ يُكملُ الشوطَ لا يُنهيهِ كفراغِ الطابورِ.
    if (undeliverable !== null) {
      return ok({
        found: true,
        kind: undeliverable.kind,
        delivered: false,
        abandoned: false,
        died: false,
        undeliverable: true,
        maxAttempts: null,
        batchLimit: undeliverable.batchLimit,
        backpressure: null,
        failure: null,
      });
    }
    return ok({
      found: false,
      kind: null,
      delivered: false,
      abandoned: false,
      died: false,
      undeliverable: false,
      maxAttempts: null,
      batchLimit: null,
      backpressure: claimed.value.backpressure ?? null,
      failure: null,
    });
  }
  // ومن ههنا إلى آخرِ هذا الشوطِ يجري العملُ **داخلَ سياقِ الصفِّ**: معالجتُه
  // وإعلانُ نتيجتِه وكلُّ كتابةٍ تُوَلَّدُ عنهما. والالتقاطُ نفسُه يبقى خارجَه
  // لأنَّ المعرِّفَ لا يُعرَفُ قبلَ أن يعودَ الصفُّ.
  const run = deps.withDeliveryCorrelation;
  return run === undefined
    ? deliverClaimed(deps, delivery)
    : run(delivery, () => deliverClaimed(deps, delivery));
}

/**
 * معالجةُ صفٍّ **مُلتقَطٍ** وإعلانُ نتيجتِه. فُصِلَت عن `deliverNotification`
 * ليجريَ كلُّ ما بعدَ الالتقاطِ داخلَ سياقِ ارتباطِ الصفِّ (`F8-01`) — لا لتُقرأَ
 * بأجزاءٍ: السلوكُ لم يتغيّرْ حرفاً، والفصلُ هوَ ما جعلَ اللفَّ ممكناً بلا تكرارٍ.
 */
async function deliverClaimed(
  deps: NotificationDeliveryDeps,
  delivery: OutboxDelivery,
): Promise<Result<DeliveryAttemptOutcome, PortFailureError>> {
  const handler = deps.handlers[delivery.kind];
  if (handler === undefined) {
    // نوعٌ في القاعدةِ بلا معالجٍ في الكودِ: تعارضُ هجرةٍ ونشرٍ. يُعلَنُ خطأً —
    // ولا يُتخلّى عن الصفِّ ولا يُسلَّمُ كذبًا، فالصفُّ يعودُ بمهلةِ الحجزِ سليمًا.
    return err(new PortFailureError("outbox.handler", `لا معالجَ لنوعِ الإشعارِ «${delivery.kind}»`));
  }
  const handled = await handler(delivery);
  if (!handled.ok) return handled;
  // `SEC-19-ب-٤` — العنوانُ غائبٌ: عجزُ تسليمٍ لا فشلُ محاولاتٍ. يُفصَلُ عن
  // `abandon` (الذي يَضَعُ `dead`) فيُعلَنُ `undeliverable` بـ`dead_reason` مُسمّىً.
  if (handled.value.undeliverable === true) {
    const reason = handled.value.undeliverableReason ?? "TELEGRAM_ID_MISSING";
    const marked = await deps.outbox.undeliverable({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
      reason,
    });
    if (!marked.ok) return marked;
    return ok({
      found: true,
      kind: delivery.kind,
      delivered: false,
      abandoned: false,
      died: false,
      undeliverable: true,
      maxAttempts: delivery.maxAttempts,
      batchLimit: delivery.batchLimit,
      backpressure: null,
      failure: null,
    });
  }
  // `LOAD-01 Recovery` — وصلَ العرضُ إلى اللوحِ بإيصالٍ: تسليمٌ معلنٌ بالقناةِ
  // لا بمعرّفِ رسالةٍ. الإيصالُ منَ العميلِ الموثّقِ لا منَ جلبٍ صمّاءَ، فلا
  // يُدّعى وصولٌ لم يُقَس.
  if (handled.value.deliveredViaBoard === true) {
    const viaBoard = await deps.outbox.finishViaBoard({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
    });
    if (!viaBoard.ok) return viaBoard;
    return ok({
      found: true,
      kind: delivery.kind,
      delivered: viaBoard.value.ok,
      abandoned: false,
      died: false,
      undeliverable: false,
      maxAttempts: delivery.maxAttempts,
      batchLimit: delivery.batchLimit,
      backpressure: null,
      failure: null,
    });
  }
  // `LOAD-01 Recovery` — انتظارُ إشارةِ اللوحِ للسائقِ المتصلِ: عودةٌ قصيرةُ
  // المهلةِ بلا محاولةِ إرسالٍ محسوبةٍ (البطاقةُ تنالُ ميزانيتَها كاملةً إن
  // لم يصلِ الإيصالُ)، والسقفُ في المعالجِ — ثلاثُ دوراتٍ ثمّ البطاقةُ.
  if (handled.value.signalWait !== undefined) {
    const waited = await deps.outbox.requeueSignalWait({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
      retryAfterMs: handled.value.signalWait.retryAfterMs,
    });
    if (!waited.ok) return waited;
    return ok({
      found: true,
      kind: delivery.kind,
      delivered: false,
      abandoned: false,
      died: false,
      undeliverable: false,
      maxAttempts: delivery.maxAttempts,
      batchLimit: delivery.batchLimit,
      backpressure: null,
      failure: null,
    });
  }
  if (handled.value.abandon) {
    const abandoned = await deps.outbox.abandon({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
      reason: handled.value.failure,
    });
    if (!abandoned.ok) return abandoned;
    return ok({
      found: true,
      kind: delivery.kind,
      delivered: false,
      abandoned: true,
      died: false,
      undeliverable: false,
      maxAttempts: delivery.maxAttempts,
      batchLimit: delivery.batchLimit,
      backpressure: null,
      failure: null,
    });
  }
  // `D8` — ازدحامُ دلاءِ الإرسالِ: ضغطٌ عابرٌ لا فشلَ إرسالٍ. المعالجاتُ تنقلُ
  // اسمَ الخطأِ كما هو، وازدحامُ المُرسِلِ يحملُ اسمَه المميزَ. الصفُّ يعودُ إلى
  // الطابورِ بموعدِ الفتحةِ القادمةِ (نافذةُ المحادثةِ) بلا محاولةٍ مُحتسَبةٍ،
  // والمسارُ يتفرّغُ لصفٍّ آخرَ لمحادثةٍ باردةٍ — هذا هوَ صونُ عملِ المساراتِ.
  if (handled.value.failure === "OutboundCongestionError" && handled.value.messageId === null) {
    const requeued = await deps.outbox.requeue({
      deliveryId: delivery.deliveryId,
      claimToken: delivery.claimToken,
      retryAfterMs: 1_000,
    });
    if (!requeued.ok) return requeued;
    return ok({
      found: true,
      kind: delivery.kind,
      delivered: false,
      abandoned: false,
      died: false,
      undeliverable: false,
      maxAttempts: delivery.maxAttempts,
      batchLimit: delivery.batchLimit,
      backpressure: null,
      failure: handled.value.failure,
    });
  }
  const finished = await deps.outbox.finish({
    deliveryId: delivery.deliveryId,
    claimToken: delivery.claimToken,
    messageId: handled.value.messageId,
    error: handled.value.failure,
  });
  // فشل `finish` وحده يُرجَع خطأً: الصفّ عالقٌ في `sending` بلا موعد. أمّا فشلُ
  // النشرِ فقد أُعيد الصفّ به إلى `pending` سليمًا بموعدٍ جديد.
  if (!finished.ok) return finished;
  // «سُلّمت» تعني أنّ رسالةً وصلت فعلاً ولها معرّف. لا يجوز أن يُعلن التسليم
  // إلا بمعرّف رسالة حقيقيّ — والقاعدةُ لا تُعلنُ delivered بغيرِه.
  return ok({
    found: true,
    kind: delivery.kind,
    delivered: handled.value.messageId !== null && finished.value.ok,
    abandoned: false,
    died: finished.value.outcome === "dead",
    undeliverable: false,
    maxAttempts: delivery.maxAttempts,
    batchLimit: delivery.batchLimit,
    backpressure: null,
    failure: handled.value.failure,
  });
}

export interface DeliveryBatchOutcome {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly abandoned: number;
  /** عُذِرَ تسليمُها في القاعدةِ (`SEC-19-ب-٣`) — العنوانُ غائبٌ. */
  readonly undeliverable: number;
  /** ماتت باستنفادِ المحاولاتِ — تُعدُّ منفصلةً عن التخلّي الصريحِ (CAP-002). */
  readonly died: number;
  /**
   * انقطعَ الشوطُ بضغطٍ عكسيٍّ لا بفراغِ الطابورِ (`F6-06`): إمّا سقفُ تزامنِ
   * المستهلِكِ منعَ الالتقاطَ، وإمّا بلغَ الشوطُ سقفَ صفوفِه والطابورُ لم يفرُغ.
   */
  readonly backpressure: ClaimBackpressure | "BATCH_LIMIT" | null;
}

/**
 * شوطٌ محدودٌ بسعةِ الشوطِ التي أرجعها claim الذرّي (`batch_limit`، إعدادُ مدينةٍ)
 * لا بحدِّ إعادةِ محاولةِ الصفِّ (`max_attempts`) — والخلطُ بينَهما كانَ عيبَ
 * `F6-06`. ولعمرِ الصفِّ حدٌّ منذُ CAP-002: فشلُ النشرِ يُعيدُه pending بتراجعٍ
 * أُسّيٍّ **حتى `max_attempts`**، ثمّ يموتُ بـ`MAX_ATTEMPTS`. والصفوفُ التي لن
 * تُقبلَ أبدًا يُتخلّى عنها فوراً (dead) فلا تُستهلِكُ الشوطَ ولا تُعادُ أبدًا
 * (BUG-004).
 *
 * وأوّلُ التقاطٍ هوَ ما يُعلِنُ السعةَ، فالشوطُ يبدأُ بواحدٍ حتماً: قراءةُ السعةِ
 * قبلَ الالتقاطِ كانت ستكونَ نداءً ثانياً على القاعدةِ في كلِّ دورةٍ، وسعةً
 * تُقرأُ من مدينةٍ لا تُعرَفُ بعدُ — والالتقاطُ هوَ ما يُحدِّدُ المدينةَ.
 */
export async function deliverNotificationBatch(
  deps: NotificationDeliveryDeps,
): Promise<Result<DeliveryBatchOutcome, PortFailureError>> {
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let abandoned = 0;
  let undeliverable = 0;
  let died = 0;
  let limit = 1;
  let backpressure: ClaimBackpressure | "BATCH_LIMIT" | null = null;
  while (claimed < limit) {
    const attempt = await deliverNotification(deps);
    if (!attempt.ok) return attempt;
    if (!attempt.value.found) {
      backpressure = attempt.value.backpressure;
      break;
    }
    claimed += 1;
    if (attempt.value.batchLimit !== null) limit = attempt.value.batchLimit;
    if (attempt.value.delivered) delivered += 1;
    if (attempt.value.abandoned) abandoned += 1;
    if (attempt.value.undeliverable) undeliverable += 1;
    if (attempt.value.died) died += 1;
    // فشلُ نشرٍ واحد لا يُسقطُ الشوط: مجموعةُ مدينةٍ معطوبة كانت تمنعُ تسليمَ
    // إشعاراتِ المدنِ الأخرى في نفسِ الدورة. يُعدّ ويُبلَّغ، ويستمرّ الشوط.
    if (attempt.value.failure !== null) failed += 1;
    // بلوغُ السعةِ يُعلَنُ ضغطاً عكسيّاً لا شوطاً ناجحاً: الطابورُ لم يفرُغ،
    // والدورةُ التاليةُ تُكمِلُ. وكتمُه كانَ سيُخفِي تراكُماً مستمرّاً.
    if (claimed >= limit) backpressure = "BATCH_LIMIT";
  }
  return ok({ claimed, delivered, failed, abandoned, undeliverable, died, backpressure });
}

/**
 * CAP-RUN-20261015 / N1 — استنزافٌ متزامنٌ محدودٌ لصندوقِ الصادر.
 *
 * العيبُ المقيس: `deliverNotificationBatch` يرسلُ تسلسليًّا حتّى `batch_limit` (= سقفُ تزامنِ
 * المستهلكِ، 8) ثمّ ينتهي، والمشغّلُ يدقُّ كلَّ 10ث؛ فسقفُ الصادرِ كلِّه ≈ 0.8 رسالة/ث لكلِّ المدنِ
 * مهما كانَ عمقُ الطابور، بينما حدُّ المزوّدِ المعلنُ في الكود 25/ث لكلِّ بوت.
 *
 * الإصلاح:
 * - حتّى `lanes` إرسالاتٍ متزامنةٍ في العمليّة؛ و`claim_notification_delivery` يبقى الحَكَمَ: سقفُ
 *   `sending` لكلِّ مدينةٍ (CONSUMER_CONCURRENCY)، و`skip locked` + `claim_token` ضدَّ الازدواج.
 * - ترتيبٌ لكلِّ مفتاح: صفوفُ الطلبِ/التفاوضِ نفسِه تُرسَلُ بترتيبِ التقاطِها (مسارٌ واحدٌ للمفتاح)؛
 *   عروضُ السائقينَ المختلفينَ مستقلّةٌ فتتوازى.
 * - يواصلُ الالتقاطَ ما دامَ في الطابورِ عملٌ مستحقٌّ حتّى `budgetMs` أو `maxClaims`، ثمّ ينتظرُ
 *   ما في الطيرانِ (لا يتركُ صفًّا محجوزًا بلا ختم).
 * - لا يمسُّ حدودَ المعدّل: كلُّ إرسالٍ يمرُّ بالمرسِلِ نفسِه (دلوُ 25/ث للبوت و1/ث للمحادثة).
 * - فشلُ منفذٍ (قاعدة) يوقفُ الالتقاطَ الجديدَ ويُعادُ كالسابق؛ الصفُّ الذي لم يُختَم يستعيدُه
 *   `reclaim` بعدَ مهلةِ الحجزِ كما في المسارِ التسلسليّ.
 */
export interface ConcurrentDrainOptions {
  readonly lanes: number;
  readonly budgetMs: number;
  readonly maxClaims: number;
  readonly now?: () => number;
  /** نومٌ محقونٌ لاختبارِ احتجازِ الازدحامِ داخلَ الشوطِ — الافتراضيُّ `setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ConcurrentDrainOutcome extends DeliveryBatchOutcome {
  readonly peakInFlight: number;
  readonly elapsedMs: number;
}

export function notificationLaneKey(delivery: OutboxDelivery): string {
  const p = delivery.payload;
  const s = (k: string): string | null => {
    const v = p[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  if (delivery.kind === "offer") return `offer:${s("offer_id") ?? delivery.deliveryId}`;
  const order = s("order_id");
  if (order !== null) return `order:${order}`;
  const neg = s("negotiation_id");
  if (neg !== null) return `neg:${neg}`;
  return `row:${delivery.deliveryId}`;
}

export async function deliverNotificationsConcurrently(
  deps: NotificationDeliveryDeps,
  options: ConcurrentDrainOptions,
): Promise<Result<ConcurrentDrainOutcome, PortFailureError>> {
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lanes = Math.max(1, Math.floor(options.lanes));
  const started = now();
  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let abandoned = 0;
  let undeliverable = 0;
  let died = 0;
  let peakInFlight = 0;
  let backpressure: ClaimBackpressure | "BATCH_LIMIT" | null = null;
  const failure: { error: PortFailureError | null } = { error: null };
  const inFlight = new Set<Promise<void>>();
  const laneTails = new Map<string, Promise<void>>();
  /**
   * `LOAD-01` (الدفعةُ الخامسةُ) — **الانتظارُ الذكيُّ عندَ فراغِ الطابورِ:**
   * صفُّ الازدحامِ يُعادُ إلى الطابورِ بموعدِ فتحتِهِ (ثانيةٍ واحدةٍ — عقدُ
   * `retryAfterMs`)، لكنَّ الشوطَ كانَ ينكسرُ عندَ أولِ طابورٍ فارغٍ فينتظرُ الصفُّ
   * دورةَ التشغيلِ القادمةَ كلَّها (10ث) — فتصريفُ ما بعدَ الحقنِ كانَ 2.5 صفٍّ/ث
   * (كلُّ محادثةٍ صفًّا واحدًا لكلِّ دورةٍ) وبقيَ أقدمُ معلقٍ 174ث في موجةِ الـ100.
   * الآنَ: إذا كانَ آخرُ ازدحامٍ أحدثَ من فتحتِهِ (ثانيةٍ) والميزانيةُ تسمحُ، ينتظرُ
   * الشوطُ حتى موعدِ الفتحةِ ويلتقطُ الصفوفَ المستحقةَ **داخلَ الشوطِ نفسِهِ** —
   * بلا احتفاظٍ بالصفوفِ (فالاحتفاظُ يستنزفُ سقفَ تزامنِ المدينةِ 8 لأنَّ الصفَّ
   * يبقى `sending`) بل إعادةُ اصطفافٍ فوريةٍ تُحرِّرُ الخانةَ والتقاطٌ جديدٌ عندَ
   * الاستحقاقِ — والدلالةُ لا تتغيرُ: إشعاراتُ رحلةٍ متجمعةٌ تُسلَّمُ في شوطٍ
   * واحدٍ عندَ فتحاتِها.
   */
  let congestionUntil = 0;

  const record = (r: Result<DeliveryAttemptOutcome, PortFailureError>) => {
    if (!r.ok) {
      failure.error ??= r.error;
      return;
    }
    const a = r.value;
    if (a.failure === "OutboundCongestionError") {
      congestionUntil = Math.max(congestionUntil, now() + 1_000);
    }
    if (a.delivered) delivered += 1;
    if (a.abandoned) abandoned += 1;
    if (a.undeliverable) undeliverable += 1;
    if (a.died) died += 1;
    if (a.failure !== null) failed += 1;
  };
  const runOne = (delivery: OutboxDelivery) => {
    const wrap = deps.withDeliveryCorrelation;
    return wrap === undefined
      ? deliverClaimed(deps, delivery)
      : wrap(delivery, () => deliverClaimed(deps, delivery));
  };

  while (failure.error === null) {
    if (now() - started >= options.budgetMs) break;
    if (claimed >= options.maxClaims) {
      backpressure = "BATCH_LIMIT";
      break;
    }
    if (inFlight.size >= lanes) {
      await Promise.race(inFlight);
      continue;
    }
    const c = await deps.outbox.claim();
    if (!c.ok) {
      failure.error = c.error;
      break;
    }
    const delivery = c.value.delivery;
    if (delivery === null) {
      if (c.value.undeliverable) {
        claimed += 1;
        undeliverable += 1;
        continue;
      }
      if (c.value.backpressure) backpressure = c.value.backpressure;
      // فارغٌ أو مشبَعٌ: ما في الطيرانِ قد يفكُّ تاليًا لنفسِ الطلبِ أو يحرّرُ سقفَ المدينةِ.
      if (inFlight.size > 0) {
        await Promise.race(inFlight);
        continue;
      }
      // `LOAD-01` (الدفعةُ الخامسةُ): الصفوفُ المُعادُ اصطفافُها تستحقُّ عندَ فتحاتِها
      // (ثانيةٍ) — إن كانَ آخرُ ازدحامٍ أحدثَ من فتحتِهِ والميزانيةُ تسمحُ، فانتظارٌ
      // قصيرٌ مقيدٌ بالميزانيةِ لا انكسارٌ يتركُها لدورةِ التشغيلِ القادمةِ (10ث).
      if (now() < congestionUntil && now() - started < options.budgetMs) {
        const budgetEnd = started + options.budgetMs;
        await sleep(Math.max(1, Math.min(congestionUntil, budgetEnd) - now()));
        continue;
      }
      break;
    }
    claimed += 1;
    const key = notificationLaneKey(delivery);
    const prev = laneTails.get(key);
    const task: Promise<void> = (prev ?? Promise.resolve())
      .then(() => runOne(delivery))
      .then(record, (e: unknown) => {
        failure.error ??= new PortFailureError(
          "outbox.deliver",
          e instanceof Error ? e.message : String(e),
        );
      })
      .finally(() => {
        inFlight.delete(task);
        if (laneTails.get(key) === task) laneTails.delete(key);
      });
    laneTails.set(key, task);
    inFlight.add(task);
    if (inFlight.size > peakInFlight) peakInFlight = inFlight.size;
  }
  await Promise.all(inFlight);
  if (failure.error !== null) return err(failure.error);
  return ok({
    claimed,
    delivered,
    failed,
    abandoned,
    undeliverable,
    died,
    backpressure,
    peakInFlight,
    elapsedMs: now() - started,
  });
}
