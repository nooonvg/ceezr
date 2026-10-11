/**
 * الغرض: شاشةُ الراكبِ الرئيسةُ `SR-02` (البند `F2-02`): خريطةٌ مصغَّرةٌ أو إعلانُ
 *   تعذّرِها · حقلُ «إلى أين؟» · الأماكنُ المحفوظةُ · آخرُ الوجهاتِ · شرائحُ
 *   الخدماتِ · شريطُ حالةِ المدينةِ — كما ينصُّ القسم 9.5 حرفاً.
 * الحالة: منفّذ فعلياً — البند `F2-02`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/home
 * يُتوقع أن يستخدمه لاحقاً: `RiderRoot.tsx`، وشاشةُ طلبِ المشوارِ `F2-03` تُركَّبُ
 *   بعدَ اختيارِ وجهةٍ من ههنا.
 * ملاحظات مستقبلية: الشريطُ السفليُّ بأربعِ علاماتٍ (القسم 9.3) بندُ `F1-07` ولا
 *   يُدَّعى ههنا.
 *
 * ═══ حدودٌ معلَنةٌ في هذه الشاشةِ ═══
 *
 *   ١. **لا خريطةَ حقيقيّةً**: لا مزوّدَ خرائطَ في حزمةِ التطبيقِ المصغَّرِ اليومَ
 *      (مزوّدُ `packages/maps` يُصيِّرُ صفحاتَ اللوحةِ في الخادمِ — ADR 0007).
 *      فالشاشةُ تُعلِنُ `rider.home.map.unavailable` ولا ترسمُ مستطيلاً رمادِيّاً
 *      يُوهِمُ موقعاً. ويُمرَّرُ `mapProvider` وسيطاً كي يصيرَ التركيبُ تبديلَ
 *      وسيطٍ حينَ يُهيَّأُ مزوّدٌ فعليٌّ، لا إعادةَ كتابةٍ للشاشةِ.
 *   ٢. **لا موقعَ للجهازِ**: طلبُ الإذنِ الجغرافيِّ وقراءتُه بندٌ لاحقٌ، فـ«موقعي»
 *      غيرُ مزعومٍ ههنا.
 *   ٣. **لا انتقالَ بعدَ الاختيارِ**: اختيارُ وجهةٍ أو خدمةٍ يُبلَّغُ للأعلى عبرَ
 *      `onDestinationChosen`؛ وشاشةُ ما بعدَه بندُ `F2-03`.
 *   ٤. **لم تُفتَح من مستخدمٍ حقيقيٍّ بعد**: لا نشرَ حيَّ لهذه الحزمةِ، فما ههنا
 *      مُختبَرٌ لا مُثبَتٌ عندَ مستخدمٍ (سُلَّمُ القسم 1.3).
 *
 * ## إضافةُ البند `F2-08` (2026-09-14)
 *
 * صارَ للشاشةِ **مدخلُ سجلٍّ** واحدٌ (`onOpenHistory`) يفتحُ `SR-09`. وما قبلَه
 * **باقٍ كما هوَ** (القاعدة ح-1) ولا سطرَ حُذِفَ؛ والحدُّ الثالثُ أعلاه القائلُ
 * إنَّ الاختيارَ يُبلَّغُ للأعلى **باقٍ على حالِه**: هذا المدخلُ كذلكَ لا ينتقلُ
 * بنفسِه بل يُبلِّغُ `RiderRoot.tsx`.
 *
 * ولماذا زرٌّ **لا شريحةٌ رابعةٌ في `rh__services`**: الشرائحُ تختارُ خدمةَ طلبٍ
 * جديدٍ، والسجلُّ قراءةُ ماضٍ — وضمُّهما يجعلُ «السجلَّ» يُقرأُ خدمةً تُطلَبُ.
 *
 * وهوَ مرسومٌ في فرعِ **الرفضِ** أيضاً: تعذُّرُ قراءةِ الأماكنِ لا علاقةَ له
 * بسجلِّ الرحلاتِ، وحجبُه هناكَ يحبسُ الراكبَ عن ماضيه بسببِ عطبٍ في حاضرِه.
 *
 * وما لا يفعلُه: لا يعرضُ عدداً ولا آخرَ رحلةٍ ههنا — ذاكَ نداءٌ ثانٍ لِيُرسَمَ
 * رقمٌ في زرٍّ، والقائمةُ نفسُها تقولُه بعدَ فتحِها.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Glyph, IconChevron } from "../../../system/ui/icons.tsx";
import type { DeviceFixResult } from "../destination/device-fix.ts";

/**
 * ADR 0252 · ADR 0251 §6 (`D-41`): قراءةُ الموقعِ من وحدةِ الوجهةِ المؤجَّلة — تُستورَدُ عندَ ضغطِ «حدّث موقعي»
 * لا في الحِملِ الأوّل (حاجزُ `assert-rider-first-surface`). وغالباً تكونُ الحزمةُ قد جُلِبَت بعدَ رسمِ السطح.
 */
