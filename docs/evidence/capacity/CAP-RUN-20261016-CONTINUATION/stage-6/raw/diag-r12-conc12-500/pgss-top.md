# pgss-top — diag-r12-conc12-500

```text
44700|18208|2.45|select claim_notification_delivery() result
40970|40645|1.01|select driver_offer_board($1::bigint) as result
32471|4830|6.72|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
11984|4828|2.48|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7547|6469|1.17|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
5631|2091|2.69|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
5285|8328|0.63|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4107|2091|1.96|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2354|2083|1.13|select driver_accept_offer($1::bigint, $2::uuid) as result
1928|33115|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
1577|3009|0.52|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1479|7615|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1429|4354|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1393|4182|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1281|2082|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
1227|5248|0.23|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
1195|40645|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
1173|2082|0.56|select driver_start_ride($1::bigint, $2::uuid) as result
1111|33147|0.03|select o.id::text as id, o.pickup_link, o.pickup_notes, st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng, (o.dropoff is not null) 
1100|4411|0.25|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
991|2100|0.47|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
756|2082|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
750|4467|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
712|2438|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
702|2101|0.33|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
648|3|215.98|select public.sweep_decided_offer_notifications() result
646|2101|0.31|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
606|1756|0.35|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
538|2101|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
511|2100|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
502|2101|0.24|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
449|19|23.61|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
424|2101|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
306|2100|0.15|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
291|6283|0.05|select kind, version, accepted_at from list_user_consents($1)
256|1090|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
255|2100|0.12|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
246|26929|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
235|18207|0.01|select request_id from notification_outbox where id = $1::uuid
215|1001|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
```
