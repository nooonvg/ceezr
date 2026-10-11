/**
 * الغرض: قياسُ مُوقِّعِ روابطِ الرفعِ بجالبٍ وساعةٍ محقونَينِ — بلا شبكةٍ ولا
 *   سرٍّ حقيقيٍّ (البند `F3-01` · القسم 10.1).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-01`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 * الحاكم: docs/adr/0115-a-document-expires-so-the-block-is-a-clock-not-a-flag.md
 *
 * وما لا يُدَّعى ههنا (`ح-5`): **لا يُثبِتُ هذا المِلفُّ أنَّ التوقيعَ يعملُ عندَ
 * مزوِّدٍ حقيقيٍّ** — ذاكَ أثرٌ مقيسٌ في
 * `docs/evidence/storage/F3-01-SIGNED-UPLOAD-20260915.md`. ويقيسُ ههنا ما لا
 * يقيسُه المزوِّدُ: **أنَّ جواباً مُبدَّلَ الأصلِ يُرفَضُ**، وأنَّ السرَّ لا يخرجُ
 * في عنوانٍ، وأنَّ المدّةَ خارجَ المدى تُرَدُّ قبلَ أيِّ نداءٍ.
 */

import { describe, expect, it } from "bun:test";
import {
  driverDocumentUploadsEnabled,
  HttpUploadSigner,
  readSignedUploadConfig,
  selectUploadSigner,
  UnconfiguredUploadSigner,
} from "../../packages/infrastructure/storage/signed-upload.ts";
import type { FetchLike } from "../../packages/shared/wasla/egress-gate.ts";

const BASE = "https://project.example.co";
const CLOCK = () => new Date("2026-09-15T00:00:00.000Z");

interface Captured {
  url: string;
  init: RequestInit | undefined;
}

