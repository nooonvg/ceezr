/**
 * الغرض: نموذجُ عرضِ شاشةِ المَهمّةِ النشطةِ — دالّاتٌ نقيّةٌ تُحوِّلُ الردَّ
 *   والرمزَ إلى مفاتيحِ نصٍّ وقراراتٍ، بلا JSX وبلا شبكةٍ **وبلا ساعةٍ**
 *   (البند `F3-03` · `SD-05`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-03`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/job
 * يُستخدم من: `JobScreen.tsx`، ويُقاسُ مباشرةً في `tests/unit`.
 * يُتوقع أن يستخدمه لاحقاً: `SD-06` — سطرُ الطَورِ عينُه يُعادُ في سجلِّ الرحلاتِ.
 * يحرسُه: scripts/check-driver-job-contract.ts · scripts/check-egress-boundary.ts
 * الحاكم: docs/adr/0118-a-phase-is-a-human-stamp-not-a-distance-inference.md
 *
 * ## لِمَ الزرُّ الواحدُ يُشتَقُّ من `next_action` **وحدَه**
 *
 * لأنَّ آلةَ الحالاتِ **مصدرُ حقيقةٍ واحدٌ في القاعدةِ**: لو استنبطَت الشاشةُ
 * زرَّها من `status` وأختامِ الزمنِ لَصارَت نسخةً ثانيةً تتقادَمُ، فيُعرَضُ
 * «بدأتُ الرحلةَ» على مَهمّةٍ لم يُختَم وصولُها. وثلاثةُ أزرارٍ معروضةٍ معاً كانت
 * ستدعو إلى ضغطةٍ خاطئةٍ تُردُّ `PHASE_MISMATCH` فتُقرأُ عطلاً في التطبيقِ.
 *
 * ## ولِمَ الملاحةُ **رابطٌ خارجيٌّ** لا خريطةٌ مُضمَّنةٌ
 *
 * خريطةٌ مُضمَّنةٌ في التطبيقِ المصغَّرِ تعني أصلاً من أصلٍ ثانٍ (`F1-10`) ومفتاحَ
 * مُزوِّدٍ في العميلِ وحُزمةً تكبُرُ — وكلُّ ذاكَ لِيُرى ما يراهُ السائقُ في
 * تطبيقِ الملاحةِ الذي يعرفُه أصلاً. فالرابطُ يُبنى ههنا نصّاً، ويُفتَحُ
 * بـ`openExternalLink` (وهيَ تمنعُ ما ليسَ `http`/`https`)، **ولا نداءَ شبكةٍ من
 * هذه العمليّةِ** — ولذلكَ قيدُه في سجلِّ المخارجِ `USER_LINK` · `system: "NONE"`.
 *
 * ## وما لا يفعلُه هذا الملفُّ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يقرأُ ساعةً**: لا `Date.now()` ولا `new Date()` — لا مؤقّتَ في هذا
 *      السطحِ ألبتّةَ، والأختامُ تُعرَضُ نصّاً كما وردَت.
 *   ــ **لا يُقرِّرُ طَوراً**: `next_action` حكمُ خادمٍ يُنقَلُ لا يُشتَقُّ.
 *   ــ **لا يستنتجُ وصولاً من قُربٍ**: `ADR 0118` يمنعُه — الوصولُ ختمُ إنسانٍ.
 *   ــ **لا يعرفُ أجرةً** (`ADR 0039` §٤ · `م13-7` · `DEC-11`).
 *   ــ **لا يُقدِّرُ مدّةَ وصولٍ ولا مسافةً**: امتناعٌ مُصنَّفٌ (`ADR 0024`).
 *   ــ **لا يُظهِرُ هاتفاً ولا معرِّفَ تلغرامَ**: العقدُ لا يحملُهما أصلاً.
 */

import {
  isSosIncidentStatus,
  isSosTeamDeliveryStatus,
  type SosIncidentNarrative,
  sosIncidentNarrative,
} from "../../../../../../packages/domain/safety/sos-surface.ts";
import { type OfferLine, offerLine } from "../offers/offers-view.ts";
import type { ApiDriverActiveJob, ApiDriverJobAction, ApiDriverJobPlace } from "./job-contract.ts";

