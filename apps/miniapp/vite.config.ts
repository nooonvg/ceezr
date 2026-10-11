import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { arabicPartitions } from "./vite/arabic-partitions.ts";
import { assertAssetReferences } from "./vite/assert-asset-references.ts";
import { assertDictionaryPartitions } from "./vite/assert-dictionary-partitions.ts";
import { assertInitialDictionaries } from "./vite/assert-initial-dictionaries.ts";
import { assertPrebootPlacement } from "./vite/assert-preboot-placement.ts";
import {
  assertRiderFirstSurface,
  isDeferredRiderModule,
  RIDER_DESTINATION,
  RIDER_HISTORY,
  RIDER_QUOTE,
  RIDER_RIDE,
  RIDER_SHARED_VIEWS,
} from "./vite/assert-rider-first-surface.ts";
import { injectCsp } from "./vite/inject-csp.ts";
import { inlineEntryScript } from "./vite/inline-entry-script.ts";
import { inlineStylesheet } from "./vite/inline-stylesheet.ts";
import { warmRiderHome } from "./vite/warm-rider-home.ts";

/**
 * F1-01 — static-asset build for Telegram Mini App (and browser fallback later).
 * Served as immutable assets from CDN; no SSR (ROADMAP §9.2).
 * Single origin only — no third-party executable origins (TG-005 / ADR 0028).
 *
 * D-23 — جامعُ Rolldown عبر `vite@8` و`@vitejs/plugin-react@6`:
 * حلَّ `codeSplitting.groups` محلَّ `manualChunks` القديمِ، وحزمةُ `rolldown-runtime`
 * القسريّةِ (٢٢٠ بايت) تُولِّدُ طلبَ `modulepreload` سابعاً لا يُستطاعُ إزالتُه.
 * الإصلاحُ: إدماجُ حزمةِ المدخلِ في المستندِ (الأصلُ: طلبٌ شبكيٌّ → الآنَ: `<script
 * type="module">` مُدمَجٌ ببصمةٍ في `script-src`)، فيسقطُ طلبٌ ويعودُ العددُ إلى ٦.
 * والدليلُ في `docs/evidence/toolchain/D-23-20260919.md`.
 */
