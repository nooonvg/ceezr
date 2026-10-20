/**
 * الغرض: الحلقة المفقودة الثانية في التوزيع. `broadcastOffers` كانت تُنادى مرّةً
 *   واحدةً في عمر الطلب — عند إنشائه — ولا شيء في النظام كلّه يسأل بعدها: «هذا
 *   الطلب ما زال يبحث، أفلا نعرضه ثانيةً؟». وهذه الدالّة هي من يسأل.
 *
 *   القياسُ على قاعدةٍ حقيقية قبل كتابة هذا الملف أثبت إخفاقين، كلٌّ منهما يُسقط
 *   الطلب نهائياً:
 *
 *   (١) سائقٌ موثَّقٌ متاحٌ بلا موقع، وراكبٌ يطلب فلا يجد أحداً. ثم يُرسل السائق
 *       موقعَه فيصير مؤهّلاً تماماً — والطلب الذي ينتظره يبقى `searching` بصفر
 *       عروضٍ إلى الأبد. وأُثبت أن السائق مؤهّلٌ فعلاً بأن طلباً جديداً من راكبٍ
 *       آخرَ في اللحظة التالية وصله عرضٌ فوراً. فالفرق بين طلبٍ يُخدَم وطلبٍ يموت
 *       ليس أهليّةَ سائقٍ ولا قُرباً ولا مدينةً — بل توقيتَ الطلب وحده.
 *
 *   (٢) سائقٌ يتجاهل العرض فتنتهي مهلته: يصير الطلب `searching` بـ`broadcast_round`
 *       = 1 و`max_broadcast_rounds` = 3 وصفرَ عروضٍ قائمة — ولا دورةَ ثانية أبداً.
 *       وأسوأُ من ذلك أنّه لا يُصعَّد كذلك: `findStaleSearching` تشترط «بلا أيّ
 *       عرض»، وهذا الطلب له عرضٌ منتهٍ. فلا يُبَثّ ولا يُصعَّد ولا يُلغى — يتيمٌ
 *       تماماً، والراكب قيل له «تم إشعار سائقٍ بطلبك، سيصلك ردٌّ قريباً» ثم لا شيء.
 *
 * الحالة: منفّذ ومُختبَر على قاعدةٍ حقيقية — المرحلة ١٤.
 * ينتمي إلى: packages/application/dispatch
 * يستخدمه: apps/workers/src/jobs/redispatch-searching.ts (الأرضيّة الدوريّة)،
 *   و`packages/application/bots/driver-dialog.ts` (المحاولة الفوريّة عند صيرورة
 *   السائق قابلاً للإسناد).
 * ملاحظات مستقبلية: لو صار للطلب مُصدرُ أحداثٍ (المرحلة ٢٤) أمكن استبدال المسح
 *   الدوريّ بمُشتَرِكٍ على حدث «تغيّرت مجموعة المؤهّلين» — والدالّة نفسها تبقى.
 */

import { parseCitySettings } from "../../domain/policy/entity.ts";
import type { Order } from "../../domain/transport/entity.ts";
import type { CityId, OrderId } from "../../shared/kernel/index.ts";
import { ok, type Result } from "../../shared/result/index.ts";
import type { PortFailureError } from "../ports/index.ts";
import { type BroadcastDependencies, broadcastOffers } from "./broadcast-offers.ts";

/**
 * طلبٌ مُرشَّحٌ لإعادة العرض. معرّفٌ ومدينةٌ فحسب — ولا حقلَ قرارٍ واحد.
 *
 * وهذا مقصود: القارئُ يقترح والمجالُ يحكم. فلو حمل هذا النوع «أهو مؤهّلٌ لدورةٍ
 * أخرى» لصار في النظام موضعان يُجيبان عن السؤال نفسِه — واحدٌ في SQL وآخرُ في
 * `matchOrder` — ويوم يتغيّر أحدهما يبقى الثاني، فيُبَثّ ما لا يجوز بثّه أو يُحجَب
 * ما يجب عرضه، بلا إنذار.
 */
/**
 * `LOAD-01 · P4` — مهلةُ السماحِ للجولةِ الحيّةِ قبلَ أن تنافسَ على مقعدٍ في النافذةِ العادلةِ.
 *
 * جولةٌ فُتحت للتوِّ يحتاجُ سائقوها إلى أن يروا العرضَ ويقبلوه: قيسَ ظهورُه على اللوحِ
 * p99 ≈ 2.0ث (دورةُ تحديثٍ واحدةٌ) والقبولُ p95 ≈ 0.2ث، فـ3ث تغطّيهما. قبلَها يتأخّرُ
 * الطلبُ خلفَ ما سواه (لا يُستبعَد)، وبعدَها يعودُ إلى ترتيبِ العمرِ. ليست مهلةَ العرضِ
 * (`offer_timeout_seconds`) ولا تغيّرُها: لا يُلمَسُ عقدُ العرضِ ولا انقضاؤه.
 */
