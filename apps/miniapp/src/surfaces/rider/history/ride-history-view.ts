/**
 * الغرض: نموذجُ عرضِ السجلِّ والتفاصيلِ — **مفاتيحُ نصٍّ وأجزاءُ تاريخٍ لا
 *   نصٌّ**: عنوانُ الشهرِ، وشارةُ الحالةِ، وسطرُ الحدثِ، ومفاتيحُ الرفضِ
 *   (البند `F2-08` · `SR-09` · `SR-10`).
 * الحالة: منفَّذٌ فعليّاً — البند `F2-08`.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/history
 * يُستخدم من: `RideHistoryScreen.tsx` و`RideDetailScreen.tsx`
 * يُتوقع أن يستخدمه لاحقاً: `F2-11` تعرضُ العناوينَ نفسَها في شاشةِ التصديرِ.
 *
 * ## لماذا عنوانُ الشهرِ يُفَكُّ إلى **سنةٍ ورقمِ شهرٍ** لا يُنسَّقُ نصّاً
 *
 * لأنَّ اسمَ الشهرِ نصٌّ مُترجَمٌ، ومكانُه `packages/shared/i18n` وحدَه (§9.11).
 * فالنموذجُ يُعطي `{ year, month }` والشاشةُ تقرأُ مفتاحَ الاسمِ
 * `rider.history.month.9` — فلا حرفَ عربيٍّ في شفرةٍ ولا `toLocaleString`
 * يتبعُ ساعةَ الجهازِ ولغتَه بدلَ لغةِ الحسابِ.
 *
 * ## ولماذا `monthKey` معطوبٌ **يُعرَضُ خامّاً** ولا يُخفى
 *
 * مفتاحٌ لا يُطابقُ `YYYY-MM` عطبٌ في مصدرِه، وإخفاؤُه يُنتِجُ مجموعةً بلا
 * عنوانٍ تبدو خللاً في الرسمِ. فيُعرَضُ كما وردَ بمفتاحٍ يقولُ إنَّه خامٌّ،
 * فيُرى في أوّلِ لقطةٍ ويُصلَحُ في القاعدةِ.
 *
 * ## ولماذا الحدثُ بلا ختمٍ **سطرٌ كاملٌ** لا سطرٌ محذوفٌ
 *
 * «أُلغيَت الرحلةُ — الوقتُ غيرُ مسجَّلٍ» خبرٌ صادقٌ. وحذفُ السطرِ يجعلُ إلغاءً
 * جرى **بلا أثرٍ** في السجلِّ، وذاكَ إخفاءٌ لا اختصارٌ (`ح-5`).
 *
 * ## وما لا يفعلُه هذا المِلفُّ عن قصدٍ
 *
 *   ــ **لا يعرفُ مبلغاً ولا أجرةً** (`ADR 0039` §٤ · `م13-7`).
 *   ــ **لا يُصيغُ نصّاً ولا يحملُ حرفاً عربيّاً** (§9.11).
 *   ــ **لا يفرزُ ولا يُعيدُ ترتيبَ مجموعةٍ أو حدثٍ**: الترتيبُ حكمُ القاعدةِ.
 *   ــ **لا يرسمُ زرَّ تذكرةِ دعمٍ** — `F2-12`، غيابٌ مُصرَّحٌ بلا زرٍّ.
 */

import {
  DEFAULT_RIDE_HISTORY_PAGE_SIZE,
  MAX_RIDE_HISTORY_QUERY_LENGTH,
  type RideOutcomeClass,
  rideOutcomeClassOf,
} from "../../../../../../packages/domain/transport/ride-history.ts";

/**
 * يُعادُ نشرُ الاتحادِ نفسِه أيضاً: جدولُ شاراتِ المآلِ في الشاشةِ يجبُ أن يُخطِئَ
 * إن زادَ النطاقُ صنفاً خامساً، واستيرادُ السطحِ من `packages/domain` مباشرةً
 * يفتحُ باباً ثانياً للشيءِ نفسِه (القاعدة 0.6).
 */
export type { RideOutcomeClass };
/**
 * يُعادُ نشرُها كي تستوردَ الشاشةُ حدودَها وتصنيفَها من بابٍ واحدٍ.
 *
 * **و`rideOutcomeClassOf` تُعادُ ولا تُكتَبُ ثانيةً ههنا**: تصنيفُ النتيجةِ
 * حكمٌ واحدٌ مقيسٌ في النطاقِ، ونسخةٌ في السطحِ تفترقُ عندَ أوّلِ حالةٍ جديدةٍ
 * (القاعدة 0.6).
 */
export { DEFAULT_RIDE_HISTORY_PAGE_SIZE, MAX_RIDE_HISTORY_QUERY_LENGTH, rideOutcomeClassOf };

