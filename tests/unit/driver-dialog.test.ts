/**
 * الغرض: اختبار حوار بوت السائق من أول /start إلى قبول الطلب — بلا رمز بوت ولا شبكة.
 * الحالة: اختبار فعلي.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند وصل الحوار بمجموعات تلغرام يُضاف اختبار لبثّ بطاقة الطلب.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../packages/application/bots/driver-dialog.ts";
import {
  allItemsFor,
  helpKeyboard,
  mainMenuKeyboard,
  requestWithMenuKeyboard,
} from "../../packages/application/bots/main-menu.ts";
import type { SupportDialogDependencies } from "../../packages/application/bots/support-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import { waitingVariants } from "../../packages/application/bots/waiting-lines.ts";
import { PortFailureError } from "../../packages/application/ports/index.ts";
import type { PaymentTransactionId } from "../../packages/domain/financial/index.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { DriverId, OfferId, OrderId } from "../../packages/shared/kernel/index.ts";
import { err, ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  type DriverDirectoryDouble,
  driverDirectory,
  JEDDAH,
  MAKKAH,
  offerDecisionPort,
  subscriptionChangePort,
  subscriptionReader,
  trialPort,
  verifiedDriver,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };

const ar = (key: string, params: Record<string, string | number> = {}) =>
  translate("ar", key, params);

function text(value: string): IncomingUpdate {
  return { kind: "text", from: SENDER, updateId: 1, text: value };
}
function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, updateId: 1, data };
}
function photo(fileId: string): IncomingUpdate {
  return { kind: "photo", from: SENDER, updateId: 1, fileId, caption: null };
}
/** الخطوات الأربع التي صار التسجيل يمرّ بها بعد اختيار الخدمة. */
async function completeKyc(deps: DriverBotDependencies) {
  await handleDriverUpdate(callback("vehicle:sedan"), deps);
  await handleDriverUpdate(text("أ ب ج 1234"), deps);
  await handleDriverUpdate(text("1012345678"), deps);
  return handleDriverUpdate(photo("vphoto_900"), deps);
}
/** الافتراضي: البطاقة للمرسِل نفسه — وهو ما يفعله زرّ "مشاركة رقمي". */
function contact(
  phone: string,
  ownerTelegramId: string | null = SENDER.telegramUserId,
): IncomingUpdate {
  return { kind: "contact", from: SENDER, updateId: 1, phone, ownerTelegramId };
}

let drivers: DriverDirectoryDouble;
let deps: DriverBotDependencies;
let claims: { orderId: OrderId; driverId: DriverId }[];

function build(overrides: Partial<DriverBotDependencies> = {}): DriverBotDependencies {
  return { ...deps, ...overrides };
}

beforeEach(() => {
  drivers = driverDirectory(null);
  claims = [];
  deps = {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    drivers,
    cities: cityDirectory(),
    settings: settingsRepo([...seededRows(JEDDAH.id), ...seededRows(MAKKAH.id)]),
    subscriptions: subscriptionReader(null),
    trial: trialPort(true),
    dispatch: {
      claimRide: async (orderId, driverId) => {
        claims.push({ orderId, driverId });
        return ok({
          claimed: true,
          duplicate: false,
          reason: null,
          cityId: null,
          rider: null,
          driverName: null,
          driverPlate: null,
          driverVehicle: null,
        });
      },
    },
    offers: offerDecisionPort(),
    clock: fixedClock(NOW),
  };
});

describe("تسجيل السائق — المسار الكامل", () => {
  it("يمضي من /start إلى سائق مسجَّل في المدينة المختارة", async () => {
    const start = await handleDriverUpdate(text("/start"), deps);
    expect(start.map((r) => r.text)).toEqual([ar("driver.welcome"), ar("driver.ask_name")]);

    const name = await handleDriverUpdate(text("أحمد   العمري"), deps);
    expect(name[0]?.text).toBe(ar("driver.ask_phone"));
    // البند 4.3: زرّ الرقم ومعه القائمة تحته لا يمحوها
    expect(name[0]?.keyboard).toEqual(
      requestWithMenuKeyboard(
        { kind: "request_contact", label: ar("driver.share_phone_button") },
        "driver",
        "ar",
      ),
    );

    const phone = await handleDriverUpdate(contact("0501234567"), deps);
    expect(phone[0]?.text).toBe(ar("driver.ask_city"));
    expect(phone[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: "جدة", data: `city:${JEDDAH.id}` }],
        [{ label: "مكة", data: `city:${MAKKAH.id}` }],
      ],
    });

    const city = await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
    expect(city[0]?.text).toBe(ar("driver.ask_service"));

    const service = await handleDriverUpdate(callback("service:transport"), deps);
    // اختيار الخدمة لم يعد ينهي التسجيل: يليه الملفّ التوثيقي
    expect(service[0]?.text).toBe(ar("driver.ask_vehicle_type"));
    expect(drivers.registrations).toHaveLength(0);

    const done = await completeKyc(deps);
    expect(done[0]?.text).toBe(ar("driver.registered", { name: "أحمد العمري", city: "جدة" }));
    // مدة التجربة تأتي من platform_settings لا من ثابت في الكود
    expect(done[1]?.text).toBe(ar("driver.trial_started", { days: 30 }));

    expect(drivers.registrations).toEqual([
      {
        telegramUserId: "900",
        cityId: JEDDAH.id,
        fullName: "أحمد العمري",
        phone: "+966501234567",
        service: "transport",
      },
    ]);
  });

  it("يوحّد صيغة الجوال أياً كانت الصيغة المُدخَلة", async () => {
    for (const input of ["0501234567", "+966501234567", "966 50 123 4567", "50-123-4567"]) {
      drivers = driverDirectory(null);
      deps = build({ drivers, sessions: createMemorySessionStore(fixedClock(NOW)) });
      await handleDriverUpdate(text("/start"), deps);
      await handleDriverUpdate(text("أحمد العمري"), deps);
      await handleDriverUpdate(contact(input), deps);
      await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
      await handleDriverUpdate(callback("service:delivery"), deps);
      await completeKyc(deps);
      expect(drivers.registrations[0]?.phone).toBe("+966501234567");
    }
  });

  it("يرفض رقماً غير سعودي ولا ينتقل للخطوة التالية", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const bad = await handleDriverUpdate(contact("0301234567"), deps);
    expect(bad[0]?.text).toBe(ar("driver.phone_invalid"));
    const stillPhone = await handleDriverUpdate(contact("0501234567"), deps);
    expect(stillPhone[0]?.text).toBe(ar("driver.ask_city"));
  });

  it("يرفض رقماً مكتوباً بلا زرّ ويعيد عرض الزرّ", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const typed = await handleDriverUpdate(text("0501234567"), deps);
    expect(typed[0]?.text).toBe(ar("driver.phone_must_use_button"));
    expect(typed[0]?.keyboard?.kind).toBe("request_contact");
    // ولم ينتقل: الزرّ الحقيقي ما زال يعمل بعده
    const shared = await handleDriverUpdate(contact("0501234567"), deps);
    expect(shared[0]?.text).toBe(ar("driver.ask_city"));
  });

  it("يرفض بطاقة جهة اتصال لشخص آخر ولا يخزّن رقمها", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const forwarded = await handleDriverUpdate(contact("0509999999", "999999"), deps);
    expect(forwarded[0]?.text).toBe(ar("driver.phone_not_yours"));
    const shared = await handleDriverUpdate(contact("0501234567"), deps);
    expect(shared[0]?.text).toBe(ar("driver.ask_city"));
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), deps);
    await handleDriverUpdate(callback("service:delivery"), deps);
    await completeKyc(deps);
    expect(drivers.registrations[0]?.phone).toBe("+966501234567");
  });

  it("يرفض بطاقة بلا حساب تلغرام", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const manual = await handleDriverUpdate(contact("0501234567", null), deps);
    expect(manual[0]?.text).toBe(ar("driver.phone_not_yours"));
  });

  it("يرفض اسماً قصيراً أو أمراً مكان الاسم", async () => {
    await handleDriverUpdate(text("/start"), deps);
    expect((await handleDriverUpdate(text("أ"), deps))[0]?.text).toBe(ar("driver.name_too_short"));
    expect((await handleDriverUpdate(text("x".repeat(100)), deps))[0]?.text).toBe(
      ar("driver.name_too_long"),
    );
  });

  it("لا يقبل مدينة غير مفعَّلة حتى لو ضُغط زرّها", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    await handleDriverUpdate(contact("0501234567"), deps);
    const forged = await handleDriverUpdate(
      callback("city:99999999-9999-9999-9999-999999999999"),
      deps,
    );
    expect(forged[0]?.text).toBe(ar("common.no_active_city"));
    expect(drivers.registrations).toHaveLength(0);
  });

  it("لا يسجّل شيئاً إن كانت الجلسة قد ضاعت بين الخطوات", async () => {
    // ضغط زرّ الخدمة بلا مرور بأي خطوة قبله
    const orphan = await handleDriverUpdate(callback("service:transport"), deps);
    expect(orphan[0]?.text).toBe(ar("common.unknown_command"));
    expect(drivers.registrations).toHaveLength(0);
  });

  it("يخبر بأنه مسجَّل مسبقاً ولا يعيد التسجيل", async () => {
    const existing = verifiedDriver();
    const replies = await handleDriverUpdate(
      text("/start"),
      build({ drivers: driverDirectory(existing) }),
    );
    expect(replies[0]?.text).toBe(ar("driver.already_registered", { name: existing.fullName }));
  });

  it("يعلن سبب عدم بدء التجربة بدل الصمت", async () => {
    const withReason = build({ trial: trialPort(false, "already_used") });
    await handleDriverUpdate(text("/start"), withReason);
    await handleDriverUpdate(text("أحمد العمري"), withReason);
    await handleDriverUpdate(contact("0501234567"), withReason);
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), withReason);
    await handleDriverUpdate(callback("service:transport"), withReason);
    const done = await completeKyc(withReason);
    expect(done[1]?.text).toBe(ar("driver.trial_not_started", { reason: "already_used" }));
  });
});

