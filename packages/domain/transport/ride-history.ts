/**
 * الغرض: نطاقُ سجلِّ رحلاتِ الراكبِ وتفاصيلِ الرحلةِ الواحدةِ — حكمُ حجمِ
 *   الصفحةِ، وحكمُ نصِّ البحثِ، **وتجميعُ الصفوفِ بالشهرِ بلا إعادةِ ترتيبٍ**،
 *   وتصنيفُ الثقةِ في المنطقةِ الزمنيّةِ، وتصنيفُ أنواعِ الأحداثِ
 *   (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: packages/domain/transport
 * يُستخدم من: `application/transport/{read-ride-history,read-ride-detail}.ts`
 *   و`apps/miniapp/src/surfaces/rider/history/ride-history-view.ts`
 *   و`scripts/lib/ride-history-contract.ts`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` (تصديرُ بياناتي) يُعيدُ استعمالَ التجميعِ
 *   بالشهرِ ولا يكتبُ تجميعاً ثانياً، و`SD-10` (سجلُّ رحلاتِ السائقِ) يُعيدُ
 *   استعمالَ حكمِ الصفحةِ والبحثِ بلا حرفٍ جديدٍ.
 * ملاحظات مستقبلية: **لا حقلَ أجرةٍ ولا مبلغٍ ولا وسيلةِ دفعٍ ولا خانةً لها**
 *   قبلَ `DEC-11` (`ADR 0039` §٤ · `م13-7`)؛ ومتى فُكَّ التجميدُ فالإيصالُ
 *   الماليُّ **مقولةٌ أُخرى** لها ملفُّها لا حقلٌ يُدَسُّ في بطاقةِ السجلِّ.
 *
 * ## لماذا التجميعُ بالشهرِ ههنا **ولا يُعيدُ ترتيباً**
 *
 * القاعدةُ رتَّبَت الصفوفَ نزولاً بمفتاحٍ حاسمٍ `(created_at, id)`، وحسبَت
 * `month_key` بمنطقةٍ **مُعلَنةٍ**. فوظيفةُ النطاقِ **طيُّ المتجاورِ** لا الفرزُ:
 * فرزٌ ثانٍ ههنا يعني ترتيبَينِ يفترقانِ عندَ أوّلِ تعادلٍ، ويعني أنَّ الصفحةَ
 * الثانيةَ قد تُدرَجُ فوقَ الأولى. **فالترتيبُ حكمُ القاعدةِ، والطيُّ حكمُ
 * النطاقِ**، ولا يتبادلانِ الدورَ.
 *
 * وأثرُه المقيسُ: مجموعةٌ واحدةٌ لكلِّ **تتابعٍ** من الشهرِ نفسِه. ولو عادَ
 * شهرٌ بعدَ شهرٍ (وهوَ مستحيلٌ في ترتيبٍ نازلٍ صحيحٍ) لَظهرَ مجموعتَينِ —
 * **وذاكَ مقصودٌ**: هوَ العَرَضُ الظاهرُ لعطبِ ترتيبٍ، لا يُخفيه النطاقُ بدمجٍ.
 *
 * ## ولماذا مفتاحُ الشهرِ نصٌّ `YYYY-MM` لا تاريخٌ
 *
 * لأنَّه **مُعرِّفُ مجموعةٍ لا لحظةٌ**. ولو كانَ تاريخاً لَحمَلَ يوماً وساعةً
 * لا معنى لهما فأُعيدَ تفسيرُهما بمنطقةٍ ثالثةٍ في المتصفِّحِ، ولَعادَ العنوانُ
 * يتبدَّلُ بإعدادِ جهازٍ — وهوَ نفسُ العطبِ الذي حُسِبَ الشهرُ في القاعدةِ فراراً
 * منه. والنصُّ يُترجَمُ إلى اسمِ شهرٍ في طبقةِ العرضِ بمعجمِ اللغةِ.
 *
 * ## ولماذا الثقةُ في المنطقةِ الزمنيّةِ **تصنيفٌ يُعرَضُ** لا تفصيلٌ داخليٌّ
 *
 * إن غابَ إعدادُ المدينةِ صُنِّفَت الرحلاتُ بـUTC، وعنوانُ الشهرِ حينَها **قد
 * يكونُ خاطئاً** لرحلةٍ وقعَت في الساعاتِ الأولى من أوّلِ الشهرِ. فالسطحُ يجبُ
 * أن يقولَ ذلكَ، ولا يعرضُ عنواناً واثقاً على تصنيفٍ يعرفُ الخادمُ أنَّه ظنِّيٌّ.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحسبُ أجرةً ولا يعرفُ مبلغاً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا يقرأُ ساعةً ولا يُحوِّلُ منطقةً**: التحويلُ في القاعدةِ مرّةً واحدةً،
 *      وتحويلٌ ثانٍ ههنا ساعةٌ ثالثةٌ في مقولةٍ لا تحتاجُها.
 *   ــ **لا يُصيغُ نصّاً ولا اسمَ شهرٍ**: النصُّ في `i18n`، وههنا مفاتيحُ ورموزٌ.
 *   ــ **لا يُرتِّبُ الأحداثَ**: ترتيبُها حكمُ القاعدةِ بأختامِها، وترتيبٌ ثانٍ
 *      ههنا يجعلُ حدثاً بلا وقتٍ يقفزُ إلى موضعٍ يُوحي بوقتٍ.
 *   ــ **لا يُصلِحُ صفّاً معطوباً صامتاً**: نوعُ حدثٍ لا يعرفُه يبقى كما هوَ
 *      مُصنَّفاً `UNKNOWN`، فيُعرَضُ خامّاً ولا يُسقَطُ من السجلِّ.
 */

