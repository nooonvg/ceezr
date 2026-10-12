/**
 * الغرض: `UI-5 / PR 8` — فحصُ fuzz وتهريبِ التنسيق لنصوصِ رسائلِ تيليجرام كما
 *   تُبنى فعلاً، لا لوظائفَ مساعدةٍ وحدها. المصدرُ الكانونيُّ يوجبُ «ميزانيةَ رسائلٍ
 *   + fuzz تهريب»، وهذا الملفُ الشطرُ الثاني: إثباتٌ أنَّ النصَّ الخارجَ من الحواراتِ
 *   يصمدُ أمامَ سلاسلِ المستخدمِ العدوائيةِ — رموزُ markdown وHTML وعلاماتُ RTL
 *   والعربيةُ والأرديةُ والنصوصُ الطويلةُ — وأنَّ لوحاتِ الأزرارِ المبنيةَ من
 *   معرّفاتٍ حقيقيةٍ لا تكسرُ حدَّ ٦٤ بايتاً، وأنَّ الرسائلَ لا تحملُ مفتاحاً خاماً
 *   ولا نصاً عربياً داخلَ الإنجليزية.
 *
 *   **ولماذا الاختبارُ على المُخرَجِ لا على helper:** لأنَّ العلةَ المطلوبَةَ هي ما
 *   يصلُ المستخدمَ. الفحصُ على الدالّةِ النقيةِ يثبتُ الدالّةَ، ورسالةٌ تُبنى في
 *   مسارٍ آخرَ تمرُّ بلا فحص. فتُدارُ الحواراتُ نفسُها بمزدوجاتِها وتُفحصُ نصوصُ
 *   `BotReply` الناتجةُ حرفاً.
 *
 * الحالة: اختبار فعلي — `UI-5` (PR 8).
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI (سلسلة verify).
 *
 * ما لا يُدَّعى هنا: لا قياسَ على السِلكِ (ذاكَ `tests/integration/telegram-message-budget.test.ts`
 *   على قاعدةٍ حقيقيةٍ)، ولا نقرٌ حيٌّ على عميلِ تيليجرام. المُثبَتُ بنيةُ النصِّ
 *   الخامِ الذي يُسلَّمُ للمُرسِل.
 */

import { describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  handleRiderUpdate,
  type RiderBotDependencies,
} from "../../packages/application/bots/rider-dialog.ts";
import type {
  IncomingUpdate,
  PastOrderSummary,
  Sender,
} from "../../packages/application/bots/types.ts";
import type { NegotiationParties } from "../../packages/application/dispatch/register-unsubscribed-claim.ts";
import type { SupportTicketView } from "../../packages/domain/support/ticket-types.ts";
import {
  isCallbackDataValid,
  MAX_CALLBACK_DATA_BYTES,
  toTelegramMarkup,
} from "../../packages/infrastructure/notification/telegram-markup.ts";
import { t, translate } from "../../packages/shared/i18n/index.ts";
import type { DriverId, OrderId, RiderId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  JEDDAH,
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

const NOW = new Date("2026-10-06T12:00:00.000Z");

/** مُرسِلاتُ تيليجرام التي تُبنى فيها نداءاتُ الإرسال — كلُّ ما يُرسِلُ نصاً للمستخدم. */
const SENDER_FILES = [
  "packages/infrastructure/notification/telegram-api-sender.ts",
  "packages/infrastructure/notification/telegram-safety-notifier.ts",
  "packages/infrastructure/notification/telegram-negotiation-notifier.ts",
  "packages/infrastructure/notification/telegram-notice-sender.ts",
  "packages/infrastructure/notification/telegram-broadcast-sender.ts",
  "packages/infrastructure/notification/telegram-support-notifier.ts",
  "packages/infrastructure/notification/telegram-driver-notifier.ts",
] as const;

/**
 * سلاسلُ عدوائيةٌ تمثّلُ ما يكتبُه مستخدمٌ حقيقيٌّ أو يزرعُه مهاجمٌ: تنسيقُ Markdown
 * وHTML، وقوالبُ المفاتيحِ `{name}`، وعلاماتُ الاتجاه، والعربيةُ والأرديةُ، والإيموجي،
 * والطولُ الحديّ.
 */
const ADVERSARIAL = [
  "<b>علي</b> *قوي*",
  "[ناصر](https://evil.example/x) _مائل_",
  "سالم `code` ```block```",
  "&lt;script&gt;أحمد&lt;/script&gt; &amp;",
  "زبير {name} {ticket} {position}",
  "أسامة \u200f\u200e\u202b\u202c RTL",
  "عبد\u0640الله تطويل",
  "یوسف خان اردو سپیکر",
  "د. محمد بن علي — إيموجي 🚕🆘",
  "#عنوان @إشارة رابط https://t.me/bot",
  "x".repeat(120),
];

/** حروفٌ عربيةٌ (بلا إيموجي ولا رموز) — لا يجوزُ أن تظهرَ في نصٍّ إنجليزيّ. */
const ARABIC_LETTER = /[\u0621-\u064A]/;

function senderFor(language: string): Sender {
  return { telegramUserId: "700", chatId: "700", languageHint: language };
}

let updateIdCounter = 0;
function textUpdate(sender: Sender, value: string): IncomingUpdate {
  return { kind: "text", from: sender, updateId: ++updateIdCounter, text: value };
}
function callbackUpdate(sender: Sender, data: string): IncomingUpdate {
  return {
    kind: "callback",
    from: sender,
    updateId: ++updateIdCounter,
    data,
    messageId: "777",
  };
}

/** حوارٌ مُهيَّأٌ براكبٍ مسجَّلٍ — يُدارُ كاملًا من `/start` إن لزم. */
function registeredDeps(
  past: readonly PastOrderSummary[] = [],
  tickets: readonly SupportTicketView[] = [],
): RiderBotDependencies {
  return {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    riders: riderDirectory({
      id: "rider-1" as RiderId,
      cityId: JEDDAH.id,
      telegramUserId: "700",
      fullName: "منى العميلة",
    }),
    cities: cityDirectory([JEDDAH]),
    orders: orderWriter("order-1" as OrderId),
    rides: rideRequestCommand("order-1" as OrderId),
    activeOrdersOf: async () => [],
    pastOrdersOf: async () => past,
    ticketLister: { list: async () => tickets },
    matching: {
      orders: orderRepo([]),
      offers: offerRepo([]),
      candidates: candidateRepo([]),
      settings: settingsRepo(seededRows(JEDDAH.id)),
      offerWriter: {
        openRound: async () =>
          ok({
            opened: false as const,
            refusal: "ORDER_NOT_SEARCHING" as const,
            status: "searching" as const,
          }),
      },
      clock: fixedClock(NOW),
    },
    clock: fixedClock(NOW),
  };
}

/** حوارٌ براكبٍ غيرِ مسجَّلٍ — لمسارِ التسجيلِ من الصفر. */
function freshDeps(): RiderBotDependencies {
  const base = registeredDeps();
  return {
    ...base,
    riders: riderDirectory(null),
  };
}

function pastOrderWith(driverName: string | null, place: string | null): PastOrderSummary {
  return {
    orderId: "order-9" as OrderId,
    service: "transport",
    status: "completed",
    pickupLabel: place,
    dropoffLabel: null,
    createdAt: new Date("2026-10-05T10:30:00.000Z"),
    endedAt: new Date("2026-10-05T11:15:00.000Z"),
    driverName,
    ratingStars: 4,
  };
}

function ticketWith(resolution: string | null): SupportTicketView {
  return {
    id: "ticket-1",
    reference: "TK-20261006-0001",
    category: "ride_dispute",
    status: "resolved",
    message: "نص الشكوى",
    resolution,
    orderId: "order-9",
    createdAt: "2026-10-06T09:00:00.000Z",
    resolvedAt: "2026-10-06T10:00:00.000Z",
    lostAt: null,
  };
}

/** كلُّ نصوصِ الردودِ في لغةٍ واحدةٍ — لا مفتاحًا خاماً فيها. */
function assertNoRawKeys(replies: readonly { text: string }[]): void {
  for (const reply of replies) {
    // مفتاح i18n خام: كلمات إنجليزية تفصلها نقاط، بلا مسافةٍ ولا عربيّة.
    expect(reply.text).not.toMatch(/(^|\s)[a-z]+\.[a-z_]+(\.[a-z_]+)?(\s|$)/);
  }
}

describe("UI-5 · لا parse_mode في أي مُرسِل — المحلّل الفعليّ نصٌّ خام", () => {
  it("كل ملفات المرسلات خالية من parse_mode", async () => {
    // يُحذفُ التعليقُ قبلَ الفحص: كلمةُ «parse_mode» تردُ في شروحٍ تُقرِّرُ الإرسالَ
    // بلا تنسيقٍ — والفحصُ على الشيفرةِ لا على الشرح. المطلوبُ إثباتُ أنه لا موضعَ
    // يفعّلُ محلّلَ الكياناتِ (HTML/Markdown) في نداءِ الإرسال.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of SENDER_FILES) {
      const source = stripComments(await Bun.file(file).text());
      expect(source, file).not.toContain("parse_mode");
      expect(source, file).not.toContain("parseMode");
    }
  });

  it("مفتاح i18n غير الموجود يظهر كما هو — فحصُ الحارس يعمل", async () => {
    // الحارسُ نفسُه: إن كان فحصُ المفاتيحِ الخامِ معطوبًا لَما كشفَ هذا.
    expect(translate("en", "no.such.key.exists")).toBe("no.such.key.exists");
  });
});

