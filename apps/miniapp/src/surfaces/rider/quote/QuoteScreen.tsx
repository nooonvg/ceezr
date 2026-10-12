/**
 * الغرض: شاشةُ الاقتباسِ `SR-04` — تقرأُ موقعَ الراكبِ، ثمَّ تسألُ الخادمَ حكماً
 *   واحداً، فتعرضُ مسافةً **موسومةً** ومدّةً صادقةً وبطاقاتَ الخدماتِ المخدومةِ
 *   في مدينتِه، **بلا سعرٍ ولا وسيلةِ دفعٍ** (البند `F2-04` · القسم 9.11).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-04` (نصفُه المشروعُ).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/quote
 * يُستخدم من: `apps/miniapp/src/surfaces/rider/RiderRoot.tsx` بعدَ تأكيدِ الوجهةِ
 *   في `SR-03`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-05` يُضيفُ فعلَ «اطلُبْ» إلى بطاقةٍ متاحةٍ؛
 *   وحتّى يُبنى **لا زرَّ** ههنا، بل سطرٌ يقولُ إنَّ الطلبَ لم يُبنَ بعدُ.
 * ملاحظات مستقبلية: لا حقلَ سعرٍ ولا وسيلةَ دفعٍ في هذه الشاشةِ قبلَ إغلاقِ
 *   `DEC-11` بسندٍ نظاميٍّ مكتوبٍ (`ADR 0039` §٦ · `م13-7`).
 *
 * ## إضافةُ البند `F2-05` (2026-09-13)
 *
 * صارَ للبطاقةِ المتاحةِ **فعلُ طلبٍ**، ومعَه حقلُ ملاحظةٍ للسائقِ (`SR-04` في
 * الخارطةِ). والسطرُ الذي كانَ يقولُ «طلبُ الرحلةِ لم يُبنَ بعدُ» **باقٍ مفتاحاً
 * ونصّاً في القواميسِ** (القاعدة ح-1) ولم يُحذَف من أحدِها؛ وإنّما لم يُعَد
 * يُرسَمُ، لأنَّه صارَ **خبراً كاذباً** بعدَ أن بُني الطلبُ — وحفظُ النصِّ في
 * القاموسِ أمانةٌ، وعرضُه بعدَ نقضِه كذبٌ.
 *
 * ولماذا لا يُنشئُ الطلبَ ههنا: الإنشاءُ له عمرٌ يعيشُ دقائقَ وحالةٌ قد تُلغى،
 * وهذه الشاشةُ تجمعُ النيّةَ (خدمةٌ وملاحظةٌ ومفتاحُ تكرارٍ) وتُسلِّمُها إلى
 * `SR-05`. ولو أُنشئَ ههنا لَوجبَ نقلُ الحالةِ بينَ شاشتَينِ، ونقلُ الحالةِ بابُ
 * رحلةٍ تُنشَأُ مرّتَينِ.
 *
 * ومفتاحُ التكرارِ يُولَّدُ **عندَ الضغطِ** لا عندَ التركيبِ: مفتاحٌ يُولَّدُ مع
 * الشاشةِ يُعيدُ رحلةً قديمةً لو ضغطَ الراكبُ بعدَ إلغاءٍ، ومفتاحٌ لكلِّ ضغطةٍ
 * يُبطِلُ `ARCH-006`. فواحدٌ لكلِّ **نيّةٍ**: يُولَّدُ عندَ الضغطةِ ويُعادُ في كلِّ
 * محاولةٍ لتلكَ النيّةِ داخلَ `SR-05`.
 *
 * ## لماذا يُقرأُ موقعُ الراكبِ ههنا ولا يُورَّثُ من الشاشةِ السابقةِ
 *
 * `SR-03` تقرأُ الموقعَ **اختياراً** («موقعي» بدلاً من البحثِ)، فقد يُصادِقُ راكبٌ
 * وجهتَه بالكتابةِ ولا يُقرأُ له موقعٌ قطُّ. ولو ورَّثناهُ لَكانَ الانطلاقُ
 * أحياناً غائباً وأحياناً قديماً بدقائقَ، والمسافةُ حينَها **تُقاسُ عن موضعٍ
 * غادرَه صاحبُه**. فالقراءةُ ههنا في لحظةِ السؤالِ.
 *
 * ## ولماذا لا يُستعاضُ عن الموقعِ المرفوضِ بمركزِ المدينةِ
 *
 * مركزُ المدينةِ يُنتِجُ مسافةً **تبدو صحيحةً** وليسَت عن أحدٍ. ورفضُ الإذنِ
 * يُعرَضُ سبباً بمفتاحِه ومعَه فعلٌ إن كانَ له فعلٌ — وهذا عينُ ما قرَّرَته
 * `SR-03` في `locationRefusalKey`، ويُعادُ استعمالُه ولا يُكتَبُ ثانياً.
 *
 * ## وما لا تفعلُه هذه الشاشةُ عن قصدٍ
 *
 *   ــ **لا تعرضُ سعراً ولا وسيلةَ دفعٍ ولا موضعاً محفوظاً لهما**: آليّةُ الأجرةِ
 *      محجوبةٌ على قرارٍ نظاميٍّ خارجِ المشروعِ (`ADR 0039` §٤)، والإيرادُ اليومَ
 *      اشتراكُ السائقِ وحدَه (`ADR 0027`) — فالراكبُ لا يدفعُ للمنصّةِ شيئاً.
 *   ــ **لا تُظهِرُ زرَّ طلبٍ لا يفعلُ شيئاً**: زرٌّ صامتٌ يُقرأُ عطباً. (وبعدَ
 *      `F2-05` صارَ الزرُّ يفعلُ، ولا يُعرَضُ إلّا على بطاقةٍ **متاحةٍ**.)
 *   ــ **لا تخترعُ مدّةً**: تعرضُ امتناعَ `packages/domain/eta` بسببِه.
 *   ــ **لا تُخفي خدمةً غيرَ متاحةٍ**: تعرضُها معطَّلةً بسببِها.
 *   ــ **لا تحفظُ الاقتباسَ محلّيّاً**: يُعادُ سؤالُه في كلِّ تركيبٍ.
 */

