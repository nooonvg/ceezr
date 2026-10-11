/**
 * الغرض: إثباتُ أنَّ الإقلاعَ لا يبقى على الهيكلِ بلا نهاية (BOOT-DEADLINES):
 *   مهلةٌ على `SecureStorage`، وعلى طلبِ التجديد، وعلى انتظارِ التبادلِ المُقدَّمِ
 *   والمبادلة — وأنَّ انقضاءها لا يُفسِدُ جلسةً ولا يُعرَضُ رفضًا لهويّة، ولا يُجدِّدُ
 *   حسابًا غيرَ حسابِ الفتح.
 * الحالة: اختبار فعلي — بلا شبكةٍ ولا تيليجرام. ومكتبةُ تيليجرامَ الحقيقيّةُ تنتظرُ
 *   حدثَ `secure_storage_*` بلا مهلة (سكربتُ WebApp الرسميّ)، فالمخزنُ المعلَّقُ ههنا
 *   هو سلوكُ عميلٍ لا يجيب — **ولا يُثبِتُ هذا الملفُّ سلوكَ عميلِ تيليجرامَ حقيقيّ**.
 * ينتمي إلى: apps/miniapp/src/identity
 */

import { afterEach, describe, expect, it } from "bun:test";
import { ApiNetworkError, apiFetch } from "../api/client.ts";
import type { TgOutcome, TgSecureRead } from "../tg/index.ts";
import { type BootDeps, establishSession, initDataSubject } from "./boot.ts";
import { clearPreboot } from "./preboot.ts";
import { refreshTokenSubject, renewSessionFromStorage } from "./renew.ts";
import { clearSession, getSession } from "./session.ts";
import {
  boundedSecureStore,
  type DeviceSecureStore,
  loadRefreshToken,
  persistRefreshToken,
  REFRESH_TOKEN_STORAGE_KEY,
  SECURE_STORAGE_TIMEOUT_DETAIL,
} from "./session-storage.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  clearSession();
  clearPreboot();
  globalThis.fetch = realFetch;
});

const HOUR_MS = 3_600_000;
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** رمزُ تجديدٍ بشكلِ الخادمِ (`wslr1.<payload>.<sig>`) — التوقيعُ لا يُتحقَّقُ منه في العميل. */
function tokenFor(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, sid: "s", sub, bot: "rider" })).toString(
    "base64url",
  );
  return `wslr1.${payload}.sig`;
}

const initDataFor = (id: number): string =>
  `auth_date=1&user=${encodeURIComponent(JSON.stringify({ id }))}&hash=00`;

/** مخزنٌ في الذاكرة؛ و`hang` يجعلُ العمليّةَ المسمّاةَ لا تجيبُ أبدًا. */
function memoryStore(initial: string | null, hang: ReadonlySet<string> = new Set()) {
  let value = initial;
  const calls: string[] = [];
  const store: DeviceSecureStore = {
    set(_key, next) {
      calls.push("set");
      if (hang.has("set")) return never();
      value = next;
      return Promise.resolve<TgOutcome<boolean>>({ ok: true, value: true });
    },
    get() {
      calls.push("get");
      if (hang.has("get")) return never();
      return Promise.resolve<TgOutcome<TgSecureRead>>({
        ok: true,
        value: { value, canRestore: false },
      });
    },
    remove() {
      calls.push("remove");
      if (hang.has("remove")) return never();
      value = null;
      return Promise.resolve<TgOutcome<boolean>>({ ok: true, value: true });
    },
  };
  return { store, calls, read: () => value };
}

/** جدولةٌ يدويّة: المهلةُ لا تنقضي إلّا حينَ يقولُ الاختبار. */
function manualClock() {
  const pending: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      pending.push(run);
    },
    fire: () => {
      for (const run of pending.splice(0)) run();
    },
  };
}

