/**
 * الغرض: شاشةُ اختيارِ الوجهةِ `SR-03` (البند `F2-03`): بحثٌ نصّيٌّ في ثلاثةِ
 *   مصادرَ · «موقعي الحاليُّ» من مُضيفِ تيليجرام · مصادقةُ الدبّوسِ على حدِّ
 *   منطقةِ الخدمةِ · تأكيدُ الوجهةِ.
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/destination
 * يُستخدم من: `RiderRoot.tsx` بعدَ `onDestinationChosen` من `HomeScreen`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-04` يُركَّبُ بعدَ `onConfirmed` من ههنا.
 *
 * ═══ حدودٌ معلَنةٌ في هذه الشاشةِ ═══
 *
 *   ١. **لا خريطةَ حقيقيّةً ولا اختيارَ دبّوسٍ بالإصبعِ**: لا مزوّدَ خرائطَ في
 *      حزمةِ التطبيقِ المصغَّرِ اليومَ (ADR 0007)، فالنصفُ البصريُّ من `SR-03`
 *      **غيرُ مُدَّعى** ومُسجَّلٌ دَيناً في ADR 0102 §6. والشاشةُ تُعلِنُ ذاكَ
 *      بـ`rider.destination.map.unavailable` ولا ترسمُ مستطيلاً رمادِيّاً.
 *      والبديلُ المبنيُّ **حقيقيٌّ لا تعويضيٌّ**: بحثٌ في دليلٍ نملكُه، وموقعُ
 *      الجهازِ من المُضيفِ، وإحداثيّةٌ تُصادَقُ على هندسةٍ فعليّةٍ في القاعدةِ.
 *   ٢. **لا مُرمِّزَ جغرافيّاً**: لا تحويلَ نصٍّ حرٍّ إلى إحداثيّةٍ. مَن لم يجدْ
 *      وجهتَه في الدليلِ يُخبَرُ بذاكَ صريحاً (`rider.destination.empty`)، ولا
 *      يُرسَلُ نصُّه إلى مزوّدٍ خارجيٍّ (`O-7`).
 *   ٣. **لا موقعَ مُختلَقٌ عندَ الرفضِ**: إن رفضَ المستخدمُ الإذنَ أو غابَت
 *      الميزةُ يُقالُ السببُ، ولا يُستعاضُ عنه بمركزِ المدينةِ.
 *   ٤. **`LOC-TRUST-01` — الإحداثيّةُ هيَ الحقيقةُ والاسمُ وصف** (ADR 0247): «موقعي
 *      الحاليُّ» يقرأُ المتصفّحَ أوّلاً بلا تخبئةٍ ثمَّ Telegram (`device-fix.ts`)،
 *      ويحفظُ الدقّةَ ووقتَ الالتقاط، ويعرضُ النقطةَ نفسَها وزرَّ «تحقّق على الخريطة»،
 *      ولا يُعتمَدُ مكانٌ إلّا بتأكيدٍ صريح — وقراءةٌ خشنةٌ بإقرارٍ، والرديئةُ لا تُعتمَد.
 *      وأقربُ معلَمٍ سطرُ وصفٍ لا يصيرُ اسمَ المكانِ أبداً. ويقبلُ رابطَ موقعٍ أو
 *      إحداثيّاتٍ ملصوقةً (الرابطُ يُحفَظُ حرفاً)، واسماً وملاحظاتٍ للمكان.
 *   ٥. **لم تُفتَح من مستخدمٍ حقيقيٍّ بعد**: لا نشرَ حيَّ لهذه الحزمةِ، فما ههنا
 *      مُختبَرٌ لا مُثبَتٌ عندَ مستخدمٍ (سُلَّمُ القسم 1.3).
 */

