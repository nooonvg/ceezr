/**
 * الغرض: `WR-21` (ADR 0280) — سياسةُ مرفقاتِ محادثةِ الطلب: ما يُقبَلُ من صورةٍ وفيديو وصوتٍ ووثيقة،
 *   وحدودُ حجمِ كلٍّ منها، ومسارُ الكائنِ في المخزن، ومدّةُ رابطِ القراءة، وموعدُ الحذف.
 * الحالة: منفّذٌ دالّةً نقيّةً **غيرَ موصولة** — 2026-10-13. لا مسارَ رفعٍ ولا حاويةَ في الإنتاج: الرفعُ
 *   مغلقٌ حتّى يُنسَخَ المخزنُ احتياطيًّا ويُجرَّبَ استرجاعُه (ADR 0261).
 * ينتمي إلى: domain/messaging
 * يُتوقع أن يستخدمه لاحقاً: مسارُ «إنهاءِ الرفع» في البوّابة، بعدَ أن يرفعَ العميلُ إلى رابطٍ موقَّع.
 *
 * ## لا ثقةَ بما يقولُه العميل
 *
 * الحاويةُ في Supabase تفحصُ `Content-Type` الذي يرسلُه العميلُ نفسُه، فهي لا تمنعُ ملفًّا تنفيذيًّا
 * سُمِّيَ صورة. لذا يُقرَّرُ النوعُ هنا من **البايتاتِ الأولى** للكائنِ بعدَ رفعِه، ويُقرَّرُ الحجمُ من
 * **بياناتِ المخزن** لا من الطلب. والمعلَنُ من العميلِ يُقارَنُ بهما فقط: إن خالفَهما رُفِض.
 */

export type ChatAttachmentKind = "image" | "video" | "voice" | "document";

export type ChatAttachmentMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/quicktime"
  | "audio/ogg"
  | "audio/mp4"
  | "audio/webm"
  | "application/pdf";

/** حدودُ الحجمِ بالبايت. الصوتُ رسالةٌ قصيرة، والفيديو مقطعٌ لا فيلم. */
export const CHAT_ATTACHMENT_MAX_BYTES: Readonly<Record<ChatAttachmentKind, number>> =
  Object.freeze({
    image: 5 * 1024 * 1024,
    video: 20 * 1024 * 1024,
    voice: 2 * 1024 * 1024,
    document: 10 * 1024 * 1024,
  });

export const CHAT_ATTACHMENT_KIND_OF: Readonly<Record<ChatAttachmentMime, ChatAttachmentKind>> =
  Object.freeze({
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    "video/mp4": "video",
    "video/quicktime": "video",
    "audio/ogg": "voice",
    "audio/mp4": "voice",
    "audio/webm": "voice",
    "application/pdf": "document",
  });

/** رابطُ القراءةِ الموقَّعُ يعيشُ خمسَ دقائق: يكفي لعرضِه، ولا يصلحُ رابطًا يُتداوَل. */
export const CHAT_ATTACHMENT_READ_TTL_SECONDS = 300;
/** رابطُ الرفعِ الموقَّعُ لمسارٍ واحدٍ ولدقيقتين. */
export const CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS = 120;
/** يُحذَفُ المرفقُ مع نافذةِ قراءةِ المحادثة: سبعةُ أيّامٍ بعدَ انتهاءِ الطلب (ADR 0263). */
export const CHAT_ATTACHMENT_RETENTION_DAYS_AFTER_END = 7;
/** كم بايتًا من رأسِ الكائنِ يحتاجُ الفحص. */
export const CHAT_ATTACHMENT_SNIFF_BYTES = 16;

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) if (head[offset + i] !== bytes[i]) return false;
  return true;
}

function ascii(head: Uint8Array, offset: number, text: string): boolean {
  return startsWith(
    head,
    [...text].map((c) => c.charCodeAt(0)),
    offset,
  );
}

/**
 * النوعُ من البايتاتِ الأولى، أو null إن لم يُعرَف. لا امتدادَ ولا ترويسة.
 * و`ftyp` (ISO-BMFF) يحملُ الفيديو والصوتَ كليهما، فيُفصَلُ بالعلامةِ الكبرى: `M4A ` صوت، وما سواها فيديو.
 * وWebM حاويةُ صوتٍ أو فيديو، ولا يُقبَلُ هنا إلّا صوتًا (رسالةُ صوتٍ من المتصفّح).
 */
export function sniffChatAttachmentMime(head: Uint8Array): ChatAttachmentMime | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(head, 0, "RIFF") && ascii(head, 8, "WEBP")) return "image/webp";
  if (ascii(head, 0, "%PDF-")) return "application/pdf";
  if (ascii(head, 0, "OggS")) return "audio/ogg";
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "audio/webm";
  if (ascii(head, 4, "ftyp")) {
    if (ascii(head, 8, "M4A ")) return "audio/mp4";
    if (ascii(head, 8, "qt  ")) return "video/quicktime";
    return "video/mp4";
  }
  return null;
}

export type ChatAttachmentRejection =
  | "unknown_type"
  | "declared_type_mismatch"
  | "declared_size_mismatch"
  | "empty"
  | "too_large";

