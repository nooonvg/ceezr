# pgss-top — fixA500b (استعلاماتُ القاعدةِ خلالَ الموجةِ، قاعدةُ الموجةِ نفسِها)

```text
29946|46282|0.65|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.ver
22125|4149|5.33|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_l
19962|22518|0.89|select claim_notification_delivery() result
10359|4149|2.50|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
9156|7840|1.17|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
8457|2689|3.15|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::tex
7087|10756|0.66|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
5173|2689|1.92|select status::text, attempts, delivered_at::text from notification_outbox where order_id 
```
