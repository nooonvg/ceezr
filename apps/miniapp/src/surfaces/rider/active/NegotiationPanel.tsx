/**
 * الغرض: `ADR 0286` — لوحةُ قرارِ الراكبِ في تفاوضِ القروبِ داخلَ التطبيقِ: دورةٌ
 *   تَجمَعُ مطالباتِ السائقينَ (عددُها ونافذتُها)، وحينَ تُعرَضُ بطاقةُ سائقٍ
 *   فالاختيارُ والاتفاقُ والتجاوزُ هنا لا في زرِّ محادثةٍ. البوتُ يُخبِرُ ويُحيلُ،
 *   والقرارُ بجلسةٍ موقَّعةٍ وملكيّةٍ تُطابَقُ في القاعدةِ.
 * الحالة: منفّذ فعلياً — `ADR 0286`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `ActiveRideScreen.tsx` ما دامَ الطلبُ في البحثِ.
 *
 * ## لِمَ لا استقصاءَ
 *
 * `ADR 0035` §٤: لا `setInterval` — القراءةُ عندَ الدخولِ وعندَ تحديثِ الشاشةِ الأمّ
 * (`refreshToken`). والباقي شريطُ CSS في `UiTimer` لا عقربٌ يُخترَعُ.
 *
 * ## وما لا تفعلُه
 *
 * لا تُقرِّرُ انتهاءَ النافذةِ بنفسِها: القاعدةُ تحكمُ (`COLLECT_WINDOW_CLOSED`).
 * ولا تعرضُ هاتفَ سائقٍ ولا لوحتَه — الاسمُ الأوّلُ كما في بطاقةِ البوتِ نفسِها.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { UiCard, UiTimer } from "../../../system/ui/index.tsx";
import {
  type ApiNegotiationDriverCard,
  type ApiRiderNegotiation,
  advanceNegotiationDriver,
  readNegotiationDriverCard,
  readRiderNegotiation,
  selectNegotiationDriver,
  settleNegotiation,
} from "./negotiation-api.ts";

export interface NegotiationPanelProps {
  readonly language: MiniAppLanguage;
  /** يزدادُ مع كلِّ «تحديث» في الشاشةِ الأمّ فتُعادُ القراءة. */
  readonly refreshToken?: number;
  readonly read?: () => Promise<{ ok: true; negotiation: ApiRiderNegotiation | null }>;
  readonly readCard?: (
    negotiationId: string,
    position: number,
  ) => Promise<{ ok: true; card: ApiNegotiationDriverCard | null }>;
  readonly select?: (
    negotiationId: string,
    position: number,
  ) => Promise<{ ok: true; selected: boolean; already: boolean }>;
  readonly settle?: (negotiationId: string) => Promise<{ ok: true; settled: boolean }>;
  readonly advance?: (
    negotiationId: string,
    position: number,
  ) => Promise<{ ok: true; reason: string | null }>;
  /** بعدَ حسمٍ ناجحٍ — الشاشةُ الأمُّ تُعيدُ القراءةَ فترى `matched`. */
  readonly onSettled?: () => void;
  readonly now?: () => number;
}

type Shown =
  | { readonly kind: "none" }
  | {
      readonly kind: "cycle";
      readonly negotiation: ApiRiderNegotiation;
      readonly readAtMs: number;
      readonly driver: ApiNegotiationDriverCard | null;
    };

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly key: string };

const systemNowMs = (): number => Date.now();

