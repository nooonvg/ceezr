/**
 * الغرض: سياسةُ تخزينِ الجلسةِ على الجهازِ (`F1-04`) — **رمزُ التجديدِ في
 *   `SecureStorage` وحدَه، ورمزُ الوصولِ في الذاكرةِ وحدَها**. وهذا الملفُّ هو
 *   موضعُ السياسةِ الوحيد؛ أمّا `tg/storage.ts` فمُغلِّفٌ بلا سياسة (`F1-02`).
 * الحالة: منفّذ فعلياً — البند `F1-04`.
 * ينتمي إلى: apps/miniapp/src/identity
 * يُتوقع أن يستخدمه لاحقاً: `renew.ts` و`session.ts` وشاشاتُ الدخولِ في `F1-05`.
 * ملاحظات مستقبلية: لا يُضاف مفتاحٌ ثانٍ ههنا بلا بندٍ صريح، ولا يُخزَّن رمزُ
 *   وصولٍ ولا معرّفُ مستخدمٍ ولا دورٌ على الجهاز.
 *
 * قواعدُ صارمةٌ يفرضها `scripts/check-session-storage-policy.ts` على البناء:
 *   ــ **لا `CloudStorage`**: مزامَنةُ تيليجرامَ تنقل القيمةَ بين الأجهزة، والقسم
 *      4.4 يقصر `CloudStorage` على تفضيلاتٍ غيرِ حسّاسة. ورمزُ الجلسةِ «للجهازِ فقط».
 *   ــ **لا `DeviceStorage`**: تخزينٌ على الجهازِ غيرُ مُعَمًّى بالمنصّة.
 *   ــ **لا `localStorage` ولا `sessionStorage` ولا كوكيز**: ولا تراجعَ إليها عندَ
 *      غيابِ `SecureStorage` — التراجعُ إلى تخزينٍ أضعفَ يُبطِل السياسةَ ويُبقي
 *      اسمَها. وعندَ الغيابِ تبقى الجلسةُ **في الذاكرةِ وحدَها** وتُغلَق بإغلاقِ
 *      التطبيق: نقصٌ في الراحةِ لا في الأمان.
 *   ــ **لا كتابةَ رمزٍ في مسارٍ ولا في `query` ولا في سجلٍّ ولا في قياسات**.
 */

import type { TgOutcome, TgSecureRead, TgUnavailableReason } from "../tg/index.ts";
import { secureStorageGet, secureStorageRemove, secureStorageSet } from "../tg/index.ts";

/**
 * مفتاحٌ واحدٌ لا أكثر. واسمُه لا يقول «token» صريحاً في مخزنٍ قد يُعرَض في
 * أدواتِ تشخيصٍ، وإن كان هذا حجاباً بالاسمِ لا حمايةً — الحمايةُ من المنصّةِ نفسِها.
 */
export const REFRESH_TOKEN_STORAGE_KEY = "waslah.session.renewal";

/**
 * منفذُ التخزينِ الآمنِ على الجهاز — ثلاثُ عملياتٍ لا أكثر، ومحوّلُه الوحيدُ في
 * الإنتاجِ هو طبقةُ تغليفِ تيليجرام. وُجِد المنفذُ لسببَين: أنّ اختبارَ السياسةِ لا
 * يحتاج مضيفَ تيليجرامَ ليشهدَ عليها، وأنّ مضيفاً ثانياً (`DEC-07`) يُوصَل يوماً
 * بمحوّلٍ آخرَ بلا تعديلِ السياسةِ نفسِها.
 */
export interface DeviceSecureStore {
  set(key: string, value: string): Promise<TgOutcome<boolean>>;
  get(key: string): Promise<TgOutcome<TgSecureRead>>;
  remove(key: string): Promise<TgOutcome<boolean>>;
}

/**
 * مهلةُ كلِّ عمليّةٍ على `SecureStorage` (BOOT-DEADLINES). مكتبةُ تيليجرامَ
 * (سكربتُ WebApp الرسميّ) تُرسِلُ `web_app_secure_storage_*` وتنتظرُ حدثَ الردِّ
 * **بلا مهلة**، وإن لم يكن جسرٌ (`TelegramWebviewProxy` ولا إطار) سقطَ الإرسالُ
 * صامتًا فلا يُنادى المُعالِجُ أبدًا. وعميلٌ يعلنُ 9.0 ولا يجيبُ يُعلِّقُ الإقلاعَ على
 * الهيكلِ إلى الأبد. وKeychain/Keystore يجيبانِ في أجزاءٍ من الثانية، فالثلاثُ ثوانٍ
 * حدُّ «لا جواب» لا حدُّ «بطء». ولا مهلةَ على `restoreItem`: ذاك ينتظرُ المستخدم.
 */
export const SECURE_STORAGE_DEADLINE_MS = 3_000;

/** ما يُعادُ عندَ انقضاءِ المهلة: «فشلَ المضيف» بتفصيلٍ صريح، لا رفضٌ ولا قيمة. */
export const SECURE_STORAGE_TIMEOUT_DETAIL = "timeout";

