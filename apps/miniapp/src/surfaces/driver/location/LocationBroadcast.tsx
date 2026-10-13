/**
 * الغرض: باثُّ موقعِ السائقِ — **غلافُ مؤقّتٍ حولَ حكمٍ نقيٍّ**، يقولُ للسائقِ
 *   في سطرٍ واحدٍ أيُبَثُّ موضعُه الآنَ أم لا ولِمَ (البند `F3-04`).
 * الحالة: منفَّذٌ فعليّاً — البند `F3-04`.
 * ينتمي إلى: apps/miniapp/src/surfaces/driver/location
 * يُستخدم من: `DriverRoot.tsx` — **في الجذرِ لا في شاشةٍ**: سائقٌ متاحٌ يبثُّ
 *   وهوَ في لوحِ العروضِ، ولا يُشترَطُ فتحُ شاشةِ المَهمّةِ ليُعرَفَ موضعُه.
 * يُتوقع أن يستخدمه لاحقاً: `F3-05`+ تُركَّبُ حولَه ولا تُنسَخُ حلقتُه.
 * يحرسُه: scripts/check-location-broadcast-contract.ts ·
 *   tests/unit/driver-location-broadcast.test.ts
 * الحاكم: docs/adr/0119-a-heartbeat-needs-a-published-reason.md
 *
 * ## لِمَ البثُّ **مُعلَنٌ للسائقِ** لا خفيٌّ
 *
 * تطبيقٌ يبثُّ موضعَ إنسانٍ بلا أن يقولَ له **خيانةُ ثقةٍ** ولو كانَ الإذنُ
 * مُعطىً؛ وسائقٌ يرى «يُبَثُّ موضعُك كلَّ ١٥ ثانيةً — لأنَّك في طريقِك إلى
 * الالتقاطِ» يفهمُ ولا يُفاجَأُ. **والسببُ يُقالُ بنصِّه**: «لا يُبَثُّ» وحدَها
 * تجعلُ سائقاً يظنُّ عطلاً وهوَ إعدادُ إذنٍ في يدِه.
 *
 * ## وما لا يفعلُه هذا السطحُ عن قصدٍ — (`ح-5`)
 *
 *   ــ **لا يطلبُ إذناً من نفسِه**: `openSettings` لتلغرامَ **تُشترَطُ لمسةُ
 *      إنسانٍ**، ونافذةٌ تُفتَحُ بلا لمسةٍ تُحجَبُ أو تُقرأُ عُدواناً. فالزرُّ
 *      يُعرَضُ ومَن ضغطَه فتحَ.
 *   ــ **لا يرسمُ خريطةً ولا يعرضُ إحداثيّاتٍ**: موضعُ السائقِ ليسَ منتَجاً
 *      يُعرَضُ له، ورقمانِ على شاشةٍ لا يُغيِّرانِ فعلَه.
 *   ــ **لا يحسبُ مُدّةً ولا يخترعُها**: المُدّةُ من الخادمِ، وغيابُها سكونٌ.
 *   ــ **لا يُقاسُ في الميدانِ بعدُ**: أثرُ البثِّ في البطاريّةِ وصدقُ الموضعِ
 *      تحتَ الأنفاقِ **غيرُ مقيسَينِ**، ولا يُدَّعى فيهما شيءٌ.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BroadcastDecision,
  type LocationAccess,
  nextBroadcastDecision,
} from "../../../../../../packages/domain/driver/location-broadcast.ts";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
  miniAppTranslator,
} from "../../../../../../packages/shared/i18n/miniapp/core.ts";
import { ApiError } from "../../../api/client.ts";
import {
  initLocation,
  locationAccess,
  openLocationSettings,
  requestLocation,
} from "../../../tg/index.ts";
import { readDriverActiveJob } from "../job/job-api.ts";
import type { ApiLocationBroadcast } from "../job/job-contract.ts";
import {
  lastLocationBroadcastPolicy,
  onLocationBroadcastPolicy,
  postDriverLocation,
} from "./broadcast-api.ts";

/**
 * كم نبضةً تمضي قبلَ إعادةِ قراءةِ السياسةِ. **ولِمَ حدٌّ أصلاً**: ضبطُ المُشغِّلِ
 * لمُدّةٍ في `platform_settings` يجبُ أن يبلغَ الأجهزةَ بلا نشرِ حزمةٍ، وسائقٌ
 * لا يفتحُ شاشةَ مَهمّتِه لا يُعيدُ القراءةَ أبداً. وعشرٌ لأنَّها **عُشرُ كلفةِ
 * نبضةٍ** فلا تُضاعِفُ الرحلاتَ، وتُبلِغُ التغييرَ في عشرِ مُدَدٍ لا في يومٍ.
 */
