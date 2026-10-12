/**
 * الغرض: المنافذ (Ports) — العقود الوحيدة التي تُخاطب بها طبقة التطبيق العالم الخارجي.
 *   لا تنفيذ هنا إطلاقاً: التنفيذ الحقيقي في packages/infrastructure، والمزدوجات في tests/support.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (عقود/أنواع فقط، بلا منطق).
 * ينتمي إلى: application/ports
 * يُتوقع أن يستخدمه لاحقاً: كل حالات الاستخدام في packages/application، وكل محوّل في packages/infrastructure
 * ملاحظات مستقبلية: كل منفذ يعيد Result، ولا يرمي استثناءً لخطأ متوقَّع (القسم 2.5).
 */

import type { DriverCandidate } from "../../domain/dispatch/entity.ts";
import type { Offer } from "../../domain/dispatch/value-objects.ts";
import type { Coordinates } from "../../domain/geo/value-objects.ts";
import type { RawSetting } from "../../domain/policy/entity.ts";
import type { Order } from "../../domain/transport/entity.ts";
import type { CityId, DriverId, OrderId } from "../../shared/kernel/index.ts";
import type { Result } from "../../shared/result/index.ts";

/** خطأ منفذ: عطل تقني (شبكة/قاعدة)، لا خطأ أعمال. */
export class PortFailureError {
  readonly code = "PORT_FAILURE" as const;
  constructor(
    readonly port: string,
    readonly detail: string,
  ) {}
}

export interface SettingsRepository {
  /** كل صفوف platform_settings لمدينة واحدة، خاماً بلا تفسير. */
  findByCity(cityId: CityId): Promise<Result<readonly RawSetting[], PortFailureError>>;
}

export interface OrderRepository {
  findById(orderId: OrderId): Promise<Result<Order | null, PortFailureError>>;
}

export interface OfferRepository {
  /** عروض الطلب كلها، بكل الدورات، لحساب من يُستبعد من الدورة القادمة. */
  findByOrder(orderId: OrderId): Promise<Result<readonly Offer[], PortFailureError>>;
}

export interface DriverCandidateRepository {
  /**
   * السائقون المرشَّحون مبدئياً في المدينة: متاحون وموثَّقون ومواقعهم حديثة.
   * الفلترة النهائية والترتيب مسؤولية الدومين لا المستودع.
   *
   * مسارٌ تشخيصيٌّ فقط بعد CAP-003: لا يُستدعى في التشغيل الطبيعي، بل حين تُفرغُ
   * النافذةُ القريبة من المؤهَّلين فيُرجَع إليه لبناء قائمة الرفض المُسبَّبة كاملةً
   * — لا ليعيد تحميلَ كلّ السائقين في المسار الساخن.
   */
  findAvailableInCity(
    cityId: CityId,
  ): Promise<Result<readonly DriverCandidate[], PortFailureError>>;

  /**
   * CAP-003 — المسار السريع: استعلام PostGIS واحد يُرجعُ المرشّحين القريبين
   * المؤهَّلين بالبوابات الصلبة (المدينة، الحجب، التوثيق، التوفّر، القربُ بـ
   * `ST_DWithin`، وعمرُ الموقع إن فُعّل) مرتّبين بالمسافة عبر فهرس GiST، ومحدودين
   * بـ`limit`. والخدمةُ والاشتراكُ يُتركانِ للدومين بعدَ النافذة.
   *
   * سائقٌ `last_location = NULL` لا يدخلُ هذا المسار: `ST_DWithin` على NULL يُرجعُ
   * NULL فيُستبعدُ صامتاً — وهذا مقصودٌ في المسار السريع، فمن بلا موقع لا معنىَ
   * لقياسِ بُعدِه. وإن فرغتِ النافذةُ يُرجعُ `matchOrder` إلى `findAvailableInCity`
   * كي يظهرَ السائقُ بلا موقع في `rejected` بسببه المُسمّى `NO_LOCATION` — الرؤيةُ
   * التشغيليّةُ التي قصدها الفريق لا تُفقد، تُؤجَّلُ للمسار التشخيصي وحده.
   */
  findNearbyAvailableForDispatch(
    args: NearbyCandidateQuery,
  ): Promise<Result<readonly DriverCandidate[], PortFailureError>>;
}

