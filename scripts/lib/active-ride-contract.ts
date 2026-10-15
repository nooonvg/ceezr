/**
 * الغرض: قواعدُ عقدِ شاشةِ الرحلةِ النشطةِ — خمسُ قواعدَ تُقاسُ على نصِّ
 *   المستودعِ لا على نيّةِ كاتبِه (البند `F2-06` · الحاجز `UX-022`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-06`.
 * ينتمي إلى: scripts/lib
 * يُستخدم من: `scripts/check-active-ride-contract.ts` و`tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `F2-07` (الإنهاءُ والتقييمُ) و`F2-09` و`F2-10`
 *   حينَ تُبنى مساراتُ المشاركةِ والطوارئِ فتُنقَلُ كلماتُها من المحظورِ إلى
 *   المسموحِ **بتعديلِ هذا المِلفِّ معَ مسارِها** لا بإسكاتِ الحاجزِ.
 *
 * ## لماذا حاجزٌ على شاشةٍ واحدةٍ
 *
 * هذه الشاشةُ هيَ الموضعُ الذي **يُغري** بالكذبِ الصغيرِ: سعرٌ «تقديريٌّ»
 * يُطمئِنُ، ونقطةٌ على خريطةٍ بلا عُمرٍ تبدو حيّةً، وزرُّ طوارئَ يُشعِرُ بالأمانِ
 * ولو لم يكنْ موصولاً. وكلُّ واحدةٍ من هذه تُكتَبُ بحسنِ نيّةٍ في سطرٍ واحدٍ،
 * ولا تُكتشَفُ في مراجعةٍ بشريّةٍ إلّا بحظٍّ. فالقواعدُ الخمسُ مكتوبةٌ ههنا
 * ومقيسةٌ في CI، ونقضُها **يُسقِطُ البناءَ** لا يُسجَّلُ ملاحظةً.
 *
 * ## القواعدُ الخمسُ
 *
 *   ١. **لا مالَ**: لا سعرَ ولا أجرةَ ولا عقوبةَ إلغاءٍ في شِفرةِ السطحِ ولا في
 *      مفاتيحِه ولا في نصوصِه الثلاثةِ (`ADR 0039` §٤ · `DEC-11` · `م13-7`).
 *      وحتّى بنيةٌ فارغةٌ للسعرِ محظورةٌ: حقلٌ فارغٌ اليومَ يُملأُ غداً بلا قرارٍ.
 *   ٢. **لا سائقَ بلا إسنادٍ**: لقطةُ القاعدةِ لا تبنيَ كتلةَ السائقِ إلّا داخلَ
 *      شرطٍ يفحصُ `assigned_driver_id`، والحقلُ **قابلٌ للعدمِ** في العقدِ
 *      والمنفذِ، والشاشةُ تفحصُ عدمَه صراحةً قبلَ رسمِه.
 *   ٣. **لا موضعَ بلا عُمرِه**: كلُّ طبقةٍ تنشرُ إحداثيّةً تنشرُ عُمرَها معَها —
 *      القاعدةُ والعقدُ والشاشةُ والقواميسُ (`BUG-001`).
 *   ٤. **مفاتيحُ ثلاثةٌ متطابقةٌ**: مجموعةُ مفاتيحِ `rider.active.` واحدةٌ في
 *      `ar` و`en` و`ur`، وكلُّ مفتاحٍ يُنادى في السطحِ موجودٌ في الثلاثةِ.
 *   ٥. **لا زرَّ لمسارٍ لم يُبنَ**: لا طوارئَ ولا مشاركةَ ولا اتّصالَ في هذا
 *      السطحِ — مساراتُها `F2-10` و`F2-09`، وزرٌّ لا يفعلُ شيئاً في لحظةِ خطرٍ
 *      أسوأُ من غيابِه.
 *
 * ## ما لا يفعلُه عن قصدٍ — وحدودُه مُعلَنةٌ
 *
 * - **لا يُثبِتُ أنَّ الشاشةَ صادقةٌ عندَ راكبٍ حقيقيٍّ**: يُثبِتُ غيابَ خمسِ
 *   كذباتٍ مُسمَّاةٍ. والتجربةُ الميدانيّةُ بوّابةُ `F2` ولا يُدّعى بلوغُها.
 * - **لا يقرأُ دلالةَ الشِّفرةِ**: يقرأُ نصّاً وعلاماتٍ مُعلَنةً. فمن أرادَ
 *   الاحتيالَ عليه قدرَ، ومن أرادَ الصدقَ لم يُخطئْ سهواً — وذاكَ غرضُه.
 * - **لا يحكمُ في الشكلِ ولا في الوصولِيّةِ**: التغطيةُ النمطيّةُ حاجزُ `UX-021`،
 *   والتباينُ والقارئُ غيرُ مقيسَينِ بعدُ (دَينٌ مُعلَنٌ).
 */

