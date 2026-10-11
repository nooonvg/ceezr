/**
 * الغرض: اختبارات تقييم إصلاحة GPS — المرحلة ٣.
 *   كل حالة هنا كانت **تمرّ** في المُتحقِّق المحذوف `packages/tracking/location-validator.ts`
 *   ما لم يُذكر خلاف ذلك. القياس مسجَّل في docs/archive/reports-2026-08-09/production-readiness/PHASE-3-GPS-VALIDATION.md
 * ينتمي إلى: tests/unit
 */

import { describe, expect, it } from "bun:test";
import {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  hasFinding,
  type PreviousFix,
  type RawGpsFix,
  requireValidGpsFix,
} from "../../packages/domain/geo/gps-fix.ts";

const NOW = new Date("2026-08-11T12:00:00Z").getTime();
const JEDDAH = { latitude: 21.4858, longitude: 39.1925 };

function fix(overrides: Partial<RawGpsFix> = {}): RawGpsFix {
  return {
    latitude: JEDDAH.latitude,
    longitude: JEDDAH.longitude,
    recordedAtMs: NOW,
    ...overrides,
  };
}

function assess(overrides: Partial<RawGpsFix> = {}, previous: PreviousFix | null = null) {
  return assessGpsFix(fix(overrides), previous, NOW, DEFAULT_GPS_POLICY);
}

describe("assessGpsFix — الإحداثيات", () => {
  it("يقبل إحداثية صحيحة بلا ملحوظات", () => {
    const a = assess();
    expect(a.verdict).toBe("ACCEPT");
    expect(a.findings).toEqual([]);
    expect(a.fix?.coordinates).toEqual(JEDDAH);
  });

  /**
   * `Number.isNaN` وحدها لا تكفي: المُتحقِّق المحذوف لم يفحص الإحداثيات إطلاقاً،
   * فكانت NaN و Infinity و lat=999 تُخزَّن كما هي. و`NaN > limit` تساوي false
   * دائماً، فأي تحقّق بالمقارنة وحدها يُمرّر NaN صامتاً.
   */
  it.each([
    ["lat = NaN", { latitude: Number.NaN }],
    ["lng = Infinity", { longitude: Number.POSITIVE_INFINITY }],
    ["lat = -Infinity", { latitude: Number.NEGATIVE_INFINITY }],
    ["lat = 999 خارج المدى", { latitude: 999 }],
    ["lat = -91 خارج المدى", { latitude: -91 }],
    ["lng = -500 خارج المدى", { longitude: -500 }],
    ["lng = 181 خارج المدى", { longitude: 181 }],
  ])("يرفض %s", (_label, patch) => {
    const a = assess(patch);
    expect(a.verdict).toBe("REJECT");
    expect(a.fix).toBeNull();
    expect(hasFinding(a, "COORDINATES_INVALID")).toBe(true);
  });

  it("يقبل الحدود بالضبط: ±90 و ±180", () => {
    expect(assess({ latitude: 90, longitude: 180 }).verdict).toBe("ACCEPT");
    expect(assess({ latitude: -90, longitude: -180 }).verdict).toBe("ACCEPT");
  });
});

describe("assessGpsFix — الدقّة", () => {
  it("يرفض دقّة سالبة — قيمة لا معنى لها فيزيائياً", () => {
    const a = assess({ accuracyMeters: -50 });
    expect(a.verdict).toBe("REJECT");
    expect(hasFinding(a, "ACCURACY_INVALID")).toBe(true);
  });

  it("يرفض دقّة NaN", () => {
    expect(assess({ accuracyMeters: Number.NaN }).verdict).toBe("REJECT");
  });

  /**
   * الفرق الجوهري عن الطبقة القديمة: الدقّة السيّئة **تحذير لا رفض**. الموقع
   * صحيح وإن كان خشناً، وطرحُه يترك العمليات بلا شيء بدل أن يتركها بشيءٍ موسوم.
   */
  it("الدقّة الخشنة تحذير لا رفض — والموقع يبقى معتمداً وموسوماً", () => {
    const a = assess({ accuracyMeters: 5000 });
    expect(a.verdict).toBe("WARNING");
    expect(a.fix).not.toBeNull();
    expect(a.fix?.accuracyMeters).toBe(5000);
    expect(hasFinding(a, "ACCURACY_COARSE")).toBe(true);
  });

  it("دقّة صفر مقبولة (حدّ سفلي صالح)", () => {
    expect(assess({ accuracyMeters: 0 }).verdict).toBe("ACCEPT");
  });
});

