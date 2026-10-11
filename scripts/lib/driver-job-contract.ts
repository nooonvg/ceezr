/**
 * الغرض: قواعدُ عقدِ مَهمّةِ السائقِ النشطةِ — ثمانُ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-driver-job-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` (الأرباحُ) — قاعدةُ «كاتبٌ واحدٌ» وقاعدةُ
 *   «لا استنتاجَ طَورٍ من قُربٍ» عينُهما، ويُزادُ مِلفُّها بلا قاعدةٍ جديدةٍ.
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ حاجزٌ على مَهمّةِ سائقٍ
 *
 * لأنَّ خمسةَ أعطابٍ ههنا **لا يُمسِكُها اختبارٌ أخضرُ**:
 *
 *   ــ **طَورٌ يُستنتَجُ من قُربٍ**: «إن كانَ على مئةِ مترٍ فقد وصلَ» يمرُّ في كلِّ
 *      اختبارٍ ببياناتٍ مُرتَّبةٍ، ثمَّ يَختِمُ وصولاً لسائقٍ مرَّ بالشارعِ ولم
 *      يقفْ — والراكبُ يُحاسَبُ على انتظارٍ لم يبدأْ (`ADR 0118`).
 *   ــ **كاتبٌ ثانٍ للانتقالِ**: `update orders set status` في هذه الشريحةِ يجعلُ
 *      لبدءِ الرحلةِ كاتبَينِ، فينحرفُ سجلُّ التدقيقِ عن الحالةِ ولا يُقاسُ ذاكَ
 *      إلّا بسبقٍ نادرٍ في الإنتاجِ.
 *   ــ **كاتبانِ لِـ`arrived_at`**: ختمٌ يُكتَبُ في موضعَينِ يُكتَبُ مرّتَينِ،
 *      و«ألا يُكتَبَ مرّتَينِ» شرطُ أن يُقرأَ الختمُ حقيقةً لا آخرَ من كتبَه.
 *   ــ **هويّةُ راكبٍ تُنشَرُ**: الهاتفُ ومعرِّفُ تلغرامَ ليسا من عقدِ هذا السطحِ،
 *      وحقلٌ في العقدِ يُقرأُ إذناً بعرضِه ثمَّ باستعمالِه.
 *   ــ **شاشةٌ تُعيدُ بناءَ آلةِ الحالاتِ**: زرٌّ يُختارُ بمقارنةِ `status` في
 *      العميلِ يتقادَمُ حينَ يُزادُ طَورٌ في القاعدةِ، فيُعرَضُ «ابدأِ الرحلةَ»
 *      على مَهمّةٍ لم يُختَم وصولُها.
 *
 * ## القواعدُ التسعُ
 *
 *   ١. **مفاتيحُ النصِّ ثلاثةٌ متطابقةٌ**، وكلُّ مُنادًى أو مبنيٍّ بقالبٍ موجودٌ.
 *   ٢. **كلُّ رمزٍ عامٍّ له نصُّه** في الثلاثةِ، والسطحُ يعرفُ الرموزَ **حرفاً**
 *      لا زيادةَ ولا نقصاً.
 *   ٣. **لا لفظَ مالٍ في الشريحةِ كلِّها** (`ADR 0039` §٤ · `DEC-11` · `م13-7`).
 *   ٤. **كاتبٌ واحدٌ لكلِّ انتقالٍ**: تفويضٌ إلى `start_ride`/`complete_ride`،
 *      ولا `set status` في هذه الهجرةِ، و`arrived_at` يُكتَبُ في موضعٍ واحدٍ.
 *   ٥. **نزعُ تنفيذٍ ومنحُه** لكلِّ دالّةٍ، بالأدوارِ الثلاثةِ مُسمّاةً.
 *   ٦. **لا استنتاجَ طَورٍ ولا ساعةَ جهازٍ**: لا مسافةَ ولا قُربَ في هذه الشريحةِ،
 *      ولا ساعةَ في النطاقِ ولا في نموذجِ العرضِ، والخادمُ يُنشِرُ `server_time`
 *      و`next_action`.
 *   ٧. **جدولُ الحالاتِ مُستوفٍ حرفاً** في الاتّجاهَينِ.
 *   ٨. **هويّةُ الراكبِ محدودةٌ بإعلانٍ**: الاسمُ الأوّلُ واللغةُ فحسب، ولا هاتفَ
 *      ولا معرِّفَ تلغرامَ ولا اسمَ كامِلاً في حمولةٍ ولا في مِلفِّ عميلٍ.
 *   ٩. **مُضيفُ الملاحةِ في الخادمِ وحدَه**: لا عنوانَ مطلقاً في شيفرةِ السطحِ،
 *      والبوّابةُ تُنشِرُ `navigation_url` والشاشةُ تفتحُ ما أُعطِيَت (`F1-10` ·
 *      `TG-005`) — فلا يُوسَّعُ `script-src` لِمُضيفٍ لا شيفرةَ منه.
 *
 * ## وما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ (`ح-5`)
 *
 * - **لا يُثبِتُ ذرّيّةَ `start_ride` ولا `complete_ride`**: تلكَ مقيسةٌ في
 *   اختباراتِ تكاملٍ سابقةٍ لهذا البندِ، وهذا الحاجزُ يمنعُ **كاتباً ثانياً**
 *   ويفرضُ التفويضَ فحسب. والحاجزُ الذي يدَّعي أكثرَ من قياسِه أخطرُ من غيابِه.
 * - **لا يقيسُ صدقَ الختمِ في الميدانِ**: أنَّ السائقَ يضغطُ «وصلتُ» حينَ يصلُ
 *   حقّاً **ليسَ مقيساً** ولا يُدَّعى؛ ما يُفرَضُ ههنا أنَّ النظامَ لا يخترعُ
 *   الختمَ عنه.
 * - **لا يمنعُ زرّاً ثانياً في الشاشةِ بالعينِ**: يمنعُ **مصدرَ الاختيارِ
 *   المحليَّ** (مقارنةَ حالةٍ في العميلِ)، وأنَّ المعروضَ زرٌّ واحدٌ يُقاسُ في
 *   اختبارِ الشاشةِ لا ههنا.
 * - **لا يحكمُ في الشكلِ**: تغطيةُ الأنماطِ حاجزٌ آخرُ.
 * - **لا يقرأُ لفظاً في تعليقٍ ولا في `comment on`**: يُغذَّى بشِفرةٍ منزوعةِ
 *   التعليقاتِ، **ووصفُ الكائنِ في القاعدةِ (`comment on … is '…'`) نثرٌ حكمُه حكمُ
 *   التعليقِ** فيُفرَّغُ كذلك: وإلّا لَسقطَ الحاجزُ على وصفٍ يُعلِّلُ **غيابَ**
 *   الأجرةِ أو **نفيَ** الاستنتاجِ من قُربٍ — وذاكَ عينُ ما نريدُ كتابتَه. والوصفُ
 *   لا يُنفِّذُ سلوكاً، فتفريغُه لا يُفلِتُ مخالفةً.
 */