/**
 * معاملاتُ استعلام المرشّحين القريبين. كلُّ قيمةٍ تأتي من `matchOrder` بلا افتراضٍ
 * هنا: نصفُ القطرِ وعمرُ الموقعِ وحدُّ النافذةِ كلُّها إعداداتٌ للمدينة لا ثوابت.
 */
export interface NearbyCandidateQuery {
  readonly cityId: CityId;
  /** نقطةُ الانطلاق للطلب. */
  readonly pickup: Coordinates;
  /** نصفُ القطرِ بالكيلومتر — يُحوَّل إلى متر في SQL. */
  readonly searchRadiusKm: number;
  /**
   * أقصى عمرٍ مقبولٍ للموقع بالثواني. صفرٌ أو غيابٌ يُعطّلُ فحصَ القِدَم — وهو
   * المبذور، فيطابقُ سلوكَ ما قبل CAP-003 بحرفه.
   */
  readonly driverLocationMaxAgeSeconds?: number;
  /** حدُّ النافذة — إعدادُ `matching_candidate_limit` للمدينة. */
  readonly limit: number;
  /** زمنُ الخادم للفحص الزمني — يُمرَّر من `Clock` لا من `now()` في SQL. */
  readonly now: Date;
}

/**
 * هويّةُ الراكب كما تقرؤها `claim_ride` داخل معاملة الإسناد نفسها (§4.2).
 *
 * ولماذا تُحمَل في ردّ الإسناد لا تُقرأ باستعلامٍ ثانٍ بعده؟ لأنّ بين الإسناد
 * والاستعلام الثاني نافذةً يتغيّر فيها الحال — يُلغى الطلب أو تُغيَّر اللغة —
 * فيُخطَر الراكبُ بلغةٍ ليست لغته أو عن طلبٍ لم يبقَ. والقراءةُ في المعاملة
 * تُغلق النافذة بلا قفلٍ إضافي.
 */
export interface ClaimedRider {
  readonly riderId: string;
  /** معرّفُ تلغرام نصّاً: منافذُ الإرسال كلّها تأخذ نصّاً، والتحويل هنا مرّةً واحدة. */
  readonly telegramId: string;
  readonly languageCode: string;
  readonly fullName: string;
}

/**
 * ردُّ الإسناد. الحقول المضافة كلُّها قابلةٌ للغياب (`null`) لأنّ الإخطار تحسينٌ
 * لا شرطٌ: راكبٌ بصفٍّ ناقص لا يُبطِل إسناداً وقع فعلاً في القاعدة.
 */
export interface ClaimRideResult {
  readonly claimed: boolean;
  /**
   * `BUG-008` — هذا النداءُ إعادةُ تسليمٍ لنقرةِ الفائزِ نفسِه لا إسنادٌ جديد.
   * الإسنادُ قائمٌ لهذا السائقِ من قبل، فالجوابُ نجاحٌ، والآثارُ الجانبيّةُ
   * (إخطارُ الراكب، عدّادُ القبول) لا تُعاد. ويُقرَأُ من القاعدةِ لا من ذاكرةِ
   * العمليّة: `orders.assigned_driver_id` هو الحَكَم.
   */
  readonly duplicate: boolean;
  readonly reason: string | null;
  readonly cityId: CityId | null;
  readonly rider: ClaimedRider | null;
  readonly driverName: string | null;
  readonly driverPlate: string | null;
  readonly driverVehicle: string | null;
  /**
   * `WR-09` — القبولُ حجزَ الطلبَ مرشَّحاً ينتظرُ قرارَ الراكب، ولم يُسنِدْه بعد.
   * غيابُه (`undefined`) يُقرأُ إسناداً فوريّاً كما كان قبلَ البند.
   */
  readonly pendingRider?: boolean;
  /** موعدُ قرارِ الراكبِ من ساعةِ القاعدة (ISO)، حينَ `pendingRider`. */
  readonly candidateExpiresAt?: string | null;
}

/** إسناد العرض ذرّياً — يقابل الدالة claim_ride في القاعدة. */
export interface DispatchRpcPort {
  claimRide(
    orderId: OrderId,
    driverId: DriverId,
  ): Promise<Result<ClaimRideResult, PortFailureError>>;
}
