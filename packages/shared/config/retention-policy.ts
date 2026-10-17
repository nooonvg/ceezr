/**
 * الغرض: **مصدرُ الحقيقةِ الوحيدُ لسياسةِ الاستبقاءِ** — تصنيفُ كلِّ جدولٍ في
 *   المخطّطِ، ومُدَدُ `DEC-15` المعتمدةُ. البند `F7-06`، العائق `CAP-010`،
 *   `ADR-0075`.
 * الحالة: منفّذ فعلياً — 2026-09-10 · البند `F7-06`.
 * ينتمي إلى: shared/config
 * يُستخدم من: `packages/application/geo/archive-location-partitions.ts`،
 *   `apps/workers/src/container.ts`، والحاجزُ `scripts/check-retention-policy.ts`.
 * ملاحظات مستقبلية: `F12-10` (امتثالُ PDPL) هوَ من يحسمُ مُدَدَ الأصنافِ
 *   الموسومةِ `pending-decision`؛ ولا تُحسَمُ ههنا بيدِ منفِّذٍ.
 *
 * ## لماذا ملفٌّ واحدٌ لا رقمٌ عندَ كلِّ مُستعمِلٍ
 *
 * لأنَّ سياسةَ الاستبقاءِ **إقرارٌ قانونيٌّ يُعلَنُ للجهةِ الرقابيّةِ**، لا ضبطاً
 * تقنيّاً. فرقمانِ مختلفانِ في موضعَينِ يعنيانِ أنَّ ما يُعلَنُ للجهةِ غيرُ ما
 * يفعلُه العاملُ — وذاكَ أسوأُ من ألّا تكونَ سياسةٌ أصلاً، لأنَّ الأوّلَ نقصٌ
 * والثانيَ إقرارٌ كاذبٌ. ولذلكَ الأرقامُ ههنا وحدَها، والحاجزُ يمنعُ جدولاً
 * جديداً من الدخولِ بلا تصنيفٍ.
 *
 * ## ولماذا التصنيفُ قائمةٌ مغلقةٌ تشملُ الجداولَ كلَّها
 *
 * لأنَّ الخطرَ في الاستبقاءِ ليسَ جدولاً صُنِّفَ خطأً — بل جدولاً **لم يُنظَرْ فيه
 * أصلاً** فبقيَ ينمو إلى الأبدِ ولا أحدَ يذكرُ أنّه موجودٌ. فالقائمةُ المغلقةُ
 * تجعلُ إضافةَ جدولٍ جديدٍ **قراراً واعياً** يُسقِطُ CI حتّى يُصنَّفَ صاحبُه.
 * والتصنيفُ لا يعني حذفاً: أكثرُ الأصنافِ ههنا «لا يُحذَفُ».
 */

/**
 * أصنافُ الاستبقاءِ. الصنفُ يُجيبُ سؤالاً واحداً: **هل يجوزُ إخراجُ صفٍّ من هذا
 * الجدولِ من القاعدةِ، ومتى؟**
 */
