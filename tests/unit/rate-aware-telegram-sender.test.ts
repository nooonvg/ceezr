/**
 * غلافُ صمودِ الصادرِ (`CAP-002`/`F6-04`). النومُ والعشوائيّةُ والساعةُ كلُّها
 * محقونةٌ، فلا اختبارٌ ينامُ ولا نتيجةٌ تتغيّرُ من تشغيلٍ إلى تشغيلٍ — والانتظارُ
 * يُتحقَّقُ منه بقراءةِ ما طُلِبَ لا بقياسِ ما مضى.
 */

import { describe, expect, it } from "bun:test";
import type { OutboundRateBucket } from "../../packages/infrastructure/notification/outbound-rate-bucket.ts";
import {
  createMemoryDeadLetterSink,
  OutboundCongestionError,
  type OutboundEvent,
  OutboundSendError,
  withOutboundResilience,
} from "../../packages/infrastructure/notification/rate-aware-telegram-sender.ts";
import type { TelegramSender } from "../../packages/infrastructure/notification/telegram-api-sender.ts";

/** دلوٌ يمنحُ دائماً — لعزلِ ما يُختبَرُ عن الحدِّ. */
const openBucket: OutboundRateBucket = { acquire: async () => ({ granted: true, waitMs: 0 }) };

function stubSender(sendMessage: TelegramSender["sendMessage"]): TelegramSender {
  return {
    sendMessage,
    sendPhoto: async () => null,
    sendLocation: async () => "loc",
  };
}

