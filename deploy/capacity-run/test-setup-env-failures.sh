#!/usr/bin/env bash
# اختبارُ مساراتِ الفشلِ في setup-env-20261016.sh — كلُّ حالةٍ يجبُ أن تنتهيَ برمزٍ غيرِ صفريٍّ
# وبرسالةِ فشلٍ مصنَّفةٍ، **ولا تطبعَ** علامةَ نجاحِ خطوتِها (INFRA_OK/DB_OK/MIGRATE_OK).
#
# العزل: netns مستقلٌّ (CAP_NS)، وقاعدةُ ملفّاتٍ في /tmp، ومنفذا PG/Redis غيرُ منفذَي المقعد.
# لا يلمسُ المقعدَ المعتمدَ (ceezrsbx2 · /srv/ceezr-cap-20261016) ولا أيَّ شبكةٍ خارجيّةٍ ولا إنتاجاً.
# ويهدمُ في الختامِ ما أنشأه وحدَه.
#   ./test-setup-env-failures.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SETUP="$HERE/setup-env-20261016.sh"
T=${FAIL_TEST_BASE:-/tmp/ceezr-setup-failtest}
NS=ceezrfailt
PG_PORT=55499
REDIS_PORT=56499
PG_BIN=/usr/lib/postgresql/18/bin
fails=0; passes=0
[ "$NS" != "ceezrsbx2" ] || { echo "رفض: netns الاختبار يساوي netns المقعد" >&2; exit 2; }

cleanup() {
  if [ -f "$T/ok/pg/postmaster.pid" ]; then
    sudo -n ip netns exec $NS sudo -n -u "$(id -un)" "$PG_BIN/pg_ctl" -D "$T/ok/pg" stop -m immediate >/dev/null 2>&1 || true
  fi
  sudo -n ip netns exec $NS sudo -n -u "$(id -un)" redis-cli -p $REDIS_PORT shutdown nosave >/dev/null 2>&1 || true
  sudo -n ip netns del $NS 2>/dev/null || true
  case "$T" in /tmp/ceezr-setup-failtest*) rm -rf "$T" ;; esac
}
trap cleanup EXIT
cleanup; mkdir -p "$T"

# expect NAME FORBIDDEN_MARKER REQUIRED_STDERR -- ENV... STEP
expect_fail() {
  local name=$1 forbidden=$2 needle=$3; shift 3
  local out rc
  out=$(env "$@" 2>&1); rc=$?
  if [ $rc -ne 0 ] && ! grep -q "$forbidden" <<<"$out" && grep -q "$needle" <<<"$out"; then
    echo "PASS $name (rc=$rc, «$needle»، بلا $forbidden)"; passes=$((passes+1))
  else
    echo "FAIL $name (rc=$rc)"; echo "$out" | tail -5 | sed 's/^/    /'; fails=$((fails+1))
  fi
}
common=(CAP_NS=$NS CAP_PG_PORT=$PG_PORT CAP_REDIS_PORT=$REDIS_PORT)

# 1) إقلاعُ PostgreSQL: دليلُ بياناتٍ مزيّفٌ (PG_VERSION بلا عنقود) ⇒ pg_ctl يرفض ⇒ PG_START_FAIL.
#    (فرعُ PG_READY_FAIL — إقلاعٌ قُبِلَ ولم يستقم خلالَ 30ث — شرطٌ بعديٌّ لا يُعادُ إنتاجُه هنا.)
mkdir -p "$T/badpg/pg"; echo 18 > "$T/badpg/pg/PG_VERSION"
expect_fail pg_start INFRA_OK PG_START_FAIL \
  "${common[@]}" RUN_BASE="$T/badpg" bash "$SETUP" infra

# 2) جاهزيّةُ Redis: PG سليمٌ وخادمُ Redis يخرجُ فوراً (/bin/false) ⇒ REDIS_READY_FAIL.
expect_fail redis_ready INFRA_OK REDIS_READY_FAIL \
  "${common[@]}" RUN_BASE="$T/ok" CAP_REDIS_SERVER=/bin/false bash "$SETUP" infra

# 3) امتدادٌ مطلوبٌ غيرُ متاحٍ (آليّةُ فشلِ postgis نفسُها: create extension يُرفَضُ) ⇒ EXTENSION_CREATE_FAIL.
expect_fail extension_missing DB_OK EXTENSION_CREATE_FAIL \
  "${common[@]}" RUN_BASE="$T/ok" CAP_MAIN_DB=ceezr_failt_main CAP_TEST_DB=ceezr_failt_test \
  CAP_REQUIRED_EXTENSIONS="postgis ceezr_no_such_extension" bash "$SETUP" db

# 4أ) الترحيلُ إلى قاعدةٍ غيرِ موجودةٍ ⇒ MIGRATE_FAIL.
expect_fail migrate_no_db MIGRATE_OK MIGRATE_FAIL \
  "${common[@]}" RUN_BASE="$T/ok" CAP_MAIN_DB=ceezr_failt_absent CAP_TEST_DB=ceezr_failt_absent bash "$SETUP" migrate

# 4ب) الترحيلُ يفشلُ **داخلَ** هجرةٍ (قاعدةٌ موجودةٌ بلا postgis ⇒ نوعُ geography غائب) ⇒ MIGRATE_FAIL.
sudo -n ip netns exec $NS sudo -n -u "$(id -un)" "$PG_BIN/psql" -h 127.0.0.1 -p $PG_PORT -U postgres -q \
  -c "create database ceezr_failt_nopostgis" >/dev/null 2>&1
expect_fail migrate_sql_error MIGRATE_OK MIGRATE_FAIL \
  "${common[@]}" RUN_BASE="$T/ok" CAP_MAIN_DB=ceezr_failt_nopostgis CAP_TEST_DB=ceezr_failt_nopostgis bash "$SETUP" migrate

# 5) ضابطٌ إيجابيّ: المسارُ السليمُ على العنقودِ نفسِه يطبعُ DB_OK برمزِ صفر (الاختبارُ لا يفشلُ دائماً).
out=$(env "${common[@]}" RUN_BASE="$T/ok" CAP_MAIN_DB=ceezr_failt_main CAP_TEST_DB=ceezr_failt_test bash "$SETUP" db 2>&1); rc=$?
if [ $rc -eq 0 ] && grep -q DB_OK <<<"$out"; then echo "PASS db_happy_control (rc=0, DB_OK)"; passes=$((passes+1));
else echo "FAIL db_happy_control (rc=$rc)"; echo "$out" | tail -3; fails=$((fails+1)); fi

echo "SUMMARY passes=$passes fails=$fails"
[ $fails -eq 0 ]
