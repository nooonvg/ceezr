```
49511|4888|10.13|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
39554|10769|3.67|select claim_notification_delivery() result
18785|10039|1.87|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16911|4168|4.06|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
15877|4866|3.26|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9347|16672|0.56|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8721|4168|2.09|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5334|7085|0.75|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3335|4168|0.80|select driver_accept_offer($1::bigint, $2::uuid) as result
2417|7281|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2375|4168|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
2308|8336|0.28|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2301|4168|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2135|11804|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
2053|4168|0.49|select driver_start_ride($1::bigint, $2::uuid) as result
1590|4168|0.38|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1309|4168|0.31|select driver_mark_arrived($1::bigint, $2::uuid) as result
1268|89|14.25|select claim_telegram_update_replies($1::integer, $2::integer) as result
1137|144400|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1038|4168|0.25|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1014|3486|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
962|606|1.59|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
961|4168|0.23|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
885|4168|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
865|3|288.49|select public.sweep_decided_offer_notifications() result
743|21|35.37|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
680|3661|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
615|4168|0.15|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
580|2968|0.20|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
544|4168|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
