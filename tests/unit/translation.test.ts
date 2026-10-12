/**
 * الغرض: اختبارات وحدة لطبقة الترجمة: قرار الترجمة في الدومين، وسلوك حالة الاستخدام
 *   عند سقوط المزوّد، وتفسير ردود المزوّدات الحقيقية (بـ fetch محقون بلا شبكة)،
 *   والذاكرة المؤقتة، وكشف اللغة، وحوار اختيار اللغة.
 * الحالة: اختبار وحدة فعلي — المرحلة 2.6.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (وظيفة verify)
 * ملاحظات مستقبلية: أي مزوّد جديد يُضاف له اختبار تفسير ردّ ناجح وردّ فاشل هنا.
 */

import { describe, expect, it } from "bun:test";
import {
  handleLanguageCallback,
  handleLanguageCommand,
} from "../../packages/application/bots/language-dialog.ts";
import type { Sender } from "../../packages/application/bots/types.ts";
import {
  detectLanguage,
  getSupportedLanguages,
  type LanguageChangeOutcome,
  type LanguagePreferencePort,
  renderLocalizedTemplate,
  resolveLanguage,
  type TranslationProvider,
  translateMessage,
} from "../../packages/application/i18n-translation/index.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import {
  decideTranslation,
  hasTranslatableContent,
  needsBridging,
  normalizeLanguageTag,
  parseLanguage,
  shouldShowOriginal,
  TRANSLATION_MAX_CHARS,
  TranslationFailure,
  translationCacheKey,
  untranslated,
} from "../../packages/domain/i18n-translation/index.ts";
import {
  createDeepLProvider,
  createGoogleTranslateProvider,
  createGoogleWebProvider,
  createMemoryTranslationCache,
  createMyMemoryProvider,
  createTranslationProvider,
  TRANSLATION_RETRY_BACKOFF_MS,
} from "../../packages/infrastructure/i18n-translation/index.ts";
import { initialLanguageFromHint, translate } from "../../packages/shared/i18n/index.ts";
import type { Clock } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const AR_EN = { from: "ar", to: "en" } as const;

function fixedClock(start: Date): Clock & { advance: (ms: number) => void } {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

/** مزوّد ناجح دائماً يُعيد نصّاً مقلوباً — يكفي لإثبات أن نصّاً آخر عاد. */
function echoProvider(name = "stub"): TranslationProvider & { readonly calls: number } {
  let calls = 0;
  return {
    name,
    get calls() {
      return calls;
    },
    translate: async ({ text }) => {
      calls += 1;
      return ok({ text: `<<${text}>>`, provider: name });
    },
  };
}

/** fetch محقون يعيد جسماً ثابتاً — تفسير الردّ يُختبَر بلا شبكة. */
function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => jsonResponse(body, status)) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** لا انتظار حقيقي في الاختبار: التراجع سلوك يُثبَّت لا مدّة تُقضى. */
const noSleep = async (): Promise<void> => {};

/**
 * fetch يعيد ردّاً مختلفاً لكل نداء ويعدّ النداءات — به يُقاس عدد المحاولات
 * لا مجرّد نتيجتها. الزائد عن القائمة يأخذ آخر ردّ مكرّراً.
 */
function countingFetch(responses: readonly Response[]): {
  readonly fetch: typeof fetch;
  readonly calls: number;
} {
  let calls = 0;
  return {
    fetch: (async () => {
      const index = Math.min(calls, responses.length - 1);
      calls += 1;
      return responses[index]?.clone();
    }) as unknown as typeof fetch,
    get calls() {
      return calls;
    },
  };
}

