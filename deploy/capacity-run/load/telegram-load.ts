/* biome-ignore-all lint/style/noNonNullAssertion: أداة حمل تجريبية — الصفوف مضمونة بالبذر وفشلها يُسجَّل */
/**
 * R1 · ADR 0286 — المسارُ «ب»: حملُ دخولِ تيليجرام وإشعاراتِهِ — **لا أعمالَ
 *   منتجٍ عبرَ webhook**: لا إنشاءَ طلباتٍ ولا قبولَ عروضٍ ولا تسويةَ تفاوضٍ عبرَ
 *   أزرارٍ قديمةٍ. دورةُ أعمالِ المنتجِ ملكُ المسارِ «أ» (Mini App HTTP).
 *
 * ما يولّده هذا المسارُ:
 *   ١) حملُ دخولٍ: أوامرُ البدءِ والقوائمِ (`/start` وما في حكمِهِ) عبرَ webhook
 *      — وهو الحملُ الذي يقيسُ عنقَ صفِّ البوتِ (R1) لا سلوكَ المنتجِ.
 *   ٢) رصدُ الإشعاراتِ المُسلَّمةِ في محاكي تيليجرام (مُنتَجةٌ من طلباتِ المسارِ
 *      «أ») — عدٌّ وتأخيرٌ فقط، **بلا انتظارِها** فلا يتوقفَ هذا المسارُ على
 *      إشعارٍ ليستمرَّ، ولا يُنسبُ لهُ دورةُ عملٍ.
 *
 * المقاييسُ المنفصلةُ (لا خلطَ في مقياسٍ واحدٍ):
 *   - `webhook_inbound_429`: رفضُ البوابةِ لدفعةِ webhook عندَ سقفِ الصفِّ — يُقاسُ
 *     منَ ردِّ البوابةِ نفسِها.
 *   - `notification_delivery`: وصولُ رسائلِ المحاكي (عددٌ وتأخيرُ وصولٍ) — رصدٌ
 *     لا انتظارٌ.
 *
 * التشغيلُ: `RUN_DIR=… GEN_ID=genB bun run deploy/capacity-run/load/telegram-load.ts`
 * يقرأُ: GATEWAY_URL · MOCK_TELEGRAM_URL · TELEGRAM_WEBHOOK_SECRET · PROFILE.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { BASE, EV, GEN_ID, PathRecorder, RUN_DIR, sleep, T0 } from "./lib.ts";

mkdirSync(`${RUN_DIR}/evidence`, { recursive: true });

const MOCK = process.env.MOCK_TELEGRAM_URL ?? "http://127.0.0.1:58090";
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
if (SECRET === "") {
  console.error("✖ عيّن TELEGRAM_WEBHOOK_SECRET من بيئةِ الجولةِ.");
  process.exit(1);
}

type Phase = { name: string; sec: number; ratePerSec: number };
const PROFILE: Phase[] = JSON.parse(
  process.env.PROFILE ?? '[{"name":"smoke","sec":120,"ratePerSec":2}]',
);
const CHATS = Number(process.env.N_CHATS ?? 500);

const rec = new PathRecorder({
  path: "telegram_webhook",
  gen: GEN_ID,
  class429: "webhook_inbound",
});
let webhookInbound429 = 0;
let webhook2xx = 0;
let webhookOther = 0;

let phase = "init";
function ev(event: string, data: Record<string, unknown> = {}) {
  appendFileSync(
    `${EV}/telegram-load-events.jsonl`,
    `${JSON.stringify({ t: new Date().toISOString(), path: "telegram_webhook", gen: GEN_ID, phase, event, ...data })}\n`,
  );
}

/* ───────── دخولُ webhook — أوامرُ بدءٍ فقط، لا أعمالَ ───────── */

const nextUpdateId = (() => {
  let id = (Math.floor(Date.now() / 1000) % 100_000_000) * 20 + 5;
  return () => (id += 1);
})();

function startUpdate(chat: number): string {
  return JSON.stringify({
    update_id: nextUpdateId(),
    message: {
      chat: { id: chat },
      from: { id: chat, is_bot: false, first_name: "sbx", language_code: "ar" },
      date: Math.floor(Date.now() / 1000),
      text: "/start",
    },
  });
}

