```
43066|10440|4.13|select claim_notification_delivery() result
41296|4931|8.37|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
16483|4907|3.36|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
16174|8847|1.83|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14099|3782|3.73|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9182|15128|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8328|3782|2.20|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5280|5903|0.89|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3438|3784|0.91|select driver_accept_offer($1::bigint, $2::uuid) as result
2398|6982|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2339|7564|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2301|3782|0.61|select driver_complete_ride($1::bigint, $2::uuid) as result
2158|3782|0.57|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2083|3782|0.55|select driver_start_ride($1::bigint, $2::uuid) as result
2051|10628|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1524|3782|0.40|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1382|3782|0.37|select driver_mark_arrived($1::bigint, $2::uuid) as result
1308|109|12.00|select claim_telegram_update_replies($1::integer, $2::integer) as result
1100|115741|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1080|3|359.85|select public.sweep_decided_offer_notifications() result
1070|3456|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1044|3782|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1007|641|1.57|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
915|3782|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
850|3782|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
791|20|39.53|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
694|3520|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
630|3782|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
575|2650|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
539|3782|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
