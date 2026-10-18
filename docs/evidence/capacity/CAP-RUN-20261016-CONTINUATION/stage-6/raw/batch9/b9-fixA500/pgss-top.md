```
39445|14121|2.79|select claim_notification_delivery() result
33136|44526|0.74|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
22297|3518|6.34|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
8699|2751|3.16|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8429|7404|1.14|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8212|3518|2.33|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
6615|10708|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
3746|2751|1.36|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2511|2677|0.94|select driver_accept_offer($1::bigint, $2::uuid) as result
2013|6226|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1708|8813|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1697|5502|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1681|3659|0.46|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1624|2677|0.61|select driver_complete_ride($1::bigint, $2::uuid) as result
1452|2677|0.54|select driver_start_ride($1::bigint, $2::uuid) as result
1327|2751|0.48|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1189|21161|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
947|3221|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
937|2677|0.35|select driver_mark_arrived($1::bigint, $2::uuid) as result
881|2751|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
825|3270|0.25|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
782|2751|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
674|2751|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
617|2751|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
555|3|184.93|select public.sweep_decided_offer_notifications() result
535|2751|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
530|3278|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
481|1375|0.35|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
464|2751|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
425|19|22.39|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
```
