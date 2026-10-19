/**
 * الغرض: حالاتُ استخدامِ مَهمّةِ السائقِ النشطةِ — «مَهمّتي» و«وصلتُ» و«بدأتُ»
 *   و«أنهيتُ» (`F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: packages/application/driver
 * يُستخدم من: `apps/gateway/src/routes/driver-job.ts`
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` (الأرباحُ) تقرأُ ما بعدَ الإنهاءِ بحالةِ
 *   استخدامٍ تُضافُ، ولا يُوسَّعُ جوابُ الإنهاءِ ليحملَ حصيلةً.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ معرِّفُ الطلبِ **يُقرأُ من الطلبِ** ثمَّ تُفحَصُ المِلكيّةُ في القاعدةِ
 *
 * كانَ يُمكِنُ ألّا يُرسَلَ معرِّفٌ ألبتّةَ: «اختمْ وصولَ مَهمّتي النشطةِ» — والقاعدةُ
 * تعرفُ أيَّها. ولكنَّ ذلكَ **يجعلُ الضغطةَ عمياءَ**: سائقٌ فتحَ الشاشةَ على
 * مَهمّةٍ ثمَّ أُلغيَت وأُسندَت له أخرى وهوَ ينظرُ، فيضغطُ «وصلتُ» فيُختَمُ وصولٌ
 * على مَهمّةٍ لم يرَها. فالمعرِّفُ يُرسَلُ **ليقولَ السائقُ على أيِّها ضغطَ**،
 * والقاعدةُ ترفضُ إن لم تكنْ له — والرفضُ يُعرَضُ ولا يُخفى.
 *
 * ## ولِمَ الشكلُ يُفحَصُ ههنا والمِلكيّةُ لا
 *
 * نصٌّ غيرُ معرِّفٍ يُعيدُ من `uuid` عطبَ نوعٍ خاماً، وعطبُ نوعٍ يُقرأُ `503`
 * فيُظَنُّ الخادمُ ساقطاً وهوَ سليمٌ. **والمِلكيّةُ حكمُ القاعدةِ** في `where`
 * (القاعدة 0.5) لا فحصُ طبقةٍ ههنا — وفحصانِ لها يفترقانِ يومَ تُعدَّلُ إحداهما.
 *
 * ## وما لا تفعلُه هذه الحالاتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تشترطُ ختمَ وصولٍ قبلَ البدءِ**: الكاتبُ القائمُ `start_ride` لا
 *      يشترطُه، وشرطٌ في الطبقةِ وحدَها يجعلُ البدءَ من البوتِ جائزاً ومن
 *      التطبيقِ ممنوعاً — أي حُكمَينِ لانتقالٍ واحدٍ. والترتيبُ يُوجَّهُ
 *      بـ`nextAction` في القراءةِ لا بمنعٍ في الكتابةِ.
 *   ــ **لا تُعيدُ ذرّيّةً**: لا قراءةَ ثمَّ كتابةَ ههنا ألبتّةَ.
 *   ــ **لا تُرسِلُ إخطاراً للراكبِ**: صندوقُ الصادرِ القائمُ.
 *   ــ **لا تُلغي رحلةً ولا تُوقِفُها**: كاتبُ الإلغاءِ قائمٌ وسياستُه مُجمَّدةٌ.
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ ولا خانةً لهما** (`ADR 0039` §٤ ·
 *      `م13-7` · `DEC-11`).
 *   ــ **لا تقرأُ موضعَ سائقٍ ولا تبثُّه**: `F3-04` بندُ البثِّ.
 */

import type {
  DriverJobArrival,
  DriverJobCompletion,
  DriverJobSnapshot,
  DriverJobStart,
} from "../../domain/driver/driver-job.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";
import {
  type DriverJobStore,
  type DriverJobStoreError,
  isDriverJobRejection,
  type WithRiderNotice,
} from "./job-ports.ts";
import {
  noticeRiderOfTrip,
  type RiderTripNoticeDeps,
  recordRiderTripDeposit,
} from "./rider-trip-notice.ts";

/**
 * رموزُ العطبِ المنشورةُ — **قائمةٌ تُقرأُ في زمنِ التشغيلِ** لا اتّحادٌ وحدَه،
 * كي يُلزِمَ الحاجزُ أنَّ لكلِّ رمزٍ نصّاً في القواميسِ الثلاثةِ وحالةَ HTTP.
 */
export const DRIVER_JOB_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "JOB_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "ORDER_ID_INVALID",
  "JOB_NOT_FOUND",
  "PHASE_MISMATCH",
  "ALREADY_ARRIVED",
  "TRANSITION_REFUSED",
] as const;

export type DriverJobPublicErrorCode = (typeof DRIVER_JOB_PUBLIC_ERROR_CODES)[number];

export interface DriverJobRejection {
  readonly code: DriverJobPublicErrorCode;
}

export interface DriverJobDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: DriverJobStore;
  readonly now: () => Date;
  /** `RIDE-NOTICE-01` — إخطارُ الراكبِ بالطَّورِ على بوتِه؛ غيابُه يُسكِتُ الإخطارَ وحدَه. */
  readonly riderNotice?: RiderTripNoticeDeps;
}

function rejection(code: DriverJobPublicErrorCode): DriverJobRejection {
  return { code };
}

