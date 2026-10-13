/**
 * الغرض: `WR-16C` — تبديلُ الخدمةِ يغيّرُ السؤالَ والحقولَ والخطوات: المشوارُ «إلى أين؟» ثمَّ الالتقاط،
 *   والتوصيلُ «من أين نستلم الطلب؟» ثمَّ «إلى أين نوصله؟»، ولا تُرسَلُ نقاطٌ معكوسة.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ar from "../../../../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../../../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../../../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };
import {
  type ConfirmedDestination,
  DestinationScreen,
  purposeText,
} from "./destination/DestinationScreen.tsx";
import { type ChosenDestination, homeFieldText, homeListText } from "./home/HomeScreen.tsx";
import { pickupTextFor, QuoteScreen } from "./quote/QuoteScreen.tsx";
import { initialRiderFlow, riderFlowReducer, riderFlowView } from "./rider-flow.ts";

const DELIVERY: ChosenDestination = { label: "مطعم", lat: null, lng: null, service: "delivery" };
const TRANSPORT: ChosenDestination = { label: "الحرم", lat: null, lng: null, service: "transport" };
const SHOP: ConfirmedDestination = { label: "المطعم", lat: 24.47, lng: 39.61, cityCode: "MED" };
const HOME: ConfirmedDestination = { label: "البيت", lat: 24.5, lng: 39.58, cityCode: "MED" };

describe("WR-16C — الحقلُ الأوّلُ يتبعُ الخدمة", () => {
  it("المشوارُ يسألُ «إلى أين؟» والتوصيلُ «من أين نستلم الطلب؟»", () => {
    expect(ar[homeFieldText("transport").prompt as keyof typeof ar]).toBe("إلى أين؟");
    expect(ar[homeFieldText("delivery").prompt as keyof typeof ar]).toBe("من أين نستلم الطلب؟");
    expect(homeFieldText("delivery").placeholder).not.toBe(homeFieldText("transport").placeholder);
    expect(homeFieldText("delivery").hint).not.toBe(homeFieldText("transport").hint);
  });

  it("شاشةُ المكانِ تسألُ بحسبِ الغرض", () => {
    expect(ar[purposeText("deliveryPickup").title as keyof typeof ar]).toBe("من أين نستلم الطلب؟");
    expect(ar[purposeText("deliveryDropoff").title as keyof typeof ar]).toBe("إلى أين نوصله؟");
    expect(purposeText("destination").title).toBe("rider.destination.title");
    expect(purposeText("pickup").title).toBe("rider.pickup.title");
    const html = renderToStaticMarkup(
      <DestinationScreen purpose="deliveryDropoff" initialLanguage="ar" showTitle />,
    );
    expect(html).toContain("إلى أين نوصله؟");
  });

  it("كلُّ مفتاحٍ جديدٍ له نصٌّ في اللغاتِ الثلاث", () => {
    const keys = [
      ...Object.values(homeFieldText("delivery")),
      purposeText("deliveryPickup").title,
      purposeText("deliveryPickup").confirm,
      purposeText("deliveryDropoff").title,
      purposeText("deliveryDropoff").confirm,
      pickupTextFor("delivery").named,
      pickupTextFor("delivery").change,
      "rider.frame.deliveryPickup",
      "rider.frame.deliveryDropoff",
    ];
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      for (const key of keys) expect(typeof dict[key]).toBe("string");
    }
  });
});

describe("WR-16C — ترتيبُ الخطواتِ في التدفّق", () => {
  it("التوصيل: الاستلامُ أوّلًا ثمَّ الوجهةُ ثمَّ الاقتباسُ بالاستلامِ المؤكَّد", () => {
    let s = riderFlowReducer(initialRiderFlow(), { type: "choose", chosen: DELIVERY });
    expect(riderFlowView(s)).toEqual({ screen: "destination", chosen: DELIVERY });
    s = riderFlowReducer(s, { type: "confirm", confirmed: SHOP });
    expect(riderFlowView(s)).toEqual({ screen: "dropoff", pickup: SHOP });
    s = riderFlowReducer(s, { type: "confirm", confirmed: HOME });
    expect(riderFlowView(s)).toEqual({
      screen: "quote",
      confirmed: HOME,
      service: "delivery",
      pickup: SHOP,
    });
    expect(s.stack.stack.map((e) => e.screen)).toEqual(["destination", "dropoff", "quote"]);
  });

  it("الرجوعُ من وجهةِ التوصيلِ يُسقِطُ الاستلامَ فيُعادُ تأكيدُه", () => {
    let s = riderFlowReducer(initialRiderFlow(), { type: "choose", chosen: DELIVERY });
    s = riderFlowReducer(s, { type: "confirm", confirmed: SHOP });
    s = riderFlowReducer(s, { type: "back" });
    expect(s.pickup).toBeNull();
    expect(riderFlowView(s)).toEqual({ screen: "destination", chosen: DELIVERY });
  });

  it("المشوار: الوجهةُ ثمَّ الاقتباسُ مباشرةً، ولا استلامَ مؤكَّدًا مسبقًا", () => {
    let s = riderFlowReducer(initialRiderFlow(), { type: "choose", chosen: TRANSPORT });
    s = riderFlowReducer(s, { type: "confirm", confirmed: HOME });
    expect(riderFlowView(s)).toEqual({
      screen: "quote",
      confirmed: HOME,
      service: "transport",
      pickup: null,
    });
  });

  it("التسليمُ إلى البحثِ يفرّغُ الاستلامَ أيضًا", () => {
    let s = riderFlowReducer(initialRiderFlow(), { type: "choose", chosen: DELIVERY });
    s = riderFlowReducer(s, { type: "confirm", confirmed: SHOP });
    s = riderFlowReducer(s, { type: "handoff" });
    expect(s.pickup).toBeNull();
    expect(s.chosen).toBeNull();
  });
});

describe("WR-16C — الاقتباسُ يحترمُ الاستلامَ المؤكَّدَ والخدمة", () => {
  it("التوصيلُ باستلامٍ مؤكَّدٍ لا يفتحُ شاشةَ الالتقاطِ ثانيةً", () => {
    const html = renderToStaticMarkup(
      <QuoteScreen
        destination={HOME}
        service="delivery"
        initialPickup={SHOP}
        initialLanguage="ar"
        quote={() => new Promise(() => {})}
      />,
    );
    expect(html).not.toContain("من أين نستلم الطلب؟");
    expect(html).not.toContain("من أين نأخذك؟");
  });

  it("المشوارُ بلا استلامٍ مؤكَّدٍ يسألُ عن الالتقاطِ أوّلًا كما كان", () => {
    const html = renderToStaticMarkup(
      <QuoteScreen destination={HOME} initialLanguage="ar" showTitle={false} />,
    );
    expect(html).toContain('class="rd');
  });

  it("نصُّ الالتقاطِ في التوصيلِ «الاستلام»", () => {
    expect(ar[pickupTextFor("delivery").named as keyof typeof ar]).toBe("الاستلام: {label}");
    expect(pickupTextFor(undefined).named).toBe("rider.pickup.named");
  });
});

describe("WR-16C — عناوينُ قوائمِ الرئيسيةِ تتبعُ الخدمة", () => {
  it("التوصيلُ لا يُسمّي القائمةَ «آخر وجهاتك» والمختارُ منها يصيرُ مكانَ الاستلام", () => {
    const d = homeListText("delivery");
    const tr = homeListText("transport");
    expect(tr.recentTitle).toBe("rider.home.recent.title");
    expect(tr.placesTitle).toBe("rider.home.places.title");
    expect(ar[d.recentTitle as keyof typeof ar]).toBe("استلام من مكان سابق");
    expect(ar[d.placesTitle as keyof typeof ar]).toBe("استلام من مكان محفوظ");
    expect(ar[d.recentTitle as keyof typeof ar]).not.toContain("وجهات");
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      for (const key of Object.values(d)) expect(typeof dict[key]).toBe("string");
    }
  });
});

describe("WR-16A · WR-12 — عبارةُ الموضعِ تذكرُ تذكيرَ البوت", () => {
  it("النصُّ موجودٌ في اللغاتِ الثلاثِ ولا يدّعي بثًّا في الخلفية", () => {
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      expect(typeof dict["driver.location.reminderNote"]).toBe("string");
    }
    expect(ar["driver.location.reminderNote"]).toContain("يذكّرك بوت السائق");
    expect(ar["driver.location.reminderNote"]).not.toContain("الخلفية");
  });
});
