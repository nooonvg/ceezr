#!/usr/bin/env bash
set -u
B=/srv/ceezr-cap-20261016; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
unset REPO TRACE_FILE DIAG_POOL DIAG_EXTRA
R=$1; IDX=$2; S=${3:-}
echo "=== $(date -Is) START $R"
if [ "$S" = ref ]; then $B/bin/qual-wave-ref.sh $R 750 $IDX diag; else $B/bin/qual-wave.sh $R 750 $IDX diag; fi
echo "=== $(date -Is) END rc=$?"; echo PLAIN_DONE
