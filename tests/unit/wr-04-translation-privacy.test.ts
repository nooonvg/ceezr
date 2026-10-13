/**
 * الغرض: `WR-04` (ADR 0277) — الترجمةُ بمزوّدٍ خارجيٍّ مجّانيّ: تقليلُ البيانات (الهاتفُ والبريدُ
 *   والرابطُ لا تُرسَل)، وحدُّ MyMemory (500 بايت) بلا نداءٍ ضائع، وصورُ نفادِ الحصّةِ الثلاثُ كلُّها
 *   `rate_limited` لا «ترجمة»، والمهلةُ والانقطاعُ يُعيدانِ الأصل، ونصُّ المحادثةِ لا يصلُ السجلَّ عبرَ
 *   رسالةِ الخطأ، والإفصاحُ يُعلَنُ للكاتبِ متى كانت الترجمةُ فعّالة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { translateMessage } from "../../packages/application/i18n-translation/index.ts";
import {
  probeTranslation,
  TRANSLATION_PROBE_TEXT,
} from "../../packages/application/i18n-translation/probe-translation.ts";
import {
  type OrderChatThread,
  translateThread,
} from "../../packages/application/messaging/order-chat.ts";
import {
  decideTranslation,
  hasSensitiveContent,
  type TranslationFailure,
} from "../../packages/domain/i18n-translation/index.ts";
import {
  createMyMemoryProvider,
  MYMEMORY_MAX_QUERY_BYTES,
  scrubDetail,
} from "../../packages/infrastructure/i18n-translation/translation-providers.ts";

const AR_EN = { from: "ar", to: "en" } as const;
const noSleep = async (): Promise<void> => {};

function jsonFetch(body: unknown, status = 200, seen?: string[]): typeof fetch {
  return (async (url: string | URL) => {
    seen?.push(String(url));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("تقليلُ البيانات — ما لا يُرسَلُ للمزوّد", () => {
  const sensitive = [
    "اتصل على 0551234567",
    "رقمي ٠٥٥١٢٣٤٥٦٧",
    "رقمي ۰۵۵۱۲۳۴۵۶۷",
    "call me +966 55 123 4567",
    "055-123-4567 please",
    "my email is a.b@example.com",
    "https://maps.app.goo.gl/abc",
    "شوف www.example.com",
    "الموقع maps.google.com",
  ];
  const plain = [
    "أنا واصل بعد خمس دقائق، انتظرني عند البوابة",
    "الأجرة 25 ريال",
    "اللوحة 1234 أ ب ج",
    "I am at gate 3, building 12",
    "میں راستے میں ہوں، پانچ منٹ",
  ];
  it("الهاتفُ (بأيِّ أرقام) والبريدُ والرابطُ ⇒ حسّاس", () => {
    for (const text of sensitive) expect(hasSensitiveContent(text)).toBe(true);
  });
  it("النصُّ العاديُّ والأرقامُ القصيرةُ (أجرة، لوحة، بوابة) ⇒ ليس حسّاسًا", () => {
    for (const text of plain) expect(hasSensitiveContent(text)).toBe(false);
  });
  it("القرارُ يتخطّاه بسببٍ مسمّى، والمزوّدُ لا يُنادى أصلًا", async () => {
    expect(decideTranslation({ text: sensitive[0] ?? "", pair: AR_EN, enabled: true })).toEqual({
      kind: "skip",
      reason: "sensitive_content",
    });
    let calls = 0;
    const out = await translateMessage(
      { text: "اتصل على 0551234567", pair: AR_EN },
      {
        provider: {
          name: "spy",
          translate: async () => {
            calls += 1;
            return { ok: true, value: { text: "x", provider: "spy" } } as never;
          },
        },
      },
    );
    expect(calls).toBe(0);
    expect(out.translated).toBe(false);
    expect(out.text).toBe("اتصل على 0551234567");
    expect(out.skipped).toBe("sensitive_content");
  });
});

describe("MyMemory — الحصّةُ والحدُّ والأعطال", () => {
  it("ما فوقَ 500 بايت ⇒ يُرَدُّ بلا نداء", async () => {
    const seen: string[] = [];
    const provider = createMyMemoryProvider({ fetchImpl: jsonFetch({}, 200, seen) });
    const text = "س".repeat(MYMEMORY_MAX_QUERY_BYTES / 2 + 1);
    const out = await provider.translate({ text, pair: AR_EN });
    expect(out.ok).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("صورُ نفادِ الحصّةِ الثلاث ⇒ `rate_limited` كلُّها", async () => {
    const bodies = [
      { quotaFinished: true, responseStatus: 200, responseData: { translatedText: "x" } },
      { responseStatus: 429, responseData: { translatedText: "x" } },
      {
        responseStatus: 200,
        responseData: {
          translatedText:
            "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 10 HOURS",
        },
      },
    ];
    for (const body of bodies) {
      const out = await createMyMemoryProvider({ fetchImpl: jsonFetch(body) }).translate({
        text: "مرحبا",
        pair: AR_EN,
      });
      expect(!out.ok && out.error.kind).toBe("rate_limited");
    }
  });

  it("نفادُ الحصّة ⇒ الرسالةُ بأصلِها، والفشلُ يُسجَّلُ بنوعِه بلا نصّ", async () => {
    const failures: TranslationFailure[] = [];
    const out = await translateMessage(
      { text: "أنا عند البوابة", pair: AR_EN },
      {
        provider: createMyMemoryProvider({
          fetchImpl: jsonFetch({ quotaFinished: true, responseStatus: 200, responseData: {} }),
        }),
        onFailure: (f) => failures.push(f),
      },
    );
    expect(out.translated).toBe(false);
    expect(out.text).toBe("أنا عند البوابة");
    expect(failures.map((f) => f.kind)).toEqual(["rate_limited"]);
    expect(JSON.stringify(failures)).not.toContain("البوابة");
  });

  it("المهلة ⇒ `timeout` والأصلُ يبقى", async () => {
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })) as unknown as typeof fetch;
    const failures: TranslationFailure[] = [];
    const out = await translateMessage(
      { text: "أنا عند البوابة", pair: AR_EN },
      {
        provider: createMyMemoryProvider({ fetchImpl: hanging, timeoutMs: 50, sleepImpl: noSleep }),
        onFailure: (f) => failures.push(f),
      },
    );
    expect(out.translated).toBe(false);
    expect(out.text).toBe("أنا عند البوابة");
    expect(failures[0]?.kind).toBe("timeout");
  });

  it("انقطاعُ الاتصال: رسالةُ الخطأِ تحملُ الرابطَ ونصَّ المحادثة ⇒ يُحذفانِ من التفاصيل", async () => {
    const leaking = (async (url: string) => {
      throw new Error(`Unable to connect: ${url}`);
    }) as unknown as typeof fetch;
    const failures: TranslationFailure[] = [];
    const out = await translateMessage(
      { text: "أنا عند البوابة", pair: AR_EN },
      {
        provider: createMyMemoryProvider({ fetchImpl: leaking, sleepImpl: noSleep }),
        onFailure: (f) => failures.push(f),
      },
    );
    expect(out.translated).toBe(false);
    expect(failures[0]?.kind).toBe("provider_unavailable");
    const detail = failures[0]?.detail ?? "";
    expect(detail).not.toContain("mymemory.translated.net");
    expect(detail).not.toContain(encodeURIComponent("البوابة"));
    expect(scrubDetail("x https://h/get?q=abc&langpair=ar|en y")).toBe("x <url> y");
  });
});

describe("الإفصاح — المحادثةُ تعلنُ أنّ الترجمةَ فعّالة", () => {
  const thread: OrderChatThread = {
    orderId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
    service: "transport",
    status: "matched",
    writable: true,
    myRole: "rider",
    counterpart: { role: "driver", firstName: null, language: "ur" },
    myLanguage: "ar",
    messages: [],
    lastSeq: 0,
    myLastReadSeq: 0,
    counterpartLastReadSeq: 0,
    unread: 0,
  };
  it("مزوّدٌ ولغتانِ مختلفتان ⇒ فعّالة", async () => {
    const out = await translateThread({ translate: async () => null }, thread);
    expect(out.translationActive).toBe(true);
  });
  it("لا مزوّد، أو اللغةُ نفسُها، أو لغةٌ غيرُ مدعومة ⇒ غيرُ فعّالة", async () => {
    expect((await translateThread({}, thread)).translationActive).toBe(false);
    const same = { ...thread, counterpart: { ...thread.counterpart, language: "ar" } };
    expect((await translateThread({ translate: async () => null }, same)).translationActive).toBe(
      false,
    );
    const other = { ...thread, counterpart: { ...thread.counterpart, language: "fr" } };
    expect((await translateThread({ translate: async () => null }, other)).translationActive).toBe(
      false,
    );
  });
});

describe("WR-04 — حالاتٌ إضافيّة: الإحداثيّاتُ والردودُ المشوَّهةُ والعامّيّة (ADR 0277)", () => {
  it("إحداثيّتانِ مكتوبتانِ نصًّا (بأرقامٍ لاتينيّةٍ أو عربيّة) ⇒ حسّاس", () => {
    for (const text of [
      "أنا هنا 21.4858, 39.1925",
      "موقعي 24.4672,39.6024",
      "عند ٢١٫٤٨٥٨، ٣٩٫١٩٢٥",
      "pin -21.48581, -39.19252",
    ]) {
      expect(hasSensitiveContent(text)).toBe(true);
    }
  });
  it("أرقامٌ عشريّةٌ ليست إحداثيّات (أجرةٌ ومسافة) ⇒ ليست حسّاسة", () => {
    for (const text of ["الأجرة 25.50 ريال", "المسافة 3.2 كم، والوقت 12 دقيقة"]) {
      expect(hasSensitiveContent(text)).toBe(false);
    }
  });
  it("العامّيّةُ تُرسَلُ كما هي وتُعرضُ ترجمتُها، والأصلُ محفوظ", async () => {
    const seen: string[] = [];
    const provider = createMyMemoryProvider({
      fetchImpl: jsonFetch(
        { responseStatus: 200, responseData: { translatedText: "I'm arriving in five minutes" } },
        200,
        seen,
      ),
    });
    const out = await translateMessage(
      { text: "أنا واصل بعد خمس دقايق، استناني عند البوابة", pair: AR_EN },
      { provider },
    );
    expect(seen).toHaveLength(1);
    expect(out.translated).toBe(true);
    expect(out.original).toBe("أنا واصل بعد خمس دقايق، استناني عند البوابة");
  });
  it("ردٌّ 200 ليس JSON ⇒ `bad_response` بلا إعادةٍ تستهلكُ الحصّة", async () => {
    let calls = 0;
    const html = (async () => {
      calls += 1;
      return new Response("<html>bad gateway</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;
    const out = await createMyMemoryProvider({ fetchImpl: html, sleepImpl: noSleep }).translate({
      text: "مرحبا",
      pair: AR_EN,
    });
    expect(!out.ok && out.error.kind).toBe("bad_response");
    expect(calls).toBe(1);
  });
  it("ردٌّ بلا `responseData` أو بنصٍّ غيرِ نصّيّ أو فارغ ⇒ لا تُعرضُ «ترجمة»", async () => {
    for (const body of [
      { responseStatus: 200 },
      { responseStatus: 200, responseData: { translatedText: 42 } },
      { responseStatus: 200, responseData: { translatedText: "   " } },
      { responseStatus: 403, responseData: { translatedText: "INVALID LANGUAGE PAIR" } },
    ]) {
      const out = await translateMessage(
        { text: "أنا عند البوابة", pair: AR_EN },
        { provider: createMyMemoryProvider({ fetchImpl: jsonFetch(body), sleepImpl: noSleep }) },
      );
      expect(out.translated).toBe(false);
      expect(out.text).toBe("أنا عند البوابة");
    }
  });
  it("نصٌّ فارغٌ أو فراغاتٌ فقط ⇒ لا نداء", async () => {
    const seen: string[] = [];
    const provider = createMyMemoryProvider({ fetchImpl: jsonFetch({}, 200, seen) });
    for (const text of ["", "   ", "\n\t"]) {
      const out = await translateMessage({ text, pair: AR_EN }, { provider });
      expect(out.translated).toBe(false);
    }
    expect(seen).toHaveLength(0);
  });
});

describe("WR-04 — فحصُ الاتّصالِ عندَ الإقلاع (ADR 0279)", () => {
  it("يرسلُ النصَّ العامَّ الثابتَ وحدَه، ويقولُ ok حينَ تعودُ حروفٌ عربيّة", async () => {
    const seen: string[] = [];
    const provider = createMyMemoryProvider({
      fetchImpl: jsonFetch(
        { responseStatus: 200, responseData: { translatedText: "صباح الخير" } },
        200,
        seen,
      ),
      contactEmail: "owner@example.com",
    });
    const report = await probeTranslation(provider, { contactEmailConfigured: true });
    expect(report).toMatchObject({
      provider: "mymemory",
      ok: true,
      kind: null,
      contactEmailConfigured: true,
    });
    expect(seen).toHaveLength(1);
    expect(decodeURIComponent(seen[0] ?? "")).toContain(
      `q=${TRANSLATION_PROBE_TEXT}`.replace(" ", "+"),
    );
    expect(JSON.stringify(report)).not.toContain("owner@example.com");
    expect(JSON.stringify(report)).not.toContain("صباح");
  });
  it("الحصّةُ المنتهيةُ والمهلةُ والنصُّ المعادُ كما هو ⇒ فشلٌ بنوعِه", async () => {
    const quota = createMyMemoryProvider({
      fetchImpl: jsonFetch({ quotaFinished: true, responseStatus: 200, responseData: {} }),
    });
    expect((await probeTranslation(quota, { contactEmailConfigured: false })).kind).toBe(
      "rate_limited",
    );
    const echo = {
      name: "echo",
      translate: async () =>
        ({ ok: true, value: { text: "Good morning", provider: "echo" } }) as never,
    };
    expect(await probeTranslation(echo, { contactEmailConfigured: false })).toMatchObject({
      ok: false,
      kind: "not_translated",
    });
    const throwing = {
      name: "boom",
      translate: async () => {
        throw new Error("x");
      },
    };
    expect((await probeTranslation(throwing, { contactEmailConfigured: false })).kind).toBe(
      "threw",
    );
  });
  it("البوّابةُ تفحصُ بعدَ إعلانِ الجاهزيّةِ، ولا تسجّلُ قيمةَ البريد", () => {
    const source = readFileSync(
      new URL("../../apps/gateway/src/index.ts", import.meta.url),
      "utf8",
    );
    const started = source.indexOf('log("gateway.started"');
    const probe = source.indexOf("void probeTranslation(");
    expect(started).toBeGreaterThan(0);
    expect(probe).toBeGreaterThan(started);
    expect(source).toContain("contactEmailConfigured: config.translationContactEmail !== null");
    expect(source).not.toMatch(/log\([^)]*translationContactEmail\b(?! !== null)/);
  });
});
