#!/usr/bin/env bash
# مُشغِّلُ موجةِ قبولٍ واحدَةٍ (LOAD-01) من المستودعِ — نفسُ دلالاتِ مقعدِ
# الجولةِ (bin/wave) لكن بمساراتٍ معلَمةٍ لا مكتوبةً: قابلٌ لإعادةِ التشغيلِ من
# أيِّ مقعدٍ. حججُه:
#   ./wave.sh ROUND PROFILE_JSON DRAIN_SEC WAVE_IDX [ENV=VAL ...]
# نطاقاتُ الهوياتِ تتصادمُ بينَ الجولاتِ إن تُركت ثابتةً (موجةُ 50 الأولىِ
# اصطدمَت بهوياتِ جولةٍ سابقةٍ) — لذا تُشتقُّ من فهرسِ الموجةِ نفسِهِ:
# راكبو 6.2م+ وفهرسُ الموجةِ×100أ، وسائقو 8.2م+ كذلكَ.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); REPO=$(cd "$HERE/../.." && pwd)
ROUND=${1:?ROUND}; PROFILE=${2:?PROFILE_JSON}; DRAIN=${3:?DRAIN_SEC}; WAVEIDX=${4:-0}; shift 4 || true
SEAT=${SEAT:-/home/user/cap-seat}
export PATH="$HOME/bin:$HOME/envs/pg/bin:$PATH"
RUN_DIR=${RUN_DIR:-$SEAT/runs/$ROUND}
if [ -e "$RUN_DIR" ]; then echo "RUN_DIR exists — لا تُحذف الأدلةُ أبدًا؛ استعمل اسمًا جديدًا" >&2; exit 1; fi
mkdir -p "$RUN_DIR/evidence"
set -a; . "$HERE/config/run.env"; . "$SEAT/secrets.env"; set +a
export RUN_DIR GATEWAY_URL=${GATEWAY_URL:-http://127.0.0.1:54300} GEN_ID=${GEN_ID:-genA} \
  DRAIN_SEC="$DRAIN" PROFILE="$PROFILE" MATCH_WAIT_MS=${MATCH_WAIT_MS:-120000}
for kv in "$@"; do export "$kv"; done
export RIDER_SEQ_START=$((6200000+WAVEIDX*100000)) DRIVER_SEQ_START=$((8200000+WAVEIDX*100000))
# code_dirty يعدُّ الشيفرةَ وحدَها؛ نسخُ أدلةِ موجةٍ سابقةٍ إلى docs/ لا يجعلُ الشيفرةَ «متّسخةً» (r11-wave-500).
echo "{\"t\":\"$(date -Is)\",\"event\":\"round.start\",\"round\":\"$ROUND\",\"profile\":$PROFILE,\"drain_sec\":$DRAIN,\"code_sha\":\"$(git -C "$REPO" rev-parse HEAD)\",\"code_dirty\":$(git -C "$REPO" status --porcelain -- . ':(exclude)docs' | grep -c .),\"docs_dirty\":$(git -C "$REPO" status --porcelain -- docs | grep -c .)}" > "$RUN_DIR/evidence/timeline.jsonl"
# هويةُ البوابةِ **قبلَ** الموجةِ: انهيارُها أثناءَ الموجةِ وإعادةُ تشغيلها
# تلقائيًّا (المشرفُ) لا يجوزُ أن يمرَّ صامتًا فيُحسَبَ استقرارًا زائفًا —
# يُدوَّنُ رقمُ عمليّتِها ويُتحقَّقُ منهُ عندَ الختامِ (finish-wave.sh).
GWPID=$(ps -eo pid=,args= | awk '/apps\/gateway\/src\/index\.ts/ && /bun/ && !/awk/ {print $1}' | tail -1)
echo "$GWPID" > "$RUN_DIR/evidence/gateway.pid"
echo "{\"t\":\"$(date -Is)\",\"event\":\"gateway.pid\",\"pid\":\"$GWPID\"}" >> "$RUN_DIR/evidence/timeline.jsonl"
# التدقيقُ القبليَّ بوابةٌ لا زينة: فشلُه يُجهضُ الموجةَ قبلَ حقنِ أيِّ حملٍ —
# تشغيلُ موجةٍ على قاعدةٍ غيرِ نظيفةٍ يفسدُ القياسَ ويدّعي النجاحَ زورًا.
if ! bun run "$HERE/load/db-audit.ts" --phase=pre > "$RUN_DIR/evidence/db-audit-pre.out" 2>&1; then
  echo "PRE-AUDIT FAILED — أُجهضت الموجة قبل الحقن (راجع db-audit-pre.out)" >&2
  exit 1
fi
# تصنيفُ الإرسالِ لكلِّ بوتٍ شرطٌ قبليٌّ: محاكٍ يجهلُ الرموزَ يجمعُ البوتينِ في
# نافذةٍ واحدةٍ فيفسدُ قياسَ P7 (عيبُ r7–r9). اللقطةُ القبليةُ تُحفظُ ويُقارَنُ
# بها بعدَ الموجةِ (بوابةُ EGRESS-CLASSIFIED في التقريرِ).
if ! curl -s -m 5 "${MOCK_TELEGRAM_URL:-http://127.0.0.1:58090}/stats" > "$RUN_DIR/evidence/mock-stats-pre.json" \
   || ! python3 -c "import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if d.get('unknown_token',1)==0 else 1)" "$RUN_DIR/evidence/mock-stats-pre.json"; then
  echo "MOCK PREFLIGHT FAILED — المحاكي لا يصنّفُ البوتاتِ (unknown_token>0) أو لا يستجيب؛ أعد تشغيله" >&2
  exit 1
fi
# مسارُ الإشارةِ الآنيةِ شرطٌ قبليٌّ: بلا `INTERNAL_SIGNAL_SECRET` تعيدُ البوابةُ 503
# فيتعطّلُ مسارُ Mini App للسائقِ والراكبِ **بصمتٍ** وينزلُ كلُّ شيءٍ إلى تيليجرامَ
# (عيبُ مقعدِ r7–r10). نداءٌ بلا سرٍّ يجبُ أن يُرفضَ 401 (مُركَّبٌ ومحروسٌ) لا 503.
for sig in offers-signal rider-trip-signal; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "${GATEWAY_INTERNAL_URL:-http://127.0.0.1:54300}/internal/realtime/$sig" -H 'content-type: application/json' -d '{}')
  if [ "$code" != "401" ]; then
    echo "SIGNAL PREFLIGHT FAILED — /internal/realtime/$sig أعادَ $code (المتوقعُ 401: مُركَّبٌ ومحروسٌ بسرٍّ)" >&2
    exit 1
  fi
done
setsid bun run "$HERE/load/miniapp-load.ts" > "$RUN_DIR/gen.out" 2>&1 < /dev/null &
echo $! > "$RUN_DIR/gen.pid"
echo "started round=$ROUND pid=$(cat "$RUN_DIR/gen.pid")"
