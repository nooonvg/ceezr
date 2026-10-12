/**
 * الغرض: شاشةُ البحثِ عن سائقٍ `SR-05` — تُنشئُ الرحلةَ بمفتاحِ تكرارٍ واحدٍ، ثمَّ
 *   تعرضُ **حالةً صادقةً**: مدّةً مقيسةً من ميلادِ الرحلةِ، وعددَ المبلَّغينَ كما
 *   قاسَته القاعدةُ، وإلغاءً يُعرَضُ حينَ يكونُ مشروعاً وحدَه (البند `F2-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-05`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` بعدَ الطلبِ في
 *   `SR-04`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-06` يستبدلُ ما بعدَ `matched` بشاشةِ الرحلةِ
 *   النشطةِ، وهذه الشاشةُ تبقى لِطورِ البحثِ وحدَه.
 * ملاحظات مستقبلية: لا سعرَ ولا عقوبةَ إلغاءٍ ولا وسيلةَ دفعٍ ههنا قبلَ `DEC-11`
 *   (`ADR 0039` §٤ · `م13-7`).
 *
 * ## لماذا الإنشاءُ ههنا لا في شاشةِ الاقتباسِ
 *
 * لأنَّ الإنشاءَ **قد يُرفَضُ** ويُعادُ ويُلغى، وله حالةٌ تعيشُ دقائقَ. وشاشةُ
 * الاقتباسِ تجمعُ النيّةَ (خدمةٌ وملاحظةٌ ومفتاحٌ) وتُسلِّمُها، ولا تحملُ عمرَ
 * الرحلةِ. ولو أُنشئَ هناكَ لَوجبَ أن تُنقَلَ الحالةُ بينَ شاشتَينِ، ونقلُ الحالةِ
 * بابُ رحلةٍ يُنشَأُ مرّتَينِ.
 *
 * ## ولماذا يُعادُ استعمالُ المفتاحِ نفسِه في كلِّ محاولةٍ
 *
 * `ARCH-006`: المفتاحُ يُولَّدُ **مرّةً لكلِّ نيّةٍ** في `SR-04` ويُمرَّرُ ههنا خاصّيّةً.
 * فإعادةُ المحاولةِ بعدَ انقطاعِ شبكةٍ تعودُ بـ`reused:true` على الرحلةِ الأولى،
 * ولا تُنشئُ ثانيةً. وهذا هوَ الفرقُ بينَ «راكبٌ ضغطَ مرّتَينِ» و«رحلتانِ».
 *
 * ## ولماذا المؤقّتُ من ختمِ الميلادِ لا من فتحِ الشاشةِ
 *
 * راكبٌ عادَ بعدَ سبعِ دقائقَ يرى سبعاً. والقياسُ أساسُه ما قاسَته القاعدةُ عندَ
 * آخرِ قراءةٍ زائداً ما مضى محلّيّاً بعدَها — فلا يُصدَّقُ انحرافُ ساعةِ الجهازِ.
 *
 * ## ولماذا **لا مؤقّتَ** يُعيدُ القراءةَ ولا عقربَ ثوانٍ يدقُّ
 *
 * `ADR 0035` §٤ والقسمُ 9.7: **الفعلُ بيدِ المستخدمِ وحدَه** في التطبيقِ
 * المصغَّرِ، ولا استقصاءَ دوريّاً قبلَ بندِ النقلِ الفوريِّ. وأوّلُ نسخةٍ من هذه
 * الشاشةِ قرأَت كلَّ خمسِ ثوانٍ ودقَّت كلَّ ثانيةٍ، **فأسقطَها
 * `scripts/check-system-screens-policy.ts` بموضعَيْ `setInterval`** — وهذا هوَ
 * الحاجزُ يعملُ عملَه، فعُولِجَ في جذرِه ولم يُستَثنَ:
 *
 *   ــ **القراءةُ تُطلَبُ**: زرُّ «تحديثٌ» ظاهرٌ ما دامَ البحثُ جارياً، ونداءٌ
 *      واحدٌ عندَ الدخولِ. فالراكبُ يعرفُ **متى** سألَ ولا يُوهَمُ بسؤالٍ دائمٍ.
 *   ــ **والمدّةُ تُقرأُ لحظةَ الرسمِ** من `now()` لا من حالةٍ تدقُّ. فلو دقَّ
 *      عقربٌ بجانبِ عددِ سائقينَ **جامدٍ** لَقرأَ الراكبُ حركةً حيثُ لا حركةَ —
 *      وذاكَ أسوأُ من رقمٍ ساكنٍ صادقٍ.
 *   ــ **ولا سقفَ زمنيَّ ولا «توقّفَ التحديثُ»**: لا شيءَ يعملُ في الخلفيّةِ
 *      أصلاً حتّى يُقالَ إنَّه توقّفَ. والمفتاحُ `rider.search.stopped` **يبقى
 *      في القواميسِ الثلاثةِ** ولا يُعرَضُ (`ح-1`: يُنسَخُ بالإضافةِ لا بالمحوِ).
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تُجمِّلُ الصفرَ**: «لم يُبلَّغْ سائقٌ بعدُ» نصٌّ مُعلَنٌ لا سطرٌ مطويٌّ،
 *      و`ADR 0023` يقولُ إنَّ الصمتَ ليسَ رفضاً — فلا يُوهَمُ الراكبُ بحركةٍ.
 *   ــ **لا تعرضُ زرَّ إلغاءٍ بعدَ الإسنادِ**: الرايةُ من القاعدةِ، وزرٌّ يُرفَضُ
 *      دائماً أسوأُ من غيابِه. ولا تُفسَّرُ الرايةُ مالاً.
 *   ــ **لا تُقرِّرُ نهايةَ البحثِ بنفسِها**: النهايةُ حالةُ الرحلةِ في القاعدةِ.
 *   ــ **لا تُسنِدُ سائقاً ولا تعرضُ عرضاً**: البثُّ والإسنادُ `F3`.
 *   ــ **لا تُخزِّنُ معرّفَ الرحلةِ محلّيّاً**: حالةٌ محفوظةٌ تُقرأُ بعدَ انتهائِها.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isServiceKind } from "../../../../../../packages/domain/quote/service-offer.ts";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
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
import { Glyph } from "../../../system/ui/icons.tsx";
import { RideJourney } from "../active/RideJourney.tsx";
import { journeyFromSearchStatus } from "../active/ride-journey.ts";
import type { PlaceWire } from "../destination/destination-view.ts";
import { SosEntry } from "../sos/SosEntry.tsx";
import { requestByService as requestViaApi } from "./request-by-service.ts";
import { cancelRide as cancelViaApi, readRideSearch as readViaApi } from "./ride-api.ts";
import type {
  CancelRideResponse,
  RequestRideResponse,
  RiderOfferMode,
  RideSearchResponse,
} from "./ride-contract.ts";
import {
  cancelRefusalKey,
  elapsedSecondsFor,
  elapsedSecondsFromBirth,
  elapsedText,
  isRetryableRideError,
  newIdempotencyKey,
  notifiedLine,
  rideErrorKey,
  rideRefusalKey,
  rideStatusKey,
  searchPhaseKey,
  searchRefusalKey,
} from "./search-view.ts";

export interface SearchScreenIntent {
  readonly service: string;
  readonly originLat: number;
  readonly originLng: number;
  readonly destinationLat: number;
  readonly destinationLng: number;
  readonly destinationLabel: string;
  /** `RIDE-LABEL-01` — اسمُ الالتقاطِ حينَ اختارَه الراكبُ بالاسمِ؛ `null` موقعُ الجهازِ. */
  readonly pickupLabel?: string | null;
  /** `LOC-TRUST-01` — الاسمُ المُرسَلُ للوجهة؛ غائبٌ ⇒ `destinationLabel` (سلوكٌ أقدم). */
  readonly destinationUserLabel?: string | null;
  /** `LOC-TRUST-01` — مصدرُ النقطةِ ودقّتُها ووقتُها والرابطُ الأصليُّ والملاحظات. */
  readonly pickupPlace?: PlaceWire | null;
  readonly dropoffPlace?: PlaceWire | null;
  readonly notes: string | null;
  /** يُولَّدُ في `SR-04` مرّةً واحدةً لكلِّ نيّةٍ — ولا يُولَّدُ ههنا. */
  readonly idempotencyKey: string;
  /** `ORDER-TERMS-01` — وقتُ حضورِ السائقِ ISO؛ `null`/غائبٌ ⇒ الآن. */
  readonly pickupAt?: string | null;
  /** `ORDER-OFFER-01` — ما يعرضُه الراكبُ بالريال؛ `null`/غائبٌ ⇒ قابلٌ للتفاوض. */
  readonly offerSar?: number | null;
  /** `WR-05` — سياسةُ المبلغ: `fixed` · `suggested` · `open`. */
  readonly offerMode?: RiderOfferMode;
}

