/**
 * الغرض: مساراتُ التفاوضِ من التطبيقِ المصغَّرِ (`ADR 0286`): مطالبةُ السائقِ في
 *   دورةِ القروبِ (`GET /v1/driver/negotiations` · `POST …/claim` · `POST …/leave`)
 *   وقرارُ الراكبِ (`GET /v1/negotiations` · `POST …/select` · `POST …/settle` ·
 *   `POST …/advance`). كلُّ كتابةٍ منفذٌ قائمٌ لا مساراً ثانياً للحقيقةِ.
 * الحالة: منفَّذٌ فعليّاً — `ADR 0286`.
 * ينتمي إلى: apps/gateway/src/routes
 * يُستخدم من: `apps/gateway/src/server.ts` عبرَ تركيبٍ اختياريٍّ.
 *
 * ## ولِمَ المطالبةُ `POST` على مورِدِ الدورةِ
 *
 * لأنَّ السائقَ لا يملكُ الدورةَ: يملكُ قرارَ المطالبةِ فيها. وحقُّهُ فعلٌ على
 * الدورةِ بجلسةٍ موقَّعةٍ، والملكيّةَ تحكمُ بها الدالّةُ الذرّيّةُ (`CITY_MISMATCH` ·
 * `DRIVER_NOT_VERIFIED` · `SLOTS_FULL`) كما كانت في زرِّ القروبِ.
 *
 * ## وما لا تفعلُه هذه المساراتُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تقرأُ هويّةً من الجسمِ**: من الرمزِ الموقَّعِ وحدَه.
 *   ــ **لا تُرسِلُ إشعاراً**: الإشعارُ صفٌّ في صندوقِ الصادرِ تودِعُه الدالّةُ الذرّيّةُ.
 *   ــ **لا تُنشئُ دورةً ولا تُغلِقُ جولةَ بثٍّ**: فتحُ الدورةِ عملُ الموزِّعِ.
 */

import { type Context, Hono } from "hono";
import type {
  NegotiationAppApi,
  NegotiationAppPublicErrorCode,
} from "../../../../packages/application/negotiation/negotiation-app.ts";

export interface NegotiationRouteDependencies {
  /** غيابُها **يُعطّلُ المساراتِ بـ503** ولا يجعلها تُجيبُ بلا قاعدةٍ. */
  readonly negotiation?: NegotiationAppApi;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
}

/** خريطةُ الحالاتِ — **شاملةٌ حرفاً** لاتّحادِ رموزِ الطبقةِ. */
const STATUS_BY_ERROR: Readonly<
  Record<NegotiationAppPublicErrorCode, 401 | 403 | 404 | 409 | 422 | 503>
> = {
  SESSION_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  SESSION_INVALID: 401,
  SESSION_NOT_AVAILABLE: 503,
  NEGOTIATION_STORE_NOT_AVAILABLE: 503,
  NOT_A_DRIVER: 403,
  NOT_A_RIDER: 403,
  NEGOTIATION_ID_INVALID: 422,
  POSITION_INVALID: 422,
  NEGOTIATION_NOT_FOUND: 404,
  NEGOTIATION_NOT_OWNED: 403,
};

function rejected(c: Context, code: NegotiationAppPublicErrorCode) {
  return c.json({ ok: false, error: code }, STATUS_BY_ERROR[code]);
}

