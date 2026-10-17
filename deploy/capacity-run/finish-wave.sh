#!/usr/bin/env bash
# نهايةُ موجةٍ (LOAD-01) من المستودعِ — ينتظرُ **حدثَ gen.end في ملفِ
# الأحداثِ** لا حياةَ العمليةِ: العمليةُ قد تبقى حيةً دقائقَ بعدَ gen.end
# (جمعُ المهلاتِ) فانتظارُها يحرّكَ حدَّ القياسِ ظلمًا. بعدها تدقيقٌ بعديٌّ
# وحكمٌ آليٌّ من التقريرِ. حجةٌ واحدةٌ: اسمُ الجولةِ (ROUND).
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
SEAT=${SEAT:-/home/user/cap-seat}
export PATH="$HOME/bin:$HOME/envs/pg/bin:$PATH"
ROUND=${1:?ROUND}
RUN_DIR=${RUN_DIR:-$SEAT/runs/$ROUND}
for i in $(seq 1 240); do
  rg -q '"event":"gen.end"' "$RUN_DIR/evidence/miniapp-load-events.jsonl" 2>/dev/null && break
  ps -p "$(cat "$RUN_DIR/gen.pid")" >/dev/null 2>&1 || break
  sleep 10
done
rg -q '"event":"gen.end"' "$RUN_DIR/evidence/miniapp-load-events.jsonl" 2>/dev/null || echo "WARN: gen.end not found in events"
for i in $(seq 1 30); do ps -p "$(cat "$RUN_DIR/gen.pid")" >/dev/null 2>&1 || break; sleep 10; done
kill -9 "$(cat "$RUN_DIR/gen.pid")" 2>/dev/null
echo "gen_exit_marker $(cat "$RUN_DIR/gen.pid")"
# سجلُّ المحاكي أدلةُ الموجةِ — يُنسخُ إلى دليلِ أدلتِها قبلَ التدقيقِ
# البعديِّ ليقرأَهُ حسابُ قناةِ الإرسالِ (المحاكيُّ يكتبُ في مقعدٍ مشتركٍ).
cp "$SEAT/runs/current/evidence/telegram-mock.jsonl" "$RUN_DIR/evidence/telegram-mock.jsonl" 2>/dev/null || true
set -a; . "$HERE/config/run.env"; . "$SEAT/secrets.env"; set +a
curl -s -m 5 "${MOCK_TELEGRAM_URL:-http://127.0.0.1:58090}/stats" > "$RUN_DIR/evidence/mock-stats-post.json" 2>/dev/null || true
export RUN_DIR GATEWAY_URL=${GATEWAY_URL:-http://127.0.0.1:54300} GEN_ID=${GEN_ID:-genA}
bun run "$HERE/load/db-audit.ts" --phase=post > "$RUN_DIR/evidence/db-audit-post.out" 2>&1
# استقرارُ البوابةِ عبرَ الموجةِ: الرقمُ المُدوَّنُ في wave.sh (gateway.pid) هو
# المعيارُ — تغيّرُهُ يعني انهيارًا أخفاهُ إعادةُ تشغيلٍ تلقائيّةٌ، فيُسجَّلُ
# خرقًا في الأدلةِ (gate-fail) لا استقرارًا.
GWPID_NOW=$(ps -eo pid=,args= | awk '/apps\/gateway\/src\/index\.ts/ && /bun/ && !/awk/ {print $1}' | tail -1)
GWPID_RECORDED=$(cat "$RUN_DIR/evidence/gateway.pid" 2>/dev/null || echo missing)
if [ "$GWPID_NOW" != "$GWPID_RECORDED" ]; then
  echo "GATE-FAIL gateway-stability: pid recorded=$GWPID_RECORDED now=$GWPID_NOW" | tee "$RUN_DIR/evidence/gateway-stability-fail.txt"
fi
# رمزُ خروجِ التقريرِ **يُحفَظ** لا يُبتلَعُ: موجةٌ فاشلةٌ تعيدُ فشلَها لمن
# استدعاها (run-wave.sh وسلسلةُ الجولاتِ) — وإلا مرَّت الموجةُ الفاشلةُ صامتةً
# وخُلِّطَت بالجولاتِ اللاحقةِ.
bun run "$HERE/load/wave-report.ts" > "$RUN_DIR/evidence/wave-report.json" 2> "$RUN_DIR/evidence/wave-report.err"
REPORT_RC=$?
python3 -c "
import json
r = json.load(open('$RUN_DIR/evidence/wave-report.json'))
print('WAVE $ROUND:', r['verdict'], '| failed:', r['failedGates'])
for x in r['gates']:
    if not x['pass']: print('  GATE FAIL', x['id'], x['value'], 'limit', x['limit'])
for x in r['perf']:
    if not x['pass']: print('  PERF FAIL', x['id'], x['value'], 'limit', x['limit'])
"
exit $REPORT_RC