import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-destination.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-quote.ts";
import {
  RIDE_NOTES_MAX_LENGTH,
  readRideNotes,
} from "../../../../../../packages/domain/transport/ride-request.ts";
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
import { openLocationSettings } from "../../../tg/index.ts";
import { type ConfirmedDestination, DestinationScreen } from "../destination/DestinationScreen.tsx";
import {
  type ConfirmedPlace,
  locationRefusalKey,
  offersLocationSettings,
  type PlaceWire,
  placeWire,
} from "../destination/destination-view.ts";
import { type DeviceFixResult, readFreshDeviceFix } from "../destination/device-fix.ts";
import { newIdempotencyKey } from "../search/search-view.ts";
import { SosEntry } from "../sos/SosEntry.tsx";

import { type QuoteRideResponse, quoteRide as quoteViaApi } from "./quote-api.ts";
import {
  destinationIsPickup,
  distanceLine,
  durationLine,
  isRetryableQuoteError,
  offerPolicyFrom,
  parcelValidationError,
  pickupAtFrom,
  type QuoteOfferMode,
  quoteErrorKey,
  quoteRefusalKey,
  refusalRemedy,
  serviceCards,
} from "./quote-view.ts";

export interface QuoteScreenProps {
  /** الوجهةُ كما صادَقَتْها `SR-03` — تُمرَّرُ ولا يُعادُ البحثُ عنها. */
  readonly destination: {
    readonly label: string;
    readonly lat: number;
    readonly lng: number;
    /** `LOC-TRUST-01` — ما أدخلَه الراكبُ عن الوجهة (اسمُه وملاحظاتُه ورابطُه ومصدرُ النقطة). */
    readonly place?: ConfirmedPlace;
  };
  /** يُحقَنُ كي تُختبَرَ الشاشةُ بلا شبكةٍ. */
  readonly quote?: (input: {
    readonly originLat: number;
    readonly originLng: number;
    readonly destinationLat: number;
    readonly destinationLng: number;
  }) => Promise<QuoteRideResponse>;
  /** ويُحقَنُ جسرُ الموقعِ كي لا يُحتاجَ مُضيفُ تيليجرام في اختبارٍ. */
  readonly readDeviceLocation?: () => Promise<DeviceFixResult>;
  readonly openSettings?: () => void;
  readonly onBack?: () => void;
  readonly showTitle?: boolean;
  /** مدخلُ الاستغاثةِ (`PD-020` · `ADR 0159`) — اختياريٌّ: يُرسَمُ إذا مُرِّرَ. */
  readonly onOpenSos?: () => void;
  /**
   * `F2-05`: تُسلَّمُ النيّةُ ولا تُنشَأُ الرحلةُ ههنا. و`null` في الملاحظةِ يعني
   * «لا ملاحظةَ» لا «ملاحظةٌ فارغةٌ»، والمفتاحُ مُولَّدٌ لتلكَ النيّةِ وحدَها.
   */
  readonly onRequest?: (intent: {
    readonly service: string;
    readonly originLat: number;
    readonly originLng: number;
    readonly destinationLat: number;
    readonly destinationLng: number;
    readonly destinationLabel: string;
    readonly pickupLabel: string | null;
    /** `LOC-TRUST-01` — الاسمُ المُرسَلُ للوجهة: اسمُ الراكبِ أو `null` (لا وصفُ العرض). */
    readonly destinationUserLabel?: string | null;
    readonly pickupPlace?: PlaceWire | null;
    readonly dropoffPlace?: PlaceWire | null;
    readonly notes: string | null;
    readonly idempotencyKey: string;
    /** `ORDER-TERMS-01` — وقتُ حضورِ السائقِ ISO؛ `null` ⇒ الآن. */
    readonly pickupAt?: string | null;
    /** `ORDER-OFFER-01` — ما يعرضُه الراكبُ بالريال؛ `null` ⇒ قابلٌ للتفاوض. */
    readonly offerSar?: number | null;
    /** `WR-05` — سياسةُ المبلغ. */
    readonly offerMode?: QuoteOfferMode;
  }) => void;
  readonly initialLanguage?: MiniAppLanguage;
}