type Schedule = (run: () => void, ms: number) => unknown;

function hostFailed<T>(detail: string): TgOutcome<T> {
  return { ok: false, reason: "failed", detail };
}

function bounded<T>(
  operation: () => Promise<TgOutcome<T>>,
  ms: number,
  schedule: Schedule,
): Promise<TgOutcome<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome: TgOutcome<T>): void => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    schedule(() => finish(hostFailed<T>(SECURE_STORAGE_TIMEOUT_DETAIL)), ms);
    // الجوابُ المتأخّرُ بعدَ المهلةِ يُهمَل هنا. والكتابةُ المتأخّرةُ تقعُ على الجهازِ
    // كما طُلِبَت (أحدثُ رمزٍ)، فلا تُفسِدُ جلسة؛ والقراءةُ المتأخّرةُ لا تُقيمُ شيئًا.
    operation().then(finish, (thrown: unknown) => finish(hostFailed<T>(String(thrown))));
  });
}

/**
 * يُغلِّفُ مخزنًا بمهلةٍ على `set` و`get` و`remove`. انقضاؤها = `failed`/`timeout`،
 * فيمضي كلُّ منادٍ في فرعِ «لا تخزين» الذي يملكُه أصلًا: القراءةُ ⇐ لا رمز، والحفظُ ⇐
 * الجلسةُ في الذاكرةِ وحدَها، والمسحُ ⇐ لم يُمسَح. لا تراجعَ إلى تخزينٍ أضعف.
 */
export function boundedSecureStore(
  store: DeviceSecureStore,
  ms: number = SECURE_STORAGE_DEADLINE_MS,
  schedule: Schedule = (run, delay) => setTimeout(run, delay),
): DeviceSecureStore {
  return {
    set: (key, value) => bounded(() => store.set(key, value), ms, schedule),
    get: (key) => bounded(() => store.get(key), ms, schedule),
    remove: (key) => bounded(() => store.remove(key), ms, schedule),
  };
}

/** المحوّلُ الوحيدُ في الإنتاج: `SecureStorage` من طبقةِ تيليجرامَ، بلا بديل، وبمهلة. */
export const telegramSecureStore: DeviceSecureStore = boundedSecureStore({
  set: (key, value) => secureStorageSet(key, value),
  get: (key) => secureStorageGet(key),
  remove: (key) => secureStorageRemove(key),
});

/**
 * نتيجةُ محاولةِ الحفظ. `stored: false` **ليست خطأً**: هي الحالةُ العاديةُ على
 * عميلٍ أقدمَ من Bot API 9.0 أو خارجَ تيليجرامَ أصلاً، ويجب أن يفرّعَ عليها
 * النداءُ بلا تراجعٍ إلى تخزينٍ أضعف.
 */
export type RefreshTokenStoreResult =
  | { readonly stored: true }
  | { readonly stored: false; readonly reason: TgUnavailableReason };

/** يحفظ رمزَ التجديدِ في التخزينِ الآمنِ وحدَه. لا تسجيلَ ولا تراجعَ. */
export async function persistRefreshToken(
  token: string,
  store: DeviceSecureStore = telegramSecureStore,
): Promise<RefreshTokenStoreResult> {
  const outcome = await store.set(REFRESH_TOKEN_STORAGE_KEY, token);
  return outcome.ok ? { stored: true } : { stored: false, reason: outcome.reason };
}

/**
 * يقرأ رمزَ التجديدِ إن وُجد. `null` تعني «لا رمزَ صالحَ الاستعمالِ الآن» —
 * سواءٌ غاب المخزنُ أو غاب المفتاحُ: كلاهما يقود العميلَ إلى المسارِ نفسِه
 * (تحقّقٌ جديدٌ من تيليجرام)، فلا فائدةَ في تفريقهما ههنا.
 */
export async function loadRefreshToken(
  store: DeviceSecureStore = telegramSecureStore,
): Promise<string | null> {
  const outcome = await store.get(REFRESH_TOKEN_STORAGE_KEY);
  if (!outcome.ok) return null;
  const value = outcome.value.value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * يمسح رمزَ التجديدِ من الجهاز. **حدٌّ معلَن**: هذا مسحٌ محليٌّ لا إبطالٌ —
 * الخادمُ بلا حالةٍ (قرارُ `F1-04`)، فرمزٌ خرج من الجهازِ قبلَ المسحِ يبقى صالحاً
 * حتى انتهائِه أو حتى سقفِ الجلسةِ المطلق. ولا يُدَّعى غيرُ ذلك.
 */
export async function forgetRefreshToken(
  store: DeviceSecureStore = telegramSecureStore,
): Promise<RefreshTokenStoreResult> {
  const outcome = await store.remove(REFRESH_TOKEN_STORAGE_KEY);
  return outcome.ok ? { stored: true } : { stored: false, reason: outcome.reason };
}
