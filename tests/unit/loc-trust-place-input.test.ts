/**
 * الغرض: قياسُ `LOC-TRUST-01` (ADR 0247) من طرفٍ إلى طرف — بلا قاعدة:
 *   ١. (واجهةُ الراكبِ في `loc-trust-place-ui.test.ts`.)
 *   ٢. الحكمُ على الدقّة: جيّدةٌ · خشنةٌ (تحتاجُ إقراراً) · رديئةٌ (تُرفَضُ) — بعتباتٍ من ADR 0015.
 *   ٣. الروابط: Google Maps بنقطة، ورابطٌ مختصرٌ بلا نقطةٍ يُحفَظُ حرفاً، ومشاركةُ واتساب، ومضيفٌ مجهولٌ مرفوض.
 *   ٤. عقدُ الخادم `readPlaceMeta`: الرابطُ يطابقُ النقطة، والملاحظاتُ محدودة، وقراءةٌ رديئةٌ تُرفَض.
 *   ٥. السلسلة: جسمُ الطلبِ ← حالةُ الاستخدام ← المخزنُ (`request_ride_with_places`) ← بطاقةُ السائق.
 *   ٦. أقربُ معلَمٍ لا يصيرُ اسماً، ولا إحداثيّةَ ولا رابطَ ولا ملاحظةَ في السجلّات.
 * ينتمي إلى: tests/unit · يُستخدم من: CI.
 * ما لا يفعلُه: لا يدّعي أنَّ الهجرةَ مُطبَّقةٌ حيّاً — ذاكَ في `tests/integration/place-input.test.ts` والإنتاج.
 */
import { describe, expect, it } from "bun:test";
import type { Keyboard } from "../../packages/application/bots/types.ts";
import { isUrlButton } from "../../packages/application/bots/types.ts";
import type { OfferNotification } from "../../packages/application/dispatch/broadcast-offers.ts";
import { requestRide } from "../../packages/application/transport/request-ride.ts";
import type { RideRequestCommand } from "../../packages/application/transport/ride-request-ports.ts";
import { NEAREST_LANDMARK_DESCRIBES_WITHIN_M } from "../../packages/domain/destinations/landmark-kinds.ts";
import { DEFAULT_GPS_POLICY } from "../../packages/domain/geo/gps-fix.ts";
import type { DistanceKm } from "../../packages/domain/geo/value-objects.ts";
import {
  assessDeviceFix,
  linkConflictsWithPoint,
  PLACE_ACCURACY_GOOD_M,
  PLACE_ACCURACY_UNRELIABLE_M,
  PLACE_LINK_CONFLICT_M,
  PLACE_NOTES_MAX_LENGTH,
  parseCoordinateText,
  parsePlaceLink,
  readPlaceMeta,
} from "../../packages/domain/places/place-input.ts";
import { navigationUrlFor, openUrlFor } from "../../packages/domain/places/place-open-url.ts";
import { DEFAULT_OPERATIONS_POLICY } from "../../packages/domain/tracking/operations-status.ts";
import type { Sql } from "../../packages/infrastructure/db/client.ts";
import { createOfferPublisher } from "../../packages/infrastructure/notification/telegram-driver-notifier.ts";
import type { IdentifyingSender } from "../../packages/infrastructure/notification/telegram-negotiation-notifier.ts";
import { createRideRequestCommand } from "../../packages/infrastructure/transport/ride-request-store.ts";
import type { DriverId, OfferId, OrderId } from "../../packages/shared/kernel/index.ts";
import { isOk, ok } from "../../packages/shared/result/index.ts";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const POINT = { lat: 24.4672, lng: 39.6111 };
const GOOGLE_LINK = `https://www.google.com/maps/place/x/@24.46,39.60,17z/data=!3d${POINT.lat}!4d${POINT.lng}`;
const SHORT_LINK = "https://maps.app.goo.gl/AbCdEf12345";

describe("العتباتُ مأخوذةٌ من الكودِ لا مخترَعة", () => {
  it("الجيّدةُ = حدُّ ADR 0015، والرديئةُ = مدى وصفِ المعلَم، والتعارضُ = نصفُ قطرِ الوصول", () => {
    expect(PLACE_ACCURACY_GOOD_M).toBe(DEFAULT_GPS_POLICY.maxAccuracyMeters);
    expect(PLACE_ACCURACY_UNRELIABLE_M).toBe(NEAREST_LANDMARK_DESCRIBES_WITHIN_M);
    expect(PLACE_LINK_CONFLICT_M).toBe(DEFAULT_OPERATIONS_POLICY.arrivalRadiusKm * 1000);
  });
});

