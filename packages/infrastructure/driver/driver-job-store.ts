/**
 * الغرض: محوّلُ مَهمّةِ السائقِ النشطةِ على PostgreSQL — نداءُ دوالِّ `F3-03`
 *   الأربعِ وقراءةُ حمولتِها **بلا افتراضٍ** (`F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: infrastructure/driver
 * يُستخدم من: `apps/gateway/src/index.ts` عبرَ حقنِ التبعياتِ.
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — قراءةُ الأرباحِ محوِّلٌ يُضافُ لبندِها،
 *   ولا تُوسَّعُ هذه الطرقُ لتقرأَ تاريخاً.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ `job: null` تُقرأُ **جواباً صحيحاً** لا حمولةً فاسدةً
 *
 * «لا مَهمّةَ لي الآنَ» حالُ السائقِ أغلبَ نهارِه. فلو صُنِّفَ الفراغُ عطباً
 * لَرأى السائقُ `503` في شاشةٍ سويّةٍ، ولَامتلأَ سجلُّ الأعطابِ بحالٍ طبيعيّةٍ
 * حتّى يصيرَ العطبُ الحقيقيُّ غيرَ مرئيٍّ فيه.
 *
 * ## ولِمَ حمولةٌ ناقصةٌ **عطبٌ لا صفٌّ ناقصٌ**
 *
 * مَهمّةٌ بلا `next_action` مقروءٍ تجعلُ الشاشةَ تحكمُ على الزرِّ بنفسِها — وهوَ
 * عينُ ما مُنِعَ. وموضعُ التقاطٍ بلا إحداثيّةٍ يجعلُ الملاحةَ رابطاً إلى العَدَمِ.
 * فتُردُّ `MALFORMED_RESULT` ويُقرأُ `503`، **ولا يُخترَعُ بديلٌ ههنا**.
 *
 * ## وما لا يفعلُه هذا المحوّلُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يُركِّبُ SQL نصّاً**: مُعامَلاتٌ مُمرَّرةٌ، والمعرّفُ يُفحَصُ رقميّاً
 *      قبلَ إرسالِه إلى `bigint`.
 *   ــ **لا يُصنِّفُ عطبَ شبكةٍ رفضاً**: استثناءٌ = `STORE_ERROR` = `503`.
 *   ــ **لا يقفلُ صفّاً ولا يُحدِّثُ حالةً ولا `update` ألبتّةَ**: الأطوارُ نداءُ
 *      دوالِّ القاعدةِ، والبدءُ والإنهاءُ تفويضٌ إلى كاتبَيهما القائمَينِ.
 *   ــ **لا يحسبُ مدّةً ولا يقيسُ مسافةً**: المدّةُ من الكاتبِ نقلاً.
 *   ــ **لا يقرأُ هاتفَ راكبٍ ولا معرِّفَ تلغرامِه**: لا يُطلَبُ ولا يُنشَرُ —
 *      ولو أعادَتهما دالّةٌ لَما وُجِدَ لهما حقلٌ يُقرأُ فيه.
 */

import type {
  DriverJobStore,
  DriverJobStoreError,
  DriverJobStoreRejection,
  WithRiderNotice,
} from "../../application/driver/job-ports.ts";
import {
  type DriverActiveJob,
  type DriverJobArrival,
  type DriverJobCompletion,
  type DriverJobSnapshot,
  type DriverJobStart,
  isDriverJobAction,
} from "../../domain/driver/driver-job.ts";
import {
  type DriverOfferPlace,
  isDriverOrderStatus,
  isServiceType,
} from "../../domain/driver/driver-offers.ts";
import {
  BROADCAST_REASONS,
  type BroadcastPolicy,
  type BroadcastReason,
} from "../../domain/driver/location-broadcast.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";
import { readOrderPlaceExtras } from "../transport/order-place-extras.ts";
import { depositOutcomeFrom } from "./driver-offers-store.ts";

/** مجالُ الرفضِ المغلقُ — يُقابِلُ رموزَ دوالِّ `F3-03` الأربعِ حرفاً. */
const REJECTIONS: readonly DriverJobStoreRejection[] = [
  "USER_NOT_FOUND",
  "NOT_A_DRIVER",
  "JOB_NOT_FOUND",
  "PHASE_MISMATCH",
  "ALREADY_ARRIVED",
  "TRANSITION_REFUSED",
];

