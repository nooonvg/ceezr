-- migration-phase: expand
-- =============================================================================
-- `WR-06` (الخيارُ ج) — جدولةٌ حقيقيّةٌ للطلباتِ ذاتِ موعدِ الحضورِ المستقبليّ.
--
-- **المسألةُ:** كانَ `pickup_at` إخباريًّا: الطلبُ يُبَثُّ فورَ إنشائِه ولو كانَ الموعدُ
-- بعدَ ساعاتٍ، فيقبلُه سائقٌ الآنَ ولا يأتي، أو يُصعَّدُ «بلا سائقٍ» قبلَ موعدِه بساعات.
--
-- **القرار (ADR 0273):**
--   ١) موعدٌ أبعدُ من «مهلةِ الإطلاقِ» (`scheduled_dispatch_lead_minutes`، 20 افتراضًا)
--      ⇒ يُحفَظُ الطلبُ `scheduled` و`dispatch_at = pickup_at − المهلة`، في معاملةِ الإنشاءِ
--      نفسِها. وما دونَها فوريٌّ كما كانَ حرفًا.
--   ٢) `release_due_scheduled_orders(city, limit)` يُنادى من شوطٍ حرِجٍ كلَّ 15 ثانية:
--      ما حانَ إطلاقُه ⇒ `searching` و`searching_since = now()`، ثمّ يلتقطُه مسارُ البثِّ
--      القائمُ (`redispatch-searching`) بلا تغيير. وما فاتَ موعدُه بأكثرَ من مهلةِ السماحِ
--      (`scheduled_missed_grace_minutes`، 15) — النظامُ كانَ معطَّلًا — يُلغى بسببٍ مسمّى
--      `scheduled_missed` ويُعلَمُ الراكب. القفلُ `for update skip locked` فعاملانِ لا
--      يُطلقانِ الطلبَ مرّتين، والإلغاءُ المتزامنُ يُقفِلُ الصفَّ نفسَه.
--   ٣) `enqueue_scheduled_reminders(limit)`: تذكيرُ الراكبِ قبلَ الموعدِ
--      (`scheduled_rider_reminder_minutes`، 60) وتذكيرُ السائقِ المُسنَدِ الذي لم يصلْ
--      (`scheduled_driver_reminder_minutes`، 10)، بمفاتيحِ عدمِ تكرارٍ في صندوقِ الصادر.
--   ٤) المجدولُ يُلغيه الراكبُ بلا عقوبةٍ، ويحجبُ طلبًا ثانيًا للخدمةِ نفسِها كما يحجبُه
--      `searching` اليومَ، ويحجبُ محوَ الحساب. ولا يدخلُ `is_active_order_status`: تلكَ
--      حالاتُ رحلةٍ حيّةٍ (تتبّع، استغاثة، كشفُ تعثّر) والمجدولُ لم يبدأ.
--   ٥) `searching_since`: مؤقّتاتُ البحثِ (التصعيدُ، عدّادُ الراكبِ) تُقاسُ منه لا من
--      `created_at`؛ وإلّا بدا طلبٌ أُنشئَ أمسِ وأُطلِقَ الآنَ عالقًا منذُ يومٍ فيُصعَّدُ فورًا.
--
-- **التوافق:** النسخةُ السابقةُ من الشيفرةِ لا تُنشئُ `scheduled` ولا تقرؤه، والطلباتُ
-- القائمةُ كلُّها `pickup_at` فيها إخباريٌّ ولا تُمَسّ. والدوالُّ المُعادةُ منسوخةٌ حرفًا
-- عن صورتِها في القاعدةِ مع التغييرِ المذكورِ عندَ كلٍّ منها.
-- =============================================================================

-- ١) الأعمدةُ والقيد.
alter table orders add column if not exists dispatch_at timestamptz;
alter table orders add column if not exists searching_since timestamptz;

comment on column orders.dispatch_at is
  'WR-06: لحظةُ إطلاقِ الطلبِ المجدولِ إلى البحث (pickup_at − مهلةُ الإطلاق). null ⇒ لم يُجدوَل.';
comment on column orders.searching_since is
  'WR-06: لحظةُ دخولِ الطلبِ حالةَ البحثِ إن دخلها بعدَ الإنشاء (إطلاقُ مجدول). null ⇒ created_at.';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'orders'::regclass and conname = 'orders_scheduled_has_times') then
    alter table orders add constraint orders_scheduled_has_times
      check (status <> 'scheduled' or (dispatch_at is not null and pickup_at is not null)) not valid;
  end if;
end;
$$;

-- ٢) الإعداداتُ لكلِّ مدينة.
insert into platform_settings (city_id, key, value, value_type, description_ar, is_provisional)
select c.id, k.key, k.value::jsonb, 'number', k.description_ar, true
  from cities c
  cross join (values
    ('scheduled_dispatch_lead_minutes', '20',
     'WR-06: يبدأُ البحثُ عن سائقٍ قبلَ موعدِ الحضورِ بهذه الدقائق؛ والموعدُ الأقربُ منها فوريّ. (5..180)'),
    ('scheduled_rider_reminder_minutes', '60',
     'WR-06: تذكيرُ الراكبِ بطلبِه المجدولِ قبلَ الموعدِ بهذه الدقائق. 0 ⇒ لا تذكير. (0..1440)'),
    ('scheduled_driver_reminder_minutes', '10',
     'WR-06: تذكيرُ السائقِ المُسنَدِ الذي لم يصلْ قبلَ الموعدِ بهذه الدقائق. 0 ⇒ لا تذكير. (0..120)'),
    ('scheduled_missed_grace_minutes', '15',
     'WR-06: طلبٌ مجدولٌ لم يُطلَق حتّى مضى على موعدِه هذا (تعطّلُ النظام) يُلغى ويُعلَمُ الراكب. (0..180)')
  ) as k(key, value, description_ar)
