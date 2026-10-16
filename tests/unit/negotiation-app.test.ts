/**
 * الغرض: اختبارُ سلوكِ طبقةِ قرارِ التفاوضِ من التطبيقِ (`ADR 0286`): هويةٌ من الجلسةِ
 *   الموقَّعةِ لا من الجسمِ، وملكيّةٌ تُطابَقُ قبلَ كلِّ كتابةٍ، ومنافذُ ذرّيّةٌ قائمةٌ
 *   تُنقلُ نتائجُها كما ردّتها القاعدةُ (ممتلئٌ · مدينةٌ أخرى · نافذةٌ مغلقةٌ · بطاقةٌ
 *   قديمةٌ) — لا تُفسَّرُ هنا ولا يُخفَى سببُها.
 * الحالة: منفّذ فعلياً — `ADR 0286`.
 * ينتمي إلى: tests/unit
 * يُغطّي: packages/application/negotiation/negotiation-app.ts ·
 *   apps/gateway/src/routes/negotiations.ts.
 *
 * ## لِمَ اختبارُ طبقةِ القرارِ لا قاعدةِ البياناتِ
 *
 * القاعدةَ تُختبرُ في تكاملِها (`tests/integration`)؛ وههنا يُقاسُ **العقدُ**: أيُّ رمزٍ
 * يُنشرُ لكلِّ حالةِ رفضٍ، وأنَّ كلَّ كتابةٍ تمرُّ بالمنفذِ الذرّيِّ نفسِهِ الذي ناداهُ
 * زرُّ القروبِ القديمُ — فلا كاتبَ ثانٍ للحقيقةِ.
 */

import { describe, expect, it } from "bun:test";
import { createNegotiationRoutes } from "../../apps/gateway/src/routes/negotiations.ts";
import type { DriverProfile } from "../../packages/application/bots/types.ts";
import type {
  ClaimRegistration,
  ClaimWithdrawal,
} from "../../packages/application/dispatch/register-unsubscribed-claim.ts";
import type {
  AdvanceOutcome,
  SelectOutcome,
  SettleOutcome,
} from "../../packages/application/dispatch/rotate-negotiation-turn.ts";
import type {
  MiniAppSessionReader,
  VerifiedViewerSession,
  ViewerSessionRejectionReason,
} from "../../packages/application/identity/ports.ts";
import type { NegotiationAppApi } from "../../packages/application/negotiation/negotiation-app.ts";
import { createNegotiationApp } from "../../packages/application/negotiation/negotiation-app.ts";
import type { PortFailureError } from "../../packages/application/ports/index.ts";
import type { NegotiationAppStore } from "../../packages/infrastructure/negotiation/negotiation-app-store.ts";
import { err, ok, type Result } from "../../packages/shared/result/index.ts";

/** معرّفُ دورةٍ بصيغةِ uuid كما تُقيسُهُ القاعدةُ. */
const NEGOTIATION_ID = "0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1a55";
const DRIVER_ID = "0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1b01" as never;
const RIDER_TELEGRAM = "700001";
const DRIVER_TELEGRAM = "700002";
const ORDER_ID = "0193f0aa-1f3c-7b2e-9a0d-2b6c8e4f1c01" as never;

type Sessions = MiniAppSessionReader;

function sessionReader(telegramUserId: string): Sessions {
  const session = {
    telegramUserId,
    bot: "rider",
    sessionId: "sess-1",
    issuedAtMs: 1,
  } as unknown as VerifiedViewerSession;
  return {
    read: async () => ok(session),
    readSync: () => ok(session),
  };
}

/** جلسةُ سائقٍ — لدلالاتِ مطالبةِ السائقِ وإنهاءِ انتظارِهِ. */
function driverSession(): Sessions {
  return sessionReader(DRIVER_TELEGRAM);
}

function failingSession(reason: ViewerSessionRejectionReason): Sessions {
  return {
    read: async () => err({ code: "SESSION_REJECTED" as const, reason }),
    readSync: () => err({ code: "SESSION_REJECTED" as const, reason }),
  };
}

function driverDirectory(driver: DriverProfile | null) {
  return {
    findByTelegramId: async (telegramUserId: string) =>
      ok(telegramUserId === DRIVER_TELEGRAM ? driver : null),
  };
}

const DRIVER: DriverProfile = {
  id: DRIVER_ID,
  cityId: "jeddah",
  isAvailable: true,
  isVerified: true,
  vehicleType: "sedan",
  vehicleYear: 2020,
  firstName: "سعيد",
  ratingAverage: 4.8,
  ratingCount: 12,
  completedTrips: 340,
  memberSinceYear: 2023,
  chatId: "100200",
  language: "ar",
} as unknown as DriverProfile;

