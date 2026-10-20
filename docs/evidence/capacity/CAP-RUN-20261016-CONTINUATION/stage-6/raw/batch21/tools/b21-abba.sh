#!/usr/bin/env bash
# ABBA بأثرٍ عندَ تركيزٍ واحد: TAG CONC IDX0
set -u
B=/srv/ceezr-cap-20261016; TAG=$1; CONC=$2; I=$3
for step in "A1 ref" "B1 cand" "B2 cand" "A2 ref"; do
  set -- $step
  $B/bin/b21-trace.sh b21-$TAG-$1-$CONC $CONC $I $2
  I=$((I+1))
done
echo ABBA_DONE
