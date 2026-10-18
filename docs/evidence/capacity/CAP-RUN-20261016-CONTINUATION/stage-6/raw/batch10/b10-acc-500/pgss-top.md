```
42772|4523|9.46|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
29549|8056|3.67|select claim_notification_delivery() result
16145|8812|1.83|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
15270|4502|3.39|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
14468|3677|3.93|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9028|14708|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
7490|3677|2.04|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5985|6647|0.90|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3206|3677|0.87|select driver_accept_offer($1::bigint, $2::uuid) as result
2316|7354|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2208|3677|0.60|select driver_complete_ride($1::bigint, $2::uuid) as result
2180|3798|0.57|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2033|3677|0.55|select driver_start_ride($1::bigint, $2::uuid) as result
1997|10368|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1738|4838|0.36|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1580|3798|0.42|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1309|3677|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1242|104|11.95|select claim_telegram_update_replies($1::integer, $2::integer) as result
1210|138026|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1132|3|377.50|select public.sweep_decided_offer_notifications() result
1101|3798|0.29|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1064|3216|0.33|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
987|3798|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
972|547|1.78|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
875|3798|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
758|19|39.89|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
678|3798|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
673|3401|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
626|2612|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
545|3798|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
