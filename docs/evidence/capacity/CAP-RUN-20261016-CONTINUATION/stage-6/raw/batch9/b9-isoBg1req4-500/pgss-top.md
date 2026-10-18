```
39322|11653|3.37|select claim_notification_delivery() result
25862|5080|5.09|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
16114|5080|3.17|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
14592|8840|1.65|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
14463|3941|3.67|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
8745|15764|0.55|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
8205|3941|2.08|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
5915|6647|0.89|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
3780|4403|0.86|select claim_telegram_update_job_for_bot($1, $2, $3) as result
3120|3945|0.79|select driver_accept_offer($1::bigint, $2::uuid) as result
2634|8031|0.33|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2286|7882|0.29|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
2180|3941|0.55|select driver_complete_ride($1::bigint, $2::uuid) as result
2156|3941|0.55|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1928|10868|0.18|select list_rider_trip_events($1::bigint, $2::uuid) as result
1885|3941|0.48|select driver_start_ride($1::bigint, $2::uuid) as result
1460|3941|0.37|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
1259|3941|0.32|select driver_mark_arrived($1::bigint, $2::uuid) as result
1218|3941|0.31|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
1105|70|15.78|select claim_telegram_update_replies($1::integer, $2::integer) as result
1098|4745|0.23|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
1085|3603|0.30|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
970|3|323.19|select public.sweep_decided_offer_notifications() result
944|3941|0.24|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
851|3950|0.22|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
820|3941|0.21|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
598|3941|0.15|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
578|20|28.90|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
521|2678|0.19|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
488|3941|0.12|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
```
