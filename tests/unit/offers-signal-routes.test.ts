/**
 * الغرض: اختبارُ انحدارِ مسارَي إشارةِ اللوحِ — `LOAD-01 Recovery` (المرحلة
 *   6-استكمال): إيصالاتُ اللوحِ (مسارُ العميلِ) ومسارُ الإشارةِ الداخليُّ
 *   (مسارُ الخدمةِ). القواعدُ: لا إيصالَ بلا جلسةٍ موقَّعةٍ، ولا إشارةَ بلا
 *   سرٍّ مشتركٍ (غيابُهُ تعطيلٌ معلَنٌ لا فتحٌ لكلِّ أحدٍ)، والغائبُ عنِ
 *   الغرفةِ لا يُزعَمُ بثٌّ لهُ.
 * الحالة: منفَّذٌ فعليّاً.
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import type { Hono } from "hono";
import {
  createDriverOfferRoutes,
  type DriverOfferRouteDependencies,
} from "../../apps/gateway/src/routes/driver-offers.ts";
import { createInternalOffersSignalRoutes } from "../../apps/gateway/src/routes/internal-offers-signal.ts";
import type { DriverOfferDeps } from "../../packages/application/driver/driver-offers.ts";
import type { DriverOfferStore } from "../../packages/application/driver/offer-ports.ts";
import { ok, type Result } from "../../packages/shared/result/index.ts";

const TOKEN = "session-token-1";
const SECRET = "internal-secret-16-chars-min";

/** جلسةُ سائقٍ موقَّعةٌ — الهويةَ منها لا منَ الجسمِ. */
function fakeDriverOffersDeps(recorded: { offerIds: string[] }): DriverOfferRouteDependencies {
  const sessions = {
    read: async (accessToken: string): Promise<Result<never, never>> => {
      if (accessToken !== TOKEN) {
        return { ok: false, error: { reason: "SESSION_INVALID" } } as never;
      }
      return {
        ok: true,
        value: { telegramUserId: "990001", bot: "driver" },
      } as never;
    },
    readSync: () => ({ ok: false }) as never,
  };
  const store = {
    readBoard: async () => ({ ok: false }) as never,
    readDetail: async () => ({ ok: false }) as never,
    accept: async () => ({ ok: false }) as never,
    reject: async () => ({ ok: false }) as never,
    setAvailability: async () => ({ ok: false }) as never,
    // المحاكاةُ مطابقةٌ للعقدِ الحقيقيِّ: المعرّفاتُ غيرُ الصالحةِ (UUID)
    // تُهمَلُ صامتةً في المخزنِ لا في المسارِ — سلوكُ المخزنِ هوَ الحكمَ.
    recordBoardReceipts: async (input: { offerIds: readonly string[] }) => {
      const valid = input.offerIds.filter((id) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
      );
      recorded.offerIds.push(...valid);
      return ok({ recorded: valid.length });
    },
  } as unknown as DriverOfferStore;
  const offers: DriverOfferDeps = {
    sessions,
    store,
    drivers: {
      findByTelegramId: async () => ok(null),
      setAvailability: async () => ({ ok: false }) as never,
    },
    offers: { reject: async () => ({ ok: false }) as never },
    now: () => new Date(0),
  };
  return { offers, log: () => undefined };
}