describe("قراءةُ الجهازِ الحديثة", () => {
  it("قراءةٌ حديثةٌ دقيقةٌ ⇒ GOOD", () => {
    expect(assessDeviceFix({ accuracyM: 15, capturedAtMs: NOW - 2_000, nowMs: NOW }).verdict).toBe(
      "GOOD",
    );
  });

  it("دقّةٌ سيّئةٌ ⇒ UNRELIABLE (لا تُعتمَد)، وخشنةٌ ⇒ COARSE (تحتاجُ إقراراً)", () => {
    expect(assessDeviceFix({ accuracyM: 2_500, capturedAtMs: NOW, nowMs: NOW }).verdict).toBe(
      "UNRELIABLE",
    );
    const coarse = assessDeviceFix({ accuracyM: 400, capturedAtMs: NOW, nowMs: NOW });
    expect(coarse.verdict).toBe("COARSE");
    expect(coarse.reasons).toContain("ACCURACY_COARSE");
  });

  it("قراءةُ Telegram بلا طابعٍ لا تبلغُ GOOD أبداً (الحداثةُ غيرُ مُثبَتة)", () => {
    const telegram = assessDeviceFix({ accuracyM: 10, capturedAtMs: null, nowMs: NOW });
    expect(telegram.verdict).toBe("COARSE");
    expect(telegram.reasons).toContain("FRESHNESS_UNKNOWN");
  });
});

describe("الروابطُ والإحداثيّات", () => {
  it("رابطُ Google Maps: النقطةُ من !3d!4d لا من مركزِ العرض @", () => {
    const parsed = parsePlaceLink(GOOGLE_LINK);
    expect("refusal" in parsed).toBe(false);
    if ("refusal" in parsed) return;
    expect(parsed.kind).toBe("GOOGLE_MAPS");
    expect(parsed.point).toEqual(POINT);
    expect(parsed.raw).toBe(GOOGLE_LINK);
  });

  it("رابطٌ مختصرٌ لا يُقرأُ بلا شبكة: يُقبَلُ بلا نقطةٍ ويُحفَظُ حرفاً", () => {
    const parsed = parsePlaceLink(SHORT_LINK);
    if ("refusal" in parsed) throw new Error("مرفوض");
    expect(parsed.kind).toBe("GOOGLE_SHORT");
    expect(parsed.point).toBeNull();
    expect(parsed.raw).toBe(SHORT_LINK);
  });

  it("رسالةُ واتساب: يُستخرَجُ الرابطُ من النصِّ بلا علامةِ الترقيمِ اللاصقة", () => {
    const parsed = parsePlaceLink(`موقعي هنا: ${SHORT_LINK}.`);
    if ("refusal" in parsed) throw new Error("مرفوض");
    expect(parsed.raw).toBe(SHORT_LINK);
  });

  it("مضيفٌ غيرُ خرائطيٍّ مرفوض، وإحداثيّاتٌ ملصوقةٌ تُقرأُ نقطة", () => {
    expect(parsePlaceLink("https://evil.example/maps?q=24,39")).toEqual({
      refusal: "UNSUPPORTED_HOST",
    });
    expect(parseCoordinateText("24.4672, 39.6111")).toEqual(POINT);
  });

  it("رابطٌ نقطتُه أبعدُ من 150 م عن النقطةِ المختارةِ تعارض", () => {
    expect(linkConflictsWithPoint(POINT, { lat: POINT.lat + 0.01, lng: POINT.lng })).toBe(true);
    expect(linkConflictsWithPoint(POINT, { lat: POINT.lat + 0.0005, lng: POINT.lng })).toBe(false);
    expect(linkConflictsWithPoint(null, POINT)).toBe(false);
  });

  it("فتحُ المكانِ للسائق: الرابطُ الأصليُّ إن وُجِدَ، وإلّا خرائطُ من النقطة", () => {
    expect(openUrlFor({ link: SHORT_LINK, latitude: POINT.lat, longitude: POINT.lng })).toBe(
      SHORT_LINK,
    );
    expect(openUrlFor({ link: null, latitude: POINT.lat, longitude: POINT.lng })).toBe(
      navigationUrlFor({ latitude: POINT.lat, longitude: POINT.lng }),
    );
    expect(openUrlFor({ link: null, latitude: null, longitude: null })).toBeNull();
  });
});

