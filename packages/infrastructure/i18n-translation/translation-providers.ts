/**
 * الغرض: مزوّدات الترجمة الآلية الحقيقية عبر HTTP، كلٌّ منها ينفّذ المنفذ نفسه
 *   فيصير تبديل المزوّد متغيّرَ بيئة لا تعديلَ كود.
 * الحالة: منفّذ فعلياً ومُختبَر على شبكة حقيقية — المرحلة 2.6.
 * ينتمي إلى: infrastructure/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts، apps/workers
 * ملاحظات مستقبلية: إضافة مزوّد جديد = دالّة واحدة هنا وسطر في المصنع، لا أكثر.
 */

import type {
  TranslationProvider,
  TranslationRequest,
  TranslationSuccess,
} from "../../application/i18n-translation/index.ts";
import { TranslationFailure } from "../../domain/i18n-translation/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import { createGuardedFetch, type FetchLike } from "../../shared/wasla/egress-gate.ts";

/** مهلة تقنية: محادثة بين سائق وعميل في الشارع لا تحتمل انتظار مزوّد بطيء. */
export const TRANSLATION_TIMEOUT_MS = 4000;

/**
 * تراجع قصير قبل المحاولة الثانية والأخيرة. قصيرٌ عمداً: عطل الشبكة العابر يزول في
 * أجزاء الثانية، وما لم يزل فيها لن يزول في ثانية أيضاً — والعميل ينتظر ردّاً.
 */
export const TRANSLATION_RETRY_BACKOFF_MS = 200;

/** أقلّ ما يستحقّ أن تُبدأ به محاولة: ما دون ذلك يُهدر ولا يُنتج. */
const MIN_ATTEMPT_BUDGET_MS = 500;

/** محاولتان لا أكثر: الأولى، ثم واحدة بعد التراجع. */
const MAX_ATTEMPTS = 2;

