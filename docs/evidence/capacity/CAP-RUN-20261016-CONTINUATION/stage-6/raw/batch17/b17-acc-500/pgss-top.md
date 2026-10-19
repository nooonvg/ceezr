43703|4867|8.98|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
38643|10435|3.70|select claim_notification_delivery() result
18440|10564|1.75|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
16258|4832|3.36|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
15033|3731|4.03|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8643|3731|2.32|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
7243|11193|0.65|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6147|6011|1.02|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
6063|3731|1.62|select driver_accept_offer_with_matched_notice($1::bigint, $2::uuid) as result
2927|7462|0.39|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2570|6969|0.37|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2323|3731|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
2261|3731|0.61|select driver_start_ride($1::bigint, $2::uuid) as result
2229|10564|0.21|select list_rider_trip_events($1::bigint, $2::uuid) as result
2180|3731|0.58|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1559|3731|0.42|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1443|3731|0.39|select driver_mark_arrived($1::bigint, $2::uuid) as result
1342|109|12.31|select claim_telegram_update_replies($1::integer, $2::integer) as result
1197|121386|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1131|3464|0.33|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1074|3731|0.29|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
947|633|1.50|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
929|3731|0.25|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
923|3|307.78|select public.sweep_decided_offer_notifications() result
921|3731|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
833|20|41.66|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
746|3511|0.21|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
692|2637|0.26|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
640|3731|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
598|11193|0.05|select kind, version, accepted_at from list_user_consents($1)
