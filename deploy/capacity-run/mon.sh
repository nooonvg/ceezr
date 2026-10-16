#!/usr/bin/env bash
# تشغيل المراقب منفصلًا داخل netns.  RUN_DIR=... SOAK_START_MS=... REPORT_MARKS=10,20 MONITOR_END_MIN=75 ./mon.sh
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
mkdir -p "$RUN_DIR/evidence"
setsid $B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; set +a; export RUN_DIR="$2" SOAK_START_MS="$3" REPORT_MARKS="$4" MONITOR_END_MIN="$5"; exec bun run "$6"' _ \
  "$HERE/config/run.env" "$RUN_DIR" "${SOAK_START_MS:-$(( $(date +%s) * 1000 ))}" "${REPORT_MARKS:-10,20,30,40,50,60}" "${MONITOR_END_MIN:-75}" "$HERE/monitor/monitor.ts" \
  >>"$RUN_DIR/evidence/monitor.out" 2>&1 </dev/null &
echo $! > "$B/pids/monitor.pid"; echo "monitor pid=$!"
