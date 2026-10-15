/**
 * الغرض: الطبقةُ الرقيقةُ التي تنفّذ قرارَ التوجيه (البند `F1-05`): تقرأ الدورَ
 *   من الخادمِ، تسأل `routeForViewer` عن السطح، تحمّل حزمتَه، ثم تعرضه. وفي
 *   `F1-07`: تعرض هيكلَ التحميلِ وشاشاتِ الحالاتِ وتلفّ السطحَ بحدِّ خطأٍ خاصٍّ به.
 * الحالة: منفّذ فعلياً — البند `F1-05`، ومُوسَّعٌ في `F1-07`.
 * ينتمي إلى: apps/miniapp/src/routing (حزمة `shell` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` وحدَه اليوم.
 * ملاحظات مستقبلية: الشريطُ السفليُّ بأربعِ علاماتٍ (القسم 9.3) بندُ `F2`/`F3`.
 *
 * **لا قرارَ صلاحيةٍ في هذا الملفِّ**: القرارُ في `routeForViewer` النقيّةِ فوقَ
 * ردِّ الخادمِ، وهذا الملفُّ أثرٌ جانبيٌّ (طلبُ شبكةٍ · تحميلُ حزمةٍ · عرض).
 * وعندَ أيِّ حالةٍ ليست سطحاً: **لا سطحَ يُعرَض** — لا سطحٌ افتراضيٌّ ولا أدنى.
 *
 * `F1-07` — ثلاثُ إضافاتٍ وحدودُها:
 *   ــ **حدُّ خطأٍ لكلِّ سطح**: سقوطُ سطحِ السائقِ لا يُبيّض التطبيقَ كلَّه، ولا
 *      يُسقِط الإطارَ. والحدُّ الجذريُّ في `App.tsx` يبقى للسقوطِ فوقَ ذلك.
 *   ــ **إعادةُ المحاولةِ بيدِ المستخدمِ وحدَه**: عدّادُ `attempt` يعيد تشغيلَ
 *      الأثرِ عندَ الضغط. ولا مؤقّتَ ولا استقصاءَ دوريّاً (ADR 0035 §4)، ويحرس
 *      ذلك فحصٌ في CI لا اتفاقٌ يُنسى.
 *   ــ **تشخيصُ التعطيلِ بفحصٍ واحدٍ**: عندَ فشلِ نقلٍ يُنادى `GET /health` مرّةً
 *      لتمييزِ «شبكتُك» من «خدمتُنا» (9.7)، ولا يُنادى في غيرِ هذه الحال.
 *
 * وحدٌّ معلَنٌ: إعادةُ المصادقةِ في `SS-05` ليست ههنا — موضعُها الإقلاعُ في
 * `Shell` لأنّ الجلسةَ فوقَ الموجّهِ لا داخلَه، ويُرفَع الطلبُ إليه بـ`onReauth`.
 *
 * `F1-09`: `fetchViewer` صار خاصّيةً إلزاميّةً لا استيراداً — السببُ في
 * `shell/identity-port.ts` وADR 0044.
 */

import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import {
  MINIAPP_DEFAULT_LANGUAGE,
  type MiniAppLanguage,
} from "../../../../packages/shared/i18n/miniapp/core.ts";
import { loadMiniAppLanguage } from "../../../../packages/shared/i18n/miniapp/load.ts";
import { startParamFromBoot } from "../identity/boot.ts";
import type { ViewerView } from "../identity/viewer.ts";
import { ErrorBoundary } from "../shell/ErrorBoundary.tsx";
import { applyDocumentDirection } from "../styles/direction.ts";
import {
  classifyFailure,
  type ReachabilityProbe,
  shouldProbeReachability,
} from "../system/failure.ts";
import { deviceOnline, probeReachability } from "../system/health.ts";
import { Skeleton } from "../system/Skeleton.tsx";
import { SystemScreen } from "../system/SystemScreen.tsx";
import type { ScreenState } from "../system/state-text.ts";
import { currentEntryTarget } from "./entry-target.ts";
import {
  type LoadableSurface,
  loadSurface,
  type NoSurfaceReason,
  type RoleRoute,
  routeForViewer,
  type SurfaceLoaders,
} from "./role-route.ts";

interface SurfaceModule {
  readonly default: ComponentType<LanguageSurfaceProps>;
}

