/**
 * الغرض: بطاقةُ الطلبِ المجدول — `WR-06` (الخيارُ ج · ADR 0273).
 *
 * `ScheduledDetails` عرضٌ وحدَه (موعدُ الحضورِ ولحظةُ بدءِ البحثِ وما يعنيه ذلك)، تستعملُه شاشةُ
 * البحثِ بحالتِها هي. و`ScheduledRideCard` بطاقةٌ مكتفيةٌ بنفسِها لشاشةِ الرحلةِ النشطة: تقرأُ
 * حالةَ البحثِ وتُلغي بالنداءَين القائمَين (`/v1/rides/:id/search` و`/cancel`)، ولا تفتحُ مسارًا
 * جديدًا. والقراءةُ بطلبٍ لا بمؤقّت (`ADR 0035` §٤).
 *
 * والإلغاءُ رايتُه من الخادم (`cancellableWithoutPenalty`)، لا من الحالةِ في الجهاز.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-views.ts";
import { Glyph } from "../../../system/ui/icons.tsx";
import { cancelRide as cancelViaApi, readRideSearch as readViaApi } from "./ride-api.ts";
import type { CancelRideResponse, RideSearchResponse } from "./ride-contract.ts";
import { cancelRefusalKey, newIdempotencyKey, scheduledMomentText } from "./search-view.ts";

export function ScheduledDetails({
  language,
  pickupAt,
  dispatchAt,
  nowMs,
}: {
  readonly language: MiniAppLanguage;
  readonly pickupAt: string | null | undefined;
  readonly dispatchAt: string | null | undefined;
  readonly nowMs: number;
}) {
  const t = miniAppTranslator(language);
  const pickup = scheduledMomentText(t, pickupAt, nowMs);
  const search = scheduledMomentText(t, dispatchAt, nowMs);
  return (
    <div className="rs__scheduled" role="status">
      {pickup !== null && (
        <p className="rs__scheduled-line">
          {t("rider.search.scheduled.pickupAt").replace("{time}", pickup)}
        </p>
      )}
      {search !== null && (
        <p className="rs__scheduled-line">
          {t("rider.search.scheduled.searchAt").replace("{time}", search)}
        </p>
      )}
      <p className="sys__hint">{t("rider.search.phase.scheduled")}</p>
    </div>
  );
}

type Found = Extract<RideSearchResponse, { found: true }>;

type CardState =
  | { readonly kind: "loading" }
  | { readonly kind: "shown"; readonly view: Found }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly key: string };

export function ScheduledRideCard({
  orderId,
  language,
  read = readViaApi,
  cancel = cancelViaApi,
  now = Date.now,
  onChanged,
}: {
  readonly orderId: string;
  readonly language: MiniAppLanguage;
  readonly read?: (orderId: string) => Promise<RideSearchResponse>;
  readonly cancel?: (input: {
    readonly orderId: string;
    readonly idempotencyKey: string;
  }) => Promise<CancelRideResponse>;
  readonly now?: () => number;
  /** الحالةُ لم تعُد «مجدول» (أُطلِق أو أُلغي): الشاشةُ الأمُّ تُعيدُ قراءتَها. */
  readonly onChanged?: () => void;
}) {
  const t = miniAppTranslator(language);
  const [state, setState] = useState<CardState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const cancelKey = useRef(newIdempotencyKey());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await read(orderId);
      if (!mounted.current) return;
      if (!response.found) {
        setState({ kind: "failed", key: "rider.search.read.notFound" });
        return;
      }
      if (response.status !== "scheduled") {
        onChanged?.();
        return;
      }
      setState({ kind: "shown", view: response });
    } catch {
      if (mounted.current) setState({ kind: "failed", key: "rider.search.scheduled.readFailed" });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [read, orderId, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const askCancel = useCallback(async () => {
    setBusy(true);
    try {
      const response = await cancel({ orderId, idempotencyKey: cancelKey.current });
      if (!mounted.current) return;
      if (response.cancelled) {
        setState({ kind: "cancelled" });
        onChanged?.();
      } else {
        setState({ kind: "failed", key: cancelRefusalKey(response.refusal) });
      }
    } catch {
      if (mounted.current) setState({ kind: "failed", key: "rider.search.scheduled.readFailed" });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [cancel, orderId, onChanged]);

  if (state.kind === "cancelled") {
    return (
      <div className="sys" role="status">
        <p className="sys__body">{t("rider.search.cancelled")}</p>
      </div>
    );
  }
  if (state.kind === "failed") {
    return (
      <div className="sys" role="alert">
        <p className="sys__body">{t(state.key)}</p>
        <button type="button" className="sys__action" disabled={busy} onClick={() => void load()}>
          {t("rider.search.refresh")}
        </button>
      </div>
    );
  }
  const view = state.kind === "shown" ? state.view : null;
  return (
    <div className="rs__live">
      <div className="rs__hero">
        <span className="rs__pulse" aria-hidden="true">
          <Glyph name="recent" />
        </span>
        <p className="rs__status">{t("rider.search.status.scheduled")}</p>
      </div>
      {view !== null && (
        <ScheduledDetails
          language={language}
          pickupAt={view.pickupAt}
          dispatchAt={view.dispatchAt}
          nowMs={now()}
        />
      )}
      <button
        type="button"
        className="sys__action rs__refresh"
        disabled={busy}
        onClick={() => void load()}
      >
        <Glyph name="refresh" className="ar__refresh-icon" />
        {t(busy ? "rider.search.refreshing" : "rider.search.refresh")}
      </button>
      {view?.cancellableWithoutPenalty === true && (
        <button
          type="button"
          className="rs__cancel"
          disabled={busy}
          onClick={() => void askCancel()}
        >
          {t(busy ? "rider.search.cancelling" : "rider.search.cancel")}
        </button>
      )}
    </div>
  );
}
