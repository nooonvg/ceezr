/**
 * الغرض: قلب المطابقة — فلترة المرشحين، معادلة النقاط، الترتيب، واختيار دفعة البثّ.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (القسم 3.3 من الأمر الحاكم).
 * ينتمي إلى: domain/dispatch
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/match-order، apps/gateway، apps/workers
 * ملاحظات مستقبلية: كل الأوزان والحدود تُمرَّر من الخارج (مصدرها platform_settings).
 *   ممنوع منعاً باتاً كتابة أي وزن أو نصف قطر أو حجم دفعة داخل هذا الملف.
 */

import type { CityId, DriverId, ServiceType } from "../../shared/kernel/index.ts";
import type { DriverCapability } from "../capability/entity.ts";
import { canServe } from "../capability/entity.ts";
import { haversineKm, proximityFactor } from "../geo/index.ts";
import type { Coordinates, DistanceKm } from "../geo/value-objects.ts";
import { effectiveRating, normalizeRating } from "../reputation/entity.ts";
import { MAX_STARS } from "../reputation/value-objects.ts";
import type { Subscription } from "../subscription/entity.ts";
import { coversService } from "../subscription/entity.ts";

/**
 * الحد الأعلى لمقياس التقييم. مصدره وحدة reputation وحدها: مقياسان مختلفان في
 * وحدتين يعنيان ترتيباً خاطئاً صامتاً يوم يتغيّر أحدهما.
 */
export const MAX_RATING = MAX_STARS;

export interface MatchingParameters {
  /** platform_settings.search_radius_km */
  readonly searchRadiusKm: DistanceKm;
  /** platform_settings.match_weight_proximity */
  readonly weightProximity: number;
  /** platform_settings.match_weight_rating */
  readonly weightRating: number;
  /**
   * platform_settings.match_weight_preferred_area — البند 2.4.
   *
   * صفرٌ يعني «تجاهل المنطقة المفضّلة تماماً»، وهو المبذور في كل مدينة اليوم،
   * فالمعادلة بلا تفعيلٍ صريح هي معادلة ما قبل هذا البند بحرفها.
   */
  readonly weightPreferredArea: number;
  /**
   * platform_settings.driver_location_max_age_seconds — المرحلة ٨.
   *
   * صفرٌ يعني تعطيل الفحص، وهو المبذور في كل مدينة قصداً. واختيارية الحقل
   * (`?`) ليست تراخياً بل منعٌ لكسرٍ استدعائي: المعاملات تُبنى في مواضعٍ
   * عدة (منها اختبارات قائمة)، وجعلُه إلزامياً كان سيُجبِر كل موضعٍ على كتابة
   * قيمة — والغالب أن تُكتب رقماً عشوائياً ليمرّ المُترجِم، فيصير الحَرَس
   * مُفعّلاً بقيمةٍ لم يقررها أحد. والغياب يُقرأ تعطيلاً — وهو السلوك القائم.
   */
  readonly driverLocationMaxAgeSeconds?: number;
  /** platform_settings.broadcast_batch_size */
  readonly broadcastBatchSize: number;
  /** platform_settings.default_rating_for_new_driver */
  readonly defaultRating: number;
  /** platform_settings.rating_min_count_for_trust */
  readonly ratingMinCountForTrust: number;
}