export const LIVE_ROUND_ESCALATION_GRACE_SECONDS = 3;

export interface SearchingOrderRef {
  readonly orderId: OrderId;
  readonly cityId: CityId;
  /** لأجل السجلّ لا لأجل القرار: يُقرأ في التقرير ولا يُبنى عليه حكم. */
  readonly waitingSeconds: number;
  /**
   * `LOAD-01 · P4` (ب24) — لقطةُ الطلبِ كما قرأها القارئُ في رأسِ الشوطِ. الشوطُ كانَ
   * يعيدُ قراءةَ كلِّ طلبٍ فرديّاً (رحلةٌ لكلِّ طلبٍ على الاتصالِ المخصّصِ التسلسليّ)،
   * والقارئُ يقرأُ الجدولَ نفسَهُ أصلًا — فاللقطةُ مُتاحةٌ بلا كلفةٍ إضافيةٍ.
   * اختياريّةٌ: مسارُ إطلاقِ المجدولةِ يمرّرُ المعرّفاتِ وحدها فيعودُ `matchOrder`
   * إلى القراءةِ الفرديةِ كما كانَ (دفعةٌ صغيرةٌ نادرة).
   * **سلامةُ التقادم:** الكتابةَ يحرسُها `open_offer_round` ذرّيّاً: مقارنةٌ-وتبديلٌ على
   * `status = 'searching'` و`broadcast_round = N-1`، فاللقطةُ القديمةُ تُرفضُ (سباقٌ
   * يُصنّفُ `raced`) ولا تفتحُ دورةً غيرَ جائزةٍ أبدًا؛ وفحصُ الاستنفادِ بنفسِ المنطقِ.
   * وفحصُ الأهليةِ النهائيُّ للسائقِ يقعُ في `claim_ride` لحظةَ القبولِ لا هنا.
   */
  readonly order?: Order;
}

export interface SearchingOrderFinder {
  /**
   * الطلبات التي حالتُها `searching` ولا سائقَ مُسنَداً لها، الأقدمُ أوّلاً.
   *
   * ولا تُرشَّح هنا بعددِ الدورات ولا بوجود عرضٍ قائم — وذلك عن قصد. حدُّ الدورات
   * في `hasExhaustedBroadcastRounds` واستبعادُ من له عرضٌ حيّ في `driversToExclude`،
   * وكلاهما في المجال. فالاستعلام يقرأ حالةً ولا يُفتي.
   */
  findSearching(
    cityId: CityId,
    limit: number,
    /**
     * نافذة عادلة (LOAD-01 · موجة 250 المقيسة 2026-10-17): حدُّ دوراتِ البثّ
     * الأقصى **للمدينة** كما يقرؤه المجالُ من الإعدادات — يمرَّر من المستدعي لا
     * يُقرأ في SQL، فالبابُ لا يملك السياسةَ بل ينفّذ معيارَ من يملكها. بهذا:
     * الطلباتُ المستنفدةُ (الدورة ≥ الحدّ) لا تدخلُ النافذةَ إلا بفضلِ سعتِها فلا
     * تحتكرُها (عيبُ D8 القديم)، وغيرُ المستنفدةِ يُقدَّمُ بالأقدمِ أولًا (created_at) لا بالدورةِ
     * الأدنى — فالطلبُ القديمُ الذي أُهدرت دورتُه الأولى على مستلِمٍ لم يقبل
     * لا يتجوّعُ خلفَ تدفقِ الطلباتِ الجديدةِ طوالَ نافذةِ الحقن (قيس: 36 طلباً
     * ذاتَ سائقٍ مؤهّلٍ لم تُخدم في 120ث لأنّ ترتيبَ الدورةِ الأدنى قدّم كلَّ
     * جديدٍ عليها). غيابُ المعامل = السلوكُ القائمُ حرفيًا (توافقٌ خلفيّ).
     */
    opts?: { readonly maxBroadcastRounds?: number; readonly liveRoundGraceSeconds?: number },
  ): Promise<Result<readonly SearchingOrderRef[], PortFailureError>>;
}

