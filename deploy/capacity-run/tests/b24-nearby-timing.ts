/** ب24 — قياسٌ مباشرٌ لزمنِ استعلامِ المرشّحين القريبين (جاف/دافئ) عبر postgres.js نفسِه. */
import postgres from "postgres";

const url = process.argv[2] ?? "postgres://postgres@127.0.0.1:55432/ceezr_cap_20261016";
const sql = postgres(url, { prepare: process.argv[3] !== "noprepare" });
const cityId = (await sql`select id from cities where code = 'JED'`)[0].id;
const q = async () => {
  const t0 = performance.now();
  const rows = await sql`
    select d.id as driver_id, d.city_id,
           st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng,
           (extract(epoch from d.last_location_at) * 1000)::bigint::text as location_at_ms,
           d.last_location_quality as location_quality,
           st_y(d.preferred_area_location::geometry) as preferred_lat,
           st_x(d.preferred_area_location::geometry) as preferred_lng,
           a.is_available, d.verification_status, u.is_blocked,
           d.rating_average, d.rating_count,
           (select array_agg(c.service::text) from driver_capabilities c
             where c.driver_id = d.id and c.is_enabled) as services,
           s.plan as sub_plan, s.status as sub_status, s.trial_ends_at as sub_trial_ends_at,
           s.current_period_end as sub_current_period_end, s.cancel_at_period_end as sub_cancel_at_period_end
      from drivers d
      join users u on u.id = d.user_id
      left join driver_availability a on a.driver_id = d.id
      left join subscriptions s on s.driver_id = d.id and s.status in ('trialing', 'active')
     where d.city_id = ${cityId}
       and u.is_blocked = false and d.verification_status = 'verified' and a.is_available = true
       and d.last_location is not null and d.last_location_quality is distinct from 'ALERT'
       and st_dwithin(d.last_location, st_setsrid(st_makepoint(39.8248, 21.4225), 4326)::geography, 10000)
     order by d.last_location <-> st_setsrid(st_makepoint(39.8248, 21.4225), 4326)::geography
     limit 50`;
  return { ms: performance.now() - t0, n: rows.length };
};
for (let i = 0; i < 12; i++) {
  const r = await q();
  console.log(`run ${i + 1}: ${r.ms.toFixed(2)}ms rows=${r.n}`);
}
await sql.end({ timeout: 1 });
