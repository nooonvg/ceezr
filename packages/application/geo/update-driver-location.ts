/**
 * الغرض: حالةُ استخدامِ **استقبالِ موقعِ السائقِ** — الحكمُ على الإصلاحةِ ثمَّ
 *   الكتابةُ الشرطيّةُ في القاعدةِ ثمَّ ما يترتَّبُ عليها (جلسةُ التتبُّعِ والبثُّ،
 *   وإعادةُ العرضِ عندَ صيرورةِ السائقِ قابلاً للإسنادِ). وهيَ نواةُ البند `F4-01`
 *   (استقبالُ موقعٍ معَ تحقُّقٍ وحراسةِ تسلسلٍ في القاعدةِ — `BUG-001`/`BUG-009`)
 *   ومُنادوها اثنانِ: مسارُ `POST /v1/driver/location` وحوارُ بوتِ السائقِ.
 * الحالة: منفّذ فعلياً — 2026-09-09 · البند `F4-01`.
 * ينتمي إلى: application/geo
 * يُتوقع أن يستخدمه لاحقاً: `apps/gateway/src/routes/driver-location.ts`
 *   و`packages/application/bots/driver-dialog.ts`، وكلُّ مصدرِ إصلاحاتٍ يُضافُ
 *   (بثُّ الواجهةِ التكيُّفيُّ `F3-04`) — بلا نسخةٍ ثانيةٍ من القرارِ.
 * ملاحظات مستقبلية: حدُّ المعدّلِ لكلِّ مستخدمٍ بلا أرقامٍ في العقدِ فلا يُخترَعُ.
 *
 * ## البند `F4-02` — الحالةُ الساخنةُ والاستمرارُ المجمَّعُ (`CAP-009`)
 *
 * أُضيفَ منفذٌ **اختياريٌّ** واحدٌ (`hotState`) قبلَ الكتابةِ الشرطيّةِ، ولم يُمَسَّ
 * ترتيبُ الخطواتِ الخمسِ ولا حكمُ خطوةٍ منها. وثلاثةُ مبادئَ تحكمُ الإضافةَ:
 *
 * ١) **الانتقالُ يُكتَبُ فوراً، والنبضةُ تُجمَّعُ.** أوّلُ موقعٍ لسائقٍ لا موقعَ له
 *    يُكتَبُ في القاعدةِ في النداءِ نفسِه: المطابقةُ والإسنادُ يقرآنِ
 *    `drivers.last_location`، وتأجيلُ **الانتقالِ** دورةَ إفراغٍ يعني سائقاً
 *    متاحاً لا يراهُ الإسنادُ ثوانيَ. والنبضةُ التاليةُ تُجمَّعُ لأنَّ الموضعَ
 *    موجودٌ سلفاً وتحديثُه بضعةَ أمتارٍ يحتملُ دورةً واحدةً.
 * ٢) **غيابُ الحالةِ الساخنةِ أو عطلُها ⇒ الرجوعُ إلى `F4-01` حرفاً.** لا مسارَ
 *    ثالثاً ولا شيفرةَ طارئٍ: عطلُ `Redis` يُسجَّلُ ويُكتَبُ الموضعُ مباشرةً كما
 *    كانَ يُكتَبُ قبلَ هذا البندِ. وحارسُ التسلسلِ في القاعدةِ قائمٌ في المسارَينِ
 *    فلا تُفقَدُ سلامةٌ بالتدهوّرِ — يُفقَدُ التجميعُ وحدَه.
 * ٣) **البثُّ لا يتأجَّلُ.** الخطوةُ ٤ (جلسةُ التتبُّعِ) تعملُ في المسارَينِ:
 *    الخريطةُ الحيّةُ تقرأُ من البثِّ لا من صفِّ السائقِ، فتأجيلُ الاستمرارِ لا
 *    يُؤجِّلُ ما يراهُ الراكبُ.
 *
 * ## لماذا حالةُ استخدامٍ لا منطقٌ في المسارِ
 *
 * قبلَ هذا الملفِّ كانَ القرارُ كلُّه في `handleLocation` داخلَ حوارِ البوتِ:
 * التقييمُ، والكتابةُ، وامتناعُ النشرِ عندَ `stale`، وإعادةُ العرضِ عندَ
 * الانتقالِ. فمسارُ HTTP لو أعادَ بناءَه لصارَ **حَكَمٌ ثانٍ على الإصلاحةِ**
 * الواحدةِ — وهوَ بعينِه ما ينهى عنه `ADR 0053 §٦` («حَكَمٌ واحدٌ على الأحدثِ»).
 * والترتيبُ ههنا ليسَ تفصيلاً بل هوَ الحكمُ نفسُه، وقد كُلِّفَ ثمنَه مرّتَينِ في
 * `BUG-001` و`BUG-009`:
 *
 *   ١. تقييمُ المجالِ أوّلاً — إصلاحةٌ مرفوضةٌ لا تُكتَبُ ولا تُبَثُّ.
 *   ٢. الكتابةُ الشرطيّةُ في القاعدةِ — القاعدةُ تحكمُ على «الأحدثِ» لا JS.
 *   ٣. المرفوضُ لقِدَمِه (`stale`) **لا يُبَثُّ ولا يُعيدُ عرضاً**: بثُّه يُرجِعُ
 *      الموضعَ المعروضَ إلى الوراءِ، وهوَ التراجعُ الذي وُجِدَ الحارسُ لمنعِه.
 *   ٤. الجلسةُ والبثُّ **بعدَ** استقرارِ الكتابةِ لا قبلَها.
 *   ٥. إعادةُ العرضِ معلَّقةٌ على **الانتقالِ** لا على كلِّ نبضةٍ.
 *
 * ## ما لا تفعلُه عن قصدٍ
 *
 * - **لا تقرأُ هويّةً ولا تُصادِقُ**: مُنادوها يُثبِتونَ مَن هوَ السائقُ ثمَّ
 *   يُمرِّرونَ صفَّه. فلا يُقرَّرُ التفويضُ في موضعَينِ.
 * - **لا تُقرِّرُ نصّاً ولا لوحةً ولا رمزَ HTTP**: تُخرِجُ حكماً مُسمّىً،
 *   والترجمةُ عندَ المُنادي — بوتٌ يُجيبُ برسالةٍ ومسارٌ يُجيبُ برمزٍ.
 * - **لا تكتبُ المنطقةَ المفضَّلةَ**: موقعٌ يصلُ في خطوةِ حوارٍ ليسَ موقعَ عملٍ،
 *   وذلكَ فرعُ حوارٍ يبقى في الحوارِ (البند 2.4).
 * - **لا تُنشئُ سائقاً ولا تُغيِّرُ توفُّرَه**: `POST /v1/driver/availability`
 *   بندٌ آخرُ، ونبضةُ موقعٍ لا تُقلِّبُ حالةَ الوردية.
 */

