-- migration-phase: expand
-- =============================================================================
-- LOAD-01 (الدفعةُ السابعةُ) — التقاطٌ دُفعيٌّ مرتَّبٌ لوظائفِ تحديثِ تيليجرامَ لبوتٍ واحدٍ.
--
-- **المقيسُ (`diag-r12-jobtiming-500`، 2026-10-18):** الدرينرُ يلتقطُ وظيفةً واحدةً في كلِّ
-- رحلةٍ (`claim_telegram_update_job_for_bot`)، والرحلةُ تحتَ 500 متزامنٍ ~40ms (القاعدةُ
-- 1.1ms والباقي حلقةُ البوابةِ)، فلا يتجاوزُ الجاري 4–5 وظائفَ رغمَ 32 مسارًا ويقفُ الإتمامُ
-- عندَ ~25/ث بينما الوصولُ أعلى — فتفوتُ مهلةُ إثباتِ الهاتفِ (20ث) ويسقطُ G1 إلى 73%.
--
-- **لماذا دُفعةٌ لا ملتقِطونَ متوازونَ؟** ترتيبُ تحديثاتِ المستخدمِ الواحدِ (`/start` ثم بطاقةُ
-- الاتصالِ) يحفظُه أنَّ الالتقاطَ تسلسليٌّ بـ`created_at`؛ ملتقِطانِ متوازيانِ قد تعودُ ردودُهما
-- معكوسةً فيُعالَجُ اللاحقُ قبلَ السابقِ. والدفعةُ صفوفٌ مرتّبةٌ في رحلةٍ واحدةٍ ⇒ الترتيبُ
-- محفوظٌ والرحلاتُ أقلُّ.
--
-- الدلالةُ حرفيّةٌ من الالتقاطِ المفردِ: الاسترجاعُ والإماتةُ عندَ انقضاءِ الإيجارِ أولًا، ثم
-- `for update skip locked` (نسختانِ لا تلتقطانِ الصفَّ نفسَه)، ومحاولةٌ +1، ومرآةُ الإيصالِ.
-- والحدُّ مقصوصٌ إلى [1، 100] في القاعدةِ نفسِها فلا يطلبُ مستدعٍ مسرفٌ الطابورَ كلَّه.
-- =============================================================================

create or replace function claim_telegram_update_jobs_for_bot(
  p_lease_timeout_seconds integer,
  p_max_attempts integer,
  p_bot text,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jobs jsonb;
begin
  if p_lease_timeout_seconds is null or p_lease_timeout_seconds <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LEASE_TIMEOUT');
  end if;
  if p_max_attempts is null or p_max_attempts <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MAX_ATTEMPTS');
  end if;
  if p_limit is null or p_limit <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_LIMIT');
  end if;

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


  with picked as (
    select bot, update_id
      from telegram_update_jobs
     where status = 'pending' and attempts < p_max_attempts
       and next_attempt_at <= now()
       and bot = p_bot
     order by created_at
     for update skip locked
     limit least(p_limit, 100)
  ),
  claimed as (
    update telegram_update_jobs j
       set status = 'claimed', claim_token = gen_random_uuid(),
           claimed_at = now(), attempts = j.attempts + 1
      from picked p
     where j.bot = p.bot and j.update_id = p.update_id
    returning j.bot, j.update_id, j.payload, j.claim_token, j.attempts, j.created_at
  ),
  -- مرآةُ الإيصالِ: عبارةُ تعديلٍ في WITH تُنفَّذُ كاملةً مرّةً واحدةً وإن لم تُقرأ.
  mirrored as (
    update telegram_update_receipts r
       set status = 'claimed', claim_token = c.claim_token,
           claimed_at = now(), attempts = r.attempts + 1
      from claimed c
     where r.bot = c.bot and r.update_id = c.update_id
    returning r.update_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bot', c.bot,
               'update_id', c.update_id,
               'payload', c.payload,
               'claim_token', c.claim_token,
               'attempts', c.attempts,
               'max_attempts', p_max_attempts
             ) order by c.created_at, c.update_id
           ),
           '[]'::jsonb)
    into v_jobs
    from claimed c;

  return jsonb_build_object('ok', true, 'jobs', v_jobs);
end $$;

grant execute on function claim_telegram_update_jobs_for_bot(integer, integer, text, integer) to service_role;
revoke execute on function claim_telegram_update_jobs_for_bot(integer, integer, text, integer) from public, anon, authenticated;
