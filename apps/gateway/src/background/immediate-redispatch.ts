/**
 * الغرض: جدولةُ إعادةِ العرضِ الفوريّةِ للطلباتِ الباحثةِ عندَ صيرورةِ سائقٍ
 *    قابلاً للإسنادِ — **خارجَ مسارِ الطلبِ لا داخلَهُ**. هذا هو إغلاقُ علّةِ
 *    `LOAD-01` (الدفعةُ الرابعةُ) على وجهِها العمليِّ: مسارُ `POST
 *    /v1/driver/location` كانَ ينتظرُ إعادةَ عرضِ المدينةِ كلِّها قبلَ أن يردَّ،
 *    فصارَ أولُ موقعٍ لكلِّ سائقٍ (وحدهُ الذي يُشعلُ إعادةَ العرضِ) يعلَّقُ
 *    بالثواني (قيسَ: وسيطُ الكتابةِ 10.4ث وأقصاها 17.9ث تحتَ 50 متزامنًا)،
 *    حتى تنتهي مهلةُ العميلِ (15ث) ويموتَ السيناريو ويولدَ طلبٌ عالقٌ يزيدِ
 *    الحملَ — حلقةٌ تدهورٍ عبرَ الجولاتِ (0% ← 8% ← 25% فشلًا).
 *
 *    والحلُّ منَ الجذرِ لا منَ العرضِ: الاستجابةُ تردُّ بعدَ الكتابةِ والبثِّ
 *    (الخطواتُ ١-٤ من `F4-01`) بلا انتظارِ إعادةِ العرضِ، وإعادةُ العرضِ
 *    تُجدوَلُ هنا **مخفوضةً للمدينةِ** بمانعِ تداخلٍ — والأرضيّةُ الدوريّةُ في
 *    العاملِ (كلَّ 20ث) تُدركُ ما فاتَ، وهوَ الضمانُ المعلَنُ سلفًا في تعليقِ
 *    الحاويةِ: «الإخفاقُ يُبتلَعُ عن قصدٍ... والأرضيّةُ الدوريّةُ تُدركُ ما
 *    فات بعد ثوانٍ».
 * الحالة: منفّذ فعلياً — `LOAD-01` · الدفعةُ الرابعةُ (2026-10-17).
 * ينتمي إلى: apps/gateway/src/background
 * يستخدمه: apps/gateway/src/container.ts (منفذُ `redispatch` لحالةِ استخدامِ
 *    استقبالِ الموقعِ).
 *
 * ## لماذا خفضٌ ومانعُ تداخلٍ لا مؤقّتٌ عارٍ
 *
 * خمسونَ سائقًا يصيرونَ أحياءً في ثوانٍ (موجةُ قبولٍ) تعني خمسينَ محفّزًا
 * متزامنًا؛ وشوطُ إعادةِ العرضِ يقرأُ طلباتِ المدينةِ الباحثةَ ويطابقُها —
 * فلو جُدوِلَ كلُّ محفّزٍ شوطًا لتزاحمتِ الأشواطُ على تجمُّعِ اتصالاتِ الطلبِ
 * نفسِهِ (5) فعادَ الحجبُ منَ البابِ الخلفيِّ. فالخفضُ للمدينةِ يجعلُ الشوطَ
 * واحدًا عن كلِّ نافذةٍ (قيمةً افتراضيّةً ثانيتينِ)، ومانعُ التداخلِ يمنعُ
 * شوطًا فوقَ شوطٍ جارٍ («مُسكِتًا» لا «مُراكمًا» — مبدأُ درينرِ تيليجرامِ
 * نفسِهِ في هذا المجلدِ)، والدوريّةُ تبقى أرضًا صلبةً لا تعتمدُ على هذا
 * المسارِ أصلًا.
 *
 * ## ما لا يفعله هذا الملفُّ عن قصدٍ
 *
 * - **لا يغيّرُ قرارَ المطابقةِ ولا حدَّها**: يُشغَّلُ بالمنفذِ نفسِهِ
 *   (`redispatchSearchingOrders` بحدِّها القائمِ) — الجدولةُ فقط تغيّرتْ.
 * - **لا يضمنُ تنفيذًا فوريًّا ولا يعدُ به**: هوَ تسريعٌ أفضلُ جهدٍ، والأرضيّةُ
 *   الدوريّةُ هيَ الضمانةُ. ولهذا لا يُفشلُ الطلبَ متى تخطّاهُ الخفضُ.
 * - **خفضُهُ لكلِّ عمليةٍ لا لكلِّ مدينةٍ عالميًّا**: في تعدُّدِ النسخِ قد
 *   يجدوِلُ كلُّ نسخةٍ شوطَها؛ الأشواطُ نفسُها آمنةٌ (قراءةٌ وبثٌّ بمنطقٍ
 *   قائمٍ)، والدوريّةُ تُغطّي الفرقَ.
 */

