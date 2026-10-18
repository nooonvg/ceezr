```
49041|4741|10.34|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
36591|9803|3.73|select claim_notification_delivery() result
16743|9567|1.75|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16036|4714|3.40|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
15462|4010|3.86|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9016|16040|0.56|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8042|4010|2.01|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5532|6779|0.82|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3288|4011|0.82|select driver_accept_offer($1::bigint, $2::uuid) as result
2337|8020|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2225|4010|0.55|select driver_complete_ride($1::bigint, $2::uuid) as result
2178|4010|0.54|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2175|6385|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2060|11355|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1994|4010|0.50|select driver_start_ride($1::bigint, $2::uuid) as result
1646|99|16.63|select claim_telegram_update_replies($1::integer, $2::integer) as result
1534|4010|0.38|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1263|4010|0.31|select driver_mark_arrived($1::bigint, $2::uuid) as result
1174|142872|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1054|4010|0.26|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1026|3416|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
972|4010|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
911|583|1.56|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
844|4010|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
795|3|265.02|select public.sweep_decided_offer_notifications() result
656|3440|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
644|4010|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
596|2810|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
539|4010|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
505|12030|0.04|select kind, version, accepted_at from list_user_consents($1)
```