export const RETENTION_CLASSES = {
  /**
   * سجلٌّ ماليٌّ: **لا يُحذَفُ ولا يُؤرشَفُ خارجاً**. الحدُّ الأدنى ستُّ سنواتٍ
   * مأخوذٌ من متطلّباتِ حفظِ سجلّاتِ الفوترةِ، ومعَه شرطُ الحفظِ داخلَ المملكةِ —
   * فأيُّ تخزينٍ خارجيٍّ لهذه الجداولِ ممنوعٌ حتّى يُحسَمَ `F12-15`/`DEC-01`.
   */
  financialSixYears: "financial-min-6y-in-kingdom",

  /**
   * تاريخُ الموقعِ: ساخنٌ في القاعدةِ مدّةَ `LOCATION_HOT_DAYS`، ثمَّ **يُؤرشَفُ
   * خارجَ القاعدةِ ويُسقَطُ قِسمُه**. وهذا وحدَه ما نفَّذَه `F7-06` — بقرارِ
   * `DEC-15` لا باجتهادِ منفِّذٍ.
   */
  locationHotThenArchive: "location-hot-then-archive",

  /**
   * سجلُّ التدقيقِ: **بلا حدٍّ حتّى `F12-10`** — بقرارِ `DEC-15` صريحاً. وليسَ
   * إهمالاً: حذفُ سجلِّ تدقيقٍ يُتلِفُ الدليلَ الذي يُثبِتُ الامتثالَ نفسَه،
   * فتأجيلُ حسمِه إلى بندِ الامتثالِ هوَ الموضعُ الصحيحُ لا التسويفُ.
   */
  auditUnboundedUntilCompliance: "audit-unbounded-until-f12-10",

  /**
   * جدولُ حالةٍ أو مرجعٍ: عمرُه عمرُ الكيانِ الذي يصفُه، فلا سياسةَ زمنيّةً له.
   * حذفُ مدينةٍ أو خطّةٍ أو سائقٍ حدَثٌ تجاريٌّ لا وظيفةُ صيانةٍ ليليّةٍ.
   */
  lifecycleBound: "lifecycle-bound-no-timer",

  /**
   * يحكمُ نفسَه بآلةٍ قائمةٍ خارجَ هذا الملفِّ (نسخُ القاعدةِ تُقلَّمُ في مهمّةِ
   * النسخِ نفسِها). مُعلَنٌ ههنا كي لا يُظَنَّ منسيّاً.
   */
  selfGoverned: "self-governed-elsewhere",

  /**
   * **صُنِّفَ ولم يُحسَمْ**: جدولٌ ينمو ولا مدّةَ معتمدةً له. ليسَ إهمالاً بل
   * إقرارٌ مكتوبٌ بأنّه يُنتظِرُ `F12-10`. ولا يجوزُ لمهمّةٍ أن تحذفَ منه شيئاً
   * قبلَ ذلكَ — والحاجزُ يمنعُ.
   */
  pendingDecision: "pending-decision-f12-10",
} as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[keyof typeof RETENTION_CLASSES];

/**
 * `DEC-15` — القرارُ المعتمَدُ من المالكِ بتاريخِ 2026-09-10. الأرقامُ ههنا
 * **قرارٌ مُعلَنٌ**، لا اشتقاقٌ ولا توصيةُ منفِّذٍ.
 */
export const DEC_15 = {
  /** المدّةُ الساخنةُ لتاريخِ الموقعِ في PostgreSQL — يوماً. */
  locationHotDays: 14,
  /** المصيرُ بعدَ الساخنِ: أرشفةٌ خارجَ القاعدةِ (لا إتلافٌ مباشرٌ). */
  locationDisposition: "archive-outside-database",
  /** سجلُّ التدقيقِ: لا مدّةَ — `null` قرارٌ لا سهوٌ. */
  auditLogDays: null,
} as const;

/** المدّةُ الساخنةُ لتاريخِ الموقعِ. لا يُكتَبُ هذا الرقمُ في موضعٍ آخرَ. */
export const LOCATION_HOT_DAYS = DEC_15.locationHotDays;

/**
 * أقصى عددِ صفوفٍ في ملفِّ أرشيفٍ واحدٍ. ليسَ ذوقاً: الملفُّ يُبنى في الذاكرةِ
 * قبلَ رفعِه، ويومٌ واحدٌ عندَ نموذجِ السعةِ المُعلَنِ مئاتُ ملايينِ الصفوفِ.
 * فالتجزئةُ إلى أجزاءٍ هيَ ما يجعلُ المهمّةَ تعملُ في عاملٍ محدودِ الذاكرةِ بدلَ
 * أن تسقطَ بلا سببٍ ظاهرٍ عندَ أوّلِ مدينةٍ مزدحمةٍ.
 */
