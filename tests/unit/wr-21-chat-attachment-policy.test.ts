import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  admitChatAttachmentRequest,
  authorizeChatAttachmentRead,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_READ_TTL_SECONDS,
  CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS,
  chatAttachmentObjectPath,
  isChatAttachmentExpired,
  sniffChatAttachmentMime,
  verifyChatAttachment,
} from "../../packages/domain/messaging/chat-attachment-policy.ts";

const bytes = (...parts: (number[] | string)[]): Uint8Array =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], [0, 0x10], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ");
const PDF = bytes("%PDF-1.7");
const OGG = bytes("OggS", [0, 2]);
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3]);
const MP4 = bytes([0, 0, 0, 0x18], "ftypisom");
const M4A = bytes([0, 0, 0, 0x18], "ftypM4A ");
const MOV = bytes([0, 0, 0, 0x14], "ftypqt  ");
const EXE = bytes("MZ", [0x90, 0]);
const HTML = bytes("<html><script>");

const RIDER = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const OTHER_ORDER = "55555555-5555-4555-8555-555555555555";
const ATT = "66666666-6666-4666-8666-666666666666";

describe("WR-21 — مرفقاتُ المحادثة: النوعُ من البايتات لا من العميل (ADR 0280)", () => {
  it("يتعرّفُ الأنواعَ التسعةَ من رؤوسِها", () => {
    expect(sniffChatAttachmentMime(JPEG)).toBe("image/jpeg");
    expect(sniffChatAttachmentMime(PNG)).toBe("image/png");
    expect(sniffChatAttachmentMime(WEBP)).toBe("image/webp");
    expect(sniffChatAttachmentMime(PDF)).toBe("application/pdf");
    expect(sniffChatAttachmentMime(OGG)).toBe("audio/ogg");
    expect(sniffChatAttachmentMime(WEBM)).toBe("audio/webm");
    expect(sniffChatAttachmentMime(MP4)).toBe("video/mp4");
    expect(sniffChatAttachmentMime(M4A)).toBe("audio/mp4");
    expect(sniffChatAttachmentMime(MOV)).toBe("video/quicktime");
  });
  it("ملفٌّ تنفيذيٌّ أو HTML أو رأسٌ مبتور ⇒ مجهول", () => {
    for (const head of [EXE, HTML, new Uint8Array(), bytes([0xff, 0xd8])]) {
      expect(sniffChatAttachmentMime(head)).toBeNull();
    }
  });
  it("ملفٌّ تنفيذيٌّ أعلنَه العميلُ صورة ⇒ يُرفَض", () => {
    expect(
      verifyChatAttachment({
        declaredMime: "image/jpeg",
        declaredBytes: 900,
        storedBytes: 900,
        head: EXE,
      }),
    ).toEqual({ ok: false, reason: "unknown_type" });
  });
  it("PDF أعلنَه العميلُ صورة ⇒ عدمُ تطابقِ النوع", () => {
    expect(
      verifyChatAttachment({
        declaredMime: "image/png",
        declaredBytes: 900,
        storedBytes: 900,
        head: PDF,
      }),
    ).toEqual({ ok: false, reason: "declared_type_mismatch" });
  });
  it("الحجمُ من المخزنِ لا من العميل: أعلنَ صغيرًا ورفعَ كبيرًا ⇒ يُرفَض", () => {
    const big = CHAT_ATTACHMENT_MAX_BYTES.image + 1;
    expect(
      verifyChatAttachment({
        declaredMime: "image/jpeg",
        declaredBytes: 1000,
        storedBytes: big,
        head: JPEG,
      }),
    ).toEqual({ ok: false, reason: "declared_size_mismatch" });
    expect(
      verifyChatAttachment({
        declaredMime: "image/jpeg",
        declaredBytes: big,
        storedBytes: big,
        head: JPEG,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });
  it("كائنٌ فارغٌ ⇒ يُرفَض", () => {
    expect(
      verifyChatAttachment({
        declaredMime: "image/jpeg",
        declaredBytes: 0,
        storedBytes: 0,
        head: JPEG,
      }).ok,
    ).toBe(false);
  });
  it("الحدودُ لكلِّ نوع، وحدُّ الصوتِ أصغرُها", () => {
    expect(
      verifyChatAttachment({
        declaredMime: "audio/ogg",
        declaredBytes: CHAT_ATTACHMENT_MAX_BYTES.voice,
        storedBytes: CHAT_ATTACHMENT_MAX_BYTES.voice,
        head: OGG,
      }),
    ).toEqual({ ok: true, mime: "audio/ogg", kind: "voice" });
    expect(admitChatAttachmentRequest("audio/ogg", CHAT_ATTACHMENT_MAX_BYTES.voice + 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(admitChatAttachmentRequest("video/mp4", 15 * 1024 * 1024)).toEqual({
      ok: true,
      kind: "video",
    });
    expect(admitChatAttachmentRequest("application/x-msdownload", 10).ok).toBe(false);
    expect(admitChatAttachmentRequest("image/jpeg", 1.5).ok).toBe(false);
    expect(admitChatAttachmentRequest("image/svg+xml", 10).ok).toBe(false);
  });
});

describe("WR-21 — مرفقاتُ المحادثة: من يقرأ، وإلى متى (ADR 0280)", () => {
  const now = new Date("2026-10-13T00:00:00Z");
  const order = { id: ORDER, riderUserId: RIDER, driverUserId: DRIVER, endedAt: null };
  const attachment = { orderId: ORDER, verified: true };
  it("الراكبُ والسائقُ المسنَد يقرآن", () => {
    for (const viewerUserId of [RIDER, DRIVER]) {
      expect(authorizeChatAttachmentRead({ viewerUserId, order, attachment, now }).ok).toBe(true);
    }
  });
  it("طرفٌ ثالثٌ لا يقرأ، ولا سائقٌ لم يُسنَد بعد", () => {
    expect(authorizeChatAttachmentRead({ viewerUserId: STRANGER, order, attachment, now })).toEqual(
      {
        ok: false,
        reason: "not_party",
      },
    );
    expect(
      authorizeChatAttachmentRead({
        viewerUserId: DRIVER,
        order: { ...order, driverUserId: null },
        attachment,
        now,
      }),
    ).toEqual({ ok: false, reason: "not_party" });
  });
  it("مرفقُ طلبٍ آخرَ لا يُقرأُ عبرَ هذا الطلب", () => {
    expect(
      authorizeChatAttachmentRead({
        viewerUserId: RIDER,
        order,
        attachment: { orderId: OTHER_ORDER, verified: true },
        now,
      }),
    ).toEqual({ ok: false, reason: "other_order" });
  });
  it("كائنٌ لم يجتزِ الفحصَ لا يُقرأ", () => {
    expect(
      authorizeChatAttachmentRead({
        viewerUserId: RIDER,
        order,
        attachment: { orderId: ORDER, verified: false },
        now,
      }),
    ).toEqual({ ok: false, reason: "not_verified" });
  });
  it("بعدَ سبعةِ أيّامٍ من انتهاءِ الطلب ⇒ منتهٍ ويُحذَف", () => {
    const ended = new Date(now.getTime() - 8 * 86_400_000);
    expect(isChatAttachmentExpired(ended, now)).toBe(true);
    expect(isChatAttachmentExpired(new Date(now.getTime() - 6 * 86_400_000), now)).toBe(false);
    expect(isChatAttachmentExpired(null, now)).toBe(false);
    expect(
      authorizeChatAttachmentRead({
        viewerUserId: RIDER,
        order: { ...order, endedAt: ended },
        attachment,
        now,
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });
  it("الروابطُ قصيرةُ العمر: القراءةُ 5 دقائق، والرفعُ دقيقتان", () => {
    expect(CHAT_ATTACHMENT_READ_TTL_SECONDS).toBe(300);
    expect(CHAT_ATTACHMENT_UPLOAD_TTL_SECONDS).toBe(120);
  });
  it("المسارُ من معرّفَين لا من اسمِ ملف، ويرفضُ ما ليس معرّفًا", () => {
    expect(chatAttachmentObjectPath(ORDER, ATT)).toBe(`orders/${ORDER}/${ATT}`);
    for (const bad of ["../x", "name.jpg", `${ORDER}/../`, ""]) {
      expect(() => chatAttachmentObjectPath(bad, ATT)).toThrow();
      expect(() => chatAttachmentObjectPath(ORDER, bad)).toThrow();
    }
  });
});

describe("WR-21 — لا حاويةَ عامّة ولا رفعَ مفتوح (ADR 0280)", () => {
  it("لا هجرةَ تُنشئُ حاويةً عامّة", () => {
    const dir = new URL("../../supabase/migrations/", import.meta.url);
    for (const name of readdirSync(dir)) {
      const sql = readFileSync(new URL(name, dir), "utf8").toLowerCase();
      if (!sql.includes("storage.buckets")) continue;
      expect(/insert\s+into\s+storage\.buckets[^;]*\btrue\b/s.test(sql) && /public/.test(sql)).toBe(
        false,
      );
    }
  });
  it("السياسةُ غيرُ موصولة: لا مسارَ في البوّابةِ يستوردُها بعد", () => {
    const server = readFileSync(
      new URL("../../apps/gateway/src/server.ts", import.meta.url),
      "utf8",
    );
    const index = readFileSync(new URL("../../apps/gateway/src/index.ts", import.meta.url), "utf8");
    expect(server.includes("chat-attachment-policy")).toBe(false);
    expect(index.includes("chat-attachment-policy")).toBe(false);
  });
});
