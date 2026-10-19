/**
 * الغرض: تركيب جلسة التتبّع على المسار الحيّ ونشر الموقع لحظياً — المرحلة ٦.
 *   يُستدعى من `handleLocation` في حوار بوت السائق **بعد** نجاح الكتابة القانونية،
 *   ومن إنهاء الرحلة في حوار التقييم.
 * الحالة: منفّذ فعلياً — موصول في apps/gateway/src/container.ts.
 * ينتمي إلى: application/tracking
 * يُتوقع أن يستخدمه لاحقاً: المرحلة ١١ (تتبّع العميل) والمرحلة ١٣ (خريطة العمليات)
 *
 * ## الموضع من المسار — ولماذا بعد الكتابة لا قبلها
 *
 * المسار الحيّ اليوم: رسالة موقعٍ من تلغرام ← `handleLocation` ← `assessGpsFix`
 * ← `drivers.updateLocation` (الكاتب الوحيد، ADR-0015). وهذه الطبقة تُركَّب
 * **بعد** آخر خطوة، ولا تُدخل نفسها في المعادلة قبلها.
 *
 * وهذا ليس تفصيل ترتيب: لو سبق النشرُ الكتابةَ لأمكن أن يرى العميل سائقه يتحرّك
 * إلى نقطةٍ لم تُخزَّن قط (فشلت الكتابة بعد النشر)، فتصير الخريطة مصدراً ثانياً
 * للحقيقة يخالف القاعدة — وهو أسوأ أنواع التعارض لأنّ المستخدم يثق بما يرى.
 *
 * ## ولماذا لا تُنشئ هذه الطبقة مساراً ثانياً للمعالجة
 *
 * في المستودع صنفٌ اسمه `TrackingService` يفعل شيئاً مشابهاً: يُقيّم الإصلاحة
 * ويخزّنها ويُطلق الأحداث. وهو **غير موصول** (مساره `routes/tracking.ts` غير
 * مركَّب)، وتقييمه مبنيّ على أن العميل يُرسل GPS إلى نقطة نهاية HTTP بمُوثِّق
 * رمزيّ لا وجود لمُصدِرِه بعد. فتوصيله كان يعني: نظام مصادقةٍ ثانياً، وتقييم
 * إصلاحةٍ مرّتين (مرّة في الحوار ومرّة فيه)، ومصدرين لـ«الإصلاحة السابقة».
 *
 * فالمُتَّبَع هنا هو القاعدة ٤: لا خدمة جديدة لوظيفة قائمة. المسار الحيّ
 * الموجود هو المسار، وهذه الطبقة تضيف إليه ما كان ناقصاً فعلاً — الجلسة والنشر —
 * ولا تكرّر ما فيه. و`TrackingService` يبقى موصوفاً بصراحة أنه غير موصول.
 */

import {
  acceptsFixes,
  DEFAULT_SESSION_POLICY,
  type DriverDutyState,
  recordFix,
  type SessionEndReason,
  type SessionPolicy,
  sessionShouldRun,
} from "../../domain/tracking/session.ts";
import type { TrackingEvent, TrackingEventPublisher } from "../../tracking/index.ts";
import type { TrackingSessionRecord, TrackingSessionStore } from "../../tracking/session-store.ts";

/** حكم جودة الإصلاحة كما خُزِّن مع الموقع (نفس مفردات `StoredLocationQuality`). */
export type FixVerdict = "ACCEPT" | "WARNING" | "ALERT";

/**
 * إصلاحة مقبولة **وقد خُزِّنت** فعلاً. لا حقل هنا يُعاد حسابه: كل قيمة أتت من
 * تقييم المجال الذي جرى مرّةً واحدة في المسار الحيّ.
 */
export interface StoredFix {
  readonly driverId: string;
  readonly cityId: string;
  readonly latitude: number;
  readonly longitude: number;
  /** زمن جهاز السائق — لا زمن الخادم (المرحلة ٥). */
  readonly recordedAtMs: number;
  readonly accuracyMeters: number | null;
  readonly verdict: FixVerdict;
  /** رموز ملاحظات المُقيِّم كما هي — بلا إعادة تصنيف هنا. */
  readonly findings: readonly string[];
}

