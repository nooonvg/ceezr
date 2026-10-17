/**
 * الغرض: مصفوفةُ الهجرةِ لكلِّ كيانٍ — البندُ `W-2` في `ROADMAP.md`. لكلِّ جدولٍ
 *    صنَّفَه جردُ الحدودِ (`W-1`) **كيفَ** يُهاجَرُ، و**متى** (موجةً)، و**بأيِّ
 *    شرطٍ سابقٍ**، و**كيفَ يُرَدُّ** إن أخفقَ، و**بأيِّ قياسٍ** يُقرأُ منتهياً.
 * الحالة: منفّذ فعلياً — سجلٌّ يقرؤه حاجزٌ، ليس منطقَ أعمالٍ ولا يُستورَد في الإنتاج.
 * ينتمي إلى: scripts/lib
 * يُتوقع أن يستخدمه لاحقاً: scripts/check-migration-matrix.ts · docs/migration/matrix.md
 *
 * ## لماذا لا يُكرَّرُ ههنا شيءٌ من جردِ الحدودِ (القاعدةُ 0.6 · ADR 0083)
 *
 * الوجهةُ (`KEEP`/`REFACTOR`/`MOVE_TO_CORE`/`RETIRE`) والمالكُ والمفهومُ والتعليلُ
 * **تُقرأُ من `wasla-boundary-registry.ts` ولا تُكتَبُ ههنا حرفاً**. ولو كُتِبَت
 * لصارَ للوجهةِ مصدرانِ، فيُبدَّلُ أحدُهما ويبقى الآخرُ يُقرأُ صحيحاً — وهو أخطرُ
 * من غيابِ المصفوفةِ، إذ يُخطِّطُ منفِّذٌ على وجهةٍ متروكةٍ. فالمُضافُ ههنا خمسةُ
 * حقولٍ **لا يعرفُها الجردُ**: الآليّةُ، والموجةُ، والشروطُ السابقةُ، ومسارُ
 * العودةِ، والقياسُ الذي يُغلِقُ.
 *
 * ## ولماذا آليّاتٌ مُعلَنةٌ مغلقةٌ لا وصفٌ حرٌّ لكلِّ جدولٍ
 *
 * سبعةٌ وأربعونَ وصفاً حرّاً يعني سبعةً وأربعينَ قراراً معماريّاً لا يُراجَعُ
 * أحدُها بالآخرِ: جدولانِ يحملانِ المفهومَ نفسَه يُهاجَرانِ بطريقَينِ مختلفَينِ بلا
 * سببٍ مكتوبٍ، ولا يُرى التنافرُ إلّا يومَ التنفيذِ. فالآليّاتُ **سبعٌ مغلقةٌ**،
 * وكلُّ جدولٍ يُسنَدُ إلى واحدةٍ منها، فالتنافرُ يظهرُ سطراً في المصفوفةِ لا عطباً
 * في هجرةٍ. وإضافةُ آليّةٍ ثامنةٍ تقتضي قراراً معماريّاً (ADR) لا سطراً ههنا.
 *
 * ## ما ليسَ هذا السجلُّ — وهو الأهمُّ
 *
 * **لا يُهاجِرُ صفّاً واحداً، ولا يأذنُ بهجرةٍ.** هو خطّةٌ مقروءةٌ آليّاً، وحدُّها
 * المُعلَنُ أنَّ أحجامَ الصفوفِ والهويّاتِ المكرَّرةَ والمهامَّ الحيّةَ **مجهولةٌ**
 * (`B-1`)، فلا موجةٌ تُنفَّذُ على أرقامٍ ليست ههنا. ولذلك يحملُ كلُّ مُدخلٍ
 * `executed: false` **حرفاً**، وحاجزُ `check-migration-matrix.ts` يُسقِطُ البناءَ
 * على أيِّ `executed: true` ما دامَ قسمُ «Migrated» في `ROADMAP.md` خالياً — فلا
 * تُقرأُ خطّةٌ إنجازاً ولا يُقلَبُ سطرٌ بلا سطرٍ يقابلُه في حالةِ المستودعِ.
 */

import {
  type Disposition,
  WASLA_BOUNDARY_INVENTORY,
  WASLA_COLUMN_CONCERNS,
} from "./wasla-boundary-registry.ts";

/**
 * آليّةُ الهجرةِ. **قائمةٌ مغلقةٌ بسبعٍ**، وإضافةُ ثامنةٍ تقتضي قراراً معماريّاً
 * منشوراً لا سطراً ههنا (ADR 0083 §٤).
 */
export type Mechanism =
  | "NONE"
  | "READ_THROUGH_CORE"
  | "EVENT_PROJECTION"
  | "HANDOVER_WITH_OPAQUE_REFERENCE"
  | "COLUMN_SPLIT"
  | "DELEGATE_TO_CORE_CHANNEL"
  | "SPLIT_TABLE";

export interface MechanismDefinition {
  readonly id: Mechanism;
  /** ما تفعلُه الآليّةُ في سطرٍ واحدٍ. */
  readonly summary: string;
  /** الوجهاتُ التي يجوزُ لها وحدَها أن تُسنَدَ إلى هذه الآليّةِ. */
  readonly allowedDispositions: readonly Disposition[];
  /** كيفَ تُرَدُّ الآليّةُ عموماً — والمُدخلُ يُفصِّلُ لجدولِه. */
  readonly rollbackShape: string;
}

/**
 * تعريفُ الآليّاتِ السبعِ. الترتيبُ من «لا شيء» إلى «الأثقلِ أثراً» عن قصدٍ:
 * الوثيقةُ تُولَّدُ من هذا الترتيبِ، والقارئُ يقرأُ الأرخصَ أوّلاً.
 */
