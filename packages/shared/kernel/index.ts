/**
 * الغرض: أنواع النواة المشتركة بين كل الوحدات (المعرّفات، المدينة، الطابع الزمني، أنواع الخدمة).
 * الحالة: أساس تقني منفّذ فعلياً (أنواع فقط + دوال مساعدة بلا قرار تجاري).
 * ينتمي إلى: shared/kernel
 * يُتوقع أن يستخدمه لاحقاً: كل الوحدات في domain/application/infrastructure
 * ملاحظات مستقبلية: أي قيمة تجارية (سعر، مهلة، وزن) ممنوع وضعها هنا — مكانها platform_settings.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type UserId = Brand<string, "UserId">;
export type DriverId = Brand<string, "DriverId">;
export type RiderId = Brand<string, "RiderId">;
export type OrderId = Brand<string, "OrderId">;
/** معرّف عرضٍ واحدٍ في `order_offers` — المفتاحُ الذي يحصرُ القرارَ بعرضٍ بعينِه (BUG-003). */
export type OfferId = Brand<string, "OfferId">;
export type CityId = Brand<string, "CityId">;
export type TenantId = Brand<string, "TenantId">;

/** كل كيان مخزَّن يحمل city_id إلزامياً (القاعدة 0.4). */
export interface CityScoped {
  readonly cityId: CityId;
}

export interface Timestamped {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type ServiceType = "transport" | "delivery";

export type SubscriptionPlan = "transport" | "delivery" | "both";

export type LanguageCode = string;

export interface Paginated<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface IdGenerator {
  generate(): string;
}

export const uuidGenerator: IdGenerator = {
  generate: () => crypto.randomUUID(),
};