function bearerTokenFrom(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

const MAX_BODY_BYTES = 512;

async function readJsonBody(c: Context): Promise<Record<string, unknown> | null> {
  const raw = await c.req.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readPosition(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 3 ? parsed : null;
}

export function createNegotiationRoutes(deps: NegotiationRouteDependencies): Hono {
  const app = new Hono();

  if (deps.negotiation === undefined) {
    deps.log?.("negotiation.routes_disabled", {});
    // المساراتُ تُعلَّقُ بلا طبقةِ قرارٍ — لا تُجيبُ كأنَّ لا عملَ.
    return app;
  }
  const negotiation = deps.negotiation;

  /** دوراتُ القروبِ المفتوحةُ في مدينةِ السائقِ. */
  app.get("/v1/driver/negotiations", async (c) => {
    const result = await negotiation.readDriverNegotiations(
      bearerTokenFrom(c.req.header("authorization")),
    );
    if (!result.ok) return rejected(c, result.error.code);
    const board = result.value;
    return c.json({ ok: true, negotiations: board.negotiations });
  });

  app.post("/v1/driver/negotiations/:id/claim", async (c) => {
    const result = await negotiation.claimDriverNegotiation(
      bearerTokenFrom(c.req.header("authorization")),
      c.req.param("id"),
    );
    if (!result.ok) return rejected(c, result.error.code);
    const outcome = result.value;
    return c.json({
      ok: true,
      registered: outcome.registered,
      position: outcome.position,
      slots: outcome.slots,
      reason: outcome.reason,
    });
  });

  app.post("/v1/driver/negotiations/:id/leave", async (c) => {
    const result = await negotiation.leaveDriverNegotiation(
      bearerTokenFrom(c.req.header("authorization")),
      c.req.param("id"),
    );
    if (!result.ok) return rejected(c, result.error.code);
    const outcome = result.value;
    return c.json({
      ok: true,
      withdrawn: outcome.withdrawn,
      reason: outcome.reason,
    });
  });

  /** دورةُ الراكبِ المفتوحةُ لطلبِهِ الجاري. */
  app.get("/v1/negotiations", async (c) => {
    const result = await negotiation.readRiderNegotiation(
      bearerTokenFrom(c.req.header("authorization")),
    );
    if (!result.ok) return rejected(c, result.error.code);
    const read = result.value;
    if (read.negotiation === null) return c.json({ ok: true, negotiation: null });
    const negotiationView = read.negotiation;
    return c.json({ ok: true, negotiation: negotiationView });
  });

  /** بطاقةُ السائقِ المعروضِ في موضعِهِ — ملكيّةُ الراكبِ قيدٌ في الاستعلامِ. */
  app.get("/v1/negotiations/:id/card", async (c) => {
    const positionRaw = c.req.query("position");
    const position = readPosition(positionRaw === undefined ? Number.NaN : Number(positionRaw));
    if (position === null) return rejected(c, "POSITION_INVALID");
    const result = await negotiation.readRiderDriverCard(
      bearerTokenFrom(c.req.header("authorization")),
      c.req.param("id"),
      position,
    );
    if (!result.ok) return rejected(c, result.error.code);
    const read = result.value;
    return c.json({ ok: true, card: read.card });
  });

  app.post("/v1/negotiations/:id/select", async (c) => {
    const body = await readJsonBody(c);
    const position = body === null ? null : readPosition(body.position);
    if (position === null) return rejected(c, "POSITION_INVALID");
    const result = await negotiation.selectRiderDriver(
      bearerTokenFrom(c.req.header("authorization")),
      c.req.param("id"),
      position,
    );
    if (!result.ok) return rejected(c, result.error.code);
    const outcome = result.value;
    return c.json({
      ok: true,
      selected: outcome.selected,
      already: outcome.selected ? outcome.already : false,
      reason: outcome.selected ? null : outcome.reason,
    });
  });

  app.post("/v1/negotiations/:id/settle", async (c) => {
    const result = await negotiation.settleRiderAgreement(
      bearerTokenFrom(c.req.header("authorization")),
      c.req.param("id"),
    );
    if (!result.ok) return rejected(c, result.error.code);
    const outcome = result.value;
    return c.json({
      ok: true,
      settled: outcome.settled,
      order_id: outcome.settled ? outcome.orderId : null,
      reason: outcome.settled ? null : outcome.reason,
    });
  });

  app.post("/v1/negotiations/:id/advance", async (c) => {
    const body = await readJsonBody(c);
    const position = body === null ? null : readPosition(body.position);
    if (position === null) return rejected(c, "POSITION_INVALID");
    const result = await negotiation.advanceRiderDriver(
      bearerTokenFrom(c.req.header("authorization")),
      c.req.param("id"),
      position,
    );
    if (!result.ok) return rejected(c, result.error.code);
    const outcome = result.value;
    return c.json({
      ok: true,
      selected: false,
      reason: outcome.selected ? null : outcome.reason,
    });
  });

  return app;
}