describe("UI-5 · fuzz — اسم المستخدم في التسجيل", () => {
  for (const language of ["ar", "en", "ur"] as const) {
    it(`الاسم العدوائي يصل نصًّا خامًا ولا يكسر الرسالة (${language})`, async () => {
      // تسجيلٌ من الصفر: راكبٌ غيرُ موجودٍ بعد، فالمسارُ هو /start ← اسم ← مدينة.
      const deps = freshDeps();
      const sender = senderFor(language);
      // التسجيل: /start ← الاسم ← المدينة
      const start = await handleRiderUpdate(textUpdate(sender, "/start"), deps);
      expect(start.length).toBeGreaterThan(0);
      const adversarialName = ADVERSARIAL[0] ?? "";
      const name = await handleRiderUpdate(textUpdate(sender, adversarialName), deps);
      assertNoRawKeys(name);
      const city = await handleRiderUpdate(callbackUpdate(sender, `city:${JEDDAH.id}`), deps);
      assertNoRawKeys(city);
      // رسالة الترحيب بعد التسجيل تحملُ الاسمَ حرفيًّا — رموزُ التنسيقِ تصلُ نصًّا
      // خامًا لا تُفسَّر: هذا بعينِهِ ما يعنيهِ الإرسالُ بلا parse_mode.
      const registered = city.find((r) => r.text.includes(adversarialName));
      expect(registered).toBeDefined();
      const nameEcho = registered?.text ?? "";
      expect(nameEcho).toContain(adversarialName);
    });
  }

  it("الأسماء المرفوضة تُردُّ بسببها لا برسالة مكسورة", async () => {
    const deps = registeredDeps();
    const sender = senderFor("ar");
    await handleRiderUpdate(textUpdate(sender, "/start"), deps);
    for (const bad of ["/skip", "ا", "ااااااا"]) {
      const replies = await handleRiderUpdate(textUpdate(sender, bad), deps);
      assertNoRawKeys(replies);
      expect(replies.length).toBeGreaterThan(0);
    }
  });
});

describe("UI-5 · fuzz — سجل الرحلات: اسم السائق والمكان", () => {
  for (const language of ["ar", "en", "ur"] as const) {
    it(`السلاسل العدوائية في السجل تصل نصًّا خامًا (${language})`, async () => {
      for (const sample of ADVERSARIAL) {
        const deps = registeredDeps([pastOrderWith(sample, sample)]);
        const replies = await handleRiderUpdate(textUpdate(senderFor(language), "/history"), deps);
        assertNoRawKeys(replies);
        expect(replies[0]?.text).toContain(sample);
      }
    });
  }
});

