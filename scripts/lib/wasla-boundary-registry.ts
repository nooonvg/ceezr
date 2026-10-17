/**
 * الغرض: سجلُّ تدقيقِ الحدودِ لمنظومةِ WASLA — تصنيفُ **كلِّ جدولٍ** في هذا
 *    المستودعِ إلى `KEEP` / `REFACTOR` / `MOVE_TO_CORE` / `RETIRE`، وهو البندُ
 *    الأوّلُ (`W-1`) في `ROADMAP.md` وشرطُ ما بعدَه.
 * الحالة: منفّذ فعلياً — سجلٌّ يقرؤه حاجزٌ، ليس منطقَ أعمالٍ ولا يُستورَد في الإنتاج.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/check-boundary-audit.ts · docs/wasla/boundary-audit.md
 *
 * ## لماذا سجلٌّ في الشيفرةِ لا جدولٌ في وثيقةٍ (ADR 0080)
 *
 * جردُ الحدودِ الذي يسكنُ وثيقةً وحدَه **يتقادمُ صامتاً**: تُضافُ هجرةٌ فيها جدولٌ
 * جديدٌ فلا يُصنَّفُ، ويُقرأُ الجردُ بعدَها «كاملاً» وهو ناقصٌ — وذاكَ أخطرُ من
 * غيابِه، لأنَّ ما بعدَه من بنودٍ (مصفوفةُ الهجرةِ · عقدُ الهويّةِ · نموذجُ المهمّةِ
 * التنفيذيّةِ) يُبنى عليهِ. فالتصنيفُ ههنا **مصدرُ حقيقةٍ واحدٌ**، والوثيقةُ
 * `docs/wasla/boundary-audit.md` تُولَّدُ منه ويُقارِنُها الحاجزُ حرفاً حرفاً،
 * وجدولٌ في هجرةٍ بلا تصنيفٍ **يُسقِطُ البناءَ**.
 *
 * ## ما ليسَ هذا السجلُّ
 *
 * لا يُهاجِرُ شيئاً ولا يُطفئُ شيئاً ولا يمسُّ صفّاً واحداً. هو حكمُ **وجهةٍ**
 * لكلِّ جدولٍ لا تنفيذُها؛ والتنفيذُ بنودٌ تالياتٌ لها أدلّتُها. ولا يجوزُ أن
 * يُقرأَ `MOVE_TO_CORE` هنا إثباتاً أنَّ الجدولَ انتقلَ: عمودُ الحالةِ في
 * `ROADMAP.md` («Migrated» / «Retired») هو الذي يشهدُ بذلكَ، وهو خالٍ اليومَ.
 */

/** وجهةُ الجدولِ في منظومةِ WASLA. */
export type Disposition = "KEEP" | "REFACTOR" | "MOVE_TO_CORE" | "RETIRE";

export const DISPOSITIONS: readonly Disposition[] = [
  "KEEP",
  "REFACTOR",
  "MOVE_TO_CORE",
  "RETIRE",
] as const;

/** مالكُ المفهومِ وفقَ `docs/data-ownership.md` في CORE و«حدودِ الملكيّةِ» في `ROADMAP.md`. */
export type Owner = "MOVE" | "CORE" | "MARKET";

export interface BoundaryEntry {
  /** اسمُ الجدولِ كما يُنشئُه `create table` في `supabase/migrations`. */
  readonly table: string;
  /** المفهومُ الذي يحملُه الجدولُ بلغةِ منظومةِ WASLA لا بلغةِ هذا المستودعِ. */
  readonly concern: string;
  /** مالكُ المفهومِ نهائيّاً. */
  readonly owner: Owner;
  readonly disposition: Disposition;
  /** لماذا هذه الوجهةُ — سطرٌ واحدٌ يُقرأُ بلا مرجعٍ خارجيٍّ. */
  readonly rationale: string;
}

/**
 * عمودٌ داخلَ جدولٍ **يبقى** في MOVE ومفهومُه مملوكٌ لـCORE. ولا يكفي تصنيفُ
 * الجدولِ عنه: `drivers` جدولٌ تنفيذيٌّ يُحفَظُ، وفيه `rating_average` وهو
 * سمعةٌ يملكُها CORE. فالحدُّ يُخترَقُ عموداً لا جدولاً، ولذلكَ يُصرَّحُ به.
 */
export interface ColumnConcern {
  readonly table: string;
  readonly column: string;
  readonly concern: string;
  readonly owner: Owner;
  readonly disposition: Disposition;
  readonly rationale: string;
}

/**
 * التصنيفُ الكاملُ. الترتيبُ أبجديٌّ بالاسمِ لأنَّ الوثيقةَ تُولَّدُ منه،
 * فترتيبٌ عشوائيٌّ يُنتِجُ فرقاً في المُولَّدِ بلا معنى.
 */
