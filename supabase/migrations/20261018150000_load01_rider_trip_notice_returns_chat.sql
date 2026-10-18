-- migration-phase: expand
-- =============================================================================
-- LOAD-01 (الدفعةُ الحاديةَ عشرةَ) — `enqueue_rider_trip_notice` يُعيدُ معرّفَ تيليجرامِ الراكب.
--
-- **المقيسُ (`b11-diag-sig-500`، 2026-10-18):** تجمُّعُ الطلبِ (5 مقاعد) مشبَعٌ بزمنِ احتجازِ المقاعد
-- لا بتنفيذِ القاعدة: 57.4 استعلامًا لكلِّ سيناريو × ~4.3ms احتجازًا للواحدِ (التنفيذُ ~0.3ms
-- والباقي رحلةُ الذهابِ والإيابِ وجدولةُ نواتينِ متنافستَين) ⇒ سقفٌ ~22 سيناريو/ث، وهو المقيس.
-- ومن الـ57.4: بعدَ كلِّ إيداعٍ ناجحٍ لإشعارِ الطورِ (4 لكلِّ سيناريو) كانَت البوّابةُ تُرسِلُ
-- استعلامًا ثانيًا لا لشيءٍ إلّا معرّفَ تيليجرامِ الراكبِ للإشارةِ اللحظيّة (ADR 0287):
--   select u.telegram_id from orders o join riders r … join users u … where o.id = $1
-- والدالّةُ نفسُها تقرأُ `orders ⋈ riders` لتعرفَ `rider_user_id` — فالمعرّفُ على بُعدِ ضمٍّ واحد.
--
-- **التغييرُ الوحيد:** ضمُّ `users` (يسارًا) في القراءةِ نفسِها، وحقلُ `rider_telegram_id` في الردّ (نصٌّ أو
-- `null` لحسابٍ مُجهَّل). الدلالةُ كما هي حرفًا: الأحداثُ المقبولةُ، ومفتاحُ منعِ التكرار،
-- و`created` و`delivery_id`. والحقلُ إضافيٌّ فالمستدعي الأقدمُ لا يتأثّر.
-- =============================================================================

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

  select o.id, o.city_id, r.user_id as rider_user_id, u.telegram_id::text as rider_telegram_id
    into v_order
    from orders o
    join riders r on r.id = o.rider_id
    left join users u on u.id = r.user_id  -- يسارٌ: لا يغيّرُ «وُجِدَ الطلب» عمّا كان
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
    return jsonb_build_object('ok', true, 'created', false, 'delivery_id', v_id,
                              'rider_telegram_id', v_order.rider_telegram_id);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'delivery_id', v_id,
                            'rider_telegram_id', v_order.rider_telegram_id);
end $function$;

revoke all on function enqueue_rider_trip_notice(uuid, text) from public, anon, authenticated;
grant execute on function enqueue_rider_trip_notice(uuid, text) to service_role;