import { withoutRiderOfferTerms } from "./rider-offer-terms.ts";

/** مِلفّاتُ السطحِ المقروءةُ — مكتوبةً لا مُكتشَفةً، فزيادةُ مِلفٍّ تُزادُ ههنا. */
export const SURFACE_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/active/ActiveRideScreen.tsx",
  "apps/miniapp/src/surfaces/rider/active/active-ride-view.ts",
  "apps/miniapp/src/surfaces/rider/active/active-ride-api.ts",
  "apps/miniapp/src/surfaces/rider/active/active-ride-contract.ts",
  // `ADR 0286` — لوحةُ تفاوضِ القروبِ داخلَ الرحلةِ النشطةِ: قرارُ الراكبِ من
  // التطبيقِ لا من محادثةِ البوتِ.
  "apps/miniapp/src/surfaces/rider/active/NegotiationPanel.tsx",
  "apps/miniapp/src/surfaces/rider/active/negotiation-api.ts",
];

export const SNAPSHOT_SQL_FILE =
  "supabase/migrations/20260913235000_f2_06_active_ride_snapshot.sql";
export const PORTS_FILE = "packages/application/transport/active-ride-ports.ts";
export const CONTRACT_FILE = "apps/miniapp/src/surfaces/rider/active/active-ride-contract.ts";
export const SCREEN_FILE = "apps/miniapp/src/surfaces/rider/active/ActiveRideScreen.tsx";
export const TRANSLATION_FILES: Readonly<Record<string, string>> = {
  ar: "packages/shared/i18n/miniapp/ar.json",
  en: "packages/shared/i18n/miniapp/en.json",
  ur: "packages/shared/i18n/miniapp/ur.json",
};

/** بادئةُ مفاتيحِ هذا السطحِ. */
export const KEY_PREFIX = "rider.active.";

/**
 * معجمُ المالِ — إنجليزيّاً وعربيّاً. وكلمةُ «مجّاناً» ليسَت ههنا: نفيُ المالِ
 * ليسَ مالاً، و«الإلغاءُ مجّانيٌّ قبلَ الإسنادِ» حكمٌ إجرائيٌّ لا سعرٌ… إلّا أنَّ
 * صياغتَنا اختارَت «يمكنُك الإلغاءُ الآنَ» فلا تحتاجُ الكلمةَ أصلاً.
 */
export const MONEY_TOKENS: readonly string[] = [
  "fare",
  "price",
  "pricing",
  "amount",
  "payment",
  "payout",
  "invoice",
  "receipt",
  "penalty",
  "refund",
  "wallet",
  "currency",
  "sar",
  "riyal",
  "سعر",
  "السعر",
  "أجرة",
  "الأجرة",
  "تسعير",
  "دفع",
  "الدفع",
  "مبلغ",
  "المبلغ",
  "رسم",
  "رسوم",
  "غرامة",
  "عقوبة",
  "ريال",
  "محفظة",
  "فاتورة",
];

/** معجمُ المساراتِ التي لم تُبنَ — زرٌّ لها اليومَ زرٌّ كاذبٌ. */
export const UNBUILT_PATH_TOKENS: readonly string[] = [
  "whatsapp",
  "tel:",
  "callDriver",
  "اتصل",
  "اتّصل",
];