export function NegotiationPanel({
  language,
  refreshToken = 0,
  read = readRiderNegotiation,
  readCard = readNegotiationDriverCard,
  select = selectNegotiationDriver,
  settle = settleNegotiation,
  advance = advanceNegotiationDriver,
  onSettled,
  now = systemNowMs,
}: NegotiationPanelProps) {
  const t = miniAppTranslator(language);
  const [shown, setShown] = useState<Shown>({ kind: "none" });
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const issued = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++issued.current;
    try {
      const response = await read();
      if (ticket !== issued.current) return;
      const negotiation = response.negotiation;
      if (negotiation === null) {
        setShown({ kind: "none" });
        return;
      }
      let driver: ApiNegotiationDriverCard | null = null;
      if (negotiation.status === "negotiating" && negotiation.activePosition !== null) {
        try {
          const card = await readCard(negotiation.negotiationId, negotiation.activePosition);
          if (ticket !== issued.current) return;
          driver = card.card;
        } catch {
          driver = null;
        }
      }
      setShown({ kind: "cycle", negotiation, readAtMs: now(), driver });
    } catch {
      if (ticket !== issued.current) return;
      setShown({ kind: "none" });
    }
  }, [read, readCard, now]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshToken يُعيدُ القراءةَ قصداً.
  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  if (shown.kind === "none") return null;
  const { negotiation, driver } = shown;

  const handleSelect = async () => {
    if (negotiation.activePosition === null) return;
    setOutcome({ kind: "busy" });
    try {
      const decided = await select(negotiation.negotiationId, negotiation.activePosition);
      if (!decided.selected && !decided.already) {
        setOutcome({ kind: "failed", key: "rider.negotiation.error.STALE" });
        return;
      }
      setOutcome({ kind: "idle" });
      await load();
    } catch {
      setOutcome({ kind: "failed", key: "rider.negotiation.error.UNKNOWN" });
    }
  };

  const handleAdvance = async () => {
    if (negotiation.activePosition === null) return;
    setOutcome({ kind: "busy" });
    try {
      await advance(negotiation.negotiationId, negotiation.activePosition);
      setOutcome({ kind: "idle" });
      await load();
    } catch {
      setOutcome({ kind: "failed", key: "rider.negotiation.error.UNKNOWN" });
    }
  };

  const handleSettle = async () => {
    setOutcome({ kind: "busy" });
    try {
      const settled = await settle(negotiation.negotiationId);
      if (!settled.settled) {
        setOutcome({ kind: "failed", key: "rider.negotiation.error.UNKNOWN" });
        return;
      }
      setOutcome({ kind: "idle" });
      onSettled?.();
    } catch {
      setOutcome({ kind: "failed", key: "rider.negotiation.error.UNKNOWN" });
    }
  };

  return (
    <UiCard>
      <p className="ar__status">{t("rider.negotiation.title")}</p>
      {negotiation.status === "collecting" ? (
        <>
          <p className="ar__no-driver">
            {t("rider.negotiation.collecting").replace("{count}", String(negotiation.claimCount))}
          </p>
          <UiTimer
            label={t("rider.negotiation.window")}
            deadlineText={
              negotiation.collectSecondsLeft > 0
                ? t("rider.negotiation.window.left").replace(
                    "{seconds}",
                    String(negotiation.collectSecondsLeft),
                  )
                : t("rider.negotiation.window.closed")
            }
            remainingSeconds={negotiation.collectSecondsLeft}
            totalSeconds={300}
            tone={negotiation.collectSecondsLeft <= 60 ? "amber" : "neutral"}
          />
        </>
      ) : driver === null ? (
        <p className="ar__no-driver">{t("rider.negotiation.negotiating")}</p>
      ) : (
        <>
          <p className="ar__driver-name">
            {t("rider.negotiation.driver.name").replace("{name}", driver.firstName ?? "")}
          </p>
          <p className="ar__driver-rating">
            {driver.ratingAverage === null
              ? t("rider.negotiation.driver.noRating")
              : t("rider.negotiation.driver.rating")
                  .replace("{average}", driver.ratingAverage.toFixed(1))
                  .replace("{count}", String(driver.ratingCount))}
          </p>
          <p className="ar__driver-vehicle">
            {t("rider.negotiation.driver.vehicle").replace("{vehicle}", driver.vehicleType ?? "")}
          </p>
          <p className="ar__driver-rating">
            {t("rider.negotiation.driver.trips").replace("{count}", String(driver.completedTrips))}
          </p>
          <div className="ar__actions">
            <button
              type="button"
              className="sys__action"
              disabled={outcome.kind === "busy"}
              onClick={() => void handleSelect()}
            >
              {t("rider.negotiation.select")}
            </button>
            <button
              type="button"
              className="sys__action"
              disabled={outcome.kind === "busy"}
              onClick={() => void handleAdvance()}
            >
              {t("rider.negotiation.next")}
            </button>
            <button
              type="button"
              className="sys__action"
              disabled={outcome.kind === "busy"}
              onClick={() => void handleSettle()}
            >
              {t("rider.negotiation.agree")}
            </button>
          </div>
        </>
      )}
      {outcome.kind === "failed" ? (
        <p className="sys__body" role="status">
          {t(outcome.key)}
        </p>
      ) : null}
    </UiCard>
  );
}