import { blankSqlComments } from "./blank-comments.ts";
import { withoutRiderOfferTerms } from "./rider-offer-terms.ts";

/** مِلفّاتُ سطحِ المَهمّةِ في التطبيقِ المصغَّرِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/job/JobScreen.tsx",
  "apps/miniapp/src/surfaces/driver/job/job-view.ts",
  "apps/miniapp/src/surfaces/driver/job/job-api.ts",
  "apps/miniapp/src/surfaces/driver/job/job-contract.ts",
];

/** الشاشةُ وحدَها — القاعدة ٦ تمنعُ فيها اختيارَ الطَورِ محلّيّاً. */
export const SCREEN_FILE = "apps/miniapp/src/surfaces/driver/job/JobScreen.tsx";

/** ما لا ساعةَ فيه ألبتّةَ — نموذجُ العرضِ والنطاقُ. */
export const CLOCKLESS_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/driver/job/job-view.ts",
  "packages/domain/driver/driver-job.ts",
];

export const VIEW_FILE = "apps/miniapp/src/surfaces/driver/job/job-view.ts";
export const CONTRACT_FILE = "apps/miniapp/src/surfaces/driver/job/job-contract.ts";
export const ROUTE_FILE = "apps/gateway/src/routes/driver-job.ts";
export const DOMAIN_FILE = "packages/domain/driver/driver-job.ts";
export const APPLICATION_FILE = "packages/application/driver/driver-job.ts";
export const STORE_FILE = "packages/infrastructure/driver/driver-job-store.ts";
export const FUNCTIONS_SQL_FILE = "supabase/migrations/20260915030000_f3_03_driver_active_job.sql";

