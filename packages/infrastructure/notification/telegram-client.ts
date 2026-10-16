/**
 * الغرض: **الموضعُ الوحيدُ** الذي تُبنى فيه واجهةُ تلغرام (`grammy.Api`)، بمهلةٍ
 *   مُقرَّرةٍ وقاطعِ دائرةٍ وحدِّ تزامنٍ مشتركٍ (`CAP-006` · `F8-04`).
 * الحالة: منفّذ فعلياً — المرحلة `F8-04`.
 * ينتمي إلى: infrastructure/notification
 * يُتوقع أن يستخدمه: كلُّ من كانَ يكتبُ `new Api(token)` — سبعةُ مواضعَ في
 *   البوابةِ والعمّالِ والإدارةِ والمُرسِلاتِ، ويُنفَذُ ذلكَ بحاجزِ
 *   `scripts/check-dependency-resilience.ts`.
 * ملاحظات مستقبلية: نشرُ حالةِ القاطعِ مقياساً موضعُه `F8-02`.
 *
 * **ولماذا موضعٌ واحدٌ؟** لأنَّ حدَّ التزامنِ لا يعني شيئاً إن كانَ لكلِّ واجهةٍ
 * حدُّها: سبعُ واجهاتٍ بسبعِ حدودٍ سعتُها سبعةُ أمثالِ المُعلَنِ. والحاجزُ ههنا
 * **مشتركٌ للعمليّةِ كلِّها** لا لكلِّ واجهةٍ.
 */

import { Api } from "grammy";
import {
  createDependencyGuard,
  DEPENDENCY_BUDGETS,
  type DependencyGuard,
} from "../../shared/resilience/dependency-guard.ts";

/**
 * المهلةُ بالثواني كما تطلبُها grammY. **والعيبُ الذي أُغلِقَ ههنا**: grammY
 * افتراضُها `timeoutSeconds: 500` — ثمانِ دقائقَ وعشرونَ ثانيةً. وكانَت السبعةُ
 * مواضعَ كلُّها تبنيها بلا خيارٍ فترثُ الخمسَمئةَ.
 *
 * **وأثرُ ذلكَ كانَ مُضاعَفاً لا مفرَداً**: `withOutboundResilience` يقطعُ انتظارَه
 * عندَ عشرِ ثوانٍ **ويُهمِلُ النداءَ المتأخّرَ ولا يُلغيه** ثمَّ يُعيدُ المحاولةَ —
 * حتّى خمسِ محاولاتٍ للرسالةِ الحرجةِ. فرسالةٌ واحدةٌ في بطءِ تلغرام كانت تُبقي
 * خمسةَ مقابسَ حيّةً تُعمِّرُ كلَّ واحدٍ منها ثمانيَ دقائقَ، ولا حدَّ تزامنٍ يمنعُ
 * أن يتكرَّرَ ذلكَ بعددِ الرسائلِ.
 */
const TELEGRAM_TIMEOUT_SECONDS = Math.ceil(DEPENDENCY_BUDGETS.telegram.timeoutMs / 1000);

/**
 * سببُ رَدِّ الحاجزِ، صنفاً مُسمّىً. **ولا يُتنكَّرُ في صورةِ خطأِ تلغرام**: من
 * أعطاه `error_code: 429` لِيَرتَدَّ إليه المُرسِلُ بتراجعِه، جعلَ لوحةَ الرصدِ
 * تنسبُ إلى تلغرام ضيقاً هوَ عندَنا. وهوَ يقعُ افتراضاً في `transient` عندَ
 * `classify` في `rate-aware-telegram-sender.ts` — وذاكَ صحيحٌ: الردُّ عابرٌ.
 */
