-- migration-phase: contract
-- =============================================================================
-- `WR-09` — الراكبُ يختارُ السائقَ خلالَ مهلةٍ يحكمُها الخادم (ADR 0266).
--
-- **المسألةُ:** أوّلُ سائقٍ يضغطُ «قبول» يصيرُ مُسنَدًا فورًا، ولا يرى الراكبُ من
-- قبِلَ ولا يملكُ أن يرفضَه قبلَ أن تُفتَحَ المحادثة.
--
-- **التصميمُ (متوافقٌ مع الإصدارِ السابقِ):**
--   ١) الطلبُ يبقى `searching` طوالَ الانتظار — فكلُّ مستهلكٍ قديمٍ يقرؤه كما كان.
--      والمرشَّحُ في ثلاثةِ أعمدةٍ على `orders` (`candidate_driver_id`،
--      `candidate_offer_id`، `candidate_expires_at`). الموعدُ من ساعةِ القاعدةِ وحدَها.
--   ٢) `claim_ride` لا يُسنِدُ حينَ `rider_choice_window_seconds > 0` في المدينة: يحجزُ
--      المرشَّحَ، ويمدُّ صلاحيّةَ عرضِه إلى الموعد، ويودعُ إشعارَ الراكبِ في المعاملةِ
--      نفسِها، ويُرجِعُ `pending_rider`. والسائقُ الآخرُ يُرَدُّ بـ`ORDER_HELD` وعرضُه
--      باقٍ. والإعدادُ صفرٌ في هذه الهجرة، فلا يتغيّرُ سلوكٌ حتى تُنشَرَ البوّابةُ
--      الجديدةُ ثمَّ تُفعِّلَه هجرةٌ تالية.
--   ٣) `rider_decide_candidate`: قبولٌ ⇒ إسنادٌ ذرّيٌّ بمنطقِ `claim_ride` حرفًا
--      (قبولُ العرضِ، وإلغاءُ المنافسين، و`matched`)؛ رفضٌ ⇒ عرضُ المرشَّحِ `rejected`
--      فيُستبعَدُ من الجولاتِ التالية (`driversToExclude`)، ويستمرُّ البحث.
--   ٤) `expire_order_candidates`: ما فاتَ موعدُه أو أُلغيَ طلبُه يُحرَّر ويُخطَرُ سائقُه.
--      والانتهاءُ يُحكَمُ كسولًا في كلِّ دالّةٍ أيضًا، فتأخّرُ العاملِ لا يمدُّ المهلة.
--   ٥) نوعُ صادرٍ جديدٌ `driver_candidate_notice` (رتبةٌ ١) لمآلِ المرشَّحِ عندَ السائق،
--      وإشعارُ الراكبِ `rider_trip_notice` بحدثِ `CANDIDATE` ومفتاحٍ لكلِّ عرض.
--
-- الرجوعُ: `rider_choice_window_seconds = 0` يُعيدُ السلوكَ القديمَ فورًا بلا نشر.
-- =============================================================================

-- ١) الأعمدة.
alter table orders add column if not exists candidate_driver_id uuid references drivers(id);
alter table orders add column if not exists candidate_offer_id uuid references order_offers(id);
alter table orders add column if not exists candidate_expires_at timestamptz;

comment on column orders.candidate_driver_id is
  'WR-09: سائقٌ قبِلَ والراكبُ لم يقرّر بعد. الطلبُ يبقى searching؛ والمرشَّحُ حيٌّ ما دام candidate_expires_at > now().';
comment on column orders.candidate_offer_id is
  'WR-09: عرضُ المرشَّحِ الذي يُقبَلُ أو يُرفَضُ بقرارِ الراكب.';
comment on column orders.candidate_expires_at is
  'WR-09: موعدُ قرارِ الراكبِ من ساعةِ القاعدة (rider_choice_window_seconds).';

-- الفهرسُ الجزئيُّ لشوطِ التحرير في `20261012140200` (طورُ فهرسٍ بلا معاملة، CAP-007).

-- ٢) الإعداد — صفرٌ = معطَّلٌ (السلوكُ القديم).
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, 'rider_choice_window_seconds', '0'::jsonb, 'number',
       'WR-09: ثواني قرارِ الراكبِ بعدَ قبولِ السائق. 0 ⇒ الإسنادُ فوريٌّ كما كان.', false
  from cities c
