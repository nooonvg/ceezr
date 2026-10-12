/**
 * الغرض: نموذجُ عرضِ شاشةِ اختيارِ الوجهةِ — تحويلُ ردَّيِ
 *   `/v1/destinations/search` و`/v1/destinations/resolve` وأخطائِهما إلى صفوفٍ
 *   ومفاتيحِ نصٍّ، منطقاً خالصاً بلا DOM (البند `F2-03` · `SR-03`).
 * الحالة: منفّذ فعلياً — البند `F2-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/destination
 * يُستخدم من: `DestinationScreen.tsx`.
 * يُتوقع أن يستخدمه لاحقاً: شاشةُ `F2-04` — تعرضُ الوجهةَ المُصادَقةَ نفسَها في
 *   ملخّصِ الطلبِ، فتقرأُ `acceptedSummary` ولا تُعيدُ تركيبَ النصِّ.
 *
 * ## ما لا يفعلُه هذا الملفُّ عن قصدٍ
 *
 *   ــ **لا يُترجِمُ**: يُعيدُ مفاتيحَ وأعداداً (§9.11)، والترجمةُ في
 *      `shared/i18n/miniapp`.
 *   ــ **لا يُعيدُ ترتيبَ النتائجِ**: الرتبةُ وأولويّةُ المصدرِ حكمُ القاعدةِ في
 *      `search_destinations`، وفرزٌ ثانٍ ههنا مصدرٌ ثانٍ للحقيقةِ (القاعدة 0.6).
 *      وما يفعلُه: يطرحُ الصفَّ الذي **لا يُقرأُ** (لافتةٌ فارغةٌ).
 *   ــ **لا يُقرِّرُ الاحتواءَ**: القبولُ والرفضُ حكمُ القاعدةِ (القاعدة 0.5)،
 *      وههنا قراءةُ الحكمِ لا إعادتُه.
 *   ــ **لا يزعمُ خريطةً**: لا مزوّدَ خرائطَ في الحزمةِ (ADR 0007)، فالشاشةُ
 *      تُعلِنُ الحدَّ كما تفعلُ `HomeScreen` ولا ترسمُ مستطيلاً يُوهِمُ موقعاً.
 *   ــ **لا يختلقُ موقعاً عندَ رفضِ الإذنِ**: `locationRefusalKey` يُعيدُ سببَ
 *      التعذّرِ مفتاحاً، ولا يُستعاضُ عنه بمركزِ المدينةِ.
 */

import "../../../../../../packages/shared/i18n/miniapp/ar-parts/rider-destination.ts";
import {
  type DestinationRefusal,
  type DestinationSource,
  describesPoint,
  destinationRefusalKey,
  destinationSourceKey,
  isDestinationRefusal,
  isDestinationSource,
  isUserFixableRefusal,
  landmarkKindKey,
} from "../../../../../../packages/domain/destinations/landmark-kinds.ts";
import {
  MIN_SEARCH_QUERY_LENGTH,
  normalizeSearchText,
  readSearchQuery,
  wordStartMatch,
} from "../../../../../../packages/domain/destinations/search-text.ts";
import {
  type DeviceFixAssessment,
  type DeviceFixReason,
  type ParsedPlaceLink,
  type PlacePointSource,
  parseCoordinateText,
  parsePlaceLink,
} from "../../../../../../packages/domain/places/place-input.ts";
import type {
  ApiAcceptedDestination,
  ApiDestinationSuggestion,
  DestinationResolveResponse,
} from "./destination-contract.ts";

export interface SuggestionRow {
  /** مفتاحُ مصفوفةٍ مستقرٌّ: المصدرُ ومعرّفُه، وللمشتقِّ موضعُه. */
  readonly key: string;
  readonly source: DestinationSource;
  /** مفتاحُ اسمِ المصدرِ — «محفوظٌ» أو «أخيرٌ» أو «دليلٌ». */
  readonly sourceKey: string;
  /** مفتاحُ اسمِ الصنفِ، و`null` لما ليسَ معلَماً. */
  readonly kindKey: string | null;
  readonly labelAr: string;
  readonly labelEn: string | null;
  readonly lat: number;
  readonly lng: number;
  /** هل طابَقَ الاستفهامُ **بدايةَ كلمةٍ**؟ يُبرَزُ الصفُّ ولا يُعادُ فرزُه. */
  readonly strong: boolean;
}

