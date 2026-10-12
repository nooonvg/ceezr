-- migration-phase: expand
-- =============================================================================
-- `WR-22` — إلغاءُ الراكبِ أثناءَ انتظارِ قرارِه في مرشَّحٍ (WR-09) يُحرِّرُ المرشَّحَ فورًا
-- ويُخطِرُه مرّةً واحدة.
--
-- **المقيسُ (قاعدةٌ محليّةٌ من `main`):** `cancel_order_by_rider` يُلغي عرضَ المرشَّحِ المعلَّقَ
-- ويودعُ له `order_cancelled` («أُلغي الطلب من العميل. لم يعد العرض متاحاً.»)، ويتركُ
-- `orders.candidate_driver_id` قائمًا على طلبٍ ملغى، فيحرّرُه `expire_order_candidates` في الشوطِ
-- التالي ويودعُ له `driver_candidate_notice` بنتيجة `CANCELLED` («ألغى العميل الطلب قبل أن
-- يختار»). رسالتانِ للسائقِ نفسِه عن الإلغاءِ نفسِه.
--
-- **القرار:** الصورةُ السابقةُ (`20260906040000`) حرفًا، مع ثلاثةِ فروق:
--   ١) المرشَّحُ يُستثنى من حلقةِ `order_cancelled`.
--   ٢) `release_order_candidate(order, 'CANCELLED')` في المعاملةِ نفسِها بعدَ تحويلِ الطلب،
--      فيُمحى المرشَّحُ ويُكتبُ `order.candidate_released` ويُودَعُ إشعارُه الوحيد.
--   ٣) المردُّ يحملُ `candidate_released`. ولا تغييرَ في سياسةِ مَن يُلغي ومتى: `searching`
--      و`matched` وحدَهما كما كانا.
--
-- **التوافق:** المُنادي (`negotiation-adapters.ts`) يقرأُ `notifications_queued` وحدَه. والرجوعُ
-- بإعادةِ الصورةِ السابقة؛ والأثرُ الوحيدُ عندئذٍ عودةُ الرسالةِ المكرَّرة.
-- =============================================================================

