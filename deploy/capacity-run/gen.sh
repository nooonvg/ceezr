#!/usr/bin/env bash
# تشغيل مولّد الحمل منفصلًا (setsid، بلا أنابيب مفتوحة) داخل netns.  الاستعمال: RUN_DIR=... PROFILE='[...]' ./gen.sh GEN_ID [SEED]
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
DEFMIX='{"ride":0.47,"delivery":0.38,"group":0.15}'; MIX=${MIX:-$DEFMIX}
GEN_ID=${1:-gen1}; mkdir -p "$RUN_DIR/evidence"
setsid $B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; . "$2"; set +a; export RUN_DIR="$3" GEN_ID="$4" SEED="$5" PROFILE="$6" MIX="$7" N_DRIVERS="$8" N_RIDERS="$9" RESET="${10}" SEED_SKIP_RIDERS="${12}"; exec bun run "${11}"' _ \
  "$HERE/config/run.env" "$B/secrets.env" "$RUN_DIR" "$GEN_ID" "${SEED:-0}" "${PROFILE}" "$MIX" "${N_DRIVERS:-1000}" "${N_RIDERS:-1000}" "${RESET:-1}" "$HERE/load/capacity.ts" "${SEED_SKIP_RIDERS:-0}" \
  >>"$RUN_DIR/evidence/$GEN_ID.out" 2>&1 </dev/null &
echo $! > "$B/pids/$GEN_ID.pid"; echo "started $GEN_ID pid=$!"