export interface HttpTranslationOptions {
  readonly timeoutMs?: number;
  /** يُحقن في الاختبار ليُثبَّت السلوك بلا شبكة. */
  readonly fetchImpl?: typeof fetch;
  /** يُحقن في الاختبار ليُثبَّت التراجع بلا انتظار حقيقي. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

type ProviderResult = Promise<Result<TranslationSuccess, TranslationFailure>>;

/** يحذفُ الروابطَ وسلاسلَ الاستعلامِ من نصِّ الخطأ — لا نصَّ محادثةٍ في السجلّ. */
export function scrubDetail(detail: string): string {
  return detail.replace(/https?:\/\/\S+/giu, "<url>").replace(/[?&]q=\S*/giu, "<query>");
}

/** حدُّ MyMemory المعلَنُ للنصِّ الواحد: 500 بايت UTF-8. ما فوقَه يُرَدُّ بلا نداء. */
export const MYMEMORY_MAX_QUERY_BYTES = 500;

/**
 * محاولة واحدة: نداء واحد بميزانية زمنية محدَّدة. لا تعرف شيئاً عن الإعادة.
 */
async function attemptJson(
  name: string,
  url: string,
  init: RequestInit,
  budgetMs: number,
  doFetch: FetchLike,
): Promise<Result<unknown, TranslationFailure>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), budgetMs);

  try {
    const response = await doFetch(url, { ...init, signal: controller.signal });

    if (response.status === 429) {
      return err(new TranslationFailure("rate_limited", name, `HTTP ${response.status}`));
    }
    if (!response.ok) {
      return err(new TranslationFailure("provider_unavailable", name, `HTTP ${response.status}`));
    }

    // ردٌّ بحالةِ 200 ليس JSON (صفحةُ خطأٍ HTML من وسيطٍ مثلًا) ردٌّ مشوَّهٌ لا انقطاع: إعادتُه
    // تستهلكُ الحصّةَ مرّةً ثانيةً على الجوابِ نفسِه (ADR 0277).
    const body = await response.text();
    try {
      return ok(JSON.parse(body) as unknown);
    } catch {
      return err(new TranslationFailure("bad_response", name, "non_json_body"));
    }
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    // رسالةُ الخطأِ قد تحملُ الرابطَ كاملًا، وفي رابطِ MyMemory نصُّ المحادثةِ نفسُه (`q=`):
    // يُحذَفُ قبلَ أن يصلَ السجلّ (ADR 0277).
    const detail = scrubDetail(error instanceof Error ? error.message : String(error));
    return err(new TranslationFailure(isAbort ? "timeout" : "provider_unavailable", name, detail));
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ما يستحقّ محاولةً ثانية وما لا يستحقّ — والتمييز مقصود لا كسل:
 *
 *   * `provider_unavailable` مع رمز 5xx أو بلا رمز (انقطاع شبكة، اتصال مرفوض):
 *     عطل عابر بطبيعته، وإعادة المحاولة هي بالضبط ما يُصلحه.
 *   * `provider_unavailable` مع 4xx (مفتاح خاطئ 401، نداء غير صالح 400): لن يتغيّر
 *     شيء في المحاولة الثانية. إعادتها تُضاعف الكلفة وتؤخّر ردّاً محسوماً.
 *   * `rate_limited` (429): المزوّد قال صراحةً «أكثرتَ». الردّ على ذلك بنداء ثانٍ
 *     فوري إساءةٌ للمزوّد وإطالةٌ للحظر، لا علاج له.
 *   * `timeout`: يستحقّ الإعادة مبدئياً، لكنه يكون قد استهلك الميزانية كلّها عادةً
 *     فتُلغى الإعادة تلقائياً بشرط الميزانية أدناه لا باستثناء خاصّ هنا.
 */
function deservesRetry(failure: TranslationFailure): boolean {
  if (failure.kind === "timeout") return true;
  if (failure.kind !== "provider_unavailable") return false;

  const status = /HTTP (\d{3})/.exec(failure.detail)?.[1];
  if (status === undefined) return true; // عطل شبكة لا ردّ فيه
  return Number(status) >= 500;
}

/**
 * نداء المزوّد بمحاولة واحدة إضافية عند العطل العابر وحده.
 *
 * القرار الذي يستحقّ التسمية: **الميزانية الكلّية لا تتغيّر.** المهلة المُعلَنة
 * (`TRANSLATION_TIMEOUT_MS`) تبقى سقفاً لكامل العملية بمحاولتيها وتراجعها، لا سقفاً
 * لكل محاولة. لو كانت لكل محاولة لصار أسوأ انتظار للعميل الواقف في الشارع ثمانيَ
 * ثوانٍ بدل أربع — أي أن «الإصلاح» يكسر الوعد الذي بُني عليه الرقم أصلاً.
 *
 * أثر ذلك الصريح: انتهاء المهلة في المحاولة الأولى يعني عادةً ألّا تكون هناك ثانية،
 * لأن الميزانية نفدت. والمكسب الحقيقي يقع حيث يقع العطل العابر فعلاً: ردّ 503 فوري،
 * أو اتصال مرفوض، أو قطع اتصال — وكلّها تفشل في أجزاء الثانية وتترك ميزانية وافرة.
 */
/**
 * اسمُ المزوّدِ إلى معرّفِ المقصدِ في السجلِّ. و`google-web` هوَ المقصدُ نفسُه
 * (`google-translation`) لأنَّ مُدخلَه يُعلِنُ مضيفَي النهايتَينِ كلتَيهما.
 */
function translationPeerId(name: string): string {
  switch (name) {
    case "deepl":
      return "deepl-translation";
    case "google":
    case "google-web":
      return "google-translation";
    case "mymemory":
      return "mymemory-translation";
    default:
      return `unknown-translation-provider:${name}`;
  }
}

async function requestJson(
  name: string,
  url: string,
  init: RequestInit,
  options: HttpTranslationOptions,
): Promise<Result<unknown, TranslationFailure>> {
  /**
   * البوّابةُ لكلِّ مزوّدٍ بمعرّفِه لا لملفٍّ: ثلاثةُ مقاصدَ في هذا الملفِّ، ومزوّدٌ
   * لا يُعرَفُ اسمُه يُرفَضُ بـ`UNKNOWN_PEER` — فالمجهولُ لا يمرُّ (`ADR 0086`).
   */
  const doFetch = createGuardedFetch(translationPeerId(name), options.fetchImpl, {
    env: process.env,
  });
  const sleep = options.sleepImpl ?? defaultSleep;
  const totalBudget = options.timeoutMs ?? TRANSLATION_TIMEOUT_MS;
  const startedAt = Date.now();

  // المحاولة الأولى تُنفَّذ دائماً ولو كانت الميزانية المضبوطة أقصر من الحدّ الأدنى:
  // من ضبط مهلة قصيرة أراد نداءً قصيراً، لا أن يُلغى النداء. الشرط يحكم الإعادة وحدها.
  let last = await attemptJson(name, url, init, totalBudget, doFetch);

  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (last.ok || !deservesRetry(last.error)) return last;

    const remaining = totalBudget - (Date.now() - startedAt) - TRANSLATION_RETRY_BACKOFF_MS;
    if (remaining < MIN_ATTEMPT_BUDGET_MS) return last;

    await sleep(TRANSLATION_RETRY_BACKOFF_MS);
    last = await attemptJson(name, url, init, remaining, doFetch);
  }

  return last;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// ---------------------------------------------------------------------------
// DeepL — أدقّ المزوّدات للأزواج التي يدعمها، وهو المزوّد المقصود للإنتاج.
// عيبه أنه لا يدعم الأردية، فلا يصلح وحده لسوق فيه سائقون باكستانيون.
// ---------------------------------------------------------------------------
export function createDeepLProvider(
  apiKey: string,
  options: HttpTranslationOptions = {},
): TranslationProvider {
  const name = "deepl";
  // المفتاح المنتهي بـ :fx مفتاح الخطة المجانية، وله نطاق مختلف.
  const host = apiKey.endsWith(":fx") ? "api-free.deepl.com" : "api.deepl.com";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      if (request.pair.from === "ur" || request.pair.to === "ur") {
        return err(new TranslationFailure("unsupported_pair", name, "ur غير مدعومة في DeepL"));
      }

      const body = new URLSearchParams({
        text: request.text,
        source_lang: request.pair.from.toUpperCase(),
        target_lang: request.pair.to.toUpperCase(),
      });

      const payload = await requestJson(
        name,
        `https://${host}/v2/translate`,
        {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${apiKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: body.toString(),
        },
        options,
      );
      if (!payload.ok) return payload;

      const translations = (payload.value as { translations?: { text?: unknown }[] }).translations;
      const text = readString(translations?.[0]?.text);
      if (text === null) return err(new TranslationFailure("bad_response", name, "لا نصّ في الردّ"));

      return ok({ text, provider: name });
    },
  };
}

