#!/usr/bin/env bash
# مشغّل موجة كاملة داخل netns: wave.sh ثم finish-wave.sh
# الاستخدام: run-wave.sh ROUND PROFILE_JSON DRAIN_SEC WAVE_IDX
set -u
B=/srv/ceezr-cap-20261016; REPO=/home/user/workspace/wt-ref
ROUND=${1:?ROUND}; PROFILE=${2:?PROFILE}; DRAIN=${3:?DRAIN}; IDX=${4:-0}
exec $B/bin/nsx bash -c "cd $REPO && export ${RIDER_SOCKET_MIX:+RIDER_SOCKET_MIX=$RIDER_SOCKET_MIX} SEAT=$B RUN_BASE=$B PATH=/home/user/.local/bin:\$PATH && bash deploy/capacity-run/wave.sh '$ROUND' '$PROFILE' '$DRAIN' '$IDX' && bash deploy/capacity-run/finish-wave.sh '$ROUND'"