function failed(reason: "STORE_ERROR" | "MALFORMED_RESULT"): DriverJobStoreError {
  return { reason } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

/** كما في `driver-offers-store.ts`: لا نصَّ غيرَ رقميٍّ يُرسَلُ إلى `bigint`. */
function asTelegramId(value: string): string | null {
  return /^[0-9]{1,19}$/.test(value) ? value : null;
}

function rejectionFrom(payload: Record<string, unknown>): DriverJobStoreError {
  const code = readText(payload.error);
  if (code === null || !(REJECTIONS as readonly string[]).includes(code)) {
    return failed("MALFORMED_RESULT");
  }
  return { rejection: code as DriverJobStoreRejection };
}

/**
 * سياسةُ النبضةِ. و**الاقترانُ يُفحَصُ لا الحقلانِ منفصلَينِ**: سببٌ بلا مُدّةٍ
 * حالٌ سويّةٌ (إعدادٌ غائبٌ ⇒ سكونٌ مُعلَنٌ)، أمّا **مُدّةٌ بلا سببٍ فمُحالٌ**
 * يُقرأُ عطباً — إذ نبضةٌ لا يُقالُ لِمَ هيَ نبضةٌ لا تُطاعُ.
 */
function readBroadcastPolicy(value: unknown): BroadcastPolicy | null {
  if (!isRecord(value)) return null;

  const rawReason = value.reason;
  let reason: BroadcastReason | null = null;
  if (rawReason !== null && rawReason !== undefined) {
    const text = readText(rawReason);
    if (text === null || !(BROADCAST_REASONS as readonly string[]).includes(text)) return null;
    reason = text as BroadcastReason;
  }

  const rawInterval = value.interval_seconds;
  let intervalSeconds: number | null = null;
  if (rawInterval !== null && rawInterval !== undefined) {
    const parsed = readNumber(rawInterval);
    if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) return null;
    intervalSeconds = parsed;
  }

  if (reason === null && intervalSeconds !== null) return null;
  return { reason, intervalSeconds };
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

/**
 * المَهمّةُ. و**`next_action` يُقرأُ من مجالٍ مغلقٍ**: نصٌّ غريبٌ فيه يُسقِطُ
 * القراءةَ — لأنَّ فعلاً لا تعرفُه الشاشةُ يُرسَمُ زرّاً بلا فعلٍ أو لا يُرسَمُ
 * زرٌّ أصلاً، وكلاهما سائقٌ واقفٌ لا يدري ما يفعلُ.
 */
function readJob(value: unknown): DriverActiveJob | null {
  if (!isRecord(value)) return null;
  const orderId = readText(value.order_id);
  const pickup = readPlace(value.pickup);
  const dropoff =
    value.dropoff === null || value.dropoff === undefined ? null : readPlace(value.dropoff);
  const rider = isRecord(value.rider) ? value.rider : null;
  if (
    orderId === null ||
    pickup === null ||
    rider === null ||
    (value.dropoff !== null && value.dropoff !== undefined && dropoff === null) ||
    !isDriverOrderStatus(value.status) ||
    !isServiceType(value.service)
  ) {
    return null;
  }
  const nextAction = value.next_action;
  if (nextAction !== null && nextAction !== undefined && !isDriverJobAction(nextAction))
    return null;

  return {
    orderId,
    status: value.status,
    service: value.service,
    nextAction: isDriverJobAction(nextAction) ? nextAction : null,
    matchedAt: readInstant(value.matched_at),
    arrivedAt: readInstant(value.arrived_at),
    startedAt: readInstant(value.started_at),
    pickup,
    dropoff,
    notes: typeof value.notes === "string" ? value.notes : null,
    rider: {
      firstName: typeof rider.first_name === "string" ? rider.first_name : null,
      languageCode: typeof rider.language_code === "string" ? rider.language_code : null,
    },
  };
}

interface ResultRow {
  readonly result: unknown;
}

export class PostgresDriverJobStore implements DriverJobStore {
  readonly #sql: Sql;

  constructor(sql: Sql) {
    this.#sql = sql;
  }

  async readActiveJob(input: {
    readonly telegramUserId: string;
  }): Promise<Result<DriverJobSnapshot, DriverJobStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));

    let rows: ResultRow[];
    try {
      rows = await this.#sql<ResultRow[]>`
        select driver_active_job(${telegramId}::bigint) as result`;
    } catch {
      return err(failed("STORE_ERROR"));
    }

    const payload = rows[0]?.result;
    if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
    if (payload.ok !== true) return err(rejectionFrom(payload));

    const serverTime = readInstant(payload.server_time);
    if (serverTime === null) return err(failed("MALFORMED_RESULT"));

    // سياسةُ النبضةِ **تُقرأُ صارمةً**: كتلةٌ غائبةٌ أو مُشوَّهةٌ عطبُ عقدٍ يُقرأُ
    // `503`، **ولا تُقرأُ «لا تبثَّ»** — لأنَّ صمتاً مُخترَعاً من عطبٍ يُسكِتُ
    // البثَّ كلَّه بلا أن يُلاحَظَ، وسائقٌ لا يظهرُ موضعُه أسوأُ من قراءةٍ فاشلةٍ.
    const locationBroadcast = readBroadcastPolicy(payload.location_broadcast);
    if (locationBroadcast === null) return err(failed("MALFORMED_RESULT"));

    // العَدَمُ الصريحُ يمرُّ كما هوَ؛ وحمولةٌ موجودةٌ لا تُقرأُ **تُسقِطُ الجوابَ**.
    if (payload.job === null || payload.job === undefined) {
      return ok({ serverTime, job: null, locationBroadcast });
    }
    const job = readJob(payload.job);
    if (job === null) return err(failed("MALFORMED_RESULT"));
    // `LOC-TRUST-01`: ما أدخلَه الراكبُ عن المكانَين — لطلبِ المَهمّةِ نفسِها وحدَه.
    const extras = (await readOrderPlaceExtras(this.#sql, [job.orderId])).get(job.orderId);
    if (extras === undefined) return ok({ serverTime, job, locationBroadcast });
    return ok({
      serverTime,
      job: {
        ...job,
        pickup: { ...job.pickup, link: extras.pickup.link, notes: extras.pickup.notes },
        dropoff:
          job.dropoff === null || extras.dropoff === null
            ? job.dropoff
            : { ...job.dropoff, link: extras.dropoff.link, notes: extras.dropoff.notes },
        offerTerms: extras.offerTerms,
      },
      locationBroadcast,
    });
  }

  async markArrived(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<DriverJobArrival, DriverJobStoreError>> {
    const rows = await this.#call("driver_mark_arrived", input);
    if (!rows.ok) return rows;
    return arrivalFrom(rows.value[0]?.result);
  }

  async markArrivedWithNotice(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<WithRiderNotice<DriverJobArrival>, DriverJobStoreError>> {
    const rows = await this.#call("driver_mark_arrived_with_notice", input);
    if (!rows.ok) return rows;
    const payload = rows.value[0]?.result;
    const parsed = arrivalFrom(payload);
    if (!parsed.ok) return parsed;
    const notice = isRecord(payload) ? depositOutcomeFrom(payload.rider_notice) : undefined;
    return ok({ value: parsed.value, ...(notice === undefined ? {} : { notice }) });
  }

  async startRide(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<DriverJobStart, DriverJobStoreError>> {
    const rows = await this.#call("driver_start_ride", input);
    if (!rows.ok) return rows;
    return startFrom(rows.value[0]?.result);
  }

  async startRideWithNotice(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<WithRiderNotice<DriverJobStart>, DriverJobStoreError>> {
    const rows = await this.#call("driver_start_ride_with_notice", input);
    if (!rows.ok) return rows;
    const payload = rows.value[0]?.result;
    const parsed = startFrom(payload);
    if (!parsed.ok) return parsed;
    const notice = isRecord(payload) ? depositOutcomeFrom(payload.rider_notice) : undefined;
    return ok({ value: parsed.value, ...(notice === undefined ? {} : { notice }) });
  }

  async completeRide(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<DriverJobCompletion, DriverJobStoreError>> {
    const rows = await this.#call("driver_complete_ride", input);
    if (!rows.ok) return rows;
    return completionFrom(rows.value[0]?.result);
  }

  async completeRideWithNotice(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<WithRiderNotice<DriverJobCompletion>, DriverJobStoreError>> {
    const rows = await this.#call("driver_complete_ride_with_notice", input);
    if (!rows.ok) return rows;
    const payload = rows.value[0]?.result;
    const parsed = completionFrom(payload);
    if (!parsed.ok) return parsed;
    const notice = isRecord(payload) ? depositOutcomeFrom(payload.rider_notice) : undefined;
    return ok({ value: parsed.value, ...(notice === undefined ? {} : { notice }) });
  }

  /**
   * نداءُ دالّةِ طورٍ من قائمةٍ مغلقة — كلُّ نداءٍ قالبٌ حرفيٌّ بوسيطَين مربوطَين، لا اسمَ يُركَّب.
   * الاستثناءُ = `STORE_ERROR` كما كانَ في كلِّ طريقة.
   */
  async #call(
    fn: PhaseFunction,
    input: { readonly telegramUserId: string; readonly orderId: string },
  ): Promise<Result<ResultRow[], DriverJobStoreError>> {
    const telegramId = asTelegramId(input.telegramUserId);
    if (telegramId === null) return err(failed("MALFORMED_RESULT"));
    const sql = this.#sql;
    const id = input.orderId;
    try {
      switch (fn) {
        case "driver_mark_arrived":
          return ok(
            await sql<ResultRow[]>`
            select driver_mark_arrived(${telegramId}::bigint, ${id}::uuid) as result`,
          );
        case "driver_mark_arrived_with_notice":
          return ok(
            await sql<ResultRow[]>`
            select driver_mark_arrived_with_notice(${telegramId}::bigint, ${id}::uuid) as result`,
          );
        case "driver_start_ride":
          return ok(
            await sql<ResultRow[]>`
            select driver_start_ride(${telegramId}::bigint, ${id}::uuid) as result`,
          );
        case "driver_start_ride_with_notice":
          return ok(
            await sql<ResultRow[]>`
            select driver_start_ride_with_notice(${telegramId}::bigint, ${id}::uuid) as result`,
          );
        case "driver_complete_ride":
          return ok(
            await sql<ResultRow[]>`
            select driver_complete_ride(${telegramId}::bigint, ${id}::uuid) as result`,
          );
        case "driver_complete_ride_with_notice":
          return ok(
            await sql<ResultRow[]>`
            select driver_complete_ride_with_notice(${telegramId}::bigint, ${id}::uuid) as result`,
          );
      }
    } catch {
      return err(failed("STORE_ERROR"));
    }
  }
}

function arrivalFrom(payload: unknown): Result<DriverJobArrival, DriverJobStoreError> {
  if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
  if (payload.ok !== true) return err(rejectionFrom(payload));

  const orderId = readText(payload.order_id);
  // **الختمُ شرطُ الجوابِ**: «وصلتُ» بلا لحظةٍ لا يُعرَضُ ولا يُسجَّلُ، وساعةُ
  // هذه العمليّةِ ليسَت بديلاً عن ساعةِ القاعدةِ في ختمٍ واحدٍ.
  const arrivedAt = readInstant(payload.arrived_at);
  if (orderId === null || arrivedAt === null) return err(failed("MALFORMED_RESULT"));
  return ok({ orderId, arrivedAt });
}

function startFrom(payload: unknown): Result<DriverJobStart, DriverJobStoreError> {
  if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
  if (payload.ok !== true) return err(rejectionFrom(payload));

  const orderId = readText(payload.order_id);
  if (orderId === null) return err(failed("MALFORMED_RESULT"));
  // وغيابُ الختمِ ههنا **يُقالُ عَدَماً** ولا يُستبدَلُ بساعةِ العمليّةِ.
  return ok({ orderId, startedAt: readInstant(payload.started_at) });
}

function completionFrom(payload: unknown): Result<DriverJobCompletion, DriverJobStoreError> {
  if (!isRecord(payload)) return err(failed("MALFORMED_RESULT"));
  if (payload.ok !== true) return err(rejectionFrom(payload));

  const orderId = readText(payload.order_id);
  if (orderId === null) return err(failed("MALFORMED_RESULT"));
  const duration = readNumber(payload.duration_seconds);
  return ok({
    orderId,
    completedAt: readInstant(payload.completed_at),
    durationSeconds: duration === null || duration < 0 ? null : duration,
  });
}

type PhaseFunction =
  | "driver_mark_arrived"
  | "driver_mark_arrived_with_notice"
  | "driver_start_ride"
  | "driver_start_ride_with_notice"
  | "driver_complete_ride"
  | "driver_complete_ride_with_notice";