describe("التوافر", () => {
  it("يمنع التوافر قبل تحقّق الإدارة", async () => {
    const unverified = driverDirectory(verifiedDriver({ isVerified: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers: unverified }));
    expect(replies[0]?.text).toBe(ar("driver.not_verified"));
    expect(unverified.availabilityCalls).toHaveLength(0);
  });

  it("يفعّل التوافر وينبّه إلى غياب الاشتراك", async () => {
    const verified = driverDirectory(verifiedDriver());
    const replies = await handleDriverUpdate(text("/available"), build({ drivers: verified }));
    // سطرُ الدخول إلى الخدمة يتغيّر بين نوبةٍ وأخرى، فالمُثبَت أنّه من عائلته لا نصُّه
    expect(waitingVariants("driverAvailable", "ar")).toContain(replies[0]?.text ?? "");
    expect(replies.map((r) => r.text).slice(1)).toEqual([
      // البند 6.3: النصّ يسمّي الزرّ بنصّه الحقيقي لا بأمرٍ مكتوب على السائق أن يتعلّمه
      ar("driver.no_live_subscription", { subscription_button: ar("menu.driver.subscription") }),
    ]);
    expect(replies[1]?.text).toContain(ar("menu.driver.subscription"));
    expect(replies[1]?.text).not.toContain("/subscription");
    expect(verified.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: true },
    ]);
  });

  it("لا ينبّه إلى الاشتراك إن كان سارياً", async () => {
    const live: Subscription = {
      driverId: "driver-1" as DriverId,
      cityId: JEDDAH.id,
      plan: "transport",
      status: "active",
      currentPeriodEnd: new Date(NOW.getTime() + 86_400_000),
    } as Subscription;
    const replies = await handleDriverUpdate(
      text("/available"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        subscriptions: subscriptionReader(live),
      }),
    );
    expect(replies).toHaveLength(1);
    expect(waitingVariants("driverAvailable", "ar")).toContain(replies[0]?.text ?? "");
  });

  /**
   * الحالة التي وقعت في الإنتاج فعلاً: سائقٌ موثَّق ومتاح ومشترك، و
   * `last_location = null`. فلم يصله طلبٌ واحد، وهو يظنّ نفسه عاملاً لأن
   * البوت قال له «أنت الآن متاح». واستعلام المرشّحين يشترط
   * `d.last_location is not null` فكان خفيّاً عن الإسناد تماماً.
   */
  it("لا يدّعي التوافر لمن لا موقع له، بل يقول الحقيقة ويطلب الموقع", async () => {
    const noLocation = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers: noLocation }));

    const texts = replies.map((r) => r.text);
    // الادّعاء الكاذب غائب — بأيّ صيغةٍ من صيغ «أنت متاح»
    for (const line of waitingVariants("driverAvailable", "ar")) {
      expect(texts).not.toContain(line);
    }
    // والحقيقة حاضرة أوّلاً
    expect(texts[0]).toBe(ar("driver.available_needs_location"));
    expect(texts).toContain(ar("driver.ask_location"));
    // والرغبة مسجَّلة رغم ذلك: فمتى وصل الموقع صار ظاهراً بلا أمرٍ جديد
    expect(noLocation.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: true },
    ]);
    // وزرّ الموقع مرفق لا مجرّد نصّ
    expect(replies.some((r) => r.keyboard?.kind === "request_location")).toBe(true);
  });

  it("وصول الموقع لمن كان متاحاً يُخبره أنه صار ظاهراً فعلاً", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false, isAvailable: true }));
    const replies = await handleDriverUpdate(
      {
        kind: "location",
        from: SENDER,
        updateId: 1,
        location: { latitude: 21.5433, longitude: 39.1728 },
      },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_saved_now_live"));
  });

  it("وصول الموقع لغير المتاح يبقى على الرسالة العادية", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false, isAvailable: false }));
    const replies = await handleDriverUpdate(
      {
        kind: "location",
        from: SENDER,
        updateId: 1,
        location: { latitude: 21.5433, longitude: 39.1728 },
      },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_saved"));
  });

  it("يوقف التوافر بلا شرط التحقّق", async () => {
    const unverified = driverDirectory(verifiedDriver({ isVerified: false }));
    const replies = await handleDriverUpdate(text("/unavailable"), build({ drivers: unverified }));
    expect(replies[0]?.text).toBe(ar("driver.now_unavailable"));
    expect(unverified.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: false },
    ]);
  });

  it("`WR-12` — زرُّ «اجعلني غير متوفر» في تذكيرِ الموقعِ يوقفُ التوافرَ بمسارِ /unavailable", async () => {
    const available = driverDirectory(verifiedDriver({ isAvailable: true }));
    const replies = await handleDriverUpdate(callback("avail:off"), build({ drivers: available }));
    expect(replies[0]?.text).toBe(ar("driver.now_unavailable"));
    expect(available.availabilityCalls).toEqual([
      { driverId: "driver-1" as DriverId, isAvailable: false },
    ]);
    // ولا يُفتحُ بابٌ لتشغيلِ التوافرِ ببيانٍ مصنوع.
    const forged = driverDirectory(verifiedDriver({ isAvailable: false }));
    const on = await handleDriverUpdate(callback("avail:on"), build({ drivers: forged }));
    expect(on[0]?.text).toBe(ar("common.unknown_command"));
    expect(forged.availabilityCalls).toEqual([]);
  });

  it("يطلب التسجيل من غير المسجَّل", async () => {
    const replies = await handleDriverUpdate(text("/available"), deps);
    expect(replies[0]?.text).toBe(ar("driver.must_register_first"));
  });
});

