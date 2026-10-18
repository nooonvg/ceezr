#!/usr/bin/env bash
# موجةٌ كاملةٌ: قاعدةٌ نظيفةٌ ← عيّناتُ موارد ← wave+finish ← pgss + سجلُّ البوابةِ المقصوص
set -u
B=/home/user/cap-seat; ROUND=$1; CONC=$2; IDX=$3
/home/user/cap-seat/bin/fresh-db.sh || exit 1
sleep 5
mkdir -p $B/runs/$ROUND.side
grep -E '^(DISPATCH_|NOTIFICATION_|DIAG_LOCAL_)' $B/secrets.env > $B/runs/$ROUND.side/diag-env.txt || true
GWLOG=$B/runs/current/evidence/gateway.log; START_LINE=$(wc -l < $GWLOG)
python3 $B/bin/res-sampler.py $B/runs/$ROUND.side/resources.jsonl 420 &
SP=$!
$B/bin/run-wave.sh "$ROUND" "[{\"name\":\"wave-$CONC\",\"sec\":180,\"conc\":$CONC}]" 180 "$IDX"
RC=$?
kill $SP 2>/dev/null
$B/bin/pgss-dump.sh $B/runs/$ROUND/evidence/pgss-top.txt 30
tail -n +$((START_LINE+1)) $GWLOG > $B/runs/$ROUND/evidence/gateway.wave.log
$B/bin/db-export.sh $B/runs/$ROUND/evidence || true
[ -n "${TRACE_FILE:-}" ] && cp "$TRACE_FILE" $B/runs/$ROUND/evidence/dispatch-trace.jsonl
mv $B/runs/$ROUND.side/diag-env.txt $B/runs/$ROUND/evidence/ 2>/dev/null
mv $B/runs/$ROUND.side/resources.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null; rmdir $B/runs/$ROUND.side
echo "WAVE_DONE $ROUND rc=$RC"
