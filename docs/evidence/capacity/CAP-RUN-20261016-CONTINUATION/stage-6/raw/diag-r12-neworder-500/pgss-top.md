# pgss-top — diag-r12-neworder-500

```text
43947|11348|3.87|select claim_notification_delivery() result
17927|32699|0.55|select driver_offer_board($1::bigint) as result
13888|3905|3.56|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
12664|7358|1.72|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
10315|3077|3.35|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9811|3902|2.51|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7606|12308|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5056|3077|1.64|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2856|3080|0.93|select driver_accept_offer($1::bigint, $2::uuid) as result
2735|8186|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2563|3195|0.80|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1940|6154|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1887|3077|0.61|select driver_complete_ride($1::bigint, $2::uuid) as result
1687|3077|0.55|select driver_start_ride($1::bigint, $2::uuid) as result
1640|3077|0.53|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1626|8512|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1160|3077|0.38|select driver_mark_arrived($1::bigint, $2::uuid) as result
1144|3077|0.37|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1039|32699|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
956|3158|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
901|3077|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
863|3077|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
788|10348|0.08|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
772|3|257.47|select public.sweep_decided_offer_notifications() result
723|3077|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
619|19|32.56|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
605|3566|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
594|3077|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
557|3077|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
549|59761|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
455|1820|0.25|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
408|3077|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
402|9231|0.04|select kind, version, accepted_at from list_user_consents($1)
354|11344|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
326|3077|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
305|3|101.55|select relocate_drivers_by_location($1) as result
286|3077|0.09|select rider_order_candidate($1::bigint, $2::uuid) as result
271|12308|0.02|select u.telegram_id::text as telegram_id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id where o.id = $1::uuid
261|3077|0.08|with current as ( select id, driver_id, trip_id, started_at, last_fix_at, ended_at, end_reason, last_sequence from tracking_sessions where driver_id = $1::uuid 
259|12308|0.02|select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_status, a.is_available, (d.last_location is not null) as has_location, 
```
