```
48650|12373|3.93|select claim_notification_delivery() result
33134|46696|0.71|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
30717|4215|7.29|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
10196|4214|2.42|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7113|10808|0.66|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
6598|2703|2.44|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
5820|7391|0.79|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
4516|2703|1.67|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
3049|2705|1.13|select driver_accept_offer($1::bigint, $2::uuid) as result
2264|4174|0.54|select claim_telegram_update_job_for_bot($1, $2, $3) as result
2125|5921|0.36|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1811|5406|0.33|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1752|8564|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
1682|2702|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
1621|2702|0.60|select driver_start_ride($1::bigint, $2::uuid) as result
1328|2703|0.49|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1073|2702|0.40|select driver_mark_arrived($1::bigint, $2::uuid) as result
1004|3260|0.31|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
870|2703|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
863|3|287.71|select public.sweep_decided_offer_notifications() result
806|9958|0.08|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
798|2703|0.30|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
728|2703|0.27|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
663|4019|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
601|2703|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
582|2703|0.22|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
567|1373|0.41|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
560|2471|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
500|1759|0.28|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
429|19|22.58|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
```
