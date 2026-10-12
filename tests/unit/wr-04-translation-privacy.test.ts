/**
 * الغرض: `WR-04` (ADR 0277) — الترجمةُ بمزوّدٍ خارجيٍّ مجّانيّ: تقليلُ البيانات (الهاتفُ والبريدُ
 *   والرابطُ لا تُرسَل)، وحدُّ MyMemory (500 بايت) بلا نداءٍ ضائع، وصورُ نفادِ الحصّةِ الثلاثُ كلُّها
 *   `rate_limited` لا «ترجمة»، والمهلةُ والانقطاعُ يُعيدانِ الأصل، ونصُّ المحادثةِ لا يصلُ السجلَّ عبرَ
 *   رسالةِ الخطأ، والإفصاحُ يُعلَنُ للكاتبِ متى كانت الترجمةُ فعّالة.
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import { translateMessage } from "../../packages/application/i18n-translation/index.ts";
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
