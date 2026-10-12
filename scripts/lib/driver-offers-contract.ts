/**
 * الغرض: قواعدُ عقدِ عروضِ السائقِ — ثمانُ قواعدَ تُقاسُ على نصِّ المستودعِ لا على
 *   نيّةِ كاتبِه (البند `F3-02` · `SD-03` · `SD-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-02`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-driver-offers-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-05` (الرحلةُ النشطةُ) — قاعدةُ «كاتبٌ واحدٌ»
 *   وقاعدةُ «لا ساعةَ جهازٍ» عينُهما، ويُزادُ مِلفُّها إلى القوائمِ بلا قاعدةٍ جديدةٍ.
 * الحاكم: docs/adr/0117-a-countdown-is-a-server-fact-and-an-acceptance-has-one-writer.md
 *
 * ## لِمَ حاجزٌ على عروضِ سائقٍ
 *
 * لأنَّ أربعةَ أعطابٍ ههنا **لا يُمسِكُها اختبارٌ أخضرُ**:
 *
 *   ــ **مؤقّتٌ يُحسَبُ بساعةِ الهاتفِ**: `expires_at - Date.now()` يمرُّ في كلِّ
 *      اختبارٍ على جهازٍ ساعتُه سليمةٌ، ويُخفي عرضاً صالحاً عندَ سائقٍ ساعتُه
 *      منحرفةٌ دقيقةً — وهوَ **أكثرُ الهواتفِ الرخيصةِ**.
 *   ــ **ذرّيّةٌ ثانيةٌ**: قفلٌ أو تحديثٌ لِـ`orders` في شِفرةِ هذه الشريحةِ
 *      يجعلُ للإيكالِ كاتبَينِ. والسبقُ لا يُقاسُ إلّا بحملٍ متزامنٍ نادرٍ، فيمرُّ
 *      العطبُ إلى الإنتاجِ ثمَّ يُوكَلُ طلبٌ واحدٌ لسائقَينِ.
 *   ــ **رقمُ مسافةٍ بلا وسمٍ**: «١٢ كم» تُقرأُ طولَ طريقٍ وهيَ خطٌّ مستقيمٌ
 *      (`ADR 0024`) — فيقبلُ السائقُ على تقديرٍ كاذبٍ.
 *   ــ **هويّةُ راكبٍ في حمولةِ عرضٍ**: العرضُ يذهبُ إلى **كلِّ سائقي الجولةِ**،
 *      فاسمُ الراكبِ أو هاتفُه فيها كشفٌ لمن لم يُوكَلْ إليه شيءٌ.
 *
 * ## القواعدُ الثمانِ
 *
 *   ١. **مفاتيحُ النصِّ ثلاثةٌ متطابقةٌ**، وكلُّ مُنادًى موجودٌ — ومنه المُعلَنُ
 *      عبرَ الشرائحِ (`rider.quote.distance*` · `driver.documents.block.*`).
 *   ٢. **كلُّ رمزٍ عامٍّ له نصُّه** في الثلاثةِ، ولا رمزَ «معروفٌ» في السطحِ لا
 *      يُصدِرُه التطبيقُ.
 *   ٣. **لا لفظَ مالٍ في الشريحةِ كلِّها** — شِفرةً وSQL ونصّاً (`ADR 0039` §٤ ·
 *      `DEC-11` · `م13-7`): الطبقةُ الماليّةُ **غائبةٌ بإعلانٍ**، وحقلٌ فارغٌ
 *      اسمُه أجرةٌ يُقرأُ «مجّاناً».
 *   ٤. **كاتبُ الإيكالِ واحدٌ**: SQL الشريحةِ يُنادي `claim_ride` ولا يقفلُ صفّاً
 *      ولا يُحدِّثُ `orders`.
 *   ٥. **نزعُ تنفيذٍ ومنحُه** لكلِّ دالّةٍ جديدةٍ، بالأدوارِ الثلاثةِ مُسمّاةً.
 *   ٦. **صدقُ المؤقّتِ والمسافةِ**: لا ساعةَ جهازٍ في النطاقِ ولا في نموذجِ
 *      العرضِ، ولا لحظةَ انتهاءٍ في حمولةٍ ولا في شاشةٍ، والخادمُ يُنشِرُ
 *      `server_time` و`seconds_left`، وكلُّ مسافةٍ منشورةٍ موسومةٌ.
 *   ٧. **جدولُ الحالاتِ مُستوفٍ حرفاً**: لكلِّ رمزٍ منشورٍ حالةُ HTTP، ولا مدخلَ
 *      لرمزٍ غيرِ منشورٍ.
 *   ٨. **لا هويّةَ راكبٍ** في حمولةٍ ولا في مِلفّاتِ العميلِ.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 * - **لا يُثبِتُ ذرّيّةَ `claim_ride`**: تلكَ مقيسةٌ في اختبارِ تكاملٍ متزامنٍ
 *   قائمٍ من قبلِ هذا البندِ، وهذا الحاجزُ يمنعُ **كاتباً ثانياً** فحسب.
 *   والحاجزُ الذي يدَّعي أكثرَ من قياسِه أخطرُ من غيابِه.
 * - **لا يقيسُ انحرافَ ساعةٍ حقيقيّاً**: يمنعُ بابَه في النصِّ، وأثرُ الانحرافِ
 *   على جهازٍ حقيقيٍّ **دَينٌ مُعلَنٌ** لا يُدَّعى مقيساً.
 * - **لا يحكمُ في الشكلِ ولا في الوصولِيّةِ**: تغطيةُ الأنماطِ حاجزٌ آخرُ.
 * - **لا يقرأُ لفظَ مالٍ في تعليقٍ**: يُغذَّى بشِفرةٍ منزوعةِ التعليقاتِ، وإلّا
 *   لَسقطَ على شرحٍ يُعلِّلُ **غيابَ** الأجرةِ — وذاكَ عينُ ما نريدُ كتابتَه.
 * - **ولا يمنعُ لفظةَ «دفعٍ» العربيّةَ**: تُقرأُ «دفعاً إلى الجهازِ» (`push`)
 *   كما تُقرأُ «سدادَ مالٍ»، فمنعُها يُسقِطُ نصّاً صادقاً — والمنعُ على ما لا
 *   يحتملُ إلّا المالَ (أجرةٌ · سعرٌ · تعرفةٌ · عمولةٌ · محفظةٌ · فاتورةٌ · ريالٌ).
 */