/**
 * المنفذ كما يراه حوار البوت. صغير بقصد: كل ما يعرفه الحوار أنّ موقعاً حُفظ،
 * أو أنّ رحلة انتهت. ولا يعرف جلسةً ولا ناقلاً ولا مشتركاً.
 */
export interface LiveTrackingPort {
  /** يُستدعى بعد نجاح `drivers.updateLocation`. لا يرمي أبداً. */
  onFix(fix: StoredFix): Promise<void>;
  /** يُستدعى بعد نجاح إنهاء/إلغاء الرحلة. لا يرمي أبداً. */
  onTripEnded(tripId: string, reason: SessionEndReason): Promise<void>;
  /**
   * المرحلة ١٢ — يُستدعى بعد نجاح إخراج السائق من الإتاحة. لا يرمي أبداً.
   *
   * ولماذا نداءٌ صريح مع أنّ `onFix` تفحص الخدمة أصلاً؟ لأن السائق الذي يخرج من
   * الخدمة قد لا يُرسل إصلاحةً أخرى أبداً — وهو الغالب: يضغط الزرّ ويُغلق التطبيق.
   * فلو كان الإغلاق معلّقاً على إصلاحةٍ تالية لبقيت جلستُه مفتوحةً إلى السقف
   * الزمني، وهو نفس العيب المقيس. والفحص في `onFix` يمنع **العودة**، وهذا النداء
   * يُنهي **الحاضر**؛ ولا يكفي أحدهما وحده.
   */
  onDutyEnded(driverId: string): Promise<void>;
}

/**
 * قارئ الرحلة الجارية للسائق. سؤالٌ واحد بجواب واحد، ويُقرأ من `orders` —
 * المصدر القانوني لحالة الرحلة — لا من ذاكرةٍ تُبنى بالأحداث.
 *
 * ولماذا يُقرأ في كل إصلاحة بدل أن يُربط عند بدء الرحلة؟ لأن الربط بالحدث يُخطئ
 * في الحالة التي تهمّ فعلاً: نسخةٌ أُعيد تشغيلها في منتصف رحلة لا يصلها حدث
 * البدء، فتبقى جلستها بلا رحلة ولا يرى العميل شيئاً. والقراءة استعلامٌ واحد على
 * فهرسٍ قائم، وحملها معلوم ومحدود بمعدّل رسائل الموقع.
 */
export interface ActiveTripReader {
  activeTripOf(driverId: string): Promise<string | null>;
}

/**
 * قارئ حالة الخدمة. منفصلٌ عن `ActiveTripReader` لأن سؤاله مختلف: ذاك يسأل
 * «أيّ رحلة؟» وهذا يسأل «أفي الخدمة؟» — ودمجهما كان سيُجبر كل مستهلكٍ لأحدهما
 * على تنفيذ الآخر.
 */
export interface DriverDutyReader {
  isOnDuty(driverId: string): Promise<boolean>;
}

/**
 * قارئ الحالتين معًا في رحلة قاعدةٍ واحدة: «في الخدمة؟» و«أيّ رحلةٍ نشطة؟».
 *
 * ## لماذا وُجد هذا القارئ بعد أن وُجد القارئان قبله
 *
 * لأنّ مستهلكَه الوحيدَ (`onFix`) يحتاج الإجابتين في اللحظة نفسِها، وكان
 * يقرؤهما في رحلتين متتاليتين على مجموعة الطلبات المشبعة، فيدفعُ انتظارَ
 * طابورِها مرتينِ في كل إصلاحة موقع. هذا القارئ يجمعُهما في استعلامٍ واحدٍ
 * على لقطةٍ واحدة، فلا يُدفع الانتظار إلا مرةً ولا تُقرأ الحقيقة مرتين.
 * ومن لا يملكه يبقى على القارئين كما كان — لا سلوكَ جديدًا عليه.
 */
