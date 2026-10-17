/**
 * الغرض: حكمُ **الحذفِ بطلبِ صاحبِ البيانةِ** لكلِّ جدولٍ — `F2-11` (`SR-12`).
 *   وهوَ السجلُّ الذي حجزَه سجلُّ الاستبقاءِ لنفسِه نصّاً عندَ `user_consents`:
 *   «وحذفُ الحسابِ (القسم 9.12) حينَ يُنفَّذُ **يُحسَمُ فيه هناكَ**: أنَّ
 *   المستخدمَ يُحذَفُ لا يعني أنَّ إثباتَ موافقتِه يُمحى، **وذاكَ تعارضٌ
 *   حقيقيٌّ** لا يُفصَلُ فيه من ملفِّ استبقاءٍ». فهذا الملفُّ هوَ «هناكَ».
 * الحالة: منفّذ فعلياً — البند `F2-11`.
 * ينتمي إلى: packages/shared/config
 *
 * **الفرقُ بينَه وبينَ `retention-policy.ts` فرقُ موضوعٍ لا فرقُ نسخةٍ**، ولذا لم
 * يُدمَجا ولم يُكرَّرا: ذاكَ يحكمُ **المؤقِّتَ** — ما تُخرِجُه مهمّةٌ ليليّةٌ من
 * القاعدةِ بمرورِ الزمنِ (`DEC-15`)؛ وهذا يحكمُ **الطلبَ** — ما يجري حينَ يقولُ
 * إنسانٌ «احذفْ حسابي». والاثنانِ يتقاطعانِ ولا يتساويانِ: جدولٌ لا مؤقِّتَ له
 * (`lifecycle-bound-no-timer`) قد يُمحى بالطلبِ فوراً، وجدولٌ مدّتُه ستُّ سنينَ
 * **يستحيلُ** أن يُمحى بالطلبِ. ولذا يُقابِلُ الحاجزُ السجلَّينِ في الاتّجاهَينِ
 * ويردُّ تناقضَهما، فلا يتباعدانِ ولا يُغني أحدُهما عن الآخرِ.
 *
 * ما لا يفعلُه هذا الملفُّ عن قصدٍ:
 *   ــ **لا يُقرِّرُ مدّةً**: كلُّ مدّةٍ في `retention-policy.ts` وحدَه (`DEC-15`)،
 *      وما كانَ `pending-decision-f12-10` يبقى لـ`F12-10` لا يُحسَمُ ههنا.
 *   ــ **لا يُنفِّذُ حذفاً**: الحكمُ ههنا والتنفيذُ في دالّةِ القاعدةِ الذرّيّةِ،
 *      والحاجزُ يُقابِلُ النصَّ بالتنفيذِ فلا يبقى حكمٌ بلا يدٍ تُجريه.
 *   ــ **لا يحكمُ في حسابِ السائقِ**: ذاكَ `SD-12`؛ وجداولُه مُعلَنةٌ ههنا
 *      بحكمِها وبـ`deferredTo` صريحاً — **ديناً مكتوباً لا سهواً**.
 */

import { RETENTION_CLASSES, TABLE_RETENTION } from "./retention-policy.ts";

/**
 * أحكامُ الحذفِ. **خمسةٌ لا أربعةٌ**: الرابعُ والخامسُ ليسا حكماً على بيانةٍ
 * شخصيّةٍ بل إقرارٌ بأنَّه لا بيانةَ ههنا أصلاً — وفصلُهما عن `erase` هوَ ما
 * يمنعُ أن يُقرأَ «لا شيءَ ليُحذَفَ» بوصفِه «حُذِفَ».
 */
export const ERASURE_DISPOSITIONS = {
  /** الصفُّ يُحذَفُ حذفاً تامّاً: مِلكُ صاحبِه وحدَه ولا حقَّ لأحدٍ فيه. */
  erase: "erase-row",

  /**
   * الصفُّ **يبقى** وتُمحى منه بيانةُ التعريفِ. يُستعمَلُ حيثُ للطرفِ الآخرِ حقٌّ
   * في الصفِّ نفسِه: رحلةٌ لراكبٍ وسائقٍ، أو تقييمٌ متوسّطُ سائقٍ مبنيٌّ عليه.
   */
  anonymize: "anonymize-in-place",

  /**
   * الصفُّ يبقى كما هوَ **بأساسٍ نظاميٍّ مُعلَنٍ** يُسمّى في `basis` ويُعرَضُ على
   * المستخدمِ في إيصالِ الحذفِ. لا يُستعمَلُ راحةً: كلُّ مدخلٍ ههنا وجبَ أن
   * يُسمّي الأساسَ، والحاجزُ يردُّ الفارغَ.
   */
  retainLegalBasis: "retain-declared-legal-basis",

  /** لا صفَّ فيه لإنسانٍ: بيانةُ مرجعٍ أو تهيئةٍ أو حالةٍ آليّةٍ. */
  notPersonal: "no-personal-data",

  /**
   * جدولٌ في **المنطقةِ المؤجَّلةِ** (`deferred/`) — لا وجودَ له في قاعدةِ
   * الإنتاجِ، فلا صفَّ فيه ليُحذَفَ. والحاجزُ يُثبِتُ أنَّ الجدولَ مؤجَّلٌ فعلاً،
   * فيستحيلُ أن يستترَ جدولٌ حيٌّ خلفَ هذا الحكمِ.
   */
  deferredNotLive: "deferred-area-not-live",
} as const;

