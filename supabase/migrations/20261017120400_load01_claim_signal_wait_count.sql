-- migration-phase: expand
-- =============================================================================
-- `LOAD-01 Recovery` (CAP-RUN-20261016-CONTINUATION · المرحلة 6-استكمال — الجدار
-- الثاني: الإشعاراتُ) — وصولُ عدّادِ انتظارِ إشارةِ اللوحِ إلى معالجِ التسليمِ.
--
-- `requeue_notification_delivery_signal_wait` (20261017120100) يزيدُ
-- `signal_wait_count` في الصفِّ، لكنَّ مغلّفَ الالتقاطِ لم يكنْ يُعيده — فلا
-- يعرفُ المعالجُ كم انتظرَ الصفُّ ليُسقِفَهُ.
--
-- **العقدة المعلنة:** دالّةٌ واحدةٌ بصورةٍ واحدةٍ في المستودعِ — من يعدّلُها
-- يعدو على صورةٍ أحدثَ أو يفتحُ فجوةَ نسخٍ (درسُ PD-021 → WR-08). الصورةُ
-- هنا هيَ صورةُ `20261016130000` (D8: بوابةُ التسلسلِ على المستلِمِ لا على
-- الطلبِ) **حرفيًا وإضافةُ سطرٍ واحدٍ في مغلّفِ الإرجاعِ**: `signal_wait_count`.
-- لا سلوكَ آخرَ يُمسُّ. (الصورةُ الأولى لهذهِ الهجرةِ نُسِخَت من `20261012200100`
-- قبلَ D8 فرجعَت البوابةَ إلى الطلبِ كلِّهِ — وأصلُ هذا التعديلِ.)
-- **العودة:** إعادةُ تطبيقِ دالّةِ `20261016130000`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_notification_delivery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'driver_location_reminder', 'driver_city_notice'
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
          -- `D8` (CAP-RUN-20261016-CONTINUATION): تسلسلُ «نفسِ الطلبِ» يَسري على
          -- المستلِمِ نفسِهِ فقط (المستلِمُ = recipient_user_id) — لا على الطلبِ كلِّهِ.
          -- القياسُ (جولةُ J1 على مقعدِ D8): عاصفةُ العروضِ للسائقينَ كانت تحجبُ
          -- إشعاراتِ الرحلةِ الحرجةَ للركابِ خلفَ أقدمِ عرضٍ لمُستلِمٍ آخرَ (بوابةُ
          -- رأسِ السطرِ داخلَ الطلبِ) — فتأخرتِ الحرجةُ خلفَ الدفعةِ المُغرقةِ.
          -- بالنطاقِ على المستلِمِ يبقى التسلسلُ المنطقيُّ لكلِّ مستلِمٍ (لا يرى
          -- أحدٌ قصتَهُ مبعثرةً) ويتحررُ المسارُ الحرجُ من حجبِ مستلِمٍ آخر.
          and o.recipient_user_id is not distinct from n.recipient_user_id
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
    -- `WR-08`: إثراءُ `PD-051` (`20260920210000`) مُعادٌ حرفًا — الخدمةُ والانطلاقُ والوصولُ
    -- والملاحظاتُ من `orders`. سقطَ في إعادةِ كتابةِ `20260921000000` وما بعدَها.
    select jsonb_build_object(
             'offer_id', o.id, 'order_id', o.order_id, 'driver_id', o.driver_id,
             'distance_km', o.distance_km::text, 'expires_at', o.expires_at,
             'offer_status', o.status::text,
             'service', ord.service::text,
             'pickup_label', ord.pickup_label,
             'dropoff_label', ord.dropoff_label,
             'notes', ord.notes
           )
      into v_payload
      from order_offers o
      join orders ord on ord.id = o.order_id
     where o.id = v_delivery.offer_id;
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
  elsif v_delivery.kind in ('lost_item_report', 'driver_candidate_notice', 'driver_city_notice') then
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
    'order_cancelled', 'lost_item_report', 'driver_candidate_notice', 'driver_location_reminder',
    'driver_city_notice'
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
    'driver_location_reminder', 'driver_city_notice'
  ) and (
    -- الحرسُ يقعُ فقطَ حينَ يَحملُ الحمولةُ المعرِّفَ المطلوبَ: فالكيانُ كانَ
    -- مُستهدَفاً لكنَّهُ تعذَّرَ الوصولُ إليه. أمّا الحمولةُ الفارغةُ فعيبُ بياناتٍ
    -- لا عجزَ تسليمٍ، فيُترَكُ للسلوكِ القائمِ (إرجاعٌ بـ`chat_id` غائبةٍ).
    (v_delivery.kind = 'dispute_resolution' and v_delivery.payload->>'ticket_id' is not null)
    or (v_delivery.kind in ('negotiation_turn_opened','negotiation_turn_closed','negotiation_agreed') and v_delivery.payload->>'claim_id' is not null)
    or (v_delivery.kind in ('wider_circle_opened','no_driver_found','rider_trip_notice') and v_delivery.payload->>'order_id' is not null)
    or (v_delivery.kind in ('order_cancelled','lost_item_report','driver_candidate_notice','driver_location_reminder','driver_city_notice') and v_delivery.payload->>'driver_id' is not null)
    or (v_delivery.kind in ('safety_resolution_closed','safety_resolution_blocked') and v_delivery.payload->>'incident_id' is not null)
    or (v_delivery.kind = 'order_chat_message' and v_delivery.recipient_user_id is not null)
  ) then
    if v_delivery.kind in (
      'wider_circle_opened', 'no_driver_found',
      'dispute_resolution', 'lost_item_report', 'order_chat_message',
      'driver_location_reminder', 'driver_city_notice'
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
      'signal_wait_count', n.signal_wait_count,
      'payload', coalesce(v_payload, '{}'::jsonb)
    )) from notification_outbox n where n.id = v_delivery.id
  );
end $function$