/**
 * ## إضافةُ البند `F2-09` (2026-09-14) — **نقلٌ لا حذفٌ**
 *
 * ثلاثةُ رموزٍ (`share` · «مشاركة» · «شارك») كانت في `UNBUILT_PATH_TOKENS`
 * أعلاه، ونُقِلَت إلى ههنا لأنَّ مسارَها **بُنِيَ** (`F2-09`): رأسُ هذا المِلفِّ
 * أذِنَ بهذا النقلِ حرفاً يومَ كُتِبَ، وشرطُه أن يكونَ **معَ مسارِها** لا
 * إسكاتاً للحاجزِ. ولا سطرَ حُذِفَ (القاعدة ح-2): الرموزُ انتقلَت ولم تُمحَ،
 * وحراستُها انقلبَت ولم تسقطْ.
 *
 * وحراستُها الآنَ عكسيّةٌ من وجهَينِ:
 *   ــ **مفاتيحُ `rider.active.` ما زالت ممنوعةً منها**: نصُّ المشاركةِ مِلكُ
 *      `rider.share.`، ولو تسرَّبَ إلى مفاتيحِ اللقطةِ لَصارَ للمعنى الواحدِ
 *      نصّانِ يفترقانِ (القاعدة 0.6).
 *   ــ **والشاشةُ يجبُ أن تُركِّبَ البطاقةَ فعلاً**: القاعدةُ ٧ أدناه. فمَن حذفَ
 *      التركيبَ يوماً سقطَ بناؤُه، ولا يمرُّ الحذفُ صامتاً كما يمرُّ عادةً.
 */
export const BUILT_PATH_TOKENS: readonly string[] = ["share", "مشاركة", "شارك"];

/**
 * ## إضافةُ البند `F2-10` (2026-09-14) — **نقلٌ لا حذفٌ، وقائمةٌ ثانيةٌ لا خلطٌ**
 *
 * خمسةُ رموزٍ (`sos` · `emergency` · `panic` · «طوارئ» · «استغاثة») كانت في
 * `UNBUILT_PATH_TOKENS` أعلاه، ونُقِلَت إلى ههنا لأنَّ مسارَها **بُنِيَ**
 * (`F2-10`): قاعدةً (`sos_surface_state` · `trigger_sos` بنافذةِ ما بعدَ
 * الرحلةِ) ومنفذاً ومساراً وبطاقةً. ولا سطرَ حُذِفَ (القاعدة ح-2): الرموزُ
 * انتقلَت ولم تُمحَ، وحراستُها انقلبَت ولم تسقطْ.
 *
 * **وثلاثةٌ بقيَت ممنوعةً حيثُ كانت**: `whatsapp` و`tel:` و`callDriver`
 * و«اتصل» و«اتّصل». وهذا ليسَ سهواً: `SR-06` يطلبُ **اتّصالاً** معَ الطوارئِ،
 * والاتّصالُ **لم يُبنَ ولا مزوِّدَ له في المستودَعِ**. وبناءُ الاستغاثةِ لا
 * يُطلِقُ زرَّ اتّصالٍ معه — بل يجعلُ منعَه أوجبَ: مَن رأى بطاقةَ استغاثةٍ
 * تعملُ صدَّقَ أنَّ زرَّ الاتّصالِ يعملُ مثلَها.
 *
 * **ولماذا قائمةٌ ثانيةٌ لا زيادةٌ في `BUILT_PATH_TOKENS`**: تلكَ رموزُ
 * المشاركةِ ونصُّها مِلكُ `rider.share.`، وهذه رموزُ الاستغاثةِ ونصُّها مِلكُ
 * `rider.sos.`. ولو خُلِطَتا لَقالَ الحاجزُ لمفتاحٍ اسمُه `rider.active.sos`
 * إنَّ «موضعَه rider.share.» — رسالةٌ تُرسِلُ مُصلِحَها إلى المِلفِّ الخطأِ.
 */
export const SOS_BUILT_PATH_TOKENS: readonly string[] = [
  "sos",
  "emergency",
  "panic",
  "طوارئ",
  "استغاثة",
];

/** مُركِّبُ بطاقةِ الاستغاثةِ كما يُكتَبُ في الشاشةِ — اسمٌ واحدٌ في موضعَينِ. */
export const SOS_CARD_COMPONENT = "SosCard";

/** مُركِّبُ بطاقةِ المشاركةِ كما يُكتَبُ في الشاشةِ — اسمٌ واحدٌ في موضعَينِ. */
export const SHARE_CARD_COMPONENT = "RideShareCard";