import {
  assessGpsFix,
  DEFAULT_GPS_POLICY,
  type GpsPolicy,
  type PreviousFix,
} from "../../domain/geo/gps-fix.ts";
import { makeCoordinates } from "../../domain/geo/value-objects.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { DriverProfile, LocationQualityHints, StoredLocationQuality } from "../bots/types.ts";
import type { PortFailureError } from "../ports/index.ts";
import type { StoredFix } from "../tracking/live-tracking.ts";
import type { DriverLocationHotStateWriter } from "./driver-location-hot-state.ts";

/**
 * منفذُ الكتابةِ كما تحتاجُه هذه الحالةُ وحدَها: `Pick` لا الواجهةُ كاملةً، فلا
 * تستطيعُ الحالةُ أن تسجِّلَ سائقاً ولا أن تُغيِّرَ توفُّرَه ولو أرادَ كاتبٌ.
 */
export interface DriverLocationWriter {
  updateLocation(
    driverId: DriverProfile["id"],
    location: { readonly latitude: number; readonly longitude: number },
    quality: StoredLocationQuality,
  ): Promise<
    Result<
      { readonly kind: "accepted" } | { readonly kind: "stale" } | { readonly kind: "no_driver" },
      PortFailureError
    >
  >;
}

export interface UpdateDriverLocationDeps {
  readonly drivers: DriverLocationWriter;
  readonly clock: { now(): Date };
  /** غيابُها يعني سياسةَ المجالِ الافتراضيّةَ لا سياسةً متسامحةً. */
  readonly gpsPolicy?: GpsPolicy;
  /** غيابُها لا يُخفِقُ الاستقبالَ: الكتابةُ القانونيّةُ لا تتوقّفُ على البثِّ. */
  readonly tracking?: { onFix(fix: StoredFix): Promise<void> };
  readonly redispatch?: {
    onDriverBecameDispatchable(cityId: DriverProfile["cityId"]): Promise<void>;
  };
  /**
   * `F4-02`: غيابُها يعني نسقَ `F4-01` بحرفِه — كتابةٌ مشروطةٌ لكلِّ نبضةٍ. وهيَ
   * اختياريّةٌ لا لأنَّ التجميعَ ترفٌ بل لأنَّ الحاويةَ قد تعملُ بلا `Redis`
   * (اختبارٌ، أو نشرٌ ناقصُ الإعدادِ)، ولا يجوزُ أن يسقطَ استقبالُ الموقعِ لذلك.
   */
  readonly hotState?: DriverLocationHotStateWriter;
  /**
   * يُنادى مرّةً لكلِّ نبضةٍ تدهوّرَت: عطلُ `Redis` أو إعداداتٌ ناقصةٌ. ولا يُرمى
   * العطلُ ولا يُبتلَعُ صامتاً — التدهوّرُ الصامتُ يُقرأُ في اللوحةِ نجاحاً تامّاً
   * ثمَّ يُكتشَفُ من فاتورةِ القاعدةِ.
   */
  readonly onHotStateDegraded?: (detail: {
    readonly driverId: DriverProfile["id"];
    readonly cityId: DriverProfile["cityId"];
    readonly reason: string;
  }) => void;
}

