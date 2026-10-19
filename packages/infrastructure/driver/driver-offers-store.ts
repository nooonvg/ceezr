/**
 * الغرض: محوّلُ عروضِ السائقِ على PostgreSQL — نداءُ الدوالِّ الثلاثِ وقراءةُ
 *   حمولتِها **بلا افتراضٍ** (`F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — قراءةُ الرحلةِ النشطةِ للسائقِ تُضافُ
 *   طريقةً ههنا، فلا محوِّلَ ثانياً للسائقِ على القاعدةِ نفسِها.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ المسافةُ تُقرأُ **موسومةً أو معدومةً** ولا رقماً
 *
 * `order_offers.distance_km` قد يكونُ `null` (صفٌّ كُتِبَ بلا قياسٍ)، و«صفرُ
 * مترٍ» تُقرأُ «أنتَ عندَ الراكبِ» — وهيَ كذبةٌ لا يُصلِحُها تنسيقٌ في الشاشةِ.
 * فما لا يُقاسُ يُنقَلُ `null` وينتهي الأمرُ عندَ حدِّه (`ADR 0023`).
 *
 * ## ولِمَ حمولةٌ ناقصةٌ **عطبٌ لا صفٌّ ناقصٌ**
 *
 * دالّةٌ قالَت `ok: true` ثمَّ غابَ عنها `server_time` **ليسَت نصفَ جوابٍ**:
 * لوحٌ بلا لحظةِ خادمٍ يجعلُ العدَّ التنازليَّ ساعةَ جهازٍ — وهوَ عينُ ما مُنِعَ.
 * فتُردُّ `MALFORMED_RESULT` ويُقرأُ `503`، ولا تُخترَعُ لحظةٌ ههنا.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ، والمعرّفُ يُفحَصُ رقميّاً
 *      قبلَ إرسالِه إلى `bigint`.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يقفلُ صفّاً ولا يُحدِّثُ حالةً**: القبولُ نداءُ `driver_accept_offer`
 *      التي تُفوِّضُ إلى `claim_ride` — **ولا `update` ههنا ألبتّةَ**.
 *   ــ **لا يقرأُ هويّةَ راكبٍ**: لا يُطلَبُ ولا يُنشَرُ.
 */

import type {
  DriverOfferStore,
  DriverOfferStoreError,
  DriverOfferStoreRejection,
} from "../../application/driver/offer-ports.ts";
import type { RiderTripDepositOutcome } from "../../application/driver/rider-trip-notice.ts";
import {
  type DriverEligibilityReason,
  type DriverOfferBoard,
  type DriverOfferCard,
  type DriverOfferClaim,
  type DriverOfferDetail,
  type DriverOfferPlace,
  isDriverOfferStatus,
  isDriverOrderStatus,
  isServiceType,
} from "../../domain/driver/driver-offers.ts";
import type { TaggedDistance } from "../../domain/quote/distance-kind.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";
import {
  type ExtrasRow,
  type OrderPlaceExtras,
  parseOrderPlaceExtrasRow,
  readOrderPlaceExtras,
} from "../transport/order-place-extras.ts";

/** مجالُ الرفضِ المغلقُ — يُقابِلُ رموزَ الدوالِّ الثلاثِ و`claim_ride` حرفاً. */
const REJECTIONS: readonly DriverOfferStoreRejection[] = [
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "OFFER_NOT_FOUND",
  "ORDER_NOT_CLAIMABLE",
  "OFFER_NOT_VALID",
  "ORDER_HELD",
  "CITY_MISMATCH",
  "CLAIM_REFUSED",
  "DRIVER_HAS_ACTIVE_ORDER",
];

function failed(reason: "STORE_ERROR" | "MALFORMED_RESULT"): DriverOfferStoreError {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : null;
}