export interface ActiveRideContractInput {
  /** مِلفّاتُ السطحِ: مسارٌ ⇒ شِفرةٌ **بلا تعليقاتٍ** (التعليقُ يشرحُ المحظورَ). */
  readonly surface: Readonly<Record<string, string>>;
  /** نصُّ هجرةِ اللقطةِ كما هوَ. */
  readonly sql: string;
  /** نصُّ منفذِ التطبيقِ. */
  readonly ports: string;
  /** نصُّ عقدِ العميلِ. */
  readonly contract: string;
  /** نصُّ الشاشةِ **بلا تعليقاتٍ**. */
  readonly screen: string;
  /** القواميسُ الثلاثةُ مُحلَّلةً: لغةٌ ⇒ (مفتاحٌ ⇒ نصٌّ). */
  readonly translations: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

const ASCII_WORD = /^[a-z]+$/;

/**
 * الكلمةُ اللاتينيّةُ تُطابَقُ **بحدودِها** لا بالاحتواءِ: «shared» في مسارِ
 * استيرادٍ ليسَت «share» زرَّ مشاركةٍ، و«sar» ليسَت كلَّ ما فيه هذه الحروفُ.
 * ولو طُوبِقَ بالاحتواءِ لَسقطَ البناءُ على اسمِ مِلفٍّ بريءٍ فصارَ الحاجزُ عبئاً
 * يُستثنى منه — وحاجزٌ يُستثنى منه لا يحمي شيئاً.
 *
 * والعربيّةُ تُطابَقُ بالاحتواءِ: سوابقُها تلتصقُ (ال، و، بِـ)، والتشكيلُ يفصلُ
 * الحروفَ فلا يقعُ التطابقُ العَرَضيُّ الذي يقعُ في اللاتينيّةِ.
 */
function mentions(text: string, token: string): boolean {
  const lower = text.toLowerCase();
  const needle = token.toLowerCase();
  if (!ASCII_WORD.test(needle)) return lower.includes(needle);
  return new RegExp(`(?<![a-z])${needle}(?![a-z])`).test(lower);
}

function tokenProblems(
  where: string,
  text: string,
  tokens: readonly string[],
  verdict: string,
): string[] {
  return tokens
    .filter((token) => mentions(text, token))
    .map((token) => `${where}: ${verdict} («${token}»).`);
}

/** القاعدة ١ — لا مالَ في السطحِ ولا في مفاتيحِه ولا في نصوصِه. */
export function moneyProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(...tokenProblems(path, source, MONEY_TOKENS, "شِفرةُ السطحِ تذكرُ مالاً وهوَ مُجمَّدٌ"));
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const [key, value] of Object.entries(dictionary)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, MONEY_TOKENS, "مفتاحٌ يذكرُ مالاً"),
        // `WR-05` — نصوصُ معنى مبلغِ الراكبِ وحدَها، بمفرداتِها وحدَها (ADR 0264).
        ...tokenProblems(
          `${language}:${key}`,
          withoutRiderOfferTerms(key, value),
          MONEY_TOKENS,
          "نصٌّ يذكرُ مالاً",
        ),
      );
    }
  }
  return problems;
}

