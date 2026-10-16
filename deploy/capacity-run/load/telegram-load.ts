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
import { BASE, EV, GEN_ID, PathRecorder, RUN_DIR, sleep, sql, T0 } from "./lib.ts";
import { consumePage, type MockEvent } from "./mock-events.ts";

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

let notificationsObserved = 0;
let observationAgeMaxMs = 0;
let observationAgeSumMs = 0;
let historyTruncated = false;

/** إحصاءُ تأخيرِ التسليمِ منَ القاعدةِ (صندوقُ الصادر) — لا فلترَ يستبعدُ
 *  العيناتِ البطيئةَ: التأخيرُ = delivered_at − created_at لكلِّ صفٍّ سُلِّمَ
 *  خلالَ نافذةِ المولّدِ، بتوزيعِهِ الكاملِ (p50/p95/max). هذا هوَ زمنُ
 *  التسليمِ الحقيقيُّ (إدراجٌ ← تسليم) لا عمرُ الحدثِ عندَ رصدِهِ. */
async function outboxLatency(): Promise<Record<string, unknown> | null> {
  try {
    const startedAt = new Date(T0).toISOString();
    const rows = await sql<
      {
        delivered: string;
        pending: string;
        dead: string;
        p50: string | null;
        p95: string | null;
        max_s: string | null;
      }[]
    >`
      select
        (select count(*)::text from notification_outbox where created_at >= ${startedAt} and status = 'delivered') delivered,
        (select count(*)::text from notification_outbox where created_at >= ${startedAt} and status in ('pending','sending')) pending,
        (select count(*)::text from notification_outbox where created_at >= ${startedAt} and status = 'dead') dead,
        (select percentile_disc(0.5) within group (order by extract(epoch from (delivered_at - created_at)))::text
           from notification_outbox where created_at >= ${startedAt} and delivered_at is not null) p50,
        (select percentile_disc(0.95) within group (order by extract(epoch from (delivered_at - created_at)))::text
           from notification_outbox where created_at >= ${startedAt} and delivered_at is not null) p95,
        (select max(extract(epoch from (delivered_at - created_at)))::text
           from notification_outbox where created_at >= ${startedAt} and delivered_at is not null) max_s
    `;
    return rows[0] ?? null;
  } catch {
    // القاعدةُ غيرُ متاحةٍ من هذا المولّدِ — يُسجَّلُ الغيابُ لا رقمٌ مختلَقٌ
    return null;
  }
}

async function inboxLoop(): Promise<void> {
  // مؤشّرُ قراءةِ المحاكي: يبدأُ منَ ذيلِ السجلِّ الحاليِّ (لا يعيدُ التاريخَ)،
  // ثمّ يقرأُ الجديدَ فقط. بروتوكولُ المحاكي: المعاملُ `after` والردُّ يحملُُ
  // `seq` (لا `since`/`cursor`) — الخلطُ بينَهما كانَ يعيدُ كلَّ التاريخِ في كلِّ
  // استطلاعٍ فيصفّرُ قياسَ التأخيرِ.
  let cursor = -1;
  let tailKnown = false;
  for (;;) {
    try {
      if (!tailKnown) {
        // خطوةُ الأساسِ: موضعُ الذيلِ الآن — الأحداثُ السابقةُ ليستْ ضمنَ نافذةِ
        // القياسِ فلا تُحسَبُ ولا تُحرقُ المتوسطَ.
        const health = await fetch(`${MOCK}/health`, { signal: AbortSignal.timeout(5_000) });
        if (health.ok) {
          const body = (await health.json()) as { seq?: number };
          if (typeof body.seq === "number") {
            cursor = body.seq;
            tailKnown = true;
            ev("inbox.tail_baseline", { cursor });
          }
        }
      } else {
        const response = await fetch(`${MOCK}/events?after=${cursor}`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) {
          const body = (await response.json()) as {
            events?: MockEvent[];
            seq?: number;
            truncatedHistory?: boolean;
          };
          const consumed = (body.events ?? []) as MockEvent[];
          const next = consumePage(
            consumed,
            {
              cursor,
              observed: notificationsObserved,
              ageSumMs: observationAgeSumMs,
              ageMaxMs: observationAgeMaxMs,
            },
            Date.now(),
          );
          cursor = next.cursor;
          notificationsObserved = next.observed;
          observationAgeSumMs = next.ageSumMs;
          observationAgeMaxMs = next.ageMaxMs;
          // الصفحةُ الفارغةُ لا تعني القفزَ إلى رأسِ السجلِّ إلا إذا كانَ الرأسُ
          // نفسُهُ هوَ الموضعَ التاليَ (لا أحداثٌ بينَ المؤشّرِ والرأسِ).
          if (consumed.length === 0 && typeof body.seq === "number" && body.seq <= cursor + 1) {
            cursor = body.seq;
          }
          if (body.truncatedHistory === true) {
            // نقصٌ في الدليلِ (تدويرُ الحلقةِ تجاوزَ النافذةَ) — يُعلَنُ في الخلاصةِ
            historyTruncated = true;
            ev("inbox.truncated_history", { cursor });
          }
        }
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
      // عمرُ الحدثِ عندَ الرصدِ (متوسطٌ وأقصى) — ليسَ تأخيرَ تسليمٍ؛ التسليمُ
      // يُقاسُ منَ القاعدةِ في `outboxLatency` ويُرفقُ عندَ الختام.
      observationAgeAvgMs:
        notificationsObserved === 0
          ? null
          : Math.round(observationAgeSumMs / notificationsObserved),
      observationAgeMaxMs: observationAgeMaxMs === 0 ? null : observationAgeMaxMs,
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
  // تأخيرُ التسليمِ منَ القاعدةِ — قياسٌ صالحٌ يلتقطُ العيناتِ البطيئةَ ولا يصفرُ
  // نفسَهُ: إدراجٌ ← تسليمٌ لكلِّ إشعارِ النافذةِ بتوزيعِهِ الكاملِ.
  const deliveryLatency = await outboxLatency();
  ev("gen.end", {
    webhookInbound429,
    webhook2xx,
    webhookOther,
    notificationsObserved,
    observationAgeMaxMs: observationAgeMaxMs === 0 ? null : observationAgeMaxMs,
    historyTruncated,
    outboxDeliveryLatency: deliveryLatency,
    elapsedSec: Math.round((Date.now() - T0) / 1000),
  });
  console.log(
    JSON.stringify({
      path: "telegram_webhook",
      gen: GEN_ID,
      webhookInbound429,
      webhook2xx,
      outboxDeliveryLatency: deliveryLatency,
    }),
  );
  await sql.end({ timeout: 5 }).catch(() => {});
}

void main();