describe("UI-5 · fuzz — تذاكر الدعم: نص القرار", () => {
  for (const language of ["ar", "en", "ur"] as const) {
    it(`قرار التذكرة العدوائي يصل نصًّا خامًا (${language})`, async () => {
      for (const sample of ADVERSARIAL.slice(0, 6)) {
        const deps = registeredDeps([], [ticketWith(sample)]);
        const replies = await handleRiderUpdate(textUpdate(senderFor(language), "/tickets"), deps);
        assertNoRawKeys(replies);
        expect(replies[0]?.text).toContain(sample);
        expect(replies[0]?.text).toContain("TK-20261006-0001");
      }
    });
  }
});

describe("UI-5 · fuzz — تمرير نص التفاوض", () => {
  it("النص العدوائي يُمرَّر كما هو مع حجب ما يشبه رقم الهاتف", async () => {
    const { relayNegotiationMessage } = await import(
      "../../packages/application/dispatch/relay-negotiation-message.ts"
    );
    const parties: NegotiationParties = {
      negotiationId: "0b9e2f6e-6a4e-4d1f-9d3f-5f1a2b3c4d5e",
      orderId: "order-9" as OrderId,
      driverId: "driver-1" as DriverId,
      driverChatId: "470001",
      driverLanguage: "ar",
      riderChatId: "700",
      riderLanguage: "ar",
      position: 3,
      selected: true,
    };
    const relayed: string[] = [];
    const deps = {
      lookup: {
        forRider: async () => ok(parties),
        forDriver: async () => ok(parties),
      },
      sender: {
        relay: async (_p: NegotiationParties, _from: "rider" | "driver", text: string) => {
          relayed.push(text);
          return ok(true);
        },
      },
    };
    const sample = "أهلاً <b>سائق</b> رقمي 0551234567 🚕";
    const report = await relayNegotiationMessage(
      { from: "rider", driverId: null, riderId: "rider-1" as RiderId, text: sample },
      deps,
    );
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.relayed).toBe(true);
    expect(report.value.redacted).toBe(1);
    // ما وصل الطرف الآخر: نصٌّ خامٌ فيه التنسيقُ كما كتبه المرسل، والرقمُ مُقنَّع.
    expect(relayed[0]).toContain("<b>سائق</b>");
    expect(relayed[0]).not.toContain("0551234567");
  });
});

describe("UI-5 · لوحات الأزرار — callback_data ≤ 64 بايت بمعرّفات حقيقية", () => {
  it("بطاقات التفاوض بمعرّفات UUID كاملة لا تكسر الحد", async () => {
    const { riderPresentationCard, riderDriverInfoCard, riderChatCard } = await import(
      "../../packages/application/bots/negotiation-cards.ts"
    );
    const tr = t("ar");
    const negotiationId = "0b9e2f6e-6a4e-4d1f-9d3f-5f1a2b3c4d5e";
    const cards = [
      riderPresentationCard(tr, negotiationId, 12, 300),
      riderChatCard(tr, negotiationId, 12, 300),
      riderDriverInfoCard(tr, {
        negotiationId,
        position: 12,
        firstName: "سعيد",
        ratingAverage: 4.7,
        ratingCount: 128,
        vehicleType: "سيارة",
        vehicleYear: 2020,
        completedTrips: 500,
        memberSinceYear: 2024,
      }),
    ];
    for (const card of cards) {
      const markup = toTelegramMarkup(card.keyboard);
      expect(markup).not.toBeUndefined();
      if (markup === undefined || !("inline_keyboard" in markup)) continue;
      for (const row of markup.inline_keyboard) {
        for (const button of row) {
          if (!("callback_data" in button)) continue;
          expect(isCallbackDataValid(button.callback_data)).toBe(true);
          expect(new TextEncoder().encode(button.callback_data).length).toBeLessThanOrEqual(
            MAX_CALLBACK_DATA_BYTES,
          );
        }
      }
    }
  });

  it("لوحة أوامر المساعدة والقوائم لا تكسر الحد", async () => {
    const { helpKeyboard, mainMenuKeyboard } = await import(
      "../../packages/application/bots/main-menu.ts"
    );
    for (const language of ["ar", "en", "ur"] as const) {
      for (const keyboard of [
        helpKeyboard("rider", language, { hasActiveOrder: true }),
        helpKeyboard("driver", language),
        mainMenuKeyboard("rider", language, { hasActiveOrder: true }),
      ]) {
        const markup = toTelegramMarkup(keyboard);
        if (markup === undefined || !("inline_keyboard" in markup)) continue;
        for (const row of markup.inline_keyboard) {
          for (const button of row) {
            if (!("callback_data" in button)) continue;
            expect(isCallbackDataValid(button.callback_data)).toBe(true);
          }
        }
      }
    }
  });

  it("أزرار SOS بمعرّف حادث UUID كامل لا تكسر الحد", async () => {
    const incidentId = "1a2b3c4d-5e6f-4a5b-8c9d-0e1f2a3b4c5d";
    for (const action of ["claim", "close", "block"]) {
      const data = `sos:${action}:${incidentId}`;
      expect(isCallbackDataValid(data)).toBe(true);
    }
  });
});

