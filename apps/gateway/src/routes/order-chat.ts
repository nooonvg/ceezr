/**
 * الغرض: `WR-04` — مساراتُ محادثةِ طرفَي الطلبِ:
 *   `GET /v1/orders/:orderId/chat?after=<seq>` و`POST /v1/orders/:orderId/chat/messages`
 *   و`POST /v1/orders/:orderId/chat/read`.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 * الحاكم: `docs/adr/0263-order-chat-in-miniapp.md`.
 *
 * مسارٌ واحدٌ للراكبِ والسائقِ: الدورُ **يحكمُه الخادمُ** من الطلبِ والجلسة، لا
 * بادئةُ المسارِ ولا حقلٌ يرسلُه العميل. ولا يُسجَّلُ نصُّ رسالةٍ ولا معرّفُ تيليجرام.
 */

import { type Context, Hono } from "hono";
import {
  markOrderChatRead,
  type OrderChatDeps,
  type OrderChatMessage,
  type OrderChatPublicErrorCode,
  postOrderChatMessage,
  readOrderChat,
} from "../../../../packages/application/messaging/order-chat.ts";
import { readBounded } from "./telegram-webhook.ts";

export interface OrderChatRouteDependencies {
  /** غيابُها يُعطِّلُ المساراتِ بـ503 ولا يجعلُها تُجيبُ بلا تحقّق. */
  readonly chat?: OrderChatDeps;
}

/** رسالةٌ بألفِ محرفٍ عربيٍّ ومعرّفٍ — والحدُّ حدُّ نقلٍ لا قيمةٌ تجاريّة. */
export const ORDER_CHAT_MAX_BYTES = 4096;

const STATUS_BY_ERROR: Readonly<Record<OrderChatPublicErrorCode, 401 | 404 | 409 | 422 | 503>> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  // جسمٌ لا يُقرأُ رفضُ تحقّقٍ كأخواتِه — كما في مساراتِ الدعم.
  MALFORMED: 422,
  ORDER_ID_INVALID: 422,
  CLIENT_ID_INVALID: 422,
  // لا فرقَ بينَ «لا طلبَ» و«ليسَ طلبَكَ».
  CHAT_NOT_FOUND: 404,
  // الطلبُ انتهى: السجلُّ يُقرأُ ولا يُكتَبُ فيه.
  CHAT_CLOSED: 409,
  MESSAGE_EMPTY: 422,
  MESSAGE_TOO_LONG: 422,
  CHAT_STORE_NOT_AVAILABLE: 503,
};

function rejected(c: Context, code: OrderChatPublicErrorCode) {
  return c.json({ ok: false, error: code }, STATUS_BY_ERROR[code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

export function wireMessage(message: OrderChatMessage) {
  return {
    id: message.id,
    seq: message.seq,
    sender_role: message.senderRole,
    mine: message.mine,
    client_message_id: message.clientMessageId,
    body: message.body,
    created_at: message.createdAt,
  };
}

async function readJson(c: Context): Promise<unknown | "TOO_LARGE" | "INVALID"> {
  const declared = Number(c.req.header("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > ORDER_CHAT_MAX_BYTES) return "TOO_LARGE";
  const raw = await readBounded(c.req.raw.body, ORDER_CHAT_MAX_BYTES);
  if (raw === null) return "TOO_LARGE";
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return "INVALID";
  }
}

export function createOrderChatRoutes(deps: OrderChatRouteDependencies): Hono {
  const app = new Hono();

  app.get("/v1/orders/:orderId/chat", async (c) => {
    if (deps.chat === undefined) return rejected(c, "CHAT_STORE_NOT_AVAILABLE");
    const result = await readOrderChat(deps.chat, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
      afterSeq: c.req.query("after"),
    });
    if (!result.ok) return rejected(c, result.error);
    const thread = result.value;
    return c.json({
      ok: true,
      order: {
        id: thread.orderId,
        service: thread.service,
        status: thread.status,
        writable: thread.writable,
      },
      my_role: thread.myRole,
      counterpart: { role: thread.counterpart.role, first_name: thread.counterpart.firstName },
      messages: thread.messages.map(wireMessage),
      last_seq: thread.lastSeq,
      my_last_read_seq: thread.myLastReadSeq,
      counterpart_last_read_seq: thread.counterpartLastReadSeq,
      unread: thread.unread,
    });
  });

  app.post("/v1/orders/:orderId/chat/messages", async (c) => {
    if (deps.chat === undefined) return rejected(c, "CHAT_STORE_NOT_AVAILABLE");
    const body = await readJson(c);
    if (body === "TOO_LARGE") return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    if (body === "INVALID") return rejected(c, "MALFORMED");
    const result = await postOrderChatMessage(deps.chat, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
      body,
    });
    if (!result.ok) return rejected(c, result.error);
    return c.json(
      { ok: true, status: result.value.status, message: wireMessage(result.value.message) },
      result.value.status === "added" ? 201 : 200,
    );
  });

  app.post("/v1/orders/:orderId/chat/read", async (c) => {
    if (deps.chat === undefined) return rejected(c, "CHAT_STORE_NOT_AVAILABLE");
    const body = await readJson(c);
    if (body === "TOO_LARGE") return c.json({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413);
    if (body === "INVALID") return rejected(c, "MALFORMED");
    const result = await markOrderChatRead(deps.chat, {
      accessToken: bearerTokenFrom(c.req.header("authorization")),
      orderId: c.req.param("orderId"),
      body,
    });
    if (!result.ok) return rejected(c, result.error);
    return c.json({ ok: true, status: "read" });
  });

  return app;
}
