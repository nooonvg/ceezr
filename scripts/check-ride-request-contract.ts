#!/usr/bin/env bun
/**
 * # حاجزُ عقدِ طلبِ الرحلةِ — لا رحلةَ مُكرَّرةً، ولا حالةَ بحثٍ مُجمَّلةً
 *
 * **الغرض:** يفرضُ البندَ `F2-05` بعشرِ قواعدَ تُقرأُ من المستودعِ نفسِه، وكلُّها
 * أحكامٌ كانَت تُحرَسُ بالمراجعةِ البشريّةِ وحدَها — وكلُّ واحدةٍ لها **حالةٌ
 * سالبةٌ** في `tests/unit/check-ride-request-contract.test.ts` تُثبِتُ أنَّها
 * تُسقِطُ حينَ تُخالَفُ، لا أنَّها مكتوبةٌ فقط:
 *
 * ١) **مفتاحُ التكرارِ قيدُ مخطَّطٍ لا فحصُ تطبيقٍ.** فهرسٌ فريدٌ جزئيٌّ على
 *    `(rider_id, idempotency_key)` حيثُ المفتاحُ غيرُ فارغٍ. وفحصٌ في الشِّفرةِ
 *    («اقرأْ ثمَّ اكتُبْ») يُنتِجُ رحلتَينِ عندَ نداءَينِ متوازيَينِ: المهلةُ بينَ
 *    القراءةِ والكتابةِ هيَ البابُ، والقيدُ وحدَه يُغلِقُه (القاعدة 0.5).
 *
 * ٢) **الفهرسُ المتوازي وحدَه في مِلفِّه** بطورٍ `index` — قاعدةُ أمانِ الهجراتِ
 *    السادسةُ. و`create index concurrently` لا يعملُ داخلَ معاملةٍ، فمِلفٌّ يجمعُه
 *    معَ جملةٍ أخرى يسقطُ عندَ النشرِ لا عندَ المراجعةِ.
 *
 * ٣) **كلُّ رمزِ رفضٍ تُعيدُه القاعدةُ له نصٌّ في الشاشةِ.** رمزٌ لا يعرفُه العرضُ
 *    يهبطُ إلى «تعذَّرَ الطلبُ» فيُحجَبُ عن الراكبِ سببٌ كانَ يُصلِحُه. ويُقرأُ
 *    الجانبانِ من الشكلِ لا من قائمةٍ ثالثةٍ (القاعدة 0.6).
 *
 * ٤) **لا مسارَ إنتاجٍ يكتبُ صفَّ رحلةٍ بنفسِه.** في المستودعِ كاتبٌ أقدمُ
 *    (`createOrderWriter.create` في `order-adapters.ts`) يُدخِلُ `orders` بجملةِ
 *    `insert` عاريةٍ بلا مفتاحِ تكرارٍ — وهوَ **دَينٌ مُعلَنٌ (D-01)** كانَ يخدمُ حوارَ
 *    البوتِ والتوصيل. بعدَ D-01 صارَ الإنشاءُ كُلُّهُ عبرَ `RideRequestCommand` الذرّيِّ.
 *    فالحاجزُ يمنعُ أن يتسلَّلَ مُدخِلٌ مباشرٌ إلى أيِّ مسارِ إنتاجٍ (شبكةً كانَ أم بوتاً):
 *    لا استيرادَ لـ`OrderWriter` خارجَ مخزنِ الرحلةِ، ولا `deps.orders.create` أو
 *    `orders.create` في مساراتِ البوت، ولا `insert into orders` في مخزنِ الرحلةِ.
 *
 * ٥) **لا مفردةَ أجرةٍ ولا دفعٍ في الشريحةِ ولا في هجرتِها** — `ADR 0039` §٤ و§٦
 *    و`م13-7`. والقائمةُ والسماحُ يُستورَدانِ من حاجزِ الاقتباسِ ولا يُنسَخانِ
 *    (القاعدة 0.6): نسخةٌ ثانيةٌ تتخلَّفُ عن الأولى فيُقرأُ الأخضرُ كذباً.
 *
 * ٦) **الشاشةُ تُعيدُ مفاتيحَ لا نصّاً** (§9.11): لا حرفَ عربيَّ في حرفيّاتِ
 *    شِفرةِ العميلِ، وكلُّ مفتاحٍ يُوجِبُه المعيارُ موجودٌ في اللغاتِ الثلاثِ.
 *
 * ٧) **المؤقّتُ يُقاسُ من ميلادِ الرحلةِ لا من فتحِ الشاشةِ.** فنموذجُ العرضِ
 *    يستوردُ `elapsedSecondsSince` من النطاقِ، ولا حسبةَ زمنٍ في `.tsx`: راكبٌ
 *    عادَ بعدَ سبعِ دقائقَ يجبُ أن يرى سبعاً لا صفراً.
 *
 * ٨) **الصفرُ نصٌّ مُعلَنٌ لا رقمٌ في قالبٍ.** مفتاحٌ خاصٌّ للصفرِ (`…notified.zero`)
 *    في اللغاتِ الثلاثِ ومُستعمَلٌ في نموذجِ العرضِ. «بُلِّغَ 0 سائقينَ» يُقرأُ
 *    عطباً، وإخفاءُ السطرِ يُقرأُ حركةً لم تحدثْ (`ADR 0023`).
 *
 * ٩) **زرُّ الإلغاءِ مشروطٌ برايةِ القاعدةِ.** `cancellableWithoutPenalty` تُقرأُ
 *    من الحكمِ ولا تُحسَبُ في العميلِ، وزرٌّ يُرفَضُ دائماً أسوأُ من غيابِه.
 *
 * ١٠) **دالّاتُ القاعدةِ الثلاثُ منزوعةُ التنفيذِ** عن `public` و`anon` و
 *    `authenticated`، ويُقرأُ النزعُ من الشِّفرةِ المُنفَّذةِ بعدَ تفريغِ التعليقِ:
 *    نزعٌ مُعلَّقٌ يُقرأُ إغلاقاً وهوَ بابٌ مفتوحٌ.
 *
 * **ينتمي إلى:** سلسلةَ حرّاسِ CI · خطوتَينِ مُسمّاتَينِ في `.github/workflows/ci.yml`.
 *
 * **ما لا يفعلُه هذا الحاجزُ عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ:**
 * - **لا يلمسُ قاعدةً**: يقرأُ نصَّ الهجرتَينِ. وأنَّ `request_ride` تحكمُ فعلاً،
 *   وأنَّ نداءَينِ متوازيَينِ بالمفتاحِ نفسِه يُنتِجانِ صفّاً واحداً، يُثبَتُ على
 *   PostgreSQL حقيقيٍّ في `tests/integration/ride-request.test.ts`.
 * - **لا يفحصُ جودةَ الترجمةِ**: يفرضُ الوجودَ لا الفصاحةَ.
 * - **لا يُصلِحُ الدَّينَ الأقدمَ**: كاتبُ `order-adapters.ts` يبقى بلا مفتاحٍ
 *   لإغلاقِ الدَّينِ، والقاعدةُ الرابعةُ تحرسُ **الحدَّ** لا تزعمُ نظافةَ الماضي.
 *   D-01 أغلقَ الدَّينَ بتحويلِ البوتِ إلى `RideRequestCommand`، لكنَّ الكاتبَ
 *   القديمَ يبقى كذلك بلا مفتاحٍ.
 * - **لا يزعمُ أنَّ الشاشةَ جُرِّبَت عندَ مستخدمٍ**: لا نشرَ حيَّ (`ADR 0099`).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DECLARED_FARE_ALLOWANCES,
  FORBIDDEN_FARE_WORDS,
  findArabicLiterals,
  findForbiddenWords,
} from "./check-quote-contract.ts";
import { blankComments, blankSqlComments } from "./lib/blank-comments.ts";

const MIGRATIONS_DIR = "supabase/migrations";
const JUDGEMENT_MIGRATION_SUFFIX = "_f2_05_ride_request_judgement.sql";
const INDEX_MIGRATION_SUFFIX = "_f2_05_ride_idempotency_index.sql";
const MINIAPP_I18N_DIR = "packages/shared/i18n/miniapp";
const LANGUAGES = ["ar", "en", "ur"] as const;

/** مِلفّاتُ الشريحةِ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const SLICE_FILES: readonly string[] = [
  "packages/domain/transport/ride-request.ts",
  "packages/application/transport/ride-request-ports.ts",
  "packages/application/transport/request-ride.ts",
  "packages/application/transport/read-ride-search.ts",
  "packages/application/transport/cancel-ride-request.ts",
  "packages/infrastructure/transport/ride-request-store.ts",
  "packages/application/bots/rider-dialog.ts",
  "packages/application/delivery/request-delivery.ts",
  "apps/gateway/src/routes/rides.ts",
  "apps/miniapp/src/surfaces/rider/search/ride-contract.ts",
  "apps/miniapp/src/surfaces/rider/search/ride-api.ts",
  "apps/miniapp/src/surfaces/rider/search/search-view.ts",
  "apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx",
];

/** مِلفّاتُ العميلِ التي يُمنَعُ فيها النصُّ المعروضُ (§9.11). */
export const CLIENT_TEXT_FILES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/search/search-view.ts",
  "apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx",
];

