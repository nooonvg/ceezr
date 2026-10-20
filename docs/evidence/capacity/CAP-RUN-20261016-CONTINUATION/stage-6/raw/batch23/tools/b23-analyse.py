#!/usr/bin/env python3
"""الدفعة 23 — تجميعُ R مقابلَ C من أثرِ مقعدِ GitHub (b23-summary.json + عيّناتُ الجدولة + wave-report).

b23-analyse.py <artifact-dir> [b22-summary.json]  → JSON على stdout.
الموجاتُ غيرُ الصالحة (preflight أو inflight ≠ VALID) تُسرَدُ بسببِها وتُستبعَدُ من المتوسّطات.
"""
import gzip, json, os, statistics as st, sys

A = sys.argv[1]
rows = json.load(open(f"{A}/b23-summary.json"))
B22 = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None


def num(v):
    if isinstance(v, (int, float)): return float(v)
    s = str(v).split()[0].rstrip("%").replace("ms", "").replace("s", "")
    try: return float(s)
    except ValueError: return None


def sched(r):
    p = f"{A}/raw/{r}/sched-samples.jsonl.gz"; w = f"{A}/raw/{r}/qual/window.json"
    if not os.path.exists(p) or not os.path.exists(w): return {}
    win = json.load(open(w)); lo, hi = win["wave_from_ms"], win["wave_to_ms"]
    S = [json.loads(l) for l in gzip.open(p, "rt") if '"sched"' in l]
    S = [s for s in S if lo <= s["t"] <= hi]
    # نافذةُ الحِمل: الثواني التي يعملُ فيها المولّد (لا التحضيرَ ولا التصريف).
    L = [s for s in S if s.get("generator", {}).get("run_pct_1core", 0) > 5]
    out = {"samples_load": len(L)}
    for k in ("postgres", "gateway", "generator"):
        run = [s[k]["run_pct_1core"] for s in L if k in s]; wt = [s[k]["runq_wait_pct_1core"] for s in L if k in s]
        if run:
            out[f"{k}_run_pct_1core"] = round(st.mean(run), 1); out[f"{k}_runq_wait_pct_1core"] = round(st.mean(wt), 1)
            out[f"{k}_wait_per_run"] = round(sum(wt) / max(1e-9, sum(run)), 3)
    ps = [s["psi_some_pct"] for s in L if s.get("psi_some_pct") is not None]
    if ps: out["psi_some_mean_pct"] = round(st.mean(ps), 1)
    pr = [s["procs_running"] for s in L if s.get("procs_running") is not None]
    if pr: out["procs_running_mean"] = round(st.mean(pr), 2)
    return out


def report(r):
    p = f"{A}/raw/{r}/wave-report.json"
    if not os.path.exists(p): return {}
    w = json.load(open(p))
    return {"verdict": w["verdict"], "failedGates": w["failedGates"],
            "gates_fail": [g["id"] for g in w["gates"] + w["perf"] if not g["pass"]]}


def fail_reasons(r):
    p = f"{A}/raw/{r}/miniapp-load-events.jsonl.gz"; c = {}
    if not os.path.exists(p): return c
    for l in gzip.open(p, "rt"):
        if '"scenario.outcome"' not in l: continue
        e = json.loads(l)
        if e.get("kind") != "verified":
            k = f"{e.get('reason')}|{e.get('detail', {}).get('phoneProofJob') if isinstance(e.get('detail'), dict) else e.get('phoneProofJob')}"
            c[k] = c.get(k, 0) + 1
    return c


