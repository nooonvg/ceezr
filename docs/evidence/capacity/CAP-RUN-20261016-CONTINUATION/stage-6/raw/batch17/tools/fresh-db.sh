#!/usr/bin/env bash
# قاعدةٌ نظيفةٌ قبلَ كلِّ موجةٍ: نسخٌ من القالبِ المُهاجَرِ + تفريغُ Redis + إعادةُ تشغيلِ البوابةِ (بلا مشرفٍ: svc.sh مباشرةً).
set -euo pipefail
B=/srv/ceezr-cap-20261016; REPO=${REPO:-/home/user/workspace/wt-acc}
sudo -n ip netns exec ceezrsbx2 pkill -TERM -f '[a]pps/gateway/src/index.ts' || true
# أثرُ التشخيصِ اختياريٌّ: يُكتَبُ في ملفِّ أسرارِ المقعدِ عندَ TRACE_FILE ويُزالُ بغيابِه
sed -i '/^DISPATCH_TRACE_FILE=/d' $B/secrets.env
if [ -n "${TRACE_FILE:-}" ]; then rm -f "$TRACE_FILE"; echo "DISPATCH_TRACE_FILE=$TRACE_FILE" >> $B/secrets.env; fi
sed -i '/^DISPATCH_DIAG_/d;/^NOTIFICATION_DRAIN_LANES=/d;/^DIAG_LOCAL_/d' $B/secrets.env
# DIAG_EXTRA="K=V K=V": متغيّراتُ تجربةِ عزلٍ صريحةٌ تُسجَّلُ في الأثرِ (لا تُستعمَلُ في القبول)
for kv in ${DIAG_EXTRA:-}; do echo "$kv" >> $B/secrets.env; done
[ -n "${DIAG_POOL:-}" ] && echo "DISPATCH_DIAG_DEDICATED_POOL=$DIAG_POOL" >> $B/secrets.env
[ -n "${DIAG_REQ:-}" ] && echo "DISPATCH_DIAG_REQUEST_POOL=$DIAG_REQ" >> $B/secrets.env
[ -n "${DIAG_DRAINER_BG:-}" ] && echo "DISPATCH_DIAG_DRAINER_BG=$DIAG_DRAINER_BG" >> $B/secrets.env
true
for i in $(seq 1 30); do $B/bin/nsx bash -c "pgrep -f '[a]pps/gateway/src/index.ts'" >/dev/null || break; sleep 1; done
$B/bin/nsx bash -c "psql -h 127.0.0.1 -p 55432 -U postgres -q -c 'drop database if exists ceezr_cap_20261016 with (force)' -c 'create database ceezr_cap_20261016 template ceezr_cap_tpl' && psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -q -c 'create extension if not exists pg_stat_statements' -c 'select pg_stat_statements_reset()' >/dev/null && redis-cli -p 56379 flushall >/dev/null"
cd $REPO && RUN_BASE=$B RUN_DIR=$B/runs/current ${GW_ENV:-} bash deploy/capacity-run/svc.sh gateway
for i in $(seq 1 60); do
  sleep 2
  if $B/bin/nsx bash -c "curl -s -m 2 http://127.0.0.1:54300/ready" 2>/dev/null | grep -q '"ready"'; then
    echo "FRESH_DB_OK sha=$(git -C $REPO rev-parse --short HEAD) gateway_pid=$($B/bin/nsx bash -c "pgrep -f '[a]pps/gateway/src/index.ts' | tail -1")"; exit 0
  fi
done
echo "FRESH_DB_GATEWAY_NOT_READY" >&2; exit 1
