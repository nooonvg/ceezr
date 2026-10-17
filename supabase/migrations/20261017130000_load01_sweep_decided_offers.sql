-- migration-phase: expand
-- =============================================================================
-- `LOAD-01 Recovery` (CAP-RUN-20261016-CONTINUATION · المرحلة 6-استكمال — الجدار
-- الثاني: الإشعارات) — كنزُ العروضِ المحسومةِ من طابورِ الإشعاراتِ: العرضُ الذي
-- قُبِلَ أو أُلغيَ أو انتهت صلاحيّتُهُ لا معنى لإشعارِهِ أصلًا، وبقاؤُهُ «معلّقًا»
-- في الطابورِ يؤخّرُ المعالجَ ويكسرُ بوابةَ P7 (أقدمُ معلّقٍ ≤ 120ث) ولو كانَ
-- الواحدُ فقطُ.
--
-- **لِمَ كنسٌ لا انتظارُ المعالجِ:** المعالجُ يعرفُ أنَّ العرضَ محسومٌ فيتخلّى
-- عنهُ (`offer_notice.abandoned`) — لكنَّ وصولَهُ إليهِ مشروطٌ بمعدلِ الالتقاطِ
-- (٢٠٠٠ صفٍّ في الشوطِ)؛ ففي موجةِ ١٠٠ قعدَ صفٌّ واحدٌ من ~١٦ ألفًا معلّقًا ١٨٥ث
-- (أخفقَ P7) وهوَ لأجلِ عرضٍ حُسمَ قبلَ ذلكَ بدقائقَ. الكنسُ يُخرجُ الصفوفَ
-- المحسومةَ **جملةً** بعبارةٍ واحدةٍ لا صفًّا صفًّا، فيتفرّغُ الطابورُ للحيِّ
-- منهُ (الإشعاراتُ الحرجةُ والعروضُ القابلةُ للقبولِ فعلًا) ويصيرُ الذيلُ داخلَ
-- الحدودِ.
--
-- **العقدُ مع المعالجِ:** الكنسُ لا يمسُّ إلا الصفوفَ «المعلّقةَ» (`pending`)
-- من نوعِ العرضِ فقط — لا يلمسُ صفًّا في يدِ المعالجِ (`sending`) ولا نوعًا
-- آخرَ، وسمُّ الموتِ هوَ نفسُهُ الذي يكتبُهُ المعالجُ (`ABANDONED`) فلا يظهرُ
-- فشلٌ جديدٌ في التقاريرِ.
-- **العودة:** حذفُ الدالّةِ (لا مخططَ يُفكُّ) — الطابورُ يعودُ إلى انتظارِ
-- المعالجِ صفًّا صفًّا كما كانَ.
-- =============================================================================

create or replace function public.sweep_decided_offer_notifications()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_swept integer;
begin
  update notification_outbox n
     set status = 'dead',
         dead_reason = 'ABANDONED',
         died_at = now(),
         updated_at = now(),
         claim_token = null,
         claimed_at = null
   where n.status = 'pending'
     and n.kind = 'offer'
     and exists (
       select 1 from order_offers o
        where o.id = n.offer_id
          and o.status in ('accepted'::offer_status, 'cancelled'::offer_status, 'expired'::offer_status)
     );
  get diagnostics v_swept = row_count;

  return jsonb_build_object('ok', true, 'swept', v_swept);
end $$;

-- الخدمةُ وحدَها تناديهِ (الشوطُ الدوريُّ)؛ لا عميلَ ولا مجهولًا.
revoke execute on function public.sweep_decided_offer_notifications() from public, anon, authenticated;
grant execute on function public.sweep_decided_offer_notifications() to service_role;