create or replace function cancel_order_by_rider(
  p_order_id uuid,
  p_rider_id uuid,
  p_reason   text default 'rider_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    orders%rowtype;
  v_rider    riders%rowtype;
  v_now      timestamptz := now();
  v_offers   jsonb;
  v_assigned jsonb;
  v_negot    jsonb;
  v_target   record;
  v_queued   integer := 0;
  -- `WR-22`: مرشَّحُ «الراكبُ يختارُ» (WR-09) إن كانَ الطلبُ ينتظرُ قرارَ الراكب.
  v_candidate uuid;
  v_released  jsonb := null;
begin
  -- القفل الذرّي: يمنع أن يقبل سائق الطلب في اللحظة نفسها التي يُلغى فيها.
  -- claim_ride تشترط status='searching' تحت قفل مماثل، فأحد الطرفين يخسر حتماً.
  select * into v_order
    from orders
   where id = p_order_id
     and rider_id = p_rider_id
     and status in ('searching', 'matched')
     for update;

  if not found then
    -- نميّز الأسباب: «لا يوجد طلب» و«فات أوان الإلغاء» ليسا شيئاً واحداً،
    -- وقول أحدهما مكان الآخر كذب على العميل.
    if exists (select 1 from orders where id = p_order_id and rider_id = p_rider_id) then
      return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CANCELLABLE');
    end if;
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select * into v_rider from riders where id = p_rider_id;
  v_candidate := v_order.candidate_driver_id;

  -- 1) السائقون أصحاب العروض المعلّقة: يجب أن يعرفوا أن الطلب لم يعد معروضاً،
  --    وإلا ظلّت بطاقة العرض في محادثتهم تدعوهم إلى قبول ما لا يُقبل.
  with cancelled_offers as (
    update order_offers o
       set status = 'cancelled', responded_at = v_now
     where o.order_id = p_order_id and o.status = 'pending'
    returning o.driver_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'driver_id', d.id, 'telegram_id', u.telegram_id, 'language', u.language_code)), '[]'::jsonb)
    into v_offers
    from cancelled_offers co
    join drivers d on d.id = co.driver_id
    join users u   on u.id = d.user_id;

  -- 2) السائق المُسنَد إن كان الطلب مطابَقاً: هو في طريقه فعلاً، وإخفاء الإلغاء
  --    عنه أسوأ من الإلغاء نفسه.
  if v_order.assigned_driver_id is not null then
    select jsonb_build_object(
             'driver_id', d.id, 'telegram_id', u.telegram_id, 'language', u.language_code)
      into v_assigned
      from drivers d join users u on u.id = d.user_id
     where d.id = v_order.assigned_driver_id;
  end if;

  -- 3) بطاقات القروب: التفاوض المفتوح يُغلق، ويُعاد معرّف الرسالة لتُحرَّر البطاقة
  --    في القروب بدل أن تبقى معروضة لطلب انتهى.
  with closed as (
    update unsubscribed_negotiations n
       set status = 'cancelled', settled_at = v_now, updated_at = v_now
     where n.order_id = p_order_id and n.status in ('collecting', 'negotiating')
    returning n.group_message_id, n.city_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'group_message_id', c.group_message_id)) filter (where c.group_message_id is not null),
         '[]'::jsonb)
    into v_negot
    from closed c;

  -- 4) الطلب نفسه — بعد الفروع لا قبلها، حتى تُقرأ الحالة السابقة سليمة أعلاه
  update orders
     set status = 'cancelled',
         cancelled_reason = p_reason,
         updated_at = v_now
   where id = p_order_id;

  -- 5) الأثر الدائم: بغير هذا السطر يصبح الإلغاء حدثاً بلا ذاكرة
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rider.user_id, 'order.cancelled', 'order', p_order_id,
          jsonb_build_object('reason', p_reason,
                             'previous_status', v_order.status,
                             'service', v_order.service,
                             'assigned_driver_id', v_order.assigned_driver_id,
                             'notified_offers', jsonb_array_length(v_offers)));

  -- 6) إخطارُ السائقينِ يُودَعُ **هنا** — داخلَ معاملةِ الإلغاءِ نفسِها (BUG-004):
  --    فإن رجعت المعاملةُ رجعَ الصفُّ معها فلا يُخبَرُ سائقٌ بإلغاءٍ لم يقع؛ وإن
  --    نجحت لم يضعْ إخطارُه لو تعثّرَ تيليجرامُ لحظتَها — يُعادُ حتّى يصلَ. وصفٌّ
  --    لكلِّ سائقٍ لا صفٌّ للحادثةِ: مَن وصلَه لا يصلُه ثانيةً بإعادةِ غيرِه.
  --    و`bool_or` تجعلُ الإسنادَ يغلبُ: السائقُ المُسنَدُ قد يكونُ صاحبَ عرضٍ معلَّقٍ
  --    كذلك، ونصُّ «كنتَ في طريقِك» أصدقُ في حقِّه من نصِّ العرضِ الملغى.
  for v_target in
    select t.driver_id, bool_or(t.was_assigned) as was_assigned
      from (
        select (elem->>'driver_id')::uuid as driver_id, false as was_assigned
          from jsonb_array_elements(v_offers) elem
        union all
        select (v_assigned->>'driver_id')::uuid as driver_id, true as was_assigned
         where v_assigned is not null
      ) t
     -- `WR-22`: المرشَّحُ يُخطَرُ مرّةً واحدةً بنصِّه («ألغى العميلُ الطلبَ قبلَ أن يختار») أدناه،
     -- لا بإلغاءِ العرضِ هنا ثمّ بإشعارِ المرشَّحِ من الشوطِ بعدَ دقيقة.
     where v_candidate is null or t.driver_id <> v_candidate
     group by t.driver_id
  loop
    if enqueue_notification(
         v_order.city_id,
         'order_cancelled',
         jsonb_build_object('order_id', p_order_id::text,
                            'driver_id', v_target.driver_id::text,
                            'was_assigned', v_target.was_assigned),
         'order_cancelled:' || p_order_id::text || ':' || v_target.driver_id::text
       ) is not null then
      v_queued := v_queued + 1;
    end if;
  end loop;

  -- 7) `WR-22`: المرشَّحُ يُحرَّرُ في المعاملةِ نفسِها (لا ينتظرُ `expire_order_candidates`)،
  --    و`release_order_candidate` يكتبُ أثرَه ويودعُ إشعارَه الوحيدَ بمفتاحِ العرضِ.
  if v_candidate is not null then
    v_released := release_order_candidate(p_order_id, 'CANCELLED');
    if coalesce((v_released->>'released')::boolean, false) then
      v_queued := v_queued + 1;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'city_id', v_order.city_id,
    'service', v_order.service,
    'previous_status', v_order.status,
    'pickup_label', v_order.pickup_label,
    'dropoff_label', v_order.dropoff_label,
    'created_at', v_order.created_at,
    'offer_drivers', v_offers,
    'assigned_driver', coalesce(v_assigned, 'null'::jsonb),
    'group_cards', v_negot,
    'notifications_queued', v_queued,
    'candidate_released', v_candidate is not null
  );
end;
$$;

comment on function cancel_order_by_rider(uuid, uuid, text) is
  'إلغاء ذرّي يُلغي العروض ويُغلق التفاوض ويُحرّر مرشَّح اختيار الراكب ويكتب في السجل ويُودِع إخطار السائقين في صندوق الصادر (WR-22).';

revoke all on function cancel_order_by_rider(uuid, uuid, text) from public;
grant execute on function cancel_order_by_rider(uuid, uuid, text) to service_role;

