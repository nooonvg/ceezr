/**
 * الغرض: `WR-17` — لا شاشةَ تسعيرٍ مستقلّة («الرحلة المقترحة» بقائمةِ «الخدماتِ في مدينتك» وزرِّ
 *   «اطلب هذه الخدمة» لكلِّ بطاقة)، بل نموذجُ طلبٍ واحدٌ بزرِّ إرسالٍ واحدٍ وفيه خياراتُ السعرِ الثلاثة.
 *   ويتتبّعُ النيّةَ من حكمِ النموذجِ إلى جسمِ `POST /v1/rides` و`POST /v1/deliveries` إلى الأمرِ الذي
 *   تسلّمُه البوّابةُ الحقيقيّةُ لطبقةِ الإنشاء — والكتابةُ في القاعدةِ يقيسُها
 *   `tests/integration/wr-05-offer-mode.test.ts` على PostGIS.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: apps/miniapp/src/surfaces/rider
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { RideRequestCommand } from "../../../../../packages/application/transport/ride-request-ports.ts";
import {
  createMiniAppSessionIssuer,
  createMiniAppSessionReader,
} from "../../../../../packages/infrastructure/identity/miniapp-session.ts";
import ar from "../../../../../packages/shared/i18n/miniapp/ar.json" with { type: "json" };
import en from "../../../../../packages/shared/i18n/miniapp/en.json" with { type: "json" };
import ur from "../../../../../packages/shared/i18n/miniapp/ur.json" with { type: "json" };
import { ok } from "../../../../../packages/shared/result/index.ts";
import { createServer } from "../../../../gateway/src/server.ts";
import type { RequestFormModel } from "./quote/QuoteScreen.tsx";

/** جسمُ كلِّ نداءٍ يخرجُ من العميل — يُحقَنُ مُسجِّلٌ بدلَ `apiFetch` (الحقيقيُّ يجرُّ `window`). */
const sent: { path: string; idempotencyKey: unknown; body: Record<string, unknown> }[] = [];
const recordFetch = async (path: string, init: Record<string, unknown>) => {
  sent.push({
    path,
    idempotencyKey: init.idempotencyKey,
    body: init.body as Record<string, unknown>,
  });
  return { ok: true, accepted: true, orderId: "o", createdAt: "x", reused: false };
};

const { RequestForm } = await import("./quote/QuoteScreen.tsx");
const { judgeRequestForm, notesFieldFor } = await import("./quote/request-form.ts");
const { requestByService } = await import("./search/request-by-service.ts");

const SCREEN = readFileSync(new URL("./quote/QuoteScreen.tsx", import.meta.url), "utf8");

const RESPONSE = {
  ok: true,
  accepted: true,
  city: { code: "MED", nameAr: "المدينة المنورة", nameEn: "Madinah" },
  distance: { kind: "STRAIGHT_LINE", meters: 4200 },
  eta: { kind: "UNAVAILABLE", reason: "PROVIDER_DOWN" },
  services: [
    { service: "transport", available: true },
    { service: "delivery", available: true },
  ],
} as const;

const PICKUP = { label: "البيت", lat: 24.5, lng: 39.58, cityCode: "MED" };
const DESTINATION = { label: "الحرم", lat: 24.467, lng: 39.611 };

function model(over: Partial<RequestFormModel> = {}): RequestFormModel {
  const noop = () => {};
  return {
    notes: "",
    setNotes: noop,
    pickupMode: "now",
    setPickupMode: noop,
    pickupClock: "",
    setPickupClock: noop,
    pickupError: false,
    setPickupError: noop,
    offerText: "",
    setOfferText: noop,
    offerError: null,
    setOfferError: noop,
    offerMode: "open",
    setOfferMode: noop,
    parcelError: null,
    setParcelError: noop,
    notesTooLong: false,
    setNotesTooLong: noop,
    pickedService: null,
    setPickedService: noop,
    ...over,
  };
}

function render(
  service: "transport" | "delivery" | undefined,
  over: Partial<RequestFormModel> = {},
  services: readonly { service: string; available: boolean; reason?: string }[] = RESPONSE.services,
): string {
  return renderToStaticMarkup(
    <RequestForm
      language="ar"
      response={{ ...RESPONSE, services } as never}
      origin={{ lat: PICKUP.lat, lng: PICKUP.lng }}
      destination={DESTINATION}
      service={service}
      pickup={PICKUP}
      onChangePickup={() => {}}
      onBack={() => {}}
      onRequest={() => {}}
      form={model(over)}
    />,
  );
}