export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "driver.job.";

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/** الدورُ الوحيدُ الذي يُنفِّذُ: بوّابتُنا وحدَها تحملُه. */
export const GRANTED_ROLE = "service_role";

/**
 * ألفاظُ المالِ الممنوعةُ في الشريحةِ — كلٌّ منها لا يحتملُ في هذا السياقِ إلّا
 * معنى المالِ، فسقوطُ الحاجزِ عليه سقوطٌ صادقٌ.
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

/**
 * ما لا يُنشَرُ عن الراكبِ ألبتّةَ. **والاسمُ الأوّلُ واللغةُ ليسا ههنا عن قصدٍ**:
 * السائقُ الذي أُوكِلَ إليه الطلبُ يُنادي راكبَه باسمِه ويُخاطِبُه بلغتِه، وذاكَ
 * حدٌّ **مُعلَنٌ** في العقدِ (خلافاً لسطحِ العروضِ حيثُ لا هويّةَ ألبتّةَ، لأنَّ
 * العرضَ يذهبُ إلى كلِّ سائقي الجولةِ لا إلى من ظفرَ به).
 */
export const RIDER_IDENTITY_TOKENS: readonly string[] = [
  "phone",
  "full_name",
  "fullName",
  "telegram_id",
  "telegramId",
  "telegram_username",
  "rider_id",
  "riderId",
];

/**
 * ألفاظُ القُربِ والمسافةِ — ممنوعةٌ في هذه الشريحةِ كلِّها. والطَورُ **ختمُ
 * إنسانٍ** (`ADR 0118`): حسابُ مسافةٍ ههنا لا معنى له إلّا أن يصيرَ شرطاً أو
 * إيحاءً، ولو كانَ عرضاً محضاً لَصارَ غداً شرطاً بسطرٍ واحدٍ.
 */
export const PROXIMITY_TOKENS: readonly string[] = [
  "st_distance",
  "st_dwithin",
  "geography(",
  "distance",
  "radius",
  "meters",
  "قُرب",
  "نصف قطر",
];

/**
 * الأطوارُ الثلاثةُ كما تُنشَرُ. **مكتوبةً ههنا** كي يسقطَ الحاجزُ إن زادَ طَورٌ
 * في القاعدةِ ولم يُزَد له نصٌّ ولا زرٌّ — لا أن يُقرأَ سائقٌ رمزاً خاماً.
 */
export const JOB_ACTIONS: readonly string[] = ["MARK_ARRIVED", "START_RIDE", "COMPLETE_RIDE"];

/**
 * المفاتيحُ التي تُبنى بقالبٍ في نموذجِ العرضِ أو تُقرأُ من خريطةٍ — تُكتَبُ ههنا
 * كي تُفحَصَ، فقالبٌ لا يُقرأُ نصّاً يُخفي مفتاحاً بلا نصٍّ حتّى يراهُ سائقٌ.
 */
