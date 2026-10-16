#!/usr/bin/env bash
# تشغيل منسّق الأعطال منفصلًا داخل netns.  RUN_DIR=... SOAK_START_MS=... [CHAOS_PLAN='[...]'] ./chaos.sh
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
setsid $B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; export RUN_DIR="$1" SOAK_START_MS="$2" CHAOS_PLAN="$3" CODE_DIR="$5"; [ -z "$CHAOS_PLAN" ] && unset CHAOS_PLAN; [ -z "$CODE_DIR" ] && unset CODE_DIR; exec bun run "$4"' _ \
  "$RUN_DIR" "${SOAK_START_MS}" "${CHAOS_PLAN:-}" "$HERE/monitor/chaos.ts" "${CODE_DIR:-}" >>"$RUN_DIR/evidence/chaos.out" 2>&1 </dev/null &
echo $! > "$B/pids/chaos.pid"; echo "chaos pid=$!"
