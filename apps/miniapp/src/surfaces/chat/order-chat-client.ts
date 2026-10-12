/**
 * الغرض: `WR-04` — عميلُ محادثةِ الطلبِ في Mini App: يسترجعُ «ما بعدَ آخرِ
 *   تسلسلٍ»، ويُرسِلُ بمعرّفٍ ثابتٍ يمنعُ التكرارَ عندَ الإعادة، ويدمجُ بلا تكرار.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 * الحاكم: `docs/adr/0263-order-chat-in-miniapp.md`.
 *
 * ## الحقيقةُ في الخادم
 *
 * القناةُ الآنيّةُ إشارةٌ «جديدٌ في الغرفة» فقط؛ والرسائلُ تُقرأُ دائماً من
 * `GET /v1/orders/:id/chat?after=<seq>`. فالانقطاعُ لا يُفقِدُ شيئاً: العودةُ
 * تسترجعُ ما فاتَ بالتسلسل، والدمجُ بمعرّفِ الرسالةِ يمنعُ التكرار.
 *
 * ولا شيءَ يُحفَظُ في `localStorage` ولا `sessionStorage`: الخروجُ والعودةُ
 * يقرآنِ من الخادمِ نفسِه، فالسجلُّ لا يعيشُ في الجهاز.
 */

import { ApiError, ApiNetworkError, apiFetch } from "../../api/client.ts";

export type ChatRole = "rider" | "driver";

export interface ChatMessage {
  readonly id: string;
  readonly seq: number;
  readonly senderRole: ChatRole;
  readonly mine: boolean;
  readonly clientMessageId: string | null;
  readonly body: string;
  readonly createdAt: string;
}

export interface ChatSnapshot {
  readonly orderId: string;
  readonly service: "transport" | "delivery";
  readonly status: string;
  readonly writable: boolean;
  /** `WR-05` — سياسةُ المبلغِ ومبلغُه؛ `null` ⇒ لا يُعرَضُ سطرُ السعر. */
  readonly offerMode: "fixed" | "suggested" | "open" | null;
  readonly offerSar: number | null;
  readonly myRole: ChatRole;
  readonly counterpartFirstName: string | null;
  readonly messages: readonly ChatMessage[];
  readonly lastSeq: number;
  readonly myLastReadSeq: number;
  readonly counterpartLastReadSeq: number;
  readonly unread: number;
}

/** رسالةٌ أرسلَها المستخدمُ ولم يؤكِّدْها الخادمُ بعدُ — بمعرّفِها الثابت. */
export interface PendingMessage {
  readonly clientMessageId: string;
  readonly body: string;
  readonly state: "sending" | "failed";
}

interface WireMessage {
  readonly id: string;
  readonly seq: number;
  readonly sender_role: ChatRole;
  readonly mine: boolean;
  readonly client_message_id: string | null;
  readonly body: string;
  readonly created_at: string;
}

interface WireThread {
  readonly ok: true;
  readonly order: {
    readonly id: string;
    readonly service: "transport" | "delivery";
    readonly status: string;
    readonly writable: boolean;
    readonly offer_mode?: "fixed" | "suggested" | "open" | null;
    readonly offer_sar?: number | null;
  };
  readonly my_role: ChatRole;
  readonly counterpart: { readonly role: ChatRole; readonly first_name: string | null };
  readonly messages: readonly WireMessage[];
  readonly last_seq: number;
  readonly my_last_read_seq: number;
  readonly counterpart_last_read_seq: number;
  readonly unread: number;
}

export function fromWireMessage(m: WireMessage): ChatMessage {
  return {
    id: m.id,
    seq: m.seq,
    senderRole: m.sender_role,
    mine: m.mine,
    clientMessageId: m.client_message_id,
    body: m.body,
    createdAt: m.created_at,
  };
}

export interface ChatApi {
  readonly fetchAfter: (orderId: string, afterSeq: number) => Promise<WireThread>;
  readonly send: (
    orderId: string,
    clientMessageId: string,
    text: string,
  ) => Promise<{ readonly status: "added" | "duplicate"; readonly message: WireMessage }>;
  readonly markRead: (orderId: string, seq: number) => Promise<unknown>;
}

export const productionChatApi: ChatApi = {
  fetchAfter: (orderId, afterSeq) =>
    apiFetch<WireThread>(`/v1/orders/${orderId}/chat?after=${String(afterSeq)}`, {
      method: "GET",
    }),
  send: (orderId, clientMessageId, text) =>
    apiFetch(`/v1/orders/${orderId}/chat/messages`, {
      method: "POST",
      body: { clientMessageId, text },
    }),
  markRead: (orderId, seq) =>
    apiFetch(`/v1/orders/${orderId}/chat/read`, { method: "POST", body: { seq } }),
};

/**
 * دمجُ دفعةٍ جديدةٍ في القائمةِ القائمة — بمعرّفِ الرسالةِ لا بموضعِها،
 * فالإشارةُ المكرَّرةُ أو الاسترجاعُ المتداخلُ لا يُكرِّرانِ سطراً.
 */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): readonly ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map<string, ChatMessage>();
  for (const m of current) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** المُعلَّقةُ التي وصلَ تأكيدُها في القائمةِ تُسقَطُ — فلا تظهرُ الرسالةُ مرّتين. */
export function settlePending(
  pending: readonly PendingMessage[],
  messages: readonly ChatMessage[],
): readonly PendingMessage[] {
  const confirmed = new Set(
    messages.filter((m) => m.mine && m.clientMessageId !== null).map((m) => m.clientMessageId),
  );
  return pending.filter((p) => !confirmed.has(p.clientMessageId));
}

export function applyThread(previous: ChatSnapshot | null, wire: WireThread): ChatSnapshot {
  const incoming = wire.messages.map(fromWireMessage);
  const messages = mergeMessages(previous?.messages ?? [], incoming);
  return {
    orderId: wire.order.id,
    service: wire.order.service,
    status: wire.order.status,
    writable: wire.order.writable,
    offerMode: wire.order.offer_mode ?? null,
    offerSar: typeof wire.order.offer_sar === "number" ? wire.order.offer_sar : null,
    myRole: wire.my_role,
    counterpartFirstName: wire.counterpart.first_name,
    messages,
    lastSeq: Math.max(previous?.lastSeq ?? 0, wire.last_seq),
    myLastReadSeq: wire.my_last_read_seq,
    counterpartLastReadSeq: wire.counterpart_last_read_seq,
    unread: wire.unread,
  };
}

export type ChatFailure = "not_found" | "closed" | "session" | "network" | "rejected";

export function chatFailureOf(error: unknown): ChatFailure {
  if (error instanceof ApiNetworkError) return "network";
  if (error instanceof ApiError) {
    if (error.status === 401) return "session";
    if (error.status === 404) return "not_found";
    if (error.status === 409) return "closed";
    if (error.status >= 500) return "network";
    return "rejected";
  }
  return "network";
}

/**
 * معرّفُ عميلٍ لكلِّ رسالةٍ — يُولَّدُ مرّةً ويُعادُ استعمالُه في كلِّ إعادة. وهوَ
 * **مفتاحُ لاتكرارٍ** كـ`newIdempotencyKey` في `search-view.ts` (`ADR 0043` يُجيزُه
 * للعميلِ)، لا معرّفُ طلبٍ: ذاكَ يولّدُه الخادمُ وحدَه.
 */
export function newClientMessageId(): string {
  const source = globalThis.crypto;
  return source.randomUUID();
}