function readNumber(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const text = readText(value);
  if (text === null) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** كما في `driver-documents-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function rejectionFrom(payload: Record<string, unknown>): DriverOfferStoreError {
  const code = readText(payload.error);
  if (code === null || !(REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  return { rejection: code as DriverOfferStoreRejection };
}

/**
 * المسافةُ الموسومةُ. و**الوسمُ يُقرأُ ولا يُفترَضُ**: حمولةٌ فيها أمتارٌ بلا
 * صنفٍ حمولةٌ فاسدةٌ — لأنَّ صنفاً مفروضاً في المحوِّلِ يجعلُ يومَ إضافةِ
 * `ROUTE` كلَّ مسافةٍ «مستقيمةً» بحكمِ سطرٍ قديمٍ.
 */
function readTaggedDistance(value: unknown): TaggedDistance | null | "malformed" {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return "malformed";
  if (value.kind !== "STRAIGHT_LINE") return "malformed";
  const meters = readNumber(value.meters);
  if (meters === null || meters < 0) return "malformed";
  return { kind: "STRAIGHT_LINE", meters };
}

function readPlace(value: unknown): DriverOfferPlace | null {
  if (!isRecord(value)) return null;
  const latitude = readNumber(value.latitude);
  const longitude = readNumber(value.longitude);
  if (latitude === null || longitude === null) return null;
  return {
    label: typeof value.label === "string" ? value.label : null,
    latitude,
    longitude,
  };
}

function readOfferCard(value: unknown): DriverOfferCard | null {
  if (!isRecord(value)) return null;
  const offerId = readText(value.offer_id);
  const orderId = readText(value.order_id);
  const round = readInteger(value.round);
  const secondsLeft = readInteger(value.seconds_left);
  const service = value.service;
  if (
    offerId === null ||
    orderId === null ||
    round === null ||
    secondsLeft === null ||
    secondsLeft < 0 ||
    !isServiceType(service)
  ) {
    return null;
  }
  const riderDistance = readTaggedDistance(value.rider_distance);
  const tripDistance = readTaggedDistance(value.trip_distance);
  if (riderDistance === "malformed" || tripDistance === "malformed") return null;
  return {
    offerId,
    orderId,
    round,
    service,
    secondsLeft,
    riderDistance,
    tripDistance,
    pickupLabel: typeof value.pickup_label === "string" ? value.pickup_label : null,
    dropoffLabel: typeof value.dropoff_label === "string" ? value.dropoff_label : null,
  };
}

function readBlockReasons(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const reasons: string[] = [];
  for (const item of value) {
    const text = readText(item);
    // سببٌ لا يُقرأُ نصّاً **يُهمَلُ من التسميةِ ولا يُبطِلُ الحجبَ**: الحجبُ
    // قائمٌ بـ`is_blocked` سواءٌ فُهِمَ اسمُه أم لا.
    if (text !== null) reasons.push(text);
  }
  return reasons;
}

interface ResultRow {
  readonly result: unknown;
}

/**
 * `LOAD-01` (P4) — صفُّ القراءةِ الموحّدةِ للوحِ: حمولةُ الدالّةِ وملاحقُ الأماكنِ
 * (خريطةٌ `order_id` → حقولُ الصفِّ) وأعمدةُ الأهليةِ، كلُّ ذلك في جولةِ قاعدةٍ
 * واحدةٍ. الأهليةُ قد تعدمَ (سائقٌ غيرُ موجودٍ) فأعمدتُهُ معدومةٌ — ويُعادُ لها
 * المسارُ القديمُ نفسُهُ: قائمةُ أسبابٍ فارغةٌ.
 */
interface MergedBoardRow {
  readonly payload: unknown;
  readonly verification_status: string | null;
  readonly has_location: boolean | null;
  readonly location_quality: string | null;
  readonly age_seconds: number | null;
  readonly max_age_seconds: number | null;
  readonly extras: unknown;
}

/** أعمدةُ الأهليةِ من الصفِّ الموحّدِ — أو قائمةٌ فارغةٌ إن عدِمَ السائقُ. */
function eligibilityFromMergedRow(row: MergedBoardRow): readonly DriverEligibilityReason[] {
  if (row.verification_status === null) return [];
  return eligibilityReasonsFrom({
    verificationStatus: row.verification_status,
    hasLocation: row.has_location === true,
    ageSeconds: row.age_seconds === null ? null : Number(row.age_seconds),
    maxAgeSeconds: row.max_age_seconds === null ? 0 : Number(row.max_age_seconds),
    locationQuality: row.location_quality,
  });
}

/**
 * خريطةُ ملاحقِ الأماكنِ من حمولةِ القراءةِ الموحّدةِ — بناءُ الخريطةِ نفسِهِ لا
 * يُفسدُ اللوحَ: قيمةٌ غيرُ مقروءةٍ لعرضٍ تُتْرَكُ (البطاقةُ كما هي) كما كانَ في
 * المسارِ القديمِ تماماً.
 */
function parseExtrasJson(value: unknown): ReadonlyMap<string, OrderPlaceExtras> {
  const found = new Map<string, OrderPlaceExtras>();
  if (!isRecord(value)) return found;
  for (const [orderId, fields] of Object.entries(value)) {
    if (!isRecord(fields)) continue;
    found.set(orderId, parseOrderPlaceExtrasRow(fields as unknown as ExtrasRow));
  }
  return found;
}

/**
 * تركيبُ اللوحِ النهائيِّ من حمولةِ الدالّةِ وملاحقِ الأماكنِ والأهليةِ — دالةٌ
 * واحدةٌ مشتركةٌ بينَ القراءةِ الموحّدةِ (عبارةٌ واحدةٌ) وتركيبِ المسارِ القديمِ
 * في الاختبارِ، كي يكونَ إثباتُ التكافؤِ عبرَ التركيبِ نفسِهِ لا عبرَ نسخةٍ ثانيةٍ
 * منه. `LOC-TRUST-01`: الرابطُ الأصليُّ وملاحظاتُ المكانِ لطلباتِ اللوحِ نفسِه وحدَها؛
 * عرضٌ بلا ملاحقَ يبقى بطاقتَه كما هي (لا يسقطُ ولا يُسكَتُ).
 */
export function composeDriverOfferBoard(
  payload: Record<string, unknown>,
  parts: {
    readonly extrasMap: ReadonlyMap<string, OrderPlaceExtras>;
    readonly eligibilityReasons: readonly DriverEligibilityReason[];
  },
): Result<DriverOfferBoard, DriverOfferStoreError> {
  const serverTime = readInstant(payload.server_time);
  const blockReasons = readBlockReasons(payload.block_reasons);
  if (
    serverTime === null ||
    blockReasons === null ||
    typeof payload.is_available !== "boolean" ||
    typeof payload.is_blocked !== "boolean" ||
    !Array.isArray(payload.offers)
  ) {
    return err(failed("MALFORMED_RESULT"));
  }

  const offers: DriverOfferCard[] = [];
  for (const item of payload.offers) {
    const card = readOfferCard(item);
    // بطاقةٌ لا تُقرأُ **تُسقِطُ اللوحَ كلَّه**: عرضٌ مُهمَلٌ صامتاً عملٌ
    // يفوتُ سائقاً بلا أن يعلمَ أحدٌ، وذاكَ أسوأُ من عطبٍ مُعلَنٍ.
    if (card === null) return err(failed("MALFORMED_RESULT"));
    offers.push(card);
  }

  const enriched = offers.map((card): DriverOfferCard => {
    const found = parts.extrasMap.get(card.orderId);
    return found === undefined
      ? card
      : {
          ...card,
          pickupExtras: found.pickup,
          dropoffExtras: found.dropoff,
          offerTerms: found.offerTerms,
        };
  });

  return ok({
    serverTime,
    isAvailable: payload.is_available,
    availabilityChangedAt:
      payload.availability_changed_at === null
        ? null
        : readInstant(payload.availability_changed_at),
    isBlocked: payload.is_blocked,
    blockReasons,
    eligibilityReasons: parts.eligibilityReasons,
    offers: enriched,
  });
}

/**
 * `WR-11` — أسبابُ الاستبعادِ المعروفةُ بلا طلب، بالقواعدِ نفسِها التي يحكمُ بها التوزيع:
 * التوثيقُ (`NOT_VERIFIED`)، ثمَّ الموضعُ (`NO_LOCATION`)، ثمَّ قِدَمُه بزمنِ الخادمِ
 * `last_location_at` مقابلَ `driver_location_max_age_seconds` لمدينتِه — والصفرُ يُطفئُ الحارس
 * (`isLocationStale`). قراءةٌ فقط، وتعذُّرُها يُعيدُ قائمةً فارغةً: اللوحُ لا يسقطُ لشرحٍ إضافيّ.
 */
export async function readDriverEligibility(
  sql: Sql,
  telegramId: string,
): Promise<readonly DriverEligibilityReason[]> {
  try {
    const rows = await sql<
      {
        verification_status: string;
        has_location: boolean;
        location_quality: string | null;
        age_seconds: number | null;
        max_age_seconds: number | null;
      }[]
    >`
      select d.verification_status::text as verification_status,
             d.last_location is not null as has_location,
             d.last_location_quality as location_quality,
             extract(epoch from (now() - d.last_location_at))::float8 as age_seconds,
             (select (s.value #>> '{}')::numeric::float8
                from platform_settings s
               where s.key = 'driver_location_max_age_seconds' and s.city_id = d.city_id
               limit 1) as max_age_seconds
        from drivers d
        join users u on u.id = d.user_id
       where u.telegram_id = ${telegramId}::bigint
       limit 1
    `;
    const row = rows[0];
    if (row === undefined) return [];
    return eligibilityReasonsFrom({
      verificationStatus: row.verification_status,
      hasLocation: row.has_location,
      ageSeconds: row.age_seconds === null ? null : Number(row.age_seconds),
      maxAgeSeconds: row.max_age_seconds === null ? 0 : Number(row.max_age_seconds),
      locationQuality: row.location_quality,
    });
  } catch {
    return [];
  }
}

/** الحكمُ النقيُّ — مرتَّبٌ كترتيبِ `rejectionReasonFor`، والسببُ الأوّلُ أولى بالقول. */
export function eligibilityReasonsFrom(input: {
  readonly verificationStatus: string;
  readonly hasLocation: boolean;
  readonly ageSeconds: number | null;
  readonly maxAgeSeconds: number;
  readonly locationQuality?: string | null;
}): readonly DriverEligibilityReason[] {
  const reasons: DriverEligibilityReason[] = [];
  if (input.verificationStatus !== "verified") reasons.push("NOT_VERIFIED");
  if (!input.hasLocation) reasons.push("NO_LOCATION");
  else if (
    input.maxAgeSeconds > 0 &&
    (input.ageSeconds === null ||
      !Number.isFinite(input.ageSeconds) ||
      input.ageSeconds > input.maxAgeSeconds)
  ) {
    reasons.push("STALE_LOCATION");
  } else if (input.locationQuality === "ALERT") {
    reasons.push("UNTRUSTED_LOCATION");
  }
  return reasons;
}

/** معرّفٌ صالحٌ للإيصالِ: UUID فقط — ما عداه يُهمَلُ لا يُفسدُ الدفعةَ. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresDriverOfferStore implements DriverOfferStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  /**
   * `LOAD-01 Recovery` — إيصالاتُ اللوحِ: يَحلُّ الجلسةَ إلى سائقٍ (join واحدٌ)
   * ويُدرجُ الإيصالاتِ بلا مساسٍ بحالةِ العرضِ. المعرّفاتُ غيرُ الصالحةِ
   * (UUID) تُهمَلُ صامتةً لا أن تُسقِطَ الدفعةَ كلَّها، والسقفُ 50 إيصالًا
   * في النداءِ (عميلٌ واحدٌ لا يُغرقُ القناةَ بالدفوعاتِ).
   */
  async recordBoardReceipts(input: {
    readonly telegramUserId: string;
    readonly offerIds: readonly string[];
  }): Promise<Result<{ readonly recorded: number }, DriverOfferStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));
    const validIds = [...new Set(input.offerIds)]
      .filter((id) => UUID_PATTERN.test(id))
      .slice(0, 50);
    if (validIds.length === 0) return ok({ recorded: 0 });
    try {
      const rows = await this.#sql<{ recorded: number }[]>`
        with ins as (
          insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at)
          select dr.id, v.offer_id::uuid, dr.city_id, now()
          from (
            select d.id, d.city_id from drivers d
            join users u on u.id = d.user_id
            where u.telegram_id = ${telegramId}::bigint
          ) dr
          join unnest(${validIds}::text[]) as v(offer_id) on true
          on conflict do nothing
          returning 1
        )
        select count(*)::int as recorded from ins`;
      return ok({ recorded: rows[0]?.recorded ?? 0 });
    } catch {
      return err(failed("STORE_ERROR"));
    }
  }

  async readBoard(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverOfferBoard, DriverOfferStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    /**
     * `LOAD-01` (P4) — قراءةُ اللوحِ بجولةِ قاعدةٍ واحدةٍ لا ثلاثِ جولاتٍ:
     * اللوحُ والملاحقُ والأهليةُ في عبارةٍ واحدةٍ. عقدُ الاستجابةِ لم يتغيرّ
     * (نفسُ الحقولِ ونفسُ الدلالاتِ) — تغيّرَ عددُ الذهاباتِ والإياباتِ فقط.
     *
     * ملاحظةُ أمانةٍ معماريّةٍ: المسارُ القديمُ كانَ يتسامحُ معَ فشلِ استعلامِ
     * الملاحقِ أو الأهليةِ (يعيدُ اللوحَ بلا ملاحقَ/بلا أسبابِ)؛ والعبارةُ الواحدةُ
     * فشلُها واحدٌ. الأعمدةُ المشارُ إليها هنا أقدمُ هجراتٍ من دالةِ اللوحِ نفسِها،
     * فما دامت الدالةُ موجودةً فالأعمدةُ موجودةٌ — ولا سيناريو واقعيّاً يفشلُ فيهِ
     * جزءٌ وينجحُ الآخرُ إلا عطبُ القاعدةِ كلِّها وهوَ يُفشلُ اللوحَ في المسارينِ.
     */
    let rows: MergedBoardRow[];
    try {
      rows = await this.#sql<MergedBoardRow[]>`
        with board as (
          select driver_offer_board(${telegramId}::bigint) as payload
        ),
        elig as (
          select d.verification_status::text as verification_status,
                 d.last_location is not null as has_location,
                 d.last_location_quality as location_quality,
                 extract(epoch from (now() - d.last_location_at))::float8 as age_seconds,
                 (select (s.value #>> '{}')::numeric::float8
                    from platform_settings s
                   where s.key = 'driver_location_max_age_seconds' and s.city_id = d.city_id
                   limit 1) as max_age_seconds
            from drivers d
            join users u on u.id = d.user_id
           where u.telegram_id = ${telegramId}::bigint
           limit 1
        ),
        extras as (
          select coalesce(jsonb_object_agg(x.order_id, x.fields), '{}'::jsonb) as extras
          from (
            select o.id::text as order_id, jsonb_build_object(
              'id', o.id::text,
              'pickup_link', o.pickup_link,
              'pickup_notes', o.pickup_notes,
              'pickup_lat', st_y(o.pickup::geometry),
              'pickup_lng', st_x(o.pickup::geometry),
              'has_dropoff', (o.dropoff is not null),
              'dropoff_link', o.dropoff_link,
              'dropoff_notes', o.dropoff_notes,
              'dropoff_lat', st_y(o.dropoff::geometry),
              'dropoff_lng', st_x(o.dropoff::geometry),
              'rider_offer_mode', o.rider_offer_mode,
              'rider_offer_sar', o.rider_offer_sar,
              'pickup_at', to_jsonb(o.pickup_at)
            ) as fields
            from orders o
            where o.id in (
              select (entry->>'order_id')::uuid
              from board
              cross join lateral jsonb_array_elements(
                coalesce(board.payload->'offers', '[]'::jsonb)
              ) entry
            )
          ) x
        )
        select board.payload as payload,
               elig.verification_status as verification_status,
               elig.has_location as has_location,
               elig.location_quality as location_quality,
               elig.age_seconds as age_seconds,
               elig.max_age_seconds as max_age_seconds,
               extras.extras as extras
        from board
        left join elig on true
        cross join extras`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const row = rows[0];
    if (row === undefined) return err(failed("MALFORMED_RESULT"));
    const payload = row.payload;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    return composeDriverOfferBoard(payload, {
      extrasMap: parseExtrasJson(row.extras),
      eligibilityReasons: eligibilityFromMergedRow(row),
    });
  }

  async readDetail(input: {
    readonly telegramUserId: string;
    readonly offerId: string;
  }): Promise<Result<DriverOfferDetail, DriverOfferStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_offer_detail(${telegramId}::bigint, ${input.offerId}::uuid) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const serverTime = readInstant(payload.server_time);
    const offerId = readText(payload.offer_id);
    const orderId = readText(payload.order_id);
    const round = readInteger(payload.round);
    const secondsLeft = readInteger(payload.seconds_left);
    const pickup = readPlace(payload.pickup);
    const riderDistance = readTaggedDistance(payload.rider_distance);
    const tripDistance = readTaggedDistance(payload.trip_distance);
    const dropoff = payload.dropoff === null ? null : readPlace(payload.dropoff);
    if (
      serverTime === null ||
      offerId === null ||
      orderId === null ||
      round === null ||
      secondsLeft === null ||
      secondsLeft < 0 ||
      pickup === null ||
      riderDistance === "malformed" ||
      tripDistance === "malformed" ||
      (payload.dropoff !== null && dropoff === null) ||
      !isServiceType(payload.service) ||
      !isDriverOfferStatus(payload.offer_status) ||
      !isDriverOrderStatus(payload.order_status) ||
      typeof payload.is_claimable !== "boolean"
    ) {
      return err(failed("MALFORMED_RESULT"));
    }

    const extras = (await readOrderPlaceExtras(this.#sql, [orderId])).get(orderId);

    return ok({
      serverTime,
      offerId,
      orderId,
      round,
      service: payload.service,
      offerStatus: payload.offer_status,
      orderStatus: payload.order_status,
      secondsLeft,
      isClaimable: payload.is_claimable,
      pickup:
        extras === undefined
          ? pickup
          : { ...pickup, link: extras.pickup.link, notes: extras.pickup.notes },
      dropoff:
        dropoff === null || extras?.dropoff == null
          ? dropoff
          : { ...dropoff, link: extras.dropoff.link, notes: extras.dropoff.notes },
      riderDistance,
      tripDistance,
      notes: typeof payload.notes === "string" ? payload.notes : null,
      ...(extras === undefined ? {} : { offerTerms: extras.offerTerms }),
    });
  }

  async accept(input: {
    readonly telegramUserId: string;
    readonly offerId: string;
  }): Promise<Result<DriverOfferClaim, DriverOfferStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_accept_offer(${telegramId}::bigint, ${input.offerId}::uuid) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }
    return claimFrom(rows[0]?.result);
  }

  /**
   * LOAD-01 (الدفعةُ الخامسةَ عشرةَ) — `driver_accept_offer_with_matched_notice`: القبولُ **نفسُه**
   * (`driver_accept_offer` بلا تغيير) وإيداعُ MATCHED في معاملتِه، في رحلةٍ واحدة. ردُّ القبولِ يُقرأُ
   * بالقارئِ نفسِه حرفاً؛ و`rider_notice` غائبٌ ⇒ لا إيداعَ في العبارة.
   */
  async acceptWithMatchedNotice(input: {
    readonly telegramUserId: string;
    readonly offerId: string;
  }): Promise<
    Result<
      { readonly claim: DriverOfferClaim; readonly matchedNotice?: RiderTripDepositOutcome },
      DriverOfferStoreError
    >
  > {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_accept_offer_with_matched_notice(${telegramId}::bigint, ${input.offerId}::uuid) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }
    const payload = rows[0]?.result;
    const claim = claimFrom(payload);
    if (!claim.ok) return claim;
    const matchedNotice = isRecord(payload) ? depositOutcomeFrom(payload.rider_notice) : undefined;
    return ok({
      claim: claim.value,
      ...(matchedNotice === undefined ? {} : { matchedNotice }),
    });
  }
}

/** ردُّ `driver_accept_offer` كما كانَ يُقرأُ في `accept` حرفاً — قارئٌ واحدٌ للمسارَين. */
function claimFrom(payload: unknown): Result<DriverOfferClaim, DriverOfferStoreError> {
  if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
  if (payload.ok !== true) return err(rejectionFrom(payload));

  const orderId = readText(payload.order_id);
  if (orderId === null) return err(failed("MALFORMED_RESULT"));
  return ok({
    orderId,
    // لحظةُ المطابقةِ من القاعدةِ — وغيابُها **يُقالُ عَدَماً** ولا يُستبدَلُ
    // بساعةِ العمليّةِ: ختمٌ من ساعتَينِ مختلفتَينِ في سجلٍّ واحدٍ كذبٌ لطيفٌ.
    matchedAt: readInstant(payload.matched_at),
    // `WR-09` — حالُ الانتظارِ كما أعادَته القاعدة؛ غيابُه إسنادٌ فوريٌّ.
    pendingRider: payload.pending_rider === true,
    expiresAt: readInstant(payload.expires_at),
  });
}

/**
 * `rider_notice` = ردُّ `enqueue_rider_trip_notice` حرفاً، أو `{ok:false, error:'ENQUEUE_EXCEPTION'}`
 * من نقطةِ الحفظ. غيابُه ⇒ `undefined` (لا إيداعَ)؛ وشكلٌ غيرُ مفهومٍ ⇒ فشلٌ مُعلَنٌ لا نجاحٌ مُفترَض.
 */
export function depositOutcomeFrom(value: unknown): RiderTripDepositOutcome | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return { kind: "failed", error: "MALFORMED_NOTICE" };
  if (value.ok === true) {
    const tg = value.rider_telegram_id;
    return {
      kind: "deposited",
      created: value.created === true,
      riderTelegramId: typeof tg === "string" && tg.length > 0 ? tg : null,
    };
  }
  if (value.error === "ORDER_NOT_FOUND") return { kind: "order_missing" };
  return { kind: "failed", error: typeof value.error === "string" ? value.error : "UNKNOWN" };
}
