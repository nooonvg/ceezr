/**
 * الغرض: سياسة «من يرى موقع من» — المرحلة ٦.
 *   نقيّة تماماً: لا قاعدة، ولا ساعة تُقرأ، ولا شبكة. تُعطى البرهان فتحكم.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: domain/tracking
 * يُتوقع أن يستخدمه: packages/application/tracking/watch-driver.ts وناقل الأحداث.
 *
 * ## لماذا التصريح سياسةٌ في المجال لا شرطٌ في المسار
 *
 * الإغراء أن يُكتب `if (order.rider_id === viewer)` داخل معالج الاشتراك. وهو
 * خطأ يظهر عند المستهلك الثاني: للتتبّع اللحظي عندنا مستهلكان — العميل على
 * تلغرام، والعمليات على اللوحة — ولكلٍّ منهما مسارٌ ونقلٌ مختلف تماماً. فشرطٌ
 * مكتوب في مسار العميل لا يسري على مسار العمليات، فيُكتب مرّةً ثانية بمفرداتٍ
 * أخرى، ثم تتباعد النسختان عند أول تعديل — وهذا هو تسريب البيانات كما يقع
 * فعلاً: لا باختراقٍ بل بتشعّبِ شرطَين كانا واحداً.
 *
 * ## ولماذا البرهان يُمرَّر ولا يُلتقط من العميل
 *
 * كل ما يصل من العميل تهمة لا برهان: معرّف الرحلة الذي يُرسله لا يُثبت أنه
 * صاحبها، ومعرّف السائق لا يُثبت أنه المُسنَد إليها. فالدالة هنا لا تقبل إلا
 * برهاناً **قُرئ من القاعدة** (`TripAssignmentProof`)، وتُقارن به ما ادّعاه
 * الطالب. ومن يُمرّر إليها ما وصل من الشبكة يُفسد الحكم لا الدالة.
 */

/** حالة الطلب كما تُقرأ من القاعدة — نفس مفردات orders.status. */
export type WatchedTripStatus =
  | "scheduled"
  | "searching"
  | "matched"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

/**
 * البرهان: صفٌّ حقيقي من `orders` كما هو الآن. ليس مُدخلاً من الطالب.
 * `driverId` قد يكون `null` — طلبٌ لم يُسنَد بعد.
 */
export interface TripAssignmentProof {
  readonly tripId: string;
  readonly riderId: string;
  readonly driverId: string | null;
  readonly status: WatchedTripStatus;
  readonly cityId: string;
}

/** موضوع المراقبة: السائق المطلوب رؤيته، وسياقه كما هو في القاعدة. */
export interface WatchSubject {
  readonly driverId: string;
  readonly cityId: string;
}

export type WatchDenyReason =
  /** لا رحلة بهذا المعرّف أصلاً. لا نُفرّق للطالب بين هذا و«ليست رحلتك». */
  | "TRIP_NOT_FOUND"
  /** الرحلة قائمة لكنها ليست لهذا الراكب. */
  | "NOT_TRIP_OWNER"
  /** انتهت أو أُلغيت: لا موقع لحظي بعد نهاية الرحلة. */
  | "TRIP_NOT_LIVE"
  /** لم يُسنَد سائق بعد: لا شيء يُتابَع. */
  | "DRIVER_NOT_ASSIGNED"
  /** الرحلة صحيحة ومملوكة، لكن السائق المطلوب ليس سائقها. */
  | "DRIVER_MISMATCH"
  /** مشغّل مدينةٍ يطلب سائق مدينةٍ أخرى. */
  | "CITY_MISMATCH";

export type WatchDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: WatchDenyReason };

const ALLOW: WatchDecision = { allowed: true };

function deny(reason: WatchDenyReason): WatchDecision {
  return { allowed: false, reason };
}

/**
 * الرحلة «حيّة» في حالتين فقط: أُسنِدت ولم تبدأ، أو بدأت. و`searching` ليست
 * منها: لا سائق فيها يُتابَع. وما بعد النهاية ليس منها لأن استمرار العميل في
 * رؤية موقع السائق بعد نزوله تتبّعٌ لشخصٍ لا علاقة له به — وهو أخطر ما في هذه
 * الميزة كلّها، لا مجرّد بيانات زائدة.
 */
export function isTripLive(status: WatchedTripStatus): boolean {
  return status === "matched" || status === "in_progress";
}

/**
 * حكم العميل. `claimedTripId`/`claimedDriverId` ما ادّعاه الطالب، و`proof` ما
 * في القاعدة. ويُقارن الاثنان حرفاً بحرف: كل تساهلٍ هنا يصير قناةً لرؤية سائق
 * رحلةٍ أخرى بتخمين معرّف.
 */
export function canCustomerWatch(
  viewerRiderId: string,
  claimedDriverId: string,
  proof: TripAssignmentProof | null,
): WatchDecision {
  if (proof === null) return deny("TRIP_NOT_FOUND");
  if (proof.riderId !== viewerRiderId) return deny("NOT_TRIP_OWNER");
  if (!isTripLive(proof.status)) return deny("TRIP_NOT_LIVE");
  if (proof.driverId === null) return deny("DRIVER_NOT_ASSIGNED");
  if (proof.driverId !== claimedDriverId) return deny("DRIVER_MISMATCH");
  return ALLOW;
}

/**
 * نطاق مشاهدة العمليات: كل المدن، أو مدينة بعينها.
 *
 * وهذا **مُرشِّح عرضٍ لا حدُّ صلاحية**، والتفريق مهمّ: صلاحية المشاهدة في هذا
 * المستودع هي «جلسة لوحة إدارة صالحة» — كذلك تعمل كل نماذج القراءة القائمة في
 * `admin/queries.ts`: المشغّل يختار المدينة من قائمة (`?city=`) ويقرأ أيّها شاء.
 *
 * ولو جعلنا التتبّع اللحظي وحده محدوداً بـ`SessionIdentity.cityId` لصار في
 * المنصّة **نموذجا تصريحٍ متعارضان** لنفس البيانات: مشغّل يرى طلبات مدينةٍ في
 * صفحة الطلبات الحيّة ولا يرى سائقيها على الخريطة. وهذا ما تنهى عنه القاعدة ٧.
 *
 * وحين تُضاف رتبةُ «مشغّل مدينة» فعلاً — بجدولٍ يمنح ويُنزع ويُدقَّق — يصير
 * هذا النوع مبنيّاً على ذلك الجدول، ويتغيّر موضعٌ واحد لا موضعان.
 */
export type OperationsWatchScope =
  | { readonly kind: "all_cities" }
  | { readonly kind: "city"; readonly cityId: string };

/**
 * حكم العمليات. المشغّل لا يحتاج رحلةً ليرى سائقاً — عمله متابعة الأسطول — ولا
 * يُقيَّد إلا بالنطاق الذي طلبه هو.
 */
export function canOperationsWatch(
  scope: OperationsWatchScope,
  subject: WatchSubject,
): WatchDecision {
  if (scope.kind === "all_cities") return ALLOW;
  return scope.cityId === subject.cityId ? ALLOW : deny("CITY_MISMATCH");
}

/**
 * حكم السائق على نفسه. موجود لأن الغياب كان سيُقرأ لاحقاً على أنه منعٌ مقصود،
 * والسائق يرى موقعه في تطبيقه بلا وسيطٍ أصلاً.
 */
export function canDriverWatch(viewerDriverId: string, claimedDriverId: string): WatchDecision {
  return viewerDriverId === claimedDriverId ? ALLOW : deny("DRIVER_MISMATCH");
}
