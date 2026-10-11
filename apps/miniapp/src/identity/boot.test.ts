/**
 * الغرض: إثباتُ أنّ **مسارَ الإقلاعِ موصولٌ فعلاً** (`F1-07`): ترتيبُ المحاولاتِ
 *   من الأرخصِ إلى الأغلى، وأنّ المبادلةَ لا تحدث إلّا حين تلزم، وأنّ كلَّ فشلٍ
 *   يُصنَّف سبباً صريحاً لا «تعذّر».
 * الحالة: اختبار فعلي — كلُّ التبعياتِ محقونةٌ بلا شبكةٍ ولا تيليجرام.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: **لا يُثبِت هذا الملفُّ أنّ المبادلةَ تنجح مع خادمٍ حقيقيٍّ
 *   ولا مع عميلِ تيليجرامَ حقيقيّ**: مدخلاتُه مصنوعةٌ، والتحقّقُ على جهازٍ غيرُ
 *   منفَّذٍ في هذه البيئة.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { ApiError, ApiNetworkError } from "../api/client.ts";
import { type BootDeps, establishSession } from "./boot.ts";
import { clearPreboot } from "./preboot.ts";
import { clearSession, getSession, setSession } from "./session.ts";

afterEach(() => {
  clearSession();
  clearPreboot();
});

const HOUR_MS = 3_600_000;

/** تجديدٌ لا يجد رمزاً محفوظاً — الحالةُ الشائعةُ في أوّلِ فتح. */
const noStoredToken = async () => ({ renewed: false, reason: "NO_STORED_TOKEN" }) as const;

const baseDeps = (over: BootDeps = {}): BootDeps => ({
  insideTelegram: () => true,
  rawInitData: () => "user=%7B%7D&hash=deadbeef",
  renew: noStoredToken,
  exchange: async () => ({
    ok: true as const,
    accessToken: "a",
    expiresAtMs: Date.now() + HOUR_MS,
  }),
  persist: async () => ({ stored: true }) as never,
  ...over,
});

