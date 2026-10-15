/**
 * الغرض: **وصلُ مسارِ الإقلاعِ كاملاً** — من فتحِ التطبيقِ إلى جلسةٍ صالحةٍ في
 *   الذاكرة: تجديدٌ من التخزينِ الآمنِ إن أمكن، وإلّا مبادلةُ `initData` الخامِ
 *   بجلسةٍ عبرَ `POST /v1/session/telegram` (القسم 9.8 · ADR 0035: بوت ← تطبيق
 *   مصغَّر ← تحقّق ← جلسة ← API).
 * الحالة: منفّذ فعلياً — البند `F1-07`.
 * ينتمي إلى: apps/miniapp/src/identity (حزمة `identity` — القسم 9.4)
 * يُتوقع أن يستخدمه لاحقاً: `shell/Shell.tsx` عندَ الإقلاعِ، و`RoleRouter` عندَ
 *   ردِّ `401` لإعادةِ المصادقةِ بلا فقدانِ مسارِ العمل (`SS-05`).
 * ملاحظات مستقبلية: **ربطُ المستخدمِ أو إنشاؤه عندَ أوّلِ جلسةٍ** (القسم 9.8
 *   الخطوة 4) غيرُ منفَّذٍ على الخادمِ ولا يُنفَّذ ههنا: العميلُ لا يخلق حالةَ عملٍ
 *   (ADR 0035). فمستخدمٌ لا صفَّ له يبقى `unregistered` في `/v1/me` وهذا صحيحٌ لا
 *   عطل. وإعادةُ المحاولةِ التلقائيةُ داخلَ `apiFetch` بعدَ `401` ما زالت خارجَ
 *   حدِّ النقلِ عن قصد (`F1-04`): الفعلُ ههنا صريحٌ يناديه المنادي.
 *
 * ما لا يفعله هذا الملفُّ عن قصد:
 *   ــ لا يقرأ دوراً ولا يكتبه: الدورُ من `GET /v1/me` وحدَه (`F1-05`).
 *   ــ لا يسجّل `initData` ولا رمزاً ولا جزءاً منهما، ولا في رسالةِ خطأ.
 *   ــ لا يمسّ `SecureStorage` مباشرةً: عبرَ `session-storage.ts` وحدَه (`F1-04`).
 *   ــ `F1-08`: لا يُنشئ قياساً ولا يختار مَصرِفاً — يستقبل `telemetry` أو لا
 *      يستقبلها، ويسجّل **حدثاً واحداً لكلِّ إقلاعٍ** لا حدثاً لكلِّ خطوة.
 *   ــ لا يعيد المحاولةَ تلقائياً ولا يستقصي دوريّاً (ADR 0035 §4): يُنادى مرّةً
 *      عندَ الإقلاعِ، ومرّةً حين يطلب المستخدمُ إعادةَ المصادقة.
 */

import { ApiError, ApiNetworkError, type ApiObserver, apiFetch } from "../api/client.ts";
import type { Telemetry } from "../telemetry/telemetry.ts";
import { getRawInitData, isInsideTelegram } from "../tg/index.ts";
import { consumePrebootSession } from "./preboot.ts";
import { type RenewOptions, renewSessionFromStorage } from "./renew.ts";
import { hasValidSession, setSession } from "./session.ts";
import { type DeviceSecureStore, persistRefreshToken } from "./session-storage.ts";

/** ردُّ مبادلةِ الجلسةِ كما يعلنه المسارُ — رمزُ التجديدِ اختياريٌّ في العقد. */
interface ExchangeResponse {
  readonly ok: true;
  readonly accessToken: string;
  readonly expiresAtMs: number;
  readonly refreshToken?: string;
  /**
   * `ADR 0286` — هدفُ الهبوطِ من `startapp` كما وقّعهُ تيليجرامُ في `initData`
   * (`start_param`): تموجيهٌ لا هويةَ ولا صلاحيةَ — الهويّةُ من التوقيعِ وحده.
   */
  readonly startParam?: string;
}

