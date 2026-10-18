```
38136|15575|2.45|select claim_notification_delivery() result
26874|44546|0.60|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
25143|3674|6.84|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
9652|3044|3.17|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9269|7373|1.26|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8662|3673|2.36|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7418|12168|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4302|3044|1.41|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3805|11810|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2680|3042|0.88|select driver_accept_offer($1::bigint, $2::uuid) as result
2375|3942|0.60|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1856|6088|0.30|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1740|3042|0.57|select driver_complete_ride($1::bigint, $2::uuid) as result
1634|3042|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1582|8436|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1519|3044|0.50|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1082|3728|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1040|3042|0.34|select driver_mark_arrived($1::bigint, $2::uuid) as result
983|3044|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
884|3044|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
839|12790|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
825|4|206.16|select public.sweep_decided_offer_notifications() result
802|3044|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
669|3044|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
595|3044|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
570|19|30.02|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
510|3044|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
466|15538|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
422|3044|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
407|9132|0.04|select kind, version, accepted_at from list_user_consents($1)
```
