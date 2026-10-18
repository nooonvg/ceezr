# pgss-top — diag-r12-offersignal-500

```text
42950|3133|13.71|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
26591|43516|0.61|select driver_offer_board($1::bigint) as result
16664|2452|6.80|select o.id as id, o.city_id as city_id, extract($10 from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds from orders o where o.
12602|20853|0.60|select claim_notification_delivery() result
8593|9236|0.93|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8343|3133|2.66|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7204|2452|2.94|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6159|9756|0.63|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
3658|2452|1.49|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2336|2439|0.96|select driver_accept_offer($1::bigint, $2::uuid) as result
2155|11105|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1903|7809|0.24|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
1641|4846|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1640|4904|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1500|2439|0.61|select driver_complete_ride($1::bigint, $2::uuid) as result
1410|4201|0.34|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
1409|2439|0.58|select driver_start_ride($1::bigint, $2::uuid) as result
1267|43516|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
1195|2452|0.49|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1193|20352|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
931|2439|0.38|select driver_mark_arrived($1::bigint, $2::uuid) as result
877|5229|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
860|2893|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
776|2452|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
773|2452|0.32|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
718|2452|0.29|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
644|1032|0.62|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
576|2452|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
511|2452|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
479|19|25.23|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
479|20429|0.02|select o.id::text as id, o.pickup_link, o.pickup_notes, st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng, (o.dropoff is not null) 
442|2452|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
336|2452|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
327|1427|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
323|7356|0.04|select kind, version, accepted_at from list_user_consents($1)
294|1084|0.27|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
289|2452|0.12|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
267|20833|0.01|select request_id from notification_outbox where id = $1::uuid
246|7662|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
243|2563|0.09|select u.telegram_id::text as telegram_id from drivers d join users u on u.id = d.user_id where d.id = any($1::uuid[])
```
