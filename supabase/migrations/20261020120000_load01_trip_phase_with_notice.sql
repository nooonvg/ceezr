-- migration-phase: expand
-- =============================================================================
-- LOAD-01 (الدفعةُ 21) — أطوارُ الرحلةِ الثلاثة وإيداعُ إشعارِ الراكبِ في رحلةِ ذهابٍ وإيابٍ واحدة.
--
-- **المقيسُ (`b21-trace-main-250`، أثرٌ منسوبٌ إلى المسار):** كلٌّ من `POST /v1/driver/job/:id/arrived`
-- و`/start` و`/complete` = استعلامان على مجمّعِ `gatewayRequest`: دالّةُ الطورِ ثمّ
-- `enqueue_rider_trip_notice(order, event)` المُنتظَرُ قبلَ الردّ (3 رحلاتٍ زائدةٌ لكلِّ سيناريو).
--
-- **التغييرُ:** النمطُ نفسُه حرفًا من `20261019120000` (القبولُ + MATCHED): ثلاثُ دوالَّ مُغلِّفةٍ
-- **جديدةٍ** تنادي دالّةَ الطورِ **كما هي** (هيَ وحدَها تتحقّقُ من المستخدمِ والسائقِ والحجبِ
-- والملكيّةِ والمرحلة، طازجةً بلا تخزينٍ مؤقّت)، وإن نجحت ⇒ `enqueue_rider_trip_notice` داخلَ نقطةِ
-- حفظ: فشلُ الإيداعِ يُتراجَعُ عنه وحدَه ويُعادُ مُعلَنًا في `rider_notice`، **والطورُ يُثبَّت** —
-- ADR 0265 §2 حرفًا. لا تعديلَ على دالّةٍ قائمةٍ ولا على جدول؛ والمسارُ القديمُ (نداءانِ) صالح.
-- =============================================================================

create or replace function driver_mark_arrived_with_notice(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_notice jsonb;
begin
  v_result := driver_mark_arrived(p_telegram_id, p_order_id);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return v_result;
  end if;

  begin
    v_notice := enqueue_rider_trip_notice(p_order_id, 'ARRIVED');
  exception when others then
    -- نقطةُ الحفظِ تُرجِعُ الإيداعَ وحدَه؛ الطورُ قبلَها باقٍ. السببُ رمزُ حالةٍ لا نصُّ خطأ.
    v_notice := jsonb_build_object('ok', false, 'error', 'ENQUEUE_EXCEPTION', 'sqlstate', sqlstate);
  end;

  return v_result || jsonb_build_object('rider_notice', v_notice);
end;
$$;

comment on function driver_mark_arrived_with_notice(bigint, uuid) is
  'LOAD-01 batch 21: driver_mark_arrived + ARRIVED rider_trip_notice deposit in one round trip; '
  'deposit failure is isolated by a savepoint and reported in rider_notice (ADR 0265 §2).';

revoke all on function driver_mark_arrived_with_notice(bigint, uuid) from public, anon, authenticated;
grant execute on function driver_mark_arrived_with_notice(bigint, uuid) to service_role;

create or replace function driver_start_ride_with_notice(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_notice jsonb;
begin
  v_result := driver_start_ride(p_telegram_id, p_order_id);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return v_result;
  end if;

  begin
    v_notice := enqueue_rider_trip_notice(p_order_id, 'STARTED');
  exception when others then
    -- نقطةُ الحفظِ تُرجِعُ الإيداعَ وحدَه؛ الطورُ قبلَها باقٍ. السببُ رمزُ حالةٍ لا نصُّ خطأ.
    v_notice := jsonb_build_object('ok', false, 'error', 'ENQUEUE_EXCEPTION', 'sqlstate', sqlstate);
  end;

  return v_result || jsonb_build_object('rider_notice', v_notice);
end;
$$;

comment on function driver_start_ride_with_notice(bigint, uuid) is
  'LOAD-01 batch 21: driver_start_ride + STARTED rider_trip_notice deposit in one round trip; '
  'deposit failure is isolated by a savepoint and reported in rider_notice (ADR 0265 §2).';

revoke all on function driver_start_ride_with_notice(bigint, uuid) from public, anon, authenticated;
grant execute on function driver_start_ride_with_notice(bigint, uuid) to service_role;

create or replace function driver_complete_ride_with_notice(
  p_telegram_id bigint,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_notice jsonb;
begin
  v_result := driver_complete_ride(p_telegram_id, p_order_id);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return v_result;
  end if;

  begin
    v_notice := enqueue_rider_trip_notice(p_order_id, 'COMPLETED');
  exception when others then
    -- نقطةُ الحفظِ تُرجِعُ الإيداعَ وحدَه؛ الطورُ قبلَها باقٍ. السببُ رمزُ حالةٍ لا نصُّ خطأ.
    v_notice := jsonb_build_object('ok', false, 'error', 'ENQUEUE_EXCEPTION', 'sqlstate', sqlstate);
  end;

  return v_result || jsonb_build_object('rider_notice', v_notice);
end;
$$;

comment on function driver_complete_ride_with_notice(bigint, uuid) is
  'LOAD-01 batch 21: driver_complete_ride + COMPLETED rider_trip_notice deposit in one round trip; '
  'deposit failure is isolated by a savepoint and reported in rider_notice (ADR 0265 §2).';

revoke all on function driver_complete_ride_with_notice(bigint, uuid) from public, anon, authenticated;
grant execute on function driver_complete_ride_with_notice(bigint, uuid) to service_role;