import { blankSqlComments } from "./blank-comments.ts";
import { withoutRiderOfferTerms } from "./rider-offer-terms.ts";

/** مِلفّاتُ سطحِ العروضِ في التطبيقِ المصغَّرِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/offers/OffersScreen.tsx",
  "apps/miniapp/src/surfaces/driver/offers/OfferDetailScreen.tsx",
  "apps/miniapp/src/surfaces/driver/offers/offers-view.ts",
  "apps/miniapp/src/surfaces/driver/offers/offers-api.ts",
  "apps/miniapp/src/surfaces/driver/offers/offers-contract.ts",
];

/** الشاشاتُ وحدَها — القاعدة ٦ تمنعُ فيها لحظةَ الانتهاءِ. */
export const SCREEN_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/offers/OffersScreen.tsx",
  "apps/miniapp/src/surfaces/driver/offers/OfferDetailScreen.tsx",
];

/** المِلفّانِ اللذانِ لا ساعةَ فيهما ألبتّةَ — نموذجُ العرضِ والنطاقُ. */
export const CLOCKLESS_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/offers/offers-view.ts",
  "packages/domain/driver/driver-offers.ts",
];

export const VIEW_FILE = "apps/miniapp/src/surfaces/driver/offers/offers-view.ts";
export const CONTRACT_FILE = "apps/miniapp/src/surfaces/driver/offers/offers-contract.ts";
export const ROUTE_FILE = "apps/gateway/src/routes/driver-offers.ts";
export const DOMAIN_FILE = "packages/domain/driver/driver-offers.ts";
export const APPLICATION_FILE = "packages/application/driver/driver-offers.ts";
export const STORE_FILE = "packages/infrastructure/driver/driver-offers-store.ts";
export const FUNCTIONS_SQL_FILE =
  "supabase/migrations/20260915020000_f3_02_driver_offer_functions.sql";

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "driver.offers.";

