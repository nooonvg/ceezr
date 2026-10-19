#!/usr/bin/env bash
# موجةٌ مؤهَّلة (الدفعةُ الثانيةَ عشرة): فحصٌ مسبقٌ ← (لا حقنَ إن فشل) ← عيّناتُ مضيفٍ كلَّ ثانية طوالَ
# الموجة ← wave-full ← إيقافُ البوّابةِ وتصديرُ PG ← مِسباراتٌ لاحقة ← حكمُ الصلاحيةِ أثناءَ الموجة.
# الاستعمال: qual-wave.sh ROUND CONC IDX MODE   (MODE = acc | diag)
set -u
B=/srv/ceezr-cap-20261016; ROUND=$1; CONC=$2; IDX=$3; MODE=$4
Q=$B/qual/$ROUND; rm -rf $Q; mkdir -p $Q
ms() { python3 -c 'import time;print(round(time.time()*1000))'; }
probes() { # $1 = بادئة
  for i in 1 2 3 4 5; do python3 $B/bin/speed-probe.py >> $Q/$1-speed.jsonl; sleep 2; done
  for i in 1 2 3; do echo "{\"t\":$(ms),\"pg_probe_ms\":$($B/bin/pg-probe.sh)}" >> $Q/$1-pg.jsonl; sleep 2; done
}
if [ "$MODE" = acc ]; then rm -f $B/trace-cur.jsonl*; unset TRACE_FILE DIAG_POOL DIAG_EXTRA GATEWAY_BUN_FLAGS; fi
# البوّابةُ المتبقيّةُ من موجةٍ سابقةٍ تُطفأُ قبلَ الفحص (المرجعُ قيسَ وهي مطفأة).
$B/bin/nsx bash -c "pkill -TERM -f '[a]pps/gateway/src/index.ts'" 2>/dev/null || true
for i in $(seq 1 60); do pgrep -f '[a]pps/gateway/src/index.ts' >/dev/null || break; sleep 1; done
echo "PREFLIGHT_START $(ms)"
python3 $B/bin/host-sampler.py $Q/pre-host.jsonl 60 "$ROUND:preflight"
probes pre
python3 $B/bin/qual-check.py preflight $Q/pre-host.jsonl $Q/pre-speed.jsonl $Q/pre-pg.jsonl > $Q/preflight.json
PRC=$?
cat $Q/preflight.json | python3 -c 'import json,sys;d=json.load(sys.stdin);print("PREFLIGHT",d["verdict"],d["violations"])'
if [ $PRC -ne 0 ]; then echo "PREFLIGHT_INVALID $ROUND — لا حقن"; echo "QUAL_DONE $ROUND rc=3"; exit 3; fi
python3 $B/bin/host-sampler.py $Q/wave-host.jsonl 1200 "$ROUND" &
HS=$!
T0=$(ms)
ROUND_ID=$ROUND $B/bin/wave-full-ref.sh $ROUND $CONC $IDX
WRC=$?
T1=$(ms)
kill $HS 2>/dev/null; wait $HS 2>/dev/null
$B/bin/post-diag.sh $ROUND > $Q/post-diag.out 2>&1
probes post
python3 $B/bin/qual-check.py inflight $Q/wave-host.jsonl $T0 $T1 $Q/post-speed.jsonl $Q/post-pg.jsonl > $Q/inflight.json
IRC=$?
python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print("INFLIGHT",d["verdict"],d["violations"])' $Q/inflight.json
echo "{\"round\":\"$ROUND\",\"mode\":\"$MODE\",\"wave_from_ms\":$T0,\"wave_to_ms\":$T1,\"wave_rc\":$WRC,\"inflight_rc\":$IRC}" > $Q/window.json
mkdir -p $B/runs/$ROUND/evidence/qual && cp $Q/* $B/runs/$ROUND/evidence/qual/
echo "QUAL_DONE $ROUND wave_rc=$WRC inflight_rc=$IRC"