/** القاعدة ٢ — لا سائقَ بلا إسنادٍ: بالقاعدةِ والعقدِ والمنفذِ والشاشةِ. */
export function driverGateProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase();
  if (!sql.includes("assigned_driver_id is not null")) {
    problems.push(
      `${SNAPSHOT_SQL_FILE}: لقطةُ القاعدةِ لا تفحصُ «assigned_driver_id is not null»، فقد تنشرُ سائقاً لم يُسنَدْ.`,
    );
  }
  if (!/'driver'/.test(sql) && !/"driver"/.test(sql)) {
    problems.push(`${SNAPSHOT_SQL_FILE}: لا كتلةَ «driver» في اللقطةِ — العقدُ يَدَّعي ما لا يُنشَرُ.`);
  }
  if (!/readonly driver:[^;]*\|\s*null/.test(input.ports.replace(/\s+/g, " "))) {
    problems.push(`${PORTS_FILE}: حقلُ «driver» غيرُ قابلٍ للعدمِ في المنفذِ.`);
  }
  if (!/readonly driver:[^;]*\|\s*null/.test(input.contract.replace(/\s+/g, " "))) {
    problems.push(`${CONTRACT_FILE}: حقلُ «driver» غيرُ قابلٍ للعدمِ في العقدِ.`);
  }
  if (!input.screen.includes("view.driver === null")) {
    problems.push(`${SCREEN_FILE}: الشاشةُ لا تفحصُ «view.driver === null» صراحةً قبلَ رسمِ السائقِ.`);
  }
  // `F12-05` — بياناتُ السائقِ والسيارةِ في اللقطةِ: لا يكفي أن تُوجَدَ كتلةُ «driver»،
  // بل لا بدَّ من الحقولِ التي يَدَّعي العقدُ نشرَها في كائنِ السائقِ. ولا يكفي أن
  // تُوجَدَ الأسماءُ في إعلاناتِ المتغيِّراتِ — بل لا بدَّ أن تَظهَرَ كمفاتيحَ في
  // `jsonb_build_object`، فذلك دليلُ الإصدارِ لا الإعلانِ.
  // والعقدُ والمنفذُ يَدَّعيانِ الحقولَ نفسَها — فلا يكفي أن تُوجَدَ في اللقطةِ وحدَها.
  const requiredSqlFields = [
    "vehicle_type",
    "plate_number",
    "rating_average",
    "rating_count",
    "first_name",
  ];
  for (const field of requiredSqlFields) {
    const pattern = new RegExp(`['"]${field}['"]`);
    if (!pattern.test(input.sql)) {
      problems.push(
        `${SNAPSHOT_SQL_FILE}: اللقطةُ لا تُصدِرُ مفتاحَ «${field}» في كائنِ السائقِ — والعقدُ يَدَّعي إظهارَ بياناتِ السائقِ والسيارةِ طوالَ الرحلةِ (F12-05).`,
      );
    }
  }
  const requiredPortFields = [
    "firstName",
    "vehicleType",
    "plateNumber",
    "ratingAverage",
    "ratingCount",
  ];
  for (const field of requiredPortFields) {
    if (!input.ports.includes(field)) {
      problems.push(
        `${PORTS_FILE}: المنفذُ لا يُصدِرُ «${field}» — والعقدُ يَدَّعي إظهارَ بياناتِ السائقِ والسيارةِ (F12-05).`,
      );
    }
    if (!input.contract.includes(field)) {
      problems.push(`${CONTRACT_FILE}: العقدُ لا يُصدِرُ «${field}» — والشاشةُ لا ترسمُه (F12-05).`);
    }
  }
  return problems;
}

/** القاعدة ٣ — لا موضعَ بلا عُمرِه: في كلِّ طبقةٍ تنشرُ إحداثيّةً. */
export function positionAgeProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase();
  if (sql.includes("'position'") && !sql.includes("age_seconds")) {
    problems.push(`${SNAPSHOT_SQL_FILE}: اللقطةُ تنشرُ موضعاً بلا «age_seconds».`);
  }
  const contract = input.contract.replace(/\s+/g, " ");
  if (/readonly lat: number/.test(contract) && !/readonly ageSeconds: number/.test(contract)) {
    problems.push(`${CONTRACT_FILE}: العقدُ ينشرُ إحداثيّةً بلا «ageSeconds».`);
  }
  const screen = input.screen;
  if (screen.includes("ar__position-point") && !screen.includes("ar__position-age")) {
    problems.push(`${SCREEN_FILE}: الشاشةُ ترسمُ نقطةً بلا سطرِ عُمرِها.`);
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    const hasPoint = `${KEY_PREFIX}position.point` in dictionary;
    const hasAge =
      `${KEY_PREFIX}position.ageSeconds` in dictionary &&
      `${KEY_PREFIX}position.ageMinutes` in dictionary;
    if (hasPoint && !hasAge) {
      problems.push(`${language}: نصُّ النقطةِ موجودٌ ونصُّ عُمرِها غائبٌ.`);
    }
  }
  return problems;
}

/** يستخرجُ مفاتيحَ `rider.active.` المُنادَاةَ في السطحِ نصّاً حرفيّاً. */
export function usedKeys(surface: Readonly<Record<string, string>>): ReadonlySet<string> {
  const pattern = /"(rider\.active\.[A-Za-z0-9._]+)"/g;
  const keys = new Set<string>();
  for (const source of Object.values(surface)) {
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (key !== undefined) keys.add(key);
    }
  }
  return keys;
}