/**
 * مفاتيحُ **مُعلَنةٌ عبرَ الشرائحِ**: سياسةُ عرضِ المسافةِ واحدةٌ في المستودعِ
 * (`ADR 0024`)، فيستعملُ سطحُ السائقِ مفاتيحَ الراكبِ نصّاً ولا يُنشِئُ نسخةً
 * ثانيةً تنحرفُ عنها. وأسبابُ الحجبِ مفاتيحُ `F3-01` بعينِها لعينِ السببِ.
 */
export const DECLARED_CROSS_SLICE_KEYS: readonly string[] = [
  "rider.quote.distanceMeters",
  "rider.quote.distanceKilometers",
  "rider.quote.distance.straightLine",
  "rider.quote.distance.unavailable",
  "driver.documents.blocksLabel",
  "driver.documents.block.EXPIRED",
  "driver.documents.block.REJECTED",
  "driver.documents.block.UNKNOWN",
];

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/** الدورُ الوحيدُ الذي يُنفِّذُ: بوّابتُنا وحدَها تحملُه. */
export const GRANTED_ROLE = "service_role";

/**
 * ألفاظُ المالِ الممنوعةُ في الشريحةِ. **وليست قائمةَ كلماتٍ عامّةً**: كلٌّ منها
 * لا يحتملُ في هذا السياقِ إلّا معنى المالِ، فسقوطُ الحاجزِ عليه سقوطٌ صادقٌ.
 */
export const MONEY_TOKENS: readonly string[] = [
  "fare",
  "price",
  "pricing",
  "tariff",
  "payout",
  "invoice",
  "wallet",
  "commission",
  "payment",
  "أجرة",
  "الأجرة",
  "سعر",
  "تسعير",
  "تعرفة",
  "عمولة",
  "محفظة",
  "فاتورة",
  "ريال",
];

/** ما لا يُنشَرُ في حمولةٍ ولا يُذكَرُ في مِلفِّ عميلٍ — هويّةُ راكبٍ. */
export const RIDER_IDENTITY_TOKENS: readonly string[] = [
  "phone",
  "full_name",
  "fullName",
  "language_code",
  "languageCode",
  "rider_id",
  "riderId",
];

/** مفاتيحُ المسافةِ المسموحةُ — وكلٌّ منها **موسومٌ** أو `null`. */
export const TAGGED_DISTANCE_KEYS: readonly string[] = ["rider_distance", "trip_distance"];

export interface DriverOffersContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ**. */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ مِلفِّ المساراتِ **بلا تعليقاتٍ**. */
  readonly route: string;
  /** نصُّ مِلفِّ النطاقِ **بلا تعليقاتٍ**. */
  readonly domain: string;
  /** نصُّ طبقةِ التطبيقِ **بلا تعليقاتٍ**. */
  readonly application: string;
  /** نصُّ مُهايِئِ القاعدةِ **بلا تعليقاتٍ**. */
  readonly store: string;
  /** نصُّ هجرةِ الدوالِّ **بلا تعليقاتٍ**. */
  readonly functionsSql: string;
  /** الرموزُ العامّةُ للخطأِ كما تُصدِرُها طبقةُ التطبيقِ. */
  readonly publicErrorCodes: readonly string[];
  /** القواميسُ الثلاثةُ مُحلَّلةً. */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const ASCII_WORD = /^[a-z_]+$/i;

