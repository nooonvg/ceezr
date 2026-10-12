/**
 * الغرض: قياسُ حاجزِ أسطحِ دخولِ الاستغاثةِ — **أحدَ عشرَ سطحًا مُلتزمةٌ** يُمرِّرُ
 *   إليها `RiderRoot` مدخلَ الاستغاثةِ، فلا يختفي البابُ من شاشةٍ بحجّةِ أنَّ
 *   رحلةً نشطةً بطاقتُها المدمجةُ أقربُ (البند `PD-020` · `ADR 0159`).
 * الحالة: منفَّذٌ فعليّاً — البند `PD-020`.
 * ينتمي إلى: tests/unit
 * يُستخدم من: `bun test` وسلسلةُ `ci`.
 * الحاكم: docs/adr/0159-safety-channel-entry-delivery-review-and-driver-cannot-complete.md
 *
 * ## لماذا يُقرأُ المستودعُ ولا تُختبرُ شاشةٌ واحدةٌ
 *
 * لأنَّ الخطرَ في **الانتشارِ لا في البناءِ**: شاشةٌ واحدةٌ بلا مدخلٍ تمرُّ
 * في كلِّ فحصٍ عامٍّ، ويبقى البابُ غائباً عن راكبٍ واقفٍ فيها وحده. والقائمةُ
 * مكتوبةٌ لا مكتشَفةٌ بنمطٍ — فاكتشافُها بنمطٍ يمرُّ وشاشةً نسيتِ المدخلَ ولم
 * تُدرَجْ في القائمةِ بعد.
 *
 * ## ولماذا الرحلةُ النشطةُ خارجَ القائمةِ عمداً
 *
 * لأنَّ فيها البطاقةَ المدمجةَ نفسَها (`SosCard`) — أقربَ من مدخلٍ يفتحُ شاشةً
 * فوقَها. والقياسُ ههنا أنَّها **تحملُ البطاقةَ لا المدخلَ**: لا أنَّها
 * مُسقَطةٌ من الدَّينِ بل أنَّ مدخلَها من جنسٍ آخرَ.
 *
 * ## وما لا يُقاسُ ههنا عن قصدٍ
 *
 *   ــ **لا موضعُ الزرِّ ولا شكلُهُ**: ذاك حكمُ تصميمٍ يُقرأُ بالعينِ لا بمساواةِ
 *      نصوصٍ.
 *   ــ **لا فتحُ الشاشةِ فعلاً**: فعلُ الفتحِ يقيسُه اختبارُ الشاشةِ نفسِها لا
 *      جردُ المصادرِ.
 *
 * ## لماذا أحدَ عشرَ لا عشرةٌ
 *
 * لأنَّ `DEC-34` أضافَ صفحةَ مفقوداتٍ مخصَّصةً (`lostFound`) تُركِّبُ `SupportScreen`
 * بصنفِ `lost_item` مبدئيًّا — وهيَ سطحُ دعمٍ يحملُ مدخلَ الاستغاثةِ كأختِها.
 * والزيادةُ عهدٌ مُصرَّحٌ بهِ ههنا.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

/** الأسطحُ الملتزمةُ — تسعةٌ مكتوبةً لا مكتشَفةً (انظرْ رأسَ المِلفِّ). */
const COMMITTED_SURFACES: readonly string[] = [
  "apps/miniapp/src/surfaces/rider/home/HomeScreen.tsx",
  "apps/miniapp/src/surfaces/rider/destination/DestinationScreen.tsx",
  "apps/miniapp/src/surfaces/rider/quote/QuoteScreen.tsx",
  "apps/miniapp/src/surfaces/rider/search/SearchScreen.tsx",
  "apps/miniapp/src/surfaces/rider/summary/RideSummaryScreen.tsx",
  "apps/miniapp/src/surfaces/rider/history/RideHistoryScreen.tsx",
  "apps/miniapp/src/surfaces/rider/history/RideDetailScreen.tsx",
  "apps/miniapp/src/surfaces/rider/notifications/NotificationsScreen.tsx",
  "apps/miniapp/src/surfaces/rider/account/AccountScreen.tsx",
  "apps/miniapp/src/surfaces/rider/support/SupportScreen.tsx",
];

