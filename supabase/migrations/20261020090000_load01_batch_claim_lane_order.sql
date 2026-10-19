-- migration-phase: expand
-- =============================================================================
-- LOAD-01 (الدفعةُ 20) — إعادةُ شرطِ D4 إلى الالتقاطِ الدُّفعيِّ لوظائفِ تحديثِ تيليجرام.
--
-- **الخلل:** `20261018140000` نسخَ دلالةَ الالتقاطِ المفردِ «حرفيًّا» إلا شرطَ D4 من
-- `20261015000200`: لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ أقدمُ له معلَّقةٌ (ولو في فترةِ
-- احتياطٍ) أو محجوزة. بدونه: وظيفةٌ أقدمُ فشلت فدخلت الاحتياطَ تُتجاوَزُ ويُعالَجُ اللاحقُ قبلَها،
-- ونسختانِ من البوابةِ تلتقطانِ تحديثَي المستخدمِ نفسِه فتعالجانِهما متوازيَين. والدرينرُ يصونُ
-- الترتيبَ داخلَ عمليّةٍ واحدةٍ بسلاسلِ المسارات فقط.
-- مُثبَتٌ قبلَ الإصلاحِ وبعدَه: tests/integration/telegram-update-batch-claim-lane-order.test.ts
--
-- كلُّ ما عداه حرفيٌّ من `20261018140000`: الاسترجاعُ والإماتةُ، و`skip locked`، ومحاولةٌ +1،
-- ومرآةُ الإيصال، والقصُّ إلى [1، 100]، والترتيبُ بـ`created_at`.
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
    select j.bot, j.update_id
      from telegram_update_jobs j
     where j.status = 'pending' and j.attempts < p_max_attempts
       and j.next_attempt_at <= now()
       and j.bot = p_bot
       -- D4 (كما في الالتقاطِ المفرد `20261015000200`): لا تُلتقَطُ وظيفةُ مستخدمٍ وأمامَها وظيفةٌ
       -- أقدمُ له معلَّقةٌ (ولو في فترةِ احتياطٍ) أو محجوزة. يخدمُه الفهرسُ
       -- (lane_key, created_at, update_id) من `20261016120300`.
       and (j.lane_key is null or not exists (
             select 1 from telegram_update_jobs e
              where e.lane_key = j.lane_key
                and e.status in ('pending', 'claimed') and e.attempts < p_max_attempts
                and (e.created_at, e.update_id) < (j.created_at, j.update_id)))
     order by j.created_at
     for update of j skip locked
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
