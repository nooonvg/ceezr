/**
 * الغرض: `WR-04` — مقبسُ غرفةِ المحادثة: ينضمُّ بعدَ كلِّ اتّصالٍ (والعودةُ
 *   اتّصالٌ جديدٌ)، ويُبلِغُ المنادي بـ«جديدٌ» أو «عدتُ»، والمنادي يسترجعُ.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 *
 * ## لِمَ `polling` لا `websocket`
 *
 * لأنَّ Mini App يصلُ البوابةَ عبرَ إعادةِ كتابةِ مسارِ `/socket.io/*` على
 * أصلِه (`render.yaml`)، وسياسةُ `connect-src 'self'` تفرضُ الأصلَ نفسَه؛
 * وإعادةُ الكتابةِ هذه تُمرِّرُ HTTP ولا تُمرِّرُ ترقيةَ WebSocket — قيسَ في
 * 2026-10-12: الترقيةُ عبرَ أصلِ Mini App تُجابُ 400، والاستطلاعُ 200.
 * فالنقلُ استطلاعٌ طويلٌ صراحةً، ولا يحاولُ الترقيةَ (`upgrade: false`).
 */

import { io, type Socket } from "socket.io-client";
import { getSession } from "../../identity/session.ts";

export interface ChatSocketHandlers {
  /** وصلت إشارةٌ بأنَّ في الغرفةِ جديداً. */
  readonly onUpdate: (lastSeq: number) => void;
  /** انضمَّ المقبسُ (أوّلَ مرّةٍ أو بعدَ عودة) — يسترجعُ المنادي ما فاتَه. */
  readonly onJoined: () => void;
  /** انقطعَ أو رُفِضَ — يعودُ المنادي إلى الاستطلاعِ الدوريّ. */
  readonly onLost: () => void;
}

export interface ChatSocketHandle {
  readonly close: () => void;
}

export type ChatSocketFactory = (orderId: string, handlers: ChatSocketHandlers) => ChatSocketHandle;

function socketBaseUrl(): string {
  const base = import.meta.env.VITE_WASLAH_API_BASE;
  if (typeof base === "string" && base.length > 0) return base.replace(/\/$/, "");
  return "";
}

export const productionChatSocket: ChatSocketFactory = (orderId, handlers) => {
  const session = getSession();
  if (session === null) {
    handlers.onLost();
    return { close: () => undefined };
  }
  const socket: Socket = io(socketBaseUrl(), {
    auth: { sessionToken: session.accessToken },
    transports: ["polling"],
    upgrade: false,
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });
  socket.on("connect", () => {
    socket.emit("chat:join", { orderId });
  });
  socket.on("chat:joined", () => handlers.onJoined());
  socket.on("chat:update", (payload: { orderId?: unknown; lastSeq?: unknown }) => {
    if (payload?.orderId === orderId && typeof payload.lastSeq === "number") {
      handlers.onUpdate(payload.lastSeq);
    }
  });
  socket.on("chat:error", () => handlers.onLost());
  socket.on("disconnect", () => handlers.onLost());
  socket.on("connect_error", () => handlers.onLost());
  return {
    close: () => {
      socket.emit("chat:leave", { orderId });
      socket.close();
    },
  };
};