/** `WR-05` — مفاتيحُ صريحةٌ (لا قوالبَ) كي يراها حارسُ تغطيةِ المفاتيح. */
const OFFER_MODE_LABEL = {
  fixed: "rider.quote.offerMode.fixed",
  suggested: "rider.quote.offerMode.suggested",
  open: "rider.quote.offerMode.open",
} as const satisfies Record<QuoteOfferMode, string>;
const OFFER_MODE_HINT = {
  fixed: "rider.quote.offerMode.fixedHint",
  suggested: "rider.quote.offerMode.suggestedHint",
  open: "rider.quote.offerMode.openHint",
} as const satisfies Record<QuoteOfferMode, string>;

type QuoteState =
  /** `LOC-TRUST-01`: لا اقتباسَ ولا طلبَ قبلَ أن يُؤكِّدَ الراكبُ مكانَ الالتقاطِ صراحةً. */
  | { readonly kind: "pickup_required" }
  | { readonly kind: "locating" }
  | { readonly kind: "asking" }
  | { readonly kind: "location_refused"; readonly reason: string }
  | {
      readonly kind: "accepted";
      readonly response: Extract<QuoteRideResponse, { accepted: true }>;
      /**
       * الانطلاقُ **كما قِيسَ عليه هذا الاقتباسُ** — يُحفَظُ كي يُطلَبَ عن الموضعِ
       * الذي قِيسَت عنه المسافةُ، لا عن قراءةٍ ثانيةٍ قد تختلفُ بمئاتِ الأمتارِ.
       */
      readonly origin: { readonly lat: number; readonly lng: number };
    }
  | {
      readonly kind: "refused";
      readonly refusal: string;
      readonly cityName: { readonly ar: string; readonly en: string } | null;
    }
  | { readonly kind: "rejected"; readonly code: string };

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

