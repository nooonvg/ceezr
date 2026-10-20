/**
 * الغرض: كل ما تمسّه المطابقة في القاعدة: المرشّحون، العروض، فتح دورة بثّ، القبول الذرّي، والرفض.
 *   القبول لا يُنفَّذ هنا منطقياً إطلاقاً: يُفوَّض كاملاً إلى الدالة claim_ride (القاعدة 0.5).
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/dispatch
 * يُتوقع أن يستخدمه لاحقاً: application/dispatch/*، apps/workers
 * ملاحظات مستقبلية: عند كبر عدد السائقين يُضاف فلتر مكاني بـ ST_DWithin بنصف قطر المدينة.
 */

import type { OfferDecisionPort } from "../../application/bots/types.ts";
import type {
  InsertedOffer,
  OfferWriter,
  OpenRoundInput,
} from "../../application/dispatch/broadcast-offers.ts";
import type {
  ExpireOffersRpcPort,
  PendingOfferRepository,
} from "../../application/dispatch/expire-offers-ports.ts";
import type {
  SearchingOrderFinder,
  SearchingOrderRef,
} from "../../application/dispatch/redispatch-searching-orders.ts";
import type {
  ClaimedRider,
  DispatchRpcPort,
  DriverCandidateRepository,
  NearbyCandidateQuery,
  OfferRepository,
} from "../../application/ports/index.ts";
import type { DriverCapability } from "../../domain/capability/entity.ts";
import type { DriverCandidate } from "../../domain/dispatch/entity.ts";
import type { Offer, OfferStatus } from "../../domain/dispatch/value-objects.ts";
import type {
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from "../../domain/subscription/entity.ts";
import type { Order } from "../../domain/transport/entity.ts";
import type { CityId, DriverId, OfferId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, readEnvelope, type Sql, withRequestContext } from "../db/client.ts";
import { toOrder } from "../transport/order-adapters.ts";

interface CandidateRow {
  readonly driver_id: string;
  readonly city_id: string;
  readonly lat: number | null;
  readonly lng: number | null;
  /** المرحلة ٨ — بالنصّ لا بالرقم: `bigint` من القاعدة يفقد دقّته في `number` عند التحويل الضمني. */
  readonly location_at_ms: string | null;
  /** `WR-23` — حكمُ مُقيِّمِ GPS المخزَّن (`ACCEPT` · `WARNING` · `ALERT`) أو `null` لصفٍّ أقدم. */
  readonly location_quality: string | null;
  readonly is_available: boolean | null;
  readonly verification_status: string;
  readonly is_blocked: boolean;
  readonly preferred_lat: number | null;
  readonly preferred_lng: number | null;
  readonly rating_average: string | null;
  readonly rating_count: number;
  readonly services: readonly string[] | null;
  readonly sub_plan: string | null;
  readonly sub_status: string | null;
  readonly sub_trial_ends_at: Date | null;
  readonly sub_current_period_end: Date | null;
  readonly sub_cancel_at_period_end: boolean | null;
}

function toCandidate(row: CandidateRow): DriverCandidate {
  const driverId = row.driver_id as DriverId;
  const cityId = row.city_id as CityId;
  const capabilities: readonly DriverCapability[] = (row.services ?? []).map((service) => ({
    driverId,
    cityId,
    service: service as ServiceType,
    isEnabled: true,
  }));
  const subscription: Subscription | null =
    row.sub_status === null || row.sub_plan === null
      ? null
      : {
          driverId,
          cityId,
          plan: row.sub_plan as SubscriptionPlan,
          status: row.sub_status as SubscriptionStatus,
          trialEndsAt: row.sub_trial_ends_at,
          currentPeriodEnd: row.sub_current_period_end,
          cancelAtPeriodEnd: row.sub_cancel_at_period_end === true,
        };
  return {
    driverId,
    cityId,
    /**
     * غياب الموقع يُمرّر كـ`null` لا كـ(0,0): الصفر إحداثية صالحة في المحيط الأطلسي،
     * وتمريرها يجعل الدومين يحسب مسافة حقيقية من موقع مختلق ويردّ `OUT_OF_RADIUS`
     * بدلاً من `NO_LOCATION` — فيُطارد المشغّل سبباً خاطئاً.
     */
    location:
      row.lat === null || row.lng === null
        ? null
        : { latitude: Number(row.lat), longitude: Number(row.lng) },
    /**
     * المرحلة ٨ — زمنُ **وصول** الموقع إلى الخادم. `null` يُمرَّر `null` ولا
     * يُستبدل بـ`Date.now()`: الاستبدال كان سيجعل كل صفٍّ بلا طابع يبدو وصل
     * هذه اللحظة، أي يتجاوز حَرَس القِدَم دائماً — وهو نفس عطب `Number(lat ?? 0)`
     * بصورةٍ زمنية: قيمةٌ مختلقة تمرّ من كل فحصٍ لأنها تبدو معقولة.
     */
    locationAtMs: row.location_at_ms === null ? null : Number(row.location_at_ms),
    locationQuality:
      row.location_quality === "ACCEPT" ||
      row.location_quality === "WARNING" ||
      row.location_quality === "ALERT"
        ? row.location_quality
        : null,
    /**
     * المنطقة المفضّلة — البند 2.4. `null` هنا يعني «لا منطقة» لا «منطقة عند
     * الصفر»: نفس السبب الذي مُنع من أجله `Number(lat ?? 0)` في `location`.
     * وقيد `drivers_preferred_area_pair` يضمن أن العمودين يحضران أو يغيبان معاً،
     * فالفحص على أحدهما لا يترك نصف نقطة تمرّ.
     */
    preferredArea:
      row.preferred_lat === null || row.preferred_lng === null
        ? null
        : { latitude: Number(row.preferred_lat), longitude: Number(row.preferred_lng) },
    isAvailable: row.is_available === true,
    isVerified: row.verification_status === "verified",
    isBlocked: row.is_blocked,
    ratingAverage: row.rating_average === null ? null : Number(row.rating_average),
    ratingCount: Number(row.rating_count ?? 0),
    capabilities,
    subscription,
  };
}

export function createDriverCandidateRepository(sql: Sql): DriverCandidateRepository {
  return {
    /**
     * يجلب كلّ سائقي المدينة؛ الفلترة والترتيب مسؤولية الدومين لا القاعدة.
     *
     * حُذف شرط `and d.last_location is not null` قصداً: كان يجعل القاعدة تتخذ قرار
     * استبعاد تملكه القواعد التجارية وحدها، فيختفي السائق قبل أن يُسمّى سببه — وهو
     * نفس العلّة التي من أجلها نُقل `is_blocked` من SQL إلى الدومين سابقاً.
     * الأثر العمليّ: سائق بلا موقع لا يُسنَد إليه شيء كما كان، لكنّه يظهر الآن في
     * `evaluation.rejected` بـ`NO_LOCATION`، فيراه المشغّل ويُذكّر بإرسال موقعه.
     */
    findAvailableInCity: (cityId: CityId) =>
      guard("candidates.findAvailableInCity", async () => {
        const rows = await sql<CandidateRow[]>`
          select d.id as driver_id,
                 d.city_id,
                 st_y(d.last_location::geometry) as lat,
                 st_x(d.last_location::geometry) as lng,
                 -- زمن الخادم لا طابع الجهاز: السؤال «متى عرفنا؟» لا «متى يقول إنه كان؟»
                 (extract(epoch from d.last_location_at) * 1000)::bigint::text as location_at_ms,
                 d.last_location_quality as location_quality,
                 st_y(d.preferred_area_location::geometry) as preferred_lat,
                 st_x(d.preferred_area_location::geometry) as preferred_lng,
                 a.is_available,
                 d.verification_status,
                 u.is_blocked,
                 d.rating_average,
                 d.rating_count,
                 (select array_agg(c.service::text)
                    from driver_capabilities c
                   where c.driver_id = d.id and c.is_enabled) as services,
                 s.plan as sub_plan,
                 s.status as sub_status,
                 s.trial_ends_at as sub_trial_ends_at,
                 s.current_period_end as sub_current_period_end,
                 s.cancel_at_period_end as sub_cancel_at_period_end
            from drivers d
            join users u on u.id = d.user_id
            left join driver_availability a on a.driver_id = d.id
            left join subscriptions s
                   on s.driver_id = d.id and s.status in ('trialing', 'active')
           where d.city_id = ${cityId}
        `;
        return rows.map(toCandidate);
      }),

    /**
     * CAP-003 — المسار السريع. استعلام PostGIS واحد على فهرس GiST:
     *   - البوابات الصلبة: المدينة، غير محجوب، موثَّق، متاح، داخل نصف القطر.
     *   - عمرُ الموقع إن فُعّل (صفرٌ = تعطيل، كما وثّقت المرحلة ٨).
     *   - الترتيبُ بالمسافة (`<->` KNN يستخدم فهرس GiST) ثم `LIMIT`.
     *
     * الخدمةُ والاشتراكُ والاستبعادُ هذه الدورة **لا** يُفلترانِ هنا: منطقُهما
     * معتمدٌ على `now` وعلى خريطة plan→service معقّدة، والاستبعادُ قرارٌ تشغيليٌّ
     * يُرى في `rejected` بسببه المُسمّى `EXCLUDED_THIS_ROUND`. يُتركانِ للدومين فوقَ
     * نتيجةٍ محدودة النافذة — وحدُّ النافذة أوسعُ من دفعة البثّ عمداً.
     *
     * ترتيبُ المعاملات في `ST_MakePoint` هو (lng, lat) — x ثم y — لا العكس.
     */
    findNearbyAvailableForDispatch: (args: NearbyCandidateQuery) =>
      guard("candidates.findNearbyAvailableForDispatch", async () => {
        const { cityId, pickup, searchRadiusKm, driverLocationMaxAgeSeconds, limit, now } = args;
        const radiusMeters = Math.max(0, searchRadiusKm * 1000);
        const maxAge = driverLocationMaxAgeSeconds ?? 0;
        const rows = await sql<CandidateRow[]>`
          select d.id as driver_id,
                 d.city_id,
                 st_y(d.last_location::geometry) as lat,
                 st_x(d.last_location::geometry) as lng,
                 (extract(epoch from d.last_location_at) * 1000)::bigint::text as location_at_ms,
                 d.last_location_quality as location_quality,
                 st_y(d.preferred_area_location::geometry) as preferred_lat,
                 st_x(d.preferred_area_location::geometry) as preferred_lng,
                 a.is_available,
                 d.verification_status,
                 u.is_blocked,
                 d.rating_average,
                 d.rating_count,
                 (select array_agg(c.service::text)
                    from driver_capabilities c
                   where c.driver_id = d.id and c.is_enabled) as services,
                 s.plan as sub_plan,
                 s.status as sub_status,
                 s.trial_ends_at as sub_trial_ends_at,
                 s.current_period_end as sub_current_period_end,
                 s.cancel_at_period_end as sub_cancel_at_period_end
            from drivers d
            join users u on u.id = d.user_id
            left join driver_availability a on a.driver_id = d.id
            left join subscriptions s
                   on s.driver_id = d.id and s.status in ('trialing', 'active')
           where d.city_id = ${cityId}
             and u.is_blocked = false
             and d.verification_status = 'verified'
             and a.is_available = true
             and d.last_location is not null
             -- WR-23: موقعٌ حكمُه ALERT لا يملأُ نافذةَ LIMIT ولا يُرتَّبُ به (السببُ مُسمّىً في
             -- findAvailableInCity حينَ تفرغُ النافذة).
             and d.last_location_quality is distinct from 'ALERT'
             and st_dwithin(
                   d.last_location,
                   st_setsrid(st_makepoint(${pickup.longitude}, ${pickup.latitude}), 4326)::geography,
                   ${radiusMeters}
                 )
             ${
               maxAge > 0
                 ? sql`and d.last_location_at is not null
                        and (extract(epoch from (${now}::timestamptz - d.last_location_at))) <= ${maxAge}`
                 : sql``
             }
           order by d.last_location <->
                    st_setsrid(st_makepoint(${pickup.longitude}, ${pickup.latitude}), 4326)::geography
           limit ${limit}
        `;
        return rows.map(toCandidate);
      }),
  };
}

interface OfferRow {
  readonly order_id: string;
  readonly driver_id: string;
  readonly status: string;
  readonly created_at: Date;
  readonly round: number;
}

export function createOfferRepository(sql: Sql): OfferRepository {
  return {
    findByOrder: (orderId: OrderId) =>
      guard("offers.findByOrder", async () => {
        const rows = await sql<OfferRow[]>`
          select order_id, driver_id, status, created_at, round
            from order_offers
           where order_id = ${orderId}
           order by round, created_at
        `;
        return rows.map(
          (row): Offer => ({
            orderId: row.order_id as OrderId,
            driverId: row.driver_id as DriverId,
            status: row.status as OfferStatus,
            sentAt: row.created_at,
            round: row.round,
          }),
        );
      }),
  };
}

/** حالاتُ الطلبِ كما يعرفُها المجالُ — لتُقرأ من نصِّ المغلَّفِ بلا ثقةٍ عمياء. */
const ORDER_STATUSES: readonly Order["status"][] = [
  "scheduled",
  "searching",
  "matched",
  "in_progress",
  "completed",
  "cancelled",
  "failed",
];

function readOrderStatus(value: unknown): Order["status"] | null {
  const text = readText(value);
  return ORDER_STATUSES.find((status) => status === text) ?? null;
}

export function createOfferWriter(sql: Sql): OfferWriter {
  return {
    /**
     * فتحُ دورةِ بثٍّ. لا منطقَ هنا إطلاقاً: القرارُ كلُّه في `open_offer_round`
     * داخلَ القاعدةِ — حراسةُ الحالِ وحجزُ رقمِ الدورةِ وإنشاءُ العروضِ في معاملةٍ
     * واحدةٍ. وما كان هنا قبلَه — حلقةُ إدخالٍ ثمَّ تحديثٌ بلا حارسٍ — كان يفتحُ
     * دورتَينِ لطلبٍ واحدٍ متى تزامنَ استدعاءانِ (`BUG-005`).
     */
    openRound: (input: OpenRoundInput) =>
      guard("offers.openRound", async () => {
        const entries = input.entries.map((entry) => ({
          driver_id: entry.driverId,
          score: entry.score,
          distance_km: entry.distanceKm,
        }));
        const rows = await sql<{ result: unknown }[]>`
          select open_offer_round(
                   ${input.orderId}::uuid,
                   ${input.round}::integer,
                   ${input.expiresAt}::timestamptz,
                   ${sql.json(entries as never)}::jsonb
                 ) as result
        `;
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ open_offer_round غير مفهوم");

        const raw = envelope as unknown as Record<string, unknown>;
        if (envelope.ok) {
          const inserted = raw.offers;
          /**
           * `offer_ids` يصدرُ من الإدراجِ نفسِه في الدالةِ الذرّيةِ، فيملكُ كلَّ
           * عرضٍ مُدرَجٍ معرّفَه. ولا يُبنى زرُّ رفضٍ إلّا لعرضٍ له صفٌّ في القاعدةِ —
           * فلا يُرفضُ ما لم يُخلَق (`BUG-003`). والقراءةُ متساهلةٌ كالعقدِ كلهِ:
           * مغلَّفٌ بلا `offer_ids` يُقرأ صفوفاً صفراً، فلا يَنكسِرُ منادٍ قديمٌ
           * بلا أن يُحجزَ له صفٌّ.
           */
          const offers = readInsertedOffers(raw.offer_ids);
          return {
            opened: true as const,
            offersInserted: typeof inserted === "number" ? inserted : offers.length,
            offers,
          };
        }

        const refusal = envelope.error ?? "UNKNOWN";
        if (refusal === "ORDER_NOT_FOUND" || refusal === "ROUND_ALREADY_OPENED") {
          return { opened: false as const, refusal };
        }
        if (refusal === "ORDER_NOT_SEARCHING") {
          const status = readOrderStatus(raw.status);
          /**
           * رفضٌ بحالٍ لا نعرفُه ليس رفضاً مفهوماً: يُرفَع عطلاً بدل أن يُخمَّن
           * حالٌ لم تقُله القاعدةُ ويُكتَب في سجلِّ التشغيلِ كأنّه مقروءٌ.
           */
          if (status === null) throw new Error("حالُ الطلبِ في ردِّ open_offer_round غير معروف");
          return { opened: false as const, refusal, status };
        }
        throw new Error("سببُ رفضِ open_offer_round غير معروف");
      }),
  };
}

/**
 * قراءةُ نصٍّ إخباريٍّ من مغلَّف jsonb: ما ليس نصّاً ولا رقماً يُعامَل كالغائب.
 * والرقم يُحوّل لأنّ `telegram_id` يصل رقماً من jsonb ومنافذُ الإرسال تأخذ نصّاً.
 */
function readText(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  return null;
}

/**
 * معرّفاتُ العروضِ المُدرَجةِ كما رجعَت من `open_offer_round`. تُقرأُ بتساهلٍ: صفٌّ
 * ناقصُ `offer_id` أو `driver_id` يُترَكُ لا أن يُفسدَ البقيةَ، فلا يُخطرُ سائقٌ
 * بلا معرّفِ عرضٍ يحصرُ رفضَه (`BUG-003`).
 */
function readInsertedOffers(value: unknown): readonly InsertedOffer[] {
  if (!Array.isArray(value)) return [];
  const offers: InsertedOffer[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const offerId = readText(row.offer_id);
    const driverId = readText(row.driver_id);
    if (offerId === null || driverId === null) continue;
    offers.push({ offerId: offerId as OfferId, driverId: driverId as DriverId });
  }
  return offers;
}

/** راكبٌ يُقرأ أو لا يُقرأ: معرّفُ تلغرام وحده شرطٌ — بلاه لا إخطار أصلاً. */
function readRider(value: unknown): ClaimedRider | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const telegramId = readText(row.telegram_id);
  if (telegramId === null) return null;
  return {
    riderId: readText(row.rider_id) ?? "",
    telegramId,
    languageCode: readText(row.language_code) ?? "ar",
    fullName: readText(row.full_name) ?? "",
  };
}