/** القاعدة ٤ — مجموعةُ المفاتيحِ واحدةٌ في الثلاثةِ، وكلُّ مُنادًى موجودٌ. */
export function keyParityProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sets = new Map<string, ReadonlySet<string>>();
  for (const [language, dictionary] of Object.entries(input.translations)) {
    sets.set(
      language,
      new Set(Object.keys(dictionary).filter((key) => key.startsWith(KEY_PREFIX))),
    );
  }
  const languages = [...sets.keys()].sort();
  const reference = languages[0];
  if (reference === undefined) return ["لا قاموسَ مقروءاً: الحاجزُ لا يقيسُ فراغاً."];
  const referenceSet = sets.get(reference) as ReadonlySet<string>;
  for (const language of languages.slice(1)) {
    const other = sets.get(language) as ReadonlySet<string>;
    for (const key of referenceSet) {
      if (!other.has(key)) problems.push(`${language}: مفتاحٌ ناقصٌ «${key}».`);
    }
    for (const key of other) {
      if (!referenceSet.has(key)) problems.push(`${reference}: مفتاحٌ ناقصٌ «${key}».`);
    }
  }
  for (const key of usedKeys(input.surface)) {
    for (const [language, dictionary] of Object.entries(input.translations)) {
      if (!(key in dictionary)) {
        problems.push(`${language}: مفتاحٌ يُنادى في السطحِ وليسَ في القاموسِ «${key}».`);
      }
    }
  }
  return problems;
}

/** القاعدة ٥ — لا زرَّ لمسارٍ لم يُبنَ. */
export function unbuiltPathProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  for (const [path, source] of Object.entries(input.surface)) {
    problems.push(
      ...tokenProblems(
        path,
        source,
        UNBUILT_PATH_TOKENS,
        "السطحُ يذكرُ مساراً لم يُبنَ (`F2-09`/`F2-10`)",
      ),
    );
  }
  for (const [language, dictionary] of Object.entries(input.translations)) {
    for (const key of Object.keys(dictionary)) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      problems.push(
        ...tokenProblems(`${language}:${key}`, key, UNBUILT_PATH_TOKENS, "مفتاحٌ لمسارٍ لم يُبنَ"),
        ...tokenProblems(
          `${language}:${key}`,
          key,
          BUILT_PATH_TOKENS,
          "مفتاحُ مشاركةٍ في نطاقِ اللقطةِ — موضعُه «rider.share.» (`F2-09`)",
        ),
        ...tokenProblems(
          `${language}:${key}`,
          key,
          SOS_BUILT_PATH_TOKENS,
          "مفتاحُ استغاثةٍ في نطاقِ اللقطةِ — موضعُه «rider.sos.» (`F2-10`)",
        ),
      );
    }
  }
  return problems;
}

/**
 * القاعدة ٧ (`F2-09`) — **المسارُ المبنيُّ يُركَّبُ فعلاً**.
 *
 * عكسُ القاعدةِ ٥ تماماً: تلكَ تمنعُ زرّاً لمسارٍ لا يعملُ، وهذه تمنعُ مساراً
 * يعملُ ولا بابَ له. فبطاقةُ `F2-09` بُنِيَت كاملةً — قاعدةً ومنفذاً ونداءً —
 * ولو لم تُركَّبْ في الشاشةِ لَكانَ كلُّ ذلكَ **شِفرةً ميتةً تُحسَبُ إنجازاً**،
 * وهذا أخبثُ من الغيابِ: الغيابُ يُرى في الشاشةِ، والموتُ لا يُرى إلّا في CI.
 */
export function sharePathProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.screen.includes(`<${SHARE_CARD_COMPONENT}`)) {
    problems.push(
      `${SCREEN_FILE}: بطاقةُ المشاركةِ «${SHARE_CARD_COMPONENT}» غيرُ مُركَّبةٍ — ` +
        `مسارُ \`F2-09\` مبنيٌّ ولا بابَ له في الشاشةِ.`,
    );
  }
  if (!input.screen.includes(`orderId={orderId}`)) {
    problems.push(
      `${SCREEN_FILE}: البطاقةُ لا تأخذُ «orderId» من الشاشةِ — بطاقةٌ بلا رحلةٍ لا تُشارِكُ شيئاً.`,
    );
  }
  return problems;
}

