```
39387|5002|7.87|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
35042|8907|3.93|select claim_notification_delivery() result
16891|10368|1.63|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
15839|4952|3.20|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
14333|3710|3.86|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9054|14840|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8019|3710|2.16|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
6240|6373|0.98|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3353|3712|0.90|select driver_accept_offer($1::bigint, $2::uuid) as result
2546|7420|0.34|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2244|3710|0.60|select driver_complete_ride($1::bigint, $2::uuid) as result
2091|3710|0.56|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2061|3710|0.56|select driver_start_ride($1::bigint, $2::uuid) as result
2003|10368|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1943|5505|0.35|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1721|104|16.54|select claim_telegram_update_replies($1::integer, $2::integer) as result
1488|3710|0.40|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1313|3710|0.35|select driver_mark_arrived($1::bigint, $2::uuid) as result
1106|111000|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1058|3400|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1030|3710|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1017|3|339.10|select public.sweep_decided_offer_notifications() result
989|622|1.59|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
885|3710|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
856|3710|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
714|3340|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
680|19|35.77|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
603|3710|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
599|2675|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
513|3710|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