describe("القائمة الدائمة في حوار السائق", () => {
  it("ترافق الترحيب من أوّل رسالة", async () => {
    const start = await handleDriverUpdate(text("/start"), deps);
    expect(start[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  /**
   * لوحة الردّ ترسل **نصّ الزرّ حرفياً**، فبلا ترجمة قبل فحص الخطوة يُسجَّل
   * نصّ الزرّ اسماً للسائق في منتصف تسجيله — وهو ما يمنعه هذا الاختبار.
   */
  it("زرّ القائمة يعمل في منتصف التسجيل ولا يُسجَّل اسماً", async () => {
    await handleDriverUpdate(text("/start"), deps);

    const pressed = await handleDriverUpdate(text(ar("menu.driver.available")), deps);
    // وصل إلى /available فعلاً — لا «اسم غير صالح» ولا «لم أفهم هذه الرسالة»
    expect(pressed[0]?.text).toBe(ar("driver.must_register_first"));

    // والخطوة لم تتقدّم: لم يُأخذ نصّ الزرّ اسماً ويُسأل عن الهاتف
    const state = await deps.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value?.step).toBe("awaiting_name");
    expect(state.ok && state.value?.draftName).toBeNull();
  });

  it("يفهم زرّاً بلغة أخرى — لوحة قديمة باقية على جهاز السائق", async () => {
    const pressed = await handleDriverUpdate(text(translate("ur", "menu.driver.available")), deps);
    expect(pressed[0]?.text).toBe(ar("driver.must_register_first"));
  });
});

describe("الاشتراك", () => {
  it("يعرض السعر من platform_settings لا من قيمة مرمَّزة", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_none", { plan: "transport", price: 150, currency: "SAR" }),
    );
  });

  it("يتبع سعر المدينة عند اختلافه", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({
        drivers: driverDirectory(verifiedDriver({ cityId: MAKKAH.id })),
        settings: settingsRepo(seededRows(MAKKAH.id, { subscription_price_transport: 199 })),
      }),
    );
    expect(replies[0]?.text).toContain("199");
  });

  /**
   * البيع الذاتي — منصّةٌ كلّ دخلها اشتراكُ سائق كانت بطاقتُها تعرض السعر بلا زرٍّ
   * واحدٍ للدفع، فكان الدخل معلّقاً على تدخّلٍ يدويّ لكل سائق.
   */
  describe("زرّ الشراء", () => {
    function purchaseDouble(checkoutUrl: string | null = "https://pay.test/inv_1") {
      const state = { charges: 0, confirms: 0, keys: [] as string[], amounts: [] as number[] };
      const tx = {
        id: "tx-buy" as PaymentTransactionId,
        payerId: "driver-1" as DriverId,
        payeeId: "platform" as const,
        purpose: "driver_subscription" as const,
        amount: { amount: 15_000, currency: "SAR" },
        provider: "test-provider",
        providerTransactionId: null,
        status: "pending" as const,
        metadata: {} as Record<string, unknown>,
        createdAt: NOW,
        updatedAt: NOW,
      };
      const stored: { url: string | null } = { url: null };
      const payments = {
        create: async (input: { amount: { amount: number }; idempotencyKey: string }) => {
          state.keys.push(input.idempotencyKey);
          state.amounts.push(input.amount.amount);
          // المعاملة الثانية بنفس المفتاح موجودة سلفاً — كما تفعل create_payment.
          const already = state.keys.filter((k) => k === input.idempotencyKey).length > 1;
          return ok({
            transaction: { ...tx, metadata: already ? { checkout_url: stored.url } : {} },
            alreadyExists: already,
          });
        },
        findById: async () => ok(null),
        findByIdempotencyKey: async (key: string) =>
          ok(state.keys.includes(key) ? { ...tx, metadata: { checkout_url: stored.url } } : null),
        recordCheckoutUrl: async (input: { checkoutUrl: string }) => {
          stored.url ??= input.checkoutUrl;
          return ok({ checkoutUrl: stored.url });
        },
        confirmPayment: async () => {
          state.confirms += 1;
          return err(new PortFailureError("payments", "UNUSED"));
        },
      };
      const provider = {
        name: "test-provider",
        chargeSubscription: async () => {
          state.charges += 1;
          return ok({ providerTransactionId: null, checkoutUrl, status: "pending" as const });
        },
        verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
        fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
      };
      return {
        purchase: { payments, provider } as unknown as NonNullable<
          DriverBotDependencies["subscriptionPurchase"]
        >,
        state,
      };
    }

    it("لا يظهر زرّ الشراء بلا مزوّد دفع مركّب", async () => {
      const replies = await handleDriverUpdate(
        text("/subscription"),
        build({ drivers: driverDirectory(verifiedDriver()) }),
      );
      expect(replies[0]?.keyboard ?? null).toBeNull();
    });

    it("يظهر زرّ الشراء عند تركيب المزوّد", async () => {
      const { purchase } = purchaseDouble();
      const replies = await handleDriverUpdate(
        text("/subscription"),
        build({ drivers: driverDirectory(verifiedDriver()), subscriptionPurchase: purchase }),
      );
      expect(JSON.stringify(replies[0]?.keyboard)).toContain("sub:buy:transport");
    });

    it("يعيد رابط الدفع بالسعر المقروء من المدينة بالوحدة الصغرى", async () => {
      const { purchase, state } = purchaseDouble();
      const replies = await handleDriverUpdate(
        callback("sub:buy:transport"),
        build({ drivers: driverDirectory(verifiedDriver()), subscriptionPurchase: purchase }),
      );
      expect(replies[0]?.text).toContain("https://pay.test/inv_1");
      // ١٥٠ ريالاً = ١٥٠٠٠ هلّة؛ تمريرُ ١٥٠ كان سيبيع اشتراكاً بريال ونصف.
      expect(state.amounts[0]).toBe(15_000);
    });

    it("لا يُفعِّل الاشتراك من البوت: لا تأكيد دفعٍ ولا اشتراكٌ سارٍ في الردّ", async () => {
      const { purchase, state } = purchaseDouble();
      const replies = await handleDriverUpdate(
        callback("sub:buy:transport"),
        build({ drivers: driverDirectory(verifiedDriver()), subscriptionPurchase: purchase }),
      );
      // زرٌّ في تلغرام لا يجوز أن يكون كافياً لتأكيد دفعةٍ لم تُدفع: التأكيد حقُّ
      // الويبهوك وحده بعد إعادة قراءة الدفعة من خادم المزوّد.
      expect(state.confirms).toBe(0);
      expect(replies[0]?.text).toBe(
        ar("driver.subscription_checkout", {
          plan: "transport",
          price: 150,
          currency: "SAR",
          url: "https://pay.test/inv_1",
        }),
      );
    });

    /**
     * الانحدار: ضغطتان — أو تحديثٌ يعيده تلغرام — كانتا ستُنشئان فاتورتين، ومن
     * دفعهما يخسر شهراً لأنّ `activate_subscription` يستبدل المدّة ولا يجمعها.
     */
    it("ضغطتان لا تُنشئان إلا فاتورةً واحدة، والثانية تستعيد الرابط نفسه", async () => {
      const { purchase, state } = purchaseDouble();
      const deps2 = build({
        drivers: driverDirectory(verifiedDriver()),
        subscriptionPurchase: purchase,
      });
      const first = await handleDriverUpdate(callback("sub:buy:transport"), deps2);
      const second = await handleDriverUpdate(callback("sub:buy:transport"), deps2);
      expect(state.charges).toBe(1);
      expect(new Set(state.keys).size).toBe(1);
      expect(second[0]?.text).toContain("https://pay.test/inv_1");
      expect(second[0]?.text).toBe(first[0]?.text);
    });

    it("لا يُبَع اشتراكٌ ثانٍ لمن اشتراكه سارٍ", async () => {
      const { purchase, state } = purchaseDouble();
      const live = {
        driverId: "driver-1" as DriverId,
        cityId: JEDDAH.id,
        plan: "transport",
        status: "active",
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      } as Subscription;
      const replies = await handleDriverUpdate(
        callback("sub:buy:transport"),
        build({
          drivers: driverDirectory(verifiedDriver()),
          subscriptions: subscriptionReader(live),
          subscriptionPurchase: purchase,
        }),
      );
      expect(state.charges).toBe(0);
      expect(replies[0]?.text).toBe(
        ar("driver.subscription_live", { plan: "transport", until: "2026-09-01" }),
      );
    });

    it("خطّة غير معروفة في الزرّ لا تُقرأ كما هي", async () => {
      const { purchase, state } = purchaseDouble();
      await handleDriverUpdate(
        callback("sub:buy:__evil__"),
        build({ drivers: driverDirectory(verifiedDriver()), subscriptionPurchase: purchase }),
      );
      expect(state.keys[0]).toContain(":transport:");
    });

    it("غياب رابط الدفع يقول ذلك ولا يزعم نجاحاً", async () => {
      const { purchase } = purchaseDouble(null);
      const replies = await handleDriverUpdate(
        callback("sub:buy:transport"),
        build({ drivers: driverDirectory(verifiedDriver()), subscriptionPurchase: purchase }),
      );
      expect(replies[0]?.text).toBe(ar("driver.subscription_checkout_pending"));
    });
  });

  it("يعرض تاريخ نهاية الاشتراك السارِي", async () => {
    const live = {
      driverId: "driver-1" as DriverId,
      cityId: JEDDAH.id,
      plan: "both",
      status: "active",
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    } as Subscription;
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        subscriptions: subscriptionReader(live),
      }),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_live", { plan: "both", until: "2026-09-01" }),
    );
  });
});

describe("قبول ورفض العرض", () => {
  it("القبول يمرّ عبر الدالة الذرّية ويعلن النجاح", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(claims).toEqual([{ orderId: "order-77" as OrderId, driverId: "driver-1" as DriverId }]);
    expect(replies[0]?.text).toBe(ar("driver.offer_accepted"));
  });

  it("إن سبقه غيره يعلن ذلك ولا يدّعي النجاح", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        dispatch: {
          claimRide: async () =>
            ok({
              claimed: false,
              duplicate: false,
              reason: "already_claimed",
              cityId: null,
              rider: null,
              driverName: null,
              driverPlate: null,
              driverVehicle: null,
            }),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("driver.offer_taken"));
  });

  /**
   * `BUG-008` — الفائزُ لا يُقالُ له «سبقك سائق آخر» عن إسنادٍ هو صاحبُه:
   * التسليمُ المكرَّرُ يُردُّ بنفسِ رسالةِ النجاحِ لا برسالةِ خسارةٍ كاذبة.
   */
  it("تسليمٌ مكرَّرٌ لنقرةِ الفائزِ يُردُّ نجاحاً لا «سبقك سائق آخر»", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        dispatch: {
          claimRide: async () =>
            ok({
              claimed: true,
              duplicate: true,
              reason: null,
              cityId: null,
              rider: null,
              driverName: null,
              driverPlate: null,
              driverVehicle: null,
            }),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("driver.offer_accepted"));
    expect(replies[0]?.text).not.toBe(ar("driver.offer_taken"));
  });

  it("يميّز انتهاء المهلة عن سبق سائق آخر", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        dispatch: {
          claimRide: async () =>
            ok({
              claimed: false,
              duplicate: false,
              reason: "offer_expired",
              cityId: null,
              rider: null,
              driverName: null,
              driverPlate: null,
              driverVehicle: null,
            }),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("driver.offer_expired"));
  });

  it("الرفض يُسجَّل فوراً ليخرج السائق من الدورة القادمة", async () => {
    const offers = offerDecisionPort();
    const replies = await handleDriverUpdate(
      callback("offer:reject:offer-77"),
      build({ drivers: driverDirectory(verifiedDriver()), offers }),
    );
    /**
     * `BUG-003` — الزرُّ يحمِلُ `offerId` لا `orderId`، فيُسجَّلُ الرفضُ على عرضٍ
     * بعينِه لا على كلِّ عرضٍ معلَّقٍ للسائقِ على الطلبِ.
     */
    expect(offers.rejections).toEqual([
      { offerId: "offer-77" as OfferId, driverId: "driver-1" as DriverId },
    ]);
    expect(replies[0]?.text).toBe(ar("driver.offer_rejected"));
  });

  /**
   * `WR-08` — مآلُ العرضِ يُكتَبُ على بطاقتِه نفسِها فتزولُ أزرارُ «قبول/رفض» القديمة،
   * ولا تبقى البطاقةُ كأنَّها عرضٌ متاح.
   */
  describe("WR-08 — مآلُ العرضِ على بطاقتِه", () => {
    const onCard = (data: string): IncomingUpdate => ({
      kind: "callback",
      from: SENDER,
      updateId: 1,
      data,
      messageId: "m-55",
    });
    const lost = (reason: string) => ({
      claimRide: async () =>
        ok({
          claimed: false,
          duplicate: false,
          reason,
          cityId: null,
          rider: null,
          driverName: null,
          driverPlate: null,
          driverVehicle: null,
        }),
    });

    it("الرفضُ يعدّلُ البطاقةَ بلا أزرار", async () => {
      const replies = await handleDriverUpdate(
        onCard("offer:reject:offer-77"),
        build({ drivers: driverDirectory(verifiedDriver()), offers: offerDecisionPort() }),
      );
      expect(replies).toHaveLength(1);
      expect(replies[0]?.text).toBe(ar("driver.offer_rejected"));
      expect(replies[0]?.editMessageId).toBe("m-55");
      expect(replies[0]?.keyboard ?? null).toBeNull();
    });

    it("الانتهاءُ والسبقُ والحجزُ تُكتَبُ على البطاقةِ نفسِها", async () => {
      for (const [reason, key] of [
        ["offer_expired", "driver.offer_expired"],
        ["already_claimed", "driver.offer_taken"],
        ["ORDER_HELD", "driver.offer_held"],
      ] as const) {
        const replies = await handleDriverUpdate(
          onCard("offer:accept:order-77"),
          build({ drivers: driverDirectory(verifiedDriver()), dispatch: lost(reason) }),
        );
        expect(replies[0]?.text).toBe(ar(key));
        expect(replies[0]?.editMessageId).toBe("m-55");
        expect(replies[0]?.keyboard ?? null).toBeNull();
      }
    });

    it("القبولُ الناجحُ يبدّلُ البطاقةَ بتأكيدِه", async () => {
      const replies = await handleDriverUpdate(
        onCard("offer:accept:order-77"),
        build({
          drivers: driverDirectory(verifiedDriver()),
          dispatch: {
            claimRide: async () =>
              ok({
                claimed: true,
                duplicate: false,
                reason: null,
                cityId: null,
                rider: null,
                driverName: null,
                driverPlate: null,
                driverVehicle: null,
              }),
          },
        }),
      );
      expect(replies[0]?.text).toBe(ar("driver.offer_accepted"));
      expect(replies[0]?.editMessageId).toBe("m-55");
    });

    it("بلا معرّفِ رسالةٍ يبقى الردُّ رسالةً جديدةً كما كان", async () => {
      const replies = await handleDriverUpdate(
        callback("offer:reject:offer-77"),
        build({ drivers: driverDirectory(verifiedDriver()), offers: offerDecisionPort() }),
      );
      expect(replies[0]?.editMessageId).toBeUndefined();
    });
  });

  it("زرّ بلا معرّف طلب يُرفض بلا استدعاء أي دالة", async () => {
    const replies = await handleDriverUpdate(
      callback("offer:accept:"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(claims).toHaveLength(0);
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });
});

