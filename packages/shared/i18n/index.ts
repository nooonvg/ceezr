/**
 * الغرض: محمّل قواميس الرسائل الثابتة — لا نص مكتوب مباشرة داخل كود البوتات (القسم 3.8).
 * الحالة: أساس تقني منفّذ فعلياً (تحميل وتعويض متغيّرات فقط) — خدمة الترجمة الآلية تبقى هيكلاً.
 * ينتمي إلى: shared/i18n
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/bots/*، packages/application/i18n-translation
 * ملاحظات مستقبلية: قائمة اللغات المدعومة تُقرأ لاحقاً من platform_settings لا من الكود.
 */

import ar from "./ar.json" with { type: "json" };
import en from "./en.json" with { type: "json" };
import ur from "./ur.json" with { type: "json" };

export type Dictionary = Record<string, string>;

const dictionaries: Record<string, Dictionary> = {
  ar: ar as Dictionary,
  en: en as Dictionary,
  ur: ur as Dictionary,
};

export const DEFAULT_LANGUAGE = "ar";

export function hasLanguage(lang: string): boolean {
  return Object.hasOwn(dictionaries, lang);
}

/**
 * لغةُ البدايةِ من وسمِ عميلِ تلغرام (`from.language_code`) قبلَ أن يختارَ المستخدمُ.
 * الوسمُ IETF (`ur` · `en-GB` · `pt-br`): يُقرأُ وسمُه الأوّلُ بحروفٍ صغيرةٍ، فإن كانت
 * له قاموسٌ فهو، وإلّا فالافتراضيُّ. وكان الحوارانِ يقرآنِ `en` وحدَها فيُسجَّلُ
 * صاحبُ تلغرامٍ أرديٍّ بالعربيّةِ ولا يرى لغتَه حتّى يغيّرَها يدًا.
 */
export function initialLanguageFromHint(hint: string | null | undefined): string {
  const primary = (hint ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return primary !== "" && hasLanguage(primary) ? primary : DEFAULT_LANGUAGE;
}

export function translate(
  lang: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const fallback: Dictionary = dictionaries[DEFAULT_LANGUAGE] ?? {};
  const dict = dictionaries[lang] ?? fallback;
  const template = dict[key] ?? fallback[key] ?? key;
  return template
    .replace(COUNTED, (match, name: string, forms: string) =>
      Object.hasOwn(params, name) ? (countedPhrase(Number(params[name]), forms) ?? match) : match,
    )
    .replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.hasOwn(params, name) ? paramText(dict, fallback, name, params[name]) : match,
    );
}

/**
 * `MSG-AUDIT-02` — رمزُ العملةِ يُقرأُ بلغةِ الرسالةِ: الإعدادُ `currency` يحملُ «SAR» (رمزَ
 * ISO الذي تحتاجُه بوّابةُ الدفعِ)، فكانت كلُّ رسالةٍ عربيّةٍ تقولُ «150 SAR». المعامِلُ المسمّى
 * `currency` وحدَه يُترجَمُ بمفتاحِ `common.currency_<CODE>` إن وُجِدَ، وما سواه يبقى حرفاً.
 */
function paramText(
  dict: Dictionary,
  fallback: Dictionary,
  name: string,
  value: string | number | undefined,
): string {
  const raw = String(value);
  if (name !== "currency" || raw === "") return raw;
  const key = `common.currency_${raw}`;
  return dict[key] ?? fallback[key] ?? raw;
}

/**
 * `MSG-AUDIT-01` — العددُ والمعدودُ في العربيّةِ: «3 يوماً» خطأٌ يقرؤه كلُّ سائقٍ في
 * تنبيهِ اشتراكِه. والصيغةُ `{days#يوم واحد|يومان|أيام|يوماً}` تختارُ المعدودَ بالعددِ:
 * 1 ← الأولى وحدَها · 2 ← الثانيةُ وحدَها · 3–10 ← «العددُ + الثالثةُ» · وما سواها
 * ← «العددُ + الرابعةُ». وقيمةٌ غيرُ عدديّةٍ تُبقي النصَّ كما هوَ فلا يُختلَقُ معدودٌ.
 */
const COUNTED = /\{(\w+)#([^{}]+)\}/g;

export function countedPhrase(count: number, forms: string): string | null {
  const parts = forms.split("|");
  if (parts.length !== 4 || !Number.isFinite(count)) return null;
  const [one, two, few, many] = parts as [string, string, string, string];
  if (count === 1) return one;
  if (count === 2) return two;
  const tail = Math.abs(count) % 100;
  return tail >= 3 && tail <= 10 ? `${count} ${few}` : `${count} ${many}`;
}

export function t(lang: string) {
  return (key: string, params?: Record<string, string | number>) =>
    translate(lang, key, params ?? {});
}
