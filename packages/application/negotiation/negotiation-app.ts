/**
 * الغرض: `ADR 0286` — أعمالُ التفاوضِ من داخلِ التطبيقِ المصغَّرِ: مطالبةُ السائقِ
 *   في دورةِ القروبِ وإنهاءُ انتظارِه، وقرارُ الراكبِ (اختيارُ السائقِ · الاتفاقُ ·
 *   تجاوزُ السائقِ). كلُّ كتابةٍ عبرَ الدوالِّ الذرّيّةِ القائمةِ نفسِها التي ناداها
 *   البوتُ — لا كاتبَ ثانٍ ولا مصدرَ حقيقةٍ ثانٍ.
 * الحالة: منفّذ فعلياً — `ADR 0286`.
 * ينتمي إلى: application/negotiation
 * يُستخدم من: `apps/gateway/src/routes/negotiations.ts`.
 *
 * ## ولِمَ الهويّةُ من الجلسةِ لا من الجسمِ
 *
 * لأنَّ المطالبةَ والاختيارَ والاتفاقَ قراراتٌ تُنشئُ إسناداً وتُغلِقُ دورات:
 * معرّفٌ من جسمِ الطلبِ يعني مطالبةً باسمِ غيرِكَ. فالهويّةُ تُقرأُ من الجلسةِ
 * الموقَّعةِ وحدَها، والملكيّةُ تُطابَقُ في القاعدةِ قبلَ أيِّ كتابةٍ.
 *
 * ## وما لا تفعله هذه الطبقةُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا تُرسِلُ إشعاراً**: الإشعاراتُ تُودَعُ في صندوقِ الصادرِ داخلَ معاملةِ
 *      الدالّةِ الذرّيّةِ نفسِها (`BUG-004`) — وهذه طبقةُ قرارٍ لا طبقةُ إرسالٍ.
 *   ــ **لا تحكمُ على انتهاءِ النافذةِ**: تُنقلُ ثواني الخادمِ والحكمَ كما في
 *      لوحِ العروضِ (`ADR 0117`).
 *   ــ **لا تعرفُ أجرةً ولا وسيلةَ دفعٍ** (`ADR 0039`).
 */

import type {
  DriverNegotiationCard,
  NegotiationAppStore,
  RiderNegotiationDriverCard,
  RiderNegotiationSnapshot,
} from "../../infrastructure/negotiation/negotiation-app-store.ts";
import { isUuid } from "../../infrastructure/negotiation/negotiation-app-store.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { DriverDirectory } from "../bots/types.ts";
import type { ClaimRegistrationPort } from "../dispatch/register-unsubscribed-claim.ts";
import type {
  NegotiationRotationPort,
  SelectOutcome,
  SettleOutcome,
} from "../dispatch/rotate-negotiation-turn.ts";
import type { MiniAppSessionReader } from "../identity/ports.ts";

/** رموزُ العطبِ المنشورةُ — تُقرأُ في زمنِ التشغيلِ (القاعدة 0.6). */
export const NEGOTIATION_APP_PUBLIC_ERROR_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "NEGOTIATION_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "NOT_A_RIDER",
  "NEGOTIATION_ID_INVALID",
  "POSITION_INVALID",
  "NEGOTIATION_NOT_FOUND",
  "NEGOTIATION_NOT_OWNED",
] as const;

export type NegotiationAppPublicErrorCode = (typeof NEGOTIATION_APP_PUBLIC_ERROR_CODES)[number];

export interface NegotiationAppRejection {
  readonly code: NegotiationAppPublicErrorCode;
}

export interface NegotiationAppDeps {
  readonly sessions: MiniAppSessionReader;
  readonly store: NegotiationAppStore;
  /** **المنفذُ القائمُ** — كتابةُ المطالبةِ وإنهاءُ الانتظارِ (`register/withdraw`). */
  readonly claims: ClaimRegistrationPort;
  /** **المنفذُ القائمُ** — اختيارُ السائقِ والاتفاقُ والتدويرُ (`select/settle/advanceAt`). */
  readonly rotation: NegotiationRotationPort;
  /** **المنفذُ القائمُ** — حلُّ السائقِ من جلستِهِ. */
  readonly drivers: Pick<DriverDirectory, "findByTelegramId">;
  readonly now: () => Date;
}

function rejection(code: NegotiationAppPublicErrorCode): NegotiationAppRejection {
  return { code };
}

