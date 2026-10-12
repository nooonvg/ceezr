/**
 * الغرض: اختبار محرك المطابقة — الفلترة، معادلة النقاط، وأثر تغيير الأوزان على الترتيب.
 * الحالة: اختبار فعلي. يغطي البند 4 من قائمة اختبارات المرحلة 2.1:
 *   "ترتيب المرشحين يتغيّر فعلياً عند تغيير الوزنين في platform_settings بلا نشر كود".
 * ينتمي إلى: tests/unit
 * يُتوقع أن يستخدمه لاحقاً: CI
 * ملاحظات مستقبلية: عند تفعيل التقييم الحقيقي (2.5) تُضاف حالة تعادل نقاط بفروق تقييم دقيقة.
 */
import { describe, expect, it } from "bun:test";
import {
  type DriverCandidate,
  evaluateCandidates,
  isLocationStale,
  type MatchingParameters,
  type OrderContext,
  preferredAreaFactor,
  rejectionReasonFor,
  scoreCandidate,
  selectBroadcastBatch,
} from "../../packages/domain/dispatch/entity.ts";
import type { Subscription } from "../../packages/domain/subscription/entity.ts";
import type { CityId, DriverId } from "../../packages/shared/kernel/index.ts";

const JED = "city-jed" as CityId;
const MKK = "city-mkk" as CityId;
const NOW = new Date("2026-08-06T12:00:00Z");
const FUTURE = new Date("2026-09-06T12:00:00Z");
const PAST = new Date("2026-07-06T12:00:00Z");

const PICKUP = { latitude: 21.4858, longitude: 39.1925 };

/** نفس القيم المبذورة في platform_settings لمدن الإطلاق الخمس. */
const PARAMS: MatchingParameters = {
  searchRadiusKm: 10,
  weightProximity: 0.7,
  weightRating: 0.3,
  // البند 2.4: صفرٌ هو المبذور، فالخطّ الأساسي هو معادلة ما قبل البند بحرفها
  weightPreferredArea: 0,
  broadcastBatchSize: 5,
  defaultRating: 4.5,
  ratingMinCountForTrust: 3,
};

function liveSub(cityId: CityId, plan: Subscription["plan"] = "both"): Subscription {
  return {
    driverId: D("d"),
    cityId,
    plan,
    status: "active",
    trialEndsAt: null,
    currentPeriodEnd: FUTURE,
    cancelAtPeriodEnd: false,
  };
}

/** معرّف موسوم — الاختبار يلتزم بنفس أنواع الإنتاج. */
function D(value: string): DriverId {
  return value as DriverId;
}

function candidate(over: Partial<DriverCandidate> & { driverId: DriverId }): DriverCandidate {
  const id = over.driverId;
  return {
    cityId: JED,
    location: PICKUP,
    isAvailable: true,
    isVerified: true,
    isBlocked: false,
    ratingAverage: null,
    ratingCount: 0,
    subscription: liveSub(JED),
    ...over,
    driverId: id,
    capabilities: over.capabilities ?? [
      { driverId: id, cityId: JED, service: "transport", isEnabled: true },
    ],
  };
}

const ORDER: OrderContext = {
  cityId: JED,
  service: "transport",
  pickup: PICKUP,
  excludedDriverIds: [],
};

/** يبعد نحو 4.4 كم شمال نقطة الانطلاق. */
const NEAR = { latitude: 21.5258, longitude: 39.1925 };
/** يبعد نحو 8.9 كم. */
const FAR = { latitude: 21.5658, longitude: 39.1925 };

