# pgss-top — diag-r12-nearby4-500

```text
42513|16106|2.64|select claim_notification_delivery() result
33736|3818|8.84|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
19737|37802|0.52|select driver_offer_board($1::bigint) as result
10455|2851|3.67|select o.id as id, o.city_id as city_id, extract($10 from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds from orders o where o.
10041|7178|1.40|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
9638|3814|2.53|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9478|2851|3.32|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
7065|11384|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4899|2851|1.72|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2759|8434|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2622|2847|0.92|select driver_accept_offer($1::bigint, $2::uuid) as result
2438|3300|0.74|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1856|5702|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1731|2846|0.61|select driver_complete_ride($1::bigint, $2::uuid) as result
1693|8387|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
1644|2846|0.58|select driver_start_ride($1::bigint, $2::uuid) as result
1426|2851|0.50|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1116|37802|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
1087|6324|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
1005|2846|0.35|select driver_mark_arrived($1::bigint, $2::uuid) as result
992|2851|0.35|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
958|3313|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
891|14313|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
850|2851|0.30|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
848|3859|0.22|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
744|2851|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
661|2851|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
570|2851|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
555|2851|0.19|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
474|4|118.53|select public.sweep_decided_offer_notifications() result
469|19|24.69|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
413|2851|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
387|8553|0.05|select kind, version, accepted_at from list_user_consents($1)
376|1671|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
356|11746|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
351|37215|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
325|14314|0.02|select o.id::text as id, o.pickup_link, o.pickup_notes, st_y(o.pickup::geometry) as pickup_lat, st_x(o.pickup::geometry) as pickup_lng, (o.dropoff is not null) 
315|2851|0.11|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
285|2846|0.10|select rider_order_candidate($1::bigint, $2::uuid) as result
253|1180|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
```
