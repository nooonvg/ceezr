-- migration-phase: expand

-- CAP-RUN-20261015 / D4 — ترتيبُ وظائفِ المستخدمِ الواحدِ عبرَ الإعادة.
--
-- العيبُ المقيس: وظيفةٌ فشلت (مثلًا ازدحامُ دلوِ الإرسالِ العالميِّ) تعودُ pending بعدَ 5ث، بينما وظائفُ
-- المستخدمِ نفسِه اللاحقةُ تُلتقَطُ وتُعالَجُ قبلها؛ فخطواتُ حوارِ التسجيلِ تُطبَّقُ بغيرِ ترتيبِها
-- («لم أفهم هذه الرسالة» لخطواتٍ صحيحة، و181 سائقًا لم يكتمل تسجيلُهم في البذر المحلّي).
-- ومساراتُ المستنزفِ في العمليّةِ تحفظُ الترتيبَ داخلَ الشوطِ فقط، لا عبرَ الإعادةِ ولا عبرَ النسخ.
--
-- الإصلاح: `lane_key` عمودٌ مولَّدٌ يطابقُ `laneKeyOf()` في المستنزف (bot:from.id ?? chat.id)، والالتقاطُ
-- يتخطّى وظيفةً أمامَها وظيفةٌ أقدمُ لنفسِ المفتاحِ معلّقةٌ أو محجوزة. فلكلِّ مستخدمٍ وظيفةٌ محجوزةٌ واحدةٌ
-- على الأكثر، ولا تنتظرُ وظائفُه محجوزةً في الذاكرةِ والإيجارُ يجري (جذرُ D3). الوظيفةُ الميتةُ لا تحجبُ.
-- وظيفةٌ بلا مفتاحٍ (تحديثٌ بلا مستخدم) بلا قيدٍ كالسابق.
--
-- كلفةٌ معلنة: إضافةُ عمودٍ مولَّدٍ مخزَّنٍ تعيدُ كتابةَ الجدول (طابورٌ عابرٌ صغيرٌ عادةً)، وفحصُ
-- not exists فهرسيٌّ لكلِّ مرشَّح؛ مستخدمٌ واحدٌ بآلافِ الوظائفِ المتراكمةِ يُبطئُ الالتقاطَ خطّيًّا.

alter table telegram_update_jobs
  add column if not exists lane_key text generated always as (
    bot || ':' || coalesce(
      payload->'message'->'from'->>'id', payload->'message'->'chat'->>'id',
      payload->'edited_message'->'from'->>'id', payload->'edited_message'->'chat'->>'id',
      payload->'callback_query'->'from'->>'id', payload->'callback_query'->'chat'->>'id',
      payload->'chat_join_request'->'from'->>'id', payload->'chat_join_request'->'chat'->>'id',
      payload->'my_chat_member'->'from'->>'id', payload->'my_chat_member'->'chat'->>'id',
      payload->'chat_member'->'from'->>'id', payload->'chat_member'->'chat'->>'id',
      payload->'inline_query'->'from'->>'id'
    )
  ) stored;

-- الفهرسُ (`telegram_update_jobs_lane_open_idx`) في ملفٍّ لاحقٍ وحدَهُ بطورِ `index`
-- لأنَّ `concurrently` لا يُقبَلُ داخلَ معاملةٍ وهذا الملفُّ معاملةٌ واحدةٌ.

