-- migration-phase: expand
-- =============================================================================
-- `WR-06` — زمنُ المطابقةِ في لقطةِ الإدارةِ يُقاسُ من بدءِ البحثِ لا من الإنشاء.
--
-- الطلبُ المجدولُ (ADR 0273) يُنشَأُ قبلَ موعدِه بأيّامٍ ويُطلَقُ إلى البحثِ قبلَ الموعدِ
-- بالمهلة، فكانَ `matched_at - created_at` يحسبُ أيّامَ الانتظارِ المقصودِ زمنَ مطابقة
-- فيُضخِّمُ المتوسّطَ. والقياسُ الآنَ `matched_at - coalesce(searching_since, created_at)`،
-- وهوَ الأساسُ نفسُه الذي تقيسُ به مؤقّتاتُ التصعيدِ وإعادةِ البثِّ منذُ ADR 0273.
-- الطلبُ الفوريُّ بلا `searching_since` يُقاسُ كما كانَ حرفًا.
--
-- الدالّةُ منسوخةٌ عن `20260916140100_f7_08_admin_metric_refresh.sql` (مطابقةٌ للإنتاجِ
-- بـ`md5(prosrc)` في 2026-10-12)، والتغييرُ سطرٌ واحد. والعودةُ إعادةُ تطبيقِ تلكَ الهجرة.
-- =============================================================================