/** مخزنٌ يذكرُ ما نودِعَ فيهِ — فتُقاسُ النداءاتُ لا النتائجُ وحدَها. */
function store(over: Partial<NegotiationAppStore> = {}): NegotiationAppStore {
  return {
    ...storeBase(),
    ...over,
  };
}

function storeBase(): NegotiationAppStore {
  return {
    listForDriver: async () =>
      ok([
        {
          negotiationId: NEGOTIATION_ID,
          orderId: String(ORDER_ID),
          service: "transport",
          pickupLabel: "حي العليا",
          dropoffLabel: "حي الملقا",
          collectSecondsLeft: 120,
          myPosition: null,
        },
      ]),
    findForRider: async () =>
      ok({
        negotiationId: NEGOTIATION_ID,
        orderId: String(ORDER_ID),
        status: "negotiating" as const,
        collectSecondsLeft: 0,
        claimCount: 2,
        activePosition: 1,
      }),
    readRiderDriverCard: async () => ok(null),
    riderOwns: async () => ok(true),
  };
}

function claimsFixture(
  registration: Result<ClaimRegistration, PortFailureError>,
  withdrawal: Result<ClaimWithdrawal, PortFailureError> = ok({ withdrawn: true, position: 1 }),
) {
  const registerClaim = async () => registration;
  const withdrawClaim = async () => withdrawal;
  return { registerClaim, withdrawClaim };
}

function rotationFixture(
  select: Result<SelectOutcome, PortFailureError> = ok({
    selected: true,
    already: false,
    orderId: ORDER_ID,
    position: 1,
    notificationsQueued: 2,
  }),
  settle: Result<SettleOutcome, PortFailureError> = ok({
    settled: true,
    orderId: ORDER_ID,
    driverId: String(DRIVER_ID),
    notificationsQueued: 3,
  }),
  advanceAt: Result<AdvanceOutcome, PortFailureError> = ok({
    advanced: false,
    reason: "STALE_CARD",
  }),
) {
  return {
    select: async () => select,
    settle: async () => settle,
    advanceAt: async () => advanceAt,
    advance: async () =>
      ok<AdvanceOutcome>({
        advanced: true,
        exhausted: true,
        orderId: ORDER_ID,
        notificationsQueued: 1,
      }),
    close: async () => ok(true),
  };
}

function app(over: {
  sessions?: Sessions;
  drivers?: ReturnType<typeof driverDirectory>;
  claims?: ReturnType<typeof claimsFixture>;
  rotation?: ReturnType<typeof rotationFixture>;
  store?: ReturnType<typeof store>;
}): NegotiationAppApi {
  return createNegotiationApp({
    sessions: over.sessions ?? sessionReader(RIDER_TELEGRAM),
    store: over.store ?? store(),
    claims:
      over.claims ??
      claimsFixture(
        ok({
          registered: true,
          claimId: "claim-1",
          orderId: ORDER_ID,
          position: 1,
          slots: 3,
          isActive: true,
          notificationsQueued: 2,
        }),
      ),
    rotation: over.rotation ?? rotationFixture(),
    drivers: over.drivers ?? driverDirectory(DRIVER),
    now: () => new Date("2026-10-16T12:00:00Z"),
  });
}

