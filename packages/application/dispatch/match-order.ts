/**
 * الغرض: حالة الاستخدام الجوهرية — من يستقبل هذا الطلب الآن؟
 *   تجمع الإعدادات والمرشحين والعروض السابقة، ثم تسلّم القرار لمنطق الدومين، ولا تقرّر بنفسها شيئاً.
 * الحالة: منفّذ فعلياً — المرحلة 2.1 (القسم 3.3).
 * ينتمي إلى: application/dispatch
 * يُتوقع أن يستخدمه لاحقاً: apps/workers (دورة البثّ)، apps/gateway
 * ملاحظات مستقبلية: البثّ الفعلي إلى تلغرام والكتابة في order_offers خطوة تالية تحتاج مفاتيح،
 *   ولذلك تعيد هذه الدالة الدفعة المقرَّرة ولا ترسل شيئاً.
 */

import {
  type CandidateEvaluation,
  evaluateCandidates,
  type ScoredCandidate,
  selectBroadcastBatch,
} from "../../domain/dispatch/entity.ts";
import { driversToExclude } from "../../domain/dispatch/value-objects.ts";
import {
  type CitySettings,
  parseCitySettings,
  type SettingsError,
  toMatchingParameters,
} from "../../domain/policy/entity.ts";
import { hasExhaustedBroadcastRounds, type Order } from "../../domain/transport/entity.ts";
import type { CityId, Clock, OrderId } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type {
  DriverCandidateRepository,
  OfferRepository,
  OrderRepository,
  PortFailureError,
  SettingsRepository,
} from "../ports/index.ts";

export class OrderNotFoundError {
  readonly code = "ORDER_NOT_FOUND" as const;
  constructor(readonly orderId: OrderId) {}
}

export class OrderNotSearchingError {
  readonly code = "ORDER_NOT_SEARCHING" as const;
  constructor(
    readonly orderId: OrderId,
    readonly status: Order["status"],
  ) {}
}

export class BroadcastRoundsExhaustedError {
  readonly code = "BROADCAST_ROUNDS_EXHAUSTED" as const;
  constructor(
    readonly orderId: OrderId,
    readonly maxRounds: number,
  ) {}
}

export class NoEligibleDriverError {
  readonly code = "NO_ELIGIBLE_DRIVER" as const;
  constructor(
    readonly orderId: OrderId,
    readonly evaluation: CandidateEvaluation,
  ) {}
}

/**
 * سبقَ إلى الدورةِ غيرُنا. لا يُشتقُّ من «لم يعُد يبحثُ» لأنَّ الطلبَ ما يزالُ
 * باحثاً فعلاً: فتحُ الدورةِ لا يُغيّرُ حالَ الطلبِ، فالحالةُ وحدَها لا تُميّزُ
 * السابقَ من المسبوقِ — رقمُ الدورةِ هو الذي يُميّزُ. وخلطُ الاثنَينِ في رمزٍ
 * واحدٍ كان سيَجعلُ سجلَّ التشغيلِ يكذبُ على من يقرؤه.
 */
export class RoundAlreadyOpenedError {
  readonly code = "ROUND_ALREADY_OPENED" as const;
  constructor(
    readonly orderId: OrderId,
    readonly round: number,
  ) {}
}

export type MatchOrderError =
  | OrderNotFoundError
  | OrderNotSearchingError
  | RoundAlreadyOpenedError
  | BroadcastRoundsExhaustedError
  | NoEligibleDriverError
  | SettingsError
  | PortFailureError;

export interface MatchOrderDependencies {
  readonly orders: OrderRepository;
  readonly offers: OfferRepository;
  readonly candidates: DriverCandidateRepository;
  readonly settings: SettingsRepository;
  readonly clock: Clock;
}

export interface MatchOrderResult {
  readonly orderId: OrderId;
  readonly cityId: CityId;
  /** الدورة التي ستُبثّ الآن (دورة الطلب الحالية + 1). */
  readonly round: number;
  readonly batch: readonly ScoredCandidate[];
  readonly evaluation: CandidateEvaluation;
  readonly offerTimeoutSeconds: number;
  readonly settings: CitySettings;
}

/**
 * تعيد الدفعة التي يجب بثّها، أو سبباً واضحاً لعدم البثّ.
 * لا تكتب في القاعدة ولا ترسل رسالة — القرار فقط، ليبقى قابلاً للاختبار بلا أي مفتاح.
 */
