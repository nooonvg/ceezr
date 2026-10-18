```
45002|4338|10.37|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
36091|8119|4.45|select claim_notification_delivery() result
16901|9182|1.84|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16039|3822|4.20|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
14423|4337|3.33|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9277|15288|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
7842|3822|2.05|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
4423|5211|0.85|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3281|3822|0.86|select driver_accept_offer($1::bigint, $2::uuid) as result
2384|7644|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2289|3822|0.60|select driver_complete_ride($1::bigint, $2::uuid) as result
2224|3822|0.58|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2097|10752|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
2069|3822|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1874|5124|0.37|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1658|99|16.75|select claim_telegram_update_replies($1::integer, $2::integer) as result
1365|3822|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1293|3822|0.34|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1052|3822|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1002|3822|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
965|2993|0.32|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
903|3822|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
877|3|292.24|select public.sweep_decided_offer_notifications() result
783|561|1.40|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
651|3300|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
643|3822|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
592|19|31.15|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
580|2589|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
551|11466|0.05|select kind, version, accepted_at from list_user_consents($1)
545|3822|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
