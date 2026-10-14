#!/usr/bin/env bash
# SANDBOX-SOAK-01 — تشغيلُ الخدمات: Postgres + Redis + Upstash shim + البوّابةُ الحقيقيّةُ (مع العاملِ المدمجِ ومحاكي تيليجرام).
#   ./run_services.sh          كلُّ ما لا يعمل
#   ./run_services.sh infra    القاعدةُ وRedis والشِّم فقط
#   ./run_services.sh gateway  البوّابةُ وحدَها (يُستعملُ في اختبارِ القتل)
set -u
ROOT=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$ROOT/../.." && pwd)
PG_BIN=${PG_BIN:-/usr/lib/postgresql/18/bin}; PG_DATA=${SANDBOX_PG_DIR:-$HOME/sandbox/pg/data}
export PATH=$HOME/.bun/bin:$PG_BIN:$PATH
mkdir -p "$ROOT/logs"
start_infra() {
  pg_isready -h 127.0.0.1 -q || pg_ctl -D "$PG_DATA" -l "$ROOT/logs/pg.log" \
    -o "-p 5432 -k /tmp -c max_connections=300 -c shared_buffers=512MB" start >/dev/null
  redis-cli ping >/dev/null 2>&1 || redis-server --port 6379 --daemonize yes --logfile "$ROOT/logs/redis.log"
  if ! curl -s -o /dev/null http://127.0.0.1:8081; then
    (cd "$REPO/docker/upstash-rest-shim" && REDIS_URL=redis://127.0.0.1:6379 PORT=8081 SHIM_TOKEN=shim-token \
      setsid nohup bun run shim.ts >>"$ROOT/logs/shim.log" 2>&1 </dev/null &)
  fi
}
start_gateway() {
  # انتظارُ تحرّرِ المنفذِ بعدَ قتلِ النسخةِ السابقة
  for _ in $(seq 1 50); do ss -ltn | grep -q ":4300 " || break; sleep 0.2; done
  (cd "$REPO" && set -a && . "$ROOT/config/sandbox.env" && set +a && export SANDBOX_LOG_DIR="$ROOT/logs" &&
    setsid nohup bun --preload "$ROOT/mocks/telegram-mock-preload.ts" apps/gateway/src/index.ts \
      >>"$ROOT/logs/gateway.log" 2>&1 </dev/null &)
}
case "${1:-all}" in
  infra) start_infra ;;
  gateway) start_gateway ;;
  *) start_infra; pgrep -f "apps/gateway/src/index.ts" >/dev/null || start_gateway ;;
esac