export type BootFailureReason =
  /** المضيفُ ليس تيليجرام — لا مصادقةَ بديلةَ اليومَ (ARCH-014). */
  | "OUTSIDE_TELEGRAM"
  /** داخلَ تيليجرامَ ولا بيانَ فتحٍ: لا شيءَ يُبادَل به. */
  | "MISSING_INIT_DATA"
  /** الخادمُ لم يقبل إثباتَ الهويةِ (`401`) — إعادةُ فتحٍ من البوتِ هي العلاج. */
  | "REJECTED"
  /** لم يصل ردٌّ، أو تعطّلت الخدمةُ: يُصنَّف لاحقاً بـ`classifyFailure`. */
  | "UNAVAILABLE";

export type BootResult =
  | { readonly established: true; readonly via: "existing" | "renewed" | "exchanged" }
  | {
      readonly established: false;
      readonly reason: BootFailureReason;
      /** ما رماه الحدُّ — يُمرَّر ليُصنَّف شاشةً، ولا يُصنَّف ههنا. */
      readonly thrown?: unknown;
    };

/**
 * تُحقَن كي يُختبَر ترتيبُ المحاولاتِ بلا شبكةٍ ولا تيليجرام. والحقنُ ههنا
 * ضرورةُ اختبارٍ لا مرونةُ تصميمٍ: للإنتاجِ مسارٌ واحدٌ لا يُبدَّل.
 */
export interface BootDeps {
  readonly insideTelegram?: () => boolean;
  readonly rawInitData?: () => string | null;
  readonly renew?: (
    store?: DeviceSecureStore,
    observe?: ApiObserver,
    options?: RenewOptions,
  ) => ReturnType<typeof renewSessionFromStorage>;
  readonly exchange?: (initData: string, observe?: ApiObserver) => Promise<ExchangeResponse>;
  readonly persist?: typeof persistRefreshToken;
  readonly sessionValid?: () => boolean;
  /** ساعةُ صلاحيةِ التبادلِ المُقدَّم — محقونةٌ في الاختبار. */
  readonly now?: () => number;
  /**
   * `F1-09`: استهلاكُ تبادلِ الجلسةِ المُقدَّمِ من السكربتِ الساكنِ في `index.html`.
   * غيابُه يعني أنَّ السكربتَ الساكنَ لم يُبدِئْ تبادلًا (خارجَ تيليجرامَ مثلًا) —
   * فيمضي `establishSession` في مسارِه التقليديِّ. والحاقنُ للاختبارِ وحدَه.
   */
  readonly consumePreboot?: () => Promise<ExchangeResponse> | null;
  /**
   * `F1-08`: القياسُ اختياريٌّ — غيابُه يعني أنّ الإقلاعَ لا يسجّل حدثاً، وحضورُه
   * يعني حدثاً واحداً لكلِّ إقلاعٍ مربوطاً بمعرّفِ الطلبِ حين يكون هناك طلبٌ.
   * وهو **مُستقبَلٌ لا مُنشَأٌ ههنا**: مسارُ الإقلاعِ لا يملك قرارَ المَصرِف.
   */
  readonly telemetry?: Telemetry;
  /** BOOT-DEADLINES: مهلتا انتظارِ التبادلِ المُقدَّمِ والمبادلةِ — محقونتانِ في الاختبار. */
  readonly deadlines?: { readonly prebootMs?: number; readonly exchangeMs?: number };
}

/**
 * BOOT-DEADLINES: لا إقلاعَ يبقى على الهيكلِ بلا نهاية. وانقضاءُ المهلةِ **لا يُلغي
 * الطلبَ ولا يُعيدُ مبادلةَ `initData`**: قد يكونُ وصلَ فاستهلكَه حارسُ الإعادة، ومبادلةٌ
 * ثانيةٌ تُقرأُ حينئذٍ «رُفِضَت هويّتُك» — تعطّلٌ مؤقّتٌ يُعرَضُ رفضًا. فيُعرَضُ «لا اتصال»
 * بإعادةِ محاولة. والقيمتانِ فوقَ ذهابٍ وإيابٍ على Slow 3G بأضعاف، ودونَ مهلةِ WebView (≈60 ث).
 */
export const PREBOOT_DEADLINE_MS = 15_000;
export const EXCHANGE_DEADLINE_MS = 20_000;

const TIMED_OUT: unique symbol = Symbol("timed-out");

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (thrown: unknown) => {
        clearTimeout(timer);
        reject(thrown);
      },
    );
  });
}

