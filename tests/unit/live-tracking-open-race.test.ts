/**
 * الغرض: `WASLA — الدورة ٤ (الدفعة 19)` — عقدُ فتحِ الجلسةِ في `onFix` تحتَ
 *   السباقِ: إسنادٌ يقعُ **بعدَ** اللقطةِ (قارئُ الخدمةِ والرحلة) و**أثناءَ**
 *   انتظارِ `sessions.openSessionOf(driverId)` يجبُ أن تُفتحَ الجلسةُ عليه، كما
 *   في المسارِ المرجعيِّ على `main` (`d9632d1f`) الذي يقرأُ الرحلةَ قراءةً
 *   طازجةً عندَ إنشاءِ الجلسة.
 *
 *   العيبُ الذي يحرسُه (رأسُ PR #595 `a1ef73b5`): حينَ كانت اللقطةُ فارغةً
 *   (`activeTripId === null`) تُفتحُ الجلسةُ على `null` دونَ قراءةٍ طازجة، فيُنشرُ
 *   `session_started` و`location_updated` الأولُ بلا رحلةٍ والإسنادُ قائمٌ في
 *   القاعدة، ولا يُرفَقُ إلا في الإصلاحةِ التالية. وكانت اختباراتُ السباقِ في
 *   `live-tracking-unified-read.test.ts` لا تُسنِدُ رحلةً داخلَ هذه النافذةِ في
 *   الإصلاحةِ الأولى، فلم تكشفه.
 *
 *   والمصفوفةُ: (أ) لا إسناد، (ب) إسنادٌ قبلَ اللقطة، (ج) إسنادٌ بعدَ اللقطةِ داخلَ
 *   النافذة، (د) انتهاءُ الإسنادِ داخلَ النافذة، (هـ) جلسةٌ مرفقةٌ برحلةٍ سابقةٍ
 *   وإسنادٌ جديدٌ داخلَ النافذة. وكلٌّ منها على المسارينِ (الموحّد والقارئين
 *   المنفصلين) بقيمٍ مطلقةٍ يحقّقُها المسارُ المرجعيُّ على `main`.
 *
 * الحالة: اختبار وحدة فعلي — لا يتطلب قاعدة.
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: أيُّ تعديلٍ على `currentSession` أو قراءةِ الرحلةِ في `onFix`.
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
const TRIP = "trip-1";
const PREV_TRIP = "trip-0";

const fixAt = (recordedAtMs: number): StoredFix => ({
  driverId: DRIVER,
  cityId: "city-jed",
  latitude: 21.5471,
  longitude: 39.1751,
  recordedAtMs,
  accuracyMeters: 8,
  verdict: "ACCEPT",
  findings: [],
});

type State = { onDuty: boolean; activeTripId: string | null };

function harness(state: State, useUnified: boolean) {
  const now = { value: 10_000_000 };
  const events: TrackingEvent[] = [];
  const store = createMemoryTrackingSessionStore();
  const window: { hook: (() => void) | null } = { hook: null };
  const sessions: TrackingSessionStore = {
    ...store,
    openSessionOf: async (driverId) => {
      // النافذةُ: بعدَ اللقطةِ وقبلَ أن تعودَ قراءةُ الجلسةِ المفتوحة.
      const hook = window.hook;
      window.hook = null;
      hook?.();
      return store.openSessionOf(driverId);
    },
  };
  const dutyAndTrip: DriverDutyAndTripReader = {
    dutyAndActiveTrip: async () => ({ onDuty: state.onDuty, activeTripId: state.activeTripId }),
  };
  const live = createLiveTracking({
    sessions,
    publisher: { publish: async (event) => void events.push(event) },
    trips: { activeTripOf: async () => state.activeTripId },
    duty: { isOnDuty: async () => state.onDuty },
    ...(useUnified ? { dutyAndTrip } : {}),
    clock: { now: () => new Date(now.value) },
  });
  const fix = async (inWindow?: () => void) => {
    window.hook = inWindow ?? null;
    await live.onFix(fixAt(now.value));
    now.value += 20_000;
  };
  return { fix, events, store };
}

const shape = (events: TrackingEvent[]) =>
  events.map((e) => ({ type: e.type, tripId: e.tripId, sequence: e.sequence }));

for (const useUnified of [true, false]) {
  const path = useUnified ? "الموحّد" : "القارئان المنفصلان";

  describe(`عقدُ فتحِ الجلسةِ تحتَ السباق — المسار ${path}`, () => {
    it("(ج) إسنادٌ بعدَ اللقطةِ داخلَ انتظارِ openSessionOf: تُفتحُ الجلسةُ على الرحلة كما في main", async () => {
      const state: State = { onDuty: true, activeTripId: null };
      const h = harness(state, useUnified);

      await h.fix(() => {
        state.activeTripId = TRIP;
      });

      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);
      expect(shape(h.events)).toEqual([
        { type: "session_started", tripId: TRIP, sequence: 1 },
        { type: "location_updated", tripId: TRIP, sequence: 2 },
      ]);
    });

    it("(أ) لا إسناد: جلسةٌ بلا رحلة", async () => {
      const state: State = { onDuty: true, activeTripId: null };
      const h = harness(state, useUnified);
      await h.fix();
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBeNull();
      expect(shape(h.events).map((e) => e.tripId)).toEqual([null, null]);
    });

    it("(ب) إسنادٌ قبلَ اللقطة: جلسةٌ على الرحلة", async () => {
      const state: State = { onDuty: true, activeTripId: TRIP };
      const h = harness(state, useUnified);
      await h.fix();
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);
      expect(shape(h.events).map((e) => e.tripId)).toEqual([TRIP, TRIP]);
    });

    it("(د) الإسنادُ في اللقطةِ ينتهي داخلَ النافذة: لا جلسةَ على رحلةٍ منتهية", async () => {
      const state: State = { onDuty: true, activeTripId: TRIP };
      const h = harness(state, useUnified);
      await h.fix(() => {
        state.activeTripId = null;
      });
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBeNull();
      expect(h.events.filter((e) => e.tripId === TRIP)).toEqual([]);
    });

    it("(هـ) جلسةٌ مرفقةٌ برحلةٍ سابقةٍ وإسنادٌ جديدٌ داخلَ النافذة: تُرفَقُ بالجديدةِ في الإصلاحةِ نفسِها", async () => {
      const state: State = { onDuty: true, activeTripId: PREV_TRIP };
      const h = harness(state, useUnified);
      await h.fix();
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(PREV_TRIP);

      // الرحلةُ السابقةُ انتهت (closeByTrip يغلقُ الجلسةَ في الإنتاج؛ هنا نحاكي
      // الحالةَ الأصعب: الجلسةُ باقيةٌ واللقطةُ ترى السابقة، والإسنادُ الجديدُ في النافذة).
      await h.fix(() => {
        state.activeTripId = TRIP;
      });
      expect((await h.store.openSessionOf(DRIVER))?.facts.tripId).toBe(TRIP);
      const last = h.events.at(-1);
      expect(last?.type).toBe("location_updated");
      expect(last?.tripId).toBe(TRIP);
    });
  });
}
