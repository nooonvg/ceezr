#!/usr/bin/env bash
# R1 (ADR 0286) — تشغيل مولّدات المسارات المنفصلة داخل netns، بلا أنابيب مفتوحة.
#   الاستعمال: RUN_DIR=... ./gen-r1.sh miniapp|telegram|isolate|pgrec GEN_ID [PROFILE]
# miniapp  : دورة أعمال المنتج كاملة عبر HTTP — النجاح حكم القاعدة لا 2xx.
# telegram: دخول وإشعارات فقط — لا أعمال منتج عبر webhook.
# isolate  : منسّق تجارب عزل المسارات (أ + ب + ضغط + تعطيل إشعارات).
# pgrec    : المرحلة 2ب — تجربة تعافي البوابة من انقطاع PG (قتل خلفيات + إيقاف كامل بالأداة).
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
PATH_=${1:-miniapp}; GEN_ID=${2:-genA}; PROFILE=${3:-'[{"name":"smoke","sec":120,"conc":10}]'}
case "$PATH_" in
  miniapp)  SCRIPT="$HERE/load/miniapp-load.ts" ;;
  telegram) SCRIPT="$HERE/load/telegram-load.ts" ;;
  isolate)  SCRIPT="$HERE/load/isolate.ts" ;;
  pgrec)    SCRIPT="$HERE/load/pg-recovery.ts" ;;
  *) echo "✖ مسار غير معروف: $PATH_ (miniapp|telegram|isolate|pgrec)"; exit 1 ;;
esac
mkdir -p "$RUN_DIR/evidence"
if [ "$PATH_" = pgrec ]; then
  # المرحلة 2ب — كتل هويات مخصصة (10.2م/11.2م) مستقلة عن بقية الجولات
  setsid $B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; . "$2"; set +a; export RUN_DIR="$3" GEN_ID="$4" PGR_RIDER_BASE="$5" PGR_DRIVER_BASE="$6" GATEWAY_LOG="$8"; exec bun run "$7"' _ \
  "$HERE/config/run.env" "$B/secrets.env" "$RUN_DIR" "$GEN_ID" "${PGR_RIDER_BASE:-10200000}" "${PGR_DRIVER_BASE:-11200000}" "$SCRIPT" \
  "${GATEWAY_LOG:-$RUN_DIR/evidence/gateway.log}" \
  >>"$RUN_DIR/evidence/$GEN_ID.out" 2>&1 </dev/null &
else
  # SCENARIO_DEPTH: assign (إثبات الإسناد فقط) أو full (دورة الرحلة كاملة حتى completed).
  # RIDER/DRIVER_SEQ_START: قواعدُ هوياتِ المولّدِ (كتلُّ لكلِّ جولةٍ — المرحلةُ 1:
  # السائقُ يُسجَّلُ عبرَ onboarding/API فبقاعدةِ السائقِ تُقاسُ دورةُ التسجيلِ كلُّها).
  setsid $B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; . "$2"; set +a; export RUN_DIR="$3" GEN_ID="$4" PROFILE="$5" SCENARIO_DEPTH="$6" ISOLATE_CONC="$7" ISOLATE_SEC="$8" ISOLATE_B_RATE="$9" ISOLATE_B_PRESSURE_RATE="${10}" ISOLATE_RIDER_BASE="${11}" ISOLATE_DRIVER_BASE="${12}" RIDER_SEQ_START="${14}" DRIVER_SEQ_START="${15}"; exec bun run "${13}"' _ \
  "$HERE/config/run.env" "$B/secrets.env" "$RUN_DIR" "$GEN_ID" "$PROFILE" "${SCENARIO_DEPTH:-full}" \
  "${ISOLATE_CONC:-20}" "${ISOLATE_SEC:-120}" "${ISOLATE_B_RATE:-5}" "${ISOLATE_B_PRESSURE_RATE:-50}" "${ISOLATE_RIDER_BASE:-6100000}" "${ISOLATE_DRIVER_BASE:-7100000}" "$SCRIPT" "${RIDER_SEQ_START:-6000000}" "${DRIVER_SEQ_START:-7000000}" \
  >>"$RUN_DIR/evidence/$GEN_ID.out" 2>&1 </dev/null &
fi
echo $! > "$B/pids/$GEN_ID.pid"; echo "started $GEN_ID ($PATH_) pid=$!"
