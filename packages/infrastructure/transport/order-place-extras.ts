/**
 * # قراءةُ ما أدخلَه الراكبُ عن المكانَين — `LOC-TRUST-01`
 *
 * **الغرض:** بطاقاتُ السائقِ (اللوحُ والتفاصيلُ والمَهمّةُ) تقرأُ من دالّاتٍ مُحكَمةٍ
 * (`driver_offer_board` · `driver_offer_detail` · `driver_active_job`) لا تحملُ الأعمدةَ
 * الجديدة. فبدلَ إعادةِ كتابةِ تلكَ الدالّاتِ (وهيَ حارسةُ التفويض) يُقرأُ الزائدُ هنا
 * **لمعرّفاتِ الطلباتِ التي أعادَتها تلكَ الدالّاتُ نفسُها** — أي بعدَ أن حكمَت القاعدةُ
 * بأنَّها للسائقِ — فلا يتّسعُ ما يراه السائقُ إلى طلبٍ لم يُعرَضْ عليه.
 *
 * **ما لا يفعلُه عن قصد:** لا يُسقِطُ القراءةَ الأصليّةَ إن تعذّرَ هو: عطبُه (قاعدةٌ لم
 * تُطبَّقْ عليها الهجرةُ بعد) يُعيدُ خريطةً فارغةً فتبقى البطاقةُ كما كانَت لا شاشةَ عطب.
 * ولا يكتبُ سجلّاً بقيمةٍ: لا رابطَ ولا ملاحظةَ ولا إحداثيّةَ في أيِّ سطر.
 *
 * **الحالة:** منفّذ فعلياً. **ينتمي إلى:** infrastructure/transport.
 */
import type { DriverOfferTerms, DriverPlaceExtras } from "../../domain/driver/driver-offers.ts";
import { isOfferMode } from "../../shared/order-terms/index.ts";
import type { Sql } from "../db/client.ts";

export interface OrderPlaceExtras {
  readonly pickup: DriverPlaceExtras;
  readonly dropoff: DriverPlaceExtras | null;
  /** `WR-05` — سياسةُ المبلغ (`mode` `null` لطلبٍ أقدمَ منها). */
  readonly offerTerms: DriverOfferTerms;
}

/** صفُّ استعلامِ الملاحقِ — مُصدَّرٌ لمشاركتهِ مع القراءةِ الموحّدةِ للوحِ. */
export interface ExtrasRow {
  readonly id: string;
  readonly pickup_link: string | null;
  readonly pickup_notes: string | null;
  readonly pickup_lat: number | null;
  readonly pickup_lng: number | null;
  readonly has_dropoff: boolean;
  readonly dropoff_link: string | null;
  readonly dropoff_notes: string | null;
  readonly dropoff_lat: number | null;
  readonly dropoff_lng: number | null;
  readonly rider_offer_mode: string | null;
  readonly rider_offer_sar: number | null;
  readonly pickup_at: Date | string | null;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function instant(value: Date | string | null): string | null {
  if (value === null) return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * محلّلُ صفِّ ملاحقِ مكانٍ واحدٍ — مشتركٌ بينَ مسارَي القراءةِ (المستقلُّ والمموّجُ في
 * استعلامٍ واحدٍ) كي لا يظهرَ للمكانِ الواحدِ تعريفانِ مختلفانِ. الحقولُ
 * هنا أسماءُ أعمدةِ الاستعلامِ لا أسماءَ واجهةٍ؛ فمن يغيّرُ العمودَ يغيّرُ المحلّلَ.
 */
export function parseOrderPlaceExtrasRow(row: ExtrasRow): OrderPlaceExtras {
  return {
    pickup: {
      link: text(row.pickup_link),
      notes: text(row.pickup_notes),
      latitude: num(row.pickup_lat),
      longitude: num(row.pickup_lng),
    },
    dropoff: row.has_dropoff
      ? {
          link: text(row.dropoff_link),
          notes: text(row.dropoff_notes),
          latitude: num(row.dropoff_lat),
          longitude: num(row.dropoff_lng),
        }
      : null,
    offerTerms: {
      mode: isOfferMode(row.rider_offer_mode) ? row.rider_offer_mode : null,
      offerSar: num(row.rider_offer_sar),
      pickupAt: instant(row.pickup_at),
    },
  };
}

export async function readOrderPlaceExtras(
  sql: Sql,
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, OrderPlaceExtras>> {
  const ids = [...new Set(orderIds.filter((id) => UUID.test(id)))];
  const found = new Map<string, OrderPlaceExtras>();
  if (ids.length === 0) return found;
  let rows: ExtrasRow[];
  try {
    rows = await sql<ExtrasRow[]>`
      select o.id::text as id,
             o.pickup_link, o.pickup_notes,
             st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng,
             (o.dropoff is not null) as has_dropoff,
             o.dropoff_link, o.dropoff_notes,
             st_y(o.dropoff::geometry) as dropoff_lat, st_x(o.dropoff::geometry) as dropoff_lng,
             o.rider_offer_mode, o.rider_offer_sar, o.pickup_at
        from orders o
       where o.id = any(${sql.array(ids)}::uuid[])`;
  } catch {
    return found;
  }
  for (const row of rows) {
    found.set(row.id, parseOrderPlaceExtrasRow(row));
  }
  return found;
}
