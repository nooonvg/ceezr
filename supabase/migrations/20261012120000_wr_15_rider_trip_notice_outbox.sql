-- migration-phase: contract
-- =============================================================================
-- `WR-15` — إشعاراتُ أطوارِ الرحلةِ للراكبِ في صندوقِ الصادرِ الموحَّد.
--
-- **المسألةُ:** إشعاراتُ القبولِ والوصولِ والبدءِ والإكمالِ كانت تُرسَلُ من مسارِ
-- طلبِ السائقِ مباشرةً بعدَ الانتقالِ. سقوطُ الإرسالِ (تيليجرام، أو انقطاعُ العمليّةِ)
-- كان يُفقِدُ الإشعارَ، ولا إعادةَ بعدَ مهلةِ `withOutboundResilience`، ولا أثرَ في القاعدة.
--
-- **العلاجُ:**
--   ١) نوعٌ جديدٌ `rider_trip_notice` في قيدِ `notification_outbox_kind_check`
--      (مجموعةٌ فائقةٌ، `not valid`، والتوثيقُ في هجرةٍ تاليةٍ).
--   ٢) رتبتُه ١ (حرجٌ): حالةُ رحلةٍ نشطةٍ.
--   ٣) سياستُه `critical` لكلِّ مدينةٍ.
--   ٤) `enqueue_rider_trip_notice(order, event)`: صفٌّ واحدٌ لكلِّ طلبٍ وطورٍ بمفتاحِ
--      منعِ التكرارِ `rider_trip:<order>:<event>` على الفهرسِ الفريدِ القائمِ
--      `notification_outbox_dedup_uidx (kind, dedup_key)`. والمستقبِلُ مُعلَنٌ صراحةً
--      (`recipient_user_id`) فلا حاجةَ لتعديلِ `resolve_notification_recipient`.
--   ٥) `claim_notification_delivery()`: النوعُ في `v_ride_kinds` (يُلتقَطُ بترتيبِ
--      الطلبِ السببيِّ، فلا يسبقُ «الوصولُ» «القبولَ»)، ومحادثةُ الراكبِ ولغتُه تُقرآنِ
--      حيّتينِ لحظةَ الالتقاطِ كفرعِ `wider_circle_opened`، والراكبُ بلا محادثةٍ
--      يُعلَنُ `undeliverable` بـ`TELEGRAM_DELIVERY_UNAVAILABLE`. وبقيّةُ الدالّةِ منسوخةٌ
--      حرفاً عن `20260925170000_d_37_claim_timeout_per_row_city.sql`.
--
-- **ولا يُدَّعى:** `delivered` في هذا الجدولِ يعني أنَّ Telegram API قبِلَ الرسالةَ
-- وأعادَ معرّفَها، لا أنَّها ظهرت على هاتفِ الراكب. (ADR 0265)
-- =============================================================================

-- ١) توسيعُ القيد.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice'
  )) not valid;

-- ٢) رتبةُ المرور. بقيّةُ الفروعِ منسوخةٌ حرفاً عن `20260921000001_pd_021_contract.sql`.
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
    -- ٢ = مرتفعٌ: تسليمُ العروضِ وتوسيعُ الدائرةِ — خطواتُ الإسنادِ نفسِه.
    when 'offer' then 2
    when 'wider_circle_opened' then 2
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ. وإشعارُ مآلِ
    --    السلامةِ تحديثٌ ذو قيمةٍ زمنيّةٍ، لكنَّهُ ليسَ في تتابعٍ سببيٍّ مع دورةِ
    --    الرحلةِ ولا مؤقّتَ يستهلكُه التأخيرُ — فهو متوسّطٌ لا مرتفعٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    when 'lost_item_report' then 3
    when 'safety_resolution_closed' then 3
    when 'safety_resolution_blocked' then 3
    -- ٤ = منخفضٌ: البثُّ الجماعيُّ.
    when 'broadcast_recipient' then 4
    -- المجهولُ **حرجٌ** لا منخفضٌ: نوعٌ جديدٌ نُسيَ تصنيفُه يُقدَّمُ لا يُؤخَّرُ،
    -- وسهوُه يُكشَفُ في CI بحاجزِ `scripts/check-traffic-priority.ts` لا في حادثةٍ.
    else 1
  end::smallint;
$$;

revoke all on function notification_kind_priority(text) from public, anon, authenticated;
grant execute on function notification_kind_priority(text) to service_role;

-- ٣) السياسة.
insert into notification_kind_policy (city_id, kind, channel, description_ar)
select c.id, k.kind, 'critical', k.description_ar
  from cities c
  cross join (values
    ('rider_trip_notice', 'إشعارُ طورِ الرحلةِ للراكبِ: قبولٌ أو وصولٌ أو بدءٌ أو إكمال')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;

-- ٤) الإيداع.
create or replace function enqueue_rider_trip_notice(p_order_id uuid, p_event text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_id uuid;
begin
  if p_event is null or p_event not in ('MATCHED', 'ARRIVED', 'STARTED', 'COMPLETED') then
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
end $$;

revoke all on function enqueue_rider_trip_notice(uuid, text) from public, anon, authenticated;
grant execute on function enqueue_rider_trip_notice(uuid, text) to service_role;

-- ٥) المُطالِب.
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
    'rider_trip_notice'
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
  elsif v_delivery.kind = 'lost_item_report' then
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
  elsif v_delivery.kind in ('order_cancelled', 'lost_item_report') then
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
    'rider_trip_notice'
  ) and (
    -- الحرسُ يقعُ فقطَ حينَ يَحملُ الحمولةُ المعرِّفَ المطلوبَ: فالكيانُ كانَ
    -- مُستهدَفاً لكنَّهُ تعذَّرَ الوصولُ إليه. أمّا الحمولةُ الفارغةُ فعيبُ بياناتٍ
    -- لا عجزَ تسليمٍ، فيُترَكُ للسلوكِ القائمِ (إرجاعٌ بـ`chat_id` غائبةٍ).
    (v_delivery.kind = 'dispute_resolution' and v_delivery.payload->>'ticket_id' is not null)
    or (v_delivery.kind in ('negotiation_turn_opened','negotiation_turn_closed','negotiation_agreed') and v_delivery.payload->>'claim_id' is not null)
    or (v_delivery.kind in ('wider_circle_opened','no_driver_found','rider_trip_notice') and v_delivery.payload->>'order_id' is not null)
    or (v_delivery.kind in ('order_cancelled','lost_item_report') and v_delivery.payload->>'driver_id' is not null)
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
