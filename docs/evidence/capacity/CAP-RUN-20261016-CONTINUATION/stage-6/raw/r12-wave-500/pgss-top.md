# pgss-top — r12-wave-500

```text
20673|4269|4.84|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_location::geometry) as lng, (extract($1 from d.last_location_at) * $2):
19719|24116|0.82|select claim_notification_delivery() result
17464|45808|0.38|select driver_offer_board($1::bigint) as result
10158|4268|2.38|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8562|8221|1.04|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8084|2725|2.97|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text::jsonb, $14::text::jsonb, $15) as result
6834|10900|0.63|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5057|2725|1.86|select status::text, attempts, delivered_at::text from notification_outbox where order_id = $1 and offer_id is not null
2718|2727|1.00|select driver_accept_offer($1::bigint, $2::uuid) as result
2678|4186|0.64|select claim_telegram_update_job_for_bot($1, $2, $3) as result
2658|11224|0.24|select abandon_notification_delivery($1::uuid, $2::uuid, $3::text) result
1979|6128|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1869|9816|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
1693|2725|0.62|select driver_complete_ride($1::bigint, $2::uuid) as result
1655|5450|0.30|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1527|2725|0.56|select driver_start_ride($1::bigint, $2::uuid) as result
1365|2725|0.50|select start_trial($1::uuid, $2::subscription_plan) as result where not exists (select $4 from subscriptions s where s.driver_id = $3::uuid)
1327|45808|0.03|select d.verification_status::text as verification_status, d.last_location is not null as has_location, d.last_location_quality as location_quality, extract($2 
959|2725|0.35|select driver_mark_arrived($1::bigint, $2::uuid) as result
930|3253|0.29|select finish_notification_delivery($1::uuid, $2::uuid, $3::text, $4, $5::text) result
880|2725|0.32|select claim_and_enqueue_telegram_update( $1, $2, $3, $4, $5 ) as result
793|2240|0.35|select requeue_notification_delivery_signal_wait( $1::uuid, $2::uuid, $3::integer) result
775|2725|0.28|select record_telegram_update_effect( $1, $2, $3::uuid, $4::jsonb ) as result
760|2725|0.28|insert into users (city_id, telegram_id, full_name, phone, role, language_code) values ((select id from cities where code = $1), $2::bigint, $3, $4, $5::user_ro
726|9997|0.07|with ins as ( insert into driver_offers_board_receipts (driver_id, offer_id, city_id, received_at) select dr.id, v.offer_id::uuid, dr.city_id, now() from ( sele
669|4035|0.17|select city_id, key, value, value_type from platform_settings where city_id = $1 order by key
606|2725|0.22|insert into users (city_id, telegram_id, full_name, phone, language_code, role) values ($1, $2, $3, $4, $5, $6) on conflict (telegram_id) do update set full_nam
535|2725|0.20|insert into riders (city_id, user_id) values ((select id from cities where code = $1), $2::uuid) on conflict (user_id) do nothing
529|2725|0.19|select finish_telegram_update_replies( $1, $2, $3::uuid, $4::integer, $5, $6::integer ) as result
503|3|167.61|select public.sweep_decided_offer_notifications() result
420|19|22.11|select persist_driver_location_batch( $1::uuid, $2::jsonb ) as result
379|2725|0.14|insert into drivers (city_id, user_id, vehicle_type, plate_number, national_id, vehicle_photo_file_id) values ($1, $2, $3, $4, $5, $6) on conflict (user_id) do 
356|1665|0.21|with current as ( select id from drivers where id = $1 ), written as ( update drivers as d set last_location = st_setsrid( st_makepoint($2, $3), $14)::geography
356|3|118.70|select relocate_drivers_by_location($1) as result
351|8175|0.04|select kind, version, accepted_at from list_user_consents($1)
322|9353|0.03|select ru.telegram_id::text as rider_telegram_id, ru.language_code as rider_language, du.full_name as driver_name, d.plate_number as plate, d.vehicle_type::text
316|24081|0.01|select request_id from notification_outbox where id = $1::uuid
307|1236|0.25|select finish_notification_delivery_via_board( $1::uuid, $2::uuid) result
285|2725|0.10|update drivers set verification_status = $2::verification_status where id = $1::uuid and verification_status = $3::verification_status
267|2725|0.10|select rider_order_candidate($1::bigint, $2::uuid) as result
```
