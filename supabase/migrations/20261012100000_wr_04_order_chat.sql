-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- WR-04 · المحادثةُ الخاصّةُ الدائمةُ بينَ طرفَي الطلبِ (§4 من خارطةِ التنفيذ)
--
-- الغرض: غرفةُ محادثةٍ لكلِّ طلبٍ بينَ الراكبِ (أو صاحبِ طلبِ التوصيلِ) والسائقِ
--   المُسنَدِ وحدَهما — رسائلُ محفوظةٌ في القاعدةِ لا في ذاكرةِ الواجهة.
--
-- ## القواعدُ (يفرضُها الخادمُ لا الواجهة)
--
-- ١. **الطرفانِ وحدَهما**: الراكبُ صاحبُ `orders.rider_id`، والسائقُ صاحبُ
--    `orders.assigned_driver_id`. ومن ليسَ طرفاً يُجابُ `CHAT_NOT_FOUND` — لا
--    فرقَ بينَ «لا وجودَ لها» و«ليسَت لكَ» كي لا يُكشَفَ وجودُ طلبِ غيرِه.
-- ٢. **الكتابةُ ما دامَ الطلبُ قائماً بعدَ الإسناد** (`matched` · `in_progress`).
--    وبعدَ الانتهاءِ (`completed` · `cancelled` · `failed`) السجلُّ **للقراءةِ**
--    سبعةَ أيّامٍ ثمَّ يُحجَبُ عن الطرفين (`order_chat_read_window`) — ولا تُفتَحُ
--    الكتابةُ بعدَ الانتهاءِ.
-- ٣. **لا تكرارَ عندَ إعادةِ المحاولة**: لكلِّ رسالةٍ معرّفٌ يولِّدُه العميلُ
--    (`client_message_id`)، والفريدُ `(order_id, sender_user_id, client_message_id)`
--    يجعلُ الإرسالَ الثانيَ ردّاً بالرسالةِ نفسِها (`status = duplicate`) لا صفّاً ثانياً.
-- ٤. **لا فقدَ عندَ الاسترجاع**: `seq` تسلسلٌ يُكتَبُ تحتَ قفلٍ استشاريٍّ على
--    الطلبِ، فلا تُلتزَمُ رسالةٌ بتسلسلٍ أصغرَ بعدَ أن قرأَ العميلُ ما بعدَه.
--    والعميلُ يسترجعُ «ما بعدَ آخرِ تسلسلٍ رآه» بعدَ كلِّ انقطاع.
-- ٥. **المنصّةُ ليسَت وسيطاً**: لا سعرَ ولا دفعَ ولا حجبَ أرقامٍ في هذه الدوالّ.
--
-- ## الخصوصيّة
--
-- `erase_my_account` يمحو رسائلَ المستخدمِ ومواضعَ قراءتِه، و`export_my_data`
-- يُنزِّلُ ما كتبَه هوَ وحدَه (`orderMessages`) لا رسائلَ الطرفِ الآخر. والنصُّ
-- لا يُسجَّلُ في أيِّ سجلِّ تشغيل.
--
-- ## التراجع
--
-- إضافةٌ خالصة: جدولانِ جديدانِ وثلاثُ دوالَّ، وتعديلُ دالّتَي المحوِ والتنزيلِ
-- بسطرٍ لكلٍّ منهما. والتراجعُ إعادةُ تعريفِ الدالّتينِ من الهجرةِ السابقةِ
-- (`20260922100000_sec_19_erase_writes_null_telegram_id.sql` وآخرِ تعريفٍ لـ
-- `export_my_data`) ثمَّ `drop` الجدولينِ في طورِ `contract` — ولا بيانَ قائمٌ يُمَسُّ.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists order_messages (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  city_id           uuid not null references cities(id),
  seq               bigint generated always as identity,
  sender_user_id    uuid not null references users(id) on delete cascade,
  sender_role       text not null check (sender_role in ('rider', 'driver')),
  client_message_id uuid not null,
  body              text not null check (length(btrim(body)) >= 1 and length(body) <= 1000),
  created_at        timestamptz not null default now(),
  constraint order_messages_client_unique unique (order_id, sender_user_id, client_message_id)
);

alter table order_messages enable row level security;
revoke all on table order_messages from public, anon, authenticated;