describe("عقدُ الخادم readPlaceMeta", () => {
  it("اسمٌ + نقطةٌ + ملاحظاتٌ + رابطٌ مختصر: كلُّه يُحفَظُ كما هو", () => {
    const read = readPlaceMeta(
      {
        source: "DEVICE",
        accuracyM: 8.26,
        capturedAt: new Date(NOW - 1_000).toISOString(),
        link: SHORT_LINK,
        notes: "البوابة 3",
      },
      POINT,
      NOW,
    );
    expect(read).toEqual({
      meta: {
        source: "DEVICE",
        accuracyM: 8.3,
        capturedAt: new Date(NOW - 1_000).toISOString(),
        link: SHORT_LINK,
        notes: "البوابة 3",
      },
    });
  });

  it("SHARED_LINK يجبُ أن تطابقَ نقطتُه النقطةَ المُرسَلة", () => {
    expect(readPlaceMeta({ source: "SHARED_LINK", link: GOOGLE_LINK }, POINT, NOW)).toMatchObject({
      meta: { source: "SHARED_LINK", link: GOOGLE_LINK },
    });
    expect(readPlaceMeta({ source: "SHARED_LINK", link: SHORT_LINK }, POINT, NOW)).toEqual({
      refusal: "PLACE_INVALID",
    });
    expect(
      readPlaceMeta({ source: "SHARED_LINK", link: GOOGLE_LINK }, { lat: 24.5, lng: 39.7 }, NOW),
    ).toEqual({ refusal: "PLACE_INVALID" });
  });

  it("رابطٌ يدلُّ على مكانٍ آخرَ يُرفَضُ لأيِّ مصدر", () => {
    expect(
      readPlaceMeta({ source: "SUGGESTION", link: GOOGLE_LINK }, { lat: 24.5, lng: 39.7 }, NOW),
    ).toEqual({ refusal: "PLACE_INVALID" });
  });

  it("قراءةُ جهازٍ رديئةٌ تُرفَضُ في الخادمِ أيضاً، والملاحظاتُ الطويلةُ مرفوضة، والمضيفُ المجهول", () => {
    expect(readPlaceMeta({ source: "DEVICE", accuracyM: 3_000 }, POINT, NOW)).toEqual({
      refusal: "PLACE_POINT_UNRELIABLE",
    });
    expect(
      readPlaceMeta(
        { source: "MAP_PIN", notes: "x".repeat(PLACE_NOTES_MAX_LENGTH + 1) },
        POINT,
        NOW,
      ),
    ).toEqual({ refusal: "PLACE_NOTES_TOO_LONG" });
    expect(
      readPlaceMeta({ source: "MAP_PIN", link: "https://evil.example/x" }, POINT, NOW),
    ).toEqual({ refusal: "PLACE_LINK_UNSUPPORTED" });
    expect(readPlaceMeta({ source: "NOPE" }, POINT, NOW)).toEqual({ refusal: "PLACE_INVALID" });
  });

  it("الاقتراحُ والمحفوظُ والإحداثيّاتُ مصادرُ مقبولة، والغيابُ مقبولٌ (عميلٌ أقدم)", () => {
    for (const source of ["SUGGESTION", "SAVED", "MAP_PIN"]) {
      expect(readPlaceMeta({ source }, POINT, NOW)).toMatchObject({ meta: { source } });
    }
    expect(readPlaceMeta(undefined, POINT, NOW)).toEqual({ meta: null });
  });
});

// ─── السلسلة: الطلب ← المخزن ← بطاقة السائق ─────────────────────────────────

const ORDER_ID = "3f1c9a02-4b7e-4d21-9f88-0a1b2c3d4e5f";