export const TEMPLATED_KEYS: readonly string[] = [
  "driver.job.service.transport",
  "driver.job.service.delivery",
  "driver.job.status.matched",
  "driver.job.status.in_progress",
  ...JOB_ACTIONS.map((action) => `driver.job.action.${action}`),
  ...JOB_ACTIONS.map((action) => `driver.job.done.${action}`),
  "driver.job.phase.toPickup",
  "driver.job.phase.atPickup",
  "driver.job.phase.onTrip",
];

export interface DriverJobContractInput {
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
 * يُفرِّغُ نصَّ `comment on … is '…'` مع إبقاءِ الأطوالِ وعددِ الأسطرِ — لأنَّه نثرٌ
 * توثيقيٌّ لا سلوكٌ، وهوَ الموضعُ الذي يُعلَّلُ فيه **غيابُ** الملفوظِ الممنوعِ.
 */
export function blankSqlObjectComments(sql: string): string {
  return sql.replace(
    /(comment\s+on\s+[^;']*?\bis\s+')([^']*)(')/gi,
    (_whole, head: string, body: string, tail: string) =>
      `${head}${body.replace(/[^\n]/g, " ")}${tail}`,
  );
}

/**
 * ذِكرٌ **بحدودِ الكلمةِ** للّاتينيّةِ واحتواءٌ لغيرِها: «price» لا تُقرأُ في
 * «priceless»، والعربيّةُ لا حدودَ حروفٍ لها بهذا المعنى فتُقرأُ احتواءً.
 */
export function mentions(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return lower.includes(needle);
  return new RegExp(`(?<![a-z_])${needle}(?![a-z_])`).test(lower);
}

/** يستخرجُ مفاتيحَ النصِّ المُنادَاةَ حرفيّاً من السطحِ. */
export function usedTextKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"((?:driver|rider)\.[A-Za-z0-9._]+)"/g;
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined && !key.endsWith(".")) keys.add(key);
    }
  }
  return keys;
}