create table if not exists order_message_reads (
  order_id      uuid not null references orders(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  city_id       uuid not null references cities(id),
  last_read_seq bigint not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (order_id, user_id)
);

alter table order_message_reads enable row level security;
revoke all on table order_message_reads from public, anon, authenticated;

-- نافذةُ القراءةِ بعدَ انتهاءِ الطلبِ — مصدرٌ واحدٌ تقرؤه الدوالُّ الثلاث.
create or replace function order_chat_read_window()
returns interval
language sql
immutable
set search_path = public, pg_temp
as $$ select interval '7 days' $$;

revoke all on function order_chat_read_window() from public, anon, authenticated;

/**
 * طرفُ المحادثةِ وحكمُها — دالّةٌ داخليّةٌ تقرؤها الدوالُّ الثلاثُ فلا يتفرّقُ الحكم.
 * تُعيدُ صفّاً واحداً أو لا شيءَ (ليسَ طرفاً، أو لا طلبَ، أو خرجَ من النافذة).
 */
create or replace function order_chat_party(p_telegram_id bigint, p_order_id uuid)
returns table (
  user_id uuid,
  role text,
  city_id uuid,
  order_status order_status,
  service service_type,
  writable boolean,
  counterpart_user_id uuid
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user users%rowtype;
  v_order orders%rowtype;
  v_rider_user uuid;
  v_driver_user uuid;
  v_role text;
  v_ended_at timestamptz;
begin
  select * into v_user from users u where u.telegram_id = p_telegram_id;
  if not found or v_user.erased_at is not null then
    return;
  end if;

  select * into v_order from orders o where o.id = p_order_id;
  if not found then
    return;
  end if;

  select r.user_id into v_rider_user from riders r where r.id = v_order.rider_id;
  if v_order.assigned_driver_id is not null then
    select d.user_id into v_driver_user from drivers d where d.id = v_order.assigned_driver_id;
  end if;

  if v_rider_user is not null and v_rider_user = v_user.id then
    v_role := 'rider';
  elsif v_driver_user is not null and v_driver_user = v_user.id then
    v_role := 'driver';
  else
    return;
  end if;

  -- لا غرفةَ قبلَ الإسنادِ: البحثُ ليسَ علاقةً بينَ طرفين.
  if v_driver_user is null then
    return;
  end if;

  if v_order.status in ('matched', 'in_progress') then
    return query select v_user.id, v_role, v_order.city_id, v_order.status, v_order.service, true,
      case when v_role = 'rider' then v_driver_user else v_rider_user end;
    return;
  end if;

  v_ended_at := coalesce(v_order.completed_at, v_order.updated_at, v_order.created_at);
  if v_order.status in ('completed', 'cancelled', 'failed')
     and v_ended_at > now() - order_chat_read_window() then
    return query select v_user.id, v_role, v_order.city_id, v_order.status, v_order.service, false,
      case when v_role = 'rider' then v_driver_user else v_rider_user end;
  end if;
end;
$$;

revoke all on function order_chat_party(bigint, uuid) from public, anon, authenticated;

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

create or replace function list_order_messages(
  p_telegram_id bigint,
  p_order_id uuid,
  p_after_seq bigint default 0,
  p_limit integer default 200
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 200);
  v_after bigint := greatest(coalesce(p_after_seq, 0), 0);
  v_messages jsonb;
  v_my_read bigint;
  v_their_read bigint;
  v_last_seq bigint;
  v_unread integer;
  v_counterpart_name text;
begin
  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'seq', m.seq,
           'sender_role', m.sender_role,
           'mine', m.sender_user_id = v_party.user_id,
           'client_message_id', case when m.sender_user_id = v_party.user_id then m.client_message_id end,
           'body', m.body,
           'created_at', m.created_at
         ) order by m.seq), '[]'::jsonb)
    into v_messages
    from (
      select * from order_messages
       where order_id = p_order_id and seq > v_after
       order by seq
       limit v_limit
    ) m;

  select coalesce(max(seq), 0) into v_last_seq from order_messages where order_id = p_order_id;
  select coalesce(r.last_read_seq, 0) into v_my_read
    from order_message_reads r where r.order_id = p_order_id and r.user_id = v_party.user_id;
  select coalesce(r.last_read_seq, 0) into v_their_read
    from order_message_reads r where r.order_id = p_order_id and r.user_id = v_party.counterpart_user_id;
  select count(*) into v_unread from order_messages
   where order_id = p_order_id
     and sender_user_id <> v_party.user_id
     and seq > coalesce(v_my_read, 0);
  select nullif(split_part(btrim(coalesce(u.full_name, '')), ' ', 1), '') into v_counterpart_name
    from users u where u.id = v_party.counterpart_user_id;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', p_order_id,
      'service', v_party.service,
      'status', v_party.order_status,
      'writable', v_party.writable
    ),
    'my_role', v_party.role,
    'counterpart', jsonb_build_object(
      'role', case when v_party.role = 'rider' then 'driver' else 'rider' end,
      'first_name', v_counterpart_name
    ),
    'messages', v_messages,
    'last_seq', v_last_seq,
    'my_last_read_seq', coalesce(v_my_read, 0),
    'counterpart_last_read_seq', coalesce(v_their_read, 0),
    'unread', v_unread
  );
