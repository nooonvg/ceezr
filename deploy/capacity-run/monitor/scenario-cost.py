#!/usr/bin/env python3
"""LOAD-01 (الدفعةُ الحاديةَ عشرةَ) — كلفةُ السيناريو من الأدلّةِ الخامِ وحدَها.

الاستعمال: scenario-cost.py <evidence-dir>  ← يطبعُ JSON.

المدخلات (كلُّها في مجلّدِ الأدلّة):
- wave-report.json            عددُ السيناريوهاتِ والحكم.
- resources.jsonl             عيّناتُ /proc كلَّ 5ث (cum_cpu_s لكلِّ صنفٍ ولكلِّ application_name في PostgreSQL).
- pgss-full.csv               pg_stat_statements كاملاً بعدَ الموجة (calls,total_ms,mean_ms,stddev_ms,max_ms,rows,query).
- dispatch-trace.jsonl.load.jsonl  أثرُ الدرينر وHTTP (اختياريّ).
- telegram-jobs.csv           bot,update_id,created_ms,effect_ms من القاعدةِ بعدَ الموجة (اختياريّ).
- *.cpuprofile                ملفُّ تعريفِ CPU للبوّابة (اختياريّ).

تنبيه: total_exec_time في pg_stat_statements زمنُ تنفيذٍ داخلَ الخادم (يشملُ الانتظارَ على الأقفالِ والقرص)،
لا استهلاكُ CPU؛ واستهلاكُ CPU لـ PostgreSQL يُقرأُ من /proc لكلِّ خادمٍ خلفيٍّ (resources.jsonl).
"""
import csv, glob, json, os, statistics, sys

E = sys.argv[1]
out = {}


def pct(xs, q):
    if not xs: return None
    s = sorted(xs)
    return round(s[min(len(s) - 1, int(q * len(s)))], 2)


def dist(xs):
    return {"n": len(xs), "p50": pct(xs, .5), "p95": pct(xs, .95), "p99": pct(xs, .99),
            "mean": round(statistics.mean(xs), 2) if xs else None, "max": round(max(xs), 2) if xs else None}


rep = json.load(open(os.path.join(E, "wave-report.json")))
N = rep["total"]
out["scenarios"] = N
out["verdict"] = rep["verdict"]
out["failed_gates"] = rep["failedGates"]
gates = {g["id"]: g["value"] for g in rep["gates"] + rep["perf"]}
out["gates"] = {k: gates.get(k) for k in ["G1", "P1", "P2", "P3", "P4", "P7"]}

# ---- CPU لكلِّ سيناريو (من /proc) ----
rows = [json.loads(l) for l in open(os.path.join(E, "resources.jsonl"))]
active = [r for r in rows if (r.get("generator") or {}).get("cpu_pct", 0) > 5]
if active and "cum_cpu_s" in active[-1]:
    first = rows[rows.index(active[0]) - 1] if rows.index(active[0]) > 0 else active[0]
    a, b = first.get("cum_cpu_s", {}), active[-1]["cum_cpu_s"]
    secs = active[-1]["t"] - first["t"]
    cpu = {k: round(b[k] - a.get(k, 0), 2) for k in b}
    out["window_s"] = round(secs, 1)
    out["cpu_s_in_window"] = cpu
    out["scenarios_per_s"] = round(N / 180, 2)
    # السيناريوهاتُ المُنجَزةُ داخلَ نافذةِ العيّناتِ تقريبًا = المعدّل × النافذة
    n_win = N / 180 * secs
    out["cpu_ms_per_scenario"] = {k: round(1000 * v / n_win, 1) for k, v in sorted(cpu.items(), key=lambda kv: -kv[1])}
    tot = sum(v for k, v in cpu.items() if not k.startswith("pg:"))
    out["cpu_ms_per_scenario_total_processes"] = round(1000 * tot / n_win, 1)
    out["host_cpu_util_pct_of_2vcpu"] = round(100 * tot / secs / 2, 1)
    out["load1_mean"] = round(statistics.mean(r["load1"] for r in active), 2)

