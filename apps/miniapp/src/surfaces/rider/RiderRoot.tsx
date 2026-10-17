/**
 * الغرض: السطحُ الجذريُّ للراكب — نقطةُ وصولِ التوجيهِ المبنيِّ على الدور
 *   (البند `F1-05`). سطحٌ **فارغٌ من حالةِ الأعمالِ** عن قصد: شاشاتُ الراكبِ
 *   (طلبُ رحلةٍ · العروضُ · التتبّعُ) بنودُ `F2`، ولا تُدَّعى ههنا.
 * الحالة: منفّذ فعلياً — البند `F1-05` (سطحٌ جذريٌّ لا شاشاتُ منتَج).
 * ينتمي إلى: apps/miniapp/src/surfaces/rider (حزمة `rider-home` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: شاشاتُ `F2` تُركَّب داخلَ هذا السطح.
 * ملاحظات مستقبلية: الشريطُ السفليُّ بأربعِ علاماتٍ (القسم 9.3) بندُ `F1-07`.
 *
 * ## إضافةُ البند `F2-01` (2026-09-12)
 *
 * صارَ السطحُ يُركِّبُ شاشةَ الترحيبِ `SR-01` **قبلَ** حالةِ الفراغِ: الموافقاتُ
 * شرطُ دخولٍ تنظيميٌّ (القسمان 9.12 و16)، فلا تُعرَضُ شاشةُ منتَجٍ قبلَها.
 * وحالةُ الفراغِ الأصليّةُ **باقيةٌ كما هي** ولم تُحذَف (القاعدة ح-1): هيَ ما
 * يُعرَضُ بعدَ اكتمالِ الموافقاتِ، وهيَ الصدقُ في أنَّ ما بعدَ الترحيبِ لم يُبنَ.
 *
 * وما لا يفعلُه هذا السطحُ: لا يقرّرُ اكتمالَ الموافقاتِ بنفسِه ولا يحفظُ ذاكَ
 * محلّيّاً — الشاشةُ تسألُ الخادمَ في كلِّ تركيبٍ، فلا يتخطّى العميلُ إقراراً
 * بسببِ رايةٍ في `localStorage`.
 *
 * ## إضافةُ البند `F2-02` (2026-09-13)
 *
 * صارَ ما بعدَ الترحيبِ شاشةَ الراكبِ الرئيسةَ `SR-02` لا حالةَ فراغٍ. وحالةُ
 * الفراغِ الأصليّةُ **باقيةٌ في الملفِّ** (القاعدة ح-1) موصوفةً أدناه: هيَ ما كانَ
 * يُعرَضُ قبلَ `F2-02`، وقد صارَ لها بديلٌ مبنيٌّ، فلا تُرسَمُ. ولا يُدَّعى بذاكَ
 * أنَّ سلسلةَ `F2` تمَّت: الطلبُ والعروضُ والتتبّعُ بنودٌ تالية.
 *
 * ## إضافةُ البند `F2-03` (2026-09-13)
 *
 * صارَ للسطحِ **مرحلةٌ ثالثةٌ**: بعدَ أن تُختارَ وجهةٌ في `SR-02` تُركَّبُ شاشةُ
 * `SR-03` لِتُصادَقَ تلكَ الوجهةُ على حدِّ منطقةِ الخدمةِ. وما قبلَها **باقٍ كما
 * هوَ** (القاعدة ح-1): الترحيبُ ثمَّ الشاشةُ الرئيسةُ، ولا سطرَ حُذِفَ.
 *
 * ولماذا مرحلةٌ لا حوارٌ فوقَ الشاشةِ: الاختيارُ ههنا **قد يُرفَضُ**، والرفضُ
 * نصٌّ يُقرأُ ويُعادُ معه الاختيارُ — وحوارٌ صغيرٌ فوقَ شاشةٍ كاملةٍ لا يتّسعُ
 * لِأن يُقرأَ فيه سببٌ ثمَّ يُعادَ فيه بحثٌ.
 *
 * وما لا يفعلُه: لا يُنشئُ طلباً بعدَ التأكيدِ. `onConfirmed` يُعيدُ اليومَ إلى
 * الشاشةِ الرئيسةِ، وإنشاءُ الطلبِ بندُ `F2-04` ولا يُدَّعى ههنا بزرٍّ لا يفعلُ
 * شيئاً.
 *
 * ## إضافةُ البند `F2-04` (2026-09-13)
 *
 * صارَ للسطحِ **مرحلةٌ رابعةٌ**: بعدَ أن تُصادَقَ الوجهةُ في `SR-03` تُركَّبُ شاشةُ
 * `SR-04` فتُقاسُ المسافةُ وتُعلَنُ المدّةُ وتُعرَضُ الخدماتُ المخدومةُ في
 * المدينةِ. وما قبلَها **باقٍ كما هوَ** (القاعدة ح-1) ولا سطرَ حُذِفَ؛ والسطرُ
 * الذي كانَ يقولُ إنَّ `onConfirmed` يُعيدُ إلى الشاشةِ الرئيسةِ **باقٍ أعلاه**
 * وصفاً لِما كانَ، وقد صارَ التأكيدُ يُقدِّمُ إلى `SR-04`.
 *
 * ولماذا مرحلةٌ رابعةٌ لا حقلٌ في `SR-03`: الاقتباسُ يقرأُ **موقعَ الراكبِ الآنَ**
 * وقد يُرفَضُ إذنُه، وشاشةُ الوجهةِ لا تتّسعُ لِحكمَينِ قد يُرفَضَ كلٌّ منهما
 * بسببٍ مختلفٍ ويُعرَضَ لكلٍّ فعلُه.
 *
 * وما لا يفعلُه بعدَ `F2-04`: لا يُنشئُ طلباً — إنشاءُ الطلبِ بندُ `F2-05`،
 * و`SR-04` تقولُ ذاكَ صريحاً ولا تعرضُ زرّاً صامتاً. ولا يعرضُ سعراً: آليّةُ
 * الأجرةِ محجوبةٌ على قرارٍ نظاميٍّ (`ADR 0039` §٤ · `م13-7`).
 *
 * ## إضافةُ البند `F2-05` (2026-09-13)
 *
 * صارَ للسطحِ **مرحلةٌ خامسةٌ**: بعدَ أن يُطلَبَ في `SR-04` تُركَّبُ شاشةُ البحثِ
 * `SR-05` فتُنشئُ الرحلةَ بمفتاحِ تكرارٍ واحدٍ وتعرضُ حالتَها الصادقةَ. وما قبلَها
 * **باقٍ كما هوَ** (القاعدة ح-1) ولا سطرَ حُذِفَ؛ والسطرُ أعلاه الذي يقولُ إنَّ
 * `F2-04` لا يُنشئُ طلباً **باقٍ** وصفاً لِما كانَ، وقد صارَ الطلبُ يُسلَّمُ من
 * `SR-04` إلى هذه المرحلةِ.
 *
 * ولماذا **النيّةُ** تُرفَعُ ههنا ولا تُنشأُ الرحلةُ في شاشةِ الاقتباسِ: لِأنَّ
 * الرحلةَ تعيشُ دقائقَ وتُلغى وتُعادُ قراءتُها، فحالتُها في شاشةٍ لها عمرٌ. ولأنَّ
 * الرجوعَ من البحثِ يجبُ أن يعودَ إلى **الشاشةِ الرئيسةِ** لا إلى اقتباسٍ صارَ
 * قديماً: الوجهةُ نفسُها قد تُقتبَسُ ثانيةً بحكمٍ جديدٍ.
 *
 * وما لا يفعلُه بعدَ `F2-05`: لا يُتابِعُ رحلةً بعدَ الإسنادِ — شاشةُ الرحلةِ
 * النشطةِ بندُ `F2-06`، و`SR-05` تعرضُ الحالةَ كما هيَ ولا تزعمُ تتبّعاً.
 *
 * ## إضافةُ البند `F2-07` (2026-09-13)
 *
 * صارَ للسطحِ **مرحلةٌ سادسةٌ هيَ أعلى الترتيبِ**: `summarized`. متى انتهت
 * الرحلةُ وطلبَ الراكبُ ملخَّصَها تُركَّبُ `SR-07`/`SR-08`: مدّةٌ ووترُ خطٍّ
 * مستقيمٍ وبطاقةُ سائقٍ ونموذجُ تقييمٍ. وما قبلَها **باقٍ كما هوَ** (القاعدة ح-1)
 * ولا سطرَ حُذِفَ؛ والسطرُ أعلاه القائلُ إنَّ متابعةَ الرحلةِ **أعلى الترتيبِ**
 * باقٍ وصفاً لِما كانَ، وقد صارَ فوقَه الملخَّصُ.
 *
 * ولماذا **فوقَ** المتابعةِ: رحلةٌ انتهت لا تُتابَعُ، ومتى فُتِحَ ملخَّصٌ فإعادةُ
 * رسمِ شاشةِ التتبُّعِ تحتَه تُوهِمُ بحركةٍ لا تحدثُ. والمعرّفَانِ **لا يُدمجانِ**:
 * `followed` رحلةٌ تجري تُسألُ حالتُها دوريّاً، و`summarized` رحلةٌ مضَت تُقرأُ مرّةً
 * واحدةً وتُقَيَّمُ — وخلطُهما يُمكِّنُ من نموذجِ تقييمٍ فوقَ رحلةٍ لم تنتهِ.
 *
 * وما لا يفعلُه بعدَ `F2-07`: لا يعرضُ إيصالاً ولا أجرةً (`ADR 0039` §٤ · `م13-7`)،
 * ولا يُشارِكُ رحلةً (`F2-09`)، ولا يفتحُ تذكرةَ دعمٍ: **غيابٌ مُصرَّحٌ** في دليلِ
 * الإغلاقِ لا زرٌّ مُعطَّلٌ.
 *
 * ## إضافةُ البند `F2-08` (2026-09-14)
 *
 * صارَ للسطحِ **طورانِ زائدانِ**: `browsed` (سجلُّ الرحلاتِ `SR-09`) و
 * `inspected` (تفاصيلُ رحلةٍ `SR-10`). وما قبلَهما **باقٍ كما هوَ** (القاعدة ح-1)
 * ولا سطرَ حُذِفَ؛ والسطرُ أعلاه القائلُ إنَّ الملخَّصَ **أعلى الترتيبِ كلِّه**
 * باقٍ وصفاً لِما كانَ، وقد صارَ فوقَه طورا السجلِّ والتفاصيلِ.
 *
 * ولماذا **طورانِ لا طورٌ واحدٌ**: السجلُّ قائمةٌ لها موضعُ تصفُّحٍ ونصُّ بحثٍ،
 * والرجوعُ من التفاصيلِ يجبُ أن يعودَ إلى **تلكَ القائمةِ لا إلى رأسِها**. وطورٌ
 * واحدٌ يحملُ الاثنينِ يُلزِمُ بإعادةِ قراءةِ القائمةِ من أوّلِها بعدَ كلِّ رجوعٍ.
 *
 * ولماذا التفاصيلُ **تحملُ منطقةَ التصنيفِ** من السجلِّ: لحظةُ حدثٍ تُعرَضُ
 * بساعةٍ تخالفُ ساعةَ عنوانِ شهرِها تُنقِضُ القائمةَ التي جاءت منها. **ولا تُقرَأُ
 * من ساعةِ الجهازِ** (القاعدة 0.6).
 *
 * ورحلةٌ **جاريةٌ** في السجلِّ تُسلَّمُ إلى `followed` لا إلى `inspected`: سؤالُ
 * الراكبِ عنها «أينَ سائقي الآنَ؟» لا «ماذا جرى؟».
 *
 * وما لا يفعلُه بعدَ `F2-08`: لا يعرضُ إيصالاً ولا مبلغاً ولا مجموعَ شهرٍ
 * (`ADR 0039` §٤)، ولا يرسمُ خريطةً لمسارٍ ماضٍ (`ADR 0007`) — **غياباتٌ
 * مُصرَّحةٌ نصّاً** لا أزرارٌ مُعطَّلةٌ.
 *
 * وقد كانَ مكتوباً ههنا «ولا يفتحُ تذكرةَ دعمٍ (`F2-12`)»، وذاكَ **صدقُ تلكَ
 * اللحظةِ**؛ وقد نُقِضَ بالبندِ `F2-12` تصحيحاً بالإضافةِ لا بالمحوِ (`ح-8`):
 * شاشةُ الدعمِ تُفتَحُ الآنَ من شاشةِ الحسابِ ومن تفاصيلِ رحلةٍ، وتُحمَلُ إليها
 * الرحلةُ مُثبَّتةً لا مكتوبةً بيدٍ.
 *
 * ## وصلُ UI-3 / PR 3 (2026-10-06)
 *
 * صارَت خطواتُ الراكبِ R0–R5 تبدأُ بعدَ حاجزِ الترحيبِ كما كانت، ثمَّ يستخدمُ
 * `مكدّسَ UI-2 (`screenStackReducer` داخلَ `rider-flow.ts`) للانتقالِ بينِ `home → destination → quote`، ويغلِقُ مكدّسَ
 * التدفّقِ حينَ تُسلَّمُ نيّةُ الطلبِ إلى شاشةِ البحثِ R6. إطارُ الجذرِ يحملُ
 * التبويباتِ الأربعَ من القاموسِ، وإطارا الوجهةِ والاقتباسِ يحملانِ رجوعاً واحداً؛
 * وما بعدَ R5 يبقى على حالاتِ `useState` القديمةِ في نطاقِ PR4.
 *
 * ## وصلُ UI-3 / PR 4 (2026-10-06 · ADR 0237): R6–R10
 *
 * الترقيمُ الكانونيُّ: R6 البحثُ عن سائق · R7 الرحلةُ النشطة · R8 مشاركةُ الرحلة (بطاقةٌ داخلَ R7) ·
 * R9 SOS · R10 ملخّصُ الرحلةِ والتقييم. صارَت R6 وR7 وR9 وR10 تدفّقاتٍ في `ScreenFrame mode="flow"`
 * برجوعٍ واحدٍ من رأسِ الإطارِ (`BackButton`)؛ وترتيبُ الرايات (`intent` · `followed` · `summarized` ·
 * `sosOpen`) باقٍ كما هوَ — لا آلةَ حالةٍ ثانيةٌ ولا تغييرَ في الانتقالات. واللغةُ تصلُ الآنَ إلى الشاشاتِ
 * الأربع (كانَت تُرسَمُ بالافتراضيِّ). السكّةُ وشريطُ الحقيقةِ في R6/R7 من `active/ride-journey.ts`.
 *
 * ## وصلُ UI-3 / PR 5 (2026-10-06 · ADR 0238): R11–R15 و[B]
 *
 * R11 «رحلاتي» وR15 «الدعم» وR13 «حسابي» صارَت **تبويباتٍ جذريّةً** في `ScreenFrame mode="root"` يقودُها
 * `stack.tab` (كما في سطحِ السائق) — كانَت راياتٍ (`browsed` · `support` · `account`) تُرسَمُ بلا إطارٍ فيختفي
 * شريطُ التبويبات. وتفاصيلُ رحلةٍ وR12 الإشعاراتُ وR14 الخصوصيّةُ والأسئلةُ والمفقوداتُ والشكوى المربوطةُ
 * برحلةٍ تدفّقاتٌ في `ScreenFrame mode="flow"` برجوعٍ واحد. وصُحِّحَ عيبا ترتيبٍ: الخصوصيّةُ المفتوحةُ من
 * الحسابِ والأسئلةُ المفتوحةُ من الدعمِ لم تكونا تُرسَمانِ قطّ (كانَ ما فُتِحتا منه يُفحَصُ قبلَهما).
 * وعناصرُ [B] لوحاتٌ داخلَ R12/R13/R15 على عقودِها القائمة، وكلٌّ منها يقولُ «غيرُ متاحٍ» عندَ 503.
 */