/** دفعةُ دخولٍ واحدةٌ — الرفضُ 429 عندَ سقفِ الصفِّ يُحسبُ في صنفِهِ لا في غيرِهِ. */
async function sendEntry(bot: "driver" | "rider", chat: number): Promise<void> {
  rec.httpStart();
  let is429 = false;
  let status = 0;
  try {
    const response = await fetch(`${BASE}/webhook/telegram/${bot}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": SECRET,
      },
      body: startUpdate(chat),
      signal: AbortSignal.timeout(10_000),
    });
    status = response.status;
    is429 = response.status === 429;
    await response.arrayBuffer();
  } catch {
    status = 0;
  } finally {
    rec.httpEnd({
      status,
      ok: status >= 200 && status < 300,
      is429,
      elapsedMs: 0,
      body: null,
      networkError: status === 0 ? "network" : null,
    });
    if (is429) webhookInbound429 += 1;
    else if (status >= 200 && status < 300) webhook2xx += 1;
    else webhookOther += 1;
  }
}

/* ───────── رصدُ الإشعاراتِ (بلا انتظارٍ) ───────── */

interface MockEvent {
  readonly t: number;
  readonly chat: string;
  readonly kind: string;
}

let notificationsObserved = 0;
let notificationLatencyFresh = 0;
let notificationLatencySumMs = 0;

async function inboxLoop(): Promise<void> {
  // مؤشّرُ قراءةِ المحاكيِ المتسلسلِ — قراءةُ الذيلِ فقط لا تصفيرَ لبياناتِهِ.
  let cursor = -1;
  for (;;) {
    try {
      const response = await fetch(`${MOCK}/events?since=${cursor}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { events?: MockEvent[]; cursor?: number };
        for (const event of body.events ?? []) {
          notificationsObserved += 1;
          // تأخيرُ الإشعارِ يقيسُ الطازجَ فقط (≤60ث من لحظةِ التسليمِ في
          // المحاكي): السجلُّ التراكميُّ منذُ إقلاعِ المحاكيِّ يجعلُ المتوسطَ
          // دقائقَ لا معنى لها. العدُّ الكليُّ يبقى شاملًا.
          const age = Date.now() - event.t;
          if (age <= 60_000) {
            notificationLatencySumMs += Math.max(0, age);
            notificationLatencyFresh += 1;
          }
        }
        if (typeof body.cursor === "number") cursor = body.cursor;
      }
    } catch {
      // المحاكيُّ غائبٌ أو متعثرٌ — يُرصدُ ولا يوقفُ المسارَ (إثباتُ العزلِ).
    }
    await sleep(2_000);
  }
}

/* ───────── الحلقةُ الرئيسةُ ───────── */

async function main() {
  ev("gen.start", { profile: PROFILE, chats: CHATS });
  void inboxLoop();
  const snapshotTimer = setInterval(() => {
    rec.snapshot();
    ev("window", {
      webhookInbound429,
      webhook2xx,
      webhookOther,
      notificationsObserved,
      notificationLatencyAvgMs:
        notificationLatencyFresh === 0
          ? null
          : Math.round(notificationLatencySumMs / notificationLatencyFresh),
      notificationLatencyFresh,
    });
  }, 10_000);
  for (const ph of PROFILE) {
    phase = ph.name;
    ev("phase.start", { name: ph.name, sec: ph.sec, ratePerSec: ph.ratePerSec });
    const stopAt = Date.now() + ph.sec * 1000;
    let chat = 1;
    while (Date.now() < stopAt) {
      const batch = Math.max(1, Math.round(ph.ratePerSec));
      const sends = Array.from({ length: batch }, () => {
        const c = (chat % CHATS) + 1;
        chat += 1;
        return sendEntry(chat % 2 === 0 ? "rider" : "driver", c);
      });
      await Promise.all(sends);
      await sleep(1_000);
    }
  }
  clearInterval(snapshotTimer);
  rec.snapshot(true);
  ev("gen.end", {
    webhookInbound429,
    webhook2xx,
    webhookOther,
    notificationsObserved,
    elapsedSec: Math.round((Date.now() - T0) / 1000),
  });
  console.log(
    JSON.stringify({ path: "telegram_webhook", gen: GEN_ID, webhookInbound429, webhook2xx }),
  );
}

void main();
