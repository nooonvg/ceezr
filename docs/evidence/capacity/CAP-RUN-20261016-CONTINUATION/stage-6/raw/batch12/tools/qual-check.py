#!/usr/bin/env python3
"""يحكمُ بصلاحيةِ البيئةِ وفقَ validity.json (B12-V1).

qual-check.py preflight <host.jsonl> <speed.jsonl> <pg.jsonl>
qual-check.py inflight  <host.jsonl> <from_ms> <to_ms> <post-speed.jsonl> <post-pg.jsonl>
يطبعُ JSON فيه verdict = VALID | INVALID وقائمةَ الخروقات؛ ورمزُ الخروجِ 0 أو 3.
"""
import json, statistics as st, subprocess, sys

V = json.load(open("/home/user/cap-seat/bin/validity.json"))
mode = sys.argv[1]


def host(path, lo=None, hi=None):
    rows = [json.loads(l) for l in open(path)]
    meta = next(r for r in rows if r.get("k") == "meta")
    H = [r for r in rows if r.get("k") == "host" and (lo is None or lo <= r["t"] <= hi)]
    return meta, H


def med(path, key):
    v = [json.loads(l)[key] for l in open(path) if l.strip()]
    return round(st.median(v), 1) if v else None


def common(H, lim):
    out, bad = {}, []
    steal = [r["cpu"]["steal"] for r in H]
    sib = [(r["cg_cpu_pct_of_1core"]["system.slice"] or 0) + (r["cg_cpu_pct_of_1core"]["init.scope"] or 0) for r in H]
    fr = [r["foreign_cpu_pct_of_1core_5s"] for r in H if "foreign_cpu_pct_of_1core_5s" in r]
    io = [r["cpu"]["iowait"] for r in H]
    thr = sum(r["seat_throttled_delta"] for r in H)
    out.update(samples=len(H), steal_mean=round(st.mean(steal), 2), steal_max_1s=max(steal),
               siblings_mean=round(st.mean(sib), 2), foreign_mean=round(st.mean(fr), 2) if fr else None,
               iowait_mean=round(st.mean(io), 2), throttled=thr,
               foreign_top=sorted({c for r in H for p, c in r.get("foreign_top", []) if p >= 2.0}))
    if out["steal_mean"] > lim["steal_mean_max_pct"]: bad.append(f"steal_mean {out['steal_mean']} > {lim['steal_mean_max_pct']}")
    if out["siblings_mean"] > lim["siblings_mean_max_pct_1core"]: bad.append(f"siblings_mean {out['siblings_mean']} > {lim['siblings_mean_max_pct_1core']}")
    if fr and out["foreign_mean"] > lim["foreign_mean_max_pct_1core"]: bad.append(f"foreign_mean {out['foreign_mean']} > {lim['foreign_mean_max_pct_1core']}")
    if not fr: bad.append("foreign: لا عيّنات")
    if out["iowait_mean"] > lim["iowait_mean_max_pct"]: bad.append(f"iowait_mean {out['iowait_mean']} > {lim['iowait_mean_max_pct']}")
    if thr > lim["throttled_max"]: bad.append(f"throttled {thr}")
    return out, bad, steal


if mode == "preflight":
    lim = V["preflight"]; meta, H = host(sys.argv[2])
    out, bad, steal = common(H, lim)
    if out["steal_max_1s"] > lim["steal_1s_max_pct"]: bad.append(f"steal_1s {out['steal_max_1s']} > {lim['steal_1s_max_pct']}")
    out["procs_blocked_max"] = max(r["procs_blocked"] for r in H)
    if out["procs_blocked_max"] > lim["procs_blocked_max"]: bad.append(f"procs_blocked {out['procs_blocked_max']}")
    if meta.get("seat_cpu_max") != lim["seat_cpu_max_required"]: bad.append(f"cpu.max {meta.get('seat_cpu_max')}")
    out["speed_probe_median_ms"] = med(sys.argv[3], "max_wall_ms"); out["pg_probe_median_ms"] = med(sys.argv[4], "pg_probe_ms")
    if out["speed_probe_median_ms"] is None or out["speed_probe_median_ms"] > lim["speed_probe_median_max_ms"]: bad.append(f"speed_probe {out['speed_probe_median_ms']} > {lim['speed_probe_median_max_ms']}")
    if out["pg_probe_median_ms"] is None or out["pg_probe_median_ms"] > lim["pg_probe_median_max_ms"]: bad.append(f"pg_probe {out['pg_probe_median_ms']} > {lim['pg_probe_median_max_ms']}")
    left = []
    for pat in lim["no_leftover_processes"]:
        r = subprocess.run(["pgrep", "-f", "[" + pat[0] + "]" + pat[1:]], capture_output=True, text=True)
        if r.stdout.strip(): left.append(pat)
    out["leftover"] = left
    if left: bad.append(f"leftover {left}")
else:
    lim = V["inflight"]; meta, H = host(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
    out, bad, steal = common(H, lim)
    roll = max((st.mean(steal[i:i + 10]) for i in range(max(1, len(steal) - 9))), default=0)
    out["steal_10s_rolling_max"] = round(roll, 2)
    if roll > lim["steal_10s_rolling_max_pct"]: bad.append(f"steal_10s {roll:.2f} > {lim['steal_10s_rolling_max_pct']}")
    out["post_speed_probe_median_ms"] = med(sys.argv[5], "max_wall_ms"); out["post_pg_probe_median_ms"] = med(sys.argv[6], "pg_probe_ms")
    if out["post_speed_probe_median_ms"] is None or out["post_speed_probe_median_ms"] > lim["post_speed_probe_median_max_ms"]: bad.append(f"post_speed_probe {out['post_speed_probe_median_ms']}")
    if out["post_pg_probe_median_ms"] is None or out["post_pg_probe_median_ms"] > lim["post_pg_probe_median_max_ms"]: bad.append(f"post_pg_probe {out['post_pg_probe_median_ms']}")
    busy = [100 - r["cpu"]["idle"] - r["cpu"]["steal"] - r["cpu"]["iowait"] for r in H]
    out["host_busy_mean_pct"] = round(st.mean(busy), 1)
    out["procs_running_mean"] = round(st.mean(r["procs_running"] for r in H), 2)
out["validity_version"] = V["version"]; out["mode"] = mode
out["violations"] = bad; out["verdict"] = "VALID" if not bad else "INVALID"
print(json.dumps(out, ensure_ascii=False, indent=1))
sys.exit(0 if not bad else 3)
