/**
 * الغرض: `WR-15` (ADR 0265) — أزرارُ بوتِ السائقِ (قبولُ العرضِ، وبدءُ الرحلةِ،
 *   وإنهاؤها) تودعُ إخطارَ الطورِ للراكبِ في صندوقِ الصادرِ بالمفتاحِ نفسِه الذي يودعُه
 *   مسارُ Mini App، **ولا ترسلُ رسالةً مباشرةً موازية** — فلا يصلُ الراكبَ إخطاران
 *   لطورٍ واحدٍ من مسارين، والعاملُ وحدَه يرسلُ ويعيدُ ويعلنُ الفشلَ النهائيّ.
 * الحالة: اختبارُ وحدةٍ لتنسيقِ الحوار — أُضيفَ 2026-10-12. ومنعُ التكرارِ نفسُه حكمُ
 *   الفهرسِ الفريدِ في القاعدة، يقيسُه `tests/integration/wr-15-rider-trip-notice-outbox.test.ts`.
 * ينتمي إلى: tests/unit
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createMemorySessionStore } from "../../apps/gateway/src/bots/shared/session.ts";
import {
  type DriverBotDependencies,
  handleDriverUpdate,
} from "../../packages/application/bots/driver-dialog.ts";
import {
  handleCompleteRide,
  handleStartRide,
  type RatingDialogDependencies,
} from "../../packages/application/bots/rating-dialog.ts";
import type { IncomingUpdate, Sender } from "../../packages/application/bots/types.ts";
import type {
  RiderTripEvent,
  RiderTripNoticeDeps,
} from "../../packages/application/driver/rider-trip-notice.ts";
import type {
  CompletionSummary,
  RatingPort,
  RideLifecyclePort,
  StartSummary,
} from "../../packages/application/reputation/index.ts";
import { translate } from "../../packages/shared/i18n/index.ts";
import type { CityId, OrderId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";
import {
  cityDirectory,
  driverDirectory,
  JEDDAH,
  offerDecisionPort,
  subscriptionReader,
  trialPort,
  verifiedDriver,
} from "../support/bot-doubles.ts";
import { fixedClock, seededRows, settingsRepo } from "../support/in-memory-ports.ts";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const SENDER: Sender = { telegramUserId: "900", chatId: "900", languageHint: "ar" };
const ORDER = "order-wr15" as OrderId;

let enqueued: { orderId: string; event: RiderTripEvent }[];
let direct: { telegramId: string; text: string }[];
let logged: string[];
/** المفتاحُ في القاعدةِ `(kind, dedup_key)`؛ والبديلُ هنا يحاكيه ليُقرأَ `created`. */
let seen: Set<string>;

function outboxDeps(): RiderTripNoticeDeps {
  return {
    outbox: {
      enqueue: async (orderId, event) => {
        enqueued.push({ orderId, event });
        const key = `rider_trip:${orderId}:${event}`;
        const created = !seen.has(key);
        seen.add(key);
        return { created };
      },
    },
    log: (event) => logged.push(event),
  };
}

const counterpart = {
  notify: async (telegramId: string, text: string) => {
    direct.push({ telegramId, text });
  },
};

function claimEnvelope(duplicate: boolean) {
  return {
    claimed: true,
    duplicate,
    reason: null,
    cityId: JEDDAH.id as CityId,
    rider: duplicate
      ? null
      : { riderId: "rider-1", telegramId: "5551", languageCode: "ar", fullName: "سميرة" },
    driverName: "أحمد",
    driverPlate: "أ ب ج 1",
    driverVehicle: "sedan",
  };
}

function driverDeps(duplicateOnSecond: boolean): DriverBotDependencies {
  let calls = 0;
  return {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    drivers: driverDirectory(verifiedDriver()),
    cities: cityDirectory(),
    settings: settingsRepo(seededRows(JEDDAH.id)),
    subscriptions: subscriptionReader(null),
    trial: trialPort(true),
    dispatch: {
      claimRide: async () => {
        calls += 1;
        return ok(claimEnvelope(duplicateOnSecond && calls > 1));
      },
    },
    offers: offerDecisionPort(),
    clock: fixedClock(NOW),
    riderNotice: outboxDeps(),
    // الإرسالُ المباشرُ القديمُ مربوطٌ عمداً: الاختبارُ يُثبتُ أنَّه **لا يُستدعى**.
    acceptNotice: { counterpart },
  };
}