on conflict (city_id, key) do nothing;

create or replace function rider_choice_window_seconds(p_city_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, least(120, coalesce(
    (select (ps.value #>> '{}')::integer
       from platform_settings ps
      where ps.city_id = p_city_id and ps.key = 'rider_choice_window_seconds'),
    0)));
$$;
revoke all on function rider_choice_window_seconds(uuid) from public, anon, authenticated;
grant execute on function rider_choice_window_seconds(uuid) to service_role;

-- ٣) نوعُ الصادرِ الجديد.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice'
  )) not valid;

create or replace function notification_kind_priority(p_kind text)
returns smallint
language sql
immutable
set search_path = public
as $$
  select case p_kind
    -- ١ = حرجٌ: استغاثةٌ، وحالةُ رحلةٍ نشطةٍ، ومطالبةُ إسنادٍ لها مؤقّتٌ يجري.
    when 'safety_incident' then 1
    when 'order_cancelled' then 1
    when 'negotiation_turn_opened' then 1
    when 'negotiation_turn_closed' then 1
    when 'negotiation_agreed' then 1
    -- `WR-15` — إشعارُ طورِ الرحلةِ للراكبِ (قبول، وصول، بدء، إكمال): حالةُ رحلةٍ نشطةٍ.
    when 'rider_trip_notice' then 1
    -- `WR-09` — مآلُ المرشَّحِ عندَ السائق: له مؤقّتٌ يجري (قرارُ الراكب).
    when 'driver_candidate_notice' then 1
    -- ٢ = مرتفعٌ: تسليمُ العروضِ وتوسيعُ الدائرةِ — خطواتُ الإسنادِ نفسِه.
    when 'offer' then 2
    when 'wider_circle_opened' then 2
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    when 'lost_item_report' then 3
    when 'safety_resolution_closed' then 3
    when 'safety_resolution_blocked' then 3
    -- ٤ = منخفضٌ: البثُّ الجماعيُّ.
    when 'broadcast_recipient' then 4
    -- المجهولُ **حرجٌ** لا منخفضٌ (حاجزُ `scripts/check-traffic-priority.ts`).
    else 1
  end::smallint;
$$;
revoke all on function notification_kind_priority(text) from public, anon, authenticated;
grant execute on function notification_kind_priority(text) to service_role;

insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
  from cities c
  cross join (values
    ('driver_candidate_notice', 'مآلُ قبولِ السائقِ بعدَ قرارِ الراكب: اختارَك، أو لم يختَرْك، أو انتهت المهلة')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;

-- ٤) إيداعُ إشعارِ السائق (داخليّ: يُنادى من دوالِّ هذا الملفِّ وحدَها).
create or replace function enqueue_driver_candidate_notice(
  p_order_id uuid, p_offer_id uuid, p_driver_id uuid, p_outcome text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_city uuid;
  v_user uuid;
begin
  select o.city_id into v_city from orders o where o.id = p_order_id;
  select d.user_id into v_user from drivers d where d.id = p_driver_id;
  if v_city is null or v_user is null then return; end if;
  insert into notification_outbox (city_id, kind, order_id, driver_id, recipient_user_id, payload, dedup_key)
  values (
    v_city, 'driver_candidate_notice', p_order_id, p_driver_id, v_user,
    jsonb_build_object('order_id', p_order_id, 'offer_id', p_offer_id,
                       'driver_id', p_driver_id, 'outcome', p_outcome),
    'driver_candidate:' || p_offer_id::text
  )
  on conflict (kind, dedup_key) do nothing;
end $$;
revoke all on function enqueue_driver_candidate_notice(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- ٥) تحريرُ المرشَّحِ (داخليّ). يُنادى والطلبُ مقفلٌ عندَ المُنادي.
--    `DECLINED`/`EXPIRED` ⇒ عرضُه `rejected` (يُستبعَدُ من الجولاتِ التالية).
--    `CANCELLED` ⇒ الطلبُ أُلغيَ أثناءَ الانتظار؛ العرضُ ألغاه مسارُ الإلغاء.
create or replace function release_order_candidate(p_order_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_user uuid;
begin
  select * into v_order from orders where id = p_order_id;
  if v_order.candidate_driver_id is null then
    return jsonb_build_object('released', false);
  end if;

  if p_outcome in ('DECLINED', 'EXPIRED') then
    update order_offers
       set status = 'rejected', responded_at = now(), updated_at = now()
     where id = v_order.candidate_offer_id and status = 'pending';
  end if;

  update orders
     set candidate_driver_id = null, candidate_offer_id = null,
         candidate_expires_at = null, updated_at = now()
   where id = p_order_id;

  select d.user_id into v_user from drivers d where d.id = v_order.candidate_driver_id;
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_user, 'order.candidate_released', 'order', p_order_id,
          jsonb_build_object('driver_id', v_order.candidate_driver_id,
                             'offer_id', v_order.candidate_offer_id,
                             'outcome', p_outcome));

  perform enqueue_driver_candidate_notice(
    p_order_id, v_order.candidate_offer_id, v_order.candidate_driver_id, p_outcome);

  return jsonb_build_object('released', true,
                            'driver_id', v_order.candidate_driver_id,
                            'offer_id', v_order.candidate_offer_id);
end $$;
revoke all on function release_order_candidate(uuid, text) from public, anon, authenticated;

-- ٦) `claim_ride` — الصورةُ السابقةُ (`20261012130000`) حرفًا، ويُضافُ فرعُ المرشَّحِ
--    بعدَ التحقّقِ من العرضِ والمدينةِ وقبلَ أيِّ كتابة.
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

  select * into v_driver from drivers where id = p_driver_id;
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
$$;
revoke all on function claim_ride(uuid, uuid) from public, anon, authenticated;
grant execute on function claim_ride(uuid, uuid) to service_role;

