/**
 * الغرض: محوّلا أمرِ الرحلةِ وقراءةِ بحثِها على PostgreSQL — نداءُ `request_ride`
 *   واحدٌ ونداءُ `ride_search_state` واحدٌ، وقراءةُ حمولتِهما **بلا افتراضٍ**
 *   (البند `F2-05` · القاعدة 0.5).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: infrastructure/transport
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يزيدُ قارئَ الرحلةِ النشطةِ في هذا الملفِّ
 *   أو بجانبِه، ولا يعودُ إلى `insert into orders` مكشوفٍ.
 * ملاحظات مستقبلية: `packages/infrastructure/transport/order-adapters.ts` ما زالَ
 *   يُنشئُ صفّاً مكشوفاً لحوارِ البوتِ — **دَينٌ مُعلَنٌ** هجرتُه زيادةٌ لها حجزُها،
 *   ولا يُقرأُ سكوتاً عنه: حاجزُ `scripts/check-ride-request-contract.ts` يُثبِّتُ
 *   أنَّ مسارَ الشبكةِ لا يسلكُه.
 *
 * ## لماذا `sql.unsafe` بوسائطَ مُرقَّمةٍ
 *
 * كما في `quote-store.ts` و`places-store.ts`: النصُّ ثابتٌ في الملفِّ والقيمُ
 * وسائطُ مُرقَّمةٌ يُمرِّرُها برنامجُ التشغيلِ، فلا يُبنى نصُّ أمرٍ من مُدخَلٍ.
 * و`unsafe` ههنا اسمُ دالّةٍ لا وصفُ فعلٍ: لا تركيبَ نصوصٍ ألبتّةَ.
 *
 * ## ولماذا رمزٌ مجهولٌ **عطبٌ** لا رفضٌ
 *
 * لو مرَّرَ المحوّلُ كلَّ ما جاءَ بـ`ok:false` رفضاً، لَعرضَت الشاشةُ رمزاً لا
 * تملكُ له نصّاً، ولَبدا رفضٌ **أشدُّ** (كإيقافِ حسابٍ) رفضاً عاديّاً. فالمعروفُ
 * يُنقَلُ كما هوَ، والمجهولُ يُعلَنُ `STORE_ERROR` ويُسقِطُ الطلبَ بصدقٍ.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحكمُ على هندسةٍ ولا على تكرارٍ**: `st_covers` والدليلُ الفريدُ في
 *      القاعدةِ؛ وههنا أعدادٌ ونصوصٌ.
 *   ــ **لا يُعيدُ المحاولةَ من نفسِه**: إعادةٌ صامتةٌ بمفتاحٍ واحدٍ آمنةٌ، لكنَّ
 *      قرارَها للمسارِ لا للمحوّلِ.
 *   ــ **لا يقرأُ أجرةً ولا حقلاً مُعَدّاً لها**: لا حقلَ كذاكَ في الحمولةِ أصلاً.
 */

import type {
  CreatedRide,
  RideCancelCommand,
  RideCancelVerdict,
  RideRequestCommand,
  RideRequestRefusal,
  RideRequestVerdict,
  RideSearchReader,
  RideSearchState,
  RideSearchVerdict,
  RideStoreFailure,
} from "../../application/transport/ride-request-ports.ts";
import type { PlaceMeta } from "../../domain/places/place-input.ts";
import { isServiceKind } from "../../domain/quote/service-offer.ts";
import { isRideStatus } from "../../domain/transport/ride-request.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const RIDE_REFUSALS = [
  "INVALID_POINT",
  "CITY_HAS_NO_SERVICE_AREA",
  "CITY_NOT_ACTIVE",
  "ORIGIN_OUTSIDE_SERVICE_AREA",
  "DESTINATION_OUTSIDE_SERVICE_AREA",
  "SERVICE_NOT_AVAILABLE_IN_CITY",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_TOO_LONG",
  "NOTES_TOO_LONG",
  "ACTIVE_RIDE_EXISTS",
  "PLACE_INVALID",
] as const;

function isRideRefusal(value: unknown): value is RideRequestRefusal {
  return typeof value === "string" && (RIDE_REFUSALS as readonly string[]).includes(value);
}

function failed(reason: RideStoreFailure["reason"]): RideStoreFailure {
  return { reason };
}

/** كما في `quote-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * قراءةُ الختمِ.
 *
 * الدالّةُ تُعيدُ `timestamptz` في `jsonb` نصّاً بصيغةِ ISO، ويُقرأُ **عدداً**
 * ههنا: الطبقاتُ الأعلى تحسبُ فروقاً، ونصٌّ لا يُطرَحُ. وختمٌ لا يُقرأُ عدداً
 * عطبُ عقدٍ لا قيمةٌ افتراضيّةٌ: `Date.now()` بديلاً يُنتِجُ مؤقّتاً يبدأُ من صفرٍ
 * في كلِّ قراءةٍ — وهوَ عينُ الكذبِ الذي بُنيَ هذا البندُ لإبطالِه.
 */
