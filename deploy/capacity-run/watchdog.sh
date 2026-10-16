#!/usr/bin/env bash
# CAP-RUN-20261016 — مشرف إعادة تشغيل يحاكي سياسة Render (إعادة العملية المنهارة تلقائيًا).
# إن غابت عملية البوابة 15ث متصلة (ولا يوجد pids/gateway.hold) يُعاد تشغيلها ويُسجَّل الحدث في timeline.jsonl.
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016; : "${RUN_DIR:?}"
down=0
while [ ! -f "$B/pids/watchdog.stop" ]; do
  if sudo -n ip netns exec ceezrsbx2 pgrep -f "[a]pps/gateway/src/index.ts" >/dev/null; then down=0
  elif [ -f "$B/pids/gateway.hold" ]; then down=0
  else
    down=$((down+3))
    if [ $down -ge 15 ]; then
      echo "{\"t\":\"$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)\",\"source\":\"watchdog\",\"event\":\"gateway.auto_restart\",\"down_s\":$down}" >> "$RUN_DIR/evidence/timeline.jsonl"
      RUN_DIR=$RUN_DIR bash "$HERE/svc.sh" gateway >/dev/null 2>&1; down=0; sleep 10
    fi
  fi
  sleep 3
done
