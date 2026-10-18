# pgss-top — fixB500b (استعلاماتُ القاعدةِ خلالَ الموجةِ، قاعدةُ الموجةِ نفسِها)

```text
56647|12453|4.55|select claim_notification_delivery() result
27795|4101|6.78|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_l
23540|45681|0.52|select driver_offer_board($1::bigint) as result
9610|4101|2.34|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7205|2646|2.72|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::tex
7058|7068|1.00|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
6604|10584|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4940|2646|1.87|select status::text, attempts, delivered_at::text from notification_outbox where order_id 
```