describe("حالةُ الاستخدام ← المخزن", () => {
  function captureCommand() {
    const seen: unknown[] = [];
    const rides: RideRequestCommand = {
      create: async (input) => {
        seen.push(input);
        return ok({
          accepted: true,
          ride: { orderId: ORDER_ID, createdAtMs: NOW, reused: false },
        });
      },
    } as RideRequestCommand;
    const deps = {
      sessions: { read: async () => ok({ telegramUserId: "1" }) },
      rides,
      now: () => new Date(NOW),
    } as unknown as Parameters<typeof requestRide>[0];
    return { seen, deps };
  }

  const BODY = {
    service: "transport",
    originLat: POINT.lat,
    originLng: POINT.lng,
    destinationLat: 24.4867,
    destinationLng: 39.6011,
    pickupLabel: "عمارة الريان",
    destinationLabel: "المسجد النبوي",
  };

  it("pickupPlace/dropoffPlace تصلُ المخزنَ كاملةً", async () => {
    const { seen, deps } = captureCommand();
    const result = await requestRide(deps, {
      accessToken: "t",
      idempotencyKey: "ride:6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f60",
      body: {
        ...BODY,
        pickupPlace: { source: "SHARED_LINK", link: GOOGLE_LINK, notes: "عند البوابة" },
        dropoffPlace: { source: "SUGGESTION", notes: "الباب 21" },
      },
    });
    expect(isOk(result)).toBe(true);
    expect(seen[0]).toMatchObject({
      pickupLabel: "عمارة الريان",
      pickupPlace: { source: "SHARED_LINK", link: GOOGLE_LINK, notes: "عند البوابة" },
      dropoffPlace: { source: "SUGGESTION", notes: "الباب 21", link: null },
    });
  });

  it("مكانٌ غيرُ صالحٍ يُرفَضُ قبلَ المخزن — فلا تُنشَأُ رحلة", async () => {
    const { seen, deps } = captureCommand();
    const result = await requestRide(deps, {
      accessToken: "t",
      idempotencyKey: "ride:6f2a1c48-8b0e-4e65-9d8a-2b1c3d4e5f61",
      body: { ...BODY, pickupPlace: { source: "DEVICE", accuracyM: 5_000 } },
    });
    expect(result).toMatchObject({ ok: false, error: "PLACE_POINT_UNRELIABLE" });
    expect(seen).toHaveLength(0);
  });

  // `WR-05`: المخزنُ ينادي غلافَ السياسةِ دائماً، وهو يُفوِّضُ إلى `request_ride_with_places`
  // (والمكانُ الغائبُ `null` مقبولٌ فيه) — فالحكمُ على المكانَين باقٍ في القاعدة.
  it("المخزنُ يمرِّرُ المكانَ jsonb حينَ يوجدُ و`null` حينَ يغيب", async () => {
    const calls: { text: string; values: readonly unknown[] }[] = [];
    const sql = {
      unsafe: async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values });
        return [
          {
            result: {
              ok: true,
              reused: false,
              order_id: ORDER_ID,
              created_at: new Date(NOW).toISOString(),
            },
          },
        ];
      },
    } as unknown as Sql;
    const input = {
      telegramUserId: "1",
      idempotencyKey: "ride:k",
      service: "transport",
      origin: POINT,
      destination: { lat: 24.4867, lng: 39.6011 },
      notes: null,
    } as const;
    await createRideRequestCommand(sql).create(input);
    expect(calls[0]?.text).toContain("request_ride_with_offer");
    expect(calls[0]?.values[12]).toBeNull();
    expect(calls[0]?.values[13]).toBeNull();
    await createRideRequestCommand(sql).create({
      ...input,
      pickupPlace: {
        source: "MAP_PIN",
        accuracyM: null,
        capturedAt: null,
        link: SHORT_LINK,
        notes: "ن",
      },
    });
    expect(calls[1]?.text).toContain("request_ride_with_offer");
    expect(JSON.parse(String(calls[1]?.values[12]))).toEqual({
      point_source: "MAP_PIN",
      accuracy_m: null,
      captured_at: null,
      link: SHORT_LINK,
      notes: "ن",
    });
    expect(calls[1]?.values[13]).toBeNull();
  });
});

