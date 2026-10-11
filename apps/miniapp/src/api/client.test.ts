import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearSession, setSession } from "../identity/session.ts";
import { type ApiError, apiFetch } from "./client.ts";

beforeEach(() => {
  clearSession();
});

// الجلسةُ حالةٌ على مستوى الوحدة، يتقاسمُها كلُّ ملفٍّ في عمليّةِ `bun test` نفسِها.
// فبلا مسحٍ بعدَ الاختبارِ الأخيرِ يرثُ الملفُّ التالي `"tok"` (فشلُ `production-ride-channel`).
afterEach(() => {
  clearSession();
});

describe("apiFetch session guard (ADR 0035 check #2)", () => {
  test("rejects product calls without Waslah session", async () => {
    await expect(apiFetch("/v1/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "SESSION_REQUIRED",
    } satisfies Partial<ApiError>);
  });

  test("allows public session exchange path flag", async () => {
    // Without a real server this will fail at network; we only assert the
    // session guard is skipped (no SESSION_REQUIRED). Mock fetch.
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      const result = await apiFetch<{ ok: boolean }>("/v1/session/telegram", {
        public: true,
        method: "POST",
        body: { initData: "x" },
      });
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("attaches bearer when session is valid", async () => {
    setSession({
      accessToken: "tok",
      expiresAt: Date.now() + 60_000,
    });

    // Held in an object: a plain `let` assigned only inside the callback is
    // narrowed to `null` by control-flow analysis at the assertion site.
    const seen: { auth: string | null } = { auth: null };
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.auth = headers.get("Authorization");
      return new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      await apiFetch("/v1/me");
      expect(seen.auth).toBe("Bearer tok");
    } finally {
      globalThis.fetch = original;
    }
  });
});

/**
 * `F1-05`: ردودُ البوابةِ تحمل الرمزَ في `error` لا في `code`. وقبلَ هذا كان
 * العميلُ يقرأ `HTTP_ERROR` لكلِّ رفضٍ، فلا يفرّق «جدِّد» من «أعِد التحقّق» —
 * وهو فرقٌ يقرّر شاشةً للمستخدم.
 */
describe("رمزُ الخطأِ يُقرأ من شكلِ ردِّ البوابة (F1-05)", () => {
  const respond = (status: number, body: unknown): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

  test("يقرأ الرمزَ من حقل `error`", async () => {
    setSession({ accessToken: "tok", expiresAt: Date.now() + 60_000 });
    const original = globalThis.fetch;
    globalThis.fetch = respond(401, { ok: false, error: "SESSION_EXPIRED" });

    try {
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({
        status: 401,
        code: "SESSION_EXPIRED",
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("يبقى `code` مقروءاً للردودِ الأقدمِ التي تستعمله", async () => {
    setSession({ accessToken: "tok", expiresAt: Date.now() + 60_000 });
    const original = globalThis.fetch;
    globalThis.fetch = respond(403, { code: "ACCOUNT_BLOCKED" });

    try {
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "ACCOUNT_BLOCKED" });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("ردٌّ بلا رمزٍ يبقى `HTTP_ERROR` ولا يُخترَع له رمز", async () => {
    setSession({ accessToken: "tok", expiresAt: Date.now() + 60_000 });
    const original = globalThis.fetch;
    globalThis.fetch = respond(500, { ok: false });

    try {
      await expect(apiFetch("/v1/me")).rejects.toMatchObject({ code: "HTTP_ERROR" });
    } finally {
      globalThis.fetch = original;
    }
  });
});