/** عنوانُ المجموعةِ — أجزاءٌ للشاشةِ، أو خامٌّ مُعلَنٌ حينَ يُعطَبُ المفتاحُ. */
export type MonthHeading =
  | { readonly known: true; readonly key: string; readonly year: number; readonly month: number }
  | { readonly known: false; readonly key: string; readonly raw: string };

export function monthHeading(monthKey: string): MonthHeading {
  const match = /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(monthKey);
  if (match === null) {
    return { known: false, key: "rider.history.month.raw", raw: monthKey };
  }
  return {
    known: true,
    key: "rider.history.month.heading",
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

/** اسمُ الشهرِ ⇒ مفتاحُ نصِّه. والمفاتيحُ مشتقّةٌ من الرقمِ لا مكتوبةٌ ثانيةً. */
export function monthNameKey(month: number): string {
  return `rider.history.monthName.${month}`;
}

const OUTCOME_KEYS: Readonly<Record<RideOutcomeClass, string>> = {
  IN_FLIGHT: "rider.history.outcome.inFlight",
  COMPLETED: "rider.history.outcome.completed",
  NOT_COMPLETED: "rider.history.outcome.notCompleted",
  OTHER: "rider.history.outcome.other",
};

export function outcomeKey(outcome: string): string {
  return OUTCOME_KEYS[outcome as RideOutcomeClass] ?? "rider.history.outcome.other";
}

/** الحالةُ الخامُّ ⇒ مفتاحُ نصِّها. وما لا يُعرَفُ يُعرَضُ خامّاً لا مُخفىً. */
const STATUS_KEYS: Readonly<Record<string, string>> = {
  scheduled: "rider.history.status.scheduled",
  searching: "rider.history.status.searching",
  matched: "rider.history.status.matched",
  in_progress: "rider.history.status.inProgress",
  completed: "rider.history.status.completed",
  cancelled: "rider.history.status.cancelled",
  failed: "rider.history.status.failed",
};

export type StatusLabel =
  | { readonly known: true; readonly key: string }
  | { readonly known: false; readonly key: string; readonly raw: string };

export function statusLabel(status: string): StatusLabel {
  const key = STATUS_KEYS[status];
  if (key === undefined) return { known: false, key: "rider.history.status.raw", raw: status };
  return { known: true, key };
}

/**
 * أسماءُ الخدمةِ **كما في `service_type` حرفاً** لا كما يُظَنُّ.
 *
 * وقد كُتِبَت أوّلَ مرّةٍ `ride` و`errand`، وليسَ في المُعدَّدِ إلّا `transport`
 * و`delivery` — فكانَ كلُّ صفٍّ في السجلِّ يُعرَضُ «خدمةً أخرى» وهوَ رحلةٌ.
 * **وهذا عطبٌ لا يُخفِقُ به بناءٌ ولا حاجزٌ**: نصٌّ صحيحُ التركيبِ خاطئُ
 * المعنى. فالمصدرُ هوَ الهجرةُ لا الذاكرةُ.
 */
const SERVICE_KEYS: Readonly<Record<string, string>> = {
  transport: "rider.history.service.ride",
  delivery: "rider.history.service.delivery",
};

export function serviceKey(service: string): string {
  return SERVICE_KEYS[service] ?? "rider.history.service.other";
}

const EVENT_KEYS: Readonly<Record<string, string>> = {
  REQUESTED: "rider.history.event.requested",
  MATCHED: "rider.history.event.matched",
  STARTED: "rider.history.event.started",
  COMPLETED: "rider.history.event.completed",
  CANCELLED: "rider.history.event.cancelled",
};

export type EventLabel =
  | { readonly known: true; readonly key: string }
  | { readonly known: false; readonly key: string; readonly raw: string };

/** حدثٌ ⇒ مفتاحُ نصِّه. و`UNKNOWN` يُعرَضُ بنوعِه الخامِّ لا مطويّاً. */
export function eventLabel(event: { readonly kind: string; readonly rawKind: string }): EventLabel {
  const key = EVENT_KEYS[event.kind];
  if (key === undefined) {
    return { known: false, key: "rider.history.event.raw", raw: event.rawKind };
  }
  return { known: true, key };
}

/** مصدرُ الحدثِ ⇒ مفتاحُ نصِّه: «من ختمِ الطلبِ» أو «من سجلِّ التدقيقِ». */
/**
 * مصادرُ الحدثِ **كما تنطقُ بها الهجرةُ حرفاً** — وهيَ تُسمّي العمودَ لا نوعَه،
 * لأنَّ المراجِعَ في نزاعٍ يسألُ «من أينَ هذا الوقتُ؟» فيُجابُ باسمِ الحقلِ.
 *
 * وقد كُتِبَت أوّلَ مرّةٍ `ORDER_STAMP` و`AUDIT_LOG` تخميناً، فكانَ كلُّ حدثٍ
 * يُعرَضُ «مصدراً آخرَ» — **عطبٌ لا يُخفِقُ به بناءٌ**: نصٌّ صحيحٌ خاطئُ المعنى.
 */
const EVENT_SOURCE_KEYS: Readonly<Record<string, string>> = {
  "orders.created_at": "rider.history.eventSource.orderStamp",
  "orders.matched_at": "rider.history.eventSource.orderStamp",
  "orders.started_at": "rider.history.eventSource.orderStamp",
  "orders.completed_at": "rider.history.eventSource.orderStamp",
  audit_log: "rider.history.eventSource.auditLog",
  UNRECORDED: "rider.history.eventSource.unrecorded",
};

export function eventSourceKey(source: string): string {
  return EVENT_SOURCE_KEYS[source] ?? "rider.history.eventSource.other";
}

const TIMEZONE_TRUST_KEYS: Readonly<Record<string, string>> = {
  DECLARED: "rider.history.timezone.declared",
  FALLBACK: "rider.history.timezone.fallback",
};

export function timezoneTrustKey(trust: string): string {
  return TIMEZONE_TRUST_KEYS[trust] ?? "rider.history.timezone.fallback";
}

/**
 * وهل تُعرَضُ لافتةُ منطقةِ التصنيفِ؟ **حينَ تكونُ بديلاً وحدَه.**
 *
 * ولافتةٌ دائمةٌ تقولُ «بساعةِ جدّةَ» في كلِّ زيارةٍ ضجيجٌ يُتعلَّمُ تجاهلُه،
 * فتُقرأُ أيضاً حينَ تصيرُ إنذاراً. فالإنذارُ يُعرَضُ حينَ يكونُ إنذاراً.
 */
export function showsTimezoneNotice(trust: string): boolean {
  return trust !== "DECLARED";
}

const HISTORY_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_PAGE_SIZE: "rider.history.refusal.pageSize",
  INVALID_CURSOR: "rider.history.refusal.cursor",
  QUERY_TOO_LONG: "rider.history.refusal.queryTooLong",
};

export function historyRefusalKey(code: string): string {
  return HISTORY_REFUSAL_KEYS[code] ?? "rider.history.refusal.unknown";
}

const DETAIL_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  INVALID_ORDER_ID: "rider.history.detailRefusal.invalidId",
  ORDER_NOT_FOUND: "rider.history.detailRefusal.notFound",
};

