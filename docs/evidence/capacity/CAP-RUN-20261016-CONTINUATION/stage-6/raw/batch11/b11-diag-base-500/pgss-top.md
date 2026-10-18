```
47004|4559|10.31|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
31152|11061|2.82|select claim_notification_delivery() result
15374|4523|3.40|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
13978|8643|1.62|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
12217|3618|3.38|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8368|14472|0.58|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6489|3618|1.79|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
4813|5317|0.91|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3178|3618|0.88|select driver_accept_offer($1::bigint, $2::uuid) as result
2469|7462|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2131|7236|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2104|3819|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2063|3618|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
1878|3618|0.52|select driver_start_ride($1::bigint, $2::uuid) as result
1856|10239|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1517|3829|0.40|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1371|109|12.58|select claim_telegram_update_replies($1::integer, $2::integer) as result
1292|154144|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1129|3618|0.31|select driver_mark_arrived($1::bigint, $2::uuid) as result
1079|3597|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1020|3829|0.27|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
960|3|319.93|select public.sweep_decided_offer_notifications() result
957|556|1.72|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
942|3829|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
796|3819|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
757|2619|0.29|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
744|20|37.19|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
695|3582|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
633|3829|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
492|3819|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
