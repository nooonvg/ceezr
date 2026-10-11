/**
 * الغرض: **استهلاكُ ما قدّمَه السكربتُ الساكنُ في `index.html`** (`DEC-19` ·
 *   `F1-09`) — بدأَ السكربتُ الساكنُ تبادلَ الجلسةِ وقراءةَ الدورِ والموافقاتِ
 *   **قبلَ** اكتمالِ تنزيلِ حزمِ الشيفرةِ، فتتداخلُ الطلباتُ الثلاثةُ مع التنزيلِ.
 *   وهذا الملفُّ يُ暴露ُ وعودًا للاستهلاكِ من `boot.ts` و`viewer.ts` و
 *   `consent-api.ts`، فإن وُجدتْ أُخذَتْ وإلّا مضى كلٌّ في مسارِه التقليديِّ.
 * الحالة: منفّذ فعلياً — `F1-09` (الصفوفُ 3–5 · `[~]`).
 * ينتمي إلى: apps/miniapp/src/identity (حزمة `identity` — القسم 9.4)
 *
 * **ما لا يفعله هذا الملفُّ عن قصدٍ**:
 *   ــ لا يبدأُ طلباتٍ: البدءُ في السكربتِ الساكنِ في `index.html` وحدَه. هذا
 *      الملفُّ قارئٌ لا كاتبٌ.
 *   ــ لا يلمسُ مضيفَ تيليجرامَ مباشرةً (ADR 0031 §3).
 *   ــ لا يخزّنُ رمزَ الوصولِ في مكانٍ دائم: في الذاكرةِ وحدَها.
 *   ــ لا يُسجّلُ قياسًا: القياسُ في `App.tsx` لا في الإقلاعِ.
 */

/** ردُّ مبادلةِ الجلسةِ — مطابقٌ لعقدِ `boot.ts`. */
interface ExchangeResponse {
  readonly ok: true;
  readonly accessToken: string;
  readonly expiresAtMs: number;
  readonly refreshToken?: string;
}

/** ما يضعه السكربتُ الساكنُ في `index.html` على `window.__waslahPreboot`. */
interface PrebootState {
  /** وعدُ تبادلِ الجلسةِ — يُستهلَكُ من `boot.ts`. */
  // `UI-SESS-01`: يُستهلَكُ مرّةً واحدةً ثمّ يصيرُ `null`.
  session: Promise<ExchangeResponse> | null;
  /** وعدُ قراءةِ الدورِ (ردُّ `/v1/me` الخامُ أو `null`) — يُستهلَكُ من `viewer.ts`. */
  // `UI-LOOP-01`: يُستهلَكُ مرّةً واحدةً ثمّ يصيرُ `null` — القراءةُ التاليةُ من الخادمِ.
  viewer: Promise<unknown> | null;
  /** وعدُ قراءةِ الموافقاتِ (ردُّ `/v1/consents` الخامُ أو `null`) — يُستهلَكُ من `consent-api.ts`. */
  consents: Promise<unknown> | null;
  /** رمزُ الوصولِ من التبادلِ — للتحقّقِ من أنَّ النتائجَ لنفسِ الجلسةِ. */
  accessToken: string;
}

declare global {
  interface Window {
    __waslahPreboot?: PrebootState;
  }
}

/** قراءةُ الحالةِ المُخزَّنةِ — `globalThis` لا `window` كي تعملَ في الاختبارِ. */
function readPreboot(): PrebootState | undefined {
  return (globalThis as { __waslahPreboot?: PrebootState }).__waslahPreboot;
}

/** كتابةُ الحالةِ المُخزَّنةِ. */
function writePreboot(state: PrebootState | undefined): void {
  (globalThis as { __waslahPreboot?: PrebootState | undefined }).__waslahPreboot = state;
}

/**
 * يستهلكُ وعدَ تبادلِ الجلسةِ المُقدَّمَ إن وُجد. يُعادُ `null` إن لم يُقدَّمْ
 * تبادلٌ (خارجَ تيليجرامَ مثلًا) — فيمضي `boot.ts` في مسارِه التقليديِّ.
 *
 * ADR 0259: يُستهلَكُ **قبلَ** التجديدِ من `SecureStorage` — ثمنُه مدفوعٌ قبلَ تحميلِ
 * الحزم، وهو لحسابِ `initData` الحاليِّ (فرمزٌ محفوظٌ لحسابٍ سابقٍ لا يحكم). وإن فشلَ
 * أو انتهت صلاحيتُه، مضى `boot.ts` إلى التجديدِ ثمَّ المبادلة.
 */
export function consumePrebootSession(): Promise<ExchangeResponse> | null {
  const raw = readPreboot();
  if (raw === undefined || raw.session === null) return null;
  // `UI-SESS-01`: مرّةً واحدةً كأخواتِها؛ وعدٌ مرفوضٌ يُعادُ لكلِّ «إعادةِ محاولةٍ» يجعلُ الزرَّ لا يفعلُ شيئاً.
  const session = raw.session;
  raw.session = null;
  return session;
}

/**
 * يستهلكُ وعدَ قراءةِ الدورِ المُقدَّمَ إن وُجد وكان لرمزِ الوصولِ نفسِه.
 * يُعادُ `null` إن لم يُقدَّمْ أو إن تغيّرَت الجلسةُ — فيمضي `viewer.ts` في
 * مسارِه التقليديِّ.
 *
 * @param accessToken رمزُ الوصولِ الحاليُّ — للتحقّقِ من أنَّ النتيجةَ لنفسِ الجلسةِ.
 */
export function consumePrebootViewer(accessToken: string): Promise<unknown> | null {
  const raw = readPreboot();
  if (raw === undefined || raw.accessToken !== accessToken) return null;
  // `UI-LOOP-01`: مرّةً واحدةً. كانَ يُعيدُ القراءةَ الأولى نفسَها لكلِّ نداءٍ، فبعدَ التسجيلِ
  // بقيَ الموجّهُ يرى «غيرَ مسجَّلٍ» ويرى سطحُ التسجيلِ «مسجَّلاً» فيتبادلانِ بلا نهايةٍ —
  // وهذا «الاهتزازُ» الذي يظهرُ ويختفي على الشاشةِ.
  const viewer = raw.viewer;
  raw.viewer = null;
  return viewer;
}

/**
 * يستهلكُ وعدَ قراءةِ الموافقاتِ المُقدَّمَ إن وُجد وكان لرمزِ الوصولِ نفسِه.
 * يُعادُ `null` إن لم يُقدَّمْ أو إن تغيّرَت الجلسةُ — فيمضي `consent-api.ts`
 * في مسارِه التقليديِّ.
 *
 * @param accessToken رمزُ الوصولِ الحاليُّ — للتحقّقِ من أنَّ النتيجةَ لنفسِ الجلسةِ.
 */
export function consumePrebootConsents(accessToken: string): Promise<unknown> | null {
  const raw = readPreboot();
  if (raw === undefined || raw.accessToken !== accessToken) return null;
  // `UI-LOOP-01`: مرّةً واحدةً — كالقراءةِ أعلاه، وإلّا بقيَت موافقةٌ قديمةٌ تُعرَضُ بعدَ قَبولِها.
  const consents = raw.consents;
  raw.consents = null;
  return consents;
}

/** يُمسحُ ما قدّمَه السكربتُ الساكنُ — بعدَ استهلاكِه أو عندَ الفشلِ. */
export function clearPreboot(): void {
  writePreboot(undefined);
}
