/**
 * # تغطيةُ أصنافِ العرضِ بمُحدِّداتِ النمطِ — القرارُ النقيُّ (`UX-021` · `ADR 0105`)
 *
 * **الغرض:** أن يستحيلَ على سطحٍ أن يُصدِرَ صنفاً لا قاعدةَ عرضٍ له. فصنفٌ في
 * `className` بلا مُحدِّدٍ في ورقةِ النمطِ **لا يُخفِقُ في بناءٍ ولا في اختبارٍ ولا
 * في مُدقِّقٍ**: تُترجِمُ الشاشةُ إلى عناصرَ بأنماطِ المتصفِّحِ الافتراضيّةِ فيراها
 * المستخدمُ قائمةً عاريةً ويراها المُختبَرُ خضراءَ. وهذا **صنفُ العطبِ الذي لا
 * يكشفُه إلّا بشرٌ ينظرُ** — وقد وقعَ فعلاً: `UX-021` سُجِّلَ في `ROADMAP.md`
 * حينَ قُوبِلَ ما تُصدِرُه شاشةُ `F2-02` بما في `global.css` فكانَ سبعةَ عشرَ صنفاً
 * بلا قاعدةٍ.
 *
 * **وهذا الملفُّ قرارٌ نقيٌّ لا قارئُ قرصٍ:** يأخذُ نصوصاً ويُعيدُ خرقاً. القراءةُ
 * في `scripts/check-css-class-coverage.ts`، والسقوطُ مقيسٌ بافتراقٍ مزروعٍ لكلِّ
 * قاعدةٍ في `tests/unit/check-css-class-coverage.test.ts`.
 *
 * ## القواعدُ الأربعُ
 *
 * ١) **لا صنفَ يُصدِرُه العرضُ بلا قاعدةٍ.** هذا نصُّ `UX-021` حرفاً.
 *
 * ٢) **لا قاعدةَ بلا مُصدِرٍ، إلّا مُسجَّلةً بسببٍ ومالكٍ.** ورقةُ نمطٍ تحملُ
 *    قواعدَ لا يُصدِرُها أحدٌ تتعفَّنُ: يُقرأُ اسمُها فيُظَنُّ أنَّ السطحَ يستعملُها.
 *    **والحذفُ ممنوعٌ** (`ح-1` · `ح-2`) — فالقاعدةُ التي زالَ مُصدِرُها بقرارٍ
 *    منشورٍ (مثلَ `.rs__stopped` بعدَ `ADR 0035` §٤) تُسجَّلُ في `RETAINED_RULES`
 *    ببيانٍ مقروءٍ، لا تُمحى ولا تُسكَتُ بقائمةٍ بلا سببٍ.
 *
 * ٣) **لا تعبيرَ صنفٍ من مصدرٍ لا يراهُ الحاجزُ.** حاجزٌ يقرأُ النصَّ الساكنَ
 *    يُخدَعُ بـ`className={props.cls}`: يمرُّ أخضرَ وهوَ لا يعلمُ ما أُصدِرَ.
 *    فالمسموحُ شكلُه **مُعلَنٌ**: نصٌّ حرفيٌّ، أو قالبٌ تُحَلُّ فواصلُه إلى حروفٍ
 *    ساكنةٍ، أو قالبٌ فيه إحلالٌ **يُقابلُه في الملفِّ نفسِه** تصريحٌ بقيمٍ حرفيّةٍ
 *    (كجدولِ `modifier` في `Skeleton.tsx`). وما سوى ذلكَ خرقٌ يُسمّى.
 *
 * ٤) **الاسمُ يتبعُ التسميةَ المُعلَنةَ وبادئتُه مُسجَّلةٌ.** `block__element--modifier`
 *    وبادئةٌ من `DECLARED_BLOCKS`. فلا يُخترَعُ سطحٌ بادئةً لا يعرفُها أحدٌ، ولا
 *    يُقرأُ خطأٌ إملائيٌّ في اسمِ صنفٍ قاعدةً جديدةً.
 *
 * ## ما لا يفعلُه عن قصدٍ — وحدودُه مُعلَنةٌ لا مضمرةٌ
 *
 * - **لا يحكمُ في الشكلِ.** يفرضُ **وجودَ** النمطِ لا جودتَه ولا تناسبَه. وأنَّ
 *   السطحَ يُقرأُ عندَ راكبٍ حقيقيٍّ ليسَ من جنسِ ما يُقاسُ ههنا (`ADR 0099`).
 * - **لا يُحلِّلُ CSS تحليلاً كاملاً.** يقرأُ **صدورَ المُحدِّداتِ** (ما قبلَ `{`)
 *   ويتجاهلُ الإعلاناتَ، فلا يخلطُ `0.85rem` في قيمةٍ بصنفٍ اسمُه `85rem`.
 * - **لا يقرأُ اختباراً**: ملفّاتُ `*.test.*` خارجُه، فهيَ تُصدِرُ أصنافاً لتتحقَّقَ
 *   منها لا لتُعرَضَ.
 * - **لا يعرفُ CSS-in-JS ولا أوراقَ نمطٍ أخرى**: المستودعُ اليومَ ورقةٌ واحدةٌ
 *   مُعلَنةٌ في `STYLESHEETS`، وزيادةُ ورقةٍ تُزادُ ههنا أو يسقطُ الحاجزُ.
 */

