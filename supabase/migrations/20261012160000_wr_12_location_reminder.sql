-- migration-phase: contract
-- =============================================================================
-- `WR-12` — تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه كلَّ خمسِ دقائق (ADR 0268).
--
-- **المسألةُ:** حارسُ عمرِ الموقعِ في الإسنادِ (`driver_location_max_age_seconds`) مبذورٌ
-- صفرًا فمعطَّل، والتوافرُ يسقطُ بعدَ 180 دقيقةً من `changed_at` لا من آخرِ موقع. فسائقٌ
-- أغلقَ التطبيقَ يبقى «متوفّرًا» بموقعٍ قديمٍ ولا يعلمُ أحدٌ ذلك.
--
-- **القرار:**
--   ١) إعدادانِ لكلِّ مدينة: `driver_location_reminder_seconds` (300) و
--      `driver_location_reminder_max_count` (3). الصفرُ في الأوّلِ يُعطِّلُ التذكير.
--   ٢) `enqueue_driver_location_reminders(limit)`: لكلِّ سائقٍ موثَّقٍ متوفّرٍ في مدينةٍ
--      مفعّلةٍ، بلا رحلةٍ قائمة، آخرُ موقعٍ له (`last_location_recorded_at` وإلّا
--      `last_location_at`، **لا `changed_at`**) أقدمُ من المهلة، ومضت المهلةُ على تفعيلِه
--      التوافر، ولم يُذكَّر خلالَها، ولم يبلغ سقفَ التذكيراتِ منذُ آخرِ موقعٍ أو تفعيل
--      ⇒ صفُّ `driver_location_reminder` في صندوقِ الصادرِ بمفتاحِ دلوِ الزمن.
--   ٣) المُطالِبُ يقرأُ حالَ السائقِ **لحظةَ الإرسال** (`is_available` و`still_stale`
--      و`minutes`)، والمعالجُ يطوي ما لم يَعُد لازمًا.
--   ٤) حارسُ الإسنادِ نفسُه لا يُمَسُّ ههنا: يُفعَّلُ بعدَ النشرِ بإعدادِ
--      `driver_location_max_age_seconds = 600` (تغييرُ إعدادٍ لا هجرة، والعودةُ بصفر).
--
-- **التوافق:** المُطالِبُ منسوخٌ حرفًا عن `20261012150000` مع فرعِ النوعِ الجديد.
-- النسخةُ السابقةُ من الشيفرةِ لا تُنادي الإيداعَ ولا تعرفُ النوع.
-- =============================================================================

-- ١) النوعُ الجديد.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message',
    'driver_location_reminder'
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
    -- `WR-04` — تنبيهُ رسالةِ محادثةٍ جديدةٍ لطرفٍ خارجَ Mini App أثناءَ رحلةٍ قائمة.
    when 'order_chat_message' then 2
    -- ٣ = متوسّطٌ: أخبارُ نتيجةٍ وتحديثاتُ دعمٍ وإشعاراتٌ عاديّةٌ.
    when 'no_driver_found' then 3
    when 'dispute_resolution' then 3
    when 'subscription_notice' then 3
    when 'lost_item_report' then 3
    -- `WR-12` — تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه: إشعارٌ تشغيليٌّ عاديّ.
    when 'driver_location_reminder' then 3
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
    ('driver_location_reminder', 'تذكيرُ السائقِ المتوفّرِ بتحديثِ موقعِه حينَ يقدُمُ، بزرِّ التحديثِ وزرِّ «غير متوفر»')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;

-- ٢) الإعدادان.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, k.key, k.value::jsonb, 'number', k.description_ar, false
  from cities c
  cross join (values
    ('driver_location_reminder_seconds', '300',
     'WR-12: يُذكَّرُ السائقُ المتوفّرُ إن لم يصل منه موقعٌ خلالَ هذه الثواني، ومرّةً كلَّ مثلِها. 0 ⇒ لا تذكير.'),
    ('driver_location_reminder_max_count', '3',
     'WR-12: أقصى عددِ تذكيراتٍ متتاليةٍ بلا موقعٍ جديدٍ ولا إعادةِ تفعيلٍ للتوافر.')
  ) as k(key, value, description_ar)
