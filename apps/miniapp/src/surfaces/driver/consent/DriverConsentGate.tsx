/**
 * الغرض: `WR-04` (ADR 0281) — بوّابةُ موافقةِ السائق: قبلَ سطحِ السائقِ في Mini App تُقرأُ موافقاتُه
 *   من الخادم (`GET /v1/consents`)، فإن بقيت وثيقةٌ مطلوبةٌ معلّقة (`missing` أو `superseded`) عُرِضَت
 *   بنصِّها الكاملِ وفعلٍ واحدٍ «أوافق وأتابع» يسجّلُ كلَّ وثيقةٍ بإصدارِها في سجلٍّ مستقلّ.
 * الحالة: منفّذ فعلياً — 2026-10-13.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/consent
 * يُستخدم من: `DriverRoot.tsx`
 *
 * ## قراراتٌ مقصودة
 *
 *   ــ **لا تقطعُ رحلةً جارية**: إن كانت للسائقِ مهمّةٌ نشطةٌ أُجِّلَت البوّابةُ وعُرِضَ السطحُ (ومعه
 *      بثُّ الموقع)؛ وتعودُ البوّابةُ عندَ الفتحِ التالي بلا مهمّة. إيقافُ بثِّ الموقعِ وسطَ رحلةٍ
 *      لأجلِ نصٍّ قانونيٍّ أخطرُ على الراكبِ من تأجيلِ السؤالِ دقائق.
 *   ــ **الحكمُ من الخادمِ وحدَه**: «اكتملت» بعدَ إعادةِ القراءة، لا بعدَ نجاحِ النداء.
 *   ــ **فشلُ القراءةِ لا يفتحُ السطح**: شاشةُ نظامٍ بإعادةِ محاولة، كشاشةِ ترحيبِ الراكب.
 *   ــ لا نصَّ داخلَ المكوّن: مفاتيحُ `welcome.*` و`consent.*` (القاموسُ الأساسيّ) و`driver.consent.*`.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import {
  classifyFailure,
  failureFromThrown,
  shouldProbeReachability,
} from "../../../system/failure.ts";
import { deviceOnline, probeReachability } from "../../../system/health.ts";
import { Skeleton } from "../../../system/Skeleton.tsx";
import { SystemScreen } from "../../../system/SystemScreen.tsx";
import type { ScreenState } from "../../../system/state-text.ts";
import {
  type ConsentApiStatus,
  consentErrorKey,
  consentRows,
  isRetryable,
  outstandingRows,
  recordPendingInOrder,
} from "../../rider/welcome/consent-view.ts";
import { readDriverActiveJob } from "../job/job-api.ts";
import { fetchDriverConsentStatus, submitDriverConsent } from "./consent-api.ts";

export interface DriverConsentGateProps {
  readonly language: MiniAppLanguage;
  readonly children: ReactNode;
  /** يُحقَنُ في الاختبار. */
  readonly loadStatus?: () => Promise<ConsentApiStatus>;
  readonly recordOne?: (kind: string, version: string) => Promise<unknown>;
  readonly hasActiveJob?: () => Promise<boolean>;
}

type GateState =
  | { readonly kind: "loading" }
  | { readonly kind: "open" }
  | { readonly kind: "ask"; readonly status: ConsentApiStatus }
  | { readonly kind: "screen"; readonly screen: ScreenState }
  | { readonly kind: "rejected"; readonly code: string };

const defaultHasActiveJob = async (): Promise<boolean> => {
  try {
    return (await readDriverActiveJob()).job !== null;
  } catch {
    return false;
  }
};

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

async function screenFor(thrown: unknown): Promise<ScreenState | null> {
  const failure = failureFromThrown(thrown);
  if (failure === null) return null;
  const online = deviceOnline();
  const probe = shouldProbeReachability(failure, online) ? await probeReachability() : "not_probed";
  return classifyFailure(failure, probe, online);
}

/** معلّقٌ ⇐ اسأل؛ لا معلّقَ ⇐ افتح. */
export function needsDriverConsent(status: ConsentApiStatus): boolean {
  return outstandingRows(consentRows(status)).length > 0 || !status.onboarding.satisfied;
}

/** القرار: يُسأل السائقُ إن بقي معلّقٌ ولا مهمّةَ نشطة؛ وإلّا يُفتحُ السطح. */
export function decideDriverGate(status: ConsentApiStatus, activeJob: boolean): "ask" | "open" {
  return needsDriverConsent(status) && !activeJob ? "ask" : "open";
}