/**
 * القاعدة ٨ (`F2-10`) — **بطاقةُ الاستغاثةِ تُركَّبُ فعلاً**.
 *
 * عينُ حكمِ القاعدةِ ٧ ولسببٍ أثقلَ: مسارُ `F2-10` مبنيٌّ كاملاً — دالّتانِ في
 * القاعدةِ ومنفذٌ ومساران ونداءانِ وبطاقةٌ وثلاثةُ قواميسَ — ولو لم يُركَّبْ في
 * الشاشةِ لَكانَ **شِفرةً ميتةً تُحسَبُ إنجازاً**. والفرقُ بينَ مشاركةٍ ميتةٍ
 * واستغاثةٍ ميتةٍ أنَّ الثانيةَ تُقرأُ في السجلِّ «سطحُ الاستغاثةِ مُنجَزٌ»
 * فيُغلَقُ البندُ، ولا يكتشفُ أحدٌ الغيابَ إلّا راكبٌ يبحثُ عن بطاقةٍ لا وجودَ
 * لها في اللحظةِ التي يحتاجُها.
 *
 * **ولا يُفحَصُ تمريرُ `orderId` ههنا** بخلافِ القاعدةِ ٧: البطاقةُ لا تأخذُ
 * رحلةً عن قصدٍ — الطلبُ يُحَلُّ في القاعدةِ تحتَ القفلِ (`ADR 0077`)، وسطحُ
 * الاستغاثةِ يبقى مفتوحاً دقائقَ بعدَ انتهاءِ الرحلةِ فلا رحلةَ «جاريةً»
 * تُمرَّرُ إليه أصلاً.
 */
export function sosPathProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  if (!input.screen.includes(`<${SOS_CARD_COMPONENT}`)) {
    problems.push(
      `${SCREEN_FILE}: بطاقةُ الاستغاثةِ «${SOS_CARD_COMPONENT}» غيرُ مُركَّبةٍ — ` +
        `مسارُ \`F2-10\` مبنيٌّ ولا بابَ له في الشاشةِ.`,
    );
  }
  return problems;
}

/** الأدوارُ التي لا يجوزُ أن تُنفِّذَ دالّةً من دوالِّنا. */
export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * القاعدة ٦ — كلُّ دالّةٍ تُنشَأُ في الهجرةِ يُنزَعُ تنفيذُها عن الأدوارِ
 * العامّةِ، **وبالأدوارِ الثلاثةِ مُسمّاةً لا بواحدٍ منها**.
 *
 * ولمَ قاعدةٌ ساكنةٌ ومعَها اختبارُ صلاحيّاتٍ على قاعدةٍ حقيقيّةٍ أصلاً: لأنَّ
 * ذاكَ يقيسُ **الأثرَ** ولا يُقاسُ إلّا بمحرِّكٍ وأدوارٍ، وهذه تقرأُ **النصَّ**
 * فتُمسَكُ محلّيّاً في ثوانٍ. ولأنَّ المنحَ ضمنيٌّ (`public` يُمنَحُ تلقائيّاً)
 * فالنسيانُ **هوَ** الحالةُ الافتراضيّةُ لا الشاذّةُ — وحاجزٌ لا يمسكُ
 * الافتراضيَّ لا يحجُزُ شيئاً.
 */
export function functionRevokeProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const sql = input.sql.toLowerCase().replace(/\s+/g, " ");
  const created = [...sql.matchAll(/create (?:or replace )?function ([a-z0-9_]+)\s*\(/g)].map(
    (match) => match[1] ?? "",
  );
  // قائمةٌ فارغةٌ تجعلُ القاعدةَ تمرُّ زوراً: هجرةُ اللقطةِ تُنشئُ دالّةً واحدةً
  // على الأقلِّ، فغيابُها خللٌ في القراءةِ لا براءةٌ.
  if (created.length === 0) {
    problems.push(
      `${SNAPSHOT_SQL_FILE}: لم تُقرأْ دالّةٌ واحدةٌ في الهجرةِ — القاعدةُ لا تمرُّ بقائمةٍ فارغةٍ.`,
    );
    return problems;
  }
  for (const name of new Set(created)) {
    const pattern = new RegExp(`revoke execute on function ${name}\\s*\\([^)]*\\) from ([^;]+);`);
    const match = sql.match(pattern);
    if (match === null) {
      problems.push(
        `${SNAPSHOT_SQL_FILE}: الهجرةُ تُنشئُ «${name}» ولا تنزعُ تنفيذَها — ` +
          `و«public» يُمنَحُ التنفيذَ تلقائيّاً فتصيرُ الدالّةُ منالاً للمفتاحِ العامِّ.`,
      );
      continue;
    }
    const roles = match[1] ?? "";
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        problems.push(
          `${SNAPSHOT_SQL_FILE}: نزعُ تنفيذِ «${name}» لا يذكرُ الدورَ «${role}» — نزعٌ ناقصٌ بابٌ مفتوحٌ.`,
        );
      }
    }
  }
  return problems;
}

