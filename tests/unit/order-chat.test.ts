/**
 * الغرض: `WR-04` — حكمُ تطبيقِ محادثةِ الطلبِ ومساراتِها وقناتِها بلا قاعدة:
 *   الجلسةُ أوّلاً، والمُدخلُ يُرفَضُ برمزٍ، والمكرَّرُ لا يُبَثّ، والنصُّ لا يُسجَّل.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { createOrderChatRoutes } from "../../apps/gateway/src/routes/order-chat.ts";
import type { MiniAppSessionReader } from "../../packages/application/identity/ports.ts";
import {
  canJoinOrderChat,
  markOrderChatRead,
  type OrderChatDeps,
  type OrderChatMessage,
  type OrderChatSignal,
  type OrderChatStore,
  type OrderChatThread,
  postOrderChatMessage,
  readAfterSeq,
  readOrderChat,
} from "../../packages/application/messaging/order-chat.ts";
import { readChatThread } from "../../packages/infrastructure/messaging/order-chat-store.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const ORDER = "a1b2c3d4-e5f6-4890-abcd-ef1234567890";
const CLIENT = "11111111-2222-4333-8444-555555555555";

const message: OrderChatMessage = {
  id: "m1",
  seq: 7,
  senderRole: "rider",
  mine: true,
  clientMessageId: CLIENT,
  body: "أنا عند البوابة",
  createdAt: "2026-10-12T10:00:00.000Z",
};

const thread: OrderChatThread = {
  orderId: ORDER,
  service: "transport",
  status: "matched",
  writable: true,
  myRole: "rider",
  counterpart: { role: "driver", firstName: "خالد" },
  messages: [message],
  lastSeq: 7,
  myLastReadSeq: 7,
  counterpartLastReadSeq: 0,
  unread: 0,
};

const sessions = {
  read: async (token: string) =>
    token === "good"
      ? ok({
          telegramUserId: "777000555",
          bot: "rider",
          sessionId: "s1",
          issuedAtSeconds: 0,
          expiresAtSeconds: 9_999_999_999,
        })
      : err({ code: "SESSION_REJECTED", reason: token === "old" ? "EXPIRED" : "BAD_SIGNATURE" }),
} as unknown as MiniAppSessionReader;

interface Harness {
  readonly deps: OrderChatDeps;
  readonly calls: string[];
  readonly signals: OrderChatSignal[];
  readonly logs: { event: string; meta: Record<string, unknown> }[];
}

function harness(store: Partial<OrderChatStore> = {}): Harness {
  const calls: string[] = [];
  const signals: OrderChatSignal[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const full: OrderChatStore = {
    list: async (input) => {
      calls.push(`list:${input.telegramUserId}:${input.afterSeq}`);
      return ok(thread);
    },
    post: async (input) => {
      calls.push(`post:${input.telegramUserId}:${input.clientMessageId}`);
      return ok({ status: "added", message });
    },
    markRead: async (input) => {
      calls.push(`read:${input.seq}`);
      return ok(undefined);
    },
    ...store,
  };
  return {
    calls,
    signals,
    logs,
    deps: {
      sessions,
      store: full,
      now: () => new Date("2026-10-12T10:00:00Z"),
      onPosted: (s) => signals.push(s),
      log: (event, meta) => logs.push({ event, meta }),
    },
  };
}

describe("WR-04 — تطبيقُ محادثةِ الطلب", () => {
  it("بلا جلسةٍ أو بجلسةٍ منتهيةٍ لا يُسأَلُ المخزن", async () => {
    const h = harness();
    const none = await readOrderChat(h.deps, {
      accessToken: undefined,
      orderId: ORDER,
      afterSeq: 0,
    });
    const old = await readOrderChat(h.deps, { accessToken: "old", orderId: ORDER, afterSeq: 0 });
    const bad = await readOrderChat(h.deps, { accessToken: "bad", orderId: ORDER, afterSeq: 0 });
    expect(none.ok ? null : none.error).toBe("SESSION_REQUIRED");
    expect(old.ok ? null : old.error).toBe("SESSION_EXPIRED");
    expect(bad.ok ? null : bad.error).toBe("SESSION_INVALID");
    expect(h.calls).toHaveLength(0);
  });

  it("المعرّفُ يُقرأُ من الجلسةِ وحدَها، والطلبُ الغريبُ يُرفَضُ قبلَ المخزن", async () => {
    const h = harness();
    const bad = await readOrderChat(h.deps, {
      accessToken: "good",
      orderId: "1;drop",
      afterSeq: 0,
    });
    expect(bad.ok ? null : bad.error).toBe("ORDER_ID_INVALID");
    const neg = await readOrderChat(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      afterSeq: "-1",
    });
    expect(neg.ok ? null : neg.error).toBe("MALFORMED");
    const good = await readOrderChat(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      afterSeq: "5",
    });
    expect(good.ok).toBe(true);
    expect(h.calls).toEqual(["list:777000555:5"]);
  });

  it("readAfterSeq: الغيابُ صفرٌ، والكسرُ والسالبُ والنصُّ أخطاء", () => {
    expect(readAfterSeq(undefined)).toBe(0);
    expect(readAfterSeq("12")).toBe(12);
    expect(readAfterSeq("1.5")).toBeNull();
    expect(readAfterSeq("abc")).toBeNull();
    expect(readAfterSeq(-3)).toBeNull();
  });

  it("الإرسالُ يتحقّقُ من المعرّفِ والنصِّ قبلَ المخزن", async () => {
    const h = harness();
    const cases: [unknown, string][] = [
      [null, "MALFORMED"],
      [{ text: "x" }, "CLIENT_ID_INVALID"],
      [{ clientMessageId: CLIENT, text: "   " }, "MESSAGE_EMPTY"],
      [{ clientMessageId: CLIENT, text: "x".repeat(1001) }, "MESSAGE_TOO_LONG"],
    ];
    for (const [body, code] of cases) {
      const r = await postOrderChatMessage(h.deps, { accessToken: "good", orderId: ORDER, body });
      expect(r.ok ? null : (r.error as string)).toBe(code);
    }
    expect(h.calls).toHaveLength(0);
  });

  it("الرسالةُ الجديدةُ تُبَثُّ إشارةً، والسجلُّ بلا نصٍّ ولا معرّفِ تيليجرام", async () => {
    const h = harness();
    const r = await postOrderChatMessage(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { clientMessageId: CLIENT, text: "أنا عند البوابة" },
    });
    expect(r.ok).toBe(true);
    expect(h.signals).toEqual([{ orderId: ORDER, lastSeq: 7 }]);
    const serialized = JSON.stringify(h.logs);
    expect(serialized).not.toContain("البوابة");
    expect(serialized).not.toContain("777000555");
  });

  it("المكرَّرةُ لا تُبَثُّ مرّةً ثانية", async () => {
    const h = harness({ post: async () => ok({ status: "duplicate", message }) });
    await postOrderChatMessage(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { clientMessageId: CLIENT, text: "مكرّرة" },
    });
    expect(h.signals).toHaveLength(0);
  });

  it("رفضُ المخزنِ يُنقَلُ برمزِه، وعطلُه رمزٌ واحدٌ لا تفصيل", async () => {
    const closed = harness({ post: async () => err({ rejection: "CHAT_CLOSED" }) });
    const r1 = await postOrderChatMessage(closed.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { clientMessageId: CLIENT, text: "x" },
    });
    expect(r1.ok ? null : r1.error).toBe("CHAT_CLOSED");
    const broken = harness({ list: async () => err({ reason: "STORE_ERROR" }) });
    const r2 = await readOrderChat(broken.deps, {
      accessToken: "good",
      orderId: ORDER,
      afterSeq: 0,
    });
    expect(r2.ok ? null : r2.error).toBe("CHAT_STORE_NOT_AVAILABLE");
    expect(broken.logs.map((l) => l.event)).toEqual(["order_chat.store_failed"]);
  });

  it("تقديمُ القراءةِ يرفضُ التسلسلَ الغريب", async () => {
    const h = harness();
    const bad = await markOrderChatRead(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { seq: "x" },
    });
    expect(bad.ok ? null : bad.error).toBe("MALFORMED");
    const good = await markOrderChatRead(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { seq: 7 },
    });
    expect(good.ok).toBe(true);
    expect(h.calls).toEqual(["read:7"]);
  });

  it("الانضمامُ إلى الغرفةِ يمرُّ بحكمِ المخزنِ نفسِه", async () => {
    const yes = harness();
    expect(await canJoinOrderChat(yes.deps, { telegramUserId: "1", orderId: ORDER })).toBe(ORDER);
    const no = harness({ list: async () => err({ rejection: "CHAT_NOT_FOUND" }) });
    expect(await canJoinOrderChat(no.deps, { telegramUserId: "1", orderId: ORDER })).toBeNull();
    expect(await canJoinOrderChat(yes.deps, { telegramUserId: "1", orderId: "x" })).toBeNull();
  });
});

describe("WR-04 — قراءةُ ردِّ القاعدة", () => {
  it("ردٌّ ناقصٌ لا يُخمَّن", () => {
    expect(readChatThread({ ok: true })).toBeNull();
    const parsed = readChatThread({
      ok: true,
      order: { id: ORDER, service: "delivery", status: "matched", writable: true },
      my_role: "driver",
      counterpart: { role: "rider", first_name: "مريم" },
      messages: [
        {
          id: "m",
          seq: 1,
          sender_role: "rider",
          mine: false,
          client_message_id: null,
          body: "هلا",
          created_at: "2026-10-12T10:00:00Z",
        },
      ],
      last_seq: 1,
      my_last_read_seq: 0,
      counterpart_last_read_seq: 1,
      unread: 1,
    });
    expect(parsed?.service).toBe("delivery");
    expect(parsed?.messages[0]?.body).toBe("هلا");
  });
});

describe("WR-04 — مساراتُ المحادثة", () => {
  it("بلا تركيبٍ تُجيبُ 503 لا 200", async () => {
    const app = createOrderChatRoutes({});
    const res = await app.request(`/v1/orders/${ORDER}/chat`);
    expect(res.status).toBe(503);
  });

  it("الرموزُ تُترجَمُ إلى حالاتِ HTTP الصحيحة", async () => {
    const h = harness({ list: async () => err({ rejection: "CHAT_NOT_FOUND" }) });
    const app = createOrderChatRoutes({ chat: h.deps });
    expect((await app.request(`/v1/orders/${ORDER}/chat`)).status).toBe(401);
    const notFound = await app.request(`/v1/orders/${ORDER}/chat`, {
      headers: { authorization: "Bearer good" },
    });
    expect(notFound.status).toBe(404);
  });

  it("الإرسالُ الجديدُ 201 والمكرَّرُ 200، والجسمُ الضخمُ 413", async () => {
    const h = harness();
    const app = createOrderChatRoutes({ chat: h.deps });
    const res = await app.request(`/v1/orders/${ORDER}/chat/messages`, {
      method: "POST",
      headers: { authorization: "Bearer good", "content-type": "application/json" },
      body: JSON.stringify({ clientMessageId: CLIENT, text: "هلا" }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { message: { seq: number } };
    expect(json.message.seq).toBe(7);

    const dup = harness({ post: async () => ok({ status: "duplicate", message }) });
    const dupRes = await createOrderChatRoutes({ chat: dup.deps }).request(
      `/v1/orders/${ORDER}/chat/messages`,
      {
        method: "POST",
        headers: { authorization: "Bearer good" },
        body: JSON.stringify({ clientMessageId: CLIENT, text: "هلا" }),
      },
    );
    expect(dupRes.status).toBe(200);

    const huge = await app.request(`/v1/orders/${ORDER}/chat/messages`, {
      method: "POST",
      headers: { authorization: "Bearer good" },
      body: JSON.stringify({ clientMessageId: CLIENT, text: "x".repeat(5000) }),
    });
    expect(huge.status).toBe(413);
  });
});