/** رموزُ العطبِ التي لهذه الشاشةِ نصٌّ لها — مُقابِلةٌ لقائمةِ الطبقةِ حرفاً. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set([
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "SESSION_INVALID",
  "SESSION_NOT_AVAILABLE",
  "JOB_STORE_NOT_AVAILABLE",
  "NOT_A_DRIVER",
  "ORDER_ID_INVALID",
  "JOB_NOT_FOUND",
  "PHASE_MISMATCH",
  "ALREADY_ARRIVED",
  "TRANSITION_REFUSED",
]);

export function jobErrorKey(code: string): string {
  return KNOWN_ERRORS.has(code) ? `driver.job.error.${code}` : "driver.job.error.UNKNOWN";
}

/**
 * أيُّ الأعطابِ **تُعادُ المحاولةُ فيه بزرٍّ**. وتعارُضُ الطَورِ ليسَ منها:
 * إعادةُ الفعلِ عينِه تردُّ الرفضَ عينَه، والصوابُ **إعادةُ قراءةِ المَهمّةِ**
 * كي ترى الشاشةُ الطَورَ الذي صارَت إليه القاعدةُ.
 */
export function isRetryableJobError(code: string): boolean {
  return (
    code === "JOB_STORE_NOT_AVAILABLE" || code === "SESSION_NOT_AVAILABLE" || code === "UNKNOWN"
  );
}

/**
 * هل يُعادُ تحميلُ المَهمّةِ بعدَ رفضٍ. وتعارُضُ الطَورِ وسبقُ الوصولِ **يُوجِبانِ
 * إعادةَ القراءةِ**: كِلاهما يعني أنَّ ما في الشاشةِ أقدمُ من القاعدةِ.
 */
export function shouldReloadAfterJobError(code: string): boolean {
  return code === "PHASE_MISMATCH" || code === "ALREADY_ARRIVED" || code === "JOB_NOT_FOUND";
}

/** مفتاحُ نصِّ الزرِّ ومفتاحُ عنوانِ الطَورِ — لكلِّ فعلٍ اسمُه لا رمزُه. */
export const JOB_ACTION_LABEL_KEY: Readonly<Record<ApiDriverJobAction, string>> = {
  MARK_ARRIVED: "driver.job.action.MARK_ARRIVED",
  START_RIDE: "driver.job.action.START_RIDE",
  COMPLETE_RIDE: "driver.job.action.COMPLETE_RIDE",
};

export const JOB_PHASE_KEY: Readonly<Record<ApiDriverJobAction, string>> = {
  MARK_ARRIVED: "driver.job.phase.toPickup",
  START_RIDE: "driver.job.phase.atPickup",
  COMPLETE_RIDE: "driver.job.phase.onTrip",
};

/**
 * رابطُ الملاحةِ **يأتي من الخادمِ ولا يُركَّبُ ههنا** (`F1-10` · `TG-005`):
 * حزمةُ المصغَّرِ لا تحملُ عنواناً مطلقاً لِمُضيفٍ ثالثٍ، والمُضيفُ يُقرأُ في
 * سجلِّ المخارجِ عندَ موضعِه في البوّابةِ. وههنا **نقلٌ لا بناءٌ**.
 */
export interface JobPlaceModel {
  readonly label: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly navigationUrl: string;
  readonly link: string | null;
  readonly notes: string | null;
  readonly openUrl: string | null;
}

function toPlace(place: ApiDriverJobPlace): JobPlaceModel {
  return {
    label: place.label,
    latitude: place.latitude,
    longitude: place.longitude,
    navigationUrl: place.navigation_url,
    link: place.link ?? null,
    notes: place.notes ?? null,
    openUrl: place.open_url ?? null,
  };
}

export interface ActiveJobModel {
  readonly orderId: string;
  readonly serviceKey: string;
  readonly statusKey: string;
  readonly phaseKey: string;
  readonly action: ApiDriverJobAction;
  readonly actionLabelKey: string;
  /** النقطةُ التي **تُلاحُ إليها الآنَ** — بحكمِ الفعلِ القادمِ لا بتقديرٍ. */
  readonly navigateTo: JobPlaceModel;
  readonly pickup: JobPlaceModel;
  readonly dropoff: JobPlaceModel | null;
  readonly matchedAt: string | null;
  readonly arrivedAt: string | null;
  readonly startedAt: string | null;
  readonly notes: string | null;
  /** `null` = راكبٌ بلا اسمٍ مُسجَّلٍ — تُقالُ «راكبٌ» ولا يُخترَعُ اسمٌ. */
  readonly riderFirstName: string | null;
  readonly riderLanguageCode: string | null;
  /** `WR-05` — معنى المبلغِ بعدَ القبول. */
  readonly offerTerms: OfferLine | null;
}