export interface UpdateDriverLocationInput {
  /** صفُّ السائقِ كما قرأَه المُنادي بعدَ إثباتِ هويّتِه — لا معرّفٌ من الطلبِ. */
  readonly driver: DriverProfile;
  readonly latitude: number;
  readonly longitude: number;
  readonly quality?: LocationQualityHints;
}

/**
 * `stale` ليسَ خطأً: الحالةُ سليمةٌ ولم تتراجعْ، وإنّما الواصلةُ أقدمُ من
 * المخزَّنةِ فلم تُقدِّمْ شيئاً. والمفرداتُ مفرداتُ `LocationWriteOutcome`
 * نفسُها — فاختلافُ الأسماءِ على المعنى الواحدِ أوّلُ خطوةٍ إلى حَكَمَينِ.
 */
export type UpdateDriverLocationOutcome =
  | {
      readonly kind: "accepted";
      readonly recordedAtMs: number;
      readonly verdict: StoredLocationQuality["verdict"];
      /** انتقالُ «كانَ متاحاً ينقصُه موقعٌ ⇒ صارَ ظاهراً» — يقعُ مرّةً لا كلَّ نبضةٍ. */
      readonly becameLive: boolean;
      /**
       * `F4-02`: أينَ استقرَّ الموضعُ في هذا النداءِ. `direct` صفُّ القاعدةِ
       * مُحدَّثٌ الآنَ · `deferred` الحالةُ الساخنةُ مُحدَّثةٌ والصفُّ يُحدَّثُ في
       * دورةِ الإفراغِ. ويُخرَجُ صريحاً لا يُستنتَجُ: مُنادٍ يحتاجُ صفَّ القاعدةِ
       * فوراً (تقريرٌ، تسويةٌ) يجبُ أن يقرأَ الفرقَ لا أن يظنَّه.
       */
      readonly persistence: "direct" | "deferred";
    }
  | { readonly kind: "stale" };

export type UpdateDriverLocationFailureReason =
  /** حكمَ المجالُ بالرفضِ: إحداثيةٌ غيرُ صالحةٍ أو قِدَمٌ أو قفزةٌ أو سرعةٌ محالةٌ. */
  | "FIX_REJECTED"
  /** الصفُّ غيرَ موجودٍ عندَ الكتابةِ — سائقٌ حُذِفَ بينَ القراءةِ والكتابةِ. */
  | "DRIVER_NOT_FOUND"
  | "WRITE_FAILED";

export interface UpdateDriverLocationError {
  readonly code: "DRIVER_LOCATION_NOT_UPDATED";
  readonly reason: UpdateDriverLocationFailureReason;
  /** رموزُ ملاحظاتِ المُقيِّمِ عندَ الرفضِ — تشخيصٌ للمُنادي بلا إعادةِ تصنيفٍ. */
  readonly findings: readonly string[];
}

function fail(
  reason: UpdateDriverLocationFailureReason,
  findings: readonly string[] = [],
): UpdateDriverLocationError {
  return { code: "DRIVER_LOCATION_NOT_UPDATED", reason, findings };
}

