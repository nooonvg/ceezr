/**
 * الغرض: `WR-21` (ADR 0282) — حكمُ الخادمِ على بايتاتِ وثيقةِ السائقِ المرفوعةِ فعلًا، لا على ما أعلنَه
 *   العميلُ عندَ طلبِ الخانة. النوعُ من رأسِ الملفّ، والسلامةُ من ذيلِه، والحجمُ من المخزن.
 * ينتمي إلى: packages/domain/driver
 * يُستخدم من: `packages/application/driver/driver-documents.ts` (`recordDriverDocument`).
 *
 * الأنواعُ والسقفُ هنا **حدٌّ أعلى ثابت** يطابقُ إعدادَ الدلوِ `driver-documents` (jpeg/png/pdf · 5MB)؛
 * وإعدادُ المدينةِ (`driver_document_max_bytes`) يبقى الحكمَ عندَ طلبِ الخانةِ ولا يتجاوزُ هذا السقف.
 */

export type DriverDocumentMime = "image/jpeg" | "image/png" | "application/pdf";

export const DRIVER_DOCUMENT_CONTENT_TYPES: readonly DriverDocumentMime[] = Object.freeze([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);
/** سقفُ الدلو: 5 MiB. */
export const DRIVER_DOCUMENT_HARD_MAX_BYTES = 5 * 1024 * 1024;
export const DRIVER_DOCUMENT_HEAD_BYTES = 16;
/** ذيلُ PDF قد يحملُ أسطرًا بعدَ `%%EOF`، فيُقرأُ منه ما يتّسع لها. */
export const DRIVER_DOCUMENT_TAIL_BYTES = 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_IEND = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

function endsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  const o = bytes.length - sig.length;
  return sig.every((b, i) => bytes[o + i] === b);
}

/** النوعُ من البايتاتِ الأولى وحدَها، أو null. */
export function sniffDriverDocumentMime(head: Uint8Array): DriverDocumentMime | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, PNG_SIGNATURE)) return "image/png";
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/** علامةُ النهايةِ الصحيحةُ للنوع: ملفٌّ مقطوعٌ أو تالفٌ لا يحملُها. */
function hasValidEnding(mime: DriverDocumentMime, tail: Uint8Array): boolean {
  if (mime === "image/jpeg") {
    // FF D9، وقد تليهِ حشوةُ أصفارٍ من بعضِ الكاميرات.
    let end = tail.length;
    while (end > 0 && tail[end - 1] === 0x00) end -= 1;
    return end >= 2 && tail[end - 2] === 0xff && tail[end - 1] === 0xd9;
  }
  if (mime === "image/png") return endsWith(tail, PNG_IEND);
  const text = new TextDecoder("latin1").decode(tail);
  return text.includes("%%EOF");
}

export type DriverDocumentContentRejection =
  | "SIZE_INVALID"
  | "FILE_TOO_LARGE"
  | "CONTENT_TYPE_NOT_ALLOWED"
  | "FILE_CONTENT_INVALID";

export type DriverDocumentContentVerdict =
  | { readonly ok: true; readonly mime: DriverDocumentMime }
  | { readonly ok: false; readonly reason: DriverDocumentContentRejection };

export interface DriverDocumentContentSample {
  /** الحجمُ كما يقولُه المخزن، لا العميل. */
  readonly sizeBytes: number;
  readonly head: Uint8Array;
  readonly tail: Uint8Array;
}

export function verifyDriverDocumentContent(
  sample: DriverDocumentContentSample,
): DriverDocumentContentVerdict {
  if (!Number.isInteger(sample.sizeBytes) || sample.sizeBytes <= 0) {
    return { ok: false, reason: "SIZE_INVALID" };
  }
  if (sample.sizeBytes > DRIVER_DOCUMENT_HARD_MAX_BYTES) {
    return { ok: false, reason: "FILE_TOO_LARGE" };
  }
  const mime = sniffDriverDocumentMime(sample.head);
  if (mime === null) return { ok: false, reason: "CONTENT_TYPE_NOT_ALLOWED" };
  if (!hasValidEnding(mime, sample.tail)) return { ok: false, reason: "FILE_CONTENT_INVALID" };
  return { ok: true, mime };
}
