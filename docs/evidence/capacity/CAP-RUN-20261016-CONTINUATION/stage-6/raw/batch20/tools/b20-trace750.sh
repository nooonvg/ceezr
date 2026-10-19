#!/usr/bin/env bash
set -u
B=/srv/ceezr-cap-20261016; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
unset REPO DIAG_POOL DIAG_EXTRA
R=${1:-b20-trace-base-750}; export TRACE_FILE=$B/trace-cur.jsonl
echo "=== $(date -Is) START $R (diag+trace)"
$B/bin/qual-wave.sh $R 750 ${2:-6} diag
echo "=== $(date -Is) END rc=$?"; echo TRACE_DONE
