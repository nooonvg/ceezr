/**
 * الغرض: قرار الترجمة — متى تُترجَم رسالة ومتى لا تُترجَم، وكيف يُبنى مفتاح ذاكرتها،
 *   وكيف تُعرض المترجَمة بجانب أصلها. القرار كلّه هنا بلا شبكة ولا قاعدة.
 * الحالة: منفّذ فعلياً — المرحلة 2.6.
 * ينتمي إلى: domain/i18n-translation
 * يُتوقع أن يستخدمه لاحقاً: packages/application/i18n-translation
 * ملاحظات مستقبلية: كشف اللغة من النصّ نفسه (لا من إعداد المستخدم) يُضاف قراراً هنا أيضاً.
 */

import {
  type LanguagePair,
  type SupportedLanguage,
  sameLanguage,
  TRANSLATION_MAX_CHARS,
} from "./value-objects.ts";

/**
 * لماذا لم تُترجَم الرسالة. السبب يُعاد دائماً ولا يُبتلع: تمرير رسالة بلا ترجمة
 * قرارٌ يجب أن يظهر في السجلّ، وإلا صار «الترجمة لا تعمل» شكوى بلا تشخيص.
 */
export type SkipReason =
  | "same_language"
  | "empty_text"
  | "too_long"
  | "no_translatable_content"
  /** `WR-04` (ADR 0277) — النصُّ يحملُ رقمَ هاتفٍ أو بريدًا أو رابطًا: لا يُرسَلُ لمزوّدٍ خارجيّ. */
  | "sensitive_content"
  | "disabled";

export type TranslationDecision =
  | { readonly kind: "translate"; readonly text: string; readonly pair: LanguagePair }
  | { readonly kind: "skip"; readonly reason: SkipReason };

export interface DecideTranslationInput {
  readonly text: string;
  readonly pair: LanguagePair;
  /** يُطفأ حين لا يكون هناك مزوّد مضبوط — الإطفاء قرار تشغيلي لا عطل. */
  readonly enabled: boolean;
  readonly maxChars?: number;
}

/**
 * النصّ الذي لا يحمل حرفاً واحداً — رقم هاتف محجوب، أو رموز، أو أرقام فقط —
 * لا يُرسَل لمزوّد ترجمة: التكلفة والتأخير مقابل نصّ يعود كما ذهب.
 */
export function hasTranslatableContent(text: string): boolean {
  return /\p{L}/u.test(text);
}

/** الأرقامُ العربيّةُ الهنديّةُ والفارسيّةُ إلى لاتينيّة — الهاتفُ يُكتَبُ بأيٍّ منها. */
function latinDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/gu, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return String((code >= 0x06f0 ? code - 0x06f0 : code - 0x0660) % 10);
  });
}

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/u;
const LINK_PATTERN = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|sa|me|io|ly|gl)\b/iu;
/** سبعةُ أرقامٍ فأكثرُ متّصلةٌ أو مفصولةٌ بمسافةٍ أو شرطةٍ أو نقطةٍ أو قوس: رقمُ هاتفٍ أو حساب. */
const LONG_NUMBER_PATTERN = /\d(?:[\s\-.()]{0,2}\d){6,}/u;
/**
 * إحداثيّتانِ مكتوبتانِ نصًّا («21.4858, 39.1925»): كلٌّ منهما دونَ سبعةِ أرقامٍ متّصلة، والفاصلةُ
 * تقطعُ السلسلة، فكانتا تفلتانِ من النمطِ السابقِ إلى المزوّد. والفاصلةُ العشريّةُ العربيّةُ «٫»
 * والفاصلةُ «،» مقبولتان.
 */
const COORDINATE_PATTERN = /-?\d{1,3}[.٫]\d{3,}\s*[,،]\s*-?\d{1,3}[.٫]\d{3,}/u;

/**
 * `WR-04` (ADR 0277) — تقليلُ البيانات: نصُّ المحادثةِ يُرسَلُ إلى خدمةِ ترجمةٍ عامّة، فما يحملُ
 * رقمَ هاتفٍ أو بريدًا أو رابطًا يُعرَضُ بأصلِه ولا يُرسَل. الثمنُ رسالةٌ بلا ترجمة؛ والبديلُ
 * رقمُ راكبٍ في سجلِّ طرفٍ ثالث.
 */
export function hasSensitiveContent(text: string): boolean {
  const normalized = latinDigits(text);
  return (
    EMAIL_PATTERN.test(normalized) ||
    LINK_PATTERN.test(normalized) ||
    LONG_NUMBER_PATTERN.test(normalized) ||
    COORDINATE_PATTERN.test(normalized)
  );
}

export function decideTranslation(input: DecideTranslationInput): TranslationDecision {
  if (!input.enabled) return { kind: "skip", reason: "disabled" };

  const text = input.text.trim();
  if (text === "") return { kind: "skip", reason: "empty_text" };
  if (sameLanguage(input.pair)) return { kind: "skip", reason: "same_language" };
  if (!hasTranslatableContent(text)) return { kind: "skip", reason: "no_translatable_content" };
  if (hasSensitiveContent(text)) return { kind: "skip", reason: "sensitive_content" };

  const limit = input.maxChars ?? TRANSLATION_MAX_CHARS;
  if (text.length > limit) return { kind: "skip", reason: "too_long" };

  return { kind: "translate", text, pair: input.pair };
}

/**
 * مفتاح الذاكرة المؤقتة. النصّ نفسه جزء من المفتاح لأن الترجمة دالّة فيه،
 * والاتجاه جزء منه لأن ترجمة ع→إن ليست عكس إن→ع.
 */
export function translationCacheKey(pair: LanguagePair, text: string): string {
  return `${pair.from}:${pair.to}:${text.trim()}`;
}

export interface TranslatedMessage {
  /** النصّ الذي يُعرض للقارئ: المترجَم إن نجحت الترجمة، وإلا الأصل. */
  readonly text: string;
  readonly original: string;
  readonly translated: boolean;
  readonly pair: LanguagePair;
  /** سبب عدم الترجمة إن لم تُترجَم، أو null. */
  readonly skipped: SkipReason | null;
  /** اسم المزوّد الذي نفّذ الترجمة فعلاً، أو null. */
  readonly provider: string | null;
  /** هل جاءت من الذاكرة المؤقتة بلا نداء شبكة. */
  readonly cached: boolean;
}

export function untranslated(
  original: string,
  pair: LanguagePair,
  reason: SkipReason,
): TranslatedMessage {
  return {
    text: original,
    original,
    translated: false,
    pair,
    skipped: reason,
    provider: null,
    cached: false,
  };
}

/**
 * الأصل يُعرض دائماً تحت الترجمة ولا يُستبدل بها. الترجمة الآلية تخطئ،
 * ومن يعرف شيئاً من لغة الطرف الآخر يجب أن يملك تصحيح ما فهمه بنفسه —
 * ولو أخفينا الأصل لصار خطأ المزوّد خطأ الطرف في نظر القارئ.
 */
export function shouldShowOriginal(message: TranslatedMessage): boolean {
  return message.translated;
}

/** ما إذا كان طرفان يحتاجان ترجمة بينهما أصلاً — يُستعمل قبل بناء أي حوار. */
export function needsBridging(a: SupportedLanguage, b: SupportedLanguage): boolean {
  return a !== b;
}