export const MECHANISMS: readonly MechanismDefinition[] = [
  {
    id: "NONE",
    summary: "لا هجرةَ ألبتّةَ. الجدولُ تنفيذٌ ميدانيٌّ خالصٌ يملكُه MOVE ولا عمودَ فيه يخترقُ الحدَّ.",
    allowedDispositions: ["KEEP"],
    rollbackShape: "لا مسارَ عودةٍ لأنَّه لا تغييرَ — والعودةُ من لا شيءٍ لا شيءٌ.",
  },
  {
    id: "READ_THROUGH_CORE",
    summary:
      "يُبدَّلُ القارئُ لا الصفُّ: يُقرأُ المفهومُ من واجهةِ CORE، ثمَّ يُطفَأُ الجدولُ المحليُّ بعدَ أن لا يبقى قارئٌ له.",
    allowedDispositions: ["MOVE_TO_CORE", "REFACTOR"],
    rollbackShape:
      "الجدولُ المحليُّ يبقى قائماً ومكتوباً فيه حتّى تُقرأَ الواجهةُ صادقةً في الإنتاجِ؛ فالعودةُ إرجاعُ القارئِ إلى المحليِّ بلا استرجاعِ بياناتٍ.",
  },
  {
    id: "EVENT_PROJECTION",
    summary:
      "يبقى في MOVE إسقاطٌ للقراءةِ وحدَها يُحدِّثُه حدثُ تغييرٍ من CORE؛ ولا كتابةَ محليّةً على الإسقاطِ.",
    allowedDispositions: ["REFACTOR"],
    rollbackShape:
      "الإسقاطُ يُجمَّدُ على آخرِ لقطةٍ صحيحةٍ وتُستأنَفُ الكتابةُ المحليّةُ — ولا يُحذَفُ الإسقاطُ لأنَّ حذفَه يُوقِفُ التنفيذَ الميدانيَّ كلَّه.",
  },
  {
    id: "HANDOVER_WITH_OPAQUE_REFERENCE",
    summary: "تنتقلُ صفوفُ المفهومِ إلى CORE، ولا يبقى في MOVE إلّا مرجعٌ مُعتِمٌ لا يُفسَّرُ ولا يُفكَّكُ.",
    allowedDispositions: ["MOVE_TO_CORE"],
    rollbackShape:
      "المرجعُ المُعتِمُ يُكتَبُ **قبلَ** إطفاءِ الجدولِ المحليِّ، فالعودةُ إعادةُ القراءةِ من المحليِّ الذي لم يُحذَف بعدُ؛ ولا حذفَ إلّا بعدَ مطابقةٍ مقيسةٍ صفّاً بصفٍّ.",
  },
  {
    id: "COLUMN_SPLIT",
    summary:
      "الجدولُ يبقى في MOVE ويُنزَعُ منه العمودُ المملوكُ لـCORE بعدَ أن يقرأَ كلُّ قارئٍ قيمتَه من CORE.",
    allowedDispositions: ["KEEP", "REFACTOR", "MOVE_TO_CORE"],
    rollbackShape:
      "النزعُ طورٌ متأخِّرٌ (`contract`) بعدَ طورِ توسيعٍ يُضيفُ المرجعَ؛ فالعودةُ قبلَ النزعِ إرجاعُ القارئِ، وبعدَه استرجاعُ العمودِ من نسخةِ CORE لا من نسخةٍ محليّةٍ محذوفةٍ.",
  },
  {
    id: "DELEGATE_TO_CORE_CHANNEL",
    summary:
      "يُسلَّمُ التسليمُ والقناةُ إلى CORE، ويبقى في MOVE ما يُثبِتُ **أنَّه طلبَ** لا ما يُثبِتُ أنَّه أوصلَ.",
    allowedDispositions: ["MOVE_TO_CORE", "REFACTOR"],
    rollbackShape:
      "مسارُ التسليمِ المحليُّ يبقى مُعطَّلاً لا محذوفاً حتّى يُقاسَ تسليمُ CORE؛ فالعودةُ إعادةُ تفعيلِ العاملِ المحليِّ بضبطٍ لا بهجرةٍ.",
  },
  {
    id: "SPLIT_TABLE",
    summary:
      "الجدولُ يحملُ مفهومَينِ فيُشطَرُ: شطرٌ تنفيذيٌّ يبقى في MOVE، وشطرٌ مشتركٌ يُسلَّمُ إلى CORE بمرجعٍ مُعتِمٍ.",
    allowedDispositions: ["REFACTOR"],
    rollbackShape:
      "الشطرُ يبدأُ نسخاً مزدوجَ الكتابةِ (المحليُّ مصدرُ الحقيقةِ) فالعودةُ إسقاطُ الكتابةِ الثانيةِ؛ ولا يُقلَبُ مصدرُ الحقيقةِ إلّا بمطابقةٍ مقيسةٍ.",
  },
] as const;

/** معرّفاتُ الموجاتِ. الموجةُ رتبةُ تنفيذٍ لا تاريخٌ: لا موجةَ تبدأُ قبلَ تمامِ ما قبلَها. */
export interface WaveDefinition {
  readonly wave: number;
  readonly title: string;
  /** البندُ في `ROADMAP.md` الذي تنتمي إليه الموجةُ. */
  readonly item: string;
  /** ما يجبُ أن يكونَ قد تمَّ قبلَ أوّلِ صفٍّ يُلمَسُ في هذه الموجةِ. */
  readonly entryCondition: string;
}

export const WAVES: readonly WaveDefinition[] = [
  {
    wave: 0,
    title: "لا هجرةَ — تنفيذٌ ميدانيٌّ يبقى كما هو",
    item: "W-2",
    entryCondition:
      "لا شرطَ: هذه الموجةُ لا تلمسُ صفّاً. وُجدَت كي يكونَ لكلِّ جدولٍ سطرٌ، فلا جدولٌ يُنسى بأنَّه «لا يحتاجُ شيئاً».",
  },
  {
    wave: 1,
    title: "أساسُ الهويّةِ والجلسةِ",
    item: "W-3",
    entryCondition:
      "سياسةُ دمجِ الهويّاتِ المكرَّرةِ محسومةٌ (`B-2`) وبيئةُ CORE مُهيّأةٌ (`B-3`) وجردُ الإنتاجِ مقروءٌ (`B-1`). ولا موجةَ بعدَها تبدأُ قبلَها: كلُّ مفهومٍ مشتركٍ يُنسَبُ إلى مبدأٍ (principal)، والمبدأُ ههنا هو ما يُهاجَرُ.",
  },
  {
    wave: 2,
    title: "إسقاطُ الجغرافيا",
    item: "W-2",
    entryCondition:
      "CORE يُصدِرُ حدثَ تغييرٍ للمرجعِ الجغرافيِّ (`DEP-CORE-003`). ولا تُنفَّذُ بلا الحدثِ: إسقاطٌ لا يُحدَّثُ يجعلُ `city_id` في كلِّ جدولٍ مرجعاً إلى مدينةٍ قد تكونُ أُلغيَت في CORE.",
  },
  {
    wave: 3,
    title: "المالُ والاستحقاقُ",
    item: "W-7",
    entryCondition:
      "الموجةُ ١ تامّةٌ (لا محفظةَ بلا مبدأٍ)، وقراءةُ استحقاقٍ رخيصةٌ في CORE للمسارِ الساخنِ (`DEP-CORE-002`).",
  },
  {
    wave: 4,
    title: "السمعةُ",
    item: "W-7",
    entryCondition:
      "الموجةُ ١ تامّةٌ (التقييمُ يُنسَبُ إلى مبدأٍ لا إلى سائقٍ محليٍّ)، وواجهةُ سمعةٍ في CORE تُقرأُ في المسارِ الذي يقرأُ `rating_average` اليومَ.",
  },
  {
    wave: 5,
    title: "القناةُ والتسليمُ",
    item: "W-6",
    entryCondition:
      "محوّلُ قناةِ تلغرام في CORE، أو إقرارٌ مكتوبٌ بأنَّ القناةَ تبقى في MOVE (`DEP-CORE-004`). ولا تُنفَّذُ بلا أحدِهما: سطحُ MOVE التشغيليُّ كلُّه على تلغرام، وتسليمٌ نصفُه ههنا ونصفُه هنالكَ مصدرُ حقيقةٍ مزدوجٌ للإشعارِ.",
  },
  {
    wave: 6,
    title: "توحيدُ نموذجِ المهمّةِ",
    item: "W-2",
    entryCondition:
      "مخطَّطُ `W-4`/`W-5` مندمجٌ وحاجزُ القاعدةِ 0.4 أخضرُ (`O-1`)، والموجةُ ١ تامّةٌ (`orders.rider_id` مبدأٌ لا صفٌّ محليٌّ). ولا يُشطَرُ `orders` قبلَ أن يكونَ لـ`operational_jobs` مخطَّطٌ مقبولٌ في `main`.",
  },
] as const;

