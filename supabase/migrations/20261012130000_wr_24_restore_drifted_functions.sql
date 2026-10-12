-- migration-phase: expand
-- =============================================================================
-- `WR-24` · `WR-21` — إعادةُ ثلاثِ دوالَّ انحرفَت في الإنتاجِ إلى آخرِ صورةٍ معتمدةٍ لها.
--
-- **المقيسُ (2026-10-12، قراءةٌ فقط):** مقارنةُ `md5(prosrc)` لكلِّ دوالِّ `public` بينَ
-- الإنتاجِ وقاعدةٍ محلّيّةٍ طُبِّقَت عليها السلسلةُ كاملةً بالمُطبِّقِ الآمن. ثلاثُ دوالَّ
-- في الإنتاجِ تطابقُ **حرفاً** صورتَها في `20260806120100_phase_2_1_atomic_rpcs.sql`
-- (الأساسُ الأوّل)، مع أنَّ سجلَّ `supabase_migrations` يذكرُ تطبيقَ الهجراتِ اللاحقةِ لها:
--   ١) `claim_ride` — فقدَت ردَّ التسليمِ المكرَّرِ (`BUG-008`، 20260903120000) وبياناتِ
--      الراكبِ (20260814160000): فقبولُ السائقِ من رسالةِ البوتِ لا يُخطِرُ الراكبَ،
--      والنقرةُ المكرَّرةُ للفائزِ تُجابُ «سبقَك غيرُك».
--   ٢) `start_trial` — فقدَت شرطَي الأهليّةِ (`PD-040`، 20260920200000): لا تجربةَ قبلَ
--      التوثيقِ ولا في مدينةٍ غيرِ مفعّلة.
--   ٣) `activate_subscription` — فقدَت مزامنةَ القدراتِ (20260812150000) وإشعارَ
--      التفعيلِ (20260814010000).
-- والدوالُّ الأربعُ الأخرى في ملفِّ الأساسِ لم تتغيّرْ بعدَه، فلا أثرَ فيها. والسببُ غيرُ
-- مسجَّل: الأرجحُ إعادةُ تشغيلِ ملفِّ الأساسِ يدويّاً. الدليلُ:
-- `docs/evidence/production/WR-24-function-drift-20261012.md`.
--
-- **العلاجُ:** الأجسامُ الثلاثةُ منسوخةٌ **حرفاً** عن آخرِ هجرةٍ عرّفَت كلّاً منها، بالتوقيعِ
-- والمردِّ و`security definer` و`search_path` نفسِها. `create or replace` يحفظُ الصلاحيّاتِ
-- القائمة (`service_role` وحدَها). ولا تغيُّرَ على قاعدةٍ لم تنحرف: الإعادةُ بلا أثر.
-- **الرجوعُ:** الأجسامُ الإنتاجيّةُ السابقةُ محفوظةٌ في ملفِّ الدليل، ولا بياناتَ تُمَسّ.
-- =============================================================================

-- ١) من `20260903120000_claim_ride_distinguishes_duplicate_delivery.sql`.
create or replace function claim_ride(p_order_id uuid, p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  orders%rowtype;
  v_offer  order_offers%rowtype;
  v_driver drivers%rowtype;
  v_now    timestamptz := now();
  v_rider  record;
  v_driver_name text;
begin
  -- القفل الذرّي: من لا يظفر بالصف لا ينتظر، بل يخسر فوراً
  select * into v_order
    from orders
   where id = p_order_id and status = 'searching'
     for update skip locked;

  if not found then
    -- `BUG-008`: أهو سباقٌ خُسِر، أم إعادةُ تسليمٍ لنقرةِ الفائزِ نفسِه؟
    -- الحَكَمُ الإسنادُ المُثبَّتُ، لا الرسالةُ ولا الذاكرة.
    select * into v_order
      from orders
     where id = p_order_id
       and assigned_driver_id = p_driver_id
       and is_driver_engaged_order_status(status);

    if found then
      select * into v_driver from drivers where id = p_driver_id;
      select u.full_name into v_driver_name
        from users u where u.id = v_driver.user_id;

      -- نفسُ نتيجةِ النداءِ الأوّلِ: نجاحٌ بنفسِ لحظةِ الإسنادِ المحفوظةِ لا
      -- بـ`now()` — فالمكرَّرُ لا يخترعُ وقتاً جديداً.
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'order_id', p_order_id,
        'driver_id', p_driver_id,
        'matched_at', v_order.matched_at,
        'city_id', v_order.city_id,
        'rider', null,
        'driver_name', v_driver_name,
        'driver_plate', v_driver.plate_number,
        'driver_vehicle', v_driver.vehicle_type
      );
    end if;

    return jsonb_build_object('ok', false, 'error', 'ORDER_NOT_CLAIMABLE');
  end if;

  select * into v_offer
    from order_offers
   where order_id = p_order_id
     and driver_id = p_driver_id
     and status = 'pending'
     and expires_at > v_now
   order by round desc
   limit 1
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'OFFER_NOT_VALID');
  end if;

  select * into v_driver from drivers where id = p_driver_id;
  if v_driver.city_id <> v_order.city_id then
    return jsonb_build_object('ok', false, 'error', 'CITY_MISMATCH');
  end if;

  update order_offers
     set status = 'accepted', responded_at = v_now
   where id = v_offer.id;

  update order_offers
     set status = 'cancelled', responded_at = v_now
   where order_id = p_order_id and id <> v_offer.id and status = 'pending';

  update orders
     set status = 'matched', assigned_driver_id = p_driver_id, matched_at = v_now
   where id = p_order_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_order.city_id, v_driver.user_id, 'order.claimed', 'order', p_order_id,
          jsonb_build_object('driver_id', p_driver_id, 'offer_id', v_offer.id,
                             'round', v_offer.round));

  -- هويّةُ الراكب تُقرأ داخل المعاملة نفسها. والقراءةُ متساهلة عن قصد: راكبٌ
  -- بلا صفّ مستخدمٍ سليم لا يجوز أن يُبطِل إسناداً وقع — يخرج المغلّف بلا راكب
  -- فيمتنع الإخطار وحده.
  select u.telegram_id as telegram_id,
         coalesce(u.language_code, 'ar') as language_code,
         u.full_name as full_name
    into v_rider
    from riders r
    join users u on u.id = r.user_id
   where r.id = v_order.rider_id;

  -- اسمُ السائق من `users` لا من `drivers`: الأسماءُ كلّها في جدول المستخدمين،
  -- و`drivers` يحمل المهنةَ لا الهويّة.
  select u.full_name into v_driver_name
    from users u where u.id = v_driver.user_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order_id', p_order_id,
    'driver_id', p_driver_id,
    'matched_at', v_now,
    'city_id', v_order.city_id,
    'rider', case
               when v_rider.telegram_id is null then null
               else jsonb_build_object(
                      'rider_id', v_order.rider_id,
                      'telegram_id', v_rider.telegram_id,
                      'language_code', v_rider.language_code,
                      'full_name', v_rider.full_name)
             end,
    'driver_name', v_driver_name,
    'driver_plate', v_driver.plate_number,
    'driver_vehicle', v_driver.vehicle_type
  );