on conflict (city_id, key) do nothing;

create or replace function driver_location_reminder_seconds(p_city_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, least(3600, coalesce(
    (select (ps.value #>> '{}')::integer
       from platform_settings ps
      where ps.city_id = p_city_id and ps.key = 'driver_location_reminder_seconds'),
    0)));
$$;
revoke all on function driver_location_reminder_seconds(uuid) from public, anon, authenticated;
grant execute on function driver_location_reminder_seconds(uuid) to service_role;

-- ٣) الإيداع (يُنادى من شوطِ العاملِ كلَّ دقيقة).
create or replace function enqueue_driver_location_reminders(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  with cfg as (
    select c.id as city_id,
           driver_location_reminder_seconds(c.id) as secs,
           greatest(0, least(20, coalesce(
             get_setting_number(c.id, 'driver_location_reminder_max_count')::integer, 3))) as max_count
      from cities c
     where c.is_active
  ),
  due as (
    select d.id as driver_id, d.city_id, cfg.secs,
           coalesce(d.last_location_recorded_at, d.last_location_at) as located_at
      from drivers d
      join cfg on cfg.city_id = d.city_id and cfg.secs > 0 and cfg.max_count > 0
      join driver_availability da on da.driver_id = d.id and da.is_available
     where d.verification_status = 'verified'
       and da.changed_at < now() - make_interval(secs => cfg.secs)
       and (coalesce(d.last_location_recorded_at, d.last_location_at) is null
            or coalesce(d.last_location_recorded_at, d.last_location_at)
               < now() - make_interval(secs => cfg.secs))
       -- السائقُ في رحلةٍ قائمةٍ يبثُّ موقعَه بقواعدِ الرحلة؛ لا تذكيرَ يقطعُه.
       and not exists (
         select 1 from orders o
          where o.assigned_driver_id = d.id and is_driver_engaged_order_status(o.status)
       )
       and not exists (
         select 1 from notification_outbox n
          where n.kind = 'driver_location_reminder' and n.driver_id = d.id
            and n.created_at > now() - make_interval(secs => cfg.secs)
       )
       and (
         select count(*) from notification_outbox n
          where n.kind = 'driver_location_reminder' and n.driver_id = d.id
            and n.created_at >= greatest(
              da.changed_at,
              coalesce(d.last_location_recorded_at, d.last_location_at, '-infinity'::timestamptz)
            )
       ) < cfg.max_count
     order by located_at nulls first
     limit greatest(1, least(500, coalesce(p_limit, 100)))
  ),
  ins as (
    insert into notification_outbox (city_id, kind, driver_id, status, next_attempt_at, dedup_key, payload)
    select due.city_id, 'driver_location_reminder', due.driver_id, 'pending', now(),
           'location_reminder:' || due.driver_id::text || ':'
             || floor(extract(epoch from now()) / due.secs)::bigint::text,
           jsonb_build_object('driver_id', due.driver_id, 'reminder_seconds', due.secs)
      from due
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return jsonb_build_object('ok', true, 'enqueued', v_count);
end;
$$;
revoke all on function enqueue_driver_location_reminders(integer) from public, anon, authenticated;
grant execute on function enqueue_driver_location_reminders(integer) to service_role;

-- ٤) المُطالِب: صورةُ `20261012150000` حرفًا مع فرعِ `driver_location_reminder`.
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
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message',
    'driver_location_reminder'
  ];
  v_chat_id text;
  v_undeliverable_reason text;
  v_party record;
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
  elsif v_delivery.kind = 'driver_location_reminder' then
    -- `WR-12` — محادثةُ السائقِ ولغتُه، و**حالُه الآنَ** لا لحظةَ الإيداع: ما زالَ متوفّرًا
    -- وما زالَ موقعُه أقدمَ من مهلةِ التذكير؟ وإلّا يطويه المعالج.
    select du.telegram_id::text as chat_id, du.language_code as language,
           coalesce(da.is_available, false) as is_available,
           (coalesce(d.last_location_recorded_at, d.last_location_at) is null
             or coalesce(d.last_location_recorded_at, d.last_location_at)
                < now() - make_interval(secs => greatest(1, driver_location_reminder_seconds(d.city_id)))
           ) as still_stale,
           case when coalesce(d.last_location_recorded_at, d.last_location_at) is null then null
                else floor(extract(epoch from now() - coalesce(d.last_location_recorded_at, d.last_location_at)) / 60)::integer
           end as minutes
      into v_driver
      from drivers d
      join users du on du.id = d.user_id
      left join driver_availability da on da.driver_id = d.id
     where d.id = (v_delivery.payload->>'driver_id')::uuid;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_driver.chat_id,
      'language', coalesce(v_driver.language, 'ar'),
      'is_available', coalesce(v_driver.is_available, false),
      'still_stale', coalesce(v_driver.still_stale, false),
      'minutes', v_driver.minutes
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
  elsif v_delivery.kind = 'order_chat_message' then
    -- `WR-04` — المستقبِلُ مُعلَنٌ في الصفّ (`recipient_user_id`)، ومحادثتُه ولغتُه حيّتان.
    -- و`read` = قرأَ الرسالةَ داخلَ Mini App قبلَ موعدِ التنبيه ⇒ المعالجُ يطويه.
    select u.telegram_id::text as chat_id, u.language_code as language,
           o.status::text as order_status,
           coalesce(rd.last_read_seq, 0) >= coalesce((v_delivery.payload->>'seq')::bigint, 0) as read
      into v_party
      from users u
      join orders o on o.id = v_delivery.order_id
      left join order_message_reads rd on rd.order_id = o.id and rd.user_id = u.id
     where u.id = v_delivery.recipient_user_id
       and u.erased_at is null;

    v_payload := v_delivery.payload || jsonb_build_object(
      'chat_id', v_party.chat_id,
      'language', coalesce(v_party.language, 'ar'),
      'order_status', v_party.order_status,
      'read', coalesce(v_party.read, false)
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
  elsif v_delivery.kind in (
    'order_cancelled', 'lost_item_report', 'driver_candidate_notice', 'driver_location_reminder'
  ) then
    v_chat_id := v_driver.chat_id;
  elsif v_delivery.kind in ('safety_resolution_closed', 'safety_resolution_blocked') then
    v_chat_id := v_rider.chat_id;
  elsif v_delivery.kind = 'order_chat_message' then
    v_chat_id := v_party.chat_id;
  else
    v_chat_id := null;
  end if;

  if v_chat_id is null and v_delivery.kind in (
    'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message',
    'driver_location_reminder'
  ) and (
    -- الحرسُ يقعُ فقطَ حينَ يَحملُ الحمولةُ المعرِّفَ المطلوبَ: فالكيانُ كانَ
    -- مُستهدَفاً لكنَّهُ تعذَّرَ الوصولُ إليه. أمّا الحمولةُ الفارغةُ فعيبُ بياناتٍ
    -- لا عجزَ تسليمٍ، فيُترَكُ للسلوكِ القائمِ (إرجاعٌ بـ`chat_id` غائبةٍ).
    (v_delivery.kind = 'dispute_resolution' and v_delivery.payload->>'ticket_id' is not null)
    or (v_delivery.kind in ('negotiation_turn_opened','negotiation_turn_closed','negotiation_agreed') and v_delivery.payload->>'claim_id' is not null)
    or (v_delivery.kind in ('wider_circle_opened','no_driver_found','rider_trip_notice') and v_delivery.payload->>'order_id' is not null)
    or (v_delivery.kind in ('order_cancelled','lost_item_report','driver_candidate_notice','driver_location_reminder') and v_delivery.payload->>'driver_id' is not null)
    or (v_delivery.kind in ('safety_resolution_closed','safety_resolution_blocked') and v_delivery.payload->>'incident_id' is not null)
    or (v_delivery.kind = 'order_chat_message' and v_delivery.recipient_user_id is not null)
  ) then
    if v_delivery.kind in (
      'wider_circle_opened', 'no_driver_found',
      'dispute_resolution', 'lost_item_report', 'order_chat_message',
      'driver_location_reminder'
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

revoke execute on function claim_notification_delivery() from public, anon, authenticated;
grant execute on function claim_notification_delivery() to service_role;