function sessionErrorFrom(reason: string): DriverJobPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function openSession(
  deps: DriverJobDeps,
  accessToken: string | undefined,
): Promise<Result<string, DriverJobRejection>> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readOrderId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * تحويلُ رفضِ المخزنِ إلى رمزٍ منشورٍ — **شاملٌ حرفاً** لاتّحادِ الرفضِ، فرمزٌ
 * جديدٌ في القاعدةِ يُسقِطُ البناءَ (`switch` مُستنفَدٌ) ولا يمرُّ خاماً لشاشةٍ.
 */
function publicCodeFrom(error: DriverJobStoreError): DriverJobRejection {
  if (!isDriverJobRejection(error)) return rejection("JOB_STORE_NOT_AVAILABLE");
  switch (error.rejection) {
    // حسابٌ لا صفَّ له ليسَ جلسةً فاسدةً (القسم 9.8) — ولا يُفرَّقُ عن «ليسَ سائقاً».
    case "USER_NOT_FOUND":
    case "NOT_A_DRIVER":
      return rejection("NOT_A_DRIVER");
    case "JOB_NOT_FOUND":
      return rejection("JOB_NOT_FOUND");
    case "PHASE_MISMATCH":
      return rejection("PHASE_MISMATCH");
    case "ALREADY_ARRIVED":
      return rejection("ALREADY_ARRIVED");
    case "TRANSITION_REFUSED":
      return rejection("TRANSITION_REFUSED");
  }
}

export async function readDriverActiveJob(
  deps: DriverJobDeps,
  input: { readonly accessToken: string | undefined },
): Promise<Result<DriverJobSnapshot, DriverJobRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const read = await deps.store.readActiveJob({ telegramUserId: session.value });
  if (!read.ok) return err(publicCodeFrom(read.error));
  return ok(read.value);
}

export async function markDriverArrived(
  deps: DriverJobDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: unknown },
): Promise<Result<DriverJobArrival, DriverJobRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const orderId = readOrderId(input.orderId);
  if (orderId === null) return err(rejection("ORDER_ID_INVALID"));

  const stamped = await phaseWithNotice(
    deps,
    orderId,
    "ARRIVED",
    deps.store.markArrivedWithNotice?.bind(deps.store),
    () => deps.store.markArrived({ telegramUserId: session.value, orderId }),
    session.value,
  );
  if (!stamped.ok) return err(publicCodeFrom(stamped.error));
  return ok(stamped.value);
}

export async function startDriverRide(
  deps: DriverJobDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: unknown },
): Promise<Result<DriverJobStart, DriverJobRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const orderId = readOrderId(input.orderId);
  if (orderId === null) return err(rejection("ORDER_ID_INVALID"));

  const started = await phaseWithNotice(
    deps,
    orderId,
    "STARTED",
    deps.store.startRideWithNotice?.bind(deps.store),
    () => deps.store.startRide({ telegramUserId: session.value, orderId }),
    session.value,
  );
  if (!started.ok) return err(publicCodeFrom(started.error));
  return ok(started.value);
}

export async function completeDriverRide(
  deps: DriverJobDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: unknown },
): Promise<Result<DriverJobCompletion, DriverJobRejection>> {
  const session = await openSession(deps, input.accessToken);
  if (!session.ok) return err(session.error);

  const orderId = readOrderId(input.orderId);
  if (orderId === null) return err(rejection("ORDER_ID_INVALID"));

  const completed = await phaseWithNotice(
    deps,
    orderId,
    "COMPLETED",
    deps.store.completeRideWithNotice?.bind(deps.store),
    () => deps.store.completeRide({ telegramUserId: session.value, orderId }),
    session.value,
  );
  if (!completed.ok) return err(publicCodeFrom(completed.error));
  return ok(completed.value);
}

/**
 * LOAD-01 (الدفعةُ 21) — الطورُ وإيداعُ إشعارِ الراكبِ في عبارةٍ واحدةٍ حينَ يُطلَبُ الإشعارُ
 * ويدعمُه المخزن (`driver_*_with_notice`)، وإلّا نداءانِ كما كانَ حرفًا. الطورُ نفسُه بفحوصِه
 * في القاعدةِ بلا تغيير، ورفضُه يعودُ كما هو بلا إيداع. ونجاحٌ بلا حقلِ الإيداع (منفذٌ أقدم)
 * ⇒ المسارُ المستقلّ، ومفتاحُ منعِ التكرارِ `rider_trip:<order>:<event>` يجعلُ أيَّ تكرارٍ صفًّا واحدًا.
 */
async function phaseWithNotice<T>(
  deps: DriverJobDeps,
  orderId: string,
  event: "ARRIVED" | "STARTED" | "COMPLETED",
  combined:
    | ((input: {
        readonly telegramUserId: string;
        readonly orderId: string;
      }) => Promise<Result<WithRiderNotice<T>, DriverJobStoreError>>)
    | undefined,
  separate: () => Promise<Result<T, DriverJobStoreError>>,
  telegramUserId: string,
): Promise<Result<T, DriverJobStoreError>> {
  if (deps.riderNotice === undefined || combined === undefined) {
    const done = await separate();
    if (done.ok) await noticeRiderOfTrip(deps.riderNotice, orderId, event);
    return done;
  }
  const done = await combined({ telegramUserId, orderId });
  if (!done.ok) return done;
  if (done.value.notice !== undefined) {
    recordRiderTripDeposit(deps.riderNotice, orderId, event, done.value.notice);
  } else {
    await noticeRiderOfTrip(deps.riderNotice, orderId, event);
  }
  return ok(done.value.value);
}
