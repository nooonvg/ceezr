#!/usr/bin/env bash
# أعلى الاستعلامات زمنًا كليًا (تشخيصٌ فقط؛ لا يدخلُ البوابات)
B=/home/user/cap-seat
$B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -F '|' -Atc \"select round(total_exec_time)::bigint as total_ms, calls, round(mean_exec_time::numeric,2) as mean_ms, left(regexp_replace(query,'\\s+',' ','g'),160) from pg_stat_statements order by total_exec_time desc limit ${2:-30}\"" > "$1"
