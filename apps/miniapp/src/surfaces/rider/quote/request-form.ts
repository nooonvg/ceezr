/**
 * الغرض: `WR-17` — حكمُ نموذجِ الطلبِ الواحدِ نقيًّا: من حقولِ النموذجِ (الخدمةُ المختارةُ في الرئيسية،
 *   والمكانانِ المؤكَّدان، وسياسةُ السعرِ الثلاثيّة، والملاحظةُ أو وصفُ الطرد، ووقتُ الحضور) إلى
 *   **نيّةِ طلبٍ واحدة** تُسلَّمُ إلى `SearchScreen`، أو إلى خطأِ حقلٍ بعينِه يُعرَضُ قبلَ الإرسال.
 * الحالة: منفّذ فعلياً — `WR-17` (ADR 0272).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `QuoteScreen.tsx` (زرُّ الإرسالِ الوحيد)، ويُقاسُ مباشرةً في `wr-17-single-request-form.test.tsx`.
 *
 * لماذا ملفٌّ نقيّ: المستودعُ بلا بيئةِ DOM، فالنقرُ لا يُحاكى. والحكمُ الذي كانَ مدفونًا في معالجِ
 * زرِّ كلِّ بطاقةِ خدمةٍ («اطلب هذه الخدمة») صارَ دالّةً واحدةً، فيُختبَرُ كلُّ فرعٍ منه كما يجري
 * عندَ الضغطِ حرفًا. ولا قاعدةَ جديدةَ ههنا: `offerPolicyFrom` و`pickupAtFrom` و`parcelValidationError`
 * و`readRideNotes` هيَ نفسُها، وترتيبُ الفحصِ نفسُه (الطردُ ← السعرُ ← وقتُ الحضور).
 */

import { readRideNotes } from "../../../../../../packages/domain/transport/ride-request.ts";
import type { PlaceWire } from "../destination/destination-view.ts";
import {
  offerPolicyFrom,
  parcelValidationError,
  pickupAtFrom,
  type QuoteOfferMode,
} from "./quote-view.ts";

export type RequestService = "transport" | "delivery";

export interface RequestFormInput {
  readonly service: RequestService;
  readonly origin: { readonly lat: number; readonly lng: number };
  readonly destination: {
    readonly lat: number;
    readonly lng: number;
    /** وصفُ العرض (قد يكونُ «نقطة بلا اسم»). */
    readonly label: string;
    /** الاسمُ الذي كتبَه الراكبُ أو اختارَه — يُرسَلُ بدلَ وصفِ العرض إن وُجد. */
    readonly userLabel: string | null;
    readonly place: PlaceWire | null;
  };
  readonly pickup: { readonly label: string | null; readonly place: PlaceWire | null };
  readonly notes: string;
  readonly offerMode: QuoteOfferMode;
  readonly offerText: string;
  readonly pickupMode: "now" | "later";
  readonly pickupClock: string;
  readonly idempotencyKey: () => string;
  readonly now?: Date;
}

export interface RequestIntent {
  readonly service: RequestService;
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
  readonly destinationLabel: string;
  readonly pickupLabel: string | null;
  readonly destinationUserLabel: string | null;
  readonly pickupPlace: PlaceWire | null;
  readonly dropoffPlace: PlaceWire | null;
  readonly notes: string | null;
  readonly idempotencyKey: string;
  readonly pickupAt: string | null;
  readonly offerSar: number | null;
  readonly offerMode: QuoteOfferMode;
}

export type RequestFormVerdict =
  | { readonly ok: true; readonly intent: RequestIntent }
  | { readonly ok: false; readonly field: "parcel"; readonly errorKey: string }
  | { readonly ok: false; readonly field: "offer"; readonly error: "required" | "invalid" }
  | { readonly ok: false; readonly field: "pickupAt" }
  | { readonly ok: false; readonly field: "notes" };

/**
 * يحكمُ النموذجَ كلَّه مرّةً واحدةً عندَ الضغط. ومفتاحُ التكرارِ يُولَّدُ **بعدَ** نجاحِ الحكمِ
 * وحدَه: نيّةٌ واحدةٌ لكلِّ ضغطةٍ ناجحة، تُعادُ في كلِّ محاولةٍ داخلَ `SearchScreen` (`ARCH-006`).
 */
export function judgeRequestForm(input: RequestFormInput): RequestFormVerdict {
  // وصفُ الطردِ اختياريّ (`WR-18`): يُحاكَمُ ما كُتِبَ في التوصيلِ ولا يُلزَمُ الفارغ.
  if (input.service === "delivery" && input.notes.trim() !== "") {
    const error = parcelValidationError(input.notes);
    if (error !== null) return { ok: false, field: "parcel", errorKey: error.errorKey };
  }
  const offer = offerPolicyFrom(input.offerMode, input.offerText);
  if (!offer.ok) return { ok: false, field: "offer", error: offer.error };
  const pickupAt = input.pickupMode === "later" ? pickupAtFrom(input.pickupClock, input.now) : null;
  // `WR-06`: «في وقت محدّد» بلا وقتٍ يُقرأ لا يُرسَلُ «الآن» صامتًا.
  if (input.pickupMode === "later" && pickupAt === null) return { ok: false, field: "pickupAt" };
  const read = readRideNotes(input.notes);
  // الحقلُ مقيَّدٌ بـ`maxLength`، فهذا لا يقعُ من لوحةِ المفاتيح؛ وإن وقعَ (لصقٌ عبرَ جسرٍ) فلا يُطوى صامتًا.
  if (!("notes" in read)) return { ok: false, field: "notes" };
  return {
    ok: true,
    intent: {
      service: input.service,
      originLat: input.origin.lat,
      originLng: input.origin.lng,
      destinationLat: input.destination.lat,
      destinationLng: input.destination.lng,
      destinationLabel: input.destination.label,
      pickupLabel: input.pickup.label,
      destinationUserLabel: input.destination.userLabel,
      pickupPlace: input.pickup.place,
      dropoffPlace: input.destination.place,
      notes: read.notes,
      idempotencyKey: input.idempotencyKey(),
      pickupAt,
      offerSar: offer.offerSar,
      offerMode: offer.offerMode,
    },
  };
}

/** نصّا حقلِ الملاحظةِ بحسبِ الخدمةِ المختارة: الخدمةُ معلومةٌ فلا حقلَ «محايد» ولا تلميحَ «في التوصيل…». */
export function notesFieldFor(service: RequestService): {
  readonly label: string;
  readonly placeholder: string;
} {
  return service === "delivery"
    ? { label: "rider.quote.parcel.label", placeholder: "rider.quote.parcel.placeholder" }
    : { label: "rider.quote.notes.label", placeholder: "rider.quote.notes.placeholder" };
}
