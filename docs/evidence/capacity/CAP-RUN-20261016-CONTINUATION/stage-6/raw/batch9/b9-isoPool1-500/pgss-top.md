```
47764|4140|11.54|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
30622|11094|2.76|select claim_notification_delivery() result
13672|8925|1.53|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
13500|3708|3.64|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
13411|4140|3.24|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8477|14832|0.57|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6252|3708|1.69|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5519|8069|0.68|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
4172|4475|0.93|select claim_telegram_update_job_for_bot($1, $2, $3) as result
3073|3709|0.83|select driver_accept_offer($1::bigint, $2::uuid) as result
2489|7521|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2177|3987|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2118|7416|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2037|3708|0.55|select driver_complete_ride($1::bigint, $2::uuid) as result
1913|3708|0.52|select driver_start_ride($1::bigint, $2::uuid) as result
1897|10497|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1815|4427|0.41|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1421|190353|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1190|4427|0.27|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1181|3708|0.32|select driver_mark_arrived($1::bigint, $2::uuid) as result
1098|4427|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
989|3390|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
867|3827|0.23|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
864|3987|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
783|3|260.89|select public.sweep_decided_offer_notifications() result
729|3731|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
681|20|34.04|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
652|4427|0.15|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
626|2598|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
524|3987|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
