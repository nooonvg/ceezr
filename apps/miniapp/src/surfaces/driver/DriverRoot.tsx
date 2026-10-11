/**
 * الغرض: السطحُ الجذريُّ للسائق — تُحمَّل حزمتُه **عندَ كونِ الدورِ سائقاً وحدَه**
 *   (القسم 9.4)، وذاك هو سببُ وجودِه ملفاً منفصلاً لا فرعاً في سطحٍ واحد.
 * الحالة: منفّذ فعلياً — البند `F1-05`، **وفيه اليومَ شاشةُ وثائقٍ** (`F3-01`)
 *   **ولوحُ عروضٍ وتفاصيلُ عرضٍ** (`F3-02`) **ومَهمّةٌ نشطةٌ** (`F3-03`).
 * ينتمي إلى: apps/miniapp/src/surfaces/driver (حزمة `driver` — القسم 9.4)
 * يُستخدم من: `routing/RoleRouter.tsx` (تحميلٌ متأخّرٌ بالدورِ)
 * يُتوقع أن يستخدمه لاحقاً: بقيّةُ شاشاتِ `F3` تُركَّب داخلَ هذا السطح.
 * ملاحظات مستقبلية: مبدّلُ التوافرِ (القسم 9.3) ليس ههنا: التوافرُ حالةُ أعمالٍ
 *   تُكتَب على الخادمِ، وكتابتُها من التطبيقِ المصغَّرِ بندٌ لاحقٌ لا `F1-05`.
 *
 * ## لِمَ الوثائقُ هيَ **أوّلُ** ما يراهُ السائقُ ولا تُخبَّأُ خلفَ قائمةٍ
 *
 * لأنَّ سائقاً غيرَ مُوَثَّقٍ **لا يصلُه عرضٌ إطلاقاً** (`F12-14`): فأيُّ شاشةٍ
 * أخرى نُصدِّرُها إليه أوّلاً تُريهِ منتَجاً معطوباً — قائمةً فارغةً بلا سببٍ.
 * وحينَ تكتملُ وثائقُه وتُقبَلُ، تصيرُ هذه الشاشةُ سطراً هادئاً لا لوحاً.
 *
 * ## وما لا يفعلُه هذا السطحُ عن قصدٍ (`ح-5`)
 *
 *   ــ **لا يُوجِّهُ بمسارٍ**: لا مُوجِّهَ في التطبيقِ المصغَّرِ اليومَ، والانتقالُ
 *      حالةٌ محليّةٌ. ومُوجِّهُ عناوينٍ **دَينٌ مُعلَنٌ** لا يُحتاجُ بشاشتَينِ.
 *   ــ **لا يعرضُ اشتراكاً**: بندُ `SD-07`.
 *
 * ## وقد صارَت شاشةُ الحسابِ ههنا بـ`SD-12` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * كانَ رأسُ هذا المِلفِّ يقولُ نصّاً: «لا يعرضُ شاشةَ حسابٍ: بندُ `SD-12`، وهوَ
 * **الموضعُ الطبيعيُّ لمدخلِ الدعمِ لاحقاً**؛ ومدخلُ اللوحِ اليومَ ليسَ بديلاً
 * عنه بل أقربُ منه إلى موضعِ الضررِ». **وذاكَ النصُّ يبقى مقروءاً ههنا لا
 * يُمحى**، وقد أُنجِزَ البندُ: الشاشةُ عضوٌ في الاتّحادِ، ومدخلُها من اللوحِ.
 *
 * **ومدخلُ الدعمِ في اللوحِ لم يُنقَلْ ولم يُنقَصْ**: الحكمُ الذي وضعَه هناكَ —
 * أنَّ بابَ الشكوى يُوضَعُ حيثُ وقعَ الضررُ — لم يُنقَضْ ببناءِ شاشةِ حسابٍ.
 * فزِيدَ مدخلٌ **ثانٍ** للدعمِ من شاشةِ الحسابِ كما أعلنَ هذا الرأسُ أنَّه
 * الموضعُ الطبيعيُّ، وبقيَ الأوّلُ. ورجوعُ شاشةِ الحسابِ إلى اللوحِ لا إلى
 * الوثائقِ: اللوحُ مدخلُ السائقِ العامِلِ.
 *
 * **وحقٌّ مبنيٌّ بلا بابٍ حقٌّ غيرُ ممنوحٍ عملاً** (القسم 9.12): `erase_my_account`
 * تحكمُ للسائقِ منذُ `SD-12` الأوّلِ وحزمةُ تنزيلِه إحدى وثلاثونَ قسماً، ولم
 * يكنْ في التطبيقِ زرٌّ يبلغُهما.
 *
 * ## وقد صارَت الحصيلةُ ههنا بـ`F3-05` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * وهيَ **مدخلٌ من اللوحِ** لا شاشةُ بدايةٍ: السائقُ يفتحُ التطبيقَ ليعملَ لا
 * ليُراجِعَ ماضيَه، وتقريرٌ يُفتَحُ أوّلاً يُزاحِمُ عرضاً يُنتظَرُ. و**لا باثَّ
 * موقعٍ معَها** خلافاً للوحِ والمَهمّةِ: قراءةُ تقريرٍ ليست عملاً يُبَثُّ فيهِ
 * موضعٌ، وبثٌّ من شاشةِ أرشيفٍ يُنفِقُ بطاريّةً بلا سببٍ.
 *
 * ## وقد صارَ بثُّ الموقعِ ههنا بـ`F3-04` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * الباثُّ يُركَّبُ في شاشتَي اللوحِ والمَهمّةِ **لأنَّ حالَ البثِّ حالُ السائقِ لا
 * حالُ شاشةٍ**: متاحٌ في اللوحِ يبثُّ، وفي رحلةٍ عادَ إلى اللوحِ يبثُّ. وشاشةُ
 * الوثائقِ وشاشةُ العرضِ خارجَه عن قصدٍ: أُولاهُما ورقٌ يُقرأُ مرّةً، والثانيةُ
 * قرارٌ في ثوانٍ لا يُزاحَمُ نصُّه بإعلامٍ ثانٍ.
 *
 * ## وقد صارَت الرحلةُ النشطةُ ههنا بـ`F3-03` — **زيادةً لا نقصاً** (`ح-8`)
 *
 * القبولُ كانَ يعودُ باللوحِ لأنَّ شاشةَ المَهمّةِ لم تكن موجودةً؛ وقد وُجِدَت،
 * فصارَ القبولُ يفتحُها بمُعرِّفِ الطلبِ الذي أعادَه. وطريقُ اللوحِ باقٍ كما هوَ،
 * ومدخلُ «مَهمّتي» فيهِ لسائقٍ عادَ إلى التطبيقِ وهوَ في رحلةٍ.
 *
 * ## ولِمَ صارَ اللوحُ هوَ المدخلَ بعدَ `F3-02` والوثائقُ زرّاً
 *
 * لأنَّ السائقَ يفتحُ التطبيقَ **ليعملَ** لا ليُدارَ ورقُه: ولوحُ العروضِ يقولُ
 * لهُ في سطرٍ واحدٍ لِمَ لا عملَ الآنَ — محجوبٌ بوثيقةٍ أو غيرُ متوفِّرٍ أو لا
 * طلبَ قريباً — وكلُّ سببٍ منها له طريقُه من اللوحِ نفسِه. وشاشةُ الوثائقِ باقيةٌ
 * كما هيَ **بلا تغييرٍ في سلوكِها** (`ح-8`): زُيدَ مدخلٌ ولم يُنقَصْ مدخلٌ.
 *
 * ## وانتقالُ الشاشاتِ **حالةٌ محليّةٌ بمُعرِّفِ عرضٍ** لا مُوجِّهُ عناوينٍ
 *
 * ثلاثُ شاشاتٍ لا تحتاجُ مُوجِّهاً، ومُعرِّفُ العرضِ يُحمَلُ في الحالةِ لأنَّ
 * التفاصيلَ **لا تُقرأُ إلّا بمُعرِّفٍ**: شاشةٌ تُفتَحُ بلا مُعرِّفٍ ثمَّ تسألُ
 * الخادمَ «أيُّ عرضٍ؟» بابُ عطلٍ، فجُعِلَ المُعرِّفُ شرطَ فتحٍ في النوعِ نفسِه.
 *
 * ## UI-4 (ADR 0236): الهيكلُ والتبويبُ والمكدّسُ — D0–D14
 *
 * صارَ السطحُ داخلَ هيكلِ UI-2 بلا موجِّهٍ ثانٍ: أربعةُ تبويباتٍ جذريّةٍ (§6: العروض ·
 * مهمّتي · أرباحي · حسابي) في `ScreenFrame mode="root"` معَ `RootTabBar`، وكلُّ ما سواها
 * تدفّقٌ في `ScreenFrame mode="flow"` برجوعٍ (`BackButton`) وانتقالٍ (`ScreenTransition`).
 * والقرارُ كلُّه في `driver-flow.ts` النقيّ (`useReducer`)، والمعالجاتُ نفسُها تُربَطُ ههنا.
 * وزالَت «الشاشةُ الفارغةُ عن قصدٍ» ذاتُ النصِّ المُضمَّن: كانَت المدخلَ الوحيدَ إلى «مركبتي»
 * ومدخلاً ثانياً إلى الوثائق؛ فصارَ المدخلانِ في «حسابي» بمفاتيحِ القاموس (`ح-8`: زيادةٌ لا نقص).
 */