/**
 * مُدخلُ المصفوفةِ لجدولٍ واحدٍ. **ولا حقلَ ههنا يُكرِّرُ الجردَ**: الوجهةُ والمالكُ
 * والمفهومُ تُقرأُ من `WASLA_BOUNDARY_INVENTORY` عندَ التوليدِ والفحصِ.
 */
export interface MatrixEntry {
  readonly table: string;
  readonly mechanism: Mechanism;
  /** الموجةُ التي **يُبدَأُ** فيها. */
  readonly wave: number;
  /**
   * الموجةُ التي **يُقرَأُ فيها تامّاً** إن اختلفَت عن موجةِ البدايةِ.
   * جدولٌ يحملُ مفهومَينِ يُفتَحُ مبكّراً ويُغلَقُ متأخّراً، وإخفاءُ ذلكَ
   * يجعلُهُ يُقرَأُ تامّاً في موجةِ بدايتِه وفيه عمودٌ مُعلَنٌ لمّا يُنزَعْ — وهوَ
   * الفرقُ بينَ خطّةٍ تُقاسُ وخطّةٍ تُروى.
   */
  readonly completesInWave?: number;
  /** معرّفاتُ حواجزَ وتبعيّاتٍ **مُعلَنةٌ في `ROADMAP.md`** — يرفضُ الحاجزُ معرّفاً مُختلَقاً. */
  readonly prerequisites: readonly string[];
  /** مسارُ العودةِ لهذا الجدولِ بعينِه، لا شكلُ الآليّةِ العامُّ. */
  readonly rollback: string;
  /** القياسُ الذي يُقرأُ به «انتهت» — لا وصفُ عملٍ. */
  readonly verification: string;
  /**
   * هل نُفِّذَت؟ **`false` في كلِّ مُدخلٍ اليومَ**، والحاجزُ يمنعُ `true` ما دامَ
   * قسمُ «Migrated» في `ROADMAP.md` خالياً.
   */
  readonly executed: false;
}

/** خطّةُ عمودٍ يخترقُ الحدَّ داخلَ جدولٍ يبقى. تُقابِلُ `WASLA_COLUMN_CONCERNS` واحداً بواحدٍ. */
export interface ColumnPlanEntry {
  readonly table: string;
  readonly column: string;
  readonly mechanism: Mechanism;
  readonly wave: number;
  readonly prerequisites: readonly string[];
  readonly rollback: string;
  readonly verification: string;
  readonly executed: false;
}

const NO_MIGRATION_ROLLBACK = "لا تغييرَ فلا عودةَ.";
const NO_MIGRATION_VERIFICATION =
  "يُقرأُ تامّاً بحاجزِ `check-boundary-audit` وحدَه: الوجهةُ `KEEP` والمالكُ MOVE ولا عمودَ مُعلَنٌ عليه في سجلِّ اختراقاتِ الحدِّ. ولا قياسَ آخرَ لأنَّه لا عملَ.";

function noMigration(table: string): MatrixEntry {
  return {
    table,
    mechanism: "NONE",
    wave: 0,
    prerequisites: [],
    rollback: NO_MIGRATION_ROLLBACK,
    verification: NO_MIGRATION_VERIFICATION,
    executed: false,
  };
}

/**
 * المصفوفةُ الكاملةُ — مُدخلٌ لكلِّ جدولٍ في الجردِ، لا أكثرَ ولا أقلَّ.
 * الترتيبُ أبجديٌّ لأنَّ الوثيقةَ تُولَّدُ منه.
 */