describe("قيم اللغة", () => {
  it("يطبّع الوسوم المركّبة إلى لغة مدعومة", () => {
    expect(normalizeLanguageTag("ar-SA")).toBe("ar");
    expect(normalizeLanguageTag("EN_us")).toBe("en");
    expect(normalizeLanguageTag(" ur ")).toBe("ur");
  });

  it("يرفض ما لا قاموس له ويعيد null لا لغة افتراضية", () => {
    // إرجاع "ar" لوسم فرنسي كان سيخفي عن النظام أن المستخدم لا يفهم رسائله
    expect(normalizeLanguageTag("fr")).toBeNull();
    expect(normalizeLanguageTag(null)).toBeNull();
    expect(normalizeLanguageTag("")).toBeNull();
  });

  it("يميّز الفراغ من غير المدعوم في سبب الرفض", () => {
    const empty = parseLanguage("  ");
    const unsupported = parseLanguage("de");
    expect(empty.ok === false && empty.error.reason).toBe("empty");
    expect(unsupported.ok === false && unsupported.error.reason).toBe("unsupported");
    const good = parseLanguage("AR");
    expect(good.ok && good.value).toBe("ar");
  });

  it("يعرض اللغات الثلاث كلَّ واحدة باسمها بلغتها هي", () => {
    const options = getSupportedLanguages();
    expect(options.map((o) => o.code)).toEqual(["ar", "en", "ur"]);
    expect(options.find((o) => o.code === "en")?.label).toContain("English");
    expect(options.find((o) => o.code === "ur")?.label).toContain("اردو");
  });
});

describe("قرار الترجمة", () => {
  it("لا يترجم بين لغة ونفسها", () => {
    const decision = decideTranslation({
      text: "مرحبا",
      pair: { from: "ar", to: "ar" },
      enabled: true,
    });
    expect(decision).toEqual({ kind: "skip", reason: "same_language" });
  });

  it("لا يترجم نصّاً بلا حرف واحد", () => {
    expect(hasTranslatableContent("0501234567")).toBe(false);
    expect(hasTranslatableContent("👍 ✅ 123")).toBe(false);
    expect(hasTranslatableContent("ok")).toBe(true);

    const decision = decideTranslation({ text: "  123  ", pair: AR_EN, enabled: true });
    expect(decision).toEqual({ kind: "skip", reason: "no_translatable_content" });
  });

  it("يمتنع عن النصّ الأطول من الحدّ بدل بتره صامتاً", () => {
    const long = "ا".repeat(TRANSLATION_MAX_CHARS + 1);
    expect(decideTranslation({ text: long, pair: AR_EN, enabled: true })).toEqual({
      kind: "skip",
      reason: "too_long",
    });
  });

  it("الإطفاء سبب صريح لا عطل", () => {
    expect(decideTranslation({ text: "مرحبا", pair: AR_EN, enabled: false })).toEqual({
      kind: "skip",
      reason: "disabled",
    });
  });

  it("يقتصّ النصّ في القرار فلا يدخل الفراغ مفتاح الذاكرة", () => {
    const decision = decideTranslation({ text: "  مرحبا  ", pair: AR_EN, enabled: true });
    expect(decision.kind === "translate" && decision.text).toBe("مرحبا");
    expect(translationCacheKey(AR_EN, "  مرحبا  ")).toBe("ar:en:مرحبا");
  });

  it("مفتاح الذاكرة يتغيّر بتغيّر الاتجاه", () => {
    expect(translationCacheKey({ from: "ar", to: "en" }, "س")).not.toBe(
      translationCacheKey({ from: "en", to: "ar" }, "س"),
    );
  });

  it("الأصل يُعرض مع المترجَم فقط، ولا يُذيَّل تحت نصّ لم يُترجَم", () => {
    expect(shouldShowOriginal(untranslated("hi", AR_EN, "same_language"))).toBe(false);
    expect(needsBridging("ar", "ur")).toBe(true);
    expect(needsBridging("ar", "ar")).toBe(false);
  });
});