export function createDispatchRpc(sql: Sql): DispatchRpcPort {
  return {
    claimRide: (orderId: OrderId, driverId: DriverId) =>
      guard("rpc.claim_ride", async () => {
        // `F8-01` — موضعٌ موصولٌ مُعلَنٌ: تجري الدعوةُ داخلَ معاملةٍ يُضبَطُ فيها
        // المتغيّرُ الجلسيُّ للمعرِّفِ أوّلاً (اسمُه في `client.ts` وحدَه), فكلُ ما تكتبُه هذه الدالّةُ الذرّيّةُ في الجداولِ
        // المُعلَنةِ يحملُ معرِّفَ وحدةِ العملِ. والقائمةُ في سجلِّ العقدِ لا ههنا،
        // فالحاجزُ يعُدُّها ويمنعُ توسيعَها صمتاً.
        const rows = await withRequestContext(
          sql,
          (tx) => tx<{ result: unknown }[]>`
            select claim_ride(${orderId}::uuid, ${driverId}::uuid) as result
          `,
        );
        const envelope = readEnvelope(rows[0]?.result);
        if (envelope === null) throw new Error("ردّ claim_ride غير مفهوم");
        if (!envelope.ok) {
          return {
            claimed: false,
            duplicate: false,
            reason: envelope.error ?? "UNKNOWN",
            cityId: null,
            rider: null,
            driverName: null,
            driverPlate: null,
            driverVehicle: null,
          };
        }
        /**
         * القراءةُ متساهلة عن قصد: مغلَّفٌ ناقصُ حقلٍ إخباريّ لا يجوز أن يُحوّل
         * إسناداً وقع في القاعدة إلى عطلٍ يراه السائق. الحقلُ الناقص يخرج `null`
         * فيمتنع الإخطار وحده، والإسنادُ باقٍ.
         */
        const raw = envelope as unknown as Record<string, unknown>;
        return {
          claimed: true,
          /**
           * `BUG-008` — الحكمُ من المغلَّفِ لا من غيابِ حقل: مغلَّفٌ قديمٌ بلا
           * `duplicate` (نسخةُ قاعدةٍ لم تُهاجَر بعد) يُقرأ إسناداً أوّلَ كما
           * كان، فلا يتغيّر سلوكٌ قائمٌ بلا سبب.
           */
          duplicate: raw.duplicate === true,
          reason: null,
          cityId: readText(raw.city_id) as CityId | null,
          rider: readRider(raw.rider),
          driverName: readText(raw.driver_name),
          driverPlate: readText(raw.driver_plate),
          driverVehicle: readText(raw.driver_vehicle),
          // `WR-09` — مغلَّفٌ بلا الحقلِ (قاعدةٌ أقدم) إسنادٌ فوريٌّ كما كان.
          pendingRider: raw.pending_rider === true,
          candidateExpiresAt: readText(raw.expires_at),
        };
      }),
  };
}