/** بادئاتُ الكتلِ المُعلَنةُ — سطحٌ ببادئةٍ غيرِها يُسقِطُ البناءَ (القاعدة ٤). */
export const DECLARED_BLOCKS: readonly string[] = [
  "app-frame", // الإطارُ المشترَكُ (`F1-07`)
  "sys", // شاشاتُ الحالاتِ ونصوصُها المشترَكةُ
  "sk", // هيكلُ التحميلِ (`UX-5`)
  "wc", // الترحيبُ والموافقاتُ (`F2-01`)
  "ob", // سطحُ التسجيلِ لغيرِ المسجَّلِ (`ADR 0213`) — وليسَ `wc`: الترحيبُ يلي الحسابَ لا يُنشئُه
  "rh", // رئيسةُ الراكبِ (`F2-02`)
  "rd", // اختيارُ الوجهةِ (`F2-03`)
  "qt", // الاقتباسُ والخدمةُ (`F2-04`)
  "rs", // البحثُ عن سائقٍ (`F2-05`)
  "ar", // الرحلةُ النشطةُ (`F2-06`)
  "sm", // ملخَّصُ الرحلةِ (F2-07)
  "hs", // سجلُّ الرحلاتِ (`F2-08` · `SR-09`) — وليسَ `rh` فتلكَ للرئيسةِ
  "hd", // تفاصيلُ رحلةٍ (`F2-08` · `SR-10`) — وليسَ `rd` فتلكَ للوجهةِ
  "sos", // بطاقةُ الاستغاثةِ (`F2-10` · `SR-14`) — وليسَ `sm` ولا `rs`
  // شاشةُ الحسابِ وحقَّا البيانةِ (`F2-11` · `SR-12`) — وإيصالُ الحذفِ داخلَها
  // بـ`ac__receipt-*` لا بكتلةٍ ثانيةٍ: لا يُعرَضُ إلّا فيها.
  "ac",
  // شاشةُ الدعمِ والشكاوى (`F2-12` · `SR-11`) — وليسَ `sos` فتلكَ للاستغاثةِ
  // وفيها خطرٌ فوريٌّ، ولا `ac` فتلكَ للحسابِ: ردٌّ يُنتظَرُ غيرُ خطرٍ يُستعانُ
  // فيه، وخلطُ البادئتَينِ يُورِّثُ أحدَهما إلحاحَ الأخرى أو هُدوءَها.
  "sup",
  // لوحاتُ [B] للراكب (UI-3 / PR 5 · ADR 0238): جهةُ الطوارئِ والأماكنُ والتفضيلاتُ ورسائلُ التذكرة — تخطيطٌ
  // فوقَ `ui-*` لا ألوانٌ؛ وليسَ `ac` ولا `sup`: اللوحاتُ تُرسَمُ في الحسابِ والإشعاراتِ والدعمِ معاً.
  "rset",
  // وثائقُ السائقِ (`F3-01` · `SD-01` · `SD-02`) — وليسَ `ac` فتلكَ لحسابِ
  // الراكبِ تُقرأُ مرّةً، وهذه لوحُ **منعِ عملٍ** يُقرأُ عندَ كلِّ انتهاءٍ.
  "dd",
  // لوحُ عروضِ السائقِ وتفاصيلُ عرضٍ (`F3-02` · `SD-03` · `SD-04`) — وليسَ `dd`
  // فتلكَ للورقِ يُقرأُ مرّةً في الشّهرِ، وهذه شاشةُ **قرارٍ في ثوانٍ**: نغمةُ
  // مؤقّتِها تتغيّرُ معَ العدِّ، وخلطُ البادئتَينِ يُورِّثُ لوحَ الورقِ إلحاحاً
  // ليسَ منهُ أو يُهدِّئُ مهلةً تنقضي.
  "dof",
  // مَهمّةُ السائقِ النشطةُ (`F3-03` · `SD-05`) — وليسَ `dof` فتلكَ للوحٍ
  // يُقرأُ في الانتظارِ ومؤقّتُه يلحُّ، وهذه شاشةُ **عملٍ جارٍ بلا مهلةٍ**
  // تُقرأُ والسائقُ يقودُ: زرُّها واحدٌ كبيرٌ، ولا نغمةَ إلحاحٍ تتغيّرُ فيها.
  "djb",
  // `WR-04`: بطاقةُ محادثةِ الطلبِ — مكوّنٌ واحدٌ يُرسَمُ في رحلةِ الراكبِ وفي
  // مهمّةِ السائقِ معاً، فبادئتُه مستقلّةٌ لا تتبعُ `ar` ولا `djb`.
  "ocht",
  // بثُّ موقعِ السائقِ (`F3-04`) — وليسَ `djb` فتلكَ شاشةُ مَهمّةٍ تُفتَحُ ويُضغَطُ
  // زرُّها، وهذا **إعلامٌ هادئٌ في جذرِ السطحِ** يظهرُ فوقَ كلِّ شاشةٍ ولا يُطلَبُ
  // من السائقِ فعلٌ فيه إلّا حينَ يُمنَعُ الإذنُ.
  "dlb",
  // حصيلةُ السائقِ وأداءُه (`F3-05` · `SD-06` · `SD-09`) — وليسَ `dof` فتلكَ لوحٌ
  // يُقرأُ ومهلةٌ تنقضي، وهذه **تقريرٌ يُقرأُ في وقفةٍ** عن عملٍ مضى:
  // مقامٌ يُعرضُ معَ كلِّ نسبةٍ وغيابٌ يُعلَنُ بسببِه، وخلطُ البادئتَينِ
  // يُورِّثُ أحدَهما إلحاحَ الأخرى أو هُدوءَها.
  "dac",
  // لوحُ اشتراكِ السائقِ (`F3-06` · `SD-07`) — وليسَ `dac` فتلكَ تقريرٌ
  // يُقرأُ في وقفةٍ، وهذه لوحُ **حالٍ وقرارٍ**: التجديدُ يُبدأُ الدفعَ ولا يُفعِّلُه.
  // وخلطُ البادئتَينِ يُورِّثُ أحدَهما إلحاحَ الأخرى أو هُدوءَها.
  "dsub",
  // وثيقةُ الفاتورةِ الضريبيّةِ المبسَّطةِ (`F3-09` · `SD-08`) — وليسَ `dsub`
  // فتلكَ لوحُ **قرارِ تجديدٍ** يُلحُّ، وهذه **وثيقةٌ نظاميّةٌ تُقرأُ وتُنقَلُ**:
  // أرقامُها تُقابَلُ بما دُفِعَ، وحِمْلُ رمزِها يُنتقى كلُّه بلمسةٍ.
  "dinv",
  "dveh",
  // ملخَّصُ رحلةِ السائقِ (`F12-05`) — وليسَ `sm` فتلكَ لراكبٍ يرى سائقَه،
  // وهذه سائقٌ يرى راكبَه: بطاقةٌ أخرى واتّجاهٌ آخر. وخلطُ البادئتَينِ يُورِّثُ
  // السائقَ أنماطَ راكبٍ فيُرى راكباً.
  "dsm",
  // مركزُ الإشعاراتِ (`SS-07` · `F6-05`) — وليسَ `hs` فتلكَ لسجلِّ الرحلاتِ
  // يُجمَّعُ بالشهرِ، وهذه بطاقاتٌ تُقرأُ بالتتابعِ. وخلطُ البادئتَينِ يُورِّثُ
  // إحداهما أنماطَ الأخرى.
  "nc",
  // شاشةُ الخصوصيّةِ والموافقاتِ (DEC-35) — وليستْ `ac` فتلكَ لحسابِ الراكبِ
  // وحقِّ البيانةِ، وهذه شاشةُ **مراجعةِ موافقاتٍ** تُقرأُ ولا تُكتَبُ فيها.
  "rp", // شاشةُ الأسئلة الشائعةِ (DEC-36) — وليستْ `sup` فتلكَ لتذكرةٍ تُكتبُ،
  // وهذه صفحةُ قراءةٍ بلا نموذجٍ.
  "rf", // شاشةُ كشفِ الخصومِ (DEC-37) — وليستْ `sup` فتلكَ لتذكرةٍ، وهذه سجلُّ محفظةٍ.
  "dt",
  "dsup",
  // ── UI-1 / PR 1: مكوّناتُ ui-* العرضيّةُ الصرفةُ (القسم 4) ──
  // كلُّ اسمٍ بلوكٌ مستقلٌ بقواعدِه في `global.css` وعنصرُ React في `system/ui/`.
  "ui-btn",
  "ui-fld",
  "ui-tile",
  "ui-sg",
  "ui-chip",
  "ui-tag",
  "ui-pill",
  "ui-card",
  "ui-row",
  "ui-kv",
  "ui-truth",
  "ui-rail",
  "ui-timer",
  "ui-stp",
  "ui-sht",
  "ui-dg",
  "ui-tab",
  "ui-act",
  "ui-hdr",
  "ui-skel",
  "ui-empty",
  "ui-err",
  "ui-toast",
  "ui-banner",
  "ui-av",
  "ui-pl",
  "ui-st",
  "ui-ds",
  "ui-pg",
  "ui-copy",
];

