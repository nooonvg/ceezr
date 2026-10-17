# pgss-top — diag-r11-mix0b-250

```text
55866|33466|1.67|select claim_notification_delivery() result
14666|3986|3.68|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
11171|22601|0.49|select driver_offer_board($1::bigint) as result
10193|3185|3.20|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9443|28688|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
8778|3986|2.20|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7666|12740|0.60|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5233|3185|1.64|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3025|3186|0.95|select driver_accept_offer($1::bigint, $2::uuid) as result
2148|3390|0.63|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1965|6370|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1826|3185|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
1706|3185|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1667|3185|0.52|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1421|4773|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1137|3185|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1085|3185|0.34|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1073|4|268.17|select public.sweep_decided_offer_notifications() result
1005|33462|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
922|3185|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
881|3185|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
743|3185|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
691|22601|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
658|3185|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
574|7080|0.08|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
573|3515|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
508|4|127.06|select relocate_drivers_by_location($1) as result
502|2093|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
501|33464|0.01|select request_id from notification_outbox where id = $1::uuid
501|3185|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
467|19|24.58|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
438|3185|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
411|9555|0.04|select kind, version, accepted_at from list_user_consents($1)
352|34888|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
319|3185|0.10|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
301|3185|0.09|select rider_order_candidate($1::bigint, $2::uuid) as result
295|2093|0.14|insert into tracking_sessions (driver_id, city_id, trip_id, started_at) select d.id, d.city_id, $1, $2 from drivers d where d.id = $3::uuid on conflict do nothi
266|12740|0.02|select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_status, a.is_available, (d.last_location is not null) as has_location, 
257|3185|0.08|with current as ( select id, driver_id, trip_id, started_at, last_fix_at, ended_at, end_reason, last_sequence from tracking_sessions where driver_id = $1::uuid 
252|12740|0.02|select u.telegram_id::text as telegram_id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id where o.id = $1::uuid
```