describe("متانة الحوار", () => {
  it("عطل تقني يُبلَّغ برسالة واحدة واضحة لا باستثناء", async () => {
    const replies = await handleDriverUpdate(
      text("/start"),
      build({
        drivers: {
          ...driverDirectory(null),
          findByTelegramId: async () => ({
            ok: false as const,
            error: { code: "PORT_FAILURE" as const, port: "x", detail: "down" },
          }),
        } as DriverBotDependencies["drivers"],
      }),
    );
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });

  it("أمر مجهول لا يُسقط الحوار", async () => {
    expect((await handleDriverUpdate(text("/foo"), deps))[0]?.text).toBe(
      ar("common.unknown_command"),
    );
  });

  it("/cancel يمحو الجلسة فيعود /start من البداية ويُبقي القائمة الدائمة", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const cancelled = await handleDriverUpdate(text("/cancel"), deps);
    // كان هذا الاختبار يثبّت `{kind:"remove"}`. وتغيّر السلوك عمداً: إخلاء أسفل
    // الشاشة عند الإلغاء يسلب المستخدمَ زرَّ الدعم في أكثر لحظة يحتاجه فيها،
    // وهو ما ينقض مطلب «زرّ الدعم في كل الحالات» نصّاً. فالإلغاء رجوعٌ للقائمة.
    expect(cancelled[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
    // والمقصود الأصلي من الاختبار — محو الجلسة — يبقى مثبّتاً كما هو
    const again = await handleDriverUpdate(text("/start"), deps);
    expect(again[1]?.text).toBe(ar("driver.ask_name"));
  });

  it("لا يعيد زر نوع شكوى قديم فتح حوار ألغاه السائق", async () => {
    const d = build({
      drivers: driverDirectory(verifiedDriver()),
      // هذا المسار لا يستدعي منافذ الدعم الأخرى: يكفي مخزن الجلسة لإثبات الحراسة.
      support: { sessions: deps.sessions } as SupportDialogDependencies,
    });

    await handleDriverUpdate(text("/support"), d);
    await handleDriverUpdate(text("/cancel"), d);
    const stale = await handleDriverUpdate(callback("sup:type:subscription"), d);

    expect(stale[0]?.text).toBe(ar("common.unknown_command"));
    const state = await d.sessions.load(SENDER.telegramUserId);
    expect(state.ok && state.value).toBeNull();
  });

  it("يردّ بالإنجليزية إن كانت لغة عميل تلغرام إنجليزية", async () => {
    const english: IncomingUpdate = {
      kind: "text",
      from: { telegramUserId: "901", chatId: "901", languageHint: "en" },
      updateId: 1,
      text: "/help",
    };
    const replies = await handleDriverUpdate(english, deps);
    // الشرحُ أوّلاً ثم قائمةُ الأوامر — وكلاهما بلغة عميل تلغرام لا بالعربية
    expect(replies[0]?.text).toBe(translate("en", "driver.guide"));
    expect(replies[1]?.text).toBe(translate("en", "driver.help"));
  });

  // لغةُ البدايةِ تُقرأُ من الوسمِ الأوّلِ: كان `en` وحدَها، فصاحبُ تلغرامٍ أرديٍّ أو
  // `en-GB` يبدأُ بالعربيّةِ ويُسجَّلُ بها (`register({ language })` يقرأُ الجلسة).
  for (const [hint, expected] of [
    ["ur", "ur"],
    ["en-GB", "en"],
    ["UR", "ur"],
    ["fr", "ar"],
    ["", "ar"],
  ] as const) {
    it(`وسمُ تلغرام «${hint}» يبدأُ الحوارَ بـ«${expected}» ويحفظُها في الجلسة`, async () => {
      const update: IncomingUpdate = {
        kind: "text",
        from: { telegramUserId: "902", chatId: "902", languageHint: hint },
        updateId: 1,
        text: "/help",
      };
      const replies = await handleDriverUpdate(update, deps);
      expect(replies[0]?.text).toBe(translate(expected, "driver.guide"));
      const saved = await deps.sessions.load("902");
      if (saved.ok && saved.value !== null) expect(saved.value.language).toBe(expected);
    });
  }

  it("يحفظ موقع السائق المسجَّل فعلاً", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(
      {
        kind: "location",
        from: SENDER,
        updateId: 1,
        location: { latitude: 21.4, longitude: 39.2 },
      },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_saved"));
    expect(drivers.locationCalls).toEqual([
      { driverId: "driver-1" as DriverId, location: { latitude: 21.4, longitude: 39.2 } },
    ]);
  });

  /**
   * `BUG-001` — الطبقةُ التطبيقيّةُ تُطيعُ حكمَ القاعدةِ ولا تُنشئُ حكماً ثانياً.
   *
   * المزدوجُ لا يقارنُ طوابعَ (وإلّا صار حَكَماً ثانياً في الاختبارِ نفسِه): هو
   * يُعيدُ الحكمَ الذي تضبطُه الحالةُ. والمقيسُ أنّ إصلاحةً رفضَتها الكتابةُ
   * الشرطيّةُ لا تُنشَر ولا تُحرِّك إسناداً — لأنّ نشرَها إخراجُ موضعٍ أقدمَ من
   * المصدرِ القانونيِّ إلى الخريطةِ، أي التراجعُ الذي وُجِد الحارسُ ليمنعَه.
   */
  it("الإصلاحة التي رفضتها القاعدة لا تُبَثّ ولا تُعيد الإسناد", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: true, isAvailable: true }));
    drivers.locationOutcome = { kind: "stale" };
    const published: string[] = [];
    const redispatched: string[] = [];
    const replies = await handleDriverUpdate(
      {
        kind: "location",
        from: SENDER,
        updateId: 1,
        location: { latitude: 21.4, longitude: 39.2 },
      },
      build({
        drivers,
        tracking: {
          onFix: async (fix) => {
            published.push(fix.driverId);
          },
          onTripEnded: async () => {},
          onDutyEnded: async () => {},
        },
        redispatch: {
          onDriverBecameDispatchable: async (cityId) => {
            redispatched.push(cityId);
          },
        },
      }),
    );

    // الكتابةُ جرت ومرّت على الحارسِ — والحارسُ ردَّها
    expect(drivers.locationCalls).toHaveLength(1);
    // ولم يُنشَر شيءٌ ولم يُعَد إسنادٌ
    expect(published).toEqual([]);
    expect(redispatched).toEqual([]);
    // ولا رسالةَ عطلٍ: لم يقع عطلٌ، وموقعُه المعروفُ أحدثُ من نبضتِه هذه
    expect(replies[0]?.text).toBe(ar("driver.location_saved"));
  });

  it("لا يحفظ موقعاً لغير مسجَّل", async () => {
    const drivers = driverDirectory(null);
    const replies = await handleDriverUpdate(
      {
        kind: "location",
        from: SENDER,
        updateId: 1,
        location: { latitude: 21.4, longitude: 39.2 },
      },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.must_register_first"));
    expect(drivers.locationCalls).toHaveLength(0);
  });

  it("يرفض إحداثيات مستحيلة ولا يكتبها", async () => {
    const drivers = driverDirectory(verifiedDriver());
    const replies = await handleDriverUpdate(
      { kind: "location", from: SENDER, updateId: 1, location: { latitude: 999, longitude: 39.2 } },
      build({ drivers }),
    );
    expect(replies[0]?.text).toBe(ar("driver.location_invalid"));
    expect(drivers.locationCalls).toHaveLength(0);
  });

  it("يطلب الموقع عند /available من سائق بلا موقع", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers }));
    expect(replies.map((r) => r.text)).toContain(ar("driver.ask_location"));
    expect(replies[1]?.keyboard).toEqual(
      requestWithMenuKeyboard(
        { kind: "request_location", label: ar("driver.share_location_button") },
        "driver",
        "ar",
      ),
    );
  });
});

/**
 * البند 4.3 — الدعم بضغطة واحدة في كل الحالات. المطلب ليس وجود زرّ في القائمة
 * (ذاك أُنجز في 2.1) بل **بقاؤه معروضاً**: لوحة الردّ في تلغرام واحدة لا تتراكم،
 * فكل لوحة طلبِ رقم أو موقع أو إزالةٍ كانت تمحو القائمة — ومعها زرّ الدعم —
 * في الخطوات الطويلة نفسها التي يتعثّر فيها المستخدم فيحتاج الدعم.
 */