import type { CityId } from "../../../../packages/shared/kernel/index.ts";

/** نافذةُ الخفضِ لكلِّ مدينةٍ — قياسُ `LOAD-01`: كافيةٌ لجمعِ دفعةِ سائقينَ. */
export const IMMEDIATE_REDISPATCH_DEBOUNCE_MS = 2_000;

export interface ImmediateRedispatchSchedulerDeps {
  /**
   * الشوطُ الفعليُّ لإعادةِ عرضِ مدينةٍ — نفسُ منفذِ الدوريّةِ بحدِّهِ القائمِ.
   * `saturated=true` = امتلأَ الحدُّ وتقدّمَ (بقيَ مستحقٌّ على الأرجحِ) ⇒ شوطٌ لاحقٌ واحدٌ.
   */
  readonly run: (cityId: CityId) => Promise<{ readonly saturated: boolean } | undefined>;
  /** نافذةُ الخفضِ بالملّي ثانيةِ. */
  readonly debounceMs: number;
  /** ساعةٌ قابلةٌ للحقنِ — للاختبارِ لا لإنتاجٍ. */
  readonly now: () => number;
  /** جدولةٌ قابلةٌ للحقنِ (`setTimeout(fn, 0)` في الإنتاجِ) — تُخرجُ الشوطَ عن دورِ الطلبِ. */
  readonly schedule: (fn: () => void) => void;
  /**
   * `LOAD-01 · P4` — خطّافُ تشخيصٍ اختياريّ (أثرُ الشوطِ): يسجّلُ قرارَ الجدولةِ
   * (قُبِلَ أو دُمِجَ) لحظةَ حدوثِه فيربطُ لحظةَ قبولِ المحفّزِ ببدءِ الشوطِ الذي
   * غذّاه. غيابُه = لا أثرٍ ولا كلفة. لا يُستعملُ للقرارِ — الجدولةُ نفسُها لا تقرأُه.
   */
  readonly onTrigger?: (cityId: CityId, outcome: "accepted" | "coalesced") => void;
  /** تسجيلٌ — الخفضُ والتخطّي يُعلنانِ لا يُخفيانِ. */
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /** مؤقّتُ الشوطِ اللاحقِ (`setTimeout` غيرُ ممسِكٍ للعمليةِ افتراضيًّا) — قابلٌ للحقنِ. */
  readonly scheduleAfter?: (ms: number, fn: () => void) => void;
}

export interface ImmediateRedispatchScheduler {
  /**
   * المحفّزُ — يعودُ فورًا بلا انتظارِ الشوطِ؛ هذا هوَ عقدُ عدمِ الحجبِ.
   * السائقُ قد أرسلَ موقعَهُ ونجحتْ كتابتُهُ: لا شيءَ في إعادةِ العرضِ يستحقُّ
   * تعليقَ ردِّهِ.
   */
  readonly trigger: (cityId: CityId) => void;
}

