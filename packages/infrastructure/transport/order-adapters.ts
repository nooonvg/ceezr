/**
 * الغرض: قراءة الطلب وكتابته فعلاً: إنشاء طلب بموقع جغرافي حقيقي، وإلغاؤه من العميل نفسه فقط.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة 2.1.
 * ينتمي إلى: infrastructure/transport
 * يُتوقع أن يستخدمه لاحقاً: بوت العميل، عامل انتهاء المهل، لوحة الإدارة (2.4)
 * ملاحظات مستقبلية: الانتقالات (بدء/إنهاء الرحلة) تُضاف بدوال RPC لا بتحديث مباشر.
 */

import type {
  ActiveOrderSummary,
  CreateOrderInput,
  OrderWriter,
  PastOrderSummary,
} from "../../application/bots/types.ts";
import type { OrderRepository } from "../../application/ports/index.ts";
import type { Order, OrderStatus } from "../../domain/transport/entity.ts";
import type { CityId, DriverId, OrderId, RiderId, ServiceType } from "../../shared/kernel/index.ts";
import { guard, type Sql } from "../db/client.ts";

/**
 * `LOAD-01 · P4` (ب24) — يُصدَّرُ ليُعيدَ قارئُ الطلباتِ الباحثةِ استخدامَهُ لا نسخةً
 * ثانيةً من منطقِ التحويلِ: مصدرٌ واحدٌ لمعنىِ صفِّ الطلبِ.
 */
export interface OrderRow {
  readonly id: string;
  readonly city_id: string;
  readonly service: string;
  readonly status: string;
  readonly pickup_lat: number;
  readonly pickup_lng: number;
  readonly dropoff_lat: number | null;
  readonly dropoff_lng: number | null;
  readonly assigned_driver_id: string | null;
  readonly broadcast_round: number;
}

export function toOrder(row: OrderRow): Order {
  return {
    id: row.id as OrderId,
    cityId: row.city_id as CityId,
    service: row.service as ServiceType,
    status: row.status as OrderStatus,
    pickup: { latitude: Number(row.pickup_lat), longitude: Number(row.pickup_lng) },
    dropoff:
      row.dropoff_lat === null || row.dropoff_lng === null
        ? null
        : { latitude: Number(row.dropoff_lat), longitude: Number(row.dropoff_lng) },
    assignedDriverId: row.assigned_driver_id as DriverId | null,
    broadcastRound: row.broadcast_round,
  };
}

const ORDER_SELECT = `
  select id, city_id, service, status,
         st_y(pickup::geometry) as pickup_lat, st_x(pickup::geometry) as pickup_lng,
         st_y(dropoff::geometry) as dropoff_lat, st_x(dropoff::geometry) as dropoff_lng,
         assigned_driver_id, broadcast_round
    from orders
`;

export function createOrderRepository(sql: Sql): OrderRepository {
  return {
    findById: (orderId: OrderId) =>
      guard("orders.findById", async () => {
        const rows = await sql.unsafe<OrderRow[]>(`${ORDER_SELECT} where id = $1`, [orderId]);
        const row = rows[0];
        return row === undefined ? null : toOrder(row);
      }),
  };
}