function sessionErrorFrom(reason: string): NegotiationAppPublicErrorCode {
  if (reason === "EXPIRED") return "SESSION_EXPIRED";
  if (reason === "NOT_CONFIGURED") return "SESSION_NOT_AVAILABLE";
  return "SESSION_INVALID";
}

function storeFailure(code: NegotiationAppPublicErrorCode): NegotiationAppRejection {
  return rejection(code);
}

export interface NegotiationAppSession {
  readonly telegramUserId: string;
}

async function openSession(
  deps: NegotiationAppDeps,
  accessToken: string | undefined,
): Promise<Result<string, NegotiationAppRejection>> {
  if (accessToken === undefined || accessToken.length === 0) {
    return err(rejection("SESSION_REQUIRED"));
  }
  const session = await deps.sessions.read(accessToken, deps.now().getTime());
  if (!session.ok) return err(rejection(sessionErrorFrom(session.error.reason)));
  return ok(session.value.telegramUserId);
}

/** نتيجةُ المطالبةِ كما يقرؤها التطبيقُ — حروفُ القاعدةِ الأصليةُ تنقلُ كما هي. */
export interface NegotiationClaimOutcome {
  readonly registered: boolean;
  readonly position: number | null;
  readonly slots: number | null;
  readonly reason: string | null;
}

/** نتيجةُ إنهاءِ الانتظارِ. */
export interface NegotiationLeaveOutcome {
  readonly withdrawn: boolean;
  readonly reason: string | null;
}

export interface NegotiationAppApi {
  /** لوحُ دوراتِ القروبِ المفتوحةِ في مدينةِ السائقِ. */
  readDriverNegotiations(
    accessToken: string | undefined,
  ): Promise<
    Result<{ readonly negotiations: readonly DriverNegotiationCard[] }, NegotiationAppRejection>
  >;
  /** مطالبةٌ في دورةٍ — الدالّةُ الذرّيّةُ نفسُها التي ناداها زرُّ القروبِ. */
  claimDriverNegotiation(
    accessToken: string | undefined,
    negotiationId: string,
  ): Promise<Result<NegotiationClaimOutcome, NegotiationAppRejection>>;
  /** إنهاءُ انتظارِ السائقِ في دورةٍ طالبَ فيها. */
  leaveDriverNegotiation(
    accessToken: string | undefined,
    negotiationId: string,
  ): Promise<Result<NegotiationLeaveOutcome, NegotiationAppRejection>>;
  /** دورةُ الراكبِ المفتوحةُ — أو لا دورةَ. */
  readRiderNegotiation(
    accessToken: string | undefined,
  ): Promise<
    Result<{ readonly negotiation: RiderNegotiationSnapshot | null }, NegotiationAppRejection>
  >;
  /** بطاقةُ السائقِ المعروضِ في موضعِهِ — ملكيّةُ الراكبِ قيدٌ في الاستعلامِ. */
  readRiderDriverCard(
    accessToken: string | undefined,
    negotiationId: string,
    position: number,
  ): Promise<Result<{ readonly card: RiderNegotiationDriverCard | null }, NegotiationAppRejection>>;
  /** اختيارُ السائقِ المعروضِ فتُفتَحُ المحادثةُ — الدالّةُ الذرّيّةُ نفسُها. */
  selectRiderDriver(
    accessToken: string | undefined,
    negotiationId: string,
    position: number,
  ): Promise<Result<SelectOutcome, NegotiationAppRejection>>;
  /** الاتفاقُ — إسنادٌ ذرّيٌّ عبرَ `settle_unsubscribed_negotiation`. */
  settleRiderAgreement(
    accessToken: string | undefined,
    negotiationId: string,
  ): Promise<Result<SettleOutcome, NegotiationAppRejection>>;
  /** تجاوزُ السائقِ المعروضِ — تدويرٌ بحارسِ البطاقةِ (`advanceAt`). */
  advanceRiderDriver(
    accessToken: string | undefined,
    negotiationId: string,
    position: number,
  ): Promise<Result<SelectOutcome, NegotiationAppRejection>>;
}

/**
 * طبقةُ قرارِ التفاوضِ — كلُّ كتابةٍ منفذٌ قائمٌ، وكلُّ قراءةٍ من المخزنِ، والهويّةُ
 * من الجلسةِ الموقَّعةِ.
 */