/** أوراقُ النمطِ المقروءةُ — مكتوبةً لا مُكتشَفةً بنمطٍ. */
export const STYLESHEETS: readonly string[] = ["apps/miniapp/src/styles/global.css"];

/** جذورُ الشِّفرةِ التي تُصدِرُ أصنافاً. */
export const EMITTING_ROOTS: readonly string[] = ["apps/miniapp/src"];

/**
 * قاعدةٌ باقيةٌ بلا مُصدِرٍ، **بسببٍ ومالكٍ** (القاعدة ٢). ولا مدخلَ ههنا بلا
 * قرارٍ أو حكمٍ يُحيلُ إليه — وإلّا صارَ السجلُّ بابَ إسكاتٍ.
 */
export interface RetainedRule {
  /** اسمُ الصنفِ بلا نقطةٍ. */
  readonly className: string;
  /** لمَ بقيَ مكتوباً وقد زالَ مُصدِرُه. */
  readonly reason: string;
  /** من يملكُ المدخلَ. */
  readonly owner: string;
  /** ما الذي أزالَ مُصدِرَه — قرارٌ أو حكمٌ، لا رأيٌ. */
  readonly supersededBy: string;
}

export const RETAINED_RULES: readonly RetainedRule[] = [
  {
    className: "ar__phase",
    reason:
      "سطرُ طورِ الرحلةِ النشطةِ (R7). حلَّ محلَّه في UI-3 / PR 4 (§11 «سكّة + شريط حقيقة + SOS») شريطُ الحقيقةِ `UiTruth` بالنصِّ نفسِه (`activePhaseKey`) ونغمةٍ من الطور، ومعه سكّةُ `UiRail`. والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-3 / PR 4 · ADR 0237 · .ui-truth عبرَ active/RideJourney.tsx",
  },
  {
    className: "dof__timer",
    reason:
      "شارةُ مهلةِ العرضِ النصّيّةُ في لوحِ العروضِ وتفاصيلِ العرض. حلَّ محلَّها في UI-4 (D1–D2 · §11 PR 6 «مؤقّتُ CSS + بطاقةُ عرض») مكوّنُ `UiTimer` من UI-1: شريطٌ يُفرَغُ بحركةِ CSS ونصٌّ يقولُ ما بقيَ لحظةَ العرض. والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-4 · ADR 0236 · .ui-timer عبرَ offers/offer-timer.ts",
  },
  {
    className: "dof__timer--calm",
    reason:
      "نغمةُ الشارةِ الهادئةُ — صارَت `ui-timer` بنغمةِ `neutral` (UI-4 · ADR 0236). والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-4 · ADR 0236 · .ui-timer",
  },
  {
    className: "dof__timer--urgent",
    reason: "نغمةُ الشارةِ الملحّةُ — صارَت `ui-timer--amber` (UI-4 · ADR 0236). والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-4 · ADR 0236 · .ui-timer--amber",
  },
  {
    className: "dof__timer--elapsed",
    reason:
      "نغمةُ انقضاءِ المهلةِ — صارَت `ui-timer--bad` معَ نصِّ «انتهت المهلة» (UI-4 · ADR 0236). والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-4 · ADR 0236 · .ui-timer--bad",
  },
  {
    className: "dveh__nav",
    reason:
      "زرُّ «مركبتي» في الشاشةِ الفارغةِ عن قصدٍ داخلَ `DriverRoot` — وكانَ نصُّه مُضمَّناً بلا قاموس. زالَت تلكَ الشاشةُ في UI-4 وصارَ المدخلُ في «حسابي» (`driver.account.work.vehicle`) بصنفِ `sys__action`. والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-4 · ADR 0236 · driver/account/AccountScreen.tsx",
  },
  {
    className: "rh__map--off",
    reason:
      "صندوقُ «الخريطةُ غيرُ متاحةٍ» المتقطِّعُ في رئيسةِ الراكبِ. رُفِعَ في `UI-DESIGN-01` لأنَّه أوّلُ ما يراهُ الراكبُ ويُقرأُ عطلاً، وحلَّ محلَّه سطرُ إرشادٍ `sys__hint` تحتَ حقلِ الوجهةِ يقولُ النصَّ نفسَه (`rider.home.map.unavailable`). والحذفُ ممنوعٌ (`ح-1`).",
    owner: "منفّذ المستودع",
    supersededBy: "UI-DESIGN-01 · .sys__hint تحتَ .rh__field",
  },
  {
    className: "rs__stopped",
    reason:
      "مُحدِّدُ صندوقِ «تَوقَّفَ البثُّ» في شاشةِ البحثِ. نُزِعَ الاستقصاءُ الدوريُّ فحلَّ محلَّه `.rs__snapshot` بشكلِه نفسِه، ونصُّ `global.css` يقولُ حرفاً «والمُحدِّدُ الأوّلُ يبقى مكتوباً ولا يُمحى» — فالحذفُ ممنوعٌ بـ`ح-1`، والبقاءُ بلا بيانٍ عفَنٌ. فيُسجَّلُ.",
    owner: "منفّذ المستودع",
    supersededBy: "ADR 0035 §4 · .rs__snapshot",
  },
  {
    className: "qt__pending-item",
    reason:
      "سطرُ حاشيةٍ مفصولٌ بحدٍّ أعلى في شاشةِ الاقتباسِ. كانَ يُصدَرُ في `F2-04` لنصِّ «طلبُ الرحلةِ لم يُبنَ بعدُ»، ثمَّ **بُنِيَ الطلبُ** في `F2-05` فرُفِعَ السطرُ لأنَّ عرضَ نصٍّ نُقِضَ كذبٌ. فمُصدِرُها زالَ **بقرارٍ منشورٍ لا بسهوٍ**، والحذفُ ممنوعٌ (`ح-1`)، ووصلُها بعنصرٍ آخرَ لمجرّدِ إرضاءِ حاجزٍ اختراعُ استعمالٍ.",
    owner: "منفّذ المستودع",
    supersededBy: "F2-05 · ADR 0104 · قسمُ `.qt__request` في `QuoteScreen.tsx`",
  },
  {
    className: "rs__links",
    reason:
      "قائمةُ روابطِ المشاركةِ في بطاقةِ الراكبةِ. رُفِعَت في `F12-04` لأنَّ العدَّ التنازليَّ لكلِّ رابطٍ كانَ يُطرَحُ من **سقفِ** الرابطِ لا من موعدِ موتِه، فصارَ الحكمُ سطراً واحداً (`.rs__until`) نحوَ موعدٍ واحدٍ. فمُصدِرُها زالَ **بقرارٍ منشورٍ** لا بسهوٍ، والحذفُ ممنوعٌ (`ح-1`)، ووصلُها بعنصرٍ آخرَ إرضاءً لحاجزٍ اختراعُ استعمالٍ.",
    owner: "منفّذ المستودع",
    supersededBy: "F12-04 · ADR 0146 · `.rs__until` في `RideShareCard.tsx`",
  },
  {
    className: "rs__link",
    reason:
      "صندوقُ رابطٍ واحدٍ داخلَ تلكَ القائمةِ — زالَ مُصدِرُه بزوالِها في `F12-04` وللسببِ عينِه: لا عدَّ لكلِّ رابطٍ بعدَ اليومَ.",
    owner: "منفّذ المستودع",
    supersededBy: "F12-04 · ADR 0146 · `.rs__until` في `RideShareCard.tsx`",
  },
];

