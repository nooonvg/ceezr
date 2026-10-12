/**
 * الغرض: `WR-05` — الاستثناءُ **الضيّقُ** الوحيدُ من معاجمِ المالِ في حواجزِ سطوحِ السائقِ
 *   والراكب (`driver-job` · `driver-offers` · `active-ride`): نصوصُ معنى المبلغِ الذي **كتبَه
 *   الراكبُ بنفسِه** كما أمرَ بها المالكُ حرفاً (أمرُ التنفيذ الملزم §5):
 *   «سعر محدد — غير قابل للتفاوض» · «السعر قابل للتفاوض» · «السعر غير محدد — اتفق مع طالب
 *   الخدمة عبر المحادثة».
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: scripts/lib
 * الحاكم: `docs/adr/0264-rider-offer-mode.md` (يُضيِّقُ `ADR 0039` §4 ولا يُلغيه).
 *
 * والضيقُ في ثلاثة:
 *   ١) مفاتيحُ بعينِها لا بادئة — مفتاحٌ جديدٌ يذكرُ مالاً يسقطُ كما كان.
 *   ٢) مفرداتٌ بعينِها (السعر · ريال · price · SAR · amount) — «أجرة» و«عمولة» و«محفظة»
 *      و«payment» و«wallet» تبقى ممنوعةً حتّى في هذه المفاتيح.
 *   ٣) الشيفرةُ لا تُستثنى: مُعرِّفاتُها بمفردةِ «offer» القائمةِ منذ `ORDER-OFFER-01`.
 * فلا تحسبُ المنصّةُ مبلغاً ولا تقترحُه ولا تُحصّلُه — والحواجزُ تبقى تحرسُ ذلك.
 */

export const RIDER_OFFER_TERMS_KEYS: ReadonlySet<string> = new Set([
  "driver.offers.terms.fixed",
  "driver.offers.terms.suggested",
  "driver.offers.terms.open",
  "driver.job.chat.offerFixed",
  "driver.job.chat.offerSuggested",
  "driver.job.chat.offerOpen",
  "rider.active.chat.offerFixed",
  "rider.active.chat.offerSuggested",
  "rider.active.chat.offerOpen",
]);

/** ما يُمحى من نصِّ المفتاحِ المستثنى وحدَه قبلَ القياس — والباقي يُقاسُ كما كان. */
const ALLOWED_TOKENS: readonly RegExp[] = [
  /\{amount\}/gi,
  /السعر/g,
  /سعر/g,
  /ريال/g,
  /\bprice\b/gi,
  /\bSAR\b/gi,
  /\bamount\b/gi,
  /قیمت/g,
  /ریال/g,
];

export function withoutRiderOfferTerms(key: string, value: string): string {
  if (!RIDER_OFFER_TERMS_KEYS.has(key)) return value;
  let out = value;
  for (const token of ALLOWED_TOKENS) out = out.replace(token, " ");
  return out;
}
