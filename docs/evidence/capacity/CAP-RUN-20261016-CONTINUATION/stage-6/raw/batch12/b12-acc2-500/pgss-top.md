```
44043|4977|8.85|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
34100|11532|2.96|select claim_notification_delivery() result
17765|11176|1.59|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16957|3995|4.24|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
16069|4975|3.23|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
10235|3995|2.56|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
9441|15976|0.59|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5722|6942|0.82|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3382|3996|0.85|select driver_accept_offer($1::bigint, $2::uuid) as result
2628|7920|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2323|7990|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2270|3995|0.57|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2251|3994|0.56|select driver_complete_ride($1::bigint, $2::uuid) as result
2069|3994|0.52|select driver_start_ride($1::bigint, $2::uuid) as result
2041|11176|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1639|95|17.25|select claim_telegram_update_replies($1::integer, $2::integer) as result
1535|3995|0.38|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1370|3994|0.34|select driver_mark_arrived($1::bigint, $2::uuid) as result
1105|3995|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1066|3605|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1062|3|354.04|select public.sweep_decided_offer_notifications() result
1044|3995|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1025|111955|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
961|684|1.40|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
847|3995|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
718|20|35.88|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
690|3995|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
681|3586|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
619|2916|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
540|3995|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
