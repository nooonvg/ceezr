/**
 * الغرض: تفاصيلُ عرضٍ واحدٍ وقبولُه — **زرٌّ واحدٌ يكتبُ مرّةً واحدةً**
 *   بتفويضٍ إلى `claim_ride` الذرّيّةِ (البند `F3-02` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/offers
 * يُستخدم من: `DriverRoot.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` — `order_id` من جوابِ القبولِ مِفصلُ الرحلةِ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ «سُبِقتَ إلى الطلبِ» **ليسَ عطلاً** في هذه الشاشةِ
 *
 * جولةُ العرضِ تُرسَلُ إلى عدّةِ سائقينَ معاً (ذاكَ عملُ `open_offer_round`)،
 * فالسبقُ **الحالُ الطبيعيّةُ** لا الاستثناءُ. والقاعدةُ تردُّ
 * `ORDER_NOT_CLAIMABLE` من قيدٍ ذرّيٍّ في `claim_ride`، ويُقالُ ههنا نصّاً هادئاً
 * معَ طريقٍ إلى اللوحِ — لا «حدثَ خطأٌ» يُوهِمُ السائقَ أنَّ التطبيقَ عطبَ.
 *
 * ## ولِمَ لا زرَّ «إعادةِ المحاولةِ» على القبولِ
 *
 * لأنَّ القبولَ **يكتبُ**: إعادتُه بعدَ انقطاعِ شبكةٍ قد تكونُ إعادةً لفعلٍ نجحَ
 * ولم يصلْ جوابُه. والصوابُ العودةُ إلى اللوحِ فقراءةُ الحالِ من القاعدةِ: إن
 * ظفرَ فسيرى طلبَه مُوكَلاً إليهِ، وإن لا فسيرى العرضَ باقياً أو ذاهباً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ — وحدودُها مُعلَنةٌ (`ح-5`)
 *
 *   ــ **لا تُظهِرُ راكباً**: لا اسمَ ولا هاتفَ ولا لغةَ — وجوابُ القبولِ نفسُه
 *      لا يحملُها، فقناةُ الاتّصالِ بعدَ الإيكالِ بندٌ آخرُ.
 *   ــ **لا خريطةَ**: إحداثيّتانِ تُعرَضانِ رقمَينِ، والخريطةُ **دَينٌ مُعلَنٌ**.
 *   ــ **لا مدّةَ وصولٍ ولا تقديرَ زمنٍ من مسافةٍ**: `ADR 0024` يمنعُها بقياسٍ.
 *   ــ **لا إلغاءَ بعدَ القبولِ**: الإلغاءُ بندٌ لهُ حكمُه، ولا يُشتَقُّ ههنا.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { EmptyState } from "../../../system/EmptyState.tsx";
import { UiCard, UiTimer } from "../../../system/ui/index.tsx";
import { openExternalLink } from "../../../tg/index.ts";
import { offerTimerProps } from "./offer-timer.ts";
import {
  type AcceptDriverOfferResponse,
  acceptDriverOffer,
  type DriverOfferDetailResponse,
  readDriverOfferDetail,
  rejectDriverOffer,
} from "./offers-api.ts";
import {
  canAcceptNow,
  countdownSeconds,
  type DistanceLine,
  isRetryableOffersError,
  offerLineText,
  offersErrorKey,
  pickupAtText,
  toOfferDetail,
} from "./offers-view.ts";

/**
 * `MSG-COLOR-01` — لونُ بطاقةِ العرضِ بحسبِ الخدمةِ (طلبُ المالكِ): التوصيلُ أصفرُ، والنقلُ
 * أخضرُ، والشهريُّ مستقبلاً ورديٌّ فاتحٌ. جدولٌ ساكنٌ في الملفِّ نفسِه فحاجزُ الأنماطِ يقرؤه.
 */