export interface DriverCandidate {
  readonly driverId: DriverId;
  readonly cityId: CityId;
  /**
   * آخر موقع ورد من السائق، أو `null` إن لم يرسل موقعاً قطّ.
   *
   * السماح بـ`null` ليس تراخياً بل تصحيح عطب إنتاجي مُقاس: كان استعلام المرشّحين
   * يشترط `d.last_location is not null` في SQL، فكان السائق بلا موقع **يختفي قبل أن
   * يراه الدومين**، فلا يظهر في `rejected` بسبب مُسمّى: لا للمشغّل ولا في سجلّ
   * `NoEligibleDriverError`. وقع هذا فعلاً: سائق موثّق ومتاح ومشترك في المدينة
   * الصحيحة، ولم يصله طلب واحد، والإدارة ترى «لا مرشّحين» بلا أي سبب.
   *
   * البديل القديم كان أسوأ من الإخفاء: المحوّل كان يقرأ `Number(lat ?? 0)` فيُنتج
   * إحداثية (0,0) — نقطة في المحيط الأطلسي — وهي كذبة تُحسَب فيها مسافة حقيقية.
   * الغياب يُمثّل غياباً لا صفراً.
   */
  readonly location: Coordinates | null;
  /**
   * متى **وصلنا** هذا الموقع (`drivers.last_location_at`، زمن الخادم)، أو `null`
   * لمن لا موقع له أو لصفٍّ قديم كُتِب قبل أن يوجد العمود — المرحلة ٨.
   *
   * وليس `last_location_recorded_at` (طابع الجهاز) قصداً: السؤال هنا «متى عرفنا؟»
   * لا «متى يقول إنه كان؟». وطابع الجهاز مُدخَلٌ من الخارج: سائقٌ ساعتُه متقدمة
   * ساعةً يبدو موقعُه أحدثَ من كل من حوله إلى الأبد، فيصير الحَرَس ميزةً لمن
   * ساعتُه خاطئة لا حمايةً للعميل.
   */
  readonly locationAtMs?: number | null;
  /**
   * `WR-23` — حكمُ مُقيِّمِ GPS على هذا الموقعِ كما خُزِّن (`drivers.last_location_quality`).
   * `ALERT` قفزةٌ أو سرعةٌ غيرُ معقولة: الموقعُ لا يُرتَّبُ به ولا يُقاسُ منه قربٌ. و`WARNING`
   * (دقّةٌ خشنةٌ أو طابعٌ متأخّر) موقعٌ صحيحٌ متدهوِّرٌ يبقى. والغيابُ (صفٌّ أقدمُ من الحكم)
   * لا يُختلَقُ له حكم، وحارسُ القِدَمِ يكفيه.
   */
  readonly locationQuality?: "ACCEPT" | "WARNING" | "ALERT" | null;
  /**
   * مركز المنطقة التي يفضّل السائق العمل فيها، أو `null` لمن لا منطقة له —
   * وهي حال كل سائق قائم اليوم (البند 2.4).
   *
   * تُقرأ من `drivers.preferred_area_location`، وهي **غير** `location`: الأولى
   * نيّةٌ ثابتة يعلنها السائق مرّة، والثانية أين هو الآن. سائقٌ يسكن حيّاً ويعمل
   * فيه قد يمرّ عابراً بحيٍّ بعيد، فيصير بموقعه اللحظي أقرب مرشّح لذلك الحيّ
   * ويُبعَد عن حيّه — وهذا الفصل هو ما يمنعه.
   */
  readonly preferredArea?: Coordinates | null;
  readonly isAvailable: boolean;
  readonly isVerified: boolean;
  /**
   * `users.is_blocked`. المحجوب لا يُسنَد إليه شيء.
   *
   * الحقل هنا لا في الاستعلام وحده: لو اكتُفي بشرط في SQL لصار الحجب قاعدة
   * قاعدة بيانات لا قاعدة عمل، فلا يظهر في أسباب الرفض ولا يُختبَر في الطبقة
   * التي تملك القرار. وقد كان الحجب قبل ذلك مسجَّلاً وغير نافذ لهذا السبب.
   */
  readonly isBlocked: boolean;
  readonly ratingAverage: number | null;
  /** عدد التقييمات غير المُعلَّمة — بلا عدد لا يُعرف هل المتوسط يُعتدّ به. */
  readonly ratingCount: number;
  readonly capabilities: readonly DriverCapability[];
  readonly subscription: Subscription | null;
}

export interface OrderContext {
  readonly cityId: CityId;
  readonly service: ServiceType;
  readonly pickup: Coordinates;
  /** السائقون المستبعدون من هذه الدورة (رفضوا أو انتهت مهلتهم سابقاً). */
  readonly excludedDriverIds: readonly DriverId[];
}

