-- migration-phase: expand
-- =============================================================================
-- S5 (D8 · التكليفُ السابعُ) — فصلُ الأثرِ التجاريِّ لتحديثِ تيليجرامَ عن إرسالِ
-- ردِّ الحوارِ. ADR 0288.
--
-- العطبُ المقيسُ (r8/r9): المعالجُ ينفّذُ الأثرَ (كتابةٌ في القاعدةِ)، ثم يرسلُ
-- الردَّ؛ فإن رُفضَ الإرسالُ (429/شبكةٌ) أعادَ `false` فختمَ المستنزفُ الوظيفةَ
-- `NOT_HANDLED` وأعادَها — **فأُعيدَ تنفيذُ الأثرِ كلِّه** بسببِ رسالةٍ لاحقةٍ
-- (الوظيفةُ 262749294: اكتملتْ في المحاولةِ الثانيةِ بعدَ 19.7ث).
--
-- الحلُّ: صفُّ الوظيفةِ `(bot, update_id)` — وهوَ مفتاحٌ فريدٌ أصلًا — يصيرُ
-- **دفترَ الأثرِ**: بعدَ أن يحسبَ المعالجُ ردودَه (والأثرُ قد ثبتَ)، تُثبَّتُ في
-- **معاملةٍ واحدةٍ**: ختمُ الأثرِ (`effect_recorded_at`) + نيّةُ الردِّ الدائمةُ
-- (`replies`) + إتمامُ الوظيفةِ (`done`). بعدَها الإرسالُ مسارٌ منفصلٌ بحالتِه
-- (`reply_status`) ومحاولاتِه وتراجعِه ومهلتِه — فشلُه لا يُعيدُ الوظيفةَ أبدًا.
-- وإعادةُ التحديثِ نفسِه (إيجارٌ انقضى قبلَ الإتمامِ) تجدُ الختمَ فلا يُعادُ الأثرُ.
--
-- ما لا يُدّعى: Telegram لا يقدّمُ مفتاحَ تماثلٍ لـ sendMessage، فالرسالةُ
-- الخارجيةُ «مرةً على الأقلِّ» لا «مرةً واحدةً» — انقطاعٌ بعدَ قبولِ تيليجرامَ
-- وقبلَ تقدّمِ المؤشرِ يُعيدُ الردَّ نفسَه عندَ الاستردادِ (مُوثَّقٌ ومُختبَرٌ).
--
-- التراجعُ: أعمدةٌ ودوالُّ مضافةٌ؛ إسقاطُ الدوالِّ يعيدُ المسارَ القديمَ (المعالجُ
-- يرسلُ مباشرةً) — والأعمدةُ الفارغةُ لا تمسُّ قراءةً قائمةً.
-- =============================================================================

alter table public.telegram_update_jobs
  add column if not exists effect_recorded_at timestamptz,
  add column if not exists replies jsonb,
  add column if not exists replies_sent integer not null default 0,
  add column if not exists reply_status text,
  add column if not exists reply_attempts integer not null default 0,
  add column if not exists reply_next_attempt_at timestamptz,
  add column if not exists reply_claim_token uuid,
  add column if not exists reply_claimed_at timestamptz,
  add column if not exists reply_last_error text;

alter table public.telegram_update_jobs
  add constraint telegram_update_jobs_reply_status_check
  check (reply_status is null or reply_status in ('pending', 'sending', 'done', 'dead')) not valid;