/**
 * القاعدة ٩ (`F2-06` الخطوة الثانية) — **الحالةُ الصريحةُ في العقدِ لا في الواجهةِ**.
 *
 * الطورُ `driver_arrived` صارَ حالةَ عقدٍ من الدرجةِ الأولى لا اشتقاقًا مبعثرًا.
 * فالواجهةُ تقرأُ `phase` من عقدِ الخادمِ — ولا تُعيدُ اشتقاقَهُ من `arrived_at`
 * أو `status`. وكلُّ اشتقاقٍ في الواجهةِ مصدرُ حقيقةٍ ثانٍ يفترقُ عن الأوّلِ.
 *
 * والمحظوراتُ: لا تُقارِنِ الواجهةُ `arrivedAt` بـ`null` لتحديدِ الطورِ، ولا
 * تَقرأُ `status` لتُحدِّدَ ما إذا كانَ السائقُ وصلَ. والقراءةُ الوحيدةُ المسموحُ بها
 * هي `view.phase`.
 */
export function explicitPhaseProblems(input: ActiveRideContractInput): readonly string[] {
  const problems: string[] = [];
  const forbidden = [
    // اشتقاقُ الطورِ من ختمِ الوصولِ في الواجهةِ — مصدرُ حقيقةٍ ثانٍ.
    {
      pattern: /arrivedAt\s*[!=]==\s*null/,
      verdict: "الواجهةُ تشتقُّ الطورَ من «arrivedAt» بدلًا من قراءةِ «phase» الصريحِ",
    },
    {
      pattern: /arrivedAtMs\s*[!=]==\s*null/,
      verdict: "الواجهةُ تشتقُّ الطورَ من «arrivedAtMs» بدلًا من قراءةِ «phase» الصريحِ",
    },
    // اشتقاقُ الطورِ من حالةِ الطلبِ في الواجهةِ.
    {
      pattern: /status\s*===\s*["']matched["']\s*&&/,
      verdict: "الواجهةُ تشتقُّ الطورَ من «status» بدلًا من قراءةِ «phase» الصريحِ",
    },
  ];
  for (const [path, source] of Object.entries(input.surface)) {
    for (const { pattern, verdict } of forbidden) {
      if (pattern.test(source)) {
        problems.push(`${path}: ${verdict} (القاعدة ٩ · F2-06 الخطوة الثانية).`);
      }
    }
  }
  // العقدُ يجبُ أن يُصدِرَ «phase» صريحًا.
  if (!input.contract.includes("phase") && !input.contract.includes("Phase")) {
    problems.push(
      `${CONTRACT_FILE}: العقدُ لا يُصدِرُ «phase» — الواجهةُ لا تملكُ ما تقرأُهُ (القاعدة ٩).`,
    );
  }
  return problems;
}

/** الحكمُ المُجمَّعُ — تسعُ قواعدَ بترتيبِها، وكلُّ مشكلةٍ بموضعِها وسببِها. */
export function activeRideContractProblems(input: ActiveRideContractInput): readonly string[] {
  return [
    ...moneyProblems(input),
    ...driverGateProblems(input),
    ...positionAgeProblems(input),
    ...keyParityProblems(input),
    ...unbuiltPathProblems(input),
    ...functionRevokeProblems(input),
    // القاعدة ٧ (`F2-09`) — أُضيفَت ولم يُمَسَّ ما قبلَها (القاعدة ح-8).
    ...sharePathProblems(input),
    ...sosPathProblems(input),
    // القاعدة ٩ (`F2-06` الخطوة الثانية) — الحالةُ الصريحةُ في العقدِ لا في الواجهةِ.
    ...explicitPhaseProblems(input),
  ];
}