/**
 * والنقطةُ المُلاحُ إليها تتبعُ **الفعلَ القادمَ**: قبلَ بدءِ الرحلةِ الهدفُ
 * نقطةُ الالتقاطِ، وبعدَ بدئِها هدفُ النزولِ إن وُجِدَ — وإلّا فالالتقاطُ يبقى
 * (خدمةٌ بلا نقطةِ نزولٍ حالٌ قائمةٌ، ورابطٌ إلى «لا شيءَ» عطبٌ).
 */
export function toActiveJob(job: ApiDriverActiveJob): ActiveJobModel {
  const pickup = toPlace(job.pickup);
  const dropoff = job.dropoff === null ? null : toPlace(job.dropoff);
  const navigateTo = job.next_action === "COMPLETE_RIDE" ? (dropoff ?? pickup) : pickup;
  return {
    orderId: job.order_id,
    serviceKey: `driver.job.service.${job.service}`,
    statusKey: `driver.job.status.${job.status}`,
    phaseKey: JOB_PHASE_KEY[job.next_action],
    action: job.next_action,
    actionLabelKey: JOB_ACTION_LABEL_KEY[job.next_action],
    navigateTo,
    pickup,
    dropoff,
    matchedAt: job.matched_at,
    arrivedAt: job.arrived_at,
    startedAt: job.started_at,
    notes: job.notes,
    riderFirstName: job.rider.first_name,
    riderLanguageCode: job.rider.language_code,
    offerTerms: offerLine(job.offer_mode, job.offer_sar),
  };
}

/**
 * `PD-020` · `ADR 0159` — سردُ مآلِ بلاغِ «تعذّرَ الإكمالُ» ⇒ مفتاحُ نصٍّ.
 * **مُشتَقٌّ في النطاقِ لا ههنا** — الاشتقاقُ نفسُهُ الذي يَقرأُهُ راكبٌ في
 * بطاقتِهِ (`sos-view.ts`): سؤالٌ واحدٌ («أُنشئَ؟ سُلِّمَ؟ اطَّلعَ؟») يُجابُ
 * بجوابٍ واحدٍ، والنصُّ وحدَهُ يختلفُ لأنَّهُ بلسانِ السائقِ ومخاطَبُهُ فريقُ
 * الإسنادِ — لا فريقُ السلامةِ الذي يخاطِبُ الراكبَ.
 */
const CANNOT_COMPLETE_NARRATIVE_KEYS: Readonly<Record<SosIncidentNarrative, string>> = {
  SENDING: "driver.job.cannotComplete.delivery.pending",
  DELIVERED_TO_TEAM: "driver.job.cannotComplete.delivery.delivered",
  TEAM_REVIEWING: "driver.job.cannotComplete.status.received",
  CLOSED: "driver.job.cannotComplete.status.closed",
};

export function cannotCompleteNarrativeKey(status: string, teamDeliveryStatus: string): string {
  // قيمةٌ لا يعرفُها النطاقُ تُقالَ «نُرسِلُ بلاغَكَ» لا فراغاً: صِدقُ الجوابِ
  // في أسوأِ حالٍ أنَّ البلاغَ **يُتابَعُ**، لا أنَّهُ ضاعَ.
  if (!isSosIncidentStatus(status) || !isSosTeamDeliveryStatus(teamDeliveryStatus)) {
    return "driver.job.cannotComplete.delivery.pending";
  }
  return CANNOT_COMPLETE_NARRATIVE_KEYS[sosIncidentNarrative(status, teamDeliveryStatus)];
}

