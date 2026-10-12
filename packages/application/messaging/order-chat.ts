/**
 * الغرض: `WR-04` — محادثةُ طرفَي الطلبِ داخلَ Mini App: قراءةُ الغرفةِ، وإرسالُ
 *   رسالةٍ بمعرّفٍ يمنعُ التكرار، وتقديمُ موضعِ القراءة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/messaging
 * يُستخدم من: `apps/gateway/src/routes/order-chat.ts` و`apps/gateway/src/realtime/chat-channel.ts`.
 * الحاكم: `docs/adr/0263-order-chat-in-miniapp.md` · خارطةُ التنفيذ §4.
 *
 * ## الترتيب
 *
 * جلسةٌ موقَّعةٌ ⇐ معرّفُ الطلبِ ⇐ المُدخلُ ⇐ المخزنُ الذي يحكمُ **من هوَ الطرفُ**.
 * معرّفُ المستخدمِ لا يُقرأُ من المسارِ ولا من الجسمِ ألبتّةَ: من الرمزِ وحدَه.
 *
 * ## وما لا يفعلُه
 *
 *   ــ لا يُفرِّقُ بينَ «لا طلبَ» و«ليسَ طلبَكَ»: `CHAT_NOT_FOUND` واحدٌ.
 *   ــ لا يُسجِّلُ نصَّ الرسالةِ في أيِّ سجلٍّ.
 *   ــ لا يُرسِلُ رسالةَ بوتٍ لكلِّ رسالةِ محادثة (§4 البند ٩).
 *   ــ لا يعرفُ سعراً ولا دفعاً: الغرفةُ تواصلٌ لا وساطة.
 */

import { err, ok, type Result } from "../../shared/result/index.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";

/** حدُّ الرسالةِ — يُطابِقُ قيدَ `order_messages.body` حرفاً. */
export const ORDER_CHAT_MESSAGE_MAX = 1000;
/** أكبرُ دفعةِ قراءةٍ — تُطابِقُ حدَّ `list_order_messages`. */
export const ORDER_CHAT_PAGE_MAX = 200;

export const ORDER_CHAT_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "MALFORMED",
  "ORDER_ID_INVALID",
  "CLIENT_ID_INVALID",
  "CHAT_NOT_FOUND",
  "CHAT_CLOSED",
  "MESSAGE_EMPTY",
  "MESSAGE_TOO_LONG",
  "MESSAGE_KIND_INVALID",
  "LOCATION_INVALID",
  "CHAT_STORE_NOT_AVAILABLE",
] as const;

export type OrderChatPublicErrorCode = (typeof ORDER_CHAT_PUBLIC_ERROR_CODES)[number];

export type OrderChatRole = "rider" | "driver";

/** `WR-04` — نوعُ الرسالة. المرفقاتُ الثنائيّةُ غيرُ مقبولةٍ حتّى يُفتَحَ التخزينُ (`WR-21`). */
export type OrderChatMessageKind = "text" | "location";

/** نقطةٌ واحدةٌ أرسلَها المستخدمُ بفعلٍ صريح — ليسَت تتبّعًا مستمرًّا. */
export interface OrderChatLocation {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number | null;
  readonly label: string | null;
}

/**
 * ترجمةُ رسالةِ الطرفِ الآخرِ إلى لغةِ القارئ. النصُّ الأصليُّ يبقى في `body` كما كُتِب،
 * والترجمةُ إضافةٌ لا بديل. `null` ⇒ لا ترجمة (لغةٌ واحدة، أو مزوّدٌ غيرُ مضبوط، أو فشل).
 */
export interface OrderChatTranslation {
  readonly text: string;
  readonly from: string;
  readonly to: string;
}

export const ORDER_CHAT_LOCATION_LABEL_MAX = 120;

export interface OrderChatMessage {
  readonly id: string;
  readonly seq: number;
  readonly senderRole: OrderChatRole;
  readonly mine: boolean;
  /** يُعادُ لصاحبِ الرسالةِ وحدَه كي يُطابِقَ ما أرسلَه بما حُفِظ. */
  readonly clientMessageId: string | null;
  readonly body: string;
  readonly createdAt: string;
  /** غيابُه يعني `text` — رسائلُ أقدمُ من `20261013000500`. */
  readonly kind?: OrderChatMessageKind;
  readonly location?: OrderChatLocation | null;
  readonly translation?: OrderChatTranslation | null;
}

