# pgss-top — fixAB500b (الرأسُ 272fbc59، قاعدةُ الموجةِ نفسِها)

```text
42622|14233|2.99|select claim_notification_delivery() result
27044|46418|0.58|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.ver
21366|4314|4.95|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_l
9515|4314|2.21|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8561|7562|1.13|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8402|2851|2.95|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::tex
6713|11404|0.59|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4916|2851|1.72|select status::text, attempts, delivered_at::text from notification_outbox where order_id 
2758|8640|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
2687|2854|0.94|select driver_accept_offer($1::bigint, $2::uuid) as result
1742|5702|0.31|select (record_attendance($1::uuid, $2, $3) ->> $4)::boolean as ok
1704|4376|0.39|select claim_telegram_update_job_for_bot($1, $2, $3) as result
```