# ---- PostgreSQL: عددُ الاستعلاماتِ وزمنُ تنفيذِها لكلِّ سيناريو ----
p = os.path.join(E, "pgss-full.csv")
if os.path.exists(p):
    q = []
    for r in csv.DictReader(open(p)):
        r = {**r, **{k: float(r[k]) for k in ["calls", "total_ms", "mean_ms", "stddev_ms", "max_ms", "rows"]}}
        q.append(r)
    calls = sum(r["calls"] for r in q)
    total = sum(r["total_ms"] for r in q)
    out["pg_statements_per_scenario"] = round(calls / N, 1)
    out["pg_exec_ms_per_scenario"] = round(total / N, 2)
    top = sorted(q, key=lambda r: -r["total_ms"])[:20]
    out["pg_top_by_exec"] = [{
        "calls_per_scenario": round(r["calls"] / N, 2), "exec_ms_per_scenario": round(r["total_ms"] / N, 2),
        "share_pct": round(100 * r["total_ms"] / total, 1), "mean_ms": round(r["mean_ms"], 3),
        "stddev_ms": round(r["stddev_ms"], 3), "max_ms": round(r["max_ms"], 1),
        "query": " ".join(r["query"].split())[:160]} for r in top]
    out["pg_top_by_calls"] = [{
        "calls_per_scenario": round(r["calls"] / N, 2), "mean_ms": round(r["mean_ms"], 3),
        "query": " ".join(r["query"].split())[:160]} for r in sorted(q, key=lambda r: -r["calls"])[:20]]

# ---- أثرُ الدرينر وHTTP ----
lt = os.path.join(E, "dispatch-trace.jsonl.load.jsonl")
if os.path.exists(lt):
    jobs, sweeps, http = [], [], {}
    for l in open(lt):
        d = json.loads(l)
        if d["k"] == "job": jobs.append(d)
        elif d["k"] == "sweep": sweeps.append(d)
        elif d["k"] == "http":
            h = http.setdefault(d["route"], {"n": 0, "sumMs": 0.0, "p95s": [], "windows": 0})
            h["n"] += d["n"]; h["sumMs"] += d["sumMs"]; h["p95s"].append(d["p95Ms"] or 0); h["windows"] += 1
    created = {}
    tj = os.path.join(E, "telegram-jobs.csv")
    if os.path.exists(tj):
        for r in csv.DictReader(open(tj)):
            created[(r["bot"], int(r["update_id"]))] = (float(r["created_ms"]), float(r["effect_ms"]) if r["effect_ms"] else None)
    qwait, lane, ex, eff, prep, rec, e2e = [], [], [], [], [], [], []
    for j in jobs:
        c = created.get((j["bot"], j["updateId"]))
        if c: qwait.append(j["claimedAt"] - c[0]); e2e.append(j["endedAt"] - c[0])
        lane.append(j["startedAt"] - j["claimedAt"]); ex.append(j["endedAt"] - j["startedAt"])
        for arr, k in ((eff, "effectCheckMs"), (prep, "prepareMs"), (rec, "recordMs")):
            if j.get(k) is not None: arr.append(j[k])
    out["drainer"] = {
        "jobs": len(jobs), "jobs_per_scenario": round(len(jobs) / N, 2),
        "queue_wait_created_to_claim_ms": dist(qwait),
        "lane_wait_claim_to_start_ms": dist(lane),
        "exec_start_to_end_ms": dist(ex),
        "phase_effect_check_ms": dist(eff), "phase_prepare_ms": dist(prep), "phase_record_ms": dist(rec),
        "created_to_end_ms": dist(e2e),
    }
    if sweeps:
        dur = [s["endedAt"] - s["startedAt"] for s in sweeps]
        tail = [s["endedAt"] - s["lastClaimAt"] for s in sweeps if s["lastClaimAt"]]
        gaps = [b["startedAt"] - a["endedAt"] for a, b in zip(sweeps, sweeps[1:])]
        span = sweeps[-1]["endedAt"] - sweeps[0]["startedAt"]
        out["drainer"]["sweeps"] = {
            "n": len(sweeps), "claimed": sum(s["claimed"] for s in sweeps),
            "duration_ms": dist(dur), "tail_after_last_claim_ms": dist(tail), "gap_between_sweeps_ms": dist(gaps),
            "claim_trips_per_sweep": round(statistics.mean(s["claimTrips"] for s in sweeps), 1),
            "claim_ms_per_sweep": round(statistics.mean(s["claimMs"] for s in sweeps), 1),
            "tail_share_of_span_pct": round(100 * sum(tail) / span, 1) if span else None,
            "throughput_per_s": round(sum(s["claimed"] for s in sweeps) / (span / 1000), 2) if span else None,
        }
    out["http_server_side"] = sorted(({"route": r, "per_scenario": round(h["n"] / N, 2),
                                       "server_ms_per_scenario": round(h["sumMs"] / N, 1),
                                       "mean_ms": round(h["sumMs"] / h["n"], 1) if h["n"] else None,
                                       "p95_of_window_p95_ms": pct(h["p95s"], .95)} for r, h in http.items()),
                                     key=lambda x: -x["server_ms_per_scenario"])[:25]
    out["http_requests_per_scenario"] = round(sum(h["n"] for h in http.values()) / N, 1)
    out["http_server_ms_per_scenario"] = round(sum(h["sumMs"] for h in http.values()) / N, 1)

