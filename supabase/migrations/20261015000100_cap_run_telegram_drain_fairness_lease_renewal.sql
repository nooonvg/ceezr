-- migration-phase: expand

-- CAP-RUN-20261015 — إصلاحان لمستنزفِ تحديثاتِ تيليجرام كشفهما الحملُ المحلّيُّ المعزول:
--
-- D2 (حجبُ رأسِ الصفِّ بين البوتين): الالتقاطُ بـ created_at وحدَه جعلَ كلَّ المساراتِ (96) تمتلئُ
--    بوظائفِ بوتٍ واحدٍ ينتظرُ دلوَ إرسالِه (25/ث)، فوقفَ البوتُ الآخرُ تمامًا وطابورُه آلافٌ.
--    `claim_telegram_update_job_for_bot` نسخةٌ حرفيّةٌ من `claim_telegram_update_job` بقيدِ `bot = p_bot`
--    فقط (الاسترجاعُ والموتُ والإيصالُ كما هي)، ليوزّعَ المستنزفُ المساراتِ بين البوتين.
--
-- D3 (معالجةٌ مزدوجةٌ بانتهاءِ الإيجار): وظيفةٌ ملتقَطةٌ تنتظرُ في مسارِ مستخدمِها خلفَ وظائفِه
--    السابقةِ بينما إيجارُها (30ث) يجري، فيسترجعُها التقاطٌ آخرُ وتُعالَجُ مرّتين (stamp_failed=93 مقيسةً).
--    `renew_telegram_update_leases` يجدّدُ claimed_at لما زالَ محجوزًا بالرمزِ نفسِه فقط.
--    عمليّةٌ ميتةٌ لا تجدّدُ، فيبقى الاسترجاعُ بعدَ المهلةِ ضمانَ «مرّةً على الأقلّ» كما كان.

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
  select bot, update_id, payload, attempts
    into v_bot, v_uid, v_payload, v_attempts
    from telegram_update_jobs
   where status = 'pending' and attempts < p_max_attempts
     and next_attempt_at <= now()
     and bot = p_bot
   order by created_at
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

create or replace function renew_telegram_update_leases(
  p_bots text[],
  p_update_ids bigint[],
  p_tokens uuid[]
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update telegram_update_jobs j
     set claimed_at = now()
    from unnest(p_bots, p_update_ids, p_tokens) as t(bot, update_id, token)
   where j.bot = t.bot and j.update_id = t.update_id
     and j.claim_token = t.token and j.status = 'claimed';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function claim_telegram_update_job_for_bot(integer, integer, text) to service_role;
grant execute on function renew_telegram_update_leases(text[], bigint[], uuid[]) to service_role;
revoke execute on function claim_telegram_update_job_for_bot(integer, integer, text) from public, anon, authenticated;
revoke execute on function renew_telegram_update_leases(text[], bigint[], uuid[]) from public, anon, authenticated;