export const WASLA_BOUNDARY_INVENTORY: readonly BoundaryEntry[] = [
  {
    table: "account_recovery_requests",
    concern: "طلبُ استردادِ حسابٍ بمراجعةٍ إداريّةٍ صريحةٍ — سجلُّ طلبٍ وقرارٍ ومَن راجعَ ولماذا",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "استردادُ الحسابِ بعدَ فقدانِ مقبضِ الهويّةِ الخارجيِّ عملٌ على رابطِ الهويّةِ نفسِهِ (`users.telegram_id`)، والرابطُ مملوكٌ لـCORE (`ADR 0031`): فالقرارُ الذي يعيدُ الربطَ أو يرفُضُه لا يُتَّخَذُ في نظامِ النقلِ بل عندَ مالكِ الهويّةِ. ويُحفَظُ ههنا (KEEP) لا يُنقَلُ اليومَ: `W-3` الذي ينقلُ `users` إلى CORE يأخذُ معه مسارَ الاستردادِ، والطلبُ يقرأُ الهدفَ بـ`users.id` الداخليِّ لا بمقبضٍ خارجيٍّ، والمراجعةُ والقرارُ يُسجَّلانِ في `audit_log` (`ADR 0080`) (`SEC-20`).",
  },
  {
    table: "admin_break_glass_credentials",
    concern: "اعتمادُ بابِ النجاةِ للإدارةِ (break-glass) — كلمةُ سرٍّ مُهضَمةٌ وسرُّ TOTP مُشفَّرٌ وعدّاداتُ إقفالٍ",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "اعتمادُ مصادقةٍ مستقلٍّ عن تيليجرام عملٌ على رابطِ الهويّةِ (`users.id`) يملكُه CORE (`ADR 0176`)، فيبقى ههنا (KEEP) كما يبقى `users` وجيرانُه، ويأخذُه `W-3` معَ `users` إن انتقلَ. والجدولُ اعتمادٌ لا بياناتِ تشغيلِ نقلٍ.",
  },
  {
    table: "admin_login_codes",
    concern: "رمزُ دخولٍ لمرّةٍ واحدةٍ للوحةِ الإدارةِ — مصادقةٌ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "المصادقةُ وإصدارُ الرموزِ مفهومُ هويّةٍ يملكُه CORE؛ MOVE يستهلكُ جلسةً لا يُصدِرُها.",
  },
  {
    table: "admin_metric_snapshots",
    concern: "لقطةُ عدَّاداتِ التشغيلِ الميدانيِّ للوحةِ الإدارةِ — تجميعٌ مادِّيٌّ مُشتَقٌّ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "عدَّاداتُ طلباتٍ حيّةٍ وسائقينَ متاحينَ وتذاكرَ مفتوحةٍ: وظائفُ إدارةٍ تشغيليّةٌ يملكُها MOVE بنصِّ حدِّ المِلكيّةِ. وما فيها من عدَدٍ مملوكٍ لـCORE (الاشتراكاتُ ومتوسّطُ التقييمِ) **مُشتَقٌّ لا مصدرُ حقيقةٍ**، يُعادُ بناءُه من الجداولِ المُصَنَّفةِ أصلاً في هذا الجردِ، فينتقلُ معَها متى انتقلَت ولا يُنشِئُ حدًّا جديداً.",
  },
  {
    table: "admin_sessions",
    concern: "جلسةُ لوحةِ الإدارةِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الجلسةُ والمبدأُ (principal) مملوكانِ لـCORE؛ الاحتفاظُ بها هنا مصدرُ حقيقةٍ ثانٍ للهويّةِ.",
  },
  {
    table: "agent_decisions",
    concern: "قياسُ قراراتِ نواةِ الوكيلِ التنفيذيّةِ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "قياسٌ داخليٌّ لتوصياتِ التوزيعِ والمطابقةِ — تنفيذٌ ميدانيٌّ خالصٌ.",
  },
  {
    table: "agent_outcomes",
    concern: "نتيجةُ قرارِ الوكيلِ مقارنةً بما وقعَ فعلاً",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "لا يُقاسُ إلّا على مهامَّ تنفيذيّةٍ يملكُها MOVE.",
  },
  {
    table: "attendance_log",
    concern: "دخولُ السائقِ وخروجُه من الجهوزيّةِ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "جهوزيّةُ السائقِ وتوفُّرُه مملوكانِ لـMOVE صريحاً.",
  },
  {
    table: "audit_log",
    concern: "سجلُّ تدقيقٍ — تنفيذيٌّ ومشتركٌ مختلطانِ",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale:
      "مدخلُ التدقيقِ للشؤونِ المشتركةِ (هويّةٌ · دفعٌ · اشتراكٌ) يملكُه CORE، وأثرُ الإجراءِ التنفيذيِّ يبقى هنا؛ فيُشَقُّ بالمصدرِ لا يُنقَلُ جملةً.",
  },
  {
    table: "authority_data_requests",
    concern: "طلبُ تزويدِ الهيئةِ بالبياناتِ — سجلُّ طلبٍ وحزمةِ بياناتٍ مُولَّدةٌ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "تزويدُ الهيئةِ بالبياناتِ قدرةٌ تشغيليّةٌ ميدانيّةٌ يملكُها MOVE؛ الطلبُ والحزمةُ يُولَّدانِ من جداولِ MOVE المُصنَّفةِ أصلاً.",
  },
  {
    table: "breach_incidents",
    concern: "حادثُ اختراقِ بياناتٍ شخصيّةٍ — سجلُّ حادثٍ وتقييمُ خطرٍ وإبلاغٌ",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "إبلاغُ الاختراقِ التزامٌ نظاميٌّ (PDPL · المادةُ ٢٤) يملكُه CORE لا MOVE: الحادثُ يتعدّى التطبيقَ ويخصُّ المنصّةَ كلَّها، وسجلُّ الإبلاغِ دليلُ امتثالٍ يحتفظُ به CORE.",
  },

  {
    table: "broadcast_campaigns",
    concern: "حملةُ بثٍّ إداريّةٍ — إشعارٌ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الإشعارُ والقناةُ ومحوّلُها مملوكةٌ لـCORE؛ MOVE يطلبُ إشعاراً ولا يُوصِلُه.",
  },
  {
    table: "broadcast_recipients",
    concern: "مُتلقُّو البثِّ وحالةُ التوصيلِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "حالةُ توصيلِ رسالةٍ فرعٌ من ملكيّةِ الإشعارِ في CORE.",
  },
  {
    table: "cities",
    concern: "مرجعُ المدنِ والمناطقِ",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale:
      "المرجعُ الجغرافيُّ مملوكٌ لـCORE (وحدةُ `geography` فيه)؛ ويبقى هنا **إسقاطٌ** للقراءةِ لأنَّ `city_id` قيدٌ حاكمٌ في كلِّ جدولٍ (القاعدة 0.4) ولا يُحتمَلُ نداءٌ شبكيٌّ في مسارِه.",
  },
  /**
   * أُنشِئَ في `W-5` **بعدَ** جردِ `W-1`، فيُصنَّفُ ههنا لأنَّ الحاجزَ يُسقِطُ أيَّ
   * جدولٍ في المخطَّطِ بلا وجهةٍ — وهذا عينُ ما أُريدَ به. ووجهتُه `KEEP`: الإيصالُ
   * مِلكُ المُستقبِلِ لا المُرسِلِ.
   */
  {
    table: "city_service_areas",
    concern: "حدُّ منطقةِ خدمةٍ لمدينةٍ — الغلافُ الذي تُقبَلُ فيه وجهةٌ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "«أينَ نخدمُ» حكمٌ تشغيليٌّ للنقلِ نفسِه لا داتُ مستخدمٍ: يتغيَّرُ بتوسُّعِ أسطولٍ وبقرارِ مدينةٍ، ولا معنىً له خارجَ رحلةٍ. فمملوكٌ لـMOVE بلا تحفُّظٍ، ولا يُنقَلُ إلى CORE مع `users` و`cities`: المدينةُ كِيانٌ مشتركٌ أمّا حدُّ خدمتِها فسياسةُ المنتَجِ.",
  },
  {
    table: "core_event_inbox",
    concern: "إيصالُ استلامِ حدثٍ من CORE (منعُ التكرارِ)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "مفتاحُه `event_id` هوَ حرزُ MOVE من الأثرِ المزدوجِ عندَ إعادةِ التسليمِ، ولا معنى لنقلِ إيصالِ استلامٍ إلى مُرسِلِه (ADR 0081 · 0082).",
  },
  {
    table: "db_backups",
    concern: "سجلُّ نسخِ قاعدةِ MOVE واستعادتِها",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "شأنُ تشغيلِ قاعدةِ هذا المستودعِ نفسِه؛ لا يعبرُ حدّاً.",
  },
  {
    table: "destination_landmarks",
    concern: "دليلُ معالمَ مملوكٌ للمستودعِ — يُبحَثُ فيه ويُوصَفُ به موقعٌ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "بديلُ مُرمِّزٍ جغرافيٍّ خارجيٍّ (`O-7` والاستقلالُ التامُّ): بيانةُ مرجعٍ يملكُها المستودعُ ومصادرُها مكتوبةٌ صفّاً صفّاً. ولا داتَ مستخدمٍ فيها فلا تخصُّ CORE، وهيَ اليومَ سطحُ بحثِ الوجهةِ في MOVE وحدَه. وإن احتاجَها لاحقاً سطحٌ آخرُ فالنقلُ قرارٌ يُسجَّلُ حينَه لا يُستبَقُ ههنا.",
  },
  {
    table: "driver_availability",
    concern: "توفُّرُ السائقِ الآنيُّ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "توفُّرُ السائقِ مملوكٌ لـMOVE صريحاً.",
  },
  {
    table: "driver_capabilities",
    concern: "قدراتُ السائقِ وأهليّتُه",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "القدرةُ والأهليّةُ مملوكتانِ لـMOVE صريحاً.",
  },
  {
    table: "driver_document_reviewers",
    concern: "منحُ مراجعةِ وثائقِ السائقينَ لمسؤولٍ في مدينة — من منحَ ومتى ومن سحب",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "المنحُ صلاحيّةٌ تشغيليّةٌ على وثائقِ أهليّةِ القيادةِ (`driver_documents`) التي يملكُها MOVE ويحكمُ بها في مسارِ العرض؛ فالمنحُ يتبعُ الوثيقةَ لا الهويّة. ويبقى ههنا (KEEP) لأنَّ `admin_review_driver_document` و`admin_open_driver_document` تقرآنِه في المعاملةِ نفسِها، ونقلُه يجعلُ الحكمَ على وثيقةٍ معلّقاً بنداءٍ خارجيّ. والمنحُ والسحبُ يُسجَّلانِ في `audit_log` (PD-042 · ADR 0256).",
  },
  {
    table: "driver_documents",
    concern: "وثائقُ السائقِ ورخصتُه وسِرَيانُها — سببُ حجبِه أو أهليّتِه",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "الوثيقةُ ههنا **حكمُ أهليّةِ قيادةٍ** لا هويّةَ شخصٍ: قِراءتُها الوحيدةُ في هذا المستودعِ هيَ «أيُعرَضُ على هذا السائقِ طلبٌ اليومَ أم يُحجَبُ» (`F3-01` و`F12-14`)، وذاكَ سؤالٌ يملكُه MOVE وحدَه ويُجابُ في مسارِ العرضِ نفسِه. ولا يُنقَلُ إلى CORE بحُجّةِ أنَّه «داتُ مستخدمٍ»: نقلُ حكمِ الأهليّةِ إلى نظامٍ آخرَ يجعلُ جولةَ العرضِ تعتمدُ على نداءٍ خارجيٍّ في مسارٍ حارٍّ، فيصيرُ الحجبُ عُرضةً لعطبِ شبكةٍ — وحجبٌ يسقطُ عندَ العطبِ **يُقلَبُ إلى إذنٍ**. أمّا الجسمُ نفسُه فليسَ في القاعدةِ أصلاً: في المخزنِ بمسارٍ لا يُقرأُ إلّا بإذنٍ موقَّعٍ، وليسَ في الجدولِ سوى مسارُه وحالتُه وتاريخُ انتهائِه. ومتى صارَ في WASLA سطحُ هويّةٍ يملكُ التحقُّقَ من الوثائقِ لكلِّ الأنظمةِ فالنقلُ قرارٌ يُسجَّلُ حينَه.",
  },
  {
    table: "driver_location_history",
    concern: "سجلُّ مواقعِ السائقِ المُقسَّمُ زمنيّاً",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "حالةُ التتبّعِ والمسارِ مملوكةٌ لـMOVE.",
  },
  {
    table: "driver_offers_board_receipts",
    concern:
      "إيصالاتُ لوحِ العروضِ — دليلُ وصولِ عرضٍ إلى سائقٍ عبرَ لوحِ Mini App (إقرارُ العميلِ بعدَ تطبيقِ اللقطةِ)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "دليلُ تسليمِ العرضِ مِلكُ نطاقِ العروضِ والإسنادِ (MOVE) كأختِه `order_offers` و`notification_outbox`: لا يحملُ هويةَ راكبٍ ولا موقعًا — مفتاحُ سائقٍ داخليٌّ ومعرّفُ عرضٍ ووقتُ إيصالٍ، فهوَ ذيلُ أمانةِ القياسِ على مسارِ التسليمِ لا بياناتِ عملٍ جديدةٌ.",
  },
  {
    table: "drivers",
    concern: "ملفُّ السائقِ التنفيذيُّ",
    owner: "MOVE",
    disposition: "REFACTOR",
    rationale:
      "السائقُ وملفُّه مملوكانِ لـMOVE، ولكنَّ الجدولَ يحملُ عمودَي سمعةٍ (`rating_average` · `rating_count`) يملكُهما CORE ويشيرُ إلى `users` وهي هويّةٌ؛ فيُعادُ ربطُه بمُعرِّفِ هويّةٍ من CORE وتُنزَعُ السمعةُ.",
  },
  {
    table: "escalation_card_closures",
    concern: "حالُ إغلاقِ بطاقةِ الإسنادِ في قروبِ المدينة (WR-22 · ADR 0278)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "تابعٌ لتصعيدِ المهمّةِ التنفيذيّةِ إلى قروبِ الإسناد، ولا معنى له خارجَه.",
  },
  {
    table: "eta_observations",
    concern: "أوّلُ تقديرِ وصولٍ لكلِّ ساقٍ — مادّةُ مدى التنبؤِ الصادق",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "تقديرُ الوصولِ وقياسُ خطئِه جزءٌ من تتبّعِ الرحلةِ الذي يملكُه MOVE (ADR 0243).",
  },
  {
    table: "group_memberships",
    concern: "قرارُ بوّابةِ دخولِ قروبِ السائقينَ غيرِ المشتركينَ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "عضويّةُ القروبِ توزيعٌ يملكُهُ MOVEُ (بوّابةُ `PD-001` · ADR 0157) ويُقرأُ استحقاقُ «غيرِ مشتركٍ» من CORE عندَ المطالبةِ لا من هذا الجدولِ — فالبوّابةُ تُنظِّمُ الوصولَ ولا تُصدرُ استحقاقًا.",
  },
  {
    table: "identity_hash_pepper",
    concern: "سرُّ المنصّةِ لتجزئةِ الهُويّةِ (`ADR 0113`)",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale:
      "الفِلفِلُ مادّةُ تجزئةِ معرِّفِ إنسانٍ، والهويّةُ مملوكةٌ لـCORE؛ فمَقرُّه حيثُ تُحسَبُ التجزئةُ لا حيثُ تُقرأُ. وانتقالُه أخطرُ من انتقالِ جدولٍ: هوَ يُكتَبُ مرّةً ولا يُدوَّرُ، فنسخُه بقيمتِه شرطُ الانتقالِ — وتوليدُ فِلفِلٍ جديدٍ في CORE **عفوٌ جماعيٌّ عن كلِّ محظورٍ** لأنَّ الآثارَ القديمةَ تصيرُ غيرَ قابلةٍ للمطابقةِ. ولا يُستثنى من القاعدةِ 0.4 بـADR بل بملحقِ `MASTER_DIRECTIVE` 2026-09-14 (صنفُ `platform secret`).",
  },
  {
    table: "identity_marks",
    concern: "أثرُ حظرٍ ومقامٍ يَعبُرُ الحذفَ — سمعةٌ وهويّةٌ (`ADR 0113`)",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale:
      "الحظرُ وحكمُ السمعةِ مملوكانِ لـCORE كما في `ratings` و`users`؛ والأثرُ ههنا هوَ ذاكَ الحكمُ ناجياً من محوِ الصفِّ. وانتقالُه يُوجِبُ أن يبقى الإنفاذُ في القاعدةِ: مُشغِّلُ `before insert` على `users` — فإن سكنَ الأثرُ CORE وسكنَ المُشغِّلُ MOVE صارَ الحاجزُ **قائماً في مكانٍ ومُخترَقاً في آخرَ**. ولا يُنقَلُ بلا الفِلفِلِ بقيمتِه.",
  },
  {
    table: "job_heartbeats",
    concern: "نبضُ الوظائفِ المُجدوَلةِ في عامِلِ MOVE",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "وظيفةُ جدولةٍ تشغيليّةٌ داخلَ MOVE — ليست «المهمّةَ التنفيذيّةَ» بالمعنى الحاكمِ.",
  },
  {
    table: "ledger_entries",
    concern: "دفترُ القيدِ المزدوجِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الدفترُ والتسويةُ مملوكانِ لـCORE، وقد نُشِرا فيه فعلاً (وحدةُ `money`).",
  },
  {
    table: "location_archive_manifest",
    concern: "بيانُ أرشفةِ أقسامِ المواقعِ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "استبقاءُ بياناتِ تتبّعٍ يملكُها MOVE.",
  },
  /**
   * أُنشِئَ في `W-5` بعدَ جردِ `W-1`. ووجهتُه `KEEP`: الصادرُ مِلكُ المُنتِجِ،
   * ويُودَعُ في معاملةِ تغييرِ الحالةِ نفسِها فلا يُفصَلُ عن جدولِ المهمّةِ.
   */
  {
    table: "move_event_outbox",
    concern: "صندوقُ صادرِ أحداثِ `move.job.*`",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "يُصرَّفُ إلى بابِ CORE ولا يسكنُه؛ ومفتاحُ `dedup_key` يمنعُ حدثاً ثانياً لنفسِ الحادثِ (ADR 0081 · 0082).",
  },
  {
    table: "notification_kind_policy",
    concern: "تصنيفُ أنواعِ الإشعارِ وقنواتُها",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "تجريدُ القناةِ وتصنيفُ الإشعارِ مملوكانِ لـCORE.",
  },
  {
    table: "notification_outbox",
    concern: "صندوقُ صادرٍ معامليٌّ لتوصيلِ الإشعارِ",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale:
      "توصيلُ الإشعارِ ينتقلُ إلى CORE، ويبقى لـMOVE صندوقُ صادرٍ **لأحداثِه هو** (`move.job.*`) — بنيةٌ واحدةٌ بمسؤوليّتينِ يجبُ فصلُهما لا إلغاءُ إحداهما.",
  },
  /**
   * أُنشِئَ في `W-4` بعدَ جردِ `W-1`. ووجهتُه `KEEP`: التنفيذُ الميدانيُّ مِلكُ MOVE،
   * وما فيه من CORE مراجعُ مُعتِمةٌ (`fulfillment_id` · `organization_id` ·
   * `order_reference`) لا مفاهيمُ مخزَّنةٌ، فلا تُصرَّحُ اختراقاتِ عمودٍ.
   */
  {
    table: "operational_jobs",
    concern: "مهمّةُ التنفيذِ التشغيليّةُ (استلامٌ وإسنادٌ وخروجٌ)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "التنفيذُ الميدانيُّ مِلكُ MOVE بحرفِ حدودِ الملكيّةِ؛ والجدولُ لا يحملُ مفهوماً من مفاهيمِ CORE بل مراجعَه مُعتِمةً (ADR 0081).",
  },
  {
    table: "order_message_reads",
    concern: "موضعُ قراءةِ كلِّ طرفٍ في محادثةِ المهمّةِ (WR-04)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "تابعٌ لمحادثةِ المهمّةِ ولا معنى له خارجَها.",
  },
  {
    table: "order_messages",
    concern: "محادثةُ طرفَي المهمّةِ داخلَ Mini App (WR-04)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "غرفةُ التواصلِ مربوطةٌ بالمهمّةِ التنفيذيّةِ وطرفَيها، فهيَ أثرُ تنفيذٍ يملكُه MOVE.",
  },
  {
    table: "order_offers",
    concern: "عرضُ المهمّةِ على سائقٍ وقبولُه أو رفضُه",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "العرضُ والمطابقةُ والإسنادُ مملوكةٌ لـMOVE صريحاً.",
  },
  {
    table: "orders",
    concern: "المهمّةُ التنفيذيّةُ الميدانيّةُ (رحلةٌ أو توصيلٌ) — تُسمّى «طلباً» تاريخيّاً",
    owner: "MOVE",
    disposition: "REFACTOR",
    rationale:
      "هذا الجدولُ هو المهمّةُ التنفيذيّةُ لا «الطلبَ التجاريَّ» (ذاكَ مملوكٌ لـMARKET)؛ فيُسمّى بحقيقتِه ويُربَطُ بمرجعِ تنسيقٍ من CORE (`fulfillment_id`) — وهو نطاقُ البندِ `W-4`.",
  },
  {
    table: "payment_transactions",
    concern: "عمليّةُ دفعٍ ومزوّدُها",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الدفعُ والتفويضُ والاستيفاءُ مملوكةٌ لـCORE، ومنشورةٌ فيه فعلاً.",
  },
  {
    table: "pdpl_cross_border_transfers",
    concern: "سجلُّ نقلِ بياناتٍ خارجَ المملكةِ — المادةُ ٢٩ من PDPL",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "ضوابطُ النقلِ خارجَ المملكةِ التزامٌ نظاميٌّ (PDPL · المادةُ ٢٩) يملكُه CORE: النقلُ يتعدّى التطبيقَ ويخصُّ المنصّةَ كلَّها.",
  },
  {
    table: "pdpl_data_subject_requests",
    concern: "طلبُ صاحبِ بياناتٍ — المادةُ ٤ من PDPL",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "حقوقُ أصحابِ البياناتِ التزامٌ نظاميٌّ (PDPL · المادةُ ٤) يملكُه CORE: الطلبُ يتعدّى التطبيقَ ويخصُّ المنصّةَ كلَّها.",
  },
  {
    table: "pdpl_dpia_assessments",
    concern: "تقييمُ أثرِ معالجةٍ — المادةُ ٢٢ من PDPL",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "تقييمُ الأثرِ التزامٌ نظاميٌّ (PDPL · المادةُ ٢٢) يملكُه CORE: تقييمُ الخطرِ يخصُّ المنصّةَ كلَّها.",
  },
  {
    table: "pdpl_processing_activities",
    concern: "سجلُّ نشاطِ معالجةِ بياناتٍ — المادةُ ٣١ من PDPL",
    owner: "CORE",
    disposition: "KEEP",
    rationale:
      "سجلُّ أنشطةِ المعالجةِ التزامٌ نظاميٌّ (PDPL · المادةُ ٣١) يملكُه CORE لا MOVE: الامتثالُ النظاميُّ يخصُّ المنصّةَ كلَّها.",
  },

  {
    table: "platform_settings",
    concern: "إعداداتُ المنصّةِ — تشغيليّةٌ وتجاريّةٌ مختلطةٌ",
    owner: "MOVE",
    disposition: "REFACTOR",
    rationale:
      "الإعدادُ التشغيليُّ (نُصُبُ التوزيعِ · عمرُ الموقعِ · حدودُ الطوابيرِ) يبقى، وإعدادُ السعرِ والاشتراكِ يعودُ إلى قواعدِ CORE؛ فمصدرُ الحقيقةِ يُشَقُّ بالمفتاحِ.",
  },

  {
    table: "queue_backpressure_events",
    concern: "أحداثُ الضغطِ العكسيِّ في طوابيرِ MOVE",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "قياسُ تشغيلِ MOVE نفسِه.",
  },
  {
    table: "ratings",
    concern: "تقييمٌ متبادلٌ — سمعةٌ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "السمعةُ وإشاراتُ الثقةِ مملوكةٌ لـCORE؛ MOVE يُصدِرُ إشارةً ولا يحسبُ درجةً.",
  },
  {
    table: "rider_trip_event_receipts",
    concern:
      "إيصالاتُ أحداثِ الرحلةِ في Mini App — دليلُ وصولِ طورِ رحلةٍ إلى الراكبِ (إقرارُ العميلِ بعدَ تطبيقِ اللقطةِ، ADR 0287)",
    owner: "MOVE",
    disposition: "KEEP",
    rationale:
      "دليلُ تسليمِ إخطارِ الطورِ مِلكُ نطاقِ الرحلةِ (MOVE) كأختَيه `notification_outbox` و`driver_offers_board_receipts`: لا نصَّ فيه ولا موقعَ — معرّفُ صفِّ الصادرِ والطلبِ ونوعُ الحدثِ ووقتُ الإقرارِ، فهوَ ذيلُ أمانةِ القياسِ على مسارِ التسليمِ لا بياناتِ عملٍ جديدةٌ.",
  },
  {
    table: "riders",
    concern: "ملفُّ الراكبِ",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale:
      "«سطحُ الراكبِ التنفيذيُّ» مملوكٌ لـMOVE، وأمّا الشخصُ نفسُه فهويّةٌ يملكُها CORE؛ فيبقى مرجعٌ تنفيذيٌّ ولا يبقى صفٌّ يُدَّعى أنّه المستخدمُ.",
  },
  {
    table: "safety_incident_deliveries",
    concern: "توصيلُ بلاغِ السلامةِ إلى مُتلقّيه",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale:
      "البلاغُ نفسُه مملوكٌ لـMOVE، وتوصيلُه إشعارٌ مملوكٌ لـCORE؛ والأولويّةُ المطلقةُ للاستغاثةِ تمنعُ نقلَ التوصيلِ قبلَ إثباتِ مسارِ CORE إثباتاً إنتاجيّاً.",
  },
  {
    table: "safety_incidents",
    concern: "بلاغُ سلامةٍ / استغاثةٍ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "السلامةُ والاستغاثةُ مملوكتانِ لـMOVE صريحاً.",
  },
  {
    table: "saved_places",
    concern: "أماكنُ الراكبِ المحفوظةُ — المنزلُ والعملُ وغيرُهما",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale:
      "عنوانُ منزلِ المستخدمِ وعملِه داتٌ لا أثرُ مهمّةٍ: الواحدُ لا يُعيدُ حفظَ بيتِه في كلِّ تطبيقٍ، ومن أعادَ فالثاني نسخةٌ تنحرفُ. فمصيرُها مصيرُ `users` (`W-3`)، وتُنفَّذُ اليومَ في MOVE لأنَّ شاشةَ `SR-02` ههنا ولا بابَ أماكنَ في CORE — واقعٌ مُعلَنٌ لا وجهةٌ نهائيّةٌ. وأمّا **آخرُ الوجهاتِ** فلا صفَّ لها ألبتّةَ: قراءةٌ من `orders` وهيَ أثرُ مهمّةٍ يملكُه MOVE.",
  },
  {
    table: "subscription_invoices",
    concern: "فاتورةُ اشتراكٍ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الخطّةُ والاشتراكُ والمدّةُ والاستحقاقُ مملوكةٌ لـCORE.",
  },
  {
    table: "subscription_notices",
    concern: "إشعارُ اشتراكٍ مُجدوَلٌ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "اشتراكٌ وإشعارٌ: مفهومانِ مملوكانِ لـCORE معاً.",
  },
  {
    table: "subscription_refunds",
    concern: "ردُّ مبلغِ اشتراكٍ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "تسويةٌ ماليّةٌ مملوكةٌ لـCORE.",
  },
  {
    table: "subscription_wallet_entries",
    concern: "قيدُ محفظةِ الاشتراكِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "المحفظةُ والقيدُ مملوكانِ لـCORE، ومنشورانِ فيه فعلاً.",
  },
  {
    table: "subscription_wallets",
    concern: "محفظةُ اشتراكِ السائقِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "المحفظةُ مملوكةٌ لـCORE.",
  },
  {
    table: "subscriptions",
    concern: "اشتراكُ السائقِ واستحقاقُه",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale:
      "الاشتراكُ والاستحقاقُ مملوكانِ لـCORE؛ ويبقى لـMOVE **سؤالُ الأهليّةِ** يُجابُ من CORE لا صفٌّ يُقرَأُ محلّيّاً.",
  },
  {
    table: "support_tickets",
    concern: "تذكرةُ دعمٍ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "حالةُ الدعمِ (`Support case`) مملوكةٌ لـCORE في `docs/data-ownership.md`.",
  },
  {
    table: "telegram_update_jobs",
    concern: "طابورُ تحديثاتِ تلغرام الدائمُ",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale:
      "القناةُ ومحوّلُها مملوكانِ لـCORE، وسطحُ السائقِ والراكبِ التشغيليُّ مملوكٌ لـMOVE؛ فيبقى الطابورُ حتّى يُقدِّمَ CORE قناةً، ثمَّ يصيرُ محوّلاً لا مصدرَ حقيقةٍ.",
  },
  {
    table: "telegram_update_receipts",
    concern: "إيصالُ استقبالِ تحديثِ تلغرام (منعُ التكرارِ)",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale: "إيصالُ الاستقبالِ تابعٌ للقناةِ؛ يبقى ما بقيَ الطابورُ ويُنقَلُ معَه.",
  },
  {
    table: "ticket_messages",
    concern: "رسائلُ تذكرةِ الدعمِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "رسائلُ الدعمِ مملوكةٌ لـCORE تبعاً لتذكرةِ الدعمِ في `docs/data-ownership.md`.",
  },
  {
    table: "tracking_sessions",
    concern: "جلسةُ تتبّعِ رحلةٍ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "التتبّعُ وحالةُ التنفيذِ مملوكانِ لـMOVE.",
  },
  {
    table: "trip_tracking_tokens",
    concern: "رمزُ مشاركةِ تتبّعٍ عامٍّ",
    owner: "MOVE",
    disposition: "KEEP",
    rationale: "رمزٌ محدودُ النطاقِ على مهمّةٍ تنفيذيّةٍ يملكُها MOVE — ليسَ جلسةَ هويّةٍ.",
  },
  {
    table: "unsubscribed_claims",
    concern: "مطالبةُ سائقٍ غيرِ مشتركٍ بمهمّةٍ من قروبٍ",
    owner: "MOVE",
    disposition: "REFACTOR",
    rationale: "المطالبةُ إسنادٌ يملكُه MOVE، وشرطُ «غيرِ مشتركٍ» استحقاقٌ يُقرأُ من CORE لا من جدولٍ هنا.",
  },
  {
    table: "unsubscribed_negotiations",
    concern: "دورةُ مفاوضةِ غيرِ المشتركينَ",
    owner: "MOVE",
    disposition: "REFACTOR",
    rationale:
      "نموذجُ المفاوضةِ مُعلَنٌ مملوكاً لـCORE، ودورةُ عرضِها على السائقينَ توزيعٌ يملكُه MOVE؛ فيُشَقُّ عندَ الحدِّ.",
  },
  {
    table: "user_consents",
    concern: "موافقةُ المستخدمِ على شروطِ المنصّةِ وسياسةِ خصوصيّتِها",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale:
      "الموافقةُ على شروطِ المنصّةِ فرعٌ من الهويّةِ لا من التوصيلِ: الشروطُ شروطُ WASLA كلِّها لا شروطُ MOVE، والمستخدمُ الواحدُ لا يُوافِقُ مرّتَينِ في تطبيقَينِ. فمصيرُها مصيرُ `users` نفسُه (`W-3`)، وتُنفَّذُ اليومَ في MOVE لأنَّ شاشةَ الترحيبِ ههنا (`F2-01`) ولا بابَ موافقاتٍ في CORE — وذاكَ واقعٌ مُعلَنٌ لا وجهةٌ نهائيّةٌ.",
  },
  {
    table: "user_notifications",
    concern: "مركزُ الإشعاراتِ داخلَ التطبيقِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الرسالةُ والإشعارُ مملوكانِ لـCORE.",
  },
  {
    table: "users",
    concern: "المستخدمُ والهويّةُ والدورُ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale:
      "الهويّةُ والرابطُ والدورُ مملوكةٌ لـCORE؛ وهذا الجدولُ اليومَ مصدرُ الحقيقةِ الفعليُّ للهويّةِ في MOVE، فنقلُه هو البندُ `W-3` بعينِه.",
  },
  {
    table: "webhook_events",
    concern: "إيصالُ خطّافِ مزوّدِ الدفعِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "خطّافُ الدفعِ فرعٌ من ملكيّةِ الدفعِ في CORE.",
  },
];