describe("assessGpsFix — السرعة والاتجاه", () => {
  it("يرفض سرعة سالبة", () => {
    const a = assess({ speedKmh: -80 });
    expect(a.verdict).toBe("REJECT");
    expect(hasFinding(a, "SPEED_INVALID")).toBe(true);
  });

  it("السرعة المستحيلة تنبيه لا رفض — بيانات صحيحة وسلوك يستدعي مراجعة", () => {
    const a = assess({ speedKmh: 900 });
    expect(a.verdict).toBe("ALERT");
    expect(a.fix).not.toBeNull();
    expect(hasFinding(a, "SPEED_IMPLAUSIBLE")).toBe(true);
  });

  /**
   * الاتجاه حقل عرضٍ لا يُبنى عليه قرار. النوع كان يَعِد بـ0-359 ولا شيء يفرضه:
   * heading=900 و -30 و NaN كانت كلّها تُخزَّن. والصواب إسقاط الحقل لا طرح الموضع.
   */
  it.each([900, -30, 360, Number.NaN])("الاتجاه %p يُسقَط ولا يُسقط الموضع معه", (heading) => {
    const a = assess({ headingDegrees: heading });
    expect(a.verdict).toBe("WARNING");
    expect(a.fix).not.toBeNull();
    expect(a.fix?.headingDegrees).toBeNull();
    expect(hasFinding(a, "HEADING_INVALID")).toBe(true);
  });

  it("يقبل الاتجاه عند حدّيه المشروعين 0 و 359.9", () => {
    expect(assess({ headingDegrees: 0 }).fix?.headingDegrees).toBe(0);
    expect(assess({ headingDegrees: 359.9 }).fix?.headingDegrees).toBe(359.9);
  });
});

describe("assessGpsFix — الزمن غير متماثل", () => {
  /**
   * الطبقة القديمة كانت تقيس |الآن − الطابع| ضدّ حدٍّ واحد (٣٠ ثانية)، فتساوي
   * بين إصلاحة متأخّرة (طبيعية: تغطية رديئة ثم دفع الطابور) وإصلاحة من المستقبل
   * (مستحيلة: ساعة معطوبة أو معبوث بها). فكان كل سائق في تغطية سيّئة يختفي —
   * وهو بالضبط السائق الذي تحتاج العمليات أن تراه.
   */
  it("الإصلاحة المتأخّرة ٤٥ ثانية تُقبل موسومةً بالتأخّر (كانت تُرفض)", () => {
    const a = assess({ recordedAtMs: NOW - 45_000 });
    expect(a.verdict).toBe("WARNING");
    expect(a.fix).not.toBeNull();
    expect(hasFinding(a, "TIMESTAMP_STALE")).toBe(true);
  });

  it("الإصلاحة المتأخّرة ٢٠ ثانية تُقبل بلا ملحوظة", () => {
    expect(assess({ recordedAtMs: NOW - 20_000 }).verdict).toBe("ACCEPT");
  });

  it("ما تجاوز خمس دقائق يُرفض لقِدَمه — لا يصلح لمطابقة حيّة", () => {
    const a = assess({ recordedAtMs: NOW - 400_000 });
    expect(a.verdict).toBe("REJECT");
    expect(hasFinding(a, "TIMESTAMP_TOO_OLD")).toBe(true);
  });

  it("الطابع من المستقبل يُرفض بتسامح ضيّق — الساعات لا تسبق الواقع", () => {
    const a = assess({ recordedAtMs: NOW + 45_000 });
    expect(a.verdict).toBe("REJECT");
    expect(hasFinding(a, "TIMESTAMP_IN_FUTURE")).toBe(true);
  });

  it("انحراف ساعة يسير (٣ ثوانٍ للأمام) مقبول", () => {
    expect(assess({ recordedAtMs: NOW + 3_000 }).verdict).toBe("ACCEPT");
  });

  it("يرفض طابعاً غير منتهٍ", () => {
    const a = assess({ recordedAtMs: Number.NaN });
    expect(a.verdict).toBe("REJECT");
    expect(hasFinding(a, "TIMESTAMP_INVALID")).toBe(true);
  });

  it("يحذّر من طابع لا يتقدّم عن السابق", () => {
    const previous: PreviousFix = { coordinates: JEDDAH, recordedAtMs: NOW };
    const a = assess({ recordedAtMs: NOW }, previous);
    expect(hasFinding(a, "TIMESTAMP_NOT_MONOTONIC")).toBe(true);
    expect(a.fix).not.toBeNull();
  });
});