describe("rejectionReasonFor", () => {
  it("يستبعد سائق مدينة أخرى", () => {
    const c = candidate({ driverId: D("d1"), cityId: MKK });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("CITY_MISMATCH");
  });

  it("يستبعد غير الموثَّق", () => {
    expect(
      rejectionReasonFor(candidate({ driverId: D("d2"), isVerified: false }), ORDER, PARAMS, NOW),
    ).toBe("NOT_VERIFIED");
  });

  it("يستبعد غير المتاح", () => {
    expect(
      rejectionReasonFor(candidate({ driverId: D("d3"), isAvailable: false }), ORDER, PARAMS, NOW),
    ).toBe("NOT_AVAILABLE");
  });

  /**
   * الحالة الإنتاجية بعينها (البند 2.3): السائق الوحيد في القاعدة كان
   * `verification_status='verified'` و`is_available=true` وله اشتراك `trialing` وقدرة
   * `transport` وفي مدينة الطلب نفسها — ومع ذلك لم يصله أي عرض (صفر أسطر في
   * `order_offers`) ولم يظهر له أي سبب رفض. العلة الوحيدة: `last_location = NULL`.
   */
  it("يسمّي NO_LOCATION لمن هو موثّق ومتاح ومشترك ولم يرسل موقعاً قطّ", () => {
    const c = candidate({ driverId: D("no-loc"), location: null });
    expect(c.isVerified).toBe(true);
    expect(c.isAvailable).toBe(true);
    expect(c.subscription).not.toBeNull();
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NO_LOCATION");
  });

  /**
   * لماذا قبل `SERVICE_NOT_ENABLED`: لو قُدّمت القدرة لقيل لسائقٍ ينقصه الموقع فقط
   * إنّ خدمته غير مُفعّلة، فيذهب يفتش في مكان خاطئ.
   */
  it("NO_LOCATION يُقدّم على SERVICE_NOT_ENABLED عند تحقّق السببين", () => {
    const c = candidate({
      driverId: D("no-loc-2"),
      location: null,
      capabilities: [
        { driverId: D("no-loc-2"), cityId: JED, service: "delivery", isEnabled: true },
      ],
    });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NO_LOCATION");
  });

  /** التوفّر أشدّ: غير المتاح لا يُطالَب بموقعه أصلاً. */
  it("NOT_AVAILABLE يُقدّم على NO_LOCATION", () => {
    const c = candidate({ driverId: D("no-loc-3"), location: null, isAvailable: false });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NOT_AVAILABLE");
  });

  it("يستبعد من لم يفعّل نوع الخدمة", () => {
    const c = candidate({
      driverId: D("d4"),
      capabilities: [{ driverId: D("d4"), cityId: JED, service: "delivery", isEnabled: true }],
    });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("SERVICE_NOT_ENABLED");
  });

  it("يستبعد من لا اشتراك له", () => {
    expect(
      rejectionReasonFor(candidate({ driverId: D("d5"), subscription: null }), ORDER, PARAMS, NOW),
    ).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("يستبعد منتهي الاشتراك", () => {
    const c = candidate({
      driverId: D("d6"),
      subscription: { ...liveSub(JED), currentPeriodEnd: PAST },
    });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("يستبعد من خطته لا تغطي الخدمة", () => {
    const c = candidate({ driverId: D("d7"), subscription: liveSub(JED, "delivery") });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("NO_LIVE_SUBSCRIPTION");
  });

  it("يستبعد من هو خارج نصف القطر", () => {
    const c = candidate({ driverId: D("d8"), location: { latitude: 21.3891, longitude: 39.8579 } });
    expect(rejectionReasonFor(c, ORDER, PARAMS, NOW)).toBe("OUT_OF_RADIUS");
  });

  it("يستبعد المستبعدين في هذه الدورة", () => {
    const order: OrderContext = { ...ORDER, excludedDriverIds: [D("d9")] };
    expect(rejectionReasonFor(candidate({ driverId: D("d9") }), order, PARAMS, NOW)).toBe(
      "EXCLUDED_THIS_ROUND",
    );
  });

  it("يقبل المرشح المؤهل", () => {
    expect(rejectionReasonFor(candidate({ driverId: D("d10") }), ORDER, PARAMS, NOW)).toBeNull();
  });
});

describe("scoreCandidate", () => {
  /** عدد تقييمات يتجاوز العتبة (3)، فيُعتدّ بالمتوسط لا بالافتراضي. */
  const TRUSTED = 12;

  it("أقصى نقاط عند مسافة صفر وتقييم كامل", () => {
    expect(scoreCandidate(0, 5, PARAMS, TRUSTED)).toBeCloseTo(1, 10);
  });

  it("مكوّن التقييم وحده عند حدّ نصف القطر", () => {
    // القرب = 0، فالنتيجة = وزن التقييم × (4/5)
    expect(scoreCandidate(10, 4, PARAMS, TRUSTED)).toBeCloseTo(0.3 * 0.8, 10);
  });

  it("يستخدم التقييم الافتراضي للسائق الجديد", () => {
    expect(scoreCandidate(10, null, PARAMS)).toBeCloseTo(0.3 * (4.5 / 5), 10);
  });

  it("يحصر التقييم الشاذ داخل المدى", () => {
    expect(scoreCandidate(0, 99, PARAMS, TRUSTED)).toBeCloseTo(1, 10);
  });

  /**
   * جوهر المرحلة 2.5: متوسط هشّ لا يُرتَّب به أحد. تقييم واحد بخمس نجوم لا يقدّم
   * صاحبه على من له أربعون تقييماً، فما دون العتبة يُعامَل بالافتراضي.
   */
  it("يتجاهل المتوسط تحت عتبة الثقة ويستعمل الافتراضي", () => {
    expect(scoreCandidate(10, 5, PARAMS, 1)).toBeCloseTo(0.3 * (4.5 / 5), 10);
    expect(scoreCandidate(10, 5, PARAMS, 1)).toBe(scoreCandidate(10, null, PARAMS));
  });

  it("يعتدّ بالمتوسط عند بلوغ العتبة بالضبط", () => {
    expect(scoreCandidate(10, 5, PARAMS, 3)).toBeCloseTo(0.3, 10);
  });

  it("تقييم منخفض موثوق يضرّ صاحبه فعلاً، بخلاف المنخفض الهشّ", () => {
    const fragile = scoreCandidate(10, 2, PARAMS, 1);
    const trusted = scoreCandidate(10, 2, PARAMS, TRUSTED);
    expect(trusted).toBeLessThan(fragile);
    expect(trusted).toBeCloseTo(0.3 * (2 / 5), 10);
  });
});

describe("evaluateCandidates", () => {
  // عدد التقييمات فوق العتبة في الطرفين، فالمقارنة على المتوسط الحقيقي لا على الافتراضي
  const near = candidate({
    driverId: D("near"),
    location: NEAR,
    ratingAverage: 3.0,
    ratingCount: 9,
  });
  const far = candidate({ driverId: D("far"), location: FAR, ratingAverage: 5.0, ratingCount: 9 });

  it("يرتّب الأقرب أولاً عندما يغلب وزن القرب", () => {
    const result = evaluateCandidates([far, near], ORDER, PARAMS, NOW);
    expect(result.eligible.map((c) => String(c.driverId))).toEqual(["near", "far"]);
  });

  it("ينقلب الترتيب فعلياً عند تغيير الوزنين وحدهما — بلا تعديل كود", () => {
    const ratingHeavy: MatchingParameters = {
      ...PARAMS,
      weightProximity: 0.1,
      weightRating: 0.9,
    };
    const result = evaluateCandidates([far, near], ORDER, ratingHeavy, NOW);
    expect(result.eligible.map((c) => String(c.driverId))).toEqual(["far", "near"]);
  });

  it("يسجّل سبب استبعاد كل مرشح غير مؤهل", () => {
    const blocked = candidate({ driverId: D("blocked"), isAvailable: false });
    const result = evaluateCandidates([near, blocked], ORDER, PARAMS, NOW);
    expect(result.eligible).toHaveLength(1);
    expect(result.rejected).toEqual([{ driverId: D("blocked"), reason: "NOT_AVAILABLE" }]);
  });

  it("ترتيب حتمي عند تعادل النقاط والمسافة", () => {
    const a = candidate({ driverId: D("aaa"), ratingAverage: 4, ratingCount: 9 });
    const b = candidate({ driverId: D("bbb"), ratingAverage: 4, ratingCount: 9 });
    const first = evaluateCandidates([b, a], ORDER, PARAMS, NOW).eligible.map((c) =>
      String(c.driverId),
    );
    const second = evaluateCandidates([a, b], ORDER, PARAMS, NOW).eligible.map((c) =>
      String(c.driverId),
    );
    expect(first).toEqual(second);
    expect(first).toEqual(["aaa", "bbb"]);
  });

  /**
   * جوهر البند 2.3: قبل الإصلاح كان استعلام القاعدة يحجب هذا السائق تماماً،
   * فتخرج `evaluation` فارغة من الطرفين: لا مؤهل ولا مرفوض. و`NoEligibleDriverError`
   * تحمل هذه الـ`evaluation` إلى السجلّ ولوحة الإدارة، فكان الجواب «لا أحد» بلا سبب.
   * المطلوب: أن يبقى غير مؤهل، وأن يُسمّى سببه.
   */
  it("يُبلِغ عن السائق بلا موقع بدل أن يختفي صامتاً", () => {
    const noLocation = candidate({ driverId: D("no-loc"), location: null });
    const result = evaluateCandidates([noLocation], ORDER, PARAMS, NOW);
    expect(result.eligible).toHaveLength(0);
    expect(result.rejected).toEqual([{ driverId: D("no-loc"), reason: "NO_LOCATION" }]);
  });

  it("لا يحسب مسافة من (0,0) لمن لا موقع له", () => {
    const noLocation = candidate({ driverId: D("no-loc"), location: null });
    const result = evaluateCandidates([noLocation, near], ORDER, PARAMS, NOW);
    // لو مُرّرت (0,0) لكان السبب OUT_OF_RADIUS ولَطورد المشغّل نصف القطر بلا فائدة.
    expect(result.rejected.map((r) => r.reason)).toEqual(["NO_LOCATION"]);
    expect(result.eligible.map((c) => String(c.driverId))).toEqual(["near"]);
  });

  it("يحسب المسافة لكل مرشح مؤهل", () => {
    const result = evaluateCandidates([near], ORDER, PARAMS, NOW);
    expect(result.eligible[0]?.distanceKm).toBeGreaterThan(4);
    expect(result.eligible[0]?.distanceKm).toBeLessThan(5);
  });
});

describe("selectBroadcastBatch", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    candidate({
      driverId: D(`d${i}`),
      location: { latitude: 21.4858 + i * 0.002, longitude: 39.1925 },
    }),
  );

  it("يبثّ لأفضل خمسة فقط بحجم الدفعة المبذور", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    expect(evaluation.eligible).toHaveLength(9);
    expect(selectBroadcastBatch(evaluation, PARAMS)).toHaveLength(5);
  });

  it("حجم الدفعة يُقرأ من المعاملات فعلياً", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    expect(selectBroadcastBatch(evaluation, { ...PARAMS, broadcastBatchSize: 3 })).toHaveLength(3);
  });

  it("دفعة صفرية لا تبثّ لأحد", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    expect(selectBroadcastBatch(evaluation, { ...PARAMS, broadcastBatchSize: 0 })).toHaveLength(0);
  });

  it("الدفعة هي رأس القائمة المرتَّبة نفسها", () => {
    const evaluation = evaluateCandidates(many, ORDER, PARAMS, NOW);
    const batch = selectBroadcastBatch(evaluation, PARAMS);
    expect(batch.map((c) => String(c.driverId))).toEqual(
      evaluation.eligible.slice(0, 5).map((c) => String(c.driverId)),
    );
  });
});