export interface OrderChatThread {
  readonly orderId: string;
  readonly service: "transport" | "delivery";
  readonly status: string;
  readonly writable: boolean;
  readonly myRole: OrderChatRole;
  readonly counterpart: {
    readonly role: OrderChatRole;
    readonly firstName: string | null;
    /** `users.language_code` للطرفِ الآخر — مصدرُ لغةِ الترجمة. */
    readonly language?: string | null;
  };
  /** `users.language_code` للقارئ — لغةُ الترجمة. */
  readonly myLanguage?: string | null;
  readonly messages: readonly OrderChatMessage[];
  readonly lastSeq: number;
  readonly myLastReadSeq: number;
  readonly counterpartLastReadSeq: number;
  readonly unread: number;
  /**
   * `WR-05` — سياسةُ المبلغِ ومبلغُه كما كتبَهما الراكب، تُقرأُ بعدَ أن حكمَت القاعدةُ بأنَّ
   * القارئَ طرفٌ في الطلب. `mode` `null` ⇒ طلبٌ أقدمُ من السياسة.
   */
  readonly offerTerms?: {
    readonly mode: "fixed" | "suggested" | "open" | null;
    readonly offerSar: number | null;
  };
}

export type OrderChatStoreRejection =
  | "CHAT_NOT_FOUND"
  | "CHAT_CLOSED"
  | "MESSAGE_EMPTY"
  | "MESSAGE_TOO_LONG"
  | "MESSAGE_KIND_INVALID"
  | "LOCATION_INVALID"
  | "CLIENT_ID_INVALID";

export type OrderChatStoreError =
  | { readonly rejection: OrderChatStoreRejection }
  | { readonly reason: "STORE_ERROR" | "MALFORMED_RESULT" };

export interface OrderChatStore {
  list(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
    readonly afterSeq: number;
    readonly limit: number;
  }): Promise<Result<OrderChatThread, OrderChatStoreError>>;
  post(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
    readonly clientMessageId: string;
    readonly body: string;
    /** غيابُهما ⇒ رسالةٌ نصّيّة. */
    readonly kind?: OrderChatMessageKind;
    readonly location?: OrderChatLocation;
  }): Promise<
    Result<
      { readonly status: "added" | "duplicate"; readonly message: OrderChatMessage },
      OrderChatStoreError
    >
  >;
  markRead(input: {
    readonly telegramUserId: string;
    readonly orderId: string;
    readonly seq: number;
  }): Promise<Result<void, OrderChatStoreError>>;
}

/** إشارةُ «جديدٌ في الغرفة» — بلا نصٍّ ولا مرسلٍ: العميلُ يسترجعُ من الخادم. */
export interface OrderChatSignal {
  readonly orderId: string;
  readonly lastSeq: number;
}

export interface OrderChatDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: OrderChatStore;
  readonly now: () => Date;
  /** يُنادى بعدَ حفظِ رسالةٍ جديدةٍ (لا المكرَّرة) — القناةُ الآنيّةُ تبثُّ الإشارة. */
  readonly onPosted?: (signal: OrderChatSignal) => void;
  readonly log?: (event: string, meta: Record<string, unknown>) => void;
  /**
   * `WR-04` — ترجمةُ نصِّ الطرفِ الآخرِ إلى لغةِ القارئ. غيابُه أو `null` ⇒ يُعرَضُ الأصلُ وحدَه.
   * لا يرمي: الفشلُ يُعادُ `null` فلا تُحجَبُ المحادثةُ بسببِ المزوّد.
   */
  readonly translate?: (input: {
    readonly text: string;
    readonly from: string;
    readonly to: string;
  }) => Promise<string | null>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function sessionErrorFrom(reason: string): OrderChatPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

async function identify(
  deps: OrderChatDeps,
  accessToken: string | undefined,
): Promise<Result<string, OrderChatPublicErrorCode>> {
  if (accessToken === undefined || accessToken.length === 0) return err("SESSION_REQUIRED");
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(sessionErrorFrom(session.error.reason));
  return ok(session.value.telegramUserId);
}

