/**
 * الغرض: `WR-10` — إغلاقُ بطاقةِ القروبِ بعدَ انتهاءِ دورتِها: يُكتَبُ المآلُ ويُعلَّمُ مغلقًا،
 *   والخطأُ العابرُ يُعدُّ محاولةً بلا تعليم، والخطأُ النهائيُّ (لا يُعدَّل) يُعلَّمُ مغلقًا،
 *   ولا يرمي شيءٌ منها.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, test } from "bun:test";
import {
  closeStaleGroupCards,
  type GroupCardOutcome,
  isTerminalEditError,
  type StaleGroupCard,
} from "../../packages/application/dispatch/close-stale-group-cards.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const CITY = "c-1" as CityId;

function card(id: string, outcome: GroupCardOutcome = "closed"): StaleGroupCard {
  return { negotiationId: id, groupId: "-1003", messageId: `m-${id}`, outcome };
}

function setup(cards: readonly StaleGroupCard[], failWith: Record<string, string> = {}) {
  const closed: string[] = [];
  const attempts: string[] = [];
  const edits: { chatId: string; messageId: string; text: string }[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  let asked: { limit: number; maxAttempts: number } | null = null;
  const deps = {
    cards: {
      listStale: async (_city: CityId, limit: number, maxAttempts: number) => {
        asked = { limit, maxAttempts };
        return ok(cards);
      },
      markClosed: async (id: string) => {
        closed.push(id);
        return ok(undefined);
      },
      markAttemptFailed: async (id: string) => {
        attempts.push(id);
        return ok(undefined);
      },
    },
    edit: async (chatId: string, messageId: string, text: string) => {
      const id = messageId.slice(2);
      const failure = failWith[id];
      if (failure !== undefined) throw new Error(failure);
      edits.push({ chatId, messageId, text });
    },
    text: (outcome: GroupCardOutcome) => (outcome === "assigned" ? "أُسنِد" : "انتهت"),
    log: (event: string, meta: Record<string, unknown>) => logs.push({ event, meta }),
  };
  return { deps, closed, attempts, edits, logs, asked: () => asked };
}

describe("WR-10 — إغلاقُ بطاقةِ القروب", () => {
  test("يكتبُ المآلَ على البطاقةِ ثمَّ يعلّمُها مغلقة", async () => {
    const s = setup([card("a", "assigned"), card("b")]);
    const r = await closeStaleGroupCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 2, failed: 0 });
    expect(s.edits).toEqual([
      { chatId: "-1003", messageId: "m-a", text: "أُسنِد" },
      { chatId: "-1003", messageId: "m-b", text: "انتهت" },
    ]);
    expect(s.closed).toEqual(["a", "b"]);
    expect(s.asked()).toEqual({ limit: 20, maxAttempts: 5 });
    expect(s.logs.map((l) => l.event)).toEqual(["group_card.closed", "group_card.closed"]);
  });

  test("الخطأُ العابرُ محاولةٌ فاشلةٌ بلا تعليمٍ ولا إسقاطٍ للباقي", async () => {
    const s = setup([card("a"), card("b")], { a: "Too Many Requests: retry after 3" });
    const r = await closeStaleGroupCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 1, failed: 1 });
    expect(s.attempts).toEqual(["a"]);
    expect(s.closed).toEqual(["b"]);
    expect(s.logs[0]?.event).toBe("group_card.close_failed");
  });

  test("الرسالةُ التي لا تُعدَّلُ تُعلَّمُ مغلقةً ولا تُعادُ أبدًا", async () => {
    const s = setup([card("a")], { a: "Bad Request: message to edit not found" });
    const r = await closeStaleGroupCards(CITY, s.deps);
    expect(r.ok && r.value).toEqual({ closed: 1, failed: 0 });
    expect(s.closed).toEqual(["a"]);
    expect(s.logs[0]?.meta.terminal_error).toBe("TELEGRAM_TERMINAL");
  });

  test("تعذُّرُ القراءةِ يعودُ خطأً لا استثناءً", async () => {
    const s = setup([]);
    const r = await closeStaleGroupCards(CITY, {
      ...s.deps,
      cards: { ...s.deps.cards, listStale: async () => err(new PortFailureError("db", "down")) },
    });
    expect(r.ok).toBe(false);
  });

  test("تصنيفُ أخطاءِ Telegram النهائيّة", () => {
    expect(isTerminalEditError("Bad Request: message is not modified")).toBe(true);
    expect(isTerminalEditError("Bad Request: MESSAGE CAN'T BE EDITED")).toBe(true);
    expect(isTerminalEditError("Bad Request: chat not found")).toBe(true);
    expect(isTerminalEditError("Too Many Requests: retry after 3")).toBe(false);
    expect(isTerminalEditError("fetch failed")).toBe(false);
  });

  test("لا معرّفَ قروبٍ ولا رسالةٍ في السجلّ", async () => {
    const s = setup([card("a")]);
    await closeStaleGroupCards(CITY, s.deps);
    const dumped = JSON.stringify(s.logs);
    expect(dumped).not.toContain("-1003");
    expect(dumped).not.toContain("m-a");
  });
});
