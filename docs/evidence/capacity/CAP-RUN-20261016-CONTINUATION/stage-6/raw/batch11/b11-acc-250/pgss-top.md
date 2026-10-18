```
39952|4556|8.77|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
35423|8736|4.05|select claim_notification_delivery() result
17265|9864|1.75|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16128|4506|3.58|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
13449|3505|3.84|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9549|14020|0.68|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
7657|3505|2.18|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5366|5074|1.06|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3704|3505|1.06|select driver_accept_offer($1::bigint, $2::uuid) as result
2455|7010|0.35|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2270|3505|0.65|select driver_complete_ride($1::bigint, $2::uuid) as result
2157|9864|0.22|select list_rider_trip_events($1::bigint, $2::uuid) as result
2148|3505|0.61|select driver_start_ride($1::bigint, $2::uuid) as result
2086|5609|0.37|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2021|3505|0.58|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1354|3505|0.39|select driver_mark_arrived($1::bigint, $2::uuid) as result
1225|3505|0.35|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1061|99|10.72|select claim_telegram_update_replies($1::integer, $2::integer) as result
1014|3125|0.32|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
970|3505|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
955|3505|0.27|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
914|3505|0.26|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
827|3|275.75|select public.sweep_decided_offer_notifications() result
817|18|45.37|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
783|595|1.32|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
699|3220|0.22|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
661|2461|0.27|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
651|3505|0.19|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
562|10515|0.05|select kind, version, accepted_at from list_user_consents($1)
533|3505|0.15|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