function callback(data: string): IncomingUpdate {
  return { kind: "callback", from: SENDER, updateId: 1, data };
}

const rider = { telegramId: "600", languageCode: "en", fullName: "Mona" };
const driver = { telegramId: "500", languageCode: "ar", fullName: "خالد" };

function ratingDeps(): RatingDialogDependencies {
  const start: StartSummary = {
    orderId: ORDER,
    service: "transport",
    pickupLabel: null,
    dropoffLabel: null,
    driver,
    rider,
  };
  const done: CompletionSummary = { ...start, durationSeconds: 600 };
  return {
    sessions: createMemorySessionStore(fixedClock(NOW)),
    lifecycle: {
      start: async () => ({ ok: true, value: { ok: true, reason: null, summary: start } }),
      complete: async () => ({ ok: true, value: { ok: true, reason: null, summary: done } }),
    } as unknown as RideLifecyclePort,
    ratings: {} as RatingPort,
    counterpart,
    riderNotice: outboxDeps(),
  };
}

beforeEach(() => {
  enqueued = [];
  direct = [];
  logged = [];
  seen = new Set();
});

describe("WR-15 — أزرارُ بوتِ السائقِ تودعُ إخطارَ الطورِ ولا ترسلُه مباشرة", () => {
  it("قبولُ العرضِ من رسالةِ البوت: صفُّ MATCHED واحدٌ، ولا رسالةَ مباشرةً للراكب", async () => {
    const replies = await handleDriverUpdate(callback(`offer:accept:${ORDER}`), driverDeps(false));
    expect(replies[0]?.text).toBe(translate("ar", "driver.offer_accepted"));
    expect(enqueued).toEqual([{ orderId: String(ORDER), event: "MATCHED" }]);
    expect(direct).toHaveLength(0);
    expect(logged).toEqual(["rider_trip_notice.created"]);
  });

  it("النقرةُ المكرَّرةُ للفائز: الإيداعُ الثاني يُطوى بالمفتاح، ولا رسالةَ ثانية", async () => {
    const deps = driverDeps(true);
    await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    const second = await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    expect(second[0]?.text).toBe(translate("ar", "driver.offer_accepted"));
    expect(enqueued.map((row) => row.event)).toEqual(["MATCHED", "MATCHED"]);
    expect(logged).toEqual(["rider_trip_notice.created", "rider_trip_notice.deduplicated"]);
    expect(direct).toHaveLength(0);
  });

  it("بدءُ الرحلةِ من البوت: صفُّ STARTED، ولا `rating.started_rider` مباشرة", async () => {
    const replies = await handleStartRide(ORDER, SENDER, "ar", ratingDeps());
    expect(replies[0]?.text).toBe(translate("ar", "rating.ride_started"));
    expect(enqueued).toEqual([{ orderId: String(ORDER), event: "STARTED" }]);
    expect(direct).toHaveLength(0);
  });

  it("إنهاءُ الرحلةِ من البوت: صفُّ COMPLETED، وطلبُ التقييمِ وحدَه يبقى مباشراً", async () => {
    await handleCompleteRide(ORDER, SENDER, "ar", ratingDeps());
    expect(enqueued).toEqual([{ orderId: String(ORDER), event: "COMPLETED" }]);
    expect(direct).toEqual([
      {
        telegramId: "600",
        text: translate("en", "rating.ask_rating_driver", { driver: "خالد" }),
      },
    ]);
  });

  it("عطلُ الإيداعِ لا يُفسدُ قبولاً وقع: السائقُ يرى النجاحَ والفشلُ مسجَّل", async () => {
    const deps: DriverBotDependencies = {
      ...driverDeps(false),
      riderNotice: {
        outbox: {
          enqueue: async () => {
            throw new Error("db down");
          },
        },
        log: (event) => logged.push(event),
      },
    };
    const replies = await handleDriverUpdate(callback(`offer:accept:${ORDER}`), deps);
    expect(replies[0]?.text).toBe(translate("ar", "driver.offer_accepted"));
    expect(logged).toEqual(["rider_trip_notice.enqueue_failed"]);
    expect(direct).toHaveLength(0);
  });
});