export interface DriverDutyAndTripReader {
  dutyAndActiveTrip(driverId: string): Promise<{
    readonly onDuty: boolean;
    readonly activeTripId: string | null;
  }>;
}

export interface LiveTrackingDeps {
  readonly sessions: TrackingSessionStore;
  readonly publisher: TrackingEventPublisher;
  readonly trips: ActiveTripReader;
  /**
   * إلزاميّ لا اختياريّ بقصد: لو كان اختيارياً لكان نسيانُه في الحاوية يُعيد
   * العيب صامتاً في الإنتاج، والاختبارات خضراء. فالمُترجِم هو من يمنع النسيان.
   */
  readonly duty: DriverDutyReader;
  /**
   * اختياريّ بقصدٍ لا نسيانًا: مستهلكُه الوحيدُ (`onFix`) يقرأ الحالتين معًا.
   * من يوفّرُه يقرؤهما في رحلةٍ واحدة، ومن لا يوفّرُه يبقى على القارئين
   * المنفصلين كما كان — فالسلوكُ القديمُ هو الحالةُ الاسميةُ لا الاستثناء.
   */
  readonly dutyAndTrip?: DriverDutyAndTripReader;
  readonly clock: { now(): Date };
  readonly policy?: SessionPolicy;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

export function createLiveTracking(deps: LiveTrackingDeps): LiveTrackingPort {
  const policy = deps.policy ?? DEFAULT_SESSION_POLICY;
  const log = deps.log ?? ((): void => undefined);

  /**
   * حاجز واحد لكل الأعطال. النقل اللحظي **عونٌ لا شرط**: انقطاع القاعدة عن جدول
   * الجلسات، أو فشل النشر، لا يجوز أن يُفشل رسالة موقعٍ حُفظت فعلاً — فيرى
   * السائق «تعذّر حفظ موقعك» وموقعه محفوظ. والعطل يظهر في السجلّ لا في وجهه.
   */
  const guarded = async (operation: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      log("tracking.realtime_failed", { operation, detail: String(error) });
    }
  };

  const publish = async (event: TrackingEvent): Promise<void> => {
    await deps.publisher.publish(event);
  };

  /**
   * إغلاقٌ بمعرّف السائق مع إعلان الحدث. موحّدٌ لأن للإغلاق بمعرّف السائق ثلاثة
   * مواضع (خروجٌ صريح، وإصلاحةٌ من خارج الخدمة، وتجاوزُ السقفِ الزمنيِّ بـ`EXPIRED`
   * — `BUG-010`)؛ وإغلاقٌ بلا حدث يترك
   * رسالة الموقع الحيّ تدور على جهاز العميل والصفّ على خريطة العمليات —
   * أي إغلاقٌ في الجدول وحده، وهو أسوأ من لا إغلاق: عيبٌ يُرى مغلقاً في القاعدة.
   */
  const closeAndAnnounce = async (
    driverId: string,
    tripId: string | null,
    reason: SessionEndReason,
    nowMs: number,
  ): Promise<void> => {
    const closed = await deps.sessions.close(driverId, reason, nowMs);
    if (closed === null) return;

    await publish({
      type: "session_ended",
      driverId,
      tripId,
      sessionId: closed.sessionId,
      sequence: closed.sequence,
      position: null,
      timestamp: new Date(nowMs),
      metadata: { reason },
    });
  };

