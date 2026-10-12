/**
 * الغرض: نماذج القراءة التي تغذّي صفحات لوحة الإدارة. كل دالّة هنا استعلام واحد
 *   يعيد ما تعرضه صفحة واحدة بالضبط — لا ORM ولا طبقة تجريد ثالثة: اللوحة تقرأ
 *   ولا تُغيّر حالة أعمال، وأفعالها الكتابية الثلاثة تمرّ بدوالّ ذرّية لا من هنا.
 * الحالة: منفّذ فعلياً — المرحلة 2.7 (القسم د.1).
 * ينتمي إلى: apps/gateway/src/admin
 * يُتوقع أن يستخدمه لاحقاً: routes/admin-ui.ts، routes/admin-api.ts
 * ملاحظات مستقبلية: عند ثقل أي استعلام يُستبدل بـ materialized view يُحدَّث بجوب،
 *   بلا تغيير في توقيع الدالّة.
 */

import {
  ADMIN_METRIC_WINDOW_HOURS,
  type MetricSnapshotRow,
  type MetricTotals,
  type MetricTruthStamp,
  metricTruthStamp,
  sumMetricRows,
} from "../../../../packages/domain/admin/metric-snapshot.ts";
import {
  type OperationsFacts,
  type OperationsStatus,
  operationsStatusOf,
} from "../../../../packages/domain/tracking/operations-status.ts";
import type { Sql } from "../../../../packages/infrastructure/db/client.ts";
import type {
  AttendanceEvent,
  AttendanceSummaryRow,
  AuditEntry,
  CityOption,
  DisputeRow,
  DriverDetail,
  DriverDetailPoint,
  DriverRow,
  HealthIndicator,
  HeatCell,
  LiveOrderRow,
  OverviewCounters,
  RatingRow,
  SettingRow,
} from "../../../admin-dashboard/src/index.ts";

/**
 * نافذةُ الحصيلةِ اليوميةِ بالساعاتِ. **تُقرأُ من النطاقِ ولا تُكتبُ رقماً
 * ثانياً** (`F7-08`): العاملُ يكتبُ اللقطةَ لنافذةٍ، والبوابةُ تقرأُ
 * لنافذةٍ؛ فرقمانِ متقاربانِ في ملفَّينِ ينزلقانِ في تعديلٍ واحدٍ فتُقرَأُ
 * اللوحةُ **فارغةً أبداً** بلا أن يسقطَ شيءٌ.
 *
 * وبقيَ الاسمُ مُصدَراً لأنَّ المساراتِ تستوردُهُ وليسَ تغييرُ اسمٍ من عملِ
 * البندِ؛ والقيمةُ واحدةٌ لا نسختانِ.
 */
export const DAY_WINDOW_HOURS = ADMIN_METRIC_WINDOW_HOURS;
export const ATTENDANCE_WINDOWS: readonly number[] = [6, 12, 24, 72, 168];
export const HEATMAP_WINDOWS: readonly number[] = [1, 3, 6, 12, 24];
export const DRIVERS_LIMIT = 200;
export const EVENTS_LIMIT = 200;
export const RATINGS_LIMIT = 200;
export const DISPUTES_LIMIT = 200;
export const SEARCH_LIMIT = 8;

export interface CityRecord extends CityOption {
  readonly isActive: boolean;
  /** المعرفات تُعاد نصوصاً كي لا تفقد دقة bigint في JavaScript. */
  readonly supportGroupId: string | null;
  readonly escalationGroupId: string | null;
  readonly unsubscribedDriversGroupId: string | null;
  /**
   * رابطُ قروب السائقين غير المشتركين من `platform_settings` لا من `cities`: هو
   * إعدادٌ لكلّ مدينة، ومعرّفُ القروب لا يكفي — البوت يُرسل المعرّفَ ولا يستطيع
   * السائقُ الضغطَ عليه. مدينةٌ بمعرّفٍ بلا رابطٍ تُريه بطاقةَ انتهاءٍ بلا مدخل.
   */
  readonly unsubscribedGroupLink: string | null;
}

export async function listCities(sql: Sql): Promise<readonly CityRecord[]> {
  const rows = await sql<
    {
      id: string;
      code: string;
      name_ar: string;
      is_active: boolean;
      telegram_support_group_id: string | null;
      telegram_escalation_group_id: string | null;
      telegram_unsubscribed_drivers_group_id: string | null;
      unsubscribed_group_link: string | null;
    }[]
  >`
    select c.id, c.code, c.name_ar, c.is_active,
           c.telegram_support_group_id::text,
           c.telegram_escalation_group_id::text,
           c.telegram_unsubscribed_drivers_group_id::text,
           nullif(btrim(coalesce(link.value #>> '{}', '')), '') as unsubscribed_group_link
      from cities c
      left join platform_settings link
        on link.city_id = c.id
       and link.key = 'unsubscribed_drivers_group_link'
     order by c.code
  `;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.name_ar,
    isActive: row.is_active,
    supportGroupId: row.telegram_support_group_id,
    escalationGroupId: row.telegram_escalation_group_id,
    unsubscribedDriversGroupId: row.telegram_unsubscribed_drivers_group_id,
    unsubscribedGroupLink: row.unsubscribed_group_link,
  }));
}

/**
 * قيمة عددية من platform_settings. حين لا تُحدَّد مدينة نأخذ الأكبر عبر المدن:
 * عتبة تحذير موحّدة يجب أن تكون الأكثر تسامحاً، وإلا ظهر طلب سليم في مدينة
 * إعداداتها أوسع وكأنه متعثّر.
 */
export async function numericSetting(
  sql: Sql,
  key: string,
  cityId: string | null,
  fallback: number,
): Promise<number> {
  const rows = await sql<{ value: number | null }[]>`
    select max((value #>> '{}')::numeric)::float8 as value
    from platform_settings
    where key = ${key}
      and value_type = 'number'
      ${cityId === null ? sql`` : sql`and city_id = ${cityId}::uuid`}
  `;
  const value = rows[0]?.value;
  return value === null || value === undefined || !Number.isFinite(value) ? fallback : value;
}

/** الحدّ الافتراضي لعتبة التعثّر حين تغيب الإعدادات: دقيقتان بلا إسناد. */
export const STALL_FALLBACK_SECONDS = 120;
export const LOW_RATING_FALLBACK = 2;
export const HEATMAP_CELL_FALLBACK_DEGREES = 0.01;

/**
 * عتبة اعتبار الطلب متعثّراً: مهلة العرض مضروبة في عدد الدورات المسموح بها.
 * طلب تجاوزها لم يعد ينتظر دورةً قادمة، بل توقف عنده شيء.
 */
/**
 * `SEC-21`: اعتمادُ البابِ الموازي للمسؤولِ الحاليِّ — لعرضِ حالِهِ في صفحةِ
 * البابِ فحسبُ. قراءةٌ مباشرةٌ بلا دالّةٍ متسلِّطةٍ: عمودانِ لا سرَّ فيهما
 * (`login_name` · `is_active`) والسرُّانِ المُشفَّرانِ لا يُختارانِ أصلًا.
 */
