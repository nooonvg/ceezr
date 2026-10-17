/**
 * الغرض: قناةُ Socket.IO لتحديثِ عروضِ السائقِ — ينضمُّ السائقُ إلى غرفتِه ويستقبِلُ
 *   إشارةَ `offers:update` فيُجدِّدُ قائمتَه (DEC-32 · ADR 0229).
 * ينتمي إلى: apps/gateway/src/realtime
 * يحكمُه: ADR 0042 (ناقلُ الزمنِ الحقيقيِّ لـMini App = Socket.IO)
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يحملُ بياناتِ عرضٍ**: الإشارةُ وحدَها — القراءةُ من الـ API.
 *   ــ **لا يُصدِّقُ حالةَ التوافر**: ذلك قرارُ السائقِ لا الخادمِ.
 *   ــ **لا يُصدِّقُ رمزَ الجلسةِ هنا**: `OffersSessionVerifier` يفعلُ.
 */

import type { Server as IoServer, Socket as IoSocket } from "socket.io";

/** يُحقِّقُ رمزَ جلسةِ Mini App ويُعيدُ مُعرِّفَ السائقِ (telegram_id). */
export interface OffersSessionVerifier {
  verify(sessionToken: string): Promise<{ telegramUserId: string } | null>;
}

export interface OffersChannelDeps {
  readonly io: IoServer;
  readonly sessions: OffersSessionVerifier;
}

export interface OffersChannel {
  readonly start: () => void;
  readonly stop: () => void;
  /** يبثُّ إشارةَ تحديثٍ إلى غرفةِ سائقٍ بعينِه. */
  readonly notifyDriver: (telegramUserId: string) => void;
  /**
   * `LOAD-01 Recovery` — هل السائقُ في غرفةِ العروضِ الآنَ (يقينٌ محليٌّ
   * بهذهِ النسخةِ — انظرِ التنفيذَ). الغائبُ لا يُنتظرُ ولا يُزعَمُ بثٌّ لهُ.
   */
  readonly isDriverConnected: (telegramUserId: string) => boolean;
}

export function createOffersChannel(deps: OffersChannelDeps): OffersChannel {
  let connectionHandler: ((socket: IoSocket) => void) | null = null;

  function start(): void {
    connectionHandler = (socket: IoSocket) => {
      socket.on("offers:join", async () => {
        const sessionToken = socket.handshake.auth?.sessionToken as string | undefined;
        if (sessionToken === undefined) {
          socket.emit("offers:error", { code: "NO_SESSION" });
          return;
        }

        const session = await deps.sessions.verify(sessionToken);
        if (session === null) {
          socket.emit("offers:error", { code: "INVALID_SESSION" });
          return;
        }

        // غرفةُ السائقِ بمفتاحِ telegram_id — نفسُ المفتاحِ الذي تُبنى به العروضُ.
        socket.join(`driver-offers:${session.telegramUserId}`);
        socket.emit("offers:joined", {});
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

  function notifyDriver(telegramUserId: string): void {
    deps.io.to(`driver-offers:${telegramUserId}`).emit("offers:update");
  }

  /**
   * `LOAD-01 Recovery` — هل السائقُ في غرفةِ العروضِ الآن؟ يقينٌ محليٌّ
   * (`adapter.rooms` خريطةُ هذهِ النسخةِ وحدَها — من يوسّعُ النشرَ إلى نسخٍ
   * متعددةٍ يوسّعُ معهُ هذا الفحصَ بمهايئٍ مشتركٍ، وهوَ مُعلَنٌ في الأدلةِ لا
   * مُضمَر). وظيفتُهُ: أنْ لا يُنتظرَ غيرُ المتصلِ ولا يُزعَمَ بثٌّ لغائبٍ.
   */
  function isDriverConnected(telegramUserId: string): boolean {
    return deps.io.sockets.adapter.rooms.has(`driver-offers:${telegramUserId}`);
  }

  return { start, stop, notifyDriver, isDriverConnected };
}