export function createNegotiationApp(deps: NegotiationAppDeps): NegotiationAppApi {
  return {
    readDriverNegotiations: async (accessToken) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      const driver = await deps.drivers.findByTelegramId(session.value);
      if (!driver.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      if (driver.value === null) return err(rejection("NOT_A_DRIVER"));
      const board = await deps.store.listForDriver(session.value);
      if (!board.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      return ok({ negotiations: board.value });
    },

    claimDriverNegotiation: async (accessToken, negotiationId) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      if (!isUuid(negotiationId)) return err(rejection("NEGOTIATION_ID_INVALID"));
      const driver = await deps.drivers.findByTelegramId(session.value);
      if (!driver.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      if (driver.value === null) return err(rejection("NOT_A_DRIVER"));
      const registered = await deps.claims.registerClaim(negotiationId, driver.value.id);
      if (!registered.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      const outcome = registered.value;
      return ok(
        outcome.registered
          ? {
              registered: true,
              position: outcome.position,
              slots: outcome.slots,
              reason: null,
            }
          : { registered: false, position: null, slots: null, reason: outcome.reason },
      );
    },

    leaveDriverNegotiation: async (accessToken, negotiationId) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      if (!isUuid(negotiationId)) return err(rejection("NEGOTIATION_ID_INVALID"));
      const driver = await deps.drivers.findByTelegramId(session.value);
      if (!driver.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      if (driver.value === null) return err(rejection("NOT_A_DRIVER"));
      const withdrawn = await deps.claims.withdrawClaim(negotiationId, driver.value.id);
      if (!withdrawn.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      const outcome = withdrawn.value;
      return ok({
        withdrawn: outcome.withdrawn,
        reason: outcome.withdrawn ? null : outcome.reason,
      });
    },

    readRiderNegotiation: async (accessToken) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      const negotiation = await deps.store.findForRider(session.value);
      if (!negotiation.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      return ok({ negotiation: negotiation.value });
    },

    readRiderDriverCard: async (accessToken, negotiationId, position) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      if (!isUuid(negotiationId)) return err(rejection("NEGOTIATION_ID_INVALID"));
      if (!Number.isInteger(position) || position < 1 || position > 3) {
        return err(rejection("POSITION_INVALID"));
      }
      const card = await deps.store.readRiderDriverCard(negotiationId, position, session.value);
      if (!card.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      return ok({ card: card.value });
    },

    selectRiderDriver: async (accessToken, negotiationId, position) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      if (!isUuid(negotiationId)) return err(rejection("NEGOTIATION_ID_INVALID"));
      if (!Number.isInteger(position) || position < 1 || position > 3) {
        return err(rejection("POSITION_INVALID"));
      }
      const owned = await deps.store.riderOwns(session.value, negotiationId);
      if (!owned.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      if (!owned.value) return err(rejection("NEGOTIATION_NOT_OWNED"));
      const selected = await deps.rotation.select(negotiationId, position);
      if (!selected.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      return ok(selected.value);
    },

    settleRiderAgreement: async (accessToken, negotiationId) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      if (!isUuid(negotiationId)) return err(rejection("NEGOTIATION_ID_INVALID"));
      const owned = await deps.store.riderOwns(session.value, negotiationId);
      if (!owned.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      if (!owned.value) return err(rejection("NEGOTIATION_NOT_OWNED"));
      const settled = await deps.rotation.settle(negotiationId);
      if (!settled.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      return ok(settled.value);
    },

    advanceRiderDriver: async (accessToken, negotiationId, position) => {
      const session = await openSession(deps, accessToken);
      if (!session.ok) return err(session.error);
      if (!isUuid(negotiationId)) return err(rejection("NEGOTIATION_ID_INVALID"));
      if (!Number.isInteger(position) || position < 1 || position > 3) {
        return err(rejection("POSITION_INVALID"));
      }
      const owned = await deps.store.riderOwns(session.value, negotiationId);
      if (!owned.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      if (!owned.value) return err(rejection("NEGOTIATION_NOT_OWNED"));
      // تجاوزُ السائقِ المعروضِ: تدويرٌ بحارسِ البطاقةِ — الزرُّ على موضعٍ قديمٍ
      // يُرَدُّ `STALE_CARD` من الدالّةِ نفسِها، فلا يُعادَ فتحُ دورٍ من بطاقةٍ ميتةٍ.
      const advanced = await deps.rotation.advanceAt(negotiationId, position, "declined");
      if (!advanced.ok) return err(storeFailure("NEGOTIATION_STORE_NOT_AVAILABLE"));
      const outcome = advanced.value;
      return ok(
        outcome.advanced
          ? { selected: false, reason: "ADVANCED" }
          : { selected: false, reason: outcome.reason },
      );
    },
  };
}
