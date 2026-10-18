```
30880|13482|2.29|select claim_notification_delivery() result
27609|44675|0.62|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
20422|3567|5.73|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
9369|2958|3.17|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8782|7398|1.19|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8406|3566|2.36|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7312|11832|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4008|2958|1.36|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3285|10135|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2742|2958|0.93|select driver_accept_offer($1::bigint, $2::uuid) as result
2304|3825|0.60|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1848|5916|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1841|2958|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
1643|2958|0.56|select driver_start_ride($1::bigint, $2::uuid) as result
1608|8362|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1442|2958|0.49|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1057|2958|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
987|3|328.91|select public.sweep_decided_offer_notifications() result
951|2958|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
951|3286|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
877|2958|0.30|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
775|11763|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
684|2958|0.23|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
640|2958|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
596|2958|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
531|19|27.94|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
525|3195|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
500|2958|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
435|1835|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
406|2958|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