/**
 * السابقةُ تُقرأُ من الصفِّ نفسِه الذي قرأَه المُنادي — لا باستعلامٍ ثانٍ يفتحُ
 * نافذةً تتغيَّرُ فيها القيمةُ بينَ القراءتَينِ. وإحداثيةٌ محفوظةٌ فاسدةٌ لا
 * تُوقِفُ الحاضرَ: تُهمَلُ كسابقةٍ فيُفحَصُ الجديدُ وحدَه.
 */
function previousFixOf(driver: DriverProfile): PreviousFix | null {
  if (driver.lastFix === null) return null;
  const coordinates = makeCoordinates(driver.lastFix.latitude, driver.lastFix.longitude);
  if (!coordinates.ok) return null;
  return { coordinates: coordinates.value, recordedAtMs: driver.lastFix.recordedAtMs };
}

/**
 * حكمُ المُقيِّمِ يُخزَّنُ معَ الموضعِ ولا يُطرَحُ: `WARNING` تعني موقعاً صحيحاً
 * متدهوِّراً، ورفضُه كانَ سيتركُ العملياتَ بلا شيءٍ بدلَ أن يتركَها بشيءٍ
 * موسومٍ — وهوَ الاختيارُ الأسوأُ حينَ يكونُ البديلُ أن يختفيَ السائقُ من
 * الخريطةِ. و`REJECT` لا يبلغُ ههنا أصلاً لأنَّ `fix === null` معَه.
 */
function storedVerdictOf(verdict: string): StoredLocationQuality["verdict"] {
  return verdict === "REJECT" ? "ALERT" : (verdict as StoredLocationQuality["verdict"]);
}

