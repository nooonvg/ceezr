# pgss-top — diag-r12-nearby-500

```text
90011|5927|15.19|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
41581|12376|3.36|select claim_notification_delivery() result
12670|5919|2.14|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
12124|6879|1.76|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9125|2867|3.18|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
7451|11468|0.65|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5834|2867|2.03|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5234|4589|1.14|select claim_telegram_update_job_for_bot($1, $2, $3) as result
3027|5020|0.60|select driver_offer_board($1::bigint) as result
2980|2867|1.04|select o.id as id, o.city_id as city_id, extract($10 from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds from orders o where o.
2977|9201|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2951|2870|1.03|select driver_accept_offer($1::bigint, $2::uuid) as result
2207|4538|0.49|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1916|5734|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1787|2867|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
1690|2867|0.59|select driver_start_ride($1::bigint, $2::uuid) as result
1682|7953|0.21|select list_rider_trip_events($1::bigint, $2::uuid) as result
1574|96|16.40|select claim_telegram_update_replies($1::integer, $2::integer) as result
1564|3007|0.52|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1544|204167|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1485|8568|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
1409|4538|0.31|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1058|2867|0.37|select driver_mark_arrived($1::bigint, $2::uuid) as result
993|4538|0.22|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
988|3|329.43|select public.sweep_decided_offer_notifications() result
901|3166|0.28|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
803|35|22.95|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, -- زمن الخادم لا طابع الجهاز: السؤال «متى ع
792|4538|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
741|3771|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
705|3007|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
494|4206|0.12|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
493|1970|0.25|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
475|10272|0.05|select kind, version, accepted_at from list_user_consents($1)
468|20|23.42|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
427|3007|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
368|12370|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
328|3007|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
309|2867|0.11|select rider_order_candidate($1::bigint, $2::uuid) as result
295|3|98.25|select relocate_drivers_by_location($1) as result
284|1975|0.14|insert into tracking_sessions (driver_id, city_id, trip_id, started_at) select d.id, d.city_id, $1, $2 from drivers d where d.id = $3::uuid on conflict do nothi
```