export interface RedispatchDependencies {
  readonly finder: SearchingOrderFinder;
  /** نفسُ تبعيّات البثّ المستخدمة عند إنشاء الطلب — لا نسخةَ منطقٍ ثانية. */
  readonly broadcast: BroadcastDependencies;
  /**
   * أقصى ما يُفحَص في الشوط. حدٌّ لازمٌ لا تجميل: شوطٌ بلا حدٍّ في مدينةٍ فيها مئةُ
   * طلبٍ عالقٍ يفتح مئةَ دورةِ مطابقةٍ في نَفَسٍ واحد، فيستنزف تجمّعَ الاتصالات
   * ويُسقط بقيّة مهامّ العامل — فيصير إصلاحُ التوزيع سببَ تعطيله.
   */
  readonly limit: number;
  readonly log?: (message: string, meta: Record<string, unknown>) => void;
  /** خطّافُ قياسٍ اختياريٌّ يلفُّ معالجةَ كلِّ طلبٍ (أثرُ التشخيصِ)؛ غيابُه = نداءٌ مباشر. */
  readonly aroundOrder?: <T>(orderId: OrderId, fn: () => Promise<T>) => Promise<T>;
}

export interface RedispatchReport {
  readonly cityId: CityId;
  readonly examined: number;
  /** طلباتٌ فُتحت لها دورةُ بثٍّ جديدةٌ فعلاً وكُتبت عروضُها. */
  readonly rebroadcast: readonly OrderId[];
  /** لا مؤهّلَ بعد — الحالةُ الطبيعيّةُ الغالبة، لا إخفاق. */
  readonly stillNoDriver: readonly OrderId[];
  /** استنفدت دوراتَها: لا تُعاد أبداً، ومسارُها التصعيدُ لا البثّ. */
  readonly exhausted: readonly OrderId[];
  /** تغيّرت حالتُه بين القراءة والبثّ — سائقٌ قَبِل في تلك اللحظة. سباقٌ صحّي. */
  readonly raced: readonly OrderId[];
  readonly failed: number;
}

/**
 * لماذا لا يُعدّ انعدامُ المؤهّلين إخفاقاً؟ لأنّه الحالةُ الغالبةُ في كلّ شوط:
 * مدينةٌ فيها طلبٌ عالقٌ واحدٌ ولا سائقَ قريب تُنتج `NO_ELIGIBLE_DRIVER` كلّ عشرين
 * ثانية. وعدُّها إخفاقاً يُغرق السجلّ بإنذارٍ لا فعلَ له، فيتعلّم المشغّل تجاهلَ
 * إنذارات التوزيع كلّها — ومنها الحقيقيّة. فالتصنيفُ هنا لأجل من يقرأ لا لأجل
 * العدّ: `failed` تعني «شيءٌ معطوب» حصراً.
 */