function requireKeys(
  input: DriverJobContractInput,
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

/** القاعدة ١ — تطابقُ المفاتيحِ في الثلاثةِ، وكلُّ مُنادًى ومبنيٍّ موجودٌ. */
export function keyParityProblems(input: DriverJobContractInput): readonly string[] {
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

/** القاعدة ٢ — نصٌّ لكلِّ رمزٍ منشورٍ، والسطحُ يعرفُ الرموزَ حرفاً. */
export function errorTextProblems(input: DriverJobContractInput): readonly string[] {
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
  const known = knownErrorCodesInSurface(input.surface);
  for (const code of known) {
    if (!published.has(code)) {
      problems.push(
        `job-view.ts: الرمزُ «${code}» يُصنَّفُ معروفاً ولا يُصدِرُه التطبيقُ — ` +
          `نصٌّ لا يُعرَضُ أبداً يُخفي أنَّ رمزاً حقيقيّاً بلا نصٍّ.`,
      );
    }
  }
  for (const code of published) {
    if (!known.has(code)) {
      problems.push(
        `job-view.ts: الرمزُ «${code}» يُصدِرُه التطبيقُ ولا يعرفُه السطحُ — ` +
          `فيُعرَضُ نصُّ «UNKNOWN» عن رفضٍ له سببٌ مُسمّىً.`,
      );
    }
  }
  return problems;
}

/** كلُّ نصوصِ الشريحةِ في خريطةٍ واحدةٍ — للقواعدِ التي تقرأُ الشريحةَ كلَّها. */
function sliceTexts(input: DriverJobContractInput): Readonly<Record<string, string>> {
  const jobValues = Object.entries(input.translations).map(([language, dictionary]) => {
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
    [FUNCTIONS_SQL_FILE]: blankSqlObjectComments(input.functionsSql),
    ...Object.fromEntries(jobValues),
  };
}

/** القاعدة ٣ — لا لفظَ مالٍ في الشريحةِ (`ADR 0039` §٤ · `DEC-11` · `م13-7`). */
export function moneyVocabularyProblems(input: DriverJobContractInput): readonly string[] {
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
 * القاعدة ٤ — كاتبٌ واحدٌ لكلِّ انتقالٍ. والبدءُ والإنهاءُ لهما كاتبانِ قائمانِ
 * (`start_ride` · `complete_ride`)، فهذه الهجرةُ **تُفوِّضُ إليهما** ولا تُعيدُ
 * بناءَ الذرّيّةِ؛ و`arrived_at` ختمٌ جديدٌ فكاتبُه واحدٌ لا يزيدُ.
 */
export function singleWriterProblems(input: DriverJobContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = blankSqlComments(input.functionsSql).toLowerCase().replace(/\s+/g, " ");
  for (const delegate of ["start_ride", "complete_ride"]) {
    // النداءُ يُقرأُ **غيرَ مسبوقٍ بـ`driver_`** كي لا يُقرأَ تعريفُ الغلافِ نفسِه
    // (`driver_start_ride`) تفويضاً إلى الكاتبِ القائمِ — وذاكَ عينُ ما لا نريدُ.
    if (!new RegExp(`(?<!driver_)${delegate}\\s*\\(`).test(sql)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: لا نداءَ لِـ«${delegate}» — الانتقالُ يجبُ أن ` +
          `يُفوِّضَ الذرّيّةَ إلى كاتبِها القائمِ لا أن يُعيدَ بناءَها.`,
      );
    }
  }
  for (const forbidden of ["set status", "update order_offers", "update driver_availability"]) {
    if (sql.includes(forbidden)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: يحتوي «${forbidden}» — كاتبٌ ثانٍ لانتقالٍ له كاتبٌ، ` +
          `والحالةُ تنحرفُ عن سجلِّ التدقيقِ في سبقٍ لا يُقاسُ إلّا نادراً.`,
      );
    }
  }
  const arrivalWrites = [...sql.matchAll(/set arrived_at/g)].length;
  if (arrivalWrites === 0) {
    problems.push(`${FUNCTIONS_SQL_FILE}: لا كاتبَ لِـ«arrived_at» — عمودٌ بلا كاتبٍ يبقى فارغاً أبداً.`);
  } else if (arrivalWrites > 1) {
    problems.push(
      `${FUNCTIONS_SQL_FILE}: «arrived_at» يُكتَبُ في ${arrivalWrites} موضعاً — ` +
        `وختمٌ لهُ كاتبانِ يُكتَبُ مرّتَينِ فلا يُقرأُ منهُ أوّلُ وصولٍ.`,
    );
  }
  return problems;
}

/** القاعدة ٥ — نزعُ تنفيذٍ بالأدوارِ الثلاثةِ ومنحٌ لدورِ الخدمةِ لكلِّ دالّةٍ. */
export function grantProblems(input: DriverJobContractInput): readonly string[] {
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
 * القاعدة ٦ — لا استنتاجَ طَورٍ ولا ساعةَ جهازٍ. وهذه القاعدةُ حاكمُ البندِ
 * (`ADR 0118`): الوصولُ ختمُ إنسانٍ، فلا مسافةَ في هذه الشريحةِ ألبتّةَ — لا
 * شرطاً ولا عرضاً — ولا مقارنةَ حالةٍ في العميلِ تختارُ زرّاً.
 */
export function phaseHonestyProblems(input: DriverJobContractInput): readonly string[] {
  const problems: string[] = [];
  const sources: Record<string, string> = { ...input.surface, [DOMAIN_FILE]: input.domain };
  for (const path of CLOCKLESS_FILES) {
    const source = sources[path];
    if (source === undefined) {
      problems.push(`${path}: غيرُ مقروءٍ — الحاجزُ لا يمرُّ بغيابِ مِلفٍّ.`);
      continue;
    }
    for (const clock of ["Date.now(", "new Date("]) {
      if (source.includes(clock)) {
        problems.push(
          `${path}: يقرأُ الساعةَ بـ«${clock}» — ولحظةُ الخادمِ تُمرَّرُ وسيطاً، ` +
            `ودالّةٌ تقرأُ ساعةً لا تُقاسُ في اختبارٍ.`,
        );
      }
    }
  }
  for (const [path, text] of Object.entries(sliceTexts(input))) {
    for (const token of PROXIMITY_TOKENS) {
      if (mentions(text, token)) {
        problems.push(
          `${path}: يذكرُ «${token}» — والطَورُ ختمُ إنسانٍ لا استنتاجٌ من قُربٍ ` +
            `(ADR 0118)، وحسابُ مسافةٍ ههنا يصيرُ غداً شرطاً بسطرٍ واحدٍ.`,
        );
      }
    }
  }
  const screen = input.surface[SCREEN_FILE];
  if (screen === undefined) {
    problems.push(`${SCREEN_FILE}: غيرُ مقروءٍ — الحاجزُ لا يمرُّ بغيابِ مِلفٍّ.`);
  } else {
    for (const literal of ['"matched"', '"in_progress"']) {
      if (screen.includes(literal)) {
        problems.push(
          `${SCREEN_FILE}: يقارِنُ الحالةَ بـ${literal} — والزرُّ يُشتَقُّ من ` +
            `«next_action» وحدَه، وآلةُ حالاتٍ ثانيةٌ في العميلِ تتقادَمُ عندَ أوّلِ طَورٍ يُزادُ.`,
        );
      }
    }
    if (!screen.includes("next_action") && !screen.includes("action")) {
      problems.push(`${SCREEN_FILE}: لا يقرأُ «next_action» — شاشةٌ لا تقرأُ حكمَ الخادمِ تحكمُ بنفسِها.`);
    }
  }
  const published = publishedPayloadKeys(input.functionsSql);
  for (const required of ["server_time", "next_action"]) {
    if (!published.has(required)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: لا يُنشِرُ «${required}» — وبغيرِه يستنبطُ العميلُ الطَورَ ` +
          `أو الزمنَ من عندِه، وذاكَ عينُ ما يمنعُه ADR 0118.`,
      );
    }
  }
  return problems;
}

/** جدولُ حالاتِ HTTP في مِلفِّ المساراتِ — رموزُه تُقرأُ نصّاً. */
export function statusTableCodes(route: string): ReadonlySet<string> {
  const block = route.match(/STATUS_BY_ERROR[^=]*=\s*\{([\s\S]*?)\n\s*\};/);
  const codes = new Set<string>();
  if (block === null) return codes;
  for (const entry of (block[1] ?? "").matchAll(/([A-Z_]{3,})\s*:/g)) {
    const code = entry[1];
    if (code !== undefined) codes.add(code);
  }
  return codes;
}

/** القاعدة ٧ — الجدولُ مُستوفٍ حرفاً في الاتّجاهَينِ. */
export function statusExhaustiveProblems(input: DriverJobContractInput): readonly string[] {
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
 * القاعدة ٨ — هويّةُ الراكبِ محدودةٌ بإعلانٍ. والمَهمّةُ **مُوكَلةٌ** فيجوزُ فيها
 * اسمٌ أوّلُ ولغةٌ يُخاطَبُ بهما؛ وما سوى ذاكَ — هاتفٌ أو معرِّفُ تلغرامَ أو اسمٌ
 * كامِلٌ — ليسَ من عقدِ هذا السطحِ، وحقلٌ في العقدِ يُقرأُ إذناً بعرضِه.
 */
export function riderPrivacyProblems(input: DriverJobContractInput): readonly string[] {
  const problems: string[] = [];
  const published = publishedPayloadKeys(input.functionsSql);
  for (const token of RIDER_IDENTITY_TOKENS) {
    if (published.has(token)) {
      problems.push(
        `${FUNCTIONS_SQL_FILE}: يُنشِرُ «${token}» في حمولةِ مَهمّةٍ — والمسموحُ ` +
          `بإعلانٍ اسمٌ أوّلُ ولغةٌ فحسب.`,
      );
    }
  }
  const clientFiles: Record<string, string> = { ...input.surface, [ROUTE_FILE]: input.route };
  for (const [path, source] of Object.entries(clientFiles)) {
    for (const token of RIDER_IDENTITY_TOKENS) {
      if (mentions(source, token)) {
        problems.push(
          `${path}: يذكرُ «${token}» — ليسَ من عقدِ هذا السطحِ، وحقلٌ في العقدِ ` +
            `يُقرأُ إذناً بعرضِه ثمَّ باستعمالِه.`,
        );
      }
    }
  }
  return problems;
}

/**
 * القاعدة ٩ — **مُضيفُ الملاحةِ في الخادمِ وحدَه**، والشاشةُ تفتحُ ما أُعطِيَت.
 *
 * ولِمَ حاجزٌ: `F1-10` و`TG-005` يقصُرانِ كلَّ عنوانٍ مطلقٍ في حزمةِ المصغَّرِ على
 * قائمةٍ مغلقةٍ لأصلٍ تنفيذيٍّ. ورابطُ ملاحةٍ ليسَ أصلاً تنفيذيّاً، وتوسيعُ القائمةِ
 * لأجلِه يُوسِّعُ `script-src` لِمُضيفٍ لا نُشغِّلُ منه شيفرةً — فإضعافُ الحاجزِ
 * **ليسَ الحلَّ**، والحلُّ أن يُنشَرَ الرابطُ من البوّابةِ حيثُ يُقرأُ في سجلِّ
 * المخارجِ. وهذه القاعدةُ تمنعُ الرجعةَ: فسطرٌ واحدٌ يُريدُ أن يُركِّبَ
 * العنوانَ في العميلِ يُسقِطُ البناءَ في `check-single-origin-assets` بعدَ البناءِ
 * وحدَه، وههنا يُسقَطُ **قبلَه وبسببٍ مقروءٍ**.
 */
export function navigationOriginProblems(input: DriverJobContractInput): readonly string[] {
  const problems: string[] = [];
  const absolute = /https?:\/\/[^\s"'`)]+/g;
  for (const [path, source] of Object.entries(input.surface)) {
    for (const match of source.matchAll(absolute)) {
      problems.push(
        `${path}: يحملُ عنواناً مطلقاً «${match[0]}» — وحزمةُ المصغَّرِ لا تبني مُضيفاً ` +
          `ثالثاً (F1-10 · TG-005): الرابطُ يُنشَرُ من البوّابةِ ويُقرأُ في سجلِّ المخارجِ.`,
      );
    }
  }
  const contract = input.surface[CONTRACT_FILE];
  if (contract !== undefined && !contract.includes("navigation_url")) {
    problems.push(
      `${CONTRACT_FILE}: لا يقرأُ «navigation_url» — وإن لم يُعطَ الرابطُ رجعَ العميلُ ` +
        `يُركِّبُه من عندِه عندَ أوّلِ حاجةٍ.`,
    );
  }
  if (!input.route.includes("navigation_url")) {
    problems.push(`${ROUTE_FILE}: لا يُنشِرُ «navigation_url» — ومَن لا يُعطَ رابطاً يبنيه.`);
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — تسعُ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function driverJobContractProblems(input: DriverJobContractInput): readonly string[] {
  return [
    ...keyParityProblems(input),
    ...errorTextProblems(input),
    ...moneyVocabularyProblems(input),
    ...singleWriterProblems(input),
    ...grantProblems(input),
    ...phaseHonestyProblems(input),
    ...statusExhaustiveProblems(input),
    ...riderPrivacyProblems(input),
    ...navigationOriginProblems(input),
  ];
}
