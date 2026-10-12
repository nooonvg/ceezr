/**
 * الغرض: محوّلات مقاييس لمنافذ التوزيع الفعلية: فتح العروض وقبولها وانتهاؤها وغياب
 *   سائق؛ تُحقن عند تركيب الحاوية ولا تنقل أي سياسة توزيع إلى طبقة المراقبة.
 * الحالة: منفّذ فعلياً ومركَّب في حاويتي البوابة والعامل.
 * ينتمي إلى: packages/infrastructure/observability
 *   (نُقل من apps/gateway: العامل يحتاج لفَّ منفذ إسقاط العروض أيضاً، واستيراد
 *   حاويةِ العامل من داخل تطبيق البوابة يعقد اتّجاه الاعتماد بلا سبب.)
 * يُتوقع أن يستخدمه لاحقاً: apps/gateway/src/container.ts وapps/workers/src/container.ts.
 * ملاحظات مستقبلية: نتيجة RPC هي مصدر العدّ، لا رسالة Telegram التي قد تفشل بعد الكتابة.
 */

import type { OfferWriter } from "../../application/dispatch/broadcast-offers.ts";
import type { ExpireOffersRpcPort } from "../../application/dispatch/expire-offers-ports.ts";
import type { DispatchRpcPort } from "../../application/ports/index.ts";
import type { OperationalMetrics } from "./index.ts";

export function instrumentOfferWriter(
  writer: OfferWriter,
  metrics: OperationalMetrics,
): OfferWriter {
  return {
    ...writer,
    openRound: async (input) => {
      metrics.recordDispatchRequest();
      const result = await writer.openRound(input);
      /**
       * العدُّ على ما فُتحَ فعلاً لا على ما طُلِبَ: منذُ `BUG-005` تردُّ القاعدةُ
       * طلبَ فتحٍ سبقَ إليه غيرُه، وعدُّ المردودِ عروضاً مُرسَلةً يجعلُ المقياسَ يعُدُّ
       * ما لم يقعْ — ومقياسٌ يعُدُّ العدمَ أسوأُ من لا مقياس.
       */
      if (result.ok && result.value.opened) metrics.recordDispatchOffersSent(input.entries.length);
      return result;
    },
  };
}

export function instrumentDispatchRpc(
  dispatch: DispatchRpcPort,
  metrics: OperationalMetrics,
): DispatchRpcPort {
  return {
    ...dispatch,
    claimRide: async (orderId, driverId) => {
      const result = await dispatch.claimRide(orderId, driverId);
      /**
       * `BUG-008` — المكرّرُ لا يُعَدُّ: تسليمٌ ثانٍ للنقرةِ نفسِها يخرجُ
       * `claimed=true` لأنّه نجاحٌ — وعدُّه قبولاً ثانياً يُفسِدُ مقياساً
       * تجاريّاً: قبولاتٌ أكثرُ من الإسناداتِ الواقعةِ فعلاً.
       */
      // `WR-09` — حجزُ مرشَّحٍ ينتظرُ الراكبَ ليسَ إسناداً بعد، فلا يُعَدُّ قبولاً.
      if (
        result.ok &&
        result.value.claimed &&
        !result.value.duplicate &&
        result.value.pendingRider !== true
      ) {
        metrics.recordDispatchOfferAccepted();
      }
      return result;
    },
  };
}

export function instrumentExpireOffersRpc(
  rpc: ExpireOffersRpcPort,
  metrics: OperationalMetrics,
): ExpireOffersRpcPort {
  return {
    ...rpc,
    expireStaleOffers: async (cityId, offerIds) => {
      const result = await rpc.expireStaleOffers(cityId, offerIds);
      if (result.ok) metrics.recordDispatchOfferTimedOut(result.value);
      return result;
    },
  };
}

/** يُستدعى عند موضع قرار المطابقة الذي يثبت أنه لا يوجد سائق مؤهل. */
export function recordNoEligibleDriver(metrics: OperationalMetrics): void {
  metrics.recordDispatchNoDriver();
}