export type ErasureDisposition = (typeof ERASURE_DISPOSITIONS)[keyof typeof ERASURE_DISPOSITIONS];

/** صاحبُ البيانةِ. جدولٌ قد يخدمَ أكثرَ من صاحبٍ (تذكرةُ دعمٍ لراكبٍ وسائقٍ). */
export const DATA_SUBJECTS = {
  rider: "rider",
  driver: "driver",
  admin: "admin",
} as const;

export type DataSubject = (typeof DATA_SUBJECTS)[keyof typeof DATA_SUBJECTS];

export interface ErasureRule {
  readonly disposition: ErasureDisposition;
  /** أصحابُ البيانةِ في هذا الجدولِ. فارغةٌ ⇔ `notPersonal` أو `deferredNotLive`. */
  readonly subjects: readonly DataSubject[];
  /** مسارُ نسبةِ الصفِّ إلى إنسانٍ. نصٌّ مقروءٌ لأنَّ المسارَ قد يكونَ غيرَ مباشرٍ. */
  readonly linkedBy: string | null;
  /** الأساسُ. مطلوبٌ عندَ `anonymize` و`retainLegalBasis`، ومردودٌ فيما عداهما. */
  readonly basis: string | null;
  /**
   * قسمُ التنزيلِ الذي يُظهِرُ هذا الجدولَ. **مشتقٌّ لا مستقلٌّ**: كلُّ جدولٍ فيه
   * بيانةٌ شخصيّةٌ وجبَ أن يُنزَّلَ، والحاجزُ يُنفِذُ التطابقَ — فيستحيلُ أن نحكمَ
   * على جدولٍ بالحذفِ ولا نُرِيَ صاحبَه ما فيه.
   */
  readonly exportSection: string | null;
  /** البندُ الذي يُنفِّذُ هذا الحكمَ إن لم يكن `F2-11`. دينٌ مكتوبٌ لا سهوٌ. */
  readonly deferredTo: string | null;
}

const D = ERASURE_DISPOSITIONS;
const S = DATA_SUBJECTS;

/** لا صفَّ لإنسانٍ. */
function reference(): ErasureRule {
  return {
    disposition: D.notPersonal,
    subjects: [],
    linkedBy: null,
    basis: null,
    exportSection: null,
    deferredTo: null,
  };
}

/** جدولٌ مؤجَّلٌ لا وجودَ له في الإنتاجِ. */
function deferredArea(item: string): ErasureRule {
  return {
    disposition: D.deferredNotLive,
    subjects: [],
    linkedBy: null,
    basis: null,
    exportSection: null,
    deferredTo: item,
  };
}

/**
 * حكمُ كلِّ جدولٍ. **قائمةٌ مغلقةٌ مقابلةٌ لسجلِّ الاستبقاءِ حرفاً**: جدولٌ ههنا
 * وليسَ هناكَ — أو العكسُ — يُسقِطُ CI. فجدولٌ جديدٌ لا يُدخَلُ إلى المستودعِ إلّا
 * وقد حُكِمَ في مصيرِه عندَ طلبِ الحذفِ، ولا يُنسى نسياناً صامتاً.
 */