export type RejectionReason =
  | "CITY_MISMATCH"
  | "BLOCKED"
  | "NOT_VERIFIED"
  | "NOT_AVAILABLE"
  /** متاح وموثّق لكنّه لم يرسل موقعاً قطّ — لا يمكن حساب مسافته، والسبب يُسمّى لا يُخفى. */
  | "NO_LOCATION"
  /**
   * المرحلة ٨ — له موقع، ولكنّ عمره تجاوز المقبول في إعدادات المدينة.
   *
   * سببٌ منفصل عن `NO_LOCATION` لا تفريعاً تجميلياً: الأول يقول للمشغّل «لم يرسل
   * موقعاً قطّ» والعلاج تعليمٌ أو دعم، والثاني يقول «أرسل ثم انقطع» والعلاج
   * تنبيهٌ أو مراجعةُ توفّرِه. ودمجُهما في سببٍ واحد يُضيع هذا الفرق في أول موضع
   * يُقرأ فيه السبب: لوحة العمليات وسجلّ `NoEligibleDriverError`.
   */
  | "STALE_LOCATION"
  /** `WR-23` — آخرُ موقعٍ له حكمُه `ALERT` (قفزةٌ أو سرعةٌ غيرُ معقولة): لا يُرتَّبُ به. */
  | "UNTRUSTED_LOCATION"
  | "SERVICE_NOT_ENABLED"
  | "NO_LIVE_SUBSCRIPTION"
  | "OUT_OF_RADIUS"
  | "EXCLUDED_THIS_ROUND";

export interface ScoredCandidate {
  readonly driverId: DriverId;
  readonly distanceKm: DistanceKm;
  readonly score: number;
  /** التقييم الذي دخل المعادلة فعلاً — يُبيّن هل رُتّب بمتوسطه أم بالافتراضي. */
  readonly effectiveRating: number;
  /**
   * عامل المنطقة المفضّلة الذي دخل المعادلة — البند 2.4. يُعرَض في النتيجة لا
   * يُخفى: بلا كشفه لا يُعرف هل صعد السائق بمنطقته أم بقربه، وضبطُ الوزن يصير
   * تخميناً على نتيجةٍ لا تُفسَّر.
   */
  readonly preferredAreaFactor: number;
  readonly ratingCount: number;
}

export interface CandidateEvaluation {
  readonly eligible: readonly ScoredCandidate[];
  readonly rejected: readonly { readonly driverId: DriverId; readonly reason: RejectionReason }[];
}

/**
 * سبب استبعاد المرشح، أو null إن كان مؤهلاً.
 * الترتيب مقصود: الأرخص فحصاً أولاً، والمسافة أخيراً.
 */
export function rejectionReasonFor(
  candidate: DriverCandidate,
  order: OrderContext,
  params: MatchingParameters,
  now: Date,
): RejectionReason | null {
  if (candidate.cityId !== order.cityId) return "CITY_MISMATCH";
  if (order.excludedDriverIds.includes(candidate.driverId)) return "EXCLUDED_THIS_ROUND";
  // الحجب قبل التحقّق والتوافر: هو أشدّ الأسباب، فلا يُحجب سببُه بسبب أهون
  if (candidate.isBlocked) return "BLOCKED";
  if (!candidate.isVerified) return "NOT_VERIFIED";
  if (!candidate.isAvailable) return "NOT_AVAILABLE";
  /**
   * موضعه بعد التوفّر وقبل القدرة مقصود: فحص `null` أرخص من فحص القدرات،
   * والسبب أولى بالإبلاغ: سائقٌ أعلن توفّره وينقصه الموقع ينتظر عملاً ولا يأتيه،
   * وهو أحقّ بأن يُطالَب بموقعه من أن يُقال له إن خدمته غير مُفعّلة.
   */
  if (candidate.location === null) return "NO_LOCATION";
  if (isLocationStale(candidate, params, now)) return "STALE_LOCATION";
  if (candidate.locationQuality === "ALERT") return "UNTRUSTED_LOCATION";
  if (!canServe(candidate.capabilities, order.service)) return "SERVICE_NOT_ENABLED";
  if (candidate.subscription === null) return "NO_LIVE_SUBSCRIPTION";
  if (!coversService(candidate.subscription, order.service, now)) return "NO_LIVE_SUBSCRIPTION";
  if (haversineKm(order.pickup, candidate.location) > params.searchRadiusKm) {
    // المسافة أخيراً: أغلى الفحوص حساباً.
    return "OUT_OF_RADIUS";
  }
  return null;
}

