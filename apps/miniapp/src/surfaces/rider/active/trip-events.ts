/**
 * الغرض: أحداثُ أطوارِ الرحلةِ في Mini App وإقرارُ العميلِ بها — ADR 0287.
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `ActiveRideScreen.tsx` (بحقنٍ من `RiderRoot.tsx`).
 *
 * ## العقدُ
 *
 *   ــ القناةُ الآنيةُ تبثُّ `trip:update` إشارةً لا حدثًا: العميلُ يجلبُ أحداثَ
 *      الرحلةِ الدائمةَ (`GET /v1/rides/:id/trip-events`) ثم يطبّقُها بقراءةِ لقطةِ
 *      الرحلةِ، ثم **يُقرُّ** (`POST …/ack`) بما تغطّيه اللقطةُ المطبَّقةُ وحدَه.
 *   ــ لا إقرارَ بحدثٍ لم يظهرْ: حدثٌ تسلسلُه فوقَ طورِ اللقطةِ (وصلَ قبلَ أن
 *      تتحدّثَ القراءةُ) يبقى بلا إقرارٍ فيُعادُ في الإشارةِ التاليةِ أو يذهبُ إلى
 *      تيليجرامَ احتياطًا عندَ انقضاءِ المهلةِ.
 *   ــ فشلُ الجلبِ أو الإقرارِ لا يُعالَجُ بادّعاءٍ: يُتركُ للخادمِ أن يقرّرَ البديلَ.
 */

import type { Socket } from "socket.io-client";
import { apiFetch } from "../../../api/client.ts";
import type {
  RideChannelTransport,
  SessionTokenReader,
} from "../../../services/ride-channel-client.ts";

export interface TripEvent {
  readonly id: string;
  readonly event: string;
  readonly seq: number;
  readonly created_at: string;
  readonly acked: boolean;
}

export interface TripEventsResponse {
  readonly ok: boolean;
  readonly events?: readonly TripEvent[];
}

export interface TripEventsApi {
  readonly list: (orderId: string) => Promise<TripEventsResponse>;
  readonly ack: (orderId: string, ids: readonly string[]) => Promise<unknown>;
}

export const tripEventsViaApi: TripEventsApi = {
  list: (orderId) =>
    apiFetch<TripEventsResponse>(`/v1/rides/${encodeURIComponent(orderId)}/trip-events`, {
      method: "GET",
    }),
  ack: (orderId, ids) =>
    apiFetch<unknown>(`/v1/rides/${encodeURIComponent(orderId)}/trip-events/ack`, {
      method: "POST",
      body: { ids },
    }),
};

/** تسلسلُ الطورِ الذي تعرضُه اللقطةُ — مرآةُ `rider_trip_event_seq` في القاعدةِ. */
export function phaseSeq(phase: string): number {
  switch (phase) {
    case "driver_assigned":
      return 1;
    case "driver_arrived":
      return 2;
    case "on_trip":
      return 3;
    case "completed":
      return 4;
    default:
      return 0;
  }
}

/** ما يجوزُ الإقرارُ به بعدَ تطبيقِ لقطةٍ طورُها `phase`: غيرُ المُقَرِّ وتسلسلُه ≤ الطورِ. */
export function ackableIds(events: readonly TripEvent[], phase: string): string[] {
  const shown = phaseSeq(phase);
  return events.filter((e) => !e.acked && e.seq >= 1 && e.seq <= shown).map((e) => e.id);
}

export interface TripEventsChannelDeps {
  readonly transport: RideChannelTransport;
  readonly sessions: SessionTokenReader;
  readonly baseUrl: string;
}

/**
 * اشتراكُ غرفةِ أحداثِ الراكبِ: `trip:join` عندَ كلِّ اتصالٍ (والعودةُ بعدَ انقطاعٍ
 * اتصالٌ جديدٌ فيُعادُ الانضمامُ ثم المزامنةُ)، و`trip:update` يُنادي `onSignal`.
 */
export function subscribeTripEvents(
  deps: TripEventsChannelDeps,
  input: { readonly onSignal: (orderId: string | null) => void },
): { readonly disconnect: () => void } {
  const token = deps.sessions.read();
  if (token === null) return { disconnect: () => {} };
  const socket: Socket = deps.transport.connect(deps.baseUrl, { sessionToken: token });
  socket.on("connect", () => socket.emit("trip:join"));
  socket.on("trip:joined", () => input.onSignal(null));
  socket.on("trip:update", (payload: { order_id?: unknown }) => {
    input.onSignal(typeof payload?.order_id === "string" ? payload.order_id : null);
  });
  return { disconnect: () => socket.disconnect() };
}