create or replace function claim_telegram_update_job(
  p_lease_timeout_seconds integer default 30,
  p_max_attempts integer default 5
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_bot   text;
  v_uid   bigint;
  v_payload jsonb;
  v_attempts integer;
begin
  if p_lease_timeout_seconds is null or p_lease_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LEASE_TIMEOUT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;

  -- (أ) استرجاعُ الإيجاراتِ المنتهيةِ. هذا هو ضمانُ «على الأقلِّ مرّةً»:
  --   الوظيفةُ التي ماتَ حائزُها لا تُهملُ. لكنّها تنقسمُ قسمَينِ:
  --     • retriable (attempts < max): تعودُ معلَّقةً قابلةً للالتقاطِ، ويُزامِنُها الإيصالُ.
  --     • exhausted (attempts >= max): تُختمُ dead مع إيصالِها failed — لا تبقى
  --       عالقةً «معلَّقةً» غيرَ قابلةٍ للالتقاطِ أبداً (ثغرةٌ صامتةٌ).
  with reclaimed as (
    update telegram_update_jobs
       set status = 'pending', claim_token = null, claimed_at = null, error_code = null
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts < p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'pending', claim_token = null, claimed_at = null
   where (bot, update_id) in (select bot, update_id from reclaimed);

  with expired as (
    update telegram_update_jobs
       set status = 'dead', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = coalesce(error_code, 'LEASE_EXPIRED')
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts >= p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'failed', claim_token = null, claimed_at = null, completed_at = now()
   where (bot, update_id) in (select bot, update_id from expired);

  -- (ب) التقاطُ وظيفةٍ معلَّقةٍ واحدةٍ مؤهَّلةٍ زمنيًّا بـ FOR UPDATE SKIP LOCKED:
  -- نسختانِ من الدرينرِ لا تلتقطانِ الصفَّ نفسَه. «مؤهَّلةٌ زمنيًّا» تعني أنّها ليست
  -- في فترةِ احتياطٍ بينَ المحاولتَين — فلا يلتقطُها الدرينرُ فورَ فشلِها فيستنفدَ
  -- المحاولاتِ كلَّها دفعةً واحدة بلا احتياطٍ.
  select j.bot, j.update_id, j.payload, j.attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs j
   where j.status = 'pending' and j.attempts < p_max_attempts
     and j.next_attempt_at <= now()
     -- D4: لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة.
     and (j.lane_key is null or not exists (
           select 1 from telegram_update_jobs e
            where e.lane_key = j.lane_key
              and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
              and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
   order by j.created_at
   for update skip locked
   limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'delivery', null);
  end if;

  v_token := gen_random_uuid();

  update telegram_update_jobs
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  -- مرآةٌ للإيصالِ: حالةٌ متناسقةٌ بينَ النصفينِ، والإيصالُ يعكسُ أنّه قيدُ المعالجةِ.
  update telegram_update_receipts
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'delivery', jsonb_build_object(
      'bot', v_bot,
      'update_id', v_uid,
      'payload', v_payload,
      'claim_token', v_token,
      'attempts', v_attempts + 1,
      'max_attempts', p_max_attempts
    )
  );
end $$;

create or replace function claim_telegram_update_job_for_bot(
  p_lease_timeout_seconds integer,
  p_max_attempts integer,
  p_bot text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_bot   text;
  v_uid   bigint;
  v_payload jsonb;
  v_attempts integer;
begin
  if p_lease_timeout_seconds is null or p_lease_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LEASE_TIMEOUT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;

  -- (أ) استرجاعُ الإيجاراتِ المنتهيةِ. هذا هو ضمانُ «على الأقلِّ مرّةً»:
  --   الوظيفةُ التي ماتَ حائزُها لا تُهملُ. لكنّها تنقسمُ قسمَينِ:
  --     • retriable (attempts < max): تعودُ معلَّقةً قابلةً للالتقاطِ، ويُزامِنُها الإيصالُ.
  --     • exhausted (attempts >= max): تُختمُ dead مع إيصالِها failed — لا تبقى
  --       عالقةً «معلَّقةً» غيرَ قابلةٍ للالتقاطِ أبداً (ثغرةٌ صامتةٌ).
  with reclaimed as (
    update telegram_update_jobs
       set status = 'pending', claim_token = null, claimed_at = null, error_code = null
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts < p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'pending', claim_token = null, claimed_at = null
   where (bot, update_id) in (select bot, update_id from reclaimed);

  with expired as (
    update telegram_update_jobs
       set status = 'dead', claim_token = null, claimed_at = null,
           completed_at = now(), error_code = coalesce(error_code, 'LEASE_EXPIRED')
     where status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_lease_timeout_seconds)
       and attempts >= p_max_attempts
    returning bot, update_id
  )
  update telegram_update_receipts
     set status = 'failed', claim_token = null, claimed_at = null, completed_at = now()
   where (bot, update_id) in (select bot, update_id from expired);

  -- (ب) التقاطُ وظيفةٍ معلَّقةٍ واحدةٍ مؤهَّلةٍ زمنيًّا بـ FOR UPDATE SKIP LOCKED:
  -- نسختانِ من الدرينرِ لا تلتقطانِ الصفَّ نفسَه. «مؤهَّلةٌ زمنيًّا» تعني أنّها ليست
  -- في فترةِ احتياطٍ بينَ المحاولتَين — فلا يلتقطُها الدرينرُ فورَ فشلِها فيستنفدَ
  -- المحاولاتِ كلَّها دفعةً واحدة بلا احتياطٍ.
  select j.bot, j.update_id, j.payload, j.attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs j
   where j.status = 'pending' and j.attempts < p_max_attempts
     and j.next_attempt_at <= now()
     and j.bot = p_bot
     -- D4: لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة.
     and (j.lane_key is null or not exists (
           select 1 from telegram_update_jobs e
            where e.lane_key = j.lane_key
              and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
              and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
   order by j.created_at
   for update skip locked
   limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'delivery', null);
  end if;

  v_token := gen_random_uuid();

  update telegram_update_jobs
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  -- مرآةٌ للإيصالِ: حالةٌ متناسقةٌ بينَ النصفينِ، والإيصالُ يعكسُ أنّه قيدُ المعالجةِ.
  update telegram_update_receipts
     set status = 'claimed', claim_token = v_token,
         claimed_at = now(), attempts = attempts + 1
   where bot = v_bot and update_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'delivery', jsonb_build_object(
      'bot', v_bot,
      'update_id', v_uid,
      'payload', v_payload,
      'claim_token', v_token,
      'attempts', v_attempts + 1,
      'max_attempts', p_max_attempts
    )
  );
end $$;