const readFreshDeviceFixDeferred = (): Promise<DeviceFixResult> =>
  import("../destination/device-fix.ts").then((m) => m.readFreshDeviceFix());

import { SosEntry } from "../sos/SosEntry.tsx";
import { fetchActiveRideId } from "./active-ride.ts";
import {
  HOME_SERVICES,
  type HomeService,
  isRetryablePlacesError,
  isSubmittableDestination,
  type PlaceRow,
  placeRows,
  placesErrorKey,
  type RecentRow,
  recentRows,
  serviceKey,
} from "./home-view.ts";
import {
  type ApiOperatingCity,
  cityLabel,
  fetchOperatingCity,
  type LocateCityResponse,
  locateMessageKey,
  type OperatingCityResponse,
  postOperatingCityLocation,
} from "./operating-city-api.ts";
import {
  type ApiRecentDestination,
  type ApiSavedPlace,
  fetchRecentDestinations,
  fetchSavedPlaces,
} from "./places-api.ts";

export interface ChosenDestination {
  readonly label: string;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly service: HomeService;
}

export interface HomeScreenProps {
  /** يُحقَنانِ كي تُختبَرَ الشاشةُ بلا شبكةٍ ولا `fetch` مُرقَّعٍ. */
  readonly loadPlaces?: () => Promise<{ readonly places: readonly ApiSavedPlace[] }>;
  readonly loadRecent?: () => Promise<{
    readonly destinations: readonly ApiRecentDestination[];
  }>;
  readonly onDestinationChosen?: (chosen: ChosenDestination) => void;
  /**
   * مدخلُ سجلِّ الرحلاتِ (`SR-09` · البند `F2-08`). وغيابُه **لا يرسمُ زرّاً
   * مُعطَّلاً**: مدخلٌ لا يُفتَحُ أسوأُ من غيابِ مدخلٍ.
   */
  readonly onOpenHistory?: () => void;
  /** مدخلُ مركزِ الإشعاراتِ (`SS-07`) — **اختياريٌّ** كأختِه: غيابُه لا يُبيِّضُ الرئيسةَ. */
  readonly onOpenNotifications?: () => void;
  /** مدخلُ صفحةِ المفقوداتِ المخصَّصةِ (DEC-34) — **اختياريٌّ** كأختِه. */
  readonly onOpenLostFound?: () => void;
  /** مدخلُ شاشةِ الحسابِ (`SR-12`) — **اختياريٌّ** كأختِه: غيابُه لا يُبيِّضُ الرئيسةَ. */
  readonly onOpenAccount?: () => void;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ كأخوتَيهِ. */
  readonly onOpenSos?: () => void;
  /**
   * `WR-14` (§14): متابعةُ الرحلةِ القائمةِ بمعرّفِها من الخادم. وغيابُه لا يرسمُ البطاقة،
   * وإخفاقُ القراءةِ يُخفيها ولا يُسقطُ الرئيسة.
   */
  readonly onContinueRide?: (orderId: string) => void;
  /** يُحقَنُ للاختبار؛ الافتراضيُّ أحدثُ صفٍّ في السجلِّ (`active-ride.ts`). */
  readonly loadActiveRide?: () => Promise<string | null>;
  readonly initialLanguage?: MiniAppLanguage;
  readonly showTitle?: boolean;
  /** اسمُ المزوّدِ المُهيَّأِ فعلاً؛ `"none"` تعني: قُلِ الحدَّ ولا ترسمْ. */
  readonly mapProvider?: string;
  /** اسمُ المدينةِ كما يُعيدُه الخادمُ — يُعرَضُ بجانبِ حالتِها لا بدلاً منها. */
  readonly cityName?: string;
  /**
   * R1 · ADR 0252: المدينةُ التشغيليّةُ من الخادم (`/v1/me/operating-city`) وتحديثُها من آخرِ
   * موقعٍ صالح. حُقَنٌ للاختبار؛ والإنتاجُ يستعملُ الافتراضيّات. لا اختيارَ يدويّاً للمدينة.
   */
  readonly loadCity?: () => Promise<OperatingCityResponse>;
  readonly locateCity?: (lat: number, lng: number) => Promise<LocateCityResponse>;
  readonly readFix?: () => Promise<DeviceFixResult>;
}