export interface SearchScreenProps {
  readonly intent: SearchScreenIntent;
  readonly request?: (input: {
    readonly idempotencyKey: string;
    readonly service: string;
    readonly originLat: number;
    readonly originLng: number;
    readonly destinationLat: number;
    readonly destinationLng: number;
    readonly notes?: string;
    readonly pickupLabel?: string | null;
    readonly destinationLabel?: string | null;
    readonly pickupAt?: string | null;
    readonly offerSar?: number | null;
    readonly offerMode?: RiderOfferMode;
    readonly pickupPlace?: PlaceWire | null;
    readonly dropoffPlace?: PlaceWire | null;
  }) => Promise<RequestRideResponse>;
  readonly read?: (orderId: string) => Promise<RideSearchResponse>;
  readonly cancel?: (input: {
    readonly orderId: string;
    readonly idempotencyKey: string;
  }) => Promise<CancelRideResponse>;
  readonly onBack?: () => void;
  /** UI-3 / PR 4: داخلَ `ScreenFrame` العنوانُ للإطار (`false`) فلا `h1` مكرّر. */
  readonly showTitle?: boolean;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ: يُرسَمُ إذا مُرِّرَ. */
  readonly onOpenSos?: () => void;
  /**
   * بابُ `F2-06`: إن مُرِّرَ، انتقلَت المتابعةُ إلى شاشةِ الرحلةِ النشطةِ. وإن
   * غابَ، **بقيَ سلوكُ `F2-05` كما كانَ حرفاً** (القاعدة `ح-1`): متابعةٌ داخليّةٌ
   * في هذه الشاشةِ. فلا يُكسَرُ اختبارٌ قائمٌ ولا يُحذَفُ مسارٌ عملَ.
   */
  readonly onActiveRide?: (orderId: string) => void;
  readonly initialLanguage?: MiniAppLanguage;
  /** تُحقَنُ في الاختبارِ كي تُقاسَ المدّةُ بلا انتظارٍ حقيقيٍّ. */
  readonly now?: () => number;
}