-- ٧) قراءةُ المرشَّحِ للراكب — الهويّةُ من الجلسة، والطرفُ الثالثُ لا يرى شيئًا.
create or replace function rider_order_candidate(p_telegram_id bigint, p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_row record;
begin
  select o.* into v_order
    from orders o
    join riders r on r.id = o.rider_id
    join users u on u.id = r.user_id
   where o.id = p_order_id and u.telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  if v_order.status <> 'searching'
     or v_order.candidate_driver_id is null
     or v_order.candidate_expires_at <= now() then
    return jsonb_build_object('ok', true, 'order_status', v_order.status::text,
                              'server_time', now(), 'candidate', null);
  end if;

  select du.full_name, d.plate_number, d.vehicle_type::text as vehicle,
         d.rating_average, d.rating_count, oo.distance_km
    into v_row
    from drivers d
    join users du on du.id = d.user_id
    left join order_offers oo on oo.id = v_order.candidate_offer_id
   where d.id = v_order.candidate_driver_id;

  return jsonb_build_object(
    'ok', true, 'order_status', v_order.status::text, 'server_time', now(),
    'candidate', jsonb_build_object(
      'driver_id', v_order.candidate_driver_id,
      'driver_name', v_row.full_name,
      'plate', v_row.plate_number,
      'vehicle', v_row.vehicle,
      'rating_average', v_row.rating_average,
      'rating_count', coalesce(v_row.rating_count, 0),
      'distance_km', v_row.distance_km,
      'expires_at', v_order.candidate_expires_at,
      'seconds_left', greatest(0, ceil(extract(epoch from v_order.candidate_expires_at - now())))::integer
    ));
end $$;
revoke all on function rider_order_candidate(bigint, uuid) from public, anon, authenticated;
grant execute on function rider_order_candidate(bigint, uuid) to service_role;

-- ٨) قرارُ الراكب. `p_driver_id` يُثبِتُ أنَّ القرارَ على المرشَّحِ المعروضِ لا على
--    غيرِه، فالنقرةُ المتأخّرةُ بعدَ تبدّلِ المرشَّحِ تُرَدُّ ولا تُصيبُ سواه.
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