export function createImmediateRedispatchScheduler(
  deps: ImmediateRedispatchSchedulerDeps,
): ImmediateRedispatchScheduler {
  /** آخرُ محفّزٍ قُبِلَ لكلِّ مدينةٍ — خفضٌ لا ذاكرةٌ للطلبِ. */
  const lastAcceptedAtMs = new Map<CityId, number>();
  /** المدنُ التي شوطُها جارٍ — مانعُ التداخلِ: مُسكِتًا لا مُراكمًا. */
  const running = new Set<CityId>();
  /**
   * التكليفُ السابعُ (P4) — **الحافةُ اللاحقةُ:** محفّزٌ أُسكِتَ (خفضٌ أو شوطٌ جارٍ) كانَ
   * يُترَكُ للدوريّةِ (20ث)؛ فطلبٌ أُنشئَ بعدَ آخرِ شوطٍ ينتظرُ حتى 20ث لأوّلِ عرضٍ،
   * وبعدَ توقّفِ تحديثاتِ المواقعِ صارَ الدوريُّ (50 كلَّ 20ث) وحدَه يُصرِّفُ — قيسَ في
   * `diag-r11-join-250` انتظارٌ لأوّلِ جولةٍ بلغَ 82ث. الآنَ: علَمٌ واحدٌ لكلِّ مدينةٍ
   * (لا عدّادٌ — مُسكِتٌ لا مُراكِمٌ): أيُّ عددٍ من المحفّزاتِ المُسكَتةِ = شوطٌ لاحقٌ
   * **واحدٌ** بعدَ النافذةِ أو بعدَ الجاري. والشوطُ المُمتلئُ الحدِّ يطلبُ لاحقًا واحدًا.
   */
  const pending = new Set<CityId>();
  const trailingArmed = new Set<CityId>();
  const scheduleAfter =
    deps.scheduleAfter ??
    ((ms: number, fn: () => void) => {
      const timer = setTimeout(fn, ms) as unknown as { unref?: () => void };
      timer.unref?.();
    });

  const armTrailing = (cityId: CityId, delayMs: number): void => {
    if (trailingArmed.has(cityId)) return;
    trailingArmed.add(cityId);
    scheduleAfter(Math.max(0, delayMs), () => {
      trailingArmed.delete(cityId);
      if (pending.has(cityId) && !running.has(cityId)) {
        pending.delete(cityId);
        trigger(cityId);
      }
    });
  };

  const trigger = (cityId: CityId): void => {
    const now = deps.now();
    const last = lastAcceptedAtMs.get(cityId);
    if (last !== undefined && now - last < deps.debounceMs) {
      // تخطّي الخفضِ يُعلَنُ، ويُسلِّحُ شوطًا لاحقًا واحدًا عندَ انقضاءِ النافذةِ.
      deps.onTrigger?.(cityId, "coalesced");
      deps.log?.("redispatch.immediate_debounced", { cityId });
      pending.add(cityId);
      if (!running.has(cityId)) armTrailing(cityId, deps.debounceMs - (now - last));
      return;
    }
    if (running.has(cityId)) {
      // شوطٌ جارٍ: لا شوطًا فوقَهُ — ويُطلَبُ لاحقٌ واحدٌ بعدَ اكتمالِه.
      deps.onTrigger?.(cityId, "coalesced");
      deps.log?.("redispatch.immediate_in_flight", { cityId });
      pending.add(cityId);
      return;
    }
    deps.onTrigger?.(cityId, "accepted");
    lastAcceptedAtMs.set(cityId, now);
    deps.schedule(() => {
      running.add(cityId);
      void deps
        .run(cityId)
        .then((report) => {
          if (report?.saturated === true) pending.add(cityId);
        })
        .catch((cause: unknown) => {
          // فشلُ الشوطِ الخلفيِّ يُسجَّلُ ولا يُرمى ولا يُصمتُ — والحاويةُ
          // تُسجّلُ فشلَهُ باسمِ الحدثِ نفسِهِ الذي كانَ يُسجّلُهُ قبلَ الجدولةِ.
          deps.log?.("redispatch.immediate_failed", {
            cityId,
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        })
        .finally(() => {
          running.delete(cityId);
          if (pending.has(cityId)) {
            const since = deps.now() - (lastAcceptedAtMs.get(cityId) ?? 0);
            armTrailing(cityId, deps.debounceMs - since);
          }
        });
    });
  };

  return { trigger };
}
