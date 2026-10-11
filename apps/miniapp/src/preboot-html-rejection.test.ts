/**
 * الغرض: إثباتُ أنَّ فشلَ التبادلِ المُقدَّمِ في سكربتِ `index.html` الساكنِ لا يُخلِّفُ
 *   رفضًا غيرَ مُعالَج. كانَ وعدا `viewer` و`consents` المشتقّانِ من الجلسةِ يُرفَضانِ
 *   بلا مُعالِجٍ كلَّما رفضَ الخادمُ `initData` (إعادةُ تحميلٍ بعدَ استهلاكِه مثلًا)، فيظهرُ
 *   `preboot:<status>` خطأً غيرَ مُلتقَطٍ مرّتين في كلِّ إقلاعٍ كهذا (قيسَ على الإنتاج
 *   2026-10-11 بعدَ نشرِ `a16f2873`). والسلوكُ الوظيفيُّ لا يتغيّر: يُستهلَكانِ برمزِ
 *   الجلسةِ وحدَه، فلا يُقرآنِ بعدَ فشلِها.
 * الحالة: اختبار فعلي — ينفّذُ السكربتَ نفسَه من `index.html` بمضيفٍ محقون.
 * ينتمي إلى: apps/miniapp/src (اختبارُ المستندِ الثابتِ)
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML = readFileSync(resolve(import.meta.dirname, "..", "index.html"), "utf-8");

function prebootScript(): string {
  const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
  const found = scripts.find((body) => body.includes("__waslahPreboot"));
  if (found === undefined) throw new Error("preboot script not found");
  return found;
}

interface FakeWindow {
  Telegram: { WebApp: { initData: string } };
  location: { hash: string };
  __waslahPreboot?: {
    session: Promise<unknown>;
    viewer: Promise<unknown>;
    consents: Promise<unknown>;
    accessToken: string;
  };
}

function run(fetchImpl: () => Promise<unknown>): FakeWindow {
  const win: FakeWindow = {
    Telegram: { WebApp: { initData: "auth_date=1&hash=00" } },
    location: { hash: "" },
  };
  const doc = { createElement: () => ({}), head: { appendChild: () => undefined } };
  new Function("window", "document", "fetch", prebootScript())(win, doc, fetchImpl);
  return win;
}

async function unhandledDuring(action: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await action();
    // جولاتُ مهامَّ تكفي لاستقرارِ سلسلةِ الوعودِ وإطلاقِ حدثِ الرفضِ غيرِ المُعالَج.
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return seen;
}

describe("سكربتُ التقديمِ الساكن — فشلُ التبادل", () => {
  it("رفضُ الخادمِ (خطأُ عميلٍ `4xx`) لا يُخلِّفُ رفضًا غيرَ مُعالَجٍ في `viewer` ولا `consents`", async () => {
    const seen = await unhandledDuring(async () => {
      const win = run(() => Promise.resolve({ ok: false, status: 400 }));
      // المستهلِكُ الحقيقيُّ (`boot.ts`) ينتظرُ الجلسةَ ويلتقطُ رفضَها؛ وما سواها لا يُقرأُ بلا رمز.
      await win.__waslahPreboot?.session.catch(() => undefined);
    });
    expect(seen).toEqual([]);
  });

  it("تعطّلُ الشبكةِ كذلك", async () => {
    const seen = await unhandledDuring(async () => {
      const win = run(() => Promise.reject(new TypeError("network")));
      await win.__waslahPreboot?.session.catch(() => undefined);
    });
    expect(seen).toEqual([]);
  });

  it("النجاحُ لا يتغيّر: `viewer` و`consents` يُحَلّانِ بما ضمّنَه الخادم، والرمزُ يُسجَّل", async () => {
    const win = run(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ accessToken: "t", viewer: { v: 1 }, consents: { c: 1 } }),
      }),
    );
    await win.__waslahPreboot?.session;
    expect(await win.__waslahPreboot?.viewer).toEqual({ v: 1 });
    expect(await win.__waslahPreboot?.consents).toEqual({ c: 1 });
    expect(win.__waslahPreboot?.accessToken).toBe("t");
  });

  it("الرفضُ يبقى رفضًا لمن يقرأُ: الالتقاطُ لا يحوّلُ `viewer` إلى نجاحٍ زائف", async () => {
    const win = run(() => Promise.resolve({ ok: false, status: 401 }));
    await win.__waslahPreboot?.session.catch(() => undefined);
    await expect(win.__waslahPreboot?.viewer).rejects.toThrow("preboot:401");
    await expect(win.__waslahPreboot?.consents).rejects.toThrow("preboot:401");
  });
});