/**
 * البند 2.4 — المنطقة المفضّلة.
 *
 * الغرض من هذه المجموعة ليس إثبات أن الكود يعمل، بل إثبات أمرين متقابلين
 * يطلبهما التوجيه صراحةً:
 *   1) بالوزن المبذور (صفر) لا يتغيّر ترتيبُ أحد — أي أن الهجرة لا تمسّ الإنتاج.
 *   2) برفع الوزن يتغيّر الترتيب **فعلياً وقابلاً للقياس** — لا مجرّد فرقٍ في
 *      الرقم العشري لا يُغيّر من يصله العرض.
 */
describe("preferredAreaFactor والمنطقة المفضّلة في الترتيب", () => {
  const homebody = candidate({
    driverId: D("homebody"),
    location: FAR,
    ratingAverage: 3.0,
    ratingCount: 9,
    // يسكن عند نقطة الالتقاط ويعمل حولها، لكنّه الآن عابرٌ بعيداً عنها
    preferredArea: PICKUP,
  });
  const passerby = candidate({
    driverId: D("passerby"),
    location: NEAR,
    ratingAverage: 3.0,
    ratingCount: 9,
    preferredArea: null,
  });

  it("يعطي صفراً لمن لا منطقة له، وواحداً لمن نقطة الالتقاط في قلب منطقته", () => {
    expect(preferredAreaFactor(null, PICKUP, 10 as MatchingParameters["searchRadiusKm"])).toBe(0);
    expect(preferredAreaFactor(undefined, PICKUP, 10 as MatchingParameters["searchRadiusKm"])).toBe(
      0,
    );
    expect(
      preferredAreaFactor(PICKUP, PICKUP, 10 as MatchingParameters["searchRadiusKm"]),
    ).toBeCloseTo(1, 10);
  });

  it("بالوزن المبذور صفراً: الترتيب هو ترتيب ما قبل البند بحرفه — الأقرب أولاً", () => {
    const result = evaluateCandidates([homebody, passerby], ORDER, PARAMS, NOW);
    expect(result.eligible.map((c) => String(c.driverId))).toEqual(["passerby", "homebody"]);
    // والعامل يُحسب ويُكشف حتى وهو بلا وزن، ليراه المشغّل قبل أن يقرّر تفعيله
    const homebodyRow = result.eligible.find((c) => String(c.driverId) === "homebody");
    expect(homebodyRow?.preferredAreaFactor).toBeGreaterThan(0);
  });

  it("ينقلب الترتيب فعلياً عند رفع وزن المنطقة من الإعدادات وحدها — بلا تعديل كود", () => {
    const areaHeavy: MatchingParameters = {
      ...PARAMS,
      weightProximity: 0.4,
      weightRating: 0.1,
      weightPreferredArea: 0.5,
    };
    const baseline = evaluateCandidates([homebody, passerby], ORDER, PARAMS, NOW);
    const shifted = evaluateCandidates([homebody, passerby], ORDER, areaHeavy, NOW);

    expect(baseline.eligible.map((c) => String(c.driverId))).toEqual(["passerby", "homebody"]);
    expect(shifted.eligible.map((c) => String(c.driverId))).toEqual(["homebody", "passerby"]);

    /**
     * والقياس لا يكتفي بانقلاب الترتيب: من رُفع رُفع بمنطقته لا بصدفة تقريب.
     * فرق النقاط يجب أن يكون في حدود الوزن المضروب في فرق العاملين، لا ضجيجاً.
     */
    const winner = shifted.eligible[0];
    const loser = shifted.eligible[1];
    if (winner === undefined || loser === undefined) throw new Error("مرشّحان متوقّعان");
    expect(winner.score - loser.score).toBeGreaterThan(0.05);
    expect(winner.preferredAreaFactor).toBeGreaterThan(loser.preferredAreaFactor);
  });

  it("من لا منطقة له لا يُعاقَب: صفرُ العامل لا يخصم من نقاط قربه", () => {
    const withoutArea = candidate({ driverId: D("x"), location: NEAR, preferredArea: null });
    const areaHeavy: MatchingParameters = {
      ...PARAMS,
      weightProximity: 0.4,
      weightRating: 0.1,
      weightPreferredArea: 0.5,
    };
    const scored = evaluateCandidates([withoutArea], ORDER, areaHeavy, NOW).eligible[0];
    if (scored === undefined) throw new Error("مرشّح متوقّع");
    expect(scored.preferredAreaFactor).toBe(0);
    expect(scored.score).toBeGreaterThan(0);
  });
});

