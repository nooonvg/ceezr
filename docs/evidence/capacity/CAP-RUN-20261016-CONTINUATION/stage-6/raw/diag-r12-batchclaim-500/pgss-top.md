# pgss-top — diag-r12-batchclaim-500

```text
29675|3512|8.45|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
21391|38042|0.56|select driver_offer_board($1::bigint) as result
20916|2676|7.82|select o.id as id, o.city_id as city_id, extract($10 from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds from orders o where o.
20270|21947|0.92|select claim_notification_delivery() result
9525|9611|0.99|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8910|3511|2.54|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8342|2676|3.12|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6655|10680|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
3980|2676|1.49|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2617|2670|0.98|select driver_accept_offer($1::bigint, $2::uuid) as result
2220|11657|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
2144|6438|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1725|5352|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1651|7195|0.23|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
1614|2670|0.60|select driver_complete_ride($1::bigint, $2::uuid) as result
1505|2670|0.56|select driver_start_ride($1::bigint, $2::uuid) as result
1422|4242|0.34|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
1292|2676|0.48|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1141|38042|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
1014|5821|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
982|16314|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
963|2670|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
961|3261|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
891|2676|0.33|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
709|2676|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
708|2676|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
641|2676|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
641|1179|0.54|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
536|2676|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
488|2676|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
444|4|110.93|select public.sweep_decided_offer_notifications() result
433|19|22.79|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
379|8028|0.05|select kind, version, accepted_at from list_user_consents($1)
376|16397|0.02|select o.id::text as id, o.pickup_link, o.pickup_notes, st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng, (o.dropoff is not null) 
359|1586|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
359|2676|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
323|2676|0.12|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
302|21937|0.01|select request_id from notification_outbox where id = $1::uuid
299|9614|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
272|2670|0.10|select rider_order_candidate($1::bigint, $2::uuid) as result
```