/** موضعُ صنفٍ مُصدَرٍ: الملفُّ والسطرُ والاسمُ. */
export interface EmittedClass {
  readonly file: string;
  readonly line: number;
  readonly className: string;
}

/** تعبيرُ صنفٍ لا يُحَلُّ ساكناً — خرقُ القاعدةِ ٣. */
export interface OpaqueEmission {
  readonly file: string;
  readonly line: number;
  readonly expression: string;
}

export interface Emission {
  readonly classes: readonly EmittedClass[];
  readonly opaque: readonly OpaqueEmission[];
}

export interface CoverageInput {
  /** مسارُ الورقةِ ⇒ نصُّها. */
  readonly stylesheets: Readonly<Record<string, string>>;
  /** مسارُ الملفِّ ⇒ نصُّه (بلا ملفّاتِ الاختبارِ). */
  readonly sources: Readonly<Record<string, string>>;
  /**
   * سجلُّ القواعدِ الباقيةِ. يُترَكُ غائباً في CI فيُقرأُ `RETAINED_RULES`؛
   * ويُمرَّرُ مُصنَّعاً في الاختبارِ كي تُبرهَنَ **حالةُ السقوطِ** على سجلٍّ بلا
   * سببٍ أو بلا مالكٍ — ولو كانَ السجلُّ ثابتاً في الوحدةِ لبقيَت تلكَ القاعدةُ
   * مكتوبةً بلا حالةٍ سالبةٍ، فلا تُحسَبُ مفروضةً (`ح-7`).
   */
  readonly retained?: readonly RetainedRule[];
}