export function createOfferDecisionPort(sql: Sql): OfferDecisionPort {
  return {
    /**
     * الرفضُ يَصوبُ على عرضٍ واحدٍ بمعرّفِه، لا على كلِّ عرضٍ معلَّقٍ للسائقِ على
     * الطلبِ. فقبلَ `BUG-003` كان الرفضُ يُصيبُ بالاسمِ `(order_id, driver_id)` كلَّ
     * عرضٍ معلَّقٍ مهما اختلفتْ جولتُه، فيُلغي بضغطةٍ واحدةٍ عروضاً ما زالتْ
     * محتمِلةً لم تنتهِ مهلتُها. والآن يُحدِّدُ `id` العرضَ بعينِه — وهو المفتاحُ
     * الذي يُثبِتُ `order_id` و`round` معاً (المفتاحُ الفريدُ يَعنِي الصفَّ كلَّه)،
     * و`driver_id` يَحرُسُ أن لا يرفضَ سائقٌ عرضَ غيرِه، و`status = 'pending'` يَحرُسُ
     * أن لا يُرفضَ عرضٌ قُبِل أو انتهى بأثرٍ رجعيّ.
     */
    reject: (offerId: OfferId, driverId: DriverId) =>
      guard("offers.reject", async () => {
        const rows = await sql<{ id: string }[]>`
          update order_offers
             set status = 'rejected', responded_at = now(), updated_at = now()
           where id = ${offerId}::uuid
             and driver_id = ${driverId}::uuid
             and status = 'pending'
          returning id
        `;
        return rows.length > 0;
      }),
  };
}