describe("ترتيبُ المحاولات: الأرخصُ فالأغلى", () => {
  it("جلسةٌ صالحةٌ في الذاكرةِ = لا نداءَ إطلاقاً", async () => {
    let calls = 0;
    setSession({ accessToken: "live", expiresAt: Date.now() + HOUR_MS });
    const result = await establishSession(
      baseDeps({
        renew: async () => {
          calls += 1;
          return { renewed: false, reason: "NO_STORED_TOKEN" } as const;
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "existing" });
    expect(calls).toBe(0);
  });

  it("رمزٌ محفوظٌ يُجدَّد — **ولا تُنادى المبادلةُ**", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        renew: async () =>
          ({
            renewed: true,
            expiresAtMs: Date.now() + HOUR_MS,
            absoluteExpiresAtMs: Date.now() + HOUR_MS,
            persisted: true,
          }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "renewed" });
    expect(exchanged).toBe(0);
  });

  it("لا رمزَ محفوظاً: تُبادَل `initData` وتُقام الجلسةُ ويُحفَظ رمزُ التجديد", async () => {
    const persisted: string[] = [];
    const result = await establishSession(
      baseDeps({
        exchange: async () => ({
          ok: true as const,
          accessToken: "fresh",
          expiresAtMs: Date.now() + HOUR_MS,
          refreshToken: "r-1",
        }),
        persist: (async (token: string) => {
          persisted.push(token);
          return { stored: true };
        }) as never,
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(persisted).toEqual(["r-1"]);
  });

  it("ردٌّ بلا رمزِ تجديدٍ ردٌّ صحيحٌ: جلسةٌ في الذاكرةِ ولا حفظَ ولا فشل", async () => {
    let persistCalls = 0;
    const result = await establishSession(
      baseDeps({
        persist: (async () => {
          persistCalls += 1;
          return { stored: true };
        }) as never,
      }),
    );
    expect(result.established).toBe(true);
    expect(persistCalls).toBe(0);
  });

  it("تعطُّلٌ في التجديدِ لا يُتبَع بمبادلةٍ: الرمزُ المحفوظُ قد يكون صالحاً", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        renew: async () => ({ renewed: false, reason: "UNAVAILABLE" }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: false, reason: "UNAVAILABLE" });
    expect(exchanged).toBe(0);
  });
});

describe("كلُّ فشلٍ سببٌ صريحٌ لا «تعذّر»", () => {
  it("خارجَ تيليجرام: لا مصادقةَ بديلةَ اليوم", async () => {
    const result = await establishSession(baseDeps({ insideTelegram: () => false }));
    expect(result).toEqual({ established: false, reason: "OUTSIDE_TELEGRAM" });
  });

  it("داخلَ تيليجرامَ بلا بيانِ فتحٍ: لا شيءَ يُبادَل به", async () => {
    for (const value of [null, ""]) {
      const result = await establishSession(baseDeps({ rawInitData: () => value }));
      expect(result).toEqual({ established: false, reason: "MISSING_INIT_DATA" });
    }
  });

  it("401 = رفضٌ، وعلاجُه تحقّقٌ جديد", async () => {
    const result = await establishSession(
      baseDeps({
        exchange: async () => {
          throw new ApiError(401, "INIT_DATA_SIGNATURE", "…");
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("REJECTED");
  });

  it("503 = تعطّلٌ، ويُمرَّر الاستثناءُ ليُصنَّف شاشةً", async () => {
    const thrown = new ApiError(503, "SESSION_NOT_CONFIGURED", "…", 60);
    const result = await establishSession(
      baseDeps({
        exchange: async () => {
          throw thrown;
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) {
      expect(result.reason).toBe("UNAVAILABLE");
      expect(result.thrown).toBe(thrown);
    }
  });

  it("لم يصل ردٌّ = تعطّلٌ يُصنَّف لاحقاً بفحصِ الحياة", async () => {
    const result = await establishSession(
      baseDeps({
        exchange: async () => {
          throw new ApiNetworkError();
        },
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("UNAVAILABLE");
  });
});

describe("استهلاكُ التقديمِ الساكنِ (DEC-19 / F1-09)", () => {
  it("يستهلكُ التبادلَ المُقدَّمَ ولا يُرسِلُ طلبًا ثانيًا", async () => {
    let exchanged = 0;
    const preboot = Promise.resolve({
      ok: true as const,
      accessToken: "pre",
      expiresAtMs: Date.now() + HOUR_MS,
    });
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => preboot,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(exchanged).toBe(0);
  });

  it("ADR 0259: راكبٌ عائدٌ برمزٍ محفوظ — يُقامُ التبادلُ المُقدَّمُ **ولا يُنادى التجديد**", async () => {
    let renewCalls = 0;
    const persisted: string[] = [];
    const result = await establishSession(
      baseDeps({
        renew: async () => {
          renewCalls += 1;
          return {
            renewed: true,
            expiresAtMs: Date.now() + HOUR_MS,
            absoluteExpiresAtMs: Date.now() + HOUR_MS,
            persisted: true,
          } as const;
        },
        consumePreboot: () =>
          Promise.resolve({
            ok: true as const,
            accessToken: "pre",
            expiresAtMs: Date.now() + HOUR_MS,
            refreshToken: "fresh-chain",
          }),
        persist: async (token: string) => {
          persisted.push(token);
          return { stored: true } as never;
        },
        exchange: async () => {
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(renewCalls).toBe(0);
    // رمزُ السلسلةِ الجديدةِ يستبدلُ المحفوظ — فلا يبقى الجهازُ على سلسلةٍ أقدم.
    expect(persisted).toEqual(["fresh-chain"]);
    expect(getSession()?.accessToken).toBe("pre");
  });

  it("ADR 0259: فشلُ التقديمِ (`initData` مُستهلَكٌ بعدَ إعادةِ تحميل) يعودُ إلى التجديدِ قبلَ أيِّ شاشةِ فشل", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => Promise.reject(new Error("preboot:401")),
        renew: async () =>
          ({
            renewed: true,
            expiresAtMs: Date.now() + HOUR_MS,
            absoluteExpiresAtMs: Date.now() + HOUR_MS,
            persisted: true,
          }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "renewed" });
    expect(exchanged).toBe(0);
  });

  it("ADR 0259: تقديمٌ **منتهي الصلاحية** لا يُقامُ لتوفيرِ نداء — يُجرَّبُ التجديد", async () => {
    let renewCalls = 0;
    const now = 1_000_000;
    const result = await establishSession(
      baseDeps({
        now: () => now,
        consumePreboot: () =>
          Promise.resolve({ ok: true as const, accessToken: "stale", expiresAtMs: now }),
        renew: async () => {
          renewCalls += 1;
          return {
            renewed: true,
            expiresAtMs: now + HOUR_MS,
            absoluteExpiresAtMs: now + HOUR_MS,
            persisted: true,
          } as const;
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "renewed" });
    expect(renewCalls).toBe(1);
    expect(getSession()?.accessToken).not.toBe("stale");
  });

  it("ADR 0259: ردٌّ مُقدَّمٌ **متأخّرٌ** لا يطغى على جلسةٍ أُقيمَت في أثناءِ انتظارِه", async () => {
    let release: (v: { ok: true; accessToken: string; expiresAtMs: number }) => void = () => {};
    const late = new Promise<{ ok: true; accessToken: string; expiresAtMs: number }>((r) => {
      release = r;
    });
    const persisted: string[] = [];
    let valid = false;
    const pending = establishSession(
      baseDeps({
        sessionValid: () => valid,
        consumePreboot: () => late,
        persist: async (token: string) => {
          persisted.push(token);
          return { stored: true } as never;
        },
      }),
    );
    // جلسةٌ أحدثُ تُقامُ قبلَ وصولِ الردِّ المُقدَّم.
    setSession({ accessToken: "newer", expiresAt: Date.now() + HOUR_MS });
    valid = true;
    release({ ok: true, accessToken: "older", expiresAtMs: Date.now() + HOUR_MS });
    expect(await pending).toEqual({ established: true, via: "existing" });
    expect(getSession()?.accessToken).toBe("newer");
    expect(persisted).toEqual([]);
  });

  it("ADR 0259: فشلُ التقديمِ بالشبكةِ ثمَّ تعطّلُ التجديد = `UNAVAILABLE` بلا مبادلةٍ ثالثة", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => Promise.reject(new ApiNetworkError("offline")),
        renew: async () => ({ renewed: false, reason: "UNAVAILABLE" }) as const,
        exchange: async () => {
          exchanged += 1;
          throw new Error("لا ينبغي أن تُنادى");
        },
      }),
    );
    expect(result).toEqual({ established: false, reason: "UNAVAILABLE" });
    expect(exchanged).toBe(0);
  });

  it("ADR 0259: نداءانِ متزامنانِ — التقديمُ يُستهلَكُ مرّةً واحدة، والثاني يمضي في التجديد", async () => {
    (globalThis as { __waslahPreboot?: unknown }).__waslahPreboot = {
      session: Promise.resolve({ ok: true, accessToken: "pre", expiresAtMs: Date.now() + HOUR_MS }),
      viewer: null,
      consents: null,
      accessToken: "pre",
    };
    let renewCalls = 0;
    // `consumePreboot` غيرُ محقون: الاستهلاكُ الحقيقيُّ من `window.__waslahPreboot`.
    const deps = baseDeps({
      renew: async () => {
        renewCalls += 1;
        return { renewed: false, reason: "NO_STORED_TOKEN" } as const;
      },
    });
    const [a, b] = await Promise.all([establishSession(deps), establishSession(deps)]);
    expect([a, b].every((r) => r.established)).toBe(true);
    expect(renewCalls).toBe(1);
  });

  it("يفشلُ كما يفشلُ التبادلُ العاديُّ إن رفضَ الخادمُ التبادلَ المُقدَّمَ", async () => {
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => Promise.reject(new ApiError(401, "INIT_DATA_SIGNATURE", "…")),
      }),
    );
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("REJECTED");
  });

  it("UI-SESS-01: رفضُ السكربتِ الساكنِ بخطأٍ خامٍ يُعادُ بمبادلةٍ مُصنَّفةٍ — `401` يصيرُ `REJECTED` لا «لا اتصال»", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => Promise.reject(new Error("preboot:401")),
        exchange: async () => {
          exchanged += 1;
          throw new ApiError(401, "INIT_DATA_EXPIRED", "…");
        },
      }),
    );
    expect(exchanged).toBe(1);
    expect(result.established).toBe(false);
    if (!result.established) expect(result.reason).toBe("REJECTED");
  });

  it("يحفظُ رمزَ التجديدِ من التبادلِ المُقدَّمِ إن وُجد", async () => {
    const persisted: string[] = [];
    const result = await establishSession(
      baseDeps({
        consumePreboot: () =>
          Promise.resolve({
            ok: true as const,
            accessToken: "pre",
            expiresAtMs: Date.now() + HOUR_MS,
            refreshToken: "rt-1",
          }),
        persist: (async (token: string) => {
          persisted.push(token);
          return { stored: true };
        }) as never,
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(persisted).toEqual(["rt-1"]);
  });

  it("يستهلكُ `null` كأنَّ التقديمَ لم يُبدَأْ — فيمضي في المبادلةِ العاديةِ", async () => {
    let exchanged = 0;
    const result = await establishSession(
      baseDeps({
        consumePreboot: () => null,
        exchange: async () => {
          exchanged += 1;
          return { ok: true as const, accessToken: "x", expiresAtMs: Date.now() + HOUR_MS };
        },
      }),
    );
    expect(result).toEqual({ established: true, via: "exchanged" });
    expect(exchanged).toBe(1);
  });
});