/**
 * المرحلة ٨ — حَرَس عمر الموقع. حدودُ الدالة تُقاس هنا، وأثرُها على الإسناد
 * الحقيقي يُقاس في tests/integration/driver-location-freshness.test.ts: هذا
 * الملف لا يعرف إن كان الاستعلام يُسلّم الطابع أصلاً.
 */
describe("dispatch: عمر موقع السائق", () => {
  const AT = (ms: number) => NOW.getTime() - ms;
  const stale = (over: Partial<MatchingParameters> & { driverLocationMaxAgeSeconds?: number }) => ({
    ...PARAMS,
    ...over,
  });

  it("العطب قبل الإصلاح: موقعٌ عمره ست ساعات كان يُقبل — والقبول اليوم مشروطٌ بالتعطيل", () => {
    const old = candidate({ driverId: D("d1"), locationAtMs: AT(6 * 3_600_000) });
    // صفرٌ = معطّل، وهو المبذور: السلوك القائم محفوظ بحرفه
    expect(
      rejectionReasonFor(old, ORDER, stale({ driverLocationMaxAgeSeconds: 0 }), NOW),
    ).toBeNull();
    // وبالتفعيل يُسمّى السبب
    expect(rejectionReasonFor(old, ORDER, stale({ driverLocationMaxAgeSeconds: 900 }), NOW)).toBe(
      "STALE_LOCATION",
    );
  });

  it("غياب الحقل يُقرأ تعطيلاً: لا يُفعَّل حَرَسٌ بقيمةٍ لم يقررها أحد", () => {
    const old = candidate({ driverId: D("d1"), locationAtMs: AT(86_400_000) });
    expect(rejectionReasonFor(old, ORDER, PARAMS, NOW)).toBeNull();
  });

  it("الحدّ تجاوزٌ صريح لا مساواة: عمرٌ يساوي الحدّ بالضبط يمرّ", () => {
    const params = stale({ driverLocationMaxAgeSeconds: 300 });
    expect(isLocationStale({ location: PICKUP, locationAtMs: AT(300_000) }, params, NOW)).toBe(
      false,
    );
    expect(isLocationStale({ location: PICKUP, locationAtMs: AT(300_001) }, params, NOW)).toBe(
      true,
    );
  });

  it("طابعٌ مفقود مع وجود موقع = قديم: «لا نعلم متى» ليست «نعلم أنه الآن»", () => {
    const params = stale({ driverLocationMaxAgeSeconds: 300 });
    expect(isLocationStale({ location: PICKUP, locationAtMs: null }, params, NOW)).toBe(true);
    expect(isLocationStale({ location: PICKUP }, params, NOW)).toBe(true);
    expect(isLocationStale({ location: PICKUP, locationAtMs: Number.NaN }, params, NOW)).toBe(true);
  });

  it("طابعٌ في المستقبل ليس قديماً: فروق ساعات الخوادم لا تُسقِط سائقاً", () => {
    const params = stale({ driverLocationMaxAgeSeconds: 60 });
    expect(isLocationStale({ location: PICKUP, locationAtMs: AT(-3_600_000) }, params, NOW)).toBe(
      false,
    );
  });

  it("من لا موقع له يبقى NO_LOCATION لا STALE_LOCATION: السببان يقودان إلى علاجين", () => {
    const none = candidate({ driverId: D("d1"), location: null, locationAtMs: null });
    const params = stale({ driverLocationMaxAgeSeconds: 60 });
    expect(rejectionReasonFor(none, ORDER, params, NOW)).toBe("NO_LOCATION");
    expect(isLocationStale({ location: null, locationAtMs: null }, params, NOW)).toBe(false);
  });

  it("القِدَم يُفحص قبل الاشتراك ونصف القطر: أقربُ سببٍ للعلاج أولى بالإبلاغ", () => {
    const params = stale({ driverLocationMaxAgeSeconds: 60 });
    const farAndOld = candidate({
      driverId: D("d1"),
      location: { latitude: 30, longitude: 45 },
      locationAtMs: AT(3_600_000),
      subscription: null,
    });
    expect(rejectionReasonFor(farAndOld, ORDER, params, NOW)).toBe("STALE_LOCATION");
  });

  it("الاستبعاد يظهر في evaluateCandidates لا يختفي: المشغّل يقرأ السبب", () => {
    const old = candidate({ driverId: D("d1"), locationAtMs: AT(3_600_000) });
    const evaluation = evaluateCandidates(
      [old],
      ORDER,
      stale({ driverLocationMaxAgeSeconds: 60 }),
      NOW,
    );
    expect(evaluation.eligible).toHaveLength(0);
    expect(evaluation.rejected[0]?.reason).toBe("STALE_LOCATION");
    expect(String(evaluation.rejected[0]?.driverId)).toBe("d1");
  });
});

describe("WR-23 — موقعٌ غيرُ موثوقٍ لا يُرتَّبُ به", () => {
  it("ALERT يُستبعَدُ بـUNTRUSTED_LOCATION، وWARNING والغيابُ يبقيانِ مؤهَّلَين", () => {
    const base = candidate({ driverId: D("d1") });
    const params = PARAMS;
    expect(rejectionReasonFor({ ...base, locationQuality: "ALERT" }, ORDER, params, NOW)).toBe(
      "UNTRUSTED_LOCATION",
    );
    expect(
      rejectionReasonFor({ ...base, locationQuality: "WARNING" }, ORDER, params, NOW),
    ).toBeNull();
    expect(rejectionReasonFor({ ...base, locationQuality: null }, ORDER, params, NOW)).toBeNull();
  });
});
