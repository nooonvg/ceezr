```
34792|13261|2.62|select claim_notification_delivery() result
25358|3503|7.24|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
22207|41596|0.53|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
10302|2906|3.55|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9142|7009|1.30|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9068|3502|2.59|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7623|11616|0.66|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4338|2906|1.49|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3378|9652|0.35|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2896|2905|1.00|select driver_accept_offer($1::bigint, $2::uuid) as result
1908|5812|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1894|3458|0.55|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1857|2904|0.64|select driver_complete_ride($1::bigint, $2::uuid) as result
1724|2904|0.59|select driver_start_ride($1::bigint, $2::uuid) as result
1670|8085|0.21|select list_rider_trip_events($1::bigint, $2::uuid) as result
1498|2906|0.52|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1089|3532|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1082|2904|0.37|select driver_mark_arrived($1::bigint, $2::uuid) as result
985|2906|0.34|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
897|2906|0.31|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
892|2906|0.31|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
826|11900|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
778|3|259.44|select public.sweep_decided_offer_notifications() result
716|2906|0.25|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
612|2906|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
529|19|27.83|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
512|2906|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
422|1700|0.25|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
411|13184|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
401|2906|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