describe("زرّ الدعم لا يغيب في أي حالة — بوت السائق", () => {
  const supportLabel = ar("menu.support");

  /** كل نصوص الأزرار المعروضة في لوحة ردّ واحدة، أيّاً كان نوعها. */
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

  it("خطوة الرقم تُبقي زرّ الدعم — وهي أكثر مواضع تعثّر السائق الجديد", async () => {
    await handleDriverUpdate(text("/start"), deps);
    const asked = await handleDriverUpdate(text("أحمد العمري"), deps);
    expect(labelsOf(asked[0]?.keyboard)).toContain(supportLabel);
  });

  it("رقم مكتوب بلا زرّ يُرفض والقائمة باقية", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const typed = await handleDriverUpdate(text("0501234567"), deps);
    expect(typed[0]?.text).toBe(ar("driver.phone_must_use_button"));
    expect(labelsOf(typed[0]?.keyboard)).toContain(supportLabel);
  });

  it("طلب الموقع عند /available يُبقي زرّ الدعم", async () => {
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false }));
    const replies = await handleDriverUpdate(text("/available"), build({ drivers }));
    expect(labelsOf(replies[1]?.keyboard)).toContain(supportLabel);
  });

  /**
   * «لا مدينة عاملة» خللٌ تشغيلي عندنا لا خطأ من السائق، وكان يُرسَل مع إزالة
   * اللوحة — فيبقى في شاشة خالية بلا طريق شكوى من عطلٍ ليس من فعله.
   */
  it("غياب المدن العاملة لا يُخلي أسفل الشاشة", async () => {
    await handleDriverUpdate(text("/start"), deps);
    await handleDriverUpdate(text("أحمد العمري"), deps);
    const replies = await handleDriverUpdate(
      contact("0501234567"),
      build({ cities: cityDirectory([]) }),
    );
    expect(replies[0]?.text).toBe(ar("common.no_active_city"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  it("‏/support من غير مسجَّل يردّ بالقائمة لا بنصّ عارٍ", async () => {
    const d = build({ support: { sessions: deps.sessions } as SupportDialogDependencies });
    const replies = await handleDriverUpdate(text("/support"), d);
    expect(replies[0]?.text).toBe(ar("support.not_registered"));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  /** ضغطة واحدة: زرّ الدعم نصّاً وسط خطوة تسجيل لا يُسجَّل اسماً ولا رقماً. */
  it("زرّ الدعم وسط خطوة الاسم يفتح الدعم لا يُسجَّل اسماً", async () => {
    const d = build({ support: { sessions: deps.sessions } as SupportDialogDependencies });
    await handleDriverUpdate(text("/start"), d);
    const pressed = await handleDriverUpdate(text(supportLabel), d);
    expect(pressed[0]?.text).toBe(ar("support.not_registered"));
    expect(pressed[0]?.text).not.toBe(ar("driver.ask_phone"));
  });
});

/**
 * البند 6.3 — `/help` يعرض الأوامر أزراراً، ومصدرها واحد مع القائمة الدائمة.
 *
 * العطب الذي كان: نصّ `driver.help` قائمةُ أوامرٍ مكتوبة يداً في القاموس، فتباعد
 * عن القائمة الحقيقية — لم يذكر «الدعم / شكوى» ولا «اللغة» أصلاً.
 */
describe("لوحة /help — البند 6.3", () => {
  it("يعرض كل أوامر السائق أزراراً inline لا نصّاً", async () => {
    const replies = await handleDriverUpdate(text("/help"), build());
    expect(replies).toHaveLength(3);
    // الردّ الأول شرحُ عمل البوت: من يطلب المساعدة يحتاج أن يعرف ما هو مطلوبٌ منه
    expect(replies[0]?.text).toBe(ar("driver.guide"));
    expect(replies[1]?.keyboard).toEqual(helpKeyboard("driver", "ar"));

    const keyboard = replies[1]?.keyboard;
    if (keyboard?.kind !== "inline") throw new Error("لوحة /help يجب أن تكون inline");
    const labels = keyboard.rows.flat().map((button) => button.label);
    const data = keyboard.rows.flat().map((button) => button.data);
    // المصدر واحد: كل بند قائمة له زرّ، فلا يتباعد /help عن اللوحة الدائمة مرّة أخرى
    for (const item of allItemsFor("driver")) {
      expect(labels).toContain(ar(item.key));
      expect(data).toContain(`cmd:${item.command}`);
    }
    expect(labels).toContain(ar("menu.support"));
    // ولا يعود النصّ قائمة أوامر مكتوبة
    expect(replies[1]?.text).not.toContain("/available");
  });

  it("الردّ الثاني يُعيد تأكيد القائمة الدائمة لا يتركها للحظّ", async () => {
    const replies = await handleDriverUpdate(text("/help"), build());
    expect(replies[2]?.text).toBe(ar("menu.hint"));
    expect(replies[2]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  it("ضغط زرّ أمرٍ يمرّ بنفس موجّه الأوامر — /support يفتح الدعم", async () => {
    const d = build({
      drivers: driverDirectory(verifiedDriver()),
      support: { sessions: deps.sessions } as SupportDialogDependencies,
    });
    const replies = await handleDriverUpdate(callback("cmd:/support"), d);
    expect(replies[0]?.text).toBe(ar("support.choose_type"));
  });

  it("زرّ بأمرٍ ليس من أوامر السائق يُرفض ولا يُنفَّذ", async () => {
    // callback_data يأتي من جهاز المستخدم، فزرٌّ مصنوع بيده لا يجوز أن ينادي أي أمر
    const drivers = driverDirectory(verifiedDriver());
    const replies = await handleDriverUpdate(callback("cmd:/ride"), build({ drivers }));
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
    expect(drivers.availabilityCalls).toEqual([]);
  });
});

/**
 * البند 2.4 — المنطقة المفضّلة.
 *
 * ما تحرسه هذه المجموعة تحديداً: أن خطوةً «اختيارية» اختياريةٌ فعلاً — لا تمنع
 * تسجيلاً، ولا تحبس سائقاً، ولا تكتب نصف منطقة، ولا تصمت عند فشلها.
 */
describe("المنطقة المفضّلة للسائق", () => {
  const AREA_PIN: IncomingUpdate = {
    kind: "location",
    from: SENDER,
    updateId: 1,
    location: { latitude: 21.5433, longitude: 39.1728 },
  };

  async function reachAreaStep(target: DriverBotDependencies = deps) {
    await handleDriverUpdate(text("/start"), target);
    await handleDriverUpdate(text("أحمد العمري"), target);
    await handleDriverUpdate(contact("0501234567"), target);
    await handleDriverUpdate(callback(`city:${JEDDAH.id}`), target);
    await handleDriverUpdate(callback("service:transport"), target);
    return completeKyc(target);
  }

  it("يُسأل عن المنطقة **بعد** اكتمال التسجيل لا قبله — الصفّ مكتوب على أي حال", async () => {
    const done = await reachAreaStep();
    expect(drivers.registrations).toHaveLength(1);
    expect(done.at(-1)?.text).toBe(ar("driver.preferred_area_ask_label"));
    // وزرّ التخطّي معروض مع السؤال نفسه لا في رسالة تالية
    expect(done.at(-1)?.keyboard).toEqual({
      kind: "inline",
      rows: [[{ label: ar("driver.preferred_area_skip_button"), data: "area:skip" }]],
    });
  });

  it("يحفظ الاسم والنقطة معاً — لا نصف منطقة", async () => {
    await reachAreaStep();
    const asked = await handleDriverUpdate(text("حي الصفا"), deps);
    expect(asked[0]?.text).toBe(ar("driver.preferred_area_ask_pin", { area: "حي الصفا" }));
    // لا شيء كُتب بعد الاسم وحده
    expect(drivers.preferredAreaCalls).toHaveLength(0);

    const saved = await handleDriverUpdate(AREA_PIN, deps);
    expect(drivers.preferredAreaCalls).toEqual([
      { label: "حي الصفا", location: { latitude: 21.5433, longitude: 39.1728 } },
    ]);
    expect(saved[0]?.text).toBe(ar("driver.preferred_area_saved", { area: "حي الصفا" }));
  });

  it("التخطّي لا يكتب منطقة ولا يترك السائق في خطوة معلّقة", async () => {
    await reachAreaStep();
    const skipped = await handleDriverUpdate(callback("area:skip"), deps);
    expect(drivers.preferredAreaCalls).toHaveLength(0);
    expect(skipped[0]?.text).toBe(ar("driver.preferred_area_skipped"));
    // الجلسة أُغلقت: النصّ التالي لم يعد اسم منطقة
    const after = await handleDriverUpdate(text("حي الصفا"), deps);
    expect(after[0]?.text).not.toBe(ar("driver.preferred_area_ask_pin", { area: "حي الصفا" }));
  });

  it("نصٌّ حيث تُنتظر نقطة: يُطلب الزرّ لا يُردّ بأمر غير معروف", async () => {
    await reachAreaStep();
    await handleDriverUpdate(text("حي الصفا"), deps);
    const typed = await handleDriverUpdate(text("21.54, 39.17"), deps);
    expect(typed[0]?.text).toBe(ar("driver.preferred_area_needs_pin"));
    expect(drivers.preferredAreaCalls).toHaveLength(0);
  });

  it("اسم فارغ أو مفرط الطول يُرفض بسببه ويبقى زرّ التخطّي معروضاً", async () => {
    await reachAreaStep();
    const short = await handleDriverUpdate(text("ا"), deps);
    expect(short[0]?.text).toBe(ar("driver.preferred_area_label_invalid_too_short"));
    const long = await handleDriverUpdate(text("ح".repeat(61)), deps);
    expect(long[0]?.text).toBe(ar("driver.preferred_area_label_invalid_too_long"));
    expect(long[0]?.keyboard).not.toBeNull();
  });

  it("فشل الكتابة لا يحبس السائق في الخطوة ولا يصمت عنه", async () => {
    const failing = driverDirectory(null);
    const target = build({
      drivers: {
        ...failing,
        setPreferredArea: async () => err(new PortFailureError("DriverDirectory", "down")),
      },
    });
    await reachAreaStep(target);
    await handleDriverUpdate(text("حي الصفا"), target);
    const failed = await handleDriverUpdate(AREA_PIN, target);
    expect(failed[0]?.text).toBe(ar("driver.preferred_area_failed"));
    // والجلسة أُغلقت رغم الفشل: حسابه مكتمل ولا معنى لحبسه في خطوة اختيارية
    const after = await handleDriverUpdate(text("حي الصفا"), target);
    expect(after[0]?.text).not.toBe(ar("driver.preferred_area_ask_pin", { area: "حي الصفا" }));
  });

  it("‏/area يفتح الخطوة لسائق مسجَّل من قبل وجودها", async () => {
    const registered = driverDirectory(verifiedDriver());
    const target = build({ drivers: registered });
    const opened = await handleDriverUpdate(text("/area"), target);
    expect(opened[0]?.text).toBe(ar("driver.preferred_area_ask_label"));

    await handleDriverUpdate(text("حي النزهة"), target);
    await handleDriverUpdate(AREA_PIN, target);
    expect(registered.preferredAreaCalls).toEqual([
      { label: "حي النزهة", location: { latitude: 21.5433, longitude: 39.1728 } },
    ]);
  });

  it("‏/area لغير المسجَّل يردّ بطلب التسجيل لا بفتح خطوة بلا صاحب", async () => {
    const opened = await handleDriverUpdate(text("/area"), deps);
    expect(opened[0]?.text).toBe(ar("driver.must_register_first"));
  });
});

/**
 * تغييرات الاشتراك من بطاقة `/subscription` — أمر المالك 2026-08-12.
 *
 * ولماذا اختبار الحوار وقد اختُبرت الدوالّ الذرّية على قاعدة حقيقية؟ لأنّ
 * السائق لا يُنادي دالّةً: يضغط زرّاً. وبين الزرّ والدالّة أسئلةٌ لا تجيب عنها
 * اختبارات القاعدة: أيظهر «إلغاء» لمن ألغى؟ أيقع الإلغاء بضغطةٍ واحدة؟
 * أيُنشئ المسار المدفوع معاملةً لا سبيل لدفعها؟
 */
/**
 * PD-041 — المركزُ الماليّ (`/finance`): البطاقةُ تُبنى من نموذجِ القراءةِ
 * `driverFinanceOverview`، فتعرضُ المحفظةَ والاستردادَ والاعتراضَ القائمَ لا
 * الاشتراكَ والعملةَ وحدَهما. وغيابُ المنفذِ سكوتٌ صادقٌ (ADR 0161) — لا وعدٌ
 * كاذبٌ بسطرٍ يُعرضُ صفراً.
 *
 * كُتبت لأنّ البطاقةَ كانتْ تَسكُتُ عن المحفظةِ والاعتراضِ والاستردادِ مع أنّ
 * نموذجَ القراءةِ الذي يجمعُها كانَ مبنيّاً وغيرَ موصولٍ، ووصفَ القائمةِ الدائمِ
 * يَعِدُ بها حرفيّاً («الاشتراك والمحفظة والاعتراض والاسترداد في موضع واحد»).
 */
describe("المركز المالي — /finance", () => {
  const WALLET = { ok: true, error: null, walletId: "w-1", currency: "SAR", balanceMinor: 4200 };

  it("يعرض المحفظة والاسترداد والاعتراض القائم إلى جانب الاشتراك", async () => {
    const replies = await handleDriverUpdate(
      text("/finance"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        financeWallet: { balance: async () => ok(WALLET) },
        financeObjections: {
          listOpen: async () =>
            ok([{ reference: "DED-7", status: "open", createdAt: "2026-09-29T10:00:00Z" }]),
        },
      }),
    );
    expect(replies[0]?.text).toContain(
      ar("driver.finance_center", { subscription: "", currency: "" }).split("\n")[0] ?? "",
    );
    // الرصيدُ معروضٌ بخانتينِ عشريّتَينِ مع العملةِ.
    expect(replies[0]?.text).toContain("42.00 SAR");
    // الاستردادُ أهلٌ لأنّ الرصيدَ موجبٌ.
    expect(replies[0]?.text).toContain(ar("driver.finance_refund_eligible"));
    // الاعتراضُ القائمُ يُعَدُّ ولا تُنسَخُ تفاصيلُه.
    expect(replies[0]?.text).toContain(ar("driver.finance_objections_line", { count: "1" }));
    // والزرّانِ قائمانِ.
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: ar("driver.finance_subscription_button"), data: "fin:subscription" }],
        [{ label: ar("driver.finance_objection_button"), data: "fin:objection" }],
      ],
    });
  });

  it("غياب منفذ المحفظة سكوت لا وعد كاذب", async () => {
    const replies = await handleDriverUpdate(
      text("/finance"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(replies[0]?.text).not.toContain("42.00");
    expect(replies[0]?.text).not.toContain(ar("driver.finance_refund_eligible"));
    expect(replies[0]?.text).not.toContain(
      ar("driver.finance_refund_not_eligible", { reason: "" }),
    );
  });

  it("رصيد صفري يعني استردادًا غير أهل بسبب مسمى", async () => {
    const replies = await handleDriverUpdate(
      text("/finance"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        financeWallet: { balance: async () => ok({ ...WALLET, balanceMinor: 0 }) },
      }),
    );
    expect(replies[0]?.text).toContain("0.00 SAR");
    expect(replies[0]?.text).toContain(
      ar("driver.finance_refund_not_eligible", { reason: "no_balance" }),
    );
  });

  it("فشل منفذ المحفظة عطل فني لا بطاقة نصف مالية", async () => {
    const replies = await handleDriverUpdate(
      text("/finance"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        financeWallet: {
          balance: async () => err({ code: "STORE_ERROR", message: "down" } as never) as never,
        },
      }),
    );
    // عطلٌ فنيٌّ صادقٌ: رسالةُ «حاول بعد قليل» العامةُ، لا بطاقةً نصفَ ماليّةٍ.
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });
});

describe("تغييرات الاشتراك من بطاقة /subscription", () => {
  const liveSub = (overrides: Partial<Subscription> = {}): Subscription => ({
    driverId: "driver-1" as DriverId,
    cityId: JEDDAH.id,
    plan: "transport",
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    ...overrides,
  });

  function withChanges(
    subscription: Subscription,
    changes: ReturnType<typeof subscriptionChangePort>,
  ): DriverBotDependencies {
    return build({
      drivers: driverDirectory(verifiedDriver()),
      subscriptions: subscriptionReader(subscription),
      subscriptionChanges: changes,
    });
  }

  it("يعرض زرّي الترقية والإلغاء على اشتراك سارٍ غير مُلغى", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      withChanges(liveSub(), subscriptionChangePort()),
    );
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [{ label: ar("driver.subscription_upgrade_button"), data: "sub:upgrade:both" }],
        [{ label: ar("driver.subscription_cancel_button"), data: "sub:cancel" }],
      ],
    });
  });

  it("لا يعرض زرّ ترقية لمن هو على الخطّة الشاملة", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      withChanges(liveSub({ plan: "both" }), subscriptionChangePort()),
    );
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [[{ label: ar("driver.subscription_cancel_button"), data: "sub:cancel" }]],
    });
  });

  it("يعرض للمُلغي أنّ خدمته مستمرّة، وزرّ تراجعٍ لا زرّ إلغاءٍ ثانٍ", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      withChanges(liveSub({ cancelAtPeriodEnd: true }), subscriptionChangePort()),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_cancel_pending", { plan: "transport", until: "2026-09-01" }),
    );
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [[{ label: ar("driver.subscription_resume_button"), data: "sub:resume" }]],
    });
  });

  it("بلا منفذ تغييرات: بطاقة بلا أزرار — لا زرٌّ يظهر ثمّ يفشل", async () => {
    const replies = await handleDriverUpdate(
      text("/subscription"),
      build({
        drivers: driverDirectory(verifiedDriver()),
        subscriptions: subscriptionReader(liveSub()),
      }),
    );
    expect(replies[0]?.keyboard).toBeNull();
    const pressed = await handleDriverUpdate(
      callback("sub:cancel"),
      build({ drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(pressed[0]?.text).toBe(ar("common.unknown_command"));
  });

  it("الضغطة الأولى تسأل التأكيد ولا تُلغي شيئاً", async () => {
    const changes = subscriptionChangePort();
    const replies = await handleDriverUpdate(
      callback("sub:cancel"),
      withChanges(liveSub(), changes),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_cancel_confirm", { until: "2026-09-01" }),
    );
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [[{ label: ar("driver.subscription_cancel_confirm_button"), data: "sub:cancel:yes" }]],
    });
    expect(changes.calls.cancels).toEqual([]);
  });

  it("التأكيد يُنادي المنفذ مرّةً ويُبلّغ بتاريخ آخر خدمة", async () => {
    const changes = subscriptionChangePort();
    const replies = await handleDriverUpdate(
      callback("sub:cancel:yes"),
      withChanges(liveSub(), changes),
    );
    expect(changes.calls.cancels.length).toBe(1);
    expect(replies[0]?.text).toBe(ar("driver.subscription_cancelled", { until: "2026-09-01" }));
    expect(replies[0]?.keyboard).toEqual(mainMenuKeyboard("driver", "ar"));
  });

  it("طلب إلغاءٍ مكرَّر ليس خطأً: يُقال إنّه مسجَّل سابقاً", async () => {
    const changes = subscriptionChangePort({ cancel: { alreadyCancelled: true } });
    const replies = await handleDriverUpdate(
      callback("sub:cancel:yes"),
      withChanges(liveSub({ cancelAtPeriodEnd: true }), changes),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_cancel_already", { until: "2026-09-01" }),
    );
  });

  it("رفض القاعدة «لا اشتراك سارٍ» يُترجَم نصّاً مفهوماً لا عطلاً تقنياً", async () => {
    const changes = subscriptionChangePort({
      cancel: { ok: false, error: "NO_LIVE_SUBSCRIPTION", subscriptionId: null },
    });
    const replies = await handleDriverUpdate(
      callback("sub:cancel:yes"),
      withChanges(liveSub(), changes),
    );
    expect(replies[0]?.text).toBe(ar("driver.subscription_change_no_live"));
  });

  it("عطل المنفذ لا يُبتلع: يُقال عطلٌ تقنيّ ولا يُدّعى نجاح", async () => {
    const changes = subscriptionChangePort({ failOn: "cancel" });
    const replies = await handleDriverUpdate(
      callback("sub:cancel:yes"),
      withChanges(liveSub(), changes),
    );
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });

  it("التراجع عن الإلغاء يُنادي resume ويُبلّغ باستمرار الاشتراك", async () => {
    const changes = subscriptionChangePort();
    const replies = await handleDriverUpdate(
      callback("sub:resume"),
      withChanges(liveSub({ cancelAtPeriodEnd: true }), changes),
    );
    expect(changes.calls.resumes.length).toBe(1);
    expect(replies[0]?.text).toBe(ar("driver.subscription_resumed"));
  });

  it("تراجعٌ عن اشتراكٍ غير مُلغى: يُقال لا طلب إلغاء", async () => {
    const changes = subscriptionChangePort({ resume: { alreadyActive: true } });
    const replies = await handleDriverUpdate(
      callback("sub:resume"),
      withChanges(liveSub(), changes),
    );
    expect(replies[0]?.text).toBe(ar("driver.subscription_resume_already"));
  });

  it("الترقية المدفوعة تعرض الفرق من القاعدة ولا تُطبّق شيئاً ولا تُنشئ معاملة", async () => {
    const changes = subscriptionChangePort();
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:both"),
      withChanges(liveSub(), changes),
    );
    expect(changes.calls.quotes).toEqual([{ driverId: "driver-1" as DriverId, plan: "both" }]);
    expect(changes.calls.upgrades).toEqual([]);
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_upgrade_quote_paid", {
        plan: "both",
        amount: 150,
        currency: "SAR",
        until: "2026-09-01",
      }),
    );
    expect(replies[1]?.text).toBe(
      ar("driver.subscription_upgrade_manual_payment", { amount: 150, currency: "SAR" }),
    );
  });

  /**
   * الترقية المدفوعة بعد وصول مزوّد الدفع. قبلها كان النصّ يُحوّل السائق إلى
   * الدعم لتحصيلٍ يدويّ — وكان `upgradePlan` مبنيّاً ومختبَراً ولا يستدعيه أحد.
   * وهذه الاختبارات تحرس ما يُخشى في هذا المسار تحديداً: أن تُنشأ فاتورتان
   * لترقيةٍ واحدة، أو أن تُفعَّل الخطّة من ضغطة زرٍّ قبل أن يُدفع الفرق.
   */
  function upgradePurchaseDouble(checkoutUrl: string | null = "https://pay.test/chg_up_1") {
    const state = {
      charges: 0,
      confirms: 0,
      creates: [] as { key: string; amount: number; metadata: Record<string, unknown> }[],
      chargeKeys: [] as string[],
    };
    const tx = {
      id: "tx-upgrade" as PaymentTransactionId,
      payerId: "driver-1" as DriverId,
      payeeId: "platform" as const,
      purpose: "driver_subscription" as const,
      amount: { amount: 15_000, currency: "SAR" },
      provider: "test-provider",
      providerTransactionId: null,
      status: "pending" as const,
      metadata: {} as Record<string, unknown>,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const payments = {
      create: async (input: {
        amount: { amount: number };
        idempotencyKey: string;
        metadata: Record<string, unknown>;
      }) => {
        const already = state.creates.some((c) => c.key === input.idempotencyKey);
        state.creates.push({
          key: input.idempotencyKey,
          amount: input.amount.amount,
          metadata: input.metadata,
        });
        return ok({ transaction: tx, alreadyExists: already });
      },
      findById: async () => ok(null),
      findByIdempotencyKey: async (key: string) =>
        ok(state.creates.some((c) => c.key === key) ? tx : null),
      recordCheckoutUrl: async () => ok({ checkoutUrl }),
      confirmPayment: async () => {
        state.confirms += 1;
        return err(new PortFailureError("payments", "UNUSED"));
      },
    };
    const provider = {
      name: "test-provider",
      chargeSubscription: async (input: { idempotencyKey: string }) => {
        state.charges += 1;
        state.chargeKeys.push(input.idempotencyKey);
        return ok({ providerTransactionId: null, checkoutUrl, status: "pending" as const });
      },
      verifyWebhook: async () => err(new PortFailureError("provider", "UNUSED")),
      fetchTransaction: async () => err(new PortFailureError("provider", "UNUSED")),
    };
    return {
      purchase: { payments, provider } as unknown as NonNullable<
        DriverBotDependencies["subscriptionPurchase"]
      >,
      state,
    };
  }

  function withPaidUpgrade(
    subscription: Subscription,
    changes: ReturnType<typeof subscriptionChangePort>,
    purchase: NonNullable<DriverBotDependencies["subscriptionPurchase"]>,
  ): DriverBotDependencies {
    return build({
      drivers: driverDirectory(verifiedDriver()),
      subscriptions: subscriptionReader(subscription),
      subscriptionChanges: changes,
      subscriptionPurchase: purchase,
    });
  }

  it("مع مزوّد دفع: العرض أولاً بزرّ تأكيد، ولا معاملة ولا استدعاء مزوّد قبله", async () => {
    const changes = subscriptionChangePort();
    const { purchase, state } = upgradePurchaseDouble();
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:both"),
      withPaidUpgrade(liveSub(), changes, purchase),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_upgrade_quote_paid", {
        plan: "both",
        amount: 150,
        currency: "SAR",
        until: "2026-09-01",
      }),
    );
    expect(replies[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [
          {
            label: ar("driver.subscription_upgrade_confirm_button"),
            data: "sub:upgrade:confirm:both",
          },
        ],
      ],
    });
    expect(state.creates).toEqual([]);
    expect(state.charges).toBe(0);
    expect(changes.calls.upgrades).toEqual([]);
  });

  it("التأكيد يُنشئ طلب دفعٍ واحداً بالوحدة الصغرى ويعيد رابطاً، ولا يُفعّل الخطّة", async () => {
    const changes = subscriptionChangePort();
    const { purchase, state } = upgradePurchaseDouble();
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:confirm:both"),
      withPaidUpgrade(liveSub(), changes, purchase),
    );
    expect(replies[0]?.text).toBe(
      ar("driver.subscription_upgrade_checkout", {
        plan: "both",
        amount: 150,
        currency: "SAR",
        url: "https://pay.test/chg_up_1",
      }),
    );
    // ١٥٠ ريالاً = ١٥٠٠٠ هلّة؛ تمريرُ ١٥٠ كان سيبيع ترقيةً بريالٍ ونصف.
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0]?.amount).toBe(15_000);
    // `upgrade: true` هو ما يجعل `confirm_payment` يُغيّر الخطّة في مكانها بدل
    // أن يُمدّد الدورة كاشتراكٍ جديد.
    expect(state.creates[0]?.metadata.upgrade).toBe(true);
    expect(state.charges).toBe(1);
    // الترقية لا تُطبَّق من البوت: لا `applyUpgrade` ولا تأكيد دفعةٍ لم تُدفع.
    expect(changes.calls.upgrades).toEqual([]);
    expect(state.confirms).toBe(0);
  });

  it("ضغطتا تأكيدٍ في اليوم نفسه: مفتاحٌ واحد، ولا استدعاء ثانٍ للمزوّد", async () => {
    const { purchase, state } = upgradePurchaseDouble();
    const target = withPaidUpgrade(liveSub(), subscriptionChangePort(), purchase);
    const first = await handleDriverUpdate(callback("sub:upgrade:confirm:both"), target);
    const second = await handleDriverUpdate(callback("sub:upgrade:confirm:both"), target);
    expect(first[0]?.text).toContain("https://pay.test/chg_up_1");
    // الثانية وجدت المعاملة سلفاً فلم تُنشئ فاتورةً ثانية ولم تستدعِ المزوّد.
    expect(state.creates).toHaveLength(1);
    expect(state.charges).toBe(1);
    expect(new Set(state.chargeKeys).size).toBe(1);
    expect(state.chargeKeys[0]).toBe(
      `driver_subscription_upgrade:driver-1:both:${NOW.toISOString().slice(0, 10)}`,
    );
    // ولا يُترك السائق بلا ردّ: المعاملة القائمة لا رابط لها فيُقال «قيد الانتظار».
    expect(second[0]?.text).toBe(ar("driver.subscription_checkout_pending"));
  });

  it("مزوّدٌ لم يُعِد رابطاً: يُقال «قيد الانتظار» ولا يُدَّعى نجاح الترقية", async () => {
    const { purchase } = upgradePurchaseDouble(null);
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:confirm:both"),
      withPaidUpgrade(liveSub(), subscriptionChangePort(), purchase),
    );
    expect(replies[0]?.text).toBe(ar("driver.subscription_checkout_pending"));
  });

  it("داخل التجربة المجانية: عرضٌ بلا مقابل ثمّ تأكيدٌ يُطبّق الترقية ذرّياً", async () => {
    const trialQuote = {
      quote: {
        amountDue: 0,
        paymentRequired: false,
        status: "trialing" as const,
        periodEnd: new Date("2026-08-20T00:00:00.000Z"),
      },
    };
    const changes = subscriptionChangePort(trialQuote);
    const trialing = liveSub({
      status: "trialing",
      trialEndsAt: new Date("2026-08-20T00:00:00.000Z"),
    });

    const shown = await handleDriverUpdate(
      callback("sub:upgrade:both"),
      withChanges(trialing, changes),
    );
    expect(shown[0]?.text).toBe(ar("driver.subscription_upgrade_quote_free", { plan: "both" }));
    expect(shown[0]?.keyboard).toEqual({
      kind: "inline",
      rows: [
        [
          {
            label: ar("driver.subscription_upgrade_confirm_button"),
            data: "sub:upgrade:confirm:both",
          },
        ],
      ],
    });
    expect(changes.calls.upgrades).toEqual([]);

    const applied = await handleDriverUpdate(
      callback("sub:upgrade:confirm:both"),
      withChanges(trialing, changes),
    );
    expect(changes.calls.upgrades).toEqual([
      { driverId: "driver-1" as DriverId, plan: "both", transactionId: null },
    ]);
    expect(applied[0]?.text).toBe(
      ar("driver.subscription_upgraded", { plan: "both", until: "2026-08-20" }),
    );
  });

  it("خطّةٌ ليست ترقية: يُقال لا ترقية متاحة ولا تُنادى upgrade_plan", async () => {
    const changes = subscriptionChangePort({
      quote: { ok: false, error: "PLAN_NOT_AN_UPGRADE", subscriptionId: null },
    });
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:delivery"),
      withChanges(liveSub(), changes),
    );
    expect(replies[0]?.text).toBe(ar("driver.subscription_upgrade_not_available"));
    expect(changes.calls.upgrades).toEqual([]);
  });

  it("من هو على الخطّة أصلاً: يُقال ذلك بلا ترقيةٍ ثانية", async () => {
    const changes = subscriptionChangePort({
      quote: { ok: false, error: "ALREADY_ON_PLAN", subscriptionId: null },
    });
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:both"),
      withChanges(liveSub({ plan: "both" }), changes),
    );
    expect(replies[0]?.text).toBe(ar("driver.subscription_upgrade_already", { plan: "both" }));
  });

  it("زرّ خطّةٍ مجهولة يُرفض ولا يمسّ القاعدة", async () => {
    const changes = subscriptionChangePort();
    const replies = await handleDriverUpdate(
      callback("sub:upgrade:premium"),
      withChanges(liveSub(), changes),
    );
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
    expect(changes.calls.quotes).toEqual([]);
  });

  it("غير المسجَّل لا يُلغي اشتراكاً: يُطلب منه التسجيل أولاً", async () => {
    const changes = subscriptionChangePort();
    const replies = await handleDriverUpdate(
      callback("sub:cancel:yes"),
      build({ drivers: driverDirectory(null), subscriptionChanges: changes }),
    );
    expect(replies[0]?.text).toBe(ar("driver.must_register_first"));
    expect(changes.calls.cancels).toEqual([]);
  });
});