export interface LanguageSurfaceProps {
  /** لغةُ الواجهةِ من الحسابِ (`PD-030`) — تُحقَنُ من الموجّهِ الذي قرأَها من الخادمِ. */
  readonly language: MiniAppLanguage;
  /**
   * تُنادى حينَ يُغيِّرُ المستخدمُ لغتَه من الإعداداتِ — ليُحدِّثَ الموجّهُ حالتَه
   * فينعكسَ التغييرُ على كلِّ السطحِ فوراً.
   */
  readonly onLanguageChanged?: (language: MiniAppLanguage) => void;
  /**
   * هدفُ الهبوطِ الخامُ (`?open=` — `ADR 0213`). يفكُّه السطحُ بجمهورِه؛ ومن لا يعرفُه يتجاهلُه.
   */
  readonly entry?: string | null;
  /**
   * تغيّرَ الحسابُ على الخادمِ (سُجِّلَ الآنَ من سطحِ التسجيلِ): يُعادُ حلُّ الدورِ من
   * `GET /v1/me` كما في الإقلاعِ — لا يُفترَضُ الدورُ الجديدُ في العميلِ (`F1-05`).
   */
  readonly onAccountChanged?: () => void;
}

/**
 * الاستيرادُ الديناميكيُّ هو ما يجعل حزمةَ السائقِ لا تُنزَّل لغيرِه فعلاً
 * (القسم 9.4)، لا تعليقٌ يقول ذلك.
 */
const SURFACE_LOADERS: SurfaceLoaders<SurfaceModule> = {
  rider: () => import("../surfaces/rider/RiderRoot.tsx"),
  driver: () => import("../surfaces/driver/DriverRoot.tsx"),
  admin: () => import("../surfaces/admin/AdminRoot.tsx"),
  onboarding: () => import("../surfaces/onboarding/OnboardingRoot.tsx"),
};

type RouterState =
  | { readonly kind: "resolving" }
  | {
      readonly kind: "surface";
      readonly Component: ComponentType<LanguageSurfaceProps>;
      readonly surface: LoadableSurface;
    }
  | { readonly kind: "screen"; readonly screen: ScreenState };

/**
 * استخراجُ السطحِ المنتجِ من حالةِ الموجّهِ — دالّةٌ صافيةٌ تُختَبَرُ بلا DOM.
 *
 * تُعيدُ اسمَ السطحِ (`rider`/`driver`/`admin`) إن وصلَ الموجّهُ إلى سطحٍ منتجٍ،
 * أو `null` خلافَ ذلك (حلٌّ، شاشةٌ نظاميّةٌ، عطلٌ). العلامةُ التفاعليّةُ لا تُطلَقُ
 * إلا حين تكونُ هذه القيمةُ غيرَ `null` — وهذا ما يمنعُ الإيجابَ الكاذبَ.
 */
export function interactiveSurfaceFromState(
  state: RouterState,
): "rider" | "driver" | "admin" | null {
  // سطحُ التسجيلِ (`ADR 0213`) ليس سطحاً منتجاً للقياسِ (`D-26`): مستخدمٌ غيرُ مبذورٍ يصلُ إليه،
  // واحتسابُه «تفاعلاً» يُعيدُ الإيجابَ الكاذبَ الذي وقعَ في CI حين كانت شاشةُ نظامٍ.
  if (state.kind !== "surface" || state.surface === "onboarding") return null;
  return state.surface;
}

export interface RoleRouterProps {
  /**
   * `F1-09`: قراءةُ الدورِ **تُحقَن**. والموجّهُ في حزمةِ `shell` و`fetchViewer` في
   * حزمةِ `identity` (9.4)، فاستيرادُها ههنا كان يُنتِج دائرةً بين الحزمتَين في
   * البناء. والحاقنُ اليومَ هو `Shell` عن بابِ الهويةِ الذي يستقبله.
   */
  readonly fetchViewer: () => Promise<ViewerView>;
  /**
   * يُنادى حين تكون الجلسةُ هي العطلَ — فالموجّهُ لا يملك مصادقةً ولا يدّعيها.
   * وغيابُه يعني عرضَ الشاشةِ بلا فعلٍ بدلَ زرٍّ لا يفعل شيئاً (`UX-8`).
   */
  readonly onReauth?: () => void;
}

/**
 * تحويلُ سببِ «لا سطحَ» إلى شاشةٍ. وحالةُ `unavailable` وحدَها تحتاج تصنيفاً:
 * سائرُ الأسبابِ قراراتُ تفويضٍ صريحةٌ من الخادمِ لها نصٌّ واحدٌ لا يحتمل تشخيصاً.
 */
