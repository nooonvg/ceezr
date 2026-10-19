#!/usr/bin/env bash
# الدفعة 19 — موجاتٌ تشخيصيّةٌ متداخلة ABBA عندَ 500 (diag): مرجع d9632d1f ↔ مرشّح b5e92f3e
set -u
B=/srv/ceezr-cap-20261016; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
unset REPO TRACE_FILE DIAG_POOL DIAG_EXTRA
run() { local kind=$1 round=$2 idx=$3; echo "=== $(date -Is) START $round ($kind)";
  if [ $kind = ref ]; then $B/bin/qual-wave-ref.sh $round 500 $idx diag; else $B/bin/qual-wave.sh $round 500 $idx diag; fi
  echo "=== $(date -Is) END $round rc=$?"; grep -h '"code_sha"' $B/runs/$round/evidence/timeline.jsonl 2>/dev/null | head -1 | grep -o '"code_sha":"[^"]*","code_dirty":[0-9]*'; }
run ref  b19b-r1-ref-500  1
run cand b19b-c1-cand-500 2
run cand b19b-c2-cand-500 3
run ref  b19b-r2-ref-500  4
echo "ABBA_DONE $(date -Is)"
