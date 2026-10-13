import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MINIAPP_LANGUAGES,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/index.ts";
import type { ConsentApiStatus } from "../../rider/welcome/consent-view.ts";
import {
  DriverConsentForm,
  DriverConsentGate,
  decideDriverGate,
  needsDriverConsent,
} from "./DriverConsentGate.tsx";

const DOCS = [
  {
    kind: "terms_of_service",
    version: "2026-09-12",
    titleKey: "consent.terms_of_service.title",
    summaryKey: "consent.terms_of_service.summary",
    textKey: "consent.terms_of_service.2026-09-12.text",
    requiredForOnboarding: true,
  },
  {
    kind: "privacy_policy",
    version: "2026-10-13",
    titleKey: "consent.privacy_policy.title",
    summaryKey: "consent.privacy_policy.summary",
    textKey: "consent.privacy_policy.2026-10-13.text",
    requiredForOnboarding: true,
  },
] as const;

const status = (
  terms: "missing" | "satisfied" | "superseded",
  privacy: "missing" | "satisfied" | "superseded",
): ConsentApiStatus => ({
  ok: true,
  documents: DOCS,
  onboarding: {
    satisfied: terms === "satisfied" && privacy === "satisfied",
    documents: [
      { kind: "terms_of_service", currentVersion: "2026-09-12", state: terms },
      { kind: "privacy_policy", currentVersion: "2026-10-13", state: privacy },
    ],
  },
});

describe("WR-04 — بوّابةُ موافقةِ السائق (ADR 0281)", () => {
  it("سائقٌ لم يوافق قطّ ⇒ يُسأل عن الوثيقتين", () => {
    expect(decideDriverGate(status("missing", "missing"), false)).toBe("ask");
  });
  it("وافقَ على الإصدارِ السابقِ من السياسة ⇒ يُسأل (superseded)", () => {
    expect(needsDriverConsent(status("satisfied", "superseded"))).toBe(true);
    expect(decideDriverGate(status("satisfied", "superseded"), false)).toBe("ask");
  });
  it("وافقَ على الإصدارِ الجاري من الوثيقتين ⇒ يُفتحُ السطح", () => {
    expect(decideDriverGate(status("satisfied", "satisfied"), false)).toBe("open");
  });
  it("وسطَ مهمّةٍ نشطة ⇒ تُؤجَّل البوّابة ولا تُوقِفُ الرحلةَ ولا بثَّ الموقع", () => {
    expect(decideDriverGate(status("missing", "missing"), true)).toBe("open");
    expect(decideDriverGate(status("satisfied", "superseded"), true)).toBe("open");
  });

  for (const language of MINIAPP_LANGUAGES) {
    it(`النموذجُ يعرضُ المعلّقَ وحدَه بنصِّه الكاملِ وفعلًا واحدًا · ${language}`, () => {
      const t = miniAppTranslator(language);
      const html = renderToStaticMarkup(
        <DriverConsentForm
          language={language}
          status={status("satisfied", "superseded")}
          busy={false}
          rowError={null}
          onAccept={() => {}}
        />,
      );
      expect(html).toContain(t("driver.consent.title"));
      expect(html).toContain(t("consent.privacy_policy.title"));
      expect(html).not.toContain(t("consent.terms_of_service.title"));
      expect(html).toContain("MyMemory");
      expect(html).toContain(t("welcome.consent_superseded"));
      expect(html).toContain(t("welcome.accept_all"));
      expect((html.match(/<button/g) ?? []).length).toBe(1);
      expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    });
  }

  it("الرفضُ يُقالُ تحتَ وثيقتِه، والزرُّ معطَّلٌ أثناءَ التسجيل", () => {
    const t = miniAppTranslator("ar");
    const html = renderToStaticMarkup(
      <DriverConsentForm
        language="ar"
        status={status("missing", "missing")}
        busy={true}
        rowError={{ kind: "privacy_policy", code: "VERSION_NOT_CURRENT" }}
        onAccept={() => {}}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(t("welcome.error.version_not_current"));
    expect(html).toContain("disabled");
    expect(html).toContain(t("welcome.consent_recording"));
  });

  it("الرسمُ الأوّلُ قبلَ القراءةِ هيكلُ تحميل، لا السطح", () => {
    const html = renderToStaticMarkup(
      <DriverConsentGate language="ar">
        <p>SURFACE</p>
      </DriverConsentGate>,
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("SURFACE");
  });

  it("DriverRoot يلفُّ السطحَ بالبوّابة", () => {
    const root = readFileSync(new URL("../DriverRoot.tsx", import.meta.url), "utf8");
    expect(root).toMatch(
      /<DriverConsentGate language=\{props\.language\}>\s*<DriverSurface \{\.\.\.props\} \/>/,
    );
  });
});
