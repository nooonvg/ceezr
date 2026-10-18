```
42690|4596|9.29|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
37394|9318|4.01|select claim_notification_delivery() result
18451|10624|1.74|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14755|3855|3.83|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
14744|4593|3.21|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9243|15420|0.60|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
7725|3855|2.00|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
4960|5546|0.89|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3231|3856|0.84|select driver_accept_offer($1::bigint, $2::uuid) as result
2350|7710|0.30|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2133|3855|0.55|select driver_complete_ride($1::bigint, $2::uuid) as result
2115|3855|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2062|6237|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2029|3855|0.53|select driver_start_ride($1::bigint, $2::uuid) as result
1919|10624|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1333|3855|0.35|select driver_mark_arrived($1::bigint, $2::uuid) as result
1195|3855|0.31|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1138|88|12.93|select claim_telegram_update_replies($1::integer, $2::integer) as result
1060|3855|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1013|3855|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
971|3|323.76|select public.sweep_decided_offer_notifications() result
966|3079|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
864|3855|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
702|19|36.96|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
672|674|1.00|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
644|3855|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
632|3280|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
555|2649|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
519|3855|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
491|11565|0.04|select kind, version, accepted_at from list_user_consents($1)
```