export function DriverConsentGate({
  language,
  children,
  loadStatus = fetchDriverConsentStatus,
  recordOne = submitDriverConsent,
  hasActiveJob = defaultHasActiveJob,
}: DriverConsentGateProps) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<{ kind: string; code: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [status, active] = await Promise.all([loadStatus(), hasActiveJob()]);
      if (!mounted.current) return;
      setState(
        decideDriverGate(status, active) === "ask" ? { kind: "ask", status } : { kind: "open" },
      );
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current) return;
      setState(
        screen !== null ? { kind: "screen", screen } : { kind: "rejected", code: codeOf(thrown) },
      );
    }
  }, [loadStatus, hasActiveJob]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === "open") return <>{children}</>;

  if (state.kind === "loading") {
    return (
      <section
        className="wc"
        dir={directionFor(language)}
        aria-busy="true"
        aria-labelledby="dc-title"
      >
        <h1 id="dc-title" className="wc__title">
          {t("driver.consent.title")}
        </h1>
        <Skeleton />
      </section>
    );
  }

  if (state.kind === "screen") {
    return <SystemScreen language={language} state={state.screen} onAction={() => void load()} />;
  }

  if (state.kind === "rejected") {
    return (
      <section className="wc" dir={directionFor(language)} aria-labelledby="dc-title">
        <h1 id="dc-title" className="wc__title">
          {t("driver.consent.title")}
        </h1>
        <div className="sys" role="alert">
          <p className="sys__body">{t(consentErrorKey(state.code))}</p>
          {isRetryable(state.code) ? (
            <button type="button" className="sys__action" onClick={() => void load()}>
              {t("welcome.retry")}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const status = state.status;
  const acceptAll = async () => {
    setBusy(true);
    setRowError(null);
    const { failure } = await recordPendingInOrder(outstandingRows(consentRows(status)), recordOne);
    if (!mounted.current) return;
    if (failure !== null) {
      const screen = await screenFor(failure.thrown);
      if (!mounted.current) return;
      setBusy(false);
      if (screen !== null) {
        setState({ kind: "screen", screen });
        return;
      }
      setRowError({ kind: failure.kind, code: codeOf(failure.thrown) });
      return;
    }
    setBusy(false);
    // «اكتملت» من الخادمِ بعدَ إعادةِ القراءة، لا من نجاحِ النداء.
    await load();
  };

  return (
    <DriverConsentForm
      language={language}
      status={status}
      busy={busy}
      rowError={rowError}
      onAccept={() => void acceptAll()}
    />
  );
}

/** النموذجُ وحدَه، بلا شبكة: يُرسَمُ في الاختبارِ رسمًا ساكنًا. */
export function DriverConsentForm({
  language,
  status,
  busy,
  rowError,
  onAccept,
}: {
  readonly language: MiniAppLanguage;
  readonly status: ConsentApiStatus;
  readonly busy: boolean;
  readonly rowError: { readonly kind: string; readonly code: string } | null;
  readonly onAccept: () => void;
}) {
  const t = miniAppTranslator(language);
  const outstanding = outstandingRows(consentRows(status));
  return (
    <section className="wc" dir={directionFor(language)} aria-labelledby="dc-title">
      <h1 id="dc-title" className="wc__title">
        {t("driver.consent.title")}
      </h1>
      <p className="sys__body">{t("driver.consent.intro")}</p>
      <ul className="wc__docs">
        {outstanding.map((row) => (
          <li key={row.kind} className="wc__doc">
            <h2 className="wc__doc-title">{t(row.titleKey)}</h2>
            <p className="sys__hint">{t(row.summaryKey)}</p>
            <details className="wc__doc-text">
              <summary>{t("welcome.consent_read_full")}</summary>
              <pre className="wc__doc-text-body">{t(row.textKey)}</pre>
            </details>
            <p className="wc__doc-state">{t(row.statusKey)}</p>
            {rowError !== null && rowError.kind === row.kind ? (
              <p className="wc__doc-error" role="alert">
                {t(consentErrorKey(rowError.code))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="sys__hint">{t("welcome.accept_all_note")}</p>
      <button type="button" className="sys__action wc__primary" disabled={busy} onClick={onAccept}>
        {busy ? t("welcome.consent_recording") : t("welcome.accept_all")}
      </button>
    </section>
  );
}
