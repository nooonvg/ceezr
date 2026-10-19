/**
 * الغرض: `WASLA — الدورة ٤` — إثباتُ أنّ القارئَ الموحّدَ (`dutyAndTrip`) في
 *   `live-tracking.ts` يُنتجُ سلوكَ المسارِ القديمِ **حرفيًا** في القراراتِ
 *   والنشرِ، وأنّ كلَّ نداءٍ صارَ أقلَّ: استعلامٌ واحدٌ بدلَ اثنينِ في كلِّ
 *   إصلاحةِ موقعٍ على مسارِ `POST /v1/driver/location`.
 *
 *   ولماذا اختبارُ وحدةٍ هنا؟ لأنّ ما يُقاسُ هو **قرارُ التركيبِ** (أيُّ قارئٍ
 *   يُستعملُ ومتى) لا القاعدةَ نفسَها — وقرارُ التركيبِ يُختبرُ بمزدوجاتٍ
 *   مُحصاةِ النداءاتِ. أمّا صحةُ الاستعلامِ الموحّدِ نفسِهِ على قاعدةٍ حقيقيةٍ
 *   فدليلُهُ المستقلُّ في `tests/integration/tracking-duty-and-trip-reader.test.ts`.
 *
 *   والضماناتُ التي لا يجوزُ أن تتزعزعَ هنا:
 *   - بوّابةُ الخدمةِ قبلَ فتحِ الجلسةِ (المرحلة ١٢): خارجَ الخدمةِ = لا جلسةَ
 *     ولا بثًّ، وموقعُهُ محفوظٌ لا يُمسّ.
 *   - ترتيبُ النشرِ: نهايةٌ ثمّ بدايةُ الخَلَفِ، وبدايةٌ ثمّ موقعٌ (`BUG-009`).
 *   - الإرفاقُ عندَ تغيّرِ الرحلةِ في منتصفِ الجلسةِ (لا تسريبَ بثًّ لرحلةِ غيره).
 *   - فرعُ الخَلَفِ بعدَ `EXPIRED` يبقى على قراءتِهِ الطازجةِ كما كان.
 *
 * الحالة: اختبار وحدة فعلي — لا يتطلب قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ تعديلٍ على `dutyAndTrip` أو مسارِ `onFix`.
 */

import { describe, expect, it } from "bun:test";
import {
  createLiveTracking,
  type DriverDutyAndTripReader,
  type StoredFix,
} from "../../packages/application/tracking/live-tracking.ts";
import type { TrackingSessionStore } from "../../packages/tracking/session-store.ts";
import { createMemoryTrackingSessionStore } from "../../packages/tracking/session-store.ts";
import type { TrackingEvent } from "../../packages/tracking/types.ts";

const DRIVER = "driver-1";
const CITY = "city-jed";
const TRIP = "trip-1";
const OTHER_TRIP = "trip-2";

const fixAt = (recordedAtMs: number, over: Partial<StoredFix> = {}): StoredFix => ({
  driverId: DRIVER,
  cityId: CITY,
  latitude: 21.5471,
  longitude: 39.1751,
  recordedAtMs,
  accuracyMeters: 8,
  verdict: "ACCEPT",
  findings: [],
  ...over,
});

interface Counters {
  dutyAndTrip: number;
  activeTripOf: number;
  isOnDuty: number;
}

interface Harness {
  live: ReturnType<typeof createLiveTracking>;
  events: TrackingEvent[];
  counters: Counters;
  store: ReturnType<typeof createMemoryTrackingSessionStore>;
}

/**
 * التركيبُ نفسُهُ في كلِّ الاختباراتِ: قارئٌ موحّدٌ **مُحصاةٌ نداءاتُهُ**
 * وقارئانِ منفصلانِ **مُحصاةٌ نداءاتُهما**، ليُقاسَ عددُ الرحلاتِ لا ظهورُها
 * فقط. `useUnified` يقررُ المسارَ، والحالةُ (خدمة/رحلة) تُمرَّرُ للقارئَينِ
 * معًا فلا يختلفَ الحكمُ بينَ المسارينِ إلا بتركيبِ القراءةِ وحده.
 */
