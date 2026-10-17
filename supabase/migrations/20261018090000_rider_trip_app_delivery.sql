-- migration-phase: expand
-- =============================================================================
-- ADR 0287 (LOAD-01 · التكليفُ السابعُ) — تسليمُ أطوارِ الرحلةِ للراكبِ
-- **Mini App أولًا بإقرارٍ منَ العميلِ، وتيليجرامُ احتياطًا**.
--
-- عقدُ WR-15 (ADR 0265) لا يتغيّرُ عددًا ولا معنًى: صفٌّ دائمٌ واحدٌ لكلِّ
-- (طلبٍ، طورٍ) بمفتاحِ `rider_trip:<order>:<event>` — هوَ معرّفُ الحدثِ الثابتُ
-- ومفتاحُ إزالةِ التكرارِ معًا، وتسلسلُ الأطوارِ في الرحلةِ ثابتٌ
-- (MATCHED=1، ARRIVED=2، STARTED=3، COMPLETED=4). الذي تغيّرَ **القناةُ**: الحدثُ
-- يُعدُّ «وصلَ» إذا (أ) أقرَّ العميلُ بعدَ تطبيقِهِ في Mini App، أو (ب) قبِلَ
-- Telegram API بطاقتَهُ بعدَ انقضاءِ مهلةِ الإقرارِ. وكلٌّ منهما مدوَّنٌ منفصلًا:
--
--   ــ `rider_trip_event_receipts`: **إيصالُ Mini App** — العميلُ طبّقَ الحدثَ
--      ثم أقرَّ. لا يُكتبُ عندَ البثِّ (`socket.emit`) ولا عندَ قراءةِ القائمةِ
--      (GET) — الإقرارُ نداءٌ مستقلٌّ لاحقٌ.
--   ــ `delivered_channel = 'miniapp_ack'`: الصفُّ أُغلقَ بإيصالِ Mini App.
--   ــ `delivered_channel = 'telegram'` + `delivered_message_id`: **قبولُ
--      Telegram API** فقط (لا دليلَ ظهورٍ في الهاتفِ — كما كانَ في ADR 0265).
--
-- وإيصالُ Mini App يُدوَّنُ ولو كانَ الصفُّ قد أُغلقَ بتيليجرامَ (إقرارٌ متأخرٌ):
-- فالقناتانِ تُحاسَبانِ منفصلتينِ ولا يمحو أحدُهما الآخرَ.
--
-- التراجعُ: الجدولُ والدوالُّ إضافاتٌ؛ وإعادةُ `finish_notification_delivery_via_board`
-- إلى نسختِها (20261017120100) تعيدُ السلوكَ السابقَ بلا فقدِ بياناتٍ. وتبديلُ
-- قيدَي القناةِ (الحذفُ) في ملفِّ طورِ العقدِ المرافقِ 20261018090100 وحدَه.
-- =============================================================================

create table if not exists public.rider_trip_event_receipts (
  -- معرّفُ الحدثِ الثابتُ = معرّفُ صفِّ الصادرِ (فريدٌ بمفتاحِ الإزالةِ).
  delivery_id uuid primary key references public.notification_outbox (id) on delete cascade,
  order_id uuid not null,
  rider_user_id uuid not null,
  -- القاعدةُ 0.4: كلُّ جدولٍ يحملُ مدينتَهُ — منسوخةٌ من صفِّ الصادرِ نفسِهِ.
  city_id uuid not null,
  event text not null,
  acked_at timestamptz not null default now(),
  foreign key (city_id) references cities (id)
);
-- لا فهرسَ ثانويًّا: القراءةُ تمرُّ من مفاتيحِ الإزالةِ الأربعةِ إلى المفتاحِ
-- الأساسيِّ (delivery_id) — والتقريرُ بالطلبِ يمرُّ من صفوفِ الصادرِ نفسِها.

alter table public.rider_trip_event_receipts enable row level security;
drop policy if exists rider_trip_event_receipts_service_role on public.rider_trip_event_receipts;
create policy rider_trip_event_receipts_service_role on public.rider_trip_event_receipts
  for all to service_role using (true) with check (true);
grant select, insert on public.rider_trip_event_receipts to service_role;
revoke all on public.rider_trip_event_receipts from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- تسلسلُ الطورِ في الرحلةِ — ثابتٌ لا يُشتقُّ منَ الزمنِ (الصفوفُ قد تُدرجُ في
-- اللحظةِ نفسِها). `null` لغيرِ أطوارِ الرحلةِ الأربعةِ: تلكَ تبقى تيليجرامَ أولًا.
-- ------------------------------------------------------------------------------
create or replace function public.rider_trip_event_seq(p_event text)
returns integer
language sql
immutable
set search_path = 'public'
as $function$
  select case p_event
    when 'MATCHED' then 1
    when 'ARRIVED' then 2
    when 'STARTED' then 3
    when 'COMPLETED' then 4
    else null
  end
$function$;