type CityState =
  | { readonly kind: "idle" }
  | { readonly kind: "locating" }
  | { readonly kind: "result"; readonly key: string }
  | { readonly kind: "failed"; readonly key: string };

type LoadState =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly places: readonly PlaceRow[];
      readonly recent: readonly RecentRow[];
    }
  | { readonly kind: "screen"; readonly screen: ScreenState }
  | { readonly kind: "rejected"; readonly code: string };

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

export function HomeScreen({
  loadPlaces = fetchSavedPlaces,
  loadRecent = fetchRecentDestinations,
  onDestinationChosen,
  onOpenHistory,
  onOpenLostFound,
  onOpenNotifications,
  onOpenAccount,
  onOpenSos,
  onContinueRide,
  loadActiveRide = fetchActiveRideId,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  showTitle = true,
  mapProvider = "none",
  cityName,
  loadCity = fetchOperatingCity,
  locateCity = postOperatingCityLocation,
  readFix = readFreshDeviceFixDeferred,
}: HomeScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [typed, setTyped] = useState("");
  const [service, setService] = useState<HomeService>("transport");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      // النداءانِ متوازيانِ: لا أحدَهما شرطٌ للآخرِ، وتسلسلُهما يُضاعِفُ زمنَ
      // أوّلِ رسمٍ على شبكةٍ ضعيفةٍ (`UX-4`).
      const [placesResponse, recentResponse] = await Promise.all([loadPlaces(), loadRecent()]);
      if (!mounted.current) return;
      setState({
        kind: "ready",
        places: placeRows(placesResponse.places),
        recent: recentRows(recentResponse.destinations),
      });
    } catch (thrown) {
      const screen = await screenFor(thrown);
      if (!mounted.current) return;
      if (screen !== null) {
        setState({ kind: "screen", screen });
        return;
      }
      setState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
    }
  }, [loadPlaces, loadRecent]);

  useEffect(() => {
    void load();
  }, [load]);

  // `WR-14`: الرحلةُ القائمةُ من الخادمِ بعدَ الرسم، فلا تُبدأُ التجربةُ من الصفرِ فوقَها.
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  useEffect(() => {
    if (onContinueRide === undefined) return;
    loadActiveRide()
      .then((orderId) => {
        if (mounted.current) setActiveRideId(orderId);
      })
      .catch(() => {});
  }, [onContinueRide, loadActiveRide]);
  const activeRideCard =
    activeRideId === null || onContinueRide === undefined ? null : (
      <div className="rh__active-ride" role="status">
        <p className="rh__active-ride-title">{t("rider.home.activeRide.title")}</p>
        <button
          type="button"
          className="rh__active-ride-continue"
          onClick={() => onContinueRide(activeRideId)}
        >
          {t("rider.home.activeRide.continue")}
        </button>
      </div>
    );

  // R1: المدينةُ من الخادمِ بعدَ الرسمِ لا قبلَه (لا تُؤخِّرُ السطحَ الأوّل)، وفشلُ قراءتِها لا
  // يُسقطُ الرئيسة: الحبّةُ تغيبُ ويبقى زرُّ التحديث.
  const [city, setCity] = useState<ApiOperatingCity | null>(null);
  const [cityState, setCityState] = useState<CityState>({ kind: "idle" });
  useEffect(() => {
    if (cityName !== undefined) return;
    loadCity()
      .then((response) => {
        if (mounted.current) setCity(response.city);
      })
      .catch(() => {});
  }, [cityName, loadCity]);

  const updateCity = async () => {
    setCityState({ kind: "locating" });
    const fix = await readFix();
    if (!mounted.current) return;
    if (!fix.ok) {
      setCityState({ kind: "failed", key: "rider.home.city.fixFailed" });
      return;
    }
    try {
      const response = await locateCity(fix.lat, fix.lng);
      if (!mounted.current) return;
      setCity(response.city);
      setCityState({ kind: "result", key: locateMessageKey(response.outcome) });
    } catch {
      if (mounted.current) setCityState({ kind: "failed", key: "rider.home.city.updateFailed" });
    }
  };

  const choose = (label: string, lat: number | null, lng: number | null) => {
    onDestinationChosen?.({ label, lat, lng, service });
  };

  // `UI-POLISH-02`: بلا اسمِ مدينةٍ لا يُكتَبُ «مدينتك الحالية» وحدَه سطراً يتيماً بلا معنى.
  const shownCity = cityName ?? (city === null ? undefined : cityLabel(city, language));
  const cityBar = (
    <div className="rh__city-row">
      {shownCity === undefined ? null : (
        <p className="rh__city" role="status">
          <Glyph name="pin" className="rh__city-icon" />
          <span>{`${t("rider.home.city.status")}: ${shownCity}`}</span>
        </p>
      )}
      <button
        type="button"
        className="rh__city-update"
        disabled={cityState.kind === "locating"}
        onClick={() => void updateCity()}
      >
        {t(cityState.kind === "locating" ? "rider.home.city.locating" : "rider.home.city.update")}
      </button>
      {cityState.kind === "result" || cityState.kind === "failed" ? (
        <p className="rh__city-note" role="status">
          {t(cityState.key)}
        </p>
      ) : null}
    </div>
  );

  const services = (
    <fieldset className="rh__services">
      <legend className="sys__hint">{t("rider.home.service.legend")}</legend>
      {HOME_SERVICES.map((name) => (
        <button
          key={name}
          type="button"
          className={`rh__service${name === service ? " rh__service--on" : ""}`}
          aria-pressed={name === service}
          onClick={() => setService(name)}
        >
          <Glyph name={name === "transport" ? "car" : "parcel"} className="rh__service-icon" />
          <span>{t(serviceKey(name))}</span>
        </button>
      ))}
    </fieldset>
  );

  const title = showTitle ? (
    <h1 id="rh-title" className="rh__title">
      {t("rider.home.title")}
    </h1>
  ) : null;
  const sectionName = showTitle ? { "aria-labelledby": "rh-title" as const } : {};

  const historyEntry =
    onOpenHistory === undefined ? null : (
      <button type="button" className="rh__history" onClick={() => onOpenHistory()}>
        <span className="rh__menu-icon">
          <Glyph name="rides" />
        </span>
        <span className="rh__menu-label">{t("rider.home.history.open")}</span>
      </button>
    );

  const notificationsEntry =
    onOpenNotifications === undefined ? null : (
      <button type="button" className="rh__notifications" onClick={() => onOpenNotifications()}>
        <span className="rh__menu-icon">
          <Glyph name="bell" />
        </span>
        <span className="rh__menu-label">{t("rider.home.notifications.open")}</span>
      </button>
    );

  // مدخلُ الحسابِ (`SR-12`). **زرٌّ لا أيقونةٌ عاريةٌ**: أيقونةُ تروسٍ بلا نصٍّ
  // لا يقرؤها قارئُ الشاشةِ، وفيها بابُ حذفِ الحسابِ (`UX-10`).
  const accountEntry =
    onOpenAccount === undefined ? null : (
      <button type="button" className="rh__account" onClick={() => onOpenAccount()}>
        <span className="rh__menu-icon">
          <Glyph name="account" />
        </span>
        <span className="rh__menu-label">{t("rider.home.account.open")}</span>
      </button>
    );

  // مدخلُ صفحةِ المفقوداتِ المخصَّصةِ (DEC-34) — **زرٌّ اختياريٌّ** كأخوتِه.
  const lostFoundEntry =
    onOpenLostFound === undefined ? null : (
      <button type="button" className="rh__lost-found" onClick={() => onOpenLostFound()}>
        <span className="rh__menu-icon">
          <Glyph name="box" />
        </span>
        <span className="rh__menu-label">{t("rider.home.lostFound.open")}</span>
      </button>
    );

  // مدخلُ الاستغاثةِ (`PD-020`) — مدخلٌ موحَّدٌ لا زرٌّ يكتبُه كلُّ سطحٍ بيدِه.
  const sosEntry =
    onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />;

  if (state.kind === "loading") {
    return (
      <section className="rh" dir={directionFor(language)} aria-busy="true" {...sectionName}>
        {title}
        <Skeleton />
      </section>
    );
  }

  if (state.kind === "screen") {
    // نصُّ شاشةِ النظامِ عربيٌّ اليومَ (دَينٌ مُعلَنٌ في `ROADMAP.md`)، فيُثبَّتُ
    // اتجاهُها عربيّاً: نصٌّ عربيٌّ في إطارٍ يساريٍّ يُقرأُ مقلوباً.
    return (
      <div dir="rtl">
        <SystemScreen language={language} state={state.screen} onAction={() => void load()} />
      </div>
    );
  }

  if (state.kind === "rejected") {
    return (
      <section className="rh" dir={directionFor(language)} {...sectionName}>
        {title}
        {historyEntry}
        {notificationsEntry}
        {lostFoundEntry}
        {accountEntry}
        {sosEntry}
        <div className="sys" role="alert">
          <p className="sys__body">{t(placesErrorKey(state.code))}</p>
          {isRetryablePlacesError(state.code) ? (
            <button type="button" className="sys__action" onClick={() => void load()}>
              {t("rider.home.retry")}
            </button>
          ) : null}
        </div>
        {cityBar}
        {activeRideCard}
      </section>
    );
  }

  // `UI-DESIGN-01`: الطلبُ أوّلاً — بطاقةٌ واحدةٌ فيها الخدمةُ والوجهةُ والزرُّ، ثمَّ الأماكنُ،
  // ثمَّ القائمةُ شبكةً في الأسفلِ. كانت أربعةُ أزرارِ تنقّلٍ وزرُّ استغاثةٍ تسبقُ حقلَ الوجهةِ
  // فيبدو التطبيقُ قائمةَ أزرارٍ لا تطبيقَ مشاوير.
  const hasMenu =
    historyEntry !== null ||
    notificationsEntry !== null ||
    lostFoundEntry !== null ||
    accountEntry !== null;
  return (
    <section className="rh" dir={directionFor(language)} {...sectionName}>
      {cityBar}
      {activeRideCard}
      <div className="rh__hero">
        {title}
        {services}
        {mapProvider === "none" ? null : <div className="rh__map" data-provider={mapProvider} />}
        <label className="rh__field" htmlFor="rh-destination">
          <span className="rh__field-label">{t("rider.home.destination.prompt")}</span>
          <span className="rh__input-wrap">
            <Glyph name="pin" className="rh__input-icon" />
            <input
              id="rh-destination"
              className="rh__input"
              type="text"
              enterKeyHint="search"
              autoComplete="off"
              placeholder={t("rider.home.destination.placeholder")}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isSubmittableDestination(typed)) {
                  choose(typed.trim(), null, null);
                }
              }}
            />
          </span>
        </label>
        {mapProvider === "none" ? (
          <p className="sys__hint">{t("rider.home.map.unavailable")}</p>
        ) : null}
        <button
          type="button"
          className="sys__action rh__go"
          disabled={!isSubmittableDestination(typed)}
          onClick={() => choose(typed.trim(), null, null)}
        >
          {t("rider.home.destination.action")}
        </button>
      </div>

      <h2 className="rh__heading">{t("rider.home.places.title")}</h2>
      {state.places.length === 0 ? (
        <p className="sys__hint">{t("rider.home.places.empty")}</p>
      ) : (
        <ul className="rh__places">
          {state.places.map((place) => (
            <li key={place.id} className="rh__place">
              <button
                type="button"
                className="rh__pick"
                onClick={() => choose(place.label, place.lat, place.lng)}
              >
                <span className="rh__pick-icon">
                  <Glyph name={placeGlyph(place.kindKey)} />
                </span>
                <span className="rh__pick-text">
                  <span className="rh__place-label">{place.label}</span>
                  {t(place.kindKey) === place.label ? null : (
                    <span className="rh__place-kind">{t(place.kindKey)}</span>
                  )}
                </span>
                <IconChevron className="rh__pick-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2 className="rh__heading">{t("rider.home.recent.title")}</h2>
      {state.recent.length === 0 ? (
        <p className="sys__hint">{t("rider.home.recent.empty")}</p>
      ) : (
        <ul className="rh__recent">
          {state.recent.map((row) => (
            <li key={`${row.label}:${row.lastUsedAt}`} className="rh__recent-row">
              <button
                type="button"
                className="rh__pick"
                onClick={() => choose(row.label, row.lat, row.lng)}
              >
                <span className="rh__pick-icon">
                  <Glyph name="recent" />
                </span>
                <span className="rh__pick-text">
                  <span className="rh__place-label">{row.label}</span>
                </span>
                <IconChevron className="rh__pick-chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMenu ? (
        <nav className="rh__menu">
          {historyEntry}
          {notificationsEntry}
          {lostFoundEntry}
          {accountEntry}
        </nav>
      ) : null}
      {sosEntry}
    </section>
  );
}

/** `UX-V2`: رمزُ نوعِ المكانِ المحفوظِ — من مفتاحِ نوعِه المعلنِ، والمجهولُ دبّوسٌ عامّ. */
function placeGlyph(kindKey: string): "homePlace" | "work" | "pin" {
  if (kindKey.endsWith(".home")) return "homePlace";
  if (kindKey.endsWith(".work")) return "work";
  return "pin";
}