/**
 * `D-36` · `ADR 0194`: جلسةُ السائقِ متعذِّرةُ القراءةِ. خطواتُ التسجيلِ تُجابُ بعطلٍ صادقٍ،
 * وما مصدرُ حقيقتِه القاعدةُ — القبولُ ونبضةُ الموقعِ — يبقى يعملُ (`F11-03` · `ADR 0193`).
 */
describe("جلسةُ السائقِ متعذِّرةُ القراءةِ — D-36", () => {
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

  it("مشاركةُ الرقمِ تُجابُ بعطلٍ صادقٍ ولا تُكتَبُ جلسةٌ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleDriverUpdate(
      contact("+966501234567"),
      build({ sessions: sessions.store }),
    );
    expect(replies.map((r) => r.text)).toEqual([ar("common.error_try_again")]);
    expect(sessions.saves).toEqual([]);
  });

  it("زرُّ المدينةِ (خطوةٌ) يُجابُ بعطلٍ صادقٍ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleDriverUpdate(
      callback(`city:${JEDDAH.id}`),
      build({ sessions: sessions.store }),
    );
    expect(replies.map((r) => r.text)).toEqual([ar("common.error_try_again")]);
    expect(sessions.saves).toEqual([]);
  });

  it("نصٌّ حرٌّ بلا تفاوضٍ يُجابُ بعطلٍ صادقٍ — لعلَّه اسمٌ أو لوحةٌ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleDriverUpdate(text("محمد"), build({ sessions: sessions.store }));
    expect(replies.map((r) => r.text)).toEqual([ar("common.error_try_again")]);
    expect(sessions.saves).toEqual([]);
  });

  it("قبولُ العرضِ يمرُّ بالدالةِ الذرّيّةِ والجلسةُ متعذِّرةٌ", async () => {
    const sessions = unreadableSessions();
    const replies = await handleDriverUpdate(
      callback("offer:accept:order-77"),
      build({ sessions: sessions.store, drivers: driverDirectory(verifiedDriver()) }),
    );
    expect(claims).toEqual([{ orderId: "order-77" as OrderId, driverId: "driver-1" as DriverId }]);
    expect(replies[0]?.text).toBe(ar("driver.offer_accepted"));
  });

  it("نبضةُ الموقعِ تُكتَبُ والجلسةُ متعذِّرةٌ", async () => {
    const sessions = unreadableSessions();
    const drivers = driverDirectory(verifiedDriver({ hasLocation: false, isAvailable: false }));
    const replies = await handleDriverUpdate(
      {
        kind: "location",
        from: SENDER,
        updateId: 1,
        location: { latitude: 21.5433, longitude: 39.1728 },
      },
      build({ sessions: sessions.store, drivers }),
    );
    expect(drivers.locationCalls).toHaveLength(1);
    expect(replies[0]?.text).toBe(ar("driver.location_saved"));
  });
});

