#!/usr/bin/env bash
# CAP-RUN-20261016 — بناءُ البيئةِ المعزولةِ من الصفر (مرة واحدة). لا يلمس الإنتاج.
#   ./setup-env-20261016.sh [infra|db|migrate|all]
# netns: ceezrsbx2 (loopback فقط) · PG 18 على 55432 داخل الـnetns · Redis على 56379.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
B=${RUN_BASE:-/srv/ceezr-cap-20261016}; RUN_ID=ceezr-cap-20261016
# كلُّ قيمةٍ أدناه قابلةٌ للتجاوزِ بالبيئةِ **لاختبارِ مساراتِ الفشلِ على netns وقاعدةٍ منفصلَين**
# (test-setup-env-failures.sh) — والافتراضيُّ هو المقعدُ المعتمدُ حرفاً.
NS=${CAP_NS:-ceezrsbx2}
PG_BIN=${CAP_PG_BIN:-/usr/lib/postgresql/18/bin}
PG_PORT=${CAP_PG_PORT:-55432}
REDIS_PORT=${CAP_REDIS_PORT:-56379}
REDIS_SERVER=${CAP_REDIS_SERVER:-redis-server}
REQUIRED_EXTENSIONS=${CAP_REQUIRED_EXTENSIONS:-postgis}
MAIN_DB=${CAP_MAIN_DB:-ceezr_cap_20261016}
TEST_DB=${CAP_TEST_DB:-ceezr_cap_test_20261016}
export PATH="$PG_BIN:$HOME/.local/bin:$PATH"