/**
 * العروض المعلَّقة في مدينة واحدة مع معرّفاتها. المعرّف ضروري لأن مهمّة الإنهاء
 * تقرّر بالمهلة التجارية للمدينة ثم تُنهي عروضاً بعينها، لا كل ما مضى وقته.
 */
export function createPendingOfferRepository(sql: Sql): PendingOfferRepository {
  const base = createOfferRepository(sql);
  return {
    findByOrder: base.findByOrder,

    findPendingInCity: (cityId: CityId) =>
      guard("offers.findPendingInCity", async () => {
        const rows = await sql<(OfferRow & { readonly id: string })[]>`
          select id, order_id, driver_id, status, created_at, round
            from order_offers
           where city_id = ${cityId}
             and status = 'pending'
             -- WR-09: عرضُ مرشَّحٍ حيٍّ لا تنتهي مهلتُه والراكبُ يقرّر؛ موعدُه للقاعدة.
             and not exists (
               select 1 from orders o
                where o.candidate_offer_id = order_offers.id
                  and o.candidate_expires_at > now()
             )
           order by created_at
        `;
        return rows.map((row) => ({
          id: row.id,
          orderId: row.order_id as OrderId,
          driverId: row.driver_id as DriverId,
          status: row.status as OfferStatus,
          sentAt: row.created_at,
          round: row.round,
        }));
      }),
  };
}

