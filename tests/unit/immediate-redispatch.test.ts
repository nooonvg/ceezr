/**
 * الغرض: اختبارُ انحدارِ إغلاقِ `LOAD-01` (الدفعةُ الرابعةُ) — علّةُ «مهلاتِ
 *   الموقعِ» التي أخفقتْ بها جولاتُ القبولِ: مسارُ `POST /v1/driver/location`
 *   كانَ ينتظرُ إعادةَ عرضِ المدينةِ داخلَ الطلبِ، فعلَّقَ أولَ موقعٍ لكلِّ
 *   سائقٍ متاحٍ بالثواني (قيسَ في الجولةِ التشخيصيةِ `diag-f2-integrated-50`:
 *   وسيطُ طورِ الكتابةِ 10.4ث وأقصاهُ 17.9ث، و68 مهلةَ عميلٍ عندَ 15000ms
 *   بالضبطِ، وكلُّ الطلباتِ البطيئةِ كانتْ أولَ نداءِ موقعٍ لسائقِهِ — محفّزاتِ
 *   `becameLive` حرفيًّا). هذا الملفُّ يُثبِتُ أنَّ الإصلاحَ يمنعُ تكرارَ
 *   التدهورِ لا أنَّ جولةً واحدةً نجحتْ مصادفةً.
 * الحالة: اختبار فعلي — منافذُ مُصطنَعةٌ وساعةٌ وجدولةٌ محقونتانِ.
 * ينتمي إلى: tests/unit
 * يستخدمه: CI
 *
 * **ما يُثبَتُ ههنا ثلاثةٌ:**
 * ١) **عدمُ الحجبِ (جوهرُ الانحدارِ):** حالةُ استخدامِ استقبالِ الموقعِ
 *    مركّبةً مع منفذِ الجدولةِ (كما تُركّبُهُ حاويةُ البوابةِ) تُنهي عملَها
 *    **قبلَ** اكتمالِ شوطِ إعادةِ العرضِ — فلو عادَ الحجبُ لسقطَ هذا الاختبارُ
 *    حتى لو نجحتْ كلُّ الجولاتِ.
 * ٢) **الخفضُ للمدينةِ:** محفّزاتٌ متزامنةٌ داخلَ النافذةِ لا تُشعلُ إلا شوطًا
 *    واحدًا (وإلا عادَ التزاحمُ منَ البابِ الخلفيِّ على تجمُّعِ الطلباتِ).
 * ٣) **مانعُ التداخلِ:** لا شوطًا فوقَ شوطٍ جارٍ.
 */

import { describe, expect, it } from "bun:test";
import {
  createImmediateRedispatchScheduler,
  IMMEDIATE_REDISPATCH_DEBOUNCE_MS,
} from "../../apps/gateway/src/background/immediate-redispatch.ts";
import type { DriverProfile } from "../../packages/application/bots/types.ts";
import type { UpdateDriverLocationDeps } from "../../packages/application/geo/update-driver-location.ts";
import { updateDriverLocation } from "../../packages/application/geo/update-driver-location.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";
import { ok } from "../../packages/shared/result/index.ts";

const CITY = "11111111-1111-4111-8111-111111111111" as CityId;
const DRIVER = "22222222-2222-4222-8222-222222222222" as DriverId;
const NOW_MS = Date.UTC(2027, 2, 1, 9, 0, 0);

/** سائقٌ **يصيرُ حيًّا** بهذهِ الإصلاحةِ: متاحٌ بلا موقعٍ سابقٍ — محفّزُ الخطوةِ الخامسةِ. */
function becameLiveDriver(): DriverProfile {
  return {
    id: DRIVER,
    cityId: CITY,
    telegramUserId: "5550001",
    fullName: "سائقٌ مُختبَرٌ",
    phone: "+966500000000",
    isVerified: true,
    isAvailable: true,
    hasLocation: false,
    lastFix: null,
  };
}

/** جدولةٌ محقونةٌ تُنفِّذُ فورًا — الشوطُ يبدأُ لكنهُ لا يكتملُ إلا بيدِ الاختبارِ. */
function immediateSchedule(): { schedule: (fn: () => void) => void } {
  return { schedule: (fn) => fn() };
}