step_infra() {
  # مقعدٌ بلا /srv قابلٍ للكتابةِ يفشلُ هنا بصمتٍ: الأصلُ إنشاءُ القاعدةِ بجذرٍ ثمّ
  # تسليمُ ملكيّتِها للمستخدمِ، لا افتراضُ مقعدٍ مُهيّأٍ مسبقّاً.
  if ! mkdir -p "$B" 2>/dev/null; then
    sudo -n mkdir -p "$B" || { echo "BASE_DIR_FAIL: $B" >&2; exit 1; }
    sudo -n chown "$(id -un):$(id -gn)" "$B" || { echo "BASE_CHOWN_FAIL: $B" >&2; exit 1; }
  fi
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
  # pg_ctl لا يعمل بامتيازات الجذر: يُشغَّل عبر nsx بالمستخدمِ المالكِ نفسِه (مرصودٌ:
  # «pg_ctl: cannot be run as root» عند تشغيلِه بجذرٍ داخلَ netns فيفشل الإقلاعُ بصمتٍ).
  if ! sudo -n ip netns exec $NS sh -c "pg_isready -h 127.0.0.1 -p $PG_PORT -q" 2>/dev/null; then
    "$B/bin/nsx" bash -c "cd $B && setsid $PG_BIN/pg_ctl -D $B/pg -l $B/pg.log start" >/dev/null \
      || { echo "PG_START_FAIL: رفضَ pg_ctl الإقلاعَ (راجع $B/pg.log)" >&2; exit 1; }
    for _ in $(seq 1 60); do sudo -n ip netns exec $NS sh -c "pg_isready -h 127.0.0.1 -p $PG_PORT -q" 2>/dev/null && break; sleep 0.5; done
  fi
  # شرطُ قبولٍ بعديٌّ لا زينة: فشلُ الإقلاعِ يجبُ أن يُسقطَ السكربتَ لا أن يمرَّ صامتاً.
  sudo -n ip netns exec $NS sh -c "pg_isready -h 127.0.0.1 -p $PG_PORT -q" 2>/dev/null \
    || { echo "PG_READY_FAIL: لم يستقم postgres داخل $NS" >&2; exit 1; }
  # Redis داخل الـnetns. `setsid` لا ينقلُ العمليةَ إلى الخلفيةِ بنفسِه: تشغيلُه داخلَ
  # `sh -c` متزامنٍ مع `--daemonize no` يعلّقُ السكربتَ إلى الأبد (مرصودٌ عمليّاً). فالخلفيةُ
  # هنا `&` داخلَ `bash -c` و`setsid` يفصلُ الجلسةَ لتنجوَ من إنهاءِ السكربتِ نفسِه.
  if ! sudo -n ip netns exec $NS sh -c "redis-cli -p $REDIS_PORT ping" 2>/dev/null | rg -q PONG; then
    "$B/bin/nsx" bash -c "setsid $REDIS_SERVER --port $REDIS_PORT --dir $B/redis --daemonize no --save '' --appendonly no >/dev/null 2>&1 &"
    for _ in $(seq 1 20); do sudo -n ip netns exec $NS sh -c "redis-cli -p $REDIS_PORT ping" 2>/dev/null | rg -q PONG && break; sleep 0.25; done
  fi
  # شرطُ قبولٍ بعديٌّ: بلا PONG لا يُطبع INFRA_OK أبداً.
  sudo -n ip netns exec $NS sh -c "redis-cli -p $REDIS_PORT ping" 2>/dev/null | rg -q PONG \
    || { echo "REDIS_READY_FAIL: لم يستقم redis داخل $NS" >&2; exit 1; }
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
  # ON_ERROR_STOP: بلاها يُعيدُ psql صفراً حتى مع فشلِ SQL (مرصودٌ: غيابُ postgis
  # طبعَ ERROR ثمّ DB_OK). فشلُ أيّ عبارةٍ هنا يجبُ أن يُسقطَ الخطوةَ كلَّها.
  for db in $MAIN_DB $TEST_DB; do
    $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -tc "select 1" -d postgres >/dev/null 2>&1 \
      || { echo "DB_CONNECT_FAIL: القاعدةُ لا تستجيبُ لـ$db" >&2; exit 1; }
    $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -v ON_ERROR_STOP=1 -q \
      -c "drop database if exists $db" \
      -c "create database $db encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8' template template0" \
      || { echo "DB_CREATE_FAIL: $db" >&2; exit 1; }
    $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -d $db -v ON_ERROR_STOP=1 -q <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
SQL
    for ext_name in $REQUIRED_EXTENSIONS; do
      $B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -d $db -v ON_ERROR_STOP=1 -q \
        -c "create extension if not exists \"$ext_name\"" \
        || { echo "EXTENSION_CREATE_FAIL: $ext_name في $db" >&2; exit 1; }
    done
    # شرطُ قبولٍ بعديٌّ: الامتدادُ المطلوبُ موجودٌ فعلاً في كلِّ قاعدةٍ قبلَ DB_OK.
    for ext_name in $REQUIRED_EXTENSIONS; do
      ext=$($B/bin/nsx psql -h 127.0.0.1 -p $PG_PORT -U postgres -d $db -tAc "select 1 from pg_extension where extname='$ext_name'")
      [ "$ext" = "1" ] || { echo "EXTENSION_MISSING: $ext_name في $db (ثبّت postgresql-18-postgis-3 على المقعد)" >&2; exit 1; }
    done
  done
  echo "DB_OK $MAIN_DB $TEST_DB"
}

step_migrate() {
  # القاعدةُ داخلَ الـnetns حصراً (lo بلا مسارٍ للخارجِ): الهجراتُ تُطبّقُ عبرَ nsx
  # لا من مضيفِ المقعدِ، وإلا كانَ الاتصالُ مرفوضاً (مرصودٌ: ECONNREFUSED من الخطوةِ
  # نفسِها على مقعدٍ نظيفٍ). وbun يُحلّ إلى مسارِهِ المطلقِ لأنّ sudo يصفّرُ PATH.
  local bun_bin; bun_bin=$(command -v bun) || { echo "BUN_MISSING: ثبّت bun على المقعد" >&2; exit 1; }
  for db in $MAIN_DB $TEST_DB; do
    "$B/bin/nsx" bash -c "export DATABASE_URL='postgres://postgres@127.0.0.1:$PG_PORT/$db'; cd '$REPO' && exec '$bun_bin' run scripts/migrate.ts" | tail -1 \
      || { echo "MIGRATE_FAIL: $db (رمزُ خروجٍ غيرُ صفريٍّ من scripts/migrate.ts)" >&2; exit 1; }
  done
  echo "MIGRATE_OK"
}

case "${1:-all}" in
  infra) step_infra ;;
  db) step_db ;;
  migrate) step_migrate ;;
  all) step_infra; step_db; step_migrate ;;
esac
