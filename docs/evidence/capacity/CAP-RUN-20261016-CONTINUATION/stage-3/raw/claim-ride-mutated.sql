CREATE OR REPLACE FUNCTION public.claim_ride(p_order_id uuid, p_driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order  orders%rowtype;
  v_offer  order_offers%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
  v_rider  record;
  v_driver_name text;
  v_window integer;
  v_expires timestamptz;
  v_rider_user uuid;
begin
  -- القفل الذرّي: من لا يظفر بالصف لا ينتظر، بل يخسر فوراً
  select * into v_order
    from orders
   where id = p_order_id and status = 'searching'
     for update skip locked;

  if not found then
    -- `BUG-008`: أهو سباقٌ خُسِر، أم إعادةُ تسليمٍ لنقرةِ الفائزِ نفسِه؟
    select * into v_order
      from orders
     where id = p_order_id
       and assigned_driver_id = p_driver_id
       and is_driver_engaged_order_status(status);

    if found then
      select * into v_driver from drivers where id = p_driver_id;
      select u.full_name into v_driver_name
        from users u where u.id = v_driver.user_id;

      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'order_id', p_order_id,
        'driver_id', p_driver_id,
        'matched_at', v_order.matched_at,
        'city_id', v_order.city_id,
        'rider', null,
        'driver_name', v_driver_name,
        'driver_plate', v_driver.plate_number,
        'driver_vehicle', v_driver.vehicle_type
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  -- `WR-09`: مرشَّحٌ حيٌّ يحجزُ الطلب. الفائتُ يُحرَّرُ هنا كسولًا قبلَ المتابعة.
  if v_order.candidate_driver_id is not null then
    if v_order.candidate_expires_at > v_now then
      if v_order.candidate_driver_id = p_driver_id then
        select * into v_driver from drivers where id = p_driver_id;
        select u.full_name into v_driver_name from users u where u.id = v_driver.user_id;
        return jsonb_build_object(
          'ok', true, 'duplicate', true, 'pending_rider', true,
          'order_id', p_order_id, 'driver_id', p_driver_id,
          'matched_at', null, 'expires_at', v_order.candidate_expires_at,
          'city_id', v_order.city_id, 'rider', null,
          'driver_name', v_driver_name, 'driver_plate', v_driver.plate_number,
          'driver_vehicle', v_driver.vehicle_type);
      end if;
      return jsonb_build_object('ok', false, 'error', 'ORDER_HELD',
                                'expires_at', v_order.candidate_expires_at);
    end if;
    perform release_order_candidate(p_order_id, 'EXPIRED');
  end if;

  select * into v_offer
    from order_offers
   where order_id = p_order_id
     and driver_id = p_driver_id
     and status = 'pending'
     and expires_at > v_now
   order by round desc
   limit 1
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_VALID');
  end if;

  select * into v_driver from drivers where id = p_driver_id
    for update;
  if v_driver.city_id <> v_order.city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;


  select u.full_name into v_driver_name
    from users u where u.id = v_driver.user_id;

  -- `WR-09`: نافذةُ قرارِ الراكب. صفرٌ ⇒ الإسنادُ الفوريُّ أدناه كما كان حرفًا.
  v_window := rider_choice_window_seconds(v_order.city_id);
  if v_window > 0 then
    v_expires := v_now + make_interval(secs => v_window);

    update orders
       set candidate_driver_id = p_driver_id, candidate_offer_id = v_offer.id,
           candidate_expires_at = v_expires, updated_at = v_now
     where id = p_order_id;

    -- العرضُ لا ينتهي والراكبُ يقرّر.
    update order_offers
       set expires_at = greatest(expires_at, v_expires), updated_at = v_now
     where id = v_offer.id;

    insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
    values (v_order.city_id, v_driver.user_id, 'order.candidate_proposed', 'order', p_order_id,
            jsonb_build_object('driver_id', p_driver_id, 'offer_id', v_offer.id,
                               'round', v_offer.round, 'expires_at', v_expires));

    select r.user_id into v_rider_user from riders r where r.id = v_order.rider_id;
    insert into notification_outbox (city_id, kind, order_id, recipient_user_id, payload, dedup_key)
    values (
      v_order.city_id, 'rider_trip_notice', p_order_id, v_rider_user,
      jsonb_build_object('order_id', p_order_id, 'event', 'CANDIDATE',
                         'offer_id', v_offer.id, 'driver_id', p_driver_id,
                         'expires_at', v_expires),
      'rider_trip:' || p_order_id::text || ':CANDIDATE:' || v_offer.id::text
    )
    on conflict (kind, dedup_key) do nothing;

    return jsonb_build_object(
      'ok', true, 'duplicate', false, 'pending_rider', true,
      'order_id', p_order_id, 'driver_id', p_driver_id,
      'matched_at', null, 'expires_at', v_expires, 'window_seconds', v_window,
      'city_id', v_order.city_id, 'rider', null,
      'driver_name', v_driver_name, 'driver_plate', v_driver.plate_number,
      'driver_vehicle', v_driver.vehicle_type);
  end if;

  update order_offers
     set status = 'accepted', responded_at = v_now
   where id = v_offer.id;

  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = p_order_id and id <> v_offer.id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = p_driver_id, matched_at = v_now
   where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_driver.user_id, 'order.claimed', 'order', p_order_id,
          jsonb_build_object('driver_id', p_driver_id, 'offer_id', v_offer.id,
                             'round', v_offer.round));

  select u.telegram_id as telegram_id,
         coalesce(u.language_code, 'ar') as language_code,
         u.full_name as full_name
    into v_rider
    from riders r
    join users u on u.id = r.user_id
   where r.id = v_order.rider_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order_id', p_order_id,
    'driver_id', p_driver_id,
    'matched_at', v_now,
    'city_id', v_order.city_id,
    'rider', case
               when v_rider.telegram_id is null then null
               else jsonb_build_object(
                      'rider_id', v_order.rider_id,
                      'telegram_id', v_rider.telegram_id,
                      'language_code', v_rider.language_code,
                      'full_name', v_rider.full_name)
             end,
    'driver_name', v_driver_name,
    'driver_plate', v_driver.plate_number,
    'driver_vehicle', v_driver.vehicle_type
  );
end;
$function$

