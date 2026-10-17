/**
 * الغرض: CAP-RUN-20261015 / N1 — عنقُ زجاجةِ صندوقِ الصادر.
 *   قبل: شوطٌ واحدٌ يرسلُ batch_limit (8) تسلسليًّا ثمّ ينتهي → ≈0.8 رسالة/ث مع دقّةِ مشغّلٍ 10ث.
 *   بعد: استنزافٌ متزامنٌ محدودٌ يحترمُ ترتيبَ المفتاحِ ويختمُ كلَّ صفٍّ مرّةً واحدة.
 * ينتمي إلى: tests/unit
 */
import { describe, expect, test } from "bun:test";
import {
  deliverNotifications,
  notificationDrainSettingsFromEnv,
} from "../../apps/workers/src/jobs/deliver-notifications.ts";
import {
  deliverNotificationsConcurrently,
  type NotificationOutboxPort,
  notificationLaneKey,
  type OutboxDelivery,
} from "../../packages/application/notification/deliver-notification.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

type Row = { id: string; kind: string; payload: Record<string, unknown> };
function fakeOutbox(rows: Row[], opts: { failClaimAt?: number; batchLimit?: number } = {}) {
  const queue = [...rows];
  const st = {
    claims: 0,
    finished: new Map<string, number>(),
    requeued: [] as string[],
    sent: [] as string[],
    inFlight: 0,
    peak: 0,
  };
  const port: NotificationOutboxPort = {
    // `LOAD-01 Recovery` — مسارا اللوح في هذا الاختبارِ بلا عروضٍ: لا
    // إيصالاتٍ ولا انتظارَ — يُرجعانِ التسليمَ المباشرَ للسخريةِ (لم يُطلبا).
    finishViaBoard: async () => ok({ ok: true, outcome: "delivered" }),
    requeueSignalWait: async () => ok({ ok: true, outcome: null }),
    claim: async () => {
      st.claims += 1;
      if (opts.failClaimAt !== undefined && st.claims === opts.failClaimAt)
        return err(new PortFailureError("rpc.claim", "db down"));
      const r = queue.shift();
      if (!r) return ok({ delivery: null });
      const d: OutboxDelivery = {
        deliveryId: r.id,
        kind: r.kind,
        cityId: "c" as never,
        claimToken: `t-${r.id}`,
        attempts: 1,
        maxAttempts: 3,
        batchLimit: opts.batchLimit ?? 8,
        requestId: null,
        payload: r.payload,
      };
      return ok({ delivery: d });
    },
    finish: async ({ deliveryId }) => {
      st.finished.set(deliveryId, (st.finished.get(deliveryId) ?? 0) + 1);
      return ok({ ok: true, outcome: "delivered" });
    },
    abandon: async () => ok(true),
    undeliverable: async () => ok(true),
    requeue: async ({ deliveryId }: { deliveryId: string }) => {
      st.requeued.push(deliveryId);
      return ok(true);
    },
  };
  const handler = async (d: OutboxDelivery) => {
    st.inFlight += 1;
    st.peak = Math.max(st.peak, st.inFlight);
    await new Promise((r) => setTimeout(r, 2 + Math.random() * 15));
    st.sent.push(d.deliveryId);
    st.inFlight -= 1;
    return ok({ abandon: false, messageId: `m-${d.deliveryId}`, failure: null });
  };
  return {
    port,
    st,
    handlers: {
      offer: handler,
      negotiation_turn_opened: handler,
      unmatched_rider: handler,
      x: handler,
    },
  };
}
const offers = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `o${i}`,
    kind: "offer",
    payload: { offer_id: `of${i}`, order_id: `ord${i % 10}` },
  }));