/**
 * الاسمُ المعروضُ بلغةِ الشاشةِ. والعربيُّ هوَ الأصلُ دائماً ولا يُترَكُ فارغاً
 * في القاعدةِ؛ أمّا الإنجليزيُّ فقد يغيبُ لمكانٍ حفظَه صاحبُه بالعربيّةِ، فيُعادُ
 * العربيُّ ولا تُعرَضُ لافتةٌ فارغةٌ لمَن اختارَ الإنجليزيّةَ.
 */
export function labelFor(row: SuggestionRow, language: string): string {
  if (language === "ar") return row.labelAr;
  return row.labelEn ?? row.labelAr;
}

/**
 * صفوفُ النتائجِ. تُطرَحُ اللافتةُ الفارغةُ (صفٌّ لا يُقرأُ) والإحداثيّةُ التي
 * ليست عدداً منتهياً (نقرةٌ لا تُفضي إلى شيءٍ) — وما سواهما يُعرَضُ بترتيبِ
 * القاعدةِ حرفاً.
 */
export function suggestionRows(
  suggestions: readonly ApiDestinationSuggestion[],
): readonly SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  suggestions.forEach((suggestion, index) => {
    if (!isDestinationSource(suggestion.source)) return;
    if (suggestion.labelAr.trim().length === 0) return;
    if (!Number.isFinite(suggestion.lat) || !Number.isFinite(suggestion.lng)) return;
    rows.push({
      key: `${suggestion.source}:${suggestion.refId ?? String(index)}`,
      source: suggestion.source,
      sourceKey: destinationSourceKey(suggestion.source),
      kindKey: suggestion.kind === null ? null : landmarkKindKey(suggestion.kind),
      labelAr: suggestion.labelAr,
      labelEn: suggestion.labelEn,
      lat: suggestion.lat,
      lng: suggestion.lng,
      strong: suggestion.matchRank === 0,
    });
  });
  return rows;
}

/**
 * موضعُ المطابقةِ في نصٍّ **معروضٍ** — لِيُبرَزَ ما كتبَه الباحثُ. والحسابُ على
 * النصِّ المُطبَّعِ والقصُّ على الخامِّ: لو حُسِبَ على الخامِّ لَمَا طابقَ «جده»
 * «جدة» أصلاً، ولو قُصَّ على المُطبَّعِ لَعُرِضَ نصٌّ منزوعُ التشكيلِ غيرُ الذي
 * كتبَه صاحبُ المكانِ.
 *
 * ويُشترَطُ **تساوي الطولِ** بينَ الخامِّ والمُطبَّعِ: التطبيعُ قد يحذفُ تشكيلاً
 * فتزيحُ المواضعُ، وإبرازٌ مُزاحٌ أسوأُ من لا إبرازٍ. فحينَ يختلفُ الطولُ يُعادُ
 * `null` ويُعرَضُ النصُّ سليماً بلا إبرازٍ.
 */
export function highlightRange(
  displayed: string,
  normalizedQuery: string,
): { readonly start: number; readonly end: number } | null {
  if (normalizedQuery.length === 0) return null;
  const normalized = normalizeSearchText(displayed);
  if (normalized.length !== displayed.length) return null;
  if (!wordStartMatch(normalized, normalizedQuery)) return null;
  const start = normalized.startsWith(normalizedQuery)
    ? 0
    : normalized.indexOf(` ${normalizedQuery}`) + 1;
  if (start < 0) return null;
  return { start, end: start + normalizedQuery.length };
}

/** هل يُنادى الخادمُ بهذا المدخلِ؟ القياسُ بعدَ التطبيعِ لا قبلَه. */
export function isSearchable(typed: string): boolean {
  return readSearchQuery(typed) !== null;
}

