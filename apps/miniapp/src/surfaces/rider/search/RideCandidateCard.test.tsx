/**
 * الغرض: `WR-09` (ADR 0266) — بطاقةُ المرشَّحِ للراكبِ في التطبيقِ المصغَّر: الثواني من
 *   لقطةِ الخادمِ وساعةِ العرضِ لا ساعةِ الجهاز، ورموزُ الخطأِ بنصٍّ معروف، والرسمُ بحقائقِها.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider/search
 */

import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  candidateErrorKey,
  candidateSecondsAtRender,
  RideCandidateCard,
} from "./RideCandidateCard.tsx";

const ORDER = "5c6a72c2-34b3-4b21-9cec-592f63d828c9";

describe("WR-09 — بطاقةُ المرشَّحِ في التطبيقِ المصغَّر", () => {
  test("الباقي لحظةَ الرسمِ من قراءةِ الخادمِ وفارقٍ محلّيّ، ولا يقلُّ عن صفر", () => {
    expect(candidateSecondsAtRender(15, 0)).toBe(15);
    expect(candidateSecondsAtRender(15, 4_200)).toBe(11);
    expect(candidateSecondsAtRender(15, 60_000)).toBe(0);
    expect(candidateSecondsAtRender(Number.NaN, 0)).toBe(0);
  });

  test("رموزُ القرارِ المعروفةُ لها نصوصُها، وما سواها «تعذّر»", () => {
    expect(candidateErrorKey("CANDIDATE_EXPIRED")).toBe(
      "rider.search.candidate.error.CANDIDATE_EXPIRED",
    );
    expect(candidateErrorKey("SOMETHING")).toBe("rider.search.candidate.error.UNKNOWN");
  });

  test("قبلَ القراءةِ لا تُرسَمُ بطاقةٌ (لا مرشَّحَ مُختلَق)", () => {
    const html = renderToStaticMarkup(
      <RideCandidateCard
        orderId={ORDER}
        language="ar"
        read={async () => ({ ok: true, order_status: "searching", candidate: null })}
      />,
    );
    expect(html).toBe("");
  });
});
