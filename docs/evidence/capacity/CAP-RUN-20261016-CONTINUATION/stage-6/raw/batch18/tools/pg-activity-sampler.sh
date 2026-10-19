#!/usr/bin/env bash
# مُعيّن نشاط pg_stat_activity أثناء الموجة (تشخيصي فقط): لقطة كل ثانيتين
# الاستخدام: pg-activity-sampler.sh OUT_FILE DURATION_SEC
set -u
OUT=${1:?OUT}; DUR=${2:?DUR}
B=/srv/ceezr-cap-20261016
END=$((SECONDS + DUR))
: > "$OUT"
while [ $SECONDS -lt $END ]; do
  TS=$(date +%s%3N)
  $B/bin/nsx psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -tAc \
    "select coalesce(application_name,''),state,coalesce(wait_event_type,''),coalesce(wait_event,''),count(*),max(extract(epoch from now()-query_start)) from pg_stat_activity where application_name is not null and application_name <> '' group by 1,2,3,4" >> "$OUT" 2>>"$OUT.err"
  echo "##$TS" >> "$OUT"
  sleep 2
done
