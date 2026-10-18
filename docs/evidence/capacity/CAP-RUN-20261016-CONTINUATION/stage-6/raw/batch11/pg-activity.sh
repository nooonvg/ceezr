#!/usr/bin/env bash
# عيّناتُ حالةِ اتّصالاتِ التطبيقِ كلَّ 250ms (تشخيص): الدور × الحالة × نوعُ الانتظار.
OUT=$1; DUR=${2:-200}
printf '%s\n' "select (extract(epoch from clock_timestamp())*1000)::bigint, application_name, state, coalesce(wait_event_type,''), coalesce(wait_event,''), count(*) from pg_stat_activity where application_name like 'ceezr:%' group by 1,2,3,4,5 \\watch 0.25" > /home/user/cap-seat/pga.sql
/home/user/cap-seat/bin/nsx bash -c "timeout $DUR psql -h 127.0.0.1 -p 55432 -U postgres -d postgres -AtF'|' -f /home/user/cap-seat/pga.sql" > $OUT 2>/dev/null
