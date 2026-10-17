#!/usr/bin/env bash
# قاعدةٌ نظيفةٌ حرفيًا قبلَ كلِّ جولةٍ: نسخُ قاعدةِ الموجاتِ من قالبٍ مُهاجَرٍ بالكاملِ
# (ceezr_cap_tpl)، وتفريغُ Redis، ثم إعادةُ تشغيلِ البوابةِ (المشرفُ يرفعُها).
# السببُ المقيسُ: تراكمُ r1–r10 (10k سائق، 64k عرض) أبطأَ استعلاماتِ المطابقةِ ~2×.
set -euo pipefail
B=/home/user/cap-seat; REPO=/home/user/workspace/ceezr
$B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -q -c 'drop database if exists ceezr_cap_20261016 with (force)' -c 'create database ceezr_cap_20261016 template ceezr_cap_tpl' && psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -q -c 'create extension if not exists pg_stat_statements' -c 'select pg_stat_statements_reset()' >/dev/null && redis-cli -p 56379 flushall >/dev/null"
RUN_BASE=$B $B/bin/nsx bash -c "cd $REPO && RUN_BASE=$B bash deploy/capacity-run/svc.sh kill-gateway" || true
for i in $(seq 1 40); do
  sleep 2
  if $B/bin/nsx bash -c "curl -s -m 2 http://127.0.0.1:54300/ready" 2>/dev/null | grep -q '"ready"'; then
    echo "FRESH_DB_OK gateway_pid=$($B/bin/nsx bash -c "pgrep -f '[a]pps/gateway/src/index.ts' | tail -1")"; exit 0
  fi
done
echo "FRESH_DB_GATEWAY_NOT_READY" >&2; exit 1