export const POLICY_REFRESH_EVERY_PULSES = 10;

export interface LocationBroadcastProps {
  readonly language?: MiniAppLanguage;
  /** تُحقَنُ في الاختبارِ؛ وفي الإنتاجِ مُضيفُ تلغرامَ وحدَه. */
  readonly access?: () => LocationAccess | null;
  readonly readFix?: typeof requestLocation;
  readonly send?: typeof postDriverLocation;
  readonly refreshPolicy?: () => Promise<unknown>;
  readonly openSettings?: () => unknown;
  /** `UI-LOC-02` — تهيئةُ `LocationManager`؛ تُحقَنُ في الاختبارِ. */
  readonly init?: () => Promise<unknown>;
}

function accessNow(): LocationAccess | null {
  return locationAccess();
}

export function LocationBroadcast(props: LocationBroadcastProps) {
  const t = miniAppTranslator(props.language ?? MINIAPP_DEFAULT_LANGUAGE);
  const readAccess = props.access ?? accessNow;
  const readFix = props.readFix ?? requestLocation;
  const send = props.send ?? postDriverLocation;
  const refreshPolicy = props.refreshPolicy ?? readDriverActiveJob;
  const openSettings = props.openSettings ?? openLocationSettings;
  const init = props.init ?? initLocation;
  /**
   * `UI-LOC-02` — `isLocationAvailable` لا يُضبَطُ إلّا بعدَ `LocationManager.init`.
   * وبلا تهيئةٍ كانَ كلُّ سائقٍ يُحكَمُ عليه «تلغرام عندك لا يتيح الموقع» ولو كانَ
   * يُتيحُه. فالتهيئةُ مرّةً عندَ التركيبِ، ثمَّ يُعادُ الحكمُ بقراءةِ الحالِ بعدَها.
   */
  const [inited, setInited] = useState(false);
  useEffect(() => {
    let alive = true;
    void init()
      .catch(() => undefined)
      .finally(() => {
        if (alive) setInited(true);
      });
    return () => {
      alive = false;
    };
  }, [init]);

  const [policy, setPolicy] = useState<ApiLocationBroadcast | null>(lastLocationBroadcastPolicy);
  const [decision, setDecision] = useState<BroadcastDecision | null>(null);

  const lastAttemptAtMs = useRef<number | null>(null);
  const consecutiveFailures = useRef(0);
  const lastError = useRef<string | null>(null);
  const pulsesSinceRefresh = useRef(0);
  const busy = useRef(false);

  useEffect(() => onLocationBroadcastPolicy(setPolicy), []);

  // قراءةٌ واحدةٌ عندَ التركيبِ: **إن لم تكن سياسةٌ بعدُ**. وسائقٌ فتحَ شاشةَ
  // مَهمّتِه فالقراءةُ نشرَت سياستَه، فلا تُعادُ لِما هوَ معلومٌ.
  useEffect(() => {
    if (lastLocationBroadcastPolicy() !== null) return;
    void refreshPolicy().catch(() => undefined);
  }, [refreshPolicy]);

  const pulse = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const fix = await readFix();
      lastAttemptAtMs.current = Date.now();
      if (!fix.ok) {
        // إذنٌ مرفوضٌ أو مُضيفٌ لا يُعطي موضعاً **ليسَ فشلَ شبكةٍ**: لا تراجعَ
        // عليهِ، والحكمُ يعودُ سكوناً من حالِ الإذنِ في الدورةِ التاليةِ.
        return;
      }
      const response = await send({
        latitude: fix.value.latitude,
        longitude: fix.value.longitude,
        ...(fix.value.horizontalAccuracy === null
          ? {}
          : { accuracyMeters: fix.value.horizontalAccuracy }),
        ...(fix.value.course === null ? {} : { headingDegrees: fix.value.course }),
      });
      // `STALE` **ليسَت فشلاً**: وصلَ أحدثُ منها، وإعادةُ إرسالِها تكرارٌ. ورفضُ
      // القياسِ (`FIX_REJECTED`) لا يُعادُ بنفسِ القراءةِ — كلاهما يصفِّرُ التراجعَ.
      consecutiveFailures.current = 0;
      lastError.current = null;
      void response;
    } catch (error) {
      lastAttemptAtMs.current = Date.now();
      const code = error instanceof ApiError ? error.code : null;
      lastError.current = code;
      // رفضُ القياسِ عطبُ قراءةٍ لا انقطاعُ شبكةٍ: لا تُضاعَفُ المُهلةُ عليه.
      if (code !== "FIX_REJECTED") consecutiveFailures.current += 1;
    } finally {
      busy.current = false;
      pulsesSinceRefresh.current += 1;
      if (pulsesSinceRefresh.current >= POLICY_REFRESH_EVERY_PULSES) {
        pulsesSinceRefresh.current = 0;
        void refreshPolicy().catch(() => undefined);
      }
    }
  }, [readFix, send, refreshPolicy]);

  useEffect(() => {
    // لا حكمَ قبلَ التهيئةِ: حكمٌ مبكّرٌ كانَ يُومِضُ «لا يتيح الموقع» ثمَّ يختفي.
    if (!inited) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const verdict = nextBroadcastDecision({
        policy: {
          reason: policy?.reason ?? null,
          intervalSeconds: policy?.interval_seconds ?? null,
        },
        nowMs: Date.now(),
        lastAttemptAtMs: lastAttemptAtMs.current,
        consecutiveFailures: consecutiveFailures.current,
        access: readAccess(),
        lastError: lastError.current,
      });
      setDecision(verdict);
      if (verdict.kind === "STOP") return;
      if (verdict.kind === "SEND") {
        void pulse().finally(() => {
          if (!stopped) timer = setTimeout(tick, 250);
        });
        return;
      }
      timer = setTimeout(tick, verdict.delayMs);
    };

    tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [policy, pulse, readAccess, inited]);

  if (decision === null) return null;

  if (decision.kind === "STOP") {
    // **السببُ يُقالُ**، ومَن سببُه إذنٌ يُعطى زرَّ إعدادٍ لا نصّاً يائساً.
    const body = t(`driver.location.stop.${decision.why}`);
    return (
      <section className="dlb" aria-live="polite">
        <p className="dlb__state">{body}</p>
        {decision.why === "PERMISSION_NOT_GRANTED" ? (
          <button type="button" className="dlb__settings" onClick={() => openSettings()}>
            {t("driver.location.openSettings")}
          </button>
        ) : null}
      </section>
    );
  }

  const seconds = policy?.interval_seconds ?? null;
  return (
    <section className="dlb" aria-live="polite">
      <p className="dlb__state">
        {seconds === null
          ? t("driver.location.on")
          : t("driver.location.onEvery").replace("{seconds}", String(seconds))}
      </p>
      <p className="dlb__reason">{t(`driver.location.reason.${decision.reason}`)}</p>
      {/* `WR-16A` · `WR-12`: تذكيرُ البوتِ يُودَعُ للسائقِ المتاحِ بلا رحلةٍ قائمة حين يقدُمُ موضعُه،
          فيُذكَرُ في حالِ التوافرِ وحدَها — لا يُوعَدُ به في رحلةٍ جارية. */}
      {decision.reason === "AVAILABLE" ? (
        <p className="dlb__reminder">{t("driver.location.reminderNote")}</p>
      ) : null}
    </section>
  );
}