const SERVICE_TONE: Readonly<Record<string, { readonly modifier: string }>> = {
  delivery: { modifier: "dof__item--delivery" },
  transport: { modifier: "dof__item--transport" },
  monthly: { modifier: "dof__item--monthly" },
};
/** خدمةٌ بلا لونٍ مُعلَنٍ تُرسَمُ بلا مُعدِّلٍ — لا لونَ يُخترَع. */
const NO_SERVICE_TONE = { modifier: "" } as const;
const serviceTone = (service: string) => SERVICE_TONE[service] ?? NO_SERVICE_TONE;

export interface OfferDetailScreenProps {
  readonly offerId: string;
  readonly language?: MiniAppLanguage;
  readonly onBack?: () => void;
  /** `UI-4`: حينَ يرسمُ `ScreenFrame` العنوانَ (H1) لا يُكرَّرُ ههنا. الافتراضُ `true`. */
  readonly showTitle?: boolean;
  readonly onAccepted?: (orderId: string) => void;
  /** `UI-4`: بعدَ رفضٍ نجحَ — الافتراضُ `onBack` كما كان. */
  readonly onRejected?: () => void;
  readonly readDetail?: (offerId: string) => Promise<DriverOfferDetailResponse>;
  readonly accept?: (offerId: string) => Promise<AcceptDriverOfferResponse>;
  readonly reject?: (offerId: string) => Promise<unknown>;
  readonly now?: () => number;
  /** `LOC-TRUST-01` — «فتح موقع الالتقاط/الوجهة»؛ يُحقَنُ في الاختبار. */
  readonly openLink?: (url: string) => unknown;
}

type DetailState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly detail: DriverOfferDetailResponse;
      readonly readAtMs: number;
    }
  | { readonly kind: "failed"; readonly code: string };

type ClaimState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "won"; readonly orderId: string }
  /** `WR-09` — قبِلتَ والراكبُ يقرّر؛ الباقي بساعةِ الخادمِ لحظةَ القبول. */
  | {
      readonly kind: "pending";
      readonly orderId: string;
      readonly secondsAtAccept: number;
      readonly acceptedAtMs: number;
      readonly note: string | null;
    }
  | { readonly kind: "declined" }
  | { readonly kind: "lost"; readonly key: string }
  | { readonly kind: "failed"; readonly key: string };

