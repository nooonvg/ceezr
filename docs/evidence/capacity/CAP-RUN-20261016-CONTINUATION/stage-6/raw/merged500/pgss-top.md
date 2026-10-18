# pgss-top — merged500 (الرأسُ المدموجُ 5401e998، قاعدةُ الموجةِ نفسِها)

```text
44937|14084|3.19|select claim_notification_delivery() result
35630|46474|0.77|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.ver
23186|4308|5.38|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_l
9909|4308|2.30|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
8192|2756|2.97|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::tex
7877|7433|1.06|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
6775|11024|0.61|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4680|2756|1.70|select status::text, attempts, delivered_at::text from notification_outbox where order_id 
```