import { lazy, type ReactNode, Suspense, useEffect, useMemo, useReducer, useState } from "react";
import {
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/core.ts";
import type { LanguageSurfaceProps } from "../../routing/RoleRouter.tsx";
import type { ROOT_TABS } from "../../shell/root-tabs.ts";
import { RootTabBar, ScreenFrame, ScreenTransition } from "../../shell/ScreenFrame.tsx";
import { currentScreenKey } from "../../shell/screen-stack.ts";
import { Skeleton } from "../../system/Skeleton.tsx";
import { riderEntryState } from "./entry-view.ts";
import { HomeScreen } from "./home/HomeScreen.tsx";
import {
  initialRiderFlow,
  type RiderRootTab,
  riderFlowHandlers,
  riderFlowReducer,
  riderFlowView,
  riderLandingTab,
} from "./rider-flow.ts";
import type { SearchScreenIntent } from "./search/SearchScreen.tsx";
import { SosScreen } from "./sos/SosScreen.tsx";
import { WelcomeScreen } from "./welcome/WelcomeScreen.tsx";

/**
 * `F1-09` · `D-30` — تقسيمُ القسمِ 9.4 الإلزاميُّ: `rider-ride` (البحثُ والرحلةُ النشطةُ والملخّصُ والتقييمُ ومعَها قناةُ
 * `socket.io`) و`support` و`account` **عندَ الطلبِ** لا في `rider-home`. أوّلُ سطحٍ (`SR-01`) لا يحتاجُ شيئاً منها،
 * وكانَت تُنزَّلُ قبلَه على المسارِ الحرجِ. والاستغاثةُ (`PD-020`) تبقى ثابتةً في `rider-home` عن قصدٍ: شاشةُ سلامةٍ لا
 * تُؤخَّرُ بتحميلٍ. ولكي لا يدفعَ الراكبُ زمنَ الشبكةِ عندَ الانتقالِ، تُجلَبُ الحزمُ المؤجَّلةُ **بعدَ رسمِ السطحِ**
 * (`prefetchDeferredRiderScreens`)، والمحمِّلُ نفسُه يُعادُ استعمالُه فلا تُنزَّلُ مرّتَينِ.
 * وحاجزُ البناءِ `apps/miniapp/vite/assert-rider-first-surface.ts` يُسقِطُ البناءَ إن عادَت إلى حِملِ السطحِ الأوّلِ.
 */
const DEFERRED_RIDER_LOADERS = {
  ride: () => import("./rider-ride-screens.ts"),
  account: () => import("./account/AccountScreen.tsx"),
  support: () => import("./support/SupportScreen.tsx"),
  privacy: () => import("./privacy/PrivacyScreen.tsx"),
  faq: () => import("./faq/FaqScreen.tsx"),
  // `D-32`: السجلُّ وتفاصيلُه والإشعاراتُ — بطلبِ الراكبِ وحدَه، خارجَ «الرئيسية، التسعير، اختيار الخدمة» (9.4).
  history: () => import("./rider-history-screens.ts"),
  // ADR 0251 (يعدّل القسم 9.4 بموافقة المالك 2026-10-09): التسعيرُ ثاني خطوةٍ بعدَ الوجهة، فيُجلَبُ
  // بعدَ رسمِ السطحِ مع بقيّةِ المؤجَّلات لا قبلَه. الاستغاثةُ تبقى ثابتةً في `rider-home`.
  quote: () => import("./quote/QuoteScreen.tsx"),
  // ADR 0251 · D-41: الوجهةُ (`SR-03`) ليست في صفِّ `rider-home` الأصليِّ في 9.4 («الرئيسية، التسعير، اختيار
  // الخدمة»)، وأوّلُ سطحٍ لا يرسمُها؛ فتُجلَبُ بعدَ رسمِه كالتسعير. إطارُها وعنوانُها من `core` فيُرسَمانِ قبلَها.
  destination: () => import("./destination/DestinationScreen.tsx"),
} as const;

const DestinationScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.destination().then((m) => ({ default: m.DestinationScreen })),
);

const QuoteScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.quote().then((m) => ({ default: m.QuoteScreen })),
);

const SearchScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.ride().then((m) => ({ default: m.SearchScreen })),
);
const ActiveRideScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.ride().then((m) => ({ default: m.ActiveRideScreenWithChannel })),
);
const RideSummaryScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.ride().then((m) => ({ default: m.RideSummaryScreen })),
);
const RideHistoryScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.history().then((m) => ({ default: m.RideHistoryScreen })),
);
const RideDetailScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.history().then((m) => ({ default: m.RideDetailScreen })),
);
const NotificationsScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.history().then((m) => ({ default: m.NotificationsScreen })),
);
const AccountScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.account().then((m) => ({ default: m.AccountScreen })),
);
const SupportScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.support().then((m) => ({ default: m.SupportScreen })),
);
const PrivacyScreen = lazy(() =>
  DEFERRED_RIDER_LOADERS.privacy().then((m) => ({ default: m.PrivacyScreen })),
);
const FaqScreen = lazy(() => DEFERRED_RIDER_LOADERS.faq().then((m) => ({ default: m.FaqScreen })));
/** R6 · مشاركةُ الرحلةِ شاشةً مستقلّةً — البطاقةُ نفسُها من حزمةِ الرحلةِ، لا نسخةٌ ثانية. */
const RideShareCard = lazy(() =>
  DEFERRED_RIDER_LOADERS.ride().then((m) => ({ default: m.RideShareCard })),
);
/** R13 · لوحتا الحسابِ تُفتحانِ شاشتَين — من حزمةِ الحسابِ نفسِها. */
const SavedPlacesPanel = lazy(() =>
  DEFERRED_RIDER_LOADERS.account().then((m) => ({ default: m.SavedPlacesPanel })),
);
const EmergencyContactPanel = lazy(() =>
  DEFERRED_RIDER_LOADERS.account().then((m) => ({ default: m.EmergencyContactPanel })),
);
/** يجلبُ الحزمَ المؤجَّلةَ بعدَ الرسمِ؛ الفشلُ هنا لا يُعرَضُ — الشاشةُ نفسُها تُعيدُ المحاولةَ عندَ فتحِها. */
export function prefetchDeferredRiderScreens(): void {
  for (const load of Object.values(DEFERRED_RIDER_LOADERS)) void load().catch(() => undefined);
}