export const TABLE_ERASURE: Readonly<Record<string, ErasureRule>> = {
  /**
   * `F7-08`: عدَداتٌ ومجاميعُ لكلِّ مدينةٍ — **لا معرِّفَ إنسانٍ فيها ألبتّةَ**:
   * لا `user_id` ولا `driver_id` ولا `rider_id` ولا اسمَ ولا هاتفَ. الصفُّ
   * مجموعُ صفوفٍ لا صفٌّ عن أحدٍ، فحذفُ حسابٍ **لا يمسُّه** ولا يُنقِصُ منه رقماً
   * إلّا بإعادةِ الحسابِ من الجداولِ الأصليّةِ في الشوطِ التالي — وذلكَ يقعُ
   * بذاتِه لأنَّ الحذفَ يُسقِطُ الصفوفَ التي تُعَدُّ.
   *
   * **وعدَدٌ لا يُنسَبُ إلى إنسانٍ ليسَ بيانةً شخصيّةً**: «تسعةَ عشرَ سائقاً
   * متاحاً في مكّةَ» لا يُعرِّفُ أحداً ولا يُعادُ تعريفُه. ولذلكَ لا قسمَ تنزيلٍ
   * لهُ ولا أساسَ نظاميَّ يُطلَبُ.
   */
  admin_metric_snapshots: reference(),
  // ───────── حسابُ المشرفِ: جلسةٌ ورمزُ دخولٍ، مِلكُ صاحبِه وحدَه ─────────
  /**
   * `SEC-21` · `ADR 0176`: اعتمادُ البابِ الموازي (break-glass) — كلمةُ سرٍّ
   * مُهضَمةٌ وسرُّ TOTP مُشفَّرٌ. **المحوُ لا الانتظارُ**: تركُ اعتمادِ دخولٍ
   * بعدَ محوِ صاحبِهِ بابٌ معلّقٌ — والمفتاحُ الأجنبيُّ `on delete cascade`
   * المُعلَنُ في الهجرةِ يأخذُهُ معَ الحسابِ. ولا أساسَ للإبقاءِ: ما يبقى
   * بعدَ الحذفِ هو أثرُ القراراتِ في `audit_log` لا مفتاحُ بابٍ.
   */
  admin_break_glass_credentials: {
    disposition: D.erase,
    subjects: [S.admin],
    linkedBy: "admin_break_glass_credentials.user_id",
    basis: null,
    exportSection: "adminSessions",
    deferredTo: "F12-10",
  },
  admin_login_codes: {
    disposition: D.erase,
    subjects: [S.admin],
    linkedBy: "admin_login_codes.user_id",
    basis: null,
    exportSection: "adminSessions",
    deferredTo: "F12-10",
  },
  admin_sessions: {
    disposition: D.erase,
    subjects: [S.admin],
    linkedBy: "admin_sessions.user_id",
    basis: null,
    exportSection: "adminSessions",
    deferredTo: "F12-10",
  },

  agent_decisions: reference(),
  /**
   * `SEC-20`: طلبُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ — **الصاحبُ المُنفِّذُ هوَ
   * المشرفُ**: الطلبُ يُنشَأُ ويُراجَعُ من مسؤولٍ، ولا يُنشئهُ صاحبُ الحسابِ
   * ولا يملكُ قراره. وفيه بيانةٌ شخصيّةٌ عن الهدفِ (`claimant_telegram_id` ·
   * ملخّصُ الأدلّةِ)، فلا بيانةً مرجعٍ ولا «لا صاحبَ». والحكمُ **إبقاءٌ بأساسٍ**:
   * سجلُّ القرارِ دليلُ مراجعةٍ بشريّةٍ على ربطِ هويّةٍ خارجيّةٍ بمستخدمٍ داخليٍّ —
   * ومحوُهُ يمحو شهادةَ المراجعةِ نفسِها. وأثرُ الحذفِ مُسجَّلٌ **أصلًا** في
   * `audit_log` (`admin.account_recovery_approved/rejected`) الذي لا يُمَسُّ.
   * والتنزيلُ والإنفاذُ دَينٌ مُعلَنٌ على `F12-10` لا وعدٌ بلا اسمٍ.
   */
  account_recovery_requests: {
    disposition: D.retainLegalBasis,
    subjects: [S.admin],
    linkedBy: "account_recovery_requests.target_user_id",
    basis:
      "سجلُّ طلبِ استردادٍ ومراجعةٍ إداريّةٍ — دليلُ قرارٍ بشريٍّ على ربطِ هويّةٍ خارجيّةٍ بمستخدمٍ داخليٍّ لا بياناتُ تشغيلٍ.",
    exportSection: "accountRecoveryRequests",
    deferredTo: "F12-10",
  },
  agent_outcomes: {
    disposition: D.retainLegalBasis,
    subjects: [S.admin],
    linkedBy: "agent_outcomes.recorded_by_user_id",
    basis: "سجلُّ نتيجةِ قرارٍ آليٍّ ومَن قيَّدَها — دليلُ مراجعةٍ لا بيانةُ حسابٍ.",
    exportSection: "agentOutcomes",
    deferredTo: "F12-10",
  },
  attendance_log: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "attendance_log.driver_id → drivers.user_id",
    basis: "سجلُّ حضورٍ يُبنى عليه استحقاقٌ ماليٌّ للسائقِ.",
    exportSection: "driverAttendance",
    deferredTo: null,
  },

  /**
   * سجلُّ التدقيقِ **لا يُمَسُّ**: هوَ عينُ الدليلِ على أنَّ الحذفَ نفسَه جرى.
   * ومحوُ أثرِ المحوِ يُبطِلُ الحقَّ الذي يُنفَّذُ ههنا لا يُتِمُّه.
   */
  audit_log: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver, S.admin],
    linkedBy: "audit_log.actor_user_id",
    basis: "سجلُّ تدقيقٍ غيرُ محدودِ المدّةِ حتّى `F12-10` — وهوَ دليلُ تنفيذِ الحذفِ نفسِه.",
    exportSection: "auditTrail",
    deferredTo: null,
  },

  /**
   * `F12-09`: طلبُ تزويدِ الهيئةِ بالبياناتِ — سجلُّ طلبٍ تشغيليٌّ.
   * `requested_by` مرجعُ منشئِ الطلبِ، والحزمةُ بياناتٌ مُجمَّعةٌ لا بياناتِ
   * شخصٍ. فالحذفُ لا يمسُّ الحزمةَ ولا الطلبَ.
   */
  authority_data_requests: reference(),

  /**
   * `F12-08`: حادثُ اختراقِ بياناتٍ شخصيّةٍ — سجلُّ حادثٍ وتقييمُ خطرٍ وإبلاغٌ
   * الهيئةِ وأصحابِ البياناتِ. `detected_by` مرجعُ من اكتشفَ الحادثَ، والبياناتُ
   * فيه تخصُّ الحادثَ لا صاحبَ الحادث. والمادةُ ٢٤ من اللائحةِ التنفيذيّةِ
   * لـPDPL تُلزِمُ بالاحتفاظِ بنسخِ البلاغاتِ والإجراءاتِ التصحيحيّةِ والأدلّةِ.
   * فالحذفُ لا يمسُّ الحادثَ ولا إبلاغَه.
   */
  breach_incidents: reference(),

  pdpl_processing_activities: reference(),
  pdpl_data_subject_requests: reference(),
  pdpl_dpia_assessments: reference(),
  pdpl_cross_border_transfers: reference(),

  broadcast_campaigns: {
    disposition: D.retainLegalBasis,
    subjects: [S.admin],
    linkedBy: "broadcast_campaigns.created_by_user_id",
    basis: "حملةٌ تشغيليّةٌ ومَن أنشأَها — سجلُّ مسؤوليّةٍ عن رسالةٍ أُرسِلَت.",
    exportSection: "broadcastCampaigns",
    deferredTo: "F12-10",
  },
  /**
   * `chat_id` معرّفُ محادثةٍ في تيليجرام: بيانةُ تعريفٍ صريحةٌ. والصفُّ يبقى
   * لأنَّه إثباتُ **تسليمِ** رسالةٍ (وعدمِ تكرارِها)، فيُجهَّلُ ولا يُحذَفُ.
   */
  broadcast_recipients: {
    disposition: D.anonymize,
    subjects: [S.rider, S.driver],
    linkedBy: "broadcast_recipients.user_id",
    basis: "إثباتُ تسليمٍ ومنعُ تكرارِه — يبقى الصفُّ ويُمحى معرّفُ المحادثةِ.",
    exportSection: "broadcastsReceived",
    deferredTo: null,
  },

  cities: reference(),
  city_service_areas: reference(),
  core_event_inbox: deferredArea("W-5"),
  db_backups: reference(),
  destination_landmarks: reference(),
  /**
   * ADR 0243: مدّةٌ مقدَّرةٌ ولحظتُها لساقِ طلبٍ — لا عمودَ تعريفٍ ولا نصَّ ولا موضع. نسبتُها إلى
   * إنسانٍ تمرُّ بـ`orders` وحدَه، وتنقطعُ بتجهيلِه (`anonymize-in-place`) كبقيّةِ أثرِ الرحلة.
   */
  escalation_card_closures: reference(),
  eta_observations: reference(),

  group_memberships: {
    disposition: D.erase,
    subjects: [S.driver],
    linkedBy: "group_memberships.driver_id → drivers.user_id",
    basis: null,
    exportSection: "groupMemberships",
    deferredTo: null,
  },

  driver_availability: {
    disposition: D.erase,
    subjects: [S.driver],
    linkedBy: "driver_availability.driver_id → drivers.user_id",
    basis: null,
    exportSection: "driverAvailability",
    deferredTo: null,
  },
  driver_capabilities: {
    disposition: D.erase,
    subjects: [S.driver],
    linkedBy: "driver_capabilities.driver_id → drivers.user_id",
    basis: null,
    exportSection: "driverCapabilities",
    deferredTo: null,
  },
  /**
   * `F3-01`: وثائقُ السائقِ. **تُمحى محواً تامّاً** — لا أساسَ إبقاءٍ لها: الصفُّ
   * حكمُ أهليّةٍ لسائقٍ قائمٍ، ومن مضى حسابُه لا أهليّةَ تُحكَمُ له.
   *
   * وحدٌّ يُقالُ ولا يُضمَرُ: حذفُ الصفِّ **لا يحذفُ الجسمَ من المخزنِ** — المسارُ
   * في العمودِ والملفُّ في دلوٍ خاصٍّ، فمحوٌ يمسحُ الصفَّ وحدَه يُبقي صورةَ رخصةٍ
   * في مخزنٍ بلا مرجعٍ يدلُّ عليها. فحذفُ الأجسامِ بندٌ من `SD-12` نفسِه لا
   * ملحوظةٌ ههنا، وهوَ مكتوبٌ في دليلِ `F3-01`.
   */
  driver_document_reviewers: {
    disposition: D.retainLegalBasis,
    subjects: [S.admin],
    linkedBy: "driver_document_reviewers.user_id",
    basis:
      "سجلُّ صلاحيّةٍ إداريّةٍ على وثائقِ السائقين — دليلُ من كانَ مخوَّلاً بالقراءةِ والحكمِ ومتى، لا بياناتُ تشغيل.",
    exportSection: "adminSessions",
    deferredTo: "F12-10",
  },
  driver_documents: {
    disposition: D.erase,
    subjects: [S.driver],
    linkedBy: "driver_documents.driver_id → drivers.user_id",
    basis: null,
    exportSection: "driverDocuments",
    deferredTo: null,
  },
  driver_location_history: {
    disposition: D.erase,
    subjects: [S.driver],
    linkedBy: "driver_location_history.driver_id → drivers.user_id",
    basis: null,
    exportSection: "driverLocationHistory",
    deferredTo: null,
  },
  drivers: {
    disposition: D.anonymize,
    subjects: [S.driver],
    linkedBy: "drivers.user_id",
    basis: "أثرٌ ماليٌّ وتقييمٌ للطرفِ الآخرِ معلَّقانِ بالصفِّ — يُجهَّلُ ولا يُحذَفُ.",
    exportSection: "driverProfile",
    deferredTo: null,
  },

  job_heartbeats: reference(),

  ledger_entries: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "ledger_entries.driver_id → drivers.user_id",
    basis: "قيدٌ ماليٌّ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ (`financial-min-6y-in-kingdom`).",
    exportSection: "ledgerEntries",
    deferredTo: null,
  },
  location_archive_manifest: reference(),
  move_event_outbox: deferredArea("W-5"),
  notification_kind_policy: reference(),
  notification_outbox: {
    disposition: D.anonymize,
    subjects: [S.driver],
    linkedBy: "notification_outbox.driver_id → drivers.user_id",
    basis: "صندوقُ صادرٍ هوَ دليلُ عدمِ تكرارِ الإرسالِ — يُجهَّلُ ولا يُحذَفُ.",
    exportSection: "notificationsSent",
    deferredTo: null,
  },
  operational_jobs: deferredArea("W-4"),

  /**
   * **صُحِّحَ حُكمُه يومَ 2026-09-16 عندَ تنفيذِ `SD-12`، والحكمُ السابقُ يبقى
   * مذكوراً لا ممحوّاً** (`ح-8`): كانَ `anonymize-in-place`، وحينَ جاءَ وقتُ
   * التنفيذِ لم يُوجَدْ في الصفِّ **عمودٌ يُجهَّلُ**: لا اسمَ ولا هاتفَ ولا
   * مقصدَ إيصالٍ — بل معرّفُ صفِّ سياقةٍ ورقمُ جولةٍ ونتيجةٌ ووقتٌ. ونسبتُه إلى
   * إنسانٍ تنقطعُ عندَ **الجذرِ** (`drivers` و`users` يُجهَّلانِ)، فلا كتابةَ
   * ههنا تُزيدُ خصوصيّةً. وكتابةٌ صوريّةٌ تُرضي حاجزاً **كذبٌ مقيسٌ** (`ح-5`)،
   * فالصوابُ أن يُقالَ: يبقى بأساسٍ.
   */
  /**
   * `WR-04`: ما كتبَه المستخدمُ في محادثةِ طلبٍ — نصٌّ حرٌّ مِلكُه، يُمحى صفّاً
   * في `erase_my_account` ويُنزَّلُ له وحدَه (لا رسائلُ الطرفِ الآخر).
   */
  order_messages: {
    disposition: D.erase,
    subjects: [S.rider, S.driver],
    linkedBy: "order_messages.sender_user_id",
    basis: null,
    exportSection: "orderMessages",
    deferredTo: null,
  },
  order_message_reads: {
    disposition: D.erase,
    subjects: [S.rider, S.driver],
    linkedBy: "order_message_reads.user_id",
    basis: null,
    exportSection: "orderMessages",
    deferredTo: null,
  },
  order_offers: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "order_offers.driver_id → drivers.user_id",
    basis:
      "سجلُّ عرضٍ ورَدٍّ — شهادةٌ على إسنادٍ مضى يُنازَعُ فيه راكبٌ أو سائقٌ آخرُ، ولا عمودَ تعريفٍ فيه يُجهَّلُ: نسبتُه تنقطعُ بتجهيلِ الجذرِ.",
    exportSection: "orderOffers",
    deferredTo: null,
  },
  /**
   * ADR 0287 — إيصالُ حدثِ رحلةٍ أقرَّ بهِ تطبيقُ الراكبِ بعدَ تطبيقِ اللقطةِ: شهادةُ
   * تسليمٍ كأختِهِ `driver_offers_board_receipts`، ولا نصَّ فيهِ ولا موقعَ.
   */
  rider_trip_event_receipts: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider],
    linkedBy: "rider_trip_event_receipts.rider_user_id → users.id",
    basis:
      "دليلُ وصولِ حدثِ طورِ رحلةٍ إلى الراكبِ عبرَ Mini App — شهادةُ تسليمٍ لا تحملُ نصًّا ولا موقعًا: معرّفُ صفٍّ وطلبٍ ونوعُ الحدثِ ووقتُ الإقرارِ، ونسبتُه تنقطعُ بتجهيلِ الجذرِ.",
    exportSection: "notificationsSent",
    deferredTo: null,
  },
  driver_offers_board_receipts: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "driver_offers_board_receipts.driver_id → drivers.user_id",
    basis:
      "دليلُ وصولِ عرضٍ إلى سائقٍ عبرَ اللوحِ — شهادةُ تسليمٍ كأختِهِ `order_offers`، ولا عمودَ تعريفٍ فيه يُجهَّلُ: نسبتُه تنقطعُ بتجهيلِ الجذرِ.",
    exportSection: "orderOffers",
    deferredTo: null,
  },

  /**
   * **الصفُّ المشتركُ بعينِه**: رحلةٌ ليسَت مِلكَ راكبٍ وحدَه — للسائقِ فيها
   * استحقاقٌ، وللمشغِّلِ فيها أثرٌ ماليٌّ. فيُمحى منها **ما كتبَه الراكبُ بيدِه**
   * (ملاحظتُه وتسميتاه) لأنَّه نصٌّ حرٌّ قد يُسمّي إنساناً أو منزلاً، ويبقى
   * الباقي — **وقد انقطعَت نسبتُه إلى إنسانٍ مُعرَّفٍ** بتجهيلِ `users` نفسِه.
   */
  orders: {
    disposition: D.anonymize,
    subjects: [S.rider],
    linkedBy: "orders.rider_id → riders.user_id",
    basis:
      "للسائقِ في الرحلةِ استحقاقٌ وللمشغِّلِ أثرٌ ماليٌّ — يُمحى نصُّ الراكبِ الحرُّ وتبقى الرحلةُ مقطوعةَ النسبةِ.",
    exportSection: "orders",
    deferredTo: null,
  },

  payment_transactions: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "payment_transactions.payer_driver_id → drivers.user_id",
    basis: "معاملةٌ ماليّةٌ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ.",
    exportSection: "paymentTransactions",
    deferredTo: null,
  },
  platform_settings: reference(),
  queue_backpressure_events: reference(),

  /**
   * التقييمُ **شهادةٌ**: متوسّطُ السائقِ مبنيٌّ عليه، ونصُّ الهجرةِ نفسُه يقولُ
   * «فلا تُمحى شهادةٌ ولا يُظلَمُ مُقيَّمٌ»، ومفتاحاهُ الأجنبيّانِ `restrict` لا
   * `cascade` — فالمنعُ مُنفَذٌ في المخطّطِ سلفاً لا في هذا النصِّ وحدَه.
   */
  /**
   * **الحكمُ الوحيدُ ههنا الذي يُقالُ فيه «يبقى ما يُدينُه»** — `ADR 0113`.
   *
   * سائرُ ما يبقى في هذا السجلِّ يبقى لحقِّ **غيرِه**: شهادةٌ لراكبٍ، أو دليلُ
   * امتثالٍ لجهةٍ، أو بلاغُ نزاعٍ. وهذا يبقى لأنَّ **حقَّ المحوِ لا يُستعمَلُ
   * بابَ تنصُّلٍ**: لو ذهبَ الحظرُ والمقامُ معَ الصفِّ لَصارَ «احذفْ حسابي»
   * أرخصَ طريقٍ يُنقَّى بها سِجِلُّ محتالٍ، ثمَّ يعودُ إلى الركّابِ أنفسِهم
   * بوجهٍ نظيفٍ. فالمستبقى ههنا **أقلُّ ما يمنعُ ذلكَ**: تجزئةٌ أحاديّةٌ
   * مُفلفَلةٌ لا يُستخرَجُ منها معرّفٌ، وحكمُ حظرٍ، ومقامُ تقييمٍ، وعدُّ مرّاتٍ.
   * لا اسمَ ولا رقمَ ولا مدينةَ تُصفّى بها ولا رحلةَ.
   *
   * والأساسُ **مصلحةٌ مشروعةٌ راجحةٌ**: منعُ الاحتيالِ وحمايةُ سلامةِ طرفٍ
   * ثالثٍ. ويُقالُ للمستخدمِ في إيصالِه وفي الشاشةِ **قبلَ** أن يضغطَ، فلا
   * يكونُ استبقاءً مُضمَراً تحتَ كلمةِ «حذف».
   */
  identity_marks: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver],
    linkedBy: "identity_marks.telegram_hash · identity_marks.phone_hash",
    basis:
      "منعُ التنصُّلِ من حظرٍ أو تقييمٍ بالحذفِ ثمَّ التسجيلِ من جديدٍ — مصلحةٌ مشروعةٌ لحمايةِ طرفٍ ثالثٍ، ولا يُستبقى بها إلّا تجزئةٌ أحاديّةٌ وحكمانِ رقميّانِ (ADR 0113).",
    exportSection: "identityBar",
    deferredTo: null,
  },

  /**
   * سرُّ النشرِ لا بيانةُ إنسانٍ: صفٌّ واحدٌ فيه ٢٥٦ بتّاً عشوائيّةً. ولا يُقالُ
   * فيه `retainLegalBasis` لأنَّ ذاكَ يُوهِمُ أنَّ فيه أثراً لصاحبِ الطلبِ
   * يُوزَنُ ويُستبقى، وليسَ — فحذفُه أو إبقاؤه لا يمسُّ إنساناً بعينِه، وإنّما
   * يمسُّ الحاجزَ كلَّه.
   */
  identity_hash_pepper: {
    disposition: D.notPersonal,
    subjects: [],
    linkedBy: null,
    basis: null,
    exportSection: null,
    deferredTo: null,
  },

  ratings: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver],
    linkedBy: "ratings.rater_user_id · ratings.ratee_user_id",
    basis: "شهادةٌ للطرفِ الآخرِ ومتوسّطُ تقييمِه مبنيٌّ عليها — ومفتاحاها `on delete restrict` في المخطّطِ.",
    exportSection: "ratings",
    deferredTo: null,
  },

  /** صفُّ الدورِ: يُجهَّلُ معَ `users` لأنَّ رحلاتِه معلَّقةٌ به بـ`restrict`. */
  riders: {
    disposition: D.anonymize,
    subjects: [S.rider],
    linkedBy: "riders.user_id",
    basis: "رحلاتُه معلَّقةٌ بهذا الصفِّ — يُجهَّلُ متوسّطُ تقييمِه ويبقى المفتاحُ.",
    exportSection: "riderProfile",
    deferredTo: null,
  },

  safety_incident_deliveries: reference(),
  /**
   * بلاغُ السلامةِ قد يكونَ **محلَّ نزاعٍ قائمٍ**، وحذفُه بطلبِ أحدِ طرفَيه يُتلِفُ
   * دليلَ الطرفِ الآخرِ. ولا يُحسَمُ ههنا مدّةً: صنفُه `pending-decision-f12-10`.
   */
  safety_incidents: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver],
    linkedBy: "safety_incidents.reporter_user_id",
    basis: "بلاغُ سلامةٍ قد يكونُ محلَّ نزاعٍ — حذفُه يُتلِفُ دليلَ الطرفِ الآخرِ.",
    exportSection: "safetyIncidents",
    deferredTo: null,
  },

  /** مكانٌ حفظَه بيدِه: مِلكُه وحدَه، لا حقَّ لأحدٍ فيه — يُمحى محواً تامّاً. */
  saved_places: {
    disposition: D.erase,
    subjects: [S.rider],
    linkedBy: "saved_places.user_id",
    basis: null,
    exportSection: "savedPlaces",
    deferredTo: null,
  },

  subscription_invoices: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "subscription_invoices.driver_id → drivers.user_id",
    basis: "فاتورةٌ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ.",
    exportSection: "subscriptionInvoices",
    deferredTo: null,
  },
  subscription_notices: {
    disposition: D.anonymize,
    subjects: [S.driver],
    linkedBy: "subscription_notices.driver_id → drivers.user_id",
    basis: "إثباتُ إشعارٍ سابقٍ للسائقِ — يُجهَّلُ ولا يُحذَفُ.",
    exportSection: "subscriptionNotices",
    deferredTo: null,
  },
  subscription_refunds: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver, S.admin],
    linkedBy: "subscription_refunds.driver_id · subscription_refunds.actor_user_id",
    basis: "ردُّ مالٍ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ.",
    exportSection: "subscriptionRefunds",
    deferredTo: null,
  },
  subscription_wallet_entries: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver, S.admin],
    linkedBy: "subscription_wallet_entries.driver_id · actor_user_id",
    basis: "قيدُ محفظةٍ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ.",
    exportSection: "subscriptionWalletEntries",
    deferredTo: null,
  },
  subscription_wallets: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "subscription_wallets.driver_id → drivers.user_id",
    basis: "رصيدُ محفظةٍ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ.",
    exportSection: "subscriptionWallets",
    deferredTo: null,
  },
  subscriptions: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "subscriptions.driver_id → drivers.user_id",
    basis: "عقدُ اشتراكٍ وأثرُه الماليُّ — ستُّ سنينَ بحدٍّ أدنى داخلَ المملكةِ.",
    exportSection: "subscriptions",
    deferredTo: null,
  },

  /**
   * تذكرةُ الدعمِ فيها **نصُّ شكوى** كتبَه صاحبُها وردُّ الدعمِ عليه، وقد تكونَ
   * محلَّ نزاعٍ. فتبقى، ويُقرَأُ نصُّها مقطوعَ النسبةِ بتجهيلِ `users`.
   */
  support_tickets: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver, S.admin],
    linkedBy: "support_tickets.rider_id · support_tickets.driver_id",
    basis: "محضرُ شكوى ورَدٌّ عليها قد يكونُ محلَّ نزاعٍ — تبقى مقطوعةَ النسبةِ.",
    exportSection: "supportTickets",
    deferredTo: null,
  },
  ticket_messages: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver],
    linkedBy: "ticket_messages.ticket_id → support_tickets.id",
    basis: "رسائلُ الدعمِ جزءٌ من محضرِ الشكوى — تبقى مقطوعةَ النسبةِ.",
    exportSection: "supportTickets",
    deferredTo: null,
  },

  telegram_update_jobs: reference(),
  telegram_update_receipts: reference(),
  tracking_sessions: {
    disposition: D.erase,
    subjects: [S.driver],
    linkedBy: "tracking_sessions.driver_id → drivers.user_id",
    basis: null,
    exportSection: "trackingSessions",
    deferredTo: null,
  },
  trip_tracking_tokens: {
    disposition: D.erase,
    subjects: [S.rider],
    // SEC-19 بندُ ٣: الملكيةُ بـ`created_by_user_id` (uuid، ثابتٌ) لا بـ`created_by`
    // (bigint، معرّفُ تيليجرام). والعمودُ القديمُ مسلكٌ تراثيٌّ للصفوفِ التي لم
    // تُعَيَّن.
    linkedBy: "trip_tracking_tokens.created_by_user_id → users.id",
    basis: null,
    exportSection: "tripTrackingTokens",
    deferredTo: null,
  },
  /** صُحِّحَ حكمُه معَ `order_offers` ولعينِ السببِ (2026-09-16 · `ح-8`). */
  unsubscribed_claims: {
    disposition: D.retainLegalBasis,
    subjects: [S.driver],
    linkedBy: "unsubscribed_claims.driver_id → drivers.user_id",
    basis:
      "مطالبةٌ تشغيليّةٌ تُفسَّرُ بها قراراتُ إسنادٍ مضَت، ولا عمودَ تعريفٍ فيها يُجهَّلُ: نسبتُها تنقطعُ بتجهيلِ الجذرِ.",
    exportSection: "unsubscribedClaims",
    deferredTo: null,
  },
  unsubscribed_negotiations: reference(),

  /**
   * **عينُ التعارضِ المحجوزِ**: إثباتُ الموافقةِ هوَ دليلُ الامتثالِ، وصنفُه
   * `audit-unbounded-until-compliance` أي **لا مدّةَ له**. فحذفُه بطلبِ صاحبِه
   * يُتلِفُ ما يُطلَبُ منّا إبرازُه للجهةِ الرقابيّةِ عنه هوَ نفسِه. وقد كانَ
   * مفتاحُه الأجنبيُّ `on delete cascade` — **فكانَ حذفُ صفِّ `users` يمحوه
   * صامتاً ويُخالِفُ صنفَه المُعلَنَ**؛ وقُلِبَ في هجرةِ هذا البندِ إلى
   * `on delete restrict` كي يستحيلَ ذلكَ آليّاً لا بالنيّةِ (`ADR 0112`).
   */
  user_consents: {
    disposition: D.retainLegalBasis,
    subjects: [S.rider, S.driver],
    linkedBy: "user_consents.user_id",
    basis: "إثباتُ موافقةٍ لا مدّةَ له حتّى `F12-10` — وهوَ دليلُ الامتثالِ المطلوبُ عن صاحبِه نفسِه.",
    exportSection: "consents",
    deferredTo: null,
  },

  /** صندوقُ إشعاراتِه المقروءِ: مِلكُه، ولا حقَّ لأحدٍ فيه. */
  user_notifications: {
    disposition: D.erase,
    subjects: [S.rider, S.driver],
    linkedBy: "user_notifications.user_id",
    basis: null,
    exportSection: "notificationsReceived",
    deferredTo: null,
  },

  /**
   * **الصفُّ الجذرُ: يُجهَّلُ ولا يُحذَفُ**. وليسَ هذا تخفيفاً بل هوَ الوجهُ
   * الوحيدُ الذي يُجمَعُ به الحقّانِ: حذفُ الصفِّ يجرُّ بـ`cascade` صفوفاً
   * صُنِّفَت «لا مدّةَ لها» (إثباتُ الموافقةِ) ويُصطدِمُ بـ`restrict` في صفوفٍ
   * للطرفِ الآخرِ فيها حقٌّ (التقييمُ) — **فيُخفِقُ الحذفُ أصلاً أو يُتلِفُ
   * دليلاً**. وتجهيلُ الجذرِ يقطعُ النسبةَ إلى إنسانٍ في كلِّ جدولٍ يشيرُ إليه
   * بضربةٍ واحدةٍ: لا اسمَ ولا رقمَ ولا معرّفَ تيليجرام، فما بقيَ لا يُعرَفُ به
   * إنسانٌ — وذاكَ هوَ المحوُ بمعناه لا بحرفِ `delete`.
   */
  users: {
    disposition: D.anonymize,
    subjects: [S.rider, S.driver, S.admin],
    linkedBy: "users.id",
    basis:
      "تجهيلُ الجذرِ يقطعُ نسبةَ كلِّ صفٍّ باقٍ إلى إنسانٍ، وحذفُه يمحو إثباتَ موافقةٍ لا مدّةَ له أو يُخفِقُ بـ`restrict`.",
    exportSection: "profile",
    deferredTo: null,
  },

  webhook_events: reference(),
};

