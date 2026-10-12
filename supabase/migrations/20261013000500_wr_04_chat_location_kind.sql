-- migration-phase: expand
-- ────────────────────────────────────────────────────────────────────────────
-- WR-04 · المحادثةُ: نوعُ الرسالةِ (نصٌّ أو موقعٌ) ولغةُ كلِّ طرفٍ للترجمة
--
-- الغرض:
--   ١. رسالةُ «موقع» داخلَ محادثةِ الطلب: نقطةٌ واحدةٌ يختارُ المستخدمُ إرسالَها
--      بفعلٍ صريح، لا تتبّعٌ مستمرٌّ ولا جمعٌ في الخلفيّة. الإحداثيّاتُ تُفحَصُ هنا
--      (نطاقُ خطِّ العرضِ والطول، وعددٌ لا نصّ) لا في الواجهةِ وحدَها.
--   ٢. `list_order_messages` تُعيدُ لغةَ القارئِ ولغةَ الطرفِ الآخرِ من
--      `users.language_code` — المصدرِ الموثوقِ نفسِه الذي يكتبُه حوارُ اللغةِ في
--      البوتَين والـMini App — كي تُترجِمَ البوّابةُ رسائلَ الطرفِ الآخرِ إلى لغةِ
--      القارئِ مع بقاءِ النصِّ الأصليِّ كما كُتِب.
--
-- لا مرفقاتِ ملفّاتٍ هنا: الصورُ والفيديو والصوتُ والمستنداتُ تحتاجُ تخزينًا خاصًّا
-- مُثبَتَ الاستعادة (`WR-21` · `BACKUP-STORAGE-20261011`)، فلا يُقبَلُ في القيدِ نوعٌ
-- غيرُ `text` و`location` حتّى يُفتَحَ ذلكَ بقرار.
--
-- ## التوافق
--   - الدالّةُ القديمةُ `post_order_message(bigint, uuid, uuid, text)` باقيةٌ بتوقيعِها
--     وتُحيلُ إلى الجديدة بنوعِ `text`، فالبوّابةُ المنشورةُ قبلَ هذا التغييرِ تعملُ كما هي.
--   - رسالةُ الموقعِ تحملُ `body` نصّيًّا (الوصفُ أو «lat,lng») فيقرؤها عميلٌ قديمٌ نصًّا
--     ولا يسقط، ويبقى قيدُ `body` القائمُ صحيحًا.
--
-- ## التراجع
--   إعادةُ تعريفِ `post_order_message` و`list_order_messages` من
--   `20261012150000_wr_04_chat_message_notice.sql` و`20261012100000_wr_04_order_chat.sql`،
--   ثمَّ `drop function post_order_message_kind` وحذفُ العمودَين والقيدَين في طورِ
--   `contract`. ولا صفَّ قائمٌ يتغيّر: كلُّ رسالةٍ سابقةٍ `kind = 'text'` بالافتراض.
-- ────────────────────────────────────────────────────────────────────────────

alter table order_messages add column if not exists kind text not null default 'text';
alter table order_messages add column if not exists payload jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'order_messages'::regclass and conname = 'order_messages_kind_check') then
    alter table order_messages add constraint order_messages_kind_check
      check (kind in ('text', 'location')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'order_messages'::regclass
                    and conname = 'order_messages_location_payload_check') then
    alter table order_messages add constraint order_messages_location_payload_check
      check (
        kind <> 'location'
        or (
          payload is not null
          and jsonb_typeof(payload -> 'lat') = 'number'
          and jsonb_typeof(payload -> 'lng') = 'number'
          and (payload ->> 'lat')::numeric between -90 and 90
          and (payload ->> 'lng')::numeric between -180 and 180
        )
      ) not valid;
  end if;
end;
$$;

/**
 * الإرسالُ بنوعٍ — المصدرُ الواحدُ لكلِّ قواعدِ الإرسال (الطرفان، والكتابةُ قبلَ الانتهاء،
 * ومنعُ التكرار، والتسلسلُ تحتَ القفل، وتنبيهُ الطرفِ الآخر). `post_order_message`
 * القديمةُ تُحيلُ إليها.
 */
