/**
 * الغرض: اختبار حوار بوت العميل من /start إلى إنشاء طلب حقيقي وبدء البحث عن سائق.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند إضافة التسعير المسبق يُضاف اختبار يقارن التقدير بالتعرفة المخزَّنة.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  allItemsFor,
  helpKeyboard,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "../../packages/application/bots/main-menu.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type { SupportDialogDependencies } from "../../packages/application/bots/support-dialog.ts";
import type {
  ActiveOrderSummary,
  IncomingUpdate,
  PastOrderSummary,
  Sender,
} from "../../packages/application/bots/types.ts";
import { waitingVariants } from "../../packages/application/bots/waiting-lines.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { Order } from "../../packages/domain/transport/entity.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { DriverId, OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  JEDDAH,
  type OrderWriterDouble,
  offerWriterDouble,
  orderWriter,
  rideRequestCommand,
  riderDirectory,
} from "../support/bot-doubles.ts";
import {
  candidateRepo,
  fixedClock,
  offerRepo,
  orderRepo,
  seededRows,
  settingsRepo,
} from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "500", chatId: "500", languageHint: "ar" };
const PICKUP = { latitude: 21.5433, longitude: 39.1728 };
const DROPOFF = { latitude: 21.5, longitude: 39.2 };
const ORDER_ID = "order-1" as OrderId;

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

let updateIdCounter = 0;
function nextUpdateId(): number {
  return ++updateIdCounter;
}

function text(value: string): IncomingUpdate {
  return { kind: "text", from: SENDER, updateId: nextUpdateId(), text: value };
}
function location(coords: { latitude: number; longitude: number }): IncomingUpdate {
  return { kind: "location", from: SENDER, updateId: nextUpdateId(), location: coords };
}
function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, updateId: nextUpdateId(), data };
}

const SEARCHING_ORDER: Order = {
  id: ORDER_ID,
  cityId: JEDDAH.id,
  service: "transport",
  status: "searching",
  pickup: PICKUP,
  dropoff: null,
  assignedDriverId: null,
  broadcastRound: 0,
};

let orders: OrderWriterDouble;
let rides: ReturnType<typeof rideRequestCommand>;
let deps: RiderBotDependencies;

function build(overrides: Partial<RiderBotDependencies> = {}): RiderBotDependencies {
  return { ...deps, ...overrides };
}

beforeEach(() => {
  updateIdCounter = 0;
  orders = orderWriter(ORDER_ID);
  rides = rideRequestCommand(ORDER_ID);
  deps = {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    riders: riderDirectory(null),
    cities: cityDirectory([JEDDAH]),
    orders,
    rides,
    activeOrdersOf: async () => [],
    pastOrdersOf: async () => [],
    matching: {
      orders: orderRepo([SEARCHING_ORDER]),
      offers: offerRepo([]),
      candidates: candidateRepo([]),
      settings: settingsRepo(seededRows(JEDDAH.id)),
      offerWriter: offerWriterDouble(),
      clock: fixedClock(NOW),
    },
    clock: fixedClock(NOW),
  };
});

describe("القائمة الدائمة في حوار العميل", () => {
  it("ترافق الترحيب من أوّل رسالة", async () => {
    const d = build();
    const start = await handleRiderUpdate(text("/start"), d);
    expect(start[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  /**
   * مطلب «ضغطة واحدة في كل الحالات»: لوحة الردّ ترسل **نصّ الزرّ حرفياً**
   * كأنّ المستخدم كتبه. فبلا ترجمة قبل فحص الخطوة يُسجَّل نصّ الزرّ اسماً للعميل.
   */
  it("زرّ القائمة يعمل في منتصف التسجيل ولا يُسجَّل اسماً", async () => {
    const d = build();
    await handleRiderUpdate(text("/start"), d);

    const pressed = await handleRiderUpdate(text(ar("menu.rider.cancel")), d);
    // أُلغيت الخطوة فعلاً — لا «سُجّل اسمك» ولا «لم أفهم هذه الرسالة»
    expect(pressed[0]?.text).toBe(ar("common.cancelled"));
    expect(pressed[0]?.text).not.toBe(ar("common.unknown_command"));

    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  it("يفهم زرّاً بلغة أخرى — لوحة قديمة باقية على جهاز المستخدم", async () => {
    const d = build();
    await handleRiderUpdate(text("/start"), d);
    const pressed = await handleRiderUpdate(text(translate("en", "menu.rider.cancel")), d);
    expect(pressed[0]?.text).toBe(ar("common.cancelled"));
  });
});

