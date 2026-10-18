# pgss-top — r11-wave-250

```text
46235|15368|3.01|select claim_notification_delivery() result
20309|4340|4.68|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
14191|7425|1.91|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9047|4340|2.08|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8970|3070|2.92|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
7303|12280|0.59|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6930|14467|0.48|select driver_offer_board($1::bigint) as result
5335|3070|1.74|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3795|12173|0.31|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2811|3072|0.92|select driver_accept_offer($1::bigint, $2::uuid) as result
2174|3126|0.70|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1883|6140|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1814|3070|0.59|select driver_complete_ride($1::bigint, $2::uuid) as result
1659|3070|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1592|8408|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1553|3070|0.51|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1245|3|415.10|select public.sweep_decided_offer_notifications() result
1159|3070|0.38|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1025|3070|0.33|select driver_mark_arrived($1::bigint, $2::uuid) as result
898|3186|0.28|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
854|3070|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
794|3070|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
692|3070|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
621|4050|0.15|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
604|3070|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
523|2070|0.25|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
510|52071|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
502|6222|0.08|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
500|3070|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
468|19|24.64|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
454|15362|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
430|14467|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
425|3070|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
388|9210|0.04|select kind, version, accepted_at from list_user_consents($1)
341|3070|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
277|3070|0.09|select rider_order_candidate($1::bigint, $2::uuid) as result
275|2070|0.13|insert into tracking_sessions (driver_id, city_id, trip_id, started_at) select d.id, d.city_id, $1, $2 from drivers d where d.id = $3::uuid on conflict do nothi
244|12280|0.02|select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_status, a.is_available, (d.last_location is not null) as has_location, 
243|3070|0.08|insert into driver_capabilities (city_id, driver_id, service, is_enabled) values ($1, $2, $3, $4) on conflict (driver_id, service) do update set is_enabled = $5
237|12280|0.02|select u.telegram_id::text as telegram_id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id where o.id = $1::uuid
```