on conflict (city_id, key) do nothing;

create or replace function scheduled_order_minutes(p_city_id uuid, p_key text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case p_key
    when 'scheduled_dispatch_lead_minutes' then greatest(5, least(180, coalesce(v.n, 20)))
    when 'scheduled_rider_reminder_minutes' then greatest(0, least(1440, coalesce(v.n, 60)))
    when 'scheduled_driver_reminder_minutes' then greatest(0, least(120, coalesce(v.n, 10)))
    when 'scheduled_missed_grace_minutes' then greatest(0, least(180, coalesce(v.n, 15)))
  end
  from (
    select (select case when jsonb_typeof(ps.value) = 'number' then (ps.value #>> '{}')::numeric::integer end
              from platform_settings ps
             where ps.city_id = p_city_id and ps.key = p_key) as n
  ) v;
$$;
revoke all on function scheduled_order_minutes(uuid, text) from public, anon, authenticated;
grant execute on function scheduled_order_minutes(uuid, text) to service_role;

-- ٣) أحداثُ إشعارِ الراكبِ الجديدة (`rider_trip_notice`).
-- التغييرُ الوحيدُ: الأحداثُ الأربعةُ الجديدةُ في قائمةِ المقبول.
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
                                       'SCHEDULED', 'SCHEDULE_REMINDER', 'SEARCH_STARTED', 'SCHEDULE_MISSED') then
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
end $function$;

revoke all on function enqueue_rider_trip_notice(uuid, text) from public, anon, authenticated;
grant execute on function enqueue_rider_trip_notice(uuid, text) to service_role;

