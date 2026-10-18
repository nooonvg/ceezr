#!/usr/bin/env bash
# CAP-RUN-20261016 — مدير خدمات الجولة. كل عملية تعمل داخل netns «ceezrsbx2» (loopback فقط).
#   ./svc.sh infra|mock|shim|gateway|worker-stop|stop-gateway|kill-gateway|status|assert|stop-all
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
RUN_ID=ceezr-cap-20261016; B=${RUN_BASE:-/srv/$RUN_ID}; NSX=$B/bin/nsx
export RUN_DIR=${RUN_DIR:-$B/runs/current}
mkdir -p "$B/pids" "$RUN_DIR/evidence"
PSQL="$NSX psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -tAX"
assert_isolation() {
  # 1) نحن نتحدث إلى عنقود هذه الجولة حصرًا
  local got; got=$($PSQL -c "select current_setting('data_directory')||'|'||current_setting('ceezr.run_marker')||'|'||current_database()" 2>/dev/null)
  [ "$got" = "$B/pg|$RUN_ID|ceezr_cap_20261016" ] || { echo "ISOLATION_FAIL pg: '$got'"; return 1; }
  # 2) Redis هذه الجولة
  local rd; rd=$($NSX redis-cli -p 56379 config get dir 2>/dev/null | tail -1)
  [ "$rd" = "$B/redis" ] || { echo "ISOLATION_FAIL redis dir: '$rd'"; return 1; }
  # 3) netns بلا أي واجهة غير loopback ولا مسار افتراضي
  local ifs; ifs=$(sudo -n ip netns exec ceezrsbx2 ip -o link | awk -F': ' '{print $2}' | tr '\n' ' ')
  [ "$ifs" = "lo " ] || { echo "ISOLATION_FAIL netns ifaces: $ifs"; return 1; }
  [ -z "$(sudo -n ip netns exec ceezrsbx2 ip route)" ] || { echo "ISOLATION_FAIL netns has routes"; return 1; }
  echo "ISOLATION_OK pg=$B/pg redis=$B/redis netns=ceezrsbx2(lo-only)"
}
start_bg() { # name cmd...  (الأسرار تُقرأ داخل العملية من ملف 600 ولا تمرّ عبر سطر الأوامر)
  local name=$1; shift
  ( cd "${CODE_DIR:-$REPO}"; setsid $NSX bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; . "$2"; set +a; export RUN_DIR="$3"; shift 3; exec "$@"' _ \
      "${RUN_ENV:-$( [ -f "$RUN_DIR/run.env" ] && echo "$RUN_DIR/run.env" || echo "$HERE/config/run.env")}" "$B/secrets.env" "$RUN_DIR" "$@" >>"$RUN_DIR/evidence/$name.log" 2>&1 </dev/null &
    echo $! > "$B/pids/$name.pid" )
}
case "${1:-status}" in
  assert) assert_isolation ;;
  mock) start_bg telegram-mock bun run "$HERE/mocks/telegram-mock-server.ts" ;;
  shim) start_bg shim bash -c 'cd docker/upstash-rest-shim && REDIS_URL=redis://127.0.0.1:56379 PORT=58081 SHIM_TOKEN="$UPSTASH_REDIS_REST_TOKEN" exec bun run shim.ts' ;;
  gateway)
    assert_isolation || exit 1
    for _ in $(seq 1 50); do $NSX bash -c 'ss -ltn | grep -q ":54300 "' || break; sleep 0.2; done
    # CODE_DIR يسمح بتشغيل نسخة أخرى من الكود (مثل PR #558 الأصلي لقياس «قبل»)، والحارس من هذه النسخة دائمًا
    echo "{\"t\":\"$(date -Is)\",\"event\":\"gateway.start\",\"code_dir\":\"${CODE_DIR:-$REPO}\",\"sha\":\"$(git -C "${CODE_DIR:-$REPO}" rev-parse HEAD)\",\"dirty\":$(git -C "${CODE_DIR:-$REPO}" status --porcelain | grep -c .)}" >> "$RUN_DIR/evidence/gateway-starts.jsonl"
    # GATEWAY_BUN_FLAGS (تشخيصٌ فقط، مثل `--cpu-prof --cpu-prof-dir=…`): يُسجَّلُ في gateway-starts ولا يُستعمَلُ في القبول.
    echo "{\"t\":\"$(date -Is)\",\"event\":\"gateway.flags\",\"flags\":\"${GATEWAY_BUN_FLAGS:-}\"}" >> "$RUN_DIR/evidence/gateway-starts.jsonl"
    # shellcheck disable=SC2086
    CODE_DIR=${CODE_DIR:-$REPO} start_bg gateway bun ${GATEWAY_BUN_FLAGS:-} --preload "$HERE/mocks/telegram-egress-guard.ts" apps/gateway/src/index.ts ;;
  kill-gateway) sudo -n ip netns exec ceezrsbx2 pkill -9 -f "[a]pps/gateway/src/index.ts" ;;
  stop-gateway) sudo -n ip netns exec ceezrsbx2 pkill -TERM -f "[a]pps/gateway/src/index.ts" ;;
  stop-mock) sudo -n ip netns exec ceezrsbx2 pkill -TERM -f "[t]elegram-mock-server.ts" ;;
  stop-shim) sudo -n ip netns exec ceezrsbx2 pkill -TERM -f "[b]un run shim.ts" ;;
  status)
    for p in telegram-mock shim gateway; do pgrep -f "$( [ $p = gateway ] && echo [a]pps/gateway/src/index.ts || ([ $p = shim ] && echo [b]un\ run\ shim.ts || echo [t]elegram-mock-server.ts))" >/dev/null && echo "$p=up" || echo "$p=down"; done
    $NSX curl -s -m 2 -o /dev/null -w "ready=%{http_code}\n" http://127.0.0.1:54300/ready ;;
  stop-all)
    sudo -n ip netns exec ceezrsbx2 pkill -TERM -f "[a]pps/gateway/src/index.ts|[t]elegram-mock-server.ts|[s]him.ts" ;;
esac