-- ------------------------------------------------------------------------------
-- قائمةُ أحداثِ رحلةٍ لراكبِها: الملكيّةُ منَ القاعدةِ (هويةُ الجلسةِ → المستخدمُ
-- → مستلمُ الصفِّ)، لا من معرّفٍ في الطلبِ. الاستعلامُ بالمفاتيحِ الأربعةِ
-- الصريحةِ على الفهرسِ الفريدِ (kind, dedup_key) — لا مسحَ.
-- القراءةُ لا تُسجِّلُ إيصالًا.
-- ------------------------------------------------------------------------------
create or replace function public.list_rider_trip_events(
  p_telegram_user_id bigint, p_order_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_user uuid;
  v_events jsonb;
begin
  if p_telegram_user_id is null or p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;
  select u.id into v_user from users u where u.telegram_id = p_telegram_user_id;
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if not exists (
    select 1 from orders o join riders r on r.id = o.rider_id
     where o.id = p_order_id and r.user_id = v_user
  ) then
    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id,
           'event', n.payload ->> 'event',
           'seq', rider_trip_event_seq(n.payload ->> 'event'),
           'created_at', n.created_at,
           'acked', rc.delivery_id is not null
         ) order by rider_trip_event_seq(n.payload ->> 'event')), '[]'::jsonb)
    into v_events
    from notification_outbox n
    left join rider_trip_event_receipts rc on rc.delivery_id = n.id
   where n.kind = 'rider_trip_notice'
     and n.dedup_key = any (array[
       'rider_trip:' || p_order_id::text || ':MATCHED',
       'rider_trip:' || p_order_id::text || ':ARRIVED',
       'rider_trip:' || p_order_id::text || ':STARTED',
       'rider_trip:' || p_order_id::text || ':COMPLETED'])
     and n.recipient_user_id = v_user;

  return jsonb_build_object('ok', true, 'events', v_events);
end $function$;

-- ------------------------------------------------------------------------------
-- إقرارُ العميلِ بعدَ تطبيقِ الأحداثِ: يُدوَّنُ الإيصالُ للصفوفِ التي يملكُها
-- صاحبُ الجلسةِ وحدَها (ما سواها يُهمَلُ بصمتٍ — لا يُكشفُ وجودُ صفٍّ لغيرِه)،
-- ومتكرّرُ الإقرارِ لا يُنشئُ إيصالًا ثانيًا (`on conflict do nothing`).
-- والصفُّ المنتظرُ (`pending`) يُغلَقُ فورًا `miniapp_ack` فلا يلتقطُه العاملُ
-- أصلًا. والصفُّ الذي يحملُه العاملُ الآنَ (`sending`) لا يُمسُّ: رمزُ الاستحواذِ
-- لصاحبِه، فإن كانَ في انتظارِ الإشارةِ وجدَ الإيصالَ في الالتقاطِ التالي، وإن
-- كانَ يرسلُ بطاقتَه أُغلقَ `telegram` والإيصالُ باقٍ مدوَّنًا (القناتانِ معًا).
-- ------------------------------------------------------------------------------
create or replace function public.ack_rider_trip_events(
  p_telegram_user_id bigint, p_order_id uuid, p_delivery_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_user uuid;
  v_recorded integer := 0;
  v_closed integer := 0;
begin
  if p_telegram_user_id is null or p_order_id is null or p_delivery_ids is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;
  select u.id into v_user from users u where u.telegram_id = p_telegram_user_id;
  if v_user is null then
    return jsonb_build_object('ok', true, 'recorded', 0, 'closed', 0);
  end if;

  with owned as (
    select n.id, n.order_id, n.city_id, n.payload ->> 'event' as event
      from notification_outbox n
     where n.id = any (p_delivery_ids[1:8])
       and n.kind = 'rider_trip_notice'
       and n.order_id = p_order_id
       and n.recipient_user_id = v_user
       and rider_trip_event_seq(n.payload ->> 'event') is not null
  ), ins as (
    insert into rider_trip_event_receipts (delivery_id, order_id, rider_user_id, city_id, event)
    select o.id, o.order_id, v_user, o.city_id, o.event from owned o
    on conflict (delivery_id) do nothing
    returning delivery_id
  ), closed as (
    update notification_outbox n
       set status = 'delivered',
           delivered_channel = 'miniapp_ack',
           delivered_at = now(),
           delivered_message_id = null,
           last_error = null,
           updated_at = now()
      from owned o
     where n.id = o.id and n.status = 'pending'
    returning n.id
  )
  select (select count(*) from ins), (select count(*) from closed)
    into v_recorded, v_closed;

  return jsonb_build_object('ok', true, 'recorded', v_recorded, 'closed', v_closed);
end $function$;

-- ------------------------------------------------------------------------------
-- إعلانُ التسليمِ عبرَ Mini App من العاملِ (الإيصالُ موجودٌ عندَ الالتقاطِ):
-- القناةُ بحسبِ النوعِ — لوحُ العروضِ للسائقِ، وإقرارُ الحدثِ للراكبِ. حارسُ
-- الرمزِ كما كانَ: لا يعملُ إلا على صفٍّ `sending` يحملُ الرمزَ نفسَهُ.
-- ------------------------------------------------------------------------------
create or replace function public.finish_notification_delivery_via_board(
  p_delivery_id uuid, p_claim_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if p_delivery_id is null or p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  update public.notification_outbox
     set status = 'delivered',
         delivered_channel = case when kind = 'rider_trip_notice' then 'miniapp_ack' else 'miniapp_board' end,
         delivered_at = now(),
         delivered_message_id = null,
         claim_token = null,
         claimed_at = null,
         updated_at = now()
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;

  return jsonb_build_object('ok', found);
end $function$;

revoke all on function rider_trip_event_seq(text) from public, anon, authenticated;
grant execute on function rider_trip_event_seq(text) to service_role;
revoke all on function list_rider_trip_events(bigint, uuid) from public, anon, authenticated;
grant execute on function list_rider_trip_events(bigint, uuid) to service_role;
revoke all on function ack_rider_trip_events(bigint, uuid, uuid[]) from public, anon, authenticated;
grant execute on function ack_rider_trip_events(bigint, uuid, uuid[]) to service_role;
-- `finish_notification_delivery_via_board`: `create or replace` يحفظُ صلاحياتِها
-- القائمةَ (20261017120100) — لا منحَ ولا سحبَ جديدًا هنا.