/** مِلفُّ الشبكةِ الذي يُمنَعُ فيه الكاتبُ الأقدمُ بلا مفتاحٍ (القاعدةُ ٤). */
export const NETWORK_PATH_FILES: readonly string[] = [
  "apps/gateway/src/routes/rides.ts",
  "packages/application/transport/request-ride.ts",
  "packages/infrastructure/transport/ride-request-store.ts",
];

/** الكاتبُ الأقدمُ — دَينٌ مُعلَنٌ يخدمُ حوارَ البوتِ ولا يُستوردُ في الشبكةِ. */
export const FORBIDDEN_WRITER_IMPORT = "order-adapters";
export const BOT_PATH_FILES: readonly string[] = [
  "packages/application/bots/rider-dialog.ts",
  "packages/application/delivery/request-delivery.ts",
];

/** دالّاتُ القاعدةِ الثلاثُ بتواقيعِها كما تُنزَعُ. */
export const REVOKED_FUNCTIONS: readonly string[] = [
  "request_ride(bigint, text, service_type, double precision, double precision, double precision, double precision, text)",
  "ride_search_state(bigint, uuid)",
  "cancel_ride_by_telegram(bigint, uuid)",
];

export const REVOKED_ROLES: readonly string[] = ["public", "anon", "authenticated"];

