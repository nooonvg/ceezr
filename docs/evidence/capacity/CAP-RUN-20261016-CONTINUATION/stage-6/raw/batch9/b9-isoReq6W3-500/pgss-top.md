```
51239|4766|10.75|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
38709|10005|3.87|select claim_notification_delivery() result
16904|9807|1.72|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16616|4114|4.04|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
15852|4766|3.33|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9527|16456|0.58|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8576|4114|2.08|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
4685|6537|0.72|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3399|4114|0.83|select driver_accept_offer($1::bigint, $2::uuid) as result
2664|8228|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2351|4114|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
2298|4114|0.56|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2147|11526|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
2102|4114|0.51|select driver_start_ride($1::bigint, $2::uuid) as result
2095|6608|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1600|4114|0.39|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1368|4114|0.33|select driver_mark_arrived($1::bigint, $2::uuid) as result
1346|93|14.47|select claim_telegram_update_replies($1::integer, $2::integer) as result
1204|143107|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1087|4114|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1064|3|354.68|select public.sweep_decided_offer_notifications() result
1039|3393|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
975|596|1.64|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
967|4114|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
893|4114|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
705|21|33.60|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
694|3660|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
634|4114|0.15|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
609|2982|0.20|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
557|12342|0.05|select kind, version, accepted_at from list_user_consents($1)
```
