```
40402|4957|8.15|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
36180|10399|3.48|select claim_notification_delivery() result
18082|4957|3.65|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
16446|9877|1.67|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14039|3558|3.95|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9745|14232|0.68|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
9064|3558|2.55|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
6094|5574|1.09|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3407|3561|0.96|select driver_accept_offer($1::bigint, $2::uuid) as result
2579|6827|0.38|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2577|7116|0.36|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2291|3558|0.64|select driver_complete_ride($1::bigint, $2::uuid) as result
2149|3558|0.60|select driver_start_ride($1::bigint, $2::uuid) as result
2131|9877|0.22|select list_rider_trip_events($1::bigint, $2::uuid) as result
2076|3558|0.58|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1586|3|528.73|select public.sweep_decided_offer_notifications() result
1511|3558|0.42|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1438|3558|0.40|select driver_mark_arrived($1::bigint, $2::uuid) as result
1243|121463|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1200|3568|0.34|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1140|109|10.46|select claim_telegram_update_replies($1::integer, $2::integer) as result
1042|3558|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1010|3558|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
944|605|1.56|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
899|3558|0.25|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
792|3558|0.22|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
738|3483|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
678|2563|0.26|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
664|21|31.64|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
564|10674|0.05|select kind, version, accepted_at from list_user_consents($1)
```