// لا `String.raw` ههنا: النمطُ خلوٌ من الشرطةِ المائلةِ أصلاً، فيكونُ `raw`
// زينةً بلا أثرٍ يردُّها `noUselessStringRaw` — والقاعدةُ محقّةٌ، فالزينةُ
// تُوهِمُ قارئاً لاحقاً أنَّ ههنا هرباً يجبُ الحذرُ منه وليسَ.
const NAME = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const CLASS_NAME_PATTERN = new RegExp(`^(${NAME})(?:__(${NAME}))?(?:--(${NAME}))?$`);

/** أسماءُ الخصائصِ التي تحملُ صنفاً حرفيّاً في جدولٍ (القاعدة ٣، الشكلُ الثالثُ). */
const CLASS_BEARING_KEYS: readonly string[] = ["className", "class", "modifier"];

/** يُزيلُ تعليقاتَ CSS بلا إزالةِ سطرٍ، كي يبقى رقمُ السطرِ صادقاً. */
export function blankCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * أصنافُ المُحدِّداتِ في ورقةِ نمطٍ: تُقرأُ **صدورُ المُحدِّداتِ** وحدَها — ما قبلَ
 * `{` — فتُستثنى الإعلاناتُ وقيمُها. وصدرُ قاعدةٍ عندَ (`@media`) يُتجاوَزُ لأنَّه
 * شرطٌ لا مُحدِّدٌ، ومُحدِّداتُ جوفِه تُقرأُ بعدَه كسواها.
 */
