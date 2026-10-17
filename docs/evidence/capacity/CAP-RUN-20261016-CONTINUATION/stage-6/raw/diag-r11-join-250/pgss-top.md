# pgss-top — diag-r11-join-250

```text
34785|3435|10.13|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
14298|26784|0.53|select claim_notification_delivery() result
12161|25217|0.48|select driver_offer_board($1::bigint) as result
8539|3435|2.49|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7339|10828|0.68|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6862|2707|2.53|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
5969|7665|0.78|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
4236|2707|1.56|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3213|13600|0.24|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
2557|2708|0.94|select driver_accept_offer($1::bigint, $2::uuid) as result
2189|8948|0.24|select list_rider_trip_events($1::bigint, $2::uuid) as result
2106|6286|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1888|2707|0.70|select driver_complete_ride($1::bigint, $2::uuid) as result
1853|3122|0.59|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1740|5414|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1730|2707|0.64|select driver_start_ride($1::bigint, $2::uuid) as result
1368|2707|0.51|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1103|2707|0.41|select driver_mark_arrived($1::bigint, $2::uuid) as result
1013|3408|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
871|2707|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
800|2707|0.30|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
791|25217|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
730|2707|0.27|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
656|1819|0.36|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
628|2707|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
599|7085|0.08|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
596|2607|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
587|2707|0.22|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
507|2707|0.19|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
480|2954|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
476|19|25.06|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
406|2707|0.15|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
377|1498|0.25|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
368|8121|0.05|select kind, version, accepted_at from list_user_consents($1)
357|10828|0.03|select u.telegram_id::text as telegram_id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id where o.id = $1::uuid
351|2607|0.13|insert into tracking_sessions (driver_id, city_id, trip_id, started_at) select d.id, d.city_id, $1, $2 from drivers d where d.id = $3::uuid on conflict do nothi
342|26611|0.01|select request_id from notification_outbox where id = $1::uuid
307|4|76.77|select relocate_drivers_by_location($1) as result
305|2707|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
303|9475|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
```
