-- WR-22 (ADR 0276): انتهاءُ البحثِ — لا طلبَ «يبحثُ» إلى الأبد.
--
-- كُشِفَ في الإنتاج 2026-10-12: طلبٌ فوريٌّ في المدينة المنوّرة بلا أيِّ سائقٍ مؤهَّل
-- (السائقُ القريبُ `pending`، والموثَّقُ غيرُ متّصل) صُعِّدَ وأُخبِرَ صاحبُه «لم نجد سائقًا»،
-- ثمَّ بقيَ `searching` ساعاتٍ: لا عرضَ يُنهي مهلتَه، ولا دورةَ بثٍّ تنفد، ولا مسارَ يُغلقُه.
--
-- ١) الإعدادُ `searching_expire_after_minutes` لكلِّ مدينة: مدّةُ البحثِ القصوى من بدءِ البحث
--    (`coalesce(searching_since, created_at)` — المجدولُ يُقاسُ من إطلاقِه). **المدّةُ قرارٌ
--    تجاريٌّ للمالك لم يُتَّخذ بعد**، فيُبذَرُ صفرًا (= معطَّل) و`is_provisional = true`،
--    والآليّةُ قائمةٌ تنتظرُ القيمة. المدى المقبول 0 أو 10..1440 دقيقة.
-- ٢) `expire_stale_searching_orders(city, limit)`: ما تجاوزَ المدّةَ وهو `searching` بلا سائقٍ
--    مُسنَد ولا مرشَّحٍ ينتظرُ قرارَ الراكب ولا عرضٍ `pending` ولا دورةِ قروبٍ مفتوحة ⇒
--    `failed` بسببٍ مسمّى `search_expired`، وأثرٌ في `audit_log`، وإشعارٌ واحدٌ للراكب
--    (`SEARCH_EXPIRED`، مفتاحُ منعِ التكرارِ في صندوقِ الصادر). القفلُ `for update skip locked`
--    وإعادةُ فحصِ الشروطِ تحتَه: عاملانِ متزامنانِ لا يُنهيانِ الطلبَ مرّتين، والقبولُ
--    (`claim_ride` · `rider_decide_candidate` · `settle_unsubscribed_negotiation`) والإلغاءُ
--    (`cancel_order_by_rider`) كلُّها تقفلُ الصفَّ نفسَه وتشترطُ حالتَها، فأيُّهما سبقَ ربح.
--    وما له عرضٌ أو مرشَّحٌ أو دورةٌ يُتركُ لمسارِه حتّى يُغلَق، ثمَّ يلتقطُه الشوطُ التالي.
-- ٣) `enqueue_rider_trip_notice` تقبلُ الحدثَ `SEARCH_EXPIRED` (والباقي كما هو).
--
-- العودة: `searching_expire_after_minutes = 0` يوقفُ الآليّةَ بلا هجرة.

insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'searching_expire_after_minutes', '0'::jsonb, 'number',
       'WR-22: الطلبُ الذي يبحثُ بلا سائقٍ مُسنَدٍ أكثرَ من هذه الدقائقِ (من بدءِ البحث) يُنهى `failed` بسببِ `search_expired` ويُعلَمُ الراكب. 0 ⇒ معطَّل. (0 أو 10..1440)',
       true
  from cities c
on conflict (city_id, key) do nothing;