/** حجمُ الصفحةِ حينَ لا يطلبُ العميلُ حجماً — مطابقٌ لافتراضِ دالّةِ القاعدةِ. */
export const DEFAULT_RIDE_HISTORY_PAGE_SIZE = 20;

/**
 * سقفُ الصفحةِ — **مطابقٌ حرفاً** لحدِّ `INVALID_LIMIT` في
 * `rider_ride_history`. وحاجزٌ ساكنٌ يُقابِلُ الرقمَينِ، لأنَّ افتراقَهما يعني
 * حدّاً يقبلُه العميلُ وترفضُه القاعدةُ فيُقرأُ عطباً لا رفضاً مفهوماً.
 */
export const MAX_RIDE_HISTORY_PAGE_SIZE = 50;

/**
 * سقفُ نصِّ البحثِ. وليسَ ذوقاً: النصُّ يدخلُ نمطَ `ilike` في القاعدةِ، ونصٌّ
 * بلا سقفٍ يُنتِجُ نمطاً يُمسَحُ به كلُّ صفٍّ من صفوفِ الراكبِ بلا فائدةٍ.
 */
export const MAX_RIDE_HISTORY_QUERY_LENGTH = 120;

/** رفضُ حجمِ الصفحةِ — رمزٌ واحدٌ صريحٌ، ولا يُقصَرُ الرقمُ صامتاً. */
export type RideHistoryPageSizeVerdict =
  | { readonly accepted: true; readonly limit: number }
  | { readonly accepted: false; readonly refusal: "INVALID_PAGE_SIZE" };

/**
 * يقرأُ حجمَ الصفحةِ من مُدخلٍ غيرِ موثوقٍ (مُعامِلُ استعلامٍ نصٌّ دائماً).
 *
 * والغيابُ **مقبولٌ** ويُعطي الافتراضَ. والرقمُ خارجَ المدى **يُرَدُّ ولا
 * يُقصَرُ**: مَن طلبَ ألفاً ثمَّ أُعطيَ خمسينَ بلا خبرٍ يظنُّ سجلَّه انتهى.
 */
export function readRideHistoryPageSize(value: unknown): RideHistoryPageSizeVerdict {
  if (value === undefined || value === null || value === "") {
    return { accepted: true, limit: DEFAULT_RIDE_HISTORY_PAGE_SIZE };
  }
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(raw)) return { accepted: false, refusal: "INVALID_PAGE_SIZE" };
  if (raw < 1 || raw > MAX_RIDE_HISTORY_PAGE_SIZE) {
    return { accepted: false, refusal: "INVALID_PAGE_SIZE" };
  }
  return { accepted: true, limit: raw };
}

export type RideHistoryQueryVerdict =
  | { readonly accepted: true; readonly query: string | null }
  | { readonly accepted: false; readonly refusal: "QUERY_TOO_LONG" };

/**
 * يقرأُ نصَّ البحثِ. والفراغُ **ليسَ بحثاً**: يُطبَّعُ إلى `null` فلا يُرسَلُ
 * إلى القاعدةِ شرطٌ يُطابِقُ كلَّ شيءٍ. والطولُ يُقاسُ **بعدَ** التشذيبِ:
 * مئةُ فراغٍ ليست بحثاً طويلاً.
 */
export function readRideHistoryQuery(value: unknown): RideHistoryQueryVerdict {
  if (value === undefined || value === null) return { accepted: true, query: null };
  if (typeof value !== "string") return { accepted: false, refusal: "QUERY_TOO_LONG" };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { accepted: true, query: null };
  if (trimmed.length > MAX_RIDE_HISTORY_QUERY_LENGTH) {
    return { accepted: false, refusal: "QUERY_TOO_LONG" };
  }
  return { accepted: true, query: trimmed };
}

/**
 * ثقةُ عنوانِ الشهرِ.
 *
 * `DECLARED` = صُنِّفَ بمنطقةِ المدينةِ المُعلَنةِ. و`FALLBACK` = صُنِّفَ بـUTC
 * لأنَّ الإعدادَ غائبٌ أو اسمُه مجهولٌ — **والعنوانُ حينَها ظنِّيٌّ لرحلاتِ
 * الساعاتِ الأولى من الشهرِ**، ويُقالُ ذلكَ للراكبِ ولا يُطوى.
 */
