#!/usr/bin/env bash
# تشغيل مصفوفة الحالات الحدّية داخل الـnetns على النظام الحي.  RUN_DIR=... ./edge.sh
HERE=$(cd "$(dirname "$0")" && pwd); B=/srv/ceezr-cap-20261016
: "${RUN_DIR:?}"; mkdir -p "$RUN_DIR/evidence"
$B/bin/nsx bash -c 'export PATH="/home/user/.local/bin:$PATH"; set -a; . "$1"; . "$2"; set +a; export RUN_DIR="$3"; exec bun run "$4"' _ \
  "$HERE/config/run.env" "$B/secrets.env" "$RUN_DIR" "$HERE/tests/edge.ts" 2>&1 | tee "$RUN_DIR/evidence/edge.out"