import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-destination.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  assessDeviceFix,
  type DeviceFixAssessment,
  linkConflictsWithPoint,
  type ParsedPlaceLink,
  PLACE_NOTES_MAX_LENGTH,
  type PlacePointSource,
} from "../../../../../../packages/domain/places/place-input.ts";
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
import { Glyph, IconSearch } from "../../../system/ui/icons.tsx";
import { openExternalLink, openLocationSettings } from "../../../tg/index.ts";
import { SosEntry } from "../sos/SosEntry.tsx";
import {
  type AcceptedSummary,
  acceptedSummary,
  type ConfirmedPlace,
  confirmBlocker,
  destinationErrorKey,
  fixReasonKey,
  formatPoint,
  highlightRange,
  isRetryableDestinationError,
  isSearchable,
  labelFor,
  landmarkPhrase,
  locateIntent,
  locateShortcutPlacement,
  locationRefusalKey,
  offersLocationSettings,
  pointSourceKey,
  type RefusalView,
  readPastedPlace,
  refusalView,
  type SuggestionRow,
  suggestionRows,
} from "./destination-view.ts";
import {
  type DestinationResolveResponse,
  type DestinationSearchResponse,
  resolveDestination as resolveViaApi,
  searchDestinations as searchViaApi,
} from "./destinations-api.ts";
import { type DeviceFixResult, readFreshDeviceFix } from "./device-fix.ts";

export interface ConfirmedDestination {
  /** نصُّ العرضِ — اسمُ الراكبِ إن وُجِدَ وإلّا وصفٌ محليٌّ للنقطة (لا اسمُ معلَم). */
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  readonly cityCode: string | null;
  /** `LOC-TRUST-01` — ما أدخلَه الراكبُ عن المكان. غائبٌ في مستهلكٍ أقدم. */
  readonly place?: ConfirmedPlace;
}

export interface DestinationScreenProps {
  /** يُحقَنانِ كي تُختبَرَ الشاشةُ بلا شبكةٍ ولا `fetch` مُرقَّعٍ. */
  readonly search?: (query: string) => Promise<DestinationSearchResponse>;
  readonly resolve?: (lat: number, lng: number) => Promise<DestinationResolveResponse>;
  /** ويُحقَنُ جسرُ الموقعِ كي لا يُحتاجَ مُضيفُ تيليجرام في اختبارٍ. */
  readonly readDeviceLocation?: () => Promise<DeviceFixResult>;
  readonly openSettings?: () => void;
  /** فتحُ «تحقّق على الخريطة» — يُحقَنُ في الاختبار. */
  readonly openLink?: (url: string) => unknown;
  /** ساعةُ الحكمِ على حداثةِ القراءة — تُحقَنُ في الاختبار. */
  readonly now?: () => number;
  readonly onConfirmed?: (destination: ConfirmedDestination) => void;
  readonly onBack?: () => void;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ: يُرسَمُ إذا مُرِّرَ. */
  readonly onOpenSos?: () => void;
  readonly initialLanguage?: MiniAppLanguage;
  readonly showTitle?: boolean;
  /** ما كتبَه الراكبُ في شاشةِ `SR-02` — يُبتدأُ به البحثُ بلا إعادةِ كتابةٍ. */
  readonly initialQuery?: string;
  /**
   * وجهةٌ جاءَت **بإحداثيّةٍ** من الشاشةِ السابقةِ (مكانٌ محفوظٌ أو وجهةٌ أخيرةٌ):
   * تُصادَقُ فوراً ولا يُعادُ البحثُ عنها. ومَن اختارَ «المنزلَ» باسمِه لا يُطلَبُ
   * منه أن يكتبَه ثانيةً — ولو طُلِبَ لَكانت الشاشةُ تُعاقِبُ اختياراً صحيحاً.
   *
   * والمصادقةُ تُعادُ ههنا **ولا تُفترَضُ**: مكانٌ حُفِظَ العامَ الماضيَ قد صارَ
   * خارجَ حدٍّ تغيَّرَ، وقبولُه لأنَّه محفوظٌ قبولٌ بلا حكمٍ.
   */
  readonly initialPoint?: { readonly label: string; readonly lat: number; readonly lng: number };
  /** اسمُ المزوّدِ المُهيَّأِ فعلاً؛ `"none"` تعني: قُلِ الحدَّ ولا ترسمْ. */
  readonly mapProvider?: string;
  /**
   * `UI-PICKUP-01`: الشاشةُ نفسُها تختارُ **نقطةَ الالتقاطِ** بالاسمِ لمَن لا يُتاحُ له
   * موقعُ جهازِه (رفضَ الإذنَ، أو سطحُ مكتبٍ، أو يطلبُ لغيرِه). البحثُ والمصادقةُ
   * بحدِّ منطقةِ الخدمةِ واحدانِ؛ يتغيّرُ العنوانُ وزرُّ التأكيدِ وحدَهما.
   */
  readonly purpose?: DestinationPurpose;
}

