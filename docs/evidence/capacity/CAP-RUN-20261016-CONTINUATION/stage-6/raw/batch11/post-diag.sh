#!/usr/bin/env bash
# بعدَ موجةٍ تشخيصيّة: إيقافُ البوّابةِ (يُكتَبُ ملفُّ تعريفِ CPU)، وتصديرُ pg_stat_statements كاملاً وتوقيتاتِ وظائفِ تيليجرام.
set -u
B=/home/user/cap-seat; ROUND=$1; E=$B/runs/$ROUND/evidence
$B/bin/nsx bash -c "pkill -TERM -f '[a]pps/gateway/src/index.ts'" || true
for i in $(seq 1 60); do $B/bin/nsx bash -c "pgrep -f '[a]pps/gateway/src/index.ts'" >/dev/null || break; sleep 1; done
sleep 1
cp $B/prof/*.cpuprofile $E/ 2>/dev/null || true
[ -f "$B/trace-cur.jsonl.load.jsonl" ] && cp $B/trace-cur.jsonl.load.jsonl $E/dispatch-trace.jsonl.load.jsonl
$B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -c \"copy (select calls, round(total_exec_time::numeric,3) total_ms, round(mean_exec_time::numeric,4) mean_ms, round(stddev_exec_time::numeric,4) stddev_ms, round(max_exec_time::numeric,3) max_ms, rows, regexp_replace(query, '\\s+', ' ', 'g') query from pg_stat_statements s join pg_database d on d.oid=s.dbid where d.datname='ceezr_cap_20261016' order by total_exec_time desc) to stdout with csv header\"" > $E/pgss-full.csv
$B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -c \"copy (select bot, update_id, (extract(epoch from created_at)*1000)::bigint created_ms, (extract(epoch from effect_recorded_at)*1000)::bigint effect_ms from telegram_update_jobs order by created_at) to stdout with csv header\"" > $E/telegram-jobs.csv
wc -l $E/pgss-full.csv $E/telegram-jobs.csv; ls $E/*.cpuprofile 2>/dev/null
echo POST_DIAG_DONE
