#!/usr/bin/env bash
# الدفعة 26 — التحقّقُ الآليُّ من حدِّ مبادلةِ الجلسةِ الذي قرأته البوابةُ الحيّة:
#   ١) قيمةُ SESSION_EXCHANGE_PER_MINUTE في بيئةِ عمليةِ البوابةِ نفسِها (/proc/<pid>/environ — هذا المفتاحُ وحدَه)
#   ٢) الحدُّ الفعليُّ بدالّةِ السياسةِ نفسِها في شيفرةِ الجانب (rateLimitPolicy؛ ما فوقَ 100000 يرجعُ صامتًا إلى 30)
#   ٣) القيمةُ في run.env للجانبِ (تبقى 6000 بلا تعديل) وحدُّ الإنتاجِ الافتراضيُّ بلا متغيّر (30)
#   session-limit-check.sh <WORKTREE> <EXPECTED>  → JSON
set -u
B=/srv/ceezr-cap-20261016; WT=$1; EXP=$2; export PATH=/home/user/.bun/bin:/home/user/.local/bin:$PATH
# عمليةُ البوابةِ نفسُها (مملوكةٌ للمستخدم) لا غلافا sudo المملوكانِ للجذرِ وفي سطرِهما المسارُ نفسُه
PID=$($B/bin/nsx bash -c "pgrep -u \$(id -un) -f '[a]pps/gateway/src/index.ts' | tail -1")
COMM=$($B/bin/nsx bash -c "cat /proc/$PID/comm" 2>/dev/null)
ENVV=$($B/bin/nsx bash -c "tr '\\0' '\\n' < /proc/$PID/environ | grep -m1 '^SESSION_EXCHANGE_PER_MINUTE=' | cut -d= -f2")
pol() { (cd "$WT" && env -i PATH="$PATH" HOME="$HOME" SESSION_EXCHANGE_PER_MINUTE="$1" bun -e 'import {rateLimitPolicy} from "./apps/gateway/src/rate-limit/policy.ts"; const p=rateLimitPolicy("POST","/v1/session/telegram","عنوانُ العميلِ"); console.log(p.limit+" "+p.windowSeconds)'); }
read -r EFF WIN <<< "$(pol "$ENVV")"
read -r PRODDEF _ <<< "$(pol "")"
RUNENV=$(grep -m1 '^SESSION_EXCHANGE_PER_MINUTE=' "$WT/deploy/capacity-run/config/run.env" | cut -d= -f2)
OK=false; [ "$ENVV" = "$EXP" ] && [ "$EFF" = "$EXP" ] && [ "$WIN" = 60 ] && OK=true
printf '{"gateway_comm":"%s","sha":"%s","env_in_live_gateway":"%s","effective_limit":%s,"window_seconds":%s,"expected":%s,"run_env_value_unchanged":"%s","default_without_var":%s,"ok":%s}\n' \
  "$COMM" "$(git -C "$WT" rev-parse HEAD)" "$ENVV" "${EFF:-null}" "${WIN:-null}" "$EXP" "$RUNENV" "${PRODDEF:-null}" "$OK"