describe("تسجيل العميل وطلب رحلة", () => {
  it("يمضي من /start إلى طلب مُنشَأ بموقع حقيقي", async () => {
    const start = await handleRiderUpdate(text("/start"), deps);
    expect(start.map((r) => r.text)).toEqual([ar("rider.welcome"), ar("rider.ask_name")]);

    const name = await handleRiderUpdate(text("سالم"), deps);
    expect(name[0]?.text).toBe(ar("rider.ask_city"));

    const riders = riderDirectory(null);
    const withRiders = build({ riders });
    // نعيد المسار على دليل عملاء يسجّل فعلاً
    await handleRiderUpdate(text("/start"), withRiders);
    await handleRiderUpdate(text("سالم"), withRiders);
    const city = await handleRiderUpdate(callback(`city:${JEDDAH.id}`), withRiders);
    expect(city[0]?.text).toBe(ar("rider.registered", { name: "سالم", city: "جدة" }));
    // بعد التسجيل يُسأل العميل عن الخدمة: النقل والتوصيل مساران مختلفان من أول خطوة
    expect(city[1]?.text).toBe(ar("rider.ask_service"));
    expect(city[1]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: ar("rider.service_transport"), data: "svc:transport" }],
        [{ label: ar("rider.service_delivery"), data: "svc:delivery" }],
        [{ label: ar("common.back_button"), data: "back:city" }],
      ],
    });
    expect(riders.registrations).toHaveLength(1);

    const chosen = await handleRiderUpdate(callback("svc:transport"), withRiders);
    expect(chosen[0]?.text).toBe(ar("rider.ask_pickup"));
    // البند 4.3: زرّ الموقع ومعه القائمة تحته، فزرّ الدعم لا يُمحى في منتصف الطلب
    expect(chosen[0]?.keyboard).toEqual(
      requestWithMenuKeyboard(
        { kind: "request_location", label: ar("rider.share_location_button") },
        "rider",
        "ar",
      ),
    );

    const pickup = await handleRiderUpdate(location(PICKUP), withRiders);
    // ADR 0170: طلبُ المُدخَلِ الأخيرِ يُسبَقُ ببيانِ الدفعِ، فالتوقُّعُ **اثنانِ**
    // بترتيبٍ لا رسالةٌ واحدةٌ: والترتيبُ ههنا هوَ ترتيبُ القراءةِ عندَ الراكبِ.
    expect(pickup[0]?.text).toBe(ar("rider.payment_notice"));
    expect(pickup[1]?.text).toBe(ar("rider.ask_dropoff"));

    const dropoff = await handleRiderUpdate(location(DROPOFF), withRiders);
    expect(waitingVariants("riderSearching", "ar")).toContain(dropoff[0]?.text ?? "");

    expect(rides.createCalls).toEqual([
      expect.objectContaining({
        service: "transport",
        origin: { lat: PICKUP.latitude, lng: PICKUP.longitude },
        destination: { lat: DROPOFF.latitude, lng: DROPOFF.longitude },
        notes: null,
      }),
    ]);
  });

  it("يقبل /skip فيُنشئ الطلب بلا نقطة وصول", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const created = await handleRiderUpdate(text("/skip"), d);
    expect(waitingVariants("riderSearching", "ar")).toContain(created[0]?.text ?? "");
    expect(rides.createCalls[0]?.destination).toBeNull();
  });

  it("يرفض عنواناً نصياً مكان الموقع", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    const refused = await handleRiderUpdate(text("حي الصفا قرب المسجد"), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
    expect(rides.createCalls).toHaveLength(0);
  });

  it("يرفض زر خدمة قديماً أثناء انتظار موقع الانطلاق ولا يبدّل نوع الطلب", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });

    await handleRiderUpdate(text("/ride"), d);
    const stale = await handleRiderUpdate(callback("svc:delivery"), d);
    expect(stale[0]?.text).toBe(ar("common.unknown_command"));

    // لو قُبل الزرّ القديم لتحوّل السؤال إلى موقع استلام طرد؛ يبقى الطلب نقلاً.
    const pickup = await handleRiderUpdate(location(PICKUP), d);
    // ADR 0170: طلبُ المُدخَلِ الأخيرِ يُسبَقُ ببيانِ الدفعِ، فالتوقُّعُ **اثنانِ**
    // بترتيبٍ لا رسالةٌ واحدةٌ: والترتيبُ ههنا هوَ ترتيبُ القراءةِ عندَ الراكبِ.
    expect(pickup[0]?.text).toBe(ar("rider.payment_notice"));
    expect(pickup[1]?.text).toBe(ar("rider.ask_dropoff"));
  });

  it("يلغي تسجيل العميل غير المكتمل ويمحو جلسته", async () => {
    const d = build();
    await handleRiderUpdate(text("/start"), d);

    const cancelled = await handleRiderUpdate(text("/cancel"), d);
    expect(cancelled[0]?.text).toBe(ar("common.cancelled"));
    // كان يثبّت `{kind:"remove"}`. والسلوك تغيّر عمداً: عميلٌ ألغى تسجيله ناقصاً
    // أحوج الناس إلى طريق عودة وإلى زرّ الدعم، وإخلاء أسفل الشاشة يسلبه إيّاهما.
    expect(cancelled[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));

    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  it("يسمّي إلغاء مسودة طلب إلغاءً بدلاً من نفي طلب نشط", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);

    const cancelled = await handleRiderUpdate(text("/cancel"), d);
    expect(cancelled[0]?.text).toBe(ar("common.cancelled"));

    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  it("يرفض إحداثيات مستحيلة", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    const refused = await handleRiderUpdate(location({ latitude: 200, longitude: 39 }), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
    expect(rides.createCalls).toHaveLength(0);
  });

  it("يطلب التسجيل قبل /ride", async () => {
    const replies = await handleRiderUpdate(text("/ride"), deps);
    expect(replies[0]?.text).toBe(ar("rider.must_register_first"));
  });

  it("لا يعرض مدناً إن لم تكن هناك مدينة مفعَّلة", async () => {
    const d = build({ cities: cityDirectory([]) });
    await handleRiderUpdate(text("/start"), d);
    const replies = await handleRiderUpdate(text("سالم"), d);
    expect(replies[0]?.text).toBe(ar("common.no_active_city"));
  });
});

describe("الإلغاء", () => {
  it("يلغي الطلب النشط فعلاً", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const active = {
      orderId: ORDER_ID,
      service: "transport" as const,
      status: "searching",
      pickupLabel: null,
      dropoffLabel: "النسيم",
      createdAt: new Date("2026-08-11T05:29:00Z"),
    };
    const d = build({ riders, activeOrdersOf: async () => [active] });
    const replies = await handleRiderUpdate(text("/cancel"), d);
    // التأكيد يسمّي الطلب: «تم إلغاء طلبك» المجرّدة هي ما أوهم العميل في الإنتاج
    expect(replies[0]?.text).toContain("النسيم");
    expect(orders.cancellations).toEqual([ORDER_ID]);
  });

  /**
   * المرحلة ١١ — العيب P11-1: للرحلة نهايتان، إتمامٌ وإلغاء. وكان `onTripEnded`
   * له موضع نداءٍ واحد (حوار التقييم بـ`TRIP_COMPLETED`)، فالإلغاء كان يترك خريطة
   * العميل تتحرّك ورحلته ملغاة — و`TRIP_CANCELLED` كان سبباً مُعرّفاً ولا منتج له.
   */
  it("الإلغاء يُنهي تتبّع الرحلة بسببها الصحيح وقبل إبلاغ أحد", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const active = {
      orderId: ORDER_ID,
      service: "transport" as const,
      status: "matched",
      pickupLabel: null,
      dropoffLabel: "النسيم",
      createdAt: new Date("2026-08-11T05:29:00Z"),
    };
    const ended: { tripId: string; reason: string }[] = [];
    const d = build({
      riders,
      activeOrdersOf: async () => [active],
      tracking: {
        // `onFix` مسار السائق ولا شأن للإلغاء به — ووجوده هنا لأن المنفذ واحد.
        onFix: async () => {
          throw new Error("لا يُنادى في مسار الإلغاء");
        },
        onDutyEnded: async () => {
          throw new Error("لا يُنادى في مسار الإلغاء");
        },
        onTripEnded: async (tripId: string, reason: string) => {
          ended.push({ tripId, reason });
        },
      },
    });

    await handleRiderUpdate(text("/cancel"), d);

    expect(ended).toEqual([{ tripId: String(ORDER_ID), reason: "TRIP_CANCELLED" }]);
  });

  /**
   * والمنفذ اختياريٌّ قصداً: التتبّع عونٌ لا شرط، وإلغاءٌ يفشل لأن التتبّع غير
   * مركّب يحبس العميل في رحلةٍ لا يريدها — وهو أسوأ من خريطةٍ تبقى دقيقةً زائدة.
   */
  it("الإلغاء ينجح ولو لم يُركّب التتبّع أصلاً", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const active = {
      orderId: ORDER_ID,
      service: "transport" as const,
      status: "matched",
      pickupLabel: null,
      dropoffLabel: "النسيم",
      createdAt: new Date("2026-08-11T05:29:00Z"),
    };
    const replies = await handleRiderUpdate(
      text("/cancel"),
      build({ riders, activeOrdersOf: async () => [active] }),
    );
    expect(replies[0]?.text).toContain("النسيم");
    expect(orders.cancellations).toEqual([ORDER_ID]);
  });

  it("يخبر بعدم وجود طلب نشط ولا يستدعي الإلغاء", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const replies = await handleRiderUpdate(text("/cancel"), build({ riders }));
    expect(replies[0]?.text).toBe(ar("rider.no_active_order"));
    expect(orders.cancellations).toHaveLength(0);
  });
});