end;
$$;

comment on function claim_ride(uuid, uuid) is
  'إسنادُ الطلب ذرّياً لسائقٍ قَبِل عرضه، ويُميّز إعادةَ تسليمِ نقرةِ الفائزِ نفسِه (BUG-008).';

-- ٢) من `20260920200000_pd_040_trial_eligibility.sql`.
create or replace function start_trial(p_driver_id uuid, p_plan subscription_plan)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_city   cities%rowtype;
  v_days   numeric;
  v_ends   timestamptz;
  v_id     uuid;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  if exists (select 1 from subscriptions where driver_id = p_driver_id) then
    return jsonb_build_object('ok', false, 'error', 'TRIAL_ALREADY_USED');
  end if;

  -- فحصُ الأهليّة: لا تجربةَ قبلَ التوثيقِ
  if v_driver.verification_status <> 'verified' then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_VERIFIED');
  end if;

  -- فحصُ الأهليّة: لا تجربةَ في مدينةٍ غيرِ مفعّلةٍ
  select * into v_city from cities where id = v_driver.city_id;
  if not v_city.is_active then
    return jsonb_build_object('ok', false, 'error', 'CITY_NOT_ACTIVE');
  end if;

  v_days := get_setting_number(v_driver.city_id, 'trial_days');
  v_ends := now() + make_interval(days => v_days::int);

  insert into subscriptions (city_id, driver_id, plan, status, trial_ends_at, current_period_end)
  values (v_driver.city_id, p_driver_id, p_plan, 'trialing', v_ends, v_ends)
  returning id into v_id;

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.trial_started', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'trial_ends_at', v_ends));

  return jsonb_build_object('ok', true, 'subscription_id', v_id, 'trial_ends_at', v_ends);
end;
$$;

-- ٣) من `20260814010000_subscription_notices.sql`.
create or replace function activate_subscription(
  p_driver_id uuid,
  p_plan subscription_plan,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver drivers%rowtype;
  v_price numeric;
  v_currency text;
  v_ends timestamptz;
  v_id uuid;
  v_key text;
begin
  select * into v_driver from drivers where id = p_driver_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'DRIVER_NOT_FOUND');
  end if;

  v_key := 'subscription_price_' || p_plan::text;
  v_price := get_setting_number(v_driver.city_id, v_key);
  v_currency := get_setting(v_driver.city_id, 'currency') #>> '{}';
  v_ends := now() + make_interval(days => p_days);

  update subscriptions
     set status = 'expired'
   where driver_id = p_driver_id and status in ('trialing', 'active');

  insert into subscriptions
    (city_id, driver_id, plan, status, current_period_end, price_amount, currency)
  values
    (v_driver.city_id, p_driver_id, p_plan, 'active', v_ends, v_price, v_currency)
  returning id into v_id;

  perform sync_driver_capabilities_to_plan(p_driver_id, p_plan);

  insert into audit_log (city_id, actor_user_id, action, entity_type, entity_id, payload)
  values (v_driver.city_id, v_driver.user_id, 'subscription.activated', 'subscription', v_id,
          jsonb_build_object('plan', p_plan, 'price', v_price, 'currency', v_currency,
                             'period_end', v_ends));

  -- الوعدُ الذي كان يُخلَف: «يُفعَّل اشتراكك تلقائياً بعد نجاح الدفع» تُقال في
  -- رسالة الدفع، ثمّ يُفعَّل بصمت. فيعود السائق يسأل الدعمَ عن مصير نقوده.
  perform enqueue_subscription_notice(v_id, 'activated',
    jsonb_build_object('plan', p_plan::text, 'period_end', v_ends,
                       'price', v_price, 'currency', v_currency));

  return jsonb_build_object('ok', true, 'subscription_id', v_id,
                            'price', v_price, 'currency', v_currency, 'period_end', v_ends);
end;
$$;
