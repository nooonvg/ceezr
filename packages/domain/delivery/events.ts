/**
 * الغرض: أحداث الدومين التي تصدرها وحدة delivery — توصيل الطرود
 * الحالة: منفّذ فعلياً — المرحلة 2.2.
 * ينتمي إلى: domain/delivery
 * يُتوقع أن يستخدمه لاحقاً: packages/application/delivery/*, packages/infrastructure/delivery/*
 * ملاحظات مستقبلية: أحداث الاستلام والتسليم تُضاف هنا عند تفعيل pickup-parcel و deliver-parcel.
 */

import type { CityId, OrderId, RiderId } from "../../shared/kernel/index.ts";
import type { ParcelDescription } from "./value-objects.ts";

/** طلب توصيل أُنشئ فعلاً وصار في حالة البحث عن سائق. */
export interface DeliveryRequestedEvent {
  readonly kind: "delivery.requested";
  readonly orderId: OrderId;
  readonly cityId: CityId;
  readonly riderId: RiderId;
  /** `null` حين لم يكتبْ الراكبُ وصفًا (`WR-18`). */
  readonly parcelDescription: ParcelDescription | null;
  readonly occurredAt: Date;
}

export type DeliveryEvent = DeliveryRequestedEvent;
