/**
 * الغرض: قراءات التتبّع من المصدر القانوني: الرحلة الجارية للسائق، وبرهان ملكيّتها،
 *   وقناة العميل التي يُدفع إليها الموقع.
 * الحالة: منفّذ فعلياً ومُختبَر على قاعدة حقيقية — المرحلة ٦.
 * ينتمي إلى: infrastructure/tracking
 * يُتوقع أن يستخدمه لاحقاً: مُرحِّل الموقع إلى العميل (المرحلة ١١)، وخريطة العمليات (١٣)
 *
 * ## لماذا «البرهان» استعلامٌ خاصّ ولا يُعاد استخدام `OrderRepository`
 *
 * لأن `OrderRepository.findById` تعيد الطلب كما يفهمه المجال (موضع الانطلاق
 * والوصول والحالة والجولة)، ولا تعيد `rider_id` أصلاً — وهو **الحقل الوحيد**
 * الذي يُبنى عليه حكم «هذه رحلتك». فاستخدامها هنا كان يوجب توسيعها بحقلٍ لا
 * يحتاجه أيٌّ من مستخدميها العشرة، أو استنتاج الملكيّة من غير مصدرها.
 *
 * وهذا ليس مصدراً ثانياً للحقيقة: نفس الصفّ من `orders`، بأعمدةٍ أخرى، لسؤالٍ
 * آخر. المصدر واحد والقارئ اثنان — وذلك هو الفصل الصحيح بين نماذج القراءة.
 */

import type {
  DriverTripCardReader,
  DriverTripKey,
} from "../../application/tracking/driver-trip-card.ts";
import type {
  ActiveTripReader,
  DriverDutyAndTripReader,
  DriverDutyReader,
} from "../../application/tracking/live-tracking.ts";
import type { DriverTripStatus } from "../../domain/tracking/driver-trip-view.ts";
import type { TripAssignmentProof, WatchedTripStatus } from "../../domain/tracking/visibility.ts";
import type { Sql } from "../db/client.ts";

/** وجهة الدفع إلى العميل: من يُخاطَب، وعلى أيّ رحلة، وسائقها. */
export interface CustomerChannelTarget {
  readonly tripId: string;
  readonly riderId: string;
  readonly riderTelegramId: string;
  readonly driverId: string;
  readonly riderLanguage: string;
  /**
   * المرحلة ١١: حالة الطلب تُعاد مع الوجهة لا في قراءةٍ ثانية.
   *
   * والسبب ليس توفيرَ نداء: قراءتان منفصلتان قد تريان لحظتين، فيُفتح
   * بثٌّ لرحلةٍ قُرئت حيّةً ثم أُلغيت، أو يُرفض بثٌّ لرحلةٍ أُسندت بينهما. وهو
   * نفس التعليل المكتوب في `ActiveOrderSummary.assignedDriver`.
   *
   * ولماذا `WatchedTripStatus` لا `string`؟ لأن المُستهلِك يمرّرها إلى `isTripLive`؛
   * و`string` تجعل خطأً مطبعيّاً في حالةٍ يمرّ بلا صراخ، فيُقرأ «غير حيّ».
   */
  readonly status: WatchedTripStatus;
}

export interface TrackingProofReader {
  /** برهان ملكيّة الرحلة وإسنادها كما هو في القاعدة الآن. */
  proofOf(tripId: string): Promise<TripAssignmentProof | null>;
  /**
   * قناة عميل الرحلة. تُعاد للرحلات الحيّة وغيرها: الحكم على «الحياة» في المجال
   * (`isTripLive`) لا في `where` — فاستعلامٌ يُخفي الرحلة المنتهية يجعل الرفض
   * يبدو «رحلة غير موجودة»، وتشخيصُ ذلك في الإنتاج مستحيل.
   */
  customerOf(tripId: string): Promise<CustomerChannelTarget | null>;
}

/**
 * الرحلة الجارية للسائق. `matched` و`in_progress` وحدهما: الأولى أُسنِدت ولم
 * تبدأ (والعميل ينتظر السائق فيرى قدومه — وهي أهمّ لحظة في التتبّع كله)،
 * والثانية جارية. وما سواهما لا سائق فيه يُتابَع.
 *
 * `limit 1` بلا ترتيب مقصود: القاعدة تمنع أصلاً أن يكون لسائقٍ رحلتان حيّتان
 * (الإسناد الذرّي في `claim_ride`)، فترتيبُ صفٍّ واحد عبثٌ يُوهم بأن التعدّد
 * ممكن ومُعالَج.
 */
export function createActiveTripReader(sql: Sql): ActiveTripReader {
  return {
    activeTripOf: async (driverId) => {
      const rows = await sql<{ id: string }[]>`
        select id from orders
         where assigned_driver_id = ${driverId}::uuid
           and status in ('matched', 'in_progress')
         limit 1
      `;
      return rows[0]?.id ?? null;
    },
  };
}

