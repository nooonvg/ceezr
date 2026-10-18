```
45413|10101|4.50|select claim_notification_delivery() result
28130|43188|0.65|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verification_status::text as verification_status, d.last_location is not 
21404|3695|5.79|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
9905|3110|3.18|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
9005|7749|1.16|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8561|3695|2.32|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7594|12440|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4860|3110|1.56|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2733|3110|0.88|select driver_accept_offer($1::bigint, $2::uuid) as result
2383|3955|0.60|select claim_telegram_update_job_for_bot($1, $2, $3) as result
2136|6594|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2101|6220|0.34|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1844|3110|0.59|select driver_complete_ride($1::bigint, $2::uuid) as result
1672|8923|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1649|3110|0.53|select driver_start_ride($1::bigint, $2::uuid) as result
1573|3110|0.51|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1045|3110|0.34|select driver_mark_arrived($1::bigint, $2::uuid) as result
997|3110|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
903|3191|0.28|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
866|3110|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
838|3|279.30|select public.sweep_decided_offer_notifications() result
814|12760|0.06|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
782|3110|0.25|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
706|3110|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
703|19|37.01|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
624|3111|0.20|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
485|3110|0.16|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
441|1961|0.23|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
403|3110|0.13|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
384|9330|0.04|select kind, version, accepted_at from list_user_consents($1)
```