async function postJson(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("إيصالاتُ لوحِ العروضِ — مسارُ العميلِ", () => {
  it("بلا جلسةٍ: 401 — الإيصالُ عقدٌ بينَ عميلٍ موثَّقٍ وخدمةِ التسليمِ", async () => {
    const app = createDriverOfferRoutes(fakeDriverOffersDeps({ offerIds: [] }));
    const res = await postJson(app, "/v1/driver/offers/receipts", { offer_ids: ["o-1"] });
    expect(res.status).toBe(401);
  });

  it("بجلسةٍ: الإيصالُ يُسجَّلُ بما رُدَّ فعلًا — والمعرّفاتُ غيرُ الصالحةِ تُهمَلُ", async () => {
    const recorded = { offerIds: [] as string[] };
    const app = createDriverOfferRoutes(fakeDriverOffersDeps(recorded));
    const res = await postJson(
      app,
      "/v1/driver/offers/receipts",
      { offer_ids: ["11111111-1111-1111-1111-111111111111", "ليس-معرّفًا"] },
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recorded: number };
    expect(body.ok).toBe(true);
    expect(body.recorded).toBe(1);
    expect(recorded.offerIds).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  it("جسمٌ بلا offer_ids: صفرٌ مسجَّلٍ لا خطأَ", async () => {
    const app = createDriverOfferRoutes(fakeDriverOffersDeps({ offerIds: [] }));
    const res = await postJson(
      app,
      "/v1/driver/offers/receipts",
      {},
      { authorization: `Bearer ${TOKEN}` },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recorded: number };
    expect(body.recorded).toBe(0);
  });
});

describe("مسارُ الإشارةِ الداخليُّ — سرٌّ مشتركٌ لا فتحٌ لكلِّ أحدٍ", () => {
  it("السرُّ غيرُ مضبوطٍ: تعطيلٌ معلَنٌ (503) لا فتحٌ", async () => {
    const app = createInternalOffersSignalRoutes({
      isDriverConnected: () => true,
      notifyDriver: () => undefined,
      secret: null,
    });
    const res = await postJson(app, "/internal/realtime/offers-signal", {
      telegram_user_id: "990001",
    });
    expect(res.status).toBe(503);
  });

  it("بلا سرٍّ أو بسرٍّ خاطئٍ: 401 — لا يُفتحُ المسارُ للعالمِ", async () => {
    const app = createInternalOffersSignalRoutes({
      isDriverConnected: () => true,
      notifyDriver: () => undefined,
      secret: SECRET,
    });
    const noHeader = await postJson(app, "/internal/realtime/offers-signal", {
      telegram_user_id: "990001",
    });
    expect(noHeader.status).toBe(401);
    const wrong = await postJson(
      app,
      "/internal/realtime/offers-signal",
      { telegram_user_id: "990001" },
      { "x-internal-secret": "wrong-secret-wrong-secret" },
    );
    expect(wrong.status).toBe(401);
  });

  it("معرّفُ تيليجرامَ غيرُ الصالحِ: 422 — لا يُصدَّقُ منَ الغيبِ", async () => {
    const app = createInternalOffersSignalRoutes({
      isDriverConnected: () => true,
      notifyDriver: () => undefined,
      secret: SECRET,
    });
    const res = await postJson(
      app,
      "/internal/realtime/offers-signal",
      { telegram_user_id: "abc" },
      { "x-internal-secret": SECRET },
    );
    expect(res.status).toBe(422);
  });

  it("السائقُ في الغرفةِ: إشارةٌ ثمَّ emitted: true", async () => {
    let signaled = 0;
    const app = createInternalOffersSignalRoutes({
      isDriverConnected: () => true,
      notifyDriver: () => {
        signaled += 1;
      },
      secret: SECRET,
    });
    const res = await postJson(
      app,
      "/internal/realtime/offers-signal",
      { telegram_user_id: "990001" },
      { "x-internal-secret": SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emitted: boolean };
    expect(body.emitted).toBe(true);
    expect(signaled).toBe(1);
  });

  it("السائقُ خارجَ الغرفةِ: لا بثَّ ولا انتظارَ — emitted: false", async () => {
    let signaled = 0;
    const app = createInternalOffersSignalRoutes({
      isDriverConnected: () => false,
      notifyDriver: () => {
        signaled += 1;
      },
      secret: SECRET,
    });
    const res = await postJson(
      app,
      "/internal/realtime/offers-signal",
      { telegram_user_id: "990001" },
      { "x-internal-secret": SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emitted: boolean };
    expect(body.emitted).toBe(false);
    expect(signaled).toBe(0);
  });
});