// `D-33` · `ADR 0188`: نصوصُ جزءِ `driver` تُسجَّلُ معَ حزمتِه لا في `shell`.
import "../../../../../packages/shared/i18n/miniapp/ar-parts/driver.ts";
import { type ReactNode, useEffect, useMemo, useReducer, useState } from "react";
import { miniAppTranslator } from "../../../../../packages/shared/i18n/miniapp/core.ts";
import type { LanguageSurfaceProps } from "../../routing/RoleRouter.tsx";
import { capturePhotoWithInput } from "../../services/capture-photo.ts";
import { subscribeOffersChannel } from "../../services/offers-channel-client.ts";
import {
  productionOffersBaseUrl,
  productionOffersSessionReader,
  productionOffersTransport,
} from "../../services/production-offers-channel.ts";
import type { ROOT_TABS } from "../../shell/root-tabs.ts";
import { RootTabBar, ScreenFrame, ScreenTransition } from "../../shell/ScreenFrame.tsx";
import { currentScreenKey } from "../../shell/screen-stack.ts";
import { AccountScreen } from "./account/AccountScreen.tsx";
import { ActivityScreen } from "./activity/ActivityScreen.tsx";
import { DeductionTraceScreen } from "./deductions/DeductionTraceScreen.tsx";
import { DocumentsScreen } from "./documents/DocumentsScreen.tsx";
import {
  broadcastsLocation,
  DRIVER_TITLE_KEY,
  type DriverFlowScreen,
  type DriverRootTab,
  driverFlowHandlers,
  driverFlowReducer,
  driverFlowView,
  initialDriverFlow,
} from "./driver-flow.ts";
import { driverEntryView } from "./entry-view.ts";
import { JobScreen } from "./job/JobScreen.tsx";
import { readDriverActiveJob } from "./job/job-api.ts";
import { LocationBroadcast } from "./location/LocationBroadcast.tsx";
import { OfferDetailScreen } from "./offers/OfferDetailScreen.tsx";
import { OffersScreen } from "./offers/OffersScreen.tsx";
import { SubscriptionScreen } from "./subscription/SubscriptionScreen.tsx";
import { DriverRideSummaryScreen } from "./summary/DriverRideSummaryScreen.tsx";
import { DriverSupportScreen } from "./support/SupportScreen.tsx";
import { VehicleScreen } from "./vehicle/VehicleScreen.tsx";

