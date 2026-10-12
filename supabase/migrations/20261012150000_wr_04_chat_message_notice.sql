-- migration-phase: contract
-- =============================================================================
-- `WR-04` — تنبيهُ الطرفِ الآخرِ برسالةِ محادثةٍ جديدةٍ وهو خارجَ Mini App (ADR 0267).
--
-- **المسألةُ:** المحادثةُ داخلَ Mini App (ADR 0263) لا تُعلِمُ الطرفَ الآخرَ إن لم يكن
-- فاتحًا الشاشة؛ فرسالةُ «أنا عند البوابة» تبقى غيرَ مقروءةٍ حتى يعودَ صدفةً.
--
-- **القرار:**
--   ١) نوعُ صادرٍ جديدٌ `order_chat_message` (رتبةٌ ٢، مرتفع) بسياسةِ `critical`.
--   ٢) `enqueue_order_chat_notice` (داخليّة): صفٌّ **مؤجَّلٌ** `order_chat_notice_delay_seconds`
--      (20 افتراضًا) — فمن كانَ في المحادثةِ قرأَ الرسالةَ قبلَ الموعدِ فيُطوى التنبيه —
--      و**مجمَّعٌ**: لا صفَّ جديدَ ما دامَ للطرفِ نفسِه في الطلبِ نفسِه صفٌّ لم يُرسَل،
--      ولا صفَّ بعدَ تنبيهٍ مُسلَّمٍ خلالَ `order_chat_notice_cooldown_seconds` (120).
--      فرسائلُ متتاليةٌ تُنتجُ تنبيهًا واحدًا لا سيلَ رسائلِ بوت (أمرُ المالك §4 بند 9).
--   ٣) `post_order_message` يُنادي الإيداعَ للرسالةِ الجديدةِ وحدَها (لا للمكرَّرة).
--   ٤) المُطالِبُ يقرأُ محادثةَ المستقبِلِ ولغتَه حيّتين، ويُرفِقُ `read` (قرأَ حتى هذه
--      الرسالة) و`order_status`، والمعالجُ يطوي المقروءَ وما انتهت رحلتُه.
--   ٥) **لا نصَّ للرسالةِ في التنبيه** ولا في الحمولة: «لديك رسالة جديدة من السائق»
--      وزرُّ فتحِ الطلب. فالخصوصيّةُ والحدُّ من رسائلِ البوتِ معًا.
--
-- **التوافق:** المُطالِبُ منسوخٌ حرفًا عن `20261012140000` مع فرعِ النوعِ الجديد؛
-- و`post_order_message` منسوخةٌ حرفًا عن `20261012100000` مع نداءِ الإيداع.
-- النسخةُ السابقةُ من الشيفرةِ لا تعرفُ النوعَ فتبقى صفوفُه `pending` حتى النشر.
-- =============================================================================

-- ١) نوعُ الصادرِ الجديد.
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'offer', 'dispute_resolution',
    'negotiation_turn_opened', 'negotiation_turn_closed', 'negotiation_agreed',
    'wider_circle_opened', 'no_driver_found',
    'order_cancelled', 'safety_incident', 'subscription_notice', 'broadcast_recipient',
    'lost_item_report',
    'safety_resolution_closed', 'safety_resolution_blocked',
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message'
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
    ('order_chat_message', 'تنبيهُ رسالةِ محادثةٍ جديدةٍ من الطرفِ الآخرِ في الطلب، بلا نصِّ الرسالة')
  ) as k(kind, description_ar)
on conflict (city_id, kind) do nothing;

-- ٢) الإعدادان.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, k.key, k.value::jsonb, 'number', k.description_ar, false
  from cities c
  cross join (values
    ('order_chat_notice_delay_seconds', '20',
     'WR-04: ثواني تأجيلِ تنبيهِ الرسالةِ الجديدة؛ من قرأَها داخلَ Mini App قبلَها لا يُنبَّه.'),
    ('order_chat_notice_cooldown_seconds', '120',
     'WR-04: لا تنبيهَ ثانٍ للطرفِ نفسِه في الطلبِ نفسِه قبلَ مرورِ هذه الثواني على السابق.')
  ) as k(key, value, description_ar)
on conflict (city_id, key) do nothing;

