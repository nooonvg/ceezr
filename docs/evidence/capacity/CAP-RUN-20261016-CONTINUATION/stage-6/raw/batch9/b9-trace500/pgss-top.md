```
42947|13436|3.20|select claim_notification_delivery() result
27536|46153|0.60|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
20934|4448|4.71|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
9968|4448|2.24|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9542|7086|1.35|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8882|2868|3.10|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6963|11472|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4479|2868|1.56|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3115|9589|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2652|2873|0.92|select driver_accept_offer($1::bigint, $2::uuid) as result
2334|4173|0.56|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1758|5736|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1716|2868|0.60|select driver_complete_ride($1::bigint, $2::uuid) as result
1595|2868|0.56|select driver_start_ride($1::bigint, $2::uuid) as result
1504|8006|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1340|2868|0.47|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1016|3481|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
999|2868|0.35|select driver_mark_arrived($1::bigint, $2::uuid) as result
895|2868|0.31|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
791|2868|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
693|9896|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
685|2868|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
681|3|227.07|select public.sweep_decided_offer_notifications() result
665|4201|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
659|2868|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
571|2868|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
473|2868|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
413|19|21.73|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
379|1639|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
379|2868|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