function readInstantMs(value: unknown): number | null {
  const text = readText(value);
  if (text === null) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function readCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  // `count()` يعودُ `bigint` وقد يُنشَرَ نصّاً — يُقرأُ ولا يُفترَضُ.
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

interface RidePayload {
  readonly ok?: unknown;
  readonly error?: unknown;
  readonly reused?: unknown;
  readonly order_id?: unknown;
  readonly created_at?: unknown;
  readonly status?: unknown;
  readonly service?: unknown;
  readonly broadcast_round?: unknown;
  readonly notified_driver_count?: unknown;
  readonly wider_circle_opened?: unknown;
  readonly escalated?: unknown;
  readonly cancellable_without_penalty?: unknown;
  /** `WR-06` — بدءُ البحثِ الفعليّ وموعدا المجدول. */
  readonly search_started_at?: unknown;
  readonly pickup_at?: unknown;
  readonly dispatch_at?: unknown;
}

interface RideRow {
  readonly result: RidePayload | null;
}

/**
 * `LOC-TRUST-01` — المكانُ إلى `jsonb` بأسماءِ أعمدتِه. `null` حينَ لا شيءَ يُكتَب، فيبقى
 * النداءُ القديمُ (البوتُ وعميلٌ أقدمُ من العقد) حرفاً كما كان.
 */
function placeJson(place: PlaceMeta | null | undefined): string | null {
  if (place === undefined || place === null) return null;
  return JSON.stringify({
    point_source: place.source,
    accuracy_m: place.accuracyM,
    captured_at: place.capturedAt,
    link: place.link,
    notes: place.notes,
  });
}

export function createRideRequestCommand(sql: Sql): RideRequestCommand {
  return {
    create: async (input): Promise<Result<RideRequestVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));
      if (!isServiceKind(input.service)) return err(failed("STORE_ERROR"));

      const params = [
        telegramId,
        input.idempotencyKey,
        input.service,
        input.origin.lat,
        input.origin.lng,
        input.destination?.lat ?? null,
        input.destination?.lng ?? null,
        input.notes,
        input.pickupLabel ?? null,
        input.destination === null ? null : (input.dropoffLabel ?? null),
        input.pickupAt === undefined || input.pickupAt === null
          ? null
          : input.pickupAt.toISOString(),
        input.offerSar ?? null,
      ];
      const pickupPlace = placeJson(input.pickupPlace);
      const dropoffPlace = input.destination === null ? null : placeJson(input.dropoffPlace);

      let rows: RideRow[];
      try {
        // `WR-05` — غلافُ السياسةِ يحكمُ على المبلغِ ثمَّ يُفوِّضُ إلى `request_ride_with_places`
        // (والمكانُ الغائبُ `null` مقبولٌ فيه) فيُكتَبُ الطلبُ وسياستُه في معاملةٍ واحدة.
        // `::text::jsonb` لا `::jsonb`: النوعُ المستنبَطُ `jsonb` يجعلُ السائقَ يُرمِّزُ النصَّ
        // ثانيةً فيصلُ كائنُ المكانِ «نصّاً» ويُرفَضُ (`scripts/lib/jsonb-binding.ts`).
        rows = await sql.unsafe<RideRow[]>(
          "select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result",
          [...params, pickupPlace, dropoffPlace, input.offerMode ?? "open"],
        );
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (code === "RIDER_NOT_REGISTERED") return err(failed("RIDER_NOT_REGISTERED"));
        if (!isRideRefusal(code)) return err(failed("STORE_ERROR"));
        if (code === "ACTIVE_RIDE_EXISTS") {
          const orderId = readText(result.order_id);
          const status = result.status;
          // الرفضُ بلا طريقِ خروجٍ شاشةٌ مسدودةٌ؛ ونقصُ المعرّفِ ههنا عطبُ عقدٍ.
          if (orderId === null || !isRideStatus(status)) return err(failed("STORE_ERROR"));
          return ok({ accepted: false, refusal: code, activeRide: { orderId, status } });
        }
        return ok({ accepted: false, refusal: code, activeRide: null });
      }

      const orderId = readText(result.order_id);
      const createdAtMs = readInstantMs(result.created_at);
      if (orderId === null || createdAtMs === null || typeof result.reused !== "boolean") {
        return err(failed("STORE_ERROR"));
      }
      // `WR-06` — الحالةُ وموعدا المجدول. غيابُ الحالةِ (دالّةٌ أقدم) يُقرأُ «بحث»، وحالةٌ
      // مجهولةٌ عطبُ عقدٍ لا نجاح.
      const status = result.status === undefined ? "searching" : result.status;
      if (!isRideStatus(status)) return err(failed("STORE_ERROR"));
      const ride: CreatedRide = {
        orderId,
        createdAtMs,
        reused: result.reused,
        status,
        pickupAtMs: readInstantMs(result.pickup_at),
        dispatchAtMs: readInstantMs(result.dispatch_at),
      };
      return ok({ accepted: true, ride });
    },
  };
}