describe("طبقةُ قرارِ التفاوضِ من التطبيقِ — ADR 0286", () => {
  it("لا جلسةَ ولا رمزَ ⇒ SESSION_REQUIRED لا قراءةَ ولا كتابةَ", async () => {
    const result = await app({}).readDriverNegotiations(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_REQUIRED");
  });

  it("جلسةٌ منتهيةٌ أو باطلةٌ ⇒ رمزُها المميِّزُ لا رمزٌ عامٌّ", async () => {
    const expired = await app({ sessions: failingSession("EXPIRED") }).claimDriverNegotiation(
      "token",
      NEGOTIATION_ID,
    );
    expect(expired.ok).toBe(false);
    if (expired.ok) return;
    expect(expired.error.code).toBe("SESSION_EXPIRED");

    const invalid = await app({
      sessions: failingSession("SIGNATURE_MISMATCH"),
    }).settleRiderAgreement("token", NEGOTIATION_ID);
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.code).toBe("SESSION_INVALID");
  });

  it("معرّفٌ ليس uuid ⇒ NEGOTIATION_ID_INVALID قبلَ أيِّ منفذٍ", async () => {
    const result = await app({ sessions: driverSession() }).claimDriverNegotiation(
      "token",
      "ليس-معرّفًا",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NEGOTIATION_ID_INVALID");
  });

  it("موضعٌ خارجُ [1،3] ⇒ POSITION_INVALID", async () => {
    for (const position of [0, 4, -1, 1.5]) {
      const result = await app({}).selectRiderDriver("token", NEGOTIATION_ID, position);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("POSITION_INVALID");
    }
  });

  it("جلسةٌ بلا سائقٍ مسجَّلٍ ⇒ NOT_A_DRIVER — التطبيقُ يوجِّهُهُ للتهيئةِ لا لبطاقاتِ القروبِ", async () => {
    const result = await app({ drivers: driverDirectory(null) }).readDriverNegotiations("token");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_A_DRIVER");
  });

  it("مطالبةٌ ناجحةٌ ⇒ موضعُ السائقِ وسعةُ الدورةِ كما ردَّتِ القاعدةُ", async () => {
    const result = await app({
      sessions: driverSession(),
      claims: claimsFixture(
        ok({
          registered: true,
          claimId: "claim-2",
          orderId: ORDER_ID,
          position: 2,
          slots: 3,
          isActive: false,
          notificationsQueued: 1,
        }),
      ),
    }).claimDriverNegotiation("token", NEGOTIATION_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ registered: true, position: 2, slots: 3, reason: null });
  });

  it("رفضُ القاعدةِ للمطالبةِ (ممتلئٌ · مدينةٌ أخرى · نافذةٌ مغلقةٌ) يُنقلُ بسببِهِ لا يُخفى", async () => {
    for (const reason of [
      "SLOTS_FULL",
      "CITY_MISMATCH",
      "COLLECT_WINDOW_CLOSED",
      "DRIVER_NOT_VERIFIED",
    ]) {
      const result = await app({
        sessions: driverSession(),
        claims: claimsFixture(ok({ registered: false, reason })),
      }).claimDriverNegotiation("token", NEGOTIATION_ID);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ registered: false, position: null, slots: null, reason });
    }
  });

  it("إنهاءُ الانتظارِ: النتيجةُ والسببُ (CLAIM_ACTIVE) يُنقلانِ كما هما", async () => {
    const withdrawn = await app({
      sessions: driverSession(),
      claims: claimsFixture(
        ok({
          registered: true,
          claimId: "claim-1",
          orderId: ORDER_ID,
          position: 1,
          slots: 3,
          isActive: true,
          notificationsQueued: 2,
        }),
        ok({ withdrawn: true, position: 1 }),
      ),
    }).leaveDriverNegotiation("token", NEGOTIATION_ID);
    expect(withdrawn.ok).toBe(true);
    if (!withdrawn.ok) return;
    expect(withdrawn.value).toEqual({ withdrawn: true, reason: null });

    const active = await app({
      sessions: driverSession(),
      claims: claimsFixture(
        ok({
          registered: true,
          claimId: "claim-1",
          orderId: ORDER_ID,
          position: 1,
          slots: 3,
          isActive: true,
          notificationsQueued: 2,
        }),
        ok({ withdrawn: false, reason: "CLAIM_ACTIVE" }),
      ),
    }).leaveDriverNegotiation("token", NEGOTIATION_ID);
    expect(active.ok).toBe(true);
    if (!active.ok) return;
    expect(active.value).toEqual({ withdrawn: false, reason: "CLAIM_ACTIVE" });
  });

  it("راكبٌ ليس صاحبَ الدورةِ ⇒ NEGOTIATION_NOT_OWNED قبلَ أيِّ كتابةٍ (اختيارٌ · اتفاقٌ · تجاوزٌ)", async () => {
    const notOwned = { ...store(), riderOwns: async () => ok(false) };
    for (const call of [
      (api: NegotiationAppApi) => api.selectRiderDriver("token", NEGOTIATION_ID, 1),
      (api: NegotiationAppApi) => api.settleRiderAgreement("token", NEGOTIATION_ID),
      (api: NegotiationAppApi) => api.advanceRiderDriver("token", NEGOTIATION_ID, 1),
    ]) {
      const result = await call(app({ store: notOwned }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NEGOTIATION_NOT_OWNED");
    }
  });

  it("اختيارٌ سابقٌ للسائقِ نفسِهِ ⇒ already: true — لا إخطارَ ثانٍ", async () => {
    const result = await app({
      rotation: rotationFixture(
        ok({
          selected: true,
          already: true,
          orderId: ORDER_ID,
          position: 1,
          notificationsQueued: 0,
        }),
      ),
    }).selectRiderDriver("token", NEGOTIATION_ID, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ selected: true, already: true });
  });

  it("اتفاقٌ ناجحٌ ⇒ إسنادٌ برقمِ الطلبِ؛ ورفضُهُ (نافذةٌ مغلقةٌ) يُنقلُ بسببِهِ", async () => {
    const settled = await app({}).settleRiderAgreement("token", NEGOTIATION_ID);
    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.value).toMatchObject({ settled: true, orderId: ORDER_ID });

    const refused = await app({
      rotation: rotationFixture(
        undefined,
        ok({ settled: false, reason: "NEGOTIATION_NOT_NEGOTIATING" }),
      ),
    }).settleRiderAgreement("token", NEGOTIATION_ID);
    expect(refused.ok).toBe(true);
    if (!refused.ok) return;
    expect(refused.value).toEqual({ settled: false, reason: "NEGOTIATION_NOT_NEGOTIATING" });
  });

  it("تجاوزُ سائقٍ من بطاقةٍ قديمةٍ ⇒ سببُ STALE_CARD يصلُ كما ردَّتهُ الدالّةُ الذرّيّةُ", async () => {
    const result = await app({}).advanceRiderDriver("token", NEGOTIATION_ID, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ selected: false, reason: "STALE_CARD" });
  });

  it("تعذُّرُ المخزنِ أو المنفذِ ⇒ NEGOTIATION_STORE_NOT_AVAILABLE لا نجاحٌ كاذبٌ", async () => {
    const failing: NegotiationAppStore = {
      ...store(),
      riderOwns: async () => err<"STORE_ERROR">("STORE_ERROR"),
    };
    const result = await app({ store: failing }).settleRiderAgreement("token", NEGOTIATION_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NEGOTIATION_STORE_NOT_AVAILABLE");
  });
});

