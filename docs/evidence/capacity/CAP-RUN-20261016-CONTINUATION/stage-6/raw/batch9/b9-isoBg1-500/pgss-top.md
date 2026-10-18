```
34648|10661|3.25|select claim_notification_delivery() result
26334|5176|5.09|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
17887|4055|4.41|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
16415|5176|3.17|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
12224|9391|1.30|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9148|16220|0.56|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8885|4055|2.19|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
6447|7929|0.81|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
4694|4481|1.05|select claim_telegram_update_job_for_bot($1, $2, $3) as result
3314|4058|0.82|select driver_accept_offer($1::bigint, $2::uuid) as result
2369|7156|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2354|8110|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2188|4055|0.54|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2185|4055|0.54|select driver_complete_ride($1::bigint, $2::uuid) as result
2069|4055|0.51|select driver_start_ride($1::bigint, $2::uuid) as result
2045|11456|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1423|4055|0.35|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1374|4055|0.34|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1330|4055|0.33|select driver_mark_arrived($1::bigint, $2::uuid) as result
1042|4800|0.22|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
1031|3501|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1009|4055|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
947|3970|0.24|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
926|3|308.74|select public.sweep_decided_offer_notifications() result
851|4055|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
786|59|13.33|select claim_telegram_update_replies($1::integer, $2::integer) as result
662|20|33.08|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
658|4055|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
544|2784|0.20|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
543|4055|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
