#!/usr/bin/env bash
# تسلسلٌ بأثر: TAG CONC IDX0 ثمّ أزواجُ NAME:SIDE:SHA (SIDE=ref|cand؛ cand يُبدِّلُ wt-acc إلى SHA قبلَ الموجة)
set -u
B=/srv/ceezr-cap-20261016; TAG=$1; CONC=$2; I=$3; shift 3
for item in "$@"; do
  IFS=: read -r NAME SIDE SHA <<< "$item"
  if [ "$SIDE" = cand ]; then git -C /home/user/workspace/wt-acc checkout -q "$SHA"; fi
  echo "SEQ $NAME side=$SIDE sha=$SHA acc=$(git -C /home/user/workspace/wt-acc rev-parse --short HEAD) ref=$(git -C /home/user/workspace/wt-ref rev-parse --short HEAD)"
  $B/bin/b23-trace.sh b23-$TAG-$NAME-$CONC $CONC $I $SIDE
  I=$((I+1))
done
echo SEQ_DONE