async function screenForReason(reason: NoSurfaceReason, view: ViewerView): Promise<ScreenState> {
  if (reason !== "unavailable") return { kind: reason };
  const failure = view.kind === "unavailable" ? view.failure : undefined;
  if (failure === undefined) return { kind: "unknown_error" };

  const online = deviceOnline();
  let probe: ReachabilityProbe = "not_probed";
  if (shouldProbeReachability(failure, online)) probe = await probeReachability();
  return classifyFailure(failure, probe, online) ?? { kind: "unknown_error" };
}

export function RoleRouter({ fetchViewer, onReauth }: RoleRouterProps) {
  const [state, setState] = useState<RouterState>({ kind: "resolving" });
  const [language, setLanguage] = useState<MiniAppLanguage>(MINIAPP_DEFAULT_LANGUAGE);
  // يُقرأُ مرّةً لكلِّ تركيبٍ: الهدفُ يصفُ لحظةَ الفتحِ لا كلَّ إعادةِ رسمٍ.
  // `ADR 0286` — الهدفُ من العنوانِ (`?open=`) فإن غابَ فمن `start_param` الموقَّعِ في
  // التبادلِ (رابطُ `startapp` من بطاقةِ قروبٍ): يُحدَّثُ بعدَ الإقلاعِ مرةً لا في كلِّ رسمٍ.
  const [entryTarget, setEntryTarget] = useState<string | null>(currentEntryTarget);
  const mounted = useRef(true);
  /**
   * `F1-09` الصفُّ ٥ — علامةُ «وقتِ التفاعلِ»: تُوضَعُ مرّةً واحدةً حينَ يَصلُ
   * الموجّهُ إلى **سطحٍ منتجٍ** (راكبٌ أو سائقٌ أو مشرف)، لا عندَ شاشةٍ نظاميّةٍ.
   * والمسارُ إلى الشاشةِ (`unregistered`/`blocked`/`session_*`/`unavailable`/
   * `surface_failed`) **لا يُعَدُّ تفاعلاً** — فشاشةُ الخطأِ سليمةٌ تقنيّاً لكنَّها ليست
   * الناتجَ الذي يُقاسُ زمنُ الوصولِ إليه. والعلامةُ بلا كلفةٍ (`performance.mark`
   * لا يُغيّرُ سلوكاً) وتُقرأُ من `scripts/measure-tti.ts`.
   *
   * **التصحيحُ** (`ح-8`): كانَت تُطلَقُ على `state.kind !== "resolving"` فيدخلُ فيها
   * `screen`، فيصيرُ الوصولُ إلى شاشةِ «غيرِ مسجَّل» تفاعلاً مقبولاً — وهذا مسارُ
   * إيجابٍ كاذبٍ يحوّلُ القياسَ إلى زمنِ الوصولِ إلى شاشةِ خطأٍ لا إلى سطحٍ منتج.
   */
  const interactiveMarked = useRef(false);
  const interactiveSurface = interactiveSurfaceFromState(state);
  useEffect(() => {
    if (!interactiveMarked.current && interactiveSurface !== null) {
      interactiveMarked.current = true;
      if (typeof performance !== "undefined" && typeof performance.mark === "function") {
        performance.mark("waslah-interactive");
        // علامةٌ ثانيةٌ تكشفُ السطحَ المنتجَ الذي وصلَهُ الموجّهُ — تُقرأُ من
        // `scripts/measure-tti.ts` لإثباتِ أنّ القياسَ لم يصلْ إلى شاشةٍ نظاميّةٍ.
        performance.mark(`waslah-surface:${interactiveSurface}`);
        // `DEC-19`: اسمُ `waslah-interactive` تاريخيٌّ ويعني «بلوغَ حالةِ السطحِ» لا التفاعلَ؛
        // وزمنُ رسمِ سطحِ الراكبِ يُقاسُ بـElement Timing في `WelcomeScreen.tsx` لا هنا.
      }
    }
  }, [interactiveSurface]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * محاولةٌ واحدةٌ كاملة. تُنادى مرّةً عندَ التركيبِ ومرّةً كلَّما ضغط المستخدمُ
   * «إعادةَ المحاولة» — **ولا يناديها مؤقّتٌ ولا مستمعٌ دوريّ** (ADR 0035 §4).
   */
  const resolve = useCallback(async () => {
    setState({ kind: "resolving" });
    const view = await fetchViewer();
    if (entryTarget === null) {
      const signed = startParamFromBoot();
      if (signed !== null) setEntryTarget(signed);
    }
    // `PD-030`: لغةُ الواجهةِ تُقرأُ من الحسابِ لا تُفترَضُ. وغيابُها أو بطلانُها
    // يعني أنَّ الردَّ ناقصٌ فلا يُكملُ — `fetchViewer` يُعيدُ `unavailable` حينَها.
    // `D-29` · `ADR 0186`: قاموسُ لغةِ الحسابِ يُحمَّلُ **بالتوازي** معَ حزمةِ السطحِ، ولا
    // تُعرَضُ اللغةُ قبلَ تسجيلِ قاموسِها. والفشلُ كفشلِ السطحِ: شاشةٌ بإعادةِ محاولةٍ.
    const dictionary: Promise<boolean> =
      view.kind === "viewer"
        ? loadMiniAppLanguage(view.languageCode).then(
            () => true,
            () => false,
          )
        : Promise.resolve(true);
    const route: RoleRoute = routeForViewer(view);
    if (route.surface === "none") {
      await dictionary;
      if (view.kind === "viewer" && mounted.current) setLanguage(view.languageCode);
      const screen = await screenForReason(route.reason, view);
      if (mounted.current) setState({ kind: "screen", screen });
      return;
    }
    const [outcome, dictionaryLoaded] = await Promise.all([
      loadSurface(route, SURFACE_LOADERS),
      dictionary,
    ]);
    if (!mounted.current) return;
    if (!dictionaryLoaded) {
      setState({ kind: "screen", screen: { kind: "surface_failed" } });
      return;
    }
    if (view.kind === "viewer") setLanguage(view.languageCode);
    if (outcome.loaded === "none" || "failed" in outcome) {
      setState({ kind: "screen", screen: { kind: "surface_failed" } });
      return;
    }
    setState({ kind: "surface", Component: outcome.module.default, surface: outcome.loaded });
  }, [fetchViewer, entryTarget]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  // `UI-10`: لغةُ الحسابِ تحكمُ `<html lang dir>` لا الافتراضُ وحدَه — وإلّا بقيَ الإطارُ
  // والتبويبُ والعنوانُ RTL لحسابٍ إنجليزيٍّ وقُرئت الأرديّةُ بوسمِ `ar` (دليلُ متصفّحٍ حيٍّ).
  useEffect(() => {
    applyDocumentDirection(language);
  }, [language]);

  const retry = () => void resolve();

  /**
   * `D-29`: تبديلُ اللغةِ من الإعداداتِ لا يعرضُ لغةً قبلَ تسجيلِ قاموسِها — وإلّا ظهرَ
   * الافتراضيُّ باسمِ لغةٍ أخرى. وإن تعذَّرَ التحميلُ بقيَت اللغةُ الحاليّةُ (الحفظُ في الحسابِ
   * تمَّ، والقراءةُ التاليةُ تُعيدُ المحاولةَ).
   */
  const changeLanguage = useCallback((next: MiniAppLanguage) => {
    loadMiniAppLanguage(next).then(
      () => {
        if (mounted.current) setLanguage(next);
      },
      () => undefined,
    );
  }, []);

  if (state.kind === "resolving") return <Skeleton />;

  if (state.kind === "screen") {
    const needsSession =
      state.screen.kind === "session_expired" || state.screen.kind === "session_invalid";
    // شاشةُ الجلسةِ بلا مُصادِقٍ فوقَها تُعرَض بلا زرّ: زرٌّ لا يؤدّي إلى مصادقةٍ
    // أسوأُ من لا زرٍّ. وسائرُ الشاشاتِ فعلُها إعادةُ القراءة.
    const action = needsSession ? onReauth : retry;
    // الحذفُ لا التمريرُ بـ`undefined`: `exactOptionalPropertyTypes` مفعَّلٌ،
    // وغيابُ الفعلِ هو ما يجعل الزرَّ لا يُرسَم أصلاً.
    return action === undefined ? (
      <SystemScreen state={state.screen} />
    ) : (
      <SystemScreen state={state.screen} onAction={action} />
    );
  }

  const { Component } = state;
  return (
    <ErrorBoundary label="surface" onReset={retry}>
      <Component
        language={language}
        onLanguageChanged={changeLanguage}
        entry={entryTarget}
        onAccountChanged={retry}
      />
    </ErrorBoundary>
  );
}