end;
$$;

revoke all on function list_order_messages(bigint, uuid, bigint, integer) from public, anon, authenticated;

create or replace function mark_order_messages_read(
  p_telegram_id bigint,
  p_order_id uuid,
  p_seq bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_last bigint;
begin
  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;

  -- لا موضعَ قراءةٍ بعدَ آخرِ رسالةٍ موجودة: العميلُ لا يُعلِنُ قراءةَ ما لم يُكتَب.
  select coalesce(max(seq), 0) into v_last from order_messages where order_id = p_order_id;

  insert into order_message_reads (order_id, user_id, city_id, last_read_seq)
  values (p_order_id, v_party.user_id, v_party.city_id, least(greatest(coalesce(p_seq, 0), 0), v_last))
  on conflict (order_id, user_id) do update
    set last_read_seq = greatest(order_message_reads.last_read_seq, excluded.last_read_seq),
        updated_at = now();

  return jsonb_build_object('ok', true, 'status', 'read');
end;
$$;

revoke all on function mark_order_messages_read(bigint, uuid, bigint) from public, anon, authenticated;

grant execute on function post_order_message(bigint, uuid, uuid, text) to service_role;
grant execute on function list_order_messages(bigint, uuid, bigint, integer) to service_role;
grant execute on function mark_order_messages_read(bigint, uuid, bigint) to service_role;

-- ── المحوُ والتنزيلُ يشملانِ المحادثةَ (القانونُ في `erasure-policy.ts`) ──────
-- التعريفانِ كما هما حرفاً من آخرِ هجرةٍ عرّفَتهما، بإضافةِ ما وُسِمَ `WR-04` وحدَه.

create or replace function erase_my_account(p_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
         and o.status in ('searching', 'matched', 'in_progress');
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
$fn$;

create or replace function export_my_data(p_telegram_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  v_user       users;
  v_rider      riders;
  v_driver     drivers;
  v_city_name  text;
begin
  if p_telegram_id is null then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_ACTOR');
  end if;

  select * into v_user from users where telegram_id = p_telegram_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'USER_NOT_FOUND');
  end if;

  if v_user.erased_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'ACCOUNT_ERASED');
  end if;

  select * into v_rider from riders where user_id = v_user.id;
  -- **يُقرأُ للدورَينِ**: قد يكونُ لصاحبِ الحسابِ صفُّ سياقةٍ وإن لم يكن دورُه
  -- `driver` (حسابٌ حُوِّلَ)، والحزمةُ تقولُ ما في القاعدةِ لا ما في الدورِ.
  select * into v_driver from drivers where user_id = v_user.id;
  select c.name_ar into v_city_name from cities c where c.id = v_user.city_id;

  return jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    -- **الدورُ يُقرأُ من الصفِّ لا يُثبَّتُ نصّاً**: كانَ `'rider'` حرفاً، وحينَ
    -- صارَت الحزمةُ للسائقِ كذلكَ (`SD-12`) لَكانَ نصّاً كاذباً في حزمتِه.
    'subject', v_user.role,
    'sections', jsonb_build_object(

      -- profile ← users. لا `id` ولا `city_id`: معرّفاتٌ داخليّةٌ لا بيانةُ
      -- إنسانٍ، واسمُ المدينةِ هوَ ما يعني صاحبَها.
      'profile', jsonb_build_object(
        'telegram_id', v_user.telegram_id,
        'telegram_username', v_user.telegram_username,
        'full_name', v_user.full_name,
        'phone', v_user.phone,
        'language_code', v_user.language_code,
        'role', v_user.role,
        'city', v_city_name,
        'is_blocked', v_user.is_blocked,
        'created_at', v_user.created_at
      ),

      'riderProfile', case when v_rider.id is null then '{}'::jsonb else jsonb_build_object(
        'rating_average', v_rider.rating_average,
        'rating_count', v_rider.rating_count,
        'created_at', v_rider.created_at
      ) end,

      -- orderMessages (WR-04): ما كتبَه هوَ في محادثةِ الطلبِ — لا رسائلُ الطرفِ الآخرِ.
      'orderMessages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'order_id', om.order_id,
          'sender_role', om.sender_role,
          'body', om.body,
          'created_at', om.created_at
        ) order by om.seq)
        from order_messages om where om.sender_user_id = v_user.id
      ), '[]'::jsonb),

      'savedPlaces', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sp.kind,
          'label', sp.label,
          'latitude', st_y(sp.point::geometry),
          'longitude', st_x(sp.point::geometry),
          'created_at', sp.created_at
        ) order by sp.created_at)
        from saved_places sp where sp.user_id = v_user.id
      ), '[]'::jsonb),

      -- orders: بلا `assigned_driver_id` ولا اسمِ سائقٍ — حقُّ الوصولِ في
      -- بيانتِه لا نافذةٌ على الطرفِ الآخرِ. ويُنزَّلُ **أنَّ سائقاً أُسنِدَ**
      -- لأنَّ ذاكَ واقعةُ رحلتِه، لا **مَن هوَ**.
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', o.service,
          'status', o.status,
          'pickup_label', o.pickup_label,
          'dropoff_label', o.dropoff_label,
          'pickup_latitude', st_y(o.pickup::geometry),
          'pickup_longitude', st_x(o.pickup::geometry),
          'dropoff_latitude', st_y(o.dropoff::geometry),
          'dropoff_longitude', st_x(o.dropoff::geometry),
          'notes', o.notes,
          'driver_was_assigned', (o.assigned_driver_id is not null),
          'matched_at', o.matched_at,
          'started_at', o.started_at,
          'completed_at', o.completed_at,
          'cancelled_reason', o.cancelled_reason,
          'created_at', o.created_at
        ) order by o.created_at)
        from orders o
        where v_rider.id is not null and o.rider_id = v_rider.id
      ), '[]'::jsonb),

      -- ratings: ما أعطاه وما نالَه. وفي المنالِ **لا مَن كتبَه**.
      'ratings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'role', case when r.rater_user_id = v_user.id then 'given' else 'received' end,
          'stars', r.stars,
          'comment', r.comment,
          'is_flagged', r.is_flagged,
          'created_at', r.created_at
        ) order by r.created_at)
        from ratings r
        where r.rater_user_id = v_user.id or r.ratee_user_id = v_user.id
      ), '[]'::jsonb),

      'consents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', uc.kind,
          'version', uc.version,
          'accepted_at', uc.accepted_at
        ) order by uc.accepted_at)
        from user_consents uc where uc.user_id = v_user.id
      ), '[]'::jsonb),

      'notificationsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', un.kind,
          'channel', un.channel,
          'payload', un.payload,
          'created_at', un.created_at,
          'read_at', un.read_at
        ) order by un.created_at)
        from user_notifications un where un.user_id = v_user.id
      ), '[]'::jsonb),

      -- supportTickets: نصُّ شكواه والرَدُّ عليها. بلا `claimed_by_user_id`
      -- ولا `resolved_by_user_id`: هُويّةُ موظَّفِ الدعمِ ليست بيانتَه.
      'supportTickets', coalesce((
        select jsonb_agg(jsonb_build_object(
          'type', st.type,
          'message', st.message,
          'status', st.status,
          'resolution', st.resolution,
          'created_at', st.created_at,
          'resolved_at', st.resolved_at,
          'lost_at', st.lost_at
        ) order by st.created_at)
        from support_tickets st
        where st.rider_id is not null and v_rider.id is not null and st.rider_id = v_rider.id
      ), '[]'::jsonb),

      'safetyIncidents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reporter_role', si.reporter_role,
          'status', si.status,
          'decision', si.decision,
          'last_known_latitude', st_y(si.last_known_location::geometry),
          'last_known_longitude', st_x(si.last_known_location::geometry),
          'created_at', si.created_at,
          'decided_at', si.decided_at
        ) order by si.created_at)
        from safety_incidents si where si.reporter_user_id = v_user.id
      ), '[]'::jsonb),

      -- auditTrail: الفعلُ وختمُه. **بلا `payload`** — قد يحملُ بيانةَ غيرِه،
      -- ومصدرُ حقيقةِ بيانتِه هوَ الأقسامُ أعلاه لا حِمْلُ سجلٍّ.
      'auditTrail', coalesce((
        select jsonb_agg(jsonb_build_object(
          'action', al.action,
          'entity_type', al.entity_type,
          'created_at', al.created_at
        ) order by al.created_at)
        from audit_log al where al.actor_user_id = v_user.id
      ), '[]'::jsonb),

      -- broadcastsReceived: بلا `chat_id` ولا `claim_token` — معرّفُ محادثةٍ
      -- ورمزٌ نافذٌ. ويُنزَّلُ أنَّه بُلِّغَ ومتى.
      'broadcastsReceived', coalesce((
        select jsonb_agg(jsonb_build_object(
          'status', br.status,
          'language_code', br.language_code,
          'sent_at', br.sent_at,
          'created_at', br.created_at
        ) order by br.created_at)
        from broadcast_recipients br where br.user_id = v_user.id
      ), '[]'::jsonb),

      -- tripTrackingTokens: **وجودُ** رابطِ مشاركةٍ لا قيمتُه. رمزٌ نافذٌ في
      -- ملفٍّ يُنزَّلُ على جهازٍ هوَ مفتاحٌ عاملٌ بيدِ مَن يقرأُ الملفَّ.
      'tripTrackingTokens', coalesce((
        select jsonb_agg(jsonb_build_object(
          'created_at', tt.created_at,
          'expires_at', tt.expires_at,
          'revoked_at', tt.revoked_at,
          'token_disclosed', false
        ) order by tt.created_at)
        from trip_tracking_tokens tt where tt.created_by_user_id = v_user.id or (tt.created_by_user_id is null and tt.created_by = p_telegram_id)
      ), '[]'::jsonb),

      -- identityBar: **أثرُ حذفٍ سابقٍ إن كانَ**. ولا تُنزَّلُ التجزئةُ نفسُها:
      -- سِلسِلةُ ستّينَ خانةً لا تُفيدُ صاحبَها شيئاً، وإخراجُها يُسلِّمُ لمَن
      -- يقرأُ الملفَّ **مفتاحَ مطابقةٍ** يُثبِتُ به أنَّ فلاناً هوَ فلانٌ.
      -- والمُنزَّلُ هوَ الحكمُ الذي يمسُّه: أمحظورٌ هوَ، وكم مرّةً حُذِفَ،
      -- وهل حُمِلَ تقييمُه (ADR 0113).
      'identityBar', coalesce((
        select jsonb_build_object(
          'is_blocked', im.is_blocked,
          'erasure_count', im.erasure_count,
          'rating_count_carried', im.rating_count,
          'first_marked_at', im.first_marked_at,
          'last_marked_at', im.last_marked_at,
          'hash_disclosed', false
        )
        from identity_marks im
        where im.telegram_hash = identity_hash(p_telegram_id::text)
      ), 'null'::jsonb),

      -- ═══ أقسامُ السائقِ (`SD-12`) ═══════════════════════════════════════
      -- **تُبنى للدورَينِ ولا تُخفى بشرطٍ**: قسمٌ يظهرُ لدورٍ ويغيبُ لدورٍ يجعلُ
      -- شكلَ الحزمةِ مُتغيِّراً، فيكسرُ كلَّ قارئٍ آليٍّ لها. وللراكبِ تُقرأُ
      -- فارغةً — وذاكَ **قولٌ صادقٌ**: لا صفَّ سياقةٍ له.

      'driverProfile', case when v_driver.id is null then '{}'::jsonb else jsonb_build_object(
        'verification_status', v_driver.verification_status,
        'vehicle_type', v_driver.vehicle_type,
        'vehicle_year', v_driver.vehicle_year,
        'plate_number', v_driver.plate_number,
        'national_id_present', (v_driver.national_id is not null),
        'preferred_area_label', v_driver.preferred_area_label,
        'rating_average', v_driver.rating_average,
        'rating_count', v_driver.rating_count,
        'created_at', v_driver.created_at
      ) end,

      -- **رقمُ الهويّةِ لا يُنزَّلُ نصّاً**: صاحبُه يعرفُه، وحزمةُ تنزيلٍ تُرسَلُ
      -- في محادثةٍ تُقرأُ في هاتفٍ مسروقٍ. فيُقالُ **أمُسجَّلٌ هوَ** لا ما هوَ.

      'driverDocuments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'doc_type', dd.doc_type,
          'status', dd.status,
          'expires_at', dd.expires_at,
          'review_note', dd.review_note,
          'submitted_at', dd.submitted_at,
          'reviewed_at', dd.reviewed_at,
          'file_disclosed', false
        ) order by dd.submitted_at)
        from driver_documents dd
        where v_driver.id is not null and dd.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverAvailability', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_available', da.is_available,
          'changed_at', da.changed_at
        ) order by da.changed_at)
        from driver_availability da
        where v_driver.id is not null and da.driver_id = v_driver.id
      ), '[]'::jsonb),

      'groupMemberships', coalesce((
        select jsonb_agg(jsonb_build_object(
          'chat_id', gm.chat_id,
          'status', gm.status,
          'source', gm.source,
          'reason', gm.reason,
          'requested_at', gm.requested_at,
          'decided_at', gm.decided_at
        ) order by gm.requested_at)
        from group_memberships gm
        where v_driver.id is not null and gm.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverCapabilities', coalesce((
        select jsonb_agg(jsonb_build_object(
          'service', dc.service,
          'is_enabled', dc.is_enabled,
          'updated_at', dc.updated_at
        ) order by dc.service)
        from driver_capabilities dc
        where v_driver.id is not null and dc.driver_id = v_driver.id
      ), '[]'::jsonb),

      'driverAttendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'is_available', al.is_available,
          'source', al.source,
          'changed_at', al.changed_at
        ) order by al.changed_at)
        from attendance_log al
        where v_driver.id is not null and al.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **تاريخُ الموضعِ مُسقَّفٌ والسقفُ مُعلَنٌ في الحزمةِ نفسِها**: صفوفُه
      -- تُكتَبُ كلَّ ثوانٍ، فسائقٌ عملَ شهراً قد يُخرِجُ مئاتَ الآلافِ من
      -- الصفوفِ في `jsonb` واحدٍ — فتسقطُ الدالّةُ بالذاكرةِ ولا يَنزِلُ شيءٌ.
      -- والصادقُ أن يُقالَ للإنسانِ **كم أُخرِجَ وما السقفُ ومن أيِّ طرفٍ**، لا
      -- أن يُقطَعَ صامتاً (`ح-5`).
      'driverLocationHistory', jsonb_build_object(
        'cap', 5000,
        'newest_first', true,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'latitude', st_y(h.position::geometry),
            'longitude', st_x(h.position::geometry),
            'accuracy_m', h.accuracy_m,
            'quality', h.quality,
            'source', h.source,
            'recorded_at', h.recorded_at
          ) order by h.recorded_at desc)
          from (
            select dlh.position, dlh.accuracy_m, dlh.quality, dlh.source, dlh.recorded_at
              from driver_location_history dlh
             where v_driver.id is not null and dlh.driver_id = v_driver.id
             order by dlh.recorded_at desc
             limit 5000
          ) h
        ), '[]'::jsonb)
      ),

      'trackingSessions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'started_at', ts.started_at,
          'last_fix_at', ts.last_fix_at,
          'ended_at', ts.ended_at,
          'end_reason', ts.end_reason,
          'fixes', ts.last_sequence
        ) order by ts.started_at)
        from tracking_sessions ts
        where v_driver.id is not null and ts.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **العرضُ يُنزَّلُ ولا يُنزَّلُ معَه طلبُ راكبٍ**: القرارُ واقعةُ السائقِ،
      -- وموضعُ الراكبِ ووجهتُه بيانةُ غيرِه.
      'orderOffers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'round', oo.round,
          'status', oo.status,
          'distance_km', oo.distance_km,
          'expires_at', oo.expires_at,
          'responded_at', oo.responded_at,
          'created_at', oo.created_at
        ) order by oo.created_at)
        from order_offers oo
        where v_driver.id is not null and oo.driver_id = v_driver.id
      ), '[]'::jsonb),

      'unsubscribedClaims', coalesce((
        select jsonb_agg(jsonb_build_object(
          'position', uc.position,
          'outcome', uc.outcome,
          'opened_at', uc.opened_at,
          'closed_at', uc.closed_at
        ) order by uc.opened_at)
        from unsubscribed_claims uc
        where v_driver.id is not null and uc.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'plan', s.plan,
          'status', s.status,
          'trial_ends_at', s.trial_ends_at,
          'current_period_end', s.current_period_end,
          'price_amount', s.price_amount,
          'currency', s.currency,
          'cancel_at_period_end', s.cancel_at_period_end,
          'cancellation_requested_at', s.cancellation_requested_at,
          'cancellation_reason', s.cancellation_reason,
          'created_at', s.created_at
        ) order by s.created_at)
        from subscriptions s
        where v_driver.id is not null and s.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptionInvoices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'invoice_number', si.invoice_number,
          'invoice_year', si.invoice_year,
          'amount_minor', si.amount_minor,
          'currency', si.currency,
          'plan', si.plan,
          'issued_at', si.issued_at
        ) order by si.issued_at)
        from subscription_invoices si
        where v_driver.id is not null and si.driver_id = v_driver.id
      ), '[]'::jsonb),

      'subscriptionRefunds', coalesce((
        select jsonb_agg(jsonb_build_object(
          'amount_minor', sr.amount_minor,
          'currency', sr.currency,
          'destination', sr.destination,
          'reason', sr.reason,
          'reference', sr.reference,
          'created_at', sr.created_at
        ) order by sr.created_at)
        from subscription_refunds sr
        where v_driver.id is not null and sr.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **الرصيدُ لا يُحسَبُ ههنا**: مصدرُ حقيقتِه `subscription_wallet_balance`،
      -- وجمعٌ ثانٍ في دالّةِ تنزيلٍ يجعلُ للمالِ حسابَينِ (القاعدة 0.6).
      'subscriptionWallets', case when v_driver.id is null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', sw.currency,
          'created_at', sw.created_at,
          'balance', subscription_wallet_balance(sw.driver_id)
        ))
        from subscription_wallets sw
        where sw.driver_id = v_driver.id
      ), '[]'::jsonb) end,

      'subscriptionWalletEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entry_kind', swe.entry_kind,
          'direction', swe.direction,
          'amount_minor', swe.amount_minor,
          'currency', swe.currency,
          'reason', swe.reason,
          'reference', swe.reference,
          'created_at', swe.created_at
        ) order by swe.created_at)
        from subscription_wallet_entries swe
        where v_driver.id is not null and swe.driver_id = v_driver.id
      ), '[]'::jsonb),

      'paymentTransactions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'purpose', pt.purpose,
          'amount_minor', pt.amount_minor,
          'currency', pt.currency,
          'provider', pt.provider,
          'status', pt.status,
          'created_at', pt.created_at
        ) order by pt.created_at)
        from payment_transactions pt
        where v_driver.id is not null and pt.payer_driver_id = v_driver.id
      ), '[]'::jsonb),

      'ledgerEntries', coalesce((
        select jsonb_agg(jsonb_build_object(
          'entry_type', le.entry_type,
          'amount_minor', le.amount_minor,
          'currency', le.currency,
          'created_at', le.created_at
        ) order by le.created_at)
        from ledger_entries le
        where v_driver.id is not null and le.driver_id = v_driver.id
      ), '[]'::jsonb),

      -- **الصادرُ يُنزَّلُ حالاً لا مضموناً**: `payload` فيه بيانةُ طلبٍ لراكبٍ
      -- ونصُّ رسالةٍ، وإخراجُه يجعلُ حزمةَ السائقِ نافذةً على غيرِه.
      'notificationsSent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', no2.kind,
          'status', no2.status,
          'attempts', no2.attempts,
          'delivered_at', no2.delivered_at,
          'error_code', no2.error_code,
          'created_at', no2.created_at,
          'payload_disclosed', false
        ) order by no2.created_at)
        from notification_outbox no2
        where (v_driver.id is not null and no2.driver_id = v_driver.id)
           or no2.recipient_user_id = v_user.id
      ), '[]'::jsonb),

      'subscriptionNotices', coalesce((
        select jsonb_agg(jsonb_build_object(
          'kind', sn.kind,
          'status', sn.status,
          'attempts', sn.attempts,
          'sent_at', sn.sent_at,
          'error_code', sn.error_code,
          'created_at', sn.created_at
        ) order by sn.created_at)
        from subscription_notices sn
        where v_driver.id is not null and sn.driver_id = v_driver.id
      ), '[]'::jsonb)
    )
  );
end;
$fn$;
