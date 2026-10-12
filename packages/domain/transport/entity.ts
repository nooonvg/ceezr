/**
 * الغرض: آلة حالات الطلب — تمنع أي انتقال غير مشروع (مثل إنهاء رحلة لم تبدأ).
 * الحالة: منفّذ فعلياً — المرحلة 2.1.
 * ينتمي إلى: domain/transport
 * يُتوقع أن يستخدمه لاحقاً: application/transport/*، apps/gateway/bots/*
 * ملاحظات مستقبلية: نفس الآلة تُعاد استخدامها لوحدة delivery في المرحلة 2.2 بلا تفريع.
 */

import type { CityId, DriverId, OrderId, ServiceType } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Coordinates } from "../geo/value-objects.ts";

export type OrderStatus =
  /** `WR-06` — موعدُ حضورٍ مستقبليٌّ لم يحِن إطلاقُه؛ لا بثَّ ولا سائق. */
  "scheduled" | "searching" | "matched" | "in_progress" | "completed" | "cancelled" | "failed";

export interface Order {
  readonly id: OrderId;
  readonly cityId: CityId;
  readonly service: ServiceType;
  readonly status: OrderStatus;
  /** نقطة الانطلاق — تقابل عمود pickup من نوع geography(Point,4326). */
  readonly pickup: Coordinates;
  readonly dropoff: Coordinates | null;
  readonly assignedDriverId: DriverId | null;
  readonly broadcastRound: number;
}

export class IllegalTransitionError {
  readonly code = "ILLEGAL_TRANSITION" as const;
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {}
}

export class MissingAssignedDriverError {
  readonly code = "MISSING_ASSIGNED_DRIVER" as const;
  constructor(readonly orderId: OrderId) {}
}

export type OrderError = IllegalTransitionError | MissingAssignedDriverError;

/** الانتقالات المشروعة الوحيدة. أي انتقال خارج هذا الجدول مرفوض. */
const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  scheduled: ["searching", "cancelled"],
  searching: ["matched", "cancelled", "failed"],
  matched: ["in_progress", "cancelled", "searching"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  failed: ["searching"],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return (ALLOWED_TRANSITIONS[status] ?? []).length === 0;
}

export function transition(order: Order, to: OrderStatus): Result<Order, OrderError> {
  if (!canTransition(order.status, to)) {
    return err(new IllegalTransitionError(order.status, to));
  }
  // لا حالة تشغيلية بلا سائق مُسنَد — نفس القيد مفروض في القاعدة أيضاً
  if (
    (to === "matched" || to === "in_progress" || to === "completed") &&
    order.assignedDriverId === null
  ) {
    return err(new MissingAssignedDriverError(order.id));
  }
  return ok({ ...order, status: to });
}

/** إعادة الطلب للبحث بعد فشل دورة بثّ: يزيد رقم الدورة ويُفرّغ السائق. */
export function returnToSearching(order: Order): Result<Order, OrderError> {
  if (!canTransition(order.status, "searching")) {
    return err(new IllegalTransitionError(order.status, "searching"));
  }
  return ok({
    ...order,
    status: "searching",
    assignedDriverId: null,
    broadcastRound: order.broadcastRound + 1,
  });
}

/** هل استُنفدت دورات البثّ؟ الحد من platform_settings.max_broadcast_rounds. */
export function hasExhaustedBroadcastRounds(order: Order, maxRounds: number): boolean {
  return roundsExhausted(order.broadcastRound, maxRounds);
}

/**
 * نفس الحكم عند رقم دورةٍ مجرّد. مفصولة لأنّ من يسأل ليس دائماً بيده `Order`
 * كامل: مسحُ الطلبات العالقة يقرأ رقم الدورة وحده من القاعدة. والبديل أن يُكتب
 * `>=` هناك أو في SQL، فيصير للسؤال موضعان ويوم يتغيّر أحدهما يبقى الثاني.
 */
export function roundsExhausted(broadcastRound: number, maxRounds: number): boolean {
  return broadcastRound >= maxRounds;
}