/** الجداولُ التي فيها بيانةٌ شخصيّةٌ — مشتقّةٌ لا مكتوبةٌ. */
export function personalDataTables(): readonly string[] {
  return Object.entries(TABLE_ERASURE)
    .filter(([, rule]) => rule.subjects.length > 0)
    .map(([table]) => table)
    .sort();
}

/** جداولُ صاحبٍ بعينِه — أساسُ التنزيلِ والحذفِ لكلِّ دورٍ. */
export function tablesForSubject(subject: DataSubject): readonly string[] {
  return Object.entries(TABLE_ERASURE)
    .filter(([, rule]) => rule.subjects.includes(subject))
    .map(([table]) => table)
    .sort();
}

/**
 * أقسامُ التنزيلِ الواجبةُ لصاحبٍ. **هذه هيَ حقيقةُ التنزيلِ**: المنفِّذُ يُقابَلُ
 * بها في الحاجزِ، فلا يُسقِطُ قسماً ولا يُخترَعُ قسمٌ بلا جدولٍ.
 */
export function exportSectionsForSubject(subject: DataSubject): readonly string[] {
  const sections = new Set<string>();
  for (const rule of Object.values(TABLE_ERASURE)) {
    if (rule.subjects.includes(subject) && rule.exportSection !== null) {
      sections.add(rule.exportSection);
    }
  }
  return [...sections].sort();
}

