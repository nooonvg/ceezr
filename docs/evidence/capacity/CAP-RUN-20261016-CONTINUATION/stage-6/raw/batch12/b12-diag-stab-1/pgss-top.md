```
40552|4901|8.27|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
34868|9104|3.83|select claim_notification_delivery() result
16653|4851|3.43|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
16037|10440|1.54|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
13962|3776|3.70|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9560|15104|0.63|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8079|3776|2.14|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5345|5818|0.92|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3492|3776|0.92|select driver_accept_offer($1::bigint, $2::uuid) as result
2599|7552|0.34|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2172|3776|0.58|select driver_complete_ride($1::bigint, $2::uuid) as result
2119|3776|0.56|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2052|3776|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1968|5677|0.35|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1949|10440|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1749|105|16.66|select claim_telegram_update_replies($1::integer, $2::integer) as result
1540|3|513.42|select public.sweep_decided_offer_notifications() result
1495|3776|0.40|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1360|3776|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1140|3776|0.30|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1135|116830|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1076|3776|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1071|3422|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
984|640|1.54|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
902|20|45.12|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
841|3776|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
683|3340|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
673|2797|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
647|3776|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
524|3776|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