-- ٣) الإيداع (داخليّ: يُنادى من `post_order_message` وحدَها).
create or replace function enqueue_order_chat_notice(
  p_order_id uuid,
  p_city_id uuid,
  p_recipient_user_id uuid,
  p_sender_role text,
  p_seq bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delay integer := greatest(0, least(600, coalesce(
    get_setting_number(p_city_id, 'order_chat_notice_delay_seconds')::integer, 20)));
  v_cooldown integer := greatest(0, least(3600, coalesce(
    get_setting_number(p_city_id, 'order_chat_notice_cooldown_seconds')::integer, 120)));
begin
  -- تنبيهٌ لم يُرسَل بعدُ يكفي: يقولُ «لديك رسالة جديدة» عن هذه وما قبلَها.
  if exists (
    select 1 from notification_outbox n
     where n.kind = 'order_chat_message'
       and n.order_id = p_order_id
       and n.recipient_user_id = p_recipient_user_id
       and n.status in ('pending', 'sending')
  ) then
    return false;
  end if;
  if exists (
    select 1 from notification_outbox n
     where n.kind = 'order_chat_message'
       and n.order_id = p_order_id
       and n.recipient_user_id = p_recipient_user_id
       and n.status = 'delivered'
       and n.delivered_at > now() - make_interval(secs => v_cooldown)
  ) then
    return false;
  end if;

  insert into notification_outbox (
    city_id, kind, order_id, recipient_user_id, status, next_attempt_at, dedup_key, payload
  ) values (
    p_city_id, 'order_chat_message', p_order_id, p_recipient_user_id, 'pending',
    now() + make_interval(secs => v_delay),
    'order_chat:' || p_order_id::text || ':' || p_recipient_user_id::text || ':' || p_seq::text,
    jsonb_build_object(
      'order_id', p_order_id,
      'seq', p_seq,
      'sender_role', p_sender_role,
      'recipient_role', case when p_sender_role = 'rider' then 'driver' else 'rider' end
    )
  )
  on conflict do nothing;
  return found;
end;
$$;
revoke all on function enqueue_order_chat_notice(uuid, uuid, uuid, text, bigint)
  from public, anon, authenticated;

-- ٤) الكتابة: صورةُ `20261012100000` حرفًا مع نداءِ الإيداع.
create or replace function post_order_message(
  p_telegram_id bigint,
  p_order_id uuid,
  p_client_message_id uuid,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_row order_messages%rowtype;
  v_status text := 'added';
begin
  if p_body is null or length(btrim(p_body)) < 1 then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
  end if;
  if length(p_body) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_TOO_LONG');
  end if;
  if p_client_message_id is null then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_ID_INVALID');
  end if;

  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;
  if not v_party.writable then
    return jsonb_build_object('ok', false, 'error', 'CHAT_CLOSED');
  end if;

  -- قفلٌ على غرفةِ هذا الطلبِ وحدَه: التسلسلُ يُلتزَمُ بترتيبِه (القاعدة ٤).
  perform pg_advisory_xact_lock(hashtextextended('order_chat:' || p_order_id::text, 0));

  insert into order_messages (order_id, city_id, sender_user_id, sender_role, client_message_id, body)
  values (p_order_id, v_party.city_id, v_party.user_id, v_party.role, p_client_message_id, p_body)
  on conflict (order_id, sender_user_id, client_message_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    v_status := 'duplicate';
    select * into v_row from order_messages m
     where m.order_id = p_order_id
       and m.sender_user_id = v_party.user_id
       and m.client_message_id = p_client_message_id;
  end if;

  -- `WR-04` — تنبيهُ الطرفِ الآخرِ برسالةٍ جديدةٍ في تيليجرام، مؤجَّلٌ ومجمَّع:
  -- رسالةٌ مكرَّرةٌ (`duplicate`) لا تُنبِّه، والدالّةُ الداخليّةُ تطوي المتتاليات.
  if v_status = 'added' and v_party.counterpart_user_id is not null then
    perform enqueue_order_chat_notice(
      p_order_id, v_party.city_id, v_party.counterpart_user_id, v_party.role, v_row.seq
    );
  end if;

  -- ما كتبَه المرسلُ مقروءٌ له.
  insert into order_message_reads (order_id, user_id, city_id, last_read_seq)
  values (p_order_id, v_party.user_id, v_party.city_id, v_row.seq)
  on conflict (order_id, user_id) do update
    set last_read_seq = greatest(order_message_reads.last_read_seq, excluded.last_read_seq),
        updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'message', jsonb_build_object(
      'id', v_row.id,
      'seq', v_row.seq,
      'sender_role', v_row.sender_role,
      'mine', true,
      'client_message_id', v_row.client_message_id,
      'body', v_row.body,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function post_order_message(bigint, uuid, uuid, text) from public, anon, authenticated;
grant execute on function post_order_message(bigint, uuid, uuid, text) to service_role;

-- ٥) المُطالِب: صورةُ `20261012140000` حرفًا مع فرعِ `order_chat_message`.
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
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message'
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
  elsif v_delivery.kind in ('order_cancelled', 'lost_item_report', 'driver_candidate_notice') then
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
    'rider_trip_notice', 'driver_candidate_notice', 'order_chat_message'
  ) and (
    -- الحرسُ يقعُ فقطَ حينَ يَحملُ الحمولةُ المعرِّفَ المطلوبَ: فالكيانُ كانَ
    -- مُستهدَفاً لكنَّهُ تعذَّرَ الوصولُ إليه. أمّا الحمولةُ الفارغةُ فعيبُ بياناتٍ
    -- لا عجزَ تسليمٍ، فيُترَكُ للسلوكِ القائمِ (إرجاعٌ بـ`chat_id` غائبةٍ).
    (v_delivery.kind = 'dispute_resolution' and v_delivery.payload->>'ticket_id' is not null)
    or (v_delivery.kind in ('negotiation_turn_opened','negotiation_turn_closed','negotiation_agreed') and v_delivery.payload->>'claim_id' is not null)
    or (v_delivery.kind in ('wider_circle_opened','no_driver_found','rider_trip_notice') and v_delivery.payload->>'order_id' is not null)
    or (v_delivery.kind in ('order_cancelled','lost_item_report','driver_candidate_notice') and v_delivery.payload->>'driver_id' is not null)
    or (v_delivery.kind in ('safety_resolution_closed','safety_resolution_blocked') and v_delivery.payload->>'incident_id' is not null)
    or (v_delivery.kind = 'order_chat_message' and v_delivery.recipient_user_id is not null)
  ) then
    if v_delivery.kind in (
      'wider_circle_opened', 'no_driver_found',
      'dispute_resolution', 'lost_item_report', 'order_chat_message'
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