export async function adminBreakGlassCredential(
  sql: Sql,
  userId: string,
): Promise<{ loginName: string; isActive: boolean } | null> {
  const rows = await sql<{ login_name: string; is_active: boolean }[]>`
    select login_name, is_active from admin_break_glass_credentials
    where user_id = ${userId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return { loginName: row.login_name, isActive: row.is_active };
}

export async function stallSeconds(sql: Sql, cityId: string | null): Promise<number> {
  const timeout = await numericSetting(sql, "offer_timeout_seconds", cityId, 0);
  const rounds = await numericSetting(sql, "max_broadcast_rounds", cityId, 0);
  const computed = timeout * rounds;
  return computed > 0 ? computed : STALL_FALLBACK_SECONDS;
}

// ---------------------------------------------------------------------------
// النظرة العامة
// ---------------------------------------------------------------------------

/**
 * ## قراءةُ لوحةِ النظرةِ العامّةِ — `F7-08` · `CAP-011`
 *
 * كانتْ هذه الصفحةُ تُقاسُ بسبعةَ عشرَ استعلاماً على الجداولِ الرئيسةِ عندَ كلِّ
 * فتحةٍ (أربعةَ عشرَ عدّاداً في `overviewCounters` وثلاثةٌ × عددِ المدنِ في
 * `cityPulse`)، وهيَ تُحدَّثُ ذاتيّاً كلَّ ثوانٍ — فمُشغِّلٌ واحدٌ يفتحُها كانَ
 * يمسحُ `orders` كلَّها مِراراً في الدقيقةِ. وهذا عينُ `CAP-011`.
 *
 * فصارتِ القراءةُ **استعلاماً واحداً** على `admin_metric_snapshots` يُخرِجُ:
 * صفّاً لكلِّ مدينةٍ (نبضُ المدنِ)، ومنه تُجمَعُ حصيلةُ المنصّةِ في الذاكرةِ
 * بدوالِّ النطاقِ الخالصةِ، ومعَه **سياسةُ الصدقِ** (عتبةُ التقادُمِ وإذنُ السقوطِ
 * إلى الحيِّ) في `CTE` واحدٍ لا في استعلامٍ ثانٍ.
 *
 * وثلاثةُ أحكامٍ ههنا لا تُنقَضُ:
 *
 *   ١. **لا رقمَ بلا وَسْمِه**: كلُّ عائدٍ يحملُ `MetricTruthStamp` (المصدرُ،
 *      زمنُ القياسِ، العمرُ، التقادُمُ، المقيسُ من المتوقَّعِ) — كما لا يُنشَرُ
 *      موضِعُ سائقٍ بلا عُمرِه في `F4-05`.
 *   ٢. **السقوطُ إلى المسحِ الحيِّ مُعلَنٌ لا صامتٌ**: لا يجري إلّا بإذنِ
 *      `admin_overview_live_fallback_enabled` (افتراضُه `false`)، **وحينَ لا لقطةَ
 *      ألبتّةَ** لا حينَ تقادَمَتْ. لقطةٌ متقادِمةٌ تُنشَرُ بعُمرِها؛ واستبدالُها
 *      بمسحٍ ثقيلٍ هوَ الحِملُ الذي جاءَ البندُ يرفعُه.
 *   ٣. **بلا إذنٍ وبلا لقطةٍ تُقالُ عدمُ الإتاحةِ**: أصفارٌ تُقرَأُ «هدوءٌ» وهذا
 *      كذبٌ؛ فتُعادُ الأصفارُ **مقرونةً بوَسْمٍ يقولُ صراحةً إنّها غيرُ مقيسةٍ**.
 */

/** صفٌّ خامٌ كما يعودُ من الاستعلامِ الواحدِ: مدينةٌ ولقطتُها (أو غيابُها) والسياسةُ. */
interface OverviewSnapshotRow {
  readonly city_id: string;
  readonly code: string;
  readonly name_ar: string;
  readonly is_active: boolean;
  readonly window_hours: number | null;
  readonly computed_at: string | null;
  readonly searching_orders: number | null;
  readonly matched_orders: number | null;
  readonly in_progress_orders: number | null;
  readonly available_drivers: number | null;
  readonly verified_drivers: number | null;
  readonly pending_drivers: number | null;
  readonly active_subscriptions: number | null;
  readonly trial_subscriptions: number | null;
  readonly open_tickets: number | null;
  readonly completed_orders_window: number | null;
  readonly failed_orders_window: number | null;
  readonly cancelled_orders_window: number | null;
  readonly match_seconds_sum: number | null;
  readonly match_seconds_count: number | null;
  readonly rating_stars_sum: number | null;
  readonly rating_count: number | null;
  readonly stale_after_seconds: number | null;
  readonly live_fallback: boolean | null;
}

/**
 * نبضُ مدينةٍ. والعدَّاداتُ **قابلةٌ للغيابِ** (`null`) لأنَّ مدينةً بلا لقطةٍ
 * «لم تُقَسْ» وليستْ «صفراً»: الأولى عطبٌ في الشوطِ، والثانيةُ هدوءٌ حقيقيٌّ،
 * وعرضُهما بنفسِ الشكلِ يُخفي الأوّلَ خلفَ الثاني.
 */
export interface CityPulseRow {
  readonly code: string;
  readonly nameAr: string;
  readonly isActive: boolean;
  readonly liveOrders: number | null;
  readonly availableDrivers: number | null;
  readonly openTickets: number | null;
}

export interface AdminOverviewReading {
  readonly counters: OverviewCounters;
  readonly cities: readonly CityPulseRow[];
  readonly stamp: MetricTruthStamp;
}

/** يقرأُ عدَداً قد يعودُ نصّاً من `numeric`؛ وغيرُ الرقمِ **غيابٌ** لا صفرٌ. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSnapshotRow(row: OverviewSnapshotRow, windowHours: number): MetricSnapshotRow | null {
  if (row.computed_at === null) return null;
  return {
    cityId: row.city_id,
    windowHours: row.window_hours ?? windowHours,
    computedAt: String(row.computed_at),
    searchingOrders: numberOrNull(row.searching_orders) ?? 0,
    matchedOrders: numberOrNull(row.matched_orders) ?? 0,
    inProgressOrders: numberOrNull(row.in_progress_orders) ?? 0,
    availableDrivers: numberOrNull(row.available_drivers) ?? 0,
    verifiedDrivers: numberOrNull(row.verified_drivers) ?? 0,
    pendingDrivers: numberOrNull(row.pending_drivers) ?? 0,
    activeSubscriptions: numberOrNull(row.active_subscriptions) ?? 0,
    trialSubscriptions: numberOrNull(row.trial_subscriptions) ?? 0,
    openTickets: numberOrNull(row.open_tickets) ?? 0,
    completedOrdersWindow: numberOrNull(row.completed_orders_window) ?? 0,
    failedOrdersWindow: numberOrNull(row.failed_orders_window) ?? 0,
    cancelledOrdersWindow: numberOrNull(row.cancelled_orders_window) ?? 0,
    matchSecondsSum: numberOrNull(row.match_seconds_sum) ?? 0,
    matchSecondsCount: numberOrNull(row.match_seconds_count) ?? 0,
    ratingStarsSum: numberOrNull(row.rating_stars_sum) ?? 0,
    ratingCount: numberOrNull(row.rating_count) ?? 0,
  };
}

function countersOf(totals: MetricTotals): OverviewCounters {
  return {
    searchingOrders: totals.searchingOrders,
    matchedOrders: totals.matchedOrders,
    inProgressOrders: totals.inProgressOrders,
    availableDrivers: totals.availableDrivers,
    verifiedDrivers: totals.verifiedDrivers,
    pendingDrivers: totals.pendingDrivers,
    activeSubscriptions: totals.activeSubscriptions,
    trialSubscriptions: totals.trialSubscriptions,
    openTickets: totals.openTickets,
    completedOrdersDay: totals.completedOrdersWindow,
    failedOrdersDay: totals.failedOrdersWindow,
    cancelledOrdersDay: totals.cancelledOrdersWindow,
    averageMatchSeconds: totals.matchSeconds.average,
    averageDriverRating: totals.driverRating.average,
  };
}

/**
 * قراءةُ الصفحةِ كلِّها. `observedAt` **يُمرَّرُ** ولا يُقرأُ ههنا: العمرُ يُحسَبُ
 * على لحظةٍ واحدةٍ للصفحةِ بأسرِها، فلا تختلفُ أعمارُ بطاقاتٍ على شاشةٍ واحدةٍ.
 */
export async function adminOverviewReading(
  sql: Sql,
  windowHours: number,
  observedAt: Date,
): Promise<AdminOverviewReading> {
  const rows = await sql<OverviewSnapshotRow[]>`
    with policy as (
      select
        (
          select min((value)::numeric)::float8
          from platform_settings
          where key = 'admin_metrics_stale_after_seconds'
            and jsonb_typeof(value) = 'number'
        ) as stale_after_seconds,
        (
          select bool_and((value)::boolean)
          from platform_settings
          where key = 'admin_overview_live_fallback_enabled'
            and jsonb_typeof(value) = 'boolean'
        ) as live_fallback
    )
    select
      c.id::text as city_id, c.code, c.name_ar, c.is_active,
      s.window_hours, s.computed_at,
      s.searching_orders, s.matched_orders, s.in_progress_orders,
      s.available_drivers, s.verified_drivers, s.pending_drivers,
      s.active_subscriptions, s.trial_subscriptions, s.open_tickets,
      s.completed_orders_window, s.failed_orders_window, s.cancelled_orders_window,
      s.match_seconds_sum, s.match_seconds_count, s.rating_stars_sum, s.rating_count,
      p.stale_after_seconds, p.live_fallback
    from cities c
    cross join policy p
    left join admin_metric_snapshots s
      on s.city_id = c.id and s.window_hours = ${windowHours}::integer
    order by c.code
  `;

  /**
   * العتبةُ **تُؤخَذُ أصغرَ المدنِ** (`min`): وَسْمُ المنصّةِ حكمٌ واحدٌ على مجموعٍ
   * من مدنٍ لكلٍّ عتبتُها، فأخذُ الأكبرِ يجعلُ مدينةً متسامحةً تُسكِتُ تحذيرَ
   * الباقياتِ. وغيابُ الإعدادِ يُمرَّرُ صفراً — والنطاقُ يحكمُ عليهِ بالتقادُمِ
   * لا بالسلامةِ (فشلٌ مغلَقٌ).
   */
  const staleAfterSeconds = numberOrNull(rows[0]?.stale_after_seconds) ?? 0;
  /**
   * والإذنُ **يُؤخَذُ بـ`bool_and`**: المسحُ الحيُّ يضربُ الجداولَ الرئيسةَ لكلِّ
   * المدنِ معاً، فلا تأذَنُ مدينةٌ بحِملٍ يقعُ على غيرِها. وغيابُ الإعدادِ منعٌ.
   */
  const liveFallbackAllowed = rows[0]?.live_fallback === true;

  const citiesExpected = rows.length;
  const snapshotRows: MetricSnapshotRow[] = [];
  const cities: CityPulseRow[] = [];
  for (const row of rows) {
    const snapshot = toSnapshotRow(row, windowHours);
    if (snapshot !== null) snapshotRows.push(snapshot);
    cities.push({
      code: row.code,
      nameAr: row.name_ar,
      isActive: row.is_active,
      liveOrders:
        snapshot === null
          ? null
          : snapshot.searchingOrders + snapshot.matchedOrders + snapshot.inProgressOrders,
      availableDrivers: snapshot?.availableDrivers ?? null,
      openTickets: snapshot?.openTickets ?? null,
    });
  }

  if (snapshotRows.length === 0 && liveFallbackAllowed) {
    const [live, pulse] = await Promise.all([
      overviewCountersLive(sql, windowHours),
      cityPulseLive(sql),
    ]);
    return {
      counters: live,
      cities: pulse,
      /**
       * المسحُ الحيُّ مقيسٌ **الآنَ**: عمرُه صفرٌ وليسَ متقادِماً — لكنَّ مصدرَه
       * يُنشَرُ `live` كي يُقرأَ الحِملُ في اللوحةِ لا يُخفى وراءَ كلمةِ «محدَّثٌ».
       */
      stamp: {
        source: "live",
        computedAt: observedAt.toISOString(),
        ageSeconds: 0,
        isStale: false,
        staleAfterSeconds,
        citiesMeasured: pulse.length,
        citiesExpected: pulse.length,
      },
    };
  }

  return {
    counters: countersOf(sumMetricRows(snapshotRows)),
    cities,
    stamp: metricTruthStamp({
      source: "snapshot",
      rows: snapshotRows,
      observedAt,
      staleAfterSeconds,
      citiesExpected,
    }),
  };
}

/**
 * المسحُ الحيُّ للعدَّاداتِ — **مسارُ سقوطٍ لا مسارٌ معتادٌ**. سبعةَ عشرَ استعلاماً
 * فرعيّاً على الجداولِ الرئيسةِ: يُستدعى بإذنٍ صريحٍ فقط (انظرْ أعلاه)، وبقيَ
 * قائماً لأنَّ حذفَه يجعلُ أوّلَ إقلاعٍ قبلَ أوّلِ شوطٍ لوحةً فارغةً بلا مخرجٍ.
 */
export async function overviewCountersLive(
  sql: Sql,
  windowHours: number,
): Promise<OverviewCounters> {
  const rows = await sql<
    {
      searching: number;
      matched: number;
      in_progress: number;
      available_drivers: number;
      verified_drivers: number;
      pending_drivers: number;
      active_subscriptions: number;
      trial_subscriptions: number;
      open_tickets: number;
      completed_day: number;
      failed_day: number;
      cancelled_day: number;
      avg_match_seconds: number | null;
      avg_driver_rating: number | null;
    }[]
  >`
    with window_bounds as (
      select now() - make_interval(hours => ${windowHours}::integer) as since
    )
    select
      (select count(*) from orders where status = 'searching')::int as searching,
      (select count(*) from orders where status = 'matched')::int as matched,
      (select count(*) from orders where status = 'in_progress')::int as in_progress,
      (select count(*) from driver_availability where is_available)::int as available_drivers,
      (select count(*) from drivers where verification_status = 'verified')::int
        as verified_drivers,
      (select count(*) from drivers where verification_status = 'pending')::int
        as pending_drivers,
      (select count(*) from subscriptions where status = 'active')::int as active_subscriptions,
      (select count(*) from subscriptions where status = 'trialing')::int as trial_subscriptions,
      (select count(*) from support_tickets where status in ('open', 'claimed'))::int
        as open_tickets,
      (select count(*) from orders, window_bounds
        where status = 'completed' and completed_at >= window_bounds.since)::int as completed_day,
      (select count(*) from orders, window_bounds
        where status = 'failed' and updated_at >= window_bounds.since)::int as failed_day,
      (select count(*) from orders, window_bounds
        where status = 'cancelled' and updated_at >= window_bounds.since)::int as cancelled_day,
      (select avg(extract(epoch from (matched_at - created_at)))::float8
         from orders, window_bounds
        where matched_at is not null and matched_at >= window_bounds.since) as avg_match_seconds,
      (select avg(stars)::float8 from ratings, window_bounds
        where direction = 'rider_to_driver' and is_flagged = false
          and created_at >= window_bounds.since) as avg_driver_rating
  `;

  const row = rows[0];
  return {
    searchingOrders: row?.searching ?? 0,
    matchedOrders: row?.matched ?? 0,
    inProgressOrders: row?.in_progress ?? 0,
    availableDrivers: row?.available_drivers ?? 0,
    verifiedDrivers: row?.verified_drivers ?? 0,
    pendingDrivers: row?.pending_drivers ?? 0,
    activeSubscriptions: row?.active_subscriptions ?? 0,
    trialSubscriptions: row?.trial_subscriptions ?? 0,
    openTickets: row?.open_tickets ?? 0,
    completedOrdersDay: row?.completed_day ?? 0,
    failedOrdersDay: row?.failed_day ?? 0,
    cancelledOrdersDay: row?.cancelled_day ?? 0,
    averageMatchSeconds: row?.avg_match_seconds ?? null,
    averageDriverRating: row?.avg_driver_rating ?? null,
  };
}

/**
 * نبضُ المدنِ بمسحٍ حيٍّ — ثلاثةُ عدّاداتٍ × عددُ المدنِ. **مسارُ سقوطٍ** بنفسِ
 * الإذنِ والشرطِ، ولذا يُستدعى معَ `overviewCountersLive` لا وحدَه: عدَّاداتُ
 * منصّةٍ من لقطةٍ ونبضُ مدنٍ من مسحٍ حيٍّ رقمانِ من زمنَينِ في شاشةٍ واحدةٍ.
 */
export async function cityPulseLive(sql: Sql): Promise<readonly CityPulseRow[]> {
  const rows = await sql<
    {
      code: string;
      name_ar: string;
      is_active: boolean;
      live_orders: number;
      available_drivers: number;
      open_tickets: number;
    }[]
  >`
    select
      c.code, c.name_ar, c.is_active,
      (select count(*) from orders o
        where o.city_id = c.id and o.status in ('searching', 'matched', 'in_progress'))::int
        as live_orders,
      (select count(*) from driver_availability da
        where da.city_id = c.id and da.is_available)::int as available_drivers,
      (select count(*) from support_tickets t
        where t.city_id = c.id and t.status in ('open', 'claimed'))::int as open_tickets
    from cities c
    order by c.code
  `;
  return rows.map((row) => ({
    code: row.code,
    nameAr: row.name_ar,
    isActive: row.is_active,
    liveOrders: row.live_orders,
    availableDrivers: row.available_drivers,
    openTickets: row.open_tickets,
  }));
}

export async function recentAudit(sql: Sql, limit: number): Promise<readonly AuditEntry[]> {
  const rows = await sql<
    { created_at: string; action: string; entity_type: string; actor_name: string | null }[]
  >`
    select a.created_at, a.action, a.entity_type, u.full_name as actor_name
    from audit_log a
    left join users u on u.id = a.actor_user_id
    order by a.created_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    createdAt: String(row.created_at),
    action: row.action,
    entityType: row.entity_type,
    actorName: row.actor_name,
  }));
}

