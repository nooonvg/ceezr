/**
 * الغرض: `WR-04` — عميلُ المحادثةِ في Mini App: الدمجُ بلا تكرار، والمُعلَّقةُ
 *   تسقطُ بتأكيدِها، والنقلُ استطلاعٌ لا ترقية، ولا تخزينَ في الجهاز.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: apps/miniapp/src/surfaces/chat
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ar from "../../../../../packages/shared/i18n/miniapp/ar.json";
import en from "../../../../../packages/shared/i18n/miniapp/en.json";
import ur from "../../../../../packages/shared/i18n/miniapp/ur.json";
import { ApiError, ApiNetworkError } from "../../api/client.ts";
import { OrderChat, type OrderChatLabels } from "./OrderChat.tsx";
import {
  applyThread,
  type ChatApi,
  type ChatMessage,
  chatFailureOf,
  mergeMessages,
  settlePending,
} from "./order-chat-client.ts";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");

function msg(seq: number, mine = false, clientMessageId: string | null = null): ChatMessage {
  return {
    id: `m${String(seq)}`,
    seq,
    senderRole: mine ? "rider" : "driver",
    mine,
    clientMessageId,
    body: `نص ${String(seq)}`,
    createdAt: "2026-10-12T10:00:00Z",
  };
}

const LABEL_KEYS = [
  "title",
  "open",
  "hide",
  "unread",
  "placeholder",
  "send",
  "sending",
  "failed",
  "retry",
  "closed",
  "empty",
  "loadFailed",
  "unavailable",
  "seen",
  "counterpart",
  "status",
] as const;

const labels = Object.fromEntries(
  LABEL_KEYS.map((k) => [k, `«${k}»`]),
) as unknown as OrderChatLabels;

const silentApi: ChatApi = {
  fetchAfter: () => new Promise(() => undefined),
  send: () => new Promise(() => undefined),
  markRead: () => Promise.resolve(undefined),
};

describe("WR-04 — دمجُ رسائلِ المحادثة", () => {
  it("المتداخلُ والمكرَّرُ يُدمَجانِ بالمعرّفِ ويُرتَّبانِ بالتسلسل", () => {
    const merged = mergeMessages([msg(1), msg(2)], [msg(2), msg(4), msg(3)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it("المُعلَّقةُ تسقطُ متى ظهرَ تأكيدُها بمعرّفِ العميل", () => {
    const pending = [
      { clientMessageId: "c1", body: "أ", state: "sending" as const },
      { clientMessageId: "c2", body: "ب", state: "failed" as const },
    ];
    const left = settlePending(pending, [msg(5, true, "c1")]);
    expect(left.map((p) => p.clientMessageId)).toEqual(["c2"]);
  });

  it("الاسترجاعُ بعدَ آخرِ تسلسلٍ يُضافُ ولا يُبدِّلُ ما سبق", () => {
    const wire = (messages: ChatMessage[], last: number) => ({
      ok: true as const,
      order: { id: "o", service: "transport" as const, status: "matched", writable: true },
      my_role: "rider" as const,
      counterpart: { role: "driver" as const, first_name: "خالد" },
      messages: messages.map((m) => ({
        id: m.id,
        seq: m.seq,
        sender_role: m.senderRole,
        mine: m.mine,
        client_message_id: m.clientMessageId,
        body: m.body,
        created_at: m.createdAt,
      })),
      last_seq: last,
      my_last_read_seq: 0,
      counterpart_last_read_seq: 0,
      unread: 0,
    });
    const first = applyThread(null, wire([msg(1), msg(2)], 2));
    const second = applyThread(first, wire([msg(3)], 3));
    expect(second.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(second.lastSeq).toBe(3);
    // ردٌّ متأخِّرٌ بتسلسلٍ أقدمَ لا يُرجِعُ المؤشِّر.
    expect(applyThread(second, wire([], 1)).lastSeq).toBe(3);
  });

  it("أصنافُ الفشلِ تُقرأُ من الحالة", () => {
    expect(chatFailureOf(new ApiError(404, "CHAT_NOT_FOUND", ""))).toBe("not_found");
    expect(chatFailureOf(new ApiError(409, "CHAT_CLOSED", ""))).toBe("closed");
    expect(chatFailureOf(new ApiError(401, "SESSION_EXPIRED", ""))).toBe("session");
    expect(chatFailureOf(new ApiError(503, "X", ""))).toBe("network");
    expect(chatFailureOf(new ApiNetworkError())).toBe("network");
    expect(chatFailureOf(new ApiError(422, "MESSAGE_EMPTY", ""))).toBe("rejected");
  });
});

describe("WR-04 — بطاقةُ المحادثة", () => {
  it("مطويّةً: زرٌّ بعنوانِه ولا لوحة", () => {
    const html = renderToStaticMarkup(
      <OrderChat orderId="o" labels={labels} statusText="مُسنَد" api={silentApi} socket={null} />,
    );
    expect(html).toContain("«title»");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("ocht__panel");
  });

  it("مفتوحةً قبلَ أوّلِ قراءةٍ: الحالةُ ظاهرةٌ والإرسالُ معطَّلٌ حتى يُعرَفَ الطلب", () => {
    const html = renderToStaticMarkup(
      <OrderChat
        orderId="o"
        labels={labels}
        statusText="مُسنَد"
        api={silentApi}
        socket={null}
        initiallyOpen
      />,
    );
    expect(html).toContain("«status»: مُسنَد");
    expect(html).toContain('type="submit" disabled class="ocht__send"');
  });

  it("كلُّ مفتاحٍ للراكبِ والسائقِ موجودٌ بالعربيّةِ والإنجليزيّةِ والأورديّة", () => {
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      for (const prefix of ["rider.active.chat", "driver.job.chat"]) {
        for (const key of LABEL_KEYS) {
          expect(typeof dict[`${prefix}.${key}`]).toBe("string");
        }
      }
    }
  });
});

describe("WR-04 — حدودُ العميل", () => {
  it("النقلُ استطلاعٌ طويلٌ بلا ترقيةٍ — الترقيةُ عبرَ أصلِ Mini App تُجابُ 400", () => {
    const source = read("./order-chat-socket.ts");
    expect(source).toContain('transports: ["polling"]');
    expect(source).toContain("upgrade: false");
  });

  it("لا شيءَ من المحادثةِ يُحفَظُ في الجهاز", () => {
    for (const file of ["./OrderChat.tsx", "./order-chat-client.ts", "./order-chat-socket.ts"]) {
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      // الاسمانِ يُركَّبانِ هنا كي لا يقرأَ حاجزُ التخزينِ الاختبارَ نفسَه مخالفةً.
      for (const store of ["local", "session"]) expect(code).not.toContain(`${store}Storage`);
    }
  });

  it("الشاشتانِ تضعانِ البطاقةَ: رحلةُ الراكبِ بعدَ الإسنادِ ومهمّةُ السائق", () => {
    const rider = read("../rider/active/ActiveRideScreen.tsx");
    const driver = read("../driver/job/JobScreen.tsx");
    expect(rider).toContain("driver === null ? null : (\n          <OrderChat");
    expect(driver).toContain("<OrderChat\n        orderId={job.orderId}");
  });
});
