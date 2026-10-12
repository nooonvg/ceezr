/**
 * الغرض: `WR-06` الخيارُ ج (ADR 0273) — بطاقةُ الطلبِ المجدولِ في التطبيقِ المصغَّر: الموعدُ
 *   ولحظةُ بدءِ البحثِ بنصٍّ في كلِّ لغة، ولا زرَّ إلغاءٍ قبلَ أن يقولَ الخادمُ إنّه قابلٌ للإلغاء.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MINIAPP_LANGUAGES } from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { ScheduledDetails, ScheduledRideCard } from "./ScheduledRideCard.tsx";

const NOW = Date.parse("2026-10-12T07:00:00Z");

describe("WR-06 — بطاقةُ المجدول", () => {
  for (const language of MINIAPP_LANGUAGES) {
    test(`الموعدُ ولحظةُ بدءِ البحثِ وشرحُهما بلا مفتاحٍ خامٍ · ${language}`, () => {
      const html = renderToStaticMarkup(
        <ScheduledDetails
          language={language}
          pickupAt="2026-10-12T21:30:00Z"
          dispatchAt="2026-10-12T21:10:00Z"
          nowMs={NOW}
        />,
      );
      expect(html).toContain("12:30");
      expect(html).toContain("12:10");
      expect(html).not.toContain("rider.search.");
    });
  }

  test("لحظةٌ غائبةٌ لا تُرسَمُ سطرًا مختلَقًا", () => {
    const html = renderToStaticMarkup(
      <ScheduledDetails language="ar" pickupAt={null} dispatchAt={null} nowMs={NOW} />,
    );
    expect(html).not.toContain("موعد الحضور");
    expect(html).toContain("لن يُرسَل طلبك");
  });

  test("قبلَ القراءةِ: «مجدول» بلا زرِّ إلغاء", () => {
    const html = renderToStaticMarkup(
      <ScheduledRideCard
        orderId="5c6a72c2-34b3-4b21-9cec-592f63d828c9"
        language="ar"
        read={() => new Promise(() => undefined)}
      />,
    );
    expect(html).toContain("طلبك مجدول");
    expect(html).not.toContain("rs__cancel");
  });
});
