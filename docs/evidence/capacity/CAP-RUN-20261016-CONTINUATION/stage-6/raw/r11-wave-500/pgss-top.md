# pgss-top — r11-wave-500

```text
2636|4738|0.56|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
2302|4172|0.55|select claim_notification_delivery() result
2227|3897|0.57|select claim_telegram_update_job_for_bot($1, $2, $3) as result
1703|227326|0.01|select status from telegram_update_jobs where bot = $2 and update_id = $1::bigint
1517|520|2.92|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
1275|520|2.45|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
1249|4738|0.26|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
1094|3858|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
923|1512|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
803|4738|0.17|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
727|3826|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
613|2576|0.24|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
561|1020|0.55|select driver_offer_board($1::bigint) as result
550|378|1.45|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
480|962|0.50|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
378|1121|0.34|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
376|378|1.00|select driver_accept_offer($1::bigint, $2::uuid) as result
266|756|0.35|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
264|378|0.70|select driver_complete_ride($1::bigint, $2::uuid) as result
241|378|0.64|select driver_start_ride($1::bigint, $2::uuid) as result
218|5494|0.04|select kind, version, accepted_at from list_user_consents($1)
214|1083|0.20|select list_rider_trip_events($1::bigint, $2::uuid) as result
168|394|0.43|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
153|3858|0.04|select get_user_language($1::bigint) as r
152|378|0.40|select driver_mark_arrived($1::bigint, $2::uuid) as result
147|3858|0.04|select telegram_update_effect_recorded($1, $2) as r
145|436|0.33|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
140|9477|0.01|select id, code, name_ar, name_en from cities where is_active = $1 order by name_ar
129|3|43.03|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
89|394|0.23|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
85|378|0.22|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
84|524|0.16|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
84|394|0.21|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
80|15348|0.01|select role::text as role, is_blocked, language_code from users where telegram_id = $1
69|105|0.66|select claim_broadcast_recipients($1::uuid) result
67|306|0.22|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
67|519|0.13|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
61|100|0.61|select claim_telegram_update_replies($1::integer, $2::integer) as result
60|1512|0.04|select u.telegram_id::text as telegram_id from orders o join riders r on r.id = o.rider_id join users u on u.id = r.user_id where o.id = $1::uuid
54|4146|0.01|select request_id from notification_outbox where id = $1::uuid
```