/**
 * ذِكرٌ **بحدودِ الكلمةِ** للّاتينيّةِ واحتواءٌ لغيرِها: «price» لا تُقرأُ في
 * «priceless» ولا في «surprise»، والعربيّةُ لا حدودَ حروفٍ لها بهذا المعنى
 * فتُقرأُ احتواءً — و«الأجرةِ» تُمسَكُ بها.
 */
export function mentions(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return lower.includes(needle);
  return new RegExp(`(?<![a-z_])${needle}(?![a-z_])`).test(lower);
}

/** يستخرجُ مفاتيحَ النصِّ المُنادَاةَ حرفيّاً من السطحِ — بادئتَي السائقِ والراكبِ. */
export function usedTextKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"((?:driver|rider)\.[A-Za-z0-9._]+)"/g;
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      // القوالبُ المبنيّةُ (`driver.offers.service.${…}`) لا تُقرأُ ههنا، وأصنافُها
      // تُفرَضُ في القاعدة ٢ وفي مفاتيحِ الحالاتِ المكتوبةِ أدناه.
      if (key !== undefined && !key.endsWith(".")) keys.add(key);
    }
  }
  return keys;
}

/**
 * المفاتيحُ التي تُبنى بقالبٍ في نموذجِ العرضِ — تُكتَبُ ههنا كي تُفحَصَ، فقالبٌ
 * لا يُقرأُ نصّاً يُخفي مفتاحاً بلا نصٍّ حتّى يراهُ سائقٌ في الشاشةِ.
 */
export const TEMPLATED_KEYS: readonly string[] = [
  "driver.offers.service.transport",
  "driver.offers.service.delivery",
  "driver.offers.offerStatus.pending",
  "driver.offers.offerStatus.accepted",
  "driver.offers.offerStatus.rejected",
  "driver.offers.offerStatus.expired",
  "driver.offers.offerStatus.cancelled",
  "driver.offers.orderStatus.searching",
  "driver.offers.orderStatus.matched",
  "driver.offers.orderStatus.in_progress",
  "driver.offers.orderStatus.completed",
  "driver.offers.orderStatus.cancelled",
  "driver.offers.orderStatus.failed",
];

function requireKeys(
  input: DriverOffersContractInput,
  keys: readonly string[],
  verdict: string,
): string[] {
  const problems: string[] = [];
  for (const key of keys) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) problems.push(`${language}: ${verdict} «${key}».`);
    }
  }
  return problems;
}

/** القاعدة ١ — تطابقُ المفاتيحِ في الثلاثةِ، وكلُّ مُنادًى ومُعلَنٍ موجودٌ. */
export function keyParityProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  const sets = new Map<string, ReadonlySet<string>>();
  for (const [language, dictionary] of Object.entries(input.translations)) {
    sets.set(language, new Set(Object.keys(dictionary).filter((k) => k.startsWith(KEY_PREFIX))));
  }
  const languages = [...sets.keys()].sort();
  const reference = languages[0];
  if (reference === undefined) return ["لا قاموسَ مقروءاً: الحاجزُ لا يقيسُ فراغاً."];
  const referenceSet = sets.get(reference) as ReadonlySet<string>;
  if (referenceSet.size === 0) {
    return [`${reference}: لا مفتاحَ واحداً بالبادئةِ «${KEY_PREFIX}» — سطحٌ بلا نصٍّ.`];
  }
  for (const language of languages.slice(1)) {
    const other = sets.get(language) as ReadonlySet<string>;
    for (const key of referenceSet) {
      if (!other.has(key)) problems.push(`${language}: مفتاحٌ ناقصٌ «${key}».`);
    }
    for (const key of other) {
      if (!referenceSet.has(key)) problems.push(`${reference}: مفتاحٌ ناقصٌ «${key}».`);
    }
  }
  problems.push(
    ...requireKeys(input, [...usedTextKeys(input.surface)], "مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ"),
    ...requireKeys(input, DECLARED_CROSS_SLICE_KEYS, "مفتاحٌ مُعلَنٌ عبرَ الشرائحِ ناقصٌ"),
    ...requireKeys(input, TEMPLATED_KEYS, "مفتاحٌ يُبنى بقالبٍ وليسَ في القاموسِ"),
  );
  return problems;
}

