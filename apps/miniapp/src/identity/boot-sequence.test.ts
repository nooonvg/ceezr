/**
 * الغرض: إعادةُ إنتاجِ **تسلسلِ طلباتِ الإقلاع** كما يقعُ في المتصفّح (ADR 0259):
 *   سكربتُ المستندِ يُقدِّمُ التبادلَ وقراءتَيه، ثمَّ `establishSession`، ثمَّ قراءةُ
 *   الدورِ (`fetchViewer`) والموافقاتِ (`fetchConsentStatus`). تُعَدُّ طلباتُ `fetch`
 *   الحقيقيّةُ لكلِّ مسار — فلا يُثبَتُ «لا طلبَ مكرَّر» بنيّةٍ بل بعدّ.
 * الحالة: اختبار فعلي — `fetch` مُستبدَلٌ بعدّاد، والتجديدُ محقونٌ ليُعَدَّ ويُقيمَ جلستَه.
 * ينتمي إلى: apps/miniapp/src/identity
 * ملاحظات مستقبلية: لا يُثبِتُ زمنَ الشبكةِ ولا سلوكَ عميلِ تيليجرامَ حقيقيّ —
 *   ذاكَ في `docs/evidence/production/PRD-009-boot-sequence-20261011.md`.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { fetchConsentStatus } from "../surfaces/rider/welcome/consent-api.ts";
import { type BootDeps, establishSession } from "./boot.ts";
import { clearPreboot } from "./preboot.ts";
import { clearSession, getSession, setSession } from "./session.ts";
import { fetchViewer } from "./viewer.ts";

const HOUR_MS = 3_600_000;
const ORIGINAL_FETCH = globalThis.fetch;
const VIEWER = { ok: true, role: "rider", status: "active", languageCode: "ar" };
const CONSENTS = { ok: true, documents: [], onboarding: { complete: true } };

let calls: { path: string; auth: string | null }[] = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "https://gateway.test");
    const headers = new Headers(init?.headers);
    calls.push({ path: url.pathname, auth: headers.get("authorization") });
    const body = url.pathname === "/v1/me" ? VIEWER : CONSENTS;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  clearSession();
  clearPreboot();
});

/** ما يتركُه سكربتُ `index.html` بعدَ نجاحِ تبادلِه وتضمينِ قراءتَيه (ADR 0210). */
function prebootSucceeded(token: string): void {
  (globalThis as { __waslahPreboot?: unknown }).__waslahPreboot = {
    session: Promise.resolve({
      ok: true,
      accessToken: token,
      expiresAtMs: Date.now() + HOUR_MS,
      refreshToken: "fresh-chain",
    }),
    viewer: Promise.resolve(VIEWER),
    consents: Promise.resolve(CONSENTS),
    accessToken: token,
  };
}

function bootDeps(renewCalls: { n: number }, renewedToken: string | null): BootDeps {
  return {
    insideTelegram: () => true,
    rawInitData: () => "user=%7B%7D&hash=deadbeef",
    persist: async () => ({ stored: true }) as never,
    exchange: async () => {
      throw new Error("لا ينبغي أن تُنادى المبادلةُ العاديّة");
    },
    renew: async () => {
      renewCalls.n += 1;
      if (renewedToken === null) return { renewed: false, reason: "NO_STORED_TOKEN" } as const;
      // كالتجديدِ الحقيقيّ: يُقيمُ الجلسةَ بالرمزِ المُجدَّد.
      setSession({ accessToken: renewedToken, expiresAt: Date.now() + HOUR_MS });
      return {
        renewed: true,
        expiresAtMs: Date.now() + HOUR_MS,
        absoluteExpiresAtMs: Date.now() + HOUR_MS,
        persisted: true,
      } as const;
    },
  };
}

describe("تسلسلُ طلباتِ الإقلاع (ADR 0259)", () => {
  it("راكبٌ عائدٌ برمزٍ محفوظٍ صالح: لا تجديد، ولا `/v1/me`، ولا `/v1/consents` — كلُّها من التبادلِ المُقدَّم", async () => {
    prebootSucceeded("pre");
    const renewCalls = { n: 0 };
    const boot = await establishSession(bootDeps(renewCalls, "renewed"));
    expect(boot).toEqual({ established: true, via: "exchanged" });
    expect(await fetchViewer()).toMatchObject({ kind: "viewer", role: "rider" });
    expect(await fetchConsentStatus()).toEqual(CONSENTS as never);
    expect(renewCalls.n).toBe(0);
    expect(calls).toEqual([]);
  });

  it("أوّلُ فتحٍ بلا رمزٍ محفوظ: النتيجةُ نفسُها — صفرُ طلباتٍ بعدَ التبادلِ المُقدَّم", async () => {
    prebootSucceeded("pre");
    const renewCalls = { n: 0 };
    await establishSession(bootDeps(renewCalls, null));
    await fetchViewer();
    await fetchConsentStatus();
    expect(renewCalls.n).toBe(0);
    expect(calls).toEqual([]);
  });

  it("فشلَ التبادلُ المُقدَّمُ ونجحَ التجديد: قراءتا الإقلاعِ **بالرمزِ المُجدَّدِ** من الخادم، ولا شيءَ من التقديم", async () => {
    (globalThis as { __waslahPreboot?: unknown }).__waslahPreboot = {
      session: Promise.reject(new Error("preboot:401")),
      // ما قد يبقى من تقديمٍ فاشلٍ لا يُستهلَكُ تحتَ رمزٍ آخر.
      viewer: Promise.resolve({ ...VIEWER, role: "admin" }),
      consents: Promise.resolve(CONSENTS),
      accessToken: "",
    };
    const renewCalls = { n: 0 };
    const boot = await establishSession(bootDeps(renewCalls, "renewed"));
    expect(boot).toEqual({ established: true, via: "renewed" });
    expect(await fetchViewer()).toMatchObject({ role: "rider" });
    await fetchConsentStatus();
    expect(renewCalls.n).toBe(1);
    expect(calls).toEqual([
      { path: "/v1/me", auth: "Bearer renewed" },
      { path: "/v1/consents", auth: "Bearer renewed" },
    ]);
  });

  it("لا بياناتِ مستخدمٍ قبلَ المصادقة: بلا جلسةٍ مُقامةٍ لا يُستهلَكُ دورٌ ولا موافقاتٌ مُقدَّمة", async () => {
    prebootSucceeded("pre");
    expect(getSession()).toBeNull();
    // قراءةُ الدورِ قبلَ `establishSession` لا تأخذُ ما قدّمَه المستند.
    const before = await fetchViewer();
    expect(before.kind).not.toBe("viewer");
    expect(calls).toEqual([]);
  });
});
