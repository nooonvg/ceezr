#!/usr/bin/env bash
# الدفعة 22: b21-trace + حارسُ مستوى القالب + عيّناتُ اتصالاتٍ كلَّ 2s (جلسةٌ واحدةٌ بـ\watch)
set -u
B=/srv/ceezr-cap-20261016; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
unset REPO DIAG_POOL DIAG_EXTRA
R=$1; CONC=$2; IDX=$3; SIDE=${4:-cand}; export TRACE_FILE=$B/trace-cur.jsonl
rm -f $B/trace-cur.jsonl* $B/conn-cur.txt
PSQL="sudo ip netns exec ceezrsbx2 psql -h 127.0.0.1 -p 55432 -U postgres"
lvl=$($PSQL -d ceezr_cap_tpl -Atc "select (select count(*) from pg_proc where proname like 'driver_%_with_notice')=3 and position('e.lane_key = j.lane_key' in pg_get_functiondef('claim_telegram_update_jobs_for_bot(integer,integer,text,integer)'::regprocedure))>0")
if [ "$lvl" != t ]; then echo "TEMPLATE_LEVEL_MISMATCH $R"; exit 9; fi
echo "=== $(date -Is) START $R conc=$CONC side=$SIDE (diag+trace+conn)"
( printf "%s\n" "set application_name='b22-conn-sampler';" "select (extract(epoch from clock_timestamp())*1000)::bigint as t, coalesce(application_name,''), coalesce(state,''), count(*) from pg_stat_activity where datname='ceezr_cap_20261016' and backend_type='client backend' group by 2,3 \\watch 2" | $PSQL -d postgres -At -F, > $B/conn-cur.txt 2>/dev/null ) &
SP=$!
if [ "$SIDE" = ref ]; then $B/bin/qual-wave-ref.sh $R $CONC $IDX diag; else $B/bin/qual-wave.sh $R $CONC $IDX diag; fi
rc=$?
$PSQL -d postgres -Atc "select count(pg_terminate_backend(pid)) from pg_stat_activity where application_name='b22-conn-sampler'" >/dev/null; wait $SP 2>/dev/null
E=$B/runs/$R/evidence; cp $B/trace-cur.jsonl.load.jsonl $E/load-trace.jsonl 2>/dev/null; cp $B/conn-cur.txt $E/conn-samples.csv
$PSQL -d ceezr_cap_20261016 -Atc "copy (select bot, update_id, (extract(epoch from created_at)*1000)::bigint, (extract(epoch from completed_at)*1000)::bigint, status, attempts from telegram_update_jobs) to stdout with csv" > $E/update-jobs.csv
echo "tpl_level_ok=$lvl code_ref=$(git -C /home/user/workspace/wt-ref rev-parse HEAD) code_acc=$(git -C /home/user/workspace/wt-acc rev-parse HEAD)" > $E/b22-env.txt
echo "=== $(date -Is) END rc=$rc"; echo TRACE_DONE