-- ٤) الإلغاء: المجدولُ يُلغيه الراكبُ (التغييرُ الوحيدُ: `scheduled` في قائمةِ القابلِ للإلغاء).
CREATE OR REPLACE FUNCTION public.cancel_order_by_rider(p_order_id uuid, p_rider_id uuid, p_reason text DEFAULT 'rider_cancelled'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     and status in ('scheduled', 'searching', 'matched')
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
$function$;

revoke all on function cancel_order_by_rider(uuid, uuid, text) from public, anon, authenticated;
grant execute on function cancel_order_by_rider(uuid, uuid, text) to service_role;

-- ٥) محوُ الحساب: المجدولُ طلبٌ قائمٌ يحجبُ المحوَ كالبحث (التغييرُ الوحيد).
CREATE OR REPLACE FUNCTION public.erase_my_account(p_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user            users;
  v_rider_id        uuid;
  v_driver_id       uuid;
  v_active          integer;
  v_places          integer;
  v_notifications   integer;
  v_tokens          integer;
  v_orders          integer;
  v_broadcasts      integer;
  v_consents        integer;
  v_ratings         integer;
  v_bar_rows        integer;
  v_tickets         integer;
  v_incidents       integer;
  v_audit           integer;
  v_sentinel        bigint;
  v_receipt         jsonb;
  -- ما يخصُّ السائقَ وحدَه
  v_docs            integer;
  v_avail           integer;
  v_memberships     integer;
  v_caps            integer;
  v_loc             integer;
  v_tracking        integer;
  v_outbox          integer;
  v_notices         integer;
  v_offers          integer;
  v_claims          integer;
  v_attendance      integer;
  v_ledger          integer;
  v_payments        integer;
  v_invoices        integer;
  v_refunds         integer;
  v_wallet_rows     integer;
  v_wallets         integer;
  v_subs            integer;
  v_balance         jsonb;
  v_balance_minor   bigint;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  -- القفلُ **قبلَ** كلِّ قراءةٍ تُبنى عليها كتابةٌ: طلبٌ يُنشأُ بينَ الفحصِ
  -- والتجهيلِ يجعلُ الفحصَ كذباً، والقفلُ على صفِّ المستخدمِ هوَ ما يُسلسِلُ
  -- إنشاءَ الطلبِ معَ الحذفِ (مسارُ الطلبِ يقرأُ صفَّ صاحبِه).
  select * into v_user from users where telegram_id = p_telegram_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    -- إعادةٌ لا خطأٌ: الطلبُ الثانيَ يجدُ الحالَ المطلوبَ قائماً.
    return jsonb_build_object(
      'ok', true, 'reason', 'ALREADY_ERASED', 'erased_at', v_user.erased_at
    );
  end if;

  -- حسابُ العملِ يُنهيه مَن أنشأَه لا صاحبُه: المشرفُ والدعمُ خارجَ هذا البابِ
  -- (`F12-10`). والرمزُ **مُسمّىً بما يعنيه** لا `NOT_A_RIDER`: الأخيرُ كانَ
  -- يقولُ للسائقِ «لستَ راكباً» وهوَ جوابٌ لا يُفيدُه شيئاً.
  if v_user.role not in ('rider', 'driver') then
    return jsonb_build_object(
      'ok', false, 'reason', 'ROLE_NOT_SELF_ERASABLE', 'role', v_user.role
    );
  end if;

  v_sentinel := -nextval('erased_account_telegram_seq');

  if v_user.role = 'rider' then
    select r.id into v_rider_id from riders r where r.user_id = v_user.id;

    if v_rider_id is not null then
      select count(*) into v_active
        from orders o
       where o.rider_id = v_rider_id
         and o.status in ('scheduled', 'searching', 'matched', 'in_progress');
      if v_active > 0 then
        return jsonb_build_object('ok', false, 'reason', 'ACTIVE_ORDER', 'active_orders', v_active);
      end if;
    end if;

    -- ── ما يُمحى صفّاً: مِلكُه وحدَه ───────────────────────────────────────
    with gone as (delete from saved_places where user_id = v_user.id returning 1)
      select count(*) into v_places from gone;

    -- WR-04: ما كتبَه في محادثاتِ الطلباتِ ومواضعُ قراءتِه — مِلكُه وحدَه.
    delete from order_message_reads where user_id = v_user.id;
    delete from order_messages where sender_user_id = v_user.id;

    with gone as (delete from user_notifications where user_id = v_user.id returning 1)
      select count(*) into v_notifications from gone;

    -- SEC-19 بندُ ٣: المِلكيّةُ بـ`users.id` الثابتِ لا بـ`telegram_id` الذي
    -- يَزولُ بالتجهيلِ. والعمودُ القديمُ (`created_by bigint`) مسلكٌ تراثيٌّ
    -- للصفوفِ التي لم تُعَيَّن بعدُ.
    with gone as (delete from trip_tracking_tokens
      where created_by_user_id = v_user.id
         or (created_by_user_id is null and created_by = p_telegram_id)
      returning 1)
      select count(*) into v_tokens from gone;

    -- ── ما يُجهَّلُ: يبقى الصفُّ ويُمحى ما يُعرَفُ به إنسانٌ ───────────────
    if v_rider_id is not null then
      with hushed as (
        update orders
           set notes = null, pickup_label = null, dropoff_label = null
         where rider_id = v_rider_id
           and (notes is not null or pickup_label is not null or dropoff_label is not null)
        returning 1
      ) select count(*) into v_orders from hushed;
    else
      v_orders := 0;
    end if;

    with hushed as (
      update broadcast_recipients
         set chat_id = v_sentinel, claim_token = null
       where user_id = v_user.id
      returning 1
    ) select count(*) into v_broadcasts from hushed;

    if v_rider_id is not null then
      update riders set rating_average = null, rating_count = 0 where id = v_rider_id;
    end if;

    -- ── ما بقيَ بأساسٍ: يُعَدُّ ليُقالَ في الإيصالِ، ولا يُمَسُّ ─────────────
    select count(*) into v_consents  from user_consents   where user_id = v_user.id;
    select count(*) into v_ratings   from ratings         where rater_user_id = v_user.id or ratee_user_id = v_user.id;
    select count(*) into v_tickets   from support_tickets where v_rider_id is not null and rider_id = v_rider_id;
    select count(*) into v_incidents from safety_incidents where reporter_user_id = v_user.id;
    select count(*) into v_audit     from audit_log       where actor_user_id = v_user.id;

    v_receipt := jsonb_build_object(
      'erased', jsonb_build_object(
        'savedPlaces', v_places,
        'notificationsReceived', v_notifications,
        'tripTrackingTokens', v_tokens
      ),
      'anonymized', jsonb_build_object(
        'profile', 1,
        'riderProfile', case when v_rider_id is null then 0 else 1 end,
        'orders', v_orders,
        'broadcastsReceived', v_broadcasts
      ),
      'retained', jsonb_build_array(
        jsonb_build_object('section', 'consents',        'rows', v_consents,  'basis', 'CONSENT_IS_COMPLIANCE_EVIDENCE'),
        jsonb_build_object('section', 'ratings',         'rows', v_ratings,   'basis', 'RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY'),
        jsonb_build_object('section', 'supportTickets',  'rows', v_tickets,   'basis', 'SUPPORT_RECORD_MAY_BE_DISPUTED'),
        jsonb_build_object('section', 'safetyIncidents', 'rows', v_incidents, 'basis', 'SAFETY_REPORT_MAY_BE_DISPUTED'),
        jsonb_build_object('section', 'auditTrail',      'rows', v_audit,     'basis', 'AUDIT_TRAIL_PROVES_THIS_ERASURE')
      )
    );
  else
    -- ═══ دورُ السائقِ ═══════════════════════════════════════════════════════
    select d.id into v_driver_id from drivers d where d.user_id = v_user.id;

    if v_driver_id is not null then
      -- `searching` لا سائقَ لها؛ فالجاريةُ للسائقِ ما أُسنِدَ إليه فعلاً.
      select count(*) into v_active
        from orders o
       where o.assigned_driver_id = v_driver_id
         and o.status in ('matched', 'in_progress');
      if v_active > 0 then
        return jsonb_build_object('ok', false, 'reason', 'ACTIVE_ORDER', 'active_orders', v_active);
      end if;

      -- **الرصيدُ يُقرأُ من مصدرِ حقيقتِه لا يُحسَبُ ههنا ثانيةً**: حسابُ
      -- الرصيدِ مِلكُ `subscription_wallet_balance`، ونسخُ جمعِه في هذه
      -- الدالّةِ يجعلُ للرصيدِ حسابَينِ يفترقانِ يوماً (القاعدة 0.6).
      v_balance := subscription_wallet_balance(v_driver_id);
      if coalesce((v_balance->>'ok')::boolean, false) then
        v_balance_minor := coalesce((v_balance->>'balance_minor')::bigint, 0);
        if v_balance_minor <> 0 then
          return jsonb_build_object(
            'ok', false,
            'reason', 'WALLET_HAS_BALANCE',
            'wallet_balance_minor', v_balance_minor,
            'currency', v_balance->>'currency'
          );
        end if;
      end if;
    end if;

    -- ── ما يُمحى صفّاً ─────────────────────────────────────────────────────
    with gone as (delete from user_notifications where user_id = v_user.id returning 1)
      select count(*) into v_notifications from gone;

    with gone as (delete from saved_places where user_id = v_user.id returning 1)
      select count(*) into v_places from gone;

    -- WR-04: ما كتبَه في محادثاتِ الطلباتِ ومواضعُ قراءتِه — مِلكُه وحدَه.
    delete from order_message_reads where user_id = v_user.id;
    delete from order_messages where sender_user_id = v_user.id;

    -- SEC-19 بندُ ٣: المِلكيّةُ بـ`users.id` الثابتِ — نفسُ المنطقِ في
    -- مسارِ الراكبِ أعلاه.
    with gone as (delete from trip_tracking_tokens
      where created_by_user_id = v_user.id
         or (created_by_user_id is null and created_by = p_telegram_id)
      returning 1)
      select count(*) into v_tokens from gone;

    if v_driver_id is not null then
      with gone as (delete from driver_documents where driver_id = v_driver_id returning 1)
        select count(*) into v_docs from gone;

      with gone as (delete from driver_availability where driver_id = v_driver_id returning 1)
        select count(*) into v_avail from gone;

      with gone as (delete from group_memberships where driver_id = v_driver_id returning 1)
        select count(*) into v_memberships from gone;

      with gone as (delete from driver_capabilities where driver_id = v_driver_id returning 1)
        select count(*) into v_caps from gone;

      with gone as (delete from driver_location_history where driver_id = v_driver_id returning 1)
        select count(*) into v_loc from gone;

      with gone as (delete from tracking_sessions where driver_id = v_driver_id returning 1)
        select count(*) into v_tracking from gone;
    else
      v_docs := 0; v_avail := 0; v_caps := 0; v_loc := 0; v_tracking := 0; v_memberships := 0;
    end if;

    -- ── ما يُجهَّلُ في مكانِه ───────────────────────────────────────────────
    with hushed as (
      update broadcast_recipients
         set chat_id = v_sentinel, claim_token = null
       where user_id = v_user.id
      returning 1
    ) select count(*) into v_broadcasts from hushed;

    -- صندوقُ الصادرِ يحملُ **مقصداً**: `chat_id` هوَ عينُ ما يُوصِلُ إلى
    -- إنسانٍ. ولا يُصفَّرُ (`chat_id <> 0` قيدٌ) بل يُبدَلُ بالحاجزِ السالبِ
    -- نفسِه، ويُمحى معرّفُ الرسالةِ المُوصَلةِ وآخرُ عطبٍ.
    if v_driver_id is not null then
      with hushed as (
        update notification_outbox
           set chat_id = v_sentinel,
               delivered_message_id = null,
               last_error = null
         where driver_id = v_driver_id or recipient_user_id = v_user.id
        returning 1
      ) select count(*) into v_outbox from hushed;

      with hushed as (
        update subscription_notices
           set chat_id = v_sentinel, message_id = null
         where driver_id = v_driver_id
        returning 1
      ) select count(*) into v_notices from hushed;

      -- صفُّ السياقةِ يبقى **لأنَّ المالَ مُعلَّقٌ به**: الفواتيرُ والمحفظةُ
      -- والحضورُ كلُّها تُشيرُ إليه، ومحوُه يمحوها معَه بالسلسلةِ. فيُجهَّلُ:
      -- لوحةٌ ورقمُ هويّةٍ وصورةٌ وشعارٌ وباركودٌ وموضعٌ ومنطقةٌ مُفضَّلةٌ.
      update drivers
         set plate_number              = null,
             national_id               = null,
             vehicle_photo_file_id     = null,
             logo_object_path          = null,
             barcode_object_path       = null,
             preferred_area_label      = null,
             preferred_area_location   = null,
             last_location             = null,
             last_location_at          = null,
             last_location_accuracy_m  = null,
             last_location_quality     = null,
             last_location_recorded_at = null,
             rating_average            = null,
             rating_count              = 0
       where id = v_driver_id;
    else
      with hushed as (
        update notification_outbox
           set chat_id = v_sentinel,
               delivered_message_id = null,
               last_error = null
         where recipient_user_id = v_user.id
        returning 1
      ) select count(*) into v_outbox from hushed;
      v_notices := 0;
    end if;

    -- ── ما بقيَ بأساسٍ: يُعَدُّ ولا يُمَسُّ ─────────────────────────────────
    select count(*) into v_consents   from user_consents    where user_id = v_user.id;
    select count(*) into v_ratings    from ratings          where rater_user_id = v_user.id or ratee_user_id = v_user.id;
    select count(*) into v_tickets    from support_tickets  where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_incidents  from safety_incidents where reporter_user_id = v_user.id;
    select count(*) into v_audit      from audit_log        where actor_user_id = v_user.id;

    select count(*) into v_attendance from attendance_log              where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_ledger     from ledger_entries              where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_payments   from payment_transactions        where v_driver_id is not null and payer_driver_id = v_driver_id;
    select count(*) into v_invoices   from subscription_invoices       where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_refunds    from subscription_refunds        where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_wallet_rows from subscription_wallet_entries where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_wallets    from subscription_wallets        where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_subs       from subscriptions               where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_offers     from order_offers                where v_driver_id is not null and driver_id = v_driver_id;
    select count(*) into v_claims     from unsubscribed_claims         where v_driver_id is not null and driver_id = v_driver_id;

    v_receipt := jsonb_build_object(
      'erased', jsonb_build_object(
        'driverDocuments', v_docs,
        'driverAvailability', v_avail,
        'groupMemberships', v_memberships,
        'driverCapabilities', v_caps,
        'driverLocationHistory', v_loc,
        'trackingSessions', v_tracking,
        'notificationsReceived', v_notifications,
        'savedPlaces', v_places,
        'tripTrackingTokens', v_tokens
      ),
      'anonymized', jsonb_build_object(
        'profile', 1,
        'driverProfile', case when v_driver_id is null then 0 else 1 end,
        'broadcastsReceived', v_broadcasts,
        'notificationOutbox', v_outbox,
        'subscriptionNotices', v_notices
      ),
      'retained', jsonb_build_array(
        jsonb_build_object('section', 'consents',                 'rows', v_consents,    'basis', 'CONSENT_IS_COMPLIANCE_EVIDENCE'),
        jsonb_build_object('section', 'ratings',                  'rows', v_ratings,     'basis', 'RATING_IS_TESTIMONY_FOR_THE_OTHER_PARTY'),
        jsonb_build_object('section', 'supportTickets',           'rows', v_tickets,     'basis', 'SUPPORT_RECORD_MAY_BE_DISPUTED'),
        jsonb_build_object('section', 'safetyIncidents',          'rows', v_incidents,   'basis', 'SAFETY_REPORT_MAY_BE_DISPUTED'),
        jsonb_build_object('section', 'auditTrail',               'rows', v_audit,       'basis', 'AUDIT_TRAIL_PROVES_THIS_ERASURE'),
        jsonb_build_object('section', 'driverAttendance',         'rows', v_attendance,  'basis', 'ATTENDANCE_PROVES_DRIVER_ENTITLEMENT'),
        jsonb_build_object('section', 'ledgerEntries',            'rows', v_ledger,      'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'paymentTransactions',      'rows', v_payments,    'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionInvoices',     'rows', v_invoices,    'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionRefunds',      'rows', v_refunds,     'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionWalletEntries','rows', v_wallet_rows, 'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptionWallets',      'rows', v_wallets,     'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'subscriptions',            'rows', v_subs,        'basis', 'MONEY_RECORD_IS_ACCOUNTING_EVIDENCE'),
        jsonb_build_object('section', 'orderOffers',              'rows', v_offers,      'basis', 'DISPATCH_DECISION_IS_EVIDENCE_FOR_THE_OTHER_PARTY'),
        jsonb_build_object('section', 'unsubscribedClaims',       'rows', v_claims,      'basis', 'DISPATCH_DECISION_IS_EVIDENCE_FOR_THE_OTHER_PARTY')
      )
    );
  end if;

  -- ── تجهيلُ الجذرِ: به تنقطعُ نسبةُ كلِّ ما بقيَ إلى إنسانٍ ────────────────
  update users
     set telegram_id       = null,
         telegram_username = null,
         full_name         = null,
         phone             = null,
         is_blocked        = true,
         erased_at         = now()
   where id = v_user.id;

  -- **الأثرُ يُقرأُ بعدَ التجهيلِ لا قبلَه، ولا تكتبُه هذه الدالّةُ**: كتبَه
  -- المُشغِّلُ `users_mark_identity_before_erasure` في أثناءِ التحديثِ أعلاه.
  select count(*) into v_bar_rows
    from identity_marks im
   where im.telegram_hash = identity_hash(p_telegram_id::text);

  v_receipt := jsonb_set(
    v_receipt,
    '{retained}',
    (v_receipt->'retained') || jsonb_build_array(
      jsonb_build_object(
        'section', 'identityBar', 'rows', v_bar_rows, 'basis', 'BLOCK_AND_STANDING_SURVIVE_ERASURE'
      )
    )
  );

  -- الإيصالُ يُقيَّدُ في `audit_log`: صنفُه هناكَ «لا مدّةَ له» وهوَ عينُ ما
  -- يلزمُ إيصالَ حذفٍ. والفاعلُ صاحبُ الحسابِ نفسُه، ومفتاحُه `restrict` فلا
  -- يذهبُ الإيصالُ معَ الصفِّ.
  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_user.city_id, v_user.id, 'account.erased', 'user', v_user.id, v_receipt);

  return jsonb_build_object('ok', true, 'reason', 'ERASED', 'erased_at', now(), 'receipt', v_receipt);