describe("مهلةُ SecureStorage", () => {
  it("قراءةٌ لا تجيبُ ⇐ `failed`/`timeout` عندَ انقضاءِ المهلة، لا تعليق", async () => {
    const clock = manualClock();
    const bounded = boundedSecureStore(memoryStore("x", new Set(["get"])).store, 1, clock.schedule);
    const read = bounded.get(REFRESH_TOKEN_STORAGE_KEY);
    clock.fire();
    expect(await read).toEqual({
      ok: false,
      reason: "failed",
      detail: SECURE_STORAGE_TIMEOUT_DETAIL,
    });
  });

  it("جوابٌ قبلَ المهلةِ يمرُّ كما هو، وانقضاؤها بعدَه لا يغيّره", async () => {
    const clock = manualClock();
    const bounded = boundedSecureStore(memoryStore("x").store, 1, clock.schedule);
    const read = await bounded.get(REFRESH_TOKEN_STORAGE_KEY);
    clock.fire();
    expect(read).toEqual({ ok: true, value: { value: "x", canRestore: false } });
  });

  it("مضيفٌ يرفضُ الوعدَ ⇐ `failed` لا استثناءٌ صاعد", async () => {
    const throwing: DeviceSecureStore = {
      set: () => Promise.reject(new Error("bridge")),
      get: () => Promise.reject(new Error("bridge")),
      remove: () => Promise.reject(new Error("bridge")),
    };
    const outcome = await boundedSecureStore(throwing, 1_000, () => undefined).set("k", "v");
    expect(outcome.ok).toBe(false);
  });

  it("قراءةٌ معلَّقة ⇐ `loadRefreshToken` = لا رمز؛ وحفظٌ معلَّق ⇐ `stored: false` (الجلسةُ في الذاكرة)", async () => {
    const clock = manualClock();
    const raw = memoryStore("tok", new Set(["get", "set"]));
    const bounded = boundedSecureStore(raw.store, 1, clock.schedule);
    const loaded = loadRefreshToken(bounded);
    const persisted = persistRefreshToken("new", bounded);
    clock.fire();
    expect(await loaded).toBeNull();
    expect(await persisted).toEqual({ stored: false, reason: "failed" });
    // لا شيءَ مُسِح ولا شيءَ اختُلِق.
    expect(raw.read()).toBe("tok");
  });
});

describe("موضوعُ الرمزِ وبيانِ الفتح", () => {
  it("يقرأُ `sub` من رمزٍ بشكلِ الخادم، و`null` لما لا يُقرأ", () => {
    expect(refreshTokenSubject(tokenFor("42"))).toBe("42");
    expect(refreshTokenSubject("garbage")).toBeNull();
    expect(refreshTokenSubject("wslr1.@@@.sig")).toBeNull();
  });

  it("يقرأُ معرّفَ المستخدمِ من `initData` الخام، و`null` لما لا يُقرأ", () => {
    expect(initDataSubject(initDataFor(42))).toBe("42");
    expect(initDataSubject("auth_date=1&hash=00")).toBeNull();
    expect(initDataSubject("user=%7Bbad&hash=00")).toBeNull();
    expect(initDataSubject(null)).toBeNull();
  });
});

describe("التجديد: حارسُ الحسابِ ومهلةُ الطلب", () => {
  it("رمزٌ محفوظٌ لحسابٍ آخر ⇐ `OTHER_ACCOUNT` بلا نداءٍ ولا مسح", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const mem = memoryStore(tokenFor("1"));
    const result = await renewSessionFromStorage(mem.store, undefined, { expectedSubject: "2" });
    expect(result).toEqual({ renewed: false, reason: "OTHER_ACCOUNT" });
    expect(calls).toBe(0);
    expect(mem.read()).toBe(tokenFor("1"));
  });

  it("الحسابُ نفسُه ⇐ يُجدَّدُ كما كان", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          accessToken: "renewed",
          expiresAtMs: Date.now() + HOUR_MS,
          refreshToken: tokenFor("2"),
          absoluteExpiresAtMs: Date.now() + HOUR_MS,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const mem = memoryStore(tokenFor("2"));
    const result = await renewSessionFromStorage(mem.store, undefined, { expectedSubject: "2" });
    expect(result.renewed).toBe(true);
    expect(getSession()?.accessToken).toBe("renewed");
  });

  it("خادمٌ لا يجيبُ ⇐ يُلغى الطلبُ عندَ المهلة ⇐ `UNAVAILABLE`، والرمزُ المحفوظُ باقٍ", async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as unknown as typeof fetch;
    const mem = memoryStore(tokenFor("2"));
    const result = await renewSessionFromStorage(mem.store, undefined, {
      expectedSubject: "2",
      timeoutMs: 5,
    });
    expect(result).toEqual({ renewed: false, reason: "UNAVAILABLE" });
    expect(mem.read()).toBe(tokenFor("2"));
    expect(getSession()).toBeNull();
  });

  it("`apiFetch` بلا `timeoutMs` لا يمرِّرُ إشارةَ إلغاء — سلوكُ بقيّةِ المنادين لا يتغيّر", async () => {
    let signal: AbortSignal | undefined | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      signal = init?.signal;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await apiFetch("/health", { public: true });
    expect(signal).toBeUndefined();
  });
});

const baseDeps = (over: BootDeps = {}): BootDeps => ({
  insideTelegram: () => true,
  rawInitData: () => initDataFor(2),
  renew: async () => ({ renewed: false, reason: "NO_STORED_TOKEN" }) as const,
  exchange: async () => ({
    ok: true as const,
    accessToken: "x",
    expiresAtMs: Date.now() + HOUR_MS,
  }),
  persist: async () => ({ stored: true }) as never,
  deadlines: { prebootMs: 5, exchangeMs: 5 },
  ...over,
});