/**
 * هل موقعُ المرشّح أقدمُ من المقبول؟ — المرحلة ٨.
 *
 * دالةٌ مفصولة ومُصدَّرة لأن السؤال يُطرح في أكثر من موضع (الإسناد اليوم، وقراءات
 * العمليات لاحقاً)، وتكرارُ الشرط في موضعين يعني مصدرًي حقيقة لمفهومٍ واحد.
 *
 * ## ثلاث قرارات في ثلاثة أسطر
 *
 * ١. **التعطيل بالصفر أو بالغياب**: وهو المبذور، فالسلوك بلا تفعيلٍ صريح
 *    هو سلوك ما قبل المرحلة ٨ بحرفه.
 * ٢. **طابعٌ مفقود مع وجود موقع = قديم** حين يكون الفحص مُفعّلاً. والبديل
 *    (افتراضُ أنه حديث) كان سيجعل أي صفٍّ فقد طابعَه يتجاوز الحَرَس إلى الأبد
 *    وهو أخطر ما يمرّ: ثغرةٌ لا تُرى لأن نتيجتها «كل شيءٍ على ما يرام».
 *    و«لا نعلم متى» ليس «نعلم أنه الآن».
 * ٣. **طابعٌ في المستقبل ليس قديماً**: الفرق موقَّع لا مطلق، فالسالب يمرّ — والطابع
 *    المستقبلي ممكنٌ بفروق ساعات الخوادم، ولا يجوز أن يُسقِط سائقاً موقعُه وصل الآن.
 */
export function isLocationStale(
  candidate: Pick<DriverCandidate, "location" | "locationAtMs">,
  params: Pick<MatchingParameters, "driverLocationMaxAgeSeconds">,
  now: Date,
): boolean {
  const maxAgeSeconds = params.driverLocationMaxAgeSeconds ?? 0;
  if (maxAgeSeconds <= 0) return false;
  if (candidate.location === null) return false;
  const atMs = candidate.locationAtMs;
  if (atMs === null || atMs === undefined || !Number.isFinite(atMs)) return true;
  /**
   * فرقٌ **موقَّع** بلا `Math.abs` ولا حصرٍ في الصفر: الطابع المستقبلي يعطي فرقاً
   * سالباً، والسالب أصغر من أي حدٍّ موجب فيمرّ من تلقاء نفسه. و`Math.abs` كانت
   * ستقلب المستقبل قِدَماً فتُسقِط سائقاً موقعُه وصل الآن لأن ساعة خادمٍ متأخّرة
   * ثانيتين — ولذلك يُقاس هذا في اختبار، لا يُترك للحظّ.
   *
   * وحصرُ الفرق في الصفر (`Math.max(0, …)`) كان موجوداً ثم حُذف: فحصُ تحويرٍ أثبت
   * أن حذفه لا يُسقِط اختباراً واحداً، أي أنه سطرٌ لا يفعل شيئاً — والحرَس الذي
   * لا يُقاس أثرُه ليس حرَساً بل زينة.
   */
  return (now.getTime() - atMs) / 1000 > maxAgeSeconds;
}

/**
 * معادلة النقاط (القسم 3.3.2):
 *   score = (وزن القرب × دالة القرب) + (وزن التقييم × التقييم المعياري)
 * كلا المكوّنين في مدى [0,1]، فتبقى النتيجة قابلة للتفسير والمقارنة.
 */