/**
 * رموزٌ تُعيدُها الهجرةُ في `error` وهيَ **ليست رفضَ طلبٍ** بل عطبُ حسابٍ يُترجَمُ
 * خطأَ متجرٍ (`404`). ومُعلَنةٌ بالاسمِ كي لا يُوسَّعَ الاستثناءُ صامتاً.
 */
export const NON_REFUSAL_ERROR_CODES: readonly string[] = [
  "USER_NOT_FOUND",
  "RIDER_NOT_REGISTERED",
  // إلغاءٌ لرحلةٍ فاتَ وقتُ إلغائِها — رفضٌ له مفتاحُه في خريطةِ الإلغاءِ لا الطلبِ.
  "ORDER_NOT_CANCELLABLE",
  "ORDER_NOT_FOUND",
  "INVALID_ORDER_ID",
];

/** مفاتيحُ شاشةِ البحثِ التي يُوجِبُها معيارُ القبولِ في `SR-05` حرفاً. */
export const REQUIRED_SEARCH_KEYS: readonly string[] = [
  "rider.search.title",
  "rider.search.destination",
  "rider.search.creating",
  "rider.search.reused",
  "rider.search.status.searching",
  "rider.search.status.matched",
  "rider.search.status.in_progress",
  "rider.search.status.completed",
  "rider.search.status.cancelled",
  "rider.search.status.failed",
  "rider.search.status.unknown",
  "rider.search.phase.silent",
  "rider.search.phase.announced",
  "rider.search.phase.assigned",
  "rider.search.phase.closed",
  "rider.search.phase.unknown",
  "rider.search.notified.zero",
  "rider.search.notified.count",
  "rider.search.elapsedSeconds",
  "rider.search.elapsedMinutes",
  // `rider.search.stopped` بقيَ بعدَ نزعِ الاستقصاءِ (`ADR 0035` §٤): لا يُعرَضُ
  // ولا يُمحى — والنسخُ بالإضافةِ لا بالمحوِ (`ح-1`).
  "rider.search.stopped",
  "rider.search.refresh",
  "rider.search.refreshing",
  "rider.search.snapshot",
  "rider.search.cancel",
  "rider.search.cancelling",
  "rider.search.cancelled",
  "rider.search.cancel.notCancellable",
  "rider.search.cancel.notFound",
  "rider.search.cancel.invalidId",
  "rider.search.cancel.unknown",
  "rider.search.read.notFound",
  "rider.search.read.invalidId",
  "rider.search.read.unknown",
  "rider.search.activeRide.status",
  "rider.search.activeRide.follow",
  "rider.search.error.session",
  "rider.search.error.malformed",
  "rider.search.error.account",
  "rider.search.error.notRegistered",
  "rider.search.error.unknownService",
  "rider.search.error.unavailable",
  "rider.search.retry",
  "rider.search.back",
  "rider.quote.request",
  "rider.quote.notes.label",
  "rider.quote.notes.placeholder",
  "rider.quote.notes.limit",
];