/**
 * `WR-16C` — ما تسألُ عنه الشاشة: وجهةُ المشوار، أو التقاطُ الراكب، أو **استلامُ** طلبِ التوصيل
 * ثمَّ **تسليمُه**. البحثُ والمصادقةُ واحدة؛ يتغيّرُ العنوانُ وزرُّ التأكيدِ وحدَهما.
 */
export type DestinationPurpose = "destination" | "pickup" | "deliveryPickup" | "deliveryDropoff";

const PURPOSE_TEXT = {
  destination: { title: "rider.destination.title", confirm: "rider.destination.confirm" },
  pickup: { title: "rider.pickup.title", confirm: "rider.pickup.confirm" },
  deliveryPickup: {
    title: "rider.delivery.pickup.title",
    confirm: "rider.delivery.pickup.confirm",
  },
  deliveryDropoff: {
    title: "rider.delivery.dropoff.title",
    confirm: "rider.delivery.dropoff.confirm",
  },
} as const satisfies Record<DestinationPurpose, { title: string; confirm: string }>;

export function purposeText(purpose: DestinationPurpose): { title: string; confirm: string } {
  return PURPOSE_TEXT[purpose];
}

type SearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "ready"; readonly query: string; readonly rows: readonly SuggestionRow[] }
  | { readonly kind: "rejected"; readonly code: string };

type PickState =
  | { readonly kind: "none" }
  | { readonly kind: "resolving" }
  | {
      readonly kind: "accepted";
      /** اسمُ الاقتراحِ/المكانِ المحفوظِ إن اختيرَ بالاسم؛ `null` لنقطةٍ بلا اسم. */
      readonly presetLabel: string | null;
      readonly summary: AcceptedSummary;
      readonly cityCode: string | null;
      readonly origin: PointOrigin;
      /** حكمُ قراءةِ الجهازِ وحدَها؛ `null` لغيرِها. */
      readonly assessment: DeviceFixAssessment | null;
    }
  | { readonly kind: "refused"; readonly view: RefusalView }
  | { readonly kind: "location_refused"; readonly reason: string };

type SystemState = { readonly screen: ScreenState } | null;

/** مِن أينَ جاءَت النقطة — يُحفَظُ معَها ولا يُستنتَجُ من الاسم. */
interface PointOrigin {
  readonly source: PlacePointSource;
  readonly accuracyM: number | null;
  readonly capturedAtMs: number | null;
}

const SUGGESTION_ORIGIN: PointOrigin = {
  source: "SUGGESTION",
  accuracyM: null,
  capturedAtMs: null,
};

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

/** ساعةٌ ثابتةُ المرجع: دالّةٌ تُولَدُ في كلِّ رسمٍ تُعيدُ بناءَ `resolvePoint` في كلِّ رسم. */
const systemNowMs = () => Date.now();

/** مهلةُ تهدئةِ الكتابةِ. والثلاثُ مئةِ مِلّيٍ قيمةُ تجربةٍ لا حدُّ حمايةٍ. */
const SEARCH_DEBOUNCE_MS = 300;