end;
$function$;

-- ٦) حالةُ البحثِ للراكب: ثلاثةُ حقولٍ جديدة، والمجدولُ يُلغى بلا عقوبة.
CREATE OR REPLACE FUNCTION public.ride_search_state(p_telegram_id bigint, p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_user_id   uuid;
  v_rider_id  uuid;
  v_order     record;
  v_notified  integer;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ORDER_ID');
  end if;

  select u.id into v_user_id from users u where u.telegram_id = p_telegram_id;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select r.id into v_rider_id from riders r where r.user_id = v_user_id;

  if v_rider_id is null then
    return jsonb_build_object('ok', false, 'error', 'RIDER_NOT_REGISTERED');
  end if;

  -- الملكيّةُ شرطُ القراءةِ، **وغيرُ المالكِ يُرَدُّ بـ`ORDER_NOT_FOUND` لا
  -- بـ`FORBIDDEN`**: رمزُ المنعِ يُقِرُّ بوجودِ الرحلةِ لمن ليسَ له، فيُصبِحُ
  -- عدَّادَ معرّفاتٍ صحيحةً لمن يجرِّبُها.
  select o.id, o.status, o.service, o.broadcast_round, o.created_at, o.assigned_driver_id,
         o.searching_since, o.pickup_at, o.dispatch_at
    into v_order
  from orders o
  where o.id = p_order_id and o.rider_id = v_rider_id;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select count(distinct oo.driver_id) into v_notified
  from order_offers oo
  where oo.order_id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'status', v_order.status,
    'service', v_order.service,
    'broadcast_round', v_order.broadcast_round,
    'created_at', v_order.created_at,
    -- `WR-06`: بدءُ البحثِ الفعليّ (إطلاقُ المجدولِ) ليُقاسَ منه العدّاد، وموعدا المجدول.
    'search_started_at', coalesce(v_order.searching_since, v_order.created_at),
    'pickup_at', v_order.pickup_at,
    'dispatch_at', v_order.dispatch_at,
    'notified_driver_count', coalesce(v_notified, 0),
    -- الدائرةُ الأوسعُ مفتوحةٌ: صفٌّ واحدٌ في دوراتِ غيرِ المشتركينَ يكفي —
    -- والفهرسُ الفريدُ الجزئيُّ `unsubscribed_negotiations_single_open` يمسُّ
    -- الحيَّ منها، وههنا يُسألُ عن الوجودِ قطّ (أيُّ دورةٍ) لأنَّ الراكبَ يسألُ
    -- «هل وسّعتم؟» لا «في أيِّ دورةٍ أنا؟».
    'wider_circle_opened', exists (
      select 1 from unsubscribed_negotiations un where un.order_id = v_order.id
    ),
    -- التصعيدُ المُسلَّمُ وحدَهُ (راجعْ تعليقَ الرأسِ): الصفوفُ القديمةُ بلا
    -- المفتاحِ تُقرَأُ مُسلَّمةً كما في حراسةِ `mark_escalation_delivered`.
    'escalated', exists (
      select 1 from audit_log a
       where a.entity_type = 'order' and a.entity_id = v_order.id
         and a.action = 'order.escalated'
         and coalesce((a.payload->>'delivered')::boolean, true) = true
    ),
    -- الإلغاءُ **بلا عقوبةٍ قبلَ الإسنادِ** نصُّ `SR-05`. والقابليّةُ تُحكَمُ ههنا
    -- لا في العميلِ، لأنَّ زرّاً يُظهِرُهُ العميلُ بحسبِ حالةٍ قديمةٍ يُلغي رحلةً
    -- أُسنِدَت فعلاً — أو يُخفي زرّاً يستحقُّه الراكبُ.
    'cancellable_without_penalty', v_order.status in ('searching', 'scheduled')
  );
