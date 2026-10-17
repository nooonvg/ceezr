/**
 * الغرض: أحداثُ أطوارِ الرحلةِ للراكبِ داخلَ Mini App وإقرارُه بها — ADR 0287.
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: application/transport
 * يُستخدم من: `apps/gateway/src/routes/rides.ts`.
 *
 * ## العقدُ
 *
 *   ــ القراءةُ (`readRiderTripEvents`) تعيدُ أحداثَ الرحلةِ الدائمةَ (صفوفَ
 *      الصادرِ نفسَها: معرّفٌ ثابتٌ، طورٌ، تسلسلٌ) — ولا تُسجِّلُ إيصالًا.
 *   ــ الإقرارُ (`ackRiderTripEvents`) يُرسَلُ **بعدَ** أن يطبّقَ العميلُ الأحداثَ؛
 *      وهوَ وحدَه ما يجعلُ الحدثَ «وصلَ عبرَ Mini App».
 *   ــ الهويةُ منَ الجلسةِ وحدَها؛ والملكيةُ تتحققُ في القاعدةِ.
 */
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";

export interface RiderTripEventView {
  readonly id: string;
  readonly event: string;
  readonly seq: number;
  readonly createdAt: string;
  readonly acked: boolean;
}

export type RiderTripEventsStoreError = "ORDER_NOT_FOUND" | "STORE_ERROR";

export interface RiderTripEventsStore {
  list(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
  }): Promise<Result<readonly RiderTripEventView[], RiderTripEventsStoreError>>;
  ack(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
    readonly deliveryIds: readonly string[];
  }): Promise<Result<{ readonly recorded: number; readonly closed: number }, "STORE_ERROR">>;
}

export interface RiderTripEventsDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: RiderTripEventsStore;
  readonly now: () => Date;
}

export type RiderTripEventsErrorCode =
  | "SESSION_REQUIRED"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_NOT_AVAILABLE"
  | "MALFORMED"
  | "ORDER_NOT_FOUND"
  | "RIDE_STORE_NOT_AVAILABLE";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** أربعةُ أطوارٍ للرحلةِ — وثمانيةٌ سقفٌ واسعٌ يكفي ولا يفتحُ دفعةً بلا حدٍّ. */
export const RIDER_TRIP_ACK_MAX_IDS = 8;

async function viewer(
  deps: RiderTripEventsDeps,
  accessToken: string | undefined,
): Promise<Result<string, RiderTripEventsErrorCode>> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) {
    const reason = session.error.reason;
    if (reason === "EXPIRED") return err("SESSION_EXPIRED");
    if (reason === "NOT_CONFIGURED") return err("SESSION_NOT_AVAILABLE");
    return err("SESSION_INVALID");
  }
  return ok(session.value.telegramUserId);
}

export async function readRiderTripEvents(
  deps: RiderTripEventsDeps,
  input: { readonly accessToken: string | undefined; readonly orderId: string },
): Promise<Result<readonly RiderTripEventView[], RiderTripEventsErrorCode>> {
  const who = await viewer(deps, input.accessToken);
  if (!who.ok) return who;
  if (!UUID.test(input.orderId)) return err("MALFORMED");
  const listed = await deps.store.list({ telegramUserId: who.value, orderId: input.orderId });
  if (!listed.ok) {
    return err(listed.error === "STORE_ERROR" ? "RIDE_STORE_NOT_AVAILABLE" : listed.error);
  }
  return listed;
}

export async function ackRiderTripEvents(
  deps: RiderTripEventsDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: string;
    readonly deliveryIds: unknown;
  },
): Promise<
  Result<{ readonly recorded: number; readonly closed: number }, RiderTripEventsErrorCode>
> {
  const who = await viewer(deps, input.accessToken);
  if (!who.ok) return who;
  if (!UUID.test(input.orderId)) return err("MALFORMED");
  const ids = input.deliveryIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > RIDER_TRIP_ACK_MAX_IDS ||
    !ids.every((id) => typeof id === "string" && UUID.test(id))
  ) {
    return err("MALFORMED");
  }
  const acked = await deps.store.ack({
    telegramUserId: who.value,
    orderId: input.orderId,
    deliveryIds: ids as string[],
  });
  if (!acked.ok) return err("RIDE_STORE_NOT_AVAILABLE");
  return acked;
}