-- ------------------------------------------------------------------------------
-- (١) ختمُ الأثرِ + نيّةُ الردِّ + إتمامُ الوظيفةِ — ذرّيًا. لا يعملُ إلا لحائزِ
-- الإيجارِ الحيِّ (رمزُه)؛ والختمُ السابقُ (إعادةٌ) يُعيدُ `first=false` بلا تغييرٍ
-- في الردودِ. ويعيدُ رمزَ «المسارِ السريعِ» الذي يملكُ الردودَ للإرسالِ الفوريِّ.
-- ------------------------------------------------------------------------------
create or replace function public.record_telegram_update_effect(
  p_bot text, p_update_id bigint, p_claim_token uuid, p_replies jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_recorded timestamptz;
  v_count integer;
  v_token uuid;
begin
  if p_bot is null or p_update_id is null or p_claim_token is null
     or p_replies is null or jsonb_typeof(p_replies) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  select effect_recorded_at into v_recorded
    from telegram_update_jobs
   where bot = p_bot and update_id = p_update_id
     and status = 'claimed' and claim_token = p_claim_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  if v_recorded is not null then
    -- إعادةٌ: الأثرُ والردودُ ثابتانِ سلفًا — تُتمُّ الوظيفةُ ولا يُكتبُ ردٌّ ثانٍ.
    update telegram_update_jobs
       set status = 'done', claim_token = null, claimed_at = null,
           completed_at = coalesce(completed_at, now()), error_code = null
     where bot = p_bot and update_id = p_update_id;
    update telegram_update_receipts
       set status = 'done', claim_token = null, claimed_at = null, completed_at = now()
     where bot = p_bot and update_id = p_update_id;
    return jsonb_build_object('ok', true, 'first', false, 'reply_token', null);
  end if;

  v_count := jsonb_array_length(p_replies);
  v_token := case when v_count > 0 then gen_random_uuid() else null end;

  update telegram_update_jobs
     set status = 'done', claim_token = null, claimed_at = null,
         completed_at = now(), error_code = null,
         effect_recorded_at = now(),
         replies = p_replies,
         replies_sent = 0,
         reply_status = case when v_count > 0 then 'sending' else 'done' end,
         reply_attempts = 0,
         reply_next_attempt_at = null,
         reply_claim_token = v_token,
         reply_claimed_at = case when v_count > 0 then now() else null end,
         reply_last_error = null
   where bot = p_bot and update_id = p_update_id;
  update telegram_update_receipts
     set status = 'done', claim_token = null, claimed_at = null, completed_at = now()
   where bot = p_bot and update_id = p_update_id;

  return jsonb_build_object('ok', true, 'first', true, 'reply_token', v_token, 'replies', v_count);
end $function$;

-- ------------------------------------------------------------------------------
-- (٢) هل خُتمَ أثرُ هذا التحديثِ؟ — يُسألُ قبلَ تشغيلِ المعالجِ: الإعادةُ لا تُنفِّذُ
-- الأثرَ ثانيةً.
-- ------------------------------------------------------------------------------
create or replace function public.telegram_update_effect_recorded(p_bot text, p_update_id bigint)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select exists (
    select 1 from telegram_update_jobs
     where bot = p_bot and update_id = p_update_id and effect_recorded_at is not null)
$function$;

-- ------------------------------------------------------------------------------
-- (٣) ختمُ محاولةِ إرسالٍ: `p_sent` = عددُ الردودِ المقبولةِ منَ البدايةِ (مؤشرٌ
-- لا يتراجعُ). الكلُّ ⇒ `done`. وإلا تراجعٌ أُسّيٌّ (أو `retry_after` المزودِ)
-- حتى سقفِ المحاولاتِ أو عمرِ الردِّ — ثم `dead` بسببٍ مُسمّى (لا تعليقَ أبديٌّ).
-- ------------------------------------------------------------------------------
create or replace function public.finish_telegram_update_replies(
  p_bot text, p_update_id bigint, p_reply_token uuid, p_sent integer,
  p_error text default null, p_retry_after_seconds integer default null,
  p_max_attempts integer default 8, p_max_age_seconds integer default 900
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_total integer;
  v_sent integer;
  v_attempts integer;
  v_created timestamptz;
  v_delay integer;
begin
  if p_bot is null or p_update_id is null or p_reply_token is null or p_sent is null or p_sent < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;
  select jsonb_array_length(replies), replies_sent, reply_attempts, created_at
    into v_total, v_sent, v_attempts, v_created
    from telegram_update_jobs
   where bot = p_bot and update_id = p_update_id
     and reply_status = 'sending' and reply_claim_token = p_reply_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  v_sent := greatest(v_sent, least(p_sent, v_total));
  if v_sent >= v_total then
    update telegram_update_jobs
       set replies_sent = v_sent, reply_status = 'done', reply_claim_token = null,
           reply_claimed_at = null, reply_last_error = null
     where bot = p_bot and update_id = p_update_id;
    return jsonb_build_object('ok', true, 'outcome', 'done');
  end if;

  v_attempts := v_attempts + 1;
  if v_attempts >= p_max_attempts or v_created < now() - make_interval(secs => p_max_age_seconds) then
    update telegram_update_jobs
       set replies_sent = v_sent, reply_status = 'dead', reply_attempts = v_attempts,
           reply_claim_token = null, reply_claimed_at = null,
           reply_last_error = left(coalesce(p_error, 'REPLY_FAILED'), 300)
     where bot = p_bot and update_id = p_update_id;
    return jsonb_build_object('ok', true, 'outcome', 'dead');
  end if;

  v_delay := greatest(coalesce(p_retry_after_seconds, 0), least(60, (2 ^ v_attempts)::integer));
  update telegram_update_jobs
     set replies_sent = v_sent, reply_status = 'pending', reply_attempts = v_attempts,
         reply_next_attempt_at = now() + make_interval(secs => v_delay),
         reply_claim_token = null, reply_claimed_at = null,
         reply_last_error = left(coalesce(p_error, 'REPLY_FAILED'), 300)
   where bot = p_bot and update_id = p_update_id;
  return jsonb_build_object('ok', true, 'outcome', 'retried', 'retry_in_seconds', v_delay);
end $function$;

-- ------------------------------------------------------------------------------
-- (٤) التقاطُ الردودِ المعلّقةِ للمرسِلِ الخلفيِّ: المستحقُّ زمنيًّا، والمحمولُ
-- الذي ماتَ حائزُه (إيجارُ الإرسالِ انقضى — عاملٌ أُعيدَ تشغيلُه). بترتيبِ
-- المسارِ (البوت+المستخدم): لا يُلتقطُ ردُّ تحديثٍ وأمامَه ردٌّ أقدمُ للمستخدمِ نفسِه.
-- ------------------------------------------------------------------------------
create or replace function public.claim_telegram_update_replies(
  p_limit integer default 20, p_lease_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_rows jsonb;
begin
  if p_limit is null or p_limit <= 0 or p_lease_seconds is null or p_lease_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  with due as (
    select j.bot, j.update_id
      from telegram_update_jobs j
     where (
             (j.reply_status = 'pending' and j.reply_next_attempt_at <= now())
          or (j.reply_status = 'sending' and j.reply_claimed_at < now() - make_interval(secs => p_lease_seconds))
           )
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.reply_status in ('pending', 'sending')
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at
     for update skip locked
     limit p_limit
  ), claimed as (
    update telegram_update_jobs j
       set reply_status = 'sending', reply_claim_token = gen_random_uuid(), reply_claimed_at = now()
      from due
     where j.bot = due.bot and j.update_id = due.update_id
    returning j.bot, j.update_id, j.replies, j.replies_sent, j.reply_claim_token, j.reply_attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'bot', bot, 'update_id', update_id, 'replies', replies,
           'replies_sent', replies_sent, 'reply_token', reply_claim_token,
           'attempts', reply_attempts)), '[]'::jsonb)
    into v_rows from claimed;

  return jsonb_build_object('ok', true, 'jobs', v_rows);
end $function$;

revoke all on function record_telegram_update_effect(text, bigint, uuid, jsonb) from public, anon, authenticated;
grant execute on function record_telegram_update_effect(text, bigint, uuid, jsonb) to service_role;
revoke all on function telegram_update_effect_recorded(text, bigint) from public, anon, authenticated;
grant execute on function telegram_update_effect_recorded(text, bigint) to service_role;
revoke all on function finish_telegram_update_replies(text, bigint, uuid, integer, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function finish_telegram_update_replies(text, bigint, uuid, integer, text, integer, integer, integer) to service_role;
revoke all on function claim_telegram_update_replies(integer, integer) from public, anon, authenticated;
grant execute on function claim_telegram_update_replies(integer, integer) to service_role;