export interface HealthSignals {
  /** زمن استجابة استعلام تافه على القاعدة بالميلي ثانية. */
  readonly databaseLatencyMs: number;
  /** عروض انتهت صلاحيتها ولم يُغلقها أحد — دليل توقّف الجوب الدوري. */
  readonly staleOffers: number;
  /** طلبات تفاوض تجاوزت مهلتها بلا تدوير. */
  readonly staleNegotiations: number;
  /** طلبات تبحث منذ أطول من عتبة التعثّر. */
  readonly stalledOrders: number;
  /** مدن غير مفعّلة (لم تُربط قروباتها). */
  readonly inactiveCities: number;
  /** سائقون متاحون بلا موقع مسجَّل — لا يظهرون في المطابقة بالقرب. */
  readonly availableWithoutLocation: number;
}

export async function healthSignals(sql: Sql, stallAfterSeconds: number): Promise<HealthSignals> {
  const startedAt = Date.now();
  const rows = await sql<
    {
      stale_offers: number;
      stale_negotiations: number;
      stalled_orders: number;
      inactive_cities: number;
      available_without_location: number;
    }[]
  >`
    select
      (select count(*) from order_offers
        where status = 'pending' and expires_at < now())::int as stale_offers,
      (select count(*) from unsubscribed_negotiations
        where status = 'negotiating' and negotiate_deadline is not null
          and negotiate_deadline < now())::int as stale_negotiations,
      (select count(*) from orders
        where status = 'searching'
          and coalesce(searching_since, created_at) < now() - make_interval(secs => ${stallAfterSeconds}::float8))::int
        as stalled_orders,
      (select count(*) from cities where is_active = false)::int as inactive_cities,
      (select count(*) from driver_availability da
         join drivers d on d.id = da.driver_id
        where da.is_available and d.last_location is null)::int as available_without_location
  `;
  const row = rows[0];
  return {
    databaseLatencyMs: Date.now() - startedAt,
    staleOffers: row?.stale_offers ?? 0,
    staleNegotiations: row?.stale_negotiations ?? 0,
    stalledOrders: row?.stalled_orders ?? 0,
    inactiveCities: row?.inactive_cities ?? 0,
    availableWithoutLocation: row?.available_without_location ?? 0,
  };
}

/**
 * ترجمة الإشارات الخام إلى مؤشّرات مقروءة. كل مؤشّر يقول ما يعنيه الرقم لا الرقم
 * وحده: «عرض منتهٍ لم يُغلَق» أوضح من «7» لمن يفتح اللوحة في الثالثة فجراً.
 */
export function healthIndicators(signals: HealthSignals): readonly HealthIndicator[] {
  const latencyWarnMs = 300;
  const latencyBadMs = 1500;
  const latency: HealthIndicator["status"] =
    signals.databaseLatencyMs >= latencyBadMs
      ? "bad"
      : signals.databaseLatencyMs >= latencyWarnMs
        ? "warn"
        : "ok";

  const zeroIsOk = (count: number): HealthIndicator["status"] => (count === 0 ? "ok" : "bad");
  const zeroIsFine = (count: number): HealthIndicator["status"] => (count === 0 ? "ok" : "warn");

  return [
    {
      name: "استجابة قاعدة البيانات",
      status: latency,
      detail: `${signals.databaseLatencyMs} ملي ثانية لاستعلام اللوحة`,
    },
    {
      name: "عروض منتهية بلا إغلاق",
      status: zeroIsOk(signals.staleOffers),
      detail:
        signals.staleOffers === 0
          ? "لا عرض عالق"
          : `${signals.staleOffers} — الجوب الدوري لا يعمل غالباً`,
    },
    {
      name: "تفاوض تجاوز مهلته",
      status: zeroIsOk(signals.staleNegotiations),
      detail:
        signals.staleNegotiations === 0
          ? "لا دورة متوقّفة"
          : `${signals.staleNegotiations} دورة تنتظر تدويراً`,
    },
    {
      name: "طلبات متعثّرة في البحث",
      status: zeroIsFine(signals.stalledOrders),
      detail:
        signals.stalledOrders === 0
          ? "لا طلب تجاوز عتبة التعثّر"
          : `${signals.stalledOrders} طلب تجاوز كل دورات النشر`,
    },
    {
      name: "متاحون بلا موقع",
      status: zeroIsFine(signals.availableWithoutLocation),
      detail:
        signals.availableWithoutLocation === 0
          ? "كل متاح له موقع مسجّل"
          : `${signals.availableWithoutLocation} سائقاً لن يظهر في المطابقة بالقُرب`,
    },
    {
      name: "مدن غير مفعّلة",
      status: zeroIsFine(signals.inactiveCities),
      detail:
        signals.inactiveCities === 0
          ? "كل المدن مفعّلة"
          : `${signals.inactiveCities} مدينة بانتظار ربط قروباتها`,
    },
  ];
}

// ---------------------------------------------------------------------------
// السائقون
// ---------------------------------------------------------------------------

export interface DriversQuery {
  readonly cityId: string | null;
  readonly verification: string | null;
  readonly search: string | null;
  readonly limit: number;
}

interface DriverSqlRow {
  driver_id: string;
  user_id: string;
  full_name: string | null;
  telegram_id: string;
  phone: string | null;
  city_code: string;
  verification_status: string;
  is_blocked: boolean;
  is_available: boolean;
  rating_average: number | null;
  rating_count: number;
  services: string[] | null;
  plan: string | null;
  sub_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  completed_orders: number;
  registered_at: string;
  total_count: number;
}

export async function listDrivers(
  sql: Sql,
  query: DriversQuery,
): Promise<{ rows: readonly DriverRow[]; total: number }> {
  const search = query.search === null || query.search.trim() === "" ? null : query.search.trim();
  const rows = await sql<DriverSqlRow[]>`
    with filtered as (
      select d.id as driver_id, d.user_id, d.verification_status, d.rating_average,
             d.rating_count, d.created_at as registered_at,
             u.full_name, u.telegram_id::text as telegram_id, u.phone, u.is_blocked,
             c.code as city_code
      from drivers d
      join users u on u.id = d.user_id
      join cities c on c.id = d.city_id
      where true
        ${query.cityId === null ? sql`` : sql`and d.city_id = ${query.cityId}::uuid`}
        ${
          query.verification === null
            ? sql``
            : sql`and d.verification_status = ${query.verification}::verification_status`
        }
        ${
          search === null
            ? sql``
            : sql`and (
                u.full_name ilike ${`%${search}%`}
                or u.phone ilike ${`%${search}%`}
                or u.telegram_id::text = ${search}
              )`
        }
    )
    select f.driver_id, f.user_id, f.full_name, f.telegram_id, f.phone, f.city_code,
           f.verification_status::text as verification_status, f.is_blocked,
           coalesce(da.is_available, false) as is_available,
           f.rating_average::float8 as rating_average, f.rating_count,
           (select array_agg(dc.service::text order by dc.service)
              from driver_capabilities dc
             where dc.driver_id = f.driver_id and dc.is_enabled) as services,
           s.plan::text as plan, s.status::text as sub_status,
           s.trial_ends_at, s.current_period_end,
           (select count(*) from orders o
             where o.assigned_driver_id = f.driver_id and o.status = 'completed')::int
             as completed_orders,
           f.registered_at,
           (select count(*) from filtered)::int as total_count
    from filtered f
    left join driver_availability da on da.driver_id = f.driver_id
    left join subscriptions s
      on s.driver_id = f.driver_id and s.status in ('trialing', 'active')
    order by
      case f.verification_status when 'pending' then 0 else 1 end,
      f.registered_at desc
    limit ${query.limit}
  `;

  return {
    total: rows[0]?.total_count ?? 0,
    rows: rows.map((row) => ({
      driverId: row.driver_id,
      userId: row.user_id,
      fullName: row.full_name,
      telegramId: row.telegram_id,
      phone: row.phone,
      cityCode: row.city_code,
      verificationStatus: row.verification_status,
      isBlocked: row.is_blocked,
      isAvailable: row.is_available,
      ratingAverage: row.rating_average,
      ratingCount: row.rating_count,
      services: row.services ?? [],
      subscription:
        row.plan === null || row.sub_status === null
          ? null
          : {
              plan: row.plan,
              status: row.sub_status,
              trialEndsAt: row.trial_ends_at === null ? null : String(row.trial_ends_at),
              currentPeriodEnd:
                row.current_period_end === null ? null : String(row.current_period_end),
            },
      completedOrders: row.completed_orders,
      registeredAt: String(row.registered_at),
    })),
  };
}

// ---------------------------------------------------------------------------
// سائق واحد — البند 6.4
// ---------------------------------------------------------------------------

/** حدود العرض في صفحة السائق: أحدثُ ما يُقرأ، لا كل ما وُجد. */
export const DRIVER_ORDERS_LIMIT = 20;
export const DRIVER_TICKETS_LIMIT = 20;

interface DriverProfileSqlRow {
  driver_id: string;
  user_id: string;
  full_name: string | null;
  telegram_id: string;
  telegram_username: string | null;
  phone: string | null;
  language_code: string;
  city_code: string;
  city_name_ar: string;
  verification_status: string;
  is_blocked: boolean;
  vehicle_type: string | null;
  plate_number: string | null;
  national_id: string | null;
  vehicle_photo_file_id: string | null;
  preferred_area_label: string | null;
  preferred_lat: number | null;
  preferred_lng: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_location_at: string | null;
  stored_rating_average: number | null;
  stored_rating_count: number;
  live_rating_average: number | null;
  live_rating_count: number;
  flagged_rating_count: number;
  is_available: boolean;
  availability_changed_at: string | null;
  registered_at: string;
  services: string[] | null;
  plan: string | null;
  sub_status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  price_amount: string | null;
  currency: string | null;
  completed_orders: number;
  cancelled_orders: number;
}

/**
 * نقطةٌ تُبنى من عمودين أو لا تُبنى: نصفُ إحداثية أسوأ من غيابها، لأن (0,0)
 * موضعٌ حقيقي في المحيط الأطلسي يظهر على الخريطة كأنه معلومة.
 */
