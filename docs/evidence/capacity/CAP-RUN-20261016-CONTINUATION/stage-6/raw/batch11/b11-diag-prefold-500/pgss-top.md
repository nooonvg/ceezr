```
41627|4955|8.40|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
37239|10540|3.53|select claim_notification_delivery() result
17716|4926|3.60|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
15694|8676|1.81|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14318|3713|3.86|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9436|14852|0.64|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
9049|3713|2.44|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
6277|5978|1.05|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3453|3713|0.93|select driver_accept_offer($1::bigint, $2::uuid) as result
2521|6935|0.36|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2487|7426|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2318|3713|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
2163|3713|0.58|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2113|10406|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
2108|3713|0.57|select driver_start_ride($1::bigint, $2::uuid) as result
1612|109|14.79|select claim_telegram_update_replies($1::integer, $2::integer) as result
1544|3713|0.42|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1536|3|512.09|select public.sweep_decided_offer_notifications() result
1352|3713|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1224|124529|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1186|3603|0.33|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1127|3713|0.30|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1039|3713|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1000|634|1.58|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
905|3713|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
746|3713|0.20|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
742|3520|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
668|20|33.39|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
637|2754|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
550|11139|0.05|select kind, version, accepted_at from list_user_consents($1)
```