describe("المطابقة بعد الإنشاء", () => {
  it("ينشئ الطلب ويعلن البحث حتى لو لم يوجد سائق مؤهل الآن", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({ riders });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const replies = await handleRiderUpdate(text("/skip"), d);
    expect(waitingVariants("riderSearching", "ar")).toContain(replies[0]?.text ?? "");
    expect(rides.createCalls).toHaveLength(1);
  });

  it("يبثّ على سائق مؤهل عند وجوده", async () => {
    const riders = riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });
    const d = build({
      riders,
      matching: {
        ...deps.matching,
        candidates: candidateRepo([
          {
            driverId: "driver-1" as DriverId,
            cityId: JEDDAH.id,
            location: { latitude: 21.545, longitude: 39.175 },
            isAvailable: true,
            isVerified: true,
            isBlocked: false,
            ratingAverage: 4.8,
            ratingCount: 12,
            capabilities: [
              {
                driverId: "driver-1" as DriverId,
                cityId: JEDDAH.id,
                service: "transport",
                isEnabled: true,
              },
            ],
            subscription: {
              driverId: "driver-1" as DriverId,
              cityId: JEDDAH.id,
              plan: "transport",
              status: "active",
              trialEndsAt: null,
              currentPeriodEnd: new Date(NOW.getTime() + 86_400_000),
              cancelAtPeriodEnd: false,
            },
          },
        ]),
      },
    });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const replies = await handleRiderUpdate(text("/skip"), d);
    expect(waitingVariants("riderSearching", "ar")).toContain(replies[0]?.text ?? "");
  });
});

describe("مسار التوصيل في حوار العميل", () => {
  const REGISTERED = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

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

  function deliveryDeps(): RiderBotDependencies {
    return build({
      riders: riderDirectory(REGISTERED),
      matching: { ...deps.matching, orders: orderRepo([DELIVERY_ORDER]) },
    });
  }

  it("‏/start لعميل مسجَّل يعرض اختيار الخدمة لا موقع الانطلاق مباشرة", async () => {
    const d = deliveryDeps();
    const replies = await handleRiderUpdate(text("/start"), d);
    expect(replies[0]?.text).toBe(ar("rider.ask_service"));
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: ar("rider.service_transport"), data: "svc:transport" }],
        [{ label: ar("rider.service_delivery"), data: "svc:delivery" }],
        [{ label: ar("common.back_button"), data: "back:city" }],
      ],
    });
  });

  it("‏/delivery يمضي: استلام ← تسليم ← وصف الطرد ← طلب delivery بوصفه في notes", async () => {
    const d = deliveryDeps();

    const started = await handleRiderUpdate(text("/delivery"), d);
    expect(started[0]?.text).toBe(ar("rider.ask_parcel_pickup"));

    const pickup = await handleRiderUpdate(location(PICKUP), d);
    expect(pickup[0]?.text).toBe(ar("rider.ask_parcel_dropoff"));

    const dropoff = await handleRiderUpdate(location(DROPOFF), d);
    // ADR 0170: وصفُ الطردِ هوَ المُدخَلُ الأخيرُ في التوصيلِ، فيُسبَقُ بالبيانِ.
    expect(dropoff[0]?.text).toBe(ar("rider.payment_notice"));
    expect(dropoff[1]?.text).toBe(ar("rider.ask_parcel"));

    const done = await handleRiderUpdate(text("صندوق كتب متوسط"), d);
    expect(waitingVariants("riderSearchingDelivery", "ar")).toContain(done[0]?.text ?? "");

    expect(rides.createCalls).toEqual([
      expect.objectContaining({
        service: "delivery",
        origin: { lat: PICKUP.latitude, lng: PICKUP.longitude },
        destination: { lat: DROPOFF.latitude, lng: DROPOFF.longitude },
        notes: "صندوق كتب متوسط",
      }),
    ]);
  });

  it("زرّ svc:delivery يسلك نفس مسار /delivery", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/start"), d);
    const chosen = await handleRiderUpdate(callback("svc:delivery"), d);
    expect(chosen[0]?.text).toBe(ar("rider.ask_parcel_pickup"));
  });

  it("لا يقبل /skip في التوصيل: الوجهة ركن لا خيار", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const refused = await handleRiderUpdate(text("/skip"), d);
    expect(refused[0]?.text).toBe(ar("rider.delivery_dropoff_required"));
    expect(rides.createCalls).toHaveLength(0);
  });

  // WR-18 — قرار المالك: وصف الطرد اختياري، و/skip في خطوته ينشئ الطلب بلا وصف.
  it("يقبل /skip في خطوة وصف الطرد فينشئ طلب توصيل بلا وصف", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    const done = await handleRiderUpdate(text("/skip"), d);
    expect(waitingVariants("riderSearchingDelivery", "ar")).toContain(done[0]?.text ?? "");
    expect(rides.createCalls).toEqual([
      expect.objectContaining({
        service: "delivery",
        destination: { lat: DROPOFF.latitude, lng: DROPOFF.longitude },
        notes: null,
      }),
    ]);
  });

  it("يرفض وصف طرد قصيراً ويبقى في نفس الخطوة حتى يصحّ", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);

    const refused = await handleRiderUpdate(text("أب"), d);
    expect(refused[0]?.text).toBe(ar("rider.parcel_invalid"));
    expect(rides.createCalls).toHaveLength(0);

    const accepted = await handleRiderUpdate(text("كيس ملابس"), d);
    expect(waitingVariants("riderSearchingDelivery", "ar")).toContain(accepted[0]?.text ?? "");
    expect(rides.createCalls).toHaveLength(1);
  });

  it("يرفض وصفاً أطول من الحد ولا ينشئ طلباً", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    const refused = await handleRiderUpdate(text("ط".repeat(201)), d);
    expect(refused[0]?.text).toBe(ar("rider.parcel_too_long"));
    expect(rides.createCalls).toHaveLength(0);
  });

  it("يرفض نصاً مكان موقع التسليم", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const refused = await handleRiderUpdate(text("حي الصفا"), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
  });

  it("‏/ride يبقى مسار نقل خالصاً بلا وصف طرد", async () => {
    const d = deliveryDeps();
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    expect(rides.createCalls[0]?.service).toBe("transport");
    expect(rides.createCalls[0]?.notes).toBeNull();
  });
});

