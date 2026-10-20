#!/usr/bin/env bash
set -u
B=/srv/ceezr-cap-20261016; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
unset REPO DIAG_POOL DIAG_EXTRA
R=$1; CONC=$2; IDX=$3; SIDE=${4:-cand}; export TRACE_FILE=$B/trace-cur.jsonl
rm -f $B/trace-cur.jsonl*
echo "=== $(date -Is) START $R conc=$CONC (diag+trace)"
if [ "$SIDE" = ref ]; then $B/bin/qual-wave-ref.sh $R $CONC $IDX diag; else $B/bin/qual-wave.sh $R $CONC $IDX diag; fi
rc=$?
E=$B/runs/$R/evidence; cp $B/trace-cur.jsonl.load.jsonl $E/load-trace.jsonl 2>/dev/null
sudo ip netns exec ceezrsbx2 psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -Atc "copy (select bot, update_id, (extract(epoch from created_at)*1000)::bigint, (extract(epoch from completed_at)*1000)::bigint, status, attempts from telegram_update_jobs) to stdout with csv" > $E/update-jobs.csv
echo "=== $(date -Is) END rc=$rc"; echo TRACE_DONE
