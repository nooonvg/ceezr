#!/usr/bin/env bash
# تصديرُ عروضِ الموجةِ وطلباتِها من القاعدةِ (قبلَ أيِّ fresh-db لاحقٍ) — مدخلُ p4-decompose.py
set -euo pipefail
B=/home/user/cap-seat; OUT=$1
P="psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -q"
$B/bin/nsx bash -c "$P -c \"\\copy (select o.id, round(extract(epoch from o.created_at)*1000) as created_ms, o.broadcast_round, o.status from orders o) to stdout with csv header\"" > $OUT/orders.csv
$B/bin/nsx bash -c "$P -c \"\\copy (select f.order_id, f.round, round(extract(epoch from f.created_at)*1000) as created_ms, u.telegram_id, f.status from order_offers f join drivers d on d.id=f.driver_id join users u on u.id=d.user_id) to stdout with csv header\"" > $OUT/offers.csv
wc -l $OUT/orders.csv $OUT/offers.csv | tail -1
