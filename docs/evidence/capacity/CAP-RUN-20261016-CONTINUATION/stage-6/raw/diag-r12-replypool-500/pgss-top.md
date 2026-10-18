# pgss-top — diag-r12-replypool-500

```text
22279|45570|0.49|select driver_offer_board($1::bigint) as result
20354|4218|4.83|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
20099|24022|0.84|select claim_notification_delivery() result
9704|4218|2.30|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8785|8188|1.07|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8047|2733|2.94|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6735|10932|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4701|2733|1.72|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2552|10996|0.23|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
2549|2737|0.93|select driver_accept_offer($1::bigint, $2::uuid) as result
2048|6433|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1859|9832|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1763|4174|0.42|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1655|5466|0.30|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1623|2733|0.59|select driver_complete_ride($1::bigint, $2::uuid) as result
1498|2733|0.55|select driver_start_ride($1::bigint, $2::uuid) as result
1363|2733|0.50|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1327|45570|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
974|2733|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
921|3260|0.28|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
864|2733|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
759|2733|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
745|2234|0.33|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
740|10393|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
657|3982|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
652|2733|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
627|2733|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
538|2733|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
510|2733|0.19|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
479|3|159.58|select public.sweep_decided_offer_notifications() result
422|19|22.23|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
384|2733|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
367|1589|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
346|8199|0.04|select kind, version, accepted_at from list_user_consents($1)
313|24005|0.01|select request_id from notification_outbox where id = $1::uuid
301|9666|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
300|2733|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
267|1082|0.25|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
247|2733|0.09|select rider_order_candidate($1::bigint, $2::uuid) as result
239|1144|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
```