  /**
   * الجلسة الصالحة للسائق الآن — تُفتح إن لم تكن، وتُغلق وتُستبدل إن تجاوزت
   * سقفها الزمني.
   *
   * وهذا الإغلاق هو ما يُغني عن ماسحٍ دوريّ للجلسات الأبديّة (كان خطراً معلناً
   * في المرحلة ٥): آلة المجال تحكم على الجلسة المتجاوزة سقفها بـ`ENDED` عند
   * القراءة، فلا تُقرأ نشطةً أبداً؛ وأوّل إصلاحة تالية تكتب هذا الحكم في القاعدة
   * صراحةً بسبب `EXPIRED`. فالتنظيف يقع في المسار الذي يهمّ، بلا مؤقّتٍ يُنسى.
   *
   * **و`BUG-010`:** هذا الإغلاق يمرّ بـ`closeAndAnnounce` كسائر الإغلاقات، فلا
   * يبقى إغلاقٌ في الجدول بلا حدثٍ يقابله. وكان يُنادي `sessions.close` مباشرةً
   * ويُهمل عائدَها، فيُستهلك رقمُ التسلسل بلا `session_ended` — فتبقى رسالةُ
   * الموقع الحيّ تدور على جهاز العميل، ويبقى الصفُّ على خريطة العمليات إلى أن
   * تُصحّحهما لقطةٌ. ودلالةُ `ADR 0053` §٤-أ كانت تُلزم بالنشر أصلاً؛ فهذا
   * **إنفاذُ عقدٍ قائم لا تغييرُ عقدٍ**، ولا رقمَ جديداً ولا حدثاً جديداً.
   *
   * والنشرُ يسبق فتحَ الخَلَف بقصد: يرى المستهلك نهايةً ثم بداية، لا العكس.
   *
   * ويبقى صادقاً أنّ سائقاً لا يعود أبداً تبقى جلسته مفتوحةً في الجدول — وهي
   * صفٌّ لا يُقرأ نشطاً (السقف الزمني)، فلا يُضلّل العمليات ولا يُعطّل فهرس
   * الجلسة الواحدة، لأنّ الإصلاحة التالية من نفس السائق تُغلقه قبل أن تفتح.
   */
  const currentSession = async (
    driverId: string,
    nowMs: number,
    startAtMs: number,
  ): Promise<{ readonly record: TrackingSessionRecord; readonly opened: boolean }> => {
    const existing = await deps.sessions.openSessionOf(driverId);
    if (existing !== null && !acceptsFixes(existing.facts, nowMs, policy)) {
      await closeAndAnnounce(driverId, existing.facts.tripId, "EXPIRED", nowMs);
      log("tracking.session_expired", { driverId, startedAtMs: existing.facts.startedAtMs });
      const replacement = await deps.sessions.open(
        driverId,
        await deps.trips.activeTripOf(driverId),
        startAtMs,
      );
      return { record: replacement, opened: true };
    }

    if (existing === null) {
      /**
       * فتحُ الجلسةِ يقرأُ الرحلةَ قراءةً طازجةً **دائمًا**، ولا يستعملُ لقطةَ
       * الإصلاحةِ ولو كانت فارغة (الدفعة 19). فالنافذةُ بينَ اللقطةِ وعودةِ
       * `openSessionOf` تعملُ في الاتجاهين: رحلةٌ في اللقطةِ قد تنتهي فيها
       * (فبدءُ جلسةٍ عليها تسريبٌ يمنعُهُ `closeByTrip`)، ولقطةٌ فارغةٌ قد يقعُ
       * بعدَها إسنادٌ — وفتحُ الجلسةِ عندئذٍ على `null` ينشرُ `session_started`
       * وأولَ `location_updated` بلا رحلةٍ والإسنادُ قائمٌ، وهذا خلافُ المسارِ
       * المرجعيِّ على `main` (`tests/unit/live-tracking-open-race.test.ts` (ج)).
       * والكلفةُ قراءةٌ واحدةٌ في عمرِ الجلسةِ لا في كلِّ إصلاحة.
       */
      const trip = await deps.trips.activeTripOf(driverId);
      return { record: await deps.sessions.open(driverId, trip, startAtMs), opened: true };
    }

    /**
     * الرحلة تُراجَع في كل إصلاحة لا عند البدء وحده: السائق يُسنَد ويُنهي في
     * منتصف جلسة تتبّعٍ واحدة (يبدأ يومه متاحاً بلا رحلة، ثم رحلة، ثم أخرى).
     * وربطُها مرّةً واحدة كان سيُبقي الجلسة على رحلةٍ انتهت — فيستمرّ عميلُها
     * في رؤية السائق وهو في رحلة غيره. وهذا تسريبٌ لا تفصيل.
     *
     * وحكمُ الإرفاقِ هنا **بالقراءةِ المتأخرةِ كما في المسارِ الأصليِّ حرفيًا**،
     * لا بلقطةِ الإصلاحةِ: فالرحلةُ قد تنتهي أو يُعادَ إسنادُها في النافذةِ
     * بينَ اللقطةِ وهذه القراءةِ — وحتى لو تساوتِ اللقطةُ معَ رحلةِ الجلسةِ
     * (البقاءُ ظاهرُهُ السكونُ) فإنّ انتهاءَها هنا يفصلُ الربطَ فورًا كما في
     * الأصلِ. فتوحيدُ القراءةِ اقتصرَ على ما لا يمسُّ هذا الحكمَ: قراءةُ
     * الخدمةِ والرحلةِ في استعلامٍ واحدٍ عندَ البوّابةِ والفتحِ، وبقيتِ
     * القراءةُ المتأخرةُ للحكمِ على الإرفاقِ — فالمكسبُ المحسومُ هو جولةُ
     * الخدمةِ، لا السلامةُ.
     */
    const trip = await deps.trips.activeTripOf(driverId);
    if (trip !== existing.facts.tripId) {
      const attached = await deps.sessions.attachTrip(driverId, trip);
      if (attached !== null) return { record: attached, opened: false };
    }
    return { record: existing, opened: false };
  };