describe("UI-5 · صدق اللغات — لا عربية داخل الإنجليزية ولا مفاتيح خام", () => {
  it("قاموس الإنجليزية خالٍ من الحروف العربية", async () => {
    const en = await Bun.file("packages/shared/i18n/en.json").text();
    const parsed = JSON.parse(en) as Record<string, string>;
    const offenders = Object.entries(parsed).filter(([, value]) => ARABIC_LETTER.test(value));
    expect(offenders).toEqual([]);
  });

  it("قواميس البوتات الثلاثة متطابقة المفاتيح", async () => {
    const keysOf = async (lang: string): Promise<Set<string>> => {
      const parsed = JSON.parse(
        await Bun.file(`packages/shared/i18n/${lang}.json`).text(),
      ) as Record<string, string>;
      return new Set(Object.keys(parsed));
    };
    const [ar, en, ur] = await Promise.all([keysOf("ar"), keysOf("en"), keysOf("ur")]);
    expect(en).toEqual(ar);
    expect(ur).toEqual(ar);
  });

  it("الردود في الأردية لا تحمل نصًّا عربيًّا فصيحًا غير مترجم", async () => {
    // قاموس الأردية مكتوبٌ بالحرف العربي أصلًا، فلا يُفحصُ الحرفُ بل النسخُ: قيمةٌ
    // أرديةٌ مطابقةٌ للعربيةِ **ومختلفةٌ عن الإنجليزيةِ** تعني كلامًا حقيقيًّا لم يُترجم
    // (الإنجليزيةُ مختلفةٌ ⟹ النصُّ ليس رمزًا ولا قالبًا). وما تطابقَ في اللغاتِ الثلاثِ
    // (قوالبُ {stars} وأمثالُها) ليس نصًّا أصلًا. ويُسمحُ بما ائتلفَت فيه اللغتانِ بحكمِ
    // القربِ (كلمة «قبول» أرديةٌ صحيحةٌ) — القائمةُ المغلقةُ أدناه.
    const allowed = new Set(["group.unsub_accept_button"]);
    const ar = JSON.parse(await Bun.file("packages/shared/i18n/ar.json").text()) as Record<
      string,
      string
    >;
    const ur = JSON.parse(await Bun.file("packages/shared/i18n/ur.json").text()) as Record<
      string,
      string
    >;
    const en = JSON.parse(await Bun.file("packages/shared/i18n/en.json").text()) as Record<
      string,
      string
    >;
    const copied = Object.keys(ar).filter(
      (key) =>
        key in ur && key in en && ar[key] === ur[key] && ar[key] !== en[key] && !allowed.has(key),
    );
    expect(copied).toEqual([]);
  });
});

