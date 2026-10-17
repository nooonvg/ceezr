-- migration-phase: expand
-- =============================================================================
-- `LOAD-01 Recovery` (CAP-RUN-20261016-CONTINUATION · المرحلة 6-استكمال — الجدار
-- الثاني: الإشعاراتُ) — قناةُ التسليمِ المعلومةُ في الصفِّ نفسِهِ:
--
-- ١. `delivered_channel`: «بأيِّ قناةٍ وصلَ» — `telegram` (البطاقةُ) أو
--    `miniapp_board` (لوحُ Mini App بإيصالٍ منَ العميلِ). كانَ الصفُّ يقولُ
--    «delivered» ولا يُفصِحُ القناةَ، فلا يُحاسَبُ الطريقُ ولا يُقاسُ أثرُ
--    التحسينِ منَ القاعدةِ. `null` = الصفوفُ القديمةُ (بطاقةُ تيليجرامَ
--    حكمًا — لم يكنْ ثمةَ طريقٌ آخرَ).
--
-- ٢. `signal_wait_count`: عدّادُ انتظارِ إشارةِ اللوحِ — انتظارُ السائقِ
--    المتصلِ **لا يستهلكُ ميزانيةَ محاولاتِ الإرسالِ** (نصيحةُ المراجعةِ:
--    ثلاثُ دوراتِ انتظارٍ من ميزانيةِ بطاقةٍ منَ خمسٍ قد تُميتُ الصفَّ قبلَ أن
--    ينالَ البديلُ فرصتَهُ). فالانتظارُ عدٌّ منفصلٌ مسقوفٌ، والموتُ
--    باستنفادِ المحاولاتِ لعثراتِ الإرسالِ الحقيقيةِ.
--
-- ٣. `finish_notification_delivery_via_board`: إعلانُ التسليمِ عبرَ اللوحِ
--    بإيصالٍ — بالإيصالِ الموجودِ لا بمعرّفِ رسالةٍ مُختلَقٍ (القيدُ القديمُ
--    كانَ يُلزِمُ الصفَّ المسلَّمَ بمعرّفِ رسالةٍ، فلا يُفصَحُ القناةُ). حارسُ
--    الرمزِ نفسُهُ: لا يعملُ إلا على صفٍّ `sending` يحملُ الرمزَ نفسَهُ.
--
-- ٤. `requeue_notification_delivery_signal_wait`: عودةٌ للطابورِ بانتظارِ
--    إشارةِ اللوحِ — كمسارِ الازدحامِ (D8) لا تُحسَبُ محاولةَ إرسالٍ، لكنها
--    تزيدُ عدّادَ الانتظارِ فيُعرفَ متى كفَّ الصفُّ عنِ الانتظارِ وسلَّمَ
--    البطاقةَ.
--
-- التراجعُ: الأعمدةُ إضافاتٌ توسعيةٌ (add column if not exists) لا تكسرُ
-- نسخةً سابقةً، والدالتانِ جديدتانِ — إسقاطُ الكلِّ رجوعٌ بلا خسارةِ فهرسٍ
-- ولا فقدِ بياناتٍ قائمةٍ. وتبديلُ القيدِ (الحذفُ) في ملفِّ طورِ العقدِ
-- المرافقِ 20261017120200 وحدَه.
-- =============================================================================

alter table public.notification_outbox
  add column if not exists delivered_channel text
  check (delivered_channel in ('telegram', 'miniapp_board'));

alter table public.notification_outbox
  add column if not exists signal_wait_count integer not null default 0
  check (signal_wait_count >= 0);

-- ------------------------------------------------------------------------------
-- إعلانُ التسليمِ عبرَ لوحِ Mini App: بالإيصالِ الموجودِ لا بمعرّفِ رسالةٍ.
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
         delivered_channel = 'miniapp_board',
         delivered_at = now(),
         delivered_message_id = null,
         claim_token = null,
         claimed_at = null,
         updated_at = now()
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token;

  return jsonb_build_object('ok', found);
end $function$;

-- ------------------------------------------------------------------------------
-- عودةٌ للطابورِ بانتظارِ إشارةِ اللوحِ: بلا محاولةِ إرسالٍ محسوبةٍ، وبعدّادِ
-- انتظارٍ يزيدُ فيُعلَمُ أنَّ الصفَّ ينتظرُ لا يفشلُ.
-- ------------------------------------------------------------------------------
create or replace function public.requeue_notification_delivery_signal_wait(
  p_delivery_id uuid, p_claim_token uuid, p_retry_after_ms integer
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_row notification_outbox%rowtype;
  v_delay numeric;
begin
  if p_delivery_id is null or p_claim_token is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  select * into v_row from public.notification_outbox
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  v_delay := greatest(0, least(coalesce(p_retry_after_ms, 3000), 60000)) / 1000.0;

  update public.notification_outbox
     set status = 'pending',
         next_attempt_at = now() + make_interval(secs => v_delay),
         -- الانتظارُ لا يُحسَبُ محاولةَ إرسالٍ: الاستحواذُ زادَها وهنا تُرَدُّ،
         -- وعدّادُ الانتظارِ وحدهُ هوَ الذي يزيدُ.
         attempts = greatest(0, v_row.attempts - 1),
         signal_wait_count = v_row.signal_wait_count + 1,
         claim_token = null,
         claimed_at = null,
         last_error = 'SIGNAL_WAIT',
         updated_at = now()
   where id = p_delivery_id;

  return jsonb_build_object(
    'ok', true, 'outcome', 'requeued_signal_wait',
    'attempts', greatest(0, v_row.attempts - 1),
    'signal_wait_count', v_row.signal_wait_count + 1,
    'next_attempt_at', now() + make_interval(secs => v_delay)
  );
end $function$;

grant execute on function finish_notification_delivery_via_board(uuid, uuid) to service_role;
revoke execute on function finish_notification_delivery_via_board(uuid, uuid) from public, anon, authenticated;
grant execute on function requeue_notification_delivery_signal_wait(uuid, uuid, integer) to service_role;
revoke execute on function requeue_notification_delivery_signal_wait(uuid, uuid, integer) from public, anon, authenticated;