W = []
for x in rows:
    r = x["round"]; valid = x.get("preflight") == "VALID" and x.get("inflight") == "VALID"
    g1 = x.get("G1", ""); n = g1.split("(")[1].rstrip(")").split("/") if "(" in g1 else [0, 1]
    W.append({"round": r, "side": "R" if "-R" in r else "C", "valid": valid,
              "why_invalid": None if valid else {"preflight": x.get("preflight"), "inflight": x.get("inflight"),
                                                 "pre_why": x.get("preflight_why"), "in_why": x.get("inflight_why")},
              "completed": x.get("completed"), "scenarios": x.get("scenarios"), "G1_pct": num(g1),
              "P": {k: num(x["perf_all"].get(k)) for k in x.get("perf_all", {})},
              "gates": x.get("gates_all", {}), "q_wait_ms": x.get("q_wait_ms"), "q_run_ms": x.get("q_run_ms"),
              "req_q_per_completed": x.get("req_q_per_completed"), "pg_exec_s": x.get("pg_exec_s"),
              "req_hold_s": x.get("req_hold_s"), "gwreq_conn_max": x.get("gwreq_conn_max"),
              "gwreq_active_p95": x.get("gwreq_active_p95"), "pg_cpu_median": x.get("pg_cpu_median"),
              "gw_cpu_median": x.get("gw_cpu_median"), "host_idle_median": x.get("host_idle_median"),
              "loop_lag_p95_median_ms": x.get("loop_lag_p95_median_ms"), "tg_per_s": x.get("tg_per_s"),
              "tg_over20": x.get("tg_over20"), "tg_lat_p95_s": x.get("tg_lat_p95_s"), "tg_not_done": x.get("tg_not_done"),
              "host_gap_max_s": x.get("host_gap_max_s"), "conn_redis_errors": x.get("conn_redis_errors"),
              "audit_violations": (x.get("audit_post") or {}).get("violations"), "env": x.get("env"),
              "sched": sched(r), "report": report(r), "fail_reasons": fail_reasons(r)})


def agg(side):
    V = [w for w in W if w["side"] == side and w["valid"]]
    if not V: return {"n": 0}
    m = lambda f: round(st.mean(f(w) for w in V), 3)
    keys = ["P1", "P2", "P3", "P4", "P5", "P6a", "P7"]
    out = {"n": len(V), "completed_mean": m(lambda w: w["completed"]), "completed_min": min(w["completed"] for w in V),
           "completed_max": max(w["completed"] for w in V), "G1_mean": m(lambda w: w["G1_pct"]),
           "G1_min": min(w["G1_pct"] for w in V), "G1_max": max(w["G1_pct"] for w in V),
           "q_wait_ms": m(lambda w: w["q_wait_ms"]), "q_run_ms": m(lambda w: w["q_run_ms"]),
           "pg_exec_s": m(lambda w: w["pg_exec_s"]), "req_hold_s": m(lambda w: w["req_hold_s"]),
           "req_q_per_completed": m(lambda w: w["req_q_per_completed"]),
           "pg_cpu_median": m(lambda w: w["pg_cpu_median"]), "gw_cpu_median": m(lambda w: w["gw_cpu_median"]),
           "host_idle_median": m(lambda w: w["host_idle_median"]), "loop_lag_p95_ms": m(lambda w: w["loop_lag_p95_median_ms"]),
           "tg_per_s": m(lambda w: w["tg_per_s"]), "tg_over20": m(lambda w: w["tg_over20"]),
           "tg_lat_p95_s": m(lambda w: w["tg_lat_p95_s"]), "gwreq_conn_max": max(w["gwreq_conn_max"] for w in V),
           "gwreq_active_p95": m(lambda w: w["gwreq_active_p95"])}
    for k in keys: out[k] = m(lambda w, k=k: w["P"].get(k) or 0)
    for k in V[0]["sched"]:
        if k != "samples_load": out["sched_" + k] = m(lambda w, k=k: w["sched"].get(k, 0))
    return out


R, C = agg("R"), agg("C")
ratio = {k: round(C[k] / R[k], 3) for k in R if k in C and isinstance(R[k], (int, float)) and R[k]} if R["n"] and C["n"] else {}
res = {"waves": W, "R": R, "C": C, "C_over_R": ratio,
       "invalid": [{"round": w["round"], "why": w["why_invalid"]} for w in W if not w["valid"]]}
if R["n"] and C["n"]:
    res["rules"] = {
        "cpu_rule_throughput_ratio_ge_1_20": ratio["completed_mean"] >= 1.20,
        "cpu_rule_minC_gt_maxR": C["completed_min"] > R["completed_max"],
        "cpu_rule_q_run_inflation_le_1_40": ratio["q_run_ms"] <= 1.40,
        "cpu_rule_pg_runq_wait_le_1_50": ratio.get("sched_postgres_runq_wait_pct_1core", 99) <= 1.50,
        "g1_rule_plus5pp": C["G1_mean"] - R["G1_mean"] >= 5.0,
        "g1_rule_minC_gt_maxR": C["G1_min"] > R["G1_max"],
        "g1_acceptance_99": C["G1_min"] >= 99.0,
    }
print(json.dumps(res, ensure_ascii=False, indent=1))
