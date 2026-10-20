#!/usr/bin/env bash
# الدفعة 23 — مقعدُ GitHub (4 vCPU): يبني نسخةً من مقعدِ CAP-RUN-20261016 بالمساراتِ نفسِها حرفاً،
# ثمّ مرجعَ خمولٍ ← validity مشتقّة ← الموجات. يعملُ بالمستخدم «user» داخلَ ceezrseat.slice.
#   seat.sh smoke|full
# لا أسرارَ حقيقيّة: setup-env يولّدُ أسرارَ المقعدِ المحلّيّةَ عشوائيّاً (600) ولا تُطبَع.
set -euo pipefail
MODE=${1:?smoke|full}
export HOME=/home/user PATH=/home/user/.bun/bin:/home/user/.local/bin:/usr/lib/postgresql/18/bin:/usr/sbin:/usr/bin:/sbin:/bin
export CAP_SEAT_CG=ceezrseat.slice CAP_SIBS="system.slice init.scope user.slice"
B=/srv/ceezr-cap-20261016; W=/home/user/workspace; H=$W/ceezr; OUT=/home/user/b23-out
R_SHA=${R_SHA:?}; C_SHA=${C_SHA:?}
mkdir -p "$OUT"
log() { echo "[$(date -u +%T)] $*"; }

log "worktrees R=$R_SHA C=$C_SHA"
git -C "$H" worktree add -f --detach "$W/wt-ref" "$R_SHA" >/dev/null 2>&1
git -C "$H" worktree add -f --detach "$W/wt-acc" "$C_SHA" >/dev/null 2>&1
for wt in wt-ref wt-acc; do
  (cd "$W/$wt" && bun install --frozen-lockfile >"$OUT/bun-install-$wt.log" 2>&1)
  # وسيطُ REST خارجَ مساحةِ العمل: له قفلُه ووحداتُه (كما على المقعدِ الأصليّ).
  (cd "$W/$wt/docker/upstash-rest-shim" && bun install --frozen-lockfile >>"$OUT/bun-install-$wt.log" 2>&1)
done
grep -H "^  gatewayRequest: " "$W/wt-ref/packages/shared/config/connection-budget.ts" "$W/wt-acc/packages/shared/config/connection-budget.ts"