/** ما دونَ الحدِّ يُعرَضُ إرشاداً لا خطأً — والعددُ يُمرَّرُ للنصِّ ولا يُكتَبُ فيه. */
export const SEARCH_HINT_MIN_LENGTH = MIN_SEARCH_QUERY_LENGTH;

export interface AcceptedSummary {
  readonly lat: number;
  readonly lng: number;
  /** `LOC-TRUST-01` — رابطُ النقطةِ نفسِها (من الخادم)؛ `null` من بوّابةٍ أقدم. */
  readonly mapUrl: string | null;
  readonly cityNameAr: string;
  readonly cityNameEn: string;
  /**
   * وصفُ «قربَ كذا»: مفتاحُ الصنفِ والاسمُ والمسافةُ مقرَّبةً إلى المترِ. و`null`
   * حينَ لا معلَمَ قريباً بما يكفي — فيُسكَتُ ولا يُقالُ «قربَ المطارِ» لنقطةٍ
   * تبعدُ عنه ثمانيةَ كيلومتراتٍ.
   */
  readonly nearest: {
    readonly kindKey: string;
    readonly nameAr: string;
    readonly nameEn: string;
    readonly distanceM: number;
  } | null;
}

export function acceptedSummary(destination: ApiAcceptedDestination): AcceptedSummary {
  const nearest = destination.nearest;
  return {
    lat: destination.lat,
    lng: destination.lng,
    mapUrl: typeof destination.mapUrl === "string" ? destination.mapUrl : null,
    cityNameAr: destination.city.nameAr,
    cityNameEn: destination.city.nameEn,
    nearest:
      nearest === null || !describesPoint(nearest.straightDistanceM)
        ? null
        : {
            kindKey: landmarkKindKey(nearest.kind),
            nameAr: nearest.nameAr,
            nameEn: nearest.nameEn,
            distanceM: Math.round(nearest.straightDistanceM),
          },
  };
}

export interface RefusalView {
  readonly refusal: DestinationRefusal;
  readonly messageKey: string;
  /** هل يُجدي تحريكُ الدبّوسِ؟ فيُعرَضُ زرُّ «اختَرْ نقطةً أخرى» لا زرُّ إعادةٍ. */
  readonly fixable: boolean;
  readonly cityNameAr: string | null;
  readonly cityNameEn: string | null;
}

/**
 * قراءةُ الرفضِ. ورمزٌ **لا يعرفُه** هذا الإصدارُ لا يُسقِطُ الشاشةَ: خادمٌ
 * أحدثُ قد يُضيفُ رفضاً (حدٌّ زمنيٌّ للخدمةِ مثلاً)، ويُعرَضُ عندَها نصٌّ عامٌّ
 * صادقٌ «لا نستطيعُ قبولَ هذه النقطةِ» — لا قبولٌ صامتٌ ولا شاشةُ عطبٍ.
 */
export function refusalView(
  response: Extract<DestinationResolveResponse, { accepted: false }>,
): RefusalView {
  const known = isDestinationRefusal(response.refusal);
  const refusal: DestinationRefusal = known
    ? (response.refusal as DestinationRefusal)
    : "OUTSIDE_SERVICE_AREA";
  return {
    refusal,
    messageKey: known ? destinationRefusalKey(refusal) : "rider.destination.refused.UNKNOWN",
    fixable: known ? isUserFixableRefusal(refusal) : true,
    cityNameAr: response.city?.nameAr ?? null,
    cityNameEn: response.city?.nameEn ?? null,
  };
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  MALFORMED: "rider.destination.error.malformed",
  QUERY_TOO_SHORT: "rider.destination.error.query",
  ACCOUNT_NOT_FOUND: "rider.destination.error.account",
  DESTINATION_STORE_NOT_AVAILABLE: "rider.destination.error.unavailable",
  SESSION_NOT_AVAILABLE: "rider.destination.error.unavailable",
};

/** مفتاحُ رسالةِ الرفضِ الذي يخصُّ الوجهةَ — أمّا الجلسةُ والانقطاعُ فشاشةُ نظامٍ. */
export function destinationErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.destination.error.unavailable";
}

