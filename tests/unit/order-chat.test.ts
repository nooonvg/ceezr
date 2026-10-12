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
  readChatLocation,
  readOrderChat,
  translateThread,
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

describe("WR-04 — رسالةُ الموقعِ في طبقةِ التطبيق", () => {
  it("النقطةُ السليمةُ تمرُّ إلى المخزنِ بنوعِها، ولا تُسجَّلُ الإحداثيّات", async () => {
    const posted: unknown[] = [];
    const h = harness({
      post: async (input) => {
        posted.push(input);
        return ok({ status: "added", message: { ...message, kind: "location" } });
      },
    });
    const result = await postOrderChatMessage(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { clientMessageId: CLIENT, kind: "location", location: { lat: 24.47, lng: 39.61 } },
    });
    expect(result.ok).toBe(true);
    expect(posted[0]).toMatchObject({
      kind: "location",
      location: { lat: 24.47, lng: 39.61, accuracyM: null, label: null },
    });
    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain("24.47");
    expect(logged).not.toContain("39.61");
  });

  it("الإحداثيّاتُ خارجَ النطاقِ أو بغيرِ نوعِها والنوعُ المجهولُ تُرفَضُ قبلَ المخزن", async () => {
    const h = harness();
    for (const location of [
      undefined,
      { lat: 91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: "1", lng: 1 },
      { lat: Number.NaN, lng: 1 },
      { lat: 1, lng: 1, label: 5 },
      { lat: 1, lng: 1, label: "x".repeat(121) },
    ]) {
      const r = await postOrderChatMessage(h.deps, {
        accessToken: "good",
        orderId: ORDER,
        body: { clientMessageId: CLIENT, kind: "location", location },
      });
      expect(r.ok ? null : r.error).toBe("LOCATION_INVALID");
    }
    const image = await postOrderChatMessage(h.deps, {
      accessToken: "good",
      orderId: ORDER,
      body: { clientMessageId: CLIENT, kind: "image" },
    });
    expect(image.ok ? null : image.error).toBe("MESSAGE_KIND_INVALID");
    expect(h.calls.filter((c) => c.startsWith("post:"))).toHaveLength(0);
  });

  it("الدقّةُ السالبةُ أو الهائلةُ تُهمَلُ ولا تُسقِطُ النقطة", () => {
    expect(readChatLocation({ lat: 1, lng: 2, accuracyM: -3 })?.accuracyM).toBeNull();
    expect(readChatLocation({ lat: 1, lng: 2, accuracyM: 1e9 })?.accuracyM).toBeNull();
    expect(readChatLocation({ lat: 1, lng: 2, accuracyM: 8 })?.accuracyM).toBe(8);
  });

  it("المسارُ يُجيبُ 422 لموقعٍ غيرِ سليم", async () => {
    const h = harness();
    const app = createOrderChatRoutes({ chat: h.deps });
    const res = await app.request(`/v1/orders/${ORDER}/chat/messages`, {
      method: "POST",
      headers: { authorization: "Bearer good", "content-type": "application/json" },
      body: JSON.stringify({ clientMessageId: CLIENT, kind: "location", location: { lat: 99 } }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("LOCATION_INVALID");
  });
});

describe("WR-04 — ترجمةُ محادثةِ Mini App", () => {
  const theirs = (id: string, body: string, kind: "text" | "location" = "text") => ({
    ...message,
    id,
    mine: false,
    senderRole: "driver" as const,
    clientMessageId: null,
    body,
    kind,
  });
  const bilingual: OrderChatThread = {
    ...thread,
    myLanguage: "ar",
    counterpart: { role: "driver", firstName: "Imran", language: "ur" },
    messages: [
      message,
      theirs("t1", "میں دروازے پر ہوں"),
      {
        ...theirs("t2", "21.4,39.1", "location"),
        location: { lat: 21.4, lng: 39.1, accuracyM: null, label: null },
      },
    ],
  };

  it("رسالةُ الطرفِ الآخرِ النصّيّةُ تُترجَمُ إلى لغةِ القارئ ويبقى الأصل", async () => {
    const asked: string[] = [];
    const out = await translateThread(
      {
        translate: async ({ text, from, to }) => {
          asked.push(`${from}>${to}:${text}`);
          return "أنا عند الباب";
        },
      },
      bilingual,
    );
    expect(asked).toEqual(["ur>ar:میں دروازے پر ہوں"]);
    const translated = out.messages.find((m) => m.id === "t1");
    expect(translated?.body).toBe("میں دروازے پر ہوں");
    expect(translated?.translation).toEqual({ text: "أنا عند الباب", from: "ur", to: "ar" });
    // رسالةُ القارئِ نفسِه ورسالةُ الموقعِ لا تُترجَمان.
    expect(out.messages.find((m) => m.id === "m1")?.translation).toBeUndefined();
    expect(out.messages.find((m) => m.id === "t2")?.translation).toBeUndefined();
  });

  it("الاتّجاهُ المعاكس: رسالةُ الراكبِ العربيّةُ تُترجَمُ للسائقِ بالإنجليزيّة", async () => {
    const asked: string[] = [];
    const driverView: OrderChatThread = {
      ...thread,
      myRole: "driver",
      myLanguage: "en-GB",
      counterpart: { role: "rider", firstName: "مريم", language: "ar" },
      messages: [{ ...theirs("r1", "أنا عند البوابة"), senderRole: "rider" }],
    };
    const out = await translateThread(
      {
        translate: async ({ from, to }) => {
          asked.push(`${from}>${to}`);
          return "I am at the gate";
        },
      },
      driverView,
    );
    expect(asked).toEqual(["ar>en"]);
    expect(out.messages[0]?.translation?.text).toBe("I am at the gate");
  });

  it("فشلُ المزوّدِ لا يحجبُ المحادثة: الأصلُ يُعرَضُ ويُسجَّلُ الفشلُ بلا نصّ", async () => {
    const logs: { event: string; meta: Record<string, unknown> }[] = [];
    const out = await translateThread(
      {
        translate: async () => {
          throw new Error("timeout");
        },
        log: (event, meta) => logs.push({ event, meta }),
      },
      bilingual,
    );
    expect(out.messages.find((m) => m.id === "t1")?.translation).toBeNull();
    expect(out.messages.find((m) => m.id === "t1")?.body).toBe("میں دروازے پر ہوں");
    expect(logs.map((l) => l.event)).toEqual(["order_chat.translation_failed"]);
    expect(JSON.stringify(logs)).not.toContain("دروازے");
  });

  it("لغةٌ واحدةٌ أو لغةٌ مجهولةٌ أو بلا مزوّد: لا نداءَ للمزوّد", async () => {
    let calls = 0;
    const translate = async () => {
      calls += 1;
      return "x";
    };
    await translateThread({ translate }, { ...bilingual, myLanguage: "ur" });
    await translateThread({ translate }, { ...bilingual, myLanguage: "fr" });
    await translateThread({ translate }, { ...bilingual, myLanguage: null });
    const none = await translateThread({}, bilingual);
    expect(calls).toBe(0);
    expect(none).toBe(bilingual);
  });

  it("المزوّدُ الذي يعيدُ النصَّ نفسَه أو لا شيءَ لا يُعَدُّ ترجمة", async () => {
    const same = await translateThread({ translate: async ({ text }) => text }, bilingual);
    const empty = await translateThread({ translate: async () => null }, bilingual);
    expect(same.messages.find((m) => m.id === "t1")?.translation).toBeNull();
    expect(empty.messages.find((m) => m.id === "t1")?.translation).toBeNull();
  });

  it("قراءةُ السجلِّ تُترجِمُ عبرَ التبعيّةِ وتُعيدُ الترجمةَ في ردِّ HTTP", async () => {
    const h = harness({ list: async () => ok(bilingual) });
    const deps = { ...h.deps, translate: async () => "أنا عند الباب" };
    const app = createOrderChatRoutes({ chat: deps });
    const res = await app.request(`/v1/orders/${ORDER}/chat?after=0`, {
      headers: { authorization: "Bearer good" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: {
        id: string;
        body: string;
        kind: string;
        translation: unknown;
        location: unknown;
      }[];
    };
    const t1 = body.messages.find((m) => m.id === "t1");
    expect(t1?.body).toBe("میں دروازے پر ہوں");
    expect(t1?.translation).toEqual({ text: "أنا عند الباب", from: "ur", to: "ar" });
    expect(body.messages.find((m) => m.id === "m1")?.kind).toBe("text");
    // رابطُ الخرائطِ يبنيه الخادمُ للموقعِ وحدَه؛ والمصغَّرُ لا يُركِّبُ عنوانًا.
    const t2 = body.messages.find((m) => m.id === "t2") as {
      location: { maps_url: string } | null;
    };
    expect(t2.location?.maps_url).toBe("https://maps.google.com/?q=21.4,39.1");
  });
});

describe("WR-04 — قراءةُ صفِّ المحادثةِ بنوعِه ولغتِه", () => {
  it("صفُّ الموقعِ يُقرأُ بحمولتِه، وصفُّ موقعٍ تالفٌ يرفضُ السجلَّ كلَّه", () => {
    const base = {
      ok: true,
      order: { id: ORDER, service: "transport", status: "matched", writable: true },
      my_role: "rider",
      my_language: "ar",
      counterpart: { role: "driver", first_name: "خالد", language: "en" },
      last_seq: 1,
      my_last_read_seq: 0,
      counterpart_last_read_seq: 0,
      unread: 1,
    };
    const row = {
      id: "m1",
      seq: 1,
      sender_role: "driver",
      mine: false,
      body: "21.4,39.1",
      created_at: "2026-10-12T10:00:00Z",
      kind: "location",
      payload: { lat: 21.4, lng: 39.1, accuracy_m: null, label: null },
    };
    const good = readChatThread({ ...base, messages: [row] });
    expect(good?.messages[0]?.kind).toBe("location");
    expect(good?.messages[0]?.location).toEqual({
      lat: 21.4,
      lng: 39.1,
      accuracyM: null,
      label: null,
    });
    expect(good?.myLanguage).toBe("ar");
    expect(good?.counterpart.language).toBe("en");
    expect(
      readChatThread({ ...base, messages: [{ ...row, payload: { lat: 999, lng: 1 } }] }),
    ).toBeNull();
    expect(readChatThread({ ...base, messages: [{ ...row, kind: "video" }] })).toBeNull();
  });
});
