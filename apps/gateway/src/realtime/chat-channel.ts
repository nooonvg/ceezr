/**
 * الغرض: `WR-04` — قناةُ Socket.IO لغرفةِ محادثةِ الطلب: إشارةُ «جديدٌ» تصلُ
 *   الطرفَ الآخرَ فورَ الحفظ، والعميلُ يسترجعُ الرسائلَ من الخادمِ بعدَها.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/src/realtime
 * الحاكم: `docs/adr/0263-order-chat-in-miniapp.md`.
 *
 * ## لِمَ إشارةٌ لا رسالة
 *
 * لأنَّ الحفظَ في القاعدةِ هوَ الحقيقةُ، والقناةُ تسريعٌ لا مصدر: مقبسٌ انقطعَ
 * لحظةَ البثِّ لا يفقدُ شيئاً، فهوَ يسترجعُ «ما بعدَ آخرِ تسلسلٍ رآه» عندَ
 * عودتِه. ولا يمرُّ في القناةِ نصٌّ ولا مرسلٌ ولا معرّفُ عميل.
 *
 * ## ولِمَ لا تخضعُ لحكمِ `live-tracking-policy.ts`
 *
 * لأنَّ قرارَ المالكِ (2026-09-19) يمنعُ **بثَّ موقعِ السائقِ** في الإنتاج،
 * والقناةُ هذه لا تحملُ موقعاً ألبتّةَ — وذاكَ ما يسمحُ به نصُّ الحكمِ نفسُه
 * («أحداثُ حالةٍ لا تحملُ موقعاً»).
 *
 * ## الانضمام
 *
 * `chat:join {orderId}` ⇐ الجلسةُ من `handshake.auth.sessionToken` ⇐ الحكمُ
 * نفسُه الذي يقرأُ به مسارُ HTTP (`canJoinOrderChat`) ⇐ الغرفةُ `order-chat:<id>`.
 * ومن ليسَ طرفاً يُجابُ `chat:error {code: CHAT_NOT_FOUND}` ولا يُضَمّ.
 */

import type { Server as IoServer, Socket as IoSocket } from "socket.io";
import {
  canJoinOrderChat,
  type OrderChatSignal,
  type OrderChatStore,
} from "../../../../packages/application/messaging/order-chat.ts";
import type { OffersSessionVerifier } from "./offers-channel.ts";

export interface ChatChannelDeps {
  readonly io: IoServer;
  readonly sessions: OffersSessionVerifier;
  readonly store: OrderChatStore;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
}

export interface ChatChannel {
  readonly start: () => void;
  readonly stop: () => void;
  readonly publish: (signal: OrderChatSignal) => void;
}

export function chatRoomOf(orderId: string): string {
  return `order-chat:${orderId}`;
}

export function createChatChannel(deps: ChatChannelDeps): ChatChannel {
  let handler: ((socket: IoSocket) => void) | null = null;

  function start(): void {
    handler = (socket: IoSocket) => {
      socket.on("chat:join", async (payload: { orderId?: unknown } | undefined) => {
        const token = socket.handshake.auth?.sessionToken as string | undefined;
        if (typeof token !== "string" || token.length === 0) {
          socket.emit("chat:error", { code: "NO_SESSION" });
          return;
        }
        const session = await deps.sessions.verify(token);
        if (session === null) {
          socket.emit("chat:error", { code: "INVALID_SESSION" });
          return;
        }
        let orderId: string | null = null;
        try {
          orderId = await canJoinOrderChat(deps, {
            telegramUserId: session.telegramUserId,
            orderId: payload?.orderId,
          });
        } catch {
          orderId = null;
        }
        if (orderId === null) {
          socket.emit("chat:error", { code: "CHAT_NOT_FOUND" });
          return;
        }
        await socket.join(chatRoomOf(orderId));
        deps.log?.("order_chat.socket_joined", { order_id: orderId });
        socket.emit("chat:joined", { orderId });
      });

      socket.on("chat:leave", async (payload: { orderId?: unknown } | undefined) => {
        if (typeof payload?.orderId === "string") await socket.leave(chatRoomOf(payload.orderId));
      });
    };
    deps.io.on("connection", handler);
  }

  function stop(): void {
    if (handler !== null) {
      deps.io.off("connection", handler);
      handler = null;
    }
  }

  function publish(signal: OrderChatSignal): void {
    deps.io
      .to(chatRoomOf(signal.orderId))
      .emit("chat:update", { orderId: signal.orderId, lastSeq: signal.lastSeq });
  }

  return { start, stop, publish };
}