export const ARCHIVE_PART_ROWS = 50_000;

/**
 * أقصى عددِ أيّامٍ يُعالَجُ في شوطٍ واحدٍ. متأخّرٌ متراكمٌ يُعالَجُ على أيّامٍ لا
 * دفعةً واحدةً تشغلُ القاعدةَ ساعاتٍ.
 */
export const ARCHIVE_MAX_DAYS_PER_RUN = 3;

/**
 * تصنيفُ كلِّ جدولٍ. **قائمةٌ مغلقةٌ**: جدولٌ في هجرةٍ وليسَ ههنا يُسقِطُ الحاجزَ،
 * واسمٌ ههنا بلا جدولٍ يُسقِطُه أيضاً (مُدخلٌ ميّتٌ يُوهِمُ أنَّ شيئاً حُسِمَ).
 */
export const TABLE_RETENTION: Readonly<Record<string, RetentionClass>> = {
  /**
   * `SEC-20`: طلبُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ صريحةٍ — سجلُّ القرارِ
   * (مَن راجعَ · السببُ · الوقتُ) **دليلُ مراجعةٍ** لا أثرَ تشغيلٍ: حذفُهُ
   * يمحو شهادةَ أنَّ ربطَ هويّةٍ خارجيّةٍ بمستخدمٍ داخليٍّ مرَّ بمراجعةٍ بشريّةٍ.
   * ولا مدّةَ محسومةً بعدُ (`pendingDecision`)، و`F12-10` يحكُمُ في أرشفتِهِ.
   */
  account_recovery_requests: RETENTION_CLASSES.pendingDecision,
  /**
   * `SEC-21` · `ADR 0176`: اعتمادُ البابِ الموازي (break-glass) — كلمةُ سرٍّ
   * مُهضَمةٌ وسرُّ TOTP مُشفَّرٌ وعدّاداتُ إقفالٍ. **عمرُهُ عمرُ الحسابِ**: حذفُ
   * المستخدمِ يأخذُهُ بـ`on delete cascade` المُعلَنِ، وتركُهُ بعدَ الحذفِ
   * بابٌ معلّقٌ بلا صاحبٍ. ولا مهمّةَ ليليّةً تُخرِجُهُ: تعطيلُهُ صريحٌ
   * مُدقَّقٌ لا تقادمٌ صامتٌ يُطفِئُ بابَ نجاةٍ بلا أثرٍ.
   */
  admin_break_glass_credentials: RETENTION_CLASSES.lifecycleBound,
  admin_login_codes: RETENTION_CLASSES.pendingDecision,
  /**
   * `F7-08` · `CAP-011`: لقطةُ عدَّاداتِ لوحةِ الإدارةِ — **صفٌّ واحدٌ لكلِّ
   * مدينةٍ ونافذةٍ يُحدَّثُ في موضعِه**، فالجدولُ **لا ينمو** ولا مدّةَ زمنيّةً
   * له تُحسَمُ. وعمرُ الصفِّ عمرُ مدينتِه حرفاً: `on delete cascade` على
   * `city_id` يُسقِطُه معَها، ولا مهمّةَ صيانةٍ تحذفُ منه شيئاً.
   *
   * وليسَ هذا تصنيفاً متسامحاً: الجدولُ **مُشتَقٌّ بالكامِلِ** ولا بيانةَ إنسانٍ
   * فيه — لا اسمَ ولا هاتفَ ولا معرِّفَ مستخدمٍ — فحذفُ صفٍّ منه لا يمحو دليلاً
   * ولا يُخفي أثراً، ويُعادُ بناؤه كلُّه من الجداولِ الأصليّةِ بشوطٍ واحدٍ.
   * ولذلكَ **لا يدخلُ في محوِ البيانةِ الشخصيّةِ** أصلاً.
   */
  admin_metric_snapshots: RETENTION_CLASSES.lifecycleBound,
  admin_sessions: RETENTION_CLASSES.pendingDecision,
  /**
   * `F12-09`: طلبُ تزويدِ الهيئةِ بالبياناتِ — سجلُّ طلبٍ مُسجَّلٌ بموعدِهِ
   * وحالتِهِ وحزمتِه. ينمو معَ الطلباتِ ولا مدّةَ محسومةً له بعدُ (`pendingDecision`)،
   * و`F12-10` يَحكُمُ في أرشفتِهِ.
   */
  authority_data_requests: RETENTION_CLASSES.pendingDecision,
  agent_decisions: RETENTION_CLASSES.pendingDecision,
  agent_outcomes: RETENTION_CLASSES.pendingDecision,
  attendance_log: RETENTION_CLASSES.pendingDecision,
  audit_log: RETENTION_CLASSES.auditUnboundedUntilCompliance,
  /**
   * `F12-08`: سجلُّ حوادثِ اختراقِ البياناتِ الشخصيّةِ — المادةُ ٢٤ من اللائحةِ
   * التنفيذيّةِ لـPDPL تُلزِمُ بالاحتفاظِ بنسخِ البلاغاتِ والإجراءاتِ
   * التصحيحيّةِ والأدلّةِ. ولا مدّةَ محسومةً بعدُ (`pendingDecision`)،
   * و`F12-10` يَحكُمُ في أرشفتِهِ.
   */
  breach_incidents: RETENTION_CLASSES.pendingDecision,
  broadcast_campaigns: RETENTION_CLASSES.pendingDecision,
  broadcast_recipients: RETENTION_CLASSES.pendingDecision,
  cities: RETENTION_CLASSES.lifecycleBound,
  /**
   * `F12-10`: سجلُّ أنشطةِ معالجةِ البياناتِ الشخصيّةِ — المادةُ ٣١ من PDPL
   * تُلزِمُ بالاحتفاظِ بسجلّاتِ أنشطةِ المعالجةِ. ولا مدّةَ محسومةً بعدُ
   * (`pendingDecision`)، وحين يُحسَمُ النقلُ خارجَ المملكةِ يُحدَّدُ.
   */
  pdpl_processing_activities: RETENTION_CLASSES.pendingDecision,
  /**
   * `F12-10`: طلباتُ أصحابِ البياناتِ — المادةُ ٤ من PDPL.
   */
  pdpl_data_subject_requests: RETENTION_CLASSES.pendingDecision,
  /**
   * `F12-10`: تقييماتُ أثرِ المعالجةِ — المادةُ ٢٢ من PDPL.
   */
  pdpl_dpia_assessments: RETENTION_CLASSES.pendingDecision,
  /**
   * `F12-10`: سجلُّ النقلِ خارجَ المملكةِ — المادةُ ٢٩ من PDPL.
   */
  pdpl_cross_border_transfers: RETENTION_CLASSES.pendingDecision,
  /**
   * `F2-03`: حدُّ منطقةِ الخدمةِ بيانةُ **مرجعٍ** يملكُها المشغِّلُ لا أثرُ
   * مستخدمٍ — عمرُها عمرُ المدينةِ. ولا مهمّةَ تحذفُ منها صفّاً: الإصدارُ
   * القديمُ هوَ ما يُفسَّرُ به قبولٌ مضى، وحذفُه يمحو تفسيرَ قرارٍ اتُّخِذَ.
   * والإيقافُ يكونُ بـ`is_active = false` لا بحذفٍ (سجلٌّ إضافيٌّ لا ماحٍ).
   */
  city_service_areas: RETENTION_CLASSES.lifecycleBound,
  /**
   * `W-5`: صندوقُ واردِ أحداثِ CORE — سجلُّ ما استُهلِكَ، وهوَ **دليلُ منعِ
   * التكرارِ نفسُه**: حذفُ صفٍّ منه يجعلُ إعادةَ تسليمٍ قديمةً تُطبَّقُ ثانيةً.
   * فلا مدّةَ له قبلَ `F12-10`.
   */
  core_event_inbox: RETENTION_CLASSES.pendingDecision,
  db_backups: RETENTION_CLASSES.selfGoverned,
  driver_availability: RETENTION_CLASSES.lifecycleBound,
  driver_capabilities: RETENTION_CLASSES.lifecycleBound,
  /**
   * `F3-01`: وثائقُ السائقِ — صفُّها **حكمُ أهليّةٍ قائمٌ** لا أثرُ حدثٍ: بحالتِه
   * يُحجَبُ السائقُ أو يُفتَحُ له صفُّ العرضِ اليومَ. فلا مؤقِّتَ يحذفُ منه: حذفُ
   * صفٍّ منتهيَ الصلاحيّةِ **يفتحُ الحجبَ** بدلَ أن يُبقِيَه — أي يُقلِبُ الحكمَ
   * إلى نقيضِه بصمتٍ. والانتهاءُ يُقاسُ بـ`expires_at` لا بالحذفِ (`ADR 0115`).
   * ومسارُ الإخراجِ الشرعيُّ واحدٌ: محوُ حسابِ صاحبِه (`erasure-policy.ts`)،
   * ومعَه يُحذَفُ الجسمُ من المخزنِ لا الصفُّ وحدَه.
   */
  /**
   * `PD-042` · `ADR 0256`: منحُ مراجِعِ الوثائق — عمرُه عمرُ الحساب (`on delete cascade`)،
   * والسحبُ ختمٌ مدقَّقٌ لا تقادمٌ صامت.
   */
  driver_document_reviewers: RETENTION_CLASSES.lifecycleBound,
  driver_documents: RETENTION_CLASSES.lifecycleBound,
  driver_location_history: RETENTION_CLASSES.locationHotThenArchive,
  /**
   * `F2-03`: دليلُ المعالمِ بيانةُ **مرجعٍ** مملوكةٌ للمستودعِ ومصادرُها مكتوبةٌ
   * في الهجرةِ — لا صفَّ فيها لمستخدمٍ ولا أثرَ مهمّةٍ، فلا مؤقِّتَ يحذفُ منها.
   * والمعلَمُ الذي يُغلَقُ يُوقَفُ بـ`is_active = false`: نقطةٌ قَبِلَتها القاعدةُ
   * أمسِ بوصفِ «قربَ كذا» لا يُترَكُ وصفُها بلا مرجعٍ يُقرأُ.
   */
  destination_landmarks: RETENTION_CLASSES.lifecycleBound,
  drivers: RETENTION_CLASSES.lifecycleBound,
  // PD-001/ADR 0157: عضويّةُ قروبِ غيرِ المشتركينَ تُقَيَّدُ بدورةِ حياةِ الحسابِ
  // نفسِها — فالقرارُ الحاكمُ لدخولِ السوقِ لا يُدَّعى لهُمومُ الطلباتِ العابرةِ.
  /**
   * ADR 0243: أوّلُ تقديرِ وصولٍ لكلِّ (طلب، ساق) — يتبعُ الطلبَ (`on delete cascade`)، ونافذةُ
   * القياسِ نفسُها 30 يوماً؛ فلا مؤقّتَ حذفٍ مستقلٌّ قبلَ قرارِ الاستبقاءِ العامِّ للطلبات.
   */
  escalation_card_closures: RETENTION_CLASSES.lifecycleBound,
  eta_observations: RETENTION_CLASSES.lifecycleBound,
  group_memberships: RETENTION_CLASSES.lifecycleBound,
  job_heartbeats: RETENTION_CLASSES.pendingDecision,
  ledger_entries: RETENTION_CLASSES.financialSixYears,
  location_archive_manifest: RETENTION_CLASSES.lifecycleBound,
  /** `W-5`: صندوقُ صادرِ أحداثِ MOVE — كصندوقِ الإشعاراتِ: ينمو ولا مدّةَ محسومةً. */
  move_event_outbox: RETENTION_CLASSES.pendingDecision,
  notification_kind_policy: RETENTION_CLASSES.lifecycleBound,
  notification_outbox: RETENTION_CLASSES.pendingDecision,
  /**
   * `W-4`: المهمّةُ التشغيليّةُ — عمرُها عمرُ التنفيذِ الذي تصفُه، وحذفُها حدَثٌ
   * تجاريٌّ (أو أثرٌ لحذفِ التنفيذِ في CORE) لا وظيفةُ صيانةٍ ليليّةٍ.
   */
  operational_jobs: RETENTION_CLASSES.lifecycleBound,
  /**
   * `WR-04`: محادثةُ الطلبِ وموضعُ قراءتِها — تُحجَبُ عن الطرفينِ بعدَ سبعةِ أيّامٍ
   * من انتهاءِ الطلبِ (`order_chat_read_window`)، ومدّةُ بقاءِ الصفِّ نفسِه لم تُحسَمْ.
   */
  order_message_reads: RETENTION_CLASSES.pendingDecision,
  order_messages: RETENTION_CLASSES.pendingDecision,
  order_offers: RETENTION_CLASSES.pendingDecision,
  /**
   * `LOAD-01 Recovery` — إيصالاتُ لوحِ العروضِ: دليلُ وصولِ عرضٍ إلى سائقٍ عبرَ
   * اللوحِ (إقرارُ العميلِ بعدَ تطبيقِ اللقطةِ). عمرُهُ عمرُ دليلِ التسليمِ
   * نفسِهِ ولا مدّةً محسومةً بعدُ — `pendingDecision` كأختِهِ `order_offers`
   * و`notification_outbox` (يحكمُ `F12-10` في أرشفتِهِ).
   */
  driver_offers_board_receipts: RETENTION_CLASSES.pendingDecision,
  /** ADR 0287 — إيصالاتُ أحداثِ الرحلةِ في Mini App: عمرُ دليلِ التسليمِ كأختِها. */
  rider_trip_event_receipts: RETENTION_CLASSES.pendingDecision,
  orders: RETENTION_CLASSES.lifecycleBound,
  payment_transactions: RETENTION_CLASSES.financialSixYears,
  platform_settings: RETENTION_CLASSES.lifecycleBound,
  queue_backpressure_events: RETENTION_CLASSES.pendingDecision,
  ratings: RETENTION_CLASSES.lifecycleBound,
  riders: RETENTION_CLASSES.lifecycleBound,
  safety_incident_deliveries: RETENTION_CLASSES.pendingDecision,
  safety_incidents: RETENTION_CLASSES.pendingDecision,
  subscription_invoices: RETENTION_CLASSES.financialSixYears,
  subscription_notices: RETENTION_CLASSES.pendingDecision,
  subscription_refunds: RETENTION_CLASSES.financialSixYears,
  subscription_wallet_entries: RETENTION_CLASSES.financialSixYears,
  subscription_wallets: RETENTION_CLASSES.financialSixYears,
  subscriptions: RETENTION_CLASSES.financialSixYears,
  support_tickets: RETENTION_CLASSES.pendingDecision,
  ticket_messages: RETENTION_CLASSES.pendingDecision,
  telegram_update_jobs: RETENTION_CLASSES.pendingDecision,
  telegram_update_receipts: RETENTION_CLASSES.pendingDecision,
  tracking_sessions: RETENTION_CLASSES.pendingDecision,
  trip_tracking_tokens: RETENTION_CLASSES.pendingDecision,
  unsubscribed_claims: RETENTION_CLASSES.pendingDecision,
  unsubscribed_negotiations: RETENTION_CLASSES.pendingDecision,
  /**
   * `F2-01`: سجلُّ الموافقاتِ. **سجلُّ تدقيقٍ بالمعنى الحرفيِّ لا جدولُ حالةٍ**،
   * ولذا لم يُصنَّفْ `lifecycleBound` معَ أنَّه يشيرُ إلى `users`: قيمتُه أنَّه
   * يُثبِتُ **ما كانَ** — أنَّ هذا المستخدمَ وافقَ على هذا الإصدارِ في هذه
   * اللحظةِ — وحذفُه بانتهاءِ دورةِ حياةِ شيءٍ يُتلِفُ عينَ الدليلِ الذي
   * يُطلَبُ في النزاعِ. ولا `pendingDecision` أيضاً: تلكَ تقولُ «ينمو ولا مدّةَ
   * معتمدةً»، وههنا **المدّةُ محسومةٌ مبدئيّاً بأنَّها لا تُحَدُّ**، والباقي
   * للبندِ `F12-10` أن يقولَ هل يُؤرشَفُ وكيفَ. وحذفُ الحسابِ (القسم 9.12) حينَ
   * يُنفَّذُ يُحسَمُ فيه هناكَ: أنَّ المستخدمَ يُحذَفُ لا يعني أنَّ إثباتَ موافقتِه
   * يُمحى، وذاكَ تعارضٌ حقيقيٌّ لا يُفصَلُ فيه من ملفِّ استبقاءٍ.
   */
  /**
   * `F2-02`: مكانٌ حفظَه المستخدمُ بنفسِه — عمرُه عمرُ حسابِه لا مدّةٌ زمنيّةٌ.
   * ولا مهمّةَ تحذفُ منه صفّاً: من حفظَ منزلَه لا يتوقّعُ أن يذوبَ بعدَ شهورٍ،
   * وحذفُه يُعيدُ عليه كتابةَ ما كتبَ. وأمّا حذفُ الحسابِ (القسم 9.12) فيأخذُه
   * معَه بـ`on delete cascade` المُعلَنِ في الهجرةِ نفسِها.
   */
  /**
   * `ADR 0113`: فِلفِلُ التجزئةِ. صفٌّ واحدٌ **أبديٌّ بالضرورةِ**: إخراجُه
   * يُبطِلُ كلَّ أثرِ حظرٍ مكتوبٍ بلا رجعةٍ، فهوَ عمرُ المنصّةِ لا عمرُ مدّةٍ.
   */
  identity_hash_pepper: RETENTION_CLASSES.lifecycleBound,

  /**
   * `ADR 0113`: أثرُ الهُويّةِ بعدَ التجهيلِ. **لا مهمّةَ ليليّةٌ تُخرِجُه**:
   * الأثرُ الذي يُمحى بعدَ مدّةٍ هوَ عفوٌ مؤقَّتٌ عن محتالٍ يكفيه أن ينتظرَ.
   * وليسَ صنفُه `audit-unbounded` لأنَّه ليسَ دليلَ امتثالٍ بل حاجزَ سلامةٍ
   * حيٌّ يُقرأُ في كلِّ تسجيلٍ — وعمرُه عمرُ الحاجزِ.
   */
  identity_marks: RETENTION_CLASSES.lifecycleBound,

  saved_places: RETENTION_CLASSES.lifecycleBound,
  user_consents: RETENTION_CLASSES.auditUnboundedUntilCompliance,
  user_notifications: RETENTION_CLASSES.pendingDecision,
  users: RETENTION_CLASSES.lifecycleBound,
  webhook_events: RETENTION_CLASSES.pendingDecision,
};

/**
 * الجداولُ التي **يُمنَعُ** إخراجُ صفٍّ منها من القاعدةِ إخراجاً آليّاً. تُقرَأُ
 * من التصنيفِ لا تُكتَبُ يدويّاً، فلا تتباعدُ القائمتانِ.
 */
export function isAutomatedRemovalForbidden(table: string): boolean {
  const cls = TABLE_RETENTION[table];
  return cls !== RETENTION_CLASSES.locationHotThenArchive;
}