function toPoint(lat: number | null, lng: number | null): DriverDetailPoint | null {
  if (lat === null || lng === null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * صفحة السائق الواحد: ثلاثة استعلامات متوازية لا استعلامٌ واحد بوصلات متعدّدة —
 * ضمُّ الرحلات والتذاكر في نفس الصفّ يضرب عددَ صفوفِ أحدهما في عدد الآخر،
 * فتصير الحصيلة كذباً حسابياً لا بطئاً فقط.
 *
 * وعائد null يعني «لا سائق بهذا المعرّف»: يُميَّز عن الخطأ كي يُجيب المسار 404
 * لا صفحةً فارغة تُقرأ كأنها سائقٌ بلا بيانات.
 */
export async function driverDetail(sql: Sql, driverId: string): Promise<DriverDetail | null> {
  const [profileRows, orderRows, ticketRows, documentRows] = await Promise.all([
    sql<DriverProfileSqlRow[]>`
      select d.id as driver_id, d.user_id,
             u.full_name, u.telegram_id::text as telegram_id, u.telegram_username, u.phone,
             u.language_code, u.is_blocked,
             c.code as city_code, c.name_ar as city_name_ar,
             d.verification_status::text as verification_status,
             d.vehicle_type::text as vehicle_type, d.plate_number, d.national_id,
             d.vehicle_photo_file_id,
             d.preferred_area_label,
             st_y(d.preferred_area_location::geometry) as preferred_lat,
             st_x(d.preferred_area_location::geometry) as preferred_lng,
             st_y(d.last_location::geometry) as last_lat,
             st_x(d.last_location::geometry) as last_lng,
             d.last_location_at,
             d.rating_average::float8 as stored_rating_average,
             d.rating_count as stored_rating_count,
             coalesce(da.is_available, false) as is_available,
             da.changed_at as availability_changed_at,
             d.created_at as registered_at,
             (select array_agg(dc.service::text order by dc.service)
                from driver_capabilities dc
               where dc.driver_id = d.id and dc.is_enabled) as services,
             s.plan::text as plan, s.status::text as sub_status,
             s.trial_ends_at, s.current_period_end,
             s.price_amount::text as price_amount, s.currency,
             -- المتوسّط محسوباً الآن، مع استثناء المُعلَّم كما تفعله دالّة القاعدة
             -- نفسها: لو استُثني هنا بشرط مختلف لصار الانحراف المعروض وهماً.
             (select count(*) from ratings r
               where r.ratee_user_id = d.user_id and r.direction = 'rider_to_driver'
                 and r.is_flagged = false)::int as live_rating_count,
             (select avg(r.stars)::float8 from ratings r
               where r.ratee_user_id = d.user_id and r.direction = 'rider_to_driver'
                 and r.is_flagged = false) as live_rating_average,
             (select count(*) from ratings r
               where r.ratee_user_id = d.user_id and r.direction = 'rider_to_driver'
                 and r.is_flagged)::int as flagged_rating_count,
             (select count(*) from orders o
               where o.assigned_driver_id = d.id and o.status = 'completed')::int
               as completed_orders,
             (select count(*) from orders o
               where o.assigned_driver_id = d.id and o.status = 'cancelled')::int
               as cancelled_orders
        from drivers d
        join users u on u.id = d.user_id
        join cities c on c.id = d.city_id
        left join driver_availability da on da.driver_id = d.id
        left join subscriptions s on s.driver_id = d.id and s.status in ('trialing', 'active')
       where d.id = ${driverId}::uuid
    `,
    sql<
      {
        order_id: string;
        service: string;
        pickup_label: string | null;
        dropoff_label: string | null;
        matched_at: string | null;
        started_at: string | null;
        completed_at: string | null;
        created_at: string;
        rider_name: string | null;
        rider_stars: number | null;
      }[]
    >`
      select o.id as order_id, o.service::text as service,
             o.pickup_label, o.dropoff_label,
             o.matched_at, o.started_at, o.completed_at, o.created_at,
             ru.full_name as rider_name,
             (select r.stars from ratings r
               where r.order_id = o.id and r.direction = 'rider_to_driver'
                 and r.is_flagged = false
               limit 1) as rider_stars
        from orders o
        left join riders rd on rd.id = o.rider_id
        left join users ru on ru.id = rd.user_id
       where o.assigned_driver_id = ${driverId}::uuid
         and o.status = 'completed'
       order by o.completed_at desc nulls last
       limit ${DRIVER_ORDERS_LIMIT}
    `,
    sql<
      {
        ticket_id: string;
        type: string;
        status: string;
        message: string;
        order_id: string | null;
        created_at: string;
        resolved_at: string | null;
        resolution: string | null;
        claimed_by_name: string | null;
        link_kind: string;
        counterpart_name: string | null;
      }[]
    >`
      -- الشرط شرطان لا شرط: تذكرةٌ فتحها السائق، **وتذكرةٌ فتحها راكبٌ عن طلبٍ
      -- أُسنِد إليه**. الاقتصار على driver_id كان يُخفي شكوى الراكب على السائق —
      -- وهي بالضبط التذكرة التي تُراجَع قبل تعليق حسابه.
      select t.id as ticket_id, t.type::text as type, t.status::text as status, t.message,
             t.order_id, t.created_at, t.resolved_at, t.resolution,
             cu.full_name as claimed_by_name,
             case when t.driver_id = ${driverId}::uuid then 'filed_by_driver'
                  else 'about_driver_order' end as link_kind,
             ru.full_name as counterpart_name
        from support_tickets t
        left join orders o on o.id = t.order_id
        left join riders r on r.id = t.rider_id
        left join users ru on ru.id = r.user_id
        left join users cu on cu.id = t.claimed_by_user_id
       where t.driver_id = ${driverId}::uuid
          or o.assigned_driver_id = ${driverId}::uuid
       order by t.created_at desc
       limit ${DRIVER_TICKETS_LIMIT}
    `,
    sql<
      {
        doc_type: string;
        status: string | null;
        object_path: string;
        expires_at: string | null;
        review_note: string | null;
        submitted_at: string | null;
        reviewed_at: string | null;
        reviewed_by_name: string | null;
      }[]
    >`
      select d.doc_type::text as doc_type,
             d.status::text as status,
             d.object_path,
             d.expires_at::text as expires_at,
             d.review_note,
             d.submitted_at,
             d.reviewed_at,
             r.full_name as reviewed_by_name
        from driver_documents d
        left join users r on r.id = d.reviewed_by
       where d.driver_id = ${driverId}::uuid
       order by d.doc_type
    `,
  ]);

  const row = profileRows[0];
  if (row === undefined) return null;

  return {
    profile: {
      driverId: row.driver_id,
      userId: row.user_id,
      fullName: row.full_name,
      telegramId: row.telegram_id,
      telegramUsername: row.telegram_username,
      phone: row.phone,
      languageCode: row.language_code,
      cityCode: row.city_code,
      cityNameAr: row.city_name_ar,
      verificationStatus: row.verification_status,
      isBlocked: row.is_blocked,
      isAvailable: row.is_available,
      availabilityChangedAt:
        row.availability_changed_at === null ? null : String(row.availability_changed_at),
      nationalId: row.national_id,
      vehicleType: row.vehicle_type,
      plateNumber: row.plate_number,
      vehiclePhotoFileId: row.vehicle_photo_file_id,
      preferredAreaLabel: row.preferred_area_label,
      preferredArea: toPoint(row.preferred_lat, row.preferred_lng),
      lastLocation: toPoint(row.last_lat, row.last_lng),
      lastLocationAt: row.last_location_at === null ? null : String(row.last_location_at),
      storedRatingAverage: row.stored_rating_average,
      storedRatingCount: row.stored_rating_count,
      liveRatingAverage: row.live_rating_average,
      liveRatingCount: row.live_rating_count,
      flaggedRatingCount: row.flagged_rating_count,
      services: row.services ?? [],
      subscription:
        row.plan === null || row.sub_status === null
          ? null
          : {
              plan: row.plan,
              status: row.sub_status,
              trialEndsAt: row.trial_ends_at === null ? null : String(row.trial_ends_at),
              currentPeriodEnd:
                row.current_period_end === null ? null : String(row.current_period_end),
              priceAmount: row.price_amount,
              currency: row.currency,
            },
      completedOrders: row.completed_orders,
      cancelledOrders: row.cancelled_orders,
      registeredAt: String(row.registered_at),
    },
    orders: orderRows.map((order) => ({
      orderId: order.order_id,
      service: order.service,
      pickupLabel: order.pickup_label,
      dropoffLabel: order.dropoff_label,
      matchedAt: order.matched_at === null ? null : String(order.matched_at),
      startedAt: order.started_at === null ? null : String(order.started_at),
      completedAt: order.completed_at === null ? null : String(order.completed_at),
      createdAt: String(order.created_at),
      riderName: order.rider_name,
      riderStars: order.rider_stars === null ? null : Number(order.rider_stars),
    })),
    tickets: ticketRows.map((ticket) => ({
      ticketId: ticket.ticket_id,
      type: ticket.type,
      status: ticket.status,
      message: ticket.message,
      orderId: ticket.order_id,
      createdAt: String(ticket.created_at),
      resolvedAt: ticket.resolved_at === null ? null : String(ticket.resolved_at),
      resolution: ticket.resolution,
      claimedByName: ticket.claimed_by_name,
      linkKind: ticket.link_kind === "filed_by_driver" ? "filed_by_driver" : "about_driver_order",
      counterpartName: ticket.counterpart_name,
    })),
    documents: documentRows.map((doc) => ({
      docType: doc.doc_type,
      status: doc.status,
      objectPath: doc.object_path,
      expiresAt: doc.expires_at,
      reviewNote: doc.review_note,
      submittedAt: doc.submitted_at === null ? null : String(doc.submitted_at),
      reviewedAt: doc.reviewed_at === null ? null : String(doc.reviewed_at),
      reviewedByName: doc.reviewed_by_name,
    })),
  };
}

// ---------------------------------------------------------------------------
// الطلبات الحية
// ---------------------------------------------------------------------------

/**
 * `F16-02`/`F16-03` — تلغرامُ صاحبِ الطلبِ منَ القاعدةِ لا منَ نموذجٍ يكتبُهُ
 * المسؤولُ: مسارُ قطعِ روابطِ التتبُّعِ منَ اللوحةِ يُلغي **بالنيابةِ عن
 * مُصدِرِها** (زرُّ الراكبِ موصولٌ منذُ §4.2)، وملكيّةُ الإلغاءِ في القاعدةِ
 * تطالبُ تلغرامَ صاحبِ الطلبِ نفسِهِ — فلا يُقبلَ معرّفٌ من خارجِها.
 */
export async function orderRiderTelegram(sql: Sql, orderId: string): Promise<string | null> {
  const rows = await sql<{ telegram_id: string }[]>`
    select u.telegram_id::text as telegram_id
      from orders o
      join riders r on r.id = o.rider_id
      join users u on u.id = r.user_id
     where o.id = ${orderId}::uuid
  `;
  return rows[0]?.telegram_id ?? null;
}

export async function listLiveOrders(
  sql: Sql,
  cityId: string | null,
): Promise<readonly LiveOrderRow[]> {
  const rows = await sql<
    {
      order_id: string;
      city_code: string;
      service: string;
      status: string;
      rider_name: string | null;
      rider_telegram_id: string;
      driver_name: string | null;
      pickup_label: string | null;
      dropoff_label: string | null;
      created_at: string;
      searching_since: string | null;
      pickup_at: string | null;
      matched_at: string | null;
      started_at: string | null;
      broadcast_round: number;
      pending_offers: number;
      negotiation_stage: string | null;
    }[]
  >`
    select o.id as order_id, c.code as city_code, o.service::text as service,
           o.status::text as status,
           ru.full_name as rider_name, ru.telegram_id::text as rider_telegram_id,
           du.full_name as driver_name,
           o.pickup_label, o.dropoff_label,
           o.created_at, o.searching_since, o.pickup_at, o.matched_at, o.started_at, o.broadcast_round,
           (select count(*) from order_offers off
             where off.order_id = o.id and off.status = 'pending' and off.expires_at > now())::int
             as pending_offers,
           (select n.status::text from unsubscribed_negotiations n
             where n.order_id = o.id and n.status in ('collecting', 'negotiating')
             limit 1) as negotiation_stage
    from orders o
    join cities c on c.id = o.city_id
    join riders r on r.id = o.rider_id
    join users ru on ru.id = r.user_id
    left join drivers d on d.id = o.assigned_driver_id
    left join users du on du.id = d.user_id
    -- WR-06: المجدولُ يظهرُ للمشغّلِ حيًّا (ينتظرُ موعدَ إطلاقِه) لا مختفيًا.
    where o.status in ('scheduled', 'searching', 'matched', 'in_progress')
      ${cityId === null ? sql`` : sql`and o.city_id = ${cityId}::uuid`}
    order by o.created_at asc
  `;

  return rows.map((row) => ({
    orderId: row.order_id,
    cityCode: row.city_code,
    service: row.service,
    status: row.status,
    riderName: row.rider_name,
    riderTelegramId: row.rider_telegram_id,
    driverName: row.driver_name,
    pickupLabel: row.pickup_label,
    dropoffLabel: row.dropoff_label,
    createdAt: String(row.created_at),
    searchingSince: row.searching_since === null ? null : String(row.searching_since),
    pickupAt: row.pickup_at === null ? null : String(row.pickup_at),
    matchedAt: row.matched_at === null ? null : String(row.matched_at),
    startedAt: row.started_at === null ? null : String(row.started_at),
    broadcastRound: row.broadcast_round,
    pendingOffers: row.pending_offers,
    negotiationStage: row.negotiation_stage,
  }));
}

// ---------------------------------------------------------------------------
// الحضور
// ---------------------------------------------------------------------------

export async function listAttendanceEvents(
  sql: Sql,
  cityId: string | null,
  windowHours: number,
  search: string | null,
  limit: number,
): Promise<readonly AttendanceEvent[]> {
  const term = search === null || search.trim() === "" ? null : search.trim();
  const rows = await sql<
    {
      changed_at: string;
      driver_id: string;
      driver_name: string | null;
      telegram_id: string;
      city_code: string;
      is_available: boolean;
      source: string;
    }[]
  >`
    select a.changed_at, a.driver_id, u.full_name as driver_name,
           u.telegram_id::text as telegram_id, c.code as city_code,
           a.is_available, a.source
    from attendance_log a
    join drivers d on d.id = a.driver_id
    join users u on u.id = d.user_id
    join cities c on c.id = a.city_id
    where a.changed_at >= now() - make_interval(hours => ${windowHours}::integer)
      ${cityId === null ? sql`` : sql`and a.city_id = ${cityId}::uuid`}
      ${term === null ? sql`` : sql`and u.full_name ilike ${`%${term}%`}`}
    order by a.changed_at desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    changedAt: String(row.changed_at),
    driverId: row.driver_id,
    driverName: row.driver_name,
    telegramId: row.telegram_id,
    cityCode: row.city_code,
    isAvailable: row.is_available,
    source: row.source,
  }));
}

/**
 * مدّة الإتاحة داخل النافذة: تُحسب بجمع الفترات بين كل «صار متاحاً» و«صار غير
 * متاح» تاليه. من كان متاحاً قبل بداية النافذة يُحتسب من بدايتها، ومن بقي متاحاً
 * حتى الآن يُحتسب حتى الآن — وإلا ظهر أنشط سائق بصفر ساعة لأنه لم يُطفئ بعد.
 */
export async function attendanceSummary(
  sql: Sql,
  cityId: string | null,
  windowHours: number,
  search: string | null,
): Promise<readonly AttendanceSummaryRow[]> {
  const term = search === null || search.trim() === "" ? null : search.trim();
  const rows = await sql<
    {
      driver_id: string;
      driver_name: string | null;
      city_code: string;
      online_seconds: number;
      toggles: number;
      is_available_now: boolean;
    }[]
  >`
    with bounds as (
      select now() - make_interval(hours => ${windowHours}::integer) as since, now() as until
    ),
    scoped as (
      select d.id as driver_id, u.full_name as driver_name, c.code as city_code,
             coalesce(da.is_available, false) as is_available_now
      from drivers d
      join users u on u.id = d.user_id
      join cities c on c.id = d.city_id
      left join driver_availability da on da.driver_id = d.id
      where true
        ${cityId === null ? sql`` : sql`and d.city_id = ${cityId}::uuid`}
        ${term === null ? sql`` : sql`and u.full_name ilike ${`%${term}%`}`}
    ),
    events as (
      select a.driver_id, a.is_available, a.changed_at
      from attendance_log a, bounds
      where a.changed_at >= bounds.since
    ),
    -- الحالة عند بداية النافذة: آخر تبديل قبلها
    opening as (
      select s.driver_id,
             coalesce((
               select a.is_available from attendance_log a, bounds
               where a.driver_id = s.driver_id and a.changed_at < bounds.since
               order by a.changed_at desc limit 1
             ), false) as was_available
      from scoped s
    ),
    timeline as (
      select o.driver_id, (select since from bounds) as at, o.was_available as is_available
      from opening o
      union all
      select e.driver_id, e.changed_at as at, e.is_available from events e
    ),
    spans as (
      select t.driver_id, t.is_available, t.at,
             lead(t.at, 1, (select until from bounds))
               over (partition by t.driver_id order by t.at) as next_at
      from timeline t
    )
    select s.driver_id, s.driver_name, s.city_code, s.is_available_now,
           coalesce((
             select sum(extract(epoch from (sp.next_at - sp.at)))
             from spans sp
             where sp.driver_id = s.driver_id and sp.is_available
           ), 0)::float8 as online_seconds,
           (select count(*) from events e where e.driver_id = s.driver_id)::int as toggles
    from scoped s
    order by online_seconds desc, s.driver_name asc
  `;

  return rows.map((row) => ({
    driverId: row.driver_id,
    driverName: row.driver_name,
    cityCode: row.city_code,
    onlineSeconds: row.online_seconds,
    toggles: row.toggles,
    isAvailableNow: row.is_available_now,
  }));
}

// ---------------------------------------------------------------------------
// التقييمات
// ---------------------------------------------------------------------------

export interface RatingsQuery {
  readonly cityId: string | null;
  readonly direction: string | null;
  readonly onlyLow: boolean;
  readonly lowThreshold: number;
  readonly limit: number;
}

export async function listRatings(sql: Sql, query: RatingsQuery): Promise<readonly RatingRow[]> {
  const rows = await sql<
    {
      id: string;
      created_at: string;
      order_id: string;
      city_code: string;
      direction: string;
      rater_name: string | null;
      ratee_name: string | null;
      stars: number;
      comment: string | null;
      is_flagged: boolean;
    }[]
  >`
    select r.id, r.created_at, r.order_id, c.code as city_code, r.direction::text as direction,
           rater.full_name as rater_name, ratee.full_name as ratee_name,
           r.stars, r.comment, r.is_flagged
    from ratings r
    join cities c on c.id = r.city_id
    join users rater on rater.id = r.rater_user_id
    join users ratee on ratee.id = r.ratee_user_id
    where true
      ${query.cityId === null ? sql`` : sql`and r.city_id = ${query.cityId}::uuid`}
      ${
        query.direction === null
          ? sql``
          : sql`and r.direction = ${query.direction}::rating_direction`
      }
      ${query.onlyLow ? sql`and r.stars <= ${query.lowThreshold}` : sql``}
    order by r.created_at desc
    limit ${query.limit}
  `;

  return rows.map((row) => ({
    ratingId: row.id,
    createdAt: String(row.created_at),
    orderId: row.order_id,
    cityCode: row.city_code,
    direction: row.direction,
    raterName: row.rater_name,
    rateeName: row.ratee_name,
    stars: row.stars,
    comment: row.comment,
    isFlagged: row.is_flagged,
  }));
}

export interface RatingsTotals {
  readonly total: number;
  readonly averageOnDriver: number | null;
  readonly averageOnRider: number | null;
  readonly lowCount: number;
  readonly flaggedCount: number;
}

export async function ratingsTotals(
  sql: Sql,
  cityId: string | null,
  lowThreshold: number,
): Promise<RatingsTotals> {
  const rows = await sql<
    {
      total: number;
      avg_driver: number | null;
      avg_rider: number | null;
      low_count: number;
      flagged_count: number;
    }[]
  >`
    select count(*)::int as total,
           avg(stars) filter (where direction = 'rider_to_driver' and is_flagged = false)::float8
             as avg_driver,
           avg(stars) filter (where direction = 'driver_to_rider' and is_flagged = false)::float8
             as avg_rider,
           count(*) filter (where stars <= ${lowThreshold})::int as low_count,
           count(*) filter (where is_flagged)::int as flagged_count
    from ratings
    where true
      ${cityId === null ? sql`` : sql`and city_id = ${cityId}::uuid`}
  `;
  const row = rows[0];
  return {
    total: row?.total ?? 0,
    averageOnDriver: row?.avg_driver ?? null,
    averageOnRider: row?.avg_rider ?? null,
    lowCount: row?.low_count ?? 0,
    flaggedCount: row?.flagged_count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// النزاعات
// ---------------------------------------------------------------------------

export async function listDisputes(
  sql: Sql,
  cityId: string | null,
  status: string | null,
  limit: number,
): Promise<readonly DisputeRow[]> {
  const rows = await sql<
    {
      ticket_id: string;
      created_at: string;
      type: string;
      status: string;
      city_code: string;
      party_name: string | null;
      party_role: string;
      party_telegram_id: string | null;
      order_id: string | null;
      message: string;
      lost_at: string | null;
      claimed_by_name: string | null;
      claimed_at: string | null;
      resolved_by_name: string | null;
      resolved_at: string | null;
      resolution_note: string | null;
      agent_suggestion: string | null;
      agent_classification: string | null;
      agent_confidence: string | null;
    }[]
  >`
    select t.id as ticket_id, t.created_at, t.type::text as type, t.status::text as status,
           c.code as city_code,
           coalesce(du.full_name, ru.full_name) as party_name,
           case when t.driver_id is not null then 'driver' else 'rider' end as party_role,
           coalesce(du.telegram_id, ru.telegram_id)::text as party_telegram_id,
           t.order_id, t.message, t.lost_at,
           cu.full_name as claimed_by_name, t.claimed_at,
           ru2.full_name as resolved_by_name, t.resolved_at,
           t.resolution as resolution_note,
           ad.recommended_action as agent_suggestion,
           ad.classification as agent_classification,
           ad.confidence::text as agent_confidence
    from support_tickets t
    join cities c on c.id = t.city_id
    left join drivers d on d.id = t.driver_id
    left join users du on du.id = d.user_id
    left join riders r on r.id = t.rider_id
    left join users ru on ru.id = r.user_id
    left join users cu on cu.id = t.claimed_by_user_id
    left join users ru2 on ru2.id = t.resolved_by_user_id
    -- الاقتراح المنشور لهذه التذكرة — lateral لأن المطلوب أحدث قرار واحد لا
    -- صفّ لكل قرار: الربط المباشر كان يُكرّر التذكرة مرّتين لو أُعيد تقييمها يوماً.
    -- وشرط published مقصود: قرارٌ لم يره الدعم في القروب لا يُعرض هنا كأنّه معروض.
    left join lateral (
      select dec.recommended_action, dec.classification, dec.confidence
        from agent_decisions dec
       where dec.ticket_id = t.id and dec.published
       order by dec.created_at desc
       limit 1
    ) ad on true
    where true
      ${cityId === null ? sql`` : sql`and t.city_id = ${cityId}::uuid`}
      ${
        status === null
          ? sql`and t.status in ('open', 'claimed')`
          : sql`and t.status = ${status}::support_ticket_status`
      }
    order by t.created_at asc
    limit ${limit}
  `;

  return rows.map((row) => ({
    ticketId: row.ticket_id,
    createdAt: String(row.created_at),
    type: row.type,
    status: row.status,
    cityCode: row.city_code,
    partyName: row.party_name,
    partyRole: row.party_role,
    partyTelegramId: row.party_telegram_id,
    orderId: row.order_id,
    message: row.message,
    // ADR 0253: ما قدّمَه صاحبُ البلاغِ أو `null` — لا يُستنتَج.
    lostAt: row.lost_at === null ? null : String(row.lost_at),
    claimedByName: row.claimed_by_name,
    claimedAt: row.claimed_at === null ? null : String(row.claimed_at),
    resolvedByName: row.resolved_by_name,
    resolvedAt: row.resolved_at === null ? null : String(row.resolved_at),
    resolutionNote: row.resolution_note,
    agentSuggestion: row.agent_suggestion,
    agentClassification: row.agent_classification,
    // `numeric` يصل نصّاً من المُشغّل حفاظاً على الدقة؛ التحويل هنا لأن العرض نسبة مئوية.
    agentConfidence: row.agent_confidence === null ? null : Number(row.agent_confidence),
  }));
}

export interface DisputeTotals {
  readonly open: number;
  readonly claimed: number;
  readonly resolvedInWindow: number;
}

export async function disputeTotals(
  sql: Sql,
  cityId: string | null,
  windowHours: number,
): Promise<DisputeTotals> {
  const rows = await sql<{ open: number; claimed: number; resolved: number }[]>`
    select
      count(*) filter (where status = 'open')::int as open,
      count(*) filter (where status = 'claimed')::int as claimed,
      count(*) filter (
        where status in ('resolved', 'rejected')
          and resolved_at >= now() - make_interval(hours => ${windowHours}::integer)
      )::int as resolved
    from support_tickets
    where true
      ${cityId === null ? sql`` : sql`and city_id = ${cityId}::uuid`}
  `;
  const row = rows[0];
  return {
    open: row?.open ?? 0,
    claimed: row?.claimed ?? 0,
    resolvedInWindow: row?.resolved ?? 0,
  };
}

// ---------------------------------------------------------------------------
// الخريطة الحرارية
// ---------------------------------------------------------------------------

export interface HeatmapResult {
  readonly cells: readonly HeatCell[];
  readonly rows: number;
  readonly cols: number;
  readonly totalDemand: number;
  readonly totalSupply: number;
}

/**
 * الطلب والعرض على شبكة واحدة: تُقسَّم الإحداثيات إلى خلايا بحجم ثابت بالدرجات،
 * ثم يُحوَّل رقم الخليّة المطلق إلى صفٍّ وعمود نسبيَّين لأصغر خلية مأهولة — فتكون
 * الشبكة المرسومة محيطة بالنشاط لا بالكوكب.
 */
export async function heatmap(
  sql: Sql,
  cityId: string,
  windowHours: number,
  cellDegrees: number,
): Promise<HeatmapResult> {
  const rows = await sql<{ gx: number; gy: number; demand: number; supply: number }[]>`
    with cell as (select ${cellDegrees}::float8 as size),
    demand_points as (
      select floor(st_x(o.pickup::geometry) / cell.size)::int as gx,
             floor(st_y(o.pickup::geometry) / cell.size)::int as gy
      from orders o, cell
      where o.city_id = ${cityId}::uuid
        and o.created_at >= now() - make_interval(hours => ${windowHours}::integer)
    ),
    supply_points as (
      select floor(st_x(d.last_location::geometry) / cell.size)::int as gx,
             floor(st_y(d.last_location::geometry) / cell.size)::int as gy
      from drivers d
      join driver_availability da on da.driver_id = d.id and da.is_available
      , cell
      where d.city_id = ${cityId}::uuid and d.last_location is not null
    ),
    merged as (
      select gx, gy, count(*)::int as demand, 0 as supply from demand_points group by gx, gy
      union all
      select gx, gy, 0 as demand, count(*)::int as supply from supply_points group by gx, gy
    )
    select gx, gy, sum(demand)::int as demand, sum(supply)::int as supply
    from merged
    group by gx, gy
    order by gy desc, gx asc
  `;

  if (rows.length === 0) {
    return { cells: [], rows: 0, cols: 0, totalDemand: 0, totalSupply: 0 };
  }

  const xs = rows.map((r) => r.gx);
  const ys = rows.map((r) => r.gy);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const HALF = 0.5;
  const cells: HeatCell[] = rows.map((row) => ({
    // الصفّ صفر هو أقصى شمال: الشاشة تُقرأ من الأعلى، والخريطة كذلك
    row: maxY - row.gy,
    col: row.gx - minX,
    centerLng: (row.gx + HALF) * cellDegrees,
    centerLat: (row.gy + HALF) * cellDegrees,
    demand: row.demand,
    supply: row.supply,
  }));

  return {
    cells,
    rows: maxY - minY + 1,
    cols: maxX - minX + 1,
    totalDemand: rows.reduce((sum, r) => sum + r.demand, 0),
    totalSupply: rows.reduce((sum, r) => sum + r.supply, 0),
  };
}

// ---------------------------------------------------------------------------
// الإعدادات
// ---------------------------------------------------------------------------

export async function listSettings(sql: Sql, cityId: string): Promise<readonly SettingRow[]> {
  const rows = await sql<
    {
      key: string;
      value: unknown;
      value_type: string;
      description_ar: string;
      is_provisional: boolean;
      updated_at: string;
    }[]
  >`
    select key, value, value_type, description_ar, is_provisional, updated_at
    from platform_settings
    where city_id = ${cityId}::uuid
    order by key
  `;
  return rows.map((row) => ({
    key: row.key,
    // الإعدادُ النصيّ يُعرض بلا تنصيص: ما يقرأه المسؤول في الخانة هو ما يكتبه فيها.
    value: row.value_type === "string" ? String(row.value) : JSON.stringify(row.value),
    valueType: row.value_type,
    descriptionAr: row.description_ar,
    isProvisional: row.is_provisional,
    updatedAt: String(row.updated_at),
  }));
}

// ---------------------------------------------------------------------------
// البحث الموحَّد
// ---------------------------------------------------------------------------

export interface SearchItem {
  readonly label: string;
  readonly detail: string;
  readonly href: string;
}

export interface SearchGroup {
  readonly title: string;
  readonly items: readonly SearchItem[];
}

const UUID_PATTERN = /^[0-9a-f]{4,}$/i;

/**
 * بحث واحد على كل ما يبحث عنه مشغّل فعلاً: شخص باسمه أو جواله أو معرّف تلغرامه،
 * وطلب أو تذكرة ببداية معرّفها. لا فهرس نصّي كامل: عدد الصفوف اليوم لا يبرّره،
 * وإضافته قبل الحاجة تعني فهرساً يُصان بلا مستفيد.
 */
export async function unifiedSearch(
  sql: Sql,
  term: string,
  limit: number,
): Promise<readonly SearchGroup[]> {
  const trimmed = term.trim();
  if (trimmed === "") return [];
  const like = `%${trimmed}%`;
  const groups: SearchGroup[] = [];

  const people = await sql<
    {
      full_name: string | null;
      telegram_id: string;
      phone: string | null;
      role: string;
      city_code: string;
      driver_id: string | null;
    }[]
  >`
    select u.full_name, u.telegram_id::text as telegram_id, u.phone, u.role::text as role,
           c.code as city_code, d.id as driver_id
    from users u
    join cities c on c.id = u.city_id
    left join drivers d on d.user_id = u.id
    where u.full_name ilike ${like}
       or u.phone ilike ${like}
       or u.telegram_id::text = ${trimmed}
    order by u.created_at desc
    limit ${limit}
  `;

  if (people.length > 0) {
    groups.push({
      title: "أشخاص",
      items: people.map((person) => ({
        label: person.full_name ?? person.telegram_id,
        detail: `${person.role} · ${person.city_code} · ${person.telegram_id}${
          person.phone === null ? "" : ` · ${person.phone}`
        }`,
        href:
          person.driver_id === null
            ? `/admin/drivers?q=${encodeURIComponent(person.telegram_id)}`
            : `/admin/drivers?q=${encodeURIComponent(person.telegram_id)}`,
      })),
    });
  }

  if (UUID_PATTERN.test(trimmed)) {
    const prefix = `${trimmed}%`;

    const orders = await sql<
      { id: string; status: string; service: string; city_code: string; created_at: string }[]
    >`
      select o.id, o.status::text as status, o.service::text as service,
             c.code as city_code, o.created_at
      from orders o
      join cities c on c.id = o.city_id
      where o.id::text like ${prefix}
      order by o.created_at desc
      limit ${limit}
    `;
    if (orders.length > 0) {
      groups.push({
        title: "طلبات",
        items: orders.map((order) => ({
          label: order.id,
          detail: `${order.service} · ${order.status} · ${order.city_code}`,
          href: "/admin/live-orders",
        })),
      });
    }

    const tickets = await sql<{ id: string; status: string; type: string; city_code: string }[]>`
      select t.id, t.status::text as status, t.type::text as type, c.code as city_code
      from support_tickets t
      join cities c on c.id = t.city_id
      where t.id::text like ${prefix}
      order by t.created_at desc
      limit ${limit}
    `;
    if (tickets.length > 0) {
      groups.push({
        title: "تذاكر",
        items: tickets.map((ticket) => ({
          label: ticket.id,
          detail: `${ticket.type} · ${ticket.status} · ${ticket.city_code}`,
          href: `/admin/disputes?status=${encodeURIComponent(ticket.status)}`,
        })),
      });
    }
  }

  return groups;
}

// ---------------------------------------------------------------------------
// الأفعال الكتابية — كلها دوالّ ذرّية تتحقّق من صفة المنفِّذ في القاعدة نفسها
// ---------------------------------------------------------------------------

export interface WriteOutcome {
  readonly ok: boolean;
  readonly error: string | null;
  readonly changed: boolean;
}

function readWrite(value: unknown): WriteOutcome {
  if (typeof value !== "object" || value === null) {
    return { ok: false, error: "UNREADABLE_RESPONSE", changed: false };
  }
  const record = value as Record<string, unknown>;
  return {
    ok: record.ok === true,
    error: record.ok === true ? null : String(record.error ?? "UNKNOWN"),
    changed: record.changed === true,
  };
}

/**
 * القيمة تُمرَّر نصّاً ثم تُحوَّل في القاعدة (::text::jsonb) لا كـ jsonb مباشرة:
 * مشغّل الاتصال يُسلسِل أي نصّ يُرسَل إلى عمود jsonb بوصفه نصّ JSON، فيصير "0.02"
 * سلسلةً لا رقماً وتُرفض بـ VALUE_TYPE_MISMATCH. اكتُشف باختبار تكامل حقيقي.
 */
export async function updateSetting(
  sql: Sql,
  actorUserId: string,
  cityId: string,
  key: string,
  value: string,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_update_setting(
      ${actorUserId}::uuid, ${cityId}::uuid, ${key}::text, ${value}::text
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

/**
 * القروبات bigint لا number: رقم JavaScript يفقد الدقة قبل أن يصل إلى PostgreSQL.
 * نمرّر النص ثم نُحوّله داخل الاستعلام بعد تحقق المسار من صيغته ونطاقه.
 */
export async function updateCityGroupIds(
  sql: Sql,
  actorUserId: string,
  cityId: string,
  supportGroupId: string | null,
  escalationGroupId: string | null,
  unsubscribedDriversGroupId: string | null,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_update_city_group_ids(
      ${actorUserId}::uuid,
      ${cityId}::uuid,
      ${supportGroupId}::text::bigint,
      ${escalationGroupId}::text::bigint,
      ${unsubscribedDriversGroupId}::text::bigint
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

/**
 * PD-042 · مراجعةُ وثيقةٍ مُرسَلةٍ (ADR 0256). الحكمُ كلُّه في الدالّةِ الذرّيّةِ —
 * المسؤوليّةُ والقرارُ والسببُ والحالةُ والانتهاءُ والتدقيقُ — والمسارُ ناقلٌ لا حَكَم.
 */
export async function reviewDriverDocument(
  sql: Sql,
  actorUserId: string,
  driverId: string,
  docType: string,
  decision: string,
  note: string | null,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_review_driver_document(
      ${actorUserId}::uuid, ${driverId}::uuid, ${docType}::text, ${decision}::text, ${note}::text
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

/**
 * PD-042 · فتحُ وثيقةٍ (ADR 0256): البابُ الوحيدُ لمسارِ الملفّ. الدالّةُ تحكمُ بمنحِ
 * مراجِعِ الوثائقِ لمدينةِ الوثيقةِ وتُدقِّقُ الفتحَ قبلَ أن تُعيدَ المسار؛ والمسارُ لا يُسجَّلُ
 * ولا يُعادُ إلى المتصفّحِ — البوّابةُ توقِّعُه رابطاً قصيراً فحسب.
 */
export async function openDriverDocument(
  sql: Sql,
  actorUserId: string,
  driverId: string,
  docType: string,
): Promise<
  | { readonly ok: true; readonly objectPath: string }
  | { readonly ok: false; readonly error: string }
> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_open_driver_document(${actorUserId}::uuid, ${driverId}::uuid, ${docType}::text) as result
  `;
  const result = rows[0]?.result;
  if (typeof result === "object" && result !== null) {
    const record = result as Record<string, unknown>;
    if (record.ok === true && typeof record.object_path === "string") {
      return { ok: true, objectPath: record.object_path };
    }
    if (typeof record.error === "string") return { ok: false, error: record.error };
  }
  return { ok: false, error: "UNKNOWN" };
}

export async function setDriverVerification(
  sql: Sql,
  actorUserId: string,
  driverId: string,
  status: string,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_set_driver_verification(
      ${actorUserId}::uuid, ${driverId}::uuid, ${status}::text
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

/**
 * مُعرِّفُ تيليجرام للمستخدمِ الهدفِ — يُقرأُ **قبلَ** الإنفاذِ (`SEC-18-ب`).
 *
 * ولِمَ قراءةٌ منفصلةٌ لا قيمةٌ تُردُّ منَ الدالّةِ المُسجِّلةِ: الإنفاذُ يسبقُ
 * التسجيلَ (`ADR 0174`)، ومفتاحُ الإنفاذِ في Redis مُعرِّفُ تيليجرام لا
 * `users.id` — فلو انتُظِرَ التسجيلُ ليُعرَفَ المفتاحُ لانقلبَ الترتيبُ.
 */
export async function readUserTelegramId(sql: Sql, userId: string): Promise<string | null> {
  const rows = await sql<{ telegram_id: string | null }[]>`
    select telegram_id::text as telegram_id from users where id = ${userId}::uuid
  `;
  const value = rows[0]?.telegram_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * سجلُّ قرارِ إبطالِ جلساتِ Mini App (`SEC-18-ب`). **يُستدعى بعدَ الإنفاذِ**:
 * إنفاذٌ بلا أثرٍ أسلمُ من أثرٍ بلا إنفاذٍ، وإخفاقُ التسجيلِ يُعادُ بلا ضرَرٍ
 * (ضربُ العتبةِ نفسِها مرّتَينِ لا يُغيِّرُ شيئاً).
 */
export async function logMiniAppSessionRevocation(
  sql: Sql,
  actorUserId: string,
  targetUserId: string,
  reason: string,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_revoke_miniapp_sessions(
      ${actorUserId}::uuid, ${targetUserId}::uuid, ${reason}::text
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

export async function setUserBlocked(
  sql: Sql,
  actorUserId: string,
  targetUserId: string,
  blocked: boolean,
): Promise<WriteOutcome> {
  const rows = await sql<{ result: unknown }[]>`
    select admin_set_user_blocked(
      ${actorUserId}::uuid, ${targetUserId}::uuid, ${blocked}::boolean
    ) as result
  `;
  return readWrite(rows[0]?.result);
}

// ---------------------------------------------------------------------------
// مواضع السائقين الحيّة — المرحلة ٦
//
// اللقطة التي يبدأ بها مجرى SSE، وتُعاد قراءتها دورياً بعده. ولماذا لقطةٌ ثم
// دلتا، لا دلتا وحدها؟ لأن المشغّل يفتح اللوحة في منتصف اليوم: لو بُنيت خريطته
// من الأحداث وحدها لبقيت فارغةً حتى يتحرّك كل سائق مرّةً — ودقائقُ من فراغٍ في
// شاشة إرسالٍ أسوأ من غيابها، لأنها تُقرأ «لا سائق متاح».
//
// وإعادة القراءة الدورية هي مِرساة الصحّة: هذه الدالّة تقرأ من القاعدة، فما
// تعرضه اللوحة يعود دائماً إلى المصدر القانوني وإن سقط حدثٌ في الطريق.
//
// وحالة الجلسة (نشط/متأخّر) **لا تُحسب هنا**: تُعاد الوقائع الزمنية كما هي
// ويحكم عليها المجال (`sessionStateAt`). فالسقف الزمني للتأخّر سياسةٌ واحدة في
// موضع واحد، لا `interval` في SQL يخالف يوماً ثابتاً في TypeScript.
// ---------------------------------------------------------------------------

export interface LiveDriverPositionRow {
  readonly driverId: string;
  readonly driverName: string | null;
  readonly cityId: string;
  readonly cityCode: string;
  readonly lat: number;
  readonly lng: number;
  readonly quality: string | null;
  readonly accuracyMeters: number | null;
  /** زمن جهاز السائق للإصلاحة (المرحلة ٥) — قد يغيب لموقعٍ كُتب قبلها. */
  readonly recordedAt: string | null;
  /**
   * `null` = لا جلسةَ تتبّعٍ مفتوحة. صار الحقل يقبل الفراغ في المرحلة ١٣ لأن
   * الصفَّ لم يبقَ مشروطاً بجلسةٍ مفتوحة: سائقٌ على رحلةٍ حيّةٍ يُعرَض ولو أُغلقت
   * جلستُه — يُنظر تعليقُ الدالّة.
   */
  readonly sessionStartedAt: string | null;
  readonly lastFixAt: string | null;
  /**
   * `BUG-009` — معرّفُ الجلسةِ المفتوحةِ وآخرُ رقمٍ تُمِّله هذه اللقطةُ.
   *
   * ومعناهما في اللقطةِ دقيقٌ: هذا الصفُّ يمثّل حالةَ القناةِ `sessionId`
   * عندَ الرقمِ `sequence`، فمن يأخذها يُحاذي `lastAppliedSeq` عنده بها ثمّ
   * يُسقِط كلَّ حدثٍ لا يزيد عليه (`ADR 0053` §٣-أ/٨).
   *
   * `null` = لا جلسةَ مفتوحةَ — مع `sessionStartedAt` بعينِه.
   *
   * **ولا تُقرأ ضماناً لـ`lat`/`lng` في هذا الصفَّ**: الموقعُ من `drivers.last_location`
   * وكتابتُه غيرُ محروسةٍ بترتيبٍ بعد (وهو `BUG-001`، لم يُنفَّذ بعد).
   * فالرقمُ مرساةُ محاذاةٍ للأحداثِ، لا شاهدٌ على أنَّ الإحداثيّةَ أحدثُ ما ورد.
   */
  readonly sessionId: string | null;
  readonly sessionSequence: number | null;
  /** `driver_availability.is_available` — الإتاحةُ المُعلنة، حكمُ الحالة عند غياب رحلة. */
  readonly isAvailable: boolean;
  readonly tripId: string | null;
  readonly tripStatus: string | null;
  /** نقطتا الرحلة — تُشتَقّ منهما حالاتُ الوصول (AT_PICKUP/ARRIVED) في المجال. */
  readonly pickupLat: number | null;
  readonly pickupLng: number | null;
  readonly dropoffLat: number | null;
  readonly dropoffLng: number | null;
}

/**
 * ## تغييرُ المرحلة ١٣: موضوعُ الاستعلام صار السائق لا الجلسة
 *
 * كان الاستعلام يبدأ من `tracking_sessions` بشرط `ended_at is null`، فكان معناه
 * الفعلي «السائقون الذين لهم جلسةُ تتبّعٍ مفتوحة». وقِيس أثرُ ذلك في المرحلة ١٣
 * على قاعدةٍ حقيقية: سائقٌ حالةُ رحلته `in_progress` وجلستُه أُغلقت (سقفُ الاثنتي
 * عشرة ساعة، أو `EXPIRED` من المهمّة المجدولة) كان **يغيب عن الخريطة كليّاً** —
 * راكبٌ في سيّارةٍ ولا يستطيع المشغّل رؤية سائقها ألبتّة، فلا يستطيع تدخّلاً ولا
 * إجابةَ سؤالٍ ولا فتحَ نزاع. وهذا أخطرُ من عرضِ موقعٍ قديم: العرضُ القديم يُوسَم
 * `STALE` فيُحكَم عليه، والغيابُ لا يُوسَم بشيء لأن لا شيءَ هناك.
 *
 * فصار الموضوعُ السائق، والشرطُ **جلسةٌ مفتوحة أو رحلةٌ حيّة**. والرحلةُ الحيّة
 * أقوى سببٍ للرؤية من الجلسة، لأنها التزامٌ قائمٌ تجاه راكبٍ لا مجرّد دوام.
 *
 * وما **لم** يتغيّر: من ليس في الخدمة وليس على رحلةٍ حيّة **لا يُعرض موقعُه**. هذا
 * قرارُ الخصوصية المتّخذ في المرحلة ١٢ (P12-3) ويبقى قائماً — و`OFFLINE` حالةٌ
 * يعرفها المجال ولا تُرسَم على الخريطة، ولا تُعدُّ ثقباً في التغطية.
 *
 * وحالةُ الجلسة (نشط/متأخّر) **لا تُحسب هنا**: تُعاد الوقائع الزمنية كما هي ويحكم
 * عليها المجال (`operationsStatusOf` ⇐ `sessionStateAt`). فالسقفُ الزمني سياسةٌ
 * واحدة في موضعٍ واحد، لا `interval` في SQL يخالف ثابتاً في TypeScript.
 */
export async function listLiveDriverPositions(
  sql: Sql,
  cityId: string | null,
): Promise<readonly LiveDriverPositionRow[]> {
  const rows = await sql<
    {
      driver_id: string;
      driver_name: string | null;
      city_id: string;
      city_code: string;
      lat: number | null;
      lng: number | null;
      quality: string | null;
      accuracy_m: number | null;
      recorded_at: string | null;
      session_started_at: string | null;
      last_fix_at: string | null;
      session_id: string | null;
      last_sequence: number | null;
      is_available: boolean | null;
      trip_id: string | null;
      trip_status: string | null;
      pickup_lat: number | null;
      pickup_lng: number | null;
      dropoff_lat: number | null;
      dropoff_lng: number | null;
    }[]
  >`
    select d.id as driver_id,
           u.full_name as driver_name,
           d.city_id, c.code as city_code,
           st_y(d.last_location::geometry) as lat,
           st_x(d.last_location::geometry) as lng,
           d.last_location_quality as quality,
           d.last_location_accuracy_m as accuracy_m,
           d.last_location_recorded_at as recorded_at,
           s.started_at as session_started_at,
           s.last_fix_at,
           -- BUG-009: الوصلةُ إلى tracking_sessions كانت قائمةً هنا أصلاً، فمرساةُ
           -- المحاذاةِ عمودانِ لا استعلامٌ ثانٍ ولا سطحٌ جديد (ADR 0053 §٣-أ/٨).
           s.id as session_id,
           s.last_sequence,
           coalesce(a.is_available, false) as is_available,
           coalesce(s.trip_id, o.id) as trip_id,
           o.status::text as trip_status,
           st_y(o.pickup::geometry) as pickup_lat,
           st_x(o.pickup::geometry) as pickup_lng,
           st_y(o.dropoff::geometry) as dropoff_lat,
           st_x(o.dropoff::geometry) as dropoff_lng
      from drivers d
      join users u on u.id = d.user_id
      join cities c on c.id = d.city_id
      left join tracking_sessions s
             on s.driver_id = d.id and s.ended_at is null
      left join driver_availability a on a.driver_id = d.id
      -- الرحلةُ الحيّة تُقرأ من جدول orders مباشرةً لا من s.trip_id: جلسةٌ مُغلقة
      -- لا تحمل رحلتَها إلى هذا الصفّ، وهي بعينِها الحالةُ التي كان السائق يغيب
      -- فيها عن الخريطة. و limit 1 تحسم تعدّدَ الرحلات النظري بأحدثِ إسناد —
      -- وقيدُ القاعدة يمنع تعدّدَها فعلاً، لكن استعلاماً يُضاعف الصفوف عند خللٍ
      -- في البيانات يُنتج سائقاً مرسوماً مرّتين على الخريطة.
      left join lateral (
        select o2.id, o2.status, o2.pickup, o2.dropoff
          from orders o2
         where o2.assigned_driver_id = d.id
           and o2.status in ('matched', 'in_progress')
         order by o2.matched_at desc nulls last
         limit 1
      ) o on true
     where d.last_location is not null
       and (s.id is not null or o.id is not null)
       ${cityId === null ? sql`` : sql`and d.city_id = ${cityId}::uuid`}
     order by s.last_fix_at desc nulls last
  `;

  return rows
    .filter((row) => row.lat !== null && row.lng !== null)
    .map((row) => ({
      driverId: row.driver_id,
      driverName: row.driver_name,
      cityId: row.city_id,
      cityCode: row.city_code,
      lat: Number(row.lat),
      lng: Number(row.lng),
      quality: row.quality,
      accuracyMeters: row.accuracy_m === null ? null : Number(row.accuracy_m),
      recordedAt: row.recorded_at === null ? null : String(row.recorded_at),
      sessionStartedAt: row.session_started_at === null ? null : String(row.session_started_at),
      lastFixAt: row.last_fix_at === null ? null : String(row.last_fix_at),
      sessionId: row.session_id,
      sessionSequence: row.last_sequence === null ? null : Number(row.last_sequence),
      isAvailable: row.is_available === true,
      tripId: row.trip_id,
      tripStatus: row.trip_status,
      pickupLat: row.pickup_lat === null ? null : Number(row.pickup_lat),
      pickupLng: row.pickup_lng === null ? null : Number(row.pickup_lng),
      dropoffLat: row.dropoff_lat === null ? null : Number(row.dropoff_lat),
      dropoffLng: row.dropoff_lng === null ? null : Number(row.dropoff_lng),
    }));
}

/** صفُّ موقعٍ حيٍّ وقد اقترنت به حالتُه التشغيلية المُشتقّة. */
export interface LiveDriverStatusRow extends LiveDriverPositionRow {
  readonly status: OperationsStatus;
}

/**
 * موضعُ الاشتقاق **الواحد** لحالة السائق التشغيلية.
 *
 * صفحةُ الخريطة ولقطةُ SSE تقرآن الحالةَ من هنا كلتاهما. ولو حسبت كلٌّ منهما
 * حالتَها لأمكن أن تُظهر الصفحةُ `AT_PICKUP` ويُظهر المجرى الحيّ `TO_PICKUP`
 * للسائق نفسه في اللحظة نفسها — وهو أسوأُ من غياب الميزة، لأن المشغّل لا يعرف
 * أيَّ الشاشتين يُصدّق. والدالّةُ نفسها في المجال خالصةٌ: هذه محضُ ترجمةِ صفِّ
 * قاعدةٍ إلى وقائع.
 */
export function operationsStatusOfRow(row: LiveDriverPositionRow, nowMs: number): OperationsStatus {
  const facts: OperationsFacts = {
    session:
      row.sessionStartedAt === null
        ? null
        : {
            driverId: row.driverId,
            tripId: row.tripId,
            startedAtMs: Date.parse(row.sessionStartedAt),
            lastFixAtMs: row.lastFixAt === null ? null : Date.parse(row.lastFixAt),
            endedAtMs: null,
            endReason: null,
          },
    isAvailable: row.isAvailable,
    driverLocation: { latitude: row.lat, longitude: row.lng },
    trip:
      row.tripStatus === null
        ? null
        : {
            status: row.tripStatus,
            pickup:
              row.pickupLat === null || row.pickupLng === null
                ? null
                : { latitude: row.pickupLat, longitude: row.pickupLng },
            destination:
              row.dropoffLat === null || row.dropoffLng === null
                ? null
                : { latitude: row.dropoffLat, longitude: row.dropoffLng },
          },
  };
  return operationsStatusOf(facts, nowMs);
}

/** يقرأ المواقعَ الحيّة ويُلحق بكلٍّ منها حالتَه — المدخلُ الوحيد للعرض. */
export async function listLiveDriverStatuses(
  sql: Sql,
  cityId: string | null,
  nowMs: number = Date.now(),
): Promise<readonly LiveDriverStatusRow[]> {
  const rows = await listLiveDriverPositions(sql, cityId);
  return rows.map((row) => ({ ...row, status: operationsStatusOfRow(row, nowMs) }));
}

// ---------------------------------------------------------------------------
// البثّ الجماعي — سجلّ الحملات وتقدّمها
// ---------------------------------------------------------------------------

/** حدُّ سجلّ الحملات المعروضة. تقنيةُ عرضٍ لا سياسةُ أعمال. */
export const BROADCAST_HISTORY_LIMIT = 20;

/**
 * صفُّ حملةٍ واحدة كما يُقرأ في اللوحة. الدفعةُ هي الوحدة لا الحملة: بثٌّ إلى
 * «كلّ المدن» صفٌّ لكلّ مدينة في القاعدة، لكنّ المسؤول أرسل رسالةً واحدة ويجب أن
 * يرى تقدّمَها واحداً ويُلغيها بإلغاءٍ واحد.
 */
export interface BroadcastCampaignRow {
  readonly batchId: string;
  readonly audience: "drivers" | "riders";
  readonly cities: string;
  readonly cityCount: number;
  readonly body: string;
  readonly filters: string;
  readonly silent: boolean;
  readonly linkLabel: string | null;
  readonly linkUrl: string | null;
  readonly status: "sending" | "completed" | "canceled";
  readonly total: number;
  readonly sent: number;
  readonly failed: number;
  readonly pending: number;
  readonly canceled: number;
  readonly createdBy: string | null;
  readonly createdAt: string;
}

export async function listBroadcastCampaigns(
  sql: Sql,
  limit: number = BROADCAST_HISTORY_LIMIT,
): Promise<readonly BroadcastCampaignRow[]> {
  const rows = await sql<
    {
      batch_id: string;
      audience: string;
      cities: string | null;
      city_count: number;
      body: string;
      filters: string;
      silent: boolean;
      link_label: string | null;
      link_url: string | null;
      status: string;
      total: number;
      sent: number;
      failed: number;
      pending: number;
      canceled: number;
      created_by: string | null;
      created_at: string;
    }[]
  >`
    with batches as (
      select cam.batch_id,
             min(cam.created_at) as created_at,
             min(cam.audience) as audience,
             count(*) as city_count,
             string_agg(distinct c.name_ar, '، ') as cities,
             min(cam.body) as body,
             min(cam.filters::text) as filters,
             bool_or(cam.silent) as silent,
             min(cam.link_label) as link_label,
             min(cam.link_url) as link_url,
             bool_or(cam.status = 'sending') as any_sending,
             bool_and(cam.status = 'canceled') as all_canceled,
             sum(cam.recipients_total)::int as total,
             min(u.full_name) as created_by
        from broadcast_campaigns cam
        join cities c on c.id = cam.city_id
        join users u on u.id = cam.created_by_user_id
       group by cam.batch_id
       order by min(cam.created_at) desc
       limit ${limit}
    )
    select b.batch_id, b.audience, b.cities, b.city_count::int as city_count,
           b.body, b.filters, b.silent, b.link_label, b.link_url,
           case when b.any_sending then 'sending'
                when b.all_canceled then 'canceled'
                else 'completed' end as status,
           b.total, b.created_by, b.created_at,
           coalesce(r.sent, 0)::int as sent,
           coalesce(r.failed, 0)::int as failed,
           coalesce(r.pending, 0)::int as pending,
           coalesce(r.canceled, 0)::int as canceled
      from batches b
      left join lateral (
        select count(*) filter (where rec.status = 'delivered') as sent,
               count(*) filter (where rec.status = 'failed') as failed,
               count(*) filter (where rec.status in ('pending', 'sending')) as pending,
               count(*) filter (where rec.status = 'canceled') as canceled
          from notification_outbox rec
          join broadcast_campaigns cc on cc.id = rec.broadcast_campaign_id
         where cc.batch_id = b.batch_id and rec.kind = 'broadcast_recipient'
      ) r on true
     order by b.created_at desc
  `;
  return rows.map((row) => ({
    batchId: row.batch_id,
    audience: row.audience === "riders" ? "riders" : "drivers",
    cities: row.cities ?? "—",
    cityCount: Number(row.city_count),
    body: row.body,
    filters: row.filters,
    silent: row.silent,
    linkLabel: row.link_label,
    linkUrl: row.link_url,
    status:
      row.status === "sending" ? "sending" : row.status === "canceled" ? "canceled" : "completed",
    total: Number(row.total),
    sent: Number(row.sent),
    failed: Number(row.failed),
    pending: Number(row.pending),
    canceled: Number(row.canceled),
    createdBy: row.created_by,
    createdAt: String(row.created_at),
  }));
}

// ---------------------------------------------------------------------------
// SEC-20 — مسارُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ صريحةٍ وسجلِّ قرارٍ كاملٍ
//
// الفجوةُ: لا مسارَ استردادٍ إن فُقِدَ حسابُ تيليجرام. والطلبُ يُربَطُ بـ
// `users.id` الداخليِّ لا بـ`telegram_id`. المسؤولُ يحدِّدُ `target_user_id`
// صراحةً، والقرارُ يلزمُ سببًا من معجمٍ مغلقٍ، والأثرُ في `audit_log`.
// ---------------------------------------------------------------------------

export interface AccountRecoveryRequest {
  readonly id: string;
  readonly targetUserId: string;
  readonly claimantTelegramId: string | null;
  readonly evidenceSummary: string;
  readonly submittedAt: string;
  readonly targetFullName: string | null;
  readonly targetTelegramId: string | null;
  readonly targetIsBlocked: boolean;
}

/** أسبابُ القرارِ من معجمٍ مغلقٍ (سابقةُ `PD-021`). */
const RECOVERY_DECISION_REASONS = [
  "identity_verified",
  "identity_not_confirmed",
  "insufficient_evidence",
  "telegram_account_lost",
  "duplicate_account",
  "policy_violation",
  "user_request",
] as const;

export type RecoveryDecisionReason = (typeof RECOVERY_DECISION_REASONS)[number];

export function isRecoveryDecisionReason(value: string): value is RecoveryDecisionReason {
  return (RECOVERY_DECISION_REASONS as readonly string[]).includes(value);
}

export function submitAccountRecoveryRequest(
  sql: Sql,
  cityId: string,
  targetUserId: string,
  claimantTelegramId: string | null,
  evidenceSummary: string,
  createdBy: string,
): Promise<WriteOutcome> {
  return sql<{ result: unknown }[]>`
    select submit_account_recovery_request(
      ${cityId}::uuid, ${targetUserId}::uuid,
      ${claimantTelegramId}::text, ${evidenceSummary}::text,
      ${createdBy}::uuid
    ) as result
  `.then((rows) => readWrite(rows[0]?.result));
}

export function reviewAccountRecoveryRequest(
  sql: Sql,
  requestId: string,
  actorUserId: string,
  decision: "approved" | "rejected",
  reason: string,
): Promise<WriteOutcome> {
  return sql<{ result: unknown }[]>`
    select review_account_recovery_request(
      ${requestId}::uuid, ${actorUserId}::uuid,
      ${decision}::account_recovery_status, ${reason}::account_recovery_decision_reason
    ) as result
  `.then((rows) => readWrite(rows[0]?.result));
}

export async function listPendingRecoveryRequests(
  sql: Sql,
  actorUserId: string,
  cityId: string,
): Promise<AccountRecoveryRequest[]> {
  const rows = await sql<{ result: unknown }[]>`
    select list_pending_account_recovery_requests(
      ${actorUserId}::uuid, ${cityId}::uuid
    ) as result
  `;
  const parsed = rows[0]?.result as
    | { ok: boolean; requests?: Array<Record<string, unknown>> }
    | undefined;
  if (!parsed?.ok || !Array.isArray(parsed.requests)) {
    return [];
  }
  return parsed.requests.map((r) => ({
    id: String(r.id),
    targetUserId: String(r.target_user_id),
    claimantTelegramId: r.claimant_telegram_id === null ? null : String(r.claimant_telegram_id),
    evidenceSummary: String(r.evidence_summary),
    submittedAt: String(r.submitted_at),
    targetFullName: r.target_full_name === null ? null : String(r.target_full_name),
    targetTelegramId: r.target_telegram_id === null ? null : String(r.target_telegram_id),
    targetIsBlocked: r.target_is_blocked === true,
  }));
}