const SUBMIT_DISABLED = /<button(?=[^>]*class="qt__submit")[^>]*\bdisabled\b/;
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("WR-17 — لا شاشةَ تسعيرٍ مستقلّة", () => {
  it("لا «الرحلة المقترحة» ولا «الخدمات في مدينتك» ولا «اطلب هذه الخدمة» في أيِّ لغة", () => {
    for (const dict of [ar, en, ur] as Record<string, string>[]) {
      expect(dict["rider.frame.quote"]).not.toMatch(/الرحلة المقترحة|Your trip|آپ کا سفر/);
      expect(dict["rider.quote.title"]).toBe(dict["rider.frame.quote"]);
      expect(dict["rider.quote.request"]).not.toMatch(/اطلب هذه الخدمة|Request this service/);
    }
    for (const service of ["transport", "delivery"] as const) {
      const html = render(service);
      expect(html).not.toContain("الرحلة المقترحة");
      expect(html).not.toContain(ar["rider.quote.services"]);
      expect(html).not.toContain("qt__services");
      expect(html).not.toContain("qt__list");
      expect(html).not.toContain("qt__card-request");
    }
  });

  it("زرُّ إرسالٍ واحدٌ للخدمةِ المختارة، وبطاقتُها وحدَها في المراجعة", () => {
    const transport = render("transport");
    expect(count(transport, 'class="qt__submit"')).toBe(1);
    expect(transport).toContain(ar["rider.quote.request"]);
    expect(transport).toContain(ar["rider.quote.service.transport"]);
    expect(transport).not.toContain(ar["rider.quote.service.delivery"]);
    const delivery = render("delivery");
    expect(count(delivery, 'class="qt__submit"')).toBe(1);
    expect(delivery).toContain(ar["rider.quote.service.delivery"]);
    expect(delivery).not.toContain(ar["rider.quote.service.transport"]);
  });

  it("الخياراتُ الثلاثةُ داخلَ النموذج، وحقلُ المبلغِ للمحدَّدِ والمقترَحِ وحدَهما", () => {
    const open = render("transport");
    expect(count(open, 'name="qt-offer-mode"')).toBe(3);
    for (const key of ["fixed", "suggested", "open"]) {
      expect(open).toContain(`value="${key}"`);
      expect(open).toContain(ar[`rider.quote.offerMode.${key}` as keyof typeof ar]);
    }
    expect(open).not.toContain('id="qt-offer"');
    expect(render("transport", { offerMode: "fixed" })).toContain('id="qt-offer"');
    expect(render("transport", { offerMode: "suggested" })).toContain('id="qt-offer"');
  });

  it("الترتيب: مراجعةٌ ← سعرٌ ← ملاحظة ← وقتُ الحضور ← بيانُ الدفع ← الزرّ", () => {
    const html = render("delivery");
    const order = [
      'class="qt__review"',
      'name="qt-offer-mode"',
      'id="qt-notes"',
      'name="qt-pickup"',
      'class="qt__payment"',
      'class="qt__submit"',
    ].map((needle) => html.indexOf(needle));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("الحقلُ يتبعُ الخدمة: وصفُ الطردِ في التوصيلِ، وملاحظةُ السائقِ في المشوار — بلا تلميحِ «في التوصيل…»", () => {
    expect(render("delivery")).toContain(ar["rider.quote.parcel.label"]);
    expect(render("transport")).toContain(ar["rider.quote.notes.label"]);
    expect(render("transport")).not.toContain(ar["rider.quote.notes.delivery_hint"]);
    expect(render("delivery")).not.toContain(ar["rider.quote.notes.delivery_hint"]);
    expect(notesFieldFor("delivery").label).toBe("rider.quote.parcel.label");
  });

  it("الخدمةُ المختارةُ غيرُ المخدومةِ: سببُها بلا نموذجٍ ولا زرّ", () => {
    const html = render("delivery", {}, [
      { service: "transport", available: true },
      { service: "delivery", available: false, reason: "NO_CAPABLE_DRIVER_IN_CITY" },
    ]);
    expect(html).toContain(ar["rider.quote.service.noCapableDriver"]);
    expect(html).not.toContain('class="qt__submit"');
    expect(html).not.toContain('name="qt-offer-mode"');
  });

  it("مدخلٌ بلا خدمةٍ مختارة يسألُ عنها داخلَ النموذجِ، والزرُّ معطَّلٌ حتّى يُختار", () => {
    const html = render(undefined);
    expect(count(html, 'name="qt-service"')).toBe(2);
    expect(html).toMatch(SUBMIT_DISABLED);
    expect(count(render(undefined, { pickedService: "transport" }), 'class="qt__submit"')).toBe(1);
    expect(render(undefined, { pickedService: "transport" })).not.toMatch(SUBMIT_DISABLED);
  });

  it("حارسُ المصدر: لا عودةَ لقائمةِ بطاقاتٍ بزرِّ طلبٍ لكلٍّ منها", () => {
    expect(SCREEN).not.toContain("cards.map(");
    expect(SCREEN).not.toContain("qt__card-request");
    expect(count(SCREEN, 't("rider.quote.request")')).toBe(1);
  });
});

const BASE = {
  origin: { lat: PICKUP.lat, lng: PICKUP.lng },
  destination: {
    lat: DESTINATION.lat,
    lng: DESTINATION.lng,
    label: DESTINATION.label,
    userLabel: DESTINATION.label,
    place: null,
  },
  pickup: { label: PICKUP.label, place: null },
  notes: "",
  pickupMode: "now" as const,
  pickupClock: "",
};

describe("WR-17 — حكمُ النموذجِ ثمَّ الإرسال", () => {
  it("الحالاتُ الثلاث: المبلغُ يلزمُ المحدَّدَ والمقترَح، و«بدون سعر» لا يحملُ مبلغًا", () => {
    let keys = 0;
    const key = () => `ride:${++keys}`;
    const fixed = judgeRequestForm({
      ...BASE,
      service: "transport",
      offerMode: "fixed",
      offerText: "٤٠",
      idempotencyKey: key,
    });
    expect(fixed).toMatchObject({ ok: true, intent: { offerMode: "fixed", offerSar: 40 } });
    const suggested = judgeRequestForm({
      ...BASE,
      service: "transport",
      offerMode: "suggested",
      offerText: "25",
      idempotencyKey: key,
    });
    expect(suggested).toMatchObject({ ok: true, intent: { offerMode: "suggested", offerSar: 25 } });
    const open = judgeRequestForm({
      ...BASE,
      service: "transport",
      offerMode: "open",
      offerText: "99",
      idempotencyKey: key,
    });
    expect(open).toMatchObject({ ok: true, intent: { offerMode: "open", offerSar: null } });
    expect(keys).toBe(3);
  });

  it("المحدَّدُ بلا مبلغ، والصفرُ والسالب، لا تُرسَلُ ولا يُولَّدُ لها مفتاح", () => {
    let keys = 0;
    const key = () => `ride:${++keys}`;
    expect(
      judgeRequestForm({
        ...BASE,
        service: "transport",
        offerMode: "fixed",
        offerText: "",
        idempotencyKey: key,
      }),
    ).toEqual({ ok: false, field: "offer", error: "required" });
    expect(
      judgeRequestForm({
        ...BASE,
        service: "transport",
        offerMode: "suggested",
        offerText: "0",
        idempotencyKey: key,
      }),
    ).toEqual({ ok: false, field: "offer", error: "invalid" });
    expect(
      judgeRequestForm({
        ...BASE,
        service: "transport",
        offerMode: "fixed",
        offerText: "-5",
        idempotencyKey: key,
      }),
    ).toEqual({ ok: false, field: "offer", error: "invalid" });
    expect(keys).toBe(0);
  });

  it("«في وقت محدّد» بلا وقتٍ لا يصيرُ «الآن»، ووصفُ الطردِ الفارغُ صالحٌ والمعطوبُ مرفوض", () => {
    const key = () => "k";
    expect(
      judgeRequestForm({
        ...BASE,
        service: "transport",
        offerMode: "open",
        offerText: "",
        pickupMode: "later",
        pickupClock: "",
        idempotencyKey: key,
      }),
    ).toEqual({ ok: false, field: "pickupAt" });
    expect(
      judgeRequestForm({
        ...BASE,
        service: "delivery",
        offerMode: "open",
        offerText: "",
        idempotencyKey: key,
      }),
    ).toMatchObject({ ok: true, intent: { service: "delivery", notes: null } });
    expect(
      judgeRequestForm({
        ...BASE,
        service: "delivery",
        notes: "ab",
        offerMode: "open",
        offerText: "",
        idempotencyKey: key,
      }),
    ).toMatchObject({ ok: false, field: "parcel" });
  });

  it("النيّةُ تصلُ جسمَ `POST /v1/rides` و`POST /v1/deliveries` بالسياسةِ والمبلغ والمفتاح", async () => {
    sent.length = 0;
    for (const service of ["transport", "delivery"] as const) {
      for (const [offerMode, offerText] of [
        ["fixed", "40"],
        ["suggested", "25"],
        ["open", ""],
      ] as const) {
        const verdict = judgeRequestForm({
          ...BASE,
          service,
          offerMode,
          offerText,
          idempotencyKey: () => `${service}:${offerMode}`,
        });
        if (!verdict.ok) throw new Error("حكمٌ فاشل");
        const { intent } = verdict;
        await requestByService({ ...intent, notes: intent.notes ?? "" }, recordFetch);
      }
    }
    expect(sent.map((s) => s.path)).toEqual([
      "/v1/rides",
      "/v1/rides",
      "/v1/rides",
      "/v1/deliveries",
      "/v1/deliveries",
      "/v1/deliveries",
    ]);
    for (const s of sent) {
      const [, mode] = String(s.idempotencyKey).split(":");
      expect(s.body.offerMode).toBe(mode);
      if (mode === "open") expect("offerSar" in s.body).toBe(false);
      else expect(s.body.offerSar).toBe(mode === "fixed" ? 40 : 25);
    }
  });

  it("البوّابةُ الحقيقيّةُ تسلّمُ السياسةَ والمبلغَ لطبقةِ الإنشاءِ كما أُرسِلا", async () => {
    const SECRET = "test-only-session-signing-secret-0123456789";
    const NOW = new Date("2027-03-01T09:00:00.000Z");
    const seen: { offerMode: unknown; offerSar: unknown; service: string; key: string }[] = [];
    const rides: RideRequestCommand = {
      create: async (input) => {
        const loose = input as unknown as { offerMode?: unknown; offerSar?: unknown };
        seen.push({
          offerMode: loose.offerMode,
          offerSar: loose.offerSar,
          service: input.service,
          key: input.idempotencyKey,
        });
        return ok({
          accepted: true,
          ride: {
            orderId: "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f",
            createdAtMs: NOW.getTime(),
            reused: false,
          },
        });
      },
    };
    const sessions = createMiniAppSessionReader(SECRET);
    const now = () => NOW;
    const app = createServer({
      health: { now, startedAt: NOW, env: {} },
      webhook: {
        webhookSecret: "test-webhook-secret-value",
        handler: { handle: async () => true },
      },
      rides: { request: { sessions, rides, now } },
      deliveries: { request: { sessions, rides, now } } as never,
    });
    const issued = createMiniAppSessionIssuer({ secret: SECRET }).issue(
      {
        telegramUserId: "5550001",
        bot: "rider",
        authDateSeconds: Math.floor(NOW.getTime() / 1000),
      },
      NOW.getTime(),
    );
    if (!issued.ok) throw new Error("إصدار فاشل");
    for (const s of sent) {
      const response = await app.fetch(
        new Request(`http://localhost${s.path}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${issued.value.accessToken}`,
            "idempotency-key": String(s.idempotencyKey),
          },
          body: JSON.stringify(s.body),
        }),
      );
      expect(response.status).toBe(200);
    }
    expect(seen).toHaveLength(6);
    for (const row of seen) {
      const [, mode] = row.key.split(":");
      expect(row.offerMode).toBe(mode);
      expect(row.offerSar).toBe(mode === "fixed" ? 40 : mode === "suggested" ? 25 : null);
    }
    expect(seen.filter((r) => r.service === "delivery")).toHaveLength(3);
  });
});