-- ٩) شوطُ العامل: يحرّرُ ما فاتَ موعدُه، وما أُلغيَ طلبُه أثناءَ الانتظار.
create or replace function expire_order_candidates(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_expired integer := 0;
  v_cancelled integer := 0;
begin
  for v_row in
    select o.id, o.status
      from orders o
     where o.candidate_driver_id is not null
       and (o.candidate_expires_at <= now() or o.status <> 'searching')
     order by o.candidate_expires_at
     limit greatest(1, p_limit)
       for update skip locked
  loop
    if v_row.status = 'searching' then
      perform release_order_candidate(v_row.id, 'EXPIRED');
      v_expired := v_expired + 1;
    else
      perform release_order_candidate(v_row.id, 'CANCELLED');
      v_cancelled := v_cancelled + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'expired', v_expired, 'cancelled', v_cancelled);
end $$;
revoke all on function expire_order_candidates(integer) from public, anon, authenticated;
grant execute on function expire_order_candidates(integer) to service_role;

-- ١٠) قبولُ Mini App يمرّرُ حالَ الانتظار. الصورةُ السابقةُ حرفًا عدا المردّ.
create or replace function driver_accept_offer(
  p_telegram_id bigint,
  p_offer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_driver drivers%rowtype;
  v_offer order_offers%rowtype;
  v_claim jsonb;
begin
  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_driver from drivers where user_id = v_user.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_A_DRIVER');
  end if;

  select * into v_offer
    from order_offers
   where id = p_offer_id and driver_id = v_driver.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_FOUND');
  end if;

  v_claim := claim_ride(v_offer.order_id, v_driver.id);

  if coalesce((v_claim->>'ok')::boolean, false) then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_claim->>'order_id',
      'matched_at', v_claim->>'matched_at',
      'pending_rider', coalesce((v_claim->>'pending_rider')::boolean, false),
      'expires_at', v_claim->>'expires_at'
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', coalesce(v_claim->>'error', 'CLAIM_REFUSED')
  );
end;
$$;
revoke all on function driver_accept_offer(bigint, uuid) from public, anon, authenticated;
grant execute on function driver_accept_offer(bigint, uuid) to service_role;

-- ١١) المُطالِب: صورةُ `20261012120000` حرفًا، ويُضافُ `driver_candidate_notice` إلى أنواعِ
--     دورةِ الرحلة (بترتيبِ الطلب)، ومحادثةُ السائقِ تُقرأُ حيّةً كفرعِ `lost_item_report`.
create or replace function claim_notification_delivery()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery notification_outbox%rowtype;
  v_token uuid := gen_random_uuid();
  v_max integer;
  v_payload jsonb;
  v_owner_telegram bigint;
  v_owner_language text;
  v_owner_kind text;
  v_resolution text;
  v_claim record;
  v_rider record;
  v_driver record;
  v_batch_limit integer;
  v_concurrency integer;
  v_claimed bigint;
  v_ride_kinds text[] := array[
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found', 'order_cancelled',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice'
  ];
  v_chat_id text;
  v_undeliverable_reason text;
