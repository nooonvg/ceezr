#!/usr/bin/env bash
# موجة كاملة من شجرة المرجع (main) — نفس wave-full.sh مع REPO للمرجع
set -u
B=/srv/ceezr-cap-20261016; ROUND=$1; CONC=$2; IDX=$3
export REPO=/home/user/workspace/ceezr
/srv/ceezr-cap-20261016/bin/fresh-db.sh || exit 1
sleep 5
mkdir -p $B/runs/$ROUND.side
GWLOG=$B/runs/current/evidence/gateway.log; START_LINE=$(wc -l < $GWLOG)
python3 $B/bin/res-sampler.py $B/runs/$ROUND.side/resources.jsonl 420 &
SP=$!
REPO=/home/user/workspace/ceezr $B/bin/run-wave-ref.sh "$ROUND" "[{\"name\":\"wave-$CONC\",\"sec\":180,\"conc\":$CONC}]" 180 "$IDX"
RC=$?
kill $SP 2>/dev/null
$B/bin/pgss-dump.sh $B/runs/$ROUND/evidence/pgss-top.txt 30
tail -n +$((START_LINE+1)) $GWLOG > $B/runs/$ROUND/evidence/gateway.wave.log
$B/bin/db-export.sh $B/runs/$ROUND/evidence || true
[ -n "${TRACE_FILE:-}" ] && cp "$TRACE_FILE" $B/runs/$ROUND/evidence/dispatch-trace.jsonl
mv $B/runs/$ROUND.side/resources.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null; rmdir $B/runs/$ROUND.side
echo "WAVE_DONE $ROUND rc=$RC"
