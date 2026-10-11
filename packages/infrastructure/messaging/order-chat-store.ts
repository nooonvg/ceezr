/**
 * الغرض: `WR-04` — محوِّلُ محادثةِ الطلبِ على PostgreSQL: ينادي
 *   `list_order_messages` و`post_order_message` و`mark_order_messages_read`،
 *   ويقرأُ ردودَها بحذرٍ — حقلٌ ناقصٌ أو غريبٌ `MALFORMED_RESULT` لا قيمةٌ مُخمَّنة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/infrastructure/messaging
 * يُستخدم من: `apps/gateway/src/index.ts` (تركيبُ مساراتِ المحادثةِ وقناتِها).
 */

import type {
  OrderChatMessage,
  OrderChatRole,
  OrderChatStore,
  OrderChatStoreError,
  OrderChatStoreRejection,
  OrderChatThread,
} from "../../application/messaging/order-chat.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Sql } from "../db/client.ts";

const TELEGRAM_ID_PATTERN = /^[0-9]{1,19}$/;
const REJECTIONS: readonly OrderChatStoreRejection[] = [
  "CHAT_NOT_FOUND",
  "CHAT_CLOSED",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "CLIENT_ID_INVALID",
];

type Payload = Readonly<Record<string, unknown>>;

const storeError: OrderChatStoreError = { reason: "STORE_ERROR" };
const malformed: OrderChatStoreError = { reason: "MALFORMED_RESULT" };

function isRecord(value: unknown): value is Payload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInt(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readRole(value: unknown): OrderChatRole | null {
  return value === "rider" || value === "driver" ? value : null;
}

function readInstant(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function rejectionFrom(payload: Payload): OrderChatStoreError {
  const code = payload.error;
  if (typeof code === "string" && (REJECTIONS as readonly string[]).includes(code)) {
    return { rejection: code as OrderChatStoreRejection };
  }
  return malformed;
}

export function readChatMessage(value: unknown): OrderChatMessage | null {
  if (!isRecord(value)) return null;
  const seq = readInt(value.seq);
  const senderRole = readRole(value.sender_role);
  const createdAt = readInstant(value.created_at);
  if (
    typeof value.id !== "string" ||
    seq === null ||
    senderRole === null ||
    typeof value.mine !== "boolean" ||
    typeof value.body !== "string" ||
    createdAt === null
  ) {
    return null;
  }
  return {
    id: value.id,
    seq,
    senderRole,
    mine: value.mine,
    clientMessageId: typeof value.client_message_id === "string" ? value.client_message_id : null,
    body: value.body,
    createdAt,
  };
}

export function readChatThread(payload: Payload): OrderChatThread | null {
  const order = payload.order;
  const counterpart = payload.counterpart;
  if (!isRecord(order) || !isRecord(counterpart) || !Array.isArray(payload.messages)) return null;
  const service = order.service;
  const myRole = readRole(payload.my_role);
  const counterpartRole = readRole(counterpart.role);
  const lastSeq = readInt(payload.last_seq);
  const myLastReadSeq = readInt(payload.my_last_read_seq);
  const counterpartLastReadSeq = readInt(payload.counterpart_last_read_seq);
  const unread = readInt(payload.unread);
  if (
    typeof order.id !== "string" ||
    (service !== "transport" && service !== "delivery") ||
    typeof order.status !== "string" ||
    typeof order.writable !== "boolean" ||
    myRole === null ||
    counterpartRole === null ||
    lastSeq === null ||
    myLastReadSeq === null ||
    counterpartLastReadSeq === null ||
    unread === null
  ) {
    return null;
  }
  const messages: OrderChatMessage[] = [];
  for (const raw of payload.messages) {
    const message = readChatMessage(raw);
    if (message === null) return null;
    messages.push(message);
  }
  return {
    orderId: order.id,
    service,
    status: order.status,
    writable: order.writable,
    myRole,
    counterpart: {
      role: counterpartRole,
      firstName: typeof counterpart.first_name === "string" ? counterpart.first_name : null,
    },
    messages,
    lastSeq,
    myLastReadSeq,
    counterpartLastReadSeq,
    unread,
  };
}

async function call(
  sql: Sql,
  query: string,
  params: readonly unknown[],
): Promise<Result<Payload, OrderChatStoreError>> {
  try {
    const rows = await sql.unsafe<{ result: unknown }[]>(query, params as never[]);
    const result = rows[0]?.result;
    if (!isRecord(result)) return err(malformed);
    return ok(result);
  } catch {
    return err(storeError);
  }
}

export function createOrderChatStore(sql: Sql): OrderChatStore {
  return {
    list: async (input) => {
      if (!TELEGRAM_ID_PATTERN.test(input.telegramUserId)) {
        return err({ rejection: "CHAT_NOT_FOUND" });
      }
      const result = await call(
        sql,
        "select list_order_messages($1::bigint, $2::uuid, $3::bigint, $4::integer) as result",
        [input.telegramUserId, input.orderId, input.afterSeq, input.limit],
      );
      if (!result.ok) return result;
      if (result.value.ok !== true) return err(rejectionFrom(result.value));
      const thread = readChatThread(result.value);
      return thread === null ? err(malformed) : ok(thread);
    },

    post: async (input) => {
      if (!TELEGRAM_ID_PATTERN.test(input.telegramUserId)) {
        return err({ rejection: "CHAT_NOT_FOUND" });
      }
      const result = await call(
        sql,
        "select post_order_message($1::bigint, $2::uuid, $3::uuid, $4::text) as result",
        [input.telegramUserId, input.orderId, input.clientMessageId, input.body],
      );
      if (!result.ok) return result;
      if (result.value.ok !== true) return err(rejectionFrom(result.value));
      const status = result.value.status;
      const message = readChatMessage(result.value.message);
      if ((status !== "added" && status !== "duplicate") || message === null) {
        return err(malformed);
      }
      return ok({ status, message });
    },

    markRead: async (input) => {
      if (!TELEGRAM_ID_PATTERN.test(input.telegramUserId)) {
        return err({ rejection: "CHAT_NOT_FOUND" });
      }
      const result = await call(
        sql,
        "select mark_order_messages_read($1::bigint, $2::uuid, $3::bigint) as result",
        [input.telegramUserId, input.orderId, input.seq],
      );
      if (!result.ok) return result;
      if (result.value.ok !== true) return err(rejectionFrom(result.value));
      return ok(undefined);
    },
  };
}