create or replace function refresh_admin_metric_snapshots(p_window_hours integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_now timestamptz := now();
  v_since timestamptz;
  v_written integer;
begin
  if p_window_hours is null or p_window_hours <= 0 then
    raise exception 'INVALID_WINDOW_HOURS:%', coalesce(p_window_hours::text, 'null');
  end if;

  v_since := v_now - make_interval(hours => p_window_hours);

  with order_facts as (
    select
      city_id,
      count(*) filter (where status = 'searching')::int as searching_orders,
      count(*) filter (where status = 'matched')::int as matched_orders,
      count(*) filter (where status = 'in_progress')::int as in_progress_orders,
      count(*) filter (
        where status = 'completed' and completed_at >= v_since
      )::int as completed_orders_window,
      count(*) filter (where status = 'failed' and updated_at >= v_since)::int
        as failed_orders_window,
      count(*) filter (where status = 'cancelled' and updated_at >= v_since)::int
        as cancelled_orders_window,
      -- البسطُ والمقامُ من **الشرطِ نفسِه** حرفاً: بسطٌ بشرطٍ ومقامٌ بشرطٍ آخرَ
      -- متوسّطٌ لا يُصدَّقُ.
      coalesce(
        sum(extract(epoch from (matched_at - coalesce(searching_since, created_at)))) filter (
          where matched_at is not null and matched_at >= v_since
        ),
        0
      )::numeric(18,3) as match_seconds_sum,
      count(*) filter (where matched_at is not null and matched_at >= v_since)::int
        as match_seconds_count
    from orders
    group by city_id
  ),
  availability_facts as (
    select city_id, count(*) filter (where is_available)::int as available_drivers
    from driver_availability
    group by city_id
  ),
  driver_facts as (
    select
      city_id,
      count(*) filter (where verification_status = 'verified')::int as verified_drivers,
      count(*) filter (where verification_status = 'pending')::int as pending_drivers
    from drivers
    group by city_id
  ),
  subscription_facts as (
    select
      city_id,
      count(*) filter (where status = 'active')::int as active_subscriptions,
      count(*) filter (where status = 'trialing')::int as trial_subscriptions
    from subscriptions
    group by city_id
  ),
  ticket_facts as (
    select city_id, count(*) filter (where status in ('open', 'claimed'))::int as open_tickets
    from support_tickets
    group by city_id
  ),
  rating_facts as (
    select
      city_id,
      coalesce(sum(stars) filter (
        where direction = 'rider_to_driver' and is_flagged = false and created_at >= v_since
      ), 0)::numeric(18,3) as rating_stars_sum,
      count(*) filter (
        where direction = 'rider_to_driver' and is_flagged = false and created_at >= v_since
      )::int as rating_count
    from ratings
    group by city_id
  ),
  -- المدنُ هيَ الأصلُ لا الجداولُ: مدينةٌ بلا طلبٍ ولا سائقٍ **يلزمُها صفُّ
  -- أصفارٍ** لا غيابُ صفٍّ. غيابُ الصفِّ يُقرأُ «لم يُقَس» وأصفارُه تُقرأُ
  -- «قِيسَ فكانَ صفراً» — وبينَهما فرقُ حقيقةٍ.
  computed as (
    select
      c.id as city_id,
      coalesce(o.searching_orders, 0) as searching_orders,
      coalesce(o.matched_orders, 0) as matched_orders,
      coalesce(o.in_progress_orders, 0) as in_progress_orders,
      coalesce(a.available_drivers, 0) as available_drivers,
      coalesce(d.verified_drivers, 0) as verified_drivers,
      coalesce(d.pending_drivers, 0) as pending_drivers,
      coalesce(s.active_subscriptions, 0) as active_subscriptions,
      coalesce(s.trial_subscriptions, 0) as trial_subscriptions,
      coalesce(t.open_tickets, 0) as open_tickets,
      coalesce(o.completed_orders_window, 0) as completed_orders_window,
      coalesce(o.failed_orders_window, 0) as failed_orders_window,
      coalesce(o.cancelled_orders_window, 0) as cancelled_orders_window,
      coalesce(o.match_seconds_sum, 0) as match_seconds_sum,
      coalesce(o.match_seconds_count, 0) as match_seconds_count,
      coalesce(r.rating_stars_sum, 0) as rating_stars_sum,
      coalesce(r.rating_count, 0) as rating_count
    from cities c
    left join order_facts o on o.city_id = c.id
    left join availability_facts a on a.city_id = c.id
    left join driver_facts d on d.city_id = c.id
    left join subscription_facts s on s.city_id = c.id
    left join ticket_facts t on t.city_id = c.id
    left join rating_facts r on r.city_id = c.id
  ),
  written as (
    insert into admin_metric_snapshots (
      city_id, window_hours, computed_at,
      searching_orders, matched_orders, in_progress_orders,
      available_drivers, verified_drivers, pending_drivers,
      active_subscriptions, trial_subscriptions, open_tickets,
      completed_orders_window, failed_orders_window, cancelled_orders_window,
      match_seconds_sum, match_seconds_count, rating_stars_sum, rating_count
    )
    select
      computed.city_id, p_window_hours, v_now,
      computed.searching_orders, computed.matched_orders, computed.in_progress_orders,
      computed.available_drivers, computed.verified_drivers, computed.pending_drivers,
      computed.active_subscriptions, computed.trial_subscriptions, computed.open_tickets,
      computed.completed_orders_window, computed.failed_orders_window,
      computed.cancelled_orders_window,
      computed.match_seconds_sum, computed.match_seconds_count,
      computed.rating_stars_sum, computed.rating_count
    from computed
    on conflict (city_id, window_hours) do update set
      computed_at = excluded.computed_at,
      searching_orders = excluded.searching_orders,
      matched_orders = excluded.matched_orders,
      in_progress_orders = excluded.in_progress_orders,
      available_drivers = excluded.available_drivers,
      verified_drivers = excluded.verified_drivers,
      pending_drivers = excluded.pending_drivers,
      active_subscriptions = excluded.active_subscriptions,
      trial_subscriptions = excluded.trial_subscriptions,
      open_tickets = excluded.open_tickets,
      completed_orders_window = excluded.completed_orders_window,
      failed_orders_window = excluded.failed_orders_window,
      cancelled_orders_window = excluded.cancelled_orders_window,
      match_seconds_sum = excluded.match_seconds_sum,
      match_seconds_count = excluded.match_seconds_count,
      rating_stars_sum = excluded.rating_stars_sum,
      rating_count = excluded.rating_count
    returning 1
  )
  select count(*)::int into v_written from written;

  return jsonb_build_object(
    'ok', true,
    'window_hours', p_window_hours,
    'computed_at', v_now,
    'cities_written', v_written
  );
end;
$function$;

comment on function refresh_admin_metric_snapshots(integer) is
  'يُعيدُ بناءَ لقطةِ مقاييسِ الإدارةِ لكلِّ مدينةٍ في نافذةٍ واحدةٍ، بمسحةٍ واحدةٍ لكلِّ جدولٍ وفي لقطةِ MVCC واحدةٍ (F7-08 · CAP-011). يُعيدُ عدَدَ الصفوفِ المكتوبةِ وزمنَ القياسِ لا الأرقامَ نفسَها.';

-- السطحُ مُقفَلٌ كما بقيّةُ كُتّابِ المستودعِ: لا `anon` ولا `authenticated`،
-- و`public` منزوعٌ صريحاً لأنَّ المنحَ الافتراضيَّ للدوالِّ يقعُ عليهِ.
revoke all on function refresh_admin_metric_snapshots(integer) from public;
grant execute on function refresh_admin_metric_snapshots(integer) to service_role;