const subscribeToOfferUpdates = (onUpdate: () => void) =>
  subscribeOffersChannel(
    {
      transport: productionOffersTransport,
      sessions: productionOffersSessionReader,
      baseUrl: productionOffersBaseUrl(),
    },
    { onUpdate },
  ).disconnect;

export default function DriverRoot({ language, onLanguageChanged, entry }: LanguageSurfaceProps) {
  // D0 · `ADR 0213`: هدفُ الهبوطِ يحدّدُ الحالَ الأولى وحدَها، وما بعدَها ملاحةُ السائق.
  const [entryView] = useState(() => driverEntryView(entry));
  const [flow, dispatch] = useReducer(driverFlowReducer, entryView, initialDriverFlow);
  const go = useMemo(() => driverFlowHandlers(dispatch), []);
  const t = miniAppTranslator(language);
  const view = driverFlowView(flow);
  const screenKey = currentScreenKey(flow);

  // `WR-20` (§20): الدخولُ الافتراضيُّ (بلا هدفٍ في الرابط) يسألُ الخادمَ عن مَهمّةٍ نشطة،
  // فإن وُجدَت فُتحَت «مهمّتي» بدلَ العروض. المصدرُ هوَ الخادمُ لا ذاكرةُ الجهاز، والقرارُ
  // في `driverFlowReducer` لا يقطعُ شاشةً فتحَها السائقُ قبلَ الردّ. وإخفاقُ القراءةِ يُبقي
  // العروضَ كما كانت، وتبويبُ «مهمّتي» يقرأُ المَهمّةَ بنفسِه عندَ فتحِه.
  useEffect(() => {
    if (entryView.kind !== "offers") return;
    let cancelled = false;
    readDriverActiveJob()
      .then((response) => {
        if (!cancelled && response.job !== null) go.activeJobFound();
      })
      .catch(() => {
        /* العروضُ باقيةٌ، و«مهمّتي» تقرأُ بنفسِها */
      });
    return () => {
      cancelled = true;
    };
  }, [entryView, go]);

  const tabLabels = {
    offers: t("driver.tabs.offers"),
    job: t("driver.tabs.job"),
    earnings: t("driver.tabs.earnings"),
    account: t("driver.tabs.account"),
  } satisfies Record<(typeof ROOT_TABS.driver)[number], string>;

  if (view.screen === "flow") {
    return (
      <ScreenFrame
        mode="flow"
        title={t(DRIVER_TITLE_KEY[view.flow.kind])}
        back={{ label: t("driver.nav.back"), onBack: go.back }}
      >
        <ScreenTransition screenKey={screenKey} motion={flow.motion}>
          {renderFlow(view.flow)}
        </ScreenTransition>
      </ScreenFrame>
    );
  }

  return (
    <>
      {/* D0 · `F3-04`: الهيكلُ وبثُّ الموقعِ في جذرَي العروضِ والمَهمّةِ — حالُ السائقِ لا حالُ شاشة. */}
      {broadcastsLocation(view) ? <LocationBroadcast language={language} /> : null}
      <ScreenFrame
        mode="root"
        title={t(DRIVER_TITLE_KEY[view.tab])}
        tabs={
          <RootTabBar
            surface="driver"
            label={t("driver.tabs.navigation")}
            labels={tabLabels}
            active={flow.tab}
            onSelect={go.selectTab}
          />
        }
      >
        <ScreenTransition screenKey={screenKey} motion={flow.motion}>
          {renderRoot(view.tab)}
        </ScreenTransition>
      </ScreenFrame>
    </>
  );

  function renderRoot(tab: DriverRootTab): ReactNode {
    switch (tab) {
      case "offers":
        // D1–D2: لوحُ العروضِ وبطاقاتُه بمؤقّتِ CSS. «مهمّتي» و«أرباحي» و«حسابي» تبويباتٌ فلا تُكرَّرُ أزراراً ههنا.
        return (
          <OffersScreen
            language={language}
            showTitle={false}
            onOpenOffer={go.openOffer}
            onOpenDocuments={go.openDocuments}
            onOpenSubscription={go.openSubscription}
            onOpenSupport={go.openSupport}
            subscribeToOfferUpdates={subscribeToOfferUpdates}
          />
        );
      case "job":
        // D4: المَهمّةُ الحاليّة، وفيها تعذّرُ الإكمالِ (D5) والاستغاثةُ (D7 · SOS)؛ اكتمالُها يفتحُ D6.
        return <JobScreen language={language} showTitle={false} onCompleted={go.jobCompleted} />;
      case "earnings":
        // D10: الحصيلةُ والنشاط — عددٌ وساعاتٌ ومقامات، ولا مبلغَ مُختلَق.
        return <ActivityScreen language={language} showTitle={false} />;
      case "account":
        // D12: الحسابُ وحذفُه (`AccountRights`) ومداخلُ ملفِّ العمل.
        return (
          <AccountScreen
            language={language}
            showTitle={false}
            {...(onLanguageChanged ? { onLanguageChanged } : {})}
            onOpenSupport={go.openSupport}
            onOpenDocuments={() => go.openDocuments()}
            onOpenVehicle={go.openVehicle}
            onOpenSubscription={go.openSubscription}
          />
        );
    }
  }

  function renderFlow(screen: DriverFlowScreen): ReactNode {
    switch (screen.kind) {
      case "offer":
        // D3: تفاصيلُ العرضِ ومؤقّتُه وقرارُه. القبولُ إلى «مهمّتي»، والرفضُ رجوعٌ إلى اللوح.
        return (
          <OfferDetailScreen
            offerId={screen.offerId}
            language={language}
            showTitle={false}
            onAccepted={go.offerAccepted}
            onRejected={go.offerRejected}
          />
        );
      case "summary":
        // D6: ملخّصُ رحلةِ السائقِ وتقييمُ الراكب.
        return (
          <DriverRideSummaryScreen
            orderId={screen.orderId}
            initialLanguage={language}
            showTitle={false}
          />
        );
      case "documents":
        // D8: الوثائقُ وخطواتُ رفعِها الحقيقيّة.
        return (
          <DocumentsScreen
            language={language}
            showTitle={false}
            capturePhoto={capturePhotoWithInput}
            focusDocType={screen.focusDocType}
          />
        );
      case "vehicle":
        // D9: المركبة.
        return <VehicleScreen language={language} showTitle={false} />;
      case "subscription":
        // D11: الاشتراكُ والفاتورة.
        return <SubscriptionScreen language={language} showTitle={false} />;
      case "support":
        // D13: دعمُ السائق، ومنه كشفُ الخصوم.
        // **لا `orderId` من اللوحِ أو الحساب**: شكوى «راكبٌ مسيءٌ» تُفتَحُ من رحلةٍ بعينِها.
        return (
          <DriverSupportScreen
            language={language}
            showTitle={false}
            onOpenDeductionTrace={go.openDeductionTrace}
          />
        );
      case "deductionTrace":
        // D13: كشفُ الخصومِ (من الدعمِ وحدَه).
        return <DeductionTraceScreen language={language} showTitle={false} />;
    }
  }
}
