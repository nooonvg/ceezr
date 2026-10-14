#!/usr/bin/env bash
# SANDBOX-SOAK-01 — لقطةُ حالةٍ سريعةٌ أثناءَ التشغيل.
ROOT=$(cd "$(dirname "$0")" && pwd)
P="psql -h 127.0.0.1 -U postgres -d waslah_test -tA"
echo "time: $(date -u +%T) | gateway: $(curl -s -o /dev/null -w '%{http_code}' localhost:4300/ready) | redis: $(redis-cli ping)"
tail -3 "$ROOT/logs/soak.out" 2>/dev/null
echo "orders: $($P -c "select string_agg(service||'/'||status||'='||n, ' ') from (select service::text, status::text, count(*) n from orders group by 1,2 order by 1,2) x")"
echo "negotiations: $($P -c "select string_agg(status||'='||n,' ') from (select status::text, count(*) n from unsubscribed_negotiations group by 1) x")"
echo "update_jobs: $($P -c "select string_agg(status||'='||n,' ') from (select status, count(*) n from telegram_update_jobs group by 1) x") | outbox: $($P -c "select string_agg(status||'='||n,' ') from (select status, count(*) n from notification_outbox group by 1) x")"
echo "gateway errors: $(grep -ciE '"level":"(error|fatal)"|job_error|claim_failed' "$ROOT/logs/gateway.log")"