/**
 * إنهاء عروض بعينها في عبارة واحدة. شرط status = 'pending' جزءٌ من العبارة نفسها لا
 * فحصٌ قبلها: سائقٌ يقبل في نفس اللحظة التي تعمل فيها المهمّة يجب أن يفوز بالقبول،
 * والقيد order_offers_single_accepted يحرس النتيجة في القاعدة على كل حال.
 */
export function createExpireOffersRpc(sql: Sql): ExpireOffersRpcPort {
  return {
    expireStaleOffers: (_cityId: CityId, offerIds: readonly string[]) =>
      guard("offers.expireStaleOffers", async () => {
        if (offerIds.length === 0) return 0;
        const rows = await sql<{ id: string }[]>`
          update order_offers
             set status = 'expired', responded_at = now(), updated_at = now()
           where id = any(${sql.array(offerIds as string[])}::uuid[])
             and status = 'pending'
          returning id
        `;
        return rows.length;
      }),
  };
}

/**
 * قارئُ الطلبات الباحثة — المرحلة ١٤.
 *
 * ولماذا لا يُرشَّح هنا بعددِ الدورات ولا بوجود عرضٍ قائم، والاستعلامُ يستطيع ذلك
 * في سطرين؟ لأنّ حدَّ الدورات مقروءٌ من إعدادات المدينة (`max_broadcast_rounds`)
 * ومُطبَّقٌ في `hasExhaustedBroadcastRounds`، واستبعادَ من له عرضٌ حيّ مُطبَّقٌ في
 * `driversToExclude` بمهلةٍ مقروءةٍ من الإعدادات كذلك. فكتابةُ أيٍّ منهما هنا تنسخ
 * سياسةً إلى SQL: يوم يتغيّر الحدُّ في القاعدة يبقى الشرطُ المكتوبُ كما هو، فتُحجَب
 * طلباتٌ يجوز بثُّها أو تُبَثّ طلباتٌ استنفدت دوراتها — والفرقُ لا يظهر في أيّ
 * اختبارٍ لأنّ كلا الموضعين «صحيحٌ» على انفراد.
 *
 * والثمنُ مقبولٌ ومحسوب: طلبٌ له عرضٌ حيٌّ يُقرأ ثم يُردّ عنه `matchOrder` بلا كتابة
 * — دورةُ مطابقةٍ ضائعةٌ لا كتابةٌ خاطئة، وحدُّ `limit` يحصر عددَها.
 */
