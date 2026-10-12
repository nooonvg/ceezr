/**
 * الغرض: `ORDER-TERMS-01` — سطورُ شروطِ الطلبِ على كلِّ بطاقةٍ (العرضُ الخاصُّ للمشتركِ،
 *   وبطاقةُ قروبِ غيرِ المشتركينَ): وقتُ حضورِ السائقِ، ونوعُ الطردِ في التوصيلِ. صياغةٌ
 *   واحدةٌ في مكانٍ واحدٍ فلا تختلفُ البطاقتانِ.
 *   و`ORDER-OFFER-01`: سطرُ «المدفوع» — ما يكتبُه الراكبُ بنفسِه أو «قابلٌ للتفاوض». المنصّةُ
 *   لا تحسبُه ولا تُحصّلُه (DEC-11 §١)، فليس آليّةَ أجرةٍ (`ADR 0039`).
 * الحالة: منفّذ فعلياً — 2026-10-03.
 * ينتمي إلى: shared
 * ملاحظات: الوقتُ يُعرَضُ بتوقيتِ السعوديّةِ (كلُّ مدنِ الخدمةِ فيها) بنظامِ ١٢ ساعةً وص/م.
 */

/** ما يعرضُه الراكبُ على السائقِ. كلُّ حقلٍ غائبٍ له معنىً مُعلَنٌ لا فراغٌ. */
export interface OrderTerms {
  /** وقتُ حضورِ السائقِ — `null` ⇒ «الآن». */
  readonly pickupAt: Date | null;
  /** نوعُ الطردِ في التوصيلِ — `null` ⇒ «لم يُحدَّد». يُتجاهَلُ في النقلِ. */
  readonly parcel: string | null;
  /**
   * `ORDER-OFFER-01` — ما يعرضُه الراكبُ بالريال؛ `null` ⇒ «قابلٌ للتفاوض». غائبٌ (`undefined`)
   * ⇒ لا سطرَ — مسارٌ لم يقرأ العمودَ بعدُ.
   */
  readonly offerSar?: number | null;
  /**
   * `WR-05` — سياسةُ المبلغِ التي اختارَها الراكب: `fixed` (محدَّدٌ غيرُ قابلٍ للتفاوض)،
   * `suggested` (مقترَحٌ قابلٌ للتفاوض)، `open` (بلا مبلغ). `null`/غائبٌ ⇒ طلبٌ أقدمُ من
   * السياسةِ فيُقرأُ المبلغُ بنصِّه القديم.
   */
  readonly offerMode?: OfferMode | null;
}

/** `WR-05` — الحالاتُ الثلاثُ لا رابعَ لها، ولا يُخلَطُ «محدَّدٌ» بـ«بلا مبلغ». */
export const OFFER_MODES = ["fixed", "suggested", "open"] as const;
export type OfferMode = (typeof OFFER_MODES)[number];

export function isOfferMode(value: unknown): value is OfferMode {
  return typeof value === "string" && (OFFER_MODES as readonly string[]).includes(value);
}

/**
 * سطرُ المبلغِ ومعناه — واحدٌ للبوتِ والمجموعةِ (وMini App يقرأُ المفاتيحَ نفسَها
 * بمعناها). لا يُوهِمُ بأنَّ المنصّةَ فرضَت المبلغَ أو تضمنُ تحصيلَه.
 */
export function offerTermLine(
  tr: Translate,
  offerMode: OfferMode | null | undefined,
  offerSar: number | null,
): string {
  if (offerMode === "open") return tr("driver.offer_card_terms_open");
  if (offerMode === "fixed" && offerSar !== null) {
    return tr("driver.offer_card_terms_fixed", { amount: offerSar });
  }
  if (offerMode === "suggested" && offerSar !== null) {
    return tr("driver.offer_card_terms_suggested", { amount: offerSar });
  }
  // طلبٌ أقدمُ من `WR-05`: النصُّ القديمُ كما كانَ حرفاً.
  return offerSar === null
    ? tr("driver.offer_card_paid_negotiable")
    : tr("driver.offer_card_paid", { amount: offerSar });
}

/** المنطقةُ الزمنيّةُ لعرضِ الوقتِ: مدنُ الخدمةِ كلُّها في السعوديّةِ (UTC+3 بلا توقيتٍ صيفيٍّ). */
export const ORDER_TERMS_TIME_ZONE = "Asia/Riyadh";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** «1:30 م» — الساعةُ والدقائقُ بتوقيتِ الرياضِ ولاحقةُ ص/م من القاموسِ. */
export function formatPickupClock(at: Date | number, tr: Translate): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ORDER_TERMS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const suffix = period.toUpperCase().startsWith("A") ? tr("common.time_am") : tr("common.time_pm");
  return `${hour}:${minute} ${suffix}`;
}

/** يومُ اللحظةِ بتوقيتِ الرياض «YYYY-MM-DD» — للمقارنةِ لا للعرض. */
function riyadhDay(at: Date | number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ORDER_TERMS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * `WR-06` — الموعدُ بيومِه: «1:30 م» لليوم، و«غدًا 1:30 م»، و«15/10 1:30 م» لما بعدَه.
 * المجدولُ قد يبعدُ أيّامًا (حتّى 14)، والساعةُ وحدَها تُقرأُ «اليوم» خطأً.
 */
export function formatPickupMoment(at: Date | number, now: Date | number, tr: Translate): string {
  const clock = formatPickupClock(at, tr);
  const day = riyadhDay(at);
  if (day === riyadhDay(now)) return clock;
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (day === riyadhDay(nowMs + 24 * 60 * 60 * 1000)) {
    return tr("common.tomorrow_at", { time: clock });
  }
  const [, month, date] = day.split("-");
  return tr("common.date_at", { date: `${Number(date)}/${Number(month)}`, time: clock });
}

/** «المدفوع» ثمَّ الوقتُ (ثمَّ الطردُ في التوصيلِ) — بترتيبِ عيّنةِ المالكِ. */
export function orderTermsLines(
  tr: Translate,
  service: string | null,
  terms: OrderTerms,
): readonly string[] {
  const lines: string[] = [];
  if (terms.offerSar !== undefined) {
    lines.push(offerTermLine(tr, terms.offerMode, terms.offerSar));
  }
  lines.push(
    terms.pickupAt === null
      ? tr("driver.offer_card_pickup_now")
      : tr("driver.offer_card_pickup_at", { time: formatPickupClock(terms.pickupAt, tr) }),
  );
  if (service === "delivery") {
    const parcel = terms.parcel?.trim() ?? "";
    lines.push(
      parcel === ""
        ? tr("driver.offer_card_parcel_none")
        : tr("driver.offer_card_parcel", { parcel }),
    );
  }
  return lines;
}