/** الأخطاءُ التي تُعيدُ المحاولةَ معنىً — لا التي تُصلَحُ بضغطِ زرٍّ مرّةً أخرى. */
export function isRetryableDestinationError(code: string): boolean {
  return code === "DESTINATION_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE";
}

const LOCATION_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  declined: "rider.destination.location.declined",
  "no-telegram": "rider.destination.location.unsupported",
  "unsupported-version": "rider.destination.location.unsupported",
  "missing-api": "rider.destination.location.unsupported",
  failed: "rider.destination.location.failed",
};

/**
 * سببُ تعذّرِ «موقعي الحاليُّ» مفتاحاً. و«رفَضَ المستخدمُ» مفصولٌ عن «لا يدعمُه
 * المُضيفُ» عن «أخفقَ»: الأوّلُ يُصلَحُ بالإعداداتِ، والثاني لا يُصلَحُ فلا يُعرَضُ
 * له زرٌّ، والثالثُ تُعادُ معه المحاولةُ. ورسالةٌ واحدةٌ للثلاثةِ تُرسِلُ مَن لا
 * يملكُ الميزةَ إلى إعداداتٍ لا وجودَ فيها لِما يبحثُ عنه.
 */
export function locationRefusalKey(reason: string): string {
  return LOCATION_REFUSAL_KEYS[reason] ?? "rider.destination.location.failed";
}

/** وهل يُعرَضُ زرُّ «افتَحِ الإعداداتِ»؟ لا يُعرَضُ لِما لا إعداداتِ له. */
export function offersLocationSettings(reason: string): boolean {
  return reason === "declined";
}

// ─── `LOC-TRUST-01` — المكانُ المؤكَّدُ وعرضُه ───────────────────────────────

/**
 * ما يخرجُ من شاشةِ الالتقاطِ/الوجهةِ مع النقطة: الاسمُ **كما كتبَه الراكبُ أو اختارَه**
 * (لا أقربُ معلَم)، ومصدرُ النقطةِ ودقّتُها ووقتُها، والرابطُ الأصليُّ حرفاً، والملاحظات.
 */
export interface ConfirmedPlace {
  readonly label: string | null;
  readonly source: PlacePointSource;
  readonly accuracyM: number | null;
  readonly capturedAt: string | null;
  readonly link: string | null;
  readonly notes: string | null;
}

/** حمولةُ السلكِ لـ`pickupPlace`/`dropoffPlace` — الاسمُ يذهبُ في حقلِه المسطّحِ القديم. */
export interface PlaceWire {
  readonly source: PlacePointSource;
  readonly accuracyM: number | null;
  readonly capturedAt: string | null;
  readonly link: string | null;
  readonly notes: string | null;
}

export function placeWire(place: ConfirmedPlace): PlaceWire {
  return {
    source: place.source,
    accuracyM: place.accuracyM,
    capturedAt: place.capturedAt,
    link: place.link,
    notes: place.notes,
  };
}

/** النقطةُ كما سيعتمدُ عليها السائق: خمسُ منازلَ (≈ متر) لا أكثرَ ولا أقل. */
export function formatPoint(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * «مسجد مسجد بلال»: صنفُ المعلَمِ يُكرَّرُ حينَ يبدأُ الاسمُ به. فيُسقَطُ الصنفُ ويبقى الاسم.
 */
export function landmarkPhrase(kindLabel: string, name: string): string {
  const kind = kindLabel.trim();
  return kind === "" || name.trim().startsWith(kind) ? name : `${kind} ${name}`;
}

const SOURCE_KEYS: Readonly<Record<PlacePointSource, string>> = {
  DEVICE: "rider.place.source.DEVICE",
  MAP_PIN: "rider.place.source.MAP_PIN",
  SHARED_LINK: "rider.place.source.SHARED_LINK",
  SUGGESTION: "rider.place.source.SUGGESTION",
  SAVED: "rider.place.source.SAVED",
};

export function pointSourceKey(source: PlacePointSource): string {
  return SOURCE_KEYS[source];
}

const LINK_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  NOT_A_LINK: "rider.place.link.notALink",
  UNSUPPORTED_HOST: "rider.place.link.unsupported",
  TOO_LONG: "rider.place.link.tooLong",
};