/** المفتاحُ الذي يُقالُ فيه الصفرُ نصّاً (القاعدةُ ٨). */
export const ZERO_NOTIFIED_KEY = "rider.search.notified.zero";

export interface RepositoryInput {
  readonly judgementSql: string | null;
  readonly indexSql: string | null;
  readonly indexFileName: string | null;
  readonly sliceSources: Readonly<Record<string, string | null>>;
  readonly miniappDictionaries: Readonly<Record<string, Record<string, string>>>;
}

function latestMigration(suffix: string): { readonly name: string; readonly sql: string } | null {
  const file = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .at(-1);
  if (file === undefined) return null;
  return { name: file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") };
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function readRepository(): RepositoryInput {
  const miniappDictionaries: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    miniappDictionaries[language] = JSON.parse(
      readFileSync(join(MINIAPP_I18N_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }
  const sliceSources: Record<string, string | null> = {};
  for (const path of SLICE_FILES) sliceSources[path] = readIfPresent(path);
  const judgement = latestMigration(JUDGEMENT_MIGRATION_SUFFIX);
  const index = latestMigration(INDEX_MIGRATION_SUFFIX);
  return {
    judgementSql: judgement === null ? null : judgement.sql,
    indexSql: index === null ? null : index.sql,
    indexFileName: index === null ? null : index.name,
    sliceSources,
    miniappDictionaries,
  };
}

/**
 * إعادةُ التسميةِ عندَ حدِّ التطبيقِ — تُقرأُ من الشِّفرةِ لا من قائمةٍ في الحاجزِ.
 *
 * **ولماذا؟** لأنَّ رمزَ القاعدةِ لا يصلُ الشاشةَ دائماً باسمِه: `USER_NOT_FOUND`
 * يُعادُ تسميتُه `ACCOUNT_NOT_FOUND` عندَ حدِّ التطبيقِ كي لا تُفشى بنيةُ الجدولِ
 * في حمولةٍ عامّةٍ. فحاجزٌ يُطالِبُ الشاشةَ بالاسمِ الداخليِّ يُكرِهُ الشِّفرةَ على
 * تسريبٍ، وحاجزٌ يُعفي الرمزَ بقائمةٍ مكتوبةٍ فيه يُخفي رمزاً نُسِيَ فعلاً. فيُقرأُ
 * الجَسرُ من موضعِه: `if (failure.reason === "X") return "Y";` (القاعدة 0.6).
 */
export function declaredRenames(source: string): Readonly<Record<string, string>> {
  const renames: Record<string, string> = {};
  for (const match of blankComments(source).matchAll(
    /reason\s*===\s*"([A-Z_]+)"\s*\)\s*return\s*"([A-Z_]+)"/g,
  )) {
    renames[match[1] as string] = match[2] as string;
  }
  return renames;
}

/** أسماءُ المفاتيحِ المُعلَنةِ في خريطةٍ ثابتةٍ داخلَ نموذجِ العرضِ. */
function mappedCodes(source: string, mapName: string): ReadonlySet<string> {
  const block = new RegExp(`const ${mapName}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(
    blankComments(source),
  );
  return new Set(
    [...(block?.[1] ?? "").matchAll(/([A-Z_]+)\s*:/g)].map((match) => match[1] as string),
  );
}

export function findViolations(input: RepositoryInput): readonly string[] {
  const violations: string[] = [];

  for (const path of SLICE_FILES) {
    const source = input.sliceSources[path];
    if (source === null || source === undefined) {
      violations.push(`المِلفُّ «${path}» غائبٌ — عقدُ طلبِ الرحلةِ مُعلَنٌ في الحاجزِ بلا شِفرةٍ تخدمُه.`);
    }
  }

  // ===== القاعدةُ ٥ و٧ — مفرداتُ الأجرةِ وحسبةُ الزمنِ.
  const scanned: {
    readonly path: string;
    readonly source: string;
    readonly dialect: "sql" | "ts";
  }[] = [];
  for (const path of SLICE_FILES) {
    const source = input.sliceSources[path];
    if (typeof source === "string") scanned.push({ path, source, dialect: "ts" });
  }
  if (input.judgementSql !== null) {
    scanned.push({
      path: JUDGEMENT_MIGRATION_SUFFIX,
      source: input.judgementSql,
      dialect: "sql",
    });
  }
  if (input.indexSql !== null) {
    scanned.push({ path: INDEX_MIGRATION_SUFFIX, source: input.indexSql, dialect: "sql" });
  }
  for (const { path, source, dialect } of scanned) {
    for (const hit of findForbiddenWords(path, source, FORBIDDEN_FARE_WORDS, dialect)) {
      violations.push(
        `«${hit.path}:${hit.line}» فيه مفردةُ أجرةٍ «${hit.word}» — آليّةُ الأجرةِ محجوبةٌ على قرارٍ نظاميٍّ مكتوبٍ (\`ADR 0039\` §٤ و§٦)، و\`م13-7\` يُجمِّدُ حتّى الهياكلَ التمهيديّةَ.`,
      );
    }
  }

  // ===== القاعدةُ ٦ — لا نصَّ معروضاً في شِفرةِ العميلِ.
  for (const path of CLIENT_TEXT_FILES) {
    const source = input.sliceSources[path];
    if (typeof source !== "string") continue;
    for (const hit of findArabicLiterals(path, source)) {
      violations.push(
        `«${hit.path}:${hit.line}» فيه نصٌّ معروضٌ «${hit.word}…» — الشاشةُ تُعيدُ مفاتيحَ والنصُّ في \`packages/shared/i18n\` (§9.11).`,
      );
    }
  }

  // ===== القاعدةُ ۴ — لا إنشاءَ طلبٍ بلا حكمِ القاعدةِ في أيِّ مسارٍ إنتاجيّٟ (D-01).
  for (const path of NETWORK_PATH_FILES) {
    const source = input.sliceSources[path];
    if (typeof source !== "string") continue;
    const code = blankComments(source);
    if (code.includes(FORBIDDEN_WRITER_IMPORT)) {
      violations.push(
        `«${path}» يستوردُ «${FORBIDDEN_WRITER_IMPORT}» — ذاكَ الكاتبُ يُدَخِلُ \`orders\` بلا مَفتاحِ تكرارٍ، واستعمالُهُ في مسارِ الشبكةِ يُبطِلُ \`ARCH-006\` ويُنتِجُ رحلتَينِ بضغطتَينِ.`,
      );
    }
    if (/insert\s+into\s+orders/i.test(code)) {
      violations.push(
        `«${path}» فيهِ \`insert into orders\` — الإنشاءُ حكمُ دالّاتِ في القاعدةِ (القاعدة 0.5)، وإدخالٌ مباشرٌ يتخطّى قيدَ المَفتاحِ والفحوصَ الذرّيّةَ.`,
      );
    }
  }
  // D-01: البوتُ والتوصيلُ يُنشِئانِ عبرَ `RideRequestCommand` لا الكاتبَ الأقدمَ.
  for (const path of BOT_PATH_FILES) {
    const source = input.sliceSources[path];
    if (typeof source !== "string") continue;
    const code = blankComments(source);
    if (/deps\.orders\.create\b/.test(code)) {
      violations.push(
        `«${path}» ينادي \`deps.orders.create\` — الإنشاءُ جيبُ أن يمرَّ بـ\`RideRequestCommand\` الذرّيِّ الآمنِ (D-01)، والكاتبُ الأقدمُ بلا مَفتاحِ تكرارٍ.`,
      );
    }
    if (/\borders\.create\b/.test(code) && !/deps\.orders\.create/.test(code)) {
      violations.push(
        `«${path}» ينادي \`orders.create\` مباشرةً — الإنشاءُ جيبُ أن يمرَّ بـ\`RideRequestCommand\` (D-01).`,
      );
    }
  }
  const store = input.sliceSources["packages/infrastructure/transport/ride-request-store.ts"];
  // `RIDE-LABEL-01` — `request_ride_labeled(` غلافٌ في القاعدةِ يُنادي `request_ride` حرفاً،
  // فالحكمُ باقٍ في القاعدةِ.
  if (
    typeof store === "string" &&
    !store.includes("request_ride(") &&
    !store.includes("request_ride_labeled(") &&
    // `ORDER-TERMS-01` — `request_ride_with_terms(` غلافٌ فوقَ `request_ride_labeled` حرفاً.
    !store.includes("request_ride_with_terms(") &&
    // `WR-05` — `request_ride_with_offer(` يحكمُ على سياسةِ المبلغِ ثمَّ يُفوِّضُ إلى
    // `request_ride_with_places` فـ`request_ride_with_terms` حرفاً؛ فالحكمُ باقٍ في القاعدة.
    !store.includes("request_ride_with_offer(")
  ) {
    violations.push(
      "مخزنُ الرحلةِ لا ينادي `request_ride(` — الحكمُ في القاعدةِ لا في المحوّلِ (القاعدة 0.5).",
    );
  }

  // ===== القاعدةُ ٧ — المؤقّتُ من النطاقِ، ولا حسبةَ زمنٍ في الشاشةِ.
  const view = input.sliceSources["apps/miniapp/src/surfaces/rider/search/search-view.ts"];
  if (typeof view === "string" && !view.includes("elapsedSecondsSince")) {
    violations.push(
      "نموذجُ العرضِ لا يستوردُ `elapsedSecondsSince` من النطاقِ — حسبةٌ ثانيةٌ للمدّةِ مصدرُ حقيقةٍ ثانٍ (القاعدة 0.6)، وعدّادٌ يبدأُ عندَ التركيبِ يُري راكباً عادَ بعدَ سبعِ دقائقَ صفراً.",
    );
  }
  const screen = input.sliceSources["apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx"];
  if (typeof screen === "string") {
    const code = blankComments(screen);
    if (/(\b(?:60|1000|3600)\s*[*/])|([*/]\s*(?:60|1000|3600)\b)/.test(code)) {
      violations.push(
        "الشاشةُ تحسبُ زمناً بالقسمةِ أو الضربِ — التحويلُ حكمُ النطاقِ ونموذجِ العرضِ، والشاشةُ تُنسِّقُ ما حُكِمَ به.",
      );
    }
    if (!code.includes("serverElapsedSeconds")) {
      violations.push(
        "الشاشةُ لا تُمرِّرُ `serverElapsedSeconds` — فالمدّةُ تُقاسُ على ساعةِ الجهازِ وحدَها، وانحرافُها يُري انتظاراً لم يحدثْ.",
      );
    }
    // ===== القاعدةُ ١١ — القراءةُ بطلبٍ، فبابُ الطلبِ واجبٌ.
    // بعدَ نزعِ الاستقصاءِ (`ADR 0035` §٤) صارَت الشاشةُ لا تسألُ إلّا مرّةً عندَ
    // الدخولِ؛ فلو خلَت من زرِّ قراءةٍ لَجمَدَ العددُ إلى الأبدِ ولا يعرفُ الراكبُ
    // أنَّه جامدٌ. وهذه القاعدةُ **لا تُكرِّرُ** حاجزَ منعِ المؤقّتِ
    // (`scripts/check-system-screens-policy.ts` مالكُه وحدَه — القاعدة 0.6):
    // ذاكَ يمنعُ الآليَّ، وهذه تُوجِبُ اليدويَّ بديلاً عنه.
    if (!code.includes('"rider.search.refresh"')) {
      violations.push(
        "الشاشةُ لا تعرضُ زرَّ قراءةٍ بطلبِ الراكبِ — ولا استقصاءَ دوريّاً في التطبيقِ المصغَّرِ (`ADR 0035` §٤)، فشاشةٌ بلا الاثنَينِ تُري عدداً جامداً بلا بابِ سؤالٍ.",
      );
    }
    if (!code.includes('"rider.search.snapshot"')) {
      violations.push(
        "الشاشةُ لا تُعلِنُ أنَّ الرقمَ لقطةٌ — رقمٌ ساكنٌ يُقرأُ حيّاً، والراكبُ يحسبُ أنَّه يرى الآنَ وهوَ يرى ما مضى.",
      );
    }
    // ===== القاعدةُ ٩ — زرُّ الإلغاءِ مشروطٌ برايةِ القاعدةِ.
    if (!code.includes("cancellableWithoutPenalty")) {
      violations.push(
        "الشاشةُ لا تقرأُ `cancellableWithoutPenalty` — زرُّ إلغاءٍ يُعرَضُ بعدَ الإسنادِ يُرفَضُ حتماً، وزرٌّ يُرفَضُ دائماً أسوأُ من غيابِه.",
      );
    }
  }

  // ===== القاعدةُ ٨ — الصفرُ نصٌّ مُعلَنٌ.
  if (typeof view === "string" && !view.includes(ZERO_NOTIFIED_KEY)) {
    violations.push(
      `نموذجُ العرضِ لا يُعلِنُ «${ZERO_NOTIFIED_KEY}» — «بُلِّغَ 0 سائقينَ» يُقرأُ عطباً، وإخفاءُ السطرِ يُقرأُ حركةً لم تحدثْ (\`ADR 0023\`).`,
    );
  }

  // ===== القاعدةُ ٢ — الفهرسُ المتوازي وحدَه في مِلفِّه بطورٍ `index`.
  if (input.indexSql === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${INDEX_MIGRATION_SUFFIX}» — فمفتاحُ التكرارِ بلا قيدٍ في المخطَّطِ، وفحصُ التطبيقِ وحدَه يُنتِجُ رحلتَينِ عندَ نداءَينِ متوازيَينِ.`,
    );
  } else {
    const indexCode = blankSqlComments(input.indexSql);
    if (!/phase\s*:\s*index/i.test(input.indexSql)) {
      violations.push(
        `«${INDEX_MIGRATION_SUFFIX}» لا يُصرِّحُ بالطورِ «index» حرفاً — قاعدةُ أمانِ الهجراتِ الأولى تُوجِبُ إعلانَ الطورِ.`,
      );
    }
    if (!/create\s+unique\s+index\s+concurrently/i.test(indexCode)) {
      violations.push(
        `«${INDEX_MIGRATION_SUFFIX}» لا يُنشئُ فهرساً فريداً متوازياً — فهرسٌ حاجزٌ يُقفِلُ جدولَ الطلباتِ عندَ النشرِ.`,
      );
    }
    const statements = indexCode
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (statements.length !== 1) {
      violations.push(
        `«${INDEX_MIGRATION_SUFFIX}» فيه ${statements.length} جملةً — و\`create index concurrently\` لا يعملُ داخلَ معاملةٍ، فيسقطُ عندَ النشرِ لا عندَ المراجعةِ (قاعدةُ أمانِ الهجراتِ الثانيةُ).`,
      );
    }
  }

  // ===== القاعدةُ ١ — القيدُ على العمودَينِ معَ شرطِ الجزئيّةِ.
  if (input.indexSql !== null) {
    const indexCode = blankSqlComments(input.indexSql);
    const shape =
      /on\s+orders\s*\(\s*rider_id\s*,\s*idempotency_key\s*\)\s*where\s+idempotency_key\s+is\s+not\s+null/i;
    if (!shape.test(indexCode)) {
      violations.push(
        "الفهرسُ ليسَ على `(rider_id, idempotency_key)` بشرطِ `is not null` — فهرسٌ على المفتاحِ وحدَه يمنعُ راكبَينِ من مفتاحٍ متشابهٍ، وفهرسٌ بلا شرطٍ جزئيٍّ يمنعُ أكثرَ من صفٍّ واحدٍ بلا مفتاحٍ فيُعطِّلُ حوارَ البوتِ.",
      );
    }
  }

  if (input.judgementSql === null) {
    violations.push(
      `لا هجرةَ تنتهي بـ«${JUDGEMENT_MIGRATION_SUFFIX}» — حكمُ الطلبِ مُعلَنٌ في الشِّفرةِ بلا دالّةٍ تخدمُه (القاعدة 0.5).`,
    );
    return violations;
  }

  const judgement = blankSqlComments(input.judgementSql);

  // ===== القاعدةُ ١ (تكملةً) — المطالبةُ الذرّيّةُ ومعالجةُ خرقِ الفرادةِ.
  if (!/for\s+update/i.test(judgement)) {
    violations.push(
      "دالّةُ الطلبِ بلا `for update` — قراءةٌ بلا قُفلٍ تسمحُ لنداءَينِ متوازيَينِ أن يمرّا معاً على فحصِ «رحلةٌ قائمةٌ».",
    );
  }
  if (!/unique_violation/i.test(judgement)) {
    violations.push(
      "دالّةُ الطلبِ لا تعالِجُ `unique_violation` — فالسابقُ في السباقِ يكتبُ والثاني يسقطُ عطباً بدلَ أن يقرأَ الرحلةَ نفسَها (`reused`).",
    );
  }
  if (!/'reused'/.test(judgement)) {
    violations.push(
      "الحمولةُ لا تُعلِنُ `reused` — فتُقرأُ الإعادةُ إنشاءً جديداً، ويُحسَبُ في كلِّ قياسٍ لاحقٍ رحلتانِ حيثُ رحلةٌ واحدةٌ.",
    );
  }

  // ===== القاعدةُ ٣ — كلُّ رمزِ رفضٍ له نصٌّ في الشاشةِ.
  const codes = new Set(
    [...judgement.matchAll(/'error'\s*,\s*'([A-Z_]+)'/g)].map((match) => match[1] as string),
  );
  const ports = input.sliceSources["packages/application/transport/ride-request-ports.ts"];
  const useCase = input.sliceSources["packages/application/transport/request-ride.ts"];
  const renames = typeof useCase === "string" ? declaredRenames(useCase) : {};
  if (typeof view === "string") {
    const translated = new Set([
      ...mappedCodes(view, "REFUSAL_KEYS"),
      ...mappedCodes(view, "SEARCH_REFUSAL_KEYS"),
      ...mappedCodes(view, "CANCEL_REFUSAL_KEYS"),
      ...mappedCodes(view, "ERROR_KEYS"),
    ]);
    for (const code of codes) {
      const renamed = renames[code];
      if (translated.has(code)) continue;
      if (renamed !== undefined && translated.has(renamed)) continue;
      violations.push(
        `نموذجُ العرضِ لا يُترجِمُ الرمزَ «${code}» — فيهبطُ إلى نصٍّ عامٍّ ويُحجَبُ عن الراكبِ سببٌ كانَ يقدرُ على إصلاحِه.`,
      );
    }
  }
  if (typeof ports === "string") {
    for (const code of codes) {
      if (NON_REFUSAL_ERROR_CODES.includes(code)) continue;
      if (!ports.includes(code)) {
        violations.push(
          `عقدُ المنافذِ لا يعرفُ «${code}» — رمزٌ تُعيدُه القاعدةُ ولا يعرفُه التطبيقُ يُترجَمُ عطباً بدلَ سببِه.`,
        );
      }
    }
  }

  // ===== القاعدةُ ١٠ — نزعُ التنفيذِ عن الأدوارِ العامّةِ.
  for (const signature of REVOKED_FUNCTIONS) {
    const pattern = new RegExp(
      `revoke\\s+execute\\s+on\\s+function\\s+${signature.replace(/[()]/g, (c) => `\\${c}`)}\\s+from\\s+([^;]+);`,
      "i",
    );
    const match = judgement.match(pattern);
    if (match === null) {
      violations.push(
        `الهجرةُ لا تنزعُ التنفيذَ عن «${signature}» — دالّةٌ تُنشئُ رحلةً أو تقرأُ حالةَ صاحبِ معرّفٍ مفتوحةً للمفتاحِ العامِّ بابُ تعدادٍ وإنشاءٍ.`,
      );
      continue;
    }
    const roles = (match[1] ?? "").toLowerCase();
    for (const role of REVOKED_ROLES) {
      if (!roles.includes(role)) {
        violations.push(
          `«${signature}» لا يُنزَعُ تنفيذُها عن الدورِ «${role}» — ونزعٌ ناقصٌ يُقرأُ إغلاقاً وهوَ بابٌ مفتوحٌ.`,
        );
      }
    }
  }

  // ===== القاعدةُ ٦ (تكملةً) — المفاتيحُ في اللغاتِ الثلاثِ.
  for (const language of LANGUAGES) {
    const dictionary = input.miniappDictionaries[language] ?? {};
    for (const key of REQUIRED_SEARCH_KEYS) {
      const text = dictionary[key];
      if (typeof text !== "string" || text.trim().length === 0) {
        violations.push(
          `المفتاحُ «${key}» غائبٌ أو فارغٌ في «${language}.json» — يظهرُ للمستخدمِ مفتاحاً خامّاً أو فراغاً، وكِلاهما شاشةٌ لا تُقرأُ.`,
        );
      }
    }
  }

  return violations;
}

