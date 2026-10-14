#!/usr/bin/env bash
# SANDBOX-SOAK-01 — تشغيلٌ كامل: الخدماتُ ثمّ مولّدُ الحمل (بذرٌ + مكثّفٌ متصاعدٌ + حالاتٌ حدّيّة).
#   INTENSIVE_MIN=30 EDGE_MIN=10 ./run_all.sh      (SMOKE=2 لتجربةِ دخانٍ: مشوارٌ وتوصيلٌ وقروب)
set -eu
ROOT=$(cd "$(dirname "$0")" && pwd)
export PATH=$HOME/.bun/bin:${PG_BIN:-/usr/lib/postgresql/18/bin}:$PATH
"$ROOT/run_services.sh"
for _ in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:4300/ready)" = 200 ] && break; sleep 1; done
redis-cli flushall >/dev/null
psql -h 127.0.0.1 -U postgres -d waslah_test -qc "truncate telegram_update_jobs, telegram_update_receipts cascade"
cd "$ROOT" && INTENSIVE_MIN=${INTENSIVE_MIN:-30} EDGE_MIN=${EDGE_MIN:-10} bun run load/soak.ts 2>&1 | tee logs/soak.out
