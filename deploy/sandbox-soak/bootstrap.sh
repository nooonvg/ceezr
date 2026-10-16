#!/usr/bin/env bash
# SANDBOX-SOAK-01 — بناءُ البيئةِ التجريبيّةِ من الصفر على Ubuntu (مرّةً واحدة).
# لا يلمسُ الإنتاج: قاعدةٌ محلّيّةٌ باسمِ waslah_test، وأسرارٌ وهميّةٌ في config/sandbox.env.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$ROOT/../.." && pwd)
PG_BIN=${PG_BIN:-/usr/lib/postgresql/18/bin}; PG_DATA=${SANDBOX_PG_DIR:-$HOME/sandbox/pg/data}
command -v bun >/dev/null || { curl -fsSL https://bun.sh/install | bash; }
export PATH=$HOME/.bun/bin:$PG_BIN:$PATH
if ! command -v initdb >/dev/null; then
  sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql-18 postgresql-18-postgis-3 redis-server unzip
  # الحزمةُ تُقلِعُ عنقودًا على 5432 — نوقفه لنستعملَ عنقودَنا.
  sudo pg_ctlcluster 18 main stop 2>/dev/null || true
  sudo service redis-server stop 2>/dev/null || true
fi
mkdir -p "$ROOT/logs" "$(dirname "$PG_DATA")"
[ -d "$PG_DATA" ] || initdb -D "$PG_DATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"$ROOT/run_services.sh" infra
P="psql -h 127.0.0.1 -U postgres -q"
# UTF-8 إلزاميّ: بترميزِ SQL_ASCII تُعدُّ بايتاتُ العربيّةِ حروفًا فتسقطُ قيودُ الطولِ في هجرةِ المعجمِ الجغرافيّ.
$P -c "drop database if exists waslah_test" -c "create database waslah_test encoding 'UTF8' lc_collate 'C.UTF-8' lc_ctype 'C.UTF-8' template template0"
$P -d waslah_test -c "do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end \$\$"
(cd "$REPO" && bun install --frozen-lockfile >/dev/null && DATABASE_URL=postgres://postgres@127.0.0.1:5432/waslah_test bun run scripts/migrate.ts | tail -1)
(cd "$REPO/docker/upstash-rest-shim" && bun install >/dev/null)
echo "✅ البيئةُ جاهزة. التالي: ./run_all.sh"
