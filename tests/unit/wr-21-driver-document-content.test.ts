/**
 * الغرض: `WR-21` (ADR 0282) — الخادمُ يحكمُ على بايتاتِ وثيقةِ السائقِ وحجمِها الفعليَّين لا على النوعِ
 *   المُعلَن: أنواعٌ مزيّفة، وملفّاتٌ تالفةٌ أو مقطوعة، وحدودُ الحجم، والقارئُ على السلك، والتسجيل.
 */
import { describe, expect, it, mock } from "bun:test";
import {
  type DriverDocumentDeps,
  type DriverDocumentRejection,
  recordDriverDocument,
} from "../../packages/application/driver/driver-documents.ts";
import type { ObjectContentInspector } from "../../packages/application/driver/ports.ts";
import {
  DRIVER_DOCUMENT_HARD_MAX_BYTES,
  sniffDriverDocumentMime,
  verifyDriverDocumentContent,
} from "../../packages/domain/driver/driver-document-content.ts";
import {
  HttpObjectContentInspector,
  totalFromContentRange,
} from "../../packages/infrastructure/storage/object-content-inspector.ts";
import { err, ok } from "../../packages/shared/result/index.ts";

const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

const JPEG_HEAD = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1);
const JPEG_TAIL = bytes(0x12, 0x34, 0xff, 0xd9);
const PNG_HEAD = bytes(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52,
);
const PNG_TAIL = bytes(0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82);
const PDF_HEAD = ascii("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
const PDF_TAIL = ascii("startxref\n1234\n%%EOF\n");

describe("WR-21 — النوعُ من البايتات", () => {
  it("يعرفُ JPEG وPNG وPDF من رؤوسِها", () => {
    expect(sniffDriverDocumentMime(JPEG_HEAD)).toBe("image/jpeg");
    expect(sniffDriverDocumentMime(PNG_HEAD)).toBe("image/png");
    expect(sniffDriverDocumentMime(PDF_HEAD)).toBe("application/pdf");
  });

  it("نوعٌ مزيّف: HTML وSVG وملفٌّ تنفيذيٌّ وZIP وWebP بامتدادِ صورة ⇒ CONTENT_TYPE_NOT_ALLOWED", () => {
    for (const head of [
      ascii("<!doctype html><s"),
      ascii("<svg xmlns='http:"),
      bytes(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0),
      bytes(0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
      bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0),
      ascii("RIFF\x00\x00\x00\x00WEBPVP8 "),
    ]) {
      const v = verifyDriverDocumentContent({ sizeBytes: 2048, head, tail: JPEG_TAIL });
      expect(v).toEqual({ ok: false, reason: "CONTENT_TYPE_NOT_ALLOWED" });
    }
  });

  it("رأسٌ أقصرُ من التوقيع ⇒ لا نوع", () => {
    expect(sniffDriverDocumentMime(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffDriverDocumentMime(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffDriverDocumentMime(new Uint8Array(0))).toBeNull();
  });
});

describe("WR-21 — السلامةُ من الذيل", () => {
  it("ملفّاتٌ سليمة ⇒ مقبولةٌ بنوعِها", () => {
    expect(
      verifyDriverDocumentContent({ sizeBytes: 4096, head: JPEG_HEAD, tail: JPEG_TAIL }),
    ).toEqual({ ok: true, mime: "image/jpeg" });
    expect(
      verifyDriverDocumentContent({ sizeBytes: 4096, head: PNG_HEAD, tail: PNG_TAIL }),
    ).toEqual({ ok: true, mime: "image/png" });
    expect(
      verifyDriverDocumentContent({ sizeBytes: 4096, head: PDF_HEAD, tail: PDF_TAIL }),
    ).toEqual({ ok: true, mime: "application/pdf" });
  });

  it("JPEG بحشوةِ أصفارٍ بعدَ FF D9 ⇒ سليم", () => {
    const tail = cat(JPEG_TAIL, bytes(0, 0, 0));
    expect(verifyDriverDocumentContent({ sizeBytes: 4096, head: JPEG_HEAD, tail }).ok).toBe(true);
  });

  it("رفعٌ مقطوعٌ أو تالف ⇒ FILE_CONTENT_INVALID", () => {
    const cases = [
      { head: JPEG_HEAD, tail: bytes(0x12, 0x34, 0x56, 0x78) },
      { head: PNG_HEAD, tail: bytes(0x49, 0x44, 0x41, 0x54, 1, 2, 3, 4) },
      { head: PDF_HEAD, tail: ascii("1 0 obj\n<< /Type /Page") },
      { head: JPEG_HEAD, tail: new Uint8Array(0) },
    ];
    for (const c of cases) {
      expect(verifyDriverDocumentContent({ sizeBytes: 4096, ...c })).toEqual({
        ok: false,
        reason: "FILE_CONTENT_INVALID",
      });
    }
  });

  it("رأسُ PNG بذيلِ JPEG (ملفّان مُلصَقان) ⇒ FILE_CONTENT_INVALID", () => {
    expect(
      verifyDriverDocumentContent({ sizeBytes: 4096, head: PNG_HEAD, tail: JPEG_TAIL }).ok,
    ).toBe(false);
  });
});

describe("WR-21 — الحجمُ من المخزن", () => {
  it("عندَ السقفِ تمامًا ⇒ مقبول، وفوقَه ببايتٍ ⇒ FILE_TOO_LARGE", () => {
    expect(
      verifyDriverDocumentContent({
        sizeBytes: DRIVER_DOCUMENT_HARD_MAX_BYTES,
        head: PDF_HEAD,
        tail: PDF_TAIL,
      }).ok,
    ).toBe(true);
    expect(
      verifyDriverDocumentContent({
        sizeBytes: DRIVER_DOCUMENT_HARD_MAX_BYTES + 1,
        head: PDF_HEAD,
        tail: PDF_TAIL,
      }),
    ).toEqual({ ok: false, reason: "FILE_TOO_LARGE" });
  });
  it("صفرٌ أو سالبٌ أو كسرٌ أو NaN ⇒ SIZE_INVALID", () => {
    for (const sizeBytes of [0, -1, 1.5, Number.NaN]) {
      expect(verifyDriverDocumentContent({ sizeBytes, head: PDF_HEAD, tail: PDF_TAIL })).toEqual({
        ok: false,
        reason: "SIZE_INVALID",
      });
    }
  });
  it("الحجمُ يُفحَصُ قبلَ النوع: ملفٌّ ضخمٌ مزيّفٌ يُرفَضُ بحجمِه", () => {
    expect(
      verifyDriverDocumentContent({
        sizeBytes: 50 * 1024 * 1024,
        head: ascii("<html>"),
        tail: ascii(""),
      }),
    ).toEqual({ ok: false, reason: "FILE_TOO_LARGE" });
  });
});

describe("WR-21 — القارئُ على السلك (Range)", () => {
  it("Content-Range يُقرأُ حجمُه، والصيغُ الأخرى null", () => {
    expect(totalFromContentRange("bytes 0-15/12345")).toBe(12345);
    expect(totalFromContentRange("bytes 0-15/*")).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });

  const file = cat(PDF_HEAD, new Uint8Array(3000), PDF_TAIL);
  function storage(
    body: Uint8Array,
    opts?: { ignoreRange?: boolean; status?: number; changeSize?: boolean },
  ) {
    const calls: { url: string; range: string | null; auth: string | null }[] = [];
    const fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url: String(url), range: h.get("range"), auth: h.get("authorization") });
      if (opts?.status !== undefined) return new Response(null, { status: opts.status });
      if (opts?.ignoreRange) return new Response(body, { status: 200 });
      const range = h.get("range") ?? "";
      const total = opts?.changeSize && range.startsWith("bytes=-") ? body.length + 1 : body.length;
      let slice: Uint8Array;
      const head = /^bytes=0-(\d+)$/.exec(range);
      const tail = /^bytes=-(\d+)$/.exec(range);
      if (head) slice = body.slice(0, Number(head[1]) + 1);
      else if (tail) slice = body.slice(Math.max(0, body.length - Number(tail[1])));
      else slice = body;
      const start = tail ? body.length - slice.length : 0;
      return new Response(slice, {
        status: 206,
        headers: { "content-range": `bytes ${start}-${start + slice.length - 1}/${total}` },
      });
    });
    return {
      calls,
      inspector: new HttpObjectContentInspector({
        baseUrl: "https://s.example",
        secretKey: "k",
        bucket: "driver-documents",
        fetch: fetch as never,
      }),
    };
  }

  it("يقرأُ الرأسَ والذيلَ والحجمَ بطلبَين ولا يُنزِّلُ الملفّ", async () => {
    const { calls, inspector } = storage(file);
    const r = await inspector.inspect({ objectPath: "u1/doc.pdf" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.sizeBytes).toBe(file.length);
    expect(r.value.head.length).toBe(16);
    expect(verifyDriverDocumentContent(r.value)).toEqual({ ok: true, mime: "application/pdf" });
    expect(calls.map((c) => c.range)).toEqual(["bytes=0-15", "bytes=-1024"]);
    expect(calls[0]?.url).toBe("https://s.example/storage/v1/object/driver-documents/u1/doc.pdf");
  });

  it("مخزنٌ تجاهلَ Range ⇒ يُحكَمُ على الملفِّ كلِّه بطلبٍ واحد", async () => {
    const { calls, inspector } = storage(file, { ignoreRange: true });
    const r = await inspector.inspect({ objectPath: "u1/doc.pdf" });
    expect(r.ok && r.value.sizeBytes).toBe(file.length);
    expect(calls.length).toBe(1);
  });

  it("ملفٌّ صغيرٌ يقعُ كلُّه في الرأس ⇒ طلبٌ واحد", async () => {
    const tiny = cat(bytes(0xff, 0xd8, 0xff), bytes(0xff, 0xd9));
    const { calls, inspector } = storage(tiny);
    const r = await inspector.inspect({ objectPath: "u1/a.jpg" });
    expect(r.ok && verifyDriverDocumentContent(r.value).ok).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("404 ⇒ OBJECT_NOT_FOUND، و500 أو انقطاع ⇒ INSPECTOR_UNAVAILABLE", async () => {
    expect(await storage(file, { status: 404 }).inspector.inspect({ objectPath: "x" })).toEqual(
      err("OBJECT_NOT_FOUND"),
    );
    expect(await storage(file, { status: 500 }).inspector.inspect({ objectPath: "x" })).toEqual(
      err("INSPECTOR_UNAVAILABLE"),
    );
    const down = new HttpObjectContentInspector({
      baseUrl: "https://s.example",
      secretKey: "k",
      bucket: "b",
      fetch: (async () => {
        throw new Error("down");
      }) as never,
    });
    expect(await down.inspect({ objectPath: "x" })).toEqual(err("INSPECTOR_UNAVAILABLE"));
  });

  it("تغيّرَ الحجمُ بين الطلبين ⇒ لا حكم", async () => {
    expect(
      await storage(file, { changeSize: true }).inspector.inspect({ objectPath: "x" }),
    ).toEqual(err("INSPECTOR_UNAVAILABLE"));
  });
});

describe("WR-21 — التسجيلُ مشروطٌ بالبايتات", () => {
  const record = mock(() =>
    Promise.resolve(
      ok({
        documentId: "doc-1",
        docType: "driving_license",
        status: "pending_review",
        expiresAt: "2027-01-01",
        replaced: false,
      }),
    ),
  );
  const deps = (inspector?: ObjectContentInspector) =>
    ({
      sessions: { read: mock(() => Promise.resolve(ok("123456789"))) },
      store: { record, dashboard: mock(), submitForReview: mock() },
      now: () => new Date("2026-10-13"),
      existenceChecker: { checkExists: mock(() => Promise.resolve(ok(true))) },
      ...(inspector === undefined ? {} : { contentInspector: inspector }),
    }) as unknown as DriverDocumentDeps;
  const input = {
    accessToken: "Bearer t",
    docType: "driving_license",
    objectPath: "u1/license.pdf",
    expiresAt: "2027-01-01",
  };
  const sample = (s: {
    sizeBytes: number;
    head: Uint8Array;
    tail: Uint8Array;
  }): ObjectContentInspector => ({ inspect: mock(() => Promise.resolve(ok(s))) });
  const code = async (i: ObjectContentInspector) => {
    record.mockClear();
    const r = await recordDriverDocument(deps(i), input);
    return {
      code: r.ok ? "OK" : (r.error as DriverDocumentRejection).code,
      recorded: record.mock.calls.length,
      error: r.ok ? null : (r.error as DriverDocumentRejection),
    };
  };

  it("PDF سليمٌ ⇒ يُسجَّل", async () => {
    expect(await code(sample({ sizeBytes: 4096, head: PDF_HEAD, tail: PDF_TAIL }))).toMatchObject({
      code: "OK",
      recorded: 1,
    });
  });
  it("HTML أُعلِنَ PDF ⇒ مرفوضٌ ولا يُسجَّل، ويُعادُ المسموح", async () => {
    const r = await code(
      sample({ sizeBytes: 4096, head: ascii("<html><script>x"), tail: ascii("</html>") }),
    );
    expect(r).toMatchObject({ code: "CONTENT_TYPE_NOT_ALLOWED", recorded: 0 });
    expect(r.error?.allowedContentTypes).toEqual(["image/jpeg", "image/png", "application/pdf"]);
  });
  it("فوقَ السقف ⇒ FILE_TOO_LARGE بالحدّ ولا يُسجَّل", async () => {
    const r = await code(
      sample({ sizeBytes: DRIVER_DOCUMENT_HARD_MAX_BYTES + 1, head: PDF_HEAD, tail: PDF_TAIL }),
    );
    expect(r).toMatchObject({ code: "FILE_TOO_LARGE", recorded: 0 });
    expect(r.error?.maxBytes).toBe(DRIVER_DOCUMENT_HARD_MAX_BYTES);
  });
  it("مقطوع ⇒ FILE_CONTENT_INVALID ولا يُسجَّل", async () => {
    expect(
      await code(sample({ sizeBytes: 4096, head: JPEG_HEAD, tail: bytes(1, 2, 3) })),
    ).toMatchObject({ code: "FILE_CONTENT_INVALID", recorded: 0 });
  });
  it("تعذّرَت القراءة ⇒ UPLOAD_NOT_AVAILABLE، ورفضٌ لا قبول", async () => {
    expect(
      await code({ inspect: mock(() => Promise.resolve(err("INSPECTOR_UNAVAILABLE" as const))) }),
    ).toMatchObject({ code: "UPLOAD_NOT_AVAILABLE", recorded: 0 });
    expect(
      await code({ inspect: mock(() => Promise.resolve(err("OBJECT_NOT_FOUND" as const))) }),
    ).toMatchObject({ code: "OBJECT_NOT_FOUND", recorded: 0 });
  });
});