function signerWith(
  handler: (captured: Captured) => Response,
  captures: Captured[] = [],
): HttpUploadSigner {
  const stub: FetchLike = async (input, init) => {
    const captured: Captured = { url: String(input), init };
    captures.push(captured);
    return handler(captured);
  };
  return new HttpUploadSigner({
    baseUrl: BASE,
    secretKey: "sb_secret_never_logged",
    bucket: "driver-documents",
    now: CLOCK,
    fetch: stub,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("قراءةُ التهيئةِ — غيابُ السرِّ يُعطِّلُ المسارَ ولا يُسقِطُ الخدمةَ", () => {
  it("تُقرأُ بالأسماءِ الخاصّةِ أوّلاً وتُقلَّمُ الشرطةُ الأخيرةُ", () => {
    const config = readSignedUploadConfig({
      OBJECT_STORAGE_URL: `${BASE}///`,
      OBJECT_STORAGE_SECRET_KEY: " sb_secret_x ",
      DRIVER_DOCUMENTS_BUCKET: "driver-documents",
    });
    expect(config?.baseUrl).toBe(BASE);
    expect(config?.secretKey).toBe("sb_secret_x");
    expect(config?.bucket).toBe("driver-documents");
  });

  it("اسمُ الدلوِ افتراضيٌّ حينَ لا يُذكَرُ", () => {
    const config = readSignedUploadConfig({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(config?.bucket).toBe("driver-documents");
  });

  it("**لا سرَّ ⇒ `null`**: لا تُخترَعُ تهيئةٌ ولا يُحاوَلُ توقيعٌ بلا مفتاحٍ", () => {
    expect(readSignedUploadConfig({ SUPABASE_URL: BASE })).toBeNull();
    expect(readSignedUploadConfig({ SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeNull();
  });

  it("اسمُ دلوٍ يحملُ محرفاً يُغيِّرُ معنى العنوانِ يُرَدُّ", () => {
    expect(
      readSignedUploadConfig({
        SUPABASE_URL: BASE,
        SUPABASE_SERVICE_ROLE_KEY: "k",
        DRIVER_DOCUMENTS_BUCKET: "driver docs?x=1",
      }),
    ).toBeNull();
  });
});

describe("مُوقِّعٌ بلا تهيئةٍ", () => {
  it("يردُّ رفضاً مُصنَّفاً ولا يتظاهرُ بالنجاحِ", async () => {
    const result = await new UnconfiguredUploadSigner().signUpload();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SIGNER_NOT_CONFIGURED");
  });
});

describe("إيقافُ الرفعِ حتّى تثبتَ النسخة", () => {
  const config = { baseUrl: BASE, secretKey: "k", bucket: "driver-documents" };

  it("غيابُ المِفتاحِ إيقافٌ — والتهيئةُ الكاملةُ وحدَها لا تفتحُ الرفع", async () => {
    const chosen = selectUploadSigner({}, config);
    expect(chosen.state).toBe("paused");
    const result = await chosen.signer.signUpload({
      objectPath: "d/1/license.jpg",
      contentType: "image/jpeg",
      ttlSeconds: 60,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SIGNER_NOT_CONFIGURED");
  });

  it("يفشلُ مغلقاً: كلُّ قيمةٍ غيرِ enabled حرفاً إيقاف", () => {
    for (const value of ["", "true", "1", "yes", "ENABLED", "enable", "enabled,", "disabled"]) {
      expect(driverDocumentUploadsEnabled({ DRIVER_DOCUMENT_UPLOADS: value })).toBe(false);
      expect(selectUploadSigner({ DRIVER_DOCUMENT_UPLOADS: value }, config).state).toBe("paused");
    }
  });

  it("enabled مع تهيئةٍ كاملةٍ ⇐ المُوقِّعُ الحقيقيّ", () => {
    const chosen = selectUploadSigner({ DRIVER_DOCUMENT_UPLOADS: " enabled " }, config);
    expect(chosen.state).toBe("active");
    expect(chosen.signer).toBeInstanceOf(HttpUploadSigner);
  });

  it("enabled بلا تهيئةٍ ⇐ غيرُ مُهيَّأ، لا مُوقِّعٌ بلا مفتاح", () => {
    expect(selectUploadSigner({ DRIVER_DOCUMENT_UPLOADS: "enabled" }, null).state).toBe(
      "not_configured",
    );
  });
});

describe("التوقيعُ الناجحُ", () => {
  it("يُنادى المسارُ المتوقَّعُ بترويسةٍ لا بعنوانٍ، والسرُّ لا يظهرُ في العنوانِ", async () => {
    const captures: Captured[] = [];
    const signer = signerWith(
      () =>
        jsonResponse({
          url: "/storage/v1/object/upload/sign/driver-documents/a/b.png?x=1",
          token: "jwt",
        }),
      captures,
    );
    const result = await signer.signUpload({
      objectPath: "drivers/11/driving_license/abc.png",
      contentType: "image/png",
      ttlSeconds: 900,
    });
    expect(result.ok).toBe(true);
    const captured = captures[0];
    expect(captured?.url).toBe(
      `${BASE}/storage/v1/object/upload/sign/driver-documents/drivers/11/driving_license/abc.png`,
    );
    expect(captured?.url).not.toContain("sb_secret");
    const headers = captured?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sb_secret_never_logged");
    expect(captured?.init?.body).toBe(JSON.stringify({ expiresIn: 900 }));
  });

  it("الإذنُ يُضافُ إلى العنوانِ، والانتهاءُ يُحسَبُ من لحظةِ الطلبِ لا من الرمزِ", async () => {
    const signer = signerWith(() => jsonResponse({ url: "/x/y", token: "jwt" }));
    const result = await signer.signUpload({
      objectPath: "drivers/11/insurance/c.pdf",
      contentType: "application/pdf",
      ttlSeconds: 60,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.uploadUrl).toBe(`${BASE}/x/y?token=jwt`);
      expect(result.value.uploadToken).toBe("jwt");
      expect(result.value.expiresAtEpochMs).toBe(CLOCK().getTime() + 60_000);
    }
  });

  it("إذنٌ موجودٌ في العنوانِ لا يُكرَّرُ", async () => {
    const signer = signerWith(() => jsonResponse({ url: "/x/y?token=inline", token: "jwt" }));
    const result = await signer.signUpload({
      objectPath: "drivers/11/insurance/c.pdf",
      contentType: "application/pdf",
      ttlSeconds: 60,
    });
    if (result.ok) expect(result.value.uploadUrl).toBe(`${BASE}/x/y?token=inline`);
  });
});

describe("المدّةُ — تُرَدُّ قبلَ أيِّ نداءٍ", () => {
  it("مدّةٌ أقصرُ من الحدِّ أو أطولُ منه أو كسريّةٌ تُرَدُّ ولا يُنادى المخزنُ", async () => {
    const captures: Captured[] = [];
    const signer = signerWith(() => jsonResponse({ url: "/x", token: "t" }), captures);
    for (const ttlSeconds of [0, 29, 3601, 12.5]) {
      const result = await signer.signUpload({
        objectPath: "drivers/11/insurance/c.pdf",
        contentType: "application/pdf",
        ttlSeconds,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("SIGNER_TTL_OUT_OF_RANGE");
    }
    expect(captures).toHaveLength(0);
  });
});

describe("المسارُ — ما نطقَت بهِ القاعدةُ وحدَه يُوقَّعُ", () => {
  it("مسارٌ يخرجُ من بادئةِ السائقِ أو يبدأُ بشرطةٍ أو يحملُ شرطتَينِ يُرَدُّ بلا نداءٍ", async () => {
    const captures: Captured[] = [];
    const signer = signerWith(() => jsonResponse({ url: "/x", token: "t" }), captures);
    for (const objectPath of [
      "drivers/11/../12/a.png",
      "/drivers/11/a.png",
      "drivers//11/a.png",
      "drivers/11/a b.png",
      "",
    ]) {
      const result = await signer.signUpload({
        objectPath,
        contentType: "image/png",
        ttlSeconds: 900,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("SIGNER_MALFORMED_RESPONSE");
    }
    expect(captures).toHaveLength(0);
  });
});

describe("جوابُ المزوِّدِ — لا يُصدَّقُ على ظاهرِه", () => {
  it("**أصلٌ مُبدَّلٌ يُرفَضُ**: جوابٌ يُحوِّلُ الرفعَ إلى خادمِ غريبٍ لا يُنفَّذُ", async () => {
    const signer = signerWith(() =>
      jsonResponse({ url: "https://attacker.example/upload", token: "jwt" }),
    );
    const result = await signer.signUpload({
      objectPath: "drivers/11/insurance/c.pdf",
      contentType: "application/pdf",
      ttlSeconds: 900,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SIGNER_MALFORMED_RESPONSE");
  });

  it("جوابٌ بلا عنوانٍ أو بجسمٍ ليسَ كائناً أو ليسَ JSON يُصنَّفُ حمولةً معطوبةً", async () => {
    for (const response of [
      jsonResponse({ token: "jwt" }),
      jsonResponse({ url: "" }),
      jsonResponse("نصٌّ"),
      new Response("<html>", { status: 200 }),
    ]) {
      const signer = signerWith(() => response);
      const result = await signer.signUpload({
        objectPath: "drivers/11/insurance/c.pdf",
        contentType: "application/pdf",
        ttlSeconds: 900,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("SIGNER_MALFORMED_RESPONSE");
    }
  });

  it("عنوانٌ بلا إذنٍ يُقبَلُ ويُعلَنُ إذنُه `null` — لا يُخترَعُ رمزٌ", async () => {
    const signer = signerWith(() => jsonResponse({ url: "/x/y" }));
    const result = await signer.signUpload({
      objectPath: "drivers/11/insurance/c.pdf",
      contentType: "application/pdf",
      ttlSeconds: 900,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.uploadToken).toBeNull();
  });

  it("رفضٌ من المزوِّدِ (`403`) يُصنَّفُ تعذُّراً لا خطأَ مستخدمٍ", async () => {
    const signer = signerWith(() => jsonResponse({ error: "AccessDenied" }, 403));
    const result = await signer.signUpload({
      objectPath: "drivers/11/insurance/c.pdf",
      contentType: "application/pdf",
      ttlSeconds: 900,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SIGNER_UNAVAILABLE");
  });

  it("انقطاعُ الشبكةِ أو انتهاءُ المهلةِ يُصنَّفُ تعذُّراً ولا يُرمى إلى المسارِ", async () => {
    const signer = signerWith(() => {
      throw new Error("network down");
    });
    const result = await signer.signUpload({
      objectPath: "drivers/11/insurance/c.pdf",
      contentType: "application/pdf",
      ttlSeconds: 900,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("SIGNER_UNAVAILABLE");
  });
});