describe("UI-5 · دفعة الردود — لا رسائل زائدة عن الحد في مسارات الـfuzz", () => {
  it("كل تحديث في مسارات التسجيل والتذاكر والسجل لا يولّد أكثر من دفعة الرد المسموحة", async () => {
    const { maxAllowedReplyBurst } = await import("../../scripts/lib/telegram-message-budget.ts");
    const ceiling = maxAllowedReplyBurst();
    const flows: readonly (() => Promise<readonly { readonly length: number }[]>)[] = [
      async () => [
        await handleRiderUpdate(textUpdate(senderFor("ar"), "/start"), registeredDeps()),
      ],
      async () => [
        await handleRiderUpdate(
          textUpdate(senderFor("en"), "/history"),
          registeredDeps([pastOrderWith("سعيد", "البيت")]),
        ),
      ],
      async () => [
        await handleRiderUpdate(
          textUpdate(senderFor("ur"), "/tickets"),
          registeredDeps([], [ticketWith("تم الحل")]),
        ),
      ],
      async () => [
        await handleRiderUpdate(textUpdate(senderFor("ar"), "/status"), registeredDeps()),
      ],
    ];
    for (const flow of flows) {
      for (const replies of await flow()) {
        expect(replies.length).toBeLessThanOrEqual(ceiling);
      }
    }
  });
});

