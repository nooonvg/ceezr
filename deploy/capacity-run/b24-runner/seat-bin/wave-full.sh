#!/usr/bin/env bash
# موجةٌ كاملةٌ: قاعدةٌ نظيفةٌ ← عيّناتُ موارد ← wave+finish ← pgss + سجلُّ البوابةِ المقصوص
set -u
B=/srv/ceezr-cap-20261016; ROUND=$1; CONC=$2; IDX=$3
/srv/ceezr-cap-20261016/bin/fresh-db.sh || exit 1
sleep 5
mkdir -p $B/runs/$ROUND.side
grep -E '^(DISPATCH_|NOTIFICATION_|DIAG_LOCAL_)' $B/secrets.env > $B/runs/$ROUND.side/diag-env.txt || true
GWLOG=$B/runs/current/evidence/gateway.log; START_LINE=$(wc -l < $GWLOG)
# الدفعة 26: الحدُّ الفعليُّ الذي قرأته البوابةُ الحيّة + عيّناتُ نافذتِه منَ Redis (للجانبَين بالتساوي)
if [ -n "${B26_SESSION_LIMIT:-}" ]; then
  $B/bin/session-limit-check.sh /home/user/workspace/wt-acc "$B26_SESSION_LIMIT" > $B/runs/$ROUND.side/session-limit.json 2>&1
  $B/bin/nsx python3 $B/bin/rl-sampler.py $B/runs/$ROUND.side/rl-window.jsonl 420 "$B26_SESSION_LIMIT" &
fi
python3 $B/bin/res-sampler.py $B/runs/$ROUND.side/resources.jsonl 420 &
SP=$!
$B/bin/run-wave.sh "$ROUND" "[{\"name\":\"wave-$CONC\",\"sec\":${WAVE_SEC:-180},\"conc\":$CONC}]" 180 "$IDX"
RC=$?
kill $SP 2>/dev/null
sudo -n ip netns exec ceezrsbx2 pkill -f '[r]l-sampler.py' 2>/dev/null || true
$B/bin/pgss-dump.sh $B/runs/$ROUND/evidence/pgss-top.txt 30
tail -n +$((START_LINE+1)) $GWLOG > $B/runs/$ROUND/evidence/gateway.wave.log
$B/bin/db-export.sh $B/runs/$ROUND/evidence || true
[ -n "${TRACE_FILE:-}" ] && cp "$TRACE_FILE" $B/runs/$ROUND/evidence/dispatch-trace.jsonl
mv $B/runs/$ROUND.side/diag-env.txt $B/runs/$ROUND/evidence/ 2>/dev/null
mv $B/runs/$ROUND.side/session-limit.json $B/runs/$ROUND.side/rl-window.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null
mv $B/runs/$ROUND.side/resources.jsonl $B/runs/$ROUND/evidence/ 2>/dev/null; rmdir $B/runs/$ROUND.side
echo "WAVE_DONE $ROUND rc=$RC"
