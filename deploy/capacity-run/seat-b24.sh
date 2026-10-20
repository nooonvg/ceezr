#!/usr/bin/env bash
# ب24 — أدواتُ مقعدِ السعةِ المحلّيِّ (على /srv/ceezr-cap-20261016): قاعدةٌ نظيفةٌ لكلِّ
#   موجةٍ + موجةٌ كاملةٌ (حقنٌ + تصريفٌ + تقريرٌ) + خامُ pg_stat_statements والمواردِ وسجلِّ البوّابة.
#   الاستعمالُ:  seat-b24.sh fresh | seat-b24.sh wave ROUND CONC IDX [ENV=V ...]
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
B=${SEAT:-/srv/ceezr-cap-20261016}; NSX=$B/bin/nsx
export PATH="$HOME/.local/bin:$PATH"
export SEAT=$B

cmd_fresh() {
  sudo -n ip netns exec ceezrsbx2 pkill -TERM -f '[a]pps/gateway/src/index.ts' 2>/dev/null || true
  # متغيّراتُ التشخيصِ تُكتبُ في secrets.env (600) وتُزالُ عندَ كلِ موجةٍ جديدة
  sed -i '/^DISPATCH_TRACE_FILE=/d;/^PHONE_PROOF_WAIT_MS=/d;/^DIAG_B24_/d' $B/secrets.env
  [ -n "${TRACE_FILE:-}" ] && { rm -f "$TRACE_FILE"; echo "DISPATCH_TRACE_FILE=$TRACE_FILE" >> $B/secrets.env; }
  [ -n "${PHONE_PROOF_WAIT_MS:-}" ] && echo "PHONE_PROOF_WAIT_MS=$PHONE_PROOF_WAIT_MS" >> $B/secrets.env
  for kv in ${DIAG_EXTRA:-}; do echo "$kv" >> $B/secrets.env; done
  for i in $(seq 1 30); do $NSX bash -c "pgrep -f '[a]pps/gateway/src/index.ts'" >/dev/null || break; sleep 1; done
  $NSX bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -q -c 'drop database if exists ceezr_cap_20261016 with (force)' -c 'create database ceezr_cap_20261016 template ceezr_cap_tpl' && psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -q -c 'create extension if not exists pg_stat_statements' -c 'select pg_stat_statements_reset()' >/dev/null && redis-cli -p 56379 flushall >/dev/null" \
    || { echo FRESH_DB_FAIL >&2; exit 1; }
  cd $REPO && RUN_BASE=$B RUN_DIR=$B/runs/current bash deploy/capacity-run/svc.sh gateway
  for i in $(seq 1 60); do
    sleep 2
    if $NSX bash -c "curl -s -m 2 http://127.0.0.1:54300/ready" 2>/dev/null | grep -q '"ready"'; then
      echo "FRESH_DB_OK sha=$(git -C $REPO rev-parse --short HEAD)"; exit 0
    fi
  done
  echo FRESH_DB_GATEWAY_NOT_READY >&2; exit 1
}

cmd_wave() {
  local ROUND=$1 CONC=$2 IDX=$3; shift 3 || true
  local RUN_DIR=$B/runs/$ROUND
  mkdir -p $B/runs/$ROUND.side
  grep -E '^(DISPATCH_TRACE_FILE|PHONE_PROOF_WAIT_MS|DIAG_B24_[A-Z0-9_]+)=' $B/secrets.env > $RUN_DIR.side/diag-env.txt || true
  local GWLOG=$B/runs/current/evidence/gateway.log START_LINE; START_LINE=$(wc -l < $GWLOG)
  python3 $B/bin/res-sampler.py $RUN_DIR.side/resources.jsonl 420 &
  local SP=$!
  # المولّدُ والتدقيقُ والتقريرُ داخلَ الـnetns: الخدماتُ على lo فيه وحدَه.
  # رمزُ خروجِ الموجةِ لا يُغطّى برمزِ التقرير: فشلُ الإعدادِ أو التدقيقِ القبليّ يوقفُ الحقنَ
  # (يفعلُه wave.sh نفسُه) ويُسجّلُ فشلًا صريحًا لا نجاحًا كاذبًا.
  $NSX bash -c 'export PATH="/home/user/.local/bin:$PATH"; export SEAT="$1"; shift; exec bash "$@"' _ \
    "$B" "$HERE/wave.sh" "$ROUND" "[{\"name\":\"wave-$CONC\",\"sec\":180,\"conc\":$CONC}]" 180 "$IDX"
  local WAVE_RC=$?
  $NSX bash -c 'export PATH="/home/user/.local/bin:$PATH"; export SEAT="$1"; shift; exec bash "$@"' _ \
    "$B" "$HERE/finish-wave.sh" "$ROUND"
  local FIN_RC=$?
  kill $SP 2>/dev/null
  local RC=$(( WAVE_RC != 0 ? WAVE_RC : FIN_RC ))
  # خامُّ pg_stat_statements (أعلى 30 عبارةً) وسجلُّ البوّالةِ المقصوصُ وأثرُ الشوطِ
  cat > /tmp/b24-pgss.sql <<'SQL'
\x off
select round(total_exec_time::numeric,1) as ms, calls, round(mean_exec_time::numeric,3) as mean_ms, left(query,120) as q from pg_stat_statements where query not like '%pg_stat_statements%' order by total_exec_time desc limit 30;
SQL
  $NSX bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -f /tmp/b24-pgss.sql" > $RUN_DIR/evidence/pgss-top.txt 2>/dev/null
  tail -n +$((START_LINE+1)) $GWLOG > $RUN_DIR/evidence/gateway.wave.log
  [ -n "${TRACE_FILE:-}" ] && cp "$TRACE_FILE" $RUN_DIR/evidence/dispatch-trace.jsonl
  mv $RUN_DIR.side/diag-env.txt $RUN_DIR/evidence/ 2>/dev/null
  mv $RUN_DIR.side/resources.jsonl $RUN_DIR/evidence/ 2>/dev/null; rmdir $RUN_DIR.side 2>/dev/null
  echo "WAVE_DONE $ROUND rc=$RC"
}

case "${1:-}" in
  fresh) shift; cmd_fresh "$@" ;;
  wave) shift; cmd_wave "$@" ;;
  *) echo "usage: seat-b24.sh fresh | wave ROUND CONC IDX [ENV=V ...]" >&2; exit 2 ;;
esac
