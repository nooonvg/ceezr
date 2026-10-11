/**
 * الغرض: الكيانات الجذرية (Aggregates/Entities) لوحدة delivery — توصيل الطرود.
 *   لا آلة حالة جديدة هنا: طلب التوصيل طلبٌ في نفس جدول orders وبنفس آلة الحالة
 *   في domain/transport/entity.ts (كما نصّ رأس ذلك الملف صراحةً). ما يخصّ التوصيل وحده
 *   هو شروط صحّة الطلب عند إنشائه: وجهة إلزامية ووصف طرد صالح.
 * الحالة: منفّذ فعلياً — المرحلة 2.2.
 * ينتمي إلى: domain/delivery
 * يُتوقع أن يستخدمه لاحقاً: packages/application/delivery/*, packages/infrastructure/delivery/*
 * ملاحظات مستقبلية: بيانات المستلِم (اسم/جوال) تُضاف كحقول في هذا الكيان لا كأعمدة متفرّقة.
 */

import type { CityId, RiderId, ServiceType } from "../../shared/kernel/index.ts";
import { err, ok, type Result } from "../../shared/result/index.ts";
import type { Coordinates } from "../geo/value-objects.ts";
import { DeliveryDropoffRequiredError, type DeliveryRequestError } from "./errors.ts";
import { type ParcelDescription, parseParcelDescription } from "./value-objects.ts";

/** نوع الخدمة الذي تمثّله هذه الوحدة — مصدر واحد بدل تكرار السلسلة النصية. */
export const DELIVERY_SERVICE: ServiceType = "delivery";

/** ما يصل من الحوار قبل التحقّق: قد يكون ناقصاً أو غير صالح. */
export interface DeliveryRequestInput {
  readonly cityId: CityId;
  readonly riderId: RiderId;
  readonly pickup: Coordinates;
  /** null يعني أن العميل لم يرسل وجهة — مرفوض في التوصيل. */
  readonly dropoff: Coordinates | null;
  readonly parcelDescription: string;
}

/** طلب توصيل مُتحقَّق منه: كل حقوله صالحة، ووجهته مؤكَّدة غير فارغة. */
export interface DeliveryRequest {
  readonly cityId: CityId;
  readonly riderId: RiderId;
  readonly service: ServiceType;
  readonly pickup: Coordinates;
  readonly dropoff: Coordinates;
  /** `WR-18` — قرارُ المالك: الوصفُ اختياريٌّ. `null` = لم يكتبْ الراكبُ وصفًا، والطلبُ صالح. */
  readonly parcelDescription: ParcelDescription | null;
}

/**
 * البوّابة الوحيدة لإنشاء طلب توصيل صالح.
 * ترتيب الفحص مقصود: الوجهة أولاً لأنها شرط بنيوي، ثم الوصف لأنه مُدخَل نصّي.
 */
export function makeDeliveryRequest(
  input: DeliveryRequestInput,
): Result<DeliveryRequest, DeliveryRequestError> {
  if (input.dropoff === null) return err(new DeliveryDropoffRequiredError());

  // `WR-18`: الفراغُ ليسَ خطأً بل «لا وصف»؛ وما كُتِبَ يُحاكَمُ بعقدِه كما كان.
  let parcelDescription: ParcelDescription | null = null;
  if (input.parcelDescription.trim() !== "") {
    const parcel = parseParcelDescription(input.parcelDescription);
    if (!parcel.ok) return parcel;
    parcelDescription = parcel.value;
  }

  return ok({
    cityId: input.cityId,
    riderId: input.riderId,
    service: DELIVERY_SERVICE,
    pickup: input.pickup,
    dropoff: input.dropoff,
    parcelDescription,
  });
}
