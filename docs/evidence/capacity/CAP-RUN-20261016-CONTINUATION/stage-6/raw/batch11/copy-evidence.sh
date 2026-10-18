#!/usr/bin/env bash
# copy-evidence.sh ROUND FULL(0|1)
set -e
R=$1; FULL=${2:-0}
S=/home/user/cap-seat/runs/$R/evidence
D=/home/user/workspace/ceezr/docs/evidence/capacity/CAP-RUN-20261016-CONTINUATION/stage-6/raw/${BATCH_DIR:-batch9}/$R
mkdir -p $D
for f in wave-report.json db-audit-pre.json db-audit-post.json mock-stats-pre.json mock-stats-post.json timeline.jsonl resources.jsonl; do [ -f $S/$f ] && cp $S/$f $D/; done
[ -f $S/diag-env.txt ] && sed 's#/home/user/cap-seat/trace-cur.jsonl#<trace>#' $S/diag-env.txt > $D/diag-env.env || : > $D/diag-env.env
{ echo '```'; cat $S/pgss-top.txt; echo '```'; } > $D/pgss-top.md
python3 /home/user/workspace/ceezr/deploy/capacity-run/monitor/p4-decompose.py $S > $D/p4-decompose.out.json 2>/dev/null || true
grep -o '"event":"[a-z_.]*"' $S/gateway.wave.log | sort | uniq -c | sort -rn > $D/gateway-event-counts.tsv
if [ "$FULL" = 1 ]; then
  for f in miniapp-load-events.jsonl load-events.jsonl dispatch-trace.jsonl orders.csv offers.csv; do [ -s $S/$f ] && gzip -9c $S/$f > $D/$f.gz; done
fi
(cd $D && sha256sum $(ls | grep -v SHA256SUMS) > SHA256SUMS)
du -sh $D