export const WASLA_MIGRATION_MATRIX: readonly MatrixEntry[] = [
  { ...noMigration("admin_break_glass_credentials") },
  {
    table: "admin_login_codes",
    mechanism: "READ_THROUGH_CORE",
    wave: 1,
    prerequisites: ["B-2", "B-3"],
    rollback:
      "لا صفَّ يُنقَلُ ألبتّةَ: الرمزُ عمرُه دقائقُ، فالهجرةُ إطفاءُ إصدارٍ لا نقلُ بياناتٍ. والعودةُ إعادةُ تفعيلِ مسارِ الإصدارِ المحليِّ بضبطٍ، وصفوفُ الرموزِ السابقةِ تُترَكُ لتنتهيَ بمهلتِها.",
    verification:
      "لا استدعاءَ لدالّةِ إصدارِ الرمزِ المحليّةِ في أيِّ مسارٍ (يُقاسُ بحاجزٍ ساكنٍ)، ودخولُ لوحةِ إدارةٍ حقيقيٌّ يتمُّ برمزٍ أصدرَه CORE في اختبارِ تكاملٍ.",
    executed: false,
  },
  { ...noMigration("admin_metric_snapshots") },
  {
    table: "admin_sessions",
    mechanism: "READ_THROUGH_CORE",
    wave: 1,
    prerequisites: ["B-2", "B-3"],
    rollback:
      "الجلساتُ لا تُنقَلُ: تُترَكُ لتنتهيَ بمهلتِها ويُطلَبُ دخولٌ جديدٌ. فالعودةُ إرجاعُ التحقُّقِ إلى الجدولِ المحليِّ الذي لم يُحذَف، بلا استرجاعِ صفٍّ.",
    verification:
      "`GET /v1/sessions/current` هوَ الطريقُ الوحيدُ للتحقُّقِ في اختبارِ تكاملٍ، ولا قراءةَ من `admin_sessions` في أيِّ مسارٍ — يُقاسُ بحاجزٍ ساكنٍ لا بمراجعةٍ.",
    executed: false,
  },
  { ...noMigration("account_recovery_requests") },
  { ...noMigration("agent_decisions") },
  { ...noMigration("agent_outcomes") },
  { ...noMigration("attendance_log") },
  { ...noMigration("authority_data_requests") },
  { ...noMigration("breach_incidents") },
  { ...noMigration("pdpl_processing_activities") },
  { ...noMigration("pdpl_data_subject_requests") },
  { ...noMigration("pdpl_dpia_assessments") },
  { ...noMigration("pdpl_cross_border_transfers") },
  {
    table: "audit_log",
    mechanism: "SPLIT_TABLE",
    wave: 5,
    prerequisites: ["B-1", "DEP-CORE-004"],
    rollback:
      "الشطرُ يبدأُ بكتابةٍ مزدوجةٍ والمحليُّ مصدرُ الحقيقةِ، فالعودةُ إسقاطُ الإرسالِ إلى CORE وحدَه. ولا صفٌّ يُحذَفُ محليّاً في هذه الموجةِ ألبتّةَ — سجلُّ التدقيقِ أوّلُ ما يُطلَبُ عندَ حادثةٍ.",
    verification:
      "تصنيفُ كلِّ نوعِ حدثٍ في السجلِّ إلى «تنفيذيٍّ» أو «مشتركٍ» بسجلٍّ مغلقٍ يقرؤه حاجزٌ، ثمَّ مطابقةٌ مقيسةٌ: عددُ الأحداثِ المشتركةِ في CORE يساوي عددَها محليّاً في نافذةٍ واحدةٍ.",
    executed: false,
  },
  {
    table: "broadcast_campaigns",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["B-1", "DEP-CORE-004"],
    rollback:
      "الحملةُ الجاريةُ لا تُهاجَرُ وسطَها: الإطفاءُ يقعُ على الحملاتِ الجديدةِ وحدَها والقديمةُ تُكمِلُ محليّاً. فالعودةُ إعادةُ توجيهِ الحملةِ الجديدةِ إلى المسارِ المحليِّ.",
    verification:
      "حملةٌ تُنشَأُ في CORE وتُسلَّمُ إلى مستقبِلٍ حقيقيٍّ في اختبارِ تكاملٍ، ولا كتابةَ في `broadcast_campaigns` بعدَها — والصفرُ يُقاسُ لا يُفترَضُ.",
    executed: false,
  },
  {
    table: "broadcast_recipients",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["B-1", "DEP-CORE-004"],
    rollback: "كسابقِه: الصفوفُ القائمةُ تُترَكُ لتُستنزَفَ، والعودةُ ضبطٌ لا هجرةٌ.",
    verification:
      "حالةُ التسليمِ لكلِّ مستقبِلٍ تُقرأُ من CORE في اختبارِ تكاملٍ، وحاجزٌ ساكنٌ يمنعُ أيَّ كتابةٍ جديدةٍ في الجدولِ.",
    executed: false,
  },
  {
    table: "cities",
    mechanism: "EVENT_PROJECTION",
    wave: 2,
    prerequisites: ["DEP-CORE-003"],
    rollback:
      "الإسقاطُ يُجمَّدُ على آخرِ لقطةٍ ويُستأنَفُ التحريرُ المحليُّ. **ولا يُحذَفُ الجدولُ في أيِّ حالٍ**: القاعدةُ 0.4 تجعلُ `city_id` في كلِّ جدولٍ مفتاحاً أجنبيّاً إليه، فحذفُه إسقاطٌ للمخطَّطِ كلِّه لا تراجعٌ عن موجةٍ.",
    verification:
      "تعطيلُ مدينةٍ في CORE يُرى في `cities` عندَ MOVE في نافذةٍ مقيسةٍ، **وكتابةٌ محليّةٌ على الجدولِ تُرفَضُ** — يُقاسُ بمحاولةِ كتابةٍ مزروعةٍ في اختبارِ تكاملٍ لا بمراجعةِ شيفرةٍ.",
    executed: false,
  },
  // `F2-03` · حدُّ منطقةِ الخدمةِ ودليلُ المعالمِ: كلاهما **مملوكٌ لـMOVE
  // بلا تحفُّظٍ** في الجردِ (`W-1`) — الأوّلُ سياسةُ نقلٍ («أينَ نخدمُ») والثاني
  // بيانةُ مرجعٍ يملكُها المستودعُ بديلاً عن مُرمِّزٍ خارجيٍّ (`O-7`). ولا صفَّ
  // مستخدمٍ في أيٍّ منهما، فلا شيءَ ههنا يُهاجَرُ إلى CORE ولا يُقرأُ منه.
  { ...noMigration("city_service_areas") },
  { ...noMigration("core_event_inbox") },
  { ...noMigration("escalation_card_closures") },
  { ...noMigration("eta_observations") },
  { ...noMigration("group_memberships") },
  { ...noMigration("db_backups") },
  { ...noMigration("destination_landmarks") },
  { ...noMigration("driver_availability") },
  { ...noMigration("driver_capabilities") },
  { ...noMigration("driver_document_reviewers") },
  { ...noMigration("driver_documents") },
  { ...noMigration("driver_location_history") },
  { ...noMigration("driver_offers_board_receipts") },
  {
    table: "drivers",
    mechanism: "COLUMN_SPLIT",
    wave: 4,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "الجدولُ يبقى في MOVE بحكمِ الجردِ، والمُهاجَرُ ثلاثةُ أعمدةٍ (`user_id` · `rating_average` · `rating_count`) لكلٍّ سطرُه في خطّةِ الأعمدةِ. فالعودةُ على مستوى العمودِ لا الجدولِ، ولا طورَ نزعٍ قبلَ أن يُقاسَ القارئُ.",
    verification:
      "لا مخالفةَ باقيةٌ لهذا الجدولِ في `WASLA_COLUMN_CONCERNS` بعدَ نزعِ الأعمدةِ الثلاثةِ — أي أنَّ حاجزَ `check-boundary-audit` هوَ القياسُ، فلا يُقرأُ الجدولُ تامّاً وفيه عمودٌ مُعلَنٌ.",
    executed: false,
  },
  { ...noMigration("job_heartbeats") },
  {
    table: "identity_hash_pepper",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 4,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "**لا عودةَ بتوليدٍ جديدٍ ألبتّةَ**: الفِلفِلُ يُكتَبُ مرّةً ولا يُدوَّرُ، وفِلفِلٌ جديدٌ يُبطِلُ مطابقةَ كلِّ أثرٍ قديمٍ — أي **عفوٌ جماعيٌّ عن كلِّ محظورٍ** بلا قرارٍ ولا سجلٍّ. فالعودةُ إبقاءُ القيمةِ نفسِها في الطرفَينِ حتّى تُقاسَ المطابقةُ، ثمَّ إسقاطُ القراءةِ من CORE لا إسقاطُ الصفِّ.",
    verification:
      "تجزئةُ مُدخَلٍ ثابتٍ في CORE تُساوي تجزئتَه محليّاً حرفاً بحرفٍ على عيّنةٍ من الآثارِ القائمةِ — **تُقاسُ بالمطابقةِ لا بإعلانِ نسخٍ**؛ وصفٌّ واحدٌ يبقى مفرَداً في الطرفَينِ، والقراءةُ ممنوعةٌ عن كلِّ دورٍ في الطرفَينِ.",
    executed: false,
  },
  {
    table: "identity_marks",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 4,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "الآثارُ تُنسَخُ إلى CORE ولا تُحذَفُ محليّاً حتّى يُقاسَ الإنفاذُ، فالعودةُ إرجاعُ المطابقةِ إلى المحليِّ. **ولا تُنقَلُ قبلَ الفِلفِلِ ولا بمعزِلٍ عنه** — أثرٌ بلا فِلفِلِه رمادٌ لا يُطابِقُ شيئاً. **ولا يُسقَطُ مُشغِّلُ `before insert` عن `users` قبلَ أن يُثبَتَ بديلُه**: لحظةَ يسقطُ يصيرُ التسجيلُ بابَ تنصُّلٍ مفتوحاً بلا أن يُخفِقَ فحصٌ.",
    verification:
      "محظورٌ يُحذَفُ حسابَه ثمَّ يُسجِّلُ بمعرِّفِه الحقيقيِّ فيُقاسُ `is_blocked` **من قاعدةِ MOVE ومن CORE كلتَيهما** فيكونُ صادقاً في الطرفَينِ، وعدُّ الآثارِ ومجموعُ التقييماتِ متساويانِ، والمطابقةُ **لا تُصفّى بالمدينةِ** في الطرفَينِ — تُقاسُ بحظرٍ في مدينةٍ وتسجيلٍ في أخرى كما يُقاسُ اليومَ في `identity-bar-survives-erasure`.",
    executed: false,
  },
  {
    table: "ledger_entries",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "B-2", "B-3", "DEP-CORE-002"],
    rollback:
      "**قيدُ الدفترِ لا يُحذَفُ ولا يُعدَّلُ أبداً** — مزدوجُ القيدِ يُصحَّحُ بقيدٍ مضادٍّ لا بمحوٍ. فالعودةُ إيقافُ الكتابةِ في CORE وإرجاعُ القراءةِ إلى المحليِّ، والصفوفُ في الطرفَينِ تبقى ويُوثَّقُ الفرقُ.",
    verification:
      "مجموعُ المدينِ يساوي مجموعَ الدائنِ في الطرفَينِ، وكلُّ قيدٍ محليٍّ له نظيرٌ في CORE بمرجعٍ مُعتِمٍ — مطابقةٌ صفّاً بصفٍّ على أرقامِ الإنتاجِ (`B-1`)، لا عيّنةٌ.",
    executed: false,
  },
  { ...noMigration("location_archive_manifest") },
  { ...noMigration("move_event_outbox") },
  {
    table: "notification_kind_policy",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback:
      "السياسةُ إعلانٌ لا بياناتٌ متراكمةٌ، فالعودةُ إرجاعُ القراءةِ إلى الجدولِ المحليِّ. **ولا يُنزَعُ قبلَ أن يقبلَ CORE كلَّ نوعٍ فيه**: نوعٌ بلا سياسةٍ في CORE يعني إشعاراً بلا قناةٍ مُعلَنةٍ، وهو ما يمنعُه حاجزُ `F6-05` اليومَ.",
    verification:
      "كلُّ نوعٍ في السجلِّ المحليِّ له سياسةٌ مقروءةٌ في CORE، ويُقاسُ بمطابقةٍ آليّةٍ بينَ السجلَّينِ لا بمراجعةٍ — والفرقُ واحدٌ يُسقِطُ البناءَ.",
    executed: false,
  },
  {
    table: "notification_outbox",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback:
      "الصندوقُ طابورٌ صامدٌ: يُستنزَفُ ولا يُحذَفُ، والعاملُ المحليُّ يُعطَّلُ بضبطٍ لا بهجرةٍ. فالعودةُ إعادةُ تفعيلِه، والصفوفُ غيرُ المنتهيةِ تُلتقَطُ في الشوطِ التالي بلا فقدٍ.",
    verification:
      "عمقُ الطابورِ المحليِّ يبلغُ صفراً ويبقى صفراً في نافذةٍ مقيسةٍ بعدَ تحويلِ المُنتِجِ، وإشعارٌ حقيقيٌّ يُسلَّمُ عبرَ CORE في اختبارِ تكاملٍ — الصفرُ **مقيسٌ** لا مفترَضٌ.",
    executed: false,
  },
  { ...noMigration("operational_jobs") },
  { ...noMigration("order_message_reads") },
  { ...noMigration("order_messages") },
  { ...noMigration("order_offers") },
  {
    table: "orders",
    mechanism: "SPLIT_TABLE",
    wave: 6,
    prerequisites: ["B-1", "O-1"],
    rollback:
      "الشطرُ توسيعٌ محضٌ أوّلاً: `operational_jobs` يُكتَبُ فيه بالتزامنِ مع `orders` و`orders` مصدرُ الحقيقةِ، فالعودةُ إسقاطُ الكتابةِ الثانيةِ. **ولا يُقلَبُ مصدرُ الحقيقةِ ولا يُحذَفُ عمودٌ من `orders` في هذه الموجةِ**.",
    verification:
      "كلُّ صفٍّ تنفيذيٍّ حيٍّ في `orders` له نظيرٌ في `operational_jobs` بحالةٍ مكافئةٍ، ورحلةٌ كاملةٌ تجري على النموذجِ الجديدِ في اختبارِ e2e — ولا يُقرأُ الشطرُ تامّاً ما دامَ `orders.rider_id` مُعلَناً في سجلِّ اختراقاتِ الحدِّ.",
    executed: false,
  },
  {
    table: "payment_transactions",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "B-2", "B-3", "DEP-CORE-002"],
    rollback:
      "**لا صفَّ معاملةٍ يُحذَفُ**: المرجعُ المُعتِمُ يُكتَبُ في طورِ توسيعٍ، والقراءةُ تُحوَّلُ، والجدولُ يبقى للقراءةِ التاريخيّةِ. فالعودةُ إرجاعُ القراءةِ، وهي بلا فقدٍ.",
    verification:
      "لكلِّ معاملةٍ محليّةٍ تصريحُ دفعٍ في CORE بالحالةِ نفسِها والمبلغِ نفسِه، ومطابقةٌ مقيسةٌ تُخفِقُ على فرقٍ واحدٍ — والمالُ لا يُطابَقُ بعيّنةٍ.",
    executed: false,
  },
  {
    table: "platform_settings",
    mechanism: "COLUMN_SPLIT",
    wave: 3,
    prerequisites: ["B-4"],
    rollback:
      "الجدولُ يبقى في MOVE، والمُهاجَرُ **مفاتيحُ** السياسةِ التجاريّةِ (سعرٌ واشتراكٌ) لا الجدولُ. فالعودةُ إرجاعُ قراءةِ المفتاحِ إلى الصفِّ المحليِّ الذي لم يُحذَف.",
    verification:
      "لا مفتاحَ سياسةٍ تجاريّةٍ يُقرأُ من هذا الجدولِ في أيِّ مسارٍ (حاجزٌ ساكنٌ)، والحدودُ التقنيّةُ تبقى ههنا صراحةً — والفرقُ بينَ الصنفَينِ مُعلَنٌ في سجلٍّ يقرؤه الحاجزُ لا في مراجعةٍ.",
    executed: false,
  },
  { ...noMigration("queue_backpressure_events") },
  {
    table: "ratings",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 4,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "التقييماتُ تُنسَخُ إلى CORE ولا تُحذَفُ محليّاً حتّى تُقاسَ المطابقةُ؛ فالعودةُ إرجاعُ الحسابِ إلى المحليِّ. **ولا يُعادُ حسابُ متوسّطٍ من نسخةٍ ناقصةٍ** — متوسّطٌ من عيّنةٍ رقمٌ صحيحُ الشكلِ كاذبُ المعنى.",
    verification:
      "عددُ التقييماتِ ومتوسّطُها لكلِّ سائقٍ متساويانِ في الطرفَينِ، وسباقُ تقييمَينِ متزامنَينِ لا يُنتِجُ متوسّطاً مكرَّراً — يُقاسُ على قاعدةٍ حقيقيّةٍ كما يُقاسُ اليومَ في `race-rating-average`.",
    executed: false,
  },
  { ...noMigration("rider_trip_event_receipts") },
  {
    table: "riders",
    mechanism: "SPLIT_TABLE",
    wave: 1,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "الشطرُ يبدأُ بمرجعٍ مُعتِمٍ إلى مبدأِ CORE مضافاً (توسيعٌ)، والصفُّ المحليُّ يبقى. فالعودةُ إرجاعُ القراءةِ إلى المحليِّ. **ولا دمجَ هويّاتٍ آليٌّ ألبتّةَ** قبلَ حسمِ `B-2`.",
    verification:
      "كلُّ راكبٍ حيٍّ له مبدأٌ واحدٌ في CORE، **والمكرَّراتُ مُعدَّدةٌ ومحسومةٌ سطراً سطراً** لا مُدمَجةٌ آليّاً؛ ولا يُقرأُ الشطرُ تامّاً ما دامَ `orders.rider_id` مُعلَناً في سجلِّ اختراقاتِ الحدِّ.",
    executed: false,
  },
  {
    table: "safety_incident_deliveries",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback:
      "**مسارُ الاستغاثةِ آخرُ ما يُحوَّلُ وأوّلُ ما يُرَدُّ**: العودةُ إعادةُ تفعيلِ التسليمِ المحليِّ بضبطٍ يُقرأُ في ثانيةٍ، ولا تُحوَّلُ حتّى يُقاسَ تسليمُ CORE في زمنٍ مقبولٍ لحادثةٍ.",
    verification:
      "بلاغُ استغاثةٍ يُسلَّمُ عبرَ CORE في زمنٍ مقيسٍ لا يزيدُ على الزمنِ المحليِّ المقيسِ اليومَ، **وعزلُ مسارِ الاستقبالِ (`F8-05`) لا يُنقَضُ** — وهو حاجزٌ قائمٌ يُقاسُ لا وعدٌ.",
    executed: false,
  },
  { ...noMigration("safety_incidents") },
  {
    table: "saved_places",
    mechanism: "READ_THROUGH_CORE",
    // معَ `users` لا قبلَها: المكانُ يُشيرُ إلى مستخدمٍ، وقراءتُه من CORE قبلَ أن
    // يكونَ للمستخدمِ مبدأٌ هناكَ قراءةٌ من فراغٍ.
    wave: 5,
    prerequisites: ["DEP-CORE-008", "B-1", "B-2", "B-3"],
    rollback:
      "الجدولُ المحليُّ يبقى مكتوباً فيه حتّى لا يبقى قارئٌ للمحليِّ؛ فالعودةُ إرجاعُ القارئِ ولا استرجاعَ صفوفٍ. **ولا حذفَ صفٍّ عندَ قلبِ القارئِ**: المكانُ كتابةُ المستخدمِ لا نسخةُ قراءةٍ، وإتلافُه يُكلِّفُه إعادةَ كتابتِه.",
    verification:
      "مكانٌ حُفِظَ في MOVE يُقرأُ من CORE **بلافتتِه ونقطتِه وختمِ تحديثِه الأصليِّ** في اختبارِ تكاملٍ، ويبقى الفهرسُ الفريدُ الجزئيُّ نافذاً على الجانبِ الجديدِ فلا منزلانِ لمستخدمٍ واحدٍ. وما لا يُقبَلُ دليلاً: تطابقُ الأعدادِ وحدَه — نقطةٌ مُبدَّلةٌ تُنتِجُ العددَ عينَه وتُرسِلُ الراكبَ إلى غيرِ بيتِه.",
    executed: false,
  },
  {
    table: "subscription_invoices",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "B-4", "DEP-CORE-002"],
    rollback: "كـ`payment_transactions`: توسيعٌ ثمَّ تحويلُ قراءةٍ، ولا حذفَ — فالعودةُ بلا فقدٍ.",
    verification:
      "لكلِّ فاتورةٍ محليّةٍ نظيرٌ في CORE بالمبلغِ والحالةِ والدورةِ نفسِها، ومطابقةٌ مقيسةٌ تُخفِقُ على فرقٍ واحدٍ.",
    executed: false,
  },
  {
    table: "subscription_notices",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-002", "DEP-CORE-004"],
    rollback: "إشعارٌ لا بياناتٌ محفوظةٌ: العودةُ ضبطٌ يُعيدُ الإرسالَ المحليَّ.",
    verification: "إشعارُ اشتراكٍ حقيقيٌّ يُسلَّمُ عبرَ CORE، ولا كتابةَ جديدةَ في الجدولِ — الصفرُ مقيسٌ.",
    executed: false,
  },
  {
    table: "subscription_refunds",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "B-4", "DEP-CORE-002"],
    rollback: "كـ`subscription_invoices`، ولا حذفَ لصفِّ ردٍّ ألبتّةَ.",
    verification: "لكلِّ ردٍّ محليٍّ قيدٌ مضادٌّ في دفترِ CORE، ومجموعُ الردودِ متساوٍ في الطرفَينِ.",
    executed: false,
  },
  {
    table: "subscription_wallet_entries",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "DEP-CORE-002"],
    rollback: "كقيدِ الدفترِ: لا محوَ ولا تعديلَ، والتصحيحُ بقيدٍ مضادٍّ.",
    verification: "رصيدُ كلِّ محفظةٍ محسوباً من القيودِ متساوٍ في الطرفَينِ، صفّاً بصفٍّ.",
    executed: false,
  },
  {
    table: "subscription_wallets",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "DEP-CORE-002"],
    rollback:
      "المحفظةُ تُنشَأُ في CORE ويُكتَبُ مرجعُها المُعتِمُ محليّاً (توسيعٌ)، والرصيدُ المحليُّ يبقى مقروءاً. فالعودةُ إرجاعُ القراءةِ.",
    verification:
      "رصيدٌ واحدٌ لكلِّ محفظةٍ يُقرأُ من CORE، **ولا حسابَ رصيدٍ محليٌّ ثانٍ** — يُقاسُ بحاجزٍ ساكنٍ يمنعُ الجمعَ المحليَّ، لا بمراجعةٍ.",
    executed: false,
  },
  {
    table: "subscriptions",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 3,
    prerequisites: ["B-1", "B-4", "DEP-CORE-002"],
    rollback:
      "الاشتراكُ الجاريُ لا يُقطَعُ: يُنشَأُ نظيرُه في CORE ويُكتَبُ المرجعُ، والقراءةُ تُحوَّلُ بعدَ مطابقةٍ. فالعودةُ إرجاعُ قراءةِ الاستحقاقِ إلى الصفِّ المحليِّ.",
    verification:
      "قراءةُ الاستحقاقِ في المسارِ الساخنِ تأتي من CORE في زمنٍ **مقيسٍ** لا يُبطِّئُ التوزيعَ، ولكلِّ اشتراكٍ حيٍّ نظيرٌ بالحالةِ والدورةِ نفسِها.",
    executed: false,
  },
  {
    table: "support_tickets",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 5,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "التذاكرُ المفتوحةُ لا تُنقَلُ وسطَها: الجديدُ يُفتَحُ في CORE والقديمُ يُغلَقُ محليّاً. فالعودةُ إعادةُ فتحِ الجديدِ محليّاً، بلا فقدٍ.",
    verification:
      "لا تذكرةَ جديدةٌ تُكتَبُ محليّاً (يُقاسُ صفراً في نافذةٍ)، وتذكرةٌ تُفتَحُ وتُغلَقُ عبرَ CORE في اختبارِ تكاملٍ.",
    executed: false,
  },
  {
    table: "ticket_messages",
    mechanism: "HANDOVER_WITH_OPAQUE_REFERENCE",
    wave: 5,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback: "رسائلُ التذاكرِ تتبعُ التذاكرَ: تُنقَلُ معها ولا تُفرَّقُ عنها.",
    verification: "لا رسالةَ جديدةٌ تُكتَبُ محليّاً، ورسالةٌ تُكتَبُ وتُقرَأُ عبرَ CORE في اختبارِ تكاملٍ.",
    executed: false,
  },
  {
    table: "telegram_update_jobs",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback:
      "**لا يُلمَسُ مسارُ الاستلامِ إلّا بعدَ أن يُقاسَ محوّلُ CORE صامداً**: الحاملُ والإيصالُ مقيدانِ ١:١ ومسارُ الوفاءِ «مرّةً على الأقلّ» قائمٌ عليهما. فالعودةُ إعادةُ توجيهِ الويبهوكِ إلى البوّابةِ المحليّةِ — تغييرُ نقطةٍ عندَ تلغرام لا هجرةٌ.",
    verification:
      "تحديثٌ حقيقيٌّ يصلُ عبرَ محوّلِ CORE ويُعالَجُ مرّةً واحدةً، **وإعادةُ إرسالٍ من تلغرام لا تُنتِجُ أثراً ثانياً** — يُقاسُ بعمليّتَينِ منفصلتَينِ كما يُقاسُ اليومَ في `BUG-002`، لا في عمليّةٍ واحدةٍ.",
    executed: false,
  },
  {
    table: "telegram_update_receipts",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback: "كحاملِ الحمولةِ، والاثنانِ يُرَدّانِ معاً أو لا يُرَدُّ أحدُهما: القيدُ بينَهما ١:١.",
    verification:
      "منعُ التكرارِ يبقى **في قاعدةٍ** لا في ذاكرةِ عمليّةٍ بعدَ التحويلِ — يُقاسُ بعمليّتَينِ منفصلتَينِ، وسقوطُه على نسخةٍ ثانيةٍ عطبٌ لا تفصيلٌ.",
    executed: false,
  },
  { ...noMigration("tracking_sessions") },
  { ...noMigration("trip_tracking_tokens") },
  {
    table: "unsubscribed_claims",
    mechanism: "COLUMN_SPLIT",
    wave: 3,
    prerequisites: ["DEP-CORE-002"],
    rollback:
      "الجدولُ تنفيذيٌّ ويبقى؛ والمُهاجَرُ قراءةُ الاستحقاقِ التي تحكمُ فتحَ المطالبةِ. فالعودةُ إرجاعُ القراءةِ إلى الاشتراكِ المحليِّ.",
    verification:
      "قرارُ فتحِ مطالبةٍ يُتَّخَذُ على استحقاقٍ مقروءٍ من CORE في اختبارِ تكاملٍ، ولا قراءةَ محليّةً للاشتراكِ في هذا المسارِ (حاجزٌ ساكنٌ).",
    executed: false,
  },
  {
    table: "unsubscribed_negotiations",
    mechanism: "COLUMN_SPLIT",
    wave: 3,
    prerequisites: ["DEP-CORE-002", "B-4"],
    rollback: "كسابقِه: العودةُ إرجاعُ قراءةٍ لا استرجاعُ صفوفٍ.",
    verification:
      "حدُّ المفاوضةِ وسعرُها يُقرآنِ من مصدرٍ واحدٍ، **ولا رقمَ تجاريَّ في الشيفرةِ** — وحاجزُ القيمِ التجاريّةِ القائمُ هوَ القياسُ.",
    executed: false,
  },
  {
    table: "user_consents",
    mechanism: "READ_THROUGH_CORE",
    // معَ `users` لا قبلَها: الموافقةُ تُشيرُ إلى مستخدمٍ، فقراءتُها من CORE قبلَ
    // أن يكونَ للمستخدمِ مبدأٌ هناكَ قراءةٌ من فراغٍ.
    wave: 5,
    prerequisites: ["DEP-CORE-008", "B-1", "B-2", "B-3"],
    rollback:
      "الجدولُ المحليُّ **لا يُحذَفُ ولا صفٌّ منه** ألبتّةَ حتّى بعدَ قلبِ القارئِ: الصفُّ دليلٌ قانونيٌّ لا نسخةُ قراءةٍ، وحذفُه يُتلِفُ ما يُثبِتُ أنَّ الموافقةَ كانت. فالعودةُ إرجاعُ القارئِ إلى المحليِّ وحدَه، وهيَ مُتاحةٌ دائماً لأنَّ المحليَّ كاملٌ.",
    verification:
      "موافقةٌ مسجَّلةٌ في MOVE تُقرأُ من CORE **بإصدارِها وختمِها الأصليِّ لا بختمِ النقلِ** في اختبارِ تكاملٍ؛ وحاجزُ `scripts/check-consent-documents.ts` يبقى نافذاً على سجلِّ الوثائقِ الجديدِ ولا يُلغى معَ الجدولِ. وما لا يُقبَلُ دليلاً: مطابقةُ أعدادِ الصفوفِ وحدَها — ختمٌ مُبدَّلٌ يُنتِجُ العددَ عينَه ويُتلِفُ الدليلَ.",
    executed: false,
  },
  {
    table: "user_notifications",
    mechanism: "DELEGATE_TO_CORE_CHANNEL",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback: "سجلُّ إشعارٍ يُقرأُ ولا يُكتَبُ بعدَ التحويلِ؛ فالعودةُ إعادةُ الكتابةِ المحليّةِ.",
    verification:
      "إشعارُ مستخدمٍ يُقرأُ من CORE في اختبارِ تكاملٍ، ولا نوعَ إشعارٍ بلا قناةٍ مُعلَنةٍ — حاجزُ `F6-05` يبقى نافذاً على السجلِّ الجديدِ لا يُلغى معَ الجدولِ.",
    executed: false,
  },
  {
    table: "users",
    mechanism: "READ_THROUGH_CORE",
    wave: 1,
    // يُبدَأُ في الموجةِ ١ ولا يُقرَأُ تامّاً قبلَ ٥: `telegram_id` عنوانُ قناةٍ لا هويّةٌ،
    // ولا يُنزَعُ قبلَ محوّلِ قناةٍ في CORE. وقراءتُه تامّاً في ١ ادّعاءٌ كاذبٌ.
    completesInWave: 5,
    prerequisites: ["B-1", "B-2", "B-3"],
    rollback:
      "**أخطرُ سطرٍ في المصفوفةِ**: كلُّ جدولٍ تنفيذيٍّ يرجعُ إلى هويّةٍ. فالطورُ الأوّلُ إضافةُ مرجعِ مبدأِ CORE (توسيعٌ محضٌ) والصفُّ المحليُّ مصدرُ الحقيقةِ؛ ولا يُقلَبُ المصدرُ إلّا بعدَ مطابقةٍ مقيسةٍ، **ولا يُنزَعُ عمودٌ في هذه الموجةِ ألبتّةَ**. فالعودةُ إرجاعُ القارئِ.",
    verification:
      "لكلِّ مستخدمٍ حيٍّ مبدأٌ واحدٌ في CORE، **والمكرَّراتُ مُعدَّدةٌ ومحسومةٌ بسياسةِ `B-2` سطراً سطراً لا آليّاً**، ورحلةٌ كاملةٌ تجري على هويّةِ CORE في اختبارِ e2e.",
    executed: false,
  },
  {
    table: "webhook_events",
    mechanism: "READ_THROUGH_CORE",
    wave: 3,
    prerequisites: ["DEP-CORE-002"],
    rollback:
      "أحداثُ المزوّدِ لا تُنقَلُ: الجدولُ يبقى سجلَّ منعِ تكرارٍ تاريخيّاً، والجديدُ يُستقبَلُ في CORE. فالعودةُ إعادةُ توجيهِ نقطةِ المزوّدِ — ضبطٌ لا هجرةٌ.",
    verification:
      "حدثُ دفعٍ يُستقبَلُ في CORE ولا يُنشئُ أثراً ثانياً عندَ إعادتِه، ولا كتابةَ جديدةَ محليّاً — والصفرُ مقيسٌ في نافذةٍ.",
    executed: false,
  },
] as const;