function buildHarness(
  nowMsRef: { value: number },
  state: { onDuty: boolean; activeTripId: string | null },
  useUnified: boolean,
  race?: {
    /**
     * يُنفَّذُ داخلَ انتظارِ `openSessionOf` — اللحظةُ التي تنتهي فيها الرحلةُ
     * بينَ اللقطةِ والقراءةِ المتأخرةِ، ويُمرّرُ للقارئَينِ معًا فيتصرفانِ
     * بالتسلسلِ نفسِه.
     */
    onBeforeOpenSessionOf?: () => void;
  },
): Harness {
  const counters: Counters = { dutyAndTrip: 0, activeTripOf: 0, isOnDuty: 0 };
  const events: TrackingEvent[] = [];
  const store = createMemoryTrackingSessionStore();
  const sessions: TrackingSessionStore =
    race?.onBeforeOpenSessionOf === undefined
      ? store
      : {
          ...store,
          openSessionOf: async (driverId) => {
            // الرحلةُ تنتهي هُنا — بعدَ اللقطةِ وقبلَ القراءةِ المتأخرةِ.
            race.onBeforeOpenSessionOf?.();
            return store.openSessionOf(driverId);
          },
        };
  const dutyAndTrip: DriverDutyAndTripReader = {
    dutyAndActiveTrip: async () => {
      counters.dutyAndTrip += 1;
      return { onDuty: state.onDuty, activeTripId: state.activeTripId };
    },
  };
  const live = createLiveTracking({
    sessions,
    publisher: {
      publish: async (event) => {
        events.push(event);
      },
    },
    trips: {
      activeTripOf: async () => {
        counters.activeTripOf += 1;
        return state.activeTripId;
      },
    },
    duty: {
      isOnDuty: async () => {
        counters.isOnDuty += 1;
        return state.onDuty;
      },
    },
    ...(useUnified ? { dutyAndTrip } : {}),
    clock: { now: () => new Date(nowMsRef.value) },
  });
  return { live, events, counters, store };
}

/**
 * معرّفُ الجلسةِ رقمٌ يولّدُهُ المخزنُ عشوائيًا، فلا يصحُّ أن يفرِّقَ بينَ مسارينِ
 * صحيحينِ — يُوحَّدُ في المقارنةِ ويبقى كلُّ ما عدا ذلكَ (النوعُ والترتيبُ
 * والرقمُ والرحلةُ والطوابعُ) خاضعًا للمساواةِ الصارمةِ.
 */
const comparable = (events: TrackingEvent[]) =>
  events.map((event) => ({ ...event, sessionId: "normalized" }));

