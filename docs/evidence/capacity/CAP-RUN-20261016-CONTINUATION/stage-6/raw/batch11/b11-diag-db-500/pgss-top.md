```
46826|4977|9.41|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
32824|11985|2.74|select claim_notification_delivery() result
16169|4960|3.26|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
16062|4062|3.95|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
14766|9611|1.54|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
10102|4062|2.49|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
9238|16248|0.57|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4802|5715|0.84|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3346|4062|0.82|select driver_accept_offer($1::bigint, $2::uuid) as result
2781|8450|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2352|8124|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2242|4062|0.55|select driver_complete_ride($1::bigint, $2::uuid) as result
2211|4062|0.54|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2051|11396|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
2027|4062|0.50|select driver_start_ride($1::bigint, $2::uuid) as result
1541|4062|0.38|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1407|3|469.00|select public.sweep_decided_offer_notifications() result
1330|90|14.78|select claim_telegram_update_replies($1::integer, $2::integer) as result
1292|4062|0.32|select driver_mark_arrived($1::bigint, $2::uuid) as result
1110|135442|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1092|4062|0.27|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1036|3533|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1029|693|1.48|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
969|4062|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
862|4062|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
669|3581|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
665|4062|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
635|21|30.25|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
615|2971|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
514|4062|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
