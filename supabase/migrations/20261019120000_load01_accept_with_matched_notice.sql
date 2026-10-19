-- migration-phase: expand
-- =============================================================================
-- LOAD-01 (الدفعةُ الخامسةَ عشرةَ) — قبولُ العرضِ وإيداعُ إشعارِ MATCHED في رحلةِ ذهابٍ وإيابٍ واحدة.
--
-- **المقيسُ (`b12-diag-stab-1`، 2026-10-19، أثرُ التوقيتِ لتجمُّعِ `gatewayRequest`):** كلُّ حجزٍ
-- لمقعدٍ ينتظرُ في الطابورِ ~293ms وسطيًّا (التنفيذُ ~5ms)، وزمنُ المسارِ ≈ عددُ الحجوزاتِ المتسلسلةِ
-- × الانتظار: مساراتُ الحجزِ الواحدِ ~300ms، و`POST /v1/driver/offers/:id/accept` = 607ms لأنّه
-- حجزان متتاليان: `driver_accept_offer` ثمّ `enqueue_rider_trip_notice(order,'MATCHED')` المُنتظَرُ
-- قبلَ الردّ. فـP2 (p95 القبول) ضِعفُ انتظارِ الطابورِ بنيويًّا.
--
-- **التغييرُ:** دالّةٌ مُغلِّفةٌ **جديدةٌ** تنادي الدالّتَين **كما هما حرفًا** في عبارةٍ واحدة:
--   ١. `driver_accept_offer` بلا أيِّ تغيير — هيَ الكاتبُ الوحيدُ للقبولِ (ADR 0117) وفحوصُ
--      المستخدمِ والسائقِ والملكيّةِ والحجبِ فيها طازجةٌ كما كانت، بلا تخزينٍ مؤقّت.
--   ٢. إن نجحَ القبولُ **وليسَ** حجزًا بانتظارِ الراكبِ (WR-09: إشعارُ المرشَّحِ تودِعُه الدالّةُ
--      نفسُها) ⇒ `enqueue_rider_trip_notice(order,'MATCHED')` داخلَ كتلةِ استثناءٍ (نقطةُ حفظٍ):
--      فشلُ الإيداعِ يُتراجَعُ عنه وحدَه ويُعادُ مُعلَنًا في `rider_notice`، **والقبولُ يُثبَّتُ** —
--      ADR 0265 §2 حرفًا: «عطلُ الإيداعِ يُسجَّلُ ولا يحوّلُ الطورَ الناجحَ رفضًا».
-- والإيداعُ صارَ في معاملةِ القبولِ نفسِها: لا نافذةَ انقطاعٍ بينَ تثبيتِ القبولِ وإيداعِ إشعارِه
-- (كانَ سقوطُ العمليّةِ بينَهما يُفقدُ الإشعار).
--
-- لا تعديلَ على دالّةٍ قائمةٍ ولا على جدول؛ والمسارُ القديمُ (نداءانِ) يبقى صالحًا لأيِّ مستدعٍ.
-- =============================================================================

create or replace function driver_accept_offer_with_matched_notice(
  p_telegram_id bigint,
  p_offer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim jsonb;
  v_notice jsonb;
begin
  v_claim := driver_accept_offer(p_telegram_id, p_offer_id);

  if coalesce((v_claim ->> 'ok')::boolean, false) is not true
     or coalesce((v_claim ->> 'pending_rider')::boolean, false) is true
     or (v_claim ->> 'order_id') is null then
    return v_claim;
  end if;

  begin
    v_notice := enqueue_rider_trip_notice((v_claim ->> 'order_id')::uuid, 'MATCHED');
  exception when others then
    -- نقطةُ الحفظِ تُرجِعُ الإيداعَ وحدَه؛ القبولُ قبلَها باقٍ. السببُ رمزُ حالةٍ لا نصُّ خطأ.
    v_notice := jsonb_build_object('ok', false, 'error', 'ENQUEUE_EXCEPTION', 'sqlstate', sqlstate);
  end;

  return v_claim || jsonb_build_object('rider_notice', v_notice);
end;
$$;

comment on function driver_accept_offer_with_matched_notice(bigint, uuid) is
  'LOAD-01 batch 15: driver_accept_offer + MATCHED rider_trip_notice deposit in one round trip; '
  'deposit failure is isolated by a savepoint and reported in rider_notice (ADR 0265 §2).';

revoke all on function driver_accept_offer_with_matched_notice(bigint, uuid) from public, anon, authenticated;
grant execute on function driver_accept_offer_with_matched_notice(bigint, uuid) to service_role;
