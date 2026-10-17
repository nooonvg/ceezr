/**
 * الغرض: غرفةُ أحداثِ رحلةِ الراكبِ في القناةِ الآنيةِ — ADR 0287.
 *   العميلُ (شاشةُ الرحلةِ في Mini App) يرسلُ `trip:join` بجلسةٍ موثّقةٍ فيدخلُ
 *   غرفةَ `rider-trip:<telegram_id>`؛ وشوطُ التسليمِ يسألُ عبرَ المسارِ الداخليِّ
 *   «هل هوَ متصلٌ؟» ثم يبثُّ `trip:update` بمعرّفِ الطلبِ.
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: apps/gateway/realtime
 *
 * ## قراراتٌ معلنةٌ
 *
 *   ــ **البثُّ ليسَ تسليمًا**: `trip:update` إشارةُ «اجلبْ أحداثَك» لا تحملُ
 *      الحدثَ نفسَه. التسليمُ لا يُعلَنُ إلا بإقرارِ العميلِ بعدَ التطبيقِ
 *      (`POST /v1/rides/:id/trip-events/ack`) — فانقطاعُ الـsocket بعدَ البثِّ
 *      يتركُ الحدثَ بلا إيصالٍ فيذهبُ إلى تيليجرامَ عندَ انقضاءِ المهلةِ.
 *   ــ **الغرفةُ بهويةِ الجلسةِ لا بطلبٍ من العميلِ**: لا يستطيعُ عميلٌ الانضمامَ
 *      لغرفةِ غيرِه — المعرّفُ منَ الجلسةِ الموثّقةِ وحدَها.
 */

import type { Server as IoServer, Socket as IoSocket } from "socket.io";
import type { OffersSessionVerifier } from "./offers-channel.ts";

export interface RiderTripChannelDeps {
  readonly io: IoServer;
  readonly sessions: OffersSessionVerifier;
}

export interface RiderTripChannel {
  readonly start: () => void;
  readonly stop: () => void;
  readonly notifyRider: (telegramUserId: string, orderId: string) => void;
  readonly isRiderConnected: (telegramUserId: string) => boolean;
}

export function riderTripRoom(telegramUserId: string): string {
  return `rider-trip:${telegramUserId}`;
}

export function createRiderTripChannel(deps: RiderTripChannelDeps): RiderTripChannel {
  let connectionHandler: ((socket: IoSocket) => void) | null = null;

  function start(): void {
    connectionHandler = (socket: IoSocket) => {
      socket.on("trip:join", async () => {
        const sessionToken = socket.handshake.auth?.sessionToken as string | undefined;
        if (sessionToken === undefined) {
          socket.emit("trip:error", { code: "NO_SESSION" });
          return;
        }
        const session = await deps.sessions.verify(sessionToken);
        if (session === null) {
          socket.emit("trip:error", { code: "INVALID_SESSION" });
          return;
        }
        socket.join(riderTripRoom(session.telegramUserId));
        socket.emit("trip:joined", {});
      });
    };
    deps.io.on("connection", connectionHandler);
  }

  function stop(): void {
    if (connectionHandler !== null) {
      deps.io.off("connection", connectionHandler);
      connectionHandler = null;
    }
  }

  function notifyRider(telegramUserId: string, orderId: string): void {
    deps.io.to(riderTripRoom(telegramUserId)).emit("trip:update", { order_id: orderId });
  }

  function isRiderConnected(telegramUserId: string): boolean {
    return deps.io.sockets.adapter.rooms.has(riderTripRoom(telegramUserId));
  }

  return { start, stop, notifyRider, isRiderConnected };
}