/**
 * معرّفُ مستخدمِ تيليجرامَ من `initData` الخامِ — **لا يُوثَقُ به للمنح**: يُقارَنُ
 * بموضوعِ رمزِ التجديدِ المحفوظِ فيُمتنَعُ عن تجديدِ حسابٍ آخر. وما لا يُقرأُ = `null`.
 */
export function initDataSubject(initData: string | null): string | null {
  if (initData === null || initData.length === 0) return null;
  try {
    const user = new URLSearchParams(initData).get("user");
    if (user === null) return null;
    const id = (JSON.parse(user) as { id?: unknown }).id;
    return typeof id === "number" || (typeof id === "string" && id.length > 0) ? String(id) : null;
  } catch {
    return null;
  }
}

const defaultExchange = (initData: string, observe?: ApiObserver): Promise<ExchangeResponse> =>
  apiFetch<ExchangeResponse>("/v1/session/telegram", {
    method: "POST",
    body: { initData },
    // مسارٌ عامٌّ: إثباتُ الهويةِ فيه `initData` الموقَّعُ لا رمزُ وصول.
    public: true,
    ...(observe === undefined ? {} : { observe }),
  });

/**
 * ترتيبُ المحاولاتِ مقصودٌ: **ما دُفِعَ ثمنُه فالأرخصُ فالأغلى** (ADR 0259).
 *   1. جلسةٌ صالحةٌ في الذاكرة — لا نداءَ إطلاقاً.
 *   2. التبادلُ المُقدَّمُ إن أرسلَه سكربتُ المستند — **يُرسَلُ دائماً حينَ يوجدُ `initData`**،
 *      فثمنُه مدفوعٌ قبلَ هذا السطر. وهو جلسةٌ أصدرَها الخادمُ الآنَ بعدَ تحقّقِ HMAC
 *      و`auth_date` وحارسِ الإعادة، ومعَه قراءتا الإقلاعِ (ADR 0210) بالرمزِ نفسِه.
 *      وتقديمُ التجديدِ عليه كانَ يُهدِرُه ويُهدِرُ قراءتَيه، فيتسلسلُ بعدَ تحميلِ الحزمِ
 *      ثلاثةُ ذهابٍ وإيابٍ (التجديد ← `/v1/me` ← `/v1/consents`) لكلِّ راكبٍ عائد.
 *   3. تجديدٌ من رمزٍ محفوظ — حينَ لا تقديمَ أو فشلَ (`initData` منتهٍ أو مُستهلَكٌ
 *      بعدَ إعادةِ تحميلٍ، أو تعطّلُ شبكة).
 *   4. مبادلةُ `initData` — حين لا رمزَ محفوظاً أو رُفِض.
 */
/**
 * `ADR 0286` — هدفُ الهبوطِ من `start_param` الموقَّعِ (إن وُجِدَ في آخر تبادلٍ ناجحٍ):
 * بطاقةُ القروبِ تفتحُ التطبيقَ برابطِ `startapp` فتصلَ الشاشةُ إلى هدفِها من التبادلِ
 * الموثَّقِ لا من ضميمةٍ خامٍ. يُقرأُ مرةً بعدَ الإقلاعِ لا في كلِّ رسمٍ.
 */
const bootStartParam: string | null = null;
export function startParamFromBoot(): string | null {
  return bootStartParam;
}

export function establishSession(deps: BootDeps = {}): Promise<BootResult> {
  // ADR 0259: نداءانِ متزامنانِ يتشاركانِ إقلاعاً واحداً. وإلّا مضى الثاني — والتقديمُ
  // مُستهلَكٌ في الأوّل — إلى تجديدٍ أو مبادلةٍ فأصدرَ جلسةً ثانية. لا ذاكرةَ للنتيجةِ بعدَ
  // انتهائِها: إعادةُ المحاولةِ بعدَ شاشةِ فشلٍ إقلاعٌ جديد.
  if (inflight !== null) return inflight;
  const run = establishSessionOnce(deps);
  inflight = run;
  const release = (): void => {
    if (inflight === run) inflight = null;
  };
  run.then(release, release);
  return run;
}

let inflight: Promise<BootResult> | null = null;

