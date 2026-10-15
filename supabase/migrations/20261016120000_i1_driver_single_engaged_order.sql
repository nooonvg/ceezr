-- migration-phase: expand

-- `I1` · `ADR 0286` — سائقٌ واحدٌ لا يحملُ التزامًا (طلبَ matched/in_progress) ثانًا:
--   الضمانُ على مستوى القاعدةِ والمسارِ الذرّيِّ للإسنادِ، لا على واجهةِ Mini App
--   وحدها ولا بفحصٍ مسبقٍ قابلٍ لحدوثِ سباقٍ. ثلاثُ طبقاتٍ في ترحيلةٍ واحدةٍ:
--
--   ١) تحققٌ لا إتلافَ: مخالفةٌ قائمةٌ قبلَ الفهرسِ تُوقفُ الترحيلةَ بسببٍ مسمّى — لا
--      تُحذفْ بياناتٌ ولا تُصحَّحْ صامتًا (بياناتُ الإنتاجِ مسؤوليّةُ صاحبِها).
--   ٢) فهرسٌ جزئيٌّ فريدٌ (الملفُّ اللاحقُ `20261016120100`): حائطُ القاعدةِ
--      الأخيرُ — أيُّ إسنادٍ ثانٍ متزامنٍ يسقطُ بخطأِ تفرُّدٍ صريحٍ مهما أفلتَ منَ
--      الحارسِ في الدوالِّ أو أُضيفَ مسارٌ مستقبلًا.
--   ٣) حارسٌ في كلِّ كاتبِ إسنادٍ قائمٍ (`claim_ride` · `rider_decide_candidate` ·
--      `settle_unsubscribed_negotiation`): قفلُ صفِّ السائقِ ثمَّ الفحصُ داخلَ القفلِ
--      فردَّ DRIVER_HAS_ACTIVE_ORDER نظيفًا — فالخطأُ المقصودُ خيرٌ منَ الاصطدامِ
--      بالفهرسِ خامًا.
--
--   والكاتبُ `rider_decide_candidate` كانَ يسندُ بلا حارسٍ، والمطالبةُ المتزامنةُ
--   للسائقِ نفسِهِ على طلبَينِ مختلفَينِ كانت تمرُّ لأنَّ القفلَ على صفِّ الطلبِ لا
--   يمنعُ أخاهُ — وهذا ما رصدتِهِ جولةُ `CAP-RUN-20261015` (I1).

-- ١) التحققُ اللا إتلافيُّ منَ البياناتِ القائمةِ قبلَ بناءِ الفهرسِ.
do $$
declare
  v_offenders integer;
begin
  select count(*) into v_offenders from (
    select assigned_driver_id
      from orders
     where assigned_driver_id is not null
       and is_driver_engaged_order_status(status)
     group by assigned_driver_id
    having count(*) > 1
  ) as duplicates;
  if v_offenders > 0 then
    raise exception 'I1_VIOLATIONS_EXIST: % سائقًا يحملون التزامًا أكثر من واحد — صحّح البيانات أولًا (لا يُحذف شيء آليًا هنا)', v_offenders
      using hint = 'حدّد المخالفين بـ: select assigned_driver_id, count(*) from orders where assigned_driver_id is not null and is_driver_engaged_order_status(status) group by 1 having count(*) > 1;';
  end if;
end
$$;

-- ٢) الفهرسُ الجزئيُّ الفريدُ (`orders_one_engaged_order_per_driver`) في ملفٍّ
--    لاحقٍ وحدَهُ (`20261016120100`) بطورِ `index` — لأنَّ `create index concurrently`
--    لا يُقبَلُ داخلَ معاملةٍ، وهذا الملفُّ معاملةٌ واحدةٌ.

-- ٣) الحارسُ في الكتّابِ الثلاثةِ — كلُّ دالّةٍ بنصِّها الكاملِ كما في آخرِ تعريفٍ
--    لها، والمضافُ إليها قفلُ صفِّ السائقِ والفحصُ داخلَه.

