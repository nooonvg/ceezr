import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DECLARED_CONSENT_DOCUMENTS } from "../../packages/domain/consent/consent-documents.ts";

const dict = (lang: string): Record<string, string> =>
  JSON.parse(
    readFileSync(
      new URL(`../../packages/shared/i18n/miniapp/${lang}.json`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, string>;

describe("WR-04 — إصدارُ سياسةِ الخصوصيّة 2026-10-13 (ADR 0279، اعتمادُ المالك)", () => {
  const privacy = DECLARED_CONSENT_DOCUMENTS.find((d) => d.kind === "privacy_policy");
  it("الإصدارُ الجاري 2026-10-13، والشروطُ لم تتغيّر", () => {
    expect(privacy?.version).toBe("2026-10-13");
    expect(privacy?.textKey).toBe("consent.privacy_policy.2026-10-13.text");
    expect(DECLARED_CONSENT_DOCUMENTS.find((d) => d.kind === "terms_of_service")?.version).toBe(
      "2026-09-12",
    );
  });
  it("النصُّ الجديدُ يذكرُ معالجَ الترجمةِ وما لا يُرسَلُ إليه، باللغاتِ الثلاث", () => {
    for (const lang of ["ar", "en", "ur"]) {
      const text = dict(lang)["consent.privacy_policy.2026-10-13.text"] ?? "";
      expect(text).toContain("MyMemory");
      expect(text).toContain("2026-10-13");
      // العنوانُ ثمَّ البنودُ الخمسة.
      expect(text.split("\n\n")).toHaveLength(6);
    }
  });
  it("نصُّ الإصدارِ السابقِ باقٍ لمن وافقَ عليه", () => {
    for (const lang of ["ar", "en", "ur"]) {
      expect(dict(lang)["consent.privacy_policy.2026-09-12.text"]).toContain("2026-09-12");
    }
  });
});
