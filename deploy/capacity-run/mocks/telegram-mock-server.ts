/* biome-ignore-all lint/style/noNonNullAssertion: أداة اختبار محلية */
/**
 * CAP-RUN-20261016 — محاكي Bot API لتيليجرام كخادم HTTP مستقل على loopback.
 *
 * - يستقبل كل نداء `POST /bot<token>/<method>` تُعيد البوابة توجيهه إليه عبر حارس الخروج
 *   (`telegram-egress-guard.ts`). لا يتصل بالإنترنت أبدًا.
 * - يسجّل كل رسالة صادرة: تسلسل، وقت، بوت، طريقة، وجهة، معرّف رسالة تجريبي، نص مختصر،
 *   بيانات الأزرار (callback_data)، ونتيجة الرد (200/429). إلى JSONL على القرص.
 * - يكشف `GET /events?after=<seq>` ليقرأ مولّد الحمل «صندوق وارد» كل سائق/زبون: القبول في
 *   السيناريوهات الأساسية مشروط بظهور زر `offer:accept:<orderId>` هنا، لا بقراءة القاعدة.
 * - حدود المعدل: حد عام لكل بوت (افتراضيًا 30 رسالة/ث) يُرفض بـ 429 مع retry_after كما يفعل
 *   تيليجرام؛ وحد المحادثة الخاصة (1/ث) والقروب (20/دقيقة) يُعدّان مخالفاتٍ (soft) ولا يُرفضان.
 *   هذه حدود معلنة للمحاكاة، ولا يُعدّ قبول المحاكي دليلًا على قبول تيليجرام الحقيقي.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT ?? 58090);
const LOG_DIR = process.env.RUN_DIR ? `${process.env.RUN_DIR}/evidence` : "/tmp/tg-mock";
const GLOBAL_PER_BOT_PER_SEC = Number(process.env.MOCK_GLOBAL_PER_BOT_PER_SEC ?? 30);
const DRIVER_TOKEN = process.env.DRIVER_BOT_TOKEN ?? "";
const RIDER_TOKEN = process.env.RIDER_BOT_TOKEN ?? "";
// نزاهةُ القياسِ: محاكٍ بلا رمزَي البوتينِ يصنّفُ كلَّ إرساليةٍ «unknown» فيجمعُ
// البوتينِ في نافذةِ 30/ث واحدةٍ — وتيليجرامُ الحقيقيُّ يحدُّ لكلِّ بوتٍ على
// حدةٍ. هذا ما أفسدَ قياسَ P7 في r7–r9 (بدأ المحاكي قبلَ ملفِّ الأسرارِ
// بثانيتين). فلا بدءَ برمزٍ فارغٍ: الفشلُ الصريحُ خيرٌ من قياسٍ مزيَّفٍ.
if (DRIVER_TOKEN === "" || RIDER_TOKEN === "" || DRIVER_TOKEN === RIDER_TOKEN) {
  console.error("telegram-mock: DRIVER_BOT_TOKEN/RIDER_BOT_TOKEN مفقودان أو متطابقان — يُرفضُ البدء");
  process.exit(2);
}
const KEEP = 400_000;
mkdirSync(LOG_DIR, { recursive: true });

type Rec = {
  seq: number;
  t: number;
  bot: string;
  method: string;
  chat_id: string;
  message_id: number | null;
  status: number;
  text?: string;
  cbs?: string[];
  user_id?: string;
};
let seq = 0;
let messageId = 50_000;
const ring: Rec[] = [];
const buf: string[] = [];
const stats = {
  started_at: new Date().toISOString(),
  total: 0,
  accepted: 0,
  rejected_429: 0,
  by_method: {} as Record<string, number>,
  by_bot: {} as Record<string, number>,
  soft_violations_private_1ps: 0,
  soft_violations_group_20pm: 0,
  unknown_token: 0,
  unparsable_body: 0,
};
const botWindow = new Map<string, number[]>();
const chatLast = new Map<string, number>();
const groupWindow = new Map<string, number[]>();

function flush() {
  if (buf.length > 0) {
    appendFileSync(`${LOG_DIR}/telegram-mock.jsonl`, `${buf.join("\n")}\n`);
    buf.length = 0;
  }
  writeFileSync(
    `${LOG_DIR}/telegram-mock-stats.json`,
    JSON.stringify({ ...stats, seq, at: new Date().toISOString() }, null, 2),
  );
}
setInterval(flush, 1000);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    flush();
    process.exit(0);
  });

function botOf(token: string): string {
  if (token === DRIVER_TOKEN) return "driver";
  if (token === RIDER_TOKEN) return "rider";
  stats.unknown_token++;
  return "unknown";
}

function callbacks(markup: unknown): string[] | undefined {
  let m = markup;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      return undefined;
    }
  }
  const rows = (m as { inline_keyboard?: { callback_data?: string }[][] } | null)?.inline_keyboard;
  if (!Array.isArray(rows)) return undefined;
  const out: string[] = [];
  for (const r of rows) for (const b of r) if (b?.callback_data) out.push(b.callback_data);
  return out.length ? out : undefined;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("multipart/form-data") || ct.includes("x-www-form-urlencoded")) {
      const f = await req.formData();
      const o: Record<string, unknown> = {};
      for (const [k, v] of f.entries()) o[k] = typeof v === "string" ? v : "[file]";
      return o;
    }
    // Bun يضغط جسم الطلب gzip حين تمرّر grammY `compress: true` — تيليجرام الحقيقي يقبله، فالمحاكي يفكّه.
    let bytes = new Uint8Array(await req.arrayBuffer());
    const enc = (req.headers.get("content-encoding") ?? "").toLowerCase();
    if (enc.includes("gzip")) bytes = Bun.gunzipSync(bytes);
    else if (enc.includes("deflate")) bytes = Bun.inflateSync(bytes);
    const t = new TextDecoder().decode(bytes);
    return t ? (JSON.parse(t) as Record<string, unknown>) : {};
  } catch {
    stats.unparsable_body++;
    return {};
  }
}

function rateCheck(bot: string, chat: string, now: number): boolean {
  const w = botWindow.get(bot) ?? [];
  while (w.length && w[0]! <= now - 1000) w.shift();
  if (w.length >= GLOBAL_PER_BOT_PER_SEC) {
    botWindow.set(bot, w);
    return false;
  }
  w.push(now);
  botWindow.set(bot, w);
  if (chat) {
    const key = `${bot}:${chat}`;
    if (chat.startsWith("-")) {
      const g = groupWindow.get(key) ?? [];
      while (g.length && g[0]! <= now - 60_000) g.shift();
      if (g.length >= 20) stats.soft_violations_group_20pm++;
      g.push(now);
      groupWindow.set(key, g);
    } else {
      const last = chatLast.get(key);
      if (last !== undefined && now - last < 1000) stats.soft_violations_private_1ps++;
      chatLast.set(key, now);
    }
  }
  return true;
}

const SENDS = new Set([
  "sendMessage",
  "sendPhoto",
  "sendLocation",
  "sendDocument",
  "sendVenue",
  "copyMessage",
  "forwardMessage",
]);
const EDITS = new Set(["editMessageText", "editMessageReplyMarkup", "editMessageCaption"]);

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, seq });
    if (req.method === "GET" && url.pathname === "/stats") return Response.json({ ...stats, seq });
    if (req.method === "GET" && url.pathname === "/events") {
      const after = Number(url.searchParams.get("after") ?? 0);
      const limit = Math.min(20_000, Number(url.searchParams.get("limit") ?? 5000));
      // البحث الثنائي في الحلقة المرتبة بالتسلسل
      let lo = 0;
      let hi = ring.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ring[mid]!.seq <= after) lo = mid + 1;
        else hi = mid;
      }
      const out = ring.slice(lo, lo + limit);
      const truncatedHistory = ring.length > 0 && ring[0]!.seq > after + 1;
      return Response.json({ seq, events: out, truncatedHistory });
    }
    const m = url.pathname.match(/^\/bot([^/]+)\/([A-Za-z]+)$/);
    if (!m) return new Response("not found", { status: 404 });
    const token = m[1]!;
    const method = m[2]!;
    const b = await body(req);
    const bot = botOf(token);
    const now = Date.now();
    stats.total++;
    stats.by_method[method] = (stats.by_method[method] ?? 0) + 1;
    stats.by_bot[bot] = (stats.by_bot[bot] ?? 0) + 1;
    const chat = String(b.chat_id ?? "");
    const counted = SENDS.has(method) || EDITS.has(method);
    const allowed = !counted || rateCheck(bot, chat, now);
    const rec: Rec = {
      seq: ++seq,
      t: now,
      bot,
      method,
      chat_id: chat,
      message_id: null,
      status: allowed ? 200 : 429,
    };
    if (typeof b.text === "string") rec.text = b.text.slice(0, 300);
    else if (typeof b.caption === "string") rec.text = b.caption.slice(0, 300);
    const cbs = callbacks(b.reply_markup);
    if (cbs) rec.cbs = cbs;
    if (b.user_id !== undefined) rec.user_id = String(b.user_id);
    if (!allowed) {
      stats.rejected_429++;
      ring.push(rec);
      buf.push(JSON.stringify(rec));
      return Response.json(
        {
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 1",
          parameters: { retry_after: 1 },
        },
        { status: 429 },
      );
    }
    stats.accepted++;
    let result: unknown = true;
    const unix = Math.floor(now / 1000);
    if (SENDS.has(method) || EDITS.has(method)) {
      const id = EDITS.has(method) ? Number(b.message_id ?? ++messageId) : ++messageId;
      rec.message_id = id;
      result = {
        message_id: id,
        date: unix,
        chat: { id: Number(chat) || 0, type: chat.startsWith("-") ? "supergroup" : "private" },
        text: b.text,
      };
    } else if (method === "getMe") {
      result = {
        id: Number(token.split(":")[0]) || 1,
        is_bot: true,
        first_name: `mock_${bot}`,
        username: `mock_${bot}_bot`,
      };
    } else if (method === "createChatInviteLink") {
      result = {
        invite_link: `https://t.me/+mock${seq}`,
        creator: { id: 1 },
        is_primary: false,
        is_revoked: false,
      };
    } else if (method === "getFile") {
      result = { file_id: b.file_id, file_unique_id: "u", file_path: "photos/mock.jpg" };
    } else if (method === "getWebhookInfo") {
      result = { url: "", has_custom_certificate: false, pending_update_count: 0 };
    } else if (method === "getChatMember") {
      result = {
        status: "member",
        user: { id: Number(b.user_id) || 0, is_bot: false, first_name: "t" },
      };
    } else if (method === "getChat") {
      result = { id: Number(chat) || 0, type: chat.startsWith("-") ? "supergroup" : "private" };
    }
    ring.push(rec);
    if (ring.length > KEEP) ring.splice(0, ring.length - KEEP);
    buf.push(JSON.stringify(rec));
    if (buf.length > 2000) flush();
    return Response.json({ ok: true, result });
  },
});
console.log(`[telegram-mock-server] listening 127.0.0.1:${PORT}`);