/**
 * اختراقاتُ الحدِّ على مستوى العمودِ داخلَ جداولَ تبقى في MOVE. كلُّ مدخلٍ ههنا
 * يُتحقَّقُ من وجودِ عمودِه فعلاً في الهجراتِ، فلا يبقى مدخلٌ ميّتٌ يوسِّعُ الجردَ بلا مقابلٍ.
 */
export const WASLA_COLUMN_CONCERNS: readonly ColumnConcern[] = [
  {
    table: "drivers",
    column: "rating_average",
    concern: "درجةُ سمعةٍ محسوبةٌ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "حسابُ السمعةِ مملوكٌ لـCORE؛ يبقى هنا إسقاطُ قراءةٍ إن لزمَ لا مصدرُ حقيقةٍ.",
  },
  {
    table: "drivers",
    column: "rating_count",
    concern: "عددُ التقييماتِ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "تابعٌ لحسابِ السمعةِ في CORE.",
  },
  {
    table: "drivers",
    column: "user_id",
    concern: "ربطُ السائقِ بالهويّةِ",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale: "يصيرُ مُعرِّفَ هويّةِ CORE مرجعاً مُعتِماً، لا مفتاحاً أجنبيّاً إلى جدولِ هويّةٍ محلّيٍّ.",
  },
  {
    table: "orders",
    column: "rider_id",
    concern: "ربطُ المهمّةِ بطالبِها",
    owner: "CORE",
    disposition: "REFACTOR",
    rationale: "يصيرُ مرجعاً مُعتِماً إلى هويّةِ CORE بعدَ `W-3`.",
  },
  {
    table: "users",
    column: "telegram_id",
    concern: "رابطُ هويّةٍ لمزوّدٍ خارجيٍّ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "`Identity Link` مملوكٌ لـCORE؛ وحسابُ تلغرام ليسَ المستخدمَ (ADR 0031).",
  },
  {
    table: "users",
    column: "role",
    concern: "دورٌ وصلاحيّةٌ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "الدورُ ومنحُ الصلاحيّةِ مملوكانِ لـCORE؛ والدورُ يُقرأُ من الخادمِ لا يُخزَّنُ هنا.",
  },
  {
    table: "subscriptions",
    column: "price_amount",
    concern: "لقطةُ سعرٍ تجاريٍّ",
    owner: "CORE",
    disposition: "MOVE_TO_CORE",
    rationale: "قواعدُ السعرِ المشتركةِ والخطّةُ مملوكةٌ لـCORE.",
  },
];
