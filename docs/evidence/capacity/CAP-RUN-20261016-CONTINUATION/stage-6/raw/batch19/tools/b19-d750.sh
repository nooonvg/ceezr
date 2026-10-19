#!/usr/bin/env bash
set -u
B=/srv/ceezr-cap-20261016; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
unset REPO TRACE_FILE DIAG_POOL DIAG_EXTRA
echo "=== $(date -Is) START b19d-c-cand-750 (cand, diag)"
$B/bin/qual-wave.sh b19d-c-cand-750 750 5 diag
echo "=== $(date -Is) END rc=$?"; echo D750_DONE