export async function matchOrder(
  input: { readonly orderId: OrderId; readonly order?: Order },
  deps: MatchOrderDependencies,
): Promise<Result<MatchOrderResult, MatchOrderError>> {
  /**
   * `LOAD-01 · P4` (ب24) — لقطةٌ اختياريّةٌ من المستدعي (شوطُ إعادةِ البثّ يقرأُ
   * الطلباتِ في رأسِهِ أصلًا). غيابُها = القراءةُ الفرديةُ كما كانت حرفيًا، فلا يتغيّرُ
   * مسارُ الإنشاءِ ولا البوتاتِ ولا العاملُ الدوريّ.
   *
   * سلامةُ اللقطةِ: كلُّ قرارِ كتابةٍ يمرُّ عبرَ `open_offer_round` وهو مقارنةٌ-وتبديلٌ
   * ذرّيّةٌ على `status = 'searching'` و`broadcast_round = N-1` — فاللقطةُ المتقادمةُ
   * تُرفضُ هناك (وتُصنّفُ سباقًا) ولا تفتحُ دورةً غيرَ جائزةٍ؛ والاستنفادُ كذلك: رقمُ
   * الجولةِ في اللقطةِ إن كانَ أقدمَ من الواقعِ فالحراسةُ تُسقطُ الكتابةَ. وأهليةُ
   * السائقِ النهائيّةُ تُفحصُ في `claim_ride` لحظةَ القبولِ لا هنا.
   */
  const orderResult =
    input.order !== undefined ? ok(input.order) : await deps.orders.findById(input.orderId);
  if (!orderResult.ok) return orderResult;
  const order = orderResult.value;
  if (order === null) return err(new OrderNotFoundError(input.orderId));

  if (order.status !== "searching") {
    return err(new OrderNotSearchingError(order.id, order.status));
  }

  const rawSettings = await deps.settings.findByCity(order.cityId);
  if (!rawSettings.ok) return rawSettings;

  const parsed = parseCitySettings(order.cityId, rawSettings.value);
  if (!parsed.ok) return parsed;
  const settings = parsed.value;

  if (hasExhaustedBroadcastRounds(order, settings.maxBroadcastRounds)) {
    return err(new BroadcastRoundsExhaustedError(order.id, settings.maxBroadcastRounds));
  }

  const offersResult = await deps.offers.findByOrder(order.id);
  if (!offersResult.ok) return offersResult;

  const now = deps.clock.now();
  const excludedDriverIds = driversToExclude(offersResult.value, settings.offerTimeoutSeconds, now);

  const matchingParameters = toMatchingParameters(settings);

  /**
   * CAP-003 — المسار السريع. استعلام PostGIS واحد يُرجعُ المرشّحين القريبين المؤهَّلين
   * بالبوابات الصلبة، مرتّبين بالمسافة ومحدودين بـ`matchingCandidateLimit`. الخدمةُ
   * والاشتراكُ والاستبعادُ هذه الدورة يُتركانِ للدومين فوق هذه النافذة — فالاستبعادُ
   * قرارٌ تشغيليٌّ يُرى في `rejected` بسببه المُسمّى `EXCLUDED_THIS_ROUND`.
   */
  const nearbyResult = await deps.candidates.findNearbyAvailableForDispatch({
    cityId: order.cityId,
    pickup: order.pickup,
    searchRadiusKm: settings.searchRadiusKm,
    driverLocationMaxAgeSeconds: settings.driverLocationMaxAgeSeconds,
    limit: settings.matchingCandidateLimit,
    now,
  });
  if (!nearbyResult.ok) return nearbyResult;

  const orderContext = {
    cityId: order.cityId,
    service: order.service,
    pickup: order.pickup,
    excludedDriverIds,
  };

  const nearbyEvaluation = evaluateCandidates(
    nearbyResult.value,
    orderContext,
    matchingParameters,
    now,
  );

  if (nearbyEvaluation.eligible.length > 0) {
    const batch = selectBroadcastBatch(nearbyEvaluation, matchingParameters);
    return ok({
      orderId: order.id,
      cityId: order.cityId,
      round: order.broadcastRound + 1,
      batch,
      evaluation: nearbyEvaluation,
      offerTimeoutSeconds: settings.offerTimeoutSeconds,
      settings,
    });
  }

  /**
   * لا مؤهَّلَ في النافذة القريبة. مسارٌ تشخيصيٌّ: نُحمّلُ كلَّ سائقي المدينة كي نبنيَ
   * قائمةَ الرفضِ المُسبَّبة كاملةً — فالسائقُ بلا موقع لا يدخلُ المسار السريع
   * (`ST_DWithin` على NULL يُستبعدُ)، وإنّما يظهرُ هنا بسببه `NO_LOCATION`.
   * وهذا أيضًا حارسُ صحّةٍ: لو فاتَ المسارَ السريعَ مؤهَّلٌ أبعدُ (خارجَ حدِّ النافذة)
   * يجده هذا الاستعلام فيظهرُ في `eligible` لا في `rejected`.
   *
   * لا يُستدعى هذا في التشغيل الطبيعي — فقط حين تُفرغُ النافذةُ القريبة.
   */
  const allResult = await deps.candidates.findAvailableInCity(order.cityId);
  if (!allResult.ok) return allResult;

  const fullEvaluation = evaluateCandidates(allResult.value, orderContext, matchingParameters, now);

  if (fullEvaluation.eligible.length > 0) {
    const batch = selectBroadcastBatch(fullEvaluation, matchingParameters);
    return ok({
      orderId: order.id,
      cityId: order.cityId,
      round: order.broadcastRound + 1,
      batch,
      evaluation: fullEvaluation,
      offerTimeoutSeconds: settings.offerTimeoutSeconds,
      settings,
    });
  }

  return err(new NoEligibleDriverError(order.id, fullEvaluation));
}
