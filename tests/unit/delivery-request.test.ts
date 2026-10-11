/**
 * الغرض: اختبار وحدة التوصيل على ثلاث طبقات: صحّة الطلب في domain/delivery، حالة الاستخدام
 *   requestDelivery في application/delivery، وعزل الخدمتين في المطابقة — سائق النقل لا يرى
 *   عرض توصيل، وسائق التوصيل لا يرى عرض نقل، بحُكم driver_capabilities وخطة الاشتراك.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة تسعير التوصيل يُضاف اختبار يقارن التقدير بتعرفة المدينة.
 */
import { describe, expect, it } from "bun:test";
import { requestDelivery } from "../../packages/application/delivery/index.ts";
import { makeDeliveryRequest } from "../../packages/domain/delivery/index.ts";
import {
  type DriverCandidate,
  evaluateCandidates,
  type MatchingParameters,
  type OrderContext,
  rejectionReasonFor,
} from "../../packages/domain/dispatch/entity.ts";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import type { DriverId, OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import { JEDDAH, offerWriterDouble, rideRequestCommand } from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const RIDER = "rider-1" as RiderId;
const ORDER_ID = "order-1" as OrderId;
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.55, longitude: 39.18 };
const PARCEL = "صندوق كتب متوسط الحجم";

describe("domain/delivery — صحّة طلب التوصيل", () => {
  it("يقبل طلباً كامل الأركان ويثبّت نوع الخدمة delivery", () => {
    const made = makeDeliveryRequest({
      cityId: JEDDAH.id,
      riderId: RIDER,
      pickup: PICKUP,
      dropoff: DROPOFF,
      parcelDescription: `  ${PARCEL}  `,
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.value.service).toBe("delivery");
    // الفراغات الزائدة تُنظَّف قبل الحفظ لا بعده
    expect(made.value.parcelDescription).toBe(PARCEL);
    expect(made.value.dropoff).toEqual(DROPOFF);
  });

  it("يرفض غياب الوجهة — هذا هو الفرق الجوهري عن النقل", () => {
    const made = makeDeliveryRequest({
      cityId: JEDDAH.id,
      riderId: RIDER,
      pickup: PICKUP,
      dropoff: null,
      parcelDescription: PARCEL,
    });
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.error.code).toBe("DELIVERY_DROPOFF_REQUIRED");
  });

  // WR-18 — قرار المالك: الوصف اختياري. الفراغ «لا وصف» والطلب صالح.
  it("يقبل طلب توصيل بلا وصف ويحمل الوصف null", () => {
    for (const raw of ["", "   "]) {
      const made = makeDeliveryRequest({
        cityId: JEDDAH.id,
        riderId: RIDER,
        pickup: PICKUP,
        dropoff: DROPOFF,
        parcelDescription: raw,
      });
      expect(made.ok).toBe(true);
      if (!made.ok) continue;
      expect(made.value.parcelDescription).toBeNull();
    }
  });

  it("يرفض الأوصاف غير الصالحة بسببٍ صريح لكل حالة", () => {
    const cases: readonly { readonly raw: string; readonly reason: string }[] = [
      { raw: "أب", reason: "too_short" },
      { raw: "/skip", reason: "looks_like_command" },
      { raw: "ط".repeat(201), reason: "too_long" },
    ];
    for (const testCase of cases) {
      const made = makeDeliveryRequest({
        cityId: JEDDAH.id,
        riderId: RIDER,
        pickup: PICKUP,
        dropoff: DROPOFF,
        parcelDescription: testCase.raw,
      });
      expect(made.ok).toBe(false);
      if (made.ok) continue;
      expect(made.error.code).toBe("INVALID_PARCEL_DESCRIPTION");
      if (made.error.code !== "INVALID_PARCEL_DESCRIPTION") continue;
      expect(made.error.reason).toBe(testCase.reason as never);
    }
  });
});

const DELIVERY_ORDER: Order = {
  id: ORDER_ID,
  cityId: JEDDAH.id,
  service: "delivery",
  status: "searching",
  pickup: PICKUP,
  dropoff: DROPOFF,
  assignedDriverId: null,
  broadcastRound: 0,
};

function candidate(
  id: string,
  service: "transport" | "delivery",
  plan: "transport" | "delivery" | "both",
): DriverCandidate {
  const driverId = id as DriverId;
  return {
    driverId,
    cityId: JEDDAH.id,
    location: { latitude: 21.5471, longitude: 39.1751 },
    isAvailable: true,
    isVerified: true,
    isBlocked: false,
    ratingAverage: null,
    ratingCount: 0,
    capabilities: [{ driverId, cityId: JEDDAH.id, service, isEnabled: true }],
    subscription: {
      driverId,
      cityId: JEDDAH.id,
      plan,
      status: "trialing",
      trialEndsAt: new Date(NOW.getTime() + 86_400_000),
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    },
  };
}