export function createOrderWriter(sql: Sql): OrderWriter {
  return {
    create: (input: CreateOrderInput) =>
      guard("orders.create", async () => {
        const rows = await sql<{ id: string }[]>`
          insert into orders (city_id, rider_id, service, status, pickup, dropoff, notes)
          values (
            ${input.cityId}, ${input.riderId}, ${input.service}::service_type, 'searching',
            st_setsrid(st_makepoint(${input.pickup.longitude}, ${input.pickup.latitude}), 4326)::geography,
            ${
              input.dropoff === null
                ? sql`null`
                : sql`st_setsrid(st_makepoint(${input.dropoff.longitude}, ${input.dropoff.latitude}), 4326)::geography`
            },
            ${input.notes ?? null}
          )
          returning id
        `;
        const id = rows[0]?.id;
        if (id === undefined) throw new Error("تعذّر إنشاء الطلب");
        return id as OrderId;
      }),

    /**
     * الإلغاء يمرّ عبر الدالّة الذرّية cancel_order_by_rider — لا تحديث مباشر هنا.
     * الدالّة تُلغي العروض المعلّقة وتُغلق التفاوض وتكتب في السجل تحت قفل واحد،
     * وتُودِعُ إخطارَ كلِّ سائقٍ يعنيه الأمرُ في صندوقِ الصادرِ في المعاملةِ نفسِها
     * (BUG-004) فيُسلِّمُه العاملُ بعدَ الـcommit بإعادةٍ محكومةٍ. ولذلك لا تُقرأُ هنا
     * قائمةُ من يجبُ إخطارُهم: مَن يُخطَرُ صارَ صفوفًا في الجدولِ لا حلقةً في الطبقةِ.
     */
    cancelByRider: (orderId: OrderId, riderId: RiderId) =>
      guard("orders.cancelByRider", async () => {
        const rows = await sql<{ cancel_order_by_rider: CancelRpcResult }[]>`
          select cancel_order_by_rider(${orderId}::uuid, ${riderId}::uuid, 'rider_cancelled')
        `;
        const result = rows[0]?.cancel_order_by_rider;
        if (result === undefined || !result.ok) {
          return result?.error === "ORDER_NOT_CANCELLABLE"
            ? ({ kind: "not_cancellable" } as const)
            : ({ kind: "not_found" } as const);
        }
        return {
          kind: "cancelled",
          orderId: result.order_id as OrderId,
          service: result.service as ServiceType,
          previousStatus: result.previous_status,
          groupMessageIds: result.group_cards
            .filter((card) => card.group_message_id !== null)
            .map((card) => String(card.group_message_id)),
        } as const;
      }),
  };
}

type CancelRpcResult =
  | {
      readonly ok: true;
      readonly order_id: string;
      readonly service: string;
      readonly previous_status: string;
      readonly group_cards: readonly { readonly group_message_id: string | null }[];
      readonly error?: undefined;
    }
  | { readonly ok: false; readonly error: string };

/**
 * كل الطلبات النشطة للعميل — لا الأحدث وحده.
 *
 * كانت هذه الدالّة تُعيد طلباً واحداً بـ limit 1، فإذا كان للعميل مشوار وطرد
 * معاً ألغى /cancel الأحدث وسكت عن الآخر. وقع هذا فعلاً في الإنتاج: عميل ألغى
 * ما ظنّه مشواره، فأُلغي طرده، وبقي المشوار يبحث عن سائق خمس ساعات وهو يحسبه
 * منتهياً. الحدّ الأعلى يحمي الرسالة من الطول بلا أن يُخفي طلباً في الأحوال
 * الواقعية.
 */
const MAX_ACTIVE_ORDERS = 10;

/**
 * نقطةٌ من زوج أعمدة، أو `null` إن غاب أحدهما — المرحلة ١١.
 *
 * والشرط على الاثنين لا على أحدهما: `ST_X` و`ST_Y` لموضعٍ معدوم تعودان
 * `null` معاً، وفحصُ واحدٍ منهما يجعل `0` درجةً تُقرأ إحداثيّةً في خليج غينيا.
 */
function pointOf(
  lat: number | null,
  lng: number | null,
): { readonly lat: number; readonly lng: number } | null {
  return lat === null || lng === null ? null : { lat, lng };
}