describe("حالة استخدام الترجمة", () => {
  it("تترجم وتحفظ في الذاكرة، ثم تقرأ منها بلا نداء ثانٍ", async () => {
    const provider = echoProvider();
    const cache = createMemoryTranslationCache(fixedClock(new Date("2026-08-08T00:00:00Z")));

    const first = await translateMessage({ text: "مرحبا", pair: AR_EN }, { provider, cache });
    expect(first.translated).toBe(true);
    expect(first.cached).toBe(false);
    expect(first.text).toBe("<<مرحبا>>");

    const second = await translateMessage({ text: "مرحبا", pair: AR_EN }, { provider, cache });
    expect(second.cached).toBe(true);
    expect(second.text).toBe("<<مرحبا>>");
    expect(provider.calls).toBe(1);
  });

  it("سقوط المزوّد يُبلَّغ ولا يُوقف الرسالة", async () => {
    const seen: TranslationFailure[] = [];
    const provider: TranslationProvider = {
      name: "down",
      translate: async () => err(new TranslationFailure("timeout", "down", "abort")),
    };

    const outcome = await translateMessage(
      { text: "مرحبا", pair: AR_EN },
      { provider, onFailure: (failure) => seen.push(failure) },
    );

    expect(outcome.translated).toBe(false);
    expect(outcome.text).toBe("مرحبا");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe("timeout");
    expect(seen[0]?.retryable).toBe(true);
  });

  it("زوج لغتين لا يدعمه المزوّد لا يستحقّ إعادة محاولة", () => {
    expect(new TranslationFailure("unsupported_pair", "deepl", "ur").retryable).toBe(false);
  });

  it("مزوّد يعيد النصّ كما أرسلناه ليس ترجمة", async () => {
    const provider: TranslationProvider = {
      name: "lazy",
      translate: async ({ text }) => ok({ text, provider: "lazy" }),
    };
    const outcome = await translateMessage({ text: "مرحبا", pair: AR_EN }, { provider });
    expect(outcome.translated).toBe(false);
    expect(outcome.skipped).toBe("no_translatable_content");
  });

  it("غياب المزوّد لا يرمي استثناءً", async () => {
    const outcome = await translateMessage({ text: "مرحبا", pair: AR_EN }, { provider: null });
    expect(outcome.text).toBe("مرحبا");
    expect(outcome.skipped).toBe("disabled");
  });
});

describe("القالب المحلَّى بالترجمة", () => {
  it("القالب من القاموس بلغة القارئ، والمترجَم هو النصّ الحرّ وحده، والأصل مذيَّل", async () => {
    const rendered = await renderLocalizedTemplate(
      {
        templateKey: "negotiation.relay_from_driver",
        body: "أنا قريب",
        from: "ar",
        to: "en",
      },
      { provider: echoProvider() },
    );

    expect(rendered.text).toContain(
      translate("en", "negotiation.relay_from_driver", { text: "<<أنا قريب>>" }),
    );
    expect(rendered.text).toContain("أنا قريب");
    expect(rendered.text).toContain(translate("en", "translation.language_name.ar"));
    expect(rendered.translation.translated).toBe(true);
  });

  it("بلا ترجمة: القالب وحده بلا تذييل", async () => {
    const rendered = await renderLocalizedTemplate(
      { templateKey: "negotiation.relay_from_rider", body: "أنا قريب", from: "ar", to: "ar" },
      { provider: echoProvider() },
    );
    expect(rendered.text).toBe(
      translate("ar", "negotiation.relay_from_rider", { text: "أنا قريب" }),
    );
    expect(rendered.translation.skipped).toBe("same_language");
  });
});

describe("الذاكرة المؤقتة", () => {
  it("تُسقط المُدخَل بعد انتهاء مهلته", async () => {
    const clock = fixedClock(new Date("2026-08-08T00:00:00Z"));
    const cache = createMemoryTranslationCache(clock, { ttlSeconds: 60 });

    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");

    clock.advance(61_000);
    expect(await cache.get("k")).toBeNull();
    // المنتهي يُحذف عند قراءته لا يُترك يتراكم
    expect(cache.size()).toBe(0);
  });

  it("لا تتجاوز سقف المُدخَلات فتتسرّب الذاكرة", async () => {
    const cache = createMemoryTranslationCache(fixedClock(new Date()), { maxEntries: 2 });
    await cache.set("a", "1");
    await cache.set("b", "2");
    await cache.set("c", "3");

    expect(cache.size()).toBe(2);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("c")).toBe("3");
  });
});