create or replace function claim_ride(p_order_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  -- `I1` (`ADR 0286`): سائقٌ واحدٌ لا يحملُ التزامًا ثانٍ — القفلُ على صفِّ السائقِ
  -- والفحصُ داخلَه، فلا نافذةَ سباقٍ بينَ فحصٍ وكتابةٍ. والفهرسُ الجزئيُّ الفريدُ
  -- في هذه الترحيلةِ حائطُ القاعدةِ الأخيرُ إن أفلتَ أيُّ مسارٍ منَ الحارسِ.
  if exists (
    select 1 from orders o
     where o.assigned_driver_id = p_driver_id
       and o.id <> p_order_id
       and is_driver_engaged_order_status(o.status)
  ) then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_HAS_ACTIVE_ORDER');
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
$$;

revoke all on function claim_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_ride(uuid, uuid) to service_role;

create or replace function rider_decide_candidate(
  p_telegram_id bigint, p_order_id uuid, p_driver_id uuid, p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_offer order_offers%rowtype;
  v_driver drivers%rowtype;
  v_rider_user uuid;
  v_now timestamptz := now();
begin
  select o.* into v_order
    from orders o
    join riders r on r.id = o.rider_id
    join users u on u.id = r.user_id
   where o.id = p_order_id and u.telegram_id = p_telegram_id
     for update of o;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  select r.user_id into v_rider_user from riders r where r.id = v_order.rider_id;

  -- إعادةُ القبولِ نفسِه بعدَ نجاحِه: نجاحٌ بلا أثرٍ ثانٍ.
  if p_accept and v_order.assigned_driver_id = p_driver_id
     and is_driver_engaged_order_status(v_order.status) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'decision', 'accepted',
                              'order_id', p_order_id, 'matched_at', v_order.matched_at);
  end if;

  if v_order.status <> 'searching' then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_SEARCHING',
                              'status', v_order.status::text);
  end if;

  if v_order.candidate_driver_id is distinct from p_driver_id then
    -- إعادةُ الرفضِ نفسِه بعدَ نجاحِه.
    if not p_accept and exists (
      select 1 from order_offers
       where order_id = p_order_id and driver_id = p_driver_id and status = 'rejected') then
      return jsonb_build_object('ok', true, 'duplicate', true, 'decision', 'rejected',
                                'order_id', p_order_id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_CHANGED');
  end if;

  if v_order.candidate_expires_at <= v_now then
    perform release_order_candidate(p_order_id, 'EXPIRED');
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_EXPIRED');
  end if;

  if not p_accept then
    perform release_order_candidate(p_order_id, 'DECLINED');
    return jsonb_build_object('ok', true, 'duplicate', false, 'decision', 'rejected',
                              'order_id', p_order_id);
  end if;

  select * into v_offer from order_offers
   where id = v_order.candidate_offer_id and status = 'pending'
     for update;
  if not found then
    perform release_order_candidate(p_order_id, 'EXPIRED');
    return jsonb_build_object('ok', false, 'error', 'CANDIDATE_EXPIRED');
  end if;

  -- الإسنادُ بمنطقِ `claim_ride` حرفًا.
  -- `I1` (`ADR 0286`): سائقٌ واحدٌ لا يحملُ التزامًا ثانٍ — القفلُ على صفِّ السائقِ
  -- والفحصُ داخلَه، فلا نافذةَ سباقٍ بينَ فحصٍ وكتابةٍ. والفهرسُ الجزئيُّ الفريدُ
  -- في هذه الترحيلةِ حائطُ القاعدةِ الأخيرُ إن أفلتَ أيُّ مسارٍ منَ الحارسِ.
  select * into v_driver from drivers where id = p_driver_id
    for update;
  if exists (
    select 1 from orders o
     where o.assigned_driver_id = p_driver_id
       and o.id <> p_order_id
       and is_driver_engaged_order_status(o.status)
  ) then
    perform release_order_candidate(p_order_id, 'DECLINED');
    return jsonb_build_object('ok', false, 'error', 'DRIVER_HAS_ACTIVE_ORDER');
  end if;

  update order_offers set status = 'accepted', responded_at = v_now where id = v_offer.id;
  update order_offers set status = 'cancelled', responded_at = v_now
   where order_id = p_order_id and id <> v_offer.id and status = 'pending';
  update orders
     set status = 'matched', assigned_driver_id = p_driver_id, matched_at = v_now,
         candidate_driver_id = null, candidate_offer_id = null, candidate_expires_at = null
   where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_rider_user, 'order.claimed', 'order', p_order_id,
          jsonb_build_object('driver_id', p_driver_id, 'offer_id', v_offer.id,
                             'round', v_offer.round, 'via', 'rider_choice'));

  perform enqueue_driver_candidate_notice(p_order_id, v_offer.id, p_driver_id, 'ACCEPTED');

  return jsonb_build_object('ok', true, 'duplicate', false, 'decision', 'accepted',
                            'order_id', p_order_id, 'matched_at', v_now);
