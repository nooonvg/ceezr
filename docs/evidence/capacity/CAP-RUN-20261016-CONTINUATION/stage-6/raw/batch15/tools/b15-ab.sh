#!/usr/bin/env bash
# الدفعة 15 — أربع موجات تشخيصية متناوبة A1 B1 A2 B2 (A=main، B=المرشح) على المقعد نفسه.
set -u
B=/srv/ceezr-cap-20261016; export PATH="/home/user/.bun/bin:/home/user/.local/bin:$PATH"
export TRACE_FILE=$B/trace-cur.jsonl
ms() { python3 -c 'import time;print(round(time.time()*1000))'; }
i=0
for spec in "b15-diag-A1:/home/user/workspace/wt-main" "b15-diag-B1:/home/user/workspace/repo" "b15-diag-A2:/home/user/workspace/wt-main" "b15-diag-B2:/home/user/workspace/repo"; do
  i=$((i+1)); R=${spec%%:*}; export REPO=${spec#*:}
  echo "ROUND_START $R repo=$REPO sha=$(git -C $REPO rev-parse --short HEAD) $(date -Is)"
  rm -f $B/trace-cur.jsonl*
  mkdir -p $B/probes; for k in 1 2 3; do python3 $B/bin/speed-probe.py >> $B/probes/$R-pre-speed.jsonl; echo "{\"t\":$(ms),\"pg_probe_ms\":$($B/bin/pg-probe.sh)}" >> $B/probes/$R-pre-pg.jsonl; done
  $B/bin/wave-full.sh $R 500 $((10+i))
  $B/bin/post-diag.sh $R > $B/probes/$R-post-diag.out 2>&1
  cp $B/probes/$R-* $B/runs/$R/evidence/ 2>/dev/null
  $B/bin/gates.sh $R > $B/runs/$R/evidence/gates.txt 2>&1; cat $B/runs/$R/evidence/gates.txt
  echo "ROUND_END $R $(date -Is)"
done
echo AB_DONE