# ---- ملفُّ تعريفِ CPU للبوّابة ----
profs = glob.glob(os.path.join(E, "*.cpuprofile"))
if profs:
    pr = json.load(open(profs[0]))
    nodes = {n["id"]: n for n in pr["nodes"]}
    deltas = pr.get("timeDeltas") or []
    selfus = {}
    for sid, dt in zip(pr["samples"], deltas):
        selfus[sid] = selfus.get(sid, 0) + dt
    def cat(url, fn):
        u = url or ""
        if "node_modules/postgres" in u: return "postgres.js (البروتوكول)"
        if "node_modules/hono" in u: return "hono (التوجيه)"
        if "node_modules/socket.io" in u or "engine.io" in u or "/ws/" in u: return "socket.io"
        if "node_modules" in u: return "node_modules أخرى"
        if "/apps/gateway/src/background/" in u: return "gateway: background"
        if "/apps/gateway/" in u: return "gateway: http/app"
        if "/apps/workers/" in u: return "workers (مضمَّن)"
        if "/packages/infrastructure/" in u: return "packages/infrastructure"
        if "/packages/application/" in u: return "packages/application"
        if "/packages/" in u: return "packages أخرى"
        if fn in ("(garbage collector)",): return "GC"
        if fn in ("(idle)", "(program)", "(root)"): return fn
        return "bun/runtime (" + (fn or "?")[:30] + ")" if not u else "أخرى"
    by_cat, by_fn = {}, {}
    total = sum(selfus.values())
    for nid, us in selfus.items():
        n = nodes.get(nid)
        if not n: continue
        cf = n["callFrame"]
        c = cat(cf.get("url"), cf.get("functionName"))
        by_cat[c] = by_cat.get(c, 0) + us
        key = f'{cf.get("functionName") or "(anon)"} @ {(cf.get("url") or "").split("/ceezr/")[-1]}:{cf.get("lineNumber")}'
        by_fn[key] = by_fn.get(key, 0) + us
    busy = total - by_cat.get("(idle)", 0)
    out["gateway_cpu_profile"] = {
        "file": os.path.basename(profs[0]), "sampled_s": round(total / 1e6, 1), "busy_s": round(busy / 1e6, 1),
        "by_category_pct_of_busy": {k: round(100 * v / busy, 1) for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1]) if k != "(idle)"},
        "top_self_functions_pct_of_busy": [[k, round(100 * v / busy, 2)] for k, v in sorted(by_fn.items(), key=lambda kv: -kv[1])[:30] if not k.startswith("(idle)")],
    }

print(json.dumps(out, ensure_ascii=False, indent=1))