begin
  update notification_outbox n
     set status = 'pending', claim_token = null, claimed_at = null, next_attempt_at = now()
   where n.status = 'sending'
     and n.kind = any(v_ride_kinds)
     and n.claimed_at is not null
     and n.claimed_at < now() - make_interval(secs => coalesce(
           (select greatest(1, (ps.value #>> '{}')::integer)
              from platform_settings ps
             where ps.city_id = n.city_id
               and ps.key = 'notification_claim_timeout_seconds'),
           300));

  select n.* into v_delivery from notification_outbox n
   where n.status = 'pending' and n.next_attempt_at <= now()
     and n.kind = any(v_ride_kinds)
     and not exists (
       select 1 from notification_outbox o
        where o.order_id = n.order_id
          and o.status = 'pending'
          and o.kind = any(v_ride_kinds)
          and o.next_attempt_at <= now()
          and (o.created_at, o.id) < (n.created_at, n.id)
     )
   order by notification_kind_priority(n.kind), n.created_at
   for update skip locked limit 1;
  if not found then return jsonb_build_object('ok', true, 'delivery', null); end if;

  v_concurrency := queue_limit_or_null(v_delivery.city_id, 'outbox_queue_consumer_concurrency');
  select count(*) into v_claimed from notification_outbox n
   where n.city_id = v_delivery.city_id and n.status = 'sending';

  if v_concurrency is null or v_concurrency <= 0 or coalesce(v_claimed, 0) >= v_concurrency then
    perform record_queue_backpressure_event(
      v_delivery.city_id, 'notification_outbox', 'CONSUMER_CONCURRENCY',
      jsonb_build_object('claimed', v_claimed, 'consumer_concurrency', v_concurrency)
    );
    return jsonb_build_object(
      'ok', true, 'delivery', null, 'backpressure', 'CONSUMER_CONCURRENCY',
      'claimed', coalesce(v_claimed, 0), 'consumer_concurrency', v_concurrency
    );
  end if;

  select greatest(1, (value #>> '{}')::integer) into v_max from platform_settings
    where city_id = v_delivery.city_id and key = 'notification_delivery_max_attempts';
  if v_max is null then v_max := 3; end if;

  v_batch_limit := greatest(1, v_concurrency);

  update notification_outbox set status = 'sending', attempts = attempts + 1,
         claim_token = v_token, claimed_at = now()
   where id = v_delivery.id;

  if v_delivery.kind = 'offer' then
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text
           )
      into v_payload
      from order_offers o where o.id = v_delivery.offer_id;
  elsif v_delivery.kind = 'dispute_resolution' then
    select u.telegram_id, u.language_code,
           case when tk.driver_id is not null then 'driver' else 'rider' end,
           tk.resolution
      into v_owner_telegram, v_owner_language, v_owner_kind, v_resolution
      from support_tickets tk
      left join drivers d on d.id = tk.driver_id
      left join riders r on r.id = tk.rider_id
      join users u on u.id = coalesce(d.user_id, r.user_id)
     where tk.id = (v_delivery.payload->>'ticket_id')::uuid;
    v_payload := v_delivery.payload || jsonb_build_object(
      'owner_telegram_id', v_owner_telegram::text,
      'owner_language', coalesce(v_owner_language, 'ar'),
      'owner_kind', v_owner_kind,
      'resolution', v_resolution
    );
  elsif v_delivery.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    select c.negotiation_id, c.order_id, c.position,
           du.telegram_id::text as driver_chat_id, du.language_code as driver_language,
           ru.telegram_id::text as rider_chat_id, ru.language_code as rider_language,
           get_setting_number(c.city_id, 'unsubscribed_negotiate_seconds')::integer as seconds
      into v_claim
      from unsubscribed_claims c
      join drivers d on d.id = c.driver_id
      join users du on du.id = d.user_id
      join orders o on o.id = c.order_id
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where c.id = (v_delivery.payload->>'claim_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'negotiation_id', v_claim.negotiation_id,
      'order_id', v_claim.order_id,
      'position', v_claim.position,
      'deadline_seconds', v_claim.seconds,
      'chat_id', case when v_delivery.payload->>'side' = 'driver'
                      then v_claim.driver_chat_id else v_claim.rider_chat_id end,
      'language', coalesce(
        case when v_delivery.payload->>'side' = 'driver'
             then v_claim.driver_language else v_claim.rider_language end,
        'ar'
      )
    );
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found', 'rider_trip_notice') then
    select ru.telegram_id::text as chat_id, ru.language_code as language,
           o.service::text     as service
      into v_rider
      from orders o
      join riders r on r.id = o.rider_id
      join users ru on ru.id = r.user_id
     where o.id = (v_delivery.payload->>'order_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar'),
      'service', v_rider.service
    );
  elsif v_delivery.kind = 'order_cancelled' then
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  elsif v_delivery.kind in ('lost_item_report', 'driver_candidate_notice') then
    select du.telegram_id::text as chat_id, du.language_code as language
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar')
    );
  elsif v_delivery.kind in ('safety_resolution_closed', 'safety_resolution_blocked') then
    -- `PD-021` — إشعارُ مآلٍ عامٌّ للمُبلِّغِ. محادثتُهُ ولغتُهُ كما هما في
    -- القاعدةِ لحظةَ الالتقاطِ، والحمولةُ تَحملُ القرارَ لا السببَ الداخليَّ.
    select ru.telegram_id::text as chat_id, ru.language_code as language
      into v_rider
      from safety_incidents si
      join users ru on ru.id = si.reporter_user_id
     where si.id = (v_delivery.payload->>'incident_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_rider.chat_id,
      'language', coalesce(v_rider.language, 'ar')
    );
  else
    v_payload := v_delivery.payload;
  end if;

  -- ---------------------------------------------------------------------------
  -- `SEC-19-ب-٣` — حرسُ العنوانِ الغائبِ
  --
  -- بعدَ حلِّ العنوانِ وقبلَ الإرجاعِ: إذا كانَ العنوانُ غائبًا، يُعلَنُ الصفُّ
  -- `undeliverable` بـ`died_at` وسببٍ مُسمّىً، ويُعادُ `delivery: null`.
  --
  -- والفرعُ `offer` لا يُفحَصُ ههنا — عنوانُهُ في TypeScript (الخطوةُ الرابعة).
  -- ---------------------------------------------------------------------------

  if v_delivery.kind = 'dispute_resolution' then
    v_chat_id := v_owner_telegram::text;
  elsif v_delivery.kind in (
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed'
  ) then
    v_chat_id := case when v_delivery.payload->>'side' = 'driver'
                      then v_claim.driver_chat_id else v_claim.rider_chat_id end;
  elsif v_delivery.kind in ('wider_circle_opened', 'no_driver_found', 'rider_trip_notice') then
    v_chat_id := v_rider.chat_id;
  elsif v_delivery.kind in ('order_cancelled', 'lost_item_report', 'driver_candidate_notice') then
    v_chat_id := v_driver.chat_id;
  elsif v_delivery.kind in ('safety_resolution_closed', 'safety_resolution_blocked') then
    v_chat_id := v_rider.chat_id;
  else
    v_chat_id := null;
  end if;

  if v_chat_id is null and v_delivery.kind in (
    'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice'
  ) and (
    -- الحرسُ يقعُ فقطَ حينَ يَحملُ الحمولةُ المعرِّفَ المطلوبَ: فالكيانُ كانَ
    -- مُستهدَفاً لكنَّهُ تعذَّرَ الوصولُ إليه. أمّا الحمولةُ الفارغةُ فعيبُ بياناتٍ
    -- لا عجزَ تسليمٍ، فيُترَكُ للسلوكِ القائمِ (إرجاعٌ بـ`chat_id` غائبةٍ).
    (v_delivery.kind = 'dispute_resolution' and v_delivery.payload->>'ticket_id' is not null)
    or (v_delivery.kind in ('negotiation_turn_opened','negotiation_turn_closed','negotiation_agreed') and v_delivery.payload->>'claim_id' is not null)
    or (v_delivery.kind in ('wider_circle_opened','no_driver_found','rider_trip_notice') and v_delivery.payload->>'order_id' is not null)
    or (v_delivery.kind in ('order_cancelled','lost_item_report','driver_candidate_notice') and v_delivery.payload->>'driver_id' is not null)
    or (v_delivery.kind in ('safety_resolution_closed','safety_resolution_blocked') and v_delivery.payload->>'incident_id' is not null)
  ) then
    if v_delivery.kind in (
      'wider_circle_opened', 'no_driver_found',
      'dispute_resolution', 'lost_item_report'
    ) then
      v_undeliverable_reason := 'TELEGRAM_DELIVERY_NOT_REQUIRED';
    else
      v_undeliverable_reason := 'TELEGRAM_DELIVERY_UNAVAILABLE';
    end if;

    update notification_outbox
       set status = 'undeliverable',
           died_at = now(),
           dead_reason = v_undeliverable_reason,
           claim_token = null,
           claimed_at = null
     where id = v_delivery.id;

    return jsonb_build_object(
      'ok', true, 'delivery', null,
      'undeliverable', v_delivery.id,
      'kind', v_delivery.kind,
      'reason', v_undeliverable_reason,
      'batch_limit', v_batch_limit
    );
  end if;

  return (
    select jsonb_build_object('ok', true, 'delivery', jsonb_build_object(
      'delivery_id', n.id, 'kind', n.kind, 'city_id', n.city_id,
      'claim_token', v_token, 'attempts', n.attempts, 'max_attempts', v_max,
      'batch_limit', v_batch_limit,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $$;

-- `create or replace` يُعيدُ منحَ التنفيذِ ضمنيّاً — فنزعُهُ واجبٌ.
revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;
