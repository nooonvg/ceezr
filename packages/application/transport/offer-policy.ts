/**
 * الغرض: `WR-05` — قاعدةٌ واحدةٌ لسياسةِ المبلغِ في كلِّ مساراتِ إنشاءِ الطلب
 *   (`/v1/rides` و`/v1/deliveries` والبوت): ثلاثُ حالاتٍ، والمُدخلُ المعطوبُ يُرفَضُ
 *   برمزٍ ولا يتحوّلُ صامتاً إلى «بلا مبلغ».
 * الحالة: منفّذ فعلياً.
 * ينتمي إلى: packages/application/transport
 * الحاكم: خارطةُ التنفيذ §5 · `docs/adr/0264-rider-offer-mode.md`.
 *
 * | الحالة       | المبلغ                 | ما يراه السائق                                   |
 * |--------------|------------------------|--------------------------------------------------|
 * | `fixed`      | إلزاميٌّ 1..10000       | «سعر محدد: X ريال — غير قابل للتفاوض»           |
 * | `suggested`  | إلزاميٌّ 1..10000       | «سعر مقترح: X ريال — السعر قابل للتفاوض»        |
 * | `open`       | ممنوعٌ                 | «السعر غير محدد — اتفق مع طالب الخدمة عبر المحادثة» |
 *
 * والعميلُ الأقدمُ من السياسةِ (لا `offerMode`): مبلغٌ صالحٌ ⇒ `suggested` (نصُّه
 * القديمُ «المدفوع: X» كانَ عرضاً قابلاً للتفاوض)، وغيابُه ⇒ `open`، ومبلغٌ معطوبٌ ⇒
 * `OFFER_AMOUNT_INVALID` — لا `null` صامتٌ يُغيِّرُ معنى الطلب (§6).
 *
 * لا تحسبُ المنصّةُ المبلغَ ولا تقترحُه ولا تُحصّلُه (DEC-11 §١ · ADR 0039).
 */

import { isOfferMode, type OfferMode } from "../../shared/order-terms/index.ts";

export const RIDER_OFFER_AMOUNT_MAX_SAR = 10_000;

export type OfferPolicyRefusal =
  | "OFFER_MODE_INVALID"
  | "OFFER_AMOUNT_REQUIRED"
  | "OFFER_AMOUNT_INVALID"
  | "OFFER_AMOUNT_UNEXPECTED";

export interface OfferPolicy {
  readonly offerMode: OfferMode;
  readonly offerSar: number | null;
}

function isBlank(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/** عددٌ صحيحٌ بالريالِ 1..10000 من رقمٍ أو نصٍّ (بالأرقامِ العربيّةِ أو الهنديّة). */
export function readOfferAmount(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const western = value
      .trim()
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
    if (!/^[0-9]{1,5}$/.test(western)) return null;
    n = Number.parseInt(western, 10);
  } else {
    return null;
  }
  if (!Number.isInteger(n) || n < 1 || n > RIDER_OFFER_AMOUNT_MAX_SAR) return null;
  return n;
}

export function readOfferPolicy(input: {
  readonly offerMode: unknown;
  readonly offerSar: unknown;
}): { readonly policy: OfferPolicy } | { readonly refusal: OfferPolicyRefusal } {
  if (isBlank(input.offerMode)) {
    if (isBlank(input.offerSar)) return { policy: { offerMode: "open", offerSar: null } };
    const amount = readOfferAmount(input.offerSar);
    if (amount === null) return { refusal: "OFFER_AMOUNT_INVALID" };
    return { policy: { offerMode: "suggested", offerSar: amount } };
  }
  if (!isOfferMode(input.offerMode)) return { refusal: "OFFER_MODE_INVALID" };
  if (input.offerMode === "open") {
    if (!isBlank(input.offerSar)) return { refusal: "OFFER_AMOUNT_UNEXPECTED" };
    return { policy: { offerMode: "open", offerSar: null } };
  }
  if (isBlank(input.offerSar)) return { refusal: "OFFER_AMOUNT_REQUIRED" };
  const amount = readOfferAmount(input.offerSar);
  if (amount === null) return { refusal: "OFFER_AMOUNT_INVALID" };
  return { policy: { offerMode: input.offerMode, offerSar: amount } };
}
