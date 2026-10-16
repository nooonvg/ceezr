#!/usr/bin/env bash
# R1 (ADR 0286) — تشغيل مولّدات المسارات المنفصلة داخل netns، بلا أنابيب مفتوحة.
#   الاستعمال: RUN_DIR=... ./gen-r1.sh miniapp|telegram|isolate GEN_ID [PROFILE]
# miniapp  : دورة أعمال المنتج كاملة عبر HTTP — النجاح حكم القاعدة لا 2xx.
# telegram: دخول وإشعارات فقط — لا أعمال منتج عبر webhook.
# isolate  : منسّق تجارب عزل المسارات (أ + ب + ضغط + تعطيل إشعارات).
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
PATH_=${1:-miniapp}; GEN_ID=${2:-genA}; PROFILE=${3:-'[{"name":"smoke","sec":120,"conc":10}]'}
case "$PATH_" in
  miniapp)  SCRIPT="$HERE/load/miniapp-load.ts" ;;
  telegram) SCRIPT="$HERE/load/telegram-load.ts" ;;
  isolate)  SCRIPT="$HERE/load/isolate.ts" ;;
  *) echo "✖ مسار غير معروف: $PATH_ (miniapp|telegram|isolate)"; exit 1 ;;
esac
mkdir -p "$RUN_DIR/evidence"
# SCENARIO_DEPTH: assign (إثبات الإسناد فقط) أو full (دورة الرحلة كاملة حتى completed).
setsid $B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; . "$2"; set +a; export RUN_DIR="$3" GEN_ID="$4" PROFILE="$5" SCENARIO_DEPTH="$6" ISOLATE_CONC="$7" ISOLATE_SEC="$8" ISOLATE_B_RATE="$9" ISOLATE_B_PRESSURE_RATE="${10}"; exec bun run "${11}"' _ \
  "$HERE/config/run.env" "$B/secrets.env" "$RUN_DIR" "$GEN_ID" "$PROFILE" "${SCENARIO_DEPTH:-full}" \
  "${ISOLATE_CONC:-20}" "${ISOLATE_SEC:-120}" "${ISOLATE_B_RATE:-5}" "${ISOLATE_B_PRESSURE_RATE:-50}" "$SCRIPT" \
  >>"$RUN_DIR/evidence/$GEN_ID.out" 2>&1 </dev/null &
echo $! > "$B/pids/$GEN_ID.pid"; echo "started $GEN_ID ($PATH_) pid=$!"