export function DestinationScreen({
  search = searchViaApi,
  resolve = resolveViaApi,
  readDeviceLocation = readFreshDeviceFix,
  openSettings = () => void openLocationSettings(),
  openLink = openExternalLink,
  now = systemNowMs,
  onConfirmed,
  onBack,
  onOpenSos,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
  showTitle = true,
  initialQuery = "",
  initialPoint,
  mapProvider = "none",
  purpose = "destination",
}: DestinationScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [typed, setTyped] = useState(initialQuery);
  const [searchState, setSearchState] = useState<SearchState>({ kind: "idle" });
  const [pick, setPick] = useState<PickState>({ kind: "none" });
  const [system, setSystem] = useState<SystemState>(null);
  /** `LOC-TRUST-01` — اسمُ المكانِ كما يكتبُه الراكب، وملاحظاتُه، والنصُّ الملصوق. */
  const [labelText, setLabelText] = useState("");
  /** الاسمُ ملأَه اختيارُ اقتراحٍ لا يدُ الراكب — فيُفرَّغُ إن تغيّرَت النقطةُ إلى غيرِه. */
  const labelFromPreset = useRef(false);
  const [notesText, setNotesText] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  /** الرابطُ الأصليُّ كما لصقَه الراكب — يبقى معَ أيِّ نقطةٍ تُختارُ بعدَه. */
  const [link, setLink] = useState<ParsedPlaceLink | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  /** `WR-16D` — اسمُ المكانِ المختارِ الذي يُسألُ الراكبُ قبلَ استبدالِه بموقعِه الحالي. */
  const [replaceAsk, setReplaceAsk] = useState<string | null>(null);
  const mounted = useRef(true);
  /** ترتيبُ النداءاتِ: ردٌّ متأخِّرٌ لاستفهامٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ. */
  const issued = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const runSearch = useCallback(
    async (query: string) => {
      const ticket = ++issued.current;
      setSearchState({ kind: "searching" });
      try {
        const response = await search(query);
        if (!mounted.current || ticket !== issued.current) return;
        setSearchState({
          kind: "ready",
          query: response.query,
          rows: suggestionRows(response.suggestions),
        });
      } catch (thrown) {
        const screen = await screenFor(thrown);
        if (!mounted.current || ticket !== issued.current) return;
        if (screen !== null) {
          setSystem({ screen });
          return;
        }
        setSearchState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
      }
    },
    [search],
  );

  // تهدئةٌ: حرفٌ واحدٌ لا يُنتِجُ نداءً، ونداءٌ لكلِّ ضغطةٍ يُغرِقُ شبكةً ضعيفةً
  // (`UX-4`). والمؤقِّتُ يُلغى عندَ التفكيكِ فلا يُحدَّثُ سطحٌ مُنفَكٌّ.
  useEffect(() => {
    if (!isSearchable(typed)) {
      issued.current += 1;
      setSearchState({ kind: "idle" });
      return;
    }
    const timer = setTimeout(() => void runSearch(typed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed, runSearch]);

  const resolvePoint = useCallback(
    async (presetLabel: string | null, lat: number, lng: number, origin: PointOrigin) => {
      setPick({ kind: "resolving" });
      setAcknowledged(false);
      setReplaceAsk(null);
      // الاسمُ لا يُستنتَجُ من النقطة: اقتراحٌ يملأُ الاسمَ باسمِه، ونقطةٌ بلا اسمٍ تُفرِّغُ
      // اسماً ملأَه اقتراحٌ سابق — فلا يبقى «قباء» على قراءةِ جهازٍ في مكانٍ آخر.
      if (presetLabel !== null) {
        setLabelText((current) =>
          current.trim() === "" || labelFromPreset.current ? presetLabel : current,
        );
        labelFromPreset.current = true;
      } else if (labelFromPreset.current) {
        setLabelText("");
        labelFromPreset.current = false;
      }
      try {
        const response = await resolve(lat, lng);
        if (!mounted.current) return;
        if (response.accepted) {
          setPick({
            kind: "accepted",
            presetLabel,
            summary: acceptedSummary(response.destination),
            cityCode: response.destination.city.code,
            origin,
            assessment:
              origin.source === "DEVICE"
                ? assessDeviceFix({
                    accuracyM: origin.accuracyM,
                    capturedAtMs: origin.capturedAtMs,
                    nowMs: now(),
                  })
                : null,
          });
          return;
        }
        setPick({ kind: "refused", view: refusalView(response) });
      } catch (thrown) {
        const screen = await screenFor(thrown);
        if (!mounted.current) return;
        if (screen !== null) {
          setSystem({ screen });
          return;
        }
        setSearchState({ kind: "rejected", code: codeOf(thrown) ?? "UNKNOWN" });
        setPick({ kind: "none" });
      }
    },
    [resolve, now],
  );

  // مصادقةٌ واحدةٌ عندَ التركيبِ للوجهةِ القادمةِ بإحداثيّةٍ. و`initialPoint`
  // وحدَه في قائمةِ التبعياتِ: لو أُضيفَ `resolvePoint` لَأُعيدَ النداءُ كلَّما
  // تغيَّرَ الحاقنُ، وذاكَ نداءُ شبكةٍ بلا سببٍ يُقرأُ.
  const resolveRef = useRef(resolvePoint);
  useEffect(() => {
    resolveRef.current = resolvePoint;
  }, [resolvePoint]);
  useEffect(() => {
    if (initialPoint === undefined) return;
    // مكانٌ محفوظٌ أو وجهةٌ سابقةٌ للراكبِ نفسِه — `SAVED`.
    void resolveRef.current(initialPoint.label, initialPoint.lat, initialPoint.lng, {
      source: "SAVED",
      accuracyM: null,
      capturedAtMs: null,
    });
  }, [initialPoint]);

  const pickMyLocation = useCallback(async () => {
    setPick({ kind: "resolving" });
    const read = await readDeviceLocation();
    if (!mounted.current) return;
    if (!read.ok) {
      // لا إحداثيّةَ بديلةً ههنا: الشاشةُ تقولُ السببَ وتبقى قابلةً للبحثِ.
      setPick({ kind: "location_refused", reason: read.reason });
      return;
    }
    await resolvePoint(null, read.lat, read.lng, {
      source: "DEVICE",
      accuracyM: read.accuracyM ?? null,
      capturedAtMs: read.capturedAtMs ?? null,
    });
  }, [readDeviceLocation, resolvePoint]);

  /** رابطٌ أو إحداثيّاتٌ ملصوقة: الرابطُ يُحفَظُ حرفاً، ونقطتُه (إن وُجِدَت) تُصادَق. */
  const applyPasted = useCallback(async () => {
    const pasted = readPastedPlace(pasteText);
    if (pasted.kind === "refused") {
      setPasteError(pasted.messageKey);
      return;
    }
    setPasteError(null);
    if (pasted.kind === "coordinates") {
      await resolvePoint(null, pasted.lat, pasted.lng, {
        source: "MAP_PIN",
        accuracyM: null,
        capturedAtMs: null,
      });
      return;
    }
    setLink(pasted.link);
    if (pasted.link.point !== null) {
      await resolvePoint(null, pasted.link.point.lat, pasted.link.point.lng, {
        source: "SHARED_LINK",
        accuracyM: null,
        capturedAtMs: null,
      });
    }
  }, [pasteText, resolvePoint]);

  if (system !== null) {
    // نصُّ شاشةِ النظامِ عربيٌّ اليومَ (دَينٌ مُعلَنٌ في `ROADMAP.md`)، فيُثبَّتُ
    // اتجاهُها عربيّاً: نصٌّ عربيٌّ في إطارٍ يساريٍّ يُقرأُ مقلوباً.
    return (
      <div dir="rtl">
        <SystemScreen
          language={language}
          state={system.screen}
          onAction={() => {
            setSystem(null);
            if (isSearchable(typed)) void runSearch(typed);
          }}
        />
      </div>
    );
  }

  const title = showTitle ? (
    <h1 id="rd-title" className="rd__title">
      {t(purposeText(purpose).title)}
    </h1>
  ) : null;
  const sectionName = showTitle ? { "aria-labelledby": "rd-title" as const } : {};

  const highlighted = (row: SuggestionRow, query: string) => {
    const text = labelFor(row, language);
    const range = highlightRange(text, query);
    if (range === null) return text;
    return (
      <>
        {text.slice(0, range.start)}
        <mark className="rd__mark">{text.slice(range.start, range.end)}</mark>
        {text.slice(range.end)}
      </>
    );
  };

  const results = () => {
    if (searchState.kind === "idle") {
      return <p className="sys__hint">{t("rider.destination.hint")}</p>;
    }
    if (searchState.kind === "searching") return <Skeleton />;
    if (searchState.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(destinationErrorKey(searchState.code))}</p>
          {isRetryableDestinationError(searchState.code) ? (
            <button type="button" className="sys__action" onClick={() => void runSearch(typed)}>
              {t("rider.destination.retry")}
            </button>
          ) : null}
        </div>
      );
    }
    if (searchState.rows.length === 0) {
      // «لا نتيجةَ» يُقالُ صريحاً ولا يُترَكُ بياضاً (`UX-5`)، ويُقالُ معه أنَّ
      // الدليلَ دليلُنا لا الأرضُ كلُّها — فلا يظنُّ الباحثُ أنَّ مكانَه مُنكَرٌ.
      return (
        <div className="rd__empty">
          <p className="sys__body">{t("rider.destination.empty")}</p>
          <p className="sys__hint">{t("rider.destination.empty.hint")}</p>
        </div>
      );
    }
    return (
      <ul className="rd__results">
        {searchState.rows.map((row) => (
          <li key={row.key} className={`rd__row${row.strong ? " rd__row--strong" : ""}`}>
            <button
              type="button"
              className="rd__pick"
              onClick={() =>
                void resolvePoint(labelFor(row, language), row.lat, row.lng, SUGGESTION_ORIGIN)
              }
            >
              <span className="rd__row-icon">
                <Glyph name="pin" />
              </span>
              <span className="rd__row-label">{highlighted(row, searchState.query)}</span>
              <span className="rd__row-meta">
                {t(row.sourceKey)}
                {row.kindKey === null ? null : ` · ${t(row.kindKey)}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  };

  const verdict = () => {
    if (pick.kind === "none") return null;
    if (pick.kind === "resolving") {
      return (
        <div className="rd__verdict" aria-busy="true">
          <Skeleton />
        </div>
      );
    }
    if (pick.kind === "location_refused") {
      return (
        <div className="rd__verdict sys" role="alert">
          <p className="sys__body">{t(locationRefusalKey(pick.reason))}</p>
          {offersLocationSettings(pick.reason) ? (
            <button type="button" className="sys__action" onClick={() => openSettings()}>
              {t("rider.destination.location.settings")}
            </button>
          ) : null}
        </div>
      );
    }
    if (pick.kind === "refused") {
      const { view } = pick;
      const city = language === "ar" ? view.cityNameAr : view.cityNameEn;
      return (
        <div className="rd__verdict sys" role="alert">
          <p className="sys__body">{t(view.messageKey)}</p>
          {city === null ? null : (
            <p className="sys__hint">
              {t("rider.destination.refused.city").replace("{city}", city)}
            </p>
          )}
          {view.fixable ? (
            <button type="button" className="sys__action" onClick={() => setPick({ kind: "none" })}>
              {t("rider.destination.refused.again")}
            </button>
          ) : null}
        </div>
      );
    }

    const { summary, origin, assessment } = pick;
    const userLabel = labelText.trim() === "" ? null : labelText.trim();
    const notesValue = notesText.trim() === "" ? null : notesText.trim();
    const conflict = link !== null && linkConflictsWithPoint(link.point, summary);
    const blocker = confirmBlocker({
      source: origin.source,
      assessment,
      acknowledged,
      linkConflict: conflict,
      notesTooLong: notesText.trim().length > PLACE_NOTES_MAX_LENGTH,
    });
    const ageSeconds =
      origin.capturedAtMs === null
        ? null
        : Math.max(0, Math.round((now() - origin.capturedAtMs) / 1000));
    const nearest = summary.nearest;
    return (
      <div className="rd__verdict rd__verdict--ok" role="status">
        <p className="rd__chosen">{userLabel ?? t("rider.place.unnamedPoint")}</p>
        {/* النقطةُ نفسُها — ما سيعتمدُ عليه السائقُ — قبلَ أيِّ وصف. */}
        <p className="sys__body">
          {t("rider.place.point").replace("{point}", formatPoint(summary.lat, summary.lng))}
        </p>
        <p className="sys__hint">{t(pointSourceKey(origin.source))}</p>
        {origin.source === "DEVICE" ? (
          <p className="sys__hint">
            {origin.accuracyM === null
              ? t("rider.place.fix.accuracyUnknown")
              : t("rider.place.fix.accuracy").replace(
                  "{meters}",
                  String(Math.round(origin.accuracyM)),
                )}
            {" · "}
            {ageSeconds === null
              ? t("rider.place.fix.freshnessUnknown")
              : t("rider.place.fix.age").replace("{seconds}", String(ageSeconds))}
          </p>
        ) : null}
        {origin.source === "SUGGESTION" ? (
          <p className="sys__hint">{t("rider.place.suggestion.approximate")}</p>
        ) : null}
        {assessment !== null && assessment.verdict !== "GOOD" ? (
          <div className="sys" role="alert">
            <p className="sys__body">
              {t(
                assessment.verdict === "UNRELIABLE"
                  ? "rider.place.fix.unreliable"
                  : "rider.place.fix.coarse",
              )}
            </p>
            {assessment.reasons.map((reason) => (
              <p key={reason} className="sys__hint">
                {t(fixReasonKey(reason))}
              </p>
            ))}
            {assessment.verdict === "UNRELIABLE" ? (
              <button type="button" className="sys__action" onClick={() => void pickMyLocation()}>
                {t("rider.place.fix.retry")}
              </button>
            ) : (
              <label className="rd__field">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span className="sys__hint">{t("rider.place.fix.ack")}</span>
              </label>
            )}
          </div>
        ) : null}
        {summary.mapUrl === null ? null : (
          <button
            type="button"
            className="rd__verify"
            onClick={() => openLink(summary.mapUrl ?? "")}
          >
            <Glyph name="globe" className="rd__locate-icon" />
            {t("rider.place.verifyOnMap")}
          </button>
        )}
        {/* `UI-POLISH-02` · `LOC-TRUST-01`: أقربُ معلَمٍ **وصفٌ** للنقطة لا اسمُها، ولا يُقالُ عن نفسِه. */}
        {nearest === null || nearest.distanceM < 50 ? null : (
          <p className="sys__hint">
            {t("rider.destination.nearest")
              .replace(
                "{name}",
                landmarkPhrase(
                  t(nearest.kindKey),
                  language === "ar" ? nearest.nameAr : nearest.nameEn,
                ),
              )
              .replace("{meters}", String(nearest.distanceM))}
          </p>
        )}
        <p className="sys__hint">
          {t("rider.destination.city").replace(
            "{city}",
            language === "ar" ? summary.cityNameAr : summary.cityNameEn,
          )}
        </p>
        {link === null ? null : (
          <p className="sys__hint">
            {t(link.point === null ? "rider.place.link.keptNoPoint" : "rider.place.link.kept")}
          </p>
        )}
        {conflict ? (
          <div className="sys" role="alert">
            <p className="sys__body">{t("rider.place.link.conflict")}</p>
            <button type="button" className="sys__action" onClick={() => setLink(null)}>
              {t("rider.place.link.remove")}
            </button>
          </div>
        ) : null}
        {blocker === null || blocker === "rider.place.link.conflict" ? null : (
          <p className="qt__notes-error" role="alert">
            {t(blocker)}
          </p>
        )}
        <button
          type="button"
          className="sys__action"
          disabled={blocker !== null}
          onClick={() => {
            if (blocker !== null) return;
            onConfirmed?.({
              label: userLabel ?? t("rider.place.unnamedPoint"),
              lat: summary.lat,
              lng: summary.lng,
              cityCode: pick.cityCode,
              place: {
                label: userLabel,
                source: origin.source,
                accuracyM: origin.accuracyM,
                capturedAt:
                  origin.capturedAtMs === null ? null : new Date(origin.capturedAtMs).toISOString(),
                link: link === null ? null : link.raw,
                notes: notesValue,
              },
            });
          }}
        >
          {t(purposeText(purpose).confirm)}
        </button>
      </div>
    );
  };

  /**
   * `WR-16D` — «استخدم موقعي الحالي» اختصارٌ اختياريٌّ منفصل: لا يُفعَّلُ وحدَه، ولا يمحو مكانًا
   * اختارَه الراكبُ بالاسمِ دونَ سؤال، ويقعُ بعدَ نتائجِ البحثِ حينَ يُكتَبُ اسم.
   */
  const askOrLocate = () => {
    const intent = locateIntent(pick.kind === "accepted" ? pick : null);
    if (intent.kind === "confirmReplace") {
      setReplaceAsk(intent.label);
      return;
    }
    setReplaceAsk(null);
    void pickMyLocation();
  };
  const locateShortcut =
    replaceAsk === null ? (
      <div className="rd__locate-shortcut">
        {isSearchable(typed) ? (
          <p className="sys__hint">{t("rider.destination.location.orInstead")}</p>
        ) : null}
        <button type="button" className="rd__locate" onClick={askOrLocate}>
          <Glyph name="navigate" className="rd__locate-icon" />
          {t("rider.destination.location.action")}
        </button>
      </div>
    ) : (
      <div className="rd__locate-shortcut" role="alert">
        <p className="sys__body">
          {t("rider.destination.location.replaceAsk").replace("{label}", replaceAsk)}
        </p>
        <button
          type="button"
          className="rd__locate"
          onClick={() => {
            setReplaceAsk(null);
            void pickMyLocation();
          }}
        >
          {t("rider.destination.location.replaceYes")}
        </button>
        <button type="button" className="rd__back" onClick={() => setReplaceAsk(null)}>
          {t("rider.destination.location.replaceKeep").replace("{label}", replaceAsk)}
        </button>
      </div>
    );

  /** الاسمُ والملاحظاتُ والرابطُ — لكلٍّ من الالتقاطِ والوجهة (`ADR 0247`). */
  const placeFields = (
    <div className="rd__place">
      <label className="rd__field" htmlFor="rd-paste">
        <span className="sys__hint">{t("rider.place.paste.prompt")}</span>
        <input
          id="rd-paste"
          className="rd__input"
          type="text"
          inputMode="url"
          value={pasteText}
          onChange={(event) => {
            setPasteText(event.target.value);
            setPasteError(null);
          }}
        />
      </label>
      <button
        type="button"
        className="rd__locate"
        disabled={pasteText.trim() === ""}
        onClick={() => void applyPasted()}
      >
        {t("rider.place.paste.apply")}
      </button>
      {pasteError === null ? null : (
        <p className="qt__notes-error" role="alert">
          {t(pasteError)}
        </p>
      )}
      {link !== null && link.point === null && pick.kind !== "accepted" ? (
        <p className="sys__hint" role="status">
          {t("rider.place.link.keptNoPoint")}
        </p>
      ) : null}
      <label className="rd__field" htmlFor="rd-label">
        <span className="sys__hint">{t("rider.place.label.prompt")}</span>
        <input
          id="rd-label"
          className="rd__input"
          type="text"
          maxLength={120}
          value={labelText}
          onChange={(event) => {
            labelFromPreset.current = false;
            setLabelText(event.target.value);
          }}
        />
      </label>
      {pick.kind === "accepted" || labelText.trim() === "" ? null : (
        <p className="sys__hint">{t("rider.place.pointRequired")}</p>
      )}
      <label className="rd__field" htmlFor="rd-notes">
        <span className="sys__hint">{t("rider.place.notes.prompt")}</span>
        <textarea
          id="rd-notes"
          className="qt__notes"
          value={notesText}
          onChange={(event) => setNotesText(event.target.value)}
        />
      </label>
      <p className="qt__notes-hint">
        {t("rider.place.notes.limit")
          .replace("{used}", String(notesText.trim().length))
          .replace("{max}", String(PLACE_NOTES_MAX_LENGTH))}
      </p>
    </div>
  );

  return (
    <section className="rd" dir={directionFor(language)} {...sectionName}>
      {title}

      {/* الحدُّ الأوّلُ مكتوبٌ حيثُ يُتوقَّعُ الرسمُ — لا فراغٌ ولا رسمٌ كاذبٌ. */}
      {mapProvider === "none" ? (
        <p className="rd__map rd__map--off" role="status">
          {t("rider.destination.map.unavailable")}
        </p>
      ) : (
        <div className="rd__map" data-provider={mapProvider} />
      )}

      <label className="rd__field rd__field--query" htmlFor="rd-query">
        <span className="sys__hint">{t("rider.destination.search.prompt")}</span>
        <IconSearch className="rd__query-icon" />
        <input
          id="rd-query"
          className="rd__input"
          type="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>

      {locateShortcutPlacement(typed) === "beforeResults" ? locateShortcut : null}

      {/* `UX-V2`: الاقتراحاتُ تلي حقلَ البحثِ مباشرةً (اللوحة 01 · R2). ثمّ الاسمُ والرابطُ
          والملاحظاتُ قبلَ بطاقةِ النقطة: زرُّ الاعتمادِ آخرُ ما يُرى لا أوّلُه. */}
      {results()}
      {locateShortcutPlacement(typed) === "afterResults" ? locateShortcut : null}
      {placeFields}
      {verdict()}

      {onBack === undefined ? null : (
        <button type="button" className="rd__back" onClick={() => onBack()}>
          {t("rider.destination.back")}
        </button>
      )}

      {/* مدخلُ الاستغاثةِ (`PD-020`) — يُرسَمُ إذا مُرِّرَ، فيبقى البابُ في كلِّ سطحٍ. */}
      {onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}
    </section>
  );
}