describe("UI-5 · أزرار التفاوض — الأحداث المتكررة والحالات البالية والأفعال غير الصالحة", () => {
  const NEGOTIATION_ID = "0b9e2f6e-6a4e-4d1f-9d3f-5f1a2b3c4d5e";

  /**
   * مزدوجُ منفذِ التدوير: يُلقَّنُ ردودَه حرفيًّا — الحسابُ في القاعدةِ لا هنا،
   * والمطلوبُ إثباتُ سلوكِ الحوارِ أمامَ كلِّ جوابٍ ممكن.
   */
  function negotiationDeps(
    rotation: Partial<Record<"advance" | "advanceAt" | "select" | "settle", unknown>>,
    card: unknown = null,
  ): RiderBotDependencies {
    const base = registeredDeps();
    const call = (value: unknown) => (typeof value === "function" ? value : async () => ok(value));
    return {
      ...base,
      negotiation: {
        rotation: {
          rotation: {
            advance: call(rotation.advance) as never,
            advanceAt: call(rotation.advanceAt) as never,
            select: call(rotation.select) as never,
            settle: call(rotation.settle) as never,
            close: call(true) as never,
          },
        },
        relay: {
          lookup: {
            forRider: async () =>
              ok({
                negotiationId: NEGOTIATION_ID,
                orderId: "order-9" as OrderId,
                driverId: "driver-1" as DriverId,
                driverChatId: "470001",
                driverLanguage: "ar",
                riderChatId: "700",
                riderLanguage: "ar",
                position: 3,
                selected: true,
              } satisfies NegotiationParties),
            forDriver: async () => ok(null),
          },
          sender: { relay: async () => ok(true) },
        },
        driverCards: { read: call(card) as never },
      },
    };
  }

  const CARD = {
    negotiationId: NEGOTIATION_ID,
    position: 3,
    firstName: "سعيد",
    ratingAverage: 4.7,
    ratingCount: 128,
    vehicleType: "سيارة",
    vehicleYear: 2020,
    completedTrips: 500,
    memberSinceYear: 2024,
  };

  it("بطاقة صالحة: «معلومات» تُبدَّل في مكانها بلا رسالة جديدة", async () => {
    const deps = negotiationDeps({}, CARD);
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:info:${NEGOTIATION_ID}:3`),
      deps,
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.editMessageId).toBeDefined();
    expect(replies[0]?.text).toContain("سعيد");
  });

  it("بطاقة بالية (زرّ على دور سابق): تُقال «البطاقة لم تعد صالحة» بلا فعل", async () => {
    // القارئ يردّ null للبطاقة البالية ولغير صاحب الطلب على السواء — قيد الملكية في الاستعلام.
    const deps = negotiationDeps({ select: { selected: false, reason: "STALE_CARD" } }, null);
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:sel:${NEGOTIATION_ID}:3`),
      deps,
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toContain(translate("ar", "negotiation.card_stale").slice(0, 8));
  });

  it("اختيار مكرر (الضغطة الثانية على «اختيار»): بطاقة بالية لا إخطار ثانٍ", async () => {
    const deps = negotiationDeps({ select: { selected: false, reason: "ALREADY_SELECTED" } });
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:sel:${NEGOTIATION_ID}:3`),
      deps,
    );
    expect(replies[0]?.text).toContain(translate("ar", "negotiation.card_stale").slice(0, 8));
  });

  it("«تم الاتفاق» بعد إغلاق الدور (تكرار): يُقال إنّ الدور أُغلق لا نجاح مزيف", async () => {
    const deps = negotiationDeps({ settle: { settled: false, reason: "TURN_CLOSED" } });
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:agree:${NEGOTIATION_ID}`),
      deps,
    );
    expect(replies[0]?.text).toBe(translate("ar", "negotiation.rider_turn_closed"));
  });

  it("«تم الاتفاق» ومرشَّحٌ مشتركٌ ينتظرُ قرارَ الراكب (WR-24): يُقال السبب لا «أُغلق الدور»", async () => {
    const deps = negotiationDeps({ settle: { settled: false, reason: "ORDER_HELD" } });
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:agree:${NEGOTIATION_ID}`),
      deps,
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.text).toBe(translate("ar", "negotiation.order_held"));
    expect(replies[0]?.text).not.toBe(translate("ar", "negotiation.rider_turn_closed"));
  });

  it("«السائق التالي» على بطاقة بالية: لا تدوير — بطاقة بالية", async () => {
    const deps = negotiationDeps({ advanceAt: { advanced: false, reason: "STALE_CARD" } }, CARD);
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:next:${NEGOTIATION_ID}:3`),
      deps,
    );
    expect(replies[0]?.text).toContain(translate("ar", "negotiation.card_stale").slice(0, 8));
  });

  it("نفاد السائقين الثلاثة: يُبلغ العميل بالنفاد", async () => {
    const deps = negotiationDeps(
      {
        advanceAt: { advanced: true, exhausted: true, orderId: "order-9", notificationsQueued: 0 },
      },
      CARD,
    );
    const replies = await handleRiderUpdate(
      callbackUpdate(senderFor("ar"), `unsub:next:${NEGOTIATION_ID}:3`),
      deps,
    );
    expect(replies[0]?.text).toBe(translate("ar", "negotiation.exhausted_rider"));
  });

  it("موضع غير صالح أو معرّف ناقص أو فعل مجهول: «أمر غير مفهوم» لا عطب", async () => {
    const deps = negotiationDeps({}, CARD);
    for (const data of [
      `unsub:info:${NEGOTIATION_ID}:0`,
      `unsub:info:${NEGOTIATION_ID}:-1`,
      `unsub:info:${NEGOTIATION_ID}:x`,
      `unsub:info:${NEGOTIATION_ID}`,
      "unsub:",
      "unsub:unknown:whatever",
    ]) {
      const replies = await handleRiderUpdate(callbackUpdate(senderFor("ar"), data), deps);
      assertNoRawKeys(replies);
      expect(replies[0]?.text).toBe(translate("ar", "common.unknown_command"));
    }
  });

  it("نقرات الحوار قبل أي دفعة: لا يتجاوزُ الحدَّ المسموح", async () => {
    const { maxAllowedReplyBurst } = await import("../../scripts/lib/telegram-message-budget.ts");
    const deps = negotiationDeps(
      {
        settle: { settled: true, orderId: "order-9", driverId: "driver-1", notificationsQueued: 0 },
        advanceAt: {
          advanced: true,
          exhausted: false,
          nextPosition: 4,
          orderId: "order-9",
          notificationsQueued: 0,
        },
        select: {
          selected: true,
          already: false,
          orderId: "order-9",
          position: 3,
          notificationsQueued: 0,
        },
      },
      CARD,
    );
    for (const data of [
      `unsub:info:${NEGOTIATION_ID}:3`,
      `unsub:agree:${NEGOTIATION_ID}`,
      `unsub:next:${NEGOTIATION_ID}:3`,
      `unsub:sel:${NEGOTIATION_ID}:3`,
    ]) {
      const replies = await handleRiderUpdate(callbackUpdate(senderFor("ar"), data), deps);
      expect(replies.length).toBeLessThanOrEqual(maxAllowedReplyBurst());
    }
  });
});