export function QuoteScreen({
  destination,
  quote = quoteViaApi,
  readDeviceLocation = readFreshDeviceFix,
  openSettings = () => void openLocationSettings(),
  onBack,
  showTitle = true,
  onOpenSos,
  onRequest,
  initialLanguage = MINIAPP_DEFAULT_LANGUAGE,
}: QuoteScreenProps) {
  const [language] = useState<MiniAppLanguage>(initialLanguage);
  const [state, setState] = useState<QuoteState>({ kind: "pickup_required" });
  const [system, setSystem] = useState<SystemState>(null);
  /** ملاحظةُ السائقِ — نصٌّ خامٌّ يُشذَّبُ عندَ التسليمِ لا عندَ كلِّ محرفٍ. */
  const [notes, setNotes] = useState("");
  /** `ORDER-TERMS-01` — «الآن» أو وقتٌ محدَّدٌ «HH:MM». */
  const [pickupMode, setPickupMode] = useState<"now" | "later">("now");
  const [pickupClock, setPickupClock] = useState("");
  /** `ORDER-OFFER-01` — «المبلغ الذي تدفعه»: نصٌّ خامٌّ، وفارغُه «قابلٌ للتفاوض». */
  const [offerText, setOfferText] = useState("");
  const [offerError, setOfferError] = useState<"required" | "invalid" | null>(null);
  // `WR-05` — لا افتراضَ لمبلغٍ: البدءُ «بلا سعر» حتّى يختارَ الراكبُ غيرَه بنفسِه.
  const [offerMode, setOfferMode] = useState<QuoteOfferMode>("open");
  /** خطأُ تحقُّقِ وصفِ الطردِ — يُعرَضُ عندَ الضغطِ على «اطلُبْ» للتوصيلِ. */
  const [parcelError, setParcelError] = useState<string | null>(null);
  /**
   * `UI-PICKUP-01` · `LOC-TRUST-01`: مكانُ الالتقاطِ **كما أكّدَه الراكبُ** — بموقعِ جهازِه
   * أو اقتراحٍ أو رابطٍ أو إحداثيّات. وكانَ `null` يعني «موقعَ الجهازِ» يُقرأُ بصمتٍ ويُعتمَدُ
   * بلا عرضٍ ولا تأكيد (PRD-008: نقطةٌ راكدةٌ قربَ معلَمٍ بعيد). الآنَ لا يُعتمَدُ مكانٌ بصمت:
   * الشاشةُ تبدأُ باختيارِه، ولا اقتباسَ قبلَه.
   */
  const [manualPickup, setManualPickup] = useState<ConfirmedDestination | null>(null);
  const [pickingPickup, setPickingPickup] = useState(true);
  const mounted = useRef(true);
  /** ردٌّ متأخِّرٌ لسؤالٍ قديمٍ **يُطرَحُ** ولا يُعرَضُ (عينُ حكمِ `SR-03`). */
  const issued = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const t = miniAppTranslator(language);

  const ask = useCallback(async () => {
    const ticket = ++issued.current;
    setSystem(null);
    if (manualPickup === null) {
      setState({ kind: "pickup_required" });
      return;
    }
    const here = { lat: manualPickup.lat, lng: manualPickup.lng };
    // `RIDE-SAMESPOT-01`: وجهةٌ هيَ موضعُ الالتقاطِ نفسُه لا تُسأَلُ ولا تُطلَبُ.
    if (destinationIsPickup(here, { lat: destination.lat, lng: destination.lng })) {
      setState({ kind: "refused", refusal: "DESTINATION_IS_PICKUP", cityName: null });
      return;
    }
    setState({ kind: "asking" });
    try {
      const response = await quote({
        originLat: here.lat,
        originLng: here.lng,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
      });
      if (!mounted.current || ticket !== issued.current) return;
      if (response.accepted) {
        setState({ kind: "accepted", response, origin: { lat: here.lat, lng: here.lng } });
        return;
      }
      setState({
        kind: "refused",
        refusal: response.refusal,
        cityName:
          response.city === null ? null : { ar: response.city.nameAr, en: response.city.nameEn },
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
  }, [quote, destination.lat, destination.lng, manualPickup]);

  useEffect(() => {
    void ask();
  }, [ask]);

  if (pickingPickup) {
    return (
      <DestinationScreen
        purpose="pickup"
        initialLanguage={language}
        readDeviceLocation={readDeviceLocation}
        openSettings={openSettings}
        onBack={() => setPickingPickup(false)}
        {...(onOpenSos === undefined ? {} : { onOpenSos })}
        onConfirmed={(point) => {
          setManualPickup(point);
          setPickingPickup(false);
        }}
      />
    );
  }

  if (system !== null) {
    return <SystemScreen language={language} state={system.screen} onAction={() => void ask()} />;
  }

  const pickByName = (
    <button type="button" className="sys__action" onClick={() => setPickingPickup(true)}>
      {t("rider.pickup.byName")}
    </button>
  );

  const cityLine = (name: { readonly ar: string; readonly en: string } | null) =>
    name === null ? null : (
      <p className="qt__city">
        {t("rider.quote.city").replace("{city}", language === "ar" ? name.ar : name.en)}
      </p>
    );

  const body = () => {
    if (state.kind === "pickup_required") {
      return (
        <div className="sys" role="status">
          <p className="sys__body">{t("rider.pickup.required")}</p>
          <button type="button" className="sys__action" onClick={() => setPickingPickup(true)}>
            {t("rider.pickup.choose")}
          </button>
        </div>
      );
    }

    if (state.kind === "locating" || state.kind === "asking") {
      return (
        <div className="qt__pending" aria-busy="true">
          <p className="sys__hint">
            {t(state.kind === "locating" ? "rider.quote.locating" : "rider.quote.asking")}
          </p>
          <Skeleton />
        </div>
      );
    }

    if (state.kind === "location_refused") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(locationRefusalKey(state.reason))}</p>
          {pickByName}
          <button type="button" className="qt__retry" onClick={() => void ask()}>
            {t("rider.quote.retry")}
          </button>
          {offersLocationSettings(state.reason) && (
            <button type="button" className="sys__action" onClick={() => openSettings()}>
              {t("rider.destination.location.settings")}
            </button>
          )}
        </div>
      );
    }

    if (state.kind === "rejected") {
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(quoteErrorKey(state.code))}</p>
          {isRetryableQuoteError(state.code) && (
            <button type="button" className="sys__action" onClick={() => void ask()}>
              {t("rider.quote.retry")}
            </button>
          )}
        </div>
      );
    }

    if (state.kind === "refused") {
      const remedy = refusalRemedy(state.refusal);
      return (
        <div className="sys" role="alert">
          <p className="sys__body">{t(quoteRefusalKey(state.refusal))}</p>
          {cityLine(state.cityName)}
          {remedy === "RELOCATE" && (
            <button type="button" className="sys__action" onClick={() => setPickingPickup(true)}>
              {t("rider.quote.remedy.relocate")}
            </button>
          )}
          {remedy === "PICK_ANOTHER_DESTINATION" && onBack !== undefined && (
            <button type="button" className="sys__action" onClick={() => onBack?.()}>
              {t("rider.quote.remedy.pickAnother")}
            </button>
          )}
          {state.refusal === "DESTINATION_IS_PICKUP" && pickByName}
          {/* `NONE`: لا زرَّ — «مدينتُك بلا حدٍّ مرسومٍ» لا يُصلِحُه الراكبُ. */}
        </div>
      );
    }

    const { response, origin } = state;
    const readNotes = readRideNotes(notes);
    const noteValue = "notes" in readNotes ? readNotes.notes : null;
    const distance = distanceLine(response.distance);
    const duration = durationLine(response.eta);
    const cards = serviceCards(response.services);
    return (
      <div className="qt__result">
        {cityLine({ ar: response.city.nameAr, en: response.city.nameEn })}
        <div className="qt__pickup">
          <p className="qt__pickup-line">
            {manualPickup === null
              ? t("rider.pickup.required")
              : t("rider.pickup.named").replace("{label}", manualPickup.label)}
          </p>
          <button
            type="button"
            className="qt__pickup-change"
            onClick={() => setPickingPickup(true)}
          >
            {t("rider.pickup.change")}
          </button>
        </div>

        <section className="qt__measures" aria-label={t("rider.quote.measures")}>
          {distance === null ? (
            // وسمٌ مجهولٌ أو قيمةٌ لا تُقاسُ: يُقالُ ولا يُعرَضُ رقمٌ بلا وسمٍ.
            <p className="qt__measure qt__measure--off">{t("rider.quote.distance.unavailable")}</p>
          ) : (
            <p className="qt__measure">
              <span className="qt__value">
                {t(distance.key).replace("{value}", String(distance.value))}
              </span>
              {/* الوسمُ يُعرَضُ دائماً مُلاصِقاً للقيمةِ (`ADR 0024`). */}
              <span className="qt__tag">{t(distance.kindKey)}</span>
            </p>
          )}

          {duration.kind === "ROUTED" ? (
            <p className="qt__measure">
              <span className="qt__value">
                {t("rider.quote.durationMinutes").replace("{value}", String(duration.minutes))}
              </span>
            </p>
          ) : (
            <p className="qt__measure qt__measure--off">{t(duration.reasonKey)}</p>
          )}
        </section>

        {/*
         * ما كانَ ههنا قبلَ `F2-05`: سطرٌ يقولُ «طلبُ الرحلةِ لم يُبنَ بعدُ»
         * (`rider.quote.next.notBuilt`) — وهوَ صدقُ تلكَ اللحظةِ، ومفتاحُه ونصُّه
         * **باقيانِ في القواميسِ الثلاثةِ** (القاعدة ح-1) ولم يُحذَفا. وقد بُني
         * الطلبُ، فلم يَعُدْ يُرسَمُ: عرضُ نصٍّ نُقِضَ كذبٌ، وحذفُه من القاموسِ
         * محوُ أثرٍ.
         */}
        {/*
         * ## حقلُ الملاحظاتِ / وصفِ الطردِ
         *
         * حينَ التوصيلُ متاحٌ، يحملُ هذا الحقلُ وصفَ الطردِ **اختياريًّا** (`WR-18` ·
         * `ORDER-TERMS-01`): الفارغُ صالحٌ، وما كُتِبَ يُحاكَمُ في العميلِ قبلَ الإرسالِ
         * وفي البوّابةِ بعدَه بالعقدِ نفسِه.
         */}
        <section className="qt__request" aria-label={t("rider.quote.request.section")}>
          {/*
           * ## حقلٌ محايدٌ لا سياقيٌّ
           *
           * الحقلُ واحدٌ لكلِّ الخدماتِ — لا يُغيِّرُ تسميتَهُ أو حدَّهُ لمجرَّدِ
           * أنَّ التوصيلَ متاحٌ. فالراكبُ الذي يطلُبُ النقلَ لا ينبغي أن يرى
           * «وصفَ الطردِ» لمجرَّدِ أنَّ التوصيلَ معروضاً. والتحقُّقُ يقعُ عندَ
           * الضغطِ على بطاقةِ التوصيلِ وحدَها — لا على بطاقةِ النقلِ.
           */}
          <label className="qt__notes-label" htmlFor="qt-notes">
            {t("rider.quote.notes.neutral.label")}
          </label>
          <textarea
            id="qt-notes"
            className="qt__notes"
            value={notes}
            maxLength={RIDE_NOTES_MAX_LENGTH}
            placeholder={t("rider.quote.notes.placeholder")}
            onChange={(event) => {
              setNotes(event.target.value);
              if (parcelError !== null) setParcelError(null);
            }}
          />
          {/* الحدُّ يُعرَضُ عدداً لا يُخفى: حقلٌ يقطعُ الكتابةَ صامتاً يُقرأُ عطباً. */}
          <p className="qt__notes-hint">
            {t("rider.quote.notes.limit")
              .replace("{used}", String(notes.trim().length))
              .replace("{max}", String(RIDE_NOTES_MAX_LENGTH))}
          </p>
          {parcelError !== null && (
            <p className="qt__notes-error" role="alert">
              {t(parcelError)}
            </p>
          )}
          <p className="qt__notes-hint">{t("rider.quote.notes.delivery_hint")}</p>

          {/* `ORDER-TERMS-01` — وقتُ الحضورِ يظهرُ على بطاقةِ السائقِ فيُغني عن مفاوضةٍ طويلةٍ. */}
          <fieldset className="qt__pickup">
            <legend className="qt__notes-label">{t("rider.quote.pickup.label")}</legend>
            <label className="qt__pickup-option">
              <input
                type="radio"
                name="qt-pickup"
                checked={pickupMode === "now"}
                onChange={() => setPickupMode("now")}
              />
              {t("rider.quote.pickup.now")}
            </label>
            <label className="qt__pickup-option">
              <input
                type="radio"
                name="qt-pickup"
                checked={pickupMode === "later"}
                onChange={() => setPickupMode("later")}
              />
              {t("rider.quote.pickup.later")}
            </label>
            {pickupMode === "later" && (
              <input
                type="time"
                className="qt__pickup-time"
                aria-label={t("rider.quote.pickup.later")}
                value={pickupClock}
                onChange={(event) => setPickupClock(event.target.value)}
              />
            )}
          </fieldset>

          {/*
           * `WR-05` — السعرُ داخلَ نموذجِ الطلبِ بثلاثِ حالاتٍ، لا شاشةً مستقلّة:
           * محدَّدٌ (غيرُ قابلٍ للتفاوض) · مقترَحٌ (قابلٌ للتفاوض) · بلا سعرٍ (اتفاقٌ في المحادثة).
           * والمنصّةُ لا تحسبُ ولا تقترحُ ولا تُحصّلُ (DEC-11 §١).
           */}
          <fieldset className="qt__pickup qt__offer-mode">
            <legend className="qt__notes-label">{t("rider.quote.offerMode.title")}</legend>
            {(["fixed", "suggested", "open"] as const).map((mode) => (
              <label key={mode} className="qt__pickup-option">
                <input
                  type="radio"
                  name="qt-offer-mode"
                  value={mode}
                  checked={offerMode === mode}
                  onChange={() => {
                    setOfferMode(mode);
                    setOfferError(null);
                  }}
                />
                {t(OFFER_MODE_LABEL[mode])}
              </label>
            ))}
          </fieldset>
          {offerMode !== "open" && (
            <>
              <label className="qt__notes-label" htmlFor="qt-offer">
                {t("rider.quote.offer.label")}
              </label>
              <input
                id="qt-offer"
                className="qt__offer"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                aria-required="true"
                aria-invalid={offerError !== null}
                value={offerText}
                placeholder={t("rider.quote.offer.placeholder")}
                onChange={(event) => {
                  setOfferText(event.target.value);
                  if (offerError !== null) setOfferError(null);
                }}
              />
              <p className="qt__notes-hint">{t("rider.quote.offer.hint")}</p>
            </>
          )}
          {offerError !== null && (
            <p className="qt__notes-error" role="alert">
              {t(
                offerError === "required"
                  ? "rider.quote.offerMode.required"
                  : "rider.quote.offer.error",
              )}
            </p>
          )}
          <p className="qt__notes-hint">{t(OFFER_MODE_HINT[offerMode])}</p>
        </section>
        {/*
         * ## طريقةُ الدفعِ **قبلَ** الطلبِ لا بعدَه — الخطوةُ ٩
         *
         * وموضعُها ههنا **حكمٌ لا تنسيقٌ**: زرُّ `rider.quote.request` أسفلَ هذا
         * الموضعِ هوَ **نقطةُ اللاعودةِ** — لا شاشةَ تأكيدٍ بعدَه، بل يُسنَدُ
         * `intent` فتُركَّبُ `SearchScreen` فتُنادي `request_ride` فوراً. فراكبٌ
         * يطلُبُ وهوَ لا يعلمُ كيفَ يدفعُ قد صعِدَ على صمتِنا لا على علمِه.
         *
         * **والصمتُ ههنا ليسَ حياداً**: تطبيقٌ في هاتفٍ يُقرأُ افتراضاً «التطبيقُ
         * يتولّى الدفعَ»، فغيابُ البيانِ يزرعُ الظنَّ الكاذبَ نفسَه الذي يزرعُه
         * زرُّ دفعٍ لا يعملُ. فالبيانُ **نفيٌ ثلاثيٌّ صريحٌ**: لا قبضَ، ولا
         * حفظَ، ولا تحديدَ مبلغٍ.
         *
         * **ولا يُخالِفُ `ADR 0039` §٤ بل يُنفِذُه**: المحجوبُ هناكَ **آليّةُ
         * أجرةٍ** — حقلٌ أو حسبةٌ أو عمولةٌ. وهذا نصٌّ يقولُ إنَّ الآليةَ
         * **غيرُ موجودةٍ**، وهوَ ضدُّ بنائِها لا تمهيدٌ لها. ولا زرَّ دفعٍ. والمبلغُ
         * الذي قد يكتبُه الراكبُ فوقَه (`WR-05` · ADR 0264) عرضُه هوَ لا حسبةُ المنصّة،
         * فالنصُّ الثالثُ يقولُ ذلك ولا ينفي وجودَ الحقل.
         */}
        <section className="qt__payment" aria-label={t("rider.quote.payment.title")}>
          <h2 className="qt__subtitle">{t("rider.quote.payment.title")}</h2>
          <p className="qt__payment-line">{t("rider.quote.payment.direct")}</p>
          <p className="qt__payment-line">{t("rider.quote.payment.noCustody")}</p>
          <p className="qt__payment-line">{t("rider.quote.payment.noAmount")}</p>
        </section>
        <section className="qt__services" aria-label={t("rider.quote.services")}>
          <h2 className="qt__subtitle">{t("rider.quote.services")}</h2>
          {cards.length === 0 ? (
            <p className="sys__hint">{t("rider.quote.services.empty")}</p>
          ) : (
            <ul className="qt__list">
              {cards.map((card) => (
                <li
                  key={card.service}
                  className={`qt__card${card.available ? "" : " qt__card--off"}`}
                >
                  <span className="qt__card-head">
                    <span className="qt__card-icon">
                      <Glyph name={card.service === "delivery" ? "parcel" : "car"} />
                    </span>
                    <span className="qt__card-label">{t(card.labelKey)}</span>
                  </span>
                  {card.reasonKey !== null && (
                    <span className="qt__card-reason">{t(card.reasonKey)}</span>
                  )}
                  {/*
                   * الفعلُ على البطاقةِ **المتاحةِ** وحدَها: خدمةٌ غيرُ مخدومةٍ في
                   * المدينةِ تُعرَضُ بسببِها ولا يُعرَضُ لها زرٌّ يُرفَضُ حتماً.
                   */}
                  {card.available && onRequest !== undefined && (
                    <button
                      type="button"
                      className="qt__card-request"
                      onClick={() => {
                        // التحقُّقُ من وصفِ الطردِ للتوصيلِ فقط — قبلَ الإرسالِ. ونوعُ الطردِ
                        // صارَ اختياريّاً (`ORDER-TERMS-01`): يُحاكَمُ ما كُتِبَ ولا يُلزَمُ الفارغُ.
                        if (card.service === "delivery" && notes.trim() !== "") {
                          const error = parcelValidationError(notes);
                          if (error !== null) {
                            setParcelError(error.errorKey);
                            return;
                          }
                        }
                        setParcelError(null);
                        const offerPolicy = offerPolicyFrom(offerMode, offerText);
                        if (!offerPolicy.ok) {
                          setOfferError(offerPolicy.error);
                          return;
                        }
                        setOfferError(null);
                        onRequest({
                          service: card.service,
                          originLat: origin.lat,
                          originLng: origin.lng,
                          destinationLat: destination.lat,
                          destinationLng: destination.lng,
                          destinationLabel: destination.label,
                          // الاسمُ المُرسَلُ هوَ ما كتبَه الراكبُ أو اختارَه — لا وصفُ «نقطة بلا اسم».
                          pickupLabel:
                            manualPickup === null
                              ? null
                              : manualPickup.place === undefined
                                ? manualPickup.label
                                : manualPickup.place.label,
                          destinationUserLabel:
                            destination.place === undefined
                              ? destination.label
                              : destination.place.label,
                          pickupPlace:
                            manualPickup?.place === undefined
                              ? null
                              : placeWire(manualPickup.place),
                          dropoffPlace:
                            destination.place === undefined ? null : placeWire(destination.place),
                          notes: noteValue,
                          // مفتاحٌ واحدٌ لهذه النيّةِ، ويُعادُ في كلِّ محاولةٍ (`ARCH-006`).
                          idempotencyKey: newIdempotencyKey(),
                          pickupAt: pickupMode === "later" ? pickupAtFrom(pickupClock) : null,
                          offerSar: offerPolicy.offerSar,
                          offerMode: offerPolicy.offerMode,
                        });
                      }}
                    >
                      {t("rider.quote.request")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  };

  const sectionName = showTitle ? { "aria-labelledby": "qt-title" as const } : {};
  return (
    <section className="qt" dir={directionFor(language)} {...sectionName}>
      {showTitle ? (
        <h1 className="qt__title" id="qt-title">
          {t("rider.quote.title")}
        </h1>
      ) : null}
      <p className="qt__destination">
        {t("rider.quote.destination").replace("{label}", destination.label)}
      </p>
      {body()}
      {onBack === undefined ? null : (
        <button type="button" className="qt__back" onClick={() => onBack()}>
          {t("rider.quote.back")}
        </button>
      )}

      {/* مدخلُ الاستغاثةِ (`PD-020`) — يُرسَمُ إذا مُرِّرَ، فيبقى البابُ في كلِّ سطحٍ. */}
      {onOpenSos === undefined ? null : <SosEntry onOpen={onOpenSos} language={language} />}
    </section>
  );
}