/** الموجِّهُ — يُمرِّرُ المدخلَ إلى كلِّ سطحٍ ملتزَمٍ ويُركِّبُ الشاشةَ. */
const ROOT = "apps/miniapp/src/surfaces/rider/RiderRoot.tsx";

/** الرحلةُ النشطةُ — بطاقتُها المدمجةُ أقربُ من مدخلٍ يفتحُ شاشةً فوقَها. */
const ACTIVE_RIDE = "apps/miniapp/src/surfaces/rider/active/ActiveRideScreen.tsx";

/** الترحيبُ — قبلَ الموافقاتِ لا استغاثةَ ولا منتجَ (القسم 9.12). */
const WELCOME = "apps/miniapp/src/surfaces/rider/welcome/WelcomeScreen.tsx";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("أسطحُ دخولِ الاستغاثةِ — أحدَ عشرَ لا تختفي منها واحدةٌ", () => {
  it("كلُّ سطحٍ ملتزَمٍ يقبلُ المدخلَ ويُحيلُ إلى المُكوِّنِ الموحَّدِ", () => {
    for (const path of COMMITTED_SURFACES) {
      const source = read(path);
      expect(source.includes("onOpenSos?"), path).toBe(true);
      expect(
        source.includes("SosEntry"),
        `${path}: السطحُ يقبلُ المدخلَ ولا يُحيلُ إلى المُكوِّنِ الموحَّدِ`,
      ).toBe(true);
    }
  });

  it("القائمةُ عشرةٌ لا تزيدُ ولا تنقصُ — فالزيادةَ عهدٌ يُصرَّحُ بهِ", () => {
    expect(COMMITTED_SURFACES).toHaveLength(10);
  });

  it("الموجِّهُ يُمرِّرُ المدخلَ إلى الأسطحِ العشرةِ وصفحةِ المفقوداتِ (أحدَ عشرَ) ويُركِّبُ شاشةَ الاستغاثةِ", () => {
    const root = read(ROOT);
    // UI-3 / PR 5 (ADR 0238): الدعمُ يُرسَمُ موضعَين — تبويبُ «الدعم» الجذريُّ والشكوى المربوطةُ برحلةٍ —
    // فصارَت المواضعُ اثنَي عشرَ والأسطحُ عشرةً كما كانَت (لا سطحَ زادَ ولا نقص).
    // `WR-16C`: وشاشةُ المكانِ تُرسَمُ موضعًا ثالثًا لوجهةِ التوصيلِ (السطحُ نفسُه) ⇒ ثلاثةَ عشرَ موضعًا.
    expect(root.match(/onOpenSos=\{onOpenSos\}/g) ?? []).toHaveLength(13);
    expect(root.includes("import { SosScreen } from ./sos/SosScreen.tsx")).toBe(false);
    expect(root.includes('import { SosScreen } from "./sos/SosScreen.tsx"')).toBe(true);
    // UI-3 / PR 4 (ADR 0237): R9 تدفّقٌ في `ScreenFrame` — الرجوعُ لرأسِ الإطارِ يُطفِئُ الرايةَ، والشاشةُ بلا زرٍّ ثانٍ.
    expect(
      root.includes('back={{ label: t("rider.sos.back"), onBack: () => setSosOpen(false) }}'),
    ).toBe(true);
    expect(root.includes("<SosScreen language={language} showTitle={false} />")).toBe(true);
  });

  it("الرحلةُ النشطةُ تحملُ البطاقةَ المدمجةَ لا المدخلَ — والتأكيدُ بالنصِّينِ", () => {
    const active = read(ACTIVE_RIDE);
    expect(active.includes("SosCard")).toBe(true);
    expect(active.includes("SosEntry")).toBe(false);
  });

  it("الترحيبُ بلا مدخلٍ: قبلَ الموافقاتِ لا استغاثةَ ولا منتجَ", () => {
    const welcome = read(WELCOME);
    expect(welcome.includes("SosEntry")).toBe(false);
    expect(welcome.includes("onOpenSos")).toBe(false);
  });
});
