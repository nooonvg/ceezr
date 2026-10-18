```
47404|4853|9.77|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
34250|10169|3.37|select claim_notification_delivery() result
15530|9661|1.61|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
15394|4826|3.19|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
15267|4084|3.74|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9090|16336|0.56|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8442|4084|2.07|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5998|7388|0.81|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3369|4085|0.82|select driver_accept_offer($1::bigint, $2::uuid) as result
2361|8168|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2213|4084|0.54|select driver_complete_ride($1::bigint, $2::uuid) as result
2204|4084|0.54|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2166|6784|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2027|11531|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1987|4084|0.49|select driver_start_ride($1::bigint, $2::uuid) as result
1520|4084|0.37|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1419|93|15.26|select claim_telegram_update_replies($1::integer, $2::integer) as result
1258|4084|0.31|select driver_mark_arrived($1::bigint, $2::uuid) as result
1063|4084|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1057|133121|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1009|3383|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
949|4084|0.23|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
942|581|1.62|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
843|4084|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
817|19|43.03|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
715|3|238.31|select public.sweep_decided_offer_notifications() result
657|4084|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
629|3440|0.18|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
574|2984|0.19|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
516|4084|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
