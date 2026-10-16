#!/usr/bin/env python3
"""CAP-RUN-20261016 — تجميع حزمة الأدلة النهائية في مجلد فريد.
   python3 build-evidence.py SOAK_ROUND OUT_DIR
لا يطبع ولا ينسخ أي سر: run.env يُنسخ بمفاتيح غير سرية فقط، وsecrets.env لا يُقرأ إلا لفحص عدم التسرّب."""
import hashlib, json, os, shutil, subprocess, sys, glob

B = "/srv/ceezr-cap-20261016"
REPO = "/home/user/workspace/ceezr"
HERE = f"{REPO}/deploy/capacity-run"
soak, out = sys.argv[1], sys.argv[2]
S = f"{B}/runs/{soak}"
os.makedirs(out, exist_ok=True)
sh = lambda c: subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()

def cp(src, name=None):
    if os.path.exists(src):
        shutil.copy2(src, f"{out}/{name or os.path.basename(src)}")
        return True
    return False

# ── ملفات الجولة الأساسية (جولة الـ60 دقيقة) ──
for f in ["timeline.jsonl", "load-events.jsonl", "telegram-mock.jsonl", "gateway.log", "database-metrics.jsonl", "fault-injection.json",
          "resources.jsonl", "generator-metrics.jsonl", "generator-summary.gen1.json", "gateway-starts.jsonl", "isolation-check.txt", "egress-blocked.jsonl",
          "telegram-mock-stats.json", "chaos.out", "monitor.out", "gen1.out", "post-load-drain.jsonl", "fault-injection.part1.json", "fault-injection.part2.json", "egress-guard-summary.jsonl", "load-config.gen1.json"]:
    cp(f"{S}/evidence/{f}")
if not os.path.exists(f"{out}/egress-blocked.jsonl"):
    open(f"{out}/egress-blocked.jsonl", "w").close()
os.makedirs(f"{out}/reports", exist_ok=True)
for f in glob.glob(f"{S}/reports/*"):
    shutil.copy2(f, f"{out}/reports/")
cp(f"{S}/round-metrics.json", "soak-round-metrics.json")
# ── جولات المقارنة ──
os.makedirs(f"{out}/rounds", exist_ok=True)
for r in ["r01-before-pr558", "r02-after-fixes", "r03-after-d6", "r04-after-d6-lanes64", "r00-seed", "r00b-group-smoke"]:
    for f in [f"{B}/runs/{r}/round-metrics.json", f"{B}/runs/{r}/evidence/generator-summary.gen1.json", f"{B}/runs/{r}/evidence/gateway-starts.jsonl", f"{B}/runs/{r}/evidence/load-config.gen1.json"]:
        if os.path.exists(f):
            shutil.copy2(f, f"{out}/rounds/{r}--{os.path.basename(f)}")
cp(f"{B}/runs/before-after.json")
cp(f"{B}/runs/edge/evidence/edge-cases.json")
os.makedirs(f"{out}/edge", exist_ok=True)
for f in glob.glob(f"{B}/runs/edge/evidence/edge*"):
    shutil.copy2(f, f"{out}/edge/")
cp(f"{B}/runs/edge/evidence/gateway.log", "edge/gateway-edge.log")
cp(f"{B}/d8-before.txt", "edge/d8-before-fix-test-output.txt")
cp(f"{B}/test-results.txt")