/**
 * المرحلة ١٢ — أفي الخدمة؟ `driver_availability` وحده الحكم.
 *
 * ولماذا لا يُفحص التوثيق (`verification_status`) معه؟ لأن القاعدة تحسمه أصلاً:
 * تغيير حالة التوثيق إلى غير `verified` يُنزل `is_available` إلى `false` في نفس
 * المعاملة (دالة لوحة المسؤول). ففحصه هنا شرطٌ مكرّر، ومصدرٌ ثانٍ لنفس
 * الحقيقة يختلف عن الأوّل عند أوّل تعديل يمسّ أحدهما (القاعدة ٥).
 *
 * وغياب الصفّ = خارج الخدمة: سائقٌ لم يُعلن إتاحته قطّ ليس متاحاً،
 * و`coalesce` تجعل الحكم واحداً في الحالتين بلا تفريعٍ في الطبقة الأعلى.
 */
export function createDriverDutyReader(sql: Sql): DriverDutyReader {
  return {
    isOnDuty: async (driverId) => {
      const rows = await sql<{ on_duty: boolean }[]>`
        select coalesce(
                 (select a.is_available from driver_availability a
                   where a.driver_id = ${driverId}::uuid),
                 false
               ) as on_duty
      `;
      return rows[0]?.on_duty === true;
    },
  };
}

/**
 * القارئ الموحّد: بوابةُ الخدمةِ والرحلةُ النشطةُ في استعلامٍ واحدٍ ولقطةٍ واحدة.
 *
 * ## لماذا لا يُبنى على القارئينِ السابقينِ ولا يُبنيانِ عليه
 *
 * لأنّ أسئلتَهما مختلفةٌ لمن يحتاجُ أحدَها وحده — وهذا يجمعُهما لمن يحتاجهما
 * معًا في اللحظةِ نفسِها (`onFix`) فيرحلةٍ واحدةٍ على مجموعةِ الطلباتِ بدلَ
 * رحلتينِ متتاليتينِ تدفعانِ طابورَ الانتظارِ مرتينِ في كلِّ إصلاحةِ موقع.
 * والفروعُ المُرسَبةُ (`scalar subquery`) تُقرأُ الحقيقةَ نفسَها من الجدولينِ
 * نفسِهما اللذينِ يقرؤهما القارئانِ — لا مصدرَ ثالثًا ولا مفهومًا جديدًا.
 */
export function createDriverDutyAndTripReader(sql: Sql): DriverDutyAndTripReader {
  return {
    dutyAndActiveTrip: async (driverId) => {
      const rows = await sql<{ on_duty: boolean; active_trip_id: string | null }[]>`
        select coalesce(
                 (select a.is_available from driver_availability a
                   where a.driver_id = ${driverId}::uuid),
                 false
               ) as on_duty,
               (select o.id::text from orders o
                 where o.assigned_driver_id = ${driverId}::uuid
                   and o.status in ('matched', 'in_progress')
                 limit 1) as active_trip_id
      `;
      const row = rows[0];
      return {
        onDuty: row?.on_duty === true,
        activeTripId: row?.active_trip_id ?? null,
      };
    },
  };
}

/**
 * المرحلة ١٢ — بطاقة رحلة السائق من المصدر القانوني: `orders` و`drivers`.
 *
 * ## لماذا استعلامٌ واحد لا اثنان
 *
 * لأن الرحلة وموقع السائق يُقرأان ليُحسب بينهما مسافة. وقراءتهما في
 * استعلامين تعني لحطتين مختلفتين: رحلةٌ قد تكون انتهت بينهما، فتُعرض مسافةٌ
 * إلى مقصدٍ لم يبق مقصداً.
 *
 * ## ولماذا `assigned_driver_id` في الشرط لا في التحقق بعده
 *
 * لأن الشرط يمنع الصفّ من الخروج من القاعدة أصلاً، والتحقق بعده يجعل
 * بيانات رحلة غيره تمرّ في الذاكرة وتعتمد على سطرٍ واحد لا يُنسى. والفرق
 * بينهما هو الفرق بين استحالةٍ وسهو.
 */
