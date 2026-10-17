/**
 * الغرض: شاشةُ الرحلةِ النشطةِ — تعرضُ لقطةَ الرحلةِ وسائقَها وموقعَه **بعُمرِه**
 *   ومدّةَ الوصولِ وسياسةَ الإلغاءِ (البند `F2-06` · `SR-06`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`، وبغياباتٍ مُسمَّاةٍ أدناه.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/active
 * يُستخدم من: `RiderRoot.tsx` بعدَ الإسنادِ أو لمتابعةِ رحلةٍ قائمةٍ.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` يُلحِقُ بها شاشةَ الإنهاءِ والتقييمِ،
 *   و`F2-09` يُضيفُ زرَّ المشاركةِ، و`F2-10` يُضيفُ زرَّ الطوارئِ.
 *
 * ## لماذا لقطةٌ بزرِّ تحديثٍ لا بثٌّ مستمرٌّ
 *
 * عينُ حكمِ `SR-05`: لا شيءَ يعملُ في الخلفيّةِ، فلا يُوهَمُ الراكبُ بمتابعةٍ
 * حيّةٍ لا تحدثُ. والرقمُ الساكنُ الصادقُ أفضلُ من عقربٍ يدقُّ فوقَ قراءةٍ
 * جامدةٍ. ومتى سألَ الراكبُ عرفَ **أنَّه سألَ**.
 *
 * ## ولماذا لا يُرسَمُ زرٌّ لمسارٍ لم يُبنَ
 *
 * `SR-06` يطلبُ طوارئَ ومشاركةً واتّصالاً. ومساراتُها `F2-10` و`F2-09` ولم
 * تُبنَ، فلا يُرسَمُ زرٌّ مُعطَّلٌ ولا زرٌّ يقولُ «قريباً»: زرٌّ لا يفعلُ شيئاً
 * **كذبٌ في اللحظةِ التي يُحتاجُ فيها الصدقُ أكثرَ** (حالةُ طوارئٍ). والغيابُ
 * مُسمَّى في دليلِ الإغلاقِ لا مطويٌّ.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ سعراً ولا عقوبةَ إلغاءٍ**: `ADR 0039` §٤ (`DEC-11` · `م13-7`).
 *   ــ **لا ترسمُ نقطةً بلا عُمرِها**: `BUG-001` — والحجبُ يُقالُ بسببِه.
 *   ــ **لا ترسمُ خريطةً**: الخريطةُ في `SR-02`، وههنا إحداثيّةٌ معلَنةٌ وعُمرٌ.
 *   ــ **لا تُنشِئُ رحلةً ولا تُسنِدُ سائقاً**: الإنشاءُ `SR-04` والإسنادُ `F3`.
 *   ــ **لا تُخزِّنُ معرّفَ الرحلةِ محلّيّاً**: المعرّفُ يأتي من مُركِّبِها.
 *
 * ## إضافةُ البند `F2-07` (2026-09-13)
 *
 * صارَ لها **مخرجٌ واحدٌ اختياريٌّ**: `onFinished`. ويُرسَمُ زرُّه **متى قالَت
 * القاعدةُ `completed` وحدَها** — لا متى ظنَّت الشاشةُ. وما فوقَ **باقٍ كما هوَ**
 * (القاعدة ح-1) ولا سطرَ حُذِفَ؛ والسطرُ أعلاه القائلُ إنَّ `F2-07` «يُلحِقُ بها
 * شاشةَ الإنهاءِ» كانَ توقُّعَ البندِ السابقِ، وهذا إنفاذُه حرفاً.
 *
 * ولماذا مخرجٌ لا تركيبٌ للملخَّصِ ههنا: الملخَّصُ يُقرأُ بنداءٍ آخرَ وله حالتُه
 * ونموذجُ تقييمِه، وشاشةٌ واحدةٌ تحملُ حكمَينِ تُخفي أيَّهما رُفِضَ ولماذا.
 *
 * وبلا `onFinished` **لا زرَّ**: مُركِّبٌ لا يعرفُ إلى أينَ يُفضي الزرُّ لا
 * يُرسَمُ له زرٌّ — وزرٌّ بلا مسارٍ وعدٌ لا عقدٌ.
 *
 * ## إضافةُ البند `F2-09` (2026-09-14)
 *
 * بُنِيَ مسارُ المشاركةِ، فصارَ لها **بطاقةٌ** لا زرٌّ: `RideShareCard`. وما
 * فوقَ **باقٍ كما هوَ** (القاعدة ح-1)؛ والسطرُ القائلُ إنَّ مسارَ `F2-09` «لم
 * يُبنَ» كانَ صدقَ لحظتِه، وهذا إنفاذُ وعدِه لا نقضُه: الغيابُ زالَ بالبناءِ لا
 * بحذفِ ذكرِه. ويبقى `F2-10` (الطوارئُ) **غائباً مُسمَّى** ولا زرَّ له.
 *
 * ## إضافةُ البند `F2-10` (2026-09-14)
 *
 * بُنِيَ مسارُ الاستغاثةِ، فصارَ لها **بطاقةٌ محكومةٌ** لا زرٌّ أحمرُ
 * دائمٌ: `SosCard`. والسطرُ أعلاه القائلُ إنَّ `F2-10` «غائبٌ مُسمَّى» **باقٍ
 * كما هوَ** (القاعدة ح-1): كانَ صدقَ لحظتِه، وهذا إنفاذُ وعدِه.
 *
 * ولماذا لا مُعرِّفَ يُمرَّرُ إليها بخلافِ بطاقةِ المشاركةِ: الطلبُ يُحَلَّ
 * في القاعدةِ تحتَ القفلِ (`ADR 0077`)، ومُعرِّفٌ يُرسَلُ من شاشةٍ قد يكونُ
 * مُعرِّفَ رحلةِ أمسِ. ولأنَّ سطحَ الاستغاثةِ **ليسَ سطحَ رحلةٍ**: يبقى دقائقَ
 * بعدَ انتهائِها بقيمةِ المدينةِ، وربطُه بمُعرِّفٍ كانَ سيُطفئُه لحظةَ الوصولِ.
 *
 * ولماذا بطاقةٌ تقرأُ لنفسِها لا حقلٌ في هذا الردِّ: حالُ المشاركةِ تتغيَّرُ
 * بأفعالِ صاحبِها (إصدارٌ وإيقافٌ) لا بحالِ الرحلةِ، فلو حُشِرَت في لقطةِ
 * الرحلةِ لَوجبَ تحديثُ اللقطةِ كلِّها بعدَ كلِّ ضغطةٍ — أو عرضُ حالٍ قديمةٍ.
 * وحكمٌ واحدٌ لكلٍّ: نداءٌ يُجيبُ عن الرحلةِ ونداءٌ يُجيبُ عن روابطِها.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  directionFor,
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import {
  applyTrackingEvent,
  INITIAL_TRACKING_STATE,
  type LiveTrackingState,
  shouldRefreshFromHttp,
} from "../../../services/live-tracking-reducer.ts";
import {
  type RideChannelSubscription,
  type RideChannelTransport,
  type SessionTokenReader,
  subscribeRideChannel,
} from "../../../services/ride-channel-client.ts";
import {
  classifyFailure,
  failureFromThrown,
  shouldProbeReachability,
} from "../../../system/failure.ts";
import { deviceOnline, probeReachability } from "../../../system/health.ts";
import { Skeleton } from "../../../system/Skeleton.tsx";
import { SystemScreen } from "../../../system/SystemScreen.tsx";
import type { ScreenState } from "../../../system/state-text.ts";
import { TRUTH_AGE_UNKNOWN_KEY, TRUTH_SOURCE_KEYS, truthAge } from "../../../system/truth.ts";
import { Glyph } from "../../../system/ui/icons.tsx";
import { vehicleTypeText } from "../../../system/vehicle-type.ts";
import { OrderChat } from "../../chat/OrderChat.tsx";
import { RideCandidateCard } from "../search/RideCandidateCard.tsx";
import { cancelRide as cancelViaApi } from "../search/ride-api.ts";
import type { CancelRideResponse } from "../search/ride-contract.ts";
import { ScheduledRideCard } from "../search/ScheduledRideCard.tsx";
import { cancelRefusalKey, newIdempotencyKey } from "../search/search-view.ts";
import { RideShareCard } from "../share/RideShareCard.tsx";
import { SosCard } from "../sos/SosCard.tsx";
import { readRide as readViaApi } from "./active-ride-api.ts";
import type { ActiveRideResponse } from "./active-ride-contract.ts";
import {
  activeErrorKey,
  activeRefusalKey,
  cancelPolicyKey,
  driverIdentityLine,
  elapsedSecondsFor,
  elapsedText,
  etaBandLine,
  etaLine,
  isRetryableRideError,
  observedLine,
  positionLine,
  rideStatusKey,
  showsCancelButton,
} from "./active-ride-view.ts";
import { NegotiationPanel } from "./NegotiationPanel.tsx";
import { PRODUCTION_TRIP_EVENTS } from "./production-trip-events.ts";
import { RideJourney } from "./RideJourney.tsx";
import { activeRideTruth, journeyFromActivePhase } from "./ride-journey.ts";
import {
  ackableIds,
  subscribeTripEvents,
  type TripEventsApi,
  type TripEventsChannelDeps,
  type TripEventsResponse,
} from "./trip-events.ts";

export interface ActiveRideScreenProps {
  readonly orderId: string;
  readonly read?: (orderId: string) => Promise<ActiveRideResponse>;
  readonly cancel?: (input: {
    readonly orderId: string;
    readonly idempotencyKey: string;
  }) => Promise<CancelRideResponse>;
  readonly onBack?: () => void;
  /** UI-3 / PR 4: داخلَ `ScreenFrame` العنوانُ للإطار (`false`) فلا `h1` مكرّر. */
  readonly showTitle?: boolean;
  /**
   * مخرجُ الإنهاءِ (`F2-07`) — يُنادى بمعرّفِ الرحلةِ متى طلبَ الراكبُ الملخَّصَ.
   * **اختياريٌّ**: بغيابِه لا يُرسَمُ زرٌّ، ولا يُخترعُ مسارٌ لا يعرفُه المُركِّبُ.
   */
  readonly onFinished?: (orderId: string) => void;
  readonly initialLanguage?: MiniAppLanguage;
  /** تُحقَنُ في الاختبارِ كي تُقاسَ المدّةُ بلا انتظارٍ حقيقيٍّ. */
  readonly now?: () => number;
  /**
   * منفذُ قناةِ الرحلةِ الآنيةِ (`F4-04`) — يُحقَنُ كي تُقاسَ الشاشةُ بلا شبكةٍ.
   * بغيابِه تظلُّ الشاشةُ على اللقطةِ بزرِّ تحديثٍ، ولا يُخترَعُ ناقلٌ لا يعرفُه
   * المُركِّبُ.
   */
  readonly channelTransport?: RideChannelTransport;
  /** منفذُ رمزِ الجلسةِ — يُحقَنُ كي لا يُستورَدَ `session.ts` مباشرة. */
  readonly sessionReader?: SessionTokenReader;
  /** أساسُ عنوانِ الخادمِ — يُحقَنُ كي يُقاسَ بلا عنوانٍ حقيقيٍّ. */
  readonly channelBaseUrl?: string;
  /**
   * لوحةُ التسليمِ R5→R6: «مشاركة الرحلة» شاشةٌ مستقلّةٌ يفتحُها المُركِّبُ. حين يُمرَّرُ يُرسَمُ زرٌّ
   * يفتحُها بدلَ بطاقةِ المشاركةِ المدمجةِ؛ وبلا مُستقبِلٍ تبقى البطاقةُ مدمجةً كما كانَت — فلا زرَّ بلا مستقبِل.
   */
  readonly onOpenShare?: () => void;
  /** لوحةُ التسليمِ R5→R7: «طلب المساعدة» يفتحُ شاشةَ الاستغاثةِ نفسَها بتأكيدِها ذي الخطوتَين. */
  readonly onOpenHelp?: () => void;
  /**
   * ADR 0287 — أحداثُ أطوارِ الرحلةِ في Mini App: إشارةٌ آنيةٌ ← جلبُ الأحداثِ ←
   * تطبيقُها بقراءةِ اللقطةِ ← إقرارٌ بما تغطّيه اللقطةُ. بغيابِه لا إقرارَ،
   * فتصلُ الأطوارُ بتيليجرامَ احتياطًا كما كانَت.
   */
  readonly tripEvents?: { readonly api: TripEventsApi; readonly channel: TripEventsChannelDeps };
  /** المُركِّبُ في الإنتاجِ: منفذُ الإنتاجِ ما لم يُحقَنْ `tripEvents` صراحةً. */
  readonly liveTripEvents?: boolean;
}