describe("تفسير ردود المزوّدات", () => {
  it("DeepL: يقرأ أول ترجمة", async () => {
    const provider = createDeepLProvider("key:fx", {
      fetchImpl: jsonFetch({ translations: [{ text: "Hello" }] }),
    });
    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(outcome.ok && outcome.value.text).toBe("Hello");
  });

  it("DeepL: يرفض الأردية صراحةً بدل أن يفشل عند المستخدم", async () => {
    const provider = createDeepLProvider("key:fx", { fetchImpl: jsonFetch({}) });
    const outcome = await provider.translate({ text: "hi", pair: { from: "en", to: "ur" } });
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.kind).toBe("unsupported_pair");
    expect(!outcome.ok && outcome.error.retryable).toBe(false);
  });

  it("Google v2: يفكّ كيانات HTML فلا تصل المستخدم", async () => {
    const provider = createGoogleTranslateProvider("key", {
      fetchImpl: jsonFetch({
        data: { translations: [{ translatedText: "It&#39;s here &amp; ready" }] },
      }),
    });
    const outcome = await provider.translate({ text: "س", pair: AR_EN });
    expect(outcome.ok && outcome.value.text).toBe("It's here & ready");
  });

  it("google-web: يوصل القطع بالترتيب", async () => {
    const provider = createGoogleWebProvider({
      fetchImpl: jsonFetch([
        [
          ["I am ", "x"],
          ["arriving now", "y"],
        ],
        null,
        "ar",
      ]),
    });
    const outcome = await provider.translate({ text: "س", pair: AR_EN });
    expect(outcome.ok && outcome.value.text).toBe("I am arriving now");
  });

  it("MyMemory: 429 يُصنَّف تجاوز حصّة لا عطلاً دائماً", async () => {
    const provider = createMyMemoryProvider({ fetchImpl: jsonFetch({}, 429) });
    const outcome = await provider.translate({ text: "س", pair: AR_EN });
    expect(!outcome.ok && outcome.error.kind).toBe("rate_limited");
    expect(!outcome.ok && outcome.error.retryable).toBe(true);
  });

  it("MyMemory: تحذير المزوّد داخل حقل الترجمة لا يُسلَّم كترجمة", async () => {
    const provider = createMyMemoryProvider({
      fetchImpl: jsonFetch({
        responseStatus: 200,
        responseData: { translatedText: "INVALID LANGUAGE PAIR" },
      }),
    });
    const outcome = await provider.translate({ text: "س", pair: AR_EN });
    expect(outcome.ok).toBe(false);
  });

  it("خطأ HTTP عام يُصنَّف تعذّر مزوّد", async () => {
    const provider = createMyMemoryProvider({ fetchImpl: jsonFetch({}, 503), sleepImpl: noSleep });
    const outcome = await provider.translate({ text: "س", pair: AR_EN });
    expect(!outcome.ok && outcome.error.kind).toBe("provider_unavailable");
  });

  it("المصنع: none يعيد null، والمزوّد المفتاحي بلا مفتاح يعيد null", () => {
    expect(createTranslationProvider({ provider: "none" })).toBeNull();
    expect(createTranslationProvider({ provider: "deepl" })).toBeNull();
    expect(createTranslationProvider({ provider: "google" })).toBeNull();
    expect(createTranslationProvider({ provider: "mymemory" })?.name).toBe("mymemory");
    expect(createTranslationProvider({ provider: "google-web" })?.name).toBe("google-web");
    expect(createTranslationProvider({ provider: "deepl", apiKey: "k" })?.name).toBe("deepl");
  });
});

/**
 * البند ج.1: محاولة واحدة إضافية لا أكثر، وللعطل العابر وحده. كل اختبار هنا يعدّ
 * النداءات الفعلية، لا يكتفي بالنتيجة — فالنتيجة نفسها تظهر بمحاولة وبعشر.
 */