function publicCodeFrom(error: OrderChatStoreError): OrderChatPublicErrorCode {
  if ("rejection" in error) return error.rejection;
  return "CHAT_STORE_NOT_AVAILABLE";
}

/** «ما بعدَ تسلسلِ كذا» — عددٌ صحيحٌ غيرُ سالبٍ، وغيرُه خطأُ طلبٍ لا صفرٌ صامت. */
export function readAfterSeq(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/** قراءةُ الغرفةِ — `GET /v1/orders/:orderId/chat?after=<seq>`. */
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** فحصُ نقطةِ الموقعِ في البوّابةِ قبلَ القاعدة (والقاعدةُ تفحصُها ثانيةً). */
export function readChatLocation(value: unknown): OrderChatLocation | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const lat = finiteNumber(raw.lat);
  const lng = finiteNumber(raw.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const accuracy = finiteNumber(raw.accuracyM);
  let label: string | null = null;
  if (raw.label !== undefined && raw.label !== null) {
    if (typeof raw.label !== "string") return null;
    const trimmed = raw.label.trim();
    if (trimmed.length > ORDER_CHAT_LOCATION_LABEL_MAX) return null;
    label = trimmed.length === 0 ? null : trimmed;
  }
  return {
    lat,
    lng,
    accuracyM: accuracy !== null && accuracy >= 0 && accuracy <= 100_000 ? accuracy : null,
    label,
  };
}

const TRANSLATABLE_LANGUAGES = new Set(["ar", "en", "ur"]);

function primaryLanguage(tag: string | null | undefined): string | null {
  if (typeof tag !== "string") return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return TRANSLATABLE_LANGUAGES.has(primary) ? primary : null;
}

/**
 * يُترجِمُ رسائلَ الطرفِ الآخرِ النصّيّةَ إلى لغةِ القارئ. رسائلُ القارئِ نفسِه ورسائلُ الموقعِ
 * لا تُترجَم. والفشلُ يتركُ الرسالةَ بأصلِها (`translation: null`) ولا يُسقِطُ القراءة.
 */
export async function translateThread(
  deps: Pick<OrderChatDeps, "translate" | "log">,
  thread: OrderChatThread,
): Promise<OrderChatThread> {
  const translate = deps.translate;
  const to = primaryLanguage(thread.myLanguage);
  const from = primaryLanguage(thread.counterpart.language);
  if (translate === undefined || to === null || from === null || to === from) return thread;
  let failed = 0;
  const messages = await Promise.all(
    thread.messages.map(async (message) => {
      if (message.mine || (message.kind ?? "text") !== "text") return message;
      try {
        const text = await translate({ text: message.body, from, to });
        if (text === null || text.trim().length === 0 || text.trim() === message.body.trim()) {
          return { ...message, translation: null };
        }
        return { ...message, translation: { text, from, to } };
      } catch {
        failed += 1;
        return { ...message, translation: null };
      }
    }),
  );
  if (failed > 0) deps.log?.("order_chat.translation_failed", { order_id: thread.orderId, failed });
  return { ...thread, messages };
}

export async function readOrderChat(
  deps: OrderChatDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: unknown;
    readonly afterSeq: unknown;
  },
): Promise<Result<OrderChatThread, OrderChatPublicErrorCode>> {
  const identified = await identify(deps, input.accessToken);
  if (!identified.ok) return identified;
  const orderId = readUuid(input.orderId);
  if (orderId === null) return err("ORDER_ID_INVALID");
  const afterSeq = readAfterSeq(input.afterSeq);
  if (afterSeq === null) return err("MALFORMED");

  const result = await deps.store.list({
    telegramUserId: identified.value,
    orderId,
    afterSeq,
    limit: ORDER_CHAT_PAGE_MAX,
  });
  if (!result.ok) {
    if ("reason" in result.error) deps.log?.("order_chat.store_failed", { op: "list" });
    return err(publicCodeFrom(result.error));
  }
  return ok(await translateThread(deps, result.value));
}