export async function updateDriverLocation(
  input: UpdateDriverLocationInput,
  deps: UpdateDriverLocationDeps,
): Promise<Result<UpdateDriverLocationOutcome, UpdateDriverLocationError>> {
  const driver = input.driver;
  const nowMs = deps.clock.now().getTime();

  // ١) تقييمُ المجالِ: الحكمُ ههنا، والقرارُ بما يُفعَلُ بالحكمِ في هذه الطبقةِ.
  const assessment = assessGpsFix(
    {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracyMeters: input.quality?.accuracyMeters,
      headingDegrees: input.quality?.headingDegrees,
      recordedAtMs: input.quality?.recordedAtMs ?? nowMs,
    },
    previousFixOf(driver),
    nowMs,
    deps.gpsPolicy ?? DEFAULT_GPS_POLICY,
  );
  const findings = assessment.findings.map((finding) => finding.code);
  if (assessment.fix === null) return err(fail("FIX_REJECTED", findings));

  const verdict = storedVerdictOf(assessment.verdict);

  /**
   * ١.٥) `F4-02`: الحالةُ الساخنةُ المشتركةُ أوّلاً، ومنها يُعرَفُ أيُجمَّعُ
   *      الاستمرارُ أم يُكتَبُ الآنَ. وأرضيةُ الحكمِ تُمرَّرُ معَها: طابعُ
   *      الإصلاحةِ المخزّنةِ في القاعدةِ. ولمَ لا يكفي ما في `Redis` وحدَه: مفتاحُ
   *      الحالةِ الساخنةِ له عمرٌ ينتهي، فسائقٌ سكتَ دقائقَ ثمَّ وصلَت له نبضةٌ
   *      **متأخّرةٌ** من شبكةٍ رديئةٍ يجدُ مفتاحَه فارغاً فتُقبَلُ إصلاحةٌ أقدمُ من
   *      صفِّ القاعدةِ ثمَّ تُبَثُّ — وهوَ تراجعُ الموضعِ الذي منعَه `BUG-001`. وإنّما
   *      يُمنَعُ بأن يحكمَ المخزنُ الساخنُ بـ**أحدثِ المعلومَينِ**.
   */
  let persistence: "direct" | "deferred" = "direct";
  if (deps.hotState !== undefined) {
    const hot = await deps.hotState.record({
      cityId: driver.cityId,
      driverId: driver.id,
      latitude: assessment.fix.coordinates.latitude,
      longitude: assessment.fix.coordinates.longitude,
      recordedAtMs: assessment.fix.recordedAtMs,
      /**
       * `F4-05`: **لحظةُ القبولِ تُلتَقَطُ ههنا وتُحمَلُ معَ الإصلاحةِ**، وهيَ
       * `nowMs` عينُها التي قُوِّمَ بها الإصلاحةُ لا قراءةٌ ثانيةٌ للساعةِ: ساعةٌ
       * تُقرأُ مرتَينِ تُعطي رقمَينِ، فمن قارنَ الحكمَ بالطابعِ وجدَ فرقاً لا
       * معنى له. ولمَ ههنا لا في الدالّةِ: هذا **موضعُ القبولِ** — بعدَه لا
       * يعرفُ أحدٌ متى قُبِلَت، فيُختَرَعُ `now()` ويُقالُ للمنتظِرِ ما لا يُعلَمُ.
       */
      observedAtMs: nowMs,
      accuracyMeters: assessment.fix.accuracyMeters ?? null,
      verdict,
      previousRecordedAtMs: driver.lastFix?.recordedAtMs ?? null,
    });
    if (!hot.ok) {
      deps.onHotStateDegraded?.({
        driverId: driver.id,
        cityId: driver.cityId,
        reason: hot.error.detail,
      });
    } else if (hot.value.kind === "stale") {
      /**
       * المخزنُ الساخنُ يحملُ أحدثَ منها، وقاعدةُ حارسِه قاعدةُ حارسِ
       * القاعدةِ حرفاً (`الأقدمُ لا يُزيحُ الأحدثَ`، والمتساويانِ يُقبَلانِ).
       * فمتابعةُ الكتابةِ المشروطةِ رحلةٌ إلى القاعدةِ تعرفُ جوابَها سلفاً.
       * وليسَ هذا حَكَماً ثانياً (`ADR 0053 §٦`): المُسنَدُ واحدٌ والمخزنانِ اثنانِ.
       */
      return ok({ kind: "stale" });
    } else if (hot.value.kind === "queued" && driver.hasLocation) {
      persistence = "deferred";
    }
  }

  // ٢) الكتابةُ الشرطيّةُ: الحارسُ في `where` داخلَ القاعدةِ — `BUG-001`.
  if (persistence === "direct") {
    const saved = await deps.drivers.updateLocation(driver.id, assessment.fix.coordinates, {
      recordedAtMs: assessment.fix.recordedAtMs,
      accuracyMeters: assessment.fix.accuracyMeters,
      verdict,
    });
    if (!saved.ok) return err(fail("WRITE_FAILED", findings));
    if (saved.value.kind === "no_driver") return err(fail("DRIVER_NOT_FOUND", findings));

    /**
     * ٣) الإصلاحةُ التي رفضَتها الكتابةُ الشرطيّةُ لا تُنشَرُ ولا تُحرِّكُ شيئاً:
     *    في القاعدةِ أحدثُ منها، فنشرُها إخراجُ موضعٍ **أقدمَ** إلى الخريطةِ.
     */
    if (saved.value.kind === "stale") return ok({ kind: "stale" });
  }

  // ٤) الجلسةُ والبثُّ بعدَ استقرارِ الكتابةِ — لا قبلَها ولا بلا انتظارٍ.
  await deps.tracking?.onFix({
    driverId: driver.id,
    cityId: driver.cityId,
    latitude: assessment.fix.coordinates.latitude,
    longitude: assessment.fix.coordinates.longitude,
    recordedAtMs: assessment.fix.recordedAtMs,
    accuracyMeters: assessment.fix.accuracyMeters ?? null,
    verdict,
    findings,
  });

  /**
   * ٥) إعادةُ العرضِ على الانتقالِ وحدَه: السائقُ الحيُّ يبثُّ كلَّ ثوانٍ، ومسحُ
   *    طلباتِ المدينةِ عندَ كلِّ نبضةٍ من كلِّ سائقٍ حملٌ لا مقابلَ له.
   *
   * `LOAD-01` — عقدُ هذا المنفذِ **جدولةٌ لا حجبٌ**: منفذُ الإنتاجِ (في حاويةِ
   * البوابةِ) يُجدوِلُ الشوطَ خلفيًّا مخفوضًا للمدينةِ ويعودُ فورًا، لأنَّ
   * انتظارَ مطابقةِ المدينةِ داخلَ مسارِ الطلبِ علَّقَ أولَ موقعٍ لكلِّ سائقٍ
   * بالثواني (قيسَ: وسيطُ 10.4ث) حتى ماتتْ مهلةُ العميلِ — والأرضيّةُ الدوريّةُ
   * (20ث) هيَ الضمانةُ المعلَنةُ سلفًا.
   */
  const becameLive = !driver.hasLocation && driver.isAvailable;
  if (becameLive) await deps.redispatch?.onDriverBecameDispatchable(driver.cityId);

  return ok({
    kind: "accepted",
    recordedAtMs: assessment.fix.recordedAtMs,
    verdict,
    becameLive,
    persistence,
  });
}