export function createDriverTripCardReader(sql: Sql): DriverTripCardReader {
  return {
    cardOf: async (key: DriverTripKey) => {
      /**
       * المفتاحان في استعلامٍ واحد بشرطين حصريين: `driver_id` المُمرَّر أو `null`.
       * وكتابةُ استعلامين متطابقين إلا في سطر `where` كانت ستجعل تصحيح أحدهما
       * دون الآخر ممكناً — وهو بالضبط ما يُنتج «الوسم يظهر هنا ولا يظهر هناك».
       */
      const byId = "driverId" in key ? key.driverId : null;
      const byTelegram = "driverTelegramId" in key ? key.driverTelegramId : null;
      const rows = await sql<
        {
          id: string;
          status: string;
          pickup_lat: number | null;
          pickup_lng: number | null;
          pickup_label: string | null;
          dropoff_lat: number | null;
          dropoff_lng: number | null;
          dropoff_label: string | null;
          driver_lat: number | null;
          driver_lng: number | null;
        }[]
      >`
        select o.id,
               o.status::text                        as status,
               st_y(o.pickup::geometry)              as pickup_lat,
               st_x(o.pickup::geometry)              as pickup_lng,
               o.pickup_label,
               st_y(o.dropoff::geometry)             as dropoff_lat,
               st_x(o.dropoff::geometry)             as dropoff_lng,
               o.dropoff_label,
               st_y(d.last_location::geometry)       as driver_lat,
               st_x(d.last_location::geometry)       as driver_lng
          from orders o
          join drivers d on d.id = o.assigned_driver_id
          join users u on u.id = d.user_id
         where (
                 (${byId}::uuid is not null and o.assigned_driver_id = ${byId}::uuid)
                 or (${byTelegram}::text is not null and u.telegram_id = ${byTelegram}::bigint)
               )
           and o.status in ('matched', 'in_progress')
         limit 1
      `;

      const row = rows[0];
      if (row === undefined) return null;

      /**
       * الانطلاق وحده إلزام: `orders.pickup` لا يقبل الفراغ في القاعدة، فغيابه
       * يعني صفّاً مستحيلاً لا حالةً تُعرَض. أمّا `dropoff` فيقبل الفراغ فعلاً
       * (راكبٌ يحدّد مقصده في السيّارة) — وردّ `null` للبطاقة كلّها بسببه كان
       * يكتم رحلةً جارية بأكملها، وهو ما أسقط أربعة اختبارات تكامل.
       */
      if (row.pickup_lat === null || row.pickup_lng === null) return null;
      /**
       * الحالة تُضيَّق هنا لا تُحوَّل: `as` كان سيُمرّر أيّ حالةٍ تُضاف إلى التعداد
       * غداً (`arrived` مثلاً) إلى الدومين بلا مرحلةٍ معروفة لها. والشرط يجعل
       * المترجم هو من يمنع ذلك، فإضافة حالةٍ جديدة تُفشل الترجمة لا الإنتاج.
       */
      const status: DriverTripStatus | null =
        row.status === "matched" ? "matched" : row.status === "in_progress" ? "in_progress" : null;
      if (status === null) return null;

      return {
        trip: {
          tripId: row.id,
          status,
          pickup: {
            coordinates: {
              latitude: Number(row.pickup_lat),
              longitude: Number(row.pickup_lng),
            },
            label: row.pickup_label,
          },
          destination:
            row.dropoff_lat === null || row.dropoff_lng === null
              ? null
              : {
                  coordinates: {
                    latitude: Number(row.dropoff_lat),
                    longitude: Number(row.dropoff_lng),
                  },
                  label: row.dropoff_label,
                },
        },
        driverLocation:
          row.driver_lat === null || row.driver_lng === null
            ? null
            : { latitude: Number(row.driver_lat), longitude: Number(row.driver_lng) },
      };
    },
  };
}

export function createTrackingProofReader(sql: Sql): TrackingProofReader {
  return {
    proofOf: async (tripId) => {
      const rows = await sql<
        {
          id: string;
          rider_id: string;
          assigned_driver_id: string | null;
          status: string;
          city_id: string;
        }[]
      >`
        select id, rider_id, assigned_driver_id, status::text as status, city_id
          from orders
         where id = ${tripId}::uuid
         limit 1
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        tripId: row.id,
        riderId: row.rider_id,
        driverId: row.assigned_driver_id,
        status: row.status as WatchedTripStatus,
        cityId: row.city_id,
      };
    },

    customerOf: async (tripId) => {
      const rows = await sql<
        {
          id: string;
          rider_id: string;
          telegram_id: string;
          language_code: string | null;
          assigned_driver_id: string | null;
          status: string;
        }[]
      >`
        select o.id, o.rider_id, u.telegram_id::text as telegram_id,
               u.language_code, o.assigned_driver_id, o.status::text as status
          from orders o
          join riders r on r.id = o.rider_id
          join users u on u.id = r.user_id
         where o.id = ${tripId}::uuid
         limit 1
      `;
      const row = rows[0];
      if (row === undefined || row.assigned_driver_id === null) return null;
      return {
        tripId: row.id,
        riderId: row.rider_id,
        riderTelegramId: row.telegram_id,
        driverId: row.assigned_driver_id,
        riderLanguage: row.language_code ?? "ar",
        // نفس الإسقاط المستخدم في `proofOf` حرفيّاً: قيد `orders_status_check` في
        // القاعدة و`WatchedTripStatus` في المجال يسردان نفس القيم، فالإسقاط يقرّر
        // ما تضمنه القاعدة؛ وفحصٌ يدويٌّ هنا يكون سرداً ثالثاً ينحرف عنهما.
        status: row.status as WatchedTripStatus,
      };
    },
  };
}
