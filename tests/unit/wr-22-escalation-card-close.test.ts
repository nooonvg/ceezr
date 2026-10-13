/**
 * الغرض: `WR-22` (ADR 0278) — حالةُ استخدامِ إغلاقِ بطاقةِ الإسنادِ بلا قاعدة: المآلُ من الطور،
 *   ونصُّ كلِّ مآلٍ في اللغاتِ الثلاثِ يحملُ معرّفَ الطلب، والفشلُ العابرُ يُعدُّ ولا يُسقطُ الباقي،
 *   والخطأُ النهائيُّ يُغلِق، والسَّبْقُ لا يُعدُّ إغلاقًا، والسجلُّ بلا نصٍّ ولا قروب.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  type CloseEscalationCardsDependencies,
  closeEscalationCards,
  type EscalationCardOutcome,
  type StaleEscalationCard,
} from "../../packages/application/dispatch/close-escalation-cards.ts";
import {
  ESCALATION_CARD_FINAL_STATUSES,
  escalationCardOutcome,
} from "../../packages/infrastructure/dispatch/escalation-card-adapters.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY = "11111111-1111-4111-8111-111111111111" as CityId;

function card(n: number, outcome: EscalationCardOutcome = "search_expired"): StaleEscalationCard {
  return {
    auditId: `a${n}`,
    orderId: `4d67e20f-e49c-4d0e-acf5-00000000000${n}`,
    groupId: "-1001234567890",
    messageId: String(9000 + n),
    outcome,
  };
}

function harness(
  cards: StaleEscalationCard[],
  opts: { fail?: (m: string) => Error | null; raced?: Set<string>; markFails?: boolean } = {},
) {
  const edits: string[] = [];
  const closed: string[] = [];
  const attempts: string[] = [];
  const logs: { event: string; meta: Record<string, unknown> }[] = [];
  const deps: CloseEscalationCardsDependencies = {
    cards: {
      listStale: async () => ok(cards),
      markClosed: async (c) => {
        if (opts.markFails === true) {
          return { ok: false, error: { code: "PORT_FAILURE", detail: "x" } } as never;
        }
        if (opts.raced?.has(c.auditId) === true) return ok(false);
        closed.push(c.auditId);
        return ok(true);
      },
      markAttemptFailed: async (c) => {
        attempts.push(c.auditId);
        return ok(undefined);
      },
    },
    edit: async (_chat, message, text) => {
      const e = opts.fail?.(message) ?? null;
      if (e !== null) throw e;
      edits.push(`${message}|${text}`);
    },
    text: (outcome, orderId) =>
      translate("ar", `group.escalation_card_${outcome}`, { order: orderId }),
    log: (event, meta) => logs.push({ event, meta }),
  };
  return { deps, edits, closed, attempts, logs };
}

describe("WR-22 — مآلُ البطاقةِ من طورِ الطلب", () => {
  it("in_progress/completed ⇒ assigned، cancelled ⇒ cancelled، failed/search_expired ⇒ search_expired", () => {
    expect(escalationCardOutcome("in_progress", null)).toBe("assigned");
    expect(escalationCardOutcome("completed", null)).toBe("assigned");
    expect(escalationCardOutcome("cancelled", "rider_cancelled")).toBe("cancelled");
    expect(escalationCardOutcome("failed", "search_expired")).toBe("search_expired");
    expect(escalationCardOutcome("failed", null)).toBe("ended");
  });
  it("`matched` و`searching` و`scheduled` ليست حالاتٍ نهائيّة", () => {
    for (const s of ["matched", "searching", "scheduled"]) {
      expect((ESCALATION_CARD_FINAL_STATUSES as readonly string[]).includes(s)).toBe(false);
    }
  });
  it("لكلِّ مآلٍ نصٌّ في العربيّة والإنجليزيّة والأرديّة يحملُ معرّفَ الطلب", () => {
    for (const lang of ["ar", "en", "ur"]) {
      for (const o of ["assigned", "cancelled", "search_expired", "ended"]) {
        const text = translate(lang, `group.escalation_card_${o}`, { order: "ORDER-X" });
        expect(text).toContain("ORDER-X");
        expect(text).not.toContain(`group.escalation_card_${o}`);
      }
    }
  });
});

describe("WR-22 — closeEscalationCards", () => {
  it("يعدّلُ الرسالةَ نفسَها ثمّ يعلّمُها مغلقة", async () => {
    const h = harness([card(1)]);
    const out = await closeEscalationCards(CITY, h.deps);
    expect(out.ok && out.value).toEqual({ closed: 1, failed: 0, raced: 0 });
    expect(h.edits[0]).toStartWith("9001|⏹ انتهى البحث دون سائق");
    expect(h.closed).toEqual(["a1"]);
  });
  it("الفشلُ العابرُ يُعدُّ ويُكملُ الباقي", async () => {
    const h = harness([card(1), card(2)], {
      fail: (m) => (m === "9001" ? new Error("Too Many Requests") : null),
    });
    const out = await closeEscalationCards(CITY, h.deps);
    expect(out.ok && out.value).toEqual({ closed: 1, failed: 1, raced: 0 });
    expect(h.attempts).toEqual(["a1"]);
    expect(h.closed).toEqual(["a2"]);
  });
  it("الخطأُ النهائيُّ يُغلِقُ بلا إعادة", async () => {
    const h = harness([card(1)], { fail: () => new Error("Bad Request: message is not modified") });
    const out = await closeEscalationCards(CITY, h.deps);
    expect(out.ok && out.value.closed).toBe(1);
    expect(h.attempts).toEqual([]);
    expect(h.logs[0]?.meta.terminal_error).toBe("TELEGRAM_TERMINAL");
  });
  it("سَبَقَه عاملٌ آخر ⇒ raced لا closed", async () => {
    const h = harness([card(1)], { raced: new Set(["a1"]) });
    const out = await closeEscalationCards(CITY, h.deps);
    expect(out.ok && out.value).toEqual({ closed: 0, failed: 0, raced: 1 });
  });
  it("تعذّرُ التعليمِ بعدَ التعديل ⇒ failed، ويُعادُ لاحقًا فيُصادِفُ «not modified»", async () => {
    const h = harness([card(1)], { markFails: true });
    const out = await closeEscalationCards(CITY, h.deps);
    expect(out.ok && out.value.failed).toBe(1);
  });
  it("السجلُّ بلا معرّفِ قروبٍ ولا نصٍّ ولا رسالة", async () => {
    const h = harness([card(1), card(2)], {
      fail: (m) => (m === "9001" ? new Error("Bad Gateway -1001234567890") : null),
    });
    await closeEscalationCards(CITY, h.deps);
    const dump = JSON.stringify(h.logs);
    expect(dump).not.toContain("-1001234567890");
    expect(dump).not.toContain("9001");
    expect(dump).not.toContain("انتهى");
  });
});