export function createSearchingOrderFinder(sql: Sql): SearchingOrderFinder {
  return {
    findSearching: (
      cityId: CityId,
      limit: number,
      opts?: { readonly maxBroadcastRounds?: number; readonly liveRoundGraceSeconds?: number },
    ) =>
      guard("orders.findSearching", async (): Promise<readonly SearchingOrderRef[]> => {
        const fairWindow =
          opts !== undefined &&
          opts.maxBroadcastRounds !== undefined &&
          Number.isFinite(opts.maxBroadcastRounds) &&
          opts.maxBroadcastRounds >= 1;
        const maxRounds = opts?.maxBroadcastRounds ?? 0;
        const graceSec = Math.max(0, opts?.liveRoundGraceSeconds ?? 0);
        const rows = await sql<
          {
            id: string;
            city_id: string;
            service: string;
            status: string;
            pickup_lat: number;
            pickup_lng: number;
            dropoff_lat: number | null;
            dropoff_lng: number | null;
            assigned_driver_id: string | null;
            broadcast_round: number;
            waiting_seconds: string | number;
          }[]
        >`
          select o.id      as id,
                 o.city_id as city_id,
                 o.service as service,
                 o.status  as status,
                 -- LOAD-01 · P4 (ب24): أعمدةُ اللقطةِ من ORDER_SELECT نفسِها — يُعيدُ
                 -- الشوطُ استخدامَ قراءةِ القارئِ بدلَ رحلةٍ فرديةٍ لكلِّ طلبٍ على الاتصالِ
                 -- التسلسليّ. التحويلُ بدالّةِ toOrder نفسِها فلا معنى ثانٍ لصفِّ الطلبِ.
                 st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng,
                 st_y(o.dropoff::geometry) as dropoff_lat, st_x(o.dropoff::geometry) as dropoff_lng,
                 o.assigned_driver_id as assigned_driver_id,
                 o.broadcast_round as broadcast_round,
                 extract(epoch from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds
            from orders o
           where o.city_id = ${cityId}::uuid
             and o.status = 'searching'
             and o.assigned_driver_id is null
             -- WR-09: لا جولةَ جديدةَ والراكبُ يقرّرُ في مرشَّحٍ حيّ.
             and (o.candidate_expires_at is null or o.candidate_expires_at <= now())
             -- النافذة العادلة (LOAD-01 · 2026-10-17): حين يمرر المستدعي حد الدورات
             -- الأقصى — قراءة من إعدادات المدينة في المجال لا قيمة هنا — تُقدَّم
             -- الطلبات غير المستنفدة بالأقدم أولا، والمستنفدة (الدورة >= الحد) لا
             -- تدخل النافذة إلا بفضل سعتها: فلا تحتكرها (عيب D8) ولا يُحرم رصدها
             -- (تبقى مصنفة exhausted عند المجال متى فُحصت). والقيمة تمر من الخارج
             -- فليس هنا سياسة مملوكة: الباب ينفذ معيار من يملك الحكم
             -- (hasExhaustedBroadcastRounds والقيمة من parseCitySettings عند المستدعي).
             -- والأقدم أولا هو ما يمنع تجويع القديم خلف تدفق الجديد: قيس في موجة
             -- 250 أن 36 طلبا ذا سائق مؤهل متاح لم تخدم في 120ث لأن ترتيب الدورة
             -- الأدنى (إصلاح D8) قدم كل طلب جديد عليها في كل شوط.
             -- غياب المعامل = السلوك القائم حرفيا (توافق خلفي يحفظ انحدار D8).
           -- D8 (CAP-RUN-20261015): الترتيب بـcreated_at وحده جعل الطلباتِ المستنفِدةَ دوراتِها
           -- (تبقى searching حتى يلغيها الراكب) تملأ نافذةَ الـlimit في كلّ شوط فلا يُفحَص طلبٌ جديد
           -- أبداً («examined=50 rebroadcast=0 exhausted=50»). تقديمُ الدورة الأدنى ترتيبٌ لا فتوى:
           -- لا يُستبعَد أحد، والحكمُ بالاستنفاد يبقى في المجال (hasExhaustedBroadcastRounds).
           -- LOAD-01 · P4 (2026-10-18): داخلَ النافذةِ العادلةِ يتأخّرُ الطلبُ الذي جولتُه الأخيرةُ
           -- **حيّةٌ وحديثةٌ** (عرضٌ معلَّقٌ لم تنقضِ مهلتُه وعمرُه دونَ مهلةِ السماحِ) خلفَ كلِّ ما
           -- سواه، والأقدمُ أولاً داخلَ كلِّ صنفٍ. قيسَ في موجةِ 500 على 1ac6b860 أنَّ 38.6% من
           -- مقاعدِ الشوطِ ذهبت لإعادةِ بثِّ طلباتٍ جولتُها حيّةٌ (1508 جولاتٍ فُتحت بعدَ ≤3.8ث من
           -- سابقتِها والمهلةُ 45ث) قبلَ أن يرى سائقُها العرضَ، فانتظرَ الجديدُ ~35ث قبلَ أوّلِ
           -- معالجةٍ تستغرقُ ~15ms. وتأخيرُ كلِّ جولةٍ حيّةٍ حتى انقضائِها (التجربةُ «أ» b9-fixA500)
           -- جوّعَ الطلباتِ التي فاتَت جولتُها الأولى سائقَها حتى 45ث (P4=72ث) — فالمهلةُ قصيرةٌ
           -- بقدرِ ظهورِ العرضِ وقبولِه لا بقدرِ مهلةِ العرضِ. لا يُستبعَدُ أحدٌ ولا يُجوَّعُ قديمٌ:
           -- بعدَ المهلةِ يعودُ الطلبُ إلى ترتيبِ العمرِ فيسبقُ الأحدثَ منه.
           order by
             ${
               fairWindow
                 ? sql`(o.broadcast_round >= ${maxRounds}) asc,
                       exists (
                         select 1 from order_offers f
                          where f.order_id = o.id
                            and f.round = o.broadcast_round
                            and f.status = 'pending'
                            and f.expires_at > now()
                            and f.created_at > now() - make_interval(secs => ${graceSec})
                       ) asc,
                       o.created_at asc`
                 : sql`o.broadcast_round asc, o.created_at asc`
             }
           limit ${limit}
        `;
        return rows.map((row) => ({
          orderId: row.id as OrderId,
          cityId: row.city_id as CityId,
          waitingSeconds: Number(row.waiting_seconds),
          order: toOrder({
            id: row.id,
            city_id: row.city_id,
            service: row.service,
            status: row.status,
            pickup_lat: row.pickup_lat,
            pickup_lng: row.pickup_lng,
            dropoff_lat: row.dropoff_lat,
            dropoff_lng: row.dropoff_lng,
            assigned_driver_id: row.assigned_driver_id,
            broadcast_round: row.broadcast_round,
          }),
        }));
      }),
  };
}