/** رموزُ الخطأِ التي يُصنِّفُها السطحُ معروفةً — تُقرأُ من مجموعةِ العرضِ نصّاً. */
export function knownErrorCodesInSurface(
  surface: Readonly<Record<string, string>>,
): ReadonlySet<string> {
  const source = surface[VIEW_FILE] ?? "";
  const block = source.match(/KNOWN_ERRORS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const codes = new Set<string>();
  if (block === null) return codes;
  for (const entry of (block[1] ?? "").matchAll(/"([A-Z_]+)"/g)) {
    const code = entry[1];
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

/** القاعدة ٢ — نصٌّ لكلِّ رمزٍ منشورٍ، ولا رمزَ «معروفٌ» لا يُصدِرُه التطبيقُ. */
export function errorTextProblems(input: DriverOffersContractInput): readonly string[] {
  if (input.publicErrorCodes.length === 0) {
    return [`${APPLICATION_FILE}: قائمةُ الرموزِ العامّةِ فارغةٌ — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  const problems = requireKeys(
    input,
    [
      ...input.publicErrorCodes.map((code) => `${KEY_PREFIX}error.${code}`),
      `${KEY_PREFIX}error.UNKNOWN`,
    ],
    "رمزُ خطأٍ بلا نصٍّ",
  );
  const published = new Set(input.publicErrorCodes);
  for (const code of knownErrorCodesInSurface(input.surface)) {
    if (!published.has(code)) {
      problems.push(
        `offers-view.ts: الرمزُ «${code}» يُصنَّفُ معروفاً ولا يُصدِرُه التطبيقُ — ` +
          `نصٌّ لا يُعرَضُ أبداً يُخفي أنَّ رمزاً حقيقيّاً بلا نصٍّ.`,
      );
    }
  }
  for (const code of published) {
    if (!knownErrorCodesInSurface(input.surface).has(code)) {
      problems.push(
        `offers-view.ts: الرمزُ «${code}» يُصدِرُه التطبيقُ ولا يعرفُه السطحُ — ` +
          `فيُعرَضُ نصُّ «UNKNOWN» عن رفضٍ له سببٌ مُسمّىً.`,
      );
    }
  }
  return problems;
}

/** كلُّ نصوصِ الشريحةِ الثلاثيّةِ في سلسلةٍ واحدةٍ — للقاعدة ٣. */
function sliceTexts(input: DriverOffersContractInput): Readonly<Record<string, string>> {
  const offerValues = Object.entries(input.translations).map(([language, dictionary]) => {
    const values = Object.entries(dictionary)
      .filter(([key]) => key.startsWith(KEY_PREFIX))
      // `WR-05` — نصوصُ معنى مبلغِ الراكبِ وحدَها، بمفرداتِها وحدَها (ADR 0264).
      .map(([key, value]) => withoutRiderOfferTerms(key, value))
      .join(" ");
    return [`${TRANSLATION_FILES[language] ?? language}`, values] as const;
  });
  return {
    ...input.surface,
    [ROUTE_FILE]: input.route,
    [DOMAIN_FILE]: input.domain,
    [APPLICATION_FILE]: input.application,
    [STORE_FILE]: input.store,
    [FUNCTIONS_SQL_FILE]: input.functionsSql,
    ...Object.fromEntries(offerValues),
  };
}

/**
 * القاعدة ٣ — لا لفظَ مالٍ في الشريحةِ. والطبقةُ الماليّةُ **غائبةٌ بإعلانٍ**
 * (`ADR 0039` §٤ · `DEC-11` · `م13-7`): لا حقلَ أجرةٍ، ولا حقلاً قيمتُه `null`
 * اسمُه أجرةٌ — فذاكَ يُقرأُ «مجّاناً» أو «لم تُحسَبْ بعدُ»، وكِلاهما كذبٌ.
 */
export function moneyVocabularyProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, text] of Object.entries(sliceTexts(input))) {
    for (const token of MONEY_TOKENS) {
      if (mentions(text, token)) {
        problems.push(
          `${path}: يذكرُ «${token}» — والطبقةُ الماليّةُ غائبةٌ بإعلانٍ في هذا البندِ ` +
            `(ADR 0039 §4 · DEC-11)، فحقلٌ أو نصٌّ يُلوِّحُ بمالٍ يُقرأُ وعداً لا سندَ له.`,
        );
      }
    }
  }
  return problems;
}

/**
 * القاعدة ٤ — كاتبُ الإيكالِ واحدٌ. والذرّيّةُ **قائمةٌ في `claim_ride`** من
 * بندٍ سابقٍ: قفلٌ ثانٍ أو تحديثٌ ثانٍ لِـ`orders` ههنا يجعلُ لها كاتبَينِ،
 * وطلبٌ واحدٌ يُوكَلُ لسائقَينِ في سبقٍ لا يُقاسُ إلّا نادراً.
 */
export function singleWriterProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  // التعليقاتُ تُمحى ههنا أيضاً ولو مُحيَت في القارئِ: هذه القاعدةُ تمنعُ لفظاً
  // **يُشرَحُ غيابُه** في تعليقٍ («ولا `for update skip locked` ههنا»)، فلولا
  // المحوُ لَأسقطَ الشرحُ الصادقُ البناءَ.
  const sql = blankSqlComments(input.functionsSql).toLowerCase().replace(/\s+/g, " ");
  if (!sql.includes("claim_ride(")) {
    problems.push(
      `${FUNCTIONS_SQL_FILE}: لا نداءَ لِـ«claim_ride» — القبولُ يجبُ أن يُفوِّضَ الذرّيّةَ ` +
        `إلى مالكِها لا أن يُعيدَ بناءَها.`,
    );
  }
  for (const forbidden of ["for update", "skip locked", "update orders", "update order_offers"]) {
    if (sql.includes(forbidden)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: يحتوي «${forbidden}» — ذرّيّةٌ ثانيةٌ للإيكالِ، ` +
          `والكاتبُ الواحدُ شرطُ ألّا يُوكَلَ طلبٌ لسائقَينِ.`,
      );
    }
  }
  return problems;
}

/** القاعدة ٥ — نزعُ تنفيذٍ بالأدوارِ الثلاثةِ ومنحٌ لدورِ الخدمةِ لكلِّ دالّةٍ. */
export function grantProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.functionsSql.toLowerCase().replace(/\s+/g, " ");
  const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
  if (created.length === 0) {
    return [`${FUNCTIONS_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`];
  }
  for (const name of new Set(created)) {
    const revoked = sql.match(
      new RegExp(`revoke (?:all|execute) on function ${name}\\s*\\([^)]*\\) from ([^;]+);`),
    );
    if (revoked === null) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: «${name}» بلا نزعِ تنفيذٍ — و«public» يُمنَحُ التنفيذَ تلقائيّاً.`,
      );
    } else {
      const roles = revoked[1] ?? "";
      for (const role of REVOKED_ROLES) {
        if (!roles.includes(role)) {
          problems.push(
            `${FUNCTIONS_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
          );
        }
      }
    }
    const granted = new RegExp(
      `grant execute on function ${name}\\s*\\([^)]*\\) to ${GRANTED_ROLE}`,
    );
    if (!granted.test(sql)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: «${name}» بلا منحِ تنفيذٍ لِـ«${GRANTED_ROLE}» — ` +
          `دالّةٌ لا يُنفِّذُها أحدٌ تُسقِطُ المسارَ في الإنتاجِ وحدَه.`,
      );
    }
  }
  return problems;
}

/** مفاتيحُ الحمولةِ المنشورةُ من SQL — ما يُبنى بـ`jsonb_build_object`. */
export function publishedPayloadKeys(functionsSql: string): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const match of functionsSql.matchAll(/'([a-z_]+)'\s*,/g)) {
    const key = match[1];
    if (key !== undefined) keys.add(key);
  }
  return keys;
}

/**
 * القاعدة ٦ — صدقُ المؤقّتِ والمسافةِ. وهذه هيَ القاعدةُ التي تُسقِطُ CI إن
 * دخلَت ساعةُ جهازٍ في حكمٍ: `Date.now()` في نموذجِ العرضِ أو في النطاقِ يُخرِجُ
 * الحسابَ من القياسِ، ولحظةُ انتهاءٍ في شاشةٍ دعوةٌ إلى مقارنتِها بها.
 */
export function honestyProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  const sources: Record<string, string> = {
    ...input.surface,
    [DOMAIN_FILE]: input.domain,
  };
  for (const path of CLOCKLESS_FILES) {
    const source = sources[path];
    if (source === undefined) {
      problems.push(`${path}: غيرُ مقروءٍ — الحاجزُ لا يمرُّ بغيابِ مِلفٍّ.`);
      continue;
    }
    for (const clock of ["Date.now(", "new Date("]) {
      if (source.includes(clock)) {
        problems.push(
          `${path}: يقرأُ الساعةَ بـ«${clock}» — والمؤقّتُ حكمُ خادمٍ يُمرَّرُ وسيطاً، ` +
            `ودالّةٌ تقرأُ ساعةً لا تُقاسُ في اختبارٍ.`,
        );
      }
    }
  }
  for (const path of [...SCREEN_FILES, CONTRACT_FILE]) {
    const source = input.surface[path];
    if (source === undefined) {
      problems.push(`${path}: غيرُ مقروءٍ — الحاجزُ لا يمرُّ بغيابِ مِلفٍّ.`);
      continue;
    }
    for (const token of ["expiresAt", "expires_at"]) {
      if (source.includes(token)) {
        problems.push(
          `${path}: يذكرُ «${token}» — لحظةُ انتهاءٍ مُطلقةٌ في العميلِ تُقارَنُ بساعةِ ` +
            `الجهازِ، وانحرافُها يُخفي عرضاً صالحاً أو يُبقي منتهياً.`,
        );
      }
    }
  }
  if (input.route.includes("expires_at") || input.route.includes("expiresAt")) {
    problems.push(`${ROUTE_FILE}: يُنشِرُ لحظةَ الانتهاءِ — البوّابةُ تُنشِرُ الباقيَ ولحظةَ الخادمِ فقط.`);
  }
  const published = publishedPayloadKeys(input.functionsSql);
  for (const required of ["server_time", "seconds_left"]) {
    if (!published.has(required)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: لا يُنشِرُ «${required}» — بغيرِه يعدُّ العميلُ بساعتِه ` +
          `فيصيرُ عدُّه ظنّاً لا نقلاً.`,
      );
    }
  }
  for (const key of published) {
    if (!key.includes("distance")) continue;
    if (!TAGGED_DISTANCE_KEYS.includes(key)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: يُنشِرُ مفتاحَ مسافةٍ غيرَ مُعلَنٍ «${key}» — ` +
          `وكلُّ مسافةٍ منشورةٍ يجبُ أن تكونَ موسومةً في نوعِها (ADR 0024).`,
      );
    }
  }
  for (const key of TAGGED_DISTANCE_KEYS) {
    if (!published.has(key)) continue;
    for (const match of input.functionsSql.matchAll(new RegExp(`'${key}'`, "g"))) {
      const window = input.functionsSql.slice(match.index ?? 0, (match.index ?? 0) + 400);
      if (!/'kind'\s*,\s*'STRAIGHT_LINE'/.test(window)) {
        problems.push(
          `${FUNCTIONS_SQL_FILE}: «${key}» يُنشَرُ بلا وسمِ «STRAIGHT_LINE» — ` +
            `رقمٌ عارٍ يُقرأُ طولَ طريقٍ وهوَ خطٌّ مستقيمٌ.`,
        );
      }
    }
  }
  return problems;
}

/** جدولُ حالاتِ HTTP في مِلفِّ المساراتِ — رموزُه تُقرأُ نصّاً. */
export function statusTableCodes(route: string): ReadonlySet<string> {
  const block = route.match(/STATUS_BY_ERROR[^=]*=\s*\{([\s\S]*?)\n\};/);
  const codes = new Set<string>();
  if (block === null) return codes;
  for (const entry of (block[1] ?? "").matchAll(/([A-Z_]{3,})\s*:/g)) {
    const code = entry[1];
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

/** القاعدة ٧ — الجدولُ مُستوفٍ حرفاً في الاتّجاهَينِ. */
export function statusExhaustiveProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  const table = statusTableCodes(input.route);
  if (table.size === 0) {
    return [`${ROUTE_FILE}: لم يُقرأْ جدولُ «STATUS_BY_ERROR» — الحاجزُ لا يمرُّ بفراغٍ.`];
  }
  for (const code of input.publicErrorCodes) {
    if (!table.has(code)) {
      problems.push(
        `${ROUTE_FILE}: الرمزُ «${code}» بلا حالةِ HTTP — رفضٌ يُردُّ بحالةٍ خاطئةٍ ` +
          `يُعادُ إرسالُه في العميلِ أو يُصنَّفُ عطلَ خادمٍ.`,
      );
    }
  }
  for (const code of table) {
    if (!input.publicErrorCodes.includes(code)) {
      problems.push(
        `${ROUTE_FILE}: الرمزُ «${code}» في الجدولِ ولا يُصدِرُه التطبيقُ — مدخلٌ ميْتٌ ` +
          `يُخفي أنَّ رمزاً حقيقيّاً بلا حالةٍ.`,
      );
    }
  }
  return problems;
}

/**
 * القاعدة ٨ — لا هويّةَ راكبٍ. والعرضُ يذهبُ إلى **كلِّ سائقي الجولةِ** لا إلى
 * من ظفرَ بالطلبِ: فاسمُ الراكبِ أو هاتفُه في حمولتِه كشفٌ لمن لم يُوكَلْ إليه
 * شيءٌ، وجوابُ القبولِ نفسُه يُنقّى منه لأنَّ قناةَ الاتّصالِ بندٌ آخرُ.
 */
export function riderPrivacyProblems(input: DriverOffersContractInput): readonly string[] {
  const problems: string[] = [];
  const published = publishedPayloadKeys(input.functionsSql);
  for (const token of RIDER_IDENTITY_TOKENS) {
    if (published.has(token)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: يُنشِرُ «${token}» في حمولةِ عرضٍ — والعرضُ يذهبُ إلى ` +
          `كلِّ سائقي الجولةِ لا إلى من ظفرَ به.`,
      );
    }
  }
  const clientFiles: Record<string, string> = { ...input.surface, [ROUTE_FILE]: input.route };
  for (const [path, source] of Object.entries(clientFiles)) {
    for (const token of RIDER_IDENTITY_TOKENS) {
      if (mentions(source, token)) {
        problems.push(
          `${path}: يذكرُ «${token}» — هويّةُ الراكبِ ليست من عقدِ هذا السطحِ، ` +
            `وحقلٌ في العقدِ يُقرأُ إذناً بعرضِه.`,
        );
      }
    }
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — ثمانُ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function driverOffersContractProblems(input: DriverOffersContractInput): readonly string[] {
  return [
    ...keyParityProblems(input),
    ...errorTextProblems(input),
    ...moneyVocabularyProblems(input),
    ...singleWriterProblems(input),
    ...grantProblems(input),
    ...honestyProblems(input),
    ...statusExhaustiveProblems(input),
    ...riderPrivacyProblems(input),
  ];
}