export class TelegramGuardRejection extends Error {
  readonly reason: "open" | "saturated" | "timeout";
  readonly retryAfterMs: number | null;
  constructor(reason: "open" | "saturated" | "timeout", retryAfterMs: number | null) {
    super(`تلغرام: رُدَّ النداءُ قبلَ إرسالِه (${reason})`);
    this.name = "TelegramGuardRejection";
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * الحاجزُ المشتركُ للعمليّةِ. **مُهيَّأٌ عندَ أوّلِ طلبٍ لا عندَ تحميلِ الوحدةِ**:
 * وحدةٌ تُنشئُ حالةً عندَ استيرادِها تُنشئُها في كلِّ اختبارٍ يستوردُها ولو لم
 * يستعملْها.
 */
let sharedGuard: DependencyGuard | null = null;

export function telegramGuard(): DependencyGuard {
  sharedGuard ??= createDependencyGuard({ dependency: "telegram" });
  return sharedGuard;
}

/** يُعادُ الحاجزُ المشتركُ إلى أصلِه. **للاختبارِ وحدَه** — لا يُنادى في الإنتاجِ. */
export function resetTelegramGuardForTests(): void {
  sharedGuard = null;
}

import { createGuardedFetch } from "../../shared/wasla/egress-gate.ts";
export interface TelegramApiOptions {
  /** يُحقَنُ في الاختبارِ بميزانيّةٍ مصغَّرةٍ وساعةٍ مُمرَّرةٍ. */
  readonly guard?: DependencyGuard;
  /** يُحقَنُ في الاختبارِ ليُثبَّتَ التركيبُ بلا شبكةٍ. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * يُنشئُ واجهةَ تلغرام مُحصَّنةً. **والتحصينُ في `config.use` لا في غلافٍ حولَ كلِّ
 * دالّةٍ**: المُحوِّلُ يمرُّ عليه **كلُّ** نداءٍ لأيِّ طريقةٍ من Bot API — الحاضرةِ
 * والتي تُضافُ غداً — فلا يُنسى نداءٌ. والغلافُ حولَ الدوالِّ كانَ سيُحصِّنُ
 * المعروفَ اليومَ ويترُكُ ما يُضافُ بعدَه مكشوفاً بلا أن يُخفِقَ شيءٌ.
 */
/**
 * `ADR 0286` — مُعطيُّ هويّةِ البوتِ لمرةٍ واحدةً: `getMe` مُخزَّنةً في الذكرى لا في
 * إعدادٍ يدويٍّ يتقادمُ بصمتٍ، والفشلُ `null` (أفضلُ جهدٍ لا وعدٌ) فيُرسَلُ الإرشادُ
 * بلا رابطٍ ولا تسقطُ الرسالةُ كلُّها. يعيدُ الاسمَ بلا `@`.
 */
export function botUsernameProvider(token: string): () => Promise<string | null> {
  const api = createTelegramApi(token);
  let cached: string | null | undefined;
  return async () => {
    if (cached !== undefined) return cached;
    try {
      const me = await api.getMe();
      cached =
        typeof me.username === "string" && /^[A-Za-z0-9_]{4,32}$/.test(me.username)
          ? me.username
          : null;
    } catch {
      cached = null;
    }
    return cached;
  };
}

export function createTelegramApi(token: string, options?: TelegramApiOptions): Api {
  const api = new Api(token, {
    // المهلةُ **مُصرَّحٌ بها** ولا تُترَكُ لافتراضِ المكتبةِ.
    timeoutSeconds: TELEGRAM_TIMEOUT_SECONDS,
    /**
     * البوّابةُ داخلَ ناقلِ المكتبةِ نفسِه: grammY تقبلُ `fetch`، فيُمَرَّرُ إليها
     * ناقلٌ مُحصَّنٌ دائماً لا عندَ الحقنِ وحدَه — ولو مُرِّرَ الناقلُ العامُّ عارياً
     * لصارَ سطحُ القناةِ كلُّه خارجَ البوّابةِ (`W-6` / `ADR 0086`).
     */
    fetch: createGuardedFetch("telegram-bot-api", options?.fetchImpl),
  });

  const guard = options?.guard ?? telegramGuard();

  api.config.use(async (prev, method, payload, signal) => {
    const outcome = await guard.run(async (guardSignal) => {
      // إشارتانِ تُجمَعانِ لا واحدةٌ تُهدَرُ: إشارةُ المُنادي (إن كانت) وإشارةُ
      // الميزانيةِ. ومن أسقطَ إشارةَ المُنادي عطَّلَ إلغاءً طلبَه صاحبُه.
      //
      // **والتحويلُ ضيّقٌ ومُعلَّلٌ لا تسكيتٌ للمُدقِّقِ**: grammY تُعلِنُ
      // `AbortSignal` من حشوَةِ `abort-controller` لا من الزمنِ التشغيليِّ، والفرقُ
      // في التصريحِ وحدَه: ما يفعلُه grammY بها أنّها تُمرَّرُ إلى `fetch`، و`fetch`
      // لا يقبلُ إلاّ الأصليّةَ. والبديلُ إسقاطُ الإشارةِ، وهوَ يجعلُ المهلةَ تردُّ
      // المُنتَظِرَ وتترُكُ المقبسَ حيّاً — وهوَ العيبُ المقصودُ إغلاقُه ههنا.
      const callerSignal = signal as unknown as AbortSignal | undefined;
      const merged =
        callerSignal === undefined ? guardSignal : AbortSignal.any([callerSignal, guardSignal]);
      return await prev(method, payload, merged as unknown as typeof signal);
    });
    if (!outcome.admitted) {
      throw new TelegramGuardRejection(outcome.rejection.reason, outcome.rejection.retryAfterMs);
    }
    return outcome.value;
  });

  return api;
}
