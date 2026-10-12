-- migration-phase: expand
-- WR-05 — سياسةُ المبلغِ داخلَ نموذجِ الطلب (ADR 0264) · طورُ التوسعة.
--
-- ثلاثُ حالاتٍ لا رابعَ لها:
--   fixed      مبلغٌ 1..10000 · «سعر محدد — غير قابل للتفاوض»
--   suggested  مبلغٌ 1..10000 · «السعر قابل للتفاوض»
--   open       بلا مبلغ       · «السعر غير محدد — اتفق مع طالب الخدمة عبر المحادثة»
-- و`null` طلبٌ أقدمُ من السياسة (يبقى نصُّه القديم). لا أجرةَ تلقائيّةً ولا تحصيل (DEC-11 §١).
--
-- `request_ride_with_terms` يُسقِطُ المبلغَ المعطوبَ صامتاً إلى `null`؛ والغلافُ الجديدُ
-- يرفضُه برمزٍ قبلَ أيِّ كتابة، ثمَّ يُفوِّضُ إلى `request_ride_with_places` فيُكتَبُ
-- الطلبُ وسياستُه في معاملةِ النداءِ نفسِها — فلا يقرأُ مُرسِلُ البطاقةِ طلباً بلا سياسة.
-- التوقيعاتُ القديمةُ باقيةٌ (توسعة) ولا ينادِيها الإصدارُ الجديد.

alter table orders add column if not exists rider_offer_mode text;

comment on column orders.rider_offer_mode is
  'WR-05: fixed | suggested | open — null للطلبات الأقدم من السياسة (ADR 0264).';

alter table orders
  add constraint orders_rider_offer_mode_valid
  check (
    rider_offer_mode is null
    or (rider_offer_mode = 'open' and rider_offer_sar is null)
    -- `is not null` صريحٌ: قيدُ CHECK يمرُّ إن كانَ تعبيرُه NULL، فـ«محدَّدٌ بلا مبلغ» كانَ سيمرّ.
    or (
      rider_offer_mode in ('fixed', 'suggested')
      and rider_offer_sar is not null
      and rider_offer_sar between 1 and 10000
    )
  ) not valid;

create or replace function request_ride_with_offer(
  p_telegram_id     bigint,
  p_key             text,
  p_service         service_type,
  p_origin_lat      double precision,
  p_origin_lng      double precision,
  p_dest_lat        double precision,
  p_dest_lng        double precision,
  p_notes           text,
  p_pickup_label    text,
  p_dropoff_label   text,
  p_pickup_at       timestamptz,
  p_offer_sar       integer,
  p_pickup_place    jsonb,
  p_dropoff_place   jsonb,
  p_offer_mode      text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result   jsonb;
  v_order_id uuid;
begin
  if p_offer_mode is null or p_offer_mode not in ('fixed', 'suggested', 'open') then
    return jsonb_build_object('ok', false, 'error', 'OFFER_MODE_INVALID');
  end if;
  if p_offer_mode = 'open' and p_offer_sar is not null then
    return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_UNEXPECTED');
  end if;
  if p_offer_mode in ('fixed', 'suggested') then
    if p_offer_sar is null then
      return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_REQUIRED');
    end if;
    if p_offer_sar < 1 or p_offer_sar > 10000 then
      return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_INVALID');
    end if;
  end if;

  v_result := request_ride_with_places(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes,
    p_pickup_label, p_dropoff_label, p_pickup_at, p_offer_sar,
    p_pickup_place, p_dropoff_place
  );

  if (v_result->>'ok')::boolean is true
     and coalesce((v_result->>'reused')::boolean, false) is false then
    v_order_id := (v_result->>'order_id')::uuid;
    update orders
       set rider_offer_mode = p_offer_mode
     where id = v_order_id;
  end if;

  return v_result;
end;
$$;

revoke execute on function request_ride_with_offer(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function request_ride_with_offer(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer, jsonb, jsonb, text)
  to service_role;