/** عنوانُ إطارِ الجذرِ لكلِّ تبويب — مفاتيحُ `core` (الإطارُ يُرسَمُ قبلَ تحميلِ أيِّ حزمةٍ مؤجَّلة). */
const RIDER_ROOT_TITLE_KEY = {
  home: "rider.home.title",
  rides: "rider.tabs.rides",
  support: "rider.tabs.support",
  account: "rider.tabs.account",
} as const satisfies Record<RiderRootTab, string>;

function Deferred({ children }: { readonly children: ReactNode }) {
  return <Suspense fallback={<Skeleton />}>{children}</Suspense>;
}

export default function RiderRoot({ language, onLanguageChanged, entry }: LanguageSurfaceProps) {
  const [proceeded, setProceeded] = useState(false);
  // `ADR 0213`: هدفُ الهبوطِ يُقرأُ مرّةً للحالةِ الأولى — وما بعدَها ملاحةُ المستخدمِ لا الرابطِ.
  const [landing] = useState(() => riderEntryState(entry));
  // R3–R5: آلةُ الحالةِ النقيّةُ في `rider-flow.ts` (مكدّسُ UI-2 + الاختيارُ + المصادقةُ).
  // UI-3 / PR 5: تبدأُ على تبويبِ الهبوطِ (`riderLandingTab`) — «رحلاتي»/«الدعم»/«حسابي» جذورٌ.
  const [flow, dispatchFlow] = useReducer(
    riderFlowReducer,
    riderLandingTab(landing),
    initialRiderFlow,
  );
  const stack = flow.stack;
  const stackKey = currentScreenKey(stack);
  const t = miniAppTranslator(language);
  useEffect(() => {
    // بعدَ الرسمِ لا قبلَه: `useEffect` يجري بعدَ أن يُرسَمَ السطحُ، فالجلبُ لا يُنافِسُ حِملَه.
    const timer = setTimeout(prefetchDeferredRiderScreens, 0);
    return () => clearTimeout(timer);
  }, []);
  // الوجهةُ المختارةُ والمُصادَقةُ صارتا في `flow` (`rider-flow.ts`)، ويبقى حكمُهما:
  /**
   * الوجهةُ **المُصادَقةُ** — لا المختارةُ. ولا تُدمَجُ معَ `chosen`: الأولى مرَّت
   * بحكمِ القاعدةِ والثانيةُ نصٌّ اختارَه الراكبُ، وخلطُهما يُمكِّنُ من اقتباسٍ عن
   * نقطةٍ لم يحكمْ عليها أحدٌ (القاعدة 0.5).
   */
  /**
   * نيّةُ الطلبِ — خدمةٌ وانطلاقٌ ووجهةٌ وملاحظةٌ **ومفتاحُ تكرارٍ**. ولا تُدمَجُ
   * معَ `confirmed`: الوجهةُ حكمٌ مضى، والنيّةُ أمرٌ لم يُنفَّذْ بعدُ. وبقاءُ
   * المفتاحِ في هذه الحالةِ هوَ ما يجعلُ إعادةَ المحاولةِ **المحاولةَ نفسَها**.
   */
  const [intent, setIntent] = useState<SearchScreenIntent | null>(null);
  const flowHandlers = useMemo(() => riderFlowHandlers(dispatchFlow, setIntent), []);
  const clearFlow = () => dispatchFlow({ type: "clear" });
  /**
   * الرحلةُ المُتابَعةُ (`F2-06`) — معرّفٌ لا نيّةٌ ولا حالةٌ. ولا يُدمَجُ معَ
   * `intent`: النيّةُ أمرٌ قد يُرفَضُ، والمعرّفُ رحلةٌ **قائمةٌ في القاعدةِ**.
   * وهيَ **أعلى** الترتيبِ: ما دامَت رحلةٌ تُتابَعُ فلا تُرسَمُ شاشةُ إنشاءٍ فوقَها.
   */
  const [followed, setFollowed] = useState<string | null>(landing.followed);
  /**
   * الرحلةُ **المنتهيةُ** التي يُقرأُ ملخَّصُها (`F2-07`) — معرّفٌ لا حالةٌ. ولا
   * يُدمَجُ معَ `followed`: تلكَ تجري وتُسألُ، وهذه مضَت وتُقرأُ مرّةً وتُقيَّمُ.
   * وهيَ **أعلى** الترتيبِ كلِّه: ما دامَ ملخَّصٌ مفتوحاً فلا شاشةَ تتبُّعٍ تحتَه.
   */
  const [summarized, setSummarized] = useState<string | null>(landing.summarized);
  /*
   * كانَت ههنا رايةُ `browsed` (`F2-08`): «هل يُتصفَّحُ السجلُّ؟». صارَ السجلُّ في UI-3 / PR 5 تبويبَ
   * «رحلاتي» الجذريَّ (`stack.tab === "rides"`، ADR 0238) — والقائمةُ تملِكُ موضعَها ونصَّ بحثِها داخلَها
   * كما كانَت، فلا حالةَ تُرفَعُ ههنا (`ح-8`: الحكمُ باقٍ والموضعُ تبدَّل).
   */
  /**
   * هل مركزُ الإشعاراتِ مفتوحٌ (`SS-07`)? — رايةٌ لا معرِّفٌ: الموجَزُ يُقرأُ
   * بالتتابعِ، وكلُّ ما يُرفَعُ هنا هو «مفتوحٌ» أو «مُغلَقٌ».
   */
  const [notificationsOpen, setNotificationsOpen] = useState(landing.notificationsOpen);
  /**
   * الرحلةُ المفتوحةُ تفاصيلُها (`F2-08`) — معرِّفٌ **ومنطقةُ تصنيفٍ** معاً.
   * ولا يُدمَجُ معَ `summarized`: ذاكَ ملخَّصُ **رحلةٍ انتهت** فيه نموذجُ
   * تقييمٍ، وهذا تفاصيلُ **أيّةِ رحلةٍ** ولو أُلغيَت — وخلطُهما يُمكِّنُ من
   * تقييمٍ فوقَ رحلةٍ ملغاةٍ. والمنطقةُ **تُنقَلُ من السجلِّ** فلا تُقرَأُ لحظةٌ
   * بساعةٍ تخالفُ ساعةَ العنوانِ الذي جاءت منه.
   */
  const [inspected, setInspected] = useState<{
    readonly orderId: string;
    readonly timeZone: string;
  } | null>(null);
  /*
   * وكانَت ههنا رايةُ `account` (`F2-11` · `SR-12`)، وصارَت تبويبَ «حسابي» الجذريَّ (UI-3 / PR 5) — والشاشةُ
   * تملِكُ حالَها كلَّه داخلَها كما كانَت (إيصالُ الحذفِ وكلمةُ التأكيدِ ومفتاحُ اللاتكرار).
   */
  /**
   * شاشةُ الدعمِ (`F2-12` · `SR-11`) — **رايةٌ تحملُ رحلةً أو لا تحملُها**، ولا
   * تُدمَجُ معَ `inspected`: تلكَ رحلةٌ تُقرأُ، وهذه شكوى تُكتَبُ **عنها أو عن
   * غيرِها**. وحملُ المعرّفِ ههنا هوَ ما يجعلُ الشكوى المُقدَّمةَ من تفاصيلِ رحلةٍ
   * مربوطةً بها **بلا حقلِ معرّفٍ يُملأُ بيدٍ** — وحقلٌ كذاكَ بابُ خطأٍ لا بابُ
   * دعمٍ. و`null` في الداخلِ = «شكوى عامّةٌ»، و`null` للحالةِ كلِّها = «مُغلقةٌ»؛
   * فرقٌ يضيعُ لو كانَت الحالةُ معرّفاً وحدَه.
   *
   * UI-3 / PR 5 (ADR 0238): «الشكوى العامّةُ» صارَت تبويبَ «الدعم» الجذريَّ، فالرايةُ ههنا للشكوى
   * **المربوطةِ برحلةٍ** وحدَها — تدفّقٌ برجوعٍ يعودُ إلى الرحلةِ التي جاءَ منها.
   */
  const [support, setSupport] = useState<{ readonly orderId: string } | null>(() =>
    landing.support !== null && landing.support.orderId !== null
      ? { orderId: landing.support.orderId }
      : null,
  );
  /**
   * صفحةُ المفقوداتِ المخصَّصةِ (DEC-34) — رايةٌ تفتحُ شاشةَ الدعمِ بصنفِ
   * `lost_item` مبدئيًّا. لا تُدمَجُ معَ `support`: تلكَ تحملُ رحلةً، وهذه
   * تحملُ صنفًا. والرجوعُ يُطفِئُ الرايةَ.
   */
  const [lostFound, setLostFound] = useState(false);
  /**
   * شاشةُ الأسئلة الشائعةِ (DEC-36) — رايةٌ تفتحُ صفحةَ أسئلةٍ شائعةٍ مكتوبةً
   * في قواميسِ i18n بلا خادمٍ.
   */
  const [faq, setFaq] = useState(false);
  /**
   * شاشةُ الاستغاثةِ (`PD-020` · `ADR 0159`) — **رايةٌ لا معرّفٌ**: الحكمُ كلُّهُ
   * يُقرأُ من القاعدةِ داخلَها، فلا يُرفَعُ إلى الموجِّهِ إلّا «مفتوحةٌ» و«مغلقةٌ».
   * وهيَ **أعلى الترتيبِ كلِّهِ وفوقَ الدعمِ**: فيها تأكيدٌ بخطوتَينِ وسردٌ
   * يُقرأُ بعدَ الإرسالِ، ورسمُ شاشةٍ أخرى فوقَها بعدَ فتحِها يمحو مقصودَهما —
   * والدعمُ لا يُفتَحُ منها فلا يُختلَطُ الترتيبُ. والرحلةُ النشطةُ تفتحُها بزرِّ «طلب المساعدة»
   * (لوحة التسليم 02: R5→R7) بدلَ بطاقةٍ مدمجةٍ، والرجوعُ منها يُعيدُ الرحلةَ نفسَها.
   */
  const [sosOpen, setSosOpen] = useState(landing.sosOpen);
  /**
   * شاشةُ الخصوصيّةِ (DEC-35) — رايةٌ تفتحُ شاشةَ مراجعةِ الموافقاتِ المسجَّلةِ.
   * تعيدُ استخدامُ `consentRows` و`fetchConsentStatus` من شاشةِ الترحيبِ.
   */
  const [privacy, setPrivacy] = useState(false);
  /** R6 (لوحة 02): مشاركةُ الرحلةِ المُتابَعةِ شاشةً — رايةٌ لا معرّفٌ: الرحلةُ هيَ `followed` نفسُها. */
  const [shareOpen, setShareOpen] = useState(false);
  /** R13 (لوحة 04): «الأماكن المحفوظة» و«جهة اتصال للطوارئ» شاشتانِ فوقَ «حسابي». */
  const [savedPlacesOpen, setSavedPlacesOpen] = useState(false);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  /** مدخلٌ واحدٌ لكلِّ الشاشاتِ — لا يُنشَرُ لمن لا يعرفُهُ الاستغاثةَ. */
  const onOpenSos = () => setSosOpen(true);
  /**
   * UI-3 / PR 5 (ADR 0238): التبويبُ هوَ الحالُ — لا رايةٌ تُرفَعُ بجانبِه. فشريطُ التبويباتِ يبقى ظاهراً
   * على «رحلاتي» و«الدعم» و«حسابي» كما على «الرئيسية»، وأزرارُ الرئيسيةِ تختارُ التبويبَ نفسَه.
   */
  const selectRootTab = (tab: RiderRootTab) => dispatchFlow({ type: "selectTab", tab });
  const onOpenHistory = () => selectRootTab("rides");
  const onOpenAccount = () => selectRootTab("account");
  const tabLabels = {
    home: t("rider.tabs.home"),
    rides: t("rider.tabs.rides"),
    support: t("rider.tabs.support"),
    account: t("rider.tabs.account"),
  } satisfies Record<(typeof ROOT_TABS.rider)[number], string>;
  const rootTabs = (
    <RootTabBar
      surface="rider"
      label={t("rider.tabs.navigation")}
      labels={tabLabels}
      active={stack.tab}
      onSelect={selectRootTab}
    />
  );

  // العنوانُ الأصليُّ باقٍ في فرعِ ما بعدَ الترحيبِ ولم يُحذَف؛ ولا يُرسَمُ فوقَ
  // شاشةِ الترحيبِ لأنَّ لها عنوانَها، وعنوانانِ بالنصِّ ذاتِه يُقرآنِ تكراراً في
  // قارئِ الشاشةِ (`UX-10`).
  if (!proceeded) {
    const welcomeProps = {
      initialLanguage: language,
      onProceed: () => setProceeded(true),
      ...(onLanguageChanged
        ? { saveLanguagePreference: async (lang: MiniAppLanguage) => onLanguageChanged(lang) }
        : {}),
    };
    return <WelcomeScreen {...welcomeProps} />;
  }

  // شاشةُ الاستغاثةِ (`PD-020`) — **أعلى الترتيبِ كلِّهِ وفوقَ الدعمِ**: مَن فتحَها
  // صراحةً لا تُغطَّى بشاشةٍ أخرى، والرجوعُ يُطفِئُ الرايةَ فيظهرُ ما تحتها كما كانَ.
  // R9 · SOS: تدفّقٌ برجوعٍ واحدٍ من رأسِ الإطار، والبطاقةُ بلا عنوانٍ مكرّر.
  if (sosOpen) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.sos.title")}
        back={{ label: t("rider.sos.back"), onBack: () => setSosOpen(false) }}
      >
        <SosScreen language={language} showTitle={false} />
      </ScreenFrame>
    );
  }

  // UI-3 / PR 5 (ADR 0238) — الترتيبُ الجديدُ وسببُه: كانَ «الحسابُ» يُفحَصُ قبلَ «الخصوصيّة» و«الدعمُ» قبلَ
  // «الأسئلة الشائعة»، فما فُتِحَ منهما لا يُرسَمُ أبداً (عيبٌ لا ترتيبٌ). صارَ الحسابُ والدعمُ العامُّ تبويبَين،
  // وما يُفتَحُ منهما تدفّقٌ **فوقَهما**: الأسئلةُ ثمَّ الخصوصيّةُ ثمَّ الشكوى المربوطةُ ثمَّ المفقوداتُ ثمَّ
  // تفاصيلُ رحلةٍ ثمَّ الإشعارات. كلُّها `ScreenFrame mode="flow"` برجوعٍ واحدٍ من رأسِ الإطار، والشاشةُ بلا
  // عنوانٍ ولا رجوعٍ مكرَّر (`showTitle={false}` · بلا `onBack`).
  const flowBack = t("rider.frame.back");

  // الأسئلةُ الشائعة (DEC-36) — تُفتَحُ من الدعمِ (تبويباً أو تدفّقاً) فهيَ فوقَه.
  if (faq) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.faq")}
        back={{ label: flowBack, onBack: () => setFaq(false) }}
      >
        <Deferred>
          <FaqScreen language={language} showTitle={false} />
        </Deferred>
      </ScreenFrame>
    );
  }

  // R14 · الخصوصيّةُ والشروط (DEC-35) — تُفتَحُ من «حسابي» فهيَ فوقَه.
  if (privacy) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.privacy.title")}
        back={{ label: flowBack, onBack: () => setPrivacy(false) }}
      >
        <Deferred>
          <PrivacyScreen language={language} showTitle={false} />
        </Deferred>
      </ScreenFrame>
    );
  }

  // R13 · الأماكنُ المحفوظةُ وجهةُ اتصالِ الطوارئ — تُفتحانِ من «حسابي» فهما فوقَه، والرجوعُ يُعيدُه كما كانَ.
  if (savedPlacesOpen) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.savedPlaces")}
        back={{ label: flowBack, onBack: () => setSavedPlacesOpen(false) }}
      >
        <Deferred>
          <SavedPlacesPanel language={language} />
        </Deferred>
      </ScreenFrame>
    );
  }

  if (emergencyOpen) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.emergency")}
        back={{ label: flowBack, onBack: () => setEmergencyOpen(false) }}
      >
        <Deferred>
          <EmergencyContactPanel language={language} />
        </Deferred>
      </ScreenFrame>
    );
  }

  // R15 · شكوى مربوطةٌ برحلةٍ (`SR-11`) — فيها نموذجٌ نصفُه مكتوبٌ، فهيَ فوقَ التفاصيلِ والملخَّص، والرجوعُ
  // يُطفِئُ رايتَها وحدَها فيظهرُ ما جاءَ منه كما كانَ.
  if (support !== null) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.supportRide")}
        back={{ label: flowBack, onBack: () => setSupport(null) }}
      >
        <Deferred>
          <SupportScreen
            orderId={support.orderId}
            language={language}
            showTitle={false}
            onOpenSos={onOpenSos}
            onOpenFaq={() => setFaq(true)}
          />
        </Deferred>
      </ScreenFrame>
    );
  }

  // R15 · المفقوداتُ (DEC-34) — شاشةُ الدعمِ بصنفِ `lost_item` مبدئيّاً.
  if (lostFound) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.lostFound")}
        back={{ label: flowBack, onBack: () => setLostFound(false) }}
      >
        <Deferred>
          <SupportScreen
            initialCategory={"lost_item"}
            language={language}
            showTitle={false}
            onOpenSos={onOpenSos}
          />
        </Deferred>
      </ScreenFrame>
    );
  }

  // R11 · تفاصيلُ رحلةٍ من «رحلاتي» (`SR-10`) — والرجوعُ **إلى السجلِّ** (التبويبُ باقٍ «رحلاتي») لا إلى
  // الرئيسة: الراكبُ جاءَ من قائمةٍ لها موضعٌ.
  if (inspected !== null) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.rideDetail")}
        back={{ label: flowBack, onBack: () => setInspected(null) }}
      >
        <Deferred>
          <RideDetailScreen
            orderId={inspected.orderId}
            timeZone={inspected.timeZone}
            initialLanguage={language}
            showTitle={false}
            onOpenSos={onOpenSos}
            // الشكوى تُفتَحُ **والرحلةُ محمولةٌ**، ولا يُطفأُ `inspected`: الراكبُ
            // يرجعُ من الشكوى إلى الرحلةِ التي كانَ يقرؤها لا إلى قائمةٍ.
            onReportProblem={() => setSupport({ orderId: inspected.orderId })}
          />
        </Deferred>
      </ScreenFrame>
    );
  }

  // R12 · مركزُ الإشعاراتِ (`SS-07`) وتفضيلاتُها ([B]) — يُفتَحُ من الرئيسةِ ومن «حسابي».
  if (notificationsOpen) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.notifications")}
        back={{ label: flowBack, onBack: () => setNotificationsOpen(false) }}
      >
        <Deferred>
          <NotificationsScreen initialLanguage={language} showTitle={false} onOpenSos={onOpenSos} />
        </Deferred>
      </ScreenFrame>
    );
  }

  // رحلةٌ انتهت يُقرأُ ملخَّصُها ويُقيَّمُ سائقُها (`SR-07` · `SR-08`). والرجوعُ
  // منها إلى الرئيسةِ: الرحلةُ مضَت فلا حالةَ يُعادُ إليها.
  // R10 · ملخّصُ الرحلةِ والتقييم: تدفّقٌ برجوعِ رأسِ الإطار (لا زرَّ رجوعٍ ثانٍ في الشاشة).
  if (summarized !== null) {
    const leaveSummary = () => {
      setSummarized(null);
      setFollowed(null);
      setIntent(null);
      clearFlow();
    };
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.summary")}
        back={{ label: t("rider.frame.back"), onBack: leaveSummary }}
      >
        <Deferred>
          <RideSummaryScreen
            orderId={summarized}
            initialLanguage={language}
            showTitle={false}
            showBack={false}
            onOpenSos={onOpenSos}
            // الشكوى تُفتَحُ **والرحلةُ محمولةٌ**، ولا يُطفأُ `summarized`: الدعمُ أعلى
            // الترتيبِ، والرجوعُ منه يُظهِرُ الملخَّصَ الذي كانَ الراكبُ يقرؤه (`SR-08`).
            onReportProblem={() => setSupport({ orderId: summarized })}
            onBack={leaveSummary}
          />
        </Deferred>
      </ScreenFrame>
    );
  }

  // رحلةٌ قائمةٌ تُتابَعُ: لقطتُها وسائقُها وموقعُه بعُمرِه (`SR-06`). والرجوعُ
  // منها إلى الرئيسةِ لا إلى بحثٍ مضى: البحثُ انتهى بإسنادٍ.
  // R7 · الرحلةُ النشطة (وفيها R8 مشاركةُ الرحلةِ وبطاقةُ SOS): تدفّقٌ برجوعِ رأسِ الإطار.
  // R6 · مشاركةُ الرحلةِ — شاشةٌ فوقَ الرحلةِ النشطةِ، والرجوعُ يُعيدُ الرحلةَ نفسَها لا الرئيسة.
  if (followed !== null && shareOpen) {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.share")}
        back={{ label: flowBack, onBack: () => setShareOpen(false) }}
      >
        <Deferred>
          <RideShareCard orderId={followed} language={language} standalone />
        </Deferred>
      </ScreenFrame>
    );
  }

  if (followed !== null) {
    const leaveActive = () => {
      setShareOpen(false);
      setFollowed(null);
      setIntent(null);
      clearFlow();
    };
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.ride.activeTitle")}
        back={{ label: t("rider.frame.back"), onBack: leaveActive }}
      >
        <Deferred>
          <ActiveRideScreen
            orderId={followed}
            initialLanguage={language}
            showTitle={false}
            onFinished={(orderId) => {
              setShareOpen(false);
              setSummarized(orderId);
            }}
            onBack={leaveActive}
            onOpenShare={() => setShareOpen(true)}
            onOpenHelp={onOpenSos}
            liveTripEvents
          />
        </Deferred>
      </ScreenFrame>
    );
  }

  // النيّةُ تُنفَّذُ: شاشةُ البحثِ تُنشئُ الرحلةَ وتعرضُ حالتَها. وهيَ **فوقَ**
  // الاقتباسِ في الترتيبِ: ما دامَت رحلةٌ تُطلَبُ فلا يُعادُ رسمُ اقتباسٍ مضى.
  // R6 · البحثُ عن سائق: تدفّقٌ برجوعِ رأسِ الإطار.
  if (intent !== null) {
    const leaveSearch = () => {
      setIntent(null);
      clearFlow();
    };
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.search")}
        back={{ label: t("rider.frame.back"), onBack: leaveSearch }}
      >
        <Deferred>
          <SearchScreen
            intent={intent}
            initialLanguage={language}
            showTitle={false}
            onOpenSos={onOpenSos}
            onActiveRide={(orderId) => setFollowed(orderId)}
            onBack={leaveSearch}
          />
        </Deferred>
      </ScreenFrame>
    );
  }

  // الوجهةُ المُصادَقةُ تُقتبَسُ: أوّلُ شاشةٍ بعدَ الحكمِ، ولا تُركَّبُ إلّا بعدَه.
  const view = riderFlowView(flow);
  if (view.screen === "quote") {
    const { confirmed, service, pickup } = view;
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.quote")}
        back={{ label: t("rider.frame.back"), onBack: flowHandlers.onBack }}
      >
        <ScreenTransition screenKey={stackKey} motion={stack.motion}>
          <Deferred>
            <QuoteScreen
              destination={{
                label: confirmed.label,
                lat: confirmed.lat,
                lng: confirmed.lng,
                ...(confirmed.place === undefined ? {} : { place: confirmed.place }),
              }}
              initialLanguage={language}
              showTitle={false}
              onOpenSos={onOpenSos}
              onRequest={flowHandlers.onRequest}
              {...(service === null ? {} : { service })}
              {...(pickup === null ? {} : { initialPickup: pickup })}
            />
          </Deferred>
        </ScreenTransition>
      </ScreenFrame>
    );
  }

  // الوجهةُ المختارةُ تُصادَقُ قبلَ أيِّ خطوةٍ تاليةٍ: لا شاشةَ بعدَها تقبلُ
  // إحداثيّةً لم تحكمْ عليها القاعدةُ (القاعدة 0.5).
  // `WR-16C`: التوصيلُ بعدَ تأكيدِ الاستلامِ يسألُ «إلى أين نوصله؟» بالشاشةِ نفسِها.
  if (view.screen === "dropoff") {
    return (
      <ScreenFrame
        mode="flow"
        title={t("rider.frame.deliveryDropoff")}
        back={{ label: t("rider.frame.back"), onBack: flowHandlers.onBack }}
      >
        <ScreenTransition screenKey={stackKey} motion={stack.motion}>
          <Deferred>
            <DestinationScreen
              purpose="deliveryDropoff"
              initialLanguage={language}
              showTitle={false}
              onOpenSos={onOpenSos}
              onConfirmed={flowHandlers.onConfirmed}
            />
          </Deferred>
        </ScreenTransition>
      </ScreenFrame>
    );
  }

  if (view.screen === "destination") {
    const { chosen } = view;
    const deliveryFirst = chosen.service === "delivery";
    return (
      <ScreenFrame
        mode="flow"
        title={t(deliveryFirst ? "rider.frame.deliveryPickup" : "rider.frame.destination")}
        back={{ label: t("rider.frame.back"), onBack: flowHandlers.onBack }}
      >
        <ScreenTransition screenKey={stackKey} motion={stack.motion}>
          <Deferred>
            <DestinationScreen
              purpose={deliveryFirst ? "deliveryPickup" : "destination"}
              initialQuery={chosen.lat === null || chosen.lng === null ? chosen.label : ""}
              {...(chosen.lat === null || chosen.lng === null
                ? {}
                : { initialPoint: { label: chosen.label, lat: chosen.lat, lng: chosen.lng } })}
              initialLanguage={language}
              showTitle={false}
              onOpenSos={onOpenSos}
              onConfirmed={flowHandlers.onConfirmed}
            />
          </Deferred>
        </ScreenTransition>
      </ScreenFrame>
    );
  }

  // ما كانَ ههنا قبلَ `F2-02`: حالةُ فراغٍ من `EmptyState` تقولُ «لا شيءَ يُعرَضُ
  // بعد» — وهيَ صدقُ تلكَ اللحظةِ، وقد نُسِخَ حكمُها إلى شاشةِ `SR-02` نفسِها:
  // «الأماكنُ فارغةٌ» و«لا وجهاتَ» و«لا خريطةَ» تُقالُ مفاتيحَ لا بياضاً.
  //
  // UI-3 / PR 5 (ADR 0238): الجذورُ الأربعةُ في إطارٍ واحدٍ بشريطِ التبويبات — R11 «رحلاتي» · R15 «الدعم» ·
  // R13 «حسابي» — والعنوانُ للإطارِ وحدَه (`showTitle={false}`)، ولا رجوعَ في جذر.
  const rootBody = (): ReactNode => {
    switch (stack.tab) {
      case "rides":
        return (
          <Deferred>
            <RideHistoryScreen
              initialLanguage={language}
              showTitle={false}
              onOpenDetail={(orderId, timeZone) => setInspected({ orderId, timeZone })}
              onOpenActive={(orderId) => setFollowed(orderId)}
              onOpenSos={onOpenSos}
            />
          </Deferred>
        );
      case "support":
        return (
          <Deferred>
            <SupportScreen
              orderId={null}
              language={language}
              showTitle={false}
              onOpenSos={onOpenSos}
              onOpenFaq={() => setFaq(true)}
            />
          </Deferred>
        );
      case "account":
        return (
          <Deferred>
            <AccountScreen
              language={language}
              showTitle={false}
              {...(onLanguageChanged ? { onLanguageChanged } : {})}
              onOpenSupport={() => selectRootTab("support")}
              onOpenPrivacy={() => setPrivacy(true)}
              onOpenNotifications={() => setNotificationsOpen(true)}
              onOpenSavedPlaces={() => setSavedPlacesOpen(true)}
              onOpenEmergencyContact={() => setEmergencyOpen(true)}
              onOpenSos={onOpenSos}
            />
          </Deferred>
        );
      case "home":
        return (
          <HomeScreen
            initialLanguage={language}
            showTitle={false}
            onDestinationChosen={flowHandlers.onDestinationChosen}
            onOpenHistory={onOpenHistory}
            onOpenLostFound={() => setLostFound(true)}
            onOpenNotifications={() => setNotificationsOpen(true)}
            onOpenAccount={onOpenAccount}
            onOpenSos={onOpenSos}
            onContinueRide={(orderId) => setFollowed(orderId)}
          />
        );
    }
  };
  return (
    <ScreenFrame mode="root" title={t(RIDER_ROOT_TITLE_KEY[stack.tab])} tabs={rootTabs}>
      <ScreenTransition screenKey={stackKey} motion={stack.motion}>
        {rootBody()}
      </ScreenTransition>
    </ScreenFrame>
  );
}
