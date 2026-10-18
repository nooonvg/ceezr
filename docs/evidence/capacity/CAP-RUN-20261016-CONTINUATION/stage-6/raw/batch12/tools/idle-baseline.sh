#!/usr/bin/env bash
# مرجعُ الخمول: 180ث عيّناتُ مضيف (البوّابةُ مطفأة، الخدماتُ الثابتةُ قائمة)، ثمّ 30 مِسبارَ CPU و10 مِسبارَ PG.
B=/home/user/cap-seat; OUT=$1; mkdir -p $OUT
pgrep -f '[a]pps/gateway/src/index.ts' >/dev/null && { echo "GATEWAY_UP — المرجعُ يُشترَطُ فيه إطفاؤها"; exit 1; }
python3 $B/bin/host-sampler.py $OUT/host-idle.jsonl 180 idle-baseline
for i in $(seq 1 30); do python3 $B/bin/speed-probe.py >> $OUT/speed-probe-idle.jsonl; sleep 3; done
for i in $(seq 1 10); do echo "{\"t\":$(python3 -c "import time;print(round(time.time()*1000))"),\"pg_probe_ms\":$($B/bin/pg-probe.sh)}" >> $OUT/pg-probe-idle.jsonl; sleep 2; done
echo IDLE_DONE