end;
$function$;
revoke all on function erase_my_account(bigint) from public, anon, authenticated;
grant execute on function erase_my_account(bigint) to service_role;

-- ٧) الإنشاء: الحكمُ بالجدولةِ في معاملةِ الإنشاءِ نفسِها.
--
-- التغييرُ على صورةِ `request_ride_with_offer` القائمة:
--   أ) قبلَ التفويضِ: يُقفَلُ صفُّ الراكبِ (القفلُ نفسُه الذي يأخذُه `request_ride` بعدُ
--      فلا تعارض)، ومجدولٌ قائمٌ للخدمةِ نفسِها يُرَدُّ `ACTIVE_RIDE_EXISTS` كما يُرَدُّ
--      البحثُ — إلّا إعادةَ المفتاحِ نفسِه فجوابُها الأوّلُ.
--   ب) بعدَ الإنشاءِ: موعدٌ أبعدُ من مهلةِ الإطلاقِ ⇒ `scheduled` و`dispatch_at`، وحدثُ
--      `SCHEDULED` للراكب. والصفُّ لم يُرَ خارجَ المعاملةِ بعدُ، فلا يلتقطُه البثّ.
--   ج) الردُّ يحملُ `status` و`pickup_at` و`dispatch_at` (وللإعادةِ أيضًا).
create or replace function request_ride_with_offer(
  p_telegram_id bigint, p_key text, p_service service_type,
  p_origin_lat double precision, p_origin_lng double precision,
  p_dest_lat double precision, p_dest_lng double precision, p_notes text,
  p_pickup_label text, p_dropoff_label text, p_pickup_at timestamptz, p_offer_sar integer,
  p_pickup_place jsonb, p_dropoff_place jsonb, p_offer_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result   jsonb;
  v_order_id uuid;
  v_rider_id uuid;
  v_existing record;
  v_order    record;
  v_lead     integer;
begin
  if p_offer_mode is null or p_offer_mode not in ('fixed', 'suggested', 'open') then
    return jsonb_build_object('ok', false, 'error', 'OFFER_MODE_INVALID');
  end if;
  if p_offer_mode = 'open' and p_offer_sar is not null then
    return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_UNEXPECTED');
  end if;
  if p_offer_mode in ('fixed', 'suggested') then
    if p_offer_sar is null then
      return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_REQUIRED');
    end if;
    if p_offer_sar < 1 or p_offer_sar > 10000 then
      return jsonb_build_object('ok', false, 'error', 'OFFER_AMOUNT_INVALID');
    end if;
  end if;

  -- (أ) المجدولُ القائمُ يحجبُ كما يحجبُ البحث.
  select r.id into v_rider_id
    from users u join riders r on r.user_id = u.id
   where u.telegram_id = p_telegram_id
   for update of r;
  if v_rider_id is not null
     and not exists (select 1 from orders o
                      where o.rider_id = v_rider_id and o.idempotency_key = p_key) then
    select o.id, o.status into v_existing
      from orders o
     where o.rider_id = v_rider_id and o.service = p_service and o.status = 'scheduled'
     order by o.created_at
     limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'ok', false, 'error', 'ACTIVE_RIDE_EXISTS',
        'order_id', v_existing.id, 'status', v_existing.status);
    end if;
  end if;

  v_result := request_ride_with_places(
    p_telegram_id, p_key, p_service,
    p_origin_lat, p_origin_lng, p_dest_lat, p_dest_lng, p_notes,
    p_pickup_label, p_dropoff_label, p_pickup_at, p_offer_sar,
    p_pickup_place, p_dropoff_place
  );

  if (v_result->>'ok')::boolean is not true then
    return v_result;
  end if;
  v_order_id := (v_result->>'order_id')::uuid;

  if coalesce((v_result->>'reused')::boolean, false) is false then
    update orders
       set rider_offer_mode = p_offer_mode
     where id = v_order_id
    returning city_id, pickup_at into v_order;

    -- (ب) الجدولة.
    if v_order.pickup_at is not null then
      v_lead := scheduled_order_minutes(v_order.city_id, 'scheduled_dispatch_lead_minutes');
      if v_order.pickup_at > now() + make_interval(mins => v_lead) then
        update orders
           set status = 'scheduled',
               dispatch_at = v_order.pickup_at - make_interval(mins => v_lead)
         where id = v_order_id and status = 'searching';
        insert into audit_log (city_id, action, entity_type, entity_id, payload)
        values (v_order.city_id, 'order.scheduled', 'order', v_order_id,
                jsonb_build_object('pickup_at', v_order.pickup_at,
                                   'dispatch_at', v_order.pickup_at - make_interval(mins => v_lead),
                                   'lead_minutes', v_lead));
        perform enqueue_rider_trip_notice(v_order_id, 'SCHEDULED');
      end if;
    end if;
  end if;

  -- (ج) الحالةُ وموعداها في الرد.
  select o.status, o.pickup_at, o.dispatch_at into v_existing
    from orders o where o.id = v_order_id;
  return v_result || jsonb_build_object(
    'status', v_existing.status,
    'pickup_at', v_existing.pickup_at,
    'dispatch_at', v_existing.dispatch_at);