/**
 * جداولُ صاحبٍ التي **يملكُها `F2-11`** — أي لا `deferredTo`. وما عداها دينٌ
 * مُعلَنٌ لبندٍ مُسمّى، والحاجزُ يمنعُ ديناً بلا اسمِ بندٍ.
 */
export function tablesOwnedHere(subject: DataSubject): readonly string[] {
  return Object.entries(TABLE_ERASURE)
    .filter(([, rule]) => rule.subjects.includes(subject) && rule.deferredTo === null)
    .map(([table]) => table)
    .sort();
}

/**
 * التناقضُ بينَ السجلَّينِ: صنفُ استبقاءٍ يُوجِبُ الحفظَ معَ حكمِ حذفٍ. يُقرَأُ من
 * السجلَّينِ ولا يُكتَبُ يدويّاً، فلا يُنسى مدخلٌ عندَ إضافةِ جدولٍ.
 */
export function retentionErasureConflicts(
  erasure: Readonly<Record<string, ErasureRule>> = TABLE_ERASURE,
  retentionMap: Readonly<Record<string, string>> = TABLE_RETENTION,
): readonly string[] {
  const mustKeep: readonly string[] = [
    RETENTION_CLASSES.financialSixYears,
    RETENTION_CLASSES.auditUnboundedUntilCompliance,
  ];
  const conflicts: string[] = [];
  for (const [table, rule] of Object.entries(erasure)) {
    const retention = retentionMap[table];
    if (retention === undefined) continue;
    if (mustKeep.includes(retention) && rule.disposition === D.erase) {
      conflicts.push(
        `\`${table}\`: صنفُ الاستبقاءِ \`${retention}\` يُوجِبُ الحفظَ وحكمُ الحذفِ \`${rule.disposition}\``,
      );
    }
  }
  return conflicts.sort();
}
