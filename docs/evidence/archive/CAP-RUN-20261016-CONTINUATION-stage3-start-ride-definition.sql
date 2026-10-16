CREATE OR REPLACE FUNCTION public.start_ride(p_order_id uuid, p_driver_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order   orders%rowtype;
  v_driver  drivers%rowtype;
  v_user    users%rowtype;
  v_rider   riders%rowtype;
  v_rider_u users%rowtype;
  v_now     timestamptz := now();
begin
  select * into v_user from users where telegram_id = p_driver_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  -- القفل على الصف: لا يبدأ الرحلة إلا من أُسندت إليه، ولا تُبدأ مرتين
  select * into v_order
    from orders
   where id = p_order_id and status = 'matched' and assigned_driver_id = v_driver.id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_STARTABLE');
  end if;

  update orders set status = 'in_progress', started_at = v_now where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_user.id, 'order.started', 'order', p_order_id,
          jsonb_build_object('driver_id', v_driver.id));

  -- العميل يُقرأ داخل الصفقة نفسها التي أقفلت الطلب، فلا فجوة بين البدء والإشعار
  select * into v_rider from riders where id = v_order.rider_id;
  select * into v_rider_u from users where id = v_rider.user_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'started_at', v_now,
    'service', v_order.service,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    -- البنية نفسها التي تعيدها complete_ride حرفياً: محوّل واحد يقرأ الاثنين
    'driver', jsonb_build_object('telegram_id', v_user.telegram_id,
                                 'language_code', v_user.language_code,
                                 'full_name', v_user.full_name),
    'rider',  jsonb_build_object('telegram_id', v_rider_u.telegram_id,
                                 'language_code', v_rider_u.language_code,
                                 'full_name', v_rider_u.full_name)
  );
end;
$function$