# ── load-config.json ──
lc = json.load(open(f"{S}/evidence/load-config.gen1.json"))
runenv = {}
for line in open(f"{HERE}/config/run.env"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        runenv[k] = "<redacted>" if any(s in k for s in ("TOKEN", "SECRET", "PASSWORD", "KEY")) else v
fi = json.load(open(f"{S}/evidence/fault-injection.json")) if os.path.exists(f"{S}/evidence/fault-injection.json") else None
json.dump({"generator": lc, "run_env_non_secret": runenv, "chaos_plan": fi and fi.get("plan"), "soak_round": soak,
           "note": "PROFILE مجموعه 3600ث من load.start؛ البذر/التهيئة خارج الجولة. التزامن = سيناريوهات نشطة متزامنة، لا عدد الحسابات المزروعة."},
          open(f"{out}/load-config.json", "w"), ensure_ascii=False, indent=2)

# ── environment.json ──
nsx = f"{B}/bin/nsx"
env = {
    "host": {"os": sh(". /etc/os-release; echo $PRETTY_NAME"), "kernel": sh("uname -r"), "cpus": os.cpu_count(), "mem": sh("free -h | awk '/Mem/{print $2}'"), "disk": sh("df -h / | tail -1")},
    "versions": {"node": sh("node -v"), "bun": sh(f"{os.path.expanduser('~')}/.bun/bin/bun -v"), "postgres": sh(f"{nsx} psql -h 127.0.0.1 -p 55432 -U postgres -tAc 'select version()'"),
                 "postgis": sh(f"{nsx} psql -h 127.0.0.1 -p 55432 -U postgres -d ceezr_cap_20261016 -tAc 'select postgis_lib_version()'"), "redis": sh("redis-server --version")},
    "isolation": {
        "netns": "ceezrsbx", "netns_links": sh("sudo -n ip netns exec ceezrsbx ip -o link | awk '{print $2}'"),
        "netns_routes": sh("sudo -n ip netns exec ceezrsbx ip route") or "(none)",
        "curl_api_telegram_org": sh(f"{nsx} curl -sS -m 5 -o /dev/null -w '%{{http_code}}' https://api.telegram.org/ 2>&1 | tail -1"),
        "curl_1_1_1_1": sh(f"{nsx} curl -sS -m 5 -o /dev/null -w '%{{http_code}}' http://1.1.1.1/ 2>&1 | tail -1"),
        "listening_sockets_in_netns": sh("sudo -n ip netns exec ceezrsbx ss -ltnH | awk '{print $4}' | sort -u | tr '\\n' ' '"),
        "pg": {"data_dir": f"{B}/pg", "port": 55432, "listen": "127.0.0.1", "run_marker": sh(f"{nsx} psql -h 127.0.0.1 -p 55432 -U postgres -tAc 'show ceezr.run_marker'"), "databases": sh(f"{nsx} psql -h 127.0.0.1 -p 55432 -U postgres -tAc \"select string_agg(datname, ',') from pg_database where datname like 'ceezr%'\"")},
        "redis": {"dir": f"{B}/redis", "port": 56379, "bind": "127.0.0.1"},
        "assert_output": open(f"{S}/evidence/isolation-check.txt").read().strip() if os.path.exists(f"{S}/evidence/isolation-check.txt") else None,
    },
    "ports": {"gateway": 54300, "upstash_shim": 58081, "telegram_mock": 58090, "postgres": 55432, "redis": 56379},
    "process_topology": "single-process: gateway + embedded worker (WORKER_IN_GATEWAY) كما في run.env",
}
json.dump(env, open(f"{out}/environment.json", "w"), ensure_ascii=False, indent=2)

# ── source-revisions.json ──
g = lambda c: sh(f"cd {REPO} && {c}")
src = {
    "repo": "https://github.com/uxxxug/ceezr", "pr": 558, "pr_branch": "sandbox/soak-fixes",
    "origin_main_sha": g("git rev-parse origin/main"), "pr_head_sha": g("git rev-parse origin/sandbox/soak-fixes"),
    "work_branch": g("git rev-parse --abbrev-ref HEAD"), "work_head_sha": g("git rev-parse HEAD"),
    "baseline_worktree_for_B0": f"{B}/pr558 @ " + sh(f"cd {B}/pr558 && git rev-parse HEAD"),
    "changed_files": g("git status --short").splitlines(),
    "migrations_added": sorted(os.path.basename(p) for p in glob.glob(f"{REPO}/supabase/migrations/20261016*")),
}
json.dump(src, open(f"{out}/source-revisions.json", "w"), ensure_ascii=False, indent=2)

# ── git-diff.patch (تعديلات + ملفات جديدة، بلا lock) ──
patch = g("git add -N deploy/capacity-run supabase/migrations/20261016000100_cap_run_telegram_drain_fairness_lease_renewal.sql supabase/migrations/20261016000200_cap_run_telegram_jobs_lane_order.sql tests/integration/telegram-drain-lease-renewal.test.ts tests/integration/telegram-jobs-lane-order.test.ts tests/unit/notification-outbox-concurrent-drain.test.ts tests/unit/outbound-global-bucket-per-bot.test.ts tests/unit/telegram-update-drainer-fairness-lease.test.ts tests/unit/telegram-update-drainer-lane-unblock-rerun.test.ts tests/unit/telegram-update-drainer-truncated-rerun.test.ts tests/integration/redispatch-exhausted-starvation.test.ts && git diff -- . ':(exclude)docker/upstash-rest-shim/bun.lock'")
open(f"{out}/git-diff.patch", "w").write(patch + "\n")
# فحص الأسرار: القيم الفعلية لا تُطبع، يُسجَّل العدد فقط
leaks = {}
secrets = {}
for line in open(f"{B}/secrets.env"):
    if "=" in line and not line.startswith("#"):
        k, v = line.strip().split("=", 1)
        if v: secrets[k] = v.strip().strip('"')
for k, v in secrets.items():
    n = 0
    for root, _, files in os.walk(out):
        for f in files:
            try:
                n += open(os.path.join(root, f), errors="ignore").read().count(v)
            except Exception:
                pass
    leaks[k] = n
json.dump({"secret_occurrences_in_bundle": leaks, "all_zero": all(n == 0 for n in leaks.values())}, open(f"{out}/secret-scan.json", "w"), indent=2)
print("secret scan:", leaks)