/** إرسالُ رسالةٍ — `POST /v1/orders/:orderId/chat/messages`. */
export async function postOrderChatMessage(
  deps: OrderChatDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: unknown;
    readonly body: unknown;
  },
): Promise<
  Result<
    { readonly status: "added" | "duplicate"; readonly message: OrderChatMessage },
    OrderChatPublicErrorCode
  >
> {
  const identified = await identify(deps, input.accessToken);
  if (!identified.ok) return identified;
  const orderId = readUuid(input.orderId);
  if (orderId === null) return err("ORDER_ID_INVALID");

  if (typeof input.body !== "object" || input.body === null || Array.isArray(input.body)) {
    return err("MALFORMED");
  }
  const body = input.body as Record<string, unknown>;
  const clientMessageId = readUuid(body.clientMessageId);
  if (clientMessageId === null) return err("CLIENT_ID_INVALID");
  const kind = body.kind === undefined ? "text" : body.kind;
  if (kind !== "text" && kind !== "location") return err("MESSAGE_KIND_INVALID");

  let postInput: Parameters<OrderChatStore["post"]>[0];
  if (kind === "location") {
    const location = readChatLocation(body.location);
    if (location === null) return err("LOCATION_INVALID");
    postInput = {
      telegramUserId: identified.value,
      orderId,
      clientMessageId,
      body: location.label ?? `${location.lat},${location.lng}`,
      kind,
      location,
    };
  } else {
    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return err("MESSAGE_EMPTY");
    }
    if (body.text.length > ORDER_CHAT_MESSAGE_MAX) return err("MESSAGE_TOO_LONG");
    postInput = { telegramUserId: identified.value, orderId, clientMessageId, body: body.text };
  }

  const result = await deps.store.post(postInput);
  if (!result.ok) {
    if ("reason" in result.error) deps.log?.("order_chat.store_failed", { op: "post" });
    return err(publicCodeFrom(result.error));
  }
  // السجلُّ يقولُ «حُفِظَت رسالةٌ في طلبِ كذا» — لا نصَّها ولا مرسلَها.
  deps.log?.("order_chat.message_saved", {
    order_id: orderId,
    kind,
    status: result.value.status,
    seq: result.value.message.seq,
  });
  if (result.value.status === "added") {
    deps.onPosted?.({ orderId, lastSeq: result.value.message.seq });
  }
  return ok(result.value);
}

/** تقديمُ موضعِ القراءةِ — `POST /v1/orders/:orderId/chat/read`. */
export async function markOrderChatRead(
  deps: OrderChatDeps,
  input: {
    readonly accessToken: string | undefined;
    readonly orderId: unknown;
    readonly body: unknown;
  },
): Promise<Result<void, OrderChatPublicErrorCode>> {
  const identified = await identify(deps, input.accessToken);
  if (!identified.ok) return identified;
  const orderId = readUuid(input.orderId);
  if (orderId === null) return err("ORDER_ID_INVALID");
  if (typeof input.body !== "object" || input.body === null || Array.isArray(input.body)) {
    return err("MALFORMED");
  }
  const seq = readAfterSeq((input.body as Record<string, unknown>).seq);
  if (seq === null) return err("MALFORMED");

  const result = await deps.store.markRead({ telegramUserId: identified.value, orderId, seq });
  if (!result.ok) {
    if ("reason" in result.error) deps.log?.("order_chat.store_failed", { op: "read" });
    return err(publicCodeFrom(result.error));
  }
  return ok(undefined);
}

/**
 * هل هذا المستخدمُ طرفٌ في غرفةِ هذا الطلبِ؟ — القناةُ الآنيّةُ تسألُه قبلَ ضمِّ
 * المقبسِ إلى الغرفة، بالحكمِ نفسِه الذي يقرأُ به مسارُ HTTP.
 */
export async function canJoinOrderChat(
  deps: Pick<OrderChatDeps, "store">,
  input: { readonly telegramUserId: string; readonly orderId: unknown },
): Promise<string | null> {
  const orderId = readUuid(input.orderId);
  if (orderId === null) return null;
  const result = await deps.store.list({
    telegramUserId: input.telegramUserId,
    orderId,
    afterSeq: Number.MAX_SAFE_INTEGER,
    limit: 1,
  });
  return result.ok ? orderId : null;
}