/** مُعلَنٌ كي يُقرأَ في السجلِّ: السماحُ المُستورَدُ لا المنسوخُ (القاعدة 0.6). */
export const IMPORTED_ALLOWANCES = DECLARED_FARE_ALLOWANCES;

if (import.meta.main) {
  const violations = findViolations(readRepository());
  if (violations.length === 0) {
    console.log(
      `حاجزُ عقدِ طلبِ الرحلةِ: نجحَ — ${SLICE_FILES.length} مِلفّاً مفحوصاً بـ${FORBIDDEN_FARE_WORDS.length} مفردةَ أجرةٍ ممنوعةً، مفتاحُ تكرارٍ قيدَ مخطَّطٍ بفهرسٍ فريدٍ جزئيٍّ متوازٍ وحدَه في مِلفِّه، كلُّ رمزِ رفضٍ مُترجَماً، مسارُ إنتاجٍ بلا إدخالٍ عارٍ، مؤقّتٌ من ميلادِ الرحلةِ، صفرٌ مُعلَنٌ نصّاً، إلغاءٌ مشروطٌ برايةِ القاعدةِ، ${REVOKED_FUNCTIONS.length} دالّاتٍ منزوعةَ التنفيذِ عن ${REVOKED_ROLES.length} أدوارٍ، و${REQUIRED_SEARCH_KEYS.length} مفتاحاً في ثلاثِ لغاتٍ.`,
    );
  } else {
    console.error("حاجزُ عقدِ طلبِ الرحلةِ: سقطَ.");
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
}