function codeOf(thrown: unknown): string {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

/** رفضُ القاعدةِ ينقسمُ قسمَينِ: **سبقٌ متوقَّعٌ** وعطلٌ يُقالُ عطلاً. */
const EXPECTED_REFUSALS: ReadonlySet<string> = new Set([
  "OFFER_TAKEN",
  "ORDER_HELD",
  "OFFER_EXPIRED",
  "OFFER_ALREADY_ANSWERED",
  "OFFER_NOT_FOUND",
  "CITY_MISMATCH",
]);

function DistanceRow({
  line,
  labelKey,
  t,
}: {
  readonly line: DistanceLine | null;
  readonly labelKey: string;
  readonly t: (key: string) => string;
}) {
  if (line === null) {
    return (
      <p className="dof__distance dof__distance--absent">
        {t(labelKey)}: {t("rider.quote.distance.unavailable")}
      </p>
    );
  }
  return (
    <p className="dof__distance">
      {t(labelKey)}: {t(line.key).replace("{value}", String(line.value))} ·{" "}
      <span className="dof__distance-kind">{t(line.kindKey)}</span>
    </p>
  );
}

/**
 * `UI-LOOP-02` — ساعةٌ **ثابتةُ الهويّةِ**. كانَت قيمةً افتراضيّةً سهميّةً
 * (`now = () => Date.now()`) تُولَدُ في كلِّ رسمٍ، وهيَ في تبعيّاتِ `useCallback`
 * الذي يُنادى من `useEffect` — فكلُّ رسمٍ يُعيدُ القراءةَ، وكلُّ قراءةٍ تُعيدُ الرسمَ:
 * حلقةٌ لا تنتهي تُومِضُ بها الشاشةُ وتُغرِقُ البوّابةَ بالطلباتِ.
 */
const systemNowMs = (): number => Date.now();

export function OfferDetailScreen({
  offerId,
  language = MINIAPP_DEFAULT_LANGUAGE,
  onBack,
  showTitle = true,
  onAccepted,
  onRejected,
  readDetail = readDriverOfferDetail,
  accept = acceptDriverOffer,
  reject = rejectDriverOffer,
  now = systemNowMs,
  openLink = openExternalLink,
}: OfferDetailScreenProps) {
  const t = miniAppTranslator(language);
  const formId = useId();
  const [state, setState] = useState<DetailState>({ kind: "loading" });
  const [claim, setClaim] = useState<ClaimState>({ kind: "idle" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const detail = await readDetail(offerId);
      const readAtMs = now();
      setState({ kind: "ready", detail, readAtMs });
    } catch (thrown) {
      setState({ kind: "failed", code: codeOf(thrown) });
    }
  }, [now, offerId, readDetail]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = useCallback(async () => {
    setClaim({ kind: "busy" });
    try {
      const result = await accept(offerId);
      if (result.pending_rider === true) {
        const at = now();
        const left = result.seconds_left;
        const seconds = typeof left === "number" && Number.isFinite(left) ? Math.max(0, left) : 0;
        setClaim({
          kind: "pending",
          orderId: result.order_id,
          secondsAtAccept: seconds,
          acceptedAtMs: at,
          note: null,
        });
        return;
      }
      setClaim({ kind: "won", orderId: result.order_id });
      onAccepted?.(result.order_id);
    } catch (thrown) {
      const code = codeOf(thrown);
      // **السبقُ يُقالُ حالاً لا عطلاً**، وما سواه يُقالُ عطلاً بنصِّه.
      setClaim(
        EXPECTED_REFUSALS.has(code)
          ? { kind: "lost", key: offersErrorKey(code) }
          : { kind: "failed", key: offersErrorKey(code) },
      );
    }
  }, [accept, now, offerId, onAccepted]);

  /**
   * `WR-09` — «تحديث القرار»: قراءةُ العرضِ ثانيةً بطلبِ السائق (لا استقصاء، `ADR 0035` §٤).
   * `accepted` ⇒ اختارَكَ الراكب؛ `rejected` ⇒ لم يخترْك أو فاتَت المهلة؛ وإلّا فما زالَ يقرّر.
   * والإشعارُ في تيليجرام يصلُ بالمآلِ أيضاً، فهذا بابٌ ثانٍ لا وحيد.
   */
  const refreshDecision = useCallback(async () => {
    if (claim.kind !== "pending") return;
    const pending = claim;
    setClaim({ ...pending, note: null });
    try {
      const detail = await readDetail(offerId);
      if (detail.offer_status === "accepted") {
        setClaim({ kind: "won", orderId: detail.order_id });
        onAccepted?.(detail.order_id);
        return;
      }
      if (detail.offer_status !== "pending") {
        setClaim({ kind: "declined" });
        return;
      }
      setClaim({ ...pending, note: "driver.offers.candidate.stillWaiting" });
    } catch (thrown) {
      setClaim({ ...pending, note: offersErrorKey(codeOf(thrown)) });
    }
  }, [claim, offerId, onAccepted, readDetail]);

  const handleReject = useCallback(async () => {
    setClaim({ kind: "busy" });
    try {
      await reject(offerId);
      setClaim({ kind: "idle" });
      (onRejected ?? onBack)?.();
    } catch (thrown) {
      setClaim({ kind: "failed", key: offersErrorKey(codeOf(thrown)) });
    }
  }, [onBack, onRejected, offerId, reject]);

  if (state.kind === "loading") {
    return (
      <section
        className="dof"
        aria-labelledby={showTitle ? `${formId}-title` : undefined}
        aria-busy="true"
      >
        {showTitle ? (
          <h1 id={`${formId}-title`} className="dof__title">
            {t("driver.offers.detail.title")}
          </h1>
        ) : null}
        <p className="dof__loading">{t("driver.offers.loading")}</p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className="dof" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
        {showTitle ? (
          <h1 id={`${formId}-title`} className="dof__title">
            {t("driver.offers.detail.title")}
          </h1>
        ) : null}
        <EmptyState title={t("driver.offers.failed")} body={t(offersErrorKey(state.code))} />
        {isRetryableOffersError(state.code) ? (
          <button type="button" className="dof__retry" onClick={() => void load()}>
            {t("driver.offers.retry")}
          </button>
        ) : null}
        {onBack === undefined ? null : (
          <button type="button" className="dof__back" onClick={onBack}>
            {t("driver.offers.backToBoard")}
          </button>
        )}
      </section>
    );
  }

  const detail = toOfferDetail(state.detail);
  // **الباقي يُقرأُ لحظةَ الرسمِ** لا بعقربٍ يدقُّ (`F1-07` · `ADR 0035` §٤):
  // فارقٌ محليٌّ بينَ قراءتَينِ من ساعةٍ واحدةٍ، والصلاحيّةُ حكمُ خادمٍ.
  const secondsRemaining = countdownSeconds({
    secondsLeftAtRead: detail.secondsLeftAtRead,
    elapsedMs: now() - state.readAtMs,
  });
  const tone = serviceTone(detail.service);
  const timer = offerTimerProps({
    secondsRemaining,
    secondsLeftAtRead: detail.secondsLeftAtRead,
    t,
  });
  const acceptable = canAcceptNow({ isClaimable: detail.isClaimable, secondsRemaining });

  return (
    <section className="dof" aria-labelledby={showTitle ? `${formId}-title` : undefined}>
      {showTitle ? (
        <h1 id={`${formId}-title`} className="dof__title">
          {t("driver.offers.detail.title")}
        </h1>
      ) : null}

      {/* D3 · §11 PR 6: تفاصيلُ العرضِ في `ui-card` ومؤقّتُ CSS (`ui-timer`) — لا عقربَ ولا موعدَ مطلق.
          ADR 0249 (D2): ثلاثُ بطاقاتٍ كما في اللوحة 06 — بياناتُ الطلب، المواقع، المسافة.
          عنوانُ الثالثةِ «المسافة» لا «المسافة والوقت»: لا مصدرَ زمنٍ للعرض (ADR 0024). */}
      <UiCard title={t("driver.offers.detail.section.request")}>
        <div className={`dof__item-head dof__item-head--tinted ${tone.modifier}`}>
          <span className="dof__service">{t(detail.serviceKey)}</span>
        </div>
        <UiTimer {...timer} />

        <p className="dof__status">
          {t("driver.offers.detail.offerStatus")}: {t(detail.offerStatusKey)} ·{" "}
          {t("driver.offers.detail.orderStatus")}: {t(detail.orderStatusKey)}
        </p>
        <p className="dof__round">
          {t("driver.offers.detail.round")}: {detail.round}
        </p>
        <p className="dof__notes">
          {t("driver.offers.detail.notes")}:{" "}
          {detail.notes === null || detail.notes === ""
            ? t("driver.offers.detail.noNotes")
            : detail.notes}
        </p>
      </UiCard>

      <UiCard title={t("driver.offers.detail.section.places")}>
        {/* `WR-05` — معنى المبلغِ قبلَ القبول. */}
        <p className="dof__offer-terms">{pickupAtText(t, detail.pickupAt)}</p>
        {detail.offerTerms === null ? null : (
          <p className="dof__offer-terms">{offerLineText(t, detail.offerTerms)}</p>
        )}
        <p className="dof__place">
          {t("driver.offers.pickup")}: {detail.pickupLabel ?? t("driver.offers.place.unnamed")}
        </p>
        <p className="dof__coords">
          {detail.pickupLatitude} , {detail.pickupLongitude}
        </p>
        {/* `LOC-TRUST-01`: لا تسقطُ معلومةٌ أدخلَها الراكب — ملاحظاتُ المكانِ ورابطُه الأصليُّ حرفاً. */}
        {detail.pickupNotes === null ? null : (
          <p className="dof__notes">
            {t("driver.offers.place.notes")}: {detail.pickupNotes}
          </p>
        )}
        {detail.pickupLink === null ? null : (
          <p className="dof__coords">
            {t("driver.offers.place.link")}: {detail.pickupLink}
          </p>
        )}
        {detail.pickupOpenUrl === null ? null : (
          <button
            type="button"
            className="dof__place-open"
            onClick={() => openLink(detail.pickupOpenUrl ?? "")}
          >
            {t("driver.offers.openPickup")}
          </button>
        )}
        <p className="dof__place">
          {t("driver.offers.dropoff")}:{" "}
          {detail.hasDropoff
            ? (detail.dropoffLabel ?? t("driver.offers.place.unnamed"))
            : t("driver.offers.place.none")}
        </p>
        {detail.dropoffNotes === null ? null : (
          <p className="dof__notes">
            {t("driver.offers.place.notes")}: {detail.dropoffNotes}
          </p>
        )}
        {detail.dropoffLink === null ? null : (
          <p className="dof__coords">
            {t("driver.offers.place.link")}: {detail.dropoffLink}
          </p>
        )}
        {detail.dropoffOpenUrl === null ? null : (
          <button
            type="button"
            className="dof__place-open"
            onClick={() => openLink(detail.dropoffOpenUrl ?? "")}
          >
            {t("driver.offers.openDropoff")}
          </button>
        )}
      </UiCard>

      <UiCard title={t("driver.offers.detail.section.distance")}>
        <DistanceRow line={detail.riderDistance} labelKey="driver.offers.riderDistance" t={t} />
        <DistanceRow line={detail.tripDistance} labelKey="driver.offers.tripDistance" t={t} />
      </UiCard>

      <div className="dof__actions">
        {acceptable &&
        claim.kind !== "won" &&
        claim.kind !== "pending" &&
        claim.kind !== "declined" ? (
          <button
            type="button"
            className="dof__accept"
            disabled={claim.kind === "busy"}
            onClick={() => void handleAccept()}
          >
            {t("driver.offers.accept")}
          </button>
        ) : null}
        {claim.kind === "won" || claim.kind === "pending" || claim.kind === "declined" ? null : (
          <button
            type="button"
            className="dof__reject"
            disabled={claim.kind === "busy"}
            onClick={() => void handleReject()}
          >
            {t("driver.offers.reject")}
          </button>
        )}
      </div>

      {acceptable ? null : (
        <p className="dof__closed" role="status">
          {t("driver.offers.detail.notClaimable")}
        </p>
      )}

      {claim.kind === "pending" ? (
        <div className="dof__pending" role="status">
          <p className="dof__pending-text">{t("driver.offers.candidate.waiting")}</p>
          <UiTimer
            {...offerTimerProps({
              secondsRemaining: Math.max(
                0,
                Math.ceil(claim.secondsAtAccept - (now() - claim.acceptedAtMs) / 1000),
              ),
              secondsLeftAtRead: claim.secondsAtAccept,
              t,
            })}
            label={t("driver.offers.candidate.timerLabel")}
          />
          <button type="button" className="dof__retry" onClick={() => void refreshDecision()}>
            {t("driver.offers.candidate.refresh")}
          </button>
          {claim.note === null ? null : <p className="dof__pending-note">{t(claim.note)}</p>}
        </div>
      ) : null}
      {claim.kind === "declined" ? (
        <p className="dof__lost" role="status">
          {t("driver.offers.candidate.declined")}
        </p>
      ) : null}
      {claim.kind === "won" ? (
        <p className="dof__won" role="status">
          {t("driver.offers.claimed")} · {claim.orderId}
        </p>
      ) : null}
      {claim.kind === "lost" ? (
        <p className="dof__lost" role="status">
          {t(claim.key)}
        </p>
      ) : null}
      {claim.kind === "failed" ? (
        <p className="dof__error" role="status">
          {t(claim.key)}
        </p>
      ) : null}

      {onBack === undefined ? null : (
        <button type="button" className="dof__back" onClick={onBack}>
          {t("driver.offers.backToBoard")}
        </button>
      )}
    </section>
  );
}