create or replace function post_order_message_kind(
  p_telegram_id bigint,
  p_order_id uuid,
  p_client_message_id uuid,
  p_kind text,
  p_body text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_party record;
  v_row order_messages%rowtype;
  v_status text := 'added';
  v_kind text := coalesce(p_kind, 'text');
  v_body text := p_body;
  v_payload jsonb := null;
  v_lat numeric;
  v_lng numeric;
  v_accuracy numeric;
  v_label text;
begin
  if p_client_message_id is null then
    return jsonb_build_object('ok', false, 'error', 'CLIENT_ID_INVALID');
  end if;

  if v_kind = 'text' then
    if v_body is null or length(btrim(v_body)) < 1 then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_EMPTY');
    end if;
    if length(v_body) > 1000 then
      return jsonb_build_object('ok', false, 'error', 'MESSAGE_TOO_LONG');
    end if;
  elsif v_kind = 'location' then
    if p_payload is null
       or jsonb_typeof(p_payload -> 'lat') is distinct from 'number'
       or jsonb_typeof(p_payload -> 'lng') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'LOCATION_INVALID');
    end if;
    -- `numeric` لا `double precision`: عددٌ هائلٌ (1e400) يُرفَضُ بالنطاقِ لا بخطأِ تحويل.
    v_lat := (p_payload ->> 'lat')::numeric;
    v_lng := (p_payload ->> 'lng')::numeric;
    if v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
      return jsonb_build_object('ok', false, 'error', 'LOCATION_INVALID');
    end if;
    if jsonb_typeof(p_payload -> 'accuracy_m') = 'number' then
      v_accuracy := (p_payload ->> 'accuracy_m')::numeric;
      if v_accuracy < 0 or v_accuracy > 100000 then
        v_accuracy := null;
      end if;
    end if;
    if jsonb_typeof(p_payload -> 'label') = 'string' then
      v_label := nullif(btrim(p_payload ->> 'label'), '');
      if v_label is not null and length(v_label) > 120 then
        return jsonb_build_object('ok', false, 'error', 'LOCATION_INVALID');
      end if;
    end if;
    -- لا يُحفَظُ إلّا ما فُحِص: لا حقولَ إضافيّةً يمرّرُها العميل.
    v_payload := jsonb_build_object(
      'lat', round(v_lat, 6),
      'lng', round(v_lng, 6),
      'accuracy_m', case when v_accuracy is null then null else round(v_accuracy, 1) end,
      'label', v_label
    );
    v_body := coalesce(v_label, round(v_lat, 6)::text || ',' || round(v_lng, 6)::text);
  else
    return jsonb_build_object('ok', false, 'error', 'MESSAGE_KIND_INVALID');
  end if;

  select * into v_party from order_chat_party(p_telegram_id, p_order_id);
  if v_party is null or v_party.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'CHAT_NOT_FOUND');
  end if;
  if not v_party.writable then
    return jsonb_build_object('ok', false, 'error', 'CHAT_CLOSED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('order_chat:' || p_order_id::text, 0));

  insert into order_messages (
    order_id, city_id, sender_user_id, sender_role, client_message_id, body, kind, payload
  )
  values (
    p_order_id, v_party.city_id, v_party.user_id, v_party.role, p_client_message_id, v_body,
    v_kind, v_payload
  )
  on conflict (order_id, sender_user_id, client_message_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    v_status := 'duplicate';
    select * into v_row from order_messages m
     where m.order_id = p_order_id
       and m.sender_user_id = v_party.user_id
       and m.client_message_id = p_client_message_id;
  end if;

  if v_status = 'added' and v_party.counterpart_user_id is not null then
    perform enqueue_order_chat_notice(
      p_order_id, v_party.city_id, v_party.counterpart_user_id, v_party.role, v_row.seq
    );
  end if;

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
      'kind', v_row.kind,
      'payload', v_row.payload,
      'body', v_row.body,
      'created_at', v_row.created_at
    )
  );
end;
$$;

revoke all on function post_order_message_kind(bigint, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function post_order_message_kind(bigint, uuid, uuid, text, text, jsonb)
  to service_role;

create or replace function post_order_message(
  p_telegram_id bigint,
  p_order_id uuid,
  p_client_message_id uuid,
  p_body text
) returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select post_order_message_kind(p_telegram_id, p_order_id, p_client_message_id, 'text', p_body, null);
$$;

revoke all on function post_order_message(bigint, uuid, uuid, text) from public, anon, authenticated;
grant execute on function post_order_message(bigint, uuid, uuid, text) to service_role;

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
  v_counterpart_language text;
  v_my_language text;
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
           'kind', m.kind,
           'payload', m.payload,
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
  select nullif(split_part(btrim(coalesce(u.full_name, '')), ' ', 1), ''),
         nullif(btrim(coalesce(u.language_code, '')), '')
    into v_counterpart_name, v_counterpart_language
    from users u where u.id = v_party.counterpart_user_id;
  select nullif(btrim(coalesce(u.language_code, '')), '') into v_my_language
    from users u where u.id = v_party.user_id;

  return jsonb_build_object(
    'ok', true,
    'order', jsonb_build_object(
      'id', p_order_id,
      'service', v_party.service,
      'status', v_party.order_status,
      'writable', v_party.writable
    ),
    'my_role', v_party.role,
    'my_language', v_my_language,
    'counterpart', jsonb_build_object(
      'role', case when v_party.role = 'rider' then 'driver' else 'rider' end,
      'first_name', v_counterpart_name,
      'language', v_counterpart_language
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
grant execute on function list_order_messages(bigint, uuid, bigint, integer) to service_role;