export function scoreCandidate(
  distanceKm: DistanceKm,
  ratingAverage: number | null,
  params: MatchingParameters,
  ratingCount = 0,
  preferredAreaFactorValue = 0,
): number {
  const proximity = proximityFactor(distanceKm, params.searchRadiusKm);
  const rating = effectiveRating(
    { average: ratingAverage, count: ratingCount },
    params.ratingMinCountForTrust,
    params.defaultRating,
  );
  return (
    params.weightProximity * proximity +
    params.weightRating * normalizeRating(rating) +
    params.weightPreferredArea * preferredAreaFactorValue
  );
}

/**
 * قُرب **نقطة الالتقاط** من منطقة السائق المفضّلة، في المدى [0,1] — البند 2.4.
 *
 * تُقاس بنفس `proximityFactor` ونفس نصف قطر البحث لا بمقياس ثانٍ: مقياسان
 * مختلفان في معادلة واحدة يجعلان الوزنين غير قابلين للمقارنة، فيصير ضبط
 * الأوزان في لوحة الإدارة تخميناً.
 *
 * ومن لا منطقة له يأخذ صفراً لا نصفاً ولا واحداً: الواحد يجعل الجميع مفضَّلين
 * فلا معنى للوزن، والصفر يقول الحقيقة — «لا نعلم عنه شيئاً في هذا العامل».
 * وهو غير ضارٍّ ما دام الوزن صفراً كما هو مبذور في كل مدينة.
 */
export function preferredAreaFactor(
  preferredArea: Coordinates | null | undefined,
  pickup: Coordinates,
  radiusKm: DistanceKm,
): number {
  if (preferredArea === null || preferredArea === undefined) return 0;
  return proximityFactor(haversineKm(pickup, preferredArea), radiusKm);
}

/** تقييم كل المرشحين: المؤهلون مرتَّبون تنازلياً بالنقاط، والمستبعدون بأسبابهم. */
export function evaluateCandidates(
  candidates: readonly DriverCandidate[],
  order: OrderContext,
  params: MatchingParameters,
  now: Date,
): CandidateEvaluation {
  const eligible: ScoredCandidate[] = [];
  const rejected: { driverId: DriverId; reason: RejectionReason }[] = [];

  for (const candidate of candidates) {
    const reason = rejectionReasonFor(candidate, order, params, now);
    // الشرط الثاني تضييق نوعي لا فحص مكرَّر: `rejectionReasonFor` تُعيد `NO_LOCATION`
    // عند غياب الموقع، لكن TypeScript لا يستنتج ذلك من قيمة راجعة، وإسكاته بـ`as`
    // يعني أن أي تغيير مستقبلي في ترتيب الأسباب يمرّ صامتاً ثم يُحسب من (0,0).
    if (reason !== null || candidate.location === null) {
      rejected.push({ driverId: candidate.driverId, reason: reason ?? "NO_LOCATION" });
      continue;
    }
    const distanceKm = haversineKm(order.pickup, candidate.location);
    const snapshot = { average: candidate.ratingAverage, count: candidate.ratingCount };
    const areaFactor = preferredAreaFactor(
      candidate.preferredArea,
      order.pickup,
      params.searchRadiusKm,
    );
    eligible.push({
      driverId: candidate.driverId,
      distanceKm,
      preferredAreaFactor: areaFactor,
      score: scoreCandidate(
        distanceKm,
        candidate.ratingAverage,
        params,
        candidate.ratingCount,
        areaFactor,
      ),
      effectiveRating: effectiveRating(
        snapshot,
        params.ratingMinCountForTrust,
        params.defaultRating,
      ),
      ratingCount: candidate.ratingCount,
    });
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // كسر التعادل بالأقرب، ثم بالمعرّف لضمان ترتيب حتمي قابل للاختبار
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return a.driverId < b.driverId ? -1 : a.driverId > b.driverId ? 1 : 0;
  });

  return { eligible, rejected };
}

/** دفعة البثّ: أفضل N مرشح، وحجم الدفعة من platform_settings. */
export function selectBroadcastBatch(
  evaluation: CandidateEvaluation,
  params: MatchingParameters,
): readonly ScoredCandidate[] {
  const size = Math.max(0, Math.trunc(params.broadcastBatchSize));
  return evaluation.eligible.slice(0, size);
}
