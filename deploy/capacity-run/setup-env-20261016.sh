#!/usr/bin/env bash
# CAP-RUN-20261016 — بناءُ البيئةِ المعزولةِ من الصفر (مرة واحدة). لا يلمس الإنتاج.
#   ./setup-env-20261016.sh [infra|db|migrate|all]
# netns: ceezrsbx2 (loopback فقط) · PG 18 على 55432 داخل الـnetns · Redis على 56379.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
B=${RUN_BASE:-/srv/ceezr-cap-20261016}; RUN_ID=ceezr-cap-20261016
NS=ceezrsbx2
PG_BIN=/usr/lib/postgresql/18/bin
PG_PORT=55432
MAIN_DB=ceezr_cap_20261016
TEST_DB=ceezr_cap_test_20261016
export PATH="$PG_BIN:$HOME/.local/bin:$PATH"

step_infra() {
  mkdir -p "$B/bin" "$B/pids" "$B/pg" "$B/pg-sock" "$B/redis" "$B/runs"
  # nsx: تنفيذ داخل الـnetns
  cat > "$B/bin/nsx" <<EOF
#!/bin/bash
exec sudo -n ip netns exec $NS sudo -n -u $(id -un) "\$@"
EOF
  chmod 755 "$B/bin/nsx"
  sudo -n true || { echo "sudo غير متاح"; exit 1; }
  # الشبكة: netns بواجهة lo فقط ولا مسار
  if ! sudo -n ip netns list | rg -q "^$NS"; then
    sudo -n ip netns add $NS
    sudo -n ip -n $NS link set lo up
  fi
  # PostgreSQL: عنقود مستقل داخل الـnetns
  if [ ! -f "$B/pg/PG_VERSION" ]; then
    initdb -D "$B/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
    cat >> "$B/pg/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = $PG_PORT
unix_socket_directories = '$B/pg-sock'
max_connections = 200
shared_buffers = 512MB
ceezr.run_marker = '$RUN_ID'
EOF
  fi
  if ! sudo -n ip netns exec $NS sh -c "pg_isready -h 127.0.0.1 -p $PG_PORT -q" 2>/dev/null; then
    sudo -n ip netns exec $NS sh -c "cd $B && setsid $PG_BIN/pg_ctl -D $B/pg -l $B/pg.log start" >/dev/null
    for _ in $(seq 1 60); do sudo -n ip netns exec $NS sh -c "pg_isready -h 127.0.0.1 -p $PG_PORT -q" 2>/dev/null && break; sleep 0.5; done
  fi
  # Redis داخل الـnetns
  if ! sudo -n ip netns exec $NS sh -c "redis-cli -p 56379 ping" 2>/dev/null | rg -q PONG; then
    sudo -n ip netns exec $NS sh -c "setsid redis-server --port 56379 --dir $B/redis --daemonize no --save '' --appendonly no" >/dev/null 2>&1
    for _ in $(seq 1 20); do sudo -n ip netns exec $NS sh -c "redis-cli -p 56379 ping" 2>/dev/null | rg -q PONG && break; sleep 0.25; done
  fi
  # الأسرار: تُولَّد مرة واحدة، 600، ولا تُطبع
  if [ ! -f "$B/secrets.env" ]; then
    umask 177
    {
      echo "RIDER_BOT_TOKEN=900001:AA-cap-run-$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      echo "DRIVER_BOT_TOKEN=900002:AA-cap-run-$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      echo "TELEGRAM_WEBHOOK_SECRET=whsec-$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      echo "UPSTASH_REDIS_REST_TOKEN=upstash-$(head -c24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
      echo "MINIAPP_SESSION_SECRET=$(head -c48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    } > "$B/secrets.env"
  fi
  chmod 600 "$B/secrets.env"
  echo "INFRA_OK base=$B netns=$NS"
}

step_db() {
  $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -q <<SQL
select 'stop' where false; -- no-op
SQL
  for db in $MAIN_DB $TEST_DB; do
    $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -tc "select 1" -d postgres >/dev/null 2>&1
    $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -q -c "drop database if exists $db" -c "create database $db encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8' template template0"
    $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -d $db -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create extension if not exists postgis;
SQL
  done
  echo "DB_OK $MAIN_DB $TEST_DB"
}

step_migrate() {
  for db in $MAIN_DB $TEST_DB; do
    DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/$db" bun run scripts/migrate.ts | tail -1
  done
  echo "MIGRATE_OK"
}

case "${1:-all}" in
  infra) step_infra ;;
  db) step_db ;;
  migrate) step_migrate ;;
  all) step_infra; step_db; step_migrate ;;
esac
