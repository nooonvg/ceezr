```
43677|4953|8.82|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
40226|11110|3.62|select claim_notification_delivery() result
15899|4941|3.22|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
14928|3944|3.78|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
14002|8956|1.56|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8821|15776|0.56|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8666|3944|2.20|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5517|6917|0.80|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3291|3945|0.83|select driver_accept_offer($1::bigint, $2::uuid) as result
2529|7888|0.32|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2500|7556|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2158|3944|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
2133|3944|0.54|select driver_complete_ride($1::bigint, $2::uuid) as result
2027|3944|0.51|select driver_start_ride($1::bigint, $2::uuid) as result
1925|10826|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1538|97|15.86|select claim_telegram_update_replies($1::integer, $2::integer) as result
1490|3944|0.38|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1293|3944|0.33|select driver_mark_arrived($1::bigint, $2::uuid) as result
1050|3552|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
1008|3944|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
990|3944|0.25|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
977|111668|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
925|667|1.39|select claim_telegram_update_jobs_for_bot($1, $2, $3, $4) as result
826|3944|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
693|3564|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
679|3|226.19|select public.sweep_decided_offer_notifications() result
661|20|33.07|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
636|3944|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
594|2768|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
508|11832|0.04|select kind, version, accepted_at from list_user_consents($1)
```