end $$;

revoke all on function rider_decide_candidate(bigint, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function rider_decide_candidate(bigint, uuid, uuid, boolean) to service_role;

create or replace function settle_unsubscribed_negotiation(p_negotiation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_neg    unsubscribed_negotiations%rowtype;
  v_claim  unsubscribed_claims%rowtype;
  v_order  orders%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
  v_queued integer := 0;
begin
  select * into v_neg
    from unsubscribed_negotiations
   where id = p_negotiation_id
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NEGOTIATION_NOT_FOUND');
  end if;
  if v_neg.status <> 'negotiating' or v_neg.active_claim_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_NEGOTIATING');
  end if;

  select * into v_order
    from orders
   where id = v_neg.order_id and status = 'searching'
     for update skip locked;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  -- `WR-24`: مرشَّحٌ حيٌّ لقرارِ الراكبِ (`WR-09`) يحجزُ الطلبَ عن اتفاقِ القروبِ كما يحجزُه
  -- عن `claim_ride`، فلا يُسنَدُ الطلبُ لسائقٍ ومرشَّحٌ آخرُ قائمٌ على البطاقة. والفائتُ يُحرَّرُ
  -- كسولًا بإشعارِه الوحيدِ (`EXPIRED`) ثمَّ يُتابَعُ الاتفاق.
  if v_order.candidate_driver_id is not null then
    if v_order.candidate_expires_at > v_now then
      return jsonb_build_object('ok', false, 'error', 'ORDER_HELD',
                                'expires_at', v_order.candidate_expires_at);
    end if;
    perform release_order_candidate(v_order.id, 'EXPIRED');
  end if;

  select * into v_claim from unsubscribed_claims where id = v_neg.active_claim_id;
  select * into v_driver from drivers where id = v_claim.driver_id
    for update;

  -- `I1` (`ADR 0286`): سائقٌ واحدٌ لا يحملُ التزامًا ثانٍ — القفلُ على صفِّ السائقِ
  -- والفحصُ داخلَه، فلا نافذةَ سباقٍ بينَ فحصٍ وكتابةٍ. والفهرسُ الجزئيُّ الفريدُ
  -- في هذه الترحيلةِ حائطُ القاعدةِ الأخيرُ إن أفلتَ أيُّ مسارٍ منَ الحارسِ.
  if exists (
    select 1 from orders o
     where o.assigned_driver_id = v_claim.driver_id
       and o.id <> v_neg.order_id
       and is_driver_engaged_order_status(o.status)
  ) then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_HAS_ACTIVE_ORDER');
  end if;

  update unsubscribed_claims
     set outcome = 'agreed', closed_at = v_now
   where id = v_claim.id;

  -- من لم يصل دوره لا يبقى معلَّقاً: الاتفاق يُغلق الدورة كلّها
  update unsubscribed_claims
     set outcome = 'cancelled', closed_at = v_now
   where negotiation_id = p_negotiation_id and outcome = 'waiting';

  update unsubscribed_negotiations
     set status = 'agreed', settled_at = v_now, negotiate_deadline = null
   where id = p_negotiation_id;

  -- أي عرض معلَّق في المسار المشترك يُلغى: لا مسارا إسناد لطلب واحد
  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = v_neg.order_id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = v_claim.driver_id, matched_at = v_now
   where id = v_neg.order_id;

  v_queued := enqueue_negotiation_notification(
    v_neg.city_id, 'negotiation_agreed', v_claim.id
  );

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_neg.city_id, v_driver.user_id, 'unsubscribed.agreed', 'order', v_neg.order_id,
          jsonb_build_object('negotiation_id', p_negotiation_id, 'claim_id', v_claim.id,
                             'driver_id', v_claim.driver_id, 'position', v_claim.position,
                             'cycle', v_neg.cycle));

  return jsonb_build_object('ok', true, 'order_id', v_neg.order_id,
                            'notifications_queued', v_queued,
                            'driver_id', v_claim.driver_id, 'matched_at', v_now);
end;
$$;