type Found = Extract<RideSearchResponse, { found: true }>;

type SearchState =
  | { readonly kind: "creating" }
  | {
      readonly kind: "refused";
      readonly refusal: string;
      readonly activeRide: { readonly orderId: string; readonly status: string } | null;
    }
  | { readonly kind: "rejected"; readonly code: string }
  | {
      readonly kind: "tracking";
      readonly orderId: string;
      /** أوّلُ قياسٍ قبلَ أوّلِ قراءةٍ: ختمُ الميلادِ من ردِّ الإنشاءِ. */
      readonly createdAtMs: number;
      readonly reused: boolean;
      readonly view: Found | null;
      readonly measuredAtMs: number;
    }
  | { readonly kind: "read_refused"; readonly refusal: string }
  | { readonly kind: "cancel_refused"; readonly refusal: string; readonly orderId: string }
  | { readonly kind: "cancelled" };

type SystemState = { readonly screen: ScreenState } | null;

function codeOf(thrown: unknown): string | null {
  if (thrown !== null && typeof thrown === "object" && "code" in thrown) {
    const code = (thrown as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

async function screenFor(thrown: unknown): Promise<ScreenState | null> {
  const failure = failureFromThrown(thrown);
  if (failure === null) return null;
  const online = deviceOnline();
  const probe = shouldProbeReachability(failure, online) ? await probeReachability() : "not_probed";
  return classifyFailure(failure, probe, online);
}

function parseStamp(iso: string, fallbackMs: number): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

/**
 * `UI-LOOP-02` — ساعةٌ **ثابتةُ الهويّةِ**. كانَت قيمةً افتراضيّةً سهميّةً
 * (`now = () => Date.now()`) تُولَدُ في كلِّ رسمٍ، وهيَ في تبعيّاتِ `useCallback`
 * الذي يُنادى من `useEffect` — فكلُّ رسمٍ يُعيدُ القراءةَ، وكلُّ قراءةٍ تُعيدُ الرسمَ:
 * حلقةٌ لا تنتهي تُومِضُ بها الشاشةُ وتُغرِقُ البوّابةَ بالطلباتِ.
 */
const systemNowMs = (): number => Date.now();

export function SearchScreen({
  intent,
  request = requestViaApi,
  read = readViaApi,
  cancel = cancelViaApi,
  onBack,
  showTitle = true,
  onOpenSos,
  onActiveRide,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  now = systemNowMs,
}: SearchScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<SearchState>({ kind: "creating" });
  const [system, setSystem] = useState<SystemState>(null);
  const [busy, setBusy] = useState(false);
  /** تُمنَعُ قراءةٌ ثانيةٌ ما لم تنتهِ الأولى: ضغطتانِ سريعتانِ ليستا سؤالَينِ. */
  const [reading, setReading] = useState(false);
  const mounted = useRef(true);
  /** ردٌّ متأخِّرٌ لسؤالٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ (عينُ حكمِ `SR-03`/`SR-04`). */
  const issued = useRef(0);
  /** مفتاحُ الإلغاءِ — يُولَّدُ مرّةً، فإعادةُ الإلغاءِ ليسَت إلغاءً ثانياً. */
  const cancelKey = useRef(newIdempotencyKey());

  const t = miniAppTranslator(language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** إنشاءُ الرحلةِ — أو متابعةُ رحلةٍ قائمةٍ إن كانَ لها معرّفٌ مُعلَنٌ. */
  const create = useCallback(async () => {
    const ticket = ++issued.current;
    setSystem(null);
    setState({ kind: "creating" });
    try {
      const response = await request({
        idempotencyKey: intent.idempotencyKey,
        service: intent.service,
        originLat: intent.originLat,
        originLng: intent.originLng,
        destinationLat: intent.destinationLat,
        destinationLng: intent.destinationLng,
        ...(intent.notes === null ? {} : { notes: intent.notes }),
        destinationLabel:
          intent.destinationUserLabel === undefined
            ? intent.destinationLabel
            : intent.destinationUserLabel,
        pickupLabel: intent.pickupLabel ?? null,
        pickupPlace: intent.pickupPlace ?? null,
        dropoffPlace: intent.dropoffPlace ?? null,
        pickupAt: intent.pickupAt ?? null,
        offerSar: intent.offerSar ?? null,
        ...(intent.offerMode === undefined ? {} : { offerMode: intent.offerMode }),
      });
      if (!mounted.current || ticket !== issued.current) return;
      if (!response.accepted) {
        setState({ kind: "refused", refusal: response.refusal, activeRide: response.activeRide });
        return;
      }
      setState({
        kind: "tracking",
        orderId: response.orderId,
        createdAtMs: parseStamp(response.createdAt, now()),
        reused: response.reused,
        view: null,
        measuredAtMs: now(),
      });
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current || ticket !== issued.current) return;
      if (screen !== null) {
        setSystem({ screen });
        return;
      }
      setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
    }
  }, [request, intent, now]);

  useEffect(() => {
    void create();
  }, [create]);

  /**
   * قراءةُ الحالةِ — **بطلبٍ وحدَه**: نداءٌ عندَ الدخولِ، ثمَّ ضغطةُ «تحديثٍ».
   * ولا تُنادى من مؤقّتٍ (`ADR 0035` §٤).
   */
  const refresh = useCallback(
    async (orderId: string) => {
      setReading(true);
      try {
        const response = await read(orderId);
        if (!mounted.current) return;
        if (!response.found) {
          setState({ kind: "read_refused", refusal: response.refusal });
          return;
        }
        setState((current) =>
          current.kind === "tracking" && current.orderId === orderId
            ? { ...current, view: response, measuredAtMs: now() }
            : current,
        );
      } catch (thrown) {
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) {
          setSystem({ screen });
          return;
        }
        setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
      } finally {
        if (mounted.current) setReading(false);
      }
    },
    [read, now],
  );

  const tracking = state.kind === "tracking" ? state : null;
  const trackedId = tracking?.orderId ?? null;

  /** أوّلُ قراءةٍ فوراً بعدَ الإنشاءِ — ثمَّ لا شيءَ حتّى يطلبَ الراكبُ. */
  useEffect(() => {
    if (trackedId === null) return;
    void refresh(trackedId);
  }, [trackedId, refresh]);

  const askCancel = useCallback(
    async (orderId: string) => {
      setBusy(true);
      try {
        const response = await cancel({ orderId, idempotencyKey: cancelKey.current });
        if (!mounted.current) return;
        setState(
          response.cancelled
            ? { kind: "cancelled" }
            : { kind: "cancel_refused", refusal: response.refusal, orderId },
        );
      } catch (thrown) {
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) {
          setSystem({ screen });
          return;
        }
        setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [cancel],
  );

  /** متابعةُ رحلةٍ قائمةٍ: الرفضُ يحملُ معرّفَها، فيُتابَعُ ولا يُعادُ الإنشاءُ. */
  const follow = useCallback(
    (orderId: string) => {
      if (onActiveRide !== undefined) {
        onActiveRide(orderId);
        return;
      }
      setState({
        kind: "tracking",
        orderId,
        createdAtMs: now(),
        reused: true,
        view: null,
        measuredAtMs: now(),
      });
    },
    [now, onActiveRide],
  );

  if (system !== null) {
    return (
      <SystemScreen
        language={language}
        state={system.screen}
        onAction={() => void create()}
        busy={busy}
      />
    );
  }

  const body = () => {
    if (state.kind === "creating") {
      return (
        <div className="rs__pending" aria-busy="true">
          <p className="sys__hint">{t("rider.search.creating")}</p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(rideRefusalKey(state.refusal))}</p>
          {state.activeRide !== null && (
            <>
              <p className="rs__active">
                {t("rider.search.activeRide.status").replace(
                  "{status}",
                  t(rideStatusKey(state.activeRide.status)),
                )}
              </p>
              <button
                type="button"
                className="sys__action"
                onClick={() => follow(state.activeRide?.orderId ?? "")}
              >
                {t("rider.search.activeRide.follow")}
              </button>
            </>
          )}
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.search.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(rideErrorKey(state.code))}</p>
          {isRetryableRideError(state.code) && (
            <button type="button" className="sys__action" onClick={() => void create()}>
              {t("rider.search.retry")}
            </button>
          )}
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.search.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "read_refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(searchRefusalKey(state.refusal))}</p>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.search.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "cancel_refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(cancelRefusalKey(state.refusal))}</p>
          {/* «تأخَّرتَ» يُعقُبُه متابعةُ الرحلةِ لا إعادةُ إلغاءٍ يُرفَضُ حتماً. */}
          <button type="button" className="sys__action" onClick={() => follow(state.orderId)}>
            {t("rider.search.activeRide.follow")}
          </button>
        </div>
      );
    }

    if (state.kind === "cancelled") {
      return (
        <div className="sys" role="status">
          <p className="sys__body">{t("rider.search.cancelled")}</p>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.search.back")}
          </button>
        </div>
      );
    }

    const { view } = state;
    /** الساعةُ تُقرأُ **لحظةَ الرسمِ**: لا حالةَ تدقُّ، ولا رقمَ يتحرّكُ وحدَه. */
    const drawnAtMs = now();
    const seconds =
      view === null
        ? elapsedSecondsFromBirth(state.createdAtMs, drawnAtMs)
        : elapsedSecondsFor({
            serverElapsedSeconds: view.elapsedSeconds,
            measuredAtMs: state.measuredAtMs,
            nowMs: drawnAtMs,
          });
    const elapsed = elapsedText(seconds);
    const notified = notifiedLine(view?.notifiedDriverCount ?? 0);

    return (
      <div className="rs__live">
        {state.reused && <p className="rs__reused">{t("rider.search.reused")}</p>}

        <div className="rs__hero">
          <span className="rs__pulse" aria-hidden="true">
            <Glyph name="car" />
          </span>
          <p className="rs__status">{t(rideStatusKey(view?.status ?? "searching"))}</p>
          <p className="rs__elapsed" aria-live="polite">
            {t(elapsed.key)
              .replace("{minutes}", String(elapsed.minutes))
              .replace("{seconds}", String(elapsed.seconds))}
          </p>
        </div>
        {/* R6 · §11 PR 4: سكّةُ المراحلِ من حالةِ الطلبِ المقروءة — لا شريطَ ثانٍ لطورٍ يقولُه السطرُ التالي. */}
        <RideJourney
          language={language}
          stage={journeyFromSearchStatus(view?.status ?? "searching")}
          truth={null}
        />
        {view !== null && <p className="rs__phase">{t(searchPhaseKey(view.phase))}</p>}

        {/* الصفرُ يُقالُ نصّاً مُعلَناً: «لم يُبلَّغْ سائقٌ بعدُ» (`ADR 0023`). */}
        <p className="rs__notified" aria-live="polite">
          {t(notified.key).replace("{count}", String(notified.count))}
        </p>

        {view === null && <Skeleton />}

        {/*
          الرقمُ لقطةٌ لا بثٌّ، فيُقالُ ذلكَ نصّاً ويُعطى بابُ سؤالٍ. وزرٌّ ظاهرٌ
          ما دامَ البحثُ جارياً أصدقُ من قراءةٍ خفيّةٍ لا يعرفُ الراكبُ وقتَها.
        */}
        {(view === null || view.status === "searching") && (
          <div className="rs__snapshot" role="status">
            <p className="sys__hint">{t("rider.search.snapshot")}</p>
            <button
              type="button"
              className="sys__action rs__refresh"
              disabled={reading}
              onClick={() => void refresh(state.orderId)}
            >
              <Glyph name="refresh" className="ar__refresh-icon" />
              {t(reading ? "rider.search.refreshing" : "rider.search.refresh")}
            </button>
          </div>
        )}

        {/*
          أُسنِدَ سائقٌ ⇒ البابُ إلى شاشةِ الرحلةِ النشطةِ (`F2-06`). والزرُّ
          **لا يُرسَمُ إن لم يُمرَّرِ البابُ**: زرٌّ بلا مسارٍ لا يُرسَمُ ولو مُعطَّلاً.
        */}
        {onActiveRide !== undefined &&
          view !== null &&
          (view.status === "matched" || view.status === "in_progress") && (
            <button
              type="button"
              className="sys__action"
              onClick={() => onActiveRide(state.orderId)}
            >
              {t("rider.search.activeRide.follow")}
            </button>
          )}

        {/* الرايةُ من القاعدةِ وحدَها: لا زرَّ إلغاءٍ بعدَ الإسنادِ. */}
        {view?.cancellableWithoutPenalty === true && (
          <button
            type="button"
            className="rs__cancel"
            disabled={busy}
            onClick={() => void askCancel(state.orderId)}
          >
            {t(busy ? "rider.search.cancelling" : "rider.search.cancel")}
          </button>
        )}
      </div>
    );
  };

  return (
    <section
      className="rs"
      dir={directionFor(language)}
      {...(showTitle ? { "aria-labelledby": "rs-title" } : {})}
    >
      {showTitle ? (
        <h1 className="rs__title" id="rs-title">
          {t("rider.search.title")}
        </h1>
      ) : null}
      <div className="rs__destination">
        <p className="rs__destination-to">
          {t("rider.search.destination").replace("{label}", intent.destinationLabel)}
        </p>
        {/* الخدمةُ من النيّةِ نفسِها التي أُرسِلَت — وخدمةٌ لا نصَّ لها تُطرَحُ ولا تُعرَضُ خامّاً. */}
        {isServiceKind(intent.service) ? (
          <p className="rs__destination-service">
            {t("rider.search.service").replace(
              "{label}",
              t(`rider.quote.service.${intent.service}`),
            )}
          </p>
        ) : null}
      </div>

      {/* مدخلُ الاستغاثةِ (`PD-020`) — يُرسَمُ إذا مُرِّرَ، فيبقى البابُ في كلِّ سطحٍ. */}
      {body()}
      {onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}
    </section>
  );
}