/**
 * رفضُ حاكمِ فعلِ التعذُّرِ ⇒ مفتاحُ نصٍّ — **مُقابِلَةٌ لقائمةِ الطبقةِ حرفاً**
 * كما أخواتِها في هذا المِلفِّ. والرفضُ جوابٌ لا عطبُ طلبٍ: يُقالُ نصُّهُ
 * ولا يُدرَّبُ السائقُ على إعادةِ الصياغةِ برمزِ حالةٍ يقودُ إلى إعادةِ محاولةٍ.
 */
export function cannotCompleteRefusalKey(refusal: string): string {
  if (refusal === "NOT_A_DRIVER" || refusal === "ACTOR_BLOCKED") {
    return "driver.job.cannotComplete.refusal.notAllowed";
  }
  if (refusal === "JOB_NOT_FOUND") return "driver.job.cannotComplete.refusal.jobNotFound";
  if (refusal === "CITY_NOT_READY") return "driver.job.cannotComplete.refusal.cityNotReady";
  if (refusal === "REPORT_REJECTED") return "driver.job.cannotComplete.refusal.rejected";
  return "driver.job.cannotComplete.refusal.rejected";
}

/**
 * حالةُ زرِّ الاستغاثةِ (`DEC-29` · `ADR 0226`) — نصٌّ يُعرَضُ للسائقِ حسبَ
 * نتيجةِ الطلبِ. نفسُ العقدِ الذي يستخدمهُ الراكبُ لا نسخةٌ ثانيةٌ (القاعدةُ 0.6).
 */
export type SosButtonState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "sent"; readonly created: boolean }
  | { readonly kind: "refused"; readonly refusal: string }
  | { readonly kind: "failed" };

/**
 * مفتاحُ نصِّ حالةِ الاستغاثةِ — يُقابِلُ قائمةَ الطبقةِ حرفاً.
 * يعودُ `null` للولاياتِ التي لا نصَّ لها (idle, busy).
 */
export function sosStateKey(state: SosButtonState): string | null {
  switch (state.kind) {
    case "idle":
      return null;
    case "busy":
      return null;
    case "sent":
      return state.created ? "driver.job.sos.sent" : "driver.job.sos.alreadyOpen";
    case "refused":
      return "driver.job.sos.refused";
    case "failed":
      return "driver.job.sos.failed";
  }
}

/**
 * هل الزرُّ معطَّلٌ؟ — `true` في `busy` و `sent` (لا ضغطتانِ).
 */
export function isSosButtonDisabled(state: SosButtonState): boolean {
  return state.kind === "busy" || state.kind === "sent";
}

/**
 * عمرُ ختمِ طَورٍ بالدقائقِ الكاملةِ **من لحظةِ الخادمِ** (`server_time`) — لا من ساعةِ الجهاز.
 * لوحة التسليم 06 (D3) لا تعرضُ ختمَ ISO خامّاً، والجهازُ قد تنحرفُ ساعتُه. فختمٌ معطوبٌ أو
 * لحظةُ خادمٍ معطوبةٌ أو ختمٌ **بعدَ** لحظةِ الخادمِ = `null`: عمرٌ لم يُقَس لا يُعرَضُ صفراً.
 */
export function stampAgeMinutes(stampIso: string, serverTimeIso: string): number | null {
  const stamp = Date.parse(stampIso);
  const server = Date.parse(serverTimeIso);
  if (!Number.isFinite(stamp) || !Number.isFinite(server)) return null;
  const elapsedMs = server - stamp;
  if (elapsedMs < 0) return null;
  return Math.floor(elapsedMs / 60_000);
}

/**
 * ADR 0249 (D3): لغةُ الراكبِ تُعرَضُ باسمِها لا برمزِها الخامّ («ar»). الرموزُ الثلاثةُ
 * التي يدعمُها التطبيقُ لها أسماءٌ في القاموس؛ ورمزٌ غيرُها يُعرَضُ كما ورد — لا اسمَ يُخترَع.
 */
const RIDER_LANGUAGE_KEYS: Readonly<Record<string, string>> = {
  ar: "driver.job.rider.language.ar",
  en: "driver.job.rider.language.en",
  ur: "driver.job.rider.language.ur",
};

export function riderLanguageText(code: string, t: (key: string) => string): string {
  const key = RIDER_LANGUAGE_KEYS[code.trim().toLowerCase()];
  return key === undefined ? code : t(key);
}