type Found = Extract<ActiveRideResponse, { found: true }>;

type ActiveState =
  | { readonly kind: "reading" }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "ready"; readonly view: Found; readonly measuredAtMs: number }
  | { readonly kind: "cancel_refused"; readonly refusal: string }
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

/** منطقةُ الجهازِ لتنسيقِ لحظةِ الخادم — التنسيقُ عرضٌ، واللحظةُ نفسُها من الخادم. */
function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

export function ActiveRideScreen({
  orderId,
  read = readViaApi,
  cancel = cancelViaApi,
  onBack,
  showTitle = true,
  onFinished,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  now = () => Date.now(),
  channelTransport,
  sessionReader,
  channelBaseUrl = "",
  onOpenShare,
  onOpenHelp,
  tripEvents: injectedTripEvents,
  liveTripEvents = false,
}: ActiveRideScreenProps) {
  const tripEvents = injectedTripEvents ?? (liveTripEvents ? PRODUCTION_TRIP_EVENTS : undefined);
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<ActiveState>({ kind: "reading" });
  const [system, setSystem] = useState<SystemState>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  /** حالةُ التتبُّعِ الحيِّ — تُحدِّثُ الموقعَ المرسومَ بلا استقصاءٍ (`F4-04`). */
  const [liveTracking, setLiveTracking] = useState<LiveTrackingState>(INITIAL_TRACKING_STATE);
  const mounted = useRef(true);
  /** حاجزا تزامنٍ **مرجعانِ**: قراءةٌ واحدةٌ وإلغاءٌ واحدٌ، بلا تغييرِ هويّةِ دالّةٍ. */
  const readingRef = useRef(false);
  const busyRef = useRef(false);
  /** ردٌّ متأخِّرٌ لسؤالٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ (عينُ حكمِ `SR-05`). */
  const issued = useRef(0);
  /** مفتاحُ الإلغاءِ — يُولَّدُ مرّةً، فإعادةُ الإلغاءِ ليسَت إلغاءً ثانياً. */
  const cancelKey = useRef(newIdempotencyKey());
  /** `WR-09` — كلُّ «تحديث» يُعيدُ قراءةَ بطاقةِ المرشَّحِ أيضاً. */
  const [candidateToken, setCandidateToken] = useState(0);
  const t = miniAppTranslator(language);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * القراءةُ — **بطلبٍ وحدَه**: نداءٌ عندَ الدخولِ ثمَّ ضغطةُ «تحديثٍ»، ولا
   * مؤقّتَ (`ADR 0035` §٤). والمعرّفُ **مُعامَلٌ** لا مأخوذٌ من الإغلاقِ، وحاجزُ
   * التزامنِ **مرجعٌ** لا حالةٌ: لو كانَ حالةً لَتغيَّرَت هويّةُ الدالّةِ عندَ كلِّ
   * قراءةٍ فأعادَ الأثرُ النداءَ — نداءٌ لم يطلبْه أحدٌ.
   */
  const refresh = useCallback(
    async (id: string): Promise<Found | null> => {
      if (readingRef.current) return null;
      readingRef.current = true;
      setReading(true);
      setCandidateToken((n) => n + 1);
      const ticket = ++issued.current;
      try {
        const response = await read(id);
        if (!mounted.current || ticket !== issued.current) return null;
        if (!response.found) {
          setState({ kind: "refused", refusal: response.refusal });
          return null;
        }
        setState({ kind: "ready", view: response, measuredAtMs: now() });
        return response;
      } catch (thrown) {
        if (!mounted.current || ticket !== issued.current) return null;
        const screen = await screenFor(thrown);
        if (!mounted.current) return null;
        if (screen !== null) setSystem({ screen });
        else setState({ kind: "rejected", code: codeOf(thrown) ?? "HTTP_ERROR" });
        return null;
      } finally {
        readingRef.current = false;
        if (mounted.current) setReading(false);
      }
    },
    [now, read],
  );

  /**
   * ADR 0287 — مزامنةُ أحداثِ الرحلةِ: تُجلبُ، فإن بقيَ ما لم يُقَرَّ قُرئَتِ
   * اللقطةُ (التطبيقُ)، ثم يُقَرُّ بما يغطّيه طورُها وحدَه — **بعدَ** رسمِها.
   * القراءةُ المشغولةُ أو الفاشلةُ لا تُقِرُّ بشيءٍ.
   */
  const syncTripEvents = useCallback(
    async (id: string) => {
      if (tripEvents === undefined) return;
      let listed: TripEventsResponse;
      try {
        listed = await tripEvents.api.list(id);
      } catch {
        return;
      }
      const pending = (listed.events ?? []).filter((e) => !e.acked);
      if (pending.length === 0 || !mounted.current) return;
      const applied = await refresh(id);
      if (applied === null || !mounted.current) return;
      const ids = ackableIds(pending, applied.phase);
      if (ids.length === 0) return;
      await tripEvents.api.ack(id, ids).catch(() => undefined);
    },
    [tripEvents, refresh],
  );

  useEffect(() => {
    if (tripEvents === undefined) return;
    const subscription = subscribeTripEvents(tripEvents.channel, {
      onSignal: (signalled) => {
        if (!mounted.current) return;
        if (signalled !== null && signalled !== orderId) return;
        void syncTripEvents(orderId);
      },
    });
    return () => subscription.disconnect();
  }, [orderId, tripEvents, syncTripEvents]);

  /** نداءٌ واحدٌ عندَ الدخولِ — ثمَّ لا شيءَ إلّا بطلبِ الراكبِ. */
  useEffect(() => {
    void refresh(orderId);
  }, [orderId, refresh]);

  /**
   * الاشتراكُ في القناةِ الآنيّةِ (`F4-04`) — يتّصلُ مرةً عندَ الدخولِ، ويفصلُ
   * نظيفاً عندَ الخروجِ أو تغييرِ الرحلةِ. وبغيابِ منفذِ الناقلِ لا يُخترَعُ
   * اتصالٌ: الشاشةُ تعودُ إلى اللقطةِ بزرِّ تحديثٍ ولا تُفاجئُ بمسارٍ مجهولٍ.
   */
  const channelRef = useRef<RideChannelSubscription | null>(null);
  useEffect(() => {
    if (channelTransport === undefined || sessionReader === undefined) return;

    const subscription = subscribeRideChannel(
      {
        transport: channelTransport,
        sessions: sessionReader,
        baseUrl: channelBaseUrl,
      },
      {
        orderId,
        onEvent: (event) => {
          if (!mounted.current) return;
          setLiveTracking((prev) => {
            const next = applyTrackingEvent(prev, event);
            if (shouldRefreshFromHttp(prev, next)) {
              void refresh(orderId);
            }
            return next;
          });
        },
      },
    );
    channelRef.current = subscription;

    return () => {
      subscription.disconnect();
      channelRef.current = null;
    };
  }, [orderId, channelTransport, sessionReader, channelBaseUrl, refresh]);

  const askCancel = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const response = await cancel({ orderId, idempotencyKey: cancelKey.current });
      if (!mounted.current) return;
      setState(
        response.cancelled
          ? { kind: "cancelled" }
          : { kind: "cancel_refused", refusal: response.refusal },
      );
    } catch (thrown) {
      if (!mounted.current) return;
      const screen = await screenFor(thrown);
      if (!mounted.current) return;
      if (screen !== null) setSystem({ screen });
      else setState({ kind: "rejected", code: codeOf(thrown) ?? "HTTP_ERROR" });
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [cancel, orderId]);

  if (system !== null) {
    return (
      <SystemScreen
        language={language}
        state={system.screen}
        onAction={() => void refresh(orderId)}
        busy={reading}
      />
    );
  }

  const body = () => {
    if (state.kind === "reading") {
      return (
        <div className="ar__pending" aria-busy="true">
          <p className="sys__hint">{t("rider.active.reading")}</p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(activeRefusalKey(state.refusal))}</p>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.active.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(activeErrorKey(state.code))}</p>
          {isRetryableRideError(state.code) && (
            <button type="button" className="sys__action" onClick={() => void refresh(orderId)}>
              {t("rider.active.retry")}
            </button>
          )}
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.active.back")}
          </button>
        </div>
      );
    }

    if (state.kind === "cancel_refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(cancelRefusalKey(state.refusal))}</p>
          <button type="button" className="sys__action" onClick={() => void refresh(orderId)}>
            {t("rider.active.refresh")}
          </button>
        </div>
      );
    }

    if (state.kind === "cancelled") {
      return (
        <div className="sys" role="status">
          <p className="sys__body">{t("rider.active.cancelled")}</p>
          <button type="button" className="sys__action" onClick={() => onBack?.()}>
            {t("rider.active.back")}
          </button>
        </div>
      );
    }

    const { view } = state;
    // `WR-06` — زرُّ «طلبي» في رسالةِ الجدولةِ يفتحُ هذه الشاشة: المجدولُ لا سائقَ له ولا عدّادَ
    // انتظار، فبطاقتُه موعدُه وبابُ إلغائه. وإن أُطلِقَ أو أُلغي أُعيدَت قراءةُ هذه الشاشة.
    if (view.status === "scheduled") {
      return (
        <ScheduledRideCard
          orderId={orderId}
          language={language}
          onChanged={() => void refresh(orderId)}
        />
      );
    }
    /** الساعةُ تُقرأُ **لحظةَ الرسمِ**: لا حالةَ تدقُّ، ولا رقمَ يتحرّكُ وحدَه. */
    const drawnAtMs = now();
    const elapsed = elapsedText(
      elapsedSecondsFor({
        serverElapsedSeconds: view.elapsedSeconds,
        measuredAtMs: state.measuredAtMs,
        nowMs: drawnAtMs,
      }),
    );
    const snapshotPosition = view.position;
    const livePosition =
      liveTracking.position && snapshotPosition?.show && snapshotPosition.ageSeconds !== null
        ? {
            show: true as const,
            lat: liveTracking.position.lat,
            lng: liveTracking.position.lng,
            ageSeconds: snapshotPosition.ageSeconds,
          }
        : snapshotPosition;
    const position = positionLine(livePosition);
    /**
     * UI-8: عمرٌ خامٌ لم يُقَس (سالبٌ/غيرُ عدد) يُحجَبُ قبلَ أن تُصفِّرَه دالّةُ العرض —
     * موضعٌ بعمرٍ «0 ثانية» مختلَقٍ أسوأُ من لا موضع (`BUG-001`).
     */
    const positionAgeKnown =
      livePosition === null ||
      !livePosition.show ||
      truthAge(livePosition.ageSeconds).kind === "measured";
    const eta = etaLine(view.eta);
    /** ADR 0243: مدى التقديرِ المرصود — للمحسوبِ وحدَه، والغائبُ يُقالُ بسببِه. */
    const band = view.eta?.kind === "ROUTED" ? etaBandLine(view.eta.band) : null;
    /** ADR 0243: لحظةُ القراءةِ بساعةِ الخادم — لا ساعةَ الجهازِ بديلاً. */
    const observed = observedLine(view.observedAt, language, deviceTimeZone());
    const driver = view.driver === null ? null : driverIdentityLine(view.driver);

    return (
      <div className="ar__live">
        {/* `WR-09` (ADR 0266): زرُّ إشعارِ «سائقٌ قبِلَ» يفتحُ هذه الشاشةَ والطلبُ ما زالَ يبحث. */}
        {/* `ADR 0286` — لوحةُ تفاوضِ القروبِ: البوتُ يُخبِرُ ويُحيلُ، والقرارُ هنا. */}
        {view.status === "searching" && (
          <NegotiationPanel
            language={language}
            refreshToken={candidateToken}
            onSettled={() => void refresh(orderId)}
          />
        )}
        {view.status === "searching" && (
          <RideCandidateCard
            orderId={orderId}
            language={language}
            refreshToken={candidateToken}
            onDecided={() => void refresh(orderId)}
          />
        )}
        <div className="ar__hero">
          <p className="ar__status">{t(rideStatusKey(view.status))}</p>
          {/* R7 · §11 PR 4: شريطُ الحقيقةِ (طورُ الخادمِ بنغمتِه) وسكّةُ المراحل — من القراءةِ وحدَها. */}
          <RideJourney
            language={language}
            stage={journeyFromActivePhase(view.phase)}
            truth={activeRideTruth(view.phase)}
          />

          <p className="ar__elapsed" aria-live="polite">
            {t(elapsed.key)
              .replace("{minutes}", String(elapsed.minutes))
              .replace("{seconds}", String(elapsed.seconds))}
          </p>

          <p className="ar__route">
            {t("rider.active.route")
              .replace("{pickup}", view.pickup.label ?? t("rider.active.point.unlabeled"))
              .replace("{dropoff}", view.dropoff?.label ?? t("rider.active.point.unlabeled"))}
          </p>
        </div>

        {/* كتلةُ السائقِ تُرسَمُ إن أسندَته القاعدةُ — ولا صفَّ فارغٍ ينتظرُه. */}
        {driver === null ? (
          <p className="ar__no-driver">{t("rider.active.driver.none")}</p>
        ) : (
          <div className="ar__driver">
            <span className="ar__driver-avatar">
              <Glyph name="car" />
            </span>
            <p className="ar__driver-name">{t(driver.nameKey).replace("{name}", driver.name)}</p>
            <p className="ar__driver-vehicle">
              {t(driver.vehicleKey).replace("{vehicle}", vehicleTypeText(t, driver.vehicle) ?? "")}
            </p>
            <p className="ar__driver-plate">
              {t(driver.plateKey).replace("{plate}", driver.plate)}
            </p>
            <p className="ar__driver-rating">
              {t(driver.ratingKey)
                .replace("{average}", driver.ratingAverage.toFixed(1))
                .replace("{count}", String(driver.ratingCount))}
            </p>
          </div>
        )}

        {/* WR-04: غرفةُ المحادثةِ مع السائقِ المُسنَد — لا غرفةَ قبلَ الإسناد. */}
        {driver === null ? null : (
          <OrderChat
            orderId={orderId}
            statusText={t(rideStatusKey(view.status))}
            labels={{
              title: t("rider.active.chat.title"),
              open: t("rider.active.chat.open"),
              hide: t("rider.active.chat.hide"),
              unread: t("rider.active.chat.unread"),
              placeholder: t("rider.active.chat.placeholder"),
              send: t("rider.active.chat.send"),
              sending: t("rider.active.chat.sending"),
              failed: t("rider.active.chat.failed"),
              retry: t("rider.active.chat.retry"),
              closed: t("rider.active.chat.closed"),
              empty: t("rider.active.chat.empty"),
              loadFailed: t("rider.active.chat.loadFailed"),
              unavailable: t("rider.active.chat.unavailable"),
              seen: t("rider.active.chat.seen"),
              counterpart: t("rider.active.chat.counterpart"),
              status: t("rider.active.chat.status"),
              offerFixed: t("rider.active.chat.offerFixed"),
              offerSuggested: t("rider.active.chat.offerSuggested"),
              offerOpen: t("rider.active.chat.offerOpen"),
              refresh: t("rider.active.chat.refresh"),
              shareLocation: t("rider.active.chat.shareLocation"),
              locating: t("rider.active.chat.locating"),
              locationPreview: t("rider.active.chat.locationPreview"),
              sendLocation: t("rider.active.chat.sendLocation"),
              cancel: t("rider.active.chat.cancel"),
              locationFailed: t("rider.active.chat.locationFailed"),
              locationMessage: t("rider.active.chat.locationMessage"),
              openInMaps: t("rider.active.chat.openInMaps"),
              accuracy: t("rider.active.chat.accuracy"),
              translated: t("rider.active.chat.translated"),
              showOriginal: t("rider.active.chat.showOriginal"),
              showTranslation: t("rider.active.chat.showTranslation"),
              translationNotice: t("rider.active.chat.translationNotice"),
            }}
          />
        )}

        <div className="ar__facts">
          {/* الموقعُ **معَ عُمرِه** أو سببُ حجبِه — ولا ثالثَ (`BUG-001`). */}
          {position !== null &&
            (position.show && !positionAgeKnown ? (
              <p className="ar__position-hidden">{t(TRUTH_AGE_UNKNOWN_KEY)}</p>
            ) : position.show ? (
              <div className="ar__position" role="status">
                <p className="ar__position-point">
                  {t("rider.active.position.point")
                    .replace("{lat}", position.lat.toFixed(5))
                    .replace("{lng}", position.lng.toFixed(5))}
                </p>
                <p className="ar__position-age">
                  {t(position.ageKey)
                    .replace("{minutes}", String(position.ageMinutes))
                    .replace("{seconds}", String(position.ageSeconds))}
                  <small className="ui-truth__seal">{t(TRUTH_SOURCE_KEYS.server_age)}</small>
                </p>
              </div>
            ) : (
              <p className="ar__position-hidden">{t(position.key)}</p>
            ))}

          {eta !== null && (
            <p className="ar__eta" aria-live="polite">
              {eta.kind === "ROUTED"
                ? t(eta.key).replace("{minutes}", String(eta.minutes))
                : t(eta.key)}
              {eta.kind === "ROUTED" ? (
                <small className="ui-truth__seal">{t(TRUTH_SOURCE_KEYS.routing_engine)}</small>
              ) : null}
            </p>
          )}

          {band !== null && (
            <p className="ar__eta-band">
              {band.kind === "MEASURED"
                ? t(band.key)
                    .replace("{low}", String(band.lowMinutes))
                    .replace("{high}", String(band.highMinutes))
                    .replace("{coverage}", String(band.coveragePercent))
                    .replace("{samples}", String(band.samples))
                : band.kind === "INSUFFICIENT"
                  ? t(band.key)
                      .replace("{samples}", String(band.samples))
                      .replace("{required}", String(band.required))
                  : t(band.key)}
              {band.kind === "UNAVAILABLE" ? null : (
                <small className="ui-truth__seal">{t(TRUTH_SOURCE_KEYS.observed_trips)}</small>
              )}
            </p>
          )}

          <p className="ar__observed">
            {observed.kind === "KNOWN" ? (
              <>
                {t(observed.key).split("{time}")[0]}
                <time dateTime={observed.iso}>{observed.time}</time>
                {t(observed.key).split("{time}")[1] ?? ""}
                <small className="ui-truth__seal">{t(TRUTH_SOURCE_KEYS.server_clock)}</small>
              </>
            ) : (
              t(observed.key)
            )}
          </p>

          {/* لقطةٌ بثٌّ حيٌّ: يُقالُ ذلكَ نصّاً ويُعطى بابُ سؤالٍ يدويٌّ احتياطيٌّ. */}
          <div className="ar__snapshot" role="status">
            <p className="sys__hint">
              {t(
                channelTransport !== undefined && liveTracking.position !== null
                  ? "rider.active.liveTracking"
                  : "rider.active.snapshot",
              )}
            </p>
            <button
              type="button"
              className="sys__action ar__refresh"
              disabled={reading}
              onClick={() => void refresh(orderId)}
            >
              <Glyph name="refresh" className="ar__refresh-icon" />
              {t(reading ? "rider.active.refreshing" : "rider.active.refresh")}
            </button>
          </div>
        </div>

        {/* مشاركةُ الرحلةِ (`F2-09`) — بطاقةٌ تقرأُ حالَها بنفسِها، وتُخفي نفسَها
            متى لم يكنْ ثمَّةَ ما يُشارَكُ ولا ما يُوقَفُ. */}
        {onOpenShare === undefined && <RideShareCard orderId={orderId} language={language} />}

        {/* الاستغاثةُ (`F2-10`) — بطاقةٌ تقرأُ حكمَها بنفسِها من القاعدةِ، ولا
            تُمرَّرُ إليها رحلةٌ: الطلبُ يُحَلَّ خادميًّا تحتَ القفلِ (`ADR 0077`). */}
        {onOpenHelp === undefined && <SosCard language={language} />}

        {/* R5: صفُّ «مشاركة الرحلة» (محايدٌ) و«طلب المساعدة» (خطرٌ) — كلٌّ يفتحُ شاشتَه الحقيقيّةَ. */}
        {onOpenShare !== undefined || onOpenHelp !== undefined ? (
          <div className="ar__actions">
            {onOpenShare === undefined ? null : (
              <button type="button" className="ar__open-share" onClick={() => onOpenShare()}>
                <Glyph name="share" className="ar__action-icon" />
                {t("rider.active.openShare")}
              </button>
            )}
            {onOpenHelp === undefined ? null : (
              <button type="button" className="ar__open-help" onClick={() => onOpenHelp()}>
                <Glyph name="shield" className="ar__action-icon" />
                {t("rider.active.openHelp")}
              </button>
            )}
          </div>
        ) : null}

        {/* بابُ الملخَّصِ (`F2-07`) — **بحكمِ القاعدةِ `completed` وحدَه**، وبمُركِّبٍ
            أعطى مساراً. ولا زرَّ قبلَ الانتهاءِ: ملخَّصُ رحلةٍ جاريةٍ ليسَ ملخَّصاً. */}
        {view.status === "completed" && onFinished !== undefined && (
          <button type="button" className="ar__summary" onClick={() => onFinished(orderId)}>
            {t("rider.active.summary")}
          </button>
        )}

        {/* سياسةُ الإلغاءِ نصٌّ إجرائيٌّ، والزرُّ للحرِّ وحدَه. */}
        <p className="ar__cancel-policy">{t(cancelPolicyKey(view.cancelPolicy))}</p>
        {showsCancelButton(view.cancelPolicy) && (
          <button
            type="button"
            className="ar__cancel"
            disabled={busy}
            onClick={() => void askCancel()}
          >
            {t(busy ? "rider.active.cancelling" : "rider.active.cancel")}
          </button>
        )}
      </div>
    );
  };

  return (
    <section
      className="ar"
      dir={directionFor(language)}
      {...(showTitle ? { "aria-labelledby": "ar-title" } : {})}
    >
      {showTitle ? (
        <h1 className="ar__title" id="ar-title">
          {t("rider.active.title")}
        </h1>
      ) : null}
      {body()}
    </section>
  );
}