export function createActiveOrdersLookup(sql: Sql) {
  return async (riderId: RiderId): Promise<readonly ActiveOrderSummary[]> => {
    const rows = await sql<
      {
        id: string;
        service: string;
        status: string;
        pickup_label: string | null;
        dropoff_label: string | null;
        created_at: Date;
        pickup_at: Date | null;
        dispatch_at: Date | null;
        searching_since: Date | null;
        driver_name: string | null;
        vehicle_type: string | null;
        plate_number: string | null;
        vehicle_photo_file_id: string | null;
        pickup_lat: number | null;
        pickup_lng: number | null;
        dropoff_lat: number | null;
        dropoff_lng: number | null;
        driver_lat: number | null;
        driver_lng: number | null;
        driver_location_recorded_at: Date | null;
      }[]
    >`
      select o.id, o.service, o.status, o.pickup_label, o.dropoff_label, o.created_at,
             o.pickup_at, o.dispatch_at, o.searching_since,
             du.full_name as driver_name, d.vehicle_type, d.plate_number,
             d.vehicle_photo_file_id,
             -- المرحلة ١١: الإحداثيّات تُقرأ في **نفس** الاستعلام لا في ثانٍ،
             -- لنفس السبب المكتوب في assignedDriver: قراءتان تريان لحظتين،
             -- فتُحسب مسافةٌ من موقع سائقٍ إلى مقصد طلبٍ لم يعد له.
             --
             -- والإسقاط إلى geometry قبل ST_X/ST_Y لازمٌ لا تجميلٌ: الدالتان
             -- غير مُعرّفتين لـgeography، والإسقاط بلا تحويلٍ لأن كليهما 4326.
             -- ولا تُحسب المسافة بـST_Distance هنا مع أنه أدقّ: المنصّة تقيس
             -- المسافات بـhaversineKm في المجال (الإسناد نفسه يقيس به)،
             -- ورقمان مختلفان لنفس المسافة يعنيان عميلاً يرى «٣ كم» ومشغّلاً
             -- يرى «٢.٩ كم» للحادثة نفسها — وهو مصدرٌ ثانٍ للحقيقة ممنوع.
             ST_Y(o.pickup::geometry) as pickup_lat,
             ST_X(o.pickup::geometry) as pickup_lng,
             ST_Y(o.dropoff::geometry) as dropoff_lat,
             ST_X(o.dropoff::geometry) as dropoff_lng,
             ST_Y(d.last_location::geometry) as driver_lat,
             ST_X(d.last_location::geometry) as driver_lng,
             d.last_location_recorded_at as driver_location_recorded_at
        from orders o
        -- الربط اليساري مقصود: طلب في searching لا سائق له، وربطٌ داخلي
        -- كان سيُخفي من قائمة الطلبات النشطة كلّ ما يزال يبحث — وهي أكثر
        -- الحالات التي يُسأل فيها «أين طلبي؟».
        left join drivers d on d.id = o.assigned_driver_id
        left join users du on du.id = d.user_id
       where o.rider_id = ${riderId}
         and o.status in ('scheduled', 'searching', 'matched', 'in_progress')
       order by o.created_at asc
       limit ${MAX_ACTIVE_ORDERS}
    `;
    return rows.map((row) => ({
      orderId: row.id as OrderId,
      service: row.service as ServiceType,
      status: row.status,
      pickupLabel: row.pickup_label,
      dropoffLabel: row.dropoff_label,
      createdAt: new Date(row.created_at),
      pickupAt: row.pickup_at === null ? null : new Date(row.pickup_at),
      dispatchAt: row.dispatch_at === null ? null : new Date(row.dispatch_at),
      searchingSince: row.searching_since === null ? null : new Date(row.searching_since),
      pickup: pointOf(row.pickup_lat, row.pickup_lng),
      dropoff: pointOf(row.dropoff_lat, row.dropoff_lng),
      // الاسم هو شرط وجود السائق: صفّ سائق بلا مستخدم حالة تلف لا تُعرض
      assignedDriver:
        row.driver_name === null
          ? null
          : {
              fullName: row.driver_name,
              vehicleType: row.vehicle_type,
              plateNumber: row.plate_number,
              vehiclePhotoFileId: row.vehicle_photo_file_id,
              /**
               * المرحلة ١١ — والوقت شرطٌ في الموقع لا حقلٌ زائد: موضعٌ بلا
               * `recorded_at` لا يُعرف أمن دقيقةٍ هو أم من أمس، وعرضه بلا زمنه
               * يقول للعميل ما لم يقع. فموقعٌ بلا وقتٍ يُعامل معاملة المعدوم.
               *
               * ويُقرأ `last_location_recorded_at` (زمن جهاز السائق) لا
               * `last_location_at` (زمن وصول الإصلاحة إلينا): المرحلة ٣ قرّرت
               * أن وقت الجهاز هو حين **كان السائق هناك فعلاً**، ووقتُ وصولِ
               * رسالةٍ تأخّرت في الشبكة يجعل موقعاً قديماً يبدو طازجاً.
               */
              lastLocation:
                row.driver_lat === null ||
                row.driver_lng === null ||
                row.driver_location_recorded_at === null
                  ? null
                  : {
                      lat: row.driver_lat,
                      lng: row.driver_lng,
                      recordedAt: new Date(row.driver_location_recorded_at),
                    },
            },
    }));
  };
}

