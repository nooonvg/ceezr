```
41724|4941|8.44|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
36446|11449|3.18|select claim_notification_delivery() result
16777|4940|3.40|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
14575|3890|3.75|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
11940|9129|1.31|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9059|15560|0.58|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8745|3890|2.25|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
6404|7011|0.91|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3373|3894|0.87|select driver_accept_offer($1::bigint, $2::uuid) as result
2680|7796|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2582|7780|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2225|3890|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
2164|3890|0.56|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2097|11024|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
2013|3890|0.52|select driver_start_ride($1::bigint, $2::uuid) as result
1648|97|16.99|select claim_telegram_update_replies($1::integer, $2::integer) as result
1541|3890|0.40|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1331|3890|0.34|select driver_mark_arrived($1::bigint, $2::uuid) as result
1100|3651|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1090|118361|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1064|3890|0.27|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1055|3890|0.27|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1003|666|1.51|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
978|3|326.09|select public.sweep_decided_offer_notifications() result
884|3890|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
837|21|39.86|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
716|3890|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
701|3568|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
601|2775|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
531|11670|0.05|select kind, version, accepted_at from list_user_consents($1)
```
