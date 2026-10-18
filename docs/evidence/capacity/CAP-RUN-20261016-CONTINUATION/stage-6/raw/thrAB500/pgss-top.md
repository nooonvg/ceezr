# pgss-top — thrAB500 (الرأسُ 53c57a26، التقطت من قاعدةِ الموجةِ قبلَ إعادةِ بناءِ القالبِ)

```text
36256|3514|10.32|select d.id as driver_id, d.city_id, st_y(d.last_location::geometry) as lat, st_x(d.last_locati
33837|46877|0.72|with board as ( select driver_offer_board($1::bigint) as payload ), elig as ( select d.verifica
26562|13398|1.98|select claim_notification_delivery() result
13171|2754|4.78|select o.id as id, o.city_id, extract($10 from (now() - coalesce(o.searching_since, 
8477|3513|2.41|select open_offer_round( $1::uuid, $2::integer, $3::timestamptz, $4::jsonb ) as result
7845|2754|2.85|select request_ride_with_offer($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::tex
7613|8330|0.91|select ack_rider_trip_events( $1::bigint, $2::uuid, $3::uuid[] ) as result
6807|10968|0.62|select enqueue_rider_trip_notice($1::uuid, $2::text) as r
4027|2754|1.46|select status::text, attempts, delivered_at::text from notification_outbox where order_id 
2563|2743|0.93|select driver_accept_offer($1::bigint, $2::uuid) as result
2148|6709|0.32|select requeue_notification_delivery($1::uuid, $2::uuid, $3::integer) result
1936|10057|0.19|select list_rider_trip_events($1::bigint, $2::uuid) as result
```