async function establishSessionOnce(deps: BootDeps): Promise<BootResult> {
  /**
   * `F1-08`: آخِرُ معرّفِ طلبٍ رآه هذا الإقلاعُ. والمُراقِبُ يُمرَّر إلى حدِّ API
   * فيأتي المعرّفُ **من رأسِ الردِّ نفسِه** لا من توليدٍ في العميلِ (ADR 0043).
   */
  let lastRequestId: string | null = null;
  const observe: ApiObserver = (observation) => {
    lastRequestId = observation.requestId;
  };
  const record = (
    outcome: "existing" | "renewed" | "exchanged" | "failed",
    reason: string | null,
  ): void => {
    deps.telemetry?.record({ kind: "boot", outcome, reason, requestId: lastRequestId });
  };

  const sessionValid = deps.sessionValid ?? hasValidSession;
  if (sessionValid()) {
    // جلسةٌ في الذاكرةِ: لا نداءَ إطلاقاً فلا معرّفَ طلبٍ — وهذا حدٌّ لا نقصٌ.
    record("existing", null);
    return { established: true, via: "existing" };
  }

  // ADR 0259: التبادلُ المُقدَّمُ أوّلاً. يُستهلَكُ مرّةً واحدة؛ وفشلُه لا يُعرَضُ قبلَ أن
  // يُجرَّبَ التجديد — فإعادةُ تحميلٍ بـ`initData` مُستهلَكٍ تجدُ الرمزَ المحفوظَ كما كانت.
  const preboot = (deps.consumePreboot ?? consumePrebootSession)();
  let prebootFailure: { readonly thrown: unknown } | null = null;
  // BOOT-DEADLINES: تقديمٌ لم يُجِبْ في مهلتِه قد يكونُ استهلكَ `initData`، فلا مبادلةَ بعدَه.
  let prebootPending = false;
  if (preboot !== null) {
    let prebootResponse: ExchangeResponse | null = null;
    try {
      const settled = await withDeadline(preboot, deps.deadlines?.prebootMs ?? PREBOOT_DEADLINE_MS);
      if (settled === TIMED_OUT) {
        prebootPending = true;
        throw new Error("preboot:timeout");
      }
      const response = settled;
      // جلسةٌ منتهيةٌ لا تُقام لتوفيرِ نداء: تُعامَلُ فشلاً فيُجرَّبُ التجديد.
      if (!(response.expiresAtMs > (deps.now ?? Date.now)())) {
        throw new Error("preboot:expired");
      }
      prebootResponse = response;
    } catch (thrown) {
      prebootFailure = { thrown };
    }
    // الإقامةُ خارجَ `try`: فشلُ حفظِ الرمزِ بعدَ `setSession` لا يُقرأُ فشلَ تبادلٍ
    // فيُطلِقُ تجديداً وجلسةً ثانية — يصعدُ كما يصعدُ في المبادلةِ العاديّة.
    if (prebootResponse !== null) {
      // ردٌّ متأخّرٌ لا يطغى على جلسةٍ أُقيمَت في أثناءِ انتظارِه (نداءٌ متزامن).
      if (sessionValid()) {
        record("existing", null);
        return { established: true, via: "existing" };
      }
      return await adopt(prebootResponse);
    }
  }

  const renew = deps.renew ?? renewSessionFromStorage;
  // تبديلُ الحساب: رمزٌ محفوظٌ لحسابٍ غيرِ حسابِ الفتحِ لا يُجدَّد (`OTHER_ACCOUNT`).
  const expectedSubject = initDataSubject((deps.rawInitData ?? getRawInitData)());
  const renewal = await renew(undefined, observe, { expectedSubject });
  if (renewal.renewed) {
    record("renewed", null);
    return { established: true, via: "renewed" };
  }
  if (prebootPending) {
    record("failed", "UNAVAILABLE");
    return { established: false, reason: "UNAVAILABLE", thrown: new ApiNetworkError() };
  }
  // تعطّلُ الشبكةِ في التجديدِ لا يُتبَع بمبادلةٍ: الرمزُ المحفوظُ قد يكون صالحاً،
  // ومبادلةٌ الآنَ تُصدِر جلسةً ثانيةً بلا حاجة. الشاشةُ تعرض تعطّلاً والفعلُ للمستخدم.
  if (renewal.reason === "UNAVAILABLE") {
    record("failed", "UNAVAILABLE");
    return { established: false, reason: "UNAVAILABLE" };
  }

  const inside = (deps.insideTelegram ?? isInsideTelegram)();
  if (!inside) {
    record("failed", "OUTSIDE_TELEGRAM");
    return { established: false, reason: "OUTSIDE_TELEGRAM" };
  }

  const initData = (deps.rawInitData ?? getRawInitData)();
  if (initData === null || initData.length === 0) {
    record("failed", "MISSING_INIT_DATA");
    return { established: false, reason: "MISSING_INIT_DATA" };
  }

  let response: ExchangeResponse;
  try {
    if (prebootFailure !== null) {
      // `UI-SESS-01`: السكربتُ الساكنُ يرفضُ بـ`Error("preboot:<status>")` لا بـ`ApiError`،
      // فكانَ رفضُ `401` يُصنَّفُ «لا اتصال» ويَعِدُ زرُّه بما لا يقعُ. والمبادلةُ
      // العاديّةُ تُعيدُ الجوابَ مُصنَّفاً بحالتِه؛ وإن كانَ البيانُ مُستهلَكاً رفضَته
      // حمايةُ الإعادةِ فيُقالُ «أعد فتحَ التطبيق» صدقاً.
      const failure = prebootFailure.thrown;
      if (failure instanceof ApiError || failure instanceof ApiNetworkError) {
        throw failure;
      }
    }
    const settled = await withDeadline(
      (deps.exchange ?? defaultExchange)(initData, observe),
      deps.deadlines?.exchangeMs ?? EXCHANGE_DEADLINE_MS,
    );
    if (settled === TIMED_OUT) throw new ApiNetworkError();
    response = settled;
  } catch (thrown) {
    const reason = exchangeFailureReason(thrown);
    // معرّفُ الطلبِ من الخطأِ نفسِه إن حمله (ردٌّ وصل)، وإلّا فآخِرُ ما رآه
    // المُراقِبُ — و«لم يصل ردٌّ» لا معرّفَ له فيبقى `null`.
    if (thrown instanceof ApiError && thrown.requestId !== null) {
      lastRequestId = thrown.requestId;
    }
    record("failed", reason);
    return { established: false, reason, thrown };
  }

  return await adopt(response);

  /** إقامةُ جلسةٍ من ردِّ مبادلةٍ — مُقدَّمةً كانت أو عاديّة. */
  async function adopt(response: ExchangeResponse): Promise<BootResult> {
    setSession({ accessToken: response.accessToken, expiresAt: response.expiresAtMs });
    // ردٌّ بلا رمزِ تجديدٍ ردٌّ صحيحٌ في العقد: الجلسةُ تعيش في الذاكرةِ حتى
    // تنتهي، ولا يُختلَق رمزٌ ولا يُعَدُّ ذلك فشلاً. وحفظُ الرمزِ الجديدِ يستبدلُ القديم.
    if (typeof response.refreshToken === "string" && response.refreshToken.length > 0) {
      await (deps.persist ?? persistRefreshToken)(response.refreshToken);
    }
    record("exchanged", null);
    return { established: true, via: "exchanged" };
  }
}

/** فئاتُ رموزِ الحالة: بروتوكولٌ لا سياسة. */
const UNAUTHORIZED_STATUS = 401;
const STATUS_CLASS_DIVISOR = 100;
const CLIENT_ERROR_CLASS = 4;

function exchangeFailureReason(thrown: unknown): BootFailureReason {
  if (thrown instanceof ApiNetworkError) return "UNAVAILABLE";
  if (thrown instanceof ApiError) {
    if (thrown.status === UNAUTHORIZED_STATUS) return "REJECTED";
    // `400 INIT_DATA_MALFORMED` وأخواتُه: بيانُ الفتحِ نفسُه لا يصلح، وإعادةُ
    // المحاولةِ بالبيانِ ذاتِه لن تنجح. فيُقال «أعد فتحَ التطبيقِ من البوت».
    if (Math.floor(thrown.status / STATUS_CLASS_DIVISOR) === CLIENT_ERROR_CLASS) {
      return "MISSING_INIT_DATA";
    }
    return "UNAVAILABLE";
  }
  return "UNAVAILABLE";
}