describe("مهلةُ الإقلاع", () => {
  it("تقديمٌ لا يجيبُ ولا رمزَ محفوظ ⇐ `UNAVAILABLE` بلا مبادلةٍ ثانيةٍ لـ`initData`", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => never(),
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) {
      expect(result.reason).toBe("UNAVAILABLE");
      expect(result.thrown).toBeInstanceOf(ApiNetworkError);
    }
    expect(exchanged).toBe(0);
    expect(getSession()).toBeNull();
  });

  it("تقديمٌ لا يجيبُ ورمزٌ محفوظٌ للحسابِ نفسِه ⇐ يُقامُ بالتجديد، والردُّ المتأخّرُ لا يطغى", async () => {
    let lateResolve: (value: unknown) => void = () => undefined;
    const late = new Promise((resolve) => {
      lateResolve = resolve;
    });
    let expected: string | null | undefined;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => late as never,
        renew: async (_store, _observe, options) => {
          expected = options?.expectedSubject;
          const { setSession } = await import("./session.ts");
          setSession({ accessToken: "renewed", expiresAt: Date.now() + HOUR_MS });
          return {
            renewed: true,
            expiresAtMs: Date.now() + HOUR_MS,
            absoluteExpiresAtMs: Date.now() + HOUR_MS,
            persisted: true,
          } as const;
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "renewed" });
    expect(expected).toBe("2");
    lateResolve({ ok: true, accessToken: "late", expiresAtMs: Date.now() + HOUR_MS });
    await late;
    expect(getSession()?.accessToken).toBe("renewed");
  });

  it("تقديمٌ لا يجيبُ ورمزٌ لحسابٍ آخر ⇐ `UNAVAILABLE`، لا جلسةَ للحسابِ القديمِ ولا مبادلة", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => never(),
        renew: async () => ({ renewed: false, reason: "OTHER_ACCOUNT" }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result.established ? null : result.reason).toBe("UNAVAILABLE");
    expect(exchanged).toBe(0);
    expect(getSession()).toBeNull();
  });

  it("فشلُ التقديمِ ورمزٌ لحسابٍ آخر ⇐ مبادلةُ `initData` الحاليّ (تبديلُ الحسابِ صحيح)", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => Promise.reject(new Error("preboot:500")),
        renew: async () => ({ renewed: false, reason: "OTHER_ACCOUNT" }) as const,
        exchange: async () => {
          exchanged += 1;
          return { ok: true as const, accessToken: "B", expiresAtMs: Date.now() + HOUR_MS };
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(exchanged).toBe(1);
    expect(getSession()?.accessToken).toBe("B");
  });

  it("مبادلةٌ لا تجيبُ (بلا تقديم) ⇐ `UNAVAILABLE` لا تعليق", async () => {
    const result = await establishSession(
      baseDeps({ consumePreboot: () => null, exchange: () => never() }),
    );
    expect(result.established ? null : result.reason).toBe("UNAVAILABLE");
    expect(getSession()).toBeNull();
  });

  it("نداءانِ متزامنانِ وتقديمٌ معلَّق ⇐ تجديدٌ واحدٌ ونتيجةٌ واحدة", async () => {
    let renewCalls = 0;
    const deps = baseDeps({
      consumePreboot: () => never(),
      renew: async () => {
        renewCalls += 1;
        return { renewed: false, reason: "NO_STORED_TOKEN" } as const;
      },
    });
    const [a, b] = await Promise.all([establishSession(deps), establishSession(deps)]);
    expect(a).toEqual(b);
    expect(renewCalls).toBe(1);
  });

  it("حفظٌ معلَّقٌ بعدَ تقديمٍ ناجح ⇐ الجلسةُ قائمةٌ في الذاكرة، والإقلاعُ ينتهي", async () => {
    const clock = manualClock();
    const bounded = boundedSecureStore(
      memoryStore(null, new Set(["set"])).store,
      1,
      clock.schedule,
    );
    const pending = establishSession(
      baseDeps({
        consumePreboot: () =>
          Promise.resolve({
            ok: true as const,
            accessToken: "pre",
            expiresAtMs: Date.now() + HOUR_MS,
            refreshToken: tokenFor("2"),
          }),
        persist: (token: string) => persistRefreshToken(token, bounded),
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    clock.fire();
    expect(await pending).toEqual({ established: true, via: "exchanged" });
    expect(getSession()?.accessToken).toBe("pre");
  });
});