describe("N1: استنزافُ صندوقِ الصادرِ المتزامن", () => {
  test("إعادةُ إنتاجِ العيب: المسارُ القديمُ يرسلُ 8 فقط من 100 في الشوط", async () => {
    const f = fakeOutbox(offers(100));
    const r = await deliverNotifications(
      { outbox: f.port, handlers: f.handlers },
      { lanes: 8, budgetMs: 0, maxClaims: 2000 },
    );
    expect(r.ok && r.value.delivered).toBe(8);
    expect(f.st.peak).toBe(1);
  });
  test("بعد الإصلاح: 100 من 100 في شوطٍ واحدٍ، بلا ختمٍ مكرّر، وتزامنٌ ≤ lanes", async () => {
    const f = fakeOutbox(offers(100));
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: f.handlers },
      { lanes: 8, budgetMs: 5000, maxClaims: 2000 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.delivered).toBe(100);
    expect(f.st.finished.size).toBe(100);
    expect([...f.st.finished.values()].every((n) => n === 1)).toBe(true);
    expect(f.st.peak).toBeLessThanOrEqual(8);
    expect(f.st.peak).toBeGreaterThan(1);
  });
  test("ترتيبُ المفتاح: صفوفُ الطلبِ نفسِه تُرسَلُ بترتيبِ التقاطِها", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 60; i++)
      rows.push({
        id: `r${i}`,
        kind: i % 2 ? "negotiation_turn_opened" : "unmatched_rider",
        payload: { order_id: `ord${i % 5}` },
      });
    const f = fakeOutbox(rows);
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: f.handlers },
      { lanes: 8, budgetMs: 5000, maxClaims: 2000 },
    );
    expect(r.ok && r.value.delivered).toBe(60);
    for (let k = 0; k < 5; k++) {
      const expected = rows.filter((x) => x.payload.order_id === `ord${k}`).map((x) => x.id);
      expect(f.st.sent.filter((id) => expected.includes(id))).toEqual(expected);
    }
  });
  test("lanes=1 يساوي التسلسلَ لكن يواصلُ حتّى يفرغَ الطابور", async () => {
    const f = fakeOutbox(offers(30));
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: f.handlers },
      { lanes: 1, budgetMs: 5000, maxClaims: 2000 },
    );
    expect(r.ok && r.value.delivered).toBe(30);
    expect(f.st.peak).toBe(1);
  });
  test("فشلُ القاعدةِ أثناءَ الالتقاط: يتوقّفُ الالتقاطُ، ويُختَمُ ما في الطيرانِ، ويُعادُ الخطأ", async () => {
    const f = fakeOutbox(offers(50), { failClaimAt: 20 });
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: f.handlers },
      { lanes: 8, budgetMs: 5000, maxClaims: 2000 },
    );
    expect(r.ok).toBe(false);
    expect(f.st.finished.size).toBe(19); // كلُّ ما التُقطَ خُتمَ مرّةً، ولا التقاطَ بعدَ الفشل
    expect(f.st.claims).toBe(20);
  });
  test("السقفُ والميزانية: لا التقاطَ بعدَ maxClaims", async () => {
    const f = fakeOutbox(offers(100));
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: f.handlers },
      { lanes: 4, budgetMs: 5000, maxClaims: 25 },
    );
    expect(r.ok && r.value.claimed).toBe(25);
    expect(r.ok && r.value.backpressure).toBe("BATCH_LIMIT");
  });
  test("مفتاحُ المسار: العروضُ مستقلّةٌ لكلِّ عرض، وغيرُها بالطلب", () => {
    const base = {
      cityId: "c" as never,
      claimToken: "t",
      attempts: 1,
      maxAttempts: 3,
      batchLimit: 8,
      requestId: null,
    };
    expect(
      notificationLaneKey({
        ...base,
        deliveryId: "a",
        kind: "offer",
        payload: { offer_id: "X", order_id: "O" },
      }),
    ).toBe("offer:X");
    expect(
      notificationLaneKey({
        ...base,
        deliveryId: "a",
        kind: "unmatched_rider",
        payload: { order_id: "O" },
      }),
    ).toBe("order:O");
    expect(notificationLaneKey({ ...base, deliveryId: "a", kind: "broadcast", payload: {} })).toBe(
      "row:a",
    );
  });
  test("الإعدادُ من البيئة: القيمُ غيرُ الصالحةِ تعودُ للافتراضيِّ وتُعلَن", () => {
    expect(notificationDrainSettingsFromEnv({})).toEqual({
      lanes: 8,
      budgetMs: 8000,
      maxClaims: 2000,
      invalid: [],
    });
    const s = notificationDrainSettingsFromEnv({
      NOTIFICATION_DRAIN_LANES: "0",
      NOTIFICATION_DRAIN_BUDGET_MS: "abc",
      NOTIFICATION_DRAIN_MAX_CLAIMS: "-3",
    });
    expect(s.lanes).toBe(8);
    expect(s.budgetMs).toBe(8000);
    expect(s.invalid).toEqual([
      "NOTIFICATION_DRAIN_LANES",
      "NOTIFICATION_DRAIN_BUDGET_MS",
      "NOTIFICATION_DRAIN_MAX_CLAIMS",
    ]);
    expect(notificationDrainSettingsFromEnv({ NOTIFICATION_DRAIN_BUDGET_MS: "0" }).budgetMs).toBe(
      0,
    );
    expect(notificationDrainSettingsFromEnv({ NOTIFICATION_DRAIN_LANES: "999" }).lanes).toBe(8);
  });

  test("D8: ازدحامُ الدلاءِ يُعيدُ الصفَّ إلى الطابورِ لا موتًا ولا تسليمًا", async () => {
    // المُرسِلُ رمى ازدحامًا (`OutboundCongestionError`) — المعالجاتُ تنقلُ اسمَهُ
    // نصًّا. الحكمُ: الصفُّ يُعادُ إلى الطابورِ بموعدِ فتحةٍ (requeue) ولا يُختمُ
    // (finish) ولا يُتخلى عنه (abandon) ولا يُعلَنُ تسليمًا — والمسارُ يتفرّغُ.
    const f = fakeOutbox(offers(5));
    const congested = async () =>
      ok({ abandon: false, messageId: null, failure: "OutboundCongestionError" });
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: { offer: congested } },
      { lanes: 8, budgetMs: 2000, maxClaims: 2000 },
    );
    expect(r.ok).toBe(true);
    expect(f.st.requeued.length).toBe(5);
    expect(f.st.finished.size).toBe(0);
    expect(f.st.sent.length).toBe(0);
  });

  // `LOAD-01` (الدفعةُ الخامسةُ) — انحدارُ الانتظارِ الذكيِّ عندَ فراغِ الطابورِ:
  // صفُّ الازدحامِ يُعادُ اصطفافًا بموعدِ فتحتِهِ (ثانيةٍ) — والشوطُ الذي كانَ
  // ينكسرُ عندَ أولِ طابورٍ فارغٍ ينتظرُ حتى موعدِ الفتحةِ ويلتقطُ الصفوفَ
  // المستحقةَ داخلَ الشوطِ نفسِهِ، فتُسلَّمُ إشعاراتُ الرحلةِ المتجمعةُ لمحادثةٍ
  // واحدةٍ في شوطٍ واحدٍ لا في ثلاثِ دوراتِ تشغيلٍ.
  test("D8/الانتظارُ الذكيُّ: إشعاراتٌ متجمعةٌ لمحادثةٍ واحدةٍ تُسلَّمُ في شوطٍ واحدٍ عندَ الفتحاتِ", async () => {
    let clock = 1_000;
    const rows: { id: string; dueAt: number }[] = [
      { id: "n1", dueAt: 0 },
      { id: "n2", dueAt: 0 },
      { id: "n3", dueAt: 0 },
    ];
    const st = {
      claims: 0,
      finished: new Set<string>(),
      requeued: [] as string[],
    };
    const lastSentAt = new Map<string, number>();
    const sentLog: { id: string; at: number }[] = [];
    const port: NotificationOutboxPort = {
      finishViaBoard: async () => ok({ ok: true, outcome: "delivered" }),
      requeueSignalWait: async () => ok({ ok: true, outcome: null }),
      claim: async () => {
        st.claims += 1;
        const due = rows.filter((r) => r.dueAt <= clock);
        if (due.length === 0) return ok({ delivery: null });
        const r = due[0];
        if (r === undefined) return ok({ delivery: null });
        rows.splice(rows.indexOf(r), 1);
        const d: OutboxDelivery = {
          deliveryId: r.id,
          kind: "rider_trip_notice",
          cityId: "c" as never,
          claimToken: `t-${r.id}`,
          attempts: 1,
          maxAttempts: 5,
          batchLimit: 8,
          requestId: null,
          payload: { order_id: "o1", chat_id: "chat-A" },
        };
        return ok({ delivery: d });
      },
      finish: async ({ deliveryId }) => {
        st.finished.add(deliveryId);
        return ok({ ok: true, outcome: "delivered" });
      },
      abandon: async () => ok(true),
      undeliverable: async () => ok(true),
      requeue: async ({ deliveryId }) => {
        st.requeued.push(deliveryId);
        const r = rows.find((x) => x.id === deliveryId);
        if (r !== undefined) r.dueAt = clock + 1_000;
        else rows.push({ id: deliveryId, dueAt: clock + 1_000 });
        return ok(true);
      },
    };
    const windowed = async (d: OutboxDelivery) => {
      const chat = String(d.payload.chat_id);
      const last = lastSentAt.get(chat);
      if (last !== undefined && clock - last < 1_000) {
        return ok({ abandon: false, messageId: null, failure: "OutboundCongestionError" });
      }
      lastSentAt.set(chat, clock);
      sentLog.push({ id: d.deliveryId, at: clock });
      return ok({ abandon: false, messageId: `m-${d.deliveryId}`, failure: null });
    };
    const r = await deliverNotificationsConcurrently(
      { outbox: port, handlers: { rider_trip_notice: windowed } },
      {
        lanes: 4,
        budgetMs: 8_000,
        maxClaims: 50,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    expect(r.ok).toBe(true);
    // الثلاثةُ سُلِّمَتْ في الشوطِ نفسِهِ وبالترتيبِ — عبرَ إعادةِ الاصطفافِ والالتقاطَ
    // عندَ الاستحقاقِ لا الاحتفاظَ بالصفوفِ
    expect(sentLog.map((x) => x.id)).toEqual(["n1", "n2", "n3"]);
    expect([...st.finished]).toEqual(["n1", "n2", "n3"]);
    // الفتحاتُ احتُرِمَت: كلُّ إرسالٍ بعدَ ثانيةٍ كاملةٍ من سابقهِ للمحادثةِ نفسِها
    const gap = (a: number, b: number): number => {
      const first = sentLog[a];
      const second = sentLog[b];
      if (first === undefined || second === undefined) return -1;
      return second.at - first.at;
    };
    expect(gap(0, 1)).toBeGreaterThanOrEqual(1_000);
    expect(gap(1, 2)).toBeGreaterThanOrEqual(1_000);
  });

  test("D8/الانتظارُ الذكيُّ: ما لم تُفتَحِ الفتحةُ داخلَ الميزانيةِ يُعادُ للطابورِ كما كانَ", async () => {
    const f = fakeOutbox(offers(1));
    let clock = 1_000;
    const congested = async () =>
      ok({ abandon: false, messageId: null, failure: "OutboundCongestionError" });
    const r = await deliverNotificationsConcurrently(
      { outbox: f.port, handlers: { offer: congested } },
      {
        lanes: 4,
        budgetMs: 300,
        maxClaims: 10,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    expect(r.ok).toBe(true);
    // الميزانيةُ انتهت قبلَ الفتحةِ: الصفُّ يعودُ للطابورِ (إعادةُ اصطفافٍ بموعدِ
    // ثانيةٍ) ويُحسَبُ فشلًا كما كانَ — لا تسليمَ ولا موتَ.
    expect(f.st.requeued.length).toBeGreaterThanOrEqual(1);
    expect(f.st.sent.length).toBe(0);
    if (r.ok) expect(r.value.failed).toBeGreaterThanOrEqual(1);
  });
});
