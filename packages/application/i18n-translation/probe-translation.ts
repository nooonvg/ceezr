/**
 * الغرض: `WR-04` (ADR 0279) — فحصُ اتّصالٍ واحدٍ بمزوّدِ الترجمةِ عندَ إقلاعِ البوّابة، من بيئةِ
 *   التشغيلِ نفسِها. النصُّ ثابتٌ عامٌّ لا صلةَ له بمستخدم («Good morning»، إنجليزيّة ⇒ عربيّة)،
 *   والسجلُّ يحملُ المآلَ والزمنَ وهل البريدُ مضبوط — نعم أو لا، لا قيمتُه — ولا نصَّ الترجمة.
 * الحالة: منفّذ فعلياً — 2026-10-13.
 * ينتمي إلى: application/i18n-translation
 * يُستخدم من: apps/gateway/src/index.ts
 */

import type { TranslationProvider } from "./translate-message.ts";

export const TRANSLATION_PROBE_TEXT = "Good morning";

export interface TranslationProbeReport {
  readonly provider: string;
  readonly ok: boolean;
  /** نوعُ الفشلِ إن فشل (`timeout`، `rate_limited`…)، وإلّا null. */
  readonly kind: string | null;
  readonly ms: number;
  /** أترجمةٌ حقيقيّةٌ بحروفٍ عربيّة، لا النصُّ نفسُه معادًا؟ */
  readonly arabic: boolean;
  readonly contactEmailConfigured: boolean;
}

export async function probeTranslation(
  provider: TranslationProvider,
  options: { readonly contactEmailConfigured: boolean; readonly now?: () => number },
): Promise<TranslationProbeReport> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  let result: Awaited<ReturnType<TranslationProvider["translate"]>>;
  try {
    result = await provider.translate({
      text: TRANSLATION_PROBE_TEXT,
      pair: { from: "en", to: "ar" },
    });
  } catch {
    return {
      provider: provider.name,
      ok: false,
      kind: "threw",
      ms: now() - started,
      arabic: false,
      contactEmailConfigured: options.contactEmailConfigured,
    };
  }
  const ms = now() - started;
  const arabic = result.ok && /[\u0600-\u06FF]/u.test(result.value.text);
  return {
    provider: provider.name,
    ok: result.ok && arabic,
    kind: result.ok ? (arabic ? null : "not_translated") : result.error.kind,
    ms,
    arabic,
    contactEmailConfigured: options.contactEmailConfigured,
  };
}