export interface ChatAttachmentCheck {
  /** ما أعلنَه العميلُ عندَ طلبِ رابطِ الرفع. */
  readonly declaredMime: string;
  readonly declaredBytes: number;
  /** ما يقولُه المخزنُ بعدَ الرفع، لا العميل. */
  readonly storedBytes: number;
  /** أوّلُ `CHAT_ATTACHMENT_SNIFF_BYTES` بايتًا من الكائنِ المخزَّن. */
  readonly head: Uint8Array;
}

export type ChatAttachmentVerdict =
  | { readonly ok: true; readonly mime: ChatAttachmentMime; readonly kind: ChatAttachmentKind }
  | { readonly ok: false; readonly reason: ChatAttachmentRejection };

/** القرارُ بعدَ الرفع: يُقبَلُ الكائنُ، أو يُرفَضُ ويُحذَفُ من المخزن. */
export function verifyChatAttachment(input: ChatAttachmentCheck): ChatAttachmentVerdict {
  if (input.storedBytes <= 0) return { ok: false, reason: "empty" };
  const mime = sniffChatAttachmentMime(input.head);
  if (mime === null) return { ok: false, reason: "unknown_type" };
  if (mime !== input.declaredMime) return { ok: false, reason: "declared_type_mismatch" };
  if (input.storedBytes !== input.declaredBytes)
    return { ok: false, reason: "declared_size_mismatch" };
  const kind = CHAT_ATTACHMENT_KIND_OF[mime];
  if (input.storedBytes > CHAT_ATTACHMENT_MAX_BYTES[kind])
    return { ok: false, reason: "too_large" };
  return { ok: true, mime, kind };
}

/** قبلَ توقيعِ رابطِ الرفع: يُرَدُّ ما لا يُقبَلُ أصلًا بلا رفع. */
export function admitChatAttachmentRequest(
  declaredMime: string,
  declaredBytes: number,
):
  | { readonly ok: true; readonly kind: ChatAttachmentKind }
  | { readonly ok: false; readonly reason: ChatAttachmentRejection } {
  const kind = (CHAT_ATTACHMENT_KIND_OF as Record<string, ChatAttachmentKind | undefined>)[
    declaredMime
  ];
  if (kind === undefined) return { ok: false, reason: "unknown_type" };
  if (!Number.isInteger(declaredBytes) || declaredBytes <= 0) return { ok: false, reason: "empty" };
  if (declaredBytes > CHAT_ATTACHMENT_MAX_BYTES[kind]) return { ok: false, reason: "too_large" };
  return { ok: true, kind };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * مسارُ الكائنِ يولِّدُه الخادمُ من معرّفَين لا من اسمِ الملف: لا اسمٌ شخصيٌّ في المخزن، ولا `../`،
 * ولا تخمينٌ لمسارِ طلبٍ آخر (المعرّفُ عشوائيّ). ويُرمى الاستثناءُ على معرّفٍ غيرِ صالح لأنّه خللٌ
 * برمجيّ، لا مدخلُ مستخدم.
 */
export function chatAttachmentObjectPath(orderId: string, attachmentId: string): string {
  if (!UUID.test(orderId) || !UUID.test(attachmentId)) {
    throw new Error("chatAttachmentObjectPath: معرّفٌ غيرُ صالح");
  }
  return `orders/${orderId}/${attachmentId}`;
}

/** أيُّ مرفقٍ انتهت نافذتُه فيُحذَف: طلبٌ انتهى منذُ أكثرَ من سبعةِ أيّام. */
export function isChatAttachmentExpired(orderEndedAt: Date | null, now: Date): boolean {
  if (orderEndedAt === null) return false;
  return (
    now.getTime() - orderEndedAt.getTime() >
    CHAT_ATTACHMENT_RETENTION_DAYS_AFTER_END * 24 * 60 * 60 * 1000
  );
}

export type ChatAttachmentReadDenial = "not_party" | "other_order" | "expired" | "not_verified";

/**
 * من يقرأُ المرفق: طرفا الطلبِ وحدَهما — الراكبُ والسائقُ المسنَد — وللمرفقِ الذي ينتمي إلى الطلبِ
 * نفسِه، وما دامت نافذةُ المحادثةِ مفتوحة، وبعدَ أن قُبِلَ الكائنُ بفحصِ `verifyChatAttachment`.
 * والرابطُ الموقَّعُ لا يُوقَّعُ إلّا بعدَ هذا القرار.
 */
export function authorizeChatAttachmentRead(input: {
  readonly viewerUserId: string;
  readonly order: {
    readonly id: string;
    readonly riderUserId: string;
    readonly driverUserId: string | null;
    readonly endedAt: Date | null;
  };
  readonly attachment: { readonly orderId: string; readonly verified: boolean };
  readonly now: Date;
}): { readonly ok: true } | { readonly ok: false; readonly reason: ChatAttachmentReadDenial } {
  if (input.attachment.orderId !== input.order.id) return { ok: false, reason: "other_order" };
  const party =
    input.viewerUserId === input.order.riderUserId ||
    (input.order.driverUserId !== null && input.viewerUserId === input.order.driverUserId);
  if (!party) return { ok: false, reason: "not_party" };
  if (!input.attachment.verified) return { ok: false, reason: "not_verified" };
  if (isChatAttachmentExpired(input.order.endedAt, input.now))
    return { ok: false, reason: "expired" };
  return { ok: true };
}