describe("LOAD-01 — إعادةُ العرضِ الفوريّةُ: جدولةٌ لا حجبٌ", () => {
  it("١) جوهرُ الانحدارِ: ردُّ الموقعِ يكتملُ قبلَ اكتمالِ شوطِ إعادةِ العرضِ", async () => {
    // شوطٌ لا يكتملُ إلا بيدِ الاختبارِ — كما كانَ الشوطُ الحقيقيُّ يعلَّقُ
    // بالثواني تحتَ الحملِ. لو كانَ المسارُ ما زالَ ينتظرُهُ لما اكتملَ الردُّ.
    let finishRun: (() => void) | null = null;
    let runCompleted = false;
    const scheduler = createImmediateRedispatchScheduler({
      run: async () => {
        await new Promise<void>((resolve) => {
          finishRun = () => {
            runCompleted = true;
            resolve();
          };
        });
      },
      debounceMs: IMMEDIATE_REDISPATCH_DEBOUNCE_MS,
      now: () => NOW_MS,
      ...immediateSchedule(),
    });

    // التركيبُ نفسُهُ الذي تركّبُهُ حاويةُ البوابةِ: المنفذُ يُجدوِلُ ويعودُ.
    const deps: UpdateDriverLocationDeps = {
      drivers: {
        updateLocation: async () => ok({ kind: "accepted" as const }),
      },
      clock: { now: () => new Date(NOW_MS) },
      redispatch: {
        onDriverBecameDispatchable: async (cityId) => {
          scheduler.trigger(cityId);
        },
      },
    };

    const outcome = await updateDriverLocation(
      {
        driver: becameLiveDriver(),
        latitude: 21.5471,
        longitude: 39.1751,
        quality: { accuracyMeters: 10 },
      },
      deps,
    );
    // ردُّ الموقعِ اكتملَ — والشوطُ الخلفيُّ ما زالَ معلّقًا بيدِ الاختبارِ.
    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.value.kind !== "accepted") return;
    expect(outcome.value.becameLive).toBe(true);
    expect(runCompleted).toBe(false);
    // والشوطُ بدأَ فعلًا (لا أنهُ لم يُجدوَلْ أصلًا): نُكمِلُهُ بيدِنا.
    // (الإسنادُ داخلَ الإغلاقِ لا يتبعُهُ تحليلُ التدفقِ فنُوسِعُ الصراحةَ.)
    const finish = finishRun as (() => void) | null;
    if (finish === null) throw new Error("الشوطُ لم يبدأْ");
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runCompleted).toBe(true);
  });

  it("٢) الخفضُ للمدينةِ: محفّزاتٌ داخلَ النافذةِ لا تُشعلُ إلا شوطًا واحدًا", () => {
    const runs: CityId[] = [];
    const logs: string[] = [];
    const scheduler = createImmediateRedispatchScheduler({
      run: async (cityId) => {
        runs.push(cityId);
      },
      debounceMs: 2_000,
      now: () => NOW_MS,
      ...immediateSchedule(),
      log: (message) => logs.push(message),
    });
    // خمسونَ سائقًا يصيرونَ أحياءً في اللحظةِ نفسِها — موجةُ قبولٍ.
    for (let i = 0; i < 50; i++) scheduler.trigger(CITY);
    expect(runs).toHaveLength(1);
    expect(logs.filter((line) => line === "redispatch.immediate_debounced")).toHaveLength(49);
  });

  it("٣) بعدَ نافذةِ الخفضِ يُقبلُ محفّزٌ جديدٌ — الخفضُ نافذةٌ لا تعطيلٌ", async () => {
    const runs: CityId[] = [];
    let nowMs = NOW_MS;
    const scheduler = createImmediateRedispatchScheduler({
      run: async (cityId) => {
        runs.push(cityId);
      },
      debounceMs: 2_000,
      now: () => nowMs,
      ...immediateSchedule(),
    });
    scheduler.trigger(CITY);
    // الشوطُ الأولُ أنجزَ (لا انتظارَ فيهِ) ومانعُ التداخلِ يُخلي بعدَهُ —
    // نقطةُ زمنٍ تمرُّ كما تمرُّ في التشغيلِ الحقيقيِّ بينَ محفّزينِ.
    await new Promise((resolve) => setTimeout(resolve, 0));
    nowMs += 2_500; // مضتِ النافذةُ
    scheduler.trigger(CITY);
    expect(runs).toHaveLength(2);
  });

  it("٤) مانعُ التداخلِ: لا شوطًا فوقَ شوطٍ جارٍ", async () => {
    const runs: string[] = [];
    let releaseRun: (() => void) | null = null;
    const scheduler = createImmediateRedispatchScheduler({
      run: async () => {
        runs.push("started");
        await new Promise<void>((resolve) => {
          releaseRun = resolve;
        });
        runs.push("finished");
      },
      debounceMs: 0, // بلا خفضٍ: العبرةُ هنا لمانعِ التداخلِ وحدهِ
      now: () => NOW_MS,
      ...immediateSchedule(),
      log: () => {},
    });
    scheduler.trigger(CITY);
    scheduler.trigger(CITY); // الشوطُ الأولُ ما زالَ جاريًا
    expect(runs).toEqual(["started"]);
    const release = releaseRun as (() => void) | null;
    if (release === null) throw new Error("الشوطُ لم يبدأْ");
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runs.slice(0, 2)).toEqual(["started", "finished"]);
  });

  /**
   * التكليفُ السابعُ (P4) — الحافةُ اللاحقةُ: المحفّزُ المُسكَتُ لا يُترَكُ للدوريّةِ (20ث).
   * قيسَ في `diag-r11-join-250`: أوّلُ جولةِ عرضٍ لطلبٍ جديدٍ انتظرتْ حتى 82ث بعدَ توقّفِ
   * محفّزاتِ المواقعِ، لأنَّ المُسكَتَ كانَ يضيعُ. والمعيارُ: مُسكِتٌ لا مُراكِمٌ — أيُّ
   * عددٍ منَ المُسكَتاتِ = لاحقٌ **واحدٌ**.
   */
  function manualTimers() {
    const queue: { ms: number; fn: () => void }[] = [];
    return {
      scheduleAfter: (ms: number, fn: () => void) => void queue.push({ ms, fn }),
      fireAll: () => {
        const due = queue.splice(0);
        for (const t of due) t.fn();
        return due;
      },
      size: () => queue.length,
    };
  }

  it("٦) خمسونَ محفّزًا داخلَ النافذةِ = شوطٌ الآنَ + لاحقٌ واحدٌ بعدَ انقضائِها", async () => {
    const runs: CityId[] = [];
    let nowMs = NOW_MS;
    const timers = manualTimers();
    const scheduler = createImmediateRedispatchScheduler({
      run: async (cityId) => {
        runs.push(cityId);
        return undefined;
      },
      debounceMs: 2_000,
      now: () => nowMs,
      ...immediateSchedule(),
      scheduleAfter: timers.scheduleAfter,
    });
    for (let i = 0; i < 50; i++) scheduler.trigger(CITY);
    expect(runs).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers.size()).toBe(1); // مؤقّتٌ واحدٌ لا خمسون
    nowMs += 2_000;
    const fired = timers.fireAll();
    expect(fired[0]?.ms).toBeLessThanOrEqual(2_000);
    expect(runs).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    timers.fireAll();
    expect(runs).toHaveLength(2); // لا ذيلَ ثالثٌ بلا محفّزٍ جديدٍ
  });

  it("٧) الشوطُ الممتلئُ الحدِّ يطلبُ لاحقًا واحدًا؛ وغيرُ الممتلئِ لا يطلبُ", async () => {
    const runs: number[] = [];
    let nowMs = NOW_MS;
    const timers = manualTimers();
    const saturation = [true, false];
    const scheduler = createImmediateRedispatchScheduler({
      run: async () => {
        runs.push(nowMs);
        return { saturated: saturation.shift() ?? false };
      },
      debounceMs: 2_000,
      now: () => nowMs,
      ...immediateSchedule(),
      scheduleAfter: timers.scheduleAfter,
    });
    scheduler.trigger(CITY);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers.size()).toBe(1);
    nowMs += 2_000;
    timers.fireAll();
    expect(runs).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers.size()).toBe(0);
  });

  it("٨) محفّزاتٌ أثناءَ شوطٍ جارٍ = لاحقٌ واحدٌ بعدَ اكتمالِه", async () => {
    let starts = 0;
    let releaseRun: (() => void) | null = null;
    let nowMs = NOW_MS;
    const timers = manualTimers();
    const scheduler = createImmediateRedispatchScheduler({
      run: async () => {
        starts += 1;
        if (starts === 1) {
          await new Promise<void>((resolve) => {
            releaseRun = resolve;
          });
        }
        return undefined;
      },
      debounceMs: 0,
      now: () => nowMs,
      ...immediateSchedule(),
      scheduleAfter: timers.scheduleAfter,
    });
    scheduler.trigger(CITY);
    for (let i = 0; i < 10; i++) scheduler.trigger(CITY);
    expect(starts).toBe(1);
    expect(timers.size()).toBe(0); // لا مؤقّتَ والشوطُ جارٍ
    (releaseRun as (() => void) | null)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers.size()).toBe(1);
    nowMs += 1;
    timers.fireAll();
    expect(starts).toBe(2);
  });

  it("٥) فشلُ الشوطِ الخلفيِّ يُسجَّلُ ولا يُرمى — القياسُ لا يُسقِطُ ما يقيسُهُ", async () => {
    const logs: { message: string; meta: Record<string, unknown> }[] = [];
    const scheduler = createImmediateRedispatchScheduler({
      run: async () => {
        throw new Error("عطلُ قاعدةٍ مُصطنَعٌ");
      },
      debounceMs: 0,
      now: () => NOW_MS,
      ...immediateSchedule(),
      log: (message, meta) => logs.push({ message, meta }),
    });
    scheduler.trigger(CITY);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logs.some((entry) => entry.message === "redispatch.immediate_failed")).toBe(true);
  });
});