end;
$$;
revoke all on function request_ride_with_offer(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function request_ride_with_offer(bigint, text, service_type, double precision, double precision, double precision, double precision, text, text, text, timestamptz, integer, jsonb, jsonb, text) to service_role;

-- ٨) المُطلِق — يُنادى من شوطٍ حرجٍ لكلِّ مدينة. مُسترجَعٌ: ما أُطلِقَ لم يعُد `scheduled`.
create or replace function release_due_scheduled_orders(p_city_id uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grace    integer;
  v_row      record;
  v_released jsonb := '[]'::jsonb;
  v_missed   jsonb := '[]'::jsonb;
begin
  if p_city_id is null then
    return jsonb_build_object('ok', false, 'error', 'CITY_REQUIRED');
  end if;
  v_grace := scheduled_order_minutes(p_city_id, 'scheduled_missed_grace_minutes');

  for v_row in
    select o.id, o.pickup_at, o.dispatch_at
      from orders o
     where o.city_id = p_city_id
       and o.status = 'scheduled'
       and o.dispatch_at <= now()
     order by o.dispatch_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update skip locked
  loop
    if v_row.pickup_at + make_interval(mins => v_grace) < now() then
      -- فاتَ الموعدُ (النظامُ كانَ معطَّلًا): البحثُ الآنَ وعدٌ كاذب.
      update orders
         set status = 'cancelled', cancelled_reason = 'scheduled_missed'
       where id = v_row.id;
      insert into audit_log (city_id, action, entity_type, entity_id, payload)
      values (p_city_id, 'order.scheduled_missed', 'order', v_row.id,
              jsonb_build_object('pickup_at', v_row.pickup_at, 'dispatch_at', v_row.dispatch_at,
                                 'late_seconds', floor(extract(epoch from now() - v_row.dispatch_at))::integer,
                                 'grace_minutes', v_grace));
      perform enqueue_rider_trip_notice(v_row.id, 'SCHEDULE_MISSED');
      v_missed := v_missed || to_jsonb(v_row.id);
    else
      update orders
         set status = 'searching', searching_since = now()
       where id = v_row.id;
      insert into audit_log (city_id, action, entity_type, entity_id, payload)
      values (p_city_id, 'order.scheduled_released', 'order', v_row.id,
              jsonb_build_object('pickup_at', v_row.pickup_at, 'dispatch_at', v_row.dispatch_at,
                                 'late_seconds', floor(extract(epoch from now() - v_row.dispatch_at))::integer));
      perform enqueue_rider_trip_notice(v_row.id, 'SEARCH_STARTED');
      v_released := v_released || to_jsonb(v_row.id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'released', v_released, 'missed', v_missed);
end;
$$;
revoke all on function release_due_scheduled_orders(uuid, integer) from public, anon, authenticated;
grant execute on function release_due_scheduled_orders(uuid, integer) to service_role;

-- ٩) التذكيرات — مفتاحٌ لكلِّ طلبٍ (ولكلِّ سائقٍ) فلا يتكرّرُ بعدَ إعادةِ تشغيل.
create or replace function enqueue_scheduled_reminders(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim     integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_row     record;
  v_riders  integer := 0;
  v_drivers integer := 0;
  v_id      uuid;
begin
  -- الراكب: ما زالَ مجدولًا، ودخلَ نافذةَ التذكير، وأُنشئَ قبلَها (من حجزَ قبلَ نصفِ ساعةٍ
  -- لا يُذكَّرُ بما فعلَه للتوّ).
  for v_row in
    select o.id
      from orders o
     where o.status = 'scheduled'
       and o.dispatch_at > now()
       and scheduled_order_minutes(o.city_id, 'scheduled_rider_reminder_minutes') > 0
       and o.pickup_at - make_interval(mins => scheduled_order_minutes(o.city_id, 'scheduled_rider_reminder_minutes')) <= now()
       and o.created_at < o.pickup_at - make_interval(mins => scheduled_order_minutes(o.city_id, 'scheduled_rider_reminder_minutes'))
       and not exists (select 1 from notification_outbox n
                        where n.kind = 'rider_trip_notice'
                          and n.dedup_key = 'rider_trip:' || o.id::text || ':SCHEDULE_REMINDER')
     order by o.pickup_at
     limit v_lim
  loop
    if coalesce((enqueue_rider_trip_notice(v_row.id, 'SCHEDULE_REMINDER')->>'created')::boolean, false) then
      v_riders := v_riders + 1;
    end if;
  end loop;

  -- السائق: طلبٌ كانَ مجدولًا، مُسنَدٌ ولم يصلْ، دخلَ نافذةَ التذكير، وأُسنِدَ قبلَها.
  for v_row in
    select o.id, o.city_id, o.assigned_driver_id, o.pickup_at, d.user_id
      from orders o
      join drivers d on d.id = o.assigned_driver_id
     where o.status = 'matched'
       and o.dispatch_at is not null
       and o.arrived_at is null
       and o.pickup_at > now() - interval '30 minutes'
       and scheduled_order_minutes(o.city_id, 'scheduled_driver_reminder_minutes') > 0
       and o.pickup_at - make_interval(mins => scheduled_order_minutes(o.city_id, 'scheduled_driver_reminder_minutes')) <= now()
       and o.matched_at < o.pickup_at - make_interval(mins => scheduled_order_minutes(o.city_id, 'scheduled_driver_reminder_minutes'))
     order by o.pickup_at
     limit v_lim
  loop
    insert into notification_outbox (city_id, kind, order_id, driver_id, recipient_user_id, payload, dedup_key)
    values (v_row.city_id, 'driver_candidate_notice', v_row.id, v_row.assigned_driver_id, v_row.user_id,
            jsonb_build_object('order_id', v_row.id, 'driver_id', v_row.assigned_driver_id,
                               'outcome', 'PICKUP_REMINDER', 'pickup_at', v_row.pickup_at),
            'driver_pickup_reminder:' || v_row.id::text || ':' || v_row.assigned_driver_id::text)
    on conflict (kind, dedup_key) do nothing
    returning id into v_id;
    if v_id is not null then
      v_drivers := v_drivers + 1;
    end if;
    v_id := null;
  end loop;

  return jsonb_build_object('ok', true, 'rider_reminders', v_riders, 'driver_reminders', v_drivers);
end;
$$;
revoke all on function enqueue_scheduled_reminders(integer) from public, anon, authenticated;
grant execute on function enqueue_scheduled_reminders(integer) to service_role;