function harness(inner: TelegramSender, overrides: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const events: OutboundEvent[] = [];
  const deadLetter = createMemoryDeadLetterSink();
  const sender = withOutboundResilience(inner, {
    bucket: openBucket,
    deadLetter,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    nowIso: () => "2026-09-08T00:00:00.000Z",
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  return { sender, sleeps, events, deadLetter };
}

describe("غلافُ صمودِ الصادرِ (CAP-002)", () => {
  it("النجاحُ من أوّلِ محاولةٍ يمرُّ كما هو بلا نومٍ ولا حدثٍ", async () => {
    const { sender, sleeps, events, deadLetter } = harness(stubSender(async () => "42"));
    expect(await sender.sendMessage("111", "مرحباً", undefined)).toBe("42");
    expect(sleeps).toEqual([]);
    expect(events).toEqual([]);
    expect(deadLetter.entries()).toEqual([]);
  });

  it("يحترمُ `retry_after` حرفاً ولا يستبدلُه بتراجعِه", async () => {
    let calls = 0;
    const { sender, sleeps, events } = harness(
      stubSender(async () => {
        calls += 1;
        if (calls === 1) throw { error_code: 429, parameters: { retry_after: 7 } };
        return "ok";
      }),
    );

    expect(await sender.sendMessage("111", "نصٌّ", undefined, { priority: "critical" })).toBe("ok");
    // سبعُ ثوانٍ كما طلبَ تيليجرام، وrandom() = 0.5 يُضيفُ 125 مللي فوقَها لا داخلَها.
    expect(sleeps).toEqual([7000 + 125]);
    expect(events[0]?.type).toBe("throttled");
    expect(events[0]?.waitMs).toBe(7000);
  });

  it("الفشلُ الدائمِ لا يُعادُ أبداً: محاولةٌ واحدةٌ ثمَّ طابورُ الموتى", async () => {
    let calls = 0;
    const { sender, sleeps, deadLetter } = harness(
      stubSender(async () => {
        calls += 1;
        throw { error_code: 403, description: "bot was blocked by the user" };
      }),
    );

    await expect(
      sender.sendMessage("111", "نصٌّ", undefined, { priority: "critical" }),
    ).rejects.toBeInstanceOf(OutboundSendError);

    // خمسُ محاولاتٍ مسموحةٌ للحرجةِ، ومع ذلك واحدةٌ فقط: إعادةُ الإرسالِ إلى من
    // حظرَ البوتَ تُنفِقُ حصّةَ الحدِّ على فشلٍ مضمونٍ وتحرمُ منها رسالةً تصلُ.
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
    expect(deadLetter.entries()[0]?.failure).toBe("permanent");
  });

  it("العابرُ يُعادُ بتراجعٍ أُسّيٍّ كاملِ الـjitter", async () => {
    let calls = 0;
    const { sender, sleeps } = harness(
      stubSender(async () => {
        calls += 1;
        if (calls < 3) throw new Error("انقطاعُ شبكةٍ");
        return "ok";
      }),
      { baseBackoffMs: 100 },
    );

    expect(await sender.sendMessage("111", "نصٌّ", undefined, { priority: "critical" })).toBe("ok");
    expect(calls).toBe(3);
    // full jitter: `random() * base * 2^(n-1)` — و`random()` مثبَّتٌ على 0.5.
    expect(sleeps).toEqual([50, 100]);
  });

  it("التصنيفُ يُميِّزُ الحرجةَ عن غيرِها في عددِ المحاولاتِ", async () => {
    const count = async (priority: "critical" | "informational"): Promise<number> => {
      let calls = 0;
      const { sender } = harness(
        stubSender(async () => {
          calls += 1;
          throw new Error("عطلٌ عابرٌ");
        }),
      );
      await expect(sender.sendMessage("111", "نصٌّ", undefined, { priority })).rejects.toThrow();
      return calls;
    };

    expect(await count("critical")).toBe(5);
    expect(await count("informational")).toBe(2);
  });

  it("المجهولُ عابرٌ لا دائمٌ: خطأٌ بلا `error_code` يُعادُ", async () => {
    let calls = 0;
    const { sender } = harness(
      stubSender(async () => {
        calls += 1;
        throw new Error("شيءٌ لا نعرفُه");
      }),
    );
    await expect(sender.sendMessage("111", "نصٌّ", undefined)).rejects.toThrow();
    // من صنَّفَ المجهولَ دائماً أسقطَ رسائلَ صحيحةً لعطلٍ عارضٍ.
    expect(calls).toBe(2);
  });

  it("المهلةُ تحسمُ النداءَ المعلَّقَ فلا يحجزُ العاملَ إلى الأبدِ", async () => {
    const late = { release: (): void => {} };
    const { sender, deadLetter } = harness(
      stubSender(
        () =>
          new Promise<string>((resolve) => {
            late.release = () => resolve("متأخّرٌ");
          }),
      ),
      {
        callTimeoutMs: 5,
        informationalMaxAttempts: 1,
        // النومُ الحقيقيُّ ههنا وحدَه: المهلةُ نفسُها هي المُختبَرَةُ.
        sleep: async () => {},
      },
    );

    await expect(sender.sendMessage("111", "نصٌّ", undefined)).rejects.toBeInstanceOf(
      OutboundSendError,
    );
    expect(deadLetter.entries()[0]?.reason).toContain("مهلة");
    late.release();
  });

  it("ازدحامُ الدلوِ فوقَ المهلةِ ضغطٌ عكسيٌّ لا فشلٌ دائمٌ", async () => {
    let sends = 0;
    const closedBucket: OutboundRateBucket = {
      acquire: async () => ({ granted: false, waitMs: 400 }),
    };
    const { sender, events, deadLetter } = harness(
      stubSender(async () => {
        sends += 1;
        return "ok";
      }),
      { bucket: closedBucket, maxBucketWaitMs: 100, informationalMaxAttempts: 1 },
    );

    await expect(sender.sendMessage("111", "نصٌّ", undefined)).rejects.toBeInstanceOf(
      OutboundSendError,
    );
    // لم يُنادَ تيليجرام قطُّ: الدلوُ **يفشلُ مغلقاً** فلا يُرسَلُ بلا حدٍّ.
    expect(sends).toBe(0);
    expect(deadLetter.entries()[0]?.failure).toBe("transient");
    expect(events.some((event) => event.type === "gave_up")).toBe(true);
  });

  it("`D8` — سياسةُ الإحالةِ على مستوى النداءِ: مسارُ الطابورِ يرمي ولا يقتل", async () => {
    let sends = 0;
    const closedBucket: OutboundRateBucket = {
      acquire: async () => ({ granted: false, waitMs: 400 }),
    };
    const { sender, events, deadLetter } = harness(
      stubSender(async () => {
        sends += 1;
        return "ok";
      }),
      {
        bucket: closedBucket,
        maxBucketWaitMs: 100,
        congestionAbortMaxWaitMs: 300,
        informationalMaxAttempts: 1,
      },
    );

    // النداءُ موسومٌ بسياسةِ الإحالةِ (مسارُ صندوقِ الصادرِ الذي يملكُ `requeue`):
    // الضغطُ يُرمى `OutboundCongestionError` فوراً لا انتظارَ ولا قتلًا.
    await expect(
      sender.sendMessage("111", "نصٌّ", undefined, { congestion: "abort" }),
    ).rejects.toMatchObject({ name: "OutboundCongestionError", retryAfterMs: 400 });
    expect(sends).toBe(0);
    expect(deadLetter.entries()).toEqual([]);
    expect(events.some((event) => event.type === "gave_up")).toBe(false);
  });

  it("`D8` — سياسةُ الإحالةِ تحترمُ ميزانيّتَها: فتحةٌ تُنتظَرُ قصيراً تُستعمَل", async () => {
    let sends = 0;
    let acquires = 0;
    // فتحةٌ تُتاحُ بعدَ 150ms — دونَ ميزانيّةِ الإحالةِ (300ms) فتُنتظَرُ وتُرسَلُ الرسالة.
    const slowBucket: OutboundRateBucket = {
      acquire: async () => {
        acquires += 1;
        return acquires === 1 ? { granted: false, waitMs: 150 } : { granted: true, waitMs: 0 };
      },
    };
    const { sender, sleeps } = harness(
      stubSender(async () => {
        sends += 1;
        return "42";
      }),
      { bucket: slowBucket, congestionAbortMaxWaitMs: 300 },
    );

    expect(await sender.sendMessage("111", "نصٌّ", undefined, { congestion: "abort" })).toBe("42");
    expect(sends).toBe(1);
    expect(sleeps).toEqual([150]);
  });

  it("`sendLocation` حرجةٌ افتراضاً و`sendMessage` ليست كذلك", async () => {
    const attempts = { message: 0, location: 0 };
    const { sender } = harness({
      sendMessage: async () => {
        attempts.message += 1;
        throw new Error("عطلٌ");
      },
      sendPhoto: async () => null,
      sendLocation: async () => {
        attempts.location += 1;
        throw new Error("عطلٌ");
      },
    });

    await expect(sender.sendMessage("111", "نصٌّ", undefined)).rejects.toThrow();
    await expect(sender.sendLocation("111", 21.5, 39.1)).rejects.toThrow();

    // موقعُ الالتقاءِ يُوجِّهُ سائقاً في الطريقِ؛ وإشعارٌ نصّيٌّ يُعادُ لاحقاً.
    expect(attempts.message).toBe(2);
    expect(attempts.location).toBe(5);
  });

  it("طابورُ الموتى يُسجِّلُ ما يكفي لمعرفةِ ما ضاعَ ولمَن", async () => {
    const { sender, deadLetter } = harness(
      stubSender(async () => {
        throw { error_code: 400, description: "chat not found" };
      }),
    );
    await expect(sender.sendMessage("999", "نصٌّ", undefined)).rejects.toThrow();

    const letter = deadLetter.entries()[0];
    expect(letter?.chatId).toBe("999");
    expect(letter?.operation).toBe("sendMessage");
    expect(letter?.priority).toBe("informational");
    expect(letter?.atIso).toBe("2026-09-08T00:00:00.000Z");
    expect(letter?.reason.length).toBeGreaterThan(0);
  });

  it("طابورُ الموتى محدودُ السَّعةِ فلا ينمو بلا حدٍّ", async () => {
    const sink = createMemoryDeadLetterSink(2);
    for (const reason of ["أوّلُ", "ثانٍ", "ثالثٌ"]) {
      await sink.record({
        chatId: "1",
        operation: "sendMessage",
        priority: "informational",
        failure: "transient",
        attempts: 1,
        reason,
        atIso: "2026-09-08T00:00:00.000Z",
      });
    }
    expect(sink.entries().map((letter) => letter.reason)).toEqual(["ثانٍ", "ثالثٌ"]);
  });

  // `LOAD-01` (الدفعةُ الخامسةُ) — انحدارُ ترتيبِ اقتناءِ الفتحتينِ: ازدحامُ
  // المحادثةِ لا يجوزُ أن يستهلكَ فتحةً من الدلوِ العالميِّ المشتركِ للبوتِ كلِّهِ.
  // قبلَ الإصلاحِ كانَ العالميُّ يُقتنى أولًا فيُمنَحُ ويُهدَرُ عندَ رفضِ فتحةِ
  // المحادثةِ — فانخفضَ السقفُ الفعليُّ من 25/ث إلى ~12.5/ث (قياسُ r3-wave-50).
  it("ازدحامُ المحادثةِ لا يستهلكُ فتحةً من الدلوِ العالميِّ المشتركِ", async () => {
    const calls: string[] = [];
    const chatAcquires = new Map<string, number>();
    const bucket: OutboundRateBucket = {
      acquire: async (scope, key) => {
        calls.push(`${scope}:${key}`);
        if (scope === "global") return { granted: true, waitMs: 0 };
        // محادثةٌ واحدةٌ في الثانيةِ: أولُ اقتناءٍ يُمنَحُ والثاني خلالَ الثانيةِ يُرفضُ
        const n = (chatAcquires.get(String(key)) ?? 0) + 1;
        chatAcquires.set(String(key), n);
        return n <= 1 ? { granted: true, waitMs: 0 } : { granted: false, waitMs: 1000 };
      },
    };
    const { sender } = harness(
      stubSender(async () => "42"),
      { bucket },
    );
    // أولُ رسالةٍ للمحادثةِ A: تُمنَحُ فتحةُ المحادثةِ ثمَّ العالميُّ فتُرسَلُ.
    expect(await sender.sendMessage("A", "أولى", undefined)).toBe("42");
    // ثاني رسالةٍ للمحادثةِ نفسِها خلالَ الثانيةِ: ازدحامُ محادثةٍ — يجبُ أن
    // يُرفَضَ عندَ فتحةِ المحادثةِ نفسِها **قبلَ الاقتناءِ منَ العالميِّ**.
    await expect(
      sender.sendMessage("A", "ثانية", undefined, { congestion: "abort" }),
    ).rejects.toBeInstanceOf(OutboundCongestionError);
    // الاقتناءُ الأخيرُ منَ العالميِّ هوَ لرسالةِ «أولى» وحدَها: ازدحامُ
    // «ثانية» لم يمسَّ الدلوَ العالميَّ إطلاقاً.
    expect(calls.filter((c) => c.startsWith("global")).length).toBe(1);
    expect(calls.filter((c) => c === "chat:A").length).toBe(2);
  });

  it("رفضُ فتحةِ العالميِّ بعدَ منحِ المحادثةِ يُعادُ سببُهُ العالميَّ لا المحادثيَّ", async () => {
    let grants = 0;
    const bucket: OutboundRateBucket = {
      acquire: async (scope) => {
        if (scope === "chat") return { granted: true, waitMs: 0 };
        grants += 1;
        return grants === 1 ? { granted: true, waitMs: 0 } : { granted: false, waitMs: 900 };
      },
    };
    const { sender, events } = harness(
      stubSender(async () => "42"),
      { bucket },
    );
    expect(await sender.sendMessage("A", "أولى", undefined)).toBe("42");
    // العالميُّ ممتلئٌ: الرفضُ سببُهُ العالميُّ حتى لو كانت فتحةُ المحادثةِ مُنِحَتْ أولًا.
    await expect(
      sender.sendMessage("B", "ثانية", undefined, { congestion: "abort" }),
    ).rejects.toBeInstanceOf(OutboundCongestionError);
    expect(events.some((e) => e.type === "backpressure" && e.detail === "global")).toBe(false);
  });
});
