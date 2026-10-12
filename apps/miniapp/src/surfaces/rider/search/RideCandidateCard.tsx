/**
 * الغرض: بطاقةُ «سائقٌ قبِلَ طلبَك» (`WR-09` · ADR 0266) — اسمُه وتقييمُه ومركبتُه ولوحتُه
 *   وبُعدُه، ومهلةُ القرارِ بساعةِ الخادم، وزرّا «اختيار» و«رفض ومتابعة البحث».
 * الحالة: منفّذ فعلياً — 2026-10-12.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `SearchScreen.tsx` ما دامَ الطلبُ في البحث.
 *
 * ## لِمَ لا استقصاءَ
 *
 * `ADR 0035` §٤ (`check-system-screens-policy`): لا `setInterval` ولا مؤقّتَ يُعيدُ القراءة.
 * فالقراءةُ عندَ الدخولِ، وعندَ عودةِ الصفحةِ إلى الواجهةِ (`visibilitychange` — الراكبُ
 * عادَ من إشعارِ تيليجرام)، وعندَ «تحديث» في الشاشةِ الأمّ (`refreshToken`). والعدُّ شريطُ
 * CSS في `UiTimer` لا عقرب، والنصُّ يقولُ «بقيَ كذا عندَ العرض» صراحةً.
 *
 * ## وما لا تفعلُه
 *
 * لا تُقرِّرُ انتهاءَ المهلةِ بنفسِها: القاعدةُ تحكمُ (`CANDIDATE_EXPIRED`)، والزرُّ يبقى
 * ما دامَت البطاقةُ معروضة. ولا تعرضُ معرّفَ تيليجرام ولا رقمَ هاتفِ السائق.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { UiCard, UiTimer } from "../../../system/ui/index.tsx";
import {
  type ApiRideCandidate,
  decideRideCandidate,
  type RideCandidateDecisionResponse,
  type RideCandidateResponse,
  readRideCandidate,
} from "./candidate-api.ts";

const KNOWN_DECISION_ERRORS: ReadonlySet<string> = new Set([
  "CANDIDATE_EXPIRED",
  "CANDIDATE_CHANGED",
  "ORDER_NOT_SEARCHING",
]);

const URGENT_SECONDS = 5;

const KNOWN_VEHICLES: ReadonlySet<string> = new Set([
  "sedan",
  "suv",
  "van",
  "pickup",
  "motorcycle",
]);

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

export function candidateErrorKey(code: string): string {
  return KNOWN_DECISION_ERRORS.has(code)
    ? `rider.search.candidate.error.${code}`
    : "rider.search.candidate.error.UNKNOWN";
}

/** الباقي لحظةَ الرسم: ما قالَه الخادمُ ناقصاً ما مضى بساعةٍ محلّيّةٍ واحدة. */
export function candidateSecondsAtRender(secondsLeftAtRead: number, elapsedMs: number): number {
  if (!Number.isFinite(secondsLeftAtRead) || !Number.isFinite(elapsedMs)) return 0;
  return Math.max(0, Math.ceil(secondsLeftAtRead - Math.max(0, elapsedMs) / 1000));
}

export interface RideCandidateCardProps {
  readonly orderId: string;
  readonly language: MiniAppLanguage;
  /** يزدادُ مع كلِّ «تحديث» في الشاشةِ الأمّ فتُعادُ القراءة. */
  readonly refreshToken?: number;
  readonly read?: (orderId: string) => Promise<RideCandidateResponse>;
  readonly decide?: (
    orderId: string,
    driverId: string,
    decision: "accept" | "reject",
  ) => Promise<RideCandidateDecisionResponse>;
  /** بعدَ «اختيار» ناجحٍ — الشاشةُ الأمُّ تُعيدُ القراءةَ فترى `matched`. */
  readonly onDecided?: (decision: "accepted" | "rejected") => void;
  readonly now?: () => number;
}

type Shown =
  | { readonly kind: "none" }
  | { readonly kind: "candidate"; readonly candidate: ApiRideCandidate; readonly readAtMs: number };

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly key: string }
  | { readonly kind: "failed"; readonly key: string };

const systemNowMs = (): number => Date.now();