export default defineConfig({
  /**
   * `F1-10`: `injectCsp` **بعدَ** `inlineStylesheet` و`inlineEntryScript` في هذا
   * المصفوفِ ولا يُقلَب: بصمةُ كتلةِ الأنماطِ والسكربتِ المُدمَجَين تُقرَأ من
   * المستندِ بعدَ دمجِهما فيه. ولو سبقهما لبَصَّم لا شيءَ، ومرَّ البناءُ أخضرَ
   * وظهر التطبيقُ بلا أنماطٍ ولا تنفيذٍ على الجهازِ (ADR 0045).
   */
  plugins: [
    react(),
    inlineStylesheet(),
    inlineEntryScript(),
    // `F1-09` · `D-27`: بعدَ إدماجِ المدخلِ — يُسقِطُ البناءَ إن طُوِيَ التقديمُ فيه.
    assertPrebootPlacement(),
    // `F1-09` · `D-29`: يُسقِطُ البناءَ إن عادَ قاموسٌ غيرُ افتراضيٍّ إلى الحِملِ الأوّلِ.
    assertInitialDictionaries(),
    // `F1-09` · `D-30`: يُسقِطُ البناءَ إن عادَت حزمُ 9.4 المؤجَّلةُ إلى حِملِ سطحِ الراكبِ الأوّلِ.
    assertRiderFirstSurface(),
    // `F1-09` · `D-31`: اسمُ `rider-home` في السكربتِ الساكنِ **قبلَ** بصمةِ `injectCsp` (`ADR 0187`).
    warmRiderHome(),
    injectCsp(),
    // `F1-09` · `D-30`: بعدَ اكتمالِ المُخرَجِ — لا مرجعَ إلى أصلٍ محذوفٍ (كالأنماطِ المُدمَجةِ).
    assertAssetReferences(),
    // `F1-09` · `D-33` (`ADR 0188`): القاموسُ العربيُّ مقسومٌ بحسبِ مستورِدِه، والحاجزُ يُسقِطُ مفتاحاً بلا جزئِه.
    arabicPartitions(resolve(import.meta.dirname, "../../packages/shared/i18n/miniapp/ar.json")),
    assertDictionaryPartitions(),
  ],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      /**
       * `PRD-009` · `ADR 0258`: مكتبةُ العرضِ Preact عبرَ `preact/compat` — الشيفرةُ تبقى بواجهةِ React
       * (`import … from "react"`) والأنواعُ `@types/react`؛ الإحلالُ في البناءِ هنا وفي `bun test`
       * (`bunfig.toml` ← `apps/miniapp/test/preact-alias.ts`). التراجعُ: حذفُ هذه الأسطرِ الخمسة.
       */
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-runtime",
      "react-dom/client": "preact/compat/client",
      "react-dom": "preact/compat",
      react: "preact/compat",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // PRD-005 · ADR 0250: لا خرائطَ مصدرٍ في الأصلِ العامّ. لا مستهلِكَ لها في المستودع
    // (لا خدمةَ أخطاءٍ ترفعُها)، وخدمتُها علنًا تكشفُ الشيفرةَ الأصليّةَ بتعليقاتِها بلا فائدة.
    // العودةُ: `true` (أو `"hidden"` مع رافعٍ إلى خدمةِ أخطاءٍ) بقرارٍ يحدّثُ الـADR.
    sourcemap: false,
    target: "es2022",
    rolldownOptions: {
      output: {
        /**
         * D-23 / F1-09 — تقسيمُ الكودِ بحسبِ حزمِ القسم 9.4 عبر `codeSplitting.groups`.
         * حلَّ محلَّ `manualChunks` القديمِ في `vite@6` — كان `manualChunks` يُنتِجُ
         * حزمةً واحدةً كبيرةً (٢٧٦ كيلوبايت) في `vite@8` لأنّ `vite@8` لا يرى إدخالَ
         * `manualChunks` في `transformIndexHtml` فيُلحقُ الكلَّ بالمدخلِ.
         */
        codeSplitting: {
          groups: [
            {
              /**
               * مكتبةُ العرضِ (ADR 0044) — Preact منذ `ADR 0258`، والاسمُ باقٍ لأنّه مفتاحُ سجلِّ الميزانية.
               * أوّلًا في القائمة: المجموعاتُ تسحبُ تبعيّاتِها، ولو تأخّرَت لابتلعَتها `shell`.
               */
              name: "vendor-react",
              test: /[\\/]node_modules[\\/]preact[\\/]/,
            },
            {
              /**
               * `shell` قبلَ `identity` في الترتيبِ: `session.ts` و`session-storage.ts`
               * من `shell` لا من `identity` (ADR 0044). ولو سبقَ `identity` لالتقطَهما
               * ودارت دائرةٌ بين الحزمتَين.
               *
               * `test` دالّةٌ لا مصفوفةٌ: Rolldown في هذه النسخةِ لا يقبلُ مصفوفةً
               * في `test`، فنجمعُ الأنماطَ بدالّةٍ واحدةٍ.
               */
              name: "shell",
              test: (id: string) =>
                /\/src\/identity\/session/.test(id) ||
                /\/src\/api\//.test(id) ||
                /\/src\/shell\//.test(id) ||
                /\/src\/routing\//.test(id) ||
                // `D-30`: وحداتُ `styles/` البرمجيّةُ فقط لا `global.css`. الأنماطُ تبقى لحزمةِ المدخلِ المُدمَجةِ في
                // المستندِ؛ ولو صارَت «أنماطَ `shell`» لأدرجَها Vite في تبعيّاتِ كلِّ `import()` من حزمةٍ غيرِ `shell`،
                // وهيَ مُدمَجةٌ ومحذوفةٌ من المُخرَجِ، فيُطلَبُ ملفٌّ غيرُ موجودٍ ويسقطُ تحميلُ الشاشةِ (CI `36070289143`).
                /\/src\/styles\/[^/]*\.ts$/.test(id) ||
                /\/src\/system\//.test(id) ||
                /\/src\/telemetry\//.test(id) ||
                /\/src\/tg\//.test(id),
            },
            {
              name: "identity",
              test: /\/src\/identity\//,
            },
            /**
             * `F1-09` · `D-30`: `rider-home` **قبلَ** حزمِ القسمِ 9.4 المؤجَّلةِ، ونمطُه يستثنيها. والترتيبُ مقصودٌ:
             * المجموعةُ تضمُّ تبعيّاتِ وحداتِها بالتعدّي، فلو سبقَتها `rider-ride` لسحبَت معَها ما تشاركُه السطحُ الأوّلُ
             * (الاستغاثةُ ومساعداتُ العرضِ) فصارَ `rider-home` يستوردُ `rider-ride` ثابتاً وعادَت القناةُ إلى المسارِ الحرجِ.
             */
            {
              name: "rider-home",
              test: (id: string) =>
                /\/src\/surfaces\/rider\//.test(id) && !isDeferredRiderModule(id),
            },
            /** ADR 0251: مساعدا عرضٍ نقيّانِ تتشاركُهما حزمٌ مؤجَّلةٌ وحدَها — قبلَ `rider-quote` كي لا تسحبَهما
             * المجموعةُ بالتعدّي فيستوردَ الحسابُ والسائقُ حزمةَ التسعيرِ كلَّها. */
            {
              name: "rider-views",
              test: RIDER_SHARED_VIEWS,
            },
            /** ADR 0251 · `D-41`: الوجهةُ حزمةٌ مؤجَّلةٌ قبلَ `rider-quote` — التسعيرُ يستوردُها، فلو سبقَها لسحبَها. */
            {
              name: "rider-destination",
              test: RIDER_DESTINATION,
            },
            /** ADR 0251: التسعيرُ حزمةٌ مستقلّةٌ تُجلَبُ بعدَ رسمِ السطحِ الأوّل. */
            {
              name: "rider-quote",
              test: RIDER_QUOTE,
            },
            /** `rider-ride`: البحثُ والرحلةُ النشطةُ والملخّصُ والمشاركةُ وقناتُها الحيّةُ ومكتباتُها. */
            {
              name: "rider-ride",
              test: RIDER_RIDE,
            },
            /** `D-32` · `rider-history`: السجلُّ وتفاصيلُه والإشعاراتُ — بطلبِ الراكبِ. */
            {
              name: "rider-history",
              test: RIDER_HISTORY,
            },
            {
              name: "support",
              /** والأسئلةُ الشائعةُ معَ الدعمِ: تستوردُ قاموسَ `support` نفسَه (`LOC-TRUST-01`). */
              test: /\/src\/surfaces\/(?:rider\/)?support\/|\/src\/surfaces\/rider\/faq\//,
            },
            {
              name: "account",
              /** ولوحاتُ [B] للراكبِ (`rider/settings/` · ADR 0238) هنا: إعداداتُ الحساب، مؤجَّلةٌ لا في `rider-home`. */
              /** والخصوصيّةُ معَ الحساب: لا تُفتَحُ إلّا منه (`LOC-TRUST-01`). */
              test: /\/src\/surfaces\/(?:rider\/)?account\/|\/src\/surfaces\/rider\/(?:settings|privacy)\//,
            },
            {
              name: "driver",
              test: /\/src\/surfaces\/driver\//,
            },
            {
              name: "admin",
              test: /\/src\/surfaces\/admin\//,
            },
            /** `ADR 0213`: سطحُ التسجيلِ — لا يُنزَّلُ لمسجَّلٍ أبداً. */
            {
              name: "onboarding",
              test: /\/src\/surfaces\/onboarding\//,
            },
          ],
        },
      },
    },
    /**
     * `F1-09`: الميزانيةُ صارت بوّابةً تُسقِط البناءَ في
     * `scripts/check-performance-budget.ts` — وهذا التحذيرُ يبقى إشارةً مبكّرةً
     * للمطوّرِ في طرفيّتهِ، لا حاجزاً. والحاجزُ يقرأ البايتاتَ بعدَ الضغطِ لا قبلَه.
     */
    chunkSizeWarningLimit: 180,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
