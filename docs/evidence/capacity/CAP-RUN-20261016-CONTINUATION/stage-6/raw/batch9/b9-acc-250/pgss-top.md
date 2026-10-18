```
46593|4547|10.25|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
32464|9871|3.29|select claim_notification_delivery() result
15141|9206|1.64|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14280|4509|3.17|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
13273|3795|3.50|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8751|15180|0.58|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
7882|3795|2.08|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
4639|5755|0.81|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3105|3796|0.82|select driver_accept_offer($1::bigint, $2::uuid) as result
2258|7590|0.30|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2222|6673|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2148|3795|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
2139|3795|0.56|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2019|10784|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1926|3795|0.51|select driver_start_ride($1::bigint, $2::uuid) as result
1255|99|12.68|select claim_telegram_update_replies($1::integer, $2::integer) as result
1242|3795|0.33|select driver_mark_arrived($1::bigint, $2::uuid) as result
1235|3|411.72|select public.sweep_decided_offer_notifications() result
1188|3795|0.31|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
963|3795|0.25|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
958|3196|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
957|3795|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
833|3795|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
727|582|1.25|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
724|3320|0.22|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
601|3795|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
554|2715|0.20|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
507|11385|0.04|select kind, version, accepted_at from list_user_consents($1)
500|18|27.80|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
494|3795|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