export function linkRefusalKey(refusal: string): string {
  return LINK_REFUSAL_KEYS[refusal] ?? "rider.place.link.notALink";
}

/** ما يُقرأُ من نصٍّ ملصوق: إحداثيّاتٌ (`MAP_PIN`) أو رابطٌ (بنقطةٍ أو بلا نقطة) أو رفض. */
export type PastedPlace =
  | { readonly kind: "coordinates"; readonly lat: number; readonly lng: number }
  | { readonly kind: "link"; readonly link: ParsedPlaceLink }
  | { readonly kind: "refused"; readonly messageKey: string };

export function readPastedPlace(text: string): PastedPlace {
  const coordinates = parseCoordinateText(text);
  if (coordinates !== null) return { kind: "coordinates", ...coordinates };
  const parsed = parsePlaceLink(text);
  if ("refusal" in parsed) return { kind: "refused", messageKey: linkRefusalKey(parsed.refusal) };
  return { kind: "link", link: parsed };
}

/** متى يُسمَحُ بالاعتماد؟ — الشروطُ كلُّها في مكانٍ واحدٍ يُختبَر. */
export function confirmBlocker(input: {
  readonly source: PlacePointSource;
  readonly assessment: DeviceFixAssessment | null;
  readonly acknowledged: boolean;
  readonly linkConflict: boolean;
  readonly notesTooLong: boolean;
}): string | null {
  if (input.linkConflict) return "rider.place.link.conflict";
  if (input.notesTooLong) return "rider.place.notes.tooLong";
  if (input.source === "DEVICE" && input.assessment !== null) {
    if (input.assessment.verdict === "UNRELIABLE") return "rider.place.fix.unreliable";
    if (input.assessment.verdict === "COARSE" && !input.acknowledged) {
      return "rider.place.fix.ackRequired";
    }
  }
  return null;
}

const FIX_REASON_KEYS: Readonly<Record<DeviceFixReason, string>> = {
  ACCURACY_UNKNOWN: "rider.place.fix.reason.ACCURACY_UNKNOWN",
  ACCURACY_COARSE: "rider.place.fix.reason.ACCURACY_COARSE",
  ACCURACY_UNRELIABLE: "rider.place.fix.reason.ACCURACY_UNRELIABLE",
  FRESHNESS_UNKNOWN: "rider.place.fix.reason.FRESHNESS_UNKNOWN",
  STALE: "rider.place.fix.reason.STALE",
  TOO_OLD: "rider.place.fix.reason.TOO_OLD",
};

export function fixReasonKey(reason: DeviceFixReason): string {
  return FIX_REASON_KEYS[reason];
}

/**
 * `WR-16D` — موضعُ اختصارِ «استخدم موقعي الحالي»: قبلَ النتائجِ ما دامَ البحثُ فارغًا، وبعدَها
 * حينَ يكتبُ الراكبُ اسمًا، فلا يبدو أوّلَ نتيجةٍ لبحثِ «الحرم» ولا بديلًا عنه.
 */
export function locateShortcutPlacement(typed: string): "beforeResults" | "afterResults" {
  return isSearchable(typed) ? "afterResults" : "beforeResults";
}

/**
 * `WR-16D` — الموقعُ الحاليُّ لا يمحو مكانًا مختارًا بالاسمِ إلّا بموافقة: إن كانَ المقبولُ اسمًا
 * اختارَه الراكبُ (اقتراحٌ أو مكانٌ محفوظ) سُئلَ قبلَ الاستبدال، وإلّا قُرئَ الموقعُ مباشرة.
 */
export function locateIntent(
  accepted: { readonly presetLabel: string | null } | null,
): { readonly kind: "read" } | { readonly kind: "confirmReplace"; readonly label: string } {
  if (accepted === null || accepted.presetLabel === null || accepted.presetLabel.trim() === "") {
    return { kind: "read" };
  }
  return { kind: "confirmReplace", label: accepted.presetLabel };
}
