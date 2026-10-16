-- migration-phase: expand
-- =============================================================================
-- `D8` (CAP-RUN-20261016-CONTINUATION · المرحلة 4) — إعادةُ صفِّ صندوقِ الصادرِ بعدَ
-- ازدحامِ دلاءِ الإرسالِ: ضغطٍ عابرٍ لا فشلِ إرسالٍ.
--
-- **المقيسُ (جولتا J1/J2 على مقعدِ D8):** المسارُ الذي يلتقطُ صفًّا لمحادثةٍ ساخنةٍ
-- (دلوُّها ١/ث) ينتظرُ فتحتَها داخلَ المسارِ فيَجمُدُ — فلا يزيدَ تصريفُ الشوطِ على
-- ~٥ صفوفٍ/ثانيةٍ مهما بذلَ. هذا التغييرُ هو النصفُ الثاني: المُرسِلُ يُخلي سبيلَهُ
-- سريعًا (مهلةُ دلوٍّ قصيرةٌ ثمَّ `OutboundCongestionError`)، وهذه الدالةُ تُعيدُ
-- الصفَّ إلى الطابورِ بموعدِ الفتحةِ القادمةِ **دون أن تُحسَبَ لهذه الدورةِ محاولةٌ**
-- — فالموتُ باستنفادِ المحاولاتِ (`MAX_ATTEMPTS`) لعثراتِ الإرسالِ الحقيقيةِ لا
-- لازدحامٍ يزولُ بزوالِ الحملِ، والمسارُ يتفرّغُ لصفٍّ لمحادثةٍ باردةٍ.
--
-- الأمانُ كفينيش/تخلٍّ: بالرمزِ لا بالصفِّ — لا يعملُ إلا على صفٍّ `sending` يحملُ
-- الرمزَ نفسَه، والصفُّ يُقفلُ حتى نهايةِ المعاملةِ.

create or replace function public.requeue_notification_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_retry_after_ms integer
)
returns jsonb
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

  select * into v_row from notification_outbox
   where id = p_delivery_id and status = 'sending' and claim_token = p_claim_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_CLAIMED_BY_CALLER');
  end if;

  -- موعدُ الفتحةِ القادمةِ من تقديرِ المُرسِلِ، مسقوفٌ بدقيقةٍ وصافرٍ أدنى.
  v_delay := greatest(0, least(coalesce(p_retry_after_ms, 1000), 60000)) / 1000.0;

  update notification_outbox
     set status = 'pending',
         next_attempt_at = now() + make_interval(secs => v_delay),
         -- الازدحامُ لا يُحسَبُ محاولةً: الاستحواذُ زادَها، وهنا تُرَدُّ — فالموتُ
         -- باستنفادِ المحاولاتِ لعثراتِ الإرسالِ الحقيقيةِ لا لهذا الضغطِ العابرِ.
         attempts = greatest(0, v_row.attempts - 1),
         claim_token = null,
         claimed_at = null,
         last_error = 'OUTBOUND_CONGESTION',
         updated_at = now()
   where id = p_delivery_id;

  return jsonb_build_object(
    'ok', true, 'outcome', 'requeued',
    'attempts', greatest(0, v_row.attempts - 1),
    'next_attempt_at', now() + make_interval(secs => v_delay)
  );
end $function$;

-- `SECURITY DEFINER` لا يكفي وحده: الدالة الجديدة تُمنح PUBLIC افتراضياً عند إنشائها،
-- وصندوقُ الصادرِ ساحةُ خدمةٍ لا ساحةَ جمهورٍ — الإحالةُ إلى الطابورِ قرارُ المستهلِكِ
-- المُوثَّقِ بالرمزِ، لا باباً يفتحُه من هبطَ على الصفِّ.
grant execute on function requeue_notification_delivery(uuid, uuid, integer) to service_role;
revoke execute on function requeue_notification_delivery(uuid, uuid, integer) from public, anon, authenticated;