export type MonthTimezoneTrust = "DECLARED" | "FALLBACK";

export function monthTimezoneTrustOf(source: string): MonthTimezoneTrust {
  return source === "CITY_SETTING" ? "DECLARED" : "FALLBACK";
}

/** صفُّ السجلِّ كما يُجمَعُ — **بلا أيِّ حقلٍ ماليٍّ**. */
export interface RideHistoryRow {
  readonly orderId: string;
  readonly status: string;
  readonly service: string;
  readonly pickupLabel: string | null;
  readonly dropoffLabel: string | null;
  readonly createdAtMs: number;
  readonly completedAtMs: number | null;
  /** مُعرِّفُ المجموعةِ `YYYY-MM` كما حسبَته القاعدةُ بمنطقةٍ مُعلَنةٍ. */
  readonly monthKey: string;
}

export interface RideHistoryMonthGroup {
  readonly monthKey: string;
  readonly rides: readonly RideHistoryRow[];
}

/**
 * يطوي المتتابعَ من الشهرِ نفسِه في مجموعةٍ واحدةٍ — **بترتيبِ الورودِ**.
 *
 * ولا يفرزُ ولا يدمجُ متباعداً: انظر رأسَ الملفِّ. والصفوفُ الفارغةُ تُعطي
 * مجموعاتٍ فارغةً لا مجموعةً بلا صفوفٍ.
 */
export function groupRidesByMonth(
  rides: readonly RideHistoryRow[],
): readonly RideHistoryMonthGroup[] {
  const groups: { monthKey: string; rides: RideHistoryRow[] }[] = [];
  for (const ride of rides) {
    const last = groups.at(-1);
    if (last !== undefined && last.monthKey === ride.monthKey) {
      last.rides.push(ride);
      continue;
    }
    groups.push({ monthKey: ride.monthKey, rides: [ride] });
  }
  return groups;
}

/**
 * أنواعُ أحداثِ الرحلةِ التي **لها أثرٌ مكتوبٌ** في القاعدةِ اليومَ.
 *
 * ولا يُزادُ نوعٌ ههنا قبلَ أن يُكتَبَ أثرُه: نوعٌ بلا مصدرٍ يعني نصّاً
 * مُترجَماً في `i18n` لا يُعرَضُ أبداً، ثمَّ يُقرأُ يوماً وعداً بحدثٍ لا يُسجَّلُ.
 */
export const RIDE_EVENT_KINDS = [
  "REQUESTED",
  "MATCHED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type RideEventKind = (typeof RIDE_EVENT_KINDS)[number];

export function isRideEventKind(value: unknown): value is RideEventKind {
  return typeof value === "string" && (RIDE_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * حدثٌ في سجلِّ الرحلةِ.
 *
 * و`atMs === null` **غيابُ ختمٍ لا لحظةُ الصفرِ**: يقعُ للإلغاءِ الذي لم يُكتَبْ
 * له صفُّ تدقيقٍ. والمصدرُ منشورٌ كي يُراجَعَ الحدثُ في نزاعٍ.
 */
export interface RideEvent {
  readonly kind: RideEventKind | "UNKNOWN";
  /** النوعُ الخامُّ كما نشرَته القاعدةُ — يُعرَضُ حينَ يكونُ النوعُ `UNKNOWN`. */
  readonly rawKind: string;
  readonly atMs: number | null;
  readonly source: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * تصنيفُ حالةِ الرحلةِ للعرضِ — **ثلاثُ نتائجَ لا اثنتانِ**.
 *
 * و«جاريةٌ» ليست «انتهت» وليست «لم تتمَّ»: بطاقةٌ في السجلِّ لرحلةٍ ما زالت
 * تجري يجبُ أن تقودَ إلى شاشةِ المُتابَعةِ لا إلى تفاصيلَ ساكنةٍ. والحالةُ
 * المجهولةُ تُصنَّفُ `OTHER` **ولا تُطوى في «انتهت»**: حالةٌ جديدةٌ في القاعدةِ
 * أضعفُ ضرراً معروضةً خامّاً من مُصنَّفةٍ خطأً.
 */
export type RideOutcomeClass = "IN_FLIGHT" | "COMPLETED" | "NOT_COMPLETED" | "OTHER";

export function rideOutcomeClassOf(status: string): RideOutcomeClass {
  if (
    status === "scheduled" ||
    status === "searching" ||
    status === "matched" ||
    status === "in_progress"
  ) {
    return "IN_FLIGHT";
  }
  if (status === "completed") return "COMPLETED";
  if (status === "cancelled" || status === "failed") return "NOT_COMPLETED";
  return "OTHER";
}