/** خطّةُ الأعمدةِ — مُدخلٌ لكلِّ سطرٍ في `WASLA_COLUMN_CONCERNS`، لا أكثرَ ولا أقلَّ. */
export const WASLA_COLUMN_MIGRATION_PLAN: readonly ColumnPlanEntry[] = [
  {
    table: "drivers",
    column: "rating_average",
    mechanism: "COLUMN_SPLIT",
    wave: 4,
    prerequisites: ["B-1"],
    rollback:
      "العمودُ يبقى محسوباً محليّاً حتّى تُقرأَ سمعةُ CORE في كلِّ مسارٍ يقرؤه اليومَ؛ فالعودةُ إرجاعُ القارئِ، والنزعُ طورٌ متأخِّرٌ منفصلٌ.",
    verification:
      "متوسّطُ CORE يساوي المحليَّ لكلِّ سائقٍ قبلَ النزعِ، **وسباقُ تقييمَينِ متزامنَينِ لا يُنتِجُ متوسّطاً مكرَّراً** على قاعدةٍ حقيقيّةٍ.",
    executed: false,
  },
  {
    table: "drivers",
    column: "rating_count",
    mechanism: "COLUMN_SPLIT",
    wave: 4,
    prerequisites: ["B-1"],
    rollback: "كـ`rating_average`، والاثنانِ يُنزَعانِ معاً: عددٌ بلا متوسّطٍ نصفُ حقيقةٍ.",
    verification: "العددُ متساوٍ في الطرفَينِ لكلِّ سائقٍ، ويُقاسُ لا يُعاينُ.",
    executed: false,
  },
  {
    table: "drivers",
    column: "user_id",
    mechanism: "COLUMN_SPLIT",
    wave: 1,
    prerequisites: ["B-2", "B-3"],
    rollback:
      "يُضافُ مرجعُ مبدأِ CORE بجانبِ `user_id` (توسيعٌ) ويبقى `user_id` مصدرَ الحقيقةِ؛ فالعودةُ إسقاطُ استعمالِ المرجعِ الجديدِ. ولا نزعَ قبلَ الموجةِ التاليةِ.",
    verification:
      "كلُّ سائقٍ حيٍّ مرتبطٌ بمبدأٍ واحدٍ في CORE، والربطُ **يُقاسُ عدداً** لا يُفترَضُ من نجاحِ هجرةٍ.",
    executed: false,
  },
  {
    table: "orders",
    column: "rider_id",
    mechanism: "COLUMN_SPLIT",
    wave: 1,
    prerequisites: ["B-2", "B-3"],
    rollback: "كـ`drivers.user_id`: توسيعٌ ثمَّ تحويلُ قراءةٍ، ولا نزعَ في هذه الموجةِ.",
    verification:
      "كلُّ طلبٍ حيٍّ يرجعُ إلى مبدأٍ واحدٍ، ولا طلبَ يفقدُ راكبَه في العدِّ — الفرقُ واحدٌ يُسقِطُ البناءَ.",
    executed: false,
  },
  {
    table: "subscriptions",
    column: "price_amount",
    mechanism: "COLUMN_SPLIT",
    wave: 3,
    prerequisites: ["B-4", "DEP-CORE-002"],
    rollback: "السعرُ يُقرأُ من CORE والعمودُ يبقى تاريخيّاً؛ فالعودةُ إرجاعُ القراءةِ.",
    verification:
      "سعرُ كلِّ اشتراكٍ حيٍّ متساوٍ في الطرفَينِ، **ولا رقمَ تجاريَّ في الشيفرةِ** — الحاجزُ القائمُ هوَ القياسُ.",
    executed: false,
  },
  {
    table: "users",
    column: "role",
    mechanism: "COLUMN_SPLIT",
    wave: 1,
    prerequisites: ["B-2", "B-3"],
    rollback:
      "الدورُ يُقرأُ من `POST /v1/access/check` والعمودُ يبقى؛ فالعودةُ إرجاعُ القراءةِ. **ولا يُخزَّنُ الدورُ ولا يُفترَضُ ولا يُقرأُ من طلبٍ** — حاجزُ `F1-05` قائمٌ ولا يُلغى بالهجرةِ.",
    verification:
      "كلُّ قرارِ تصريحٍ يُتَّخَذُ على ردِّ CORE في اختبارِ تكاملٍ، ولا قراءةَ للعمودِ في أيِّ مسارِ تصريحٍ — حاجزٌ ساكنٌ لا مراجعةٌ.",
    executed: false,
  },
  {
    table: "users",
    column: "telegram_id",
    mechanism: "COLUMN_SPLIT",
    wave: 5,
    prerequisites: ["DEP-CORE-004"],
    rollback:
      "**لا يُنزَعُ قبلَ محوّلِ قناةٍ في CORE**: هوَ العنوانُ الذي يُوصَلُ به كلُّ سطحٍ تشغيليٍّ اليومَ، ونزعُه بلا محوّلٍ يقطعُ التشغيلَ. فالعودةُ إرجاعُ العنونةِ إلى العمودِ.",
    verification:
      "رسالةٌ تصلُ مستخدماً حقيقيّاً بمعرّفِ قناةٍ من CORE في اختبارِ تكاملٍ، ولا قراءةَ للعمودِ في مسارِ إرسالٍ.",
    executed: false,
  },
] as const;

/** فهرسٌ بالاسمِ — يقرؤه الحاجزُ والمُولِّدُ فلا يُبنى مرّتَينِ. */
export function matrixByTable(): Map<string, MatrixEntry> {
  return new Map(WASLA_MIGRATION_MATRIX.map((e) => [e.table, e]));
}

export function mechanismById(): Map<Mechanism, MechanismDefinition> {
  return new Map(MECHANISMS.map((m) => [m.id, m]));
}

export function waveByNumber(): Map<number, WaveDefinition> {
  return new Map(WAVES.map((w) => [w.wave, w]));
}

/** الوجهةُ من الجردِ — **المصدرُ الواحدُ**، فلا تُقرأُ من مُدخلِ المصفوفةِ. */
export function dispositionOf(table: string): Disposition | undefined {
  return WASLA_BOUNDARY_INVENTORY.find((e) => e.table === table)?.disposition;
}

/** مفاتيحُ اختراقاتِ الحدِّ العموديّةِ كما يُعلِنُها الجردُ. */
export function columnConcernKeys(): Set<string> {
  return new Set(WASLA_COLUMN_CONCERNS.map((c) => `${c.table}.${c.column}`));
}
