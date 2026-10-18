# pgss-top — diag-r12-arrival8-500

```text
56989|4209|13.54|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
42499|11634|3.65|select claim_notification_delivery() result
12572|7755|1.62|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
10644|3289|3.24|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
10232|4208|2.43|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8006|13156|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6429|3289|1.95|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5032|4527|1.11|select claim_telegram_update_job_for_bot($1, $2, $3) as result
4421|7095|0.62|select driver_offer_board($1::bigint) as result
3128|3291|0.95|select driver_accept_offer($1::bigint, $2::uuid) as result
2905|3289|0.88|select o.id as id, o.city_id as city_id, extract($10 from (now() - coalesce(o.searching_since, o.created_at)))::bigint as waiting_seconds from orders o where o.
2742|8496|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2100|6578|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2050|4477|0.46|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1923|3289|0.58|select driver_complete_ride($1::bigint, $2::uuid) as result
1800|3432|0.52|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1791|3289|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1773|9036|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
1559|81|19.25|select claim_telegram_update_replies($1::integer, $2::integer) as result
1524|197773|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1254|4477|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1227|7167|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
1127|3289|0.34|select driver_mark_arrived($1::bigint, $2::uuid) as result
1086|4477|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
903|3133|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
832|3432|0.24|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
761|3828|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
724|4477|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
621|3|206.84|select public.sweep_decided_offer_notifications() result
547|2291|0.24|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
535|20|26.74|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
474|11055|0.04|select kind, version, accepted_at from list_user_consents($1)
469|4894|0.10|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
459|3432|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
358|3432|0.10|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
349|11631|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
333|3289|0.10|select rider_order_candidate($1::bigint, $2::uuid) as result
317|2297|0.14|insert into tracking_sessions (driver_id, city_id, trip_id, started_at) select d.id, d.city_id, $1, $2 from drivers d where d.id = $3::uuid on conflict do nothi
296|3289|0.09|with current as ( select id, driver_id, trip_id, started_at, last_fix_at, ended_at, end_reason, last_sequence from tracking_sessions where driver_id = $1::uuid 
282|14344|0.02|select d.id as driver_id, d.city_id, u.telegram_id, u.full_name, u.phone, d.verification_status, a.is_available, (d.last_location is not null) as has_location, 
```