  return {
    onFix: (fix) =>
      guarded("onFix", async () => {
        const nowMs = deps.clock.now().getTime();

        /**
         * المرحلة ١٢ — بوّابة الخدمة **قبل** فتح الجلسة لا بعدها.
         *
         * الموقع القانوني حُفِظ قبل الوصول إلى هنا (ADR-0015)، ولا يُمسّ. والذي
         * يُمنع هو **الجلسة والبثّ**: أي أن يُعرض سائقٌ خارج الخدمة على خريطة
         * العمليات حيّاً، أو أن يُراقب موقعه وهو في وقته الخاص.
         *
         * والفرق مقصود: من يرسل موقعه ليصير متاحاً (والبوت يطلب منه ذلك صراحةً
         * في `driver.available_needs_location`) يجب أن يُحفظ موقعه ولو لم تُفتح له جلسة.
         */
        /**
         * الحالتان تُقرآن في لقطةٍ واحدةٍ عند توافر القارئ الموحّد: بوابة الخدمة
         * ورحلتُها النشطةُ حقيقةٌ واحدةٌ في لحظةٍ واحدة، وقراءتُهما في رحلتينِ
         * متتاليتينِ كانت تجمعُ بينهما طابورَ الانتظارِ نفسَهُ مرتينِ على كلِّ
         * إصلاحة — واللقطةُ الموحّدةُ أبعدُ عن التمزّقِ لا أقربُ: لا تُقرأُ
         * الحقيقةُ قبلَ الطابورِ وتُعادُ قراءتُهُ بعدَهُ فيختلفَ الحُكمُ بينهما.
         * ومن لا يوفّرُ القارئَ يبقى على القارئينِ كما كان حرفيًا.
         */
        const state =
          deps.dutyAndTrip !== undefined
            ? await deps.dutyAndTrip.dutyAndActiveTrip(fix.driverId)
            : {
                onDuty: await deps.duty.isOnDuty(fix.driverId),
                activeTripId: await deps.trips.activeTripOf(fix.driverId),
              };
        const duty: DriverDutyState = {
          isOnDuty: state.onDuty,
          hasActiveTrip: state.activeTripId !== null,
        };
        if (!sessionShouldRun(duty)) {
          const open = await deps.sessions.openSessionOf(fix.driverId);
          if (open !== null) {
            await closeAndAnnounce(fix.driverId, open.facts.tripId, "DRIVER_STOPPED", nowMs);
          }
          log("tracking.fix_off_duty", { driverId: fix.driverId });
          return;
        }

        /**
         * الجلسة تبدأ **بزمن الإصلاحة التي فتحتها** لا بزمن الخادم. وهذا ليس
         * تجميلاً: طابع تلغرام بالثواني، فزمن الجهاز يسبق زمن الخادم دائماً بجزءٍ
         * من الثانية إلى ثانية. ولو بدأت الجلسة بزمن الخادم لكانت أوّل إصلاحة
         * **أقدم من بداية جلستها** فترفضها آلة المجال (`FIX_BEFORE_SESSION_START`)
         * ويبقى `last_fix_at` فارغاً — أي جلسةٌ تُقرأ `STALE` من لحظة ولادتها،
         * وسائقٌ يُرسل موقعه كل ثانية ويظهر للعمليات منقطعاً. وهو عطلٌ كان
         * سيمرّ من كل اختبارٍ بساعةٍ واحدة، ولا يظهر إلا بساعتين مختلفتين.
         */
        const startAtMs = Math.min(nowMs, fix.recordedAtMs);
        const { record, opened } = await currentSession(fix.driverId, nowMs, startAtMs);
        const facts = record.facts;

        if (opened) {
          await publish({
            type: "session_started",
            driverId: fix.driverId,
            tripId: facts.tripId,
            sessionId: record.sessionId,
            /**
             * `ADR 0053` §٤-أ: «رقمُ الفتحِ هو أوّلُ أرقامِ القناةِ» — ومصدرُه الصفُّ
             * الذي أُدرِج للتوّ لا عدّادٌ ثانٍ. فالفتحُ والتقدُّمُ والإغلاقُ على عدّادٍ
             * واحدٍ، ولا يستطيع مستهلكٌ أن يرى حدثَ فتحٍ يسبقه حدثُ موقعٍ برقمٍ أدنى.
             */
            sequence: record.sequence,
            cityId: fix.cityId,
            position: null,
            timestamp: new Date(nowMs),
          });
        }

        /**
         * ## `BUG-009` — النشرُ صار تابعاً لقرارِ الكتابةِ، لا مستقلّاً عنه
         *
         * كان هذا الموضعُ ينشر `location_updated` **بلا شرطٍ**، ويُعلِّل ذلك بأنّ
         * «الموقع خُزِّن فعلاً وهو أفضل ما نعرف». والتعليلُ صحيحٌ في نصفِه وخاطئٌ في
         * نتيجتِه: الموقعُ خُزِّن نعم، لكنَّ الحدثَ ليس إخباراً بأنَّ شيئاً كُتِب — هو
         * أمرٌ للمستهلكِ أن **يُحرِّك الدبّوسَ**. فإصلاحةٌ وصلَت خارجَ ترتيبِها كانت
         * تُحرِّك خريطةَ العميلِ إلى الوراء وقد رفضَتها القاعدةُ في نفسِ اللحظةِ.
         *
         * فصار الحاكمُ واحداً: **إن لم تقبل الكتابةُ فلا نشرَ** (`ADR 0053` §٣-أ/٧).
         *
         * وحكمانِ متعاقبانِ لا حَكَمانِ متنافسان: آلةُ المجالِ تحكم على موضعِ
         * الإصلاحةِ من الجلسةِ (منتهيةٌ؟ أقدمُ من بدايتِها؟)، والقاعدةُ تحكم على
         * ترتيبِها بين أخواتِها وتُصدِر الرقمَ. والأولى شرطٌ للثانيةِ، والثانيةُ وحدَها
         * تُصدِر ما يُنشَر.
         *
         * ولا قاعدةَ أعمالٍ جديدةٌ هنا: `<` يرفض و`=` يُقبَل، وكلاهما في `SQL` في
         * `session-repository.ts` لا في هذا الملفِّ.
         */
        const advanced = recordFix(facts, fix.recordedAtMs, nowMs, policy);
        if (!advanced.ok) {
          log("tracking.fix_not_advanced", {
            driverId: fix.driverId,
            reason: advanced.error.reason,
          });
          return;
        }

        const outcome = await deps.sessions.advance(fix.driverId, fix.recordedAtMs);
        if (outcome.kind !== "accepted") {
          /**
           * `stale` = رفضٌ صريحٌ من القاعدةِ. و`no_session` = اختفت الجلسةُ بين
           * قراءتِها وتقديمِها (إغلاقٌ متزامنٌ). وكلتاهما: لا رقمَ فلا حدثَ.
           */
          log("tracking.fix_rejected", { driverId: fix.driverId, reason: outcome.kind });
          return;
        }

        await publish({
          type: "location_updated",
          driverId: fix.driverId,
          tripId: facts.tripId,
          sessionId: outcome.record.sessionId,
          sequence: outcome.record.sequence,
          cityId: fix.cityId,
          position: { lat: fix.latitude, lng: fix.longitude },
          timestamp: new Date(nowMs),
          metadata: {
            /**
             * `recordedAtMs` يبقى واقعةً زمنيّةً وصفيّةً — ساعةُ جهازِ السائقِ — ولا
             * يُقرأ ترتيباً. والترتيبُ في `sequence` أعلاه وحدَه.
             */
            recordedAtMs: fix.recordedAtMs,
            accuracy: fix.accuracyMeters,
            quality: fix.verdict,
            findings: fix.findings,
          },
        });
      }),

    onDutyEnded: (driverId) =>
      guarded("onDutyEnded", async () => {
        const nowMs = deps.clock.now().getTime();

        /**
         * الرحلة الجارية تغلب خروجَ الإتاحة: سائقٌ أوقف استقبال الطلبات وهو
         * يقود راكباً الآن لا تُقطع خريطة راكبه — وهو فعلٌ مشروع يفعله من يريد
         * أن تكون رحلته هذه الأخيرة في اليوم. وجلستُه تُغلق عند إنهاء الرحلة
         * بمسارها القائم (`onTripEnded`)، وإن لم يعد فأوّل إصلاحةٍ بعدها تجده خارج
         * الخدمة بلا رحلة فتُغلق. فلا مسار يبقى مفتوحاً بلا نهاية.
         */
        if ((await deps.trips.activeTripOf(driverId)) !== null) {
          log("tracking.duty_ended_trip_active", { driverId });
          return;
        }
        const open = await deps.sessions.openSessionOf(driverId);
        if (open === null) return;
        await closeAndAnnounce(driverId, open.facts.tripId, "DRIVER_STOPPED", nowMs);
      }),

    onTripEnded: (tripId, reason) =>
      guarded("onTripEnded", async () => {
        const nowMs = deps.clock.now().getTime();
        const closed = await deps.sessions.closeByTrip(tripId, reason, nowMs);
        /**
         * الحدث يُنشر لكل جلسة أُغلقت فعلاً — لا مرّةً واحدة عن الرحلة. المستهلك
         * يُغلق ما يخصّ سائقاً بعينه (رسالة موقعٍ حيّ تُوقَف، صفٌّ يُرفع من
         * الخريطة)، فحدثٌ بلا سائق لا يُنفَّذ عليه شيء.
         *
         * وإن لم تُغلق جلسة فلا حدث: رحلةٌ انتهت ولم يكن لسائقها جلسة تتبّع
         * واقعةٌ صحيحة (لم يُرسل موقعه قط)، وإعلانُ نهايةٍ لما لم يبدأ كذبٌ صغير
         * يُفسد أي حساب على مجرى الأحداث.
         */
        for (const session of closed) {
          await publish({
            type: "session_ended",
            driverId: session.facts.driverId,
            tripId,
            sessionId: session.sessionId,
            sequence: session.sequence,
            position: null,
            timestamp: new Date(nowMs),
            metadata: { reason },
          });
        }
      }),
  };
}
