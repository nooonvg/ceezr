#!/usr/bin/env python3
"""مُلخِّصُ تأهيلِ المقعد: يقرأُ host-*.jsonl ومِسباراتِ السرعةِ ويُخرجُ JSON بالإحصاءات.

الاستعمال: qual-summary.py <host.jsonl> [speed-probe.jsonl] [pg-probe.jsonl] [--from MS --to MS]
"""
import json, statistics as st, sys


def pct(v, q):
    v = sorted(v)
    return None if not v else v[min(len(v) - 1, int(q * (len(v) - 1) + 0.5))]


def desc(v):
    v = [x for x in v if x is not None]
    if not v: return None
    med = st.median(v)
    return {"n": len(v), "mean": round(st.mean(v), 2), "median": round(med, 2), "p90": round(pct(v, .9), 2),
            "p99": round(pct(v, .99), 2), "max": round(max(v), 2), "min": round(min(v), 2),
            "mad": round(st.median([abs(x - med) for x in v]), 2)}


args = [a for a in sys.argv[1:]]
lo = hi = None
if "--from" in args:
    i = args.index("--from"); lo = int(args[i + 1]); del args[i:i + 2]
if "--to" in args:
    i = args.index("--to"); hi = int(args[i + 1]); del args[i:i + 2]
rows = [json.loads(l) for l in open(args[0])]
meta = next((r for r in rows if r.get("k") == "meta"), {})
H = [r for r in rows if r.get("k") == "host" and (lo is None or r["t"] >= lo) and (hi is None or r["t"] <= hi)]
F = [r for r in H if "foreign_cpu_pct_of_1core_5s" in r]
out = {"meta": meta, "samples": len(H),
       "steal_pct": desc([r["cpu"]["steal"] for r in H]),
       "steal_pct_per_core_max": max((max(r[c]["steal"] for c in r if c.startswith("cpu") and c != "cpu") for r in H), default=None),
       "iowait_pct": desc([r["cpu"]["iowait"] for r in H]),
       "busy_pct": desc([100 - r["cpu"]["idle"] - r["cpu"]["iowait"] - r["cpu"]["steal"] for r in H]),
       "procs_running": desc([r["procs_running"] for r in H]),
       "procs_blocked": desc([r["procs_blocked"] for r in H]),
       "system_slice_pct_1core": desc([r["cg_cpu_pct_of_1core"]["system.slice"] for r in H]),
       "space_slice_pct_1core": desc([r["cg_cpu_pct_of_1core"]["space.slice"] for r in H]),
       "init_scope_pct_1core": desc([r["cg_cpu_pct_of_1core"]["init.scope"] for r in H]),
       "seat_throttled_total": sum(r["seat_throttled_delta"] for r in H),
       "seat_throttled_usec_total": sum(r["seat_throttled_usec_delta"] for r in H),
       "psi_cpu_available": any(r["psi_cpu"] for r in H),
       "foreign_pct_1core": desc([r["foreign_cpu_pct_of_1core_5s"] for r in F]),
       "foreign_top_seen": sorted({c for r in F for p, c in r["foreign_top"] if p >= 1.0}),
       "disk_write_kb_s": desc([r["disk"]["write_kb_s"] for r in H]),
       "disk_read_kb_s": desc([r["disk"]["read_kb_s"] for r in H]),
       "disk_io_ms_per_s": desc([r["disk"]["io_ms"] for r in H]),
       "net_lo_bytes_s": desc([r["net_bytes_s"]["lo"] for r in H]),
       "net_other_bytes_s": desc([r["net_bytes_s"]["other"] for r in H]),
       "ctxt_per_s": desc([r["ctxt_per_s"] for r in H])}
if len(args) > 1:
    P = [json.loads(l) for l in open(args[1]) if l.strip()]
    out["speed_probe_max_wall_ms"] = desc([p["max_wall_ms"] for p in P])
    out["speed_probe_cpu_over_wall"] = desc([round(sum(w["cpu_ms"] for w in p["workers"]) / sum(w["wall_ms"] for w in p["workers"]), 3) for p in P])
if len(args) > 2:
    Q = [json.loads(l) for l in open(args[2]) if l.strip()]
    out["pg_probe_ms"] = desc([q["pg_probe_ms"] for q in Q])
print(json.dumps(out, ensure_ascii=False, indent=1))