export function detailRefusalKey(code: string): string {
  return DETAIL_REFUSAL_KEYS[code] ?? "rider.history.detailRefusal.unknown";
}

const ERROR_KEYS: Readonly<Record<string, string>> = {
  SESSION_REQUIRED: "rider.history.error.session",
  SESSION_INVALID: "rider.history.error.session",
  SESSION_EXPIRED: "rider.history.error.session",
  SESSION_NOT_AVAILABLE: "rider.history.error.unavailable",
  MALFORMED: "rider.history.error.malformed",
  INVALID_JSON: "rider.history.error.malformed",
  ACCOUNT_NOT_FOUND: "rider.history.error.account",
  RIDER_NOT_REGISTERED: "rider.history.error.notRegistered",
  RIDE_STORE_NOT_AVAILABLE: "rider.history.error.unavailable",
};

export function historyErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? "rider.history.error.unavailable";
}

/**
 * أجزاءُ اللحظةِ للعرضِ — **بساعةِ التصنيفِ المُعلَنةِ** لا بساعةِ الجهازِ.
 *
 * ولو نُسِّقَت باللغةِ محليّاً لَاختلفَ سطرٌ عن عنوانِ شهرِه: بطاقةٌ في «سبتمبر»
 * وسطرٌ يقولُ «١ أكتوبر» في الهاتفِ نفسِه. **والأرقامُ تُعادُ أعداداً** فتُصاغَ
 * في النصِّ المُترجَمِ بأرقامِ لغتِه.
 */
export interface InstantParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function instantParts(iso: string, timeZone: string): InstantParts | null {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  let formatter: Intl.DateTimeFormat;
  try {
    // منطقةٌ مجهولةٌ تُسقِطُ المُنسِّقَ — فيُعادُ `null` **ولا تُستبدَلُ**
    // بمنطقةِ الجهازِ: لحظةٌ بساعةٍ غيرِ المُعلَنةِ أسوأُ من لحظةٍ لا تُعرَضُ.
    formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
  } catch {
    return null;
  }
  const read: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(parsed))) {
    if (part.type !== "literal") {
      const value = Number(part.value);
      if (Number.isFinite(value)) read[part.type] = value;
    }
  }
  const { year, month, day, hour, minute } = read;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  // منتصفُ الليلِ يُنشَرُ `24` في بعضِ التنفيذاتِ — يُطوى إلى `0` صريحاً.
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute };
}
