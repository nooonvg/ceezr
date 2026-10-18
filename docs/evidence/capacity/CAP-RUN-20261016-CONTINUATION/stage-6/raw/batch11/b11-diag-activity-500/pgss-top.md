```
44128|4918|8.97|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
40265|10232|3.94|select claim_notification_delivery() result
16981|4887|3.47|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
16546|8815|1.88|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
15165|3829|3.96|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9269|15316|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8489|3829|2.22|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5206|6083|0.86|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3379|3830|0.88|select driver_accept_offer($1::bigint, $2::uuid) as result
2561|7658|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2355|6797|0.35|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2261|3829|0.59|select driver_complete_ride($1::bigint, $2::uuid) as result
2168|3829|0.57|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2068|3829|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
2038|10583|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1704|109|15.63|select claim_telegram_update_replies($1::integer, $2::integer) as result
1525|3829|0.40|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1316|3829|0.34|select driver_mark_arrived($1::bigint, $2::uuid) as result
1066|3433|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1066|118136|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1064|3829|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
943|650|1.45|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
940|3829|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
866|3|288.81|select public.sweep_decided_offer_notifications() result
857|3829|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
689|3500|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
662|20|33.10|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
626|3829|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
611|2750|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
542|11487|0.05|select kind, version, accepted_at from list_user_consents($1)
```