describe("إعادة المحاولة عند العطل العابر", () => {
  it("503 يُعاد مرّة واحدة فقط، وينجح إن نجحت الثانية", async () => {
    const counter = countingFetch([
      new Response("", { status: 503 }),
      jsonResponse({
        responseStatus: 200,
        responseData: { translatedText: "Hello" },
      }),
    ]);
    const provider = createMyMemoryProvider({ fetchImpl: counter.fetch, sleepImpl: noSleep });

    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(outcome.ok && outcome.value.text).toBe("Hello");
    expect(counter.calls).toBe(2);
  });

  it("الفشل المتكرّر يُسلّم بعد محاولتين لا ثلاث", async () => {
    const counter = countingFetch([
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
      jsonResponse({ responseStatus: 200, responseData: { translatedText: "لن يُقرأ" } }),
    ]);
    const provider = createMyMemoryProvider({ fetchImpl: counter.fetch, sleepImpl: noSleep });

    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(!outcome.ok && outcome.error.kind).toBe("provider_unavailable");
    expect(counter.calls).toBe(2);
  });

  it("انقطاع الشبكة (بلا ردّ أصلاً) يستحقّ إعادة", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse({ responseStatus: 200, responseData: { translatedText: "Hi" } });
    }) as unknown as typeof fetch;

    const provider = createMyMemoryProvider({ fetchImpl, sleepImpl: noSleep });
    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(outcome.ok && outcome.value.text).toBe("Hi");
    expect(calls).toBe(2);
  });

  it("429 لا يُعاد: من قيل له «أكثرتَ» لا يزيد", async () => {
    const counter = countingFetch([new Response("", { status: 429 })]);
    const provider = createMyMemoryProvider({ fetchImpl: counter.fetch, sleepImpl: noSleep });

    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(!outcome.ok && outcome.error.kind).toBe("rate_limited");
    expect(counter.calls).toBe(1);
  });

  it("401 لا يُعاد: مفتاح خاطئ لا يصحّ بالتكرار", async () => {
    const counter = countingFetch([new Response("", { status: 401 })]);
    const provider = createDeepLProvider("bad:fx", {
      fetchImpl: counter.fetch,
      sleepImpl: noSleep,
    });

    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(!outcome.ok && outcome.error.kind).toBe("provider_unavailable");
    expect(counter.calls).toBe(1);
  });

  it("الردّ المشوَّه لا يُعاد: المزوّد أجاب ولكن بما لا يُفهم", async () => {
    const counter = countingFetch([jsonResponse({ responseStatus: 403 })]);
    const provider = createMyMemoryProvider({ fetchImpl: counter.fetch, sleepImpl: noSleep });

    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(!outcome.ok && outcome.error.kind).toBe("bad_response");
    expect(counter.calls).toBe(1);
  });

  it("الميزانية الكلّية سقفّ لا يكسره التكرار: مهلة ضيّقة تمنع المحاولة الثانية", async () => {
    const counter = countingFetch([new Response("", { status: 503 })]);
    // 600ms ميزانية كلّية: بعد تراجع 200ms لا يبقى ما يكفي محاولة ثانية
    const provider = createMyMemoryProvider({
      fetchImpl: counter.fetch,
      sleepImpl: noSleep,
      timeoutMs: 600,
    });

    const outcome = await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(outcome.ok).toBe(false);
    expect(counter.calls).toBe(1);
  });

  it("التراجع يُنتظر فعلاً قبل المحاولة الثانية وبقدر معلوم", async () => {
    const waits: number[] = [];
    const counter = countingFetch([
      new Response("", { status: 503 }),
      jsonResponse({ responseStatus: 200, responseData: { translatedText: "Hello" } }),
    ]);
    const provider = createMyMemoryProvider({
      fetchImpl: counter.fetch,
      sleepImpl: async (ms: number) => {
        waits.push(ms);
      },
    });

    await provider.translate({ text: "مرحبا", pair: AR_EN });
    expect(waits).toEqual([TRANSLATION_RETRY_BACKOFF_MS]);
  });
});

describe("كشف اللغة", () => {
  it("يميّز الخطّ اللاتيني من العربي، ويرجّح الأردية بحروفها المنفردة", () => {
    expect(detectLanguage("I am here").language).toBe("en");
    expect(detectLanguage("أنا هنا").language).toBe("ar");
    expect(detectLanguage("میں یہاں ہوں").language).toBe("ur");
    expect(detectLanguage("   ").language).toBeNull();
  });

  it("اللغة المُعلَنة أولى من الكشف دائماً", () => {
    // من أعلن العربية وكتب بالإنجليزية مرّة لا تُغيَّر لغته من تحت يده
    expect(resolveLanguage("ar", "I am here", "ar")).toBe("ar");
    expect(resolveLanguage(null, "I am here", "ar")).toBe("en");
    expect(resolveLanguage(null, "123", "ar")).toBe("ar");
  });
});