describe("assessGpsFix — الإزاحة", () => {
  const previous: PreviousFix = { coordinates: JEDDAH, recordedAtMs: NOW - 60_000 };

  it("الحركة الطبيعية تُقبل بلا ملحوظة", () => {
    const a = assessGpsFix(
      fix({ latitude: 21.4868, recordedAtMs: NOW }),
      previous,
      NOW,
      DEFAULT_GPS_POLICY,
    );
    expect(a.verdict).toBe("ACCEPT");
  });

  /**
   * القرار الأهمّ في المرحلة: القفزة **تنبيه لا رفض**، والإصلاحة تُعتمد.
   * الطبقة القديمة كانت ترفض ولا تُقدّم المؤشّر السابق — فتموت الجلسة (يُثبَت
   * في tests/unit/tracking.test.ts). وموقع متجمّد أخطر من موقع قافز: المطابقة
   * تُسنِد الطلبات إلى شبح.
   */
  it("القفزة تُقبل مع تنبيه", () => {
    const a = assessGpsFix(
      fix({ latitude: 22.4858, recordedAtMs: NOW }),
      previous,
      NOW,
      DEFAULT_GPS_POLICY,
    );
    expect(a.verdict).toBe("ALERT");
    expect(a.fix).not.toBeNull();
    expect(hasFinding(a, "DISPLACEMENT_IMPLAUSIBLE")).toBe(true);
  });

  /**
   * السرعة المُبلَّغة يتحكّم بها الطرف المُراقَب. `isSpeeding` المحذوفة كانت
   * تفضّلها على المحسوبة، فكان إرسال speed=0 يُطفئ مؤشّر الاحتيال — قِيس مباشرةً:
   * سرعة محسوبة ٦٦٦٠ كم/سا + speed=0 مُبلَّغة ⇒ false.
   */
  it("السرعة المُبلَّغة لا تستطيع إخفاء الإزاحة المستحيلة", () => {
    const a = assessGpsFix(
      fix({ latitude: 22.4858, recordedAtMs: NOW, speedKmh: 0 }),
      previous,
      NOW,
      DEFAULT_GPS_POLICY,
    );
    expect(a.verdict).toBe("ALERT");
    expect(a.fix?.effectiveSpeedKmh).toBeGreaterThan(1000);
  });
});

describe("assessGpsFix — أشدّ الملحوظات هو الحكم", () => {
  it("الرفض يغلب التنبيه والتحذير", () => {
    const a = assess({ accuracyMeters: -1, speedKmh: 900, headingDegrees: 900 });
    expect(a.verdict).toBe("REJECT");
    expect(a.fix).toBeNull();
  });

  it("التنبيه يغلب التحذير", () => {
    const a = assess({ accuracyMeters: 5000, speedKmh: 900 });
    expect(a.verdict).toBe("ALERT");
  });

  it("requireValidGpsFix يحمل رموز الرفض لا نصّاً حرّاً", () => {
    const result = requireValidGpsFix(assess({ latitude: Number.NaN }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REJECTED_GPS_FIX");
      expect(result.error.reasons).toContain("COORDINATES_INVALID");
    }
  });
});
