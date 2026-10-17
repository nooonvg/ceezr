# pgss-top — diag-r11-dispatch-250

```text
43826|15930|2.75|select claim_notification_delivery() result
20112|4458|4.51|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
14116|7538|1.87|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9964|4458|2.24|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9104|3059|2.98|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8621|15283|0.56|select driver_offer_board($1::bigint) as result
7377|12236|0.60|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5469|3059|1.79|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
4008|12709|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2834|3060|0.93|select driver_accept_offer($1::bigint, $2::uuid) as result
2183|3133|0.70|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1948|6118|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1853|3059|0.61|select driver_complete_ride($1::bigint, $2::uuid) as result
1657|3059|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1652|8530|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1541|3059|0.50|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1097|3059|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1069|3059|0.35|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
955|3|318.32|select public.sweep_decided_offer_notifications() result
916|3217|0.28|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
874|3059|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
828|3059|0.27|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
712|3059|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
674|4189|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
652|3059|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
566|19|29.78|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
547|2050|0.27|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
521|6362|0.08|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
521|3059|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
468|15927|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
457|47264|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
443|15283|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
436|3059|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
396|9177|0.04|select kind, version, accepted_at from list_user_consents($1)
361|3|120.46|select relocate_drivers_by_location($1) as result
334|3059|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
266|2054|0.13|insert into tracking_sessions (driver_id, city_id, trip_id, started_at) select d.id, d.city_id, $1, $2 from drivers d where d.id = $3::uuid on conflict do nothi
261|3059|0.09|select rider_order_candidate($1::bigint, $2::uuid) as result
255|12236|0.02|select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_status, a.is_available, (d.last_location is not null) as has_location, 
246|12236|0.02|select u.telegram_id::text as telegram_id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id where o.id = $1::uuid
```
