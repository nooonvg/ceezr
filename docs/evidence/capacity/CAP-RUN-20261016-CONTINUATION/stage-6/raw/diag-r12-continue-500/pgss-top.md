# pgss-top — diag-r12-continue-500

```text
35363|4859|7.28|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
30844|43963|0.70|select driver_offer_board($1::bigint) as result
19473|22037|0.88|select claim_notification_delivery() result
11550|4859|2.38|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8732|7721|1.13|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
7513|2514|2.99|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6446|10056|0.64|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4721|2514|1.88|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2533|2515|1.01|select driver_accept_offer($1::bigint, $2::uuid) as result
2405|10035|0.24|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
1939|3569|0.54|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1914|5813|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1839|9255|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
1645|5028|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1605|2514|0.64|select driver_complete_ride($1::bigint, $2::uuid) as result
1507|2514|0.60|select driver_start_ride($1::bigint, $2::uuid) as result
1277|43963|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
1232|2514|0.49|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
939|2514|0.37|select driver_mark_arrived($1::bigint, $2::uuid) as result
885|3025|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
849|2514|0.34|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
797|2304|0.35|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
777|4579|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
772|2514|0.31|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
757|10142|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
711|2514|0.28|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
665|2514|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
531|2515|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
481|3|160.22|select public.sweep_decided_offer_notifications() result
433|2514|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
428|19|22.54|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
353|2514|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
343|7542|0.05|select kind, version, accepted_at from list_user_consents($1)
338|1455|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
296|22025|0.01|select request_id from notification_outbox where id = $1::uuid
291|2514|0.12|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
281|8821|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
260|2514|0.10|select rider_order_candidate($1::bigint, $2::uuid) as result
246|10159|0.02|select o.id::text as id, o.pickup_link, o.pickup_notes, st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng, (o.dropoff is not null) 
238|10056|0.02|select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_status, a.is_available, (d.last_location is not null) as has_location, 
```