export async function redispatchSearchingOrders(
  cityId: CityId,
  deps: RedispatchDependencies,
): Promise<Result<RedispatchReport, PortFailureError>> {
  /**
   * قراءةُ حدِّ الدوراتِ الأقصى للمدينةِ من مصدرِ المجالِ نفسِه (الإعداداتُ التي
   * يقرؤها `matchOrder` لكلِّ طلب) — قراءةٌ واحدةٌ في رأسِ الشوطِ لا لكلِّ طلبٍ.
   * تعذّرَتِ القراءةُ أو فشلَ التفسير؟ النافذةُ القائمةُ دونَ تغييرٍ (السلوكُ
   * المتحفّظُ لا فشلٌ صامتٌ يوقفُ إعادةَ العرضِ عن المدينةِ كلِّها).
   */
  let fairWindow:
    | { readonly maxBroadcastRounds: number; readonly liveRoundGraceSeconds: number }
    | undefined;
  const rawSettings = await deps.broadcast.settings.findByCity(cityId);
  if (rawSettings.ok) {
    const parsed = parseCitySettings(cityId, rawSettings.value);
    if (parsed.ok) {
      fairWindow = {
        maxBroadcastRounds: parsed.value.maxBroadcastRounds,
        liveRoundGraceSeconds: LIVE_ROUND_ESCALATION_GRACE_SECONDS,
      };
    }
  }
  const found = await deps.finder.findSearching(cityId, deps.limit, fairWindow);
  if (!found.ok) return found;

  /**
   * `LOAD-01 · P4` — **إعداداتُ المدينةِ تُقرَأُ مرّةً للشوطِ لا مرّةً لكلِّ طلبٍ.** الشوطُ
   * تسلسليٌّ على تجمُّعِ البوابةِ المشتركِ، وكلُّ رحلةٍ إلى القاعدةِ فيه تنتظرُ اتّصالاً: قيسَ
   * في موجةِ 500 (`b9-fixA2-500`) أنَّ متوسّطَ النداءِ ~9–13ms جُلُّه انتظارُ التجمُّعِ (`select 1`
   * عبرَه 28ms وعلى اتّصالٍ مخصَّصٍ 2.4ms)، والطلبُ يكلّفُ خمسَ رحلاتٍ إحداها إعادةُ قراءةِ
   * الإعداداتِ نفسِها التي قرأها الشوطُ للتوِّ. القراءةُ الأولى للشوطِ هي المصدرُ: نجاحُها
   * يُعادُ لكلِّ طلبٍ في المدينةِ نفسِها، وفشلُها لا يُخزَّنُ (يقرأُ كلُّ طلبٍ لنفسِه كما كانَ،
   * فلا يتحوّلُ عطلٌ عابرٌ إلى رفضِ شوطٍ كاملٍ). عمرُ النسخةِ عمرُ الشوطِ (ثوانٍ)، وهو أضيقُ
   * من نافذةِ أيِّ تعديلٍ إداريٍّ على الإعداداتِ؛ ومسارُ إنشاءِ الطلبِ خارجَ الشوطِ لا يتغيّر.
   */
  const passSettings = rawSettings;
  const broadcast: BroadcastDependencies = passSettings.ok
    ? {
        ...deps.broadcast,
        settings: {
          ...deps.broadcast.settings,
          findByCity: async (id) =>
            id === cityId ? passSettings : deps.broadcast.settings.findByCity(id),
        },
      }
    : deps.broadcast;

  const rebroadcast: OrderId[] = [];
  const stillNoDriver: OrderId[] = [];
  const exhausted: OrderId[] = [];
  const raced: OrderId[] = [];
  let failed = 0;

  /**
   * `broadcastOffers` هي نفسُها المستخدمةُ عند إنشاء الطلب، ولا تُمرَّر لها
   * معاملاتٌ إضافيّة. فكلُّ ما يحكم دورةَ إعادةٍ يحكم الدورةَ الأولى: نصفُ
   * القطر، والوزنان، وحجمُ الدفعة، وحدُّ الدورات، واستبعادُ من له عرضٌ حيّ.
   */
  for (const order of found.value) {
    const work = () =>
      broadcastOffers(
        { orderId: order.orderId, ...(order.order !== undefined ? { order: order.order } : {}) },
        broadcast,
      );
    const result = await (deps.aroundOrder ? deps.aroundOrder(order.orderId, work) : work());

    if (result.ok) {
      rebroadcast.push(order.orderId);
      deps.log?.("redispatch.rebroadcast", {
        orderId: order.orderId,
        cityId,
        round: result.value.round,
        offered: result.value.offered.length,
        waitingSeconds: order.waitingSeconds,
      });
      continue;
    }

    switch (result.error.code) {
      case "NO_ELIGIBLE_DRIVER":
        stillNoDriver.push(order.orderId);
        break;
      case "BROADCAST_ROUNDS_EXHAUSTED":
        exhausted.push(order.orderId);
        break;
      /**
       * الطلبُ لم يُوجَد أو لم يبقَ باحثاً: قُرئ باحثاً ثم قَبِل سائقٌ أو أُلغي قبل
       * أن نبثّ. وهذا ليس عطلاً بل هو **الغرضُ** من ألّا نقفل الصفّ: نقرأ بلا قفل
       * ونبثّ بلا قفل، ومن يفوز بالطلب تحكمه `claim_ride` في القاعدة لا نحن.
       */
      case "ORDER_NOT_SEARCHING":
      case "ORDER_NOT_FOUND":
      /**
       * ومثلُهما: دورةٌ سبقَ إليها استدعاءٌ آخرُ للطلبِ نفسِه. القاعدةُ حسمَتْ
       * فأبقَتْ دورةً واحدةً وردَّتِ الثانيةَ — وهذا هو **المطلوبُ** لا عطلٌ. ولولا
       * ذكرُها هنا لسقطَتْ في `default` فعُدَّتْ فشلاً يُنذِرُ من نجاحِ الحراسة.
       */
      case "ROUND_ALREADY_OPENED":
        raced.push(order.orderId);
        break;
      default:
        // طلبٌ واحدٌ معطوبٌ لا يُسقط بقيّةَ طلبات المدينة: يُسجَّل ويُمضى.
        failed += 1;
        deps.log?.("redispatch.failed", {
          orderId: order.orderId,
          cityId,
          code: result.error.code,
        });
        break;
    }
  }

  return ok({
    cityId,
    examined: found.value.length,
    rebroadcast,
    stillNoDriver,
    exhausted,
    raced,
    failed,
  });
}