export function extractStyledClasses(css: string): Map<string, number> {
  const text = blankCssComments(css);
  const found = new Map<string, number>();
  let prelude = "";
  let line = 1;
  let preludeLine = 1;
  for (const character of text) {
    if (character === "\n") line += 1;
    if (character === "{") {
      const trimmed = prelude.trim();
      if (!trimmed.startsWith("@")) {
        for (const match of trimmed.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
          const className = match[1] ?? "";
          if (!found.has(className)) found.set(className, preludeLine);
        }
      }
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (character === "}" || character === ";") {
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (prelude.trim().length === 0 && character.trim().length > 0) preludeLine = line;
    prelude += character;
  }
  return found;
}

/** يقسِمُ قيمةَ `class` إلى أصنافٍ، ويُهمِلُ الفراغَ. */
function tokens(value: string): readonly string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

interface Literal {
  readonly value: string;
  readonly line: number;
}

interface Interpolation {
  readonly code: string;
  readonly line: number;
  /** النصوصُ الحرفيّةُ داخلَ الإحلالِ — إن وُجِدَت حُلَّ الإحلالُ. */
  readonly literals: readonly Literal[];
}

interface ExpressionParts {
  readonly literals: readonly Literal[];
  readonly interpolations: readonly Interpolation[];
  /** نهايةُ التعبيرِ في النصِّ. */
  readonly end: number;
}

/**
 * يقرأُ تعبيرَ `className` من `start` (أوّلِ حرفٍ بعدَ `=`) إلى نهايتِه، فيُعيدُ
 * نصوصَه الحرفيّةَ وإحلالاتِه. ماسحٌ بحرفٍ حرفٍ لأنَّ التعبيرَ قد يحملُ قوالبَ
 * متداخلةً ونصوصاً داخلَ إحلالاتٍ، وتعبيرٌ نمطيٌّ واحدٌ لا يقرأُ ذلكَ بصدقٍ.
 */
function readExpression(source: string, start: number, startLine: number): ExpressionParts {
  const literals: Literal[] = [];
  const interpolations: Interpolation[] = [];
  let index = start;
  let line = startLine;
  let depth = 0;
  let started = false;

  const readString = (quote: string): void => {
    let value = "";
    const openedAt = line;
    index += 1;
    while (index < source.length) {
      const character = source[index] ?? "";
      if (character === "\\") {
        value += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (character === quote) {
        index += 1;
        break;
      }
      if (character === "\n") line += 1;
      value += character;
      index += 1;
    }
    literals.push({ value, line: openedAt });
  };

  const readTemplate = (): void => {
    index += 1;
    let chunk = "";
    let chunkLine = line;
    while (index < source.length) {
      const character = source[index] ?? "";
      if (character === "\\") {
        chunk += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (character === "`") {
        index += 1;
        break;
      }
      if (character === "$" && source[index + 1] === "{") {
        literals.push({ value: chunk, line: chunkLine });
        chunk = "";
        const openedAt = line;
        index += 2;
        let inner = "";
        let innerDepth = 1;
        const innerLiterals: Literal[] = [];
        while (index < source.length && innerDepth > 0) {
          const innerCharacter = source[index] ?? "";
          if (innerCharacter === "{") innerDepth += 1;
          else if (innerCharacter === "}") {
            innerDepth -= 1;
            if (innerDepth === 0) {
              index += 1;
              break;
            }
          } else if (innerCharacter === '"' || innerCharacter === "'") {
            const nested = readExpression(source, index, line);
            for (const literal of nested.literals) innerLiterals.push(literal);
            inner += source.slice(index, nested.end);
            index = nested.end;
            continue;
          } else if (innerCharacter === "`") {
            const nested = readExpression(source, index, line);
            for (const literal of nested.literals) innerLiterals.push(literal);
            inner += source.slice(index, nested.end);
            index = nested.end;
            continue;
          } else if (innerCharacter === "\n") line += 1;
          inner += innerCharacter;
          index += 1;
        }
        for (const literal of innerLiterals) literals.push(literal);
        interpolations.push({ code: inner.trim(), line: openedAt, literals: innerLiterals });
        chunkLine = line;
        continue;
      }
      if (character === "\n") line += 1;
      chunk += character;
      index += 1;
    }
    literals.push({ value: chunk, line: chunkLine });
  };

  while (index < source.length) {
    const character = source[index] ?? "";
    if (character === '"' || character === "'") {
      readString(character);
      if (depth === 0 && started) break;
      if (depth === 0) break;
      continue;
    }
    if (character === "`") {
      readTemplate();
      if (depth === 0) break;
      continue;
    }
    if (character === "{") {
      depth += 1;
      started = true;
      index += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      index += 1;
      if (depth <= 0) break;
      continue;
    }
    if (character === "\n") line += 1;
    index += 1;
  }
  return { literals, interpolations, end: index };
}

/** نصوصُ جدولٍ تحملُ صنفاً: `modifier: "sk__line--title"` وما شابَهَه. */
function tableLiterals(source: string): Map<string, readonly string[]> {
  const byKey = new Map<string, string[]>();
  for (const key of CLASS_BEARING_KEYS) {
    const pattern = new RegExp(`\\b${key}\\s*[:=]\\s*(?:"([^"\\n]*)"|'([^'\\n]*)')`, "g");
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? "";
      const bucket = byKey.get(key) ?? [];
      bucket.push(value);
      byKey.set(key, bucket);
    }
  }
  return byKey;
}

/** جذرُ المُعرِّفِ في إحلالٍ: `line.modifier` ⇒ `modifier`، و`on ? a : b` ⇒ `on`. */
function interpolationKey(code: string): string | null {
  const members = code.match(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)+/);
  if (members !== null) {
    const parts = members[0].split(".").map((part) => part.trim());
    return parts[parts.length - 1] ?? null;
  }
  const identifier = code.match(/[A-Za-z_$][\w$]*/);
  return identifier === null ? null : identifier[0];
}

/**
 * أصنافُ ملفٍّ واحدٍ وإحلالاتُه المُبهَمةُ. يُقرأُ كلُّ موضعِ `className` ثمَّ
 * يُحَلُّ تعبيرُه؛ وتُضافُ نصوصُ جداولِ الأصنافِ لأنَّ الإحلالَ يقرأُ منها.
 */
export function extractEmittedClasses(file: string, source: string): Emission {
  const classes: EmittedClass[] = [];
  const opaque: OpaqueEmission[] = [];
  const tables = tableLiterals(source);

  for (const match of source.matchAll(/\bclassName\s*=/g)) {
    const at = (match.index ?? 0) + match[0].length;
    const line = source.slice(0, at).split("\n").length;
    const parts = readExpression(source, at, line);
    for (const literal of parts.literals) {
      for (const token of tokens(literal.value)) {
        classes.push({ file, line: literal.line, className: token });
      }
    }
    for (const interpolation of parts.interpolations) {
      if (interpolation.literals.length > 0) continue;
      const key = interpolationKey(interpolation.code);
      const fromTable = key === null ? undefined : tables.get(key);
      if (fromTable === undefined || fromTable.length === 0) {
        opaque.push({ file, line: interpolation.line, expression: interpolation.code });
        continue;
      }
      for (const value of fromTable) {
        for (const token of tokens(value)) {
          classes.push({ file, line: interpolation.line, className: token });
        }
      }
    }
  }
  return { classes, opaque };
}

/** هل الاسمُ يتبعُ التسميةَ المُعلَنةَ، وبادئتُه مُسجَّلةٌ؟ (القاعدة ٤) */
export function namingProblem(className: string): string | null {
  const match = CLASS_NAME_PATTERN.exec(className);
  if (match === null) {
    return `الصنفُ «${className}» لا يتبعُ التسميةَ المُعلَنةَ «block__element--modifier» بحروفٍ صغيرةٍ — واسمٌ خارجَ التسميةِ يُقرأُ قاعدةً جديدةً وهوَ في الغالبِ خطأٌ إملائيٌّ.`;
  }
  const block = match[1] ?? "";
  if (!DECLARED_BLOCKS.includes(block)) {
    return `بادئةُ الكتلةِ «${block}» (في «${className}») ليسَت في «DECLARED_BLOCKS» — سطحٌ يخترعُ بادئةً لا يعرفُها الحاجزُ يُخفي أنماطَه عن كلِّ قياسٍ لاحقٍ.`;
  }
  return null;
}

/** الحكمُ: قائمةُ خرقٍ مقروءةٍ، فارغةٌ إن لم يكنْ خرقٌ. */
export function coverageProblems(input: CoverageInput): readonly string[] {
  const problems: string[] = [];

  const styled = new Map<string, string>();
  for (const [path, css] of Object.entries(input.stylesheets)) {
    for (const className of extractStyledClasses(css).keys()) {
      if (!styled.has(className)) styled.set(className, path);
    }
  }

  const emitted = new Map<string, EmittedClass>();
  for (const [path, source] of Object.entries(input.sources)) {
    const emission = extractEmittedClasses(path, source);
    for (const item of emission.classes) {
      if (!emitted.has(item.className)) emitted.set(item.className, item);
    }
    for (const item of emission.opaque) {
      problems.push(
        `${item.file}:${item.line} — تعبيرُ صنفٍ لا يُحَلُّ ساكناً «\${${item.expression}}»: لا نصَّ حرفيّاً فيه ولا جدولَ أصنافٍ في الملفِّ يُقرأُ منه. فما يُصدَرُ فعلاً خارجُ كلِّ قياسٍ، والحاجزُ يمرُّ أخضرَ وهوَ لا يعلمُ (القاعدة ٣).`,
      );
    }
  }

  // القاعدةُ ٤ — التسميةُ والبادئةُ، على المُصدَرِ وعلى المُحدِّدِ سواءً.
  for (const [className, item] of emitted) {
    const problem = namingProblem(className);
    if (problem !== null) problems.push(`${item.file}:${item.line} — ${problem}`);
  }
  for (const [className, path] of styled) {
    const problem = namingProblem(className);
    if (problem !== null) problems.push(`${path} — ${problem}`);
  }

  // القاعدةُ ١ — لا صنفَ مُصدَرٌ بلا قاعدةٍ. وهذا نصُّ `UX-021`.
  for (const [className, item] of emitted) {
    if (styled.has(className)) continue;
    problems.push(
      `${item.file}:${item.line} — الصنفُ «${className}» يُصدَرُ في العرضِ ولا مُحدِّدَ له في ورقةِ النمطِ: العنصرُ يُرسَمُ بأنماطِ المتصفِّحِ الافتراضيّةِ، ولا بناءٌ ولا اختبارٌ يُخفِقُ به — يراهُ المستخدمُ وحدَه (القاعدة ١ · UX-021).`,
    );
  }

  // القاعدةُ ٢ — لا قاعدةَ بلا مُصدِرٍ إلّا مُسجَّلةً.
  const registry = input.retained ?? RETAINED_RULES;
  const retained = new Map(registry.map((rule) => [rule.className, rule]));
  for (const [className, path] of styled) {
    if (emitted.has(className)) continue;
    const rule = retained.get(className);
    if (rule === undefined) {
      problems.push(
        `${path} — القاعدةُ «.${className}» لا يُصدِرُها عرضٌ: إمّا سطحٌ نسيَ أن يستعملَها فالشكلُ المقصودُ غائبٌ، وإمّا قاعدةٌ زالَ مُصدِرُها. والحذفُ ممنوعٌ (ح-1) فتُسجَّلُ في «RETAINED_RULES» بسببٍ ومالكٍ وما أحلَّها (القاعدة ٢).`,
      );
      continue;
    }
    if (rule.reason.trim().length === 0 || rule.owner.trim().length === 0) {
      problems.push(
        `${path} — مدخلُ «.${className}» في «RETAINED_RULES» بلا سببٍ أو بلا مالكٍ: سجلٌّ بلا بيانٍ بابُ إسكاتٍ لا سجلُّ تدقيقٍ (القاعدة ٢).`,
      );
    }
    if (rule.supersededBy.trim().length === 0) {
      problems.push(
        `${path} — مدخلُ «.${className}» لا يُسمّي ما أحلَّه: «زالَ مُصدِرُه» بلا قرارٍ يُحيلُ إليه رأيٌ لا حكمٌ (القاعدة ٢).`,
      );
    }
  }

  // مدخلٌ في السجلِّ لقاعدةٍ لها مُصدِرٌ، أو لا وجودَ لها: السجلُّ نفسُه يتقادمُ.
  for (const rule of registry) {
    if (!styled.has(rule.className)) {
      problems.push(
        `«RETAINED_RULES» يحملُ «.${rule.className}» ولا مُحدِّدَ بهذا الاسمِ في ورقةِ النمطِ — مدخلٌ يحرسُ معدوماً يُقرأُ حرساً وهوَ لا شيءٌ (القاعدة ٢).`,
      );
      continue;
    }
    if (emitted.has(rule.className)) {
      problems.push(
        `«RETAINED_RULES» يحملُ «.${rule.className}» وهيَ **مُصدَرةٌ** فعلاً في العرضِ — يُرفَعُ المدخلُ لا يُترَكُ، وإلّا احتمى بالسجلِّ ما لا يحتاجُه (القاعدة ٢).`,
      );
    }
  }

  return problems;
}