describe("حوار اختيار اللغة", () => {
  const sender: Sender = { chatId: "700", telegramUserId: "700", languageHint: "ar" };

  function preferences(
    outcome: LanguageChangeOutcome | PortFailureError,
  ): LanguagePreferencePort & { readonly written: string[] } {
    const written: string[] = [];
    return {
      written,
      setLanguage: async (_telegramId, language) => {
        if (outcome instanceof PortFailureError) return err(outcome);
        written.push(language);
        return ok(outcome);
      },
      getLanguage: async () => ok(null),
    };
  }

  it("القائمة تُعرض بلغة المستخدم الحالية وفيها اللغات الثلاث", () => {
    const replies = handleLanguageCommand(sender, "en");
    expect(replies[0]?.text).toBe(translate("en", "language.choose"));
    const keyboard = replies[0]?.keyboard;
    expect(keyboard?.kind === "inline" && keyboard.rows.map((row) => row[0]?.data)).toEqual([
      "lang:ar",
      "lang:en",
      "lang:ur",
    ]);
  });

  it("التأكيد يصل باللغة الجديدة، والجلسة تُحدَّث بعد نجاح الكتابة", async () => {
    const remembered: string[] = [];
    const port = preferences({ language: "ur", changed: true, previous: "ar" });

    const replies = await handleLanguageCallback("lang:ur", sender, "ar", {
      preferences: port,
      rememberLanguage: async (_id, language) => {
        remembered.push(language);
      },
    });

    expect(port.written).toEqual(["ur"]);
    expect(remembered).toEqual(["ur"]);
    expect(replies[0]?.text).toBe(translate("ur", "language.changed", { language: "🇵🇰 اردو" }));
  });

  it("اللغة نفسها: رسالة «لم يتغيّر شيء» لا رسالة نجاح تغيير", async () => {
    const port = preferences({ language: "ar", changed: false, previous: "ar" });
    const replies = await handleLanguageCallback("lang:ar", sender, "ar", {
      preferences: port,
      rememberLanguage: async () => {},
    });
    expect(replies[0]?.text).toBe(
      translate("ar", "language.unchanged", { language: "🇸🇦 العربية" }),
    );
  });

  it("لغة غير مدعومة تُرفض قبل أي نداء قاعدة", async () => {
    const port = preferences({ language: "ar", changed: false, previous: "ar" });
    const replies = await handleLanguageCallback("lang:fr", sender, "ar", {
      preferences: port,
      rememberLanguage: async () => {},
    });
    expect(port.written).toEqual([]);
    expect(replies[0]?.text).toBe(translate("ar", "language.unsupported"));
  });

  it("فشل الكتابة يُترجَم إلى «سجّل أولاً» لا إلى عطل تقني", async () => {
    const port = preferences(new PortFailureError("rpc.set_user_language", "USER_NOT_FOUND"));
    const replies = await handleLanguageCallback("lang:en", sender, "ar", {
      preferences: port,
      rememberLanguage: async () => {},
    });
    expect(replies[0]?.text).toBe(translate("ar", "language.not_registered"));
  });

  it("الردّ يذهب للمحادثة الخاصة لا لمصدر الضغطة", async () => {
    const groupSender: Sender = { chatId: "-1009", telegramUserId: "700", languageHint: "ar" };
    const port = preferences({ language: "en", changed: true, previous: "ar" });
    const replies = await handleLanguageCallback("lang:en", groupSender, "ar", {
      preferences: port,
      rememberLanguage: async () => {},
    });
    expect(replies[0]?.chatId).toBe("700");
  });
});

describe("initialLanguageFromHint — لغةُ البدايةِ من وسمِ تلغرام", () => {
  it("يقرأُ الوسمَ الأوّلَ بحروفٍ صغيرةٍ ويرجعُ إلى العربيّةِ لما لا قاموسَ له", () => {
    expect(initialLanguageFromHint("ur")).toBe("ur");
    expect(initialLanguageFromHint("en-GB")).toBe("en");
    expect(initialLanguageFromHint("en_us")).toBe("en");
    expect(initialLanguageFromHint("AR")).toBe("ar");
    expect(initialLanguageFromHint("fr")).toBe("ar");
    expect(initialLanguageFromHint("")).toBe("ar");
    expect(initialLanguageFromHint(undefined)).toBe("ar");
    expect(initialLanguageFromHint(null)).toBe("ar");
  });
});