/**
 * `F16-01` — `/rating`: بطاقةُ السمعةِ (`get-reputation-summary.ts` الذي كانَ مبنيّاً
 * بلا نداءٍ). القياسُ على مستوى الحوارِ: البطاقةُ منَ المنفذِ، والغيابُ والفشلُ
 * صادقانِ، والقائمةُ الدائمةِ مرفقةٌ حيثُ وعدَ بها المُعالِجُ.
 */
describe("بطاقة السمعة — /rating", () => {
  const summary = {
    asDriver: { average: 4.5, count: 12 },
    asRider: { average: 5, count: 2 },
    received: [
      { stars: 5, direction: "rider_to_driver", comment: null, createdAt: NOW },
      { stars: 1, direction: "rider_to_driver", comment: "متأخر", createdAt: NOW },
      { stars: 4, direction: "rider_to_driver", comment: null, createdAt: NOW },
      { stars: 3, direction: "rider_to_driver", comment: null, createdAt: NOW },
    ],
  };

  it("يعرض الملخص كسائق وزبون وآخر ثلاثة تقييمات مستلمة", async () => {
    const replies = await handleDriverUpdate(
      text("/rating"),
      build({
        reputation: { summaryFor: async () => ok(summary) },
      }),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain(ar("reputation.heading"));
    expect(replies[0]?.text).toContain(ar("reputation.as_driver", { average: "4.5", count: "12" }));
    expect(replies[0]?.text).toContain(ar("reputation.as_rider", { average: "5.0", count: "2" }));
    // آخرُ ثلاثةٍ فقط: الرابعُ (٣ نجومٍ) لا يظهر — تُعَدُّ صفوفُ «مِن عميلٍ».
    expect(replies[0]?.text.split(ar("reputation.from_rider")).length ?? 0).toBe(4);
    expect(replies[0]?.text).toContain(ar("reputation.from_rider"));
  });

  it("لا تقييمات: الغياب ليس صفر نجوم", async () => {
    const replies = await handleDriverUpdate(
      text("/rating"),
      build({
        reputation: { summaryFor: async () => ok({ asDriver: null, asRider: null, received: [] }) },
      }),
    );
    expect(replies[0]?.text).toBe(ar("reputation.empty"));
  });

  it("عطل المنفذ عطل فني لا «لا سمعة»", async () => {
    const replies = await handleDriverUpdate(
      text("/rating"),
      build({
        reputation: {
          summaryFor: async () => err(new PortFailureError("get_reputation_summary", "db")),
        },
      }),
    );
    expect(replies[0]?.text).toBe(ar("common.error_try_again"));
  });

  it("غياب المنفذ: أمر غير معروف لا بطاقة فارغة", async () => {
    const replies = await handleDriverUpdate(text("/rating"), build());
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
  });
});

describe("PRD-105 — بطاقةُ الرقمِ من التطبيقِ المصغَّرِ والحوارُ خامل", () => {
  it("بطاقةُ المرسِلِ نفسِه ⇒ يُحفَظُ الرقمُ إثباتاً ولا يُفتَحُ حوارُ تسجيل", async () => {
    const replies = await handleDriverUpdate(contact("0501234567"), deps);
    expect(replies.map((r) => r.text)).toEqual([ar("driver.phone_received_for_app")]);
    const saved = await deps.sessions.load(SENDER.telegramUserId);
    expect(saved.ok && saved.value?.draftPhone).toBe("+966501234567");
    expect(saved.ok && saved.value?.step).toBe("idle");
  });

  it("بطاقةٌ مُعادٌ توجيهُها ⇒ لا إثبات", async () => {
    const replies = await handleDriverUpdate(contact("0509999999", "999999"), deps);
    expect(replies[0]?.text).toBe(ar("driver.phone_not_yours"));
    const saved = await deps.sessions.load(SENDER.telegramUserId);
    expect(saved.ok ? (saved.value?.draftPhone ?? null) : "fail").toBeNull();
  });

  it("سائقٌ مسجَّلٌ ⇒ لا إثباتَ ولا كتابة", async () => {
    const registered = build({ drivers: driverDirectory(verifiedDriver()) });
    const replies = await handleDriverUpdate(contact("0501234567"), registered);
    expect(replies[0]?.text).toBe(ar("common.unknown_command"));
    const saved = await registered.sessions.load(SENDER.telegramUserId);
    expect(saved.ok ? (saved.value?.draftPhone ?? null) : "fail").toBeNull();
  });
});
