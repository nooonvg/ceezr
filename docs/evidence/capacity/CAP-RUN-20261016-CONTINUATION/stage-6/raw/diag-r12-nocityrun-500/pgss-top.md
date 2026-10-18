# pgss-top — diag-r12-nocityrun-500

```text
30092|3247|9.27|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
27185|44127|0.62|select driver_offer_board($1::bigint) as result
13695|20857|0.66|select claim_notification_delivery() result
9397|9126|1.03|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8418|3237|2.60|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8175|2543|3.21|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6680|10140|0.66|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4778|2543|1.88|select o.id as id, o.city_id as city_id, extract($10 from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds from orders o where o.
3788|2543|1.49|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2486|2535|0.98|select driver_accept_offer($1::bigint, $2::uuid) as result
2149|10926|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
1868|5526|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1770|7305|0.24|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
1690|5086|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1625|2535|0.64|select driver_complete_ride($1::bigint, $2::uuid) as result
1513|2535|0.60|select driver_start_ride($1::bigint, $2::uuid) as result
1417|4036|0.35|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
1310|44127|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
1251|2543|0.49|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1125|19075|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
976|3198|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
929|5384|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
910|2535|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
840|2543|0.33|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
733|2543|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
712|2543|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
669|1205|0.55|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
603|2543|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
527|2543|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
490|19|25.78|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
456|2543|0.18|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
453|19140|0.02|select o.id::text as id, o.pickup_link, o.pickup_notes, st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng, (o.dropoff is not null) 
451|4|112.82|select public.sweep_decided_offer_notifications() result
390|1473|0.26|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
363|2543|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
353|7629|0.05|select kind, version, accepted_at from list_user_consents($1)
290|2543|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
277|8659|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
276|4|69.04|select relocate_drivers_by_location($1) as result
273|20828|0.01|select request_id from notification_outbox where id = $1::uuid
```