create or replace function searching_expire_after_minutes(p_city_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case
           when v.n is null or v.n <= 0 then 0
           else greatest(10, least(1440, v.n))
         end
    from (
      select (select case when jsonb_typeof(ps.value) = 'number'
                          then (ps.value #>> '{}')::numeric::integer end
                from platform_settings ps
               where ps.city_id = p_city_id and ps.key = 'searching_expire_after_minutes') as n
    ) v;
$$;
revoke all on function searching_expire_after_minutes(uuid) from public, anon, authenticated;
grant execute on function searching_expire_after_minutes(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.enqueue_rider_trip_notice(p_order_id uuid, p_event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order record;
  v_id uuid;
begin
  if p_event is null or p_event not in ('MATCHED', 'ARRIVED', 'STARTED', 'COMPLETED',
                                       'SCHEDULED', 'SCHEDULE_REMINDER', 'SEARCH_STARTED', 'SCHEDULE_MISSED',
                                       'SEARCH_EXPIRED') then
    return jsonb_build_object('ok', false, 'error', 'EVENT_INVALID');
  end if;

  select o.id, o.city_id, r.user_id as rider_user_id
    into v_order
    from orders o
    join riders r on r.id = o.rider_id
   where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key)
  values (
    v_order.city_id, 'rider_trip_notice', v_order.id, v_order.rider_user_id,
    jsonb_build_object('order_id', v_order.id, 'event', p_event),
    'rider_trip:' || v_order.id::text || ':' || p_event
  )
  on conflict (kind, dedup_key) do nothing
  returning id into v_id;

  if v_id is null then
    select n.id into v_id from notification_outbox n
     where n.kind = 'rider_trip_notice'
       and n.dedup_key = 'rider_trip:' || v_order.id::text || ':' || p_event;
    return jsonb_build_object('ok', true, 'created', false, 'delivery_id', v_id);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'delivery_id', v_id);
end $function$;

create or replace function expire_stale_searching_orders(p_city_id uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer;
  v_row     record;
  v_expired jsonb := '[]'::jsonb;
  v_held    integer := 0;
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_REQUIRED');
  end if;
  v_minutes := searching_expire_after_minutes(p_city_id);
  if v_minutes = 0 then
    return jsonb_build_object('ok', true, 'disabled', true, 'expired', v_expired, 'held', 0);
  end if;

  for v_row in
    select o.id, o.broadcast_round, o.service,
           coalesce(o.searching_since, o.created_at) as search_started
      from orders o
     where o.city_id = p_city_id
       and o.status = 'searching'
       and coalesce(o.searching_since, o.created_at) <= now() - make_interval(mins => v_minutes)
       and o.assigned_driver_id is null
       and o.candidate_driver_id is null
       and not exists (select 1 from order_offers f
                        where f.order_id = o.id and f.status = 'pending')
       and not exists (select 1 from unsubscribed_negotiations n
                        where n.order_id = o.id and n.status in ('collecting', 'negotiating'))
     order by coalesce(o.searching_since, o.created_at)
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  loop
    -- تحتَ القفل: ما زالَ في يدِ مسارٍ آخرَ يُترَك. والحالةُ تُعادُ قراءتُها لأنَّ `for update`
    -- في حلقةِ `select` يقفلُ الصفَّ كما هو الآن، وقد تغيّرَ بعدَ لقطةِ الاستعلام.
    if exists (select 1 from orders o
                where o.id = v_row.id
                  and (o.status <> 'searching'
                       or o.assigned_driver_id is not null
                       or o.candidate_driver_id is not null))
       or exists (select 1 from order_offers f
                   where f.order_id = v_row.id and f.status = 'pending')
       or exists (select 1 from unsubscribed_negotiations n
                   where n.order_id = v_row.id and n.status in ('collecting', 'negotiating')) then
      v_held := v_held + 1;
      continue;
    end if;

    update orders
       set status = 'failed', cancelled_reason = 'search_expired', updated_at = now()
     where id = v_row.id;
    insert into audit_log (city_id, action, entity_type, entity_id, payload)
    values (p_city_id, 'order.search_expired', 'order', v_row.id,
            jsonb_build_object('search_started', v_row.search_started,
                               'searched_seconds', floor(extract(epoch from now() - v_row.search_started))::integer,
                               'expire_after_minutes', v_minutes,
                               'broadcast_round', v_row.broadcast_round,
                               'service', v_row.service));
    perform enqueue_rider_trip_notice(v_row.id, 'SEARCH_EXPIRED');
    v_expired := v_expired || to_jsonb(v_row.id);
  end loop;

  return jsonb_build_object('ok', true, 'disabled', false, 'expired', v_expired, 'held', v_held,
                            'expire_after_minutes', v_minutes);
end;
$$;
revoke all on function expire_stale_searching_orders(uuid, integer) from public, anon, authenticated;
grant execute on function expire_stale_searching_orders(uuid, integer) to service_role;