describe("WASLA الدورة ٤ — القارئ الموحّد في onFix", () => {
  it("المسار الموحّد: استعلامٌ واحدٌ لا اثنانِ، والقراراتُ والنشرُ كما في المسار القديمِ حرفيًا", async () => {
    const now = { value: 10_000_000 };
    const state = { onDuty: true, activeTripId: null };
    const unified = buildHarness(now, state, true);
    const legacy = buildHarness(now, state, false);

    await unified.live.onFix(fixAt(now.value));
    await legacy.live.onFix(fixAt(now.value));

    // عددُ الرحلاتِ: البوابةُ في الموحّدِ استعلامٌ واحد، وفي القديمِ اثنانِ (خدمةٌ
    // ثمّ رحلة). وفتحُ الجلسةِ يقرأُ الرحلةَ قراءةً طازجةً في المسارينِ كما في
    // `main` — ولو كانت اللقطةُ فارغةً (الدفعة 19، `live-tracking-open-race.test.ts`).
    expect(unified.counters).toEqual({ dutyAndTrip: 1, activeTripOf: 1, isOnDuty: 0 });
    expect(legacy.counters).toEqual({ dutyAndTrip: 0, activeTripOf: 2, isOnDuty: 1 });

    // والسلوكُ واحدٌ: نفسُ أحداثِ النشرِ بنفسِ ترتيبِها ومضمونِها.
    expect(comparable(unified.events)).toEqual(comparable(legacy.events));
    expect(unified.events.map((e) => e.type)).toEqual(["session_started", "location_updated"]);
  });

  it("جلسةٌ تُفتحُ برحلةٍ محقّقةٍ بقراءةٍ طازجةٍ — لا على لقطةٍ قد تنتهي", async () => {
    const now = { value: 10_000_000 };
    const state = { onDuty: true, activeTripId: TRIP };
    const unified = buildHarness(now, state, true);

    await unified.live.onFix(fixAt(now.value));

    const open = await unified.store.openSessionOf(DRIVER);
    expect(open?.facts.tripId).toBe(TRIP);
    // الفتحُ لا يقبلُ لقطةً غيرَ فارغةٍ: رحلةٌ طازجةٌ تحقّقَ منها (مرةً في عمرِ الجلسة).
    expect(unified.counters.dutyAndTrip).toBe(1);
    expect(unified.counters.activeTripOf).toBe(1);
    const started = unified.events.find((e) => e.type === "session_started");
    expect(started?.tripId).toBe(TRIP);
  });

  it("تغيّرُ الرحلةِ بينَ إصلاحتينِ يُرفَقُ بلقطةِ الإصلاحةِ نفسِها — لا تسريبَ بثًّا لرحلةِ غيره", async () => {
    const now = { value: 10_000_000 };
    const state = { onDuty: true, activeTripId: TRIP };
    const h = buildHarness(now, state, true);

    await h.live.onFix(fixAt(now.value));
    expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);

    // الإسنادُ تغيّرَ بعدَ لقطةِ الإصلاحةِ الأولى (أو بينَها وبينَ الثانية).
    state.activeTripId = OTHER_TRIP;
    now.value += 20_000;
    await h.live.onFix(fixAt(now.value));

    // الإصلاحةُ الثانيةُ رأت الرحلةَ الجديدةَ في لقطتِها فتحقّقت منها بقراءةٍ
    // طازجةٍ (تغيّرُ رحلةٍ نادرٌ: مرةً في عمرِ كلِّ رحلة) وأرفقتها.
    expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(OTHER_TRIP);
    // وكلُّ ذلكَ باستعلامِ خدمةٍ ورحلةٍ واحدٍ في كلِّ إصلاحةٍ (لا إعادةِ قراءةٍ
    // في المسارِ الحارّ) — والفتحُ الأولُ وتغيّرُ الرحلةِ وحدَهما تحقّقا
    // بقراءةٍ طازجةٍ.
    expect(h.counters.dutyAndTrip).toBe(2);
    expect(h.counters.activeTripOf).toBe(2);
  });

  it("السباقُ الحتميّ: رحلةٌ تنتهي داخلَ انتظارِ الجلسةِ (بعدَ اللقطةِ وقبلَ الإرفاقِ) فلا تُرفَقُ — المسارانِ معًا", async () => {
    // التسلسلُ الذي يُغلقُهُ الإرفاقُ الذرّيُّ: لقطةٌ ترى رحلةً نشطةً، ثمّ تنتهي
    // الرحلةُ أثناءَ انتظارِ الجلسةِ (يمرُّ closeByTrip فلا يجدُ جلسةً مرفقةً)،
    // ثمّ يُتّخذَ قرارُ الإرفاقِ منَ اللقطةِ القديمةِ. في المسارِ الموحّدِ يُرفَقُ
    // منَ اللقطةِ فيرتدّهُ شرطُ النشاطِ؛ وفي المسارِ القديمِ تُعيدُ قراءتُهُ المتأخرةُ
    // رحلةً منتهيةً فلا إرفاقَ. النتيجةُ واحدةٌ في الاثنَينِ: الجلسةُ لا تبقى على
    // رحلةٍ منتهيةٍ، ولا حدثَ يحملُ رحلةً انتهت.
    const runRace = async (useUnified: boolean) => {
      const now = { value: 10_000_000 };
      const state: { onDuty: boolean; activeTripId: string | null } = {
        onDuty: true,
        activeTripId: null,
      };
      const h = buildHarness(now, state, useUnified, {
        onBeforeOpenSessionOf: () => {
          // الرحلةُ تنتهي هنا — داخلَ انتظارِ الجلسةِ، بعدَ اللقطةِ.
          state.activeTripId = null;
        },
      });

      // الإصلاحةُ الأولى: جلسةٌ بلا رحلة، ثمّ إسنادٌ.
      await h.live.onFix(fixAt(now.value));
      state.activeTripId = TRIP;
      now.value += 20_000;
      await h.live.onFix(fixAt(now.value));

      const session = await h.store.openSessionOf(DRIVER);
      const eventsWithEndedTrip = h.events.filter(
        (event) => "tripId" in event && event.tripId === TRIP,
      );
      return { session, eventsWithEndedTrip };
    };

    const unified = await runRace(true);
    const legacy = await runRace(false);

    // ولا جلسةَ على رحلةٍ منتهيةٍ في المسارينِ.
    expect(unified.session?.facts.tripId).toBeNull();
    expect(legacy.session?.facts.tripId).toBeNull();
    // ولا حدثَ نشرَ يحملُ الرحلةَ التي انتهت داخلَ النافذةِ.
    expect(unified.eventsWithEndedTrip).toEqual([]);
    expect(legacy.eventsWithEndedTrip).toEqual([]);
  });

  it("السباقُ الحتميّ: رحلةُ الإسنادِ الجديدِ تنتهي في النافذةِ والجلسةُ على رحلةٍ سابقةٍ — تُفصَلُ كما في الأصلِ لا تبقى على غيرِها", async () => {
    // الحالةُ الثانيةُ للنافذةِ: الجلسةُ مرفقةٌ أصلًا برحلةٍ أولى، والإسنادُ
    // الجديدُ تراهُ لقطةُ الإصلاحةِ ثمّ ينتهي داخلَ نافذةِ انتظارِ الجلسةِ. الحكمُ
    // هنا لا يُتّخذُ منَ اللقطةِ: قراءةٌ طازجةٌ (كما في الأصلِ حرفيًا) ترى
    // انتهاءَهُ فتفصلُ الجلسةَ عن الرحلةِ السابقةِ — لا أن تبقى مرفقةً برحلةٍ
    // زالتْ نشطتُها أو صارتْ لسائقٍ آخرَ.
    const runRace = async (useUnified: boolean) => {
      const now = { value: 10_000_000 };
      const state: { onDuty: boolean; activeTripId: string | null } = {
        onDuty: true,
        activeTripId: null,
      };
      const h = buildHarness(now, state, useUnified, {
        onBeforeOpenSessionOf: () => {
          // الإسنادُ الجديدُ ينتهي هنا — داخلَ نافذةِ الجلسةِ، بعدَ اللقطةِ.
          // (لا يُنفَّذُ إلا في إصلاحةِ الإسنادِ الجديدِ — لا في فتحِ الأولى.)
          if (state.activeTripId !== OTHER_TRIP) return;
          state.activeTripId = null;
        },
      });

      // الإصلاحةُ الأولى: جلسةٌ على الرحلةِ الأولى.
      state.activeTripId = TRIP;
      await h.live.onFix(fixAt(now.value));
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);

      // إسنادٌ جديدٌ يقعُ، ثمّ إصلاحةٌ تراهُ في لقطتِها — وينتهي في النافذةِ.
      state.activeTripId = OTHER_TRIP;
      now.value += 20_000;
      await h.live.onFix(fixAt(now.value));

      return (await h.store.openSessionOf(DRIVER))?.facts.tripId ?? null;
    };

    const unified = await runRace(true);
    const legacy = await runRace(false);

    // المسارُ الموحّدُ فصلَ الجلسةَ كما في الأصلِ — لا بقيتْ على الرحلةِ الأولىِ
    // التي قد تكونُ صارتْ لسائقٍ آخرَ.
    expect(unified).toBeNull();
    expect(legacy).toBeNull();
  });

  it("السباقُ الحتميّ: الرحلةُ نفسُها تنتهي في النافذةِ واللقطةُ تساوي رحلةَ الجلسةِ (B→B) — يُفصَلُ الربطُ كما في الأصلِ", async () => {
    // الفرعُ الذي لا يظهرُ فيه تغيّرٌ في اللقطةِ (تساويها معَ رحلةِ الجلسةِ): لا
    // يكفي أن تساويَ اللقطةُ الرحلةَ ليكونَ كلُّ شيءٍ ساكنًا — فالرحلةُ قد تنتهي
    // داخلَ نافذةِ انتظارِ الجلسةِ، والقراءةُ المتأخرةُ (الباقيةُ كما في الأصلِ
    // حرفيًا) هي التي ترى الانتهاءَ فتفصلُ الربطَ في الإصلاحةِ نفسِها. المسارُ
    // الموحّدُ والقديمُ يتطابقانِ هنا بالبنيةِ لا بالمصادفةِ.
    const runRace = async (useUnified: boolean) => {
      const now = { value: 10_000_000 };
      const state: { onDuty: boolean; activeTripId: string | null } = {
        onDuty: true,
        activeTripId: null,
      };
      let sessionOnTrip = false;
      const h = buildHarness(now, state, useUnified, {
        onBeforeOpenSessionOf: () => {
          // الرحلةُ نفسُها تنتهي هنا — واللقطةُ (المأخوذةُ قبلَ النافذةِ) ما
          // تزالُ تحملُها. (لا يُنفَّذُ إلا بعدَ أن تكونَ الجلسةُ على الرحلةِ —
          // فتحُ الأولى لا يدخلِ في السباقِ.)
          if (!sessionOnTrip) return;
          state.activeTripId = null;
        },
      });

      // الإصلاحةُ الأولى: جلسةٌ على الرحلةِ.
      state.activeTripId = TRIP;
      await h.live.onFix(fixAt(now.value));
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);
      sessionOnTrip = true;

      // إصلاحةٌ لاحقةٌ: لقطتُها تحملُ الرحلةَ نفسَها — وتنتهي في النافذةِ.
      now.value += 20_000;
      await h.live.onFix(fixAt(now.value));

      return (await h.store.openSessionOf(DRIVER))?.facts.tripId ?? null;
    };

    const unified = await runRace(true);
    const legacy = await runRace(false);

    // القراءةُ المتأخرةُ رأتِ الانتهاءَ ففصلتِ الربطَ في المسارينِ — لا بقاءَ على
    // رحلةٍ انتهت ولو تساوتِ اللقطةُ.
    expect(unified).toBeNull();
    expect(legacy).toBeNull();
  });

  it("خارجَ الخدمةِ: لا جلسةَ ولا بثًّ — والموقعُ محفوظٌ — كما في المسارِ القديمِ", async () => {
    const now = { value: 10_000_000 };
    const state = { onDuty: false, activeTripId: null };
    const unified = buildHarness(now, state, true);
    const legacy = buildHarness(now, state, false);

    await unified.live.onFix(fixAt(now.value));
    await legacy.live.onFix(fixAt(now.value));

    expect(unified.events).toEqual(legacy.events);
    expect(unified.events).toEqual([]);
    expect(await unified.store.openSessionOf(DRIVER)).toBeNull();
  });

  it("فرعُ الخَلَفِ بعدَ السقفِ (`EXPIRED`) يبقى على قراءتِهِ الطازجةِ — لا على اللقطةِ الموحّدةِ", async () => {
    const now = { value: 10_000_000 };
    const state = { onDuty: true, activeTripId: TRIP };
    const h = buildHarness(now, state, true);

    await h.live.onFix(fixAt(now.value));
    // الفتحُ الأولُ على لقطةٍ غيرِ فارغةٍ تحقّقَ برحلةٍ طازجةٍ (مرةً في عمرِ الجلسةِ).
    expect(h.counters.activeTripOf).toBe(1);

    // أكثرَ من سقفِ الجلسةِ (١٢ ساعةً): فرعُ الإغلاقِ والخَلَفِ النادرُ.
    now.value += 13 * 60 * 60 * 1000;
    await h.live.onFix(fixAt(now.value));

    // الخَلَفُ قرأَ الرحلةَ قراءةً طازجةً كما كان — اللقطةُ الموحّدةُ لا تمسُّ هذا الفرع.
    expect(h.counters.activeTripOf).toBe(2);
    const replacement = await h.store.openSessionOf(DRIVER);
    expect(replacement?.facts.tripId).toBe(TRIP);
    const started = h.events.filter((e) => e.type === "session_started");
    expect(started.length).toBe(2);
  });

  it("تقاربُ المسارينِ على مصفوفةِ الحالاتِ: أحداثُ النشرِ لا تختلفُ بتركيبِ القراءةِ", async () => {
    const cases: Array<{ name: string; onDuty: boolean; trip: string | null }> = [
      { name: "على الخدمة بلا رحلة", onDuty: true, trip: null },
      { name: "على الخدمة برحلة", onDuty: true, trip: TRIP },
      { name: "خارج الخدمة", onDuty: false, trip: null },
      { name: "خارج الخدمة برحلة", onDuty: false, trip: TRIP },
    ];
    /**
     * لكلِّ مسارٍ ساعاتُهُ المستقلةُ: مزامنةُ ساعةٍ واحدةٍ بينَ تركيبينِ تجعلُ
     * طابعَ الأحداثِ تابعًا لترتيبِ التنفيذِ لا للحالةِ نفسِها — وهذا عيبٌ في
     * الاختبارِ لا في المُختبَرِ. فكلُّ تركيبٍ يعيشُ زمنَهُ الخاصَّ بنفسِ الخطواتِ.
     */
    const T0 = 10_000_000;
    for (const c of cases) {
      const state = { onDuty: c.onDuty, activeTripId: c.trip };
      const unifiedNow = { value: T0 };
      const legacyNow = { value: T0 };
      const unified = buildHarness(unifiedNow, state, true);
      const legacy = buildHarness(legacyNow, state, false);
      await unified.live.onFix(fixAt(unifiedNow.value));
      await legacy.live.onFix(fixAt(legacyNow.value));
      unifiedNow.value += 20_000;
      legacyNow.value += 20_000;
      await unified.live.onFix(fixAt(unifiedNow.value));
      await legacy.live.onFix(fixAt(legacyNow.value));
      expect(comparable(unified.events), c.name).toEqual(comparable(legacy.events));
    }
  });
});
