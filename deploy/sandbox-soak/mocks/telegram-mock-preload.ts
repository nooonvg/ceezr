/**
 * Telegram Mock — يُحمَّل عبر `bun --preload` قبل البوّابة الحقيقية.
 * يعترض كل نداء إلى api.telegram.org ويردّ ردّاً بصيغة Bot API الحقيقية،
 * ويسجّل كل رسالة صادرة (للسائقين/الركاب/القروبات) في عدّادات + JSONL.
 * أي نداء لمضيف آخر يمرّ كما هو.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const LOG_DIR = process.env.SANDBOX_LOG_DIR ?? new URL("../logs", import.meta.url).pathname;
mkdirSync(LOG_DIR, { recursive: true });
const realFetch = globalThis.fetch.bind(globalThis);
let messageId = 1000;
const stats = {
  started_at: new Date().toISOString(),
  total: 0,
  by_method: {} as Record<string, number>,
  by_bot: {} as Record<string, number>,
  to_groups: 0,
  to_private: 0,
  group_chats: {} as Record<string, number>,
};
const buffer: string[] = [];

function flush() {
  if (buffer.length > 0) {
    appendFileSync(`${LOG_DIR}/telegram-mock.jsonl`, `${buffer.join("\n")}\n`);
    buffer.length = 0;
  }
  writeFileSync(`${LOG_DIR}/telegram-mock-stats.json`, JSON.stringify(stats, null, 2));
}
setInterval(flush, 2000).unref?.();
process.on("exit", flush);

async function readBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  try {
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof body === "string") return JSON.parse(body);
    if (body instanceof FormData) {
      const o: Record<string, unknown> = {};
      for (const [k, v] of body.entries()) o[k] = typeof v === "string" ? v : "[file]";
      return o;
    }
  } catch {}
  return {};
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("api.telegram.org")) return realFetch(input as RequestInfo, init);
  const m = url.match(/\/bot([^/]+)\/([A-Za-z]+)/);
  const token = m?.[1] ?? "?";
  const method = m?.[2] ?? "unknown";
  const body = await readBody(input, init);
  const bot = token.includes("driver")
    ? "driver"
    : token.includes("rider")
      ? "rider"
      : token.slice(0, 8);
  stats.total++;
  stats.by_method[method] = (stats.by_method[method] ?? 0) + 1;
  stats.by_bot[bot] = (stats.by_bot[bot] ?? 0) + 1;
  const chatId = String(body.chat_id ?? "");
  if (chatId.startsWith("-")) {
    stats.to_groups++;
    stats.group_chats[chatId] = (stats.group_chats[chatId] ?? 0) + 1;
  } else if (chatId) stats.to_private++;
  buffer.push(
    JSON.stringify({
      t: Date.now(),
      bot,
      method,
      chat_id: chatId,
      text: typeof body.text === "string" ? body.text.slice(0, 160) : undefined,
      cb: body.reply_markup ? String(JSON.stringify(body.reply_markup)).slice(0, 200) : undefined,
    }),
  );
  if (buffer.length > 500) flush();
  let result: unknown = true;
  const now = Math.floor(Date.now() / 1000);
  switch (method) {
    case "getMe":
      result = { id: 1, is_bot: true, first_name: `mock_${bot}`, username: `mock_${bot}_bot` };
      break;
    case "sendMessage":
    case "sendPhoto":
    case "sendLocation":
    case "editMessageText":
    case "editMessageReplyMarkup":
    case "sendDocument":
      result = {
        message_id: ++messageId,
        date: now,
        chat: { id: Number(chatId) || 0, type: chatId.startsWith("-") ? "supergroup" : "private" },
        text: body.text,
      };
      break;
    case "createChatInviteLink":
      result = {
        invite_link: "https://t.me/+mock",
        creator: { id: 1 },
        is_primary: false,
        is_revoked: false,
      };
      break;
    case "getFile":
      result = { file_id: body.file_id, file_unique_id: "u", file_path: "photos/mock.jpg" };
      break;
    case "getWebhookInfo":
      result = { url: "", has_custom_certificate: false, pending_update_count: 0 };
      break;
  }
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

console.log("[telegram-mock] active — api.telegram.org intercepted");
