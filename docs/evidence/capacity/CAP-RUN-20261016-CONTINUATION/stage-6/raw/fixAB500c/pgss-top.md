# pgss-top — fixAB500c (استعلاماتُ القاعدةِ خلالَ الموجةِ، قاعدةُ الموجةِ نفسِها)

```text
53377|12694|4.20|select claim_notification_delivery() result
34250|45822|0.75|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.ver
26235|4026|6.52|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_l
9833|4026|2.44|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7884|2598|3.03|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::tex
7607|6992|1.09|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
7109|10392|0.68|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4967|2598|1.91|select status::text, attempts, delivered_at::text from notification_outbox where order_id 
```