/**
 * البند 2.2 — «أين طلبي؟ / أين سائقي؟». كل حالة هنا شكوى حقيقية محتملة:
 * سائق أُسنِد ولا يعرف العميل كيف يميّزه، وانتظارٌ طال بلا أداة فعل، وطلبان
 * نشطان يُعرض أحدهما فيُحسب الآخر منتهياً.
 */
describe("تتبّع الطلب: /status", () => {
  const RIDER = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const active = (overrides: Partial<ActiveOrderSummary> = {}): ActiveOrderSummary => ({
    orderId: ORDER_ID,
    service: "transport",
    status: "searching",
    pickupLabel: null,
    dropoffLabel: "حي الصفا",
    createdAt: new Date(NOW.getTime() - 4 * 60_000),
    assignedDriver: null,
    ...overrides,
  });

  const statusDeps = (orders: readonly ActiveOrderSummary[]) =>
    build({ riders: riderDirectory(RIDER), activeOrdersOf: async () => orders });

  it("يطلب التسجيل من غير المسجَّل ولا يقرأ طلبات أصلاً", async () => {
    let reads = 0;
    const d = build({
      activeOrdersOf: async () => {
        reads += 1;
        return [];
      },
    });
    const replies = await handleRiderUpdate(text("/status"), d);
    expect(replies[0]?.text).toBe(ar("rider.must_register_first"));
    expect(reads).toBe(0);
  });

  /**
   * «لا يوجد طلب» تُرسل بلوحة **بلا** زرّ تتبّع: من انتهى طلبه وبقيت لوحته
   * القديمة معروضة يُصحَّح معروضُه بنفس الردّ، فلا يبقى زرّ يسأل عن لا شيء.
   */
  it("يقول لا يوجد طلب، ويسحب زرّ التتبّع من اللوحة", async () => {
    const replies = await handleRiderUpdate(text("/status"), statusDeps([]));
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(
      // البند 6.3: يدلّ على الزرّين المعروضين أمامه لا على أمرين عليه أن يكتبهما
      ar("rider.status_none", {
        delivery_button: ar("menu.rider.delivery"),
        ride_button: ar("menu.rider.ride"),
      }),
    );
    expect(replies[0]?.text).toContain(ar("menu.rider.ride"));
    expect(replies[0]?.text).not.toContain("/ride");
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  it("في البحث: يقول لم يُسنَد أحد بعد ولا يخترع سائقاً", async () => {
    const replies = await handleRiderUpdate(text("/status"), statusDeps([active()]));
    expect(replies).toHaveLength(1);
    const body = replies[0]?.text ?? "";
    // سطرُ «ما زلنا نبحث» يتغيّر مع دِلاء الانتظار، فالمُثبَت أنّه من عائلته
    expect(waitingVariants("riderStillSearching", "ar").some((line) => body.includes(line))).toBe(
      true,
    );
    expect(body).toContain(ar("rider.status_waiting", { minutes: 4 }));
    // لا سطر سائق ولا لوحة مركبة حين لا سائق
    expect(body).not.toContain(ar("rider.status_driver", { name: "" }).trim());
    expect(replies[0]?.photoFileId).toBeUndefined();
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }));
  });

  /**
   * جوهر البند: الاسم وحده لا يميّز سيارةً على رصيف مزدحم. اللوحة وصورة
   * المركبة هما ما يُعرَف به السائق فعلاً حين يصل.
   */
  it("عند الإسناد: يعرض الاسم واللوحة وصورة المركبة تعليقاً على التقرير", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([
        active({
          status: "matched",
          assignedDriver: {
            fullName: "أحمد العمري",
            vehicleType: "سيدان",
            plateNumber: "ح ط ب 1234",
            vehiclePhotoFileId: "photo-1",
          },
        }),
      ]),
    );
    expect(replies).toHaveLength(1);
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.status_matched"));
    expect(body).toContain(ar("rider.status_driver", { name: "أحمد العمري" }));
    expect(body).toContain(ar("rider.status_plate", { plate: "ح ط ب 1234" }));
    expect(body).toContain(ar("rider.status_vehicle", { vehicle: "سيدان" }));
    // صورة واحدة مع التقرير لا رسالة ثانية تفترق عنه في محادثة مزدحمة
    expect(replies[0]?.photoFileId).toBe("photo-1");
  });

  it("لوحة ناقصة تُقال صراحة ولا تُسكت", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([
        active({
          status: "matched",
          assignedDriver: {
            fullName: "أحمد العمري",
            vehicleType: null,
            plateNumber: "   ",
            vehiclePhotoFileId: null,
          },
        }),
      ]),
    );
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.status_plate_missing"));
    expect(replies[0]?.photoFileId).toBeUndefined();
  });

  /**
   * انتظار طال: الدلالة على الدعم تأتي من البوت لا من صبر العميل. الحدّ 15 دقيقة،
   * وما دونه لا يُقلق أحداً بلا سبب.
   */
  it("يدلّ على الدعم متى طال الانتظار، ولا يفعل قبل ذلك", async () => {
    const long = await handleRiderUpdate(
      text("/status"),
      statusDeps([active({ createdAt: new Date(NOW.getTime() - 21 * 60_000) })]),
    );
    expect(long[0]?.text).toContain(ar("rider.status_waiting_long", { minutes: 21 }));

    const short = await handleRiderUpdate(
      text("/status"),
      statusDeps([active({ createdAt: new Date(NOW.getTime() - 14 * 60_000) })]),
    );
    expect(short[0]?.text).toContain(ar("rider.status_waiting", { minutes: 14 }));
    expect(short[0]?.text).not.toContain(ar("rider.status_waiting_long", { minutes: 14 }));
  });

  it("ساعة قاعدة تسبق ساعتنا لا تُنتج انتظاراً سالباً", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([active({ createdAt: new Date(NOW.getTime() + 5_000) })]),
    );
    expect(replies[0]?.text).toContain(ar("rider.status_waiting", { minutes: 0 }));
  });

  /**
   * من له مشوار وطرد معاً ورأى حالة أحدهما وحده يحسب الآخر منتهياً — وهي نفس
   * العلّة التي وقعت في /cancel.
   */
  it("يعرض كل طلب نشط لا الأحدث وحده، واللوحة مع الأخير", async () => {
    const second = active({
      orderId: "order-2" as OrderId,
      service: "delivery",
      status: "matched",
    });
    const replies = await handleRiderUpdate(text("/status"), statusDeps([active(), second]));
    expect(replies).toHaveLength(2);
    expect(replies[0]?.keyboard).toBeNull();
    expect(replies[1]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }));
    expect(replies[0]?.text).toContain(ar("rider.service_transport"));
    expect(replies[1]?.text).toContain(ar("rider.service_delivery"));
  });

  /**
   * المرحلة ١١ — العيب P11-5: كان التقرير يقول من السائق وماذا يركب، ولا
   * يقول أين هو — والموقع مخزّنٌ في القاعدة والمسافة تُحسب في الإسناد.
   */
  it("عند الإسناد مع موقع طازج: يُعرض بعد السائق بلا تحفّز وبلا وقتٍ متوقّع", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([
        active({
          status: "matched",
          pickup: { lat: 21.5433, lng: 39.1728 },
          dropoff: { lat: 21.6003, lng: 39.1502 },
          assignedDriver: {
            fullName: "أحمد",
            vehicleType: null,
            plateNumber: "ح ط ب 1234",
            vehiclePhotoFileId: null,
            // نحو ١.٦ كم شمال موضع الانطلاق، مسجّلٌ قبل عشر ثوانٍ.
            lastLocation: {
              lat: 21.5578,
              lng: 39.1728,
              recordedAt: new Date(NOW.getTime() - 10_000),
            },
          },
        }),
      ]),
    );
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.status_distance_pickup_km", { km: "1.6" }));
    // ولا تحفّز لموقعٍ عمره عشر ثوانٍ: سطرٌ يُلازم كلّ تحديثٍ يُقرأ زخرفاً.
    expect(body).not.toContain("⚠️");
    /**
     * والنصّ يقول صراحةً إنّه خطٌّ مستقيم لا مسار طريق — والفحص مقصودٌ لا زائد:
     * الخطوة الطبيعيّة لمن يرى مسافةً أن يقسمها على سرعةٍ مفترضة ويقرأها وعداً
     * بالوصول. والوعد يحتاج مساراً من OSRM وهو غير موصول (خطر R-28)، ومرحلته ١٥.
     * فحذف التحفّز من النصّ ليس تجميلاً لغويّاً بل يُنشئ وعداً لم نلتزمه.
     */
    expect(body).toContain("خطّ مستقيم");
  });

  it("موقعٌ قديمٌ يُعرض ومعه تحفّزٌ صريح لا يُكتم ولا يُحجب الرقم", async () => {
    const withAge = async (secondsAgo: number) => {
      const replies = await handleRiderUpdate(
        text("/status"),
        statusDeps([
          active({
            status: "matched",
            pickup: { lat: 21.5433, lng: 39.1728 },
            assignedDriver: {
              fullName: "أحمد",
              vehicleType: null,
              plateNumber: null,
              vehiclePhotoFileId: null,
              lastLocation: {
                lat: 21.5578,
                lng: 39.1728,
                recordedAt: new Date(NOW.getTime() - secondsAgo * 1000),
              },
            },
          }),
        ]),
      );
      return replies[0]?.text ?? "";
    };

    // دون الدقيقة: بالثواني لا بـ«قبل دقيقة» — تقريبٌ لأعلى يُقلق بلا موجب.
    const short = await withAge(45);
    expect(short).toContain(ar("rider.status_location_stale_seconds", { seconds: 45 }));
    // والرقم يُعرض مع التحفّز لا بدلاً منه: حجبه يترك العميل بلا شيء.
    expect(short).toContain(ar("rider.status_distance_pickup_km", { km: "1.6" }));

    const long = await withAge(5 * 60 + 20);
    expect(long).toContain(ar("rider.status_location_stale_minutes", { minutes: 5 }));
    expect(long).not.toContain(ar("rider.status_location_stale_seconds", { seconds: 320 }));
  });

  it("سائقٌ مُسنَد بلا موقعٍ بعد: لا سطر مسافة ولا «غير معروف»", async () => {
    const replies = await handleRiderUpdate(
      text("/status"),
      statusDeps([
        active({
          status: "matched",
          pickup: { lat: 21.5433, lng: 39.1728 },
          assignedDriver: {
            fullName: "أحمد",
            vehicleType: null,
            plateNumber: "ح ط ب 1234",
            vehiclePhotoFileId: null,
            lastLocation: null,
          },
        }),
      ]),
    );
    const body = replies[0]?.text ?? "";
    // لا يُكتب سطرٌ ألبتّة — ومع ذلك يبقى التقرير كاملاً لا مقتوعاً.
    expect(body).not.toContain("📍");
    expect(body).toContain(ar("rider.status_driver", { name: "أحمد" }));
    expect(body).toContain(ar("rider.status_plate", { plate: "ح ط ب 1234" }));
    expect(body).toContain(ar("rider.status_waiting", { minutes: 4 }));
  });

  it("زرّ «أين طلبي؟» يصل إلى /status نصّاً بأي لغة مدعومة", async () => {
    const d = statusDeps([active()]);
    for (const label of [
      ar("menu.rider.status"),
      translate("en", "menu.rider.status"),
      translate("ur", "menu.rider.status"),
    ]) {
      const replies = await handleRiderUpdate(text(label), d);
      expect(replies[0]?.text).toContain(ar("rider.status_heading"));
    }
  });

  it("بدء البحث نفسه يعرض زرّ التتبّع فوراً، لا برسالة تالية", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const created = await handleRiderUpdate(text("/skip"), d);
    expect(waitingVariants("riderSearching", "ar")).toContain(created[0]?.text ?? "");
    expect(created[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }));
  });
});