describe("application/delivery — requestDelivery", () => {
  it("يكتب طلباً بخدمة delivery ووصف الطرد في notes ثم يبثّه على سائق التوصيل", async () => {
    const rides = rideRequestCommand(ORDER_ID);
    const offers = offerWriterDouble();
    const courier = candidate("courier-1", "delivery", "delivery");

    const result = await requestDelivery(
      {
        cityId: JEDDAH.id,
        riderId: RIDER,
        pickup: PICKUP,
        dropoff: DROPOFF,
        parcelDescription: PARCEL,
      },
      {
        rides,
        matching: {
          orders: orderRepo([DELIVERY_ORDER]),
          offers: offerRepo([]),
          candidates: candidateRepo([courier]),
          settings: settingsRepo(seededRows(JEDDAH.id)),
          offerWriter: offers,
          clock: fixedClock(NOW),
        },
      },
      "telegram-update:1:1",
      "1",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rides.createCalls).toHaveLength(1);
    expect(rides.createCalls[0]?.service).toBe("delivery");
    expect(rides.createCalls[0]?.notes).toBe(PARCEL);
    expect(rides.createCalls[0]?.destination).toEqual({
      lat: DROPOFF.latitude,
      lng: DROPOFF.longitude,
    });
    expect(result.value.offered).toEqual([courier.driverId]);
    expect(result.value.broadcastFailure).toBeNull();
    expect(offers.rounds[0]?.entries.map((e) => e.driverId)).toEqual([courier.driverId]);
  });

  it("لا يكتب طلباً أصلاً إن كان المُدخَل غير صالح", async () => {
    const rides = rideRequestCommand(ORDER_ID);
    const result = await requestDelivery(
      {
        cityId: JEDDAH.id,
        riderId: RIDER,
        pickup: PICKUP,
        dropoff: null,
        parcelDescription: PARCEL,
      },
      {
        rides,
        matching: {
          orders: orderRepo([DELIVERY_ORDER]),
          offers: offerRepo([]),
          candidates: candidateRepo([]),
          settings: settingsRepo(seededRows(JEDDAH.id)),
          offerWriter: offerWriterDouble(),
          clock: fixedClock(NOW),
        },
      },
      "telegram-update:1:1",
      "1",
    );
    expect(result.ok).toBe(false);
    expect(rides.createCalls).toHaveLength(0);
  });

  it("فشل البثّ لا يُلغي الطلب المكتوب بل يُعاد سببه صراحةً", async () => {
    const rides = rideRequestCommand(ORDER_ID);
    const result = await requestDelivery(
      {
        cityId: JEDDAH.id,
        riderId: RIDER,
        pickup: PICKUP,
        dropoff: DROPOFF,
        parcelDescription: PARCEL,
      },
      {
        rides,
        matching: {
          // لا سائق مؤهل إطلاقاً: matchOrder يرفض والطلب يبقى قائماً
          orders: orderRepo([DELIVERY_ORDER]),
          offers: offerRepo([]),
          candidates: candidateRepo([]),
          settings: settingsRepo(seededRows(JEDDAH.id)),
          offerWriter: offerWriterDouble(),
          clock: fixedClock(NOW),
        },
      },
      "telegram-update:1:1",
      "1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rides.createCalls).toHaveLength(1);
    expect(result.value.offered).toEqual([]);
    expect(result.value.broadcastFailure).not.toBeNull();
  });
});

const PARAMS: MatchingParameters = {
  searchRadiusKm: 10 as DistanceKm,
  weightProximity: 0.7,
  weightRating: 0.3,
  // البند 2.4: صفرٌ هو المبذور، فالخطّ الأساسي هو معادلة ما قبل البند بحرفها
  weightPreferredArea: 0,
  broadcastBatchSize: 5,
  ratingMinCountForTrust: 3,
  defaultRating: 4.5,
};

function orderContext(service: "transport" | "delivery"): OrderContext {
  return { cityId: JEDDAH.id, service, pickup: PICKUP, excludedDriverIds: [] };
}

describe("عزل الخدمتين في المطابقة", () => {
  it("سائق نقل فقط لا يدخل مرشحي التوصيل — والسبب SERVICE_NOT_ENABLED", () => {
    const driver = candidate("transport-only", "transport", "transport");
    expect(rejectionReasonFor(driver, orderContext("delivery"), PARAMS, NOW)).toBe(
      "SERVICE_NOT_ENABLED",
    );
    expect(rejectionReasonFor(driver, orderContext("transport"), PARAMS, NOW)).toBeNull();
  });

  it("سائق توصيل فقط لا يدخل مرشحي النقل", () => {
    const driver = candidate("delivery-only", "delivery", "delivery");
    expect(rejectionReasonFor(driver, orderContext("transport"), PARAMS, NOW)).toBe(
      "SERVICE_NOT_ENABLED",
    );
    expect(rejectionReasonFor(driver, orderContext("delivery"), PARAMS, NOW)).toBeNull();
  });

  it("مفعِّل الخدمة باشتراك لا يغطّيها يُستبعد بسبب الاشتراك لا بسبب القدرة", () => {
    const driver = candidate("mismatch", "delivery", "transport");
    expect(rejectionReasonFor(driver, orderContext("delivery"), PARAMS, NOW)).toBe(
      "NO_LIVE_SUBSCRIPTION",
    );
  });

  it("طلب توصيل واحد بين ثلاثة سائقين: المؤهل واحد فقط", () => {
    const evaluation = evaluateCandidates(
      [
        candidate("transport-only", "transport", "transport"),
        candidate("delivery-only", "delivery", "delivery"),
        candidate("both", "delivery", "both"),
      ],
      orderContext("delivery"),
      PARAMS,
      NOW,
    );
    expect(evaluation.eligible.map((c) => c.driverId).sort()).toEqual([
      "both" as DriverId,
      "delivery-only" as DriverId,
    ]);
    expect(evaluation.rejected).toEqual([
      { driverId: "transport-only" as DriverId, reason: "SERVICE_NOT_ENABLED" },
    ]);
  });
});