/**
 * محوّلُ الإلغاءِ — يُنادي `cancel_ride_by_telegram` التي **تُفوِّضُ** إلى
 * `cancel_order_by_rider`. ولا يقرأُ معرَّفَ الراكبِ ههنا ثمَّ يُلغي بنداءٍ
 * ثانٍ: نداءانِ يعنيانِ معرَّفاً يمرُّ في طبقةٍ أعلى، وهوَ موضعُ تزييفِ هويَّةٍ.
 */
export function createRideCancelCommand(sql: Sql): RideCancelCommand {
  return {
    cancel: async (input): Promise<Result<RideCancelVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: RideRow[];
      try {
        rows = await sql.unsafe<RideRow[]>("select cancel_ride_by_telegram($1, $2) as result", [
          telegramId,
          input.orderId,
        ]);
      } catch {
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok === true) return ok({ cancelled: true });

      const code = result.error;
      if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
      if (code === "RIDER_NOT_REGISTERED") return err(failed("RIDER_NOT_REGISTERED"));
      if (code === "INVALID_ORDER_ID") return ok({ cancelled: false, refusal: "INVALID_ORDER_ID" });
      if (code === "ORDER_NOT_FOUND") return ok({ cancelled: false, refusal: "ORDER_NOT_FOUND" });
      if (code === "ORDER_NOT_CANCELLABLE") {
        return ok({ cancelled: false, refusal: "ORDER_NOT_CANCELLABLE" });
      }
      // رمزٌ مجهولٌ من دالَّةٍ أقدمَ: عطبُ عقدٍ يُعلَنُ ولا يُقرأُ نجاحاً.
      return err(failed("STORE_ERROR"));
    },
  };
}

export function createRideSearchReader(sql: Sql): RideSearchReader {
  return {
    read: async (input): Promise<Result<RideSearchVerdict, RideStoreFailure>> => {
      const telegramId = asTelegramId(input.telegramUserId);
      if (telegramId === null) return err(failed("USER_NOT_FOUND"));

      let rows: RideRow[];
      try {
        rows = await sql.unsafe<RideRow[]>("select ride_search_state($1, $2) as result", [
          telegramId,
          input.orderId,
        ]);
      } catch {
        // معرّفٌ ليسَ `uuid` يُسقِطُ التحويلَ في القاعدةِ؛ والدالّةُ تُعيدُ
        // `INVALID_ORDER_ID` لما تستطيعُ قراءتَه، وما عجزَت عنه يُقرأُ عطباً.
        return err(failed("STORE_ERROR"));
      }

      const result = rows[0]?.result;
      if (result === null || result === undefined) return err(failed("STORE_ERROR"));

      if (result.ok !== true) {
        const code = result.error;
        if (code === "USER_NOT_FOUND") return err(failed("USER_NOT_FOUND"));
        if (code === "RIDER_NOT_REGISTERED") return err(failed("RIDER_NOT_REGISTERED"));
        if (code === "INVALID_ORDER_ID") return ok({ found: false, refusal: "INVALID_ORDER_ID" });
        if (code === "ORDER_NOT_FOUND") return ok({ found: false, refusal: "ORDER_NOT_FOUND" });
        return err(failed("STORE_ERROR"));
      }

      const orderId = readText(result.order_id);
      const createdAtMs = readInstantMs(result.created_at);
      const notifiedDriverCount = readCount(result.notified_driver_count);
      const service = readText(result.service);
      const status = result.status;
      // الرايتانِ التشغيليّتانِ للمآلِ (`PD-050`): تُقرآنِ وتُصادَقانِ هنا ثم
      // يُشتقُّ منهما الطورُ في النطاقِ — ولا تعبرانِ إلى الردِّ العامِّ أبدًا.
      // (و`broadcast_round` يبقى في خرجِ الدالّةِ لكنّهُ لم يُقرأْ هنا بعدَ الآن:
      // عدّادُ جولاتٍ داخليٌّ لا لغةَ للراكبِ — `IDEA-P`.)
      const widerCircleOpened = result.wider_circle_opened;
      const escalated = result.escalated;
      if (
        orderId === null ||
        createdAtMs === null ||
        notifiedDriverCount === null ||
        service === null ||
        !isServiceKind(service) ||
        !isRideStatus(status) ||
        typeof widerCircleOpened !== "boolean" ||
        typeof escalated !== "boolean" ||
        typeof result.cancellable_without_penalty !== "boolean"
      ) {
        return err(failed("STORE_ERROR"));
      }

      const state: RideSearchState = {
        orderId,
        status,
        service,
        createdAtMs,
        notifiedDriverCount,
        widerCircleOpened,
        escalated,
        cancellableWithoutPenalty: result.cancellable_without_penalty,
        searchStartedAtMs: readInstantMs(result.search_started_at) ?? createdAtMs,
        pickupAtMs: readInstantMs(result.pickup_at),
        dispatchAtMs: readInstantMs(result.dispatch_at),
      };
      return ok({ found: true, state });
    },
  };
}