log "setup-env (infra|db|migrate) من wt-acc"
(cd "$W/wt-acc" && bash deploy/capacity-run/setup-env-20261016.sh all) >"$OUT/setup-env.log" 2>&1 || { tail -20 "$OUT/setup-env.log"; exit 1; }
tail -3 "$OUT/setup-env.log"
# المقعدُ الأصليُّ أُضيفَ إليه INTERNAL_SIGNAL_SECRET يدويّاً (64 hex) بعدَ setup-env؛ بلاه تعيدُ إشارةُ العروضِ 503.
grep -q '^INTERNAL_SIGNAL_SECRET=' "$B/secrets.env" || ( umask 177; echo "INTERNAL_SIGNAL_SECRET=$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> "$B/secrets.env" )
echo "secrets_keys=$(cut -d= -f1 "$B/secrets.env" | tr '\n' ' ')"
NSX=$B/bin/nsx; PSQL="$NSX psql -h 127.0.0.1 -p 55432 -U postgres"
# المقعدُ الأصليّ: pg_stat_statements مُحمَّلٌ مسبقاً (postgresql.auto.conf).
$PSQL -d postgres -qc "alter system set shared_preload_libraries = 'pg_stat_statements'"
$NSX bash -c "/usr/lib/postgresql/18/bin/pg_ctl -D $B/pg -l $B/pg.log -w restart" >/dev/null
$PSQL -d postgres -Atc "show shared_preload_libraries"

log "قالبُ المقعد: هجراتٌ + seat-seed.sql ثمّ ceezr_cap_tpl"
$PSQL -d ceezr_cap_20261016 -v ON_ERROR_STOP=1 -q -f "$W/wt-acc/deploy/capacity-run/config/seat-seed.sql"
$PSQL -d postgres -qc "create database ceezr_cap_tpl template ceezr_cap_20261016"
$PSQL -d ceezr_cap_tpl -q -f "$H/deploy/capacity-run/b23-runner/fingerprint.sql" 2>&1 | grep -v '^$' > "$OUT/tpl-fingerprint.txt"
# المقارنة: دوالُّ المشروعِ حرفاً والجداولُ غيرُ الفارغةِ بعددِ صفوفِها (أقسامُ السجلِّ المؤرَّخةُ تتبعُ التاريخ).
exp_fn=$(grep -o 'fn_md5=[^ ]* fn_count=[0-9]*' "$H/deploy/capacity-run/b23-runner/expected-fingerprint.txt")
exp_ne=$(grep -o 'nonempty=.*' "$H/deploy/capacity-run/b23-runner/expected-fingerprint.txt")
got_fn=$(grep -o 'fn_md5=[^ ]* fn_count=[0-9]*' "$OUT/tpl-fingerprint.txt"); got_ne=$(grep -o 'nonempty=.*' "$OUT/tpl-fingerprint.txt")
if [ "$exp_fn" = "$got_fn" ] && [ "$exp_ne" = "$got_ne" ]; then echo "TPL_FINGERPRINT_MATCH $got_fn"; else
  echo "TPL_FINGERPRINT_MISMATCH exp[$exp_fn | $exp_ne] got[$got_fn | $got_ne]"; exit 1; fi

log "أدواتُ المقعد"
cp "$H"/deploy/capacity-run/b23-runner/seat-bin/* "$B/bin/"; chmod 755 "$B"/bin/*

log "المحاكي والوسيط من wt-acc"
(cd "$W/wt-acc" && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh mock && CODE_DIR=$W/wt-acc bash deploy/capacity-run/svc.sh shim)
sleep 8
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh status) | tee "$OUT/svc-status.txt" || true
grep -q "telegram-mock=up" "$OUT/svc-status.txt" && grep -q "shim=up" "$OUT/svc-status.txt" || { echo "SEAT_SERVICES_DOWN"; tail -20 "$B/runs/current/evidence/shim.log" 2>/dev/null; exit 1; }

log "سجلُّ البيئة"
{
  echo "date_utc=$(date -Is)"; echo "nproc=$(nproc)"; lscpu | grep -E "Model name|^CPU\(s\)|Thread|Core|Socket|Hypervisor|MHz" | tr -s ' '
  free -m | head -2; uname -r; . /etc/os-release; echo "os=$PRETTY_NAME"
  postgres --version; $PSQL -d ceezr_cap_tpl -Atc "select extname||' '||extversion from pg_extension order by 1" | tr '\n' ' '; echo
  redis-server --version; echo "bun=$(bun --version)"; python3 --version; echo "node=$(node --version 2>/dev/null || echo absent)"
  $PSQL -d postgres -Atc "select name||'='||setting||coalesce(unit,'') from pg_settings where source not in ('default','override','client','session') order by 1"
  echo "pg_cgroup=$(cat /proc/$(pgrep -f 'postgres -D' | head -1)/cgroup)"; echo "self_cgroup=$(cat /proc/self/cgroup)"
  echo "seat_cpu_max=$(cat /sys/fs/cgroup/$CAP_SEAT_CG/cpu.max 2>/dev/null)"
  grep -E "open files|processes" /proc/$(pgrep -f 'postgres -D' | head -1)/limits | tr -s ' '
  sudo -n ip netns exec ceezrsbx2 sysctl net.core.somaxconn net.ipv4.ip_local_port_range 2>/dev/null
  cat /sys/kernel/mm/transparent_hugepage/enabled; echo "psi=$(head -1 /proc/pressure/cpu 2>/dev/null)"
  echo "running_services:"; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print "  "$1}'
} > "$OUT/seat-env.txt" 2>&1
cat "$OUT/seat-env.txt" | head -30
(cd "$W/wt-acc" && bash deploy/capacity-run/svc.sh assert)

log "مرجعُ الخمول (البوّابةُ مطفأة) ← validity B23-RUNNER-V1"
"$B/bin/idle-baseline.sh" "$B/qual/idle-b23" >"$OUT/idle.log" 2>&1
python3 "$H/deploy/capacity-run/b23-runner/derive-validity.py" "$B/qual/idle-b23" "$B/bin/validity.json"
cp "$B/bin/validity.json" "$OUT/validity.json"; cp -r "$B/qual/idle-b23" "$OUT/idle-b23"
echo "VALIDITY_PINNED $(date -Is) sha256=$(sha256sum $B/bin/validity.json | cut -c1-16)"

if [ "$MODE" = smoke ]; then
  log "SMOKE (ليست موجةَ قياس): R عند 50"
  "$B/bin/b23-seq.sh" smoke 50 29 "S1:ref:$R_SHA" > "$OUT/seq.log" 2>&1 || true
  RUNS="b23-smoke-S1-50"
else
  log "القياس: R-C-C-R ثمّ C-R-R-C عند 750"
  "$B/bin/b23-seq.sh" s1 750 30 "R1:ref:$R_SHA" "C1:cand:$C_SHA" "C2:cand:$C_SHA" "R2:ref:$R_SHA" \
    "C3:cand:$C_SHA" "R3:ref:$R_SHA" "R4:ref:$R_SHA" "C4:cand:$C_SHA" > "$OUT/seq.log" 2>&1 || true
  RUNS=$(for n in R1 C1 C2 R2 C3 R3 R4 C4; do printf "b23-s1-%s-750 " $n; done)
fi
grep -E "^SEQ|PREFLIGHT |INFLIGHT |QUAL_DONE|WAVE_DONE|END rc|INVALID|MISMATCH" "$OUT/seq.log" || true

log "تجميعُ الدليل"
# shellcheck disable=SC2086
python3 "$B/bin/b23-compare.py" $RUNS > "$OUT/b23-summary.json" 2>"$OUT/b23-compare.err" || tail -5 "$OUT/b23-compare.err"
for r in $RUNS; do
  E=$B/runs/$r/evidence; D=$OUT/raw/$r; mkdir -p "$D"; [ -d "$E" ] || { echo "MISSING $r"; continue; }
  for f in b23-env.json db-audit-post.json db-audit-pre.json resources.jsonl timeline.jsonl wave-report.json; do cp "$E/$f" "$D/" 2>/dev/null || true; done
  for f in conn-samples.csv load-trace.jsonl miniapp-load-events.jsonl pgss-full.csv update-jobs.csv sched-samples.jsonl; do [ -f "$E/$f" ] && gzip -9c "$E/$f" > "$D/$f.gz"; done
  cp -r "$B/qual/$r" "$D/qual" 2>/dev/null || true
  for g in $B/bin/gates.sh; do $g "$r" > "$D/gates.txt" 2>&1 || true; done
done
mkdir -p "$OUT/service-logs"
for f in shim telegram-mock gateway; do tail -n 400 "$B/runs/current/evidence/$f.log" > "$OUT/service-logs/$f.tail.log" 2>/dev/null || true; done
cp "$B/runs/current/evidence/gateway-starts.jsonl" "$OUT/service-logs/" 2>/dev/null || true
log "DONE"
