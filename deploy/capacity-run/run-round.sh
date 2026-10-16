#!/usr/bin/env bash
# CAP-RUN-20261016 — تشغيل جولة واحدة في مجلد فريد: مراقب + (اختياري) منسّق أعطال + مولّد، كلها منفصلة.
#   ROUND=r03-soak60 PROFILE='[...]' [CHAOS=1] [CODE_DIR=...] [MARKS=10,20,..] ./run-round.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
: "${ROUND:?}"; : "${PROFILE:?}"
export RUN_DIR=$B/runs/$ROUND
[ -e "$RUN_DIR" ] && { echo "RUN_DIR exists: $RUN_DIR (لا خلط بين الجولات)"; exit 1; }
mkdir -p "$RUN_DIR/evidence" "$RUN_DIR/reports"
ln -sfn "$RUN_DIR" "$B/runs/current"
bash "$HERE/svc.sh" assert | tee "$RUN_DIR/evidence/isolation-check.txt"
# محاكي تيليجرام يُعاد لكل جولة فيُكتب سجلّه (telegram-mock.jsonl) في مجلد الجولة نفسها
bash "$HERE/svc.sh" stop-mock || true; sleep 1
RUN_DIR=$RUN_DIR bash "$HERE/svc.sh" mock
for _ in $(seq 1 40); do $B/bin/nsx curl -s -m 1 http://127.0.0.1:58090/health >/dev/null && break; sleep 0.25; done
# البوابة تُعاد بإعدادات هذه الجولة (CODE_DIR/NOTIFICATION_DRAIN_BUDGET_MS…) حتى يُسجَّل SHA الكود المشغّل
bash "$HERE/svc.sh" stop-gateway || true
for _ in $(seq 1 60); do bash "$HERE/svc.sh" status | grep -q gateway=down && break; sleep 0.5; done
if [ -n "${EXTRA_ENV:-}" ]; then cp "$HERE/config/run.env" "$RUN_DIR/run.env"; echo "$EXTRA_ENV" | tr ' ' '\n' >> "$RUN_DIR/run.env"; fi
bash "$HERE/svc.sh" gateway
for _ in $(seq 1 120); do $B/bin/nsx curl -s -m 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:54300/ready | grep -q 200 && break; sleep 0.5; done
echo "{\"t\":\"$(date -Is)\",\"source\":\"run-round\",\"event\":\"round.start\",\"round\":\"$ROUND\",\"profile\":$PROFILE,\"chaos\":\"${CHAOS:-0}\",\"code_dir\":\"${CODE_DIR:-default}\"}" >> "$RUN_DIR/evidence/timeline.jsonl"
PROFILE="$PROFILE" RESET=${RESET:-1} bash "$HERE/gen.sh" gen1
# الزمن الصفري للجولة = لحظة load.start (بعد التهيئة وتفريغ الطابور) — لا يُحسب البناء/البذر/التهيئة ضمن الجولة.
for _ in $(seq 1 600); do grep -q '"event":"load.start"' "$RUN_DIR/evidence/load-events.jsonl" 2>/dev/null && break; sleep 1; done
START_MS=$(( $(date +%s) * 1000 ))
echo "{\"t\":\"$(date -Is)\",\"source\":\"run-round\",\"event\":\"load.zero\",\"start_ms\":$START_MS}" >> "$RUN_DIR/evidence/timeline.jsonl"
SOAK_START_MS=$START_MS REPORT_MARKS=${MARKS:-10,20,30,40,50,60} MONITOR_END_MIN=${MON_END:-75} bash "$HERE/mon.sh"
[ "${CHAOS:-0}" = 1 ] && SOAK_START_MS=$START_MS bash "$HERE/chaos.sh"
echo "round $ROUND load zero at $START_MS"
