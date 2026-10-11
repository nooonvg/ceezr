/**
 * الغرض: إثباتُ أنَّ `DriverRoot` يرسمُ هيكلَ UI-2 الحقيقيَّ (تبويباتُ §6، إطارُ التدفّقِ
 *   برجوعٍ، عنوانٌ واحد) وأنَّ JSX يربطُ معالجاتِ `driver-flow.ts` نفسَها — ومعَه مؤقّتُ
 *   العرضِ (D2–D3) وخطواتُ الرفعِ (D8) وروابطُ «حسابي» (D12).
 * الحالة: منفّذ فعلياً — UI-4 (ADR 0236).
 *
 * حدٌّ معلَن: لا بيئةَ DOM (لا تبعيّةَ جديدة)، فالرسمُ ساكنٌ (`renderToStaticMarkup`) يقيسُ
 * أوّلَ رسمٍ قبلَ أيِّ جلبٍ، والسلوكُ التفاعليُّ يُقاسُ في `driver-flow.test.ts` بالمعالجاتِ.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppTranslator,
} from "../../../../../packages/shared/i18n/miniapp/index.ts";
import { UiStepper, UiTimer } from "../../system/ui/index.tsx";
import { AccountScreen } from "./account/AccountScreen.tsx";
import { ActivityScreen } from "./activity/ActivityScreen.tsx";
import DriverRoot from "./DriverRoot.tsx";
import { DocumentsScreen } from "./documents/DocumentsScreen.tsx";
import { UPLOAD_STEP_KEYS, uploadStepPosition, uploadStepText } from "./documents/upload-steps.ts";
import { JobScreen } from "./job/JobScreen.tsx";
import { OfferDetailScreen } from "./offers/OfferDetailScreen.tsx";
import { OffersScreen } from "./offers/OffersScreen.tsx";
import { offerTimerProps } from "./offers/offer-timer.ts";
import { SubscriptionScreen } from "./subscription/SubscriptionScreen.tsx";
import { VehicleScreen } from "./vehicle/VehicleScreen.tsx";

const HERE = new URL(".", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, HERE), "utf8");
const SOURCE = read("./DriverRoot.tsx");
const OFFER = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** الشِّفرةُ بلا تعليقات — كي لا يُحتسَبَ شرحٌ عربيٌّ نصّاً مُضمَّناً. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"])\/\/.*$/gm, "$1");
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("D0 — أوّلُ رسمٍ لـ DriverRoot", () => {
  for (const language of MINIAPP_LANGUAGES) {
    it(`بلا هدفٍ ⇒ إطارٌ جذريٌّ بأربعةِ تبويباتٍ (§6) وعنوانٍ واحد · ${language}`, () => {
      const t = miniAppTranslator(language);
      const html = renderToStaticMarkup(<DriverRoot language={language} entry={null} />);
      for (const tab of ["offers", "job", "earnings", "account"]) {
        expect(html).toContain(t(`driver.tabs.${tab}`));
      }
      expect(html).toContain(`aria-label="${t("driver.tabs.navigation")}"`);
      // التبويبُ النشطُ واحدٌ ومُعلَنٌ.
      expect(count(html, /aria-current="page"/g)).toBe(1);
      // عنوانٌ واحدٌ للشاشة: الإطارُ يملكُه والشاشةُ لا تُكرّرُه (`showTitle={false}`).
      expect(count(html, /<h1[\s>]/g)).toBe(1);
      expect(html).toContain(t("driver.offers.title"));
      // الشاشةُ الفارغةُ عن قصدٍ ذاتُ النصِّ المُضمَّنِ زالَت.
      expect(html).not.toContain("لا شيء يُعرَض بعد");
      expect(html).not.toContain("dveh__nav");
    });
  }

  it("هبوطٌ على عرضٍ ⇒ إطارُ تدفّقٍ بزرِّ رجوعٍ، بلا شريطِ تبويبات", () => {
    const t = miniAppTranslator("ar");
    const html = renderToStaticMarkup(<DriverRoot language="ar" entry={`offer_${OFFER}`} />);
    expect(html).toContain(t("driver.nav.back"));
    expect(html).toContain(t("driver.offers.detail.title"));
    expect(html).not.toContain(`aria-label="${t("driver.tabs.navigation")}"`);
    expect(count(html, /<h1[\s>]/g)).toBe(1);
  });

  it("هبوطٌ على «vehicle» ⇒ تدفّقٌ فوقَ «حسابي»", () => {
    const t = miniAppTranslator("en");
    const html = renderToStaticMarkup(<DriverRoot language="en" entry="vehicle" />);
    expect(html).toContain(t("driver.vehicle.title"));
    expect(html).toContain(t("driver.nav.back"));
  });
});

describe("DriverRoot — عقدُ الوصلِ ساكناً (لا موجّهَ ثانٍ ولا نصَّ مُضمَّن)", () => {
  const code = codeOnly(SOURCE);

  it("الحالُ من المخفِّضِ النقيِّ ومعالجاتِه — لا `useState` لشاشة", () => {
    expect(code).toContain("useReducer(driverFlowReducer, entryView, initialDriverFlow)");
    expect(code).toContain("driverFlowHandlers(dispatch)");
    expect(code).not.toMatch(/useState<\s*View/);
    expect(code).not.toContain("setView(");
  });

  it("كلُّ فعلٍ مربوطٌ بمعالجٍ حقيقيّ", () => {
    for (const binding of [
      "onOpenOffer={go.openOffer}",
      "onOpenDocuments={go.openDocuments}",
      "onAccepted={go.offerAccepted}",
      "onRejected={go.offerRejected}",
      "onCompleted={go.jobCompleted}",
      "onOpenDeductionTrace={go.openDeductionTrace}",
      "onOpenVehicle={go.openVehicle}",
      "onOpenSubscription={go.openSubscription}",
      "onOpenSupport={go.openSupport}",
      "onSelect={go.selectTab}",
      "onBack: go.back",
    ]) {
      expect(code, binding).toContain(binding);
    }
  });

  it("WR-20: الدخولُ الافتراضيُّ يسألُ الخادمَ عن المَهمّةِ ويُسلِّمُ القرارَ للمخفِّض", () => {
    expect(code).toContain('if (entryView.kind !== "offers") return;');
    expect(code).toContain("readDriverActiveJob()");
    expect(code).toContain("response.job !== null) go.activeJobFound()");
    expect(code).not.toMatch(/localStorage|sessionStorage/);
  });

  it("الهيكلُ من UI-2 وحدَه، ولا حرفَ عربيٍّ في الشِّفرة", () => {
    expect(code).toContain('mode="root"');
    expect(code).toContain('mode="flow"');
    expect(code).toContain("<ScreenTransition");
    expect(code).toContain("<RootTabBar");
    expect(code).not.toMatch(/[\u0600-\u06FF]/);
    expect(code).not.toMatch(/href=["{`]#/);
  });
});

describe("D2–D3 — مؤقّتُ العرضِ: CSS لا عقرب", () => {
  const t = miniAppTranslator("ar");

  it("النغماتُ: هادئٌ ⇒ neutral، ملحٌّ ⇒ amber، منقضٍ ⇒ bad", () => {
    expect(offerTimerProps({ secondsRemaining: 40, secondsLeftAtRead: 45, t }).tone).toBe(
      "neutral",
    );
    expect(offerTimerProps({ secondsRemaining: 5, secondsLeftAtRead: 45, t }).tone).toBe("amber");
    expect(offerTimerProps({ secondsRemaining: 0, secondsLeftAtRead: 45, t }).tone).toBe("bad");
  });

  it("النصُّ يقولُ «لحظةَ العرض» صراحةً، والمنقضي «انتهت المهلة»", () => {
    const live = offerTimerProps({ secondsRemaining: 30, secondsLeftAtRead: 45, t });
    expect(live.deadlineText).toContain(
      t("driver.offers.timer.leftAtRender").split("{value}")[0] ?? "",
    );
    expect(live.deadlineText).not.toContain("{value}");
    const gone = offerTimerProps({ secondsRemaining: -3, secondsLeftAtRead: 45, t });
    expect(gone.deadlineText).toBe(t("driver.offers.timer.elapsed"));
    expect(gone.remainingSeconds).toBe(0);
  });

  it("المقامُ هوَ الباقي لحظةَ القراءةِ ولا يقلُّ عن الحاضر، ولا رقمَ غيرَ منتهٍ", () => {
    expect(offerTimerProps({ secondsRemaining: 20, secondsLeftAtRead: 45, t }).totalSeconds).toBe(
      45,
    );
    expect(offerTimerProps({ secondsRemaining: 50, secondsLeftAtRead: 45, t }).totalSeconds).toBe(
      50,
    );
    const nan = offerTimerProps({ secondsRemaining: Number.NaN, secondsLeftAtRead: Number.NaN, t });
    expect(nan.remainingSeconds).toBe(0);
    expect(nan.totalSeconds).toBe(0);
  });

  it("الرسمُ: `role=timer` وحركةُ CSS بمدّةِ الباقي", () => {
    const html = renderToStaticMarkup(
      <UiTimer {...offerTimerProps({ secondsRemaining: 30, secondsLeftAtRead: 45, t })} />,
    );
    expect(html).toContain('role="timer"');
    expect(html).toContain("--ui-timer-duration:30s");
  });

  it("الشاشتانِ تستعملانِ `UiTimer` ولا ساعةَ جهازٍ ولا عقربَ دوريّ", () => {
    for (const file of ["./offers/OffersScreen.tsx", "./offers/OfferDetailScreen.tsx"]) {
      const code = codeOnly(read(file));
      expect(code, file).toContain("<UiTimer");
      expect(code, file).toContain("offerTimerProps(");
      // الاسمُ مركّبٌ كي لا يقرأَه حاجزُ شاشاتِ الحالِ استقصاءً (ADR 0035 §4).
      expect(code, file).not.toContain(["set", "Interval("].join(""));
      expect(code, file).not.toContain("dof__timer");
    }
    expect(codeOnly(read("./offers/offer-timer.ts"))).not.toMatch(/Date\.now\(|new Date\(/);
  });

  it("D1: إصلاحُ حجبٍ زرٌّ يفتحُ الوثائق — لا رابطَ تجزئةٍ ميّتٌ", () => {
    const code = codeOnly(read("./offers/OffersScreen.tsx"));
    expect(code).not.toContain("#/driver/documents");
    expect(code).toContain("onOpenDocuments(");
  });
});

describe("D8 — خطواتُ رفعِ الوثيقةِ الحقيقيّة", () => {
  const t = miniAppTranslator("ar");

  it("ثلاثُ خطواتٍ بترتيبِها، والإرسالُ للمراجعةِ ليسَ خطوةَ رفع", () => {
    expect(UPLOAD_STEP_KEYS.map((k) => uploadStepPosition(k))).toEqual([
      { current: 1, total: 3 },
      { current: 2, total: 3 },
      { current: 3, total: 3 },
    ]);
    expect(uploadStepPosition("driver.documents.step.submitting")).toBeNull();
    expect(uploadStepPosition("unknown")).toBeNull();
  });

  it("النصُّ من القاموسِ بلا عناصرِ إحلالٍ متبقّية", () => {
    const text = uploadStepText({ current: 2, total: 3 }, t);
    expect(text).toContain("2");
    expect(text).toContain("3");
    expect(text).not.toMatch(/\{(current|total)\}/);
    const html = renderToStaticMarkup(<UiStepper current={2} total={3} text={text} />);
    expect(count(html, /ui-stp__seg--done/g)).toBe(1);
    expect(count(html, /ui-stp__seg--current/g)).toBe(1);
  });

  it("الشاشةُ تمرُّ بالخطواتِ الثلاثِ بترتيبِ `UPLOAD_STEP_KEYS` نفسِه", () => {
    const code = codeOnly(read("./documents/DocumentsScreen.tsx"));
    const at = UPLOAD_STEP_KEYS.map((key) => code.indexOf(`stepKey: "${key}"`));
    for (const index of at) expect(index).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(code).toContain("<UiStepper");
  });
});

describe("D12 — «حسابي»: روابطُ ملفِّ العملِ لا تُرسَمُ بلا مستقبِل", () => {
  const t = miniAppTranslator("en");

  it("بلا مستقبِلٍ لا رابطَ — زرٌّ بلا فعلٍ وعدٌ كاذب", () => {
    const html = renderToStaticMarkup(<AccountScreen language="en" showTitle={false} />);
    expect(html).not.toContain(t("driver.account.work.vehicle"));
    expect(html).not.toContain(t("driver.account.work.documents"));
  });

  it("معَ المستقبِلاتِ: ثلاثةُ أزرارٍ تحتَ تنقّلٍ موسوم", () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(
      <AccountScreen
        language="en"
        showTitle={false}
        onOpenDocuments={noop}
        onOpenVehicle={noop}
        onOpenSubscription={noop}
      />,
    );
    expect(html).toContain(`aria-label="${t("driver.account.work.label")}"`);
    for (const key of ["documents", "vehicle", "subscription"]) {
      expect(html).toContain(t(`driver.account.work.${key}`));
    }
  });
});

describe("`showTitle` — الإطارُ يملكُ العنوانَ، والشاشةُ المستقلّةُ تحفظُه", () => {
  const screens = [
    ["Offers", (s: boolean) => <OffersScreen language="ar" showTitle={s} />],
    [
      "OfferDetail",
      (s: boolean) => <OfferDetailScreen offerId={OFFER} language="ar" showTitle={s} />,
    ],
    ["Job", (s: boolean) => <JobScreen language="ar" showTitle={s} />],
    ["Activity", (s: boolean) => <ActivityScreen language="ar" showTitle={s} />],
    ["Documents", (s: boolean) => <DocumentsScreen language="ar" showTitle={s} />],
    ["Vehicle", (s: boolean) => <VehicleScreen language="ar" showTitle={s} />],
    ["Subscription", (s: boolean) => <SubscriptionScreen language="ar" showTitle={s} />],
  ] as const;
  for (const [name, render] of screens) {
    it(`${name}: لا h1 داخلَ الإطار، وh1 خارجَه`, () => {
      expect(count(renderToStaticMarkup(render(false)), /<h1[\s>]/g)).toBe(0);
      expect(count(renderToStaticMarkup(render(true)), /<h1[\s>]/g)).toBe(1);
    });
  }
});