export function RideCandidateCard({
  orderId,
  language,
  refreshToken = 0,
  read = readRideCandidate,
  decide = decideRideCandidate,
  onDecided,
  now = systemNowMs,
}: RideCandidateCardProps) {
  const t = miniAppTranslator(language);
  const [shown, setShown] = useState<Shown>({ kind: "none" });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  /** ردٌّ متأخِّرٌ لقراءةٍ قديمةٍ يُطرَح. */
  const issued = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++issued.current;
    try {
      const response = await read(orderId);
      if (ticket !== issued.current) return;
      setShown(
        response.candidate === null
          ? { kind: "none" }
          : { kind: "candidate", candidate: response.candidate, readAtMs: now() },
      );
    } catch {
      // القراءةُ تكميليّة: فشلُها لا يُسقِطُ شاشةَ البحث، والبطاقةُ تبقى على آخرِ حال.
    }
  }, [now, orderId, read]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken يُعيدُ القراءةَ قصداً.
  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const choose = useCallback(
    async (driverId: string, decision: "accept" | "reject") => {
      setOutcome({ kind: "busy" });
      try {
        const result = await decide(orderId, driverId, decision);
        setShown({ kind: "none" });
        setOutcome({
          kind: "done",
          key:
            result.decision === "accepted"
              ? "rider.search.candidate.accepted"
              : "rider.search.candidate.rejected",
        });
        onDecided?.(result.decision);
      } catch (thrown) {
        const code = codeOf(thrown);
        if (code === "CANDIDATE_EXPIRED" || code === "CANDIDATE_CHANGED")
          setShown({ kind: "none" });
        setOutcome({ kind: "failed", key: candidateErrorKey(code) });
        if (code === "CANDIDATE_CHANGED") void load();
      }
    },
    [decide, load, onDecided, orderId],
  );

  if (shown.kind === "none") {
    if (outcome.kind === "done") {
      return (
        <p className="rs__candidate-done" role="status">
          {t(outcome.key)}
        </p>
      );
    }
    if (outcome.kind === "failed") {
      return (
        <p className="rs__candidate-error" role="status">
          {t(outcome.key)}
        </p>
      );
    }
    return null;
  }

  const c = shown.candidate;
  const remaining = candidateSecondsAtRender(c.seconds_left, now() - shown.readAtMs);
  const total = Math.max(c.seconds_left, remaining);
  const unknown = "—";
  const rating =
    c.rating_average === null || c.rating_count === 0
      ? t("rider.search.candidate.unrated")
      : `${c.rating_average.toFixed(1)} ★ (${c.rating_count})`;
  const vehicle =
    c.vehicle === null
      ? unknown
      : KNOWN_VEHICLES.has(c.vehicle)
        ? t(`vehicle.type.${c.vehicle}`)
        : c.vehicle;
  const busy = outcome.kind === "busy";

  return (
    <div className="rs__candidate" aria-live="assertive">
      <UiCard title={t("rider.search.candidate.title")}>
        <p className="rs__candidate-body">{t("rider.search.candidate.body")}</p>
        <UiTimer
          label={t("rider.search.candidate.timerLabel")}
          deadlineText={
            remaining > 0
              ? t("rider.search.candidate.leftAtRender").replace("{value}", String(remaining))
              : t("rider.search.candidate.elapsed")
          }
          remainingSeconds={remaining}
          totalSeconds={total}
          tone={remaining <= 0 ? "bad" : remaining <= URGENT_SECONDS ? "amber" : "neutral"}
        />
        <dl className="rs__candidate-facts">
          <dt>{t("rider.search.candidate.driver")}</dt>
          <dd>{c.driver_name ?? unknown}</dd>
          <dt>{t("rider.search.candidate.rating")}</dt>
          <dd>{rating}</dd>
          <dt>{t("rider.search.candidate.vehicle")}</dt>
          <dd>{vehicle}</dd>
          <dt>{t("rider.search.candidate.plate")}</dt>
          <dd dir="auto">{c.plate ?? unknown}</dd>
          {c.distance_km === null ? null : (
            <>
              <dt>{t("rider.search.candidate.distance")}</dt>
              <dd>
                {t("rider.search.candidate.distanceValue").replace(
                  "{value}",
                  c.distance_km.toFixed(1),
                )}
              </dd>
            </>
          )}
        </dl>
        <div className="rs__candidate-actions">
          <button
            type="button"
            className="sys__action rs__candidate-accept"
            disabled={busy}
            onClick={() => void choose(c.driver_id, "accept")}
          >
            {t("rider.search.candidate.accept")}
          </button>
          <button
            type="button"
            className="rs__candidate-reject"
            disabled={busy}
            onClick={() => void choose(c.driver_id, "reject")}
          >
            {t("rider.search.candidate.reject")}
          </button>
        </div>
        {outcome.kind === "failed" ? (
          <p className="rs__candidate-error" role="status">
            {t(outcome.key)}
          </p>
        ) : null}
      </UiCard>
    </div>
  );
}