describe("مساراتُ التفاوضِ من التطبيقِ — خريطةُ الحالاتِ والهويّةُ من الرمزِ", () => {
  function routes(api: NegotiationAppApi) {
    return createNegotiationRoutes({ negotiation: api });
  }

  it("الرمزُ من ترويسةِ Authorization وحدَها — لا هويّةَ في الجسمِ ولا في الاستعلامِ", async () => {
    const seen: string[] = [];
    const api = {
      readDriverNegotiations: async (token?: string) => {
        seen.push(token ?? "NONE");
        return ok({ negotiations: [] });
      },
    } as unknown as NegotiationAppApi;
    const response = await routes(api).request("/v1/driver/negotiations", {
      headers: { authorization: "Bearer tok-123" },
    });
    expect(response.status).toBe(200);
    expect(seen).toEqual(["tok-123"]);
  });

  it("لا طبقةَ قرارٍ ⇒ المساراتُ تُعطَّلُ لا أن تُجيبَ بلا قاعدةٍ", async () => {
    const disabled = createNegotiationRoutes({});
    const response = await disabled.request("/v1/driver/negotiations");
    expect(response.status).toBe(404);
  });

  it("SESSION_REQUIRED ⇒ 401 · NOT_A_DRIVER ⇒ 403 · POSITION_INVALID ⇒ 422 · تعطُّلُ المخزنِ ⇒ 503", async () => {
    const api = app({});
    const noSession = await routes(api).request("/v1/driver/negotiations");
    expect(noSession.status).toBe(401);

    const notDriver = await routes(api).request("/v1/driver/negotiations", {
      headers: { authorization: "Bearer t" },
    });
    // الجلسةُ راكبٌ لا سائقٌ — 403 لا 401: الهويّةُ مقبولةٌ والصلاحيةُ هي المرفوضةُ.
    expect(notDriver.status).toBe(403);

    const badPosition = await routes(api).request(`/v1/negotiations/${NEGOTIATION_ID}/select`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ position: 9 }),
    });
    expect(badPosition.status).toBe(422);

    const failing = { ...store(), riderOwns: async () => err({ code: "PORT_FAILURE" }) as never };
    const storeDown = await routes(app({ store: failing })).request(
      `/v1/negotiations/${NEGOTIATION_ID}/settle`,
      { method: "POST", headers: { authorization: "Bearer t" } },
    );
    expect(storeDown.status).toBe(503);
  });

  it("جسمٌ ليس موضعًا صالحًا ⇒ POSITION_INVALID لا 500", async () => {
    const response = await routes(app({})).request(`/v1/negotiations/${NEGOTIATION_ID}/advance`, {
      method: "POST",
      headers: { authorization: "Bearer t", "content-type": "application/json" },
      body: JSON.stringify({ position: "اثنان" }),
    });
    expect(response.status).toBe(422);
  });
});
