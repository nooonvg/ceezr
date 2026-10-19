43743|4586|9.54|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
29800|9494|3.14|select claim_notification_delivery() result
16345|10516|1.55|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14786|4556|3.25|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
13696|3786|3.62|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9329|3786|2.46|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
7115|11358|0.63|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5492|3788|1.45|select driver_accept_offer_with_matched_notice($1::bigint, $2::uuid) as result
4897|5467|0.90|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
2421|7572|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2280|6322|0.36|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2241|3786|0.59|select driver_complete_ride($1::bigint, $2::uuid) as result
2119|10516|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
2099|3786|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2086|3786|0.55|select driver_start_ride($1::bigint, $2::uuid) as result
1484|99|14.99|select claim_telegram_update_replies($1::integer, $2::integer) as result
1377|3786|0.36|select driver_mark_arrived($1::bigint, $2::uuid) as result
1239|3786|0.33|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1174|3|391.29|select public.sweep_decided_offer_notifications() result
991|3170|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
969|3786|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
890|3786|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
856|3786|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
739|651|1.13|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
641|3260|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
616|3786|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
593|2727|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
583|18|32.37|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
565|11358|0.05|select kind, version, accepted_at from list_user_consents($1)
525|3786|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