describe("بطاقةُ السائقِ في Telegram — لا تسقطُ معلومة", () => {
  function sqlWithExtras(extras: Record<string, unknown> | null): Sql {
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("pickup_link")) return Promise.resolve(extras === null ? [] : [extras]);
      return Promise.resolve([{ telegram_id: "999", language_code: "ar" }]);
    }) as unknown as Sql;
    (sql as unknown as { array: (v: unknown) => unknown }).array = (v) => v;
    return sql;
  }

  const NOTIFICATION: OfferNotification = {
    orderId: ORDER_ID as OrderId,
    offerId: "offer-1" as OfferId,
    driverId: "drv-1" as DriverId,
    distanceKm: 2 as DistanceKm,
    expiresInSeconds: 30,
    service: "transport",
    pickupLabel: null,
    dropoffLabel: "المسجد النبوي",
    notes: null,
  };

  it("ملاحظاتُ المكانين والرابطُ الأصليُّ وزرّا الفتح، ولا يُخترَعُ اسمٌ للالتقاط", async () => {
    const sends: { text: string; keyboard: Keyboard | null }[] = [];
    const sender: IdentifyingSender = {
      sendReturningId: async (_chat, text, keyboard) => {
        sends.push({ text, keyboard });
        return "m1";
      },
    };
    const publisher = createOfferPublisher(
      sqlWithExtras({
        id: ORDER_ID,
        pickup_link: SHORT_LINK,
        pickup_notes: "عند البوابة 3",
        pickup_lat: POINT.lat,
        pickup_lng: POINT.lng,
        has_dropoff: true,
        dropoff_link: null,
        dropoff_notes: "الباب 21",
        dropoff_lat: 24.4867,
        dropoff_lng: 39.6011,
      }),
      sender,
    );
    const result = await publisher.publishOffer(NOTIFICATION);
    expect(isOk(result)).toBe(true);
    const sent = sends[0];
    if (sent === undefined) throw new Error("لم يُرسَل");
    expect(sent.text).toContain("عند البوابة 3");
    expect(sent.text).toContain("الباب 21");
    expect(sent.text).toContain(SHORT_LINK);
    expect(sent.text).toContain("نقطة محدّدة على الخريطة");
    expect(sent.text).not.toContain("مسجد بلال");
    if (sent.keyboard?.kind !== "inline") throw new Error("لوحةٌ غيرُ مضمَّنة");
    const urls = sent.keyboard.rows
      .flat()
      .filter(isUrlButton)
      .map((b) => b.url);
    expect(urls).toEqual([SHORT_LINK, navigationUrlFor({ latitude: 24.4867, longitude: 39.6011 })]);
  });

  it("رفضُ Telegram لأزرارِ الروابطِ يُعيدُ الإرسالَ بلا روابط — لا تضيعُ البطاقة", async () => {
    const sends: (Keyboard | null)[] = [];
    const sender: IdentifyingSender = {
      sendReturningId: async (_chat, _text, keyboard) => {
        sends.push(keyboard);
        return sends.length === 1 ? null : "m2";
      },
    };
    const publisher = createOfferPublisher(
      sqlWithExtras({
        id: ORDER_ID,
        pickup_link: null,
        pickup_notes: null,
        pickup_lat: POINT.lat,
        pickup_lng: POINT.lng,
        has_dropoff: false,
        dropoff_link: null,
        dropoff_notes: null,
        dropoff_lat: null,
        dropoff_lng: null,
      }),
      sender,
    );
    const result = await publisher.publishOffer(NOTIFICATION);
    expect(isOk(result) && result.value).toBe("m2");
    expect(sends).toHaveLength(2);
    const second = sends[1];
    if (second?.kind !== "inline") throw new Error("لوحةٌ غيرُ مضمَّنة");
    expect(second.rows.flat().some(isUrlButton)).toBe(false);
  });
});

describe("لا بياناتٍ شخصيّةً في السجلّات", () => {
  it("مسارُ المكانِ كلُّه لا يكتبُ في console", async () => {
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    const written: string[] = [];
    const capture = (...args: unknown[]) => written.push(args.map(String).join(" "));
    console.log = capture;
    console.info = capture;
    console.warn = capture;
    console.error = capture;
    try {
      readPlaceMeta({ source: "SHARED_LINK", link: GOOGLE_LINK, notes: "سرّي" }, POINT, NOW);
      parsePlaceLink(GOOGLE_LINK);
      openUrlFor({ link: GOOGLE_LINK, latitude: POINT.lat, longitude: POINT.lng });
      const failing = {
        unsafe: async () => {
          throw new Error("x");
        },
      } as unknown as Sql;
      await createRideRequestCommand(failing).create({
        telegramUserId: "1",
        idempotencyKey: "ride:k",
        service: "transport",
        origin: POINT,
        destination: POINT,
        notes: null,
        pickupPlace: {
          source: "MAP_PIN",
          accuracyM: null,
          capturedAt: null,
          link: GOOGLE_LINK,
          notes: "سرّي",
        },
      });
    } finally {
      Object.assign(console, original);
    }
    const joined = written.join("\n");
    expect(joined).not.toContain(String(POINT.lat));
    expect(joined).not.toContain("سرّي");
    expect(joined).not.toContain("google.com");
  });
});