/**
 * سجلّ الطلبات المنتهية للعميل — البند 5.
 *
 * الحدّ عشرة لا «كلّها»: رسالة تلغرام الواحدة محدودة بـ4096 محرفاً، وسجلٌّ بلا حدّ
 * يصل يوماً إلى رسالة يرفض تلغرام إرسالها، فيرى العميل عدم استجابة لا سجلّاً.
 * وعشرةٌ هي ما يُتذكَّر فعلاً؛ ومن أراد أقدم منها فسؤاله عن نزاعٍ بعينه، ومكانه الدعم.
 * وهو رقم عرضٍ تقنيّ لا قيمةٌ تجارية: لا يقرّر ثمناً ولا مهلةً ولا استحقاقاً.
 */
const MAX_PAST_ORDERS = 10;

export function createPastOrdersLookup(sql: Sql) {
  return async (riderId: RiderId): Promise<readonly PastOrderSummary[]> => {
    const rows = await sql<
      {
        id: string;
        service: string;
        status: string;
        pickup_label: string | null;
        dropoff_label: string | null;
        created_at: Date;
        ended_at: Date | null;
        driver_name: string | null;
        rating_stars: number | null;
      }[]
    >`
      select o.id, o.service, o.status, o.pickup_label, o.dropoff_label, o.created_at,
             -- المكتمل له completed_at، والملغى لا شيء له إلّا لحظة تغيّر صفّه؛
             -- وعمود updated_at أصدق ما يُتاح لها، فهي لحظة كتابة الإلغاء نفسها.
             coalesce(o.completed_at, o.updated_at) as ended_at,
             du.full_name as driver_name,
             -- تقييم العميل لهذا الطلب وحده: الاتجاه شرطٌ لا زينة، فبلا شرطه
             -- قد يُعرض للعميل تقييمُ السائقِ له كأنّه تقييمه هو.
             (select r.stars from ratings r
               where r.order_id = o.id and r.direction = 'rider_to_driver'
               limit 1) as rating_stars
        from orders o
        left join drivers d on d.id = o.assigned_driver_id
        left join users du on du.id = d.user_id
       where o.rider_id = ${riderId}
         -- النهايات الثلاث كلّها: من أُلغي طلبه أو فشل يسأل عنه كما يسأل عن المكتمل،
         -- وإخفاؤها يجعل السجلّ يبدو ناقصاً فيُظنّ عطباً.
         and o.status in ('completed', 'cancelled', 'failed')
       order by coalesce(o.completed_at, o.updated_at) desc
       limit ${MAX_PAST_ORDERS}
    `;
    return rows.map((row) => ({
      orderId: row.id as OrderId,
      service: row.service as ServiceType,
      status: row.status,
      pickupLabel: row.pickup_label,
      dropoffLabel: row.dropoff_label,
      createdAt: new Date(row.created_at),
      endedAt: row.ended_at === null ? null : new Date(row.ended_at),
      driverName: row.driver_name,
      // القاعدة تُعيد smallint، وقد يعود نصّاً من المحوّل — والصفر ليس تقييماً صحيحاً
      ratingStars:
        row.rating_stars === null || Number(row.rating_stars) === 0
          ? null
          : Number(row.rating_stars),
    }));
  };
}