// ---------------------------------------------------------------------------
// Google Cloud Translation v2 — يدعم اللغات الثلاث جميعاً، ويحتاج مفتاحاً.
// ---------------------------------------------------------------------------
export function createGoogleTranslateProvider(
  apiKey: string,
  options: HttpTranslationOptions = {},
): TranslationProvider {
  const name = "google";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      const payload = await requestJson(
        name,
        `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: request.text,
            source: request.pair.from,
            target: request.pair.to,
            format: "text",
          }),
        },
        options,
      );
      if (!payload.ok) return payload;

      const translations = (
        payload.value as { data?: { translations?: { translatedText?: unknown }[] } }
      ).data?.translations;
      const text = readString(translations?.[0]?.translatedText);
      if (text === null) return err(new TranslationFailure("bad_response", name, "لا نصّ في الردّ"));

      return ok({ text: decodeHtmlEntities(text), provider: name });
    },
  };
}

/**
 * Google v2 يعيد النصّ مُرمَّزاً بكيانات HTML حتى مع format=text في بعض الحالات.
 * عرض `&#39;` للمستخدم عيبٌ ظاهر، وفكّه هنا أرخص من فكّه في كل نقطة عرض.
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

// ---------------------------------------------------------------------------
// MyMemory — مزوّد حقيقي بخطّة مجانية موثَّقة بلا مفتاح، يدعم الأزواج الثلاثة.
// كمّه اليومي محدود، فهو مزوّد التطوير والتحقّق لا مزوّد الإنتاج تحت حمل.
// ---------------------------------------------------------------------------
export function createMyMemoryProvider(
  options: HttpTranslationOptions & { readonly contactEmail?: string } = {},
): TranslationProvider {
  const name = "mymemory";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      // المزوّدُ يردُّ «QUERY LENGTH LIMIT EXCEEDED» على ما فوقَ حدِّه — نداءٌ ضائعٌ من الحصّة.
      if (new TextEncoder().encode(request.text).length > MYMEMORY_MAX_QUERY_BYTES) {
        return err(new TranslationFailure("unsupported_pair", name, "query_too_long"));
      }
      const params = new URLSearchParams({
        q: request.text,
        langpair: `${request.pair.from}|${request.pair.to}`,
      });
      // البريد يرفع الحصّة اليومية في شروط المزوّد المعلنة.
      if (options.contactEmail !== undefined) params.set("de", options.contactEmail);

      const payload = await requestJson(
        name,
        `https://api.mymemory.translated.net/get?${params.toString()}`,
        { method: "GET" },
        options,
      );
      if (!payload.ok) return payload;

      const parsed = payload.value as {
        responseStatus?: unknown;
        quotaFinished?: unknown;
        responseData?: { translatedText?: unknown };
      };

      // نفادُ الحصّةِ يأتي بثلاثِ صورٍ موثَّقة: الرايةُ، أو `responseStatus` 429، أو جملةُ
      // «MYMEMORY WARNING» في حقلِ الترجمةِ نفسِه بحالةِ 200 — والأخيرةُ لو مرّت لعُرِضَت ترجمةً.
      const warned =
        typeof parsed.responseData?.translatedText === "string" &&
        /^\s*MYMEMORY WARNING/i.test(parsed.responseData.translatedText);
      if (
        parsed.quotaFinished === true ||
        parsed.responseStatus === 429 ||
        parsed.responseStatus === "429" ||
        warned
      ) {
        return err(new TranslationFailure("rate_limited", name, "انتهت الحصّة اليومية"));
      }
      if (parsed.responseStatus !== 200 && parsed.responseStatus !== "200") {
        return err(
          new TranslationFailure("bad_response", name, `responseStatus=${parsed.responseStatus}`),
        );
      }

      const text = readString(parsed.responseData?.translatedText);
      if (text === null) return err(new TranslationFailure("bad_response", name, "لا نصّ في الردّ"));

      // المزوّد يعيد رسائل خطأ داخل حقل الترجمة نفسه بحروف كبيرة — تُلتقط هنا
      // لئلّا تصل المستخدمَ رسالةٌ إنجليزية غاضبة بدل ترجمة رسالة صاحبه.
      if (/^[A-Z '.]+$/.test(text) && text.includes("INVALID")) {
        return err(new TranslationFailure("unsupported_pair", name, text));
      }

      return ok({ text, provider: name });
    },
  };
}

// ---------------------------------------------------------------------------
// google-web — نقطة الترجمة المجانية التي يستعملها موقع ترجمة جوجل نفسه، بلا مفتاح.
//
// ⚠️ للتطوير والتحقّق فقط، ولا يجوز ضبطها في الإنتاج. سببان لا واحد:
//   (1) نقطة غير موثَّقة رسمياً، فصيغة ردّها قد تتغيّر بلا إشعار ولا نسخة API تحميها.
//   (2) استعمالها آلياً تحت حمل مخالفٌ لشروط الخدمة، والاعتماد عليها تجارياً
//       يعني بناء ميزة على أساس قد يُقطع في أي لحظة بلا مسار دعم.
//
// وجودها هنا مقصود ومحدود: تُثبِت أن مسار الترجمة يعمل من طرف إلى طرف بلا انتظار
// حساب مدفوع، ثم يُستبدل اسم المزوّد بـ deepl أو google قبل الإنتاج بتغيير متغيّر بيئة.
// ---------------------------------------------------------------------------
export function createGoogleWebProvider(options: HttpTranslationOptions = {}): TranslationProvider {
  const name = "google-web";

  return {
    name,
    translate: async (request: TranslationRequest): ProviderResult => {
      const params = new URLSearchParams({
        client: "gtx",
        sl: request.pair.from,
        tl: request.pair.to,
        dt: "t",
        q: request.text,
      });

      const payload = await requestJson(
        name,
        `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
        { method: "GET" },
        options,
      );
      if (!payload.ok) return payload;

      // الردّ مصفوفات متداخلة بلا أسماء حقول: المقطع الأول مصفوفة قطع، وأول عنصر
      // في كل قطعة نصّها المترجَم. النصّ الطويل يُقسَّم قطعاً فتُوصَل هنا بالترتيب.
      const segments = (payload.value as unknown[])[0];
      if (!Array.isArray(segments)) {
        return err(new TranslationFailure("bad_response", name, "لا مصفوفة قطع في الردّ"));
      }

      const text = segments
        .map((segment) => (Array.isArray(segment) ? readString(segment[0]) : null))
        .filter((piece): piece is string => piece !== null)
        .join("");

      if (text.trim() === "") {
        return err(new TranslationFailure("bad_response", name, "قطع فارغة"));
      }

      return ok({ text, provider: name });
    },
  };
}

export type TranslationProviderName = "deepl" | "google" | "google-web" | "mymemory" | "none";

export interface TranslationProviderConfig {
  readonly provider: TranslationProviderName;
  readonly apiKey?: string;
  readonly contactEmail?: string;
  readonly timeoutMs?: number;
}

/**
 * المصنع: `none` قيمة صريحة تعني «شغِّل النظام بلا ترجمة» — وهي حالة سليمة
 * لا عطل. الصمت هنا مقصود: من لا يضبط مزوّداً يجب أن يعمل نظامه، لا أن يسقط.
 */
export function createTranslationProvider(
  config: TranslationProviderConfig,
  options: HttpTranslationOptions = {},
): TranslationProvider | null {
  const shared: HttpTranslationOptions = {
    ...options,
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
  };

  switch (config.provider) {
    case "deepl":
      return config.apiKey === undefined ? null : createDeepLProvider(config.apiKey, shared);
    case "google":
      return config.apiKey === undefined
        ? null
        : createGoogleTranslateProvider(config.apiKey, shared);
    case "google-web":
      return createGoogleWebProvider(shared);
    case "mymemory":
      return createMyMemoryProvider({
        ...shared,
        ...(config.contactEmail === undefined ? {} : { contactEmail: config.contactEmail }),
      });
    default:
      return null;
  }
}