/**
 * البند 4.3 في بوت العميل. طلب المشوار خطوتا موقع على الأقلّ، وهي اللحظة التي
 * كانت لوحة «أرسل موقعي» تمحو فيها القائمة الدائمة — فيبقى العميل بزرٍّ واحد
 * لا زرّ دعم ولا لغة، وهو نفسه من قد لا يقرأ العربية.
 */
describe("زرّ الدعم لا يغيب في أي حالة — بوت العميل", () => {
  const supportLabel = ar("menu.support");
  const RIDER = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const labelsOf = (keyboard: unknown): readonly string[] => {
    const board = keyboard as
      | { kind: string; rows?: string[][]; label?: string; menuRows?: string[][] }
      | null
      | undefined;
    if (board === null || board === undefined) return [];
    if (board.kind === "reply") return (board.rows ?? []).flat();
    if (board.kind === "request_location" || board.kind === "request_contact") {
      return [board.label ?? "", ...(board.menuRows ?? []).flat()];
    }
    return [];
  };

  it("طلب موقع الانطلاق يُبقي زرّ الدعم معروضاً", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    const asked = await handleRiderUpdate(text("/ride"), d);
    expect(labelsOf(asked[0]?.keyboard)).toContain(supportLabel);
  });

  it("مسار التوصيل كذلك — لا فرق بين خدمة وخدمة في الوصول إلى الدعم", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    const asked = await handleRiderUpdate(text("/delivery"), d);
    expect(labelsOf(asked[0]?.keyboard)).toContain(supportLabel);
  });

  it("عنوان نصّي مكان الموقع يُرفض والقائمة باقية على جهازه", async () => {
    const d = build({ riders: riderDirectory(RIDER) });
    await handleRiderUpdate(text("/ride"), d);
    const refused = await handleRiderUpdate(text("حي الصفا"), d);
    expect(refused[0]?.text).toBe(ar("rider.location_required"));
  });

  it("‏/support من غير مسجَّل يردّ بالقائمة لا بنصّ عارٍ", async () => {
    const d = build({ support: { sessions: deps.sessions } as SupportDialogDependencies });
    const replies = await handleRiderUpdate(text("/support"), d);
    expect(replies[0]?.text).toBe(ar("support.not_registered"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  /** ضغطة واحدة وسط انتظار الموقع: لا تُقرأ نصّاً فتُرفض بـ«الموقع مطلوب». */
  it("زرّ الدعم وسط انتظار الموقع يفتح الدعم لا يُرفض كعنوان", async () => {
    const d = build({
      riders: riderDirectory(RIDER),
      support: { sessions: deps.sessions } as SupportDialogDependencies,
    });
    await handleRiderUpdate(text("/ride"), d);
    const pressed = await handleRiderUpdate(text(supportLabel), d);
    expect(pressed[0]?.text).toBe(ar("support.ask_message"));
    expect(pressed[0]?.text).not.toBe(ar("rider.location_required"));
  });
});

/**
 * البند 6.3 — `/help` يعرض الأوامر أزراراً، ومصدرها واحد مع القائمة الدائمة.
 *
 * العطب الذي كان: نصّ `rider.help` قائمةُ أوامرٍ مكتوبة يداً، لم تذكر «الدعم / شكوى»
 * (أُضيف في 2.1) ولا «أين طلبي؟» (أُضيف في 2.2) — فمن لجأ إليه لم يعلم بهما.
 */
describe("لوحة /help — البند 6.3", () => {
  const HELP_RIDER = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const active = (): ActiveOrderSummary => ({
    orderId: ORDER_ID,
    service: "transport",
    status: "searching",
    pickupLabel: null,
    dropoffLabel: "حي الصفا",
    createdAt: new Date(NOW.getTime() - 4 * 60_000),
    assignedDriver: null,
  });

  const helpDeps = (orders: readonly ActiveOrderSummary[] = []) =>
    build({ riders: riderDirectory(HELP_RIDER), activeOrdersOf: async () => orders });

  it("وسمُ تلغرام الأرديُّ يبدأُ حوارَ الراكبِ بالأرديّةِ لا بالعربيّة", async () => {
    const deps = helpDeps();
    const replies = await handleRiderUpdate(
      {
        kind: "text",
        from: { telegramUserId: "503", chatId: "503", languageHint: "ur" },
        updateId: 1,
        text: "/help",
      },
      deps,
    );
    expect(replies[0]?.text).toBe(translate("ur", "rider.guide"));
  });

  it("يعرض أوامر العميل أزراراً inline لا نصّاً", async () => {
    const replies = await handleRiderUpdate(text("/help"), helpDeps());
    expect(replies).toHaveLength(3);
    // الردّ الأول شرحُ عمل البوت للراكب: خطوات الطلب وما يُنتظر منه
    expect(replies[0]?.text).toBe(ar("rider.guide"));
    expect(replies[1]?.keyboard).toEqual(helpKeyboard("rider", "ar"));

    const keyboard = replies[1]?.keyboard;
    if (keyboard?.kind !== "inline") throw new Error("لوحة /help يجب أن تكون inline");
    const labels = keyboard.rows.flat().map((button) => button.label);
    expect(labels).toContain(ar("menu.support"));
    expect(labels).toContain(ar("menu.rider.ride"));
    expect(replies[1]?.text).not.toContain("/ride");
  });

  it("زرّ التتبّع يظهر في /help متى كان للعميل طلب نشط وحده", async () => {
    // نفس شرط القائمة الدائمة: زرٌّ يسأل عن طلب لا وجود له يربك لا يرشد
    const without = await handleRiderUpdate(text("/help"), helpDeps([]));
    const withOrder = await handleRiderUpdate(text("/help"), helpDeps([active()]));
    const labelsOf = (keyboard: unknown) => {
      const board = keyboard as { kind: string; rows: { label: string }[][] };
      return board.rows.flat().map((button) => button.label);
    };
    expect(labelsOf(without[1]?.keyboard)).not.toContain(ar("menu.rider.status"));
    expect(labelsOf(withOrder[1]?.keyboard)).toContain(ar("menu.rider.status"));
    expect(withOrder[2]?.keyboard).toEqual(
      mainMenuKeyboard("rider", "ar", { hasActiveOrder: true }),
    );
  });

  it("كل بند قائمة له زرّ ببياناته الصحيحة — فلا يتباعد المصدران", async () => {
    const replies = await handleRiderUpdate(text("/help"), helpDeps([active()]));
    const keyboard = replies[1]?.keyboard;
    if (keyboard?.kind !== "inline") throw new Error("لوحة /help يجب أن تكون inline");
    const data = keyboard.rows.flat().map((button) => button.data);
    for (const item of allItemsFor("rider")) expect(data).toContain(`cmd:${item.command}`);
  });

  it("ضغط زرّ أمرٍ يمرّ بنفس موجّه الأوامر — /status يردّ بحالة الطلب", async () => {
    const replies = await handleRiderUpdate(callback("cmd:/status"), helpDeps([active()]));
    expect(replies[0]?.text).toContain(ar("rider.status_heading"));
  });

  it("زرّ بأمرٍ ليس من أوامر العميل يُرفض ولا يُنفَّذ", async () => {
    // callback_data يأتي من جهاز المستخدم، فزرٌّ مصنوع بيده لا ينادي أوامر بوت السائق
    const replies = await handleRiderUpdate(callback("cmd:/available"), helpDeps());
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });
});

/**
 * البند 5 — «طلباتي السابقة».
 *
 * العطب الذي أوجبها: دورة الطلب كانت تنتهي بلا أثر يراه العميل. من أُلغي طلبه أو
 * اكتمل لا يجد في البوت شيئاً يقول «هذا ما جرى»، فسؤال «متى كانت رحلتي؟» أو
 * «هل أُلغي طلبي فعلاً؟» لا جواب له إلّا الدعم — وهو أغلى قناةٍ لأرخص سؤال.
 */
describe("سجلّ الطلبات: /history", () => {
  const RIDER = {
    id: "rider-h" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  const past = (overrides: Partial<PastOrderSummary> = {}): PastOrderSummary => ({
    orderId: ORDER_ID,
    service: "transport",
    status: "completed",
    pickupLabel: null,
    dropoffLabel: "حي الصفا",
    createdAt: new Date(NOW.getTime() - 3 * 3_600_000),
    endedAt: new Date(NOW.getTime() - 2 * 3_600_000),
    driverName: "خالد",
    ratingStars: 5,
    ...overrides,
  });

  const historyDeps = (rows: readonly PastOrderSummary[]) =>
    build({ riders: riderDirectory(RIDER), pastOrdersOf: async () => rows });

  it("زرّ «طلباتي السابقة» يُترجَم أمراً، فلا يردّ البوت «لم أفهم»", async () => {
    // لوحة الردّ الدائمة ترسل نصّ الزرّ حرفياً؛ زرٌّ بلا مترجِم يبدو عطباً
    const item = allItemsFor("rider").find((entry) => entry.command === "/history");
    expect(item?.key).toBe("menu.rider.history");
    const replies = await handleRiderUpdate(text(ar("menu.rider.history")), historyDeps([]));
    expect(replies[0]?.text).toBe(ar("rider.history_empty"));
  });

  it("سجلٌّ فارغ يُقال صراحةً ومعه القائمة لا رسالة عارية", async () => {
    const replies = await handleRiderUpdate(text("/history"), historyDeps([]));
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("rider.history_empty"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  it("غير المسجَّل يُوجَّه إلى التسجيل لا إلى سجلٍّ فارغ يضلّله", async () => {
    let touched = false;
    const replies = await handleRiderUpdate(
      text("/history"),
      build({
        pastOrdersOf: async () => {
          touched = true;
          return [];
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("rider.must_register_first"));
    // ولا يُستعلم عن سجلّ من لا معرّف له أصلاً
    expect(touched).toBe(false);
  });

  it("الطلب المكتمل يُعرض بوقته ووجهته وسائقه وتقييمه", async () => {
    const replies = await handleRiderUpdate(text("/history"), historyDeps([past()]));
    const body = replies[0]?.text ?? "";
    expect(body).toContain(ar("rider.history_heading"));
    expect(body).toContain(ar("rider.service_transport"));
    expect(body).toContain("حي الصفا");
    expect(body).toContain(ar("rider.history_completed"));
    expect(body).toContain(ar("rider.history_driver", { name: "خالد" }));
    expect(body).toContain(ar("rider.history_rated", { bar: "⭐⭐⭐⭐⭐" }));
    // التاريخ لا الساعة وحدها: السؤال الذي يُفتح لأجله السجلّ «متى كانت تلك الرحلة؟»
    expect(body).toContain("2026-08-06 10:00");
  });

  it("المكتمل بلا تقييم يُدعى إلى التقييم، والملغى لا يُدعى إلى تقييم رحلة لم تقع", async () => {
    const rated = await handleRiderUpdate(
      text("/history"),
      historyDeps([past({ ratingStars: null })]),
    );
    expect(rated[0]?.text).toContain(ar("rider.history_unrated"));

    const cancelled = await handleRiderUpdate(
      text("/history"),
      historyDeps([past({ status: "cancelled", driverName: null, ratingStars: null })]),
    );
    const body = cancelled[0]?.text ?? "";
    expect(body).toContain(ar("rider.history_cancelled"));
    expect(body).not.toContain(ar("rider.history_unrated"));
    expect(body).not.toContain(ar("rider.history_rated", { bar: "" }));
    // ولا اسم سائق لطلبٍ أُلغي قبل الإسناد
    expect(body).not.toContain("خالد");
  });

  it("النهاية تُقال بنصّ المستخدم لا بحالة القاعدة الخام", async () => {
    for (const status of ["completed", "cancelled", "failed"]) {
      const replies = await handleRiderUpdate(text("/history"), historyDeps([past({ status })]));
      expect(replies[0]?.text).not.toContain(status);
    }
  });

  it("لا نهاية بلا وقت: طلبٌ لم تُكتب له لحظة انتهاء يُعرض بوقت إنشائه", async () => {
    const replies = await handleRiderUpdate(
      text("/history"),
      historyDeps([past({ status: "cancelled", endedAt: null, ratingStars: null })]),
    );
    expect(replies[0]?.text).toContain("2026-08-06 09:00");
  });

  it("طلبات كثيرة تُعرض كلّها في رسالة واحدة لا رسالة لكلٍّ", async () => {
    const rows = [1, 2, 3].map((index) =>
      past({ orderId: `order-${index}` as OrderId, dropoffLabel: `حي ${index}` }),
    );
    const replies = await handleRiderUpdate(text("/history"), historyDeps(rows));
    expect(replies).toHaveLength(1);
    for (const label of ["حي 1", "حي 2", "حي 3"]) {
      expect(replies[0]?.text).toContain(label);
    }
  });
});

/**
 * `D-36` · `ADR 0194`: جلسةٌ **تعذَّرَت قراءتُها** ليست جلسةً **غائبةً**. المخزنُ ههنا
 * انقطاعٌ جزئيٌّ — القراءةُ تسقطُ والكتابةُ تمرُّ — وهوَ أسوأُ الصورِ: لو قُرِئَ الإخفاقُ
 * غياباً لكُتِبَت البدايةُ فوقَ جلسةٍ حقيقيّةٍ.
 */
describe("جلسةُ الراكبِ متعذِّرةُ القراءةِ — D-36", () => {
  function unreadableSessions() {
    const saves: unknown[] = [];
    return {
      saves,
      store: {
        load: async () => err(new PortFailureError("sessions", "redis unreachable")),
        save: async (_id: string, state: unknown) => {
          saves.push(state);
          return ok(undefined);
        },
        clear: async () => ok(undefined),
      },
    };
  }
  const registered = () =>
    riderDirectory({
      id: "rider-9" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "500",
      fullName: "سالم",
    });

  it("نقطةُ الموقعِ تُجابُ بعطلٍ صادقٍ لا بـ«لم أفهم» ولا تُكتَبُ جلسةٌ ولا طلبٌ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleRiderUpdate(
      location(PICKUP),
      build({ sessions: sessions.store, riders: registered() }),
    );
    expect(replies.map((r) => r.text)).toEqual([ar("common.error_try_again")]);
    expect(sessions.saves).toEqual([]);
    expect(rides.createCalls).toEqual([]);
  });

  it("زرُّ الخدمةِ (خطوةٌ) يُجابُ بعطلٍ صادقٍ ولا يُكتَبُ فوقَ الجلسةِ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleRiderUpdate(
      callback("svc:transport"),
      build({ sessions: sessions.store, riders: registered() }),
    );
    expect(replies.map((r) => r.text)).toEqual([ar("common.error_try_again")]);
    expect(sessions.saves).toEqual([]);
  });

  it("نصٌّ حرٌّ بلا تفاوضٍ يُجابُ بعطلٍ صادقٍ — لعلَّه اسمٌ أو وصفُ طردٍ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleRiderUpdate(
      text("سالم"),
      build({ sessions: sessions.store, riders: registered() }),
    );
    expect(replies.map((r) => r.text)).toEqual([ar("common.error_try_again")]);
    expect(sessions.saves).toEqual([]);
  });

  it("الأمرُ الصريحُ يبقى يعملُ: نيّةُ المستخدمِ لا تحتاجُ طورَه", async () => {
    const sessions = unreadableSessions();
    const replies = await handleRiderUpdate(text("/start"), build({ sessions: sessions.store }));
    expect(replies[0]?.text).not.toBe(ar("common.error_try_again"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("rider", "ar"));
  });

  it("الغيابُ الصادقُ باقٍ على حالِه: موقعٌ بلا جلسةٍ ليس عطلاً", async () => {
    const replies = await handleRiderUpdate(location(PICKUP), build({ riders: registered() }));
    expect(replies.map((r) => r.text)).toEqual([ar("common.unknown_command")]);
  });
});

/**
 * `F16-01` — `/rating` في بوت الراكبِ: السمعةُ ليست حكراً على السائقين — السائقُ
 * يقيّمُ الراكبَ أيضاً (`get-reputation-summary.ts` بلا نداءٍ قبلَ هذا البندِ).
 */
describe("بطاقة السمعة — /rating (الراكب)", () => {
  it("يعرض الملخص كزبون مع التقييمات المستلمة من سائقين", async () => {
    const replies = await handleRiderUpdate(
      text("/rating"),
      build({
        reputation: {
          summaryFor: async () =>
            ok({
              asDriver: null,
              asRider: { average: 4.25, count: 4 },
              received: [{ stars: 4, direction: "driver_to_rider", comment: null, createdAt: NOW }],
            }),
        },
      }),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain(ar("reputation.heading"));
    expect(replies[0]?.text).toContain(ar("reputation.as_rider", { average: "4.3", count: "4" }));
    expect(replies[0]?.text).toContain(ar("reputation.as_driver.empty"));
    expect(replies[0]?.text).toContain(ar("reputation.from_driver"));
  });

  it("لا تقييمات: جواب واحد صريح", async () => {
    const replies = await handleRiderUpdate(
      text("/rating"),
      build({
        reputation: { summaryFor: async () => ok(null) },
      }),
    );
    expect(replies[0]?.text).toBe(ar("reputation.empty"));
  });

  it("غياب المنفذ: أمر غير معروف", async () => {
    const replies = await handleRiderUpdate(text("/rating"), build());
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });
});

describe("طلبٌ جديدٌ وللراكبِ طلبٌ قائم (جرد الترجمات 2026-10-12)", () => {
  const REGISTERED = {
    id: "rider-9" as RiderId,
    cityId: JEDDAH.id,
    telegramUserId: "500",
    fullName: "سالم",
  };

  function refusingDeps(): RiderBotDependencies {
    const refusing = rideRequestCommand(ORDER_ID);
    return build({
      riders: riderDirectory(REGISTERED),
      rides: {
        ...refusing,
        create: async () =>
          ok({
            accepted: false as const,
            refusal: "ACTIVE_RIDE_EXISTS" as const,
            activeRide: { orderId: "existing-order", status: "searching" as const },
          }),
      },
    });
  }

  const expected = () =>
    ar("rider.already_searching", {
      status_button: ar("menu.rider.status"),
      cancel_button: ar("menu.rider.cancel"),
    });

  it("الرحلةُ: يُقالُ النصُّ بزرَّي المتابعةِ والإلغاءِ لا المفتاحُ الخامُ ولا معرّفُ الطلب", async () => {
    const d = refusingDeps();
    await handleRiderUpdate(text("/ride"), d);
    await handleRiderUpdate(location(PICKUP), d);
    const refused = await handleRiderUpdate(location(DROPOFF), d);
    const said = refused[0]?.text ?? "";
    expect(said).toBe(expected());
    expect(said).not.toContain("rider.already_searching");
    expect(said).not.toContain("existing-order");
    expect(said).toContain(ar("menu.rider.status"));
    expect(said).toContain(ar("menu.rider.cancel"));
  });

  it("التوصيلُ: الرفضُ نفسُه بالنصِّ نفسِه", async () => {
    const d = refusingDeps();
    await handleRiderUpdate(text("/delivery"), d);
    await handleRiderUpdate(location(PICKUP), d);
    await handleRiderUpdate(location(DROPOFF), d);
    const refused = await handleRiderUpdate(text("/skip"), d);
    expect(refused[0]?.text).toBe(expected());
  });

  it("الإنجليزيّةُ والأرديّةُ لهما نصٌّ لا المفتاحُ", () => {
    for (const lang of ["en", "ur"]) {
      const said = translate(lang, "rider.already_searching", {
        status_button: translate(lang, "menu.rider.status"),
        cancel_button: translate(lang, "menu.rider.cancel"),
      });
      expect(said).not.toContain("rider.already_searching");
      expect(said).not.toContain("{");
    }
  });
});
